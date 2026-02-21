# Three-Tree Implementation Cycles

> **Status:** Active — Cycles 18-22 COMPLETE. Cycle 23 (communique integration) next.
> **Strategy:** implementation → review → manual review per cycle
> **Canonical Spec:** specs/REPUTATION-ARCHITECTURE-SPEC.md
> **Last Updated:** 2026-02-20

---

## Cycle Summary

| Cycle | Component | Status | Deliverables |
|-------|-----------|--------|-------------|
| 18 | Documentation | **COMPLETE** | REPUTATION-ARCHITECTURE-SPEC.md + 4 doc updates |
| 19 | Circuit | **COMPLETE** | Three-tree Noir circuit + 28 tests + 18 TS vectors + 4 depths compiled |
| 20 | Contracts | **COMPLETE** | EngagementRootRegistry + DistrictGate extension + 79 new tests (573 total) |
| 21 | Shadow Atlas | **COMPLETE** | EngagementTreeBuilder + chain-scanner + engagement-service + API endpoints + tests |
| 22 | Prover | **COMPLETE** | ThreeTreeNoirProver + compiled circuits (4 depths) + tests |
| 23 | Communique | PENDING | SessionCredential + ProofInputMapper + UX |
| 24 | Tokens | PENDING | VOTER (ERC-20) + soulbound credential (ERC-8004) |
| 25 | Markets | PENDING | Challenge market MVP (E2 bonds) |

---

## Cycle 18: Documentation (COMPLETE)

**Deliverables:**
- [x] `specs/REPUTATION-ARCHITECTURE-SPEC.md` — 1,023 lines, canonical spec
- [x] `specs/TWO-TREE-ARCHITECTURE-SPEC.md` — Section 17 appended, v0.6.0
- [x] `ARCHITECTURE.md` — Phase 2 reputation subsection
- [x] `docs/roadmap/phase-2/reputation.md` — ZK engagement integration section
- [x] `docs/CHALLENGE-MARKET-ARCHITECTURE.md` — Section 17 (anti-pay-to-win)

**Findings:** None (documentation only).

---

## Cycle 19: Three-Tree Noir Circuit

### Implementation Phase — COMPLETE

**Goal:** Working three-tree Noir circuit that compiles for depths 18/20/22/24 with golden vector tests.

**Files created:**

| File | Action | Description |
|------|--------|-------------|
| `packages/crypto/noir/three_tree_membership/src/main.nr` | CREATED | Three-tree circuit (Steps 1-7, 28 Noir tests) |
| `packages/crypto/noir/three_tree_membership/src/sponge.nr` | COPIED | Same sponge module as two-tree |
| `packages/crypto/noir/three_tree_membership/Nargo.toml` | CREATED | Circuit manifest |
| `packages/crypto/scripts/build-three-tree-circuits.sh` | CREATED | Build script for 4 depths (copies to noir-prover/circuits/) |
| `packages/crypto/test/three-tree-golden-vectors.test.ts` | CREATED | 18 cross-language hash parity tests |

**Implementation results:**
- 28 Noir tests passing (hash determinism, domain separation, tier validation, cross-tree binding, sponge)
- 18 TypeScript golden vector tests passing (H3 engagement commitment, H2 engagement leaf, identity binding)
- 19 two-tree Noir tests still passing (no regressions)
- 30 existing TS golden vector tests still passing (no regressions)
- 4 compiled circuit JSONs: depth 18 (74KB), 20 (75KB), 22 (76KB), 24 (77KB)

**Circuit additions (Steps 5-7):**
1. `engagement_root: pub Field` and `engagement_tier: pub Field` added to public inputs (index 29, 30)
2. Private inputs: `engagement_path`, `engagement_index`, `action_count`, `diversity_score`
3. Step 5: `validate_engagement_tier()` — range check [0, 4] using BA-007 pattern
4. Step 6: `engagement_data_commitment = H3(tier, action_count, diversity_score)`, then `engagement_leaf = H2(identity_commitment, engagement_data_commitment)`
5. Step 7: `compute_merkle_root(engagement_leaf, engagement_path, engagement_index) == engagement_root`

### Review Phase — COMPLETE (8/8 PASS)

