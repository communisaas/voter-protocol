# Client SDK Engineering Specification

**Component:** NEAR Client Library
**Language:** TypeScript
**Location:** `packages/client/`
**Status:** 📋 Day 5 Implementation

---

## Overview

The Client SDK provides a high-level interface for interacting with CipherVault smart contract on NEAR Protocol. It abstracts storage management, cost calculations, and transaction handling.

**Key Features:**
- Automatic storage deposit management
- Cost calculation and balance tracking
- Transaction retry logic
- Type-safe contract interface
- Implicit account creation

**Related Specs:**
- [CIPHERVAULT-CONTRACT-SPEC.md](./CIPHERVAULT-CONTRACT-SPEC.md) - Contract methods and validation
- [CRYPTO-SDK-SPEC.md](./CRYPTO-SDK-SPEC.md) - Encryption and compression
- [COMPRESSION-STRATEGY.md](../COMPRESSION-STRATEGY.md) - Cost optimization

---

## Architecture

```
┌────────────────────────────────────────────┐
│  Application Layer                         │
│  (Communique, voter-protocol frontend)     │
└────────────────────────────────────────────┘
                   ↓
┌────────────────────────────────────────────┐
│  Client SDK (this spec)                    │
│  ┌──────────────────────────────────────┐  │
│  │ CipherVaultClient                    │  │
│  │ - store_envelope()                   │  │
│  │ - get_envelope()                     │  │
│  │ - update_envelope()                  │  │
│  │ - delete_envelope()                  │  │
│  │ - manage_storage()                   │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │ StorageManager                       │  │
│  │ - calculateCost()                    │  │
│  │ - ensureBalance()                    │  │
│  │ - getBalance()                       │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │ AccountManager                       │  │
│  │ - createImplicitAccount()            │  │
│  │ - deriveAddress()                    │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
                   ↓
┌────────────────────────────────────────────┐
│  near-api-js                               │
└────────────────────────────────────────────┘
                   ↓
┌────────────────────────────────────────────┐
│  CipherVault Contract (NEAR)               │
└────────────────────────────────────────────┘
```

---

## Dependencies

```json
{
  "dependencies": {
    "near-api-js": "^4.0.0",
    "@voter-protocol/crypto": "workspace:*",
    "@voter-protocol/types": "workspace:*",
    "bn.js": "^5.2.1"
  }
}
```

---

## Core Classes

### CipherVaultClient

**Purpose:** Main interface for CipherVault operations.

```typescript
import { Account, Contract } from 'near-api-js';
import type { CipherEnvelope } from '@voter-protocol/types';

export interface CipherVaultConfig {
  contractId: string;           // e.g., 'ciphervault-v1.testnet'
  account: Account;             // NEAR account instance
  maxRetries?: number;          // Default: 3
  retryDelayMs?: number;        // Default: 1000
}

export class CipherVaultClient {
  private contract: Contract;
  private storageManager: StorageManager;
  private config: Required<CipherVaultConfig>;

  constructor(config: CipherVaultConfig) {
    this.config = {
      maxRetries: 3,
      retryDelayMs: 1000,
      ...config
    };

    // Initialize contract interface
    this.contract = new Contract(config.account, config.contractId, {
      viewMethods: [
        'get_envelope',
        'envelope_exists',
        'get_envelope_count',
        'storage_balance_of',
        'storage_balance_bounds'
      ],
      changeMethods: [
        'store_envelope',
        'update_envelope',
        'delete_envelope',
        'storage_deposit'
      ]
    });

    this.storageManager = new StorageManager(this.contract, config.account);
  }

  // Methods below...
}
```

---

### Store Envelope

```typescript
export interface StoreEnvelopeParams {
  envelope: CipherEnvelope;     // From crypto SDK
  guardians?: string[];         // Optional guardian accounts
}

export interface StoreEnvelopeResult {
  envelopeId: string;           // Format: {accountId}-{counter}
  cost: string;                 // Storage cost in NEAR
  transactionHash: string;
}

async storeEnvelope(
  params: StoreEnvelopeParams
): Promise<StoreEnvelopeResult> {
  // Step 1: Calculate storage cost
  const cost = this.storageManager.calculateEnvelopeCost(params.envelope);

  // Step 2: Ensure sufficient storage balance
  await this.storageManager.ensureBalance(cost);

  // Step 3: Store envelope with retry logic
  const result = await this.withRetry(async () => {
    return await this.contract.store_envelope({
      encrypted_data: Array.from(params.envelope.encrypted_data),
      nonce: Array.from(params.envelope.nonce),
      poseidon_commit: params.envelope.poseidon_commit,
      encrypted_sovereign_key: Array.from(params.envelope.encrypted_sovereign_key),
      sovereign_key_iv: Array.from(params.envelope.sovereign_key_iv),
      sovereign_key_tag: Array.from(params.envelope.sovereign_key_tag),
      guardians: params.guardians ?? null
    }, {
      gas: '30000000000000',  // 30 TGas
      attachedDeposit: '0'     // Already deposited via storage_deposit
    });
  });

  return {
    envelopeId: result,
    cost: cost.toString(),
    transactionHash: result.transaction.hash
  };
}
```

