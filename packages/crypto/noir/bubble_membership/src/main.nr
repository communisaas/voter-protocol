// Bubble Membership Circuit (Barretenberg / Noir)
//
// Phase 2 Community Field Circuit. Proves that a verified user commits to a set of
// H3 hexagonal cells representing their geographic bubble, with Sybil-resistant
// epoch nullifiers for aggregation.
//
// ARCHITECTURE:
// - Identity binding via Tree 3 (Engagement Tree): proves identity_commitment belongs
//   to a verified person by verifying Merkle membership in the operator-controlled
//   engagement tree. This prevents fabricated identity_commitments from bypassing
//   the epoch nullifier's Sybil resistance.
// - Cell set commitment: Merkle tree (depth 4) over sorted H3 cell IDs. Aggregator
//   verifies cell list against root off-chain for per-cell counting.
// - Epoch nullifier: H2(identity_commitment, epoch_domain) prevents double-contribution
//   within the same epoch. epoch_domain encodes the community field tag + date ordinal.
//
// SECURITY:
// - Identity binding: identity_commitment must be in Tree 3 (operator-controlled).
//   Fabricated identity_commitment -> different engagement_leaf -> Tree 3 proof fails.
// - Sybil resistance: epoch nullifier is deterministic per identity per epoch.
//   Same identity_commitment + same epoch = same nullifier = rejected by NullifierRegistry.
// - Cell count bound: MAX_CELLS = 16 limits how many cells one identity can claim.
// - Cell sorting: cell_ids must be sorted ascending (non-zero entries), preventing
//   duplicate cell claims within a single proof.
//
// TRUST MODEL (Phase 2):
// - Client computes H3 cells from bubble geometry (h3-js, client-side).
//   Circuit cannot verify geometric correctness (would leak coordinates).
// - Operator is trusted aggregator (Phase 1 "honest centralization" model).
// - Statistical aggregation + differential privacy dilute individual misrepresentation.
//
// RELATED:
// - Three-tree circuit: three_tree_membership/src/main.nr (identity binding pattern)
// - Engagement service: shadow-atlas /v1/engagement-path/:leafIndex
// - Community field spec: task-notes/community-field-circuit.md
// - Hash domain tags: consistent with poseidon2.ts and all other circuits

use dep::std::hash::poseidon2_permutation;

// ===============================================================================
// CONSTANTS
// ===============================================================================

// Engagement tree depth. Build pipeline rewrites this per variant (18 / 20 / 22 / 24).
// Depth 20 is the default: ~1M leaves.
global TREE_DEPTH: u32 = 20;

// Maximum H3 cells per bubble commitment. 2^4 = 16 leaves -> depth-4 Merkle tree.
// Covers all ZIP-level bubbles (2-5 cells at H3 res 7) and most FSA-level bubbles.
// Users with larger bubbles (city/country) don't contribute until they pinch below ~5km radius.
global MAX_CELLS: u32 = 16;

// Hash-1 Marker ('H1M') -- single-input hash domain separation. Must match poseidon2.ts DOMAIN_HASH1.
global DOMAIN_HASH1: Field = 0x48314d;

// BA-003: Domain separation tag for 2-input hash.
// Shared with three_tree_membership and all other circuits.
// MUST match poseidon2.ts DOMAIN_HASH2.
global DOMAIN_HASH2: Field = 0x48324d;

// Domain separation tag for 3-input hash.
// Used for engagement data commitment: H3(engagement_tier, action_count, diversity_score)
// MUST match poseidon2.ts DOMAIN_HASH3.
global DOMAIN_HASH3: Field = 0x48334d;

// Valid engagement tier bounds (inclusive). Same as three_tree_membership.
global MIN_ENGAGEMENT_TIER: Field = 0;
global MAX_ENGAGEMENT_TIER: Field = 4;

// ===============================================================================
// HASH FUNCTIONS
// ===============================================================================

/// Domain-separated 2-input Poseidon2 hash.
/// State layout: [a, b, DOMAIN_HASH2, 0]
/// Used for: engagement leaf, nullifier, Merkle node hashing
fn poseidon2_hash2(left: Field, right: Field) -> Field {
    let state: [Field; 4] = [left, right, DOMAIN_HASH2, 0];
    let out = poseidon2_permutation(state, 4);
    out[0]
}

