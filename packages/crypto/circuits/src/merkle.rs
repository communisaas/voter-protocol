// Merkle Tree Verification Circuit using Axiom halo2_base
// Two-tier structure: district trees + global tree
// Migrated from PSE to Axiom (Production-proven, Trail of Bits audited)

use halo2_base::{
    gates::GateInstructions,
    AssignedValue, Context,
    utils::BigPrimeField,
};
use crate::poseidon_hash::hash_pair;

/// Verify Merkle path from leaf to root
///
/// For each level in the path:
/// - Read sibling hash from path
/// - Read direction bit (0 = left, 1 = right)
/// - Hash (current, sibling) or (sibling, current) based on direction
/// - Result becomes current hash for next level
///
/// Returns the computed root
///
/// # Security
/// - Path length determines tree depth
/// - Direction bits must match actual tree structure
/// - Non-commutativity of Poseidon ensures correct sibling ordering
pub fn verify_merkle_path<F: BigPrimeField>(
    ctx: &mut Context<F>,
    gate: &impl GateInstructions<F>,
    leaf: AssignedValue<F>,
    path: Vec<AssignedValue<F>>,      // Sibling hashes
    path_indices: Vec<bool>,           // false = left, true = right
) -> AssignedValue<F> {
    assert_eq!(
        path.len(),
        path_indices.len(),
        "Path and indices must have same length"
    );

    let mut current_hash = leaf;

    for (sibling, &is_right) in path.iter().zip(path_indices.iter()) {
        // Hash based on direction
        // If is_right: current is right child → hash(sibling, current)
        // If is_left: current is left child → hash(current, sibling)
        current_hash = if is_right {
            // Current hash is right child
            hash_pair(ctx, gate, sibling.clone(), current_hash)
        } else {
            // Current hash is left child
            hash_pair(ctx, gate, current_hash, sibling.clone())
        };
    }

    current_hash
}

#[cfg(test)]
mod tests {
    use super::*;
    use halo2_base::{
        halo2_proofs::halo2curves::bn256::Fr,
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

    /// Helper: Create circuit and verify Merkle path
    fn test_merkle_circuit(
        leaf: Fr,
        path: Vec<Fr>,
        path_indices: Vec<bool>,
        expected_root: Fr,
    ) -> bool {
        let mut builder = RangeCircuitBuilder::from_stage(CircuitBuilderStage::Mock).use_k(K);
        builder.set_lookup_bits(8);
        let range = builder.range_chip();
        let gate = range.gate();
        let ctx = builder.main(0);

        // Load witnesses
        let leaf_assigned = ctx.load_witness(leaf);
        let path_assigned: Vec<_> = path.iter().map(|&h| ctx.load_witness(h)).collect();

        // Verify Merkle path
        let computed_root = verify_merkle_path(
            ctx,
            gate,
            leaf_assigned,
            path_assigned,
            path_indices,
        );

        // Check if computed root matches expected
        *computed_root.value() == expected_root
    }

    #[test]
    fn test_merkle_path_valid_2_level() {
        // Build tree with 4 leaves (2 levels)
        let leaves = vec![
            Fr::from(1),
            Fr::from(2),
            Fr::from(3),
            Fr::from(4),
        ];

        let (leaves, root) = build_test_tree(leaves.clone());

        // Prove leaf 0 is in tree
        let (path, indices) = get_merkle_path(leaves.clone(), 0);

        let result = test_merkle_circuit(leaves[0], path, indices, root);
        assert!(result, "Valid Merkle path should verify");
    }

    #[test]
    fn test_merkle_path_valid_3_level() {
        // Build tree with 8 leaves (3 levels)
        let leaves = (1..=8).map(|i| Fr::from(i as u64)).collect::<Vec<_>>();

        let (leaves, root) = build_test_tree(leaves.clone());

        // Prove leaf 5 is in tree
        let (path, indices) = get_merkle_path(leaves.clone(), 5);

        let result = test_merkle_circuit(leaves[5], path, indices, root);
        assert!(result, "Valid Merkle path should verify");
    }

    #[test]
    fn test_merkle_reject_wrong_sibling() {
        // Build tree
        let leaves = vec![Fr::from(1), Fr::from(2), Fr::from(3), Fr::from(4)];
        let (leaves, root) = build_test_tree(leaves.clone());

        // Get path for leaf 0
        let (mut path, indices) = get_merkle_path(leaves.clone(), 0);

        // ATTACK: Tamper with sibling
        path[0] = Fr::from(99999);  // Wrong sibling!

        let result = test_merkle_circuit(leaves[0], path, indices, root);
        assert!(!result, "SECURITY FAILURE: Circuit accepted tampered sibling!");
    }

    #[test]
    fn test_merkle_reject_wrong_root() {
        // Build tree
        let leaves = vec![Fr::from(1), Fr::from(2), Fr::from(3), Fr::from(4)];
        let (leaves, _root) = build_test_tree(leaves.clone());

        // Get valid path
        let (path, indices) = get_merkle_path(leaves.clone(), 0);

        // ATTACK: Claim wrong root
        let fake_root = Fr::from(88888);

        let result = test_merkle_circuit(leaves[0], path, indices, fake_root);
        assert!(!result, "SECURITY FAILURE: Circuit accepted wrong root!");
    }

    #[test]
    fn test_merkle_reject_wrong_leaf() {
        // Build tree
        let leaves = vec![Fr::from(1), Fr::from(2), Fr::from(3), Fr::from(4)];
        let (leaves, root) = build_test_tree(leaves.clone());

        // Get path for leaf 0
        let (path, indices) = get_merkle_path(leaves.clone(), 0);

        // ATTACK: Claim wrong leaf
        let wrong_leaf = Fr::from(99);

        let result = test_merkle_circuit(wrong_leaf, path, indices, root);
        assert!(!result, "SECURITY FAILURE: Circuit accepted wrong leaf!");
    }

    #[test]
    fn test_merkle_path_deterministic() {
        // TEST: Same inputs produce same computed root
        let leaves = vec![Fr::from(10), Fr::from(20), Fr::from(30), Fr::from(40)];
        let (leaves, root) = build_test_tree(leaves.clone());
        let (path, indices) = get_merkle_path(leaves.clone(), 2);

        let result1 = test_merkle_circuit(leaves[2], path.clone(), indices.clone(), root);
        let result2 = test_merkle_circuit(leaves[2], path, indices, root);

        assert!(result1 && result2, "Circuit must be deterministic");
    }

    #[test]
    fn test_merkle_path_all_leaves() {
        // TEST: Verify path for every leaf in a tree
        let leaves = vec![
            Fr::from(100),
            Fr::from(200),
            Fr::from(300),
            Fr::from(400),
        ];
        let (leaves, root) = build_test_tree(leaves.clone());

        for (i, &leaf) in leaves.iter().enumerate() {
            let (path, indices) = get_merkle_path(leaves.clone(), i);
            let result = test_merkle_circuit(leaf, path, indices, root);
            assert!(result, "Leaf {} should verify against root", i);
        }
    }
}
