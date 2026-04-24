# Audit Resolution Plan

**Source:** `docs/DOCUMENTATION-COHERENCE-AUDIT.md` (2026-02-20)
**Strategy:** Group fixes by blast radius and dependency. Ship in revision cycles. Defer decision boundaries.

---

## Revision Cycle 1: Critical Code Fixes (No Decision Boundaries)

**Scope:** Fix code-adjacent items that affect correctness or could cause bugs.
**Blast radius:** voter-protocol only. No doc rewrites.

### 1.1 Fix EngagementTier JSDoc (ZK-C03, ENG-C03)

**File:** `packages/noir-prover/src/types.ts` L387-394

Replace hard-threshold cascade with composite score model:
```
Before: "1: Active -- actionCount >= 1, diversityScore >= 1"
After:  "1: Active -- composite score E > 0"
```
Tier boundaries: 0 (E=0), 1 (E>0), 2 (E>=5), 3 (E>=12), 4 (E>=25).
Reference: REPUTATION-ARCHITECTURE-SPEC.md Section 4.3.2.

### 1.2 Fix golden-vectors tier comments (ENG-C04)

**File:** `packages/crypto/test/three-tree-golden-vectors.test.ts` L41-48

Same correction as 1.1 — update JSDoc comments on TIER_ACTIVE through TIER_PILLAR constants.

### 1.3 Fix DeployScrollMainnet.s.sol (SC-C05)

**File:** `contracts/script/DeployScrollMainnet.s.sol`

Add:
- UserRootRegistry deployment
- CellMapRegistry deployment
- `setTwoTreeRegistriesGenesis()` call
- `registerActionDomainGenesis()` call

Match DeployScrollSepolia.s.sol completeness.

### 1.4 Fix deploy.sh (SC-C04)

**File:** `contracts/script/deploy.sh`

Add UserRootRegistry + CellMapRegistry to the deployment sequence, or add a deprecation header redirecting to Foundry Script contracts.

### 1.5 Fix UserRootRegistry NatSpec (SC-C05)

**File:** `contracts/src/UserRootRegistry.sol` L12

Change `leaf = H(user_secret, cell_id, salt)` to `leaf = H4(user_secret, cell_id, registration_salt, authority_level)`.

### 1.6 Fix DistrictGate NatSpec header (ZK-C05, ZK-C04)

**File:** `contracts/src/DistrictGate.sol` L20-55

- Update public inputs section to describe two-tree (29) / three-tree (31) as primary
- Update gas estimate from 300-400K to ~2.2M
- Note single-tree path as legacy

### 1.7 Fix VerifierRegistry NatSpec (ZK-C07)

**File:** `contracts/src/VerifierRegistry.sol` L48

Change `UltraPlonkVerifier_Depth{N}.sol` to `HonkVerifier_Depth{N}.sol`.

### 1.8 Fix PUBLIC-INPUT-FIELD-REFERENCE.md (ZK-M03, ZK-M04)

**File:** `specs/PUBLIC-INPUT-FIELD-REFERENCE.md`

- Add `identity_commitment` to private inputs table
- Add three-tree fields [29] `engagement_root` and [30] `engagement_tier`

---

## Revision Cycle 2: Spec Corrections (No Decision Boundaries)

**Scope:** Fix canonical specs where doc contradicts implemented code.
**Blast radius:** voter-protocol specs/ only.

### 2.1 Fix TWO-TREE-ARCHITECTURE-SPEC.md Section 1.1 (ZK-C01)

**File:** `specs/TWO-TREE-ARCHITECTURE-SPEC.md` L82-86

Change 3-input leaf to H4:
```
Before: leaf = H(user_secret, cell_id, salt)
After:  leaf = H4(user_secret, cell_id, registration_salt, authority_level)
```

### 2.2 Fix TWO-TREE-ARCHITECTURE-SPEC.md Section 10.3 (ZK-C02)

**File:** `specs/TWO-TREE-ARCHITECTURE-SPEC.md` L1268-1274

Change `poseidon2Hash3()` to `poseidon2Hash4()`. Add `authorityLevel` parameter.

### 2.3 Fix TWO-TREE-ARCHITECTURE-SPEC.md Section 11 (ZK-S06)

**File:** `specs/TWO-TREE-ARCHITECTURE-SPEC.md` L1343