---

### Get Envelope

```typescript
export interface GetEnvelopeResult {
  envelope: CipherEnvelope;
  owner: string;
  version: number;
  createdAt: number;
  guardians: string[];
}

async getEnvelope(envelopeId: string): Promise<GetEnvelopeResult | null> {
  const result = await this.contract.get_envelope({
    envelope_id: envelopeId
  });

  if (!result) {
    return null;
  }

  return {
    envelope: {
      encrypted_data: new Uint8Array(result.encrypted_data),
      nonce: new Uint8Array(result.nonce),
      poseidon_commit: result.poseidon_commit,
      encrypted_sovereign_key: new Uint8Array(result.encrypted_sovereign_key),
      sovereign_key_iv: new Uint8Array(result.sovereign_key_iv),
      sovereign_key_tag: new Uint8Array(result.sovereign_key_tag)
    },
    owner: result.owner,
    version: result.version,
    createdAt: result.created_at,
    guardians: result.guardians
  };
}
```

---

### Update Envelope

```typescript
export interface UpdateEnvelopeParams {
  envelopeId: string;
  envelope: CipherEnvelope;
}

export interface UpdateEnvelopeResult {
  envelopeId: string;
  newVersion: number;
  costDifference: string;       // Positive = charged, negative = refunded
  transactionHash: string;
}

async updateEnvelope(
  params: UpdateEnvelopeParams
): Promise<UpdateEnvelopeResult> {
  // Step 1: Get existing envelope to calculate cost difference
  const existing = await this.getEnvelope(params.envelopeId);
  if (!existing) {
    throw new Error(`Envelope ${params.envelopeId} not found`);
  }

  // Step 2: Calculate cost difference
  const newCost = this.storageManager.calculateEnvelopeCost(params.envelope);
  const oldCost = this.storageManager.calculateEnvelopeCost(existing.envelope);
  const costDiff = newCost.sub(oldCost);

  // Step 3: If new > old, ensure sufficient balance
  if (costDiff.gt(new BN(0))) {
    await this.storageManager.ensureBalance(costDiff);
  }

  // Step 4: Update envelope with retry logic
  const result = await this.withRetry(async () => {
    return await this.contract.update_envelope({
      envelope_id: params.envelopeId,
      encrypted_data: Array.from(params.envelope.encrypted_data),
      nonce: Array.from(params.envelope.nonce),
      poseidon_commit: params.envelope.poseidon_commit,
      encrypted_sovereign_key: Array.from(params.envelope.encrypted_sovereign_key),
      sovereign_key_iv: Array.from(params.envelope.sovereign_key_iv),
      sovereign_key_tag: Array.from(params.envelope.sovereign_key_tag)
    }, {
      gas: '30000000000000',
      attachedDeposit: '0'
    });
  });

  return {
    envelopeId: result,
    newVersion: existing.version + 1,
    costDifference: costDiff.toString(),
    transactionHash: result.transaction.hash
  };
}
```

---

### Delete Envelope

```typescript
export interface DeleteEnvelopeResult {
  refund: string;               // Refunded NEAR amount
  transactionHash: string;
}

async deleteEnvelope(envelopeId: string): Promise<DeleteEnvelopeResult> {
  // Step 1: Get existing envelope to calculate refund
  const existing = await this.getEnvelope(envelopeId);
  if (!existing) {
    throw new Error(`Envelope ${envelopeId} not found`);
  }

  const refund = this.storageManager.calculateEnvelopeCost(existing.envelope);

  // Step 2: Delete envelope with retry logic
  const result = await this.withRetry(async () => {
    return await this.contract.delete_envelope({
      envelope_id: envelopeId
    }, {
      gas: '15000000000000',  // 15 TGas
      attachedDeposit: '0'
    });
  });

  return {
    refund: refund.toString(),
    transactionHash: result.transaction.hash
  };
}
```

