# Coherence Audit — Round 2

**Date:** 2026-02-20
**Method:** 8 specialist agents (Crypto Protocol, Contract Security, API Coherence, Spec Fidelity, Deploy/Ops, Documentation, Privacy, Test Coverage)
**Repos:** voter-protocol + communique
**Prior art:** Round 1 resolved 29 findings across 10 commits

---

## Corrections Applied

Before triage, three user-supplied corrections adjusted findings:

| Correction | Effect |
|------------|--------|
| **Convex is the database** | DOC-021 invalidated; FE-C04 from Round 1 inverted |
| **Deploy target is Cloudflare Pages** (not Fly.io) | fly-deploy.yml confirmed dead code — delete, don't fix |
| **.env.example contains placeholders** (not secrets) | OPS "zero private key" finding invalidated |

---

## Finding Disposition

### False Positives (3)

| ID | Agent | Original Finding | Disposition |
|----|-------|-----------------|-------------|
| DOC-021 | Docs | Earlier wording suggested Neon as the DB | **INVALID** — Convex is the backend |
| OPS-FP1 | Ops | ".env.example has zero private key" | **INVALID** — placeholder by design |
| FE-C04 | Round 1 | Earlier wording suggested residual legacy DB references | **INVALID** — Convex is the DB |

### Already Resolved (Round 1)

These were fixed in the 10 commits from Round 1 and confirmed by Round 2 agents:

| Area | Resolution |
|------|-----------|
| Gas figures in voter-protocol core docs | Corrected to ~2.2M in TWO-TREE-SPEC, DistrictGate NatSpec, ARCHITECTURE.md |
| UltraPlonk naming in voter-protocol READMEs | Replaced with UltraHonk in README.md, contracts/README.md |
| H3→H4 leaf formula in code | `computeUserLeaf()` uses hash4 everywhere |
| @voter-protocol/client removal | Package deleted, CI refs removed |
| NEAR references in SECURITY.md | Entire NEAR section deleted |
| Phantom contract source in smart-contracts.md | Rewritten to document actual 10-contract system |
| Fly.io refs in communique README/config | Updated to Cloudflare Pages |
| ReentrancyGuard on DistrictGate | Added to all 3 proof functions, 522 tests pass |
| SECURITY.md false audit claims | Smart Contract Security section removed |

### Confirmed Positive (No Action Required)

Round 2 agents verified these are correct:

| Area | Verification |
|------|-------------|
| Public input indices 0-28 (two-tree) | MATCH across circuit, contract, prover, spec |
| Public input indices 29-30 (three-tree) | MATCH across all layers |
| User leaf = H4(secret, cellId, salt, authorityLevel) | MATCH |
| Nullifier = H2(identityCommitment, actionDomain) | MATCH |
| Domain tags (HASH2, HASH3, HASH4, SPONGE_24) | MATCH across Noir, TypeScript, specs |
| Sponge construction (ADD mode, rate=3) | MATCH |
| Engagement leaf = H2(IC, H3(tier, count, diversity)) | MATCH |
| Composite score formula + tier boundaries | MATCH |
| THREE_TREE_PUBLIC_INPUT_COUNT = 31 | MATCH |
| MAX_DISTRICT_SLOTS = 24 | MATCH |
| Genesis governance model | MATCH |
| formatInputs() camelCase→snake_case | MATCH |
| EngagementRootRegistry lifecycle (7-day sunset) | MATCH |
| Cross-action nullifier unlinkability | CONFIRMED (Poseidon2 preimage security) |
| No IP logging in Shadow Atlas API | CONFIRMED |
| self.xyz doesn't learn wallet address | CONFIRMED |
| Nullifier reversal computationally infeasible | CONFIRMED |
| Contract addresses in communique .env.example | MATCH Scroll Sepolia v4 |
| bb.js 2.1.8 pinned across all packages | MATCH |

---

## Open Findings

### CRITICAL (3)

**SPC-001 | Spec Fidelity | Single-district vs all-24 proof model contradiction**
DISTRICT-TAXONOMY.md claims "circuit outputs a single districtRoot and districtId, not all 24 slots." DistrictGate.sol NatSpec (L39-44) repeats this. Reality: `verifyTwoTreeProof` receives ALL 24 districts as public inputs. The claim is only correct for the legacy `verifyAndAuthorizeWithSignature` path.
*Fix: Update DISTRICT-TAXONOMY.md and DistrictGate NatSpec to clarify per-function behavior.*

**TST-008 | Test Coverage | MinAuthority governance system entirely untested**
`setActionDomainMinAuthority()`, `executeMinAuthorityIncrease()`, `cancelMinAuthorityIncrease()` — a complete governance subsystem with timelock for increases, immediate decreases, and `InsufficientAuthority` revert in all 3 proof paths. Zero tests exist. Zero references in any test file.
*Fix: Write 7+ test suite covering all paths.*

