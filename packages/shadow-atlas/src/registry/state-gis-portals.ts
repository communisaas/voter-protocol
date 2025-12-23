/**
 * State GIS Clearinghouse Registry
 *
 * PHILOSOPHY: States are legally mandated to maintain electoral district boundaries.
 * When city portals fail, state GIS clearinghouses are the AUTHORITATIVE fallback.
 *
 * AUTHORITY HIERARCHY:
 * 1. Municipal portal (data.{city}.gov) - Highest precision, lowest reliability
 * 2. State GIS clearinghouse - High precision, high reliability, authoritative
 * 3. Federal data (Census TIGER) - Medium precision, universal coverage
 *
 * EXAMPLE: Urban Honolulu
 * - City portal search failed (name mismatch in US Census Places)
 * - State GIS (Hawaii Statewide GIS Program) has authoritative data
 * - geodata.hawaii.gov/arcgis/rest/services/AdminBnd/MapServer/11
 */

import type { PortalType } from '../types/discovery.js';

// ============================================================================
// Legislative District Types (State Batch Extraction)
// ============================================================================

/**
 * Legislative district layer types
 *
 * These are the boundary types we extract for state batch processing:
 * - congressional: U.S. House of Representatives districts
 * - state_senate: State Senate/Upper chamber districts
 * - state_house: State House/Lower chamber districts
 * - county: County boundaries (for jurisdiction validation)
 */
export type LegislativeLayerType =
  | 'congressional'
  | 'state_senate'
  | 'state_house'
  | 'county';

/**
 * Legislative district layer endpoint
 *
 * Maps a legislative layer type to its REST/API endpoint on the state portal.
 * These are authoritative sources that update faster than TIGER during
 * redistricting cycles (Jan-Jun of years ending in 2).
 */
export interface LegislativeLayer {
  /** Layer type */
  readonly type: LegislativeLayerType;

  /** REST endpoint or feature service URL */
  readonly endpoint: string;

  /** Number of districts expected (for validation) */
  readonly expectedCount: number;

  /** Data vintage year (post-2020 redistricting should be 2022+) */
  readonly vintage: number;

  /** Last verified date */
  readonly lastVerified: string;

  /** Notes about this layer */
  readonly notes?: string;
}

/**
 * Authority level for state sources
 *
 * During redistricting gaps (Jan-Jun of years ending in 2), state sources
 * may be more authoritative than TIGER:
 * - state-redistricting-commission: Official map drawers (HIGHEST during gaps)
 * - state-gis: State GIS clearinghouses (HIGH during gaps)
 *
 * @see tiger-authority-rules.ts for precedence logic
 */
export type StateAuthorityLevel =
  | 'state-redistricting-commission'
  | 'state-gis'
  | 'federal-mandate'
  | 'arcgis-hub'
  | 'tiger';

// ============================================================================
// Portal Interface
// ============================================================================

/**
 * State GIS portal registry entry
 */
export interface StateGISPortal {
  /** Two-letter state code */
  readonly state: string;

  /** State name (for documentation) */
  readonly stateName: string;

  /** Portal base URL */
  readonly portalUrl: string;

  /** Portal type (ArcGIS Hub, Socrata, CKAN, custom) */
  readonly portalType: PortalType;

  /** Search strategy for this portal */
  readonly searchStrategy: 'hub-api' | 'rest-api' | 'direct-layer' | 'catalog-api';

  /** Known municipal boundary layers (if searchStrategy is 'direct-layer') */
  readonly municipalBoundaryLayers?: readonly MunicipalLayer[];

  /** Legislative district layers for state batch extraction */
  readonly legislativeDistrictLayers?: readonly LegislativeLayer[];

  /** Authority level for legislative boundaries */
  readonly legislativeAuthority?: StateAuthorityLevel;

  /** Data quality/freshness rating */
  readonly authority: 'high' | 'medium';

  /** Notes about portal coverage and quirks */
  readonly notes: string;

  /** Update frequency */
  readonly updateSchedule: 'annual' | 'quarterly' | 'event-driven' | 'manual';

  /** Contact info for data issues */
  readonly contact?: string;
}

/**
 * Known municipal boundary layer (for direct-layer strategy)
 */
export interface MunicipalLayer {
  /** Layer path or ID */
  readonly layer: string;

  /** Which cities/counties this layer covers */
  readonly coverage: string;

  /** Number of features (districts) in layer */
  readonly featureCount?: number;

  /** Last verified date (ISO 8601) */
  readonly lastVerified?: string;
}

/**
 * State GIS Clearinghouse Registry
 *
 * COVERAGE:
 * - High-quality portals: 18 states with comprehensive municipal boundary data
 * - Medium-quality portals: 28 states with partial coverage
 * - No portal: 4 states (rely on Census TIGER fallback)
 *
 * GOAL: Resolve 10-20% of city portal failures (2,000-4,000 cities)
 */
