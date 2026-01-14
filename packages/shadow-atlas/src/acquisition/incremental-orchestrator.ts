/**
 * Incremental Orchestrator - Event-Driven Boundary Update System
 *
 * Refactored from quarterly batch processing to incremental-first architecture.
 * Only downloads sources that have actually changed (via change detection).
 * Updates individual tree branches without full rebuild.
 *
 * DESIGN PHILOSOPHY:
 * - Boundaries change due to PREDICTABLE EVENTS (redistricting, Census, annual updates)
 * - Change detection via HTTP headers (zero download cost)
 * - Incremental updates to affected branches only
 * - Full snapshots as quarterly fallback
 *
 * CRITICAL TYPE SAFETY: Orchestration errors cascade through the entire pipeline.
 * Wrong types here can:
 * - Download unchanged data (waste bandwidth)
 * - Miss critical boundary updates (stale data)
 * - Corrupt existing tree structure (data loss)
 */

import type {
  DatabaseAdapter,
  Municipality,
  Source,
  Artifact,
  EventKind,
  BoundaryType,
} from '../core/types.js';
import type { ChangeReport, CanonicalSource } from './change-detector.js';
import type { DiscoveredLayer, ScanResult } from './arcgis-scanner.js';
import type { SelectedSource } from '../provenance/source-registry.js';
import type { ResolutionResult, SourceClaim } from '../provenance/conflict-resolver.js';
import type { ProvenanceRecord } from '../provenance/provenance-writer.js';
import { ChangeDetector } from './change-detector.js';
import { ArcGISScanner } from './arcgis-scanner.js';
import { SourceRegistry } from '../provenance/source-registry.js';
import { ConflictResolver } from '../provenance/conflict-resolver.js';
import { ProvenanceWriter } from '../provenance/provenance-writer.js';
import { createHash } from 'crypto';
import type { FeatureCollection } from 'geojson';
import { logger } from '../core/utils/logger.js';

/**
 * Refresh error (recoverable vs non-recoverable)
 */
export interface RefreshError {
  readonly sourceId: string;
  readonly error: string;
  readonly recoverable: boolean;
  readonly timestamp: string;
}

/**
 * Incremental refresh result
 */
export interface IncrementalRefreshResult {
  readonly sourcesChecked: number;
  readonly sourcesChanged: number;
  readonly boundariesUpdated: readonly string[];
  readonly errors: readonly RefreshError[];
  readonly durationMs: number;
  readonly runId: string;
}

/**
 * Full snapshot result
 */
export interface FullSnapshotResult {
  readonly municipalitiesProcessed: number;
  readonly boundariesUpdated: readonly string[];
  readonly errors: readonly RefreshError[];
  readonly durationMs: number;
  readonly runId: string;
  readonly snapshotHash: string;
}

/**
 * Orchestrator configuration
 */
export interface OrchestratorConfig {
  readonly changeDetector: ChangeDetector;
  readonly scanner: ArcGISScanner;
  readonly sourceRegistry: SourceRegistry;
  readonly conflictResolver: ConflictResolver;
  readonly provenanceWriter: ProvenanceWriter;
  readonly db: DatabaseAdapter;
  readonly maxConcurrentDownloads?: number;
  readonly maxConcurrentWrites?: number; // Disk I/O concurrency (default: 5)
  readonly retryAttempts?: number;
  readonly retryDelayMs?: number;
}

/**
 * Retry configuration
 */
interface RetryConfig {
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

/**
 * Incremental Orchestrator
 *
 * Event-driven orchestration with change detection and incremental updates.
 * Replaces quarterly batch processing with continuous monitoring.
 */
export class IncrementalOrchestrator {
  private readonly config: OrchestratorConfig;
  private readonly retryConfig: RetryConfig;
  private readonly maxConcurrentDownloads: number;
  private readonly maxConcurrentWrites: number;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.retryConfig = DEFAULT_RETRY_CONFIG;
    this.maxConcurrentDownloads = config.maxConcurrentDownloads ?? 10;
    this.maxConcurrentWrites = config.maxConcurrentWrites ?? 5;
  }

