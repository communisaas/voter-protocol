//! Utility functions for circuit operations

use ff::PrimeField;
use halo2curves::bn256::Fr;
use std::error::Error;
use std::fmt;

/// Error type for utility functions
#[derive(Debug)]
pub struct UtilError(String);

impl fmt::Display for UtilError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl Error for UtilError {}

/// Convert hex string to field element
///
/// Accepts strings with or without "0x" prefix
pub fn hex_to_field(hex: &str) -> Result<Fr, UtilError> {
    let hex = hex.trim_start_matches("0x");

    // Parse hex to bytes
    let bytes = hex::decode(hex)
        .map_err(|e| UtilError(format!("Invalid hex: {}", e)))?;

    // Ensure we have exactly 32 bytes (pad with zeros if needed)
    let mut padded = [0u8; 32];
    let start = 32_usize.saturating_sub(bytes.len());
    padded[start..].copy_from_slice(&bytes);

    // Convert to field element (big-endian)
    Fr::from_repr(padded.into())
        .into_option()
        .ok_or_else(|| UtilError("Field element out of range".to_string()))
}

/// Convert field element to hex string
pub fn field_to_hex(field: Fr) -> String {
    let bytes = field.to_repr();
    format!("0x{}", hex::encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hex_to_field_with_prefix() {
        let hex = "0x24fbb8669f430c88a6fefa469d5966e88bf38858927b8c3d2629d555a3bc5212";
        let field = hex_to_field(hex).unwrap();
        assert_eq!(field_to_hex(field), hex);
    }

    #[test]
    fn test_hex_to_field_without_prefix() {
        let hex = "24fbb8669f430c88a6fefa469d5966e88bf38858927b8c3d2629d555a3bc5212";
        let field = hex_to_field(hex).unwrap();
        assert_eq!(field_to_field_to_hex(field).trim_start_matches("0x"), hex);
    }

    #[test]
    fn test_roundtrip() {
        let original = "0x123456789abcdef0";
        let field = hex_to_field(original).unwrap();
        let back = field_to_hex(field);
        // Should pad to 32 bytes
        assert_eq!(back.len(), 66); // 0x + 64 hex chars
    }
}
