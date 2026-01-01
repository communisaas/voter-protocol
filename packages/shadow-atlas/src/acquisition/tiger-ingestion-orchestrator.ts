/**
 * TIGER Ingestion Orchestrator
 *
 * Robust batch ingestion orchestrator for multi-state, multi-layer TIGER downloads.
 * Provides:
 * - Checkpointing for resumable batch operations
 * - Circuit breaker for fault tolerance
 * - Concurrent state processing with configurable limits
 * - Error aggregation and recovery
 *
 * DESIGN PHILOSOPHY:
 * - Batch operations should be resumable after failure
 * - Circuit breaker prevents cascading failures
 * - Concurrent downloads respect Census FTP rate limits
 * - Checkpoints enable partial completion recovery
 *
 * CRITICAL TYPE SAFETY: Ingestion errors cascade through the pipeline.
 * Wrong types here can:
 * - Download unchanged data (waste bandwidth)
 * - Miss critical boundary updates (stale data)
 * - Corrupt checkpoint state (unrecoverable)
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { TIGERBoundaryProvider, TIGERDownloadOptions } from '../providers/tiger-boundary-provider.js';
import type { ShadowAtlasConfig } from '../core/config.js';
import type { TIGERLayerType, NormalizedBoundary } from '../core/types.js';
import type { DownloadDLQ } from './download-dlq.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Batch ingestion options for multi-state, multi-layer downloads
 */
export interface BatchIngestionOptions {
  /** State FIPS codes to ingest (e.g., ['01', '06', '36']) */
  readonly states: readonly string[];

  /** TIGER layers to download per state */
  readonly layers: readonly TIGERLayerType[];

  /** TIGER data year (defaults to provider's configured year) */
  readonly year: number;

  /** Maximum concurrent state downloads (default: 5) */
  readonly maxConcurrentStates?: number;

  /** Consecutive failures before circuit breaker trips (default: 5) */
  readonly circuitBreakerThreshold?: number;

  /** Directory for checkpoint files (default: .shadow-atlas/checkpoints) */
  readonly checkpointDir?: string;

  /** Force re-download even if cached (default: false) */
  readonly forceRefresh?: boolean;
}

/**
 * Batch ingestion result with comprehensive status
 */
export interface BatchIngestionResult {
  /** Whether all states completed successfully */
  readonly success: boolean;

  /** Number of states that completed successfully */
  readonly completed: number;

  /** Number of states that failed */
  readonly failed: number;

  /** Total boundaries downloaded and normalized */
  readonly boundaries: readonly NormalizedBoundary[];

  /** Detailed error information for failed states */
  readonly errors: readonly BatchIngestionError[];

  /** Checkpoint state for resume capability */
  readonly checkpoint: CheckpointState;

  /** Total duration in milliseconds */
  readonly durationMs: number;

  /** Whether circuit breaker tripped */
  readonly circuitBreakerTripped: boolean;
}

/**
 * Error details for failed state/layer ingestion
 */
export interface BatchIngestionError {
  /** State FIPS code that failed */
  readonly state: string;

  /** Layer that failed (or 'all' if entire state failed) */
  readonly layer: TIGERLayerType | 'all';

  /** Error message */
  readonly error: string;

  /** Whether this error is retryable (network vs data issue) */
  readonly retryable: boolean;

  /** Timestamp of failure */
  readonly timestamp: string;

  /** Attempt number when failure occurred */
  readonly attempt?: number;
}

/**
 * Checkpoint state for resumable batch operations
 *
 * Persisted to disk after each batch to enable recovery from failures.
 */
export interface CheckpointState {
  /** Unique checkpoint identifier */
  readonly id: string;

  /** When batch ingestion started */
  readonly startedAt: string;

  /** Last checkpoint update timestamp */
  readonly updatedAt: string;

  /** States that completed successfully */
  readonly completedStates: readonly string[];

  /** States that failed (may be retried on resume) */
  readonly failedStates: readonly string[];

  /** States not yet processed */
  readonly pendingStates: readonly string[];

  /** Original batch options */
  readonly options: BatchIngestionOptions;

  /** Circuit breaker state */
  readonly circuitOpen: boolean;

  /** Consecutive failure count at checkpoint */
  readonly consecutiveFailures: number;

  /** Total boundaries collected so far */
  readonly boundaryCount: number;
}

/**
 * State ingestion result (internal)
 */
interface StateIngestionResult {
  readonly state: string;
  readonly success: boolean;
  readonly boundaries: NormalizedBoundary[];
  readonly error?: BatchIngestionError;
}

// ============================================================================
// TIGER Ingestion Orchestrator
// ============================================================================

