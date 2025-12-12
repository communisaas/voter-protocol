/**
 * NoirProver - Browser-native ZK prover using Barretenberg
 * 
 * Uses @noir-lang/noir_js for witness generation and @aztec/bb.js for proving.
 */

import { Barretenberg } from '@voter-protocol/bb.js';
import { Noir } from '@noir-lang/noir_js';
import { inflate } from 'pako';
import type { ProverConfig, CircuitInputs, ProofResult } from './types';

// Import circuit JSON (contains bytecode + ABI)
import circuitJson from '../circuits/district_membership.json';

export class NoirProver {
    private api: Barretenberg | null = null;
    private noir: Noir | null = null;
    private bytecode: Uint8Array | null = null;
    private provingKey: Uint8Array | null = null;
    private config: ProverConfig;

    constructor(config: ProverConfig = {}) {
        this.config = {
            circuitName: 'district_membership',
            ...config,
        };
    }

    /**
     * Initialize the prover (must be called before generating proofs)
     */
    async init(): Promise<void> {
        if (this.api && this.noir) return; // Already initialized

        console.log('[NoirProver] Initializing...');
        const start = Date.now();

        // Initialize Barretenberg backend
        // Use default threading (navigator.hardwareConcurrency if headers permit)
        this.api = await Barretenberg.new();

        // Initialize Noir for witness generation
        this.noir = new Noir(circuitJson as any);

        // Load and decompress bytecode for proving
        if (this.config.bytecode) {
            this.bytecode = this.config.bytecode;
        } else {
            const bytecodeBuffer = Uint8Array.from(atob(circuitJson.bytecode), c => c.charCodeAt(0));
            this.bytecode = inflate(bytecodeBuffer);
        }

        console.log(`[NoirProver] Initialized in ${Date.now() - start}ms`);
    }

    /**
     * Pre-warm the prover by generating the proving key
     * Call this on app load to hide latency from user
     */
    async warmup(): Promise<void> {
        await this.init();
        if (this.provingKey) return; // Already warmed up

        console.log('[NoirProver] Warming up (generating proving key)...');
        const start = Date.now();

        const result = await this.api!.acirGetProvingKey({
            circuit: {
                name: this.config.circuitName!,
                bytecode: this.bytecode!,
                verificationKey: new Uint8Array(0),
            },
            settings: {
                ipaAccumulation: false,
                oracleHashType: 'poseidon',
                disableZk: false,
                optimizedSolidityVerifier: false,
            },
        });

        this.provingKey = result.provingKey;
        if (result.verificationKey) {
            this.config.verificationKey = result.verificationKey;
        }
        const vkSize = result.verificationKey ? result.verificationKey.length : 'N/A';
        console.log(`[NoirProver] Warmup complete in ${Date.now() - start}ms. Pk Size: ${this.provingKey.length}, Vk Size: ${vkSize}`);
    }

    /**
     * Generate a ZK proof for district membership
     */
    async prove(inputs: CircuitInputs): Promise<ProofResult> {
        await this.warmup(); // Ensure we have proving key

        console.log('[NoirProver] Generating witness...');
        const witnessStart = Date.now();

        // Use Noir to generate witness from circuit inputs
        // The input names must match the circuit's main() function parameters
        const noirInputs = {
            merkle_root: inputs.merkleRoot,
            nullifier: inputs.nullifier,
            authority_hash: inputs.authorityHash,
            epoch_id: inputs.epochId,
            campaign_id: inputs.campaignId,
            leaf: inputs.leaf,
            merkle_path: inputs.merklePath,
            leaf_index: inputs.leafIndex,
            user_secret: inputs.userSecret,
        };

        let { witness } = await this.noir!.execute(noirInputs);

        // Decompress witness if gzipped (detected by magic bytes 1f 8b)
        // Noir 1.0+ returns compressed witness, but bb.js expects raw bincode
        if (witness.length > 2 && witness[0] === 0x1f && witness[1] === 0x8b) {
            witness = inflate(witness);
        }

        console.log(`[NoirProver] Witness generated in ${Date.now() - witnessStart}ms`);

        console.log('[NoirProver] Generating proof...');
        const proofStart = Date.now();

        const result = await this.api!.acirProveWithPk({
            circuit: {
                name: this.config.circuitName!,
                bytecode: this.bytecode!,
                verificationKey: new Uint8Array(0),
            },
            witness,
            provingKey: this.provingKey!,
            settings: {
                ipaAccumulation: false,
                oracleHashType: 'poseidon',
                disableZk: false,
                optimizedSolidityVerifier: false,
            },
        });

        console.log(`[NoirProver] Proof generated in ${Date.now() - proofStart}ms`);

        return {
            proof: result.proof,
            publicInputs: {
                merkleRoot: inputs.merkleRoot,
                nullifier: inputs.nullifier,
                authorityHash: inputs.authorityHash,
                epochId: inputs.epochId,
                campaignId: inputs.campaignId,
            },
        };
    }

    /**
     * Clean up resources
     */
    async destroy(): Promise<void> {
        if (this.api) {
            await this.api.destroy();
            this.api = null;
            this.noir = null;
            this.bytecode = null;
            this.provingKey = null;
        }
    }
}
