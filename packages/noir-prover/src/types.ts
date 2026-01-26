/**
 * Type definitions for NoirProver
 */

/**
 * Supported Merkle tree depths for circuit selection
 * - 18: Small municipal (~260K leaves)
 * - 20: State/large municipal (~1M leaves)
 * - 22: Federal (~4M leaves)
 * - 24: National (~16M leaves)
 */
export type CircuitDepth = 18 | 20 | 22 | 24;

/**
 * Default circuit depth when not specified
 */
export const DEFAULT_CIRCUIT_DEPTH: CircuitDepth = 20;

export interface ProverConfig {
    /** Circuit name (default: 'district_membership') */
    circuitName?: string;
    /** Custom circuit bytecode (optional) */
    bytecode?: Uint8Array;
    /**
     * Number of threads for proving (default: auto-detect via navigator.hardwareConcurrency)
     * Set to 1 for single-threaded proving (useful when SharedArrayBuffer is unavailable)
     * Requires COOP/COEP headers for multithreading in browsers
     */
    threads?: number;
    /**
     * Merkle tree depth for circuit selection (default: 20)
     * Different depths support different tree sizes:
     * - 18: ~260K leaves (small municipal)
     * - 20: ~1M leaves (state/large municipal)
     * - 22: ~4M leaves (federal)
     * - 24: ~16M leaves (national)
     */
    depth?: CircuitDepth;
}

export interface CircuitInputs {
    /** Merkle root of the district tree */
    merkleRoot: string;
    /** Nullifier for double-spend prevention */
    nullifier: string;
    /** Authority hash */
    authorityHash: string;
    /** Epoch ID */
    epochId: string;
    /** Campaign ID */
    campaignId: string;
    /** Leaf value (hashed address) */
    leaf: string;
    /** Merkle path (siblings) */
    merklePath: string[];
    /** Leaf index in tree */
    leafIndex: number;
    /** User secret for nullifier */
    userSecret: string;
}

export interface ProofResult {
    /** Serialized proof bytes */
    proof: Uint8Array;
    /** Public inputs */
    publicInputs: {
        merkleRoot: string;
        nullifier: string;
        authorityHash: string;
        epochId: string;
        campaignId: string;
    };
}
