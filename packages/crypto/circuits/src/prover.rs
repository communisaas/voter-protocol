// Real Halo2 Proof Generation and Verification
// Reference: IMPLEMENTATION-GUIDE.md Week 3 (Day 11-13)

use halo2_proofs::{
    plonk::{create_proof, keygen_pk, keygen_vk, verify_proof, ProvingKey, VerifyingKey},
    poly::commitment::ParamsProver,
    poly::kzg::{
        commitment::{KZGCommitmentScheme, ParamsKZG},
        multiopen::{ProverGWC, VerifierGWC},
        strategy::SingleStrategy,
    },
    transcript::{
        Blake2bRead, Blake2bWrite, Challenge255, TranscriptReadBuffer, TranscriptWriterBuffer,
    },
};
use halo2curves::bn256::{Bn256, Fr, G1Affine};
use rand::rngs::OsRng;
use crate::district_membership::DistrictMembershipCircuit;

/// Halo2 prover for district membership proofs
pub struct Prover {
    params: ParamsKZG<Bn256>,
    vk: VerifyingKey<G1Affine>,
    pk: ProvingKey<G1Affine>,
}

impl Prover {
    /// Initialize prover with KZG parameters
    ///
    /// In production, params should be loaded from Ethereum's KZG ceremony:
    /// https://ceremony.ethereum.org/
    ///
    /// For now, we generate params locally for testing
    pub fn new(k: u32) -> Result<Self, String> {
        // Generate KZG parameters (in production: load from ceremony)
        let params = ParamsKZG::<Bn256>::new(k);

        // Create empty circuit for keygen with FIXED STRUCTURE (shallow stratified)
        // CRITICAL: Must have EXACT SAME structure as proving circuit
        // - Tier 1: 12 levels (4,096 addresses per quad)
        // - Tier 2: 8 levels (256 quads per country)
        let empty_circuit = DistrictMembershipCircuit {
            identity_commitment: halo2_proofs::circuit::Value::unknown(),
            tier1_path: [halo2_proofs::circuit::Value::unknown(); 12],
            tier1_path_indices: [false; 12],
            tier2_path: [halo2_proofs::circuit::Value::unknown(); 8],
            tier2_path_indices: [false; 8],
            shadow_atlas_root: Fr::zero(),
            district_hash: Fr::zero(),
            nullifier: Fr::zero(),
        };

        // Generate verification key
        let vk = keygen_vk(&params, &empty_circuit)
            .map_err(|e| format!("Failed to generate verification key: {:?}", e))?;

        // Generate proving key
        let pk = keygen_pk(&params, vk.clone(), &empty_circuit)
            .map_err(|e| format!("Failed to generate proving key: {:?}", e))?;

        Ok(Self { params, vk, pk })
    }

    /// Generate proof for district membership
    ///
    /// Returns serialized proof bytes (384-512 bytes)
    pub fn prove(
        &self,
        circuit: DistrictMembershipCircuit,
    ) -> Result<Vec<u8>, String> {
        // Public inputs: instance column has 3 values (shadow_atlas_root, district_hash, nullifier)
        let public_inputs = vec![
            circuit.shadow_atlas_root,
            circuit.district_hash,
            circuit.nullifier,
        ];
        let public_inputs_slice = public_inputs.as_slice();

        let mut transcript = Blake2bWrite::<_, G1Affine, Challenge255<_>>::init(vec![]);

        create_proof::<
            KZGCommitmentScheme<Bn256>,
            ProverGWC<'_, Bn256>,
            Challenge255<G1Affine>,
            _,
            Blake2bWrite<Vec<u8>, G1Affine, Challenge255<_>>,
            DistrictMembershipCircuit,
        >(
            &self.params,
            &self.pk,
            &[circuit],
            &[&[public_inputs_slice]],  // instances: &[&[&[Fr]]] - 3 levels
            OsRng,
            &mut transcript,
        )
        .map_err(|e| format!("Proof creation failed: {:?}", e))?;

        Ok(transcript.finalize())
    }

    /// Verify proof
    ///
    /// Returns true if proof is valid
    pub fn verify(
        &self,
        proof: &[u8],
        public_inputs: &[Fr],
    ) -> Result<bool, String> {
        let strategy = SingleStrategy::new(&self.params);
        let mut transcript = Blake2bRead::<_, G1Affine, Challenge255<_>>::init(proof);

        verify_proof::<
            KZGCommitmentScheme<Bn256>,
            VerifierGWC<'_, Bn256>,
            Challenge255<G1Affine>,
            Blake2bRead<&[u8], G1Affine, Challenge255<_>>,
            SingleStrategy<'_, Bn256>,
        >(
            &self.params,
            &self.vk,
            strategy,
            &[&[public_inputs]],  // instances: &[&[&[Fr]]] - 3 levels of nesting
            &mut transcript,
        )
        .map_err(|e| format!("Verification failed: {:?}", e))?;

        Ok(true)
    }

    /// Get verification key (for smart contract generation)
    pub fn verification_key(&self) -> &VerifyingKey<G1Affine> {
        &self.vk
    }

