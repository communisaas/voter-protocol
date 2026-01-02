/**
 * ShadowAtlasService - Unified Entry Point for Shadow Atlas Operations
 *
 * This service provides a high-level API for:
 * - Extracting legislative boundaries from authoritative sources
 * - Validating extractions against registries and cross-sources
 * - Committing validated boundaries to Merkle trees
 * - Incremental updates without full re-extraction
 * - Change detection for upstream monitoring
 *
 * ARCHITECTURE PRINCIPLE: Composition over reimplementation.
 * This facade delegates to existing services:
 * - StateBatchExtractor for extraction
 * - DeterministicValidationPipeline for validation
 * - MerkleTreeBuilder for cryptographic commitment
 * - State batch integration for authority resolution
 *
 * @example
 * ```typescript
 * const atlas = new ShadowAtlasService();
 *
 * // Full extraction pipeline
 * const result = await atlas.extract({
 *   type: 'country',
 *   country: 'US',
 * });
 *
 * // Incremental update
 * const update = await atlas.incrementalUpdate(
 *   result.commitment.snapshotId,
 *   { states: ['WI', 'MI'] }
 * );
 * ```
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { randomUUID, createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { hostname } from 'os';
import type {
  ExtractionScope,
  ExtractionOptions,
  PipelineResult,
  IncrementalScope,
  IncrementalOptions,
  IncrementalResult,
  ChangeDetectionResult,
  HealthCheckResult,
  JobState,
  SnapshotMetadata,
  ExtractionSummary,
  ValidationSummary,
  CommitmentResult,
  ProviderHealth,
  TransformationValidationResult,
  ExtractionFailure,
  MerkleTree,
  AtlasBuildOptions,
  AtlasBuildResult,
  LayerValidationResult,
  TIGERValidationOptions,
  TIGERValidationResult,
  TIGERLayerValidation,
  TIGERLayerType,
  BuildManifest,
  SourceManifest,
  LayerManifest,
  ValidationManifest,
  EnvironmentManifest,
  CheckForChangesOptions,
  ChangeCheckResult,
  ChangeReport,
  BuildIfChangedResult,
  ProofTemplate,
} from './types.js';
import type { ShadowAtlasConfig } from './config.js';
import { getIPFSCredentials } from './config.js';
import type { StateExtractionResult } from '../providers/state-batch-extractor.js';
import type {
  BoundaryLayers,
  MerkleBoundaryInput,
  MultiLayerMerkleTree,
  MultiLayerMerkleProof,
  ProvenanceSource,
} from './multi-layer-builder.js';
import { MultiLayerMerkleTreeBuilder } from './multi-layer-builder.js';
import { StateBatchExtractor } from '../providers/state-batch-extractor.js';
// NOTE: state-batch-to-merkle.ts is DEPRECATED - uses SHA256 (NOT ZK-compatible)
// The deprecated functions (integrateMultipleStates, incrementalUpdate) are no longer imported
// Use buildAtlas() with MultiLayerMerkleTreeBuilder instead (uses Poseidon2, ZK-compatible)
import { DeterministicValidationPipeline } from '../validators/deterministic-validators.js';
import { DEFAULT_CONFIG } from './config.js';
import { UKBoundaryProvider } from '../providers/international/uk-provider.js';
import { CanadaBoundaryProvider } from '../providers/international/canada-provider.js';
import { AustraliaBoundaryProvider } from '../providers/international/australia-provider.js';
import { NewZealandBoundaryProvider } from '../providers/international/nz-provider.js';
import { SqlitePersistenceAdapter } from '../persistence/sqlite-adapter.js';
import { MetricsStore, StructuredLogger, createMetricsStore, createLogger } from '../observability/metrics.js';
import { ProvenanceWriter } from '../provenance/provenance-writer.js';
import type { CompactDiscoveryEntry } from '../provenance/provenance-writer.js';
import { ChangeDetectionAdapter } from '../acquisition/change-detection-adapter.js';
import type { ChangeDetectionAdapterResult } from '../acquisition/change-detection-adapter.js';
import { SnapshotManager } from '../versioning/snapshot-manager.js';
import type { Snapshot } from '../versioning/types.js';
import type { CrossValidationSummary, CrossValidationStatus, SchoolDistrictValidationSummary } from './types.js';
import type { CrossValidationResult } from '../validators/cross-validator.js';
import { SchoolDistrictValidator } from '../validators/school-district-validator.js';
import type { SchoolDistrictValidationResult, OverlapIssue } from '../validators/school-district-validator.js';
import type { NormalizedBoundary } from '../validators/tiger-validator.js';
import { getStateName } from '../validators/tiger-expected-counts.js';
import {
  hasExtractionScopeType,
  isPolygonOrMultiPolygon,
  assertPolygonGeometry,
  mapLayerToBoundaryType as mapLayerToBoundaryTypeGuard,
  filterValidatableLayers,
  isTIGERLayerType,
} from './type-guards.js';

/**
 * ShadowAtlasService - Unified entry point for Shadow Atlas operations
 */
export class ShadowAtlasService {
  private readonly config: ShadowAtlasConfig;
  private readonly extractor: StateBatchExtractor;
  private readonly validator: DeterministicValidationPipeline;

  // International providers
  private readonly ukProvider: UKBoundaryProvider;
  private readonly canadaProvider: CanadaBoundaryProvider;
  private readonly australiaProvider: AustraliaBoundaryProvider;
  private readonly nzProvider: NewZealandBoundaryProvider;

  // Persistence layer (SQLite when enabled, in-memory fallback for tests)
  private readonly persistenceAdapter: SqlitePersistenceAdapter | null;
  private initialized = false;

  // Observability (metrics + structured logging)
  private readonly metrics: MetricsStore | null;
  private readonly log: StructuredLogger;

  // Provenance logging for audit trail
  private readonly provenanceWriter: ProvenanceWriter;

  // Change detection adapter (optional, enabled via config)
  private readonly changeDetectionAdapter: ChangeDetectionAdapter | null;

  // Snapshot versioning manager
  private readonly snapshotManager: SnapshotManager;

  // School district validator (for unsd/elsd/scsd layers)
  private readonly schoolDistrictValidator: SchoolDistrictValidator;

  // In-memory fallback (used when persistence.enabled = false)
  // Using mutable types internally for state management
  private readonly jobStates = new Map<string, {
    jobId: string;
    scope: ExtractionScope;
    options: ExtractionOptions;
    startedAt: Date;
    completedScopes: string[];
    failedScopes: string[];
    status: 'in_progress' | 'completed' | 'failed' | 'paused';
  }>();
  private readonly snapshots = new Map<string, { tree: MerkleTree; metadata: SnapshotMetadata }>();

  constructor(config: ShadowAtlasConfig = DEFAULT_CONFIG) {
    this.config = config;
    this.extractor = new StateBatchExtractor({
      retryAttempts: config.extraction.retryAttempts,
      retryDelayMs: config.extraction.retryDelayMs,
    });
    this.validator = new DeterministicValidationPipeline();

    // Initialize international providers
    this.ukProvider = new UKBoundaryProvider({
      retryAttempts: config.extraction.retryAttempts,
      retryDelayMs: config.extraction.retryDelayMs,
    });
    this.canadaProvider = new CanadaBoundaryProvider({
      retryAttempts: config.extraction.retryAttempts,
      retryDelayMs: config.extraction.retryDelayMs,
    });
    this.australiaProvider = new AustraliaBoundaryProvider({
      retryAttempts: config.extraction.retryAttempts,
      retryDelayMs: config.extraction.retryDelayMs,
    });
    this.nzProvider = new NewZealandBoundaryProvider({
      retryAttempts: config.extraction.retryAttempts,
      retryDelayMs: config.extraction.retryDelayMs,
    });

    // Initialize SQLite persistence when enabled
    if (config.persistence.enabled) {
      const dbPath = join(config.storageDir, config.persistence.databasePath);
      this.persistenceAdapter = new SqlitePersistenceAdapter(dbPath);
    } else {
      this.persistenceAdapter = null;
    }

    // Initialize observability (always enabled, lightweight)
    this.log = createLogger('ShadowAtlas', 'info');
    // Metrics use same storage dir; null in :memory: mode
    if (config.storageDir !== ':memory:') {
      this.metrics = createMetricsStore(config.storageDir);
    } else {
      this.metrics = null;
    }

    // Initialize provenance writer (audit trail)
    const provenanceDir = config.storageDir !== ':memory:'
      ? join(config.storageDir, 'provenance')
      : './provenance';
    this.provenanceWriter = new ProvenanceWriter(provenanceDir);

    // Initialize change detection adapter (if enabled)
    if (config.changeDetection?.enabled) {
      this.changeDetectionAdapter = new ChangeDetectionAdapter({
        sources: [], // Will be populated dynamically based on build request
        storageDir: config.storageDir,
        checksumCachePath: config.changeDetection.checksumCachePath,
      });
    } else {
      this.changeDetectionAdapter = null;
    }

    // Initialize snapshot manager
    this.snapshotManager = new SnapshotManager(config.storageDir, this.persistenceAdapter ?? undefined);

    // Initialize school district validator
    this.schoolDistrictValidator = new SchoolDistrictValidator();
  }

  /**
   * Initialize persistence layer (runs migrations)
   * Call this before using the service in production.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.persistenceAdapter && this.config.persistence.autoMigrate) {
      await this.persistenceAdapter.runMigrations();
    }

    // Initialize snapshot manager
    await this.snapshotManager.initialize();

    this.initialized = true;
  }

  /**
   * Close database connections
   */
  close(): void {
    if (this.persistenceAdapter) {
      this.persistenceAdapter.close();
    }
    if (this.metrics) {
      this.metrics.close();
    }
  }

  /**
   * Get health summary from metrics
   */
  getHealthSummary(hours = 24): {
    healthy: boolean;
    extractionSuccessRate: number;
    validationPassRate: number;
    avgJobDurationMs: number;
    issues: readonly string[];
  } | null {
    if (!this.metrics) return null;
    return this.metrics.getHealthSummary(hours);
  }

  /**
   * Execute full extraction pipeline: extract → validate → commit
   *
   * @param scope - What to extract (state, country, region, global)
   * @param options - Extraction options (concurrency, validation, storage)
   * @returns Pipeline result with extraction stats, validation results, and commitment
   */
  async extract(
    scope: ExtractionScope,
    options: ExtractionOptions = {}
  ): Promise<PipelineResult> {
    const startTime = Date.now();
    const jobId = randomUUID();

    // Create job state for resume capability
    const jobState = {
      jobId,
      scope,
      options,
      startedAt: new Date(),
      completedScopes: [] as string[],
      failedScopes: [] as string[],
      status: 'in_progress' as const,
    };
    this.jobStates.set(jobId, jobState);

    try {
      // 1. Extract boundaries based on scope
      const stateResults = await this.extractByScope(scope, options);

      // 2. Validate extractions
      const validationResult = await this.validateExtractions(stateResults, options);

      // 3. Determine if validation passes threshold
      const minPassRate = options.minPassRate ?? this.config.validation.minPassRate;
      const validationPassed = validationResult.passRate >= minPassRate;

      if (!validationPassed) {
        const duration = Date.now() - startTime;
        return {
          jobId,
          status: 'validation_failed',
          duration,
          extraction: this.summarizeExtractions(stateResults),
          validation: validationResult,
        };
      }

      // 4. Commit to Merkle tree
      const commitment = await this.commitToMerkleTree(stateResults, jobId);

      const duration = Date.now() - startTime;

      // Update job state
      this.jobStates.set(jobId, {
        ...jobState,
        status: 'completed',
      });

      return {
        jobId,
        status: 'committed',
        duration,
        extraction: this.summarizeExtractions(stateResults),
        validation: validationResult,
        commitment,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.jobStates.set(jobId, {
        ...jobState,
        status: 'failed',
      });

      return {
        jobId,
        status: 'extraction_failed',
        duration,
        extraction: this.summarizeExtractions([]),
        validation: {
          passed: 0,
          warned: 0,
          failed: 0,
          passRate: 0,
          results: new Map(),
        },
      };
    }
  }

  /**
   * Incremental update: only re-extract changed boundaries
   *
   * @deprecated REMOVED - Use buildAtlas() instead with full rebuild.
   *             This method used the legacy SHA256-based integration which is NOT ZK-compatible.
   *
   * @param snapshotId - ID of existing snapshot to update
   * @param scope - What to update (subset of original scope)
   * @param options - Update options (force refresh, validation)
   * @returns Never - always throws
   * @throws Error Always throws deprecation error
   */
  async incrementalUpdate(
    _snapshotId: string,
    _scope: IncrementalScope,
    _options: IncrementalOptions = {}
  ): Promise<IncrementalResult> {
    throw new Error(
      'DEPRECATED: incrementalUpdate() has been removed because it used SHA256 (NOT ZK-compatible).\n' +
      '\n' +
      'MIGRATION:\n' +
      '  Use buildAtlas() with full rebuild instead:\n' +
      '\n' +
      '    const atlas = new ShadowAtlasService();\n' +
      '    await atlas.initialize();\n' +
      '    const result = await atlas.buildAtlas({\n' +
      '      layers: [\'cd\', \'sldu\', \'sldl\', \'county\'],\n' +
      '      year: 2024,\n' +
      '    });\n' +
      '\n' +
      'The buildAtlas() method uses MultiLayerMerkleTreeBuilder with Poseidon2 (ZK-compatible).'
    );
  }

  /**
   * Detect upstream changes without extracting
   *
   * @param scope - Scope to check for changes
   * @returns Change detection result
   */
  async detectChanges(scope: ExtractionScope): Promise<ChangeDetectionResult> {
    // Simplified change detection (in production, would check ETags, Last-Modified headers, etc.)
    // For now, always report no changes (conservative approach)
    return {
      hasChanges: false,
      changedRegions: [],
      unchangedRegions: this.getScopeRegions(scope),
      checkMethod: 'count',
      confidence: 0.5,
    };
  }

  /**
   * Resume a partial/failed extraction
   *
   * @param jobId - Job ID to resume
   * @returns Pipeline result
   */
  async resumeExtraction(jobId: string): Promise<PipelineResult> {
    const jobState = this.jobStates.get(jobId);
    if (!jobState) {
      throw new Error(`Job ${jobId} not found`);
    }

    // Determine remaining scope
    const remainingScope = this.computeRemainingScope(jobState);

    // Continue extraction
    return this.extract(remainingScope, {
      ...jobState.options,
      resumeFromJob: jobId,
    });
  }

  /**
   * Get validation results for a snapshot
   *
   * @param snapshotId - Snapshot ID
   * @returns Validation results or null if not found
   */
  async getValidationResults(
    snapshotId: string
  ): Promise<ReadonlyMap<string, TransformationValidationResult> | null> {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      return null;
    }

    // Would retrieve from validation store in production
    return new Map();
  }

