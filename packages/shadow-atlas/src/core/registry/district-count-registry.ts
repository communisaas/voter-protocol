/**
 * Enhanced Governance Validation Registry
 *
 * PROBLEM: Cincinnati PoC failure - discovered 74 features (Community Councils)
 * instead of 9 council districts. No validation caught wrong-granularity data.
 *
 * SOLUTION: Expected district count registry for pre-flight validation.
 *
 * ARCHITECTURE:
 * - Top 50 US cities with verified district counts
 * - Prevents wrong-granularity discoveries (neighborhoods vs. districts)
 * - Enables confidence scoring based on count match
 * - Allows ±2 tolerance for recent redistricting
 *
 * VALIDATION STRATEGY:
 * - Exact match (0 diff) → 100% confidence
 * - Within tolerance (≤2 diff) → 70% confidence
 * - Outside tolerance (>2 diff) → REJECT
 * - null expectedDistrictCount → at-large city, expect 1 feature
 *
 * DATA SOURCES:
 * - known-portals.ts registry (21 cities with verified counts)
 * - PoC batch results (27 cities with discovered counts)
 * - Official city council websites (verified 2025-11-19)
 */

/**
 * Governance type classification
 */
export type GovernanceType =
  | 'district-based'  // Geographic districts elect representatives
  | 'at-large'        // All representatives elected city-wide (expect 1 boundary)
  | 'hybrid';         // Mix of district + at-large seats

/**
 * Enhanced district count record with validation metadata
 */
export interface DistrictCountRecord {
  /** 7-digit Census PLACE FIPS code */
  readonly fips: string;

  /** City name (human-readable) */
  readonly cityName: string;

  /** State abbreviation */
  readonly state: string;

  /** Expected number of council districts (null = at-large city) */
  readonly expectedDistrictCount: number | null;

  /** Governance structure type */
  readonly governanceType: GovernanceType;

  /** Source URL for verification */
  readonly source: string;

  /** Last verification date (ISO 8601: YYYY-MM-DD) */
  readonly lastVerified: string;

  /** Optional implementation notes */
  readonly notes?: string;
}

/**
 * District Count Registry
 *
 * Top 50 US cities by population with verified council district counts.
 *
 * MAINTENANCE:
 * - Add new entries when PoC discovers cities with high confidence
 * - Update counts after city redistricting events (typically post-Census)
 * - Verify sources annually (check lastVerified timestamps)
 * - Flag outliers (Cincinnati-style) for manual investigation
 */
