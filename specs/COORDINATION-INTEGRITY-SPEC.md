# Coordination Integrity Specification

**Version:** 1.0.0
**Date:** 2026-02-08
**Status:** NORMATIVE
**Companion Documents:** TRUST-MODEL-AND-OPERATOR-INTEGRITY, COMMUNIQUE-INTEGRATION-SPEC, IMPLEMENTATION-GAP-ANALYSIS (Round 4)

---

## Preamble

This specification defines the Voter Protocol's approach to coordination integrity: the property that civic signals flowing through the protocol accurately represent the organic intent of verified constituents, and that manufactured or hidden coordination is observable without requiring gatekeeping or censorship.

Astroturfing — hidden, funded coordination masquerading as organic grassroots sentiment — is the primary threat to any civic communication infrastructure. This specification documents why naive countermeasures (content hashing on-chain, reputation scoring, behavioral filtering) create worse problems than they solve, and defines an architecture based on structural observability: making coordination patterns visible without judging their legitimacy.

The protocol does not prevent coordinated civic action. Coordinated civic action is democracy. The protocol prevents coordinated civic action from being *disguised* as spontaneous individual action. The distinction is transparency, not permission.

Every design decision in this document is accompanied by its pitfalls. Where a solution creates a new problem, we state that. Where a tradeoff has no clean resolution, we say so.

---

## Table of Contents

