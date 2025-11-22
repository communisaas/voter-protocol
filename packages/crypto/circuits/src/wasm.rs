// WASM Bindings for Browser-Native Halo2 Prover
//
// This module exposes the district membership circuit to JavaScript environments
// for browser-native zero-knowledge proof generation (8-15 seconds on mobile).
//
// ARCHITECTURE:
// - Circuit: K=14 single-tier district membership (12 levels, 4,096 addresses)
// - Proof size: ~4.6KB (SHPLONK with 3 public outputs)
// - Memory usage: 600-800MB WASM (mid-range mobile compatible)
//
// SECURITY:
// - KZG parameters loaded from Ethereum ceremony (test mode for development)
// - OsRng for cryptographic randomness (via getrandom/js feature)
// - All inputs validated before circuit execution
//
// USAGE (JavaScript):
// ```javascript
// import init, { Prover, generate_proof, verify_proof } from '@voter-protocol/crypto';
//
// await init(); // Load WASM module
//
// // Generate proof
// const proof = await generate_proof(
//   "0x1234...", // identity_commitment (hex)
//   "42",        // action_id (decimal)
//   0,           // leaf_index
//   ["0x5678...", ...] // merkle_path (12 hex strings)
// );
//
// // Verify proof
// const is_valid = await verify_proof(
//   proof,
//   ["0xabc...", "0xdef...", "0x123..."] // public_inputs: [district_root, nullifier, action_id]
// );
// ```

use wasm_bindgen::prelude::*;
use halo2_base::halo2_proofs::{
    arithmetic::Field, // For ZERO
    halo2curves::bn256::Fr,
    halo2curves::ff::PrimeField, // For from_str_vartime
};
use crate::district_membership_single_tier::DistrictMembershipCircuit;

/// Enable console.error() for panic messages in browser
#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

use halo2_base::{
    gates::circuit::{BaseCircuitParams, CircuitBuilderStage, builder::RangeCircuitBuilder},
    gates::RangeInstructions,
    halo2_proofs::{
        halo2curves::bn256::{Bn256, G1Affine},
        plonk::{keygen_pk, keygen_vk, ProvingKey, VerifyingKey},
        poly::{
            commitment::{Params, ParamsProver},
            kzg::commitment::ParamsKZG,
        },
    },
};
use rand::rngs::OsRng;

// ============================================================================
// EMBEDDED KZG PARAMETERS (Browser-Compatible)
// ============================================================================

/// Embedded K=14 test parameters (2MB) for browser compatibility
///
/// These params are embedded at compile time to avoid filesystem operations
/// which don't work in browser WASM environments.
const KZG_PARAMS_K14: &[u8] = include_bytes!("../kzg_params/test_params_k14.bin");

/// Load KZG ceremony parameters (browser-compatible)
///
/// Uses embedded parameters to avoid filesystem operations.
///
/// # Arguments
/// - `k`: Circuit size parameter (14 for production)
///
/// # Returns
/// - `Result<ParamsKZG<Bn256>, String>`: KZG parameters or error
///
/// # Performance
/// - K=14 (embedded): ~100-200ms deserialization
/// - Other k values: 5-10s on-the-fly generation
fn load_ceremony_params_wasm(k: usize) -> Result<ParamsKZG<Bn256>, String> {
    match k {
        14 => {
            // Use embedded K=14 parameters
            ParamsKZG::<Bn256>::read(&mut KZG_PARAMS_K14)
                .map_err(|e| format!("Failed to deserialize embedded K=14 params: {}", e))
        }
        _ => {
            // Generate on-the-fly for non-standard k values
            Ok(ParamsKZG::<Bn256>::setup(k as u32, OsRng))
        }
    }
}

/// WASM-compatible prover wrapper
///
/// This uses the single-tier K=14 circuit for mobile-optimized proving.
/// Proving keys are cached after first initialization (~5-10 seconds keygen).
#[wasm_bindgen]
pub struct Prover {
    k: usize,
    params: ParamsKZG<Bn256>,
    pk: ProvingKey<G1Affine>,
    vk: VerifyingKey<G1Affine>,
    config_params: BaseCircuitParams,
    break_points: Vec<Vec<usize>>,
}

