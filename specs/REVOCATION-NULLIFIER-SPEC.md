# Revocation Nullifier Spec (F1 Closure)

> **Spec ID:** REVOCATION-NULLIFIER-SPEC-001
> **Version:** 0.1.0 (DRAFT — design-only; no deployed contract)
> **Status:** DESIGN
> **Date:** 2026-04-23
> **Audience:** Protocol engineers, circuit authors, contract reviewers
> **Scope:** On-chain revocation of stale district credentials at the circuit level
> **Companion to:** `CRYPTOGRAPHY-SPEC.md` §6.4.2 (F1 closure)

---

## 1. Problem Statement

### 1.1 The F1 Attack

Commons issues an Ed25519-signed credential (`districtCredentials` in Convex) after address verification. The credential witnesses a 24-slot `district_commitment`. When a user re-verifies (address change, data-quality correction, operator patch), the server flips `revokedAt` on the old row and issues a new credential with a new commitment.

The problem: **the circuit does not consult `revokedAt`**. The `three_tree_membership` circuit only asserts:

1. `user_root` is a registered Tree 1 root.
2. `cell_map_root` is a registered Tree 2 root.
3. The 24-slot `districts[]` sponge to a commitment whose `H2(cell_id, district_commitment)` is a leaf in Tree 2.
4. The engagement leaf is in Tree 3.
5. `nullifier = H2(identity_commitment, action_domain)`.

None of these checks consult any off-chain revocation flag. A user who (a) retains a proof generated against a revoked credential or (b) retains the proof's witness inputs long enough to regenerate the proof after revocation can submit against `DistrictGate.verifyThreeTreeProof` at any point before the underlying Tree 2 root is deactivated. The verifier accepts the proof because it is cryptographically valid; the server-side `deliverToCongress` recheck (Stage 1) rejects the delivery, but:

- The proof has already landed on-chain in the `NullifierRegistry` → participant count inflates.
- The `ThreeTreeProofVerified` event fires → downstream consumers (scorecard, engagement tree updates, accountability receipts) may double-count.
- A compromised delivery pipeline, or any new pipeline that reads on-chain events, would honor the stale proof.

Stage 1 mitigates F1 at the **server boundary** (Convex `submissions.create`, `deliverToCongress`). Stage 2 closes F1 at the **cryptographic boundary**: a revoked credential's proofs stop verifying regardless of which caller invokes the verifier.

### 1.2 Relationship to F2

F2 (district-hopping amplification) is closed in this same Stage 2 wave by binding `district_commitment` into `action_domain` (see `CRYPTOGRAPHY-SPEC.md` §6.4.1). F2 closure prevents a user from generating *new nullifier scope* by rotating credentials. F1 closure prevents a user from *reusing old proofs* on rotated credentials. Both are necessary; neither is sufficient alone.

---

## 2. Mechanism

### 2.1 Revocation Nullifier Derivation

For each revoked credential, the server computes:

```
REVOCATION_DOMAIN = Poseidon2("commons-revocation-v1") mod BN254_MODULUS
                  // Fixed protocol constant, FROZEN post-launch
revocation_nullifier = H2(old_district_commitment, REVOCATION_DOMAIN)
                     // Uses DOMAIN_HASH2 (0x48324d), matching §3.1 of CRYPTOGRAPHY-SPEC.md
```

- `old_district_commitment` is the 24-slot sponge output previously issued to the user; read from `districtCredentials.districtCommitment` before patching `revokedAt`.
- `REVOCATION_DOMAIN` is a single compile-time constant; it is not per-user and not per-credential.
- The output is a BN254 field element uniquely derived from `old_district_commitment` (under the random-oracle assumption for Poseidon2).

**Why `H2` with `DOMAIN_HASH2`:** We reuse the existing pairwise hash primitive already embedded in every circuit, rather than introducing a new domain tag, because:

1. Minimizes incremental circuit-constraint cost (a single `H2` call is ~160 gates).
2. Reduces the domain-tag registry surface (§3.1 is FROZEN; adding tags requires hard fork).
3. `REVOCATION_DOMAIN` as the second input serves the same role as `action_domain` in the Sybil-nullifier construction: it isolates this use of `H2(a, b)` from all others.

**Non-collision guarantee:** `revocation_nullifier = H2(old_commitment, REVOCATION_DOMAIN)` cannot collide with any Sybil `nullifier = H2(identity_commitment, action_domain)` because (a) `REVOCATION_DOMAIN` is a fixed constant disjoint from the `action_domain` image (which ranges over every whitelisted keccak256 of the v2 preimage), and (b) `old_commitment` is drawn from the district-commitment subspace (sponge-24 outputs), which is not the identity-commitment subspace.

### 2.2 On-Chain Storage

Two design options considered. **Recommendation: Option B (new `RevocationRegistry.sol`).**

#### Option A: Extend `DistrictGate.sol`

Add a new mapping and events:

```solidity
mapping(bytes32 => bool) public revokedNullifiers;
mapping(bytes32 => uint256) public revokedAt; // block.timestamp for audit
event DistrictCommitmentRevoked(bytes32 indexed revocationNullifier, uint256 timestamp);
```

**Pros:** Single contract to approve; no new deployment or governance plumbing.

**Cons:**
- `DistrictGate` already carries a large surface (6 registries, timelocks, derived domains, EIP-712, three-tree verification). Adding revocation state muddies the contract's single responsibility.
- Upgrade cadence mismatch: revocation writes happen every re-verification (high frequency), `DistrictGate` is governance-gated and infrequently upgraded. Mixing them complicates gas-accounting analysis.
- `DistrictGate` is called by submitters; `RevocationRegistry` would be called by a trusted-writer role (the Commons operator). Separation aligns caller-permission surfaces.

#### Option B: New `RevocationRegistry.sol` (RECOMMENDED)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "openzeppelin/security/Pausable.sol";
import "openzeppelin/security/ReentrancyGuard.sol";
import "./TimelockGovernance.sol";

