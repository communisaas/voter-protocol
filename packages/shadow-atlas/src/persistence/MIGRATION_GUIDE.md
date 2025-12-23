# Shadow Atlas Persistence Migration Guide

This guide covers migrating from the existing filesystem-based `JobStateStore` to the new database persistence layer.

## Migration Overview

**Current Architecture:**
```
JobStateStore (filesystem)
  ├── .shadow-atlas/jobs/*.json
  ├── File-based JSON storage
  └── No relational queries
```

**Target Architecture:**
```
ShadowAtlasRepository (database)
  ├── SQLite (development)
  ├── PostgreSQL (production)
  └── Normalized relational schema
```

## Phase 1: Parallel Running (Week 1-2)

Run both systems simultaneously to validate correctness.

### Step 1: Initialize Database

```typescript
import { createSQLiteAdapter } from './persistence/adapters/sqlite';
import { ShadowAtlasRepository } from './persistence/repository';
import fs from 'node:fs/promises';

const schemaSQL = await fs.readFile('./persistence/schema.sql', 'utf-8');
const adapter = await createSQLiteAdapter(
  '.shadow-atlas/persistence.db',
  schemaSQL
);
const repo = new ShadowAtlasRepository(adapter);
```

### Step 2: Dual-Write Pattern

Write to both filesystem and database:

```typescript
class MigratingJobStateStore {
  constructor(
    private readonly legacyStore: JobStateStore,
    private readonly repo: ShadowAtlasRepository
  ) {}

  async createJob(scope: JobScope): Promise<string> {
    const jobId = ulid();

    // Write to legacy system
    await this.legacyStore.createJob(jobId, scope);

    // Write to new system
    await this.repo.createJob({
      id: jobId as JobId,
      scope_states: JSON.stringify(scope.states),
      scope_layers: JSON.stringify(scope.layers),
      status: 'pending',
      created_at: nowISO8601(),
      updated_at: nowISO8601(),
      total_tasks: scope.states.length * scope.layers.length,
    });

    return jobId;
  }

  async recordExtraction(
    jobId: string,
    state: string,
    layer: LegislativeLayerType,
    result: ExtractionResult
  ): Promise<void> {
    // Write to legacy system
    await this.legacyStore.recordExtraction(jobId, state, layer, result);

    // Write to new system
    await this.repo.createExtraction({
      id: ulid() as ExtractionId,
      job_id: jobId as JobId,
      state_code: state,
      layer_type: layer,
      boundary_count: result.boundaries.length,
      validation_passed: result.validated,
      source_url: result.sourceUrl,
      source_type: result.sourceType,
      completed_at: nowISO8601(),
    });
  }
}
```

### Step 3: Validate Consistency

Compare outputs periodically:

```typescript
async function validateConsistency(
  legacyStore: JobStateStore,
  repo: ShadowAtlasRepository,
  jobId: string
): Promise<void> {
  const legacyState = await legacyStore.getJobState(jobId);
  const dbJob = await repo.getJob(jobId as JobId);

  if (!dbJob) {
    console.error(`Missing in DB: ${jobId}`);
    return;
  }

  // Compare status
  if (legacyState.status !== dbJob.status) {
    console.error(`Status mismatch: ${legacyState.status} vs ${dbJob.status}`);
  }

  // Compare extraction counts
  const dbExtractions = await repo.listExtractionsByJob(jobId as JobId);
  if (legacyState.completedExtractions.length !== dbExtractions.length) {
    console.error(
      `Extraction count mismatch: ${legacyState.completedExtractions.length} vs ${dbExtractions.length}`
    );
  }
}
```

## Phase 2: One-Time Backfill (Week 2)

Migrate historical data from filesystem to database.

### Backfill Script

