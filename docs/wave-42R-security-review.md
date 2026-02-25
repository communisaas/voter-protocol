# Wave 42R Security Review: DebateMarket.sol

**Reviewer:** Security Expert Reviewer (adversarial)
**Date:** 2026-02-22
**Scope:** `contracts/src/DebateMarket.sol` (622 lines), `contracts/test/DebateMarket.t.sol` (1470 lines)
**Supporting contracts reviewed:** `DistrictGate.sol`, `NullifierRegistry.sol`
**Severity scale:** CRITICAL / HIGH / MEDIUM / LOW

---

## Executive Summary

DebateMarket.sol implements a staked debate protocol where verified members submit arguments with financial stakes, weighted by `sqrt(stake) * 2^tier`, and winners claim proportional payouts from the losing pool. The contract composes with DistrictGate (ZK proof verification), NullifierRegistry (double-stake prevention), and an ERC-20 staking token.

This review identifies **3 CRITICAL**, **4 HIGH**, **5 MEDIUM**, and **5 LOW** findings. The most severe issues are: (1) settlement insolvency due to the proposer bond being paid from the same token balance that backs argument stakes, (2) missing SafeERC20 causing silent failures with non-standard tokens, and (3) nullifier scoping allows cross-debate stake record overwrites. The contract also has unbounded iteration in resolution, a permanently unreachable SETTLED status, and no mechanism to recover forfeited bonds.

---

## Findings

### SEC-001: Settlement Insolvency -- Proposer Bond Paid From Same Pool as Argument Stakes

**Severity:** CRITICAL
**Location:** `DebateMarket.sol:480-487` (claimSettlement), `DebateMarket.sol:504-506` (claimProposerBond)
**Description:**

The settlement payout formula distributes the entire `totalStake` among winners:

```solidity
uint256 losingPool = debate.totalStake - winningArgStake;
uint256 payout = record.stakeAmount + (losingPool * record.stakeAmount) / winningArgStake;
```

When all winning stakers claim, they collectively receive:
`winningArgStake + losingPool = totalStake`.

This exhausts exactly the argument stakes held by the contract. However, the proposer bond is *also* held in the same ERC-20 balance. If `uniqueParticipants >= 5`, `claimProposerBond()` transfers `proposerBond` additional tokens. Since the contract only holds `totalStake + proposerBond` tokens for that debate (and likely tokens from other debates), the proposer bond return is paid from tokens belonging to other debates or is satisfied only because losers have not (and cannot) claim.

However, the real issue is the reverse scenario: **if the bond is claimed first, it reduces the contract balance, potentially causing later settlement claims to fail for the last winner(s)** in a multi-debate contract. The contract has no per-debate accounting of its token balance -- it relies on the aggregate `balanceOf(address(this))`.

**Attack Scenario:**
1. Debate A: proposer bonds 100 USDC. 5 arguers stake 10 USDC each (totalStake = 50). Winner side has 30 USDC stake.
2. Contract balance = 150 USDC for this debate.
3. Proposer claims bond: -100 USDC. Balance = 50 USDC.
4. Winners try to claim their 50 USDC total. This works exactly.
5. But if another debate B's proposer bond was also expected to come from this balance, and Debate B has lower participation, the forfeited bond from B is trapped with no withdrawal path (see SEC-007).

More critically, consider rounding: with integer division in `(losingPool * record.stakeAmount) / winningArgStake`, the sum of all winner payouts can be **less than** `totalStake` due to rounding down, leaving dust. Over many debates, this dust accumulates but is irrecoverable.

**Suggested Fix:**
Track per-debate token balances explicitly, or add a post-settlement sweep function for rounding dust. Ensure the proposer bond is accounted for separately:

```solidity
// After all settlements, governance can sweep dust
function sweepDust(bytes32 debateId) external onlyGovernance {
    // Only after all winners have claimed or a timeout
    // Transfer remaining dust to governance/treasury
}
```

