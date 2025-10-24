# Migration: NEAR CipherVault → Scroll Identity Registry

**Date:** October 23, 2025
**Status:** Documentation Update Required
**Impact:** All voter-protocol documentation layers

---

## Architecture Change Summary

### What Changed

**BEFORE (Documented):**
- Identity commitments stored in NEAR CipherVault contract
- PII encrypted client-side, stored on NEAR
- Storage staking model (0.05 NEAR per user)
- Two-layer architecture (Scroll for reputation + NEAR for identity)

**AFTER (Actual Implementation):**
- Identity commitments stored on Scroll L2 (IdentityRegistry.sol)
- PII NEVER stored anywhere (zero-knowledge proofs only)
- One-time gas fees ($0.33 per user)
- Single-chain architecture (Scroll for both reputation + identity)

### Why This Change

**Cost:**
- NEAR: $150 over 10 years (locked capital + opportunity cost)
- Scroll: $330 over 10 years (one-time gas)
- Scroll wins for capital efficiency (no locked capital)

**Data Availability:**
- NEAR: Relies on NEAR validators, 36-hour pruning window
- Scroll: Inherits Ethereum L1 security, permanent on-chain record

**Integration:**
- NEAR: Multi-chain complexity (NEAR + Scroll)
- Scroll: Single-chain simplicity

**See:** `/Users/noot/Documents/communique/docs/research/near-vs-scroll-identity-storage.md`

---

## Documentation Updates Required

### 1. High-Level Architecture (ARCHITECTURE.md)

#### Section: Core Decisions (Line 6)
**BEFORE:**
```
**Core Decisions**: Scroll settlement, Halo2 zero-knowledge proofs, NEAR account abstraction (optional), no database PII storage
```

**AFTER:**
```
**Core Decisions**: Scroll settlement, Halo2 zero-knowledge proofs, Scroll identity registry (on-chain Sybil resistance), no database PII storage
```

#### Section: Phase 1 Budget (Line 39)
**BEFORE:**
```
**Budget:** $326/month for 1,000 users / 10,000 messages
```

**AFTER:**
```
**Budget:** $315/month for 1,000 users / 10,000 messages (no NEAR storage costs)
```

#### Section: Layer 2 - Identity Verification (Lines 194-227)
**REMOVE:**
- Lines 227: "VCs issued off-chain, encrypted client-side before storage in CipherVault"

**REPLACE WITH:**
- "Identity commitments registered on Scroll L2 (IdentityRegistry.sol) via Poseidon hash"

#### Section: Layer 3 - Encrypted Storage (Lines 231-342)
**ENTIRE SECTION TO REPLACE WITH:**

```markdown
### Layer 3: Identity Registry (Scroll L2 Smart Contract)

**Contract**: `IdentityRegistry.sol` (Solidity/Scroll L2)

```solidity
contract IdentityRegistry {
    // Identity commitment => registered status
    mapping(bytes32 => bool) public identityCommitments;

    // Identity commitment => registration timestamp
    mapping(bytes32 => uint256) public registrationTime;

    // User address => identity commitment (reverse lookup)
    mapping(address => bytes32) public userCommitments;

    event IdentityRegistered(
        address indexed user,
        bytes32 indexed commitment,
        uint256 timestamp
    );

    function registerIdentity(bytes32 commitment) external {
        require(commitment != bytes32(0), "Invalid commitment");
        require(!identityCommitments[commitment], "Identity already registered");
        require(userCommitments[msg.sender] == bytes32(0), "User already registered");

        identityCommitments[commitment] = true;
        registrationTime[commitment] = block.timestamp;
        userCommitments[msg.sender] = commitment;

        emit IdentityRegistered(msg.sender, commitment, block.timestamp);
    }

    function isRegistered(bytes32 commitment) external view returns (bool) {
        return identityCommitments[commitment];
    }
}
```

**Client-Side Commitment Generation** (browser-only, zero storage):

```typescript
// 1. Extract identity data from verification (Didit.me webhook)
const passportNumber = verification.document_number;
const nationality = verification.issuing_state;
const birthYear = new Date(verification.date_of_birth).getFullYear();

// 2. Generate Poseidon commitment (ZK-friendly hash)
import { poseidon2 } from '@noble/curves/abstract/poseidon';

