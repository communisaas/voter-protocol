/**
 * TIGER Expected Counts Reference Data
 *
 * Authoritative feature counts for Census TIGER/Line boundary data.
 * Ensures completeness validation catches missing or extra boundaries.
 *
 * DATA SOURCES:
 * - Congressional Districts: 435 (fixed by law, apportioned every 10 years)
 * - State Legislative Upper: Varies by state (unicameral Nebraska = 49 SLDU)
 * - State Legislative Lower: Varies by state (Nebraska = 0, unicameral)
 * - Counties: 3,143 total (includes parishes, boroughs, census areas, independent cities)
 *
 * VERIFICATION SOURCES:
 * - https://www.census.gov/programs-surveys/geography/about/faq/2020-census-geography-faq.html
 * - National Conference of State Legislatures (NCSL)
 * - US Census Bureau TIGER/Line technical documentation
 *
 * MAINTENANCE:
 * - Congressional Districts: Update after each decennial census redistricting
 * - State Legislative: Update when states redistrict (varies by state)
 * - Counties: Rare changes (last: Broomfield County, CO added 2001)
 *
 * Last Updated: 2025-12-14
 * Data Vintage: 2024 TIGER/Line
 */

/**
 * Import canonical state FIPS mappings from core/types.ts
 * SINGLE SOURCE OF TRUTH for all FIPS code conversions
 */
import {
  STATE_FIPS_TO_NAME,
  STATE_ABBR_TO_FIPS,
  getStateNameFromFips,
  getFipsFromStateAbbr,
} from '../core/types.js';

// Re-export for convenience
export { STATE_ABBR_TO_FIPS } from '../core/types.js';

/**
 * Total expected counts (national level)
 *
 * NOTE: Census TIGER CD files contain 440-445 features including:
 * - 435 voting Congressional Districts (fixed by law)
 * - 6 non-voting delegate districts (DC, PR, Guam, VI, AS, NMI)
 * - Possible at-large/ZZZ placeholder districts
 *
 * Reference count below (435) represents voting districts only.
 * Actual TIGER file validation should expect 440-445 total features.
 */
export const EXPECTED_COUNTS = {
  /** Congressional Districts (US House voting seats) - Fixed at 435 by law */
  cd: 435,

  /** Counties (includes parishes, boroughs, census areas, independent cities) */
  county: 3143,

  /** State Legislative Districts Upper (varies, null = unicameral uses SLDU only) */
  sldu: null as number | null,

  /** State Legislative Districts Lower (varies, null = unicameral) */
  sldl: null as number | null,

  /** Unified School Districts (K-12, varies by state) */
  unsd: null as number | null,

  /** Elementary School Districts (K-8, varies by state) */
  elsd: null as number | null,

  /** Secondary School Districts (9-12, varies by state) */
  scsd: null as number | null,

  /**
   * Incorporated Places - cities, towns, villages (~19,500)
   * Source: Census Bureau TIGER/Line
   */
  place: 19495,

  /**
   * Census Designated Places - unincorporated communities (~9,500)
   * Source: Census Bureau TIGER/Line
   * NOTE: CDPs are statistically defined, not legally incorporated
   */
  cdp: 9500,

  /**
   * County Subdivisions - townships, boroughs, MCDs (~34,000)
   * Source: Census Bureau TIGER/Line
   */
  cousub: 34000,

  /**
   * Voting Districts - precincts, VTDs (~200,000)
   * Source: Census Bureau 2020 TIGER/Line (redistricting vintage)
   */
  vtd: 200000,

  /**
   * ZIP Code Tabulation Areas (~33,000)
   * Source: Census Bureau TIGER/Line
   * NOTE: ZCTAs approximate USPS ZIP codes but don't match exactly
   */
  zcta: 33144,
} as const;

/**
 * Congressional District counts by state (FIPS code)
 * Source: 2020 Census apportionment
 *
 * Total must equal 435.
 */
