# SA-004 to SA-007: Security Fix Status

**Date:** 2026-02-02
**Status:** ✅ ALL FIXES COMPLETE

---

## Quick Summary

| Issue | Severity | Component | Status | Test Results |
|-------|----------|-----------|--------|--------------|
| **SA-004** | HIGH | DistrictRegistry | ✅ FIXED | 71 tests pass |
| **SA-005** | HIGH | discovery.nr | ✅ FIXED | File removed |
| **SA-006** | HIGH | NoirProver | ✅ FIXED | Code verified |
| **SA-007** | HIGH | Poseidon2 | ✅ FIXED | 30 tests pass |

---

## SA-004: DistrictRegistry Root Lifecycle

**File:** `contracts/src/DistrictRegistry.sol`

### What Was Fixed
District roots can now be deactivated, expired, and reactivated through governance with 7-day timelock.

### Key Changes
- Added `isActive` and `expiresAt` fields to `DistrictMetadata`
- Implemented `isValidRoot()` function checking registration, activation, and expiry
- Added lifecycle functions: deactivate, expire, reactivate, cancel
- All operations use 7-day timelock for security

### Verification
```bash
cd contracts && forge test --match-contract DistrictRegistry
```
**Result:** ✅ 71 tests pass (43 lifecycle + 28 core)

---

## SA-005: discovery.nr Poseidon Version

**File:** `packages/crypto/noir/district_membership/src/discovery.nr`

### What Was Fixed
Removed unused file that referenced Poseidon v1 instead of Poseidon2.

### Verification
```bash
ls packages/crypto/noir/district_membership/src/discovery.nr
```
**Result:** ✅ File does not exist

---

## SA-006: NoirProver Failed Init Cache

**File:** `packages/noir-prover/src/prover.ts`

### What Was Fixed
Failed initialization promises are now cleared from cache, allowing retry on transient errors.

### Key Change
```typescript
catch (err) {
    // SA-006 FIX: Clear failed promise so subsequent calls can retry
    initializationPromises.delete(depth);
    rejectInit!(err instanceof Error ? err : new Error(String(err)));
}
```

### Verification
```bash
grep "initializationPromises.delete(depth)" packages/noir-prover/src/prover.ts
```
**Result:** ✅ Cache clearing code found (line 295)

---

## SA-007: hashSingle Domain Separation

**File:** `packages/crypto/poseidon2.ts`

### What Was Fixed
Added `DOMAIN_HASH1` constant to prevent collision between `hashSingle(x)` and `hashPair(x, 0)`.

### Key Change
```typescript
const DOMAIN_HASH1 = '0x' + (0x48314d).toString(16).padStart(64, '0');

async hashSingle(value: bigint | string): Promise<bigint> {
    const inputs = [
        this.toHex(value),
        DOMAIN_HASH1,   // SA-007: Domain tag in slot 1
        ZERO_PAD,
        ZERO_PAD,
    ];
    // ...
}
```

### Verification
```bash
cd packages/crypto && npx vitest run test/golden-vectors.test.ts
```
**Result:** ✅ 30 golden vector tests pass

**Domain separation verified:**
- `hashSingle(0) ≠ hashPair(0, 0)` ✅
- `hashSingle(0) ≠ hash4(0, 0, 0, 0)` ✅

---

## Run All Verifications

```bash
# From project root
./verify-sa-fixes.sh
```

This script checks all four fixes automatically.

---

## Files Modified

### Contracts (SA-004)
- ✅ `contracts/src/DistrictRegistry.sol` - Root lifecycle system
- ✅ `contracts/test/DistrictRegistry.Lifecycle.t.sol` - 43 new tests
- ✅ `contracts/SA-004-IMPLEMENTATION-SUMMARY.md` - Detailed docs

### Crypto (SA-005, SA-007)
- ✅ `packages/crypto/noir/district_membership/src/discovery.nr` - Deleted
- ✅ `packages/crypto/poseidon2.ts` - Domain separation added
- ✅ `packages/crypto/test/golden-vectors.test.ts` - Tests updated

### Prover (SA-006)
- ✅ `packages/noir-prover/src/prover.ts` - Cache clearing on error

### Documentation
- ✅ `SA-004-007-REMEDIATION-SUMMARY.md` - Full remediation report
- ✅ `SA-004-007-STATUS.md` - This status document
- ✅ `verify-sa-fixes.sh` - Automated verification script

---

## Next Steps

### Integration (Post-Remediation)
1. Update `DistrictGate` to call `registry.isValidRoot()` instead of checking existence
2. Add monitoring for lifecycle events in DistrictRegistry
3. Document governance procedures for root lifecycle operations
4. Deploy updated contracts to testnet for integration testing

### Deployment Checklist
- [x] All fixes implemented
- [x] Unit tests passing
- [x] Documentation complete
- [ ] Integration tests with DistrictGate
- [ ] Governance procedures documented
- [ ] Monitoring configured
- [ ] Testnet deployment

---

## Contact

For questions about these fixes:
- **SA-004:** See detailed implementation summary
- **SA-005:** No action needed (file removed)
- **SA-006:** See inline code comments
- **SA-007:** See golden vectors test file

**Full Remediation Report:** `SA-004-007-REMEDIATION-SUMMARY.md`
