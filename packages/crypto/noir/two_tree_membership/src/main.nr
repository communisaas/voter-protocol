// Two-Tree Membership Circuit (Barretenberg / Noir)
//
// Proves that a user belongs to a geographic cell (Tree 1) that maps to a specific
// set of 24 districts (Tree 2). This is the core circuit for the two-tree architecture
// described in TWO-TREE-ARCHITECTURE-SPEC.md Section 4.
//
// ARCHITECTURE:
// - Tree 1 (User Tree): Standard Merkle tree mapping user identity to a cell.
//   Leaf = H4(user_secret, cell_id, registration_salt, authority_level)
//   Authority level is cryptographically bound to the leaf (BR5-001/BR5-004).
// - Tree 2 (Cell Map): Sparse Merkle tree mapping cells to district commitments.
//   Leaf = H2(cell_id, district_commitment)
//   where district_commitment = poseidon2_sponge_24(districts)
//
// SECURITY:
// - SA-011: user_secret cannot be zero (prevents predictable nullifiers)
// - NUL-001: nullifier uses identity_commitment (not user_secret) to prevent Sybil
// - ISSUE-006: authority_level range-checked to [1, 5]
// - BR5-001: authority_level bound into leaf hash (H4) — can't upgrade without re-registration
// - CVE-001/CVE-003: Leaves computed inside circuit from user_secret
// - BA-003: Domain separation tags prevent cross-arity hash collisions
// - BA-007: Authority level cast through u64 to prevent truncation attacks

use dep::std::hash::poseidon2_permutation;

// Import sponge module for district commitment
mod sponge;
use sponge::poseidon2_sponge_24;

// ===============================================================================
// CONSTANTS
// ===============================================================================

// Default tree depth. Build pipeline rewrites this per variant (18 / 20 / 22 / 24).
// Depth 20 is the default: ~1M leaves, suitable for UK constituencies, medium countries.
// Valid depths: 18 (260K), 20 (1M), 22 (4M), 24 (16M)
global TREE_DEPTH: u32 = 20;

// Valid authority level bounds (inclusive)
global MIN_AUTHORITY_LEVEL: Field = 1;
global MAX_AUTHORITY_LEVEL: Field = 5;

// BA-003: Domain separation tag for 2-input hash.
// Prevents cross-arity collisions: poseidon2_hash2(a, b) cannot equal
// poseidon2_hash4(a, b, 0, 0) because the third state element is 0x48324d
// ("H2M" = Hash-2 Marker) instead of 0.
// MUST match district_membership circuit for nullifier compatibility.
global DOMAIN_HASH2: Field = 0x48324d;

// Domain separation tag for 3-input hash (legacy, kept for test compatibility).
// Value: 0x48334d = "H3M" (Hash-3 Marker)
global DOMAIN_HASH3: Field = 0x48334d;

// Domain separation tag for 4-input hash (BR5-001).
// Used for user leaf computation: H4(user_secret, cell_id, registration_salt, authority_level).
// Uses 2-round sponge construction (rate=3, capacity=1) because width-4 Poseidon2
// cannot fit 4 inputs + domain tag in a single permutation.
// Value: 0x48344d = "H4M" (Hash-4 Marker), following the pattern:
//   DOMAIN_HASH1 = 0x48314d ("H1M")
//   DOMAIN_HASH2 = 0x48324d ("H2M")
//   DOMAIN_HASH3 = 0x48334d ("H3M")
//   DOMAIN_HASH4 = 0x48344d ("H4M")
// MUST match poseidon2.ts DOMAIN_HASH4 for cross-language parity.
global DOMAIN_HASH4: Field = 0x48344d;

// ===============================================================================
// HASH FUNCTIONS
// ===============================================================================

/// Domain-separated 2-input Poseidon2 hash.
/// State layout: [a, b, DOMAIN_HASH2, 0]
/// Used for: cell map leaf, nullifier, Merkle node hashing
fn poseidon2_hash2(left: Field, right: Field) -> Field {
    let state: [Field; 4] = [left, right, DOMAIN_HASH2, 0];
    let out = poseidon2_permutation(state, 4);
    out[0]
}

