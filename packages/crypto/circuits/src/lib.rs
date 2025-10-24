// VOTER Protocol - District Membership Circuit
// Browser-native Halo2 + KZG zero-knowledge proofs
// Migrated from PSE to Axiom halo2_base (Mainnet V2, Trail of Bits audited)

pub mod poseidon_hash; // Axiom halo2_base Poseidon (production-proven)
pub mod merkle; // Merkle tree verification (Axiom halo2_base)

// TODO: Migrate these modules to halo2_base
// pub mod district_membership; // Two-tier district membership circuit
// pub mod prover; // Real Halo2 proof generation and verification

// Re-export Axiom stack
pub use halo2_base;
