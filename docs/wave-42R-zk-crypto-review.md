# Wave 42R — ZK/Crypto Expert Review: DebateMarket.sol

**Reviewer**: ZK/Crypto Expert Reviewer
**Date**: 2026-02-22
**Scope**: `contracts/src/DebateMarket.sol` (622 lines), `contracts/test/DebateMarket.t.sol` (1470 lines)
**Reference**: `specs/DEBATE-MARKET-SPEC.md`, `contracts/src/DistrictGate.sol`, `contracts/src/NullifierRegistry.sol`

---

## Executive Summary

The DebateMarket contract implements a staked debate protocol composing with DistrictGate (three-tree ZK proof verification) and NullifierRegistry (double-stake prevention). The architecture is sound in concept, but this review identified **2 CRITICAL**, **3 HIGH**, **5 MEDIUM**, and **4 LOW** findings. The two critical findings involve (1) missing action domain cross-validation that allows nullifier scoping bypass, and (2) resolveDebate operating on zero arguments, which produces a phantom winner at index 0. Both must be fixed before deployment.

---

## Findings

### ZK-001: Missing Action Domain Cross-Validation — Nullifier Scoping Bypass

**Severity**: CRITICAL
**Location**: `contracts/src/DebateMarket.sol:306-312` (submitArgument), `contracts/src/DebateMarket.sol:385-388` (coSignArgument)

**Description**:

The contract never validates that `publicInputs[27]` (the actionDomain embedded in the ZK proof) matches `debate.actionDomain` (the actionDomain stored on the debate record). DistrictGate's `verifyThreeTreeProof()` validates that `publicInputs[27]` is a whitelisted action domain (line 1018 of DistrictGate.sol), but it does not and cannot know which debate the caller intends to participate in.

This means an attacker can submit a valid three-tree proof generated for action domain A (e.g., a different debate or a non-debate action) and use it to stake in a debate scoped to action domain B. The nullifier recorded by DistrictGate (via NullifierRegistry) will be scoped to action domain A, not the debate's action domain B. Consequences:

1. **Double-staking**: The same identity can submit multiple arguments in the same debate by using proofs from different action domains. Each proof has a different nullifier (since nullifier = H2(identity_commitment, action_domain)), so the NullifierRegistry does not reject them.
2. **Nullifier bypass**: The entire one-stake-per-identity-per-debate invariant is broken.
3. **Stake record collision**: `stakeRecords[debateId][nullifier]` uses the nullifier from the proof, but two different nullifiers from the same identity (via different action domains) would produce two separate stake records. The attacker can win on both sides.

**Suggested fix**:

```solidity
// In submitArgument(), after verifyThreeTreeProof():
bytes32 proofActionDomain = bytes32(publicInputs[27]);
if (proofActionDomain != debate.actionDomain) revert ActionDomainMismatch();

// In coSignArgument(), same check:
bytes32 proofActionDomain = bytes32(publicInputs[27]);
if (proofActionDomain != debate.actionDomain) revert ActionDomainMismatch();
```

Add new error:
```solidity
error ActionDomainMismatch();
```

**Test gap**: The test file's `_makePublicInputs` helper always passes `ACTION_DOMAIN` for the actionDomain field, so this mismatch is never exercised. Add a test:

```solidity
function test_RevertWhen_ActionDomainMismatch() public {
    bytes32 debateId = _proposeStandardDebate();
    bytes32 wrongDomain = keccak256("different-domain");
    mockGate.setActionDomainAllowed(wrongDomain, true);

    vm.prank(arguer1);
    vm.expectRevert(DebateMarket.ActionDomainMismatch.selector);
    market.submitArgument(
        debateId, DebateMarket.Stance.SUPPORT, keccak256("arg"), bytes32(0),
        STANDARD_STAKE, arguer1, DUMMY_PROOF,
        _makePublicInputs(NULLIFIER_1, wrongDomain, 2), // wrong domain
        VERIFIER_DEPTH, block.timestamp + 1 hours, hex"00"
    );
}
```

---

### ZK-002: resolveDebate Succeeds With Zero Arguments — Phantom Winner

