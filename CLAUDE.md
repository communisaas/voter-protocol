# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The VOTER Protocol is democracy infrastructure that competes in the attention economy. While memecoins hit $72B market caps overnight, civic engagement reads like homework. We fix this with verifiable political participation that pays.

**Core Philosophy**: ERC-8004 was built for AI agents. We extend it to human civic participants, creating infrastructure both humans and AI can use for authentic democratic coordination.

**The Strategic Bet**: We're not building for AI agents to coordinate with each other. We're building AI-verified infrastructure for human civic participation. The AI is the verification layer, the human is the participant. This positions VOTER as the foundational civic protocol where on-chain agency meets democratic authenticity.

### Architecture Split: VOTER Protocol + Communique
**VOTER Protocol** (this repo): Smart contracts for on-chain settlement
- **Smart Contracts**: VOTERToken, CommuniqueCore, AgentConsensus, ChallengeMarket
- **On-chain Infrastructure**: Registries, reputation systems, consensus verification
- **Blockchain Settlement**: Token minting, reward distribution, challenge resolution

**Communique** (separate repo): Off-chain agent implementations
- **Agent Logic**: `/src/lib/agents/voter-protocol/` contains TypeScript implementations
- **SupplyAgent, MarketAgent, ImpactAgent, VerificationAgent, ReputationAgent**
- **Template Processing**: Content moderation and enhancement
- **CWC Integration**: Congressional message delivery and verification

## Technology Stack

### Blockchain Infrastructure (October 2025 Architecture)
- **Primary Settlement**: Scroll zkEVM (Stage 1 decentralized L2) for on-chain settlement
- **Multi-Chain Expansion**: Ethereum-primary via NEAR Chain Signatures (universal account layer)
- **Future Expansion**: Bitcoin and Solana via same NEAR account (no custom bridges)
- **Development**: Smart contract implementation lives in Communique repository
- **Deployment**: Multi-sig governance for production deployments

**Why Scroll + NEAR Chain Signatures**: Scroll provides Ethereum-native settlement ($0.135/action, 5 sec finality) while NEAR Chain Signatures enable one account to control addresses on ALL ECDSA/Ed25519 chains. No custom bridges. No wrapped tokens. No trusted intermediaries.

**See ARCHITECTURE.md** for complete technical architecture including:
- Outcome Markets (Gnosis CTF + UMA Optimistic Oracle)
- Challenge Markets (Chainlink Functions + OpenRouter 20-model consensus)
- Template Impact Correlation (Congress.gov API v3 + GPT-5 causality)
- Retroactive Funding (Gitcoin Allo + Optimism RetroPGF model)

### Core Technology Primitives
**NOTE**: Specific contract implementations live in Communique repository. This repo contains strategic vision and architecture.

**Cryptographic Infrastructure**:
- **Zero-Knowledge Proofs**: Groth16 SNARKs for district residency (8-12 sec browser proving)
- **Multi-Party Computation**: NEAR Chain Signatures for cross-chain control (300x capacity Feb 2025)
- **Trusted Execution Environments**: GCP Confidential Space for E2E encrypted congressional delivery
- **End-to-End Encryption**: XChaCha20-Poly1305 for client-side PII encryption

**Information Quality**:
- **Multi-Model Consensus**: 20 AI models via OpenRouter (GPT-5, Claude Sonnet 4.5, Grok 4, Gemini 2.5, Qwen 2.5)
- **Challenge Markets**: Chainlink Functions orchestrating diverse model evaluations
- **Impact Tracking**: Congress.gov API v3 + ChromaDB semantic search + GPT-5 correlation analysis

**Economic Primitives**:
- **Quadratic Mechanisms**: Gitcoin-style quadratic funding preventing plutocracy
- **Outcome Markets**: Gnosis CTF binary tokens + UMA Optimistic Oracle resolution
- **Retroactive Funding**: Impact-based allocation after verified legislative outcomes

## Code Quality Standards

### 🚨 ABSOLUTE ZERO ESLint ERROR POLICY 🚨

**BASED ON COMMUNIQUE REPO ESLint DISASTER: We learned from 1000+ ESLint errors causing complete development paralysis. This never happens again.**

**ROOT CAUSE ANALYSIS: Inconsistent tooling, unclear standards, and reactive error-fixing created an endless cycle of technical debt.**

#### 🛡️ PREVENTION-FIRST APPROACH (Applies to Communique Integration) 🛡️

**BEFORE writing ANY TypeScript code in Communique integration:**
1. **Run `npm run lint` locally** - Must show 0 errors before committing
2. **Configure IDE with ESLint integration** - Real-time error prevention
3. **Use TypeScript strict mode** - Catch issues at development time
4. **Follow established patterns** - Don't create new anti-patterns

