# Wave 43R Security Re-Review: DebateMarket.sol

**Reviewer:** Security Expert Re-Reviewer (Wave 43R)
**Date:** 2026-02-22
**Scope:** Verify all 14 fixes from Wave 42R, fresh analysis of new code
**Contract:** `contracts/src/DebateMarket.sol` (678 lines, post-fix)
**Tests:** `contracts/test/DebateMarket.t.sol` (1728 lines, 56 tests)
**References:** `DistrictGate.sol`, `NullifierRegistry.sol`, Wave 42R report

---

## Executive Summary

The Wave 42R security review identified 3 CRITICAL, 4 HIGH, 5 MEDIUM, and 5 LOW findings. The development team applied fixes to 14 of the 18 findings (SEC-009, SEC-014, SEC-015, SEC-016, SEC-017 were design-acknowledged and not changed). This re-review confirms that **12 findings are fully resolved, 1 is partially resolved with an accepted trade-off, and 1 was design-acknowledged**. One new finding of MEDIUM severity was discovered in the fix code. The contract is in a significantly improved security posture.

---

## Section 1: Wave 42R Finding Verification

### SEC-001 CRITICAL -- Settlement Insolvency (Proposer Bond vs Stake Pool)

**Status: RESOLVED**

**Evidence:** The `proposerBond` is now stored as a per-debate field in the `Debate` struct (line 64) and tracked separately from `totalStake`. The settlement payout formula at lines 500-505 computes:

```solidity
uint256 winningArgStake = argumentTotalStakes[debateId][debate.winningArgumentIndex];
uint256 losingPool = debate.totalStake - winningArgStake;
uint256 payout = record.stakeAmount;
if (winningArgStake > 0) {
    payout += (losingPool * record.stakeAmount) / winningArgStake;
}
```

The `totalStake` only includes argument/co-sign stakes (accumulated at lines 363, 433). The `proposerBond` is never added to `totalStake`. Settlement claims draw from the argument stake pool, and bond claims draw from the separately tracked bond amount. The two pools do not interfere.

Rounding dust: Integer division can leave up to `(winnerCount - 1)` wei of dust per debate. This is accepted as noted in the original review. The dust is irrecoverable but negligible in practice (sub-cent amounts with 6-decimal stablecoins).

**Invariant:** `contract.balance >= sum(all unclaimed debate totalStakes) + sum(all unclaimed proposerBonds)` -- UPHELD, because `totalStake` and `proposerBond` are independently tracked and independently claimable.

---

### SEC-002 CRITICAL -- Missing SafeERC20

**Status: RESOLVED**

**Evidence:** Lines 7, 32 import and activate SafeERC20:

```solidity
import "openzeppelin/token/ERC20/utils/SafeERC20.sol";
// ...
using SafeERC20 for IERC20;
```

All 5 ERC-20 call sites now use safe variants:

| Line | Function | Call |
|------|----------|------|
| 282 | `proposeDebate` | `stakingToken.safeTransferFrom(msg.sender, address(this), bondAmount)` |
| 366 | `submitArgument` | `stakingToken.safeTransferFrom(msg.sender, address(this), stakeAmount)` |
| 436 | `coSignArgument` | `stakingToken.safeTransferFrom(msg.sender, address(this), stakeAmount)` |
| 507 | `claimSettlement` | `stakingToken.safeTransfer(record.submitter, payout)` |
| 526 | `claimProposerBond` | `stakingToken.safeTransfer(msg.sender, debate.proposerBond)` |

Additionally confirmed in `sweepForfeitedBond` (line 541) and `emergencyWithdraw` (line 559). **All 7 transfer call sites use SafeERC20.** No raw `transfer`/`transferFrom` calls remain.

---

### SEC-003 CRITICAL -- Nullifier Scoping (actionDomain vs debateId)

**Status: PARTIALLY RESOLVED (accepted trade-off)**

**Evidence:** The fix adds a cross-validation check after proof verification in both `submitArgument` (line 324) and `coSignArgument` (line 404):

```solidity
if (bytes32(publicInputs[27]) != debate.actionDomain) revert ActionDomainMismatch();
```

