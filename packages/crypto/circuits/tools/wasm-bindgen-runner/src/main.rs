use anyhow::{bail, Context, Result};
use clap::Parser;
use std::path::PathBuf;
use wasm_bindgen_cli_support::Bindgen;

/// Hermetic wasm-bindgen runner pinned to the workspace version.
#[derive(Parser, Debug)]
#[command(version)]
struct Args {
    /// Input wasm file
    #[arg(long)]
    input: PathBuf,

    /// Output directory for generated JS/wasm
    #[arg(long)]
    out_dir: PathBuf,

    /// Generate web target (default true)
    #[arg(long, default_value_t = true)]
    web: bool,

    /// Assert that the compiled Wasm contains a shared memory (threads-ready).
    #[arg(long, default_value_t = false)]
    threads: bool,
}

fn main() -> Result<()> {
    let args = Args::parse();

    let mut bindgen = Bindgen::new();
    bindgen
        .input_path(&args.input)
        .web(args.web)
        .context("configuring wasm-bindgen target")?
        .typescript(false)
        .keep_debug(false)
        .remove_name_section(false);

    // Run wasm-bindgen and collect the in-memory output so we can validate
    // thread readiness before writing artifacts.
    let mut output = bindgen
        .generate_output()
        .context("wasm-bindgen execution failed")?;

    if args.threads {
        let has_shared_memory = output.wasm().memories.iter().any(|m| m.shared);
        if !has_shared_memory {
            bail!("--threads requested but wasm module lacks shared memory; ensure the build uses +atomics,+bulk-memory and exports shared memory");
        }
    }

    output
        .emit(&args.out_dir)
        .context("failed to emit wasm-bindgen artifacts")?;

    Ok(())
}