#[wasm_bindgen]
impl Prover {
    /// Initialize prover with circuit parameters
    ///
    /// **Performance**: First initialization takes 5-10 seconds (key generation).
    /// Keys are cached in this instance for subsequent proofs.
    ///
    /// **WASM Testing Mode**: Automatically uses test KZG parameters in browser.
    /// Production mode requires downloading Ethereum ceremony parameters to IPFS.
    ///
    /// # Arguments
    /// - `k`: Circuit size parameter (14 for production, 12 for testing)
    ///
    /// # Returns
    /// - `Result<Prover, JsValue>`: Initialized prover or error message
    #[wasm_bindgen(constructor)]
    pub fn new(k: usize) -> Result<Prover, JsValue> {
        // Basic validation
        if k < 10 || k > 20 {
            return Err(JsValue::from_str(&format!("Invalid k={}, must be between 10 and 20", k)));
        }

        // Create builder in Keygen stage to determine circuit shape
        let mut builder = RangeCircuitBuilder::from_stage(CircuitBuilderStage::Keygen).use_k(k);
        builder.set_lookup_bits(8);
        builder.set_instance_columns(1); // Circuit has 1 instance column with 3 public outputs

        // Create dummy circuit for keygen (shape determination only)
        let dummy_circuit = DistrictMembershipCircuit {
            identity_commitment: Fr::ZERO,
            leaf_index: 0,
            merkle_path: vec![Fr::ZERO; 12],
            action_id: Fr::ZERO,
        };

        // Run circuit to populate builder (keygen stage)
        let range = builder.range_chip();
        let gate = range.gate();
        let ctx = builder.main(0);
        let (district_root, nullifier, action_id_out) =
            dummy_circuit.verify_membership(ctx, gate);

        // Populate assigned_instances for 3 public outputs
        builder.assigned_instances.clear();
        builder.assigned_instances.push(vec![district_root, nullifier, action_id_out]);

        // Calculate circuit parameters (9 blinding rows is standard)
        let config_params = builder.calculate_params(Some(9));

        // Load KZG parameters (test mode for WASM)
        let params = load_ceremony_params_wasm(k)
            .map_err(|e| JsValue::from_str(&format!("Failed to load KZG params: {}", e)))?;

        // Generate verification key
        let vk = keygen_vk(&params, &builder)
            .map_err(|e| JsValue::from_str(&format!("Failed to generate verification key: {:?}", e)))?;

        // Generate proving key
        let pk = keygen_pk(&params, vk.clone(), &builder)
            .map_err(|e| JsValue::from_str(&format!("Failed to generate proving key: {:?}", e)))?;

        // Save break points for future proving
        let break_points = builder.break_points();

        Ok(Prover {
            k,
            params,
            pk,
            vk,
            config_params,
            break_points,
        })
    }

