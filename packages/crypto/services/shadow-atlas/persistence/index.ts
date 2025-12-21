/**
 * Shadow Atlas Persistence Layer - Public API
 *
 * Exports type-safe database adapters and repository for job orchestration.
 *
 * USAGE:
 *
 * ```typescript
 * // SQLite for development
 * import { SqlitePersistenceAdapter } from './persistence';
 *
 * const adapter = new SqlitePersistenceAdapter('.shadow-atlas/jobs.db');
 * await adapter.runMigrations();
 *
 * const jobId = await adapter.createJob(scope, options);
 * const job = await adapter.getJob(jobId);
 * ```
 *
 * ```typescript
 * // Repository pattern (cloud-ready)
 * import { ShadowAtlasRepository, createSQLiteAdapter } from './persistence';
 * import { readFile } from 'fs/promises';
 *
 * const schema = await readFile('./schema.sql', 'utf-8');
 * const adapter = await createSQLiteAdapter('.shadow-atlas/jobs.db', schema);
 * const repo = new ShadowAtlasRepository(adapter);
 *
 * const job = await repo.createJob({
 *   id: 'job-123' as JobId,
 *   scope_states: JSON.stringify(['CA', 'NY']),
 *   scope_layers: JSON.stringify(['congressional']),
 *   status: 'pending',
 *   created_at: nowISO8601(),
 *   // ...
 * });
 * ```
 */

// ============================================================================
// Primary Adapter (JobStateStore compatible)
// ============================================================================

export { SqlitePersistenceAdapter } from './sqlite-adapter.js';

export type {
  ValidationResult,
  CoverageStatistics,
  Migration,
} from './sqlite-adapter.js';

// ============================================================================
// Repository Pattern (Cloud-ready)
// ============================================================================

export { ShadowAtlasRepository } from './repository.js';
export type { DatabaseAdapter } from './repository.js';

// ============================================================================
// Concrete Adapters
// ============================================================================

export { SQLiteAdapter, createSQLiteAdapter } from './adapters/sqlite.js';
export { PostgreSQLAdapter, createPostgreSQLAdapter } from './adapters/postgresql.js';

// ============================================================================
// Type System
// ============================================================================

export type {
  // Branded IDs
  JobId,
  ExtractionId,
  FailureId,
  NotConfiguredId,
  SnapshotId,
  ValidationResultId,

  // Row Types
  JobRow,
  ExtractionRow,
  FailureRow,
  NotConfiguredRow,
  SnapshotRow,
  SnapshotRegionRow,
  ValidationResultRow,

  // Insert Types
  JobInsert,
  ExtractionInsert,
  FailureInsert,
  NotConfiguredInsert,
  SnapshotInsert,
  SnapshotRegionInsert,
  ValidationResultInsert,

  // Update Types
  JobUpdate,
  FailureUpdate,
  NotConfiguredUpdate,

  // View Types
  JobSummaryView,
  ExtractionCoverageView,
  RegistryGapView,

  // Enums
  JobStatus,
  LegislativeLayerType,

  // Utilities
  ISO8601Timestamp,
} from './schema.types.js';

export {
  // Type guards
  isJobStatus,
  isLegislativeLayerType,

  // Utilities
  nowISO8601,
  generateJobId,
  generateExtractionId,
  generateFailureId,
  generateNotConfiguredId,
  generateSnapshotId,
  generateValidationResultId,
} from './schema.types.js';