---

### SEC-002: Missing SafeERC20 -- Silent Transfer Failures

**Severity:** CRITICAL
**Location:** `DebateMarket.sol:259`, `DebateMarket.sol:323`, `DebateMarket.sol:399`, `DebateMarket.sol:487`, `DebateMarket.sol:506`
**Description:**

All five ERC-20 calls use raw `IERC20.transfer()` and `IERC20.transferFrom()` without checking return values:

```solidity
stakingToken.transferFrom(msg.sender, address(this), bondAmount);   // line 259
stakingToken.transferFrom(msg.sender, address(this), stakeAmount);  // line 323
stakingToken.transferFrom(msg.sender, address(this), stakeAmount);  // line 399
stakingToken.transfer(msg.sender, payout);                          // line 487
stakingToken.transfer(msg.sender, debate.proposerBond);             // line 506
```

The IERC20 interface declares `transfer` and `transferFrom` as returning `bool`, and Solidity >=0.8 will revert if the return data is shorter than expected (due to ABI decoding). This means tokens like USDT (which return no data) will cause reverts on Solidity >=0.8.19. However, some token implementations return `false` instead of reverting on failure. In that case:

- `transferFrom` could return `false`, the contract would proceed as if the transfer succeeded, and the user would get credited with stake they never actually deposited.
- `transfer` could return `false` during settlement, silently failing to pay out while marking the claim as completed (`record.claimed = true`).

The spec says "USDC on Scroll." USDC does return `bool` and reverts on failure, so this is acceptable for the current target. However, the `stakingToken` is `immutable` -- if a future deployment uses USDT or another non-standard token, the contract will be permanently broken.

**Suggested Fix:**

```solidity
import "openzeppelin/token/ERC20/utils/SafeERC20.sol";
using SafeERC20 for IERC20;

// Replace all instances:
stakingToken.safeTransferFrom(msg.sender, address(this), bondAmount);
stakingToken.safeTransfer(msg.sender, payout);
```

This costs ~200 gas per call and makes the contract safe for all ERC-20 tokens.

---

### SEC-003: Nullifier Scoped to actionDomain, Not debateId -- Cross-Debate Overwrites

**Severity:** CRITICAL
**Location:** `DebateMarket.sol:320-347` (submitArgument), `DebateMarket.sol:396-414` (coSignArgument)
**Description:**

The DebateMarket stores stake records keyed by `(debateId, nullifier)`:
```solidity
stakeRecords[debateId][nullifier] = StakeRecord({...});
```

However, the NullifierRegistry (called via DistrictGate) scopes nullifiers by `actionDomain`, not by `debateId`. The DistrictGate call at line 310-312 passes the `actionDomain` from `publicInputs[27]`, and the NullifierRegistry records `nullifierUsed[actionDomain][nullifier] = true`.

This means: **a nullifier can only participate once per actionDomain, across ALL debates sharing that domain.** If two debates share the same actionDomain (which is expected -- debates about housing policy would all use the same `keccak256("debate-housing-2026")` domain), a user who participates in Debate A cannot participate in Debate B.

Conversely, if each debate uses a unique actionDomain, the nullifier-per-domain check no longer prevents a single identity from using different nullifiers in different debates to double-participate within a topic.

The fundamental tension: the nullifier scoping model was designed for single-action voting, not for multiple debates within a topic.

**Attack Scenario:**
1. Alice submits an argument to Debate A with nullifier N under actionDomain D.
2. Alice tries to submit to Debate B (same actionDomain D). NullifierRegistry reverts: "NullifierAlreadyUsed."
3. Alice is locked out of all future debates in that domain after her first participation.

OR (if per-debate actionDomains are used):
1. Mallory creates multiple nullifiers (one per debate actionDomain) from the same identity.
2. Each debate has a unique actionDomain, so the NullifierRegistry allows all of them.
3. Mallory participates in each debate with a fresh nullifier, inflating `uniqueParticipants`.