**CI WILL FAIL ON ANY ESLint ERROR. No exceptions. No "we'll fix it later."**

#### 🔧 TypeScript/ESLint Standards (For Communique Integration)

**Error Handling Patterns (NEVER change these):**
```typescript
// ✅ CORRECT - Use error when needed
try {
  riskyOperation();
} catch (error) {
  console.error('Operation failed:', error);
  throw error;
}

// ✅ CORRECT - Anonymous when unused  
try {
  simpleOperation();
} catch {
  return { success: false };
}

// ❌ WRONG - Don't prefix used variables
try {
  riskyOperation();
} catch (_error) {
  console.error('Operation failed:', _error); // ERROR: _error used but prefixed
}
```

**Unused Variable Rules:**
- **Prefix with `_` ONLY if truly unused**: `_error`, `_event`, `_config`
- **Remove unused imports entirely** - Don't just prefix them
- **Use destructuring with rest**: `const { used, ..._unused } = obj;`

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
- ❌ **NEVER leave functions without access control** - All functions need appropriate modifiers
- ❌ **NEVER use floating pragma** - Lock to specific compiler version

#### Required Patterns:
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

// ❌ WRONG - Vulnerable pattern
function submitAction(uint256 actionId, bytes calldata data) public {
    // No access control, no reentrancy guard, no validation
    externalContract.call(data); // External call before state change
    actions[msg.sender][actionId] = data; // State change after
}
```

#### Gas Optimization Requirements:
```solidity
// ✅ CORRECT - Gas efficient
contract VOTERToken {
    // Pack structs efficiently
    struct Action {
        uint128 amount;      // Pack smaller types together
        uint64 timestamp;    
        uint64 actionId;
        address user;        // 20 bytes
        bool verified;       // 1 byte
    }
    
    // Use mappings over arrays for lookups
    mapping(address => Action[]) public userActions;
    
    // Cache array length in loops
    function processActions(uint256[] memory ids) external {
        uint256 length = ids.length;
        for (uint256 i; i < length;) {
            // Process
            unchecked { ++i; }  // Gas efficient increment
        }
    }
}
```

#### Testing Requirements:
```solidity
// Every contract MUST have comprehensive tests
contract VOTERTokenTest is Test {
    function setUp() public {
        // Setup test environment
    }
    
    function test_RevertWhen_Unauthorized() public {
        vm.expectRevert("Unauthorized");
        token.mint(address(this), 100);
    }
    
    function test_Success_ValidMint() public {
        vm.prank(minter);
        token.mint(user, 100);
        assertEq(token.balanceOf(user), 100);
    }
    
    function testFuzz_MintAmount(uint256 amount) public {
        vm.assume(amount < type(uint256).max);
        // Fuzz test
    }
}
```

### Foundry Commands:
```bash
# Build and test
forge build          # Compile contracts
forge test           # Run all tests
forge test -vvv      # Verbose test output
forge coverage       # Check test coverage

# Security
forge fmt            # Format code
slither .            # Static analysis
mythril analyze      # Security analysis