1. [The Coordination Threat Model](#1-the-coordination-threat-model)
2. [Why Content Commitment On-Chain Fails](#2-why-content-commitment-on-chain-fails)
3. [The Proof-Message Binding Gap](#3-the-proof-message-binding-gap)
4. [Structural Signal Architecture](#4-structural-signal-architecture)
5. [Nullifier Scoping Revision](#5-nullifier-scoping-revision)
6. [Delivery Path Security Model](#6-delivery-path-security-model)
7. [The Moderation Gap](#7-the-moderation-gap)
8. [Identity Binding and Authority Levels](#8-identity-binding-and-authority-levels)
9. [Campaign Health Metrics](#9-campaign-health-metrics)
10. [Off-Chain Coordination Entropy Indexer](#10-off-chain-coordination-entropy-indexer)
11. [ZK Non-Collusion: Verifiable Independence](#11-zk-non-collusion-verifiable-independence)
12. [Decision-Maker Context Generalization](#12-decision-maker-context-generalization)
13. [Implementation Roadmap](#13-implementation-roadmap)
14. [Pitfall Registry](#14-pitfall-registry)

---

## 1. The Coordination Threat Model

Six attack vectors exist against civic communication infrastructure. Each exploits a different layer of the system. Passkeys, ZK proofs, and nullifiers — the protocol's current defenses — address only the first.

### 1.1 Sybil Flood

**Attack:** One human creates multiple accounts and submits multiple proofs for the same action.

**Current defense:** Nullifiers prevent the same `user_secret` from proving twice for the same `action_domain`. OAuth deduplication provides weak email/phone uniqueness.

**Residual gap (pre-Cycle 3):** ~~Identity verification providers (self.xyz, Didit.me) are stub endpoints. Cross-provider deduplication (ISSUE-001) is unresolved. Authority level enforcement per action domain is not implemented in DistrictGate.sol.~~

**Status (2026-02-08):** Mitigated via Cycle 3 anti-astroturf hardening:
- Wave 14a: Cross-provider Sybil closed — `identity_commitment` + `encrypted_entropy` bind identity across providers
- Wave 14b: `user_secret = Poseidon2(identity_commitment, user_entropy)` — deterministic derivation prevents multi-secret attacks
- Wave 14c/14d: Authority level derived from verification method + document type; on-chain `actionDomainMinAuthority` with bounds validation and 24h timelock for increases
- Residual: Users with 5 OAuth accounts from 5 providers can still create 5 accounts, but only one can reach authority level 4+ (passport-verified identity commitment is unique per person). See [Section 8](#8-identity-binding-and-authority-levels).

### 1.2 Coordinated Single-Voting

**Attack:** A well-funded organization recruits 10,000 real humans, each with legitimate passkeys and valid constituency proofs, to send identical or similar messages within a narrow time window.

**Current defense:** None. Every individual submission is cryptographically valid. The protocol cannot distinguish this from 10,000 independently motivated constituents.

**Why this is hard:** Legitimate political mobilization (unions, advocacy organizations, religious groups, community coalitions) uses exactly the same mechanics. A union organizing 10,000 members to contact their representatives about a labor bill is structurally identical to a corporate PAC astroturfing 10,000 contractors. The protocol should not and cannot distinguish between them by content or coordination structure.

**Approach:** Make the coordination *observable*, not prohibited. See [Section 4](#4-structural-signal-architecture).

### 1.3 Template Farming

**Attack:** A campaign creates a single template and drives thousands of users to send identical messages, creating the appearance of widespread independent concern.

**Current defense:** `CampaignRegistry.sol` tracks `participantCount` and `districtCount` per campaign (lines 57-58), providing a geographic diversity metric. Template count per campaign is recorded at creation (`_campaignTemplates[campaignId].length`).

**Residual gap:** These metrics are on-chain but not surfaced in any dashboard or API. The ratio `districtCount / participantCount` is never computed or exposed. No off-chain indexer consumes these events.

**Status:** Primitives exist. Exposure and interpretation do not. See [Section 9](#9-campaign-health-metrics).

### 1.4 Burst Injection

**Attack:** 10,000 messages submitted within a 47-minute window to create an impression of urgent, overwhelming constituent demand.

**Current defense:** `NullifierRegistry.sol` has a 60-second per-user rate limit between actions (line 57). `ActionSubmitted` events include `block.timestamp`.

**Residual gap:** 60 seconds between submissions still allows ~17 submissions per user per 17 minutes. For coordinated single-voting (one submission per user), the rate limit is irrelevant — 10,000 unique users submitting once each are not rate-limited. Temporal burst detection requires off-chain analysis.

**Status:** Per-user rate limiting exists. Cross-user temporal analysis does not. See [Section 10](#10-off-chain-coordination-entropy-indexer).

### 1.5 Geographic Concentration

**Attack:** Astroturf campaign recruits operatives concentrated in a few districts, creating the false impression of national grassroots concern.

**Current defense:** `CampaignRegistry.sol` tracks `districtCount` (line 58) and emits `ParticipantRecorded` events with `districtRoot` and `newDistrict` flag (line 330).

**Residual gap:** Same as 1.3 — metrics exist on-chain but are not exposed. The 24 district IDs are in the two-tree proof's public inputs (`publicInputs[2-25]`) and emitted in `TwoTreeProofVerified` events, but no indexer aggregates geographic distribution per campaign.

**Status:** On-chain data sufficient. Off-chain interpretation missing.

### 1.6 Authority Laundering

**Attack:** Low-trust accounts (OAuth-only, authority level 1) flood a high-stakes action domain that should require passport-level verification.

**Current defense:** `authority_level` is a public output of the ZK circuit (range-checked to `[1, 5]` in `main.nr:38-39`). It appears in `DistrictGate.sol` event emissions.

**Residual gap:** `DistrictGate.sol` receives `authorityLevel` as `publicInputs[28]` but does not enforce a minimum per action domain. Any authority level passes for any action. The `allowedActionDomains` mapping (SA-001) whitelists domains but does not specify a required authority tier.

**Status:** Circuit produces the signal. Contract does not enforce it. See [Section 8](#8-identity-binding-and-authority-levels).

---

## 2. Why Content Commitment On-Chain Fails

An intuitive anti-astroturf approach is to commit a hash of each message's content on-chain, then measure content diversity across a campaign. This section documents why this approach creates worse problems than it solves.

### 2.1 The Template Fingerprinting Attack

Templates are public on the Communique platform at `/s/[slug]`. Their `message_body` field is readable by anyone. If `contentHash = keccak256(message_body)` appears in an on-chain event:

1. Attacker precomputes `H(template.message_body)` for every template on the platform.
2. User submits a proof. The `contentHash` appears in the event alongside 24 district IDs.
3. Attacker matches `contentHash` to a known template.
4. Attacker cross-references the 24-district intersection to narrow the anonymity set.

**Result:** The attacker knows that a person in the intersection of [CA-12, CA-SEN-1, SF-BOARD-6, ...] used the "Oppose Surveillance Bill HR-9182" template. The anonymity set degrades from ~750K (single district) to potentially dozens of people who match that exact 24-district intersection AND have political views aligned with that template.

**This is a political deanonymization attack.** It reveals what each pseudonymous user cares about, linked to a narrow geographic area. For users in controversial civic actions (whistleblowers, minority advocacy, opposition movements), this is a material safety risk.

### 2.2 The Three-Form Problem

A "message" in Communique exists in three states during its lifecycle:

| Form | Content | Hash Stability |
|------|---------|---------------|
| Raw template | `message_body` with `[Personal Connection]` placeholder | Stable across all users |
| Resolved template | Block variables (`[Name]`, `[Address]`, `[Representative Name]`) substituted | Unique per user (contains PII) |
| Final personalized | `[Personal Connection]` replaced with user's freeform text | Unique per user |

- Hashing the **raw template** gives the same hash for every user. Zero diversity signal. Maximum fingerprinting risk.
- Hashing the **resolved template** includes user PII (name, address). Putting this hash on-chain is a privacy violation even if the content isn't revealed — the hash is linkable to the user's other on-chain actions.
- Hashing the **final personalized message** produces unique hashes for every submission. Content diversity metric is always ~100%. The metric becomes meaningless.

**There is no hash target that is both meaningful for diversity measurement and safe for privacy.**

### 2.3 The AI Duplication Problem

Communique uses AI (Gemini, GPT-4) for template generation via the `message-writer.ts` agent. Two users independently requesting "Write a message opposing HR 1234" may receive identical or near-identical outputs. If content hashing were in place:

- AI-generated duplication creates false positive "coordination" signals.
- Content diversity metrics penalize AI-assisted users for using the same tool independently.
- The boundary between "coordinated template use" and "independent use of the same AI" is indistinguishable from hash values alone.

### 2.4 The Decision

**Content commitment on-chain is not implemented in this protocol.** The anti-astroturf architecture relies on structural signals (geographic diversity, temporal distribution, authority level distribution, template count per campaign) that do not create privacy regressions. See [Section 4](#4-structural-signal-architecture).

**Pitfall of this decision:** Without content commitment, the protocol cannot distinguish between "10,000 unique messages about the same topic" and "10,000 identical copy-paste messages." This distinction matters to recipients. **Mitigation:** Recipients (congressional offices, decision-makers) receive the actual message text via delivery channels (CWC, email, API). They can observe content diversity directly. The protocol's role is to verify constituency and prevent sybil — not to evaluate message quality. Quality evaluation belongs to the recipient, not the infrastructure.

---

## 3. The Proof-Message Binding Gap

### 3.1 Current State

The ZK proof and the delivered message are cryptographically independent. In Communique's submission flow (`ProofGenerator.svelte:277-299`), the proof and message travel in the same HTTP request:

```
POST /api/submissions/create
{
  proof,              // ZK proof bytes (proves constituency)
  publicInputs,       // [nullifier, merkleRoot, ...]
  templateData: {     // Message content (separate, unbound)
    subject,
    message,
    recipientOffices
  }
}
```

The EIP-712 signature (`DistrictGate.sol:118-120`) covers `proofHash` and `publicInputsHash` but NOT message content, template ID, or recipient information.

**Attack:** A compromised Communique backend could verify a valid proof on-chain (correct) and deliver a completely different message to Congress (or any decision-maker). The user would never know. The on-chain record would show a valid proof for the wrong message.

### 3.2 Why Action Domain Binding Is Sufficient

The `action_domain` is computed from the template ID:

```
action_domain = keccak256("communique.v1" || country || legislature || template_id || session_id)
```

When `DistrictGate` verifies a proof and records a nullifier for this `action_domain`, an immutable on-chain record links this user's proof to this specific template. The template text is public on the platform. Anyone can look up what template corresponds to the action domain.

**What this binds:** The user authorized *this template* to be sent on their behalf. The template identity is verifiable.

**What this does NOT bind:** The exact message text delivered. If the user personalizes the template via `[Personal Connection]`, that personalization is not on-chain. If the backend modifies the personalization, the on-chain record doesn't catch it.

**Acceptable tradeoff:** Template identity binding via `action_domain` is sufficient for anti-astroturf purposes. The template defines the civic action; the personalization is supplementary. A compromised backend that changes which template is associated with a proof would need to register a different `action_domain` on-chain (subject to 7-day governance timelock), which is detectable.

**Pitfall:** A compromised backend could deliver the correct template but strip or alter the user's personal story. This is a message integrity issue, not an astroturf issue. **Mitigation for Phase 2:** The TEE architecture (AWS Nitro Enclave) constructs the final CWC XML inside the enclave, where the backend cannot tamper with it. The encrypted witness includes both the template and personalization, decryptable only inside the TEE. When the TEE path is deployed, message integrity is cryptographically enforced. Until then, this gap is documented and accepted (see IMPLEMENTATION-GAP-ANALYSIS Round 4, CI-001).

### 3.3 The Blockchain Submission Gap — RESOLVED (Wave 15a, 2026-02-08)

~~As of 2026-02-08, the actual on-chain submission from Communique was mocked.~~

**Resolution:** The mock was replaced with a real ethers.js v6 client in Wave 15a (Cycle 3 anti-astroturf hardening). The implementation includes:
- Real `verifyTwoTreeProof()` calls to DistrictGate on Scroll via EIP-712 signed transactions
- Server-side relayer wallet with NonceManager for nonce safety
- 3-state circuit breaker (closed → open → half_open) preventing cascading RPC failures
- Database-backed retry queue with exponential backoff (30s, 60s, 120s, 240s)
- Balance monitoring with fail-closed semantics on RPC errors
- Nullifier idempotency check before retry (`isNullifierUsed()` on-chain read)

All anti-astroturf mechanisms described in this specification are now **operationally active** when the relayer environment variables (`SCROLL_RPC_URL`, `DISTRICT_GATE_ADDRESS`, `SCROLL_PRIVATE_KEY`) are configured.

**Status:** CI-002 RESOLVED. See IMPLEMENTATION-GAP-ANALYSIS Round 4, ANTI-ASTROTURF-IMPLEMENTATION-PLAN G-01.

---

## 4. Structural Signal Architecture

The protocol's anti-astroturf defense is based on structural signals: measurable properties of submission patterns that reveal coordination structure without exposing individual message content or creating privacy regressions.

### 4.1 Design Principles

1. **Observe, don't gatekeep.** The protocol publishes signal quality metrics. Recipients decide what constitutes legitimate civic engagement.
2. **No content on-chain.** All signals derive from submission metadata (timestamps, districts, authority levels, action domains), never from message content.
3. **No user-visible scores.** Coordination metrics attach to campaigns and action domains, never to individual users. No user sees a "legitimacy score."
4. **Compute off-chain, verify on-chain.** On-chain events are the audit log. Off-chain indexers compute derived metrics. Anyone can run their own indexer.

### 4.2 Available On-Chain Signals

These signals are already emitted by existing contracts or are derivable from public inputs:

| Signal | Source | Privacy Impact | Anti-Astroturf Value |
|--------|--------|---------------|---------------------|
| **Participant count** | `NullifierRegistry.actionParticipantCount` | None | Campaign scale |
| **Unique district count** | `CampaignRegistry.districtCount` | None | Geographic diversity |
| **Submission timestamps** | `ActionSubmitted.timestamp` | None (block time) | Temporal distribution |
| **Authority level** | `TwoTreeProofVerified.authorityLevel` | None (already public) | Identity strength |
| **Action domain** | `TwoTreeProofVerified.actionDomain` | None (template identity) | Template diversity per campaign |
| **Verifier depth** | `TwoTreeProofVerified.verifierDepth` | None | Country/jurisdiction |
| **New district flag** | `ParticipantRecorded.newDistrict` | None | Geographic spread rate |
| **Creator verification** | `CampaignRegistry.verifiedCreators` | None | Creator accountability |

### 4.3 Derived Structural Metrics

From the signals above, the following metrics are computable without any new on-chain data:

**Geographic Diversity Score:**
```
GDS = districtCount / participantCount
```
- Range: `(0, 1]`
- Interpretation: 1.0 = every participant from a different district (maximally diverse). 0.001 = all from the same district (maximally concentrated).
- Requires: existing `CampaignRegistry` data.

**Authority Level Distribution:**
```
ALD = { L1: count, L2: count, L3: count, L4: count, L5: count }
ALD_weighted = Σ(level_i * count_i) / Σ(count_i)
```
- Interpretation: Weighted average near 1.0 = mostly unverified users. Near 3.0+ = mostly passport-verified. A campaign with 97% L1 participants submitting to a high-stakes action domain is a signal.
- Requires: parsing `authorityLevel` from `TwoTreeProofVerified` events.

**Temporal Entropy (computed off-chain):**
```
H_temporal = -Σ p(hour_bin) * log2(p(hour_bin))
```
- Bin submissions into 1-hour windows over the campaign's lifetime.
- High entropy = submissions spread across hours/days (organic pattern).
- Low entropy = concentrated in a single burst (coordination pattern).
- Maximum (uniform across 24 hours) = 4.58 bits.

**Velocity Curve:**
```
v(t) = d(participantCount) / dt
```
- Linear/logistic growth suggests organic adoption.
- Step function (sudden spike) suggests coordinated activation.
- Computable from `ActionSubmitted` event timestamps.

### 4.4 What These Metrics Cannot Detect

**Slow-drip astroturf.** A sophisticated actor can spread 10,000 submissions across weeks, across hundreds of districts, using multiple templates. The structural signals would show organic-looking patterns. This is indistinguishable from genuine grassroots activity because, structurally, it *is* genuine grassroots activity — it's just funded and organized behind the scenes.

**Acceptance:** This is the fundamental limit of any anti-astroturf system that respects privacy and doesn't gatekeep legitimate political organizing. The protocol can detect *clumsy* coordination (bursts, geographic concentration, low authority levels). It cannot detect *sophisticated* coordination that mimics organic behavior. No system can, without surveillance. The protocol does not conduct surveillance.

---

## 5. Nullifier Scoping Revision

### 5.1 Current Scoping

```
action_domain = keccak256("communique.v1" || country || legislature || template_id || session_id)
```

One nullifier per template per congressional session. Server fans out to all representatives. User cannot re-send the same template within the session.

### 5.2 Problem

Users reasonably expect to send a template to their House representative today and their senators next week. The current scoping blocks this — both actions share the same `action_domain` because `template_id` and `session_id` are identical.

This pushes users to the mailto: path (which has no proof, no nullifier, no on-chain record), undermining the entire coordination integrity architecture.

### 5.3 Revised Scoping

```
action_domain = keccak256(
    abi.encodePacked(
        bytes32("communique.v2"),         // Updated protocol prefix
        bytes3(country_code),             // "USA", "GBR", etc.
        bytes8(legislature_id),           // "congress", "parliamt", "council"
        bytes32(template_id),             // Template identifier
        bytes16(session_id),              // "119th" (2025-2027)
        bytes8(recipient_chamber)         // NEW: "senate", "house", "upper", "lower", "council"
    )
)
```

**Impact:**
- User can send a template to House AND Senate (different `recipient_chamber` → different `action_domain` → different nullifiers).
- User still cannot send the same template to the same chamber twice within the session.
- On-chain metrics now distinguish House vs Senate participation.
- Governance must register 2-3 action domains per template instead of 1 (one per chamber the template targets).

**Pitfall:** More action domains means more governance overhead. Each requires a 7-day timelock via `DistrictGate.proposeActionDomain()`. **Mitigation:** Batch registration via a helper contract (`ActionDomainBatchRegistrar`) that proposes multiple domains in a single transaction. The 7-day timelock still applies, but the administrative burden is reduced.

### 5.4 Generalization Beyond Legislatures

The protocol addresses any decision-maker in any context — not only federal legislators. The `recipient_chamber` field generalizes to any organizational subdivision:

| Context | `legislature_id` | `recipient_chamber` | Example |
|---------|-------------------|---------------------|---------|
| US Congress | `"congress"` | `"senate"` / `"house"` | HR 1234 opposition |
| State legislature | `"state_leg"` | `"upper"` / `"lower"` | State bill testimony |
| City council | `"council"` | `"council"` / `"mayor"` | Zoning objection |
| School board | `"school_bd"` | `"board"` | Curriculum petition |
| Corporate board | `"corp_gov"` | `"board"` | Shareholder resolution |
| International body | `"parliamt"` | `"commons"` / `"lords"` | UK parliamentary comment |
| Regulatory agency | `"regulator"` | `"comment"` | Public comment period |

The protocol is infrastructure for verified civic communication, not a congressional messaging tool. The action domain schema must reflect this generality. The `legislature_id` field is a misnomer from the initial CWC-focused design and should be understood as `jurisdiction_type` in the generalized model.

---

## 6. Delivery Path Security Model

### 6.1 The Two-Path Problem

Communique currently has two delivery paths with fundamentally different security properties:

| Property | CWC Path | mailto: Path |
|----------|----------|-------------|
| ZK proof required | Yes (planned) | No |
| Nullifier enforced | Yes (on-chain) | No |
| Content commitment | Via action_domain (template identity) | None |
| Sybil resistance | Cryptographic (one proof per action) | None |
| Delivery verification | CWC API response (trust-based) | OAuth outbox polling (optional) |
| On-chain record | Yes (event emission) | No |
| Unlimited re-sending | Blocked (nullifier) | Possible |

**Problem:** If coordinated campaigns use the mailto: path, all on-chain anti-astroturf mechanisms are bypassed. Decision-makers receive messages from both paths with no way to distinguish verified from unverified.

### 6.2 Resolution

**Principle:** Fence, don't merge. The two paths serve different purposes and should never be conflated.

**Phase 1 (current):**
- mailto: sends are explicitly labeled "unverified" in all communique metrics and database records.
- `CampaignRegistry` does NOT count mailto: submissions in `participantCount` or `districtCount`.
- No reputation credit (Phase 2) for mailto: sends.
- mailto: remains available as an accessibility fallback for users who cannot complete the ZK proof flow.

**Phase 2:**
- Require proof generation before displaying mailto: link. The proof is stored in communique's database as an off-chain eligibility attestation, not submitted on-chain (no gas cost). This creates a verifiable record that the user was eligible without the overhead of on-chain submission.
- Display delivery path in campaign health metrics: "ZK-verified: 5,000 | Unverified email: 12,000". Let recipients interpret the ratio.

**Phase 3:**
- For non-CWC delivery channels (email, API, regulatory comment portals), develop lightweight delivery verification adapters that confirm delivery without CWC's XML format. See [Section 12](#12-decision-maker-context-generalization).

**Pitfall:** Fencing mailto: too aggressively reduces accessibility. Some users (older constituents, those without smartphones capable of ZK proving) may only be able to use mailto:. **Mitigation:** The mailto: path is never removed. It is labeled, not gated. Transparency about verification status is sufficient; exclusion is not.

---

## 7. The Moderation Gap

### 7.1 Current State

Communique's three-layer moderation pipeline (`moderation/index.ts`) runs on template creation:

```typescript
const content = `${template.title}\n\n${template.message_body}`;
```

The user-provided `[Personal Connection]` text, entered at send-time via `ActionBar.svelte`, is **never moderated**. It passes directly into CWC XML construction at `cwc-generator.ts:182`:

```xml
<ConstituentMessage>${personalizedMessage || template.message_body}</ConstituentMessage>
```

**Attack:** A user selects a safe, approved template and injects toxic, illegal, or harmful content via the personalization field. The content reaches congressional offices (or any decision-maker) under the cover of the approved template.

### 7.2 Fix

Run moderation on the combined output (template + personalization) before delivery. In the submission handler, after template resolution and before CWC generation:

```typescript
const finalMessage = resolveTemplate(template.message_body, personalization);
const moderationResult = await moderateContent(finalMessage);
if (moderationResult.blocked) {
  return error(400, { reason: moderationResult.reason });
}
```

**Scope:** This applies to ALL delivery paths that involve server-side delivery (CWC, API-based channels). The mailto: path is client-side and cannot be moderated by the server.

**Pitfall:** Moderation of personalized content introduces latency at send-time. The current moderation pipeline uses Llama Guard + Gemini, which adds 1-3 seconds. **Mitigation:** Use only the fast Layer 0 (Llama Prompt Guard, <200ms) for send-time moderation. Full multi-layer moderation remains at template creation. Send-time moderation catches only safety violations (S1 threats, S4 CSAM), not quality issues.

**Pitfall:** False positives could block legitimate personal stories that discuss violence, abuse, or other sensitive topics relevant to civic advocacy. **Mitigation:** Moderation at send-time should block ONLY categories S1 (violence/threats) and S4 (CSAM), matching the permissive policy from ADR-006. Discussions of policy around violence, drug reform, criminal justice, etc. should pass. This requires the same calibration already applied to template moderation.

---

## 8. Identity Binding and Authority Levels

### 8.1 Authority Level Enforcement

The circuit already produces `authority_level` as a public output (range `[1, 5]`). `DistrictGate.sol` receives it but does not enforce a minimum per action domain.

**Change:** Add per-action-domain minimum authority level to `DistrictGate.sol`:

```solidity
mapping(bytes32 => uint8) public actionDomainMinAuthority;
```

Set the minimum when registering an action domain. The `verifyTwoTreeProof` function checks:

```solidity
uint8 submittedAuthority = uint8(uint256(authorityLevel));
if (submittedAuthority < actionDomainMinAuthority[actionDomain]) revert InsufficientAuthority();
```

**Suggested defaults by context:**

| Context | Minimum Authority | Rationale |
|---------|-------------------|-----------|
| Petition signature | Level 1 (OAuth) | Low barrier, high participation |
| Public comment period | Level 1 (OAuth) | Regulatory access should be broad |
| Legislative CWC message | Level 2 (email+phone verified) | Moderate identity assurance |
| Election-related action | Level 3 (passport verified) | High stakes, strong identity |
| Governance proposal | Level 3 (passport verified) | Protocol integrity |

**Pitfall:** Higher authority requirements exclude more users. Level 3 (passport) excludes anyone without a valid passport. In the US, ~57% of citizens hold a current passport. **Mitigation:** Authority requirements are per-action-domain, not global. Low-stakes actions stay at Level 1. The protocol should err toward inclusion, using authority level as a signal to recipients rather than a gate. The enforcement check can be set to Level 0 (effectively disabled) for action domains where broad participation is prioritized.

### 8.2 Closing the Cross-Provider Sybil Gap

**Current gap (ISSUE-001):** A user with 5 OAuth accounts from 5 providers can create 5 independent `user_secret` values, bypassing nullifier deduplication.

**Resolution approach:** When identity verification is deployed (self.xyz NFC passport scan), the passport attestation produces a unique `identity_commitment = Poseidon2(passport_hash)`. This commitment becomes an input to `user_secret` derivation:

```
user_secret = Poseidon2(identity_commitment, user_entropy)
```

Two OAuth accounts backed by the same passport produce the same `identity_commitment` and therefore the same `user_secret`. Same `user_secret` → same nullifiers → sybil closed.

**Pitfall:** This binds the user's identity to their passport permanently. If a passport is compromised (stolen, cloned), the user cannot rotate their `user_secret` without a new passport. **Mitigation:** Include a `rotation_nonce` (governance-managed, incrementable) in the derivation: `user_secret = Poseidon2(identity_commitment, user_entropy, rotation_nonce)`. A compromised passport triggers a global `rotation_nonce` increment, invalidating all existing secrets and requiring re-registration. This is a severe measure (all users must re-register) but provides a recovery path.

**Phase 1 status:** Identity verification is not deployed. This section specifies the target architecture for Phase 2 deployment.

---

## 9. Campaign Health Metrics

### 9.1 On-Chain Primitives

`CampaignRegistry.sol` already provides:

| Metric | Storage | Source |
|--------|---------|--------|
| `participantCount` | `campaigns[id].participantCount` | Incremented per unique nullifier in `recordParticipation()` |
| `districtCount` | `campaigns[id].districtCount` | Incremented when new `districtRoot` seen |
| `templateCount` | `_campaignTemplates[id].length` | Set at campaign creation, immutable |
| `createdAt` | `campaigns[id].createdAt` | Block timestamp at creation |
| `creator` | `campaigns[id].creator` | Address of campaign creator |
| `verifiedCreator` | `verifiedCreators[creator]` | Governance-set verification status |
| `flagged` | `flaggedCampaigns[id]` | 24-hour timelocked flagging |

### 9.2 Missing Metrics (No Contract Changes Required)

The following metrics are derivable from existing event emissions by an off-chain indexer:

**Last submission timestamp:** Derived from the latest `ActionSubmitted` event for any `actionId` linked to the campaign.

**Authority level distribution:** Derived from `TwoTreeProofVerified` events matched to campaign actions via `actionDomain` → `actionToCampaign` mapping.

**Submission velocity:** Time-series of `ActionSubmitted` event timestamps.

### 9.3 Dashboard Output

For any campaign, the following is computable from existing on-chain data:

```
Campaign: "Net Neutrality Protection Act"
  Templates:            12
  Participants:         8,429
  Unique Districts:     342
  Geographic Diversity: 4.1%  (342 / 8,429)
  Authority Distribution:
    L1 (OAuth):         12%
    L2 (Email+Phone):   31%
    L3 (Passport):      45%
    L4 (Multi-provider): 12%
  Active Period:        6.5 days
  Velocity:             ~1,300/day (steady)
  Creator:              Verified
  Flagged:              No
```

vs.

```
Campaign: "Support SB-4821"
  Templates:            1
  Participants:         14,200
  Unique Districts:     4
  Geographic Diversity: 0.03% (4 / 14,200)
  Authority Distribution:
    L1 (OAuth):         97%
    L2 (Email+Phone):   3%
    L3 (Passport):      0%
  Active Period:        47 minutes
  Velocity:             14,200 in 47 min (burst)
  Creator:              Unverified
  Flagged:              No
```

Neither campaign is blocked. Both reach decision-makers. The metrics speak for themselves.

---

## 10. Off-Chain Coordination Entropy Indexer

### 10.1 Architecture

A subgraph (The Graph), Dune dashboard, or custom indexer that reads on-chain events and computes coordination entropy metrics. The indexer is permissionless — anyone can run one. The protocol provides the data; the indexer provides the interpretation.

### 10.2 Shannon Entropy Calculations

**Temporal entropy (H_temporal):**

Bin `ActionSubmitted` timestamps by hour. Compute Shannon entropy over the distribution:

```
H_temporal = -Σ p(hour) * log2(p(hour))
```

| Pattern | Entropy | Interpretation |
|---------|---------|---------------|
| Uniform over 24 hours | 4.58 bits | Maximum organic spread |
| 80% in single hour | ~0.72 bits | Highly concentrated burst |
| Gaussian centered on 2pm | ~3.2 bits | Normal activity pattern |

**Geographic entropy (H_geographic):**

Map `districtRoot` values from `ParticipantRecorded` events to districts. Compute Shannon entropy over the district distribution:

```
H_geographic = -Σ p(district) * log2(p(district))
```

For 435 US congressional districts, maximum entropy is ~8.76 bits. An astroturf campaign concentrated in 4 districts: ~2.0 bits.

### 10.3 Velocity Curve Analysis

Plot `participantCount` over time from `ActionSubmitted` event timestamps. Classify the shape:

- **Linear growth:** Consistent organic adoption.
- **Logistic (S-curve):** Viral spread with natural saturation.
- **Step function:** Coordinated activation (sudden jump, then plateau).
- **Exponential then cliff:** Paid campaign (funding starts, funding stops).

### 10.4 Trust Properties

The indexer does NOT require trust:
- Input data is on-chain events (immutable, publicly verifiable).
- Entropy calculations are deterministic (anyone can reproduce).
- Multiple independent indexers can cross-validate.
- The protocol does not endorse any specific indexer's interpretation.

---

## 11. ZK Non-Collusion: Verifiable Independence

This section describes a research-phase approach to proving that `user_secret` values were generated independently, not batch-generated by a central coordinator.

### 11.1 The Problem

A well-funded actor can generate 10,000 `user_secret` values from a single seed, distribute them to operatives, and each operative produces valid proofs. The nullifiers are all different (correct per protocol), the districts are diverse (operatives recruited geographically), and the timing is spread. Structurally, this is indistinguishable from organic activity.

The fundamental issue: `user_secret` is currently client-generated with no verifiable entropy source.

### 11.2 Verifiable Entropy via Block Hash Binding

During registration, replace the freely-chosen `registration_salt` with a verifiable entropy commitment:

```
registration_salt = Poseidon2(user_entropy, block_hash_at_registration)
```

Where `block_hash_at_registration` is the Scroll block hash at the time the user's leaf was inserted into Tree 1. The circuit would verify that the `registration_salt` correctly incorporates the block hash that was current when the user root was last updated.

**What this prevents:** Batch secret generation. Each registration must incorporate a different (unpredictable) block hash, so a coordinator cannot pre-generate thousands of secrets in advance.

**What this does NOT prevent:** A coordinator registering operatives one at a time over weeks, each with a fresh block hash. This is a rate-limiting effect, not a prevention.

### 11.3 VDF-Based Registration Proof (Deep Research)

A stronger approach uses a Verifiable Delay Function (VDF):

```
registration_salt = VDF(user_entropy, block_hash, T)
```

Where `T` is a time parameter that requires ~10 seconds of sequential computation. The VDF proof verifies inside the ZK circuit. This prevents:
- Batch generation (each secret requires 10s of computation)
- Parallelization (VDFs are inherently sequential)
- Outsourcing (the VDF must be computed locally for the output to be correct)

**Status:** VDF implementations in Noir do not exist. This requires R&D in ZK-friendly VDF constructions (e.g., Minroot, Sloth++) and integration with the Barretenberg proving backend.

**Timeline:** Phase 3+ (12-24 months). No implementation planned for Phase 1 or 2.

### 11.4 Honest Assessment

ZK non-collusion proofs are an active area of cryptographic research. No production system implements them. The Voter Protocol's two-tree architecture is compatible with future integration, but the current approach relies on structural signals and identity binding, not cryptographic independence proofs. This section documents the research direction for completeness and to inform future protocol evolution.

---

## 12. Decision-Maker Context Generalization

### 12.1 Beyond CWC

The initial architecture was designed around US Congressional Web Contact (CWC) — a specific XML-based API for delivering constituent messages to Senate and House offices. This context shapes much of the existing design: the CWC XML format, the soapbox.senate.gov endpoint, the specific PII requirements, the concept of "congressional districts" as the primary geographic unit.

The protocol's actual scope is broader: verified civic communication to any decision-maker in any context. The generalization applies across delivery channels, jurisdictions, and organizational types.

### 12.2 Delivery Adapters

Each decision-maker context requires a delivery adapter that translates the protocol's verified authorization (ZK proof + action domain) into the recipient's expected format:

| Context | Delivery Channel | Format | Identity Required |
|---------|-----------------|--------|-------------------|
| US Congress (Senate) | CWC API (soapbox.senate.gov) | XML | Full PII |
| US Congress (House) | CWC API (varies by office) | XML | Full PII |
| State legislature | Email / state portal | Varies | Name + address |
| City council | Email / public comment portal | Plaintext/PDF | Name + ward |
| School board | Email | Plaintext | Name + district |
| Regulatory agency | regulations.gov API | JSON | Name + org (optional) |
| Corporate board | Proxy statement / email | PDF | Shareholder proof |
| UK Parliament | parliament.uk API | JSON | Postcode |
| Municipal government | Email / 311 / civic portal | Varies | Address |

### 12.3 Generalized Action Domain Schema

The action domain schema from [Section 5.3](#53-revised-scoping) generalizes cleanly:

```
action_domain = keccak256(
    abi.encodePacked(
        bytes32("communique.v2"),
        bytes3(country_code),
        bytes8(jurisdiction_type),    // "congress", "state_leg", "council", "school_bd", "regulator", "corp_gov"
        bytes32(template_id),
        bytes16(session_id),          // "119th", "2026", "Q1-2026", etc.
        bytes8(recipient_subdivision) // "senate", "house", "upper", "lower", "board", "comment"
    )
)
```

The `session_id` field generalizes beyond congressional sessions:
- **Legislatures:** Congressional/parliamentary session ("119th", "2024-2029")
- **Regulatory:** Comment period identifier ("EPA-2026-0001")
- **Corporate:** Fiscal year or AGM ("FY2026", "AGM-2026")
- **Municipal:** Calendar year ("2026")

### 12.4 Anti-Astroturf Implications

The structural signal architecture (Section 4) applies uniformly across contexts:
- Geographic diversity is meaningful for any jurisdiction with geographic boundaries.
- Temporal distribution reveals coordination in any context.
- Authority level distribution reveals identity strength in any context.
- Template diversity reveals content engagement in any context.

The moderation gap (Section 7) applies to any server-side delivery path. The delivery path security model (Section 6) applies wherever proof-optional channels exist alongside proof-required channels.

---

## 13. Implementation Roadmap

### Phase 1a — Contract-Level ✅ COMPLETE (Cycle 2 Wave 9 + Cycle 3 Waves 14-15)

| Item | Change | Status |
|------|--------|--------|
| CI-001 | Implement real DistrictGate client in communique | ✅ Wave 15a — ethers.js v6 client with circuit breaker, retry queue |
| CI-002 | Add `actionDomainMinAuthority` mapping + enforcement | ✅ Wave 14d — bounds validation + 24h timelock for increases |
| CI-003 | Nullifier scoping: `recipientSubdivision` in action domain | ✅ Wave 14e — `action-domain-builder.ts` with per-chamber scoping |
| CI-004 | Moderate personalized content at send-time | ✅ Wave 10 — Prompt Guard + Llama Guard in `moderatePersonalization()` |

### Phase 1b — Integration ✅ COMPLETE (Cycle 3 Waves 13-15)

| Item | Change | Status |
|------|--------|--------|
| CI-005 | Identity commitment binding across providers | ✅ Wave 14a/14b — `identity_commitment` + `Poseidon2(commitment, entropy)` |
| CI-006 | self.xyz + Didit.me authority level derivation | ✅ Wave 14c + 14R — `deriveAuthorityLevel()` with document_type differentiation |
| CI-007 | Coordination metrics indexer | ✅ Wave 15c — The Graph subgraph (3 contracts, 7 entities, 10 handlers) |
| CI-008 | Campaign health metrics API | ✅ Wave 15d — GDS, ALD, temporal entropy, velocity with 5-min cache |

### Phase 1c — Hardening ✅ COMPLETE (Cycle 3 Wave 13)

| Item | Change | Status |
|------|--------|--------|
| CI-009 | Fail-closed moderation | ✅ Wave 13a — circuit breaker prevents fail-open on service outage |
| CI-010 | Fence mailto: path (label unverified) | ✅ Wave 10 — `verified`/`deliveryMethod` fields in `EmailFlowResult` |
| CI-011 | Submission anonymization | ✅ Wave 13c — `pseudonymous_id` via HMAC-SHA256 replaces `user_id` |
| CI-012 | Delivery confirmation for mailto | ✅ Wave 15e — HMAC tokens with 7-day expiry, timingSafeEqual |

### Phase 2 — Observability (Quarter) — PENDING

| Item | Change | Complexity | Dependency |
|------|--------|-----------|------------|
| CI-013 | Cross-provider dedup via passport hash (full ISSUE-001 closure) | High | Phone OTP anchor |
| CI-014 | Off-chain proof attestation before mailto: display | Medium | CI-001 |
| CI-015 | Delivery adapter architecture for non-CWC channels | High | CI-003 |
| CI-016 | Campaign health metrics dashboard UI | Medium | CI-008 |

### Phase 3 — Research

| Item | Change | Complexity | Dependency |
|------|--------|-----------|------------|
| CI-017 | VDF-based registration entropy (research prototype) | Very High | Noir VDF library |
| CI-018 | ZK non-collusion proofs (academic exploration) | Research | CI-017 |
| CI-019 | Formal analysis of anonymity set degradation | Research | None |

---

## 14. Pitfall Registry

Every design decision in this specification has associated pitfalls. This section consolidates them for reference.

| Decision | Pitfall | Mitigation | Residual Risk |
|----------|---------|-----------|---------------|
| No content hash on-chain | Cannot distinguish unique vs. copy-paste messages | Recipients see actual message text via delivery channels | Template farming is structurally visible via low template diversity |
| Action domain binding (not content binding) | Backend could modify personalization within a template | TEE architecture (Phase 2) prevents backend tampering | Phase 1 gap: backend integrity is trust-based |
| Structural signals over content signals | Sophisticated astroturf mimicking organic patterns is undetectable | No system detects this without surveillance; acceptable limit | Well-funded slow-drip campaigns succeed |
| Per-chamber nullifier scoping | More action domains = more governance overhead | Batch registration helper contract | Governance must register 2-3x more domains |
| Authority level enforcement | Higher requirements exclude more users | Per-action-domain minimums; low-stakes actions stay at Level 1 | ~43% of US citizens lack passports |
| Cross-provider dedup via passport | Passport compromise requires mass re-registration | `rotation_nonce` mechanism | Re-registration is disruptive |
| Fencing mailto: path | Reduces accessibility for non-technical users | mailto: remains available, just labeled unverified | Unverified path may still carry influence |
| Send-time moderation | False positives could block legitimate civic speech about violence/abuse | Use only S1/S4 categories (matching ADR-006 permissive policy) | Edge cases in policy-adjacent content |
| Observable coordination metrics | Legitimate organizing looks like astroturf structurally | Protocol provides signal, not judgment; recipients decide | Political bias in metric interpretation |
| No user-visible reputation | Institutions downstream build their own scoring | Formally prohibited in governance norms; non-composable credentials | Cannot prevent third-party scoring from public data |

---

*This specification is a living document. It will be updated as mitigations are implemented and as the coordination integrity landscape evolves. The version number increments with each substantive change.*

*Cross-references: TRUST-MODEL-AND-OPERATOR-INTEGRITY (Gap 5.6), COMMUNIQUE-INTEGRATION-SPEC (Section 14 resolutions), IMPLEMENTATION-GAP-ANALYSIS (Round 4: CI-001 through CI-015).*
