/**
 * Coverage Analyzer Test Suite
 *
 * CRITICAL TYPE SAFETY: Coverage analysis drives agent decisions.
 * Tests validate logic preventing wasted discovery budget.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  analyzeCoverage,
  getStaleData,
  getQualityMetrics,
  getBlockerAnalysis,
  type CityInput,
} from '../../../services/coverage-analyzer.js';
import { appendProvenance, type ProvenanceEntry } from '../../../services/provenance-writer.js';

const TEST_BASE_DIR = './test-coverage-isolation/discovery-attempts';

describe('Coverage Analyzer', () => {
  beforeEach(async () => {
    // Clean up test directory (parent of discovery-attempts and discovery-staging)
    try {
      await fs.rm('./test-coverage-isolation', { recursive: true });
    } catch {
      // Directory doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm('./test-coverage-isolation', { recursive: true });
    } catch {
      // Directory doesn't exist
    }
  });

  describe('analyzeCoverage', () => {
    it('should detect cities with no data', async () => {
      const cityList: readonly CityInput[] = [
        { fips: '0666000', name: 'San Diego', state: 'CA', population: 1386932 },
        { fips: '9999999', name: 'Test City', state: 'XX', population: 100000 },
      ];

      const stats = await analyzeCoverage(cityList, TEST_BASE_DIR);

      // San Diego is in known portals, Test City is not
      expect(stats.totalCities).toBe(2);
      expect(stats.coveredCities).toBeGreaterThanOrEqual(1); // At least San Diego
      expect(stats.topGaps.length).toBeGreaterThanOrEqual(1);
    });

    it('should prioritize gaps by population', async () => {
      const cityList: readonly CityInput[] = [
        { fips: '1111111', name: 'Small City', state: 'XX', population: 10000 },
        { fips: '2222222', name: 'Large City', state: 'XX', population: 1000000 },
      ];

      const stats = await analyzeCoverage(cityList, TEST_BASE_DIR);

      // Both cities have no data, but Large City should be higher priority
      expect(stats.topGaps[0].population).toBe(1000000);
      expect(stats.topGaps[1].population).toBe(10000);
    });

    it('should count successful discoveries as covered', async () => {
      const cityList: readonly CityInput[] = [
        { fips: '1111111', name: 'Test City', state: 'XX', population: 100000 },
      ];

      // Add successful discovery
      const entry: ProvenanceEntry = {
        f: '1111111',
        n: 'Test City',
        s: 'XX',
        p: 100000,
        g: 1, // Tier 1 (council districts)
        fc: 9,
        conf: 85,
        auth: 3,
        why: ['Found council districts'],
        tried: [0, 1],
        blocked: null, // Success
        ts: new Date().toISOString(),
        aid: 'test-001',
      };

      await appendProvenance(entry, TEST_BASE_DIR);

      const stats = await analyzeCoverage(cityList, TEST_BASE_DIR);

      expect(stats.coveredCities).toBe(1);
      expect(stats.coveragePercent).toBe(100);
    });

    it('should not count blocked discoveries as covered', async () => {
      const cityList: readonly CityInput[] = [
        { fips: '1111111', name: 'Test City', state: 'XX', population: 100000 },
      ];

      // Add blocked discovery
      const entry: ProvenanceEntry = {
        f: '1111111',
        n: 'Test City',
        s: 'XX',
        p: 100000,
        g: 2, // Tier 2 (fallback)
        fc: 1,
        conf: 30,
        auth: 2,
        why: ['No council districts found'],
        tried: [0, 1, 2],
        blocked: 'at-large-governance',
        ts: new Date().toISOString(),
        aid: 'test-001',
      };

      await appendProvenance(entry, TEST_BASE_DIR);

      const stats = await analyzeCoverage(cityList, TEST_BASE_DIR);

      expect(stats.coveredCities).toBe(0);
      expect(stats.topGaps.length).toBe(1);
    });

    it('should prefer known portals over provenance', async () => {
      const cityList: readonly CityInput[] = [
        { fips: '0666000', name: 'San Diego', state: 'CA', population: 1386932 },
      ];

      // Add lower-confidence provenance entry
      const entry: ProvenanceEntry = {
        f: '0666000',
        n: 'San Diego',
        s: 'CA',
        p: 1386932,
        g: 2, // Tier 2 (worse than known portal)
        fc: 1,
        conf: 50,
        auth: 2,
        why: ['Found municipal boundary'],
        tried: [0, 1, 2],
        blocked: null,
        ts: new Date().toISOString(),
        aid: 'test-001',
      };

      await appendProvenance(entry, TEST_BASE_DIR);

      const stats = await analyzeCoverage(cityList, TEST_BASE_DIR);

      // Should use known portal (Tier 1) instead of provenance (Tier 2)
      const coverage = stats.topGaps.find(c => c.fips === '0666000');
      expect(coverage).toBeUndefined(); // San Diego should not be in gaps (it's covered)
    });

    it('should calculate state-level statistics', async () => {
      const cityList: readonly CityInput[] = [
        { fips: '0666000', name: 'San Diego', state: 'CA', population: 1386932 },
        { fips: '0667000', name: 'San Jose', state: 'CA', population: 1013240 },
        { fips: '4805000', name: 'Austin', state: 'TX', population: 961855 },
      ];

      const stats = await analyzeCoverage(cityList, TEST_BASE_DIR);

      expect(stats.byState['CA']).toBeDefined();
      expect(stats.byState['TX']).toBeDefined();
      expect(stats.byState['CA'].total).toBeGreaterThanOrEqual(2);
      expect(stats.byState['TX'].total).toBeGreaterThanOrEqual(1);
    });

    it('should use latest entry when multiple exist', async () => {
      const cityList: readonly CityInput[] = [
        { fips: '1111111', name: 'Test City', state: 'XX', population: 100000 },
      ];

      // Add old entry (Tier 2)
      const oldEntry: ProvenanceEntry = {
        f: '1111111',
        n: 'Test City',
        s: 'XX',
        p: 100000,
        g: 2,
        fc: 1,
        conf: 50,
        auth: 2,
        why: ['Old discovery'],
        tried: [0, 1, 2],
        blocked: null,
        ts: '2020-01-01T00:00:00.000Z',
        aid: 'test-001',
      };

      // Add new entry (Tier 1)
      const newEntry: ProvenanceEntry = {
        f: '1111111',
        n: 'Test City',
        s: 'XX',
        p: 100000,
        g: 1,
        fc: 9,
        conf: 85,
        auth: 3,
        why: ['New discovery'],
        tried: [0, 1],
        blocked: null,
        ts: new Date().toISOString(),
        aid: 'test-002',
      };

      await appendProvenance(oldEntry, TEST_BASE_DIR);
      await appendProvenance(newEntry, TEST_BASE_DIR);

      const stats = await analyzeCoverage(cityList, TEST_BASE_DIR);

      // Should use new entry (Tier 1)
      expect(stats.coveredCities).toBe(1);
      expect(stats.byTier[1]).toBe(1);
      expect(stats.byTier[2]).toBeUndefined();
    });
  });

  describe('getStaleData', () => {
    it('should detect stale provenance entries', async () => {
      const oldEntry: ProvenanceEntry = {
        f: '1111111',
        n: 'Test City',
        s: 'XX',
        p: 100000,
        g: 1,
        fc: 9,
        conf: 85,
        auth: 3,
        why: ['Old discovery'],
        tried: [0, 1],
        blocked: null,
        ts: '2020-01-01T00:00:00.000Z', // Very old
        aid: 'test-001',
      };

      await appendProvenance(oldEntry, TEST_BASE_DIR);

      const stale = await getStaleData(90, TEST_BASE_DIR);

      expect(stale.length).toBe(1);
      expect(stale[0].fips).toBe('1111111');
    });

    it('should not flag fresh data as stale', async () => {
      const freshEntry: ProvenanceEntry = {
        f: '1111111',
        n: 'Test City',
        s: 'XX',
        p: 100000,
        g: 1,
        fc: 9,
        conf: 85,
        auth: 3,
        why: ['Fresh discovery'],
        tried: [0, 1],
        blocked: null,
        ts: new Date().toISOString(), // Fresh
        aid: 'test-001',
      };

      await appendProvenance(freshEntry, TEST_BASE_DIR);

      const stale = await getStaleData(90, TEST_BASE_DIR);

      expect(stale.length).toBe(0);
    });

    it('should sort stale data by priority', async () => {
      const entry1: ProvenanceEntry = {
        f: '1111111',
        n: 'Small City',
        s: 'XX',
        p: 10000,
        g: 1,
        fc: 9,
        conf: 85,
        auth: 3,
        why: ['Old discovery'],
        tried: [0, 1],
        blocked: null,
        ts: '2020-01-01T00:00:00.000Z',
        aid: 'test-001',
      };

      const entry2: ProvenanceEntry = {
        f: '2222222',
        n: 'Large City',
        s: 'XX',
        p: 1000000,
        g: 1,
        fc: 9,
        conf: 85,
        auth: 3,
        why: ['Old discovery'],
        tried: [0, 1],
        blocked: null,
        ts: '2020-01-01T00:00:00.000Z',
        aid: 'test-002',
      };

      await appendProvenance(entry1, TEST_BASE_DIR);
      await appendProvenance(entry2, TEST_BASE_DIR);

      const stale = await getStaleData(90, TEST_BASE_DIR);

      expect(stale[0].population).toBe(1000000);
      expect(stale[1].population).toBe(10000);
    });
  });

  describe('getQualityMetrics', () => {
    it('should calculate average confidence', async () => {
      const entry1: ProvenanceEntry = {
        f: '1111111',
        n: 'City 1',
        s: 'XX',
        p: 100000,
        g: 1,
        fc: 9,
        conf: 80,
        auth: 3,
        why: ['Discovery 1'],
        tried: [0, 1],
        blocked: null,
        ts: new Date().toISOString(),
        aid: 'test-001',
      };

      const entry2: ProvenanceEntry = {
        f: '2222222',
        n: 'City 2',
        s: 'XX',
        p: 100000,
        g: 1,
        fc: 9,
        conf: 90,
        auth: 3,
        why: ['Discovery 2'],
        tried: [0, 1],
        blocked: null,
        ts: new Date().toISOString(),
        aid: 'test-002',
      };

      await appendProvenance(entry1, TEST_BASE_DIR);
      await appendProvenance(entry2, TEST_BASE_DIR);

      const metrics = await getQualityMetrics(TEST_BASE_DIR);

      expect(metrics.avgConfidence).toBe(85); // (80 + 90) / 2
    });

    it('should count low confidence entries', async () => {
      const lowConf: ProvenanceEntry = {
        f: '1111111',
        n: 'Low Confidence City',
        s: 'XX',
        p: 100000,
        g: 2,
        fc: 1,
        conf: 60,
        auth: 2,
        why: ['Low confidence discovery'],
        tried: [0, 1, 2],
        blocked: null,
        ts: new Date().toISOString(),
        aid: 'test-001',
      };

      await appendProvenance(lowConf, TEST_BASE_DIR);

      const metrics = await getQualityMetrics(TEST_BASE_DIR);

      expect(metrics.lowConfidence).toBe(1);
    });

    it('should exclude blocked discoveries from metrics', async () => {
      const blocked: ProvenanceEntry = {
        f: '1111111',
        n: 'Blocked City',
        s: 'XX',
        p: 100000,
        g: 2,
        fc: 1,
        conf: 30,
        auth: 2,
        why: ['Blocked discovery'],
        tried: [0, 1, 2],
        blocked: 'at-large-governance',
        ts: new Date().toISOString(),
        aid: 'test-001',
      };

      await appendProvenance(blocked, TEST_BASE_DIR);

      const metrics = await getQualityMetrics(TEST_BASE_DIR);

      // Should not include blocked entry in calculations
      expect(metrics.avgConfidence).toBe(0);
      expect(metrics.lowConfidence).toBe(0);
    });
  });

  describe('getBlockerAnalysis', () => {
    it('should group blockers by code', async () => {
      const blocked1: ProvenanceEntry = {
        f: '1111111',
        n: 'City 1',
        s: 'XX',
        p: 100000,
        g: 2,
        fc: 1,
        conf: 30,
        auth: 2,
        why: ['Blocked by at-large'],
        tried: [0, 1, 2],
        blocked: 'at-large-governance',
        ts: new Date().toISOString(),
        aid: 'test-001',
      };

      const blocked2: ProvenanceEntry = {
        f: '2222222',
        n: 'City 2',
        s: 'XX',
        p: 100000,
        g: 2,
        fc: 1,
        conf: 30,
        auth: 2,
        why: ['Blocked by at-large'],
        tried: [0, 1, 2],
        blocked: 'at-large-governance',
        ts: new Date().toISOString(),
        aid: 'test-002',
      };

      await appendProvenance(blocked1, TEST_BASE_DIR);
      await appendProvenance(blocked2, TEST_BASE_DIR);

      const blockers = await getBlockerAnalysis(TEST_BASE_DIR);

      expect(blockers['at-large-governance'].count).toBe(2);
    });

    it('should include example cities', async () => {
      const blocked: ProvenanceEntry = {
        f: '1111111',
        n: 'Example City',
        s: 'XX',
        p: 100000,
        g: 2,
        fc: 1,
        conf: 30,
        auth: 2,
        why: ['Blocked'],
        tried: [0, 1, 2],
        blocked: 'at-large-governance',
        ts: new Date().toISOString(),
        aid: 'test-001',
      };

      await appendProvenance(blocked, TEST_BASE_DIR);

      const blockers = await getBlockerAnalysis(TEST_BASE_DIR);

      expect(blockers['at-large-governance'].examples).toContain('Example City');
    });

    it('should skip successful discoveries', async () => {
      const success: ProvenanceEntry = {
        f: '1111111',
        n: 'Success City',
        s: 'XX',
        p: 100000,
        g: 1,
        fc: 9,
        conf: 85,
        auth: 3,
        why: ['Success'],
        tried: [0, 1],
        blocked: null, // Not blocked
        ts: new Date().toISOString(),
        aid: 'test-001',
      };

      await appendProvenance(success, TEST_BASE_DIR);

      const blockers = await getBlockerAnalysis(TEST_BASE_DIR);

      expect(Object.keys(blockers).length).toBe(0);
    });
  });
});