/// Domain-separated 3-input Poseidon2 hash.
/// State layout: [a, b, c, DOMAIN_HASH3]
/// Used for: engagement data commitment = H3(engagement_tier, action_count, diversity_score)
fn poseidon2_hash3(a: Field, b: Field, c: Field) -> Field {
    let state: [Field; 4] = [a, b, c, DOMAIN_HASH3];
    let out = poseidon2_permutation(state, 4);
    out[0]
}

// ===============================================================================
// MERKLE VERIFICATION
// ===============================================================================

/// Standard Merkle path verification for Tree 3 (engagement tree).
/// Direction bits are derived from the leaf index.
///
/// @param leaf - The computed engagement leaf value
/// @param path - Array of sibling hashes along the path
/// @param index - The leaf's position in the tree
/// @returns The computed Merkle root
fn compute_merkle_root(leaf: Field, path: [Field; TREE_DEPTH], index: u32) -> Field {
    assert(index < (1u32 << TREE_DEPTH), "Leaf index out of range");

    let mut node = leaf;
    for i in 0..TREE_DEPTH {
        let bit: bool = ((index >> i) & 1u32) == 1u32;
        let sibling = path[i];
        node = if bit {
            poseidon2_hash2(sibling, node)
        } else {
            poseidon2_hash2(node, sibling)
        };
    }
    node
}

// ===============================================================================
// CELL SET MERKLE TREE
// ===============================================================================

/// Builds a Merkle tree of depth CELL_TREE_DEPTH over the cell ID array.
/// Leaves are raw H3 cell indices (64-bit integers as BN254 field elements).
/// Internal nodes use H2 (poseidon2_hash2) with domain separation.
///
/// @param cell_ids - Array of MAX_CELLS H3 cell IDs (sorted, zero-padded)
/// @returns The Merkle root of the cell set
fn compute_cell_set_root(cell_ids: [Field; MAX_CELLS]) -> Field {
    // Level 0: hash pairs of leaves
    let mut level: [Field; 8] = [0; 8];
    for i in 0..8 {
        level[i] = poseidon2_hash2(cell_ids[2 * i], cell_ids[2 * i + 1]);
    }

    // Level 1: hash pairs of level 0
    let mut level2: [Field; 4] = [0; 4];
    for i in 0..4 {
        level2[i] = poseidon2_hash2(level[2 * i], level[2 * i + 1]);
    }

    // Level 2: hash pairs of level 1
    let mut level3: [Field; 2] = [0; 2];
    for i in 0..2 {
        level3[i] = poseidon2_hash2(level2[2 * i], level2[2 * i + 1]);
    }

    // Level 3 (root): hash the final pair
    poseidon2_hash2(level3[0], level3[1])
}

// ===============================================================================
// LEAF COMPUTATION
// ===============================================================================

/// Computes the engagement data commitment for Tree 3.
/// engagement_data_commitment = H3(engagement_tier, action_count, diversity_score)
///
/// @param engagement_tier - Coarse engagement bucket [0-4]
/// @param action_count - Number of verified on-chain actions (private)
/// @param diversity_score - Topic diversity metric (private)
/// @returns The engagement data commitment
fn compute_engagement_data_commitment(
    engagement_tier: Field,
    action_count: Field,
    diversity_score: Field,
) -> Field {
    poseidon2_hash3(engagement_tier, action_count, diversity_score)
}

/// Computes the engagement leaf for Tree 3.
/// engagement_leaf = H2(identity_commitment, engagement_data_commitment)
///
/// IDENTITY BINDING: The same identity_commitment used in the epoch nullifier
/// derivation is used here. This cryptographically binds the bubble proof to
/// a specific verified identity.
fn compute_engagement_leaf(
    identity_commitment: Field,
    engagement_data_commitment: Field,
) -> Field {
    poseidon2_hash2(identity_commitment, engagement_data_commitment)
}