# Gas optimization
forge snapshot       # Gas usage snapshot
forge test --gas-report
```

### Pre-deployment Checklist:
- [ ] All tests passing with >95% coverage
- [ ] Slither analysis shows no high/medium issues
- [ ] Gas optimization completed
- [ ] Multi-sig setup configured
- [ ] Emergency pause mechanism tested
- [ ] Audit report reviewed and issues fixed
- [ ] Deployment script tested on testnet

**Remember: Smart contract bugs are irreversible and can lose millions. Every line of code must be secure.**

## TypeScript Code Quality Standards

### 🚨 NUCLEAR-LEVEL TYPESCRIPT STRICTNESS - ABSOLUTE ZERO TOLERANCE 🚨

**SMART CONTRACTS AREN'T THE ONLY CODE THAT NEEDS TO BE PERFECT. EVERY TYPESCRIPT FILE IN THIS REPO MUST MEET THE SAME UNCOMPROMISING STANDARDS.**

**EVERY SINGLE TYPE SHORTCUT COSTS US DEVELOPMENT TIME. EVERY `any` TYPE LEADS TO PRODUCTION BUGS. EVERY TYPE SUPPRESSION COMMENT CREATES TECHNICAL DEBT.**

#### ⚡ INSTANT PR REJECTION CRITERIA ⚡
**Any PR containing these patterns will be INSTANTLY REJECTED without review:**

- ❌ **`any` type usage** - No exceptions, no "temporary" uses, no "quick fixes"
- ❌ **`@ts-ignore` comments** - Fix the fucking type issue, don't silence it
- ❌ **`@ts-nocheck` comments** - Every single file MUST be type-checked
- ❌ **`@ts-expect-error` comments** - Fix the code, not suppress the error
- ❌ **`as any` casting** - Use proper type guards and type assertions
- ❌ **`Record<string, any>` patterns** - Define proper interfaces
- ❌ **`(obj as any).property` access** - Define proper object types
- ❌ **`unknown` misuse as `any` substitute** - Use proper type narrowing
- ❌ **Generic function parameters without constraints** - Always constrain generics
- ❌ **Loose object casting like `data as SomeType`** - Use type guards

#### 💀 CONSEQUENCES OF TYPE VIOLATIONS 💀
- **Immediate PR rejection** - No discussion, no exceptions
- **Forced refactoring** - Violating code must be completely rewritten
- **Build failure** - CI will fail and block deployments
- **Code review rejection** - Reviewers are instructed to reject without mercy

#### ✅ MANDATORY TYPE PRACTICES ✅
**Every line of code MUST follow these practices:**

- ✅ **Explicit types for ALL function parameters and returns**
- ✅ **Comprehensive interfaces for ALL data structures**
- ✅ **Type guards for ALL runtime validation**
- ✅ **Discriminated unions for ALL variant types**
- ✅ **Exhaustive type checking in ALL switch statements**
- ✅ **Proper generic constraints for ALL generic functions**
- ✅ **Strict null checks enabled and enforced**
- ✅ **No implicit any configurations**

### Web3 TypeScript Best Practices

#### Smart Contract Interaction Types:
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
  readonly validUntil: number;
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

// ❌ WRONG - Loose agent typing
const decision: any = await supplyAgent.makeDecision();
const amount = decision.rewardAmount; // No type safety
```

#### Blockchain Event Types:
```typescript
// ✅ CORRECT - Proper event typing
interface VoterActionEvent {
  readonly transactionHash: string;
  readonly blockNumber: number;
  readonly args: {
    readonly user: string;
    readonly actionId: BigNumber;
    readonly rewardAmount: BigNumber;
    readonly timestamp: BigNumber;
  };
}

// Type-safe event filtering
function filterVoterActionEvents(
  events: unknown[]
): VoterActionEvent[] {
  return events.filter((event): event is VoterActionEvent => {
    return (
      typeof event === 'object' &&
      event !== null &&
      'args' in event &&
      typeof (event as VoterActionEvent).transactionHash === 'string'
    );
  });
}
```

### ⚡ ENFORCEMENT PROTOCOL ⚡

#### Pre-Commit Requirements (ALL MUST PASS):
```bash
# These commands MUST return ZERO errors or the commit is REJECTED:
npm run typecheck     # TypeScript compilation check
npm run lint:strict   # Zero-tolerance ESLint check
forge build          # Smart contract compilation
forge test           # Contract tests must pass
npm run test         # TypeScript tests must pass
```

#### Development Workflow Requirements:
- **Before every commit**: Run all type-checking commands
- **Before every PR**: Verify 0 TypeScript errors
- **During development**: Use `npx tsc --noEmit --watch` for real-time checking
- **In CI/CD**: Automated rejection of any type violations

#### Code Review Standards:
- **Any `any` type = INSTANT REJECTION**
- **Any type suppression = INSTANT REJECTION**
- **Any loose casting = INSTANT REJECTION**
- **Any missing interface = REQUIRES IMMEDIATE FIX**

### 💰 THE REAL COST OF TYPE SHORTCUTS 💰
**Why we're this fucking strict:**

- **Smart contracts lose millions** when types are wrong
- **Agent decisions fail** when data structures are loose
- **Production bugs** caused by runtime type mismatches
- **Technical debt** that compounds over time
- **Developer frustration** from dealing with type chaos

**EVERY TYPE SHORTCUT COSTS MORE TIME THAN DOING IT RIGHT THE FIRST TIME.**

### 🆘 Emergency ESLint Recovery Procedure (For Communique Integration)

**If you encounter >100 ESLint errors in Communique codebase:**

1. **STOP IMMEDIATELY** - Don't try to fix them manually
2. **Revert to last known good commit**: `git reset --hard HEAD~1`
3. **Run `npm run lint` to verify 0 errors**
4. **Make smaller, incremental changes**
5. **Test each change with `npm run lint` before proceeding**

**Never attempt mass automated fixes. They create more problems than they solve.**