```typescript
import { glob } from 'glob';
import { JobStateStore } from './job-state-store';
import { ShadowAtlasRepository } from './persistence/repository';

async function backfillHistoricalData(
  legacyStore: JobStateStore,
  repo: ShadowAtlasRepository
): Promise<void> {
  const jobFiles = await glob('.shadow-atlas/jobs/*.json');

  console.log(`Found ${jobFiles.length} historical jobs`);

  for (const file of jobFiles) {
    const jobId = path.basename(file, '.json');
    const state = await legacyStore.getJobState(jobId);

    console.log(`Backfilling job ${jobId}...`);

    // Migrate job
    await repo.createJob({
      id: jobId as JobId,
      scope_states: JSON.stringify(state.scope.states),
      scope_layers: JSON.stringify(state.scope.layers),
      status: state.status,
      created_at: state.createdAt.toISOString(),
      started_at: state.startedAt?.toISOString() ?? null,
      updated_at: state.updatedAt.toISOString(),
      completed_at: state.completedAt?.toISOString() ?? null,
      total_tasks: state.scope.states.length * state.scope.layers.length,
      completed_tasks: state.completedExtractions.length,
      failed_tasks: state.failures.length,
      skipped_tasks: state.notConfigured.length,
    });

    // Migrate extractions
    for (const extraction of state.completedExtractions) {
      await repo.createExtraction({
        id: ulid() as ExtractionId,
        job_id: jobId as JobId,
        state_code: extraction.state,
        layer_type: extraction.layer,
        boundary_count: extraction.boundaryCount,
        validation_passed: extraction.validationPassed,
        completed_at: extraction.completedAt.toISOString(),
      });
    }

    // Migrate failures
    for (const failure of state.failures) {
      await repo.createFailure({
        id: ulid() as FailureId,
        job_id: jobId as JobId,
        state_code: failure.state,
        layer_type: failure.layer,
        error_message: failure.error,
        attempt_count: failure.attemptCount,
        retryable: failure.retryable,
        failed_at: failure.failedAt.toISOString(),
      });
    }

    // Migrate not-configured
    for (const nc of state.notConfigured) {
      await repo.createNotConfigured({
        id: ulid() as NotConfiguredId,
        job_id: jobId as JobId,
        state_code: nc.state,
        layer_type: nc.layer,
        reason: nc.reason,
        checked_at: nc.checkedAt.toISOString(),
      });
    }

    console.log(`✓ Backfilled job ${jobId}`);
  }

  console.log('Backfill complete!');
}
```

## Phase 3: Read Migration (Week 3)

Switch reads to database while maintaining dual writes.

### Update Code to Read from Database

```typescript
class BatchOrchestrator {
  constructor(
    private readonly repo: ShadowAtlasRepository,
    private readonly legacyStore: JobStateStore // Keep for writes during migration
  ) {}

  async resumeJob(jobId: string): Promise<void> {
    // Read from database
    const job = await this.repo.getJob(jobId as JobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const scope = parseJobScope(job);
    const extractions = await this.repo.listExtractionsByJob(jobId as JobId);
    const failures = await this.repo.listRetryableFailures(jobId as JobId);

    // Resume logic using database data
    // ...

    // Still dual-write for safety
    await this.legacyStore.updateJobStatus(jobId, 'running');
    await this.repo.updateJob(jobId as JobId, {
      status: 'running',
      updated_at: nowISO8601(),
    });
  }
}
```

## Phase 4: Write Cutover (Week 4)

Stop writing to filesystem, database becomes source of truth.

### Remove Dual Writes

```typescript
class BatchOrchestrator {
  constructor(
    private readonly repo: ShadowAtlasRepository
    // Remove legacyStore
  ) {}

  async createJob(scope: JobScope): Promise<string> {
    const jobId = ulid();

    // Only write to database
    await this.repo.createJob({
      id: jobId as JobId,
      scope_states: JSON.stringify(scope.states),
      scope_layers: JSON.stringify(scope.layers),
      status: 'pending',
      created_at: nowISO8601(),
      updated_at: nowISO8601(),
      total_tasks: scope.states.length * scope.layers.length,
    });

    return jobId;
  }
}
```

### Archive Filesystem Data

```bash
# Move legacy data to archive directory
mkdir -p .shadow-atlas/archive
mv .shadow-atlas/jobs .shadow-atlas/archive/jobs-$(date +%Y%m%d)

# Keep database as single source of truth
ls -lh .shadow-atlas/persistence.db
```

## Phase 5: Production Migration (Week 5-6)

Migrate from SQLite to PostgreSQL for production.

### Setup PostgreSQL

```sql
-- Create database
CREATE DATABASE shadow_atlas;

-- Create application user
CREATE USER shadow_atlas_app WITH PASSWORD 'secure_password';
GRANT CONNECT ON DATABASE shadow_atlas TO shadow_atlas_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO shadow_atlas_app;
```

### Migrate Data from SQLite to PostgreSQL

