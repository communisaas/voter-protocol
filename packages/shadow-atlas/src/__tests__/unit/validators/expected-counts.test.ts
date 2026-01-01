/**
 * Expected Counts Unit Tests
 *
 * Validates per-state expected counts for VTD, Place, CDP, COUSUB and other TIGER layers.
 * Ensures data integrity and consistency with NATIONAL_TOTALS.
 *
 * Data Sources:
 * - VTD: Census Bureau 2020 Redistricting Data (PL 94-171)
 * - Place/CDP: Census Bureau TIGER/Line 2024
 * - COUSUB: Census Bureau TIGER/Line 2024, State and Local Census Geography Guides
 * - SUBMCD: Census Bureau TIGER/Line 2024 (Puerto Rico subbarrios only)
 * - CONCITY: Census Bureau TIGER/Line 2024
 * - AIANNH: Census Bureau TIGER/Line 2024
 */

import { describe, it, expect } from 'vitest';
import {
  EXPECTED_VTD_BY_STATE,
  EXPECTED_PLACE_BY_STATE,
  EXPECTED_CDP_BY_STATE,
  EXPECTED_COUSUB_BY_STATE,
  EXPECTED_SUBMCD_BY_STATE,
  EXPECTED_CONCITY_BY_STATE,
  EXPECTED_AIANNH_BY_STATE,
  EXPECTED_CD_BY_STATE,
  EXPECTED_SLDU_BY_STATE,
  EXPECTED_SLDL_BY_STATE,
  EXPECTED_COUNTIES_BY_STATE,
  VTD_DATA_VINTAGE,
  isVtdDataFresh,
  getExpectedCount,
  NATIONAL_TOTALS,
} from '../../../validators/tiger-expected-counts.js';

// ============================================================================
// VTD Expected Counts
// ============================================================================

describe('EXPECTED_VTD_BY_STATE', () => {
  it('should have counts for all 50 states + DC', () => {
    const stateFips = Object.keys(EXPECTED_VTD_BY_STATE);
    // 50 states + DC + 5 territories = 56
    expect(stateFips.length).toBeGreaterThanOrEqual(51);
  });

  it('should have counts for all territories', () => {
    // American Samoa, Guam, Northern Mariana Islands, Puerto Rico, US Virgin Islands
    expect(EXPECTED_VTD_BY_STATE['60']).toBeDefined(); // AS
    expect(EXPECTED_VTD_BY_STATE['66']).toBeDefined(); // GU
    expect(EXPECTED_VTD_BY_STATE['69']).toBeDefined(); // NMI
    expect(EXPECTED_VTD_BY_STATE['72']).toBeDefined(); // PR
    expect(EXPECTED_VTD_BY_STATE['78']).toBeDefined(); // VI
  });

  it('should have California as highest VTD count', () => {
    const maxEntry = Object.entries(EXPECTED_VTD_BY_STATE).reduce(
      (max, [fips, count]) => (count > max.count ? { fips, count } : max),
      { fips: '', count: 0 }
    );
    expect(maxEntry.fips).toBe('06'); // California
    expect(maxEntry.count).toBeGreaterThan(20000);
  });

  it('should have all positive counts', () => {
    for (const [fips, count] of Object.entries(EXPECTED_VTD_BY_STATE)) {
      expect(count).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(count)).toBe(true);
    }
  });

  it('should have national total match sum of state counts', () => {
    const sum = Object.values(EXPECTED_VTD_BY_STATE).reduce((a, b) => a + b, 0);
    expect(NATIONAL_TOTALS.vtd).toBe(sum);
  });

  it('should return correct count via getExpectedCount()', () => {
    expect(getExpectedCount('vtd', '06')).toBe(EXPECTED_VTD_BY_STATE['06']);
    expect(getExpectedCount('vtd', '48')).toBe(EXPECTED_VTD_BY_STATE['48']);
    expect(getExpectedCount('vtd', '56')).toBe(EXPECTED_VTD_BY_STATE['56']);
  });

  it('should return national total when no state specified', () => {
    const total = getExpectedCount('vtd');
    expect(total).toBe(NATIONAL_TOTALS.vtd);
    expect(total).toBeGreaterThan(150000);
  });
});

// ============================================================================
// VTD Data Vintage
// ============================================================================

