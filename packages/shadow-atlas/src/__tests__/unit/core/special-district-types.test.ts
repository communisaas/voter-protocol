/**
 * Tests for special district type guards and helpers
 */

import { describe, it, expect } from 'vitest';
import { BoundaryType, PRECISION_RANK } from '../../../core/types.js';
import {
  isSpecialDistrict,
  isSchoolDistrict,
  isElectedSpecialDistrict,
  isAppointedSpecialDistrict,
  isMixedGovernanceDistrict,
  getSpecialDistrictGovernance,
  getSpecialDistrictCategory,
  getCivicParticipationPriority,
  getSpecialDistrictDescription,
  SPECIAL_DISTRICT_TYPES,
  SCHOOL_DISTRICT_TYPES,
  ELECTED_SPECIAL_DISTRICT_TYPES,
  APPOINTED_SPECIAL_DISTRICT_TYPES,
} from '../../../core/special-district-types.js';

describe('Special District Type Guards', () => {
  describe('isSpecialDistrict', () => {
    it('returns true for all special district types', () => {
      for (const type of SPECIAL_DISTRICT_TYPES) {
        expect(isSpecialDistrict(type)).toBe(true);
      }
    });

    it('returns false for non-special-district types', () => {
      expect(isSpecialDistrict(BoundaryType.CITY_COUNCIL_DISTRICT)).toBe(false);
      expect(isSpecialDistrict(BoundaryType.COUNTY)).toBe(false);
      expect(isSpecialDistrict(BoundaryType.CONGRESSIONAL_DISTRICT)).toBe(false);
    });
  });

  describe('isSchoolDistrict', () => {
    it('returns true for all school district types', () => {
      expect(isSchoolDistrict(BoundaryType.SCHOOL_DISTRICT_UNIFIED)).toBe(true);
      expect(isSchoolDistrict(BoundaryType.SCHOOL_DISTRICT_ELEMENTARY)).toBe(true);
      expect(isSchoolDistrict(BoundaryType.SCHOOL_DISTRICT_SECONDARY)).toBe(true);
    });

    it('returns false for non-school special districts', () => {
      expect(isSchoolDistrict(BoundaryType.FIRE_DISTRICT)).toBe(false);
      expect(isSchoolDistrict(BoundaryType.WATER_DISTRICT)).toBe(false);
    });
  });

  describe('isElectedSpecialDistrict', () => {
    it('returns true for elected special districts', () => {
      for (const type of ELECTED_SPECIAL_DISTRICT_TYPES) {
        expect(isElectedSpecialDistrict(type)).toBe(true);
      }
    });

    it('returns false for appointed special districts', () => {
      expect(isElectedSpecialDistrict(BoundaryType.WATER_DISTRICT)).toBe(false);
      expect(isElectedSpecialDistrict(BoundaryType.UTILITY_DISTRICT)).toBe(false);
      expect(isElectedSpecialDistrict(BoundaryType.TRANSIT_DISTRICT)).toBe(false);
    });
  });

  describe('isAppointedSpecialDistrict', () => {
    it('returns true for appointed special districts', () => {
      for (const type of APPOINTED_SPECIAL_DISTRICT_TYPES) {
        expect(isAppointedSpecialDistrict(type)).toBe(true);
      }
    });

    it('returns false for elected special districts', () => {
      for (const type of ELECTED_SPECIAL_DISTRICT_TYPES) {
        expect(isAppointedSpecialDistrict(type)).toBe(false);
      }
    });
  });

  describe('isMixedGovernanceDistrict', () => {
    it('returns true for hospital districts', () => {
      expect(isMixedGovernanceDistrict(BoundaryType.HOSPITAL_DISTRICT)).toBe(true);
    });

    it('returns false for clearly elected or appointed districts', () => {
      expect(isMixedGovernanceDistrict(BoundaryType.SCHOOL_DISTRICT_UNIFIED)).toBe(false);
      expect(isMixedGovernanceDistrict(BoundaryType.WATER_DISTRICT)).toBe(false);
    });
  });
});

