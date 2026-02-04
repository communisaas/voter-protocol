/**
 * NoirProver Adapter for VOTER Client
 *
 * Adapts @voter-protocol/noir-prover to the client's expected interface.
 * Maps between client's DistrictProof type and NoirProver's ProofResult.
 *
 * Supports both single-tree (NoirProverAdapter) and two-tree
 * (TwoTreeNoirProverAdapter) proving architectures.
 */

import { NoirProver as CoreNoirProver } from '@voter-protocol/noir-prover';
import { TwoTreeNoirProver as CoreTwoTreeProver } from '@voter-protocol/noir-prover';
import type {
    CircuitInputs,
    ProofResult,
    CircuitDepth,
    TwoTreeProofInput,
    TwoTreeProofResult,
} from '@voter-protocol/noir-prover';
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
     * Verify a district proof
     *
     * SECURITY: This method throws NotImplementedError to prevent false sense of security.
     * Client-side verification should NOT be relied upon as the sole verification mechanism.
     * Always rely on on-chain verification via the DistrictGate contract.
     *
     * For local testing, use the NoirProver.verify() method from @voter-protocol/noir-prover
     * which provides actual cryptographic verification.
     *
     * @param _proof - District proof to verify
     * @throws Error Always - client verification should use on-chain or core prover
     */
    async verify(_proof: DistrictProof): Promise<boolean> {
        // CRITICAL-002 FIX: Throw error instead of returning true to prevent false positives
        // The previous implementation would indicate "valid" for ANY proof, including forged ones
        throw new Error(
            '[NoirProverAdapter] Client-side verification not implemented. ' +
            'Proof validity should be verified on-chain via DistrictGate contract. ' +
            'For local testing, use NoirProver.verify() from @voter-protocol/noir-prover directly.'
        );
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

// ============================================================================
// Two-Tree Architecture Adapter
// ============================================================================

/**
 * Two-tree proof inputs from the client side.
 *
 * These are the inputs the client collects from the Shadow Atlas service
 * and the user's wallet to generate a two-tree membership proof.
 */
export interface TwoTreeClientProofInputs {
    /** User's secret key material (from wallet) */
    userSecret: bigint;
    /** Census tract cell ID (from Shadow Atlas) */
    cellId: bigint;
    /** Registration salt (from registration record) */
    registrationSalt: bigint;

    /** Root of the user identity tree (from Shadow Atlas) */
    userRoot: bigint;
    /** Merkle siblings for the user tree (from Shadow Atlas) */
    userPath: bigint[];
    /** Leaf index in the user tree (from Shadow Atlas) */
    userIndex: number;

    /** Root of the cell-district mapping tree (from Shadow Atlas) */
    cellMapRoot: bigint;
    /** SMT siblings for the cell map tree (from Shadow Atlas) */
    cellMapPath: bigint[];
    /** SMT direction bits for the cell map tree (from Shadow Atlas) */
    cellMapPathBits: number[];

    /** All 24 district IDs for this cell (from Shadow Atlas) */
    districts: bigint[];

    /** Contract-controlled action scope */
    actionDomain: bigint;
    /** Pre-computed nullifier = hash(userSecret, actionDomain) */
    nullifier: bigint;
    /** User's authority tier (1-5) */
    authorityLevel: 1 | 2 | 3 | 4 | 5;
}

/**
 * Two-tree proof result formatted for the client.
 */
export interface TwoTreeClientProofResult {
    /** Raw proof bytes */
    proof: Uint8Array;
    /** All 29 public inputs as hex strings */
    publicInputs: string[];
    /** Proving metadata */
    metadata: {
        provingTimeMs: number;
        proofSizeBytes: number;
        circuitDepth: CircuitDepth;
    };
}

/**
 * Adapter for TwoTreeNoirProver that provides a client-friendly interface.
 *
 * Wraps the core TwoTreeNoirProver from @voter-protocol/noir-prover and
 * handles initialization, input mapping, and result formatting for the
 * client application.
 *
 * Usage:
 * ```typescript
 * const adapter = new TwoTreeNoirProverAdapter({ depth: 20 });
 * await adapter.init();
 *
 * const result = await adapter.prove(clientInputs);
 * // Submit result.proof + result.publicInputs to DistrictGate contract
 * ```
 */
export class TwoTreeNoirProverAdapter {
    private prover: CoreTwoTreeProver;
    private initPromise: Promise<void> | null = null;
    private readonly circuitDepth: CircuitDepth;

    constructor(config: { depth?: CircuitDepth; threads?: number } = {}) {
        this.circuitDepth = config.depth ?? 20;
        this.prover = new CoreTwoTreeProver({
            depth: this.circuitDepth,
            threads: config.threads,
        });
    }

    /**
     * Initialize the prover (idempotent).
     * Loads the circuit and initializes the Barretenberg backend.
     */
    async init(): Promise<void> {
        if (this.initPromise) {
            return this.initPromise;
        }
        this.initPromise = this.prover.init();
        return this.initPromise;
    }

    /**
     * Pre-warm the prover by initializing the backend.
     * Call this on app load to hide latency from the user.
     */
    async warmup(): Promise<void> {
        await this.prover.warmup();
    }

    /**
     * Generate a two-tree membership proof.
     *
     * @param inputs - Client-side proof inputs (from Shadow Atlas + wallet)
     * @returns Proof result with bytes, public inputs, and metadata
     */
    async prove(inputs: TwoTreeClientProofInputs): Promise<TwoTreeClientProofResult> {
        const startTime = Date.now();

        // Map client inputs to core prover inputs
        const coreInputs: TwoTreeProofInput = {
            userRoot: inputs.userRoot,
            cellMapRoot: inputs.cellMapRoot,
            districts: inputs.districts,
            nullifier: inputs.nullifier,
            actionDomain: inputs.actionDomain,
            authorityLevel: inputs.authorityLevel,

            userSecret: inputs.userSecret,
            cellId: inputs.cellId,
            registrationSalt: inputs.registrationSalt,
            userPath: inputs.userPath,
            userIndex: inputs.userIndex,
            cellMapPath: inputs.cellMapPath,
            cellMapPathBits: inputs.cellMapPathBits,
        };

        const result: TwoTreeProofResult = await this.prover.generateProof(coreInputs);
        const provingTimeMs = Date.now() - startTime;

        return {
            proof: result.proof,
            publicInputs: result.publicInputs,
            metadata: {
                provingTimeMs,
                proofSizeBytes: result.proof.length,
                circuitDepth: this.circuitDepth,
            },
        };
    }

    /**
     * Verify a two-tree proof.
     *
     * SECURITY: This method throws NotImplementedError to prevent false sense of security.
     * Client-side verification should NOT be relied upon as the sole verification mechanism.
     * Always rely on on-chain verification via the DistrictGate contract.
     *
     * For local testing, use TwoTreeNoirProver.verifyProof() from
     * @voter-protocol/noir-prover directly.
     *
     * @param _result - Proof result to verify
     * @throws Error Always - client verification should use on-chain or core prover
     */
    async verify(_result: TwoTreeClientProofResult): Promise<boolean> {
        throw new Error(
            '[TwoTreeNoirProverAdapter] Client-side verification not implemented. ' +
            'Proof validity should be verified on-chain via DistrictGate contract. ' +
            'For local testing, use TwoTreeNoirProver.verifyProof() from @voter-protocol/noir-prover directly.'
        );
    }

    /**
     * Get the circuit depth this adapter was configured with.
     */
    getDepth(): CircuitDepth {
        return this.circuitDepth;
    }

    /**
     * Clean up resources.
     */
    async destroy(): Promise<void> {
        await this.prover.destroy();
    }
}