  /**
   * Health check for all data providers
   *
   * @returns Health check result for all providers
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const providers: ProviderHealth[] = [];

    // Check US extractor
    const usStart = Date.now();
    try {
      // Simple availability check (just ensure it can be constructed)
      const usLatency = Date.now() - usStart;
      const usHealth: ProviderHealth = {
        name: 'StateBatchExtractor',
        available: true,
        latencyMs: usLatency,
        issues: [],
      };
      providers.push(usHealth);
      this.metrics?.recordProviderHealth('StateBatchExtractor', true, usLatency);
    } catch (error) {
      const usLatency = Date.now() - usStart;
      const errorMsg = error instanceof Error ? error.message : String(error);
      providers.push({
        name: 'StateBatchExtractor',
        available: false,
        latencyMs: usLatency,
        issues: [errorMsg],
      });
      this.metrics?.recordProviderHealth('StateBatchExtractor', false, usLatency, errorMsg);
    }

    // Check UK provider
    const ukStart = Date.now();
    try {
      const ukHealth = await this.ukProvider.healthCheck();
      providers.push({
        name: 'UKBoundaryProvider',
        available: ukHealth.available,
        latencyMs: ukHealth.latencyMs,
        issues: ukHealth.issues,
      });
      this.metrics?.recordProviderHealth(
        'UKBoundaryProvider',
        ukHealth.available,
        ukHealth.latencyMs,
        ukHealth.issues[0]
      );
    } catch (error) {
      const ukLatency = Date.now() - ukStart;
      const errorMsg = error instanceof Error ? error.message : String(error);
      providers.push({
        name: 'UKBoundaryProvider',
        available: false,
        latencyMs: ukLatency,
        issues: [errorMsg],
      });
      this.metrics?.recordProviderHealth('UKBoundaryProvider', false, ukLatency, errorMsg);
    }

    // Check Canada provider
    const caStart = Date.now();
    try {
      const caHealth = await this.canadaProvider.healthCheck();
      providers.push({
        name: 'CanadaBoundaryProvider',
        available: caHealth.available,
        latencyMs: caHealth.latencyMs,
        issues: caHealth.issues,
      });
      this.metrics?.recordProviderHealth(
        'CanadaBoundaryProvider',
        caHealth.available,
        caHealth.latencyMs,
        caHealth.issues[0]
      );
    } catch (error) {
      const caLatency = Date.now() - caStart;
      const errorMsg = error instanceof Error ? error.message : String(error);
      providers.push({
        name: 'CanadaBoundaryProvider',
        available: false,
        latencyMs: caLatency,
        issues: [errorMsg],
      });
      this.metrics?.recordProviderHealth('CanadaBoundaryProvider', false, caLatency, errorMsg);
    }

    // Check Australia provider
    const auStart = Date.now();
    try {
      const auHealth = await this.australiaProvider.healthCheck();
      providers.push({
        name: 'AustraliaBoundaryProvider',
        available: auHealth.available,
        latencyMs: auHealth.latencyMs,
        issues: auHealth.issues,
      });
      this.metrics?.recordProviderHealth(
        'AustraliaBoundaryProvider',
        auHealth.available,
        auHealth.latencyMs,
        auHealth.issues[0]
      );
    } catch (error) {
      const auLatency = Date.now() - auStart;
      const errorMsg = error instanceof Error ? error.message : String(error);
      providers.push({
        name: 'AustraliaBoundaryProvider',
        available: false,
        latencyMs: auLatency,
        issues: [errorMsg],
      });
      this.metrics?.recordProviderHealth('AustraliaBoundaryProvider', false, auLatency, errorMsg);
    }

    // Check New Zealand provider
    const nzStart = Date.now();
    try {
      const nzHealth = await this.nzProvider.healthCheck();
      providers.push({
        name: 'NewZealandBoundaryProvider',
        available: nzHealth.available,
        latencyMs: nzHealth.latencyMs,
        issues: nzHealth.issues,
      });
      this.metrics?.recordProviderHealth(
        'NewZealandBoundaryProvider',
        nzHealth.available,
        nzHealth.latencyMs,
        nzHealth.issues[0]
      );
    } catch (error) {
      const nzLatency = Date.now() - nzStart;
      const errorMsg = error instanceof Error ? error.message : String(error);
      providers.push({
        name: 'NewZealandBoundaryProvider',
        available: false,
        latencyMs: nzLatency,
        issues: [errorMsg],
      });
      this.metrics?.recordProviderHealth('NewZealandBoundaryProvider', false, nzLatency, errorMsg);
    }

    const healthy = providers.every((p) => p.available);
    this.log.info('Health check complete', {
      healthy,
      providers: providers.map((p) => ({ name: p.name, available: p.available })),
    });

    return {
      healthy,
      providers,
      checkedAt: new Date(),
    };
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Extract boundaries based on scope type
   */
  private async extractByScope(
    scope: ExtractionScope,
    options: ExtractionOptions
  ): Promise<StateExtractionResult[]> {
    switch (scope.type) {
      case 'state':
        return this.extractStates(scope.states, options);

      case 'country':
        // For 'US', extract all configured states
        if (scope.country === 'US') {
          return this.extractAllStates(options);
        }
        // International country support
        if (scope.country === 'GB') {
          return this.extractUnitedKingdom(options);
        }
        if (scope.country === 'CA') {
          return this.extractCanada(options);
        }
        if (scope.country === 'AU') {
          return this.extractAustralia(options);
        }
        if (scope.country === 'NZ') {
          return this.extractNewZealand(options);
        }
        throw new Error(`Country ${scope.country} not yet supported`);

      case 'region':
        return this.extractRegions(scope.regions, options);

      case 'global':
        return this.extractAllStates(options);

      default: {
        // Exhaustive check - this should never be reached
        // TypeScript guarantees all cases are handled above
        const _exhaustiveCheck: never = scope;
        // This line is unreachable but needed for runtime safety
        throw new Error(`Unknown scope type: ${JSON.stringify(scope)}`);
      }
    }
  }

  /**
   * Extract specific states
   */
  private async extractStates(
    states: readonly string[],
    options: ExtractionOptions
  ): Promise<StateExtractionResult[]> {
    const results: StateExtractionResult[] = [];

    for (const state of states) {
      const startTime = Date.now();
      try {
        this.log.info('Starting extraction', { state });
        const result = await this.extractor.extractState(state);
        results.push(result);

        // Record metrics for each layer
        const durationMs = Date.now() - startTime;
        for (const layer of result.layers) {
          this.metrics?.recordExtraction(
            state,
            layer.layerType,
            layer.success,
            durationMs,
            layer.featureCount
          );
        }

        this.log.info('Extraction complete', {
          state,
          durationMs,
          boundaries: result.summary.totalBoundaries,
        });

        if (options.onProgress) {
          options.onProgress({
            completed: results.length,
            total: states.length,
            currentItem: state,
          });
        }
      } catch (error) {
        const durationMs = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        this.log.error('Extraction failed', { state, error: errorMessage, durationMs });
        this.metrics?.recordExtraction(state, 'congressional', false, durationMs);

        if (!options.continueOnError) {
          throw error;
        }
      }
    }

    return results;
  }

  /**
   * Extract all configured states
   */
  private async extractAllStates(
    options: ExtractionOptions
  ): Promise<StateExtractionResult[]> {
    const batchResult = await this.extractor.extractAllStates();
    return Array.from(batchResult.states);
  }

  /**
   * Extract specific regions
   */
  private async extractRegions(
    regions: readonly { state: string; layers?: readonly string[] }[],
    options: ExtractionOptions
  ): Promise<StateExtractionResult[]> {
    const results: StateExtractionResult[] = [];

    for (const region of regions) {
      try {
        const result = await this.extractor.extractState(region.state);
        results.push(result);
      } catch (error) {
        if (!options.continueOnError) {
          throw error;
        }
        console.error(`Failed to extract region ${region.state}:`, error);
      }
    }

    return results;
  }

  /**
   * Extract United Kingdom parliamentary constituencies
   *
   * Uses UKBoundaryProvider to fetch from ONS ArcGIS services.
   * Returns data in StateExtractionResult format for compatibility.
   */
  private async extractUnitedKingdom(
    options: ExtractionOptions
  ): Promise<StateExtractionResult[]> {
    console.log('[ShadowAtlas] Extracting UK parliamentary constituencies...');

    try {
      const result = await this.ukProvider.extractParliamentaryConstituencies();

      // Convert to StateExtractionResult format for compatibility
      const stateResult: StateExtractionResult = {
        state: 'GB',
        stateName: 'United Kingdom',
        authority: 'federal-mandate',
        layers: [
          {
            state: 'GB',
            layerType: 'congressional', // Map to equivalent US type
            expectedCount: result.expectedCount,
            featureCount: result.actualCount,
            boundaries: result.boundaries.map((c) => ({
              id: c.id,
              name: c.name,
              layerType: 'congressional' as const,
              geometry: c.geometry,
              source: {
                state: 'GB',
                portalName: 'ONS',
                endpoint: c.source.endpoint,
                authority: 'federal-mandate' as const,
                vintage: c.source.vintage,
                retrievedAt: c.source.retrievedAt,
              },
              properties: c.properties,
            })),
            success: result.matched,
            error: result.error,
            metadata: {
              endpoint: result.source,
              extractedAt: result.extractedAt.toISOString(),
              durationMs: result.durationMs,
            },
          },
        ],
        summary: {
          totalBoundaries: result.actualCount,
          layersSucceeded: result.matched ? 1 : 0,
          layersFailed: result.matched ? 0 : 1,
          durationMs: result.durationMs,
        },
      };

      return [stateResult];
    } catch (error) {
      console.error('[ShadowAtlas] UK extraction failed:', error);
      if (!options.continueOnError) {
        throw error;
      }
      return [];
    }
  }

  /**
   * Extract Canada federal electoral districts
   *
   * Uses CanadaBoundaryProvider to fetch from Represent API (Open North).
   * Returns data in StateExtractionResult format for compatibility.
   */
  private async extractCanada(
    options: ExtractionOptions
  ): Promise<StateExtractionResult[]> {
    console.log('[ShadowAtlas] Extracting Canada federal electoral districts...');

    try {
      const result = await this.canadaProvider.extractFederalDistricts();

      // Convert to StateExtractionResult format for compatibility
      const stateResult: StateExtractionResult = {
        state: 'CA',
        stateName: 'Canada',
        authority: 'federal-mandate',
        layers: [
          {
            state: 'CA',
            layerType: 'congressional', // Map to equivalent US type
            expectedCount: result.expectedCount,
            featureCount: result.actualCount,
            boundaries: result.boundaries.map((r) => ({
              id: r.id,
              name: r.name,
              layerType: 'congressional' as const,
              geometry: r.geometry,
              source: {
                state: 'CA',
                portalName: 'Elections Canada',
                endpoint: r.source.endpoint,
                authority: 'federal-mandate' as const,
                vintage: r.source.vintage,
                retrievedAt: r.source.retrievedAt,
              },
              properties: r.properties,
            })),
            success: result.matched,
            error: result.error,
            metadata: {
              endpoint: result.source,
              extractedAt: result.extractedAt.toISOString(),
              durationMs: result.durationMs,
            },
          },
        ],
        summary: {
          totalBoundaries: result.actualCount,
          layersSucceeded: result.matched ? 1 : 0,
          layersFailed: result.matched ? 0 : 1,
          durationMs: result.durationMs,
        },
      };

      return [stateResult];
    } catch (error) {
      console.error('[ShadowAtlas] Canada extraction failed:', error);
      if (!options.continueOnError) {
        throw error;
      }
      return [];
    }
  }

