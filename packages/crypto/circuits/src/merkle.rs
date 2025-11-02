// Merkle Tree Verification Circuit using Axiom halo2_base
// Two-tier structure: district trees + global tree
// Migrated from PSE to Axiom (Production-proven, Trail of Bits audited)

use halo2_base::{
    gates::GateInstructions,
    AssignedValue, Context,
    utils::BigPrimeField,
    poseidon::hasher::PoseidonHasher,
};
use crate::poseidon_hash::{hash_pair, hash_pair_with_hasher, T, RATE};

// ============================================================================
// INPUT VALIDATION (Brutalist Finding #3 Fix - DOS Mitigation)
// ============================================================================

/// Validate Merkle path inputs BEFORE entering circuit
///
/// # Brutalist Finding #3: Panic Instead of Result Returns
/// - OLD: `panic!` on invalid path length (crashes prover process)
/// - FIX: Return `Result` for graceful error handling
/// - Prevents DOS via malformed requests
///
/// # Parameters
/// - `path_len`: Length of provided Merkle path
/// - `tree_depth`: Expected tree depth
///
/// # Returns
/// - `Ok(())` if validation passes
/// - `Err(String)` with clear error message if validation fails
///
/// # Usage
/// Call this BEFORE `verify_merkle_path()` or `verify_merkle_path_with_hasher()`:
/// ```rust
/// validate_merkle_inputs(path.len(), tree_depth)?;
/// let root = verify_merkle_path(...);
/// ```
pub fn validate_merkle_inputs(path_len: usize, tree_depth: usize) -> Result<(), String> {
    if path_len != tree_depth {
        return Err(format!(
            "Invalid Merkle path length: got {}, expected {}. \
             Path must contain exactly one sibling per tree level.",
            path_len, tree_depth
        ));
    }
    Ok(())
}

/// Decompose a field element into bits (CONSTRAINED)
///
/// # Security: CRITICAL for Merkle path verification
/// Each bit is constrained to be boolean: bit * bit == bit forces {0, 1}
/// This prevents the prover from lying about leaf_index bits
///
/// # Parameters
/// - `value`: The field element to decompose (e.g., leaf_index)
/// - `num_bits`: Number of bits to extract (tree depth)
///
/// # Returns
/// Vec of constrained bit AssignedValues (LSB first)
fn decompose_to_bits<F: BigPrimeField>(
    ctx: &mut Context<F>,
    gate: &impl GateInstructions<F>,
    value: AssignedValue<F>,
    num_bits: usize,
) -> Vec<AssignedValue<F>> {
    // Extract raw value to decompose
    let value_raw = *value.value();

    // Decompose to bits (LSB first)
    let bits: Vec<bool> = (0..num_bits)
        .map(|i| {
            let bit_value = (value_raw.to_repr().as_ref()[i / 8] >> (i % 8)) & 1;
            bit_value == 1
        })
        .collect();

    // Witness each bit and constrain it to be boolean
    let mut bit_assigned = Vec::new();
    let mut reconstructed = ctx.load_constant(F::ZERO);
    let mut power_of_two = ctx.load_constant(F::ONE);

    for &bit_bool in &bits {
        // Witness the bit
        let bit = ctx.load_witness(F::from(bit_bool as u64));

        // CONSTRAINT 1: Bit is boolean (bit² = bit)
        let bit_squared = gate.mul(ctx, bit, bit);
        ctx.constrain_equal(&bit, &bit_squared);

        // CONSTRAINT 2: Bits reconstruct to original value
        let bit_contribution = gate.mul(ctx, bit, power_of_two);
        reconstructed = gate.add(ctx, reconstructed, bit_contribution);

        // Next power of 2
        power_of_two = gate.add(ctx, power_of_two, power_of_two);

        bit_assigned.push(bit);
    }

    // CONSTRAINT 3: Reconstructed value equals original
    ctx.constrain_equal(&reconstructed, &value);

    bit_assigned
}

// ============================================================================
// OPTIMIZED API - Reusable Hasher (FIX: Brutalist Finding #4)
// ============================================================================