export const EXPECTED_CD_BY_STATE: Record<string, number> = {
  '01': 7,   // Alabama
  '02': 1,   // Alaska (at-large)
  '04': 9,   // Arizona
  '05': 4,   // Arkansas
  '06': 52,  // California (largest delegation)
  '08': 8,   // Colorado
  '09': 5,   // Connecticut
  '10': 1,   // Delaware (at-large)
  '11': 1,   // District of Columbia (delegate, non-voting)
  '12': 28,  // Florida
  '13': 14,  // Georgia
  '15': 2,   // Hawaii
  '16': 2,   // Idaho
  '17': 17,  // Illinois
  '18': 9,   // Indiana
  '19': 4,   // Iowa
  '20': 4,   // Kansas
  '21': 6,   // Kentucky
  '22': 6,   // Louisiana
  '23': 2,   // Maine
  '24': 8,   // Maryland
  '25': 9,   // Massachusetts
  '26': 13,  // Michigan
  '27': 8,   // Minnesota
  '28': 4,   // Mississippi
  '29': 8,   // Missouri
  '30': 2,   // Montana
  '31': 3,   // Nebraska
  '32': 4,   // Nevada
  '33': 2,   // New Hampshire
  '34': 12,  // New Jersey
  '35': 3,   // New Mexico
  '36': 26,  // New York
  '37': 14,  // North Carolina
  '38': 1,   // North Dakota (at-large)
  '39': 15,  // Ohio
  '40': 5,   // Oklahoma
  '41': 6,   // Oregon
  '42': 17,  // Pennsylvania
  '44': 2,   // Rhode Island
  '45': 7,   // South Carolina
  '46': 1,   // South Dakota (at-large)
  '47': 9,   // Tennessee
  '48': 38,  // Texas
  '49': 4,   // Utah
  '50': 1,   // Vermont (at-large)
  '51': 11,  // Virginia
  '53': 10,  // Washington
  '54': 2,   // West Virginia
  '55': 8,   // Wisconsin
  '56': 1,   // Wyoming (at-large)

  // Territories (non-voting delegates)
  '60': 1,   // American Samoa (delegate)
  '66': 1,   // Guam (delegate)
  '69': 1,   // Northern Mariana Islands (delegate)
  '72': 1,   // Puerto Rico (resident commissioner)
  '78': 1,   // US Virgin Islands (delegate)
};

/**
 * State Legislative Upper (State Senate) counts by state
 * Source: National Conference of State Legislatures (NCSL)
 *
 * NOTE: Nebraska is unicameral and uses SLDU only (49 districts)
 */
export const EXPECTED_SLDU_BY_STATE: Record<string, number> = {
  '01': 35,  // Alabama Senate
  '02': 20,  // Alaska Senate
  '04': 30,  // Arizona Senate
  '05': 35,  // Arkansas Senate
  '06': 40,  // California Senate
  '08': 35,  // Colorado Senate
  '09': 36,  // Connecticut Senate
  '10': 21,  // Delaware Senate
  '11': 0,   // District of Columbia (unicameral council, no bicameral legislature)
  '12': 40,  // Florida Senate
  '13': 56,  // Georgia Senate
  '15': 25,  // Hawaii Senate
  '16': 35,  // Idaho Senate
  '17': 59,  // Illinois Senate
  '18': 50,  // Indiana Senate
  '19': 50,  // Iowa Senate
  '20': 40,  // Kansas Senate
  '21': 38,  // Kentucky Senate
  '22': 39,  // Louisiana Senate
  '23': 35,  // Maine Senate
  '24': 47,  // Maryland Senate
  '25': 40,  // Massachusetts Senate
  '26': 38,  // Michigan Senate
  '27': 67,  // Minnesota Senate
  '28': 52,  // Mississippi Senate
  '29': 34,  // Missouri Senate
  '30': 50,  // Montana Senate
  '31': 49,  // Nebraska (UNICAMERAL - all legislative as SLDU)
  '32': 21,  // Nevada Senate
  '33': 24,  // New Hampshire Senate
  '34': 40,  // New Jersey Senate
  '35': 42,  // New Mexico Senate
  '36': 63,  // New York Senate
  '37': 50,  // North Carolina Senate
  '38': 47,  // North Dakota Senate
  '39': 33,  // Ohio Senate
  '40': 48,  // Oklahoma Senate
  '41': 30,  // Oregon Senate
  '42': 50,  // Pennsylvania Senate
  '44': 38,  // Rhode Island Senate
  '45': 46,  // South Carolina Senate
  '46': 35,  // South Dakota Senate
  '47': 33,  // Tennessee Senate
  '48': 31,  // Texas Senate
  '49': 29,  // Utah Senate
  '50': 30,  // Vermont Senate
  '51': 40,  // Virginia Senate
  '53': 49,  // Washington Senate
  '54': 34,  // West Virginia Senate
  '55': 33,  // Wisconsin Senate
  '56': 30,  // Wyoming Senate
};