---

### Retry Logic

```typescript
private async withRetry<T>(
  operation: () => Promise<T>
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on validation errors
      if (this.isValidationError(error)) {
        throw error;
      }

      // Wait before retry
      if (attempt < this.config.maxRetries - 1) {
        await this.sleep(this.config.retryDelayMs * (attempt + 1));
      }
    }
  }

  throw new Error(
    `Operation failed after ${this.config.maxRetries} attempts: ${lastError.message}`
  );
}

private isValidationError(error: unknown): boolean {
  const message = (error as Error).message.toLowerCase();
  return (
    message.includes('nonce must be') ||
    message.includes('must be') ||
    message.includes('invalid') ||
    message.includes('exceeds')
  );
}

private sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## StorageManager

**Purpose:** Handle storage deposits and cost calculations.

```typescript
import BN from 'bn.js';

export class StorageManager {
  private static readonly STORAGE_COST_PER_BYTE = new BN('10000000000000000000'); // 1E19 yoctoNEAR
  private static readonly STRUCT_OVERHEAD = 200; // Bytes for struct fields

  constructor(
    private contract: Contract,
    private account: Account
  ) {}

  /**
   * Calculate storage cost for an envelope.
   */
  calculateEnvelopeCost(envelope: CipherEnvelope): BN {
    const totalSize =
      envelope.encrypted_data.length +
      envelope.nonce.length +
      envelope.poseidon_commit.length +
      envelope.encrypted_sovereign_key.length +
      envelope.sovereign_key_iv.length +
      envelope.sovereign_key_tag.length +
      StorageManager.STRUCT_OVERHEAD;

    return new BN(totalSize).mul(StorageManager.STORAGE_COST_PER_BYTE);
  }

  /**
   * Get current storage balance.
   */
  async getBalance(): Promise<BN> {
    const result = await this.contract.storage_balance_of({
      account_id: this.account.accountId
    });

    if (!result) {
      return new BN(0);
    }

    return new BN(result.total);
  }

  /**
   * Get available balance (total - used).
   */
  async getAvailableBalance(): Promise<BN> {
    const result = await this.contract.storage_balance_of({
      account_id: this.account.accountId
    });

    if (!result) {
      return new BN(0);
    }

    return new BN(result.available);
  }

  /**
   * Ensure sufficient storage balance, deposit if needed.
   */
  async ensureBalance(requiredCost: BN): Promise<void> {
    const available = await this.getAvailableBalance();

    if (available.gte(requiredCost)) {
      return; // Sufficient balance
    }

    // Calculate deficit
    const deficit = requiredCost.sub(available);

    // Add 10% buffer for future operations
    const depositAmount = deficit.mul(new BN(110)).div(new BN(100));

    // Deposit
    await this.deposit(depositAmount);
  }

  /**
   * Deposit NEAR for storage.
   */
  async deposit(amount: BN): Promise<void> {
    await this.contract.storage_deposit({
      account_id: null,  // Deposit for self
      registration_only: false
    }, {
      gas: '30000000000000',
      attachedDeposit: amount.toString()
    });
  }

  /**
   * Get minimum required deposit from contract.
   */
  async getMinimumDeposit(): Promise<BN> {
    const bounds = await this.contract.storage_balance_bounds();
    return new BN(bounds.min);
  }

  /**
   * Format yoctoNEAR to NEAR.
   */
  static formatNEAR(yoctoNEAR: BN): string {
    const near = yoctoNEAR.div(new BN('1000000000000000000000000'));
    const remainder = yoctoNEAR.mod(new BN('1000000000000000000000000'));
    const decimal = remainder.toString().padStart(24, '0').slice(0, 4);
    return `${near}.${decimal}`;
  }
}
```

---

## AccountManager

**Purpose:** Create and manage implicit NEAR accounts.

```typescript
import { KeyPair, keyStores } from 'near-api-js';
import { sha256 } from '@noble/hashes/sha256';

export class AccountManager {
  /**
   * Create implicit account from user identifier.
   * Uses deterministic key derivation for consistent addresses.
   */
  static async createImplicitAccount(
    userId: string,
    keyStore: keyStores.KeyStore,
    networkId: string = 'testnet'
  ): Promise<{ accountId: string; keyPair: KeyPair }> {
    // Derive seed from user ID
    const seed = sha256(new TextEncoder().encode(userId));

    // Create key pair from seed
    const keyPair = KeyPair.fromString(
      `ed25519:${Buffer.from(seed).toString('base64')}`
    );

    // Derive implicit account ID from public key
    const accountId = Buffer.from(keyPair.getPublicKey().data).toString('hex');

    // Store key in keyStore
    await keyStore.setKey(networkId, accountId, keyPair);

    return { accountId, keyPair };
  }

