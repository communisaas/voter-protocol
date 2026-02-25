# Wave 43R -- ZK/Crypto Expert Re-Review: DebateMarket.sol

**Reviewer**: ZK/Crypto Expert Re-Reviewer
**Date**: 2026-02-22
**Scope**: `contracts/src/DebateMarket.sol` (660 lines), `contracts/test/DebateMarket.t.sol` (1728 lines)
**Reference**: `docs/wave-42R-zk-crypto-review.md` (14 findings)
**Purpose**: Verify all Wave 42R fixes are correctly applied; identify regressions.

---

## Executive Summary

The Wave 42R review identified 2 CRITICAL, 3 HIGH, 5 MEDIUM, and 4 LOW findings. Of the 14 findings, 10 required code changes and 3 were deferred by design (ZK-007, ZK-008, ZK-010). One (ZK-014) was informational with no action needed. All 10 actionable findings have been addressed. Two new issues were discovered in the fix code, both LOW severity. Overall assessment: **APPROVE WITH NOTES**.

---

## Finding-by-Finding Verification

### ZK-001 CRITICAL -- Action Domain Cross-Validation

**Status**: RESOLVED

**Evidence**:

In `submitArgument()` (line 324):
```solidity
if (bytes32(publicInputs[27]) != debate.actionDomain) revert ActionDomainMismatch();
```

In `coSignArgument()` (line 404):
```solidity
if (bytes32(publicInputs[27]) != debate.actionDomain) revert ActionDomainMismatch();
```

Both checks are positioned AFTER `districtGate.verifyThreeTreeProof()` (lines 320-322 and 400-402 respectively), which is the correct placement -- the proof is verified first (confirming the public inputs are authentic), then the contract validates the action domain matches the debate. The `ActionDomainMismatch` error is declared at line 205.

**Test coverage**: Two dedicated tests exist:
- `test_RevertWhen_ActionDomainMismatch()` (line 1324) -- submitArgument path
- `test_RevertWhen_CoSignActionDomainMismatch()` (line 1340) -- coSignArgument path

Both tests create a second whitelisted domain, pass it in the public inputs, and assert `ActionDomainMismatch` revert. The coSign test correctly submits a valid argument first before attempting the mismatched co-sign.

**Regression check**: No lockout risk. A user who generates a proof for the wrong action domain simply gets a revert. They can regenerate the proof with the correct domain and resubmit. The check is stateless (no side effects before the revert) since `verifyThreeTreeProof` records the nullifier in NullifierRegistry before this check. See NEW-001 below for the implication.

---

### ZK-002 CRITICAL -- Zero-Argument Resolution Guard

**Status**: RESOLVED

**Evidence**:

In `resolveDebate()` (line 450):
```solidity
if (debate.argumentCount == 0) revert NoArgumentsSubmitted();
```

The `NoArgumentsSubmitted` error is declared at line 206. The guard is placed after the standard checks (DebateNotFound, DebateNotActive, DebateStillActive) and before the scoring loop, which is the correct position.

**Test coverage**: `test_RevertWhen_ResolveZeroArguments()` (line 1369) proposes a debate, warps past deadline, and asserts `NoArgumentsSubmitted` revert.

**Note**: With this guard, a zero-argument debate can never reach RESOLVED status. However, there is still no explicit path to recover the proposer bond for a debate that expires with zero arguments -- the bond remains in the contract. The `sweepForfeitedBond` function (see ZK-009) requires `debate.status == RESOLVED`, so it cannot reach these bonds either. This is a design gap but not a regression -- it existed before Wave 42R (the bond was always trapped in the zero-argument case). See NEW-002 below.

---

### ZK-003 HIGH -- Error Name Inversion

**Status**: RESOLVED

**Evidence**:

The `DebateExpired` error is declared at line 189. Usage:

- `submitArgument()` line 315: `if (block.timestamp >= debate.deadline) revert DebateExpired();` -- Correct. Debate has expired.
- `coSignArgument()` line 395: `if (block.timestamp >= debate.deadline) revert DebateExpired();` -- Correct. Debate has expired.
- `resolveDebate()` line 449: `if (block.timestamp < debate.deadline) revert DebateStillActive();` -- Correct. Debate IS still active.
- `emergencyWithdraw()` line 551: `if (block.timestamp < debate.deadline + EMERGENCY_WITHDRAW_DELAY) revert DebateStillActive();` -- Semantically acceptable. The emergency window has not opened yet. "Still active" is slightly loose but not inverted.

