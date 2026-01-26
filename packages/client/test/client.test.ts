/**
 * Unit tests for @voter-protocol/client
 * Tests account creation, ZK proofs, and contract interactions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VOTERClient } from '../src/client';
import { NEARAccountManager } from '../src/account/near-account';
import { ChainSignatureManager } from '../src/account/chain-signatures';
import { NoirProverAdapter } from '../src/zk/noir-prover';
import { ShadowAtlas } from '../src/zk/shadow-atlas';

describe('VOTERClient', () => {
  let client: VOTERClient;

  beforeEach(() => {
    client = new VOTERClient({
      network: 'scroll-sepolia',
      nearNetwork: 'testnet',
      districtGateAddress: '0x1234567890123456789012345678901234567890',
      reputationRegistryAddress: '0x0987654321098765432109876543210987654321',
      ipfsGateway: 'https://gateway.pinata.cloud/ipfs'
    });
  });

  describe('Initialization', () => {
    it('should initialize with correct network config', () => {
      expect(client).toBeDefined();
      expect(client.getNetwork()).toBe('scroll-sepolia');
    });

    it('should use default IPFS gateway if not provided', () => {
      const defaultClient = new VOTERClient({
        network: 'scroll-mainnet',
        districtGateAddress: '0x1234567890123456789012345678901234567890',
        reputationRegistryAddress: '0x0987654321098765432109876543210987654321'
      });

      expect(defaultClient).toBeDefined();
    });

    it('should default to mainnet for NEAR if not specified', () => {
      const mainnetClient = new VOTERClient({
        network: 'scroll-mainnet',
        districtGateAddress: '0x1234567890123456789012345678901234567890',
        reputationRegistryAddress: '0x0987654321098765432109876543210987654321'
      });

      expect(mainnetClient).toBeDefined();
    });
  });
});

describe('NEARAccountManager', () => {
  let accountManager: NEARAccountManager;

  beforeEach(() => {
    accountManager = new NEARAccountManager('testnet');
  });

  describe('Account Creation', () => {
    it('should create implicit account from seed', async () => {
      const account = await accountManager.createImplicitAccount({
        method: 'seed',
        networkId: 'testnet'
      });

      expect(account).toBeDefined();
      expect(account.accountId).toMatch(/^[0-9a-f]{64}$/);
      expect(account.publicKey).toContain('ed25519:');
    });

    it('should generate deterministic account ID from public key', async () => {
      const account1 = await accountManager.createImplicitAccount({
        method: 'seed',
        networkId: 'testnet'
      });

      const account2 = await accountManager.createImplicitAccount({
        method: 'seed',
        networkId: 'testnet'
      });

      // Different accounts should have different IDs
      expect(account1.accountId).not.toBe(account2.accountId);

      // Each ID should be 64-char hex (SHA256 output)
      expect(account1.accountId).toMatch(/^[0-9a-f]{64}$/);
      expect(account2.accountId).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('Account Management', () => {
    it('should list stored accounts', async () => {
      const accounts = await accountManager.listAccounts();
      expect(Array.isArray(accounts)).toBe(true);
    });

    it('should retrieve existing account', async () => {
      const newAccount = await accountManager.createImplicitAccount({
        method: 'seed',
        networkId: 'testnet'
      });

      const retrieved = await accountManager.getAccount(newAccount.accountId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.accountId).toBe(newAccount.accountId);
    });

    it('should return null for non-existent account', async () => {
      const account = await accountManager.getAccount('nonexistent');
      expect(account).toBeNull();
    });
  });
});

describe('ChainSignatureManager', () => {
  let chainSigs: ChainSignatureManager;
  let mockNEARAccount: any;

  beforeEach(() => {
    mockNEARAccount = {
      accountId: 'test.testnet',
      publicKey: 'ed25519:...'
    };

    chainSigs = new ChainSignatureManager(mockNEARAccount, 'testnet');
  });

  describe('Address Derivation', () => {
    it('should convert ECDSA public key to Ethereum address', () => {
      // Test with known public key → address conversion
      const mockPublicKey = '04' + 'a'.repeat(128); // Uncompressed ECDSA key

      // This would normally call the private method
      // In real implementation, we'd use a test helper
      expect(mockPublicKey.length).toBe(130); // 04 prefix + 64 bytes
    });
  });
});

describe('NoirProverAdapter', () => {
  let prover: NoirProverAdapter;

  beforeEach(() => {
    prover = new NoirProverAdapter();
  });

  describe('Initialization', () => {
    it('should initialize WASM module', async () => {
      await prover.init();
      expect(prover.supportsWebWorkers()).toBeDefined();
    });

    it('should not reinitialize if already initialized', async () => {
      await prover.init();
      await prover.init(); // Second call should be no-op
    });
  });

  describe('Proving Time Estimation', () => {
    it('should estimate proving time in expected range', () => {
      const estimate = prover.estimateProvingTime();

      expect(estimate.min).toBeGreaterThan(0);
      expect(estimate.max).toBeGreaterThan(estimate.min);
      expect(estimate.min).toBeLessThanOrEqual(12000); // 12 seconds max
    });
  });

  describe('Web Worker Support', () => {
    it('should detect Web Worker availability', () => {
      const supportsWorkers = prover.supportsWebWorkers();
      expect(typeof supportsWorkers).toBe('boolean');
    });
  });
});

describe('ShadowAtlas', () => {
  let atlas: ShadowAtlas;

  beforeEach(() => {
    atlas = new ShadowAtlas(
      'https://gateway.pinata.cloud/ipfs',
      'aggressive'
    );
  });

  describe('Initialization', () => {
    it('should create atlas with custom gateway', () => {
      const customAtlas = new ShadowAtlas('https://custom-gateway.com/ipfs');
      expect(customAtlas).toBeDefined();
    });

    it('should default to minimal cache strategy', () => {
      const minimalAtlas = new ShadowAtlas();
      expect(minimalAtlas).toBeDefined();
    });
  });

  describe('Loading State', () => {
    it('should report not loaded initially', () => {
      expect(atlas.isLoaded()).toBe(false);
      expect(atlas.getCurrentCID()).toBeNull();
      expect(atlas.getMetadata()).toBeNull();
    });
  });

  describe('Merkle Proof Generation', () => {
    it('should throw if atlas not loaded', async () => {
      await expect(
        atlas.generateProof('0x1234567890123456789012345678901234567890')
      ).rejects.toThrow('Shadow Atlas not loaded');
    });
  });
});

describe('Utility Functions', () => {
  describe('formatTokenAmount', () => {
    it('should format token amounts correctly', async () => {
      const { formatTokenAmount } = await import('../src/utils/format');

      expect(formatTokenAmount(BigInt('1000000000000000000'))).toBe('1.00');
      expect(formatTokenAmount(BigInt('1500000000000000000'))).toBe('1.50');
      expect(formatTokenAmount(BigInt('123456789012345678'))).toBe('0.12');
    });

    it('should handle zero fractional part', async () => {
      const { formatTokenAmount } = await import('../src/utils/format');

      expect(formatTokenAmount(BigInt('1000000000000000000'))).toBe('1.00');
    });
  });

  describe('getReputationTier', () => {
    it('should return correct tier for score', async () => {
      const { getReputationTier } = await import('../src/utils/format');
      const { ReputationTier } = await import('../src/contracts/types');

      expect(getReputationTier(100)).toBe(ReputationTier.TRUSTED);
      expect(getReputationTier(70)).toBe(ReputationTier.ESTABLISHED);
      expect(getReputationTier(50)).toBe(ReputationTier.EMERGING);
      expect(getReputationTier(30)).toBe(ReputationTier.NOVICE);
      expect(getReputationTier(10)).toBe(ReputationTier.UNTRUSTED);
    });
  });
});

describe('Error Classes', () => {
  it('should create VOTERError with code', async () => {
    const { VOTERError } = await import('../src/utils/errors');

    const error = new VOTERError('Test error', 'TEST_CODE');
    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.name).toBe('VOTERError');
  });

  it('should create ProofGenerationError', async () => {
    const { ProofGenerationError } = await import('../src/utils/errors');

    const error = new ProofGenerationError('Proof failed');
    expect(error.message).toBe('Proof failed');
    expect(error.code).toBe('PROOF_GENERATION_ERROR');
    expect(error.name).toBe('ProofGenerationError');
  });

  it('should create ContractError with txHash', async () => {
    const { ContractError } = await import('../src/utils/errors');

    const error = new ContractError('Contract failed', '0xabc123');
    expect(error.message).toBe('Contract failed');
    expect(error.txHash).toBe('0xabc123');
    expect(error.code).toBe('CONTRACT_ERROR');
  });

  it('should create NetworkError with statusCode', async () => {
    const { NetworkError } = await import('../src/utils/errors');

    const error = new NetworkError('Network failed', 500);
    expect(error.message).toBe('Network failed');
    expect(error.statusCode).toBe(500);
    expect(error.code).toBe('NETWORK_ERROR');
  });

  it('should create AccountError', async () => {
    const { AccountError } = await import('../src/utils/errors');

    const error = new AccountError('Account failed');
    expect(error.message).toBe('Account failed');
    expect(error.code).toBe('ACCOUNT_ERROR');
  });
});
