/**
 * NoirProver Adapter for VOTER Client
 *
 * Adapts @voter-protocol/noir-prover to the client's expected interface.
 * Maps between client's DistrictProof type and NoirProver's ProofResult.
 */

import { NoirProver as CoreNoirProver } from '@voter-protocol/noir-prover';
import type { CircuitInputs, ProofResult } from '@voter-protocol/noir-prover';
import type { DistrictProof, ProofInputs, MerkleProof } from './types';
import type { StreetAddress } from '../utils/addresses';

/**
 * Adapter for NoirProver that implements the client's expected interface
 */
export class NoirProverAdapter {
    private prover: CoreNoirProver;
    private initPromise: Promise<void> | null = null;

    constructor() {
        this.prover = new CoreNoirProver();
    }

    /**
     * Initialize the prover (idempotent)
     */
    async init(): Promise<void> {
        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = this.prover.init();
        return this.initPromise;
    }

    /**
     * Pre-warm the prover by generating the proving key
     */
    async warmup(): Promise<void> {
        await this.prover.warmup();
    }

    /**
     * Generate a district membership proof
     *
     * @param inputs - Proof inputs containing address and Merkle proof
     * @returns District proof compatible with client's DistrictProof type
     */
    async prove(inputs: ProofInputs): Promise<DistrictProof> {
        const startTime = Date.now();

        // Convert client's ProofInputs to NoirProver's CircuitInputs
        const circuitInputs = this.convertToCircuitInputs(inputs);

        // Generate proof using NoirProver
        const proofResult: ProofResult = await this.prover.prove(circuitInputs);

        // Convert ProofResult to DistrictProof
        const districtProof = this.convertToDistrictProof(
            proofResult,
            inputs.merkleProof,
            Date.now() - startTime
        );

        return districtProof;
    }

    /**
     * Verify a district proof (not yet implemented in NoirProver)
     *
     * @param _proof - District proof to verify
     * @returns True if proof is valid
     */
    async verify(_proof: DistrictProof): Promise<boolean> {
        // TODO: Implement verification when NoirProver adds verify() method
        // For now, return true as a placeholder
        console.warn('[NoirProverAdapter] Verification not yet implemented');
        return true;
    }

    /**
     * Convert client's ProofInputs to NoirProver's CircuitInputs
     */
    private convertToCircuitInputs(inputs: ProofInputs): CircuitInputs {
        const { address, merkleProof } = inputs;

        // Generate user secret (should be persistent per user in production)
        // For now, use a deterministic derivation from address
        const userSecret = this.deriveUserSecret(address);

        // Generate nullifier from user secret and other inputs
        const nullifier = this.generateNullifier(userSecret, merkleProof.leaf.hash);

        // Default values for epoch and campaign (should come from inputs in production)
        const epochId = '0x0000000000000000000000000000000000000000000000000000000000000000';
        const campaignId = '0x0000000000000000000000000000000000000000000000000000000000000000';
        const authorityHash = '0x0000000000000000000000000000000000000000000000000000000000000000';

        return {
            merkleRoot: merkleProof.root,
            nullifier,
            authorityHash,
            epochId,
            campaignId,
            leaf: merkleProof.leaf.hash,
            merklePath: merkleProof.path,
            leafIndex: merkleProof.pathIndices[0] || 0,
            userSecret,
        };
    }

    /**
     * Convert NoirProver's ProofResult to client's DistrictProof
     */
    private convertToDistrictProof(
        proofResult: ProofResult,
        merkleProof: MerkleProof,
        provingTimeMs: number
    ): DistrictProof {
        // Convert proof to Uint8Array if it isn't already
        const proofBytes = this.ensureUint8Array(proofResult.proof);

        return {
            proof: proofBytes,
            districtHash: merkleProof.leaf.hash,
            merkleRoot: proofResult.publicInputs.merkleRoot,
            publicSignals: [
                proofResult.publicInputs.merkleRoot,
                proofResult.publicInputs.nullifier,
                proofResult.publicInputs.authorityHash,
                proofResult.publicInputs.epochId,
                proofResult.publicInputs.campaignId,
            ],
            metadata: {
                provingTimeMs,
                proofSizeBytes: proofBytes.length,
            },
        };
    }

    /**
     * Derive user secret from address (deterministic)
     * In production, this should be stored securely per user
     */
    private deriveUserSecret(address: StreetAddress): string {
        // Simple deterministic derivation for now
        // TODO: Use proper key derivation in production
        // StreetAddress is a branded string, so we can use it directly
        const addressString = address as string;
        return '0x' + this.simpleHash(addressString).padStart(64, '0');
    }

    /**
     * Generate nullifier from user secret and leaf hash
     */
    private generateNullifier(userSecret: string, leafHash: string): string {
        // Simple nullifier generation
        // TODO: Use proper nullifier derivation in production
        return '0x' + this.simpleHash(userSecret + leafHash).padStart(64, '0');
    }

    /**
     * Simple hash function for deterministic values
     */
    private simpleHash(input: string): string {
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
            const char = input.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(16);
    }

    /**
     * Ensure value is a Uint8Array
     */
    private ensureUint8Array(value: unknown): Uint8Array {
        if (value instanceof Uint8Array) {
            return value;
        }
        if (Array.isArray(value)) {
            return new Uint8Array(value);
        }
        if (typeof value === 'string') {
            // Assume hex string
            const hex = value.startsWith('0x') ? value.slice(2) : value;
            const bytes = new Uint8Array(hex.length / 2);
            for (let i = 0; i < hex.length; i += 2) {
                bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
            }
            return bytes;
        }
        throw new Error(`Cannot convert ${typeof value} to Uint8Array`);
    }

    /**
     * Clean up resources
     */
    async destroy(): Promise<void> {
        await this.prover.destroy();
    }
}
