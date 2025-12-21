# Shadow Atlas Persistence Quick Reference

Fast lookup for common operations. See full documentation in other files.

## Setup

### Development (SQLite)

```typescript
import { createSQLiteAdapter } from './persistence/adapters/sqlite';
import { ShadowAtlasRepository } from './persistence/repository';
import fs from 'node:fs/promises';

const schemaSQL = await fs.readFile('./persistence/schema.sql', 'utf-8');
const adapter = await createSQLiteAdapter('.shadow-atlas/db.sqlite', schemaSQL);
const repo = new ShadowAtlasRepository(adapter);
```

### Production (PostgreSQL)

```typescript
import { createPostgreSQLAdapter } from './persistence/adapters/postgresql';

const adapter = await createPostgreSQLAdapter(
  {
    host: process.env.DB_HOST,
    database: 'shadow_atlas',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: true },
  },
  schemaSQL
);
const repo = new ShadowAtlasRepository(adapter);
```

## Common Operations

### Create Job

```typescript
import { ulid } from 'ulid';
import type { JobId } from './persistence/schema.types';
import { nowISO8601 } from './persistence/schema.types';

const jobId = ulid() as JobId;
const job = await repo.createJob({
  id: jobId,
  scope_states: JSON.stringify(['US-CA', 'US-TX']),
  scope_layers: JSON.stringify(['congressional', 'state_senate']),
  status: 'pending',
  created_at: nowISO8601(),
  updated_at: nowISO8601(),
  total_tasks: 4, // 2 states × 2 layers
});
```

### Start Job

```typescript
await repo.updateJob(jobId, {
  status: 'running',
  started_at: nowISO8601(),
  updated_at: nowISO8601(),
});
```

### Record Successful Extraction

```typescript
const extraction = await repo.createExtraction({
  id: ulid() as any,
  job_id: jobId,
  state_code: 'US-CA',
  layer_type: 'congressional',
  boundary_count: 52,
  validation_passed: true,
  source_url: 'https://gis.data.ca.gov/congressional',
  source_type: 'arcgis',
  completed_at: nowISO8601(),
});

await repo.incrementJobProgress(jobId, 'completed_tasks');
```

### Record Extraction with Validations (Atomic)

```typescript
const { extraction, validations } = await repo.createValidatedExtraction(
  {
    id: ulid() as any,
    job_id: jobId,
    state_code: 'US-CA',
    layer_type: 'congressional',
    boundary_count: 52,
    validation_passed: true,
    completed_at: nowISO8601(),
  },
  [
    {
      id: ulid() as any,
      extraction_id: extractionId,
      validator_type: 'tiger_census',
      passed: true,
      expected_count: 52,
      actual_count: 52,
      authority_source: 'https://www2.census.gov/geo/tiger/',
      authority_version: '2023',
      validated_at: nowISO8601(),
    },
  ]
);
```

### Record Failure

```typescript
const failure = await repo.createFailure({
  id: ulid() as any,
  job_id: jobId,
  state_code: 'US-TX',
  layer_type: 'congressional',
  error_message: 'HTTP 503: Service unavailable',
  error_stack: error.stack,
  attempt_count: 1,
  retryable: true,
  failed_at: nowISO8601(),
  retry_after: new Date(Date.now() + 60000).toISOString(), // 1 min
});

await repo.incrementJobProgress(jobId, 'failed_tasks');
```

### Retry Failed Extraction

```typescript
// Get retryable failures
const failures = await repo.listRetryableFailures(jobId);

for (const failure of failures) {
  try {
    // Attempt extraction again
    const result = await extractBoundaries(failure.state_code, failure.layer_type);

    // Mark retry successful
    await repo.updateFailure(failure.id, {
      retried_at: nowISO8601(),
      retry_succeeded: true,
    });

    // Record successful extraction
    await repo.createExtraction({
      id: ulid() as any,
      job_id: jobId,
      state_code: failure.state_code,
      layer_type: failure.layer_type,
      boundary_count: result.boundaries.length,
      validation_passed: true,
      completed_at: nowISO8601(),
    });
  } catch (error) {
    // Mark retry failed, increment attempt count
    await repo.updateFailure(failure.id, {
      retried_at: nowISO8601(),
      retry_succeeded: false,
    });

    // Create new failure record with incremented attempt count
    await repo.createFailure({
      id: ulid() as any,
      job_id: jobId,
      state_code: failure.state_code,
      layer_type: failure.layer_type,
      error_message: error.message,
      attempt_count: failure.attempt_count + 1,
      retryable: failure.attempt_count < 3, // Max 3 attempts
      failed_at: nowISO8601(),
    });
  }
}
```

### Record Registry Gap

