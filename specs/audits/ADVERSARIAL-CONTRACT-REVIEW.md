# Adversarial Contract Security Review

## Overview

**Scope:** DistrictGateV2, DistrictRegistry, NullifierRegistry, CampaignRegistry, VerifierRegistry
**Review Date:** 2026-02-01
**Solidity Version:** 0.8.19
**Auditor Type:** Governance Attack Specialist

---

## Executive Summary

The voter-protocol contracts implement a multi-depth ZK proof verification system for district-based voting with nullifier-based double-vote prevention. The architecture is generally sound with appropriate use of timelocks, but several medium-severity issues warrant attention before mainnet deployment.

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 1 |
| Medium | 5 |
| Low | 4 |
| Informational | 3 |

---

## Findings

### HIGH-001: Root Deactivation During Active Voting Can Invalidate Legitimate Votes

**Severity:** High
**Contract:** DistrictRegistry.sol
**Location:** Lines 357-390 (`initiateRootDeactivation`, `executeRootDeactivation`)

#### Description

When `deactivateRoot()` is called (via the two-phase timelock process), the `isValidRoot()` check will fail for that district root. However, **DistrictGateV2 does NOT check `isValidRoot()`** - it only calls `getCountryAndDepth()` which returns data even for deactivated roots.

```solidity
// DistrictGateV2.sol line 236
(bytes3 actualCountry, uint8 depth) = districtRegistry.getCountryAndDepth(districtRoot);
if (actualCountry == bytes3(0)) revert DistrictNotRegistered();
```

The `getCountryAndDepth()` function returns metadata regardless of `isActive` status:

```solidity
// DistrictRegistry.sol line 281-288
function getCountryAndDepth(bytes32 districtRoot)
    external view returns (bytes3 country, uint8 depth)
{
    DistrictMetadata memory metadata = districts[districtRoot];
    return (metadata.country, metadata.depth);  // No isActive check!
}
```

**Impact:**
- Deactivated roots can still be used for proof verification
- The `isValidRoot()` function exists but is never called by DistrictGateV2
- Root deactivation has NO EFFECT on voting capability

**Attack Scenario:**
1. Governance initiates root deactivation for compromised district data
2. 7-day timelock passes, root is deactivated (`isActive = false`)
3. Attacker can still submit valid proofs using the "deactivated" root
4. Malicious proofs continue to be accepted

**Gas Cost:** N/A (logic bug, not gas attack)

**Recommendation:**
```solidity
// DistrictGateV2.sol - Add isValidRoot check
(bytes3 actualCountry, uint8 depth) = districtRegistry.getCountryAndDepth(districtRoot);
if (actualCountry == bytes3(0)) revert DistrictNotRegistered();
if (!districtRegistry.isValidRoot(districtRoot)) revert RootDeactivated();
```

---

### MED-001: Nullifier Front-Running Can Grief Legitimate Voters

**Severity:** Medium
**Contract:** NullifierRegistry.sol, DistrictGateV2.sol
**Location:** Lines 92-121 (`recordNullifier`)

#### Description

The nullifier is a ZK circuit output: `H(user_secret, action_id, authority_hash, epoch_id)`. While the nullifier itself cannot be forged without the user's secret, the **mempool visibility** creates a griefing vector:

1. Victim broadcasts transaction with valid proof + nullifier
2. Attacker extracts nullifier from mempool
3. Attacker cannot reuse the proof (verifier would fail without valid ZK proof)
4. BUT: Attacker can front-run with a **different valid proof** for the same action

The rate limit (60 seconds between actions per nullifier) does NOT prevent this because:
- The attacker uses their OWN nullifier
- The victim's transaction still processes, BUT if the attacker's goal is ordering manipulation (e.g., "first 100 voters get X"), they succeed

**Impact:**
- Ordering-dependent rewards can be manipulated
- High-value actions become targets for MEV extraction
- Legitimate early voters may lose priority benefits

**Attack Scenario:**
1. Campaign offers "first 1000 participants get NFT rewards"
2. Victim submits proof at block N
3. MEV bot sees victim's tx, submits own proof with higher gas
4. Bot gets slot 999, victim gets slot 1000+
5. Bot sells slot/NFT advantage

**Gas Cost:** ~300k gas per front-run proof verification

**Recommendation:**
- Implement commit-reveal scheme for ordering-sensitive actions
- Add `minBlockDelay` for ordering-dependent rewards
- Consider private mempool (Flashbots Protect) integration guidance

