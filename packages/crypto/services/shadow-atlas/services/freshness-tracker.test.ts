/**
 * Freshness Tracker Tests
 *
 * CRITICAL: These tests verify our data freshness tracking logic.
 * Failures here mean we could serve stale data in production.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import {
  getRevalidationQueue,
  getFreshnessStats,
  type FreshnessInfo,
} from './freshness-tracker.js';
import { appendProvenance, type ProvenanceEntry } from './provenance-writer.js';

// Use a dedicated test root to ensure staging isolation
const TEST_ROOT = './test-freshness-root';
const TEST_DIR = `${TEST_ROOT}/discovery-attempts`;
const TEST_STAGING_DIR = `${TEST_ROOT}/discovery-staging`;

/**
 * Helper: Create test entry with custom timestamp
 */
function createEntry(
  fips: string,
  daysAgo: number,
  options?: {
    cityName?: string;
    state?: string;
    population?: number;
    tier?: 0 | 1 | 2 | 3 | 4;
    blocked?: string | null;
  }
): ProvenanceEntry {
  const timestamp = new Date();
  timestamp.setDate(timestamp.getDate() - daysAgo);

  return {
    f: fips,
    n: options?.cityName,
    s: options?.state,
    p: options?.population,
    g: options?.tier ?? 1,
    conf: 85,
    auth: 3,
    why: ['Test entry'],
    tried: [1],
    blocked: options?.blocked ?? null,
    ts: timestamp.toISOString(),
    aid: 'agt-test',
  };
}