```typescript
await repo.createNotConfigured({
  id: ulid() as any,
  job_id: jobId,
  state_code: 'US-FL',
  layer_type: 'state_senate',
  reason: 'layer_not_configured',
  checked_at: nowISO8601(),
});

await repo.incrementJobProgress(jobId, 'skipped_tasks');
```

### Complete Job

```typescript
await repo.updateJob(jobId, {
  status: 'completed',
  completed_at: nowISO8601(),
  updated_at: nowISO8601(),
});
```

### Create Snapshot

```typescript
const snapshot = await repo.createSnapshot(
  {
    id: ulid() as any,
    job_id: jobId,
    merkle_root: '0x1234...abcd',
    ipfs_cid: 'bafybei...',
    boundary_count: 138,
    regions: JSON.stringify(['US-CA', 'US-TX', 'US-NY']),
    created_at: nowISO8601(),
  },
  ['US-CA', 'US-TX', 'US-NY'] // Region associations
);
```

## Common Queries

### Get Job Status

```typescript
const job = await repo.getJob(jobId);
if (job) {
  console.log('Status:', job.status);
  console.log('Progress:', job.completed_tasks, '/', job.total_tasks);
}
```

### Get Job Summary

```typescript
const summary = await repo.getJobSummary(jobId);
if (summary) {
  console.log('Successful extractions:', summary.successful_extractions);
  console.log('Failed attempts:', summary.failed_attempts);
  console.log('Progress:', (summary.progress_ratio * 100).toFixed(1), '%');
}
```

### List Active Jobs

```typescript
const runningJobs = await repo.listJobsByStatus('running', 10);
const partialJobs = await repo.listJobsByStatus('partial', 10);
```

### Get Extraction Coverage

```typescript
const coverage = await repo.getExtractionCoverage();
for (const c of coverage) {
  console.log(
    `${c.state_code} ${c.layer_type}: ${c.total_boundaries} boundaries`
  );
}
```

### Get Registry Gaps

```typescript
const gaps = await repo.getRegistryGaps();
for (const gap of gaps) {
  console.log(
    `Missing: ${gap.state_code} ${gap.layer_type} (${gap.reason})`
  );
}
```

### Find Latest Snapshot for State

```typescript
const snapshot = await repo.getLatestSnapshotForState('US-CA');
if (snapshot) {
  console.log('Merkle root:', snapshot.merkle_root);
  console.log('IPFS CID:', snapshot.ipfs_cid);
}
```

### Verify Snapshot by Merkle Root

```typescript
const snapshot = await repo.getSnapshotByMerkleRoot(merkleRootFromZKProof);
if (snapshot) {
  console.log('Valid snapshot found');
  console.log('Boundary count:', snapshot.boundary_count);
}
```

## Type Helpers

### Parse Job Scope

```typescript
import { parseJobScope } from './persistence/schema.types';

const job = await repo.getJob(jobId);
if (job) {
  const scope = parseJobScope(job);
  console.log('States:', scope.states);
  console.log('Layers:', scope.layers);
}
```

### Parse Snapshot Regions

```typescript
import { parseSnapshotRegions } from './persistence/schema.types';

const snapshot = await repo.getSnapshot(snapshotId);
if (snapshot) {
  const regions = parseSnapshotRegions(snapshot);
  console.log('Covered states:', regions);
}
```

### Parse Validation Discrepancies

```typescript
import { parseValidationDiscrepancies } from './persistence/schema.types';

const validations = await repo.listValidationResultsByExtraction(extractionId);
for (const v of validations) {
  if (!v.passed) {
    const discrepancies = parseValidationDiscrepancies(v);
    for (const d of discrepancies) {
      console.log(`${d.field}: expected ${d.expected}, got ${d.actual}`);
    }
  }
}
```

### Timestamp Conversion

```typescript
import { toISO8601, fromISO8601, nowISO8601 } from './persistence/schema.types';

// Current timestamp
const now = nowISO8601(); // "2025-12-17T10:30:00.000Z"

// Convert Date to ISO8601
const timestamp = toISO8601(new Date());

// Convert ISO8601 to Date
const date = fromISO8601(job.created_at);
```

## Error Handling

### Handle Foreign Key Violations

```typescript
try {
  await repo.createExtraction({
    id: ulid() as any,
    job_id: 'nonexistent' as JobId,
    state_code: 'US-CA',
    layer_type: 'congressional',
    boundary_count: 52,
    validation_passed: true,
    completed_at: nowISO8601(),
  });
} catch (error) {
  if (error.message.includes('FOREIGN KEY')) {
    console.error('Job does not exist');
  }
}
```

### Handle Unique Constraint Violations

```typescript
try {
  // Attempt duplicate extraction
  await repo.createExtraction({
    id: ulid() as any,
    job_id: jobId,
    state_code: 'US-CA',
    layer_type: 'congressional',
    boundary_count: 52,
    validation_passed: true,
    completed_at: nowISO8601(),
  });
} catch (error) {
  if (error.message.includes('UNIQUE')) {
    console.error('Extraction already exists for this job/state/layer');
  }
}
```

