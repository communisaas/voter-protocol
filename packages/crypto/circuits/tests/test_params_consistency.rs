use halo2_base::halo2_proofs::{
    halo2curves::bn256::Bn256,
    poly::{
        commitment::Params,
        kzg::commitment::ParamsKZG,
    },
};
use std::fs;
use std::path::Path;

#[test]
fn test_params_g2_consistency() {
    // Load params exactly as verifier generation does
    let params_path = Path::new("./kzg_params/axiom_params_k14.srs");

    let mut file = fs::File::open(&params_path)
        .expect("Failed to open params");

    let mut buffer = Vec::new();
    std::io::Read::read_to_end(&mut file, &mut buffer)
        .expect("Failed to read params");

    let params_verifier = ParamsKZG::<Bn256>::read_custom(
        &mut buffer.as_slice(),
        halo2_base::halo2_proofs::SerdeFormat::RawBytesUnchecked
    ).expect("Failed to deserialize params for verifier");

    // Load params exactly as prover does (same file, same method)
    let mut file2 = fs::File::open(&params_path)
        .expect("Failed to open params second time");

    let mut buffer2 = Vec::new();
    std::io::Read::read_to_end(&mut file2, &mut buffer2)
        .expect("Failed to read params second time");

    let params_prover = ParamsKZG::<Bn256>::read_custom(
        &mut buffer2.as_slice(),
        halo2_base::halo2_proofs::SerdeFormat::RawBytesUnchecked
    ).expect("Failed to deserialize params for prover");

    // Extract G2 points
    let verifier_g2 = params_verifier.g2();
    let verifier_s_g2 = params_verifier.s_g2();
    let verifier_g1_0 = params_verifier.get_g()[0];

    let prover_g2 = params_prover.g2();
    let prover_s_g2 = params_prover.s_g2();
    let prover_g1_0 = params_prover.get_g()[0];

    println!("Verifier params.n() = {}", params_verifier.n());
    println!("Prover params.n() = {}", params_prover.n());

    println!("\nVerifier G2: {:?}", verifier_g2);
    println!("Prover G2: {:?}", prover_g2);

    println!("\nVerifier s*G2: {:?}", verifier_s_g2);
    println!("Prover s*G2: {:?}", prover_s_g2);

    println!("\nVerifier G1[0]: {:?}", verifier_g1_0);
    println!("Prover G1[0]: {:?}", prover_g1_0);

    // These MUST be identical
    assert_eq!(
        format!("{:?}", verifier_g2),
        format!("{:?}", prover_g2),
        "G2 points differ between verifier and prover params!"
    );

    assert_eq!(
        format!("{:?}", verifier_s_g2),
        format!("{:?}", prover_s_g2),
        "s*G2 points differ between verifier and prover params!"
    );

    assert_eq!(
        format!("{:?}", verifier_g1_0),
        format!("{:?}", prover_g1_0),
        "G1[0] points differ between verifier and prover params!"
    );

    println!("\n✅ ALL G2 POINTS MATCH - params are consistent");
}
