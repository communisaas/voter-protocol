# Reputation Architecture Specification: Three-Tree ZK Engagement

> **Spec ID:** REP-ARCH-001
> **Version:** 0.3.0
> **Status:** IMPLEMENTATION — Cycles 19-20 complete. Circuit, contracts, prover, and shadow-atlas service layers implemented. v0.2.0: composite engagement score, Shannon diversity index, template adoption quality signal, launch parameters. v0.3.0: resolved four deferred decisions (decay, percentile tiers, authority weighting, soulbound credential) — all resolved as "keep current design."
> **Date:** 2026-03-05
> **Authors:** Architecture Review
> **Companion Documents:** TWO-TREE-ARCHITECTURE-SPEC.md, CHALLENGE-MARKET-ARCHITECTURE.md, COORDINATION-INTEGRITY-SPEC.md, TRUST-MODEL-AND-OPERATOR-INTEGRITY.md
> **Prerequisite:** Two-tree architecture fully operational (Cycle 17)

---

## Executive Summary

Democratic participation is civic labor. Research, sustained engagement, quality drafting, and persistent constituent pressure are uncompensated. The people who do this work — the ones who read the markup, track committee votes, draft testimony that actually reaches the right staffer — deserve cryptographic recognition that cannot be purchased, faked, or confiscated.

This specification extends the two-tree ZK architecture with a **third tree** that commits engagement data into the zero-knowledge proof. The engagement tier becomes a public output of the circuit — verifiable on-chain without revealing what specific actions a person took, how many, or when. Congressional offices receive a coarse credibility signal (5 tiers) alongside the existing district proof. Astroturf operations cannot inflate engagement tier without consuming real nullifiers through real identity-verified interactions.

### Key Properties

1. **Engagement is in the proof, not an attestation.** The circuit verifies engagement data against a Merkle root. No server-side claim required.
2. **Authority cannot be purchased.** `authority_level` (1-5) comes from identity verification (passport, ID, mDL). No token buys it.
3. **Engagement cannot be purchased.** `engagement_tier` (0-4) derives from on-chain nullifier consumption events. No token buys it.
4. **Economic participation is separate.** Stablecoin staking in debate markets uses `sqrt(stake) × 2^tier` weighting — engagement outweighs capital. VOTER token (deferred) cannot boost authority or engagement.
5. **Privacy by construction.** Only `engagement_tier` is public. The underlying `action_count` and `diversity_score` (Shannon diversity index) are private inputs — no behavioral fingerprint leaks. The composite score, tenure, and adoption count are server-side only.
6. **No soulbound token.** The engagement tier lives in the ZK proof (`publicInputs[30]`), not in a separate on-chain credential. Fresh at time of use, no persistent identity linkage.

### Circuit Extension