**Test coverage**:
- `test_RevertWhen_DebateExpired()` (line 421) expects `DebateExpired.selector` -- Correct.
- `test_RevertWhen_ResolveBeforeDeadline()` (line 686) expects `DebateStillActive.selector` -- Correct.
- `test_RevertWhen_CoSignAfterDeadline()` (line 1511) expects `DebateExpired.selector` -- Correct.
- `test_RevertWhen_EmergencyWithdraw_TooEarly()` (line 1481) expects `DebateStillActive.selector` -- Correct.

---

### ZK-004 HIGH -- SafeERC20

**Status**: RESOLVED

**Evidence**:

Import at line 7:
```solidity
import "openzeppelin/token/ERC20/utils/SafeERC20.sol";
```

Using directive at line 32:
```solidity
using SafeERC20 for IERC20;
```

All 5 original call sites plus 2 new ones use safe variants:

| Location | Call | Line |
|----------|------|------|
| proposeDebate | `stakingToken.safeTransferFrom(...)` | 282 |
| submitArgument | `stakingToken.safeTransferFrom(...)` | 366 |
| coSignArgument | `stakingToken.safeTransferFrom(...)` | 436 |
| claimSettlement | `stakingToken.safeTransfer(...)` | 507 |
| claimProposerBond | `stakingToken.safeTransfer(...)` | 526 |
| sweepForfeitedBond | `stakingToken.safeTransfer(...)` | 541 |
| emergencyWithdraw | `stakingToken.safeTransfer(...)` | 559 |

All 7 ERC-20 interactions use safe variants. No bare `transfer()` or `transferFrom()` calls remain.

---

### ZK-005 HIGH -- minAuthority Field Removed

**Status**: RESOLVED

**Evidence**:

The `Debate` struct (lines 50-66) no longer contains a `minAuthority` field. Current fields:

```solidity
struct Debate {
    bytes32 propositionHash;
    bytes32 actionDomain;
    uint256 deadline;
    uint256 argumentCount;
    uint256 uniqueParticipants;
    uint256 jurisdictionSizeHint;
    uint256 totalStake;
    uint256 winningArgumentIndex;
    Stance winningStance;
    bytes32 winningBodyHash;
    bytes32 winningAmendmentHash;
    DebateStatus status;
    address proposer;
    uint256 proposerBond;
    bool bondClaimed;
}
```

No `minAuthority` field. No references to `minAuthority` anywhere in the contract. Gas savings of ~5,000 per debate creation (one fewer SSTORE).

---

### ZK-006 MEDIUM -- debateId Collision

**Status**: RESOLVED

**Evidence**:

In `proposeDebate()` (line 270):
```solidity
if (debates[debateId].deadline != 0) revert DebateAlreadyExists();
```

The `DebateAlreadyExists` error is declared at line 209. The check is placed after debateId generation (lines 266-268) and before any state writes, which is the correct position.

**Test coverage**: `test_RevertWhen_DebateIdCollision()` (line 1394) calls `proposeDebate` twice with identical parameters in the same block and asserts the second call reverts with `DebateAlreadyExists`.

**Note**: The ID generation still uses `abi.encodePacked` rather than `abi.encode`. As noted in the original review, all four inputs are fixed-width, so there is no concatenation ambiguity. The existence check is the real fix. No regression.

---

### ZK-007 MEDIUM -- SETTLED Status Unused

**Status**: DEFERRED (acknowledged)

The `SETTLED` enum value (line 47) is still present and still never assigned. This was explicitly deferred in Wave 42R. No change expected.

---

### ZK-008 MEDIUM -- Tier-Scaled Bond/Stake Floors

**Status**: DEFERRED (acknowledged)

The contract still uses flat floors: `MIN_PROPOSER_BOND = 1e6` (line 108) and `MIN_ARGUMENT_STAKE = 1e6` (line 111). This was explicitly deferred in Wave 42R. No change expected.

---

### ZK-009 MEDIUM -- Trapped Proposer Bond

**Status**: RESOLVED

**Evidence**:

The `sweepForfeitedBond()` function exists at lines 533-544:

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

Guards verified:
- `onlyGovernance` -- only governance can sweep (line 533)
- `nonReentrant` -- reentrancy protection (line 533)
- `debate.deadline == 0` -- debate must exist
- `debate.status != DebateStatus.RESOLVED` -- debate must be resolved
- `debate.uniqueParticipants >= BOND_RETURN_THRESHOLD` -- participation must be below threshold (note: error name reuse is slightly confusing -- `InsufficientParticipation` is used to reject sweep when participation IS sufficient, see below)
- `debate.bondClaimed` -- prevents double sweep
- Sets `bondClaimed = true` before transfer (CEI pattern)
- Uses `safeTransfer` (ZK-004 compliance)