**OPS-001 | Deploy/Ops | CI doesn't verify via_ir = true**
DistrictGate requires `via_ir = true` (stack depth). CI workflow runs `forge build` but doesn't assert the foundry.toml setting. A config regression would produce silent compilation failure or incorrect bytecode.
*Fix: Add `via_ir` assertion to CI, or validate build output.*

### HIGH (20)

#### Documentation — communique/docs/architecture.md (8 findings, 1 file)

| ID | Line(s) | Finding | Fix |
|----|---------|---------|-----|
| DOC-001 | 153 (README) | Gas "~60-100k" → actual ~2.2M | Update to ~2.2M |
| DOC-002 | 69 | "300-500k gas" | Update to ~2.2M |
| DOC-003 | 417 | "300-500k gas" in ASCII diagram | Update to ~2.2M |
| DOC-004 | 584 | "300-500k gas" in cost breakdown | Update to ~2.2M |
| DOC-007 | 74 | "IdentityRegistry, ReputationRegistry" don't exist | Replace with actual contracts |
| DOC-008 | 415-416 | Same phantom contracts in ASCII diagram | Replace with actual contracts |
| DOC-022 | proof-gen-ux.md | ZK proofs framed as "Phase 2" future | Add SUPERSEDED banner |

#### Documentation — voter-protocol DEVELOPER-GUIDE.md (5 findings)

