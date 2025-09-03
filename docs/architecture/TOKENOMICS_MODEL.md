# Token Model: VOTER Records + CIVIC

## Executive Summary

We separate authentic participation from incentives, with all verification receipts anchored on Monad (hashes only; no PII). Optionally mirror to an ETH L2 (ERC‑8004 registries) when partners need on‑chain reads.

Sources: [ERC‑8004](https://github.com/ethereum/ERCs/blob/master/ERCS/erc-8004.md), [Monad docs](https://docs.monad.xyz)

## The Two-Token System

### VOTER Records (Non‑Transferable)
- **Purpose**: Immutable proof of verified civic action
- **Properties**: Non-transferable, soul-bound, permanent
- **Creation**: 1:1 with verified civic actions (CWC messages, direct action campaigns)
- **Function**: Reputation, verification, historical record

### CIVIC Tokens (Tradeable)
- **Purpose**: Platform governance and economic incentives
- **Properties**: ERC-20 compatible, tradeable, stakeable
- **Creation**: Minted per verified civic action (10 CIVIC per congressional message, configurable per action type)
- **Function**: Governance voting and rewards distribution

## Token Economics

### VOTER Record Creation
```
Verified Action → VOTER Record (Non-transferable) + CIVIC Tokens (10 per action, configurable)
```

**Eligible Actions (examples):**
- Certified legislative submissions (via adapters)
- Direct outreach (mailto‑based)
- Community organizing/advocacy with verifiable receipts

**Verification Requirements (policy‑driven):**
- Identity/address attestation (when required by adapter)
- Action authenticity (submission receipts, mail routing receipts)
- Anti‑spam measures (rate limits, quality scoring)

### CIVIC Token Utility

**Governance Power:**
- Vote on platform features and policies
- Approve new action types for VOTER record creation
- Decide on fee structures and reward distributions
- Select community moderators and validators

**Economic Benefits:**
- Access to premium features (analytics, bulk messaging tools)
- Staking rewards from protocol revenue distribution
- Priority access to new features and campaigns

**Network Effects:**
- Social credibility through verified civic history
- Community building around shared causes
- Cross-platform integration with civic organizations

## Market Positioning

### Compliance posture
- Utility‑first design; clear functional purpose
- Minimal on‑chain data; off‑chain KYC when legally required

### Competitive Advantages
- Verifiable participation receipts anchored on Monad
- UX mirrors email; zero lift for end users
- Optional L2 ERC‑8004 mirror for ETH‑native composability

## Technical Implementation

### Smart Contract Architecture
```solidity
contract VOTERRegistry {
    // Non-transferable civic action records
    mapping(address => VOTERRecord[]) public civicHistory;
    
    struct VOTERRecord {
        uint256 timestamp;
        ActionType actionType;
        bytes32 actionHash;
        bool verified;
    }
}

contract CIVICToken is ERC20, ERC20Votes {
    // Tradeable governance token
    // Earned through verified civic actions
    // Used for platform governance
}
```

### Integration Points
- **CWC API** for congressional message verification
- **Identity providers** for KYC/address verification  
- **Social platforms** for civic action sharing
- **DeFi protocols** for CIVIC token liquidity and yield

## Growth Strategy

### Phase 1: Foundation (Months 1‑6)
- Deploy Monad contracts: Registry, Attest
- Ship certified adapter (e.g., CWC) + mail routing receipts
- Launch with verified civic actors; “Verify on‑chain” links

### Phase 2: Growth (Months 6‑12)
- Gamification/leaderboards; referrals
- Optional L2 ERC‑8004 mirror for registries if partners require reads

### Phase 3: Ecosystem (Months 12‑24)
- Additional adapters (other legislatures)
- Partnerships; global expansion

## Risk Mitigation

### Regulatory Compliance
- Legal review of token structure
- AML/KYC implementation
- Data privacy protection (GDPR, CCPA)

### Technical Security
- Smart contract audits
- Multi-sig governance
- Emergency pause mechanisms

### Economic Stability
- Anti-whale mechanisms (voting power caps)
- Gradual token release schedules
- Treasury diversification

## Success Metrics

### User Engagement
- Monthly active verified civic actors
- Messages sent through CWC integration
- Direct action campaigns launched

### Token Performance
- CIVIC token trading volume
- Governance participation rates
- VOTER record creation velocity

### Democratic Impact
- Policy outcomes influenced
- Representative response rates
- Media coverage and awareness

## Conclusion

The hybrid token model positions Communiqué at the intersection of digital economic incentives and the growing demand for authentic democratic participation. By separating proof-of-civic-engagement from pure speculation, we create sustainable incentives for verified political action while building a platform that can scale to millions of users in the post-GENIUS Act regulatory environment.

This isn't just another governance token—it's the foundation for tokenizing democracy itself.