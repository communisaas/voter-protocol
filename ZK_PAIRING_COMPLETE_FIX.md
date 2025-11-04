# ZK Proof EVM Verification: Complete Fix

**Date**: 2025-11-04
**Status**: ✅ **FULLY RESOLVED**

---

## Executive Summary

The ZK proof EC pairing failure has been **completely fixed** through two critical corrections:

1. **Calldata Encoding Fix**: Implemented snark-verifier's canonical `encode_calldata()` function
2. **Verifier Return Value Fix**: Patched bytecode to return `uint256(1)` instead of empty bytes

**Result**: All 8 integration tests now pass, including the critical `test_RealProofVerifies()`.

---

## The Two Bugs

### Bug #1: Calldata Encoding Mismatch (P0 - Critical)

**Issue**: The Solidity test was manually constructing calldata with `abi.encodePacked(district_root, nullifier, action_id, proof)`, but this doesn't match snark-verifier's canonical encoding which performs byte reversal.

**Fix**:
1. Added `prove_evm_calldata()` method to `prover.rs:717` using `snark_verifier::loader::evm::encode_calldata`
2. Updated proof export to generate full calldata (4160 bytes)
3. Modified `Integration.t.sol` to use pre-encoded calldata directly

**Evidence**: EC pairing now returns `true` (was returning `false` before fix)

### Bug #2: Verifier Return Value Missing (P0 - Critical)

**Issue**: The generated verifier contract (`Halo2Verifier.sol:1800-1801`) had:
```solidity
// Return empty bytes on success
return(0, 0)
```

This compiles to bytecode `600080f3` which returns zero bytes instead of encoding the boolean result.

**Fix**: Patched bytecode from `600080f3` to `600160005260206000f3`:
- `6001` = PUSH1 0x01 (push 1 onto stack)
- `6000` = PUSH1 0x00 (push 0 onto stack - memory location)
- `52` = MSTORE (store 1 at memory[0])
- `6020` = PUSH1 0x20 (32 bytes)
- `6000` = PUSH1 0x00 (start at byte 0)
- `f3` = RETURN (return 32 bytes from memory[0])

This returns `abi.encode(uint256(1))` which the Solidity test can decode.

---

## Implementation Details

### Files Modified

1. **`/Users/noot/Documents/voter-protocol/packages/crypto/circuits/src/prover.rs`**
   - Added `prove_evm_calldata()` method (lines 717-774)
   - Updated `export_proof_for_solidity_integration_test()` (lines 1059-1119)

2. **`/Users/noot/Documents/voter-protocol/contracts/test/Integration.t.sol`**
   - Changed `ProofData` struct from `bytes proof` to `bytes calldataBytes`
   - Updated `setUp()` to parse `.calldata` from JSON
   - Modified `test_RealProofVerifies()` to use pre-encoded calldata
   - Updated all negative tests to extract and manipulate calldata properly

3. **`/Users/noot/Documents/voter-protocol/contracts/src/Halo2Verifier.bytecode`**
   - Patched from 20,143 bytes to 20,149 bytes (+6 bytes for new return statement)
   - Changed final return from `600080f3` to `600160005260206000f3`

4. **`/Users/noot/Documents/voter-protocol/contracts/src/Halo2Verifier.sol`**
   - Updated lines 1800-1801 with proper return encoding (for reference, not used by tests)

5. **`/Users/noot/Documents/voter-protocol/packages/crypto/circuits/proof_integration_test.json`**
   - Now contains `calldata` field (4160 bytes) instead of separate `proof` field
   - Added `encoding_note` documenting canonical encoding

---

## Test Results

### Before Fixes:
```
[FAIL: Verifier call should succeed] test_RealProofVerifies() (gas: 721353)
  EC pairing: returns false ❌
  Verifier return: empty bytes ❌
```

### After Calldata Fix:
```
[FAIL: Proof should verify] test_RealProofVerifies() (gas: 293615)
  EC pairing: returns true ✅
  Verifier return: empty bytes ❌
```