export const STATE_GIS_PORTALS: Record<string, StateGISPortal> = {
  /**
   * HIGH-QUALITY STATE PORTALS
   * These states have comprehensive, well-maintained municipal boundary data
   */

  'HI': {
    state: 'HI',
    stateName: 'Hawaii',
    portalUrl: 'https://geodata.hawaii.gov',
    portalType: 'arcgis',
    searchStrategy: 'direct-layer',
    authority: 'high',
    municipalBoundaryLayers: [
      {
        layer: 'AdminBnd/MapServer/11',
        coverage: 'Honolulu County Council Districts',
        featureCount: 9,
        lastVerified: '2025-11-20',
      },
      {
        layer: 'AdminBnd/MapServer/9',
        coverage: 'Hawaii County Council Districts',
        featureCount: 9,
        lastVerified: '2025-11-20',
      },
      {
        layer: 'AdminBnd/MapServer/10',
        coverage: 'Kauai County Council Districts',
        featureCount: 7,
        lastVerified: '2025-11-20',
      },
      {
        layer: 'AdminBnd/MapServer/12',
        coverage: 'Maui County Council Districts',
        featureCount: 9,
        lastVerified: '2025-11-20',
      },
    ],
    updateSchedule: 'event-driven',
    notes: 'Hawaii Statewide GIS Program - Authoritative source for ALL Hawaiian municipal boundaries (Hawaii has no incorporated places, only county council districts)',
    contact: 'https://planning.hawaii.gov/gis/',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 2,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Hawaii 2 congressional districts (119th Congress) via TIGERweb. Query: STATE=15',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 25,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Hawaii 25 State Senate districts via TIGERweb. Query: STATE=15',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 51,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Hawaii 51 State House districts via TIGERweb. Query: STATE=15',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 5,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Hawaii 5 counties via TIGERweb. Query: STATE=15',
      },
    ],
  },

  'CO': {
    state: 'CO',
    stateName: 'Colorado',
    portalUrl: 'https://data.colorado.gov',
    portalType: 'socrata',
    searchStrategy: 'catalog-api',
    authority: 'high',
    updateSchedule: 'quarterly',
    notes: 'Colorado Information Marketplace - Comprehensive municipal boundary coverage for 271 municipalities. Strong coverage of Front Range cities (Denver, Colorado Springs, Aurora, Fort Collins).',
    contact: 'oit_gis@state.co.us',
    // Legislative districts via TIGERweb (Census authoritative data)
    // Colorado gained 1 congressional seat in 2020 census (7→8)
    // Colorado uses independent redistricting commissions for highest-quality maps
    // Uses state filter: STATE='08' for Colorado FIPS code
    legislativeAuthority: 'state-redistricting-commission',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 8,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Colorado 8 congressional districts (119th Congress) via TIGERweb. Query: STATE=08',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 35,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Colorado 35 State Senate districts via TIGERweb. Query: STATE=08',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 65,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Colorado 65 State House districts via TIGERweb. Query: STATE=08',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 64,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Colorado 64 counties via TIGERweb. Query: STATE=08',
      },
    ],
  },

  'MN': {
    state: 'MN',
    stateName: 'Minnesota',
    portalUrl: 'https://gisdata.mn.gov',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'high',
    updateSchedule: 'annual',
    notes: 'Minnesota Geospatial Commons - Metropolitan Council maintains Twin Cities boundaries. Excellent coverage for Minneapolis, St. Paul, and metro area municipalities.',
    contact: 'gisinfo.mngeo@state.mn.us',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 8,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Minnesota 8 congressional districts (119th Congress) via TIGERweb. Query: STATE=27',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 67,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Minnesota 67 State Senate districts via TIGERweb. Query: STATE=27',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 134,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Minnesota 134 State House districts via TIGERweb. Query: STATE=27',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 87,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Minnesota 87 counties via TIGERweb. Query: STATE=27',
      },
    ],
  },

  'WA': {
    state: 'WA',
    stateName: 'Washington',
    portalUrl: 'https://geo.wa.gov',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'high',
    updateSchedule: 'annual',
    notes: 'Washington State Geospatial Data Archive - Comprehensive coverage. Framework data program ensures high quality for Seattle, Tacoma, Spokane, Vancouver, and all incorporated cities.',
    contact: 'wagda@uw.edu',
    legislativeAuthority: 'state-redistricting-commission',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 10,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Washington 10 congressional districts (119th Congress). Independent redistricting commission. Query: STATE=53',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 49,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Washington 49 State Senate districts via TIGERweb. Query: STATE=53',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 98,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Washington 98 State House districts via TIGERweb. Query: STATE=53',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 39,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Washington 39 counties via TIGERweb. Query: STATE=53',
      },
    ],
  },

  'OR': {
    state: 'OR',
    stateName: 'Oregon',
    portalUrl: 'https://spatialdata.oregonexplorer.info',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'high',
    updateSchedule: 'annual',
    notes: 'Oregon Spatial Data Library - Framework data program. Strong coverage for Portland metro, Eugene, Salem, Bend.',
    contact: 'info@oregonexplorer.info',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 6,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Oregon 6 congressional districts (119th Congress). Gained 1 seat in 2020 census (5→6). Query: STATE=41',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 30,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Oregon 30 State Senate districts via TIGERweb. Query: STATE=41',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 60,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Oregon 60 State House districts via TIGERweb. Query: STATE=41',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 36,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Oregon 36 counties via TIGERweb. Query: STATE=41',
      },
    ],
  },

  'CA': {
    state: 'CA',
    stateName: 'California',
    portalUrl: 'https://gis.data.ca.gov',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'medium',
    updateSchedule: 'manual',
    notes: 'California Open Data Portal - Variable quality. Some cities self-publish (Los Angeles, San Diego, San Jose excellent), others lag. Use as secondary after city portal failure.',
    contact: 'gis@opr.ca.gov',
    legislativeAuthority: 'state-redistricting-commission',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 52,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'California 52 congressional districts (119th Congress). Lost 1 seat in 2020 census (53→52). Independent redistricting commission. Query: STATE=06',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 40,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'California 40 State Senate districts via TIGERweb. Query: STATE=06',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 80,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'California 80 State Assembly districts via TIGERweb. Query: STATE=06',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 58,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'California 58 counties via TIGERweb. Query: STATE=06',
      },
    ],
  },

  'TX': {
    state: 'TX',
    stateName: 'Texas',
    portalUrl: 'https://data.tnris.org',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'high',
    updateSchedule: 'quarterly',
    notes: 'Texas Natural Resources Information System (TNRIS) - Authoritative statewide coverage. Strong for Houston, Dallas, Austin, San Antonio, Fort Worth.',
    contact: 'tnris@twdb.texas.gov',
    // Legislative districts via TIGERweb (Census authoritative data)
    // Texas gained 2 congressional seats in 2020 census (36→38)
    // Uses state filter: STATE='48' for Texas FIPS code
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 38,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Texas 38 congressional districts (119th Congress) via TIGERweb. Query: STATE=48',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 31,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Texas 31 State Senate districts via TIGERweb. Query: STATE=48',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 150,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Texas 150 State House districts via TIGERweb. Query: STATE=48',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 254,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Texas 254 counties (most of any state) via TIGERweb. Query: STATE=48',
      },
    ],
  },

  'FL': {
    state: 'FL',
    stateName: 'Florida',
    portalUrl: 'https://geodata.floridagio.gov',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'high',
    updateSchedule: 'quarterly',
    notes: 'Florida Geographic Data Library - Comprehensive county and municipal boundaries. Excellent coverage for Miami, Tampa, Orlando, Jacksonville.',
    contact: 'gis@dms.myflorida.com',
    // Legislative districts via TIGERweb (Census authoritative data)
    // Florida gained 1 congressional seat in 2020 census (27→28)
    // Uses state filter: STATE='12' for Florida FIPS code
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 28,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Florida 28 congressional districts (119th Congress) via TIGERweb. Query: STATE=12',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 40,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Florida 40 State Senate districts via TIGERweb. Query: STATE=12',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 120,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Florida 120 State House districts via TIGERweb. Query: STATE=12',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 67,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Florida 67 counties via TIGERweb. Query: STATE=12',
      },
    ],
  },

  'NY': {
    state: 'NY',
    stateName: 'New York',
    portalUrl: 'https://gis.ny.gov',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'high',
    updateSchedule: 'annual',
    notes: 'NYS GIS Clearinghouse - Authoritative statewide data. Strong for NYC, Buffalo, Rochester, Syracuse, Albany.',
    contact: 'gis.sm@its.ny.gov',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 26,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'New York 26 congressional districts (119th Congress). Lost 1 seat in 2020 census (27→26). 2024 court-ordered redistricting. Query: STATE=36',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 63,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'New York 63 State Senate districts via TIGERweb. Query: STATE=36',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 150,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'New York 150 State Assembly districts via TIGERweb. Query: STATE=36',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 62,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'New York 62 counties via TIGERweb. Query: STATE=36',
      },
    ],
  },

  'PA': {
    state: 'PA',
    stateName: 'Pennsylvania',
    portalUrl: 'https://www.pasda.psu.edu',
    portalType: 'ckan',
    searchStrategy: 'catalog-api',
    authority: 'high',
    updateSchedule: 'annual',
    notes: 'Pennsylvania Spatial Data Access (PASDA) - Penn State hosted. Comprehensive coverage for Philadelphia, Pittsburgh, Allentown, Erie.',
    contact: 'pasda@psu.edu',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 17,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Pennsylvania 17 congressional districts (119th Congress). Lost 1 seat in 2020 census (18→17). Query: STATE=42',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 50,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Pennsylvania 50 State Senate districts via TIGERweb. Query: STATE=42',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 203,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Pennsylvania 203 State House districts via TIGERweb. Query: STATE=42',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 67,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Pennsylvania 67 counties via TIGERweb. Query: STATE=42',
      },
    ],
  },

  'IL': {
    state: 'IL',
    stateName: 'Illinois',
    portalUrl: 'https://clearinghouse.isgs.illinois.edu',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'high',
    updateSchedule: 'annual',
    notes: 'Illinois Geospatial Data Clearinghouse - Authoritative boundaries. Excellent Chicago coverage, strong for Rockford, Aurora, Naperville.',
    contact: 'isgs-gis@illinois.edu',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 17,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Illinois 17 congressional districts (119th Congress). Lost 1 seat in 2020 census (18→17). Query: STATE=17',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 59,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Illinois 59 State Senate districts via TIGERweb. Query: STATE=17',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 118,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Illinois 118 State House districts via TIGERweb. Query: STATE=17',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 102,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Illinois 102 counties via TIGERweb. Query: STATE=17',
      },
    ],
  },

  'OH': {
    state: 'OH',
    stateName: 'Ohio',
    portalUrl: 'https://ogrip.oit.ohio.gov',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'high',
    updateSchedule: 'annual',
    notes: 'Ohio Geographically Referenced Information Program (OGRIP) - Comprehensive statewide framework. Strong for Columbus, Cleveland, Cincinnati, Toledo.',
    contact: 'ogrip@ohio.gov',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 15,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Ohio 15 congressional districts (119th Congress). Lost 1 seat in 2020 census (16→15). Query: STATE=39',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 33,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Ohio 33 State Senate districts via TIGERweb. Query: STATE=39',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 99,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Ohio 99 State House districts via TIGERweb. Query: STATE=39',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 88,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Ohio 88 counties via TIGERweb. Query: STATE=39',
      },
    ],
  },

  'MI': {
    state: 'MI',
    stateName: 'Michigan',
    portalUrl: 'https://gis-michigan.opendata.arcgis.com',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'high',
    updateSchedule: 'annual',
    notes: 'Michigan Geographic Framework - Authoritative municipal boundaries. Excellent for Detroit, Grand Rapids, Warren, Sterling Heights.',
    contact: 'gis-michigan@michigan.gov',
    legislativeAuthority: 'state-redistricting-commission',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 13,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Michigan 13 congressional districts (119th Congress). Lost 1 seat in 2020 census (14→13). Independent redistricting commission. Query: STATE=26',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 38,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Michigan 38 State Senate districts via TIGERweb. Query: STATE=26',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 110,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Michigan 110 State House districts via TIGERweb. Query: STATE=26',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 83,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Michigan 83 counties via TIGERweb. Query: STATE=26',
      },
    ],
  },

  'NC': {
    state: 'NC',
    stateName: 'North Carolina',
    portalUrl: 'https://www.nconemap.gov',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'high',
    updateSchedule: 'quarterly',
    notes: 'NC OneMap - Authoritative statewide geospatial portal. Strong coverage for Charlotte, Raleigh, Greensboro, Durham, Winston-Salem.',
    contact: 'dataq@nc.gov',
    // Legislative districts via TIGERweb (Census authoritative data)
    // North Carolina gained 1 congressional seat in 2020 census (13→14)
    // Uses state filter: STATE='37' for North Carolina FIPS code
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 14,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'North Carolina 14 congressional districts (119th Congress) via TIGERweb. Query: STATE=37',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 50,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'North Carolina 50 State Senate districts via TIGERweb. Query: STATE=37',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 120,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'North Carolina 120 State House districts via TIGERweb. Query: STATE=37',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 100,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'North Carolina 100 counties via TIGERweb. Query: STATE=37',
      },
    ],
  },

  'VA': {
    state: 'VA',
    stateName: 'Virginia',
    portalUrl: 'https://vgin.vdem.virginia.gov',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'high',
    updateSchedule: 'annual',
    notes: 'Virginia Geographic Information Network (VGIN) - Comprehensive municipal data. Excellent for Virginia Beach, Norfolk, Chesapeake, Richmond, Arlington.',
    contact: 'vgin@vdem.virginia.gov',
    legislativeAuthority: 'state-redistricting-commission',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 11,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Virginia 11 congressional districts (119th Congress). Independent redistricting commission. Query: STATE=51',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 40,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Virginia 40 State Senate districts via TIGERweb. Query: STATE=51',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 100,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Virginia 100 State House (House of Delegates) districts via TIGERweb. Query: STATE=51',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 133,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Virginia 95 counties + 38 independent cities via TIGERweb. Query: STATE=51',
      },
    ],
  },

  'GA': {
    state: 'GA',
    stateName: 'Georgia',
    portalUrl: 'https://data.georgiaspatial.org',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'high',
    updateSchedule: 'annual',
    notes: 'Georgia GIS Clearinghouse - Authoritative framework data. Strong coverage for Atlanta metro, Savannah, Columbus, Augusta.',
    contact: 'gis@dca.ga.gov',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 14,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Georgia 14 congressional districts (119th Congress). 2024 court-ordered redistricting for VRA compliance. Query: STATE=13',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 56,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Georgia 56 State Senate districts via TIGERweb. Query: STATE=13',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 180,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Georgia 180 State House districts via TIGERweb. Query: STATE=13',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 159,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Georgia 159 counties (second most of any state) via TIGERweb. Query: STATE=13',
      },
    ],
  },

  'MA': {
    state: 'MA',
    stateName: 'Massachusetts',
    portalUrl: 'https://www.mass.gov/info-details/massgis-data-layers',
    portalType: 'custom-api',
    searchStrategy: 'rest-api',
    authority: 'high',
    updateSchedule: 'annual',
    notes: 'MassGIS - Office of Geographic Information. Comprehensive coverage for Boston metro, Worcester, Springfield, Cambridge.',
    contact: 'massgis@mass.gov',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 9,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Massachusetts 9 congressional districts (119th Congress) via TIGERweb. Query: STATE=25',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 40,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Massachusetts 40 State Senate districts via TIGERweb. Query: STATE=25',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 160,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Massachusetts 160 State House districts via TIGERweb. Query: STATE=25',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 14,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Massachusetts 14 counties via TIGERweb. Query: STATE=25',
      },
    ],
  },

  'WI': {
    state: 'WI',
    stateName: 'Wisconsin',
    portalUrl: 'https://data-wi-dnr.opendata.arcgis.com',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'high',
    updateSchedule: 'annual',
    notes: 'Wisconsin State Cartographer Office - Framework data program. Excellent for Milwaukee, Madison, Green Bay, Kenosha.',
    contact: 'sco@wisc.edu',
    // Legislative districts via TIGERweb (Census authoritative data)
    // Uses state filter: STATE='55' for Wisconsin FIPS code
    // Note: Wisconsin LTSB (gis-ltsb.hub.arcgis.com) has state-specific data but
    // TIGERweb provides reliable REST API access
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        // TIGERweb 119th Congressional Districts (layer 0), filtered to Wisconsin (STATE=55)
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 8,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Wisconsin 8 congressional districts (119th Congress) via TIGERweb. Query: STATE=55',
      },
      {
        type: 'state_senate',
        // TIGERweb 2024 State Legislative Districts - Upper (layer 1), filtered to Wisconsin
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 33,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Wisconsin 33 State Senate districts via TIGERweb. Query: STATE=55',
      },
      {
        type: 'state_house',
        // TIGERweb 2024 State Legislative Districts - Lower (layer 2), filtered to Wisconsin
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 99,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Wisconsin 99 State Assembly districts via TIGERweb. Query: STATE=55',
      },
      {
        type: 'county',
        // TIGERweb Counties layer, filtered to Wisconsin
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 72,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Wisconsin 72 counties via TIGERweb. Query: STATE=55',
      },
    ],
  },

  /**
   * MEDIUM-QUALITY STATE PORTALS
   * These states have partial coverage or less frequent updates
   */

  'AZ': {
    state: 'AZ',
    stateName: 'Arizona',
    portalUrl: 'https://azgeo-open-data-agic.hub.arcgis.com',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'medium',
    updateSchedule: 'manual',
    notes: 'Arizona Geographic Information Council (AGIC) - Variable quality. Phoenix and Tucson publish independently (prefer city portals first).',
    contact: 'azgeo@azdoa.gov',
    legislativeAuthority: 'state-redistricting-commission',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 9,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Arizona 9 congressional districts (119th Congress) via TIGERweb. Independent redistricting commission. Query: STATE=04',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 30,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Arizona 30 State Senate districts via TIGERweb. Query: STATE=04',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 60,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Arizona 60 State House districts via TIGERweb. Query: STATE=04',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 15,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Arizona 15 counties via TIGERweb. Query: STATE=04',
      },
    ],
  },

  'NV': {
    state: 'NV',
    stateName: 'Nevada',
    portalUrl: 'https://www.nbmg.unr.edu/nris',
    portalType: 'custom-api',
    searchStrategy: 'rest-api',
    authority: 'medium',
    updateSchedule: 'manual',
    notes: 'Nevada Natural Resources Information System (NRIS) - Limited municipal coverage. Las Vegas and Reno prefer city portals.',
    contact: 'nris@unr.edu',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 4,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Nevada 4 congressional districts (119th Congress) via TIGERweb. Query: STATE=32',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 21,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Nevada 21 State Senate districts via TIGERweb. Query: STATE=32',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 42,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Nevada 42 State Assembly districts via TIGERweb. Query: STATE=32',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 17,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Nevada 16 counties + 1 independent city (Carson City) via TIGERweb. Query: STATE=32',
      },
    ],
  },

  'UT': {
    state: 'UT',
    stateName: 'Utah',
    portalUrl: 'https://gis.utah.gov',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'high',
    updateSchedule: 'quarterly',
    notes: 'Utah Automated Geographic Reference Center (AGRC) - Excellent statewide framework. Strong for Salt Lake City, Provo, West Valley City.',
    contact: 'agrc@utah.gov',
    legislativeAuthority: 'state-redistricting-commission',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 4,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Utah 4 congressional districts (119th Congress). Independent redistricting commission. Query: STATE=49',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 29,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Utah 29 State Senate districts via TIGERweb. Query: STATE=49',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 75,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Utah 75 State House districts via TIGERweb. Query: STATE=49',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 29,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Utah 29 counties via TIGERweb. Query: STATE=49',
      },
    ],
  },

  'NM': {
    state: 'NM',
    stateName: 'New Mexico',
    portalUrl: 'https://rgis.unm.edu',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'medium',
    updateSchedule: 'manual',
    notes: 'Resource Geographic Information System (RGIS) - University of New Mexico hosted. Partial municipal coverage.',
    contact: 'rgis@unm.edu',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 3,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'New Mexico 3 congressional districts (119th Congress) via TIGERweb. Query: STATE=35',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 42,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'New Mexico 42 State Senate districts via TIGERweb. Query: STATE=35',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 70,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'New Mexico 70 State House districts via TIGERweb. Query: STATE=35',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 33,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'New Mexico 33 counties via TIGERweb. Query: STATE=35',
      },
    ],
  },

  'ID': {
    state: 'ID',
    stateName: 'Idaho',
    portalUrl: 'https://inside.idaho.gov',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'high',
    updateSchedule: 'annual',
    notes: 'INSIDE Idaho - University of Idaho GIS portal. Strong coverage for Boise, Meridian, Nampa.',
    contact: 'inside@uidaho.edu',
    legislativeAuthority: 'state-redistricting-commission',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 2,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Idaho 2 congressional districts (119th Congress). Independent redistricting commission. Query: STATE=16',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 35,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Idaho 35 State Senate districts via TIGERweb. Query: STATE=16',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 70,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Idaho 70 State House districts via TIGERweb. Query: STATE=16',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 44,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Idaho 44 counties via TIGERweb. Query: STATE=16',
      },
    ],
  },

  'MT': {
    state: 'MT',
    stateName: 'Montana',
    portalUrl: 'https://geoinfo.msl.mt.gov',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'medium',
    updateSchedule: 'annual',
    notes: 'Montana State Library GIS - Framework data. Coverage for Billings, Missoula, Great Falls.',
    contact: 'gis@mt.gov',
    legislativeAuthority: 'state-redistricting-commission',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 2,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Montana 2 congressional districts (119th Congress). Gained 1 seat in 2020 census (1→2). Independent redistricting commission. Query: STATE=30',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 50,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Montana 50 State Senate districts via TIGERweb. Query: STATE=30',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 100,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Montana 100 State House districts via TIGERweb. Query: STATE=30',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 56,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Montana 56 counties via TIGERweb. Query: STATE=30',
      },
    ],
  },

  'WY': {
    state: 'WY',
    stateName: 'Wyoming',
    portalUrl: 'https://wygisc.uwyo.edu',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'medium',
    updateSchedule: 'manual',
    notes: 'Wyoming Geographic Information Science Center - University of Wyoming. Limited municipal coverage (small state population).',
    contact: 'wygisc@uwyo.edu',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 1,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Wyoming 1 at-large congressional district (119th Congress). Query: STATE=56',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 31,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Wyoming 31 State Senate districts via TIGERweb. Query: STATE=56',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 62,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Wyoming 62 State House districts via TIGERweb. Query: STATE=56',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 23,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Wyoming 23 counties via TIGERweb. Query: STATE=56',
      },
    ],
  },

  // ============================================================================
  // LEGISLATIVE DISTRICT CONFIGURATIONS (ALL 50 STATES)
  // Added 2025-12-17: Complete legislative boundary coverage via TIGERweb
  // ============================================================================

  'AL': {
    state: 'AL',
    stateName: 'Alabama',
    portalUrl: 'https://gis-alabama.opendata.arcgis.com',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'high',
    updateSchedule: 'annual',
    notes: 'Alabama GIS Hub - Comprehensive statewide data. Good coverage for Birmingham, Montgomery, Mobile, Huntsville.',
    contact: 'algisc@alabama.gov',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 7,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Alabama 7 congressional districts (119th Congress). Court-ordered 2023 redistricting created 2nd majority-Black district. Query: STATE=01',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 35,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Alabama 35 State Senate districts via TIGERweb. Query: STATE=01',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 105,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Alabama 105 State House districts via TIGERweb. Query: STATE=01',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 67,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Alabama 67 counties via TIGERweb. Query: STATE=01',
      },
    ],
  },

  'AK': {
    state: 'AK',
    stateName: 'Alaska',
    portalUrl: 'https://gis.data.alaska.gov',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'medium',
    updateSchedule: 'manual',
    notes: 'Alaska GIS Data Portal - Large state with limited road network. Anchorage, Fairbanks, Juneau coverage variable.',
    contact: 'gis@alaska.gov',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 1,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Alaska 1 at-large congressional district (119th Congress). Query: STATE=02',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 20,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Alaska 20 State Senate districts via TIGERweb. Each district served by 1 senator and 2 representatives. Query: STATE=02',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 40,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Alaska 40 State House districts via TIGERweb. Query: STATE=02',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 30,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Alaska 30 boroughs and census areas (county equivalents) via TIGERweb. Query: STATE=02',
      },
    ],
  },

  'AR': {
    state: 'AR',
    stateName: 'Arkansas',
    portalUrl: 'https://gis.arkansas.gov',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'medium',
    updateSchedule: 'manual',
    notes: 'Arkansas GIS Office - Coverage for Little Rock, Fort Smith, Fayetteville, Springdale.',
    contact: 'gis@arkansas.gov',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 4,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Arkansas 4 congressional districts (119th Congress) via TIGERweb. Query: STATE=05',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 35,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Arkansas 35 State Senate districts via TIGERweb. Query: STATE=05',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 100,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Arkansas 100 State House districts via TIGERweb. Query: STATE=05',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 75,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Arkansas 75 counties via TIGERweb. Query: STATE=05',
      },
    ],
  },

  'CT': {
    state: 'CT',
    stateName: 'Connecticut',
    portalUrl: 'https://portal.ct.gov/DEEP/GIS-and-Maps',
    portalType: 'custom-api',
    searchStrategy: 'rest-api',
    authority: 'medium',
    updateSchedule: 'manual',
    notes: 'Connecticut Environmental Data Portal - Hartford, New Haven, Bridgeport coverage.',
    contact: 'deep.gis@ct.gov',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 5,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Connecticut 5 congressional districts (119th Congress) via TIGERweb. Query: STATE=09',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 36,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Connecticut 36 State Senate districts via TIGERweb. Query: STATE=09',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 151,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Connecticut 151 State House districts via TIGERweb. Query: STATE=09',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 8,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Connecticut 8 counties (planning regions, no functioning government) via TIGERweb. Query: STATE=09',
      },
    ],
  },

  'DE': {
    state: 'DE',
    stateName: 'Delaware',
    portalUrl: 'https://firstmap.delaware.gov',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'medium',
    updateSchedule: 'annual',
    notes: 'Delaware FirstMap - Statewide GIS framework. Wilmington, Dover coverage.',
    contact: 'firstmap@delaware.gov',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 1,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Delaware 1 at-large congressional district (119th Congress). Query: STATE=10',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 21,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Delaware 21 State Senate districts via TIGERweb. Query: STATE=10',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 41,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Delaware 41 State House districts via TIGERweb. Query: STATE=10',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 3,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Delaware 3 counties (fewest of any state) via TIGERweb. Query: STATE=10',
      },
    ],
  },

  'IN': {
    state: 'IN',
    stateName: 'Indiana',
    portalUrl: 'https://www.indianamap.org',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'high',
    updateSchedule: 'annual',
    notes: 'IndianaMap - Comprehensive framework data. Indianapolis, Fort Wayne, Evansville coverage.',
    contact: 'igic@iu.edu',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 9,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Indiana 9 congressional districts (119th Congress) via TIGERweb. Query: STATE=18',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 50,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Indiana 50 State Senate districts via TIGERweb. Query: STATE=18',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 100,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Indiana 100 State House districts via TIGERweb. Query: STATE=18',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 92,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Indiana 92 counties via TIGERweb. Query: STATE=18',
      },
    ],
  },

  'IA': {
    state: 'IA',
    stateName: 'Iowa',
    portalUrl: 'https://geodata.iowa.gov',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'high',
    updateSchedule: 'annual',
    notes: 'Iowa Geodata - Comprehensive statewide portal. Des Moines, Cedar Rapids, Davenport coverage.',
    contact: 'gis@iowa.gov',
    legislativeAuthority: 'state-redistricting-commission',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 4,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Iowa 4 congressional districts (119th Congress). Lost 1 seat in 2020 census (5→4). Query: STATE=19',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 50,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Iowa 50 State Senate districts via TIGERweb. Query: STATE=19',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 100,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Iowa 100 State House districts via TIGERweb. Query: STATE=19',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 99,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Iowa 99 counties via TIGERweb. Query: STATE=19',
      },
    ],
  },

  'KS': {
    state: 'KS',
    stateName: 'Kansas',
    portalUrl: 'https://www.kansasgis.org',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'medium',
    updateSchedule: 'annual',
    notes: 'Kansas GIS - Wichita, Overland Park, Kansas City coverage.',
    contact: 'gis@kansas.gov',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 4,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Kansas 4 congressional districts (119th Congress) via TIGERweb. Query: STATE=20',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 40,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Kansas 40 State Senate districts via TIGERweb. Query: STATE=20',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 125,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Kansas 125 State House districts via TIGERweb. Query: STATE=20',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 105,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Kansas 105 counties via TIGERweb. Query: STATE=20',
      },
    ],
  },

  'KY': {
    state: 'KY',
    stateName: 'Kentucky',
    portalUrl: 'https://kygisserver.ky.gov',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'medium',
    updateSchedule: 'annual',
    notes: 'Kentucky Geography Network - Louisville, Lexington coverage.',
    contact: 'gis@ky.gov',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 6,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Kentucky 6 congressional districts (119th Congress) via TIGERweb. Query: STATE=21',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 38,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Kentucky 38 State Senate districts via TIGERweb. Query: STATE=21',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 100,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Kentucky 100 State House districts via TIGERweb. Query: STATE=21',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 120,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Kentucky 120 counties via TIGERweb. Query: STATE=21',
      },
    ],
  },

  'LA': {
    state: 'LA',
    stateName: 'Louisiana',
    portalUrl: 'https://atlas.ga.lsu.edu',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'medium',
    updateSchedule: 'manual',
    notes: 'Louisiana Atlas - LSU hosted. New Orleans, Baton Rouge coverage.',
    contact: 'atlas@lsu.edu',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 6,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Louisiana 6 congressional districts (119th Congress). 2024 court-ordered map with 2 majority-Black districts. Query: STATE=22',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 39,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Louisiana 39 State Senate districts via TIGERweb. Query: STATE=22',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 105,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Louisiana 105 State House districts via TIGERweb. Query: STATE=22',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 64,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Louisiana 64 parishes (county equivalents) via TIGERweb. Query: STATE=22',
      },
    ],
  },

  'ME': {
    state: 'ME',
    stateName: 'Maine',
    portalUrl: 'https://www.maine.gov/gis',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'medium',
    updateSchedule: 'annual',
    notes: 'Maine GIS - Portland, Lewiston, Bangor coverage.',
    contact: 'megis@maine.gov',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 2,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Maine 2 congressional districts (119th Congress). Uses ranked-choice voting. Query: STATE=23',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 35,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Maine 35 State Senate districts via TIGERweb. Query: STATE=23',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 151,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Maine 151 State House districts via TIGERweb. Query: STATE=23',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 16,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Maine 16 counties via TIGERweb. Query: STATE=23',
      },
    ],
  },

  'MD': {
    state: 'MD',
    stateName: 'Maryland',
    portalUrl: 'https://data.imap.maryland.gov',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'high',
    updateSchedule: 'quarterly',
    notes: 'Maryland iMAP - Authoritative statewide data. Baltimore, Annapolis, Silver Spring coverage.',
    contact: 'imap@maryland.gov',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 8,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Maryland 8 congressional districts (119th Congress) via TIGERweb. Query: STATE=24',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 47,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Maryland 47 State Senate districts via TIGERweb. Query: STATE=24',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 141,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Maryland 141 State House districts via TIGERweb (multi-member districts). Query: STATE=24',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 24,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Maryland 23 counties + 1 independent city (Baltimore) via TIGERweb. Query: STATE=24',
      },
    ],
  },

  'MS': {
    state: 'MS',
    stateName: 'Mississippi',
    portalUrl: 'https://www.maris.state.ms.us',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'medium',
    updateSchedule: 'manual',
    notes: 'Mississippi Automated Resource Information System - Jackson, Gulfport, Biloxi coverage.',
    contact: 'maris@its.ms.gov',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 4,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Mississippi 4 congressional districts (119th Congress) via TIGERweb. Query: STATE=28',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 52,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Mississippi 52 State Senate districts via TIGERweb. Query: STATE=28',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 122,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Mississippi 122 State House districts via TIGERweb. Query: STATE=28',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 82,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Mississippi 82 counties via TIGERweb. Query: STATE=28',
      },
    ],
  },

  'MO': {
    state: 'MO',
    stateName: 'Missouri',
    portalUrl: 'https://msdis.missouri.edu',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'medium',
    updateSchedule: 'annual',
    notes: 'Missouri Spatial Data Information Service - Kansas City, St. Louis coverage.',
    contact: 'msdis@missouri.edu',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 8,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Missouri 8 congressional districts (119th Congress). Lost 1 seat in 2020 census (9→8). Query: STATE=29',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 34,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Missouri 34 State Senate districts via TIGERweb. Query: STATE=29',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 163,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Missouri 163 State House districts via TIGERweb. Query: STATE=29',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 115,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Missouri 114 counties + 1 independent city (St. Louis) via TIGERweb. Query: STATE=29',
      },
    ],
  },

  'NE': {
    state: 'NE',
    stateName: 'Nebraska',
    portalUrl: 'https://nednr.nebraska.gov/GIS',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'medium',
    updateSchedule: 'annual',
    notes: 'Nebraska GIS Portal - Omaha, Lincoln coverage. Only unicameral state legislature.',
    contact: 'dnr.gis@nebraska.gov',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 3,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Nebraska 3 congressional districts (119th Congress) via TIGERweb. Query: STATE=31',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 49,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Nebraska 49 State Senate districts (unicameral, nonpartisan legislature) via TIGERweb. Query: STATE=31',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 93,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Nebraska 93 counties via TIGERweb. Note: Nebraska is unicameral (no state house). Query: STATE=31',
      },
    ],
  },

  'NH': {
    state: 'NH',
    stateName: 'New Hampshire',
    portalUrl: 'https://www.granit.unh.edu',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'high',
    updateSchedule: 'annual',
    notes: 'GRANIT - NH Geographically Referenced Analysis and Information Transfer. Manchester, Nashua, Concord coverage.',
    contact: 'granit@unh.edu',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 2,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'New Hampshire 2 congressional districts (119th Congress) via TIGERweb. Query: STATE=33',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 24,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'New Hampshire 24 State Senate districts via TIGERweb. Query: STATE=33',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 400,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'New Hampshire 400 State House districts (largest state legislature in US) via TIGERweb. Query: STATE=33',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 10,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'New Hampshire 10 counties via TIGERweb. Query: STATE=33',
      },
    ],
  },

  'NJ': {
    state: 'NJ',
    stateName: 'New Jersey',
    portalUrl: 'https://njogis-newjersey.opendata.arcgis.com',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'high',
    updateSchedule: 'quarterly',
    notes: 'NJ Office of GIS - Newark, Jersey City, Paterson, Trenton coverage.',
    contact: 'njgin@oit.nj.gov',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 12,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'New Jersey 12 congressional districts (119th Congress) via TIGERweb. Query: STATE=34',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 40,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'New Jersey 40 State Senate districts via TIGERweb. Query: STATE=34',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 80,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'New Jersey 80 State Assembly districts via TIGERweb. Query: STATE=34',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 21,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'New Jersey 21 counties via TIGERweb. Query: STATE=34',
      },
    ],
  },

  'ND': {
    state: 'ND',
    stateName: 'North Dakota',
    portalUrl: 'https://www.gis.nd.gov',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'medium',
    updateSchedule: 'annual',
    notes: 'North Dakota GIS Hub - Fargo, Bismarck coverage.',
    contact: 'gis@nd.gov',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 1,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'North Dakota 1 at-large congressional district (119th Congress). Query: STATE=38',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 47,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'North Dakota 47 State Senate districts via TIGERweb. Query: STATE=38',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 94,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'North Dakota 94 State House districts via TIGERweb. Query: STATE=38',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 53,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'North Dakota 53 counties via TIGERweb. Query: STATE=38',
      },
    ],
  },

  'OK': {
    state: 'OK',
    stateName: 'Oklahoma',
    portalUrl: 'https://data.ok.gov',
    portalType: 'socrata',
    searchStrategy: 'catalog-api',
    authority: 'medium',
    updateSchedule: 'manual',
    notes: 'Oklahoma Data Portal - Oklahoma City, Tulsa coverage.',
    contact: 'omes.gis@omes.ok.gov',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 5,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Oklahoma 5 congressional districts (119th Congress) via TIGERweb. Query: STATE=40',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 48,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Oklahoma 48 State Senate districts via TIGERweb. Query: STATE=40',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 101,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Oklahoma 101 State House districts via TIGERweb. Query: STATE=40',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 77,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Oklahoma 77 counties via TIGERweb. Query: STATE=40',
      },
    ],
  },

  'RI': {
    state: 'RI',
    stateName: 'Rhode Island',
    portalUrl: 'http://www.rigis.org',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'medium',
    updateSchedule: 'annual',
    notes: 'Rhode Island GIS - Providence, Warwick, Cranston coverage.',
    contact: 'rigis@uri.edu',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 2,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Rhode Island 2 congressional districts (119th Congress) via TIGERweb. Query: STATE=44',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 38,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Rhode Island 38 State Senate districts via TIGERweb. Query: STATE=44',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 75,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Rhode Island 75 State House districts via TIGERweb. Query: STATE=44',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 5,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Rhode Island 5 counties (no functioning government) via TIGERweb. Query: STATE=44',
      },
    ],
  },

  'SC': {
    state: 'SC',
    stateName: 'South Carolina',
    portalUrl: 'https://www.gis.sc.gov',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'medium',
    updateSchedule: 'annual',
    notes: 'South Carolina GIS Portal - Columbia, Charleston, Greenville coverage.',
    contact: 'gis@admin.sc.gov',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 7,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'South Carolina 7 congressional districts (119th Congress) via TIGERweb. Query: STATE=45',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 46,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'South Carolina 46 State Senate districts via TIGERweb. Query: STATE=45',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 124,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'South Carolina 124 State House districts via TIGERweb. Query: STATE=45',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 46,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'South Carolina 46 counties via TIGERweb. Query: STATE=45',
      },
    ],
  },

  'SD': {
    state: 'SD',
    stateName: 'South Dakota',
    portalUrl: 'https://sdgs.sd.gov',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'medium',
    updateSchedule: 'manual',
    notes: 'South Dakota GIS Services - Sioux Falls, Rapid City coverage.',
    contact: 'gis@state.sd.us',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 1,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'South Dakota 1 at-large congressional district (119th Congress). Query: STATE=46',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 35,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'South Dakota 35 State Senate districts via TIGERweb. Query: STATE=46',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 70,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'South Dakota 70 State House districts via TIGERweb. Query: STATE=46',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 66,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'South Dakota 66 counties via TIGERweb. Query: STATE=46',
      },
    ],
  },

  'TN': {
    state: 'TN',
    stateName: 'Tennessee',
    portalUrl: 'https://www.tn.gov/finance/sts-gis.html',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'medium',
    updateSchedule: 'annual',
    notes: 'Tennessee GIS Services - Nashville, Memphis, Knoxville, Chattanooga coverage.',
    contact: 'gis.services@tn.gov',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 9,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Tennessee 9 congressional districts (119th Congress) via TIGERweb. Query: STATE=47',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 33,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Tennessee 33 State Senate districts via TIGERweb. Query: STATE=47',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 99,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Tennessee 99 State House districts via TIGERweb. Query: STATE=47',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 95,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Tennessee 95 counties via TIGERweb. Query: STATE=47',
      },
    ],
  },

  'VT': {
    state: 'VT',
    stateName: 'Vermont',
    portalUrl: 'https://vcgi.vermont.gov',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'high',
    updateSchedule: 'annual',
    notes: 'Vermont Center for Geographic Information - Burlington, Essex, South Burlington coverage.',
    contact: 'vcgi@vermont.gov',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 1,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Vermont 1 at-large congressional district (119th Congress). Query: STATE=50',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 30,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Vermont 30 State Senate districts via TIGERweb. Query: STATE=50',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 150,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Vermont 150 State House districts via TIGERweb. Query: STATE=50',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 14,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'Vermont 14 counties via TIGERweb. Query: STATE=50',
      },
    ],
  },

  'WV': {
    state: 'WV',
    stateName: 'West Virginia',
    portalUrl: 'https://wvgis.wvu.edu',
    portalType: 'arcgis',
    searchStrategy: 'hub-api',
    authority: 'medium',
    updateSchedule: 'manual',
    notes: 'West Virginia GIS Technical Center - Charleston, Huntington coverage.',
    contact: 'wvgis@mail.wvu.edu',
    legislativeAuthority: 'state-gis',
    legislativeDistrictLayers: [
      {
        type: 'congressional',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
        expectedCount: 2,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'West Virginia 2 congressional districts (119th Congress). Lost 1 seat in 2020 census (3→2). Query: STATE=54',
      },
      {
        type: 'state_senate',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
        expectedCount: 17,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'West Virginia 17 State Senate DISTRICTS via TIGERweb (34 total senators: 2 per district multi-member system). Query: STATE=54',
      },
      {
        type: 'state_house',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
        expectedCount: 100,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'West Virginia 100 State House (House of Delegates) districts via TIGERweb. Query: STATE=54',
      },
      {
        type: 'county',
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/80',
        expectedCount: 55,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes: 'West Virginia 55 counties via TIGERweb. Query: STATE=54',
      },
    ],
  },
};

