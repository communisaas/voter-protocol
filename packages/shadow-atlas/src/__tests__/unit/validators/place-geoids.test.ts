/**
 * Place GEOID Validation Tests
 *
 * Verifies that Place GEOIDs are correctly extracted and integrated
 * into the GEOID reference system.
 */

import { describe, it, expect } from 'vitest';
import {
  CANONICAL_PLACE_GEOIDS,
  EXPECTED_PLACE_BY_STATE,
  NATIONAL_PLACE_TOTAL,
  getPlaceGEOIDs,
  getExpectedPlaceCount,
} from '../../../validators/place-geoids.js';
import { getCanonicalGEOIDs, validateGEOIDCompleteness } from '../../../validators/geoid/reference.js';

describe('Place GEOIDs', () => {
  describe('CANONICAL_PLACE_GEOIDS', () => {
    it('should contain entries for all 50 states plus DC', () => {
      const states = Object.keys(CANONICAL_PLACE_GEOIDS);
      // 50 states + DC = 51
      expect(states.length).toBe(51);
    });

    it('should have 32,041 total places nationally', () => {
      let total = 0;
      for (const geoids of Object.values(CANONICAL_PLACE_GEOIDS)) {
        total += geoids.length;
      }
      expect(total).toBe(NATIONAL_PLACE_TOTAL);
      expect(total).toBe(32041);
    });

    it('should match expected counts for each state', () => {
      for (const [stateFips, geoids] of Object.entries(CANONICAL_PLACE_GEOIDS)) {
        const expected = EXPECTED_PLACE_BY_STATE[stateFips];
        expect(geoids.length).toBe(expected);
      }
    });

    it('should have valid GEOID format (7 digits: SSPPPPP)', () => {
      for (const [stateFips, geoids] of Object.entries(CANONICAL_PLACE_GEOIDS)) {
        for (const geoid of geoids) {
          // GEOID should be exactly 7 digits
          expect(geoid).toMatch(/^\d{7}$/);
          // First 2 digits should match state FIPS
          expect(geoid.substring(0, 2)).toBe(stateFips);
        }
      }
    });

    it('should have sorted GEOIDs within each state', () => {
      for (const [stateFips, geoids] of Object.entries(CANONICAL_PLACE_GEOIDS)) {
        const sorted = [...geoids].sort();
        expect(geoids).toEqual(sorted);
      }
    });

    it('should not have duplicate GEOIDs within each state', () => {
      for (const [stateFips, geoids] of Object.entries(CANONICAL_PLACE_GEOIDS)) {
        const unique = new Set(geoids);
        expect(unique.size).toBe(geoids.length);
      }
    });
  });

  describe('Major city GEOIDs', () => {
    it('should contain Los Angeles, CA (0644000)', () => {
      const caPlaces = CANONICAL_PLACE_GEOIDS['06'];
      expect(caPlaces).toBeDefined();
      expect(caPlaces.includes('0644000')).toBe(true);
    });

    it('should contain New York City, NY (3651000)', () => {
      const nyPlaces = CANONICAL_PLACE_GEOIDS['36'];
      expect(nyPlaces).toBeDefined();
      expect(nyPlaces.includes('3651000')).toBe(true);
    });

    it('should contain Houston, TX (4835000)', () => {
      const txPlaces = CANONICAL_PLACE_GEOIDS['48'];
      expect(txPlaces).toBeDefined();
      expect(txPlaces.includes('4835000')).toBe(true);
    });

    it('should contain Chicago, IL (1714000)', () => {
      const ilPlaces = CANONICAL_PLACE_GEOIDS['17'];
      expect(ilPlaces).toBeDefined();
      expect(ilPlaces.includes('1714000')).toBe(true);
    });

    it('should contain Washington, DC (1150000)', () => {
      const dcPlaces = CANONICAL_PLACE_GEOIDS['11'];
      expect(dcPlaces).toBeDefined();
      expect(dcPlaces.includes('1150000')).toBe(true);
    });
  });

  describe('getPlaceGEOIDs function', () => {
    it('should return California places', () => {
      const places = getPlaceGEOIDs('06');
      expect(places).toBeDefined();
      expect(places?.length).toBe(1618);
    });

    it('should return null for invalid state FIPS', () => {
      const places = getPlaceGEOIDs('99');
      expect(places).toBeNull();
    });

    it('should return Texas places', () => {
      const places = getPlaceGEOIDs('48');
      expect(places).toBeDefined();
      expect(places?.length).toBe(1863);
    });
  });

  describe('getExpectedPlaceCount function', () => {
    it('should return correct count for California', () => {
      expect(getExpectedPlaceCount('06')).toBe(1618);
    });

    it('should return correct count for Texas', () => {
      expect(getExpectedPlaceCount('48')).toBe(1863);
    });

    it('should return null for invalid state FIPS', () => {
      expect(getExpectedPlaceCount('99')).toBeNull();
    });
  });

  describe('Integration with geoid-reference.ts', () => {
    it('should return Place GEOIDs via getCanonicalGEOIDs', () => {
      const caPlaces = getCanonicalGEOIDs('place', '06');
      expect(caPlaces).toBeDefined();
      expect(caPlaces?.length).toBe(1618);
    });

    it('should validate complete Place data correctly', () => {
      const caPlaces = CANONICAL_PLACE_GEOIDS['06'];
      const result = validateGEOIDCompleteness('place', '06', caPlaces);
      expect(result.valid).toBe(true);
      expect(result.missing.length).toBe(0);
      expect(result.extra.length).toBe(0);
    });

    it('should detect missing Place GEOIDs', () => {
      const caPlaces = CANONICAL_PLACE_GEOIDS['06'];
      // Remove first few GEOIDs
      const incomplete = caPlaces.slice(5);
      const result = validateGEOIDCompleteness('place', '06', incomplete);
      expect(result.valid).toBe(false);
      expect(result.missing.length).toBe(5);
    });

    it('should detect extra Place GEOIDs', () => {
      const caPlaces = CANONICAL_PLACE_GEOIDS['06'];
      // Add a fake GEOID
      const withExtra = [...caPlaces, '0699999'] as readonly string[];
      const result = validateGEOIDCompleteness('place', '06', withExtra);
      expect(result.valid).toBe(false);
      expect(result.extra.length).toBe(1);
      expect(result.extra[0]).toBe('0699999');
    });
  });

  describe('State-specific counts', () => {
    it('Pennsylvania should have the most places (2002)', () => {
      const maxState = Object.entries(EXPECTED_PLACE_BY_STATE)
        .reduce((max, [state, count]) => count > max[1] ? [state, count] : max, ['', 0]);
      expect(maxState[0]).toBe('42'); // Pennsylvania
      expect(maxState[1]).toBe(2002);
    });

    it('DC should have exactly 1 place', () => {
      expect(EXPECTED_PLACE_BY_STATE['11']).toBe(1);
    });

    it('Texas should have 1863 places (incorporated + CDPs)', () => {
      expect(EXPECTED_PLACE_BY_STATE['48']).toBe(1863);
    });

    it('Rhode Island should have 36 places', () => {
      expect(EXPECTED_PLACE_BY_STATE['44']).toBe(36);
    });
  });
});