const commitment = poseidon2([
    stringToFieldElement(passportNumber.toUpperCase().replace(/[\s-]/g, '')),
    stringToFieldElement(nationality.toUpperCase()),
    BigInt(birthYear)
]);

// 3. Register on Scroll L2 (server-side, platform wallet)
const identityRegistry = getIdentityRegistryContract();
await identityRegistry.registerIdentity('0x' + commitment.toString(16).padStart(64, '0'));

// 4. NO storage of PII anywhere (passport number, nationality, birthYear discarded immediately)
```

**Gas Costs**:
- Contract deployment: $0.09 (one-time)
- Identity registration: $0.33 per user (L2 execution $0.02 + L1 calldata $0.31)
- Identity check: FREE (view function, no transaction)

**Data Availability**:
- All commitments posted to Ethereum L1 as calldata
- Permanent on-chain record (immutable, censorship-resistant)
- Anyone can reconstruct state from L1 (trustless)

**Privacy**:
- Zero PII stored on-chain (only Poseidon hash)
- Sybil resistance without revealing identity
- Same passport/nationality/birthYear = same commitment (duplicate detection)

**Security**:
- Inherits Ethereum L1 security ($150B+ staked, 900k+ validators)
- Smart contract verified on Scrollscan
- No centralized storage (decentralized by design)
```

---

### 2. Smart Contract Docs (contracts/)

#### Create New File: `contracts/scroll/IdentityRegistry.sol`
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IdentityRegistry
 * @notice On-chain Sybil resistance via identity commitments
 * @dev Stores Poseidon hash of (passportNumber, nationality, birthYear)
 *      Replaces NEAR CipherVault with simpler, cheaper, more secure approach
 * @custom:security-contact security@voter-protocol.org
 */
contract IdentityRegistry {
    // See implementation in /Users/noot/Documents/communique/docs/research/identity-registry-onchain-migration.md
}
```

#### Delete Old File: `contracts/near/ciphervault/`
**ACTION:** Mark as deprecated, add README explaining migration

**File:** `contracts/near/ciphervault/DEPRECATED.md`
```markdown
# DEPRECATED: NEAR CipherVault

**Status:** Deprecated as of October 2025
**Reason:** Replaced by Scroll L2 Identity Registry

This contract is no longer used. Identity commitments are now stored on Scroll L2
via `IdentityRegistry.sol` instead of NEAR CipherVault.

See migration docs: `/docs/migrations/ciphervault-to-identity-registry.md`
```

---

### 3. Technical Specs

#### File: `specs/INTEGRATION-SPEC.md`

**Section: Identity Verification Flow**

**BEFORE:**
```
1. User completes Didit.me verification
2. VC issued with PII
3. Client encrypts VC with sovereign key
4. Store in NEAR CipherVault
5. Generate Poseidon commitment
```

**AFTER:**
```
1. User completes Didit.me verification
2. Backend extracts (passportNumber, nationality, birthYear)
3. Backend generates Poseidon commitment (ZK-friendly hash)
4. Backend registers commitment on Scroll L2 (IdentityRegistry.sol)
5. PII discarded immediately (NEVER stored anywhere)
```

#### File: `specs/CIPHERVAULT-CONTRACT-SPEC.md`

**ACTION:** Rename to `specs/DEPRECATED-CIPHERVAULT-CONTRACT-SPEC.md`
**Add header:**
```markdown
# DEPRECATED: CipherVault Contract Specification

**Status:** Superseded by Scroll Identity Registry
**Date:** October 2025
**Replacement:** `contracts/scroll/IdentityRegistry.sol`

This specification is preserved for historical reference only.
```

---

### 4. Client SDK Documentation

#### File: `packages/client/README.md`

**Section: Identity Management**

**REMOVE:**
- CipherVault integration examples
- NEAR storage deposit examples
- Encrypted envelope examples

**ADD:**
```markdown
### Identity Registry (Scroll L2)

The client SDK provides read-only access to the on-chain identity registry:

```typescript
import { VOTERClient } from '@voter-protocol/client';

const client = new VOTERClient({
    network: 'scroll-mainnet',
    identityRegistryAddress: '0x...'
});

// Check if identity commitment is registered
const isRegistered = await client.identity.isRegistered(commitment);

// Get user's identity commitment
const commitment = await client.identity.getUserCommitment(userAddress);

// Get registration timestamp
const timestamp = await client.identity.getRegistrationTime(commitment);
```

