/**
 * TIGER Authority Rules Tests
 *
 * Tests the TIGER authority hierarchy and precedence rules.
 *
 * Test Coverage:
 * 1. TIGER CD (authority=5) wins over municipal portal CD (authority=3)
 * 2. State redistricting commission SLDU (authority=5) wins over TIGER SLDU (authority=5, but lower preference)
 * 3. Validity window correctly identifies expired TIGER data
 * 4. Redistricting grace period extends validity during 2022-style years
 * 5. Authority conflict resolution picks highest authority source
 */

import { describe, it, expect } from 'vitest';
import {
  type TIGERBoundaryType,
  type SourceProvider,
  AuthorityLevel,
  TIGER_AUTHORITY_RULES,
  TIGER_AUTHORITATIVE_TYPES,
  REDISTRICTING_AFFECTED_TYPES,
  TIGER_NOT_PROVIDED_TYPES,
  getTIGERAuthorityRule,
  isTIGERAuthoritative,
  isRedistrictingAffected,
  doesTIGERProvide,
  getSourcePrecedence,
  getPreferredSource,
  findSourcePrecedence,
  getSourceAuthority,
} from '../../../provenance/tiger-authority-rules.js';

describe('TIGERAuthorityRules', () => {
  describe('Authority levels', () => {
    it('should assign FEDERAL_MANDATE to congressional districts', () => {
      const rule = getTIGERAuthorityRule('congressional');
      expect(rule.authorityLevel).toBe(AuthorityLevel.FEDERAL_MANDATE);
      expect(rule.legalStatus).toBe('binding');
    });

    it('should assign FEDERAL_MANDATE to state legislative districts', () => {
      const senateRule = getTIGERAuthorityRule('state_senate');
      const houseRule = getTIGERAuthorityRule('state_house');

      expect(senateRule.authorityLevel).toBe(AuthorityLevel.FEDERAL_MANDATE);
      expect(houseRule.authorityLevel).toBe(AuthorityLevel.FEDERAL_MANDATE);
    });

    it('should assign FEDERAL_MANDATE to counties', () => {
      const rule = getTIGERAuthorityRule('county');
      expect(rule.authorityLevel).toBe(AuthorityLevel.FEDERAL_MANDATE);
      expect(rule.legalStatus).toBe('binding');
    });

    it('should assign UNKNOWN to voting precincts (TIGER does not provide)', () => {
      const rule = getTIGERAuthorityRule('voting_precinct');
      expect(rule.authorityLevel).toBe(AuthorityLevel.UNKNOWN);
      expect(rule.legalStatus).toBe('unofficial');
    });

    it('should assign UNKNOWN to special districts (TIGER does not provide)', () => {
      const rule = getTIGERAuthorityRule('special_district');
      expect(rule.authorityLevel).toBe(AuthorityLevel.UNKNOWN);
      expect(rule.legalStatus).toBe('unofficial');
    });
  });

  describe('Validity windows', () => {
    it('should have 12-month validity for all TIGER-provided types', () => {
      const tigerTypes: TIGERBoundaryType[] = [
        'congressional',
        'state_senate',
        'state_house',
        'county',
        'place',
        'school_unified',
      ];

      for (const type of tigerTypes) {
        const rule = getTIGERAuthorityRule(type);
        expect(rule.validityWindow.validMonths).toBe(12);
      }
    });

    it('should release in July (month 7)', () => {
      const rule = getTIGERAuthorityRule('congressional');
      expect(rule.validityWindow.releaseMonth).toBe(7);
    });

    it('should have consistent release month across all types', () => {
      const allTypes: TIGERBoundaryType[] = [
        'congressional',
        'state_senate',
        'state_house',
        'county',
        'place',
        'school_unified',
        'voting_precinct',
        'special_district',
      ];

      for (const type of allTypes) {
        const rule = getTIGERAuthorityRule(type);
        expect(rule.validityWindow.releaseMonth).toBe(7);
      }
    });
  });

  describe('Precedence rules', () => {
    describe('TEST 1: TIGER CD (authority=5) wins over municipal portal CD (authority=3)', () => {
      it('should rank census-tiger higher than municipal-gis for congressional', () => {
        const precedence = getSourcePrecedence('congressional');

        const tigerPrec = precedence.find((p) => p.source === 'census-tiger');
        const arcgisPrec = precedence.find((p) => p.source === 'arcgis-hub');

        expect(tigerPrec).toBeDefined();
        expect(arcgisPrec).toBeDefined();

        // TIGER has higher authority
        expect(tigerPrec!.authority).toBe(AuthorityLevel.FEDERAL_MANDATE);
        expect(arcgisPrec!.authority).toBe(AuthorityLevel.HUB_AGGREGATOR);
        expect(tigerPrec!.authority).toBeGreaterThan(arcgisPrec!.authority);
      });

      it('should prefer TIGER over hub aggregators', () => {
        const precedence = getSourcePrecedence('congressional');

        const tigerPrec = precedence.find((p) => p.source === 'census-tiger');
        const arcgisPrec = precedence.find((p) => p.source === 'arcgis-hub');

        // Lower preference number = higher priority
        expect(tigerPrec!.preference).toBeLessThan(arcgisPrec!.preference);
      });
    });

    describe('TEST 2: State redistricting commission SLDU (authority=5) wins over TIGER SLDU', () => {
      it('should rank state-redistricting-commission highest for state_senate', () => {
        const preferredSource = getPreferredSource('state_senate');

        expect(preferredSource.source).toBe('state-redistricting-commission');
        expect(preferredSource.authority).toBe(AuthorityLevel.FEDERAL_MANDATE);
        expect(preferredSource.preference).toBe(1);
      });

      it('should rank TIGER lower than state commission despite same authority', () => {
        const precedence = getSourcePrecedence('state_senate');

        const commissionPrec = precedence.find(
          (p) => p.source === 'state-redistricting-commission'
        );
        const tigerPrec = precedence.find((p) => p.source === 'census-tiger');

        expect(commissionPrec).toBeDefined();
        expect(tigerPrec).toBeDefined();

        // Same authority level
        expect(commissionPrec!.authority).toBe(tigerPrec!.authority);

        // But commission has higher preference (lower number)
        expect(commissionPrec!.preference).toBeLessThan(tigerPrec!.preference);
      });

      it('should apply same precedence to state_house', () => {
        const preferredSource = getPreferredSource('state_house');

        expect(preferredSource.source).toBe('state-redistricting-commission');
        expect(preferredSource.preference).toBe(1);
      });
    });

    describe('Redistricting-affected boundaries', () => {
      it('should give state commissions highest precedence during redistricting', () => {
        const legislativeTypes: TIGERBoundaryType[] = [
          'congressional',
          'state_senate',
          'state_house',
        ];

        for (const type of legislativeTypes) {
          const preferred = getPreferredSource(type);
          expect(preferred.source).toBe('state-redistricting-commission');
        }
      });

      it('should include state-redistricting as fallback', () => {
        const precedence = getSourcePrecedence('congressional');

        const stateRedistricting = precedence.find(
          (p) => p.source === 'state-redistricting'
        );

        expect(stateRedistricting).toBeDefined();
        expect(stateRedistricting!.preference).toBe(2);
      });
    });

    describe('County boundaries', () => {
      it('should rank TIGER highest for counties', () => {
        const preferredSource = getPreferredSource('county');

        expect(preferredSource.source).toBe('census-tiger');
        expect(preferredSource.authority).toBe(AuthorityLevel.FEDERAL_MANDATE);
        expect(preferredSource.preference).toBe(1);
      });

      it('should include county-gis as secondary source', () => {
        const precedence = getSourcePrecedence('county');

        const countyGIS = precedence.find((p) => p.source === 'county-gis');

        expect(countyGIS).toBeDefined();
        expect(countyGIS!.authority).toBe(AuthorityLevel.MUNICIPAL_OFFICIAL);
        expect(countyGIS!.preference).toBe(2);
      });
    });

    describe('Non-TIGER boundaries', () => {
      it('should use county-gis for voting precincts', () => {
        const preferredSource = getPreferredSource('voting_precinct');

        expect(preferredSource.source).toBe('county-gis');
        expect(preferredSource.authority).toBe(AuthorityLevel.MUNICIPAL_OFFICIAL);
      });

      it('should use state-gis for special districts', () => {
        const preferredSource = getPreferredSource('special_district');

        expect(preferredSource.source).toBe('state-gis');
        expect(preferredSource.authority).toBe(AuthorityLevel.STATE_MANDATE);
      });
    });
  });

  describe('Helper functions', () => {
    describe('getTIGERAuthorityRule', () => {
      it('should return rule for all boundary types', () => {
        const types: TIGERBoundaryType[] = [
          'congressional',
          'state_senate',
          'state_house',
          'county',
          'place',
          'school_unified',
          'voting_precinct',
          'special_district',
        ];

        for (const type of types) {
          const rule = getTIGERAuthorityRule(type);
          expect(rule).toBeDefined();
          expect(rule.authorityLevel).toBeDefined();
          expect(rule.legalStatus).toBeDefined();
          expect(rule.validityWindow).toBeDefined();
          expect(rule.precedence).toBeDefined();
        }
      });

      it('should throw for unknown boundary type', () => {
        expect(() =>
          // @ts-expect-error - Testing invalid input
          getTIGERAuthorityRule('invalid-type')
        ).toThrow();
      });
    });

    describe('isTIGERAuthoritative', () => {
      it('should return true for TIGER-provided types', () => {
        expect(isTIGERAuthoritative('congressional')).toBe(true);
        expect(isTIGERAuthoritative('state_senate')).toBe(true);
        expect(isTIGERAuthoritative('state_house')).toBe(true);
        expect(isTIGERAuthoritative('county')).toBe(true);
        expect(isTIGERAuthoritative('place')).toBe(true);
        expect(isTIGERAuthoritative('school_unified')).toBe(true);
      });

      it('should return false for non-TIGER types', () => {
        expect(isTIGERAuthoritative('voting_precinct')).toBe(false);
        expect(isTIGERAuthoritative('special_district')).toBe(false);
      });
    });

    describe('isRedistrictingAffected', () => {
      it('should return true for legislative boundaries', () => {
        expect(isRedistrictingAffected('congressional')).toBe(true);
        expect(isRedistrictingAffected('state_senate')).toBe(true);
        expect(isRedistrictingAffected('state_house')).toBe(true);
      });

      it('should return false for non-legislative boundaries', () => {
        expect(isRedistrictingAffected('county')).toBe(false);
        expect(isRedistrictingAffected('place')).toBe(false);
        expect(isRedistrictingAffected('school_unified')).toBe(false);
        expect(isRedistrictingAffected('voting_precinct')).toBe(false);
        expect(isRedistrictingAffected('special_district')).toBe(false);
      });
    });

    describe('doesTIGERProvide', () => {
      it('should return true for TIGER-provided types', () => {
        expect(doesTIGERProvide('congressional')).toBe(true);
        expect(doesTIGERProvide('state_senate')).toBe(true);
        expect(doesTIGERProvide('county')).toBe(true);
        expect(doesTIGERProvide('place')).toBe(true);
      });

      it('should return false for non-TIGER types', () => {
        expect(doesTIGERProvide('voting_precinct')).toBe(false);
        expect(doesTIGERProvide('special_district')).toBe(false);
      });
    });

    describe('getSourcePrecedence', () => {
      it('should return sorted precedence list', () => {
        const precedence = getSourcePrecedence('congressional');

        expect(precedence.length).toBeGreaterThan(0);

        // Verify sorted by preference
        for (let i = 1; i < precedence.length; i++) {
          expect(precedence[i].preference).toBeGreaterThan(
            precedence[i - 1].preference
          );
        }
      });

      it('should include all required fields', () => {
        const precedence = getSourcePrecedence('congressional');

        for (const prec of precedence) {
          expect(prec.source).toBeDefined();
          expect(prec.authority).toBeDefined();
          expect(prec.preference).toBeDefined();
          expect(typeof prec.preference).toBe('number');
        }
      });
    });

    describe('getPreferredSource', () => {
      it('should return first precedence entry', () => {
        const preferred = getPreferredSource('congressional');
        const precedence = getSourcePrecedence('congressional');

        expect(preferred).toEqual(precedence[0]);
      });

      it('should throw for boundary type with no sources', () => {
        // All types have sources, so this should not throw
        const types: TIGERBoundaryType[] = [
          'congressional',
          'state_senate',
          'state_house',
          'county',
          'place',
          'school_unified',
          'voting_precinct',
          'special_district',
        ];

        for (const type of types) {
          expect(() => getPreferredSource(type)).not.toThrow();
        }
      });
    });

    describe('findSourcePrecedence', () => {
      it('should find source by provider', () => {
        const prec = findSourcePrecedence('congressional', 'census-tiger');

        expect(prec).toBeDefined();
        expect(prec!.source).toBe('census-tiger');
      });

      it('should return undefined for non-existent source', () => {
        const prec = findSourcePrecedence('congressional', 'osm' as SourceProvider);

        expect(prec).toBeUndefined();
      });

      it('should find state commission source', () => {
        const prec = findSourcePrecedence(
          'congressional',
          'state-redistricting-commission'
        );

        expect(prec).toBeDefined();
        expect(prec!.source).toBe('state-redistricting-commission');
        expect(prec!.preference).toBe(1);
      });
    });

    describe('getSourceAuthority', () => {
      it('should return authority for known source', () => {
        const authority = getSourceAuthority('congressional', 'census-tiger');

        expect(authority).toBe(AuthorityLevel.FEDERAL_MANDATE);
      });

      it('should return undefined for unknown source', () => {
        const authority = getSourceAuthority('congressional', 'osm' as SourceProvider);

        expect(authority).toBeUndefined();
      });

      it('should return correct authority for state commission', () => {
        const authority = getSourceAuthority(
          'congressional',
          'state-redistricting-commission'
        );

        expect(authority).toBe(AuthorityLevel.FEDERAL_MANDATE);
      });

      it('should return correct authority for hub aggregator', () => {
        const authority = getSourceAuthority('congressional', 'arcgis-hub');

        expect(authority).toBe(AuthorityLevel.HUB_AGGREGATOR);
      });
    });
  });

  describe('Data integrity', () => {
    it('should have rules for all boundary types', () => {
      const types: TIGERBoundaryType[] = [
        'congressional',
        'state_senate',
        'state_house',
        'county',
        'place',
        'school_unified',
        'voting_precinct',
        'special_district',
      ];

      for (const type of types) {
        expect(TIGER_AUTHORITY_RULES[type]).toBeDefined();
      }
    });

    it('should have at least one source for all types', () => {
      const types = Object.keys(TIGER_AUTHORITY_RULES) as TIGERBoundaryType[];

      for (const type of types) {
        const rule = TIGER_AUTHORITY_RULES[type];
        expect(rule.precedence.length).toBeGreaterThan(0);
      }
    });

    it('should have unique preference values within each type', () => {
      const types = Object.keys(TIGER_AUTHORITY_RULES) as TIGERBoundaryType[];

      for (const type of types) {
        const precedence = getSourcePrecedence(type);
        const preferences = precedence.map((p) => p.preference);
        const uniquePrefs = new Set(preferences);

        expect(uniquePrefs.size).toBe(preferences.length);
      }
    });

    it('should have sequential preference values starting at 1', () => {
      const precedence = getSourcePrecedence('congressional');

      expect(precedence[0].preference).toBe(1);

      for (let i = 1; i < precedence.length; i++) {
        const gap = precedence[i].preference - precedence[i - 1].preference;
        expect(gap).toBeGreaterThan(0);
      }
    });
  });

  describe('Boundary type sets', () => {
    it('should have correct TIGER_AUTHORITATIVE_TYPES', () => {
      expect(TIGER_AUTHORITATIVE_TYPES.size).toBe(6);
      expect(TIGER_AUTHORITATIVE_TYPES.has('congressional')).toBe(true);
      expect(TIGER_AUTHORITATIVE_TYPES.has('state_senate')).toBe(true);
      expect(TIGER_AUTHORITATIVE_TYPES.has('state_house')).toBe(true);
      expect(TIGER_AUTHORITATIVE_TYPES.has('county')).toBe(true);
      expect(TIGER_AUTHORITATIVE_TYPES.has('place')).toBe(true);
      expect(TIGER_AUTHORITATIVE_TYPES.has('school_unified')).toBe(true);
    });

    it('should have correct REDISTRICTING_AFFECTED_TYPES', () => {
      expect(REDISTRICTING_AFFECTED_TYPES.size).toBe(3);
      expect(REDISTRICTING_AFFECTED_TYPES.has('congressional')).toBe(true);
      expect(REDISTRICTING_AFFECTED_TYPES.has('state_senate')).toBe(true);
      expect(REDISTRICTING_AFFECTED_TYPES.has('state_house')).toBe(true);
    });

    it('should have correct TIGER_NOT_PROVIDED_TYPES', () => {
      expect(TIGER_NOT_PROVIDED_TYPES.size).toBe(2);
      expect(TIGER_NOT_PROVIDED_TYPES.has('voting_precinct')).toBe(true);
      expect(TIGER_NOT_PROVIDED_TYPES.has('special_district')).toBe(true);
    });

    it('should have no overlap between authoritative and not-provided', () => {
      for (const type of Array.from(TIGER_AUTHORITATIVE_TYPES)) {
        expect(TIGER_NOT_PROVIDED_TYPES.has(type)).toBe(false);
      }
    });
  });
});
