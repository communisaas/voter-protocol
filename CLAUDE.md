# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Communiqué is an agentic civic engagement platform that uses multi‑agent systems to optimize democratic participation. User interaction is invariant (we always open the mail client); backend adapters handle certified legislative interfaces. Verification receipts are hashed, pinned to IPFS, and attested on Monad (no PII on‑chain). Optional L2 mirrors use ERC‑8004 registries for ETH‑native consumption.

### Core Innovation: Agentic Democracy Architecture
- **VOTER Records**: Non-transferable proof of civic actions, verified by agent consensus
- **CIVIC Tokens**: Dynamically minted governance tokens with agent-optimized reward calculations
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
- **Contracts**: `VOTERRegistry.sol`, `CIVICToken.sol`, `CommuniqueCore.sol`, `AgentParameters.sol`, `AgentConsensusGateway.sol`

### Agent-Driven Services
- **Agent Swarm**: SupplyAgent, VerificationAgent, MarketAgent, ImpactAgent
- **Dynamic Parameters**: No hardcoded constants, all agent-optimized
- **Emergent Governance**: Agent-coordinated proposal and voting systems
- **Continuous Learning**: Vector memory for pattern recognition and optimization

## Key Development Concepts

### Compliance posture
- Utility‑first design; CIVIC is used for governance/utility, not vote buying
- No PII on‑chain; off‑chain KYC/attestations only where legally required
- Clear separation between verified participation records and incentives

### Agentic Development Approach
The platform uses intelligent automation throughout:
- Agent-optimized reward calculations based on real civic impact
- Dynamic verification thresholds that adapt to user behavior
- Emergent economic parameters that optimize for engagement
- Self-modifying governance that evolves with community needs

## Smart Contract Architecture

### On-chain Anchors (Monad)
- Registry (Monad): Stores IPFS CIDs (templates/channels/version graph)
- Attest (Monad): Attests hash receipts (CWC/mail routing); supports revocations
- Optional: ERC‑8004 mirror on L2 for on‑chain reads by ETH‑native consumers

### EVM Contracts (optional)
- `VOTERRegistry.sol`, `CIVICToken.sol`, `CommuniqueCore.sol`, `AgentParameters.sol`, `AgentConsensusGateway.sol`

### CIVICToken.sol
- ERC-20 with voting extensions (ERC20Votes, ERC20Permit)
- Staking mechanism with APR rewards
- Governance proposal creation and voting
- Fee discount system based on civic engagement

### Cross-chain control
- Avoid routine bridging; treasuries and liquidity remain on ETH/L2 (Safe). Bridge only for explicit flows; no MPC dependency required.

## Development Notes

- EVM contracts: build/test with Foundry/Hardhat for token/treasury/components
- Agent stack: LangGraph/Temporal/N8N off‑chain; anchor outcomes to Monad; schedule maintenance via workflow orchestrator

## Critical Design Principles

### Separation of Democracy from Speculation
- VOTER records prove civic participation but cannot be traded
- CIVIC tokens provide economic incentives without commodifying democracy
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

- **[Implementation Roadmap](docs/implementation/IMPLEMENTATION_ROADMAP.md)** - Complete 6-phase development plan addressing security vulnerabilities, infrastructure completion, and sustainable economic mechanisms
- **[Design Documents](docs/design/)** - Architecture specifications and engagement strategy including:
  - `VIRAL_ENGAGEMENT_PLAN.md` - Principled engagement mechanics for ETH community acceptance
- **[Security Analysis](docs/security/)** - Vulnerability assessments and mitigation strategies including:
  - `SECURITY_ANALYSIS.md` - Comprehensive security audit findings and fixes

## Current Development Status

### Critical Security Issues Identified
- **OPERATOR_ROLE Vulnerability**: Single operator can mint unlimited tokens (needs decentralized oracle network)
- **Supply Cap Issue**: 1B token cap / 10 per action = 100M max actions (needs governance-controlled expansion)
- **Staking Bug**: Voting power loss after unstaking breaks governance participation
- **Missing External Verification**: CWC API integration exists as interface only, no implementation

### Immediate Priorities
1. **Security Hardening**: Replace centralized minting with multi-sig oracle consensus
2. **CWC Integration**: Complete congressional message verification system
3. **Identity Verification**: Implement Self Protocol ZK proof verification
4. **Supply Management**: Add governance mechanisms for token supply expansion
5. **Frontend Development**: Production-ready web and mobile applications

## Security Considerations

- Smart contracts must undergo professional security audits
- Multi-sig governance prevents single points of failure
- Rate limiting prevents spam and gaming
- Identity verification balances privacy with authenticity
- Emergency controls for crisis situations

This platform represents the convergence of engaging digital mechanics with authentic civic participation—positioning democracy to thrive in the digital economy while creating measurable political impact.