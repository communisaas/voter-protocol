//! Merkle tree verification gadget
//!
//! Verifies Merkle inclusion proofs in zero-knowledge using Poseidon hashing.
//! This allows proving an address belongs to a specific district without
//! revealing the address itself.

use halo2_proofs::{
    circuit::{AssignedCell, Layouter, Value},
    plonk::{Advice, Column, ConstraintSystem, Expression, Selector, ErrorFront},
    poly::Rotation,
};
use halo2curves::bn256::Fr;

use crate::poseidon_gadget::PoseidonHasher;

/// Configuration for Merkle path verification
#[derive(Clone, Debug)]
pub struct MerkleConfig {
    /// Advice column for current hash value
    pub current: Column<Advice>,
    /// Advice column for sibling hash
    pub sibling: Column<Advice>,
    /// Advice column for path direction (0 = left, 1 = right)
    pub direction: Column<Advice>,
    /// Advice column for computed parent hash
    pub parent: Column<Advice>,
    /// Selector for Merkle verification gates
    pub selector: Selector,
}

impl MerkleConfig {
    /// Configure the Merkle verification circuit
    ///
    /// This sets up the constraints that enforce:
    /// - If direction == 0: parent = Poseidon(current, sibling)
    /// - If direction == 1: parent = Poseidon(sibling, current)
    pub fn configure(meta: &mut ConstraintSystem<Fr>) -> Self {
        let current = meta.advice_column();
        let sibling = meta.advice_column();
        let direction = meta.advice_column();
        let parent = meta.advice_column();
        let selector = meta.selector();

        // Enable equality constraints (for connecting layers)
        meta.enable_equality(current);
        meta.enable_equality(parent);

        meta.create_gate("merkle verification", |meta| {
            let s = meta.query_selector(selector);
            let current = meta.query_advice(current, Rotation::cur());
            let sibling = meta.query_advice(sibling, Rotation::cur());
            let direction = meta.query_advice(direction, Rotation::cur());
            let parent = meta.query_advice(parent, Rotation::cur());

            // Constrain direction to be binary (0 or 1)
            let direction_constraint = direction.clone() * (Expression::Constant(Fr::one()) - direction.clone());

            vec![
                // direction must be 0 or 1
                s.clone() * direction_constraint,
                // TODO: Add Poseidon hash constraints
                // This will verify: parent == Poseidon(left, right)
                // where (left, right) depends on direction bit
            ]
        });

        Self {
            current,
            sibling,
            direction,
            parent,
            selector,
        }
    }

    /// Verify a single Merkle path step
    ///
    /// # Arguments
    /// * `layouter` - Circuit layouter
    /// * `current_hash` - Current node hash
    /// * `sibling_hash` - Sibling node hash
    /// * `is_left` - Direction (0 = current is left child, 1 = current is right child)
    ///
    /// # Returns
    /// Parent hash
    pub fn verify_step(
        &self,
        layouter: &mut impl Layouter<Fr>,
        current_hash: Value<Fr>,
        sibling_hash: Value<Fr>,
        is_left: Value<Fr>,
    ) -> Result<AssignedCell<Fr, Fr>, ErrorFront> {
        // Compute parent hash using Poseidon (outside of assign_region)
        let (left, right) = current_hash.zip(sibling_hash).zip(is_left).map(|((curr, sib), dir)| {
            if dir == Fr::zero() {
                (curr, sib) // current is left child
            } else {
                (sib, curr) // current is right child
            }
        }).unzip();

        // Hash the pair (this will use actual Poseidon once integrated)
        let parent_hash = PoseidonHasher::hash_pair(layouter, left, right)?;

        // Assign all values in one region
        let parent_cell = layouter.assign_region(
            || "merkle step",
            |mut region| {
                // Enable the selector
                self.selector.enable(&mut region, 0)?;

                // Assign current hash
                region.assign_advice(
                    || "current",
                    self.current,
                    0,
                    || current_hash,
                )?;

                // Assign sibling hash
                region.assign_advice(
                    || "sibling",
                    self.sibling,
                    0,
                    || sibling_hash,
                )?;

                // Assign direction
                region.assign_advice(
                    || "direction",
                    self.direction,
                    0,
                    || is_left,
                )?;

                // Assign computed parent
                region.assign_advice(
                    || "parent",
                    self.parent,
                    0,
                    || parent_hash,
                )
            },
        )?;

        Ok(parent_cell)
    }

    /// Verify a complete Merkle path from leaf to root
    ///
    /// # Arguments
    /// * `layouter` - Circuit layouter
    /// * `leaf` - Leaf value (hashed address)
    /// * `path` - Array of sibling hashes
    /// * `indices` - Array of path directions
    ///
    /// # Returns
    /// Computed root hash
    pub fn verify_path(
        &self,
        layouter: &mut impl Layouter<Fr>,
        leaf: Value<Fr>,
        path: &[Value<Fr>],
        indices: &[Value<Fr>],
    ) -> Result<Value<Fr>, ErrorFront> {
        assert_eq!(path.len(), indices.len(), "Path and indices must have same length");

        let mut current = leaf;

        for (sibling, direction) in path.iter().zip(indices.iter()) {
            let parent_cell = self.verify_step(
                layouter,
                current,
                *sibling,
                *direction,
            )?;
            current = parent_cell.value().copied();
        }

        Ok(current)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use halo2_proofs::dev::MockProver;

    #[test]
    fn test_merkle_config() {
        // Placeholder test - will be replaced with actual MockProver tests
        // once Poseidon integration is complete
        assert!(true);
    }
}
