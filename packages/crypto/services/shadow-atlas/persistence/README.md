# Shadow Atlas Persistence Layer

> **Implementation Status**: See [STATUS.md](./STATUS.md) for detailed deployment information

Cloud-migratable database schema for Shadow Atlas job orchestration and boundary extraction tracking.

## Architecture

**Design Goals:**
1. **SQLite-first, PostgreSQL-ready** - Works on both databases without modification
2. **Type-safe by construction** - Branded types prevent ID confusion
3. **Audit-friendly** - Soft deletes preserve full history
4. **Query-optimized** - Indexes for all common access patterns

**Migration Path:**
```
Development:  SQLite (local file)
              ↓
Production:   PostgreSQL (managed cloud)
              ↓
Analytics:    BigQuery/Snowflake (data warehouse)
```

## Database Tables

### Core Entities

**jobs** - Orchestration job lifecycle
- Tracks batch extraction jobs from creation through completion
- Supports resume-from-checkpoint via status field
- Progress metrics enable monitoring

**extractions** - Successful boundary extractions
- One row per (job, state, layer) tuple
- Links to validation results
- Records source portal metadata

**failures** - Failed extraction attempts
- Retry tracking with backoff metadata
- Full error context for debugging
- Distinguishes retryable from permanent failures

**not_configured** - Registry gaps
- Documents missing portal configurations
- Drives registry improvement efforts
- Tracks resolution progress

**snapshots** - Merkle tree commits
- Immutable cryptographic commitments
- IPFS content addressing
- Version tracking with deprecation

**validation_results** - Cross-validation outcomes
- Links extractions to authoritative sources
- Captures discrepancies for investigation
- Supports multiple validator types

### Relationships

```
jobs (1) ──→ (N) extractions
jobs (1) ──→ (N) failures
jobs (1) ──→ (N) not_configured
jobs (1) ──→ (N) snapshots

extractions (1) ──→ (N) validation_results

snapshots (1) ──→ (N) snapshot_regions
```

## Type Safety

### Branded IDs Prevent Confusion

```typescript
// ❌ WRONG - Can accidentally mix entity references
function getExtraction(id: string): ExtractionRow { ... }
const jobId: string = "01JFEG8M2N...";
getExtraction(jobId); // Compiles but logically wrong!

// ✅ CORRECT - Branded types catch errors at compile time
function getExtraction(id: ExtractionId): ExtractionRow { ... }
const jobId: JobId = "01JFEG8M2N..." as JobId;
getExtraction(jobId); // Type error! Expected ExtractionId, got JobId
```

### ISO8601 Timestamps for Cloud Compatibility

```typescript
// ❌ WRONG - JavaScript Date objects don't serialize consistently
interface JobRow {
  created_at: Date; // SQLite uses julianday, PostgreSQL uses timestamp
}

// ✅ CORRECT - ISO8601 strings work everywhere
interface JobRow {
  created_at: ISO8601Timestamp; // "2025-12-17T10:30:00.000Z"
}

// Convert when inserting
const now = new Date().toISOString();

// Convert when reading
const date = new Date(row.created_at);
```

### Type Guards for Runtime Validation

```typescript
import { isJobStatus, isLegislativeLayerType } from './schema.types';

// Validate untrusted input
function updateJobStatus(id: JobId, status: string): void {
  if (!isJobStatus(status)) {
    throw new Error(`Invalid status: ${status}`);
  }

  // TypeScript now knows status is JobStatus
  db.query('UPDATE jobs SET status = ? WHERE id = ?', [status, id]);
}
```

## Common Queries

### Resume Incomplete Job

```typescript
import type { JobRow, JobId } from './schema.types';

async function resumeJob(jobId: JobId): Promise<JobRow> {
  const job = await db.query<JobRow>(
    'SELECT * FROM jobs WHERE id = ? AND archived_at IS NULL',
    [jobId]
  );

  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  if (!['pending', 'partial', 'failed'].includes(job.status)) {
    throw new Error(`Job cannot be resumed: ${job.status}`);
  }

  return job;
}
```

