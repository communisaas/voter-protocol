/**
 * Download Dead Letter Queue (DLQ)
 *
 * Persistent queue for failed TIGER downloads with retry management.
 * Enables recovery from transient network failures without data loss.
 *
 * DESIGN PRINCIPLES:
 * - Persist failures immediately (no silent drops)
 * - Exponential backoff for retries
 * - Circuit breaker integration
 * - Resume-friendly (process restart safe)
 *
 * CRITICAL TYPE SAFETY: DLQ state must be strictly typed.
 * Wrong types can:
 * - Lose track of failed downloads (data loss)
 * - Retry exhausted downloads (waste bandwidth)
 * - Miss retry windows (stale data)
 */

import type { Database } from 'better-sqlite3';
import type { TIGERLayer } from '../providers/tiger-boundary-provider.js';
import { createHash } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * Failed download record
 */
export interface FailedDownload {
  /** Unique identifier */
  readonly id: string;

  /** Optional job ID if part of batch ingestion */
  readonly jobId?: string;

  /** Download URL that failed */
  readonly url: string;

  /** TIGER layer type */
  readonly layer: TIGERLayer;

  /** State FIPS code (if state-level download) */
  readonly stateFips?: string;

  /** TIGER data year */
  readonly year: number;

  /** Current attempt count */
  readonly attemptCount: number;

  /** Maximum retry attempts allowed */
  readonly maxAttempts: number;

  /** Last error message */
  readonly lastError: string;

  /** Timestamp of last attempt (ISO 8601) */
  readonly lastAttemptAt: string;

  /** Timestamp for next retry (ISO 8601) */
  readonly nextRetryAt?: string;

  /** Current status */
  readonly status: 'pending' | 'retrying' | 'exhausted' | 'resolved';

  /** Creation timestamp (ISO 8601) */
  readonly createdAt: string;

  /** Resolution timestamp (ISO 8601) */
  readonly resolvedAt?: string;
}

/**
 * DLQ statistics summary
 */
export interface DLQStats {
  /** Total failed downloads in DLQ */
  readonly total: number;

  /** Pending retries */
  readonly pending: number;

  /** Currently retrying */
  readonly retrying: number;

  /** Exhausted (max retries reached) */
  readonly exhausted: number;

  /** Resolved (successfully recovered) */
  readonly resolved: number;

  /** Breakdown by layer */
  readonly byLayer: Record<string, number>;
}

/**
 * Options for persisting a failed download
 */
export interface PersistFailureOptions {
  /** Optional job ID if part of batch ingestion */
  readonly jobId?: string;

  /** Download URL that failed */
  readonly url: string;

  /** TIGER layer type */
  readonly layer: TIGERLayer;

  /** State FIPS code (if state-level download) */
  readonly stateFips?: string;

  /** TIGER data year */
  readonly year: number;

  /** Error message */
  readonly error: string;

  /** Maximum retry attempts (default: 3) */
  readonly maxAttempts?: number;

  /** Initial retry delay in milliseconds (default: 1000) */
  readonly retryDelayMs?: number;

  /** Retry delay backoff multiplier (default: 2) */
  readonly retryBackoffMultiplier?: number;
}

// ============================================================================
// Download Dead Letter Queue
// ============================================================================

/**
 * Download Dead Letter Queue
 *
 * Manages failed download persistence and retry orchestration.
 *
 * @example
 * ```typescript
 * const dlq = new DownloadDLQ(db);
 *
 * // Persist a failed download
 * const id = await dlq.persistFailure({
 *   url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_06_cd119.zip',
 *   layer: 'cd',
 *   stateFips: '06',
 *   year: 2024,
 *   error: 'ETIMEDOUT',
 * });
 *
 * // Get retryable downloads
 * const retryable = await dlq.getRetryableDownloads(10);
 *
 * // Process retries
 * for (const download of retryable) {
 *   await dlq.markRetrying(download.id);
 *   try {
 *     await retryDownload(download);
 *     await dlq.markResolved(download.id);
 *   } catch (error) {
 *     await dlq.incrementAttempt(download.id, error.message);
 *   }
 * }
 * ```
 */
export class DownloadDLQ {
  constructor(private readonly db: Database) {}

