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
 * - County Subdivisions: ~35,000 (MCDs in 29 states + CCDs in 21 states)
 * - Incorporated Places: ~19,500 (cities, towns, villages, boroughs by state)
 * - Census Designated Places: ~12,000 (unincorporated communities by state)
 *
 * VERIFICATION SOURCES:
 * - https://www.census.gov/programs-surveys/geography/about/faq/2020-census-geography-faq.html
 * - National Conference of State Legislatures (NCSL)
 * - US Census Bureau TIGER/Line technical documentation
 * - State and Local Census Geography Guides
 *
 * MAINTENANCE:
 * - Congressional Districts: Update after each decennial census redistricting
 * - State Legislative: Update when states redistrict (varies by state)
 * - Counties: Rare changes (last: Broomfield County, CO added 2001)
 * - County Subdivisions: Update annually with TIGER/Line releases
 * - Places/CDPs: Update annually with TIGER/Line releases
 *
 * Last Updated: 2025-12-31
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
   * Incorporated Places - cities, towns, villages (~19,700)
   * Source: Census Bureau TIGER/Line 2024
   * Computed from per-state totals in EXPECTED_PLACE_BY_STATE
   */
  place: 19666,

  /**
   * Census Designated Places - unincorporated communities (~12,000)
   * Source: Census Bureau TIGER/Line 2024
   * NOTE: CDPs are statistically defined, not legally incorporated
   * Computed from per-state totals in EXPECTED_CDP_BY_STATE
   */
  cdp: 12019,

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

  /**
   * Subminor Civil Divisions (145)
   * Source: Census Bureau TIGER/Line 2024
   * NOTE: Only exist in Puerto Rico as "subbarrios" - legally defined
   * subdivisions of barrios-pueblo and barrios MCDs
   */
  submcd: 145,

  /**
   * Consolidated Cities (17 total)
   * Source: Census Bureau TIGER/Line 2024
   * NOTE: City-county consolidations where semi-independent places remain
   * Only 7 states have consolidated cities: CT, GA, IN, KS, KY, MT, TN
   * Computed from per-state totals in EXPECTED_CONCITY_BY_STATE
   */
  concity: 17,

  /**
   * American Indian/Alaska Native/Native Hawaiian Areas (~700)
   * Source: Census Bureau TIGER/Line
   */
  aiannh: 700,

  /**
   * Alaska Native Regional Corporations (12)
   * Source: Census Bureau TIGER/Line
   */
  anrc: 12,

  /**
   * Tribal Block Groups
   * Source: Census Bureau TIGER/Line
   */
  tbg: null as number | null,

  /**
   * Tribal Census Tracts
   * Source: Census Bureau TIGER/Line
   */
  ttract: null as number | null,

  /**
   * Core Based Statistical Areas - metros (~940)
   * Source: Census Bureau TIGER/Line
   */
  cbsa: 940,

  /**
   * Combined Statistical Areas (~170)
   * Source: Census Bureau TIGER/Line
   */
  csa: 170,

  /**
   * Metropolitan Divisions (~30)
   * Source: Census Bureau TIGER/Line
   */
  metdiv: 30,

  /**
   * Urban Areas (~3,600)
   * Source: Census Bureau TIGER/Line
   */
  uac: 3600,

  /**
   * New England City and Town Areas (~40)
   * Source: Census Bureau TIGER/Line
   */
  necta: 40,

  /**
   * Combined NECTA (~10)
   * Source: Census Bureau TIGER/Line
   */
  cnecta: 10,

  /**
   * NECTA Divisions (~7)
   * Source: Census Bureau TIGER/Line
   */
  nectadiv: 7,

  /**
   * Census Tracts (~85,000)
   * Source: Census Bureau TIGER/Line
   */
  tract: 85000,

  /**
   * Block Groups (~242,000)
   * Source: Census Bureau TIGER/Line
   */
  bg: 242000,

  /**
   * Public Use Microdata Areas (~2,400)
   * Source: Census Bureau TIGER/Line
   */
  puma: 2400,

  /**
   * Estates - US Virgin Islands only (3)
   * Source: Census Bureau TIGER/Line
   */
  estate: 3,

  /**
   * Military Installations (~850)
   * Source: Census Bureau TIGER/Line MIL layer
   * NOTE: Federal overlay layer, not civic representation
   */
  mil: 850,
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
  '56': 31,  // Wyoming Senate (increased from 30 after 2020 redistricting)
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
  '56': 62,  // Wyoming House (increased from 60 after 2020 redistricting)
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
 * DOCUMENTATION SOURCES:
 * - Census Bureau TIGER/Line 2024: https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html
 * - NCES EDGE School District Boundaries: https://nces.ed.gov/programs/edge/Geographic/DistrictBoundaries
 * - Census TIGER Record Layouts: https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2024/2024_TIGERLINE_GPKG_Record_Layouts.pdf
 *
 * DISTRICT TYPE CLASSIFICATION (Census Bureau):
 * - Unified (UNSD): K-12 districts with single elected board (most common)
 * - Elementary (ELSD): K-8 districts (paired with secondary in some states)
 * - Secondary (SCSD): 9-12 high school districts (rare, paired with elementary)
 *
 * STATE SYSTEM TYPES:
 * 1. UNIFIED-ONLY (38 states): All districts are unified K-12
 *    Examples: Washington(295), Texas(1023), Ohio(614), California(1037)
 *
 * 2. DUAL-SYSTEM (9 states): Separate elementary + secondary districts
 *    Examples: Illinois(859 elem, 102 sec), Massachusetts(328 elem), New Jersey(524 elem)
 *    NOTE: Elementary and secondary CAN overlap (same territory, different grades)
 *
 * 3. MIXED (3 states): Primarily unified with some secondary overlays
 *    Examples: California(1037 unified + 77 secondary), Arizona(270 unified + 94 secondary)
 *
 * VALIDATION RULES:
 * - Unified districts MUST NOT overlap with elementary/secondary (except NYC/Hawaii)
 * - Elementary and secondary CAN overlap (serve same territory, different grades)
 * - All land must be assigned to school district(s)
 * - Dual-system states require both elementary AND secondary coverage
 *
 * SPECIAL CASES:
 * - Hawaii: Single statewide district (1 unified)
 * - New York City: Reported as single district with sub-districts
 * - Vermont: Uses supervisory unions (277 elementary reported)
 * - DC: Single district (1 unified)
 *
 * MAINTENANCE:
 * - School district boundaries change annually (as of January 1, 2024)
 * - Update from Census TIGER/Line when new vintage released
 * - Cross-reference with NCES EDGE for verification
 * - State education agencies are authoritative source for changes
 *
 * Last Updated: 2025-12-28
 * Data Vintage: 2024 TIGER/Line (school year 2023-2024)
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
 * Voting Tabulation District (VTD) counts by state
 * Source: Census Bureau 2020 Redistricting Data (PL 94-171)
 *
 * VTD boundaries are defined by states for Census enumeration and correspond
 * to voting precincts, election districts, or similar election-related areas.
 * Counts change with each redistricting cycle (after decennial census).
 *
 * DOCUMENTATION SOURCES:
 * - Census Bureau VTD FAQ: https://www.census.gov/programs-surveys/decennial-census/about/voting-districts.html
 * - TIGER/Line VTD Files: https://www2.census.gov/geo/tiger/TIGER2024/VTD/
 * - PL 94-171 Program: https://www.census.gov/programs-surveys/decennial-census/about/rdo.html
 *
 * REDISTRICTING CYCLE:
 * - These counts are valid for the 2020-2030 redistricting cycle
 * - Next update expected after 2030 Census redistricting data released
 *
 * SPECIAL CASES:
 * - California (25,594): Most VTDs, reflecting high population + precinct fragmentation
 * - New York (15,503): Second highest, large population with local precinct autonomy
 * - Wyoming (462): Fewest among states, low population density
 * - DC (143): Federal district, local election administration
 *
 * NOTE: VTD totals may vary slightly between TIGER vintages within same
 * redistricting cycle due to precinct boundary adjustments by states.
 *
 * Last Updated: 2025-12-31
 * Data Vintage: 2020 Redistricting vintage (TIGER 2024 files)
 */
