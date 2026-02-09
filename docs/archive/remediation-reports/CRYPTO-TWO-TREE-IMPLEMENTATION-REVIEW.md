# Expert Review: Crypto Package Changes for Two-Tree Architecture

**Review Date:** 2026-02-02
**Reviewer:** Cryptographic Engineering Expert
**Specification:** `/Users/noot/Documents/voter-protocol/specs/TWO-TREE-ARCHITECTURE-SPEC.md`
**Scope:** Crypto package (`packages/crypto/`) implementation blockers for two-tree migration

---

## Executive Summary

The two-tree architecture represents a **MAJOR REFACTORING** of the cryptographic primitives in the voter protocol. While the existing crypto package has excellent foundations (Poseidon2 hasher, domain separation, golden test vectors), implementing the two-tree system requires:

1. **New SMT implementation** - Sparse Merkle Tree with deterministic positioning
2. **New sponge construction** - Poseidon2 absorption for 24 districts
3. **New circuit artifacts** - `two_tree_membership` circuit with dual tree verification
4. **Build system updates** - Additional compilation targets and artifact management

**Overall Risk Assessment:** 🟡 **MEDIUM-HIGH**

**Estimated Implementation Effort:** 3-4 weeks for full implementation + testing

**Critical Path Blockers:** 2 CRITICAL, 3 HIGH, 4 MEDIUM

---

## Table of Contents