---

### MED-002: Malicious ActionDomain Registration After Timelock

**Severity:** Medium
**Contract:** DistrictGateV2.sol
**Location:** Lines 373-407 (`proposeActionDomain`, `executeActionDomain`)

#### Description

The 7-day timelock for actionDomain registration provides visibility but does NOT prevent a compromised governance key from registering arbitrary domains. The only mitigation is community monitoring.

**Specific Attack:**
```solidity
// Attacker (compromised governance) proposes suspicious domain
function proposeActionDomain(bytes32 actionDomain) external onlyGovernance {
    pendingActionDomains[actionDomain] = block.timestamp + ACTION_DOMAIN_TIMELOCK;
    // ...
}
```

If an attacker registers a malicious actionDomain that collides with:
1. Future legitimate actions (DoS)
2. Previously used nullifier spaces (enables replay in new context)

**Impact:**
- Governance compromise allows registering domains that can cause:
  - Nullifier space pollution
  - DoS against future legitimate campaigns
  - Confusion in nullifier-to-action attribution

**Attack Scenario:**
1. Attacker compromises governance key
2. Proposes actionDomain `0xdead...` (looks innocuous in bytes32)
3. 7 days pass (community misses it among many proposals)
4. Domain is activated, attacker uses it to scope new nullifiers
5. Users who voted with real domains can now vote again with attacker's domain

**Gas Cost:** ~50k gas (proposal) + ~30k gas (execution)

**Recommendation:**
- Implement actionDomain naming registry (human-readable mapping)
- Add on-chain description/metadata for proposals
- Require actionDomain format validation (e.g., prefix bytes)

---

### MED-003: recordParticipation Can Be Called Multiple Times Per Proof

**Severity:** Medium
**Contract:** CampaignRegistry.sol
**Location:** Lines 307-331 (`recordParticipation`)

#### Description

The `recordParticipation` function does NOT track whether a specific (actionId, districtRoot) pair has already been counted. While nullifiers prevent the same user from submitting twice, the participant count can be inflated:

```solidity
function recordParticipation(
    bytes32 actionId,
    bytes32 districtRoot
) external onlyAuthorizedCaller whenNotPaused nonReentrant {
    bytes32 campaignId = actionToCampaign[actionId];
    // ...
    campaigns[campaignId].participantCount++;  // Always increments!
    // ...
}
```

**Impact:**
- If DistrictGateV2 is replaced/upgraded incorrectly, multiple calls possible
- `participantCount` can exceed actual unique participants
- Sybil metrics become unreliable

**Attack Vector:**
The current code path through DistrictGateV2 calls `recordParticipation` exactly once per `verifyAndAuthorizeWithSignature` call. However:
1. If an attacker deploys a malicious "DistrictGateV2" and gets it authorized
2. They can call `recordParticipation` repeatedly

This requires governance compromise (authorizing malicious caller), but the defense-in-depth principle suggests adding idempotency.

**Gas Cost:** ~25k gas per inflation call

**Recommendation:**
```solidity
// Add mapping to track recorded participations
mapping(bytes32 => mapping(bytes32 => mapping(bytes32 => bool)))
    public participationRecorded; // actionId => districtRoot => nullifier => recorded

function recordParticipation(
    bytes32 actionId,
    bytes32 districtRoot,
    bytes32 nullifier  // Add nullifier parameter
) external onlyAuthorizedCaller whenNotPaused nonReentrant {
    if (participationRecorded[actionId][districtRoot][nullifier]) return;
    participationRecorded[actionId][districtRoot][nullifier] = true;
    // ... rest of function
}
```

---

### MED-004: Signature Replay Across Chains (EIP-712 Incomplete)

**Severity:** Medium
**Contract:** DistrictGateV2.sol
**Location:** Lines 169-178, 210-231

#### Description

The EIP-712 implementation includes `chainId` in the domain separator, which is good. However, there are edge cases:

1. **Cross-fork replay:** If Ethereum hard forks (like ETH/ETC), signatures are valid on both chains until `chainId` diverges
2. **L2 bridge scenarios:** Scroll uses chainId 534352, but:
   - Contract deployed at same address on another L2 = replay possible
   - `DOMAIN_SEPARATOR` is immutable, computed at deployment

