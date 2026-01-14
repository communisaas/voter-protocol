/**
 * Provider Configuration
 *
 * Central configuration for all external data provider URLs and constants.
 * Single source of truth for endpoint management.
 *
 * MIGRATION NOTE: This config replaces hardcoded URLs scattered across provider files.
 * See migration guide for files requiring updates.
 */

// ============================================================================
// US Census Bureau - TIGER/Line
// ============================================================================

/**
 * US Census Bureau TIGER/Line endpoints
 *
 * Authority: Federal government official boundaries (Census Bureau)
 * License: CC0-1.0 (Public Domain)
 * Cost: $0
 * Update Frequency: Annual (September release, year following data year)
 */
export const US_CENSUS_URLS = {
  /** FTP base for TIGER/Line bulk downloads */
  tigerFTP: 'https://www2.census.gov/geo/tiger',

  /** TIGERweb REST API for real-time queries */
  tigerWeb: 'https://tigerweb.geo.census.gov/arcgis/rest/services',

  /** Census Bureau main site */
  mainSite: 'https://www.census.gov',

  /** TIGER/Line documentation */
  docs: 'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html',
} as const;

// ============================================================================
// Canada - Elections Canada / Statistics Canada
// ============================================================================

/**
 * Canada electoral boundaries endpoints
 *
 * Authority: Elections Canada (electoral-commission)
 * License: OGL-CA (Open Government License - Canada)
 * Cost: $0
 * Update Frequency: Event-driven (post-census redistribution, ~10 years)
 */
export const CANADA_URLS = {
  /** Represent API (Open North) - primary source */
  representApi: 'https://represent.opennorth.ca',

  /** Statistics Canada boundaries */
  statsCan: 'https://www12.statcan.gc.ca/census-recensement',
} as const;

// ============================================================================
// United Kingdom - ONS
// ============================================================================

/**
 * UK electoral boundaries endpoints
 *
 * Authority: ONS (Office for National Statistics)
 * License: OGL (Open Government License)
 * Cost: $0
 * Update Frequency: Event-driven (post-census boundary reviews)
 */
export const UK_URLS = {
  /** ONS ArcGIS REST API base */
  arcgisBase: 'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services',

  /** ONS main site */
  mainSite: 'https://www.ons.gov.uk',
} as const;

// ============================================================================
// Australia - AEC
// ============================================================================

/**
 * Australia electoral boundaries endpoints
 *
 * Authority: AEC (Australian Electoral Commission)
 * License: CC-BY-4.0
 * Cost: $0
 * Update Frequency: Event-driven (post-census redistribution, ~7-10 years)
 */
export const AUSTRALIA_URLS = {
  /** AEC ArcGIS REST API base */
  arcgisBase: 'https://services.arcgis.com/dHnJfFOAL8X99WD7/arcgis/rest/services',

  /** AEC main site */
  mainSite: 'https://www.aec.gov.au',
} as const;

// ============================================================================
// New Zealand - Stats NZ
// ============================================================================

/**
 * New Zealand electoral boundaries endpoints
 *
 * Authority: Stats NZ (Statistics New Zealand)
 * License: CC-BY-4.0
 * Cost: $0
 * Update Frequency: Event-driven (post-census boundary reviews, ~3 years)
 */
export const NEW_ZEALAND_URLS = {
  /** Stats NZ Data Finder */
  dataFinder: 'https://datafinder.stats.govt.nz/services',

  /** Stats NZ main site */
  mainSite: 'https://www.stats.govt.nz',

  /** Elections NZ maps */
  electionsNZ: 'https://elections.nz',
} as const;

// ============================================================================
// Washington DC - DC Open Data
// ============================================================================

/**
 * DC ward boundaries endpoints
 *
 * Authority: DC Office of Planning (municipal-agency)
 * License: CC0-1.0 (Public Domain / Open Data)
 * Cost: $0
 * Update Frequency: Event-driven (redistricting after decennial census)
 */
export const DC_URLS = {
  /** DC GIS REST API base */
  arcgisBase: 'https://maps2.dcgis.dc.gov/dcgis/rest/services',

  /** DC Open Data portal */
  openData: 'https://opendata.dc.gov',
} as const;

// ============================================================================
// Redistricting Data Hub (RDH)
// ============================================================================

/**
 * Redistricting Data Hub endpoints
 *
 * Authority: Princeton Gerrymandering Project (research-institution)
 * License: Varies by dataset
 * Cost: $0
 * Update Frequency: Post-election (Q1) and post-redistricting
 */
export const RDH_URLS = {
  /** RDH main site */
  mainSite: 'https://redistrictingdatahub.org',

  /** RDH download page */
  downloads: 'https://redistrictingdatahub.org/data/download-data',

  /** RDH API endpoint (requires authentication) */
  api: 'https://redistrictingdatahub.org/wp-json/download/list',
} as const;

// ============================================================================
// IPFS Gateways
// ============================================================================

/**
 * IPFS gateways for Shadow Atlas snapshots
 *
 * Priority order: Use public gateways first, fall back to custom if needed
 */
export const IPFS_GATEWAYS = {
  /** Primary public gateway */
  primary: 'https://ipfs.io',

  /** Cloudflare IPFS gateway (fast, reliable) */
  cloudflare: 'https://cloudflare-ipfs.com',

  /** Pinata dedicated gateway (requires API key for private pins) */
  pinata: 'https://gateway.pinata.cloud',

  /** Dweb.link gateway */
  dweb: 'https://dweb.link',
} as const;

// ============================================================================
// TIGER Configuration
// ============================================================================

/**
 * TIGER/Line configuration constants
 */