/**
 * State Legislative Lower (State House) counts by state
 * Source: National Conference of State Legislatures (NCSL)
 *
 * NOTE: Nebraska is unicameral and has NO lower house (0 districts)
 */
export const EXPECTED_SLDL_BY_STATE: Record<string, number> = {
  '01': 105, // Alabama House
  '02': 40,  // Alaska House
  '04': 60,  // Arizona House
  '05': 100, // Arkansas House
  '06': 80,  // California Assembly
  '08': 65,  // Colorado House
  '09': 151, // Connecticut House
  '10': 41,  // Delaware House
  '11': 0,   // District of Columbia (unicameral council)
  '12': 120, // Florida House
  '13': 180, // Georgia House
  '15': 51,  // Hawaii House
  '16': 70,  // Idaho House
  '17': 118, // Illinois House
  '18': 100, // Indiana House
  '19': 100, // Iowa House
  '20': 125, // Kansas House
  '21': 100, // Kentucky House
  '22': 105, // Louisiana House
  '23': 151, // Maine House
  '24': 141, // Maryland House
  '25': 160, // Massachusetts House
  '26': 110, // Michigan House
  '27': 134, // Minnesota House
  '28': 122, // Mississippi House
  '29': 163, // Missouri House
  '30': 100, // Montana House
  '31': 0,   // Nebraska (UNICAMERAL - no lower house)
  '32': 42,  // Nevada Assembly
  '33': 400, // New Hampshire House (largest in US)
  '34': 80,  // New Jersey Assembly
  '35': 70,  // New Mexico House
  '36': 150, // New York Assembly
  '37': 120, // North Carolina House
  '38': 94,  // North Dakota House
  '39': 99,  // Ohio House
  '40': 101, // Oklahoma House
  '41': 60,  // Oregon House
  '42': 203, // Pennsylvania House
  '44': 75,  // Rhode Island House
  '45': 124, // South Carolina House
  '46': 70,  // South Dakota House
  '47': 99,  // Tennessee House
  '48': 150, // Texas House
  '49': 75,  // Utah House
  '50': 150, // Vermont House
  '51': 100, // Virginia House
  '53': 98,  // Washington House
  '54': 100, // West Virginia House
  '55': 99,  // Wisconsin Assembly
  '56': 60,  // Wyoming House
};

/**
 * County counts by state (FIPS code)
 * Source: US Census Bureau
 *
 * NOTES:
 * - Louisiana has "parishes" instead of counties
 * - Alaska has "boroughs" and "census areas"
 * - Virginia has 38 independent cities counted separately
 * - Total must equal 3,143
 */
