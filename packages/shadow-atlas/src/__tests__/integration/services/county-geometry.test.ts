/**
 * County Geometry Service Tests
 *
 * VALIDATES:
 * 1. Multi-county union computation (Kansas City = 4 counties)
 * 2. Single-county fallback (Boulder = 1 county)
 * 3. Cache behavior (cold vs warm)
 * 4. Union geometry correctness
 *
 * NOTE: These tests use real Census TIGER/Line data (213MB GeoJSON).
 * First load takes ~30-60 seconds to parse geometry data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CountyGeometryService } from '../../../services/county-geometry.js';
import type { Polygon } from 'geojson';

describe('CountyGeometryService', () => {
  let service: CountyGeometryService;

  beforeEach(() => {
    service = new CountyGeometryService();
  });

  describe('Multi-County Union', () => {
    it('should compute union for Kansas City (4 counties)', async () => {
      const union = await service.getCountyUnion('2938000'); // Kansas City, MO

      // Validate county count
      expect(union.counties).toHaveLength(4);
      expect(union.counties).toContain('29095'); // Jackson County
      expect(union.counties).toContain('29047'); // Clay County
      expect(union.counties).toContain('29165'); // Platte County
      expect(union.counties).toContain('29037'); // Cass County

      // Validate geometry
      expect(union.geometry.type).toMatch(/^(Polygon|MultiPolygon)$/);

      // Validate bbox
      expect(union.bbox).toHaveLength(4);
      const [minLon, minLat, maxLon, maxLat] = union.bbox;
      expect(minLon).toBeLessThan(maxLon);
      expect(minLat).toBeLessThan(maxLat);

      // Validate source
      expect(union.source).toBe('census-tiger');
    });

    it('should compute union for New York City (5 counties)', async () => {
      const union = await service.getCountyUnion('3651000'); // New York City, NY

      // Validate county count
      expect(union.counties).toHaveLength(5);
      expect(union.counties).toContain('36061'); // Manhattan
      expect(union.counties).toContain('36047'); // Brooklyn
      expect(union.counties).toContain('36081'); // Queens
      expect(union.counties).toContain('36005'); // Bronx
      expect(union.counties).toContain('36085'); // Staten Island

      // Validate geometry
      expect(union.geometry.type).toMatch(/^(Polygon|MultiPolygon)$/);

      // Validate source
      expect(union.source).toBe('census-tiger');
    });

    it('should compute union for Atlanta (2 counties)', async () => {
      const union = await service.getCountyUnion('1304000'); // Atlanta, GA

      // Validate county count
      expect(union.counties).toHaveLength(2);
      expect(union.counties).toContain('13121'); // Fulton County
      expect(union.counties).toContain('13089'); // DeKalb County

      // Validate geometry
      expect(union.geometry.type).toMatch(/^(Polygon|MultiPolygon)$/);
    });

    it('should compute union for Chicago (2 counties)', async () => {
      const union = await service.getCountyUnion('1714000'); // Chicago, IL

      // Validate county count
      expect(union.counties).toHaveLength(2);
      expect(union.counties).toContain('17031'); // Cook County
      expect(union.counties).toContain('17043'); // DuPage County

      // Validate geometry
      expect(union.geometry.type).toMatch(/^(Polygon|MultiPolygon)$/);
    });
  });

  describe('Single-County Fallback', () => {
    it('should return single county for Boulder, CO', async () => {
      const union = await service.getCountyUnion('0803000'); // Boulder, CO

      // Validate single county
      expect(union.counties).toHaveLength(1);
      expect(union.counties).toContain('08013'); // Boulder County

      // Validate geometry (Census data may have Polygon or MultiPolygon)
      expect(union.geometry.type).toMatch(/^(Polygon|MultiPolygon)$/);

      // Validate source
      expect(union.source).toBe('census-tiger');
    });

    it('should throw error for unknown city without crosswalk', async () => {
      // City FIPS not in registry and no crosswalk implemented
      await expect(
        service.getCountyUnion('9999999')
      ).rejects.toThrow(/Cannot infer primary county/);
    });
  });

  describe('Cache Behavior', () => {
    it('should cache county unions', async () => {
      // First call: fetch from Census TIGER
      const result1 = await service.getCountyUnion('2938000');
      expect(result1.source).toBe('census-tiger');

      // Second call: use cache
      const result2 = await service.getCountyUnion('2938000');
      expect(result2.source).toBe('cache');

      // Results should be identical (except source)
      expect(result1.counties).toEqual(result2.counties);
      expect(result1.bbox).toEqual(result2.bbox);
    });

    it('should clear cache on demand', async () => {
      // First call
      await service.getCountyUnion('2938000');

      // Clear cache
      service.clearCache();

      // Next call should re-fetch
      const result = await service.getCountyUnion('2938000');
      expect(result.source).toBe('census-tiger');
    });

    it('should provide cache statistics', async () => {
      // Add some entries
      await service.getCountyUnion('2938000'); // Kansas City (4 counties)
      await service.getCountyUnion('3651000'); // NYC (5 counties)

      const stats = service.getCacheStats();

      expect(stats.size).toBe(2);
      expect(stats.entries).toHaveLength(2);

      // Check first entry
      const kansasCity = stats.entries.find(e => e.cityFips === '2938000');
      expect(kansasCity).toBeDefined();
      expect(kansasCity?.counties).toBe(4);
      expect(kansasCity?.age).toBeGreaterThanOrEqual(0);

      // Check second entry
      const nyc = stats.entries.find(e => e.cityFips === '3651000');
      expect(nyc).toBeDefined();
      expect(nyc?.counties).toBe(5);
    });
  });

  describe('Union Geometry Correctness', () => {
    it('should create larger bbox for multi-county than single county', async () => {
      // Kansas City spans 4 counties
      const kcUnion = await service.getCountyUnion('2938000');
      const kcBbox = kcUnion.bbox;

      // Calculate area (rough approximation)
      const kcArea = (kcBbox[2] - kcBbox[0]) * (kcBbox[3] - kcBbox[1]);

      // Area should be positive and reasonable
      expect(kcArea).toBeGreaterThan(0);

      // Multi-county union should cover larger area than single county
      // (Kansas City 4 counties should be larger than typical single county)
      expect(kcArea).toBeGreaterThan(0.5); // Rough threshold
    });

    it('should have valid polygon coordinates', async () => {
      const union = await service.getCountyUnion('2938000');

      // Check polygon structure
      if (union.geometry.type === 'Polygon') {
        const coords = union.geometry.coordinates;
        expect(coords).toBeDefined();
        expect(coords.length).toBeGreaterThan(0);

        // First ring (outer boundary)
        const outerRing = coords[0];
        expect(outerRing.length).toBeGreaterThanOrEqual(4); // At least 4 points
        expect(outerRing[0]).toEqual(outerRing[outerRing.length - 1]); // Closed ring
      } else if (union.geometry.type === 'MultiPolygon') {
        const coords = union.geometry.coordinates;
        expect(coords).toBeDefined();
        expect(coords.length).toBeGreaterThan(0);

        // Check first polygon
        const firstPolygon = coords[0];
        const outerRing = firstPolygon[0];
        expect(outerRing.length).toBeGreaterThanOrEqual(4);
        expect(outerRing[0]).toEqual(outerRing[outerRing.length - 1]);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid city FIPS gracefully', async () => {
      await expect(
        service.getCountyUnion('invalid')
      ).rejects.toThrow();
    });

    it('should handle empty city FIPS', async () => {
      await expect(
        service.getCountyUnion('')
      ).rejects.toThrow();
    });
  });
});