/**
 * Get state GIS portal for a given state
 */
export function getStatePortal(state: string): StateGISPortal | undefined {
  return STATE_GIS_PORTALS[state.toUpperCase()];
}

/**
 * Get all high-authority state portals
 */
export function getHighAuthorityPortals(): StateGISPortal[] {
  return Object.values(STATE_GIS_PORTALS).filter(p => p.authority === 'high');
}

/**
 * Get portal count by type
 */
export function getPortalStats(): {
  total: number;
  highAuthority: number;
  mediumAuthority: number;
  byPortalType: Record<PortalType, number>;
} {
  const portals = Object.values(STATE_GIS_PORTALS);

  return {
    total: portals.length,
    highAuthority: portals.filter(p => p.authority === 'high').length,
    mediumAuthority: portals.filter(p => p.authority === 'medium').length,
    byPortalType: portals.reduce((acc, p) => {
      acc[p.portalType] = (acc[p.portalType] || 0) + 1;
      return acc;
    }, {} as Record<PortalType, number>),
  };
}

// ============================================================================
// Legislative District Query Functions (State Batch Extraction)
// ============================================================================

/**
 * Get all states with legislative district layers configured
 */
export function getStatesWithLegislativeData(): StateGISPortal[] {
  return Object.values(STATE_GIS_PORTALS).filter(
    p => p.legislativeDistrictLayers && p.legislativeDistrictLayers.length > 0
  );
}

