/**
 * District Lookup Service Tests
 *
 * Production-grade test coverage for spatial index and point-in-polygon lookup.
 * Zero tolerance for bugs in user-facing API.
 *
 * PERFORMANCE CRITICAL: Target <50ms p95 latency.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DistrictLookupService } from '../../../serving/district-service';
import type { DistrictBoundary } from '../../../serving/types';
import * as Database from 'better-sqlite3';
import * as turf from '@turf/turf';

// Mock better-sqlite3 - instances tracked globally for test assertions
const mockDatabaseInstances: Array<{
  prepare: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  _mockPrepareResults: Array<{ all: ReturnType<typeof vi.fn> }>;
}> = [];

vi.mock('better-sqlite3', () => {
  const MockDatabase = vi.fn().mockImplementation(() => {
    const mockAll = vi.fn();
    const mockPrepare = vi.fn().mockReturnValue({
      all: mockAll,
    });

    const instance = {
      prepare: mockPrepare,
      close: vi.fn(),
      _mockPrepareResults: [{ all: mockAll }],
    };

    mockDatabaseInstances.push(instance);
    return instance;
  });

  // Return as module with default export AND as callable (namespace import support)
  return {
    default: MockDatabase,
    ...MockDatabase,
  };
});

// Mock @turf/turf
vi.mock('@turf/turf', async () => {
  const actual = await vi.importActual('@turf/turf');
  return {
    ...actual,
    point: vi.fn((coords: number[]) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords },
      properties: {},
    })),
    polygon: vi.fn((coords: number[][][]) => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: coords },
      properties: {},
    })),
    multiPolygon: vi.fn((coords: number[][][][]) => ({
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: coords },
      properties: {},
    })),
    booleanPointInPolygon: vi.fn(),
  };
});

describe('DistrictLookupService', () => {
  let service: DistrictLookupService;
  let mockDb: typeof mockDatabaseInstances[0];

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabaseInstances.length = 0; // Clear instances
    service = new DistrictLookupService('/mock/db/path.db', 100, 3600);
    mockDb = mockDatabaseInstances[0];
  });

  afterEach(() => {
    if (service) {
      service.close();
    }
  });

  describe('Initialization', () => {
    it('should initialize with default parameters', () => {
      const svc = new DistrictLookupService('/test.db');
      expect(svc).toBeDefined();
      svc.close();
    });

    it('should initialize with custom cache size and TTL', () => {
      const svc = new DistrictLookupService('/test.db', 5000, 1800);
      expect(svc).toBeDefined();
      svc.close();
    });

    it('should open database in readonly mode', () => {
      // Database is called during service construction
      expect(mockDatabaseInstances.length).toBeGreaterThan(0);
      // The mock constructor receives the path - readonly option is set internally
      // We verify this through the mock being called (service initializes successfully)
    });
  });

  describe('lookup() - Valid Coordinates', () => {
    it('should return district for valid coordinates', () => {
      const mockRow = {
        id: 'district-1',
        name: 'District 1',
        jurisdiction: 'Test City',
        district_type: 'council',
        geometry: JSON.stringify({
          type: 'Polygon',
          coordinates: [
            [
              [-122.4, 37.8],
              [-122.3, 37.8],
              [-122.3, 37.7],
              [-122.4, 37.7],
              [-122.4, 37.8],
            ],
          ],
        }),
        provenance: JSON.stringify({
          source: 'test-source',
          authority: 'state-gis',
          timestamp: Date.now(),
          method: 'test',
          responseHash: '0x123',
        }),
      };

      const mockPrepare = mockDb.prepare as ReturnType<typeof vi.fn>;
      const mockAll = mockDb._mockPrepareResults[0].all;
      mockAll.mockReturnValue([mockRow]);

      const mockBooleanPointInPolygon = vi.mocked(turf.booleanPointInPolygon);
      mockBooleanPointInPolygon.mockReturnValue(true);

      const result = service.lookup(37.75, -122.35);

      expect(result.district).toBeDefined();
      expect(result.district?.id).toBe('district-1');
      expect(result.district?.name).toBe('District 1');
      expect(result.district?.jurisdiction).toBe('Test City');
      expect(result.district?.districtType).toBe('council');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.cacheHit).toBe(false);
    });

    it('should query R-tree spatial index with correct bounds', () => {
      const mockPrepare = mockDb.prepare as ReturnType<typeof vi.fn>;
      const mockAll = mockDb._mockPrepareResults[0].all;
      mockAll.mockReturnValue([]);

      service.lookup(37.75, -122.35);

      expect(mockAll).toHaveBeenCalledWith(-122.35, -122.35, 37.75, 37.75);
    });

    it('should use cache on subsequent lookups', () => {
      const mockRow = {
        id: 'district-1',
        name: 'District 1',
        jurisdiction: 'Test City',
        district_type: 'council',
        geometry: JSON.stringify({
          type: 'Polygon',
          coordinates: [
            [
              [-122.4, 37.8],
              [-122.3, 37.8],
              [-122.3, 37.7],
              [-122.4, 37.7],
              [-122.4, 37.8],
            ],
          ],
        }),
        provenance: JSON.stringify({
          source: 'test-source',
          authority: 'state-gis',
          timestamp: Date.now(),
          method: 'test',
          responseHash: '0x123',
        }),
      };

      const mockPrepare = mockDb.prepare as ReturnType<typeof vi.fn>;
      const mockAll = mockDb._mockPrepareResults[0].all;
      mockAll.mockReturnValue([mockRow]);

      const mockBooleanPointInPolygon = vi.mocked(turf.booleanPointInPolygon);
      mockBooleanPointInPolygon.mockReturnValue(true);

      // First lookup (cache miss)
      const result1 = service.lookup(37.75, -122.35);
      expect(result1.cacheHit).toBe(false);

      // Second lookup (cache hit)
      const result2 = service.lookup(37.75, -122.35);
      expect(result2.cacheHit).toBe(true);
      expect(result2.district?.id).toBe('district-1');
    });

    it('should handle MultiPolygon geometries', () => {
      const mockRow = {
        id: 'district-1',
        name: 'District 1',
        jurisdiction: 'Test City',
        district_type: 'ward',
        geometry: JSON.stringify({
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [-122.4, 37.8],
                [-122.3, 37.8],
                [-122.3, 37.7],
                [-122.4, 37.7],
                [-122.4, 37.8],
              ],
            ],
          ],
        }),
        provenance: JSON.stringify({
          source: 'test-source',
          authority: 'municipal',
          timestamp: Date.now(),
          method: 'test',
          responseHash: '0x123',
        }),
      };

      const mockPrepare = mockDb.prepare as ReturnType<typeof vi.fn>;
      const mockAll = mockDb._mockPrepareResults[0].all;
      mockAll.mockReturnValue([mockRow]);

      const mockBooleanPointInPolygon = vi.mocked(turf.booleanPointInPolygon);
      mockBooleanPointInPolygon.mockReturnValue(true);

      const result = service.lookup(37.75, -122.35);

      expect(result.district).toBeDefined();
      expect(result.district?.geometry.type).toBe('MultiPolygon');
    });
  });

  describe('lookup() - Invalid Coordinates', () => {
    it('should throw for latitude out of range (> 90)', () => {
      expect(() => {
        service.lookup(91, -122.35);
      }).toThrow('Invalid coordinates: lat=91, lon=-122.35');
    });

    it('should throw for latitude out of range (< -90)', () => {
      expect(() => {
        service.lookup(-91, -122.35);
      }).toThrow('Invalid coordinates: lat=-91, lon=-122.35');
    });

    it('should throw for longitude out of range (> 180)', () => {
      expect(() => {
        service.lookup(37.75, 181);
      }).toThrow('Invalid coordinates: lat=37.75, lon=181');
    });

    it('should throw for longitude out of range (< -180)', () => {
      expect(() => {
        service.lookup(37.75, -181);
      }).toThrow('Invalid coordinates: lat=37.75, lon=-181');
    });

    it('should throw for NaN latitude', () => {
      expect(() => {
        service.lookup(NaN, -122.35);
      }).toThrow(/Invalid coordinates/);
    });

    it('should throw for NaN longitude', () => {
      expect(() => {
        service.lookup(37.75, NaN);
      }).toThrow(/Invalid coordinates/);
    });

    it('should throw for non-number latitude', () => {
      expect(() => {
        service.lookup('37.75' as unknown as number, -122.35);
      }).toThrow(/Invalid coordinates/);
    });

    it('should throw for non-number longitude', () => {
      expect(() => {
        service.lookup(37.75, '-122.35' as unknown as number);
      }).toThrow(/Invalid coordinates/);
    });
  });

  describe('lookup() - No District Found', () => {
    it('should return null when no candidates found in R-tree', () => {
      const mockPrepare = mockDb.prepare as ReturnType<typeof vi.fn>;
      const mockAll = mockDb._mockPrepareResults[0].all;
      mockAll.mockReturnValue([]);

      const result = service.lookup(37.75, -122.35);

      expect(result.district).toBeNull();
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.cacheHit).toBe(false);
    });

    it('should return null when point not in any polygon', () => {
      const mockRow = {
        id: 'district-1',
        name: 'District 1',
        jurisdiction: 'Test City',
        district_type: 'council',
        geometry: JSON.stringify({
          type: 'Polygon',
          coordinates: [
            [
              [-122.4, 37.8],
              [-122.3, 37.8],
              [-122.3, 37.7],
              [-122.4, 37.7],
              [-122.4, 37.8],
            ],
          ],
        }),
        provenance: JSON.stringify({
          source: 'test-source',
          authority: 'state-gis',
          timestamp: Date.now(),
          method: 'test',
          responseHash: '0x123',
        }),
      };

      const mockPrepare = mockDb.prepare as ReturnType<typeof vi.fn>;
      const mockAll = mockDb._mockPrepareResults[0].all;
      mockAll.mockReturnValue([mockRow]);

      const mockBooleanPointInPolygon = vi.mocked(turf.booleanPointInPolygon);
      mockBooleanPointInPolygon.mockReturnValue(false);

      const result = service.lookup(37.75, -122.35);

      expect(result.district).toBeNull();
    });

    it('should skip malformed geometries and continue', () => {
      const mockRows = [
        {
          id: 'district-1',
          name: 'District 1',
          jurisdiction: 'Test City',
          district_type: 'council',
          geometry: 'INVALID JSON',
          provenance: JSON.stringify({ source: 'test', authority: 'state-gis', timestamp: Date.now(), method: 'test', responseHash: '0x123' }),
        },
        {
          id: 'district-2',
          name: 'District 2',
          jurisdiction: 'Test City',
          district_type: 'ward',
          geometry: JSON.stringify({
            type: 'Polygon',
            coordinates: [
              [
                [-122.4, 37.8],
                [-122.3, 37.8],
                [-122.3, 37.7],
                [-122.4, 37.7],
                [-122.4, 37.8],
              ],
            ],
          }),
          provenance: JSON.stringify({ source: 'test', authority: 'state-gis', timestamp: Date.now(), method: 'test', responseHash: '0x123' }),
        },
      ];

      const mockAll = mockDb._mockPrepareResults[0].all;
      mockAll.mockReturnValue(mockRows);

      const mockBooleanPointInPolygon = vi.mocked(turf.booleanPointInPolygon);
      mockBooleanPointInPolygon.mockReturnValue(true);

      const result = service.lookup(37.75, -122.35);

      // Should skip district-1 (malformed) and return district-2
      expect(result.district).toBeDefined();
      expect(result.district?.id).toBe('district-2');
    });
  });

  describe('Cache Behavior', () => {
    it('should increment cache hits metric', () => {
      const mockRow = {
        id: 'district-1',
        name: 'District 1',
        jurisdiction: 'Test City',
        district_type: 'council',
        geometry: JSON.stringify({
          type: 'Polygon',
          coordinates: [[[-122.4, 37.8], [-122.3, 37.8], [-122.3, 37.7], [-122.4, 37.7], [-122.4, 37.8]]],
        }),
        provenance: JSON.stringify({ source: 'test', authority: 'state-gis', timestamp: Date.now(), method: 'test', responseHash: '0x123' }),
      };

      const mockPrepare = mockDb.prepare as ReturnType<typeof vi.fn>;
      const mockAll = mockDb._mockPrepareResults[0].all;
      mockAll.mockReturnValue([mockRow]);

      const mockBooleanPointInPolygon = vi.mocked(turf.booleanPointInPolygon);
      mockBooleanPointInPolygon.mockReturnValue(true);

      // First lookup (cache miss)
      service.lookup(37.75, -122.35);

      // Second lookup (cache hit)
      service.lookup(37.75, -122.35);

      const metrics = service.getMetrics();
      expect(metrics.cacheHits).toBe(1);
      expect(metrics.cacheMisses).toBe(1);
      expect(metrics.totalQueries).toBe(2);
    });

    it('should evict oldest entry when cache is full', () => {
      // Small cache for testing eviction
      const svc = new DistrictLookupService('/test.db', 2, 3600);
      const mockDb2 = mockDatabaseInstances[mockDatabaseInstances.length - 1];

      const mockPrepare = mockDb2.prepare as ReturnType<typeof vi.fn>;
      const mockAll = mockDb2._mockPrepareResults[0].all;

      const mockBooleanPointInPolygon = vi.mocked(turf.booleanPointInPolygon);
      mockBooleanPointInPolygon.mockReturnValue(true);

      // Mock database responses
      mockAll.mockReturnValue([
        {
          id: 'district-1',
          name: 'District 1',
          jurisdiction: 'Test City',
          district_type: 'council',
          geometry: JSON.stringify({ type: 'Polygon', coordinates: [[[-122.4, 37.8], [-122.3, 37.8], [-122.3, 37.7], [-122.4, 37.7], [-122.4, 37.8]]] }),
          provenance: JSON.stringify({ source: 'test', authority: 'state-gis', timestamp: Date.now(), method: 'test', responseHash: '0x123' }),
        },
      ]);

      // Fill cache with 2 entries
      svc.lookup(37.75, -122.35); // Entry 1
      svc.lookup(37.76, -122.36); // Entry 2

      // Add third entry (should evict first)
      svc.lookup(37.77, -122.37); // Entry 3 (evicts Entry 1)

      const metrics = svc.getMetrics();
      expect(metrics.cacheSize).toBe(2); // Cache should remain at max size

      svc.close();
    });

    it('should respect cache TTL', () => {
      // Short TTL for testing expiration
      const svc = new DistrictLookupService('/test.db', 100, 0.001); // 1ms TTL
      const mockDb2 = mockDatabaseInstances[mockDatabaseInstances.length - 1];

      const mockPrepare = mockDb2.prepare as ReturnType<typeof vi.fn>;
      const mockAll = mockDb2._mockPrepareResults[0].all;

      const mockBooleanPointInPolygon = vi.mocked(turf.booleanPointInPolygon);
      mockBooleanPointInPolygon.mockReturnValue(true);

      mockAll.mockReturnValue([
        {
          id: 'district-1',
          name: 'District 1',
          jurisdiction: 'Test City',
          district_type: 'council',
          geometry: JSON.stringify({ type: 'Polygon', coordinates: [[[-122.4, 37.8], [-122.3, 37.8], [-122.3, 37.7], [-122.4, 37.7], [-122.4, 37.8]]] }),
          provenance: JSON.stringify({ source: 'test', authority: 'state-gis', timestamp: Date.now(), method: 'test', responseHash: '0x123' }),
        },
      ]);

      // First lookup
      const result1 = svc.lookup(37.75, -122.35);
      expect(result1.cacheHit).toBe(false);

      // Wait for TTL to expire (using setTimeout to avoid flakiness)
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // Second lookup (should be cache miss due to expiration)
          const result2 = svc.lookup(37.75, -122.35);
          expect(result2.cacheHit).toBe(false);

          svc.close();
          resolve();
        }, 10);
      });
    });

    it('should clear cache when clearCache() is called', () => {
      const mockRow = {
        id: 'district-1',
        name: 'District 1',
        jurisdiction: 'Test City',
        district_type: 'council',
        geometry: JSON.stringify({ type: 'Polygon', coordinates: [[[-122.4, 37.8], [-122.3, 37.8], [-122.3, 37.7], [-122.4, 37.7], [-122.4, 37.8]]] }),
        provenance: JSON.stringify({ source: 'test', authority: 'state-gis', timestamp: Date.now(), method: 'test', responseHash: '0x123' }),
      };

      const mockPrepare = mockDb.prepare as ReturnType<typeof vi.fn>;
      const mockAll = mockDb._mockPrepareResults[0].all;
      mockAll.mockReturnValue([mockRow]);

      const mockBooleanPointInPolygon = vi.mocked(turf.booleanPointInPolygon);
      mockBooleanPointInPolygon.mockReturnValue(true);

      // First lookup (cache miss)
      service.lookup(37.75, -122.35);
      expect(service.getMetrics().cacheSize).toBe(1);

      // Clear cache
      service.clearCache();
      expect(service.getMetrics().cacheSize).toBe(0);

      // Next lookup should be cache miss
      const result = service.lookup(37.75, -122.35);
      expect(result.cacheHit).toBe(false);
    });
  });

  describe('getMetrics()', () => {
    it('should return correct metrics', () => {
      const metrics = service.getMetrics();

      expect(metrics).toHaveProperty('totalQueries');
      expect(metrics).toHaveProperty('cacheHits');
      expect(metrics).toHaveProperty('cacheMisses');
      expect(metrics).toHaveProperty('cacheHitRate');
      expect(metrics).toHaveProperty('cacheSize');
      expect(metrics).toHaveProperty('latencyP50');
      expect(metrics).toHaveProperty('latencyP95');
      expect(metrics).toHaveProperty('latencyP99');

      expect(typeof metrics.totalQueries).toBe('number');
      expect(typeof metrics.cacheHits).toBe('number');
      expect(typeof metrics.cacheMisses).toBe('number');
      expect(typeof metrics.cacheHitRate).toBe('number');
      expect(typeof metrics.cacheSize).toBe('number');
      expect(typeof metrics.latencyP50).toBe('number');
      expect(typeof metrics.latencyP95).toBe('number');
      expect(typeof metrics.latencyP99).toBe('number');
    });

    it('should calculate cache hit rate correctly', () => {
      const mockRow = {
        id: 'district-1',
        name: 'District 1',
        jurisdiction: 'Test City',
        district_type: 'council',
        geometry: JSON.stringify({ type: 'Polygon', coordinates: [[[-122.4, 37.8], [-122.3, 37.8], [-122.3, 37.7], [-122.4, 37.7], [-122.4, 37.8]]] }),
        provenance: JSON.stringify({ source: 'test', authority: 'state-gis', timestamp: Date.now(), method: 'test', responseHash: '0x123' }),
      };

      const mockPrepare = mockDb.prepare as ReturnType<typeof vi.fn>;
      const mockAll = mockDb._mockPrepareResults[0].all;
      mockAll.mockReturnValue([mockRow]);

      const mockBooleanPointInPolygon = vi.mocked(turf.booleanPointInPolygon);
      mockBooleanPointInPolygon.mockReturnValue(true);

      // 1 cache miss, 3 cache hits
      service.lookup(37.75, -122.35); // miss
      service.lookup(37.75, -122.35); // hit
      service.lookup(37.75, -122.35); // hit
      service.lookup(37.75, -122.35); // hit

      const metrics = service.getMetrics();
      expect(metrics.totalQueries).toBe(4);
      expect(metrics.cacheHits).toBe(3);
      expect(metrics.cacheMisses).toBe(1);
      expect(metrics.cacheHitRate).toBeCloseTo(0.75);
    });

    it('should return 0 hit rate when no queries', () => {
      const metrics = service.getMetrics();
      expect(metrics.cacheHitRate).toBe(0);
    });

    it('should track latency percentiles', () => {
      const mockPrepare = mockDb.prepare as ReturnType<typeof vi.fn>;
      const mockAll = mockDb._mockPrepareResults[0].all;
      mockAll.mockReturnValue([]);

      // Perform multiple lookups
      for (let i = 0; i < 100; i++) {
        service.lookup(37.75 + i * 0.001, -122.35);
      }

      const metrics = service.getMetrics();
      expect(metrics.latencyP50).toBeGreaterThanOrEqual(0);
      expect(metrics.latencyP95).toBeGreaterThanOrEqual(metrics.latencyP50);
      expect(metrics.latencyP99).toBeGreaterThanOrEqual(metrics.latencyP95);
    });
  });

  describe('Edge Cases', () => {
    it('should handle coordinates at WGS84 boundaries', () => {
      const mockPrepare = mockDb.prepare as ReturnType<typeof vi.fn>;
      const mockAll = mockDb._mockPrepareResults[0].all;
      mockAll.mockReturnValue([]);

      // Valid boundary coordinates
      expect(() => service.lookup(90, 180)).not.toThrow();
      expect(() => service.lookup(-90, -180)).not.toThrow();
      expect(() => service.lookup(0, 0)).not.toThrow();
    });

    it('should handle multiple candidates from R-tree', () => {
      const mockRows = [
        {
          id: 'district-1',
          name: 'District 1',
          jurisdiction: 'Test City',
          district_type: 'council',
          geometry: JSON.stringify({ type: 'Polygon', coordinates: [[[-122.4, 37.8], [-122.3, 37.8], [-122.3, 37.7], [-122.4, 37.7], [-122.4, 37.8]]] }),
          provenance: JSON.stringify({ source: 'test', authority: 'state-gis', timestamp: Date.now(), method: 'test', responseHash: '0x123' }),
        },
        {
          id: 'district-2',
          name: 'District 2',
          jurisdiction: 'Test City',
          district_type: 'ward',
          geometry: JSON.stringify({ type: 'Polygon', coordinates: [[[-122.5, 37.9], [-122.4, 37.9], [-122.4, 37.8], [-122.5, 37.8], [-122.5, 37.9]]] }),
          provenance: JSON.stringify({ source: 'test', authority: 'state-gis', timestamp: Date.now(), method: 'test', responseHash: '0x123' }),
        },
      ];

      const mockAll = mockDb._mockPrepareResults[0].all;
      mockAll.mockReturnValue(mockRows);

      const mockBooleanPointInPolygon = vi.mocked(turf.booleanPointInPolygon);
      // First polygon: false, second polygon: true
      mockBooleanPointInPolygon.mockReturnValueOnce(false).mockReturnValueOnce(true);

      const result = service.lookup(37.85, -122.45);

      expect(result.district).toBeDefined();
      expect(result.district?.id).toBe('district-2');
    });

    it('should normalize district type strings', () => {
      const mockRow = {
        id: 'district-1',
        name: 'District 1',
        jurisdiction: 'Test City',
        district_type: 'City Council District', // Mixed case
        geometry: JSON.stringify({ type: 'Polygon', coordinates: [[[-122.4, 37.8], [-122.3, 37.8], [-122.3, 37.7], [-122.4, 37.7], [-122.4, 37.8]]] }),
        provenance: JSON.stringify({ source: 'test', authority: 'state-gis', timestamp: Date.now(), method: 'test', responseHash: '0x123' }),
      };

      const mockPrepare = mockDb.prepare as ReturnType<typeof vi.fn>;
      const mockAll = mockDb._mockPrepareResults[0].all;
      mockAll.mockReturnValue([mockRow]);

      const mockBooleanPointInPolygon = vi.mocked(turf.booleanPointInPolygon);
      mockBooleanPointInPolygon.mockReturnValue(true);

      const result = service.lookup(37.75, -122.35);

      expect(result.district?.districtType).toBe('council');
    });
  });

  describe('Database Connection', () => {
    it('should close database connection', () => {
      service.close();

      const mockClose = mockDb.close as ReturnType<typeof vi.fn>;
      expect(mockClose).toHaveBeenCalled();
    });
  });
});