```solidity
DOMAIN_SEPARATOR = keccak256(
    abi.encode(
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
        keccak256(bytes("DistrictGateV2")),
        keccak256(bytes("1")),
        block.chainid,      // Fixed at deployment
        address(this)
    )
);
```

**Impact:**
- If contract is deployed at same address on two chains, signatures are cross-replayable
- Unlikely but possible with CREATE2 deterministic deployment

**Gas Cost:** N/A (design issue)

**Recommendation:**
- Compute DOMAIN_SEPARATOR dynamically OR validate `block.chainid` matches expected
- Add explicit network identifier to typehash
- Document deployment strategy to avoid address collision across chains

---

### MED-005: Governance Transfer Without Revocation Window

**Severity:** Medium
**Contract:** NullifierRegistry.sol
**Location:** Lines 186-193 (`transferGovernance`)

#### Description

Unlike other contracts that use TimelockGovernance with 7-day delays, NullifierRegistry has **instant governance transfer**:

```solidity
function transferGovernance(address newGovernance) external onlyGovernance {
    if (newGovernance == address(0)) revert ZeroAddress();
    address previous = governance;
    governance = newGovernance;  // INSTANT TRANSFER
    authorizedCallers[newGovernance] = true;
    authorizedCallers[previous] = false;
    emit GovernanceTransferred(previous, newGovernance);
}
```

**Impact:**
- Compromised governance can instantly transfer control
- No community warning window
- Attacker can authorize malicious callers immediately after transfer
- Inconsistent security model across contracts

**Attack Scenario:**
1. Attacker compromises governance key
2. Instantly transfers governance to attacker-controlled address
3. Authorizes malicious caller contract
4. Malicious caller can mark arbitrary nullifiers as used (DoS legitimate voters)
5. Or: Fail to mark nullifiers (enable double-voting)

**Gas Cost:** ~45k gas (transfer) + ~25k gas (authorize caller)

**Recommendation:**
- Inherit from TimelockGovernance like other contracts
- Add 7-day timelock for governance transfer
- Maintain consistency across all governance operations

---

### LOW-001: Rate Limit Bypass via Multiple Addresses

**Severity:** Low
**Contract:** NullifierRegistry.sol
**Location:** Lines 103-107

#### Description

The rate limit `RATE_LIMIT_SECONDS = 60` is per-nullifier, but an attacker with multiple addresses (Sybil) can bypass this trivially:

```solidity
uint256 lastTime = lastActionTime[nullifier];
if (lastTime != 0 && block.timestamp < lastTime + RATE_LIMIT_SECONDS) {
    revert RateLimitExceeded();
}
```

Since nullifiers are derived from user secrets, each address has a unique nullifier.

**Impact:**
- Rate limit provides minimal spam protection
- Does not prevent coordinated multi-address attacks
- Primarily useful against accidental double-clicks, not adversaries

**Recommendation:**
- Accept this as intentional (rate limit is UX protection, not security)
- Document the limitation clearly
- Consider global rate limits if spam becomes problematic

---

### LOW-002: Verifier Call Return Data Not Validated

**Severity:** Low
**Contract:** DistrictGateV2.sol
**Location:** Lines 258-268

#### Description

```solidity
(bool success, bytes memory result) = verifier.call(
    abi.encodeWithSignature(
        "verifyProof(bytes,uint256[5])",
        proof,
        publicInputs
    )
);

if (!success || !abi.decode(result, (bool))) {
    revert VerificationFailed();
}
```

If `result` is not exactly 32 bytes (a bool encoded), `abi.decode` may revert with a non-descriptive error or produce unexpected results.

**Impact:**
- Malformed verifier response causes unclear revert
- Does not affect security (verification fails either way)
- Poor error reporting for debugging

**Recommendation:**
```solidity
if (!success || result.length != 32) {
    revert VerificationFailed();
}
bool verified = abi.decode(result, (bool));
if (!verified) {
    revert VerificationFailed();
}
```

---

### LOW-003: Campaign ID Collision Theoretically Possible

**Severity:** Low
**Contract:** CampaignRegistry.sol
**Location:** Lines 250-258

#### Description

```solidity
campaignId = keccak256(abi.encodePacked(
    msg.sender,
    ipfsMetadataHash,
    country,
    block.timestamp
));
```

While astronomically unlikely, `keccak256` collision is theoretically possible. The check exists:

```solidity
if (campaigns[campaignId].createdAt != 0) revert CampaignAlreadyExists();
```

But relies on `createdAt != 0`, which could theoretically collide with an existing campaign.

**Impact:**
- Practically zero (2^-128 collision probability)
- Defense exists but is worth noting

**Recommendation:**
- Accept current implementation (collision probability negligible)
- Document the astronomical odds in comments

---

### LOW-004: Missing Event for ActionDomain Cancellation

**Severity:** Low
**Contract:** DistrictGateV2.sol
**Location:** Lines 394-397

#### Description

```solidity
function cancelActionDomain(bytes32 actionDomain) external onlyGovernance {
    if (pendingActionDomains[actionDomain] == 0) revert ActionDomainNotPending();
    delete pendingActionDomains[actionDomain];
    // NO EVENT EMITTED
}
```

**Impact:**
- Off-chain indexers cannot track cancelled action domain proposals
- Audit trail incomplete
- Other cancellation functions emit events (e.g., `CampaignRegistryChangeCancelled`)

**Recommendation:**
```solidity
event ActionDomainCancelled(bytes32 indexed actionDomain);

function cancelActionDomain(bytes32 actionDomain) external onlyGovernance {
    if (pendingActionDomains[actionDomain] == 0) revert ActionDomainNotPending();
    delete pendingActionDomains[actionDomain];
    emit ActionDomainCancelled(actionDomain);
}
```

---

### INFO-001: ReentrancyGuard Usage Inconsistent

**Severity:** Informational
**Contracts:** NullifierRegistry.sol, CampaignRegistry.sol

#### Description

- `NullifierRegistry` uses `ReentrancyGuard` on `recordNullifier`
- `CampaignRegistry` uses `ReentrancyGuard` on `recordParticipation` and `createCampaign`
- `DistrictGateV2` does NOT use `ReentrancyGuard`

The external call to `verifier.call()` in DistrictGateV2 is the primary reentrancy vector, but since verifiers are governance-controlled, this is low risk.

**Recommendation:**
- Document why DistrictGateV2 doesn't need ReentrancyGuard
- Consider adding for defense-in-depth

---

### INFO-002: No Circuit-Level Validation of Public Inputs Range

**Severity:** Informational
**Contract:** DistrictGateV2.sol

#### Description

Public inputs are passed as `uint256` but represent:
- `districtRoot`: bytes32
- `nullifier`: bytes32
- `authorityLevel`: should be 1-5 integer
- `actionDomain`: bytes32
- `districtId`: bytes32

There's no on-chain validation that `authorityLevel` is in range [1,5].

**Impact:**
- Circuit enforces this, so invalid values would fail proof verification
- On-chain validation is redundant but could provide clearer errors

**Recommendation:**
- Accept current design (circuit validation sufficient)
- Add comment noting circuit-side validation

---

### INFO-003: Pausable but No Emergency Unpause Mechanism

**Severity:** Informational
**Contracts:** DistrictGateV2.sol, NullifierRegistry.sol, CampaignRegistry.sol

#### Description

If governance key is lost while contract is paused, there is no recovery mechanism.

**Impact:**
- Permanent protocol freeze if governance lost during pause
- Low likelihood but catastrophic impact

**Recommendation:**
- Consider time-limited pause (auto-unpause after X days)
- Document governance key backup requirements
- Phase 2: Implement guardian-based emergency unpause

---

## Specific Questions Answered

### Q1: Can an attacker register a malicious `actionDomain` after the timelock?

**Answer: YES (with governance compromise)**

After the 7-day timelock expires, any pending actionDomain can be executed by anyone:

```solidity
function executeActionDomain(bytes32 actionDomain) external {
    // No access control - anyone can execute
    // ...
    allowedActionDomains[actionDomain] = true;
}
```

If governance is compromised:
1. Attacker proposes malicious actionDomain
2. Waits 7 days
3. Executes (or anyone executes)
4. Domain is now active for nullifier scoping

**Mitigation:** The timelock provides detection window. Monitor `ActionDomainProposed` events.

---

### Q2: What happens if `deactivateRoot()` is called during active voting?

**Answer: NOTHING (Bug - see HIGH-001)**

Root deactivation sets `isActive = false` but DistrictGateV2 never checks `isValidRoot()`. Voting continues unaffected on "deactivated" roots. This is a bug, not intentional behavior.

---

### Q3: Can nullifiers be front-run to grief legitimate voters?

