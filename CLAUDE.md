# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The VOTER Protocol is democracy infrastructure that competes in the attention economy. While memecoins hit $72B market caps overnight, civic engagement reads like homework. We fix this with verifiable political participation that pays.

**Core Philosophy**: ERC-8004 was built for AI agents. We extend it to human civic participants, creating infrastructure both humans and AI can use for authentic democratic coordination.

**The Strategic Bet**: We're not building for AI agents to coordinate with each other. We're building AI-verified infrastructure for human civic participation. The AI is the verification layer, the human is the participant. This positions VOTER as the foundational civic protocol where on-chain agency meets democratic authenticity.

### Core Innovation: VOTER Protocol Smart Contracts
The VOTER Protocol provides blockchain infrastructure for democratic participation:
- **VOTER Records**: Non-transferable proof of civic actions (ERC-721)
- **VOTER Tokens**: Governance and utility tokens with staking (ERC-20)
- **Smart Contracts**: On-chain registries, reputation systems, and challenge markets
- **Multi-sig Security**: Protected governance and treasury management

## Technology Stack

### Blockchain Infrastructure
- **Primary Network**: Ronin for proven high-performance civic engagement (100K TPS, 2.27M daily users)
- **Alternative Consideration**: Monad testnet for early deployment, pending mainnet (late 2025)
- **Optional L2 Mirror**: ERC‑8004 registries on major Ethereum L2 for ETH-native consumption
- **Development**: Foundry for smart contract development and testing
- **Deployment**: Multi-sig governance for production deployments

**Performance Reality**: Ronin delivers 100K TPS vs Monad's 10K TPS, with battle-tested infrastructure supporting millions of daily users. When civic participation needs to compete with social media engagement rates, performance isn't theoretical—it's existential.

### Core Smart Contracts
- **VOTERRegistry.sol** - Identity and action verification registry
- **VOTERToken.sol** - ERC-20 governance token with staking
- **CommuniqueCore.sol** - Central coordination contract
- **ValidationRegistry.sol** - Action validation and attestation
- **CivicActionRegistry.sol** - Non-transferable proof of participation
- **ActionVerifierMultiSig.sol** - Multi-signature verification
- **TreasuryManager.sol** - Protocol treasury management
- **ChallengeMarket.sol** - Challenge and dispute resolution
- **ReputationRegistry.sol** - ERC-8004 compliant reputation system
- **TemplateRegistry.sol** - Template storage and verification
- **IdentityRegistry.sol** - Zero-knowledge identity verification

## Key Development Concepts

### Compliance Posture
- **CLARITY Act Digital Commodity**: VOTER tokens qualify as digital commodities under federal framework - value derives from network utility, not expectation of profit from management efforts
- **Bright-line rules**: We never reward voting, registering to vote, or choosing candidates. We reward the verifiable work of contacting representatives.
- **Utility-first design**: VOTER tokens serve governance and platform utility, not vote buying
- **Privacy-preserving**: Zero PII on-chain; off-chain KYC/attestations only where legally required
- **Democratic authenticity**: Clear separation between verified participation records and economic incentives

In a world where the President's memecoin cleared $40B on inauguration day, compensating civic labor makes us competitive while cautious competitors wait for permission that already arrived. The CLARITY Act provides the regulatory framework we need.

### Dynamic Parameter System
**Smart contract safety rails with adaptive governance.**

VOTER Protocol implements dynamic parameter management through smart contracts:
- **Bounded Parameter Updates**: Min/max bounds prevent manipulation
- **Daily Adjustment Caps**: Limit rapid parameter changes  
- **Multi-sig Approval**: Critical changes require multi-signature approval
- **Transparent Governance**: All parameter changes are auditable on-chain

**Quality discourse pays. Bad faith costs.**

### Challenge Markets: Information Quality Infrastructure

Challenge markets create economic incentives for information accuracy:

- **Challenge markets**: Stake VOTER tokens to dispute questionable claims
- **Reputation staking**: Build skin in the game for information quality
- **Quadratic scaling**: Prevent plutocracy through diminishing returns
- **Portable reputation**: ERC-8004 credibility follows you across platforms

**Quality discourse pays. Bad faith costs.**

### Multi-Agent Architecture: Competitive Advantage Through Appropriate Complexity

**Why Sophisticated Agents Are Necessary (Not Overengineering):**
- **Market Volatility Defense**: Multi-oracle consensus prevents single point of failure during 100x price movements
- **Sybil Attack Resistance**: Differentiation between earned vs purchased tokens defeats economic attacks
- **Quality Over Volume**: ImpactAgent rewards legislative outcomes, not spam actions
- **4-Year Treasury Survival**: SupplyAgent manages emission curves through full market cycles
- **Regulatory Compliance**: Bounded parameters with agent consensus satisfy CLARITY Act requirements

**Production-Ready Agent System:**
- **SupplyAgent**: Manages token emissions with supply curves, participation metrics, daily caps, preventing death spirals
- **MarketAgent**: Analyzes crypto market conditions, implements circuit breakers during extreme volatility
- **ImpactAgent**: Tracks legislative outcomes, district-specific metrics, response prediction algorithms
- **ReputationAgent**: Multi-dimensional scoring (challenge/civic/discourse), badge system, ERC-8004 attestations
- **VerificationAgent**: Policy violation detection, severity scoring, consensus review thresholds

**Agent Consensus Mechanisms:**
- **Weighted Decision Making**: SupplyAgent (30%), MarketAgent (30%), ImpactAgent (20%), ReputationAgent (20%)
- **Circuit Breakers**: MarketAgent can halt operations during extreme events (>50% price movement/hour)
- **Multi-Oracle Aggregation**: Chainlink + RedStone + backup feeds prevent oracle manipulation
- **Bounded Authority**: No single agent can exceed AgentParameters min/max constraints

**Smart Contract Integration:**
- **AgentParameters.sol**: Secure control panel with enforced bounds for all agent decisions
- **CommuniqueCore.sol**: Orchestrates agent consensus for reward calculations
- **ChallengeMarket.sol**: Contextual stake calculations using expertise scores and track records
- **ReputationRegistry.sol**: Multi-dimensional identity with time decay and portable credibility

**Competitive Moat Through Complexity:**
- **Economic Moat**: Demonstrably harder to exploit than simple "10 points per action" systems
- **Narrative Moat**: "Multi-agent consensus" attracts serious participants vs airdrop farmers
- **Engagement Moat**: Sophisticated reputation creates compelling long-term participation game
- **Resilience Moat**: Survives market conditions that kill simpler protocols

**Implementation Philosophy**: Modular agents with bounded authority create emergent resilience. Each agent is auditable individually but powerful in consensus—appropriate complexity for production deployment in hostile crypto environment.

### Dynamic Parameter System
**Smart contract safety rails with adaptive governance.**

VOTER Protocol implements dynamic parameter management through smart contracts and intelligent agents:
- **Bounded Parameter Updates**: Min/max bounds prevent manipulation
- **Daily Adjustment Caps**: Limit rapid parameter changes  
- **Multi-sig Approval**: Critical changes require multi-signature approval
- **Transparent Governance**: All parameter changes are auditable on-chain

**Quality discourse pays. Bad faith costs.**

### Challenge Markets: Information Quality Infrastructure

Challenge markets create economic incentives for information accuracy through quadratic mechanisms that go far beyond preventing plutocracy:

**Democratic Legitimacy**:
- **Preference revelation**: Quadratic voting reveals true intensity of preferences, not just binary positions
- **Community consensus**: Aggregate genuine sentiment rather than gaming by concentrated wealth
- **Proportional influence**: Your stake reflects your conviction, but with diminishing returns preventing domination

**Network Effects**:
- **Quality convergence**: Participants with strongest convictions on accuracy get proportionally higher influence
- **Information aggregation**: Market mechanism surfacing collective intelligence about claim validity
- **Reputation compounding**: Accurate challengers build credibility that enhances future challenge power

