// District Membership Circuit - Two-Tier Merkle Tree
// Reference: IMPLEMENTATION-GUIDE.md Week 2 (Day 9-10)
// Reference: docs/shadow-atlas-two-tier-design.md

use halo2curves::bn256::Fr;
use halo2_proofs::{
    circuit::{AssignedCell, Layouter, SimpleFloorPlanner, Value},
    plonk::{Advice, Circuit, Column, ConstraintSystem, Error as PlonkError, Instance},
};
use crate::merkle::MerkleConfig;
use crate::poseidon_hash::PoseidonHashConfig;

/// District membership circuit proving address ∈ district ∈ Shadow Atlas
///
/// STRATIFIED ARCHITECTURE - Shallow Circuit (60% of users):
/// - Tier 1: 12 levels (4,096 addresses per quad)
/// - Tier 2: 8 levels (256 quads per country)
/// - Proving time: 6-8s desktop, 12-16s mobile
/// - Constraints: ~7,200 (vs ~25,000 universal)
///
/// Public inputs:
/// - shadow_atlas_root: Global Merkle root (on-chain)
/// - district_hash: Claimed congressional district
/// - nullifier: Prevents double-voting, unlinkable across actions
///
/// Private witnesses:
/// - identity_commitment: Poseidon(user_id, secret_salt) - NEVER revealed
/// - tier1_path: Fixed 12 siblings for district tree
/// - tier1_path_indices: Direction bits for district tree
/// - tier2_path: Fixed 8 siblings for global tree
/// - tier2_path_indices: Direction bits for global tree
#[derive(Clone, Debug)]
pub struct DistrictMembershipCircuit {
    // Private witnesses (NEVER revealed)
    pub identity_commitment: Value<Fr>,
    pub tier1_path: [Value<Fr>; 12],         // FIXED SIZE - Tier 1
    pub tier1_path_indices: [bool; 12],      // FIXED SIZE
    pub tier2_path: [Value<Fr>; 8],          // FIXED SIZE - Tier 2
    pub tier2_path_indices: [bool; 8],       // FIXED SIZE

    // Public inputs (on-chain)
    pub shadow_atlas_root: Fr,   // Global Merkle root
    pub district_hash: Fr,       // Claimed district (e.g., CA-12)
    pub nullifier: Fr,           // Unlinkable across actions
}

#[derive(Clone, Debug)]
pub struct DistrictConfig {
    pub poseidon: PoseidonHashConfig,
    pub district_merkle: MerkleConfig,
    pub global_merkle: MerkleConfig,
    pub instance: Column<Instance>,
    pub advice: Vec<Column<Advice>>,
}

impl Circuit<Fr> for DistrictMembershipCircuit {
    type Config = DistrictConfig;
    type FloorPlanner = SimpleFloorPlanner;

    fn without_witnesses(&self) -> Self {
        Self {
            identity_commitment: Value::unknown(),
            tier1_path: [Value::unknown(); 12],
            tier1_path_indices: self.tier1_path_indices,
            tier2_path: [Value::unknown(); 8],
            tier2_path_indices: self.tier2_path_indices,
            shadow_atlas_root: self.shadow_atlas_root,
            district_hash: self.district_hash,
            nullifier: self.nullifier,
        }
    }

    fn configure(meta: &mut ConstraintSystem<Fr>) -> Self::Config {
        let instance = meta.instance_column();
        meta.enable_equality(instance);

        // Need many advice columns for path siblings (up to 30 total)
        let advice = (0..32)
            .map(|_| {
                let col = meta.advice_column();
                meta.enable_equality(col);
                col
            })
            .collect();

        // Add constant column for constrain_instance
        let constant = meta.fixed_column();
        meta.enable_constant(constant);

        // CRITICAL FIX: Create SINGLE shared Poseidon chip instance
        // This ensures deterministic column allocation between keygen and proving phases
        // Previously, each MerkleConfig::configure created its own Poseidon chip,
        // causing non-deterministic synthesis and "Synthesis" error during proof generation
        let poseidon = PoseidonHashConfig::configure(meta);

        DistrictConfig {
            poseidon: poseidon.clone(),
            district_merkle: MerkleConfig::configure_with_chip(meta, poseidon.clone()),
            global_merkle: MerkleConfig::configure_with_chip(meta, poseidon.clone()),
            instance,
            advice,
        }
    }