/// Domain-separated 3-input Poseidon2 hash (legacy, kept for test compatibility).
/// State layout: [a, b, c, DOMAIN_HASH3]
fn poseidon2_hash3(a: Field, b: Field, c: Field) -> Field {
    let state: [Field; 4] = [a, b, c, DOMAIN_HASH3];
    let out = poseidon2_permutation(state, 4);
    out[0]
}

/// Domain-separated 4-input Poseidon2 hash (BR5-001).
/// Uses 2-round sponge construction: capacity=DOMAIN_HASH4, rate=3.
///   Round 1: state = [DOMAIN_HASH4, a, b, c] → permute
///   Round 2: state[1] += d → permute → output state[0]
/// Used for: user leaf commitment (user_secret, cell_id, registration_salt, authority_level)
fn poseidon2_hash4(a: Field, b: Field, c: Field, d: Field) -> Field {
    // Round 1: absorb first 3 inputs, domain tag in capacity slot
    let mut state: [Field; 4] = [DOMAIN_HASH4, a, b, c];
    state = poseidon2_permutation(state, 4);
    // Round 2: absorb 4th input into rate position
    state[1] = state[1] + d;
    state = poseidon2_permutation(state, 4);
    state[0]
}

// ===============================================================================
// MERKLE VERIFICATION
// ===============================================================================

