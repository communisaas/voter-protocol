# Two-Tree Architecture: Expert Agent Review Summary

**Date:** 2026-02-02
**Agents:** 8 specialized reviewers
**Spec Version:** TWO-TREE-ARCH-001 v0.1.0

---

## Overall Verdict: 🟡 FEASIBLE WITH CONDITIONS

The Two-Tree Architecture is **implementable** but requires resolution of several blocking issues before production deployment.

| Category | Status | Effort |
|----------|--------|--------|
| Circuit/Noir | 🟡 Feasible | 2-3 weeks |
| Smart Contracts | 🟡 Significant changes | 2 weeks |
| Shadow Atlas | 🔴 SMT blocker | 3-4 weeks |
| Communique | 🟡 Major refactor | 2-3 weeks |
| Crypto Package | 🟡 New components | 2 weeks |
| Migration | 🔴 Re-registration required | N/A |
| Security | 🟡 3 HIGH findings | Review needed |
| Performance | 🟡 Marginal mobile | Testing needed |

**Total Estimated Effort:** 10-14 weeks

---

## Critical Blockers (Must Fix)

### ~~🔴 BLOCKER-1: No SMT Implementation Exists~~ → ✅ RESOLVED (2026-02-03)

**Source:** Shadow Atlas Agent, Crypto Agent

> **RESOLVED:** `SparseMerkleTree` class implemented in `packages/crypto/sparse-merkle-tree.ts` (664 lines). Features: Poseidon2 hash integration, collision overflow chaining, empty hash precomputation with domain separation (`EMPTY_CELL_TAG = 0x454d50545943454c4c`), subtree memoization cache (13× speedup), async factory pattern. 42 tests passing across 10 suites.

**Original analysis (preserved for context):**
The codebase had zero Sparse Merkle Tree implementation. The spec assumes SMT for Tree 2 (cell mapping), which was built from scratch.

**Delivered:**
- `SparseMerkleTree` class in `@voter-protocol/crypto`
- Position-based (not append-only) insertion with collision handling
- Path bits for proof verification
- `SMTProof` type with `{ key, value, siblings, pathBits, root, attempt }`
- 664 LOC implementation + 696 LOC tests

---

### ~~🔴 BLOCKER-2: Migration Requires Re-Registration~~ → ✅ RESOLVED

**Source:** Migration Agent

> **v0.2 RESOLUTION:** This blocker was based on analyzing the spec in isolation, not the implementation. Existing credentials expire every 6 months (`session-credentials.ts:expiresAt`). At natural renewal, users re-enter their address (existing flow) and the system generates a two-tree credential. No forced mass re-registration. No extra data collection. The 6-month credential cycle IS the migration mechanism. See TWO-TREE-ARCHITECTURE-SPEC.md §13.

**Original analysis (preserved for context):**
1. Current leaf: `H(user_secret, district_id, authority_level, salt)`
2. New leaf: `H(user_secret, cell_id, salt)`
3. `cell_id` is NOT stored in current system (only `district_id`)
4. Cannot derive `cell_id` from `district_id` (1 district = 100K+ cells)

**Why this isn't a blocker:** Users already re-enter their address at credential renewal. The migration is invisible — a code path change, not a user-facing event. Both verifiers run in parallel during the 6-month rollover.

---

### ~~🔴 BLOCKER-3: Poseidon2 Sponge Construction Bug~~ → ✅ RESOLVED (2026-02-03)

**Source:** Circuit Agent

> **RESOLVED:** Sponge implemented with correct ADD semantics in both Noir (`sponge.nr`) and TypeScript (`poseidon2.ts`). Domain tag `DOMAIN_SPONGE_24 = 0x534f4e47455f24`. Cross-language golden vector verified: `13897144223796711226515669182413786178697447221339740051025074265447026549851`. Spec section 4.3 already had correct pseudocode (ADD, not overwrite). Spec domain tag value corrected from `0x534f4e4745_18` to `0x534f4e47455f24` to match implementation.

**Original analysis (preserved for context):**
The spec v0.1 had a bug where inputs were assigned (overwriting state). The correct sponge construction uses addition.

**Delivered:**
- `packages/crypto/noir/district_membership/src/sponge.nr` — Noir implementation (154 lines, 6 tests)
- `packages/crypto/poseidon2.ts` — TypeScript `poseidon2Sponge()` method added
- `packages/crypto/test/sponge-vectors.test.ts` — 26 cross-language tests
- Golden vector cross-verified between TypeScript and Noir

---

## High Priority Issues

### ~~⚠️ HIGH-1: SMT Position Collision~~ → ✅ RESOLVED (2026-02-03)

**Source:** Security Agent

> **RESOLVED:** The `SparseMerkleTree` implementation uses Option B (overflow chaining). When a position collision occurs, `position = hash(position, cell_id)` is used to find the next available slot. The `attempt` counter is stored in proofs so verification can reconstruct the correct path. Collision handling tested with 42 tests including dedicated collision suites.

**Original analysis (preserved for context):**
With 242K cells mapped to 2^20 positions, collisions are near-certain (birthday paradox). The SMT implementation handles this via overflow chaining with attempt counter tracking.

