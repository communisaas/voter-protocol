# Consolidated Mock Contracts for VOTER Protocol Testing

This directory contains comprehensive mock contracts for testing the VOTER Protocol. All mocks have been consolidated into a single `Mocks.sol` file for better maintainability and consistency.

## Overview

The `Mocks.sol` file provides mock implementations for all major interfaces used in the VOTER Protocol, including both existing contracts and new Phase 3 infrastructure.

## Available Mock Contracts

### Core Infrastructure Mocks

#### MockAggregator
Mock implementation of Chainlink price aggregators for testing oracle functionality.

**Features:**
- Configurable price answers
- Forced revert functionality for error testing
- Call count tracking
- Realistic price feed behavior

**Usage:**
```solidity
MockAggregator oracle = new MockAggregator(200000000000, 8); // $2000 ETH, 8 decimals
oracle.setAnswer(300000000000); // Change price to $3000
oracle.setShouldRevert(true); // Force next call to revert
```

#### MockActionVerifier
Mock implementation of `IActionVerifier` for testing action verification logic.

**Features:**
- Configurable verification results per action hash
- Default behavior setting
- Failure simulation
- Call tracking with both view and non-view versions

**Usage:**
```solidity
MockActionVerifier verifier = new MockActionVerifier();
bytes32 actionHash = keccak256("test_action");

verifier.setVerified(actionHash, false); // Set specific action to fail
verifier.setDefaultVerificationResult(true); // Set default behavior
bool result = verifier.isVerifiedAction(actionHash); // View call
bool tracked = verifier.isVerifiedActionWithTracking(actionHash); // With tracking
```

#### MockDiditVerifier
Mock implementation of `IDiditVerifier` for testing identity verification.

**Features:**
- Configurable credential validity
- Custom attestation setting
- Revocation management
- KYC level support
- Cost simulation

**Usage:**
```solidity
MockDiditVerifier didit = new MockDiditVerifier();

// Set custom attestation
IDiditVerifier.Attestation memory attestation = IDiditVerifier.Attestation({
    isVerified: true,
    kycLevel: 2,
    districtHash: keccak256("CA-12"),
    verifiedAt: block.timestamp,
    credentialId: keccak256("user_credential")
});
didit.setAttestation(user, attestation);

// Configure credential validity
bytes32 credHash = keccak256("test_credential");
didit.setCredentialValidity(credHash, false);
```

#### MockAgentConsensus
Mock implementation of `IAgentConsensus` for testing agent consensus decisions.

**Features:**
- Configurable consensus results per action
- Default consensus behavior
- Failure simulation
- Call tracking

**Usage:**
```solidity
MockAgentConsensus consensus = new MockAgentConsensus();
bytes32 actionHash = keccak256("consensus_test");

consensus.setVerified(actionHash, true);
consensus.setDefaultConsensusResult(false);
```

### Phase 3 Mocks - Advanced Consensus Infrastructure

#### MockConsensusEngine
Mock implementation for multi-stage consensus processes.

**Features:**
- Proposal creation and execution simulation
- Stage management (PROPOSAL, RESEARCH, COMMITMENT, REVEAL, EXECUTION, etc.)
- Execution success/failure control
- Call tracking

**Usage:**
```solidity
MockConsensusEngine engine = new MockConsensusEngine();
bytes32 proposalHash = keccak256("test_proposal");

engine.createProposal(proposalHash, "Description", payload, target);
engine.setShouldFailExecution(proposalHash, false);
bool success = engine.executeConsensus(proposalHash);
```

#### MockModelRegistry
Mock implementation for AI model registration and attestation.

**Features:**
- Model registration simulation
- Provider and architecture tracking
- Active/inactive status management
- Registration failure simulation

**Usage:**
```solidity
MockModelRegistry registry = new MockModelRegistry();

registry.registerModel(
    modelAddress,
    MockModelRegistry.ModelProvider.OPENAI,
    "gpt-4",
    attestationData
);
registry.setModelStatus(modelAddress, true, true); // registered and active
```

#### MockPerformanceTracker
Mock implementation for AI model performance metrics.

**Features:**
- Performance metric tracking across domains
- Voting weight calculation
- Success/failure simulation
- Multi-dimensional performance data

**Usage:**
```solidity
MockPerformanceTracker tracker = new MockPerformanceTracker();

tracker.updatePerformance(
    modelAddress,
    MockPerformanceTracker.Domain.PARAMETER_OPTIMIZATION,
    true, // was correct
    850   // confidence
);
uint256 weight = tracker.getVotingWeight(modelAddress, domain);
```

#### MockCircuitBreaker
Mock implementation for emergency controls and circuit breaker patterns.

**Features:**
- User and action blocking
- Threshold-based blocking
- Emergency trigger simulation
- Reset functionality

**Usage:**
```solidity
MockCircuitBreaker breaker = new MockCircuitBreaker();

// Test normal operation
(bool blocked, string memory reason) = breaker.checkCircuitBreakers(
    user, 
    amount, 
    actionHash
);

// Trigger emergency
breaker.triggerCircuitBreaker("Emergency situation", user);
breaker.resetCircuitBreaker(user);
```

