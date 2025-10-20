# Communique Integration Specification

**Component:** VOTER Protocol ↔ Communique Integration
**Location:** `communique/src/lib/integrations/voter-protocol/`
**Status:** 📋 Day 6-9 Implementation

---

## Overview

This specification describes how Communique integrates with VOTER Protocol for encrypted PII storage, congressional delivery verification, and algorithmic reward distribution.

**Integration Points:**
1. **Authentication Flow** - NEAR account creation during OAuth
2. **PII Storage** - Encrypted envelope storage on CipherVault
3. **Congressional Delivery** - Verification and impact tracking
4. **Reward Distribution** - Automatic VOTER token rewards

**Related Specs:**
- [CIPHERVAULT-CONTRACT-SPEC.md](./CIPHERVAULT-CONTRACT-SPEC.md) - Contract storage
- [CRYPTO-SDK-SPEC.md](./CRYPTO-SDK-SPEC.md) - Encryption layer
- [CLIENT-SDK-SPEC.md](./CLIENT-SDK-SPEC.md) - NEAR client interface

---

## Architecture

```
┌──────────────────────────────────────────────┐
│  Communique Frontend (SvelteKit 5)          │
│  ┌────────────────────────────────────────┐  │
│  │ OAuth Flow → NEAR Account Creation    │  │
│  │ PII Collection → CipherVault Storage  │  │
│  │ Template Submission → Delivery Track  │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
                     ↓
┌──────────────────────────────────────────────┐
│  Integration Layer                           │
│  ┌────────────────────────────────────────┐  │
│  │ VoterProtocolService                   │  │
│  │ - createUserAccount()                  │  │
│  │ - storePII()                           │  │
│  │ - retrievePII()                        │  │
│  │ - trackDelivery()                      │  │
│  │ - calculateReward()                    │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
                     ↓
┌──────────────────────────────────────────────┐
│  VOTER Protocol Stack                        │
│  - @voter-protocol/client (NEAR client)     │
│  - @voter-protocol/crypto (encryption)      │
│  - CipherVault contract (testnet)           │
└──────────────────────────────────────────────┘
```

---

## Database Schema

### Prisma Schema Extensions

```prisma
model User {
  id                      String   @id @default(cuid())
  email                   String   @unique

  // Existing Communique fields
  firstName               String?
  lastName                String?
  streetAddress           String?
  city                    String?
  state                   String?
  zipCode                 String?
  congressionalDistrict   String?

  // VOTER Protocol fields
  nearAccountId           String?  @unique
  ciphervaultEnvelopeId   String?  @unique
  voterTokenAddress       String?  // Deterministic address for rewards

  // Timestamps
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt

  // Relations
  submissions             Submission[]
  rewards                 Reward[]
}

model Submission {
  id                      String   @id @default(cuid())
  userId                  String
  templateId              String

  // Congressional delivery tracking
  recipientOffices        String[] // Representative account IDs
  deliveryStatus          String   // "pending" | "delivered" | "failed"
  deliveryHash            String?  // Transaction hash (if on-chain)

  // VOTER Protocol verification
  verificationStatus      String?  // "pending" | "verified" | "rejected"
  impactScore             Float?   // 0.0 - 1.0 (calculated by agents)

  // Timestamps
  submittedAt             DateTime @default(now())
  verifiedAt              DateTime?

  // Relations
  user                    User     @relation(fields: [userId], references: [id])
  template                Template @relation(fields: [templateId], references: [id])
  reward                  Reward?

  @@index([userId])
  @@index([templateId])
}

model Reward {
  id                      String   @id @default(cuid())
  userId                  String
  submissionId            String   @unique

  // Reward calculation
  baseRewardUSD           Float    // Base reward in USD
  multipliers             Json     // { participation: 1.2, timeDecay: 0.9, ... }
  finalAmountVOTER        Float    // Calculated VOTER tokens

  // Distribution tracking
  distributionStatus      String   // "pending" | "distributed" | "failed"
  transactionHash         String?
  blockNumber             BigInt?

  // Timestamps
  calculatedAt            DateTime @default(now())
  distributedAt           DateTime?

  // Relations
  user                    User     @relation(fields: [userId], references: [id])
  submission              Submission @relation(fields: [submissionId], references: [id])

  @@index([userId])
  @@index([distributionStatus])
}
```