/// Verify Merkle path using a reusable hasher (OPTIMIZED)
///
/// **CRITICAL**: Use this instead of `verify_merkle_path()` to avoid DOS vector.
///
/// # Brutalist Finding #4: Constant Reinitialization DOS
/// - OLD: `verify_merkle_path()` created new hasher 2× per level (~2800 cells/level)
/// - FIX: Reuse hasher across all levels (constants cached in OnceCell)
/// - Savings: 12-level tree = ~33,600 advice cells saved per proof
///
/// # Parameters
/// - `hasher`: Reusable PoseidonHasher (create ONCE with `create_poseidon_hasher()`)
/// - `leaf`: The leaf value to prove membership for
/// - `leaf_index`: The index of the leaf in the tree (CONSTRAINED)
/// - `path`: Sibling hashes along the path to root
/// - `tree_depth`: Depth of the Merkle tree (number of levels)
///
/// # Security Properties (UNCHANGED)
/// 1. Path indices derived from constrained bit decomposition
/// 2. Each bit constrained to {0, 1}
/// 3. Bits must reconstruct to claimed leaf_index
/// 4. Non-commutativity of Poseidon enforces correct sibling ordering
pub fn verify_merkle_path_with_hasher<F: BigPrimeField>(
    hasher: &mut PoseidonHasher<F, T, RATE>,
    ctx: &mut Context<F>,
    gate: &impl GateInstructions<F>,
    leaf: AssignedValue<F>,
    leaf_index: AssignedValue<F>,
    path: Vec<AssignedValue<F>>,
    tree_depth: usize,
) -> AssignedValue<F> {
    // ✅ FIXED (2025-10-26): Runtime validation with panic (circuit functions can't return Result)
    // RECOMMENDED: Call `validate_merkle_inputs()` BEFORE this function to get Result<(), String>
    // This panic is a last-resort safety check that survives --release builds
    if path.len() != tree_depth {
        panic!(
            "SECURITY: Invalid Merkle path length: got {}, expected {}. \
             \n\n\
             To handle this gracefully, call `validate_merkle_inputs(path.len(), tree_depth)?` \
             BEFORE calling this function. \
             \n\n\
             This panic prevents memory bomb DOS attacks via oversized paths.",
            path.len(), tree_depth
        );
    }

    // Decompose leaf_index into constrained bits (LSB first)
    let index_bits = decompose_to_bits(ctx, gate, leaf_index, tree_depth);

    let mut current_hash = leaf;

    for (sibling, bit) in path.iter().zip(index_bits.iter()) {
        // Compute both possible hashes using REUSABLE hasher
        let hash_if_left = hash_pair_with_hasher(hasher, ctx, gate, current_hash, *sibling);
        let hash_if_right = hash_pair_with_hasher(hasher, ctx, gate, *sibling, current_hash);

        // Select based on constrained bit
        current_hash = gate.select(ctx, hash_if_right, hash_if_left, *bit);
    }

    current_hash
}

// ============================================================================
// LEGACY API - Per-Hash Hasher Creation (DEPRECATED - DOS VECTOR)
// ============================================================================
//
// ⚠️ WARNING: This function creates a NEW hasher per hash call, wasting
// ~2800 advice cells per Merkle level. Use `verify_merkle_path_with_hasher()`
// instead for production code.

