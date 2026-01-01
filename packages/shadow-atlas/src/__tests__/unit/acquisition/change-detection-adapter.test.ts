/**
 * ChangeDetectionAdapter Unit Tests
 *
 * Tests for the TIGER source change detection adapter:
 * - detectChanges() returns changed layers when ETags differ
 * - detectChanges() returns empty when no changes
 * - updateChecksums() persists to cache file
 * - loadCache()/saveCache() round-trips correctly
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ChangeDetectionAdapter } from '../../../acquisition/change-detection-adapter.js';
import type { ChangeReport } from '../../../acquisition/change-detector.js';

const TEST_STORAGE_DIR = join(process.cwd(), 'test-output', 'change-detection-adapter-test');
const TEST_CACHE_PATH = join(TEST_STORAGE_DIR, 'checksums.json');

/**
 * Mock fetch for testing HTTP HEAD requests
 */
function mockFetch(
  etagsByUrl: Record<string, string | null>,
  lastModifiedByUrl?: Record<string, string | null>
): void {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    const etag = etagsByUrl[url] ?? null;
    const lastModified = lastModifiedByUrl?.[url] ?? null;

    if (etag === null && lastModified === null) {
      // Simulate 404 or error
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
      });
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({
        ...(etag ? { etag } : {}),
        ...(lastModified ? { 'last-modified': lastModified } : {}),
      }),
    });
  });
}

