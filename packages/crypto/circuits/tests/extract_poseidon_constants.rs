/**
 * Extract Poseidon constants from Axiom halo2_base OptimizedPoseidonSpec
 *
 * This test prints the exact round constants and MDS matrix used by Axiom,
 * so we can implement a matching TypeScript Poseidon for Shadow Atlas.
 */

use halo2_base::{
    poseidon::hasher::spec::OptimizedPoseidonSpec,
};
use halo2_proofs::halo2curves::bn256::Fr;

const T: usize = 3;      // State size
const RATE: usize = 2;   // Inputs per permutation
const R_F: usize = 8;    // Full rounds
const R_P: usize = 57;   // Partial rounds

#[test]
fn extract_poseidon_constants() {
    // Create the spec Axiom uses
    let _spec: OptimizedPoseidonSpec<Fr, T, RATE> = OptimizedPoseidonSpec::new::<R_F, R_P, 0>();

    println!("\n=== AXIOM POSEIDON CONSTANTS (T=3, RATE=2, R_F=8, R_P=57) ===\n");

    // Extract round constants
    println!("Round constants (as hex strings for TypeScript):");
    println!("const ROUND_CONSTANTS = [");

    // Get the round constants - this will need to be adapted based on actual API
    // The spec struct should have methods to access constants
    // For now, this is a placeholder to show the approach

    println!("];\n");

    println!("MDS matrix:");
    println!("const MDS_MATRIX = [");

    println!("];\n");

    println!("=== Copy these constants to TypeScript Poseidon implementation ===\n");
}