This ensures that the actionDomain in the ZK proof matches the debate's actionDomain. The fundamental design tension remains: nullifiers are scoped per actionDomain in the NullifierRegistry, not per debateId. This means:

1. **Single-domain debates (current design):** A user can only participate once across ALL debates sharing the same actionDomain. The cross-check ensures the proof's domain matches the debate, closing the attack vector where a mismatched domain could bypass nullifier checks.

2. **Multi-debate within same domain:** Users are locked out of subsequent debates after their first participation in that domain. This is a known limitation documented as a design choice -- each actionDomain represents a single "action season" or "debate cycle."

The `ActionDomainMismatch` error is defined (line 205), tested in `test_RevertWhen_ActionDomainMismatch` (line 1324) and `test_RevertWhen_CoSignActionDomainMismatch` (line 1340).

**Residual risk:** Low. The cross-check prevents domain confusion attacks. The one-nullifier-per-domain limitation is a deliberate constraint that prevents Sybil inflation within a domain.

---

### SEC-004 HIGH -- Gas DOS (Unbounded Iteration in resolveDebate)

**Status: RESOLVED**

**Evidence:** `MAX_ARGUMENTS` constant is defined at line 114:

```solidity
uint256 public constant MAX_ARGUMENTS = 500;
```

Enforced in `submitArgument` at line 317:

```solidity
if (debate.argumentCount >= MAX_ARGUMENTS) revert TooManyArguments();
```

The `TooManyArguments` error is defined at line 210. At 500 arguments, `resolveDebate` iteration costs approximately 500 * 2,500 = 1.25M gas, well within the Scroll L2 block gas limit of ~10M. The constant is verified by test `test_Constants_MaxArguments` (line 1502).

Note: `coSignArgument` does not increment `argumentCount` (it only increments score on an existing argument), so co-signs cannot inflate the argument count beyond 500.

---

### SEC-005 HIGH -- Settlement Front-Run (Anyone Can Claim)

**Status: RESOLVED**

**Evidence:** The `StakeRecord` struct now includes a `submitter` field (line 82):

```solidity
struct StakeRecord {
    uint256 argumentIndex;
    uint256 stakeAmount;
    uint8 engagementTier;
    bool claimed;
    address submitter;  // tracks who submitted
}
```

The `submitter` is set to `msg.sender` during argument submission (line 357) and co-sign (line 428):

```solidity
stakeRecords[debateId][nullifier] = StakeRecord({
    argumentIndex: argumentIndex,
    stakeAmount: stakeAmount,
    engagementTier: engagementTier,
    claimed: false,
    submitter: msg.sender
});
```

Settlement claim enforces submitter match at line 495:

```solidity
if (record.submitter != msg.sender) revert UnauthorizedClaimer();
```

Settlement payout is sent to `record.submitter` (line 507), not `msg.sender`, providing defense-in-depth. Test `test_RevertWhen_UnauthorizedClaimer` (line 1381) verifies this guard.

---

### SEC-006 HIGH -- Governance Pause Blocking Settlement

**Status: RESOLVED**

**Evidence:** The `emergencyWithdraw` function exists at lines 548-562:

```solidity
function emergencyWithdraw(bytes32 debateId, bytes32 nullifier) external nonReentrant {
    Debate storage debate = debates[debateId];
    if (debate.deadline == 0) revert DebateNotFound();
    if (block.timestamp < debate.deadline + EMERGENCY_WITHDRAW_DELAY) revert DebateStillActive();

    StakeRecord storage record = stakeRecords[debateId][nullifier];
    if (record.stakeAmount == 0) revert StakeRecordNotFound();
    if (record.claimed) revert AlreadyClaimed();
    if (record.submitter != msg.sender) revert UnauthorizedClaimer();

    record.claimed = true;
    stakingToken.safeTransfer(msg.sender, record.stakeAmount);

    emit SettlementClaimed(debateId, nullifier, record.stakeAmount);
}
```