**Answer: PARTIALLY (see MED-001)**

The nullifier itself cannot be stolen (requires user's secret for valid proof). However:
- Ordering can be manipulated via MEV
- Rate limits don't prevent attack (different users = different nullifiers)
- Time-sensitive rewards are vulnerable

---

### Q4: Is the signature replay protection (EIP-712) complete?

**Answer: MOSTLY (see MED-004)**

- Chain ID is included (good)
- Contract address is included (good)
- Nonce prevents same-chain replay (good)

Edge cases:
- Cross-chain replay if same address on multiple chains (unlikely with careful deployment)
- Fork replay until chain IDs diverge

---

### Q5: Can `recordParticipation` be called multiple times for the same proof?

**Answer: NO (currently), but fragile (see MED-003)**

Current code path:
1. DistrictGateV2 calls recordParticipation once per verification
2. Nullifier prevents same user from re-verifying
3. CampaignRegistry doesn't track individual calls

If authorized caller list is compromised, inflation is possible. The function lacks idempotency guarantees.

---

## Attack Scenarios with Gas Costs

### Scenario A: Governance Takeover via NullifierRegistry

| Step | Action | Gas | Cumulative |
|------|--------|-----|------------|
| 1 | Compromise governance key | 0 | 0 |
| 2 | `transferGovernance(attacker)` | 45,000 | 45,000 |
| 3 | `authorizeCaller(maliciousContract)` | 25,000 | 70,000 |
| 4 | Call `recordNullifier` to DoS users | 28,000/call | 70,000 + N*28,000 |

**Total to DoS 1000 users:** ~28M gas (~0.28 ETH at 10 gwei)

### Scenario B: MEV Front-Running Priority Votes

| Step | Action | Gas | Cumulative |
|------|--------|-----|------------|
| 1 | Monitor mempool for high-value proofs | 0 | 0 |
| 2 | Generate own valid proof | 0 (off-chain) | 0 |
| 3 | Submit with priority gas | 350,000 | 350,000 |
| 4 | Repeat N times | 350,000*N | 350,000*N |

**Cost per front-run:** ~350k gas (~0.0035 ETH at 10 gwei)

### Scenario C: Participant Count Inflation (if authorized)

| Step | Action | Gas | Cumulative |
|------|--------|-----|------------|
| 1 | Get authorized as caller (gov compromise) | 25,000 | 25,000 |
| 2 | Call `recordParticipation` repeatedly | 30,000/call | 25,000 + N*30,000 |

**Cost to inflate by 10,000:** ~300M gas (~3 ETH at 10 gwei)

---

## Recommended Mitigations Summary

| ID | Issue | Mitigation | Priority |
|----|-------|------------|----------|
| HIGH-001 | Root deactivation ineffective | Add `isValidRoot()` check in DistrictGateV2 | P0 |
| MED-001 | Nullifier front-running | Commit-reveal for ordering-sensitive actions | P1 |
| MED-002 | Malicious actionDomain | Add naming registry and format validation | P2 |
| MED-003 | Participation double-counting | Add idempotency to recordParticipation | P2 |
| MED-004 | Cross-chain replay edge case | Document deployment strategy, consider dynamic separator | P2 |
| MED-005 | Instant governance transfer | Use TimelockGovernance in NullifierRegistry | P1 |
| LOW-001 | Rate limit bypass | Document limitation, accept as design | P3 |
| LOW-002 | Verifier return validation | Add length check before decode | P3 |
| LOW-003 | Campaign ID collision | Document astronomical odds | P3 |
| LOW-004 | Missing cancellation event | Add ActionDomainCancelled event | P3 |

---

## Conclusion

The voter-protocol contracts demonstrate thoughtful security architecture with appropriate use of timelocks, separation of concerns, and defense-in-depth patterns. The most critical finding (HIGH-001) is that root deactivation is currently ineffective due to missing validation in DistrictGateV2. This should be addressed before production deployment.

The medium-severity findings around governance consistency (MED-005) and front-running (MED-001) represent real but bounded risks that should be addressed based on threat model priorities.

The codebase is well-documented with honest threat model acknowledgments (Phase 1 limitations clearly stated). The upgrade path to multi-jurisdiction guardians is appropriately planned.

**Overall Assessment:** Suitable for controlled launch with HIGH-001 fix. Full production deployment should address MED-001 through MED-005.