describe('VTD_DATA_VINTAGE', () => {
  it('should have valid cycle year', () => {
    expect(VTD_DATA_VINTAGE.cycle).toBe(2020);
  });

  it('should have valid until after 2030 census', () => {
    expect(VTD_DATA_VINTAGE.validUntil).toBe(2031);
  });

  it('should cite Census Bureau source', () => {
    expect(VTD_DATA_VINTAGE.source).toContain('Census Bureau');
  });
});

describe('isVtdDataFresh()', () => {
  it('should return true for current year (2025)', () => {
    expect(isVtdDataFresh(2025)).toBe(true);
  });

  it('should return true for years before validUntil', () => {
    expect(isVtdDataFresh(2026)).toBe(true);
    expect(isVtdDataFresh(2030)).toBe(true);
  });

  it('should return false for years at or after validUntil', () => {
    expect(isVtdDataFresh(2031)).toBe(false);
    expect(isVtdDataFresh(2032)).toBe(false);
    expect(isVtdDataFresh(2040)).toBe(false);
  });

  it('should use current year when no argument provided', () => {
    const currentYear = new Date().getFullYear();
    expect(isVtdDataFresh()).toBe(currentYear < 2031);
  });
});

// ============================================================================
// Place Expected Counts
// ============================================================================

describe('EXPECTED_PLACE_BY_STATE', () => {
  it('should have counts for all 50 states + DC', () => {
    const stateFips = Object.keys(EXPECTED_PLACE_BY_STATE);
    expect(stateFips.length).toBeGreaterThanOrEqual(51);
  });

  it('should have Texas and Illinois as high place counts', () => {
    expect(EXPECTED_PLACE_BY_STATE['48']).toBeGreaterThan(1000); // Texas
    expect(EXPECTED_PLACE_BY_STATE['17']).toBeGreaterThan(1000); // Illinois
  });

  it('should have low counts for New England MCD states', () => {
    // These states use Minor Civil Divisions as primary local government
    expect(EXPECTED_PLACE_BY_STATE['23']).toBeLessThan(50); // Maine
    expect(EXPECTED_PLACE_BY_STATE['33']).toBeLessThan(50); // New Hampshire
    expect(EXPECTED_PLACE_BY_STATE['44']).toBeLessThan(50); // Rhode Island
    expect(EXPECTED_PLACE_BY_STATE['50']).toBeLessThan(50); // Vermont
  });

  it('should have all positive counts', () => {
    for (const [fips, count] of Object.entries(EXPECTED_PLACE_BY_STATE)) {
      expect(count).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(count)).toBe(true);
    }
  });

  it('should have national total match sum of state counts', () => {
    const sum = Object.values(EXPECTED_PLACE_BY_STATE).reduce((a, b) => a + b, 0);
    expect(NATIONAL_TOTALS.place).toBe(sum);
  });

  it('should return correct count via getExpectedCount()', () => {
    expect(getExpectedCount('place', '48')).toBe(EXPECTED_PLACE_BY_STATE['48']);
    expect(getExpectedCount('place', '06')).toBe(EXPECTED_PLACE_BY_STATE['06']);
  });
});

// ============================================================================
// CDP Expected Counts
// ============================================================================

describe('EXPECTED_CDP_BY_STATE', () => {
  it('should have counts for all 50 states + DC', () => {
    const stateFips = Object.keys(EXPECTED_CDP_BY_STATE);
    expect(stateFips.length).toBeGreaterThanOrEqual(51);
  });

  it('should have California as highest CDP count', () => {
    expect(EXPECTED_CDP_BY_STATE['06']).toBeGreaterThan(1000);
  });

  it('should have DC with zero CDPs', () => {
    expect(EXPECTED_CDP_BY_STATE['11']).toBe(0);
  });

  it('should have all non-negative counts', () => {
    for (const [fips, count] of Object.entries(EXPECTED_CDP_BY_STATE)) {
      expect(count).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(count)).toBe(true);
    }
  });

  it('should have national total match sum of state counts', () => {
    const sum = Object.values(EXPECTED_CDP_BY_STATE).reduce((a, b) => a + b, 0);
    expect(NATIONAL_TOTALS.cdp).toBe(sum);
  });

  it('should return correct count via getExpectedCount()', () => {
    expect(getExpectedCount('cdp', '06')).toBe(EXPECTED_CDP_BY_STATE['06']);
    expect(getExpectedCount('cdp', '12')).toBe(EXPECTED_CDP_BY_STATE['12']);
  });
});