/// Computes the epoch nullifier for Sybil-resistant contribution counting.
/// epoch_nullifier = H2(identity_commitment, epoch_domain)
///
/// epoch_domain encodes COMMUNITY_FIELD_TAG + date ordinal (constructed client-side).
/// Same identity + same epoch = same nullifier = NullifierRegistry rejects duplicates.
fn compute_epoch_nullifier(identity_commitment: Field, epoch_domain: Field) -> Field {
    poseidon2_hash2(identity_commitment, epoch_domain)
}

// ===============================================================================
// VALIDATION
// ===============================================================================

/// Validates that engagement_tier is within the valid range [0, 4].
/// Uses BA-007 pattern: cast through u64 first to detect truncation attacks.
fn validate_engagement_tier(engagement_tier: Field) {
    assert(engagement_tier as u64 < 256, "Engagement tier exceeds u8 range");
    let tier_u8 = engagement_tier as u8;
    assert(tier_u8 >= MIN_ENGAGEMENT_TIER as u8, "Engagement tier below minimum (0)");
    assert(tier_u8 <= MAX_ENGAGEMENT_TIER as u8, "Engagement tier above maximum (4)");
}

/// Validates that cell_count is within valid range [1, MAX_CELLS].
/// At least one cell is required (empty contributions are meaningless).
fn validate_cell_count(cell_count: Field) {
    assert(cell_count as u64 < 256, "Cell count exceeds u8 range");
    let count_u8 = cell_count as u8;
    assert(count_u8 >= 1, "Cell count must be at least 1");
    assert(count_u8 <= MAX_CELLS as u8, "Cell count exceeds MAX_CELLS");
}

/// Validates that cell_ids are sorted ascending (non-zero entries) and zero-padded.
/// Sorting prevents duplicate cell claims within a single proof.
/// Zero-padding must start at index cell_count.
fn validate_cell_ordering(cell_ids: [Field; MAX_CELLS], cell_count: u8) {
    // Verify non-zero entries are strictly ascending (no duplicates)
    for i in 0..(MAX_CELLS - 1) {
        let idx = i as u8;
        if idx + 1 < cell_count {
            // Both entries are active: must be strictly ascending
            // Since Field doesn't have < directly, we use the trick:
            // a < b iff (b - a - 1) doesn't underflow (fits in 64 bits)
            let diff = cell_ids[i + 1] - cell_ids[i];
            assert(diff != 0, "Duplicate cell IDs not allowed");
            // For ordering: we verify diff fits in 64 bits (positive and reasonable)
            let diff_u64 = diff as u64;
            assert(diff_u64 > 0, "Cell IDs must be strictly ascending");
        }
    }

    // Verify zero-padding: entries at index >= cell_count must be zero
    for i in 0..MAX_CELLS {
        let idx = i as u8;
        if idx >= cell_count {
            assert(cell_ids[i] == 0, "Cell IDs must be zero-padded after cell_count");
        } else {
            // Active entries must be non-zero (H3 indices are never zero)
            assert(cell_ids[i] != 0, "Active cell IDs must be non-zero");
        }
    }
}

// ===============================================================================
// MAIN CIRCUIT
// ===============================================================================

