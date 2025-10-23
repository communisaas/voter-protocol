// Build script for WASM compilation

fn main() {
    // Set WASM target for optimal compilation
    println!("cargo:rerun-if-changed=src/");

    // WASM-specific configuration
    if std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default() == "wasm32" {
        println!("cargo:rustc-link-arg=--import-memory");
        println!("cargo:rustc-link-arg=--max-memory=4294967296"); // 4GB
    }
}
