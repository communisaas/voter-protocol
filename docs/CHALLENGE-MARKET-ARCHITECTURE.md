# Challenge Market Architecture: From Reputation to Token-Curated Quality

**Version:** 0.1.0
**Date:** 2026-02-16
**Status:** DESIGN EXPLORATION (Not implemented. Not scheduled.)
**Companion Documents:** ECONOMICS.md, COORDINATION-INTEGRITY-SPEC, TRUST-MODEL-AND-OPERATOR-INTEGRITY, ADVERSARIAL-ATTACK-DOMAINS (Domain 8)
**Prerequisite Phase:** Phase 1 launch complete, civic utility proven

---

## Preamble

This document specifies the architecture for introducing challenge markets to the Voter Protocol — a mechanism by which the community can dispute template quality, campaign legitimacy, and operator integrity through economically-incentivized challenges.

The challenge market is the **last economic primitive** added to the protocol, not the first. This sequencing is the single most important design decision in this document. The reasoning:

1. Simon de la Rouviere's lesson from TCR failures: *"When you introduce pricing to an information system, it can crowd out all other incentives."* If civic participation only happens because of token rewards, we've built a mercenary system that collapses in the first bear market.

2. The Multicoin Capital conclusion: *"Most TCRs are expected to be unable to compete with centralized alternatives."* TCRs fail in subjective domains. Template quality for civic advocacy is irreducibly subjective. We must build layers of defense against this failure mode before exposing the system to financial incentives.

3. The protocol's architectural decision (2026-02-10): **No MVP mode. Ship real or don't ship.** This applies equally to economics. Ship real economic incentives backed by proven civic utility, or don't ship them at all.

Every claim in this document is accompanied by its failure modes. Where a mechanism creates a new attack surface, we state that. Where a tradeoff has no clean resolution, we say so. Where historical TCR implementations failed, we explain why and how we differ — or honestly state that we face the same risk.

---

## Table of Contents

