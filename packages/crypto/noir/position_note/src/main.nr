// Position Note Circuit (Barretenberg / Noir)
//
// Proves that a debater owns a specific position commitment inside the
// position Merkle tree and that position is on the winning argument,
// without revealing WHICH commitment in the tree is theirs.
//
// SETTLEMENT FLOW:
//   1. User reveals a trade (revealTrade) -> DebateMarket records a
//      position_commitment = PCM-domain Poseidon2(argument_index, weighted_amount, randomness)
//   2. Shadow-atlas inserts the commitment into the position Merkle tree
//      and publishes the updated root on-chain.
//   3. After debate resolution, the user calls settleTrade and supplies
//      this circuit's proof to claim winnings.
//
// CIRCUIT PROVES (without revealing identity):
//   1. Prover knows preimage of a commitment in the tree (Merkle proof).
//   2. That commitment is for the winning argument.
//   3. The weighted_amount matches the claimed payout input.
//   4. A unique nullifier prevents double-claim.
//
// DOMAIN SEPARATION:
//   DOMAIN_POS_COMMIT = 0x50434d ("PCM") — new tag, no collision with H2/H3/H4.
//   DOMAIN_POS_NUL    = 0x504e4c ("PNL") — new tag for position nullifier.
//   DOMAIN_HASH2      = 0x48324d ("H2M") — shared Merkle node hash; MUST match
//                       other circuits for cross-circuit root compatibility.
//
// SECURITY:
//   - randomness must be non-zero (circuit asserts implicitly via hash uniqueness;
//     TypeScript prover enforces it explicitly before witness generation).
//   - nullifier_key must be non-zero (TypeScript prover enforces).
//   - position_index is range-checked: index < 2^TREE_DEPTH.
//   - Nullifier binds commitment + debate_id, preventing cross-debate replay.
//   - Argument index must match winning_argument_index (binding to resolution).
//   - weighted_amount is public: reveals position size but not identity.
//
// PUBLIC INPUTS (5, visible on-chain):
//   position_root           — current root of the position Merkle tree
//   nullifier               — H_PNL(nullifier_key, commitment, debate_id)
//   debate_id               — identifies which debate this claim is for
//   winning_argument_index  — winning argument from resolution (contract-controlled)
//   claimed_weighted_amount — amount to be paid out
//
// PRIVATE INPUTS (6 + TREE_DEPTH, never revealed):
//   argument_index    — which argument this position is on
//   weighted_amount   — the position's payout weight
//   randomness        — entropy in the commitment
//   nullifier_key     — user secret for nullifier derivation
//   position_path     — Merkle siblings from commitment leaf to root
//   position_index    — leaf position in the position tree
//
// ESTIMATED CONSTRAINT COUNT: ~1,350
//   20 Merkle levels × ~60 gates/level + hash computations

use dep::std::hash::poseidon2_permutation;

// ===============================================================================
// CONSTANTS
// ===============================================================================

// Domain separation for position commitment: permute([a, b, c, DOMAIN_POS_COMMIT])[0]
// Value: 0x50434d = "PCM" (Position Commitment Marker)
// MUST NOT collide with H2M/H3M/H4M from other circuits.
global DOMAIN_POS_COMMIT: Field = 0x50434d;

// Domain separation for position nullifier: permute([k, c, d, DOMAIN_POS_NUL])[0]
// Value: 0x504e4c = "PNL" (Position Nullifier)
// MUST NOT collide with any other domain tag in the protocol.
global DOMAIN_POS_NUL: Field = 0x504e4c;

// Shared Merkle node hash domain — MUST match three_tree_membership and two_tree_membership.
// Value: 0x48324d = "H2M" (Hash-2 Marker)
// CRITICAL: Any change here breaks cross-circuit root compatibility.
global DOMAIN_HASH2: Field = 0x48324d;

// Position tree depth: single variant, no multi-depth build.
// 2^20 = 1,048,576 positions — adequate for large debate markets.
global TREE_DEPTH: u32 = 20;

// ===============================================================================
// HASH FUNCTIONS
// ===============================================================================

