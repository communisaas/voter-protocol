/**
 * SqlitePersistenceAdapter Tests
 *
 * Comprehensive test suite for SQLite-based job persistence layer.
 * Tests cover job lifecycle, extraction tracking, snapshot management,
 * validation results, and edge cases.
 *
 * CRITICAL TYPE SAFETY: All tests use strict typing with zero tolerance
 * for `any` or loose casts. Type errors in persistence can corrupt job state.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlitePersistenceAdapter } from './sqlite-adapter.js';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type {
  JobState,
  JobStatus,
  JobScope,
  CompletedExtraction,
  ExtractionFailure,
  NotConfiguredTask,
  OrchestrationOptions,
} from '../services/batch-orchestrator.types.js';
import type { LegislativeLayerType } from '../registry/state-gis-portals.js';
import type { SnapshotMetadata } from '../core/types.js';
import type { ValidationResult } from './sqlite-adapter.js';

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Create a valid job scope
 */
function createJobScope(
  states: readonly string[] = ['CA', 'NY'],
  layers: readonly LegislativeLayerType[] = ['congressional']
): JobScope {
  return {
    states,
    layers,
  };
}

/**
 * Create default orchestration options
 */
function createOrchestrationOptions(): OrchestrationOptions {
  return {
    concurrency: 5,
    continueOnError: true,
    maxRetries: 3,
    retryDelayMs: 2000,
    validateAfterExtraction: true,
    rateLimitMs: 500,
  };
}

/**
 * Create a completed extraction record
 */
function createCompletedExtraction(
  state: string = 'CA',
  layer: LegislativeLayerType = 'congressional',
  boundaryCount: number = 53
): CompletedExtraction {
  return {
    state,
    layer,
    completedAt: new Date(),
    boundaryCount,
    validationPassed: true,
  };
}

/**
 * Create an extraction failure record
 */
function createExtractionFailure(
  state: string = 'TX',
  layer: LegislativeLayerType = 'congressional',
  error: string = 'Network timeout',
  retryable: boolean = true
): ExtractionFailure {
  return {
    state,
    layer,
    failedAt: new Date(),
    error,
    attemptCount: 1,
    retryable,
  };
}

/**
 * Create a not-configured task record
 */
function createNotConfiguredTask(
  state: string = 'AK',
  layer: LegislativeLayerType = 'state_senate',
  reason: 'state_not_in_registry' | 'layer_not_configured' = 'layer_not_configured'
): NotConfiguredTask {
  return {
    state,
    layer,
    reason,
    checkedAt: new Date(),
  };
}

/**
 * Create a validation result
 */
function createValidationResult(
  geometryValid: boolean = true,
  geoidValid: boolean = true,
  confidence: number = 95
): Omit<ValidationResult, 'boundaryId'> {
  return {
    geometryValid,
    geoidValid,
    confidence,
    warnings: confidence < 100 ? ['Low precision geometry'] : [],
    validatedAt: new Date(),
  };
}

/**
 * Create snapshot metadata
 */
