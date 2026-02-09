# Integration Consistency Review

**Date:** 2026-02-01
**Scope:** Cross-package integration verification for voter-protocol monorepo
**Status:** REVIEW COMPLETE - 3 Critical Issues, 4 Medium Issues, 2 Low Issues

---

## Executive Summary

This report documents the cross-package integration analysis between:
1. `@voter-protocol/crypto` (v0.1.3) - Poseidon2 hashing, district provers
2. `@voter-protocol/noir-prover` (v0.1.4) - Browser-native ZK proving
3. `@voter-protocol/shadow-atlas` (v0.1.0) - Merkle tree construction, boundary data
4. `contracts/` - Solidity verifiers and gate contracts

**Key Findings:**
- DOMAIN_HASH2 constant is **consistent** across TypeScript and Noir (0x48324d)
- Authority level bounds (1-5) are enforced **consistently** in all packages
- Public input ordering matches between prover and verifier contracts
- **Critical Issue:** Depth-14 circuits referenced in test files but not in deployed contracts
- **Critical Issue:** Fixture generator imports from relative path that may break in published package

---

## 1. Hash Consistency Analysis

### 1.1 DOMAIN_HASH2 Verification

**Question:** Does `DOMAIN_HASH2` in TypeScript (0x48324d) match the Noir circuit constant?

| Location | Value | Status |
|----------|-------|--------|
| `/packages/crypto/poseidon2.ts:36` | `0x48324d` | MATCH |
| `/packages/crypto/noir/district_membership/src/main.nr:28` | `0x48324d` | MATCH |

**Result:** CONSISTENT

```typescript
// poseidon2.ts
const DOMAIN_HASH2 = '0x' + (0x48324d).toString(16).padStart(64, '0');

// main.nr
global DOMAIN_HASH2: Field = 0x48324d;
```

Both use the value `0x48324d` ("H2M" - Hash-2 Marker). The TypeScript version pads to 64 hex chars for circuit compatibility.

### 1.2 DOMAIN_HASH1 Verification (SA-007 Fix)

| Location | Value | Purpose |
|----------|-------|---------|
| `/packages/crypto/poseidon2.ts:43` | `0x48314d` | hashSingle domain separation |

**Note:** DOMAIN_HASH1 is TypeScript-only (used in `hashSingle`). The Noir circuit does not use `hashSingle` directly - it uses `poseidon2_hash4` for leaf computation and `poseidon2_hash2` for merkle paths.

### 1.3 Hash Function Alignment

| Package | Hash Function | Implementation |
|---------|--------------|----------------|
| `crypto` | `Poseidon2Hasher` | Noir WASM via `@noir-lang/noir_js` |
| `noir-prover` | N/A (uses circuit) | Circuit compiled with same Poseidon2 |
| `shadow-atlas` | `@voter-protocol/crypto/poseidon2` | Re-exports from crypto package |
| `contracts` | UltraPlonk verifier | On-chain Poseidon2 verification |

**Result:** CONSISTENT - All packages use the same Poseidon2 implementation (Noir stdlib)

---

## 2. Authority Level Bounds Verification

**Question:** Are authority level bounds (1-5) enforced consistently in all packages?

### 2.1 Noir Circuit (`/packages/crypto/noir/district_membership/src/main.nr`)

```noir
global MIN_AUTHORITY_LEVEL: Field = 1;
global MAX_AUTHORITY_LEVEL: Field = 5;

fn validate_authority_level(authority_level: Field) {
    assert(authority_level as u64 < 256, "Authority level exceeds u8 range");
    let level_u8 = authority_level as u8;
    assert(level_u8 >= MIN_AUTHORITY_LEVEL as u8, "Authority level below minimum (1)");
    assert(level_u8 <= MAX_AUTHORITY_LEVEL as u8, "Authority level above maximum (5)");
}
```

### 2.2 TypeScript Types (`/packages/noir-prover/src/types.ts`)

```typescript
export type AuthorityLevel = 1 | 2 | 3 | 4 | 5;

export function validateAuthorityLevel(level: number): AuthorityLevel {
    if (level < 1 || level > 5 || !Number.isInteger(level)) {
        throw new Error(`Invalid authority level: ${level}. Must be integer 1-5.`);
    }
    return level as AuthorityLevel;
}
```

### 2.3 Shadow Atlas Constants (`/packages/shadow-atlas/src/core/constants.ts`)