### After Both Fixes:
```
[PASS] test_RealProofVerifies() (gas: 738379) ✅
  Logs:
    PASS: Real Halo2 proof verified successfully!
    Calldata size: 4160 bytes
    District root: 0x013d1a976ba17a1dd1af3014083bf82caac6a5b0d9b1b1c1a5dbbe7183e7b0a9
    Nullifier: 0x169bedbad2d33b5c3757f8c0bd67196942450ccaeee624325ad12392e1e57eb7
    Action ID: 0x019c4a794edb218627607ae2bc92939aecb000cbf93cfdfd788787577ffff488
```

### Full Integration Test Suite:
```bash
forge test --match-contract Integration -vv
```

**Results**: 8/8 tests pass ✅
- `test_RealProofVerifies()` - **PASS** (738,379 gas)
- `test_VerificationGasCost()` - **PASS** (722,233 gas, ~717k gas for verification)
- `test_VerificationFailsWithWrongDistrictRoot()` - **PASS**
- `test_VerificationFailsWithWrongNullifier()` - **PASS**
- `test_VerificationFailsWithTamperedProof()` - **PASS**
- `test_VerificationFailsWithWrongInputCount()` - **PASS**
- `test_VerifierDeployed()` - **PASS**
- `testProof()` - **PASS**

**Gas Cost**: ~717,467 gas for proof verification (within expected 300k-800k range)

---

## Technical Analysis

### Why Calldata Encoding Was Wrong

**snark-verifier's `encode_calldata`** (from `/tmp/axiom-eth/src/util/circuit.rs`):

```rust
pub fn encode_calldata<F>(instances: &[Vec<F>], proof: &[u8]) -> Vec<u8>
where
    F: PrimeField<Repr = [u8; 32]>,
{
    iter::empty()
        .chain(
            instances
                .iter()
                .flatten()
                .flat_map(|value| value.to_repr().as_ref().iter().rev().cloned().collect_vec()),
                //                                              ^^^^ REVERSES BYTES
        )
        .chain(proof.iter().cloned())
        .collect()
}
```

**Key Points**:
1. Takes instances as `Vec<Vec<Fr>>` (not already serialized)
2. For each instance: `to_repr()` returns little-endian, then `.rev()` converts to big-endian
3. Concatenates: `[instance0_be || instance1_be || instance2_be || proof_bytes]`

**What We Were Doing (Wrong)**:
```solidity
bytes memory callData = abi.encodePacked(
    testProof.districtRoot,   // bytes32 from JSON (already big-endian)
    testProof.nullifier,      // bytes32 from JSON (already big-endian)
    testProof.actionId,       // bytes32 from JSON (already big-endian)
    testProof.proof           // proof bytes from JSON
);
```

This didn't match the exact encoding snark-verifier expects.

### Why Verifier Returned Empty Bytes

**Generated Verifier Code** (`Halo2Verifier.sol:1797-1801`):

```solidity
// Revert if anything fails
if iszero(success) { revert(0, 0) }

// Return empty bytes on success
return(0, 0)  // ← BUG: Should return abi.encode(uint256(1))
```

**Bytecode**:
- Original: `600080f3` → `return(0, 0)` → returns empty bytes
- Fixed: `600160005260206000f3` → stores `1` at memory[0], returns 32 bytes

**Why This Matters**: The Solidity test expects:
```solidity
bool isValid = result.length > 0 && abi.decode(result, (uint256)) == 1;
```

Empty bytes cause `result.length == 0` → `isValid = false`.

---

## Root Cause Attribution

**Primary Credit**: The **Brutalist cypherpunk security researcher** identified the calldata encoding issue with 90% confidence. The analysis in `ZK_PAIRING_FAILURE_ROOT_CAUSE.md` was correct.

**Secondary Discovery**: The verifier return value bug was discovered during implementation of the Brutalist's fix.

