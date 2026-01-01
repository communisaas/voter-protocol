/**
 * Coverage Computation Tests
 *
 * Tests for school district coverage calculation.
 */

import { describe, it, expect } from 'vitest';
import { SchoolDistrictValidator } from '../../../validators/school-district-validator.js';
import type { NormalizedBoundary } from '../../../validators/tiger-validator.js';

describe('SchoolDistrictValidator - Coverage Computation', () => {
  const validator = new SchoolDistrictValidator();

  describe('computeCoverageWithoutStateBoundary', () => {
    it('should return 0% coverage for empty boundary set', async () => {
      const result = await validator.computeCoverageWithoutStateBoundary([]);

      expect(result.coveragePercent).toBe(0);
      expect(result.valid).toBe(false);
      expect(result.totalArea).toBe(0);
      expect(result.coveredArea).toBe(0);
    });

    it('should compute coverage for single district', async () => {
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '0100001',
          name: 'Test District',
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [-122.0, 37.0],
              [-122.0, 38.0],
              [-121.0, 38.0],
              [-121.0, 37.0],
              [-122.0, 37.0],
            ]],
          },
          properties: {},
        },
      ];

      const result = await validator.computeCoverageWithoutStateBoundary(boundaries);

      expect(result.coveragePercent).toBeGreaterThan(0);
      expect(result.totalArea).toBeGreaterThan(0);
      expect(result.coveredArea).toBeGreaterThan(0);
    });

    it('should compute coverage for multiple non-overlapping districts', async () => {
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '0100001',
          name: 'District 1',
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [-122.0, 37.0],
              [-122.0, 37.5],
              [-121.5, 37.5],
              [-121.5, 37.0],
              [-122.0, 37.0],
            ]],
          },
          properties: {},
        },
        {
          geoid: '0100002',
          name: 'District 2',
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [-121.5, 37.0],
              [-121.5, 37.5],
              [-121.0, 37.5],
              [-121.0, 37.0],
              [-121.5, 37.0],
            ]],
          },
          properties: {},
        },
      ];

      const result = await validator.computeCoverageWithoutStateBoundary(boundaries);

      expect(result.coveragePercent).toBeGreaterThan(0);
      expect(result.valid).toBe(true); // Should be > 95%
      expect(result.totalArea).toBeGreaterThan(0);
    });

    it('should handle overlapping districts correctly', async () => {
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '0100001',
          name: 'District 1',
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [-122.0, 37.0],
              [-122.0, 38.0],
              [-121.0, 38.0],
              [-121.0, 37.0],
              [-122.0, 37.0],
            ]],
          },
          properties: {},
        },
        {
          geoid: '0100002',
          name: 'District 2 (overlapping)',
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [-121.5, 37.5],
              [-121.5, 38.5],
              [-120.5, 38.5],
              [-120.5, 37.5],
              [-121.5, 37.5],
            ]],
          },
          properties: {},
        },
      ];

      const result = await validator.computeCoverageWithoutStateBoundary(boundaries);

      // Union should handle overlaps correctly
      expect(result.coveragePercent).toBeGreaterThan(0);
      expect(result.totalArea).toBeGreaterThan(0);
    });
  });
});