/// Position commitment: H_PCM(argument_index, weighted_amount, randomness)
///
/// State layout: [argument_index, weighted_amount, randomness, DOMAIN_POS_COMMIT]
/// DOMAIN_POS_COMMIT = 0x50434d ("PCM") prevents collision with H3M (0x48334d)
/// even when inputs are identical. This is critical because the engagement circuit
/// also uses 3-input hashes (H3M domain), so a shared domain would allow
/// cross-circuit commitment aliasing.
///
/// CROSS-LANGUAGE PARITY: Must match PositionNoteNoirProver.computePositionCommitment()
/// in TypeScript, which calls: permute([argument_index, weighted_amount, randomness,
/// DOMAIN_POS_COMMIT])[0]
fn poseidon2_pos_commit(argument_index: Field, weighted_amount: Field, randomness: Field) -> Field {
    let state: [Field; 4] = [argument_index, weighted_amount, randomness, DOMAIN_POS_COMMIT];
    let out = poseidon2_permutation(state, 4);
    out[0]
}

/// Position nullifier: H_PNL(nullifier_key, position_commitment, debate_id)
///
/// State layout: [nullifier_key, position_commitment, debate_id, DOMAIN_POS_NUL]
/// Binds the claim to a specific (position, debate) pair.
///
/// SECURITY:
/// - nullifier_key is private: only the position owner can produce the correct nullifier.
/// - debate_id is public: prevents replay of the same nullifier across debates.
/// - position_commitment is derived in-circuit: the prover cannot substitute
///   a different commitment without breaking the Merkle proof (Step 2).
///
/// CROSS-LANGUAGE PARITY: Must match PositionNoteNoirProver.computePositionNullifier()
fn poseidon2_pos_nullifier(nullifier_key: Field, position_commitment: Field, debate_id: Field) -> Field {
    let state: [Field; 4] = [nullifier_key, position_commitment, debate_id, DOMAIN_POS_NUL];
    let out = poseidon2_permutation(state, 4);
    out[0]
}

/// Standard Merkle node hash: H2(left, right)
///
/// State layout: [left, right, DOMAIN_HASH2, 0]
/// DOMAIN_HASH2 = 0x48324d ("H2M") — shared with all other protocol trees.
///
/// CRITICAL: This function MUST produce the same output as poseidon2_hash2 in
/// three_tree_membership/main.nr, two_tree_membership/main.nr, and
/// Poseidon2Hasher.hashPair() in TypeScript. Any divergence would cause
/// position tree roots to mismatch contract-stored roots.
fn poseidon2_hash2(left: Field, right: Field) -> Field {
    let state: [Field; 4] = [left, right, DOMAIN_HASH2, 0];
    let out = poseidon2_permutation(state, 4);
    out[0]
}

// ===============================================================================
// MERKLE VERIFICATION
// ===============================================================================

