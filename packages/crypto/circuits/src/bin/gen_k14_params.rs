//! Generate K=14 test parameters for development
//! WARNING: NOT ceremony parameters - for testing only

use halo2_base::halo2_proofs::{
    halo2curves::bn256::Bn256,
    poly::{
        commitment::Params,
        kzg::commitment::ParamsKZG,
    },
};
use rand::rngs::OsRng;
use std::fs;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🔧 Generating K=14 test parameters for development...");
    println!("⚠️  WARNING: These are NOT ceremony parameters!");
    println!("   For testing/development only - DO NOT use in production");
    println!();
    
    let k = 14;
    let params = ParamsKZG::<Bn256>::setup(k, OsRng);
    
    fs::create_dir_all("./kzg_params")?;
    let path = "./kzg_params/ceremony_params_k14.bin";
    
    let mut file = fs::File::create(path)?;
    params.write(&mut file)?;
    
    println!("✅ Generated test parameters at {}", path);
    println!();
    println!("Next: Run verifier generation:");
    println!("  cargo run --bin generate_verifier --release");
    
    Ok(())
}