  /**
   * Run incremental refresh (PRIMARY METHOD)
   *
   * ALGORITHM:
   * 1. Check scheduled sources for changes (via HTTP HEAD)
   * 2. Download only changed sources
   * 3. Update affected tree branches incrementally
   * 4. Record provenance for all decisions
   *
   * COST: ~$0 (HEAD requests are free, download only changes)
   * FREQUENCY: Daily or event-driven
   *
   * @returns Refresh result with updated boundaries
   */
  async runIncrementalRefresh(): Promise<IncrementalRefreshResult> {
    const startTime = Date.now();
    const runId = this.generateRunId();
    const errors: RefreshError[] = [];
    const boundariesUpdated: string[] = [];

    logger.info('Starting incremental refresh', {
      runId,
      startTime: new Date().toISOString(),
    });

    try {
      // 1. Check scheduled sources for changes
      logger.info('Checking scheduled sources for changes', { step: '1/4' });
      const changes = await this.config.changeDetector.checkScheduledSources();
      logger.info('Found changed sources', { changedSources: changes.length });

      if (changes.length === 0) {
        logger.info('No changes detected - refresh complete');
        return {
          sourcesChecked: 0,
          sourcesChanged: 0,
          boundariesUpdated: [],
          errors: [],
          durationMs: Date.now() - startTime,
          runId,
        };
      }

      // 2. Download changed sources with concurrency control
      logger.info('Downloading changed sources', { step: '2/4' });
      const downloadResults = await this.downloadChangedSources(changes, runId, errors);
      logger.info('Downloaded changed sources', { downloadCount: downloadResults.length });

      // 3. Update affected tree branches (parallel with batching)
      logger.info('Updating affected tree branches', { step: '3/4' });

      for (let i = 0; i < downloadResults.length; i += this.maxConcurrentWrites) {
        const batch = downloadResults.slice(i, i + this.maxConcurrentWrites);

        const batchResults = await Promise.all(
          batch.map(async (result) => {
            try {
              const updated = await this.updateTreeBranch(result, runId);
              return { updated, muniId: result.muniId, error: null };
            } catch (error) {
              errors.push({
                sourceId: result.sourceId,
                error: `Tree update failed: ${(error as Error).message}`,
                recoverable: false,
                timestamp: new Date().toISOString(),
              });
              return { updated: false, muniId: result.muniId, error: error as Error };
            }
          })
        );

        // Collect successful updates
        for (const batchResult of batchResults) {
          if (batchResult.updated) {
            boundariesUpdated.push(batchResult.muniId);
          }
        }

        // Progress update
        const totalUpdated = boundariesUpdated.length;
        logger.info('Tree branch update progress', { branchesUpdated: totalUpdated });
      }

      logger.info('Completed tree branch updates', { totalBranches: boundariesUpdated.length });

      // 4. Log completion event
      await this.logEvent(runId, null, 'UPDATE', {
        sourcesChanged: changes.length,
        boundariesUpdated: boundariesUpdated.length,
        errors: errors.length,
      });

      const durationMs = Date.now() - startTime;

      logger.info('Incremental refresh complete', {
        sourcesChecked: changes.length,
        sourcesChanged: changes.length,
        boundariesUpdated: boundariesUpdated.length,
        errors: errors.length,
        durationSec: (durationMs / 1000).toFixed(2),
      });

      return {
        sourcesChecked: changes.length,
        sourcesChanged: changes.length,
        boundariesUpdated,
        errors,
        durationMs,
        runId,
      };
    } catch (error) {
      // Fatal error - log and re-throw
      await this.logEvent(runId, null, 'ERROR', {
        error: (error as Error).message,
        stack: (error as Error).stack,
      });

      throw error;
    }
  }

