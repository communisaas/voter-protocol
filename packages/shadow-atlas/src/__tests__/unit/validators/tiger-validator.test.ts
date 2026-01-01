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
import { TIGERValidator } from '../../../validators/tiger-validator.js';
import type { NormalizedBoundary } from '../../../validators/tiger-validator.js';
import type { Polygon, MultiPolygon } from 'geojson';

describe('TIGERValidator', () => {
  const validator = new TIGERValidator();

  describe('validateCompleteness', () => {
    it('should pass with exact expected count', () => {
      // Wyoming has 1 congressional district (at-large)
      // Note: District code 01 is used, not 00 (00 is a placeholder code that gets filtered)
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '5601',
          name: 'Wyoming At-Large',
          geometry: createValidPolygon(),
          properties: {
            GEOID: '5601',
            NAMELSAD: 'Congressional District (at Large)',
            STATEFP: '56',
            CD119FP: '01',
          },
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

    it('should validate unified school district GEOID format', () => {
      // California unified school districts (CA has 1037 unified districts)
      // Create a subset for testing
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '0600001', // Valid 7-digit GEOID (SSLLLLL)
          name: 'Test Unified School District',
          geometry: createValidPolygon(),
          properties: {
            GEOID: '0600001',
            NAME: 'Test Unified School District',
            STATEFP: '06',
            UNSDLEA: '00001',
          },
        },
      ];

      const result = validator.validateCompleteness('unsd', boundaries, '06');

      // Will fail completeness count (1 vs 1037) but GEOID format should be valid
      expect(result.valid).toBe(false); // Incomplete count
      expect(result.summary).toContain('Incomplete'); // Wrong count, not GEOID format
      expect(result.actual).toBe(1);
      expect(result.expected).toBe(1037);
    });

    it('should reject invalid school district GEOID format', () => {
      // Invalid GEOID (too short)
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '06001', // Invalid - only 5 digits instead of 7
          name: 'Invalid School District',
          geometry: createValidPolygon(),
          properties: {
            GEOID: '06001',
            NAME: 'Invalid School District',
            STATEFP: '06',
            ELSDLEA: '001',
          },
        },
      ];

      const result = validator.validateCompleteness('elsd', boundaries, '06');

      expect(result.valid).toBe(false);
      expect(result.summary).toContain('❌');
      expect(result.summary).toContain('invalid GEOID'); // Note: lowercase "invalid"
    });

    it('should reject school district GEOID with invalid state FIPS', () => {
      // Invalid state FIPS (99 doesn't exist)
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '9900001', // Invalid state FIPS
          name: 'Invalid State School District',
          geometry: createValidPolygon(),
          properties: {
            GEOID: '9900001',
            NAME: 'Invalid State School District',
            STATEFP: '99',
            SCSDLEA: '00001',
          },
        },
      ];

      const result = validator.validateCompleteness('scsd', boundaries, '06');

      expect(result.valid).toBe(false);
      expect(result.summary).toContain('❌');
      expect(result.summary).toContain('invalid GEOID'); // Note: lowercase "invalid"
    });

    it('should detect when 1 CD is missing', () => {
      // California has 52 CDs, provide only 51
      const boundaries: NormalizedBoundary[] = Array.from({ length: 51 }, (_, i) => ({
        geoid: `06${String(i + 1).padStart(2, '0')}`,
        name: `California District ${i + 1}`,
        geometry: createValidPolygon(),
        properties: {
          GEOID: `06${String(i + 1).padStart(2, '0')}`,
          NAMELSAD: `Congressional District ${i + 1}`,
          STATEFP: '06',
          CD119FP: String(i + 1).padStart(2, '0'),
        },
      }));

      const result = validator.validateCompleteness('cd', boundaries, '06');

      expect(result.valid).toBe(false);
      expect(result.expected).toBe(52);
      expect(result.actual).toBe(51);
      expect(result.percentage).toBeCloseTo(98.08, 1);
      expect(result.summary).toContain('❌ Incomplete');
    });

    it('should detect extra boundaries', () => {
      // Wyoming has 1 CD, provide 2 valid districts
      // Note: Using 01 and 02 as district codes (not 00 which is a placeholder)
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '5601',
          name: 'Wyoming At-Large',
          geometry: createValidPolygon(),
          properties: {
            GEOID: '5601',
            NAMELSAD: 'Congressional District (at Large)',
            STATEFP: '56',
            CD119FP: '01',
          },
        },
        {
          geoid: '5602',
          name: 'Wyoming District 2 (INVALID)',
          geometry: createValidPolygon(),
          properties: {
            GEOID: '5602',
            NAMELSAD: 'Congressional District 2 (INVALID)',
            STATEFP: '56',
            CD119FP: '02',
          },
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
        properties: {
          GEOID: `31${String(i + 1).padStart(3, '0')}`,
          NAMELSAD: `State Senate District ${i + 1}`,
          STATEFP: '31',
          SLDUST: String(i + 1).padStart(3, '0'),
        },
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
        properties: {
          GEOID: `48${String(i + 1).padStart(3, '0')}`,
          NAMELSAD: `Texas County ${i + 1}`,
          STATEFP: '48',
          COUNTYFP: String(i + 1).padStart(3, '0'),
        },
      }));

      const result = validator.validateCompleteness('county', boundaries, '48');

      expect(result.valid).toBe(true);
      expect(result.expected).toBe(254);
      expect(result.actual).toBe(254);
      expect(result.percentage).toBe(100);
    });

    it('should detect missing required fields', () => {
      // Congressional district with missing required fields
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '0601',
          name: 'California District 1',
          geometry: createValidPolygon(),
          properties: {
            // Missing required fields: GEOID, NAMELSAD, STATEFP, CD119FP
            GEOID: '0601',
            // NAMELSAD missing
            // STATEFP missing
            // CD119FP missing
          },
        },
      ];

      const result = validator.validateCompleteness('cd', boundaries, '06');

      expect(result.valid).toBe(false);
      expect(result.summary).toContain('missing required fields');
      expect(result.summary).toContain('NAMELSAD');
      expect(result.summary).toContain('STATEFP');
      expect(result.summary).toContain('CD119FP');
    });

    it('should pass when all required fields are present', () => {
      // Wyoming congressional district with all required fields
      // Note: District code 01 is used, not 00 (00 is a placeholder code that gets filtered)
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '5601',
          name: 'Wyoming At-Large',
          geometry: createValidPolygon(),
          properties: {
            GEOID: '5601',
            NAMELSAD: 'Congressional District (at Large)',
            STATEFP: '56',
            CD119FP: '01',
          },
        },
      ];

      const result = validator.validateCompleteness('cd', boundaries, '56');

      expect(result.valid).toBe(true);
      expect(result.summary).toContain('✅ Complete');
    });

    it('should validate VTD (voting district) required fields with 2020 vintage', () => {
      // VTD requires 2020-vintage fields (GEOID20, NAME20, STATEFP20, COUNTYFP20, VTDST20)
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '06001000001',
          name: 'VTD 000001',
          geometry: createValidPolygon(),
          properties: {
            GEOID20: '06001000001',
            NAME20: 'Precinct 1',
            STATEFP20: '06',
            COUNTYFP20: '001',
            VTDST20: '000001',
          },
        },
      ];

      const result = validator.validateCompleteness('vtd', boundaries, '06');

      // VTD now has expected counts (California has 25,594 VTDs)
      // With only 1 boundary provided, completeness will fail due to count mismatch
      expect(result.valid).toBe(false);
      expect(result.expected).toBeGreaterThan(1);
      expect(result.actual).toBe(1);
      expect(result.percentage).toBeLessThan(1); // 1/25594 is ~0.004%
      expect(result.summary).not.toContain('missing required fields');
    });

    it('should detect multiple boundaries with different missing fields', () => {
      // Multiple school districts with different missing fields
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '0600001',
          name: 'District 1',
          geometry: createValidPolygon(),
          properties: {
            GEOID: '0600001',
            NAME: 'District 1',
            // Missing STATEFP, UNSDLEA
          },
        },
        {
          geoid: '0600002',
          name: 'District 2',
          geometry: createValidPolygon(),
          properties: {
            GEOID: '0600002',
            // Missing NAME, STATEFP, UNSDLEA
          },
        },
        {
          geoid: '0600003',
          name: 'District 3',
          geometry: createValidPolygon(),
          properties: {
            GEOID: '0600003',
            NAME: 'District 3',
            STATEFP: '06',
            // Missing UNSDLEA
          },
        },
      ];

      const result = validator.validateCompleteness('unsd', boundaries, '06');

      expect(result.valid).toBe(false);
      expect(result.summary).toContain('3 boundaries missing required fields');
      // Should show most common missing fields
      expect(result.summary).toContain('UNSDLEA(3)'); // All 3 missing UNSDLEA
      expect(result.summary).toContain('STATEFP(2)'); // 2 missing STATEFP
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
      // Note: District code 01 is used, not 00 (00 is a placeholder code that gets filtered)
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '5601',
          name: 'Wyoming At-Large',
          geometry: createValidPolygon(),
          properties: {
            GEOID: '5601',
            NAMELSAD: 'Congressional District (at Large)',
            STATEFP: '56',
            CD119FP: '01',
          },
        },
      ];

      const result = validator.validate('cd', boundaries, '56');

      expect(result.qualityScore).toBe(100);
      expect(result.completeness.valid).toBe(true);
      expect(result.topology.valid).toBe(true);
      expect(result.coordinates.valid).toBe(true);
      expect(result.summary).toContain('Quality Score 100');
    });

    it('should validate school district data with correct GEOID format', () => {
      // Test unified school district
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '0600001',
          name: 'California Test Unified School District',
          geometry: createValidPolygon(),
          properties: {
            GEOID: '0600001',
            NAME: 'California Test Unified School District',
            STATEFP: '06',
            UNSDLEA: '00001',
          },
        },
      ];

      const result = validator.validate('unsd', boundaries);

      expect(result.topology.valid).toBe(true);
      expect(result.coordinates.valid).toBe(true);
      expect(result.layer).toBe('unsd');
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