    /// Generate zero-knowledge proof for district membership
    ///
    /// **Performance**: 8-15 seconds on mid-range mobile, ~1-2 seconds on desktop.
    ///
    /// # Arguments
    /// - `identity_commitment`: Hex string (Fr field element, e.g., "0x1234...")
    /// - `action_id`: Decimal string (e.g., "555")
    /// - `leaf_index`: Position in district tree (0-4095 for 12 levels)
    /// - `merkle_path`: Array of 12 hex strings (sibling hashes)
    ///
    /// # Returns
    /// - Proof bytes (Uint8Array, ~4.6KB)
    ///
    /// # Public Outputs (verified on-chain)
    /// 1. district_root: Merkle root of district tree
    /// 2. nullifier: Poseidon(identity, action_id) - prevents double-voting
    /// 3. action_id: Exposed for authorization check
    #[wasm_bindgen]
    pub fn prove(
        &self,
        identity_commitment: &str,
        action_id: &str,
        leaf_index: usize,
        merkle_path: Vec<JsValue>,
    ) -> Result<Vec<u8>, JsValue> {
        // Parse identity_commitment from hex
        let identity = parse_fr_hex(identity_commitment)?;

        // Parse action_id (accept both hex "0x..." and decimal "555" formats)
        let action = if action_id.starts_with("0x") || action_id.starts_with("0X") {
            // Hex format (e.g., "0x0000...002")
            parse_fr_hex(action_id)?
        } else {
            // Decimal format (e.g., "555")
            Fr::from_str_vartime(action_id)
                .ok_or_else(|| JsValue::from_str(&format!("Invalid action_id: {}", action_id)))?
        };

        // Parse merkle_path from hex strings
        let path: Result<Vec<Fr>, JsValue> = merkle_path
            .iter()
            .enumerate()
            .map(|(i, val)| {
                let hex = val.as_string()
                    .ok_or_else(|| JsValue::from_str(&format!("merkle_path[{}] is not a string", i)))?;
                parse_fr_hex(&hex)
            })
            .collect();
        let path = path?;

        // Validate merkle_path length
        if path.len() != 12 {
            return Err(JsValue::from_str(&format!(
                "Invalid merkle_path length: got {}, expected 12 siblings for single-tier tree",
                path.len()
            )));
        }

        // Build circuit
        let circuit = DistrictMembershipCircuit {
            identity_commitment: identity,
            action_id: action,
            leaf_index,
            merkle_path: path,
        };

        // Create builder in Prover stage (witness generation only)
        let mut builder = RangeCircuitBuilder::prover(
            self.config_params.clone(),
            self.break_points.clone(),
        );

        // Run circuit with actual witness data
        let range = builder.range_chip();
        let gate = range.gate();
        let ctx = builder.main(0);
        let (district_root, nullifier, action_id_out) =
            circuit.verify_membership(ctx, gate);

        // Populate assigned_instances for 3 public outputs
        builder.assigned_instances.clear();
        builder.assigned_instances.push(vec![district_root, nullifier, action_id_out]);

        // Extract public instance values (Fr values, not AssignedValue)
        let public_instances = vec![
            *district_root.value(),
            *nullifier.value(),
            *action_id_out.value(),
        ];

        // Generate proof using SHPLONK KZG commitment scheme + Blake2b transcript
        use halo2_base::halo2_proofs::{
            poly::kzg::{
                multiopen::ProverSHPLONK,
                commitment::KZGCommitmentScheme,
            },
            transcript::{Blake2bWrite, Challenge255, TranscriptWriterBuffer},
            plonk::create_proof,
        };

        let mut transcript = Blake2bWrite::<_, _, Challenge255<_>>::init(vec![]);

        create_proof::<
            KZGCommitmentScheme<Bn256>,
            ProverSHPLONK<'_, Bn256>,
            Challenge255<_>,
            _,
            Blake2bWrite<Vec<u8>, G1Affine, _>,
            _,
        >(
            &self.params,
            &self.pk,
            &[builder],
            &[&[&public_instances]],
            OsRng, // Cryptographically secure randomness
            &mut transcript,
        )
        .map_err(|e| JsValue::from_str(&format!("Proof generation failed: {:?}", e)))?;

        Ok(transcript.finalize())
    }

    /// Verify zero-knowledge proof
    ///
    /// **Performance**: ~50-100ms (fast verification).
    ///
    /// # Arguments
    /// - `proof`: Proof bytes (Uint8Array from prove())
    /// - `public_inputs`: Array of 3 hex strings [district_root, nullifier, action_id]
    ///
    /// # Returns
    /// - `true` if proof is valid, `false` if invalid
    #[wasm_bindgen]
    pub fn verify(
        &self,
        proof: &[u8],
        public_inputs: Vec<JsValue>,
    ) -> Result<bool, JsValue> {
        // Validate public_inputs length
        if public_inputs.len() != 3 {
            return Err(JsValue::from_str(&format!(
                "Invalid public_inputs length: got {}, expected 3 values [district_root, nullifier, action_id]",
                public_inputs.len()
            )));
        }

        // Parse public_inputs from hex strings
        let inputs: Result<Vec<Fr>, JsValue> = public_inputs
            .iter()
            .enumerate()
            .map(|(i, val)| {
                let hex = val.as_string()
                    .ok_or_else(|| JsValue::from_str(&format!("public_inputs[{}] is not a string", i)))?;
                parse_fr_hex(&hex)
            })
            .collect();
        let inputs = inputs?;

        // Verify proof using SHPLONK KZG verifier + Blake2b transcript
        use halo2_base::halo2_proofs::{
            poly::kzg::{
                multiopen::VerifierSHPLONK,
                strategy::SingleStrategy,
            },
            transcript::{Blake2bRead, Challenge255, TranscriptReadBuffer},
            plonk::verify_proof,
        };

        let verifier_params = self.params.verifier_params();
        let strategy = SingleStrategy::new(&self.params);
        let mut transcript = Blake2bRead::<_, _, Challenge255<_>>::init(proof);

        let result = verify_proof::<
            halo2_base::halo2_proofs::poly::kzg::commitment::KZGCommitmentScheme<Bn256>,
            VerifierSHPLONK<'_, Bn256>,
            Challenge255<G1Affine>,
            Blake2bRead<&[u8], G1Affine, Challenge255<G1Affine>>,
            SingleStrategy<'_, Bn256>,
        >(
            verifier_params,
            &self.vk,
            strategy,
            &[&[&inputs]],
            &mut transcript,
        );

        match result {
            Ok(_) => Ok(true),
            Err(e) => Err(JsValue::from_str(&format!("Proof verification failed: {:?}", e))),
        }
    }

