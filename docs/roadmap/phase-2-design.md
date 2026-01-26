# Phase 2 Design: Token Economics & Markets

> **⚠️ PLANNED FEATURES - NOT YET IMPLEMENTED**
>
> This document describes features planned for Phase 2 of VOTER Protocol (12-18 months post-launch). These features are NOT part of the current Phase 1 implementation. Phase 1 focuses on reputation-based civic engagement without token economics.
>
> **Phase 1 (Current)**: Browser-native ZK proofs, reputation system, congressional delivery, impact tracking
>
> **Phase 2 (This Document)**: VOTER token, challenge markets, outcome markets, token-based incentives

---

## Overview

Phase 2 introduces token economics to VOTER Protocol after Phase 1 has proven civic utility at scale. The token layer adds economic incentives for quality contributions, dispute resolution mechanisms, and retroactive funding for legislative impact.

### Timeline

**Launch Window**: 12-18 months after Phase 1 launch

**Prerequisites**:
- Phase 1 reputation system proven at scale (10,000+ verified users)
- Congressional office adoption confirms value of quality signals
- Legal compliance framework established (CLARITY Act compliance)
- Economic security audits completed

### Core Components

1. **VOTER Token** - ERC-20 utility and governance token
2. **Challenge Markets** - Multi-AI consensus for information quality disputes
3. **Outcome Markets** - Prediction markets on legislative outcomes with retroactive funding
4. **Multi-Agent Treasury** - SupplyAgent and MarketAgent for token economics management
5. **Enhanced Privacy** - Privacy pools with association proofs (optional)

---

## VOTER Token Economics

### Token Utility

**Primary Functions**:
- Stake in challenge markets (dispute resolution)
- Governance rights (protocol parameter changes)
- Retroactive funding allocation
- Access to premium features (priority message delivery, advanced analytics)

**NOT a Security**:
- Utility token under CLARITY Act framework
- No expectation of profit from others' efforts
- Burns through usage, not investment vehicle

### Emission Schedule

**Phase 2 Launch**:
- Initial supply: 100M VOTER
- Allocated:
  - 40% Community rewards (vested over 4 years)
  - 25% Treasury (multi-agent controlled)
  - 20% Team (4-year vest, 1-year cliff)
  - 10% Advisors/Partners
  - 5% Liquidity bootstrapping

**Ongoing Emissions** (SupplyAgent controlled):
- Base rate: 1,000-100,000 VOTER/day
- Adjusted based on participation metrics
- Max daily change: ±5%
- Emergency circuit breaker: 48-hour pause on >50% price drop

### Token Distribution Mechanisms

**Reputation Conversion** (one-time at launch):
- Phase 1 reputation holders receive VOTER token allocation
- Formula: `tokens = sqrt(reputation_score) * 100`
- Prevents plutocracy (quadratic scaling)
- Rewards early adopters who built reputation

**Ongoing Rewards**:
- Template creation: 10-500 VOTER (based on quality score)
- Message sending: 1-10 VOTER (verified delivery)
- Challenge market wins: Stake * 2 (winner takes all)
- Outcome market participation: 20% of prize pool to contributors

---

## Challenge Markets: Multi-AI Information Quality Infrastructure

### Purpose

Economic stakes + multi-model AI consensus enforce information quality. Users can challenge verifiable claims in templates with VOTER token stakes. Twenty AI models across diverse providers evaluate disputed claims, requiring 67% agreement for resolution.

### Architecture

**Submission Flow**:
1. User stakes 100-5,000 VOTER tokens on challenge
2. Challenge includes IPFS evidence hash
3. Quadratic influence calculated: `sqrt(stake_amount)`
4. Reputation multiplier applied (domain expertise)

**AI Consensus Execution**:
1. Chainlink Functions DON executes off-chain computation
2. Queries 20 AI models via OpenRouter unified API:
   - **Tier 1 (33%)**: OpenAI GPT-5, Anthropic Claude Sonnet 4.5, xAI Grok 4
   - **Tier 2 (34%)**: Google Gemini 2.5, Alibaba Qwen 2.5, DeepSeek V3
   - **Tier 3 (33%)**: Meta Llama 3.3, Mistral Large 2, open models
3. Each model returns: `{ verdict: "VALID"|"INVALID", confidence: 0-100, reasoning: "..." }`
4. Results aggregate on-chain (no API keys exposed)

**Resolution Path** (based on consensus strength):
- **>80% consensus**: Auto-resolve (winner gets 2x stake)
- **60-80% consensus**: Escalate to UMA Optimistic Oracle
- **<60% consensus**: Human arbitration (community governance)