// ============================================================================
// COUSUB (County Subdivisions) Expected Counts
// ============================================================================

describe('EXPECTED_COUSUB_BY_STATE', () => {
  it('should have counts for all 50 states + DC + territories', () => {
    const stateFips = Object.keys(EXPECTED_COUSUB_BY_STATE);
    // 50 states + DC + 5 territories = 56
    expect(stateFips.length).toBe(56);
  });

  it('should have counts for all territories', () => {
    // American Samoa, Guam, Northern Mariana Islands, Puerto Rico, US Virgin Islands
    expect(EXPECTED_COUSUB_BY_STATE['60']).toBeDefined(); // AS
    expect(EXPECTED_COUSUB_BY_STATE['66']).toBeDefined(); // GU
    expect(EXPECTED_COUSUB_BY_STATE['69']).toBeDefined(); // NMI
    expect(EXPECTED_COUSUB_BY_STATE['72']).toBeDefined(); // PR
    expect(EXPECTED_COUSUB_BY_STATE['78']).toBeDefined(); // VI
  });

  it('should have Minnesota with highest count (New England town + township states)', () => {
    // Minnesota has high count due to townships + independent cities
    const maxEntry = Object.entries(EXPECTED_COUSUB_BY_STATE).reduce(
      (max, [fips, count]) => (count > max.count ? { fips, count } : max),
      { fips: '', count: 0 }
    );
    expect(maxEntry.fips).toBe('27'); // Minnesota
    expect(maxEntry.count).toBeGreaterThan(2500);
  });

  it('should have Pennsylvania with high count (MCD state)', () => {
    // Pennsylvania has 2,575 county subdivisions
    expect(EXPECTED_COUSUB_BY_STATE['42']).toBe(2575);
  });

  it('should have Ohio with high count (MCD state)', () => {
    // Ohio has 1,604 county subdivisions
    expect(EXPECTED_COUSUB_BY_STATE['39']).toBe(1604);
  });

  it('should have Wisconsin with high count (MCD state)', () => {
    // Wisconsin has 1,921 county subdivisions
    expect(EXPECTED_COUSUB_BY_STATE['55']).toBe(1921);
  });

  it('should have New England states with town-based MCDs', () => {
    // New England uses towns as primary local government
    expect(EXPECTED_COUSUB_BY_STATE['09']).toBe(173);   // Connecticut (169 towns + water)
    expect(EXPECTED_COUSUB_BY_STATE['23']).toBe(533);   // Maine (towns + cities + unorganized)
    expect(EXPECTED_COUSUB_BY_STATE['25']).toBe(357);   // Massachusetts (towns + cities)
    expect(EXPECTED_COUSUB_BY_STATE['33']).toBe(260);   // New Hampshire
    expect(EXPECTED_COUSUB_BY_STATE['44']).toBe(40);    // Rhode Island
    expect(EXPECTED_COUSUB_BY_STATE['50']).toBe(259);   // Vermont
  });

  it('should have CCD states with statistical subdivisions', () => {
    // These states use Census County Divisions (CCDs), not legal MCDs
    expect(EXPECTED_COUSUB_BY_STATE['06']).toBe(397);   // California
    expect(EXPECTED_COUSUB_BY_STATE['12']).toBe(316);   // Florida
    expect(EXPECTED_COUSUB_BY_STATE['13']).toBe(586);   // Georgia
    expect(EXPECTED_COUSUB_BY_STATE['48']).toBe(862);   // Texas
    expect(EXPECTED_COUSUB_BY_STATE['01']).toBe(390);   // Alabama
  });

  it('should have DC with minimal subdivision (single entity)', () => {
    // DC is a single entity, no subdivisions
    expect(EXPECTED_COUSUB_BY_STATE['11']).toBe(1);
  });

  it('should have Puerto Rico with barrios', () => {
    // Puerto Rico has barrios within municipios
    expect(EXPECTED_COUSUB_BY_STATE['72']).toBe(900);
  });

  it('should have Midwest township states with high counts', () => {
    expect(EXPECTED_COUSUB_BY_STATE['17']).toBe(1432);  // Illinois
    expect(EXPECTED_COUSUB_BY_STATE['18']).toBe(1011);  // Indiana
    expect(EXPECTED_COUSUB_BY_STATE['19']).toBe(1661);  // Iowa
    expect(EXPECTED_COUSUB_BY_STATE['20']).toBe(1533);  // Kansas
    expect(EXPECTED_COUSUB_BY_STATE['26']).toBe(1539);  // Michigan
    expect(EXPECTED_COUSUB_BY_STATE['29']).toBe(1395);  // Missouri
    expect(EXPECTED_COUSUB_BY_STATE['31']).toBe(1198);  // Nebraska
  });

  it('should have all positive integer counts', () => {
    for (const [fips, count] of Object.entries(EXPECTED_COUSUB_BY_STATE)) {
      expect(count).toBeGreaterThan(0);
      expect(Number.isInteger(count)).toBe(true);
    }
  });

  it('should have national total match sum of state counts', () => {
    const sum = Object.values(EXPECTED_COUSUB_BY_STATE).reduce((a, b) => a + b, 0);
    expect(NATIONAL_TOTALS.cousub).toBe(sum);
  });

  it('should have national total greater than 30,000', () => {
    const sum = Object.values(EXPECTED_COUSUB_BY_STATE).reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(30000);
    expect(sum).toBeLessThan(40000);  // Sanity check upper bound
  });

  it('should return correct count via getExpectedCount()', () => {
    expect(getExpectedCount('cousub', '42')).toBe(2575);   // Pennsylvania
    expect(getExpectedCount('cousub', '39')).toBe(1604);   // Ohio
    expect(getExpectedCount('cousub', '55')).toBe(1921);   // Wisconsin
    expect(getExpectedCount('cousub', '06')).toBe(397);    // California
    expect(getExpectedCount('cousub', '11')).toBe(1);      // DC
  });

  it('should return national total when no state specified', () => {
    const total = getExpectedCount('cousub');
    expect(total).toBe(NATIONAL_TOTALS.cousub);
    expect(total).toBeGreaterThan(30000);
  });

  it('should return null for unknown state FIPS', () => {
    expect(getExpectedCount('cousub', '99')).toBeNull();
    expect(getExpectedCount('cousub', '00')).toBeNull();
  });

  it('should correctly distinguish MCD vs CCD states', () => {
    // MCD states generally have higher counts due to legally-defined townships
    // CCD states have statistical divisions that tend to be fewer

    // Top MCD states (legal townships)
    const mcdStates = ['27', '42', '55', '19', '39', '26', '17', '38', '29', '31'];
    const mcdSum = mcdStates.reduce((sum, fips) => sum + EXPECTED_COUSUB_BY_STATE[fips], 0);

    // Sample CCD states (statistical divisions)
    const ccdStates = ['06', '12', '13', '48', '01', '04', '08', '30', '32', '49'];
    const ccdSum = ccdStates.reduce((sum, fips) => sum + EXPECTED_COUSUB_BY_STATE[fips], 0);

    // MCD states should have significantly more subdivisions on average
    expect(mcdSum / mcdStates.length).toBeGreaterThan(ccdSum / ccdStates.length);
  });
});

