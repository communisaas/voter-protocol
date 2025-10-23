//! Poseidon hash gadget for Halo2 circuits
//!
//! Integrates the PSE (Privacy & Scaling Explorations) Poseidon gadget for use in
//! Merkle tree verification. Poseidon is a SNARK-friendly hash function optimized
//! for zero-knowledge proofs.
//!
//! Uses WIDTH=3, RATE=2 configuration (optimal for hashing 2 field elements).

use halo2_proofs::{
    circuit::{AssignedCell, Layouter, Value},
    plonk::{Advice, Column, ConstraintSystem, ErrorFront},
};
use halo2curves::bn256::Fr;

// Import PSE Poseidon gadget
use halo2_poseidon::poseidon::{
    primitives::{self as poseidon_primitives, generate_constants, ConstantLength, Mds, Spec},
    Hash, Pow5Chip, Pow5Config,
};

/// Poseidon specification for BN254 curve (WIDTH=3, RATE=2)
///
/// This configuration is optimal for hashing pairs of field elements (Merkle tree nodes).
/// - WIDTH=3: 2 message elements + 1 capacity element
/// - RATE=2: Number of elements we can absorb per permutation
#[derive(Debug, Clone, Copy)]
pub struct PoseidonSpec<const WIDTH: usize, const RATE: usize>;

impl Spec<Fr, 3, 2> for PoseidonSpec<3, 2> {
    fn full_rounds() -> usize {
        8 // Standard Poseidon security parameter
    }

    fn partial_rounds() -> usize {
        56 // Standard Poseidon security parameter for BN254
    }

    fn sbox(val: Fr) -> Fr {
        // Pow5 S-box: x^5
        use ff::Field;
        val.pow([5])
    }

    fn secure_mds() -> usize {
        0 // Use standard MDS matrix generation
    }

    fn constants() -> (Vec<[Fr; 3]>, Mds<Fr, 3>, Mds<Fr, 3>) {
        // Generate round constants and MDS matrices
        generate_constants::<_, Self, 3, 2>()
    }
}

/// Configuration for Poseidon hash gadget
#[derive(Debug, Clone)]
pub struct PoseidonConfig {
    /// Poseidon Pow5 chip configuration
    pub pow5_config: Pow5Config<Fr, 3, 2>,
    /// Input columns for loading message values
    pub input_cols: [Column<Advice>; 2],
}

impl PoseidonConfig {
    /// Configure the Poseidon gadget
    pub fn configure(meta: &mut ConstraintSystem<Fr>) -> Self {
        // Allocate columns for Poseidon state
        let state = [
            meta.advice_column(),
            meta.advice_column(),
            meta.advice_column(),
        ];

        // Allocate column for partial S-box
        let partial_sbox = meta.advice_column();

        // Allocate columns for round constants
        let rc_a = [
            meta.fixed_column(),
            meta.fixed_column(),
            meta.fixed_column(),
        ];
        let rc_b = [
            meta.fixed_column(),
            meta.fixed_column(),
            meta.fixed_column(),
        ];

        // Enable constant assignment
        meta.enable_constant(rc_b[0]);

        // Allocate input columns (separate from Poseidon state for easier loading)
        let input_cols = [meta.advice_column(), meta.advice_column()];

        let pow5_config =
            Pow5Chip::configure::<PoseidonSpec<3, 2>>(meta, state, partial_sbox, rc_a, rc_b);

        Self {
            pow5_config,
            input_cols,
        }
    }
}

/// Poseidon hasher for Merkle tree operations
///
/// Provides methods for hashing field elements using the Poseidon permutation.
pub struct PoseidonHasher;

impl PoseidonHasher {
    /// Hash two field elements (for Merkle tree parent nodes)
    ///
    /// # Arguments
    /// * `layouter` - Circuit layouter for constraint assignment
    /// * `config` - Poseidon configuration
    /// * `left` - Left child hash (already assigned)
    /// * `right` - Right child hash (already assigned)
    ///
    /// # Returns
    /// Parent hash = Poseidon(left, right)
    ///
    /// # Constraints
    /// This adds ~320 constraints to the circuit (Poseidon WIDTH=3, RATE=2).
    pub fn hash_pair_assigned(
        mut layouter: impl Layouter<Fr>,
        config: &PoseidonConfig,
        left: AssignedCell<Fr, Fr>,
        right: AssignedCell<Fr, Fr>,
    ) -> Result<AssignedCell<Fr, Fr>, ErrorFront> {
        // Construct Poseidon chip
        let chip = Pow5Chip::construct(config.pow5_config.clone());

        // Initialize hasher for 2-element input
        let hasher = Hash::<_, _, PoseidonSpec<3, 2>, ConstantLength<2>, 3, 2>::init(
            chip,
            layouter.namespace(|| "poseidon init"),
        )
        .map_err(|e| ErrorFront::from(e))?;

        // Hash the pair of elements
        let output = hasher
            .hash(layouter.namespace(|| "poseidon hash"), [left, right])
            .map_err(|e| ErrorFront::from(e))?;

        Ok(output)
    }

