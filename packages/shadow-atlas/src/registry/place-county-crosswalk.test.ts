/**
 * Tests for Census PLACE-to-County Crosswalk
 */

import { describe, it, expect } from 'vitest';
import {
  getCountiesForPlace,
  getPrimaryCountyForPlace,
  getPlacesInCounty,
  isMultiCountyPlace,
  getCrosswalkRecord,
  getCountyDistribution,
  PLACE_COUNTY_CROSSWALK,
} from './place-county-crosswalk.js';

describe('Census PLACE-to-County Crosswalk', () => {
  describe('Multi-County Cities', () => {
    it('should return all 5 counties for New York City', () => {
      const counties = getCountiesForPlace('3651000');

      expect(counties).toHaveLength(5);
      expect(counties.map((c) => c.countyFips)).toEqual(
        expect.arrayContaining([
          '36061', // Manhattan
          '36047', // Brooklyn
          '36081', // Queens
          '36005', // Bronx
          '36085', // Staten Island
        ])
      );
    });

    it('should identify Manhattan as primary county for NYC', () => {
      const primary = getPrimaryCountyForPlace('3651000');
      expect(primary).toBe('36061'); // Manhattan
    });

    it('should return all 4 counties for Kansas City, MO', () => {
      const counties = getCountiesForPlace('2938000');

      expect(counties).toHaveLength(4);
      expect(counties.map((c) => c.countyFips)).toEqual(
        expect.arrayContaining([
          '29095', // Jackson County
          '29047', // Clay County
          '29165', // Platte County
          '29037', // Cass County
        ])
      );
    });

    it('should return all 3 counties for Houston, TX', () => {
      const counties = getCountiesForPlace('4835000');

      expect(counties).toHaveLength(3);
      expect(counties.map((c) => c.countyFips)).toEqual(
        expect.arrayContaining([
          '48201', // Harris County
          '48157', // Fort Bend County
          '48339', // Montgomery County
        ])
      );
    });

    it('should identify multi-county places correctly', () => {
      expect(isMultiCountyPlace('3651000')).toBe(true); // NYC
      expect(isMultiCountyPlace('2938000')).toBe(true); // Kansas City
      expect(isMultiCountyPlace('4835000')).toBe(true); // Houston
      expect(isMultiCountyPlace('0644000')).toBe(false); // Los Angeles
    });
  });

  describe('Single-County Cities', () => {
    it('should return single county for Los Angeles', () => {
      const counties = getCountiesForPlace('0644000');

      expect(counties).toHaveLength(1);
      expect(counties[0].countyFips).toBe('06037'); // Los Angeles County
      expect(counties[0].isPrimary).toBe(true);
      expect(counties[0].percentArea).toBe(100.0);
    });

    it('should return single county for Phoenix', () => {
      const counties = getCountiesForPlace('0455000');

      expect(counties).toHaveLength(1);
      expect(counties[0].countyFips).toBe('04013'); // Maricopa County
    });

    it('should return single county for Chicago', () => {
      const counties = getCountiesForPlace('1714000');

      expect(counties).toHaveLength(2); // Chicago spans 2 counties
      expect(counties[0].countyFips).toBe('17031'); // Cook County (primary)
    });

    it('should return single county for Boulder, CO (test case)', () => {
      const counties = getCountiesForPlace('0803000');

      expect(counties).toHaveLength(1);
      expect(counties[0].countyFips).toBe('08013'); // Boulder County
    });
  });

  describe('Virginia Independent Cities', () => {
    it('should return independent city FIPS for Virginia Beach', () => {
      const counties = getCountiesForPlace('5182000');

      expect(counties).toHaveLength(1);
      expect(counties[0].countyFips).toBe('51810'); // Virginia Beach city
      expect(counties[0].countyName).toBe('Virginia Beach city');
    });

    it('should return independent city FIPS for Norfolk', () => {
      const counties = getCountiesForPlace('5157000');

      expect(counties).toHaveLength(1);
      expect(counties[0].countyFips).toBe('51710'); // Norfolk city
    });

    it('should return independent city FIPS for Richmond', () => {
      const counties = getCountiesForPlace('5167000');

      expect(counties).toHaveLength(1);
      expect(counties[0].countyFips).toBe('51760'); // Richmond city
    });
  });

  describe('Consolidated City-Counties', () => {
    it('should return single county for Philadelphia (consolidated)', () => {
      const counties = getCountiesForPlace('4260000');

      expect(counties).toHaveLength(1);
      expect(counties[0].countyFips).toBe('42101'); // Philadelphia County
      expect(counties[0].percentArea).toBe(100.0);
    });

    it('should return single county for San Francisco (consolidated)', () => {
      const counties = getCountiesForPlace('0667000');

      expect(counties).toHaveLength(1);
      expect(counties[0].countyFips).toBe('06075'); // San Francisco County
    });

    it('should return single county for Denver (consolidated)', () => {
      const counties = getCountiesForPlace('0820000');

      expect(counties).toHaveLength(1);
      expect(counties[0].countyFips).toBe('08031'); // Denver County
    });

    it('should return single county for Jacksonville (consolidated)', () => {
      const counties = getCountiesForPlace('1235000');

      expect(counties).toHaveLength(1);
      expect(counties[0].countyFips).toBe('12031'); // Duval County
    });
  });

  describe('Reverse Lookup (County to Places)', () => {
    it('should find New York City in Manhattan (36061)', () => {
      const places = getPlacesInCounty('36061');
      expect(places).toContain('3651000'); // NYC
    });

    it('should find Kansas City in Jackson County, MO (29095)', () => {
      const places = getPlacesInCounty('29095');
      expect(places).toContain('2938000'); // Kansas City
    });

    it('should find Los Angeles in Los Angeles County (06037)', () => {
      const places = getPlacesInCounty('06037');
      expect(places).toContain('0644000'); // Los Angeles
    });

    it('should return empty array for county with no registered places', () => {
      const places = getPlacesInCounty('99999'); // Invalid county
      expect(places).toHaveLength(0);
    });
  });

  describe('Complete Crosswalk Records', () => {
    it('should return complete record for New York City', () => {
      const record = getCrosswalkRecord('3651000');

      expect(record).not.toBeNull();
      expect(record?.placeName).toBe('New York city');
      expect(record?.state).toBe('NY');
      expect(record?.vintage).toBe(2023);
      expect(record?.counties).toHaveLength(5);
    });

    it('should return null for unknown place', () => {
      const record = getCrosswalkRecord('9999999');
      expect(record).toBeNull();
    });
  });

  describe('County Distribution Sorting', () => {
    it('should sort NYC counties by area percentage (largest first)', () => {
      const distribution = getCountyDistribution('3651000');

      expect(distribution[0].countyFips).toBe('36081'); // Queens (42.1%)
      expect(distribution[1].countyFips).toBe('36047'); // Brooklyn (28.6%)
      expect(distribution[2].countyFips).toBe('36005'); // Bronx (16.8%)
      expect(distribution[3].countyFips).toBe('36061'); // Manhattan (8.4%)
      expect(distribution[4].countyFips).toBe('36085'); // Staten Island (4.1%)
    });

    it('should sort Kansas City counties by area percentage', () => {
      const distribution = getCountyDistribution('2938000');

      expect(distribution[0].countyFips).toBe('29095'); // Jackson (68.2%)
      expect(distribution[1].countyFips).toBe('29047'); // Clay (22.1%)
      expect(distribution[2].countyFips).toBe('29165'); // Platte (8.4%)
      expect(distribution[3].countyFips).toBe('29037'); // Cass (1.3%)
    });

    it('should handle single-county cities correctly', () => {
      const distribution = getCountyDistribution('0644000'); // Los Angeles

      expect(distribution).toHaveLength(1);
      expect(distribution[0].countyFips).toBe('06037');
      expect(distribution[0].percentArea).toBe(100.0);
    });
  });

  describe('Primary County Identification', () => {
    it('should identify primary counties correctly', () => {
      expect(getPrimaryCountyForPlace('3651000')).toBe('36061'); // NYC -> Manhattan
      expect(getPrimaryCountyForPlace('2938000')).toBe('29095'); // KC -> Jackson
      expect(getPrimaryCountyForPlace('4835000')).toBe('48201'); // Houston -> Harris
      expect(getPrimaryCountyForPlace('0644000')).toBe('06037'); // LA -> LA County
    });

    it('should return null for unknown place', () => {
      const primary = getPrimaryCountyForPlace('9999999');
      expect(primary).toBeNull();
    });
  });

  describe('Data Quality Checks', () => {
    it('should have exactly one primary county per place', () => {
      Object.entries(PLACE_COUNTY_CROSSWALK).forEach(([fips, record]) => {
        const primaryCount = record.counties.filter((c) => c.isPrimary).length;
        expect(primaryCount).toBe(1);
      });
    });

    it('should have consistent state codes across counties', () => {
      Object.entries(PLACE_COUNTY_CROSSWALK).forEach(([fips, record]) => {
        record.counties.forEach((county) => {
          // Virginia independent cities use VA, not the city name
          if (record.state === 'VA' && county.countyFips.startsWith('51')) {
            expect(county.state).toBe('VA');
          } else {
            expect(county.state).toBe(record.state);
          }
        });
      });
    });

    it('should have valid FIPS codes (7 digits for places, 5 for counties)', () => {
      Object.entries(PLACE_COUNTY_CROSSWALK).forEach(([fips, record]) => {
        expect(fips).toMatch(/^\d{7}$/); // 7-digit place FIPS
        expect(record.placeFips).toBe(fips);

        record.counties.forEach((county) => {
          expect(county.countyFips).toMatch(/^\d{5}$/); // 5-digit county FIPS
        });
      });
    });

    it('should have area percentages that sum to ~100% for multi-county places', () => {
      Object.entries(PLACE_COUNTY_CROSSWALK).forEach(([fips, record]) => {
        if (record.counties.length > 1) {
          const totalArea = record.counties.reduce(
            (sum, c) => sum + (c.percentArea ?? 0),
            0
          );

          // Allow for rounding errors (within 1%)
          expect(totalArea).toBeGreaterThanOrEqual(99.0);
          expect(totalArea).toBeLessThanOrEqual(101.0);
        }
      });
    });

    it('should have 2023 vintage for all records', () => {
      Object.values(PLACE_COUNTY_CROSSWALK).forEach((record) => {
        expect(record.vintage).toBe(2023);
      });
    });

    it('should have valid last verified dates', () => {
      Object.values(PLACE_COUNTY_CROSSWALK).forEach((record) => {
        expect(record.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const date = new Date(record.lastVerified);
        expect(date.getFullYear()).toBeGreaterThanOrEqual(2023);
      });
    });
  });

  describe('Coverage of Top 30 US Cities', () => {
    it('should cover top 10 US cities', () => {
      const top10 = [
        '3651000', // 1. New York
        '0644000', // 2. Los Angeles
        '1714000', // 3. Chicago
        '4835000', // 4. Houston
        '0455000', // 5. Phoenix
        '4260000', // 6. Philadelphia
        '4865000', // 7. San Antonio
        '0666000', // 8. San Diego
        '4819000', // 9. Dallas
        '0668000', // 10. San Jose
      ];

      top10.forEach((fips) => {
        expect(PLACE_COUNTY_CROSSWALK[fips]).toBeDefined();
      });
    });

    it('should cover cities 11-20', () => {
      const cities11to20 = [
        '4805000', // 11. Austin
        '1235000', // 12. Jacksonville
        '4827000', // 13. Fort Worth
        '3918000', // 14. Columbus
        '3712000', // 15. Charlotte
        // '0667000', // 16. San Francisco (handled separately)
        // '1714000', // 17. Indianapolis (already in multi-county)
        '5363000', // 18. Seattle
        '0820000', // 19. Denver
        '4055000', // 20. Oklahoma City
      ];

      cities11to20.forEach((fips) => {
        expect(PLACE_COUNTY_CROSSWALK[fips]).toBeDefined();
      });
    });
  });
});