1. [The Four-Phase Economic Sequence](#1-the-four-phase-economic-sequence)
2. [Phase E0: Reputation-Only Quality Signals](#2-phase-e0-reputation-only-quality-signals)
3. [Phase E1: Retroactive Impact Rewards](#3-phase-e1-retroactive-impact-rewards)
4. [Phase E2: Template Creation Bonds](#4-phase-e2-template-creation-bonds)
5. [Phase E3: Challenge Markets](#5-phase-e3-challenge-markets)
6. [Scrutiny Point: Political Weaponization](#6-scrutiny-point-political-weaponization)
7. [Scrutiny Point: Voter Apathy](#7-scrutiny-point-voter-apathy)
8. [Scrutiny Point: Griefing Economics](#8-scrutiny-point-griefing-economics)
9. [Scrutiny Point: AI Consensus Gaming](#9-scrutiny-point-ai-consensus-gaming)
10. [Scrutiny Point: Speculation Dominance](#10-scrutiny-point-speculation-dominance)
11. [The Kleros Alternative: External Arbitration](#11-the-kleros-alternative-external-arbitration)
12. [The UMA Alternative: Optimistic Resolution](#12-the-uma-alternative-optimistic-resolution)
13. [Economic Attack Surface](#13-economic-attack-surface)
14. [Gate Criteria: When to Advance Phases](#14-gate-criteria-when-to-advance-phases)
15. [Integration with Existing Architecture](#15-integration-with-existing-architecture)
16. [Pitfall Registry](#16-pitfall-registry)

---

## 1. The Four-Phase Economic Sequence

The challenge market emerges from four phases. Each phase is gated by measurable criteria. No phase begins until the previous phase has proven its model.

```
Phase E0: Reputation-Only Quality Signals (CURRENT — Phase 1)
    │
    │  Gate: 10,000+ verified submissions, 500+ templates,
    │        100+ unique template creators, 6+ months of operation
    │
    ▼
Phase E1: Retroactive Impact Rewards
    │
    │  Gate: Retroactive reward pool distributed 3+ times,
    │        reward distribution is non-controversial (no governance disputes),
    │        token launched and liquid on DEX
    │
    ▼
Phase E2: Template Creation Bonds
    │
    │  Gate: Bond system operational 3+ months,
    │        <5% of bonded templates challenged,
    │        bond amounts calibrated against observed spam rates
    │
    ▼
Phase E3: Challenge Markets
    │
    │  Gate: Never automatic. Requires governance proposal,
    │        7-day discussion period, and 2/3 guardian approval.
    │
    ▼
(Steady State: Full Cryptoeconomic Protocol)
```

**Why this order matters:**

- E0 proves the system has intrinsic civic value without economic incentives.
- E1 rewards proven impact *after the fact*, preserving intrinsic motivation during the act.
- E2 creates skin-in-the-game for template creators, establishing the staking primitive.
- E3 extends the staking primitive to challengers, completing the challenge loop.

Each phase builds on the behavioral patterns established by the previous one. Skipping phases front-loads financial incentives before the community has developed norms around quality, creating the exact condition that killed previous TCR implementations.

---

## 2. Phase E0: Reputation-Only Quality Signals

**Status:** Active (Phase 1 — current implementation)
**Duration:** 6-12 months post-launch minimum
**Economic primitives:** None. Reputation only.

### 2.1 Current Architecture

Quality signals flow through three layers, none of which involve tokens:

**Layer 1: Multi-Agent AI Consensus (Template Creation)**

From ECONOMICS.md:
```
quality_score = weighted_average([
  agent_1_score x confidence_1,
  agent_2_score x confidence_2,
  agent_3_score x confidence_3
]) x consensus_bonus
```

Agents score grammar (0.25), clarity (0.25), completeness (0.20), factual accuracy (0.15), civility (0.10), and impact potential (0.05). Templates auto-approve at consensus >= 0.75, require human review at 0.50-0.75, auto-reject below 0.50.

**Layer 2: Structural Coordination Metrics (Campaign Health)**

From COORDINATION-INTEGRITY-SPEC Section 4:
- Geographic Diversity Score (GDS) = districtCount / participantCount
- Authority Level Distribution (ALD) = weighted average of verification tiers
- Temporal Entropy (H_temporal) = Shannon entropy over hourly bins
- Velocity Curve = d(participantCount)/dt

These metrics attach to campaigns, never to individual users.

**Layer 3: Trust Score (User Reputation)**

From ECONOMICS.md:
```
trust_score = weighted_sum([
  civic_score x 0.40,
  challenge_score x 0.30,
  discourse_score x 0.20,
  verification_bonus x 0.10
]) x time_decay_factor
```

Trust score determines tier (novice/emerging/established/trusted) and gates capabilities. In Phase E0, `challenge_score` starts at 50 (Bayesian prior) and has no mechanism to update — it activates in E3.

### 2.2 What E0 Validates

During E0, we measure:

| Signal | What it tells us | Minimum threshold |
|--------|------------------|-------------------|
| Monthly active template creators | Organic content supply exists | 50+ unique creators/month |
| Template adoption rate | Users find templates valuable | 10+ average sends per template |
| GDS across campaigns | Geographic diversity is organic | Median GDS > 0.1 |
| Repeat user rate | Intrinsic civic motivation exists | 30%+ users return within 30 days |
| Template creation without incentive | Quality content emerges without payment | Quality score distribution is stable |

**What E0 cannot validate:** Whether users would create templates if they could earn tokens elsewhere for less effort. This is the fundamental question that E1 answers.

### 2.3 Failure Mode

**E0 fails if:** Fewer than 100 unique template creators emerge in 6 months. This indicates the civic value proposition is insufficient, and adding economic incentives would create a mercenary system rather than amplifying genuine civic engagement.

**If E0 fails:** Do not proceed to E1. Instead, investigate why civic utility is insufficient. The problem is product-market fit, not economics. Adding tokens to a product people don't use creates speculation, not civic infrastructure.

---

## 3. Phase E1: Retroactive Impact Rewards

**Status:** Design only
**Duration:** 3-6 months before considering E2
**Economic primitives:** VOTER token, retroactive reward pool

### 3.1 Mechanism

Retroactive rewards fund *proven* impact, not prospective effort. The principle comes from Optimism's Retroactive Public Goods Funding: it's easier to agree on what was valuable than to predict what will be valuable.

**Reward Pool:**
```
quarterly_pool = governance_allocated VOTER tokens (fixed amount per quarter)
```

**Distribution:**
1. At end of each quarter, compute impact scores for all templates created that quarter.
2. Impact score = f(total sends, unique district reach, authority level distribution, campaign health metrics).
3. Distribute reward pool proportional to impact scores.
4. 25% immediate, 75% vested over 90 days (prevents dump-and-exit).

**Impact Score Formula:**
```
impact_score = (
  log10(total_sends + 1) x 0.35 +
  log10(unique_districts + 1) x 0.30 +
  (avg_authority_level / 5) x 0.15 +
  temporal_entropy_normalized x 0.10 +
  quality_score_normalized x 0.10
)
```

**Why retroactive, not prospective:**
- Preserves intrinsic motivation during creation. The creator doesn't know they'll be rewarded.
- Eliminates template-farming incentive. You can't farm impact retrospectively — the metrics are behavioral.
- Avoids the Goodhart problem. When a measure becomes a target, it ceases to be a good measure. Retroactive rewards announce the measure *after* the period closes.

### 3.2 Integration Points

| Existing Component | E1 Integration |
|---------------------|---------------|
| Campaign Health Metrics API (Wave 15d) | Source for impact score components |
| The Graph Subgraph (Wave 15c) | Source for on-chain submission data |
| Trust Score (ECONOMICS.md) | Trust tier determines eligibility (minimum: emerging) |
| CampaignRegistry.sol | On-chain source of truth for participation counts |

### 3.3 Solutions to Anticipated Problems

**Problem: Metric gaming after first distribution.**
Once creators see the first retroactive reward distribution, they know the formula. Future periods are no longer truly retroactive — creators will optimize for the known metrics.

**Solution:** Rotate metric weights quarterly. The impact score formula is governance-parameterized, not hardcoded. Each quarter, governance proposes metric weights *before* the period begins but only reveals them *after* the period ends. This preserves the "you can't game what you don't know" property.

**Pitfall of the solution:** Governance insiders know the weights early, creating an information asymmetry. **Approach out:** Commit metric weights to a hash on-chain at the start of each quarter. Reveal the preimage at the end. Governance members cannot change the weights after committing. Anyone can verify the reveal matches the commitment.

**Problem: Sybil farming of impact metrics.**
A well-funded actor creates 100 templates, drives traffic from 100 sock-puppet accounts, and claims retroactive rewards.

**Solution:** Impact score weights geographic diversity (0.30) and authority level distribution (0.15) heavily. Sock-puppet accounts are overwhelmingly authority level 1 (OAuth only). A template used by 1,000 L1 users scores lower than a template used by 200 L3 (passport-verified) users across 50 districts. The identity verification requirement (architectural decision: self.xyz/didit mandatory for CWC) makes L3+ Sybils expensive.

**Pitfall of the solution:** This privileges templates used by passport-verified populations, which skews toward wealthier, more mobile demographics. **Approach out:** Authority level distribution is one of five components (0.15 weight). A template with massive organic reach among L1 users still scores well on the other four components. The formula rewards breadth, not just depth.

**Problem: Token price collapse kills motivation.**
If VOTER token drops 90% after launch, retroactive rewards in VOTER become worthless. Creators revert to zero economic incentive.

**Solution:** Reward pool denominated in VOTER, but impact measurement is purely civic. If the token is worthless, E1 fails gracefully — creators who stayed are the ones with intrinsic motivation (exactly who you want). If the token recovers, rewards become meaningful again. The 90-day vesting provides price averaging.

**Pitfall:** Worthless rewards may be perceived as insulting ("you're paying me $0.50 for 3 months of work"). **Approach out:** Frame retroactive rewards as recognition, not compensation. Display impact metrics prominently; display token value secondarily. The reward is social signal first, financial second.

### 3.4 Failure Mode

**E1 fails if:** Template creation rate drops after rewards are introduced (crowding-out effect). This indicates that financial incentives are replacing intrinsic motivation, exactly the pattern de la Rouviere warned about.

**If E1 fails:** Pause reward distribution. Conduct community survey. Consider switching to purely social recognition (badges, leaderboards) without financial component. The civic infrastructure must work without tokens.

---

## 4. Phase E2: Template Creation Bonds

**Status:** Design only
**Duration:** 3+ months before considering E3
**Economic primitives:** Staking, bond forfeiture

### 4.1 Mechanism

Template creators stake VOTER tokens as a quality bond. The bond amount varies inversely with trust tier:

From ECONOMICS.md:
```
required_stake = {
  0 VOTER         if trust_score >= 85 (trusted tier)
  100 VOTER       if 65 <= trust_score < 85 (established)
  250 VOTER       if 40 <= trust_score < 65 (emerging)
  500 VOTER       if trust_score < 40 (novice)
}
```

Bonds are returned after a 7-day challenge window if no challenge is filed. If a challenge succeeds, the bond is forfeited (50% to challenger, 50% to protocol treasury).

### 4.2 Why Bonds Before Challenges

The bond system establishes the staking primitive without the adversarial dynamics of a full challenge market. It achieves:

1. **Spam deterrence.** Creating a low-quality template costs real tokens. The cost scales inversely with reputation, so established creators face minimal friction.
2. **Behavioral baseline.** Observe how the community reacts to staking. Are bonds perceived as fair or exclusionary? Does template creation rate drop? These signals inform E3 calibration.
3. **Smart contract testing.** The staking contract is simpler than a full challenge market. Deploy, test, and audit the staking primitive in isolation before adding the adversarial challenge layer.

### 4.3 Solutions to Anticipated Problems

**Problem: Bond amounts exclude low-income participants.**
500 VOTER for novice creators may be prohibitive, creating a plutocratic barrier to template creation.

**Solution:** Delegated staking. A trusted user can "sponsor" a novice creator's bond by staking on their behalf. The sponsor's tokens are at risk, but the creator retains authorship. This enables civic organizations to sponsor their members' template creation without controlling the content.

**Pitfall of the solution:** Sponsors become gatekeepers. An organization that sponsors 500 creators effectively controls which templates get created. **Approach out:** Sponsorship is opt-in and public. The sponsor's identity is recorded. Campaign health metrics (Section 4.2 of COORDINATION-INTEGRITY-SPEC) already detect geographic concentration and template farming patterns. Sponsored templates are flagged in the metrics dashboard, not hidden.

**Problem: Bond calibration in volatile markets.**
If VOTER doubles in price, the effective bond cost doubles, deterring legitimate creators. If VOTER halves, bonds become trivially cheap, failing to deter spam.

**Solution:** Bond amounts denominated in USD, paid in VOTER at current oracle price. From ECONOMICS.md: Chainlink USD/VOTER price feed with 15-minute TWAP. Bond amounts become:
```
required_stake_VOTER = required_stake_USD / oracle_price_USD
```

**Pitfall of the solution:** Oracle dependency. If Chainlink feed is stale or manipulated, bond amounts are wrong. **Approach out:** Dual oracle (Chainlink + Uniswap V3 TWAP). If oracles diverge > 10%, use the higher price (conservative — makes bonds cheaper, erring toward inclusion). Circuit breaker if both oracles are unreachable — bonds are suspended, templates require human review.

**Problem: Bond window creates a 7-day limbo for urgent civic actions.**
A legislative vote happens in 3 days. A creator makes a template but it's locked in the 7-day bond window. By the time the bond clears, the vote has passed.

**Solution:** Trusted-tier creators (trust_score >= 85) have zero bond and zero delay. Their templates are immediately available. For lower tiers, templates are *usable* during the bond window but marked as "bond pending" in the UI. Challenge within the bond window forfeits the bond; challenge after the window closes uses the full E3 mechanism.

**Pitfall of the solution:** "Usable during bond window" means a low-quality template can do damage before being challenged. **Approach out:** Multi-agent AI consensus (Layer 1) still runs at creation time. A template that scores < 0.50 is auto-rejected regardless of bond. The bond window protects against *borderline* quality templates that pass AI review but fail community scrutiny — these are unlikely to cause civic harm in 7 days.

### 4.4 Failure Mode

**E2 fails if:** Template creation rate drops > 30% after bonds are introduced, indicating bonds are a participation barrier rather than a quality signal.

**If E2 fails:** Reduce bond amounts by 50%. If still failing, eliminate bonds for trust_score >= 40 (emerging+). If still failing, revert to E1 model (retroactive only, no prospective staking). The bonds may not be necessary if the AI quality layer and retroactive rewards already produce sufficient quality.

---

## 5. Phase E3: Challenge Markets

**Status:** Design only. Requires explicit governance approval to activate.
**Economic primitives:** Challenge staking, dispute resolution, reward distribution

### 5.1 Mechanism Overview

Any token holder can challenge a template's quality by staking 100 VOTER. This initiates a three-stage resolution process:

```
Challenge Filed (100 VOTER staked)
    │
    ▼
Stage 1: AI Re-evaluation (Automated, <5 min)
    │
    ├── AI consensus < 0.30: Auto-resolve in challenger's favor
    ├── AI consensus > 0.80: Auto-resolve in creator's favor
    └── 0.30 <= AI consensus <= 0.80: Proceed to Stage 2
    │
    ▼
Stage 2: Community Vote (3 days)
    │
    ├── Trust-weighted vote >= 60% for challenger: Challenger wins
    ├── Trust-weighted vote >= 60% for creator: Creator wins
    └── Neither >= 60%: Proceed to Stage 3
    │
    ▼
Stage 3: External Arbitration (7 days)
    │
    ├── Kleros-style juror panel: Final resolution
    └── No appeal possible after Stage 3
```

### 5.2 Payout Structure

From ECONOMICS.md, with refinements:

**Challenger wins:**
```
challenger_receives = stake_returned + 50 VOTER reward + (creator_penalty x 0.5)
creator_penalty = creator_bond x 2
protocol_treasury = creator_penalty x 0.5
```

**Challenger loses:**
```
challenger_forfeits = stake (100 VOTER)
    90% burned (deflationary pressure)
    10% to protocol treasury
creator_receives = trust_score += 5 (reputation boost, no tokens)
```

**Neither wins (Stage 2 tie → Stage 3):**
```
Both stakes locked until Stage 3 resolution.
Losing party pays arbitration costs (5 VOTER from locked stake).
```

### 5.3 Challenge Scope

Not all challenges are quality challenges. The system supports three challenge types:

| Type | Target | Adjudication | Scope |
|------|--------|--------------|-------|
| **Quality Challenge** | Template content (grammar, accuracy, clarity) | AI re-evaluation + community vote | Most common |
| **Factual Challenge** | Specific factual claims in template | Evidence-based (requires citation) | Verifiable claims only |
| **Coordination Challenge** | Campaign coordination patterns (astroturf) | Structural metrics review | GDS < 0.05 AND temporal entropy < 1.5 bits |

Coordination challenges are special: they target campaigns, not templates. A coordination challenge triggers a campaign health audit using the existing structural signal architecture (COORDINATION-INTEGRITY-SPEC Section 4). The challenge succeeds only if measurable structural anomalies exist — subjective judgments about "astroturf" are not sufficient.

### 5.4 Why Three Stages

**Stage 1 (AI)** handles the easy cases. Templates that are clearly good or clearly bad don't need human judgment. The AI consensus layer already runs at creation time (Layer 1 in E0); Stage 1 re-runs it with the challenge as additional context. This resolves ~70% of challenges in minutes, preventing the voter apathy problem that plagued historical TCRs.

**Stage 2 (Community)** handles the subjective cases that AI can't resolve. Trust-weighted voting (not token-weighted) prevents plutocracy. Only users with trust_score >= 65 (established+) can vote, ensuring quality of judgment. The 60% threshold requires clear consensus, not bare majority.

**Stage 3 (External Arbitration)** handles the contentious cases that the community can't resolve internally. This is the Kleros innovation: outsourcing dispute resolution to an economically-incentivized external juror pool. See [Section 11](#11-the-kleros-alternative-external-arbitration).

### 5.5 What Challenge Markets Are Not

Challenge markets are **not**:

- **Content moderation.** The protocol already has a three-layer moderation pipeline (Prompt Guard, Llama Guard, Gemini). Challenges are about quality, not safety. Safety is handled by moderation.
- **Political gatekeeping.** A challenge cannot dispute a template's political position. Only factual accuracy, clarity, grammar, and completeness are challengeable attributes. Political viewpoint is never a valid challenge basis.
- **Censorship.** A successful challenge does not remove a template. It flags it with a quality warning and forfeits the creator's bond. Users can still use flagged templates. The flag is information, not a gate.

---

## 6. Scrutiny Point: Political Weaponization

### 6.1 The Threat

The most dangerous failure mode for challenge markets in civic infrastructure. One political faction systematically challenges every template from the opposing side, using challenges as a tool of political suppression rather than quality curation.

**Attack economics:**
- Cost per challenge: 100 VOTER
- If 30% of challenges succeed (opponent's templates are borderline): 30% return + reward
- Even if most challenges fail: 90% of stake burned, but the *chilling effect* on opposing template creators may be worth the cost to a well-funded political operation.

### 6.2 Why This Is Worse Than Standard TCR Griefing

In standard TCRs, griefing is economically irrational because the attacker's goal is to damage the registry, which damages the token value, which damages the attacker's holdings. The incentives are self-correcting.

In civic infrastructure, **the attacker's goal is not financial.** A political operation challenging templates doesn't care about VOTER token value. Their ROI is measured in suppressed civic speech, not token returns. The economic self-correction mechanism doesn't apply when the attacker has non-economic objectives.

### 6.3 Solutions

**Solution 1: Blind Challenge Review**

During Stage 2 (community vote), template content is presented to voters with political identifiers stripped:
- Representative names replaced with "[Representative A]", "[Representative B]"
- Party affiliations removed
- Bill numbers replaced with "[Bill X]"
- Geographic references generalized

Voters evaluate grammar, clarity, completeness, and factual accuracy on depoliticized content.

**Pitfall:** Stripping political context may remove information necessary to evaluate factual accuracy ("This bill will increase taxes" — is this factual? Depends on which bill). **Approach out:** Factual challenges are exempted from blind review. They require specific citations and are evaluated on evidence, not political judgment. Quality challenges (grammar/clarity/completeness) are blinded.

**Solution 2: Challenge Cooldown Per Challenger**

```
max_challenges_per_user_per_week = 3
max_challenges_per_user_per_campaign = 1
```

A political operation cannot challenge 100 templates per week — it can challenge 3. To mount a political suppression campaign, the operation needs 33+ accounts per week. Each account requires trust_score >= 65 (established tier), which requires identity verification and months of legitimate participation.

**Pitfall:** This limits legitimate high-volume challengers (think: quality auditors who review many templates). **Approach out:** Trusted-tier users (trust_score >= 85) have a higher limit: 10/week. Their track record provides social collateral. Challenge success rate is tracked; users with < 30% success rate get their limit reduced to 1/week.

**Solution 3: Asymmetric Cost Scaling**

```
challenge_cost(n) = base_cost x (1 + 0.5 x challenges_filed_this_month)

1st challenge:  100 VOTER
5th challenge:  350 VOTER
10th challenge: 600 VOTER
20th challenge: 1,100 VOTER
```

Escalating costs make sustained political attack campaigns exponentially expensive.

**Pitfall:** This also makes it expensive for legitimate quality enforcement during a spam wave. If 50 low-quality templates appear simultaneously, honest challengers face escalating costs to challenge all of them. **Approach out:** Coordination challenges (campaign-level, not template-level) are exempt from scaling. If 50 templates are part of one campaign, one coordination challenge covers the entire campaign. Template-level escalation applies only to individually-targeted challenges.

### 6.4 Residual Risk

Even with all three solutions, political weaponization is **not fully eliminated.** A sufficiently motivated adversary with access to 10+ established accounts, willing to spend escalating challenge costs, and patient enough to spread attacks over months, can suppress templates through the chilling effect alone — creators may stop creating templates in controversial areas because the *threat* of challenge is sufficient deterrent, even if challenges fail.

**Honest assessment:** This is the fundamental tension between quality enforcement and free expression in any system. Challenges that cost nothing enable spam. Challenges that cost something enable economic suppression. No mechanism simultaneously eliminates both. The protocol's approach minimizes the weaponization surface (blind review, cooldowns, escalating costs) while accepting that sufficiently motivated actors can still impose costs on creators.

**Backstop:** Governance can suspend challenge markets for specific action domains or campaigns if political weaponization is detected. This is a centralized intervention — contradicting decentralization — but is the correct tradeoff in Phase 1-2 governance, where the founder has emergency powers. As governance decentralizes (guardian council, Phase 3), suspension requires multi-party approval.

---

## 7. Scrutiny Point: Voter Apathy

### 7.1 The Threat

Historical TCRs died from voter apathy. Token holders had no incentive to spend time reviewing challenges — the rational strategy was to hold tokens and hope others curated the registry.

From Multicoin Capital: *"The rational strategy is not to vote on the candidates that they personally find to be of the highest quality, but rather the candidates that they think other voters will perceive to be of the highest quality."*

### 7.2 Why Voter Protocol Differs (And Where It Doesn't)

**Differences from standard TCRs:**

1. **Stage 1 (AI) resolves ~70% of challenges without human involvement.** Most clear-cut quality issues are handled automatically. Voters only see cases where AI consensus is genuinely ambiguous — these are the cases where human judgment adds value.

2. **Trust-weighted voting, not token-weighted.** Voting power comes from reputation (earned through civic participation), not from token holdings. This means whales can't dominate votes, and voting requires genuine community engagement, not just capital.

3. **Voting pool is small and invested.** Only established+ users (trust_score >= 65) can vote. This is a smaller, more engaged pool than "all token holders." They've demonstrated sustained civic engagement. Voter apathy is less likely among people who chose to participate in civic infrastructure.

**Where the threat persists:**

Even among engaged civic participants, challenge adjudication is *work*. Reading a template, evaluating its quality, comparing against challenge evidence — this takes 5-10 minutes per case. If Stage 2 presents 20 challenges per week, even motivated voters will experience fatigue.

### 7.3 Solutions

**Solution 1: De la Rouviere's Insight — Retroactive Voting Rewards**

Don't pay people to vote (prospective incentive). Instead, retroactively reward voters whose votes aligned with the final outcome.

```
voting_reward = 5 VOTER x (1 if vote_aligned_with_outcome else 0)
```

Distributed quarterly from the reward pool. Voters who consistently vote with the winning side receive ongoing rewards. This doesn't tell voters *how* to vote — it rewards accuracy, not a specific outcome.

**Pitfall:** This incentivizes conformity. Voters follow the herd rather than exercising independent judgment, creating a Keynesian beauty contest. **Approach out:** Votes are secret until the voting period ends (commit-reveal scheme). Voters cannot see how others are voting, so they cannot conform in real-time. They can only vote based on their own assessment.

**Pitfall of the approach out:** Commit-reveal requires two on-chain transactions per voter (commit + reveal). Gas costs may exceed voting rewards for small stakes. **Approach out:** Move commit-reveal off-chain using a HMAC scheme. Voter submits HMAC(vote, secret) to the protocol server during the voting period. After voting ends, voter submits the reveal (vote + secret). Server verifies HMAC. This is trust-dependent (server could precompute votes) but is acceptable for Phase E3 where the operator is still partially trusted. Full on-chain commit-reveal is a Phase 3+ upgrade when guardian governance is operational.

**Solution 2: Capped Queue**

Limit the number of active Stage 2 challenges to 5 per week. If more than 5 challenges reach Stage 2 in a week, additional challenges are queued and processed the following week. This prevents voter fatigue and ensures each case receives adequate attention.

**Pitfall:** During a spam wave, legitimate challenges get queued, allowing low-quality templates to persist longer. **Approach out:** AI Stage 1 handles spam waves. Templates that score < 0.30 in AI re-evaluation are auto-resolved without reaching Stage 2. The queue is only for genuinely ambiguous cases.

**Solution 3: Jury Selection (Small Panel)**

Instead of all eligible voters reviewing every challenge, randomly select a 7-person jury from the eligible pool for each challenge. Jury duty is mandatory for selected users (skip 3 times, trust_score penalty). This ensures:
- Each juror sees 1-2 cases per month, not 20.
- Jury is fresh for each case, preventing fatigue bias.
- Mandatory participation eliminates free-rider problem.

**Pitfall:** Random selection from a small pool creates predictability. An attacker who monitors the eligible pool could predict likely jurors and bribe/threaten them. **Approach out:** Jury selection uses the block hash at challenge filing time as randomness source, combined with the juror's identity_commitment. This is not perfectly unpredictable (miners can influence block hashes) but is sufficient for a system where maximum stakes are hundreds of VOTER, not millions.

---

## 8. Scrutiny Point: Griefing Economics

### 8.1 The Threat

The entry price dilemma from Multicoin Capital: *"The price of entry must be high enough to discourage bad candidates, while also being low enough to not price out honest entrants entirely."*

Applied to challenges: If challenge stakes are low (10 VOTER), anyone can grief by challenging everything — even if they lose every challenge, the cost to the creator (time, stress, reputation uncertainty) exceeds the attacker's economic cost. If challenge stakes are high (1,000 VOTER), only wealthy participants can challenge, creating a plutocratic quality enforcement system.

### 8.2 Current Design (Fixed 100 VOTER Stake)

The ECONOMICS.md spec uses a fixed 100 VOTER stake. Analysis:

**Griefing viability at different token prices:**

| VOTER Price | Challenge Cost (USD) | Viable for casual griefing? |
|-------------|---------------------|-----------------------------|
| $0.01 | $1.00 | Yes — trivially cheap |
| $0.10 | $10.00 | Marginal — annoying but affordable |
| $1.00 | $100.00 | No — real skin in the game |
| $10.00 | $1,000.00 | No — significant commitment |

At low token prices (early market), 100 VOTER is cheap and griefing is trivially easy. At high prices, challenges become expensive and potentially exclusionary.

### 8.3 Solutions

**Solution 1: USD-Denominated Challenge Stakes**

Same approach as E2 bonds: denominate in USD, pay in VOTER.

```
challenge_stake_USD = $50.00
challenge_stake_VOTER = $50.00 / oracle_price_USD
```

$50 is high enough to deter casual griefing at any token price, but low enough that a motivated quality enforcer can afford multiple challenges per month.

**Pitfall:** Entirely dependent on oracle accuracy. A stale oracle could make challenges too cheap or too expensive. **Approach out:** Same dual-oracle system as E2 bonds (Chainlink + Uniswap V3 TWAP, use higher price if divergent > 10%, circuit breaker if both unreachable).

**Solution 2: Reputation-Adjusted Stakes**

Higher-reputation challengers pay lower stakes:

```
effective_stake = base_stake x (1.5 - (trust_score / 200))

trust_score = 65 (minimum): 1.175x base_stake
trust_score = 85:            1.075x base_stake
trust_score = 100:           1.0x base_stake
```

Users with proven track records face less friction when challenging. New challengers (who are more likely to be griefers) pay more.

**Pitfall:** This creates a two-tier system where established users can challenge cheaply while new users face higher barriers. **Approach out:** The asymmetry is intentional and mirrors the bond system (trusted creators stake zero). The challenge market is not meant to be egalitarian — it's meant to be accurate. Established users with high success rates contribute more signal per challenge. They should face less friction.

**Solution 3: Challenger Success Rate Tracking**

```
If challenge_success_rate < 20% over last 10 challenges:
    challenge_stake *= 3 (tripled cost)
    max_challenges_per_week = 1

If challenge_success_rate > 80% over last 10 challenges:
    challenge_stake *= 0.5 (halved cost)
    max_challenges_per_week = 10
```

The system dynamically rewards accurate challengers and punishes inaccurate ones. Serial griefers quickly face prohibitive costs.

**Pitfall:** New challengers have no track record, so they start at base cost and base limits. A griefer could create a new account for each challenge to avoid rate tracking. **Approach out:** Challenge eligibility requires trust_score >= 65, which requires months of legitimate participation. Creating throw-away challenger accounts is expensive in time, making griefing unsustainable even with account rotation.

---

## 9. Scrutiny Point: AI Consensus Gaming

### 9.1 The Threat

If templates are scored by AI agents, sophisticated creators will optimize for AI scores rather than civic impact. This is the educational equivalent of "teaching to the test" — templates that ace the rubric but fail to move decision-makers.

The attack vector is straightforward: reverse-engineer the scoring rubric (grammar 0.25, clarity 0.25, completeness 0.20, factual accuracy 0.15, civility 0.10, impact potential 0.05) and generate templates that maximize each component mechanically.

### 9.2 Current Mitigation

The scoring rubric is already public (ECONOMICS.md). There is no security-through-obscurity. The question is whether optimizing for the rubric produces bad templates. Analysis:

| Component | Gaming strategy | Result of gaming |
|-----------|----------------|------------------|
| Grammar (0.25) | Use Grammarly/GPT | Higher quality (alignment) |
| Clarity (0.25) | Target 8th-10th grade reading level | More accessible (alignment) |
| Completeness (0.20) | Fill all required fields, add citations | More substantive (alignment) |
| Factual accuracy (0.15) | Include verifiable claims with sources | Better informed (alignment) |
| Civility (0.10) | Avoid inflammatory language | More civil discourse (alignment) |
| Impact potential (0.05) | Bipartisan appeal, specificity | Better advocacy (alignment) |

**Observation:** For most components, optimizing for the AI score *also* produces better templates. The rubric is designed so that gaming it is productive. Grammar optimization makes templates more readable. Clarity optimization makes them more accessible. Factual accuracy optimization makes them more credible.

### 9.3 Where Gaming Diverges From Quality

The divergence occurs in two places:

**1. Formulaic templates.** Templates that hit every rubric point but feel robotic — like a perfectly structured 5-paragraph essay that nobody wants to read. The rubric measures structural quality but not voice, authenticity, or persuasive power.

**Mitigation:** The `impact_potential` component (0.05 weight) partially captures this, but at low weight. More importantly, retroactive rewards (E1) measure *actual usage* — formulaic templates that nobody uses won't generate impact regardless of their AI score. The market corrects for this.

**2. Citation stuffing.** Templates that include 10 sources to max the factual accuracy score, most of which are tangentially related. The AI agent checks that sources exist, not that they're relevant.

**Mitigation:** Multi-agent consensus helps — if one agent flags citation relevance while another doesn't, the consensus bonus (0.9x for split decisions) reduces the score. For E3 challenges, factual challenges can specifically target misleading citations.

### 9.4 Long-Term Solution: Human Override Weight

In Stage 2 of the challenge process, human voters can override the AI assessment. If community votes consistently diverge from AI scores on a specific quality dimension, the system learns:

```
If Stage 2 overrides Stage 1 more than 30% of the time on dimension X:
    Reduce AI weight for dimension X by 0.05
    Increase human weight for dimension X by 0.05
    Log drift for governance review
```

This creates a feedback loop where the AI scoring adapts to community quality norms over time.

**Pitfall:** Community quality norms may drift toward political preferences ("this template is low quality because I disagree with its position"). **Approach out:** Blind challenge review (Section 6.3, Solution 1) applies. Voters evaluate quality on depoliticized content. Political preferences cannot influence quality votes because political context is stripped.

---

## 10. Scrutiny Point: Speculation Dominance

### 10.1 The Threat

The deepest failure mode of token-curated systems: the token's price becomes the game. Participants optimize for token appreciation rather than civic quality. Trading volume exceeds usage volume. The protocol becomes a speculative vehicle that happens to have a civic frontend, rather than civic infrastructure that happens to have a token.

From Scenes with Simon: *"Information monetized primarily through financial returns prioritizes virality over meaningfulness. Users become protocol-servants rather than thoughtful curators."*

### 10.2 Why This Kills Civic Infrastructure Specifically

Civic infrastructure requires *trust from decision-makers* — congressional offices, regulatory agencies, school boards. These institutions evaluate the credibility of constituent communications. If the protocol is perceived as a speculative token project:

1. Congressional offices ignore all communications from the platform ("it's a crypto scheme").
2. Regulatory bodies refuse to accept submissions ("unverified financial incentive to submit").
3. Media frames the project as "crypto meets politics" rather than "civic technology."
4. Users optimize for token-farming rather than genuine civic engagement.

The reputational damage from speculation dominance is existential for civic infrastructure in a way it isn't for DeFi protocols.

### 10.3 Solutions

**Solution 1: Challenge Markets With Stablecoins, Not VOTER Token**

Decouple challenge stakes from token speculation entirely. Challenge deposits, bonds, and rewards are denominated and paid in USDC/DAI, not VOTER.

VOTER token role is limited to:
- Governance voting (protocol upgrades, parameter changes)
- Trust score boosting (optional — holding VOTER increases trust_score cap by 5%)
- Retroactive rewards (E1 — can be claimed as VOTER or USDC at oracle rate)

Challenge market economics operate in stable value. Speculation in VOTER cannot affect challenge dynamics.

**Pitfall:** This removes the "token holders are incentivized to maintain registry quality because quality maintains token value" feedback loop, which is the core TCR mechanism. **Approach out:** In civic infrastructure, this feedback loop is harmful, not helpful. We don't want quality enforcement to be motivated by token price. We want quality enforcement to be motivated by civic norms. The stablecoin approach eliminates the financial reflexivity that makes TCRs unstable, at the cost of the self-reinforcing quality incentive. The quality incentive is replaced by reputation incentives (trust score) which are non-tradeable and non-speculative.

**Solution 2: Non-Transferable Reputation Tokens (ERC-8004)**

ECONOMICS.md already references ERC-8004 (Non-Transferable NFT Reputation Standard). Extend this: all challenge-related rewards are in non-transferable reputation, not liquid tokens.

```
challenge_win_reward = +10 trust_score (permanent) + 50 VOTER (liquid)
challenge_loss_penalty = -5 trust_score (permanent) + 100 VOTER forfeited

Reputation earned from challenges is non-transferable and non-tradeable.
```

The permanent trust score change provides lasting incentive (higher trust = more capabilities). The VOTER payout provides immediate but modest financial reward.

**Pitfall:** If most of the reward is reputation and reputation is non-transferable, the financial incentive to challenge may be too weak to motivate participation. **Approach out:** This is intentional. The challenge market should attract participants motivated by civic quality, not financial returns. Users who find +10 trust_score insufficient motivation are not the users we want adjudicating template quality. The 50 VOTER liquid reward ensures the mechanism isn't purely altruistic — it covers the opportunity cost of time — but it's not meant to be profitable.

**Solution 3: Speculation Circuit Breaker**

If VOTER token trading volume exceeds protocol usage volume by 10x for 30 consecutive days, automatically:
1. Pause all token-denominated rewards.
2. Switch challenge bonds to stablecoin-only.
3. Emit governance event alerting the community.

This is a measurable, automated response to speculation dominance. The threshold is intentionally high (10x) to avoid false positives during normal market activity.

**Pitfall:** Pausing token rewards during a speculation wave may crash the token price, harming legitimate holders. **Approach out:** The circuit breaker pauses *new* reward issuance, not existing token functionality. Existing rewards continue vesting. The circuit breaker protects the civic infrastructure from being dominated by speculation; it does not attempt to stabilize the token price. Price stabilization is not the protocol's goal.

---

## 11. The Kleros Alternative: External Arbitration

### 11.1 Why External Arbitration

Stage 3 of the challenge process requires a resolution mechanism for cases that community voting cannot decide. Two options exist:

**Option A: Internal arbitration (guardian council).**
The protocol's own guardians decide. This is fast but creates a governance bottleneck and potential for guardian capture by political factions.

**Option B: External arbitration (Kleros or equivalent).**
An economically-incentivized external juror pool decides. This is slower but eliminates internal governance capture.

The Kleros model has been tested since 2019 with Generalized TCRs. Key features:
- Jurors are randomly selected from a staking pool.
- Jurors who vote with the majority receive rewards; jurors who vote against lose stake.
- Crowdfunded appeals allow disputed rulings to be elevated.
- Schelling point coordination incentivizes honest, independent judgment.

### 11.2 Integration Architecture

```
Stage 2 (Community Vote) → No clear winner (neither side > 60%)
    │
    ▼
Protocol creates Kleros dispute
    │ - Evidence: template content, challenge reasoning, AI scores, vote results
    │ - Category: "Template Quality" (defined policy)
    │ - Arbitration cost: 5 VOTER from losing party's locked stake
    │
    ▼
Kleros juror panel selected (3 jurors for standard, 7 for appeal)
    │
    ▼
Jurors review evidence, vote (7-day period)
    │
    ▼
Ruling returned to protocol
    │
    ├── Winner determined: Execute payout per Section 5.2
    └── Appeal filed (24h window): Escalate to 7-juror panel
```

### 11.3 Pitfalls of External Arbitration

**Pitfall:** Kleros jurors have no domain expertise in civic advocacy. They're crypto-native users judging template quality for congressional communications.

**Approach out:** Define a detailed adjudication policy (the "primary document" in Kleros terminology) that specifies:
- What constitutes a quality failure (grammar, factual accuracy, completeness — with examples)
- What does NOT constitute a quality failure (political position, controversial topic, unpopular opinion)
- Scoring rubric matching the AI consensus rubric
- Explicit instruction that political viewpoint is never relevant

Kleros jurors follow the policy, not their own judgment. The policy becomes the quality standard.

**Pitfall:** Low dispute volume means low juror incentive, leading to few stakers and slow resolution.

**Approach out:** Kleros operates across many protocols. Even if Voter Protocol generates few disputes, the juror pool is shared across all Kleros-integrated protocols. Juror availability is a function of the entire Kleros ecosystem, not just our dispute volume.

**Pitfall:** Kleros operates on Ethereum mainnet/Gnosis Chain. Voter Protocol is on Scroll L2. Cross-chain dispute resolution adds latency and bridge risk.

**Approach out:** Use an off-chain dispute relay. Protocol server submits evidence to Kleros, receives ruling via event monitoring, then executes the outcome on Scroll. The relay is trust-dependent (server could suppress rulings) but acceptable in Phase 1-2 governance. Full on-chain integration via Scroll → Ethereum L1 messaging is a Phase 3+ upgrade.

---

## 12. The UMA Alternative: Optimistic Resolution

### 12.1 Mechanism

UMA's Optimistic Oracle provides an alternative to Kleros-style juror panels. The mechanism used by Polymarket:

1. A question is posed ("Is this template quality below standard?")
2. A proposer answers with a bond ("Yes, it is below standard" + 100 VOTER bond)
3. A 2-hour challenge period allows anyone to dispute the proposal
4. If nobody disputes, the proposal is accepted as truth
5. If disputed, UMA token holders vote on the resolution

The key insight: **disputes are rare because the incentives favor honesty.** Proposers who lie lose their bond. Disputers who correctly dispute earn the proposer's bond. The equilibrium is that proposals are honest, and the system rarely needs to escalate to a vote.

### 12.2 Application to Voter Protocol

Replace Stage 3 (External Arbitration) with UMA Optimistic Oracle:

```
Stage 2 (Community Vote) → No clear winner
    │
    ▼
Optimistic Resolution:
    │ - Challenger's evidence package becomes the "assertion"
    │ - 2-hour challenge window for counter-evidence
    │ - If unchallenged: assertion accepted, challenger wins
    │ - If challenged: escalate to UMA token holder vote
```

### 12.3 Comparative Analysis

| Feature | Kleros | UMA | Internal (Guardian) |
|---------|--------|-----|---------------------|
| Resolution speed | 7-14 days | 2 hours (if unchallenged) | 24-48 hours |
| Cost per dispute | ~$20-50 in ETH | ~$50-100 in UMA bonds | Zero (governance overhead) |
| Domain expertise | Low (general jurors) | Low (token holders) | High (guardians are civic domain experts) |
| Decentralization | High | High | Low (Phase 1-2 founder control) |
| Cross-chain complexity | High | Medium (oracle bridges exist) | None (same chain) |
| Capture resistance | High (random selection) | Medium (large token holder influence) | Low (guardian capture possible) |
| Track record | Proven since 2019 | Proven (Polymarket, 2020+) | Untested |

### 12.4 Recommendation

**Phase E3 initial deployment:** Internal (Guardian) arbitration. Simplest, fastest, no cross-chain complexity. Acceptable because the guardian council is already the governance authority in Phase 1-2.

**Phase 3+ upgrade:** Kleros integration when guardian governance decentralizes. Kleros provides the strongest capture resistance and the most established dispute resolution infrastructure.

**UMA as backup:** If Kleros integration proves too complex (cross-chain), UMA's optimistic oracle is a viable alternative with faster resolution times.

---

## 13. Economic Attack Surface

Extending ADVERSARIAL-ATTACK-DOMAINS Domain 8 (Game Theory & Economics) with challenge-market-specific attacks:

### 13.1 Challenge Cartel

**Attack:** A group of 10 high-trust users (trust_score >= 85) coordinate to systematically win challenges by voting as a bloc in Stage 2.

**Defense:** Jury selection (Section 7.3, Solution 3) randomly selects 7 voters per challenge from the eligible pool. A cartel of 10 in a pool of 200+ established users has ~3.5% chance of getting a majority on any single jury. The cartel would need to be 50%+ of all established users to reliably control outcomes.

**Residual risk:** In a small community (< 50 established users), a cartel of 10 controls 20%+ of the jury pool. **Mitigation:** Do not activate E3 until the established-tier user base exceeds 200.

### 13.2 Wash Challenging

**Attack:** A creator challenges their own template from a separate account to earn the "successful defense" reputation boost (+5 trust score per defense).

**Defense:** Challenge costs 100 VOTER even if the challenger loses. Self-challenging costs the attacker 100 VOTER per attempt (90% burned, 10% to treasury) for a +5 trust score gain. At any non-trivial token price, this is economically irrational.

**Residual risk:** At very low token prices ($0.001/VOTER), self-challenging costs $0.10 for +5 trust score. **Mitigation:** Trust score gain from successful defense is capped: maximum +5 per month from challenge defenses, regardless of how many challenges are defended.

### 13.3 Oracle Manipulation

**Attack:** Flash-loan manipulation of Uniswap VOTER/ETH pool to temporarily spike the VOTER price, making USD-denominated bonds/stakes require fewer tokens, then challenge cheaply.

**Defense:** 15-minute TWAP (time-weighted average price) from both Chainlink and Uniswap V3. Flash loans affect spot price but not 15-minute TWAP. Additionally, circuit breaker triggers on > 50% price movement in 24 hours.

**Residual risk:** Sustained (multi-block) price manipulation over 15+ minutes by a well-capitalized attacker. **Mitigation:** This requires maintaining a manipulated price for 15 minutes, which is enormously expensive on any liquid market. The defense scales with market liquidity — as VOTER becomes more liquid, manipulation becomes more expensive.

### 13.4 Information Asymmetry in Metric Weight Commitment

**Attack:** (From Section 3.3) Governance insiders who commit metric weights may trade on advance knowledge of which templates will be retroactively rewarded.

**Defense:** Metric weight commitment scheme: weights are hashed and committed on-chain at the start of each quarter. Governance members cannot trade templates they created during the commitment period (tracked via on-chain identity). If governance member's templates appear in the top 10% of retroactive rewards, their allocation is quarantined for review.

**Residual risk:** Governance members can advise *other* template creators about likely winning strategies, creating an indirect information advantage. **Mitigation:** Accept this as an imperfect tradeoff. The metric weights are broadly predictable (geographic diversity and impact will always matter), so the information advantage is marginal. Perfect information symmetry requires fully randomized metrics, which would make the system unpredictable and unfair.

---

## 14. Gate Criteria: When to Advance Phases

Each gate is a hard requirement, not a suggestion. The protocol does not advance until all criteria are met.

### Gate E0 → E1

| Criterion | Threshold | Measurement |
|-----------|-----------|-------------|
| Verified submissions | > 10,000 total | NullifierRegistry event count |
| Unique templates | > 500 | CampaignRegistry template count |
| Unique template creators | > 100 | On-chain creator addresses |
| Operating duration | > 6 months | Time since first on-chain submission |
| Repeat user rate | > 30% | Users with 2+ submissions in 30 days |
| Template quality distribution | Stable (< 10% variance month-over-month) | AI consensus score distribution |
| No critical security incidents | Zero P0 findings unresolved | Security audit status |

### Gate E1 → E2

| Criterion | Threshold | Measurement |
|-----------|-----------|-------------|
| Retroactive distributions completed | >= 3 quarters | On-chain distribution events |
| Distribution non-controversial | Zero governance disputes about distributions | Governance event log |
| Token launched and liquid | > $100K daily trading volume | DEX analytics |
| Template creation rate stable post-rewards | Within 20% of pre-reward rate | Template creation events |
| No crowding-out detected | Repeat user rate still > 30% | User behavior analytics |

### Gate E2 → E3

| Criterion | Threshold | Measurement |
|-----------|-----------|-------------|
| Bond system operational | > 3 months | Time since bond contract deployment |
| Challenge rate against bonded templates | < 5% of templates challenged | Challenge events / template count |
| Bond amounts calibrated | Effective spam rate < 1% | Templates flagged as spam / total |
| Established-tier users | > 200 | Users with trust_score >= 65 |
| Guardian council operational | >= 3 guardians in different jurisdictions | Guardian registry |
| Governance proposal approved | 2/3 guardian approval | On-chain governance vote |

### Emergency Rollback

Any phase can be rolled back if:
- Template creation rate drops > 30% after phase activation
- Challenge success rate exceeds 50% (indicating systemic quality problems, not healthy curation)
- Political weaponization pattern detected (> 80% of challenges target templates with same political orientation)
- Token speculation circuit breaker triggers (10x trading/usage ratio for 30 days)

Rollback is a governance action with 24-hour timelock (emergency powers).

---

## 15. Integration with Existing Architecture

### 15.1 Contract Architecture

The challenge market requires three new contracts:

```
contracts/src/
├── (existing)
│   ├── DistrictGate.sol
│   ├── TimelockGovernance.sol
│   ├── CampaignRegistry.sol
│   ├── NullifierRegistry.sol
│   ├── VerifierRegistry.sol
│   └── GuardianShield.sol
│
├── (Phase E2 — new)
│   └── TemplateBondRegistry.sol       # Bond staking, forfeiture, return
│
└── (Phase E3 — new)
    ├── ChallengeMarket.sol            # Challenge filing, stage progression, payout
    └── ChallengeArbitrationBridge.sol  # Interface to Kleros/UMA (Phase 3+)
```

**TemplateBondRegistry.sol** manages:
- Bond deposits (ERC-20 VOTER or USDC)
- 7-day bond windows with auto-return
- Bond forfeiture on successful challenge
- Delegated staking (sponsor bonds)
- USD-denominated bond calculation via oracle

**ChallengeMarket.sol** manages:
- Challenge filing with evidence hash (IPFS)
- Stage 1 → Stage 2 → Stage 3 progression
- Vote recording (trust-weighted, commit-reveal in Phase 3+)
- Payout execution
- Challenge cooldown tracking per user
- Asymmetric cost scaling

**ChallengeArbitrationBridge.sol** manages:
- Kleros dispute creation (cross-chain relay)
- UMA assertion submission (alternative)
- Ruling receipt and execution
- Appeal escalation

### 15.2 Subgraph Extensions

The Graph subgraph (Wave 15c) extends with:

```graphql
type Challenge @entity {
  id: Bytes!
  template: Template!
  challenger: Bytes!
  challengeType: ChallengeType!
  stage: ChallengeStage!
  filedAt: BigInt!
  resolvedAt: BigInt
  outcome: ChallengeOutcome
  challengerStake: BigInt!
  creatorBond: BigInt!
  votes: [ChallengeVote!] @derivedFrom(field: "challenge")
}

type ChallengeVote @entity {
  id: Bytes!
  challenge: Challenge!
  voter: Bytes!
  vote: Boolean!  # true = support challenger
  weight: BigInt!  # trust-weighted
  timestamp: BigInt!
}

enum ChallengeType { QUALITY, FACTUAL, COORDINATION }
enum ChallengeStage { AI_REVIEW, COMMUNITY_VOTE, ARBITRATION, RESOLVED }
enum ChallengeOutcome { CHALLENGER_WIN, CREATOR_WIN, DRAW }
```

### 15.3 Coordination Integrity Integration

Challenge markets generate new structural signals for the coordination entropy indexer:

| Signal | What it reveals | Integration point |
|--------|----------------|-------------------|
| Challenge filing rate per campaign | Quality dispute density | Campaign health metrics |
| Challenge success rate per creator | Creator quality track record | Trust score calculation |
| Challenge vote entropy | Adjudication polarization | Governance health metrics |
| Challenge type distribution | Which quality dimensions are disputed most | AI rubric calibration |

These signals feed back into the existing campaign health dashboard (Wave 15d), adding an economic quality layer on top of the structural coordination layer.

---

## 16. Pitfall Registry

| Decision | Pitfall | Mitigation | Residual Risk |
|----------|---------|-----------|---------------|
| Four-phase sequencing | May be too slow; competitors launch with tokens first | Civic infrastructure competes on trust, not token incentives. Speed is not the advantage. | Competitors may capture users with unsustainable yield |
| Retroactive rewards (E1) | Metric gaming after first distribution reveals formula | Governance-committed metric weight rotation with hash commitment | Governance insiders have marginal information advantage |
| USD-denominated bonds/stakes | Oracle dependency; stale or manipulated prices | Dual oracle (Chainlink + Uniswap V3 TWAP), circuit breaker | Sustained multi-block manipulation (extremely expensive) |
| Blind challenge review | Stripping political context removes info needed for factual evaluation | Factual challenges exempted from blind review | Borderline cases where politics and facts intertwine |
| Challenge cooldown (3/week) | Limits legitimate high-volume quality enforcement | Trusted-tier gets 10/week; success rate adjusts limits | Spam waves may exceed enforcement capacity |
| Asymmetric cost scaling | Expensive for honest challengers during spam waves | Coordination challenges (campaign-level) exempt from scaling | Individual template spam not caught by campaign-level challenge |
| AI Stage 1 auto-resolution | AI may auto-resolve cases that humans would judge differently | 0.30-0.80 ambiguity band sends cases to Stage 2 | AI bias in edge cases near thresholds |
| Trust-weighted voting (not token-weighted) | Concentrates voting power among long-tenure users | New established-tier users join voting pool continuously | Early users have structural advantage |
| External arbitration (Kleros) | Cross-chain complexity; jurors lack civic domain expertise | Detailed adjudication policy; off-chain relay in Phase 1-2 | Policy compliance is voluntary for jurors |
| Stablecoin challenge stakes | Removes token-value self-correction mechanism | Reputation incentives replace financial reflexivity | Quality enforcement motivated by reputation, not money |
| Speculation circuit breaker | Pausing rewards may crash token price | Only pauses new issuance, not existing tokens | Legitimate holders face price impact from circuit breaker |
| Jury selection (7 random) | Small pool → predictable jury composition | Require 200+ established users before E3 activation | Colluding jurors from large cartels |
| Mandatory jury participation | Skip penalty may disproportionately affect busy users | 3 skips allowed per quarter; trust score penalty is small (-2) | Users may rubber-stamp to avoid penalty without genuine review |
| Challenge markets overall | Political weaponization by well-funded adversaries | Blind review + cooldowns + escalating costs + governance backstop | Sufficiently motivated adversary can impose chilling effect |

---

## Appendix A: Relationship to ECONOMICS.md

This document refines and sequences the mechanisms described in ECONOMICS.md. Key differences:

| ECONOMICS.md (Current) | This Document (Proposed) |
|-------------------------|--------------------------|
| All economic primitives in Phase 2 | Four sequential phases (E0-E3) |
| Fixed 100 VOTER challenge stake | USD-denominated, reputation-adjusted, escalating stakes |
| Token-weighted voting implied | Trust-weighted voting explicit |
| No blind review | Blind challenge review for quality challenges |
| No challenge cooldown | 3/week base, 10/week for trusted, success-rate-adjusted |
| No external arbitration | Kleros Stage 3 with UMA alternative |
| No speculation circuit breaker | Automatic pause at 10x trading/usage ratio |
| Challenge markets + bonds + rewards simultaneous | Sequential: E0 reputation → E1 retroactive → E2 bonds → E3 challenges |

If this document is accepted, ECONOMICS.md should be updated to reflect the phased sequencing and revised mechanisms. The formulas in ECONOMICS.md remain correct; this document adds sequencing, scrutiny analysis, and failure mode documentation.

---

## Appendix B: Research Sources

- Multicoin Capital, "Token Curated Registries: Features and Tradeoffs" (2018) — Failure mode taxonomy
- De la Rouviere, "Token-Curated Registries in 2023 and A Problem With Price Signals" — Post-mortem on TCR failures
- Kleros, "Generalized Token Curated Registries" — External arbitration model
- UMA Protocol — Optimistic oracle mechanism (Polymarket integration)
- IEEE, "Enhancing Engagement in Token-Curated Registries via an Inflationary Mechanism" — Voter apathy solutions
- VOTER Protocol COORDINATION-INTEGRITY-SPEC — Structural signal architecture
- VOTER Protocol TRUST-MODEL-AND-OPERATOR-INTEGRITY — Progressive decentralization roadmap
- VOTER Protocol ADVERSARIAL-ATTACK-DOMAINS — Economic attack surface (Domain 8)
- VOTER Protocol ANTI-ASTROTURF-IMPLEMENTATION-PLAN — Implementation wave methodology

---

---

## 17. Anti-Pay-to-Win Guarantees

> **Canonical reference:** [specs/REPUTATION-ARCHITECTURE-SPEC.md](../specs/REPUTATION-ARCHITECTURE-SPEC.md)

### 17.1 The Separation Principle

Authority, engagement, and economic participation are cryptographically independent. No function of one dimension can influence another:

| Dimension | Source | In ZK Proof | Purchasable | Transferable |
|-----------|--------|-------------|-------------|-------------|
| `authority_level` (1-5) | Identity verification (passport/ID/mDL) | Public input [28] | **No** | No |
| `engagement_tier` (0-4) | On-chain nullifier consumption events | Public input [30] | **No** | No |
| VOTER token balance | Market/earning/challenge wins | Not in proof | **Yes** | Yes |

**Why this matters for challenge markets:** If VOTER tokens could boost engagement tier, wealthy challengers would dominate resolution. If engagement tier could be purchased, astroturf operations would buy credibility. The separation principle ensures that economic power, civic standing, and identity verification remain independent dimensions.

### 17.2 Quadratic Influence with Engagement Multiplier

Challenge market influence combines token stake (economic signal) with engagement tier (credibility signal):

```
effective_influence = sqrt(stake) * engagement_multiplier(tier)
```

| Engagement Tier | Multiplier | Effect |
|----------------|------------|--------|
| 0 (New) | 1.0x | Base influence |
| 1 (Active) | 1.1x | Slight boost |
| 2 (Established) | 1.25x | Moderate boost |
| 3 (Veteran) | 1.5x | Significant boost |
| 4 (Pillar) | 2.0x | Double influence |

The quadratic root on stake prevents plutocratic dominance (10,000 VOTER provides only 100x the influence of 1 VOTER, not 10,000x). The engagement multiplier rewards civic standing without making it purchasable.

### 17.3 Dual Token Model

| Token | Standard | Transfer | Purpose | Challenge Market Role |
|-------|----------|----------|---------|----------------------|
| **VOTER** | ERC-20 | Unrestricted | Civic labor compensation | Stake in challenges, governance voting |
| **Soulbound Engagement Credential** | ERC-8004 | Prohibited | On-chain attestation of earned standing | Engagement multiplier on influence |

This differs from the original single-token design in `phase-2-design.md`:

| Original Design | Current Design |
|----------------|----------------|
| Single VOTER token for everything | VOTER (transferable) + soulbound credential (non-transferable) |
| Reputation on-chain as ERC-8004 score | Engagement tier in ZK proof (public output) |
| No separation between stake and credibility | Stake (VOTER) and credibility (tier) are independent |
| Token balance = influence | `sqrt(stake) * engagement_multiplier` = influence |

### 17.4 Integration with E0-E3 Sequencing

The engagement tree deploys in **Phase E0** — no token required:

```
E0: Reputation-Only Quality Signals (CURRENT)
    + Deploy Tree 3 (engagement tree)                    ← NEW
    + engagement_tier appears in proofs
    + Congressional offices see credibility signal
    (No token, no economic stakes)

E1: Retroactive Impact Rewards
    + VOTER token launched
    + Engagement tier informs reward distribution
    (Tier is informational, not gating)

E2: Template Creation Bonds
    + Engagement multiplier applied to bond thresholds
    + Higher tier → lower bond required (earned trust)

E3: Challenge Markets
    + sqrt(stake) * engagement_multiplier for influence
    + Full anti-pay-to-win system operational
```

The engagement tree is **deployed before the token** because civic credibility should exist independently of economics. This prevents the failure mode where reputation only matters because of token rewards.

---

*This document is an exploration, not a commitment. The challenge market may never be implemented if Phase E0 proves that reputation-only quality signals are sufficient. The best outcome is that this document is never needed.*

*VOTER Protocol | Challenge Market Architecture | 2026-02-20*
