# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Communiqué is an adaptive civic engagement platform that integrates the VOTER Protocol for verifiable democratic participation. The platform uses multi‑agent systems to optimize civic engagement through the VOTER token economy and VOTER Records system. User interaction is invariant (we always open the mail client); backend adapters handle certified legislative interfaces. Verification receipts are hashed, pinned to IPFS, and attested on Monad (no PII on‑chain). Optional L2 mirrors use ERC‑8004 registries for ETH‑native consumption.

**Core Philosophy**: ERC-8004 was built for AI agents. We extend it to human civic participants through the VOTER Protocol, creating infrastructure that serves both AI coordination and portable democratic reputation.

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
- **AI Models**: Claude 3.5 Sonnet for agent intelligence

### Blockchain Infrastructure
- **Anchoring (EVM)**: Monad as primary on‑chain anchor (registries/attestations)
- **Optional L2 Mirror**: ERC‑8004 Identity/Validation/Reputation registries on a major L2 when partners require on‑chain reads
- **Contracts**: `VOTERRegistry.sol`, `VOTERToken.sol`, `CommuniqueCore.sol`, `AgentParameters.sol`, `AgentConsensusGateway.sol`

### Agent-Driven Services
- **Agent Swarm**: SupplyAgent, VerificationAgent, MarketAgent, ImpactAgent, ReputationAgent
- **Dynamic Parameters**: No hardcoded constants, all dynamically calibrated
- **Emergent Governance**: Agent-coordinated proposal and voting systems
- **Continuous Learning**: Vector memory for pattern recognition and optimization

## Key Development Concepts

### Compliance posture
- Utility‑first design; VOTER is used for governance/utility, not vote buying
- No PII on‑chain; off‑chain KYC/attestations only where legally required
- Clear separation between verified participation records and incentives

### Adaptive Development Approach
The platform uses intelligent automation throughout:
- Dynamically calibrated reward calculations based on real civic impact
- Dynamic verification thresholds that adapt to user behavior
- Emergent economic parameters that optimize for engagement
- Self-modifying governance that evolves with community needs

### Carroll Mechanisms: Information Quality Markets
**Quality discourse pays. Bad faith costs.**
- Challenge markets for disputing claims with VOTER token stakes
- Information rewards for surprising, verifiable insights
- Reputation aggregation in ERC-8004 registries
- Portable democratic credibility across platforms

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

## Market Context (August 2025)

### Competitive Landscape
- Memecoin market: $140B+ with 500% growth in 2024
- Trump coin reached $72B market cap overnight
- Regulatory clarity through GENIUS Act
- Pro-crypto administration policies

### Opportunity
- First-mover advantage in tokenized civic engagement
- Intersection of engaging mechanics + authentic democratic participation
- Post-GENIUS Act regulatory clarity enables compliant tokenomics

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
- **Token Migration**: Renamed from CIVIC to VOTER to avoid trademark conflict
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

Communiqué, powered by the VOTER Protocol, represents the convergence of engaging digital mechanics with authentic civic participation—positioning democracy to thrive in the digital economy while creating measurable political impact.