### Find Retryable Failures

```typescript
import type { FailureRow, JobId } from './schema.types';

async function getRetryableFailures(
  jobId: JobId
): Promise<ReadonlyArray<FailureRow>> {
  return db.query<FailureRow>(
    `SELECT *
     FROM failures
     WHERE job_id = ?
       AND retryable = TRUE
       AND retried_at IS NULL
       AND archived_at IS NULL
     ORDER BY failed_at ASC`,
    [jobId]
  );
}
```

### Latest Snapshot for State

```typescript
import type { SnapshotRow } from './schema.types';

async function getLatestSnapshot(
  stateCode: string
): Promise<SnapshotRow | null> {
  return db.query<SnapshotRow>(
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
```

### Registry Gaps Summary

```typescript
import type { RegistryGapView } from './schema.types';

async function getRegistryGaps(): Promise<ReadonlyArray<RegistryGapView>> {
  return db.query<RegistryGapView>(
    'SELECT * FROM v_registry_gaps ORDER BY occurrence_count DESC'
  );
}
```

## Migration Strategy

### Phase 1: SQLite Development (Current)

```typescript
import Database from 'better-sqlite3';

const db = new Database('.shadow-atlas/persistence.db');
db.exec(await fs.readFile('schema.sql', 'utf-8'));
```

### Phase 2: PostgreSQL Production

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST,
  database: 'shadow_atlas',
  ssl: { rejectUnauthorized: true },
});

await pool.query(await fs.readFile('schema.sql', 'utf-8'));
```

**No schema changes required** - same SQL works on both databases.

### Phase 3: Analytics Warehouse

Export snapshots to BigQuery/Snowflake for long-term analytics:

```sql
-- BigQuery schema (automatically derived from PostgreSQL)
CREATE TABLE shadow_atlas.jobs (
  id STRING NOT NULL,
  scope_states JSON,
  scope_layers JSON,
  status STRING,
  created_at TIMESTAMP,
  ...
);
```

## Performance Considerations

### Index Usage

All indexes follow PostgreSQL best practices:
- Partial indexes for filtered queries (`WHERE archived_at IS NULL`)
- Composite indexes for common query patterns
- Covering indexes for frequently selected columns

### Query Planning

```sql
-- Check index usage (PostgreSQL)
EXPLAIN ANALYZE
SELECT * FROM jobs
WHERE status = 'running'
  AND archived_at IS NULL
ORDER BY created_at DESC;

-- Should show:
-- Index Scan using idx_jobs_status_created
```

### Soft Delete Overhead

Soft deletes add `archived_at IS NULL` filters to most queries. Monitor for:
- Index bloat (vacuum regularly)
- Query plan degradation (rebuild indexes if needed)
- Storage growth (archive old data to cold storage)

## Audit Trail

Every state change is preserved:

```typescript
// Soft delete preserves record
await db.query(
  'UPDATE jobs SET archived_at = ? WHERE id = ?',
  [new Date().toISOString(), jobId]
);

// Query excludes archived by default
const activeJobs = await db.query(
  'SELECT * FROM jobs WHERE archived_at IS NULL'
);

// Audit query includes archived
const allJobs = await db.query(
  'SELECT * FROM jobs ORDER BY created_at DESC'
);
```

## Security Considerations

### No PII in Database

This schema stores **zero personally identifiable information**:
- State codes (public data)
- Layer types (categorical)
- Boundary counts (aggregate statistics)
- Error messages (technical context)

**User addresses never touch this database** - they stay in ZK circuits.

### SQL Injection Prevention

Always use parameterized queries:

```typescript
// ❌ WRONG - SQL injection vulnerability
const jobs = await db.query(
  `SELECT * FROM jobs WHERE status = '${userInput}'`
);