**Migration:**
```bash
npx prisma migrate dev --name add_voter_protocol_integration
```

---

## Integration Service

### VoterProtocolService

**Location:** `src/lib/integrations/voter-protocol/service.ts`

```typescript
import { CipherVaultClient, StorageManager, AccountManager } from '@voter-protocol/client';
import { createEnvelope, openEnvelope, deriveKeyFromWallet } from '@voter-protocol/crypto';
import type { PIIData } from '@voter-protocol/types';
import { prisma } from '$lib/core/db';

export class VoterProtocolService {
  private cipherVault: CipherVaultClient;
  private networkId: 'testnet' | 'mainnet';

  constructor(networkId: 'testnet' | 'mainnet' = 'testnet') {
    this.networkId = networkId;
  }

  /**
   * Initialize service with user's NEAR account.
   */
  async initialize(nearAccountId: string): Promise<void> {
    const account = await this.getNearAccount(nearAccountId);

    this.cipherVault = new CipherVaultClient({
      contractId: this.networkId === 'mainnet'
        ? 'ciphervault.near'
        : 'ciphervault-v1.testnet',
      account,
      maxRetries: 3
    });
  }

  /**
   * Create NEAR implicit account for new user.
   * Called during OAuth signup flow.
   */
  async createUserAccount(userId: string): Promise<{
    nearAccountId: string;
    voterTokenAddress: string;
  }> {
    // Generate implicit account from user ID
    const keyStore = new keyStores.BrowserLocalStorageKeyStore();
    const { accountId, keyPair } = await AccountManager.createImplicitAccount(
      userId,
      keyStore,
      this.networkId
    );

    // Derive deterministic VOTER token address
    const voterTokenAddress = this.deriveTokenAddress(accountId);

    // Update database
    await prisma.user.update({
      where: { id: userId },
      data: {
        nearAccountId: accountId,
        voterTokenAddress
      }
    });

    return {
      nearAccountId: accountId,
      voterTokenAddress
    };
  }

  /**
   * Store user's PII in CipherVault.
   * Called when user completes address verification.
   */
  async storePII(userId: string, pii: PIIData): Promise<string> {
    // Get user's NEAR account
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { nearAccountId: true }
    });

    if (!user?.nearAccountId) {
      throw new Error('User does not have NEAR account');
    }

    // Initialize service
    await this.initialize(user.nearAccountId);

    // Derive encryption key from wallet
    const passkeyKey = await this.deriveUserKey(user.nearAccountId);

    // Create and store envelope
    const envelope = await createEnvelope(
      pii,
      passkeyKey,
      user.nearAccountId
    );

    const result = await this.cipherVault.storeEnvelope({
      envelope,
      guardians: null
    });

    // Update database with envelope ID
    await prisma.user.update({
      where: { id: userId },
      data: { ciphervaultEnvelopeId: result.envelopeId }
    });

    return result.envelopeId;
  }

  /**
   * Retrieve user's PII from CipherVault.
   * Used for congressional template submission.
   */
  async retrievePII(userId: string): Promise<PIIData | null> {
    // Get user's envelope ID
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        nearAccountId: true,
        ciphervaultEnvelopeId: true
      }
    });

    if (!user?.nearAccountId || !user?.ciphervaultEnvelopeId) {
      return null;
    }

    // Initialize service
    await this.initialize(user.nearAccountId);

    // Retrieve envelope
    const stored = await this.cipherVault.getEnvelope(user.ciphervaultEnvelopeId);
    if (!stored) {
      return null;
    }

    // Decrypt
    const passkeyKey = await this.deriveUserKey(user.nearAccountId);
    const pii = await openEnvelope(
      stored.envelope,
      passkeyKey,
      {
        accountId: user.nearAccountId,
        timestamp: stored.createdAt / 1_000_000,
        version: 'voter-protocol-v1'
      }
    );

    return pii;
  }

  /**
   * Track congressional delivery for reward calculation.
   */
  async trackDelivery(submissionId: string, deliveryData: {
    recipientOffices: string[];
    deliveryStatus: 'delivered' | 'failed';
    deliveryHash?: string;
  }): Promise<void> {
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        recipientOffices: deliveryData.recipientOffices,
        deliveryStatus: deliveryData.deliveryStatus,
        deliveryHash: deliveryData.deliveryHash,
        verificationStatus: 'pending'
      }
    });

    // Trigger agent verification (async)
    if (deliveryData.deliveryStatus === 'delivered') {
      await this.requestVerification(submissionId);
    }
  }

  /**
   * Calculate and distribute reward after verification.
   */
  async calculateReward(submissionId: string): Promise<{
    rewardAmountVOTER: number;
    transactionHash: string;
  }> {
    // Get submission with user data
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: { user: true }
    });

    if (!submission) {
      throw new Error('Submission not found');
    }

    if (submission.verificationStatus !== 'verified') {
      throw new Error('Submission not verified');
    }

    // Call VOTER Protocol agent for reward calculation
    const rewardDecision = await this.requestRewardCalculation(submission);

    // Create reward record
    const reward = await prisma.reward.create({
      data: {
        userId: submission.userId,
        submissionId: submission.id,
        baseRewardUSD: rewardDecision.baseRewardUSD,
        multipliers: rewardDecision.multipliers,
        finalAmountVOTER: rewardDecision.rewardAmount,
        distributionStatus: 'pending',
        calculatedAt: new Date()
      }
    });

    // Distribute tokens (server-side transaction signing)
    const txHash = await this.distributeTokens(
      submission.user.voterTokenAddress!,
      rewardDecision.rewardAmount
    );

    // Update reward status
    await prisma.reward.update({
      where: { id: reward.id },
      data: {
        distributionStatus: 'distributed',
        transactionHash: txHash,
        distributedAt: new Date()
      }
    });

    return {
      rewardAmountVOTER: rewardDecision.rewardAmount,
      transactionHash: txHash
    };
  }

  // Private helper methods

  private async getNearAccount(accountId: string) {
    const keyStore = new keyStores.BrowserLocalStorageKeyStore();
    const near = await connect({
      networkId: this.networkId,
      keyStore,
      nodeUrl: `https://rpc.${this.networkId}.near.org`,
      walletUrl: `https://${this.networkId === 'testnet' ? 'testnet.' : ''}mynearwallet.com`,
      helperUrl: `https://helper.${this.networkId}.near.org`
    });

    return near.account(accountId);
  }

  private async deriveUserKey(nearAccountId: string): Promise<Uint8Array> {
    // In production, derive from wallet signature
    // For now, use account ID as seed (deterministic)
    const encoder = new TextEncoder();
    const data = encoder.encode(nearAccountId);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(hash);
  }

  private deriveTokenAddress(nearAccountId: string): string {
    // Deterministic address derivation for VOTER tokens
    // Uses NEAR account ID as seed
    const hash = sha256(new TextEncoder().encode(nearAccountId));
    return `0x${Buffer.from(hash).toString('hex').slice(0, 40)}`;
  }

  private async requestVerification(submissionId: string): Promise<void> {
    // Call VOTER Protocol agent API for verification
    await fetch('/api/agents/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId })
    });
  }

  private async requestRewardCalculation(submission: any): Promise<any> {
    // Call VOTER Protocol agent API for reward calculation
    const response = await fetch('/api/agents/calculate-reward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionId: submission.id,
        impactScore: submission.impactScore,
        userId: submission.userId
      })
    });

    return response.json();
  }

  private async distributeTokens(
    recipientAddress: string,
    amount: number
  ): Promise<string> {
    // Server-side transaction signing for gas-free rewards
    // Implementation depends on VOTER token contract
    const response = await fetch('/api/voter-protocol/distribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: recipientAddress,
        amount: amount
      })
    });

    const result = await response.json();
    return result.transactionHash;
  }
}
```

---

## Integration Flows

### Flow 1: User Signup with NEAR Account Creation

```
User Signs Up (OAuth)
         ↓
