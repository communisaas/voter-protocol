# Shadow Atlas Persistence Architecture

## Executive Summary

The Shadow Atlas persistence layer provides cloud-migratable, type-safe database operations for geospatial boundary extraction orchestration. It replaces filesystem-based JSON storage with a normalized relational schema that supports SQLite (development) and PostgreSQL (production) without code changes.

**Key Design Decisions:**
1. **Cloud-first schema** - PostgreSQL-compatible SQL with no database-specific features
2. **Nuclear type safety** - Branded IDs prevent entity confusion at compile time
3. **Audit-friendly** - Soft deletes preserve complete history
4. **Query-optimized** - Indexes for all common access patterns

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Shadow Atlas Application                      │
│                                                                   │
│  ┌────────────────────┐        ┌──────────────────────┐         │
│  │ BatchOrchestrator  │───────▶│ ShadowAtlasRepository│         │
│  └────────────────────┘        └──────────┬───────────┘         │
│                                            │                      │
│                                            │ Type-safe API        │
└────────────────────────────────────────────┼──────────────────────┘
                                             │
                           ┌─────────────────▼──────────────────┐
                           │     DatabaseAdapter Interface      │
                           └─────────────────┬──────────────────┘
                                             │
                      ┌──────────────────────┴───────────────────────┐
                      │                                              │
         ┌────────────▼─────────────┐              ┌────────────────▼──────────┐
         │   SQLiteAdapter          │              │   PostgreSQLAdapter       │
         │   (better-sqlite3)       │              │   (node-postgres)         │
         └────────────┬─────────────┘              └────────────┬──────────────┘
                      │                                         │
         ┌────────────▼─────────────┐              ┌────────────▼──────────────┐
         │   SQLite Database        │              │   PostgreSQL Database     │
         │   (.shadow-atlas/*.db)   │              │   (Managed Cloud)         │
         └──────────────────────────┘              └───────────────────────────┘
```

## Data Model

### Entity-Relationship Overview

```
┌──────────────┐
│     jobs     │──────┬─────────────────────────────────────────────┐
└──────┬───────┘      │                                             │
       │              │                                             │
       │              │                                             │
       │              │                                             │
       │              │                                             │
       │              │                                             │
       ▼              ▼                                             ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ extractions  │ │   failures   │ │ not_configured   │ │    snapshots     │
└──────┬───────┘ └──────────────┘ └──────────────────┘ └─────────┬────────┘
       │                                                           │
       ▼                                                           ▼
┌─────────────────────┐                              ┌────────────────────────┐
│ validation_results  │                              │   snapshot_regions     │
└─────────────────────┘                              └────────────────────────┘
```

### Table Purposes

**jobs** - Orchestration lifecycle tracking
- Tracks batch extraction jobs from creation through completion
- Progress metrics enable monitoring and resumption
- Status field supports state machine transitions

**extractions** - Successful boundary retrievals
- One row per successfully extracted (state, layer) combination
- Links to validation results for quality assurance
- Records source portal metadata for provenance

**failures** - Failed extraction attempts
- Retry tracking with exponential backoff metadata
- Full error context for debugging and alerting
- Distinguishes retryable (transient) from permanent failures

**not_configured** - Registry gaps
- Documents states/layers missing from portal registry
- Drives registry improvement and coverage expansion
- Tracks resolution when portals added

**snapshots** - Merkle tree commits
- Immutable cryptographic commitments to validated boundaries
- IPFS content addressing for decentralized retrieval
- Version tracking with deprecation for upgrades

**validation_results** - Cross-validation outcomes
- Links extractions to authoritative sources (TIGER, official counts)
- Captures discrepancies for manual investigation
- Supports multiple validator types (geometric, count-based, etc.)

**snapshot_regions** - Many-to-many region coverage
- Normalized tracking of which states each snapshot covers
- Enables efficient "latest snapshot for state" queries
- Supports incremental snapshot updates

## Control Flow

### Job Lifecycle State Machine

```
┌─────────┐
│ pending │
└────┬────┘
     │ start()
     ▼
┌─────────┐     ┌─────────┐
│ running │────▶│  failed │ (all tasks failed)
└────┬────┘     └─────────┘
     │
     ├──────▶ partial  (some tasks failed)
     │
     └──────▶ completed (all tasks succeeded)
```

### Extraction Recording Flow

```
1. Job created (status: pending)
   ↓
2. Job started (status: running)
   ↓
3. For each (state, layer):
   ┌─────────────────────────────────────────┐
   │                                         │
   │  ┌──────────────┐                      │
   │  │ Extract data │                      │
   │  └──────┬───────┘                      │
   │         │                               │
   │         ▼                               │
   │  ┌──────────────┐                      │
   │  │ Validate     │                      │
   │  └──────┬───────┘                      │
   │         │                               │
   │    ┌────┴────┐                         │
   │    ▼         ▼                         │
   │ Success   Failure                      │
   │    │         │                         │
   │    ▼         ▼                         │
   │  Create   Create                       │
   │  extraction failure                    │
   │    │         │                         │
   │    ▼         ▼                         │
   │  Increment  Increment                  │
   │  completed  failed                     │
   │    │         │                         │
   └────┼─────────┼─────────────────────────┘
        │         │
        └─────┬───┘
              ▼
4. Job completes (status: completed/partial/failed)
   ↓
5. Create snapshot (if sufficient coverage)
   ↓
6. Publish snapshot to IPFS
```

### Retry Logic Flow

```
1. Extraction fails (HTTP 503, timeout, etc.)
   ↓
2. Determine if retryable
   ┌─────────────┬──────────────┐
   │ Retryable   │ Not Retryable│
   │ (transient) │ (permanent)  │
   └──────┬──────┴──────┬───────┘
          │             │
          ▼             ▼
   Calculate        Record failure
   retry_after      (no retry)
   (exp backoff)
          │
          ▼
   Record failure
   with retry_after
          │
          ▼
   Wait for retry_after
          │
          ▼
   Retry extraction
          │
     ┌────┴────┐
     ▼         ▼
   Success   Failed again
     │         │
     ▼         ▼
   Update    Increment
   retry_    attempt_count
   succeeded
```

## Type Safety Architecture

### Branded ID System

**Problem:** String IDs are interchangeable at compile time
```typescript
// ❌ This compiles but is logically wrong
const extractionId: string = "job_123";
await getExtraction(extractionId); // Wrong entity type!
```

**Solution:** Branded types prevent ID confusion
```typescript
// ✅ Compile-time error prevents bugs
const jobId: JobId = "job_123" as JobId;
await getExtraction(jobId); // Type error: Expected ExtractionId, got JobId
```

### Implementation

```typescript
// Unique symbol ensures brands don't overlap
declare const JobIdBrand: unique symbol;
export type JobId = string & { readonly [JobIdBrand]: typeof JobIdBrand };

// Type guard for runtime validation
export function isJobId(value: string): value is JobId {
  return typeof value === 'string' && value.length > 0;
}
```

### ISO8601 Timestamp Strategy

**Problem:** JavaScript Date objects serialize inconsistently across databases
- SQLite uses julianday (float days since 4714 BC)
- PostgreSQL uses timestamp (microseconds since 2000-01-01)

**Solution:** Store ISO8601 strings everywhere
```typescript
export type ISO8601Timestamp = string; // "2025-12-17T10:30:00.000Z"

// Convert when inserting
const now: ISO8601Timestamp = new Date().toISOString();

// Convert when consuming
const date: Date = new Date(row.created_at);
```

**Benefits:**
- Works identically on SQLite and PostgreSQL
- Human-readable in database queries
- JSON-serializable without conversion
- Timezone information preserved (UTC)

## Query Optimization

### Index Strategy

**Principle:** Index the WHERE clause, optimize the ORDER BY

```sql
-- Pattern: List recent jobs by status
CREATE INDEX idx_jobs_status_created
  ON jobs(status, created_at DESC)
  WHERE archived_at IS NULL;

-- Enables efficient query:
SELECT * FROM jobs
WHERE status = 'running'       -- Uses index (status)
  AND archived_at IS NULL      -- Filtered by partial index
ORDER BY created_at DESC       -- Uses index (created_at)
LIMIT 100;
```

### Partial Indexes

**Principle:** Index only live data, exclude archived

```sql
-- Index only non-archived rows
CREATE INDEX idx_extractions_region
  ON extractions(state_code, layer_type, completed_at DESC)
  WHERE archived_at IS NULL;
```

**Benefits:**
- Smaller index size (lower memory usage)
- Faster writes (fewer index updates)
- Faster queries (smaller index scan)

### View Performance

Views are not materialized - they're query macros:

```sql
-- This view definition:
CREATE VIEW v_job_summary AS
SELECT j.id, COUNT(e.id) AS extraction_count
FROM jobs j
LEFT JOIN extractions e ON e.job_id = j.id
GROUP BY j.id;

-- Expands to this query when used:
SELECT * FROM v_job_summary WHERE id = ?;
-- Becomes:
SELECT j.id, COUNT(e.id)
FROM jobs j
LEFT JOIN extractions e ON e.job_id = j.id
WHERE j.id = ?
GROUP BY j.id;
```

**Optimization:** Use specific WHERE clauses when querying views

```typescript
// ❌ Slow - scans all jobs
const summaries = await db.query('SELECT * FROM v_job_summary');

// ✅ Fast - uses index
const summary = await db.query('SELECT * FROM v_job_summary WHERE id = ?', [jobId]);
```

## Transaction Isolation

### Nested Transaction Support

Both adapters support nested transactions via savepoints:

```typescript
await db.transaction(async () => {
  // Outer transaction: BEGIN

  await createJob({ ... });

  await db.transaction(async () => {
    // Inner transaction: SAVEPOINT sp_1

    await createExtraction({ ... });

    if (error) {
      throw new Error(); // ROLLBACK TO sp_1 (extraction rolled back)
    }

    // RELEASE sp_1 (extraction committed to outer transaction)
  });

  // COMMIT (both job and extraction committed)
});
```

### Isolation Levels

**SQLite:**
- Default: SERIALIZABLE (strictest)
- WAL mode enables concurrent readers
- Only one writer at a time

**PostgreSQL:**
- Default: READ COMMITTED
- Configurable per transaction
- MVCC enables concurrent writes

## Cloud Migration Path

### Development → Production

```
┌──────────────────────────────────────────────────────────────────┐
│                        Development                                │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ SQLite (.shadow-atlas/persistence.db)                     │   │
│  │ - Single file                                             │   │
│  │ - Zero configuration                                      │   │
│  │ - Perfect for local development                           │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
                                 │
                                 │ Deploy to production
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                        Production                                 │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ PostgreSQL (Managed Cloud: RDS, Cloud SQL, etc.)         │   │
│  │ - Automatic backups                                       │   │
│  │ - High availability                                       │   │
│  │ - Scalable storage                                        │   │
│  │ - Monitoring built-in                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
                                 │
                                 │ Export for analytics
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Analytics Warehouse                          │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ BigQuery / Snowflake / Redshift                           │   │
│  │ - Long-term historical analysis                           │   │
│  │ - Cross-dataset joins                                     │   │
│  │ - BI tool integration                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### Configuration Pattern

```typescript
// config.ts
export function createDatabaseAdapter(): DatabaseAdapter {
  if (process.env.NODE_ENV === 'production') {
    return new PostgreSQLAdapter({
      host: process.env.DB_HOST,
      database: 'shadow_atlas',
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: { rejectUnauthorized: true },
    });
  } else {
    return new SQLiteAdapter('.shadow-atlas/persistence.db');
  }
}
```

**No code changes required** - same schema works everywhere.

## Security Considerations

### No PII in Database

This schema stores **zero personally identifiable information**:
- ✅ State codes (public data)
- ✅ Layer types (categorical data)
- ✅ Boundary counts (aggregate statistics)
- ✅ Error messages (technical context)
- ❌ User addresses (stay in ZK circuits)
- ❌ User identities (handled separately)

### SQL Injection Prevention

**Always use parameterized queries:**

```typescript
// ❌ VULNERABLE to SQL injection
const jobs = await db.query(
  `SELECT * FROM jobs WHERE status = '${userInput}'`
);

// ✅ SAFE - parameters escaped automatically
const jobs = await db.query(
  'SELECT * FROM jobs WHERE status = ?',
  [userInput]
);
```

### Access Control (PostgreSQL)

```sql
-- Read-only role for analytics
CREATE ROLE shadow_atlas_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO shadow_atlas_reader;

-- Application role (no DELETE - soft deletes use UPDATE)
CREATE ROLE shadow_atlas_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO shadow_atlas_app;

-- Admin role for migrations
CREATE ROLE shadow_atlas_admin;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO shadow_atlas_admin;
```

## Disaster Recovery

### Backup Strategy

**SQLite:**
```typescript
// Online backup (doesn't lock database)
await adapter.backup('.shadow-atlas/backups/persistence-20251217.db');
```

**PostgreSQL:**
```bash
# Automated backups via managed service
# Manual backup:
pg_dump -h $DB_HOST -U $DB_USER shadow_atlas > backup.sql
```

### Point-in-Time Recovery

**SQLite:**
- WAL mode enables incremental backups
- Combine base backup + WAL files for PITR

**PostgreSQL:**
- Managed services provide automated PITR
- Can restore to any second within retention window

### Restore Procedure

```typescript
async function restoreFromBackup(
  backupPath: string,
  targetPath: string
): Promise<void> {
  // SQLite: Simple file copy
  await fs.copyFile(backupPath, targetPath);

  // PostgreSQL: pg_restore
  // Handled by managed service UI or CLI
}
```

## Monitoring & Observability

### Key Metrics

```typescript
interface DatabaseMetrics {
  // Performance
  queryLatencyP95: number;         // 95th percentile query time
  transactionDuration: number;     // Average transaction time
  connectionPoolUtilization: number; // % of pool in use

  // Growth
  databaseSizeBytes: number;       // Total database size
  tableRowCounts: Record<string, number>; // Rows per table
  indexSizeBytes: number;          // Index overhead

  // Health
  activeConnections: number;       // Current active connections
  longRunningQueries: number;      // Queries >1s
  deadlockCount: number;           // Deadlocks detected
}
```

### Health Check

```typescript
async function healthCheck(adapter: DatabaseAdapter): Promise<boolean> {
  try {
    await adapter.queryOne('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
```

### Logging

```typescript
class InstrumentedRepository extends ShadowAtlasRepository {
  async getJob(id: JobId): Promise<JobRow | null> {
    const start = performance.now();
    try {
      const result = await super.getJob(id);
      const duration = performance.now() - start;

      logger.info('query.get_job', { jobId: id, duration, found: !!result });

      return result;
    } catch (error) {
      logger.error('query.get_job.error', { jobId: id, error });
      throw error;
    }
  }
}
```

## Future Enhancements

### Event Sourcing

Add complete audit trail via event log:

```sql
CREATE TABLE job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  event_type TEXT NOT NULL, -- 'created', 'started', 'completed', etc.
  payload TEXT NOT NULL,    -- JSON event data
  created_at TEXT NOT NULL,
  created_by TEXT           -- User/system that triggered event
);
```

### Read Replicas

Scale read operations with PostgreSQL replication:

```typescript
class RepositoryWithReplicas {
  constructor(
    private readonly primary: DatabaseAdapter,  // Write operations
    private readonly replicas: DatabaseAdapter[] // Read operations
  ) {}

  async getJob(id: JobId): Promise<JobRow | null> {
    const replica = this.replicas[Math.floor(Math.random() * this.replicas.length)];
    return replica.queryOne('SELECT * FROM jobs WHERE id = ?', [id]);
  }

  async createJob(insert: JobInsert): Promise<JobRow> {
    // Writes always go to primary
    return this.primary.queryOne('INSERT INTO jobs ...', [...]);
  }
}
```

### Partitioning (PostgreSQL)

For massive scale, partition by time:

```sql
CREATE TABLE jobs (
  ...
) PARTITION BY RANGE (created_at);

CREATE TABLE jobs_2025_q1 PARTITION OF jobs
  FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');

CREATE TABLE jobs_2025_q2 PARTITION OF jobs
  FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
```

**Benefits:**
- Faster queries (scan only relevant partition)
- Easier archival (drop old partitions)
- Parallel query execution

## Resources

- **Schema Definition:** `schema.sql`
- **Type Definitions:** `schema.types.ts`
- **Repository Implementation:** `repository.ts`
- **SQLite Adapter:** `adapters/sqlite.ts`
- **PostgreSQL Adapter:** `adapters/postgresql.ts`
- **Usage Examples:** `examples/basic-usage.ts`
- **Test Suite:** `repository.test.ts`
- **Migration Guide:** `MIGRATION_GUIDE.md`
