# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The VOTER Protocol is democracy infrastructure that competes in the attention economy. While memecoins hit $72B market caps overnight, civic engagement reads like homework. We fix this with verifiable political participation that pays.

**Core Philosophy**: ERC-8004 was built for AI agents. We extend it to human civic participants, creating infrastructure both humans and AI can use for authentic democratic coordination.

**The Strategic Bet**: We're not building for AI agents to coordinate with each other. We're building AI-verified infrastructure for human civic participation. The AI is the verification layer, the human is the participant. This positions VOTER as the foundational civic protocol where on-chain agency meets democratic authenticity.

### Repository Structure

**VOTER Protocol** (this repo): Smart contracts, protocol specifications, and technical architecture
- **Smart Contracts**: Solidity implementations for on-chain settlement (`/contracts`)
- **Protocol Specs**: Complete technical documentation (`/specs`)
- **Documentation**: User-facing guides (README, QUICKSTART, TECHNICAL, CONGRESSIONAL)

**Communique** (separate repo): Frontend application and off-chain implementations
- **Frontend**: User-facing web application (SvelteKit 5 + TypeScript)
- **Agent Logic**: Multi-agent consensus systems for verification and rewards
- **CWC Integration**: Congressional message delivery and tracking
- **Database**: PostgreSQL (Prisma) for off-chain data

## Documentation Structure

**Start here for context:**
- **[README.md](README.md)** - Main entry point: problem, solution, why now (108 lines, cypherpunk energy)
- **[QUICKSTART.md](QUICKSTART.md)** - Non-technical users: Face ID to first reward in 4 minutes
- **[TECHNICAL.md](TECHNICAL.md)** - Blockchain developers: Cryptography deep dive, implementation details
- **[CONGRESSIONAL.md](CONGRESSIONAL.md)** - Legislative staff: Solving the 66% spam problem
- **[SECURITY.md](SECURITY.md)** - Living threat model: Attack vectors, mitigations, incident response (updated continuously)
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Protocol designers: Complete system architecture with diagrams
- **[SOURCES.md](SOURCES.md)** - All 64 academic citations and research backing claims

**Key principle**: Zero repetition across docs. Each serves distinct audience with unique content.

## Technology Stack

### Blockchain Infrastructure (Current Architecture)

**Primary Settlement**: Scroll zkEVM (Ethereum L2, Stage 1 decentralized)
- Cost: ~$0.0047-$0.0511 per transaction
- Finality: ~2 seconds (L2) + Ethereum security
- Why: Ethereum-native settlement with ZK proof verification built-in

**Account Abstraction**: NEAR Chain Signatures (universal cross-chain control)
- MPC threshold signatures across 300+ validator nodes
- One passkey controls addresses on Bitcoin, Ethereum, Scroll, any ECDSA chain
- No bridges, no wrapped tokens, no trusted intermediaries
- Sub-second signature latency

**Identity & Privacy**: NEAR CipherVault (encrypted PII storage)
- XChaCha20-Poly1305 encryption client-side
- Zstd compression (90% storage cost reduction)
- Storage deposit pattern (NEP-145) for sustainable economics
- Users pay for own storage (~$0.11 per user)

**See [ARCHITECTURE.md](ARCHITECTURE.md) and [TECHNICAL.md](TECHNICAL.md)** for complete technical details.

### Core Cryptographic Primitives

**Zero-Knowledge Proofs**: Groth16 SNARKs for district residency verification
- 8-12 second browser proving time (WASM)
- 256-byte proof size
- Verifies congressional district membership without revealing address
- Shadow Atlas Merkle tree (190+ countries, quarterly IPFS updates)

**End-to-End Encryption**: Message delivery to congressional offices
- Client-side: XChaCha20-Poly1305 AEAD (libsodium)
- TEE delivery: AWS Nitro Enclaves (hardware isolation)
- CWC integration: Whitelisted IP delivery to congressional systems
- Plaintext exists only: browser → enclave → CWC → congressional CRM

**Multi-Party Computation**: NEAR Chain Signatures
- Threshold ECDSA across validator set
- No single node sees complete private key
- Byzantine fault tolerance (2/3 validators must collude)
- Passkey-based control (Face ID/fingerprint)