    /// Hash two field element values (loads and hashes in one step)
    ///
    /// # Arguments
    /// * `layouter` - Circuit layouter for constraint assignment
    /// * `config` - Poseidon configuration
    /// * `left` - Left input value
    /// * `right` - Right input value
    ///
    /// # Returns
    /// Parent hash = Poseidon(left, right)
    pub fn hash_pair(
        mut layouter: impl Layouter<Fr>,
        config: &PoseidonConfig,
        left: Value<Fr>,
        right: Value<Fr>,
    ) -> Result<AssignedCell<Fr, Fr>, ErrorFront> {
        // Load inputs into advice cells
        let (left_cell, right_cell) = layouter
            .assign_region(
                || "load inputs",
                |mut region| {
                    let left_cell =
                        region.assign_advice(|| "left", config.input_cols[0], 0, || left)?;
                    let right_cell =
                        region.assign_advice(|| "right", config.input_cols[1], 0, || right)?;
                    Ok((left_cell, right_cell))
                },
            )
            .map_err(|e| ErrorFront::from(e))?;

        // Hash using assigned cells
        Self::hash_pair_assigned(layouter.namespace(|| "hash"), config, left_cell, right_cell)
    }

    /// Hash a single field element (for leaf nodes)
    ///
    /// # Arguments
    /// * `layouter` - Circuit layouter for constraint assignment
    /// * `config` - Poseidon configuration
    /// * `value` - Field element to hash
    ///
    /// # Returns
    /// Hash = Poseidon(value, 0)
    ///
    /// # Note
    /// For single-element hashing, we hash (value, 0) to maintain compatibility
    /// with the WIDTH=3, RATE=2 configuration. This is standard for Merkle leaves.
    pub fn hash_single(
        layouter: impl Layouter<Fr>,
        config: &PoseidonConfig,
        value: Value<Fr>,
    ) -> Result<AssignedCell<Fr, Fr>, ErrorFront> {
        // Hash (value, 0)
        Self::hash_pair(layouter, config, value, Value::known(Fr::zero()))
    }

    /// Compute Poseidon hash of two values outside the circuit (for testing)
    ///
    /// # Arguments
    /// * `left` - Left input value
    /// * `right` - Right input value
    ///
    /// # Returns
    /// Hash = Poseidon(left, right)
    ///
    /// # Note
    /// This is a native (non-circuit) implementation for computing expected values
    /// in tests. The circuit version (hash_pair) will produce the same result.
    pub fn hash_pair_native(left: Fr, right: Fr) -> Fr {
        poseidon_primitives::Hash::<_, PoseidonSpec<3, 2>, ConstantLength<2>, 3, 2>::init()
            .hash([left, right])
    }

    /// Compute Poseidon hash of single value outside the circuit (for testing)
    ///
    /// # Arguments
    /// * `value` - Input value
    ///
    /// # Returns
    /// Hash = Poseidon(value, 0)
    pub fn hash_single_native(value: Fr) -> Fr {
        poseidon_primitives::Hash::<_, PoseidonSpec<3, 2>, ConstantLength<2>, 3, 2>::init()
            .hash([value, Fr::zero()])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use halo2_proofs::{
        circuit::{SimpleFloorPlanner, Value},
        dev::MockProver,
        plonk::Circuit,
    };

    /// Test circuit for verifying Poseidon hash
    #[derive(Clone)]
    struct PoseidonTestCircuit {
        left: Value<Fr>,
        right: Value<Fr>,
    }

    impl Circuit<Fr> for PoseidonTestCircuit {
        type Config = PoseidonConfig;
        type FloorPlanner = SimpleFloorPlanner;

        fn without_witnesses(&self) -> Self {
            Self {
                left: Value::unknown(),
                right: Value::unknown(),
            }
        }

        fn configure(meta: &mut ConstraintSystem<Fr>) -> Self::Config {
            PoseidonConfig::configure(meta)
        }

        fn synthesize(
            &self,
            config: Self::Config,
            mut layouter: impl Layouter<Fr>,
        ) -> Result<(), ErrorFront> {
            // Hash the pair
            let _output = PoseidonHasher::hash_pair(
                layouter.namespace(|| "hash pair"),
                &config,
                self.left,
                self.right,
            )?;

            Ok(())
        }
    }

    #[test]
    fn test_poseidon_hash_pair() {
        // Test values
        let left = Fr::from(42);
        let right = Fr::from(1337);

        // Compute expected hash using native implementation
        let expected = PoseidonHasher::hash_pair_native(left, right);
        println!("Expected hash: {:?}", expected);

        // Create circuit
        let circuit = PoseidonTestCircuit {
            left: Value::known(left),
            right: Value::known(right),
        };

        // K=7 should be sufficient for Poseidon with WIDTH=3, RATE=2
        let k = 7;
        let prover = MockProver::run(k, &circuit, vec![]).unwrap();

        // Verify constraints
        assert!(prover.verify().is_ok(), "Circuit constraints should be satisfied");

        println!("✅ Poseidon hash_pair test passed");
    }

    #[test]
    fn test_poseidon_hash_single() {
        // Test that single-element hash produces consistent result
        let value = Fr::from(12345);

        let hash1 = PoseidonHasher::hash_single_native(value);
        let hash2 = PoseidonHasher::hash_single_native(value);

        assert_eq!(hash1, hash2, "Hash should be deterministic");
        assert_ne!(hash1, Fr::zero(), "Hash should not be zero");

        println!("✅ Poseidon hash_single test passed");
    }

    #[test]
    fn test_poseidon_not_zero() {
        // Critical test: Verify that Poseidon doesn't return zero for typical inputs
        let left = Fr::from(1);
        let right = Fr::from(2);

        let hash = PoseidonHasher::hash_pair_native(left, right);

        assert_ne!(hash, Fr::zero(), "CRITICAL: Poseidon must not return zero!");

        println!("✅ Poseidon returns non-zero hash");
    }
}