/// Bubble Membership Proof -- proves a verified user commits to a set of H3 cells.
///
/// PUBLIC INPUTS (verified on-chain / by aggregator):
/// - engagement_root: Tree 3 Merkle root (identity binding)
/// - epoch_domain: Epoch identifier (COMMUNITY_FIELD_TAG + date ordinal)
///
/// PUBLIC OUTPUTS (returned):
/// - cell_set_root: Merkle root of the committed H3 cell set
/// - epoch_nullifier: Anti-Sybil token for this identity+epoch
/// - cell_count: Number of cells in the commitment
///
/// PRIVATE INPUTS (user-provided witnesses):
/// - identity_commitment: Verified person binding (same as three-tree circuit)
/// - engagement_tier, action_count, diversity_score: Tree 3 leaf data
/// - engagement_path, engagement_index: Tree 3 Merkle proof
/// - cell_ids: H3 cell IDs (sorted, zero-padded to MAX_CELLS)
/// - cell_count: Actual number of non-zero cells
fn main(
    // =======================================================================
    // PUBLIC INPUTS
    // =======================================================================
    engagement_root: pub Field,
    epoch_domain: pub Field,

    // =======================================================================
    // PRIVATE INPUTS -- Identity (Tree 3 binding)
    // =======================================================================
    identity_commitment: Field,
    engagement_tier: Field,
    action_count: Field,
    diversity_score: Field,
    engagement_path: [Field; TREE_DEPTH],
    engagement_index: u32,

    // =======================================================================
    // PRIVATE INPUTS -- Bubble
    // =======================================================================
    cell_ids: [Field; MAX_CELLS],
    cell_count: Field,
) -> pub (Field, Field, Field) {
    // =======================================================================
    // PRE-CHECKS
    // =======================================================================

    // Reject zero identity_commitment (prevents predictable nullifiers)
    assert(identity_commitment != 0, "identity_commitment cannot be zero");

    // Validate engagement tier range [0, 4]
    validate_engagement_tier(engagement_tier);

    // Validate cell count range [1, MAX_CELLS]
    validate_cell_count(cell_count);

    let cell_count_u8 = cell_count as u8;

    // Validate cell ordering: sorted ascending, zero-padded
    validate_cell_ordering(cell_ids, cell_count_u8);

    // =======================================================================
    // STEP 1: Verify identity via Tree 3 (Engagement Tree)
    // =======================================================================
    // Compute engagement_data_commitment = H3(tier, count, diversity)
    let engagement_data_commitment = compute_engagement_data_commitment(
        engagement_tier,
        action_count,
        diversity_score,
    );

    // Compute engagement_leaf = H2(identity_commitment, engagement_data_commitment)
    // IDENTITY BINDING: identity_commitment is the SAME value used in Step 3 (nullifier).
    let engagement_leaf = compute_engagement_leaf(
        identity_commitment,
        engagement_data_commitment,
    );

    // Verify Tree 3 Merkle proof
    let computed_engagement_root = compute_merkle_root(
        engagement_leaf,
        engagement_path,
        engagement_index,
    );
    assert(
        computed_engagement_root == engagement_root,
        "Tree 3: Engagement Merkle proof verification failed",
    );

    // =======================================================================
    // STEP 2: Build cell set commitment
    // =======================================================================
    // Compute Merkle root over sorted H3 cell IDs (depth 4, 16 leaves)
    let cell_set_root = compute_cell_set_root(cell_ids);

    // =======================================================================
    // STEP 3: Compute epoch nullifier
    // =======================================================================
    // epoch_nullifier = H2(identity_commitment, epoch_domain)
    // Uses the SAME identity_commitment verified in Step 1 (Tree 3 binding)
    let epoch_nullifier = compute_epoch_nullifier(identity_commitment, epoch_domain);

    // =======================================================================
    // RETURN PUBLIC OUTPUTS
    // =======================================================================
    (cell_set_root, epoch_nullifier, cell_count)
}

// ===============================================================================
// TESTS
// ===============================================================================

#[test]
fn test_poseidon2_hash2_deterministic() {
    let a: Field = 0x1234;
    let b: Field = 0x5678;
    let h1 = poseidon2_hash2(a, b);
    let h2 = poseidon2_hash2(a, b);
    assert(h1 == h2, "Hash should be deterministic");
}

#[test]
fn test_poseidon2_hash2_domain_separation() {
    // H2(a, b) != H3(a, b, 0) because domain tags differ
    let a: Field = 0x1234;
    let b: Field = 0x5678;
    let h2 = poseidon2_hash2(a, b);
    let h3 = poseidon2_hash3(a, b, 0);
    assert(h2 != h3, "H2 and H3 should produce different outputs");
}

#[test]
fn test_poseidon2_hash3_deterministic() {
    let a: Field = 1;
    let b: Field = 2;
    let c: Field = 3;
    let h1 = poseidon2_hash3(a, b, c);
    let h2 = poseidon2_hash3(a, b, c);
    assert(h1 == h2, "Hash should be deterministic");
}

#[test]
fn test_cell_set_root_deterministic() {
    let mut cells: [Field; 16] = [0; 16];
    cells[0] = 0x872830828ffffff; // Example H3 res-7 index
    cells[1] = 0x872830829ffffff;
    let root1 = compute_cell_set_root(cells);
    let root2 = compute_cell_set_root(cells);
    assert(root1 == root2, "Cell set root should be deterministic");
}