### Smart Contract Architecture

**VoterChallengeMarket.sol**:
```solidity
struct Challenge {
    bytes32 challengeId;
    address challenger;
    bytes32 targetHash;         // Template being challenged
    bytes32 domain;             // healthcare, climate, etc.
    string evidence;            // IPFS CID
    uint256 stakeAmount;        // VOTER tokens
    uint256 quadraticInfluence; // sqrt(stakeAmount) * reputation
    ChallengeStatus status;
    AIConsensus consensus;
}

struct AIConsensus {
    uint8 validVotes;           // Models voting VALID
    uint8 invalidVotes;         // Models voting INVALID
    uint8 totalVotes;           // Should be 20
    uint256 avgConfidence;      // 0-100 scale
    bool resolved;
}
```

**Key Functions**:
- `createChallenge(targetHash, domain, evidence, stake)` - Submit challenge with stake
- `submitToAIConsensus(challengeId)` - Trigger Chainlink Functions execution
- `fulfillRequest(requestId, response)` - Receive AI consensus results
- `_resolveChallenge(challengeId, outcome)` - Distribute stakes based on outcome

### Gaming Resistance

**Quadratic Scaling**:
- 100 people × $10 > 1 person × $1,000
- Prevents wealth from dominating truth

**Reputation Multipliers**:
- Domain expertise amplifies influence
- Healthcare professional challenging healthcare claim: 2x
- Climate scientist challenging climate data: 3x
- Prevents ignorant brigading

**Model Diversity**:
- 20 models across 3 tiers prevents provider capture
- Geographic diversity (Western + Chinese + open source)
- 33% open source prevents proprietary lock-in

**Staked Reputation**:
- Losing challenge burns reputation in that domain
- Serial bad-faith challengers lose credibility via ERC-8004 attestations

### Cost Analysis

**Per Challenge**:
- Chainlink Functions execution: ~$5 (20 model queries)
- On-chain aggregation: ~$0.15 (Scroll L2 gas)
- UMA dispute bond (if escalated): $1,500 (returned if correct)
- **Total**: $5.15 auto-resolve, $1,505.15 if disputed

**Example Scenario**:
- 1,000 VOTER stake ($5,000 at $5/token)
- 67% consensus (13 VALID, 7 INVALID)
- Auto-resolved in 10 minutes
- Winner receives 2,000 VOTER ($10,000)

---

## Outcome Markets: Political Prediction → Retroactive Funding

### Purpose

Binary prediction markets on legislative outcomes fund civic infrastructure retroactively. Market liquidity creates economic stakes; resolved outcomes trigger retroactive funding to contributors (template creators, message senders, organizers).

### Architecture

**Market Creation Flow**:
1. Advocacy organization creates market: "Will H.R. 3337 pass House committee with Section 4(b) intact?"
2. Gnosis Conditional Token Framework deploys binary ERC1155 tokens (YES/NO)
3. Users stake on outcomes, creating liquidity pool
4. Market resolves via Congress.gov API + UMA Optimistic Oracle
5. Winners collect prize pool; 20% goes to retroactive funding

**Technical Stack**:
- **Conditional Tokens**: Gnosis CTF (proven at $3.2B daily volume on Polymarket)
- **Outcome Resolution**: UMA Optimistic Oracle MOOV2
- **Custom Attribution**: ImpactAgent scoring for retroactive distribution

### Retroactive Funding Mechanics

**Pool Allocation** (20% of total stakes):

Example: $100K market ($60K YES, $40K NO)
- Retroactive pool: $20K (20% of total)
- Prize pool: $80K (distributed to winners)

**When YES wins**:
- YES holders collect from $80K prize pool
- NO stakes contribute: $8K to retroactive, $32K to winners
- YES stakes contribute: $12K to retroactive, $48K returned

**Why Losing Stakes Fund Infrastructure**:
Even failed predictions fund civic infrastructure that attempted to influence outcomes. Creates incentive alignment: ecosystem generates future opportunities regardless of individual bet outcomes.

### Attribution Logic (ImpactAgent)

**Contribution Scoring**:

```javascript
// Calculate contributor weights for retroactive funding
async function calculateContributionWeights(marketId) {
  const contributions = [];

  for (const template of market.relatedTemplates) {
    // Template creator base weight
    const creatorWeight = {
      address: template.creator,
      weight: 1000,  // 10% base
      reason: "Template creation"
    };

    // Amplify based on adoption
    const adoptionCount = await getAdoptionCount(template.hash);
    creatorWeight.weight += adoptionCount * 10;  // +0.1% per adoption

    // Amplify based on verified impact
    const impactScore = await ImpactAgent.getTemplateImpact(template.hash);
    if (impactScore > 80) {
      creatorWeight.weight *= 10;  // 10x multiplier for high-confidence impact
    }

    contributions.push(creatorWeight);

    // Adopters (users who sent the template)
    const adopters = await getTemplateAdopters(template.hash);
    for (const adopter of adopters) {
      contributions.push({
        address: adopter,
        weight: 10,  // 0.1% per message sent
        reason: "Template adoption"
      });
    }
  }

  // Normalize to 100%
  return normalizeWeights(contributions);
}
```

**10x Multiplier Trigger**:
- ImpactAgent verifies template → legislative outcome correlation
- >80% confidence score required
- Based on: timing, topic similarity, language overlap, constituent volume

### Gaming Resistance

**Sybil Protection**:
- Contributors must have verified identities (Didit.me KYC)
- Reputation staking required for high-value claims
- Rate limiting: max 3 templates/day

**Self-Attribution Prevention**:
- Template adoption verified via on-chain Congressional delivery receipts
- Can't claim credit for messages never sent
- ImpactAgent cross-references with CWC submission logs

**Collusion Resistance**:
- Quadratic scaling (100 × $10 > 1 × $1000)
- Reputation forfeiture for false claims
- Multi-agent consensus prevents single-agent manipulation

### Cost Analysis

**Per Market**:
- Gnosis CTF deployment: ~$5 (one-time)
- UMA resolution request: ~$10 (includes dispute bond)
- Retroactive distribution: ~$0.05 per contributor

**Example**: $500K outcome market, 200 contributors
- Trading fees: $2,500 (0.5% fee)
- Retroactive pool: $100K (20% of stakes)
- Average contributor: $500 reward (if outcome favorable)

---

## Multi-Agent Treasury Management

Phase 2 introduces two additional agents to manage token economics and market stability.

### SupplyAgent (30% consensus weight)

**Purpose**: Manage token emissions to prevent death spirals

**Input Sources**:
- On-chain participation metrics (messages sent, templates adopted, challenges won)
- Token price from multi-oracle consensus
- Treasury balance and runway calculations
- Historical emission rates and effects

**Bounded Constraints** (enforced in smart contract):
- Min emission: 1,000 VOTER/day
- Max emission: 100,000 VOTER/day
- Max daily change: ±5%
- Emergency circuit breaker: 48-hour pause on >50% price drop

**Decision Output**:
```typescript
interface SupplyDecision {
  new_emission_rate: number;  // tokens per action
  reasoning: {
    participation_delta: number;
    price_stability: number;
    treasury_health: number;
  };
  proof: ZKProof;  // Groth16 SNARK of computation
  timestamp: number;
}
```

**LangGraph Workflow**:
```python
from langgraph.graph import StateGraph

class SupplyState(TypedDict):
    participation_rate: float
    token_price_usd: float
    treasury_balance: float
    current_emission_rate: float

supply_graph = StateGraph(SupplyState)

# Deterministic nodes
supply_graph.add_node("fetch_metrics", fetch_on_chain_metrics)
supply_graph.add_node("fetch_price", aggregate_oracle_prices)
supply_graph.add_node("calculate_adjustment", bounded_emission_calculation)
supply_graph.add_node("generate_proof", create_zk_proof_of_computation)

# Edges define control flow
supply_graph.add_edge("fetch_metrics", "fetch_price")
supply_graph.add_edge("fetch_price", "calculate_adjustment")
supply_graph.add_edge("calculate_adjustment", "generate_proof")
```

### MarketAgent (30% consensus weight)

**Purpose**: Circuit breakers and volatility response

**Input Sources**:
- Token price (multi-oracle consensus)
- Trading volume across DEXs
- Volatility metrics (Bollinger Bands, ATR)
- Crypto market conditions (BTC/ETH correlation)

**Circuit Breaker Triggers**:
- >50% price movement in 1 hour → Halt all operations for 24 hours
- >25% price movement in 1 hour → Reduce emission rates by 50%
- <$10K daily volume → Flag low liquidity warning
- Oracle divergence >10% → Halt until consensus restored

**LangGraph Pattern**: Orchestrator-Worker
- Orchestrator monitors multiple DEXs in parallel
- Workers query each DEX's subgraph
- Aggregate results with median calculation
- LLM ensemble validates for manipulation patterns