**Suggested Fix:**
Use the `debateId` as part of the actionDomain to scope nullifiers per debate:

```solidity
// In submitArgument / coSignArgument:
bytes32 expectedActionDomain = keccak256(abi.encodePacked("debate-", debateId));
require(bytes32(publicInputs[27]) == expectedActionDomain, "Wrong action domain");
```

Or introduce a debate-scoped nullifier check within the DebateMarket contract itself, independent of the NullifierRegistry.

---

### SEC-004: Unbounded Iteration in resolveDebate -- Gas DOS

**Severity:** HIGH
**Location:** `DebateMarket.sol:436-442`
**Description:**

`resolveDebate()` iterates all arguments:

```solidity
for (uint256 i = 0; i < debate.argumentCount; i++) {
    uint256 score = arguments[debateId][i].weightedScore;
    if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
    }
}
```

Each iteration costs approximately 2,100 gas (cold SLOAD) + comparison overhead, roughly 2,500 gas per iteration. The Scroll L2 block gas limit is approximately 10M gas. After subtracting base transaction cost (~21,000) and other overhead (~50,000), resolution can handle approximately **3,900 arguments** before hitting the gas limit.

However, a targeted attacker can submit many low-stake arguments ($1 each) to push the count above this limit. At $1 per argument, 4,000 arguments cost $4,000 -- a feasible DOS for a high-stakes debate.

Note: The 60-second rate limit in NullifierRegistry means one identity can submit at most ~1 argument per minute. Over a 72-hour minimum debate, that is ~4,320 submissions per identity. But each requires a unique nullifier per the NullifierRegistry, so a single identity can only submit once per debate (per actionDomain). An attacker would need thousands of distinct verified identities, or the nullifier scoping issue from SEC-003 would need to be exploitable.

**Attack Scenario:**
An adversary with access to many verified identities (e.g., a Sybil-capable party if the verification system has weaknesses) submits thousands of minimum-stake arguments. Resolution becomes impossible.

**Suggested Fix:**
Add `MAX_ARGUMENTS` constant (e.g., 500):

```solidity
uint256 public constant MAX_ARGUMENTS = 500;

// In submitArgument:
if (debate.argumentCount >= MAX_ARGUMENTS) revert TooManyArguments();
```

Alternatively, use an off-chain resolution oracle pattern with on-chain dispute.

---

### SEC-005: claimSettlement Allows Anyone to Claim for Any Nullifier

**Severity:** HIGH
**Location:** `DebateMarket.sol:464-490`
**Description:**

`claimSettlement()` takes a `debateId` and `nullifier` as parameters. It does not verify that `msg.sender` is the entity that originally submitted the argument. Anyone can call `claimSettlement(debateId, nullifier)` and the payout goes to `msg.sender`:

```solidity
stakingToken.transfer(msg.sender, payout);
```

Since nullifiers are public (emitted in events, visible in transaction calldata), any observer can front-run a legitimate winner's settlement claim by extracting their nullifier and calling `claimSettlement` first. The payout goes to the front-runner, not the original staker.

**Attack Scenario:**
1. Debate resolves. Winner's nullifier N is publicly known from the `ArgumentSubmitted` event.
2. MEV bot sees winner's `claimSettlement(debateId, N)` transaction in the mempool.
3. Bot submits the same call with higher gas, receives the payout.

Even without mempool watching: anyone who observes the chain can claim for any nullifier at any time after resolution.

**Suggested Fix:**
Store the `msg.sender` who submitted each argument and require it matches during settlement:

```solidity
struct StakeRecord {
    uint256 argumentIndex;
    uint256 stakeAmount;
    uint8 engagementTier;
    bool claimed;
    address submitter;  // NEW: track who submitted
}

// In claimSettlement:
if (record.submitter != msg.sender) revert UnauthorizedClaimer();
```