export const EXPECTED_VTD_BY_STATE: Record<string, number> = {
  '01': 2149,   // Alabama
  '02': 441,    // Alaska
  '04': 1529,   // Arizona
  '05': 2673,   // Arkansas
  '06': 25594,  // California
  '08': 3207,   // Colorado
  '09': 759,    // Connecticut
  '10': 433,    // Delaware
  '11': 143,    // District of Columbia
  '12': 6063,   // Florida
  '13': 2700,   // Georgia
  '15': 351,    // Hawaii
  '16': 998,    // Idaho
  '17': 10625,  // Illinois
  '18': 5266,   // Indiana
  '19': 1681,   // Iowa
  '20': 3918,   // Kansas
  '21': 3483,   // Kentucky
  '22': 3954,   // Louisiana
  '23': 609,    // Maine
  '24': 2011,   // Maryland
  '25': 2173,   // Massachusetts
  '26': 6362,   // Michigan
  '27': 4130,   // Minnesota
  '28': 1899,   // Mississippi
  '29': 3463,   // Missouri
  '30': 682,    // Montana
  '31': 1383,   // Nebraska
  '32': 1864,   // Nevada
  '33': 322,    // New Hampshire
  '34': 6381,   // New Jersey
  '35': 1468,   // New Mexico
  '36': 15503,  // New York
  '37': 2682,   // North Carolina
  '38': 1420,   // North Dakota
  '39': 8909,   // Ohio
  '40': 1917,   // Oklahoma
  '41': 1289,   // Oregon
  '42': 9126,   // Pennsylvania
  '44': 419,    // Rhode Island
  '45': 2207,   // South Carolina
  '46': 694,    // South Dakota
  '47': 2023,   // Tennessee
  '48': 9024,   // Texas
  '49': 2625,   // Utah
  '50': 286,    // Vermont
  '51': 2539,   // Virginia
  '53': 7333,   // Washington
  '54': 1887,   // West Virginia
  '55': 6965,   // Wisconsin
  '56': 462,    // Wyoming

  // Territories
  '60': 76,     // American Samoa
  '66': 62,     // Guam
  '69': 120,    // Northern Mariana Islands
  '72': 1180,   // Puerto Rico
  '78': 78,     // US Virgin Islands
};

/**
 * VTD data freshness metadata
 *
 * VTD counts are only valid for a specific redistricting cycle.
 * After each decennial census, states redraw precinct boundaries,
 * and VTD counts change accordingly.
 */
export const VTD_DATA_VINTAGE = {
  /** Redistricting cycle year (based on decennial census) */
  cycle: 2020,

  /** Year when data becomes stale (next census redistricting) */
  validUntil: 2031,

  /** Authoritative data source */
  source: 'Census Bureau PL 94-171',

  /** TIGER file vintage used for counts */
  tigerVintage: 2024,
} as const;

/**
 * Check if VTD data is still fresh based on redistricting cycle
 *
 * @param currentYear - Year to check against (defaults to current year)
 * @returns True if VTD counts are valid for the given year
 */
export function isVtdDataFresh(currentYear?: number): boolean {
  const year = currentYear ?? new Date().getFullYear();
  return year < VTD_DATA_VINTAGE.validUntil;
}