---

### ⚠️ HIGH-2: Missing District Extraction Proof

**Source:** Security Agent

Circuit proves "I know 24 districts for my cell" but NOT "the district I'm claiming is one of those 24."

**Current circuit outputs:** `districts[24]`
**Missing verification:** `required_district ∈ districts[24]`

**Fix:** Contract-side loop to verify required districts are in revealed set (already in spec section 9.3, confirmed correct).

---

### ⚠️ HIGH-3: Authority Level Binding

**Source:** Security Agent

Authority level removed from leaf in two-tree model. Spec says it's a "per-proof witness" but doesn't bind it cryptographically.

**Current:** User can claim any authority level.

**Fix:** Either:
1. Re-add authority to user leaf: `H(user_secret, cell_id, authority_level, salt)`
2. Or enforce authority via application layer (accept current design)

**Recommendation:** Keep current design, enforce via actionDomain scoping.

---

### ⚠️ HIGH-4: Verifier Public Input Count

**Source:** Smart Contract Agent

Current verifier expects 5 public inputs. Two-tree needs **29 public inputs**:
- user_root (1)
- cell_map_root (1)
- districts[24] (24)
- nullifier (1)
- action_domain (1)
- authority_level (1)

**Impact:** Cannot reuse existing verifier contracts.

**Fix:** Deploy new verifier contract for two-tree circuit.

---

## Medium Priority Issues

### 🟡 MED-1: Mobile Proving Time Marginal

**Source:** Performance Agent

> **v0.2 CORRECTION:** The agent's estimates were based on a ~160K constraint figure that used ~3,125 constraints per Poseidon2 hash. The current circuit measures ~500 constraints per hash (DISTRICT-MEMBERSHIP-CIRCUIT-SPEC §3.1), yielding ~25.5K constraints (2.3× single-tree, not 14.5×). Revised estimates below.

| Device | v0.1 Est. (160K) | v0.2 Est. (25.5K) | Threshold |
|--------|-------------------|---------------------|-----------|
| iPhone 14+ | ~14s | ~14s | ✅ <20s |
| Android flagship | ~17s | ~14-17s | ✅ <20s |
| Mid-range (2yr old) | ~29s | ~20-28s | ✅/⚠️ <30s |
| Low-end | ~40s+ | ~30-40s | ⚠️ Marginal |

**Risk:** Low-end devices marginal; mid-range now likely within threshold.

**Mitigation:**
1. Progress UI for proofs exceeding 15s
2. Timeout handling with retry

---

### 🟡 MED-2: Dual Registry Contracts

**Source:** Smart Contract Agent

Two-tree requires 2 new registry contracts:
1. `UserRootRegistry.sol` - Manages Tree 1 roots
2. `CellMapRegistry.sol` - Manages Tree 2 roots with 90-day grace

**Complexity:** Dual root validation, separate lifecycles.

---

### 🟡 MED-3: IPFS Storage Increase

**Source:** Shadow Atlas Agent

**Current:** Single tree per country → ~50MB IPFS
**Two-Tree:** User tree + Cell map per country → ~100MB IPFS

**Additional:** Cell map SMT needs full node storage for updates.

---

### ~~🟡 MED-4: Domain Separation Tags~~ → ✅ RESOLVED (2026-02-03)

**Source:** Circuit Agent

> **RESOLVED:** Domain separation implemented in both Noir and TypeScript:
> - `DOMAIN_SPONGE_24 = 0x534f4e47455f24` ("SONGE_24") — sponge construction
> - `DOMAIN_HASH2 = 0x48324d` ("H2M") — pair hashing
> - `DOMAIN_HASH3 = 0x48334d` ("H3M") — 3-input hashing (two-tree user leaf)
> - `DOMAIN_HASH1 = 0x48314d` ("H1M") — single hashing
> - `EMPTY_CELL_TAG = 0x454d50545943454c4c` ("EMPTYCELL") — SMT empty leaves
>
> All 5 domain tags verified consistent across TypeScript (`poseidon2.ts`, `sparse-merkle-tree.ts`) and Noir (`main.nr`, `sponge.nr`). No collisions. Spec updated to match implementation values.

---

## Confirmed Strengths

✅ **User-to-cell binding is cryptographically secure** - Cannot fake cell membership

✅ **Nullifier construction prevents double-voting** - Works across both trees

✅ **District commitment is re-derived in circuit** - Users cannot forge districts

✅ **Cell ID remains private** - Only districts revealed, not geographic precision

✅ **Existing Poseidon2 implementation is correct** - No changes needed to hash functions

✅ **Gas estimate is reasonable** - ~403K gas on Scroll L2

✅ **SMT and standard Merkle have same constraint cost** - No performance penalty for SMT

---

## Recommended Spec Updates

### Section 4.3: Fix Sponge Construction
```noir
// ADD to state, don't overwrite
state[1] = state[1] + inputs[i * 3];
state[2] = state[2] + inputs[i * 3 + 1];
state[3] = state[3] + inputs[i * 3 + 2];
```