**Economic Security**:
- **Skin in the game**: Reputation staking creates personal cost for bad faith participation
- **Challenge markets**: Stake VOTER tokens to dispute questionable claims with quadratic cost scaling
- **Portable reputation**: ERC-8004 credibility follows you across platforms

**Quality discourse pays. Bad faith costs.**

### Security and Safety

**Parameter Safety**: All dynamic parameters have min/max bounds and daily adjustment caps to prevent manipulation.

**Multi-signature Security**: Critical functions protected by multi-sig governance with emergency pause mechanisms.

**Economic Security**: Challenge markets prevent spam and gaming through reputation staking and quadratic scaling.

**Audit Requirements**: All contracts undergo professional security audits before deployment.

## Smart Contract Architecture

### On-chain Anchors (Monad)
- Registry (Monad): Stores IPFS CIDs (templates/channels/version graph)
- Attest (Monad): Attests hash receipts (CWC/mail routing); supports revocations
- Optional: ERC‑8004 mirror on L2 for on‑chain reads by ETH‑native consumers

### EVM Contracts
- `VOTERRegistry.sol`, `VOTERToken.sol`, `CommuniqueCore.sol`, `AgentParameters.sol`, `AgentConsensusGateway.sol`

### VOTERToken.sol
- ERC-20 with voting extensions (ERC20Votes, ERC20Permit)
- Staking mechanism with APR rewards
- Governance proposal creation and voting
- Agent-optimized reward distribution

### Cross-chain control
- Avoid routine bridging; treasuries and liquidity remain on ETH/L2 (Safe). Bridge only for explicit flows; no MPC dependency required.

## Development Notes

- **Smart Contracts**: Build and test with Foundry for all EVM contracts
- **Deployment**: Multi-sig governance for production deployments on Monad
- **Testing**: Comprehensive test suite covering security, economics, and governance
- **Integration**: External systems interface with VOTER Protocol smart contracts

## Critical Design Principles

### Separation of Democracy from Speculation
- VOTER records prove civic participation but cannot be traded
- VOTER tokens provide economic incentives without commodifying democracy
- Clear distinction prevents "buying political influence" narrative

### Engaging Participation Without Compromise
- Meaningful gamification mechanics that track real civic impact
- Economic incentives based on verified democratic participation
- Authentic democratic outcomes distinguish from pure speculation

### Institutional-Grade Security
- Multi-sig governance for critical functions
- Regular security audits planned
- Emergency pause mechanisms
- Compliance with regulatory frameworks

## Integration Points

### External System Integration
- **Smart Contract APIs**: Standard interfaces for external systems
- **ERC-8004 Compliance**: Portable reputation across platforms
- **Multi-sig Governance**: External integrations require governance approval
- **Event Emission**: Smart contracts emit events for external consumption

### Identity Verification: Didit.me On-Chain Integration

**Free Forever Core KYC**: ID verification, face match, passive liveness at zero cost
- **Premium scaling**: $0.35 AML screening, $0.50 proof of address for institutional compliance  
- **Developer sandbox**: Unlimited testnet verification without burning treasury
- **Global coverage**: ISO 27001 certified, GDPR compliant, 190+ countries supported

**On-Chain Architecture**:
- **Verifiable Credentials (VCs)**: Didit.me issues cryptographically signed attestations off-chain
- **Smart Contract Verification**: VOTER contracts verify VC signatures and extract claims on-chain
- **Zero-Knowledge Proofs**: Prove identity attributes (age thresholds, citizenship/residency) without revealing PII
- **Revocation Registry**: On-chain tracking of credential validity and revocation status

**Global Representation Mapping**: Address verification enables precise targeting by electoral district, constituency, or administrative region across 190+ countries while maintaining privacy through selective disclosure.

### Cross-Platform Compatibility
- ERC-8004 reputation registries for portable credibility
- Standardized action verification for external platforms
- Challenge market integration for information quality
- Treasury integration for institutional partnerships

