# Contract Stack Hardening Tracker
> Brutalist MCP review 2026-03-15. 6 AI critics across 4 verticals (security, architecture, codebase, upgradeability debate).
> Scope: All 11 Solidity contracts (TimelockGovernance, DistrictGate, DebateMarket, NullifierRegistry, VerifierRegistry, DistrictRegistry, CampaignRegistry, UserRootRegistry, CellMapRegistry, EngagementRootRegistry, AIEvaluationRegistry).

## Legend
- **Status**: `OPEN` | `IN_PROGRESS` | `DONE` | `WONTFIX`
- **Wave**: Implementation wave (1=security-critical, 2=high, 3=medium, 4=low/maintenance)
- **Consensus**: Number of critics (out of 6) that independently identified the finding

---

## Wave 1 — Security Critical

| ID | Severity | Finding | File(s) | Consensus | Status |
|----|----------|---------|---------|-----------|--------|
| SC-1 | HIGH | AI model `registerModel()`/`removeModel()` have no timelock — compromised governance can instantly swap the 5-model panel, submit rigged scores, and resolve debates in one block | `AIEvaluationRegistry.sol:99-138` | 6/6 | DONE (Cycle 1) |
| SC-2 | HIGH | LMSR SELL underflow DoS — `revealTrade()` subtracts `weightedAmount` from `lmsrArgumentWeights` with no guard that accumulated BUY weight is sufficient. Solidity 0.8.28 reverts on underflow, bricking the epoch | `DebateMarket.sol:1074-1080` | 3/6 | DONE (Cycle 1) |
| SC-3 | MEDIUM | `updatePositionRoot()` has no timelock — governance can set any position root at any time. Currently Phase 2 attestation-only (no fund flow), but Phase 4 adds token settlement | `DebateMarket.sol:1186-1194` | 4/6 | DONE (Cycle 3) |
| SC-4 | MEDIUM | Root registration (`registerUserRoot`, `registerCellMapRoot`, `registerEngagementRoot`, `registerDistrict`) is instant `onlyGovernance` with no timelock — compromised governance can inject roots they control all leaves for | `UserRootRegistry.sol:117`, `CellMapRegistry.sol:121`, `EngagementRootRegistry.sol:118`, `DistrictRegistry.sol:177` | 5/6 | DONE (Cycle 2) |

**SC-1 attack scenario**: Attacker compromises Safe → calls `removeModel()` x5 + `registerModel()` x3 with attacker keys → calls `submitAIEvaluation()` with rigged scores → calls `resolveDebateWithAI()` → collects staking profits. Total time: 1 block.

**SC-1 fix (Cycle 1)**: Two-phase `initiateModelRegistration`/`executeModelRegistration` + `initiateModelRemoval`/`executeModelRemoval` with `MODEL_TIMELOCK` immutable (min 10 min). Execute is permissionless after timelock. Removal re-validates minimums at both initiation and execution time. Cancel functions governance-only. 41 new tests.

**SC-2 fix (Cycle 1)**: Two underflow guards before SELL subtraction: `if (weightedAmount > lmsrArgumentWeights[debateId][argumentIndex]) revert InsufficientSellWeight()` + same for `lmsrTotalWeight`. 3 new tests.

**SC-2 mitigation note**: LMSR trades are "pure signal" with no token flow in Phase 2 — the DoS bricks the epoch's LMSR price updates but doesn't steal funds. Still a griefing vector.

**SC-4 mitigation note**: Injecting a root is necessary but not sufficient for exploitation. The attacker also needs valid HonkVerifier proofs for that root, which requires knowing all leaf preimages (user_secret, cell_id, registration_salt, authority_level). This significantly raises attack complexity beyond simple key compromise.

---

## Wave 2 — Architectural (High)