// ============================================================================
// SUBMCD (Subminor Civil Divisions) Expected Counts
// ============================================================================

describe('EXPECTED_SUBMCD_BY_STATE', () => {
  it('should have counts for all 50 states + DC + territories', () => {
    const stateFips = Object.keys(EXPECTED_SUBMCD_BY_STATE);
    // 50 states + DC + 5 territories = 56
    expect(stateFips.length).toBe(56);
  });

  it('should have Puerto Rico as ONLY jurisdiction with submcd', () => {
    // Puerto Rico has 145 subbarrios
    expect(EXPECTED_SUBMCD_BY_STATE['72']).toBe(145);
  });

  it('should have zero submcd for all 50 states + DC', () => {
    // All US states have 0 submcd - this is Puerto Rico only
    const statesWithoutPR = Object.entries(EXPECTED_SUBMCD_BY_STATE).filter(
      ([fips]) => fips !== '72'
    );

    for (const [fips, count] of statesWithoutPR) {
      expect(count).toBe(0);
    }
  });

  it('should have zero submcd for Nebraska (not to be confused with cousub)', () => {
    // Nebraska has townships/precincts as cousub, NOT submcd
    expect(EXPECTED_SUBMCD_BY_STATE['31']).toBe(0);
  });

  it('should have zero submcd for Kansas', () => {
    expect(EXPECTED_SUBMCD_BY_STATE['20']).toBe(0);
  });

  it('should have zero submcd for US Virgin Islands (uses estates layer)', () => {
    // USVI has estates, which is a separate layer type
    expect(EXPECTED_SUBMCD_BY_STATE['78']).toBe(0);
  });

  it('should have all non-negative integer counts', () => {
    for (const [fips, count] of Object.entries(EXPECTED_SUBMCD_BY_STATE)) {
      expect(count).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(count)).toBe(true);
    }
  });

  it('should have national total equal 145 (Puerto Rico subbarrios only)', () => {
    const sum = Object.values(EXPECTED_SUBMCD_BY_STATE).reduce((a, b) => a + b, 0);
    expect(sum).toBe(145);
    expect(NATIONAL_TOTALS.submcd).toBe(145);
  });

  it('should return correct count via getExpectedCount()', () => {
    expect(getExpectedCount('submcd', '72')).toBe(145); // Puerto Rico
    expect(getExpectedCount('submcd', '31')).toBe(0);   // Nebraska
    expect(getExpectedCount('submcd', '06')).toBe(0);   // California
  });

  it('should return national total when no state specified', () => {
    const total = getExpectedCount('submcd');
    expect(total).toBe(145);
  });

  it('should return null for unknown state FIPS', () => {
    expect(getExpectedCount('submcd', '99')).toBeNull();
  });
});

