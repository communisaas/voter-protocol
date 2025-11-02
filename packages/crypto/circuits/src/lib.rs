// VOTER Protocol - District Membership Circuit
// Browser-native Halo2 + KZG zero-knowledge proofs
// Migrated from PSE to Axiom halo2_base (Mainnet V2, Trail of Bits audited)
//
// ARCHITECTURE (2025-10-28):
// Single-tier K=14 circuit with on-chain DistrictRegistry.sol
// - ~95k cells, 6-8 columns → ~12-16KB verifier (FITS EIP-170!)
// - 8-15 second proving on mid-range Android
// - District→country mapping moved to on-chain registry (multi-sig governed)
//
// See ARCHITECTURE_EVOLUTION.md for migration from two-tier design

pub mod poseidon_hash; // Axiom halo2_base Poseidon (production-proven)
pub mod merkle; // Merkle tree verification (Axiom halo2_base)

// ✅ PRODUCTION (2025-10-28): K=14 single-tier circuit (~12-16KB verifier, fits EIP-170)
pub mod district_membership_single_tier; // Single-tier district membership (K=14)

// 📦 LEGACY: Two-tier circuit (kept for reference, not deployed)
pub mod district_membership; // Two-tier circuit (26KB verifier, exceeds EIP-170)

// ✅ COMPLETE (2025-10-25): Full halo2_base proving API implementation
pub mod prover; // Production-ready Halo2 proof generation and verification

// 🌐 WASM Bindings (Browser-native proving, 8-15s mobile)
#[cfg(feature = "wasm")]
pub mod wasm; // JavaScript API for browser WASM proving

// Re-export Axiom stack
pub use halo2_base;