/// Verify Merkle path from leaf to root (SECURE VERSION)
///
/// # Security Fix (2025-10-24): Path indices are now CONSTRAINED
///
/// **PREVIOUS VULNERABILITY**: `path_indices: Vec<bool>` was unconstrained witness
/// - Prover could lie about left/right directions
/// - Enabled proving membership in WRONG congressional district
/// - Protocol-level election fraud vulnerability
///
/// **SECURE VERSION**: `leaf_index` is witnessed and constrained
/// - Decompose leaf_index into bits (constrained via bit² = bit)
/// - Verify bits reconstruct to leaf_index (constrained)
/// - Derive path directions from constrained bits
/// - Prover CANNOT lie without violating constraints
///
/// # Parameters
/// - `leaf`: The leaf value to prove membership for
/// - `leaf_index`: The index of the leaf in the tree (CONSTRAINED)
/// - `path`: Sibling hashes along the path to root
/// - `tree_depth`: Depth of the Merkle tree (number of levels)
///
/// # Returns
/// Computed Merkle root
///
/// # Security Properties
/// 1. Path indices derived from constrained bit decomposition
/// 2. Each bit constrained to {0, 1}
/// 3. Bits must reconstruct to claimed leaf_index
/// 4. Non-commutativity of Poseidon enforces correct sibling ordering
pub fn verify_merkle_path<F: BigPrimeField>(
    ctx: &mut Context<F>,
    gate: &impl GateInstructions<F>,
    leaf: AssignedValue<F>,
    leaf_index: AssignedValue<F>,    // ← NOW CONSTRAINED (not Vec<bool>)
    path: Vec<AssignedValue<F>>,     // Sibling hashes
    tree_depth: usize,
) -> AssignedValue<F> {
    // ✅ FIXED (2025-10-26): Runtime validation with panic (circuit functions can't return Result)
    // RECOMMENDED: Call `validate_merkle_inputs()` BEFORE this function to get Result<(), String>
    // This panic is a last-resort safety check that survives --release builds
    if path.len() != tree_depth {
        panic!(
            "SECURITY: Invalid Merkle path length: got {}, expected {}. \
             \n\n\
             To handle this gracefully, call `validate_merkle_inputs(path.len(), tree_depth)?` \
             BEFORE calling this function. \
             \n\n\
             This panic prevents memory bomb DOS attacks via oversized paths.",
            path.len(), tree_depth
        );
    }

    // Decompose leaf_index into constrained bits (LSB first)
    let index_bits = decompose_to_bits(ctx, gate, leaf_index, tree_depth);

    let mut current_hash = leaf;

    for (sibling, bit) in path.iter().zip(index_bits.iter()) {
        // Compute both possible hashes:
        // - hash_if_left:  hash(current, sibling)  when bit = 0
        // - hash_if_right: hash(sibling, current)  when bit = 1
        let hash_if_left = hash_pair(ctx, gate, current_hash, *sibling);
        let hash_if_right = hash_pair(ctx, gate, *sibling, current_hash);

        // Select based on constrained bit
        // select(a, b, cond) returns: cond ? a : b
        current_hash = gate.select(ctx, hash_if_right, hash_if_left, *bit);
    }

    current_hash
}

#[cfg(test)]
mod tests {
    use super::*;
    use halo2_base::{
        halo2_proofs::{
            halo2curves::bn256::Fr,
            dev::MockProver,
        },
        gates::{
            circuit::{CircuitBuilderStage, builder::RangeCircuitBuilder},
            RangeInstructions,
        },
    };
    use crate::poseidon_hash::hash_pair;

    const K: usize = 12; // 4096 rows, sufficient for Merkle path tests

    /// Helper: Compute Poseidon hash using circuit (extract value immediately)
    fn hash_pair_native(left: Fr, right: Fr) -> Fr {
        let mut builder = RangeCircuitBuilder::from_stage(CircuitBuilderStage::Mock).use_k(K);
        builder.set_lookup_bits(8);
        let range = builder.range_chip();
        let gate = range.gate();
        let ctx = builder.main(0);

        let left_assigned = ctx.load_witness(left);
        let right_assigned = ctx.load_witness(right);

        let hash = hash_pair(ctx, gate, left_assigned, right_assigned);

        *hash.value()
    }

    /// Helper: Build a simple binary Merkle tree and return (leaves, root)
    /// Uses native Poseidon (not in-circuit) to compute expected tree
    fn build_test_tree(leaves: Vec<Fr>) -> (Vec<Fr>, Fr) {
        assert!(leaves.len().is_power_of_two(), "Must be power of 2");

        let mut current_level = leaves.clone();

        // Build tree bottom-up using native Poseidon
        while current_level.len() > 1 {
            let mut next_level = Vec::new();

            for i in (0..current_level.len()).step_by(2) {
                let left = current_level[i];
                let right = current_level[i + 1];

                // Compute hash using Axiom Poseidon (via circuit, extract value)
                let parent = hash_pair_native(left, right);

                next_level.push(parent);
            }

            current_level = next_level;
        }

        (leaves, current_level[0])
    }