  /**
   * Get implicit account address from public key.
   */
  static deriveAddress(publicKey: Uint8Array): string {
    return Buffer.from(publicKey).toString('hex');
  }

  /**
   * Check if account is implicit (64 hex chars).
   */
  static isImplicitAccount(accountId: string): boolean {
    return /^[0-9a-f]{64}$/.test(accountId);
  }

  /**
   * Validate account ID format.
   */
  static validateAccountId(accountId: string): boolean {
    // Implicit: 64 hex chars
    if (this.isImplicitAccount(accountId)) {
      return true;
    }

    // Named: lowercase alphanumeric, hyphens, dots
    return /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/.test(accountId);
  }
}
```

---

## High-Level Interface

**Purpose:** Combine crypto SDK and client SDK for complete flow.

```typescript
import { createEnvelope, openEnvelope } from '@voter-protocol/crypto';
import type { PIIData } from '@voter-protocol/types';

export class VoterProtocolClient {
  constructor(
    private cryptoClient: CryptoSDK,
    private cipherVaultClient: CipherVaultClient
  ) {}

  /**
   * Complete flow: encrypt + compress + store on-chain.
   */
  async storePII(
    pii: PIIData,
    passkeyDerivedKey: Uint8Array
  ): Promise<StoreEnvelopeResult> {
    // Step 1: Create encrypted envelope (client-side)
    const envelope = await createEnvelope(
      pii,
      passkeyDerivedKey,
      this.cipherVaultClient.account.accountId
    );

    // Step 2: Store on-chain
    const result = await this.cipherVaultClient.storeEnvelope({
      envelope,
      guardians: null
    });

    return result;
  }

  /**
   * Complete flow: retrieve from chain + decrypt.
   */
  async retrievePII(
    envelopeId: string,
    passkeyDerivedKey: Uint8Array
  ): Promise<PIIData | null> {
    // Step 1: Retrieve from chain
    const stored = await this.cipherVaultClient.getEnvelope(envelopeId);
    if (!stored) {
      return null;
    }

    // Step 2: Decrypt (client-side)
    const pii = await openEnvelope(
      stored.envelope,
      passkeyDerivedKey,
      {
        accountId: stored.owner,
        timestamp: stored.createdAt / 1_000_000,  // Convert nanoseconds
        version: 'voter-protocol-v1'
      }
    );

    return pii;
  }

  /**
   * Get storage cost estimate.
   */
  async estimateCost(pii: PIIData): Promise<string> {
    // Create envelope to calculate size
    const tempKey = new Uint8Array(32).fill(0);  // Dummy key
    const envelope = await createEnvelope(pii, tempKey, 'dummy.near');

    // Calculate cost
    const cost = this.cipherVaultClient.storageManager.calculateEnvelopeCost(
      envelope
    );

    return StorageManager.formatNEAR(cost);
  }
}
```

---

## Usage Examples

### Basic Setup

```typescript
import { connect, keyStores } from 'near-api-js';
import { CipherVaultClient, AccountManager } from '@voter-protocol/client';

// Initialize NEAR connection
const keyStore = new keyStores.BrowserLocalStorageKeyStore();
const near = await connect({
  networkId: 'testnet',
  keyStore,
  nodeUrl: 'https://rpc.testnet.near.org',
  walletUrl: 'https://testnet.mynearwallet.com',
  helperUrl: 'https://helper.testnet.near.org',
  explorerUrl: 'https://testnet.nearblocks.io'
});

// Create implicit account
const { accountId, keyPair } = await AccountManager.createImplicitAccount(
  'user@example.com',
  keyStore,
  'testnet'
);

// Get account instance
const account = await near.account(accountId);

// Initialize client
const client = new CipherVaultClient({
  contractId: 'ciphervault-v1.testnet',
  account,
  maxRetries: 3
});
```

---

### Store PII

```typescript
import { deriveKeyFromWallet } from '@voter-protocol/crypto';

// Derive key from wallet signature
const message = 'Sign to unlock your VOTER Protocol identity';
const signature = await wallet.signMessage(message);