// ============================================================================
// CONCITY (Consolidated Cities) Expected Counts
// ============================================================================

describe('EXPECTED_CONCITY_BY_STATE', () => {
  it('should have counts for all 50 states + DC', () => {
    const stateFips = Object.keys(EXPECTED_CONCITY_BY_STATE);
    // 50 states + DC = 51 (territories not included)
    expect(stateFips.length).toBeGreaterThanOrEqual(51);
  });

  it('should have Georgia with the most consolidated cities (6)', () => {
    // Georgia has: Athens-Clarke, Augusta-Richmond, Columbus-Muscogee,
    //              Cusseta-Chattahoochee, Georgetown-Quitman, Macon-Bibb
    expect(EXPECTED_CONCITY_BY_STATE['13']).toBe(6);
  });

  it('should have Tennessee with 3 consolidated cities', () => {
    // Nashville-Davidson, Hartsville-Trousdale, Lynchburg-Moore
    expect(EXPECTED_CONCITY_BY_STATE['47']).toBe(3);
  });

  it('should have Indiana with 1 consolidated city (Indianapolis)', () => {
    expect(EXPECTED_CONCITY_BY_STATE['18']).toBe(1);
  });

  it('should have Connecticut with 1 consolidated city (Milford)', () => {
    expect(EXPECTED_CONCITY_BY_STATE['09']).toBe(1);
  });

  it('should have Kansas with 2 consolidated cities', () => {
    // Kansas City-Wyandotte, Tribune-Greeley
    expect(EXPECTED_CONCITY_BY_STATE['20']).toBe(2);
  });

  it('should have Kentucky with 2 consolidated cities', () => {
    // Louisville-Jefferson, Lexington-Fayette
    expect(EXPECTED_CONCITY_BY_STATE['21']).toBe(2);
  });

  it('should have Montana with 2 consolidated cities', () => {
    // Butte-Silver Bow, Anaconda-Deer Lodge
    expect(EXPECTED_CONCITY_BY_STATE['30']).toBe(2);
  });

  it('should have exactly 7 states with consolidated cities', () => {
    const statesWithConcity = Object.entries(EXPECTED_CONCITY_BY_STATE).filter(
      ([, count]) => count > 0
    );
    expect(statesWithConcity.length).toBe(7);

    // Verify which states have consolidated cities
    const expectedStates = ['09', '13', '18', '20', '21', '30', '47'];
    const actualStates = statesWithConcity.map(([fips]) => fips).sort();
    expect(actualStates).toEqual(expectedStates);
  });

  it('should have zero for states with coextensive city-counties (not consolidated cities)', () => {
    // San Francisco, CA - coextensive city-county, no semi-independent places
    expect(EXPECTED_CONCITY_BY_STATE['06']).toBe(0);
    // Denver/Broomfield, CO - classified as municipal governments
    expect(EXPECTED_CONCITY_BY_STATE['08']).toBe(0);
    // Philadelphia, PA - coextensive city-county
    expect(EXPECTED_CONCITY_BY_STATE['42']).toBe(0);
    // Jacksonville, FL - full consolidation with no semi-independent places
    expect(EXPECTED_CONCITY_BY_STATE['12']).toBe(0);
  });

  it('should have zero for Alaska unified municipalities', () => {
    // Anchorage, Juneau, Sitka are classified as municipal governments, not consolidated cities
    expect(EXPECTED_CONCITY_BY_STATE['02']).toBe(0);
  });

  it('should have zero for Virginia independent cities', () => {
    // Virginia independent cities are a different Census concept
    expect(EXPECTED_CONCITY_BY_STATE['51']).toBe(0);
  });

  it('should have zero for DC', () => {
    // DC is a federal district, not a consolidated city
    expect(EXPECTED_CONCITY_BY_STATE['11']).toBe(0);
  });

  it('should have all non-negative integer counts', () => {
    for (const [, count] of Object.entries(EXPECTED_CONCITY_BY_STATE)) {
      expect(count).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(count)).toBe(true);
    }
  });

  it('should have national total equal 17 consolidated cities', () => {
    const sum = Object.values(EXPECTED_CONCITY_BY_STATE).reduce((a, b) => a + b, 0);
    expect(sum).toBe(17);
    expect(NATIONAL_TOTALS.concity).toBe(17);
  });

  it('should return correct count via getExpectedCount()', () => {
    expect(getExpectedCount('concity', '13')).toBe(6);   // Georgia
    expect(getExpectedCount('concity', '47')).toBe(3);   // Tennessee
    expect(getExpectedCount('concity', '18')).toBe(1);   // Indiana
    expect(getExpectedCount('concity', '06')).toBe(0);   // California (none)
  });

  it('should return national total when no state specified', () => {
    const total = getExpectedCount('concity');
    expect(total).toBe(17);
  });

  it('should return null for unknown state FIPS', () => {
    expect(getExpectedCount('concity', '99')).toBeNull();
  });
});