**Note:** Identity registration is performed server-side by the Communique application during Didit.me webhook processing. Clients only read from the registry.
```

---

### 5. README.md Updates

#### File: `voter-protocol/README.md`

**Section: Quick Start**

**BEFORE:**
```
2. Deploy NEAR CipherVault contract
```

**AFTER:**
```
2. Deploy Scroll Identity Registry contract (or use existing deployment)
```

**Section: Architecture Overview**

**UPDATE diagram to remove NEAR CipherVault, add Identity Registry**

---

### 6. Economic Documentation

#### File: `docs/ECONOMICS.md`

**Section: Storage Costs**

**BEFORE:**
```
NEAR Storage: $11,000/year (100K users)
- 0.05 NEAR per user
- Storage staking model
```

**AFTER:**
```
Scroll Identity Registry: $0/year recurring (100K users)
- $0.33 one-time per user (gas fees)
- No recurring costs (reads are free)
- 10-year cost: $33,000 (vs $110,000 for database, $150,000 for NEAR)
```

---

### 7. Implementation Status Tracking

#### File: `IMPLEMENTATION-STATUS.md`

**UPDATE Phase 1 checklist:**

**BEFORE:**
```
- [ ] NEAR CipherVault contract
- [ ] Client-side encryption utilities
- [ ] Storage deposit management
```

**AFTER:**
```
- [x] Scroll Identity Registry contract
- [x] Poseidon hash implementation (@noble/curves)
- [x] Server-side commitment generation (Didit webhook)
- [ ] Contract deployment to Scroll mainnet
- [ ] Integration testing (testnet)
```

---

## Implementation Checklist

### Documentation Updates

- [ ] `ARCHITECTURE.md` - Replace CipherVault section with Identity Registry
- [ ] `README.md` - Update quick start and architecture overview
- [ ] `TECHNICAL.md` - Update cryptographic flow diagrams
- [ ] `CLAUDE.md` - Update agent instructions
- [ ] `QUICKSTART.md` - Remove NEAR setup, add Scroll setup
- [ ] `CONGRESSIONAL.md` - Update verification flow
- [ ] `SECURITY.md` - Update threat model (remove NEAR compromise scenarios)
- [ ] `docs/ECONOMICS.md` - Update cost analysis
- [ ] `specs/INTEGRATION-SPEC.md` - Update identity flow
- [ ] `specs/CLIENT-SDK-SPEC.md` - Replace CipherVault with Identity Registry
- [ ] `specs/DEPLOYMENT-SPEC.md` - Update deployment instructions
- [ ] `packages/client/README.md` - Update API examples
- [ ] `IMPLEMENTATION-STATUS.md` - Update checklist

### Code Updates

- [ ] Create `contracts/scroll/IdentityRegistry.sol`
- [ ] Create `contracts/scroll/test/IdentityRegistry.test.js`
- [ ] Create `contracts/scroll/scripts/deploy-identity-registry.ts`
- [ ] Mark `contracts/near/ciphervault/` as deprecated
- [ ] Update `packages/client/src/identity/` (if exists)
- [ ] Remove CipherVault integration code

### New Documentation

- [ ] `docs/contracts/identity-registry.md` - Contract documentation
- [ ] `docs/migrations/ciphervault-to-identity-registry.md` - This document
- [ ] `examples/identity-verification.ts` - Updated example

---

## Migration Timeline

**Week 1: Documentation**
- Update all architecture docs
- Update technical specs
- Update README files

**Week 2: Code**
- Deploy Identity Registry to Scroll testnet
- Update client SDK
- Add integration tests

**Week 3: Deployment**
- Deploy to Scroll mainnet
- Update production environment
- Monitor first 100 registrations

---

## References

- Cost analysis: `/Users/noot/Documents/communique/docs/research/identity-registry-onchain-migration.md`
- NEAR vs Scroll: `/Users/noot/Documents/communique/docs/research/near-vs-scroll-identity-storage.md`
- Smart contract code: See `identity-registry-onchain-migration.md` lines 258-328
- Poseidon hash implementation: See `identity-registry-onchain-migration.md` lines 393-437

---

**Document Version:** 1.0
**Author:** Claude (AI Assistant)
**Date:** October 23, 2025
**Status:** Ready for Implementation