| ID | Severity | Finding | File(s) | Consensus | Status |
|----|----------|---------|---------|-----------|--------|
| SA-1 | HIGH | DistrictRegistry does NOT inherit TimelockGovernance — reimplements governance transfer independently. Line 307 uses `ZeroAddress` error for self-transfer (should be `SameAddress`). Missing `getGovernanceTransferDelay()` view function. Creates tooling drift | `DistrictRegistry.sol:48,73-84,297-343` | 6/6 | DONE (Cycle 2) |
| SA-2 | HIGH | DebateMarket god-contract at 24,356 bytes (220 margin under EIP-170). Hardcoded 10-minute governance timelock due to EIP-170 constraint. LMSR library extraction required for mainnet | `DebateMarket.sol` (2,051 lines) | 6/6 | DONE (Cycle 3) |
| SA-3 | HIGH | DebateMarket immutable ZK verifier references (`debateWeightVerifier`, `positionNoteVerifier`) — circuit upgrades require full DebateMarket redeployment + 30-day fund stranding for active debates. Should be behind a registry pattern | `DebateMarket.sol:148-153` | 4/6 | DONE (Cycle 3) |
| SA-4 | MEDIUM | Root lifecycle code duplication — `PendingRootOperation` struct and 7 lifecycle functions (initiate/execute deactivation, expiry, reactivation + cancel) copy-pasted across 4 registries (28 near-identical functions, ~400 lines). Drift already proven by SA-1 | `UserRootRegistry.sol`, `CellMapRegistry.sol`, `EngagementRootRegistry.sol`, `DistrictRegistry.sol` | 5/6 | DONE (Cycle 2) |

**SA-2 note**: DebateMarket now at 24,553 bytes (23 margin) after Cycle 1 fixes. LMSR library extraction is MANDATORY before any further DebateMarket changes (SC-3, SA-3, SL-7).

**SA-2 decomposition plan**: Extract `_capRatio()`, `sqrt()`, `tierMultiplier()`, `getPrice()`, `getPrices()` and LMSR epoch math into a Solidity `library` with `internal` functions (inlined by compiler, zero deploy overhead). This reclaims ~2-4KB of bytecode headroom and allows parameterizing the governance timelock.