---

## Smart Contract Architecture

### Core Contracts

**Phase 2 Additions**:

1. **VOTERToken.sol** - ERC-20 token for economic incentives
   - Standard ERC-20 with governance extensions
   - Burnable (usage reduces supply)
   - Multi-agent mint authority (SupplyAgent controlled)

2. **ChallengeMarket.sol** - Multi-AI dispute resolution with stakes
   - Chainlink Functions integration
   - Quadratic staking mechanics
   - Reputation weighting system

3. **OutcomeMarket.sol** - Gnosis CTF integration for legislative predictions
   - Binary outcome markets
   - UMA Optimistic Oracle resolution
   - Retroactive funding distribution

4. **SupplyAgent.sol** - Token emission management
   - Bounded optimization constraints
   - Multi-oracle price feeds
   - ZK proof verification

5. **MarketAgent.sol** - Circuit breakers and volatility response
   - Emergency pause mechanisms
   - Volatility monitoring
   - Cross-DEX aggregation

### Integration Points

**Phase 2 External Integrations**:
1. **Chainlink Functions DON** - Multi-model AI consensus execution
2. **OpenRouter API** - 500+ models, 60+ providers
3. **Gnosis CTF** - Conditional token framework for outcome markets
4. **UMA Optimistic Oracle** - Dispute resolution for market outcomes
5. **Multi-Oracle Price Feeds** - Chainlink, UMA, Pyth Network
6. **Filecoin** - Permanent audit trail for challenged templates (optional)

---

## Implementation Roadmap

### Month 5: Treasury & Funding Infrastructure (Phase 2 Only)

- [ ] **Outcome Markets**: Gnosis CTF integration (binary ERC1155 tokens)
- [ ] **Outcome Markets**: VoterOutcomeMarket.sol deployment
- [ ] **Outcome Markets**: UMA Optimistic Oracle integration (MOOV2)
- [ ] **Outcome Markets**: Hybrid CLOB implementation
- [ ] **Outcome Markets**: 20% retroactive funding pool mechanism
- [ ] **Retroactive Funding**: RetroFundingDistributor.sol deployment
- [ ] **Retroactive Funding**: Gitcoin Allo Protocol adaptation
- [ ] **Retroactive Funding**: Gnosis Safe 3-of-5 multi-sig setup
- [ ] **Retroactive Funding**: Quadratic allocation algorithm
- [ ] **Retroactive Funding**: 7-day appeal period mechanism
- [ ] Protocol treasury management contracts
- [ ] VOTER token staking and governance contracts

### Month 6: Information Quality Markets

- [ ] **Challenge Markets**: Chainlink Functions DON integration
- [ ] **Challenge Markets**: OpenRouter multi-model consensus
- [ ] **Challenge Markets**: VoterChallengeMarket.sol deployment
- [ ] **Challenge Markets**: 20 AI model integration
- [ ] **Challenge Markets**: Quadratic staking + reputation weighting
- [ ] **Challenge Markets UI**: Submit/review challenges with stake calculator
- [ ] **Outcome Markets UI**: Create/trade on political prediction markets
- [ ] **Retroactive Funding UI**: Contribution tracking and allocation transparency

### Month 7: Advanced Features

- [ ] **Template Impact Correlation**: ChromaDB vector database for semantic search
- [ ] **Template Impact Correlation**: GPT-5 causality analysis pipeline
- [ ] **Outcome Markets**: Advanced market-making algorithms
- [ ] **Supply Management**: SupplyAgent.sol deployment
- [ ] **Market Stability**: MarketAgent.sol deployment
- [ ] Filecoin integration for permanent archival

### Month 8: Security & Audit (Phase 2)

- [ ] Smart contract audit (VOTERToken.sol)
- [ ] Smart contract audit (VoterChallengeMarket.sol)
- [ ] Smart contract audit (VoterOutcomeMarket.sol, RetroFundingDistributor.sol)
- [ ] Chainlink Functions security review
- [ ] UMA integration audit
- [ ] Economic security modeling (challenge markets, outcome markets gaming resistance)
- [ ] Token emission simulation (prevent death spirals)
- [ ] Market manipulation resistance testing

---

## Cost Analysis

### Infrastructure Costs (Annual, 100K Users)