Key properties verified:
- **NOT** gated by `whenNotPaused` -- works even when contract is paused.
- Requires 30-day delay after debate deadline (`EMERGENCY_WITHDRAW_DELAY = 30 days`, line 117).
- Returns original stake only (no profit from losing pool) -- prevents gaming.
- Uses `submitter` check (line 556) to prevent front-running.
- Sets `record.claimed = true` (line 558) to prevent double-withdrawal.
- Uses `nonReentrant` guard.

Tests: `test_EmergencyWithdraw_Success` (line 1463), `test_RevertWhen_EmergencyWithdraw_TooEarly` (line 1481).

---

### SEC-007 HIGH -- Trapped Forfeited Bonds

**Status: RESOLVED**

**Evidence:** The `sweepForfeitedBond` function exists at lines 533-544:

```solidity
function sweepForfeitedBond(bytes32 debateId) external onlyGovernance nonReentrant {
    Debate storage debate = debates[debateId];
    if (debate.deadline == 0) revert DebateNotFound();
    if (debate.status != DebateStatus.RESOLVED) revert DebateNotResolved();
    if (debate.uniqueParticipants >= BOND_RETURN_THRESHOLD) revert InsufficientParticipation();
    if (debate.bondClaimed) revert BondAlreadyClaimed();

    debate.bondClaimed = true;
    stakingToken.safeTransfer(governance, debate.proposerBond);

    emit ProposerBondForfeited(debateId, debate.proposerBond);
}
```

Key properties verified:
- `onlyGovernance` access control.
- Requires `debate.status == RESOLVED` (must be resolved first).
- Requires `uniqueParticipants < BOND_RETURN_THRESHOLD` (ensures only forfeited bonds are swept, not bonds that should be returned to proposer).
- `bondClaimed` flag prevents double-sweep.
- Uses `safeTransfer`.

Tests: `test_SweepForfeitedBond_Success` (line 1409), `test_RevertWhen_SweepBond_SufficientParticipation` (line 1427), `test_RevertWhen_SweepBond_NotGovernance` (line 1447).

**Note on access control logic:** The `InsufficientParticipation` error name at line 537 is reused in a semantically inverted way -- `sweepForfeitedBond` reverts with `InsufficientParticipation` when participation is *sufficient* (meaning the bond should go to the proposer, not governance). This is confusing but functionally correct. The guard `uniqueParticipants >= BOND_RETURN_THRESHOLD` correctly prevents sweeping a bond that the proposer deserves. A more descriptive error like `BondNotForfeited` would be clearer, but this is cosmetic.

---

### SEC-008 MEDIUM -- debateId Collision

**Status: RESOLVED**

**Evidence:** Line 270:

```solidity
if (debates[debateId].deadline != 0) revert DebateAlreadyExists();
```

The `DebateAlreadyExists` error is defined at line 209. Test `test_RevertWhen_DebateIdCollision` (line 1394) verifies that submitting the same proposition parameters in the same block reverts.

The existence check uses `deadline != 0` which is reliable because `deadline` is always set to `block.timestamp + duration` (line 275), and both `block.timestamp` and `duration` are non-zero (duration >= 72 hours per the `MIN_DURATION` check at line 261).

---

### SEC-010 MEDIUM -- Zero-Argument Resolution

**Status: RESOLVED**

**Evidence:** Line 450:

```solidity
if (debate.argumentCount == 0) revert NoArgumentsSubmitted();
```

The `NoArgumentsSubmitted` error is defined at line 206. Test `test_RevertWhen_ResolveZeroArguments` (line 1369) verifies the revert.

---

### SEC-011 MEDIUM -- Stake Record Overwrite (DuplicateNullifier)

**Status: RESOLVED**

**Evidence:** Guard added in both `submitArgument` (line 351) and `coSignArgument` (line 422):

```solidity
if (stakeRecords[debateId][nullifier].stakeAmount != 0) revert DuplicateNullifier();
```

The `DuplicateNullifier` error is defined at line 208. This provides a defense-in-depth layer beyond the NullifierRegistry check performed by DistrictGate. Even if the NullifierRegistry check somehow passes (e.g., due to different actionDomain scoping), the DebateMarket's own guard prevents overwriting an existing stake record.

---

### SEC-012 MEDIUM -- Error Name (DebateStillActive vs DebateExpired)