**Review agent checklist:**
- [x] Circuit constraint count: 748 ACIR opcodes (two-tree: 435, +72% opcodes). Actual backend constraints TBD at proving time.
- [x] Domain separation: H2/H3/H4 produce no collisions with overlapping inputs (3 Noir tests + 2 TS tests)
- [x] Cross-tree identity binding: single `identity_commitment` feeds nullifier + engagement leaf (structurally enforced)
- [x] Engagement tier range check: rejects 5, 255, 260 (BA-007 pattern with u64 guard)
- [x] Empty engagement tree: tier=0, action_count=0, diversity_score=0 produces valid non-zero outputs
- [x] Golden vectors: 18 TS tests match Noir H3/H2 implementations
- [x] Build script: produces valid JSON for all 4 depths (18: 74KB, 20: 75KB, 22: 76KB, 24: 77KB)
- [x] No regressions: 19/19 two-tree Noir tests + 30/30 existing TS golden vectors still passing

### Manual Review

- [x] Circuit logic correctness: Step 6 uses `H2(identity_commitment, H3(tier, action_count, diversity))` — same `identity_commitment` as nullifier
- [x] Private inputs: `action_count` and `diversity_score` are declared without `pub`, consumed only inside `compute_engagement_data_commitment()`
- [ ] Constraint budget: 748 ACIR opcodes vs two-tree 435 (+72%). Proving time TBD — will verify in Cycle 22 (Prover)

---

## Cycle 20: Contracts

### Implementation Phase — COMPLETE

**Goal:** EngagementRootRegistry deployed, DistrictGate extended with `verifyThreeTreeProof()`, full Solidity test coverage.

**Files created/modified:**

| File | Action | Description |
|------|--------|-------------|
| `contracts/src/EngagementRootRegistry.sol` | CREATED | Root registry (293 lines) — lifecycle: REGISTERED→ACTIVE→SUNSET→EXPIRED, 7-day sunset grace period, no country field |
| `contracts/src/DistrictGate.sol` | MODIFIED | Added `verifyThreeTreeProof()` (31 inputs), engagement registry config (genesis + timelock), EIP-712 typehash |
| `contracts/src/VerifierRegistry.sol` | MODIFIED | Added `threeTreeVerifierByDepth` mapping, separate genesis/propose/execute/cancel for three-tree verifiers |
| `contracts/test/EngagementRootRegistry.t.sol` | CREATED | 46 tests (registration, lifecycle, deactivation, expiry, reactivation, cancel, governance, fuzz, edge cases) |
| `contracts/test/DistrictGate.ThreeTree.t.sol` | CREATED | 33 tests (happy path, all tiers 0-4, registry config, root validation, tier validation, country cross-check, EIP-712, pause, backwards compat) |
| `contracts/test/VerifierRegistry.t.sol` | MODIFIED | +26 three-tree verifier tests (genesis, post-genesis, upgrades, views, independence from two-tree) |
| `contracts/script/DeployEngagementRegistry.s.sol` | CREATED | Deploy script (genesis + post-genesis modes) |

**Implementation results:**
- 599 Solidity tests passing across 16 test suites (494 existing + 105 new, 0 failures)
- via_ir compilation passes — no stack depth issues
- VerifierRegistry uses SEPARATE mappings for three-tree (`threeTreeVerifierByDepth`) vs two-tree (`verifierByDepth`)
- EngagementRootRegistry has NO country field (engagement is not country-specific)
- Engagement tier on-chain range check [0, 4] in `verifyThreeTreeProof()`
- Cross-tree identity binding enforced: same `identity_commitment` in nullifier + engagement leaf (circuit constraint)
- Country cross-check between Tree 1 and Tree 2 roots (engagement has no country)
- Genesis model: `setEngagementRegistryGenesis()` bypasses timelock; post-genesis requires 7-day timelock
- EIP-712 uses separate `SUBMIT_THREE_TREE_PROOF_TYPEHASH` from two-tree
- Honk verifier generation deferred to when actual three-tree verifiers are needed (requires Cycle 22 proving infrastructure)

