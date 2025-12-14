/**
 * Provenance Writer Tests
 *
 * CRITICAL: These tests verify our audit trail implementation.
 * Failures here mean we can't trust agent decision records.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  appendProvenance,
  queryProvenance,
  getProvenanceStats,
  type ProvenanceEntry,
} from './provenance-writer.js';

const TEST_DIR = './test-discovery-attempts';

describe('Provenance Writer', () => {
  beforeEach(async () => {
    // CRITICAL: Wait FIRST for any previous test's file handles to close
    await new Promise((resolve) => setTimeout(resolve, 200));

    // ROBUST CLEANUP: Ensure clean state before EVERY test
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }

    // Clean up any leaked lock files in current directory
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

    // CRITICAL: Wait for filesystem operations to complete
    // This prevents race conditions where subsequent mkdir fails
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Create fresh test directory
    await fs.mkdir(TEST_DIR, { recursive: true });

    // Small delay to ensure filesystem is ready
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    // CRITICAL: Wait for file handles to close from previous test
    await new Promise((resolve) => setTimeout(resolve, 150));

    // ROBUST CLEANUP: Remove all files first, then directory
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
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

  describe('appendProvenance', () => {
    it('should write and read back a single entry', async () => {
      const entry: ProvenanceEntry = {
        f: '0666000',
        n: 'San Diego',
        s: 'CA',
        p: 1386932,
        g: 1,
        fc: 9,
        conf: 85,
        auth: 3,
        src: 'muni-gis',
        url: 'https://seshat.datasd.org/sde/council_districts/downloads/council_dists_datasd.geojson',
        q: { v: true, t: 1, r: 474, d: '2021-12-14' },
        why: ['T0 blocked: No precinct data', 'T1 success: 9 districts', 'Authority: Municipal GIS (verified)'],
        tried: [0, 1],
        blocked: null,
        ts: '2025-11-19T07:42:00Z',
        aid: 'agt-001',
      };

      await appendProvenance(entry, TEST_DIR);

      const results = await queryProvenance({}, TEST_DIR);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(entry);
    });

    it('should append multiple entries to same monthly log', async () => {
      const entries: ProvenanceEntry[] = [
        {
          f: '0666000',
          n: 'San Diego',
          s: 'CA',
          g: 1,
          conf: 85,
          auth: 3,
          why: ['T1 success'],
          tried: [0, 1],
          blocked: null,
          ts: '2025-11-19T07:42:00Z',
          aid: 'agt-001',
        },
        {
          f: '0668000',
          n: 'San Jose',
          s: 'CA',
          g: 1,
          conf: 82,
          auth: 2,
          why: ['T1 success'],
          tried: [0, 1],
          blocked: null,
          ts: '2025-11-19T08:15:00Z',
          aid: 'agt-001',
        },
        {
          f: '0807850',
          n: 'Boulder',
          s: 'CO',
          g: 2,
          conf: 100,
          auth: 5,
          why: ['T2 optimal for at-large cities'],
          tried: [0, 1, 2],
          blocked: 'at-large-governance',
          ts: '2025-11-19T09:30:00Z',
          aid: 'agt-002',
        },
      ];

      for (const entry of entries) {
        await appendProvenance(entry, TEST_DIR);
      }

      const results = await queryProvenance({}, TEST_DIR);
      expect(results).toHaveLength(3);
      expect(results.map((r) => r.f)).toEqual(['0666000', '0668000', '0807850']);
    });

    it('should handle sequential writes from multiple agents', async () => {
      const createEntry = (fips: string, agentId: string): ProvenanceEntry => ({
        f: fips,
        g: 1,
        conf: 85,
        auth: 3,
        why: ['Test entry'],
        tried: [1],
        blocked: null,
        ts: new Date().toISOString(),
        aid: agentId,
      });

      // Write 10 entries sequentially (file locking ensures correctness)
      for (let i = 0; i < 10; i++) {
        await appendProvenance(
          createEntry(
            i.toString().padStart(7, '0'),
            `agt-${i.toString().padStart(3, '0')}`
          ),
          TEST_DIR
        );
      }

      const results = await queryProvenance({}, TEST_DIR);
      expect(results).toHaveLength(10);

      // Verify all unique FIPS codes
      const fipsCodes = new Set(results.map((r) => r.f));
      expect(fipsCodes.size).toBe(10);
    });

    it('should handle concurrent writes from multiple agents', async () => {
      const agents = ['agt-001', 'agt-002', 'agt-003', 'agt-004', 'agt-005'];

      // Use different state FIPS codes (first 2 digits) to avoid lock contention
      // This tests sharding implementation
      const stateFips = ['06', '48', '36', '17', '12']; // CA, TX, NY, IL, FL

      const writes: Promise<void>[] = [];

      for (let i = 0; i < agents.length; i++) {
        for (let j = 0; j < 2; j++) {
          // Create unique FIPS per entry (state code + unique suffix)
          const fips = `${stateFips[i]}${String(i * 10 + j).padStart(5, '0')}`;

          const entry: ProvenanceEntry = {
            f: fips,
            n: `City ${i}-${j}`,
            s: ['CA', 'TX', 'NY', 'IL', 'FL'][i],
            g: 1,
            conf: 85,
            auth: 3,
            why: ['Test entry'],
            tried: [1],
            blocked: null,
            ts: new Date().toISOString(),
            aid: agents[i],
          };

          // Track promise BEFORE awaiting (critical for test correctness)
          const writePromise = appendProvenance(entry, TEST_DIR);
          writes.push(writePromise);
        }
      }

      // Wait for ALL writes to complete
      await Promise.all(writes);

      // Add small delay to ensure file handles are closed
      await new Promise((resolve) => setTimeout(resolve, 100));

      const results = await queryProvenance({}, TEST_DIR);
      expect(results).toHaveLength(10);

      // Verify all unique FIPS codes (proves no race condition)
      const fipsSet = new Set(results.map((r) => r.f));
      expect(fipsSet.size).toBe(10);
    });

    it('should create monthly directories automatically', async () => {
      const entry: ProvenanceEntry = {
        f: '0666000',
        g: 1,
        conf: 85,
        auth: 3,
        why: ['Test'],
        tried: [1],
        blocked: null,
        ts: '2025-11-19T07:42:00Z',
        aid: 'agt-001',
      };

      await appendProvenance(entry, TEST_DIR);

      // Verify directory structure with sharded file
      // CRITICAL: Use entry timestamp to determine expected directory (not current date)
      const entryDate = new Date(entry.ts);
      const year = entryDate.getUTCFullYear();
      const month = String(entryDate.getUTCMonth() + 1).padStart(2, '0');
      const monthDir = path.join(TEST_DIR, `${year}-${month}`);
      const logFile = path.join(monthDir, 'discovery-log-06.ndjson.gz'); // FIPS 0666000 → shard 06

      const dirExists = await fs
        .access(monthDir)
        .then(() => true)
        .catch(() => false);
      const fileExists = await fs
        .access(logFile)
        .then(() => true)
        .catch(() => false);

      expect(dirExists).toBe(true);
      expect(fileExists).toBe(true);
    });

    it('should reject entry with missing required fields', async () => {
      const invalidEntry = {
        f: '0666000',
        // Missing required fields: g, conf, auth, why, tried, blocked, ts, aid
      } as unknown as ProvenanceEntry;

      await expect(appendProvenance(invalidEntry, TEST_DIR)).rejects.toThrow('Missing required field');
    });

    it('should reject entry with invalid granularity tier', async () => {
      const invalidEntry: ProvenanceEntry = {
        f: '0666000',
        g: 99 as 1, // Invalid tier
        conf: 85,
        auth: 3,
        why: ['Test'],
        tried: [1],
        blocked: null,
        ts: '2025-11-19T07:42:00Z',
        aid: 'agt-001',
      };

      await expect(appendProvenance(invalidEntry, TEST_DIR)).rejects.toThrow('Invalid granularity tier');
    });

    it('should reject entry with invalid confidence', async () => {
      const invalidEntry: ProvenanceEntry = {
        f: '0666000',
        g: 1,
        conf: 150, // Out of range (0-100)
        auth: 3,
        why: ['Test'],
        tried: [1],
        blocked: null,
        ts: '2025-11-19T07:42:00Z',
        aid: 'agt-001',
      };

      await expect(appendProvenance(invalidEntry, TEST_DIR)).rejects.toThrow('Invalid confidence');
    });

    it('should reject entry with invalid authority level', async () => {
      const invalidEntry: ProvenanceEntry = {
        f: '0666000',
        g: 1,
        conf: 85,
        auth: 10 as 3, // Out of range (0-5)
        why: ['Test'],
        tried: [1],
        blocked: null,
        ts: '2025-11-19T07:42:00Z',
        aid: 'agt-001',
      };

      await expect(appendProvenance(invalidEntry, TEST_DIR)).rejects.toThrow('Invalid authority level');
    });

    it('should reject entry with empty reasoning chain', async () => {
      const invalidEntry: ProvenanceEntry = {
        f: '0666000',
        g: 1,
        conf: 85,
        auth: 3,
        why: [], // Empty array
        tried: [1],
        blocked: null,
        ts: '2025-11-19T07:42:00Z',
        aid: 'agt-001',
      };

      await expect(appendProvenance(invalidEntry, TEST_DIR)).rejects.toThrow('Reasoning chain (why) must be non-empty array');
    });

    it('should reject entry with invalid timestamp', async () => {
      const invalidEntry: ProvenanceEntry = {
        f: '0666000',
        g: 1,
        conf: 85,
        auth: 3,
        why: ['Test'],
        tried: [1],
        blocked: null,
        ts: 'not-a-timestamp',
        aid: 'agt-001',
      };

      await expect(appendProvenance(invalidEntry, TEST_DIR)).rejects.toThrow('Invalid ISO timestamp');
    });
  });

  describe('queryProvenance', () => {
    beforeEach(async () => {
      // Seed test data
      const entries: ProvenanceEntry[] = [
        {
          f: '0666000',
          n: 'San Diego',
          s: 'CA',
          p: 1386932,
          g: 1,
          fc: 9,
          conf: 85,
          auth: 3,
          why: ['T1 success: 9 districts'],
          tried: [0, 1],
          blocked: null,
          ts: '2025-11-19T07:42:00Z',
          aid: 'agt-001',
        },
        {
          f: '0668000',
          n: 'San Jose',
          s: 'CA',
          p: 1013240,
          g: 1,
          fc: 10,
          conf: 82,
          auth: 2,
          why: ['T1 success: 10 districts'],
          tried: [0, 1],
          blocked: null,
          ts: '2025-11-19T08:15:00Z',
          aid: 'agt-001',
        },
        {
          f: '0807850',
          n: 'Boulder',
          s: 'CO',
          p: 108090,
          g: 2,
          fc: 1,
          conf: 100,
          auth: 5,
          why: ['T2 optimal for at-large cities'],
          tried: [0, 1, 2],
          blocked: 'at-large-governance',
          ts: '2025-11-19T09:30:00Z',
          aid: 'agt-002',
        },
        {
          f: '1234567',
          n: 'Test City',
          s: 'TX',
          p: 50000,
          g: 4,
          conf: 45,
          auth: 1,
          why: ['Fallback to county'],
          tried: [0, 1, 2, 3, 4],
          blocked: 'no-municipal-gis',
          ts: '2025-11-19T10:00:00Z',
          aid: 'agt-003',
        },
      ];

      for (const entry of entries) {
        await appendProvenance(entry, TEST_DIR);
      }
    });

    it('should filter by granularity tier', async () => {
      const results = await queryProvenance({ tier: 1 }, TEST_DIR);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.g === 1)).toBe(true);
    });

    it('should filter by state', async () => {
      const results = await queryProvenance({ state: 'CA' }, TEST_DIR);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.s === 'CA')).toBe(true);
    });

    it('should filter by blocker code', async () => {
      const results = await queryProvenance({ blockerCode: 'at-large-governance' }, TEST_DIR);
      expect(results).toHaveLength(1);
      expect(results[0].f).toBe('0807850');
    });

    it('should filter by minimum confidence', async () => {
      const results = await queryProvenance({ minConfidence: 85 }, TEST_DIR);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.conf >= 85)).toBe(true);
    });

    it('should filter by FIPS code', async () => {
      const results = await queryProvenance({ fips: '0666000' }, TEST_DIR);
      expect(results).toHaveLength(1);
      expect(results[0].n).toBe('San Diego');
    });

    it('should combine multiple filters', async () => {
      const results = await queryProvenance({
        state: 'CA',
        tier: 1,
        minConfidence: 85,
      }, TEST_DIR);
      expect(results).toHaveLength(1);
      expect(results[0].f).toBe('0666000');
    });

    it('should return empty array when no matches', async () => {
      const results = await queryProvenance({ state: 'XX' }, TEST_DIR);
      expect(results).toHaveLength(0);
    });

    it('should handle date range filtering', async () => {
      const results = await queryProvenance({
        startDate: '2025-11-19T08:00:00Z',
        endDate: '2025-11-19T10:00:00Z',
      }, TEST_DIR);
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.every((r) => r.ts >= '2025-11-19T08:00:00Z' && r.ts <= '2025-11-19T10:00:00Z')).toBe(true);
    });
  });

  describe('getProvenanceStats', () => {
    beforeEach(async () => {
      // Seed test data
      const entries: ProvenanceEntry[] = [
        {
          f: '0666000',
          g: 1,
          conf: 85,
          auth: 3,
          why: ['Test'],
          tried: [1],
          blocked: null,
          ts: '2025-11-19T07:42:00Z',
          aid: 'agt-001',
        },
        {
          f: '0668000',
          g: 1,
          conf: 82,
          auth: 2,
          why: ['Test'],
          tried: [1],
          blocked: null,
          ts: '2025-11-19T08:15:00Z',
          aid: 'agt-001',
        },
        {
          f: '0807850',
          g: 2,
          conf: 100,
          auth: 5,
          why: ['Test'],
          tried: [2],
          blocked: 'at-large-governance',
          ts: '2025-11-19T09:30:00Z',
          aid: 'agt-002',
        },
      ];

      for (const entry of entries) {
        await appendProvenance(entry, TEST_DIR);
      }
    });

    it('should calculate correct statistics', async () => {
      const stats = await getProvenanceStats(TEST_DIR);

      expect(stats.totalEntries).toBe(3);
      expect(stats.byTier[1]).toBe(2);
      expect(stats.byTier[2]).toBe(1);
      expect(stats.byAuthority[2]).toBe(1);
      expect(stats.byAuthority[3]).toBe(1);
      expect(stats.byAuthority[5]).toBe(1);
      expect(stats.byBlocker['at-large-governance']).toBe(1);
      expect(stats.avgConfidence).toBeCloseTo((85 + 82 + 100) / 3, 1);
    });

    it('should handle empty log', async () => {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
      const stats = await getProvenanceStats(TEST_DIR);

      expect(stats.totalEntries).toBe(0);
      expect(stats.avgConfidence).toBe(0);
    });
  });

  describe('Format compliance', () => {
    it('should produce compact entries (target ~150-350 bytes depending on URL)', async () => {
      // Test with SHORT URL (should be under 250 bytes)
      const shortUrlEntry: ProvenanceEntry = {
        f: '0666000',
        n: 'San Diego',
        s: 'CA',
        g: 1,
        fc: 9,
        conf: 85,
        auth: 3,
        src: 'arcgis',
        url: 'https://example.com/api',
        q: { v: true, t: 1, r: 474 },
        why: ['T1 success'],
        tried: [1],
        blocked: null,
        ts: '2025-11-19T07:42:00Z',
        aid: 'agt-001',
      };

      const shortSerialized = JSON.stringify(shortUrlEntry);
      expect(shortSerialized.length).toBeLessThan(250);

      // Test with REALISTIC URL (may be 250-450 bytes)
      const longUrlEntry: ProvenanceEntry = {
        f: '0666000',
        n: 'San Diego',
        s: 'CA',
        p: 1386932,
        g: 1,
        fc: 9,
        conf: 85,
        auth: 3,
        src: 'muni-gis',
        url: 'https://seshat.datasd.org/sde/council_districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
        q: { v: true, t: 1, r: 474, d: '2021-12-14' },
        why: ['T0 blocked: No precinct data', 'T1 success: 9 districts found'],
        tried: [0, 1],
        blocked: null,
        ts: '2025-11-19T07:42:00Z',
        aid: 'agt-001',
      };

      const longSerialized = JSON.stringify(longUrlEntry);
      expect(longSerialized.length).toBeLessThan(500); // Realistic upper bound

      // Log sizes for visibility
      console.log(`Short URL: ${shortSerialized.length} bytes, Long URL: ${longSerialized.length} bytes`);
    });

    it('should handle minimal entries under 150 bytes', async () => {
      const minimalEntry: ProvenanceEntry = {
        f: '0666000',
        g: 1,
        conf: 85,
        auth: 3,
        why: ['T1 success'],
        tried: [1],
        blocked: null,
        ts: '2025-11-19T07:42:00Z',
        aid: 'agt-001',
      };

      const serialized = JSON.stringify(minimalEntry);
      expect(serialized.length).toBeLessThan(150);
    });
  });

  describe('Compression efficiency', () => {
    it('should compress large batch efficiently', async () => {
      const entries: ProvenanceEntry[] = Array.from({ length: 100 }, (_, i) => ({
        f: i.toString().padStart(7, '0'),
        g: (i % 5) as 0 | 1 | 2 | 3 | 4,
        conf: 50 + (i % 50),
        auth: (i % 6) as 0 | 1 | 2 | 3 | 4 | 5,
        why: [`Discovery attempt ${i}`],
        tried: [0, 1],
        blocked: i % 10 === 0 ? 'portal-404' : null,
        ts: new Date().toISOString(),
        aid: `agt-${(i % 3).toString().padStart(3, '0')}`,
      }));

      for (const entry of entries) {
        await appendProvenance(entry, TEST_DIR);
      }

      // Check compressed file size (all entries have FIPS starting with 00, so shard 00)
      const year = new Date().getUTCFullYear();
      const month = String(new Date().getUTCMonth() + 1).padStart(2, '0');
      const logPath = path.join(TEST_DIR, `${year}-${month}`, 'discovery-log-00.ndjson.gz');

      const stats = await fs.stat(logPath);
      const avgBytesPerEntry = stats.size / 100;

      // Gzip should achieve significant compression
      expect(avgBytesPerEntry).toBeLessThan(200);
    });
  });
});