describe('ChangeDetectionAdapter', () => {
  beforeEach(async () => {
    await mkdir(TEST_STORAGE_DIR, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();

    // Clean up test directory
    try {
      await rm(TEST_STORAGE_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('getSourceUrl', () => {
    it('should generate correct TIGER CD URL', () => {
      const adapter = new ChangeDetectionAdapter({
        sources: [],
        storageDir: TEST_STORAGE_DIR,
      });

      const url = adapter.getSourceUrl('cd', '55', 2024);

      expect(url).toBe('https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_55_cd.zip');
    });

    it('should generate correct TIGER SLDU URL', () => {
      const adapter = new ChangeDetectionAdapter({
        sources: [],
        storageDir: TEST_STORAGE_DIR,
      });

      const url = adapter.getSourceUrl('sldu', '06', 2024);

      expect(url).toBe('https://www2.census.gov/geo/tiger/TIGER2024/SLDU/tl_2024_06_sldu.zip');
    });

    it('should generate correct TIGER county URL', () => {
      const adapter = new ChangeDetectionAdapter({
        sources: [],
        storageDir: TEST_STORAGE_DIR,
      });

      const url = adapter.getSourceUrl('county', '01', 2024);

      expect(url).toBe('https://www2.census.gov/geo/tiger/TIGER2024/COUNTY/tl_2024_01_county.zip');
    });
  });

  describe('loadCache', () => {
    it('should initialize with empty cache when file does not exist', async () => {
      const adapter = new ChangeDetectionAdapter({
        sources: [],
        storageDir: TEST_STORAGE_DIR,
        checksumCachePath: TEST_CACHE_PATH,
      });

      await adapter.loadCache();

      // No error thrown - cache initialized to empty
    });

    it('should load cache from existing file', async () => {
      // Create a cache file
      const cacheData = {
        lastChecked: '2024-01-15T00:00:00.000Z',
        sources: {
          'cd:55:2024': {
            etag: '"abc123"',
            lastModified: null,
            checkedAt: '2024-01-15T00:00:00.000Z',
          },
        },
      };

      await mkdir(TEST_STORAGE_DIR, { recursive: true });
      await writeFile(TEST_CACHE_PATH, JSON.stringify(cacheData));

      const adapter = new ChangeDetectionAdapter({
        sources: [],
        storageDir: TEST_STORAGE_DIR,
        checksumCachePath: TEST_CACHE_PATH,
      });

      await adapter.loadCache();

      // Cache should be loaded (tested via detectChanges below)
    });
  });

  describe('saveCache', () => {
    it('should persist cache to file', async () => {
      const adapter = new ChangeDetectionAdapter({
        sources: [
          {
            layerType: 'cd',
            vintage: 2024,
            states: ['55'],
            updateTriggers: [{ type: 'annual', month: 9 }],
          },
        ],
        storageDir: TEST_STORAGE_DIR,
        checksumCachePath: TEST_CACHE_PATH,
      });

      await adapter.loadCache();

      // Create a mock report to update checksums
      const reports: readonly ChangeReport[] = [
        {
          sourceId: 'cd:55:2024',
          url: 'https://example.com',
          oldChecksum: null,
          newChecksum: '"new-etag-123"',
          detectedAt: '2024-01-15T00:00:00.000Z',
          trigger: 'scheduled',
          changeType: 'new',
        },
      ];

      await adapter.updateChecksums(reports);

      // Read the saved file
      const saved = await readFile(TEST_CACHE_PATH, 'utf-8');
      const parsed = JSON.parse(saved) as {
        lastChecked: string;
        sources: Record<string, {
          etag: string | null;
          lastModified: string | null;
          checkedAt: string;
        }>;
      };

      expect(parsed.sources['cd:55:2024']).toBeDefined();
      expect(parsed.sources['cd:55:2024'].etag).toBe('"new-etag-123"');
    });
  });

  describe('loadCache/saveCache round-trip', () => {
    it('should correctly round-trip cache data', async () => {
      const adapter1 = new ChangeDetectionAdapter({
        sources: [],
        storageDir: TEST_STORAGE_DIR,
        checksumCachePath: TEST_CACHE_PATH,
      });

      await adapter1.loadCache();

      // Update with some data
      const reports: readonly ChangeReport[] = [
        {
          sourceId: 'cd:55:2024',
          url: 'https://example.com/cd',
          oldChecksum: null,
          newChecksum: '"etag-cd-55"',
          detectedAt: '2024-01-15T00:00:00.000Z',
          trigger: 'scheduled',
          changeType: 'new',
        },
        {
          sourceId: 'sldu:06:2024',
          url: 'https://example.com/sldu',
          oldChecksum: null,
          newChecksum: 'Wed, 21 Oct 2024 07:28:00 GMT', // Last-Modified instead of ETag
          detectedAt: '2024-01-15T01:00:00.000Z',
          trigger: 'scheduled',
          changeType: 'new',
        },
      ];

      await adapter1.updateChecksums(reports);

      // Create new adapter and load
      const adapter2 = new ChangeDetectionAdapter({
        sources: [],
        storageDir: TEST_STORAGE_DIR,
        checksumCachePath: TEST_CACHE_PATH,
      });

      await adapter2.loadCache();

      // Now check - the cached etags should match
      const url55 = adapter2.getSourceUrl('cd', '55', 2024);
      mockFetch({
        [url55]: '"etag-cd-55"', // Same ETag
      });

      // Configure sources and check
      const adapterWithSources = new ChangeDetectionAdapter({
        sources: [
          {
            layerType: 'cd',
            vintage: 2024,
            states: ['55'],
            updateTriggers: [{ type: 'annual', month: 9 }],
          },
        ],
        storageDir: TEST_STORAGE_DIR,
        checksumCachePath: TEST_CACHE_PATH,
      });

      await adapterWithSources.loadCache();

      // Read the cache file directly to verify
      const saved = await readFile(TEST_CACHE_PATH, 'utf-8');
      const parsed = JSON.parse(saved) as {
        lastChecked: string;
        sources: Record<string, {
          etag: string | null;
          lastModified: string | null;
          checkedAt: string;
        }>;
      };

      expect(parsed.sources['cd:55:2024'].etag).toBe('"etag-cd-55"');
      expect(parsed.sources['sldu:06:2024'].lastModified).toBe('Wed, 21 Oct 2024 07:28:00 GMT');
    });
  });

  describe('detectChanges', () => {
    it('should return changed layers when ETags differ', async () => {
      const url = 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_55_cd.zip';

      mockFetch({
        [url]: '"new-etag-xyz"',
      });

      const adapter = new ChangeDetectionAdapter({
        sources: [
          {
            layerType: 'cd',
            vintage: 2024,
            states: ['55'],
            updateTriggers: [{ type: 'annual', month: 9 }],
          },
        ],
        storageDir: TEST_STORAGE_DIR,
        checksumCachePath: TEST_CACHE_PATH,
      });

      await adapter.loadCache();

      const result = await adapter.detectChanges();

      expect(result.changedLayers).toContain('cd');
      expect(result.changedStates).toContain('55');
      expect(result.reports.length).toBe(1);
      expect(result.reports[0].changeType).toBe('new'); // No previous cache
      expect(result.reports[0].newChecksum).toBe('"new-etag-xyz"');
    });

    it('should return empty when checksums match', async () => {
      // First, set up cache with existing checksum
      const cacheData = {
        lastChecked: '2024-01-15T00:00:00.000Z',
        sources: {
          'cd:55:2024': {
            etag: '"same-etag"',
            lastModified: null,
            checkedAt: '2024-01-15T00:00:00.000Z',
          },
        },
      };

      await mkdir(TEST_STORAGE_DIR, { recursive: true });
      await writeFile(TEST_CACHE_PATH, JSON.stringify(cacheData));

      const url = 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_55_cd.zip';

      mockFetch({
        [url]: '"same-etag"', // Same ETag as cached
      });

      const adapter = new ChangeDetectionAdapter({
        sources: [
          {
            layerType: 'cd',
            vintage: 2024,
            states: ['55'],
            updateTriggers: [{ type: 'annual', month: 9 }],
          },
        ],
        storageDir: TEST_STORAGE_DIR,
        checksumCachePath: TEST_CACHE_PATH,
      });

      await adapter.loadCache();

      const result = await adapter.detectChanges();

      expect(result.changedLayers).toEqual([]);
      expect(result.changedStates).toEqual([]);
      expect(result.reports.length).toBe(0);
    });

    it('should detect changes for multiple layers and states', async () => {
      const url55 = 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_55_cd.zip';
      const url06 = 'https://www2.census.gov/geo/tiger/TIGER2024/SLDU/tl_2024_06_sldu.zip';

      mockFetch({
        [url55]: '"etag-cd-55"',
        [url06]: '"etag-sldu-06"',
      });

      const adapter = new ChangeDetectionAdapter({
        sources: [
          {
            layerType: 'cd',
            vintage: 2024,
            states: ['55'],
            updateTriggers: [{ type: 'annual', month: 9 }],
          },
          {
            layerType: 'sldu',
            vintage: 2024,
            states: ['06'],
            updateTriggers: [{ type: 'annual', month: 9 }],
          },
        ],
        storageDir: TEST_STORAGE_DIR,
        checksumCachePath: TEST_CACHE_PATH,
      });

      await adapter.loadCache();

      const result = await adapter.detectChanges();

      expect(result.changedLayers.length).toBe(2);
      expect(result.changedLayers).toContain('cd');
      expect(result.changedLayers).toContain('sldu');
      expect(result.changedStates).toContain('55');
      expect(result.changedStates).toContain('06');
      expect(result.reports.length).toBe(2);
    });

    it('should handle mixed changed/unchanged sources', async () => {
      // Cache with one existing source
      const cacheData = {
        lastChecked: '2024-01-15T00:00:00.000Z',
        sources: {
          'cd:55:2024': {
            etag: '"unchanged-etag"',
            lastModified: null,
            checkedAt: '2024-01-15T00:00:00.000Z',
          },
        },
      };

      await mkdir(TEST_STORAGE_DIR, { recursive: true });
      await writeFile(TEST_CACHE_PATH, JSON.stringify(cacheData));

      const url55 = 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_55_cd.zip';
      const url06 = 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_06_cd.zip';

      mockFetch({
        [url55]: '"unchanged-etag"', // Same as cached
        [url06]: '"new-ca-etag"', // New source
      });

      const adapter = new ChangeDetectionAdapter({
        sources: [
          {
            layerType: 'cd',
            vintage: 2024,
            states: ['55', '06'],
            updateTriggers: [{ type: 'annual', month: 9 }],
          },
        ],
        storageDir: TEST_STORAGE_DIR,
        checksumCachePath: TEST_CACHE_PATH,
      });

      await adapter.loadCache();

      const result = await adapter.detectChanges();

      // Only CA (06) should be changed
      expect(result.changedLayers).toEqual(['cd']);
      expect(result.changedStates).toEqual(['06']);
      expect(result.reports.length).toBe(1);
      expect(result.reports[0].sourceId).toBe('cd:06:2024');
    });

    it('should handle network errors gracefully', async () => {
      const url = 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_55_cd.zip';

      // Simulate network error
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const adapter = new ChangeDetectionAdapter({
        sources: [
          {
            layerType: 'cd',
            vintage: 2024,
            states: ['55'],
            updateTriggers: [{ type: 'annual', month: 9 }],
          },
        ],
        storageDir: TEST_STORAGE_DIR,
        checksumCachePath: TEST_CACHE_PATH,
      });

      await adapter.loadCache();

      // Should not throw
      const result = await adapter.detectChanges();

      expect(result.changedLayers).toEqual([]);
      expect(result.reports.length).toBe(0);
    });

    it('should use Last-Modified when ETag unavailable', async () => {
      const url = 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_55_cd.zip';

      mockFetch(
        { [url]: null }, // No ETag
        { [url]: 'Wed, 21 Oct 2024 07:28:00 GMT' } // Last-Modified
      );

      const adapter = new ChangeDetectionAdapter({
        sources: [
          {
            layerType: 'cd',
            vintage: 2024,
            states: ['55'],
            updateTriggers: [{ type: 'annual', month: 9 }],
          },
        ],
        storageDir: TEST_STORAGE_DIR,
        checksumCachePath: TEST_CACHE_PATH,
      });

      await adapter.loadCache();

      const result = await adapter.detectChanges();

      expect(result.reports.length).toBe(1);
      expect(result.reports[0].newChecksum).toBe('Wed, 21 Oct 2024 07:28:00 GMT');
    });
  });

  describe('updateChecksums', () => {
    it('should update cache with ETag checksums', async () => {
      const adapter = new ChangeDetectionAdapter({
        sources: [],
        storageDir: TEST_STORAGE_DIR,
        checksumCachePath: TEST_CACHE_PATH,
      });

      await adapter.loadCache();

      const reports: readonly ChangeReport[] = [
        {
          sourceId: 'cd:55:2024',
          url: 'https://example.com',
          oldChecksum: null,
          newChecksum: '"etag-value-123"',
          detectedAt: '2024-01-15T00:00:00.000Z',
          trigger: 'scheduled',
          changeType: 'new',
        },
      ];

      await adapter.updateChecksums(reports);

      // Read cache file
      const saved = await readFile(TEST_CACHE_PATH, 'utf-8');
      const parsed = JSON.parse(saved) as {
        lastChecked: string;
        sources: Record<string, {
          etag: string | null;
          lastModified: string | null;
          checkedAt: string;
        }>;
      };

      expect(parsed.sources['cd:55:2024'].etag).toBe('"etag-value-123"');
      expect(parsed.sources['cd:55:2024'].lastModified).toBeNull();
    });

    it('should update cache with Last-Modified checksums', async () => {
      const adapter = new ChangeDetectionAdapter({
        sources: [],
        storageDir: TEST_STORAGE_DIR,
        checksumCachePath: TEST_CACHE_PATH,
      });

      await adapter.loadCache();

      const reports: readonly ChangeReport[] = [
        {
          sourceId: 'sldu:06:2024',
          url: 'https://example.com',
          oldChecksum: null,
          newChecksum: 'Wed, 21 Oct 2024 07:28:00 GMT', // Not quoted - Last-Modified
          detectedAt: '2024-01-15T00:00:00.000Z',
          trigger: 'scheduled',
          changeType: 'new',
        },
      ];

      await adapter.updateChecksums(reports);

      // Read cache file
      const saved = await readFile(TEST_CACHE_PATH, 'utf-8');
      const parsed = JSON.parse(saved) as {
        lastChecked: string;
        sources: Record<string, {
          etag: string | null;
          lastModified: string | null;
          checkedAt: string;
        }>;
      };

      expect(parsed.sources['sldu:06:2024'].etag).toBeNull();
      expect(parsed.sources['sldu:06:2024'].lastModified).toBe('Wed, 21 Oct 2024 07:28:00 GMT');
    });

    it('should update lastChecked timestamp', async () => {
      const adapter = new ChangeDetectionAdapter({
        sources: [],
        storageDir: TEST_STORAGE_DIR,
        checksumCachePath: TEST_CACHE_PATH,
      });

      await adapter.loadCache();

      const beforeUpdate = Date.now();

      const reports: readonly ChangeReport[] = [
        {
          sourceId: 'cd:55:2024',
          url: 'https://example.com',
          oldChecksum: null,
          newChecksum: '"etag"',
          detectedAt: new Date().toISOString(),
          trigger: 'scheduled',
          changeType: 'new',
        },
      ];

      await adapter.updateChecksums(reports);

      const afterUpdate = Date.now();

      // Read cache file
      const saved = await readFile(TEST_CACHE_PATH, 'utf-8');
      const parsed = JSON.parse(saved) as {
        lastChecked: string;
        sources: Record<string, unknown>;
      };

      const lastCheckedTime = new Date(parsed.lastChecked).getTime();
      expect(lastCheckedTime).toBeGreaterThanOrEqual(beforeUpdate);
      expect(lastCheckedTime).toBeLessThanOrEqual(afterUpdate);
    });
  });

  describe('source expansion', () => {
    it('should expand "all" states to full FIPS list', async () => {
      // Create URL mocks for all 51 states
      const urlMocks: Record<string, string> = {};
      const stateFips = [
        '01', '02', '04', '05', '06', '08', '09', '10', '11', '12',
        '13', '15', '16', '17', '18', '19', '20', '21', '22', '23',
        '24', '25', '26', '27', '28', '29', '30', '31', '32', '33',
        '34', '35', '36', '37', '38', '39', '40', '41', '42', '44',
        '45', '46', '47', '48', '49', '50', '51', '53', '54', '55',
        '56',
      ];

      for (const fips of stateFips) {
        const url = `https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_${fips}_cd.zip`;
        urlMocks[url] = `"etag-${fips}"`;
      }

      mockFetch(urlMocks);

      const adapter = new ChangeDetectionAdapter({
        sources: [
          {
            layerType: 'cd',
            vintage: 2024,
            states: ['all'], // Should expand to all states
            updateTriggers: [{ type: 'annual', month: 9 }],
          },
        ],
        storageDir: TEST_STORAGE_DIR,
        checksumCachePath: TEST_CACHE_PATH,
      });

      await adapter.loadCache();

      const result = await adapter.detectChanges();

      // Should detect changes for all 51 states
      expect(result.changedStates.length).toBe(51);
      expect(result.reports.length).toBe(51);
    });
  });
});
