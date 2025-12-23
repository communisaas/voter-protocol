/**
 * SQLite Persistence Adapter for Shadow Atlas
 *
 * CRITICAL TYPE SAFETY: This adapter replaces filesystem-based JobStateStore with
 * proper relational persistence. Type errors here corrupt extraction history and
 * Merkle tree provenance.
 *
 * ARCHITECTURE:
 * - Synchronous better-sqlite3 for high-performance local operations
 * - Transaction guarantees for multi-step operations
 * - WAL mode for concurrent reads during extraction
 * - Full API compatibility with existing JobStateStore
 *
 * NUCLEAR-LEVEL TYPE STRICTNESS: No `any`, no loose casts, no exceptions.
 */

import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import type {
  JobState,
  JobStatus,
  JobScope,
  JobSummary,
  OrchestrationOptions,
  CompletedExtraction,
  ExtractionFailure,
  NotConfiguredTask,
  ProgressUpdateData,
} from '../services/batch-orchestrator.types.js';
import type { SnapshotMetadata } from '../core/types.js';
import type { LegislativeLayerType } from '../registry/state-gis-portals.js';

// ============================================================================
// Public Types
// ============================================================================

/**
 * Validation result stored per boundary
 */
export interface ValidationResult {
  readonly boundaryId: string;
  readonly geometryValid: boolean;
  readonly geoidValid: boolean;
  readonly confidence: number;
  readonly warnings: readonly string[];
  readonly validatedAt: Date;
}

/**
 * Coverage statistics aggregate
 */
export interface CoverageStatistics {
  readonly totalStates: number;
  readonly coveredStates: number;
  readonly totalBoundaries: number;
  readonly byLayer: Record<LegislativeLayerType, {
    readonly states: number;
    readonly boundaries: number;
  }>;
  readonly mostRecentExtraction: Date | null;
  readonly oldestExtraction: Date | null;
}

/**
 * Migration definition
 */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: (db: Database.Database) => void;
}

// ============================================================================
// Database Row Types (internal)
// ============================================================================

interface JobRow {
  readonly job_id: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly status: JobStatus;
  readonly total_tasks: number;
  readonly completed_tasks: number;
  readonly failed_tasks: number;
  readonly current_task: string | null;
  readonly options_json: string;
}

interface JobScopeRow {
  readonly job_id: string;
  readonly state: string;
  readonly layer: LegislativeLayerType;
}

interface ExtractionRow {
  readonly id: number;
  readonly job_id: string;
  readonly state: string;
  readonly layer: LegislativeLayerType;
  readonly completed_at: string;
  readonly boundary_count: number;
  readonly validation_passed: number;
}

interface FailureRow {
  readonly id: number;
  readonly job_id: string;
  readonly state: string;
  readonly layer: LegislativeLayerType;
  readonly failed_at: string;
  readonly error: string;
  readonly attempt_count: number;
  readonly retryable: number;
}

interface NotConfiguredRow {
  readonly id: number;
  readonly job_id: string;
  readonly state: string;
  readonly layer: LegislativeLayerType;
  readonly reason: 'state_not_in_registry' | 'layer_not_configured';
  readonly checked_at: string;
}

interface SnapshotRow {
  readonly id: string;
  readonly merkle_root: string;
  readonly ipfs_cid: string;
  readonly boundary_count: number;
  readonly created_at: string;
  readonly regions_json: string;
}

interface ValidationResultRow {
  readonly id: number;
  readonly snapshot_id: string;
  readonly boundary_id: string;
  readonly geometry_valid: number;
  readonly geoid_valid: number;
  readonly confidence: number;
  readonly warnings_json: string;
  readonly validated_at: string;
}

// ============================================================================
// SQLite Persistence Adapter
// ============================================================================

/**
 * SQLite Persistence Adapter
 *
 * Replaces filesystem-based JobStateStore with proper relational persistence.
 * Maintains full API compatibility while adding snapshot and validation storage.
 */
export class SqlitePersistenceAdapter {
  private db: Database.Database;

  constructor(dbPath: string = '.shadow-atlas/shadow-atlas.db') {
    this.db = new Database(dbPath);

    // Enable WAL mode for concurrent reads
    this.db.pragma('journal_mode = WAL');

    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');

    // Optimize for fast writes
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('temp_store = MEMORY');
  }