// ✅ CORRECT - Parameterized query
const jobs = await db.query(
  'SELECT * FROM jobs WHERE status = ?',
  [userInput]
);
```

### Access Control

Recommended PostgreSQL roles:

```sql
-- Read-only analytics role
CREATE ROLE shadow_atlas_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO shadow_atlas_reader;

-- Application role
CREATE ROLE shadow_atlas_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO shadow_atlas_app;
-- No DELETE granted (soft deletes use UPDATE)

-- Admin role
CREATE ROLE shadow_atlas_admin;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO shadow_atlas_admin;
```

## Testing

### Schema Validation

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs/promises';

describe('Schema validation', () => {
  it('creates all tables without errors', async () => {
    const db = new Database(':memory:');
    const schema = await fs.readFile('schema.sql', 'utf-8');

    expect(() => db.exec(schema)).not.toThrow();
  });

  it('enforces foreign key constraints', () => {
    const db = new Database(':memory:');
    db.exec(await fs.readFile('schema.sql', 'utf-8'));

    // Enable foreign keys (SQLite needs this)
    db.pragma('foreign_keys = ON');

    // Should fail - references non-existent job
    expect(() => {
      db.prepare(`
        INSERT INTO extractions (id, job_id, state_code, layer_type, boundary_count, validation_passed, completed_at)
        VALUES ('01JF...', 'nonexistent', 'US-CA', 'congressional', 100, TRUE, '2025-12-17T10:00:00.000Z')
      `).run();
    }).toThrow(/FOREIGN KEY constraint failed/);
  });
});
```

### Type Safety Tests

```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type { JobId, ExtractionId, JobRow } from './schema.types';

describe('Type safety', () => {
  it('prevents mixing entity IDs', () => {
    const jobId = 'test' as JobId;
    const extractionId = 'test' as ExtractionId;

    // This should be a type error
    // @ts-expect-error - Cannot assign JobId to ExtractionId
    const wrong: ExtractionId = jobId;

    expectTypeOf(jobId).not.toEqualTypeOf(extractionId);
  });

  it('enforces readonly row types', () => {
    const row: JobRow = {
      id: 'test' as JobId,
      scope_states: '[]',
      scope_layers: '[]',
      status: 'pending',
      created_at: '2025-12-17T10:00:00.000Z',
      started_at: null,
      updated_at: '2025-12-17T10:00:00.000Z',
      completed_at: null,
      archived_at: null,
      total_tasks: 0,
      completed_tasks: 0,
      failed_tasks: 0,
      skipped_tasks: 0,
      error_summary: null,
    };

    // This should be a type error
    // @ts-expect-error - Cannot modify readonly property
    row.status = 'running';
  });
});
```

## Future Enhancements

### Partitioning (PostgreSQL)

For very large datasets, partition by created_at:

```sql
-- Jobs table with partitioning
CREATE TABLE jobs (
  ...
) PARTITION BY RANGE (created_at);

CREATE TABLE jobs_2025_q1 PARTITION OF jobs
  FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');

CREATE TABLE jobs_2025_q2 PARTITION OF jobs
  FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
```

### Event Sourcing

Add event log for complete audit trail:

```sql
CREATE TABLE job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL, -- JSON
  created_at TEXT NOT NULL
);
```

### Materialized Views (PostgreSQL)

Pre-compute expensive aggregations:

```sql
CREATE MATERIALIZED VIEW mv_daily_extraction_stats AS
SELECT
  DATE(completed_at) AS extraction_date,
  state_code,
  layer_type,
  COUNT(*) AS total_extractions,
  SUM(boundary_count) AS total_boundaries
FROM extractions
WHERE archived_at IS NULL
GROUP BY DATE(completed_at), state_code, layer_type;

-- Refresh nightly
REFRESH MATERIALIZED VIEW mv_daily_extraction_stats;
```

## Resources

- [SQLite Documentation](https://www.sqlite.org/docs.html)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - Node.js SQLite driver
- [node-postgres](https://node-postgres.com/) - PostgreSQL client

## License

Same as VOTER Protocol parent repository.