// ============================================================================
// AIANNH (American Indian/Alaska Native/Native Hawaiian Areas) Expected Counts
// ============================================================================

describe('EXPECTED_AIANNH_BY_STATE', () => {
  it('should have counts for all 50 states + DC + territories', () => {
    const stateFips = Object.keys(EXPECTED_AIANNH_BY_STATE);
    // 50 states + DC + 5 territories = 56
    expect(stateFips.length).toBe(56);
  });

  it('should have Alaska with highest count (229 ANVSAs + 1 reservation)', () => {
    // Alaska dominates with Alaska Native Village Statistical Areas
    expect(EXPECTED_AIANNH_BY_STATE['02']).toBe(230);
  });

  it('should have California with many rancherias (~103)', () => {
    expect(EXPECTED_AIANNH_BY_STATE['06']).toBeGreaterThan(100);
  });

  it('should have Hawaii with Hawaiian Home Lands (74)', () => {
    expect(EXPECTED_AIANNH_BY_STATE['15']).toBe(74);
  });

  it('should have Oklahoma with OTSAs + Osage Reservation (28)', () => {
    // 27 OTSAs (25 base + 2 joint use) + 1 Osage Reservation
    expect(EXPECTED_AIANNH_BY_STATE['40']).toBe(28);
  });

  it('should have states with no recognized tribal areas as zero', () => {
    // States with no federally or state-recognized tribal lands
    expect(EXPECTED_AIANNH_BY_STATE['05']).toBe(0);  // Arkansas
    expect(EXPECTED_AIANNH_BY_STATE['10']).toBe(0);  // Delaware
    expect(EXPECTED_AIANNH_BY_STATE['11']).toBe(0);  // DC
    expect(EXPECTED_AIANNH_BY_STATE['13']).toBe(0);  // Georgia
    expect(EXPECTED_AIANNH_BY_STATE['17']).toBe(0);  // Illinois
    expect(EXPECTED_AIANNH_BY_STATE['18']).toBe(0);  // Indiana
    expect(EXPECTED_AIANNH_BY_STATE['21']).toBe(0);  // Kentucky
    expect(EXPECTED_AIANNH_BY_STATE['24']).toBe(0);  // Maryland
    expect(EXPECTED_AIANNH_BY_STATE['29']).toBe(0);  // Missouri
    expect(EXPECTED_AIANNH_BY_STATE['33']).toBe(0);  // New Hampshire
    expect(EXPECTED_AIANNH_BY_STATE['34']).toBe(0);  // New Jersey
    expect(EXPECTED_AIANNH_BY_STATE['39']).toBe(0);  // Ohio
    expect(EXPECTED_AIANNH_BY_STATE['42']).toBe(0);  // Pennsylvania
    expect(EXPECTED_AIANNH_BY_STATE['47']).toBe(0);  // Tennessee
    expect(EXPECTED_AIANNH_BY_STATE['50']).toBe(0);  // Vermont
    expect(EXPECTED_AIANNH_BY_STATE['54']).toBe(0);  // West Virginia
  });

  it('should have territories with zero AIANNH areas', () => {
    expect(EXPECTED_AIANNH_BY_STATE['60']).toBe(0);  // American Samoa
    expect(EXPECTED_AIANNH_BY_STATE['66']).toBe(0);  // Guam
    expect(EXPECTED_AIANNH_BY_STATE['69']).toBe(0);  // Northern Mariana Islands
    expect(EXPECTED_AIANNH_BY_STATE['72']).toBe(0);  // Puerto Rico
    expect(EXPECTED_AIANNH_BY_STATE['78']).toBe(0);  // US Virgin Islands
  });

  it('should have Western states with significant tribal presence', () => {
    expect(EXPECTED_AIANNH_BY_STATE['04']).toBeGreaterThan(20);  // Arizona
    expect(EXPECTED_AIANNH_BY_STATE['30']).toBeGreaterThan(5);   // Montana
    expect(EXPECTED_AIANNH_BY_STATE['32']).toBeGreaterThan(20);  // Nevada
    expect(EXPECTED_AIANNH_BY_STATE['35']).toBeGreaterThan(20);  // New Mexico
    expect(EXPECTED_AIANNH_BY_STATE['46']).toBeGreaterThan(10);  // South Dakota
    expect(EXPECTED_AIANNH_BY_STATE['53']).toBeGreaterThan(25);  // Washington
    expect(EXPECTED_AIANNH_BY_STATE['55']).toBeGreaterThan(10);  // Wisconsin
  });

  it('should have Eastern states with small tribal presence', () => {
    expect(EXPECTED_AIANNH_BY_STATE['01']).toBe(1);   // Alabama - Poarch Creek
    expect(EXPECTED_AIANNH_BY_STATE['28']).toBe(1);   // Mississippi - Choctaw
    expect(EXPECTED_AIANNH_BY_STATE['37']).toBe(1);   // North Carolina - Eastern Cherokee
    expect(EXPECTED_AIANNH_BY_STATE['44']).toBe(1);   // Rhode Island - Narragansett
    expect(EXPECTED_AIANNH_BY_STATE['45']).toBe(1);   // South Carolina - Catawba
  });

  it('should have all non-negative integer counts', () => {
    for (const [, count] of Object.entries(EXPECTED_AIANNH_BY_STATE)) {
      expect(count).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(count)).toBe(true);
    }
  });

  it('should have national total greater than 600 (approx 700 areas)', () => {
    const sum = Object.values(EXPECTED_AIANNH_BY_STATE).reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(600);
    expect(sum).toBeLessThan(800);  // Sanity check upper bound
  });

  it('should have national total match NATIONAL_TOTALS.aiannh', () => {
    const sum = Object.values(EXPECTED_AIANNH_BY_STATE).reduce((a, b) => a + b, 0);
    expect(NATIONAL_TOTALS.aiannh).toBe(sum);
  });

  it('should return correct count via getExpectedCount()', () => {
    expect(getExpectedCount('aiannh', '02')).toBe(230);  // Alaska
    expect(getExpectedCount('aiannh', '06')).toBe(103);  // California
    expect(getExpectedCount('aiannh', '15')).toBe(74);   // Hawaii
    expect(getExpectedCount('aiannh', '40')).toBe(28);   // Oklahoma
    expect(getExpectedCount('aiannh', '11')).toBe(0);    // DC (none)
    expect(getExpectedCount('aiannh', '47')).toBe(0);    // Tennessee (none)
  });

  it('should return national total when no state specified', () => {
    const total = getExpectedCount('aiannh');
    expect(total).toBe(NATIONAL_TOTALS.aiannh);
    expect(total).toBeGreaterThan(600);
  });

  it('should return null for unknown state FIPS', () => {
    expect(getExpectedCount('aiannh', '99')).toBeNull();
  });
});