### MockFactory
Utility contract for deploying standard mock configurations.

**Features:**
- One-call deployment of all standard mocks
- Pre-configured realistic settings
- Separate deployment for Phase 3 mocks

**Usage:**
```solidity
MockFactory factory = new MockFactory();

// Deploy standard mocks
(
    MockAggregator chainlink,
    MockAggregator redstone,
    MockActionVerifier actionVerifier,
    MockDiditVerifier diditVerifier,
    MockAgentConsensus consensus
) = factory.deployStandardMocks();

// Deploy Phase 3 mocks
(
    MockConsensusEngine consensusEngine,
    MockModelRegistry modelRegistry,
    MockPerformanceTracker performanceTracker,
    MockCircuitBreaker circuitBreaker
) = factory.deployPhase3Mocks();
```

## Key Features

### 1. **Interface Compliance**
All mocks properly implement their respective interfaces with correct function signatures and state mutability.

### 2. **Configurable Behavior**
Every mock can be configured to simulate different scenarios:
- Success/failure conditions
- Specific return values
- Edge cases and error conditions

### 3. **Call Tracking**
Mocks provide both view and non-view versions of functions:
- View versions: Interface-compliant, gas-efficient
- Tracking versions: Include call counters for testing assertions

### 4. **Realistic Defaults**
All mocks come with sensible default values that work out of the box:
- Price oracles: $2000 ETH
- Verification: Default success
- KYC level: Basic (free)
- Performance: 80% success rate

### 5. **Comprehensive Coverage**
The mocks cover all major protocol components:
- Price feeds and oracles
- Identity verification
- Action verification
- Agent consensus
- AI model management
- Performance tracking
- Emergency controls

## Testing Patterns

### Basic Mock Usage
```solidity
import "./shared/Mocks.sol";

contract MyTest is Test {
    MockActionVerifier verifier;
    
    function setUp() public {
        verifier = new MockActionVerifier();
    }
    
    function test_ActionVerification() public {
        bytes32 action = keccak256("test");
        assertTrue(verifier.isVerifiedAction(action)); // Default: true
        
        verifier.setVerified(action, false);
        assertFalse(verifier.isVerifiedAction(action)); // Now: false
    }
}
```

### Factory Pattern Usage
```solidity
contract MyIntegrationTest is Test {
    MockFactory factory;
    MockActionVerifier actionVerifier;
    MockDiditVerifier diditVerifier;
    
    function setUp() public {
        factory = new MockFactory();
        (, , actionVerifier, diditVerifier, ) = factory.deployStandardMocks();
    }
    
    function test_IntegratedFlow() public {
        // Test with pre-configured mocks
        bytes32 action = keccak256("civic_action");
        assertTrue(actionVerifier.isVerifiedAction(action));
        
        address user = address(0x123);
        IDiditVerifier.Attestation memory attestation = diditVerifier.getAttestation(user);
        assertTrue(attestation.isVerified);
    }
}
```

### Advanced Configuration
```solidity
function test_ErrorConditions() public {
    // Test oracle failures
    MockAggregator oracle = new MockAggregator(2000e8, 8);
    oracle.setShouldRevert(true);
    
    vm.expectRevert("Mock aggregator: forced revert");
    oracle.latestRoundData();
    
    // Test circuit breaker triggers
    MockCircuitBreaker breaker = new MockCircuitBreaker();
    breaker.setUserBlocked(user, true);
    
    (bool blocked, string memory reason) = breaker.checkCircuitBreakers(user, 1000, action);
    assertTrue(blocked);
    assertEq(reason, "User blocked by circuit breaker");
}
```

## Migration from Old Mocks

If you have existing tests using individual mock contracts:

1. **Replace imports:**
   ```solidity
   // Old
   import "./MockDiditVerifier.sol";
   import "./MockActionVerifier.sol";
   
   // New
   import "./shared/Mocks.sol";
   ```

2. **Update contract references:**
   ```solidity
   // Old
   MockDiditVerifier didit = new MockDiditVerifier();
   
   // New
   MockDiditVerifier didit = new MockDiditVerifier();
   // (Same interface, consolidated implementation)
   ```

3. **Use factory for setup:**
   ```solidity
   // New approach
   MockFactory factory = new MockFactory();
   (, , actionVerifier, diditVerifier, ) = factory.deployStandardMocks();
   ```

## Benefits of Consolidation

1. **Maintainability**: Single source of truth for all mocks
2. **Consistency**: Unified patterns and interfaces
3. **Reusability**: Easy to share mocks across test files
4. **Performance**: Reduced compilation time
5. **Quality**: Comprehensive testing of mock functionality
6. **Documentation**: Centralized documentation and examples

## Phase 3 Readiness

The consolidated mocks include full support for Phase 3 infrastructure:
- AI model consensus mechanisms
- Performance tracking and reputation
- Advanced circuit breaker patterns
- Multi-stage consensus engines

This ensures your tests are ready for the advanced features being developed in Phase 3 of the VOTER Protocol.