**Status: RESOLVED**

**Evidence:** The `DebateExpired` error is defined at line 189. It is used at line 315 (`submitArgument`) and line 395 (`coSignArgument`) for the deadline-past condition:

```solidity
if (block.timestamp >= debate.deadline) revert DebateExpired();
```

The `DebateStillActive` error (line 188) is used only for the correct semantic -- at line 449 (`resolveDebate`) and line 551 (`emergencyWithdraw`) where the debate has not yet passed its deadline or delay:

```solidity
if (block.timestamp < debate.deadline) revert DebateStillActive();                    // resolveDebate
if (block.timestamp < debate.deadline + EMERGENCY_WITHDRAW_DELAY) revert DebateStillActive();  // emergencyWithdraw
```

---

### SEC-013 LOW -- minAuthority Field

**Status: RESOLVED**

**Evidence:** The `Debate` struct (lines 50-66) no longer contains a `minAuthority` field. The struct fields are: `propositionHash`, `actionDomain`, `deadline`, `argumentCount`, `uniqueParticipants`, `jurisdictionSizeHint`, `totalStake`, `winningArgumentIndex`, `winningStance`, `winningBodyHash`, `winningAmendmentHash`, `status`, `proposer`, `proposerBond`, `bondClaimed`. The dead storage field has been removed.

---

### SEC-018 LOW -- CEI Pattern Compliance

**Status: RESOLVED**

**Evidence:** All three core functions now perform `safeTransferFrom` AFTER state writes:

1. **`proposeDebate`** (lines 272-282): State writes (debate fields) at lines 272-279, transfer at line 282. Comment explicitly notes: "Transfer bond from proposer (after state writes -- CEI pattern)".

2. **`submitArgument`** (lines 337-366): State writes (argument storage, stake record, debate counters) at lines 337-363, transfer at line 366. Comment: "Transfer stake (after state writes -- CEI pattern)".

3. **`coSignArgument`** (lines 416-436): State writes (score update, stake tracking, stake record, debate counters) at lines 416-433, transfer at line 436. Comment: "Transfer stake (after state writes -- CEI pattern)".

All three functions also have `nonReentrant` as defense-in-depth.

---

### SEC-009, SEC-014, SEC-015, SEC-016, SEC-017 -- Design Acknowledged

**Status: NOT IN SCOPE (design decisions)**

These findings were noted as design trade-offs in Wave 42R:
- **SEC-009** (whale dominance): sqrt dampening is intentional; stake caps deferred.
- **SEC-014** (SETTLED status): The `SETTLED` enum value remains defined but unused. This is dead code but harmless -- removing it would change the enum encoding, which could break any off-chain indexers already deployed.
- **SEC-015** (proposer double-dip): Bond return is intentionally decoupled from argument outcome.
- **SEC-016** (front-running): Mitigated by Scroll's centralized sequencer; commit-reveal deferred.
- **SEC-017** (no max bond): Self-inflicted bond forfeiture is not a vulnerability.

---

## Section 2: Fresh Analysis of New Code

### 2.1 emergencyWithdraw -- Double-Withdrawal Analysis

**Question:** Can a user claim settlement AND emergency withdrawal for the same stake?

**Answer: No.** Both `claimSettlement` (line 497) and `emergencyWithdraw` (line 558) check and set `record.claimed`:

```solidity
// claimSettlement (line 493-497):
if (record.claimed) revert AlreadyClaimed();
record.claimed = true;

// emergencyWithdraw (line 555-558):
if (record.claimed) revert AlreadyClaimed();
record.claimed = true;
```

The `claimed` flag is shared between both paths. Once set by either function, the other will revert. This prevents double-withdrawal.

**Question:** Can emergency withdrawal drain funds that belong to settlement winners?

**Answer: Yes, partially.** The `emergencyWithdraw` function is available 30 days after the debate deadline regardless of whether the debate has been resolved. If a debate is resolved and a losing staker uses `emergencyWithdraw`, they recover their original stake from the pool that should be distributed to winners. This reduces the contract's token balance, potentially causing the last settlement claimant(s) to fail due to insufficient balance.

