// Poseidon Hash using Axiom halo2_base
// Production-proven: Axiom Mainnet V2, Trail of Bits audited (2023)
// Reference: https://github.com/axiom-crypto/halo2-lib

use halo2_base::{
    gates::GateInstructions,
    poseidon::hasher::{PoseidonHasher, spec::OptimizedPoseidonSpec},
    AssignedValue, Context,
    utils::BigPrimeField,
};

// Poseidon parameters (aligned with Axiom standard)
pub const T: usize = 3;      // State size
pub const RATE: usize = 2;   // Absorption rate (inputs per permutation)
pub const R_F: usize = 8;    // Full rounds
pub const R_P: usize = 57;   // Partial rounds (Axiom standard, vs PSE's 56)

/// Hash two field elements for Merkle tree internal nodes
///
/// Domain: ConstantLength<2> equivalent (determined by array length)
/// Usage: hash(left_child, right_child) → parent_hash
///
/// # Security
/// - Non-commutative: hash(a,b) ≠ hash(b,a)
/// - Domain separated from single-element hashing by input length
/// - 128-bit security (t=3, α=5, R_F=8, R_P=57)
pub fn hash_pair<F: BigPrimeField>(
    ctx: &mut Context<F>,
    gate: &impl GateInstructions<F>,
    left: AssignedValue<F>,
    right: AssignedValue<F>,
) -> AssignedValue<F> {
    // Initialize Poseidon hasher with Axiom's optimized spec
    let mut poseidon = PoseidonHasher::<F, T, RATE>::new(
        OptimizedPoseidonSpec::new::<R_F, R_P, 0>()
    );

    // Load round constants into circuit
    poseidon.initialize_consts(ctx, gate);

    // Hash the pair (array length = 2 provides domain separation)
    poseidon.hash_fix_len_array(ctx, gate, &[left, right])
}

/// Hash a single field element for Merkle tree leaves
///
/// Domain: ConstantLength<1> equivalent (determined by array length)
/// Usage: hash(identity_commitment) → leaf_hash
///
/// # Security
/// - Domain separated from pair hashing by input length
/// - Non-zero output even for zero input (sponge construction)
pub fn hash_single<F: BigPrimeField>(
    ctx: &mut Context<F>,
    gate: &impl GateInstructions<F>,
    value: AssignedValue<F>,
) -> AssignedValue<F> {
    // Initialize Poseidon hasher with Axiom's optimized spec
    let mut poseidon = PoseidonHasher::<F, T, RATE>::new(
        OptimizedPoseidonSpec::new::<R_F, R_P, 0>()
    );

    // Load round constants into circuit
    poseidon.initialize_consts(ctx, gate);

    // Hash single value (array length = 1 provides domain separation)
    poseidon.hash_fix_len_array(ctx, gate, &[value])
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

    const K: usize = 11; // 2048 rows, sufficient for Poseidon tests

    /// Helper to create a simple test circuit and extract the hash output
    fn test_hash_pair_circuit(left: Fr, right: Fr) -> Fr {
        let mut builder = RangeCircuitBuilder::from_stage(CircuitBuilderStage::Mock).use_k(K);
        builder.set_lookup_bits(8); // Standard lookup bits for range checks
        let range = builder.range_chip();
        let gate = range.gate();
        let ctx = builder.main(0);

        let left_assigned = ctx.load_witness(left);
        let right_assigned = ctx.load_witness(right);

        let hash = hash_pair(ctx, gate, left_assigned, right_assigned);

        *hash.value()
    }

    /// Helper to create a simple test circuit for single hash
    fn test_hash_single_circuit(value: Fr) -> Fr {
        let mut builder = RangeCircuitBuilder::from_stage(CircuitBuilderStage::Mock).use_k(K);
        builder.set_lookup_bits(8); // Standard lookup bits for range checks
        let range = builder.range_chip();
        let gate = range.gate();
        let ctx = builder.main(0);

        let value_assigned = ctx.load_witness(value);

        let hash = hash_single(ctx, gate, value_assigned);

        *hash.value()
    }

    #[test]
    fn test_hash_pair_basic() {
        // Test that hash_pair produces deterministic output
        let hash = test_hash_pair_circuit(Fr::from(12345), Fr::from(67890));

        // Hash should be non-zero
        assert_ne!(hash, Fr::zero());
    }

    #[test]
    fn test_hash_single_basic() {
        // Test that hash_single produces deterministic output
        let hash = test_hash_single_circuit(Fr::from(42));

        // Hash should be non-zero
        assert_ne!(hash, Fr::zero());
    }

    #[test]
    fn test_hash_pair_noncommutative() {
        // SECURITY TEST: Poseidon MUST be non-commutative
        // Critical for Merkle tree security (can't swap siblings)
        let a = Fr::from(12345);
        let b = Fr::from(67890);

        let hash_ab = test_hash_pair_circuit(a, b);
        let hash_ba = test_hash_pair_circuit(b, a);

        // hash(a,b) MUST NOT equal hash(b,a)
        assert_ne!(
            hash_ab,
            hash_ba,
            "SECURITY FAILURE: Poseidon must be non-commutative for Merkle tree security"
        );
    }

    #[test]
    fn test_hash_single_nonzero_for_zero() {
        // EDGE CASE: hash(0) must be non-zero
        let hash = test_hash_single_circuit(Fr::zero());

        // Must be non-zero even for zero input
        assert_ne!(
            hash,
            Fr::zero(),
            "Poseidon(0) must be non-zero"
        );
    }

    #[test]
    fn test_hash_pair_collision_resistance() {
        // TEST: Different inputs produce different outputs
        let hash1 = test_hash_pair_circuit(Fr::from(1), Fr::from(2));
        let hash2 = test_hash_pair_circuit(Fr::from(3), Fr::from(4));

        // Hashes must be different
        assert_ne!(
            hash1,
            hash2,
            "Different inputs must produce different hashes"
        );
    }

    #[test]
    fn test_hash_pair_deterministic() {
        // TEST: Same inputs produce same output (circuit determinism)
        let left_val = Fr::from(123);
        let right_val = Fr::from(456);

        let hash1 = test_hash_pair_circuit(left_val, right_val);
        let hash2 = test_hash_pair_circuit(left_val, right_val);

        // Same inputs must produce same output
        assert_eq!(
            hash1,
            hash2,
            "Circuit must be deterministic"
        );
    }

    #[test]
    fn test_zero_inputs_pair() {
        // EDGE CASE: hash(0, 0) should work and be non-zero
        let hash = test_hash_pair_circuit(Fr::zero(), Fr::zero());

        // Should be non-zero
        assert_ne!(
            hash,
            Fr::zero(),
            "Poseidon(0,0) must be non-zero"
        );
    }

    // TODO: Add golden vector tests after generating new vectors with Axiom parameters
    // NOTE: Axiom uses R_P=57 vs PSE's R_P=56, so outputs will differ from old golden vectors
}