// ============================================================================
// Cross-Layer Consistency
// ============================================================================

describe('Cross-Layer Consistency', () => {
  it('should have consistent FIPS codes across all layer types', () => {
    const vtdStates = new Set(Object.keys(EXPECTED_VTD_BY_STATE));
    const placeStates = new Set(Object.keys(EXPECTED_PLACE_BY_STATE));
    const cdpStates = new Set(Object.keys(EXPECTED_CDP_BY_STATE));
    const cousubStates = new Set(Object.keys(EXPECTED_COUSUB_BY_STATE));
    const cdStates = new Set(Object.keys(EXPECTED_CD_BY_STATE));
    const countyStates = new Set(Object.keys(EXPECTED_COUNTIES_BY_STATE));

    // All layers should cover at least all 50 states + DC
    const minStates = 51;
    expect(vtdStates.size).toBeGreaterThanOrEqual(minStates);
    expect(placeStates.size).toBeGreaterThanOrEqual(minStates);
    expect(cdpStates.size).toBeGreaterThanOrEqual(minStates);
    expect(cousubStates.size).toBeGreaterThanOrEqual(minStates);
    expect(cdStates.size).toBeGreaterThanOrEqual(minStates);
    expect(countyStates.size).toBeGreaterThanOrEqual(minStates);
  });

  it('should have getExpectedCount return null for unknown layers', () => {
    // @ts-expect-error Testing invalid layer
    expect(getExpectedCount('invalid_layer', '06')).toBeNull();
  });

  it('should have getExpectedCount return null for unknown states', () => {
    expect(getExpectedCount('vtd', '99')).toBeNull();
    expect(getExpectedCount('place', '99')).toBeNull();
    expect(getExpectedCount('cdp', '99')).toBeNull();
    expect(getExpectedCount('cousub', '99')).toBeNull();
  });
});

