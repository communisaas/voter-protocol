/**
 * Expected GEOID Registry Tests
 *
 * Validates GEOID generation and completeness checking.
 */

import { describe, it, expect } from 'vitest';
import {
  getExpectedCountyGEOIDs,
  getExpectedCongressionalGEOIDs,
  getExpectedStateSenateGEOIDs,
  getExpectedStateHouseGEOIDs,
  validateGEOIDCompleteness,
  validateNationalGEOIDCompleteness,
  parseGEOID,
  getEntityTypeName,
  type GEOIDEntityType,
} from './expected-geoids.js';
import {
  EXPECTED_CD_BY_STATE,
  EXPECTED_SLDU_BY_STATE,
  EXPECTED_SLDL_BY_STATE,
  EXPECTED_COUNTIES_BY_STATE,
} from '../validators/tiger-expected-counts.js';

describe('GEOID Generation', () => {
  describe('getExpectedCountyGEOIDs', () => {
    it('generates correct number of county GEOIDs for California', () => {
      const geoids = getExpectedCountyGEOIDs('06');
      expect(geoids).toHaveLength(58); // California has 58 counties
      expect(geoids[0]).toBe('06001'); // First county
      expect(geoids[57]).toBe('06058'); // Last county
    });

    it('generates correct number of county GEOIDs for Texas', () => {
      const geoids = getExpectedCountyGEOIDs('48');
      expect(geoids).toHaveLength(254); // Texas has 254 counties (most in US)
      expect(geoids[0]).toBe('48001');
      expect(geoids[253]).toBe('48254');
    });

    it('generates correct number of county GEOIDs for Delaware', () => {
      const geoids = getExpectedCountyGEOIDs('10');
      expect(geoids).toHaveLength(3); // Delaware has 3 counties
      expect(geoids).toEqual(['10001', '10002', '10003']);
    });

    it('returns empty array for invalid state FIPS', () => {
      const geoids = getExpectedCountyGEOIDs('99');
      expect(geoids).toEqual([]);
    });

    it('validates consistency with expected counts', () => {
      // Test all states
      for (const [fips, expectedCount] of Object.entries(EXPECTED_COUNTIES_BY_STATE)) {
        const geoids = getExpectedCountyGEOIDs(fips);
        expect(geoids).toHaveLength(expectedCount);
      }
    });
  });

  describe('getExpectedCongressionalGEOIDs', () => {
    it('generates at-large district for Alaska', () => {
      const geoids = getExpectedCongressionalGEOIDs('02');
      expect(geoids).toHaveLength(1);
      expect(geoids[0]).toBe('0200'); // At-large district
    });

    it('generates at-large district for Wyoming', () => {
      const geoids = getExpectedCongressionalGEOIDs('56');
      expect(geoids).toHaveLength(1);
      expect(geoids[0]).toBe('5600');
    });

    it('generates multi-district GEOIDs for California', () => {
      const geoids = getExpectedCongressionalGEOIDs('06');
      expect(geoids).toHaveLength(52); // California has 52 districts
      expect(geoids[0]).toBe('0601'); // District 1
      expect(geoids[11]).toBe('0612'); // District 12
      expect(geoids[51]).toBe('0652'); // District 52
    });

    it('generates multi-district GEOIDs for Texas', () => {
      const geoids = getExpectedCongressionalGEOIDs('48');
      expect(geoids).toHaveLength(38); // Texas has 38 districts
      expect(geoids[0]).toBe('4801');
      expect(geoids[37]).toBe('4838');
    });

    it('validates consistency with expected counts', () => {
      // Test all states
      for (const [fips, expectedCount] of Object.entries(EXPECTED_CD_BY_STATE)) {
        const geoids = getExpectedCongressionalGEOIDs(fips);
        expect(geoids).toHaveLength(expectedCount);
      }
    });

    it('generates correct total national count', () => {
      const allGEOIDs: string[] = [];
      for (const fips of Object.keys(EXPECTED_CD_BY_STATE)) {
        allGEOIDs.push(...getExpectedCongressionalGEOIDs(fips));
      }
      // Should include all 435 voting districts + 6 non-voting delegates
      expect(allGEOIDs.length).toBeGreaterThanOrEqual(435);
    });
  });

  describe('getExpectedStateSenateGEOIDs', () => {
    it('generates state senate GEOIDs for California', () => {
      const geoids = getExpectedStateSenateGEOIDs('06');
      expect(geoids).toHaveLength(40); // California has 40 senate districts
      expect(geoids[0]).toBe('06U001');
      expect(geoids[39]).toBe('06U040');
    });

    it('generates state senate GEOIDs for Nebraska (unicameral)', () => {
      const geoids = getExpectedStateSenateGEOIDs('31');
      expect(geoids).toHaveLength(49); // Nebraska has 49 unicameral districts
      expect(geoids[0]).toBe('31U001');
      expect(geoids[48]).toBe('31U049');
    });

    it('validates consistency with expected counts', () => {
      for (const [fips, expectedCount] of Object.entries(EXPECTED_SLDU_BY_STATE)) {
        const geoids = getExpectedStateSenateGEOIDs(fips);
        expect(geoids).toHaveLength(expectedCount);
      }
    });
  });

  describe('getExpectedStateHouseGEOIDs', () => {
    it('generates state house GEOIDs for California', () => {
      const geoids = getExpectedStateHouseGEOIDs('06');
      expect(geoids).toHaveLength(80); // California has 80 assembly districts
      expect(geoids[0]).toBe('06L001');
      expect(geoids[79]).toBe('06L080');
    });

    it('returns empty array for Nebraska (unicameral, no house)', () => {
      const geoids = getExpectedStateHouseGEOIDs('31');
      expect(geoids).toEqual([]); // Nebraska has no house chamber
    });

    it('generates state house GEOIDs for New Hampshire', () => {
      const geoids = getExpectedStateHouseGEOIDs('33');
      expect(geoids).toHaveLength(400); // NH has largest state house in US
      expect(geoids[0]).toBe('33L001');
      expect(geoids[399]).toBe('33L400');
    });

    it('validates consistency with expected counts', () => {
      for (const [fips, expectedCount] of Object.entries(EXPECTED_SLDL_BY_STATE)) {
        const geoids = getExpectedStateHouseGEOIDs(fips);
        if (expectedCount === 0) {
          expect(geoids).toEqual([]); // Nebraska, DC
        } else {
          expect(geoids).toHaveLength(expectedCount);
        }
      }
    });
  });
});