**Per Information Quality Operation**:
- **Challenge Market** (20 AI models via OpenRouter): $5
- **Challenge Market** (on-chain aggregation): $0.15
- **Template Impact Tracking** (30-day monitoring): $2.25 (GPT-5 + ChromaDB)
- **Outcome Market** (creation): $0.20 (Gnosis CTF + UMA)
- **Retroactive Funding** (quarterly round): $71 (GPT-5 allocation + distribution)

**Annual Infrastructure**:
- Chainlink Functions DON: $2,000/year
- OpenRouter 20-model consensus: $5,000/year
- UMA dispute bonds (locked): $50,000
- ChromaDB vector database: $1,200/year
- **Total Phase 2 Infrastructure**: ~$58,200/year

### Development Costs

**Phase 2 Development** (12-18 months):
- Chainlink Functions integration: $30K
- UMA/Gnosis integration: $40K
- Economic security modeling: $25K
- Additional security audits: $80K (markets + token contracts)
- **Total Phase 2 Development**: ~$175K

**Combined Phase 1 + Phase 2**: ~$475K total development cost

---

## Regulatory Considerations

### Token Classification

**CLARITY Act Framework**:
- Utility token (not security)
- Decentralized governance (no central control after launch)
- Burns through usage (not investment vehicle)
- No expectation of profit from others' efforts

### Prediction Markets Compliance

**CFTC Approval Required**:
- Event contracts on legislative outcomes
- Must demonstrate social value (civic engagement)
- Position limits to prevent manipulation
- Reporting requirements for large positions

**Prohibited Markets**:
- No election outcome markets (CFTC restrictions)
- No assassination markets (illegal)
- Legislative outcomes only (policy, not candidates)

### KYC/AML Requirements

**Identity Verification**:
- Phase 2 requires Didit.me KYC for token holders
- Prevents Sybil attacks in economic systems
- Complies with FATF Travel Rule
- Optional for Phase 1 reputation-only users

---

## Success Metrics

### Launch Criteria (Phase 1 → Phase 2 Transition)

**Required Before Token Launch**:
- 10,000+ verified users with reputation scores
- 100+ templates with >80% impact confidence scores
- Congressional office adoption (50+ offices using dashboard)
- Legal opinion on token classification (utility, not security)
- Economic security audit completed
- Multi-agent consensus system validated (10,000+ decisions)

### Phase 2 KPIs

**Token Metrics**:
- Daily active token holders: >1,000
- Challenge market volume: >$100K/month
- Outcome market total value locked: >$500K
- Average holder diversity (Gini coefficient): <0.5
- Token price stability (30-day volatility): <25%

**Quality Metrics**:
- Challenge market accuracy: >90% (AI consensus vs ground truth)
- Retroactive funding attribution accuracy: >85%
- False positive rate: <1%
- Appeal success rate: <10% (indicates good first-pass decisions)

**Impact Metrics**:
- Templates with verified legislative correlation: >50
- Total retroactive funding distributed: >$1M
- Congressional offices actively trading outcome markets: >10
- Policy changes attributed to platform: >5

---

## Risk Mitigation

### Economic Risks

**Death Spiral Prevention**:
- SupplyAgent bounded optimization (±5% max daily change)
- Emergency circuit breakers (48-hour pause on >50% drop)
- Multi-oracle price feeds (prevent manipulation)
- Treasury runway monitoring (12-month minimum)

**Market Manipulation**:
- Quadratic scaling (prevents whale dominance)
- Reputation weighting (domain expertise required)
- Multi-agent consensus (no single point of failure)
- Position limits on outcome markets

### Technical Risks

**Oracle Failures**:
- Multi-oracle consensus (Chainlink + UMA + Pyth)
- Fallback to UMA Optimistic Oracle if Chainlink fails
- Human arbitration if both fail
- 48-hour pause if oracle divergence >10%

**Smart Contract Risks**:
- Formal verification for critical contracts
- Time-locked upgrades (7-day delay)
- Multi-sig treasury (3-of-5 gnosis safe)
- Emergency pause mechanisms

### Legal Risks

**Regulatory Uncertainty**:
- CLARITY Act framework (utility token classification)
- Legal opinion from Cooley LLP or equivalent
- CFTC engagement for prediction markets
- Compliance monitoring (ongoing)

**Section 230 Compliance**:
- Challenge markets = user-driven fact-checking (not editorial)
- Economic stakes create distributed moderation
- Platform doesn't make truth determinations (AI consensus + UMA does)

---

## Why Phase 2 Comes After Phase 1

### Technical Prerequisites

**Phase 1 Builds Foundation**:
- Reputation system proves quality signal accuracy
- Multi-agent consensus validated through 10,000+ decisions
- Template impact correlation establishes attribution baseline
- Congressional delivery infrastructure confirms civic utility