Alternatively, if privacy is paramount (hiding the link between address and nullifier), implement a commit-reveal settlement scheme.

---

### SEC-006: Governance Can Pause to Block Settlement Indefinitely

**Severity:** HIGH
**Location:** `DebateMarket.sol:464-490`, `DebateMarket.sol:572-581`
**Description:**

All core functions including `claimSettlement()` and `claimProposerBond()` have the `whenNotPaused` modifier. If governance pauses the contract, all winners are locked out of their settlement payouts with no recourse.

Unlike DistrictGate's governance which is managed by `TimelockGovernance` with 7-day delays, DebateMarket's `governance` is a plain `immutable` address with no timelock for pause/unpause. This means:

1. Governance can pause immediately (no warning).
2. Governance can keep the contract paused forever.
3. Users' staked funds are locked with no escape hatch.

The `governance` address is `immutable`, so it cannot even be transferred to a more trustworthy entity.

**Suggested Fix:**
Either:
(a) Add a deadline-based emergency withdrawal that works even when paused:
```solidity
function emergencyWithdraw(bytes32 debateId, bytes32 nullifier) external nonReentrant {
    // Only available 30 days after debate deadline
    require(block.timestamp > debates[debateId].deadline + 30 days);
    // Return original stake only (no profit from losing pool)
    StakeRecord storage record = stakeRecords[debateId][nullifier];
    require(!record.claimed && record.stakeAmount > 0);
    record.claimed = true;
    stakingToken.transfer(msg.sender, record.stakeAmount);
}
```
(b) Inherit from `TimelockGovernance` like other contracts in the protocol.
(c) Make `governance` mutable with a timelock transfer mechanism.

---

### SEC-007: Forfeited Proposer Bonds Are Permanently Locked

**Severity:** HIGH
**Location:** `DebateMarket.sol:492-509`
**Description:**

When a debate has fewer than `BOND_RETURN_THRESHOLD` (5) unique participants, the proposer's bond is forfeited -- `claimProposerBond()` reverts with `InsufficientParticipation`. However, there is no alternative function to withdraw or redistribute the forfeited bond. The `DebateStatus.SETTLED` enum value is defined but never assigned, suggesting an incomplete settlement lifecycle.

These tokens are permanently locked in the contract. Over time, forfeited bonds accumulate as dead capital.

**Suggested Fix:**
Add a governance-callable function to sweep forfeited bonds to a treasury:

```solidity
function sweepForfeitedBond(bytes32 debateId) external onlyGovernance {
    Debate storage debate = debates[debateId];
    require(debate.status == DebateStatus.RESOLVED);
    require(debate.uniqueParticipants < BOND_RETURN_THRESHOLD);
    require(!debate.bondClaimed);

    debate.bondClaimed = true; // prevent double-sweep
    stakingToken.transfer(governance, debate.proposerBond);
}
```

Or redistribute forfeited bonds to winning stakers as a bonus.

---

### SEC-008: debateId Collision Overwrites Existing Debates

**Severity:** MEDIUM
**Location:** `DebateMarket.sol:262-264`
**Description:**

The debateId is computed as:
```solidity
debateId = keccak256(abi.encodePacked(propositionHash, actionDomain, block.timestamp, msg.sender));
```

If the same proposer submits the same proposition hash in the same action domain in the same block (same `block.timestamp`), the debateId will be identical. The second proposal silently overwrites the first debate's state, including resetting `argumentCount`, `totalStake`, and `deadline`.

The first debate's bond is still held by the contract, but the debate's `proposerBond` field now reflects the second proposal's bond amount. Arguments submitted to the first debate are orphaned.

**Attack Scenario:**
1. Proposer submits Debate A with 100 USDC bond in block N.
2. In the same block, a bundled transaction submits the same proposition again with 1 USDC bond.
3. Debate A's state is overwritten. The 100 USDC from the first bond is trapped.