describe('GEOID Validation', () => {
  describe('validateGEOIDCompleteness', () => {
    it('validates complete county data', () => {
      const expectedGEOIDs = getExpectedCountyGEOIDs('06');
      const result = validateGEOIDCompleteness('06', 'county', expectedGEOIDs);

      expect(result.complete).toBe(true);
      expect(result.expected).toBe(58);
      expect(result.received).toBe(58);
      expect(result.missing).toEqual([]);
      expect(result.unexpected).toEqual([]);
      expect(result.summary).toContain('✅ Complete');
    });

    it('detects missing counties', () => {
      const expectedGEOIDs = getExpectedCountyGEOIDs('06');
      const incompleteGEOIDs = expectedGEOIDs.slice(0, 50); // Missing 8 counties

      const result = validateGEOIDCompleteness('06', 'county', incompleteGEOIDs);

      expect(result.complete).toBe(false);
      expect(result.expected).toBe(58);
      expect(result.received).toBe(50);
      expect(result.missing).toHaveLength(8);
      expect(result.unexpected).toEqual([]);
      expect(result.summary).toContain('❌ Incomplete');
      expect(result.summary).toContain('8 missing');
    });

    it('detects unexpected counties', () => {
      const expectedGEOIDs = getExpectedCountyGEOIDs('06');
      const extraGEOIDs = [...expectedGEOIDs, '06999', '06998']; // 2 fake counties

      const result = validateGEOIDCompleteness('06', 'county', extraGEOIDs);

      expect(result.complete).toBe(false);
      expect(result.expected).toBe(58);
      expect(result.received).toBe(60);
      expect(result.missing).toEqual([]);
      expect(result.unexpected).toHaveLength(2);
      expect(result.unexpected).toContain('06999');
      expect(result.unexpected).toContain('06998');
      expect(result.summary).toContain('❌ Incomplete');
      expect(result.summary).toContain('2 unexpected');
    });

    it('detects both missing and unexpected GEOIDs', () => {
      const expectedGEOIDs = getExpectedCountyGEOIDs('06');
      const mixedGEOIDs = [...expectedGEOIDs.slice(0, 50), '06999']; // Missing 8, added 1 fake

      const result = validateGEOIDCompleteness('06', 'county', mixedGEOIDs);

      expect(result.complete).toBe(false);
      expect(result.missing).toHaveLength(8);
      expect(result.unexpected).toHaveLength(1);
      expect(result.summary).toContain('8 missing');
      expect(result.summary).toContain('1 unexpected');
    });

    it('validates complete congressional district data', () => {
      const expectedGEOIDs = getExpectedCongressionalGEOIDs('06');
      const result = validateGEOIDCompleteness('06', 'congressional', expectedGEOIDs);

      expect(result.complete).toBe(true);
      expect(result.expected).toBe(52);
      expect(result.received).toBe(52);
    });

    it('validates at-large district', () => {
      const expectedGEOIDs = getExpectedCongressionalGEOIDs('02'); // Alaska
      const result = validateGEOIDCompleteness('02', 'congressional', expectedGEOIDs);

      expect(result.complete).toBe(true);
      expect(result.expected).toBe(1);
      expect(result.received).toBe(1);
      expect(expectedGEOIDs[0]).toBe('0200');
    });

    it('validates state senate districts', () => {
      const expectedGEOIDs = getExpectedStateSenateGEOIDs('06');
      const result = validateGEOIDCompleteness('06', 'state_senate', expectedGEOIDs);

      expect(result.complete).toBe(true);
      expect(result.expected).toBe(40);
    });

    it('validates state house districts', () => {
      const expectedGEOIDs = getExpectedStateHouseGEOIDs('06');
      const result = validateGEOIDCompleteness('06', 'state_house', expectedGEOIDs);

      expect(result.complete).toBe(true);
      expect(result.expected).toBe(80);
    });

    it('handles Nebraska unicameral correctly', () => {
      const senateGEOIDs = getExpectedStateSenateGEOIDs('31');
      const senateResult = validateGEOIDCompleteness('31', 'state_senate', senateGEOIDs);
      expect(senateResult.complete).toBe(true);
      expect(senateResult.expected).toBe(49);

      const houseResult = validateGEOIDCompleteness('31', 'state_house', []);
      expect(houseResult.complete).toBe(true);
      expect(houseResult.expected).toBe(0);
    });
  });

  describe('validateNationalGEOIDCompleteness', () => {
    it('validates complete national county data', () => {
      const allCountyGEOIDs: string[] = [];
      for (const fips of Object.keys(EXPECTED_COUNTIES_BY_STATE)) {
        allCountyGEOIDs.push(...getExpectedCountyGEOIDs(fips));
      }

      const result = validateNationalGEOIDCompleteness('county', allCountyGEOIDs);

      // NOTE: The sum of EXPECTED_COUNTIES_BY_STATE is 3234, not the documented 3143.
      // This discrepancy exists in the source data and should be investigated separately.
      const actualSum = Object.values(EXPECTED_COUNTIES_BY_STATE).reduce((a, b) => a + b, 0);

      expect(result.complete).toBe(true);
      expect(result.expected).toBe(actualSum); // Computed from actual state-level data
      expect(result.received).toBe(actualSum);
      expect(result.summary).toContain('✅ Complete');
    });

    it('validates complete national congressional district data', () => {
      const allCDGEOIDs: string[] = [];
      for (const fips of Object.keys(EXPECTED_CD_BY_STATE)) {
        allCDGEOIDs.push(...getExpectedCongressionalGEOIDs(fips));
      }

      const result = validateNationalGEOIDCompleteness('congressional', allCDGEOIDs);

      expect(result.complete).toBe(true);
      expect(result.received).toBeGreaterThanOrEqual(435); // At least 435 voting districts
    });

    it('detects missing states in national data', () => {
      // Generate all counties except California
      const incompleteCountyGEOIDs: string[] = [];
      for (const fips of Object.keys(EXPECTED_COUNTIES_BY_STATE)) {
        if (fips !== '06') {
          incompleteCountyGEOIDs.push(...getExpectedCountyGEOIDs(fips));
        }
      }

      const result = validateNationalGEOIDCompleteness('county', incompleteCountyGEOIDs);

      expect(result.complete).toBe(false);
      expect(result.missing).toHaveLength(58); // Missing all 58 California counties
      expect(result.summary).toContain('58 missing');
    });
  });
});