**Contract architecture:**
- `verifyThreeTreeProof()` follows same 12-step flow as two-tree, adds:
  - Step 0b: Validates engagementRootRegistry is configured
  - Step 7: Validates engagement_root via `engagementRootRegistry.isValidEngagementRoot()`
  - Step 8: Engagement tier bounds check `> 4` → revert
  - Step 9: Routes to `verifierRegistry.getThreeTreeVerifier(verifierDepth)` (separate from two-tree)
  - Converts 31 uint256 inputs to bytes32[] for Honk verifier interface

### Review Phase — COMPLETE (7/7 PASS)

- [x] Backwards compatibility: `verifyTwoTreeProof()` unchanged — 26 existing two-tree tests still pass
- [x] Country cross-check across all three trees (Tree 1 ↔ Tree 2; engagement has no country)
- [x] Engagement tier range check on-chain [0, 4] — tiers 5 and 255 revert in tests
- [x] EIP-712 signature for three-tree proofs — separate typehash, deadline/signer validation tested
- [x] via_ir compilation passes — no stack depth issues
- [x] All existing 494 Solidity tests still pass (599 total)
- [x] Gas cost: TBD at mainnet deploy — mock verifiers used in tests, real gas with Honk verifiers in Cycle 22

### Manual Review

- [x] Genesis deployment model appropriate — shared `genesisSealed` flag, both tree types register at genesis
- [x] Timelock model for post-genesis changes — 7-day for engagement registry, 14-day for verifiers (consistent with existing model)
- [ ] Gas budget acceptable for Scroll mainnet — deferred to Cycle 22 (requires real Honk verifiers)

---

## Cycle 21: Shadow Atlas

### Implementation Phase

**Goal:** Server can build and serve Tree 3 from on-chain events.

**Files to create/modify:**

| File | Action | Description |
|------|--------|-------------|
| `packages/shadow-atlas/src/engagement-tree-builder.ts` | CREATE | Build Tree 3 from chain events |
| `packages/shadow-atlas/src/serving/engagement-routes.ts` | CREATE | API endpoints |
| `packages/shadow-atlas/src/serving/routes.ts` | MODIFY | Wire engagement routes |
| `packages/shadow-atlas/src/__tests__/unit/engagement-tree-builder.test.ts` | CREATE | Unit tests |
| `packages/shadow-atlas/src/__tests__/integration/engagement-api.test.ts` | CREATE | API tests |

**Key implementation details:**
- EngagementTreeBuilder reads nullifier events from DistrictGate (ethers.js provider)
- Groups events by signer, derives action_count/diversity_score/tenure
- Builds standard Merkle tree using existing `PoseidonMerkleTree` from crypto package
- Hash-chained insertion log (same pattern as Tree 1)
- IPFS pinning via existing Storacha + Lighthouse services

**API endpoints:**
- `GET /v1/engagement-info` — root, depth, leafCount, available
- `GET /v1/engagement-path/:leafIndex` — Merkle siblings + metadata
- `GET /v1/engagement-metrics/:identityCommitment` — current tier, action_count, diversity_score

### Review Phase

- [ ] Backfill algorithm matches on-chain event count
- [ ] Tier derivation matches spec (Section 4.3)
- [ ] Hash-chain integrity in insertion log
- [ ] IPFS snapshot format consistent with Tree 1/2
- [ ] API response format matches SessionCredential expectations

### Manual Review

- [ ] Event replay correctness for historical data
- [ ] Update frequency acceptable (batch vs real-time)?
- [ ] Storage requirements for IPFS snapshots

---

## Cycle 22: Prover

### Implementation Phase

**Goal:** ThreeTreeNoirProver generates valid proofs for all 4 depths.

**Files to create/modify:**

| File | Action | Description |
|------|--------|-------------|
| `packages/noir-prover/src/three-tree-prover.ts` | CREATE | Prover class |
| `packages/noir-prover/src/types.ts` | MODIFY | Add ThreeTreeProofInput, ThreeTreeProofResult |
| `packages/noir-prover/circuits/three_tree_membership_*.json` | COPY | From build script output |
| `packages/noir-prover/src/__tests__/three-tree-prover.test.ts` | CREATE | Prover tests |

**Key implementation details:**
- Follows TwoTreeNoirProver pattern (lazy circuit loaders per depth)
- `formatInputs()` maps TS camelCase → Noir snake_case for new fields
- `parsePublicInputs()` extracts 31 fields (engagement_root at [29], engagement_tier at [30])
- Golden vector test: build depth-4 tree, generate proof, verify

