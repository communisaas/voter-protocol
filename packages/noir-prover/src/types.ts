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
/** @deprecated Single-tree layout. Use TWO_TREE_PUBLIC_INPUT_COUNT (29) or THREE_TREE_PUBLIC_INPUT_COUNT (31). */
export const PUBLIC_INPUT_COUNT = 5;

/**
 * Authority levels representing user verification tiers (range-checked by circuit to [1, 5]).
 * Semantic assignment is application-specific. In Communique:
 * - 1: Authenticated (OAuth-only, unverified)
 * - 2: Address-attested (location hint via civic data)
 * - 3: Identity-verified (ID card / drivers license)
 * - 4: Passport-verified (NFC passport scan)
 * - 5: Government credential (mDL / EUDIW)
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

/** @deprecated Single-tree config. Use TwoTreeProverConfig or ThreeTreeProverConfig. */
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
 * - nullifier = hash(userSecret, actionDomain)  [legacy single-tree; two-tree uses identityCommitment per NUL-001]
 *
 * This design prevents attackers from submitting arbitrary leaves or
 * nullifiers, as they must know the user's secret to generate valid proofs.
 */
/** @deprecated Single-tree inputs. Use TwoTreeProofInput or ThreeTreeProofInput. */
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
// Shared Protocol Constants
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Number of district slots per cell.
 *
 * Protocol constant — structurally embedded in the Noir circuit ([Field; 24]),
 * the Poseidon2 sponge (24/3 = 8 absorb rounds), and the on-chain verifier.
 * Not jurisdiction-specific. All jurisdictions use 24 slots; unused slots are 0n.
 */
export const DISTRICT_SLOT_COUNT = 24;

/**
 * Options for proof generation and verification.
 *
 * bb.js v2.1.8 supports two proof modes:
 * - Default (ZK + Poseidon2): Longer proofs (~508 fields). For off-chain verification only.
 * - Keccak (non-ZK + Keccak): Shorter proofs (~229 fields). Required for on-chain
 *   Solidity verifier generated by UltraHonkBackend.getSolidityVerifier().
 *
 * IMPORTANT: The keccak option MUST match between proof generation and verification,
 * and between the proof and the on-chain Solidity verifier.
 */
export interface ProofOptions {
    /**
     * Generate keccak-mode proof for on-chain verification.
     *
     * When true, produces a non-ZK proof using keccak hashing compatible with
     * the Solidity HonkVerifier generated by bb.js getSolidityVerifier().
     * When false (default), produces a ZK proof using Poseidon2 hashing for
     * off-chain verification only.
     */
    keccak?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Three-Tree Architecture Types (PRIMARY)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Engagement tiers representing user participation levels (range-checked by circuit to [0, 4]).
 * Derived from composite engagement score E per REPUTATION-ARCHITECTURE-SPEC.md Section 4.3:
 *   E = log2(1+actions) * (1+shannonH) * (1+sqrt(tenure/12)) * (1+log2(1+adoptions)/4)
 *   0: New         — E = 0 (no actions)
 *   1: Active      — E > 0
 *   2: Established — E >= 5.0
 *   3: Veteran     — E >= 12.0
 *   4: Pillar      — E >= 25.0
 * where shannonH = Shannon diversity index of action categories, stored as floor(H*1000).
 */
export type EngagementTier = 0 | 1 | 2 | 3 | 4;

/**
 * Validate that a number is a valid EngagementTier (integer 0-4)
 */
export function validateEngagementTier(tier: number): EngagementTier {
    if (tier < 0 || tier > 4 || !Number.isInteger(tier)) {
        throw new Error(`Invalid engagement tier: ${tier}. Must be integer 0-4.`);
    }
    return tier as EngagementTier;
}

/**
 * Configuration for the ThreeTreeNoirProver.
 */
export interface ThreeTreeProverConfig {
    /** Number of threads for proving (default: auto-detect) */
    threads?: number;