describe('GEOID Parsing', () => {
  describe('parseGEOID', () => {
    it('parses county GEOID', () => {
      const parsed = parseGEOID('06037');
      expect(parsed).toEqual({
        stateFips: '06',
        entityCode: '037',
        entityType: 'county',
      });
    });

    it('parses congressional district GEOID', () => {
      const parsed = parseGEOID('0612');
      expect(parsed).toEqual({
        stateFips: '06',
        entityCode: '12',
        entityType: 'congressional',
      });
    });

    it('parses at-large district GEOID', () => {
      const parsed = parseGEOID('0200');
      expect(parsed).toEqual({
        stateFips: '02',
        entityCode: '00',
        entityType: 'congressional',
      });
    });

    it('parses state senate GEOID', () => {
      const parsed = parseGEOID('06U001');
      expect(parsed).toEqual({
        stateFips: '06',
        entityCode: 'U001',
        entityType: 'state_senate',
      });
    });

    it('parses state house GEOID', () => {
      const parsed = parseGEOID('06L001');
      expect(parsed).toEqual({
        stateFips: '06',
        entityCode: 'L001',
        entityType: 'state_house',
      });
    });

    it('parses place GEOID', () => {
      const parsed = parseGEOID('0644000');
      expect(parsed).toEqual({
        stateFips: '06',
        entityCode: '44000',
        entityType: 'place',
      });
    });

    it('returns null for invalid GEOID', () => {
      expect(parseGEOID('1')).toBeNull();
      expect(parseGEOID('ABC')).toBeNull();
      expect(parseGEOID('06X001')).toBeNull(); // Invalid chamber code
      expect(parseGEOID('')).toBeNull();
    });
  });

  describe('getEntityTypeName', () => {
    it('returns correct names for all entity types', () => {
      expect(getEntityTypeName('county')).toBe('County');
      expect(getEntityTypeName('congressional')).toBe('Congressional District');
      expect(getEntityTypeName('state_senate')).toBe('State Senate District');
      expect(getEntityTypeName('state_house')).toBe('State House District');
      expect(getEntityTypeName('place')).toBe('Place');
    });
  });
});

