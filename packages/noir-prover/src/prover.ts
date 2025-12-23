/**
 * NoirProver - Browser-native ZK prover using Barretenberg
 *
 * Uses @noir-lang/noir_js for witness generation and @aztec/bb.js for proving.
 * Supports multithreaded proving when SharedArrayBuffer is available.
 */

import { UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import type { CompiledCircuit } from '@noir-lang/noir_js';
import type { ProverConfig, CircuitInputs, ProofResult } from './types';

// Import circuit JSON (contains bytecode + ABI)
import circuitJson from '../circuits/district_membership.json';

/**
 * Detect optimal thread count for proving
 * Returns 1 if SharedArrayBuffer is unavailable (no multithreading support)
 */
function detectThreads(): number {
    // Check for SharedArrayBuffer support (required for multithreading)
    const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';

    if (!hasSharedArrayBuffer) {
        console.log('[NoirProver] SharedArrayBuffer unavailable - using single-threaded mode');
        return 1;
    }

    // Use hardware concurrency, capped at reasonable limits
    const cores = typeof navigator !== 'undefined'
        ? navigator.hardwareConcurrency || 4
        : 4;

    // Cap at 8 threads - diminishing returns beyond this for ZK proving
    return Math.min(cores, 8);
}

export class NoirProver {
    private backend: UltraHonkBackend | null = null;
    private noir: Noir | null = null;
    private config: ProverConfig;
    private threads: number;

    constructor(config: ProverConfig = {}) {
        this.config = {
            circuitName: 'district_membership',
            ...config,
        };
        // Determine thread count: explicit config > auto-detect
        this.threads = config.threads ?? detectThreads();
    }

    /**
     * Initialize the prover (must be called before generating proofs)
     */
    async init(): Promise<void> {
        if (this.backend && this.noir) return; // Already initialized

        console.log(`[NoirProver] Initializing with ${this.threads} thread(s)...`);
        const start = Date.now();

        // Cast circuit JSON to CompiledCircuit type
        const circuit = circuitJson as unknown as CompiledCircuit;

        // Initialize Noir for witness generation
        this.noir = new Noir(circuit);

        // Initialize UltraHonk backend for proving with thread configuration
        // threads > 1 enables parallel proving using Web Workers internally
        this.backend = new UltraHonkBackend(circuit.bytecode, { threads: this.threads });

        console.log(`[NoirProver] Initialized in ${Date.now() - start}ms (${this.threads} threads)`);
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