**Severity**: CRITICAL
**Location**: `contracts/src/DebateMarket.sol:427-458` (resolveDebate)

**Description**:

If a debate reaches its deadline with zero arguments submitted (`debate.argumentCount == 0`), `resolveDebate` still succeeds. The for-loop body never executes, `bestIndex` remains 0 and `bestScore` remains 0. The code then reads `arguments[debateId][0]`, which is an uninitialized storage slot (all zeros). The debate is marked RESOLVED with `winningArgumentIndex = 0`, `winningStance = SUPPORT` (enum zero), and empty body/amendment hashes.

This is dangerous because:

1. The debate is permanently in RESOLVED state with a phantom winner that nobody actually argued for.
2. The status can never transition to anything useful (no re-resolution, no cancellation path).
3. The proposer bond is locked: `claimProposerBond` requires `uniqueParticipants >= 5`, which will never be met, so the bond is permanently trapped in the contract.
4. `claimSettlement` for any random nullifier would fail at `record.stakeAmount == 0`, so no funds are directly lost — but the bond is permanently stuck.

**Suggested fix**:

```solidity
function resolveDebate(bytes32 debateId) external whenNotPaused nonReentrant {
    Debate storage debate = debates[debateId];
    if (debate.deadline == 0) revert DebateNotFound();
    if (debate.status != DebateStatus.ACTIVE) revert DebateNotActive();
    if (block.timestamp < debate.deadline) revert DebateStillActive();
    if (debate.argumentCount == 0) revert InsufficientParticipation();
    // ... rest of function
```

Or add a separate `cancelDebate` function for the zero-argument case that returns the proposer bond.

**Test gap**: No test for resolving a debate with zero arguments.

---

### ZK-003: Error Name Inversion — `DebateStillActive` Used for Expired Debate

**Severity**: HIGH
**Location**: `contracts/src/DebateMarket.sol:306`, `contracts/src/DebateMarket.sol:381`, `contracts/src/DebateMarket.sol:431`

**Description**:

This is the known issue flagged for investigation. The analysis:

- **Line 306** (`submitArgument`): `if (block.timestamp >= debate.deadline) revert DebateStillActive()` — This triggers when the debate has **expired** (timestamp past deadline). The error name says "still active" but the reality is the debate has ended. **Semantically inverted.**
- **Line 381** (`coSignArgument`): Same inversion.
- **Line 431** (`resolveDebate`): `if (block.timestamp < debate.deadline) revert DebateStillActive()` — This triggers when the debate IS still active and someone tries to resolve too early. **Semantically correct.**

**Severity assessment**: HIGH, not just MEDIUM, because:

1. Off-chain integrators parsing revert reasons will misinterpret the error. A frontend receiving `DebateStillActive` when a user tries to submit an argument to an expired debate will show the wrong error message (e.g., "debate is still active, try again later" when it should say "debate has expired").
2. The test file on line 427 (`test_RevertWhen_DebateExpired`) expects `DebateStillActive` for an expired debate, codifying the bug into the test suite.

**Suggested fix**:

Add a new error and use it at lines 306 and 381:

```solidity
error DebateExpired();

// Line 306 (submitArgument):
if (block.timestamp >= debate.deadline) revert DebateExpired();

// Line 381 (coSignArgument):
if (block.timestamp >= debate.deadline) revert DebateExpired();

// Line 431 (resolveDebate) — keep as-is, semantically correct:
if (block.timestamp < debate.deadline) revert DebateStillActive();
```

Update the test:
```solidity
vm.expectRevert(DebateMarket.DebateExpired.selector);
```

---

### ZK-004: Unchecked ERC-20 Return Values — Silent Transfer Failures

**Severity**: HIGH
**Location**: `contracts/src/DebateMarket.sol:259`, `contracts/src/DebateMarket.sol:323`, `contracts/src/DebateMarket.sol:399`, `contracts/src/DebateMarket.sol:487`, `contracts/src/DebateMarket.sol:506`

**Description**:

All five ERC-20 interactions use bare `transfer()` and `transferFrom()` without checking the return value or using OpenZeppelin's `SafeERC20`:

```solidity
stakingToken.transferFrom(msg.sender, address(this), bondAmount);    // L259
stakingToken.transferFrom(msg.sender, address(this), stakeAmount);   // L323
stakingToken.transferFrom(msg.sender, address(this), stakeAmount);   // L399
stakingToken.transfer(msg.sender, payout);                            // L487
stakingToken.transfer(msg.sender, debate.proposerBond);               // L506
```

Per ERC-20 spec, `transfer` and `transferFrom` return `bool`. Some tokens (notably USDT) return `false` on failure instead of reverting. If the staking token is such a token, transfers can silently fail:

- **On stake**: User records a stake without actually depositing tokens. The contract's accounting is inflated.
- **On settlement**: `claimSettlement` marks `record.claimed = true` and emits `SettlementClaimed` but sends zero tokens. The winner's payout is lost.

The spec says USDC on Scroll is the Phase 1 token (which does revert on failure), but the contract is designed to be token-agnostic (`IERC20 public immutable stakingToken`), and Phase 2 plans switching to VOTER ERC-20 whose behavior is unknown.

**Suggested fix**:

```solidity
import "openzeppelin/token/ERC20/utils/SafeERC20.sol";

contract DebateMarket is Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    // ...
    stakingToken.safeTransferFrom(msg.sender, address(this), bondAmount);
    // ... (all 5 call sites)
}
```

---

### ZK-005: `minAuthority` Field Stored But Never Enforced

**Severity**: HIGH
**Location**: `contracts/src/DebateMarket.sol:51` (struct field), `contracts/src/DebateMarket.sol:247-276` (proposeDebate)

**Description**:

The `Debate` struct contains a `uint8 minAuthority` field, and the spec (section 1, ARGUE) states: "requires DistrictGate.verifyThreeTreeProof() for proposer ... requires stake >= bondFloor[engagement_tier]" with authority level gating. However:

1. `proposeDebate()` never accepts or sets `minAuthority` — it stays at its default value of 0.
2. `submitArgument()` and `coSignArgument()` never check `publicInputs[28]` (authority level) against any minimum.
3. DistrictGate does enforce `actionDomainMinAuthority[actionDomain]` internally, but this is a separate gate-level check — the debate contract itself has no ability to set per-debate authority thresholds beyond what the action domain already requires.

This means the `minAuthority` field is dead storage, wasting ~5,000 gas per debate creation (cold SSTORE) for a value that is never read.

**Suggested fix**: Either:

(a) Remove `minAuthority` from the Debate struct (saves gas, removes dead code), or
(b) Accept `minAuthority` as a `proposeDebate` parameter, store it, and validate `publicInputs[28] >= debate.minAuthority` in `submitArgument` and `coSignArgument`.

---

### ZK-006: debateId Collision via `abi.encodePacked` with Non-Fixed-Width Inputs

**Severity**: MEDIUM
**Location**: `contracts/src/DebateMarket.sol:262-264`

**Description**:

```solidity
debateId = keccak256(
    abi.encodePacked(propositionHash, actionDomain, block.timestamp, msg.sender)
);
```

All four inputs are fixed-width (bytes32, bytes32, uint256, address), so there is no actual `abi.encodePacked` concatenation ambiguity in this case. However, if the same proposer submits the same proposition with the same action domain in the same block, they get an identical `debateId`, silently overwriting the previous debate's storage.

This is a collision by design rather than by hash weakness. An attacker (or careless user) calling `proposeDebate` twice in the same transaction batch could overwrite a funded debate.

**Suggested fix**: Add a nonce or check for existing debate:

```solidity
if (debates[debateId].deadline != 0) revert DebateAlreadyExists();
```

Or use `abi.encode` instead of `abi.encodePacked` for defense-in-depth (even though the types are fixed-width here, `abi.encode` is the safer default).

---

### ZK-007: `SETTLED` Status Never Assigned — Dead Enum Value

**Severity**: MEDIUM
**Location**: `contracts/src/DebateMarket.sol:44`

**Description**:

The `DebateStatus` enum defines three states: `ACTIVE`, `RESOLVED`, `SETTLED`. However, no code path ever sets `debate.status = DebateStatus.SETTLED`. The debate transitions from `ACTIVE` -> `RESOLVED` (via `resolveDebate`) and remains in `RESOLVED` forever.

This means:
1. External contracts/indexers checking for `SETTLED` status will never see it.
2. There is no finality signal — a resolved debate where all claims have been processed looks identical to one where no claims have been made.
3. The enum value is dead code.

**Suggested fix**: Either remove `SETTLED` from the enum, or add a finality transition (e.g., after all winning stakers have claimed, anyone can call `finalizeDebate` to transition to `SETTLED`).

---

### ZK-008: Tier-Scaled Bond/Stake Floors From Spec Not Implemented

**Severity**: MEDIUM
**Location**: `contracts/src/DebateMarket.sol:107-111`

**Description**:

The spec (section 2) defines tier-dependent bond and stake floors:

| Tier | Proposer Bond | Argument Stake Floor |
|------|---------------|---------------------|
| 0    | --            | --                  |
| 1    | $20           | $5                  |
| 2    | $10           | $3                  |
| 3    | $5            | $1                  |
| 4    | $2            | $1                  |

The contract implements flat floors: `MIN_PROPOSER_BOND = 1e6` ($1) and `MIN_ARGUMENT_STAKE = 1e6` ($1) regardless of tier. This is a spec deviation: the spec explicitly says "Bond and stake floors are inversely scaled by engagement tier."

The impact is that higher-tier participants get the anti-spam benefit of lower floors without the contract enforcing it, and lower-tier participants can participate with less friction than the spec intends ($1 instead of $5 for Tier 1 argument stakes).

**Suggested fix**: Add tier-indexed floor arrays matching the spec:

```solidity
uint256[5] public PROPOSER_BOND_FLOOR = [0, 20e6, 10e6, 5e6, 2e6];
uint256[5] public ARGUMENT_STAKE_FLOOR = [0, 5e6, 3e6, 1e6, 1e6];
```

Note: This requires the proposer to also submit a ZK proof at debate creation time (matching spec section 11: "Propose debate ... requires DistrictGate.verifyThreeTreeProof() for proposer"), which is currently not implemented. The proposer path is entirely non-anonymous.

---

### ZK-009: Proposer Bond Is Permanently Trapped When Participation < 5

**Severity**: MEDIUM
**Location**: `contracts/src/DebateMarket.sol:492-509`

**Description**:

When a debate resolves with fewer than 5 unique participants, `claimProposerBond` always reverts with `InsufficientParticipation`. There is no alternative path to recover or redistribute these funds. They remain in the contract forever.

Combined with ZK-002 (zero-argument resolution), the problem compounds: a debate with zero arguments can be resolved, trapping the proposer bond permanently with no possible recovery.

Over time, this creates a growing balance of trapped tokens in the contract — a "dust trap" that accumulates.

**Suggested fix**: Add a sweep mechanism or a `cancelDebate` function:

```solidity
/// @notice Cancel a debate that failed to attract participation
/// @dev Only callable after deadline, only if < BOND_RETURN_THRESHOLD participants
function cancelDebate(bytes32 debateId) external whenNotPaused nonReentrant {
    Debate storage debate = debates[debateId];
    if (debate.deadline == 0) revert DebateNotFound();
    if (block.timestamp < debate.deadline) revert DebateStillActive();
    if (debate.uniqueParticipants >= BOND_RETURN_THRESHOLD) revert DebateHasSufficientParticipation();
    // Return bond to proposer, return stakes to stakers (via settlement)
    // ...
}
```

Alternatively, forfeit the bond to a treasury address rather than trapping it.

---

### ZK-010: Settlement Rounding Can Trap Dust Tokens

**Severity**: MEDIUM
**Location**: `contracts/src/DebateMarket.sol:480-485`

**Description**:

The settlement payout formula:

```solidity
payout += (losingPool * record.stakeAmount) / winningArgStake;
```

Integer division truncates. For N winning stakers, the sum of all `(losingPool * record.stakeAmount) / winningArgStake` can be less than `losingPool` due to cumulative rounding errors. The remaining dust tokens are trapped in the contract.