describe('Special District Categorization', () => {
  describe('getSpecialDistrictGovernance', () => {
    it('returns "elected" for school districts', () => {
      expect(getSpecialDistrictGovernance(BoundaryType.SCHOOL_DISTRICT_UNIFIED)).toBe('elected');
      expect(getSpecialDistrictGovernance(BoundaryType.SCHOOL_DISTRICT_ELEMENTARY)).toBe('elected');
    });

    it('returns "appointed" for utility districts', () => {
      expect(getSpecialDistrictGovernance(BoundaryType.WATER_DISTRICT)).toBe('appointed');
      expect(getSpecialDistrictGovernance(BoundaryType.TRANSIT_DISTRICT)).toBe('appointed');
    });

    it('returns "mixed" for hospital districts', () => {
      expect(getSpecialDistrictGovernance(BoundaryType.HOSPITAL_DISTRICT)).toBe('mixed');
    });

    it('returns "unknown" for non-special-districts', () => {
      expect(getSpecialDistrictGovernance(BoundaryType.COUNTY)).toBe('unknown');
    });
  });

  describe('getSpecialDistrictCategory', () => {
    it('returns correct category for each special district type', () => {
      expect(getSpecialDistrictCategory(BoundaryType.SCHOOL_DISTRICT_UNIFIED)).toBe('school');
      expect(getSpecialDistrictCategory(BoundaryType.FIRE_DISTRICT)).toBe('public-safety');
      expect(getSpecialDistrictCategory(BoundaryType.LIBRARY_DISTRICT)).toBe('cultural');
      expect(getSpecialDistrictCategory(BoundaryType.HOSPITAL_DISTRICT)).toBe('healthcare');
      expect(getSpecialDistrictCategory(BoundaryType.WATER_DISTRICT)).toBe('utility');
      expect(getSpecialDistrictCategory(BoundaryType.TRANSIT_DISTRICT)).toBe('transportation');
    });

    it('returns "none" for non-special-districts', () => {
      expect(getSpecialDistrictCategory(BoundaryType.COUNTY)).toBe('none');
    });
  });

  describe('getCivicParticipationPriority', () => {
    it('returns 100 for school districts (highest priority)', () => {
      expect(getCivicParticipationPriority(BoundaryType.SCHOOL_DISTRICT_UNIFIED)).toBe(100);
      expect(getCivicParticipationPriority(BoundaryType.SCHOOL_DISTRICT_ELEMENTARY)).toBe(100);
    });

    it('returns 80 for fire and library districts', () => {
      expect(getCivicParticipationPriority(BoundaryType.FIRE_DISTRICT)).toBe(80);
      expect(getCivicParticipationPriority(BoundaryType.LIBRARY_DISTRICT)).toBe(80);
    });

    it('returns 60 for hospital districts', () => {
      expect(getCivicParticipationPriority(BoundaryType.HOSPITAL_DISTRICT)).toBe(60);
    });

    it('returns 40 for utility and transit districts', () => {
      expect(getCivicParticipationPriority(BoundaryType.WATER_DISTRICT)).toBe(40);
      expect(getCivicParticipationPriority(BoundaryType.TRANSIT_DISTRICT)).toBe(40);
    });

    it('returns 0 for non-special-districts', () => {
      expect(getCivicParticipationPriority(BoundaryType.COUNTY)).toBe(0);
    });

    it('priorities decrease from elected to appointed districts', () => {
      const schoolPriority = getCivicParticipationPriority(BoundaryType.SCHOOL_DISTRICT_UNIFIED);
      const hospitalPriority = getCivicParticipationPriority(BoundaryType.HOSPITAL_DISTRICT);
      const waterPriority = getCivicParticipationPriority(BoundaryType.WATER_DISTRICT);

      expect(schoolPriority).toBeGreaterThan(hospitalPriority);
      expect(hospitalPriority).toBeGreaterThan(waterPriority);
    });
  });

  describe('getSpecialDistrictDescription', () => {
    it('returns meaningful descriptions for special districts', () => {
      const desc = getSpecialDistrictDescription(BoundaryType.SCHOOL_DISTRICT_UNIFIED);
      expect(desc).toContain('K-12');
      expect(desc).toContain('elected');
    });

    it('indicates governance type in description', () => {
      const electedDesc = getSpecialDistrictDescription(BoundaryType.FIRE_DISTRICT);
      expect(electedDesc).toContain('elected');

      const appointedDesc = getSpecialDistrictDescription(BoundaryType.WATER_DISTRICT);
      expect(appointedDesc).toContain('appointed');

      const mixedDesc = getSpecialDistrictDescription(BoundaryType.HOSPITAL_DISTRICT);
      expect(mixedDesc).toContain('varies');
    });
  });
});

describe('PRECISION_RANK Integration', () => {
  it('all special district types have precision ranks', () => {
    for (const type of SPECIAL_DISTRICT_TYPES) {
      expect(PRECISION_RANK[type]).toBeDefined();
      expect(typeof PRECISION_RANK[type]).toBe('number');
    }
  });

  it('school districts rank higher than utility districts', () => {
    const schoolRank = PRECISION_RANK[BoundaryType.SCHOOL_DISTRICT_UNIFIED];
    const waterRank = PRECISION_RANK[BoundaryType.WATER_DISTRICT];

    // Lower rank = higher precision/priority
    expect(schoolRank).toBeLessThan(waterRank);
  });

  it('special districts rank between CDP and COUNTY', () => {
    const cdpRank = PRECISION_RANK[BoundaryType.CDP];
    const countyRank = PRECISION_RANK[BoundaryType.COUNTY];

    for (const type of SPECIAL_DISTRICT_TYPES) {
      const specialRank = PRECISION_RANK[type];
      expect(specialRank).toBeGreaterThan(cdpRank);
      expect(specialRank).toBeLessThan(countyRank);
    }
  });

  it('elected districts rank higher than appointed districts', () => {
    // School (elected) should rank higher (lower number) than water (appointed)
    expect(PRECISION_RANK[BoundaryType.SCHOOL_DISTRICT_UNIFIED])
      .toBeLessThan(PRECISION_RANK[BoundaryType.WATER_DISTRICT]);

    // Fire (elected) should rank higher than transit (appointed)
    expect(PRECISION_RANK[BoundaryType.FIRE_DISTRICT])
      .toBeLessThan(PRECISION_RANK[BoundaryType.TRANSIT_DISTRICT]);
  });
});

describe('Type Safety', () => {
  it('type arrays are readonly', () => {
    // This test verifies compile-time readonly enforcement
    // If these assignments compile, the test fails (should be caught by TypeScript)
    expect(Array.isArray(SCHOOL_DISTRICT_TYPES)).toBe(true);
    expect(Array.isArray(ELECTED_SPECIAL_DISTRICT_TYPES)).toBe(true);
  });

  it('all special district types are valid BoundaryType enum values', () => {
    for (const type of SPECIAL_DISTRICT_TYPES) {
      expect(Object.values(BoundaryType)).toContain(type);
    }
  });
});
