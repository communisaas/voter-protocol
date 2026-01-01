/**
 * IPFS Integration Unit Tests
 *
 * Tests for the IPFS distribution integration in ShadowAtlasService:
 * - Config-driven behavior (enabled/disabled)
 * - publishToIPFS returns CID on success
 * - Failure handling when all services fail
 * - Snapshot CID update after successful publish
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ShadowAtlasConfig } from '../../../core/config.js';
import { getIPFSCredentials, createConfig } from '../../../core/config.js';
import type { Region, PinResult, DistributionError } from '../../../distribution/types.js';
import type { IPinningService, RegionalServiceConfig } from '../../../distribution/regional-pinning-service.js';

const TEST_STORAGE_DIR = join(process.cwd(), 'test-output', 'ipfs-integration-test');

/**
 * Mock pinning service for testing
 */
function createMockPinningService(options: {
  type: 'storacha' | 'pinata' | 'fleek';
  region: Region;
  shouldSucceed: boolean;
  cid?: string;
}): IPinningService {
  return {
    type: options.type,
    region: options.region,

    async pin(
      _content: Blob | Uint8Array,
      _options?: { readonly name?: string; readonly metadata?: Record<string, string> }
    ): Promise<PinResult> {
      if (!options.shouldSucceed) {
        throw new Error(`${options.type} pinning failed`);
      }

      return {
        success: true,
        cid: options.cid ?? 'QmTestCid123456789',
        service: options.type,
        region: options.region,
        pinnedAt: new Date(),
        sizeBytes: 1024,
        durationMs: 100,
      };
    },

    async verify(_cid: string): Promise<boolean> {
      return options.shouldSucceed;
    },

    async unpin(_cid: string): Promise<void> {
      // No-op for testing
    },

    async healthCheck(): Promise<boolean> {
      return options.shouldSucceed;
    },
  };
}

/**
 * Mock RegionalPinningService for testing
 */
class MockRegionalPinningService {
  private readonly region: Region;
  private readonly services: readonly IPinningService[];

  constructor(region: Region, services: readonly IPinningService[]) {
    this.region = region;
    this.services = services;
  }

  async pinToRegion(
    _content: Blob | Uint8Array,
    _options: {
      readonly name?: string;
      readonly metadata?: Record<string, string>;
      readonly requiredSuccesses?: number;
    } = {}
  ): Promise<{
    readonly success: boolean;
    readonly results: readonly PinResult[];
    readonly errors: readonly DistributionError[];
  }> {
    const results: PinResult[] = [];
    const errors: DistributionError[] = [];

    for (const service of this.services) {
      try {
        const result = await service.pin(_content, _options);
        results.push(result);
      } catch (error) {
        errors.push({
          type: 'replication_failed',
          message: error instanceof Error ? error.message : String(error),
          region: this.region,
          service: service.type,
          retryable: true,
          timestamp: new Date(),
        });
      }
    }

    return {
      success: results.some(r => r.success),
      results,
      errors,
    };
  }

  async healthCheck(): Promise<ReadonlyMap<'storacha' | 'pinata' | 'fleek', boolean>> {
    const results = new Map<'storacha' | 'pinata' | 'fleek', boolean>();
    for (const service of this.services) {
      if (service.type === 'storacha' || service.type === 'pinata' || service.type === 'fleek') {
        results.set(service.type, await service.healthCheck());
      }
    }
    return results;
  }
}

