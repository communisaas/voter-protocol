/**
 * Type definitions for NoirProver
 *
 * SECURITY MODEL:
 * The circuit is designed to prevent information leakage while enabling
 * verifiable claims. Key security properties:
 *
 * 1. Leaf computation inside circuit (two-tree): The user leaf is computed as
 *    hash4(userSecret, cellId, registrationSalt, authorityLevel) INSIDE the
 *    circuit, not passed in. This prevents attackers from submitting arbitrary
 *    leaves and cryptographically binds authority level (BR5-001).
 *
 * 2. Nullifier derivation (NUL-001): The nullifier is computed as
 *    hash2(identityCommitment, actionDomain) INSIDE the circuit. Using
 *    identityCommitment (deterministic per verified person from self.xyz/didit)
 *    instead of userSecret prevents Sybil attacks via re-registration.
 *
 * 3. Public outputs: The circuit reveals userRoot, cellMapRoot, districts[24],
 *    nullifier, actionDomain, and authorityLevel — all necessary for on-chain
 *    verification without compromising user privacy.
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
 * Number of public inputs in the single-tree circuit proof result.
 *
 * Public inputs layout (in circuit order):
 *   merkle_root        (1)
 *   nullifier          (1)
 *   authority_level    (1)
 *   action_domain      (1)
 *   district_id        (1)
 *   ───────────────────────
 *   Total:             5
 */
export const PUBLIC_INPUT_COUNT = 5;

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
// Two-Tree Architecture Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Number of district slots per cell in the 24-slot registration model.
 * Per DISTRICT-TAXONOMY.md:
 *   Slots 0-6:   Core governance (federal through municipal)
 *   Slots 7-10:  Education districts
 *   Slots 11-16: Core special districts
 *   Slots 17-19: Extended special districts
 *   Slots 20-21: Administrative boundaries
 *   Slots 22-23: Overflow/international
 */
export const DISTRICT_SLOT_COUNT = 24;

/**
 * Number of public inputs in the two-tree circuit proof result.
 *
 * Public inputs layout (in circuit order):
 *   user_root          (1)
 *   cell_map_root      (1)
 *   districts          (24)
 *   nullifier          (1)
 *   action_domain      (1)
 *   authority_level     (1)
 *   ───────────────────────
 *   Total:             29
 */
export const TWO_TREE_PUBLIC_INPUT_COUNT = 29;

/**
 * Inputs required to generate a two-tree membership proof.
 *
 * The circuit verifies:
 * 1. User identity in Tree 1 (standard Merkle tree)
 * 2. Cell-to-district mapping in Tree 2 (sparse Merkle tree)
 * 3. Nullifier correctness (computed from user_secret + action_domain)
 * 4. Authority level range [1, 5]
 *
 * SECURITY:
 * - SA-011: user_secret must not be zero
 * - CVE-001/CVE-003: Leaves computed inside circuit from user_secret
 * - CVE-002: Nullifier uses only user_secret + public action_domain
 */
export interface TwoTreeProofInput {
    // ═══════════════════════════════════════════════════════════════════════
    // PUBLIC INPUTS (contract-controlled, visible on-chain)
    // ═══════════════════════════════════════════════════════════════════════

    /** Root of Tree 1 (user identity Merkle tree) */
    userRoot: bigint;

    /** Root of Tree 2 (cell-district mapping sparse Merkle tree) */
    cellMapRoot: bigint;

    /** All 24 district IDs for this cell. Unused slots MUST be 0n. */
    districts: bigint[];

    /** Anti-double-vote nullifier = H2(identity_commitment, action_domain) (NUL-001) */
    nullifier: bigint;

    /** Contract-controlled action scope for nullifier derivation */
    actionDomain: bigint;

    /** User's voting tier (1-5). Range-checked by the circuit. */
    authorityLevel: AuthorityLevel;

    // ═══════════════════════════════════════════════════════════════════════
    // PRIVATE INPUTS (user-provided witnesses, never revealed)
    // ═══════════════════════════════════════════════════════════════════════

    /** User's secret key material. Must be non-zero (SA-011). */
    userSecret: bigint;

    /** Census tract cell ID the user is registered in */
    cellId: bigint;

    /** Random salt assigned during registration */
    registrationSalt: bigint;

    /**
     * Identity commitment from self.xyz/didit verification provider.
     * Used for nullifier: nullifier = H2(identityCommitment, actionDomain) (NUL-001).
     * Deterministic per verified person — prevents Sybil via re-registration.
     * Must be non-zero.
     */
    identityCommitment: bigint;

    /** Tree 1 Merkle siblings from leaf to root (length = TREE_DEPTH) */
    userPath: bigint[];

    /** Leaf position in Tree 1 (determines left/right at each level) */
    userIndex: number;

    /** Tree 2 SMT siblings from leaf to root (length = TREE_DEPTH) */
    cellMapPath: bigint[];

    /** Tree 2 SMT direction bits at each level: 0 = left, 1 = right */
    cellMapPathBits: number[];
}

/**
 * Result of two-tree proof generation.
 */
export interface TwoTreeProofResult {
    /** Serialized proof bytes (UltraHonk format) */
    proof: Uint8Array;

    /**
     * Public inputs as hex strings, in circuit order.
     * Total count: 29 (TWO_TREE_PUBLIC_INPUT_COUNT)
     *
     * Layout:
     *   [0]     user_root
     *   [1]     cell_map_root
     *   [2-25]  districts[0..24]
     *   [26]    nullifier
     *   [27]    action_domain
     *   [28]    authority_level
     */
    publicInputs: string[];
}

/**
 * Configuration for the TwoTreeNoirProver.
 */
export interface TwoTreeProverConfig {
    /** Number of threads for proving (default: auto-detect) */
    threads?: number;

    /**
     * Merkle tree depth for circuit selection (default: 20)
     * Both Tree 1 and Tree 2 use the same depth.
     */
    depth?: CircuitDepth;
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
