/**
 * NoirProver - Browser-native ZK prover using Barretenberg
 * 
 * Uses @noir-lang/noir_js for witness generation and @aztec/bb.js for proving.
 */

import { UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import type { CompiledCircuit } from '@noir-lang/noir_js';
import type { ProverConfig, CircuitInputs, ProofResult } from './types';

// Import circuit JSON (contains bytecode + ABI)
import circuitJson from '../circuits/district_membership.json';

export class NoirProver {
    private backend: UltraHonkBackend | null = null;
    private noir: Noir | null = null;
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
        if (this.backend && this.noir) return; // Already initialized

        console.log('[NoirProver] Initializing...');
        const start = Date.now();

        // Cast circuit JSON to CompiledCircuit type
        const circuit = circuitJson as unknown as CompiledCircuit;

        // Initialize Noir for witness generation
        this.noir = new Noir(circuit);

        // Initialize UltraHonk backend for proving
        // The backend handles circuit compilation internally
        this.backend = new UltraHonkBackend(circuit.bytecode);

        console.log(`[NoirProver] Initialized in ${Date.now() - start}ms`);
    }

    /**
     * Pre-warm the prover by initializing backend
     * Call this on app load to hide latency from user
     */
    async warmup(): Promise<void> {
        await this.init();
        console.log('[NoirProver] Warmup complete (backend initialized)');
    }

    /**
     * Generate a ZK proof for district membership
     */
    async prove(inputs: CircuitInputs): Promise<ProofResult> {
        await this.init();

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

        const { witness } = await this.noir!.execute(noirInputs);
        console.log(`[NoirProver] Witness generated in ${Date.now() - witnessStart}ms`);

        console.log('[NoirProver] Generating proof...');
        const proofStart = Date.now();

        // Generate proof using UltraHonk backend
        const { proof, publicInputs } = await this.backend!.generateProof(witness);

        console.log(`[NoirProver] Proof generated in ${Date.now() - proofStart}ms`);

        // Extract public inputs from proof result
        // The order matches the circuit's return statement:
        // (merkle_root, nullifier, authority_hash, epoch_id, campaign_id)
        return {
            proof,
            publicInputs: {
                merkleRoot: publicInputs[0] ?? inputs.merkleRoot,
                nullifier: publicInputs[1] ?? inputs.nullifier,
                authorityHash: publicInputs[2] ?? inputs.authorityHash,
                epochId: publicInputs[3] ?? inputs.epochId,
                campaignId: publicInputs[4] ?? inputs.campaignId,
            },
        };
    }

    /**
     * Verify a proof
     */
    async verify(proof: Uint8Array, publicInputs: string[]): Promise<boolean> {
        await this.init();
        return this.backend!.verifyProof({ proof, publicInputs });
    }

    /**
     * Clean up resources
     */
    async destroy(): Promise<void> {
        if (this.backend) {
            await this.backend.destroy();
            this.backend = null;
            this.noir = null;
        }
    }
}