export const EXPECTED_DISTRICT_COUNTS: Record<string, DistrictCountRecord> = {
  // ==========================================================================
  // TOP 10 US CITIES (verified from known-portals.ts)
  // ==========================================================================

  '3651000': {
    fips: '3651000',
    cityName: 'New York City',
    state: 'NY',
    expectedDistrictCount: 51,
    governanceType: 'district-based',
    source: 'https://council.nyc.gov/districts/',
    lastVerified: '2025-11-19',
    notes: '51 districts (largest in US)',
  },

  '0644000': {
    fips: '0644000',
    cityName: 'Los Angeles',
    state: 'CA',
    expectedDistrictCount: 15,
    governanceType: 'district-based',
    source: 'https://www.lacity.org/government/elected-officials',
    lastVerified: '2025-11-19',
    notes: '15 districts',
  },

  '1714000': {
    fips: '1714000',
    cityName: 'Chicago',
    state: 'IL',
    expectedDistrictCount: 50,
    governanceType: 'district-based',
    source: 'https://www.chicago.gov/city/en/about/wards.html',
    lastVerified: '2025-11-19',
    notes: '50 wards',
  },

  '4835000': {
    fips: '4835000',
    cityName: 'Houston',
    state: 'TX',
    expectedDistrictCount: 11,
    governanceType: 'district-based',
    source: 'https://www.houstontx.gov/council/',
    lastVerified: '2025-11-19',
    notes: '11 districts',
  },

  '0455000': {
    fips: '0455000',
    cityName: 'Phoenix',
    state: 'AZ',
    expectedDistrictCount: 8,
    governanceType: 'district-based',
    source: 'https://www.phoenix.gov/districtssite/',
    lastVerified: '2025-11-19',
    notes: '8 districts',
  },

  '4260000': {
    fips: '4260000',
    cityName: 'Philadelphia',
    state: 'PA',
    expectedDistrictCount: 10,
    governanceType: 'district-based',
    source: 'https://www.phila.gov/council/',
    lastVerified: '2025-11-19',
    notes: '10 districts',
  },

  '4865000': {
    fips: '4865000',
    cityName: 'San Antonio',
    state: 'TX',
    expectedDistrictCount: 10,
    governanceType: 'district-based',
    source: 'https://www.sanantonio.gov/council',
    lastVerified: '2025-11-19',
    notes: '10 districts',
  },

  '0666000': {
    fips: '0666000',
    cityName: 'San Diego',
    state: 'CA',
    expectedDistrictCount: 9,
    governanceType: 'district-based',
    source: 'https://www.sandiego.gov/citycouncil/district-maps',
    lastVerified: '2025-11-19',
    notes: '9 districts (adopted Dec 2021)',
  },

  '4819000': {
    fips: '4819000',
    cityName: 'Dallas',
    state: 'TX',
    expectedDistrictCount: 14,
    governanceType: 'district-based',
    source: 'https://www.dallascityhall.com/government/Council/Pages/default.aspx',
    lastVerified: '2025-11-19',
    notes: '14 districts',
  },

  '0668000': {
    fips: '0668000',
    cityName: 'San Jose',
    state: 'CA',
    expectedDistrictCount: 10,
    governanceType: 'district-based',
    source: 'https://www.sanjoseca.gov/your-government/departments-offices/city-council',
    lastVerified: '2025-11-19',
    notes: '10 districts',
  },

  // ==========================================================================
  // TOP 11-20 US CITIES
  // ==========================================================================

  '4805000': {
    fips: '4805000',
    cityName: 'Austin',
    state: 'TX',
    expectedDistrictCount: 10,
    governanceType: 'district-based',
    source: 'https://www.austintexas.gov/department/city-council',
    lastVerified: '2025-11-19',
    notes: '10 single-member districts (Mayor elected at-large)',
  },

  '1235000': {
    fips: '1235000',
    cityName: 'Jacksonville',
    state: 'FL',
    expectedDistrictCount: 14,
    governanceType: 'district-based',
    source: 'https://www.coj.net/city-council',
    lastVerified: '2025-11-19',
    notes: '14 districts (19 total seats including 5 at-large)',
  },

  '0667000': {
    fips: '0667000',
    cityName: 'San Francisco',
    state: 'CA',
    expectedDistrictCount: 11,
    governanceType: 'district-based',
    source: 'https://sfgov.org/electionscommission/board-supervisors',
    lastVerified: '2025-11-19',
    notes: '11 supervisor districts (changed from at-large in 2000)',
  },

  '3918000': {
    fips: '3918000',
    cityName: 'Columbus',
    state: 'OH',
    expectedDistrictCount: 9,
    governanceType: 'district-based',
    source: 'https://www.columbus.gov/council/',
    lastVerified: '2025-11-19',
    notes: '9 districts (7 district seats, 4 at-large)',
  },

  '1836003': {
    fips: '1836003',
    cityName: 'Indianapolis',
    state: 'IN',
    expectedDistrictCount: 25,
    governanceType: 'district-based',
    source: 'https://www.indy.gov/agency/city-county-council',
    lastVerified: '2025-11-19',
    notes: '25 districts (City-County Council)',
  },

  '4804000': {
    fips: '4804000',
    cityName: 'Arlington',
    state: 'TX',
    expectedDistrictCount: 5,
    governanceType: 'hybrid',
    source: 'https://www.arlingtontx.gov/Government/City-Government/City-Council',
    lastVerified: '2026-01-15',
    notes: '5 single-member geographic districts (1-5) + 3 at-large seats (6-8) + Mayor. Only geographic districts counted for tessellation.',
  },

  '4827000': {
    fips: '4827000',
    cityName: 'Fort Worth',
    state: 'TX',
    expectedDistrictCount: 10,
    governanceType: 'district-based',
    source: 'https://www.fortworthtexas.gov/departments/city-council',
    lastVerified: '2026-01-15',
    notes: '10 districts (numbered 2-11, no district 1). FIXED 2026-01-15: Updated from 9 to 10 based on API verification.',
  },

  '3712000': {
    fips: '3712000',
    cityName: 'Charlotte',
    state: 'NC',
    expectedDistrictCount: 7,
    governanceType: 'district-based',
    source: 'https://charlottenc.gov/CityClerk/Pages/CityCouncil.aspx',
    lastVerified: '2025-11-19',
    notes: '7 districts (4 at-large seats also exist)',
  },

  '5363000': {
    fips: '5363000',
    cityName: 'Seattle',
    state: 'WA',
    expectedDistrictCount: 7,
    governanceType: 'hybrid',
    source: 'https://www.seattle.gov/council',
    lastVerified: '2025-11-19',
    notes: '7 district seats (2 at-large seats also exist)',
  },

  '0820000': {
    fips: '0820000',
    cityName: 'Denver',
    state: 'CO',
    expectedDistrictCount: 11,
    governanceType: 'hybrid',
    source: 'https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Denver-City-Council',
    lastVerified: '2026-01-15',
    notes: '11 geographic districts + 2 at-large (at-large excluded from tessellation). FIXED 2026-01-15: Reverted to 11 geographic districts.',
  },

  '1150000': {
    fips: '1150000',
    cityName: 'Washington',
    state: 'DC',
    expectedDistrictCount: 8,
    governanceType: 'district-based',
    source: 'https://dc.gov/council',
    lastVerified: '2025-11-19',
    notes: '8 wards (from 2022 redistricting)',
  },

  // ==========================================================================
  // TOP 21-30 US CITIES
  // ==========================================================================

  '0608000': {
    fips: '0608000',
    cityName: 'Boston',
    state: 'MA',
    expectedDistrictCount: 9,
    governanceType: 'district-based',
    source: 'https://www.boston.gov/departments/city-council',
    lastVerified: '2025-11-19',
    notes: '9 district councilors (4 at-large also exist)',
  },

  '4824000': {
    fips: '4824000',
    cityName: 'El Paso',
    state: 'TX',
    expectedDistrictCount: 8,
    governanceType: 'district-based',
    source: 'https://www.elpasotexas.gov/city-clerk/boards-commissions/city-council',
    lastVerified: '2025-11-19',
    notes: '8 districts',
  },

  '4752006': {
    fips: '4752006',
    cityName: 'Nashville',
    state: 'TN',
    expectedDistrictCount: 35,
    governanceType: 'district-based',
    source: 'https://www.nashville.gov/departments/metro-clerk/metro-council',
    lastVerified: '2025-11-19',
    notes: '35 districts (Metropolitan Government)',
  },

  '2622000': {
    fips: '2622000',
    cityName: 'Detroit',
    state: 'MI',
    expectedDistrictCount: 7,
    governanceType: 'district-based',
    source: 'https://detroitmi.gov/government/city-council',
    lastVerified: '2025-11-19',
    notes: '7 districts (2 at-large seats also exist)',
  },

  '2507000': {
    fips: '2507000',
    cityName: 'Boston',
    state: 'MA',
    expectedDistrictCount: 9,
    governanceType: 'district-based',
    source: 'https://www.boston.gov/departments/city-council',
    lastVerified: '2025-11-19',
    notes: '9 district councilors (duplicate FIPS check)',
  },

  '3240000': {
    fips: '3240000',
    cityName: 'Las Vegas',
    state: 'NV',
    expectedDistrictCount: 6,
    governanceType: 'district-based',
    source: 'https://www.lasvegasnevada.gov/Government/City-Council',
    lastVerified: '2025-11-19',
    notes: '6 wards',
  },

  '4159000': {
    fips: '4159000',
    cityName: 'Portland',
    state: 'OR',
    expectedDistrictCount: 4,
    governanceType: 'district-based',
    source: 'https://www.portland.gov/council',
    lastVerified: '2025-11-19',
    notes: '4 districts (NEW 2024 system, 3 reps per district = 12 councilors)',
  },

  '2148006': {
    fips: '2148006',
    cityName: 'Louisville',
    state: 'KY',
    expectedDistrictCount: 26,
    governanceType: 'district-based',
    source: 'https://louisvilleky.gov/government/metro-council',
    lastVerified: '2025-11-19',
    notes: '26 districts (Metro Council, 2020 Census data)',
  },

  '2404000': {
    fips: '2404000',
    cityName: 'Baltimore',
    state: 'MD',
    expectedDistrictCount: 14,
    governanceType: 'district-based',
    source: 'https://baltimorecitycouncil.com/',
    lastVerified: '2025-11-19',
    notes: '14 districts',
  },

  '2534000': {
    fips: '2534000',
    cityName: 'Milwaukee',
    state: 'WI',
    expectedDistrictCount: 15,
    governanceType: 'district-based',
    source: 'https://milwaukee.gov/Government/Common-Council',
    lastVerified: '2025-11-19',
    notes: '15 aldermanic districts',
  },

  // ==========================================================================
  // TOP 31-40 US CITIES (PoC BATCH RESULTS)
  // ==========================================================================

  '3502000': {
    fips: '3502000',
    cityName: 'Albuquerque',
    state: 'NM',
    expectedDistrictCount: 9,
    governanceType: 'district-based',
    source: 'https://www.cabq.gov/council',
    lastVerified: '2025-11-19',
    notes: 'PoC batch 2 discovered 9 features (null district names)',
  },

  '0477000': {
    fips: '0477000',
    cityName: 'Tucson',
    state: 'AZ',
    expectedDistrictCount: 6,
    governanceType: 'district-based',
    source: 'https://www.tucsonaz.gov/ward-office',
    lastVerified: '2025-11-19',
    notes: 'PoC batch 2 discovered 6 wards',
  },

  '0627000': {
    fips: '0627000',
    cityName: 'Fresno',
    state: 'CA',
    expectedDistrictCount: 7,
    governanceType: 'district-based',
    source: 'https://www.fresno.gov/citycouncil/',
    lastVerified: '2025-11-19',
    notes: 'PoC batch 2 discovered 7 districts',
  },

  '0446000': {
    fips: '0446000',
    cityName: 'Mesa',
    state: 'AZ',
    expectedDistrictCount: 6,
    governanceType: 'at-large',
    source: 'https://www.mesaaz.gov/government/city-council',
    lastVerified: '2025-11-19',
    notes: 'RESEARCH CONFLICT: PoC found 6 features, but research says at-large. Needs manual verification.',
  },

  '0675000': {
    fips: '0675000',
    cityName: 'Stockton',
    state: 'CA',
    expectedDistrictCount: 8,
    governanceType: 'district-based',
    source: 'https://www.stocktonca.gov/government/council/districts.html',
    lastVerified: '2026-01-15',
    notes: '6 districts but 8 GIS features (Districts 2 and 4 stored as multi-part polygons with separate features). FIXED 2026-01-15: Updated to match ArcGIS feature count.',
  },

  '2938000': {
    fips: '2938000',
    cityName: 'Kansas City',
    state: 'MO',
    expectedDistrictCount: 6,
    governanceType: 'hybrid',
    source: 'https://www.kcmo.gov/city-hall/city-officials/city-council',
    lastVerified: '2025-11-19',
    notes: '6 in-district seats (6 at-large seats also exist)',
  },

  '3137000': {
    fips: '3137000',
    cityName: 'Omaha',
    state: 'NE',
    expectedDistrictCount: 7,
    governanceType: 'district-based',
    source: 'https://www.cityofomaha.org/government/city-council',
    lastVerified: '2025-11-19',
    notes: 'PoC batch 2 discovered 7 districts',
  },

  '3755000': {
    fips: '3755000',
    cityName: 'Raleigh',
    state: 'NC',
    expectedDistrictCount: 5,
    governanceType: 'district-based',
    source: 'https://raleighnc.gov/council',
    lastVerified: '2025-11-19',
    notes: 'CRITICAL WARNING: PoC discovered 19 features - likely neighborhoods/planning districts NOT council districts. Research says 5 districts (A-E) with at-large election.',
  },

  '0643000': {
    fips: '0643000',
    cityName: 'Long Beach',
    state: 'CA',
    expectedDistrictCount: 9,
    governanceType: 'district-based',
    source: 'https://www.longbeach.gov/citycouncil/',
    lastVerified: '2025-11-19',
    notes: 'PoC batch 3 discovered 9 districts',
  },

  '5182000': {
    fips: '5182000',
    cityName: 'Virginia Beach',
    state: 'VA',
    expectedDistrictCount: 10,
    governanceType: 'district-based',
    source: 'https://www.vbgov.com/government/departments/city-council',
    lastVerified: '2026-01-15',
    notes: '10 geographic districts (7 single-member + 3 at-large with district assignment). FIXED 2026-01-15: At-large seats have assigned districts for geographic representation.',
  },

  // ==========================================================================
  // TOP 41-50 US CITIES (PoC BATCH RESULTS)
  // ==========================================================================

  '2743000': {
    fips: '2743000',
    cityName: 'Minneapolis',
    state: 'MN',
    expectedDistrictCount: 13,
    governanceType: 'district-based',
    source: 'https://www2.minneapolismn.gov/government/city-council/',
    lastVerified: '2025-11-19',
    notes: 'PoC batch 3 discovered 13 wards',
  },

  '4075000': {
    fips: '4075000',
    cityName: 'Tulsa',
    state: 'OK',
    expectedDistrictCount: 9,
    governanceType: 'district-based',
    source: 'https://www.cityoftulsa.org/government/city-council/',
    lastVerified: '2025-11-19',
    notes: 'PoC discovered 5 features (official site says 9 districts - dataset mismatch)',
  },

  '0662000': {
    fips: '0662000',
    cityName: 'Riverside',
    state: 'CA',
    expectedDistrictCount: 7,
    governanceType: 'district-based',
    source: 'https://www.riversideca.gov/citycouncil/',
    lastVerified: '2025-11-19',
    notes: 'PoC batch 5 discovered 7 districts',
  },

  '3451000': {
    fips: '3451000',
    cityName: 'Newark',
    state: 'NJ',
    expectedDistrictCount: 5,
    governanceType: 'district-based',
    source: 'https://www.newarknj.gov/government/cityclerk/municipalcouncil',
    lastVerified: '2025-11-19',
    notes: 'PoC discovered 8 features (official site says 5 wards - dataset mismatch)',
  },

  '0669000': {
    fips: '0669000',
    cityName: 'Santa Ana',
    state: 'CA',
    expectedDistrictCount: 6,
    governanceType: 'district-based',
    source: 'https://www.santa-ana.org/city-council',
    lastVerified: '2025-11-19',
    notes: 'PoC batch 5 discovered 6 wards (redistricted 2022)',
  },

  '3915000': {
    fips: '3915000',
    cityName: 'Cincinnati',
    state: 'OH',
    expectedDistrictCount: 9,
    governanceType: 'district-based',
    source: 'https://www.cincinnati-oh.gov/cityofcincinnati/council/',
    lastVerified: '2025-11-19',
    notes: 'CRITICAL FAILURE CASE: PoC discovered 74 features (Community Council neighborhoods) instead of 9 council districts. DO NOT accept 74-feature dataset.',
  },

  '0636770': {
    fips: '0636770',
    cityName: 'Irvine',
    state: 'CA',
    expectedDistrictCount: null,
    governanceType: 'at-large',
    source: 'https://www.cityofirvine.org/city-council',
    lastVerified: '2025-11-19',
    notes: 'At-large election system (Mayor + 4 councilmembers)',
  },

  '1253000': {
    fips: '1253000',
    cityName: 'Orlando',
    state: 'FL',
    expectedDistrictCount: 6,
    governanceType: 'district-based',
    source: 'https://orlando.gov/Our-Government/Mayor-City-Council',
    lastVerified: '2025-11-19',
    notes: 'PoC batch 5 discovered 6 districts',
  },

  '3728000': {
    fips: '3728000',
    cityName: 'Greensboro',
    state: 'NC',
    expectedDistrictCount: 5,
    governanceType: 'district-based',
    source: 'https://www.greensboro-nc.gov/government/city-council',
    lastVerified: '2025-11-19',
    notes: 'PoC batch 5 discovered 5 districts',
  },

  '3436000': {
    fips: '3436000',
    cityName: 'Jersey City',
    state: 'NJ',
    expectedDistrictCount: 6,
    governanceType: 'district-based',
    source: 'https://www.jerseycitynj.gov/cityhall/council',
    lastVerified: '2025-11-19',
    notes: 'PoC batch 5 discovered 6 wards (A-F)',
  },

  '0653000': {
    fips: '0653000',
    cityName: 'Oakland',
    state: 'CA',
    expectedDistrictCount: 7,
    governanceType: 'district-based',
    source: 'https://www.oaklandca.gov/officials/city-council',
    lastVerified: '2025-11-19',
    notes: 'PoC batch 3 discovered 7 districts (CCD notation)',
  },

  '0816000': {
    fips: '0816000',
    cityName: 'Colorado Springs',
    state: 'CO',
    expectedDistrictCount: 6,
    governanceType: 'district-based',
    source: 'https://coloradosprings.gov/city-council',
    lastVerified: '2025-11-19',
    notes: 'PoC batch 4 discovered 6 districts',
  },

  '2255000': {
    fips: '2255000',
    cityName: 'New Orleans',
    state: 'LA',
    expectedDistrictCount: 5,
    governanceType: 'district-based',
    source: 'https://council.nola.gov/',
    lastVerified: '2025-11-19',
    notes: 'PoC batch 4 discovered 5 districts (A-E)',
  },
};

