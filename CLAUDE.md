# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The VOTER Protocol is democracy infrastructure that competes in the attention economy. While memecoins hit $72B market caps overnight, civic engagement reads like homework. We fix this with verifiable political participation that pays.

Communiqué integrates VOTER Protocol for adaptive civic engagement through multi-agent systems that optimize democratic participation. User experience stays simple: we always open the mail client. Backend adapters handle certified legislative interfaces. Verification receipts get hashed, pinned to IPFS, and attested on Monad with zero PII on-chain. Optional L2 mirrors use ERC-8004 registries for ETH-native consumption.

**Core Philosophy**: ERC-8004 was built for AI agents. We extend it to human civic participants, creating infrastructure both humans and AI can use for authentic democratic coordination.

### Core Innovation: VOTER Protocol within Communiqué
The VOTER Protocol powers Communiqué's adaptive governance infrastructure:
- **VOTER Records**: Non-transferable proof of civic actions, verified by agent consensus
- **VOTER Tokens**: Dynamically minted governance tokens with performance-calibrated reward calculations
- **Agent Network**: Specialized AI agents handle verification, economics, governance, and optimization

## Technology Stack

### Agent Infrastructure
- **Coordination**: LangGraph for multi-agent orchestration
- **Workflows**: Temporal for agent workflow management
- **Memory**: ChromaDB for vector-based agent learning
- **Automation**: N8N for civic action processing pipelines
- **AI Models**: LLMs for agent intelligence

### Blockchain Infrastructure
- **Anchoring (EVM)**: Monad as primary on‑chain anchor (registries/attestations)
- **Optional L2 Mirror**: ERC‑8004 Identity/Validation/Reputation registries on a major L2 when partners require on‑chain reads
- **Contracts**: `VOTERRegistry.sol`, `VOTERToken.sol`, `CommuniqueCore.sol`, `AgentParameters.sol`, `AgentConsensusGateway.sol`

### Agent-Driven Services
- **Diverse Agent Swarm**: Different models prevent groupthink
- **Consensus with Dissent**: Agents must justify disagreement
- **Observable Metrics**: Track actions, not intentions
- **Continuous Learning**: Every decision improves the system
- **Human Oversight**: Critical decisions escalate to humans

## Key Development Concepts

### Compliance Posture
- **Bright-line rules**: We never reward voting, registering to vote, or choosing candidates. We reward the verifiable work of contacting representatives.
- **Utility-first design**: VOTER tokens serve governance and platform utility, not vote buying
- **Privacy-preserving**: Zero PII on-chain; off-chain KYC/attestations only where legally required
- **Democratic authenticity**: Clear separation between verified participation records and economic incentives

In a world where the President's memecoin cleared $40B on inauguration day, compensating civic labor makes us competitive while cautious competitors wait for permission that already arrived.

### Agentic Development Approach
**Agent-optimized parameters replace hardcoded tyranny.**

The platform deploys intelligent agents that learn, adapt, and optimize within auditable safety rails:
- **Dynamic reward calculations** based on real civic impact measurement, not fixed "10 VOTER per message" rules  
- **Adaptive verification thresholds** that respond to spam patterns and network conditions
- **Emergent economic parameters** that optimize for authentic democratic participation vs speculative gaming
- **Self-modifying governance** that evolves with community needs while maintaining democratic authenticity

**Quality discourse pays. Bad faith costs.**

### Carroll Mechanisms: Information Quality Markets

Political discourse drowns in noise because bad information travels as fast as good. We fix this with markets for truth:

- **Challenge markets**: Put money where your mouth is. Stake VOTER tokens to dispute questionable claims
- **Information rewards**: Higher payouts for surprising, verifiable insights that change minds or reveal new data
- **Accountability stakes**: Spread misinformation, pay the price when markets prove you wrong
- **Portable reputation**: ERC-8004 credibility follows you across platforms

**Quality discourse pays. Bad faith costs.**

### Addressing Real Challenges

**Agent Convergence**: We deploy different base models with varied training to prevent echo chambers. Dissent is rewarded in consensus mechanisms.

**Causation vs Correlation**: We don't claim to read minds. We track observable actions with confidence scores. Direct citations get high confidence. Temporal correlations get lower confidence. Transparency is the innovation.

**Capital vs Merit**: Challenge markets use quadratic staking and time-locked rewards. Reputation compounds over time while capital has diminishing returns. Not perfect, but better than pure plutocracy.

**Debugging Complexity**: We build interpretability from day one. Every agent decision logged. Every parameter change traceable. When agents fail, humans intervene.

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

- EVM contracts: build/test with Foundry/Hardhat for token/treasury/components
- Agent stack: LangGraph/Temporal/N8N off‑chain; anchor outcomes to Monad; schedule maintenance via workflow orchestrator

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

### Legislative Adapters (e.g., CWC)
- Invariant UX: we open the user’s mail client with prepared content
- Backend adapters translate/submit to certified APIs/forms where required (e.g., CWC)
- Receipts (delivery confirmations/mail routing) are hashed, pinned to IPFS, and attested on Monad

### Identity Verification
- Government ID verification for VOTER record eligibility
- Address verification for congressional district mapping
- Anti-sybil measures to prevent manipulation
- Privacy-preserving verification where possible

### Social Media Integration
- Authentic sharing of civic achievements and policy impact
- Cross-platform feeds showcasing verified democratic participation
- Content creator partnerships focused on civic education
- Real-time coverage of democratic processes and outcomes

## Market Context (2025)

### The Attention War Reality
**Democracy has a distribution problem.**

While TRUMP-linked memecoins touched $40B in 24 hours on Inauguration Day, a floor vote barely dents the feed. Citizens who've never called a representative learned automated market makers overnight. When TikTok optimizes for engagement and Robinhood gamifies markets, civic work reads like homework.

### Competitive Landscape
- **Memecoin market**: $140B+ proves attention + economic incentives = massive adoption  
- **Regulatory clarity**: Post-GENIUS Act enables compliant civic tokenomics
- **Infrastructure ready**: Monad (cheap EVM anchoring), Self Protocol (zk identity), ERC-8004 (AI-human coordination)

### VOTER's Opportunity
- **First democracy protocol** that competes for attention in the memecoin economy
- **Authentic civic impact** distinguishes from pure speculation
- **Infrastructure advantage**: We build rails everyone else needs

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