/**
 * TIGER Ingestion Orchestrator
 *
 * Coordinates multi-state, multi-layer batch downloads with:
 * - Checkpointing for resumability
 * - Circuit breaker for fault tolerance
 * - Concurrent processing with rate limiting
 *
 * @example
 * ```typescript
 * const orchestrator = new TIGERIngestionOrchestrator(provider, config);
 *
 * // Full batch ingestion
 * const result = await orchestrator.ingestBatch({
 *   states: ['01', '02', '04', '05', '06'],
 *   layers: ['cd', 'sldu', 'sldl'],
 *   year: 2024,
 * });
 *
 * // Resume from checkpoint after failure
 * const resumed = await orchestrator.resumeFromCheckpoint(result.checkpoint.id);
 * ```
 */
export class TIGERIngestionOrchestrator {
  private consecutiveFailures = 0;
  private circuitOpen = false;

  constructor(
    private readonly provider: TIGERBoundaryProvider,
    private readonly config: ShadowAtlasConfig,
    private readonly dlq?: DownloadDLQ
  ) {}

  /**
   * Ingest boundaries for multiple states and layers
   *
   * ALGORITHM:
   * 1. Create checkpoint with initial state
   * 2. Process states in batches (respecting concurrency limit)
   * 3. For each state, download all requested layers
   * 4. Track failures, trip circuit breaker if threshold exceeded
   * 5. Save checkpoint after each batch
   *
   * @param options - Batch ingestion configuration
   * @returns Comprehensive result with boundaries, errors, and checkpoint
   */
  async ingestBatch(options: BatchIngestionOptions): Promise<BatchIngestionResult> {
    const startTime = Date.now();
    const checkpoint = this.createCheckpoint(options);
    const results: NormalizedBoundary[] = [];
    const errors: BatchIngestionError[] = [];

    // Reset circuit breaker state for new batch
    this.consecutiveFailures = 0;
    this.circuitOpen = false;

    const maxConcurrent = options.maxConcurrentStates ?? 5;
    const circuitThreshold = options.circuitBreakerThreshold ?? 5;
    const checkpointDir = options.checkpointDir ??
      this.config.batchIngestion?.checkpointDir ??
      join(this.config.storageDir, 'checkpoints');

    console.log('='.repeat(80));
    console.log('TIGER BATCH INGESTION - Multi-State, Multi-Layer Download');
    console.log('='.repeat(80));
    console.log(`Checkpoint ID: ${checkpoint.id}`);
    console.log(`States: ${options.states.length}`);
    console.log(`Layers: ${options.layers.join(', ')}`);
    console.log(`Year: ${options.year}`);
    console.log(`Max Concurrent: ${maxConcurrent}`);
    console.log(`Circuit Breaker Threshold: ${circuitThreshold}`);
    console.log('='.repeat(80));

    // Mutable checkpoint for updates
    const mutableCheckpoint: MutableCheckpointState = {
      ...checkpoint,
      completedStates: [...checkpoint.completedStates],
      failedStates: [...checkpoint.failedStates],
      pendingStates: [...checkpoint.pendingStates],
    };

    // Process states in batches
    for (let i = 0; i < options.states.length; i += maxConcurrent) {
      if (this.circuitOpen) {
        console.log('\n[CIRCUIT BREAKER] Open - aborting remaining states');
        break;
      }

      const batch = options.states.slice(i, i + maxConcurrent);
      const batchNum = Math.floor(i / maxConcurrent) + 1;
      const totalBatches = Math.ceil(options.states.length / maxConcurrent);

      console.log(`\n[Batch ${batchNum}/${totalBatches}] Processing states: ${batch.join(', ')}`);

      const batchResults = await Promise.allSettled(
        batch.map((state) =>
          this.ingestState(state, options.layers, options.year, options.forceRefresh)
        )
      );

      // Process batch results
      for (let j = 0; j < batchResults.length; j++) {
        const state = batch[j];
        const result = batchResults[j];

        // Remove from pending
        const pendingIndex = mutableCheckpoint.pendingStates.indexOf(state);
        if (pendingIndex !== -1) {
          mutableCheckpoint.pendingStates.splice(pendingIndex, 1);
        }

        if (result.status === 'fulfilled' && result.value.success) {
          // Success
          results.push(...result.value.boundaries);
          mutableCheckpoint.completedStates.push(state);
          this.consecutiveFailures = 0; // Reset on success

          console.log(
            `   [OK] ${state}: ${result.value.boundaries.length} boundaries`
          );
        } else {
          // Failure
          const error: BatchIngestionError =
            result.status === 'rejected'
              ? {
                  state,
                  layer: 'all',
                  error: (result.reason as Error)?.message ?? 'Unknown error',
                  retryable: this.isRetryable(result.reason),
                  timestamp: new Date().toISOString(),
                }
              : result.value.error ?? {
                  state,
                  layer: 'all',
                  error: 'Unknown failure',
                  retryable: false,
                  timestamp: new Date().toISOString(),
                };

          errors.push(error);
          mutableCheckpoint.failedStates.push(state);
          this.consecutiveFailures++;

          console.log(`   [FAIL] ${state}: ${error.error}`);

          // Check circuit breaker
          if (this.consecutiveFailures >= circuitThreshold) {
            this.circuitOpen = true;
            console.error(
              `\n[CIRCUIT BREAKER] Tripped after ${circuitThreshold} consecutive failures`
            );
          }
        }
      }

      // Update and save checkpoint after each batch
      mutableCheckpoint.updatedAt = new Date().toISOString();
      mutableCheckpoint.circuitOpen = this.circuitOpen;
      mutableCheckpoint.consecutiveFailures = this.consecutiveFailures;
      mutableCheckpoint.boundaryCount = results.length;

      await this.saveCheckpoint(toImmutableCheckpoint(mutableCheckpoint), checkpointDir);
    }

    const durationMs = Date.now() - startTime;
    const finalCheckpoint = toImmutableCheckpoint(mutableCheckpoint);

    console.log('\n' + '='.repeat(80));
    console.log('BATCH INGESTION COMPLETE');
    console.log('='.repeat(80));
    console.log(`Completed: ${mutableCheckpoint.completedStates.length} states`);
    console.log(`Failed: ${mutableCheckpoint.failedStates.length} states`);
    console.log(`Pending: ${mutableCheckpoint.pendingStates.length} states`);
    console.log(`Boundaries: ${results.length}`);
    console.log(`Duration: ${(durationMs / 1000).toFixed(2)}s`);
    console.log(`Circuit Breaker: ${this.circuitOpen ? 'TRIPPED' : 'OK'}`);
    console.log(`Checkpoint: ${finalCheckpoint.id}`);
    console.log('='.repeat(80));

    return {
      success: errors.length === 0 && !this.circuitOpen,
      completed: mutableCheckpoint.completedStates.length,
      failed: mutableCheckpoint.failedStates.length,
      boundaries: results,
      errors,
      checkpoint: finalCheckpoint,
      durationMs,
      circuitBreakerTripped: this.circuitOpen,
    };
  }