```typescript
export const AUTHORITY_LEVELS = {
  FEDERAL_MANDATE: 5,
  STATE_OFFICIAL: 4,
  MUNICIPAL_OFFICIAL: 3,
  COMMUNITY_VERIFIED: 2,
  UNVERIFIED: 1,
} as const;
```

### 2.4 Solidity Contract (`/contracts/src/DistrictGate.sol`)

The contract accepts `authorityLevel` as `bytes32` in `verifyAndAuthorizeWithSignature()`. Range validation happens in the ZK circuit, not the contract. The contract trusts the circuit's range-check assertion.

**Result:** CONSISTENT - All packages enforce 1-5 range with consistent semantics.

---

## 3. Merkle Path Format Verification

**Question:** Do merkle path formats match between tree builders and provers?

### 3.1 Shadow Atlas Merkle Tree (`/packages/shadow-atlas/src/merkle-tree.ts`)

```typescript
export interface MerkleProof {
  readonly root: bigint;
  readonly leaf: bigint;
  readonly siblings: readonly bigint[];
  readonly pathIndices: readonly number[];  // 0 = left, 1 = right
  readonly depth: CircuitDepth;  // 18, 20, 22, or 24
}
```

### 3.2 Noir Prover Types (`/packages/noir-prover/src/types.ts`)

```typescript
export interface CircuitInputs {
  merkleRoot: string;
  merklePath: string[];  // Sibling hashes (length = depth)
  leafIndex: number;     // Position determines left/right
}
```

### 3.3 Noir Circuit (`main.nr`)

```noir
fn compute_merkle_root(leaf: Field, merkle_path: [Field; DEPTH], leaf_index: u32) -> Field {
    let mut node = leaf;
    for i in 0..DEPTH {
        let bit: bool = ((leaf_index >> i) & 1u32) == 1u32;
        let sibling = merkle_path[i];
        node = if bit { poseidon2_hash2(sibling, node) } else { poseidon2_hash2(node, sibling) };
    }
    node
}
```

### 3.4 Format Alignment Analysis

| Aspect | Shadow Atlas | Noir Prover | Circuit | Compatible? |
|--------|--------------|-------------|---------|-------------|
| Path length | `depth` elements | `depth` elements | `DEPTH` const | YES |
| Sibling order | Leaf to root | Leaf to root | Index 0 = first | YES |
| Index encoding | `pathIndices[]` array | Single `leafIndex` | Bit extraction | **COMPATIBLE** |
| Hash type | `bigint` | `string` (hex) | `Field` | YES (conversion) |

**Result:** CONSISTENT - Both use bit extraction from leaf index to determine left/right ordering. Shadow Atlas's `pathIndices` array is equivalent to the circuit's bit extraction.

---

## 4. Public Input Ordering Verification

**Question:** Are public input orderings identical in prover and verifier?

### 4.1 Noir Circuit Output (`main.nr:131,166`)

```noir
fn main(...) -> pub (Field, Field, Field, Field, Field) {
    // ...
    (merkle_root, nullifier, authority_level, action_domain, district_id)
}
```

**Order:**
1. `merkle_root`
2. `nullifier`
3. `authority_level`
4. `action_domain`
5. `district_id`

### 4.2 Noir Prover Extraction (`/packages/noir-prover/src/prover.ts:177-193`)

```typescript
// Order matches the circuit's return statement:
// pub (merkle_root, nullifier, authority_level, action_domain, district_id)
return {
    proof,
    publicInputs: {
        merkleRoot: publicInputs[0] ?? inputs.merkleRoot,
        nullifier: publicInputs[1] ?? '',
        authorityLevel: validateAuthorityLevel(rawAuthorityLevel),
        actionDomain: publicInputs[3] ?? inputs.actionDomain,
        districtId: publicInputs[4] ?? inputs.districtId,
    },
};
```

### 4.3 Solidity Verifier Call (`/contracts/src/DistrictGate.sol:248-262`)

```solidity
/// PUBLIC INPUTS (SAME across all depths, matches circuit output order):
/// - publicInputs[0]: merkleRoot
/// - publicInputs[1]: nullifier
/// - publicInputs[2]: authorityLevel
/// - publicInputs[3]: actionDomain
/// - publicInputs[4]: districtId

uint256[5] memory publicInputs = [
    uint256(districtRoot),      // [0] merkleRoot
    uint256(nullifier),         // [1] nullifier
    uint256(authorityLevel),    // [2] authorityLevel
    uint256(actionDomain),      // [3] actionDomain
    uint256(districtId)         // [4] districtId
];

(bool success, bytes memory result) = verifier.call(
    abi.encodeWithSignature("verifyProof(bytes,uint256[5])", proof, publicInputs)
);
```

