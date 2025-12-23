/**
 * School District Validator Tests
 *
 * Unit tests for school district validation logic with mocked data.
 *
 * TEST COVERAGE:
 * 1. GEOID format validation (SSLLLLL pattern)
 * 2. Property completeness validation
 * 3. District type detection (unified vs split)
 * 4. Coordinate validation
 * 5. Grade range validation
 * 6. State count validation
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { describe, it, expect } from 'vitest';
import type { Polygon, MultiPolygon } from 'geojson';
import {
  URBAN_UNIFIED_DISTRICTS,
  RURAL_UNIFIED_DISTRICTS,
  SPLIT_DISTRICTS,
  EDGE_CASE_NO_NAME,
  EDGE_CASE_LARGE_AREA,
  getExpectedSchoolDistrictCount,
  type SchoolDistrictProperties,
} from '../__tests__/fixtures/school-district-fixtures.js';

// ============================================================================
// Validation Functions (normally imported from validator, defined here for tests)
// ============================================================================

/**
 * Validate GEOID format for school districts
 * Format: SSLLLLL (2-digit state FIPS + 5-digit LEA code)
 */
function validateSchoolDistrictGeoid(
  geoid: string,
  stateFips: string
): { valid: boolean; error?: string } {
  if (!geoid || typeof geoid !== 'string') {
    return { valid: false, error: 'GEOID must be a non-empty string' };
  }

  if (!geoid.startsWith(stateFips)) {
    return {
      valid: false,
      error: `GEOID must start with state FIPS ${stateFips}, got ${geoid.substring(0, 2)}`,
    };
  }

  if (geoid.length !== 7) {
    return {
      valid: false,
      error: `GEOID must be 7 digits (SSLLLLL), got ${geoid.length}`,
    };
  }

  if (!/^\d+$/.test(geoid)) {
    return { valid: false, error: `GEOID must contain only digits, got ${geoid}` };
  }

  return { valid: true };
}

/**
 * Validate required properties for school district
 */
function validateSchoolDistrictProperties(
  properties: Record<string, unknown> | null
): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  if (!properties) {
    return { valid: false, missing: ['properties object is null'] };
  }

  // Required fields
  const required = ['GEOID', 'NAME', 'STATEFP'];
  for (const field of required) {
    if (!(field in properties) || !properties[field]) {
      missing.push(field);
    }
  }

  return { valid: missing.length === 0, missing };
}

/**
 * Detect school district type from properties
 */
function detectSchoolDistrictType(
  properties: SchoolDistrictProperties
): 'unified' | 'elementary' | 'secondary' | 'unknown' {
  if (properties.SCSDLEA) return 'unified';
  if (properties.ELSDLEA) return 'elementary';
  if (properties.SDLEA) return 'secondary';
  return 'unknown';
}

/**
 * Validate grade range
 */