```
Two-Tree:    29 public inputs  →  user_root, cell_map_root, districts[24], nullifier, action_domain, authority_level
Three-Tree:  31 public inputs  →  + engagement_root, engagement_tier
```

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Architecture Overview](#2-architecture-overview)
3. [Tree 3: Engagement Tree](#3-tree-3-engagement-tree)
4. [Engagement Tier Definitions](#4-engagement-tier-definitions)
   - 4.1 [Tier Table](#41-tier-table)
   - 4.2 [Metric Definitions](#42-metric-definitions) — Shannon diversity, adoption count
   - 4.3 [Tier Derivation Algorithm](#43-tier-derivation-algorithm) — Composite score formula
   - 4.4 [Design Rationale](#44-design-rationale)
   - 4.5 [Template Adoption as Quality Signal](#45-template-adoption-as-quality-signal)
   - 4.6 [Parameters and Governance](#46-parameters-and-governance) — Resolved decisions (v0.3.0), protocol invariants
5. [Circuit Extension](#5-circuit-extension)
6. [Contract Architecture](#6-contract-architecture)
7. [Token Design](#7-token-design)
8. [Anti-Astroturf Integration](#8-anti-astroturf-integration)
9. [Shadow Atlas Changes](#9-shadow-atlas-changes)
10. [Client Integration](#10-client-integration)
11. [Migration Strategy](#11-migration-strategy)
12. [Security Analysis](#12-security-analysis)
13. [Performance Analysis](#13-performance-analysis)
14. [Implementation Roadmap](#14-implementation-roadmap)
15. [Verification Criteria](#15-verification-criteria)
16. [Reputation Layer Architecture](#16-reputation-layer-architecture)

---

## 1. Design Principles

### 1.1 Engagement Compensates Labor, Not Speculation

The token exists because civic labor is real work that currently receives no compensation. Template research, sustained engagement with congressional offices, quality drafting that survives moderation — these deserve economic recognition. The token is the compensation mechanism. Speculation is a natural consequence of any transferable asset and is acceptable, provided it cannot buy authority or engagement.

### 1.2 In-Proof, Not Attestation

Server-side engagement attestations are worthless against a compromised operator. If the operator can sign arbitrary engagement claims, the system devolves to trust. The engagement tier must be derived from data committed in a Merkle tree and verified inside the zero-knowledge circuit. The operator still builds the tree, but the tree is hash-chained, Ed25519-signed, pinned to IPFS, and independently auditable — consistent with the Verifiable Solo Operator model (2026-02-15).

### 1.3 Authority Is Never Purchasable

`authority_level` (1-5) is bound into the user leaf via H4 (BR5-001). It comes from identity verification:

| Level | Source | Purchasable |
|-------|--------|-------------|
| 1 | OAuth-only (unverified) | No |
| 2 | Address-attested (civic data) | No |
| 3 | Identity-verified (ID/drivers license) | No |
| 4 | Passport-verified (NFC passport scan) | No |
| 5 | Government credential (mDL/EUDIW) | No |

No token, no amount of money, no market mechanism can upgrade a user's authority level. This is a protocol invariant.

### 1.4 Pragmatic Cypherpunk Engineering

Privacy is maximized for individuals. Transparency is maximized for patterns. Economic barriers are minimized for participation. Trust is earned through usage, not purchased through investment.

Concretely:
- **Individual privacy:** Only a 5-bucket engagement tier is public. No action history, no timing, no behavioral fingerprint.
- **Pattern transparency:** Aggregate coordination metrics (GDS, ALD, entropy, velocity) remain server-side and visible to congressional offices per COORDINATION-INTEGRITY-SPEC.
- **Minimal barriers:** Engagement tier starts at 0 (New). All civic actions are available at any tier. Higher tiers provide credibility signal, not access gates.
- **Earned trust:** The engagement tier is cryptographically bound to identity_commitment inside the ZK circuit. It cannot be transferred, purchased, or delegated.
- **Graduated trust:** The protocol is present at every level of civic action (Section 4.7). Anonymous visitors contribute to coordination signals; verified participants produce cryptographic proof of engagement. The gap between trust levels is itself a signal — it tells decision-makers whether sentiment is broad, deep, or manufactured.

---

## 2. Architecture Overview

### 2.1 Three-Tree Model

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          THREE-TREE ARCHITECTURE                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌────────────────────────┐ ┌────────────────────────┐ ┌──────────────────────┐ │
│  │  TREE 1: User Identity │ │  TREE 2: Cell Mapping   │ │  TREE 3: Engagement  │ │
│  │  ═════════════════════ │ │  ═════════════════════  │ │  ═══════════════════ │ │
│  │                        │ │                         │ │                      │ │
│  │  Type: Standard Merkle │ │  Type: Sparse Merkle    │ │  Type: Standard      │ │
│  │  Depth: 20-24          │ │  Depth: 20              │ │  Merkle              │ │
│  │  Leaves: User commits  │ │  Leaves: Cell→Districts │ │  Depth: 20           │ │
│  │                        │ │                         │ │  Leaves: Engagement  │ │
│  │  Leaf = H4(            │ │  Leaf = H2(             │ │  commits             │ │
│  │    user_secret,        │ │    cell_id,             │ │                      │ │
│  │    cell_id,            │ │    district_commitment) │ │  Leaf = H2(          │ │
│  │    registration_salt,  │ │                         │ │    identity_commit,  │ │
│  │    authority_level)    │ │  Lifecycle: DYNAMIC     │ │    engagement_data)  │ │
│  │                        │ │  (redistricting)        │ │                      │ │
│  │  Lifecycle: STABLE     │ │                         │ │  Lifecycle: UPDATED  │ │
│  │  (user moves only)     │ │                         │ │  (after actions)     │ │
│  └────────────────────────┘ └────────────────────────┘ └──────────────────────┘ │
│                                                                                 │
│  Cross-Tree Binding: identity_commitment (private) is shared across:            │
│    • Nullifier:        H2(identity_commitment, action_domain)                   │
│    • Engagement leaf:  H2(identity_commitment, engagement_data_commitment)       │
│    • Circuit enforces SAME identity_commitment in both derivations               │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Public Input Layout (31 fields)

| Index | Field | Type | Source |
|-------|-------|------|--------|
| 0 | `user_root` | Field | Tree 1 Merkle root |
| 1 | `cell_map_root` | Field | Tree 2 SMT root |
| 2-25 | `districts[24]` | Field[24] | Cell district slots |
| 26 | `nullifier` | Field | H2(identity_commitment, action_domain) |
| 27 | `action_domain` | Field | Contract-controlled scope |
| 28 | `authority_level` | Field | User verification tier [1-5] |
| 29 | `engagement_root` | Field | **NEW** — Tree 3 Merkle root |
| 30 | `engagement_tier` | Field | **NEW** — Coarse engagement bucket [0-4] |

### 2.3 What Changes vs. Two-Tree

| Component | Two-Tree (Current) | Three-Tree (This Spec) |
|-----------|-------------------|----------------------|
| Public inputs | 29 | 31 (+2) |
| Trees verified | 2 | 3 (+1) |
| Private inputs added | — | engagement_path, engagement_index, action_count, diversity_score |
| New root registry | — | EngagementRootRegistry.sol |
| New DistrictGate path | — | `verifyThreeTreeProof()` |
| New verifier contracts | — | 4 depths (18/20/22/24) for 31-input circuit |

---

## 3. Tree 3: Engagement Tree

### 3.1 Tree Parameters

| Parameter | Value |
|-----------|-------|
| Type | Standard Merkle tree |
| Hash function | Poseidon2 (BN254 scalar field) |
| Depth | 20 (configurable 18-24, same as Tree 1) |
| Capacity | ~1M engagement records at depth 20 |
| Node hash | `H2(left, right)` with DOMAIN_HASH2 = 0x48324d |
| Leaf hash | `H2(identity_commitment, engagement_data_commitment)` |
| Empty leaf | 0 (standard empty Merkle leaf) |

### 3.2 Leaf Structure

```
engagement_leaf = H2(identity_commitment, engagement_data_commitment)

where:
  engagement_data_commitment = H3(engagement_tier, action_count, diversity_score)

H2 uses DOMAIN_HASH2 = 0x48324d (same domain tag as Tree 1/2 node hashing)
H3 uses DOMAIN_HASH3 = 0x48334d (existing, currently "legacy" in main.nr)
```

The `identity_commitment` in Tree 3 MUST be the same `identity_commitment` used for nullifier derivation in the circuit. This is enforced by the circuit using a single private input that feeds both derivations.

### 3.3 Engagement Data Commitment

The `engagement_data_commitment` is a Poseidon2 hash of three values:

| Field | Type | Description |
|-------|------|-------------|
| `engagement_tier` | Field [0-4] | Coarse engagement bucket (public output) |
| `action_count` | Field | Total verified actions (private) |
| `diversity_score` | Field | Shannon diversity index, scaled integer [0-1609] (private) |

**Why H3 (three inputs)?** The engagement data commitment captures the minimum information needed to derive and verify the engagement tier. `action_count` and `diversity_score` are the two primary factors; `engagement_tier` is derived from them but included in the commitment to bind the public output. The circuit verifies that the claimed `engagement_tier` is consistent with the committed data.

**Why not include tenure?** Tenure (account age) is observable from on-chain registration timestamps. Including it in the commitment would add a private input without privacy benefit — the operator and anyone watching the chain can see when a user registered. Tenure is checked server-side during tree construction, not inside the circuit.

### 3.4 Root Lifecycle

The engagement root changes when the operator updates any user's engagement data:

1. **Trigger:** Operator observes new on-chain nullifier consumption events (proof submissions via DistrictGate)
2. **Update:** Operator recomputes engagement metrics for affected users
3. **Rebuild:** Operator updates Tree 3 leaves and recomputes root
4. **Register:** Operator registers new engagement root on-chain via EngagementRootRegistry
5. **Pin:** New tree state and insertion log entry are pinned to IPFS (Storacha + Lighthouse)

**Update frequency:** Batch updates (e.g., daily or after N new nullifier events). Not real-time — engagement tiers don't need sub-hour resolution.

### 3.5 Operator-Computed Engagement

The operator computes engagement data from on-chain events, not from private server state. This is the key anti-inflation property:

- **Input:** On-chain nullifier consumption events from DistrictGate (publicly observable)
- **Output:** Per-user `action_count`, `diversity_score` (Shannon index), `tenure`, `adoption_count` → composite score `E` → `engagement_tier`
- **Verification:** Anyone can replay the on-chain event log and independently derive the same engagement metrics

The operator CANNOT inflate engagement because:
1. Nullifier events are on-chain and immutable
2. Each nullifier requires a valid ZK proof (which requires a real identity-verified registration)
3. The engagement tree is hash-chained and IPFS-pinned per the Verifiable Solo Operator model
4. An independent auditor can replay chain events and verify the engagement tree matches

**Limitation:** The operator could selectively EXCLUDE valid engagement events (censorship). This is mitigated by the insertion log + IPFS hash-chain — exclusion gaps are detectable by comparing chain event counts to tree leaf counts.

---

## 4. Engagement Tier Definitions

### 4.1 Tier Table

Tiers are derived from a composite engagement score `E` (Section 4.3). The boundaries below are fixed at launch and governance-adjustable post-launch (Section 4.6).

| Tier | Name | Composite Score (E) | Description |
|------|------|---------------------|-------------|
| 0 | New | E = 0 | Registered but no verified civic actions |
| 1 | Active | E > 0 | Any verified engagement — one action in one category suffices |
| 2 | Established | E >= 5.0 | Sustained engagement with some diversity and depth |
| 3 | Veteran | E >= 12.0 | Deep, diverse, long-term civic participation |
| 4 | Pillar | E >= 25.0 | Exceptional sustained civic labor across multiple dimensions |

The composite score replaces the earlier hard-threshold cascade (which required independent minimums on `action_count`, `diversity_score`, and `tenure`). The motivation for this change is documented in Section 4.4.

### 4.2 Metric Definitions

**`action_count`**: Total number of distinct nullifier consumption events attributed to this identity commitment. Each successful proof submission to DistrictGate that consumes a nullifier counts as one action. The same identity cannot produce duplicate nullifiers for the same action domain (by construction).

**`diversity_score` (Shannon Diversity Index)**: Measures the *evenness* of a user's civic engagement across action categories, not merely the count of categories touched.

The Shannon diversity index, borrowed from ecology (where it measures species diversity in an ecosystem), is defined as:

```
H = -Σ(pᵢ × ln(pᵢ))   for all categories i where pᵢ > 0
```

where `pᵢ` is the proportion of the user's total actions that fall in category `i`.

**Properties:**
- **Minimum:** H = 0 when all actions fall in a single category.
- **Maximum:** H = ln(N) where N is the number of categories. For 5 categories, H_max = ln(5) ≈ 1.609.
- **Evenness-sensitive:** A user with 199 congressional contacts and 1 template has H ≈ 0.03. A user with 40 actions in each of 5 categories has H ≈ 1.609. The former touched two categories but is effectively a single-channel spammer; the latter is genuinely diverse.

**Storage format:** `diversityScore = floor(H × 1000)`, yielding an integer in the range [0, 1609]. This preserves three decimal digits of precision while remaining a Field-compatible integer in the circuit. The circuit does not range-check `diversity_score` — it is a private input that feeds the H3 engagement data commitment. Only the derived `engagement_tier` [0-4] is range-checked.

**Why Shannon over integer category count:** A simple category count (the prior design) rewards touching N categories with a single action each. This is trivially gameable — one message per category achieves maximum diversity. Shannon rewards *sustained, even* engagement across categories. The cost to achieve high Shannon diversity is proportionally distributed effort, not one-off touches.

**Action Categories:** Categories are resolved via a server-side **ActionCategoryRegistry** that maps action domain hashes to category indices (1-5). This registry is necessary because action domains are `keccak256(abi.encodePacked(...)) % BN254_MODULUS` — the hash output has no structured prefix byte, so category cannot be extracted from the domain bytes directly.

| Category | Index | Example |
|----------|-------|---------|
| Congressional contact | 1 | Sending a message to a representative |
| Template creation | 2 | Creating a reusable advocacy template |
| Challenge participation | 3 | Staking in a challenge market (Phase 2) |
| Campaign support | 4 | Endorsing or co-signing a campaign |
| Governance vote | 5 | Voting on protocol parameters (Phase 2) |

The registry is populated when action domains are whitelisted in DistrictGate's `allowedActionDomains` mapping. The operator maintains a JSON file (`ACTION_CATEGORY_REGISTRY` env var) mapping each whitelisted domain hash to its category index. At server startup, the file is loaded into an in-memory `Map<string, number>` via `createActionCategoryRegistry()`. If the env var is unset, the registry starts empty and `diversityScore` defaults to 0 for all users.

Maximum `diversityScore` = floor(ln(5) × 1000) = 1609. Adding new categories increases the theoretical maximum, but since tier boundaries are defined by the composite score (not by `diversityScore` alone), category proliferation does not directly enable tier inflation.

**`tenure`**: Time since first nullifier consumption event for this identity commitment, measured in months (floor division: `floor(seconds / (30 × 86400))`). Checked server-side during tree construction, not in-circuit (see Section 3.3).

**`adoption_count`**: Total number of times this user's templates have been adopted by other verified identities. Each adoption requires a valid ZK proof from a distinct identity, making it Sybil-resistant by construction. Counted from on-chain `CampaignRegistry` events and/or server-side adoption tracking. This metric is used only in the composite engagement score (Section 4.3) and is not committed into the engagement tree leaf.

### 4.3 Tier Derivation Algorithm

#### 4.3.1 Composite Engagement Score

The engagement tier is derived from a single composite score `E` that multiplicatively combines four dimensions of civic engagement:

```
E = log₂(1 + actionCount)
  × (1 + shannonDiversity)
  × (1 + √(tenureMonths / 12))
  × (1 + log₂(1 + adoptionCount) / 4)
```

where:
- `actionCount` — total distinct nullifier consumption events (Section 4.2)
- `shannonDiversity` — Shannon diversity index H = -Σ(pᵢ × ln(pᵢ)) (Section 4.2)
- `tenureMonths` — months since first nullifier event (Section 4.2)
- `adoptionCount` — total template adoptions by other verified identities (Section 4.2)

**Dimension rationale:**

| Factor | Formula | Property | Why |
|--------|---------|----------|-----|
| Action count | `log₂(1 + n)` | Logarithmic, diminishing returns | First 10 actions matter more than actions 990-1000. Anti-spam: linear action count rewards grinding; log rewards consistency. |
| Shannon diversity | `1 + H` | Multiplicative, evenness-weighted | Rewards *even distribution* across categories, not just touching N categories. H = 0 (single category) yields multiplier 1×; H ≈ 1.6 (perfect 5-way distribution) yields multiplier 2.6×. |
| Tenure | `1 + √(months / 12)` | Square-root, diminishing returns | Rewards sustained participation without hard cliffs. 12 months yields 2×; 48 months yields 3×. No arbitrary "must be active for 6 months" gates. |
| Adoption | `1 + log₂(1 + n) / 4` | Logarithmic, heavily damped | Quality signal for template creators. 15 adoptions yields ~1× additional multiplier. Damped by /4 to prevent template-farming dominance. |

**Multiplicative composition:** If any dimension is at its minimum (0 actions, 0 diversity, 0 tenure, 0 adoptions), `E` is bounded to that dimension's contribution. A user cannot compensate for zero diversity by spamming actions. This is the key anti-gaming property — the score rewards *balanced* civic engagement.

#### 4.3.2 Tier Assignment

```
function computeCompositeScore(actionCount, shannonDiversity, tenureMonths, adoptionCount):
  if actionCount == 0:
    return 0.0
  actionFactor  = log2(1 + actionCount)
  diversityMult = 1 + shannonDiversity
  tenureMult    = 1 + sqrt(tenureMonths / 12)
  adoptionMult  = 1 + log2(1 + adoptionCount) / 4
  return actionFactor * diversityMult * tenureMult * adoptionMult

function deriveTier(actionCount, diversityScore, tenureMonths, adoptionCount):
  // diversityScore is stored as floor(H × 1000); convert back to float
  shannonH = diversityScore / 1000.0
  E = computeCompositeScore(actionCount, shannonH, tenureMonths, adoptionCount)

  if E >= 25.0: return 4  // Pillar
  if E >= 12.0: return 3  // Veteran
  if E >= 5.0:  return 2  // Established
  if E > 0.0:   return 1  // Active
  return 0                // New
```

#### 4.3.3 Worked Examples

**Example A: Single-category spammer** — 200 congressional contacts, 0 templates, 0 other categories, 3 months tenure, 0 adoptions.
- `shannonH` = 0 (all actions in one category)
- `E = log₂(201) × (1 + 0) × (1 + √(3/12)) × (1 + 0) = 7.65 × 1 × 1.5 × 1 = 11.5`
- **Tier 2** (Established). Despite 200 actions, lack of diversity caps the score below Veteran.

**Example B: Balanced moderate user** — 40 actions evenly across 5 categories, 10 months tenure, 0 adoptions.
- `shannonH` = ln(5) ≈ 1.609
- `E = log₂(41) × (1 + 1.609) × (1 + √(10/12)) × (1 + 0) = 5.36 × 2.609 × 1.913 × 1 = 26.7`
- **Tier 4** (Pillar). Even engagement across all categories with sustained tenure reaches the top.

**Example C: Template creator with organic adoption** — 15 actions (10 templates, 5 campaigns), 6 months tenure, 30 adoptions.
- `shannonH` = -(2/3 × ln(2/3) + 1/3 × ln(1/3)) ≈ 0.637
- `E = log₂(16) × (1 + 0.637) × (1 + √(6/12)) × (1 + log₂(31)/4) = 4 × 1.637 × 1.707 × 2.238 = 25.0`
- **Tier 4** (Pillar). High-quality template creation with real adoption compensates for moderate action count.

**Example D: New user, one action** — 1 congressional contact, 0 months tenure, 0 adoptions.
- `shannonH` = 0 (single action, single category)
- `E = log₂(2) × (1 + 0) × (1 + 0) × (1 + 0) = 1.0`
- **Tier 1** (Active). Any engagement immediately exits tier 0.

### 4.4 Design Rationale

**Why 5 tiers (0-4) instead of continuous?** Coarse bucketing prevents behavioral fingerprinting. If engagement were a continuous score (e.g., 0-10000), observers could correlate score changes across actions to deanonymize users. Five tiers provide meaningful credibility signal with minimal information leakage.

**Why composite score instead of hard threshold cascade?** The original design required independent minimums on `action_count`, `diversity_score`, and `tenure` for each tier. This created perverse incentives: a user at 199 actions and 3 categories was tier 2 (Established) regardless of tenure or quality. The composite score treats engagement as a multi-dimensional phenomenon — depth (actions), breadth (diversity), consistency (tenure), and quality (adoption) are multiplicatively combined. Weakness in any dimension limits the score without creating artificial cliffs.

**Why Shannon diversity, not integer category count?** A simple "number of distinct categories" metric rewards touching N categories with one action each — trivially gameable. Shannon diversity measures *evenness of distribution*. A user with 199 congressional contacts and 1 template has H ≈ 0.03 despite touching 2 categories. A user with 40 actions evenly across 5 categories has H ≈ 1.609. Shannon correctly identifies the former as a single-channel user and the latter as genuinely diverse. This metric originates from information theory and is standard in ecology for measuring species diversity.

**Why logarithmic action count?** Linear action count rewards grinding — the 1000th action is as valuable as the 1st. Logarithmic scaling provides diminishing returns: the first 10 actions contribute as much as actions 10-100, and as much as actions 100-10000. This matches the intuition that initial civic engagement is the hardest step, and sustained engagement at any level is more valuable than volume.

**Why template adoption as a quality signal?** Template adoption is the only metric that simultaneously satisfies three constraints: (1) **privacy** — no content observation required, adoption is countable from on-chain events and `CampaignRegistry`; (2) **Sybil-resistance** — each adoption requires a valid ZK proof from a verified identity; (3) **credible neutrality** — adoption reflects revealed preference, not assessed quality. No moderator decides what is "good." The market decides by using it. See Section 4.5.

**Why is tenure server-side, not in-circuit?** Registration timestamps are public on-chain. Including tenure in the circuit commitment would add a private input without privacy gain — it's already publicly derivable. Keeping it server-side reduces circuit complexity.

**Why multiplicative composition?** Additive composition allows a user to compensate for zero diversity by spamming 10000 actions. Multiplicative composition means that if any factor is at its base value (multiplier = 1), the score is capped by the remaining factors. This enforces balanced engagement without requiring hard minimums on each dimension.

### 4.5 Template Adoption as Quality Signal

Template adoption rate is the only quality signal satisfying three simultaneous constraints:

| Constraint | Requirement | How Adoption Satisfies It |
|------------|-------------|--------------------------|
| Privacy | No content observation | Adoption is a count, not a content judgment. Countable from on-chain nullifier events + CampaignRegistry without reading template text. |
| Sybil-resistance | Each signal requires a real identity | Each adoption requires a valid ZK proof from a verified identity commitment. Fake adoptions require fake identity registrations (real-world cost per Sybil). |
| Credible neutrality | No subjective assessment | Adoption is revealed preference. No moderator or algorithm decides what is "quality." Users adopt templates by choosing to use them for their own civic actions. |

**Integration into composite score:** Adoption appears as the fourth multiplicative factor: `1 + log₂(1 + adoptionCount) / 4`. The logarithm provides diminishing returns (the 100th adoption is less impactful than the 10th). The `/4` damping prevents template-farming from dominating the score — even with 1000 adoptions, the adoption multiplier is ~3.5×, which cannot substitute for zero actions or zero diversity.

**Zero-adoption default:** Users who do not create templates have `adoptionCount = 0`, yielding a multiplier of 1×. Template adoption is a bonus for quality creators, not a requirement for tier advancement.

**No circuit or contract changes required:** `adoptionCount` feeds into the composite score computation (server-side), which produces the `engagement_tier` [0-4]. The tier is what enters the circuit. The adoption count itself is never committed to the engagement tree — only the derived tier and the underlying `action_count` and `diversity_score` appear in the H3 commitment.

### 4.6 Parameters and Governance

#### 4.6.1 Resolved Design Decisions (v0.3.0)

Four parameters were originally deferred pending usage data. All four resolve to "keep current design" — the principles established in this spec already answer each question.

| Decision | Resolution | Rationale |
|----------|-----------|-----------|
| **Metric decay** | **No decay. Permanent.** | Engagement tiers measure cumulative civic labor, not recency. If someone spent months researching legislation and drafting quality templates, that work happened — it doesn't expire. Recency is already captured by server-side coordination metrics (temporal velocity, surge detection, per-campaign tier distribution). Decay would also create a perverse incentive: maintenance engagement performed to prevent tier erosion, not because the person has something civic to say. |
| **Percentile-based tiers** | **No. Fixed thresholds permanently.** | Percentile tiers make reputation zero-sum: your tier depends on what everyone else does. A wave of new active users would demote existing Veterans — not because they changed, but because the population changed. This contradicts the cooperative ethos of civic infrastructure. Fixed thresholds are deterministic, individually controllable, stable, and cooperative. If the platform produces a population where many people sustain balanced engagement and reach Pillar, that is a healthy civic ecosystem, not a problem to solve. The composite formula's logarithmic and square-root scaling already prevents tier inflation through diminishing returns. |
| **Authority weighting** | **No. Equal weighting permanently.** | Weighting engagement by authority level violates the Separation Principle (Section 7.2). Authority measures identity verification strength; engagement measures civic labor. A person with a passport does not do more civic work per action than a person with a state ID. The Sybil resistance argument does not hold: engagement only derives from ZK-verified actions (trust level 3), and the Sybil boundary is at identity registration, not at engagement weighting. Once verified, all actions carry equal weight. |
| **Soulbound credential (ERC-8004)** | **Not building.** | The engagement tier is already a public output of the ZK circuit (`publicInputs[30]`). Any contract receiving a three-tree proof already has the tier, fresh and current. An ERC-8004 token would be redundant (caching what the proof provides), stale (might not reflect latest tree update), and privacy-reducing (persistent on-chain link between address and tier). The tier-in-proof design is strictly superior: proven fresh at time of use, no persistent identity linkage, no stale data. External contracts that want to gate on tier should require a proof. |

#### 4.6.2 Parameters

| Parameter | Value | Governance-Adjustable |
|-----------|-------|----------------------|
| Tier boundaries | E: 0, >0, ≥5, ≥12, ≥25 | Yes (7-day timelock, must include simulation results) |
| Category count | 5 categories | Yes (operator config, not protocol upgrade) |
| Category weights | All weights = 1 | Yes (7-day timelock) |
| Adoption damping factor | `/4` divisor | Yes (7-day timelock) |
| Adoption source | CampaignRegistry events | Expand as new on-chain signals emerge |
| Metric decay | None (permanent) | **No** — protocol invariant (v0.3.0) |
| Authority weighting | Equal (all levels 1×) | **No** — protocol invariant (v0.3.0) |

#### 4.6.3 Protocol Invariants

These are constitutional properties, not tunable parameters:

- The composite score formula structure (multiplicative, four dimensions) — changing the formula is a protocol upgrade, not a parameter change.
- The tier count (5 tiers, 0-4) — bound into the circuit's range check.
- The Shannon diversity definition — H = -Σ(pᵢ × ln(pᵢ)) is a mathematical identity, not a parameter.
- The separation principle (authority, engagement, and tokens are independent).
- **No metric decay** — engagement tiers are a permanent floor of cumulative civic labor. Recency belongs in coordination metrics.
- **No authority weighting** — all verified actions carry equal engagement credit regardless of credential type.
- **No soulbound token** — the engagement tier lives in the ZK proof, not in a persistent on-chain token. This is the privacy-correct design.
- **No percentile-based tiers** — reputation is cooperative, not competitive. Fixed thresholds ensure your tier depends only on your own actions.

---

## 4.7 Graduated Trust Model

The engagement tier system operates within a broader graduated trust architecture where the protocol is present at every level of civic action — not just for ZK-verified users. Three trust levels produce a coordination signal that no single level can generate alone.

### 4.7.1 Trust Levels

| Level | Name | Authentication | What's Tracked | Engagement Impact |
|-------|------|----------------|----------------|-------------------|
| 1 | Unverified | None | Anonymous event counter per action domain | None (no identity to attribute) |
| 2 | Wallet-Bound | Wallet connection | Signed action attestations | Pre-registration for identity map |
| 3 | ZK-Verified | Identity verification + on-chain proof | Nullifier consumption events | Full engagement metrics → tier derivation |

**Level 1** (Unverified): Anonymous counters keyed by action domain hash (jurisdiction + template + session). No IP, no session, no fingerprint. The counter increments when a user initiates a civic action (e.g., clicks a mailto: link). This is not behavioral surveillance — it is the minimum viable signal that civic intention exists.

**Level 2** (Wallet-Bound): Actions linked to a pseudonymous wallet address via signed attestation. The wallet reveals nothing about the person behind it. Attestations populate the `signer → identityCommitment` map that enables later engagement tracking when the user verifies their identity.

**Level 3** (ZK-Verified): Full protocol path — browser-native proof generation, on-chain nullifier consumption, engagement metrics derived from chain events. This is where `engagement_tier` [0-4] originates and enters the circuit.

### 4.7.2 The Coordination Authenticity Index

The ratio between trust levels is the protocol's strongest anti-astroturf signal:

```
Coordination Authenticity Index = Level3_count / Level1_count
```

A genuine grassroots campaign produces a healthy graduation rate (e.g., 5-15% of Level 1 users eventually reach Level 3). An astroturf campaign shows massive Level 1 volume with near-zero Level 3 conversion — anonymous clicks are cheap, but maintaining verified identities with real engagement history over months is economically prohibitive.

**Why this beats petition counts**: Traditional petition platforms report a single number (e.g., "50,000 signatures"). The graduated trust model reports a distribution across trust levels, giving decision-makers a richer signal about the authenticity and depth of constituent sentiment.

### 4.7.3 Implementation Notes

- **Level 1 counters are server-side only.** They are NOT committed to any Merkle tree or on-chain state. They feed into aggregate coordination metrics (per COORDINATION-INTEGRITY-SPEC) and the coordination authenticity index.
- **Level 1 counters are ephemeral per session period.** They reset when the `sessionId` component of the action domain changes (e.g., new congressional session). No long-term accumulation of anonymous counts.
- **No engagement tier derives from Level 1.** Only Level 3 (ZK-verified) actions produce nullifier events that feed `EngagementTreeBuilder`. The engagement tier is cryptographically grounded, not socially inferred.
- **The graduation funnel is one-directional.** Users flow from Level 1 → 2 → 3 as they authenticate and verify. There is no downgrade path — once verified, always verified (identity credentials don't expire within a session period).

---

## 5. Circuit Extension

### 5.1 Three-Tree Circuit: Public Inputs (31 fields)

```noir
fn main(
    // ═══════════════════════════════════════════════════
    // PUBLIC INPUTS (31 total)
    // ═══════════════════════════════════════════════════
    user_root: pub Field,                   // [0]  Tree 1 root
    cell_map_root: pub Field,               // [1]  Tree 2 root
    districts: pub [Field; 24],             // [2-25] District slots
    nullifier: pub Field,                   // [26] Anti-double-vote
    action_domain: pub Field,               // [27] Contract scope
    authority_level: pub Field,             // [28] Verification tier [1-5]
    engagement_root: pub Field,             // [29] Tree 3 root     ← NEW
    engagement_tier: pub Field,             // [30] Engagement [0-4] ← NEW

    // ═══════════════════════════════════════════════════
    // PRIVATE INPUTS (witnesses)
    // ═══════════════════════════════════════════════════
    user_secret: Field,
    cell_id: Field,
    registration_salt: Field,
    identity_commitment: Field,

    // Tree 1: Standard Merkle proof
    user_path: [Field; TREE_DEPTH],
    user_index: u32,

    // Tree 2: SMT proof
    cell_map_path: [Field; TREE_DEPTH],
    cell_map_path_bits: [u1; TREE_DEPTH],

    // Tree 3: Engagement proof                          ← NEW
    engagement_path: [Field; TREE_DEPTH],               // Merkle siblings
    engagement_index: u32,                              // Leaf position
    action_count: Field,                                // Private metric
    diversity_score: Field,                             // Private metric
)
```

### 5.2 Circuit Logic (Pseudocode)

Steps 1-4 are identical to the two-tree circuit. Steps 5-7 are new.

```
// PRE-CHECKS (inherited from two-tree circuit):
//   assert(user_secret != 0)
//   assert(identity_commitment != 0)   // NUL-001: prevents predictable nullifiers
//   validate_authority_level(authority_level)  // [1, 5] with overflow guard

// Steps 1-4: UNCHANGED from two-tree circuit
// Step 1: Verify user identity (Tree 1)
// Step 2: Compute district commitment (sponge)
// Step 3: Verify cell mapping (Tree 2)
// Step 4: Verify nullifier (identity_commitment + action_domain)

// ═══════════════════════════════════════════════════════
// Step 5: Validate engagement_tier range [0, 4]         ← NEW
// ═══════════════════════════════════════════════════════
assert(engagement_tier as u64 < 256, "Engagement tier exceeds u8 range");
let tier_u8 = engagement_tier as u8;
assert(tier_u8 <= 4, "Engagement tier above maximum (4)");

// ═══════════════════════════════════════════════════════
// Step 6: Compute and verify engagement commitment      ← NEW
// ═══════════════════════════════════════════════════════
// Bind engagement data to commitment
let engagement_data_commitment = poseidon2_hash3(
    engagement_tier,
    action_count,
    diversity_score
);

// Compute engagement leaf (binds to same identity_commitment as nullifier)
let engagement_leaf = poseidon2_hash2(
    identity_commitment,       // SAME identity_commitment as Step 4
    engagement_data_commitment
);

// ═══════════════════════════════════════════════════════
// Step 7: Verify engagement tree membership (Tree 3)    ← NEW
// ═══════════════════════════════════════════════════════
let computed_engagement_root = compute_merkle_root(
    engagement_leaf,
    engagement_path,
    engagement_index
);
assert(
    computed_engagement_root == engagement_root,
    "Tree 3: Engagement Merkle proof verification failed"
);
```

### 5.3 Cross-Tree Identity Binding

The `identity_commitment` private input is used in TWO places:

1. **Nullifier (Step 4):** `nullifier = H2(identity_commitment, action_domain)`
2. **Engagement leaf (Step 6):** `engagement_leaf = H2(identity_commitment, engagement_data_commitment)`

Because the circuit uses a SINGLE `identity_commitment` variable for both derivations, a prover cannot use different identities for the nullifier and the engagement proof. This binds the engagement record to the same verified person.

**Attack prevented:** Without this binding, an attacker could use their own identity for the nullifier (to pass double-vote checks) but substitute a high-engagement user's identity for the engagement proof (to claim a higher tier). The shared private input makes this impossible.

### 5.4 Constraint Analysis

| Component | Estimated Constraints | Notes |
|-----------|----------------------|-------|
| Tree 1 verification | ~8,000 | 20 levels × ~400 per Poseidon2 |
| District sponge (24) | ~3,200 | 8 absorption rounds × ~400 |
| Tree 2 verification | ~8,000 | 20 levels × ~400 per Poseidon2 |
| H4 leaf computation | ~800 | 2-round sponge |
| H2 cell map leaf | ~400 | Single permutation |
| Nullifier derivation | ~400 | Single permutation |
| Authority validation | ~50 | Range checks |
| **Two-tree subtotal** | **~20,850** | |
| | | |
| H3 engagement data | ~400 | Single permutation (NEW) |
| H2 engagement leaf | ~400 | Single permutation (NEW) |
| Tree 3 verification | ~8,000 | 20 levels × ~400 per Poseidon2 (NEW) |
| Engagement tier validation | ~50 | Range check (NEW) |
| **Three-tree total** | **~29,700** | **+42% vs two-tree** |

### 5.5 New Constants

```noir
// Engagement tier bounds
global MIN_ENGAGEMENT_TIER: Field = 0;
global MAX_ENGAGEMENT_TIER: Field = 4;
```

### 5.6 Hash Function Reuse

All hash functions needed for Tree 3 already exist in the two-tree circuit:

| Function | Domain Tag | Current Use | New Use |
|----------|-----------|-------------|---------|
| `poseidon2_hash2` | DOMAIN_HASH2 (0x48324d) | Cell map leaf, nullifier, Merkle nodes | Engagement leaf, Tree 3 nodes |
| `poseidon2_hash3` | DOMAIN_HASH3 (0x48334d) | Legacy (test compatibility) | Engagement data commitment |

No new hash functions or domain tags are required.

---

## 6. Contract Architecture

### 6.1 EngagementRootRegistry

New registry contract, parallel to UserRootRegistry and CellMapRegistry:

```solidity
contract EngagementRootRegistry is TimelockGovernance {
    struct EngagementRootMetadata {
        uint8 depth;            // Merkle tree depth (18, 20, 22, or 24)
        bool isActive;          // Governance toggle (default true on registration)
        uint32 registeredAt;    // Registration timestamp
        uint64 expiresAt;       // Auto-sunset timestamp (0 = never expires)
    }

    mapping(bytes32 => EngagementRootMetadata) public engagementRoots;

    function registerEngagementRoot(bytes32 root, uint8 depth)
        external onlyGovernance
    {
        engagementRoots[root] = EngagementRootMetadata(depth, true, uint32(block.timestamp), 0);
    }

    function isValidEngagementRoot(bytes32 root) public view returns (bool) {
        EngagementRootMetadata memory meta = engagementRoots[root];
        if (meta.registeredAt == 0) return false;
        if (!meta.isActive) return false;
        if (meta.expiresAt != 0 && block.timestamp > meta.expiresAt) return false;
        return true;
    }

    // Lifecycle: initiateRootDeactivation → executeRootDeactivation (7-day timelock)
    // Also: initiateRootExpiry, initiateRootReactivation, cancelRootOperation
}
```

**Lifecycle:** Follows the same REGISTERED→ACTIVE→SUNSET→EXPIRED model as UserRootRegistry. No `country` field (engagement is not country-scoped). Root registration is immediate (governance only). Deactivation/expiry/reactivation use 7-day timelocks. Sunset grace period: 7 days (shorter than UserRootRegistry's 30 days because engagement roots change more frequently).

### 6.2 DistrictGate Extension

New function alongside existing `verifyTwoTreeProof()`:

```solidity
function verifyThreeTreeProof(
    address signer,
    bytes calldata proof,
    uint256[31] calldata publicInputs,  // 29 → 31
    uint8 verifierDepth,
    uint256 deadline,
    bytes calldata signature
) external whenNotPaused {
    // Steps 0-4: Identical to verifyTwoTreeProof (signature, roots, nullifier)

    // Step 5: Validate engagement_root via EngagementRootRegistry
    bytes32 engagementRoot = bytes32(publicInputs[29]);
    if (!engagementRootRegistry.isValidEngagementRoot(engagementRoot))
        revert InvalidEngagementRoot();

    // Step 6: Validate engagement_tier range [0, 4]
    uint256 engagementTierRaw = publicInputs[30];
    require(engagementTierRaw <= 4, "Engagement tier out of range");

    // Step 7: Route to three-tree verifier
    // NOTE: No country cross-check — EngagementRootRegistry is not country-scoped.
    // Country validation is already handled via UserRootRegistry in Steps 0-4.
    address verifier = verifierRegistry.getThreeTreeVerifier(verifierDepth);
    // ... verify proof against verifier ...

    // Step 8: Record nullifier + emit event with engagement_tier
    emit ThreeTreeProofVerified(
        signer,
        nullifier,
        actionDomain,
        uint8(authorityLevel),
        uint8(engagementTierRaw)
    );
}
```

### 6.3 Verifier Contracts

New Honk verifiers generated for the 31-input circuit at each depth:

| Depth | Circuit | Verifier Size (est.) |
|-------|---------|---------------------|
| 18 | `three_tree_membership_18` | ~22KB |
| 20 | `three_tree_membership_20` | ~26KB |
| 22 | `three_tree_membership_22` | Split deployment |
| 24 | `three_tree_membership_24` | Split deployment |

Verifiers are registered separately from two-tree verifiers in VerifierRegistry (using a `threeTreeVerifiers` mapping or a composite key `(depth, circuitType)`).

### 6.4 Gas Analysis

| Operation | Two-Tree (measured) | Three-Tree (estimated) | Delta |
|-----------|-------------------|----------------------|-------|
| Proof verification | ~2.1M gas | ~2.1M gas | ~0% |
| Root validation | ~6K (2 lookups) | ~9K (3 lookups) | +3K |
| Nullifier recording | ~22K | ~22K | 0 |
| Event emission | ~2K | ~2.5K | +0.5K |
| **Total** | **~2.2M** | **~2.2M** | **<+0.3%** |

The gas increase from two additional public inputs is negligible because the on-chain verifier cost is dominated by pairing operations (~2.1M gas), which do not change with 2 extra fields. Two-tree gas measured on Scroll Sepolia (TX `0xc6ef86a3...`).

### 6.5 EIP-712 TypeHash

```solidity
bytes32 constant SUBMIT_THREE_TREE_PROOF_TYPEHASH = keccak256(
    "SubmitThreeTreeProof(bytes32 proofHash,bytes32 publicInputsHash,uint8 verifierDepth,uint256 nonce,uint256 deadline)"
);
```

---

## 7. Token Design

### 7.1 Token Model

**VOTER (ERC-20, transferable) — DEFERRED**

| Property | Value |
|----------|-------|
| Standard | ERC-20 |
| Transfer | Unrestricted |
| Supply | 100M initial, SupplyAgent-controlled emissions |
| Purpose | Compensate civic labor, power challenge markets, protocol governance |
| Influence | `sqrt(stake)` in challenge markets (quadratic) |
| Speculation | Permitted (cannot buy authority or engagement) |
| Status | Deferred to Phase 2+. Reputation tiers + stablecoin staking sufficient for Phase 1. |

**Engagement Tier — In-Proof (no separate token)**

The engagement tier is a public output of the ZK circuit (`publicInputs[30]`), not a separate on-chain token. This is a deliberate design choice (resolved v0.3.0):

- **Fresh**: Proven at the time of each action, not cached in stale on-chain state.
- **Private**: No persistent link between an address and a tier. The tier exists only in the proof.
- **Sufficient**: Any contract receiving a three-tree proof already has the tier. No additional token needed.

An ERC-8004 soulbound credential was considered and rejected (Section 4.6.1). The tier-in-proof design is strictly superior for privacy, freshness, and simplicity.

### 7.2 The Separation Principle

Authority, engagement, and economic participation are cryptographically independent:

| Dimension | Source | In ZK Proof | Purchasable |
|-----------|--------|-------------|-------------|
| `authority_level` (1-5) | Identity verification (passport/ID/mDL) | Yes (public input [28]) | **No** |
| `engagement_tier` (0-4) | On-chain nullifier consumption events | Yes (public input [30]) | **No** |
| VOTER token balance | Market/earning/challenge wins | No (separate ERC-20) | **Yes** |

**Key invariant:** No function of VOTER balance appears in the ZK circuit. The engagement tier is derived exclusively from on-chain nullifier events. The authority level is derived exclusively from identity verification. These are separate systems that cannot influence each other.

### 7.3 VOTER Emission Model

| Action | VOTER Reward | Notes |
|--------|-------------|-------|
| Template creation | 10-500 | Scaled by quality score (moderation + adoption) |
| Verified message delivery | 1-10 | Scaled by authority level (higher verification = more reward) |
| Sustained engagement (monthly) | 5-50 | Proportional to action_count in period |
| Challenge market win | Stake × 2 | Winner takes all (Phase E3) |
| Impact verification | 20% of prize pool | Retroactive funding (Phase E1) |

Emissions are controlled by SupplyAgent (see phase-2-design.md) with daily rate adjustments of ±5% max and a 48-hour emergency circuit breaker.

### 7.4 Anti-Pay-to-Win Guarantees

| Attack | Defense |
|--------|---------|
| Buy VOTER → inflate engagement tier | VOTER balance is not an input to tier computation. Tier derives from nullifier events only. |
| Buy VOTER → boost authority level | Authority derives from identity verification only. VOTER has no pathway to authority. |
| Buy high-engagement account | Identity commitment is per-person. Circuit binds engagement to the same identity that generates the nullifier. No account transfer possible. |
| Delegate engagement proof | Circuit binds engagement leaf to same identity_commitment as nullifier. Different person = different commitment = proof fails. |
| Farm engagement via bot accounts | Each account requires identity verification (passport/ID). Real-world cost per Sybil is non-trivial. |

---

## 8. Anti-Astroturf Integration

### 8.1 Relationship to Existing Anti-Astroturf System

The engagement tier provides a **coarse signal** that complements the existing server-side anti-astroturf system (ANTI-ASTROTURF-IMPLEMENTATION-PLAN.md, COORDINATION-INTEGRITY-SPEC.md). It does NOT replace server-side detection.

| Detection Layer | Location | Privacy | Granularity |
|----------------|----------|---------|-------------|
| Engagement tier | ZK circuit (public output) | 5 coarse buckets | Low (by design) |
| Coordination metrics (GDS/ALD/entropy) | Server-side | Aggregate only | High |
| Temporal surge detection | Server-side | Aggregate only | High |
| Semantic similarity clustering | Server-side | Per-campaign | High |

### 8.2 How Engagement Tier Defeats Astroturf

**Scenario:** A lobbying firm obtains 500 real identity-verified accounts and sends coordinated messages.

Without engagement tier:
- All 500 accounts pass ZK verification (valid identities, valid proofs)
- Congressional offices see 500 "verified constituent" messages with identical talking points
- No cryptographic signal distinguishes genuine from coordinated

With engagement tier:
- All 500 accounts are tier 0 (New) or tier 1 (Active) — they have minimal engagement history
- A genuine grassroots campaign would show a distribution: tiers 0-4 with most at 1-2
- Congressional offices see "500 messages, 95% from tier-0 accounts" — an obvious astroturf signal
- Combined with server-side coordination metrics, the campaign is flagged with high confidence

**The engagement tier makes astroturf economically expensive.** To appear legitimate, the firm would need to maintain 500 accounts with real civic engagement over 6-12 months. This is orders of magnitude more expensive than bulk registration.

### 8.3 Engagement Data as Input to Server-Side Detection

The engagement data commitment feeds back into server-side anti-astroturf detection:

```
On-chain nullifier events → Operator derives engagement metrics
                          → Tree 3 leaf update
                          → Engagement tier in next proof

Server-side signals:
  - Temporal distribution of actions across tiers
  - Tier velocity (how fast users move through tiers)
  - Tier distribution per campaign (deviation from population baseline)
```

These are aggregate signals — no individual behavioral data is exposed.

---

## 9. Shadow Atlas Changes

### 9.1 EngagementTreeBuilder

New module in `packages/shadow-atlas/src/`:

```typescript
class EngagementTreeBuilder {
    // Build Tree 3 from on-chain nullifier events
    async buildFromChainEvents(
        provider: ethers.Provider,
        districtGateAddress: string,
        fromBlock: number
    ): Promise<EngagementTree>

    // Update existing tree with new events
    async updateTree(
        tree: EngagementTree,
        newEvents: NullifierEvent[]
    ): Promise<EngagementTree>

    // Compute engagement metrics for a user
    computeMetrics(
        events: NullifierEvent[],
        identityCommitment: bigint
    ): { actionCount: number; diversityScore: number; tenureMonths: number }

    // Derive tier from composite engagement score
    deriveTier(metrics: EngagementMetrics): 0 | 1 | 2 | 3 | 4
}
```

### 9.2 New API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /v1/engagement-info` | GET | Returns Tree 3 metadata (root, depth, leafCount, available) |
| `GET /v1/engagement-path/:leafIndex` | GET | Returns Merkle path for a specific engagement leaf |
| `GET /v1/engagement-metrics/:identityCommitment` | GET | Returns current engagement metrics (action_count, diversity_score as Shannon index, composite_score, tier) |
| `POST /v1/engagement/register` | POST | Register identity for engagement tracking. Called auto on first proof submission. Request: `{ identityCommitment: string }`. Response: `{ leafIndex: number, tier: 0 }`. Auth: session token required. |

These follow the same pattern as existing `GET /v1/cell-map-info` and `GET /v1/cell-proof/:cellId`.

### 9.3 IPFS Snapshots

Tree 3 snapshots follow the same Storacha + Lighthouse dual-pinning model as Trees 1 and 2:

- Snapshot format: NDJSON with tree metadata + leaf mappings
- Hash-chained: Each snapshot entry includes SHA-256 of previous entry
- Ed25519 signed: Operator signature on each entry
- Attestation-bound: Links to on-chain block number from which events were derived

---

## 10. Client Integration

### 10.1 SessionCredential Extension

The SessionCredential stored in encrypted IndexedDB (communique) gains new fields:

```typescript
interface SessionCredential {
    // ... existing two-tree fields (userId, identityCommitment, leafIndex,
    //     merklePath, merkleRoot, cellId, cellMapRoot, cellMapPath, etc.) ...

    // Three-tree engagement fields (NEW)
    engagementRoot?: string;         // Tree 3 Merkle root
    engagementPath?: string[];       // Tree 3 Merkle siblings
    engagementIndex?: number;        // Leaf position in Tree 3
    engagementTier?: 0 | 1 | 2 | 3 | 4;  // Cached tier
    actionCount?: number;            // Private metric (for proof generation)
    diversityScore?: number;         // Private metric (for proof generation)
}
```

### 10.2 ProofInputMapper Extension

The existing `formatInputs()` function in `two-tree-prover.ts` maps TS camelCase to Noir snake_case. The three-tree variant adds:

```typescript
// New mappings in formatInputs():
engagement_root: input.engagementRoot,
engagement_tier: input.engagementTier,
engagement_path: input.engagementPath,
engagement_index: input.engagementIndex,
action_count: input.actionCount,
diversity_score: input.diversityScore,
```

### 10.3 ThreeTreeNoirProver

New prover class extending the pattern of `TwoTreeNoirProver`:

```typescript
class ThreeTreeNoirProver {
    // Loads three_tree_membership_{depth}.json compiled circuits
    async generateProof(
        input: ThreeTreeProofInput,
        options?: ProofOptions
    ): Promise<ThreeTreeProofResult>

    async verifyProof(
        proof: Uint8Array,
        publicInputs: string[]
    ): Promise<boolean>
}
```

### 10.4 UX: Engagement Tier Display

Congressional offices receiving messages via CWC see a credibility indicator:

| Tier | Display | Meaning |
|------|---------|---------|
| 0 | (none) | New account — no engagement signal |
| 1 | Active | Some civic engagement |
| 2 | Established | Sustained multi-category engagement |
| 3 | Veteran | Deep, diverse, long-term participant |
| 4 | Pillar | Exceptional civic standing |

This is displayed as metadata alongside the district verification, not as a score or number.

---

## 11. Migration Strategy

### 11.1 Deployment Sequence

```
Phase A: Deploy EngagementRootRegistry
         (Genesis model — no timelock, registerEngagementRoot + seal)

Phase B: Build initial Tree 3 from historical chain events
         (Backfill from DistrictGate nullifier events since launch)

Phase C: Register initial engagement root on-chain

Phase D: Deploy three-tree verifier contracts (4 depths)
         Register in VerifierRegistry alongside two-tree verifiers

Phase E: Update Shadow Atlas to serve engagement proofs
         Update communique to generate three-tree proofs

Phase F: Deprecation window — both verifiers active for 6 months
         After window: two-tree verifiers remain callable but engagement
         tier defaults to 0 for legacy proofs
```

### 11.2 Backwards Compatibility

During the transition period:
- `verifyTwoTreeProof()` continues to work (29 public inputs, no engagement)
- `verifyThreeTreeProof()` available for clients that upgrade (31 public inputs)
- Congressional offices see engagement tier only for three-tree proofs
- No forced re-registration — users naturally upgrade on next proof generation

### 11.3 Backfill Algorithm

To build the initial Tree 3:

1. Query all `ProofVerified` and `TwoTreeProofVerified` events from DistrictGate
2. Group nullifier events by `signer` address
3. For each signer, derive `action_count`, `diversity_score` (Shannon index), `tenure`, `adoption_count`
4. Compute composite score `E` and `engagement_tier` via `deriveTier()` (Section 4.3)
5. Look up `identity_commitment` from registration records
6. Compute engagement leaf and insert into Tree 3

**Privacy note:** The backfill uses on-chain public data (events). No private user data is needed.

---

## 12. Security Analysis

### 12.1 Operator Engagement Inflation

**Threat:** Operator fabricates engagement data to boost favored users.

**Mitigation:**
- Engagement derives from on-chain nullifier events (publicly verifiable)
- Tree 3 is hash-chained and IPFS-pinned (Verifiable Solo Operator model)
- Any independent observer can replay chain events and verify tree correctness
- Insertion log entries are Ed25519 signed and attestation-bound

**Residual risk:** Operator could fabricate nullifier events by submitting proofs for fake accounts. This requires valid ZK proofs, which require valid Tree 1 registrations, which require identity verification. Cost: one real identity per fake nullifier.

### 12.2 Behavioral Fingerprinting

**Threat:** The engagement tier leaks behavioral information that deanonymizes users.

**Mitigation:**
- Only 5 tiers are public — cannot distinguish between users within the same tier
- `action_count` and `diversity_score` are private inputs — not visible on-chain
- Tier transitions are batched (daily updates, not real-time) — timing analysis is imprecise
- No action timestamps or categories are committed — the tier is a snapshot, not a history

**Residual risk:** Long-term tier transition patterns could narrow anonymity sets for very active users (tier 0→1→2→3→4 trajectory). Mitigation: tiers are monotonically non-decreasing (you don't lose engagement), so the trajectory is boring (only goes up).

### 12.3 Engagement Farming

**Threat:** Bad actors perform minimal civic actions solely to boost engagement tier.

**Mitigation:**
- Each action requires a valid ZK proof (real identity, real registration)
- Shannon diversity rewards *even distribution* across categories, not just touching multiple categories — one action per category yields H ≈ 1.6 but log₂(6) ≈ 2.6 action factor, producing E ≈ 6.8 (only tier 2). Reaching tier 4 (E ≥ 25) requires substantial, balanced effort.
- Multiplicative composition means no single dimension can compensate for weakness in another — 10000 actions in one category still yields diversity multiplier 1×
- Template adoption requires other verified identities to adopt, making it resistant to solo farming
- The reward for higher tier is credibility signal, not access or economic benefit

**Residual risk:** A well-funded adversary could maintain real accounts with genuinely balanced engagement over months. This is accepted — at that point, the engagement IS real, even if motivated by adversarial intent. The system correctly records genuine civic engagement regardless of motivation.

### 12.4 Cross-Tree Identity Binding Bypass

**Threat:** Use one identity for nullifier and another for engagement proof.

**Mitigation:** The circuit uses a single `identity_commitment` private input for both derivations. There is no way to provide two different values — the circuit enforces equality by construction.

### 12.5 Engagement Tree Censorship

**Threat:** Operator excludes legitimate users from Tree 3.

**Mitigation:**
- Hash-chained insertion log with Ed25519 signatures enables detection
- IPFS snapshots provide independent verification points
- Discrepancy between on-chain nullifier count and tree leaf count is detectable
- Future: multi-operator federation eliminates single-point censorship (Phase 3+)

---

## 13. Performance Analysis

### 13.1 Constraint Budget

| Configuration | Two-Tree | Three-Tree | Overhead |
|---------------|----------|------------|----------|
| Depth 18 | ~19,250 | ~27,650 | +43.6% |
| Depth 20 | ~20,850 | ~29,700 | +42.4% |
| Depth 22 | ~22,450 | ~31,750 | +41.4% |
| Depth 24 | ~24,050 | ~33,800 | +40.5% |

### 13.2 Proving Time Estimates

Based on two-tree proof timing (8.1s for depth 20, DC 404 cells, 16KB proof):

| Depth | Two-Tree (measured) | Three-Tree (estimated) | Notes |
|-------|-------------------|----------------------|-------|
| 18 | ~6s | ~8.5s | +42% constraint increase |
| 20 | ~8.1s | ~11.5s | Primary target |
| 22 | ~12s | ~17s | |
| 24 | ~18s | ~25s | Within 30s mobile target |

These are estimates. Actual timing depends on Barretenberg optimization and hardware.

### 13.3 Proof Size

Proof size in UltraHonk is primarily determined by the number of public inputs, not constraints:

| | Two-Tree | Three-Tree |
|---|----------|------------|
| Public inputs | 29 | 31 |
| Keccak proof size | ~16KB | ~16.5KB |
| Poseidon2 proof size | ~35KB | ~36KB |

Negligible increase — 2 additional field elements.

### 13.4 Client Storage

Additional IndexedDB storage per credential:

| Field | Size | Notes |
|-------|------|-------|
| engagementRoot | 32 bytes | Single field element |
| engagementPath | 640 bytes | 20 siblings × 32 bytes |
| engagementIndex | 4 bytes | u32 |
| engagementTier | 1 byte | [0-4] |
| actionCount | 4 bytes | u32 |
| diversityScore | 4 bytes | u32 (Shannon index × 1000, range [0-1609]) |
| **Total** | **~685 bytes** | |

Negligible compared to existing credential (~1.5KB for two-tree data).

---

## 14. Implementation Roadmap

### 14.1 Cycle Plan

| Cycle | Component | Deliverables | Dependencies |
|-------|-----------|-------------|-------------|
| 18 | Documentation | This spec + TWO-TREE-ARCH update + ARCHITECTURE.md update + reputation.md update + CHALLENGE-MARKET update | None (current cycle) |
| 19 | Circuit | `three_tree_membership/` Noir circuit + golden vector tests + `build-three-tree-circuits.sh` | Cycle 18 |
| 20 | Contracts | EngagementRootRegistry.sol + DistrictGate extension + Solidity tests | Cycle 19 (circuit defines public input layout) |
| 21 | Shadow Atlas | EngagementTreeBuilder + `/v1/engagement-*` API endpoints + IPFS snapshot integration | Cycle 19 (needs hash functions for tree building) |
| 22 | Prover | ThreeTreeNoirProver + compiled circuits for 4 depths + golden vector verification | Cycle 19 (compiled circuits) |
| 23 | Communique | SessionCredential extension + ProofInputMapper + shadow-atlas-handler update + UX | Cycles 21-22 |
| 24 | Tokens | VOTER (ERC-20) — DEFERRED to Phase 2+. No soulbound credential needed (tier lives in proof). | Cycle 20 (engagement tier on-chain) |
| 25 | Markets | Challenge market MVP (E2 bonds) referencing engagement tier | Cycle 24 |

### 14.2 Agentic Coordination Strategy

Each cycle follows the pattern: **implementation → review → manual review**.

| Phase | Actor | Deliverable |
|-------|-------|-------------|
| Implementation | Code agent | Working code + tests |
| Review | Review agent | Findings + corrections |
| Manual Review | Human | Sign-off + architectural decisions |

Findings from review phases are tracked as new tasks in the current or subsequent cycle.

---

## 15. Verification Criteria

### 15.1 Circuit Verification

- [ ] Three-tree circuit compiles for depths 18, 20, 22, 24
- [ ] Golden vector tests pass (engagement leaf computation, tree verification)
- [ ] Cross-tree identity binding verified (same identity_commitment in nullifier + engagement)
- [ ] Engagement tier range check enforced [0, 4]
- [ ] Domain separation preserved (H2/H3 no collision)

### 15.2 Contract Verification

- [ ] EngagementRootRegistry deploys and passes unit tests
- [ ] `verifyThreeTreeProof()` passes with valid proofs
- [ ] `verifyThreeTreeProof()` rejects invalid engagement root
- [ ] `verifyThreeTreeProof()` rejects engagement tier > 4
- [ ] Country cross-check across all three tree roots
- [ ] Two-tree path continues to work (backwards compatibility)

### 15.3 Integration Verification

- [ ] Shadow Atlas serves engagement proofs
- [ ] Communique generates three-tree proofs
- [ ] E2E: registration → engagement tracking → proof generation → on-chain verification
- [ ] Congressional dashboard displays engagement tier

### 15.4 Privacy Verification

- [ ] Only engagement_tier is a public circuit output (not action_count, diversity_score)
- [ ] No behavioral fingerprint leaks from tier transitions
- [ ] action_count and diversity_score are private inputs only
- [ ] Tenure is server-side, not in-circuit

---

## 16. Reputation Layer Architecture

Three systems in the Communique + voter-protocol stack use the word "reputation." They are intentionally separate layers with different trust properties, data sources, and update cadences.

### 16.1 Layer 1: Protocol-Level `engagement_tier` (Authoritative)

- **Source:** On-chain nullifier events → Shadow Atlas Tree 3 → ZK circuit → `engagement_tier` public output
- **Range:** 0-4 (coarse bucket derived from composite score E)
- **Trust model:** Cryptographic proof. Cannot be faked without consuming real nullifiers through real identity-verified interactions.
- **Storage:** Tree 3 Merkle leaf, verified on-chain by DistrictGate
- **Update cadence:** Per-epoch (batch rebuild when new nullifier events are processed)
- **Spec:** This document (Sections 3-5)

This is the **only authoritative engagement signal**. Congressional offices, challenge markets, and governance systems MUST use this tier, not the application-layer estimate.

### 16.2 Layer 2: Application-Level `reputation_tier` (Preview/Pending)

- **Source:** Communique Postgres `users.reputation_tier` (string: "novice", "active", etc.)
- **Trust model:** Server-side estimate. The application tracks user activity and assigns a preview tier before the next Tree 3 epoch processes it into a ZK-verifiable commitment.
- **Storage:** Communique Postgres (`prisma/schema.prisma`)
- **Update cadence:** Real-time (on each user action)
- **Purpose:** UX feedback. Shows users their estimated tier before it lands in the protocol layer. Displays in profile, dashboard, and tier badges.

This layer is a **leading indicator** of where the protocol tier will land. It has no cryptographic authority. A recipient seeing `reputation_tier = "active"` in the UI should understand this is the application's estimate, not a ZK-verified claim.

**Convergence path:** When Tree 3 epochs run frequently enough (< 1 hour), the application-layer estimate becomes redundant. Until then, both layers serve distinct purposes.

### 16.3 Layer 3: Credibility Signals (Application Quality)

- **Source:** Communique graduated trust system (`docs/architecture/graduated-trust.md`)
- **Trust model:** Application-level heuristics — passkey binding, address attestation, template quality metrics
- **Storage:** Communique session state, IndexedDB
- **Update cadence:** Per-session
- **Purpose:** UX affordances (trust badges, message framing, progressive disclosure)

Credibility signals are orthogonal to engagement tier. A Tier 3 (ZK-verified) user with `engagement_tier = 0` has high identity credibility but no engagement history. A user with `engagement_tier = 4` but Tier 1 (passkey only) has deep engagement but weaker identity binding. Both dimensions matter; neither subsumes the other.

### 16.4 Layer Interaction

```
Protocol layer (engagement_tier)  ← ZK proof, on-chain, authoritative
    ↑ feeds into
Application layer (reputation_tier)  ← Postgres, server-side, preview
    ↑ orthogonal to
Credibility signals (trust tier)  ← Session state, UX-only
```

**Rule:** No downstream layer can override an upstream layer. The application MUST NOT display `reputation_tier = "pillar"` if the protocol says `engagement_tier = 1`. When the protocol layer updates, the application layer syncs to match.

---

## Appendix A: Resolved — No Soulbound Token (v0.3.0)

ERC-8004 soulbound credentials were evaluated and rejected. The engagement tier lives in the ZK proof (`publicInputs[30]`) — fresh at time of use, no persistent on-chain identity linkage, no stale data. See Section 4.6.1 for full rationale. The non-transferability guarantee is stronger in the proof-based design: the circuit binds engagement to identity_commitment, making delegation or transfer cryptographically impossible (not just contractually prohibited).

---

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **action_count** | Total number of nullifier consumption events for an identity |
| **authority_level** | Identity verification tier [1-5], from passport/ID/mDL verification |
| **diversity_score** | Shannon diversity index H = -Σ(pᵢ × ln(pᵢ)), stored as floor(H × 1000), range [0-1609] |
| **engagement_data_commitment** | H3(engagement_tier, action_count, diversity_score) |
| **engagement_leaf** | H2(identity_commitment, engagement_data_commitment) |
| **engagement_root** | Merkle root of Tree 3 |
| **engagement_tier** | Coarse engagement bucket [0-4], derived from composite score E (Section 4.3) |
| **composite engagement score (E)** | log₂(1+actions) × (1+shannonH) × (1+√(tenure/12)) × (1+log₂(1+adoptions)/4) |
| **adoption_count** | Number of times a user's templates were adopted by other verified identities |
| **identity_commitment** | Deterministic hash from identity verification provider (self.xyz/didit) |
| **nullifier** | H2(identity_commitment, action_domain) — prevents double-voting |
| **engagement tier (in-proof)** | Public output `publicInputs[30]` of three-tree ZK circuit. No separate on-chain token (v0.3.0). |
| **tenure** | Time since first nullifier consumption for an identity |
| **VOTER** | ERC-20 transferable token for civic labor compensation — DEFERRED to Phase 2+ |