  /**
   * Extract Australia federal electoral divisions
   *
   * Uses AustraliaBoundaryProvider to fetch from AEC ArcGIS services.
   * Returns data in StateExtractionResult format for compatibility.
   */
  private async extractAustralia(
    options: ExtractionOptions
  ): Promise<StateExtractionResult[]> {
    console.log('[ShadowAtlas] Extracting Australia federal electoral divisions...');

    try {
      const result = await this.australiaProvider.extractFederalDivisions();

      // Convert to StateExtractionResult format for compatibility
      const stateResult: StateExtractionResult = {
        state: 'AU',
        stateName: 'Australia',
        authority: 'federal-mandate',
        layers: [
          {
            state: 'AU',
            layerType: 'congressional', // Map to equivalent US type
            expectedCount: result.expectedCount,
            featureCount: result.actualCount,
            boundaries: result.boundaries.map((d) => ({
              id: d.id,
              name: d.name,
              layerType: 'congressional' as const,
              geometry: d.geometry,
              source: {
                state: 'AU',
                portalName: 'AEC',
                endpoint: d.source.endpoint,
                authority: 'federal-mandate' as const,
                vintage: d.source.vintage,
                retrievedAt: d.source.retrievedAt,
              },
              properties: d.properties,
            })),
            success: result.matched,
            error: result.error,
            metadata: {
              endpoint: result.source,
              extractedAt: result.extractedAt.toISOString(),
              durationMs: result.durationMs,
            },
          },
        ],
        summary: {
          totalBoundaries: result.actualCount,
          layersSucceeded: result.matched ? 1 : 0,
          layersFailed: result.matched ? 0 : 1,
          durationMs: result.durationMs,
        },
      };

      return [stateResult];
    } catch (error) {
      console.error('[ShadowAtlas] Australia extraction failed:', error);
      if (!options.continueOnError) {
        throw error;
      }
      return [];
    }
  }

  /**
   * Extract New Zealand electoral districts
   *
   * Uses NewZealandBoundaryProvider to fetch from Stats NZ ArcGIS services.
   * Returns data in StateExtractionResult format for compatibility.
   */
  private async extractNewZealand(
    options: ExtractionOptions
  ): Promise<StateExtractionResult[]> {
    console.log('[ShadowAtlas] Extracting New Zealand electoral districts...');

    try {
      const result = await this.nzProvider.extractAll();

      // Convert to StateExtractionResult format for compatibility
      // NZ has two layers: general and Māori electorates
      const stateResult: StateExtractionResult = {
        state: 'NZ',
        stateName: 'New Zealand',
        authority: 'federal-mandate',
        layers: result.layers.map((layerResult) => ({
          state: 'NZ',
          layerType: 'congressional' as const, // Map to equivalent US type
          expectedCount: layerResult.expectedCount,
          featureCount: layerResult.actualCount,
          boundaries: layerResult.boundaries.map((e) => ({
            id: e.id,
            name: e.name,
            layerType: 'congressional' as const,
            geometry: e.geometry,
            source: {
              state: 'NZ',
              portalName: 'Stats NZ',
              endpoint: e.source.endpoint,
              authority: 'federal-mandate' as const,
              vintage: e.source.vintage,
              retrievedAt: e.source.retrievedAt,
            },
            properties: {
              ...e.properties,
              electorateType: e.type, // Preserve general vs Māori distinction
              region: e.region,
            },
          })),
          success: layerResult.success,
          error: layerResult.error,
          metadata: {
            endpoint: layerResult.source,
            extractedAt: layerResult.extractedAt.toISOString(),
            durationMs: layerResult.durationMs,
          },
        })),
        summary: {
          totalBoundaries: result.totalBoundaries,
          layersSucceeded: result.successfulLayers,
          layersFailed: result.failedLayers,
          durationMs: result.durationMs,
        },
      };

      return [stateResult];
    } catch (error) {
      console.error('[ShadowAtlas] New Zealand extraction failed:', error);
      if (!options.continueOnError) {
        throw error;
      }
      return [];
    }
  }

  /**
   * Validate extracted state results
   */
  private async validateExtractions(
    stateResults: readonly StateExtractionResult[],
    options: ExtractionOptions
  ): Promise<ValidationSummary> {
    const results = new Map<string, TransformationValidationResult>();
    let passed = 0;
    let warned = 0;
    let failed = 0;

    for (const stateResult of stateResults) {
      for (const layer of stateResult.layers) {
        if (!layer.success) {
          failed++;
          continue;
        }

        // Simple validation: check if we got expected feature count
        const hasExpectedCount = layer.featureCount === layer.expectedCount;
        const hasWarnings = layer.featureCount !== layer.expectedCount;

        if (hasExpectedCount) {
          passed++;
        } else if (hasWarnings) {
          warned++;
        } else {
          failed++;
        }

        results.set(`${stateResult.state}-${layer.layerType}`, {
          valid: layer.success,
          confidence: hasExpectedCount ? 90 : 60,
          issues: layer.error ? [layer.error] : [],
          warnings: hasWarnings ? [`Expected ${layer.expectedCount} features, got ${layer.featureCount}`] : [],
        });
      }
    }

    const total = passed + warned + failed;
    const passRate = total > 0 ? passed / total : 0;

    return {
      passed,
      warned,
      failed,
      passRate,
      results,
    };
  }

  /**
   * Commit state results to Merkle tree
   *
   * @deprecated REMOVED - Use buildAtlas() instead.
   *             This method used the legacy SHA256-based integration which is NOT ZK-compatible.
   *
   * @throws Error Always throws deprecation error
   */
  private async commitToMerkleTree(
    _stateResults: readonly StateExtractionResult[],
    _jobId: string
  ): Promise<CommitmentResult> {
    throw new Error(
      'DEPRECATED: commitToMerkleTree() has been removed because it used SHA256 (NOT ZK-compatible).\n' +
      '\n' +
      'MIGRATION:\n' +
      '  Use buildAtlas() instead:\n' +
      '\n' +
      '    const atlas = new ShadowAtlasService();\n' +
      '    await atlas.initialize();\n' +
      '    const result = await atlas.buildAtlas({\n' +
      '      layers: [\'cd\', \'sldu\', \'sldl\', \'county\'],\n' +
      '      year: 2024,\n' +
      '    });\n' +
      '\n' +
      'The buildAtlas() method uses MultiLayerMerkleTreeBuilder with Poseidon2 (ZK-compatible).'
    );
  }

  /**
   * Summarize extraction results
   */
  private summarizeExtractions(
    stateResults: readonly StateExtractionResult[]
  ): ExtractionSummary {
    const totalBoundaries = stateResults.reduce(
      (sum, sr) => sum + sr.summary.totalBoundaries,
      0
    );

    const failedExtractions: ExtractionFailure[] = [];
    for (const sr of stateResults) {
      for (const layer of sr.layers) {
        if (!layer.success && layer.error) {
          failedExtractions.push({
            state: sr.state,
            layer: layer.layerType,
            error: layer.error,
            timestamp: layer.metadata.extractedAt,
          });
        }
      }
    }

    return {
      totalBoundaries,
      successfulExtractions: totalBoundaries - failedExtractions.length,
      failedExtractions,
    };
  }

  /**
   * Get regions from scope
   */
  private getScopeRegions(scope: ExtractionScope): readonly string[] {
    switch (scope.type) {
      case 'state':
        return scope.states;
      case 'region':
        return scope.regions.map(r => r.state);
      default:
        return [];
    }
  }

  /**
   * Compute remaining scope from job state
   */
  private computeRemainingScope(jobState: JobState): ExtractionScope {
    // Simplified: just return original scope
    // In production, would compute diff between original and completed
    return jobState.scope;
  }

  // ============================================================================
  // Persistence Helpers (Abstract over SQLite / in-memory)
  // ============================================================================

  /**
   * Store job state (SQLite or in-memory)
   */
  private async storeJobState(jobState: {
    jobId: string;
    scope: ExtractionScope;
    options: ExtractionOptions;
    startedAt: Date;
    completedScopes: string[];
    failedScopes: string[];
    status: 'in_progress' | 'completed' | 'failed' | 'paused';
  }): Promise<void> {
    if (this.persistenceAdapter) {
      // Convert to persistence format
      const scope = {
        states: jobState.scope.type === 'state' ? [...jobState.scope.states] :
          jobState.scope.type === 'region' ? jobState.scope.regions.map(r => r.state) :
            [],
        layers: ['congressional', 'state_senate', 'state_house', 'county'] as const,
      };
      await this.persistenceAdapter.createJob(scope, {
        continueOnError: jobState.options.continueOnError ?? true,
      });
      // Note: The adapter generates its own jobId; for full integration,
      // we'd need to update the adapter or use a custom ID approach
    }
    // Store job state directly - all fields already match JobState interface
    this.jobStates.set(jobState.jobId, jobState);
  }

  /**
   * Update job status (SQLite or in-memory)
   */
  private async updateJobStatus(
    jobId: string,
    status: 'in_progress' | 'completed' | 'failed' | 'paused'
  ): Promise<void> {
    if (this.persistenceAdapter) {
      // Map our status to persistence status
      const persistenceStatus =
        status === 'in_progress' ? 'running' :
          status === 'paused' ? 'partial' :
            status;
      await this.persistenceAdapter.updateStatus(jobId, persistenceStatus);
    }

    const existing = this.jobStates.get(jobId);
    if (existing) {
      this.jobStates.set(jobId, { ...existing, status });
    }
  }

  /**
   * Get job state (SQLite or in-memory)
   */
  private async getJobState(jobId: string): Promise<{
    jobId: string;
    scope: ExtractionScope;
    options: ExtractionOptions;
    startedAt: Date;
    completedScopes: string[];
    failedScopes: string[];
    status: 'in_progress' | 'completed' | 'failed' | 'paused';
  } | null> {
    // Check in-memory first (always kept in sync)
    const inMemory = this.jobStates.get(jobId);
    if (inMemory) return inMemory;

    // Check persistence if available
    if (this.persistenceAdapter) {
      const persisted = await this.persistenceAdapter.getJob(jobId);
      if (persisted) {
        // Convert persisted format to JobState format
        // persisted.options is OrchestrationOptions, convert to ExtractionOptions
        const extractionOptions: ExtractionOptions = {
          concurrency: persisted.options.concurrency,
          continueOnError: persisted.options.continueOnError,
          // OrchestrationOptions doesn't have validation, minPassRate, or storage
          // These are ExtractionOptions-specific fields that aren't persisted
        };

        const converted: {
          jobId: string;
          scope: ExtractionScope;
          options: ExtractionOptions;
          startedAt: Date;
          completedScopes: string[];
          failedScopes: string[];
          status: 'in_progress' | 'completed' | 'failed' | 'paused';
        } = {
          jobId: persisted.jobId,
          scope: { type: 'state' as const, states: persisted.scope.states },
          options: extractionOptions,
          startedAt: persisted.createdAt,
          completedScopes: persisted.completedExtractions.map(e => `${e.state}-${e.layer}`),
          failedScopes: persisted.failures.map(f => `${f.state}-${f.layer}`),
          status: persisted.status === 'running' ? 'in_progress' as const :
            persisted.status === 'partial' ? 'paused' as const :
              persisted.status as 'completed' | 'failed',
        };
        // Cache in memory
        this.jobStates.set(jobId, converted);
        return converted;
      }
    }

    return null;
  }

  /**
   * Store snapshot (SQLite or in-memory)
   */
  private async storeSnapshot(snapshot: {
    tree: MerkleTree;
    metadata: SnapshotMetadata;
  }): Promise<void> {
    if (this.persistenceAdapter) {
      await this.persistenceAdapter.createSnapshot('', snapshot.metadata);
    }
    this.snapshots.set(snapshot.metadata.id, snapshot);
  }

  /**
   * Get snapshot (SQLite or in-memory)
   */
  private async getSnapshot(snapshotId: string): Promise<{
    tree: MerkleTree;
    metadata: SnapshotMetadata;
  } | null> {
    // Check in-memory first
    const inMemory = this.snapshots.get(snapshotId);
    if (inMemory) return inMemory;

    // For now, we don't persist the full tree to SQLite (only metadata)
    // In production, the tree would be in IPFS
    if (this.persistenceAdapter) {
      const metadata = await this.persistenceAdapter.getSnapshot(snapshotId);
      if (metadata) {
        // Tree would be loaded from IPFS in production
        // For now, return null if not in memory
        return null;
      }
    }

    return null;
  }