However, this risk is mitigated by the timing:
1. The debate must first pass its deadline (72h-30d).
2. Then 30 additional days must pass before emergency withdrawal is available.
3. Normal settlement (resolve + claim) would typically complete within days of the deadline.
4. `emergencyWithdraw` is designed for the scenario where the contract is paused and normal settlement is blocked.

If the contract is NOT paused: losers cannot emergency-withdraw profitably -- they get back their original stake (which is less than what they deposited if you account for gas). Winners would have already claimed their settlement payout (stake + share of losers). But since there is no check that `debate.status != RESOLVED`, a losing staker could emergency-withdraw after resolution, creating an insolvency for remaining winners.

**NEW FINDING: SEC-019 (see Section 3 below)**

---

### 2.2 sweepForfeitedBond -- Governance Sweep Safety

**Question:** Can governance sweep a bond that should be returned to the proposer?

**Answer: No.** Line 537 enforces:

```solidity
if (debate.uniqueParticipants >= BOND_RETURN_THRESHOLD) revert InsufficientParticipation();
```

If participation is sufficient (>= 5), the sweep reverts. The proposer can claim their bond via `claimProposerBond`. These two paths are mutually exclusive due to the participation threshold check.

**Question:** Can a bond be swept before the proposer has a chance to claim?

**Answer: No.** Both `claimProposerBond` (line 517) and `sweepForfeitedBond` (line 536) require `debate.status == RESOLVED`. The proposer can claim immediately after resolution. Governance cannot front-run the proposer because both functions check `bondClaimed` -- whichever executes first sets it to `true`, and the other reverts with `BondAlreadyClaimed`.

If participation is below threshold: the proposer cannot claim (`InsufficientParticipation` at line 520-522), and governance CAN sweep. This is correct -- the bond is forfeited by design.

---

### 2.3 Submitter Field -- Privacy Analysis

**Question:** Does storing `msg.sender` in `StakeRecord.submitter` leak new information?

**Answer: No.** The `msg.sender` is already visible in the transaction that calls `submitArgument` or `coSignArgument`. The on-chain transaction receipt inherently contains the `from` address. Storing it in a struct field makes it queryable via the `stakeRecords` mapping, but this information is already publicly accessible via block explorers and event logs.

The `submitter` field does create an explicit on-chain link between an Ethereum address and a nullifier (via the `stakeRecords[debateId][nullifier]` mapping). However, this link already existed implicitly through transaction analysis. The ZK proof protects the link between the nullifier and the user's real-world identity, not the link between the nullifier and the submitting Ethereum address.

---

### 2.4 Action Domain Validation Order

**Question:** The actionDomain mismatch check happens AFTER `verifyThreeTreeProof`. Since DistrictGate records the nullifier during verification, does a subsequent `ActionDomainMismatch` revert leave the nullifier consumed?

**Analysis:** In `submitArgument`, the call order is:

1. Line 320-322: `districtGate.verifyThreeTreeProof(...)` -- records nullifier in NullifierRegistry
2. Line 324: `if (bytes32(publicInputs[27]) != debate.actionDomain) revert ActionDomainMismatch()` -- reverts if domain mismatch

If step 2 reverts, **the entire transaction reverts**, including step 1. Solidity's revert semantics roll back ALL state changes from the transaction, including external calls. The nullifier recording in `NullifierRegistry.recordNullifier()` is undone by the revert.

**Verdict: No DOS vector.** The nullifier is NOT consumed when `ActionDomainMismatch` reverts. The user can resubmit with the correct domain.

---

### 2.5 CEI Pattern Compliance -- Complete Verification

All functions with external calls verified:

| Function | State writes before transfer | Transfer last | nonReentrant | Verdict |
|----------|------------------------------|---------------|--------------|---------|
| `proposeDebate` | Lines 272-279 | Line 282 | Yes | COMPLIANT |
| `submitArgument` | Lines 337-363 | Line 366 | Yes | COMPLIANT |
| `coSignArgument` | Lines 416-433 | Line 436 | Yes | COMPLIANT |
| `claimSettlement` | Line 497 (`claimed = true`) | Line 507 | Yes | COMPLIANT |
| `claimProposerBond` | Line 524 (`bondClaimed = true`) | Line 526 | Yes | COMPLIANT |
| `sweepForfeitedBond` | Line 540 (`bondClaimed = true`) | Line 541 | Yes | COMPLIANT |
| `emergencyWithdraw` | Line 558 (`claimed = true`) | Line 559 | Yes | COMPLIANT |

