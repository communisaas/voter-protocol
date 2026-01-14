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
  CANONICAL_COUNTY_GEOIDS,
} from '../../../validators/geoid/reference.js';
import { EXPECTED_CD_BY_STATE, EXPECTED_COUNTIES_BY_STATE } from '../../../validators/tiger-expected-counts.js';

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

    it('should return canonical GEOIDs for county layer', () => {
      const geoids = getCanonicalGEOIDs('county', '01'); // Alabama
      expect(geoids).toBeDefined();
      expect(geoids?.length).toBe(67); // Alabama has 67 counties
    });

    it('should return place GEOIDs for supported states', () => {
      const geoids = getCanonicalGEOIDs('place', '01');
      expect(geoids).toBeDefined();
      expect(geoids!.length).toBeGreaterThan(0); // Alabama has multiple places
    });

    it('should return null for unsupported layer', () => {
      const geoids = getCanonicalGEOIDs('cdp', '01'); // CDP not yet supported
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

    it('should detect missing counties', () => {
      // Alabama has 67 counties - test with a subset
      const actualGEOIDs = ['01001', '01003', '01005']; // Missing 01007 and others

      const missing = getMissingGEOIDs('county', '01', actualGEOIDs);
      expect(missing.length).toBeGreaterThan(0);
      expect(missing).toContain('01007'); // Should contain missing county
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
      // CDP layer is not yet supported
      const result = validateGEOIDCompleteness('cdp', '01', ['0100100']);

      expect(result.valid).toBe(true);
      expect(result.expected).toBe(0);
    });

    it('should validate county GEOIDs correctly', () => {
      // Test with all Delaware counties (3 counties)
      const delawareCounties = ['10001', '10003', '10005'];
      const result = validateGEOIDCompleteness('county', '10', delawareCounties);

      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.extra).toEqual([]);
      expect(result.expected).toBe(3);
      expect(result.actual).toBe(3);
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

  describe('CANONICAL_COUNTY_GEOIDS', () => {
    it('should have entries for all 56 jurisdictions', () => {
      // 50 states + DC + 5 territories = 56 total
      const expectedJurisdictions = 56;
      expect(Object.keys(CANONICAL_COUNTY_GEOIDS).length).toBe(expectedJurisdictions);
    });

    it('should match expected counts from tiger-expected-counts', () => {
      for (const [stateFips, geoids] of Object.entries(CANONICAL_COUNTY_GEOIDS)) {
        const expectedCount = EXPECTED_COUNTIES_BY_STATE[stateFips];
        expect(geoids.length).toBe(expectedCount);
      }
    });

    it('should have correct GEOID format (5 digits SSCCC)', () => {
      for (const [stateFips, geoids] of Object.entries(CANONICAL_COUNTY_GEOIDS)) {
        for (const geoid of geoids) {
          expect(geoid).toMatch(/^\d{5}$/);
          // GEOID should start with state FIPS
          expect(geoid.startsWith(stateFips)).toBe(true);
        }
      }
    });

    it('should have Texas with 254 counties (most in US)', () => {
      const txGeoids = CANONICAL_COUNTY_GEOIDS['48'];
      expect(txGeoids.length).toBe(254);
    });

    it('should have Delaware with 3 counties (fewest of states)', () => {
      const deGeoids = CANONICAL_COUNTY_GEOIDS['10'];
      expect(deGeoids.length).toBe(3);
      expect(deGeoids).toEqual(['10001', '10003', '10005']);
    });

    it('should have DC with 1 county-equivalent', () => {
      const dcGeoids = CANONICAL_COUNTY_GEOIDS['11'];
      expect(dcGeoids.length).toBe(1);
      expect(dcGeoids[0]).toBe('11001');
    });

    it('should have Connecticut with 9 Planning Regions (2022 transition)', () => {
      // Connecticut dissolved its 8 counties in 2022 and replaced with 9 planning regions
      const ctGeoids = CANONICAL_COUNTY_GEOIDS['09'];
      expect(ctGeoids.length).toBe(9);
      // Planning region GEOIDs use 1XX format (110-190)
      expect(ctGeoids[0]).toBe('09110');
    });

    it('should have Louisiana with 64 parishes', () => {
      const laGeoids = CANONICAL_COUNTY_GEOIDS['22'];
      expect(laGeoids.length).toBe(64);
    });

    it('should have Alaska with 30 boroughs/census areas', () => {
      const akGeoids = CANONICAL_COUNTY_GEOIDS['02'];
      expect(akGeoids.length).toBe(30);
    });

    it('should have Virginia with 133 county-equivalents (95 counties + 38 independent cities)', () => {
      const vaGeoids = CANONICAL_COUNTY_GEOIDS['51'];
      expect(vaGeoids.length).toBe(133);
      // Independent cities have GEOID >= 510 (like 51510 for Alexandria)
      const independentCities = vaGeoids.filter((g: string) => g.slice(2) >= '500');
      expect(independentCities.length).toBeGreaterThan(30);
    });

    it('should include independent cities with 5XX county codes', () => {
      // Baltimore City (24510), St. Louis City (29510), Carson City (32510)
      expect(CANONICAL_COUNTY_GEOIDS['24']).toContain('24510'); // Baltimore City
      expect(CANONICAL_COUNTY_GEOIDS['29']).toContain('29510'); // St. Louis City
      expect(CANONICAL_COUNTY_GEOIDS['32']).toContain('32510'); // Carson City
    });

    it('should have Puerto Rico with 78 municipios', () => {
      const prGeoids = CANONICAL_COUNTY_GEOIDS['72'];
      expect(prGeoids.length).toBe(78);
    });

    it('should total 3235 county-equivalents', () => {
      let totalCounties = 0;
      for (const geoids of Object.values(CANONICAL_COUNTY_GEOIDS)) {
        totalCounties += geoids.length;
      }

      // 3235 = 3143 traditional + 92 new (CT Planning Regions transition + other adjustments)
      expect(totalCounties).toBe(3235);
    });

    it('should have no duplicate GEOIDs', () => {
      const allGEOIDs = new Set<string>();

      for (const geoids of Object.values(CANONICAL_COUNTY_GEOIDS)) {
        for (const geoid of geoids) {
          expect(allGEOIDs.has(geoid)).toBe(false);
          allGEOIDs.add(geoid);
        }
      }

      expect(allGEOIDs.size).toBe(3235);
    });

    it('should have sorted GEOIDs within each state', () => {
      for (const [stateFips, geoids] of Object.entries(CANONICAL_COUNTY_GEOIDS)) {
        const sorted = [...geoids].sort();
        expect(geoids).toEqual(sorted);
      }
    });
  });

  describe('County GEOID Helper Functions', () => {
    it('should get canonical county GEOIDs for a state', () => {
      const geoids = getCanonicalGEOIDs('county', '06'); // California
      expect(geoids).toBeDefined();
      expect(geoids?.length).toBe(58);
      expect(geoids).toContain('06037'); // Los Angeles County
    });

    it('should detect missing county GEOIDs', () => {
      // Hawaii has 5 counties
      const actualGEOIDs = ['15001', '15003', '15007', '15009']; // Missing 15005 (Kalawao)

      const missing = getMissingGEOIDs('county', '15', actualGEOIDs);
      expect(missing).toEqual(['15005']);
    });

    it('should detect extra county GEOIDs', () => {
      // Delaware has 3 counties
      const actualGEOIDs = ['10001', '10003', '10005', '10999']; // 10999 is invalid

      const extra = getExtraGEOIDs('county', '10', actualGEOIDs);
      expect(extra).toEqual(['10999']);
    });

    it('should validate complete county list', () => {
      // Rhode Island has 5 counties
      const riCounties = ['44001', '44003', '44005', '44007', '44009'];
      const result = validateGEOIDCompleteness('county', '44', riCounties);

      expect(result.valid).toBe(true);
      expect(result.expected).toBe(5);
      expect(result.actual).toBe(5);
    });
  });
});
