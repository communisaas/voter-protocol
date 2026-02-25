# Wave 42R Integration Review: DebateMarket.sol

**Reviewer**: Integration Expert
**Date**: 2026-02-22
**Scope**: `contracts/src/DebateMarket.sol` (622 lines), `contracts/test/DebateMarket.t.sol` (1470 lines)
**Status**: REVIEW COMPLETE

---

## Summary

DebateMarket.sol introduces a staked debate protocol composing with DistrictGate (three-tree ZK proof verification), NullifierRegistry (double-stake prevention), and an ERC-20 staking token. This review performs adversarial cross-referencing of interface compatibility, public input layout agreement, ERC-20 safety, action domain lifecycle, mock fidelity, and compilation compatibility.

**Findings**: 3 CRITICAL, 3 HIGH, 5 MEDIUM, 4 LOW

---

## Findings

### INT-001: CRITICAL -- Unchecked ERC-20 transfer/transferFrom return values

**Location**: `contracts/src/DebateMarket.sol:259`, `323`, `399`, `487`, `506`

**Description**: DebateMarket calls `stakingToken.transferFrom()` and `stakingToken.transfer()` without checking the boolean return value. The IERC20 standard specifies that `transfer` and `transferFrom` return `bool`, and some ERC-20 tokens (notably USDT on Ethereum) do NOT revert on failure -- they return `false` instead. Since the contract targets USDC on Scroll (line 92), and USDC is known to return `bool` properly, this is not an immediate exploit on the stated target chain. However, if the staking token is ever changed, or if a future USDC upgrade changes behavior, funds could be silently lost.

The `MockERC20` in tests always returns `true`, hiding this class of bug entirely.

**Code at issue**:
```solidity
// Line 259 - no return value check
stakingToken.transferFrom(msg.sender, address(this), bondAmount);

// Line 487 - no return value check
stakingToken.transfer(msg.sender, payout);
```

**Suggested fix**: Use OpenZeppelin's `SafeERC20` library, which is already available in the project at `lib/openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol`:

```solidity
import "openzeppelin/token/ERC20/utils/SafeERC20.sol";

contract DebateMarket is Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Then replace all calls:
    stakingToken.safeTransferFrom(msg.sender, address(this), bondAmount);
    stakingToken.safeTransfer(msg.sender, payout);
}
```

---

### INT-002: CRITICAL -- Reused error name `DebateStillActive` has inverted semantics

**Location**: `contracts/src/DebateMarket.sol:184`, `306`, `381`, `431`

**Description**: The error `DebateStillActive()` is used with two contradictory meanings:

1. **Lines 306, 381** (`submitArgument` / `coSignArgument`): `if (block.timestamp >= debate.deadline) revert DebateStillActive()` -- This reverts when the debate has ENDED. The error name says "still active" but the condition means "deadline passed." A user seeing this revert would think the debate is still running, when in fact it has expired. The correct error here should be something like `DebateExpired()` or `DebateDeadlinePassed()`.

2. **Line 431** (`resolveDebate`): `if (block.timestamp < debate.deadline) revert DebateStillActive()` -- This usage is correct: it reverts because the debate is still active and cannot be resolved yet.

This is a semantic bug that will cause confusion in frontend integrations and monitoring. Any off-chain system catching `DebateStillActive` cannot distinguish "too early to resolve" from "too late to submit."

The test file at `contracts/test/DebateMarket.t.sol:427` also uses the semantically wrong error:
```solidity
function test_RevertWhen_DebateExpired() public {
    // ...
    vm.expectRevert(DebateMarket.DebateStillActive.selector);
    // ^ This test says "debate expired" but expects "DebateStillActive"
```

**Suggested fix**: Add a distinct error for the deadline-passed case:
```solidity
error DebateExpired();

// Lines 306, 381:
if (block.timestamp >= debate.deadline) revert DebateExpired();

// Line 431 (keep as is):
if (block.timestamp < debate.deadline) revert DebateStillActive();
```

---

### INT-003: CRITICAL -- Settlement allows anyone to claim on behalf of any winner (no ZK proof required for claim)

**Location**: `contracts/src/DebateMarket.sol:464-490`

**Description**: The `claimSettlement(debateId, nullifier)` function allows ANY `msg.sender` to call it with ANY nullifier. The payout is sent to `msg.sender` (line 487), not to the original staker. This creates a race condition:

1. Alice submits an argument with nullifier N, staking 10 USDC.
2. The debate resolves. Alice is on the winning side.
3. Bob (an MEV searcher or anyone) calls `claimSettlement(debateId, N)` and receives Alice's payout.

The nullifier is public (emitted in events from DistrictGate, and visible in calldata), so anyone can extract it. There is no verification that the caller has any relationship to the nullifier.

This is architecturally difficult to fix without breaking anonymity (the whole point of ZK nullifiers is that you cannot link nullifier to identity). Two possible approaches:

**Option A -- Require a fresh ZK proof for claim** (preserves anonymity but adds gas cost):
```solidity
function claimSettlement(
    bytes32 debateId,
    address signer,
    bytes calldata proof,
    uint256[31] calldata publicInputs,
    uint8 verifierDepth,
    uint256 deadline,
    bytes calldata signature
) external whenNotPaused nonReentrant {
    // Verify proof, extract nullifier from publicInputs[26]
    // Use a separate action domain for "claim" to prevent nullifier reuse conflicts
    bytes32 nullifier = bytes32(publicInputs[26]);
    // ... verify and pay msg.sender
}
```

**Option B -- Record msg.sender at stake time and pay to the same address** (simpler but reduces privacy):
```solidity
struct StakeRecord {
    uint256 argumentIndex;
    uint256 stakeAmount;
    uint8 engagementTier;
    bool claimed;
    address staker;  // NEW: record who staked
}
// In claimSettlement:
stakingToken.transfer(record.staker, payout);
```

**Option C -- Accept the risk with documentation**: If the design intent is that anyone who knows the nullifier can claim (e.g., the staker shares it with a relayer), document this explicitly and note the MEV risk.

---

### INT-004: HIGH -- MockDistrictGate does not enforce action domain validation

**Location**: `contracts/test/DebateMarket.t.sol:1412-1425`

**Description**: The real `DistrictGate.verifyThreeTreeProof()` performs extensive validation inside the function body:
- Validates `actionDomain` from `publicInputs[27]` against `allowedActionDomains` whitelist (line 1018 of DistrictGate.sol)
- Validates user root, cell map root, engagement root against their respective registries
- Enforces minimum authority level per action domain
- Cross-checks country between trees
- Validates verifier depth matches registry metadata

The `MockDistrictGate` in the test skips ALL of these checks. It only records the nullifier. This means DebateMarket tests pass even when:
- The action domain in `publicInputs[27]` does not match the debate's `actionDomain`
- Authority level is out of range
- Engagement root is invalid

While DebateMarket.sol does check `districtGate.allowedActionDomains(actionDomain)` in `proposeDebate` (line 256), it does NOT validate that the `actionDomain` in the public inputs (index 27) matches the debate's stored `actionDomain`. The mock hides this gap.

**Suggested fix**: Add action domain cross-check in `submitArgument` and `coSignArgument`:
```solidity
bytes32 proofActionDomain = bytes32(publicInputs[27]);
if (proofActionDomain != debate.actionDomain) revert ActionDomainMismatch();
```

And update MockDistrictGate to validate action domain:
```solidity
function verifyThreeTreeProof(
    address,
    bytes calldata,
    uint256[31] calldata publicInputs,
    uint8,
    uint256,
    bytes calldata
) external {
    bytes32 nullifier = bytes32(publicInputs[26]);
    bytes32 actionDomain = bytes32(publicInputs[27]);
    bytes32 userRoot = bytes32(publicInputs[0]);

    // Validate action domain like real DistrictGate does
    require(allowedActionDomains[actionDomain], "MockDistrictGate: domain not allowed");

    nullifierRegistry.recordNullifier(actionDomain, nullifier, userRoot);
}
```

---

### INT-005: HIGH -- Missing cross-check between proof's action domain and debate's action domain

**Location**: `contracts/src/DebateMarket.sol:310-312`, `386-388`

**Description**: This is the contract-level counterpart to INT-004. When `submitArgument` or `coSignArgument` is called, the contract calls `districtGate.verifyThreeTreeProof(...)` which verifies the ZK proof and records the nullifier using `publicInputs[27]` (the action domain in the proof) as the nullifier scope.

However, DebateMarket never checks that `publicInputs[27]` matches `debate.actionDomain`. A user could submit a valid three-tree proof for action domain X (already registered on DistrictGate) and use it to participate in a debate that was created under action domain Y. The nullifier would be scoped to domain X (by DistrictGate), so double-stake prevention would be against domain X -- not domain Y. This means:

1. A user could participate in debate Y multiple times by using different action domain proofs
2. The nullifier scoping is misaligned with the debate's intended scope