**See [TECHNICAL.md](TECHNICAL.md)** for implementation details and code examples.

### Economic Mechanisms

**Challenge Markets**: Prevent misinformation without centralized fact-checkers
- Quadratic staking (influence = sqrt(stake_amount))
- Multi-model AI consensus (6+ diverse models, 67% threshold required)
- Only objective facts challengeable (voting records, bill text, policy outcomes)
- Reputation at stake (lose challenges → reputation slashed)

**Outcome Markets**: Financial instruments for political outcomes
- Binary prediction on legislative outcomes
- Retroactive funding for civic infrastructure that contributed
- Temporal correlation tracking (template sends → bill introduction)
- ImpactAgent verifies geographic clustering + legislative language similarity

**Multi-Agent Treasury Management**: 5 specialized agents with deterministic workflows
- SupplyAgent (30% weight): Adjusts rewards based on treasury runway + participation
- MarketAgent (30% weight): Monitors volatility, proposes circuit breakers
- ImpactAgent (20% weight): Verifies template→legislation correlation
- ReputationAgent (20% weight): Domain-specific credibility scoring
- VerificationAgent (0% weight): Pre-consensus cryptographic validation

**Key difference from Terra/Luna**: Agents execute bounded computation on observable data, not raw LLM inference. Deterministic workflows prevent death spirals through mathematical optimization within auditable constraints.

**See [TECHNICAL.md](TECHNICAL.md)** for smart contract logic and consensus mechanisms.

## Code Quality Standards

**TYPE SAFETY PHILOSOPHY**: The same obsessive attention to correctness that prevents million-dollar smart contract bugs must extend to every TypeScript interface that interacts with those contracts. Loose types in agent logic or frontend code create runtime failures that brick the protocol just as thoroughly as a reentrancy vulnerability.

### 🚨 TYPESCRIPT: NUCLEAR-LEVEL STRICTNESS - ABSOLUTE ZERO TOLERANCE 🚨

**PRIMARY SCOPE**: These TypeScript standards apply to the Communique repository (frontend, agents, off-chain logic). However, the underlying principle—obsessive type correctness prevents catastrophic failures—applies equally to smart contract development in this repository.

**BASED ON COMMUNIQUE REPO ESLint DISASTER: We learned from 1000+ ESLint errors causing complete development paralysis. This never happens again.**

#### ⚡ INSTANT PR REJECTION CRITERIA ⚡

Any PR containing these patterns will be INSTANTLY REJECTED without review:

- ❌ **`any` type usage** - No exceptions, no "temporary" uses, no "quick fixes"
- ❌ **`@ts-ignore` comments** - Fix the type issue, don't silence it
- ❌ **`@ts-nocheck` comments** - Every file MUST be type-checked
- ❌ **`@ts-expect-error` comments** - Fix the code, not suppress the error
- ❌ **`as any` casting** - Use proper type guards and assertions
- ❌ **`Record<string, any>` patterns** - Define proper interfaces
- ❌ **`unknown` misuse as `any` substitute** - Use proper type narrowing
- ❌ **Generic function parameters without constraints** - Always constrain generics
- ❌ **Loose object casting like `data as SomeType`** - Use type guards

#### ✅ MANDATORY TYPE PRACTICES ✅

Every line of code MUST follow these practices:

- ✅ **Explicit types for ALL function parameters and returns**
- ✅ **Comprehensive interfaces for ALL data structures**
- ✅ **Type guards for ALL runtime validation**
- ✅ **Discriminated unions for ALL variant types**
- ✅ **Exhaustive type checking in ALL switch statements**
- ✅ **Proper generic constraints for ALL generic functions**
- ✅ **Strict null checks enabled and enforced**
- ✅ **No implicit any configurations**

#### Web3 TypeScript Best Practices:

```typescript
// ✅ CORRECT - Proper Web3 typing
import type { Contract, ContractTransaction, BigNumber } from 'ethers';

interface VOTERTokenInterface {
  mint(to: string, amount: BigNumber): Promise<ContractTransaction>;
  balanceOf(account: string): Promise<BigNumber>;
  transfer(to: string, amount: BigNumber): Promise<ContractTransaction>;
}

// Type guard for contract responses
function isValidTransactionResponse(
  response: unknown
): response is ContractTransaction {
  return (
    typeof response === 'object' &&
    response !== null &&
    'hash' in response &&
    'wait' in response
  );
}

// ❌ WRONG - Loose Web3 typing
const contract: any = getContract();
const result: any = await contract.mint(address, amount);
```

#### Agent Decision Types:

```typescript
// ✅ CORRECT - Strict agent decision typing
interface SupplyAgentDecision {
  readonly rewardAmount: BigNumber;
  readonly baseRewardUSD: number;
  readonly multipliers: {
    readonly participationScore: number;
    readonly marketConditions: number;
    readonly timeDecay: number;
  };
  readonly reasoning: string;
  readonly confidence: number;
  readonly timestamp: number;
}

function isSupplyAgentDecision(value: unknown): value is SupplyAgentDecision {
  return (
    typeof value === 'object' &&
    value !== null &&
    'rewardAmount' in value &&
    'multipliers' in value &&
    typeof (value as SupplyAgentDecision).confidence === 'number'
  );
}
```

### CRITICAL: Smart Contract Security - ZERO TOLERANCE

**THIS IS NON-NEGOTIABLE: We enforce STRICT Solidity best practices with ZERO exceptions.**

#### Security Requirements (MANDATORY):

- ✅ **Check-Effects-Interactions pattern** - Always update state before external calls
- ✅ **Reentrancy guards** - Use OpenZeppelin's ReentrancyGuard on all public functions
- ✅ **Integer overflow protection** - Solidity 0.8+ automatic checks
- ✅ **Access control** - Every function must have appropriate modifiers
- ✅ **Input validation** - Validate ALL inputs with require() statements
- ✅ **Event emission** - Emit events for all state changes

#### Forbidden Practices (NEVER use these):

- ❌ **NEVER use `tx.origin`** - Use msg.sender for authentication
- ❌ **NEVER use `block.timestamp` for randomness** - Miners can manipulate
- ❌ **NEVER use `delegatecall` to untrusted contracts** - Code injection risk
- ❌ **NEVER use `selfdestruct`** - Deprecated and dangerous
- ❌ **NEVER leave functions without access control** - All functions need modifiers
- ❌ **NEVER use floating pragma** - Lock to specific compiler version

#### Required Pattern:

```solidity
// ✅ CORRECT - Proper function structure
function submitAction(
    uint256 actionId,
    bytes calldata data
) external
    nonReentrant
    whenNotPaused
    onlyVerified
{
    // 1. Checks (input validation)
    require(actionId > 0, "Invalid action ID");
    require(data.length > 0, "Empty data");

    // 2. Effects (state changes)
    actions[msg.sender][actionId] = Action({
        data: data,
        timestamp: block.timestamp,
        status: ActionStatus.Pending
    });

    // 3. Interactions (external calls)
    emit ActionSubmitted(msg.sender, actionId, data);
}
```

### Pre-Commit Requirements (ALL MUST PASS):

```bash
# Communique repository:
npm run typecheck     # TypeScript compilation check
npm run lint:strict   # Zero-tolerance ESLint check
npm run test          # TypeScript tests must pass

# VOTER Protocol repository (this repo):
forge build           # Smart contract compilation
forge test            # Contract tests must pass
forge coverage        # Verify >95% coverage
slither .             # Static analysis (no high/medium issues)
```

**Remember: We're building financial infrastructure that handles real money. Type safety isn't negotiable.**

## Key Development Concepts

### Compliance Posture

- **CLARITY Act Digital Commodity**: VOTER tokens qualify as digital commodities under federal framework - value derives from network utility, not expectation of profit from management efforts
- **Bright-line rules**: We never reward voting, registering to vote, or choosing candidates. We reward the verifiable work of contacting representatives.
- **Privacy-preserving**: Zero PII on-chain; encrypted storage in NEAR CipherVault
- **Democratic authenticity**: Clear separation between verified participation records and economic incentives

