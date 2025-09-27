# QuadraticStaking Library

A comprehensive quadratic stake calculation library for the VOTER Protocol that implements true quadratic scaling with sophisticated anti-plutocracy mechanisms.

## Overview

The QuadraticStaking library prevents wealthy actors from dominating challenge markets through a sophisticated multi-factor calculation system that:

- **Prevents Plutocracy**: Exponential stake scaling based on wealth
- **Rewards Authentic Participation**: Lower stakes for earned vs purchased tokens
- **Recognizes Expertise**: Domain-specific expertise multipliers
- **Penalizes Spam**: Progressive penalties for failed challenges  
- **Scales with Impact**: Higher stakes for broader-scope claims

## Core Features

### 1. True Quadratic Scaling
```solidity
// Base stake increases with sqrt(challengeCount + 1)
baseStake * sqrt(challengeCount + 1) * QUADRATIC_BASE
```

### 2. Wealth-Based Penalties
- **10K+ VOTER**: 1.2x multiplier
- **100K+ VOTER**: 2.0x multiplier  
- **1M+ VOTER**: 4.0x multiplier
- **10M+ VOTER**: 8.0x+ exponential scaling

### 3. Token Source Discrimination
- **80%+ Earned**: 20% bonus (0.8x multiplier)
- **30-80% Earned**: Neutral (1.0x multiplier)
- **<30% Earned**: 3x penalty for purchased tokens

### 4. Challenge History Factors
- New users: 0.5x minimum multiplier
- Successful challengers: Up to 2.0x maximum
- Failed challenges: 5% decay per failure

### 5. Domain Expertise
- Novices (0-500 score): 0.7x multiplier  
- Intermediate (500-800): 1.0-2.5x scaling
- Experts (800-1000): 2.5x maximum multiplier

### 6. Impact Scaling
- **Local**: 1.0x base
- **Regional**: 1.5x base
- **National**: 2.5x base  
- **Global**: 5.0x base
- Plus complexity multiplier (1.0-1.5x)

## Integration Guide

### Basic Integration

```solidity
import "./libraries/QuadraticStaking.sol";

contract ChallengeMarket {
    using QuadraticStaking for QuadraticStaking.UserProfile;
    
    mapping(address => QuadraticStaking.UserProfile) userProfiles;
    
    function calculateStakeForChallenge(
        address user,
        bytes32 domain,
        uint256 baseStake,
        QuadraticStaking.ClaimScope scope,
        uint256 complexity
    ) public view returns (uint256 requiredStake) {
        QuadraticStaking.UserProfile storage profile = userProfiles[user];
        
        QuadraticStaking.ChallengeContext memory context = QuadraticStaking.ChallengeContext({
            domain: domain,
            scope: scope,
            baseStakeAmount: baseStake,
            claimComplexity: complexity,
            isCounterChallenge: false
        });
        
        QuadraticStaking.StakeCalculation memory calc = 
            QuadraticStaking.calculateStake(profile, context);
            
        return calc.cappedStake;
    }
}
```

### Advanced Integration with Profile Management

Use `QuadraticStakingIntegration.sol` for complete user profile management:

```solidity
// Deploy integration contract
QuadraticStakingIntegration stakingContract = new QuadraticStakingIntegration(voterTokenAddress);

// Register domains
stakingContract.registerDomain("politics", "Political discourse", 600);

// Update user profiles
stakingContract.updateUserProfile(user, reputationScore);
stakingContract.updateDomainExpertise(user, domainHash, expertiseScore);

// Calculate stakes
uint256 requiredStake = stakingContract.previewStakeRequirement(
    user, domainHash, baseStake, scope, complexity
);
```

## Key Functions

### Core Calculation
- `calculateStake()`: Complete stake calculation with all factors
- `previewStakeCalculation()`: Preview without state modifications
- `getStakeBreakdown()`: Detailed breakdown for transparency

### Utility Functions
- `getWealthTiers()`: Current wealth tier thresholds
- `getWealthMultipliers()`: Multipliers for each tier
- `getStakeCaps()`: Min/max stake limits

## Security Considerations

### Safety Caps
- **Minimum Stake**: 10 VOTER prevents dust attacks
- **Maximum Stake**: 1M VOTER prevents system lockup
- **Balance Constraint**: Never exceed user's token balance

### Overflow Protection
- All calculations use SafeMath principles
- Bounded parameter ranges prevent edge cases
- Precision scaling maintains accuracy

### Anti-Gaming Measures
- Quadratic scaling prevents volume attacks
- Wealth penalties discourage plutocracy
- Token source tracking prevents wash trading
- Challenge history creates long-term incentives

## Gas Optimization

The library is optimized for gas efficiency:
- View functions for pre-calculation
- Minimal storage reads during calculation  
- Efficient sqrt implementation
- Bounded loops and operations

Typical gas usage: ~30,000-50,000 gas per calculation

## Testing

Comprehensive test suite in `QuadraticStaking.t.sol`:
- Unit tests for each factor
- Integration tests with realistic scenarios
- Edge case and security tests
- Fuzz testing for invariant checking
- Gas efficiency benchmarks

Run tests:
```bash
forge test --match-contract QuadraticStakingTest -vvv
```

## Example Calculations

### Small Holder (1K VOTER, 80% earned, new user)
- Base: 100 VOTER
- Wealth: 1.0x (no penalty)
- Token Source: 0.8x (earned bonus)
- History: 0.5x (new user)
- Expertise: 0.7x (novice)
- Impact: 1.0x (local)
- **Final: ~28 VOTER**

### Whale (5M VOTER, 40% earned, experienced)  
- Base: 100 VOTER
- Wealth: 8.0x+ (whale penalty)
- Token Source: 1.0x (mixed)
- History: 1.5x (good record)
- Expertise: 1.0x (average)
- Impact: 1.0x (local)
- **Final: ~1,200+ VOTER**

### Expert (20K VOTER, 75% earned, domain expert)
- Base: 100 VOTER  
- Wealth: 1.2x (small penalty)
- Token Source: 0.8x (earned bonus)
- History: 1.8x (excellent record)
- Expertise: 2.5x (expert bonus)
- Impact: 1.0x (local)
- **Final: ~432 VOTER**

## Integration with ChallengeMarket

To integrate with the existing ChallengeMarket contract:

1. **Import the library**:
```solidity
import "./libraries/QuadraticStaking.sol";
```

2. **Add user profile storage**:
```solidity
mapping(address => QuadraticStaking.UserProfile) public userProfiles;
```

3. **Update stake calculation in `createChallenge()`**:
```solidity
function createChallenge(/* parameters */) external {
    // Calculate required stake using quadratic formula
    uint256 requiredStake = _calculateQuadraticStake(
        msg.sender, domain, challengerStake, scope, complexity
    );
    
    require(voterToken.balanceOf(msg.sender) >= requiredStake, "Insufficient balance");
    // ... rest of challenge creation
}
```

4. **Add profile management functions** for reputation updates, domain expertise, and challenge result tracking.

The library provides complete backward compatibility while adding sophisticated anti-plutocracy mechanisms that make the VOTER Protocol's challenge markets truly democratic and resistant to economic attacks.