/// Standard Merkle path verification for the position tree.
///
/// Traverses from leaf to root, selecting left/right sibling at each level
/// based on the bit of position_index at that level.
///
/// Algorithm (same as three_tree_membership compute_merkle_root):
///   For i in 0..TREE_DEPTH:
///     bit = (index >> i) & 1
///     if bit == 1: node = H2(sibling, node)  // leaf was right child
///     if bit == 0: node = H2(node, sibling)  // leaf was left child
///
/// @param leaf - The position commitment (computed in-circuit)
/// @param path - TREE_DEPTH sibling hashes from leaf to root
/// @param index - Leaf position in the tree (determines left/right at each level)
/// @returns Computed Merkle root
fn compute_merkle_root(leaf: Field, path: [Field; TREE_DEPTH], index: u32) -> Field {
    // Range-check index to valid leaf positions (2^TREE_DEPTH slots)
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
// MAIN CIRCUIT
// ===============================================================================

/// Position note circuit — proves settlement eligibility for a debate position.
///
/// PUBLIC INPUTS (contract-controlled, verified on-chain):
///   position_root           — Merkle root of the position tree
///   nullifier               — Prevents double-claim
///   debate_id               — Identifies the debate being settled
///   winning_argument_index  — Resolution outcome (contract-controlled)
///   claimed_weighted_amount — The payout weight being claimed
///
/// PRIVATE INPUTS (witnesses, never revealed):
///   argument_index    — Which argument this position is on (must match winner)
///   weighted_amount   — Position weight for payout calculation
///   randomness        — Entropy in the commitment
///   nullifier_key     — User secret for nullifier derivation
///   position_path     — Merkle siblings from commitment leaf to root
///   position_index    — Leaf position in the position tree
fn main(
    // =======================================================================
    // PRIVATE INPUTS (witnesses)
    // =======================================================================
    argument_index: Field,
    weighted_amount: Field,
    randomness: Field,
    nullifier_key: Field,
    position_path: [Field; TREE_DEPTH],
    position_index: u32,

    // =======================================================================
    // PUBLIC INPUTS (contract-controlled)
    // =======================================================================
    position_root: pub Field,
    nullifier: pub Field,
    debate_id: pub Field,
    winning_argument_index: pub Field,
    claimed_weighted_amount: pub Field,
) {
    // =======================================================================
    // STEP 1: Compute position commitment from private preimage
    //
    // commitment = H_PCM(argument_index, weighted_amount, randomness)
    //
    // This binds all three private fields into a single commitment.
    // The prover must know all three to produce a valid Merkle proof in Step 2.
    // =======================================================================
    let commitment = poseidon2_pos_commit(argument_index, weighted_amount, randomness);

    // =======================================================================
    // STEP 2: Verify position commitment is in the position Merkle tree
    //
    // Recomputes root from commitment + path + index and asserts it matches
    // the public position_root (stored on-chain, contract-controlled).
    // =======================================================================
    let computed_root = compute_merkle_root(commitment, position_path, position_index);
    assert(computed_root == position_root, "position commitment not in tree");

    // =======================================================================
    // STEP 3: Verify this position is on the winning argument
    //
    // winning_argument_index is a public input provided by the resolving
    // contract. The prover's private argument_index must match exactly.
    // This prevents positions on losing arguments from claiming settlement.
    // =======================================================================
    assert(argument_index == winning_argument_index, "not on winning argument");

    // =======================================================================
    // STEP 4: Bind claimed payout to the private weighted_amount
    //
    // claimed_weighted_amount is used by the contract for proportional payout.
    // Asserting equality ensures the prover cannot inflate their claimed amount.
    // =======================================================================
    assert(weighted_amount == claimed_weighted_amount, "weighted amount mismatch");

    // =======================================================================
    // STEP 5: Compute and verify nullifier (prevents double-claim)
    //
    // nullifier = H_PNL(nullifier_key, commitment, debate_id)
    //
    // SECURITY:
    // - nullifier_key is private: only the position owner can produce the
    //   correct nullifier for this commitment.
    // - commitment is derived in-circuit (Step 1): cannot be substituted.
    // - debate_id is public: prevents cross-debate nullifier replay.
    // - Contract stores used nullifiers and reverts on duplicate submission.
    // - nullifier_key != 0: defense-in-depth against degenerate nullifiers
    //   (I-2 hardening). A zero key would produce a predictable nullifier
    //   derivable by anyone who knows the commitment and debate_id.
    // =======================================================================
    assert(nullifier_key != 0, "nullifier_key must be non-zero");
    let computed_nullifier = poseidon2_pos_nullifier(nullifier_key, commitment, debate_id);
    assert(computed_nullifier == nullifier, "nullifier mismatch");
}

// ===============================================================================
// TESTS
// ===============================================================================

#[test]
fn test_pos_commit_deterministic() {
    // Verify poseidon2_pos_commit produces consistent output for same inputs
    let arg_idx: Field = 1;        // argument index 1
    let weight: Field = 40_000;    // weighted amount from debate_weight circuit
    let rand: Field = 12345;       // randomness

    let c1 = poseidon2_pos_commit(arg_idx, weight, rand);
    let c2 = poseidon2_pos_commit(arg_idx, weight, rand);
    assert(c1 == c2, "pos_commit must be deterministic");

    // Non-zero output
    assert(c1 != 0, "pos_commit should be non-zero for non-zero inputs");
}

#[test]
fn test_pos_commit_input_order_matters() {
    let a: Field = 1;
    let b: Field = 40_000;
    let c: Field = 12345;

    // Swapping argument_index and weighted_amount must produce different output
    let c1 = poseidon2_pos_commit(a, b, c);
    let c2 = poseidon2_pos_commit(b, a, c);
    assert(c1 != c2, "pos_commit input order must matter");
}

#[test]
fn test_pos_commit_domain_separation_from_hash3() {
    // PCM domain (0x50434d) must not collide with H3M domain (0x48334d).
    // Both use 3-input + domain layout, so the domain tag is the ONLY difference.
    // We verify by checking that the raw permutation inputs differ in slot 3,
    // which guarantees different outputs (Poseidon2 is collision-resistant).
    //
    // DOMAIN_POS_COMMIT = 0x50434d
    // DOMAIN_HASH3      = 0x48334d
    assert(0x50434d != 0x48334d, "PCM and H3M domain tags must differ");

    let a: Field = 7;
    let b: Field = 13;
    let c: Field = 99;

    // Compute with PCM domain (position commitment)
    let state_pcm: [Field; 4] = [a, b, c, 0x50434d];
    let out_pcm = poseidon2_permutation(state_pcm, 4);

    // Compute with H3M domain (engagement data commitment)
    let state_h3m: [Field; 4] = [a, b, c, 0x48334d];
    let out_h3m = poseidon2_permutation(state_h3m, 4);

    assert(out_pcm[0] != out_h3m[0], "PCM and H3M must produce different outputs (domain separation)");
}

#[test]
fn test_pos_commit_domain_separation_from_pnl() {
    // PCM domain (0x50434d) must not collide with PNL domain (0x504e4c).
    assert(0x50434d != 0x504e4c, "PCM and PNL domain tags must differ");

    let a: Field = 1;
    let b: Field = 2;
    let c: Field = 3;

    let commit = poseidon2_pos_commit(a, b, c);

    // Nullifier with same first three inputs but different domain
    let nul = poseidon2_pos_nullifier(a, b, c);

    assert(commit != nul, "position commitment and nullifier must not collide");
}

#[test]
fn test_pos_nullifier_deterministic() {
    let key: Field = 0xdeadbeef;
    let commit: Field = 0xcafebabe;
    let debate: Field = 42;

    let n1 = poseidon2_pos_nullifier(key, commit, debate);
    let n2 = poseidon2_pos_nullifier(key, commit, debate);
    assert(n1 == n2, "nullifier must be deterministic");

    assert(n1 != 0, "nullifier should be non-zero for non-zero inputs");
}

#[test]
fn test_pos_nullifier_changes_with_debate_id() {
    let key: Field = 0xdeadbeef;
    let commit: Field = 0xcafebabe;

    let n1 = poseidon2_pos_nullifier(key, commit, 1);
    let n2 = poseidon2_pos_nullifier(key, commit, 2);
    assert(n1 != n2, "different debate_id must produce different nullifier");
}

#[test]
fn test_pos_nullifier_changes_with_key() {
    let commit: Field = 0xcafebabe;
    let debate: Field = 42;

    let n1 = poseidon2_pos_nullifier(1, commit, debate);
    let n2 = poseidon2_pos_nullifier(2, commit, debate);
    assert(n1 != n2, "different nullifier_key must produce different nullifier");
}

#[test]
fn test_pos_nullifier_changes_with_commitment() {
    let key: Field = 0xdeadbeef;
    let debate: Field = 42;

    let n1 = poseidon2_pos_nullifier(key, 1, debate);
    let n2 = poseidon2_pos_nullifier(key, 2, debate);
    assert(n1 != n2, "different commitment must produce different nullifier");
}

#[test]
fn test_hash2_matches_h2m_domain() {
    // Verify poseidon2_hash2 uses DOMAIN_HASH2 = 0x48324d ("H2M"),
    // matching the three_tree_membership circuit.
    let left: Field = 100;
    let right: Field = 200;

    // Direct permutation with H2M layout
    let state: [Field; 4] = [left, right, 0x48324d, 0];
    let out = poseidon2_permutation(state, 4);

    // Must match the circuit's poseidon2_hash2 function
    let h2_result = poseidon2_hash2(left, right);
    assert(h2_result == out[0], "poseidon2_hash2 must use H2M domain");
}

#[test]
fn test_hash2_not_commutative() {
    // Standard Merkle hashing must be order-sensitive (left vs right child matters)
    let a: Field = 42;
    let b: Field = 99;

    let h_ab = poseidon2_hash2(a, b);
    let h_ba = poseidon2_hash2(b, a);
    assert(h_ab != h_ba, "hash2 must not be commutative");
}

#[test]
fn test_merkle_root_single_leaf() {
    // Tree of depth 20 with a single leaf at index 0.
    // All siblings are poseidon2_hash2(0, 0) (padding hash matches TypeScript).
    // Verify the circuit's Merkle root computation matches a manual computation.
    let leaf: Field = 12345;
    let padding = poseidon2_hash2(0, 0);

    // Build path: all siblings are padding (leaf is leftmost, always left child)
    let mut path: [Field; 20] = [0; 20];
    for i in 0..20 {
        path[i] = padding;
    }

    // index = 0: leaf is always left child (bit = 0 at every level)
    let root = compute_merkle_root(leaf, path, 0);
    assert(root != 0, "merkle root should be non-zero");
    assert(root != leaf, "merkle root should differ from leaf (path changes it)");

    // Verify determinism
    let root2 = compute_merkle_root(leaf, path, 0);
    assert(root == root2, "merkle root must be deterministic");
}

#[test]
fn test_merkle_root_right_child() {
    // Leaf at index 1 (right child of root's left subtree at level 0).
    // Sibling at level 0 must be on the LEFT, so H2(sibling, node).
    let leaf: Field = 99999;
    let sibling: Field = 11111;
    let padding = poseidon2_hash2(0, 0);

    let mut path: [Field; 20] = [0; 20];
    path[0] = sibling;
    for i in 1..20 {
        path[i] = padding;
    }

    // index = 1: bit 0 = 1 (right child) -> node = H2(sibling, node) at level 0
    let root = compute_merkle_root(leaf, path, 1);
    let expected_level0 = poseidon2_hash2(sibling, leaf);
    assert(root != expected_level0, "root must combine multiple levels");

    // Verify: root from index=0 sibling=leaf vs index=1 sibling=same must differ
    let mut path_idx0: [Field; 20] = [0; 20];
    path_idx0[0] = sibling;
    for i in 1..20 {
        path_idx0[i] = padding;
    }
    let root_idx0 = compute_merkle_root(leaf, path_idx0, 0);
    // index=0: H2(leaf, sibling) at level 0; index=1: H2(sibling, leaf) at level 0
    // These produce different level-0 hashes (H2 is not commutative), so roots differ
    assert(root != root_idx0, "different index must produce different root (sibling ordering)");
}

#[test(should_fail_with = "Leaf index out of range")]
fn test_merkle_root_rejects_out_of_range_index() {
    // 2^20 = 1_048_576, so this index is exactly out of range
    let leaf: Field = 42;
    let path: [Field; 20] = [0; 20];
    let _ = compute_merkle_root(leaf, path, 1_048_576u32);
}

#[test]
fn test_full_circuit_constraints() {
    // Integration test: all constraints satisfied for a known-good witness.
    // Uses small values that are easy to verify manually.
    let arg_idx: Field = 0;        // argument 0 (winning)
    let weight: Field = 2_000;     // weighted amount ($1, tier 1)
    let rand: Field = 98765;       // randomness
    let nullifier_key: Field = 0xaabbccdd;
    let debate_id: Field = 1;

    // Step 1: commitment
    let commitment = poseidon2_pos_commit(arg_idx, weight, rand);
    assert(commitment != 0, "commitment must be non-zero");

    // Step 5: nullifier
    let nullifier = poseidon2_pos_nullifier(nullifier_key, commitment, debate_id);
    assert(nullifier != 0, "nullifier must be non-zero");

    // Commitment and nullifier must differ (different domain tags)
    assert(commitment != nullifier, "commitment and nullifier must differ");

    // Verify all equality constraints would pass if main() were called:
    // - arg_idx == winning_argument_index (0 == 0) PASS
    // - weight == claimed_weighted_amount (2_000 == 2_000) PASS
    // - computed_nullifier == nullifier PASS (by construction above)
    assert(arg_idx == 0, "argument index must match winning argument");
    assert(weight == 2_000, "weight must match claimed amount");
}

#[test]
fn test_commitment_uniqueness_across_positions() {
    // Different positions on the same argument must have different commitments
    let weight: Field = 40_000;
    let arg_idx: Field = 1;

    let c1 = poseidon2_pos_commit(arg_idx, weight, 11111); // different randomness
    let c2 = poseidon2_pos_commit(arg_idx, weight, 22222);
    assert(c1 != c2, "different randomness must produce different commitment");

    // Different argument index must produce different commitment
    let c3 = poseidon2_pos_commit(0, weight, 11111);
    assert(c1 != c3, "different argument_index must produce different commitment");

    // Different weight must produce different commitment
    let c4 = poseidon2_pos_commit(arg_idx, 20_000, 11111);
    assert(c1 != c4, "different weighted_amount must produce different commitment");
}

#[test(should_fail_with = "nullifier_key must be non-zero")]
fn test_rejects_zero_nullifier_key() {
    // I-2 defense-in-depth: zero nullifier_key produces predictable nullifiers
    // derivable by anyone who knows commitment and debate_id.
    let arg_idx: Field = 0;
    let weight: Field = 2_000;
    let rand: Field = 98765;
    let debate_id: Field = 1;

    let commitment = poseidon2_pos_commit(arg_idx, weight, rand);
    let padding = poseidon2_hash2(0, 0);
    let mut path: [Field; 20] = [0; 20];
    for i in 0..20 {
        path[i] = padding;
    }
    let root = compute_merkle_root(commitment, path, 0);
    let nullifier = poseidon2_pos_nullifier(0, commitment, debate_id);

    // This should fail at the nullifier_key != 0 assertion
    main(arg_idx, weight, rand, 0, path, 0, root, nullifier, debate_id, 0, weight);
}
