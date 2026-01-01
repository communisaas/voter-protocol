/**
 * GEOID Reference List Tests
 *
 * Validates canonical GEOID lists for Congressional Districts.
 * Ensures data integrity and correctness of reference data.
 */

import { describe, it, expect } from 'vitest';
import {
  getCanonicalGEOIDs,
  getMissingGEOIDs,
  getExtraGEOIDs,
  validateGEOIDCompleteness,
  CANONICAL_CD_GEOIDS,
} from '../../../validators/geoid-reference.js';
import { EXPECTED_CD_BY_STATE } from '../../../validators/tiger-expected-counts.js';

describe('GEOID Reference Lists', () => {
  describe('CANONICAL_CD_GEOIDS', () => {
    it('should have entries for all 56 jurisdictions', () => {
      // 50 states + DC + 5 territories = 56 total
      const expectedJurisdictions = 56;
      expect(Object.keys(CANONICAL_CD_GEOIDS).length).toBe(expectedJurisdictions);
    });

    it('should match expected counts from tiger-expected-counts', () => {
      for (const [stateFips, geoids] of Object.entries(CANONICAL_CD_GEOIDS)) {
        const expectedCount = EXPECTED_CD_BY_STATE[stateFips];
        expect(geoids.length).toBe(expectedCount);
      }
    });

    it('should have correct GEOID format (4 digits)', () => {
      for (const [stateFips, geoids] of Object.entries(CANONICAL_CD_GEOIDS)) {
        for (const geoid of geoids) {
          expect(geoid).toMatch(/^\d{4}$/);
          // GEOID should start with state FIPS
          expect(geoid.startsWith(stateFips)).toBe(true);
        }
      }
    });

    it('should have at-large districts for single-district states', () => {
      // Alaska (02), Delaware (10), ND (38), SD (46), VT (50), WY (56)
      const atLargeStates = ['02', '10', '38', '46', '50', '56'];

      for (const stateFips of atLargeStates) {
        const geoids = CANONICAL_CD_GEOIDS[stateFips];
        expect(geoids.length).toBe(1);
        expect(geoids[0]).toBe(`${stateFips}00`);
      }
    });

    it('should have DC with district 98 (non-voting delegate)', () => {
      const dcGeoids = CANONICAL_CD_GEOIDS['11'];
      expect(dcGeoids.length).toBe(1);
      expect(dcGeoids[0]).toBe('1198');
    });

    it('should have California with 52 districts (largest delegation)', () => {
      const caGeoids = CANONICAL_CD_GEOIDS['06'];
      expect(caGeoids.length).toBe(52);

      // Verify sequential numbering from 01 to 52
      for (let i = 1; i <= 52; i++) {
        const expectedGeoid = `06${i.toString().padStart(2, '0')}`;
        expect(caGeoids).toContain(expectedGeoid);
      }
    });

    it('should have Texas with 38 districts (second largest)', () => {
      const txGeoids = CANONICAL_CD_GEOIDS['48'];
      expect(txGeoids.length).toBe(38);

      // Verify sequential numbering from 01 to 38
      for (let i = 1; i <= 38; i++) {
        const expectedGeoid = `48${i.toString().padStart(2, '0')}`;
        expect(txGeoids).toContain(expectedGeoid);
      }
    });

    it('should have territories with district 00 (delegates)', () => {
      // American Samoa (60), Guam (66), NMI (69), PR (72), VI (78)
      const territories = ['60', '66', '69', '72', '78'];

      for (const territoryFips of territories) {
        const geoids = CANONICAL_CD_GEOIDS[territoryFips];
        expect(geoids.length).toBe(1);
        expect(geoids[0]).toBe(`${territoryFips}00`);
      }
    });

    it('should total 441 districts (435 voting + 6 non-voting)', () => {
      let totalDistricts = 0;
      for (const geoids of Object.values(CANONICAL_CD_GEOIDS)) {
        totalDistricts += geoids.length;
      }

      // 435 voting representatives + 6 non-voting delegates (DC + 5 territories)
      expect(totalDistricts).toBe(441);
    });

    it('should have no duplicate GEOIDs', () => {
      const allGEOIDs = new Set<string>();

      for (const geoids of Object.values(CANONICAL_CD_GEOIDS)) {
        for (const geoid of geoids) {
          expect(allGEOIDs.has(geoid)).toBe(false);
          allGEOIDs.add(geoid);
        }
      }

      expect(allGEOIDs.size).toBe(441);
    });
  });

  describe('getCanonicalGEOIDs', () => {
    it('should return canonical GEOIDs for valid layer and state', () => {
      const geoids = getCanonicalGEOIDs('cd', '01'); // Alabama
      expect(geoids).toBeDefined();
      expect(geoids?.length).toBe(7);
    });

    it('should return null for unsupported layer', () => {
      const geoids = getCanonicalGEOIDs('county', '01');
      expect(geoids).toBeNull();
    });

    it('should return null for invalid state FIPS', () => {
      const geoids = getCanonicalGEOIDs('cd', '99');
      expect(geoids).toBeNull();
    });

    it('should return readonly arrays (TypeScript enforced)', () => {
      const geoids = getCanonicalGEOIDs('cd', '01');
      expect(geoids).toBeDefined();

      // TypeScript enforces readonly at compile time via 'readonly' type
      // Runtime: arrays are not frozen (const assertion makes them immutable in TS)
      // This is intentional - runtime freezing has performance cost
      expect(Array.isArray(geoids)).toBe(true);
    });
  });

  describe('getMissingGEOIDs', () => {
    it('should detect missing districts', () => {
      // Alabama has 7 districts (0101-0107)
      // Simulate missing district 0107
      const actualGEOIDs = ['0101', '0102', '0103', '0104', '0105', '0106'];

      const missing = getMissingGEOIDs('cd', '01', actualGEOIDs);
      expect(missing).toEqual(['0107']);
    });

    it('should return empty array when all districts present', () => {
      const actualGEOIDs = ['0101', '0102', '0103', '0104', '0105', '0106', '0107'];

      const missing = getMissingGEOIDs('cd', '01', actualGEOIDs);
      expect(missing).toEqual([]);
    });

    it('should handle multiple missing districts', () => {
      // Simulate missing 0103 and 0107
      const actualGEOIDs = ['0101', '0102', '0104', '0105', '0106'];

      const missing = getMissingGEOIDs('cd', '01', actualGEOIDs);
      expect(missing).toContain('0103');
      expect(missing).toContain('0107');
      expect(missing.length).toBe(2);
    });

    it('should return empty array for unsupported layer', () => {
      const missing = getMissingGEOIDs('county', '01', ['01001']);
      expect(missing).toEqual([]);
    });
  });

  describe('getExtraGEOIDs', () => {
    it('should detect extra districts (placeholders)', () => {
      // Alabama has 7 districts (0101-0107)
      // Simulate extra placeholder district 01ZZ
      const actualGEOIDs = ['0101', '0102', '0103', '0104', '0105', '0106', '0107', '01ZZ'];

      const extra = getExtraGEOIDs('cd', '01', actualGEOIDs);
      expect(extra).toEqual(['01ZZ']);
    });

    it('should not detect duplicates (use Set for deduplication)', () => {
      // Simulate duplicate 0107 in data
      // getExtraGEOIDs uses Set internally, so duplicates are automatically filtered
      const actualGEOIDs = ['0101', '0102', '0103', '0104', '0105', '0106', '0107', '0107'];

      const extra = getExtraGEOIDs('cd', '01', actualGEOIDs);
      // Duplicates are deduplicated by Set, so no extras detected
      // For duplicate detection, compare actualGEOIDs.length vs unique count
      expect(extra).toEqual([]);
      expect(new Set(actualGEOIDs).size).toBeLessThan(actualGEOIDs.length); // Has duplicates
    });

    it('should return empty array when no extra districts', () => {
      const actualGEOIDs = ['0101', '0102', '0103', '0104', '0105', '0106', '0107'];

      const extra = getExtraGEOIDs('cd', '01', actualGEOIDs);
      expect(extra).toEqual([]);
    });

    it('should handle multiple extra districts', () => {
      const actualGEOIDs = ['0101', '0102', '0103', '0104', '0105', '0106', '0107', '0199', '01ZZ'];

      const extra = getExtraGEOIDs('cd', '01', actualGEOIDs);
      expect(extra).toContain('0199');
      expect(extra).toContain('01ZZ');
      expect(extra.length).toBe(2);
    });
  });

  describe('validateGEOIDCompleteness', () => {
    it('should pass validation when data matches canonical list', () => {
      const actualGEOIDs = ['0101', '0102', '0103', '0104', '0105', '0106', '0107'];

      const result = validateGEOIDCompleteness('cd', '01', actualGEOIDs);

      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.extra).toEqual([]);
      expect(result.expected).toBe(7);
      expect(result.actual).toBe(7);
    });

    it('should fail validation when districts missing', () => {
      const actualGEOIDs = ['0101', '0102', '0103', '0104', '0105', '0106'];

      const result = validateGEOIDCompleteness('cd', '01', actualGEOIDs);

      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['0107']);
      expect(result.expected).toBe(7);
      expect(result.actual).toBe(6);
    });

    it('should fail validation when extra districts present', () => {
      const actualGEOIDs = ['0101', '0102', '0103', '0104', '0105', '0106', '0107', '01ZZ'];

      const result = validateGEOIDCompleteness('cd', '01', actualGEOIDs);

      expect(result.valid).toBe(false);
      expect(result.extra).toEqual(['01ZZ']);
      expect(result.expected).toBe(7);
      expect(result.actual).toBe(8);
    });

    it('should handle both missing and extra districts', () => {
      // Missing 0107, has extra 01ZZ
      const actualGEOIDs = ['0101', '0102', '0103', '0104', '0105', '0106', '01ZZ'];

      const result = validateGEOIDCompleteness('cd', '01', actualGEOIDs);

      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['0107']);
      expect(result.extra).toEqual(['01ZZ']);
      expect(result.expected).toBe(7);
      expect(result.actual).toBe(7); // Count matches but GEOIDs don't
    });

    it('should return valid for unsupported layers (no canonical data)', () => {
      const result = validateGEOIDCompleteness('county', '01', ['01001']);

      expect(result.valid).toBe(true);
      expect(result.expected).toBe(0);
    });
  });

  describe('Integration: TIGERValidator usage', () => {
    it('should provide actionable error messages', () => {
      // Simulate missing Alabama CD-07
      const actualGEOIDs = ['0101', '0102', '0103', '0104', '0105', '0106'];

      const result = validateGEOIDCompleteness('cd', '01', actualGEOIDs);

      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['0107']);

      // Error message should be specific and actionable
      const errorMessage = `Missing GEOIDs: ${result.missing.join(', ')}`;
      expect(errorMessage).toBe('Missing GEOIDs: 0107');
    });

    it('should handle placeholder filtering scenario', () => {
      // Alaska at-large state may have both 0200 and 02ZZ in TIGER data
      const actualGEOIDs = ['0200', '02ZZ'];

      const result = validateGEOIDCompleteness('cd', '02', actualGEOIDs);

      expect(result.valid).toBe(false);
      expect(result.extra).toContain('02ZZ');
      expect(result.expected).toBe(1);
      expect(result.actual).toBe(2);
    });
  });
});
