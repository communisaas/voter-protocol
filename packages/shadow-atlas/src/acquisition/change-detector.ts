/**
 * Change Detector - Event-Driven Update Detection
 *
 * Uses HTTP headers to detect source changes without downloading.
 * Checks sources on schedules aligned with known update triggers.
 *
 * Cost: $0/year (HEAD requests are free)
 *
 * CRITICAL TYPE SAFETY: Change detection drives download orchestration.
 * Type errors here waste bandwidth downloading unchanged data or miss
 * critical boundary updates.
 */

import type { DatabaseAdapter, Source, Artifact } from '../core/types.js';
import { logger } from '../core/utils/logger.js';

/**
 * Update trigger types
 * Boundaries change due to PREDICTABLE EVENTS, not continuously
 */
export type UpdateTrigger =
  | { readonly type: 'annual'; readonly month: number }           // Annual update in specified month (1-12)
  | { readonly type: 'redistricting'; readonly years: readonly number[] } // Specific years (e.g., 2021-2022)
  | { readonly type: 'census'; readonly year: number }            // Census years (2020, 2030, 2040)
  | { readonly type: 'manual' };                                  // Manual trigger

/**
 * Canonical source with update schedule
 */
export interface CanonicalSource {
  readonly id: string;                        // Source ID (from sources table)
  readonly url: string;                       // Source URL
  readonly boundaryType: string;              // e.g., 'congressional', 'municipal', 'county'
  readonly lastChecksum: string | null;       // Last known ETag or Last-Modified
  readonly lastChecked: string | null;        // ISO timestamp of last check
  readonly nextScheduledCheck: string;        // ISO timestamp of next scheduled check
  readonly updateTriggers: readonly UpdateTrigger[];
}

/**
 * Change detection result
 */
export interface ChangeReport {
  readonly sourceId: string;
  readonly url: string;
  readonly oldChecksum: string | null;
  readonly newChecksum: string;
  readonly detectedAt: string;                // ISO timestamp
  readonly trigger: 'scheduled' | 'manual' | 'forced';
  readonly changeType: 'new' | 'modified' | 'deleted';
}

/**
 * Individual check result (for diagnostics)
 */
export interface CheckResult {
  readonly sourceId: string;
  readonly checked: boolean;
  readonly changed: boolean;
  readonly error?: string;
  readonly latencyMs: number;
}

/**
 * Configuration for HEAD request retries
 */
interface RetryConfig {
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;
}

/**
 * HTTP headers for change detection
 */
interface ChangeHeaders {
  readonly etag: string | null;
  readonly lastModified: string | null;
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
 * Request timeout (5 seconds)
 */
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Configuration for batched change detection
 */
interface BatchConfig {
  readonly batchSize: number;            // Sources per batch (default: 20)
  readonly delayBetweenBatchesMs: number; // Delay between batches (default: 0)
  readonly maxConcurrent: number;        // Max concurrent requests (default: 20)
  readonly enableProgressReporting: boolean; // Log progress (default: true)
}

/**
 * Default batch configuration
 */
const DEFAULT_BATCH_CONFIG: BatchConfig = {
  batchSize: 20,
  delayBetweenBatchesMs: 0,
  maxConcurrent: 20,
  enableProgressReporting: true,
};

/**
 * Safe check result (includes error information)
 */
interface SafeCheckResult {
  readonly source: CanonicalSource;
  readonly change: ChangeReport | null;
  readonly error: Error | null;
  readonly latencyMs: number;
}

/**
 * Change Detector
 *
 * Event-driven change detection using HTTP headers.
 * Only downloads sources that have actually changed.
 */
export class ChangeDetector {
  private readonly batchConfig: BatchConfig;

  constructor(
    private readonly db: DatabaseAdapter,
    private readonly retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG,
    batchConfig: Partial<BatchConfig> = {}
  ) {
    this.batchConfig = {
      ...DEFAULT_BATCH_CONFIG,
      ...batchConfig,
    };
  }

