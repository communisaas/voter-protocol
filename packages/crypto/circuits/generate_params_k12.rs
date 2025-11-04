// Temporary utility to generate K=12 params for development
use halo2_base::halo2_proofs::{
    halo2curves::bn256::Bn256,
    poly::kzg::commitment::ParamsKZG,
};

fn main() {
    println!("Generating K=12 test parameters...");
    let params = ParamsKZG::<Bn256>::setup(12, rand::rngs::OsRng);
    
    let path = "./kzg_params/ceremony_params_k12.bin";
    std::fs::create_dir_all("./kzg_params").unwrap();
    
    let mut file = std::fs::File::create(path).unwrap();
    params.write(&mut file).unwrap();
    
    println!("✅ Generated test params at {}", path);
    println!("⚠️  WARNING: These are NOT ceremony parameters!");
    println!("   DO NOT use in production - for development only");
}