/// @title RevocationRegistry
/// @notice Append-only set of revocation nullifiers for stale district credentials.
/// @dev Writes are restricted to authorized callers (the Commons re-verification
///      pipeline). Reads are public and O(1). Consumed by the three-tree verifier
///      via the `revocation_nullifier_check` public input of the next circuit
///      revision.
contract RevocationRegistry is Pausable, ReentrancyGuard, TimelockGovernance {
    // Storage layout
    // ==============
    mapping(bytes32 => bool) public isRevoked;       // revocation_nullifier → revoked?
    mapping(bytes32 => uint256) public revokedAt;    // revocation_nullifier → block.timestamp

    /// @notice Authorized writers — the Commons re-verification pipeline.
    /// @dev Uses same 7-day timelock as NullifierRegistry's authorizedCallers.
    mapping(address => bool) public authorizedRevokers;
    mapping(address => uint256) public pendingRevokerAuthorization;
    mapping(address => uint256) public pendingRevokerRevocation;

    // Events
    event RevocationRecorded(bytes32 indexed revocationNullifier, uint256 timestamp);
    event RevokerAuthorized(address indexed revoker);
    event RevokerRevoked(address indexed revoker);

    // Errors
    error AlreadyRevoked();
    error UnauthorizedRevoker();

    modifier onlyAuthorizedRevoker() {
        if (!authorizedRevokers[msg.sender]) revert UnauthorizedRevoker();
        _;
    }

    /// @notice Record a revocation nullifier. Append-only; never cleared.
    function recordRevocation(bytes32 revocationNullifier)
        external
        whenNotPaused
        nonReentrant
        onlyAuthorizedRevoker
    {
        if (isRevoked[revocationNullifier]) revert AlreadyRevoked();
        isRevoked[revocationNullifier] = true;
        revokedAt[revocationNullifier] = block.timestamp;
        emit RevocationRecorded(revocationNullifier, block.timestamp);
    }

    /// @notice View function consumed by the verifier contract's revision.
    function checkRevocation(bytes32 revocationNullifier) external view returns (bool revoked) {
        return isRevoked[revocationNullifier];
    }
}
```

**Pros:**
- Single responsibility; mirrors existing `NullifierRegistry` shape.
- Clear caller-authorization surface (only the Commons server's signer can revoke).
- Deployment isolated from `DistrictGate`; verifier contract revisions can be wired independently.
- Audit-friendly: ~100 LoC, nothing clever.

**Cons:** One more contract to deploy, govern, and monitor.

### 2.3 Write Path

1. User calls `verifyAddress` in Convex; cooldown + sybil + throttle checks pass (Stage 1).
2. Convex reads `existing.districtCommitment` before patching `revokedAt`.
3. Convex computes `revocation_nullifier = H2(existing.districtCommitment, REVOCATION_DOMAIN)` via the shared `poseidon2` utility.
4. Convex either:
   - (a) Posts a transaction directly to `RevocationRegistry.recordRevocation(revocation_nullifier)` via an operator-funded wallet, or
   - (b) Enqueues a pending revocation in a new Convex table (e.g., `pendingRevocations`) that the existing snapshot-anchor worker drains, consolidating reads with the `SnapshotAnchor` quarterly cycle.
5. Convex patches `districtCredentials.revokedAt = now` regardless of on-chain write outcome (the server-side gate stays active even if the on-chain write is deferred).
6. `RevocationRegistry` emits `RevocationRecorded`.

Option (a) has lower latency to circuit enforcement; option (b) has lower gas churn and better batching. Recommend option (a) for launch simplicity and reserve option (b) as a gas-optimization migration if volume grows.

### 2.4 Read Path — Future Circuit Revision

The current `three_tree_membership` circuit has no `revocation_nullifier` public input. A circuit revision is required to enforce F1 at the proof layer. The revision's public-input layout becomes:

| Index | Field | Meaning |
|---|---|---|
| 0 | `user_root` | (unchanged) |
| 1 | `cell_map_root` | (unchanged) |
| 2–25 | `districts[24]` | (unchanged) |
| 26 | `nullifier` | (unchanged) |
| 27 | `action_domain` | (unchanged — now v2 preimage) |
| 28 | `authority_level` | (unchanged) |
| 29 | `engagement_root` | (unchanged) |
| 30 | `engagement_tier` | (unchanged) |
| **31** | **`revocation_nullifier`** | **NEW: H2(computed district_commitment, REVOCATION_DOMAIN)** |

The circuit computes `revocation_nullifier` internally from the already-witnessed `district_commitment` (identical sponge output used for Tree 2 leaf verification). The prover does not supply it as a witness; it is **derived** and **exposed** as a public input.

On-chain, `DistrictGate.verifyThreeTreeProof` gains one extra line before the nullifier-registry write:

```solidity
bytes32 revocationNullifier = bytes32(publicInputs[31]);
if (revocationRegistry.checkRevocation(revocationNullifier)) revert CredentialRevoked();
```

`CredentialRevoked` is a new error. The check is O(1) — one SLOAD.

### 2.5 Write–Read Ordering and Race Conditions

A user mid-flight (proof generated pre-revocation, submitted post-revocation) is **correctly rejected**. This is the intended behavior — the server has already concluded the old credential is no longer authoritative.

A user whose proof arrives *before* the revocation write lands on-chain succeeds. This is a Stage-1-covered race: Convex's delivery-enqueue recheck against `revokedAt` still blocks the downstream CWC send. The Stage 2 circuit-level check tightens the Stage 1 guarantee but does not make Stage 1 redundant.

---

## 3. Privacy Analysis

### 3.1 Information Revealed On-Chain

Each `RevocationRecorded` event reveals `revocation_nullifier = H2(old_district_commitment, REVOCATION_DOMAIN)` and `block.timestamp`. The timestamp is publicly observable regardless.

The `revocation_nullifier` itself is a one-way Poseidon2 image of `old_district_commitment`. Under random-oracle assumptions, it reveals nothing about:

- Which userId rotated (userId never enters the preimage).
- Which email/phone/identity was used (identity_commitment never enters the preimage).
- Which geographic area the old districts spanned (district_commitment is already a sponge over 24 district IDs; the sponge output is as opaque as Poseidon2-160 security).

### 3.2 Linkability Concerns

**Concern 1: Chronology correlation.** An observer sees a stream of `RevocationRecorded` timestamps. If the observer also has access to Convex metadata (user counts, re-verification cadence), they can correlate revocation-registry load with specific user cohorts. The on-chain observer alone cannot deanonymize; the Convex observer can — but the Convex operator already has `userId × districtCommitment` access, so the on-chain event does not leak more than the operator already knows.

**Mitigation:** Batch revocations into the quarterly `SnapshotAnchor` window if correlation resistance becomes a priority. This trades latency for chronology-obscuring.

**Concern 2: Re-identification via submission timing.** A sophisticated attacker observes a revocation-registered nullifier `R` at time `t_revoke`. They observe a submission proof on-chain at time `t_submit > t_revoke`. The submission's `revocation_nullifier` public input (post-circuit-revision) proves non-membership of the revoked set *or* proves membership (and is rejected). Either way, the submission cannot link itself back to `R` — the submission reveals its *own* revocation nullifier, computed from *its* `district_commitment`, which (if valid) does not match `R`.

So the worst-case linkage is: an attacker learns that *some* user rotated credentials at `t_revoke`, and separately learns that *some* (unrelated) user submitted a proof at `t_submit`. No cross-link between the two is exposed on-chain.

**Concern 3: Sponge output as quasi-identifier.** `old_district_commitment` is deterministic given the 24-slot district vector. Two users with identical district slots (same street, same cell) have identical `district_commitment` values. When both rotate, the same `revocation_nullifier` is computed twice. The contract's `AlreadyRevoked` revert surfaces this.

- **Leak**: the second revoker learns that the first revoker had the same districts. This is narrow: it only applies when two users in the *exact same* district tuple (same cell) both rotate credentials.
- **Severity**: low. District tuples are coarse; the leak is equivalent to "someone else in your apartment building re-verified recently."
- **Mitigation**: per-credential salt. Extend the preimage to `H3(old_district_commitment, credential_issued_at, salt)` with a per-credential random salt stored in Convex. The salt enters the circuit as a private witness and is derived in-circuit the same way. Deferred to a future revision; noted as an open question in §5.

### 3.3 Does Anyone Learn Who Revoked?

No. The revocation-nullifier preimage contains only `old_district_commitment` and `REVOCATION_DOMAIN`. Neither is a per-user identifier. The msg.sender on `recordRevocation` *is* the Commons operator's signer address, so the operator is revealed — but the operator is not a user.

---

## 4. Gas Cost Estimates

Scroll L2 gas accounting, approximate.

### 4.1 Write Cost (per revocation)

| Operation | Gas (L1-equivalent) | Gas (Scroll L2 actual) |
|---|---|---|
| `isRevoked[r] = true` | 20,000 (cold SSTORE) | ~500 |
| `revokedAt[r] = block.timestamp` | 20,000 (cold SSTORE) | ~500 |
| `RevocationRecorded` event (2 indexed args) | ~2,500 | ~25 |
| modifier + reentrancy guard | ~5,000 | ~50 |
| calldata (single bytes32 arg) | ~136 | ~1 |
| **Total per revocation** | **~47,500 L1 / ~1,100 L2** | **~$0.00015 at 20 gwei equivalent** |

At 10,000 revocations/year (aggressive growth assumption), annual cost: ~1.5 USD in Scroll L2 gas.

### 4.2 Read Cost (per submission)

| Operation | Gas |
|---|---|
| SLOAD `isRevoked[r]` (warm after first call) | ~100 L2 |
| External call overhead into RevocationRegistry | ~700 L2 |
| **Total per submission** | **~800 L2 (~$0.0001 at L2 rates)** |

This is ~0.5% of the three-tree verifier cost (~150,000 gas L2). Negligible.

### 4.3 Storage Growth

Each revocation consumes two storage slots (32 bytes each → one slot for bool-packed and one for timestamp, no packing since timestamps need 32 bytes for safety). With 1M revocations over a decade, total storage: ~64 MB. Well within Scroll's pragmatic ceiling.

---

## 5. Circuit-Revision TODO List

The following work items are required *for the future circuit revision* and are **out of scope for Stage 2**. They are listed here so a future circuit author can pick them up cleanly.

### 5.1 Noir circuit changes (`three_tree_membership/src/main.nr`)

1. Compute `REVOCATION_DOMAIN` as a Noir constant: `global REVOCATION_DOMAIN: Field = <precomputed Poseidon2 hash of "commons-revocation-v1" mod p>;`
   - Precomputation happens off-circuit; value is committed into the circuit source.
   - Cross-language golden vector: `revocation_domain()` must agree between TS and Noir.
2. After the existing sponge-24 computation of `district_commitment`, add:
   ```noir
   let revocation_nullifier: Field = hash2(district_commitment, REVOCATION_DOMAIN);
   ```
3. Add `revocation_nullifier` as the 32nd public input (index 31). Extend `main()` signature and the depth-variant build script.
4. Update non-collision property tests in `three_tree_membership/src/main.nr::test_hash*_domain_separation` to include:
   ```
   H2(dc, REVOCATION_DOMAIN) ≠ H2(id, ad)   // for any (dc, id, ad)
   ```
   Asserted by domain-separation induction (REVOCATION_DOMAIN ∉ action_domain image).

### 5.2 Solidity changes (`DistrictGate.sol`)

1. Declare new public-input count: `uint256 public constant THREE_TREE_V2_PUBLIC_INPUT_COUNT = 32;` and keep `THREE_TREE_PUBLIC_INPUT_COUNT = 31` during the transition.
2. Accept either 31 or 32 public inputs in `verifyThreeTreeProof` during the migration window (see `CIRCUIT-REVISION-MIGRATION.md`).
3. Inject a `RevocationRegistry` reference, proposed and executed under the standard 7-day timelock.
4. Add the revocation check after the existing nullifier-not-used check but before the `nullifierRegistry.recordNullifier` write.
5. Emit a `RevocationBlockedSubmission(revocation_nullifier, submitter)` event when a proof is rejected for revocation reasons, to aid observability.

### 5.3 Verifier contract

Each depth variant (18/20/22/24) gets a new HonkVerifier at 32 public inputs. Old 31-input verifiers remain deployed for legacy-proof acceptance per `CIRCUIT-REVISION-MIGRATION.md`. The 14-day verifier-upgrade timelock applies per variant.

### 5.4 TypeScript prover (`noir-prover/three-tree-prover.ts`)

1. Extend `ThreeTreeProofResult.publicInputs` length from 31 to 32.
2. Expose `revocationNullifier` on the typed result for easier submission wiring.
3. Shared golden vector: add a `test_revocation_domain_hex` TS test that asserts the constant matches Noir.

### 5.5 Commons integration

1. On credential rotation in `convex/users.ts::verifyAddress`, compute `revocation_nullifier` server-side (using the same `poseidon2` wrapper as circuit-internal hashes) and enqueue the on-chain write.
2. New Convex table `pendingRevocations` (if batching path is chosen) with fields `{ revocationNullifier, enqueuedAt, txHash?, onChainAt? }`.
3. Background worker (or direct-write path) invokes `RevocationRegistry.recordRevocation`.
4. Existing `districtCredentials.revokedAt` stays — it is the server-layer gate (Stage 1). The on-chain set is the cryptographic-layer gate (Stage 2).

### 5.6 Operational monitoring

1. Watcher subscribes to `RevocationRecorded` events; anomaly-detects if write volume deviates from expected re-verification rate.
2. Watcher subscribes to `RevocationBlockedSubmission` events; alerts if a single identity repeatedly attempts stale-proof replay (possible evidence of account compromise or sophisticated replay automation).

---

## 6. Open Questions and Dependencies

### 6.1 Open Questions

**Q1. Per-credential salt for same-district users.** §3.2 Concern 3 flags that two users with identical 24-slot district tuples produce identical `district_commitment` values and hence identical `revocation_nullifier` values, leaking the fact of their co-location when both rotate. Adding a per-credential salt in the preimage closes this but requires (a) a new private witness in the circuit, (b) storage of the salt in `districtCredentials`, and (c) the salt to be available to the prover from the credential (which it is). Deferred to a follow-up revision.

**Q2. Revocation-bound credential expiry.** Should `RevocationRegistry.recordRevocation` gain a `bytes32 replacementNullifier` argument so an auditor can trace which old credential was superseded by which new one? This would *require* exposing both nullifiers on-chain and is probably a privacy regression. **Recommendation: no; auditors should instead consult Convex's `issuingCredentialId` chain.**

**Q3. Revocation set bounded size.** Appended forever. At 1M revocations storage is fine (§4.3) but verifier reads remain O(1). No bounded-size concern.

**Q4. Who writes on-chain?** An operator-funded wallet is proposed. Gas is negligible. But the caller's identity *is* revealed (msg.sender on `recordRevocation`). If meta-transactions are required for Trust-Model Layer 2 decentralization, the caller becomes a relayer — spec remains unchanged, relayer identity is opaque.

### 6.2 Dependencies

- **Circuit revision**: required before on-chain enforcement is active. Until circuit revision lands, `RevocationRegistry` can be deployed and written to, but `DistrictGate` cannot read it. The state is pre-provisioned; the enforcement lever is circuit + verifier. See `CIRCUIT-REVISION-MIGRATION.md`.
- **Trusted-setup posture**: unchanged. UltraHonk SRS applies across all BN254 circuits; adding a public input does not change the setup.
- **Cross-language parity**: new golden vector for `REVOCATION_DOMAIN` constant and for `H2(dc, REVOCATION_DOMAIN)` test case must be added to the CI check described in `CRYPTOGRAPHY-SPEC.md` §2.5.
- **Governance**: `RevocationRegistry` deployment + authorized-revoker registration go through the same 7-day timelock as `DistrictGate`'s operational grants.

---

## 7. Non-Goals

- **Not a revocation UI.** Users don't see this layer. Stage 3 (parallel track) handles UX around credential rotation.
- **Not a Merkle-based compact set.** The revocation set is a dense mapping. A future Merkle-based compact representation is possible but unnecessary at current scale; deferred.
- **Not a replacement for server-side `revokedAt`.** Server-side revocation stays in place as the Stage 1 gate. The on-chain set is the cryptographic reinforcement, not a substitute.
- **Not consulted by the `position_note`, `debate_weight`, or `bubble_membership` circuits.** Revocation applies only to three-tree civic-action proofs. Debate positions and community-field contributions use separate trust frames.

---

## 8. References

- `CRYPTOGRAPHY-SPEC.md` §6.4.2 (F1 closure rationale)
- `CRYPTOGRAPHY-SPEC.md` §6.4.1 (F2 closure rationale, parallel fix)
- `CIRCUIT-REVISION-MIGRATION.md` (operational path from v1 to v2 proofs)
- `TRUST-MODEL-AND-OPERATOR-INTEGRITY.md` §5 (operator trust surface)
- `commons/convex/users.ts` lines 349–451 (re-verification flow where revocation would emit)
- `commons/convex/schema.ts` `districtCredentials.districtCommitment` (source of truth for old commitment)
- `voter-protocol/contracts/src/NullifierRegistry.sol` (pattern reference for new contract)
- `voter-protocol/contracts/src/DistrictGate.sol::verifyThreeTreeProof` (integration point)

---

## Changelog

| Version | Date | Change |
|---|---|---|
| 0.1.0 | 2026-04-23 | Initial DRAFT — design-only spec for Stage 2 F1 closure. No deployed contract. |