  /**
   * Resume batch ingestion from a checkpoint
   *
   * Loads checkpoint from disk and continues with:
   * - Previously failed states (for retry)
   * - Remaining pending states
   *
   * @param checkpointId - Checkpoint ID to resume from
   * @param retryFailed - Whether to retry failed states (default: true)
   * @returns Batch ingestion result for resumed operation
   */
  async resumeFromCheckpoint(
    checkpointId: string,
    retryFailed = true
  ): Promise<BatchIngestionResult> {
    const checkpointDir =
      this.config.batchIngestion?.checkpointDir ??
      join(this.config.storageDir, 'checkpoints');

    const checkpoint = await this.loadCheckpoint(checkpointId, checkpointDir);
    if (!checkpoint) {
      throw new Error(`Checkpoint ${checkpointId} not found in ${checkpointDir}`);
    }

    console.log('='.repeat(80));
    console.log('RESUMING BATCH INGESTION FROM CHECKPOINT');
    console.log('='.repeat(80));
    console.log(`Checkpoint ID: ${checkpointId}`);
    console.log(`Originally started: ${checkpoint.startedAt}`);
    console.log(`Completed states: ${checkpoint.completedStates.length}`);
    console.log(`Failed states: ${checkpoint.failedStates.length}`);
    console.log(`Pending states: ${checkpoint.pendingStates.length}`);
    console.log('='.repeat(80));

    // Determine which states to process
    const statesToProcess: string[] = [...checkpoint.pendingStates];

    if (retryFailed) {
      statesToProcess.push(...checkpoint.failedStates);
      console.log(`Retrying ${checkpoint.failedStates.length} failed states`);
    }

    if (statesToProcess.length === 0) {
      console.log('No states to process - batch already complete');
      return {
        success: checkpoint.failedStates.length === 0,
        completed: checkpoint.completedStates.length,
        failed: checkpoint.failedStates.length,
        boundaries: [],
        errors: [],
        checkpoint,
        durationMs: 0,
        circuitBreakerTripped: checkpoint.circuitOpen,
      };
    }

    // Resume with remaining states
    return this.ingestBatch({
      ...checkpoint.options,
      states: statesToProcess,
    });
  }

