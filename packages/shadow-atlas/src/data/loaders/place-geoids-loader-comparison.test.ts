/**
 * Place GEOIDs JSON vs TypeScript Comparison Test
 *
 * CRITICAL: Validates JSON extraction produces IDENTICAL data to original TypeScript
 * This test ensures zero data loss during WS-A2 codebase surgery
 */

import { describe, it, expect } from 'vitest';

// Original TypeScript data
import {
  EXPECTED_PLACE_BY_STATE as TS_EXPECTED_COUNTS,
  NATIONAL_PLACE_TOTAL as TS_NATIONAL_TOTAL,
  CANONICAL_PLACE_GEOIDS as TS_CANONICAL_GEOIDS,
} from '../../validators/place-geoids';

// New JSON loader
import {
  EXPECTED_PLACE_BY_STATE as JSON_EXPECTED_COUNTS,
  NATIONAL_PLACE_TOTAL as JSON_NATIONAL_TOTAL,
  getAllPlaceGeoids as getJsonGeoids,
} from './place-geoids-loader';

describe('Place GEOIDs: JSON vs TypeScript Exact Match', () => {
  describe('National Total', () => {
    it('should match exactly', () => {
      expect(JSON_NATIONAL_TOTAL).toBe(TS_NATIONAL_TOTAL);
      expect(JSON_NATIONAL_TOTAL).toBe(32041);
    });
  });

  describe('Expected Counts by State', () => {
    it('should have same number of states', () => {
      const tsStates = Object.keys(TS_EXPECTED_COUNTS);
      const jsonStates = Object.keys(JSON_EXPECTED_COUNTS);
      expect(jsonStates).toHaveLength(tsStates.length);
      expect(jsonStates).toHaveLength(51); // 50 states + DC
    });

    it('should have identical state FIPS codes', () => {
      const tsStates = Object.keys(TS_EXPECTED_COUNTS).sort();
      const jsonStates = Object.keys(JSON_EXPECTED_COUNTS).sort();
      expect(jsonStates).toEqual(tsStates);
    });

    it('should have identical counts for each state', () => {
      const tsStates = Object.keys(TS_EXPECTED_COUNTS);
      tsStates.forEach((stateFips) => {
        expect(JSON_EXPECTED_COUNTS[stateFips]).toBe(
          TS_EXPECTED_COUNTS[stateFips]
        );
      });
    });
  });

  describe('Canonical Place GEOIDs', () => {
    const jsonGeoids = getJsonGeoids();

    it('should have same number of states', () => {
      const tsStates = Object.keys(TS_CANONICAL_GEOIDS);
      const jsonStates = Object.keys(jsonGeoids);
      expect(jsonStates).toHaveLength(tsStates.length);
    });

    it('should have identical state FIPS codes', () => {
      const tsStates = Object.keys(TS_CANONICAL_GEOIDS).sort();
      const jsonStates = Object.keys(jsonGeoids).sort();
      expect(jsonStates).toEqual(tsStates);
    });

    it('should have identical GEOID arrays for each state', () => {
      const tsStates = Object.keys(TS_CANONICAL_GEOIDS);
      tsStates.forEach((stateFips) => {
        const tsGeoids = TS_CANONICAL_GEOIDS[stateFips];
        const jsonGeoidsArr = jsonGeoids[stateFips];

        // Same length
        expect(jsonGeoidsArr).toHaveLength(tsGeoids.length);

        // Same GEOIDs in same order
        expect(jsonGeoidsArr).toEqual(tsGeoids);
      });
    });

    it('should have zero data loss (complete GEOID match)', () => {
      const tsStates = Object.keys(TS_CANONICAL_GEOIDS);
      let totalMismatches = 0;

      tsStates.forEach((stateFips) => {
        const tsGeoids = new Set(TS_CANONICAL_GEOIDS[stateFips]);
        const jsonGeoidsArr = new Set(jsonGeoids[stateFips]);

        // Check for missing GEOIDs
        tsGeoids.forEach((geoid) => {
          if (!jsonGeoidsArr.has(geoid)) {
            totalMismatches++;
            console.error(
              `MISSING GEOID in JSON for state ${stateFips}: ${geoid}`
            );
          }
        });

        // Check for extra GEOIDs
        jsonGeoidsArr.forEach((geoid) => {
          if (!tsGeoids.has(geoid)) {
            totalMismatches++;
            console.error(
              `EXTRA GEOID in JSON for state ${stateFips}: ${geoid}`
            );
          }
        });
      });

      expect(totalMismatches).toBe(0);
    });
  });

  describe('Total GEOID Count Validation', () => {
    it('should sum to national total (TypeScript)', () => {
      const tsTotal = Object.values(TS_CANONICAL_GEOIDS).reduce(
        (sum, arr) => sum + arr.length,
        0
      );
      expect(tsTotal).toBe(TS_NATIONAL_TOTAL);
    });

    it('should sum to national total (JSON)', () => {
      const jsonGeoids = getJsonGeoids();
      const jsonTotal = Object.values(jsonGeoids).reduce(
        (sum, arr) => sum + arr.length,
        0
      );
      expect(jsonTotal).toBe(JSON_NATIONAL_TOTAL);
    });

    it('should have matching totals (TypeScript vs JSON)', () => {
      const tsTotal = Object.values(TS_CANONICAL_GEOIDS).reduce(
        (sum, arr) => sum + arr.length,
        0
      );
      const jsonGeoids = getJsonGeoids();
      const jsonTotal = Object.values(jsonGeoids).reduce(
        (sum, arr) => sum + arr.length,
        0
      );
      expect(jsonTotal).toBe(tsTotal);
      expect(jsonTotal).toBe(32041);
    });
  });

  describe('Sample State Deep Validation', () => {
    it('California (06) - exact match', () => {
      const tsCA = TS_CANONICAL_GEOIDS['06'];
      const jsonCA = getJsonGeoids()['06'];

      expect(jsonCA).toHaveLength(1618);
      expect(jsonCA).toEqual(tsCA);
      expect(jsonCA).toContain('0644000'); // Los Angeles
    });

    it('New York (36) - exact match', () => {
      const tsNY = TS_CANONICAL_GEOIDS['36'];
      const jsonNY = getJsonGeoids()['36'];

      expect(jsonNY).toHaveLength(1293);
      expect(jsonNY).toEqual(tsNY);
      expect(jsonNY).toContain('3651000'); // New York City
    });

    it('DC (11) - exact match', () => {
      const tsDC = TS_CANONICAL_GEOIDS['11'];
      const jsonDC = getJsonGeoids()['11'];

      expect(jsonDC).toHaveLength(1);
      expect(jsonDC).toEqual(tsDC);
    });

    it('Wyoming (56) - smallest state exact match', () => {
      const tsWY = TS_CANONICAL_GEOIDS['56'];
      const jsonWY = getJsonGeoids()['56'];

      expect(jsonWY).toHaveLength(205);
      expect(jsonWY).toEqual(tsWY);
    });

    it('Pennsylvania (42) - largest state exact match', () => {
      const tsPA = TS_CANONICAL_GEOIDS['42'];
      const jsonPA = getJsonGeoids()['42'];

      expect(jsonPA).toHaveLength(2002);
      expect(jsonPA).toEqual(tsPA);
    });
  });
});
