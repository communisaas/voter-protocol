/**
 * Shadow Atlas Database Repository
 *
 * Type-safe database operations with cloud migration support.
 * Works with both SQLite (better-sqlite3) and PostgreSQL (pg).
 *
 * Design principles:
 *   1. All queries return strongly-typed results
 *   2. Branded IDs prevent entity confusion
 *   3. Transactions for atomic operations
 *   4. Prepared statements prevent SQL injection
 */

import type {
  JobId,
  JobRow,
  JobInsert,
  JobUpdate,
  JobSummaryView,
  ExtractionId,
  ExtractionRow,
  ExtractionInsert,
  ExtractionCoverageView,
  FailureId,
  FailureRow,
  FailureInsert,
  FailureUpdate,
  NotConfiguredId,
  NotConfiguredRow,
  NotConfiguredInsert,
  NotConfiguredUpdate,
  SnapshotId,
  SnapshotRow,
  SnapshotInsert,
  SnapshotRegionInsert,
  ValidationResultId,
  ValidationResultRow,
  ValidationResultInsert,
  RegistryGapView,
  ISO8601Timestamp,
  JobStatus,
  LegislativeLayerType,
} from './schema.types';

import { nowISO8601 } from './schema.types';

// ============================================================================
// Database Adapter Interface - Supports SQLite and PostgreSQL
// ============================================================================

/**
 * Unified database interface for SQLite and PostgreSQL.
 * Implementations handle driver-specific details.
 */
export interface DatabaseAdapter {
  /**
   * Execute query returning single row or null.
   */
  queryOne<T>(sql: string, params?: ReadonlyArray<unknown>): Promise<T | null>;

  /**
   * Execute query returning multiple rows.
   */
  queryMany<T>(sql: string, params?: ReadonlyArray<unknown>): Promise<ReadonlyArray<T>>;

  /**
   * Execute statement (INSERT, UPDATE, DELETE).
   * Returns number of affected rows.
   */
  execute(sql: string, params?: ReadonlyArray<unknown>): Promise<number>;

  /**
   * Execute transaction with automatic rollback on error.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;

  /**
   * Close database connection.
   */
  close(): Promise<void>;
}

// ============================================================================
// Repository Implementation
// ============================================================================

export class ShadowAtlasRepository {
  constructor(private readonly db: DatabaseAdapter) {}

  // ==========================================================================
  // Jobs - Orchestration lifecycle
  // ==========================================================================