Change `UltraPlonkBackend` to `UltraHonkBackend`.

### 2.4 Fix TWO-TREE-ARCHITECTURE-SPEC.md gas table (ZK-C04)

**File:** `specs/TWO-TREE-ARCHITECTURE-SPEC.md` L829-843

Replace 403K gas table with actual measurements. Reference `docs/DOCUMENTATION-COHERENCE-AUDIT.md` Section 1 for range analysis.

### 2.5 Fix REPUTATION-ARCHITECTURE-SPEC.md Section 6.1 (ENG-C01)

**File:** `specs/REPUTATION-ARCHITECTURE-SPEC.md` L616-644

Update EngagementRootRegistry pseudocode:
- Remove `country` field
- Replace `RootInfo` with `EngagementRootMetadata` (lifecycle: REGISTERED->ACTIVE->SUNSET->EXPIRED)
- Replace `revokeEngagementRoot()` with timelocked deactivation

### 2.6 Fix REPUTATION-ARCHITECTURE-SPEC.md Section 6.2 (ENG-C02)

**File:** `specs/REPUTATION-ARCHITECTURE-SPEC.md` L673-676

Remove country cross-check from `verifyThreeTreeProof()` pseudocode.

### 2.7 Add POST /v1/engagement/register to spec (ENG-C05)

**File:** `specs/REPUTATION-ARCHITECTURE-SPEC.md` ~L878

Add endpoint to Section 9.2 API table with auth requirement and request/response shape.

### 2.8 Fix reputation.md diversity_score (ENG-C04)

**File:** `docs/roadmap/phase-2/reputation.md` L82

Change "Distinct action categories exercised" to "Shannon diversity index H = -sum(pi * ln(pi)), stored as floor(H * 1000)".

### 2.9 Fix ADVERSARIAL-ATTACK-DOMAINS.md Domain 2 (SC-C07)

**File:** `specs/ADVERSARIAL-ATTACK-DOMAINS.md` L66-71

Mark NullifierRegistry governance transfer as resolved (BA-006). Note TimelockGovernance inheritance.

### 2.10 Fix COORDINATION-INTEGRITY-SPEC.md S1.6 (SC-C08)

**File:** `specs/COORDINATION-INTEGRITY-SPEC.md` Section 1.6

Update to reflect authority level enforcement is implemented (CI-002 complete).

---

## Revision Cycle 3: Obsolete Document Triage (No Decision Boundaries)

**Scope:** Add SUPERSEDED headers to fully-obsolete docs. No content rewrite.
**Blast radius:** voter-protocol docs/ only. 5-minute per file.

### 3.1 Mark NOIR-PROVING-INFRASTRUCTURE.md as SUPERSEDED (ZK-S01)

Add header:
```
> **SUPERSEDED** — This document describes the pre-two-tree single-circuit architecture.
> Current architecture: see `specs/TWO-TREE-ARCHITECTURE-SPEC.md` and `specs/REPUTATION-ARCHITECTURE-SPEC.md`.
> Proof system: UltraHonk/Noir via @aztec/bb.js (not UltraPlonk/Halo2).
```

### 3.2 Mark ZK-PRODUCTION-ARCHITECTURE.md as SUPERSEDED (ZK-S02)

Same header pattern.

### 3.3 Mark zk-infrastructure.md as SUPERSEDED (ZK-S03)

Same header pattern.

### 3.4 Update MULTI-DEPTH-VERIFIER-ARCHITECTURE.md staleness notice (ZK-S04)

Replace "PARTIALLY STALE" with specific corrections:
- Interface: `verify(bytes calldata proof, bytes32[] calldata publicInputs)` (not uint256 array)
- Verifier names: HonkVerifier (not UltraPlonkVerifier)
- Generation: `scripts/generate-verifier-sol.ts` via bb.js (not `bb contract` CLI)

### 3.5 Mark phase-2-design.md token section as superseded (ENG-F02)

Add note: "Token model superseded by REPUTATION-ARCHITECTURE-SPEC.md Section 7 (dual: VOTER ERC-20 + soulbound ERC-8004)."

### 3.6 Update THREE-TREE-IMPLEMENTATION-CYCLES.md status (ENG-S01)

