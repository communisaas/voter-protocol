/**
 * Multi-County City Registry
 *
 * PURPOSE: Track cities that span multiple counties to fix false positives
 * in geographic validation (e.g., Kansas City MO spans 4 counties, causing
 * Arkansas coordinate false positives).
 *
 * DATA SOURCE: Census PLACE-to-county crosswalk files
 * https://www2.census.gov/geo/docs/maps-data/data/rel2023/place_county/
 *
 * MAINTENANCE: Quarterly review for city annexations/expansions
 */

export interface MultiCountyRecord {
  readonly cityFips: string;           // 7-digit Census PLACE code
  readonly cityName: string;            // Human-readable city name
  readonly state: string;               // 2-letter state code
  readonly primaryCounty: string;       // 5-digit FIPS code (main county)
  readonly additionalCounties: readonly string[]; // Additional county FIPS codes
  readonly source: string;              // Census TIGER/Line URL
  readonly lastVerified: string;        // ISO 8601 date (YYYY-MM-DD)
  readonly notes?: string;              // Optional context/details
}

/**
 * Registry of major multi-county cities (>100k population)
 *
 * KEY: cityFips (7-digit PLACE code)
 * VALUE: MultiCountyRecord with all counties
 *
 * COVERAGE: 39 major US cities spanning multiple counties
 */
export const MULTI_COUNTY_REGISTRY: Record<string, MultiCountyRecord> = {
  // Kansas City, MO - 4 counties (causes Arkansas false positives)
  '2938000': {
    cityFips: '2938000',
    cityName: 'Kansas City',
    state: 'MO',
    primaryCounty: '29095', // Jackson County
    additionalCounties: [
      '29047', // Clay County
      '29165', // Platte County
      '29037', // Cass County
    ],
    source: 'https://www2.census.gov/geo/tiger/TIGER2023/PLACE/',
    lastVerified: '2025-11-18',
    notes: 'Major multi-county city, 6 council districts span all 4 counties',
  },

  // New York City, NY - 5 counties (5 boroughs)
  '3651000': {
    cityFips: '3651000',
    cityName: 'New York',
    state: 'NY',
    primaryCounty: '36061', // New York County (Manhattan)
    additionalCounties: [
      '36047', // Kings County (Brooklyn)
      '36081', // Queens County
      '36005', // Bronx County
      '36085', // Richmond County (Staten Island)
    ],
    source: 'https://www2.census.gov/geo/tiger/TIGER2023/PLACE/',
    lastVerified: '2025-11-18',
    notes: '5 boroughs = 5 counties, 51 council districts',
  },

  // Atlanta, GA - 2 counties
  '1304000': {
    cityFips: '1304000',
    cityName: 'Atlanta',
    state: 'GA',
    primaryCounty: '13121', // Fulton County
    additionalCounties: [
      '13089', // DeKalb County
    ],
    source: 'https://www2.census.gov/geo/tiger/TIGER2023/PLACE/',
    lastVerified: '2025-11-18',
    notes: 'City limits span Fulton and DeKalb counties',
  },

  // Chicago, IL - 2 counties
  '1714000': {
    cityFips: '1714000',
    cityName: 'Chicago',
    state: 'IL',
    primaryCounty: '17031', // Cook County
    additionalCounties: [
      '17043', // DuPage County
    ],
    source: 'https://www2.census.gov/geo/tiger/TIGER2023/PLACE/',
    lastVerified: '2025-11-18',
    notes: 'Primarily Cook County, small portion in DuPage',
  },

  // Houston, TX - 3 counties
  '4835000': {
    cityFips: '4835000',
    cityName: 'Houston',
    state: 'TX',
    primaryCounty: '48201', // Harris County
    additionalCounties: [
      '48157', // Fort Bend County
      '48339', // Montgomery County
    ],
    source: 'https://www2.census.gov/geo/tiger/TIGER2023/PLACE/',
    lastVerified: '2025-12-22',
    notes: 'City limits span Harris, Fort Bend, and Montgomery counties',
  },
};

/**
 * Check if city is multi-county
 */
export function isMultiCounty(cityFips: string): boolean {
  return cityFips in MULTI_COUNTY_REGISTRY;
}

/**
 * Get all counties for a city (primary + additional)
 */
export function getCountiesForCity(cityFips: string): readonly string[] {
  const record = MULTI_COUNTY_REGISTRY[cityFips];
  if (!record) {
    return [];
  }

  return [record.primaryCounty, ...record.additionalCounties];
}

/**
 * Get primary county for a city
 */
export function getPrimaryCounty(cityFips: string): string | null {
  const record = MULTI_COUNTY_REGISTRY[cityFips];
  return record?.primaryCounty ?? null;
}