Create NEAR Implicit Account
         ↓
Derive VOTER Token Address
         ↓
Store in Database
         ↓
Return to OAuth Flow
```

**Implementation:**

```typescript
// src/routes/api/auth/signup/+server.ts
import { VoterProtocolService } from '$lib/integrations/voter-protocol';

export async function POST({ request }) {
  const { email, oauthProvider } = await request.json();

  // Create user in database
  const user = await prisma.user.create({
    data: { email, oauthProvider }
  });

  // Create NEAR account
  const voterService = new VoterProtocolService('testnet');
  const { nearAccountId, voterTokenAddress } = await voterService.createUserAccount(
    user.id
  );

  return json({
    userId: user.id,
    nearAccountId,
    voterTokenAddress
  });
}
```

---

### Flow 2: PII Collection and Storage

```
User Enters Address
         ↓
Verify with USPS/Google
         ↓
Map to Congressional District
         ↓
Encrypt PII Client-Side
         ↓
Store in CipherVault (NEAR)
         ↓
Store Envelope ID in Database
```

**Implementation:**

```typescript
// src/routes/api/address/verify/+server.ts
import { VoterProtocolService } from '$lib/integrations/voter-protocol';

export async function POST({ request, locals }) {
  const { streetAddress, city, state, zipCode } = await request.json();
  const userId = locals.user.id;

  // Verify address
  const verified = await verifyAddress({
    streetAddress,
    city,
    state,
    zipCode
  });

  // Map to congressional district
  const district = await lookupCongressionalDistrict(verified);

  // Store in CipherVault
  const pii: PIIData = {
    email: locals.user.email,
    firstName: locals.user.firstName || '',
    lastName: locals.user.lastName || '',
    streetAddress: verified.streetAddress,
    city: verified.city,
    state: verified.state,
    zipCode: verified.zipCode,
    congressionalDistrict: district
  };

  const voterService = new VoterProtocolService('testnet');
  const envelopeId = await voterService.storePII(userId, pii);

  // Update local database with district info
  await prisma.user.update({
    where: { id: userId },
    data: {
      streetAddress: verified.streetAddress,
      city: verified.city,
      state: verified.state,
      zipCode: verified.zipCode,
      congressionalDistrict: district
    }
  });

  return json({ success: true, envelopeId, district });
}
```

---

### Flow 3: Congressional Template Submission

```
User Selects Template
         ↓