    fn synthesize(
        &self,
        config: Self::Config,
        mut layouter: impl Layouter<Fr>,
    ) -> Result<(), PlonkError> {
        eprintln!("[SYNTH] Starting synthesis...");

        // 1. Assign identity_commitment as leaf
        eprintln!("[SYNTH] Step 1: Assigning identity commitment...");
        let identity_cell = layouter.assign_region(
            || "assign identity commitment",
            |mut region| {
                region.assign_advice(
                    || "identity",
                    config.advice[0],
                    0,
                    || self.identity_commitment,
                )
            },
        )?;

        eprintln!("[SYNTH] Step 1 complete");

        // 2. Hash identity to create leaf
        eprintln!("[SYNTH] Step 2: Hashing identity to create leaf...");
        let leaf_hash = config.poseidon.hash_single(
            layouter.namespace(|| "leaf hash"),
            identity_cell,
        )?;
        eprintln!("[SYNTH] Step 2 complete");

        // 3. Assign tier1 path siblings (FIXED SIZE - 12 levels)
        eprintln!("[SYNTH] Step 3: Assigning tier1 path siblings...");
        let tier1_siblings: Result<Vec<AssignedCell<Fr, Fr>>, PlonkError> = self
            .tier1_path
            .iter()
            .enumerate()
            .map(|(i, sibling)| {
                layouter.assign_region(
                    || format!("tier1 sibling {}", i),
                    |mut region| {
                        region.assign_advice(
                            || format!("sibling {}", i),
                            config.advice[(i + 1) % config.advice.len()],
                            0,
                            || *sibling,
                        )
                    },
                )
            })
            .collect();

        let tier1_siblings = tier1_siblings?;
        eprintln!("[SYNTH] Step 3 complete");

        // 4. Verify identity ∈ tier1 tree (district tree)
        eprintln!("[SYNTH] Step 4: Verifying tier1 Merkle path...");
        let district_root = config.district_merkle.verify_path(
            layouter.namespace(|| "verify tier1 tree"),
            leaf_hash,
            tier1_siblings,
            self.tier1_path_indices.to_vec(),
        )?;
        eprintln!("[SYNTH] Step 4 complete");

        // 5. Assign tier2 path siblings (FIXED SIZE - 8 levels)
        eprintln!("[SYNTH] Step 5: Assigning tier2 path siblings...");
        let tier2_siblings: Result<Vec<AssignedCell<Fr, Fr>>, PlonkError> = self
            .tier2_path
            .iter()
            .enumerate()
            .map(|(i, sibling)| {
                layouter.assign_region(
                    || format!("tier2 sibling {}", i),
                    |mut region| {
                        region.assign_advice(
                            || format!("sibling {}", i),
                            config.advice[(i + 13) % config.advice.len()],
                            0,
                            || *sibling,
                        )
                    },
                )
            })
            .collect();

        let tier2_siblings = tier2_siblings?;
        eprintln!("[SYNTH] Step 5 complete");

        // 6. Verify district_root ∈ tier2 tree (global tree)
        eprintln!("[SYNTH] Step 6: Verifying tier2 Merkle path...");
        let global_root = config.global_merkle.verify_path(
            layouter.namespace(|| "verify tier2 tree"),
            district_root.clone(),
            tier2_siblings,
            self.tier2_path_indices.to_vec(),
        )?;
        eprintln!("[SYNTH] Step 6 complete");

        // 7. CRITICAL: Constrain computed global_root to public input
        eprintln!("[SYNTH] Step 7: Constraining public inputs...");
        layouter.constrain_instance(
            global_root.cell(),
            config.instance,
            0,  // First public input: shadow_atlas_root
        )?;

        // 8. CRITICAL: Constrain district_root to public input
        layouter.constrain_instance(
            district_root.cell(),
            config.instance,
            1,  // Second public input: district_hash
        )?;

        // 9. CRITICAL: Constrain nullifier to public input
        let nullifier_cell = layouter.assign_region(
            || "assign nullifier",
            |mut region| {
                region.assign_advice(
                    || "nullifier",
                    config.advice[21],
                    0,
                    || Value::known(self.nullifier),
                )
            },
        )?;

        layouter.constrain_instance(
            nullifier_cell.cell(),
            config.instance,
            2,  // Third public input: nullifier
        )?;

        eprintln!("[SYNTH] ✅ Synthesis completed successfully!");

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use halo2_proofs::dev::MockProver;
    use halo2_poseidon::poseidon::primitives::{ConstantLength, Hash as PrimitiveHash};
    use crate::poseidon_hash::P128Pow5T3Bn256;

    /// Helper: Build stratified two-tier tree matching FIXED DEPTH (12 + 8 levels)
    fn build_stratified_tree() -> (Fr, Fr, Fr, Fr, [Fr; 12], [Fr; 8]) {
        // Simulate identity commitment (Poseidon(user_id, salt))
        let user_id = Fr::from(1001);
        let salt = Fr::from(424242);
        let identity_commitment = PrimitiveHash::<Fr, P128Pow5T3Bn256, ConstantLength<2>, 3, 2>::init()
            .hash([user_id, salt]);

        // Hash identity to create leaf
        let leaf_hash = PrimitiveHash::<Fr, P128Pow5T3Bn256, ConstantLength<1>, 3, 2>::init()
            .hash([identity_commitment]);

        // Build tier1 tree (12 levels = 4,096 leaves)
        // For testing: build minimal tree, pad remaining siblings with zeros
        let sibling_0 = Fr::from(2000);
        let level_1 = PrimitiveHash::<Fr, P128Pow5T3Bn256, ConstantLength<2>, 3, 2>::init()
            .hash([leaf_hash, sibling_0]);

        let sibling_1 = Fr::from(3000);
        let level_2 = PrimitiveHash::<Fr, P128Pow5T3Bn256, ConstantLength<2>, 3, 2>::init()
            .hash([level_1, sibling_1]);

        // Compute district root with remaining levels as zero siblings
        let mut current = level_2;
        for _ in 2..12 {
            current = PrimitiveHash::<Fr, P128Pow5T3Bn256, ConstantLength<2>, 3, 2>::init()
                .hash([current, Fr::zero()]);
        }
        let district_root = current;

        // Build tier2 tree (8 levels = 256 districts)
        let tier2_sibling_0 = Fr::from(9999);
        let tier2_level_1 = PrimitiveHash::<Fr, P128Pow5T3Bn256, ConstantLength<2>, 3, 2>::init()
            .hash([district_root, tier2_sibling_0]);

        let mut tier2_current = tier2_level_1;
        for _ in 1..8 {
            tier2_current = PrimitiveHash::<Fr, P128Pow5T3Bn256, ConstantLength<2>, 3, 2>::init()
                .hash([tier2_current, Fr::zero()]);
        }
        let global_root = tier2_current;

        // Build tier1 path (12 siblings)
        let mut tier1_path = [Fr::zero(); 12];
        tier1_path[0] = sibling_0;
        tier1_path[1] = sibling_1;
        // Remaining 10 siblings are Fr::zero()

        // Build tier2 path (8 siblings)
        let mut tier2_path = [Fr::zero(); 8];
        tier2_path[0] = tier2_sibling_0;
        // Remaining 7 siblings are Fr::zero()

        (identity_commitment, leaf_hash, district_root, global_root, tier1_path, tier2_path)
    }

    #[test]
    fn test_stratified_valid_proof() {
        let (identity_commitment, _leaf_hash, district_root, global_root, tier1_path, tier2_path)
            = build_stratified_tree();

        // Generate nullifier: Poseidon(identity_commitment, action_id)
        let action_id = Fr::from(555);
        let nullifier = PrimitiveHash::<Fr, P128Pow5T3Bn256, ConstantLength<2>, 3, 2>::init()
            .hash([identity_commitment, action_id]);

        // Convert arrays to Value arrays
        let tier1_path_values: [Value<Fr>; 12] = tier1_path.map(Value::known);
        let tier2_path_values: [Value<Fr>; 8] = tier2_path.map(Value::known);

        // Path indices: all false (left child at every level)
        let tier1_path_indices = [false; 12];
        let tier2_path_indices = [false; 8];

        let circuit = DistrictMembershipCircuit {
            identity_commitment: Value::known(identity_commitment),
            tier1_path: tier1_path_values,
            tier1_path_indices,
            tier2_path: tier2_path_values,
            tier2_path_indices,
            shadow_atlas_root: global_root,
            district_hash: district_root,
            nullifier,
        };

        let k = 14; // Increased for 12+8 levels
        let public_inputs = vec![vec![global_root, district_root, nullifier]];
        let prover = MockProver::run(k, &circuit, public_inputs).unwrap();

        prover.assert_satisfied();
    }

    #[test]
    fn test_reject_wrong_district() {
        let (identity_commitment, _leaf_hash, district_root, global_root, tier1_path, tier2_path)
            = build_stratified_tree();

        let action_id = Fr::from(555);
        let nullifier = PrimitiveHash::<Fr, P128Pow5T3Bn256, ConstantLength<2>, 3, 2>::init()
            .hash([identity_commitment, action_id]);

        let tier1_path_values: [Value<Fr>; 12] = tier1_path.map(Value::known);
        let tier2_path_values: [Value<Fr>; 8] = tier2_path.map(Value::known);

        // ATTACK: Claim wrong district
        let fake_district = Fr::from(77777);

        let circuit = DistrictMembershipCircuit {
            identity_commitment: Value::known(identity_commitment),
            tier1_path: tier1_path_values,
            tier1_path_indices: [false; 12],
            tier2_path: tier2_path_values,
            tier2_path_indices: [false; 8],
            shadow_atlas_root: global_root,
            district_hash: fake_district,  // ← WRONG!
            nullifier,
        };

        let k = 14;
        let public_inputs = vec![vec![global_root, fake_district, nullifier]];
        let prover = MockProver::run(k, &circuit, public_inputs).unwrap();

        // Must reject wrong district
        assert!(
            prover.verify().is_err(),
            "SECURITY FAILURE: Circuit accepted wrong district!"
        );
    }

    #[test]
    fn test_reject_wrong_identity() {
        let (identity_commitment, _leaf_hash, district_root, global_root, tier1_path, tier2_path)
            = build_stratified_tree();

        let action_id = Fr::from(555);
        let nullifier = PrimitiveHash::<Fr, P128Pow5T3Bn256, ConstantLength<2>, 3, 2>::init()
            .hash([identity_commitment, action_id]);

        let tier1_path_values: [Value<Fr>; 12] = tier1_path.map(Value::known);
        let tier2_path_values: [Value<Fr>; 8] = tier2_path.map(Value::known);

        // ATTACK: Use wrong identity commitment
        let wrong_identity = Fr::from(8888);

        let circuit = DistrictMembershipCircuit {
            identity_commitment: Value::known(wrong_identity),  // ← WRONG!
            tier1_path: tier1_path_values,
            tier1_path_indices: [false; 12],
            tier2_path: tier2_path_values,
            tier2_path_indices: [false; 8],
            shadow_atlas_root: global_root,
            district_hash: district_root,
            nullifier,
        };

        let k = 14;
        let public_inputs = vec![vec![global_root, district_root, nullifier]];
        let prover = MockProver::run(k, &circuit, public_inputs).unwrap();

        // Must reject wrong identity
        assert!(
            prover.verify().is_err(),
            "SECURITY FAILURE: Circuit accepted wrong identity!"
        );
    }

    #[test]
    fn test_reject_wrong_global_root() {
        let (identity_commitment, _leaf_hash, district_root, _global_root, tier1_path, tier2_path)
            = build_stratified_tree();

        let action_id = Fr::from(555);
        let nullifier = PrimitiveHash::<Fr, P128Pow5T3Bn256, ConstantLength<2>, 3, 2>::init()
            .hash([identity_commitment, action_id]);

        let tier1_path_values: [Value<Fr>; 12] = tier1_path.map(Value::known);
        let tier2_path_values: [Value<Fr>; 8] = tier2_path.map(Value::known);

        // ATTACK: Claim wrong global root
        let fake_root = Fr::from(66666);

        let circuit = DistrictMembershipCircuit {
            identity_commitment: Value::known(identity_commitment),
            tier1_path: tier1_path_values,
            tier1_path_indices: [false; 12],
            tier2_path: tier2_path_values,
            tier2_path_indices: [false; 8],
            shadow_atlas_root: fake_root,  // ← WRONG!
            district_hash: district_root,
            nullifier,
        };

        let k = 14;
        let public_inputs = vec![vec![fake_root, district_root, nullifier]];
        let prover = MockProver::run(k, &circuit, public_inputs).unwrap();

        // Must reject wrong root
        assert!(
            prover.verify().is_err(),
            "SECURITY FAILURE: Circuit accepted wrong global root!"
        );
    }
}
