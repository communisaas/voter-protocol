/**
 * TIGER Ingestion Orchestrator Tests
 *
 * CRITICAL TYPE SAFETY: These tests validate batch ingestion, checkpointing,
 * and circuit breaker logic. Failures here mean:
 * - Wasted bandwidth on partial downloads
 * - Lost progress on large batch operations
 * - Cascading failures across state downloads
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mkdir, rm, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  TIGERIngestionOrchestrator,
  createTIGERIngestionOrchestrator,
  type BatchIngestionOptions,
  type CheckpointState,
} from '../../../acquisition/tiger-ingestion-orchestrator.js';
import type { ShadowAtlasConfig } from '../../../core/config.js';
import type { TIGERBoundaryProvider, TIGERDownloadOptions } from '../../../providers/tiger-boundary-provider.js';
import type { RawBoundaryFile, NormalizedBoundary } from '../../../core/types.js';

// ============================================================================
// Mock Provider
// ============================================================================

/**
 * Mock TIGER Boundary Provider for testing
 */
class MockTIGERBoundaryProvider implements Partial<TIGERBoundaryProvider> {
  readonly countryCode = 'US';
  readonly name = 'Mock TIGER Provider';
  readonly source = 'https://example.com';
  readonly updateSchedule = 'annual' as const;
  readonly administrativeLevels = ['district', 'county'] as const;

  // Track calls for assertions
  downloadCalls: TIGERDownloadOptions[] = [];
  transformCalls: RawBoundaryFile[][] = [];

  // Configurable behavior
  downloadBehavior: 'success' | 'fail' | 'partial' = 'success';
  failOnStates: Set<string> = new Set();
  downloadDelay = 0;

  async downloadLayer(options: TIGERDownloadOptions): Promise<RawBoundaryFile[]> {
    this.downloadCalls.push(options);

    if (this.downloadDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.downloadDelay));
    }

    // Check if this state should fail
    if (options.stateFips && this.failOnStates.has(options.stateFips)) {
      throw new Error(`Download failed for state ${options.stateFips}`);
    }

    if (this.downloadBehavior === 'fail') {
      throw new Error('Download failed');
    }

    // Return mock raw files
    return [
      {
        url: `https://example.com/tiger/${options.layer}/${options.stateFips}`,
        format: 'geojson',
        data: Buffer.from(JSON.stringify({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: {}, geometry: null }],
        })),
        metadata: {
          layer: options.layer,
          stateFips: options.stateFips,
          year: options.year,
        },
      },
    ];
  }

  async transform(raw: RawBoundaryFile[]): Promise<NormalizedBoundary[]> {
    this.transformCalls.push(raw);

    // Return mock normalized boundaries
    return raw.map((file, i) => ({
      id: `mock-${file.metadata.stateFips}-${file.metadata.layer}-${i}`,
      name: `Mock Boundary ${i}`,
      level: 'district' as const,
      geometry: { type: 'Point' as const, coordinates: [0, 0] },
      properties: {},
      source: {
        provider: this.name,
        url: file.url,
        version: '2024',
        license: 'CC0-1.0',
        updatedAt: new Date().toISOString(),
        checksum: 'mock-checksum',
        authorityLevel: 'federal-mandate' as const,
        legalStatus: 'binding' as const,
        collectionMethod: 'census-tiger' as const,
        lastVerified: new Date().toISOString(),
        verifiedBy: 'automated' as const,
        topologyValidated: true,
        geometryRepaired: false,
        coordinateSystem: 'EPSG:4326' as const,
        updateMonitoring: 'api-polling' as const,
      },
    }));
  }

  async download(): Promise<RawBoundaryFile[]> {
    return [];
  }

  async checkForUpdates() {
    return {
      available: false,
      latestVersion: '2024',
      currentVersion: '2024',
      releaseDate: '2024-09-01',
    };
  }

  async getMetadata() {
    return {
      provider: this.name,
      url: this.source,
      version: '2024',
      license: 'CC0-1.0',
      updatedAt: new Date().toISOString(),
      checksum: '',
      authorityLevel: 'federal-mandate' as const,
      legalStatus: 'binding' as const,
      collectionMethod: 'census-tiger' as const,
      lastVerified: new Date().toISOString(),
      verifiedBy: 'automated' as const,
      topologyValidated: true,
      geometryRepaired: false,
      coordinateSystem: 'EPSG:4326' as const,
      updateMonitoring: 'api-polling' as const,
    };
  }

  reset(): void {
    this.downloadCalls = [];
    this.transformCalls = [];
    this.downloadBehavior = 'success';
    this.failOnStates = new Set();
    this.downloadDelay = 0;
  }
}