function validateGradeRange(
  loGrade?: string,
  hiGrade?: string
): { valid: boolean; error?: string } {
  if (!loGrade || !hiGrade) {
    return { valid: true }; // Optional fields
  }

  const gradeOrder = ['PK', 'KG', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  const loIndex = gradeOrder.indexOf(loGrade);
  const hiIndex = gradeOrder.indexOf(hiGrade);

  if (loIndex === -1) {
    return { valid: false, error: `Invalid low grade: ${loGrade}` };
  }

  if (hiIndex === -1) {
    return { valid: false, error: `Invalid high grade: ${hiGrade}` };
  }

  if (loIndex > hiIndex) {
    return {
      valid: false,
      error: `Low grade ${loGrade} cannot be higher than high grade ${hiGrade}`,
    };
  }

  return { valid: true };
}

/**
 * Validate polygon coordinates
 */
function validatePolygonCoordinates(
  geometry: Polygon | MultiPolygon
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const validatePosition = (pos: number[], index: number): void => {
    if (pos.length < 2) {
      errors.push(`Position ${index}: insufficient dimensions (${pos.length})`);
      return;
    }

    const [lng, lat] = pos;

    if (typeof lng !== 'number' || typeof lat !== 'number') {
      errors.push(`Position ${index}: non-numeric coordinates`);
      return;
    }

    if (lng < -180 || lng > 180) {
      errors.push(`Position ${index}: longitude ${lng} out of range [-180, 180]`);
    }

    if (lat < -90 || lat > 90) {
      errors.push(`Position ${index}: latitude ${lat} out of range [-90, 90]`);
    }
  };

  if (geometry.type === 'Polygon') {
    let posIndex = 0;
    for (const ring of geometry.coordinates) {
      for (const pos of ring) {
        validatePosition(pos, posIndex++);
      }
    }
  } else if (geometry.type === 'MultiPolygon') {
    let posIndex = 0;
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) {
        for (const pos of ring) {
          validatePosition(pos, posIndex++);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// Unit Tests
// ============================================================================

describe('School District Validator', () => {
  describe('GEOID Validation', () => {
    it('should validate correct Seattle GEOID', () => {
      const result = validateSchoolDistrictGeoid('5303780', '53');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should validate correct Los Angeles GEOID', () => {
      const result = validateSchoolDistrictGeoid('0622710', '06');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject GEOID with wrong state FIPS', () => {
      const result = validateSchoolDistrictGeoid('0622710', '53');  // CA district, WA FIPS
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must start with state FIPS 53');
    });

    it('should reject GEOID with wrong length', () => {
      const result = validateSchoolDistrictGeoid('53037', '53');  // Too short
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be 7 digits');
    });

    it('should reject GEOID with non-numeric characters', () => {
      const result = validateSchoolDistrictGeoid('53ABC80', '53');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must contain only digits');
    });

    it('should reject empty GEOID', () => {
      const result = validateSchoolDistrictGeoid('', '53');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('non-empty string');
    });

    it('should validate all fixture GEOIDs', () => {
      const allFixtures = [
        ...URBAN_UNIFIED_DISTRICTS,
        ...RURAL_UNIFIED_DISTRICTS,
        ...SPLIT_DISTRICTS,
      ];

      for (const fixture of allFixtures) {
        const result = validateSchoolDistrictGeoid(fixture.geoid, fixture.stateFips);
        expect(result.valid).toBe(true);
      }
    });
  });

  describe('Property Validation', () => {
    it('should validate complete properties', () => {
      const result = validateSchoolDistrictProperties(
        URBAN_UNIFIED_DISTRICTS[0].properties
      );
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('should detect missing GEOID', () => {
      const props = {
        NAME: 'Test District',
        STATEFP: '53',
      };
      const result = validateSchoolDistrictProperties(props);
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('GEOID');
    });

    it('should detect missing NAME', () => {
      const props = {
        GEOID: '5303780',
        STATEFP: '53',
      };
      const result = validateSchoolDistrictProperties(props);
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('NAME');
    });

    it('should detect missing STATEFP', () => {
      const props = {
        GEOID: '5303780',
        NAME: 'Test District',
      };
      const result = validateSchoolDistrictProperties(props);
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('STATEFP');
    });

    it('should detect null properties object', () => {
      const result = validateSchoolDistrictProperties(null);
      expect(result.valid).toBe(false);
      expect(result.missing.length).toBeGreaterThan(0);
    });

    it('should detect empty NAME (edge case)', () => {
      const result = validateSchoolDistrictProperties(EDGE_CASE_NO_NAME.properties);
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('NAME');
    });
  });

  describe('District Type Detection', () => {
    it('should detect unified district', () => {
      const type = detectSchoolDistrictType(URBAN_UNIFIED_DISTRICTS[0].properties);
      expect(type).toBe('unified');
    });

    it('should detect elementary district', () => {
      const type = detectSchoolDistrictType(SPLIT_DISTRICTS[0].properties);
      expect(type).toBe('elementary');
    });

    it('should detect secondary district', () => {
      const type = detectSchoolDistrictType(SPLIT_DISTRICTS[1].properties);
      expect(type).toBe('secondary');
    });

    it('should handle unknown district type', () => {
      const props: SchoolDistrictProperties = {
        GEOID: '5399999',
        NAME: 'Unknown Type',
        STATEFP: '53',
        // No SCSDLEA, ELSDLEA, or SDLEA
      };
      const type = detectSchoolDistrictType(props);
      expect(type).toBe('unknown');
    });

    it('should detect type for all fixtures', () => {
      const allFixtures = [
        ...URBAN_UNIFIED_DISTRICTS,
        ...RURAL_UNIFIED_DISTRICTS,
        ...SPLIT_DISTRICTS,
      ];

      for (const fixture of allFixtures) {
        const type = detectSchoolDistrictType(fixture.properties);
        expect(type).toBe(fixture.type);
      }
    });
  });

  describe('Grade Range Validation', () => {
    it('should validate PK-12 range', () => {
      const result = validateGradeRange('PK', '12');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should validate KG-08 range (elementary)', () => {
      const result = validateGradeRange('KG', '08');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should validate 09-12 range (secondary)', () => {
      const result = validateGradeRange('09', '12');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject invalid low grade', () => {
      const result = validateGradeRange('XX', '12');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid low grade');
    });

    it('should reject invalid high grade', () => {
      const result = validateGradeRange('PK', 'XX');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid high grade');
    });

    it('should reject reversed range', () => {
      const result = validateGradeRange('12', 'PK');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot be higher than');
    });

    it('should allow missing grades (optional)', () => {
      const result = validateGradeRange(undefined, undefined);
      expect(result.valid).toBe(true);
    });

    it('should validate all fixture grade ranges', () => {
      const allFixtures = [
        ...URBAN_UNIFIED_DISTRICTS,
        ...RURAL_UNIFIED_DISTRICTS,
        ...SPLIT_DISTRICTS,
      ];

      for (const fixture of allFixtures) {
        const result = validateGradeRange(
          fixture.properties.LOGRADE,
          fixture.properties.HIGRADE
        );
        expect(result.valid).toBe(true);
      }
    });
  });

  describe('Coordinate Validation', () => {
    it('should validate correct polygon', () => {
      const geometry: Polygon = {
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
      };

      const result = validatePolygonCoordinates(geometry);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate MultiPolygon', () => {
      const geometry: MultiPolygon = {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [-122.0, 47.0],
              [-122.0, 48.0],
              [-121.0, 48.0],
              [-121.0, 47.0],
              [-122.0, 47.0],
            ],
          ],
          [
            [
              [-120.0, 46.0],
              [-120.0, 47.0],
              [-119.0, 47.0],
              [-119.0, 46.0],
              [-120.0, 46.0],
            ],
          ],
        ],
      };

      const result = validatePolygonCoordinates(geometry);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject longitude out of range', () => {
      const geometry: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [-200.0, 47.0],  // Invalid longitude
            [-122.0, 48.0],
            [-121.0, 48.0],
            [-121.0, 47.0],
            [-200.0, 47.0],
          ],
        ],
      };

      const result = validatePolygonCoordinates(geometry);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('longitude'))).toBe(true);
    });

    it('should reject latitude out of range', () => {
      const geometry: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [-122.0, 95.0],  // Invalid latitude
            [-122.0, 48.0],
            [-121.0, 48.0],
            [-121.0, 47.0],
            [-122.0, 95.0],
          ],
        ],
      };

      const result = validatePolygonCoordinates(geometry);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('latitude'))).toBe(true);
    });

    it('should handle Alaska coordinates (edge of valid range)', () => {
      const geometry: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [-170.0, 70.0],  // Arctic Alaska
            [-170.0, 71.0],
            [-169.0, 71.0],
            [-169.0, 70.0],
            [-170.0, 70.0],
          ],
        ],
      };

      const result = validatePolygonCoordinates(geometry);
      expect(result.valid).toBe(true);
    });
  });

  describe('State Count Validation', () => {
    it('should return expected count for Washington unified districts', () => {
      const count = getExpectedSchoolDistrictCount('53', 'unified');
      expect(count).toBe(295);
    });

    it('should return expected count for California unified districts', () => {
      const count = getExpectedSchoolDistrictCount('06', 'unified');
      expect(count).toBe(1037);
    });

    it('should return expected count for Illinois unified districts', () => {
      const count = getExpectedSchoolDistrictCount('17', 'unified');
      expect(count).toBe(862);
    });

    it('should return expected count for Illinois elementary districts', () => {
      const count = getExpectedSchoolDistrictCount('17', 'elementary');
      expect(count).toBe(426);
    });

    it('should return expected count for Illinois secondary districts', () => {
      const count = getExpectedSchoolDistrictCount('17', 'secondary');
      expect(count).toBe(96);
    });

    it('should return 0 for Washington elementary districts (none exist)', () => {
      const count = getExpectedSchoolDistrictCount('53', 'elementary');
      expect(count).toBe(0);
    });

    it('should return null for unknown state', () => {
      const count = getExpectedSchoolDistrictCount('99', 'unified');
      expect(count).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty name (edge case)', () => {
      const props = validateSchoolDistrictProperties(EDGE_CASE_NO_NAME.properties);
      expect(props.valid).toBe(false);
      expect(props.missing).toContain('NAME');
    });

    it('should handle very large area districts (Alaska)', () => {
      const geoid = validateSchoolDistrictGeoid(
        EDGE_CASE_LARGE_AREA.geoid,
        EDGE_CASE_LARGE_AREA.stateFips
      );
      expect(geoid.valid).toBe(true);

      // Verify large area is present
      expect(EDGE_CASE_LARGE_AREA.properties.ALAND).toBeGreaterThan(200000000000);
    });

    it('should validate district with more water than land', () => {
      const props = validateSchoolDistrictProperties({
        GEOID: '0200090',
        NAME: 'Bristol Bay Borough School District',
        STATEFP: '02',
        SCSDLEA: '00090',
        ALAND: 1300000000,
        AWATER: 1800000000,  // More water than land
      });

      expect(props.valid).toBe(true);
    });
  });
});
