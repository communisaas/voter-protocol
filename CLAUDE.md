# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Communiqué is a civic engagement platform designed to tokenize democratic participation in the post-GENIUS Act era. The project leverages Monad Protocol's high-performance EVM infrastructure to create engaging, gamified civic participation that provides meaningful feedback while generating real democratic impact.

### Core Innovation: Hybrid Token Architecture
- **VOTER Records**: Non-transferable, soul-bound proof of civic actions (prevent commodification of democracy)
- **CIVIC Tokens**: Tradeable governance tokens minted per verified civic action (10 CIVIC per congressional message, configurable per action type)

## Technology Stack

### Blockchain Infrastructure
- **Primary Chain**: Monad Protocol (10,000 TPS, 1-second finality, <1¢ fees)
- **Smart Contracts**: Solidity 0.8.19, OpenZeppelin libraries
- **Architecture**: Three core contracts:
  - `VOTERRegistry.sol`: Non-transferable civic action records
  - `CIVICToken.sol`: ERC-20 governance token with voting, staking, rewards
  - `CommuniqueCore.sol`: Orchestration layer between VOTER and CIVIC systems

### Planned Frontend/Backend
- **Frontend**: SvelteKit with viral engagement UI
- **Backend**: Node.js with CockroachDB
- **Integrations**: Congressional CWC API, identity verification services
- **Storage**: Hybrid on-chain metadata + off-chain sensitive data

## Key Development Concepts

### Post-GENIUS Act Compliance
The platform is designed for the pro-crypto regulatory environment following Trump's GENIUS Act (July 2025):
- CIVIC tokens structured as utility tokens (governance + fee discounts)
- Clear functional utility beyond speculation
- Bank Secrecy Act compliance built-in
- Integration with emerging stablecoin frameworks

### Engagement Mechanics Design
The platform provides compelling civic participation through:
- Civic impact tracking and representative responsiveness metrics
- Social recognition and achievement systems based on real outcomes
- Economic rewards for verified democratic participation
- Authentic content showcasing civic influence and policy outcomes

## Smart Contract Architecture

### VOTERRegistry.sol
- Stores immutable, non-transferable civic action records
- Citizen verification tied to congressional districts
- Anti-spam measures and quality scoring
- Public auditability of democratic participation

### CIVICToken.sol
- ERC-20 with voting extensions (ERC20Votes, ERC20Permit)
- Staking mechanism with APR rewards
- Governance proposal creation and voting
- Fee discount system based on civic engagement

### CommuniqueCore.sol
- Orchestrates VOTER record creation + CIVIC token minting
- Batch processing for efficiency on high-TPS Monad
- Platform statistics and civic impact tracking functions
- Configurable reward structures for different action types

## Development Commands

When the codebase is established, common commands will include:

```bash
# Smart contract development
npm install                    # Install dependencies
npx hardhat compile           # Compile contracts
npx hardhat test              # Run contract tests
npx hardhat deploy --network monad  # Deploy to Monad

# Frontend development
npm run dev                   # Start SvelteKit dev server
npm run build                 # Build production frontend
npm run lint                  # Run linting
npm run test                  # Run frontend tests
```

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

### Congressional CWC System
- Direct integration with official Congressional communication system
- Message delivery verification
- Representative response tracking
- District-based user verification

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
- Monad's performance enables mass adoption without blockchain friction

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