## Market Context (2025)

### The Attention War Reality
**Democracy has a distribution problem.**

While TRUMP-linked memecoins touched $40B in 24 hours on Inauguration Day, a floor vote barely dents the feed. Citizens who've never called a representative learned automated market makers overnight. When TikTok optimizes for engagement and Robinhood gamifies markets, civic work reads like homework.

### Competitive Landscape
- **Memecoin market**: $140B+ proves attention + economic incentives = massive adoption  
- **Regulatory clarity**: CLARITY Act enables compliant civic tokenomics via digital commodity classification
- **Infrastructure ready**: Ronin (100K TPS, 2.27M daily users), Didit.me (free identity verification), ERC-8004 (AI-human coordination)

### VOTER's 2025 Advantages
- **Performance at scale**: Ronin's proven infrastructure handles millions of daily civic actions without gas wars
- **Zero-cost identity**: Free forever verification removes the largest barrier to authentic participation
- **First democracy protocol** that competes for attention in the memecoin economy while delivering authentic civic impact
- **AI-verified authenticity**: Trustless verification of human civic participation at social media speeds

**Infrastructure advantage**: We're building the rails everyone else needs, with the performance to deliver them.

## Documentation Structure

Comprehensive documentation is organized in the `docs/` folder:

### Architecture Documents (`docs/architecture/`)
- **[AGENTIC_SYSTEM_DESIGN.md](docs/architecture/AGENTIC_SYSTEM_DESIGN.md)** - Death to hardcoded tyranny: dynamically calibrated parameters
- **[OVERVIEW_HYBRID_ARCHITECTURE.md](docs/architecture/OVERVIEW_HYBRID_ARCHITECTURE.md)** - Cheap EVM anchoring on Monad with optional L2 mirrors
- **[TOKENOMICS_MODEL.md](docs/architecture/TOKENOMICS_MODEL.md)** - Dual token system: VOTER Records + VOTER Tokens

### Design Documents (`docs/design/`)
- **[CREDIBILITY_GOVERNANCE_DESIGN.md](docs/design/CREDIBILITY_GOVERNANCE_DESIGN.md)** - Intelligent agents within robust frameworks
- **[ENGAGEMENT_AND_GAMIFICATION_STRATEGY.md](docs/design/ENGAGEMENT_AND_GAMIFICATION_STRATEGY.md)** - Carroll Mechanisms and challenge markets

### Implementation (`docs/implementation/`)
- **[DEVELOPMENT_ROADMAP.md](docs/implementation/DEVELOPMENT_ROADMAP.md)** - Production readiness checklist and milestones

## Current Development Status

### Recently Completed
- **VOTER Protocol Integration**: Complete token system with Records (non-transferable civic proof) and Tokens (tradeable governance)
- **Rate Limiting Fix**: First-time users can now perform actions (fixed minActionInterval check)
- **OPERATOR_ROLE Removal**: Eliminated centralized minting vulnerability
- **Parameter Safety**: Implemented min/max bounds and daily caps in AgentParameters
- **Multi-sig Verification**: ActionVerifierMultiSig with threshold signatures

### Immediate Priorities
1. **CWC Integration**: Complete congressional message verification system with actual API calls
2. **Identity Verification**: Implement Self Protocol ZK proof verification
3. **Carroll Mechanisms**: Deploy challenge markets and reputation aggregation
4. **Frontend Development**: Production-ready web and mobile applications
5. **Agent Infrastructure**: Deploy LangGraph agents for parameter optimization

## Security Considerations

- Smart contracts must undergo professional security audits
- Multi-sig governance prevents single points of failure
- Rate limiting prevents spam and gaming
- Identity verification balances privacy with authenticity
- Emergency controls for crisis situations

The VOTER Protocol positions democracy to compete for attention while creating authentic political impact. We're building infrastructure both humans and AI can use.

**Making democracy engaging is essential for its evolution in the attention economy.**

*Quality discourse pays. Bad faith costs.*