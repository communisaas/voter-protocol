/**
 * Validation Halt Gates Tests
 *
 * Tests for the ValidationHaltError and halt gate behavior in TIGERValidator.
 *
 * CRITICAL: These tests verify that validation failures HALT processing
 * BEFORE invalid data can enter the Merkle tree. Invalid data in the tree
 * would break ZK proof generation.
 *
 * TEST COVERAGE:
 * 1. ValidationHaltError class behavior
 * 2. Halt gate triggers for each validation stage
 * 3. Halt options configuration (enable/disable)
 * 4. Non-halt behavior for warnings (redistricting gaps, low quality)
 * 5. Integration with validateWithHaltGates method
 */

import { describe, it, expect } from 'vitest';
import {
  TIGERValidator,
  DEFAULT_HALT_OPTIONS,
  type ValidationHaltOptions,
  type NormalizedBoundary,
} from '../../../validators/tiger-validator.js';
import {
  ValidationHaltError,
  isValidationHaltError,
  type ValidationHaltDetails,
} from '../../../core/types/errors.js';
import type { Polygon } from 'geojson';

describe('ValidationHaltError', () => {
  describe('constructor and properties', () => {
    it('should create error with correct properties', () => {
      const details: ValidationHaltDetails = {
        stage: 'topology',
        details: { selfIntersections: 5 },
        layerType: 'cd',
        stateFips: '06',
      };

      const error = new ValidationHaltError('Topology validation failed', details);

      expect(error.name).toBe('ValidationHaltError');
      expect(error.message).toBe('Topology validation failed');
      expect(error.stage).toBe('topology');
      expect(error.layerType).toBe('cd');
      expect(error.stateFips).toBe('06');
      expect(error.validationResult).toEqual(details);
    });

    it('should be instanceof Error', () => {
      const error = new ValidationHaltError('Test', {
        stage: 'completeness',
        details: {},
      });

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ValidationHaltError);
    });

    it('should provide formatted log string', () => {
      const error = new ValidationHaltError('Coordinate validation failed', {
        stage: 'coordinates',
        details: { outOfRangeCount: 10 },
        layerType: 'county',
        stateFips: '48',
      });

      const logString = error.toLogString();

      expect(logString).toContain('ValidationHaltError');
      expect(logString).toContain('Coordinate validation failed');
      expect(logString).toContain('Stage: coordinates');
      expect(logString).toContain('Layer: county');
      expect(logString).toContain('State FIPS: 48');
    });
  });

  describe('isValidationHaltError type guard', () => {
    it('should return true for ValidationHaltError', () => {
      const error = new ValidationHaltError('Test', {
        stage: 'topology',
        details: {},
      });

      expect(isValidationHaltError(error)).toBe(true);
    });

    it('should return false for regular Error', () => {
      const error = new Error('Regular error');

      expect(isValidationHaltError(error)).toBe(false);
    });

    it('should return false for non-Error objects', () => {
      expect(isValidationHaltError({ message: 'not an error' })).toBe(false);
      expect(isValidationHaltError('string error')).toBe(false);
      expect(isValidationHaltError(null)).toBe(false);
      expect(isValidationHaltError(undefined)).toBe(false);
    });
  });
});

describe('DEFAULT_HALT_OPTIONS', () => {
  it('should have all halt gates enabled by default', () => {
    expect(DEFAULT_HALT_OPTIONS.haltOnTopologyError).toBe(true);
    expect(DEFAULT_HALT_OPTIONS.haltOnCompletenessError).toBe(true);
    expect(DEFAULT_HALT_OPTIONS.haltOnCoordinateError).toBe(true);
  });
});