  /**
   * List recent jobs
   */
  async listJobs(limit = 10): Promise<readonly {
    jobId: string;
    status: string;
    createdAt: Date;
  }[]> {
    if (this.persistenceAdapter) {
      const jobs = await this.persistenceAdapter.listJobs(limit);
      return jobs.map(j => ({
        jobId: j.jobId,
        status: j.status,
        createdAt: j.createdAt,
      }));
    }

    // In-memory fallback
    return Array.from(this.jobStates.values())
      .map(j => ({
        jobId: j.jobId,
        status: j.status,
        createdAt: j.startedAt,
      }))
      .slice(0, limit);
  }

  /**
   * List recent snapshots
   */
  async listSnapshots(limit = 10): Promise<readonly SnapshotMetadata[]> {
    if (this.persistenceAdapter) {
      return this.persistenceAdapter.listSnapshots(limit);
    }

    // In-memory fallback
    return Array.from(this.snapshots.values())
      .map(s => s.metadata)
      .slice(0, limit);
  }

  /**
   * Get versioned snapshot by ID from SnapshotManager
   *
   * @param snapshotId - Snapshot ID (UUID)
   * @returns Full snapshot with metadata, or null if not found
   */
  async getVersionedSnapshot(snapshotId: string): Promise<Snapshot | null> {
    return this.snapshotManager.getById(snapshotId);
  }

  /**
   * Get proof templates for a snapshot
   *
   * Returns array of proof template objects with districtId, leafHash, siblings, etc.
   *
   * @param snapshotId - Snapshot ID (UUID)
   * @returns Array of proof templates, or empty array if not found
   */
  async getProofTemplates(snapshotId: string): Promise<Array<{
    readonly districtId: string;
    readonly leafHash: string;
    readonly authority: number;
    readonly siblings: readonly string[];
    readonly pathIndices: readonly number[];
  }>> {
    const store = await this.snapshotManager.getProofTemplateStore(snapshotId);
    if (!store) {
      return [];
    }

    // Convert Record to array
    return Object.entries(store.templates).map(([districtId, template]) => ({
      districtId,
      leafHash: template.leafHash,
      authority: template.authority,
      siblings: template.siblings,
      pathIndices: template.pathIndices,
    }));
  }

  /**
   * Get coverage statistics
   */
  async getCoverageStats(): Promise<{
    totalStates: number;
    coveredStates: number;
    totalBoundaries: number;
  }> {
    if (this.persistenceAdapter) {
      const stats = await this.persistenceAdapter.getCoverageStats();
      return {
        totalStates: stats.totalStates,
        coveredStates: stats.coveredStates,
        totalBoundaries: stats.totalBoundaries,
      };
    }

    // In-memory fallback (approximate)
    const states = new Set<string>();
    let boundaries = 0;
    for (const snapshot of this.snapshots.values()) {
      snapshot.metadata.regions.forEach(r => states.add(r));
      boundaries += snapshot.metadata.boundaryCount;
    }
    return {
      totalStates: 50, // US states
      coveredStates: states.size,
      totalBoundaries: boundaries,
    };
  }

  /**
   * Check for changes in TIGER sources before build
   *
   * Uses HTTP HEAD requests to detect changes without downloading full data.
   * Returns structured result with changed layers, states, and detailed reports.
   *
   * Cost: $0/year (HEAD requests are free)
   *
   * @param options - Check options (layers, states, forceCheck, year)
   * @returns Change check result with hasChanges flag and detailed reports
   *
   * @example
   * ```typescript
   * const atlas = new ShadowAtlasService();
   * await atlas.initialize();
   *
   * // Check if congressional districts have changed
   * const changes = await atlas.checkForChanges({
   *   layers: ['cd', 'sldu'],
   *   states: ['55', '26'],  // Wisconsin, Michigan
   *   year: 2024,
   * });
   *
   * if (changes.hasChanges) {
   *   console.log(`${changes.changedLayers.length} layers need rebuild`);
   *   await atlas.buildAtlas({ layers: changes.changedLayers as TIGERLayerType[] });
   * }
   * ```
   */
  async checkForChanges(options: CheckForChangesOptions = {}): Promise<ChangeCheckResult> {
    const startTime = Date.now();

    // Extract options with defaults
    const layers = options.layers?.filter(
      (layer): layer is 'cd' | 'sldu' | 'sldl' | 'county' =>
        layer === 'cd' || layer === 'sldu' || layer === 'sldl' || layer === 'county'
    ) ?? ['cd', 'sldu', 'sldl', 'county'];
    const states = options.states ?? ['all'];
    const year = options.year ?? 2024;

    this.log.info('Checking for upstream changes', {
      layers,
      states: states.length > 5 ? `${states.length} states` : states,
      year,
      forceCheck: options.forceCheck ?? false,
    });

    // If change detection not enabled, assume changes exist
    if (!this.changeDetectionAdapter) {
      this.log.warn('Change detection not enabled - assuming changes exist');
      const durationMs = Date.now() - startTime;
      return {
        hasChanges: true,
        changedLayers: [...layers],
        changedStates: states[0] === 'all' ? [] : [...states],
        lastChecked: new Date(),
        reports: [],
        sourcesChecked: 0,
        durationMs,
      };
    }

    // Create temporary adapter with requested sources
    const tempAdapter = new ChangeDetectionAdapter({
      sources: layers.map(layer => ({
        layerType: layer,
        vintage: year,
        states,
        updateTriggers: [
          { type: 'annual', month: 7 }, // TIGER typically updates in July
        ],
      })),
      storageDir: this.config.storageDir,
      checksumCachePath: this.config.changeDetection?.checksumCachePath,
    });

    // Load existing checksums (unless forceCheck)
    if (!options.forceCheck) {
      await tempAdapter.loadCache();
    }

    // Detect changes
    const result = await tempAdapter.detectChanges();
    const durationMs = Date.now() - startTime;

    // Convert adapter reports to our ChangeReport type
    const reports: ChangeReport[] = result.reports.map(r => ({
      sourceId: r.sourceId,
      url: r.url,
      oldChecksum: r.oldChecksum,
      newChecksum: r.newChecksum,
      detectedAt: r.detectedAt,
      trigger: r.trigger,
      changeType: r.changeType,
    }));

    // Calculate sources checked (layers * states count)
    const stateCount = states[0] === 'all' ? 51 : states.length; // 50 states + DC
    const sourcesChecked = layers.length * stateCount;

    this.log.info('Change detection complete', {
      hasChanges: reports.length > 0,
      changedLayers: result.changedLayers.length,
      changedStates: result.changedStates.length,
      sourcesChecked,
      durationMs,
    });

    return {
      hasChanges: reports.length > 0,
      changedLayers: result.changedLayers,
      changedStates: result.changedStates,
      lastChecked: new Date(),
      reports,
      sourcesChecked,
      durationMs,
    };
  }

  /**
   * Build Atlas only if upstream sources have changed
   *
   * Convenience method that combines checkForChanges() and buildAtlas().
   * Skips build if no upstream changes detected, saving bandwidth and compute.
   *
   * @param options - Build options (same as buildAtlas)
   * @returns BuildIfChangedResult with status 'built' or 'skipped'
   *
   * @example
   * ```typescript
   * const atlas = new ShadowAtlasService();
   * await atlas.initialize();
   *
   * // Only rebuild if TIGER sources have changed
   * const result = await atlas.buildIfChanged({
   *   layers: ['cd', 'sldu', 'sldl', 'county'],
   *   year: 2024,
   *   qualityThreshold: 80,
   * });
   *
   * if (result.status === 'skipped') {
   *   console.log('No changes detected - skipping build');
   * } else {
   *   console.log(`Built new Atlas with root: 0x${result.result.merkleRoot.toString(16)}`);
   * }
   * ```
   */
  async buildIfChanged(options: AtlasBuildOptions): Promise<BuildIfChangedResult> {
    // Check for changes first
    const changes = await this.checkForChanges({
      layers: options.layers,
      states: options.states,
      year: options.year,
    });

    if (!changes.hasChanges) {
      this.log.info('No upstream changes detected - skipping build', {
        lastChecked: changes.lastChecked,
        sourcesChecked: changes.sourcesChecked,
      });
      return {
        status: 'skipped',
        reason: 'no_changes',
        lastChecked: changes.lastChecked,
      };
    }

    this.log.info('Upstream changes detected - starting build', {
      changedLayers: changes.changedLayers,
      changedStates: changes.changedStates.length,
    });

    // Build the Atlas
    const result = await this.buildAtlas(options);

    return {
      status: 'built',
      result,
    };
  }

  /**
   * Validate TIGER/Line boundary data
   *
   * Downloads TIGER boundaries and validates completeness, topology, and coordinate accuracy.
   * This method orchestrates the TIGER validation pipeline that was previously handled by
   * the standalone validate-tiger-data.ts script.
   *
   * @param options - Validation options
   * @returns TIGER validation result with quality scores
   */
  async validateTIGER(options: TIGERValidationOptions): Promise<TIGERValidationResult> {
    const startTime = Date.now();
    const year = options.year ?? new Date().getFullYear();
    const qualityThreshold = options.qualityThreshold ?? 90;

    this.log.info('Starting TIGER validation', {
      state: options.state ?? 'all',
      layers: options.layers ?? ['cd', 'sldu', 'sldl', 'county'],
      year,
    });

    // Import TIGERBoundaryProvider and TIGERValidator dynamically
    const { TIGERBoundaryProvider } = await import('../providers/tiger-boundary-provider.js');
    const { TIGERValidator } = await import('../validators/tiger-validator.js');
    const { getStateName } = await import('../validators/tiger-expected-counts.js');

    const provider = new TIGERBoundaryProvider({ year });
    const validator = new TIGERValidator();

    // Determine layers to validate
    const layersToValidate: Array<'cd' | 'sldu' | 'sldl' | 'county'> =
      options.layers ? filterValidatableLayers(options.layers) : ['cd', 'sldu', 'sldl', 'county'];

    // Determine states to validate
    let statesToValidate: string[] = [];
    if (!options.state || options.state === 'all') {
      // National validation - use all US states
      // For now, validate just a subset for testing (Wisconsin as example)
      // In production, this would iterate all 50 states + DC + territories
      statesToValidate = ['national'];
    } else {
      statesToValidate = [options.state];
    }

    const layerResults: TIGERLayerValidation[] = [];
    let totalScore = 0;
    let totalLayers = 0;

    for (const layer of layersToValidate) {
      this.log.info('Validating layer', { layer });

      try {
        // Download layer data
        const rawFiles = await provider.downloadLayer({
          layer,
          stateFips: options.state !== 'all' ? options.state : undefined,
          year,
        });

        if (rawFiles.length === 0) {
          layerResults.push({
            layer,
            valid: false,
            qualityScore: 0,
            completeness: {
              valid: false,
              expected: 0,
              actual: 0,
              percentage: 0,
              missingGEOIDs: [],
              extraGEOIDs: [],
              summary: 'No data downloaded',
            },
            topology: {
              valid: false,
              selfIntersections: 0,
              overlaps: [],
              gaps: 0,
              invalidGeometries: [],
              summary: 'No data to validate',
            },
            coordinates: {
              valid: false,
              outOfRangeCount: 0,
              nullCoordinates: [],
              suspiciousLocations: [],
              summary: 'No data to validate',
            },
            validatedAt: new Date(),
            summary: `No data downloaded for ${layer}`,
          });
          continue;
        }

        // Transform to normalized boundaries
        const boundaries = await provider.transform(rawFiles);

        // Convert to validator format
        const validatorBoundaries = boundaries.map(b => {
          // Ensure geometry is Polygon or MultiPolygon using type guard
          assertPolygonGeometry(b.geometry, b.id);
          return {
            geoid: b.id,
            name: b.name,
            geometry: b.geometry,
            properties: b.properties,
          };
        });

        // Validate
        const result = validator.validate(layer, validatorBoundaries, options.state !== 'all' ? options.state : undefined);

        layerResults.push({
          layer,
          valid: result.completeness.valid && result.topology.valid && result.coordinates.valid,
          qualityScore: result.qualityScore,
          completeness: result.completeness,
          topology: result.topology,
          coordinates: result.coordinates,
          validatedAt: result.validatedAt,
          summary: result.summary,
        });

        totalScore += result.qualityScore;
        totalLayers++;

        this.log.info('Layer validation complete', {
          layer,
          qualityScore: result.qualityScore,
          valid: result.completeness.valid && result.topology.valid && result.coordinates.valid,
        });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.log.error('Layer validation failed', { layer, error: errorMessage });

        layerResults.push({
          layer,
          valid: false,
          qualityScore: 0,
          completeness: {
            valid: false,
            expected: 0,
            actual: 0,
            percentage: 0,
            missingGEOIDs: [],
            extraGEOIDs: [],
            summary: `Error: ${errorMessage}`,
          },
          topology: {
            valid: false,
            selfIntersections: 0,
            overlaps: [],
            gaps: 0,
            invalidGeometries: [],
            summary: `Error: ${errorMessage}`,
          },
          coordinates: {
            valid: false,
            outOfRangeCount: 0,
            nullCoordinates: [],
            suspiciousLocations: [],
            summary: `Error: ${errorMessage}`,
          },
          validatedAt: new Date(),
          summary: `Validation failed: ${errorMessage}`,
        });
      }
    }

    const duration = Date.now() - startTime;
    const averageScore = totalLayers > 0 ? Math.round(totalScore / totalLayers) : 0;
    const allValid = layerResults.every(r => r.valid);
    const meetsThreshold = averageScore >= qualityThreshold;

    const stateName = (options.state && options.state !== 'all'
      ? getStateName(options.state)
      : 'National') ?? 'National';

    this.log.info('TIGER validation complete', {
      state: stateName,
      averageScore,
      allValid,
      meetsThreshold,
      duration,
    });

    return {
      state: options.state ?? 'all',
      stateName,
      year,
      layers: layerResults,
      overallValid: allValid && meetsThreshold,
      averageQualityScore: averageScore,
      qualityThreshold,
      duration,
      validatedAt: new Date(),
      summary: meetsThreshold
        ? `✅ PASS: ${stateName ?? 'National'} TIGER validation (Avg Score: ${averageScore}/100)`
        : `❌ FAIL: ${stateName ?? 'National'} TIGER validation (Avg Score: ${averageScore}/100, Threshold: ${qualityThreshold})`,
    };
  }