**SA-3 fix**: Create a `DebateVerifierRegistry` mapping or make the verifier references governance-mutable with timelock (like DistrictGate's mutable registry references).

**SA-4 fix**: Extract `AbstractRootLifecycle` base contract parameterized by grace period. Trade-off: adds inheritance depth in stack-constrained system.

---

## Wave 3 — Medium

| ID | Severity | Finding | File(s) | Consensus | Status |
|----|----------|---------|---------|-----------|--------|
| SM-1 | MEDIUM | AI score dimension validation — packed `uint16` scores (max 65535) not validated to be <= 10000 basis points. Malformed scores from compromised model signers could produce unexpected resolution outcomes | `DebateMarket.sol:2004-2012` | 2/6 | DONE (Cycle 1) |
| SM-2 | MEDIUM | `executeEpoch()` unbounded loop — no limit on `numReveals` per epoch. A busy epoch with many reveals could exceed block gas limit | `DebateMarket.sol` (executeEpoch) | 2/6 | DONE (Cycle 3) |
| SM-3 | MEDIUM | `revokeActionDomain()` is immediate with no timelock — can strand active debate stakes for 30 days (until emergency withdrawal window opens) | `DistrictGate.sol:691-694` | 2/6 | DONE (Cycle 2) |
| SM-4 | MEDIUM | Engagement root cherry-picking — old roots with `expiresAt == 0` remain valid indefinitely. Users can prove stale higher engagement tiers using old roots even if current data shows lower tier | `EngagementRootRegistry.sol` + `DistrictGate.sol` | 2/6 | DONE (Cycle 2) |
| SM-5 | MEDIUM | Pragma version inconsistency — DebateMarket pins `0.8.28`, all other contracts float `>=0.8.19`. All should pin to `0.8.28` for production consistency | All `.sol` files except `DebateMarket.sol` | 2/6 | DONE (Cycle 1) |
| SM-6 | MEDIUM | Low-level verifier call inconsistency — legacy single-tree path (line 547) missing `result.length == 0` check that two-tree and three-tree paths have. EOA verifier would produce generic panic instead of clean error | `DistrictGate.sol:547` vs `:1076` vs `:1231` | 1/6 | DONE (Cycle 2) |
| SM-7 | MEDIUM | `providerCount()` iterates 256 slots — called from state-changing `removeModel()` function. ~512K gas on L1 for the loop alone. Should track count in a state variable | `AIEvaluationRegistry.sol:178-188` | 4/6 | DONE (Cycle 1) |

**SM-2 mitigation note**: Epoch commit/reveal pattern means reveals are bounded by commits within a 5-minute window. Realistic DoS requires many identities committing rapidly. A max-reveals-per-epoch cap would be prudent.

**SM-4 mitigation note**: Protocol invariant is "no metric decay" — this is intentional design, not a bug. Users can always prove their historical peak tier. The question is whether this is the desired behavior for debate weighting. If not, engagement roots should have mandatory expiry.

---

## Wave 4 — Low / Maintenance

| ID | Severity | Finding | File(s) | Consensus | Status |
|----|----------|---------|---------|-----------|--------|
| SL-1 | LOW | `require()` strings vs custom errors inconsistency — ~5 instances of string-based `require()` coexist with custom errors in the same contracts. ~200 gas difference per call | `DistrictGate.sol:518,1050,1193`, `VerifierRegistry.sol:187,239`, `DistrictRegistry.sol:215` | 2/6 | DONE (Cycle 1) |
| SL-2 | LOW | `SCREAMING_CASE` naming for `immutable` variables — Solidity convention reserves SCREAMING_CASE for `constant`. All parameterized timelocks (`GOVERNANCE_TIMELOCK`, `VERIFIER_TIMELOCK`, etc.) are `immutable` but named as constants | All contracts with parameterized timelocks | 1/6 | WONTFIX |
| SL-3 | LOW | `MAX_DISTRICT_SLOTS` constant defined identically (= 24) in 3 contracts — should be in shared constants file | `DistrictRegistry.sol:53`, `VerifierRegistry.sol:57`, `DistrictGate.sol:74` | 1/6 | DONE (Cycle 1) |
| SL-4 | LOW | `GuardianShield.sol` is dead code — 108 lines, fully abstract, never inherited. Phase 2+ only | `GuardianShield.sol` | 1/6 | WONTFIX |
| SL-5 | LOW | Deprecated two-tree and legacy single-tree verification paths still deployed in DistrictGate — consume bytecode but marked DEPRECATED | `DistrictGate.sol:461-574,982-1103` | 1/6 | DONE (Cycle 3) |
| SL-6 | LOW | No event on `escalateToGovernance()` — status changes to AWAITING_GOVERNANCE but no event emitted for off-chain indexers | `DebateMarket.sol:1377` | 1/6 | DONE (Cycle 1) |
| SL-7 | LOW | `Debate` struct packing — 21 storage slots, could pack to ~16 by grouping small types (Stance + DebateStatus + bools + uint8 + address). Trade-off: packing code may increase bytecode (EIP-170 pressure) | `DebateMarket.sol:90-114` | 1/6 | WONTFIX |
| SL-8 | LOW | EIP-712 domain separator computed at deploy time — stale if chain hard-forks to different chainId. Standard practice but worth noting | `DistrictGate.sol:348-356`, `DebateMarket.sol:551-559` | 1/6 | WONTFIX |
| SL-9 | LOW | Campaign `participantCount` inflatable — `recordParticipation()` increments unconditionally per DistrictGate verification without nullifier-based dedup at campaign level. Multiple actions in same campaign from same user inflate count | `CampaignRegistry.sol:314-338` | 2/6 | DONE (Cycle 3) |

**SL-2 rationale for WONTFIX**: The SCREAMING_CASE naming for immutables is a deliberate project-wide convention. Changing would be a mass rename across all contracts, tests, and deploy scripts. The behavioral distinction (immutable vs constant) is documented in NatSpec.

**SL-4 rationale for WONTFIX**: GuardianShield is Phase 2+ infrastructure. Keeping the abstract contract in the repo is intentional — it documents the upgrade path. It's not deployed (no contract inherits it).

---

## Findings Evaluated as NOISE (Not Tracked)

These were flagged by Brutalist critics but assessed as invalid, overblown, or intended behavior:

| Finding | Critic Assessment | Our Assessment | Reason |
|---------|-------------------|----------------|--------|
| Tie-breaking favors index 0 | HIGH | INFO | Standard behavior. Weighted score ties are astronomically rare with sqrt(stake) * 2^tier. |
| Emergency withdrawal/settlement interaction | HIGH | LOW | Temporally disjoint — emergency withdrawal opens 30 days after deadline, settlement happens at resolution. |
| Debate creation front-running | MEDIUM | LOW | Requires ZK proof + 1 USDC bond. Attacker gets stuck with their own debate. Legitimate proposer uses different hash. |
| Relayer dependency silences users | MEDIUM | N/A | Wrong. EIP-712 enables relayer convenience, not relayer dependency. Users can self-submit. |
| NullifierRegistry governance transfer removes old callers | HIGH | INFO | Intended behavior, explicitly documented. Old governance should lose caller status on transfer. |
| 1-of-1 Safe provides no additional security | HIGH | INFO | Correct observation but acknowledged in threat model docs (lines 8-11 of TimelockGovernance). Safe enables future threshold upgrade without contract redeployment. |

---

## Test Coverage Gaps (From Review)

Existing coverage gaps (from `memory/audit-findings.md`) plus new gaps identified by Brutalist review:

- Emergency withdraw timeout boundary (30-day delay edge case) — **PRE-EXISTING**
- Protocol fee sweep on high-liquidity debates (gas DOS scenario) — **PRE-EXISTING**
- Appeal bond sweep for unbounded appealer sets (gas cost escalation) — **PRE-EXISTING**
- LMSR SELL underflow scenario (SC-2) — ~~NEW~~ **COVERED (Cycle 1, 3 tests)**
- AI model panel swap + immediate resolution exploit path (SC-1) — ~~NEW~~ **COVERED (Cycle 1, 41 tests)**
- AI score submission with out-of-range dimensions → bricked resolution (NEW-L-1) — **NEW (from Cycle 1 review)**
- `executeEpoch` with maximum reveals per epoch (SM-2) — **NEW**
- Action domain revocation with active debates (SM-3) — **NEW**

---

## Relationship to Existing Audits

- **Pre-mainnet audit (2026-03-10)**: See `memory/audit-findings.md`. All P0 blockers FIXED (B-1 in V9, B-2 governance transfer, B-3 KMS signer). All P1s FIXED. All P2s FIXED. This tracker covers NEW findings from the 2026-03-15 Brutalist contract review.
- **Shadow Atlas hardening (2026-03-14)**: See `packages/shadow-atlas/HARDENING-TRACKER.md`. 16 findings, ALL RESOLVED. Separate scope (TypeScript hydration pipeline, not Solidity contracts).

---

## Cycle 1 — Completed (2026-03-15)

**Scope**: SC-1, SC-2, SM-1, SM-5, SM-7, SL-1, SL-3, SL-6 (8 findings)
**Result**: 954/954 tests pass. DebateMarket: 24,553 bytes (23 margin). All 8 findings DONE.
**New tests**: 47 (41 AIEvaluationRegistry + 6 DebateMarket)
**Review**: APPROVED. 2 new LOW findings discovered (NEW-L-1, NEW-L-2).

| Finding | Fix Summary |
|---------|-------------|
| SC-1 | Two-phase `initiate/execute` model registration/removal with `MODEL_TIMELOCK` immutable |
| SC-2 | Underflow guards on LMSR SELL path (`InsufficientSellWeight` revert) |
| SM-1 | 5-dimension validation (each <= 10000) in `_computeWeightedAIScore` |
| SM-5 | 13 files pinned from `>=0.8.19` to `0.8.28` |
| SM-7 | `_providerCount` state variable (O(1) instead of 256-slot iteration) |
| SL-1 | 7 `require()` strings → custom errors (3 DistrictGate + 2 VerifierRegistry + 1 DistrictRegistry + 1 bonus) |
| SL-3 | `Constants.sol` file-level constant + import in 3 contracts |
| SL-6 | `DebateEscalated` event emitted in `escalateToGovernance()` |

**New findings from Cycle 1 review**:
- **NEW-L-1 (LOW)**: SM-1 validation fires at resolution, not submission. Out-of-range packed scores accepted by `submitAIEvaluation`, only caught at `resolveDebateWithAI`. Requires compromised model signers.
- **NEW-L-2 (LOW)**: SL-3 `Constants.sol` created and imported but hardcoded `24` usage sites not yet substituted. Maintenance only.
- **Bonus**: 5 additional `require()` strings found in `DistrictGate.sol` (lines 702, 703, 723, 724, 738) — not in scope, tracked for future pass.

---

## Cycle 2 — Completed (2026-03-15)

**Scope**: SA-1, SC-4, SA-4, SM-3, SM-4, SM-6 (6 findings)
**Result**: 988/988 tests pass. All 6 findings DONE. New contract: `AbstractRootLifecycle.sol`.
**New tests**: 34 (from 954 baseline → 988). 23 SC-4 registration timelock + 11 SM-3/SM-6 DistrictGate.
**Review**: APPROVED. No new findings discovered.

| Finding | Fix Summary |
|---------|-------------|
| SA-1 | DistrictRegistry `is AbstractRootLifecycle` (inherits TimelockGovernance). ~170 lines removed. `SameAddress` bug fixed. `getGovernanceTransferDelay()` gained. |
| SA-4 | `AbstractRootLifecycle.sol` abstract contract: `PendingRootOperation` struct + 7 lifecycle functions + 4 virtual hooks. All 4 registries refactored to inherit. ~400 lines deduped. DistrictRegistry event drift (`RootDeactivationInitiated` → `RootOperationInitiated`) fixed. |
| SC-4 | Two-phase `initiate*/execute*` registration with `GOVERNANCE_TIMELOCK` in all 4 registries. Per-registry `PendingRegistration` structs. Race condition guard on execute. Batch initiate for DistrictRegistry. 13 test files updated. |
| SM-3 | Two-phase `initiateActionDomainRevocation`/`executeActionDomainRevocation`/`cancelActionDomainRevocation` with `GOVERNANCE_TIMELOCK`. Immediate `revokeActionDomain` removed. |
| SM-4 | `MAX_ENGAGEMENT_ROOT_LIFETIME = 180 days`. Auto-set at execute time — engagement roots always expire. |
| SM-6 | `result.length == 0` guard added to legacy single-tree verifier call. All 3 paths now consistent. |

**Bytecode sizes (after Cycle 2)**:
| Contract | Runtime (B) | Margin (B) |
|----------|-------------|------------|
| DistrictRegistry | 5,941 | 18,635 |
| UserRootRegistry | 5,409 | 19,167 |
| CellMapRegistry | 5,386 | 19,190 |
| EngagementRootRegistry | 4,741 | 19,835 |
| DistrictGate | 16,996 | 7,580 |
| DebateMarket | 24,553 | 23 |

---

## Cycle 3 — Completed (2026-03-15)

**Scope**: SA-2, SA-3, SC-3, SM-2, SL-5, SL-7, SL-9, NEW-L-1, NEW-L-2 (9 findings)
**Result**: 819/819 tests pass. DebateMarket: 24,561 bytes (15 margin). 8 findings DONE, 1 WONTFIX.
**New tests**: 13 (1 NEW-L-1 + 1 SM-2 + 4 SC-3 + 7 SA-3)
**New contract**: `LMSRMath.sol` (library, 7 public functions extracted from DebateMarket)

| Finding | Fix Summary |
|---------|-------------|
| SA-2 | `LMSRMath.sol` library extraction — 7 functions (`capRatio`, `sqrt`, `tierMultiplier`, `getPrice`, `getPrices`, `computeWeightedAIScore`, `computeFinalScore`). DebateMarket 24,553→22,935 bytes (1,618 reclaimed). |
| SA-3 | Slot-indexed `initiateVerifierUpdate(uint8 slot, address)`/`executeVerifierUpdate(slot)`/`cancelVerifierUpdate(slot)` with GOVERNANCE_TIMELOCK. Slot 0=debateWeight, Slot 1=positionNote. +787 bytes. |
| SC-3 | Two-phase `initiatePositionRootUpdate`/`executePositionRootUpdate`/`cancelPositionRootUpdate` with GOVERNANCE_TIMELOCK. +588 bytes. |
| SM-2 | `MAX_REVEALS_PER_EPOCH = 256` constant + `TooManyReveals()` revert in `executeEpoch`. +63 bytes. |
| SL-5 | Deprecated single-tree and two-tree verification paths removed from DistrictGate. |
| SL-7 | WONTFIX — only 15 bytes headroom after SA-3. Struct packing bytecode overhead exceeds savings. |
| SL-9 | Campaign `participantCount` nullifier-based dedup in CampaignRegistry. |
| NEW-L-1 | Score dimension validation (each <= 10000) added to `submitAIEvaluation` fast-fail. `InvalidAIScore()` error. +188 bytes. |
| NEW-L-2 | `MAX_DISTRICT_SLOTS` constant substituted at all usage sites. |

**SL-7 rationale for WONTFIX**: After SA-3, DebateMarket has only 15 bytes of EIP-170 headroom. Struct field reordering adds bitshift/mask bytecode that exceeds the storage slot savings. Pre-mainnet LMSR library deployment (SA-2 Phase 2: external library) is the path to reclaim headroom for SL-7 if needed.

**Bytecode progression (Cycle 3)**:
| Phase | Runtime (B) | Margin (B) |
|-------|-------------|------------|
| Baseline (post Cycle 2) | 24,553 | 23 |
| SA-2 (LMSRMath extraction) | 22,935 | 1,641 |
| + NEW-L-1 | 23,123 | 1,453 |
| + SM-2 | 23,186 | 1,390 |
| + SC-3 | 23,774 | 802 |
| + SA-3 | 24,561 | 15 |

**Worktree merge regression (Cycle 3)**: Cycle 3 Phase 1 worktree agents branched from HEAD, overwriting uncommitted Cycle 1/2 changes on 5 source files (4 registries + AIEvaluationRegistry) and pragma pins on 10+ files. All changes were reconstructed from test file expectations. Lesson: commit before launching worktree agents.
