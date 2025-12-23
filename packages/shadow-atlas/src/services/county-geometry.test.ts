/**
 * Tests for County Geometry Service with Crosswalk Integration
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CountyGeometryService } from './county-geometry.js';

describe('County Geometry Service', () => {
  let service: CountyGeometryService;

  beforeEach(() => {
    service = new CountyGeometryService();
  });

  describe('Crosswalk Integration', () => {
    it('should resolve primary county for single-county cities via crosswalk', async () => {
      // Los Angeles is entirely within Los Angeles County
      const result = await service.getCountyUnion('0644000');

      expect(result.counties).toHaveLength(1);
      expect(result.counties[0]).toBe('06037'); // Los Angeles County
      expect(result.source).toBe('census-tiger');
    });

    it('should resolve primary county for Phoenix via crosswalk', async () => {
      // Phoenix is entirely within Maricopa County
      const result = await service.getCountyUnion('0455000');

      expect(result.counties).toHaveLength(1);
      expect(result.counties[0]).toBe('04013'); // Maricopa County
      expect(result.source).toBe('census-tiger');
    });

    it('should resolve primary county for Boulder, CO via crosswalk', async () => {
      // Boulder is entirely within Boulder County
      const result = await service.getCountyUnion('0803000');

      expect(result.counties).toHaveLength(1);
      expect(result.counties[0]).toBe('08013'); // Boulder County
    });

    it('should throw error for unknown city not in crosswalk', async () => {
      await expect(async () => {
        await service.getCountyUnion('9999999'); // Invalid FIPS
      }).rejects.toThrow(/Cannot infer primary county/);
    });
  });

  describe('Multi-County Cities', () => {
    it('should compute union for New York City (5 counties)', async () => {
      const result = await service.getCountyUnion('3651000');

      expect(result.counties).toHaveLength(5);
      expect(result.counties).toEqual(
        expect.arrayContaining([
          '36061', // Manhattan
          '36047', // Brooklyn
          '36081', // Queens
          '36005', // Bronx
          '36085', // Staten Island
        ])
      );
      expect(result.geometry).toBeDefined();
      expect(result.bbox).toBeDefined();
    });

    it('should compute union for Kansas City, MO (4 counties)', async () => {
      const result = await service.getCountyUnion('2938000');

      expect(result.counties).toHaveLength(4);
      expect(result.counties).toEqual(
        expect.arrayContaining([
          '29095', // Jackson
          '29047', // Clay
          '29165', // Platte
          '29037', // Cass
        ])
      );
      expect(result.geometry).toBeDefined();
    });

    it('should compute union for Houston (3 counties)', async () => {
      const result = await service.getCountyUnion('4835000');

      expect(result.counties).toHaveLength(3);
      expect(result.counties).toEqual(
        expect.arrayContaining([
          '48201', // Harris
          '48157', // Fort Bend
          '48339', // Montgomery
        ])
      );
    });

    it('should compute union for Chicago (2 counties)', async () => {
      const result = await service.getCountyUnion('1714000');

      expect(result.counties).toHaveLength(2);
      expect(result.counties).toEqual(
        expect.arrayContaining([
          '17031', // Cook
          '17043', // DuPage
        ])
      );
    });
  });

  describe('Caching Behavior', () => {
    it('should cache results after first fetch', async () => {
      // First call: fresh fetch
      const result1 = await service.getCountyUnion('0644000');
      expect(result1.source).toBe('census-tiger');

      // Second call: cached
      const result2 = await service.getCountyUnion('0644000');
      expect(result2.source).toBe('cache');

      // Results should be identical
      expect(result2.counties).toEqual(result1.counties);
    });

    it('should cache multi-county unions', async () => {
      // First call: fresh fetch + union computation
      const result1 = await service.getCountyUnion('3651000');
      expect(result1.source).toBe('census-tiger');

      // Second call: cached
      const result2 = await service.getCountyUnion('3651000');
      expect(result2.source).toBe('cache');

      // Geometry should match
      expect(result2.geometry).toEqual(result1.geometry);
    });

    it('should allow cache clearing', async () => {
      // Fetch and cache
      await service.getCountyUnion('0644000');

      // Clear cache
      service.clearCache();

      // Next fetch should be fresh
      const result = await service.getCountyUnion('0644000');
      expect(result.source).toBe('census-tiger');
    });
  });

  describe('Bounding Box Generation', () => {
    it('should generate valid bounding box for single county', async () => {
      const result = await service.getCountyUnion('0644000');

      expect(result.bbox).toHaveLength(4);
      const [minLon, minLat, maxLon, maxLat] = result.bbox;

      // Validate bbox structure (Los Angeles County)
      expect(minLon).toBeLessThan(maxLon);
      expect(minLat).toBeLessThan(maxLat);

      // Sanity check coordinates (roughly in Southern California)
      expect(minLon).toBeGreaterThan(-119);
      expect(minLon).toBeLessThan(-117);
      expect(minLat).toBeGreaterThan(33);
      expect(minLat).toBeLessThan(35);
    });

    it('should generate valid bounding box for multi-county union', async () => {
      const result = await service.getCountyUnion('3651000'); // NYC

      expect(result.bbox).toHaveLength(4);
      const [minLon, minLat, maxLon, maxLat] = result.bbox;

      expect(minLon).toBeLessThan(maxLon);
      expect(minLat).toBeLessThan(maxLat);

      // Sanity check NYC coordinates
      expect(minLon).toBeGreaterThan(-75);
      expect(minLon).toBeLessThan(-73);
      expect(minLat).toBeGreaterThan(40);
      expect(minLat).toBeLessThan(42);
    });
  });

  describe('Cache Statistics', () => {
    it('should track cache size', async () => {
      await service.getCountyUnion('0644000');
      await service.getCountyUnion('0455000');

      const stats = service.getCacheStats();
      expect(stats.size).toBe(2);
    });

    it('should track cache entry metadata', async () => {
      await service.getCountyUnion('3651000'); // NYC (5 counties)

      const stats = service.getCacheStats();
      const nycEntry = stats.entries.find((e) => e.cityFips === '3651000');

      expect(nycEntry).toBeDefined();
      expect(nycEntry?.counties).toBe(5);
      expect(nycEntry?.age).toBeGreaterThanOrEqual(0);
    });

    it('should return empty stats when cache is empty', () => {
      const stats = service.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.entries).toHaveLength(0);
    });
  });

  describe('Geometry Validity', () => {
    it('should return valid Polygon or MultiPolygon geometry', async () => {
      const result = await service.getCountyUnion('0644000');

      expect(['Polygon', 'MultiPolygon']).toContain(result.geometry.type);
      expect(result.geometry.coordinates).toBeDefined();
    });

    it('should handle county unions that create MultiPolygon', async () => {
      // NYC spans islands (Manhattan, Staten Island) and mainland (Bronx)
      const result = await service.getCountyUnion('3651000');

      // Geometry should be valid
      expect(result.geometry).toBeDefined();
      expect(['Polygon', 'MultiPolygon']).toContain(result.geometry.type);
    });
  });

  describe('Error Handling', () => {
    it('should throw for invalid place FIPS code', async () => {
      await expect(async () => {
        await service.getCountyUnion('invalid-fips');
      }).rejects.toThrow();
    });

    it('should throw for place not in crosswalk or multi-county registry', async () => {
      await expect(async () => {
        await service.getCountyUnion('0199999'); // Invalid Alabama city
      }).rejects.toThrow(/Cannot infer primary county/);
    });

    it('should provide helpful error message for missing crosswalk data', async () => {
      try {
        await service.getCountyUnion('1299999'); // Invalid Florida city
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).message).toContain('place-county-crosswalk.ts');
      }
    });
  });

  describe('Integration with Multi-County Registry', () => {
    it('should prioritize multi-county registry over crosswalk', async () => {
      // Kansas City is in both multi-county registry and crosswalk
      // Should use multi-county registry (getCountiesForCity returns all counties)
      const result = await service.getCountyUnion('2938000');

      expect(result.counties).toHaveLength(4); // All counties from registry
    });

    it('should fall back to crosswalk for cities not in multi-county registry', async () => {
      // Los Angeles is NOT in multi-county registry (single county)
      // Should use crosswalk to find primary county
      const result = await service.getCountyUnion('0644000');

      expect(result.counties).toHaveLength(1);
      expect(result.counties[0]).toBe('06037');
    });
  });
});
