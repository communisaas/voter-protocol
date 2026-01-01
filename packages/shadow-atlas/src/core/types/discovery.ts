/**
 * Discovery System Types
 *
 * Types for automated boundary discovery across administrative levels.
 * Supports global discovery strategies and portal detection.
 */

/**
 * Administrative hierarchy levels
 * Normalized across countries (mapped to local terminology)
 */
export type AdministrativeLevel =
  | 'country'                               // National boundaries
  | 'state' | 'province' | 'region'         // First-level subdivisions
  | 'department' | 'prefecture' | 'canton'  // First-level (varies by country)
  | 'county' | 'district' | 'arrondissement' // Second-level subdivisions
  | 'city' | 'municipality' | 'commune' | 'municipal'     // Municipal level
  | 'ward' | 'council-district'            // Sub-municipal level
  | 'congressional'                       // Federal legislative
  | 'state-legislative-upper'             // State legislative upper
  | 'state-legislative-lower'             // State legislative lower
  | 'county-commission'                   // County legislative
  | 'school-district';                    // School district

/**
 * Discovery status
 */
export type DiscoveryStatus =
  | 'pending'      // Not yet attempted
  | 'found'        // Successfully discovered
  | 'not-found'    // No portal data exists
  | 'error'        // Discovery failed (technical error)
  | 'manual-review'; // Requires human verification

/**
 * Portal types (extensible)
 */
export type PortalType =
  | 'arcgis'           // ArcGIS Hub/FeatureServer/MapServer
  | 'arcgis-hub'       // Specific ArcGIS Hub
  | 'arcgis-online'    // ArcGIS Online
  | 'socrata'          // Socrata open data portal
  | 'ckan'             // CKAN portal
  | 'custom-api'       // Custom REST API
  | 'static-file'      // Static GeoJSON/Shapefile download
  | 'census-tiger'     // US Census TIGER/Line
  | 'statcan'          // Statistics Canada
  | 'ordnance-survey'  // UK Ordnance Survey
  | 'eurogeographics'  // European data aggregator
  | 'municipal-gis'    // Direct municipal GIS server
  | 'state-gis';       // State-level GIS clearinghouse (e.g., Hawaii Statewide GIS)

/**
 * Authority level of data source
 * Higher authority = more trustworthy, legally binding
 */
export type AuthorityLevel =
  | 'federal-mandate'       // Constitutional/federal mandate (e.g., US Census Bureau)
  | 'state-agency'          // State-level official agency
  | 'municipal-agency'      // Municipal GIS department
  | 'county-agency'         // County GIS department
  | 'commercial-aggregator' // Private company aggregation
  | 'community-maintained'; // OpenStreetMap, volunteer efforts

/**
 * Legal status of boundary definitions
 */
export type LegalStatus =
  | 'binding'        // Legally binding (used by courts, IRS, federal agencies)
  | 'official'       // Official but not binding (municipal/county data)
  | 'informational'  // Informational only (commercial aggregators)
  | 'unofficial';    // Community-maintained, no official status

/**
 * Collection method for data acquisition
 */
export type CollectionMethod =
  | 'census-tiger'           // US Census Bureau TIGER/Line
  | 'census-bas'             // US Census Bureau Boundary and Annexation Survey
  | 'national-statistics'    // National statistical agency (StatCan, ONS, etc.)
  | 'portal-discovery'       // Automated portal discovery (ArcGIS, Socrata, CKAN)
  | 'manual-verification'    // Manual download + verification
  | 'commercial-api'         // Commercial API (Cicero, Google Civic, etc.)
  | 'community-aggregation'; // Community aggregation (OSM, etc.)

/**
 * Universal discovery state for any administrative boundary
 */
export interface DiscoveryState {
  // Identity
  /** Unique identifier (FIPS, NUTS, ISO subdivision, custom) */
  id: string;

  /** Human-readable name */
  name: string;

  /** ISO 3166-1 alpha-2 country code */
  country: string;

  /** Administrative level being discovered */
  level: AdministrativeLevel;

  /** Parent administrative unit ID (for hierarchical discovery) */
  parentId?: string;

  // Geographic context
  /** State/province/region code */
  region?: string;

  /** Population (if known) */
  population?: number;

  // Discovery tracking
  /** Current discovery status */
  status: DiscoveryStatus;

  /** Last discovery attempt timestamp (ISO 8601) */
  lastAttempted?: string;

  /** Last successful discovery timestamp (ISO 8601) */
  lastSuccessful?: string;

  /** Number of discovery attempts */
  attemptCount: number;

  /** Error message from last failed attempt */
  lastError?: string;

  // Portal metadata (if found)
  /** Portal type where boundary was found */
  portalType?: PortalType;

  /** Direct URL to boundary data */
  boundaryUrl?: string;

  /** Number of districts/features found */
  featureCount?: number;

  /** Authority level of source */
  authorityLevel?: AuthorityLevel;

  /** Legal status of boundaries */
  legalStatus?: LegalStatus;

  /** Collection method used */
  collectionMethod?: CollectionMethod;

  // Update monitoring
  /** Last checked for updates timestamp (ISO 8601) */
  lastCheckedForUpdates?: string;

  /** RSS feeds for update monitoring */
  rssFeeds?: string[];

  /** Portal modification date (if available) */
  portalModifiedDate?: string;

  // Discovery metadata
  /** Discovery strategy that found this (for learning) */
  discoveryStrategy?: string;

  /** Confidence score (0-1) for discovered source */
  confidence?: number;

  /** Notes for human review */
  notes?: string;
}

/**
 * Discovery query parameters
 * Enables flexible, agent-driven discovery strategies
 */
export interface DiscoveryQuery {
  /** Country filter (ISO 3166-1 alpha-2) */
  country?: string;

  /** Administrative level filter */
  level?: AdministrativeLevel;

  /** Status filter */
  status?: DiscoveryStatus | DiscoveryStatus[];

  /** Region filter (state/province code) */
  region?: string;

  /** Minimum population */
  minPopulation?: number;

  /** Maximum population */
  maxPopulation?: number;

  /** Sort order */
  sortBy?: 'population' | 'name' | 'lastAttempted' | 'random';

  /** Sort direction */
  sortDirection?: 'asc' | 'desc';

  /** Limit results */
  limit?: number;

  /** Offset for pagination */
  offset?: number;

  /** Last attempted before timestamp (ISO 8601) - for retry strategies */
  attemptedBefore?: string;

  /** Last attempted after timestamp (ISO 8601) */
  attemptedAfter?: string;
}

/**
 * Discovery result after attempt
 */
export interface DiscoveryResult {
  /** City/place that was discovered */
  state: DiscoveryState;

  /** Whether discovery succeeded */
  success: boolean;

  /** Error message if failed */
  error?: string;

  /** Portal candidates found (before selection) */
  candidates?: Array<{
    portalType: PortalType;
    url: string;
    score: number;
  }>;

  /** Selected candidate (if multiple) */
  selected?: {
    portalType: PortalType;
    url: string;
    selectionMethod: 'deterministic' | 'llm' | 'human';
  };
}

/**
 * Discovery batch result
 */
export interface DiscoveryBatchResult {
  /** Total items processed */
  total: number;

  /** Successfully discovered */
  found: number;

  /** No data found */
  notFound: number;

  /** Errors occurred */
  errors: number;

  /** Individual results */
  results: DiscoveryResult[];

  /** Execution time (milliseconds) */
  executionTime: number;
}