Mark Cycles 21-22 as COMPLETE. Update Cycle 23 as PARTIAL.

---

## Revision Cycle 4: Global Find-Replace (No Decision Boundaries)

**Scope:** Mechanical string replacements across both repos.
**Blast radius:** Both repos, docs only (no code changes).

### 4.1 UltraPlonk -> UltraHonk (voter-protocol, 56+ refs)

**Targeted files** (highest impact first):
- ARCHITECTURE.md (10 refs)
- SECURITY.md (5 refs)
- README.md (2 refs)
- contracts/README.md (4 refs)
- smart-contracts.md (14 refs) — NOTE: this file is slated for full rewrite in Cycle 6
- MULTI-DEPTH-VERIFIER-ARCHITECTURE.md (14 refs) — already has staleness header from 3.4
- generate-verifiers.sh (8 refs, has BA-021 comment)

Contextual replace, not blind. "UltraPlonk" -> "UltraHonk" where it refers to our proving system. Leave alone in historical audit references that quote the old name.

### 4.2 Halo2 -> UltraHonk/Noir (communique, 25+ refs)

**Targeted files:**
- docs/design/voice.md
- docs/design/patterns/privacy-governance.md
- docs/architecture/tee-systems.md
- docs/testing/ZK-PROOF-TESTING-STRATEGY.md
- docs/development/ownership.md (also slated for rewrite in Cycle 5)
- docs/specs/proof-generation-ux.md
- docs/strategy/delivery-verification.md
- ~17 additional files

Replace "Halo2" with "UltraHonk/Noir" or "Noir/Barretenberg" depending on context.

### 4.3 @voter-protocol/client purge (both repos, 14+ refs)

Remove all references to the deleted package. Replace with:
- `@voter-protocol/noir-prover` for proof generation
- `@voter-protocol/crypto` for Poseidon2 hashing
- `district-gate-client.ts` for on-chain submission

---

## Revision Cycle 5: communique Doc Cleanup (No Decision Boundaries)

**Scope:** Fix communique-side documentation.
**Blast radius:** communique docs/ only.

### 5.1 Delete or rewrite ownership.md (FE-S01)

**DECISION POINT:** Delete entirely vs. rewrite from scratch. This is the highest-density stale document in the entire corpus. Contains wrong proof system, deleted packages, wrong contract paths, wrong TEE provider, wrong implementation status.

**Recommendation:** Delete. The content is irrelevant — it describes a system that no longer exists. If ownership documentation is needed, write fresh from current COMMUNIQUE-INTEGRATION-SPEC.md.

### 5.2 Fix TEE provider docs (FE-C02)

Update `tee-systems.md` and remaining docs from GCP Confidential Space to AWS Nitro Enclaves.

### 5.3 Fix database references (FE-C04)

Normalize legacy database-stack references in `maintenance.md`, `quickstart.md`, and `seeding.md` to point at Convex (`commons/convex/schema.ts`).

### 5.4 Fix deployment target (FE-S03)

Update Fly.io references to Cloudflare Pages in `index.md`, `quickstart.md`.

### 5.5 Fix ZK-PROOF-TESTING-STRATEGY.md (FE-S02)

Replace Halo2/Axiom references. Update to describe Noir/Barretenberg/UltraHonk, two-tree architecture, depth 20, keccak mode. Fix manual testing checklist stages.

### 5.6 Clarify Firecrawl caching (FE-S04)

If Firecrawl caching is re-enabled, cache rows should live in a Convex table with a TTL index. Update DEPLOYMENT_CHECKLIST.md.

### 5.7 Add missing contract addresses to .env.example (SC-F01)

Add CAMPAIGN_REGISTRY_ADDRESS, DISTRICT_REGISTRY_ADDRESS, ENGAGEMENT_ROOT_REGISTRY_ADDRESS.

---

## Revision Cycle 6: Major Rewrites (Decision Boundaries)

**Scope:** Documents requiring substantial rewrite. Each has decision boundaries.
**Blast radius:** voter-protocol core docs.

### 6.1 Rewrite smart-contracts.md (SC-C01)

**DECISION BOUNDARY:** This is a from-scratch rewrite. The current document describes a completely different contract system (3 public inputs, single verifier, permissionless actions, phantom contracts). Need to decide:
- Document all 10 contracts or focus on user-facing ones?
- Include deployment scripts or reference them?
- Include full ABI or just interface signatures?