### 🎯 ZERO EXCEPTIONS POLICY 🎯
**No matter who you are, no matter how "urgent" the feature:**
- **No temporary `any` types** - There is no such thing as "temporary"
- **No "quick fixes" with type suppression** - Fix the actual issue
- **No "I'll fix it later" type violations** - Fix it now or don't commit
- **No "it's just a test" exceptions** - Tests must be strictly typed too
- **No "Web3 is hard to type" excuses** - Use proper Web3 type libraries

**Remember: We're building financial infrastructure that handles real money. Type safety isn't negotiable.**

## Key Development Concepts

### Compliance Posture
- **CLARITY Act Digital Commodity**: VOTER tokens qualify as digital commodities under federal framework - value derives from network utility, not expectation of profit from management efforts
- **Bright-line rules**: We never reward voting, registering to vote, or choosing candidates. We reward the verifiable work of contacting representatives.
- **Utility-first design**: VOTER tokens serve governance and platform utility, not vote buying
- **Privacy-preserving**: Zero PII on-chain; off-chain KYC/attestations only where legally required
- **Democratic authenticity**: Clear separation between verified participation records and economic incentives

In a world where the President's memecoin cleared $40B on inauguration day, compensating civic labor makes us competitive while we build on emerging regulatory clarity. The CLARITY Act provides the regulatory framework we need.

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

**NOTE**: All smart contract implementations live in the Communique repository. This repo contains strategic vision and architecture documentation.

### Settlement Infrastructure
- **Scroll zkEVM**: Primary settlement layer for on-chain state ($0.135/action, 5 sec finality)
- **NEAR Chain Signatures**: Universal account layer enabling multi-chain expansion without custom bridges
- **Registry Architecture**: IPFS CIDs for content storage, on-chain attestations for verification
- **ERC-8004 Registries**: Portable reputation and credibility attestations

### Contract Primitives (Implemented in Communique)
- **Token Economics**: ERC-20 governance with staking and voting extensions
- **Challenge Markets**: Chainlink Functions orchestrating multi-model consensus
- **Outcome Markets**: Gnosis CTF + UMA Optimistic Oracle integration
- **Retroactive Funding**: Gitcoin Allo Protocol for impact-based allocation
- **Multi-sig Governance**: Emergency controls and parameter boundaries

### Multi-Chain Strategy
- **Ethereum-primary approach**: Scroll L2 for primary settlement
- **NEAR Chain Signatures**: One account controls addresses on ALL ECDSA/Ed25519 chains
- **No custom bridges**: Native multi-chain via NEAR's MPC network (300x capacity Feb 2025)
- **Treasury management**: ETH L2 Safe multi-sig, no routine bridging required

## Development Notes

- **Implementation Location**: All smart contract code lives in Communique repository
- **Deployment**: Multi-sig governance for production deployments on Scroll L2
- **Testing**: Comprehensive test suite covering security, economics, and governance
- **Architecture Reference**: See ARCHITECTURE.md for complete technical architecture

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
- **Infrastructure ready**: Scroll L2 (Stage 1 decentralized), NEAR Chain Signatures (universal accounts), Didit.me (free identity), ERC-8004 (AI-human coordination)

### VOTER's 2025 Advantages
- **Multi-chain from day one**: NEAR Chain Signatures enable Ethereum + Bitcoin + Solana with zero custom bridges
- **Zero-cost identity**: Free forever verification removes the largest barrier to authentic participation
- **First democracy protocol** that competes for attention in the memecoin economy while delivering authentic civic impact
- **AI-verified authenticity**: 20-model consensus via Chainlink Functions for trustless verification at scale

**Infrastructure advantage**: We're building the rails everyone else needs—Ethereum-native settlement with universal multi-chain expansion.

## Documentation Structure

**Architecture Documentation**:
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Complete technical architecture covering all systems: Scroll + NEAR + Outcome Markets + Challenge Markets + Template Impact Correlation + Retroactive Funding with full implementations
- **[README.md](README.md)** - Project vision, user journey, and getting started guide

**NOTE**: All smart contract implementations and agent code live in the separate Communique repository. This repo contains strategic vision and architecture documentation only.

## Current Development Status

### Recently Completed
- **VOTER Protocol Integration**: Complete token system with Records (non-transferable civic proof) and Tokens (tradeable governance)
- **Rate Limiting Fix**: First-time users can now perform actions (fixed minActionInterval check)
- **OPERATOR_ROLE Removal**: Eliminated centralized minting vulnerability
- **Parameter Safety**: Implemented min/max bounds and daily caps in AgentParameters
- **Multi-sig Verification**: ActionVerifierMultiSig with threshold signatures

### Immediate Priorities
1. **CWC Integration**: Complete congressional message verification system with actual API calls
2. **Identity Verification**: Implement Didit KYC with congressional district verification
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