export const TIGER_CONFIG = {
  /** Current TIGER vintage year */
  currentYear: 2024,

  /** Supported TIGER years for historical queries */
  supportedYears: [2020, 2021, 2022, 2023, 2024] as const,

  /** TIGER layer types (FTP directory names) */
  layers: [
    // Legislative
    'CD',      // Congressional Districts
    'SLDU',    // State Legislative Upper
    'SLDL',    // State Legislative Lower

    // Administrative
    'COUNTY',  // Counties
    'COUSUB',  // County Subdivisions
    'SUBMCD',  // Subminor Civil Divisions

    // Municipal
    'PLACE',   // Incorporated Places + CDPs

    // School Districts
    'UNSD',    // Unified School Districts
    'ELSD',    // Elementary School Districts
    'SCSD',    // Secondary School Districts

    // Electoral
    'VTD',     // Voting Districts

    // Tribal
    'AIANNH',  // American Indian/Alaska Native/Native Hawaiian Areas
    'ANRC',    // Alaska Native Regional Corporations
    'TBG',     // Tribal Block Groups
    'TTRACT',  // Tribal Census Tracts

    // Metropolitan
    'CBSA',    // Core Based Statistical Areas
    'CSA',     // Combined Statistical Areas
    'METDIV',  // Metropolitan Divisions
    'UAC',     // Urban Areas
    'NECTA',   // New England City and Town Areas
    'CNECTA',  // Combined NECTA
    'NECTADIV', // NECTA Divisions

    // Reference
    'ZCTA520', // ZIP Code Tabulation Areas (2020)
    'TRACT',   // Census Tracts
    'BG',      // Block Groups
    'PUMA',    // Public Use Microdata Areas

    // Special
    'ESTATE',  // Estates (US Virgin Islands)
    'CONCITY', // Consolidated Cities

    // Federal Installations
    'MIL',     // Military Installations
  ] as const,

  /** TIGER release schedule (September 1st of year following data year) */
  releaseMonth: 9, // September
  releaseDay: 1,   // 1st

  /** Grace period for cache expiration after new release (days) */
  cacheGracePeriodDays: 30,
} as const;

// ============================================================================
// Provider Timeouts
// ============================================================================

/**
 * HTTP request timeout configurations by provider
 */
export const PROVIDER_TIMEOUTS = {
  /** Default timeout for most requests */
  default: 30000, // 30 seconds

  /** Timeout for large file downloads (shapefiles, etc) */
  largefile: 120000, // 2 minutes

  /** Timeout for ArcGIS REST API queries */
  arcgis: 60000, // 1 minute

  /** Timeout for IPFS gateway fetches */
  ipfs: 45000, // 45 seconds

  /** Timeout for health checks */
  healthCheck: 10000, // 10 seconds
} as const;

// ============================================================================
// Provider User Agents
// ============================================================================

/**
 * User-Agent strings for provider requests
 */
export const USER_AGENTS = {
  /** Default user agent for Shadow Atlas requests */
  default: 'VOTER-Protocol-ShadowAtlas/1.0',

  /** User agent for Census TIGER requests */
  censusTiger: 'VOTER-Protocol/1.0 (Census TIGER Loader)',

  /** User agent with contact info (use for production) */
  withContact: 'VOTER-Protocol-ShadowAtlas/1.0 (https://github.com/noot/voter-protocol)',
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build TIGER FTP URL for a specific layer and year
 *
 * @param layer - TIGER layer type (e.g., 'CD', 'SLDU', 'COUNTY')
 * @param year - TIGER vintage year (e.g., 2024)
 * @returns Full FTP URL for the layer
 *
 * @example
 * ```typescript
 * buildTigerURL('CD', 2024)
 * // => 'https://www2.census.gov/geo/tiger/TIGER2024/CD'
 * ```
 */
export function buildTigerURL(
  layer: typeof TIGER_CONFIG.layers[number],
  year: number = TIGER_CONFIG.currentYear
): string {
  return `${US_CENSUS_URLS.tigerFTP}/TIGER${year}/${layer}`;
}

/**
 * Build TIGERweb REST API URL for a service and layer
 *
 * @param service - TIGERweb service name (e.g., 'tigerWMS_Current')
 * @param layerId - Layer ID within the service
 * @returns Full TIGERweb REST API URL
 *
 * @example
 * ```typescript
 * buildTigerWebURL('tigerWMS_Current', 28)
 * // => 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/28'
 * ```
 */
export function buildTigerWebURL(service: string, layerId: number): string {
  return `${US_CENSUS_URLS.tigerWeb}/TIGERweb/${service}/MapServer/${layerId}`;
}

/**
 * Build IPFS gateway URL for a CID
 *
 * @param cid - IPFS Content Identifier
 * @param gateway - Gateway to use (defaults to primary)
 * @returns Full IPFS gateway URL
 *
 * @example
 * ```typescript
 * buildIPFSURL('QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco')
 * // => 'https://ipfs.io/ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco'
 * ```
 */
export function buildIPFSURL(
  cid: string,
  gateway: keyof typeof IPFS_GATEWAYS = 'primary'
): string {
  return `${IPFS_GATEWAYS[gateway]}/ipfs/${cid}`;
}

// ============================================================================
// Type Exports for Compile-Time Safety
// ============================================================================

/** TIGER layer type (compile-time validated) */
export type TIGERLayer = typeof TIGER_CONFIG.layers[number];

/** TIGER year type (compile-time validated) */
export type TIGERYear = typeof TIGER_CONFIG.supportedYears[number];

/** IPFS gateway type (compile-time validated) */
export type IPFSGateway = keyof typeof IPFS_GATEWAYS;