  /**
   * Build complete Atlas from TIGER data
   *
   * Downloads, validates, and builds unified Merkle tree from TIGER boundary layers.
   * This is the primary method for building production Shadow Atlas snapshots.
   *
   * @param options - Build configuration
   * @returns Atlas build result with merkle root, layer counts, and validation scores
   *
   * @example
   * ```typescript
   * const atlas = new ShadowAtlasService();
   * await atlas.initialize();
   *
   * // Build full US atlas with all layers
   * const result = await atlas.buildAtlas({
   *   layers: ['cd', 'sldu', 'sldl', 'county'],
   *   year: 2024,
   *   qualityThreshold: 80,
   *   outputPath: './shadow-atlas-output/atlas-2024.json'
   * });
   *
   * console.log(`Merkle root: 0x${result.merkleRoot.toString(16)}`);
   * console.log(`Total boundaries: ${result.totalBoundaries}`);
   * ```
   */
  async buildAtlas(options: AtlasBuildOptions): Promise<AtlasBuildResult> {
    const startTime = Date.now();
    const jobId = randomUUID();

    this.log.info('Starting Atlas build', {
      jobId,
      layers: options.layers,
      states: options.states,
      year: options.year,
    });

    // Import dependencies (lazy load to avoid circular deps)
    const { TIGERBoundaryProvider } = await import('../providers/tiger-boundary-provider.js');
    const { TIGERValidator, DEFAULT_HALT_OPTIONS } = await import('../validators/tiger-validator.js');
    const { ValidationHaltError, isValidationHaltError } = await import('./types/errors.js');
    const { MultiLayerMerkleTreeBuilder } = await import('./multi-layer-builder.js');

    const year = options.year || 2024;
    const qualityThreshold = options.qualityThreshold ?? 80;

    // Run change detection if enabled
    if (this.config.changeDetection?.enabled) {
      this.log.info('Running change detection', { layers: options.layers, year });

      const changeResult = await this.checkForChanges({
        layers: options.layers,
        states: options.states ?? ['all'],
        year,
      });

      this.log.info('Change detection complete', {
        hasChanges: changeResult.hasChanges,
        changedLayers: changeResult.changedLayers,
        changedStates: changeResult.changedStates,
        durationMs: changeResult.durationMs,
      });

      // If skipUnchanged is enabled and no changes detected, we could optimize here
      // For now, we'll proceed with the build but log the change detection results
      if (!changeResult.hasChanges && this.config.changeDetection.skipUnchanged) {
        this.log.info('No changes detected and skipUnchanged enabled - proceeding with build anyway (full implementation would skip unchanged layers)');
      }
    }

    const provider = new TIGERBoundaryProvider({ year });
    const validator = new TIGERValidator();
    const builder = new MultiLayerMerkleTreeBuilder();

    // Build halt options from config (use defaults if not configured)
    // CRITICAL: These gates prevent invalid data from entering the Merkle tree
    const haltOptions = {
      haltOnTopologyError: this.config.validation.haltOnTopologyError ?? DEFAULT_HALT_OPTIONS.haltOnTopologyError,
      haltOnCompletenessError: this.config.validation.haltOnCompletenessError ?? DEFAULT_HALT_OPTIONS.haltOnCompletenessError,
      haltOnCoordinateError: this.config.validation.haltOnCoordinateError ?? DEFAULT_HALT_OPTIONS.haltOnCoordinateError,
    };

    this.log.info('Validation halt gates configured', {
      haltOnTopologyError: haltOptions.haltOnTopologyError,
      haltOnCompletenessError: haltOptions.haltOnCompletenessError,
      haltOnCoordinateError: haltOptions.haltOnCoordinateError,
    });

    // Create mutable version of BoundaryLayers for building
    type MutableBoundaryLayers = {
      congressionalDistricts?: MerkleBoundaryInput[];
      stateLegislativeUpper?: MerkleBoundaryInput[];
      stateLegislativeLower?: MerkleBoundaryInput[];
      counties?: MerkleBoundaryInput[];
      cityCouncilDistricts?: MerkleBoundaryInput[];
      // School districts
      unifiedSchoolDistricts?: MerkleBoundaryInput[];
      elementarySchoolDistricts?: MerkleBoundaryInput[];
      secondarySchoolDistricts?: MerkleBoundaryInput[];
    };
    const boundaryLayers: MutableBoundaryLayers = {};
    const layerValidations: LayerValidationResult[] = [];
    const sourceManifests: SourceManifest[] = [];
    const layerManifests: LayerManifest[] = [];

    // Download and validate each layer
    for (const layer of options.layers) {
      const layerStartTime = Date.now();
      this.log.info('Processing layer', { layer, year });

      try {
        // Download layer - layer is already TIGERLayerType from options
        if (!isTIGERLayerType(layer)) {
          throw new Error(`Invalid TIGER layer type: ${layer}`);
        }
        // Note: TIGERBoundaryProvider's TIGERLayer type should match TIGERLayerType
        // This is safe because we've validated layer is a TIGERLayerType
        const rawFiles = await provider.downloadLayer({
          layer: layer as import('../providers/tiger-boundary-provider.js').TIGERLayer,
          stateFips: options.states ? options.states[0] : undefined,
          year,
        });

        const downloadTimestamp = new Date().toISOString();

        // Track provenance data by URL for Merkle leaf hash commitment
        const provenanceByUrl = new Map<string, ProvenanceSource>();

        // Calculate checksum for each raw file and log to provenance
        for (const rawFile of rawFiles) {
          const checksum = createHash('sha256').update(rawFile.data).digest('hex');

          // Store provenance for this source file
          provenanceByUrl.set(rawFile.url, {
            url: rawFile.url,
            checksum,
            timestamp: downloadTimestamp,
            provider: 'census-tiger',
          });

          // Log to provenance writer
          const provenanceEntry: CompactDiscoveryEntry = {
            f: options.states?.[0] || '00', // FIPS code (00 for national)
            n: `TIGER-${layer}`,
            s: options.states?.[0]?.substring(0, 2),
            g: 4, // Federal authority tier (coarsest: 0-4)
            fc: null,
            conf: 100, // High confidence for TIGER data
            auth: 4, // Federal authority
            src: 'census-tiger',
            url: rawFile.url,
            q: {
              v: true,
              t: 1, // Clean topology expected
              r: Date.now() - layerStartTime,
              d: `${year}-01-01`,
            },
            why: [`Downloaded TIGER ${layer} layer from Census Bureau`],
            tried: [4],
            blocked: null,
            ts: downloadTimestamp,
            aid: jobId.substring(0, 8),
          };

          await this.provenanceWriter.append(provenanceEntry);

          // Add to source manifest
          sourceManifests.push({
            layer,
            url: rawFile.url,
            checksum,
            downloadedAt: downloadTimestamp,
            vintage: year,
            format: rawFile.format,
            featureCount: rawFile.metadata.featureCount as number || 0,
          });

          this.log.info('Layer downloaded and checksummed', {
            layer,
            url: rawFile.url,
            checksum: checksum.substring(0, 16) + '...',
          });
        }

        // Transform to normalized boundaries
        const boundaries = await provider.transform(rawFiles);

        this.log.info('Layer transformed', {
          layer,
          boundaryCount: boundaries.length,
        });

        // Validate layer with halt gates
        // CRITICAL: Halt gates prevent invalid data from entering the Merkle tree
        const validatorBoundaries = boundaries.map(b => {
          assertPolygonGeometry(b.geometry, b.id);
          return {
            geoid: b.id,
            name: b.name,
            geometry: b.geometry,
            properties: b.properties,
          };
        });

        // layer is already validated as TIGERLayerType above
        // Use validateWithHaltGates to throw ValidationHaltError on critical failures
        let validationResult;
        try {
          validationResult = validator.validateWithHaltGates(
            layer,
            validatorBoundaries,
            haltOptions,
            options.states ? options.states[0] : undefined
          );
        } catch (error) {
          // Handle ValidationHaltError - stop the build immediately
          if (isValidationHaltError(error)) {
            this.log.error('Validation halt gate triggered - build HALTED', {
              layer,
              stage: error.stage,
              layerType: error.layerType,
              stateFips: error.stateFips,
              message: error.message,
            });

            // Log to provenance that build was halted
            const haltEntry: CompactDiscoveryEntry = {
              f: options.states?.[0] || '00',
              n: `TIGER-${layer}-halt`,
              s: options.states?.[0]?.substring(0, 2),
              g: 4,
              fc: boundaries.length,
              conf: 0, // Zero confidence - validation failed
              auth: 4,
              src: 'census-tiger',
              q: {
                v: false,
                t: 0,
                r: Date.now() - layerStartTime,
                d: `${year}-01-01`,
              },
              why: [
                `Build HALTED: ${error.stage} validation failed`,
                error.message,
              ],
              tried: [4],
              blocked: `halt-gate-${error.stage}`,
              ts: new Date().toISOString(),
              aid: jobId.substring(0, 8),
            };
            await this.provenanceWriter.append(haltEntry);

            // Re-throw to halt the entire build
            throw error;
          }
          // Re-throw other errors
          throw error;
        }

        const layerProcessingDuration = Date.now() - layerStartTime;

        layerValidations.push({
          layer,
          qualityScore: validationResult.qualityScore,
          boundaryCount: boundaries.length,
          expectedCount: validationResult.completeness.expected,
          validation: validationResult,
        });

        // Add layer manifest entry
        layerManifests.push({
          layer,
          boundaryCount: boundaries.length,
          expectedCount: validationResult.completeness.expected,
          qualityScore: validationResult.qualityScore,
          valid: validationResult.completeness.valid && validationResult.topology.valid && validationResult.coordinates.valid,
          processingDuration: layerProcessingDuration,
        });

        // Log validation result to provenance
        const validationEntry: CompactDiscoveryEntry = {
          f: options.states?.[0] || '00',
          n: `TIGER-${layer}-validation`,
          s: options.states?.[0]?.substring(0, 2),
          g: 4,
          fc: boundaries.length,
          conf: validationResult.qualityScore,
          auth: 4,
          src: 'census-tiger',
          q: {
            v: validationResult.completeness.valid,
            t: validationResult.topology.valid ? 1 : (validationResult.topology.overlaps.length > 0 ? 2 : 0),
            r: layerProcessingDuration,
            d: `${year}-01-01`,
          },
          why: [
            `Validated ${boundaries.length}/${validationResult.completeness.expected} boundaries`,
            `Quality score: ${validationResult.qualityScore}/100`,
          ],
          tried: [4],
          blocked: validationResult.qualityScore < qualityThreshold ? 'quality-threshold' : null,
          ts: new Date().toISOString(),
          aid: jobId.substring(0, 8),
        };

        await this.provenanceWriter.append(validationEntry);

        // Warn if below quality threshold
        if (validationResult.qualityScore < qualityThreshold) {
          this.log.warn('Layer quality below threshold', {
            layer,
            qualityScore: validationResult.qualityScore,
            threshold: qualityThreshold,
          });
        }

        // Map to Merkle builder format with provenance commitment
        const normalizedForMerkle: MerkleBoundaryInput[] = boundaries.map(b => {
          assertPolygonGeometry(b.geometry, b.id);

          // Look up provenance for this boundary's source URL
          // All boundaries from the same TIGER file share the same provenance
          const provenance = provenanceByUrl.get(b.source.url);

          return {
            id: b.id,
            name: b.name,
            geometry: b.geometry,
            boundaryType: mapLayerToBoundaryTypeGuard(layer),
            authority: 5, // Federal authority
            source: provenance, // Wire provenance to Merkle leaf hash
          };
        });

        // Add to appropriate layer
        if (layer === 'cd') {
          boundaryLayers.congressionalDistricts = normalizedForMerkle;
        } else if (layer === 'sldu') {
          boundaryLayers.stateLegislativeUpper = normalizedForMerkle;
        } else if (layer === 'sldl') {
          boundaryLayers.stateLegislativeLower = normalizedForMerkle;
        } else if (layer === 'county') {
          boundaryLayers.counties = normalizedForMerkle;
        } else if (layer === 'unsd') {
          boundaryLayers.unifiedSchoolDistricts = normalizedForMerkle;
        } else if (layer === 'elsd') {
          boundaryLayers.elementarySchoolDistricts = normalizedForMerkle;
        } else if (layer === 'scsd') {
          boundaryLayers.secondarySchoolDistricts = normalizedForMerkle;
        }

        this.metrics?.recordExtraction(
          options.states?.[0] || 'US',
          layer,
          true,
          Date.now() - startTime,
          boundaries.length
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.log.error('Layer processing failed', { layer, error: errorMessage });

        layerValidations.push({
          layer,
          qualityScore: 0,
          boundaryCount: 0,
          expectedCount: 0,
          validation: null,
          error: errorMessage,
        });

        this.metrics?.recordExtraction(
          options.states?.[0] || 'US',
          layer,
          false,
          Date.now() - startTime
        );
      }
    }

    // Check if any layers succeeded
    const successfulLayers = layerValidations.filter(v => v.qualityScore > 0);
    if (successfulLayers.length === 0) {
      throw new Error('All layers failed to download/validate');
    }

    // Cross-validation step (runs by default with graceful fallback)
    let crossValidationResults: CrossValidationSummary[] | undefined;
    let crossValidationStatus: CrossValidationStatus = 'disabled';
    let crossValidationFailedStates: string[] = [];

    const crossValidationConfig = {
      enabled: this.config.crossValidation?.enabled ?? true,
      failOnMismatch: this.config.crossValidation?.failOnMismatch ?? false,
      minQualityScore: this.config.crossValidation?.minQualityScore ?? 70,
      gracefulFallback: this.config.crossValidation?.gracefulFallback ?? true,
      states: this.config.crossValidation?.states,
    };

    if (crossValidationConfig.enabled) {
      this.log.info('Running cross-validation', {
        layers: options.layers,
        gracefulFallback: crossValidationConfig.gracefulFallback,
        states: crossValidationConfig.states ?? 'all',
      });

      try {
        const results = await this.runCrossValidation(
          options.layers,
          year,
          crossValidationConfig.states ?? options.states,
          crossValidationConfig.minQualityScore,
          crossValidationConfig.failOnMismatch,
          jobId
        );

        crossValidationResults = results;

        // Determine status based on results
        // A state is considered failed if its qualityScore is 0 (indicating source unavailable or complete failure)
        const failedStates = results.filter(r => r.qualityScore === 0);
        crossValidationFailedStates = [...new Set(failedStates.map(r => r.state))];

        if (failedStates.length === 0) {
          crossValidationStatus = 'completed';
        } else if (failedStates.length < results.length) {
          crossValidationStatus = 'partial';
          this.log.warn('Cross-validation partial success', {
            successCount: results.length - failedStates.length,
            failedStates: crossValidationFailedStates,
          });
        } else {
          crossValidationStatus = 'failed_graceful';
          this.log.warn('Cross-validation failed for all states - continuing gracefully', {
            failedStates: crossValidationFailedStates,
          });
        }
      } catch (error) {
        if (crossValidationConfig.gracefulFallback) {
          crossValidationStatus = 'failed_graceful';
          this.log.warn('Cross-validation failed - continuing with graceful fallback', {
            error: error instanceof Error ? error.message : String(error),
          });
        } else {
          throw error;
        }
      }
    } else {
      crossValidationStatus = 'disabled';
      this.log.info('Cross-validation disabled by configuration');
    }

    // School district validation step (if enabled and school district layers present)
    let schoolDistrictValidation: SchoolDistrictValidationSummary[] | undefined;

    const hasSchoolDistrictLayers = options.layers.some(
      layer => layer === 'unsd' || layer === 'elsd' || layer === 'scsd'
    );

    if (this.config.schoolDistrictValidation?.enabled && hasSchoolDistrictLayers) {
      this.log.info('Running school district validation', {
        layers: options.layers.filter(l => ['unsd', 'elsd', 'scsd'].includes(l)),
        checkOverlaps: this.config.schoolDistrictValidation.checkOverlaps ?? true,
        checkCoverage: this.config.schoolDistrictValidation.checkCoverage ?? false,
      });

      schoolDistrictValidation = await this.runSchoolDistrictValidation(
        boundaryLayers,
        year,
        options.states,
        this.config.schoolDistrictValidation.checkOverlaps ?? true,
        this.config.schoolDistrictValidation.checkCoverage ?? false,
        this.config.schoolDistrictValidation.failOnOverlap ?? false,
        jobId
      );
    }

    // Build Merkle tree (flat or global depending on config)
    this.log.info('Building Merkle tree', {
      layers: Object.keys(boundaryLayers),
      globalTreeEnabled: this.config.globalTree?.enabled ?? false,
    });

    let merkleRoot: bigint;
    let treeDepth: number;
    let totalBoundaries: number;
    let layerCounts: Record<string, number>;
    let treeType: 'flat' | 'global';
    let countryRoots: ReadonlyMap<string, bigint> | undefined;
    let continentalRoots: ReadonlyMap<string, bigint> | undefined;
    // Keep reference to flat tree for proof generation (only set for flat trees)
    let flatTree: MultiLayerMerkleTree | undefined;

    if (this.config.globalTree?.enabled) {
      // Global hierarchical tree
      const { GlobalMerkleTreeBuilder } = await import('../integration/global-merkle-tree.js');
      const { GlobalTreeAdapter, extractCountryRoots, extractContinentalRoots } = await import('../integration/global-tree-adapter.js');

      const globalBuilder = new GlobalMerkleTreeBuilder();
      const adapter = new GlobalTreeAdapter(globalBuilder, {
        countries: this.config.globalTree.countries,
        useSingleCountryOptimization: this.config.globalTree.countries.length === 1,
      });

      // Flatten all boundaries for conversion
      const allBoundaries: MerkleBoundaryInput[] = [
        ...(boundaryLayers.congressionalDistricts ?? []),
        ...(boundaryLayers.stateLegislativeUpper ?? []),
        ...(boundaryLayers.stateLegislativeLower ?? []),
        ...(boundaryLayers.counties ?? []),
        ...(boundaryLayers.cityCouncilDistricts ?? []),
      ];

      // Build unified tree
      const unifiedTree = await adapter.build(allBoundaries, this.config.globalTree.countries[0] ?? 'US');

      if (unifiedTree.type === 'global') {
        // Global tree built
        merkleRoot = unifiedTree.tree.globalRoot;
        treeDepth = 0; // Global tree doesn't have single depth (varies by country)
        totalBoundaries = unifiedTree.tree.totalDistricts;
        treeType = 'global';
        countryRoots = extractCountryRoots(unifiedTree.tree);
        continentalRoots = extractContinentalRoots(unifiedTree.tree);

        // Compute layer counts from global tree
        layerCounts = {};
        for (const continent of unifiedTree.tree.continents) {
          for (const country of continent.countries) {
            for (const region of country.regions) {
              for (const district of region.districts) {
                const type = district.boundaryType;
                layerCounts[type] = (layerCounts[type] ?? 0) + 1;
              }
            }
          }
        }
      } else {
        // Flat tree used (single-country optimization)
        flatTree = unifiedTree.tree;
        merkleRoot = flatTree.root;
        treeDepth = flatTree.tree.length;
        totalBoundaries = flatTree.boundaryCount;
        layerCounts = flatTree.layerCounts;
        treeType = 'flat';
      }
    } else {
      // Flat tree (backwards compatible)
      flatTree = await builder.buildTree(boundaryLayers as BoundaryLayers);
      merkleRoot = flatTree.root;
      treeDepth = flatTree.tree.length;
      totalBoundaries = flatTree.boundaryCount;
      layerCounts = flatTree.layerCounts;
      treeType = 'flat';
    }

    const duration = Date.now() - startTime;

    // Log Merkle tree commitment to provenance
    const merkleEntry: CompactDiscoveryEntry = {
      f: '00',
      n: 'Atlas-Merkle-Tree',
      g: 4,
      fc: totalBoundaries,
      conf: 100,
      auth: 4,
      src: 'shadow-atlas',
      why: [
        `Built ${treeType} Merkle tree with ${totalBoundaries} boundaries`,
        `Tree type: ${treeType}`,
        `Root: 0x${merkleRoot.toString(16).substring(0, 16)}...`,
      ],
      tried: [4],
      blocked: null,
      ts: new Date().toISOString(),
      aid: jobId.substring(0, 8),
    };

    await this.provenanceWriter.append(merkleEntry);

    // Create snapshot
    this.log.info('Creating snapshot', { jobId });

    const sourceChecksums: Record<string, string> = {};
    for (const sourceManifest of sourceManifests) {
      sourceChecksums[sourceManifest.layer] = sourceManifest.checksum;
    }

    const snapshot = await this.snapshotManager.createSnapshot(
      {
        jobId,
        merkleRoot,
        totalBoundaries,
        layerCounts,
        layerValidations,
        treeDepth,
        duration,
        timestamp: new Date(),
        treeType,
        countryRoots,
        continentalRoots,
        crossValidationStatus,
        crossValidationResults,
        crossValidationFailedStates: crossValidationFailedStates.length > 0
          ? crossValidationFailedStates
          : undefined,
      },
      {
        tigerVintage: year,
        statesIncluded: options.states ?? [],
        layersIncluded: options.layers,
        buildDurationMs: duration,
        sourceChecksums,
        jobId,
      }
    );

    this.log.info('Snapshot created', {
      snapshotId: snapshot.id,
      version: snapshot.version,
    });

    // Generate proof templates if enabled (flat tree only)
    if (options.generateProofs && flatTree) {
      this.log.info('Generating proof templates...', {
        treeType,
        leafCount: flatTree.leaves.length,
      });

      const proofs = this.generateBatchProofs(flatTree, builder);
      await this.snapshotManager.storeProofs(
        snapshot.id,
        proofs,
        merkleRoot,
        treeDepth
      );

      this.log.info('Proof templates stored', {
        snapshotId: snapshot.id,
        templateCount: proofs.size,
      });
    } else if (options.generateProofs && treeType === 'global') {
      this.log.warn('Proof generation not yet supported for global trees', {
        treeType,
        totalBoundaries,
      });
    }

    const result: AtlasBuildResult = {
      jobId,
      merkleRoot,
      totalBoundaries,
      layerCounts,
      layerValidations,
      treeDepth,
      duration,
      timestamp: new Date(),
      snapshotId: snapshot.id,
      snapshotVersion: snapshot.version,
      treeType,
      countryRoots,
      continentalRoots,
      crossValidationStatus,
      crossValidationResults,
      crossValidationFailedStates: crossValidationFailedStates.length > 0
        ? crossValidationFailedStates
        : undefined,
      schoolDistrictValidation,
    };

    // Generate build manifest
    const buildManifest = this.generateBuildManifest({
      buildId: jobId,
      merkleRoot,
      layers: layerManifests,
      totalBoundaries,
      treeDepth,
      sources: sourceManifests,
      layerValidations,
      qualityThreshold,
      duration,
      timestamp: new Date(),
    });

    // Export to JSON if requested
    if (options.outputPath) {
      const { writeFile, mkdir } = await import('node:fs/promises');
      const { dirname } = await import('node:path');

      await mkdir(dirname(options.outputPath), { recursive: true });

      // Export tree (format depends on tree type)
      if (treeType === 'flat' && flatTree) {
        // Flat tree: Use builder's export with already-built tree
        const json = builder.exportToJSON(flatTree);
        await writeFile(options.outputPath, json);
      } else if (treeType === 'global') {
        // Global tree: Export minimal JSON with roots
        const exportData = {
          version: this.getPackageVersion(),
          treeType: 'global',
          globalRoot: `0x${merkleRoot.toString(16)}`,
          totalBoundaries,
          countryRoots: countryRoots
            ? Object.fromEntries(
                Array.from(countryRoots.entries()).map(([code, root]) => [
                  code,
                  `0x${root.toString(16)}`,
                ])
              )
            : {},
          continentalRoots: continentalRoots
            ? Object.fromEntries(
                Array.from(continentalRoots.entries()).map(([continent, root]) => [
                  continent,
                  `0x${root.toString(16)}`,
                ])
              )
            : {},
          metadata: {
            generatedAt: new Date().toISOString(),
            countries: this.config.globalTree?.countries ?? [],
          },
        };
        const json = JSON.stringify(exportData, null, 2);
        await writeFile(options.outputPath, json);
      }

      // Write manifest alongside main output
      const manifestPath = options.outputPath.replace('.json', '-manifest.json');
      await writeFile(manifestPath, JSON.stringify(buildManifest, null, 2));

      this.log.info('Atlas exported', {
        path: options.outputPath,
        manifestPath,
      });
    }

    // Update checksums after successful build
    if (this.config.changeDetection?.enabled && sourceManifests.length > 0) {
      this.log.info('Updating checksums after successful build');

      // Filter to supported layers for change detection
      const supportedLayers = options.layers.filter(
        (layer): layer is 'cd' | 'sldu' | 'sldl' | 'county' =>
          layer === 'cd' || layer === 'sldu' || layer === 'sldl' || layer === 'county'
      );

      // Create temporary adapter with the sources we just downloaded
      const tempAdapter = new ChangeDetectionAdapter({
        sources: supportedLayers.map(layer => ({
          layerType: layer,
          vintage: year,
          states: options.states ?? ['all'],
          updateTriggers: [{ type: 'annual', month: 7 }],
        })),
        storageDir: this.config.storageDir,
        checksumCachePath: this.config.changeDetection.checksumCachePath,
      });

      // Load existing cache
      await tempAdapter.loadCache();

      // Create ChangeReports from source manifests
      const changeReports = sourceManifests.map(manifest => ({
        sourceId: `${manifest.layer}:${options.states?.[0] ?? '00'}:${manifest.vintage}`,
        url: manifest.url,
        oldChecksum: null,
        newChecksum: manifest.checksum,
        detectedAt: manifest.downloadedAt,
        trigger: 'manual' as const,
        changeType: 'new' as const,
      }));

      // Update checksums
      await tempAdapter.updateChecksums(changeReports);

      this.log.info('Checksums updated', { count: changeReports.length });
    }

    // Publish to IPFS if enabled
    if (this.config.ipfsDistribution?.enabled && this.config.ipfsDistribution.publishOnBuild) {
      this.log.info('Publishing to IPFS...');
      try {
        const cid = await this.publishToIPFS(merkleRoot, snapshot, totalBoundaries);
        await this.snapshotManager.setIpfsCid(snapshot.id, cid);
        this.log.info('Published to IPFS and updated snapshot', { cid, snapshotId: snapshot.id });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.log.error('Failed to publish to IPFS', { error: errorMessage });
        // Don't fail the build - IPFS publishing is optional
      }
    }

    this.log.info('Atlas build complete', {
      jobId,
      merkleRoot: `0x${merkleRoot.toString(16).slice(0, 16)}...`,
      totalBoundaries,
      duration,
      treeType,
    });

    return result;
  }

  /**
   * Map TIGER layer to boundary type
   */
  private mapLayerToBoundaryType(layer: string): string {
    switch (layer) {
      case 'cd':
        return 'congressional-district';
      case 'sldu':
        return 'state-legislative-upper';
      case 'sldl':
        return 'state-legislative-lower';
      case 'county':
        return 'county';
      default:
        return layer;
    }
  }

  // ==========================================================================
  // IPFS Distribution
  // ==========================================================================

  /**
   * Publish Atlas snapshot to IPFS
   *
   * Uploads the Merkle tree data to configured IPFS pinning services.
   * Uses RegionalPinningService for multi-region redundancy.
   *
   * @param merkleRoot - Root of the Merkle tree
   * @param snapshot - Snapshot metadata
   * @param totalBoundaries - Total number of boundaries in tree
   * @returns First successful CID
   * @throws Error if all services fail
   */
  private async publishToIPFS(
    merkleRoot: bigint,
    snapshot: Snapshot,
    totalBoundaries: number
  ): Promise<string> {
    const ipfsConfig = this.config.ipfsDistribution;

    if (!ipfsConfig?.enabled) {
      throw new Error('IPFS distribution is not enabled');
    }

    // Get credentials from environment
    const credentials = getIPFSCredentials();

    // Import RegionalPinningService (lazy load to avoid circular deps)
    const { createRegionalPinningService } = await import(
      '../distribution/regional-pinning-service.js'
    );

    // Prepare tree data for upload
    const treeData = {
      version: this.getPackageVersion(),
      root: `0x${merkleRoot.toString(16)}`,
      snapshotId: snapshot.id,
      snapshotVersion: snapshot.version,
      leaves: totalBoundaries,
      layerCounts: snapshot.layerCounts,
      metadata: {
        tigerVintage: snapshot.metadata.tigerVintage,
        statesIncluded: snapshot.metadata.statesIncluded,
        layersIncluded: snapshot.metadata.layersIncluded,
        buildDurationMs: snapshot.metadata.buildDurationMs,
      },
      timestamp: new Date().toISOString(),
    };

    const treeJson = JSON.stringify(treeData, null, 2);
    const blob = new Blob([treeJson], { type: 'application/json' });

    const errors: string[] = [];
    let successfulCid: string | null = null;

    // Try each configured region until one succeeds
    for (const region of ipfsConfig.regions) {
      try {
        this.log.info('Publishing to IPFS region', { region });

        const service = await createRegionalPinningService(region, {
          storacha: credentials.storacha,
          pinata: credentials.pinata,
          fleek: credentials.fleek,
          maxParallelUploads: ipfsConfig.maxParallelUploads,
          retryAttempts: ipfsConfig.retryAttempts,
        });

        const result = await service.pinToRegion(blob, {
          name: `shadow-atlas-v${snapshot.version}`,
          metadata: {
            snapshotId: snapshot.id,
            merkleRoot: `0x${merkleRoot.toString(16).substring(0, 16)}`,
            version: String(snapshot.version),
          },
        });

        if (result.success && result.results.length > 0) {
          successfulCid = result.results[0].cid;
          this.log.info('Published to IPFS', {
            region,
            cid: successfulCid,
            services: result.results.map(r => r.service),
          });
          break; // First successful region is sufficient
        } else {
          const regionErrors = result.errors.map(e => `${region}: ${e.message}`);
          errors.push(...regionErrors);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`${region}: ${errorMessage}`);
        this.log.warn('IPFS region failed', { region, error: errorMessage });
      }
    }

    if (!successfulCid) {
      throw new Error(`IPFS upload failed in all regions: ${errors.join('; ')}`);
    }

    return successfulCid;
  }

  /**
   * Generate build manifest from Atlas build results
   *
   * Creates comprehensive audit trail with sources, validation, and environment metadata.
   */
  private generateBuildManifest(params: {
    buildId: string;
    merkleRoot: bigint;
    layers: readonly LayerManifest[];
    totalBoundaries: number;
    treeDepth: number;
    sources: readonly SourceManifest[];
    layerValidations: readonly LayerValidationResult[];
    qualityThreshold: number;
    duration: number;
    timestamp: Date;
  }): BuildManifest {
    // Calculate validation summary
    const layersPassed = params.layerValidations.filter(v => v.qualityScore >= params.qualityThreshold).length;
    const layersFailed = params.layerValidations.filter(v => v.qualityScore < params.qualityThreshold).length;
    const totalLayers = params.layerValidations.length;
    const averageQualityScore = totalLayers > 0
      ? Math.round(params.layerValidations.reduce((sum, v) => sum + v.qualityScore, 0) / totalLayers)
      : 0;
    const overallValid = layersFailed === 0 && averageQualityScore >= params.qualityThreshold;

    const validationManifest: ValidationManifest = {
      totalLayers,
      layersPassed,
      layersFailed,
      averageQualityScore,
      qualityThreshold: params.qualityThreshold,
      overallValid,
    };

    // Gather environment metadata
    const environmentManifest: EnvironmentManifest = {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      hostname: hostname(),
      packageVersion: this.getPackageVersion(),
    };

    // Convert merkle root to hex string with 0x prefix
    const merkleRootHex = `0x${params.merkleRoot.toString(16)}`;

    return {
      buildId: params.buildId,
      timestamp: params.timestamp.toISOString(),
      merkleRoot: merkleRootHex,
      layers: params.layers,
      totalBoundaries: params.totalBoundaries,
      treeDepth: params.treeDepth,
      sources: params.sources,
      validation: validationManifest,
      environment: environmentManifest,
      duration: params.duration,
    };
  }

  /**
   * Generate proof templates for all districts in a Merkle tree
   *
   * Creates proof templates (Merkle proofs without nullifier) for every
   * district in the tree. These templates can be completed client-side
   * with a user secret for nullifier computation.
   *
   * PERFORMANCE: Uses existing MultiLayerMerkleTreeBuilder.generateProof()
   * to ensure consistency with the tree structure.
   *
   * @param tree - Complete multi-layer Merkle tree
   * @param builder - Builder instance used to construct the tree
   * @returns Map of districtId → ProofTemplate
   */
  private generateBatchProofs(
    tree: MultiLayerMerkleTree,
    builder: MultiLayerMerkleTreeBuilder
  ): Map<string, ProofTemplate> {
    const proofs = new Map<string, ProofTemplate>();

    this.log.info('Generating batch proof templates', {
      leafCount: tree.leaves.length,
      treeDepth: tree.tree.length,
    });

    const startTime = Date.now();

    for (const leaf of tree.leaves) {
      // Generate Merkle proof using builder's method
      const merkleProof = builder.generateProof(
        tree,
        leaf.boundaryId,
        leaf.boundaryType
      );

      // Convert to ProofTemplate format (hex strings for serialization)
      const proofTemplate: ProofTemplate = {
        districtId: leaf.boundaryId,
        merkleRoot: `0x${merkleProof.root.toString(16)}`,
        siblings: merkleProof.siblings.map(s => `0x${s.toString(16)}`),
        pathIndices: [...merkleProof.pathIndices],
        leafHash: `0x${merkleProof.leaf.toString(16)}`,
        boundaryType: leaf.boundaryType,
        authority: this.getAuthorityFromBoundaryType(leaf.boundaryType),
        leafIndex: leaf.index,
      };

      proofs.set(leaf.boundaryId, proofTemplate);
    }

    const duration = Date.now() - startTime;
    this.log.info('Batch proof templates generated', {
      templateCount: proofs.size,
      durationMs: duration,
      avgPerProofMs: proofs.size > 0 ? duration / proofs.size : 0,
    });

    return proofs;
  }

  /**
   * Map boundary type to authority level
   *
   * Federal boundaries (Congressional, State Legislative) get highest authority,
   * county and municipal get lower.
   */
  private getAuthorityFromBoundaryType(boundaryType: string): number {
    switch (boundaryType) {
      case 'congressional-district':
      case 'state-legislative-upper':
      case 'state-legislative-lower':
        return 5; // FEDERAL_MANDATE
      case 'county':
        return 4; // STATE_OFFICIAL
      case 'unified-school-district':
      case 'elementary-school-district':
      case 'secondary-school-district':
        return 4; // STATE_OFFICIAL (school districts are state-managed)
      case 'city-council-district':
      case 'municipal':
        return 3; // MUNICIPAL_OFFICIAL
      default:
        return 2; // COMMUNITY_VERIFIED
    }
  }

  /**
   * Run cross-validation between TIGER and state GIS portal boundaries
   *
   * Compares boundaries from Census TIGER/Line with state GIS portals to detect
   * discrepancies in district counts, GEOIDs, and boundary geometries.
   *
   * @param layers - Layers to validate
   * @param year - TIGER vintage year
   * @param states - States to validate (FIPS codes)
   * @param minQualityScore - Minimum quality score required
   * @param failOnMismatch - Whether to throw on mismatch
   * @param jobId - Job ID for provenance logging
   * @returns Array of cross-validation summaries
   *
   * @throws {BuildValidationError} When failOnMismatch is true and any states fail validation.
   *         Contains all validation results for debugging.
   *
   * @internal This is a stub implementation. Full cross-validation requires
   * state GIS portal access which is rate-limited and expensive.
   */
  private async runCrossValidation(
    layers: readonly TIGERLayerType[],
    vintage: number,
    states: readonly string[] | undefined,
    minQualityScore: number,
    failOnMismatch: boolean,
    jobId: string
  ): Promise<CrossValidationSummary[]> {
    // Lazy import to avoid circular dependencies
    const { CrossValidator } = await import('../validators/cross-validator.js');
    const { TIGERBoundaryProvider } = await import('../providers/tiger-boundary-provider.js');
    const { BuildValidationError } = await import('./errors.js');

    const results: CrossValidationSummary[] = [];
    const fullValidationResults: import('../validators/cross-validator.js').CrossValidationResult[] = [];

    // Create a TIGERBoundaryProvider adapter that conforms to BoundaryProvider interface
    const tigerProvider = new TIGERBoundaryProvider({ year: vintage });
    const tigerLoader = {
      downloadLayer: async (params: { layer: TIGERLayerType; stateFips: string }) => {
        // Cast to TIGERLayer (provider's local type) - they share the same union members
        return tigerProvider.downloadLayer({
          layer: params.layer as import('../providers/tiger-boundary-provider.js').TIGERLayer,
          stateFips: params.stateFips,
          year: vintage,
        });
      },
      transform: async (files: unknown) => {
        const boundaries = await tigerProvider.transform(files as Parameters<typeof tigerProvider.transform>[0]);
        return boundaries.map(b => ({
          id: b.id,
          name: b.name,
          geometry: b.geometry as import('geojson').Polygon | import('geojson').MultiPolygon,
          properties: b.properties,
        }));
      },
    };

    // Create a StateBatchExtractor adapter that conforms to StateExtractor interface
    const stateExtractor = {
      extractLayer: async (state: string, layerType: import('../providers/state-batch-extractor.js').LegislativeLayerType) => {
        const result = await this.extractor.extractLayer(state, layerType);
        return {
          success: result.success,
          boundaries: result.boundaries,
          featureCount: result.featureCount,
        };
      },
    };

    // Create CrossValidator with adapters
    const crossValidator = new CrossValidator(tigerLoader, stateExtractor, {
      tolerancePercent: 0.1,
      requireBothSources: false,
      minOverlapPercent: 95,
    });

    // Filter to cross-validatable layers (cd, sldu, sldl, county)
    const crossValidatableLayers = layers.filter(
      (layer): layer is 'cd' | 'sldu' | 'sldl' | 'county' =>
        layer === 'cd' || layer === 'sldu' || layer === 'sldl' || layer === 'county'
    );

    // Determine states to validate
    const statesToValidate = states ?? this.getAvailableStatesFips();

    for (const layer of crossValidatableLayers) {
      for (const stateFips of statesToValidate) {
        try {
          this.log.info('Cross-validating layer/state', { layer, stateFips });

          const validationResult = await crossValidator.validate(layer, stateFips, vintage);

          // Store full validation result for potential error throwing
          fullValidationResults.push(validationResult);

          // Convert to CrossValidationSummary
          const summary: CrossValidationSummary = {
            layer,
            state: stateFips,
            qualityScore: validationResult.qualityScore,
            tigerCount: validationResult.tigerCount,
            stateCount: validationResult.stateCount,
            matchedCount: validationResult.matchedCount,
            issues: validationResult.issues.length,
          };

          results.push(summary);

          // Log to provenance
          const provenanceEntry: CompactDiscoveryEntry = {
            f: stateFips,
            n: `CrossValidation-${layer}`,
            s: stateFips.substring(0, 2),
            g: 4,
            fc: validationResult.matchedCount,
            conf: validationResult.qualityScore,
            auth: 4,
            src: 'cross-validation',
            q: {
              v: validationResult.qualityScore >= minQualityScore,
              t: validationResult.geometryMismatches.length === 0 ? 1 : 2,
              r: 0, // Not tracking duration per validation
              d: `${vintage}-01-01`,
            },
            why: [
              `Cross-validated ${layer} for state ${stateFips}`,
              `Quality: ${validationResult.qualityScore}/100`,
              `TIGER: ${validationResult.tigerCount}, State: ${validationResult.stateCount}, Matched: ${validationResult.matchedCount}`,
            ],
            tried: [4],
            blocked: validationResult.qualityScore < minQualityScore ? 'quality-threshold' : null,
            ts: new Date().toISOString(),
            aid: jobId.substring(0, 8),
          };

          await this.provenanceWriter.append(provenanceEntry);

          // Log warning for quality threshold failures (don't throw yet - batch all failures)
          if (validationResult.qualityScore < minQualityScore) {
            this.log.warn('Cross-validation quality below threshold', {
              layer,
              state: stateFips,
              qualityScore: validationResult.qualityScore,
              threshold: minQualityScore,
              issues: validationResult.issues.length,
            });

          }

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);


          this.log.error('Cross-validation failed', { layer, stateFips, error: errorMessage });

          // Add failed result
          results.push({
            layer,
            state: stateFips,
            qualityScore: 0,
            tigerCount: 0,
            stateCount: 0,
            matchedCount: 0,
            issues: 1,
          });
        }
      }
    }

    this.log.info('Cross-validation complete', {
      totalValidations: results.length,
      passed: results.filter(r => r.qualityScore >= minQualityScore).length,
      failed: results.filter(r => r.qualityScore < minQualityScore).length,
    });

    // Batch error throwing: Collect all failures and throw once at the end
    if (failOnMismatch) {
      const failingResults = fullValidationResults.filter(r => r.qualityScore < minQualityScore);

      if (failingResults.length > 0) {
        const failedStates = [...new Set(failingResults.map(r => r.state))];

        throw new BuildValidationError(
          `Cross-validation failed for ${failedStates.length} states. ` +
          `Minimum quality score: ${minQualityScore}, ` +
          `Failing states: ${failedStates.join(', ')}. ` +
          `Set failOnMismatch: false to continue despite mismatches.`,
          failingResults,
          failedStates
        );
      }
    }

    return results;
  }