  async createJob(insert: JobInsert): Promise<JobRow> {
    await this.db.execute(
      `INSERT INTO jobs (
        id, scope_states, scope_layers, status,
        created_at, started_at, updated_at, completed_at,
        total_tasks, completed_tasks, failed_tasks, skipped_tasks,
        error_summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        insert.id,
        insert.scope_states,
        insert.scope_layers,
        insert.status,
        insert.created_at,
        insert.started_at ?? null,
        insert.updated_at,
        insert.completed_at ?? null,
        insert.total_tasks ?? 0,
        insert.completed_tasks ?? 0,
        insert.failed_tasks ?? 0,
        insert.skipped_tasks ?? 0,
        insert.error_summary ?? null,
      ]
    );

    const row = await this.db.queryOne<JobRow>(
      'SELECT * FROM jobs WHERE id = ?',
      [insert.id]
    );

    if (!row) {
      throw new Error(`Failed to create job: ${insert.id}`);
    }

    return row;
  }

  async getJob(id: JobId): Promise<JobRow | null> {
    return this.db.queryOne<JobRow>(
      'SELECT * FROM jobs WHERE id = ? AND archived_at IS NULL',
      [id]
    );
  }

  async updateJob(id: JobId, update: JobUpdate): Promise<JobRow> {
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (update.status !== undefined) {
      setClauses.push('status = ?');
      values.push(update.status);
    }
    if (update.started_at !== undefined) {
      setClauses.push('started_at = ?');
      values.push(update.started_at);
    }
    setClauses.push('updated_at = ?');
    values.push(update.updated_at);
    if (update.completed_at !== undefined) {
      setClauses.push('completed_at = ?');
      values.push(update.completed_at);
    }
    if (update.total_tasks !== undefined) {
      setClauses.push('total_tasks = ?');
      values.push(update.total_tasks);
    }
    if (update.completed_tasks !== undefined) {
      setClauses.push('completed_tasks = ?');
      values.push(update.completed_tasks);
    }
    if (update.failed_tasks !== undefined) {
      setClauses.push('failed_tasks = ?');
      values.push(update.failed_tasks);
    }
    if (update.skipped_tasks !== undefined) {
      setClauses.push('skipped_tasks = ?');
      values.push(update.skipped_tasks);
    }
    if (update.error_summary !== undefined) {
      setClauses.push('error_summary = ?');
      values.push(update.error_summary);
    }
    if (update.archived_at !== undefined) {
      setClauses.push('archived_at = ?');
      values.push(update.archived_at);
    }

    values.push(id);

    await this.db.execute(
      `UPDATE jobs SET ${setClauses.join(', ')} WHERE id = ?`,
      values
    );

    const row = await this.db.queryOne<JobRow>(
      'SELECT * FROM jobs WHERE id = ?',
      [id]
    );

    if (!row) {
      throw new Error(`Job not found: ${id}`);
    }

    return row;
  }

  async listJobsByStatus(
    status: JobStatus,
    limit: number = 100
  ): Promise<ReadonlyArray<JobRow>> {
    return this.db.queryMany<JobRow>(
      `SELECT * FROM jobs
       WHERE status = ? AND archived_at IS NULL
       ORDER BY created_at DESC
       LIMIT ?`,
      [status, limit]
    );
  }

  async getJobSummary(id: JobId): Promise<JobSummaryView | null> {
    return this.db.queryOne<JobSummaryView>(
      'SELECT * FROM v_job_summary WHERE id = ?',
      [id]
    );
  }

  async archiveJob(id: JobId): Promise<void> {
    await this.updateJob(id, {
      updated_at: nowISO8601(),
      archived_at: nowISO8601(),
    });
  }

  // ==========================================================================
  // Extractions - Successful boundary retrievals
  // ==========================================================================

  async createExtraction(insert: ExtractionInsert): Promise<ExtractionRow> {
    await this.db.execute(
      `INSERT INTO extractions (
        id, job_id, state_code, layer_type,
        boundary_count, validation_passed,
        source_url, source_type, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        insert.id,
        insert.job_id,
        insert.state_code,
        insert.layer_type,
        insert.boundary_count,
        insert.validation_passed,
        insert.source_url ?? null,
        insert.source_type ?? null,
        insert.completed_at,
      ]
    );

    const row = await this.db.queryOne<ExtractionRow>(
      'SELECT * FROM extractions WHERE id = ?',
      [insert.id]
    );

    if (!row) {
      throw new Error(`Failed to create extraction: ${insert.id}`);
    }

    return row;
  }

  async getExtraction(id: ExtractionId): Promise<ExtractionRow | null> {
    return this.db.queryOne<ExtractionRow>(
      'SELECT * FROM extractions WHERE id = ? AND archived_at IS NULL',
      [id]
    );
  }

  async listExtractionsByJob(
    jobId: JobId
  ): Promise<ReadonlyArray<ExtractionRow>> {
    return this.db.queryMany<ExtractionRow>(
      `SELECT * FROM extractions
       WHERE job_id = ? AND archived_at IS NULL
       ORDER BY completed_at DESC`,
      [jobId]
    );
  }

  async getExtractionCoverage(): Promise<ReadonlyArray<ExtractionCoverageView>> {
    return this.db.queryMany<ExtractionCoverageView>(
      'SELECT * FROM v_extraction_coverage ORDER BY state_code, layer_type'
    );
  }

  // ==========================================================================
  // Failures - Failed extraction attempts
  // ==========================================================================