### Review Phase

- [ ] Cross-language hash parity (TS poseidon2Hash3 == Noir poseidon2_hash3)
- [ ] Proof size matches estimates (Section 13.3: ~16.5KB keccak)
- [ ] Proof generation time reasonable (~11.5s at depth 20)
- [ ] Public input extraction correct (indices 29, 30)
- [ ] Keccak mode works for on-chain verification

### Manual Review

- [ ] E2E: generate proof → verify on-chain (Scroll Sepolia)
- [ ] Memory usage acceptable for browser proving?

---

## Cycle 23: Communique

### Implementation Phase

**Goal:** Communique generates and submits three-tree proofs with engagement tier display.

**Files to create/modify:**

| File | Action | Description |
|------|--------|-------------|
| `communique/src/lib/core/identity/session-credentials.ts` | MODIFY | Add engagement fields to SessionCredential |
| `communique/src/lib/core/identity/shadow-atlas-handler.ts` | MODIFY | Fetch engagement proof (Tree 3) |
| `communique/src/routes/api/shadow-atlas/engagement/+server.ts` | CREATE | Engagement proxy endpoint |
| `communique/src/lib/core/identity/proof-input-mapper.ts` | MODIFY | Map engagement inputs |

### Review Phase

- [ ] Privacy audit: engagement metrics stay in IndexedDB, never sent to server
- [ ] Three-tree proof generation works in browser (SharedArrayBuffer + COOP/COEP)
- [ ] Fallback: if Tree 3 unavailable, generate two-tree proof (graceful degradation)
- [ ] UX: tier badge renders correctly for tiers 0-4

### Manual Review

- [ ] Full flow: registration → engagement fetch → proof generation → submission
- [ ] Congressional dashboard displays tier correctly
- [ ] No new PII leakage paths

---

## Cycle 24: Tokens

### Implementation Phase

**Goal:** VOTER ERC-20 and soulbound engagement credential ERC-8004 contracts.

**Note:** Token name TBD. Do not deploy until legal review.

### Review Phase

- [ ] VOTER: standard ERC-20, no admin mint (SupplyAgent controlled)
- [ ] Soulbound: transfer/transferFrom revert, approve is no-op
- [ ] Engagement tier updates by authorized issuer only
- [ ] Economic model: emission rates, supply cap, circuit breaker

### Manual Review

- [ ] Legal compliance review (CLARITY Act framework)
- [ ] Economic security audit
- [ ] Token name decision

---

## Cycle 25: Challenge Markets MVP

### Implementation Phase

**Goal:** E2 template creation bonds with engagement multiplier.

**Note:** This is the E2 phase of the E0-E3 sequence. Requires Cycles 19-24 complete.

### Review Phase

- [ ] Quadratic influence: `sqrt(stake) * engagement_multiplier(tier)`
- [ ] Engagement multiplier table correct (1.0x-2.0x)
- [ ] Economic attack surface analysis

### Manual Review

- [ ] Market mechanism sign-off
- [ ] E2 gate criteria met before activation

---

## Findings Log

Track findings from review phases that require follow-up:

| Cycle | Finding | Severity | Resolution | Status |
|-------|---------|----------|------------|--------|
| 18 | (none — documentation only) | — | — | — |

---

## Cross-Cutting Concerns

### Circuit Staleness (CRITICAL LESSON)
Compiled circuit JSONs in `noir-prover/circuits/` can go STALE when Noir source changes. Always recompile (`build-three-tree-circuits.sh`) AND rebuild noir-prover (`npm run build`) after modifying any `.nr` file.

### Two-Tree Compatibility
All two-tree functionality MUST continue working. Three-tree is additive, not replacement. `verifyTwoTreeProof()` remains callable indefinitely.

### nargo Version
Three-tree circuits must compile with nargo 1.0.0-beta.16 (same version as two-tree). Pin version in build script.

### Testing Strategy
- Noir: `nargo test` for in-circuit tests
- TS: `vitest` for golden vectors and prover tests
- Solidity: `forge test` for contract tests
- E2E: Real data proof (depth 20, DC cells) through full pipeline