**Result:** CONSISTENT - All three locations use identical ordering: [merkleRoot, nullifier, authorityLevel, actionDomain, districtId]

---

## 5. Dependency Version Analysis

**Question:** What happens if packages have different versions of @noir-lang dependencies?

### 5.1 Package Dependency Versions

| Package | `@aztec/bb.js` | `@noir-lang/noir_js` |
|---------|----------------|---------------------|
| `crypto` (v0.1.3) | `^2.1.8` | `^1.0.0-beta.16` |
| `noir-prover` (v0.1.4) | `^2.1.8` (peer) | `^1.0.0-beta.16` (peer) |
| `shadow-atlas` (v0.1.0) | `^2.1.8` (peer) | `^1.0.0-beta.16` (peer) |

### 5.2 Version Alignment

**Result:** CONSISTENT - All packages specify the same version ranges:
- `@aztec/bb.js`: `^2.1.8`
- `@noir-lang/noir_js`: `^1.0.0-beta.16`

The `noir-prover` and `shadow-atlas` packages correctly declare these as `peerDependencies`, ensuring version alignment with `crypto`.

### 5.3 Circuit Bytecode Compatibility

The test file at `/packages/noir-prover/src/prover.test.ts:11-12` notes:
```
The circuit bytecode was compiled with Noir 1.0.0-beta.15.
Full proof tests require the same noir_js version.
```

**MEDIUM RISK:** There's a minor version discrepancy between circuit compilation (beta.15) and runtime dependency (beta.16). This may cause witness generation issues. However, the golden vector tests in `crypto` pass, suggesting compatibility.

---

## 6. Critical Issues Identified

### CRITICAL-1: Legacy Depth-14 Reference in Test Files

**Location:** `/packages/noir-prover/src/prover.test.ts:71`

```typescript
function createMockCircuitInputs(): CircuitInputs {
    const DEPTH = 14;  // DEPRECATED - not a valid CircuitDepth!
    // ...
    merklePath: Array(DEPTH).fill('0x...')
```

**Impact:** Depth-14 is not a supported `CircuitDepth` (only 18, 20, 22, 24 are valid). This will cause test failures when actually running proof generation.

**Recommendation:** Update to use `DEFAULT_CIRCUIT_DEPTH` (20) or a valid depth.

### CRITICAL-2: Fixture Generator Import Path Issue

**Location:** `/packages/noir-prover/src/fixtures.ts:27`

```typescript
import fixturesCircuit from '../../crypto/noir/fixtures/target/fixtures.json';
```

**Impact:** This relative import assumes a monorepo structure. When `@voter-protocol/noir-prover` is published and installed as a standalone package, this import will fail because `../../crypto/` won't exist.

**Recommendation:** Either:
1. Add `@voter-protocol/crypto/noir-fixtures` export and import that
2. Copy fixtures.json to noir-prover during build
3. Inline the fixture generation logic

### CRITICAL-3: DistrictGate vs DistrictGate Public Input Mismatch

**Location:** `/contracts/src/DistrictGate.sol:207`

```solidity
"verifyProof(bytes,uint256[3])"  // OLD: 3 inputs
```

vs

**Location:** `/contracts/src/DistrictGate.sol:260`

```solidity
"verifyProof(bytes,uint256[5])"  // NEW: 5 inputs
```

**Impact:** The legacy `DistrictGate` contract expects only 3 public inputs, but the current circuit returns 5. This will cause all verifications through the V1 contract to fail.

**Status:** V1 is deprecated; V2 is the active contract. However, if any integrators use V1, they will experience failures.

---

## 7. Medium Issues

### MEDIUM-1: Missing DOMAIN_HASH1 in Noir Circuit

The `DOMAIN_HASH1` constant (used by `hashSingle` in TypeScript) is not defined in the Noir circuit. This is intentional since the circuit uses `hash4` for leaf computation, not `hashSingle`. However, this means TypeScript's `hashSingle()` output will never match any circuit computation.

**Impact:** Low - `hashSingle` is not used in circuit paths.

### MEDIUM-2: Inconsistent CircuitDepth Export Locations

`CircuitDepth` type is defined in multiple places:
- `/packages/crypto/district-prover.ts:48`
- `/packages/noir-prover/src/types.ts:29`
- `/packages/shadow-atlas/src/core/constants.ts:48`

All define `type CircuitDepth = 18 | 20 | 22 | 24`, but they are separate type declarations.