    /// Helper: Get Merkle path for leaf at index
    fn get_merkle_path(leaves: Vec<Fr>, leaf_index: usize) -> (Vec<Fr>, Vec<bool>) {
        assert!(leaves.len().is_power_of_two());
        assert!(leaf_index < leaves.len());

        let mut siblings = Vec::new();
        let mut indices = Vec::new();

        let mut current_level = leaves.clone();
        let mut current_index = leaf_index;

        while current_level.len() > 1 {
            // Get sibling
            let sibling_index = current_index ^ 1; // Flip last bit
            siblings.push(current_level[sibling_index]);

            // Record direction (false = left, true = right)
            indices.push((current_index & 1) == 1);

            // Build next level
            let mut next_level = Vec::new();
            for i in (0..current_level.len()).step_by(2) {
                let left = current_level[i];
                let right = current_level[i + 1];

                let parent = hash_pair_native(left, right);

                next_level.push(parent);
            }

            current_level = next_level;
            current_index /= 2;
        }

        (siblings, indices)
    }

    /// Helper: Run MockProver to validate ALL constraints (PHASE 2 - Production-ready testing)
    ///
    /// # Why MockProver for Merkle primitives:
    /// - Validates bit decomposition constraints (bit² = bit)
    /// - Validates reconstruction constraints (Σ(bit_i × 2^i) = leaf_index)
    /// - Validates Poseidon hash constraints
    /// - Catches under-constrained bugs that witness-level tests miss
    ///
    /// # Returns
    /// - Ok(()) if all constraints satisfied
    /// - Err(String) if constraint violation detected
    fn run_merkle_with_mock_prover(
        leaf: Fr,
        leaf_index: usize,
        path: Vec<Fr>,
        tree_depth: usize,
    ) -> Result<(), String> {
        let mut builder = RangeCircuitBuilder::from_stage(CircuitBuilderStage::Mock).use_k(K);
        builder.set_lookup_bits(8);
        // DON'T set instance columns for primitive tests - no public outputs
        let range = builder.range_chip();
        let gate = range.gate();
        let ctx = builder.main(0);

        // Load witnesses
        let leaf_assigned = ctx.load_witness(leaf);
        let leaf_index_fr = Fr::from(leaf_index as u64);
        let leaf_index_assigned = ctx.load_witness(leaf_index_fr);
        let path_assigned: Vec<_> = path.iter().map(|&h| ctx.load_witness(h)).collect();

        // Verify Merkle path with CONSTRAINED leaf_index
        let _computed_root = verify_merkle_path(
            ctx,
            gate,
            leaf_assigned,
            leaf_index_assigned,
            path_assigned,
            tree_depth,
        );

        // CRITICAL: Calculate params to finalize builder configuration
        builder.calculate_params(Some(9)); // 9 blinding rows is standard

        // Extract instance values from AssignedValues (MockProver needs raw Fr values)
        let instances: Vec<Vec<Fr>> = builder.assigned_instances
            .iter()
            .map(|column| column.iter().map(|v| *v.value()).collect())
            .collect();

        // Run MockProver to validate ALL constraints
        let prover = MockProver::run(K as u32, &builder, instances)
            .map_err(|e| format!("MockProver::run failed: {}", e))?;

        prover.verify()
            .map_err(|e| format!("Constraint verification failed: {:?}", e))?;

        Ok(())
    }

    /// Helper: Create circuit and verify Merkle path (SECURE VERSION)
    ///
    /// # Security: Now uses constrained leaf_index instead of unconstrained path_indices
    fn test_merkle_circuit(
        leaf: Fr,
        leaf_index: usize,
        path: Vec<Fr>,
        tree_depth: usize,
        expected_root: Fr,
    ) -> bool {
        let mut builder = RangeCircuitBuilder::from_stage(CircuitBuilderStage::Mock).use_k(K);
        builder.set_lookup_bits(8);
        let range = builder.range_chip();
        let gate = range.gate();
        let ctx = builder.main(0);

        // Load witnesses
        let leaf_assigned = ctx.load_witness(leaf);
        let leaf_index_fr = Fr::from(leaf_index as u64);
        let leaf_index_assigned = ctx.load_witness(leaf_index_fr);
        let path_assigned: Vec<_> = path.iter().map(|&h| ctx.load_witness(h)).collect();

        // Verify Merkle path with CONSTRAINED leaf_index
        let computed_root = verify_merkle_path(
            ctx,
            gate,
            leaf_assigned,
            leaf_index_assigned,
            path_assigned,
            tree_depth,
        );

        // Check if computed root matches expected
        *computed_root.value() == expected_root
    }