Retrieve PII from CipherVault
         ↓
Resolve Template Variables
         ↓
Submit to Congressional Offices (CWC)
         ↓
Track Delivery Status
         ↓
Request Agent Verification
```

**Implementation:**

```typescript
// src/routes/api/templates/submit/+server.ts
import { VoterProtocolService } from '$lib/integrations/voter-protocol';
import { deliverToCongress } from '$lib/core/congress';

export async function POST({ request, locals }) {
  const { templateId } = await request.json();
  const userId = locals.user.id;

  // Retrieve PII from CipherVault
  const voterService = new VoterProtocolService('testnet');
  const pii = await voterService.retrievePII(userId);

  if (!pii) {
    return json({ error: 'PII not found' }, { status: 400 });
  }

  // Get template
  const template = await prisma.template.findUnique({
    where: { id: templateId }
  });

  // Resolve template variables
  const resolvedMessage = resolveTemplateVariables(template.content, {
    firstName: pii.firstName,
    lastName: pii.lastName,
    district: pii.congressionalDistrict
  });

  // Submit to congressional offices
  const deliveryResult = await deliverToCongress({
    message: resolvedMessage,
    district: pii.congressionalDistrict,
    senderEmail: pii.email
  });

  // Create submission record
  const submission = await prisma.submission.create({
    data: {
      userId,
      templateId,
      recipientOffices: deliveryResult.offices,
      deliveryStatus: deliveryResult.status,
      deliveryHash: deliveryResult.hash,
      submittedAt: new Date()
    }
  });

  // Track delivery for rewards
  await voterService.trackDelivery(submission.id, {
    recipientOffices: deliveryResult.offices,
    deliveryStatus: deliveryResult.status,
    deliveryHash: deliveryResult.hash
  });

  return json({ submissionId: submission.id });
}
```

---

### Flow 4: Agent Verification and Reward Distribution

```
Submission Delivered
         ↓