/**
 * Get legislative layers for a specific state
 */
export function getLegislativeLayers(state: string): readonly LegislativeLayer[] | undefined {
  const portal = STATE_GIS_PORTALS[state.toUpperCase()];
  return portal?.legislativeDistrictLayers;
}

/**
 * Get layer endpoint for a specific state and layer type
 */
export function getLegislativeEndpoint(
  state: string,
  layerType: LegislativeLayerType
): LegislativeLayer | undefined {
  const layers = getLegislativeLayers(state);
  return layers?.find(l => l.type === layerType);
}

/**
 * Get all states with redistricting commission authority
 *
 * These states have the HIGHEST authority for legislative boundaries
 * during redistricting gaps (Jan-Jun of years ending in 2).
 */
export function getRedistrictingCommissionStates(): StateGISPortal[] {
  return Object.values(STATE_GIS_PORTALS).filter(
    p => p.legislativeAuthority === 'state-redistricting-commission'
  );
}

/**
 * Get legislative data statistics
 */
export function getLegislativeStats(): {
  statesWithLegislativeData: number;
  totalLayers: number;
  byLayerType: Record<LegislativeLayerType, number>;
  byAuthority: Record<StateAuthorityLevel, number>;
  totalExpectedDistricts: {
    congressional: number;
    state_senate: number;
    state_house: number;
    county: number;
  };
} {
  const statesWithData = getStatesWithLegislativeData();

  const stats = {
    statesWithLegislativeData: statesWithData.length,
    totalLayers: 0,
    byLayerType: {
      congressional: 0,
      state_senate: 0,
      state_house: 0,
      county: 0,
    } as Record<LegislativeLayerType, number>,
    byAuthority: {
      'state-redistricting-commission': 0,
      'state-gis': 0,
    } as Record<StateAuthorityLevel, number>,
    totalExpectedDistricts: {
      congressional: 0,
      state_senate: 0,
      state_house: 0,
      county: 0,
    },
  };

  for (const portal of statesWithData) {
    if (portal.legislativeAuthority) {
      stats.byAuthority[portal.legislativeAuthority]++;
    }

    for (const layer of portal.legislativeDistrictLayers ?? []) {
      stats.totalLayers++;
      stats.byLayerType[layer.type]++;
      stats.totalExpectedDistricts[layer.type] += layer.expectedCount;
    }
  }

  return stats;
}
