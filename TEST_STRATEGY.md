# VOTER Protocol Test Strategy

## Current Problems
- Tests broken after security refactor (wrong constructors)
- Fragmented coverage with no integration tests
- Redundant mocks across multiple files
- Missing critical security feature tests

## New Testing Architecture

### 1. Core Test Infrastructure (`test/shared/`)

#### `TestBase.sol`
- Unified setup for all tests
- Deploys Phase 3 infrastructure (AIModelRegistry, ConsensusEngine, etc.)
- Provides helper functions for common operations
- Single source of truth for test configuration

#### `Mocks.sol`
- Centralized mock contracts
- MockConsensusEngine, MockModelRegistry, MockDiditVerifier
- Consistent behavior across all tests

#### `Constants.sol`
- Test addresses, amounts, timings
- Reusable test data
- Network fork settings

### 2. Unit Test Suite (`test/unit/`)

#### Security Tests (PRIORITY)
- `CircuitBreaker.t.sol` - Attack prevention without admins
- `AgentConsensus.t.sol` - TEE verification, model attestation
- `ImmutableBounds.t.sol` - Parameter safety rails
- `Timelock.t.sol` - 48-hour delay enforcement

#### Core Protocol Tests
- `VOTERToken.t.sol` - Token mechanics with consensus minting
- `VOTERRegistry.t.sol` - Identity and action registration
- `ChallengeMarket.t.sol` - Quadratic staking, AI arbitration
- `TreasuryManager.t.sol` - Spending limits, emergency reserves

### 3. Integration Test Suite (`test/integration/`)

#### User Journeys
- `CitizenJourney.t.sol` - Complete flow from registration to rewards
- `TemplateCreation.t.sol` - Create, use, challenge, reward flow
- `ConsensusDecision.t.sol` - Multi-agent decision making
- `ChallengeResolution.t.sol` - Full challenge lifecycle

#### Attack Scenarios
- `SybilAttack.t.sol` - Test sybil resistance
- `FlashLoanAttack.t.sol` - Economic attack prevention
- `ConsensusManipulation.t.sol` - Agent collusion prevention
- `ParameterExploit.t.sol` - Bounded parameter manipulation

### 4. Invariant Test Suite (`test/invariant/`)

#### Mathematical Properties
- `QuadraticInvariant.t.sol` - sqrt(stake) always beats linear
- `TreasuryInvariant.t.sol` - Emergency reserves never decrease
- `ConsensusInvariant.t.sol` - No single agent dominance
- `CircuitBreakerInvariant.t.sol` - Attacks always blocked

### 5. Fork Test Suite (`test/fork/`)

#### Mainnet Integration
- `MonadFork.t.sol` - Deploy and test on Monad testnet
- `OracleFork.t.sol` - Real price feed integration
- `BrightIDFork.t.sol` - Actual identity verification

## Test Patterns

### Setup Pattern
```solidity
contract VOTERTokenTest is TestBase {
    function setUp() public override {
        super.setUp(); // Deploys all infrastructure
        // Test-specific setup
    }
}
```

### Consensus Pattern
```solidity
function test_RequiresConsensus() public {
    bytes32 proof = mockConsensus.generateProof(action);
    vm.expectRevert("Agent consensus required");
    contract.criticalFunction(params);
    
    mockConsensus.approve(proof);
    contract.criticalFunction(params, proof);
    // Assert success
}
```

### Timelock Pattern
```solidity
function test_TimelockEnforcement() public {
    uint256 proposalId = contract.proposeChange(newValue);
    
    vm.expectRevert("Timelock not expired");
    contract.executeChange(proposalId);
    
    vm.warp(block.timestamp + 48 hours);
    contract.executeChange(proposalId);
    // Assert success
}
```

### Circuit Breaker Pattern
```solidity
function test_CircuitBreakerHaltsAttack() public {
    // Simulate attack pattern
    for (uint i = 0; i < 51; i++) {
        vm.expectRevert("Circuit breaker triggered");
        contract.rapidAction(largeAmount);
    }
}
```

## Coverage Goals

### Critical Coverage (MUST HAVE)
- [ ] 100% coverage on security features (circuit breakers, bounds)
- [ ] 100% coverage on consensus requirements
- [ ] 100% coverage on timelock mechanisms
- [ ] Attack scenario coverage

### Standard Coverage
- [ ] 80%+ line coverage on core contracts
- [ ] All happy paths tested
- [ ] All revert conditions tested
- [ ] Gas optimization benchmarks

## Testing Commands

```bash
# Run all tests
forge test

# Run security tests only
forge test --match-path test/unit/security/**

# Run with coverage
forge coverage

# Run invariant tests
forge test --match-path test/invariant/**

# Run fork tests
forge test --fork-url $MONAD_RPC

# Gas report
forge test --gas-report
```

## Migration Plan

1. **Phase 1: Infrastructure** (Immediate)
   - Create TestBase.sol with proper constructors
   - Consolidate mocks into shared/Mocks.sol
   - Fix compilation errors

2. **Phase 2: Critical Tests** (Week 1)
   - Security feature tests
   - Consensus mechanism tests
   - Circuit breaker tests

3. **Phase 3: Integration** (Week 2)
   - User journey tests
   - Attack scenario tests
   - Cross-contract flows

4. **Phase 4: Advanced** (Week 3)
   - Invariant testing
   - Fork testing
   - Gas optimization

## Success Metrics

- Zero failing tests
- No TODO or DISABLED tests
- 80%+ coverage on critical paths
- All attack vectors tested
- Sub-3 minute test suite runtime