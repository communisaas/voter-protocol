//! VOTER Protocol Zero-Knowledge Circuits
//!
//! This crate implements Halo2 circuits for verifying district membership
//! without revealing the user's address. Uses Poseidon hashing and Merkle
//! tree verification for privacy-preserving civic participation.

#![deny(missing_docs)]
#![deny(unsafe_code)]

pub mod district_membership;
pub mod merkle;
pub mod poseidon_gadget;
pub mod utils;

use wasm_bindgen::prelude::*;

/// Enable console.error() in WASM for debugging
///
/// This initializes panic hooks to provide better error messages when
/// the WASM module panics. Should be called automatically on module load.
#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

/// WASM export: Generate a district membership proof
///
/// # Arguments
/// * `address` - User's Ethereum address (hex string)
/// * `merkle_path` - Array of hex strings (Merkle siblings)
/// * `merkle_path_indices` - Array of 0/1 indicating left/right
/// * `merkle_root` - Shadow Atlas Merkle root (hex string)
/// * `district_hash` - Hash of claimed district (hex string)
///
/// # Returns
/// Serialized proof bytes (384-512 bytes)
///
/// # Example
/// ```typescript
/// const proof = await prove_district_membership(
///   "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
///   ["0x123...", "0x456..."],
///   [0, 1],
///   "0x24fbb8669f430c88a6fefa469d5966e88bf38858927b8c3d2629d555a3bc5212",
///   "0xabcdef..."
/// );
/// ```
#[wasm_bindgen]
pub fn prove_district_membership(
    address: String,
    merkle_path: Vec<String>,
    merkle_path_indices: Vec<u8>,
    merkle_root: String,
    district_hash: String,
) -> Result<Vec<u8>, JsValue> {
    // Parse hex strings to field elements
    let address_field = utils::hex_to_field(&address)
        .map_err(|e| JsValue::from_str(&format!("Invalid address: {}", e)))?;

    let path_fields: Result<Vec<_>, _> = merkle_path
        .iter()
        .map(|h| utils::hex_to_field(h))
        .collect();
    let path_fields = path_fields
        .map_err(|e| JsValue::from_str(&format!("Invalid merkle path: {}", e)))?;

    let indices_fields: Vec<_> = merkle_path_indices
        .iter()
        .map(|&idx| if idx == 0 {
            halo2curves::bn256::Fr::zero()
        } else {
            halo2curves::bn256::Fr::one()
        })
        .collect();

    let root_field = utils::hex_to_field(&merkle_root)
        .map_err(|e| JsValue::from_str(&format!("Invalid merkle root: {}", e)))?;

    let district_field = utils::hex_to_field(&district_hash)
        .map_err(|e| JsValue::from_str(&format!("Invalid district hash: {}", e)))?;

    // Create circuit instance
    use district_membership::DistrictMembershipCircuit;
    use halo2_proofs::circuit::Value;

    let circuit = DistrictMembershipCircuit {
        address: Value::known(address_field),
        merkle_path: path_fields.into_iter().map(Value::known).collect(),
        merkle_path_indices: indices_fields.into_iter().map(Value::known).collect(),
        merkle_root: Value::known(root_field),
        district_hash: Value::known(district_field),
    };

    // Generate proof (this takes 4-6 seconds)
    let proof_bytes = district_membership::generate_proof(circuit)
        .map_err(|e| JsValue::from_str(&format!("Proof generation failed: {}", e)))?;

    Ok(proof_bytes)
}

/// WASM export: Verify a district membership proof
///
/// # Arguments
/// * `proof` - Serialized proof bytes
/// * `public_inputs` - Array of public inputs [merkle_root, district_hash]
///
/// # Returns
/// `true` if proof is valid, `false` otherwise
#[wasm_bindgen]
pub fn verify_district_proof(
    proof: Vec<u8>,
    public_inputs: Vec<String>,
) -> Result<bool, JsValue> {
    if public_inputs.len() != 2 {
        return Err(JsValue::from_str("Expected 2 public inputs"));
    }

    let merkle_root = utils::hex_to_field(&public_inputs[0])
        .map_err(|e| JsValue::from_str(&format!("Invalid merkle root: {}", e)))?;

    let district_hash = utils::hex_to_field(&public_inputs[1])
        .map_err(|e| JsValue::from_str(&format!("Invalid district hash: {}", e)))?;

    district_membership::verify_proof(&proof, &[merkle_root, district_hash])
        .map_err(|e| JsValue::from_str(&format!("Verification failed: {}", e)))
}