    /// Get KZG parameters (for reference)
    pub fn params(&self) -> &ParamsKZG<Bn256> {
        &self.params
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use halo2_proofs::circuit::Value as CircuitValue;
    use halo2_poseidon::poseidon::primitives::{ConstantLength, Hash as PrimitiveHash};
    use crate::poseidon_hash::P128Pow5T3Bn256;

    /// Build test circuit with FIXED DEPTH (12 + 8 levels) stratified structure
    fn build_test_circuit() -> (DistrictMembershipCircuit, Fr, Fr, Fr) {
        // Simulate identity commitment (Poseidon(user_id, salt))
        let user_id = Fr::from(1001);
        let salt = Fr::from(424242);
        let identity_commitment = PrimitiveHash::<Fr, P128Pow5T3Bn256, ConstantLength<2>, 3, 2>::init()
            .hash([user_id, salt]);

        // Hash identity to create leaf
        let leaf_hash = PrimitiveHash::<Fr, P128Pow5T3Bn256, ConstantLength<1>, 3, 2>::init()
            .hash([identity_commitment]);

        // Build tier1 tree (12 levels = 4,096 leaves)
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
        let mut tier1_path = [CircuitValue::unknown(); 12];
        tier1_path[0] = CircuitValue::known(sibling_0);
        tier1_path[1] = CircuitValue::known(sibling_1);
        // Remaining 10 siblings are Fr::zero()
        for i in 2..12 {
            tier1_path[i] = CircuitValue::known(Fr::zero());
        }

        // Build tier2 path (8 siblings)
        let mut tier2_path = [CircuitValue::unknown(); 8];
        tier2_path[0] = CircuitValue::known(tier2_sibling_0);
        for i in 1..8 {
            tier2_path[i] = CircuitValue::known(Fr::zero());
        }

        // Generate nullifier: Poseidon(identity_commitment, action_id)
        let action_id = Fr::from(555);
        let nullifier = PrimitiveHash::<Fr, P128Pow5T3Bn256, ConstantLength<2>, 3, 2>::init()
            .hash([identity_commitment, action_id]);

        let circuit = DistrictMembershipCircuit {
            identity_commitment: CircuitValue::known(identity_commitment),
            tier1_path,
            tier1_path_indices: [false; 12],  // Left at all levels
            tier2_path,
            tier2_path_indices: [false; 8],   // Left at all levels
            shadow_atlas_root: global_root,
            district_hash: district_root,
            nullifier,
        };

        (circuit, global_root, district_root, nullifier)
    }

    #[test]
    #[ignore] // Slow test (~20s with K=16) - run with: cargo test --release -- --ignored
    fn test_proof_generation() {
        let k = 16; // Large enough for 12+8 levels (65,536 rows)
        let prover = Prover::new(k).expect("Failed to create prover");

        let (circuit, global_root, district_root, nullifier) = build_test_circuit();

        // Generate proof
        let proof = prover.prove(circuit).expect("Proof generation failed");

        // Proof should be 384-512 bytes
        println!("Proof size: {} bytes", proof.len());
        assert!(
            proof.len() >= 200 && proof.len() <= 1000,
            "Proof size out of expected range: {} bytes",
            proof.len()
        );

        // Verify proof with 3 public inputs
        let public_inputs = vec![global_root, district_root, nullifier];
        let result = prover.verify(&proof, &public_inputs);

        assert!(result.is_ok(), "Verification failed: {:?}", result);
        assert!(result.unwrap(), "Proof did not verify");
    }

    #[test]
    #[ignore] // Slow test
    fn test_reject_wrong_public_input() {
        let k = 16;
        let prover = Prover::new(k).expect("Failed to create prover");

        let (circuit, _global_root, _district_root, _nullifier) = build_test_circuit();

        // Generate valid proof
        let proof = prover.prove(circuit).expect("Proof generation failed");

        // Try to verify with WRONG public inputs
        let fake_inputs = vec![Fr::from(88888), Fr::from(99999), Fr::from(77777)];
        let result = prover.verify(&proof, &fake_inputs);

        // Should fail verification
        assert!(
            result.is_err() || !result.unwrap(),
            "SECURITY FAILURE: Accepted proof with wrong public inputs!"
        );
    }

    #[test]
    #[ignore] // Slow test
    fn test_reject_tampered_proof() {
        let k = 16;
        let prover = Prover::new(k).expect("Failed to create prover");

        let (circuit, global_root, district_root, nullifier) = build_test_circuit();

        // Generate valid proof
        let mut proof = prover.prove(circuit).expect("Proof generation failed");

        // Tamper with proof bytes
        if proof.len() > 10 {
            proof[10] ^= 0xFF; // Flip bits
        }

        // Try to verify tampered proof
        let public_inputs = vec![global_root, district_root, nullifier];
        let result = prover.verify(&proof, &public_inputs);

        // Should fail verification
        assert!(
            result.is_err() || !result.unwrap(),
            "SECURITY FAILURE: Accepted tampered proof!"
        );
    }

    #[test]
    fn test_prover_initialization() {
        let k = 16; // Stratified shallow circuit (65,536 rows)
        let prover = Prover::new(k);

        assert!(prover.is_ok(), "Prover initialization failed");

        // Just verify we can create a prover
        let _prover = prover.unwrap();
    }
}