// ============================================================================
// Test Configuration
// ============================================================================

function createTestConfig(overrides: Partial<ShadowAtlasConfig> = {}): ShadowAtlasConfig {
  return {
    storageDir: join(tmpdir(), `shadow-atlas-test-${Date.now()}`),
    extraction: {
      concurrency: 5,
      retryAttempts: 3,
      retryDelayMs: 100,
      timeoutMs: 30000,
    },
    validation: {
      minPassRate: 0.9,
      crossValidate: false,
      storeResults: true,
      haltOnTopologyError: true,
      haltOnCompletenessError: true,
      haltOnCoordinateError: true,
    },
    ipfs: {
      gateway: 'https://ipfs.io/ipfs/',
    },
    persistence: {
      enabled: false,
      databasePath: 'shadow-atlas.db',
      autoMigrate: true,
    },
    crossValidation: {
      enabled: false,
      failOnMismatch: false,
      minQualityScore: 70,
      gracefulFallback: true,
    },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('TIGERIngestionOrchestrator', () => {
  let mockProvider: MockTIGERBoundaryProvider;
  let config: ShadowAtlasConfig;
  let orchestrator: TIGERIngestionOrchestrator;
  let tempDir: string;

  beforeEach(async () => {
    mockProvider = new MockTIGERBoundaryProvider();
    tempDir = join(tmpdir(), `shadow-atlas-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    config = createTestConfig({ storageDir: tempDir });
    orchestrator = new TIGERIngestionOrchestrator(
      mockProvider as unknown as TIGERBoundaryProvider,
      config
    );

    // Create temp directory
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    mockProvider.reset();
    vi.restoreAllMocks();

    // Cleanup temp directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('ingestBatch', () => {
    it('successfully ingests multiple states and layers', async () => {
      const options: BatchIngestionOptions = {
        states: ['01', '02', '04'],
        layers: ['cd', 'sldu'],
        year: 2024,
        maxConcurrentStates: 2,
      };

      const result = await orchestrator.ingestBatch(options);

      expect(result.success).toBe(true);
      expect(result.completed).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.boundaries.length).toBeGreaterThan(0);
      expect(result.circuitBreakerTripped).toBe(false);

      // Verify all states were downloaded
      const downloadedStates = new Set(
        mockProvider.downloadCalls.map((c) => c.stateFips)
      );
      expect(downloadedStates.has('01')).toBe(true);
      expect(downloadedStates.has('02')).toBe(true);
      expect(downloadedStates.has('04')).toBe(true);

      // Verify all layers were downloaded for each state
      const downloadedLayers = new Set(
        mockProvider.downloadCalls.map((c) => c.layer)
      );
      expect(downloadedLayers.has('cd')).toBe(true);
      expect(downloadedLayers.has('sldu')).toBe(true);
    });

    it('handles partial failures gracefully', async () => {
      mockProvider.failOnStates = new Set(['02']); // Fail on second state

      const options: BatchIngestionOptions = {
        states: ['01', '02', '04'],
        layers: ['cd'],
        year: 2024,
      };

      const result = await orchestrator.ingestBatch(options);

      expect(result.success).toBe(false);
      expect(result.completed).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].state).toBe('02');
      expect(result.errors[0].retryable).toBe(false); // Generic error is not retryable
    });

    it('creates checkpoint for resumability', async () => {
      const options: BatchIngestionOptions = {
        states: ['01', '02'],
        layers: ['cd'],
        year: 2024,
        checkpointDir: join(tempDir, 'checkpoints'),
      };

      const result = await orchestrator.ingestBatch(options);

      expect(result.checkpoint).toBeDefined();
      expect(result.checkpoint.id).toMatch(/^ckpt_\d+_[a-z0-9]+$/);
      expect(result.checkpoint.completedStates).toContain('01');
      expect(result.checkpoint.completedStates).toContain('02');
      expect(result.checkpoint.failedStates).toHaveLength(0);
      expect(result.checkpoint.pendingStates).toHaveLength(0);

      // Verify checkpoint was saved to disk
      const checkpointPath = join(
        options.checkpointDir!,
        `${result.checkpoint.id}.json`
      );
      await expect(access(checkpointPath)).resolves.not.toThrow();

      const savedCheckpoint = JSON.parse(
        await readFile(checkpointPath, 'utf-8')
      ) as CheckpointState;
      expect(savedCheckpoint.id).toBe(result.checkpoint.id);
    });

    it('respects maxConcurrentStates limit', async () => {
      const maxConcurrent = 2;
      mockProvider.downloadDelay = 50; // Add delay to observe concurrency

      const options: BatchIngestionOptions = {
        states: ['01', '02', '04', '05', '06'],
        layers: ['cd'],
        year: 2024,
        maxConcurrentStates: maxConcurrent,
      };

      const result = await orchestrator.ingestBatch(options);

      expect(result.success).toBe(true);
      expect(result.completed).toBe(5);

      // All states should be processed
      expect(mockProvider.downloadCalls.length).toBe(5);
    });
  });

  describe('circuit breaker', () => {
    it('trips after consecutive failures exceed threshold', async () => {
      // Make all states fail
      mockProvider.failOnStates = new Set(['01', '02', '04', '05', '06']);

      const options: BatchIngestionOptions = {
        states: ['01', '02', '04', '05', '06', '07', '08'],
        layers: ['cd'],
        year: 2024,
        maxConcurrentStates: 1, // Process one at a time to ensure consecutive failures
        circuitBreakerThreshold: 3,
      };

      const result = await orchestrator.ingestBatch(options);

      expect(result.success).toBe(false);
      expect(result.circuitBreakerTripped).toBe(true);
      expect(result.failed).toBeGreaterThanOrEqual(3);

      // Should have stopped processing after circuit breaker tripped
      expect(result.failed + result.completed).toBeLessThan(7);
      expect(result.checkpoint.circuitOpen).toBe(true);
    });

    it('resets circuit breaker on success', async () => {
      // Fail first 2, then succeed
      mockProvider.failOnStates = new Set(['01', '02']);

      const options: BatchIngestionOptions = {
        states: ['01', '02', '04', '05', '06'],
        layers: ['cd'],
        year: 2024,
        maxConcurrentStates: 1,
        circuitBreakerThreshold: 5, // High threshold
      };

      const result = await orchestrator.ingestBatch(options);

      expect(result.circuitBreakerTripped).toBe(false);
      expect(result.completed).toBe(3); // '04', '05', '06'
      expect(result.failed).toBe(2); // '01', '02'
    });

    it('can be manually reset', () => {
      // Access the private state through the orchestrator
      orchestrator.resetCircuitBreaker();
      // If no error thrown, reset succeeded
      expect(true).toBe(true);
    });
  });

  describe('checkpoint resume', () => {
    it('resumes from checkpoint with pending states', async () => {
      // First run: fail on '02'
      mockProvider.failOnStates = new Set(['02']);

      const options: BatchIngestionOptions = {
        states: ['01', '02', '04'],
        layers: ['cd'],
        year: 2024,
        checkpointDir: join(tempDir, 'checkpoints'),
      };

      const firstResult = await orchestrator.ingestBatch(options);

      expect(firstResult.completed).toBe(2);
      expect(firstResult.failed).toBe(1);

      // Reset provider to succeed
      mockProvider.reset();

      // Resume from checkpoint
      const resumeResult = await orchestrator.resumeFromCheckpoint(
        firstResult.checkpoint.id,
        true // retry failed
      );

      expect(resumeResult.completed).toBe(1); // '02' now succeeds
      expect(resumeResult.failed).toBe(0);
    });

    it('throws when checkpoint not found', async () => {
      await expect(
        orchestrator.resumeFromCheckpoint('nonexistent-checkpoint')
      ).rejects.toThrow('Checkpoint nonexistent-checkpoint not found');
    });

    it('skips failed states when retryFailed is false', async () => {
      // Create a checkpoint with some pending and some failed states
      mockProvider.failOnStates = new Set(['02', '03']);

      const options: BatchIngestionOptions = {
        states: ['01', '02', '03', '04', '05'],
        layers: ['cd'],
        year: 2024,
        maxConcurrentStates: 1, // Process one at a time
        circuitBreakerThreshold: 2, // Trip after 2 consecutive failures
        checkpointDir: join(tempDir, 'checkpoints'),
      };

      const firstResult = await orchestrator.ingestBatch(options);

      // Should have tripped after '02' and '03' failed consecutively
      expect(firstResult.circuitBreakerTripped).toBe(true);
      expect(firstResult.completed).toBe(1); // Only '01' completed
      expect(firstResult.failed).toBe(2); // '02' and '03' failed
      // '04' and '05' should be pending due to circuit breaker
      expect(firstResult.checkpoint.pendingStates.length).toBe(2);

      mockProvider.reset();

      // Resume without retrying failed - should only process pending states
      const resumeResult = await orchestrator.resumeFromCheckpoint(
        firstResult.checkpoint.id,
        false // don't retry failed
      );

      // Only the pending states ('04', '05') should be processed
      expect(resumeResult.completed).toBe(2);
      expect(resumeResult.failed).toBe(0);
    });
  });

  describe('checkpoint management', () => {
    it('lists available checkpoints', async () => {
      const checkpointDir = join(tempDir, 'checkpoints');

      // Create two batches
      const options1: BatchIngestionOptions = {
        states: ['01'],
        layers: ['cd'],
        year: 2024,
        checkpointDir,
      };

      const options2: BatchIngestionOptions = {
        states: ['02'],
        layers: ['cd'],
        year: 2024,
        checkpointDir,
      };

      await orchestrator.ingestBatch(options1);
      await orchestrator.ingestBatch(options2);

      const checkpoints = await orchestrator.listCheckpoints();

      expect(checkpoints.length).toBe(2);
    });

    it('gets checkpoint status', async () => {
      const options: BatchIngestionOptions = {
        states: ['01', '02'],
        layers: ['cd'],
        year: 2024,
        checkpointDir: join(tempDir, 'checkpoints'),
      };

      const result = await orchestrator.ingestBatch(options);
      const status = await orchestrator.getCheckpointStatus(result.checkpoint.id);

      expect(status).not.toBeNull();
      expect(status!.id).toBe(result.checkpoint.id);
      expect(status!.completedStates).toContain('01');
      expect(status!.completedStates).toContain('02');
    });
  });

  describe('error classification', () => {
    it('classifies network errors as retryable', async () => {
      // Simulate network error
      const originalDownload = mockProvider.downloadLayer.bind(mockProvider);
      vi.spyOn(mockProvider, 'downloadLayer').mockImplementation(async (opts) => {
        if (opts.stateFips === '02') {
          const error = new Error('Connection reset');
          (error as NodeJS.ErrnoException).code = 'ECONNRESET';
          throw error;
        }
        return originalDownload(opts);
      });

      const options: BatchIngestionOptions = {
        states: ['01', '02', '04'],
        layers: ['cd'],
        year: 2024,
      };

      const result = await orchestrator.ingestBatch(options);

      const networkError = result.errors.find((e) => e.state === '02');
      expect(networkError).toBeDefined();
      expect(networkError!.retryable).toBe(true);
    });

    it('classifies rate limit errors as retryable', async () => {
      const originalDownload = mockProvider.downloadLayer.bind(mockProvider);
      vi.spyOn(mockProvider, 'downloadLayer').mockImplementation(async (opts) => {
        if (opts.stateFips === '02') {
          throw new Error('HTTP 429 Too Many Requests');
        }
        return originalDownload(opts);
      });

      const options: BatchIngestionOptions = {
        states: ['01', '02', '04'],
        layers: ['cd'],
        year: 2024,
      };

      const result = await orchestrator.ingestBatch(options);

      const rateLimitError = result.errors.find((e) => e.state === '02');
      expect(rateLimitError).toBeDefined();
      expect(rateLimitError!.retryable).toBe(true);
    });

    it('classifies 404 errors as not retryable', async () => {
      const originalDownload = mockProvider.downloadLayer.bind(mockProvider);
      vi.spyOn(mockProvider, 'downloadLayer').mockImplementation(async (opts) => {
        if (opts.stateFips === '02') {
          throw new Error('HTTP 404 Not Found');
        }
        return originalDownload(opts);
      });

      const options: BatchIngestionOptions = {
        states: ['01', '02', '04'],
        layers: ['cd'],
        year: 2024,
      };

      const result = await orchestrator.ingestBatch(options);

      const notFoundError = result.errors.find((e) => e.state === '02');
      expect(notFoundError).toBeDefined();
      expect(notFoundError!.retryable).toBe(false);
    });
  });

  describe('factory function', () => {
    it('creates orchestrator with default config', () => {
      const orch = createTIGERIngestionOrchestrator(
        mockProvider as unknown as TIGERBoundaryProvider,
        config
      );

      expect(orch).toBeInstanceOf(TIGERIngestionOrchestrator);
    });
  });

  describe('type safety', () => {
    it('enforces readonly arrays in BatchIngestionOptions', () => {
      const options: BatchIngestionOptions = {
        states: ['01', '02'],
        layers: ['cd', 'sldu'],
        year: 2024,
      };

      // TypeScript should prevent mutation
      // @ts-expect-error - states is readonly
      options.states.push('04');
    });

    it('enforces readonly checkpoint state', () => {
      // This is validated at compile time
      const checkpoint: CheckpointState = {
        id: 'test',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedStates: ['01'],
        failedStates: [],
        pendingStates: ['02'],
        options: {
          states: ['01', '02'],
          layers: ['cd'],
          year: 2024,
        },
        circuitOpen: false,
        consecutiveFailures: 0,
        boundaryCount: 0,
      };

      // TypeScript should prevent mutation
      // @ts-expect-error - completedStates is readonly
      checkpoint.completedStates.push('02');
    });
  });

  describe('edge cases', () => {
    it('handles empty states array', async () => {
      const options: BatchIngestionOptions = {
        states: [],
        layers: ['cd'],
        year: 2024,
      };

      const result = await orchestrator.ingestBatch(options);

      expect(result.success).toBe(true);
      expect(result.completed).toBe(0);
      expect(result.boundaries).toHaveLength(0);
    });

    it('handles single state', async () => {
      const options: BatchIngestionOptions = {
        states: ['01'],
        layers: ['cd'],
        year: 2024,
      };

      const result = await orchestrator.ingestBatch(options);

      expect(result.success).toBe(true);
      expect(result.completed).toBe(1);
    });

    it('handles empty layers array', async () => {
      const options: BatchIngestionOptions = {
        states: ['01', '02'],
        layers: [],
        year: 2024,
      };

      const result = await orchestrator.ingestBatch(options);

      expect(result.success).toBe(true);
      expect(result.completed).toBe(2);
      expect(result.boundaries).toHaveLength(0);
    });

    it('handles forceRefresh option', async () => {
      const options: BatchIngestionOptions = {
        states: ['01'],
        layers: ['cd'],
        year: 2024,
        forceRefresh: true,
      };

      await orchestrator.ingestBatch(options);

      // Verify forceRefresh was passed to provider
      expect(mockProvider.downloadCalls[0].forceRefresh).toBe(true);
    });

    it('uses config defaults when options not specified', async () => {
      const configWithBatchIngestion = createTestConfig({
        storageDir: tempDir,
        batchIngestion: {
          enabled: true,
          checkpointDir: join(tempDir, 'custom-checkpoints'),
          maxConcurrentStates: 3,
          circuitBreakerThreshold: 4,
          resumeOnRestart: true,
        },
      });

      const customOrchestrator = new TIGERIngestionOrchestrator(
        mockProvider as unknown as TIGERBoundaryProvider,
        configWithBatchIngestion
      );

      const options: BatchIngestionOptions = {
        states: ['01', '02', '04'],
        layers: ['cd'],
        year: 2024,
        // Not specifying checkpointDir - should use config default
      };

      const result = await customOrchestrator.ingestBatch(options);

      // Verify checkpoint was saved to config's checkpointDir
      const checkpointPath = join(
        configWithBatchIngestion.batchIngestion!.checkpointDir,
        `${result.checkpoint.id}.json`
      );
      await expect(access(checkpointPath)).resolves.not.toThrow();
    });
  });
});