**Deferred for discussion.**

### 6.2 Update ARCHITECTURE.md Phase 1 contract list (SC-C02)

**DECISION BOUNDARY:** ARCHITECTURE.md is the project's front door. It contains:
- Phase 1 contract list (wrong — 5 phantom, 6 missing)
- Gas cost projections (wrong by 5.5x)
- Cost model ($3,650/year — coincidentally close to current reality but derived wrong)
- System overview (partially correct)

Full rewrite vs. targeted section updates?

**Recommendation:** Targeted section updates. Replace contract list, gas projections, and cost model. Leave system overview and philosophical sections intact.

**Deferred for discussion.**

### 6.3 Address 3 reputation model fragmentation (ENG-F01)

**DECISION BOUNDARY:** communique has 3 independent reputation systems. Options:
1. Document them as intentionally separate (application layer, ZK layer, credibility layer)
2. Merge application-layer `reputation_tier` with ZK `engagement_tier`
3. Deprecate application-layer model in favor of ZK-only

This affects communique Postgres schema and hooks.server.ts. Not a docs-only change.

**Deferred for discussion.**

---

## Revision Cycle 7: Security-Adjacent Items

**Scope:** Items with security implications that should be resolved before mainnet.

### 7.1 CampaignRegistry.authorizeCaller() timelock (SC-C06)

**DECISION BOUNDARY:** Every other contract uses genesis+seal or propose/execute for caller authorization. CampaignRegistry is the sole exception. Options:
1. Add timelock (consistent with all other contracts)
2. Document the design rationale for the exception
3. Accept the risk (participation records are less critical than nullifiers)

**Deferred for discussion.**

### 7.2 communique depth hardcoding (ZK-F01)

prover-client.ts hardcodes depth 20 in 5 places. Options:
1. Accept (US-only launch, depth 20 covers all states)
2. Parameterize now (prevents forced rewrite for international support)
3. Add as env var (CIRCUIT_DEPTH=20)

**Recommendation:** Option 3 (env var). Minimal code change, future-proofs.

**Deferred for discussion.**

---

## Resolution Matrix

| Cycle | Items | Effort | Decision Boundaries | Blocking | Status |
|-------|-------|--------|--------------------|---------|--------|
| **1** | 8 code fixes | ~2h | None | Mainnet deploy | **COMPLETE** (2026-02-20) |
| **2** | 10 spec corrections | ~3h | None | External review | **COMPLETE** (8/10 — 2 skipped: phantom files) |
| **3** | 6 superseded headers | ~30min | None | None | **COMPLETE** (2026-02-20) |
| **4** | 3 global renames | ~2h | None | External review | **COMPLETE** (52 replacements, 23 files) |
| **5** | 7 communique fixes | ~3h | None | Developer onboarding | **COMPLETE** (2026-02-20) |
| **6** | 3 major rewrites | ~8h | **3 decisions** | External review | **COMPLETE** (2026-02-20) — D1: all 10 contracts lean, D2: targeted sections, D3: document as layers |
| **7** | 2 security items | ~2h | **2 decisions** | Mainnet deploy | **COMPLETE** (2026-02-20) — D4: document exception, D5: VITE_CIRCUIT_DEPTH env var |

**Completed:** All 7 cycles. All 5 decision boundaries resolved.

---

## Decision Boundaries — Resolved

| # | Question | Decision | Implementation |
|---|----------|----------|---------------|
| D1 | smart-contracts.md rewrite scope | All 10 contracts, lean | Full rewrite: `docs/architecture/smart-contracts.md` |
| D2 | ARCHITECTURE.md approach | Targeted sections | Contract list, gas projections, UltraPlonk→UltraHonk in `ARCHITECTURE.md` |
| D3 | Reputation model fragmentation | Document as intentional layers | Section 16 added to `specs/REPUTATION-ARCHITECTURE-SPEC.md` |
| D4 | CampaignRegistry timelock | Document exception (accept risk) | NatSpec added to `authorizeCaller()` in `CampaignRegistry.sol` |
| D5 | Depth hardcoding | VITE_CIRCUIT_DEPTH env var | `prover-client.ts` parameterized, `.env.example` updated |