The `ProposerBondForfeited` event (line 176) is emitted, resolving ZK-013 simultaneously.

**Test coverage**:
- `test_SweepForfeitedBond_Success()` (line 1409) -- 3 participants, resolved, governance sweeps, balance verified
- `test_RevertWhen_SweepBond_SufficientParticipation()` (line 1427) -- 5 participants, sweep reverts
- `test_RevertWhen_SweepBond_NotGovernance()` (line 1447) -- non-governance caller reverts

**Minor note**: The error reuse `InsufficientParticipation` at line 537 is semantically inverted in this context. In `claimProposerBond`, it means "not enough participants to return the bond." In `sweepForfeitedBond`, it fires when there ARE enough participants (i.e., sweep is disallowed because participation was sufficient). A more precise error name would be `SufficientParticipation` or `BondNotForfeited`. This is cosmetic, not a correctness issue, but may confuse off-chain error parsing.

---

### ZK-010 MEDIUM -- Settlement Rounding Dust

**Status**: DEFERRED (acknowledged)

The settlement formula at line 504 still uses integer division:
```solidity
payout += (losingPool * record.stakeAmount) / winningArgStake;
```

No last-claimer remainder logic was added. This was explicitly deferred in Wave 42R. No change expected.

---

### ZK-011 LOW -- Proposer Non-Anonymous

**Status**: NOT IN SCOPE FOR 42R FIXES

The proposer is still identified by `msg.sender` (line 278). This was a design observation, not an actionable fix in Wave 42R. No change expected.

---

### ZK-012 LOW -- TIER_MULTIPLIER Replaced With Pure Function

**Status**: RESOLVED

**Evidence**:

The `TIER_MULTIPLIER` storage array has been removed. A pure function exists at lines 653-659:

```solidity
function tierMultiplier(uint8 tier) internal pure returns (uint256) {
    if (tier == 1) return 2;
    if (tier == 2) return 4;
    if (tier == 3) return 8;
    if (tier == 4) return 16;
    return 0;
}
```

**Correctness verification for all tiers**:

| Tier | Expected (2^tier) | Function returns | Correct? |
|------|--------------------|------------------|----------|
| 0    | 0 (blocked)        | 0                | Yes      |
| 1    | 2                  | 2                | Yes      |
| 2    | 4                  | 4                | Yes      |
| 3    | 8                  | 8                | Yes      |
| 4    | 16                 | 16               | Yes      |

Tier 0 returns 0, which is caught by the `if (tierMultiplier(engagementTier) == 0) revert InvalidEngagementTier()` check at lines 330 and 410. Tiers 1-4 return the correct power-of-two multiplier. The function is `internal pure`, so no SLOAD gas cost.

**Test coverage**: `test_TierMultipliers_ViaScoring()` (line 1215) verifies all four tiers 1-4 via the scoring formula (sqrt(1e6) * multiplier = 1000 * multiplier).

---

### ZK-013 LOW -- No Event for Bond Forfeiture

**Status**: RESOLVED

The `ProposerBondForfeited` event is declared at line 176:
```solidity
event ProposerBondForfeited(bytes32 indexed debateId, uint256 bondAmount);
```

It is emitted in `sweepForfeitedBond()` at line 543. Off-chain indexers can now detect bond forfeiture.

---

### ZK-014 LOW -- Sqrt Correctness (Informational)

**Status**: NO CHANGES NEEDED

The sqrt implementation (lines 643-651) is unchanged from the original review, which verified it as correct. No regression.

---

## Additional Fixes Applied (Not in Original Wave 42R Findings)

### StakeRecord.submitter Field

A `submitter` field was added to the `StakeRecord` struct (line 82):
```solidity
struct StakeRecord {
    uint256 argumentIndex;
    uint256 stakeAmount;
    uint8 engagementTier;
    bool claimed;
    address submitter;
}
```

This is used in `claimSettlement()` (line 495) and `emergencyWithdraw()` (line 556) to restrict withdrawals to the original submitter:
```solidity
if (record.submitter != msg.sender) revert UnauthorizedClaimer();
```

This is a good security addition. Without it, anyone who knows a nullifier could claim someone else's settlement. The `UnauthorizedClaimer` error is declared at line 207.