  /**
   * Run full snapshot (FALLBACK METHOD)
   *
   * Use when:
   * - Incremental updates have diverged
   * - New municipality added
   * - Quarterly verification required
   *
   * COST: ~$100-500 in bandwidth (downloads all sources)
   * FREQUENCY: Quarterly or on-demand
   *
   * @returns Snapshot result with all boundaries
   */
  async runFullSnapshot(): Promise<FullSnapshotResult> {
    const startTime = Date.now();
    const runId = this.generateRunId();
    const errors: RefreshError[] = [];
    const boundariesUpdated: string[] = [];

    logger.info('Starting full snapshot', {
      runId,
      startTime: new Date().toISOString(),
    });

    try {
      // 1. Get all municipalities
      logger.info('Loading municipalities', { step: '1/3' });
      const municipalities = await this.config.db.listMunicipalities(100000, 0);
      logger.info('Loaded municipalities', { count: municipalities.length });

      // 2. Process municipalities with concurrency control
      logger.info('Processing municipalities', { step: '2/3' });
      let processed = 0;

      for (let i = 0; i < municipalities.length; i += this.maxConcurrentDownloads) {
        const batch = municipalities.slice(i, i + this.maxConcurrentDownloads);

        await Promise.all(
          batch.map(async (muni) => {
            try {
              const updated = await this.processMunicipality(muni, runId, errors);
              if (updated) {
                boundariesUpdated.push(muni.id);
              }
              processed++;

              if (processed % 100 === 0) {
                logger.info('Municipality processing progress', {
                  processed,
                  total: municipalities.length,
                });
              }
            } catch (error) {
              errors.push({
                sourceId: muni.id,
                error: `Municipality processing failed: ${(error as Error).message}`,
                recoverable: false,
                timestamp: new Date().toISOString(),
              });
            }
          })
        );
      }

      logger.info('Processed municipalities', { count: processed });

      // 3. Compute snapshot hash
      logger.info('Computing snapshot hash', { step: '3/3' });
      const snapshotHash = await this.computeSnapshotHash(boundariesUpdated);
      logger.info('Computed snapshot hash', { hash: snapshotHash });

      const durationMs = Date.now() - startTime;

      logger.info('Full snapshot complete', {
        municipalitiesProcessed: processed,
        boundariesUpdated: boundariesUpdated.length,
        errors: errors.length,
        durationMinutes: (durationMs / 1000 / 60).toFixed(2),
        snapshotHash,
      });

      return {
        municipalitiesProcessed: processed,
        boundariesUpdated,
        errors,
        durationMs,
        runId,
        snapshotHash,
      };
    } catch (error) {
      // Fatal error - log and re-throw
      await this.logEvent(runId, null, 'ERROR', {
        error: (error as Error).message,
        stack: (error as Error).stack,
      });

      throw error;
    }
  }

  /**
   * Force check all sources (emergency use)
   *
   * Use when:
   * - System was offline (missed scheduled checks)
   * - Manual verification needed
   * - Debugging change detection
   *
   * @returns Refresh result
   */
  async forceCheckAll(): Promise<IncrementalRefreshResult> {
    const startTime = Date.now();
    const runId = this.generateRunId();
    const errors: RefreshError[] = [];
    const boundariesUpdated: string[] = [];

    logger.info('Starting force check all sources', { runId });

    try {
      // Check all sources (ignores schedule)
      const changes = await this.config.changeDetector.checkAllSources();
      logger.info('Found changed sources (force check)', { changedSources: changes.length });

      // Download and update (parallel with batching)
      const downloadResults = await this.downloadChangedSources(changes, runId, errors);

      for (let i = 0; i < downloadResults.length; i += this.maxConcurrentWrites) {
        const batch = downloadResults.slice(i, i + this.maxConcurrentWrites);

        const batchResults = await Promise.all(
          batch.map(async (result) => {
            try {
              const updated = await this.updateTreeBranch(result, runId);
              return { updated, muniId: result.muniId, error: null };
            } catch (error) {
              errors.push({
                sourceId: result.sourceId,
                error: `Tree update failed: ${(error as Error).message}`,
                recoverable: false,
                timestamp: new Date().toISOString(),
              });
              return { updated: false, muniId: result.muniId, error: error as Error };
            }
          })
        );

        // Collect successful updates
        for (const batchResult of batchResults) {
          if (batchResult.updated) {
            boundariesUpdated.push(batchResult.muniId);
          }
        }
      }

      return {
        sourcesChecked: changes.length,
        sourcesChanged: changes.length,
        boundariesUpdated,
        errors,
        durationMs: Date.now() - startTime,
        runId,
      };
    } catch (error) {
      await this.logEvent(runId, null, 'ERROR', {
        error: (error as Error).message,
      });

      throw error;
    }
  }