    /// Helper: Verify adversarial test (witness-level + constraint documentation)
    ///
    /// # Security: Constraints are enforced in circuit, verified at proof generation
    ///
    /// **IMPORTANT**: This tests witness-level behavior. The actual constraint verification
    /// happens when MockProver or real Prover is run on the complete circuit.
    ///
    /// **Constraints enforced by decompose_to_bits():**
    /// 1. Boolean constraint: bit² = bit (forces bits ∈ {0,1})
    /// 2. Reconstruction: ∑(bit_i * 2^i) = reconstructed_value
    /// 3. Equality: reconstructed_value = original leaf_index
    ///
    /// **Why witness-level tests are still valuable:**
    /// - Detects wrong roots (most attacks)
    /// - Validates circuit logic
    /// - Fast execution (no constraint system overhead)
    ///
    /// **TODO (Phase 4)**: Add full MockProver verification when district circuit is complete.
    /// This requires building the complete circuit structure with proper public inputs.
    fn test_merkle_adversarial(
        leaf: Fr,
        leaf_index: usize,
        path: Vec<Fr>,
        tree_depth: usize,
        expected_root: Fr,
        test_name: &str,
    ) {
        let result = test_merkle_circuit(leaf, leaf_index, path, tree_depth, expected_root);

        if result {
            panic!(
                "SECURITY FAILURE in {}: Circuit accepted invalid proof!\n\
                 Constraints in decompose_to_bits() should prevent this attack.",
                test_name
            );
        }
        // Attack was rejected at witness level (expected behavior)
    }

    #[test]
    fn test_merkle_path_valid_2_level() {
        // ✅ CONVERTED TO MOCKPROVER CONSTRAINT VALIDATION (Phase 2)
        // Build tree with 4 leaves (2 levels)
        let leaves = vec![
            Fr::from(1),
            Fr::from(2),
            Fr::from(3),
            Fr::from(4),
        ];

        let (leaves, root) = build_test_tree(leaves.clone());

        // Prove leaf 0 is in tree
        let leaf_index = 0;
        let tree_depth = 2; // log2(4) = 2
        let (path, _) = get_merkle_path(leaves.clone(), leaf_index);

        // ✅ MOCKPROVER: Validates ALL constraints for Merkle path verification
        run_merkle_with_mock_prover(leaves[leaf_index], leaf_index, path.clone(), tree_depth)
            .expect("MockProver constraint validation failed");

        // WHAT MOCKPROVER VALIDATES:
        // - Bit decomposition constraints (bit² = bit for each bit)
        // - Index reconstruction (Σ(bit_i × 2^i) = leaf_index)
        // - Poseidon hash constraints for each level
        // - Select gate correctness (choosing left vs right hash)

        // Witness-level verification (root matches expected)
        let result = test_merkle_circuit(leaves[leaf_index], leaf_index, path, tree_depth, root);
        assert!(result, "Valid Merkle path should verify");
    }

    #[test]
    fn test_merkle_path_valid_3_level() {
        // ✅ CONVERTED TO MOCKPROVER CONSTRAINT VALIDATION (Phase 2)
        // Build tree with 8 leaves (3 levels)
        let leaves = (1..=8).map(|i| Fr::from(i as u64)).collect::<Vec<_>>();

        let (leaves, root) = build_test_tree(leaves.clone());

        // Prove leaf 5 is in tree
        let leaf_index = 5;
        let tree_depth = 3; // log2(8) = 3
        let (path, _) = get_merkle_path(leaves.clone(), leaf_index);

        // ✅ MOCKPROVER: Validates constraints for 3-level tree
        run_merkle_with_mock_prover(leaves[leaf_index], leaf_index, path.clone(), tree_depth)
            .expect("MockProver constraint validation failed");

        // Witness-level verification
        let result = test_merkle_circuit(leaves[leaf_index], leaf_index, path, tree_depth, root);
        assert!(result, "Valid Merkle path should verify");
    }

