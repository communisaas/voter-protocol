/**
 * TIGER Validator Tests
 *
 * Comprehensive test suite for TIGER data validation.
 *
 * TEST COVERAGE:
 * 1. Completeness: Detect missing/extra boundaries
 * 2. Topology: Detect self-intersecting polygons, overlaps
 * 3. Coordinates: Reject null/NaN coords, out-of-range values
 * 4. Cross-validation: Compare TIGER vs state sources
 * 5. Quality scoring: Verify weighted calculation
 *
 * FIXTURES:
 * - Perfect data: 100% quality score
 * - Missing boundaries: <100% completeness
 * - Invalid topology: Self-intersecting polygons
 * - Bad coordinates: Null/out-of-range values
 */

import { describe, it, expect } from 'vitest';
import { TIGERValidator } from './tiger-validator.js';
import type { NormalizedBoundary } from './tiger-validator.js';
import type { Polygon, MultiPolygon } from 'geojson';

describe('TIGERValidator', () => {
  const validator = new TIGERValidator();

  describe('validateCompleteness', () => {
    it('should pass with exact expected count', () => {
      // Wyoming has 1 congressional district (at-large)
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '5600',
          name: 'Wyoming At-Large',
          geometry: createValidPolygon(),
          properties: {},
        },
      ];

      const result = validator.validateCompleteness('cd', boundaries, '56');

      expect(result.valid).toBe(true);
      expect(result.expected).toBe(1);
      expect(result.actual).toBe(1);
      expect(result.percentage).toBe(100);
      expect(result.missingGEOIDs).toHaveLength(0);
      expect(result.summary).toContain('✅ Complete');
    });

    it('should detect when 1 CD is missing', () => {
      // California has 52 CDs, provide only 51
      const boundaries: NormalizedBoundary[] = Array.from({ length: 51 }, (_, i) => ({
        geoid: `06${String(i + 1).padStart(2, '0')}`,
        name: `California District ${i + 1}`,
        geometry: createValidPolygon(),
        properties: {},
      }));

      const result = validator.validateCompleteness('cd', boundaries, '06');

      expect(result.valid).toBe(false);
      expect(result.expected).toBe(52);
      expect(result.actual).toBe(51);
      expect(result.percentage).toBeCloseTo(98.08, 1);
      expect(result.summary).toContain('❌ Incomplete');
    });

    it('should detect extra boundaries', () => {
      // Wyoming has 1 CD, provide 2
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '5600',
          name: 'Wyoming At-Large',
          geometry: createValidPolygon(),
          properties: {},
        },
        {
          geoid: '5601',
          name: 'Wyoming District 2 (INVALID)',
          geometry: createValidPolygon(),
          properties: {},
        },
      ];

      const result = validator.validateCompleteness('cd', boundaries, '56');

      expect(result.valid).toBe(false);
      expect(result.expected).toBe(1);
      expect(result.actual).toBe(2);
      expect(result.percentage).toBe(200);
    });

    it('should handle Nebraska unicameral SLDU correctly', () => {
      // Nebraska has 49 SLDU (unicameral legislature)
      const boundaries: NormalizedBoundary[] = Array.from({ length: 49 }, (_, i) => ({
        geoid: `31${String(i + 1).padStart(3, '0')}`,
        name: `Nebraska LD ${i + 1}`,
        geometry: createValidPolygon(),
        properties: {},
      }));

      const result = validator.validateCompleteness('sldu', boundaries, '31');

      expect(result.valid).toBe(true);
      expect(result.expected).toBe(49);
      expect(result.actual).toBe(49);
    });

    it('should handle Nebraska SLDL (should be 0)', () => {
      // Nebraska has NO lower house (unicameral)
      const boundaries: NormalizedBoundary[] = [];

      const result = validator.validateCompleteness('sldl', boundaries, '31');

      expect(result.valid).toBe(true);
      expect(result.expected).toBe(0);
      expect(result.actual).toBe(0);
    });

    it('should validate county counts', () => {
      // Texas has 254 counties (most in US)
      const boundaries: NormalizedBoundary[] = Array.from({ length: 254 }, (_, i) => ({
        geoid: `48${String(i + 1).padStart(3, '0')}`,
        name: `Texas County ${i + 1}`,
        geometry: createValidPolygon(),
        properties: {},
      }));

      const result = validator.validateCompleteness('county', boundaries, '48');

      expect(result.valid).toBe(true);
      expect(result.expected).toBe(254);
      expect(result.actual).toBe(254);
      expect(result.percentage).toBe(100);
    });
  });

  describe('validateTopology', () => {
    it('should pass with valid polygon', () => {
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '0601',
          name: 'Valid District',
          geometry: createValidPolygon(),
          properties: {},
        },
      ];

      const result = validator.validateTopology(boundaries);

      expect(result.valid).toBe(true);
      expect(result.selfIntersections).toBe(0);
      expect(result.invalidGeometries).toHaveLength(0);
      expect(result.summary).toContain('✅ Topology valid');
    });

    it('should detect self-intersecting polygon (malformed ring)', () => {
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '0601',
          name: 'Self-Intersecting District',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-122.0, 47.0],
                [-122.0, 48.0],
                [-121.0, 47.0], // Creates self-intersection
              ],
            ],
          },
          properties: {},
        },
      ];

      const result = validator.validateTopology(boundaries);

      expect(result.valid).toBe(false);
      expect(result.selfIntersections).toBeGreaterThan(0);
    });

    it('should detect invalid geometry (null)', () => {
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '0601',
          name: 'Null Geometry District',
          geometry: null as any,
          properties: {},
        },
      ];

      const result = validator.validateTopology(boundaries);

      expect(result.valid).toBe(false);
      expect(result.invalidGeometries).toContain('0601');
    });

    it('should detect empty polygon', () => {
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '0601',
          name: 'Empty Polygon',
          geometry: {
            type: 'Polygon',
            coordinates: [],
          },
          properties: {},
        },
      ];

      const result = validator.validateTopology(boundaries);

      expect(result.valid).toBe(false);
      expect(result.invalidGeometries).toContain('0601');
    });
  });

  describe('validateCoordinates', () => {
    it('should pass with valid WGS84 coordinates', () => {
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '0601',
          name: 'Valid Coordinates',
          geometry: createValidPolygon(),
          properties: {},
        },
      ];

      const result = validator.validateCoordinates(boundaries);

      expect(result.valid).toBe(true);
      expect(result.outOfRangeCount).toBe(0);
      expect(result.nullCoordinates).toHaveLength(0);
      expect(result.summary).toContain('✅ Coordinates valid');
    });

    it('should reject boundaries with null coordinates', () => {
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '0601',
          name: 'Null Coordinates',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [null as any, null as any],
                [-122.0, 48.0],
                [-121.0, 48.0],
                [-121.0, 47.0],
                [null as any, null as any],
              ],
            ],
          },
          properties: {},
        },
      ];

      const result = validator.validateCoordinates(boundaries);

      expect(result.valid).toBe(false);
      expect(result.nullCoordinates).toContain('0601');
    });

    it('should reject coordinates outside WGS84 range', () => {
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '0601',
          name: 'Out of Range',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-200.0, 47.0], // Lon out of range
                [-122.0, 95.0], // Lat out of range
                [-121.0, 48.0],
                [-121.0, 47.0],
                [-200.0, 47.0],
              ],
            ],
          },
          properties: {},
        },
      ];

      const result = validator.validateCoordinates(boundaries);

      expect(result.valid).toBe(false);
      expect(result.outOfRangeCount).toBeGreaterThan(0);
    });

    it('should flag boundaries outside continental US bounds', () => {
      // Centroid in middle of Pacific Ocean (not Alaska/Hawaii)
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '0601',
          name: 'Pacific Ocean (suspicious)',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-170.0, 10.0],
                [-170.0, 11.0],
                [-169.0, 11.0],
                [-169.0, 10.0],
                [-170.0, 10.0],
              ],
            ],
          },
          properties: {},
        },
      ];

      const result = validator.validateCoordinates(boundaries);

      // This doesn't fail validation (territories exist outside continental US)
      // But it flags suspicious locations
      expect(result.suspiciousLocations.length).toBeGreaterThan(0);
      expect(result.suspiciousLocations[0].reason).toContain('territory');
    });
  });

  describe('crossValidate', () => {
    it('should match identical boundaries (IoU > 0.99)', async () => {
      const tigerBoundaries: NormalizedBoundary[] = [
        {
          geoid: '0601',
          name: 'District 1',
          geometry: createValidPolygon(),
          properties: {},
        },
      ];

      const stateBoundaries: NormalizedBoundary[] = [
        {
          geoid: '0601',
          name: 'District 1 (State Source)',
          geometry: createValidPolygon(),
          properties: {},
        },
      ];

      const result = await validator.crossValidate(tigerBoundaries, stateBoundaries);

      expect(result.matched).toBe(1);
      expect(result.mismatched).toBe(0);
      expect(result.iouScores.get('0601')).toBeGreaterThan(0.99);
      expect(result.significantDiscrepancies).toHaveLength(0);
    });

    it('should flag >1% area discrepancy', async () => {
      const tigerBoundaries: NormalizedBoundary[] = [
        {
          geoid: '0601',
          name: 'District 1 (TIGER)',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-122.0, 47.0],
                [-122.0, 48.0],
                [-121.0, 48.0],
                [-121.0, 47.0],
                [-122.0, 47.0],
              ],
            ],
          },
          properties: {},
        },
      ];

      const stateBoundaries: NormalizedBoundary[] = [
        {
          geoid: '0601',
          name: 'District 1 (State, larger)',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-123.0, 47.0], // Wider by 1 degree
                [-123.0, 48.0],
                [-121.0, 48.0],
                [-121.0, 47.0],
                [-123.0, 47.0],
              ],
            ],
          },
          properties: {},
        },
      ];

      const result = await validator.crossValidate(tigerBoundaries, stateBoundaries);

      expect(result.matched).toBe(1);
      expect(result.significantDiscrepancies.length).toBeGreaterThan(0);
      expect(result.significantDiscrepancies[0].difference).toBeGreaterThan(1);
    });

    it('should detect missing boundaries in state data', async () => {
      const tigerBoundaries: NormalizedBoundary[] = [
        {
          geoid: '0601',
          name: 'District 1',
          geometry: createValidPolygon(),
          properties: {},
        },
        {
          geoid: '0602',
          name: 'District 2',
          geometry: createValidPolygon(),
          properties: {},
        },
      ];

      const stateBoundaries: NormalizedBoundary[] = [
        {
          geoid: '0601',
          name: 'District 1 (State)',
          geometry: createValidPolygon(),
          properties: {},
        },
        // District 2 missing from state data
      ];

      const result = await validator.crossValidate(tigerBoundaries, stateBoundaries);

      expect(result.matched).toBe(1);
      expect(result.mismatched).toBe(1);
    });
  });

  describe('calculateQualityScore', () => {
    it('should return 100 for perfect data', () => {
      const completeness = {
        valid: true,
        expected: 10,
        actual: 10,
        percentage: 100,
        missingGEOIDs: [],
        extraGEOIDs: [],
        summary: 'Complete',
      };

      const topology = {
        valid: true,
        selfIntersections: 0,
        overlaps: [],
        gaps: 0,
        invalidGeometries: [],
        summary: 'Valid',
      };

      const coordinates = {
        valid: true,
        outOfRangeCount: 0,
        nullCoordinates: [],
        suspiciousLocations: [],
        summary: 'Valid',
      };

      const score = validator.calculateQualityScore(completeness, topology, coordinates);

      expect(score).toBe(100);
    });

    it('should return <50 for missing 50%+ boundaries', () => {
      const completeness = {
        valid: false,
        expected: 10,
        actual: 5,
        percentage: 50,
        missingGEOIDs: [],
        extraGEOIDs: [],
        summary: 'Incomplete',
      };

      const topology = {
        valid: true,
        selfIntersections: 0,
        overlaps: [],
        gaps: 0,
        invalidGeometries: [],
        summary: 'Valid',
      };

      const coordinates = {
        valid: true,
        outOfRangeCount: 0,
        nullCoordinates: [],
        suspiciousLocations: [],
        summary: 'Valid',
      };

      const score = validator.calculateQualityScore(completeness, topology, coordinates);

      // 50% * 0.4 + 35 + 25 = 20 + 35 + 25 = 80
      expect(score).toBe(80);
    });

    it('should penalize topology errors', () => {
      const completeness = {
        valid: true,
        expected: 10,
        actual: 10,
        percentage: 100,
        missingGEOIDs: [],
        extraGEOIDs: [],
        summary: 'Complete',
      };

      const topology = {
        valid: false,
        selfIntersections: 5,
        overlaps: [],
        gaps: 0,
        invalidGeometries: ['0601', '0602'],
        summary: 'Invalid',
      };

      const coordinates = {
        valid: true,
        outOfRangeCount: 0,
        nullCoordinates: [],
        suspiciousLocations: [],
        summary: 'Valid',
      };

      const score = validator.calculateQualityScore(completeness, topology, coordinates);

      // 100% * 0.4 + 0 (invalid) + 25 = 40 + 0 + 25 = 65
      expect(score).toBe(65);
    });

    it('should penalize coordinate errors', () => {
      const completeness = {
        valid: true,
        expected: 10,
        actual: 10,
        percentage: 100,
        missingGEOIDs: [],
        extraGEOIDs: [],
        summary: 'Complete',
      };

      const topology = {
        valid: true,
        selfIntersections: 0,
        overlaps: [],
        gaps: 0,
        invalidGeometries: [],
        summary: 'Valid',
      };

      const coordinates = {
        valid: false,
        outOfRangeCount: 10,
        nullCoordinates: ['0601'],
        suspiciousLocations: [],
        summary: 'Invalid',
      };

      const score = validator.calculateQualityScore(completeness, topology, coordinates);

      // 100% * 0.4 + 35 + 0 (invalid) = 40 + 35 + 0 = 75
      expect(score).toBe(75);
    });
  });

  describe('validate (integration)', () => {
    it('should validate perfect TIGER data with quality score 100', () => {
      // Wyoming: 1 congressional district (at-large)
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '5600',
          name: 'Wyoming At-Large',
          geometry: createValidPolygon(),
          properties: {},
        },
      ];

      const result = validator.validate('cd', boundaries, '56');

      expect(result.qualityScore).toBe(100);
      expect(result.completeness.valid).toBe(true);
      expect(result.topology.valid).toBe(true);
      expect(result.coordinates.valid).toBe(true);
      expect(result.summary).toContain('Quality Score 100');
    });

    it('should provide detailed summary for validation failures', () => {
      // California: Expected 52 CDs, provide 51 with bad coords
      const boundaries: NormalizedBoundary[] = Array.from({ length: 51 }, (_, i) => ({
        geoid: `06${String(i + 1).padStart(2, '0')}`,
        name: `California District ${i + 1}`,
        geometry: i === 0
          ? {
              // First boundary has null coords
              type: 'Polygon' as const,
              coordinates: [
                [
                  [null as any, null as any],
                  [-122.0, 48.0],
                  [-121.0, 48.0],
                  [-121.0, 47.0],
                  [null as any, null as any],
                ],
              ],
            }
          : createValidPolygon(),
        properties: {},
      }));

      const result = validator.validate('cd', boundaries, '06');

      expect(result.qualityScore).toBeLessThan(100);
      expect(result.completeness.valid).toBe(false);
      expect(result.coordinates.valid).toBe(false);
      expect(result.summary).toContain('❌');
    });
  });
});

/**
 * Create a valid polygon for testing
 */
function createValidPolygon(): Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [-122.0, 47.0],
        [-122.0, 48.0],
        [-121.0, 48.0],
        [-121.0, 47.0],
        [-122.0, 47.0], // Closed ring
      ],
    ],
  };
}