**Phase 2 Adds Economics**:
- Token launches require proven user base (10,000+ verified)
- Challenge markets need AI consensus track record
- Outcome markets depend on impact correlation accuracy
- Retroactive funding requires attribution confidence

### Legal Prerequisites

**Phase 1 Avoids Financial Regulation**:
- Reputation-only system (no securities)
- No prediction markets (no CFTC jurisdiction)
- No token sales (no SEC jurisdiction)
- Platform moderation (Section 230 applies)

**Phase 2 Requires Regulatory Clarity**:
- CLARITY Act utility token framework
- CFTC approval for legislative outcome markets
- KYC/AML compliance for token holders
- Challenge markets = user-driven fact-checking (Section 230 safe harbor)

### Economic Prerequisites

**Phase 1 Proves Product-Market Fit**:
- Congressional offices adopt quality signals
- Template creators earn reputation (intrinsic motivation)
- Users verify addresses for civic participation (not financial gain)
- Impact correlation demonstrates legislative influence

**Phase 2 Monetizes Proven Value**:
- Retroactive funding rewards proven impact (attribution validated)
- Challenge markets incentivize quality (consensus accuracy proven)
- Token rewards amplify participation (engagement baseline established)
- Outcome markets fund infrastructure (civic utility demonstrated)

---

## References

### Technical Documentation

1. Gnosis Conditional Token Framework. https://github.com/gnosis/conditional-tokens-contracts
2. UMA Optimistic Oracle. https://docs.uma.xyz/protocol-overview/how-does-umas-oracle-work
3. Chainlink Functions. https://docs.chain.link/chainlink-functions
4. OpenRouter Multi-Provider AI. https://openrouter.ai/docs
5. Polymarket CTF Architecture. https://docs.polymarket.com/developers/CTF/overview

### Economic Research

6. Gitcoin Quadratic Funding. https://www.gitcoin.co/blog/quadratic-funding-in-a-nutshell
7. Retroactive Public Goods Funding (Optimism). https://medium.com/ethereum-optimism/retroactive-public-goods-funding-33c9b7d00f0c
8. Vitalik Buterin: Privacy Pools. https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4563364

### Regulatory Framework

9. CLARITY Act (Crypto Asset Regulatory Framework). Pending legislation
10. CFTC Event Contracts Guidance. https://www.cftc.gov/PressRoom/PressReleases/8620-23
11. SEC Howey Test Analysis. https://www.sec.gov/corpfin/framework-investment-contract-analysis-digital-assets

---

## Appendix: Migration Path from Phase 1

### Reputation → Token Conversion

**One-Time Airdrop at Phase 2 Launch**:
- Formula: `VOTER_tokens = sqrt(reputation_score) * 100`
- Example: 10,000 reputation → 10,000 VOTER tokens
- Quadratic scaling rewards early participation without plutocracy

**Ongoing Dual System**:
- Reputation continues to accrue (ERC-8004 attestations)
- Token rewards overlay on reputation (not replacement)
- High reputation users receive token multipliers
- Reputation gates certain features (verified-only markets)

### User Experience Changes

**Phase 1 (Current)**:
- Prove district membership → earn reputation
- Send template → earn reputation
- Template adopted → 10x reputation multiplier
- Congressional offices see reputation scores

**Phase 2 (Future)**:
- All Phase 1 functionality remains
- **New**: Stake tokens in challenge markets
- **New**: Trade on legislative outcome markets
- **New**: Receive retroactive funding for verified impact
- **New**: Governance voting rights on protocol parameters

### Contract Upgrades

**Phase 1 Contracts (Immutable)**:
- CommuniqueCoreV2.sol (message registry)
- DistrictGate.sol (ZK proof verification)
- DistrictRegistry.sol (district membership)
- ReputationRegistry.sol (ERC-8004 attestations)

**Phase 2 Contracts (New Deployments)**:
- VOTERToken.sol (ERC-20 token)
- ChallengeMarket.sol (dispute resolution)
- OutcomeMarket.sol (prediction markets)
- SupplyAgent.sol (emission management)
- MarketAgent.sol (volatility control)

**Integration Layer**:
- ReputationRegistry integrates with token contracts
- Reputation scores weight challenge market influence
- Impact tracking feeds retroactive funding attribution
- No breaking changes to Phase 1 user experience

---

**Document Version**: 1.0
**Last Updated**: January 2026
**Status**: Design Specification (Not Implemented)
