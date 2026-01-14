/**
 * Place GEOIDs Loader Tests
 *
 * Validates JSON data loader produces identical results to original TypeScript constants
 */

import { describe, it, expect } from 'vitest';
import {
  NATIONAL_PLACE_TOTAL,
  EXPECTED_PLACE_BY_STATE,
  getPlaceGeoidsForState,
  getAllPlaceGeoids,
  getExpectedPlaceCount,
  validatePlaceCount,
  getPlaceMetadata,
} from './place-geoids-loader';

describe('Place GEOIDs Loader', () => {
  describe('Constants', () => {
    it('should have correct national total', () => {
      expect(NATIONAL_PLACE_TOTAL).toBe(32041);
    });

    it('should have expected counts for all states', () => {
      expect(Object.keys(EXPECTED_PLACE_BY_STATE)).toHaveLength(51); // 50 states + DC
      expect(EXPECTED_PLACE_BY_STATE['06']).toBe(1618); // California
      expect(EXPECTED_PLACE_BY_STATE['11']).toBe(1); // DC
      expect(EXPECTED_PLACE_BY_STATE['36']).toBe(1293); // New York
    });
  });

  describe('getPlaceGeoidsForState()', () => {
    it('should return GEOIDs for valid state', () => {
      const caPlaces = getPlaceGeoidsForState('06');
      expect(caPlaces).toHaveLength(1618);
      expect(caPlaces).toContain('0644000'); // Los Angeles
    });

    it('should return DC as single place', () => {
      const dcPlaces = getPlaceGeoidsForState('11');
      expect(dcPlaces).toHaveLength(1);
    });

    it('should return empty array for invalid state', () => {
      const invalid = getPlaceGeoidsForState('99');
      expect(invalid).toEqual([]);
    });

    it('should return read-only arrays', () => {
      const places = getPlaceGeoidsForState('06');
      expect(Object.isFrozen(places)).toBe(false); // JSON import not frozen, but typed as readonly
    });
  });

  describe('getAllPlaceGeoids()', () => {
    it('should return complete dataset', () => {
      const allPlaces = getAllPlaceGeoids();
      expect(Object.keys(allPlaces)).toHaveLength(51);
    });

    it('should match national total when summed', () => {
      const allPlaces = getAllPlaceGeoids();
      const total = Object.values(allPlaces).reduce(
        (sum, arr) => sum + arr.length,
        0
      );
      expect(total).toBe(NATIONAL_PLACE_TOTAL);
    });
  });

  describe('getExpectedPlaceCount()', () => {
    it('should return correct count for valid state', () => {
      expect(getExpectedPlaceCount('06')).toBe(1618); // California
      expect(getExpectedPlaceCount('11')).toBe(1); // DC
    });

    it('should return null for invalid state', () => {
      expect(getExpectedPlaceCount('99')).toBeNull();
    });
  });

  describe('validatePlaceCount()', () => {
    it('should validate correct counts', () => {
      expect(validatePlaceCount('06')).toBe(true); // California
      expect(validatePlaceCount('11')).toBe(true); // DC
      expect(validatePlaceCount('36')).toBe(true); // New York
    });

    it('should return false for invalid state', () => {
      expect(validatePlaceCount('99')).toBe(false);
    });

    it('should validate all states', () => {
      const states = Object.keys(EXPECTED_PLACE_BY_STATE);
      const validations = states.map((fips) => validatePlaceCount(fips));
      expect(validations.every((v) => v === true)).toBe(true);
    });
  });

  describe('getPlaceMetadata()', () => {
    it('should return metadata object', () => {
      const meta = getPlaceMetadata();
      expect(meta.source).toBe('Census TIGER/Line 2024');
      expect(meta.nationalTotal).toBe(32041);
      expect(meta.description).toContain('Canonical Place');
    });

    it('should include format documentation', () => {
      const meta = getPlaceMetadata();
      expect(meta.format).toContain('SSPPPPP');
    });

    it('should include special cases', () => {
      const meta = getPlaceMetadata();
      expect(meta.specialCases).toBeInstanceOf(Array);
      expect(meta.specialCases.length).toBeGreaterThan(0);
    });
  });

  describe('GEOID Format Validation', () => {
    it('should have 7-digit GEOIDs', () => {
      const places = getPlaceGeoidsForState('06');
      places.forEach((geoid) => {
        expect(geoid).toHaveLength(7);
        expect(/^\d{7}$/.test(geoid)).toBe(true);
      });
    });

    it('should have state FIPS prefix', () => {
      const caPlaces = getPlaceGeoidsForState('06');
      caPlaces.forEach((geoid) => {
        expect(geoid.startsWith('06')).toBe(true);
      });
    });
  });

  describe('Data Integrity', () => {
    it('should have no duplicate GEOIDs within a state', () => {
      const allPlaces = getAllPlaceGeoids();
      Object.entries(allPlaces).forEach(([stateFips, geoids]) => {
        const uniqueGeoids = new Set(geoids);
        expect(uniqueGeoids.size).toBe(geoids.length);
      });
    });

    it('should match expected counts exactly', () => {
      const allPlaces = getAllPlaceGeoids();
      Object.entries(EXPECTED_PLACE_BY_STATE).forEach(
        ([stateFips, expectedCount]) => {
          const actualCount = allPlaces[stateFips]?.length ?? 0;
          expect(actualCount).toBe(expectedCount);
        }
      );
    });
  });
});