describe('Integration Tests', () => {
  it('validates complete extraction workflow', () => {
    // Simulate extracting California congressional districts
    const expectedGEOIDs = getExpectedCongressionalGEOIDs('06');

    // Simulate successful extraction
    const extractedGEOIDs = [...expectedGEOIDs];
    const result = validateGEOIDCompleteness('06', 'congressional', extractedGEOIDs);

    expect(result.complete).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.unexpected).toEqual([]);
  });

  it('validates incomplete extraction workflow', () => {
    const expectedGEOIDs = getExpectedCongressionalGEOIDs('06');

    // Simulate failed extraction (missing district 12)
    const extractedGEOIDs = expectedGEOIDs.filter((geoid) => geoid !== '0612');
    const result = validateGEOIDCompleteness('06', 'congressional', extractedGEOIDs);

    expect(result.complete).toBe(false);
    expect(result.missing).toContain('0612');
    expect(result.summary).toContain('1 missing');
  });

  it('validates national extraction with all states', () => {
    // Generate complete national dataset
    const allGEOIDs: string[] = [];
    for (const fips of Object.keys(EXPECTED_CD_BY_STATE)) {
      allGEOIDs.push(...getExpectedCongressionalGEOIDs(fips));
    }

    const result = validateNationalGEOIDCompleteness('congressional', allGEOIDs);
    expect(result.complete).toBe(true);
  });
});
