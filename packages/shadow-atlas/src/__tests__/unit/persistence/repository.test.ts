/**
 * Shadow Atlas Repository Tests
 *
 * Comprehensive test suite for database operations.
 * Tests run against in-memory SQLite for speed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { ShadowAtlasRepository } from '../../../persistence/repository';
import { SQLiteAdapter } from '../../../persistence/adapters/sqlite';
import type {
  JobId,
  JobInsert,
  ExtractionInsert,
  FailureInsert,
  NotConfiguredInsert,
  SnapshotInsert,
  ValidationResultInsert,
} from '../../../persistence/schema.types';
import { nowISO8601, parseJobScope, parseSnapshotRegions } from '../../../persistence/schema.types';
import fs from 'node:fs/promises';
import path from 'node:path';

// Helper to generate IDs (similar to sqlite-adapter)
function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(4).toString('hex');
  return `${prefix}-${timestamp}-${random}`;
}

// Test fixture helpers
async function createTestRepository(): Promise<{
  repo: ShadowAtlasRepository;
  adapter: SQLiteAdapter;
}> {
  const schemaSQL = await fs.readFile(
    path.join(__dirname, '../../../persistence/schema.sql'),
    'utf-8'
  );
  const adapter = new SQLiteAdapter(':memory:');
  await adapter.initializeSchema(schemaSQL);
  const repo = new ShadowAtlasRepository(adapter);

  return { repo, adapter };
}

function createTestJob(overrides: Partial<JobInsert> = {}): JobInsert {
  const now = nowISO8601();
  return {
    id: generateId('job') as JobId,
    scope_states: JSON.stringify(['US-CA']),
    scope_layers: JSON.stringify(['congressional']),
    status: 'pending',
    created_at: now,
    updated_at: now,
    total_tasks: 1,
    ...overrides,
  };
}

describe('ShadowAtlasRepository - Jobs', () => {
  it('creates job with correct defaults', async () => {
    const { repo, adapter } = await createTestRepository();

    const insert = createTestJob();
    const job = await repo.createJob(insert);

    expect(job.id).toBe(insert.id);
    expect(job.status).toBe('pending');
    expect(job.completed_tasks).toBe(0);
    expect(job.failed_tasks).toBe(0);
    expect(job.skipped_tasks).toBe(0);
    expect(job.started_at).toBeNull();
    expect(job.completed_at).toBeNull();
    expect(job.archived_at).toBeNull();

    await adapter.close();
  });

  it('retrieves job by ID', async () => {
    const { repo, adapter } = await createTestRepository();

    const insert = createTestJob();
    await repo.createJob(insert);

    const retrieved = await repo.getJob(insert.id);

    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(insert.id);

    await adapter.close();
  });

  it('updates job status and timestamps', async () => {
    const { repo, adapter } = await createTestRepository();

    const insert = createTestJob();
    await repo.createJob(insert);

    const startTime = nowISO8601();
    const updated = await repo.updateJob(insert.id, {
      status: 'running',
      started_at: startTime,
      updated_at: startTime,
    });

    expect(updated.status).toBe('running');
    expect(updated.started_at).toBe(startTime);
    expect(updated.updated_at).toBe(startTime);

    await adapter.close();
  });

  it('increments progress counters atomically', async () => {
    const { repo, adapter } = await createTestRepository();

    const insert = createTestJob({ total_tasks: 10 });
    await repo.createJob(insert);

    await repo.incrementJobProgress(insert.id, 'completed_tasks');
    await repo.incrementJobProgress(insert.id, 'completed_tasks');
    await repo.incrementJobProgress(insert.id, 'failed_tasks');

    const job = await repo.getJob(insert.id);
    expect(job?.completed_tasks).toBe(2);
    expect(job?.failed_tasks).toBe(1);
    expect(job?.skipped_tasks).toBe(0);

    await adapter.close();
  });

  it('lists jobs by status', async () => {
    const { repo, adapter } = await createTestRepository();

    await repo.createJob(createTestJob({ status: 'pending' }));
    await repo.createJob(createTestJob({ status: 'running' }));
    await repo.createJob(createTestJob({ status: 'running' }));
    await repo.createJob(createTestJob({ status: 'completed' }));

    const runningJobs = await repo.listJobsByStatus('running');
    expect(runningJobs).toHaveLength(2);
    expect(runningJobs.every((j) => j.status === 'running')).toBe(true);

    await adapter.close();
  });

  it('archives job (soft delete)', async () => {
    const { repo, adapter } = await createTestRepository();

    const insert = createTestJob();
    await repo.createJob(insert);

    await repo.archiveJob(insert.id);

    const archived = await repo.getJob(insert.id);
    expect(archived).toBeNull(); // Excluded by archived_at IS NULL filter

    await adapter.close();
  });

  it('parses job scope correctly', async () => {
    const { repo, adapter } = await createTestRepository();

    const insert = createTestJob({
      scope_states: JSON.stringify(['US-CA', 'US-TX', 'US-NY']),
      scope_layers: JSON.stringify(['congressional', 'state_senate']),
    });
    const job = await repo.createJob(insert);

    const scope = parseJobScope(job);
    expect(scope.states).toEqual(['US-CA', 'US-TX', 'US-NY']);
    expect(scope.layers).toEqual(['congressional', 'state_senate']);

    await adapter.close();
  });
});

describe('ShadowAtlasRepository - Extractions', () => {
  it('creates extraction linked to job', async () => {
    const { repo, adapter } = await createTestRepository();

    const job = await repo.createJob(createTestJob());

    const extractionInsert: ExtractionInsert = {
      id: generateId("test") as any,
      job_id: job.id,
      state_code: 'US-CA',
      layer_type: 'congressional',
      boundary_count: 52,
      validation_passed: true,
      completed_at: nowISO8601(),
    };

    const extraction = await repo.createExtraction(extractionInsert);

    expect(extraction.job_id).toBe(job.id);
    expect(extraction.boundary_count).toBe(52);
    expect(extraction.validation_passed).toBe(true);

    await adapter.close();
  });

  it('enforces unique extraction per (job, state, layer)', async () => {
    const { repo, adapter } = await createTestRepository();

    const job = await repo.createJob(createTestJob());

    const extractionInsert: ExtractionInsert = {
      id: generateId("test") as any,
      job_id: job.id,
      state_code: 'US-CA',
      layer_type: 'congressional',
      boundary_count: 52,
      validation_passed: true,
      completed_at: nowISO8601(),
    };

    await repo.createExtraction(extractionInsert);

    // Attempt duplicate
    const duplicate: ExtractionInsert = {
      ...extractionInsert,
      id: generateId("test") as any, // Different ID
    };

    await expect(repo.createExtraction(duplicate)).rejects.toThrow();

    await adapter.close();
  });

  it('lists extractions by job', async () => {
    const { repo, adapter } = await createTestRepository();

    const job = await repo.createJob(createTestJob());

    await repo.createExtraction({
      id: generateId("test") as any,
      job_id: job.id,
      state_code: 'US-CA',
      layer_type: 'congressional',
      boundary_count: 52,
      validation_passed: true,
      completed_at: nowISO8601(),
    });

    await repo.createExtraction({
      id: generateId("test") as any,
      job_id: job.id,
      state_code: 'US-TX',
      layer_type: 'congressional',
      boundary_count: 38,
      validation_passed: true,
      completed_at: nowISO8601(),
    });

    const extractions = await repo.listExtractionsByJob(job.id);
    expect(extractions).toHaveLength(2);

    await adapter.close();
  });

  it('queries extraction coverage view', async () => {
    const { repo, adapter } = await createTestRepository();

    const job = await repo.createJob(createTestJob());

    await repo.createExtraction({
      id: generateId("test") as any,
      job_id: job.id,
      state_code: 'US-CA',
      layer_type: 'congressional',
      boundary_count: 52,
      validation_passed: true,
      completed_at: nowISO8601(),
    });

    await repo.createExtraction({
      id: generateId("test") as any,
      job_id: job.id,
      state_code: 'US-CA',
      layer_type: 'state_senate',
      boundary_count: 40,
      validation_passed: true,
      completed_at: nowISO8601(),
    });

    const coverage = await repo.getExtractionCoverage();
    const caCoverage = coverage.filter((c) => c.state_code === 'US-CA');

    expect(caCoverage).toHaveLength(2);
    expect(caCoverage.find((c) => c.layer_type === 'congressional')?.total_boundaries).toBe(52);
    expect(caCoverage.find((c) => c.layer_type === 'state_senate')?.total_boundaries).toBe(40);

    await adapter.close();
  });
});

describe('ShadowAtlasRepository - Failures', () => {
  it('records failure with retry metadata', async () => {
    const { repo, adapter } = await createTestRepository();

    const job = await repo.createJob(createTestJob());

    const failureInsert: FailureInsert = {
      id: generateId("test") as any,
      job_id: job.id,
      state_code: 'US-TX',
      layer_type: 'congressional',
      error_message: 'HTTP 503: Service unavailable',
      attempt_count: 1,
      retryable: true,
      failed_at: nowISO8601(),
      retry_after: new Date(Date.now() + 60000).toISOString(),
    };

    const failure = await repo.createFailure(failureInsert);

    expect(failure.retryable).toBe(true);
    expect(failure.retry_after).not.toBeNull();
    expect(failure.retried_at).toBeNull();

    await adapter.close();
  });

  it('updates failure after retry attempt', async () => {
    const { repo, adapter } = await createTestRepository();

    const job = await repo.createJob(createTestJob());

    const failure = await repo.createFailure({
      id: generateId("test") as any,
      job_id: job.id,
      state_code: 'US-TX',
      layer_type: 'congressional',
      error_message: 'Timeout',
      retryable: true,
      failed_at: nowISO8601(),
    });

    const updated = await repo.updateFailure(failure.id, {
      retried_at: nowISO8601(),
      retry_succeeded: true,
    });

    expect(updated.retried_at).not.toBeNull();
    expect(updated.retry_succeeded).toBe(true);

    await adapter.close();
  });

  it('lists only retryable failures not yet retried', async () => {
    const { repo, adapter } = await createTestRepository();

    const job = await repo.createJob(createTestJob());

    // Retryable, not yet retried
    await repo.createFailure({
      id: generateId("test") as any,
      job_id: job.id,
      state_code: 'US-CA',
      layer_type: 'congressional',
      error_message: 'Timeout',
      retryable: true,
      failed_at: nowISO8601(),
    });

    // Not retryable
    await repo.createFailure({
      id: generateId("test") as any,
      job_id: job.id,
      state_code: 'US-TX',
      layer_type: 'congressional',
      error_message: 'Invalid credentials',
      retryable: false,
      failed_at: nowISO8601(),
    });

    // Already retried
    const retried = await repo.createFailure({
      id: generateId("test") as any,
      job_id: job.id,
      state_code: 'US-NY',
      layer_type: 'congressional',
      error_message: 'Rate limited',
      retryable: true,
      failed_at: nowISO8601(),
    });
    await repo.updateFailure(retried.id, {
      retried_at: nowISO8601(),
      retry_succeeded: false,
    });

    const retryable = await repo.listRetryableFailures(job.id);
    expect(retryable).toHaveLength(1);
    expect(retryable[0]?.state_code).toBe('US-CA');

    await adapter.close();
  });
});

describe('ShadowAtlasRepository - Snapshots', () => {
  it('creates snapshot with region associations', async () => {
    const { repo, adapter } = await createTestRepository();

    const job = await repo.createJob(createTestJob());

    const snapshotInsert: SnapshotInsert = {
      id: generateId("test") as any,
      job_id: job.id,
      merkle_root: '0xabcdef1234567890',
      ipfs_cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
      boundary_count: 138,
      regions: JSON.stringify(['US-CA', 'US-TX', 'US-NY']),
      created_at: nowISO8601(),
    };

    const snapshot = await repo.createSnapshot(
      snapshotInsert,
      ['US-CA', 'US-TX', 'US-NY']
    );

    expect(snapshot.merkle_root).toBe('0xabcdef1234567890');
    expect(snapshot.boundary_count).toBe(138);

    const regions = parseSnapshotRegions(snapshot);
    expect(regions).toEqual(['US-CA', 'US-TX', 'US-NY']);

    await adapter.close();
  });

  it('retrieves snapshot by merkle root', async () => {
    const { repo, adapter } = await createTestRepository();

    const job = await repo.createJob(createTestJob());

    const merkleRoot = '0xabcdef1234567890';
    await repo.createSnapshot(
      {
        id: generateId("test") as any,
        job_id: job.id,
        merkle_root: merkleRoot,
        ipfs_cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
        boundary_count: 100,
        regions: JSON.stringify(['US-CA']),
        created_at: nowISO8601(),
      },
      ['US-CA']
    );

    const snapshot = await repo.getSnapshotByMerkleRoot(merkleRoot);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.merkle_root).toBe(merkleRoot);

    await adapter.close();
  });

  it('finds latest snapshot for state', async () => {
    const { repo, adapter } = await createTestRepository();

    const job = await repo.createJob(createTestJob());

    // Older snapshot
    await repo.createSnapshot(
      {
        id: generateId("test") as any,
        job_id: job.id,
        merkle_root: '0x1111',
        ipfs_cid: 'bafyold',
        boundary_count: 50,
        regions: JSON.stringify(['US-CA']),
        created_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
      },
      ['US-CA']
    );

    // Newer snapshot
    await repo.createSnapshot(
      {
        id: generateId("test") as any,
        job_id: job.id,
        merkle_root: '0x2222',
        ipfs_cid: 'bafynew',
        boundary_count: 52,
        regions: JSON.stringify(['US-CA', 'US-TX']),
        created_at: nowISO8601(),
      },
      ['US-CA', 'US-TX']
    );

    const latest = await repo.getLatestSnapshotForState('US-CA');
    expect(latest?.merkle_root).toBe('0x2222');

    await adapter.close();
  });

  it('deprecates snapshot', async () => {
    const { repo, adapter } = await createTestRepository();

    const job = await repo.createJob(createTestJob());

    const snapshot = await repo.createSnapshot(
      {
        id: generateId("test") as any,
        job_id: job.id,
        merkle_root: '0xabcdef',
        ipfs_cid: 'bafytest',
        boundary_count: 100,
        regions: JSON.stringify(['US-CA']),
        created_at: nowISO8601(),
      },
      ['US-CA']
    );

    await repo.deprecateSnapshot(snapshot.id);

    const deprecated = await repo.getSnapshot(snapshot.id);
    expect(deprecated?.deprecated_at).not.toBeNull();

    await adapter.close();
  });
});

describe('ShadowAtlasRepository - Validation Results', () => {
  it('creates validation result linked to extraction', async () => {
    const { repo, adapter } = await createTestRepository();

    const job = await repo.createJob(createTestJob());
    const extraction = await repo.createExtraction({
      id: generateId("test") as any,
      job_id: job.id,
      state_code: 'US-CA',
      layer_type: 'congressional',
      boundary_count: 52,
      validation_passed: true,
      completed_at: nowISO8601(),
    });

    const validationInsert: ValidationResultInsert = {
      id: generateId("test") as any,
      extraction_id: extraction.id,
      validator_type: 'tiger_census',
      passed: true,
      expected_count: 52,
      actual_count: 52,
      authority_source: 'https://www2.census.gov/geo/tiger/TIGER2023/',
      authority_version: '2023',
      validated_at: nowISO8601(),
    };

    const validation = await repo.createValidationResult(validationInsert);

    expect(validation.extraction_id).toBe(extraction.id);
    expect(validation.passed).toBe(true);
    expect(validation.validator_type).toBe('tiger_census');

    await adapter.close();
  });

  it('creates extraction with validations atomically', async () => {
    const { repo, adapter } = await createTestRepository();

    const job = await repo.createJob(createTestJob());

    const extractionInsert: ExtractionInsert = {
      id: generateId("test") as any,
      job_id: job.id,
      state_code: 'US-CA',
      layer_type: 'congressional',
      boundary_count: 52,
      validation_passed: true,
      completed_at: nowISO8601(),
    };

    const validations: ValidationResultInsert[] = [
      {
        id: generateId("test") as any,
        extraction_id: extractionInsert.id,
        validator_type: 'tiger_census',
        passed: true,
        validated_at: nowISO8601(),
      },
      {
        id: generateId("test") as any,
        extraction_id: extractionInsert.id,
        validator_type: 'official_district_count',
        passed: true,
        expected_count: 52,
        actual_count: 52,
        validated_at: nowISO8601(),
      },
    ];

    const result = await repo.createValidatedExtraction(extractionInsert, validations);

    expect(result.extraction.id).toBe(extractionInsert.id);
    expect(result.validations).toHaveLength(2);

    await adapter.close();
  });
});

describe('ShadowAtlasRepository - Transactions', () => {
  it('rolls back on error', async () => {
    const { repo, adapter } = await createTestRepository();

    const job = await repo.createJob(createTestJob());

    await expect(async () => {
      await adapter.transaction(async () => {
        // Create extraction
        await repo.createExtraction({
          id: generateId("test") as any,
          job_id: job.id,
          state_code: 'US-CA',
          layer_type: 'congressional',
          boundary_count: 52,
          validation_passed: true,
          completed_at: nowISO8601(),
        });

        // Throw error - should rollback extraction
        throw new Error('Test rollback');
      });
    }).rejects.toThrow('Test rollback');

    // Verify extraction was rolled back
    const extractions = await repo.listExtractionsByJob(job.id);
    expect(extractions).toHaveLength(0);

    await adapter.close();
  });
});