  /**
   * Get checkpoint status without loading full data
   *
   * @param checkpointId - Checkpoint ID to check
   * @returns Checkpoint state or null if not found
   */
  async getCheckpointStatus(checkpointId: string): Promise<CheckpointState | null> {
    const checkpointDir =
      this.config.batchIngestion?.checkpointDir ??
      join(this.config.storageDir, 'checkpoints');

    return this.loadCheckpoint(checkpointId, checkpointDir);
  }

  /**
   * List all available checkpoints
   *
   * @returns Array of checkpoint IDs (most recent first)
   */
  async listCheckpoints(): Promise<string[]> {
    const checkpointDir =
      this.config.batchIngestion?.checkpointDir ??
      join(this.config.storageDir, 'checkpoints');

    try {
      const { readdir } = await import('node:fs/promises');
      const files = await readdir(checkpointDir);
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace('.json', ''))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  /**
   * Reset circuit breaker (for manual intervention)
   */
  resetCircuitBreaker(): void {
    this.consecutiveFailures = 0;
    this.circuitOpen = false;
    console.log('[CIRCUIT BREAKER] Reset manually');
  }

  /**
   * Retry failed downloads from DLQ
   *
   * Processes pending downloads from the Dead Letter Queue.
   * Useful for recovering from transient network failures after process restart.
   *
   * @param limit - Maximum number of downloads to retry (default: 50)
   * @returns Number of successfully retried downloads
   */
  async retryFromDLQ(limit = 50): Promise<number> {
    if (!this.dlq) {
      console.log('⚠️  DLQ not configured, skipping retry');
      return 0;
    }

    console.log('='.repeat(80));
    console.log('RETRYING FAILED DOWNLOADS FROM DLQ');
    console.log('='.repeat(80));

    const retryable = await this.dlq.getRetryableDownloads(limit);

    if (retryable.length === 0) {
      console.log('✅ No failed downloads to retry');
      return 0;
    }

    console.log(`Found ${retryable.length} downloads to retry`);

    let successCount = 0;

    for (const download of retryable) {
      console.log(`\n[RETRY] ${download.layer} - ${download.stateFips ?? 'national'} (attempt ${download.attemptCount + 1}/${download.maxAttempts})`);

      await this.dlq.markRetrying(download.id);

      try {
        // Retry the download
        const downloadOptions: TIGERDownloadOptions = {
          layer: download.layer,
          stateFips: download.stateFips,
          year: download.year,
          forceRefresh: true, // Force re-download
        };

        await this.provider.downloadLayer(downloadOptions);

        // Success - mark as resolved
        await this.dlq.markResolved(download.id);
        successCount++;
        console.log(`   ✅ Retry succeeded`);
      } catch (error) {
        const errorMessage = (error as Error).message;
        console.log(`   ❌ Retry failed: ${errorMessage}`);

        // Increment attempt count
        await this.dlq.incrementAttempt(download.id, errorMessage);

        // Check if exhausted
        if (download.attemptCount + 1 >= download.maxAttempts) {
          await this.dlq.markExhausted(download.id);
          console.log(`   ⚠️  Max retries reached, marked as exhausted`);
        }
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('DLQ RETRY COMPLETE');
    console.log('='.repeat(80));
    console.log(`Succeeded: ${successCount}/${retryable.length}`);
    console.log(`Failed: ${retryable.length - successCount}/${retryable.length}`);
    console.log('='.repeat(80));

    return successCount;
  }

  // ========================================================================
  // Private Methods
  // ========================================================================

  /**
   * Ingest all layers for a single state
   */
  private async ingestState(
    stateFips: string,
    layers: readonly TIGERLayerType[],
    year: number,
    forceRefresh?: boolean
  ): Promise<StateIngestionResult> {
    const boundaries: NormalizedBoundary[] = [];

    for (const layer of layers) {
      try {
        const downloadOptions: TIGERDownloadOptions = {
          layer: layer as Parameters<typeof this.provider.downloadLayer>[0]['layer'],
          stateFips,
          year,
          forceRefresh,
        };

        const rawFiles = await this.provider.downloadLayer(downloadOptions);
        const normalized = await this.provider.transform(rawFiles);
        boundaries.push(...normalized);
      } catch (error) {
        // If any layer fails, fail the entire state
        return {
          state: stateFips,
          success: false,
          boundaries: [],
          error: {
            state: stateFips,
            layer,
            error: (error as Error).message,
            retryable: this.isRetryable(error),
            timestamp: new Date().toISOString(),
          },
        };
      }
    }

    return {
      state: stateFips,
      success: true,
      boundaries,
    };
  }

  /**
   * Create initial checkpoint state
   */
  private createCheckpoint(options: BatchIngestionOptions): CheckpointState {
    const now = new Date().toISOString();
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    const id = `ckpt_${Date.now()}_${randomSuffix}`;

    return {
      id,
      startedAt: now,
      updatedAt: now,
      completedStates: [],
      failedStates: [],
      pendingStates: [...options.states],
      options,
      circuitOpen: false,
      consecutiveFailures: 0,
      boundaryCount: 0,
    };
  }

  /**
   * Save checkpoint to disk
   */
  private async saveCheckpoint(
    checkpoint: CheckpointState,
    checkpointDir: string
  ): Promise<void> {
    try {
      await mkdir(checkpointDir, { recursive: true });
      const filePath = join(checkpointDir, `${checkpoint.id}.json`);
      await writeFile(filePath, JSON.stringify(checkpoint, null, 2), 'utf-8');
    } catch (error) {
      console.error(`Failed to save checkpoint: ${(error as Error).message}`);
      // Don't throw - checkpoint save failure shouldn't abort batch
    }
  }

  /**
   * Load checkpoint from disk
   */
  private async loadCheckpoint(
    id: string,
    checkpointDir: string
  ): Promise<CheckpointState | null> {
    const filePath = join(checkpointDir, `${id}.json`);

    try {
      await access(filePath);
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as CheckpointState;
    } catch {
      return null;
    }
  }

  /**
   * Determine if an error is retryable
   *
   * Network errors and rate limits are retryable.
   * Data format errors and 404s are not.
   */
  private isRetryable(error: unknown): boolean {
    const message = (error as Error)?.message ?? '';
    const code = (error as NodeJS.ErrnoException)?.code ?? '';

    // Network errors are retryable
    if (
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'ENOTFOUND' ||
      code === 'ECONNREFUSED'
    ) {
      return true;
    }

    // HTTP rate limits are retryable
    if (message.includes('429') || message.includes('Too Many Requests')) {
      return true;
    }

    // Server errors are retryable
    if (
      message.includes('500') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504')
    ) {
      return true;
    }

    // Temporary errors are retryable
    if (
      message.includes('ECONNRESET') ||
      message.includes('ETIMEDOUT') ||
      message.includes('socket hang up')
    ) {
      return true;
    }

    // Everything else is not retryable (404, parse errors, etc.)
    return false;
  }
}

// ============================================================================
// Helper Types and Functions
// ============================================================================

/**
 * Mutable checkpoint state for internal use
 */
interface MutableCheckpointState {
  id: string;
  startedAt: string;
  updatedAt: string;
  completedStates: string[];
  failedStates: string[];
  pendingStates: string[];
  options: BatchIngestionOptions;
  circuitOpen: boolean;
  consecutiveFailures: number;
  boundaryCount: number;
}

/**
 * Convert mutable checkpoint to immutable
 */
function toImmutableCheckpoint(mutable: MutableCheckpointState): CheckpointState {
  return {
    id: mutable.id,
    startedAt: mutable.startedAt,
    updatedAt: mutable.updatedAt,
    completedStates: [...mutable.completedStates],
    failedStates: [...mutable.failedStates],
    pendingStates: [...mutable.pendingStates],
    options: mutable.options,
    circuitOpen: mutable.circuitOpen,
    consecutiveFailures: mutable.consecutiveFailures,
    boundaryCount: mutable.boundaryCount,
  };
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a TIGER ingestion orchestrator with configuration
 *
 * @param provider - TIGER boundary provider instance
 * @param config - Shadow Atlas configuration
 * @param dlq - Optional Dead Letter Queue for failed download persistence
 * @returns Configured orchestrator
 *
 * @example
 * ```typescript
 * import { TIGERBoundaryProvider } from './providers/tiger-boundary-provider.js';
 * import { createConfig } from './core/config.js';
 * import { createDownloadDLQ } from './acquisition/download-dlq.js';
 * import Database from 'better-sqlite3';
 *
 * const db = new Database('./shadow-atlas.db');
 * const dlq = createDownloadDLQ(db);
 * const provider = new TIGERBoundaryProvider({ year: 2024, dlq });
 * const config = createConfig({ storageDir: './data' });
 * const orchestrator = createTIGERIngestionOrchestrator(provider, config, dlq);
 * ```
 */
export function createTIGERIngestionOrchestrator(
  provider: TIGERBoundaryProvider,
  config: ShadowAtlasConfig,
  dlq?: DownloadDLQ
): TIGERIngestionOrchestrator {
  return new TIGERIngestionOrchestrator(provider, config, dlq);
}