  /**
   * Check if a single source has changed
   * Uses HEAD request to compare ETag/Last-Modified
   * Returns null if unchanged
   */
  async checkForChange(source: CanonicalSource): Promise<ChangeReport | null> {
    const startTime = Date.now();

    try {
      // Fetch current headers with retry logic
      const headers = await this.fetchHeadersWithRetry(source.url);

      // No headers available (404, network error, etc.)
      if (!headers.etag && !headers.lastModified) {
        return null;
      }

      // Determine new checksum (prefer ETag over Last-Modified)
      const newChecksum = headers.etag || headers.lastModified;

      if (!newChecksum) {
        return null;
      }

      // Compare with stored checksum
      if (source.lastChecksum === newChecksum) {
        return null; // No change
      }

      // Determine change type
      const changeType = source.lastChecksum === null ? 'new' : 'modified';

      return {
        sourceId: source.id,
        url: source.url,
        oldChecksum: source.lastChecksum,
        newChecksum,
        detectedAt: new Date().toISOString(),
        trigger: 'scheduled',
        changeType,
      };
    } catch (error) {
      // Error fetching headers - treat as no change to avoid spurious downloads
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Error checking source for changes', {
        sourceId: source.id,
        error: message,
      });
      return null;
    }
  }

  /**
   * Check a single source safely (catches errors)
   * Returns detailed result including timing and error information
   */
  private async checkSourceSafe(source: CanonicalSource): Promise<SafeCheckResult> {
    const startTime = Date.now();
    try {
      const change = await this.checkForChange(source);
      return {
        source,
        change,
        error: null,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        source,
        change: null,
        error: error as Error,
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Check multiple sources in parallel batches
   * Respects rate limits and handles individual failures gracefully
   *
   * @param sources - Sources to check
   * @returns Array of change reports (excludes errored/unchanged sources)
   */
  async checkSourcesBatch(sources: readonly CanonicalSource[]): Promise<readonly ChangeReport[]> {
    const changes: ChangeReport[] = [];
    const errors: Array<{ source: CanonicalSource; error: Error }> = [];
    let totalChecked = 0;
    let totalChanged = 0;
    const totalSources = sources.length;

    // Process in batches
    for (let i = 0; i < sources.length; i += this.batchConfig.batchSize) {
      const batch = sources.slice(i, i + this.batchConfig.batchSize);

      // Check batch in parallel
      const batchResults = await Promise.all(
        batch.map(source => this.checkSourceSafe(source))
      );

      // Collect results
      for (const result of batchResults) {
        totalChecked++;

        if (result.error) {
          errors.push({ source: result.source, error: result.error });
          logger.warn('Failed to check source', {
            sourceId: result.source.id,
            url: result.source.url,
            error: result.error.message,
          });
        } else if (result.change) {
          changes.push(result.change);
          totalChanged++;
        }
      }

      // Progress reporting
      if (this.batchConfig.enableProgressReporting) {
        logger.info('Change detection progress', {
          checked: totalChecked,
          total: totalSources,
          changed: totalChanged,
          errors: errors.length,
        });
      }

      // Delay between batches if configured
      if (this.batchConfig.delayBetweenBatchesMs > 0 && i + this.batchConfig.batchSize < sources.length) {
        await this.sleep(this.batchConfig.delayBetweenBatchesMs);
      }
    }

    // Final summary
    if (this.batchConfig.enableProgressReporting) {
      logger.info('Change detection complete', {
        sourcesChecked: totalChecked,
        sourcesChanged: totalChanged,
        errors: errors.length,
      });
    }

    return changes;
  }

  /**
   * Check all sources that are due for verification
   * Based on update triggers (annual in July, redistricting years, etc.)
   * Uses batched parallel checking for performance
   */
  async checkScheduledSources(): Promise<readonly ChangeReport[]> {
    const sourcesDue = await this.getSourcesDueForCheck();
    return this.checkSourcesBatch(sourcesDue);
  }

  /**
   * Force check all sources regardless of schedule
   * Use sparingly (e.g., after system outage)
   * Uses batched parallel checking for performance
   */
  async checkAllSources(): Promise<readonly ChangeReport[]> {
    // Get all sources from database
    const sources = await this.getAllCanonicalSources();

    // Check in batches
    const changes = await this.checkSourcesBatch(sources);

    // Mark all changes as 'forced' trigger
    return changes.map(change => ({
      ...change,
      trigger: 'forced' as const,
    }));
  }

  /**
   * Get sources due for checking based on triggers
   */
  async getSourcesDueForCheck(): Promise<readonly CanonicalSource[]> {
    const allSources = await this.getAllCanonicalSources();
    const now = new Date();

    return allSources.filter(source => {
      // Check if any trigger applies now
      const triggerApplies = source.updateTriggers.some(trigger =>
        this.triggerAppliesNow(trigger)
      );

      // Also check if next scheduled check has passed
      const scheduledCheckPassed = new Date(source.nextScheduledCheck) <= now;

      return triggerApplies || scheduledCheckPassed;
    });
  }

  /**
   * Update checksum after successful download
   */
  async updateChecksum(sourceId: string, checksum: string): Promise<void> {
    // In the current schema, checksums are stored in the artifacts table
    // We need to update the most recent artifact for this source's municipality

    // This is a simplified implementation - in production, you'd want to:
    // 1. Find the source by ID
    // 2. Find or create artifact with new checksum
    // 3. Update heads table to point to new artifact

    // For now, we'll add a note that this needs integration with artifact management
    logger.warn('updateChecksum requires integration with artifact management', {
      sourceId,
      checksum,
    });
  }

  /**
   * Check if an update trigger applies now
   */
  private triggerAppliesNow(trigger: UpdateTrigger): boolean {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // JavaScript months are 0-indexed

    switch (trigger.type) {
      case 'annual':
        // Check if we're in the specified month
        return currentMonth === trigger.month;

      case 'redistricting':
        // Check if current year is in the redistricting years
        return trigger.years.includes(currentYear);

      case 'census':
        // Check if current year matches census year
        return currentYear === trigger.year;

      case 'manual':
        // Manual triggers always apply (require explicit invocation)
        return false;

      default:
        // TypeScript exhaustiveness check
        const _exhaustive: never = trigger;
        return false;
    }
  }

  /**
   * Parse HTTP headers for change detection
   */
  private parseChangeHeaders(headers: Headers): ChangeHeaders {
    return {
      etag: headers.get('etag'),
      lastModified: headers.get('last-modified'),
    };
  }

  /**
   * Fetch headers with retry logic
   */
  private async fetchHeadersWithRetry(url: string): Promise<ChangeHeaders> {
    let lastError: Error | null = null;
    let delayMs = this.retryConfig.initialDelayMs;

    for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
      try {
        const headers = await this.fetchHeaders(url);
        return headers;
      } catch (error) {
        lastError = error as Error;

        // Don't retry on last attempt
        if (attempt === this.retryConfig.maxAttempts) {
          break;
        }

        // Wait before retry (exponential backoff)
        await this.sleep(delayMs);
        delayMs = Math.min(
          delayMs * this.retryConfig.backoffMultiplier,
          this.retryConfig.maxDelayMs
        );
      }
    }

    throw lastError || new Error(`Failed to fetch headers after ${this.retryConfig.maxAttempts} attempts`);
  }

  /**
   * Fetch headers using HEAD request
   */
  private async fetchHeaders(url: string): Promise<ChangeHeaders> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0 (Change Detection)',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return this.parseChangeHeaders(response.headers);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get all canonical sources from database
   *
   * This is a simplified implementation that converts database sources
   * to canonical sources with default update triggers.
   *
   * In production, you'd want:
   * - A separate canonical_sources table with trigger configuration
   * - Proper source classification by boundary type
   * - Configurable update schedules per source type
   */
  private async getAllCanonicalSources(): Promise<readonly CanonicalSource[]> {
    // Get all municipalities to find their sources
    const municipalities = await this.db.listMunicipalities(10000, 0);
    const canonicalSources: CanonicalSource[] = [];

    for (const muni of municipalities) {
      // Get sources for this municipality
      const sources = await this.db.getSourcesByMuni(muni.id);

      // Get the selected source if it exists
      const selection = await this.db.getSelection(muni.id);
      const selectedSource = selection
        ? sources.find(s => s.id === selection.source_id)
        : null;

      if (!selectedSource) {
        continue;
      }

      // Get most recent artifact to find checksum
      const head = await this.db.getHead(muni.id);
      const artifact = head ? await this.db.getArtifact(head.artifact_id) : null;

      // Determine boundary type from municipality metadata
      const boundaryType = 'municipal'; // Simplified - in production, classify by source

      // Default update triggers for municipal boundaries
      const updateTriggers: UpdateTrigger[] = [
        { type: 'annual', month: 7 },                           // Check in July
        { type: 'redistricting', years: [2021, 2022, 2031, 2032] }, // Redistricting cycles
      ];

      // Calculate next scheduled check
      const nextScheduledCheck = this.calculateNextScheduledCheck(updateTriggers);

      canonicalSources.push({
        id: selectedSource.id.toString(),
        url: selectedSource.url,
        boundaryType,
        lastChecksum: artifact?.etag || artifact?.last_modified || null,
        lastChecked: artifact?.created_at || null,
        nextScheduledCheck,
        updateTriggers,
      });
    }

    return canonicalSources;
  }

  /**
   * Calculate next scheduled check based on update triggers
   */
  private calculateNextScheduledCheck(triggers: readonly UpdateTrigger[]): string {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // Find the earliest applicable trigger
    let nextCheck = new Date(currentYear + 1, 0, 1); // Default: next year

    for (const trigger of triggers) {
      switch (trigger.type) {
        case 'annual':
          // Next occurrence of the specified month
          const nextAnnual = new Date(
            currentMonth > trigger.month ? currentYear + 1 : currentYear,
            trigger.month - 1,
            1
          );
          if (nextAnnual < nextCheck) {
            nextCheck = nextAnnual;
          }
          break;

        case 'redistricting':
          // Next redistricting year
          const futureYears = trigger.years.filter(year => year > currentYear);
          if (futureYears.length > 0) {
            const nextRedistricting = new Date(futureYears[0], 0, 1);
            if (nextRedistricting < nextCheck) {
              nextCheck = nextRedistricting;
            }
          }
          break;

        case 'census':
          // Next census year
          if (trigger.year > currentYear) {
            const nextCensus = new Date(trigger.year, 0, 1);
            if (nextCensus < nextCheck) {
              nextCheck = nextCensus;
            }
          }
          break;

        case 'manual':
          // Manual triggers don't affect scheduling
          break;
      }
    }

    return nextCheck.toISOString();
  }
}