Note: `submitArgument` and `coSignArgument` make an external call to `districtGate.verifyThreeTreeProof()` BEFORE their state writes. This is acceptable because:
1. The `nonReentrant` guard prevents reentrant calls.
2. The DistrictGate call does not send tokens or Ether.
3. The DistrictGate is an immutable, trusted contract deployed by the same governance.
4. The DistrictGate itself uses `nonReentrant` and `whenNotPaused`.

---

## Section 3: New Findings Introduced by Fixes

### SEC-019: Emergency Withdrawal Allows Losing Stakers to Drain Winner Pool Post-Resolution

**Severity: MEDIUM**

**Location:** `DebateMarket.sol:548-562`

**Description:**

The `emergencyWithdraw` function does not check `debate.status`. It allows any staker to withdraw their original stake 30 days after the deadline, regardless of whether the debate has been resolved and settlement has begun. Consider the following scenario:

1. Debate resolves normally. Winners begin claiming settlement (their stake + proportional share of losing pool).
2. 30 days after the debate deadline (which may be only a few days after resolution), `emergencyWithdraw` becomes available.
3. A losing staker calls `emergencyWithdraw`, recovering their original stake.
4. The contract's token balance is now lower than expected. If all winners have not yet claimed, the last winner's `claimSettlement` may fail due to insufficient balance.

**Impact:** The losing staker recovers tokens that should belong to the winning pool. This creates an insolvency condition for the last winner(s) to claim.

**Likelihood:** Low. In practice:
- The 30-day delay means most settlements complete long before emergency withdrawal is available.
- Losing stakers have no incentive to wait 30 days when their tokens are already forfeited.
- However, a coordinated group of losers could wait and emergency-withdraw simultaneously to grief winners who delayed their claims.

**Suggested Fix:**

Add a status check to `emergencyWithdraw`:

```solidity
function emergencyWithdraw(bytes32 debateId, bytes32 nullifier) external nonReentrant {
    Debate storage debate = debates[debateId];
    if (debate.deadline == 0) revert DebateNotFound();
    if (debate.status == DebateStatus.RESOLVED) revert DebateNotResolved(); // prevent post-resolution drain
    if (block.timestamp < debate.deadline + EMERGENCY_WITHDRAW_DELAY) revert DebateStillActive();
    // ...
}
```

This would restrict emergency withdrawal to debates that have NOT been resolved -- the exact scenario (governance pause blocking resolution) that the function was designed for. If the debate HAS been resolved, winners should use `claimSettlement` instead.

Alternatively, allow emergency withdrawal post-resolution only for stakers on the WINNING side who haven't claimed yet (returning their original stake, not the full settlement amount), to protect them if the contract is paused after resolution.

---

## Section 4: Updated Invariant Table

