# BR3-008 and BR3-010 Implementation Summary

**Date**: 2026-02-04
**Issues**: #80 (BR3-008), #81 (BR3-010)
**Engineer**: Senior Cryptography Engineer

## Overview

This document summarizes the implementation of two cryptographic safety fixes:
1. **BR3-008**: Added JSDoc warning to `SMT.verify()` about key-binding limitation
2. **BR3-010**: Converted domain tag Number literals to BigInt to prevent precision loss

## BR3-008: SMT.verify() Key Binding Documentation

### Problem
`SparseMerkleTree.verify()` verifies the Merkle path from `proof.value` to root but **ignores** `proof.key` and `proof.attempt`. A valid proof for cell A could be passed with `proof.key = B` and `verify()` would still return `true`.

### Solution
Added comprehensive JSDoc warning to `SparseMerkleTree.verify()` method in `/Users/noot/Documents/voter-protocol/packages/crypto/sparse-merkle-tree.ts` (lines 494-516).

The warning clarifies:
- This method verifies the Merkle PATH only
- `proof.key` is NOT checked against the proven position
- On-chain verification is safe (ZK circuit binds cell_id into leaf hash)
- Off-chain callers must independently verify `proof.value = hash(proof.key, expected_data)`

### Impact
- ✅ No code behavior changes
- ✅ Documents existing limitation for API consumers
- ✅ Prevents misuse in access control scenarios

## BR3-010: Domain Tag BigInt Conversion

### Problem
Two domain separation tags exceeded `Number.MAX_SAFE_INTEGER` (2^53 - 1 = 9,007,199,254,740,991):

1. **DOMAIN_SPONGE_24** (0x534f4e47455f24):
   - Value: 23,449,620,688,756,516
   - Exceeds MAX_SAFE_INTEGER by 2.6x
   - Used for Poseidon2 sponge with 24 inputs

2. **EMPTY_CELL_TAG** (0x454d50545943454c4c):
   - Value: ~1.28 × 10^21
   - Exceeds MAX_SAFE_INTEGER by ~142,000x
   - Used for empty cell domain separation in SMT

JavaScript Number type cannot precisely represent integers beyond MAX_SAFE_INTEGER, potentially causing precision loss in `.toString(16)` conversions.

### Solution

**File**: `/Users/noot/Documents/voter-protocol/packages/crypto/poseidon2.ts`
- **Line 68**: Changed `0x534f4e47455f24` → `0x534f4e47455f24n` (added BigInt suffix)

**File**: `/Users/noot/Documents/voter-protocol/packages/crypto/sparse-merkle-tree.ts`
- **Line 118**: Already had BigInt suffix `0x454d50545943454c4cn` (no change needed)

### Verification

✅ **Smaller domain tags confirmed safe** (no changes needed):
- `DOMAIN_HASH1` (0x48314d = 4,731,213) ✓
- `DOMAIN_HASH2` (0x48324d = 4,731,469) ✓
- `DOMAIN_HASH3` (0x48334d = 4,731,725) ✓

✅ **Golden vector tests pass**:
- `golden-vectors.test.ts`: 30/30 tests passing
- `sponge-vectors.test.ts`: 26/26 tests passing

This confirms the BigInt conversion produces **identical hash outputs** to the original literals.

### Impact
- ✅ Prevents potential precision loss in domain tag conversions
- ✅ No hash output changes (verified by golden vectors)
- ✅ Future-proof against edge cases in different JS engines

## Testing Results

```
✓ packages/crypto/test/golden-vectors.test.ts (30 tests) 319ms
✓ packages/crypto/test/sponge-vectors.test.ts (26 tests) 924ms
✓ packages/crypto/test/sparse-merkle-tree.test.ts (42 tests) 45522ms
✓ packages/crypto/test/two-tree-vectors.test.ts (21 tests) 732ms
✓ packages/crypto/test/two-tree-e2e.test.ts (9 tests) 1002ms
✓ packages/crypto/test/district-prover.test.ts (all tests pass)
```

**Note**: Pre-existing failures in `string-encoding.test.ts` (7 tests) are unrelated to these changes. They pertain to BA-022 (length-prefix string encoding).

## Files Modified

1. `/Users/noot/Documents/voter-protocol/packages/crypto/sparse-merkle-tree.ts`
   - Lines 494-516: Added comprehensive JSDoc to `verify()` method

2. `/Users/noot/Documents/voter-protocol/packages/crypto/poseidon2.ts`
   - Line 68: Added BigInt suffix to `DOMAIN_SPONGE_24`

## Security Considerations

### BR3-008 (Key Binding Documentation)
- **Risk Level**: Low (documentation-only change)
- **Attack Vector**: Off-chain access control misuse (if `verify()` is used without checking key binding)
- **Mitigation**: Clear warning directs developers to verify `proof.value = hash(proof.key, data)`

### BR3-010 (BigInt Conversion)
- **Risk Level**: Low (defensive fix)
- **Attack Vector**: Precision loss in domain tag conversion (theoretical)
- **Mitigation**: BigInt ensures exact representation regardless of JS engine

## References

- **GitHub Issues**: #80 (BR3-008), #81 (BR3-010)
- **Specification**: Two-Tree Architecture (packages/crypto/)
- **Related Fixes**: BA-003 (domain separation), SA-007 (hashSingle collision)
