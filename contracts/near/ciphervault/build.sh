#!/bin/bash
set -e

echo "Building CipherVault contract..."

# Build contract
cargo build --target wasm32-unknown-unknown --release

# Create output directory
mkdir -p ../../out

# Copy to output
cp target/wasm32-unknown-unknown/release/ciphervault.wasm ../../out/

echo "✅ Contract built: out/ciphervault.wasm"
echo ""
echo "To deploy to testnet:"
echo "  near create-account ciphervault.testnet --masterAccount YOUR_ACCOUNT.testnet"
echo "  near deploy ciphervault.testnet ../../out/ciphervault.wasm --initFunction new --initArgs '{}'"
