# Halo2 Verifier Regeneration Guide

**When to regenerate**: ANY time circuit configuration changes.

## Quick Reference

```bash
# From packages/crypto/circuits directory
cd /Users/noot/Documents/voter-protocol/packages/crypto/circuits

# Ensure solc 0.8.19 is available (verifier generation requirement)
export PATH="/tmp/solc-bin:$PATH"  # Or wherever solc 0.8.19 is installed

# Regenerate verifier bytecode
ALLOW_TEST_PARAMS=1 cargo run --bin generate_verifier --release --target aarch64-apple-darwin
```

**Output**: Updates `contracts/src/Halo2Verifier.bytecode` (should be ~20KB, under 24KB EIP-170 limit)

## When Regeneration Is Required

Regenerate verifier when ANY of these change:

- ✅ Circuit structure (new constraints, different layout)
- ✅ Public input configuration (`num_instance()` return value)
- ✅ Column configuration (`set_instance_columns()` calls)
- ✅ Proving key parameters (K value, break points)
- ✅ Commitment scheme changes (SHPLONK config)

**Critical**: Stale verifier bytecode = silent verification failures in production.

## Verification

After regeneration, run integration tests:

```bash
cd /Users/noot/Documents/voter-protocol/contracts
forge test --match-contract Integration --match-test testProof
```

Expected output:
```
[PASS] testProof() (gas: ~294k-300k)
```

## Circuit Configuration (Current)

**K=14 Single-Tier Architecture** (as of 2025-11-02):

```rust
// In src/bin/generate_verifier.rs and src/prover.rs
impl CircuitExt<Fr> for DistrictCircuitForKeygen {
    fn num_instance(&self) -> Vec<usize> {
        vec![3]  // 1 column with 3 instance values
    }
}

// In both keygen and proving:
builder.set_instance_columns(1);  // MUST match num_instance().len()
```

**Public Outputs** (3 field elements in 1 column):
1. `district_root` - Shadow Atlas Merkle root
2. `nullifier` - Double-spend prevention
3. `action_id` - Action type identifier

## Dependencies

**Audited Versions** (Trail of Bits, October 2023):

```toml
# halo2-base v0.4.1 (production-proven by Axiom Mainnet V2)
halo2-base = {
  git = "https://github.com/axiom-crypto/halo2-lib",
  rev = "4dc5c4833f16b3f3686697856fd8e285dc47d14f"
}

# snark-verifier v0.1.7 (22 commits after audited v0.1.6-rc0)
snark-verifier = {
  git = "https://github.com/axiom-crypto/snark-verifier",
  tag = "v0.1.7"  # Commit: 7cbe809650958958aad146ad85de922b758c664d
}
```

**NEVER upgrade to**:
- ❌ snark-verifier v0.2.x (requires unaudited halo2-base v0.5.0)
- ❌ privacy-scaling-explorations/snark-verifier fork (unaudited)
- ❌ Any unpinned git dependencies

## Solc 0.8.19 Requirement

The verifier generator requires Solidity 0.8.19 specifically (not 0.8.30+).

**Installation options**:

```bash
# Option 1: svm (Solidity Version Manager)
cargo install svm-rs
svm install 0.8.19
svm use 0.8.19

# Option 2: Direct download
curl -L https://github.com/ethereum/solidity/releases/download/v0.8.19/solc-macos -o /tmp/solc-0.8.19
chmod +x /tmp/solc-0.8.19
export PATH="/tmp:$PATH"
```

## Troubleshooting

### Error: "Source file requires different compiler version"
**Cause**: System has solc 0.8.30+, verifier needs 0.8.19
**Fix**: Install solc 0.8.19 and ensure it's in PATH before running generator

### Error: "WASM target not found"
**Cause**: `.cargo/config.toml` sets default target to wasm32-unknown-unknown
**Fix**: Use explicit native target flag: `--target aarch64-apple-darwin` (or x86_64 on Intel)

### Test Fails: "pairing precompile returned false"
**Cause**: Verifier bytecode doesn't match current circuit configuration
**Fix**: Regenerate verifier with current code

### Bytecode Exceeds 24KB
**Cause**: Circuit too large (K too high, too many columns)
**Fix**: Optimize circuit or reduce K value

## Gas Costs (Scroll zkEVM)

**Current (K=14, 3 public outputs)**:
- Proof verification: ~294,855 gas
- District registry lookup: +2,100 gas
- **Total**: ~297k gas (~$0.0047-$0.0511 per action)

Breakdown:
- BN254 pairing operations: ~250k gas
- SHPLONK commitment opening: ~40k gas
- Public input validation: ~5k gas

## Security Notes

**Audit Coverage** (verified 2025-11-02):
- Our snark-verifier v0.1.7 is covered by Trail of Bits October 2023 audit
- Pairing logic UNCHANGED since audited v0.1.6-rc0
- Only 22 incremental commits (bug fixes, no cryptographic changes)
- Production-proven by Axiom Mainnet V2 launch (Jan 2025)

**Golden Test Vectors**: Always maintain test vectors from audited implementation to detect supply-chain attacks.

## References

- **Deployment Info**: `contracts/src/Halo2Verifier.deployment.md`
- **Circuit Docs**: `packages/crypto/circuits/README.md`
- **Integration Tests**: `contracts/test/Integration.t.sol`
- **Axiom Examples**: https://github.com/axiom-crypto/axiom-sdk-rs/tree/main/circuit/examples
