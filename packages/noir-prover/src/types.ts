/**
 * Type definitions for NoirProver
 */

export interface ProverConfig {
    /** Circuit name (default: 'district_membership') */
    circuitName?: string;
    /** Custom circuit bytecode (optional) */
    bytecode?: Uint8Array;
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