/**
 * American Indian/Alaska Native/Native Hawaiian Areas (AIANNH) counts by state
 * Source: Census Bureau TIGER/Line 2024 (tl_2024_us_aiannh.zip)
 *
 * DOCUMENTATION SOURCES:
 * - Census Bureau TIGER/Line 2024: https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html
 * - TIGERweb AIANNH: https://tigerweb.geo.census.gov/tigerwebmain/TIGERweb_geography_details.html
 * - Federal Register Tribal List 2024: https://www.federalregister.gov/documents/2024/01/08/2024-00109/indian-entities-recognized
 *
 * ENTITY TYPES INCLUDED:
 * - Federal American Indian Reservations (AIR): ~325 nationally
 * - Off-Reservation Trust Lands (ORTL): Associated with reservations
 * - State-Recognized American Indian Reservations: Varies by state
 * - Alaska Native Village Statistical Areas (ANVSA): 229 in Alaska
 * - Oklahoma Tribal Statistical Areas (OTSA): 27 in Oklahoma (25 base + joint use)
 * - Hawaiian Home Lands (HHL): 74 in Hawaii
 * - Tribal Designated Statistical Areas (TDSA): ~20 across several states
 * - State Designated Tribal Statistical Areas (SDTSA): ~15 across states
 * - Joint Use Areas: Shared between tribes
 *
 * CROSS-STATE BOUNDARIES:
 * - Navajo Nation spans AZ, NM, UT (counted by primary STATEFP)
 * - Pine Ridge spans SD, NE
 * - Other cross-boundary areas assigned by STATEFP field
 *
 * SPECIAL CASES:
 * - Alaska: Dominated by 229 ANVSAs + 1 federal reservation (Metlakatla)
 * - Oklahoma: Former reservations are OTSAs (25 base + 2 joint = 27)
 * - Hawaii: HHLs (74) are Native Hawaiian lands, not American Indian
 * - California: Many small rancherias (~103 total areas)
 *
 * NOTE: Counts are POLYGON RECORDS in shapefile, not distinct tribes.
 * A tribe may have multiple polygons (reservation + ORTL parcels).
 *
 * Last Updated: 2025-12-31
 * Data Vintage: 2024 TIGER/Line (boundaries as of January 1, 2024)
 */