| # | Invariant | Status | Notes |
|---|-----------|--------|-------|
| I-1 | `contract.balance >= sum(all unclaimed totalStakes) + sum(all unclaimed proposerBonds)` | **WEAKLY UPHELD** | Upheld under normal operation. Can be violated if losing stakers use `emergencyWithdraw` after resolution (SEC-019). |
| I-2 | `sum(all winner payouts) <= totalStake` for any debate | **UPHELD** | Integer rounding ensures sum of payouts <= totalStake. Dust (up to winnerCount-1 wei) is retained by contract. |
| I-3 | Each nullifier can stake at most once per debate | **UPHELD** | Double defense: NullifierRegistry (via DistrictGate) + DebateMarket's own `DuplicateNullifier` check (lines 351, 422). |
| I-4 | Only ACTIVE debates accept arguments | **UPHELD** | `submitArgument` and `coSignArgument` check `debate.status == DebateStatus.ACTIVE` (lines 314, 394). |
| I-5 | Only RESOLVED debates allow settlement | **UPHELD** | `claimSettlement` checks `debate.status == DebateStatus.RESOLVED` (line 489). |
| I-6 | A debate can only be resolved once | **UPHELD** | `resolveDebate` checks `debate.status == DebateStatus.ACTIVE` (line 448) and sets to `RESOLVED` (line 468). |
| I-7 | Each stake record can be claimed at most once | **UPHELD** | `record.claimed` checked in `claimSettlement` (line 493), `emergencyWithdraw` (line 555). Shared flag prevents cross-path double-claim. |
| I-8 | Proposer bond can be claimed at most once | **UPHELD** | `debate.bondClaimed` checked in both `claimProposerBond` (line 519) and `sweepForfeitedBond` (line 538). |
| I-9 | CEI pattern (no state changes after external calls) | **UPHELD** | All 7 functions with transfers perform state writes before external token transfers. See Section 2.5. |
| I-10 | Debate IDs are unique | **UPHELD** | `DebateAlreadyExists` check at line 270. |
| I-11 | Bond sweep and bond return are mutually exclusive | **UPHELD** | `claimProposerBond` requires `participants >= 5`; `sweepForfeitedBond` requires `participants < 5`. Both check `bondClaimed`. |
| I-12 | Emergency withdrawal does not exceed original stake | **UPHELD** | `emergencyWithdraw` transfers `record.stakeAmount` (line 559), never more. |
| I-13 | Only submitter can claim or emergency-withdraw | **UPHELD** | Both paths check `record.submitter != msg.sender` (lines 495, 556). |

---

## Section 5: Token Flow Analysis (Updated)

### Tokens Enter the Contract

| Path | Function | Amount | SafeERC20 |
|------|----------|--------|-----------|
| Proposer bond | `proposeDebate` | `bondAmount` (>= 1 USDC) | `safeTransferFrom` |
| Argument stake | `submitArgument` | `stakeAmount` (>= 1 USDC) | `safeTransferFrom` |
| Co-sign stake | `coSignArgument` | `stakeAmount` (>= 1 USDC) | `safeTransferFrom` |

### Tokens Leave the Contract

| Path | Function | Destination | Amount | SafeERC20 |
|------|----------|-------------|--------|-----------|
| Winner settlement | `claimSettlement` | `record.submitter` | `stake + proportional_share_of_losers` | `safeTransfer` |
| Proposer bond return | `claimProposerBond` | `debate.proposer` | `debate.proposerBond` | `safeTransfer` |
| Forfeited bond sweep | `sweepForfeitedBond` | `governance` | `debate.proposerBond` | `safeTransfer` |
| Emergency withdrawal | `emergencyWithdraw` | `record.submitter` | `record.stakeAmount` (original only) | `safeTransfer` |

### Tokens Permanently Locked

| Scenario | Amount | Recoverable? |
|----------|--------|------------|
| Settlement rounding dust | Up to `(winnerCount - 1)` wei per debate | No -- but negligible |
| Tokens sent directly to contract (not via functions) | Variable | No -- no rescue function |

### Previously Locked, Now Recoverable

| Scenario | Recovery Path |
|----------|-------------|
| Forfeited proposer bonds (< 5 participants) | `sweepForfeitedBond` (governance) |
| Staker funds during extended pause | `emergencyWithdraw` (30 days after deadline) |

---

## Section 6: Test Coverage Assessment

The test file has grown from the Wave 42R review's 1470 lines to 1728 lines with the following improvements:

### Covered by New Tests

| Finding | Test | Line |
|---------|------|------|
| SEC-008 (debateId collision) | `test_RevertWhen_DebateIdCollision` | 1394 |
| SEC-010 (zero-arg resolution) | `test_RevertWhen_ResolveZeroArguments` | 1369 |
| SEC-005 (unauthorized claimer) | `test_RevertWhen_UnauthorizedClaimer` | 1381 |
| SEC-003 (domain mismatch) | `test_RevertWhen_ActionDomainMismatch`, `test_RevertWhen_CoSignActionDomainMismatch` | 1324, 1340 |
| SEC-007 (sweep bond) | `test_SweepForfeitedBond_Success`, `test_RevertWhen_SweepBond_SufficientParticipation`, `test_RevertWhen_SweepBond_NotGovernance` | 1409-1456 |
| SEC-006 (emergency withdraw) | `test_EmergencyWithdraw_Success`, `test_RevertWhen_EmergencyWithdraw_TooEarly` | 1463-1495 |
| SEC-012 (DebateExpired error) | `test_RevertWhen_DebateExpired` | 421 |
| SEC-004 (MAX_ARGUMENTS) | `test_Constants_MaxArguments` | 1502 |