    #[test]
    fn test_merkle_reject_wrong_sibling() {
        // ✅ CONVERTED TO MOCKPROVER CONSTRAINT VALIDATION (Phase 2)
        // ADVERSARIAL TEST: Tampered sibling hash
        let leaves = vec![Fr::from(1), Fr::from(2), Fr::from(3), Fr::from(4)];
        let (leaves, root) = build_test_tree(leaves.clone());

        let leaf_index = 0;
        let tree_depth = 2;
        let (mut path, _) = get_merkle_path(leaves.clone(), leaf_index);

        // ATTACK: Tamper with sibling
        path[0] = Fr::from(99999);

        // ✅ MOCKPROVER: All constraints satisfied (bits valid, hashing correct)
        // Attack succeeds at constraint level but fails at witness level (wrong root)
        run_merkle_with_mock_prover(leaves[leaf_index], leaf_index, path.clone(), tree_depth)
            .expect("MockProver should pass - constraints satisfied despite wrong sibling");

        // WHAT MOCKPROVER VALIDATES:
        // - All bits decomposed correctly (bit² = bit)
        // - Index reconstruction valid (Σ(bit_i × 2^i) = leaf_index)
        // - Poseidon hashing constraints satisfied
        // - Circuit computes hash(leaf, wrong_sibling) instead of hash(leaf, correct_sibling)
        // - Result: wrong root computed → caught at witness verification

        // Witness-level adversarial check
        test_merkle_adversarial(leaves[leaf_index], leaf_index, path, tree_depth, root, "wrong_sibling");
    }

    #[test]
    fn test_merkle_reject_wrong_root() {
        // ✅ CONVERTED TO MOCKPROVER CONSTRAINT VALIDATION (Phase 2)
        // ADVERSARIAL TEST: Claimed root doesn't match computed root
        let leaves = vec![Fr::from(1), Fr::from(2), Fr::from(3), Fr::from(4)];
        let (leaves, _root) = build_test_tree(leaves.clone());

        let leaf_index = 0;
        let tree_depth = 2;
        let (path, _) = get_merkle_path(leaves.clone(), leaf_index);

        // ATTACK: Claim wrong root
        let fake_root = Fr::from(88888);

        // ✅ MOCKPROVER: Constraints satisfied (correct Merkle path computation)
        run_merkle_with_mock_prover(leaves[leaf_index], leaf_index, path.clone(), tree_depth)
            .expect("MockProver should pass - circuit computes root correctly");

        // WHAT THIS TESTS:
        // - MockProver validates circuit computes correct root from path
        // - Witness verification detects mismatch between computed vs claimed root
        // - Attack fails because computed_root ≠ fake_root

        // Witness-level adversarial check
        test_merkle_adversarial(leaves[leaf_index], leaf_index, path, tree_depth, fake_root, "wrong_root");
    }

    #[test]
    fn test_merkle_reject_wrong_leaf() {
        // ✅ CONVERTED TO MOCKPROVER CONSTRAINT VALIDATION (Phase 2)
        // ADVERSARIAL TEST: Wrong leaf value
        let leaves = vec![Fr::from(1), Fr::from(2), Fr::from(3), Fr::from(4)];
        let (leaves, root) = build_test_tree(leaves.clone());

        let leaf_index = 0;
        let tree_depth = 2;
        let (path, _) = get_merkle_path(leaves.clone(), leaf_index);

        // ATTACK: Claim wrong leaf
        let wrong_leaf = Fr::from(99);

        // ✅ MOCKPROVER: Constraints satisfied (hashing wrong_leaf correctly)
        run_merkle_with_mock_prover(wrong_leaf, leaf_index, path.clone(), tree_depth)
            .expect("MockProver should pass - circuit computes hash(wrong_leaf, siblings)");

        // WHAT THIS TESTS:
        // - All Merkle path constraints satisfied with wrong leaf
        // - Circuit correctly computes path from wrong_leaf → wrong root
        // - Witness verification detects wrong_root ≠ expected_root

        // Witness-level adversarial check
        test_merkle_adversarial(wrong_leaf, leaf_index, path, tree_depth, root, "wrong_leaf");
    }