export const EXPECTED_AIANNH_BY_STATE: Record<string, number> = {
  '01': 1,    // Alabama - Poarch Creek
  '02': 230,  // Alaska - 229 ANVSAs + 1 Metlakatla Reservation
  '04': 24,   // Arizona - Navajo, Hopi, Tohono O'odham, etc.
  '05': 0,    // Arkansas - no recognized tribal areas
  '06': 103,  // California - many rancherias + reservations
  '08': 2,    // Colorado - Southern Ute, Ute Mountain
  '09': 5,    // Connecticut - Mashantucket Pequot, Mohegan, etc.
  '10': 0,    // Delaware - no recognized tribal areas
  '11': 0,    // District of Columbia - no tribal areas
  '12': 7,    // Florida - Seminole, Miccosukee
  '13': 0,    // Georgia - no recognized tribal areas
  '15': 74,   // Hawaii - Hawaiian Home Lands
  '16': 6,    // Idaho - Coeur d'Alene, Nez Perce, Shoshone-Bannock, etc.
  '17': 0,    // Illinois - no recognized tribal areas
  '18': 0,    // Indiana - no recognized tribal areas
  '19': 3,    // Iowa - Sac and Fox, Meskwaki Settlement
  '20': 4,    // Kansas - Kickapoo, Potawatomi, Iowa, Sac and Fox
  '21': 0,    // Kentucky - no recognized tribal areas
  '22': 4,    // Louisiana - Chitimacha, Coushatta, Tunica-Biloxi, Jena
  '23': 6,    // Maine - Passamaquoddy, Penobscot, Houlton Maliseet, etc.
  '24': 0,    // Maryland - no recognized tribal areas
  '25': 2,    // Massachusetts - Wampanoag (Aquinnah, Mashpee)
  '26': 14,   // Michigan - many small reservations + TDSAs
  '27': 14,   // Minnesota - Red Lake, White Earth, Leech Lake, etc.
  '28': 1,    // Mississippi - Mississippi Choctaw
  '29': 0,    // Missouri - no recognized tribal areas
  '30': 10,   // Montana - Blackfeet, Crow, Flathead, Fort Peck, etc.
  '31': 5,    // Nebraska - Omaha, Winnebago, Santee, + cross-boundary
  '32': 27,   // Nevada - many colonies and reservations
  '33': 0,    // New Hampshire - no recognized tribal areas
  '34': 0,    // New Jersey - no recognized tribal areas
  '35': 27,   // New Mexico - Navajo, many pueblos
  '36': 10,   // New York - Oneida, Onondaga, Seneca, St. Regis, etc.
  '37': 1,    // North Carolina - Eastern Cherokee
  '38': 6,    // North Dakota - Standing Rock, Fort Berthold, etc.
  '39': 0,    // Ohio - no recognized tribal areas
  '40': 28,   // Oklahoma - 27 OTSAs + Osage Reservation
  '41': 11,   // Oregon - Warm Springs, Umatilla, Grand Ronde, etc.
  '42': 0,    // Pennsylvania - no recognized tribal areas
  '44': 1,    // Rhode Island - Narragansett
  '45': 1,    // South Carolina - Catawba
  '46': 11,   // South Dakota - Pine Ridge, Rosebud, Standing Rock, etc.
  '47': 0,    // Tennessee - no recognized tribal areas
  '48': 3,    // Texas - Alabama-Coushatta, Kickapoo, Ysleta del Sur
  '49': 8,    // Utah - Navajo, Uintah and Ouray, Skull Valley, etc.
  '50': 0,    // Vermont - no recognized tribal areas
  '51': 7,    // Virginia - state-recognized tribes with SDTSAs
  '53': 32,   // Washington - many reservations + TDSAs
  '54': 0,    // West Virginia - no recognized tribal areas
  '55': 12,   // Wisconsin - Menominee, Oneida, Ho-Chunk, etc.
  '56': 2,    // Wyoming - Wind River (Arapaho + Shoshone)

  // Territories - no AIANNH areas
  '60': 0,    // American Samoa
  '66': 0,    // Guam
  '69': 0,    // Northern Mariana Islands
  '72': 0,    // Puerto Rico
  '78': 0,    // US Virgin Islands
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
 * Consolidated City (CONCITY) counts by state
 * Source: US Census Bureau TIGER/Line 2024
 *
 * DEFINITION:
 * A consolidated city is a unit of local government where the functions of
 * an incorporated place and its county or MCD have merged. Where one or more
 * other incorporated places continue to function as separate governments,
 * the primary incorporated place is referred to as a consolidated city.
 *
 * DOCUMENTATION SOURCES:
 * - Census Bureau TIGER 2024: https://www2.census.gov/geo/tiger/TIGER2024/CONCITY/
 * - Census Bureau Terms: https://www.census.gov/programs-surveys/popest/guidance-geographies/terms-and-definitions.html
 *
 * STATES WITH CONSOLIDATED CITIES (per TIGER 2024 CONCITY directory):
 * - Connecticut (09): Milford (city-town consolidation)
 * - Georgia (13): Athens-Clarke, Augusta-Richmond, Columbus-Muscogee,
 *                 Cusseta-Chattahoochee, Georgetown-Quitman, Macon-Bibb
 * - Indiana (18): Indianapolis-Marion
 * - Kansas (20): Kansas City-Wyandotte, Tribune-Greeley
 * - Kentucky (21): Louisville-Jefferson, Lexington-Fayette
 * - Montana (30): Butte-Silver Bow, Anaconda-Deer Lodge
 * - Tennessee (47): Nashville-Davidson, Hartsville-Trousdale, Lynchburg-Moore
 *
 * IMPORTANT DISTINCTIONS:
 * - Virginia independent cities are NOT consolidated cities (different Census concept)
 * - DC is NOT a consolidated city (federal district)
 * - Alaska unified municipalities (Anchorage, Juneau, Sitka) are classified
 *   as municipal governments, not consolidated cities per Census
 * - Jacksonville, FL is a full city-county consolidation with no remaining
 *   semi-independent places, so Census treats it differently
 * - San Francisco, CA is similar (coextensive city-county)
 * - Denver and Broomfield, CO are classified as municipal governments
 * - Philadelphia, PA county became coextensive with city (no separate places)
 * - Honolulu, HI is classified as a municipal government
 *
 * Total: 17 consolidated cities nationally
 *
 * Last Updated: 2025-12-31
 * Data Vintage: 2024 TIGER/Line
 */
export const EXPECTED_CONCITY_BY_STATE: Record<string, number> = {
  '01': 0,    // Alabama - no consolidated cities
  '02': 0,    // Alaska - unified municipalities classified as municipal govts
  '04': 0,    // Arizona - no consolidated cities
  '05': 0,    // Arkansas - no consolidated cities
  '06': 0,    // California - San Francisco is coextensive, not consolidated city
  '08': 0,    // Colorado - Denver/Broomfield are municipal govts
  '09': 1,    // Connecticut - Milford
  '10': 0,    // Delaware - no consolidated cities
  '11': 0,    // District of Columbia - federal district, not consolidated city
  '12': 0,    // Florida - Jacksonville is full consolidation (no semi-independent places)
  '13': 6,    // Georgia - Athens-Clarke, Augusta-Richmond, Columbus-Muscogee,
              //           Cusseta-Chattahoochee, Georgetown-Quitman, Macon-Bibb
  '15': 0,    // Hawaii - Honolulu is municipal govt
  '16': 0,    // Idaho - no consolidated cities
  '17': 0,    // Illinois - no consolidated cities
  '18': 1,    // Indiana - Indianapolis-Marion
  '19': 0,    // Iowa - no consolidated cities
  '20': 2,    // Kansas - Kansas City-Wyandotte, Tribune-Greeley
  '21': 2,    // Kentucky - Louisville-Jefferson, Lexington-Fayette
  '22': 0,    // Louisiana - New Orleans is full consolidation
  '23': 0,    // Maine - no consolidated cities
  '24': 0,    // Maryland - Baltimore is independent city
  '25': 0,    // Massachusetts - Nantucket is coextensive town-county
  '26': 0,    // Michigan - no consolidated cities
  '27': 0,    // Minnesota - no consolidated cities
  '28': 0,    // Mississippi - no consolidated cities
  '29': 0,    // Missouri - no consolidated cities
  '30': 2,    // Montana - Butte-Silver Bow, Anaconda-Deer Lodge
  '31': 0,    // Nebraska - no consolidated cities
  '32': 0,    // Nevada - Carson City is independent city
  '33': 0,    // New Hampshire - no consolidated cities
  '34': 0,    // New Jersey - no consolidated cities
  '35': 0,    // New Mexico - no consolidated cities
  '36': 0,    // New York - NYC boroughs are not consolidated cities
  '37': 0,    // North Carolina - no consolidated cities
  '38': 0,    // North Dakota - no consolidated cities
  '39': 0,    // Ohio - no consolidated cities
  '40': 0,    // Oklahoma - no consolidated cities
  '41': 0,    // Oregon - no consolidated cities
  '42': 0,    // Pennsylvania - Philadelphia is coextensive city-county
  '44': 0,    // Rhode Island - no consolidated cities
  '45': 0,    // South Carolina - no consolidated cities
  '46': 0,    // South Dakota - no consolidated cities
  '47': 3,    // Tennessee - Nashville-Davidson, Hartsville-Trousdale, Lynchburg-Moore
  '48': 0,    // Texas - no consolidated cities
  '49': 0,    // Utah - no consolidated cities
  '50': 0,    // Vermont - no consolidated cities
  '51': 0,    // Virginia - independent cities are separate concept
  '53': 0,    // Washington - no consolidated cities
  '54': 0,    // West Virginia - no consolidated cities
  '55': 0,    // Wisconsin - no consolidated cities
  '56': 0,    // Wyoming - no consolidated cities
};

/**
 * Subminor Civil Division (SUBMCD) counts by state
 * Source: Census Bureau TIGER/Line 2024
 *
 * SUBMCD (subbarrios) ONLY exist in Puerto Rico.
 * They are legally defined subdivisions of the minor civil division (MCD)
 * named barrios-pueblo and barrios. Boundaries provided by Puerto Rico
 * Planning Board.
 *
 * Total: 145 subbarrios in Puerto Rico
 *
 * DOCUMENTATION SOURCES:
 * - Census Bureau TIGER/Line 2024: https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html
 * - Census Geography FAQ: https://www.census.gov/programs-surveys/geography/about/faq/2020-census-geography-faq.html
 *
 * NOTE: Do NOT confuse with cousub (county subdivisions/MCDs) - submcd is
 * a subdivision BELOW cousub, only in Puerto Rico.
 *
 * Last Updated: 2025-12-31
 * Data Vintage: 2024 TIGER/Line
 */
export const EXPECTED_SUBMCD_BY_STATE: Record<string, number> = {
  '01': 0,    // Alabama - no submcd
  '02': 0,    // Alaska - no submcd
  '04': 0,    // Arizona - no submcd
  '05': 0,    // Arkansas - no submcd
  '06': 0,    // California - no submcd
  '08': 0,    // Colorado - no submcd
  '09': 0,    // Connecticut - no submcd
  '10': 0,    // Delaware - no submcd
  '11': 0,    // District of Columbia - no submcd
  '12': 0,    // Florida - no submcd
  '13': 0,    // Georgia - no submcd
  '15': 0,    // Hawaii - no submcd
  '16': 0,    // Idaho - no submcd
  '17': 0,    // Illinois - no submcd
  '18': 0,    // Indiana - no submcd
  '19': 0,    // Iowa - no submcd
  '20': 0,    // Kansas - no submcd
  '21': 0,    // Kentucky - no submcd
  '22': 0,    // Louisiana - no submcd
  '23': 0,    // Maine - no submcd
  '24': 0,    // Maryland - no submcd
  '25': 0,    // Massachusetts - no submcd
  '26': 0,    // Michigan - no submcd
  '27': 0,    // Minnesota - no submcd
  '28': 0,    // Mississippi - no submcd
  '29': 0,    // Missouri - no submcd
  '30': 0,    // Montana - no submcd
  '31': 0,    // Nebraska - no submcd (has townships/precincts as cousub, NOT submcd)
  '32': 0,    // Nevada - no submcd
  '33': 0,    // New Hampshire - no submcd
  '34': 0,    // New Jersey - no submcd
  '35': 0,    // New Mexico - no submcd
  '36': 0,    // New York - no submcd
  '37': 0,    // North Carolina - no submcd
  '38': 0,    // North Dakota - no submcd
  '39': 0,    // Ohio - no submcd
  '40': 0,    // Oklahoma - no submcd
  '41': 0,    // Oregon - no submcd
  '42': 0,    // Pennsylvania - no submcd
  '44': 0,    // Rhode Island - no submcd
  '45': 0,    // South Carolina - no submcd
  '46': 0,    // South Dakota - no submcd
  '47': 0,    // Tennessee - no submcd
  '48': 0,    // Texas - no submcd
  '49': 0,    // Utah - no submcd
  '50': 0,    // Vermont - no submcd
  '51': 0,    // Virginia - no submcd
  '53': 0,    // Washington - no submcd
  '54': 0,    // West Virginia - no submcd
  '55': 0,    // Wisconsin - no submcd
  '56': 0,    // Wyoming - no submcd

  // Territories
  '60': 0,    // American Samoa - no submcd
  '66': 0,    // Guam - no submcd
  '69': 0,    // Northern Mariana Islands - no submcd
  '72': 145,  // Puerto Rico - ONLY jurisdiction with submcd (subbarrios)
  '78': 0,    // US Virgin Islands - no submcd (has estates, separate layer)
};

/**
 * Incorporated Place counts by state (cities, towns, villages, boroughs)
 * Source: Census Bureau TIGER/Line 2024
 *
 * NOTE: Place definitions vary by state. Some states (Maine, Massachusetts,
 * New Hampshire, Rhode Island, Vermont) use Minor Civil Divisions (MCDs)
 * as primary local government, so their incorporated place counts are low.
 *
 * LSAD codes indicating incorporation:
 * - 21 = borough, 25 = city, 43 = town, 47 = village
 *
 * Last Updated: 2025-12-30
 * Data Vintage: 2024 TIGER/Line
 */
export const EXPECTED_PLACE_BY_STATE: Record<string, number> = {
  '01': 462,   // Alabama
  '02': 149,   // Alaska
  '04': 91,    // Arizona
  '05': 501,   // Arkansas
  '06': 482,   // California
  '08': 272,   // Colorado
  '09': 169,   // Connecticut
  '10': 57,    // Delaware
  '11': 1,     // District of Columbia
  '12': 412,   // Florida
  '13': 537,   // Georgia
  '15': 1,     // Hawaii (Honolulu is consolidated)
  '16': 200,   // Idaho
  '17': 1299,  // Illinois
  '18': 569,   // Indiana
  '19': 948,   // Iowa
  '20': 627,   // Kansas
  '21': 418,   // Kentucky
  '22': 307,   // Louisiana
  '23': 23,    // Maine (towns are MCDs, not places)
  '24': 157,   // Maryland
  '25': 57,    // Massachusetts (towns are MCDs)
  '26': 533,   // Michigan
  '27': 854,   // Minnesota
  '28': 298,   // Mississippi
  '29': 942,   // Missouri
  '30': 129,   // Montana
  '31': 530,   // Nebraska
  '32': 19,    // Nevada
  '33': 13,    // New Hampshire (towns are MCDs)
  '34': 327,   // New Jersey
  '35': 106,   // New Mexico
  '36': 615,   // New York
  '37': 553,   // North Carolina
  '38': 357,   // North Dakota
  '39': 937,   // Ohio
  '40': 597,   // Oklahoma
  '41': 241,   // Oregon
  '42': 1015,  // Pennsylvania
  '44': 8,     // Rhode Island (towns are MCDs)
  '45': 271,   // South Carolina
  '46': 311,   // South Dakota
  '47': 345,   // Tennessee
  '48': 1222,  // Texas
  '49': 252,   // Utah
  '50': 10,    // Vermont (towns are MCDs)
  '51': 229,   // Virginia
  '53': 281,   // Washington
  '54': 232,   // West Virginia
  '55': 601,   // Wisconsin
  '56': 99,    // Wyoming
};

/**
 * County Subdivision (COUSUB) counts by state
 * Source: Census Bureau TIGER/Line 2024, State and Local Census Geography Guides
 *
 * County subdivisions include Minor Civil Divisions (MCDs) in 29 states and
 * Census County Divisions (CCDs) in 21 states. A state has either MCDs or CCDs,
 * never both.
 *
 * MCD STATES (29 + PR): Legally defined subdivisions
 * - New England: Towns as primary local government (CT, MA, ME, NH, RI, VT)
 * - Mid-Atlantic: Townships (NJ, NY, PA)
 * - Midwest: Townships (IL, IN, IA, KS, MI, MN, MO, NE, ND, OH, SD, WI)
 * - Other: MD, NC, SC, VA, WV
 *
 * CCD STATES (21): Statistical subdivisions for data collection
 * - West: AK, AZ, CA, CO, HI, ID, MT, NM, NV, OR, UT, WA, WY
 * - South: AL, AR, FL, GA, LA, MS, OK, TX, TN, KY, DE
 *
 * DOCUMENTATION SOURCES:
 * - Census GARM Ch.8: https://www2.census.gov/geo/pdfs/reference/GARM/Ch8GARM.pdf
 * - State/Local Guides: https://www.census.gov/geographies/reference-files/2010/geo/state-local-geo-guides-2010.html
 *
 * Last Updated: 2025-12-31
 * Data Vintage: 2024 TIGER/Line
 */
export const EXPECTED_COUSUB_BY_STATE: Record<string, number> = {
  // CCD States (Census County Divisions - statistical, no legal function)
  '01': 390,    // Alabama (CCDs)
  '02': 178,    // Alaska (boroughs + census areas subdivided into CCDs)
  '04': 95,     // Arizona (CCDs)
  '05': 373,    // Arkansas (CCDs)
  '06': 397,    // California (CCDs)
  '08': 189,    // Colorado (CCDs)

  // MCD States - New England (towns as primary government)
  '09': 173,    // Connecticut (169 towns + 4 water-only MCDs)
  '10': 57,     // Delaware (CCDs)
  '11': 1,      // District of Columbia (single entity, no subdivisions)
  '12': 316,    // Florida (CCDs)
  '13': 586,    // Georgia (CCDs)
  '15': 44,     // Hawaii (CCDs)
  '16': 150,    // Idaho (CCDs)

  // MCD States - Midwest (townships)
  '17': 1432,   // Illinois (1,432 townships + precincts)
  '18': 1011,   // Indiana (1,008 townships + unorganized territory)
  '19': 1661,   // Iowa (1,598 townships + independent cities)
  '20': 1533,   // Kansas (1,410 townships + cities)
  '21': 490,    // Kentucky (CCDs, former magisterial districts)
  '22': 406,    // Louisiana (CCDs, no parishes subdivisions legally)

  // MCD States - New England (towns)
  '23': 533,    // Maine (433 towns + 22 cities + unorganized territories)
  '24': 344,    // Maryland (CCDs + Baltimore City)
  '25': 357,    // Massachusetts (298 towns + 53 cities + water MCDs)
  '26': 1539,   // Michigan (1,240 townships + cities as MCD equivalents)
  '27': 2741,   // Minnesota (1,785 townships + cities + unorganized)
  '28': 312,    // Mississippi (CCDs)
  '29': 1395,   // Missouri (1,393 townships + St. Louis City)
  '30': 172,    // Montana (CCDs)
  '31': 1198,   // Nebraska (townships + precincts + election districts)
  '32': 68,     // Nevada (CCDs)

  // MCD States - New England (towns)
  '33': 260,    // New Hampshire (222 towns + townships + grants)
  '34': 571,    // New Jersey (242 townships + 324 independent places)
  '35': 123,    // New Mexico (CCDs)
  '36': 1021,   // New York (933 towns + 62 independent cities + reservations)
  '37': 673,    // North Carolina (CCDs, former townships)
  '38': 1403,   // North Dakota (1,350 townships + cities)
  '39': 1604,   // Ohio (1,324 townships + 274 independent cities)
  '40': 419,    // Oklahoma (CCDs)
  '41': 205,    // Oregon (CCDs)

  // MCD States - Mid-Atlantic (townships)
  '42': 2575,   // Pennsylvania (1,546 townships + 1,024 boroughs + cities)
  '44': 40,     // Rhode Island (31 towns + 8 cities + 1 water MCD)
  '45': 261,    // South Carolina (CCDs, former townships)
  '46': 1188,   // South Dakota (962 townships + cities + unorganized)
  '47': 323,    // Tennessee (CCDs)
  '48': 862,    // Texas (CCDs)
  '49': 97,     // Utah (CCDs)

  // MCD States - New England (towns)
  '50': 259,    // Vermont (242 towns + cities + gores)
  '51': 589,    // Virginia (independent cities as MCD equivalents)
  '53': 210,    // Washington (CCDs)
  '54': 484,    // West Virginia (MCDs, magisterial districts)
  '55': 1921,   // Wisconsin (1,257 towns + cities + villages)
  '56': 140,    // Wyoming (CCDs)

  // Territories
  '60': 15,     // American Samoa (county subdivisions)
  '66': 19,     // Guam (villages)
  '69': 17,     // Northern Mariana Islands (municipal districts)
  '72': 900,    // Puerto Rico (barrios within municipios)
  '78': 20,     // US Virgin Islands (sub-districts)
};

/**
 * Census Designated Place (CDP) counts by state
 * Source: Census Bureau TIGER/Line 2024
 *
 * CDPs are statistical areas for unincorporated communities.
 * They have no legal status but are used for Census data collection.
 * LSAD = 57 indicates CDP.
 *
 * Last Updated: 2025-12-30
 * Data Vintage: 2024 TIGER/Line
 */
export const EXPECTED_CDP_BY_STATE: Record<string, number> = {
  '01': 289,   // Alabama
  '02': 206,   // Alaska (many unincorporated communities)
  '04': 260,   // Arizona
  '05': 49,    // Arkansas
  '06': 1042,  // California
  '08': 225,   // Colorado
  '09': 77,    // Connecticut
  '10': 77,    // Delaware
  '11': 0,     // District of Columbia
  '12': 851,   // Florida
  '13': 413,   // Georgia
  '15': 152,   // Hawaii
  '16': 116,   // Idaho
  '17': 70,    // Illinois
  '18': 139,   // Indiana
  '19': 29,    // Iowa
  '20': 41,    // Kansas
  '21': 135,   // Kentucky
  '22': 171,   // Louisiana
  '23': 227,   // Maine
  '24': 485,   // Maryland
  '25': 186,   // Massachusetts
  '26': 236,   // Michigan
  '27': 54,    // Minnesota
  '28': 162,   // Mississippi
  '29': 80,    // Missouri
  '30': 114,   // Montana
  '31': 29,    // Nebraska
  '32': 103,   // Nevada
  '33': 107,   // New Hampshire
  '34': 259,   // New Jersey
  '35': 200,   // New Mexico
  '36': 523,   // New York
  '37': 633,   // North Carolina
  '38': 21,    // North Dakota
  '39': 266,   // Ohio
  '40': 78,    // Oklahoma
  '41': 191,   // Oregon
  '42': 701,   // Pennsylvania
  '44': 59,    // Rhode Island
  '45': 328,   // South Carolina
  '46': 44,    // South Dakota
  '47': 293,   // Tennessee
  '48': 797,   // Texas
  '49': 160,   // Utah
  '50': 140,   // Vermont
  '51': 419,   // Virginia
  '53': 457,   // Washington
  '54': 118,   // West Virginia
  '55': 147,   // Wisconsin
  '56': 60,    // Wyoming
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
  // Legislative
  | 'cd'
  | 'sldu'
  | 'sldl'

  // County-level
  | 'county'
  | 'cousub'
  | 'submcd'

  // Municipal
  | 'place'
  | 'cdp'     // Census Designated Places (unincorporated)
  | 'concity'

  // School districts
  | 'unsd'
  | 'elsd'
  | 'scsd'

  // Electoral
  | 'vtd'

  // Tribal and Indigenous
  | 'aiannh'
  | 'anrc'
  | 'tbg'
  | 'ttract'

  // Metropolitan and urban
  | 'cbsa'
  | 'csa'
  | 'metdiv'
  | 'uac'
  | 'necta'
  | 'cnecta'
  | 'nectadiv'

  // Reference layers
  | 'zcta'
  | 'tract'
  | 'bg'
  | 'puma'

  // Special cases
  | 'estate'

  // Federal installations (P0-2)
  | 'mil';

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

  // Municipal layers with per-state counts
  if (layer === 'place') {
    if (stateFips) {
      return EXPECTED_PLACE_BY_STATE[stateFips] ?? null;
    }
    // Compute national total from state data
    return Object.values(EXPECTED_PLACE_BY_STATE).reduce((a, b) => a + b, 0);
  }

  if (layer === 'cdp') {
    if (stateFips) {
      return EXPECTED_CDP_BY_STATE[stateFips] ?? null;
    }
    // Compute national total from state data
    return Object.values(EXPECTED_CDP_BY_STATE).reduce((a, b) => a + b, 0);
  }

  if (layer === 'cousub') {
    if (stateFips) {
      return EXPECTED_COUSUB_BY_STATE[stateFips] ?? null;
    }
    // Compute national total from state data
    return Object.values(EXPECTED_COUSUB_BY_STATE).reduce((a, b) => a + b, 0);
  }

  if (layer === 'submcd') {
    if (stateFips) {
      return EXPECTED_SUBMCD_BY_STATE[stateFips] ?? null;
    }
    // Compute national total from state data (should equal 145)
    return Object.values(EXPECTED_SUBMCD_BY_STATE).reduce((a, b) => a + b, 0);
  }

  if (layer === 'concity') {
    if (stateFips) {
      return EXPECTED_CONCITY_BY_STATE[stateFips] ?? null;
    }
    // Compute national total from state data (should equal 17)
    return Object.values(EXPECTED_CONCITY_BY_STATE).reduce((a, b) => a + b, 0);
  }

  // Electoral infrastructure
  if (layer === 'vtd') {
    if (stateFips) {
      return EXPECTED_VTD_BY_STATE[stateFips] ?? null;
    }
    // Compute national total from state data
    return Object.values(EXPECTED_VTD_BY_STATE).reduce((a, b) => a + b, 0);
  }

  // Tribal and Indigenous
  if (layer === 'aiannh') {
    if (stateFips) {
      return EXPECTED_AIANNH_BY_STATE[stateFips] ?? null;
    }
    // Compute national total from state data
    return Object.values(EXPECTED_AIANNH_BY_STATE).reduce((a, b) => a + b, 0);
  }

  if (layer === 'anrc') {
    return stateFips ? null : EXPECTED_COUNTS.anrc;
  }

  if (layer === 'tbg') {
    return stateFips ? null : EXPECTED_COUNTS.tbg;
  }

  if (layer === 'ttract') {
    return stateFips ? null : EXPECTED_COUNTS.ttract;
  }

  // Metropolitan and urban
  if (layer === 'cbsa') {
    return stateFips ? null : EXPECTED_COUNTS.cbsa;
  }

  if (layer === 'csa') {
    return stateFips ? null : EXPECTED_COUNTS.csa;
  }

  if (layer === 'metdiv') {
    return stateFips ? null : EXPECTED_COUNTS.metdiv;
  }

  if (layer === 'uac') {
    return stateFips ? null : EXPECTED_COUNTS.uac;
  }

  if (layer === 'necta') {
    return stateFips ? null : EXPECTED_COUNTS.necta;
  }

  if (layer === 'cnecta') {
    return stateFips ? null : EXPECTED_COUNTS.cnecta;
  }

  if (layer === 'nectadiv') {
    return stateFips ? null : EXPECTED_COUNTS.nectadiv;
  }

  // Reference layers
  if (layer === 'zcta') {
    return stateFips ? null : EXPECTED_COUNTS.zcta;
  }

  if (layer === 'tract') {
    return stateFips ? null : EXPECTED_COUNTS.tract;
  }

  if (layer === 'bg') {
    return stateFips ? null : EXPECTED_COUNTS.bg;
  }

  if (layer === 'puma') {
    return stateFips ? null : EXPECTED_COUNTS.puma;
  }

  // Special cases
  if (layer === 'estate') {
    return stateFips ? null : EXPECTED_COUNTS.estate;
  }

  // Federal installations (P0-2)
  if (layer === 'mil') {
    return stateFips ? null : EXPECTED_COUNTS.mil;
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
  place: Object.values(EXPECTED_PLACE_BY_STATE).reduce((a, b) => a + b, 0),

  /** Total Census Designated Places (unincorporated) */
  cdp: Object.values(EXPECTED_CDP_BY_STATE).reduce((a, b) => a + b, 0),

  /** Total County Subdivisions (townships, boroughs, MCDs, CCDs) */
  cousub: Object.values(EXPECTED_COUSUB_BY_STATE).reduce((a, b) => a + b, 0),

  /** Total Voting Tabulation Districts (precincts) */
  vtd: Object.values(EXPECTED_VTD_BY_STATE).reduce((a, b) => a + b, 0),

  /** Total Subminor Civil Divisions (Puerto Rico subbarrios only) */
  submcd: Object.values(EXPECTED_SUBMCD_BY_STATE).reduce((a, b) => a + b, 0),

  /** Total Consolidated Cities (city-county consolidations with semi-independent places) */
  concity: Object.values(EXPECTED_CONCITY_BY_STATE).reduce((a, b) => a + b, 0),

  /** Total Tribal Areas (AIANNH) */
  aiannh: Object.values(EXPECTED_AIANNH_BY_STATE).reduce((a, b) => a + b, 0),

  /** Total Alaska Native Regional Corporations */
  anrc: EXPECTED_COUNTS.anrc,

  /** Total Tribal Block Groups */
  tbg: EXPECTED_COUNTS.tbg,

  /** Total Tribal Census Tracts */
  ttract: EXPECTED_COUNTS.ttract,

  /** Total Core Based Statistical Areas */
  cbsa: EXPECTED_COUNTS.cbsa,

  /** Total Combined Statistical Areas */
  csa: EXPECTED_COUNTS.csa,

  /** Total Metropolitan Divisions */
  metdiv: EXPECTED_COUNTS.metdiv,

  /** Total Urban Areas */
  uac: EXPECTED_COUNTS.uac,

  /** Total New England City and Town Areas */
  necta: EXPECTED_COUNTS.necta,

  /** Total Combined NECTAs */
  cnecta: EXPECTED_COUNTS.cnecta,

  /** Total NECTA Divisions */
  nectadiv: EXPECTED_COUNTS.nectadiv,

  /** Total ZIP Code Tabulation Areas */
  zcta: EXPECTED_COUNTS.zcta,

  /** Total Census Tracts */
  tract: EXPECTED_COUNTS.tract,

  /** Total Block Groups */
  bg: EXPECTED_COUNTS.bg,

  /** Total Public Use Microdata Areas */
  puma: EXPECTED_COUNTS.puma,

  /** Total Estates (USVI) */
  estate: EXPECTED_COUNTS.estate,

  /** Total Military Installations */
  mil: EXPECTED_COUNTS.mil,
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