const passkeyKey = await deriveKeyFromWallet({
  signature: new Uint8Array(signature),
  accountId: account.accountId,
  purpose: 'voter-protocol-sovereign-key-v1'
});

// Store PII
const pii: PIIData = {
  email: 'user@example.com',
  firstName: 'Alice',
  lastName: 'Voter',
  streetAddress: '123 Democracy St',
  city: 'Washington',
  state: 'DC',
  zipCode: '20001'
};

const result = await voterClient.storePII(pii, passkeyKey);

console.log(`Stored envelope: ${result.envelopeId}`);
console.log(`Cost: ${result.cost} NEAR`);
```

---

### Retrieve PII

```typescript
// Retrieve and decrypt
const pii = await voterClient.retrievePII(envelopeId, passkeyKey);

if (pii) {
  console.log(`Retrieved PII for ${pii.email}`);
} else {
  console.log('Envelope not found');
}
```

---

### Estimate Cost

```typescript
// Get cost estimate before storing
const costInNEAR = await voterClient.estimateCost(pii);
console.log(`Estimated cost: ${costInNEAR} NEAR`);

// Typical: 0.05 NEAR = $0.11 (with compression)
```

---

### Storage Management

```typescript
// Check balance
const balance = await client.storageManager.getBalance();
console.log(`Storage balance: ${StorageManager.formatNEAR(balance)} NEAR`);

// Deposit more storage
await client.storageManager.deposit(new BN('100000000000000000000000')); // 0.1 NEAR

// Get minimum required
const min = await client.storageManager.getMinimumDeposit();
console.log(`Minimum deposit: ${StorageManager.formatNEAR(min)} NEAR`);
```

---

## Testing

### Unit Tests

```typescript
// tests/client-sdk/storage-manager.test.ts
describe('StorageManager', () => {
  test('calculates envelope cost correctly', () => {
    const envelope: CipherEnvelope = {
      encrypted_data: new Uint8Array(196),
      nonce: new Uint8Array(24),
      poseidon_commit: '0'.repeat(64),
      encrypted_sovereign_key: new Uint8Array(32),
      sovereign_key_iv: new Uint8Array(12),
      sovereign_key_tag: new Uint8Array(16)
    };

    const cost = storageManager.calculateEnvelopeCost(envelope);

    // 196 + 24 + 64 + 32 + 12 + 16 + 200 = 544 bytes
    // 544 × 1E19 = 5.44E21 yoctoNEAR = 0.00544 NEAR
    expect(cost.toString()).toBe('5440000000000000000000');
  });

  test('formats NEAR correctly', () => {
    const yocto = new BN('5440000000000000000000');
    const near = StorageManager.formatNEAR(yocto);
    expect(near).toBe('0.0054');
  });
});

// tests/client-sdk/account-manager.test.ts
describe('AccountManager', () => {
  test('creates implicit account from user ID', async () => {
    const result = await AccountManager.createImplicitAccount(
      'user@example.com',
      keyStore,
      'testnet'
    );

    expect(result.accountId).toHaveLength(64);
    expect(result.accountId).toMatch(/^[0-9a-f]{64}$/);
  });

  test('validates implicit account format', () => {
    expect(AccountManager.isImplicitAccount(
      '1234567890abcdef'.repeat(4)
    )).toBe(true);

    expect(AccountManager.isImplicitAccount(
      'alice.near'
    )).toBe(false);
  });
});
```

---

### Integration Tests

```typescript
// tests/client-sdk/integration.test.ts
describe('CipherVaultClient Integration', () => {
  let client: CipherVaultClient;
  let voterClient: VoterProtocolClient;

  beforeAll(async () => {
    // Setup test account and client
    const { account } = await setupTestAccount();
    client = new CipherVaultClient({
      contractId: 'ciphervault-v1.testnet',
      account
    });
    voterClient = new VoterProtocolClient(cryptoSDK, client);
  });

  test('complete flow: store and retrieve PII', async () => {
    const pii: PIIData = {
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      streetAddress: '123 Test St',
      city: 'Test City',
      state: 'TC',
      zipCode: '12345'
    };

    const passkeyKey = sodium.randombytes_buf(32);

    // Store
    const stored = await voterClient.storePII(pii, passkeyKey);
    expect(stored.envelopeId).toBeTruthy();

    // Retrieve
    const retrieved = await voterClient.retrievePII(
      stored.envelopeId,
      passkeyKey
    );

    expect(retrieved).toEqual(pii);
  });

  test('storage deposit and cost management', async () => {
    // Deposit storage
    await client.storageManager.deposit(new BN('100000000000000000000000'));

    // Check balance
    const balance = await client.storageManager.getBalance();
    expect(balance.gte(new BN('100000000000000000000000'))).toBe(true);

    // Ensure balance (should not deposit again)
    const before = await client.storageManager.getBalance();
    await client.storageManager.ensureBalance(new BN('1000000000000000000000'));
    const after = await client.storageManager.getBalance();

    expect(after.toString()).toBe(before.toString());
  });

  test('retry logic on network errors', async () => {
    // Simulate network error
    const mockContract = vi.fn()
      .mockRejectedValueOnce(new Error('Network timeout'))
      .mockRejectedValueOnce(new Error('Network timeout'))
      .mockResolvedValueOnce({ envelopeId: 'test-123' });

    // Should succeed after 2 retries
    const result = await client.withRetry(mockContract);
    expect(result.envelopeId).toBe('test-123');
    expect(mockContract).toHaveBeenCalledTimes(3);
  });
});
```

---

## Error Handling

```typescript
export enum CipherVaultError {
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  ENVELOPE_NOT_FOUND = 'ENVELOPE_NOT_FOUND',
  INVALID_ENVELOPE = 'INVALID_ENVELOPE',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED'
}