**Test coverage**: `test_RevertWhen_UnauthorizedClaimer()` (line 1381) verifies a non-submitter cannot claim.

### DuplicateNullifier Check (Contract-Level)

Lines 351 and 422 add a contract-level duplicate nullifier check:
```solidity
if (stakeRecords[debateId][nullifier].stakeAmount != 0) revert DuplicateNullifier();
```

This is defense-in-depth alongside the NullifierRegistry check. It prevents any edge case where the NullifierRegistry might not catch a duplicate (e.g., if the action domain scoping in NullifierRegistry differs from the debate's expectations). Good addition.

### MAX_ARGUMENTS Cap

Line 317 adds a gas DOS guard:
```solidity
if (debate.argumentCount >= MAX_ARGUMENTS) revert TooManyArguments();
```

`MAX_ARGUMENTS = 500` (line 114). This bounds the gas cost of `resolveDebate()`, which iterates all arguments. On Scroll L2 with 500 arguments, the loop reads approximately 500 storage slots (warm reads at ~100 gas each = ~50,000 gas), which is well within block gas limits.

### Emergency Withdrawal

The `emergencyWithdraw()` function (lines 548-562) is a new safety valve:
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

**Design review**:
- Available 30 days after deadline regardless of debate status (not gated by `whenNotPaused` -- intentional, so it works even when contract is paused)
- Returns only original stake, not any profit from the losing pool
- Sets `record.claimed = true` to prevent double-withdrawal
- Has `nonReentrant` guard
- Uses `safeTransfer`

**Test coverage**:
- `test_EmergencyWithdraw_Success()` (line 1463) -- verifies withdrawal works after delay
- `test_RevertWhen_EmergencyWithdraw_TooEarly()` (line 1481) -- verifies delay enforcement

---

## NEW Findings Introduced by Fixes

### NEW-001 LOW -- Nullifier Burned on Action Domain Mismatch

**Severity**: LOW
**Location**: `DebateMarket.sol:320-324`, `DebateMarket.sol:400-404`

**Description**:

The action domain cross-validation (ZK-001 fix) is placed AFTER `districtGate.verifyThreeTreeProof()`. The DistrictGate call records the nullifier in NullifierRegistry as a side effect. If the action domain check then fails (the proof was generated for the wrong domain), the transaction reverts, BUT the nullifier has already been recorded in NullifierRegistry.

Wait -- the transaction reverts, so the nullifier recording is also reverted (it is part of the same transaction). The EVM reverts all state changes on revert. So the nullifier is NOT burned.

**Revised assessment**: No issue. The EVM revert semantics ensure that if `ActionDomainMismatch` fires, the `NullifierRegistry.recordNullifier` call is also rolled back. The user can regenerate and resubmit. This is correct.

**Status**: WITHDRAWN (false positive on closer analysis)

---

### NEW-002 LOW -- Zero-Argument Debate Bond Permanently Trapped

**Severity**: LOW
**Location**: `DebateMarket.sol:450` (NoArgumentsSubmitted guard), `DebateMarket.sol:533-544` (sweepForfeitedBond)

**Description**:

With the ZK-002 fix, a debate that reaches its deadline with zero arguments can never be resolved (the `NoArgumentsSubmitted` guard prevents it). The `sweepForfeitedBond` function requires `debate.status == RESOLVED` (line 536). Since the zero-argument debate can never reach RESOLVED status, the proposer bond is permanently trapped with no recovery path.

The emergency withdrawal path (`emergencyWithdraw`) operates on `StakeRecord` entries, not the proposer bond, so it cannot recover this bond either.

The bond is stuck in the contract forever. While this is a pre-existing design issue (it existed before Wave 42R -- the zero-argument debate previously resolved to a phantom winner, which was worse), the ZK-002 fix closes the phantom-winner vulnerability but leaves the bond-trapping issue unsolved.

**Suggested fix**: Add a `cancelDebate` function for zero-argument debates past their deadline:

```solidity
function cancelDebate(bytes32 debateId) external whenNotPaused nonReentrant {
    Debate storage debate = debates[debateId];
    if (debate.deadline == 0) revert DebateNotFound();
    if (debate.status != DebateStatus.ACTIVE) revert DebateNotActive();
    if (block.timestamp < debate.deadline) revert DebateStillActive();
    if (debate.argumentCount > 0) revert DebateHasArguments();
    if (debate.bondClaimed) revert BondAlreadyClaimed();

    debate.bondClaimed = true;
    debate.status = DebateStatus.RESOLVED; // or a new CANCELLED status
    stakingToken.safeTransfer(debate.proposer, debate.proposerBond);

    emit ProposerBondReturned(debateId, debate.proposerBond);
}
```

Alternatively, modify `sweepForfeitedBond` to also accept ACTIVE debates that are past their deadline with zero arguments.

**Impact**: The proposer voluntarily put up the bond knowing participation is not guaranteed. The bond amounts are small ($1-$20). The issue is a quality-of-life problem, not a security vulnerability.

---

### NEW-003 LOW -- Emergency Withdrawal Allows Double-Dip After Normal Settlement

**Severity**: LOW (mitigated by shared `claimed` flag)

**Location**: `DebateMarket.sol:548-562` (emergencyWithdraw), `DebateMarket.sol:483-509` (claimSettlement)

**Description**:

Could a user claim settlement (getting stake + profit) and then also emergency-withdraw (getting stake again)?

Analysis: Both functions check and set `record.claimed = true`. `claimSettlement` sets `record.claimed = true` at line 497 before transferring. `emergencyWithdraw` checks `if (record.claimed) revert AlreadyClaimed()` at line 555. So a user who has already claimed settlement cannot emergency-withdraw, and vice versa. The shared `claimed` flag prevents the double-dip.

**Status**: MITIGATED. No vulnerability.

However, there is a subtle accounting concern: `emergencyWithdraw` returns only the original stake (`record.stakeAmount`), while `claimSettlement` returns stake plus a share of the losing pool. If a debate is resolved and a winning staker waits 30 days to use emergency withdrawal instead of claim settlement, they would receive LESS than their entitled payout (just the original stake, forfeiting their share of the losing pool). This is self-inflicted loss, not an exploit. The 30-day delay makes this an edge case.

A more concerning scenario: In a resolved debate, a LOSING staker could wait 30 days and use `emergencyWithdraw` to recover their stake. The emergency withdrawal does NOT check whether the staker was on the winning or losing side. This means losing stakers can get their original stake back via emergency withdrawal, effectively draining tokens that should have been distributed to winners.

Wait -- let me verify. The losing pool tokens are only distributed when winners call `claimSettlement`. They are not pre-allocated. So if losing stakers emergency-withdraw their stakes, the contract's token balance decreases, and when winners try to claim their settlement (stake + profit share), the contract may not have sufficient balance. This IS a concern.

**Revised severity**: **MEDIUM**

**Attack scenario**:
1. Debate resolves. Winner at $10, loser at $5. Total pool = $15. Winner entitled to $15.
2. Loser waits 30 days, calls `emergencyWithdraw`, recovers $5.
3. Winner calls `claimSettlement`, entitled to $10 + $5 = $15. But contract only has $10 remaining.
4. `safeTransfer` of $15 reverts due to insufficient balance. Winner's settlement is bricked.

**Mitigation**: The `emergencyWithdraw` function should check that the debate is NOT in RESOLVED status, or that the staker is on the winning side, to prevent losers from draining the settlement pool.

**Suggested fix**:
```solidity
function emergencyWithdraw(bytes32 debateId, bytes32 nullifier) external nonReentrant {
    Debate storage debate = debates[debateId];
    if (debate.deadline == 0) revert DebateNotFound();
    if (block.timestamp < debate.deadline + EMERGENCY_WITHDRAW_DELAY) revert DebateStillActive();
    // Prevent losers from draining the settlement pool after resolution
    if (debate.status == DebateStatus.RESOLVED) revert DebateAlreadyResolved();
    // ... rest of function
}
```

Or alternatively, only allow emergency withdrawal if the debate is still in ACTIVE status (meaning nobody resolved it within 30 days of the deadline -- it is truly abandoned):

```solidity
if (debate.status != DebateStatus.ACTIVE) revert DebateNotActive();
```

---

## Regression Analysis Summary

| Check | Result |
|-------|--------|
| Action domain cross-validation introduces lockout risk? | No. EVM revert semantics prevent nullifier burn on mismatch. |
| StakeRecord.submitter breaks existing flows? | No. Properly added to both submitArgument and coSignArgument. Claims correctly gated. |
| Emergency withdrawal double-withdrawal vector? | **Yes -- NEW-003**. Losers in a resolved debate can emergency-withdraw after 30 days, draining the settlement pool and bricking winners' claims. |
| tierMultiplier() pure function correct for all tiers? | Yes. Verified tiers 0-4, all return correct values. |
| New edge cases in fix code? | NEW-002 (zero-argument bond trapping, LOW) and NEW-003 (emergency withdrawal draining, MEDIUM). |

---

## Test Coverage Assessment

The test file has grown from the Wave 42R baseline to include 56 tests covering:

### New Test Categories Added Since Wave 42R

| Section | Tests | Covers |
|---------|-------|--------|
| 15 -- Action domain cross-validation | 2 | ZK-001 fix (submit + co-sign paths) |
| 16 -- Zero-argument resolution guard | 1 | ZK-002 fix |
| 17 -- Settlement claim authorization | 1 | StakeRecord.submitter |
| 18 -- Debate ID collision guard | 1 | ZK-006 fix |
| 19 -- Sweep forfeited bond | 3 | ZK-009 fix (success, sufficient participation, non-governance) |
| 20 -- Emergency withdrawal | 2 | New feature (success, too early) |
| 21 -- MAX_ARGUMENTS constant | 1 | New constant |
| 22 -- Co-sign after deadline | 1 | ZK-003 fix (co-sign path) |
| 23 -- Engagement tier out of range | 1 | Test gap from Wave 42R |

### Remaining Test Gaps

1. **No test for emergency withdrawal after resolution** -- The scenario in NEW-003 (loser emergency-withdraws after resolution, bricking winner's claim) is not tested.
2. **No test for emergency withdrawal by non-submitter** -- The `UnauthorizedClaimer` check in `emergencyWithdraw` is not tested.
3. **No test for sweepForfeitedBond double-call** -- The `BondAlreadyClaimed` guard in `sweepForfeitedBond` is not tested.
4. **No settlement math precision test** -- Still no test validating exact payout amounts against the expected formula (carried forward from Wave 42R).
5. **No fuzz tests** -- Still no property-based tests (carried forward from Wave 42R).

---

## Summary Table

| ID | Original Severity | Status | Notes |
|--------|-------------------|--------|-------|
| ZK-001 | CRITICAL | RESOLVED | Action domain check in both paths, 2 tests |
| ZK-002 | CRITICAL | RESOLVED | Zero-argument guard, 1 test |
| ZK-003 | HIGH | RESOLVED | DebateExpired error, correct usage in all 4 locations |
| ZK-004 | HIGH | RESOLVED | SafeERC20 on all 7 call sites |
| ZK-005 | HIGH | RESOLVED | minAuthority removed from struct |
| ZK-006 | MEDIUM | RESOLVED | DebateAlreadyExists check, 1 test |
| ZK-007 | MEDIUM | DEFERRED | SETTLED still unused (by design) |
| ZK-008 | MEDIUM | DEFERRED | Flat floors retained (by design) |
| ZK-009 | MEDIUM | RESOLVED | sweepForfeitedBond function, 3 tests |
| ZK-010 | MEDIUM | DEFERRED | Rounding dust accepted (by design) |
| ZK-011 | LOW | NOT IN SCOPE | Proposer still non-anonymous (by design) |
| ZK-012 | LOW | RESOLVED | Pure function, correct for all tiers |
| ZK-013 | LOW | RESOLVED | ProposerBondForfeited event emitted |
| ZK-014 | LOW | NO ACTION NEEDED | sqrt unchanged, correct |

### New Findings

| ID | Severity | Description |
|--------|----------|-------------|
| NEW-002 | LOW | Zero-argument debate bond permanently trapped (no cancelDebate path) |
| NEW-003 | MEDIUM | Emergency withdrawal allows resolved-debate losers to drain settlement pool after 30 days |

---

## Overall Assessment

### APPROVE WITH NOTES

All 10 actionable Wave 42R findings are properly resolved with correct implementations and adequate test coverage. The 3 deferred items (ZK-007, ZK-008, ZK-010) are acknowledged. No regressions were found in the directly-fixed code.

One new MEDIUM finding (NEW-003) was discovered: the emergency withdrawal function does not check debate status, allowing losers in resolved debates to recover their stakes after 30 days, which can brick winners' settlement claims by draining the contract's token balance. This should be addressed before mainnet deployment by adding a `debate.status != DebateStatus.RESOLVED` guard to `emergencyWithdraw()`.

One new LOW finding (NEW-002) identifies that zero-argument debate bonds are permanently trapped. This is a quality-of-life issue, not a security vulnerability, and can be addressed with a `cancelDebate` function in a future iteration.

**Deployment readiness**: The contract is deployment-ready for testnet/staging with the caveat that NEW-003 must be fixed before mainnet. All original CRITICAL and HIGH findings are properly resolved.
