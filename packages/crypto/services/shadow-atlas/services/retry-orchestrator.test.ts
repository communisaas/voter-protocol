/**
 * Retry Orchestrator - Test Suite
 *
 * Tests retry candidate calculation, blocker classification, and priority sorting
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import {
  getRetryCandidates,
  getRetryCandidatesByBlocker,
  getRetryStats,
  BlockerRetryPolicy,
  BLOCKER_RETRY_POLICIES,
} from './retry-orchestrator.js';
import type { ProvenanceEntry } from './provenance-writer.js';

const TEST_BASE_DIR = './test-retry-provenance';

/**
 * Create test provenance log with given entries
 */
async function createTestLog(entries: ProvenanceEntry[]): Promise<void> {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const monthDir = join(TEST_BASE_DIR, `${year}-${month}`);

  await mkdir(monthDir, { recursive: true });

  // Group entries by FIPS shard
  const shards = new Map<string, ProvenanceEntry[]>();
  for (const entry of entries) {
    const shard = entry.f.substring(0, 2);
    if (!shards.has(shard)) {
      shards.set(shard, []);
    }
    shards.get(shard)!.push(entry);
  }

  // Write each shard
  for (const [shard, shardEntries] of shards) {
    const logPath = join(monthDir, `discovery-log-${shard}.ndjson.gz`);
    const ndjson = shardEntries.map((e) => JSON.stringify(e)).join('\n') + '\n';

    // Compress to .gz
    const gzip = createGzip();
    const input = Readable.from([ndjson]);

    await pipeline(
      input,
      gzip,
      async function* (source) {
        const chunks: Buffer[] = [];
        for await (const chunk of source) {
          chunks.push(chunk);
        }
        await writeFile(logPath, Buffer.concat(chunks));
      }
    );
  }
}

/**
 * Helper to create provenance entry
 */
function createEntry(
  fips: string,
  cityName: string,
  state: string,
  blockerCode: string | null,
  timestamp: string,
  population: number = 100000
): ProvenanceEntry {
  return {
    f: fips,
    n: cityName,
    s: state,
    p: population,
    g: blockerCode ? 2 : 1, // Blocked = tier 2 fallback
    fc: blockerCode ? undefined : 9,
    conf: blockerCode ? 40 : 85,
    auth: 3,
    src: 'muni-gis',
    url: 'https://example.com/gis',
    why: blockerCode ? [`Blocked by ${blockerCode}`] : ['Success'],
    tried: [0, 1],
    blocked: blockerCode,
    ts: timestamp,
    aid: 'test-001',
  };
}