### Section 3.5: Add Collision Handling
```typescript
// Add collision detection strategy
function getCellPosition(cell_id: Field, attempt: number = 0): u32 {
    let hash = Poseidon2_Hash2(cell_id, attempt);
    return (hash as u32) & 0xFFFFF;
}
```

### Section 12: Add SMT Implementation Requirement
- Explicit SMT class specification
- Path bit encoding
- Empty hash precomputation

### Section 13: Clarify Migration Reality
- ALL users must re-register
- Parallel operation period required
- No credential preservation possible

### Section 15: Add Device Testing Matrix
- Specific device targets (iPhone 12+, Pixel 6+, etc.)
- Timeout handling requirements
- Progress UI requirements

---

## Implementation Order

**Phase 1: Foundations (Weeks 1-3)** ✅ COMPLETE (2026-02-03)
1. ~~Implement SMT in `@voter-protocol/crypto`~~ ✅ `sparse-merkle-tree.ts` (664 LOC, 42 tests)
2. ~~Fix sponge construction bug~~ ✅ `sponge.nr` + `poseidon2.ts` sponge method
3. ~~Add domain separation~~ ✅ 4 domain tags implemented
4. ~~Golden vector tests~~ ✅ Cross-language golden vector verified

**Phase 2: Circuit (Weeks 4-5)** ✅ COMPLETE (2026-02-03)
1. ~~Create `two_tree_membership.nr`~~ ✅ 443 lines, 17 tests (main.nr + sponge.nr)
2. ~~Compile for depths 18, 20, 22, 24~~ ✅ 4 artifacts (51-54KB each)
3. ~~WASM artifacts / test vectors~~ ✅ 21 cross-language golden vector tests
4. ~~Add hash3() to crypto SDK~~ ✅ `DOMAIN_HASH3=0x48334d` in poseidon2.ts + main.nr

**Phase 3: Contracts + Shadow Atlas (Weeks 6-7)** ✅ COMPLETE (2026-02-04)
1. ~~UserRootRegistry.sol~~ ✅ 331 LOC, 46 tests (30-day sunset, 7-day timelock)
2. ~~CellMapRegistry.sol~~ ✅ 337 LOC, 46 tests (90-day deprecation grace)
3. ~~DistrictGate two-tree function~~ ✅ `verifyTwoTreeProof()` with 29 public inputs, 19 integration tests
4. ~~DeployTwoTree.s.sol~~ ✅ Staged deployment script
5. ~~Shadow Atlas dual-tree builder~~ ✅ `dual-tree-builder.ts` (500 LOC, 45 tests)
6. ~~Cell-district loader~~ ✅ `cell-district-loader.ts` (24 district slots, GEOID encoding)

**Phase 4: Prover Stack** ✅ COMPLETE (2026-02-04)
1. ~~TwoTreeNoirProver~~ ✅ Lazy circuit loading, input validation, SA-011 check (34 tests)
2. ~~Client adapter~~ ✅ `TwoTreeNoirProverAdapter` with init/warmup/prove
3. ~~Types + exports~~ ✅ `TwoTreeProofInput`, `TwoTreeProofResult`, `TWO_TREE_PUBLIC_INPUT_COUNT=29`

**Phase 5: E2E + Migration (Partial)**
1. ~~End-to-end integration test~~ ✅ `two-tree-e2e.test.ts` (9 tests, full pipeline)
2. ~~Final doc sweep + spec updates~~ ✅ Spec v0.3, gap analysis updated (20→6 open), wave plan updated
3. Registration flow changes (Communique integration) — REMAINING
4. Credential storage schema — REMAINING
5. Proof generation UI — REMAINING
6. Dual-system deployment — REMAINING

---

## Go/No-Go Recommendation

### 🟢 GO with conditions:

1. ✅ Fix sponge construction bug before implementation — **DONE** (sponge.nr + poseidon2.ts)
2. ✅ Implement SMT first (blocking dependency) — **DONE** (sparse-merkle-tree.ts)
3. ✅ Accept re-registration requirement (no workaround) — **RESOLVED** (6-month credential cycle)
4. ✅ Budget for 10-14 week timeline
5. ✅ Plan mobile device testing
6. ⚠️ Defer if mobile proving time is unacceptable

### Progress (as of 2026-02-04):
- **Phase 1 (Foundations):** COMPLETE — SMT, sponge, domain separation, golden vectors
- **Phase 2 (Circuit):** COMPLETE — two_tree_membership.nr (17 tests), compiled at 4 depths, 21 golden vector tests, hash3 SDK
- **Phase 3 (Contracts + Shadow Atlas):** COMPLETE — UserRootRegistry (46 tests), CellMapRegistry (46 tests), DistrictGate.verifyTwoTreeProof (19 integration tests), DeployTwoTree.s.sol, dual-tree-builder (45 tests)
- **Phase 4 (Prover):** COMPLETE — TwoTreeNoirProver (34 tests), client adapter, types/exports
- **Phase 5 (E2E + Migration):** PARTIAL — E2E test (9 tests) + doc sweep done; registration flow, credential schema, UI, deployment remaining

### Key Risk:
Mid-range mobile proving at ~29s is at threshold. Recommend prototype testing on target devices before full commitment.