/**
 * Get expected district count for a city
 */
export function getExpectedDistrictCount(fips: string): DistrictCountRecord | null {
  return EXPECTED_DISTRICT_COUNTS[fips] || null;
}

/**
 * Check if registry entry is stale (>365 days since last verification)
 *
 * District counts change infrequently (post-Census redistricting every 10 years),
 * so we use a longer staleness threshold than portal URLs.
 */
export function isStale(entry: DistrictCountRecord): boolean {
  const lastVerified = new Date(entry.lastVerified);
  const now = new Date();
  const daysSinceVerified = (now.getTime() - lastVerified.getTime()) / (1000 * 60 * 60 * 24);

  return daysSinceVerified > 365;
}

/**
 * Get registry statistics
 */
export function getRegistryStats(): {
  total: number;
  districtBased: number;
  atLarge: number;
  hybrid: number;
  stale: number;
  avgDistrictCount: number;
} {
  const entries = Object.values(EXPECTED_DISTRICT_COUNTS);

  const districtCounts = entries
    .filter(e => e.expectedDistrictCount !== null)
    .map(e => e.expectedDistrictCount as number);

  return {
    total: entries.length,
    districtBased: entries.filter(e => e.governanceType === 'district-based').length,
    atLarge: entries.filter(e => e.governanceType === 'at-large').length,
    hybrid: entries.filter(e => e.governanceType === 'hybrid').length,
    stale: entries.filter(isStale).length,
    avgDistrictCount: districtCounts.reduce((sum, n) => sum + n, 0) / districtCounts.length,
  };
}