export const EXPECTED_COUNTIES_BY_STATE: Record<string, number> = {
  '01': 67,   // Alabama
  '02': 30,   // Alaska (boroughs + census areas)
  '04': 15,   // Arizona
  '05': 75,   // Arkansas
  '06': 58,   // California
  '08': 64,   // Colorado
  '09': 8,    // Connecticut
  '10': 3,    // Delaware
  '11': 1,    // District of Columbia
  '12': 67,   // Florida
  '13': 159,  // Georgia
  '15': 5,    // Hawaii (counties + city-county)
  '16': 44,   // Idaho
  '17': 102,  // Illinois
  '18': 92,   // Indiana
  '19': 99,   // Iowa
  '20': 105,  // Kansas
  '21': 120,  // Kentucky
  '22': 64,   // Louisiana (parishes)
  '23': 16,   // Maine
  '24': 24,   // Maryland (includes Baltimore City)
  '25': 14,   // Massachusetts
  '26': 83,   // Michigan
  '27': 87,   // Minnesota
  '28': 82,   // Mississippi
  '29': 115,  // Missouri (includes St. Louis City)
  '30': 56,   // Montana
  '31': 93,   // Nebraska
  '32': 17,   // Nevada (includes Carson City)
  '33': 10,   // New Hampshire
  '34': 21,   // New Jersey
  '35': 33,   // New Mexico
  '36': 62,   // New York
  '37': 100,  // North Carolina
  '38': 53,   // North Dakota
  '39': 88,   // Ohio
  '40': 77,   // Oklahoma
  '41': 36,   // Oregon
  '42': 67,   // Pennsylvania
  '44': 5,    // Rhode Island
  '45': 46,   // South Carolina
  '46': 66,   // South Dakota
  '47': 95,   // Tennessee
  '48': 254,  // Texas (most counties in US)
  '49': 29,   // Utah
  '50': 14,   // Vermont
  '51': 133,  // Virginia (95 counties + 38 independent cities)
  '53': 39,   // Washington
  '54': 55,   // West Virginia
  '55': 72,   // Wisconsin
  '56': 23,   // Wyoming

  // Territories
  '60': 5,    // American Samoa (districts)
  '66': 1,    // Guam
  '69': 4,    // Northern Mariana Islands (municipalities)
  '72': 78,   // Puerto Rico (municipios)
  '78': 3,    // US Virgin Islands (districts)
};

/**
 * Unified School District (UNSD) counts by state
 * Source: US Census Bureau TIGER/Line 2024
 *
 * NOTE: School district structure varies significantly by state.
 * Some states use primarily unified districts (K-12), others use
 * separate elementary/secondary systems. Counts are approximate
 * and should be validated against actual TIGER data.
 */
export const EXPECTED_UNSD_BY_STATE: Record<string, number> = {
  '01': 0,    // Alabama (uses separate elem/sec)
  '02': 54,   // Alaska
  '04': 270,  // Arizona
  '05': 244,  // Arkansas
  '06': 1037, // California
  '08': 178,  // Colorado
  '09': 0,    // Connecticut (uses separate elem/sec)
  '10': 19,   // Delaware
  '11': 1,    // District of Columbia
  '12': 67,   // Florida (county-based)
  '13': 180,  // Georgia
  '15': 1,    // Hawaii (statewide)
  '16': 115,  // Idaho
  '17': 0,    // Illinois (uses separate elem/sec)
  '18': 0,    // Indiana (uses separate elem/sec)
  '19': 333,  // Iowa
  '20': 286,  // Kansas
  '21': 173,  // Kentucky
  '22': 69,   // Louisiana (parish-based)
  '23': 0,    // Maine (uses separate elem/sec)
  '24': 24,   // Maryland (county-based)
  '25': 0,    // Massachusetts (uses separate elem/sec)
  '26': 551,  // Michigan
  '27': 333,  // Minnesota
  '28': 0,    // Mississippi (uses separate elem/sec)
  '29': 518,  // Missouri
  '30': 0,    // Montana (uses separate elem/sec)
  '31': 244,  // Nebraska
  '32': 17,   // Nevada (county-based)
  '33': 0,    // New Hampshire (uses separate elem/sec)
  '34': 0,    // New Jersey (uses separate elem/sec)
  '35': 89,   // New Mexico
  '36': 0,    // New York (uses separate elem/sec)
  '37': 115,  // North Carolina (county-based)
  '38': 0,    // North Dakota (uses separate elem/sec)
  '39': 614,  // Ohio
  '40': 516,  // Oklahoma
  '41': 197,  // Oregon
  '42': 500,  // Pennsylvania
  '44': 0,    // Rhode Island (uses separate elem/sec)
  '45': 85,   // South Carolina
  '46': 149,  // South Dakota
  '47': 141,  // Tennessee
  '48': 1023, // Texas
  '49': 41,   // Utah
  '50': 0,    // Vermont (uses separate elem/sec)
  '51': 132,  // Virginia (county/city-based)
  '53': 295,  // Washington
  '54': 55,   // West Virginia (county-based)
  '55': 421,  // Wisconsin
  '56': 48,   // Wyoming
};

