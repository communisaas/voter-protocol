// Poseidon2 Sponge Construction for 24-District Commitment
//
// This module implements the sponge construction for hashing 24 district IDs
// into a single commitment. It is used by the two-tree architecture to bind
// a user's geographic cell to their full district set.
//
// SECURITY:
// - Domain separation: DOMAIN_SPONGE_24 prevents collision with other hash functions
// - ADD to state (not overwrite): Proper sponge construction that maintains
//   cryptographic chaining between rounds
// - Rate = 3, Capacity = 1: Standard sponge parameters for 4-element state
//
// SPECIFICATION REFERENCE:
// - TWO-TREE-ARCHITECTURE-SPEC.md Section 4.3 (Sponge Construction)
// - TWO-TREE-AGENT-REVIEW-SUMMARY.md BLOCKER-3 (Sponge Bug Fix)

use dep::std::hash::poseidon2_permutation;

/// Domain separation tag for 24-district sponge.
/// Value: 0x534f4e47455f24
/// Breakdown:
///   0x53 = 'S', 0x4f = 'O', 0x4e = 'N', 0x47 = 'G', 0x45 = 'E'
///   0x5f = '_', 0x24 = hex for decimal 36 (represents "24")
/// This prevents collision with other hash functions in the protocol.
global DOMAIN_SPONGE_24: Field = 0x534f4e47455f24;

/// Poseidon2 sponge for hashing 24 district IDs into a single commitment.
///
/// ALGORITHM:
/// 1. Initialize state: [DOMAIN_SPONGE_24, 0, 0, 0]
/// 2. For each chunk of 3 inputs (8 rounds total):
///    - ADD inputs to state[1], state[2], state[3] (NOT overwrite)
///    - Apply Poseidon2 permutation to full state
/// 3. Return state[0] as output
///
/// CRITICAL SECURITY NOTE:
/// The spec v0.1 had a bug where inputs were assigned (overwriting state).
/// This implementation uses ADDITION, which is the correct sponge construction.
/// Overwriting would break the cryptographic chaining and create collision vulnerabilities.
///
/// CORRECT (this implementation):
///   state[1] = state[1] + inputs[i * 3]
///
/// BUGGY (from spec v0.1):
///   state[1] = inputs[i * 3]  // WRONG - discards previous state
///
/// @param inputs - Exactly 24 field elements (district IDs)
/// @returns Single field element (district commitment)
pub fn poseidon2_sponge_24(inputs: [Field; 24]) -> Field {
    // Initialize state with domain tag in capacity position (state[0])
    let mut state: [Field; 4] = [DOMAIN_SPONGE_24, 0, 0, 0];

    // Absorb phase: 24 inputs / 3 rate = 8 rounds
    for i in 0..8 {
        // ADD inputs to rate elements (state[1], state[2], state[3])
        // CRITICAL: Use addition, not assignment, to maintain sponge security
        state[1] = state[1] + inputs[i * 3];
        state[2] = state[2] + inputs[i * 3 + 1];
        state[3] = state[3] + inputs[i * 3 + 2];

        // Apply full Poseidon2 permutation
        state = poseidon2_permutation(state, 4);
    }

    // Squeeze phase: return capacity element (state[0])
    state[0]
}

// ============================================================================
// TEST CASES
// ============================================================================

#[test]
fn test_sponge_deterministic() {
    // Test that same inputs produce same output
    let inputs: [Field; 24] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];

    let result1 = poseidon2_sponge_24(inputs);
    let result2 = poseidon2_sponge_24(inputs);

    assert(result1 == result2);
}

#[test]
fn test_sponge_different_inputs() {
    // Test that different inputs produce different outputs
    let inputs1: [Field; 24] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
    let inputs2: [Field; 24] = [24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

    let result1 = poseidon2_sponge_24(inputs1);
    let result2 = poseidon2_sponge_24(inputs2);

    assert(result1 != result2);
}

#[test]
fn test_sponge_all_zeros() {
    // Test edge case: all zero inputs
    let inputs: [Field; 24] = [0; 24];

    let result = poseidon2_sponge_24(inputs);

    // Should produce a non-zero output due to domain tag
    assert(result != 0);
}

#[test]
fn test_sponge_order_matters() {
    // Test that input order affects output (no commutativity)
    let inputs1: [Field; 24] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
    let inputs2: [Field; 24] = [2, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];

    let result1 = poseidon2_sponge_24(inputs1);
    let result2 = poseidon2_sponge_24(inputs2);

    // Swapping first two elements should change output
    assert(result1 != result2);
}

#[test]
fn test_sponge_golden_vector_sequential() {
    // GOLDEN VECTOR: Cross-language verification with TypeScript
    // This test ensures Noir and TypeScript implementations produce identical output
    //
    // Input: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]
    // Expected output (from TypeScript): 13897144223796711226515669182413786178697447221339740051025074265447026549851
    //
    // If this test fails, it means the TypeScript and Noir implementations have diverged.
    // This would cause all two-tree proofs to fail verification.

    let inputs: [Field; 24] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
    let result = poseidon2_sponge_24(inputs);

    // TypeScript-computed golden vector
    let expected: Field = 13897144223796711226515669182413786178697447221339740051025074265447026549851;

    assert(result == expected);
}

#[test]
fn test_sponge_golden_vector_all_zeros() {
    // GOLDEN VECTOR: All zeros should produce non-zero output due to domain tag
    let inputs: [Field; 24] = [0; 24];
    let result = poseidon2_sponge_24(inputs);

    // Should not be zero (domain tag ensures this)
    assert(result != 0);

    // This test doesn't enforce a specific value since it depends on the
    // Poseidon2 permutation internals, but we verify it's deterministic
    let result2 = poseidon2_sponge_24(inputs);
    assert(result == result2);
}