In a world where the President's memecoin cleared $40B on inauguration day, compensating civic labor makes us competitive while we build on emerging regulatory clarity. The CLARITY Act provides the regulatory framework we need.

### Challenge Markets: Information Quality Infrastructure

Challenge markets create economic incentives for information accuracy:

**Democratic Legitimacy**:
- **Preference revelation**: Quadratic voting reveals true intensity of preferences, not just binary positions
- **Community consensus**: Aggregate genuine sentiment rather than gaming by concentrated wealth
- **Proportional influence**: Your stake reflects conviction, with diminishing returns preventing domination

**Network Effects**:
- **Quality convergence**: Participants with strongest convictions on accuracy get proportionally higher influence
- **Information aggregation**: Market mechanism surfaces collective intelligence about claim validity
- **Reputation compounding**: Accurate challengers build credibility enhancing future challenge power

**Economic Security**:
- **Skin in the game**: Reputation staking creates personal cost for bad faith participation
- **Portable reputation**: ERC-8004 credibility follows you across platforms

**Quality discourse pays. Bad faith costs.**

### Multi-Agent Architecture: Production-Ready Governance

**Why Sophisticated Agents Are Necessary (Not Overengineering):**
- **Market Volatility Defense**: Multi-oracle consensus prevents single point of failure during extreme price movements
- **Sybil Attack Resistance**: Differentiation between earned vs purchased tokens defeats economic attacks
- **Quality Over Volume**: ImpactAgent rewards legislative outcomes, not spam actions
- **4-Year Treasury Survival**: SupplyAgent manages emission curves through full market cycles
- **Regulatory Compliance**: Bounded parameters with agent consensus satisfy CLARITY Act requirements

**Agent Consensus Mechanisms**:
- **Weighted Decision Making**: SupplyAgent (30%), MarketAgent (30%), ImpactAgent (20%), ReputationAgent (20%)
- **Circuit Breakers**: MarketAgent can halt operations during extreme events (>30% price swing/24h)
- **Multi-Oracle Aggregation**: Chainlink + custom oracle feeds prevent manipulation
- **Bounded Authority**: No single agent exceeds min/max constraints

**Audit Transparency**:
- Every agent decision recorded on-chain with IPFS hash of full context
- Community can replay inputs through public agent logic, compare outputs
- Discrepancies flagged → agent reputation decay → consensus weight reduction

**Implementation Philosophy**: Modular agents with bounded authority create emergent resilience. Each agent is auditable individually but powerful in consensus—appropriate complexity for production deployment in hostile crypto environment.

**See [TECHNICAL.md](TECHNICAL.md)** for agent implementation details and consensus mechanisms.

## Smart Contract Architecture

**Smart contracts (Solidity) live in this repository.** See `/contracts` directory for implementation.

### Settlement Infrastructure

- **Scroll zkEVM**: Primary settlement layer ($0.0047-$0.0511/action, ~2 sec finality)
- **NEAR Chain Signatures**: Universal account layer enabling multi-chain expansion
- **ERC-8004 Registries**: Portable reputation and credibility attestations
- **IPFS Storage**: Content addressing with on-chain CID references

### Contract Primitives

- **Token Economics**: ERC-20 governance with staking and voting extensions
- **Challenge Markets**: Multi-model consensus orchestration
- **Outcome Markets**: Binary prediction with retroactive funding
- **Reputation Registry**: Domain-specific, time-weighted credibility
- **Multi-sig Governance**: Emergency controls and parameter boundaries

### Multi-Chain Strategy

- **Ethereum-primary approach**: Scroll L2 for primary settlement
- **NEAR Chain Signatures**: One account controls addresses on ALL ECDSA/Ed25519 chains
- **No custom bridges**: Native multi-chain via NEAR's MPC network
- **Treasury management**: Multi-sig control, no routine bridging required

**See [ARCHITECTURE.md](ARCHITECTURE.md)** for complete contract architecture and deployment strategy.

## Identity Verification