**Suggested Fix:**
Check that the debate does not already exist:

```solidity
if (debates[debateId].deadline != 0) revert DebateAlreadyExists();
```

---

### SEC-009: Whale Dominance Despite sqrt Dampening

**Severity:** MEDIUM
**Location:** `DebateMarket.sol:326`
**Description:**

The weight formula is `sqrt(stake) * TIER_MULTIPLIER[tier]`. The spec claims "a Tier 4 Pillar at $2 outweighs a Tier 1 newcomer at $100." Let us verify the crossover point where a Tier 1 newcomer can outweigh a Tier 4 Pillar:

- Tier 4, $2: `sqrt(2e6) * 16 = 1414 * 16 = 22,624`
- Tier 1, $X: `sqrt(Xe6) * 2 = 22,624` => `sqrt(Xe6) = 11,312` => `Xe6 = 127,961,344` => `X = ~$128`
- So a Tier 1 newcomer needs ~$128 to match a Tier 4 at $2.

But for **co-signing**: a whale at Tier 1 can co-sign with a massive stake. Consider:
- Tier 1, $10,000: `sqrt(10000e6) * 2 = 100,000 * 2 = 200,000`
- This outweighs 8.8 Tier-4 Pillars at $2 each.

The sqrt dampening reduces but does not eliminate plutocratic advantage. A single Tier 1 whale with $10,000 has the voting power of ~8-9 dedicated community Pillars. At $100,000: `sqrt(100000e6) * 2 = 632,455 * 2 = 1,264,910`, equivalent to ~56 Pillars.

This may be acceptable by design, but the spec's framing ("anti-plutocracy") overstates the protection. The real defense is that accumulating $100K+ in a single debate is expensive and visible.

**Suggested Fix:**
Consider adding a stake cap per participant:

```solidity
uint256 public constant MAX_STAKE_PER_PARTICIPANT = 1000e6; // $1,000 cap
```

Or use `log2(stake)` instead of `sqrt(stake)` for stronger dampening.

---

### SEC-010: Zero Arguments Submitted -- resolveDebate Produces Invalid Winner

**Severity:** MEDIUM
**Location:** `DebateMarket.sol:427-459`
**Description:**

If no arguments are submitted before the deadline, `resolveDebate()` still succeeds. The loop runs 0 iterations, `bestIndex` remains 0, and `bestScore` remains 0. The contract then reads `arguments[debateId][0]`, which is an uninitialized Argument struct (all zeros). The debate is marked RESOLVED with:
- `winningArgumentIndex = 0`
- `winningStance = SUPPORT` (default enum value 0)
- `winningBodyHash = bytes32(0)`

This is a phantom winner with no actual argument. No one can claim settlement (no stake records exist), but the proposer bond is forfeited (0 participants < 5 threshold). The debate is in a logically invalid resolved state.

**Suggested Fix:**

```solidity
if (debate.argumentCount == 0) revert NoArgumentsSubmitted();
```

---

### SEC-011: Stake Record Overwrite on Same Nullifier in Same Debate

**Severity:** MEDIUM
**Location:** `DebateMarket.sol:342-347`, `DebateMarket.sol:409-414`
**Description:**

If a nullifier somehow passes the NullifierRegistry check (e.g., due to a different actionDomain scoping as described in SEC-003), the stake record is silently overwritten:

```solidity
stakeRecords[debateId][nullifier] = StakeRecord({
    argumentIndex: argumentIndex,
    stakeAmount: stakeAmount,
    engagementTier: engagementTier,
    claimed: false
});
```

The previous stake record is lost. The `debate.totalStake` and `argumentTotalStakes` are incremented for both submissions, but only the second stake record exists for settlement purposes. This creates an accounting mismatch: the contract holds tokens from both stakes, but only the second can be claimed.

**Suggested Fix:**
Add an explicit check:

```solidity
if (stakeRecords[debateId][nullifier].stakeAmount != 0) revert AlreadyStaked();
```

