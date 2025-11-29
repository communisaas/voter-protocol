use blake2::{Blake2b512, Digest};
use std::fs;
use std::path::Path;

// Canonical hash recorded in src/prover.rs and src/wasm.rs
const CANONICAL_HASH_K14: &str =
    "5d56001304a118d53e48bb5b512c125497d58f16af5c115ac6b2360fe515f77f9c897d824b8824c0f2aff0a65b6f12c1cd7725c5a3631aade5731acf3f869ed8";

#[test]
fn ceremony_params_hash_matches_canonical() {
    let path = Path::new("kzg_params/axiom_params_k14.srs");
    let data = fs::read(path).expect("k14 params file present");
    let hash = Blake2b512::digest(&data);
    let hash_hex = format!("{:x}", hash);
    assert_eq!(hash_hex, CANONICAL_HASH_K14, "k=14 params hash mismatch");
}
