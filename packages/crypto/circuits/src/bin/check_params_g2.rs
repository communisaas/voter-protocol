use halo2_base::halo2_proofs::{
    halo2curves::bn256::Bn256,
    poly::{
        commitment::{Params, ParamsProver},
        kzg::commitment::ParamsKZG,
    },
};
use std::fs;
use std::path::Path;
use std::io::Read;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🔍 Checking KZG parameter G2 point consistency...\n");

    // Load params exactly as verifier generation does
    let params_path = Path::new("./kzg_params/axiom_params_k14.srs");

    println!("Loading params from: {}", params_path.display());

    let mut file = fs::File::open(&params_path)?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)?;

    let params = ParamsKZG::<Bn256>::read_custom(
        &mut buffer.as_slice(),
        halo2_base::halo2_proofs::SerdeFormat::RawBytesUnchecked
    )?;

    println!("✅ Params loaded successfully");
    println!("   params.n() = {} (should be 16384 for K=14)", params.n());
    println!();

    // Extract G2 points
    let g2 = params.g2();
    let s_g2 = params.s_g2();
    let g1_0 = params.get_g()[0];

    println!("📊 KZG Parameters (these get embedded in Solidity verifier):");
    println!();
    println!("G2 point:");
    println!("  {:?}", g2);
    println!();
    println!("s*G2 point:");
    println!("  {:?}", s_g2);
    println!();
    println!("G1[0] point:");
    println!("  {:?}", g1_0);
    println!();

    // Verify these match expected Axiom ceremony values
    println!("🔐 These G2 points are embedded in:");
    println!("   1. Solidity verifier bytecode (gen_evm_verifier_shplonk)");
    println!("   2. Rust proof verification (gen_evm_proof_shplonk)");
    println!();
    println!("If pairing fails, these points MUST be identical in both places.");
    println!();

    // Check if params size matches K=14
    if params.n() != 16384 {
        eprintln!("⚠️  WARNING: params.n() = {} but expected 16384 for K=14!", params.n());
        eprintln!("   This size mismatch could cause pairing failures!");
        return Err("Params size mismatch".into());
    }

    println!("✅ Params size check PASSED (n = 16384 for K=14)");

    Ok(())
}