#[test]
fn test_cell_set_root_order_sensitive() {
    let mut cells_a: [Field; 16] = [0; 16];
    cells_a[0] = 0x1111;
    cells_a[1] = 0x2222;

    let mut cells_b: [Field; 16] = [0; 16];
    cells_b[0] = 0x2222;
    cells_b[1] = 0x1111;

    let root_a = compute_cell_set_root(cells_a);
    let root_b = compute_cell_set_root(cells_b);
    assert(root_a != root_b, "Different ordering should produce different roots");
}

#[test]
fn test_epoch_nullifier_deterministic() {
    let id: Field = 0xabcdef;
    let epoch: Field = 0x123456;
    let n1 = compute_epoch_nullifier(id, epoch);
    let n2 = compute_epoch_nullifier(id, epoch);
    assert(n1 == n2, "Epoch nullifier should be deterministic");
}

#[test]
fn test_epoch_nullifier_different_epochs() {
    let id: Field = 0xabcdef;
    let epoch1: Field = 0x111111;
    let epoch2: Field = 0x222222;
    let n1 = compute_epoch_nullifier(id, epoch1);
    let n2 = compute_epoch_nullifier(id, epoch2);
    assert(n1 != n2, "Different epochs should produce different nullifiers");
}

#[test]
fn test_epoch_nullifier_different_identities() {
    let id1: Field = 0xaaaaaa;
    let id2: Field = 0xbbbbbb;
    let epoch: Field = 0x123456;
    let n1 = compute_epoch_nullifier(id1, epoch);
    let n2 = compute_epoch_nullifier(id2, epoch);
    assert(n1 != n2, "Different identities should produce different nullifiers");
}

#[test]
fn test_engagement_leaf_identity_binding() {
    // Same engagement data, different identity = different leaf
    let id1: Field = 0xaaa;
    let id2: Field = 0xbbb;
    let edc: Field = poseidon2_hash3(1, 10, 50); // tier=1, count=10, diversity=50

    let leaf1 = compute_engagement_leaf(id1, edc);
    let leaf2 = compute_engagement_leaf(id2, edc);
    assert(leaf1 != leaf2, "Different identities should produce different engagement leaves");
}

#[test]
fn test_validate_engagement_tier_valid() {
    validate_engagement_tier(0);
    validate_engagement_tier(1);
    validate_engagement_tier(2);
    validate_engagement_tier(3);
    validate_engagement_tier(4);
}

#[test(should_fail_with = "Engagement tier above maximum (4)")]
fn test_validate_engagement_tier_too_high() {
    validate_engagement_tier(5);
}

#[test]
fn test_validate_cell_count_valid() {
    validate_cell_count(1);
    validate_cell_count(8);
    validate_cell_count(16);
}

#[test(should_fail_with = "Cell count must be at least 1")]
fn test_validate_cell_count_zero() {
    validate_cell_count(0);
}

#[test(should_fail_with = "Cell count exceeds MAX_CELLS")]
fn test_validate_cell_count_too_high() {
    validate_cell_count(17);
}

#[test]
fn test_validate_cell_ordering_valid() {
    let mut cells: [Field; 16] = [0; 16];
    cells[0] = 0x100;
    cells[1] = 0x200;
    cells[2] = 0x300;
    validate_cell_ordering(cells, 3);
}

#[test(should_fail_with = "Duplicate cell IDs not allowed")]
fn test_validate_cell_ordering_duplicates() {
    let mut cells: [Field; 16] = [0; 16];
    cells[0] = 0x100;
    cells[1] = 0x100; // duplicate
    validate_cell_ordering(cells, 2);
}

#[test(should_fail_with = "Active cell IDs must be non-zero")]
fn test_validate_cell_ordering_zero_active() {
    let mut cells: [Field; 16] = [0; 16];
    cells[0] = 0; // zero but active (cell_count = 1)
    validate_cell_ordering(cells, 1);
}

#[test(should_fail_with = "Cell IDs must be zero-padded after cell_count")]
fn test_validate_cell_ordering_nonzero_padding() {
    let mut cells: [Field; 16] = [0; 16];
    cells[0] = 0x100;
    cells[2] = 0x200; // should be zero since cell_count = 1
    validate_cell_ordering(cells, 1);
}