Agent Verifies Impact
         ↓
Calculate Impact Score (0.0-1.0)
         ↓
Update Submission Status
         ↓
Calculate Reward Amount
         ↓
Distribute VOTER Tokens
         ↓
Notify User
```

**Implementation:**

```typescript
// src/routes/api/agents/verify/+server.ts
export async function POST({ request }) {
  const { submissionId } = await request.json();

  // Get submission
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { user: true, template: true }
  });

  // Call VOTER Protocol agent for verification
  const verification = await callVerificationAgent({
    submissionId,
    deliveryHash: submission.deliveryHash,
    recipientOffices: submission.recipientOffices
  });

  // Update submission
  await prisma.submission.update({
    where: { id: submissionId },
    data: {
      verificationStatus: verification.status,
      impactScore: verification.impactScore,
      verifiedAt: new Date()
    }
  });

  // If verified, calculate and distribute reward
  if (verification.status === 'verified') {
    const voterService = new VoterProtocolService('testnet');
    const reward = await voterService.calculateReward(submissionId);

    // Notify user
    await notifyUser(submission.user.email, {
      type: 'reward_distributed',
      amount: reward.rewardAmountVOTER,
      transactionHash: reward.transactionHash
    });
  }

  return json({ success: true, verification });
}
```

---

## Testing

### Integration Tests

```typescript
// tests/integration/voter-protocol/service.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { VoterProtocolService } from '$lib/integrations/voter-protocol';

describe('VoterProtocolService', () => {
  let service: VoterProtocolService;
  let testUserId: string;

  beforeAll(async () => {
    service = new VoterProtocolService('testnet');
    testUserId = 'test-user-123';
  });

  it('creates NEAR account for new user', async () => {
    const result = await service.createUserAccount(testUserId);

    expect(result.nearAccountId).toHaveLength(64); // Implicit account
    expect(result.nearAccountId).toMatch(/^[0-9a-f]{64}$/);
    expect(result.voterTokenAddress).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it('stores and retrieves PII', async () => {
    const pii: PIIData = {
      email: 'test@example.com',
      firstName: 'Alice',
      lastName: 'Voter',
      streetAddress: '123 Democracy St',
      city: 'Washington',
      state: 'DC',
      zipCode: '20001',
      congressionalDistrict: 'DC-AL'
    };

    // Store
    const envelopeId = await service.storePII(testUserId, pii);
    expect(envelopeId).toBeTruthy();

    // Retrieve
    const retrieved = await service.retrievePII(testUserId);
    expect(retrieved).toEqual(pii);
  });

  it('tracks congressional delivery', async () => {
    const submissionId = 'test-submission-123';

    await service.trackDelivery(submissionId, {
      recipientOffices: ['rep-123', 'sen-456'],
      deliveryStatus: 'delivered',
      deliveryHash: '0xabc123'
    });

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId }
    });

    expect(submission.deliveryStatus).toBe('delivered');
    expect(submission.verificationStatus).toBe('pending');
  });

  it('calculates and distributes reward', async () => {
    const submissionId = 'test-submission-123';

    // Mark as verified
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        verificationStatus: 'verified',
        impactScore: 0.85
      }
    });

    // Calculate reward
    const result = await service.calculateReward(submissionId);

    expect(result.rewardAmountVOTER).toBeGreaterThan(0);
    expect(result.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);

    // Verify reward record
    const reward = await prisma.reward.findUnique({
      where: { submissionId }
    });

    expect(reward.distributionStatus).toBe('distributed');
  });
});
```

---

## Environment Configuration

```bash
# .env