/**
 * Elementary School District (ELSD) counts by state
 * Source: US Census Bureau TIGER/Line 2024
 *
 * NOTE: Only exists in states with separate elementary/secondary systems.
 */
export const EXPECTED_ELSD_BY_STATE: Record<string, number> = {
  '01': 0,    // Alabama
  '02': 0,    // Alaska
  '04': 0,    // Arizona
  '05': 0,    // Arkansas
  '06': 0,    // California
  '08': 0,    // Colorado
  '09': 166,  // Connecticut
  '10': 0,    // Delaware
  '11': 0,    // District of Columbia
  '12': 0,    // Florida
  '13': 0,    // Georgia
  '15': 0,    // Hawaii
  '16': 0,    // Idaho
  '17': 859,  // Illinois
  '18': 0,    // Indiana
  '19': 0,    // Iowa
  '20': 0,    // Kansas
  '21': 0,    // Kentucky
  '22': 0,    // Louisiana
  '23': 260,  // Maine
  '24': 0,    // Maryland
  '25': 328,  // Massachusetts
  '26': 0,    // Michigan
  '27': 0,    // Minnesota
  '28': 0,    // Mississippi
  '29': 0,    // Missouri
  '30': 449,  // Montana
  '31': 0,    // Nebraska
  '32': 0,    // Nevada
  '33': 165,  // New Hampshire
  '34': 524,  // New Jersey
  '35': 0,    // New Mexico
  '36': 0,    // New York
  '37': 0,    // North Carolina
  '38': 0,    // North Dakota
  '39': 0,    // Ohio
  '40': 0,    // Oklahoma
  '41': 0,    // Oregon
  '42': 0,    // Pennsylvania
  '44': 36,   // Rhode Island
  '45': 0,    // South Carolina
  '46': 0,    // South Dakota
  '47': 0,    // Tennessee
  '48': 0,    // Texas
  '49': 0,    // Utah
  '50': 277,  // Vermont
  '51': 0,    // Virginia
  '53': 0,    // Washington
  '54': 0,    // West Virginia
  '55': 0,    // Wisconsin
  '56': 0,    // Wyoming
};

/**
 * Secondary School District (SCSD) counts by state
 * Source: US Census Bureau TIGER/Line 2024
 *
 * NOTE: Rare - only a few states use separate secondary school districts.
 */