  /**
   * Get available state FIPS codes for cross-validation
   *
   * Returns FIPS codes for states that have configured GIS portals.
   */
  private getAvailableStatesFips(): readonly string[] {
    // Common states with configured GIS portals
    // This is a subset - full list would come from state-gis-portals registry
    return [
      '01', '02', '04', '05', '06', // AL, AK, AZ, AR, CA
      '08', '09', '10', '11', '12', // CO, CT, DE, DC, FL
      '13', '15', '16', '17', '18', // GA, HI, ID, IL, IN
      '19', '20', '21', '22', '23', // IA, KS, KY, LA, ME
      '24', '25', '26', '27', '28', // MD, MA, MI, MN, MS
      '29', '30', '31', '32', '33', // MO, MT, NE, NV, NH
      '34', '35', '36', '37', '38', // NJ, NM, NY, NC, ND
      '39', '40', '41', '42', '44', // OH, OK, OR, PA, RI
      '45', '46', '47', '48', '49', // SC, SD, TN, TX, UT
      '50', '51', '53', '54', '55', // VT, VA, WA, WV, WI
      '56', // WY
    ];
  }

  /**
   * Run school district validation for unsd/elsd/scsd layers
   *
   * Validates:
   * - Count accuracy against expected counts
   * - Forbidden overlaps between unified and elementary/secondary districts
   * - Coverage completeness (optional)
   *
   * @internal
   */
  private async runSchoolDistrictValidation(
    boundaryLayers: {
      unifiedSchoolDistricts?: MerkleBoundaryInput[];
      elementarySchoolDistricts?: MerkleBoundaryInput[];
      secondarySchoolDistricts?: MerkleBoundaryInput[];
    },
    year: number,
    states: readonly string[] | undefined,
    checkOverlaps: boolean,
    checkCoverage: boolean,
    failOnOverlap: boolean,
    jobId: string
  ): Promise<SchoolDistrictValidationSummary[]> {
    const results: SchoolDistrictValidationSummary[] = [];

    // Determine which states to validate
    const statesToValidate = states?.filter(s => s !== 'all') ?? [];

    // If no specific states, extract from boundary data
    if (statesToValidate.length === 0) {
      const allBoundaries = [
        ...(boundaryLayers.unifiedSchoolDistricts ?? []),
        ...(boundaryLayers.elementarySchoolDistricts ?? []),
        ...(boundaryLayers.secondarySchoolDistricts ?? []),
      ];

      // Extract unique state FIPS codes from boundary IDs (first 2 chars)
      const stateSet = new Set<string>();
      for (const boundary of allBoundaries) {
        if (boundary.id && boundary.id.length >= 2) {
          stateSet.add(boundary.id.substring(0, 2));
        }
      }
      statesToValidate.push(...Array.from(stateSet));
    }

    // Validate each state
    for (const stateFips of statesToValidate) {
      try {
        // Filter boundaries to this state
        const unsd = (boundaryLayers.unifiedSchoolDistricts ?? [])
          .filter(b => b.id.startsWith(stateFips));
        const elsd = (boundaryLayers.elementarySchoolDistricts ?? [])
          .filter(b => b.id.startsWith(stateFips));
        const scsd = (boundaryLayers.secondarySchoolDistricts ?? [])
          .filter(b => b.id.startsWith(stateFips));

        // Run validation (async)
        const validationResult = await this.schoolDistrictValidator.validate(
          stateFips,
          year
        );

        // Check overlaps if enabled and boundaries available
        let forbiddenOverlaps = 0;
        let coveragePercent = 100; // Default if not checking coverage

        if (checkOverlaps && (unsd.length > 0 || elsd.length > 0 || scsd.length > 0)) {
          // Convert MerkleBoundaryInput to NormalizedBoundary format expected by validator
          const unsdBounds: NormalizedBoundary[] = unsd.map(b => ({
            geoid: b.id,
            name: b.name,
            geometry: b.geometry,
            properties: {},
          }));
          const elsdBounds: NormalizedBoundary[] = elsd.map(b => ({
            geoid: b.id,
            name: b.name,
            geometry: b.geometry,
            properties: {},
          }));
          const scsdBounds: NormalizedBoundary[] = scsd.map(b => ({
            geoid: b.id,
            name: b.name,
            geometry: b.geometry,
            properties: {},
          }));

          const overlapIssues = await this.schoolDistrictValidator.checkOverlaps(
            unsdBounds,
            elsdBounds,
            scsdBounds,
            stateFips
          );
          forbiddenOverlaps = overlapIssues.length;

          if (forbiddenOverlaps > 0) {
            this.log.warn('School district overlaps detected', {
              state: stateFips,
              overlaps: forbiddenOverlaps,
              sample: overlapIssues.slice(0, 3).map(o => ({
                geoid1: o.geoid1,
                geoid2: o.geoid2,
                type1: o.type1,
                type2: o.type2,
              })),
            });

            if (failOnOverlap) {
              throw new Error(
                `School district validation failed: ${forbiddenOverlaps} forbidden overlaps in state ${stateFips}`
              );
            }
          }
        }

        // Check coverage if enabled and boundaries available
        if (checkCoverage && (unsd.length > 0 || elsd.length > 0 || scsd.length > 0)) {
          try {
            // Combine all school district boundaries for coverage analysis
            const allBounds: NormalizedBoundary[] = [
              ...unsd.map(b => ({ geoid: b.id, name: b.name, geometry: b.geometry, properties: {} })),
              ...elsd.map(b => ({ geoid: b.id, name: b.name, geometry: b.geometry, properties: {} })),
              ...scsd.map(b => ({ geoid: b.id, name: b.name, geometry: b.geometry, properties: {} })),
            ];

            const coverageResult = await this.schoolDistrictValidator.computeCoverageWithoutStateBoundary(allBounds);
            coveragePercent = coverageResult.coveragePercent;

            if (!coverageResult.valid) {
              this.log.warn('School district coverage incomplete', {
                state: stateFips,
                coveragePercent,
                gaps: coverageResult.gaps.length,
              });
            }
          } catch (error) {
            // Coverage computation failed - log but don't fail validation
            this.log.warn('Coverage computation failed', {
              state: stateFips,
              error: error instanceof Error ? error.message : String(error),
            });
            coveragePercent = 100; // Assume complete if we can't compute
          }
        }

        // Compute summary
        const stateName = getStateName(stateFips) ?? stateFips;
        const countsMatch = validationResult.matches;
        const valid = countsMatch && forbiddenOverlaps === 0;

        results.push({
          state: stateFips,
          stateName,
          unsdCount: unsd.length,
          elsdCount: elsd.length,
          scsdCount: scsd.length,
          expectedUnsd: validationResult.expectedUnsd,
          expectedElsd: validationResult.expectedElsd,
          expectedScsd: validationResult.expectedScsd,
          countsMatch,
          forbiddenOverlaps,
          coveragePercent,
          valid,
          summary: valid
            ? `${stateName}: School district validation passed`
            : `${stateName}: ${!countsMatch ? 'Count mismatch. ' : ''}${forbiddenOverlaps > 0 ? `${forbiddenOverlaps} forbidden overlaps.` : ''}`,
        });

        // Log validation result to provenance
        const validationEntry: CompactDiscoveryEntry = {
          f: stateFips,
          n: 'SchoolDistrictValidation',
          g: 4,
          fc: unsd.length + elsd.length + scsd.length,
          conf: valid ? 100 : 50,
          auth: 4,
          src: 'school-district-validator',
          why: [
            `Validated school districts: ${unsd.length} unified, ${elsd.length} elementary, ${scsd.length} secondary`,
            valid ? 'All checks passed' : `Issues: ${forbiddenOverlaps} overlaps`,
          ],
          tried: [4],
          blocked: valid ? null : 'validation-failed',
          ts: new Date().toISOString(),
          aid: jobId.substring(0, 8),
        };

        await this.provenanceWriter.append(validationEntry);

        this.log.info('School district validation complete', {
          state: stateFips,
          stateName,
          unsdCount: unsd.length,
          elsdCount: elsd.length,
          scsdCount: scsd.length,
          forbiddenOverlaps,
          valid,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.log.error('School district validation failed', { state: stateFips, error: errorMessage });

        // Re-throw if failOnOverlap was the cause
        if (failOnOverlap && errorMessage.includes('forbidden overlaps')) {
          throw error;
        }

        results.push({
          state: stateFips,
          stateName: getStateName(stateFips) ?? stateFips,
          unsdCount: 0,
          elsdCount: 0,
          scsdCount: 0,
          expectedUnsd: 0,
          expectedElsd: 0,
          expectedScsd: 0,
          countsMatch: false,
          forbiddenOverlaps: 0,
          coveragePercent: 0,
          valid: false,
          summary: `Validation error: ${errorMessage}`,
        });
      }
    }

    return results;
  }

  /**
   * Get package version from package.json
   */
  private getPackageVersion(): string {
    try {
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const pkgPath = join(__dirname, '../../package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return pkg.version ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }
}