describe('Retry Orchestrator', () => {
  beforeEach(async () => {
    // Clean up test directory before each test
    await rm(TEST_BASE_DIR, { recursive: true, force: true });
  });

  afterEach(async () => {
    // Clean up test directory after each test
    await rm(TEST_BASE_DIR, { recursive: true, force: true });
  });

  describe('getRetryCandidates', () => {
    it('returns empty array when no blocked entries exist', async () => {
      // Create log with successful entries only
      await createTestLog([
        createEntry('0666000', 'San Diego', 'CA', null, '2025-11-19T00:00:00.000Z'),
        createEntry('0644000', 'Los Angeles', 'CA', null, '2025-11-19T00:00:00.000Z'),
      ]);

      const candidates = await getRetryCandidates(TEST_BASE_DIR);
      expect(candidates).toHaveLength(0);
    });

    it('excludes never-retry blockers', async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      await createTestLog([
        // At-large governance = NEVER retry
        createEntry('0666000', 'San Diego', 'CA', 'at-large-governance', sevenDaysAgo),
        // Portal 404 = DAILY retry (eligible after 24 hours)
        createEntry('0644000', 'Los Angeles', 'CA', 'portal-404', sevenDaysAgo),
      ]);

      const candidates = await getRetryCandidates(TEST_BASE_DIR);

      // Only portal-404 should be eligible (after retry time passes)
      expect(candidates.every((c) => c.blockerCode !== 'at-large-governance')).toBe(true);
    });

    it('filters by retry time (only returns eligible candidates)', async () => {
      const now = new Date();

      // 7 days ago (DAILY policy = definitely eligible)
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      // 12 hours ago (DAILY policy = NOT eligible, needs 24 hours)
      const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();

      await createTestLog([
        // Eligible (7 days ago, DAILY retry)
        createEntry('0666000', 'San Diego', 'CA', 'portal-404', sevenDaysAgo),
        // Not eligible (12 hours ago, DAILY retry)
        createEntry('0644000', 'Los Angeles', 'CA', 'portal-404', twelveHoursAgo),
      ]);

      const candidates = await getRetryCandidates(TEST_BASE_DIR);

      // Only San Diego should be eligible
      expect(candidates).toHaveLength(1);
      expect(candidates[0].fips).toBe('0666000');
      expect(candidates[0].cityName).toBe('San Diego');
    });

    it('sorts by priority (population)', async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      await createTestLog([
        // Small city (100k pop)
        createEntry('0666000', 'Small City', 'CA', 'portal-404', sevenDaysAgo, 100000),
        // Large city (1.4M pop)
        createEntry('0644000', 'Los Angeles', 'CA', 'portal-404', sevenDaysAgo, 1400000),
        // Medium city (500k pop)
        createEntry('0655000', 'Medium City', 'CA', 'portal-404', sevenDaysAgo, 500000),
      ]);

      const candidates = await getRetryCandidates(TEST_BASE_DIR);

      // Should be sorted by population (descending)
      expect(candidates).toHaveLength(3);
      expect(candidates[0].cityName).toBe('Los Angeles'); // 1.4M
      expect(candidates[1].cityName).toBe('Medium City'); // 500k
      expect(candidates[2].cityName).toBe('Small City'); // 100k
    });

    it('counts attempt history correctly', async () => {
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

      await createTestLog([
        // First attempt (5 days ago)
        createEntry('0666000', 'San Diego', 'CA', 'portal-404', fiveDaysAgo),
        // Second attempt (3 days ago)
        createEntry('0666000', 'San Diego', 'CA', 'portal-404', threeDaysAgo),
        // Third attempt (2 days ago)
        createEntry('0666000', 'San Diego', 'CA', 'portal-404', twoDaysAgo),
      ]);

      const candidates = await getRetryCandidates(TEST_BASE_DIR);

      // Should have 3 attempts logged
      expect(candidates).toHaveLength(1);
      expect(candidates[0].attemptCount).toBe(3);
    });

    it('uses latest attempt for retry calculation', async () => {
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

      await createTestLog([
        // Old attempt (5 days ago) - would be eligible
        createEntry('0666000', 'San Diego', 'CA', 'portal-404', fiveDaysAgo),
        // Recent attempt (12 hours ago) - NOT eligible (needs 24 hours for DAILY)
        createEntry('0666000', 'San Diego', 'CA', 'portal-404', twelveHoursAgo),
      ]);

      const candidates = await getRetryCandidates(TEST_BASE_DIR);

      // Should use latest attempt (12 hours ago), which is not eligible yet
      expect(candidates).toHaveLength(0);
    });
  });

  describe('getRetryCandidatesByBlocker', () => {
    it('filters candidates by blocker code', async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();

      await createTestLog([
        createEntry('0666000', 'San Diego', 'CA', 'portal-404', sevenDaysAgo),
        createEntry('0644000', 'Los Angeles', 'CA', 'no-council-layer', ninetyOneDaysAgo),
        createEntry('0655000', 'San Francisco', 'CA', 'portal-404', sevenDaysAgo),
      ]);

      const portal404 = await getRetryCandidatesByBlocker('portal-404', TEST_BASE_DIR);
      const noCouncil = await getRetryCandidatesByBlocker('no-council-layer', TEST_BASE_DIR);

      expect(portal404).toHaveLength(2);
      expect(portal404.every((c) => c.blockerCode === 'portal-404')).toBe(true);

      // no-council-layer is QUARTERLY (90 days), eligible after 91 days
      expect(noCouncil).toHaveLength(1);
      expect(noCouncil[0].blockerCode).toBe('no-council-layer');
    });
  });

  describe('getRetryStats', () => {
    it('calculates statistics correctly', async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

      await createTestLog([
        // Eligible (portal-404, 7 days ago)
        createEntry('0666000', 'San Diego', 'CA', 'portal-404', sevenDaysAgo),
        // Not eligible (portal-404, 12 hours ago)
        createEntry('0644000', 'Los Angeles', 'CA', 'portal-404', twelveHoursAgo),
        // Never retry (at-large)
        createEntry('0655000', 'San Francisco', 'CA', 'at-large-governance', sevenDaysAgo),
        // Successful entry (not blocked)
        createEntry('0677000', 'Oakland', 'CA', null, sevenDaysAgo),
      ]);

      const stats = await getRetryStats(TEST_BASE_DIR);

      expect(stats.totalBlocked).toBe(3); // 2 portal-404 + 1 at-large
      expect(stats.neverRetry).toBe(1); // 1 at-large
      expect(stats.retryEligible).toBe(1); // 1 portal-404 (7 days ago)

      expect(stats.byBlocker['portal-404']).toEqual({
        count: 2,
        retryPolicy: BlockerRetryPolicy.DAILY,
      });

      expect(stats.byBlocker['at-large-governance']).toEqual({
        count: 1,
        retryPolicy: BlockerRetryPolicy.NEVER,
      });
    });
  });

  describe('BLOCKER_RETRY_POLICIES', () => {
    it('covers all known blocker codes', () => {
      // These are the critical blocker codes from provenance-writer.ts
      const knownBlockers = [
        'no-precinct-data',
        'precinct-auth-required',
        'at-large-governance',
        'no-council-layer',
        'ambiguous-layer-name',
        'low-confidence-match',
        'portal-404',
        'portal-timeout',
        'portal-auth-required',
        'no-municipal-gis',
        'malformed-geojson',
        'topology-errors',
        'coordinate-errors',
        'redistricting-in-progress',
        'redistricting-completed',
        'multi-county-unsupported',
        'consolidated-city-county',
      ];

      for (const blocker of knownBlockers) {
        expect(BLOCKER_RETRY_POLICIES[blocker]).toBeDefined();
      }
    });

    it('classifies permanent blockers as NEVER', () => {
      expect(BLOCKER_RETRY_POLICIES['at-large-governance']).toBe(BlockerRetryPolicy.NEVER);
      expect(BLOCKER_RETRY_POLICIES['multi-county-unsupported']).toBe(BlockerRetryPolicy.NEVER);
      expect(BLOCKER_RETRY_POLICIES['consolidated-city-county']).toBe(BlockerRetryPolicy.NEVER);
    });

    it('classifies temporary infrastructure issues as HOURLY or DAILY', () => {
      expect(BLOCKER_RETRY_POLICIES['portal-timeout']).toBe(BlockerRetryPolicy.HOURLY);
      expect(BLOCKER_RETRY_POLICIES['portal-404']).toBe(BlockerRetryPolicy.DAILY);
    });

    it('classifies data publication delays as QUARTERLY', () => {
      expect(BLOCKER_RETRY_POLICIES['no-council-layer']).toBe(BlockerRetryPolicy.QUARTERLY);
      expect(BLOCKER_RETRY_POLICIES['no-precinct-data']).toBe(BlockerRetryPolicy.QUARTERLY);
    });
  });
});