**Suggested fix**: Add this check after the `verifyThreeTreeProof` call in both `submitArgument` and `coSignArgument`:
```solidity
// After line 312 / 388:
if (bytes32(publicInputs[27]) != debate.actionDomain) revert ActionDomainMismatch();
```

---

### INT-006: HIGH -- Stake record silently overwritten on co-sign with same nullifier in different debate

**Location**: `contracts/src/DebateMarket.sol:342`, `409`

**Description**: The `stakeRecords` mapping is keyed by `(debateId, nullifier)`. When `submitArgument` (line 342) or `coSignArgument` (line 409) stores a `StakeRecord`, it directly overwrites any existing record at that key. While the NullifierRegistry prevents the same nullifier from being used twice within the same action domain (enforced by DistrictGate), if for any reason a nullifier could be reused (different action domain in the proof due to INT-005, or a future change), the previous stake record would be silently lost, and the user would lose their funds.

Even without INT-005, there is no explicit guard in DebateMarket itself against overwriting. A defense-in-depth `require` would be prudent:

```solidity
// Before line 342 / 409:
if (stakeRecords[debateId][nullifier].stakeAmount != 0) revert DuplicateNullifier();
```

---

### INT-007: MEDIUM -- IDistrictGate interface matches but lacks important context

**Location**: `contracts/src/DebateMarket.sol:605-616`

**Description**: The `IDistrictGate` minimal interface declared at the bottom of DebateMarket.sol correctly matches the real DistrictGate's function signatures:

- `verifyThreeTreeProof(address signer, bytes calldata proof, uint256[31] calldata publicInputs, uint8 verifierDepth, uint256 deadline, bytes calldata signature) external` -- **MATCHES** DistrictGate.sol line 954-961
- `allowedActionDomains(bytes32) external view returns (bool)` -- **MATCHES** DistrictGate.sol line 108 (auto-generated getter for `mapping(bytes32 => bool) public allowedActionDomains`)

The interface is compatible. No issues with function selectors.

**Note**: The real `verifyThreeTreeProof` has `whenNotPaused nonReentrant` modifiers, so it can revert with "Pausable: paused" -- DebateMarket does not have specific handling for this case (which is fine; it will bubble up).

---

### INT-008: MEDIUM -- INullifierRegistry interface is declared but never called

**Location**: `contracts/src/DebateMarket.sol:618-621`

**Description**: DebateMarket declares `INullifierRegistry` with `nullifierUsed(bytes32, bytes32)` and `actionParticipantCount(bytes32)`, and stores the address as `nullifierRegistry` (line 89). However, DebateMarket NEVER calls any function on `nullifierRegistry`. All nullifier management happens inside `DistrictGate.verifyThreeTreeProof()`, which internally calls `nullifierRegistry.recordNullifier()`.

The interface and storage slot are dead code. The constructor accepts `_nullifierRegistry` (line 222) and validates it (line 226), but the resulting `nullifierRegistry` immutable is never read after construction.

This is not a bug per se -- it suggests the architecture was designed to optionally query nullifier state from DebateMarket, but that path was never implemented. However, the dead storage wastes a constructor parameter and could mislead future developers.

**Suggested action**: Either:
- Remove `INullifierRegistry`, the `nullifierRegistry` immutable, and the constructor parameter
- Or add view functions that use it (e.g., for frontend queries about nullifier state)

---

### INT-009: MEDIUM -- Public input layout agreement is CORRECT

**Location**: `contracts/src/DebateMarket.sol:315-320`

**Description**: Cross-referencing with DistrictGate.sol (lines 207-209 and 942-950):

| Index | Field | DistrictGate | DebateMarket | Match? |
|-------|-------|-------------|-------------|--------|
| [0] | user_root | Yes (line 995) | Not read | N/A |
| [1] | cell_map_root | Yes (line 996) | Not read | N/A |
| [2-25] | districts[24] | Yes (comments) | Not read | N/A |
| [26] | nullifier | Yes (line 997) | Yes (line 320) | CORRECT |
| [27] | action_domain | Yes (line 998) | Not read (should be! see INT-005) | CORRECT index |
| [28] | authority_level | Yes (line 999) | Not read | N/A |
| [29] | engagement_root | Yes (line 1000) | Not read | N/A |
| [30] | engagement_tier | Yes (line 1001) | Yes (line 315) | CORRECT |