    /// Get circuit size parameter
    #[wasm_bindgen]
    pub fn circuit_size(&self) -> usize {
        self.k
    }
}

/// Standalone proof generation (convenience function)
///
/// This creates a new prover instance for a single proof. For multiple proofs,
/// reuse a Prover instance to avoid key generation overhead.
#[wasm_bindgen]
pub fn generate_proof(
    identity_commitment: &str,
    action_id: &str,
    leaf_index: usize,
    merkle_path: Vec<JsValue>,
    k: Option<usize>,
) -> Result<Vec<u8>, JsValue> {
    let k = k.unwrap_or(14); // Default K=14 for production
    let prover = Prover::new(k)?;
    prover.prove(identity_commitment, action_id, leaf_index, merkle_path)
}

/// Standalone proof verification (convenience function)
#[wasm_bindgen]
pub fn verify_proof(
    proof: &[u8],
    public_inputs: Vec<JsValue>,
    k: Option<usize>,
) -> Result<bool, JsValue> {
    let k = k.unwrap_or(14);
    let prover = Prover::new(k)?;
    prover.verify(proof, public_inputs)
}

// ============================================================================
// HELPER FUNCTIONS (Not exposed to WASM)
// ============================================================================

/// Parse Fr field element from hex string (with or without "0x" prefix)
fn parse_fr_hex(hex: &str) -> Result<Fr, JsValue> {
    // Remove "0x" prefix if present
    let hex = hex.strip_prefix("0x").unwrap_or(hex);

    // Parse hex to bytes
    let bytes = hex::decode(hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid hex string: {}", e)))?;

    // Fr is 32 bytes (BN254 scalar field)
    if bytes.len() > 32 {
        return Err(JsValue::from_str(&format!(
            "Hex string too long: {} bytes (max 32 for Fr field element)",
            bytes.len()
        )));
    }

    // Pad to 32 bytes if needed (BIG-ENDIAN input from hex)
    let mut padded_be = vec![0u8; 32];
    let start = 32 - bytes.len();
    padded_be[start..].copy_from_slice(&bytes);

    // Fr::from_bytes expects LITTLE-ENDIAN, so reverse the bytes
    let mut padded_le = padded_be;
    padded_le.reverse();

    // Convert to Fr (little-endian bytes)
    Fr::from_bytes(&padded_le.try_into().unwrap())
        .into_option()
        .ok_or_else(|| JsValue::from_str("Invalid field element (out of range)"))
}

/// Convert Fr to hex string with "0x" prefix
fn fr_to_hex(fr: &Fr) -> String {
    // Fr::to_bytes() returns LITTLE-ENDIAN
    let mut bytes_le = fr.to_bytes();

    // Convert to BIG-ENDIAN for hex display
    let mut bytes_be: [u8; 32] = bytes_le.clone();
    bytes_be.reverse();

    format!("0x{}", hex::encode(bytes_be))
}

// ============================================================================
// POSEIDON HASH EXPORTS (For Shadow Atlas building)
// ============================================================================

/// Compute Poseidon hash of two field elements (for Merkle tree building)
///
/// This exposes the exact same Poseidon implementation used in the circuit,
/// ensuring Shadow Atlas hashes match ZK proof verification.
///
/// **CRITICAL**: This must use the same Axiom OptimizedPoseidonSpec as the circuit.
/// Any mismatch will cause ALL proofs to fail verification.
///
/// # Arguments
/// - `left`: Left element as hex string (e.g., "0x1234...")
/// - `right`: Right element as hex string (e.g., "0x5678...")
///
/// # Returns
/// - Hash as hex string (e.g., "0xabcd...")
///
/// # Example (JavaScript)
/// ```javascript
/// import init, { hash_pair } from '@voter-protocol/crypto';
/// await init();
///
/// const hash = hash_pair("0x3039", "0x10932"); // hash_pair(12345, 67890)
/// console.log(hash); // 0x1a52400b0566a6d2eb81fcf923da131e3f0db95e6e618ed4041225c78530a49a
/// ```
#[wasm_bindgen]
pub fn hash_pair(left_hex: &str, right_hex: &str) -> Result<String, JsValue> {
    use crate::poseidon_hash::{create_poseidon_hasher, hash_pair_with_hasher};
    use halo2_base::{
        gates::{
            circuit::{BaseCircuitParams, CircuitBuilderStage, builder::RangeCircuitBuilder},
            GateInstructions,
        },
        AssignedValue,
        Context,
    };

    // Parse inputs from hex
    let left = parse_fr_hex(left_hex)?;
    let right = parse_fr_hex(right_hex)?;

    // Create minimal circuit builder just for hashing
    // (We don't need the full proving infrastructure, just the gate chip)
    let mut builder = RangeCircuitBuilder::from_stage(CircuitBuilderStage::Keygen).use_k(10);
    builder.set_lookup_bits(8);

    let range = builder.range_chip();
    let gate = range.gate();
    let ctx = builder.main(0);

    // Assign inputs as witnesses
    let left_assigned = ctx.load_witness(left);
    let right_assigned = ctx.load_witness(right);

    // Create Poseidon hasher with Axiom spec (T=3, RATE=2, R_F=8, R_P=57)
    let mut poseidon = create_poseidon_hasher(ctx, gate);

    // Compute hash
    let hash = hash_pair_with_hasher(&mut poseidon, ctx, gate, left_assigned, right_assigned);

    // Extract value
    let hash_value = *hash.value();

    // Convert to hex
    Ok(fr_to_hex(&hash_value))
}

/// Compute Poseidon hash of a single field element (for leaf hashing)
///
/// # Arguments
/// - `value`: Field element as hex string
///
/// # Returns
/// - Hash as hex string
#[wasm_bindgen]
pub fn hash_single(value_hex: &str) -> Result<String, JsValue> {
    use crate::poseidon_hash::create_poseidon_hasher;
    use halo2_base::{
        gates::{
            circuit::{BaseCircuitParams, CircuitBuilderStage, builder::RangeCircuitBuilder},
            GateInstructions,
        },
        Context,
    };

    // Parse input
    let value = parse_fr_hex(value_hex)?;

    // Create minimal circuit builder
    let mut builder = RangeCircuitBuilder::from_stage(CircuitBuilderStage::Keygen).use_k(10);
    builder.set_lookup_bits(8);

    let range = builder.range_chip();
    let gate = range.gate();
    let ctx = builder.main(0);

    // Assign input
    let value_assigned = ctx.load_witness(value);

    // Create Poseidon hasher
    let mut poseidon = create_poseidon_hasher(ctx, gate);

    // Hash single element (Poseidon([value]))
    let hash = poseidon.hash_fix_len_array(ctx, gate, &[value_assigned]);

    // Extract value
    let hash_value = *hash.value();

    // Convert to hex
    Ok(fr_to_hex(&hash_value))
}

// ============================================================================
// TESTS (Rust-side only, not WASM)
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_fr_hex() {
        // Test with "0x" prefix
        let hex = "0x1234567890abcdef";
        let fr = parse_fr_hex(hex).expect("Should parse valid hex");
        assert_eq!(fr, Fr::from(0x1234567890abcdefu64));

        // Test without prefix
        let hex = "1234567890abcdef";
        let fr = parse_fr_hex(hex).expect("Should parse hex without prefix");
        assert_eq!(fr, Fr::from(0x1234567890abcdefu64));

        // Test short hex (auto-padding)
        let hex = "0x42";
        let fr = parse_fr_hex(hex).expect("Should parse short hex");
        assert_eq!(fr, Fr::from(66));
    }

    #[test]
    fn test_parse_fr_hex_invalid() {
        // Invalid hex characters
        let hex = "0xGGGG";
        assert!(parse_fr_hex(hex).is_err());

        // Too long (>32 bytes)
        let hex = format!("0x{}", "ff".repeat(33));
        assert!(parse_fr_hex(&hex).is_err());
    }

    #[test]
    fn test_fr_to_hex() {
        let fr = Fr::from(0x1234567890abcdefu64);
        let hex = fr_to_hex(&fr);
        assert!(hex.starts_with("0x"));
        assert_eq!(hex.len(), 66); // "0x" + 64 hex chars (32 bytes)
    }
}