  async createFailure(insert: FailureInsert): Promise<FailureRow> {
    await this.db.execute(
      `INSERT INTO failures (
        id, job_id, state_code, layer_type,
        error_message, error_stack, attempt_count, retryable,
        source_url, source_type, failed_at, retry_after
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        insert.id,
        insert.job_id,
        insert.state_code,
        insert.layer_type,
        insert.error_message,
        insert.error_stack ?? null,
        insert.attempt_count ?? 1,
        insert.retryable,
        insert.source_url ?? null,
        insert.source_type ?? null,
        insert.failed_at,
        insert.retry_after ?? null,
      ]
    );

    const row = await this.db.queryOne<FailureRow>(
      'SELECT * FROM failures WHERE id = ?',
      [insert.id]
    );

    if (!row) {
      throw new Error(`Failed to create failure record: ${insert.id}`);
    }

    return row;
  }

  async getFailure(id: FailureId): Promise<FailureRow | null> {
    return this.db.queryOne<FailureRow>(
      'SELECT * FROM failures WHERE id = ? AND archived_at IS NULL',
      [id]
    );
  }

  async updateFailure(id: FailureId, update: FailureUpdate): Promise<FailureRow> {
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (update.retried_at !== undefined) {
      setClauses.push('retried_at = ?');
      values.push(update.retried_at);
    }
    if (update.retry_succeeded !== undefined) {
      setClauses.push('retry_succeeded = ?');
      values.push(update.retry_succeeded);
    }
    if (update.archived_at !== undefined) {
      setClauses.push('archived_at = ?');
      values.push(update.archived_at);
    }

    if (setClauses.length === 0) {
      throw new Error('No fields to update');
    }

    values.push(id);

    await this.db.execute(
      `UPDATE failures SET ${setClauses.join(', ')} WHERE id = ?`,
      values
    );

    const row = await this.db.queryOne<FailureRow>(
      'SELECT * FROM failures WHERE id = ?',
      [id]
    );

    if (!row) {
      throw new Error(`Failure not found: ${id}`);
    }

    return row;
  }

  async listRetryableFailures(
    jobId: JobId
  ): Promise<ReadonlyArray<FailureRow>> {
    return this.db.queryMany<FailureRow>(
      `SELECT * FROM failures
       WHERE job_id = ?
         AND retryable = TRUE
         AND retried_at IS NULL
         AND archived_at IS NULL
       ORDER BY failed_at ASC`,
      [jobId]
    );
  }

  // ==========================================================================
  // NotConfigured - Registry gaps
  // ==========================================================================

  async createNotConfigured(
    insert: NotConfiguredInsert
  ): Promise<NotConfiguredRow> {
    await this.db.execute(
      `INSERT INTO not_configured (
        id, job_id, state_code, layer_type, reason, checked_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        insert.id,
        insert.job_id,
        insert.state_code,
        insert.layer_type,
        insert.reason,
        insert.checked_at,
      ]
    );

    const row = await this.db.queryOne<NotConfiguredRow>(
      'SELECT * FROM not_configured WHERE id = ?',
      [insert.id]
    );

    if (!row) {
      throw new Error(`Failed to create not_configured record: ${insert.id}`);
    }

    return row;
  }

  async updateNotConfigured(
    id: NotConfiguredId,
    update: NotConfiguredUpdate
  ): Promise<NotConfiguredRow> {
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (update.resolved_at !== undefined) {
      setClauses.push('resolved_at = ?');
      values.push(update.resolved_at);
    }
    if (update.resolved_by_job_id !== undefined) {
      setClauses.push('resolved_by_job_id = ?');
      values.push(update.resolved_by_job_id);
    }
    if (update.archived_at !== undefined) {
      setClauses.push('archived_at = ?');
      values.push(update.archived_at);
    }

    if (setClauses.length === 0) {
      throw new Error('No fields to update');
    }

    values.push(id);

    await this.db.execute(
      `UPDATE not_configured SET ${setClauses.join(', ')} WHERE id = ?`,
      values
    );

    const row = await this.db.queryOne<NotConfiguredRow>(
      'SELECT * FROM not_configured WHERE id = ?',
      [id]
    );

    if (!row) {
      throw new Error(`NotConfigured not found: ${id}`);
    }

    return row;
  }

  async getRegistryGaps(): Promise<ReadonlyArray<RegistryGapView>> {
    return this.db.queryMany<RegistryGapView>(
      'SELECT * FROM v_registry_gaps ORDER BY occurrence_count DESC'
    );
  }

  // ==========================================================================
  // Snapshots - Merkle tree commits
  // ==========================================================================