**Free Forever Core KYC via [Didit.me](https://www.didit.me)**: ID verification, face match, passive liveness at zero cost
- **Premium scaling**: $0.35 AML screening, $0.50 proof of address for institutional compliance
- **Developer sandbox**: Unlimited testnet verification
- **Global coverage**: ISO 27001 certified, GDPR compliant, 190+ countries

**Alternative: [self.xyz](https://www.self.xyz)** - NFC passport scan (instant, zero friction)

**On-Chain Architecture**:
- **Verifiable Credentials**: Cryptographically signed attestations off-chain
- **Smart Contract Verification**: Contracts verify signatures and extract claims on-chain
- **Zero-Knowledge Proofs**: Prove identity attributes without revealing PII
- **Revocation Registry**: On-chain credential validity tracking

**Global Representation Mapping**: Address verification enables precise targeting by electoral district across 190+ countries while maintaining privacy through selective disclosure.

## Integration Points

### External System Integration

- **Smart Contract APIs**: Standard interfaces for external systems
- **ERC-8004 Compliance**: Portable reputation across platforms
- **Multi-sig Governance**: External integrations require governance approval
- **Event Emission**: Smart contracts emit events for external consumption

### Cross-Platform Compatibility

- ERC-8004 reputation registries for portable credibility
- Standardized action verification for external platforms
- Challenge market integration for information quality
- Treasury integration for institutional partnerships

## Market Context (2025)

### The Attention Game Reality

**Democracy has a distribution problem.**

While TRUMP-linked memecoins touched $40B in 24 hours on Inauguration Day, civic engagement generates form letters. Citizens who've never called a representative learned DeFi in a weekend. When TikTok delivers 58 minutes daily with algorithmic precision and memecoins coordinate in real-time, civic work reads like homework.

### Competitive Landscape

- **Memecoin market**: Proves attention + economic incentives = massive adoption
- **Regulatory clarity**: CLARITY Act enables compliant civic tokenomics
- **Infrastructure ready**: Scroll L2, NEAR Chain Signatures, Didit.me/self.xyz identity, ERC-8004 coordination

### VOTER's Advantages

- **Multi-chain from day one**: NEAR Chain Signatures enable Ethereum + Bitcoin + Solana with zero custom bridges
- **Zero-cost identity**: Free forever verification removes largest barrier to authentic participation
- **First democracy protocol** that competes for attention in memecoin economy while delivering authentic civic impact
- **AI-verified authenticity**: Multi-model consensus for trustless verification at scale

**Infrastructure advantage**: We're building the rails everyone else needs—Ethereum-native settlement with universal multi-chain expansion.

## Critical Design Principles

### Separation of Democracy from Speculation

- Records prove civic participation but cannot be traded
- Tokens provide economic incentives without commodifying democracy
- Clear distinction prevents "buying political influence" narrative

### Engaging Participation Without Compromise

- Meaningful mechanics tracking real civic impact
- Economic incentives based on verified democratic participation
- Authentic outcomes distinguish from pure speculation

### Institutional-Grade Security

- Multi-sig governance for critical functions
- Professional security audits required
- Emergency pause mechanisms
- Compliance with regulatory frameworks

## Development Notes

- **Implementation Location**: Smart contracts (Solidity) in this repository (`/contracts`). Frontend and agents in Communique repository.
- **Testing**: Comprehensive test suite (Foundry for contracts, Vitest for TypeScript)
- **Deployment**: Multi-sig governance for production deployments on Scroll L2
- **Architecture Reference**: See [ARCHITECTURE.md](ARCHITECTURE.md) for complete technical architecture

## Security Considerations

**See [SECURITY.md](SECURITY.md) for complete, continuously-updated threat model and incident response procedures.**

Key security principles:
- Smart contracts must undergo professional security audits before deployment
- Multi-sig governance prevents single points of failure
- Rate limiting prevents spam and gaming
- Identity verification balances privacy with authenticity
- Emergency controls for crisis situations
- Challenge markets create economic consequences for misinformation
- Living documentation: Security threats evolve, our defenses evolve with them

The VOTER Protocol positions democracy to compete for attention while creating authentic political impact. We're building infrastructure both humans and AI can use.

**Making democracy engaging is essential for its evolution in the attention economy.**

*Quality discourse pays. Bad faith costs.*