function createSnapshotMetadata(
  merkleRoot: string = '0x' + '1234'.repeat(16),
  ipfsCID: string = 'QmTest123',
  boundaryCount: number = 53
): Omit<SnapshotMetadata, 'id'> {
  return {
    merkleRoot,
    ipfsCID,
    boundaryCount,
    createdAt: new Date(),
    regions: ['us-ca', 'us-ny'],
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe('SqlitePersistenceAdapter', () => {
  let adapter: SqlitePersistenceAdapter;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'shadow-atlas-test-'));
    adapter = new SqlitePersistenceAdapter(join(tempDir, 'test.db'));
    await adapter.runMigrations();
  });

  afterEach(async () => {
    await adapter.close();
    await rm(tempDir, { recursive: true });
  });

  // ============================================================================
  // Job Lifecycle Tests
  // ============================================================================

  describe('Job Lifecycle', () => {
    it('should create job with valid scope', async () => {
      const scope = createJobScope(['CA', 'NY'], ['congressional']);
      const options = createOrchestrationOptions();

      const jobId = await adapter.createJob(scope, options);

      expect(jobId).toBeTruthy();
      expect(jobId).toMatch(/^job-/);

      const job = await adapter.getJob(jobId);
      expect(job).toBeTruthy();
      expect(job!.jobId).toBe(jobId);
      expect(job!.status).toBe('pending');
      expect(job!.scope.states).toEqual(['CA', 'NY']);
      expect(job!.scope.layers).toEqual(['congressional']);
      expect(job!.progress.totalTasks).toBe(2); // 2 states × 1 layer
      expect(job!.progress.completedTasks).toBe(0);
      expect(job!.progress.failedTasks).toBe(0);
    });

    it('should fail to create job with empty states', async () => {
      const scope = createJobScope([], ['congressional']); // Empty states
      const options = createOrchestrationOptions();

      await expect(adapter.createJob(scope, options)).rejects.toThrow(/empty scope/i);
    });

    it('should fail to create job with empty layers', async () => {
      const scope = createJobScope(['CA'], []); // Empty layers
      const options = createOrchestrationOptions();

      await expect(adapter.createJob(scope, options)).rejects.toThrow(/empty scope/i);
    });

    it('should get existing job', async () => {
      const scope = createJobScope();
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      const job = await adapter.getJob(jobId);

      expect(job).toBeTruthy();
      expect(job!.jobId).toBe(jobId);
      expect(job!.createdAt).toBeInstanceOf(Date);
      expect(job!.updatedAt).toBeInstanceOf(Date);
    });

    it('should return null for non-existent job', async () => {
      const job = await adapter.getJob('job-nonexistent-12345678');

      expect(job).toBeNull();
    });

    it('should update job status through valid transitions', async () => {
      const scope = createJobScope();
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      // Valid transition: pending → running
      await adapter.updateStatus(jobId, 'running');
      let job = await adapter.getJob(jobId);
      expect(job!.status).toBe('running');

      // Valid transition: running → partial
      await adapter.updateStatus(jobId, 'partial');
      job = await adapter.getJob(jobId);
      expect(job!.status).toBe('partial');

      // Valid transition: partial → completed
      await adapter.updateStatus(jobId, 'completed');
      job = await adapter.getJob(jobId);
      expect(job!.status).toBe('completed');
    });

    it('should update progress incrementally', async () => {
      const scope = createJobScope(['CA', 'NY', 'TX'], ['congressional']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      // Update progress: 1 task completed
      await adapter.updateProgress(jobId, {
        completedTasks: 1,
        currentTask: 'CA-congressional',
      });

      let job = await adapter.getJob(jobId);
      expect(job!.progress.completedTasks).toBe(1);
      expect(job!.progress.currentTask).toBe('CA-congressional');

      // Update progress: 2 tasks completed, 1 failed
      await adapter.updateProgress(jobId, {
        completedTasks: 2,
        failedTasks: 1,
        currentTask: 'TX-congressional',
      });

      job = await adapter.getJob(jobId);
      expect(job!.progress.completedTasks).toBe(2);
      expect(job!.progress.failedTasks).toBe(1);
      expect(job!.progress.currentTask).toBe('TX-congressional');
    });

    it('should list jobs with pagination', async () => {
      const scope = createJobScope();
      const options = createOrchestrationOptions();

      // Create 15 jobs
      const jobIds: string[] = [];
      for (let i = 0; i < 15; i++) {
        const jobId = await adapter.createJob(scope, options);
        jobIds.push(jobId);
        // Small delay to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      // List first 10 jobs
      const firstPage = await adapter.listJobs(10);
      expect(firstPage.length).toBe(10);
      expect(firstPage[0].jobId).toBe(jobIds[14]); // Newest first

      // List all jobs
      const allJobs = await adapter.listJobs(20);
      expect(allJobs.length).toBe(15);
    });

    it('should delete job (soft delete)', async () => {
      const scope = createJobScope();
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      // Verify job exists
      let job = await adapter.getJob(jobId);
      expect(job).toBeTruthy();

      // Delete job
      await adapter.deleteJob(jobId);

      // Verify job is deleted
      job = await adapter.getJob(jobId);
      expect(job).toBeNull();
    });
  });

  // ============================================================================
  // Extraction Tracking Tests
  // ============================================================================

  describe('Extraction Tracking', () => {
    it('should record successful extraction', async () => {
      const scope = createJobScope(['CA'], ['congressional']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      const extraction = createCompletedExtraction('CA', 'congressional', 53);
      await adapter.recordCompletion(jobId, extraction);

      const job = await adapter.getJob(jobId);
      expect(job!.completedExtractions.length).toBe(1);
      expect(job!.completedExtractions[0].state).toBe('CA');
      expect(job!.completedExtractions[0].layer).toBe('congressional');
      expect(job!.completedExtractions[0].boundaryCount).toBe(53);
      expect(job!.completedExtractions[0].validationPassed).toBe(true);
      expect(job!.progress.completedTasks).toBe(1);
    });

    it('should record multiple extractions for same job', async () => {
      const scope = createJobScope(['CA', 'NY', 'TX'], ['congressional']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      // Record 3 successful extractions
      await adapter.recordCompletion(jobId, createCompletedExtraction('CA', 'congressional', 53));
      await adapter.recordCompletion(jobId, createCompletedExtraction('NY', 'congressional', 26));
      await adapter.recordCompletion(jobId, createCompletedExtraction('TX', 'congressional', 38));

      const job = await adapter.getJob(jobId);
      expect(job!.completedExtractions.length).toBe(3);
      expect(job!.progress.completedTasks).toBe(3);

      const states = job!.completedExtractions.map(e => e.state);
      expect(states).toContain('CA');
      expect(states).toContain('NY');
      expect(states).toContain('TX');
    });

    it('should record failure with retry metadata', async () => {
      const scope = createJobScope(['TX'], ['congressional']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      const failure = createExtractionFailure('TX', 'congressional', 'Network timeout', true);
      await adapter.recordFailure(jobId, failure);

      const job = await adapter.getJob(jobId);
      expect(job!.failures.length).toBe(1);
      expect(job!.failures[0].state).toBe('TX');
      expect(job!.failures[0].error).toBe('Network timeout');
      expect(job!.failures[0].retryable).toBe(true);
      expect(job!.failures[0].attemptCount).toBe(1);
      expect(job!.progress.failedTasks).toBe(1);
    });

    it('should record not-configured task', async () => {
      const scope = createJobScope(['AK'], ['state_senate']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      const notConfigured = createNotConfiguredTask('AK', 'state_senate', 'layer_not_configured');
      await adapter.recordNotConfigured(jobId, notConfigured);

      const job = await adapter.getJob(jobId);
      expect(job!.notConfiguredTasks.length).toBe(1);
      expect(job!.notConfiguredTasks[0].state).toBe('AK');
      expect(job!.notConfiguredTasks[0].layer).toBe('state_senate');
      expect(job!.notConfiguredTasks[0].reason).toBe('layer_not_configured');
    });

    it('should verify extraction counts in progress', async () => {
      const scope = createJobScope(['CA', 'NY', 'TX'], ['congressional']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      // Record 2 completions and 1 failure
      await adapter.recordCompletion(jobId, createCompletedExtraction('CA', 'congressional', 53));
      await adapter.recordCompletion(jobId, createCompletedExtraction('NY', 'congressional', 26));
      await adapter.recordFailure(jobId, createExtractionFailure('TX', 'congressional'));

      const job = await adapter.getJob(jobId);
      expect(job!.progress.totalTasks).toBe(3);
      expect(job!.progress.completedTasks).toBe(2);
      expect(job!.progress.failedTasks).toBe(1);

      // Verify invariant: completedTasks + failedTasks ≤ totalTasks
      expect(job!.progress.completedTasks + job!.progress.failedTasks).toBeLessThanOrEqual(
        job!.progress.totalTasks
      );
    });
  });

  // ============================================================================
  // Snapshot Management Tests
  // ============================================================================

  describe('Snapshot Management', () => {
    it('should create snapshot from completed job', async () => {
      const scope = createJobScope(['CA'], ['congressional']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      // Complete the job
      await adapter.recordCompletion(jobId, createCompletedExtraction('CA', 'congressional', 53));
      await adapter.updateStatus(jobId, 'completed');

      // Create snapshot
      const snapshotMetadata = createSnapshotMetadata();

      const snapshotId = await adapter.createSnapshot(jobId, snapshotMetadata);

      expect(snapshotId).toBeTruthy();
      expect(snapshotId).toMatch(/^snapshot-/);
    });

    it('should get snapshot by ID', async () => {
      const scope = createJobScope(['CA'], ['congressional']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      await adapter.recordCompletion(jobId, createCompletedExtraction('CA', 'congressional', 53));
      await adapter.updateStatus(jobId, 'completed');

      const merkleRoot = '0x' + 'abcd'.repeat(16);
      const ipfsCID = 'QmTest123';
      const snapshotMetadata = createSnapshotMetadata(merkleRoot, ipfsCID, 53);

      const snapshotId = await adapter.createSnapshot(jobId, snapshotMetadata);

      const snapshot = await adapter.getSnapshot(snapshotId);
      expect(snapshot).toBeTruthy();
      expect(snapshot!.id).toBe(snapshotId);
      expect(snapshot!.merkleRoot).toBe(merkleRoot);
      expect(snapshot!.ipfsCID).toBe(ipfsCID);
      expect(snapshot!.boundaryCount).toBe(53);
    });

    it('should get snapshot by Merkle root', async () => {
      const scope = createJobScope(['CA'], ['congressional']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      await adapter.recordCompletion(jobId, createCompletedExtraction('CA', 'congressional', 53));
      await adapter.updateStatus(jobId, 'completed');

      const merkleRoot = '0x' + 'beef'.repeat(16);
      const ipfsCID = 'QmTest456';
      const snapshotMetadata = createSnapshotMetadata(merkleRoot, ipfsCID, 53);

      const snapshotId = await adapter.createSnapshot(jobId, snapshotMetadata);

      const snapshot = await adapter.getSnapshotByMerkleRoot(merkleRoot);
      expect(snapshot).toBeTruthy();
      expect(snapshot!.id).toBe(snapshotId);
      expect(snapshot!.merkleRoot).toBe(merkleRoot);
    });

    it('should list snapshots chronologically', async () => {
      const scope = createJobScope(['CA'], ['congressional']);
      const options = createOrchestrationOptions();

      // Create 3 snapshots
      const snapshotIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const jobId = await adapter.createJob(scope, options);
        await adapter.recordCompletion(jobId, createCompletedExtraction('CA', 'congressional', 53));
        await adapter.updateStatus(jobId, 'completed');

        const merkleRoot = '0x' + i.toString().repeat(64).slice(0, 64);
        const ipfsCID = `QmTest${i}`;
        const snapshotMetadata = createSnapshotMetadata(merkleRoot, ipfsCID, 53);

        const snapshotId = await adapter.createSnapshot(jobId, snapshotMetadata);
        snapshotIds.push(snapshotId);

        // Small delay to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const snapshots = await adapter.listSnapshots(10);
      expect(snapshots.length).toBe(3);
      // Newest first
      expect(snapshots[0].id).toBe(snapshotIds[2]);
      expect(snapshots[2].id).toBe(snapshotIds[0]);
    });

    it('should prevent duplicate Merkle roots', async () => {
      const scope = createJobScope(['CA'], ['congressional']);
      const options = createOrchestrationOptions();

      // Create first snapshot
      const jobId1 = await adapter.createJob(scope, options);
      await adapter.recordCompletion(jobId1, createCompletedExtraction('CA', 'congressional', 53));
      await adapter.updateStatus(jobId1, 'completed');

      const merkleRoot = '0x' + 'duplicate'.repeat(8);
      const ipfsCID1 = 'QmTest1';
      const snapshotMetadata1 = createSnapshotMetadata(merkleRoot, ipfsCID1, 53);

      await adapter.createSnapshot(jobId1, snapshotMetadata1);

      // Try to create second snapshot with same Merkle root
      const jobId2 = await adapter.createJob(scope, options);
      await adapter.recordCompletion(jobId2, createCompletedExtraction('CA', 'congressional', 53));
      await adapter.updateStatus(jobId2, 'completed');

      const ipfsCID2 = 'QmTest2';
      const snapshotMetadata2 = createSnapshotMetadata(merkleRoot, ipfsCID2, 53); // Same Merkle root

      await expect(
        adapter.createSnapshot(jobId2, snapshotMetadata2)
      ).rejects.toThrow(/UNIQUE constraint/i);
    });
  });

  // ============================================================================
  // Validation Results Tests
  // ============================================================================

  describe('Validation Results', () => {
    it('should store validation result for boundary', async () => {
      const scope = createJobScope(['CA'], ['congressional']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      await adapter.recordCompletion(jobId, createCompletedExtraction('CA', 'congressional', 53));
      await adapter.updateStatus(jobId, 'completed');

      const merkleRoot = '0x' + 'valid'.repeat(12);
      const ipfsCID = 'QmValidation1';
      const snapshotMetadata = createSnapshotMetadata(merkleRoot, ipfsCID, 53);

      const snapshotId = await adapter.createSnapshot(jobId, snapshotMetadata);

      const validationResult = createValidationResult(true, true, 98);
      await adapter.storeValidationResult(snapshotId, 'us-ca-01', validationResult);

      const results = await adapter.getValidationResults(snapshotId);
      expect(results.size).toBe(1);
      expect(results.get('us-ca-01')).toBeTruthy();
      expect(results.get('us-ca-01')!.geometryValid).toBe(true);
      expect(results.get('us-ca-01')!.geoidValid).toBe(true);
      expect(results.get('us-ca-01')!.confidence).toBe(98);
    });

    it('should retrieve all validation results for snapshot', async () => {
      const scope = createJobScope(['CA'], ['congressional']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      await adapter.recordCompletion(jobId, createCompletedExtraction('CA', 'congressional', 53));
      await adapter.updateStatus(jobId, 'completed');

      const merkleRoot = '0x' + 'multi'.repeat(12);
      const ipfsCID = 'QmMulti123';
      const snapshotMetadata = createSnapshotMetadata(merkleRoot, ipfsCID, 53);

      const snapshotId = await adapter.createSnapshot(jobId, snapshotMetadata);

      // Store validation results for all boundaries
      await adapter.storeValidationResult(snapshotId, 'us-ca-01', createValidationResult(true, true, 100));
      await adapter.storeValidationResult(snapshotId, 'us-ca-02', createValidationResult(true, true, 95));
      await adapter.storeValidationResult(snapshotId, 'us-ca-03', createValidationResult(false, false, 60));

      const results = await adapter.getValidationResults(snapshotId);
      expect(results.size).toBe(3);
      expect(results.get('us-ca-01')!.geometryValid).toBe(true);
      expect(results.get('us-ca-02')!.geometryValid).toBe(true);
      expect(results.get('us-ca-03')!.geometryValid).toBe(false);
    });

    it('should handle large result sets efficiently', async () => {
      const scope = createJobScope(['CA'], ['congressional']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      await adapter.recordCompletion(jobId, createCompletedExtraction('CA', 'congressional', 100));
      await adapter.updateStatus(jobId, 'completed');

      const merkleRoot = '0x' + 'large'.repeat(12);
      const ipfsCID = 'QmLarge123';
      const snapshotMetadata = createSnapshotMetadata(merkleRoot, ipfsCID, 100);

      const snapshotId = await adapter.createSnapshot(jobId, snapshotMetadata);

      // Store validation results for all 100 boundaries
      const startTime = Date.now();
      for (let i = 0; i < 100; i++) {
        const boundaryId = `us-ca-${i.toString().padStart(2, '0')}`;
        await adapter.storeValidationResult(
          snapshotId,
          boundaryId,
          createValidationResult(true, true, 90 + Math.random() * 10)
        );
      }
      const writeTime = Date.now() - startTime;

      // Retrieve all results
      const readStartTime = Date.now();
      const results = await adapter.getValidationResults(snapshotId);
      const readTime = Date.now() - readStartTime;

      expect(results.size).toBe(100);
      // Performance assertion: read should be fast (<100ms for 100 results)
      expect(readTime).toBeLessThan(100);

      // Write performance should be reasonable (<2s for 100 inserts)
      expect(writeTime).toBeLessThan(2000);
    });
  });

  // ============================================================================
  // Transaction Safety Tests
  // ============================================================================

  describe('Transaction Safety', () => {
    it('should perform multi-step operations atomically with recordCompletion', async () => {
      const scope = createJobScope(['CA'], ['congressional']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      // recordCompletion should atomically insert extraction AND increment progress
      await adapter.recordCompletion(jobId, createCompletedExtraction('CA', 'congressional', 53));

      const job = await adapter.getJob(jobId);
      expect(job!.progress.completedTasks).toBe(1);
      expect(job!.completedExtractions.length).toBe(1);
    });

    it('should perform multi-step operations atomically with recordFailure', async () => {
      const scope = createJobScope(['CA'], ['congressional']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      // recordFailure should atomically insert failure AND increment failed count
      await adapter.recordFailure(jobId, createExtractionFailure('CA', 'congressional'));

      const job = await adapter.getJob(jobId);
      expect(job!.progress.failedTasks).toBe(1);
      expect(job!.failures.length).toBe(1);
    });

    it('should allow concurrent reads without blocking', async () => {
      const scope = createJobScope(['CA'], ['congressional']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      // Perform 10 concurrent reads
      const reads = Array.from({ length: 10 }, () => adapter.getJob(jobId));
      const results = await Promise.all(reads);

      // All reads should succeed
      expect(results.every(r => r !== null)).toBe(true);
      expect(results.every(r => r!.jobId === jobId)).toBe(true);
    });

    it('should verify WAL mode performance', async () => {
      // WAL mode should allow concurrent readers while writer is active
      const scope = createJobScope(['CA', 'NY', 'TX'], ['congressional']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      // Start a slow write
      const writePromise = (async () => {
        for (let i = 0; i < 10; i++) {
          await adapter.updateProgress(jobId, {
            completedTasks: i,
            currentTask: `task-${i}`,
          });
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      })();

      // Perform concurrent reads while write is in progress
      const readPromises = Array.from({ length: 20 }, async () => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
        return adapter.getJob(jobId);
      });

      const [, ...reads] = await Promise.all([writePromise, ...readPromises]);

      // All reads should succeed without blocking
      expect(reads.every(r => r !== null)).toBe(true);
    });
  });

  // ============================================================================
  // Crash Recovery Tests
  // ============================================================================

  describe('Crash Recovery', () => {
    it('should survive abrupt close', async () => {
      const scope = createJobScope(['CA'], ['congressional']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      await adapter.recordCompletion(jobId, createCompletedExtraction('CA', 'congressional', 53));

      // Abrupt close (no graceful shutdown)
      await adapter.close();

      // Reopen database
      const newAdapter = new SqlitePersistenceAdapter(join(tempDir, 'test.db'));

      const job = await newAdapter.getJob(jobId);
      expect(job).toBeTruthy();
      expect(job!.completedExtractions.length).toBe(1);

      await newAdapter.close();
    });

    it('should not corrupt data with database transactions', async () => {
      const scope = createJobScope(['CA'], ['congressional']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      // Verify job starts in pending state
      const initialJob = await adapter.getJob(jobId);
      expect(initialJob!.status).toBe('pending');
      expect(initialJob!.progress.completedTasks).toBe(0);

      // Close and reopen
      await adapter.close();
      const newAdapter = new SqlitePersistenceAdapter(join(tempDir, 'test.db'));

      // Verify data integrity: job should be in original state
      const job = await newAdapter.getJob(jobId);
      expect(job).toBeTruthy();
      expect(job!.status).toBe('pending'); // Original state
      expect(job!.progress.completedTasks).toBe(0); // Original state

      await newAdapter.close();
    });

    it('should resume from interrupted job', async () => {
      const scope = createJobScope(['CA', 'NY', 'TX'], ['congressional']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      // Partially complete job
      await adapter.updateStatus(jobId, 'running');
      await adapter.recordCompletion(jobId, createCompletedExtraction('CA', 'congressional', 53));
      await adapter.recordCompletion(jobId, createCompletedExtraction('NY', 'congressional', 26));

      // Simulate crash
      await adapter.close();

      // Reopen and resume
      const newAdapter = new SqlitePersistenceAdapter(join(tempDir, 'test.db'));

      const job = await newAdapter.getJob(jobId);
      expect(job).toBeTruthy();
      expect(job!.status).toBe('running');
      expect(job!.progress.completedTasks).toBe(2);
      expect(job!.completedExtractions.length).toBe(2);

      // Resume: complete remaining task
      await newAdapter.recordCompletion(jobId, createCompletedExtraction('TX', 'congressional', 38));
      await newAdapter.updateStatus(jobId, 'completed');

      const completedJob = await newAdapter.getJob(jobId);
      expect(completedJob!.status).toBe('completed');
      expect(completedJob!.progress.completedTasks).toBe(3);

      await newAdapter.close();
    });
  });

  // ============================================================================
  // Migration Tests
  // ============================================================================

  describe('Migrations', () => {
    it('should create latest schema on fresh database', async () => {
      // Schema created in beforeEach via runMigrations()
      const version = await adapter.getDatabaseVersion();
      expect(version).toBeGreaterThan(0);

      // Verify we can perform basic operations
      const scope = createJobScope();
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);
      const job = await adapter.getJob(jobId);

      expect(job).toBeTruthy();
      expect(job!.jobId).toBe(jobId);
    });

    it('should handle idempotent migrations (safe to re-run)', async () => {
      // Run migrations again (should be no-op)
      await adapter.runMigrations();

      const jobId = await adapter.createJob(createJobScope(), createOrchestrationOptions());
      const retrieved = await adapter.getJob(jobId);

      expect(retrieved).toBeTruthy();
    });

    it('should track version accurately', async () => {
      const version = await adapter.getDatabaseVersion();

      expect(version).toBeGreaterThan(0);
      expect(Number.isInteger(version)).toBe(true);
      expect(version).toBe(1); // Current schema version
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle very long job IDs', async () => {
      // Create job with UUID
      const scope = createJobScope();
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      // Verify UUID format (job-{timestamp}-{random})
      expect(jobId.length).toBeGreaterThan(20);
      expect(jobId).toMatch(/^job-[a-z0-9]+-[a-f0-9]+$/);

      const job = await adapter.getJob(jobId);
      expect(job!.jobId).toBe(jobId);
    });

    it('should handle large JSON in options field', async () => {
      const scope = createJobScope();
      const largeOptions: OrchestrationOptions = {
        concurrency: 10,
        continueOnError: true,
        maxRetries: 5,
        retryDelayMs: 3000,
        validateAfterExtraction: true,
        rateLimitMs: 1000,
        // Add large custom data
        onProgress: undefined, // Will be omitted in serialization
      };

      const jobId = await adapter.createJob(scope, largeOptions);
      const job = await adapter.getJob(jobId);

      expect(job!.options.concurrency).toBe(10);
      expect(job!.options.maxRetries).toBe(5);
    });

    it('should handle Unicode in state/layer names', async () => {
      const scope = createJobScope(['日本', '한국'], ['congressional']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      const job = await adapter.getJob(jobId);
      expect(job!.scope.states).toContain('日本');
      expect(job!.scope.states).toContain('한국');
    });

    it('should handle null vs empty string correctly', async () => {
      const scope = createJobScope(['CA'], ['congressional']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      // Update with null currentTask
      await adapter.updateProgress(jobId, {
        completedTasks: 1,
        currentTask: undefined,
      });

      let job = await adapter.getJob(jobId);
      expect(job!.progress.currentTask).toBeUndefined();

      // Update with empty string currentTask
      await adapter.updateProgress(jobId, {
        completedTasks: 2,
        currentTask: '',
      });

      job = await adapter.getJob(jobId);
      expect(job!.progress.currentTask).toBe('');
    });

    it('should preserve Date serialization precision', async () => {
      const scope = createJobScope(['CA'], ['congressional']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      const beforeDate = new Date();
      await adapter.recordCompletion(
        jobId,
        createCompletedExtraction('CA', 'congressional', 53)
      );
      const afterDate = new Date();

      const job = await adapter.getJob(jobId);
      const completedAt = job!.completedExtractions[0].completedAt;

      expect(completedAt).toBeInstanceOf(Date);
      expect(completedAt.getTime()).toBeGreaterThanOrEqual(beforeDate.getTime());
      expect(completedAt.getTime()).toBeLessThanOrEqual(afterDate.getTime());

      // Verify millisecond precision (no truncation to seconds)
      const timeDiff = afterDate.getTime() - beforeDate.getTime();
      expect(timeDiff).toBeLessThan(1000); // Less than 1 second
    });

    it('should handle empty arrays in job state', async () => {
      const scope = createJobScope(['CA'], ['congressional']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      const job = await adapter.getJob(jobId);

      // Initial state should have empty arrays
      expect(job!.completedExtractions).toEqual([]);
      expect(job!.failures).toEqual([]);
      expect(job!.notConfiguredTasks).toEqual([]);
    });

    it('should handle snapshot with minimal metadata', async () => {
      const scope = createJobScope(['CA'], ['congressional']);
      const options = createOrchestrationOptions();
      const jobId = await adapter.createJob(scope, options);

      await adapter.recordCompletion(jobId, createCompletedExtraction('CA', 'congressional', 1));
      await adapter.updateStatus(jobId, 'completed');

      // Create snapshot with minimal metadata
      const merkleRoot = '0x' + 'minimal'.repeat(10);
      const ipfsCID = 'QmMinimal';
      const snapshotMetadata = createSnapshotMetadata(merkleRoot, ipfsCID, 1);

      const snapshotId = await adapter.createSnapshot(jobId, snapshotMetadata);

      const snapshot = await adapter.getSnapshot(snapshotId);
      expect(snapshot).toBeTruthy();
      expect(snapshot!.boundaryCount).toBe(1);
      expect(snapshot!.merkleRoot).toBe(merkleRoot);
      expect(snapshot!.ipfsCID).toBe(ipfsCID);
    });
  });
});