  /**
   * Persist a failed download to DLQ
   *
   * ALGORITHM:
   * 1. Check if download already in DLQ (idempotent upsert)
   * 2. Calculate next retry time with exponential backoff
   * 3. Insert or update record with retry metadata
   *
   * @param options - Failure context and retry configuration
   * @returns DLQ record ID
   */
  async persistFailure(options: PersistFailureOptions): Promise<string> {
    const now = new Date().toISOString();
    const maxAttempts = options.maxAttempts ?? 3;
    const retryDelayMs = options.retryDelayMs ?? 1000;
    const retryBackoffMultiplier = options.retryBackoffMultiplier ?? 2;

    // Generate unique ID based on URL + layer + state + year
    const id = this.generateId(options.url, options.layer, options.stateFips, options.year);

    // Check if already exists
    const existing = this.db.prepare(`
      SELECT id, attempt_count
      FROM failed_downloads
      WHERE id = ? AND archived_at IS NULL
    `).get(id) as { id: string; attempt_count: number } | undefined;

    if (existing) {
      // Update existing record
      const attemptCount = existing.attempt_count + 1;
      const nextRetryAt = this.calculateNextRetry(attemptCount, retryDelayMs, retryBackoffMultiplier);
      const status = attemptCount >= maxAttempts ? 'exhausted' : 'pending';

      this.db.prepare(`
        UPDATE failed_downloads
        SET
          attempt_count = ?,
          last_error = ?,
          last_attempt_at = ?,
          next_retry_at = ?,
          status = ?
        WHERE id = ?
      `).run(attemptCount, options.error, now, nextRetryAt, status, id);
    } else {
      // Insert new record
      const nextRetryAt = this.calculateNextRetry(1, retryDelayMs, retryBackoffMultiplier);

      this.db.prepare(`
        INSERT INTO failed_downloads (
          id, job_id, url, layer, state_fips, year,
          attempt_count, max_attempts, last_error, last_attempt_at, next_retry_at,
          status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        options.jobId ?? null,
        options.url,
        options.layer,
        options.stateFips ?? null,
        options.year,
        1,
        maxAttempts,
        options.error,
        now,
        nextRetryAt,
        'pending',
        now
      );
    }

    return id;
  }

  /**
   * Get retryable downloads (ready for retry now)
   *
   * Returns downloads with:
   * - Status: pending or retrying
   * - Next retry time: NULL or past
   *
   * @param limit - Maximum number of downloads to return (default: 50)
   * @returns Array of failed downloads ready for retry
   */
  async getRetryableDownloads(limit = 50): Promise<FailedDownload[]> {
    const now = new Date().toISOString();

    const rows = this.db.prepare(`
      SELECT
        id, job_id, url, layer, state_fips, year,
        attempt_count, max_attempts, last_error, last_attempt_at, next_retry_at,
        status, created_at, resolved_at
      FROM failed_downloads
      WHERE archived_at IS NULL
        AND status IN ('pending', 'retrying')
        AND (next_retry_at IS NULL OR next_retry_at <= ?)
      ORDER BY last_attempt_at ASC
      LIMIT ?
    `).all(now, limit) as Array<{
      id: string;
      job_id: string | null;
      url: string;
      layer: TIGERLayer;
      state_fips: string | null;
      year: number;
      attempt_count: number;
      max_attempts: number;
      last_error: string;
      last_attempt_at: string;
      next_retry_at: string | null;
      status: string;
      created_at: string;
      resolved_at: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      jobId: row.job_id ?? undefined,
      url: row.url,
      layer: row.layer,
      stateFips: row.state_fips ?? undefined,
      year: row.year,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      lastError: row.last_error,
      lastAttemptAt: row.last_attempt_at,
      nextRetryAt: row.next_retry_at ?? undefined,
      status: row.status as 'pending' | 'retrying' | 'exhausted' | 'resolved',
      createdAt: row.created_at,
      resolvedAt: row.resolved_at ?? undefined,
    }));
  }

  /**
   * Mark download as currently retrying
   *
   * @param id - DLQ record ID
   */
  async markRetrying(id: string): Promise<void> {
    this.db.prepare(`
      UPDATE failed_downloads
      SET status = 'retrying'
      WHERE id = ? AND archived_at IS NULL
    `).run(id);
  }

  /**
   * Mark download as resolved (successful retry)
   *
   * @param id - DLQ record ID
   */
  async markResolved(id: string): Promise<void> {
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE failed_downloads
      SET status = 'resolved', resolved_at = ?
      WHERE id = ? AND archived_at IS NULL
    `).run(now, id);
  }

  /**
   * Mark download as exhausted (max retries reached)
   *
   * @param id - DLQ record ID
   */
  async markExhausted(id: string): Promise<void> {
    this.db.prepare(`
      UPDATE failed_downloads
      SET status = 'exhausted'
      WHERE id = ? AND archived_at IS NULL
    `).run(id);
  }

  /**
   * Increment attempt count after failed retry
   *
   * Automatically marks as exhausted if max attempts reached.
   *
   * @param id - DLQ record ID
   * @param error - Error message from retry attempt
   */
  async incrementAttempt(id: string, error: string): Promise<void> {
    const now = new Date().toISOString();

    // Get current record
    const record = this.db.prepare(`
      SELECT attempt_count, max_attempts
      FROM failed_downloads
      WHERE id = ? AND archived_at IS NULL
    `).get(id) as { attempt_count: number; max_attempts: number } | undefined;

    if (!record) {
      throw new Error(`DLQ record ${id} not found`);
    }

    const attemptCount = record.attempt_count + 1;
    const status = attemptCount >= record.max_attempts ? 'exhausted' : 'pending';

    // Calculate next retry time (if not exhausted)
    const nextRetryAt = status === 'exhausted'
      ? null
      : this.calculateNextRetry(attemptCount, 1000, 2);

    this.db.prepare(`
      UPDATE failed_downloads
      SET
        attempt_count = ?,
        last_error = ?,
        last_attempt_at = ?,
        next_retry_at = ?,
        status = ?
      WHERE id = ?
    `).run(attemptCount, error, now, nextRetryAt, status, id);
  }

  /**
   * Get DLQ statistics
   *
   * @returns Summary statistics for failed downloads
   */
  async getFailureStats(): Promise<DLQStats> {
    // Total counts by status
    const statusCounts = this.db.prepare(`
      SELECT
        status,
        COUNT(*) as count
      FROM failed_downloads
      WHERE archived_at IS NULL
      GROUP BY status
    `).all() as Array<{ status: string; count: number }>;

    // Counts by layer
    const layerCounts = this.db.prepare(`
      SELECT
        layer,
        COUNT(*) as count
      FROM failed_downloads
      WHERE archived_at IS NULL
        AND status != 'resolved'
      GROUP BY layer
    `).all() as Array<{ layer: string; count: number }>;

    // Build status map
    const statusMap: Record<string, number> = {};
    for (const row of statusCounts) {
      statusMap[row.status] = row.count;
    }

    // Build layer map
    const byLayer: Record<string, number> = {};
    for (const row of layerCounts) {
      byLayer[row.layer] = row.count;
    }

    const total = statusCounts.reduce((sum, row) => sum + row.count, 0);

    return {
      total,
      pending: statusMap.pending ?? 0,
      retrying: statusMap.retrying ?? 0,
      exhausted: statusMap.exhausted ?? 0,
      resolved: statusMap.resolved ?? 0,
      byLayer,
    };
  }

  /**
   * Get all failed downloads for a job
   *
   * @param jobId - Job ID
   * @returns Array of failed downloads for job
   */
  async getFailuresForJob(jobId: string): Promise<FailedDownload[]> {
    const rows = this.db.prepare(`
      SELECT
        id, job_id, url, layer, state_fips, year,
        attempt_count, max_attempts, last_error, last_attempt_at, next_retry_at,
        status, created_at, resolved_at
      FROM failed_downloads
      WHERE job_id = ? AND archived_at IS NULL
      ORDER BY last_attempt_at DESC
    `).all(jobId) as Array<{
      id: string;
      job_id: string | null;
      url: string;
      layer: TIGERLayer;
      state_fips: string | null;
      year: number;
      attempt_count: number;
      max_attempts: number;
      last_error: string;
      last_attempt_at: string;
      next_retry_at: string | null;
      status: string;
      created_at: string;
      resolved_at: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      jobId: row.job_id ?? undefined,
      url: row.url,
      layer: row.layer,
      stateFips: row.state_fips ?? undefined,
      year: row.year,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      lastError: row.last_error,
      lastAttemptAt: row.last_attempt_at,
      nextRetryAt: row.next_retry_at ?? undefined,
      status: row.status as 'pending' | 'retrying' | 'exhausted' | 'resolved',
      createdAt: row.created_at,
      resolvedAt: row.resolved_at ?? undefined,
    }));
  }

  // ========================================================================
  // Private Methods
  // ========================================================================

  /**
   * Generate deterministic ID from download parameters
   *
   * Uses SHA-256 hash to ensure idempotent upserts (same download = same ID).
   * Prevents collisions from truncated base64 encoding.
   */
  private generateId(url: string, layer: TIGERLayer, stateFips: string | undefined, year: number): string {
    const key = `${url}:${layer}:${stateFips ?? 'national'}:${year}`;
    const hash = createHash('sha256').update(key).digest('hex');
    return `dlq_${hash.slice(0, 32)}`;
  }

  /**
   * Calculate next retry time with exponential backoff
   *
   * @param attemptCount - Current attempt number
   * @param baseDelayMs - Initial retry delay
   * @param backoffMultiplier - Exponential backoff multiplier
   * @returns ISO 8601 timestamp for next retry
   */
  private calculateNextRetry(
    attemptCount: number,
    baseDelayMs: number,
    backoffMultiplier: number
  ): string {
    const delayMs = baseDelayMs * Math.pow(backoffMultiplier, attemptCount - 1);
    const nextRetry = new Date(Date.now() + delayMs);
    return nextRetry.toISOString();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a Download DLQ with database connection
 *
 * @param db - better-sqlite3 database instance
 * @returns Configured DLQ instance
 *
 * @example
 * ```typescript
 * import Database from 'better-sqlite3';
 * import { createDownloadDLQ } from './acquisition/download-dlq.js';
 *
 * const db = new Database('./shadow-atlas.db');
 * const dlq = createDownloadDLQ(db);
 * ```
 */
export function createDownloadDLQ(db: Database): DownloadDLQ {
  return new DownloadDLQ(db);
}