    /**
     * Merkle tree depth for circuit selection (default: 20)
     * All three trees use the same depth.
     */
    depth?: CircuitDepth;
}

// NOTE: ThreeTreeProofInput, ThreeTreeProofResult, and THREE_TREE_PUBLIC_INPUT_COUNT
// are defined after TwoTreeProofInput because ThreeTreeProofInput extends TwoTreeProofInput.
// See the "Three-Tree Proof Types" section below.

// ═══════════════════════════════════════════════════════════════════════════
// Two-Tree Architecture Types (DEPRECATED — use three-tree equivalents)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Number of public inputs in the two-tree circuit proof result.
 *
 * Derived from protocol constants:
 *   user_root(1) + cell_map_root(1) + districts(24) + nullifier(1) + action_domain(1) + authority_level(1) = 29
 *
 * This is a protocol constant, not jurisdiction-specific.
 *
 * @deprecated Use THREE_TREE_PUBLIC_INPUT_COUNT (31) for the primary three-tree architecture.
 */
export const TWO_TREE_PUBLIC_INPUT_COUNT = 2 + DISTRICT_SLOT_COUNT + 3;  // = 29

/**
 * Inputs required to generate a two-tree membership proof.
 *
 * The circuit verifies:
 * 1. User identity in Tree 1 (standard Merkle tree)
 * 2. Cell-to-district mapping in Tree 2 (sparse Merkle tree)
 * 3. Nullifier correctness (computed from identity_commitment + action_domain per NUL-001)
 * 4. Authority level range [1, 5]
 *
 * SECURITY:
 * - SA-011: user_secret must not be zero
 * - CVE-001/CVE-003: Leaves computed inside circuit from user_secret
 * - CVE-002: Nullifier uses only user_secret + public action_domain
 *
 * @deprecated Use ThreeTreeProofInput which extends this interface with engagement fields.
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
 *
 * @deprecated Use ThreeTreeProofResult (31 public inputs) for the primary three-tree architecture.
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
 *
 * @deprecated Use ThreeTreeProverConfig for the primary three-tree architecture.
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
// Three-Tree Proof Types (extend two-tree base)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Number of public inputs in the three-tree circuit proof result.
 *
 * Derived from protocol constants:
 *   user_root(1) + cell_map_root(1) + districts(24) + nullifier(1) + action_domain(1)
 *   + authority_level(1) + engagement_root(1) + engagement_tier(1) = 31
 */
export const THREE_TREE_PUBLIC_INPUT_COUNT = TWO_TREE_PUBLIC_INPUT_COUNT + 2;  // = 31

/**
 * Inputs required to generate a three-tree membership proof.
 *
 * Extends TwoTreeProofInput with Tree 3 (Engagement):
 * 1. User identity in Tree 1 (standard Merkle tree)
 * 2. Cell-to-district mapping in Tree 2 (sparse Merkle tree)
 * 3. Engagement data bound to identity in Tree 3 (standard Merkle tree)
 * 4. Nullifier correctness (identity_commitment + action_domain per NUL-001)
 * 5. Authority level range [1, 5] and engagement tier range [0, 4]
 *
 * CROSS-TREE IDENTITY BINDING:
 * A single identityCommitment feeds BOTH:
 * - Nullifier: H2(identityCommitment, actionDomain)
 * - Engagement leaf: H2(identityCommitment, H3(engagementTier, actionCount, diversityScore))
 *
 * NOTE: Extends TwoTreeProofInput — all two-tree fields (userRoot, cellMapRoot,
 * districts, nullifier, actionDomain, authorityLevel, witnesses, paths) are inherited.
 */
export interface ThreeTreeProofInput extends TwoTreeProofInput {
    // ═══════════════════════════════════════════════════════════════════════
    // PUBLIC INPUTS (additional to two-tree)
    // ═══════════════════════════════════════════════════════════════════════

    /** Root of Tree 3 (engagement Merkle tree) */
    engagementRoot: bigint;

    /** User's engagement tier (0-4). Range-checked by the circuit. */
    engagementTier: EngagementTier;

    // ═══════════════════════════════════════════════════════════════════════
    // PRIVATE INPUTS (additional to two-tree)
    // ═══════════════════════════════════════════════════════════════════════

    /** Tree 3 Merkle siblings from leaf to root (length = TREE_DEPTH) */
    engagementPath: bigint[];

    /** Leaf position in Tree 3 (determines left/right at each level) */
    engagementIndex: number;

    /** Number of verified on-chain actions (private witness) */
    actionCount: bigint;