The indices `publicInputs[26]` for nullifier and `publicInputs[30]` for engagement tier are correct and match the DistrictGate layout exactly.

---

### INT-010: MEDIUM -- Test helper `_makePublicInputs` does not populate authority level correctly for DistrictGate validation

**Location**: `contracts/test/DebateMarket.t.sol:1298-1307`

**Description**: The test helper builds public inputs with `inputs[28] = uint256(3)` (authority level = 3). In the real DistrictGate, authority level is bounds-checked (`require(authorityRaw >= 1 && authorityRaw <= 5)`). This is fine for the mock, but the test never exercises edge cases around authority level (0, 6, etc.) because the mock does not enforce it.

More importantly, the test helper sets `inputs[29] = uint256(bytes32(uint256(0xCCCC1111)))` as a fixed "engagementRoot" value. This root value does not match what would be validated by a real EngagementRootRegistry. The mock hides this entirely.

**Suggested fix**: Add a comment acknowledging the mock limitations and consider adding a test that uses a more realistic MockDistrictGate that validates engagement tier bounds (since DebateMarket reads tier from public inputs and uses it for scoring).

---

### INT-011: MEDIUM -- resolveDebate with zero arguments sets winning index to 0 with no arguments

**Location**: `contracts/src/DebateMarket.sol:427-458`

**Description**: If a debate is proposed and no arguments are submitted before the deadline, `resolveDebate` will succeed with `bestIndex = 0`, `bestScore = 0`, and the winning argument will reference `arguments[debateId][0]` which is an uninitialized struct. The `status` will be set to `RESOLVED` with all zero values for winning fields.

This is an edge case that allows resolution of debates with no participation, resulting in a `RESOLVED` debate where:
- `winningArgumentIndex = 0` (uninitialized slot)
- `winningStance = SUPPORT` (default enum value 0)
- No one can claim settlement (no stake records exist)
- Proposer bond is permanently locked (uniqueParticipants = 0 < BOND_RETURN_THRESHOLD)

The bond being locked may be intentional (punishment for proposing a debate no one cares about), but the resolution producing nonsensical winning data is misleading.

**Suggested fix**: Add a minimum argument count check:
```solidity
if (debate.argumentCount == 0) revert InsufficientParticipation();
```

---

### INT-012: LOW -- NullifierRegistry rate limit (60s) enforced in tests via `vm.warp(block.timestamp + 61)`

**Location**: `contracts/test/DebateMarket.t.sol:226,244,512,555,599,etc.`

**Description**: The tests correctly account for NullifierRegistry's 60-second rate limit by warping 61 seconds between submissions. This is good -- it means the test author understood the rate limit constraint. However, the pattern is scattered across every multi-submission test without any named constant explaining WHY the warp is needed.

**Suggested fix**: Add a comment or constant:
```solidity
/// @dev NullifierRegistry enforces a 60-second rate limit between submissions
///      for the same nullifier across actions. vm.warp(+61) advances past this.
uint256 public constant RATE_LIMIT_BUFFER = 61;
```

---

### INT-013: LOW -- Test file imports NullifierRegistry but only uses it in setUp

**Location**: `contracts/test/DebateMarket.t.sol:6`

**Description**: `import "../src/NullifierRegistry.sol"` is used in the test file. It is referenced for deploying the real NullifierRegistry in setUp (line 111), and MockDistrictGate uses the real NullifierRegistry type. This is correct and necessary -- not an issue, just a note for completeness.

---

### INT-014: LOW -- Pragma and compilation compatibility confirmed

**Location**: `contracts/src/DebateMarket.sol:2`, `contracts/foundry.toml:9`

**Description**: DebateMarket uses `pragma solidity >=0.8.19` and foundry.toml specifies `solc_version = "0.8.28"`. This is compatible. The contract imports:
- `openzeppelin/security/Pausable.sol` -- remapped via `openzeppelin/=contracts/` in the OZ lib
- `openzeppelin/security/ReentrancyGuard.sol` -- same remapping
- `openzeppelin/token/ERC20/IERC20.sol` -- same remapping

All three imports are available in the installed OpenZeppelin contracts at `lib/openzeppelin-contracts/contracts/`. The `via_ir = true` setting is required for DistrictGate's stack depth and will also apply to DebateMarket -- this should compile fine.

No import path issues detected.

---

### INT-015: LOW -- Test patterns partially follow established patterns from DistrictGate.ThreeTree.t.sol

**Location**: `contracts/test/DebateMarket.t.sol` (entire file)

**Description**: Comparison of test patterns:

| Pattern | ThreeTree.t.sol | DebateMarket.t.sol | Match? |
|---------|----------------|-------------------|--------|
| setUp deploys real NullifierRegistry | Yes | Yes | MATCH |
| 7-day timelock for caller auth | Yes (lines 128-130) | Yes (lines 117-120) | MATCH |
| Mock verifier pattern | MockThreeTreeVerifier (pass/fail) | MockDistrictGate (pass only) | PARTIAL |
| EIP-712 signature generation | Full helper with vm.sign | Not used (mock skips sig) | DIVERGENCE |
| Event emission assertions | vm.expectEmit with full params | Sparse (used in propose test) | PARTIAL |
| Named test sections | Numbered sections (1-14) | Numbered sections (1-14) | MATCH |
| Rate limit awareness | vm.warp(+61 seconds) | vm.warp(+61) | MATCH |

The main divergence is that DebateMarket tests don't test EIP-712 signatures because they go through a mock. This is acceptable since DistrictGate.ThreeTree.t.sol already covers signature validation exhaustively, and DebateMarket delegates to DistrictGate.

The MockDistrictGate only simulates the "pass" case. There is no way to test what happens when `verifyThreeTreeProof` reverts in the real DistrictGate (e.g., invalid proof, expired signature). A configurable mock (like ThreeTree.t.sol's `MockThreeTreeVerifier` with `shouldPass`) would be more thorough.

---

## Action Domain Lifecycle Analysis (Review Item 4)

DebateMarket calls `districtGate.allowedActionDomains(actionDomain)` in `proposeDebate` (line 256). This checks the real DistrictGate's whitelist, which requires a 7-day timelock for domain registration (via `proposeActionDomain` + `executeActionDomain`). This correctly delegates the timelock enforcement to DistrictGate -- DebateMarket does not need its own timelock.

However, there is a subtle issue: the check happens only at proposal time, not at argument submission time. If a domain is revoked (via `revokeActionDomain`, which is immediate) between debate proposal and argument submission, the debate continues accepting arguments even though the domain is no longer valid on DistrictGate. The real DistrictGate would still reject the proofs (it checks `allowedActionDomains` inside `verifyThreeTreeProof`), so this is not a vulnerability -- but DebateMarket would give a confusing error (proof verification failure rather than a clear "domain revoked" message).

---

## INullifierRegistry Compatibility Analysis (Review Item 2)

The `INullifierRegistry` interface in DebateMarket declares:
```solidity
function nullifierUsed(bytes32, bytes32) external view returns (bool);
function actionParticipantCount(bytes32) external view returns (uint256);
```

The real NullifierRegistry has:
- `mapping(bytes32 => mapping(bytes32 => bool)) public nullifierUsed;` -- auto-generated getter matches `nullifierUsed(bytes32, bytes32) returns (bool)` -- **COMPATIBLE**
- `mapping(bytes32 => uint256) public actionParticipantCount;` -- auto-generated getter matches `actionParticipantCount(bytes32) returns (uint256)` -- **COMPATIBLE**

The interface is correct. However, as noted in INT-008, it is never actually called.

The observation that "nullifier recording happens INSIDE DistrictGate.verifyThreeTreeProof()" is correct. DistrictGate calls `nullifierRegistry.recordNullifier(actionDomain, nullifier, userRoot)` at line 1066, which requires DistrictGate to be an authorized caller on NullifierRegistry.

---

## Severity Summary

| Severity | Count | Finding IDs |
|----------|-------|-------------|
| CRITICAL | 3 | INT-001, INT-002, INT-003 |
| HIGH | 3 | INT-004, INT-005, INT-006 |
| MEDIUM | 5 | INT-007, INT-008, INT-009, INT-010, INT-011 |
| LOW | 4 | INT-012, INT-013, INT-014, INT-015 |

## Recommendation

**Do not merge without addressing CRITICAL and HIGH findings.** Specifically:

1. **INT-001**: Switch to SafeERC20 -- straightforward, low-risk change
2. **INT-002**: Rename the error for the deadline-passed case -- straightforward
3. **INT-003**: Decide on a claim authorization model and document the decision
4. **INT-005**: Add action domain cross-check between proof and debate -- essential
5. **INT-006**: Add duplicate nullifier guard in DebateMarket (defense in depth)
6. **INT-004**: Update MockDistrictGate to validate action domain

MEDIUM findings (INT-008, INT-010, INT-011) should be addressed before mainnet deployment but do not block test-net deployment.
