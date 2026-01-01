/**
 * Download Dead Letter Queue Tests
 *
 * Verifies DLQ behavior for failed download persistence and retry management.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DownloadDLQ } from '../../../acquisition/download-dlq.js';

describe('DownloadDLQ', () => {
  let db: Database.Database;
  let dlq: DownloadDLQ;

  beforeEach(() => {
    // In-memory database for tests
    db = new Database(':memory:');

    // Load schema
    const schemaPath = join(process.cwd(), 'src/persistence/schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    db.exec(schema);

    dlq = new DownloadDLQ(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('persistFailure', () => {
    it('should persist a failed download', async () => {
      const id = await dlq.persistFailure({
        url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_06_cd119.zip',
        layer: 'cd',
        stateFips: '06',
        year: 2024,
        error: 'ETIMEDOUT',
      });

      expect(id).toBeDefined();
      expect(id).toMatch(/^dlq_/);

      // Verify record exists
      const record = db.prepare(`
        SELECT * FROM failed_downloads WHERE id = ?
      `).get(id);

      expect(record).toBeDefined();
    });

    it('should increment attempt count on duplicate failure', async () => {
      const options = {
        url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_06_cd119.zip',
        layer: 'cd' as const,
        stateFips: '06',
        year: 2024,
        error: 'ETIMEDOUT',
      };

      // First failure
      const id1 = await dlq.persistFailure(options);

      const record1 = db.prepare(`
        SELECT attempt_count FROM failed_downloads WHERE id = ?
      `).get(id1) as { attempt_count: number };

      expect(record1.attempt_count).toBe(1);

      // Second failure (same download)
      const id2 = await dlq.persistFailure({
        ...options,
        error: 'ECONNRESET',
      });

      expect(id2).toBe(id1); // Same ID (idempotent)

      const record2 = db.prepare(`
        SELECT attempt_count FROM failed_downloads WHERE id = ?
      `).get(id2) as { attempt_count: number };

      expect(record2.attempt_count).toBe(2);
    });

    it('should mark as exhausted after max attempts', async () => {
      const options = {
        url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_06_cd119.zip',
        layer: 'cd' as const,
        stateFips: '06',
        year: 2024,
        error: 'ETIMEDOUT',
        maxAttempts: 3,
      };

      // Persist 3 failures
      let id = await dlq.persistFailure(options);
      for (let i = 0; i < 2; i++) {
        id = await dlq.persistFailure(options);
      }

      const record = db.prepare(`
        SELECT status, attempt_count FROM failed_downloads WHERE id = ?
      `).get(id) as { status: string; attempt_count: number };

      expect(record.attempt_count).toBe(3);
      expect(record.status).toBe('exhausted');
    });

    it('should calculate next retry time with exponential backoff', async () => {
      const id = await dlq.persistFailure({
        url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_06_cd119.zip',
        layer: 'cd',
        stateFips: '06',
        year: 2024,
        error: 'ETIMEDOUT',
        retryDelayMs: 1000,
        retryBackoffMultiplier: 2,
      });

      const record = db.prepare(`
        SELECT next_retry_at, last_attempt_at FROM failed_downloads WHERE id = ?
      `).get(id) as { next_retry_at: string; last_attempt_at: string };

      expect(record.next_retry_at).toBeDefined();

      const lastAttempt = new Date(record.last_attempt_at).getTime();
      const nextRetry = new Date(record.next_retry_at).getTime();

      // Should be ~1 second later (1000ms * 2^0)
      const delayMs = nextRetry - lastAttempt;
      expect(delayMs).toBeGreaterThanOrEqual(900);
      expect(delayMs).toBeLessThanOrEqual(1100);
    });
  });

  describe('getRetryableDownloads', () => {
    it('should return pending downloads ready for retry', async () => {
      // Persist a failed download
      await dlq.persistFailure({
        url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_06_cd119.zip',
        layer: 'cd',
        stateFips: '06',
        year: 2024,
        error: 'ETIMEDOUT',
        retryDelayMs: 0, // Immediate retry
      });

      const retryable = await dlq.getRetryableDownloads();

      expect(retryable).toHaveLength(1);
      expect(retryable[0].layer).toBe('cd');
      expect(retryable[0].stateFips).toBe('06');
      expect(retryable[0].status).toBe('pending');
    });

    it('should not return downloads with future retry time', async () => {
      await dlq.persistFailure({
        url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_06_cd119.zip',
        layer: 'cd',
        stateFips: '06',
        year: 2024,
        error: 'ETIMEDOUT',
        retryDelayMs: 3600000, // 1 hour in future
      });

      const retryable = await dlq.getRetryableDownloads();

      expect(retryable).toHaveLength(0);
    });

    it('should not return exhausted downloads', async () => {
      const options = {
        url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_06_cd119.zip',
        layer: 'cd' as const,
        stateFips: '06',
        year: 2024,
        error: 'ETIMEDOUT',
        maxAttempts: 1,
      };

      const id = await dlq.persistFailure(options);

      // Mark as exhausted
      await dlq.markExhausted(id);

      const retryable = await dlq.getRetryableDownloads();

      expect(retryable).toHaveLength(0);
    });

    it('should respect limit parameter', async () => {
      // Persist 5 failed downloads with immediate retry
      const ids: string[] = [];
      for (let i = 1; i <= 5; i++) {
        const id = await dlq.persistFailure({
          url: `https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_${i.toString().padStart(2, '0')}_cd119.zip`,
          layer: 'cd',
          stateFips: i.toString().padStart(2, '0'),
          year: 2024,
          error: 'ETIMEDOUT',
        });
        ids.push(id);
      }

      // Manually set next_retry_at to past for all records (immediate retry)
      for (const id of ids) {
        db.prepare(`
          UPDATE failed_downloads
          SET next_retry_at = datetime('now', '-1 hour')
          WHERE id = ?
        `).run(id);
      }

      const retryable = await dlq.getRetryableDownloads(3);

      expect(retryable).toHaveLength(3);
    });
  });

  describe('markRetrying', () => {
    it('should update status to retrying', async () => {
      const id = await dlq.persistFailure({
        url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_06_cd119.zip',
        layer: 'cd',
        stateFips: '06',
        year: 2024,
        error: 'ETIMEDOUT',
      });

      await dlq.markRetrying(id);

      const record = db.prepare(`
        SELECT status FROM failed_downloads WHERE id = ?
      `).get(id) as { status: string };

      expect(record.status).toBe('retrying');
    });
  });

  describe('markResolved', () => {
    it('should update status to resolved and set resolved_at', async () => {
      const id = await dlq.persistFailure({
        url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_06_cd119.zip',
        layer: 'cd',
        stateFips: '06',
        year: 2024,
        error: 'ETIMEDOUT',
      });

      await dlq.markResolved(id);

      const record = db.prepare(`
        SELECT status, resolved_at FROM failed_downloads WHERE id = ?
      `).get(id) as { status: string; resolved_at: string };

      expect(record.status).toBe('resolved');
      expect(record.resolved_at).toBeDefined();
    });
  });

  describe('markExhausted', () => {
    it('should update status to exhausted', async () => {
      const id = await dlq.persistFailure({
        url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_06_cd119.zip',
        layer: 'cd',
        stateFips: '06',
        year: 2024,
        error: 'ETIMEDOUT',
      });

      await dlq.markExhausted(id);

      const record = db.prepare(`
        SELECT status FROM failed_downloads WHERE id = ?
      `).get(id) as { status: string };

      expect(record.status).toBe('exhausted');
    });
  });

  describe('incrementAttempt', () => {
    it('should increment attempt count and update error', async () => {
      const id = await dlq.persistFailure({
        url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_06_cd119.zip',
        layer: 'cd',
        stateFips: '06',
        year: 2024,
        error: 'ETIMEDOUT',
      });

      await dlq.incrementAttempt(id, 'ECONNRESET');

      const record = db.prepare(`
        SELECT attempt_count, last_error FROM failed_downloads WHERE id = ?
      `).get(id) as { attempt_count: number; last_error: string };

      expect(record.attempt_count).toBe(2);
      expect(record.last_error).toBe('ECONNRESET');
    });

    it('should mark as exhausted when max attempts reached', async () => {
      const id = await dlq.persistFailure({
        url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_06_cd119.zip',
        layer: 'cd',
        stateFips: '06',
        year: 2024,
        error: 'ETIMEDOUT',
        maxAttempts: 2,
      });

      await dlq.incrementAttempt(id, 'ECONNRESET');

      const record = db.prepare(`
        SELECT status, attempt_count FROM failed_downloads WHERE id = ?
      `).get(id) as { status: string; attempt_count: number };

      expect(record.attempt_count).toBe(2);
      expect(record.status).toBe('exhausted');
    });
  });

  describe('getFailureStats', () => {
    it('should return stats summary', async () => {
      // Create fresh database for this test to avoid state from previous tests
      const testDb = new Database(':memory:');
      const schemaPath = join(process.cwd(), 'src/persistence/schema.sql');
      const schema = readFileSync(schemaPath, 'utf-8');
      testDb.exec(schema);
      const testDlq = new DownloadDLQ(testDb);

      // Persist various failures with different URLs to avoid deduplication
      const id1 = await testDlq.persistFailure({
        url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_06_cd119.zip',
        layer: 'cd',
        stateFips: '06',
        year: 2024,
        error: 'ETIMEDOUT',
      });

      const id2 = await testDlq.persistFailure({
        url: 'https://www2.census.gov/geo/tiger/TIGER2024/SLDU/tl_2024_06_sldu.zip',
        layer: 'sldu',
        stateFips: '06',
        year: 2024,
        error: 'ETIMEDOUT',
      });

      // Mark as exhausted immediately (don't persist again, just update status)
      await testDlq.markExhausted(id2);

      const id3 = await testDlq.persistFailure({
        url: 'https://www2.census.gov/geo/tiger/TIGER2024/SLDL/tl_2024_06_sldl.zip',
        layer: 'sldl',
        stateFips: '06',
        year: 2024,
        error: 'ETIMEDOUT',
      });

      await testDlq.markResolved(id3);

      const stats = await testDlq.getFailureStats();

      expect(stats.total).toBe(3);
      expect(stats.pending).toBe(1);
      expect(stats.exhausted).toBe(1);
      expect(stats.resolved).toBe(1);
      expect(stats.byLayer.cd).toBe(1);
      expect(stats.byLayer.sldu).toBe(1);

      testDb.close();
    });
  });

  describe('getFailuresForJob', () => {
    it('should return failures for specific job', async () => {
      // Create fresh database for this test to avoid state from previous tests
      const testDb = new Database(':memory:');
      const schemaPath = join(process.cwd(), 'src/persistence/schema.sql');
      const schema = readFileSync(schemaPath, 'utf-8');
      testDb.exec(schema);
      const testDlq = new DownloadDLQ(testDb);

      const jobId = 'job-123';

      // Create the job first to satisfy foreign key constraint
      testDb.prepare(`
        INSERT INTO jobs (
          id, scope_states, scope_layers, status, created_at, updated_at,
          total_tasks, completed_tasks, failed_tasks, skipped_tasks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        jobId,
        JSON.stringify(['06']),
        JSON.stringify(['cd', 'sldu', 'sldl']),
        'running',
        new Date().toISOString(),
        new Date().toISOString(),
        0, 0, 0, 0
      );

      await testDlq.persistFailure({
        jobId,
        url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_06_cd119.zip',
        layer: 'cd',
        stateFips: '06',
        year: 2024,
        error: 'ETIMEDOUT',
      });

      await testDlq.persistFailure({
        jobId,
        url: 'https://www2.census.gov/geo/tiger/TIGER2024/SLDU/tl_2024_06_sldu.zip',
        layer: 'sldu',
        stateFips: '06',
        year: 2024,
        error: 'ETIMEDOUT',
      });

      // Create different job
      const jobId2 = 'job-456';
      testDb.prepare(`
        INSERT INTO jobs (
          id, scope_states, scope_layers, status, created_at, updated_at,
          total_tasks, completed_tasks, failed_tasks, skipped_tasks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        jobId2,
        JSON.stringify(['06']),
        JSON.stringify(['sldl']),
        'running',
        new Date().toISOString(),
        new Date().toISOString(),
        0, 0, 0, 0
      );

      await testDlq.persistFailure({
        jobId: jobId2,
        url: 'https://www2.census.gov/geo/tiger/TIGER2024/SLDL/tl_2024_06_sldl.zip',
        layer: 'sldl',
        stateFips: '06',
        year: 2024,
        error: 'ETIMEDOUT',
      });

      const failures = await testDlq.getFailuresForJob(jobId);

      expect(failures).toHaveLength(2);
      expect(failures[0].jobId).toBe(jobId);
      expect(failures[1].jobId).toBe(jobId);

      testDb.close();
    });
  });
});