    /** Topic diversity metric (private witness) */
    diversityScore: bigint;
}

/**
 * Result of three-tree proof generation.
 */
export interface ThreeTreeProofResult {
    /** Serialized proof bytes (UltraHonk format) */
    proof: Uint8Array;

    /**
     * Public inputs as hex strings, in circuit order.
     * Total count: 31 (THREE_TREE_PUBLIC_INPUT_COUNT)
     *
     * Layout:
     *   [0]     user_root
     *   [1]     cell_map_root
     *   [2-25]  districts[0..24]
     *   [26]    nullifier
     *   [27]    action_domain
     *   [28]    authority_level
     *   [29]    engagement_root
     *   [30]    engagement_tier
     */
    publicInputs: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Debate Weight Proof Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Number of public inputs in the debate_weight circuit.
 *
 * Derived from circuit layout:
 *   weighted_amount(1) + note_commitment(1) = 2
 *
 * This is a protocol constant — structurally embedded in the Noir circuit
 * and the on-chain DebateMarket verifier.
 */
export const DEBATE_WEIGHT_PUBLIC_INPUT_COUNT = 2;

/**
 * Inputs for generating a debate_weight proof.
 *
 * Proves: weightedAmount = floor(sqrt(stake)) * 2^tier
 * And binds: noteCommitment = H3(stake, tier, randomness)
 *
 * The prover computes sqrt_stake = floor(sqrt(stake)) off-circuit and passes
 * it as a witness; the circuit verifies the floor-sqrt relationship via:
 *   sqrt_stake^2 <= stake AND (sqrt_stake+1)^2 > stake
 *
 * SECURITY:
 * - stake is private: only weightedAmount is visible on-chain
 * - tier is private: only the computed weight leaks the tier indirectly
 * - note_commitment binds the position commitment without revealing inputs
 */
export interface DebateWeightProofInput {
    /**
     * USDC stake amount (6 decimals, e.g., 25_000_000n = $25).
     * Must be > 0 and < 2^64 (max $100 = 100_000_000n for DebateMarket).
     */
    stake: bigint;

    /**
     * Engagement tier (1-4). Tier 0 is rejected by the DebateMarket contract.
     * Determines the 2^tier multiplier in the weighting formula.
     */
    tier: 1 | 2 | 3 | 4;

    /**
     * Random 128-bit value for note commitment entropy.
     * Must be non-zero (prevents predictable note commitments).
     * Must be < BN254_MODULUS.
     */
    randomness: bigint;
}

/**
 * Result of debate_weight proof generation.
 */
export interface DebateWeightProofResult {
    /** Serialized proof bytes (UltraHonk format) */
    proof: Uint8Array;