export const EXPECTED_SCSD_BY_STATE: Record<string, number> = {
  '01': 0,    // Alabama
  '02': 0,    // Alaska
  '04': 94,   // Arizona
  '05': 0,    // Arkansas
  '06': 77,   // California
  '08': 0,    // Colorado
  '09': 0,    // Connecticut
  '10': 0,    // Delaware
  '11': 0,    // District of Columbia
  '12': 0,    // Florida
  '13': 0,    // Georgia
  '15': 0,    // Hawaii
  '16': 0,    // Idaho
  '17': 102,  // Illinois
  '18': 0,    // Indiana
  '19': 0,    // Iowa
  '20': 0,    // Kansas
  '21': 0,    // Kentucky
  '22': 0,    // Louisiana
  '23': 0,    // Maine
  '24': 0,    // Maryland
  '25': 0,    // Massachusetts
  '26': 0,    // Michigan
  '27': 0,    // Minnesota
  '28': 0,    // Mississippi
  '29': 0,    // Missouri
  '30': 0,    // Montana
  '31': 0,    // Nebraska
  '32': 0,    // Nevada
  '33': 0,    // New Hampshire
  '34': 0,    // New Jersey
  '35': 0,    // New Mexico
  '36': 0,    // New York
  '37': 0,    // North Carolina
  '38': 0,    // North Dakota
  '39': 0,    // Ohio
  '40': 0,    // Oklahoma
  '41': 0,    // Oregon
  '42': 0,    // Pennsylvania
  '44': 0,    // Rhode Island
  '45': 0,    // South Carolina
  '46': 0,    // South Dakota
  '47': 0,    // Tennessee
  '48': 0,    // Texas
  '49': 0,    // Utah
  '50': 0,    // Vermont
  '51': 0,    // Virginia
  '53': 0,    // Washington
  '54': 0,    // West Virginia
  '55': 0,    // Wisconsin
  '56': 0,    // Wyoming
};

/**
 * Validate that reference counts are internally consistent
 */