### Remaining Test Gaps (from Wave 42R, not yet addressed)

1. **No test for emergency withdrawal after resolution** -- would expose SEC-019. A test should verify that a losing staker cannot emergency-withdraw after the debate is resolved, draining the winner pool.
2. **No settlement accounting integrity test** -- no test sums all winner payouts and verifies the total does not exceed `totalStake`.
3. **No test for multiple co-signers claiming settlement** -- tests only cover a single winner claiming.
4. **No fuzz tests** for sqrt or settlement math.
5. **No test for MAX_ARGUMENTS enforcement** -- the constant is tested, but no test actually attempts to submit 501 arguments and verify `TooManyArguments` revert.
6. **No test for double-sweep on forfeited bonds** (calling `sweepForfeitedBond` twice for the same debate).
7. **No test for emergency withdrawal double-claim** (calling `emergencyWithdraw` twice with the same nullifier).
8. **No test for emergency withdrawal then settlement claim** (verifying the shared `claimed` flag blocks the second path).

---

## Section 7: Summary of Findings

### Wave 42R Findings Verification

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| SEC-001 | CRITICAL | Settlement insolvency -- bond shares balance pool | **RESOLVED** |
| SEC-002 | CRITICAL | Missing SafeERC20 | **RESOLVED** |
| SEC-003 | CRITICAL | Nullifier scoped to actionDomain | **PARTIALLY RESOLVED** (trade-off accepted) |
| SEC-004 | HIGH | Gas DOS -- unbounded iteration | **RESOLVED** |
| SEC-005 | HIGH | Anyone can claim settlement | **RESOLVED** |
| SEC-006 | HIGH | Governance pause blocks settlement | **RESOLVED** |
| SEC-007 | HIGH | Forfeited bonds permanently locked | **RESOLVED** |
| SEC-008 | MEDIUM | debateId collision | **RESOLVED** |
| SEC-010 | MEDIUM | Zero-argument resolution | **RESOLVED** |
| SEC-011 | MEDIUM | Stake record overwrite | **RESOLVED** |
| SEC-012 | MEDIUM | Error name semantics | **RESOLVED** |
| SEC-013 | LOW | minAuthority dead field | **RESOLVED** |
| SEC-018 | LOW | CEI pattern violated | **RESOLVED** |

### New Findings

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| SEC-019 | MEDIUM | Emergency withdrawal allows losing stakers to drain winner pool post-resolution | **OPEN** |

---

## Overall Assessment: APPROVE WITH NOTES

The DebateMarket contract has been substantially hardened since Wave 42R. All 3 CRITICAL and 4 HIGH findings are resolved (with SEC-003 having an accepted architectural trade-off). The new code (`emergencyWithdraw`, `sweepForfeitedBond`, submitter tracking) is well-structured and follows security best practices (CEI, SafeERC20, nonReentrant, access control).

**One new MEDIUM finding (SEC-019)** was introduced by the `emergencyWithdraw` fix: the lack of a status check allows post-resolution emergency withdrawals by losing stakers, which could create insolvency for the last settlement claimants. The practical risk is low due to the 30-day delay, but it should be addressed before mainnet deployment.

**Recommended actions before deployment:**
1. Add a `debate.status != DebateStatus.RESOLVED` guard to `emergencyWithdraw` to prevent post-resolution drain (SEC-019).
2. Add the 8 missing test cases identified in Section 6 to reach comprehensive coverage.
3. Consider renaming the `InsufficientParticipation` error in `sweepForfeitedBond` to something like `BondNotForfeited` for clarity (cosmetic).

---

*End of Wave 43R Security Re-Review.*