  // ============================================================================
  // Migration Management
  // ============================================================================

  /**
   * Run all pending migrations
   *
   * Ensures database schema is up-to-date with latest version.
   */
  async runMigrations(): Promise<void> {
    // Create migrations table if not exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);

    const currentVersion = await this.getDatabaseVersion();
    const migrations = this.getMigrations();

    // Run pending migrations in transaction
    const runMigrations = this.db.transaction(() => {
      for (const migration of migrations) {
        if (migration.version > currentVersion) {
          migration.up(this.db);

          // Record migration
          this.db.prepare(`
            INSERT INTO schema_migrations (version, name)
            VALUES (?, ?)
          `).run(migration.version, migration.name);
        }
      }
    });

    runMigrations();
  }

  /**
   * Get current database version
   *
   * @returns Current schema version (0 if no migrations applied)
   */
  async getDatabaseVersion(): Promise<number> {
    try {
      const row = this.db.prepare(`
        SELECT MAX(version) as version FROM schema_migrations
      `).get() as { version: number | null } | undefined;

      return row?.version ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get all migrations in order
   */
  private getMigrations(): readonly Migration[] {
    return [
      {
        version: 1,
        name: 'initial_schema',
        up: (db) => {
          db.exec(`
            -- Jobs table
            CREATE TABLE jobs (
              job_id TEXT PRIMARY KEY,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'partial', 'completed', 'failed', 'cancelled')),
              total_tasks INTEGER NOT NULL,
              completed_tasks INTEGER NOT NULL DEFAULT 0,
              failed_tasks INTEGER NOT NULL DEFAULT 0,
              current_task TEXT,
              options_json TEXT NOT NULL
            );

            -- Job scopes (states and layers)
            CREATE TABLE job_scopes (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
              state TEXT NOT NULL,
              layer TEXT NOT NULL CHECK (layer IN ('congressional', 'state_senate', 'state_house'))
            );

            -- Successful extractions
            CREATE TABLE extractions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
              state TEXT NOT NULL,
              layer TEXT NOT NULL,
              completed_at TEXT NOT NULL,
              boundary_count INTEGER NOT NULL,
              validation_passed INTEGER NOT NULL CHECK (validation_passed IN (0, 1))
            );

            -- Failed extractions
            CREATE TABLE failures (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
              state TEXT NOT NULL,
              layer TEXT NOT NULL,
              failed_at TEXT NOT NULL,
              error TEXT NOT NULL,
              attempt_count INTEGER NOT NULL,
              retryable INTEGER NOT NULL CHECK (retryable IN (0, 1))
            );

            -- Not configured tasks
            CREATE TABLE not_configured (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
              state TEXT NOT NULL,
              layer TEXT NOT NULL,
              reason TEXT NOT NULL CHECK (reason IN ('state_not_in_registry', 'layer_not_configured')),
              checked_at TEXT NOT NULL
            );

            -- Snapshots (committed Merkle trees)
            CREATE TABLE snapshots (
              id TEXT PRIMARY KEY,
              merkle_root TEXT NOT NULL UNIQUE,
              ipfs_cid TEXT NOT NULL,
              boundary_count INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              regions_json TEXT NOT NULL
            );

            -- Validation results
            CREATE TABLE validation_results (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              snapshot_id TEXT NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
              boundary_id TEXT NOT NULL,
              geometry_valid INTEGER NOT NULL CHECK (geometry_valid IN (0, 1)),
              geoid_valid INTEGER NOT NULL CHECK (geoid_valid IN (0, 1)),
              confidence REAL NOT NULL,
              warnings_json TEXT NOT NULL,
              validated_at TEXT NOT NULL
            );

            -- Indexes for common queries
            CREATE INDEX idx_jobs_status ON jobs(status);
            CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);
            CREATE INDEX idx_extractions_state_layer ON extractions(state, layer);
            CREATE INDEX idx_snapshots_merkle_root ON snapshots(merkle_root);
            CREATE INDEX idx_validation_results_snapshot ON validation_results(snapshot_id);
          `);
        },
      },
    ];
  }

  // ============================================================================
  // Job Lifecycle (JobStateStore API)
  // ============================================================================

  /**
   * Create a new job
   *
   * @param scope - What to extract (states and layers)
   * @param options - Orchestration options
   * @returns Job ID
   */
  async createJob(
    scope: JobScope,
    options: OrchestrationOptions
  ): Promise<string> {
    const jobId = this.generateJobId();
    const now = new Date().toISOString();
    const totalTasks = scope.states.length * scope.layers.length;

    const createJobTx = this.db.transaction(() => {
      // Insert job
      this.db.prepare(`
        INSERT INTO jobs (
          job_id, created_at, updated_at, status,
          total_tasks, completed_tasks, failed_tasks, options_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        jobId,
        now,
        now,
        'pending',
        totalTasks,
        0,
        0,
        JSON.stringify(options)
      );

      // Insert scope
      const scopeStmt = this.db.prepare(`
        INSERT INTO job_scopes (job_id, state, layer)
        VALUES (?, ?, ?)
      `);

      for (const state of scope.states) {
        for (const layer of scope.layers) {
          scopeStmt.run(jobId, state, layer);
        }
      }
    });

    createJobTx();
    return jobId;
  }

  /**
   * Get job state
   *
   * @param jobId - Job ID
   * @returns Job state or null if not found
   */
  async getJob(jobId: string): Promise<JobState | null> {
    // Get job
    const jobRow = this.db.prepare(`
      SELECT * FROM jobs WHERE job_id = ?
    `).get(jobId) as JobRow | undefined;

    if (!jobRow) {
      return null;
    }

    // Get scope
    const scopeRows = this.db.prepare(`
      SELECT DISTINCT state FROM job_scopes WHERE job_id = ?
    `).all(jobId) as Array<{ state: string }>;

    const layerRows = this.db.prepare(`
      SELECT DISTINCT layer FROM job_scopes WHERE job_id = ?
    `).all(jobId) as Array<{ layer: LegislativeLayerType }>;

    const scope: JobScope = {
      states: scopeRows.map(r => r.state),
      layers: layerRows.map(r => r.layer),
    };

    // Get extractions
    const extractionRows = this.db.prepare(`
      SELECT * FROM extractions WHERE job_id = ? ORDER BY completed_at DESC
    `).all(jobId) as ExtractionRow[];

    const completedExtractions: CompletedExtraction[] = extractionRows.map(row => ({
      state: row.state,
      layer: row.layer,
      completedAt: new Date(row.completed_at),
      boundaryCount: row.boundary_count,
      validationPassed: Boolean(row.validation_passed),
    }));

    // Get failures
    const failureRows = this.db.prepare(`
      SELECT * FROM failures WHERE job_id = ? ORDER BY failed_at DESC
    `).all(jobId) as FailureRow[];

    const failures: ExtractionFailure[] = failureRows.map(row => ({
      state: row.state,
      layer: row.layer,
      failedAt: new Date(row.failed_at),
      error: row.error,
      attemptCount: row.attempt_count,
      retryable: Boolean(row.retryable),
    }));

    // Get not configured tasks
    const notConfiguredRows = this.db.prepare(`
      SELECT * FROM not_configured WHERE job_id = ? ORDER BY checked_at DESC
    `).all(jobId) as NotConfiguredRow[];

    const notConfiguredTasks: NotConfiguredTask[] = notConfiguredRows.map(row => ({
      state: row.state,
      layer: row.layer,
      reason: row.reason,
      checkedAt: new Date(row.checked_at),
    }));

    // Parse options
    const options = JSON.parse(jobRow.options_json) as OrchestrationOptions;

    return {
      jobId: jobRow.job_id,
      createdAt: new Date(jobRow.created_at),
      updatedAt: new Date(jobRow.updated_at),
      status: jobRow.status,
      scope,
      progress: {
        totalTasks: jobRow.total_tasks,
        completedTasks: jobRow.completed_tasks,
        failedTasks: jobRow.failed_tasks,
        currentTask: jobRow.current_task ?? undefined,
      },
      completedExtractions,
      failures,
      notConfiguredTasks,
      options,
    };
  }

  /**
   * Update job status
   *
   * @param jobId - Job ID
   * @param status - New status
   */
  async updateStatus(jobId: string, status: JobStatus): Promise<void> {
    const result = this.db.prepare(`
      UPDATE jobs
      SET status = ?, updated_at = ?
      WHERE job_id = ?
    `).run(status, new Date().toISOString(), jobId);

    if (result.changes === 0) {
      throw new Error(`Job ${jobId} not found`);
    }
  }

  /**
   * Update job progress
   *
   * @param jobId - Job ID
   * @param update - Progress update data
   */
  async updateProgress(
    jobId: string,
    update: ProgressUpdateData
  ): Promise<void> {
    const updates: string[] = ['updated_at = ?'];
    const values: Array<string | number> = [new Date().toISOString()];

    if (update.currentTask !== undefined) {
      updates.push('current_task = ?');
      values.push(update.currentTask);
    }

    if (update.completedTasks !== undefined) {
      updates.push('completed_tasks = ?');
      values.push(update.completedTasks);
    }

    if (update.failedTasks !== undefined) {
      updates.push('failed_tasks = ?');
      values.push(update.failedTasks);
    }

    values.push(jobId);

    const result = this.db.prepare(`
      UPDATE jobs SET ${updates.join(', ')} WHERE job_id = ?
    `).run(...values);

    if (result.changes === 0) {
      throw new Error(`Job ${jobId} not found`);
    }
  }

  /**
   * Record successful extraction
   *
   * @param jobId - Job ID
   * @param extraction - Completed extraction record
   */
  async recordCompletion(
    jobId: string,
    extraction: CompletedExtraction
  ): Promise<void> {
    const recordCompletionTx = this.db.transaction(() => {
      // Insert extraction
      this.db.prepare(`
        INSERT INTO extractions (
          job_id, state, layer, completed_at,
          boundary_count, validation_passed
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        jobId,
        extraction.state,
        extraction.layer,
        extraction.completedAt.toISOString(),
        extraction.boundaryCount,
        extraction.validationPassed ? 1 : 0
      );

      // Update job progress
      this.db.prepare(`
        UPDATE jobs
        SET completed_tasks = completed_tasks + 1,
            updated_at = ?
        WHERE job_id = ?
      `).run(new Date().toISOString(), jobId);
    });

    recordCompletionTx();
  }

  /**
   * Record extraction failure
   *
   * @param jobId - Job ID
   * @param failure - Failure record
   */
  async recordFailure(
    jobId: string,
    failure: ExtractionFailure
  ): Promise<void> {
    const recordFailureTx = this.db.transaction(() => {
      // Insert failure
      this.db.prepare(`
        INSERT INTO failures (
          job_id, state, layer, failed_at,
          error, attempt_count, retryable
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        jobId,
        failure.state,
        failure.layer,
        failure.failedAt.toISOString(),
        failure.error,
        failure.attemptCount,
        failure.retryable ? 1 : 0
      );

      // Update job progress
      this.db.prepare(`
        UPDATE jobs
        SET failed_tasks = failed_tasks + 1,
            updated_at = ?
        WHERE job_id = ?
      `).run(new Date().toISOString(), jobId);
    });

    recordFailureTx();
  }

  /**
   * Record not configured task
   *
   * @param jobId - Job ID
   * @param task - Not configured task record
   */
  async recordNotConfigured(
    jobId: string,
    task: NotConfiguredTask
  ): Promise<void> {
    this.db.prepare(`
      INSERT INTO not_configured (
        job_id, state, layer, reason, checked_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      jobId,
      task.state,
      task.layer,
      task.reason,
      task.checkedAt.toISOString()
    );

    // Update timestamp
    this.db.prepare(`
      UPDATE jobs SET updated_at = ? WHERE job_id = ?
    `).run(new Date().toISOString(), jobId);
  }

  /**
   * List recent jobs
   *
   * @param limit - Maximum number of jobs to return (default: 10)
   * @returns Job summaries sorted by creation date (newest first)
   */
  async listJobs(limit: number = 10): Promise<readonly JobSummary[]> {
    const jobRows = this.db.prepare(`
      SELECT * FROM jobs
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as JobRow[];

    const summaries: JobSummary[] = [];

    for (const row of jobRows) {
      // Get scope
      const scopeRows = this.db.prepare(`
        SELECT DISTINCT state FROM job_scopes WHERE job_id = ?
      `).all(row.job_id) as Array<{ state: string }>;

      const layerRows = this.db.prepare(`
        SELECT DISTINCT layer FROM job_scopes WHERE job_id = ?
      `).all(row.job_id) as Array<{ layer: LegislativeLayerType }>;

      const scope: JobScope = {
        states: scopeRows.map(r => r.state),
        layers: layerRows.map(r => r.layer),
      };

      const createdAt = new Date(row.created_at);
      const updatedAt = new Date(row.updated_at);

      const durationMs =
        row.status === 'completed' || row.status === 'failed' || row.status === 'cancelled'
          ? updatedAt.getTime() - createdAt.getTime()
          : undefined;

      summaries.push({
        jobId: row.job_id,
        createdAt,
        status: row.status,
        scope,
        progress: {
          totalTasks: row.total_tasks,
          completedTasks: row.completed_tasks,
          failedTasks: row.failed_tasks,
          currentTask: row.current_task ?? undefined,
        },
        durationMs,
      });
    }

    return summaries;
  }

  /**
   * Delete a job
   *
   * @param jobId - Job ID
   */
  async deleteJob(jobId: string): Promise<void> {
    const result = this.db.prepare(`
      DELETE FROM jobs WHERE job_id = ?
    `).run(jobId);

    if (result.changes === 0) {
      throw new Error(`Job ${jobId} not found`);
    }
  }

  // ============================================================================
  // Snapshot Management
  // ============================================================================

  /**
   * Create a new snapshot
   *
   * @param jobId - Job ID that generated this snapshot
   * @param snapshot - Snapshot metadata
   * @returns Snapshot ID
   */
  async createSnapshot(
    jobId: string,
    snapshot: Omit<SnapshotMetadata, 'id'>
  ): Promise<string> {
    const snapshotId = `snapshot-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;

    this.db.prepare(`
      INSERT INTO snapshots (
        id, merkle_root, ipfs_cid, boundary_count,
        created_at, regions_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      snapshotId,
      snapshot.merkleRoot,
      snapshot.ipfsCID,
      snapshot.boundaryCount,
      snapshot.createdAt.toISOString(),
      JSON.stringify(snapshot.regions)
    );

    return snapshotId;
  }

  /**
   * Get snapshot by ID
   *
   * @param snapshotId - Snapshot ID
   * @returns Snapshot metadata or null if not found
   */
  async getSnapshot(snapshotId: string): Promise<SnapshotMetadata | null> {
    const row = this.db.prepare(`
      SELECT * FROM snapshots WHERE id = ?
    `).get(snapshotId) as SnapshotRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      merkleRoot: row.merkle_root,
      ipfsCID: row.ipfs_cid,
      boundaryCount: row.boundary_count,
      createdAt: new Date(row.created_at),
      regions: JSON.parse(row.regions_json) as readonly string[],
    };
  }

  /**
   * List recent snapshots
   *
   * @param limit - Maximum number of snapshots to return
   * @returns Snapshot metadata sorted by creation date (newest first)
   */
  async listSnapshots(limit: number = 10): Promise<readonly SnapshotMetadata[]> {
    const rows = this.db.prepare(`
      SELECT * FROM snapshots
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as SnapshotRow[];

    return rows.map(row => ({
      id: row.id,
      merkleRoot: row.merkle_root,
      ipfsCID: row.ipfs_cid,
      boundaryCount: row.boundary_count,
      createdAt: new Date(row.created_at),
      regions: JSON.parse(row.regions_json) as readonly string[],
    }));
  }

  /**
   * Get snapshot by Merkle root
   *
   * @param root - Merkle root hash
   * @returns Snapshot metadata or null if not found
   */
  async getSnapshotByMerkleRoot(root: string): Promise<SnapshotMetadata | null> {
    const row = this.db.prepare(`
      SELECT * FROM snapshots WHERE merkle_root = ?
    `).get(root) as SnapshotRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      merkleRoot: row.merkle_root,
      ipfsCID: row.ipfs_cid,
      boundaryCount: row.boundary_count,
      createdAt: new Date(row.created_at),
      regions: JSON.parse(row.regions_json) as readonly string[],
    };
  }

  // ============================================================================
  // Validation Results
  // ============================================================================

  /**
   * Store validation result for a boundary
   *
   * @param snapshotId - Snapshot ID
   * @param boundaryId - Boundary identifier
   * @param result - Validation result
   */
  async storeValidationResult(
    snapshotId: string,
    boundaryId: string,
    result: Omit<ValidationResult, 'boundaryId'>
  ): Promise<void> {
    this.db.prepare(`
      INSERT INTO validation_results (
        snapshot_id, boundary_id, geometry_valid,
        geoid_valid, confidence, warnings_json, validated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshotId,
      boundaryId,
      result.geometryValid ? 1 : 0,
      result.geoidValid ? 1 : 0,
      result.confidence,
      JSON.stringify(result.warnings),
      result.validatedAt.toISOString()
    );
  }

  /**
   * Get all validation results for a snapshot
   *
   * @param snapshotId - Snapshot ID
   * @returns Map of boundary ID to validation result
   */
  async getValidationResults(
    snapshotId: string
  ): Promise<Map<string, ValidationResult>> {
    const rows = this.db.prepare(`
      SELECT * FROM validation_results WHERE snapshot_id = ?
    `).all(snapshotId) as ValidationResultRow[];

    const results = new Map<string, ValidationResult>();

    for (const row of rows) {
      results.set(row.boundary_id, {
        boundaryId: row.boundary_id,
        geometryValid: Boolean(row.geometry_valid),
        geoidValid: Boolean(row.geoid_valid),
        confidence: row.confidence,
        warnings: JSON.parse(row.warnings_json) as readonly string[],
        validatedAt: new Date(row.validated_at),
      });
    }

    return results;
  }

  // ============================================================================
  // Analytics
  // ============================================================================

  /**
   * Get extraction history for a state and layer
   *
   * @param state - State code
   * @param layer - Legislative layer
   * @param limit - Maximum number of results
   * @returns Extraction history sorted by completion date (newest first)
   */
  async getExtractionHistory(
    state: string,
    layer: LegislativeLayerType,
    limit: number = 10
  ): Promise<readonly CompletedExtraction[]> {
    const rows = this.db.prepare(`
      SELECT * FROM extractions
      WHERE state = ? AND layer = ?
      ORDER BY completed_at DESC
      LIMIT ?
    `).all(state, layer, limit) as ExtractionRow[];

    return rows.map(row => ({
      state: row.state,
      layer: row.layer,
      completedAt: new Date(row.completed_at),
      boundaryCount: row.boundary_count,
      validationPassed: Boolean(row.validation_passed),
    }));
  }

  /**
   * Get coverage statistics
   *
   * @returns Coverage statistics across all extractions
   */
  async getCoverageStats(): Promise<CoverageStatistics> {
    // Count unique states
    const statesRow = this.db.prepare(`
      SELECT COUNT(DISTINCT state) as total FROM extractions
    `).get() as { total: number };

    // Count total boundaries
    const boundariesRow = this.db.prepare(`
      SELECT SUM(boundary_count) as total FROM extractions
    `).get() as { total: number | null };

    // Count by layer
    const layerRows = this.db.prepare(`
      SELECT
        layer,
        COUNT(DISTINCT state) as states,
        SUM(boundary_count) as boundaries
      FROM extractions
      GROUP BY layer
    `).all() as Array<{
      layer: LegislativeLayerType;
      states: number;
      boundaries: number;
    }>;

    const byLayer: Record<string, { states: number; boundaries: number }> = {};
    for (const row of layerRows) {
      byLayer[row.layer] = {
        states: row.states,
        boundaries: row.boundaries,
      };
    }

    // Get date range
    const datesRow = this.db.prepare(`
      SELECT
        MIN(completed_at) as oldest,
        MAX(completed_at) as newest
      FROM extractions
    `).get() as { oldest: string | null; newest: string | null };

    return {
      totalStates: statesRow.total,
      coveredStates: statesRow.total,
      totalBoundaries: boundariesRow.total ?? 0,
      byLayer,
      mostRecentExtraction: datesRow.newest ? new Date(datesRow.newest) : null,
      oldestExtraction: datesRow.oldest ? new Date(datesRow.oldest) : null,
    };
  }

  // ============================================================================
  // Utility
  // ============================================================================

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    this.db.close();
  }

  /**
   * Generate unique job ID
   */
  private generateJobId(): string {
    const timestamp = Date.now().toString(36);
    const random = randomBytes(4).toString('hex');
    return `job-${timestamp}-${random}`;
  }
}
