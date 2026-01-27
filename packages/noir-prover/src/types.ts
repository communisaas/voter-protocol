/**
 * Type definitions for NoirProver
 *
 * SECURITY MODEL:
 * The circuit is designed to prevent information leakage while enabling
 * verifiable claims. Key security properties:
 *
 * 1. Leaf computation inside circuit: The leaf is computed as
 *    hash(userSecret, districtId, authorityLevel, registrationSalt)
 *    INSIDE the circuit, not passed in. This prevents attackers from
 *    submitting arbitrary leaves.
 *
 * 2. Nullifier derivation: The nullifier is computed as
 *    hash(userSecret, actionDomain) INSIDE the circuit, binding the
 *    user's identity to the specific action domain without revealing it.
 *
 * 3. Public outputs: The circuit reveals merkleRoot, nullifier,
 *    authorityLevel, actionDomain, and districtId - all necessary for
 *    on-chain verification without compromising user privacy.
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

/**
 * Authority levels representing user permission tiers
 * - 1: Basic voter
 * - 2: Verified voter
 * - 3: District delegate
 * - 4: Regional authority
 * - 5: System administrator
 */
export type AuthorityLevel = 1 | 2 | 3 | 4 | 5;

/**
 * Validate that a number is a valid AuthorityLevel (integer 1-5)
 *
 * @param level - The number to validate
 * @returns The validated AuthorityLevel
 * @throws Error if level is not an integer between 1 and 5
 */
export function validateAuthorityLevel(level: number): AuthorityLevel {
    if (level < 1 || level > 5 || !Number.isInteger(level)) {
        throw new Error(`Invalid authority level: ${level}. Must be integer 1-5.`);
    }
    return level as AuthorityLevel;
}

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

/**
 * Inputs required to generate a district membership proof
 *
 * The circuit computes internally:
 * - leaf = hash(userSecret, districtId, authorityLevel, registrationSalt)
 * - nullifier = hash(userSecret, actionDomain)
 *
 * This design prevents attackers from submitting arbitrary leaves or
 * nullifiers, as they must know the user's secret to generate valid proofs.
 */
export interface CircuitInputs {
    // ═══════════════════════════════════════════════════════════════════════
    // PUBLIC INPUTS (contract-controlled, visible on-chain)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Merkle root of the district membership tree.
     * Provided by the contract to ensure the proof is against the current state.
     * Format: hex string (0x-prefixed or raw)
     */
    merkleRoot: string;

    /**
     * Action domain identifier provided by the contract.
     * Replaces the previous epochId + campaignId fields.
     * Used in nullifier derivation: nullifier = hash(userSecret, actionDomain)
     * This binds each proof to a specific action, preventing replay across domains.
     * Format: hex string (0x-prefixed or raw)
     */
    actionDomain: string;

    // ═══════════════════════════════════════════════════════════════════════
    // PRIVATE INPUTS (user secrets, never revealed)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * User's secret key for nullifier generation and leaf computation.
     * MUST be kept secret - reveals user identity if exposed.
     * Used in: leaf = hash(userSecret, districtId, authorityLevel, registrationSalt)
     * Used in: nullifier = hash(userSecret, actionDomain)
     * Format: hex string (0x-prefixed or raw)
     */
    userSecret: string;

    /**
     * District identifier the user is proving membership in.
     * Part of the leaf preimage - ties the proof to a specific district.
     * Format: hex string (0x-prefixed or raw)
     */
    districtId: string;

    /**
     * User's authority tier (1-5).
     * Part of the leaf preimage and revealed as public output.
     * Allows contracts to enforce permission levels without knowing user identity.
     */
    authorityLevel: AuthorityLevel;

    /**
     * Salt value from user registration.
     * Part of the leaf preimage - adds entropy to prevent rainbow table attacks.
     * Format: hex string (0x-prefixed or raw)
     */
    registrationSalt: string;

    // ═══════════════════════════════════════════════════════════════════════
    // MERKLE PROOF DATA
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Merkle path siblings from leaf to root.
     * Array length must match circuit depth (18, 20, 22, or 24).
     * Format: array of hex strings (0x-prefixed or raw)
     */
    merklePath: string[];

    /**
     * Position of the user's leaf in the Merkle tree.
     * Used to determine left/right sibling selection during path verification.
     */
    leafIndex: number;
}

/**
 * Result of proof generation
 *
 * The public inputs match the circuit's return statement:
 * pub (merkle_root, nullifier, authority_level, action_domain, district_id)
 */
export interface ProofResult {
    /** Serialized proof bytes (UltraHonk format) */
    proof: Uint8Array;

    /**
     * Public inputs extracted from the proof.
     * These values are visible on-chain and can be verified by contracts.
     */
    publicInputs: {
        /**
         * Merkle root the proof was generated against.
         * Contract should verify this matches the current expected root.
         */
        merkleRoot: string;

        /**
         * Derived nullifier: hash(userSecret, actionDomain)
         * Used for double-action prevention within a domain.
         * Different for each actionDomain, preventing cross-domain tracking.
         */
        nullifier: string;

        /**
         * User's authority level (1-5).
         * Now public to allow contracts to enforce permission tiers.
         */
        authorityLevel: AuthorityLevel;

        /**
         * Action domain the proof is bound to.
         * Contract should verify this matches the expected action.
         */
        actionDomain: string;

        /**
         * District the user proved membership in.
         * Allows district-specific voting/actions.
         */
        districtId: string;
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// Legacy type aliases for migration period
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @deprecated Use CircuitInputs instead. This alias exists for migration.
 */
export type LegacyCircuitInputs = {
    merkleRoot: string;
    nullifier: string;
    authorityHash: string;
    epochId: string;
    campaignId: string;
    leaf: string;
    merklePath: string[];
    leafIndex: number;
    userSecret: string;
};