| ID | Line(s) | Finding | Fix |
|----|---------|---------|-----|
| DOC-006 | 123-127 | Lists VOTERReputation.sol (doesn't exist) | Add SUPERSEDED banner |
| DOC-010 | 105,112 | Lists packages/sdk/ (never existed) | Add SUPERSEDED banner |
| DOC-011 | 298,519,617 | `bb write_solidity_verifier` (security-relevant: wrong tool) | Add SUPERSEDED banner |
| DOC-012 | 378 | `@voter-protocol/sdk` import (doesn't exist) | Add SUPERSEDED banner |

#### Documentation — communique specs (1 finding)

| ID | Location | Finding | Fix |
|----|----------|---------|-----|
| DOC-005 | zk-proof-integration.md:848 | Gas "300-500k" | Update to ~2.2M |

#### Spec Fidelity (2 findings)

| ID | Location | Finding | Fix |
|----|----------|---------|-----|
| SPC-002 | TWO-TREE-SPEC S4.1 | DOMAIN_HASH4 = 0x48344d missing from pseudocode | Add to constants block |
| SPC-003 | TWO-TREE-SPEC S4.1 | `identity_commitment != 0` check missing from pseudocode | Add to pre-checks |

#### Privacy (3 findings — documentation, not code changes)

| ID | Category | Finding | Fix |
|----|----------|---------|-----|
| PRV-001 | Anonymity Set | Formula ignores user_root cohort + 24-district fingerprint | Update SECURITY.md formula |
| PRV-002 | Info Leakage | 24-district fingerprint = census-tract-level (~4K people) | Add explicit warning |
| PRV-003 | Info Leakage | `signer` in events links wallet to all actions | Document as known limitation + Phase 2 relayer plan |

#### Operations (2 findings)

| ID | Finding | Fix |
|----|---------|-----|
| OPS-FLY | fly-deploy.yml still active in communique | Delete file |
| OPS-MAINNET | Mainnet deploy checklist stale (old contracts, test action domain) | Update or mark stale |

#### Test Coverage (3 findings)

| ID | Component | Finding | Fix |
|----|-----------|---------|-----|
| TST-002 | DistrictGate | No cross-function EIP-712 signature replay test | Write 2 tests |
| TST-003 | All contracts | Zero Foundry invariant tests | Write 4 priority invariants |
| TST-012 | noir-prover | Keccak proof mode (on-chain path) untested in TS | Write keccak mode tests |

### MEDIUM (25)

#### Contract Security (3)

| ID | Finding | Fix |
|----|---------|-----|
| SCA-002 | TimelockGovernance: governance transfer overwrites pending — no anti-reset | Add pending transfer check |
| SCA-003 | DistrictRegistry: same overwrite pattern | Same fix |
| SCA-004 | Single-tree verifier: missing result.length==0 check | Add empty result guard |

#### Documentation (9)

| ID | Finding | Fix |
|----|---------|-----|
| DOC-009 | communique architecture.md deployment checklist: phantom contracts | Update |
| DOC-013 | DEVELOPER-GUIDE compiler version 0.8.20 → 0.8.28 | SUPERSEDED banner covers |
| DOC-017 | TWO-TREE-SPEC "Key Innovation" box: H(3 inputs) → H4(4 inputs) | Update intro box |
| DOC-020 | zk-proof-integration.md proof size "4.6KB" → ~7.3KB | Update |
| DOC-024 | ZK-PROOF-TESTING-STRATEGY.md: Halo2/Axiom → Noir/Barretenberg | Update |
| DOC-025 | DEVELOPER-GUIDE broken links to nonexistent files | SUPERSEDED banner covers |
| DOC-028 | TWO-TREE-SPEC S11: packages/client → noir-prover path | Update |
| SPC-017 | DistrictGate NatSpec slots 20-21 "reserved" → Township/Voting Precinct | Update NatSpec |
| SPC-021 | REPUTATION-SPEC: inherited identity_commitment zero check omission | Fix with SPC-003 |

#### Privacy (7)

| ID | Finding | Fix |
|----|---------|-----|
| PRV-004 | engagement_tier in events narrows anonymity set | Document in SECURITY.md |
| PRV-005 | Shadow Atlas sees cell_id + identityCommitment linkage | Document operator trust model |
| PRV-008 | IPFS insertion log reveals registration timestamps | Document in SECURITY.md |
| PRV-010 | OAuth email→wallet linkage in communique DB | Document as known Phase 1 limitation |
| PRV-014 | Engagement registration links signerAddress↔identityCommitment | Document; consider hash replacement |
| PRV-016 | Communique DB stores full identity chain | Document data-at-rest inventory |
| PRV-017 | Small district threshold (100) based on wrong anonymity model | Update threshold analysis |

#### Spec Fidelity (3)

| ID | Finding | Fix |
|----|---------|-----|
| SPC-011 | Constraint estimates differ between specs (500 vs 400/permutation) | Reconcile |
| SPC-012 | H3 "legacy" label in two-tree circuit misleading | Remove "legacy" comment |
| SPC-023 | TWO-TREE-SPEC "PROPOSED" label → should be "CURRENT" | Update |

#### Test Coverage (3)

| ID | Finding | Fix |
|----|---------|-----|
| TST-001 | No reentrancy attack test for ReentrancyGuard | Write mock + tests |
| TST-014 | Chain scanner: no RPC failure / malformed log tests | Add edge cases |
| TST-015 | Engagement score: no boundary precision / NaN tests | Add boundary tests |

### LOW (15)

| ID | Finding | Disposition |
|----|---------|-------------|
| CPA-002 | Missing computeUserLeaf/computeNullifier convenience wrappers | Backlog |
| CPA-007 | authorityLevel=bytes32 vs engagementTier=uint8 event typing | Backlog |
| API-002 | noir_js caret version prefix | Backlog |
| API-003 | Missing three-tree circuit exports from noir-prover index | Backlog |
| SPC-022 | MIN_ENGAGEMENT_TIER check omitted from spec pseudocode | Backlog |
| SPC-024 | DISTRICT-MEMBERSHIP-CIRCUIT-SPEC still active (has SUPERSEDED banner) | Acceptable |
| DOC-014 | ZK-PRODUCTION-ARCHITECTURE.md stale versions (has SUPERSEDED banner) | Acceptable |
| DOC-026 | Architecture README index missing smart-contracts.md link | Backlog |
| PRV-007 | Rate limit 60s cooldown per-nullifier timing leak | Minimal risk — document |
| PRV-013 | user_root cohort size depends on batching strategy | Document batching recommendation |
| PRV-015 | Timing correlation Shadow Atlas → chain | Minimal risk — document |
| TST-004 | No gas regression assertions | Backlog |
| TST-005 | Fuzz tests adequate (25 exist) but could add authority/tier fuzz | Backlog |
| OPS-DEPLOY | deployed-verifiers.json not gitignored | Backlog |
| API-001 | Health check URL /health vs /v1/health | Backlog |

### INFO (15+)

Positive confirmations and minor notes. No action required. See agent reports for full detail.

---

## Resolution Strategy

### Batch 1: Security-Critical Code (voter-protocol)
Write MinAuthority test suite (TST-008), cross-function EIP-712 replay tests (TST-002), fix SPC-001 NatSpec contradiction. Hardest to parallelize — tests depend on contract understanding.

### Batch 2: Spec Accuracy (voter-protocol docs)
SPC-002 (DOMAIN_HASH4), SPC-003 (identity_commitment != 0), SPC-017 (slot descriptions), SPC-023 (PROPOSED→CURRENT), DOC-017 (Key Innovation box), DOC-028 (client→noir-prover paths). All spec file edits — parallelizable.

### Batch 3: communique/docs/architecture.md Overhaul
DOC-002→004 (gas), DOC-007→009 (contract names). Single file, high-impact.

### Batch 4: DEVELOPER-GUIDE.md + Dead Code
Add SUPERSEDED banner to DEVELOPER-GUIDE.md (covers DOC-006, DOC-010→013, DOC-025). Delete fly-deploy.yml.

### Batch 5: communique Specs + Testing Strategy
DOC-001 (README gas), DOC-005/020 (zk-proof-integration.md), DOC-022 (proof-gen-ux.md SUPERSEDED), DOC-024 (testing strategy Halo2→Noir).

### Batch 6: Privacy Documentation (SECURITY.md)
PRV-001→003 (anonymity set + signer linkability), PRV-004/005/008/010/014/016/017 (operator trust, data-at-rest).

### Batch 7: Test Hardening (voter-protocol)
TST-003 (invariant tests), TST-012 (keccak mode), TST-001 (reentrancy), TST-014/015 (edge cases).

### Batch 8: Operations
OPS-001 (via_ir CI check), mainnet deploy cleanup, gitignore additions.