**Recommendation:** Export from a single canonical location (e.g., `@voter-protocol/crypto`) and re-export elsewhere.

### MEDIUM-3: Noir Version Mismatch Warning

Test file indicates circuits compiled with `noir 1.0.0-beta.15` but dependencies specify `1.0.0-beta.16`.

**Recommendation:** Re-compile circuits with the dependency version or document the known compatibility.

### MEDIUM-4: Mock Verifiers in Tests Use Wrong Signature

**Location:** `/contracts/test/DistrictGate.Core.t.sol:508`

```solidity
function verifyProof(bytes calldata, uint256[3] calldata) external pure returns (bool) {
```

These mock verifiers don't match the V2 contract's `uint256[5]` signature, which could mask integration issues.

---

## 8. Low Issues

### LOW-1: Inconsistent Error Message Formats

| Package | Error Format |
|---------|--------------|
| `noir-prover/types.ts` | `Invalid authority level: ${level}. Must be integer 1-5.` |
| `crypto/district-prover.ts` | `Invalid authority_level: ${...} (must be in [1, 5])` |

**Recommendation:** Standardize error messages across packages.

### LOW-2: Hardcoded Default Depth Values

`DEFAULT_CIRCUIT_DEPTH = 20` is defined in multiple places. If changed in one location but not others, it could cause subtle bugs.

---

## 9. Recommended Alignment Fixes

### Priority 1 (Critical)

1. **Fix depth-14 in test file:**
   ```typescript
   // prover.test.ts
   const DEPTH = 20;  // Use valid CircuitDepth
   ```

2. **Fix fixture import for published package:**
   ```typescript
   // Use package export instead of relative path
   import fixturesCircuit from '@voter-protocol/crypto/noir-fixtures';
   ```

### Priority 2 (High)

3. **Consolidate CircuitDepth type:**
   - Export from `@voter-protocol/crypto`
   - Re-export from `noir-prover` and `shadow-atlas`

4. **Update mock verifiers in tests:**
   ```solidity
   function verifyProof(bytes calldata, uint256[5] calldata) external pure returns (bool)
   ```

### Priority 3 (Medium)

5. **Re-compile circuits with matching Noir version:**
   - Current: Compiled with `1.0.0-beta.15`
   - Target: Match `1.0.0-beta.16` in dependencies

6. **Standardize error messages:**
   - Create shared error string constants

---

## 10. Verification Matrix

| Integration Point | crypto ↔ noir-prover | noir-prover ↔ contracts | shadow-atlas ↔ crypto |
|-------------------|---------------------|------------------------|----------------------|
| DOMAIN_HASH2 | PASS | PASS | N/A (uses crypto) |
| Authority levels | PASS | PASS | PASS |
| Merkle path format | PASS | PASS | PASS |
| Public input order | PASS | PASS (V2) | N/A |
| Dependency versions | PASS | N/A | PASS |
| Type exports | WARN (duplicate) | PASS | WARN (duplicate) |

---

## Appendix A: File References

| File | Purpose | Critical Constants |
|------|---------|-------------------|
| `/packages/crypto/poseidon2.ts` | Poseidon2 hasher | `DOMAIN_HASH2`, `DOMAIN_HASH1`, `BN254_MODULUS` |
| `/packages/crypto/noir/district_membership/src/main.nr` | ZK circuit | `DOMAIN_HASH2`, `MIN/MAX_AUTHORITY_LEVEL` |
| `/packages/noir-prover/src/prover.ts` | Proof generation | Public input extraction order |
| `/packages/noir-prover/src/types.ts` | TypeScript types | `CircuitDepth`, `AuthorityLevel` |
| `/packages/shadow-atlas/src/merkle-tree.ts` | Tree construction | `MerkleProof` interface |
| `/packages/shadow-atlas/src/core/constants.ts` | Constants | `AUTHORITY_LEVELS`, `CIRCUIT_DEPTHS` |
| `/contracts/src/DistrictGate.sol` | Verifier orchestration | Public input array ordering |
| `/contracts/src/VerifierRegistry.sol` | Verifier registry | Depth validation (18-24 even) |

---

## Appendix B: Test Commands

```bash
# Verify golden vectors (hash consistency)
cd packages/crypto && npm test -- golden-vectors.test.ts

# Verify prover initialization
cd packages/noir-prover && npm test -- prover.test.ts

# Run contract tests (requires foundry)
cd contracts && forge test --match-contract DistrictGate

# Full integration test (requires all packages built)
npm run test:integration
```

---

*Report generated by integration engineer review on 2026-02-01*
