# VOTER Protocol Economics

**Mathematical frameworks for reputation scores, reward distribution, and token economics.**

This document defines the algorithms and formulas that govern the VOTER Protocol's cryptoeconomic system. These calculations determine how civic actions translate into reputation scores and token rewards.

---

## Table of Contents

1. [Reputation Score Calculation](#reputation-score-calculation)
2. [Reward Distribution Algorithm](#reward-distribution-algorithm)
3. [Quality Metrics Formulas](#quality-metrics-formulas)
4. [Token Economics](#token-economics)
5. [Challenge Mechanism](#challenge-mechanism)
6. [Network Effects](#network-effects)

---

## Reputation Score Calculation

### Trust Score (0-100)

**Formula:**

```
trust_score = weighted_sum([
  civic_score × 0.40,
  challenge_score × 0.30,
  discourse_score × 0.20,
  verification_bonus × 0.10
]) × time_decay_factor
```

**Component Definitions:**

1. **Civic Score (0-100):**
   ```
   civic_score = min(100, (
     successful_actions × 10 +
     district_coverage_bonus +
     template_quality_bonus
   ))
   ```

   - `successful_actions`: Count of delivered messages
   - `district_coverage_bonus`: +5 per unique congressional district reached (max +30)
   - `template_quality_bonus`: Average quality score of templates created (max +20)

2. **Challenge Score (0-100):**
   ```
   challenge_score = (
     challenges_won / (challenges_won + challenges_lost + 1)
   ) × 100
   ```

   - Bayesian prior: Start at 50 with virtual 1 win, 1 loss
   - Challenges won: Successfully defended against quality challenges
   - Challenges lost: Failed to defend, content quality disputed

3. **Discourse Score (0-100):**
   ```
   discourse_score = min(100, (
     consensus_participation × 15 +
     template_approvals × 5 +
     constructive_feedback × 3
   ))
   ```

   - `consensus_participation`: Count of agent consensus votes cast
   - `template_approvals`: Templates approved by multi-agent consensus
   - `constructive_feedback`: Helpful corrections/suggestions provided

4. **Verification Bonus (0-100):**
   ```
   verification_bonus = {
     100  if verified via self.xyz (NFC passport)
     70   if verified via Didit.me (zero-knowledge proof)
     0    if unverified
   }
   ```

5. **Time Decay Factor:**
   ```
   time_decay_factor = 0.85 + (0.15 × recent_activity_ratio)

   where recent_activity_ratio =
     actions_last_30_days / max(total_actions, 1)
   ```

   - Encourages continued engagement
   - Prevents reputation hoarding
   - Floors at 85% of earned score

### Reputation Tiers

**Threshold Boundaries:**

```
novice:      0 ≤ trust_score < 40
emerging:    40 ≤ trust_score < 65
established: 65 ≤ trust_score < 85
trusted:     85 ≤ trust_score ≤ 100
```

**Tier Privileges:**

- **Novice**: Can use templates, limited to 3 actions/week
- **Emerging**: Can create templates (moderation required), 10 actions/week
- **Established**: Templates auto-approved if quality > 75, unlimited actions
- **Trusted**: Can participate in consensus voting, challenge adjudication

**Demotion Criteria:**

- Trust score drops below tier threshold for 14 consecutive days
- Immediate demotion on challenge loss (recompute trust_score)
- Slashing events (spam, abuse, fraud)

---

## Reward Distribution Algorithm

### Base Reward Calculation

**Formula:**

```
reward_amount = base_reward_USD × multipliers × conversion_rate

where multipliers = (
  participation_score_multiplier ×
  market_conditions_multiplier ×
  time_decay_multiplier ×
  impact_multiplier
)
```

**Component Definitions:**

1. **Base Reward (USD):**
   ```
   base_reward_USD = {
     $0.50  for template usage (send message)
     $2.00  for template creation (approved)
     $5.00  for district expansion (first action in new district)
     $10.00 for consensus participation (agent voting)
   }
   ```

2. **Participation Score Multiplier (0.5x - 2.0x):**
   ```
   participation_multiplier =
     0.5 + (1.5 × (trust_score / 100))

   Examples:
     trust_score = 0   → 0.5x multiplier
     trust_score = 50  → 1.25x multiplier
     trust_score = 100 → 2.0x multiplier
   ```

3. **Market Conditions Multiplier (0.8x - 1.2x):**
   ```
   market_multiplier = 1.0 + (
     0.2 × tanh((token_price_change_30d / 100))
   )

   where tanh() bounds multiplier to ±20%
   ```

   - Stabilizes rewards during price volatility
   - Prevents hyperinflation during bull markets
   - Prevents reward collapse during bear markets

4. **Time Decay Multiplier (1.0x - 0.5x):**
   ```
   time_decay = max(0.5, 1.0 - (0.1 × weeks_since_action))

   Rewards must be claimed within 5 weeks or decay to 50%
   ```

5. **Impact Multiplier (1.0x - 5.0x):**
   ```
   impact_multiplier = 1.0 + min(4.0, (
     (districts_reached / 435) × 2.0 +
     (template_sends / 1000) × 1.0 +
     (quality_score / 100) × 2.0
   ))

   Examples:
     Local impact (1 district): 1.0x
     State impact (10 districts): 1.05x
     National impact (300+ districts): 2.5x+
     Viral template (10k+ sends): 3.5x+
   ```

6. **Conversion Rate:**
   ```
   VOTER_tokens = USD_reward / oracle_price_USD
   ```

   - Chainlink price oracle for USD/VOTER
   - 15-minute TWAP (time-weighted average price)
   - Prevents oracle manipulation

### Reward Distribution Schedule

**Vesting:**

```
immediate:  25% (available instantly)
30_days:    25% (linear vest over 30 days)
90_days:    25% (linear vest over 90 days)
180_days:   25% (linear vest over 180 days)
```

**Claim Mechanics:**

```
claimable_amount =
  immediate_rewards +
  vested_30d × (days_elapsed / 30) +
  vested_90d × (days_elapsed / 90) +
  vested_180d × (days_elapsed / 180)

subject to time_decay_multiplier if unclaimed > 5 weeks
```

---

## Quality Metrics Formulas

### Template Quality Score (0-100)

**Multi-Agent Consensus Formula:**

```
quality_score = weighted_average([
  agent_1_score × confidence_1,
  agent_2_score × confidence_2,
  agent_3_score × confidence_3
]) × consensus_bonus

where consensus_bonus = {
  1.1  if unanimous (all scores within 10 points)
  1.0  if majority (2/3 agree within 10 points)
  0.9  if split (no clear consensus)
}
```

**Agent Score Breakdown:**

```
agent_score = (
  grammar_score × 0.25 +
  clarity_score × 0.25 +
  completeness_score × 0.20 +
  factual_accuracy × 0.15 +
  civility_score × 0.10 +
  impact_potential × 0.05
)
```

**Component Scoring (0-100 each):**

1. **Grammar Score:**
   - Spelling errors: -5 per error
   - Grammar mistakes: -10 per mistake
   - Punctuation issues: -2 per issue

2. **Clarity Score:**
   - Flesch-Kincaid reading level target: 8th-10th grade
   - Sentence length variance
   - Paragraph structure

3. **Completeness Score:**
   - Required fields filled: 20 points each (x5)
   - Source citations: +10 per valid citation
   - Personal connection prompt: +10 if present

4. **Factual Accuracy:**
   - Verifiable claims: +15 per claim (max 5)
   - Source credibility: Government/academic sources +25
   - Data recency: Published within 12 months +10

5. **Civility Score:**
   - No profanity: 50 points baseline
   - Respectful tone: +25 points
   - Constructive framing: +25 points
   - Deductions for inflammatory language

6. **Impact Potential:**
   - Bipartisan appeal: +20
   - Urgency/timeliness: +20
   - Specificity of ask: +10

### Consensus Score (0.0 - 1.0)

**Formula:**

```
consensus_score = (sum of agent scores) / (num_agents × 100)

where agent_score ∈ [0, 100] for each agent
```

**Thresholds:**

```
consensus_score ≥ 0.75  → Auto-approve
0.50 ≤ consensus_score < 0.75  → Human review
consensus_score < 0.50  → Auto-reject
```

### Severity Level (1-10)

**Formula:**

```
severity_level = floor(
  (100 - quality_score) / 10
)

Examples:
  quality_score = 95 → severity = 0 (no issues)
  quality_score = 75 → severity = 2 (minor issues)
  quality_score = 45 → severity = 5 (moderate issues)
  quality_score = 15 → severity = 8 (severe issues)
```

**Severity Actions:**

- `severity ≤ 2`: Auto-approve
- `3 ≤ severity ≤ 5`: Flag for review, suggest corrections
- `severity > 5`: Reject, require resubmission

---

## Token Economics

### Supply Dynamics

**Total Supply:**

```
total_supply = 100,000,000 VOTER (fixed cap)
```

**Allocation:**

```
community_rewards:  40,000,000 VOTER (40%)
protocol_treasury:  25,000,000 VOTER (25%)
team_contributors:  20,000,000 VOTER (20%)
early_backers:      10,000,000 VOTER (10%)
liquidity_provision: 5,000,000 VOTER (5%)
```

**Emission Schedule (Community Rewards):**

```
Year 1: 10,000,000 VOTER (25% of community allocation)
Year 2:  8,000,000 VOTER (20%)
Year 3:  6,000,000 VOTER (15%)
Year 4:  5,000,000 VOTER (12.5%)
Year 5+: Remaining 11,000,000 VOTER (linear vest over 10 years)
```

**Daily Emission (Year 1):**

```
daily_emission = 10,000,000 / 365 ≈ 27,397 VOTER/day
```

### Reward Pool Mechanics

**Pool Replenishment:**

```
daily_pool = daily_emission + slashing_proceeds + challenge_fees

where:
  slashing_proceeds = tokens burned from violations
  challenge_fees = 10% of losing challenger's stake
```

**Pool Allocation Priority:**

1. **High-Impact Actions** (50% of pool):
   - District expansion bonuses
   - Viral template creation
   - Consensus participation

2. **Regular Actions** (40% of pool):
   - Template usage
   - Message delivery
   - Quality contributions

3. **Governance** (10% of pool):
   - Challenge adjudication
   - Protocol upgrades
   - Community initiatives

### Slashing Conditions

**Automatic Slashing:**

```
spam_violation:       -10% of total_earned
abuse_violation:      -25% of total_earned
fraud_violation:      -50% of total_earned + ban
consensus_violation:  -5% of pending_rewards
```

**Challenge-Based Slashing:**

```
If template quality challenged and challenger wins:
  creator_penalty = stake_amount × 2
  challenger_reward = stake_amount + (creator_penalty × 0.5)
  protocol_treasury = creator_penalty × 0.5
```

### Staking Requirements

**Template Creation Bond:**

```
required_stake = {
  0 VOTER         if trust_score ≥ 85 (trusted tier)
  100 VOTER       if 65 ≤ trust_score < 85 (established)
  250 VOTER       if 40 ≤ trust_score < 65 (emerging)
  500 VOTER       if trust_score < 40 (novice)
}
```

**Challenge Stake:**

```
challenge_stake = 100 VOTER (fixed)

Outcomes:
  Challenger wins:  Recover stake + 50 VOTER reward
  Challenger loses: Lose stake (10% to protocol, 90% burned)
```

---

## Challenge Mechanism

### Challenge Economics

**Challenge Formula:**

```
challenge_success_probability = logistic(
  evidence_strength × 0.4 +
  community_votes × 0.3 +
  historical_accuracy × 0.3
)

where logistic(x) = 1 / (1 + e^(-x))
```

**Evidence Strength (0-100):**

- Source verification: +30
- Factual contradictions: +25 per contradiction
- Grammar/clarity issues: +15 per major issue
- Community flags: +5 per unique flagger (max +30)

**Community Votes:**

```
vote_weight = voter_trust_score / 100

weighted_votes = sum(vote × weight for all voters)
community_score = (weighted_votes / total_possible_votes) × 100
```

**Historical Accuracy:**

```
historical_accuracy = (
  (challenges_won / (total_challenges + 1)) × 100
)

Bayesian prior: Start at 50 with 1 virtual win, 1 virtual loss
```

### Challenge Resolution

**Outcome Payouts:**

```
If challenger wins (quality_score < 50 after review):
  challenger_receives = stake + 50 VOTER + (creator_penalty × 0.5)
  creator_loses = stake × 2
  protocol_receives = creator_penalty × 0.5

If challenger loses (quality_score ≥ 50):
  challenger_loses = stake
  protocol_receives = stake × 0.1
  burned = stake × 0.9
  creator_receives = reputation_boost (trust_score += 5)
```

**Time Limits:**

- Challenge window: 7 days from template publication
- Vote period: 3 days from challenge submission
- Appeal window: 24 hours from resolution

---

## Network Effects

### District Coverage Multiplier

**Formula:**

```
district_multiplier = 1.0 + log10(districts_reached + 1) × 0.5

Examples:
  1 district:    1.0x (no multiplier)
  10 districts:  1.5x
  100 districts: 2.0x
  435 districts: 2.31x (maximum)
```

**Application:**

```
final_reward = base_reward × district_multiplier × other_multipliers
```

### Template Virality Bonus

**Formula:**

```
virality_bonus = min(5.0, 1.0 + log10(sends + 1) × 0.8)

Examples:
  10 sends:     1.8x
  100 sends:    2.6x
  1,000 sends:  3.4x
  10,000 sends: 4.2x
  100,000+:     5.0x (cap)
```

**Network Effect on Creator:**

```
creator_reward = base_template_reward × (
  1.0 + (total_sends / 1000) × 0.1
)

Creator earns 10% bonus per 1,000 uses (uncapped)
```

### Cascading Reputation

**Formula:**

```
If User B uses template created by User A:
  A_reputation_bonus = (B_trust_score / 100) × 0.5

Aggregate bonus for template creator:
  total_cascade = sum(all user trust scores / 100) × 0.5 / num_uses
```

**Impact on Trust Score:**

- Creator's trust score increases with high-reputation users adopting template
- Encourages quality content that appeals to established users
- Dampens spam from low-reputation accounts

---

## Implementation Notes

### Oracle Integration

**Price Oracles:**

- Chainlink USD/VOTER price feed
- 15-minute TWAP to prevent manipulation
- Fallback: Uniswap V3 TWAP if Chainlink unavailable

**Data Oracles:**

- Census Bureau API for district verification
- Congress.gov for representative validation
- Self.xyz / Didit.me for identity verification

### Gas Optimization

**Batching:**

```
Reward claims batched weekly to reduce gas costs
User pays gas, receives:
  - All pending rewards
  - All vested tokens
  - Updated reputation score (merkle proof)
```

**Storage:**

- Reputation scores: Off-chain (NEAR CipherVault) + on-chain merkle root
- Reward calculations: Off-chain computation, on-chain verification
- Token transfers: Standard ERC-20 on Scroll zkEVM

### Security Considerations

**Sybil Resistance:**

- Identity verification required (self.xyz or Didit.me)
- Trust score heavily weighted toward verified accounts
- Multi-account detection via address clustering

**Oracle Manipulation:**

- TWAP prevents flash-loan attacks on price
- Multiple data sources with consensus requirements
- Circuit breakers on extreme price movements (±50% daily)

---

## Future Extensions

### Quadratic Funding

**Planned Formula:**

```
project_funding = base_allocation × sqrt(num_unique_contributors)
```

Encourages broad community support over whale dominance.

### Conviction Voting

**Planned Formula:**

```
voting_power = stake × sqrt(time_locked)
```

Longer commitments = stronger governance influence.

### Reputation Decay Acceleration

**Planned Adjustment:**

```
If inactive > 90 days:
  daily_decay = 0.5% (accelerated from 0.15%)
```

Prevents abandoned high-reputation accounts from skewing metrics.

---

## References

**Cryptoeconomic Models:**
- Buterin, V. "A Guide to 99% Fault Tolerant Consensus" (2018)
- RadicalxChange "Quadratic Funding" (2019)
- Token Engineering Commons "Conviction Voting" (2021)

**Reputation Systems:**
- ERC-8004: Non-Transferable NFT Reputation Standard
- Gitcoin Passport Trust Bonus calculations
- Kleros Escrow dispute resolution

**Implementation:**
- See `contracts/` for Solidity implementations
- See `sdk/` for JavaScript/TypeScript integration
- See `INTEGRATION-SPEC.md` for API details

---

*VOTER Protocol | Cryptoeconomic Specification | 2025*