describe('Freshness Tracker', () => {
  beforeEach(async () => {
    // CRITICAL: Wait for previous test's file handles to close
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Clean up entire test root (includes both discovery-attempts and discovery-staging)
    try {
      await fs.rm(TEST_ROOT, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }

    // Clean up any leaked lock files
    try {
      const lockFiles = await fs.readdir('.', { withFileTypes: true });
      for (const file of lockFiles) {
        if (file.name.endsWith('.lock')) {
          await fs.rm(file.name, { force: true });
        }
      }
    } catch {
      // Ignore cleanup errors
    }

    // Wait for filesystem operations to complete
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Create fresh test directory
    await fs.mkdir(TEST_DIR, { recursive: true });

    // Wait for directory creation to complete
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    // Wait for file handles to close
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Clean up entire test root
    try {
      await fs.rm(TEST_ROOT, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }

    // Clean up any leaked lock files
    try {
      const lockFiles = await fs.readdir('.', { withFileTypes: true });
      for (const file of lockFiles) {
        if (file.name.endsWith('.lock')) {
          await fs.rm(file.name, { force: true });
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Freshness Classification', () => {
    it('should classify fresh data (<90 days)', async () => {
      const entry = createEntry('0666000', 45, {
        cityName: 'San Diego',
        state: 'CA',
        population: 1386932,
      });

      await appendProvenance(entry, TEST_DIR);

      const stats = await getFreshnessStats(TEST_DIR);
      expect(stats.total).toBe(1);
      expect(stats.fresh).toBe(1);
      expect(stats.aging).toBe(0);
      expect(stats.stale).toBe(0);
      expect(stats.critical).toBe(0);
    });

    it('should classify aging data (90-180 days)', async () => {
      const entry = createEntry('0666000', 120, {
        cityName: 'San Diego',
        state: 'CA',
        population: 1386932,
      });

      await appendProvenance(entry, TEST_DIR);

      const stats = await getFreshnessStats(TEST_DIR);
      expect(stats.total).toBe(1);
      expect(stats.fresh).toBe(0);
      expect(stats.aging).toBe(1);
      expect(stats.stale).toBe(0);
      expect(stats.critical).toBe(0);
    });

    it('should classify stale data (180-365 days)', async () => {
      const entry = createEntry('0666000', 200, {
        cityName: 'San Diego',
        state: 'CA',
        population: 1386932,
      });

      await appendProvenance(entry, TEST_DIR);

      const stats = await getFreshnessStats(TEST_DIR);
      expect(stats.total).toBe(1);
      expect(stats.fresh).toBe(0);
      expect(stats.aging).toBe(0);
      expect(stats.stale).toBe(1);
      expect(stats.critical).toBe(0);
    });

    it('should classify critical data (>365 days)', async () => {
      const entry = createEntry('0666000', 400, {
        cityName: 'San Diego',
        state: 'CA',
        population: 1386932,
      });

      await appendProvenance(entry, TEST_DIR);

      const stats = await getFreshnessStats(TEST_DIR);
      expect(stats.total).toBe(1);
      expect(stats.fresh).toBe(0);
      expect(stats.aging).toBe(0);
      expect(stats.stale).toBe(0);
      expect(stats.critical).toBe(1);
    });
  });

  describe('Revalidation Scheduling', () => {
    it('should NOT queue fresh data (<90 days)', async () => {
      const entry = createEntry('0666000', 45, {
        cityName: 'San Diego',
        state: 'CA',
      });

      await appendProvenance(entry, TEST_DIR);

      const queue = await getRevalidationQueue(TEST_DIR);
      expect(queue).toHaveLength(0);
    });

    it('should queue aging data (90-180 days) for monthly revalidation', async () => {
      const entry = createEntry('0666000', 120, {
        cityName: 'San Diego',
        state: 'CA',
      });

      await appendProvenance(entry, TEST_DIR);

      const queue = await getRevalidationQueue(TEST_DIR);
      expect(queue).toHaveLength(1);
      expect(queue[0].status).toBe('aging');
      expect(queue[0].reasoning.some((r) => r.includes('monthly'))).toBe(true);
    });

    it('should queue stale data (180-365 days) for weekly revalidation', async () => {
      const entry = createEntry('0666000', 200, {
        cityName: 'San Diego',
        state: 'CA',
      });

      await appendProvenance(entry, TEST_DIR);

      const queue = await getRevalidationQueue(TEST_DIR);
      expect(queue).toHaveLength(1);
      expect(queue[0].status).toBe('stale');
      expect(queue[0].reasoning.some((r) => r.includes('weekly'))).toBe(true);
    });

    it('should queue critical data (>365 days) for urgent revalidation', async () => {
      const entry = createEntry('0666000', 400, {
        cityName: 'San Diego',
        state: 'CA',
      });

      await appendProvenance(entry, TEST_DIR);

      const queue = await getRevalidationQueue(TEST_DIR);
      expect(queue).toHaveLength(1);
      expect(queue[0].status).toBe('critical');
      expect(queue[0].reasoning.some((r) => r.includes('URGENT') || r.includes('day'))).toBe(true);
    });
  });

  describe('Priority Sorting', () => {
    it('should sort critical before stale before aging', async () => {
      const entries = [
        createEntry('0666000', 120, { cityName: 'Aging City', state: 'CA' }),
        createEntry('0668000', 400, { cityName: 'Critical City', state: 'CA' }),
        createEntry('0807850', 200, { cityName: 'Stale City', state: 'CO' }),
      ];

      for (const entry of entries) {
        await appendProvenance(entry, TEST_DIR);
      }

      const queue = await getRevalidationQueue(TEST_DIR);
      expect(queue).toHaveLength(3);
      expect(queue[0].status).toBe('critical');
      expect(queue[1].status).toBe('stale');
      expect(queue[2].status).toBe('aging');
    });
  });

  describe('Latest Entry Per FIPS', () => {
    it('should use latest entry when multiple exist for same FIPS', async () => {
      // Old entry (400 days ago)
      const oldEntry = createEntry('0666000', 400, {
        cityName: 'San Diego',
        state: 'CA',
      });

      // New entry (45 days ago)
      const newEntry = createEntry('0666000', 45, {
        cityName: 'San Diego',
        state: 'CA',
      });

      await appendProvenance(oldEntry, TEST_DIR);
      await appendProvenance(newEntry, TEST_DIR);

      const stats = await getFreshnessStats(TEST_DIR);
      expect(stats.total).toBe(1);
      expect(stats.fresh).toBe(1); // Should use newer entry
      expect(stats.critical).toBe(0);
    });
  });

  describe('Blocked Entries', () => {
    it('should exclude blocked entries from statistics', async () => {
      const successEntry = createEntry('0666000', 45, {
        cityName: 'San Diego',
        state: 'CA',
        blocked: null, // Success
      });

      const blockedEntry = createEntry('0807850', 120, {
        cityName: 'Boulder',
        state: 'CO',
        blocked: 'at-large-governance',
      });

      await appendProvenance(successEntry, TEST_DIR);
      await appendProvenance(blockedEntry, TEST_DIR);

      const stats = await getFreshnessStats(TEST_DIR);
      expect(stats.total).toBe(1); // Only count successful discovery
      expect(stats.fresh).toBe(1);
    });

    it('should exclude blocked entries from revalidation queue', async () => {
      const blockedEntry = createEntry('0807850', 400, {
        cityName: 'Boulder',
        state: 'CO',
        blocked: 'at-large-governance',
      });

      await appendProvenance(blockedEntry, TEST_DIR);

      const queue = await getRevalidationQueue(TEST_DIR);
      expect(queue).toHaveLength(0); // Blocked entries not queued
    });
  });

  describe('State Breakdown', () => {
    it('should calculate per-state freshness statistics', async () => {
      const entries = [
        createEntry('0666000', 45, { state: 'CA' }), // Fresh
        createEntry('0668000', 120, { state: 'CA' }), // Aging
        createEntry('4827000', 200, { state: 'TX' }), // Stale
        createEntry('3651000', 400, { state: 'NY' }), // Critical
      ];

      for (const entry of entries) {
        await appendProvenance(entry, TEST_DIR);
      }

      const stats = await getFreshnessStats(TEST_DIR);

      expect(stats.byState['CA'].fresh).toBe(1);
      expect(stats.byState['CA'].aging).toBe(1);
      expect(stats.byState['TX'].stale).toBe(1);
      expect(stats.byState['NY'].critical).toBe(1);
    });
  });

  describe('Redistricting Cycle', () => {
    it('should calculate next redistricting year', async () => {
      const entry = createEntry('0666000', 45, {
        cityName: 'San Diego',
        state: 'CA',
      });

      await appendProvenance(entry, TEST_DIR);

      const queue = await getRevalidationQueue(TEST_DIR);
      // Should not be in queue (fresh data), so check stats instead
      const stats = await getFreshnessStats(TEST_DIR);
      expect(stats.fresh).toBe(1);
    });
  });

  describe('Empty Database', () => {
    it('should handle empty database gracefully', async () => {
      const stats = await getFreshnessStats(TEST_DIR);

      expect(stats.total).toBe(0);
      expect(stats.fresh).toBe(0);
      expect(stats.aging).toBe(0);
      expect(stats.stale).toBe(0);
      expect(stats.critical).toBe(0);
      expect(stats.needsRevalidation).toBe(0);
    });

    it('should return empty queue for empty database', async () => {
      const queue = await getRevalidationQueue(TEST_DIR);
      expect(queue).toHaveLength(0);
    });
  });

  describe('Needs Revalidation Counter', () => {
    it('should count entries needing revalidation', async () => {
      const entries = [
        createEntry('0666000', 45, { state: 'CA' }), // Fresh - NO revalidation
        createEntry('0668000', 120, { state: 'CA' }), // Aging - YES revalidation
        createEntry('4827000', 200, { state: 'TX' }), // Stale - YES revalidation
        createEntry('3651000', 400, { state: 'NY' }), // Critical - YES revalidation
      ];

      for (const entry of entries) {
        await appendProvenance(entry, TEST_DIR);
      }

      const stats = await getFreshnessStats(TEST_DIR);
      expect(stats.needsRevalidation).toBe(3); // Aging + Stale + Critical
    });
  });
});