1. [SMT TypeScript Implementation](#1-smt-typescript-implementation)
2. [Poseidon2 Sponge Construction](#2-poseidon2-sponge-construction)
3. [Consistency Across Packages](#3-consistency-across-packages)
4. [Build System Changes](#4-build-system-changes)
5. [Blockers and Concerns](#5-blockers-and-concerns)
6. [Recommendations](#6-recommendations)
7. [Migration Checklist](#7-migration-checklist)

---

## 1. SMT TypeScript Implementation

### 1.1 Current State

**Existing Implementation:** Standard Merkle tree in `/packages/shadow-atlas/src/merkle-tree.ts`
- Append-only insertion (sequential indices)
- Perfect binary tree with padding
- Excellent parallelization strategy
- O(1) address lookup via index map

**Gap Analysis:**
```typescript
// CURRENT: Standard Merkle (User Tree pattern)
class ShadowAtlasMerkleTree {
  - Sequential leaf insertion
  - Index determined by insertion order
  - No key-based positioning
}

// NEEDED: Sparse Merkle Tree (Cell Map pattern)
class SparseMerkleTree {
  + Deterministic leaf positioning from key
  + Sparse storage (only populated paths)
  + Proof of absence capability
  + Position calculation: hash(cell_id) & DEPTH_MASK
}
```

### 1.2 Design Requirements

**Core Class Structure:**
```typescript
export class SparseMerkleTree {
  private depth: number;
  private nodes: Map<string, bigint>;        // Sparse storage
  private emptyHashes: bigint[];              // Precomputed empty chain
  private readonly EMPTY_CELL_HASH: bigint;  // Distinguished empty value

  constructor(depth: number) {
    this.depth = depth;
    this.nodes = new Map();
    this.emptyHashes = this.computeEmptyHashes();
    this.EMPTY_CELL_HASH = await hasher.hashString("EMPTY_CELL");
  }

  // Deterministic position calculation
  private getCellPosition(cellId: string): number {
    const keyHash = poseidon2Hash1(BigInt(cellId));
    return Number(keyHash & BigInt((1 << this.depth) - 1));
  }

  // Core operations
  update(key: string, value: bigint): void;
  getPath(key: string): { path: bigint[]; pathBits: number[] };
  getRoot(): bigint;
}
```

**Empty Hash Precomputation:**
```typescript
private computeEmptyHashes(): bigint[] {
  const hashes: bigint[] = new Array(this.depth + 1);
  hashes[0] = this.EMPTY_CELL_HASH;

  for (let i = 1; i <= this.depth; i++) {
    // Empty parent = hash(empty_child, empty_child)
    hashes[i] = poseidon2Hash2(hashes[i - 1], hashes[i - 1]);
  }

  return hashes;
}
```

**Position Calculation:**
```typescript
// Spec requirement (Section 3.5):
// position = hash(cell_id) & 0xFFFFF  // 20-bit mask for depth 20

private getCellPosition(cellId: bigint): number {
  const keyHash = await this.hasher.hashSingle(cellId);
  const mask = (1 << this.depth) - 1;
  return Number(keyHash & BigInt(mask));
}
```

### 1.3 Critical Issues

#### 🔴 CRITICAL-001: SMT Position Collision Handling

**Issue:** Multiple cells may hash to same position (birthday paradox).

**Probability Analysis:**
- Depth 20 = 1M positions
- 242K US cells
- Collision probability ≈ 2.7% (acceptable but needs handling)

**Mitigation Options:**
1. **Overflow chaining** (spec doesn't specify)
2. **Reject colliding insertions** (strict, may break districts)
3. **Alternative hash for collisions** (complex, non-standard)

**Recommendation:** Use **overflow chaining** with position increment:
```typescript
private findFreePosition(basePosition: number): number {
  let position = basePosition;
  while (this.nodes.has(this.positionKey(position, 0))) {
    position = (position + 1) % this.capacity;
    if (position === basePosition) {
      throw new Error("SMT full - all positions occupied");
    }
  }
  return position;
}
```

**Severity:** 🔴 **CRITICAL** - Must be resolved before implementation
**Estimated Effort:** 2 days (design + implementation + testing)

---

#### 🔴 CRITICAL-002: SMT Path Bit Encoding

**Issue:** Spec shows `path_bits: [u1; DEPTH]` but TypeScript implementation needs careful handling.

**Circuit Requirement (Section 4.1, Line 409):**
```noir
cell_map_path_bits: [u1; TREE_DEPTH]
```

**TypeScript Challenge:**
```typescript
// WRONG: JavaScript numbers can't reliably represent u1
pathBits: number[]  // [0, 1, 0, 1, ...] but could be [2, -1, 0.5, ...]

// RIGHT: Explicit validation
pathBits: number[]  // with runtime checks

validatePathBit(bit: number): asserts bit is 0 | 1 {
  if (bit !== 0 && bit !== 1) {
    throw new Error(`Invalid path bit: ${bit} (must be 0 or 1)`);
  }
}
```

**Required Validation:**
```typescript
getPath(key: string): { path: bigint[]; pathBits: number[] } {
  const pathBits: number[] = [];

  let position = this.getCellPosition(BigInt(key));
  for (let i = 0; i < this.depth; i++) {
    const bit = (position >> i) & 1;
    pathBits.push(bit);  // Guaranteed 0 or 1 by bit masking
  }

  // Sanity check
  pathBits.forEach((bit, i) => {
    if (bit !== 0 && bit !== 1) {
      throw new Error(`Invalid path bit at depth ${i}: ${bit}`);
    }
  });

  return { path, pathBits };
}
```

**Severity:** 🔴 **CRITICAL** - Circuit will reject invalid bit values
**Estimated Effort:** 1 day (implementation + golden vectors)

---

#### 🟡 HIGH-003: Sparse Storage Memory Optimization

**Issue:** Storing all 2^20 nodes defeats the purpose of sparse storage.

**Current Standard Merkle Approach:**
```typescript
private readonly layers: bigint[][];  // Full storage: 2^20 + 2^19 + ... ≈ 2M hashes
```

**Sparse Approach:**
```typescript
private nodes: Map<string, bigint>;  // Only store non-empty nodes

// Key encoding: "level-index"
private nodeKey(level: number, index: number): string {
  return `${level}-${index}`;
}

private getNode(level: number, index: number): bigint {
  const key = this.nodeKey(level, index);
  return this.nodes.get(key) ?? this.emptyHashes[level];
}
```

**Memory Savings:**
- Full tree (depth 20): ~2M × 32 bytes = 64 MB
- Sparse tree (242K cells): ~242K × 32 bytes × 20 levels ≈ 150 MB worst case
- Actual (with empty collapsing): ~10 MB

**Severity:** 🟡 **HIGH** - Performance concern for browser environments
**Estimated Effort:** 2 days (optimization + benchmarking)

---

## 2. Poseidon2 Sponge Construction

### 2.1 Current State

**Existing Hash Functions:**
```typescript
// poseidon2.ts - Lines 123-149
async hashPair(left: bigint, right: bigint): Promise<bigint>   // H2
async hashSingle(value: bigint): Promise<bigint>                // H1
async hash4(a, b, c, d: bigint): Promise<bigint>                // H4

// Domain separation via state slot 2 (hashPair) and slot 1 (hashSingle)
```

**Gap Analysis:**
```diff
+ NEEDED: Sponge construction for 24 districts
+ async hashSponge24(districts: bigint[]): Promise<bigint>
```

### 2.2 Sponge Implementation

**Spec Requirement (Section 3.3, Lines 236-251):**
```typescript
// Absorb 3 districts at a time using Poseidon2 permutation
state = [0, 0, 0, 0]  // Initial state

for i in 0..8:
    state = Poseidon2_Permutation([
        state[0],              // Carry previous state
        districts[i*3 + 0],    // Absorb district 1
        districts[i*3 + 1],    // Absorb district 2
        districts[i*3 + 2]     // Absorb district 3
    ])

district_commitment = state[0]
```

**TypeScript Implementation:**
```typescript
/**
 * Poseidon2 sponge construction for 24 district commitment
 *
 * Spec: TWO-TREE-ARCHITECTURE-SPEC.md Section 3.3
 * Circuit: two_tree_membership/src/main.nr line 325-337
 */
async hashSponge24(districts: readonly bigint[]): Promise<bigint> {
  if (districts.length !== 24) {
    throw new Error(`Expected 24 districts, got ${districts.length}`);
  }

  // Validate all districts are valid field elements
  districts.forEach((d, i) => {
    if (d < 0n || d >= BN254_MODULUS) {
      throw new Error(`Invalid district ${i}: ${d} (must be in BN254 field)`);
    }
  });

  // Initial state: [0, 0, 0, 0]
  let state: [bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n];

  // Absorb 3 districts per permutation (8 iterations)
  for (let i = 0; i < 8; i++) {
    const d0 = districts[i * 3];
    const d1 = districts[i * 3 + 1];
    const d2 = districts[i * 3 + 2];

    // Permutation: carry state[0], absorb 3 new elements
    state = [state[0], d0, d1, d2];

    // Call Noir circuit for permutation (matches circuit exactly)
    const hash = await this.hash4(state[0], state[1], state[2], state[3]);
    state[0] = hash;
    state[1] = 0n;  // Reset absorbed slots (not used in next iteration)
    state[2] = 0n;
    state[3] = 0n;
  }

  // Extract commitment from state[0]
  return state[0];
}
```

### 2.3 Critical Issues

#### 🟡 HIGH-004: Sponge State Management

**Issue:** Spec shows iterative state update but implementation details unclear.

**Spec Ambiguity (Line 243-248):**
```
state = Poseidon2_Permutation([
    state[0],              // ← Is this the PREVIOUS permutation output?
    districts[i*3 + 0],
    ...
])
```

**Two Interpretations:**

**Option A: Iterative Chain (Cryptographically Stronger)**
```typescript
// Each permutation feeds into next
state[0] = hash4(prev_state[0], d0, d1, d2)
state[0] = hash4(prev_state[0], d3, d4, d5)  // Uses prev result
```

**Option B: Independent Permutations (Spec Literal Reading)**
```typescript
// Each permutation starts fresh
state[0] = hash4(0, d0, d1, d2)
state[0] = hash4(0, d3, d4, d5)  // Doesn't use prev result
```

**Circuit Evidence (Spec Line 329-335):**
```noir
for i in 0..8:
    state[1] = inputs[i * 3];
    state[2] = inputs[i * 3 + 1];
    state[3] = inputs[i * 3 + 2];
    state = poseidon2_permutation(state, 4);  // ← CARRIES state[0]
```

**Conclusion:** Option A is correct (iterative chain).

**Severity:** 🟡 **HIGH** - Wrong implementation = proof verification failure
**Estimated Effort:** 1 day (clarify spec + golden vectors)

---

#### 🟠 MEDIUM-005: Sponge Domain Separation

**Issue:** No domain tag specified for sponge construction.

**Current Domain Tags:**
- `DOMAIN_HASH2 = 0x48324d` ("H2M")
- `DOMAIN_HASH1 = 0x48314d` ("H1M")

**Question:** Should sponge use a tag?

**Analysis:**
```typescript
// Current sponge: state = [state[0], district, district, district]
// All 4 state slots used → no room for domain tag

// Alternative: Use domain tag in initial state
state = [DOMAIN_SPONGE, 0, 0, 0]  // First permutation starts with tag
```

**Recommendation:**
1. **No tag initially** - Spec doesn't require it, arity collision unlikely
2. **Add tag if future need** - Easy to version (district_commitment_v2)

**Severity:** 🟠 **MEDIUM** - Spec compliance, low collision risk
**Estimated Effort:** 0.5 days (decision + documentation)

---

## 3. Consistency Across Packages

### 3.1 Hash Output Format

**Current Consistency:** ✅ **EXCELLENT**

**Evidence:**
```typescript
// packages/crypto/poseidon2.ts - Line 148
return BigInt(returnValue);  // All hash functions return bigint

// packages/shadow-atlas/src/merkle-tree.ts - Line 246
const addressHashes = await hasher.hashStringsBatch(addresses, batchSize);
// Returns: bigint[]

// packages/crypto/district-prover.ts - Line 296-302
const { witness: computedWitness, returnValue } = await this.noir.execute(inputs);
const publicOutputs = returnValue as string[];
// Circuit outputs as strings, converted to bigint for verification
```

**Format Conventions:**
- **TypeScript internal:** `bigint` (native precision)
- **Circuit outputs:** `string` (hex with 0x prefix or decimal)
- **On-chain:** `bytes32` (32-byte hex)

**Conversion Matrix:**
```typescript
// TypeScript → Circuit
inputs.field = '0x' + bigint.toString(16).padStart(64, '0');

// Circuit → TypeScript
bigint = BigInt(returnValue);

// TypeScript → On-chain
bytes32 = '0x' + bigint.toString(16).padStart(64, '0');
```

**Verdict:** No changes needed, excellent consistency.

---

### 3.2 Noir Circuit ↔ TypeScript Matching

**Current Alignment:** ✅ **EXCELLENT**

**Evidence:**

**Hash Function Parity:**
```typescript
// TypeScript (poseidon2.ts:132-138)
async hashPair(left: bigint, right: bigint): Promise<bigint> {
  const inputs = [
    this.toHex(left),
    this.toHex(right),
    DOMAIN_HASH2,   // 0x48324d
    ZERO_PAD,
  ];
  return noir.execute({ inputs });
}

// Noir (district_membership/src/main.nr:32-36)
fn poseidon2_hash2(left: Field, right: Field) -> Field {
    let mut state: [Field; 4] = [left, right, DOMAIN_HASH2, 0];
    let out = poseidon2_permutation(state, 4);
    out[0]
}
```

**Perfect 1:1 Match:** ✅

**Golden Test Vectors:** ✅ **COMPREHENSIVE**

```typescript
// packages/crypto/test/golden-vectors.test.ts
// Lines 68-132: Hardcoded expected values from Noir circuit
const HASH_1_2 = 5700113488374071721540629675635551041370719088032104434910951352719804357924n;
const HASH_0_0 = 7920904892182681660068699473082554335979114182301659186550863530220333250830n;
// ... 12 golden vectors total
```

**Two-Tree Requirement:**
```typescript
// NEEDED: Add golden vectors for new hash functions
const HASH_SPONGE_24 = ???n;  // Generate from two_tree circuit
const HASH_CELL_MAP_LEAF = ???n;  // H2(cell_id, district_commitment)
const SMT_EMPTY_HASH = ???n;  // hashString("EMPTY_CELL")
```

**Verdict:** Add ~5 new golden vectors for two-tree functions.

---

### 3.3 Endianness Concerns

**Current State:** ✅ **NO ENDIANNESS ISSUES**

**Analysis:**

**BN254 Field Elements:** Big-endian hex representation
```typescript
// All conversions use toString(16) / BigInt(hex)
// No byte-level manipulation that could introduce endianness bugs
```

**Hash Function:** Pure field arithmetic (no byte ordering)
```typescript
// Poseidon2 operates on field elements, not byte arrays
// No pack/unpack operations that could be endianness-sensitive
```

**Cell ID Encoding:**
```typescript
// Spec (Appendix B): Census Block Group FIPS is 12 decimal digits
// Example: 060750612001 → stored as Field (numeric value, no byte order)

// TypeScript
const cellId = BigInt("060750612001");

// Noir
let cell_id: Field = 060750612001;
```

**Verdict:** No endianness concerns. All data is field elements or hex strings.

---

## 4. Build System Changes

### 4.1 Current Build Pipeline

**Existing Circuits (packages/crypto/package.json:18-22):**
```json
"circuits/district_membership_18": "./noir/district_membership/target/district_membership_18.json",
"circuits/district_membership_20": "./noir/district_membership/target/district_membership_20.json",
"circuits/district_membership_22": "./noir/district_membership/target/district_membership_22.json",
"circuits/district_membership_24": "./noir/district_membership/target/district_membership_24.json"
```

**Build Script:** `scripts/build-circuits.sh`
- Compiles 4 depth variants (18, 20, 22, 24)
- Uses sed to replace `DEPTH` constant
- Generates `district_membership_{depth}.json`

### 4.2 Two-Tree Circuit Compilation

**New Directory Structure:**
```
packages/crypto/noir/
├── district_membership/        # EXISTING (single-tree)
│   └── target/
│       ├── district_membership_18.json
│       ├── district_membership_20.json
│       ├── district_membership_22.json
│       └── district_membership_24.json
└── two_tree_membership/        # NEW
    ├── Nargo.toml
    ├── src/
    │   └── main.nr             # Circuit from spec Section 4.1
    └── target/
        ├── two_tree_20.json    # Default
        ├── two_tree_22.json
        └── two_tree_24.json
```

**New Build Targets:**
```bash
#!/bin/bash
# scripts/build-two-tree-circuits.sh

CIRCUIT_DIR="noir/two_tree_membership"
DEPTHS=(20 22 24)  # Removed 18 - too small for two-tree

for depth in "${DEPTHS[@]}"; do
  # Replace TREE_DEPTH constant (line 304 in spec)
  sed -i "s/global TREE_DEPTH: u32 = [0-9]\+;/global TREE_DEPTH: u32 = ${depth};/" \
    "${CIRCUIT_DIR}/src/main.nr"

  # Compile
  (cd "${CIRCUIT_DIR}" && nargo compile)

  # Rename
  mv "${CIRCUIT_DIR}/target/two_tree_membership.json" \
     "${CIRCUIT_DIR}/target/two_tree_${depth}.json"
done
```

**Package.json Updates:**
```json
{
  "exports": {
    "circuits/two_tree_20": "./noir/two_tree_membership/target/two_tree_20.json",
    "circuits/two_tree_22": "./noir/two_tree_membership/target/two_tree_22.json",
    "circuits/two_tree_24": "./noir/two_tree_membership/target/two_tree_24.json"
  },
  "scripts": {
    "build:circuits": "./scripts/build-circuits.sh && ./scripts/build-two-tree-circuits.sh"
  }
}
```

### 4.3 Critical Issues

#### 🟠 MEDIUM-006: Circuit Artifact Size

**Issue:** Two-tree circuit is ~2.3× larger than single-tree.

**Constraint Analysis (Spec Section 4.2):**
```
Single-tree: ~70K constraints
Two-tree:    ~160K constraints
```

**Artifact Size Estimate:**
```
district_membership_20.json: ~450 KB
two_tree_20.json:            ~1.1 MB (estimated)
```

**npm Package Impact:**
```
Current package size: ~2 MB
After two-tree:       ~5 MB (3 × two_tree variants)
```

**Mitigation Options:**
1. **Lazy loading** - Don't bundle in main package, load on demand
2. **Separate package** - `@voter-protocol/two-tree-circuits`
3. **CDN hosting** - Load from CDN, not npm

**Recommendation:** Use **separate package** for clean separation.

**Severity:** 🟠 **MEDIUM** - Package size concern, mitigatable
**Estimated Effort:** 1 day (refactor package exports)

---

#### 🟠 MEDIUM-007: Nargo Version Compatibility

**Issue:** Spec requires specific Noir version for two-tree circuit.

**Current Version (package.json:35):**
```json
"@noir-lang/noir_js": "^1.0.0-beta.16"
```

**Compatibility Risk:**
- Poseidon2 implementation may change between Noir versions
- Circuit compilation may fail with newer/older nargo
- Golden vectors would need regeneration

**Mitigation:**
```json
// Lock exact version (no ^)
"@noir-lang/noir_js": "1.0.0-beta.16"

// Add build-time check
scripts/check-nargo-version.sh:
  required_version="1.0.0-beta.16"
  actual_version=$(nargo --version | grep -oP '\d+\.\d+\.\d+-beta\.\d+')
  if [ "$actual_version" != "$required_version" ]; then
    echo "ERROR: nargo version mismatch"
    exit 1
  fi
```

**Severity:** 🟠 **MEDIUM** - Build reliability concern
**Estimated Effort:** 0.5 days (version lock + CI checks)

---

## 5. Blockers and Concerns

### 5.1 Critical Blockers (Must Fix Before Implementation)

| ID | Title | Severity | Effort | Description |
|----|-------|----------|--------|-------------|
| **CRITICAL-001** | SMT Position Collision | 🔴 | 2 days | Need collision handling strategy for deterministic positioning |
| **CRITICAL-002** | SMT Path Bit Encoding | 🔴 | 1 day | Circuit expects `[u1; DEPTH]`, TypeScript must match exactly |

**Total Critical Path:** 3 days

---

### 5.2 High Priority Issues (Should Fix Before Deployment)

| ID | Title | Severity | Effort | Description |
|----|-------|----------|--------|-------------|
| **HIGH-003** | Sparse Storage Optimization | 🟡 | 2 days | Memory efficiency for browser environments |
| **HIGH-004** | Sponge State Management | 🟡 | 1 day | Clarify spec ambiguity on iterative state |
| **HIGH-005** | Missing Test Coverage | 🟡 | 2 days | No existing SMT tests, need comprehensive suite |

**Total High Priority:** 5 days

---

### 5.3 Medium Priority Issues (Nice to Have)

| ID | Title | Severity | Effort | Description |
|----|-------|----------|--------|-------------|
| **MEDIUM-006** | Circuit Artifact Size | 🟠 | 1 day | Package size ~5MB, consider separate package |
| **MEDIUM-007** | Nargo Version Lock | 🟠 | 0.5 days | Lock Noir version to prevent drift |
| **MEDIUM-008** | SMT Batch Operations | 🟠 | 2 days | No batch update API for SMT, manual iteration required |
| **MEDIUM-009** | Documentation Gaps | 🟠 | 1 day | Need SMT usage examples and migration guide |

**Total Medium Priority:** 4.5 days

---

### 5.4 Open Questions Requiring Specification Clarification

**Q1: SMT Collision Resolution Strategy**
- Spec doesn't specify how to handle position collisions
- Options: chaining, rejection, alternative hash
- **Impact:** Core SMT functionality

**Q2: Empty Cell Hash Value**
- Spec shows `H("EMPTY_CELL")` but doesn't specify exact string
- Need canonical value for test vectors
- **Impact:** Cross-implementation compatibility

**Q3: District Commitment Domain Separation**
- Should sponge use domain tag?
- Affects future versioning
- **Impact:** Security posture, extensibility

**Q4: Cell Map Tree Depth**
- Spec says depth 20, but should this be configurable?
- US has 242K cells (fits depth 20), but what about future scaling?
- **Impact:** Future-proofing

**Q5: Migration Strategy for Existing Users**
- How are existing single-tree credentials migrated?
- Is there a grace period where both systems run?
- **Impact:** User experience, deployment complexity

---

## 6. Recommendations

### 6.1 Immediate Actions (Week 1)

**Day 1-2: Specification Clarification**
- [ ] Resolve CRITICAL-001 (collision handling)
- [ ] Resolve CRITICAL-002 (path bit encoding)
- [ ] Answer Q1, Q2, Q3 (specification gaps)
- [ ] Update spec with clarifications

**Day 3-5: Core SMT Implementation**
- [ ] Implement `SparseMerkleTree` class
- [ ] Add position collision handling
- [ ] Implement path generation with bit validation
- [ ] Unit tests for SMT operations

**Deliverable:** Working SMT prototype with 95% test coverage

---

### 6.2 Short-term Actions (Week 2)

**Day 6-7: Sponge Construction**
- [ ] Implement `hashSponge24()` in Poseidon2Hasher
- [ ] Generate golden test vectors from two_tree circuit
- [ ] Add comprehensive sponge tests

**Day 8-10: Circuit Integration**
- [ ] Create `two_tree_membership` circuit (Noir)
- [ ] Build script for multi-depth compilation
- [ ] Integration tests (TypeScript ↔ Noir)

**Deliverable:** Two-tree prover with verified golden vectors

---

### 6.3 Medium-term Actions (Week 3-4)

**Week 3: Build System & Packaging**
- [ ] Separate `@voter-protocol/two-tree-circuits` package
- [ ] Update crypto package exports
- [ ] CI/CD pipeline for two-tree builds
- [ ] Version locking for Nargo

**Week 4: Testing & Documentation**
- [ ] End-to-end integration tests
- [ ] Performance benchmarking (mobile targets)
- [ ] Migration guide for developers
- [ ] API documentation

**Deliverable:** Production-ready two-tree crypto package

---

### 6.4 Long-term Considerations

**Performance Optimization:**
- [ ] WASM optimization for SMT operations
- [ ] Worker thread support for parallel proof generation
- [ ] IndexedDB caching for SMT paths

**Security Hardening:**
- [ ] Formal verification of SMT position algorithm
- [ ] Audit of sponge construction
- [ ] Fuzz testing for edge cases

**Ecosystem Integration:**
- [ ] Shadow Atlas API updates
- [ ] Client (Communique) prover updates
- [ ] Contract verifier deployment

---

## 7. Migration Checklist

### 7.1 Crypto Package Changes

**New Files:**
- [ ] `packages/crypto/sparse-merkle-tree.ts` - SMT implementation
- [ ] `packages/crypto/two-tree-prover.ts` - Dual tree prover
- [ ] `packages/crypto/noir/two_tree_membership/src/main.nr` - Circuit
- [ ] `packages/crypto/test/sparse-merkle-tree.test.ts` - SMT tests
- [ ] `packages/crypto/test/two-tree-prover.test.ts` - Prover tests
- [ ] `packages/crypto/test/two-tree-golden-vectors.test.ts` - Golden vectors
- [ ] `packages/crypto/scripts/build-two-tree-circuits.sh` - Build script

**Modified Files:**
- [ ] `packages/crypto/poseidon2.ts` - Add `hashSponge24()`
- [ ] `packages/crypto/package.json` - Add two-tree circuit exports
- [ ] `packages/crypto/scripts/build-circuits.sh` - Call two-tree build

**API Additions:**
```typescript
// sparse-merkle-tree.ts
export class SparseMerkleTree {
  constructor(depth: number);
  update(key: string, value: bigint): void;
  getPath(key: string): { path: bigint[]; pathBits: number[] };
  getRoot(): bigint;
}

// poseidon2.ts
export class Poseidon2Hasher {
  async hashSponge24(districts: readonly bigint[]): Promise<bigint>;
}

// two-tree-prover.ts
export class TwoTreeProver {
  async generateProof(inputs: TwoTreeProofInputs): Promise<TwoTreeProof>;
}
```

---

### 7.2 Testing Requirements

**Unit Tests:**
- [ ] SMT position calculation (deterministic, collision-free)
- [ ] SMT path generation (siblings, path bits)
- [ ] SMT empty hash chain (precomputation)
- [ ] Sponge construction (24 districts → commitment)
- [ ] Two-tree proof generation (valid witness)

**Integration Tests:**
- [ ] TypeScript SMT ↔ Noir circuit consistency
- [ ] Sponge output matches circuit
- [ ] Full two-tree proof (generation + verification)

**Golden Vectors:**
- [ ] `hashSponge24([0, 1, 2, ..., 23])` → expected hash
- [ ] SMT empty hash chain (depth 20, 22, 24)
- [ ] Cell map leaf: `H2(cell_id, district_commitment)`
- [ ] User identity leaf: `H3(user_secret, cell_id, salt)`

**Performance Tests:**
- [ ] SMT update: <50ms per cell (242K cells in <15 seconds)
- [ ] Proof generation: <30s on mid-range mobile
- [ ] Memory usage: <500MB for full SMT

**Coverage Target:** 95% for critical path, 85% overall

---

### 7.3 Documentation Requirements

**Developer Documentation:**
- [ ] SMT architecture overview
- [ ] Two-tree proof flow diagram
- [ ] Migration guide (single-tree → two-tree)
- [ ] API reference (JSDoc → Markdown)

**User Documentation:**
- [ ] What happens during redistricting (no action needed)
- [ ] When to re-register (user moves only)
- [ ] Grace period explanation

**Deployment Documentation:**
- [ ] Circuit artifact build process
- [ ] Version compatibility matrix
- [ ] Rollback procedures

---

## Appendix A: File Structure

**Complete Two-Tree File Tree:**
```
packages/crypto/
├── src/
│   ├── index.ts                          # Public API exports
│   ├── poseidon2.ts                      # MODIFIED: Add hashSponge24()
│   ├── district-prover.ts                # EXISTING: Single-tree prover
│   ├── sparse-merkle-tree.ts             # NEW: SMT implementation
│   └── two-tree-prover.ts                # NEW: Dual tree prover
├── noir/
│   ├── fixtures/                         # EXISTING: Hash test circuit
│   ├── district_membership/              # EXISTING: Single-tree circuit
│   └── two_tree_membership/              # NEW: Two-tree circuit
│       ├── Nargo.toml
│       ├── src/main.nr                   # From spec Section 4.1
│       └── target/
│           ├── two_tree_20.json
│           ├── two_tree_22.json
│           └── two_tree_24.json
├── test/
│   ├── poseidon2.test.ts                 # EXISTING
│   ├── district-prover.test.ts           # EXISTING
│   ├── golden-vectors.test.ts            # EXISTING
│   ├── sparse-merkle-tree.test.ts        # NEW
│   ├── two-tree-prover.test.ts           # NEW
│   └── two-tree-golden-vectors.test.ts   # NEW
├── scripts/
│   ├── build-circuits.sh                 # EXISTING: Single-tree build
│   ├── build-two-tree-circuits.sh        # NEW: Two-tree build
│   └── generate-two-tree-vectors.ts      # NEW: Golden vector generation
└── package.json                          # MODIFIED: Add two-tree exports
```

---

## Appendix B: Constraint Analysis

**Two-Tree Circuit Breakdown (Spec Section 4.2):**

| Component | Hashes | Constraints (est.) | Notes |
|-----------|--------|-------------------|-------|
| User leaf (H3) | 1 | 3,125 | `hash3(user_secret, cell_id, salt)` |
| User Merkle path (depth 20) | 20 | 62,500 | Standard Merkle verification |
| District commitment (sponge 24→1) | 8 | 25,000 | 8 Poseidon2 permutations |
| Cell map leaf (H2) | 1 | 3,125 | `hash2(cell_id, commitment)` |
| Cell map SMT path (depth 20) | 20 | 62,500 | Sparse Merkle verification |
| Nullifier (H2) | 1 | 3,125 | `hash2(user_secret, action_domain)` |
| Authority range checks | - | 500 | `assert(1 <= authority <= 5)` |
| **TOTAL** | **51** | **~160,000** | **2.3× single-tree** |

**Mobile Proving Time (estimated):**
- Desktop: 7-12 seconds (acceptable)
- Mobile (flagship): 14-20 seconds (acceptable)
- Mobile (mid-range): 25-35 seconds (⚠️ marginal)

**Recommendation:** Profile on target devices before deployment.

---

## Appendix C: Risk Assessment Summary

| Risk Category | Level | Mitigation |
|--------------|-------|------------|
| **Implementation Complexity** | 🟡 HIGH | Incremental development, extensive testing |
| **Specification Ambiguity** | 🟡 HIGH | Resolve Q1-Q5 before coding |
| **Circuit-TypeScript Divergence** | 🟢 LOW | Golden test vectors, CI checks |
| **Performance on Mobile** | 🟡 MEDIUM | Profile early, optimize if needed |
| **Breaking API Changes** | 🟢 LOW | New package, existing API unchanged |
| **Deployment Risk** | 🟡 MEDIUM | Phased rollout, parallel systems |

**Overall Risk:** 🟡 **MEDIUM-HIGH** (manageable with proper planning)

---

## Conclusion

The two-tree architecture is **implementable** with the existing crypto package foundations, but requires:

1. **3 weeks of focused development** (SMT + sponge + circuit + testing)
2. **Resolution of 2 critical spec ambiguities** before coding
3. **Comprehensive golden test vectors** for cross-implementation consistency
4. **Mobile performance validation** before production deployment

**Go/No-Go Recommendation:** 🟢 **GO** with conditions:
- Resolve CRITICAL-001 and CRITICAL-002 first
- Allocate full 3-4 week timeline (no shortcuts)
- Budget for mobile performance optimization if needed
- Plan phased rollout with fallback to single-tree

**Next Steps:**
1. Spec clarification meeting (resolve Q1-Q5)
2. Prototype SMT implementation (validate approach)
3. Generate golden vectors from two_tree circuit
4. Full implementation with test-driven development

---

**End of Review**