    /**
     * Public inputs as hex strings, in circuit order.
     * Total count: 2 (DEBATE_WEIGHT_PUBLIC_INPUT_COUNT)
     *
     * Layout:
     *   [0]  weighted_amount  — floor(sqrt(stake)) * 2^tier
     *   [1]  note_commitment  — H3(stake, tier, randomness)
     */
    publicInputs: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Position Note Proof Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Number of public inputs in the position_note circuit.
 *
 * Derived from circuit layout:
 *   position_root(1) + nullifier(1) + debate_id(1) +
 *   winning_argument_index(1) + claimed_weighted_amount(1) = 5
 *
 * Layout (in circuit order — matches fn main parameter order):
 *   [0]  position_root           — Merkle root of the position tree
 *   [1]  nullifier               — H_PNL(nullifier_key, commitment, debate_id)
 *   [2]  debate_id               — identifies which debate this claim is for
 *   [3]  winning_argument_index  — resolution outcome (contract-controlled)
 *   [4]  claimed_weighted_amount — amount to be paid out
 */
export const POSITION_NOTE_PUBLIC_INPUT_COUNT = 5;

/**
 * Domain separation tag for position commitment hash.
 * Value: 0x50434d = "PCM" (Position Commitment Marker)
 *
 * Used in: permute([argument_index, weighted_amount, randomness, DOMAIN_POS_COMMIT])[0]
 * MUST NOT collide with H2M(0x48324d), H3M(0x48334d), H4M(0x48344d).
 *
 * Matches Noir circuit: global DOMAIN_POS_COMMIT: Field = 0x50434d
 */
export const DOMAIN_POS_COMMIT = 0x50434dn;  // "PCM"

/**
 * Domain separation tag for position nullifier hash.
 * Value: 0x504e4c = "PNL" (Position Nullifier)
 *
 * Used in: permute([nullifier_key, position_commitment, debate_id, DOMAIN_POS_NUL])[0]
 * MUST NOT collide with any other domain tag in the protocol.
 *
 * Matches Noir circuit: global DOMAIN_POS_NUL: Field = 0x504e4c
 */
export const DOMAIN_POS_NUL = 0x504e4cn;  // "PNL"

/**
 * Position tree depth (single variant, matches circuit global TREE_DEPTH = 20).
 * 2^20 = 1,048,576 position slots — adequate for large debate markets.
 */
export const POSITION_TREE_DEPTH = 20;

/**
 * Inputs for generating a position_note proof.
 *
 * Proves: prover owns a commitment in the position Merkle tree,
 * that commitment is on the winning argument, and issues a
 * one-time nullifier to prevent double-claim.
 *
 * SECURITY:
 * - randomness must be non-zero (prevents predictable commitments).
 * - nullifierKey must be non-zero (prevents predictable nullifiers).
 * - positionPath length must equal POSITION_TREE_DEPTH (20).
 * - positionIndex must be < 2^20 (range-checked in circuit).
 * - All bigint fields must be < BN254_MODULUS.
 */
export interface PositionNoteProofInput {
    // =========================================================================
    // PRIVATE INPUTS (witnesses, never revealed)
    // =========================================================================

    /**
     * Index of the argument this position is on.
     * Must match winningArgumentIndex (public) for the proof to succeed.
     */
    argumentIndex: bigint;

    /**
     * Weighted amount from the debate_weight proof.
     * Must match claimedWeightedAmount (public) for the proof to succeed.
     * Used by the contract for proportional payout calculation.
     */
    weightedAmount: bigint;

    /**
     * Random 128-bit value for position commitment entropy.
     * Must be non-zero. Must be < BN254_MODULUS.
     * Was generated at revealTrade time and kept private.
     */
    randomness: bigint;

    /**
     * User-secret key for nullifier derivation.
     * Must be non-zero. Must be < BN254_MODULUS.
     * Derived deterministically per user, preventing double-claim.
     */
    nullifierKey: bigint;

    /**
     * Merkle path siblings from commitment leaf to root.
     * Length must equal POSITION_TREE_DEPTH (20).
     * Provided by shadow-atlas PositionTreeBuilder.getProof().
     */
    positionPath: bigint[];

    /**
     * Leaf index in the position tree.
     * Determines left/right sibling selection at each Merkle level.
     * Must be < 2^POSITION_TREE_DEPTH (range-checked in circuit).
     */
    positionIndex: number;

    // =========================================================================
    // PUBLIC INPUTS (contract-controlled, visible on-chain)
    // =========================================================================

    /**
     * Root of the position Merkle tree (stored on-chain by shadow-atlas).
     * The contract verifies this matches its recorded root.
     */
    positionRoot: bigint;

    /**
     * Identifies which debate this settlement claim is for.
     * Included in nullifier to prevent cross-debate replay attacks.
     */
    debateId: bigint;

    /**
     * The winning argument index from resolution (contract-controlled).
     * The circuit verifies the private argumentIndex matches this.
     */
    winningArgumentIndex: bigint;
}

/**
 * Result of position_note proof generation.
 */
export interface PositionNoteProofResult {
    /** Serialized proof bytes (UltraHonk format) */
    proof: Uint8Array;

    /**
     * Public inputs as hex strings, in circuit order.
     * Total count: 5 (POSITION_NOTE_PUBLIC_INPUT_COUNT)
     *
     * Layout:
     *   [0]  position_root           — Merkle root of position tree
     *   [1]  nullifier               — H_PNL(nullifier_key, commitment, debate_id)
     *   [2]  debate_id               — debate identifier
     *   [3]  winning_argument_index  — resolution outcome
     *   [4]  claimed_weighted_amount — payout weight
     */
    publicInputs: string[];
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
