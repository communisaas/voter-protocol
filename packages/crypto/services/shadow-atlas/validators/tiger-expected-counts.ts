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
 * Get expected count for specific TIGER layer and state
 */
export function getExpectedCount(
  layer: 'cd' | 'sldu' | 'sldl' | 'county',
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

  return null;
}

/**
 * Get state name from FIPS code
 */
export function getStateName(fips: string): string | null {
  const stateNames: Record<string, string> = {
    '01': 'Alabama', '02': 'Alaska', '04': 'Arizona', '05': 'Arkansas',
    '06': 'California', '08': 'Colorado', '09': 'Connecticut', '10': 'Delaware',
    '11': 'District of Columbia', '12': 'Florida', '13': 'Georgia', '15': 'Hawaii',
    '16': 'Idaho', '17': 'Illinois', '18': 'Indiana', '19': 'Iowa',
    '20': 'Kansas', '21': 'Kentucky', '22': 'Louisiana', '23': 'Maine',
    '24': 'Maryland', '25': 'Massachusetts', '26': 'Michigan', '27': 'Minnesota',
    '28': 'Mississippi', '29': 'Missouri', '30': 'Montana', '31': 'Nebraska',
    '32': 'Nevada', '33': 'New Hampshire', '34': 'New Jersey', '35': 'New Mexico',
    '36': 'New York', '37': 'North Carolina', '38': 'North Dakota', '39': 'Ohio',
    '40': 'Oklahoma', '41': 'Oregon', '42': 'Pennsylvania', '44': 'Rhode Island',
    '45': 'South Carolina', '46': 'South Dakota', '47': 'Tennessee', '48': 'Texas',
    '49': 'Utah', '50': 'Vermont', '51': 'Virginia', '53': 'Washington',
    '54': 'West Virginia', '55': 'Wisconsin', '56': 'Wyoming',
    '60': 'American Samoa', '66': 'Guam', '69': 'Northern Mariana Islands',
    '72': 'Puerto Rico', '78': 'US Virgin Islands',
  };

  return stateNames[fips] ?? null;
}