    #[test]
    fn test_merkle_path_deterministic() {
        // ✅ CONVERTED TO MOCKPROVER CONSTRAINT VALIDATION (Phase 2)
        // PROPERTY TEST: Same inputs produce same computed root (determinism)
        let leaves = vec![Fr::from(10), Fr::from(20), Fr::from(30), Fr::from(40)];
        let (leaves, root) = build_test_tree(leaves.clone());
        let leaf_index = 2;
        let tree_depth = 2;
        let (path, _) = get_merkle_path(leaves.clone(), leaf_index);

        // ✅ MOCKPROVER (Run 1): Validate constraints
        run_merkle_with_mock_prover(leaves[leaf_index], leaf_index, path.clone(), tree_depth)
            .expect("MockProver run 1 failed");

        // ✅ MOCKPROVER (Run 2): Same circuit, same constraints should pass
        run_merkle_with_mock_prover(leaves[leaf_index], leaf_index, path.clone(), tree_depth)
            .expect("MockProver run 2 failed - circuit not deterministic!");

        // WHAT THIS TESTS:
        // - Circuit produces same constraint system for identical inputs
        // - No randomness in constraint generation
        // - Deterministic hash computation

        // Witness-level determinism check
        let result1 = test_merkle_circuit(leaves[leaf_index], leaf_index, path.clone(), tree_depth, root);
        let result2 = test_merkle_circuit(leaves[leaf_index], leaf_index, path, tree_depth, root);

        assert!(result1 && result2, "Circuit must be deterministic");
    }

    #[test]
    fn test_merkle_path_all_leaves() {
        // ✅ CONVERTED TO MOCKPROVER CONSTRAINT VALIDATION (Phase 2)
        // COMPREHENSIVE TEST: Verify path for every leaf in a tree
        let leaves = vec![
            Fr::from(100),
            Fr::from(200),
            Fr::from(300),
            Fr::from(400),
        ];
        let (leaves, root) = build_test_tree(leaves.clone());
        let tree_depth = 2; // log2(4) = 2

        for (i, &leaf) in leaves.iter().enumerate() {
            let (path, _) = get_merkle_path(leaves.clone(), i);

            // ✅ MOCKPROVER: Validate constraints for this leaf's path
            run_merkle_with_mock_prover(leaf, i, path.clone(), tree_depth)
                .unwrap_or_else(|e| panic!("MockProver failed for leaf {}: {}", i, e));

            // WHAT THIS VALIDATES FOR EACH LEAF:
            // - Index {i} bit decomposition correct
            // - Path selection correct (left vs right at each level)
            // - Poseidon hash constraints satisfied
            // - Computed root matches expected

            // Witness-level verification
            let result = test_merkle_circuit(leaf, i, path, tree_depth, root);
            assert!(result, "Leaf {} should verify against root", i);
        }
    }

    // === NEW ADVERSARIAL TESTS (Security hardening 2025-10-24) ===

    #[test]
    fn test_merkle_reject_wrong_index() {
        // ✅ CONVERTED TO MOCKPROVER CONSTRAINT VALIDATION (Phase 2)
        // ADVERSARIAL TEST: Wrong leaf_index (tests constrained bit decomposition)
        //
        // ATTACK: Prove that leaves[0] is at position 3 (instead of position 0)
        // SECURITY: leaf_index is decomposed into constrained bits
        //   - Index 0 = bits [0,0] → path directions: left, left
        //   - Index 3 = bits [1,1] → path directions: right, right
        // Using wrong index follows wrong path → wrong root computed
        let leaves = vec![Fr::from(1), Fr::from(2), Fr::from(3), Fr::from(4)];
        let (leaves, root) = build_test_tree(leaves.clone());
        let tree_depth = 2;

        let (path, _) = get_merkle_path(leaves.clone(), 0);

        // ATTACK: Claim this leaf is at index 3 (WRONG!)
        let wrong_index = 3;

        // ✅ MOCKPROVER: All constraints satisfied (different path selection)
        run_merkle_with_mock_prover(leaves[0], wrong_index, path.clone(), tree_depth)
            .expect("MockProver should pass - wrong index decomposes correctly to bits [1,1]");

        // WHAT THIS VALIDATES:
        // - Index 3 decomposes to bits [1,1] (constrained correctly)
        // - Circuit follows right, right path (wrong directions for leaves[0])
        // - Computes wrong root → caught at witness verification
        // - Proves bit decomposition constraints work as intended

        // Witness-level adversarial check
        test_merkle_adversarial(leaves[0], wrong_index, path, tree_depth, root, "wrong_index");
    }