# NEAR Network
NEAR_NETWORK_ID=testnet                    # or 'mainnet'
NEAR_RPC_URL=https://rpc.testnet.near.org
CIPHERVAULT_CONTRACT_ID=ciphervault-v1.testnet

# VOTER Protocol
VOTER_PROTOCOL_API_URL=https://api.voter-protocol.testnet
VOTER_PROTOCOL_API_KEY=your-api-key
VOTER_TOKEN_CONTRACT_ID=voter-token.testnet

# Server-side wallet for gas-free transactions
VOTER_PROTOCOL_SIGNER_KEY=ed25519:...      # Server wallet private key
```

---

## Security Considerations

### Client-Side Security
- ✅ All PII encrypted in browser before transmission
- ✅ Sovereign keys never leave client
- ✅ NEAR account keys stored in browser keystore
- ✅ Wallet signature required for key derivation

### Server-Side Security
- ✅ Envelope IDs stored in database (not PII)
- ✅ Server cannot decrypt envelopes
- ✅ Server-side signing for gas-free rewards
- ✅ Rate limiting on agent API calls

### Transaction Security
- ✅ Verify delivery status before rewards
- ✅ Agent verification required for high-value rewards
- ✅ Deterministic address derivation prevents fraud
- ✅ On-chain reward records for audit trail

---

## Cost Optimization

### Storage Costs
- **Per user enrollment**: 0.05 NEAR ($0.11) for 500B envelope
- **Account creation**: FREE (implicit accounts)
- **Gas costs**: Paid by platform (gas-free UX)

### Scale Economics
| Users | Storage Cost | Account Cost | Total |
|-------|--------------|--------------|-------|
| 100 | $11 | $0 | $11 |
| 1,000 | $110 | $0 | $110 |
| 10,000 | $1,100 | $0 | $1,100 |
| 100,000 | $11,000 | $0 | $11,000 |
| 1,000,000 | $110,000 | $0 | $110,000 |

**Compared to named accounts:**
- Named accounts would cost $2.19-$6.57 per user
- At 1M users: $2.19M vs $110K (20x more expensive)
- Implicit accounts save 95%+ on infrastructure

---

## Deployment Checklist

### Phase 1: Testnet (Week 1-2)
- [x] Deploy CipherVault contract to testnet
- [ ] Deploy VOTER token contract to testnet
- [ ] Implement VoterProtocolService
- [ ] Add database migrations
- [ ] Test integration flows
- [ ] Deploy Communique with integration

### Phase 2: Mainnet (Week 3-4)
- [ ] Audit smart contracts
- [ ] Deploy to mainnet
- [ ] Update configuration
- [ ] Monitor costs and performance
- [ ] Enable for production users

---

## Status

- 📋 **Pending:** Database schema migration
- 📋 **Pending:** VoterProtocolService implementation
- 📋 **Pending:** Integration tests
- 📋 **Pending:** Testnet deployment
- 📋 **Pending:** Production monitoring setup

---

**Next:** [DEPLOYMENT-SPEC.md](./DEPLOYMENT-SPEC.md) - Testnet and mainnet deployment procedures