---

### SEC-012: DebateStillActive Error Name Misleading

**Severity:** MEDIUM
**Location:** `DebateMarket.sol:306`, `DebateMarket.sol:431`
**Description:**

At line 306, the error is used when `block.timestamp >= debate.deadline`:
```solidity
if (block.timestamp >= debate.deadline) revert DebateStillActive();
```

This fires when the debate has **expired** (past deadline), not when it is "still active." The semantic is inverted -- submitting after the deadline should revert with something like `DebateExpired` or `DebatePastDeadline`.

At line 431, the same error is used when `block.timestamp < debate.deadline`:
```solidity
if (block.timestamp < debate.deadline) revert DebateStillActive();
```

Here the name is correct. The reuse of the same error for opposite conditions is confusing and hinders debugging.

**Suggested Fix:**
Use a distinct error for deadline-past conditions:

```solidity
error DebateExpired();      // for submitArgument / coSignArgument
error DebateStillActive();  // for resolveDebate
```

---

### SEC-013: Debate.minAuthority Field Is Never Set

**Severity:** LOW
**Location:** `DebateMarket.sol:51`
**Description:**

The `Debate` struct has a `minAuthority` field (`uint8`) that is never written to by any function. It defaults to 0 for all debates. The authority check is performed by DistrictGate during proof verification, not by DebateMarket. This field is dead storage -- it wastes a storage slot (packed, but still adds confusion).

**Suggested Fix:**
Remove the field if unused, or implement per-debate authority enforcement.

---

### SEC-014: SETTLED Status Never Assigned

**Severity:** LOW
**Location:** `DebateMarket.sol:44`
**Description:**

`DebateStatus.SETTLED` is defined in the enum but never assigned anywhere in the contract. The lifecycle goes `ACTIVE -> RESOLVED` and stays there. This suggests an incomplete implementation of the settlement lifecycle. A debate should transition to SETTLED once all claims are processed (or after a timeout), which would enable cleanup of forfeited bonds.

**Suggested Fix:**
Either implement the transition to SETTLED (after all winners have claimed, or after a claim window expires), or remove the unused enum value.

---

### SEC-015: proposerBond Can Be Claimed Even If Proposer Staked On Winning Side

**Severity:** LOW
**Location:** `DebateMarket.sol:492-509`
**Description:**

The proposer bond return has no interaction with the settlement logic. A proposer can:
1. Propose a debate (bond deposited).
2. Submit an argument as a participant (additional stake deposited, if they have a valid nullifier).
3. Win the argument resolution.
4. Claim both the settlement payout AND the proposer bond return (if >= 5 participants).

This is not necessarily a vulnerability -- the proposer took on double risk (bond + stake). But the bond is meant to be a quality signal, not an additional profit mechanism. If the proposer can always recover the bond in a well-attended debate regardless of outcome, the bond's incentive to propose quality debates is weakened. The proposer gets the bond back even if their own argument loses.

**Suggested Fix:**
Consider tying bond return to the winning stance matching the proposition's intent, or simply document this as intended behavior.

---

### SEC-016: Front-Running on Argument Submission

**Severity:** LOW
**Location:** `DebateMarket.sol:290-355`
**Description:**

MEV bots can observe pending `submitArgument` transactions in the mempool and:
1. See the `bodyHash` (argument content hash) before it lands.
2. Submit a copy of the same argument with a different nullifier and higher gas to get priority.

The original author's argument would still be accepted (different nullifier = different argument index), but the front-runner would capture the "first mover" position. Given that ties go to the lower index (line 438: `if (score > bestScore)` uses strict `>`), this gives a slight advantage to earlier submission.

On Scroll L2, this is less severe than on L1 Ethereum because Scroll uses a centralized sequencer that does not expose a public mempool. However, the sequencer operator itself could theoretically exploit this.