```typescript
import { createSQLiteAdapter } from './persistence/adapters/sqlite';
import { createPostgreSQLAdapter } from './persistence/adapters/postgresql';

async function migrateSQLiteToPostgres(
  sqlitePath: string,
  pgConfig: PoolConfig
): Promise<void> {
  const sqliteAdapter = await createSQLiteAdapter(sqlitePath, '');
  const sqliteRepo = new ShadowAtlasRepository(sqliteAdapter);

  const schemaSQL = await fs.readFile('./persistence/schema.sql', 'utf-8');
  const pgAdapter = await createPostgreSQLAdapter(pgConfig, schemaSQL);
  const pgRepo = new ShadowAtlasRepository(pgAdapter);

  // Migrate jobs
  const jobs = await sqliteAdapter.queryMany<JobRow>(
    'SELECT * FROM jobs ORDER BY created_at ASC'
  );

  for (const job of jobs) {
    await pgRepo.createJob({
      id: job.id,
      scope_states: job.scope_states,
      scope_layers: job.scope_layers,
      status: job.status,
      created_at: job.created_at,
      started_at: job.started_at ?? undefined,
      updated_at: job.updated_at,
      completed_at: job.completed_at ?? undefined,
      total_tasks: job.total_tasks,
      completed_tasks: job.completed_tasks,
      failed_tasks: job.failed_tasks,
      skipped_tasks: job.skipped_tasks,
      error_summary: job.error_summary ?? undefined,
    });

    // Migrate extractions for this job
    const extractions = await sqliteAdapter.queryMany<ExtractionRow>(
      'SELECT * FROM extractions WHERE job_id = ?',
      [job.id]
    );

    for (const extraction of extractions) {
      await pgRepo.createExtraction({
        id: extraction.id,
        job_id: extraction.job_id,
        state_code: extraction.state_code,
        layer_type: extraction.layer_type,
        boundary_count: extraction.boundary_count,
        validation_passed: extraction.validation_passed,
        source_url: extraction.source_url ?? undefined,
        source_type: extraction.source_type ?? undefined,
        completed_at: extraction.completed_at,
      });

      // Migrate validation results
      const validations = await sqliteAdapter.queryMany<ValidationResultRow>(
        'SELECT * FROM validation_results WHERE extraction_id = ?',
        [extraction.id]
      );

      for (const validation of validations) {
        await pgRepo.createValidationResult({
          id: validation.id,
          extraction_id: validation.extraction_id,
          validator_type: validation.validator_type,
          passed: validation.passed,
          expected_count: validation.expected_count ?? undefined,
          actual_count: validation.actual_count ?? undefined,
          discrepancies: validation.discrepancies ?? undefined,
          authority_source: validation.authority_source ?? undefined,
          authority_version: validation.authority_version ?? undefined,
          validated_at: validation.validated_at,
        });
      }
    }

    console.log(`✓ Migrated job ${job.id}`);
  }

  await sqliteAdapter.close();
  await pgAdapter.close();

  console.log('Migration to PostgreSQL complete!');
}
```

### Update Production Configuration

```typescript
// config/production.ts
export const dbConfig = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  database: 'shadow_atlas',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: {
    rejectUnauthorized: true,
  },
};

// Initialize production repository
const adapter = await createPostgreSQLAdapter(dbConfig, schemaSQL);
const repo = new ShadowAtlasRepository(adapter);
```

## Rollback Plan

If issues arise, rollback is straightforward:

### During Dual-Write Phase

```typescript
// Simply stop writing to database
// Filesystem remains source of truth
const orchestrator = new BatchOrchestrator(legacyStore);
```

### After Write Cutover

Keep filesystem archive as backup:

```typescript
async function rollbackToFilesystem(
  repo: ShadowAtlasRepository,
  legacyStore: JobStateStore
): Promise<void> {
  // Export recent jobs from database
  const recentJobs = await repo.listJobsByStatus('running');

  for (const job of recentJobs) {
    const scope = parseJobScope(job);
    const extractions = await repo.listExtractionsByJob(job.id);

    // Reconstruct filesystem state
    await legacyStore.createJob(job.id as string, scope);

    for (const extraction of extractions) {
      await legacyStore.recordExtraction(
        job.id as string,
        extraction.state_code,
        extraction.layer_type,
        {
          boundaries: [], // Would need to fetch from storage
          validated: extraction.validation_passed,
          sourceUrl: extraction.source_url ?? undefined,
          sourceType: extraction.source_type ?? undefined,
        }
      );
    }
  }

  console.log('Rollback complete');
}
```

## Validation Checklist

Before declaring migration complete:

- [ ] All historical jobs migrated (compare counts)
- [ ] Recent jobs showing in database
- [ ] Extraction counts match between systems
- [ ] Failure tracking working correctly
- [ ] Snapshot creation flows end-to-end
- [ ] Views returning correct aggregations
- [ ] No errors in application logs
- [ ] Performance acceptable (queries <100ms)
- [ ] Backup strategy tested
- [ ] Rollback procedure documented and tested

## Performance Benchmarks

Expected query performance on moderate hardware:

| Query | SQLite | PostgreSQL |
|-------|--------|------------|
| Get job by ID | <1ms | <5ms |
| List extractions by job | <5ms | <10ms |
| Extraction coverage view | <20ms | <30ms |
| Registry gaps view | <10ms | <15ms |
| Create extraction + validations | <10ms | <20ms |

If queries exceed these benchmarks:
1. Check index usage with EXPLAIN ANALYZE
2. Verify foreign keys properly indexed
3. Consider query optimization
4. Review database configuration (cache size, etc.)

## Support

Questions or issues during migration:
- Review schema.sql comments for table purposes
- Check repository.test.ts for usage examples
- Consult README.md for architecture details