Example: `losingPool = 10e6`, 3 winning stakers each with `stakeAmount = 3e6`, `winningArgStake = 9e6`.
- Each payout share = `(10e6 * 3e6) / 9e6 = 3,333,333` (truncated from 3,333,333.33...)
- Total distributed = `3,333,333 * 3 = 9,999,999`
- Trapped dust = `10e6 - 9,999,999 = 1` (1 micro-unit)

For USDC with 6 decimals, this is negligible per debate. But across thousands of debates, it accumulates. More importantly, there is no mechanism to ever recover this dust.

**Suggested fix**: Accept as known behavior and document it, or give the last claimer the remainder:

```solidity
// Track cumulative payouts and give last claimer the remainder
```

Severity is MEDIUM because the amounts are negligible per debate but the lack of any recovery mechanism means permanent, growing token loss.

---

### ZK-011: Proposer Is Non-Anonymous — Breaks Privacy Model

**Severity**: LOW
**Location**: `contracts/src/DebateMarket.sol:247-276`

**Description**:

`proposeDebate()` takes no ZK proof — the proposer is identified by `msg.sender` and stored as `debate.proposer`. This breaks the privacy model described in the spec (section 6): "Anonymous staking ... Two arguments from the same person in different debates use different nullifiers."

The spec (section 11) says: "proposeDebate(..., proof, nullifier, stake) requires DistrictGate.verifyThreeTreeProof() for proposer" — but the implementation skips this entirely. The proposer's address is stored on-chain and linked to the debate.

**Suggested fix**: Either:
(a) Add ZK proof verification to `proposeDebate` matching the spec, or
(b) Document this as a deliberate simplification and update the spec accordingly.

---

### ZK-012: `TIER_MULTIPLIER` Is Not Truly Constant

**Severity**: LOW
**Location**: `contracts/src/DebateMarket.sol:115`

**Description**:

```solidity
uint256[5] public TIER_MULTIPLIER = [0, 2, 4, 8, 16];
```

Despite the `SCREAMING_CASE` name, this is a storage variable (mutable state), not a compile-time constant. Solidity does not support `constant` for arrays. Each read costs an SLOAD (~2,100 gas cold, ~100 gas warm) instead of a constant inline.

This is not a correctness issue, but on Scroll L2 the gas difference is minimal. The naming is misleading — readers may assume it cannot be modified, but in fact any contract upgrade mechanism could modify it (though currently there is no such mechanism).

**Suggested fix**: Add `immutable`-style protection via a getter function, or use an `if/else` chain in a `pure` function:

```solidity
function tierMultiplier(uint8 tier) internal pure returns (uint256) {
    if (tier == 1) return 2;
    if (tier == 2) return 4;
    if (tier == 3) return 8;
    if (tier == 4) return 16;
    return 0;
}
```

---

### ZK-013: No Event for Debate Cancellation / Bond Forfeiture

**Severity**: LOW
**Location**: `contracts/src/DebateMarket.sol:492-509`

**Description**:

When a proposer's bond is forfeited (participation < 5), there is no event emitted signaling this. The only observable behavior is that `claimProposerBond` reverts. Off-chain indexers have no way to distinguish between "bond not yet claimed" and "bond permanently forfeited" without re-executing the participation check.

**Suggested fix**: Emit a `ProposerBondForfeited(debateId, bondAmount)` event during resolution if `uniqueParticipants < BOND_RETURN_THRESHOLD`, or provide a view function `isBondForfeited(debateId)`.

---

### ZK-014: Sqrt Implementation — Correctness Verified, Edge Cases Noted

**Severity**: LOW (informational)
**Location**: `contracts/src/DebateMarket.sol:590-598`

**Description**:

The Babylonian method implementation is correct:

```solidity
function sqrt(uint256 x) internal pure returns (uint256 y) {
    if (x == 0) return 0;
    uint256 z = (x + 1) / 2;
    y = x;
    while (z < y) {
        y = z;
        z = (x / z + z) / 2;
    }
}
```