**Suggested Fix:**
Use a commit-reveal scheme for argument submission if front-running is a concern. Otherwise, document the sequencer trust assumption.

---

### SEC-017: No Maximum Bond Size

**Severity:** LOW
**Location:** `DebateMarket.sol:247-276`
**Description:**

There is a `MIN_PROPOSER_BOND` but no maximum. A griefing proposer can bond an extremely large amount (e.g., $1M USDC) to create a debate, then rely on `uniqueParticipants < 5` to forfeit the bond. While this does not directly harm other users, it locks the attacker's own funds and creates a large amount of permanently locked tokens (per SEC-007). If combined with a mechanism to accidentally bloat contract balance, this could cause accounting confusion.

**Suggested Fix:**
Add `MAX_PROPOSER_BOND` if desired, or document that self-inflicted bond forfeiture is by design.

---

## Invariant Analysis

| # | Invariant | Status | Notes |
|---|-----------|--------|-------|
| I-1 | `contract.balance >= sum(all active debate totalStakes) + sum(all unclaimed proposer bonds)` | **UPHELD (with dust)** | Integer division rounding in settlement means the contract retains small dust amounts. Proposer bonds from forfeited debates accumulate permanently (SEC-007). |
| I-2 | `sum(all winner payouts) <= totalStake` for any debate | **UPHELD** | `payout = stake + (losingPool * stake) / winningArgStake`. Sum over all winners: `winningArgStake + sum((losingPool * stake_i) / winningArgStake)`. Due to integer rounding down, this is `<= winningArgStake + losingPool = totalStake`. |
| I-3 | Each nullifier can stake at most once per debate | **WEAKLY UPHELD** | Depends on NullifierRegistry enforcement via DistrictGate. If actionDomain scoping matches (SEC-003), this holds. If actionDomain mismatches, the stake record is overwritten (SEC-011). |
| I-4 | Only ACTIVE debates accept arguments | **UPHELD** | `submitArgument` and `coSignArgument` check `debate.status == DebateStatus.ACTIVE`. |
| I-5 | Only RESOLVED debates allow settlement | **UPHELD** | `claimSettlement` and `claimProposerBond` check `debate.status == DebateStatus.RESOLVED`. |
| I-6 | A debate can only be resolved once | **UPHELD** | `resolveDebate` checks `debate.status == DebateStatus.ACTIVE` and sets it to `RESOLVED`. Second call fails. |
| I-7 | Each stake record can be claimed at most once | **UPHELD** | `record.claimed` is checked and set before transfer. |
| I-8 | Proposer bond can be claimed at most once | **UPHELD** | `debate.bondClaimed` is checked and set before transfer. |
| I-9 | No state changes occur after external calls (CEI pattern) | **VIOLATED** | See SEC-018 below -- while `nonReentrant` prevents reentrant exploitation, transfers in `proposeDebate` (line 259) occur before debate state is written (lines 266-274). |
| I-10 | Debate IDs are unique | **NOT UPHELD** | Same proposer + same proposition + same block = collision (SEC-008). |

---

## Token Flow Analysis

### Tokens Enter the Contract

| Path | Function | Source | Amount | Line |
|------|----------|--------|--------|------|
| Proposer bond | `proposeDebate()` | `msg.sender` | `bondAmount` (>= 1 USDC) | 259 |
| Argument stake | `submitArgument()` | `msg.sender` | `stakeAmount` (>= 1 USDC) | 323 |
| Co-sign stake | `coSignArgument()` | `msg.sender` | `stakeAmount` (>= 1 USDC) | 399 |

### Tokens Leave the Contract

| Path | Function | Destination | Amount | Line |
|------|----------|-------------|--------|------|
| Winner settlement | `claimSettlement()` | `msg.sender` | `stake + (losingPool * stake / winningArgStake)` | 487 |
| Proposer bond return | `claimProposerBond()` | `msg.sender` (must be proposer) | `debate.proposerBond` | 506 |

