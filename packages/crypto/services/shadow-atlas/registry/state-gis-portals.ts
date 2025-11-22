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