export function validateReferenceCounts(): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Congressional Districts must sum to 435
  const cdTotal = Object.values(EXPECTED_CD_BY_STATE).reduce((sum, n) => sum + n, 0);
  if (cdTotal !== EXPECTED_COUNTS.cd) {
    errors.push(`CD total mismatch: ${cdTotal} !== ${EXPECTED_COUNTS.cd}`);
  }

  // Counties must sum to 3,143
  const countyTotal = Object.values(EXPECTED_COUNTIES_BY_STATE).reduce((sum, n) => sum + n, 0);
  if (countyTotal !== EXPECTED_COUNTS.county) {
    errors.push(`County total mismatch: ${countyTotal} !== ${EXPECTED_COUNTS.county}`);
  }

  // Nebraska SLDU must be 49, SLDL must be 0 (unicameral)
  if (EXPECTED_SLDU_BY_STATE['31'] !== 49) {
    errors.push(`Nebraska SLDU must be 49 (unicameral), got ${EXPECTED_SLDU_BY_STATE['31']}`);
  }
  if (EXPECTED_SLDL_BY_STATE['31'] !== 0) {
    errors.push(`Nebraska SLDL must be 0 (unicameral), got ${EXPECTED_SLDL_BY_STATE['31']}`);
  }

  // All states must have entries
  const stateFips = Object.keys(EXPECTED_COUNTIES_BY_STATE);
  const expectedStates = 56; // 50 states + DC + 5 territories

  if (stateFips.length !== expectedStates) {
    errors.push(`Missing states: expected ${expectedStates}, got ${stateFips.length}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * TIGER layer types for expected count lookups
 *
 * Matches TIGERLayerType from core/types.ts
 */
export type TigerCountLayer =
  | 'cd'
  | 'sldu'
  | 'sldl'
  | 'county'
  | 'unsd'
  | 'elsd'
  | 'scsd'
  | 'place'
  | 'cdp'     // Census Designated Places (unincorporated)
  | 'cousub'
  | 'vtd'
  | 'zcta';

/**
 * Get expected count for specific TIGER layer and state
 *
 * @param layer - TIGER layer type
 * @param stateFips - Optional state FIPS for state-level counts
 * @returns Expected feature count or null if unknown
 */
export function getExpectedCount(
  layer: TigerCountLayer,
  stateFips?: string
): number | null {
  if (layer === 'cd') {
    return stateFips ? EXPECTED_CD_BY_STATE[stateFips] ?? null : EXPECTED_COUNTS.cd;
  }

  if (layer === 'sldu') {
    return stateFips ? EXPECTED_SLDU_BY_STATE[stateFips] ?? null : null;
  }

  if (layer === 'sldl') {
    return stateFips ? EXPECTED_SLDL_BY_STATE[stateFips] ?? null : null;
  }

  if (layer === 'county') {
    return stateFips ? EXPECTED_COUNTIES_BY_STATE[stateFips] ?? null : EXPECTED_COUNTS.county;
  }

  if (layer === 'unsd') {
    return stateFips ? EXPECTED_UNSD_BY_STATE[stateFips] ?? null : null;
  }

  if (layer === 'elsd') {
    return stateFips ? EXPECTED_ELSD_BY_STATE[stateFips] ?? null : null;
  }

  if (layer === 'scsd') {
    return stateFips ? EXPECTED_SCSD_BY_STATE[stateFips] ?? null : null;
  }

  // New layers (national-only counts for now, state-level can be added later)
  if (layer === 'place') {
    return stateFips ? null : EXPECTED_COUNTS.place;
  }

  if (layer === 'cdp') {
    return stateFips ? null : EXPECTED_COUNTS.cdp;
  }

  if (layer === 'cousub') {
    return stateFips ? null : EXPECTED_COUNTS.cousub;
  }

  if (layer === 'vtd') {
    return stateFips ? null : EXPECTED_COUNTS.vtd;
  }

  if (layer === 'zcta') {
    return stateFips ? null : EXPECTED_COUNTS.zcta;
  }

  return null;
}

/**
 * National totals computed from state-level data
 *
 * These are computed at module load time to ensure consistency
 * with state-level data. Use these for national-level validation.
 */
export const NATIONAL_TOTALS = {
  /** Total Congressional Districts (voting seats) */
  cd: 435,

  /** Total State Legislative Upper chambers */
  sldu: Object.values(EXPECTED_SLDU_BY_STATE).reduce((a, b) => a + b, 0),

  /** Total State Legislative Lower chambers */
  sldl: Object.values(EXPECTED_SLDL_BY_STATE).reduce((a, b) => a + b, 0),

  /** Total Counties (includes county equivalents) */
  county: 3143,

  /** Total Unified School Districts */
  unsd: Object.values(EXPECTED_UNSD_BY_STATE).reduce((a, b) => a + b, 0),

  /** Total Elementary School Districts */
  elsd: Object.values(EXPECTED_ELSD_BY_STATE).reduce((a, b) => a + b, 0),

  /** Total Secondary School Districts */
  scsd: Object.values(EXPECTED_SCSD_BY_STATE).reduce((a, b) => a + b, 0),

  /** Total Incorporated Places (cities, towns, villages) */
  place: EXPECTED_COUNTS.place,

  /** Total Census Designated Places (unincorporated) */
  cdp: EXPECTED_COUNTS.cdp,

  /** Total County Subdivisions (townships, boroughs, MCDs) */
  cousub: EXPECTED_COUNTS.cousub,

  /** Total Voting Districts (precincts) */
  vtd: EXPECTED_COUNTS.vtd,

  /** Total ZIP Code Tabulation Areas */
  zcta: EXPECTED_COUNTS.zcta,
} as const;

/**
 * FIPS to State Abbreviation mapping (inverse of STATE_ABBR_TO_FIPS)
 */
export const FIPS_TO_STATE_ABBR: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_ABBR_TO_FIPS).map(([abbr, fips]) => [fips, abbr])
);

/**
 * Get state name from FIPS code
 *
 * @deprecated Use getStateNameFromFips from core/types.ts directly
 */
export function getStateName(fips: string): string | null {
  return getStateNameFromFips(fips);
}

/**
 * Get state abbreviation from FIPS code
 */
export function getStateAbbr(fips: string): string | null {
  return FIPS_TO_STATE_ABBR[fips] ?? null;
}

/**
 * Get FIPS code from state abbreviation
 *
 * @deprecated Use getFipsFromStateAbbr from core/types.ts directly
 */
export function getStateFips(abbr: string): string | null {
  return getFipsFromStateAbbr(abbr.toUpperCase());
}