describe('TIGERValidator.validateWithHaltGates', () => {
  const validator = new TIGERValidator();

  describe('completeness halt gate', () => {
    it('should throw ValidationHaltError when completeness fails and halt enabled', () => {
      // California has 52 CDs, provide only 51
      const boundaries = createBoundaries(51, '06');

      expect(() =>
        validator.validateWithHaltGates('cd', boundaries, DEFAULT_HALT_OPTIONS, '06')
      ).toThrow(ValidationHaltError);

      try {
        validator.validateWithHaltGates('cd', boundaries, DEFAULT_HALT_OPTIONS, '06');
      } catch (error) {
        expect(isValidationHaltError(error)).toBe(true);
        if (isValidationHaltError(error)) {
          expect(error.stage).toBe('completeness');
          expect(error.layerType).toBe('cd');
          expect(error.stateFips).toBe('06');
        }
      }
    });

    it('should NOT throw when completeness fails but halt disabled', () => {
      const boundaries = createBoundaries(51, '06');
      const options: ValidationHaltOptions = {
        haltOnTopologyError: false, // Also disable topology halt (overlaps may be detected)
        haltOnCompletenessError: false,
        haltOnCoordinateError: false,
      };

      // Should not throw
      const result = validator.validateWithHaltGates('cd', boundaries, options, '06');

      expect(result.completeness.valid).toBe(false);
      expect(result.qualityScore).toBeLessThan(100);
    });

    it('should pass when completeness is valid', () => {
      // Wyoming has 1 CD, provide exactly 1 with valid district code
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

      const result = validator.validateWithHaltGates('cd', boundaries, DEFAULT_HALT_OPTIONS, '56');

      expect(result.completeness.valid).toBe(true);
      expect(result.qualityScore).toBe(100);
    });
  });

  describe('topology halt gate', () => {
    it('should throw ValidationHaltError when topology fails and halt enabled', () => {
      // Wyoming has 1 CD, provide 1 with invalid geometry (null)
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '5601',
          name: 'Wyoming At-Large (invalid geometry)',
          geometry: null as unknown as Polygon,
          properties: {
            GEOID: '5601',
            NAMELSAD: 'Congressional District (at Large)',
            STATEFP: '56',
            CD119FP: '01',
          },
        },
      ];

      expect(() =>
        validator.validateWithHaltGates('cd', boundaries, DEFAULT_HALT_OPTIONS, '56')
      ).toThrow(ValidationHaltError);

      try {
        validator.validateWithHaltGates('cd', boundaries, DEFAULT_HALT_OPTIONS, '56');
      } catch (error) {
        expect(isValidationHaltError(error)).toBe(true);
        if (isValidationHaltError(error)) {
          expect(error.stage).toBe('topology');
          expect(error.message).toContain('Topology validation failed');
        }
      }
    });

    it('should NOT throw when topology fails but halt disabled', () => {
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '5601',
          name: 'Wyoming At-Large',
          geometry: null as unknown as Polygon,
          properties: {
            GEOID: '5601',
            NAMELSAD: 'Congressional District (at Large)',
            STATEFP: '56',
            CD119FP: '01',
          },
        },
      ];
      const options: ValidationHaltOptions = {
        haltOnTopologyError: false,
        haltOnCompletenessError: false, // Completeness might also fail
        haltOnCoordinateError: false, // Null geometry also causes coordinate issues
      };

      // Should not throw
      const result = validator.validateWithHaltGates('cd', boundaries, options, '56');

      expect(result.topology.valid).toBe(false);
    });

    it('should throw for empty polygon geometry', () => {
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '5601',
          name: 'Wyoming At-Large (empty)',
          geometry: {
            type: 'Polygon',
            coordinates: [], // Empty polygon
          },
          properties: {
            GEOID: '5601',
            NAMELSAD: 'Congressional District (at Large)',
            STATEFP: '56',
            CD119FP: '01',
          },
        },
      ];

      expect(() =>
        validator.validateWithHaltGates('cd', boundaries, DEFAULT_HALT_OPTIONS, '56')
      ).toThrow(ValidationHaltError);
    });
  });

  describe('coordinate halt gate', () => {
    it('should throw ValidationHaltError when coordinates fail and halt enabled', () => {
      // Use a polygon with valid topology but containing one null coordinate
      // The polygon must be properly closed and not self-intersecting
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '5601',
          name: 'Wyoming At-Large (with null coord)',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-122.0, 47.0],
                [-122.0, 48.0],
                [NaN, NaN], // Invalid coordinate that doesn't break topology
                [-121.0, 47.0],
                [-122.0, 47.0],
              ],
            ],
          },
          properties: {
            GEOID: '5601',
            NAMELSAD: 'Congressional District (at Large)',
            STATEFP: '56',
            CD119FP: '01',
          },
        },
      ];

      // Need to disable topology halt since NaN coords may cause topology issues
      const options: ValidationHaltOptions = {
        haltOnTopologyError: false, // Skip topology to test coordinate halt
        haltOnCompletenessError: true,
        haltOnCoordinateError: true,
      };

      expect(() =>
        validator.validateWithHaltGates('cd', boundaries, options, '56')
      ).toThrow(ValidationHaltError);

      try {
        validator.validateWithHaltGates('cd', boundaries, options, '56');
      } catch (error) {
        expect(isValidationHaltError(error)).toBe(true);
        if (isValidationHaltError(error)) {
          expect(error.stage).toBe('coordinates');
          expect(error.message).toContain('Coordinate validation failed');
        }
      }
    });

    it('should NOT throw when coordinates fail but halt disabled', () => {
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '5601',
          name: 'Wyoming At-Large (with NaN coord)',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-122.0, 47.0],
                [-122.0, 48.0],
                [NaN, NaN],
                [-121.0, 47.0],
                [-122.0, 47.0],
              ],
            ],
          },
          properties: {
            GEOID: '5601',
            NAMELSAD: 'Congressional District (at Large)',
            STATEFP: '56',
            CD119FP: '01',
          },
        },
      ];
      const options: ValidationHaltOptions = {
        haltOnTopologyError: false, // Disable all halts
        haltOnCompletenessError: false,
        haltOnCoordinateError: false,
      };

      // Should not throw
      const result = validator.validateWithHaltGates('cd', boundaries, options, '56');

      expect(result.coordinates.valid).toBe(false);
    });

    it('should throw for out-of-range coordinates when topology halt disabled', () => {
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '5601',
          name: 'Wyoming At-Large (out of range)',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-200.0, 47.0], // Longitude out of range
                [-200.0, 48.0],
                [-199.0, 48.0],
                [-199.0, 47.0],
                [-200.0, 47.0],
              ],
            ],
          },
          properties: {
            GEOID: '5601',
            NAMELSAD: 'Congressional District (at Large)',
            STATEFP: '56',
            CD119FP: '01',
          },
        },
      ];

      // Disable topology halt to reach coordinate validation
      const options: ValidationHaltOptions = {
        haltOnTopologyError: false,
        haltOnCompletenessError: true,
        haltOnCoordinateError: true,
      };

      expect(() =>
        validator.validateWithHaltGates('cd', boundaries, options, '56')
      ).toThrow(ValidationHaltError);
    });
  });

  describe('halt gate order and priority', () => {
    it('should halt on completeness BEFORE checking topology', () => {
      // Provide incomplete data (50 CDs for California which needs 52)
      // Even if topology is perfect, completeness should halt first
      const boundaries = createBoundaries(50, '06'); // Missing 2 CDs

      try {
        validator.validateWithHaltGates('cd', boundaries, DEFAULT_HALT_OPTIONS, '06');
        expect.fail('Should have thrown ValidationHaltError');
      } catch (error) {
        expect(isValidationHaltError(error)).toBe(true);
        if (isValidationHaltError(error)) {
          // Should halt on completeness first (check order)
          expect(error.stage).toBe('completeness');
          expect(error.message).toContain('Completeness validation failed');
        }
      }
    });

    it('should halt on topology BEFORE checking coordinates', () => {
      // Wyoming has 1 CD - provide 1 with null geometry but valid count
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '5601',
          name: 'Wyoming At-Large',
          geometry: null as unknown as Polygon,
          properties: {
            GEOID: '5601',
            NAMELSAD: 'Congressional District (at Large)',
            STATEFP: '56',
            CD119FP: '01',
          },
        },
      ];

      try {
        validator.validateWithHaltGates('cd', boundaries, DEFAULT_HALT_OPTIONS, '56');
        expect.fail('Should have thrown ValidationHaltError');
      } catch (error) {
        expect(isValidationHaltError(error)).toBe(true);
        if (isValidationHaltError(error)) {
          expect(error.stage).toBe('topology'); // Halts on topology, not coordinates
        }
      }
    });
  });

  describe('non-halt behavior (warnings)', () => {
    it('should NOT halt on redistricting gap warning', () => {
      // Wyoming CD during redistricting gap period (e.g., Jan 2022)
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

      // Use a date during redistricting gap period
      const redistrictingDate = new Date('2022-03-15');

      // Should not throw even if there's a redistricting gap warning
      const result = validator.validateWithHaltGates(
        'cd',
        boundaries,
        DEFAULT_HALT_OPTIONS,
        '56',
        redistrictingDate
      );

      expect(result.qualityScore).toBe(100);
      // May or may not have warning depending on gap detector implementation
    });

    it('should return warnings in result when present', () => {
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

      const result = validator.validateWithHaltGates('cd', boundaries, DEFAULT_HALT_OPTIONS, '56');

      // Result structure should include warnings array (even if empty)
      expect(result).toHaveProperty('layer');
      expect(result).toHaveProperty('qualityScore');
      expect(result).toHaveProperty('completeness');
      expect(result).toHaveProperty('topology');
      expect(result).toHaveProperty('coordinates');
    });
  });

  describe('all halt gates disabled', () => {
    it('should return validation result even with all failures', () => {
      const options: ValidationHaltOptions = {
        haltOnTopologyError: false,
        haltOnCompletenessError: false,
        haltOnCoordinateError: false,
      };

      // Missing boundaries, bad geometry, bad coordinates
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '0601',
          name: 'California District 1',
          geometry: null as unknown as Polygon, // Bad topology
          properties: {},
        },
      ];

      // Should not throw
      const result = validator.validateWithHaltGates('cd', boundaries, options, '06');

      expect(result.completeness.valid).toBe(false);
      expect(result.topology.valid).toBe(false);
      expect(result.qualityScore).toBeLessThan(50);
    });
  });
});

/**
 * Helper: Create array of valid CD boundaries
 */
function createBoundaries(count: number, stateFips: string): NormalizedBoundary[] {
  return Array.from({ length: count }, (_, i) => ({
    geoid: `${stateFips}${String(i + 1).padStart(2, '0')}`,
    name: `District ${i + 1}`,
    geometry: createValidPolygon(),
    properties: {
      GEOID: `${stateFips}${String(i + 1).padStart(2, '0')}`,
      NAMELSAD: `Congressional District ${i + 1}`,
      STATEFP: stateFips,
      CD119FP: String(i + 1).padStart(2, '0'),
    },
  }));
}

/**
 * Helper: Create a valid polygon for testing
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