/// Standard Merkle path verification for Tree 1 (user identity tree).
/// Direction bits are derived from the leaf index.
///
/// @param leaf - The computed leaf value
/// @param path - Array of sibling hashes along the path
/// @param index - The leaf's position in the tree (determines left/right at each level)
/// @returns The computed Merkle root
fn compute_merkle_root(leaf: Field, path: [Field; TREE_DEPTH], index: u32) -> Field {
    // Range-constrain index to valid leaf positions
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

/// Sparse Merkle Tree path verification for Tree 2 (cell mapping tree).
/// Direction bits are provided as witness (pre-computed from SMT position).
///
/// Unlike standard Merkle trees where direction is derived from a numeric index,
/// SMTs use key-derived path bits. The path_bits are provided as private input
/// and represent the traversal directions at each level.
///
/// @param leaf - The computed cell map leaf
/// @param path - Array of sibling hashes along the SMT path
/// @param path_bits - Direction bits at each level (0 = left, 1 = right)
/// @returns The computed SMT root
fn compute_smt_root(
    leaf: Field,
    path: [Field; TREE_DEPTH],
    path_bits: [u1; TREE_DEPTH],
) -> Field {
    let mut node = leaf;
    for i in 0..TREE_DEPTH {
        let sibling = path[i];
        node = if path_bits[i] == 0 {
            poseidon2_hash2(node, sibling)
        } else {
            poseidon2_hash2(sibling, node)
        };
    }
    node
}

// ===============================================================================
// LEAF COMPUTATION
// ===============================================================================

/// Computes the user leaf for Tree 1.
///
/// SECURITY (CVE-001/CVE-003): The leaf MUST be derived from user_secret to prove
/// ownership. Without this binding, an attacker could use any valid leaf from the
/// tree without proving they control the corresponding secret.
///
/// SECURITY (BR5-001/BR5-004): Authority level is cryptographically bound to the
/// leaf. Users cannot upgrade their authority without re-registering a new leaf.
///
/// @param user_secret - The user's private key material (proves identity ownership)
/// @param cell_id - The geographic cell the user is registered in
/// @param registration_salt - Unique salt assigned during registration (prevents rainbow attacks)
/// @param authority_level - User's verified voting tier [1-5]
/// @returns The user leaf commitment
fn compute_user_leaf(
    user_secret: Field,
    cell_id: Field,
    registration_salt: Field,
    authority_level: Field,
) -> Field {
    poseidon2_hash4(user_secret, cell_id, registration_salt, authority_level)
}

/// Computes the cell map leaf for Tree 2.
///
/// Binds a geographic cell to its full set of overlapping districts.
///
/// @param cell_id - The geographic cell identifier
/// @param district_commitment - Hash of all 24 district IDs (from sponge)
/// @returns The cell map leaf
fn compute_cell_map_leaf(cell_id: Field, district_commitment: Field) -> Field {
    poseidon2_hash2(cell_id, district_commitment)
}

// ===============================================================================
// NULLIFIER
// ===============================================================================

/// Computes a domain-separated nullifier to prevent double-voting.
///
/// SECURITY (NUL-001): The nullifier is derived from identity_commitment (NOT
/// user_secret) to prevent Sybil attacks via re-registration. identity_commitment
/// is deterministic per verified person (from self.xyz/didit), so re-registering
/// with a new user_secret still produces the SAME nullifier.
///
/// action_domain is controlled by the verifying contract, preventing users from
/// manipulating private inputs to generate multiple valid proofs for the same action.
///
/// @param identity_commitment - Deterministic hash from identity verification provider
/// @param action_domain - Contract-controlled scope (encodes epoch, campaign, authority hash)
/// @returns Unique nullifier for this person+action combination
fn compute_nullifier(identity_commitment: Field, action_domain: Field) -> Field {
    poseidon2_hash2(identity_commitment, action_domain)
}

// ===============================================================================
// AUTHORITY VALIDATION
// ===============================================================================

/// Validates that authority_level is within the valid range [1, 5].
///
/// SECURITY (ISSUE-006): Authority levels must be bounded to prevent
/// privilege escalation or invalid tier claims.
///
/// SECURITY (BA-007): Cast through u64 first to detect values >= 256 that
/// would silently truncate when cast to u8 (e.g., 261 would become 5).
fn validate_authority_level(authority_level: Field) {
    // BA-007 FIX: Ensure value fits in u8 before casting to prevent truncation attacks.
    // A Field value like 261 (256 + 5) would silently truncate to 5 as u8.
    assert(authority_level as u64 < 256, "Authority level exceeds u8 range");
    let level_u8 = authority_level as u8;
    assert(level_u8 >= MIN_AUTHORITY_LEVEL as u8, "Authority level below minimum (1)");
    assert(level_u8 <= MAX_AUTHORITY_LEVEL as u8, "Authority level above maximum (5)");
}

// ===============================================================================
// MAIN CIRCUIT
// ===============================================================================

/// Two-tree membership circuit - proves user belongs to a geographic cell that
/// maps to a specific set of districts.
///
/// PUBLIC INPUTS (verified on-chain, contract-controlled):
/// - user_root: Tree 1 Merkle root (user identity tree)
/// - cell_map_root: Tree 2 SMT root (cell-to-districts mapping)
/// - districts: All 24 district IDs for this cell
/// - nullifier: Anti-double-vote token (identity-bound, NUL-001)
/// - action_domain: Contract-controlled scope for nullifier
/// - authority_level: User's voting tier (1-5, bound in leaf hash BR5-001)
///
/// PRIVATE INPUTS (user-provided witnesses):
/// - user_secret: User's private key material
/// - cell_id: The geographic cell identifier
/// - registration_salt: Salt from registration
/// - identity_commitment: Deterministic hash from identity provider (NUL-001)
/// - user_path: Merkle siblings for Tree 1
/// - user_index: Leaf position in Tree 1
/// - cell_map_path: SMT siblings for Tree 2
/// - cell_map_path_bits: SMT direction bits for Tree 2
fn main(
    // =======================================================================
    // PUBLIC INPUTS
    // =======================================================================
    user_root: pub Field,
    cell_map_root: pub Field,
    districts: pub [Field; 24],
    nullifier: pub Field,
    action_domain: pub Field,
    authority_level: pub Field,

    // =======================================================================
    // PRIVATE INPUTS (witnesses)
    // =======================================================================
    user_secret: Field,
    cell_id: Field,
    registration_salt: Field,
    identity_commitment: Field,

    // Tree 1: Standard Merkle proof
    user_path: [Field; TREE_DEPTH],
    user_index: u32,

    // Tree 2: SMT proof
    cell_map_path: [Field; TREE_DEPTH],
    cell_map_path_bits: [u1; TREE_DEPTH],
) {
    // =======================================================================
    // PRE-CHECKS
    // =======================================================================

    // SA-011 FIX: Reject zero user_secret to prevent predictable leaf values.
    assert(user_secret != 0, "user_secret cannot be zero");

    // NUL-001 FIX: Reject zero identity_commitment to prevent predictable nullifiers.
    // identity_commitment is deterministic per verified person (from self.xyz/didit).
    assert(identity_commitment != 0, "identity_commitment cannot be zero");

    // ISSUE-006 FIX: Validate authority_level is in valid range [1, 5]
    validate_authority_level(authority_level);

    // =======================================================================
    // STEP 1: Verify user identity (Tree 1)
    // =======================================================================
    // Compute leaf inside circuit from user_secret (CVE-001/CVE-003 fix).
    // The user must know the secret used during registration.
    // BR5-001: authority_level is bound into the leaf hash.
    let user_leaf = compute_user_leaf(user_secret, cell_id, registration_salt, authority_level);
    let computed_user_root = compute_merkle_root(user_leaf, user_path, user_index);
    assert(computed_user_root == user_root, "Tree 1: Merkle proof verification failed");

    // =======================================================================
    // STEP 2: Compute district commitment
    // =======================================================================
    // Hash all 24 district IDs into a single commitment using the sponge.
    let district_commitment = poseidon2_sponge_24(districts);

    // =======================================================================
    // STEP 3: Verify cell mapping (Tree 2)
    // =======================================================================
    // Prove that cell_id maps to this specific set of districts in the SMT.
    let cell_map_leaf = compute_cell_map_leaf(cell_id, district_commitment);
    let computed_map_root = compute_smt_root(
        cell_map_leaf,
        cell_map_path,
        cell_map_path_bits,
    );
    assert(computed_map_root == cell_map_root, "Tree 2: SMT proof verification failed");

    // =======================================================================
    // STEP 4: Verify nullifier
    // =======================================================================
    // NUL-001: Nullifier uses identity_commitment (not user_secret) to prevent
    // Sybil attacks. Re-registration with a new user_secret produces the same
    // nullifier because identity_commitment is deterministic per verified person.
    let computed_nullifier = compute_nullifier(identity_commitment, action_domain);
    assert(computed_nullifier == nullifier, "Nullifier verification failed");
}

// ===============================================================================
// TESTS
// ===============================================================================

#[test]
fn test_hash2_deterministic() {
    // Verify that poseidon2_hash2 produces consistent output for same inputs
    let a: Field = 42;
    let b: Field = 99;

    let result1 = poseidon2_hash2(a, b);
    let result2 = poseidon2_hash2(a, b);
    assert(result1 == result2, "hash2 must be deterministic");

    // Verify different inputs produce different outputs
    let result3 = poseidon2_hash2(b, a);
    assert(result1 != result3, "hash2 must not be commutative");

    // Verify non-zero output
    assert(result1 != 0, "hash2 should produce non-zero output for non-zero inputs");
}

#[test]
fn test_hash3_deterministic() {
    // Verify that poseidon2_hash3 produces consistent output for same inputs
    let a: Field = 1;
    let b: Field = 2;
    let c: Field = 3;

    let result1 = poseidon2_hash3(a, b, c);
    let result2 = poseidon2_hash3(a, b, c);
    assert(result1 == result2, "hash3 must be deterministic");

    // Verify different inputs produce different outputs
    let result3 = poseidon2_hash3(c, b, a);
    assert(result1 != result3, "hash3 input order must matter");

    // Verify non-zero output
    assert(result1 != 0, "hash3 should produce non-zero output for non-zero inputs");
}

#[test]
fn test_hash2_hash3_no_collision() {
    // Domain separation must prevent hash2(a, b) from equaling hash3(a, b, 0)
    let a: Field = 7;
    let b: Field = 13;

    let h2 = poseidon2_hash2(a, b);
    let h3 = poseidon2_hash3(a, b, 0);
    assert(h2 != h3, "hash2 and hash3 must not collide due to domain separation");
}

#[test]
fn test_hash4_deterministic() {
    // Verify that poseidon2_hash4 produces consistent output for same inputs
    let a: Field = 1;
    let b: Field = 2;
    let c: Field = 3;
    let d: Field = 4;

    let result1 = poseidon2_hash4(a, b, c, d);
    let result2 = poseidon2_hash4(a, b, c, d);
    assert(result1 == result2, "hash4 must be deterministic");

    // Verify different inputs produce different outputs
    let result3 = poseidon2_hash4(d, c, b, a);
    assert(result1 != result3, "hash4 input order must matter");

    // Verify non-zero output
    assert(result1 != 0, "hash4 should produce non-zero output for non-zero inputs");
}

#[test]
fn test_hash4_domain_separation() {
    // H4 must not collide with H3 or H2 for overlapping inputs
    let a: Field = 1;
    let b: Field = 2;
    let c: Field = 3;

    let h3 = poseidon2_hash3(a, b, c);
    let h4 = poseidon2_hash4(a, b, c, 0);
    assert(h3 != h4, "hash3 and hash4 must not collide due to domain separation");

    let h2 = poseidon2_hash2(a, b);
    let h4b = poseidon2_hash4(a, b, 0, 0);
    assert(h2 != h4b, "hash2 and hash4 must not collide due to domain separation");
}

#[test]
fn test_sponge_integration() {
    // Verify that the sponge module can be called from main and produces expected output.
    // Uses the same golden vector as sponge.nr's own test.
    let inputs: [Field; 24] = [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
        13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ];

    let result = poseidon2_sponge_24(inputs);

    // Must match the golden vector from sponge.nr / TypeScript implementation
    let expected: Field = 13897144223796711226515669182413786178697447221339740051025074265447026549851;
    assert(result == expected, "sponge golden vector mismatch - cross-language incompatibility");
}

#[test]
fn test_authority_validation() {
    // Valid authority levels: 1 through 5
    validate_authority_level(1);
    validate_authority_level(2);
    validate_authority_level(3);
    validate_authority_level(4);
    validate_authority_level(5);
}

#[test(should_fail_with = "Authority level below minimum (1)")]
fn test_authority_validation_rejects_zero() {
    validate_authority_level(0);
}

#[test(should_fail_with = "Authority level above maximum (5)")]
fn test_authority_validation_rejects_six() {
    validate_authority_level(6);
}

#[test(should_fail_with = "Authority level exceeds u8 range")]
fn test_authority_validation_rejects_overflow() {
    // 261 = 256 + 5, would truncate to 5 as u8 (BA-007)
    validate_authority_level(261);
}

#[test]
fn test_compute_user_leaf() {
    // Verify user leaf computation is deterministic and non-trivial
    let secret: Field = 12345;
    let cell: Field = 67890;
    let salt: Field = 11111;
    let auth: Field = 3;

    let leaf1 = compute_user_leaf(secret, cell, salt, auth);
    let leaf2 = compute_user_leaf(secret, cell, salt, auth);
    assert(leaf1 == leaf2, "user leaf must be deterministic");
    assert(leaf1 != 0, "user leaf should be non-zero for non-zero inputs");

    // Different salt must produce different leaf
    let leaf3 = compute_user_leaf(secret, cell, 22222, auth);
    assert(leaf1 != leaf3, "different salt must produce different leaf");

    // BR5-001: Different authority level must produce different leaf
    let leaf4 = compute_user_leaf(secret, cell, salt, 4);
    assert(leaf1 != leaf4, "different authority level must produce different leaf");
}

#[test]
fn test_compute_cell_map_leaf() {
    // Verify cell map leaf computation
    let cell_id: Field = 67890;
    let commitment: Field = 99999;

    let leaf1 = compute_cell_map_leaf(cell_id, commitment);
    let leaf2 = compute_cell_map_leaf(cell_id, commitment);
    assert(leaf1 == leaf2, "cell map leaf must be deterministic");

    // Different commitment must produce different leaf
    let leaf3 = compute_cell_map_leaf(cell_id, 88888);
    assert(leaf1 != leaf3, "different commitment must produce different cell map leaf");
}

#[test]
fn test_nullifier_deterministic() {
    // NUL-001: Nullifier uses identity_commitment, not user_secret.
    // Same identity_commitment + same action_domain = same nullifier.
    let identity: Field = 42;
    let domain: Field = 100;

    let null1 = compute_nullifier(identity, domain);
    let null2 = compute_nullifier(identity, domain);
    assert(null1 == null2, "nullifier must be deterministic");

    // Different domain must produce different nullifier
    let null3 = compute_nullifier(identity, 200);
    assert(null1 != null3, "different action_domain must produce different nullifier");

    // Different identity must produce different nullifier
    let null4 = compute_nullifier(99, domain);
    assert(null1 != null4, "different identity_commitment must produce different nullifier");
}