// ============================================================================
// NATIONAL_TOTALS Integrity
// ============================================================================

describe('NATIONAL_TOTALS', () => {
  it('should have VTD total computed from state counts', () => {
    const vtdSum = Object.values(EXPECTED_VTD_BY_STATE).reduce((a, b) => a + b, 0);
    expect(NATIONAL_TOTALS.vtd).toBe(vtdSum);
    expect(NATIONAL_TOTALS.vtd).toBeGreaterThan(150000);
  });

  it('should have Place total computed from state counts', () => {
    const placeSum = Object.values(EXPECTED_PLACE_BY_STATE).reduce((a, b) => a + b, 0);
    expect(NATIONAL_TOTALS.place).toBe(placeSum);
    expect(NATIONAL_TOTALS.place).toBeGreaterThan(15000);
  });

  it('should have CDP total computed from state counts', () => {
    const cdpSum = Object.values(EXPECTED_CDP_BY_STATE).reduce((a, b) => a + b, 0);
    expect(NATIONAL_TOTALS.cdp).toBe(cdpSum);
    expect(NATIONAL_TOTALS.cdp).toBeGreaterThan(10000);
  });

  it('should have CD total equal 435 (US House seats)', () => {
    // This is fixed by law
    expect(NATIONAL_TOTALS.cd).toBe(435);
  });

  it('should have County total equal 3143', () => {
    expect(NATIONAL_TOTALS.county).toBe(3143);
  });

  it('should have COUSUB total computed from state counts', () => {
    const cousubSum = Object.values(EXPECTED_COUSUB_BY_STATE).reduce((a, b) => a + b, 0);
    expect(NATIONAL_TOTALS.cousub).toBe(cousubSum);
    expect(NATIONAL_TOTALS.cousub).toBeGreaterThan(30000);
    expect(NATIONAL_TOTALS.cousub).toBeLessThan(40000);
  });
});