export class CipherVaultException extends Error {
  constructor(
    public code: CipherVaultError,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'CipherVaultException';
  }
}

// Usage in client
try {
  await client.storeEnvelope({ envelope });
} catch (error) {
  if (error instanceof CipherVaultException) {
    switch (error.code) {
      case CipherVaultError.INSUFFICIENT_BALANCE:
        // Prompt user to deposit
        break;
      case CipherVaultError.NETWORK_ERROR:
        // Retry or show offline message
        break;
      default:
        // Generic error handling
    }
  }
}
```

---

## Package Structure

```
packages/client/
├── src/
│   ├── index.ts                    # Public API exports
│   ├── CipherVaultClient.ts        # Main client class
│   ├── StorageManager.ts           # Storage deposit management
│   ├── AccountManager.ts           # Implicit account creation
│   ├── VoterProtocolClient.ts      # High-level interface
│   ├── errors.ts                   # Error types
│   └── types.ts                    # Type definitions
├── tests/
│   ├── storage-manager.test.ts
│   ├── account-manager.test.ts
│   ├── cipher-vault-client.test.ts
│   └── integration.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

## Performance Considerations

**Target Performance:**

| Operation | Target | Notes |
|-----------|--------|-------|
| Store envelope | < 5s | Includes storage deposit if needed |
| Retrieve envelope | < 2s | View call, no gas |
| Update envelope | < 5s | May require additional deposit |
| Delete envelope | < 3s | Includes refund processing |
| Storage deposit | < 3s | One-time setup per account |

**Optimization Strategies:**
- Cache storage balance (update after operations)
- Batch storage deposits (deposit for multiple envelopes)
- Use localStorage for recent envelope IDs
- Implement request deduplication
- Add progress callbacks for long operations

---

## Security Considerations

### Client-Side Security
- ✅ Never send unencrypted PII to server
- ✅ Store keys in browser storage securely (Web Crypto API)
- ✅ Clear sensitive data after use
- ✅ Validate all user inputs

### Transaction Security
- ✅ Verify transaction hashes
- ✅ Check envelope ownership before update/delete
- ✅ Validate storage balance before operations
- ✅ Use retry logic for network failures only

### Key Management
- ✅ Derive keys from wallet signatures (high entropy)
- ✅ Never reuse keys across accounts
- ✅ Support key rotation (update envelope)
- ✅ Implement passkey backup/recovery

---

## Integration

**For Application Integration:** See [Communique Integration Guide](../docs/communique-integration.md)

**For Contract Details:** See [CIPHERVAULT-CONTRACT-SPEC.md](./CIPHERVAULT-CONTRACT-SPEC.md)

**For Encryption Details:** See [CRYPTO-SDK-SPEC.md](./CRYPTO-SDK-SPEC.md)

---

## Status

- 📋 **Pending:** Implementation (Day 5)
- 📋 **Pending:** Test suite (20+ tests planned)
- 📋 **Pending:** Browser compatibility testing
- 📋 **Pending:** Performance benchmarking
- 📋 **Pending:** Documentation and examples

---

**Next:** [INTEGRATION-SPEC.md](./INTEGRATION-SPEC.md) - Communique integration patterns