Verified behavior:
- `sqrt(0) = 0` (explicit check)
- `sqrt(1) = 1` (z = 1, y = 1, loop terminates immediately)
- `sqrt(4) = 2`
- `sqrt(2) = 1` (floor)
- `sqrt(type(uint256).max)` terminates correctly — the algorithm converges in O(log(log(n))) iterations, approximately 128 iterations for max uint256. No overflow: `x / z` is safe since `z >= 1`, and `x / z + z` fits in uint256 since both terms are <= sqrt(max) after first iteration.

**Integer truncation impact**: For USDC stakes ($1-$100 range, i.e., 1e6 to 100e6 in 6-decimal units), the truncation error is at most 1 unit from the true floor value. For the spec's scoring table:

| Stake | Exact sqrt | Integer sqrt | Error |
|-------|-----------|-------------|-------|
| $2 (2e6) | 1414.21... | 1414 | -0.21 |
| $10 (10e6) | 3162.27... | 3162 | -0.27 |
| $100 (100e6) | 10000.0 | 10000 | 0.0 |

Maximum relative error ~0.02% at these scales — negligible for the scoring formula. The spec acknowledges integer sqrt gives slightly different numbers than floating-point ("spec says ~22627 but integer sqrt gives 1414").

No issues found.

---

## Test Coverage Assessment

### Strengths
- Comprehensive lifecycle test covering propose -> argue -> resolve
- Tie-breaking behavior explicitly tested
- Scoring table values from spec verified against contract output
- Tier 0 block enforced
- Double-stake prevention tested with real NullifierRegistry
- Proposer bond return/forfeiture tested at threshold boundary
- Pause controls tested

### Gaps
1. **No test for action domain mismatch** (ZK-001) — all tests use matching domains
2. **No test for zero-argument resolution** (ZK-002) — all resolution tests have at least 1 argument
3. **No test for debateId collision** (ZK-006) — same proposer, same block
4. **No settlement math precision test** — no test validates exact payout amounts against expected formula
5. **No test for ERC-20 transfer failure** — MockERC20 always succeeds
6. **No test for engagement tier = 5** (out-of-range) — only tier 0 and valid tiers tested
7. **No co-sign after deadline test** — only submitArgument after deadline is tested
8. **No fuzz tests** — the sqrt function and settlement math are ideal candidates for property-based testing

---

## Summary Table

| ID | Severity | Category | Description |
|--------|----------|----------|-------------|
| ZK-001 | CRITICAL | Nullifier bypass | Missing action domain cross-validation allows double-staking |
| ZK-002 | CRITICAL | Resolution bug | Zero-argument debates resolve with phantom winner, trapping bond |
| ZK-003 | HIGH | Error semantics | `DebateStillActive` error used when debate has expired (inverted) |
| ZK-004 | HIGH | Token safety | Unchecked ERC-20 return values — use SafeERC20 |
| ZK-005 | HIGH | Dead code | `minAuthority` stored but never set or enforced |
| ZK-006 | MEDIUM | Collision | debateId collision when same params in same block |
| ZK-007 | MEDIUM | Dead code | `SETTLED` status enum value never assigned |
| ZK-008 | MEDIUM | Spec deviation | Tier-scaled bond/stake floors not implemented |
| ZK-009 | MEDIUM | Trapped funds | Proposer bond permanently trapped when participation < 5 |
| ZK-010 | MEDIUM | Rounding | Settlement rounding traps dust tokens permanently |
| ZK-011 | LOW | Privacy | Proposer is non-anonymous, deviating from spec |
| ZK-012 | LOW | Gas/naming | TIER_MULTIPLIER is storage, not constant — naming misleads |
| ZK-013 | LOW | Observability | No event for bond forfeiture |
| ZK-014 | LOW | Informational | Sqrt implementation correct; truncation error negligible |

---

## Recommendation

**Do not deploy** until ZK-001 and ZK-002 are resolved. ZK-001 breaks the core one-identity-one-stake invariant. ZK-002 can permanently trap proposer bonds. ZK-003 and ZK-004 should also be fixed before deployment. The remaining findings are important but not deployment-blocking.