### Tokens Permanently Locked

| Scenario | Amount |
|----------|--------|
| Forfeited proposer bond (< 5 participants) | `debate.proposerBond` |
| Rounding dust per debate | up to `(winnerCount - 1)` wei per debate |
| Losing stakers' funds when no winner claims | Accumulates indefinitely |

### Tokens Never Recoverable

There is no `sweep`, `rescue`, `emergencyWithdraw`, or `selfdestruct` function. Any tokens sent directly to the contract (outside of `proposeDebate`/`submitArgument`/`coSignArgument`) are permanently locked. Forfeited bonds have no withdrawal path.

---

## Test Coverage Gaps

The test file (1470 lines) covers the happy path thoroughly but has notable gaps:

1. **No test for zero-argument resolution** (SEC-010).
2. **No test for debateId collision** (SEC-008).
3. **No test for settlement accounting integrity** -- no test verifies that `sum(all payouts) <= totalStake` across multiple winners.
4. **No test for single-winner-takes-all** (only one argument on the winning side, losingPool > 0).
5. **No test for multiple co-signers claiming settlement** -- the test file only has one winner claiming.
6. **No test for front-running `claimSettlement`** by a non-staker (SEC-005).
7. **No test for governance pause blocking settlement** (SEC-006).
8. **No test for large argument counts** approaching gas limits (SEC-004).
9. **No fuzz tests** for the sqrt function or settlement math.
10. **MockDistrictGate does not enforce actionDomain consistency** with debateId, making it impossible to test SEC-003.

---

## Supplemental Note: Check-Effects-Interactions (SEC-018)

**Severity:** LOW (mitigated by ReentrancyGuard)
**Location:** `DebateMarket.sol:259` (proposeDebate), `DebateMarket.sol:323` (submitArgument), `DebateMarket.sol:399` (coSignArgument)

In `proposeDebate()`, the ERC-20 `transferFrom` (an external call) occurs at line 259, before the debate state is written at lines 266-274. Similarly, in `submitArgument()` and `coSignArgument()`, `transferFrom` occurs before state updates.

The `nonReentrant` guard prevents exploitation, but this still violates the CEI pattern. If `ReentrancyGuard` were ever removed (e.g., during a refactor to save gas), these would become exploitable.

**Suggested Fix:**
Move all `transferFrom` calls after state updates.

---

## Summary Table

| ID | Severity | Title |
|----|----------|-------|
| SEC-001 | CRITICAL | Settlement insolvency -- proposer bond shares balance pool |
| SEC-002 | CRITICAL | Missing SafeERC20 -- silent transfer failures |
| SEC-003 | CRITICAL | Nullifier scoped to actionDomain, not debateId |
| SEC-004 | HIGH | Unbounded iteration in resolveDebate -- gas DOS |
| SEC-005 | HIGH | claimSettlement allows anyone to claim for any nullifier |
| SEC-006 | HIGH | Governance can pause to block settlement indefinitely |
| SEC-007 | HIGH | Forfeited proposer bonds permanently locked |
| SEC-008 | MEDIUM | debateId collision overwrites existing debates |
| SEC-009 | MEDIUM | Whale dominance despite sqrt dampening |
| SEC-010 | MEDIUM | Zero arguments -- resolveDebate produces phantom winner |
| SEC-011 | MEDIUM | Stake record overwrite on same nullifier |
| SEC-012 | MEDIUM | DebateStillActive error name semantically inverted |
| SEC-013 | LOW | Debate.minAuthority field never set |
| SEC-014 | LOW | SETTLED status never assigned |
| SEC-015 | LOW | Proposer can claim bond regardless of debate outcome |
| SEC-016 | LOW | Front-running on argument submission |
| SEC-017 | LOW | No maximum bond size |
| SEC-018 | LOW | CEI pattern violated (mitigated by ReentrancyGuard) |

---

*End of Wave 42R Security Review.*