## Transactions

### Manual Transaction

```typescript
await adapter.transaction(async () => {
  // Create extraction
  const extraction = await repo.createExtraction({
    id: ulid() as any,
    job_id: jobId,
    state_code: 'US-CA',
    layer_type: 'congressional',
    boundary_count: 52,
    validation_passed: true,
    completed_at: nowISO8601(),
  });

  // Create validations
  await repo.createValidationResult({
    id: ulid() as any,
    extraction_id: extraction.id,
    validator_type: 'tiger_census',
    passed: true,
    validated_at: nowISO8601(),
  });

  // Update job progress
  await repo.incrementJobProgress(jobId, 'completed_tasks');

  // All committed together, or all rolled back on error
});
```

## Maintenance

### Database Stats (SQLite)

```typescript
const stats = await (adapter as SQLiteAdapter).getStats();
console.log('Database size:', stats.pageCount * stats.pageSize, 'bytes');
console.log('WAL size:', stats.walSizeBytes, 'bytes');
```

### Database Stats (PostgreSQL)

```typescript
const stats = await (adapter as PostgreSQLAdapter).getStats();
console.log('Database size:', stats.databaseSize);
console.log('Active connections:', stats.activeConnections);
```

### Optimize Database

```typescript
// SQLite: PRAGMA optimize + WAL checkpoint
await (adapter as SQLiteAdapter).optimize();

// PostgreSQL: VACUUM ANALYZE
await (adapter as PostgreSQLAdapter).optimize();
```

### Backup Database

```typescript
// SQLite: Online backup
await (adapter as SQLiteAdapter).backup('.shadow-atlas/backup.db');

// PostgreSQL: pg_dump
await (adapter as PostgreSQLAdapter).backup('./backup.sql');
```

## Testing

### In-Memory Database for Tests

```typescript
import { describe, it, expect } from 'vitest';

describe('My feature', () => {
  it('works correctly', async () => {
    // In-memory database - no files created
    const adapter = new SQLiteAdapter(':memory:');
    await adapter.initializeSchema(schemaSQL);
    const repo = new ShadowAtlasRepository(adapter);

    // Test logic...

    await adapter.close();
  });
});
```

## Migration

See `MIGRATION_GUIDE.md` for complete migration instructions.

### Quick Migration Check

```typescript
// Check if job exists in new system
const job = await repo.getJob(jobId);
if (!job) {
  console.log('Job not yet migrated:', jobId);
  // Trigger backfill...
}
```

## Performance Tips

1. **Use batch operations when possible**
   ```typescript
   // ❌ Slow - N queries
   for (const extraction of extractions) {
     await repo.createExtraction(extraction);
   }

   // ✅ Fast - 1 transaction
   await adapter.transaction(async () => {
     for (const extraction of extractions) {
       await repo.createExtraction(extraction);
     }
   });
   ```

2. **Query views with WHERE clauses**
   ```typescript
   // ❌ Slow - scans all jobs
   const summaries = await db.queryMany('SELECT * FROM v_job_summary');

   // ✅ Fast - uses index
   const summary = await repo.getJobSummary(jobId);
   ```

3. **Use incremental updates**
   ```typescript
   // ✅ Atomic increment
   await repo.incrementJobProgress(jobId, 'completed_tasks');

   // ❌ Race-prone read-modify-write
   const job = await repo.getJob(jobId);
   await repo.updateJob(jobId, {
     completed_tasks: job.completed_tasks + 1,
     updated_at: nowISO8601(),
   });
   ```

## Troubleshooting

### "FOREIGN KEY constraint failed"
- Ensure referenced entity exists before creating dependent entity
- Example: Job must exist before creating extraction

### "UNIQUE constraint failed"
- Attempting to create duplicate record
- Check `UNIQUE` constraints in schema.sql
- Example: Cannot create two extractions for same (job_id, state_code, layer_type)

### Slow queries
- Run `EXPLAIN ANALYZE` to check index usage
- Verify indexes created correctly
- Consider adding `WHERE archived_at IS NULL` to leverage partial indexes

### Transaction deadlocks (PostgreSQL)
- Keep transactions short
- Acquire locks in consistent order
- Use `SELECT ... FOR UPDATE NOWAIT` to fail fast

## Resources

- **Full Schema:** `schema.sql`
- **Type Definitions:** `schema.types.ts`
- **Repository API:** `repository.ts`
- **Usage Examples:** `examples/basic-usage.ts`
- **Test Suite:** `repository.test.ts`
- **Architecture:** `ARCHITECTURE.md`
- **Migration Guide:** `MIGRATION_GUIDE.md`
- **README:** `README.md`