  async createSnapshot(
    snapshotInsert: SnapshotInsert,
    regions: ReadonlyArray<string>
  ): Promise<SnapshotRow> {
    await this.db.transaction(async () => {
      // Insert snapshot
      await this.db.execute(
        `INSERT INTO snapshots (
          id, job_id, merkle_root, ipfs_cid,
          boundary_count, regions, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshotInsert.id,
          snapshotInsert.job_id,
          snapshotInsert.merkle_root,
          snapshotInsert.ipfs_cid,
          snapshotInsert.boundary_count,
          snapshotInsert.regions,
          snapshotInsert.created_at,
        ]
      );

      // Insert region associations
      for (const stateCode of regions) {
        await this.db.execute(
          'INSERT INTO snapshot_regions (snapshot_id, state_code) VALUES (?, ?)',
          [snapshotInsert.id, stateCode]
        );
      }
    });

    const row = await this.db.queryOne<SnapshotRow>(
      'SELECT * FROM snapshots WHERE id = ?',
      [snapshotInsert.id]
    );

    if (!row) {
      throw new Error(`Failed to create snapshot: ${snapshotInsert.id}`);
    }

    return row;
  }

  async getSnapshot(id: SnapshotId): Promise<SnapshotRow | null> {
    return this.db.queryOne<SnapshotRow>(
      'SELECT * FROM snapshots WHERE id = ? AND archived_at IS NULL',
      [id]
    );
  }

  async getSnapshotByMerkleRoot(
    merkleRoot: string
  ): Promise<SnapshotRow | null> {
    return this.db.queryOne<SnapshotRow>(
      'SELECT * FROM snapshots WHERE merkle_root = ? AND archived_at IS NULL',
      [merkleRoot]
    );
  }

  async getLatestSnapshotForState(
    stateCode: string
  ): Promise<SnapshotRow | null> {
    return this.db.queryOne<SnapshotRow>(
      `SELECT s.*
       FROM snapshots s
       JOIN snapshot_regions sr ON sr.snapshot_id = s.id
       WHERE sr.state_code = ?
         AND s.archived_at IS NULL
         AND s.deprecated_at IS NULL
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [stateCode]
    );
  }

  async deprecateSnapshot(id: SnapshotId): Promise<void> {
    await this.db.execute(
      'UPDATE snapshots SET deprecated_at = ? WHERE id = ?',
      [nowISO8601(), id]
    );
  }

  // ==========================================================================
  // Validation Results - Cross-validation tracking
  // ==========================================================================

  async createValidationResult(
    insert: ValidationResultInsert
  ): Promise<ValidationResultRow> {
    await this.db.execute(
      `INSERT INTO validation_results (
        id, extraction_id, validator_type, passed,
        expected_count, actual_count, discrepancies,
        authority_source, authority_version, validated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        insert.id,
        insert.extraction_id,
        insert.validator_type,
        insert.passed,
        insert.expected_count ?? null,
        insert.actual_count ?? null,
        insert.discrepancies ?? null,
        insert.authority_source ?? null,
        insert.authority_version ?? null,
        insert.validated_at,
      ]
    );

    const row = await this.db.queryOne<ValidationResultRow>(
      'SELECT * FROM validation_results WHERE id = ?',
      [insert.id]
    );

    if (!row) {
      throw new Error(`Failed to create validation result: ${insert.id}`);
    }

    return row;
  }

  async listValidationResultsByExtraction(
    extractionId: ExtractionId
  ): Promise<ReadonlyArray<ValidationResultRow>> {
    return this.db.queryMany<ValidationResultRow>(
      `SELECT * FROM validation_results
       WHERE extraction_id = ? AND archived_at IS NULL
       ORDER BY validated_at DESC`,
      [extractionId]
    );
  }

  // ==========================================================================
  // Atomic Operations - Multi-step transactions
  // ==========================================================================

  /**
   * Atomically create extraction with validation results.
   */
  async createValidatedExtraction(
    extraction: ExtractionInsert,
    validations: ReadonlyArray<ValidationResultInsert>
  ): Promise<{ extraction: ExtractionRow; validations: ReadonlyArray<ValidationResultRow> }> {
    return this.db.transaction(async () => {
      const extractionRow = await this.createExtraction(extraction);
      const validationRows = await Promise.all(
        validations.map((v) => this.createValidationResult(v))
      );

      return {
        extraction: extractionRow,
        validations: validationRows,
      };
    });
  }

  /**
   * Atomically update job progress counters.
   */
  async incrementJobProgress(
    jobId: JobId,
    field: 'completed_tasks' | 'failed_tasks' | 'skipped_tasks'
  ): Promise<JobRow> {
    return this.db.transaction(async () => {
      const current = await this.getJob(jobId);
      if (!current) {
        throw new Error(`Job not found: ${jobId}`);
      }

      const update: JobUpdate = {
        updated_at: nowISO8601(),
        [field]: current[field] + 1,
      };

      return this.updateJob(jobId, update);
    });
  }
}