  // ========================================================================
  // PRIVATE METHODS - Download and Update Logic
  // ========================================================================

  /**
   * Download changed sources with concurrency control
   */
  private async downloadChangedSources(
    changes: readonly ChangeReport[],
    runId: string,
    errors: RefreshError[]
  ): Promise<DownloadResult[]> {
    const results: DownloadResult[] = [];

    for (let i = 0; i < changes.length; i += this.maxConcurrentDownloads) {
      const batch = changes.slice(i, i + this.maxConcurrentDownloads);

      const batchResults = await Promise.all(
        batch.map(async (change) => {
          try {
            return await this.downloadWithRetry(change, runId);
          } catch (error) {
            errors.push({
              sourceId: change.sourceId,
              error: `Download failed: ${(error as Error).message}`,
              recoverable: true,
              timestamp: new Date().toISOString(),
            });
            return null;
          }
        })
      );

      results.push(...batchResults.filter((r): r is DownloadResult => r !== null));
    }

    return results;
  }

  /**
   * Download source with exponential backoff retry
   */
  private async downloadWithRetry(
    change: ChangeReport,
    runId: string
  ): Promise<DownloadResult> {
    let lastError: Error | null = null;
    let delayMs = this.retryConfig.initialDelayMs;

    for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
      try {
        return await this.downloadSource(change, runId);
      } catch (error) {
        lastError = error as Error;

        if (attempt === this.retryConfig.maxAttempts) {
          break;
        }

        logger.warn('Retrying download', {
          attempt,
          maxAttempts: this.retryConfig.maxAttempts,
          sourceId: change.sourceId,
          error: lastError.message,
        });

        await this.sleep(delayMs);
        delayMs = Math.min(
          delayMs * this.retryConfig.backoffMultiplier,
          this.retryConfig.maxDelayMs
        );
      }
    }