    #[test]
    fn test_merkle_reject_index_out_of_bounds() {
        // ✅ CONVERTED TO MOCKPROVER CONSTRAINT VALIDATION (Phase 2)
        // ADVERSARIAL TEST: Out-of-bounds leaf_index (tests reconstruction constraint)
        //
        // ATTACK: Use leaf_index=5 in a tree with 4 leaves (valid indices: 0-3)
        //
        // SECURITY PROPERTIES TESTED:
        // 1. Bit truncation: tree_depth=2 → only 2 bits extracted from leaf_index=5
        //    - leaf_index=5 (binary 101) → extract bits [1,0] (LSB first)
        //    - Reconstruction: 1*2^0 + 0*2^1 = 1 (NOT 5!)
        //    - CONSTRAINT: reconstructed (1) must equal witnessed value (5) → VIOLATION
        //
        // 2. Wrong path followed: bits [1,0] → right, left path
        //    - Correct path for leaves[0]: left, left (bits [0,0])
        //    - Wrong path → wrong root at witness level
        let leaves = vec![Fr::from(1), Fr::from(2), Fr::from(3), Fr::from(4)];
        let (leaves, root) = build_test_tree(leaves.clone());
        let tree_depth = 2;

        let (path, _) = get_merkle_path(leaves.clone(), 0);

        // ATTACK: Out-of-bounds index
        let out_of_bounds_index = 5; // >= 2^tree_depth

        // ✅ MOCKPROVER: Should FAIL due to reconstruction constraint violation
        let result = run_merkle_with_mock_prover(leaves[0], out_of_bounds_index, path.clone(), tree_depth);

        // CRITICAL: MockProver MUST reject this because:
        // - decompose_to_bits() extracts 2 bits from index=5: bits [1,0]
        // - Reconstructed value: 1*1 + 0*2 = 1
        // - Constraint: reconstructed (1) == witnessed (5) → VIOLATION
        assert!(
            result.is_err(),
            "SECURITY FAILURE: MockProver accepted out-of-bounds index! \
             Reconstruction constraint should have failed (1 ≠ 5)"
        );

        // WHAT THIS PROVES:
        // - Bit decomposition + reconstruction constraints prevent index manipulation
        // - Cannot claim leaf is at index > 2^tree_depth - 1
        // - Circuit enforces valid index range through mathematical constraints

        // Witness-level adversarial check (also catches at witness level)
        test_merkle_adversarial(leaves[0], out_of_bounds_index, path, tree_depth, root, "index_out_of_bounds");
    }

    #[test]
    fn test_merkle_edge_case_max_index() {
        // ✅ CONVERTED TO MOCKPROVER CONSTRAINT VALIDATION (Phase 2)
        // EDGE CASE TEST: Maximum valid index works correctly
        //
        // TEST: Verify that leaf at index 2^tree_depth - 1 (rightmost leaf)
        // can be proven correctly. This is an edge case because:
        // - All index bits are 1 (e.g., tree_depth=3, index=7 = binary 111)
        // - Tests that bit decomposition handles all-ones correctly
        // - Ensures select() operations work when bit is always 1 (right branch)
        let leaves = (1..=8).map(|i| Fr::from(i as u64)).collect::<Vec<_>>();
        let (leaves, root) = build_test_tree(leaves.clone());
        let tree_depth = 3; // log2(8) = 3

        // Test maximum valid index (2^3 - 1 = 7)
        let max_index = 7;
        let (path, _) = get_merkle_path(leaves.clone(), max_index);

        // ✅ MOCKPROVER: Validates constraints with all-ones bit pattern
        run_merkle_with_mock_prover(leaves[max_index], max_index, path.clone(), tree_depth)
            .expect("MockProver constraint validation failed for max index");

        // WHAT THIS TESTS:
        // - Bit decomposition with all bits = 1 (boundary condition)
        // - Select gate always choosing right branch
        // - No overflow in reconstruction constraint

        // Witness-level verification
        let result = test_merkle_circuit(leaves[max_index], max_index, path, tree_depth, root);
        assert!(result, "EDGE CASE FAILURE: Maximum valid index should verify!");
    }
}