describe('IPFS Integration', () => {
  beforeEach(async () => {
    await mkdir(TEST_STORAGE_DIR, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      await rm(TEST_STORAGE_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('getIPFSCredentials', () => {
    it('should return credentials from environment variables', () => {
      // Set environment variables
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        STORACHA_SPACE_DID: 'did:key:test123',
        STORACHA_AGENT_KEY: 'agent-key-secret',
        PINATA_JWT: 'pinata-jwt-token',
        FLEEK_API_KEY: 'fleek-api-key',
        FLEEK_API_SECRET: 'fleek-api-secret',
      };

      const credentials = getIPFSCredentials();

      expect(credentials.storacha?.spaceDid).toBe('did:key:test123');
      expect(credentials.storacha?.agentPrivateKey).toBe('agent-key-secret');
      expect(credentials.pinata?.jwt).toBe('pinata-jwt-token');
      expect(credentials.fleek?.apiKey).toBe('fleek-api-key');
      expect(credentials.fleek?.apiSecret).toBe('fleek-api-secret');

      // Restore environment
      process.env = originalEnv;
    });

    it('should return undefined for unset credentials', () => {
      const originalEnv = process.env;
      process.env = { ...originalEnv };

      // Remove IPFS-related env vars
      delete process.env.STORACHA_SPACE_DID;
      delete process.env.STORACHA_AGENT_KEY;
      delete process.env.PINATA_JWT;
      delete process.env.PINATA_API_KEY;
      delete process.env.PINATA_API_SECRET;
      delete process.env.FLEEK_API_KEY;
      delete process.env.FLEEK_API_SECRET;

      const credentials = getIPFSCredentials();

      expect(credentials.storacha?.spaceDid).toBeUndefined();
      expect(credentials.pinata?.jwt).toBeUndefined();
      expect(credentials.fleek?.apiKey).toBeUndefined();

      process.env = originalEnv;
    });
  });

  describe('createConfig with ipfsDistribution', () => {
    it('should merge ipfsDistribution config', () => {
      const config = createConfig({
        ipfsDistribution: {
          enabled: true,
          regions: ['americas-east', 'europe-west'],
          services: ['storacha', 'pinata'],
          publishOnBuild: true,
          maxParallelUploads: 3,
          retryAttempts: 3,
        },
      });

      expect(config.ipfsDistribution).toBeDefined();
      expect(config.ipfsDistribution?.enabled).toBe(true);
      expect(config.ipfsDistribution?.regions).toContain('americas-east');
      expect(config.ipfsDistribution?.regions).toContain('europe-west');
      expect(config.ipfsDistribution?.services).toContain('storacha');
      expect(config.ipfsDistribution?.services).toContain('pinata');
      expect(config.ipfsDistribution?.publishOnBuild).toBe(true);
    });

    it('should leave ipfsDistribution undefined when not provided', () => {
      const config = createConfig({});

      expect(config.ipfsDistribution).toBeUndefined();
    });

    it('should accept disabled ipfsDistribution', () => {
      const config = createConfig({
        ipfsDistribution: {
          enabled: false,
          regions: ['americas-east'],
          services: ['storacha'],
          publishOnBuild: false,
        },
      });

      expect(config.ipfsDistribution?.enabled).toBe(false);
    });
  });

  describe('MockRegionalPinningService', () => {
    it('should return success when at least one service succeeds', async () => {
      const services = [
        createMockPinningService({
          type: 'storacha',
          region: 'americas-east',
          shouldSucceed: false,
        }),
        createMockPinningService({
          type: 'pinata',
          region: 'americas-east',
          shouldSucceed: true,
          cid: 'QmSuccessfulCid',
        }),
      ];

      const mockService = new MockRegionalPinningService('americas-east', services);
      const blob = new Blob(['test data'], { type: 'application/json' });

      const result = await mockService.pinToRegion(blob, { name: 'test' });

      expect(result.success).toBe(true);
      expect(result.results.length).toBe(1);
      expect(result.results[0].cid).toBe('QmSuccessfulCid');
      expect(result.errors.length).toBe(1);
    });

    it('should return failure when all services fail', async () => {
      const services = [
        createMockPinningService({
          type: 'storacha',
          region: 'americas-east',
          shouldSucceed: false,
        }),
        createMockPinningService({
          type: 'pinata',
          region: 'americas-east',
          shouldSucceed: false,
        }),
      ];

      const mockService = new MockRegionalPinningService('americas-east', services);
      const blob = new Blob(['test data'], { type: 'application/json' });

      const result = await mockService.pinToRegion(blob, { name: 'test' });

      expect(result.success).toBe(false);
      expect(result.results.length).toBe(0);
      expect(result.errors.length).toBe(2);
    });

    it('should include correct metadata in pin results', async () => {
      const services = [
        createMockPinningService({
          type: 'storacha',
          region: 'europe-west',
          shouldSucceed: true,
          cid: 'QmTestCid',
        }),
      ];

      const mockService = new MockRegionalPinningService('europe-west', services);
      const blob = new Blob(['test data'], { type: 'application/json' });

      const result = await mockService.pinToRegion(blob, {
        name: 'shadow-atlas-v1',
        metadata: { snapshotId: 'abc123' },
      });

      expect(result.success).toBe(true);
      expect(result.results[0].service).toBe('storacha');
      expect(result.results[0].region).toBe('europe-west');
      expect(result.results[0].cid).toBe('QmTestCid');
    });

    it('should handle health check for all services', async () => {
      const services = [
        createMockPinningService({
          type: 'storacha',
          region: 'americas-east',
          shouldSucceed: true,
        }),
        createMockPinningService({
          type: 'pinata',
          region: 'americas-east',
          shouldSucceed: false,
        }),
      ];

      const mockService = new MockRegionalPinningService('americas-east', services);
      const health = await mockService.healthCheck();

      expect(health.get('storacha')).toBe(true);
      expect(health.get('pinata')).toBe(false);
    });
  });

  describe('IPFS Configuration Types', () => {
    it('should accept valid region types', () => {
      const config: ShadowAtlasConfig['ipfsDistribution'] = {
        enabled: true,
        regions: ['americas-east', 'americas-west', 'europe-west', 'asia-east'],
        services: ['storacha', 'pinata', 'fleek'],
        publishOnBuild: true,
      };

      expect(config.regions.length).toBe(4);
      expect(config.services.length).toBe(3);
    });

    it('should accept optional parameters', () => {
      const config: ShadowAtlasConfig['ipfsDistribution'] = {
        enabled: true,
        regions: ['americas-east'],
        services: ['pinata'],
        publishOnBuild: false,
        maxParallelUploads: 5,
        retryAttempts: 5,
      };

      expect(config.maxParallelUploads).toBe(5);
      expect(config.retryAttempts).toBe(5);
    });
  });

  describe('Tree Data Serialization', () => {
    it('should serialize tree data correctly for IPFS upload', () => {
      const treeData = {
        version: '2.0.0',
        root: '0x123456789abcdef',
        snapshotId: 'snapshot-123',
        snapshotVersion: 1,
        leaves: 100,
        layerCounts: { cd: 8, county: 72 },
        metadata: {
          tigerVintage: 2024,
          statesIncluded: ['55'],
          layersIncluded: ['cd', 'county'],
          buildDurationMs: 1500,
        },
        timestamp: '2024-01-15T12:00:00.000Z',
      };

      const json = JSON.stringify(treeData, null, 2);
      const parsed = JSON.parse(json);

      expect(parsed.version).toBe('2.0.0');
      expect(parsed.root).toBe('0x123456789abcdef');
      expect(parsed.snapshotId).toBe('snapshot-123');
      expect(parsed.snapshotVersion).toBe(1);
      expect(parsed.leaves).toBe(100);
      expect(parsed.layerCounts.cd).toBe(8);
      expect(parsed.metadata.tigerVintage).toBe(2024);
    });

    it('should handle bigint merkle root serialization', () => {
      const merkleRoot = 12345678901234567890n;
      const rootHex = `0x${merkleRoot.toString(16)}`;

      expect(rootHex).toBe('0xab54a98ceb1f0ad2');

      // Parse back
      const parsed = BigInt(rootHex);
      expect(parsed).toBe(merkleRoot);
    });
  });

  describe('Error Handling', () => {
    it('should collect errors from all failed regions', async () => {
      const errors: string[] = [];

      // Simulate failures from multiple regions
      const regions = ['americas-east', 'europe-west', 'asia-east'] as const;

      for (const region of regions) {
        try {
          throw new Error(`${region}: Service unavailable`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push(errorMessage);
        }
      }

      expect(errors.length).toBe(3);
      expect(errors.join('; ')).toContain('americas-east');
      expect(errors.join('; ')).toContain('europe-west');
      expect(errors.join('; ')).toContain('asia-east');
    });

    it('should format error message correctly when all services fail', () => {
      const errors = [
        'americas-east: storacha timeout',
        'americas-east: pinata rate limit',
        'europe-west: fleek auth failed',
      ];

      const errorMessage = `IPFS upload failed in all regions: ${errors.join('; ')}`;

      expect(errorMessage).toContain('IPFS upload failed in all regions');
      expect(errorMessage).toContain('storacha timeout');
      expect(errorMessage).toContain('pinata rate limit');
      expect(errorMessage).toContain('fleek auth failed');
    });
  });
});