    throw lastError || new Error('Download failed after retries');
  }

  /**
   * Download single source
   */
  private async downloadSource(
    change: ChangeReport,
    runId: string
  ): Promise<DownloadResult> {
    // Fetch GeoJSON from source
    const response = await fetch(change.url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const geojson = (await response.json()) as FeatureCollection;

    // Validate GeoJSON structure
    if (!geojson.features || geojson.features.length === 0) {
      throw new Error('Downloaded GeoJSON contains no features');
    }

    // Compute content hash
    const contentHash = this.computeContentHash(geojson);

    // Extract municipality ID from source ID (format: "ca-los_angeles")
    const muniId = this.extractMuniId(change.sourceId);

    // Log download event
    await this.logEvent(runId, muniId, 'FETCH', {
      sourceId: change.sourceId,
      url: change.url,
      checksum: change.newChecksum,
      featureCount: geojson.features.length,
    });

    return {
      sourceId: change.sourceId,
      muniId,
      geojson,
      contentHash,
      checksum: change.newChecksum,
      changeType: change.changeType,
    };
  }

  /**
   * Process single municipality (full snapshot mode)
   */
  private async processMunicipality(
    muni: Municipality,
    runId: string,
    errors: RefreshError[]
  ): Promise<boolean> {
    try {
      // 1. Get existing selection
      const selection = await this.config.db.getSelection(muni.id);

      if (!selection) {
        // No selection - skip (municipality not yet discovered)
        return false;
      }

      // 2. Get source details
      const sources = await this.config.db.getSourcesByMuni(muni.id);
      const selectedSource = sources.find((s) => s.id === selection.source_id);

      if (!selectedSource) {
        throw new Error(`Selected source ${selection.source_id} not found`);
      }

      // 3. Download source
      const response = await fetch(selectedSource.url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const geojson = (await response.json()) as FeatureCollection;

      if (!geojson.features || geojson.features.length === 0) {
        throw new Error('Downloaded GeoJSON contains no features');
      }

      // 4. Create artifact
      const contentHash = this.computeContentHash(geojson);
      const bbox = this.computeBBox(geojson);

      const artifactId = await this.config.db.insertArtifact({
        muni_id: muni.id,
        content_sha256: contentHash,
        record_count: geojson.features.length,
        bbox,
        etag: response.headers.get('etag'),
        last_modified: response.headers.get('last-modified'),
        last_edit_date: null,
      });

      // 5. Update head pointer
      await this.config.db.upsertHead({
        muni_id: muni.id,
        artifact_id: artifactId,
      });

      // 6. Log event
      await this.logEvent(runId, muni.id, 'UPDATE', {
        artifactId,
        contentHash,
        featureCount: geojson.features.length,
      });

      return true;
    } catch (error) {
      errors.push({
        sourceId: muni.id,
        error: `Processing failed: ${(error as Error).message}`,
        recoverable: false,
        timestamp: new Date().toISOString(),
      });

      return false;
    }
  }

  /**
   * Update tree branch for changed boundary
   */
  private async updateTreeBranch(
    result: DownloadResult,
    runId: string
  ): Promise<boolean> {
    // 1. Check if content actually changed (compare hash)
    const existingHead = await this.config.db.getHead(result.muniId);

    if (existingHead) {
      const existingArtifact = await this.config.db.getArtifact(existingHead.artifact_id);

      if (existingArtifact?.content_sha256 === result.contentHash) {
        // Content unchanged (same data, different checksum)
        logger.info('Content unchanged, skipping', { muniId: result.muniId });
        return false;
      }
    }

    // 2. Create new artifact
    const bbox = this.computeBBox(result.geojson);

    const artifactId = await this.config.db.insertArtifact({
      muni_id: result.muniId,
      content_sha256: result.contentHash,
      record_count: result.geojson.features.length,
      bbox,
      etag: result.checksum,
      last_modified: new Date().toISOString(),
      last_edit_date: null,
    });

    // 3. Update head pointer
    await this.config.db.upsertHead({
      muni_id: result.muniId,
      artifact_id: artifactId,
    });

    // 4. Update checksum in change detector
    await this.config.changeDetector.updateChecksum(result.sourceId, result.checksum);

    // 5. Log event
    await this.logEvent(runId, result.muniId, 'UPDATE', {
      artifactId,
      contentHash: result.contentHash,
      featureCount: result.geojson.features.length,
      changeType: result.changeType,
    });

    logger.info('Updated tree branch', {
      muniId: result.muniId,
      changeType: result.changeType,
      featureCount: result.geojson.features.length,
    });

    return true;
  }

  // ========================================================================
  // PRIVATE METHODS - Utility Functions
  // ========================================================================

  /**
   * Generate unique run ID
   */
  private generateRunId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `run-${timestamp}-${random}`;
  }

  /**
   * Compute content hash (SHA-256 of GeoJSON)
   */
  private computeContentHash(geojson: FeatureCollection): string {
    const canonicalJson = JSON.stringify(geojson, null, 0);
    return createHash('sha256').update(canonicalJson).digest('hex');
  }

  /**
   * Compute bounding box from GeoJSON
   */
  private computeBBox(geojson: FeatureCollection): [number, number, number, number] | null {
    if (!geojson.features || geojson.features.length === 0) {
      return null;
    }

    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;

    for (const feature of geojson.features) {
      if (!feature.geometry || feature.geometry.type === 'GeometryCollection' || !feature.geometry.coordinates) {
        continue;
      }

      const coords = this.extractAllCoordinates(feature.geometry.coordinates);

      for (const [lon, lat] of coords) {
        minLon = Math.min(minLon, lon);
        minLat = Math.min(minLat, lat);
        maxLon = Math.max(maxLon, lon);
        maxLat = Math.max(maxLat, lat);
      }
    }

    if (!isFinite(minLon)) {
      return null;
    }

    return [minLon, minLat, maxLon, maxLat];
  }

  /**
   * Extract all coordinates from nested GeoJSON geometry
   */
  private extractAllCoordinates(coords: unknown): Array<[number, number]> {
    const results: Array<[number, number]> = [];

    if (!Array.isArray(coords)) {
      return results;
    }

    // Point: [lon, lat]
    if (coords.length === 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      results.push([coords[0], coords[1]]);
      return results;
    }

    // Nested array (LineString, Polygon, MultiPolygon)
    for (const item of coords) {
      results.push(...this.extractAllCoordinates(item));
    }

    return results;
  }

  /**
   * Extract municipality ID from source ID
   * Format: "ca-los_angeles" or similar
   */
  private extractMuniId(sourceId: string): string {
    // Simple extraction - in production, map source ID to muni ID via database
    return sourceId;
  }

  /**
   * Compute snapshot hash from boundary IDs
   */
  private async computeSnapshotHash(boundaryIds: readonly string[]): Promise<string> {
    const sortedIds = [...boundaryIds].sort();
    const concatenated = sortedIds.join(',');
    return createHash('sha256').update(concatenated).digest('hex');
  }

  /**
   * Log event to database
   */
  private async logEvent(
    runId: string,
    muniId: string | null,
    kind: EventKind,
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.config.db.insertEvent({
      run_id: runId,
      muni_id: muniId,
      kind,
      payload,
      model: null,
      duration_ms: null,
      error: null,
    });
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

/**
 * Download result (internal)
 */
interface DownloadResult {
  readonly sourceId: string;
  readonly muniId: string;
  readonly geojson: FeatureCollection;
  readonly contentHash: string;
  readonly checksum: string;
  readonly changeType: 'new' | 'modified' | 'deleted';
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create orchestrator with default configuration
 *
 * @param db - Database adapter
 * @returns Configured orchestrator
 */
export function createIncrementalOrchestrator(
  db: DatabaseAdapter
): IncrementalOrchestrator {
  const changeDetector = new ChangeDetector(db);
  const scanner = new ArcGISScanner();
  const sourceRegistry = new SourceRegistry();
  const conflictResolver = new ConflictResolver();
  const provenanceWriter = new ProvenanceWriter();

  return new IncrementalOrchestrator({
    changeDetector,
    scanner,
    sourceRegistry,
    conflictResolver,
    provenanceWriter,
    db,
    maxConcurrentDownloads: 10,
  });
}

/**
 * CLI entry point
 */
export async function main(): Promise<void> {
  const command = process.argv[2] || 'incremental';

  // Initialize database adapter from environment
  const { createDatabaseAdapter } = await import('../db/factory.js');
  const db = await createDatabaseAdapter();

  const orchestrator = createIncrementalOrchestrator(db);

  try {
    switch (command) {
      case 'incremental':
        await orchestrator.runIncrementalRefresh();
        break;
      case 'full':
        await orchestrator.runFullSnapshot();
        break;
      case 'force':
        await orchestrator.forceCheckAll();
        break;
      default:
        logger.error('Unknown command', { command });
        logger.error('Usage: incremental-orchestrator [incremental|full|force]');
        process.exit(1);
    }
  } finally {
    await db.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error('Fatal error in orchestrator', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  });
}