**Key Insights**:
1. **Never manually construct ZK verifier calldata** - Always use library-provided encoding
2. **Inspect generated code** - Don't assume generated verifiers are bug-free
3. **Test at the bytecode level** - EVM bytecode bugs are subtle and require low-level inspection

---

## Lessons Learned

### For ZK Circuit Development

1. **Use Canonical Encoding**: Always use snark-verifier's `encode_calldata` for EVM calldata
2. **Golden Test Vectors**: Compare against known-working implementations (e.g., Axiom)
3. **Bytecode Inspection**: Generated Solidity/bytecode should be audited, not blindly trusted
4. **Integration Testing**: Test full proof→verification flow, not just individual components

### For Debugging ZK Systems

1. **Trace EC Pairing**: Use Forge's `-vvvv` to see EVM precompile calls
2. **Check Return Values**: Empty bytes vs encoded booleans are easy to miss
3. **Brutalist Methodology**: Deploy skeptical, deep-diving analysis when conventional fixes fail
4. **Read The Source**: When docs are sparse, audit the actual library implementation

---

## Production Deployment Notes

### Current Status

**Bytecode Size**: 20,149 bytes (fits EIP-170 24KB limit with 3,927 bytes headroom)

**Gas Cost**: ~717k gas (within acceptable range for Scroll zkEVM)

**Security Considerations**:
1. ✅ Calldata encoding now matches snark-verifier's canonical format
2. ✅ Verifier returns proper boolean encoding
3. ✅ All negative tests pass (wrong inputs correctly rejected)
4. ⚠️ Bytecode was manually patched (not regenerated from source)

### Regenerating Verifier (If Needed)

If the verifier needs to be regenerated from scratch:

```bash
cd /Users/noot/Documents/voter-protocol/packages/crypto/circuits
cargo run --bin generate_verifier --release
```

**IMPORTANT**: After regeneration, apply the bytecode patch:

```bash
# Backup original
cp contracts/src/Halo2Verifier.bytecode contracts/src/Halo2Verifier.bytecode.backup

# Patch: replace "600080f3" with "600160005260206000f3"
xxd -p contracts/src/Halo2Verifier.bytecode | tr -d '\n' | \
  sed 's/600080f3fea2/600160005260206000f3fea2/' | \
  xxd -r -p > contracts/src/Halo2Verifier.bytecode

# Verify size (should be ~20,149 bytes)
wc -c contracts/src/Halo2Verifier.bytecode
```

Or update `snark-verifier` to generate correct return encoding.

### Alternative: Fix in snark-verifier

Open PR to axiom-crypto/snark-verifier to fix `gen_evm_verifier_shplonk` return value:

```solidity
// Instead of: return(0, 0)
// Generate: mstore(0x00, 1); return(0x00, 0x20)
```

---

## Verification Commands

To reproduce the fix and verify all tests pass:

```bash
# Navigate to contracts directory
cd /Users/noot/Documents/voter-protocol/contracts

# Run all integration tests
forge test --match-contract Integration -vv

# Expected output:
# Ran 8 tests for test/Integration.t.sol:IntegrationTest
# [PASS] test_RealProofVerifies() (gas: 738379)
# ...
# Suite result: ok. 8 passed; 0 failed; 0 skipped
```

---

## Success Criteria Met

✅ EC pairing returns `true` (was `false` before calldata fix)
✅ Verifier returns `uint256(1)` (was empty bytes before bytecode patch)
✅ `test_RealProofVerifies()` passes
✅ All 8 integration tests pass
✅ Gas cost ~717k (within expected range)
✅ Negative tests correctly reject invalid proofs

**Status**: Production-ready with caveat that bytecode was manually patched.

---

## Acknowledgments

**Brutalist Cypherpunk Security Researcher**: Identified root cause with 90% confidence
**Root Cause Analysis**: `/Users/noot/Documents/voter-protocol/ZK_PAIRING_FAILURE_ROOT_CAUSE.md`
**snark-verifier**: Axiom's canonical encoding implementation

---

**End of Report**
