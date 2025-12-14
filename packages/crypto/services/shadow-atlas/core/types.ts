/**
 * Shadow Atlas Core Types
 *
 * Consolidated type definitions for the Shadow Atlas geospatial Merkle tree system.
 * Single source of truth for all type definitions.
 *
 * CRITICAL TYPE SAFETY: These types define the contract for event-sourced,
 * content-addressed municipal boundary data. Type errors here can brick
 * the entire discovery pipeline.
 */

import type {
  Polygon,
  MultiPolygon,
  Position,
  FeatureCollection,
  Feature,
  Geometry
} from 'geojson';

// ============================================================================
// Re-exports from Boundary Types (types/boundary.ts)
// ============================================================================

/**
 * Provenance record from provenance-writer.js
 * Re-exported here for convenience
 */
export type { ProvenanceRecord } from '../provenance/provenance-writer.js';

// ============================================================================
// Boundary Hierarchy Types (from types/boundary.ts)
// ============================================================================

/**
 * Boundary Type Enumeration
 *
 * Ordered by precision rank (finest → coarsest).
 * Used for hierarchical resolution fallback.
 *
 * US COVERAGE STRATEGY:
 * - Tier 0: City council districts (finest civic representation)
 * - Tier 1: City limits (incorporated places - Census PLACE)
 * - Tier 2: CDP (Census Designated Places - unincorporated communities)
 * - Tier 3: County (universal fallback)
 * - Tier 4: Congressional district (federal representation)
 * - Tier 5: State (coarsest)
 *
 * Data sources:
 * - Council districts: Municipal portals, state GIS clearinghouses
 * - City limits: Census TIGER/Line PLACE files (FREE, 19,495 places)
 * - CDPs: Census TIGER/Line PLACE files (FREE, ~9,000 CDPs)
 * - Counties: Census TIGER/Line COUNTY files (FREE, 3,143 counties)
 * - Congressional: Census TIGER/Line CD files (FREE, 435 districts)
 */
export enum BoundaryType {
  // Finest grain: Local civic representation
  CITY_COUNCIL_DISTRICT = 'city_council_district',
  CITY_COUNCIL_WARD = 'city_council_ward',

  // Incorporated places (Census PLACE with LSAD = city/town/village)
  CITY_LIMITS = 'city_limits',

  // Unincorporated communities (Census PLACE with LSAD = CDP)
  CDP = 'cdp',

  // County subdivision (townships, boroughs in some states)
  COUNTY_SUBDIVISION = 'county_subdivision',

  // County (universal US fallback)
  COUNTY = 'county',

  // Federal representation
  CONGRESSIONAL_DISTRICT = 'congressional_district',

  // State legislative (optional enhancement)
  STATE_LEGISLATIVE_UPPER = 'state_legislative_upper',
  STATE_LEGISLATIVE_LOWER = 'state_legislative_lower',

  // Coarsest grain
  STATE_PROVINCE = 'state_province',
  COUNTRY = 'country',
}

/**
 * Precision rank for hierarchical resolution
 *
 * Lower rank = higher precision (preferred in resolution).
 * Used to sort boundaries when multiple matches exist.
 *
 * RESOLUTION STRATEGY:
 * 1. Attempt finest available (council district)
 * 2. Fall back to city limits or CDP
 * 3. Fall back to county (guaranteed)
 * 4. Congressional district available in parallel (federal representation)
 */
export const PRECISION_RANK: Record<BoundaryType, number> = {
  // Tier 0: Finest civic representation
  [BoundaryType.CITY_COUNCIL_DISTRICT]: 0,
  [BoundaryType.CITY_COUNCIL_WARD]: 1,

  // Tier 1: Incorporated/unincorporated place boundaries
  [BoundaryType.CITY_LIMITS]: 2,
  [BoundaryType.CDP]: 3,
  [BoundaryType.COUNTY_SUBDIVISION]: 4,

  // Tier 2: County (universal US fallback)
  [BoundaryType.COUNTY]: 5,

  // Federal/State representation (parallel track, not fallback)
  [BoundaryType.CONGRESSIONAL_DISTRICT]: 6,
  [BoundaryType.STATE_LEGISLATIVE_UPPER]: 7,
  [BoundaryType.STATE_LEGISLATIVE_LOWER]: 8,

  // Tier 3: Coarsest
  [BoundaryType.STATE_PROVINCE]: 9,
  [BoundaryType.COUNTRY]: 10,
};

/**
 * Boundary Metadata
 *
 * Identifies a political boundary without geometry.
 * Lightweight for caching and indexing.
 */
export interface BoundaryMetadata {
  readonly id: string;                    // Unique boundary ID (e.g., "us-wa-seattle-district-1")
  readonly type: BoundaryType;            // Boundary type
  readonly name: string;                  // Human-readable name (e.g., "District 1")
  readonly jurisdiction: string;          // Parent jurisdiction (e.g., "Seattle, WA, USA")
  readonly jurisdictionFips?: string;     // FIPS code (US only, e.g., "5363000" for Seattle)
  readonly provenance: import('../provenance-writer.js').ProvenanceRecord;  // Full audit trail
  readonly validFrom: Date;               // Effective date
  readonly validUntil?: Date;             // Expiration date (null = current)
}

/**
 * Boundary Geometry
 *
 * Complete boundary with geometry for PIP testing.
 * Includes bounding box for performance optimization.
 */
export interface BoundaryGeometry {
  readonly metadata: BoundaryMetadata;
  readonly geometry: Polygon | MultiPolygon;  // GeoJSON geometry (WGS84)
  readonly bbox: readonly [number, number, number, number];  // [minLon, minLat, maxLon, maxLat]
}

/**
 * Boundary Resolution Result
 *
 * Result of resolving an address to a boundary.
 * Includes caching metadata and confidence score.
 */
export interface BoundaryResolution {
  readonly boundary: BoundaryMetadata;
  readonly precision: BoundaryType;
  readonly confidence: number;             // 0-100 (from provenance)
  readonly coordinates: { readonly lat: number; readonly lng: number };
  readonly cached: boolean;
  readonly resolvedAt: Date;
}

/**
 * Lat/Lng Point
 *
 * Simple coordinate type for clarity.
 */
export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/**
 * Bounding Box
 *
 * Geographic bounding box [minLon, minLat, maxLon, maxLat].
 * Alias for clarity in function signatures.
 */
export type BBox = readonly [number, number, number, number];

/**
 * Polygon Ring
 *
 * Array of GeoJSON positions forming a polygon ring.
 * Alias for clarity in PIP algorithm.
 */
export type PolygonRing = Position[];

// ============================================================================
// Database Types (from types/index.ts)
// ============================================================================

/**
 * Municipality (19k US incorporated places)
 */
export interface Municipality {
  readonly id: string;              // "ca-los_angeles"
  readonly name: string;            // "Los Angeles, CA"
  readonly state: string;           // "CA"
  readonly fips_place: string | null;
  readonly population: number | null;
  readonly county_fips: string | null;
  readonly created_at: string;      // ISO 8601
}

/**
 * Source portal types
 */
export type SourceKind = 'arcgis' | 'socrata' | 'ckan' | 'geojson';

/**
 * Discovered source (portal endpoint)
 */
export interface Source {
  readonly id: number;
  readonly muni_id: string;
  readonly kind: SourceKind;
  readonly url: string;
  readonly layer_hint: string | null;  // Layer index or name
  readonly title: string | null;
  readonly description: string | null;
  readonly discovered_at: string;      // ISO 8601
  readonly score: number | null;       // Heuristic ranking
}

/**
 * Selection decision type
 */
export type DecisionType = 'heuristic' | 'llm' | 'manual';

/**
 * Selected source for a municipality
 */
export interface Selection {
  readonly muni_id: string;
  readonly source_id: number;
  readonly district_field: string | null;  // e.g., "DISTRICT", "WARD"
  readonly member_field: string | null;    // e.g., "COUNCILMEM", "MEMBER"
  readonly at_large: boolean;              // True if at-large/no districts
  readonly confidence: number | null;      // 0.0-1.0
  readonly decided_by: DecisionType;
  readonly decided_at: string;             // ISO 8601
  readonly model: string | null;           // e.g., "gemini-2.5-flash"
}

/**
 * Content-addressed GeoJSON artifact
 */
export interface Artifact {
  readonly id: number;
  readonly muni_id: string;
  readonly content_sha256: string;     // Key into R2/S3
  readonly record_count: number;       // Feature count
  readonly bbox: [number, number, number, number] | null;  // [minLon, minLat, maxLon, maxLat]
  readonly etag: string | null;
  readonly last_modified: string | null;
  readonly last_edit_date: number | null;  // Epoch ms
  readonly created_at: string;             // ISO 8601
}

/**
 * Head pointer to current artifact
 */
export interface Head {
  readonly muni_id: string;
  readonly artifact_id: number;
  readonly updated_at: string;  // ISO 8601
}

/**
 * Event types for provenance log
 */
export type EventKind = 'DISCOVER' | 'SELECT' | 'FETCH' | 'UPDATE' | 'ERROR' | 'SKIP';

/**
 * Event (append-only log)
 */
export interface Event {
  readonly id: number;
  readonly ts: string;               // ISO 8601
  readonly run_id: string;           // Batch/cron run identifier
  readonly muni_id: string | null;
  readonly kind: EventKind;
  readonly payload: Record<string, unknown>;  // JSON blob
  readonly model: string | null;     // LLM model if used
  readonly duration_ms: number | null;
  readonly error: string | null;
}

/**
 * Status view (derived)
 */
export type StatusType = 'FOUND_LAYER' | 'SELECTED_NOT_FETCHED' | 'SOURCES_FOUND' | 'NOT_ATTEMPTED';

export interface StatusView {
  readonly muni_id: string;
  readonly name: string;
  readonly state: string;
  readonly population: number | null;
  readonly status: StatusType;
  readonly confidence: number | null;
  readonly decided_by: DecisionType | null;
  readonly decided_at: string | null;
  readonly district_count: number | null;
  readonly content_sha256: string | null;
  readonly data_updated_at: string | null;
}

/**
 * Coverage metrics view (derived)
 */
export interface CoverageView {
  readonly state: string;
  readonly total_munis: number;
  readonly found: number;
  readonly selected: number;
  readonly sources: number;
  readonly pending: number;
  readonly pct_complete: number;
}

/**
 * Normalized GeoJSON structure
 */
export interface NormalizedGeoJSON {
  readonly type: 'FeatureCollection';
  readonly features: readonly GeoJSONFeature[];
  readonly bbox?: readonly [number, number, number, number];
}

export interface GeoJSONFeature {
  readonly type: 'Feature';
  readonly id?: string | number;
  readonly properties: Record<string, unknown>;
  readonly geometry: GeoJSONGeometry;
}

export type GeoJSONGeometry =
  | { readonly type: 'Polygon'; readonly coordinates: readonly [readonly [number, number][]][]; }
  | { readonly type: 'MultiPolygon'; readonly coordinates: readonly [readonly [readonly [number, number][]][]][]; };

/**
 * LLM batch input/output types
 */

export interface LLMBatchCity {
  readonly id: string;
  readonly name: string;
  readonly state: string;
}

export interface LLMBatchCandidate {
  readonly ty: SourceKind;      // Type (abbreviated for token efficiency)
  readonly ti: string;          // Title
  readonly u: string;           // URL
  readonly ly?: readonly LLMLayerInfo[];  // Layers (ArcGIS only)
  readonly f?: readonly string[];         // Fields (Socrata/CKAN)
}

export interface LLMLayerInfo {
  readonly i: number;           // Index
  readonly n: string;           // Name
  readonly f: readonly string[]; // Fields (top 6 only)
}

export interface LLMBatchInput {
  readonly task: string;
  readonly rules: readonly string[];
  readonly glossary: Record<string, string>;
  readonly batch: readonly LLMBatchCityInput[];
}

export interface LLMBatchCityInput {
  readonly city: LLMBatchCity;
  readonly cand: readonly LLMBatchCandidate[];
}

export interface LLMDecision {
  readonly muni_id: string;
  readonly source_type?: SourceKind;
  readonly source_url?: string;
  readonly layer_hint?: string | number;
  readonly district_field?: string;
  readonly member_field?: string;
  readonly at_large: boolean;
  readonly decision: 'ok' | 'skip';
  readonly confidence: number;
}

/**
 * Source fetcher metadata (from fetcher operations)
 * Distinct from SourceMetadata (provider attribution)
 */
export interface FetcherSourceMetadata {
  readonly etag: string | null;
  readonly last_modified: string | null;
  readonly last_edit_date: number | null;  // Epoch ms (ArcGIS only)
}

/**
 * Fetcher response
 */
export interface FetchResult {
  readonly data: NormalizedGeoJSON;
  readonly meta: FetcherSourceMetadata;
}

/**
 * Database adapter interface
 */
export interface DatabaseAdapter {
  // Municipalities
  insertMunicipality(muni: Omit<Municipality, 'created_at'>): Promise<void>;
  batchInsertMunicipalities(munis: Omit<Municipality, 'created_at'>[]): Promise<void>;
  getMunicipality(id: string): Promise<Municipality | null>;
  listMunicipalities(limit?: number, offset?: number): Promise<Municipality[]>;

  // Sources
  insertSource(source: Omit<Source, 'id'>): Promise<number>;
  batchInsertSources(sources: Omit<Source, 'id'>[]): Promise<void>;
  getSourcesByMuni(muni_id: string): Promise<Source[]>;

  // Selections
  insertSelection(sel: Selection): Promise<void>;
  getSelection(muni_id: string): Promise<Selection | null>;

  // Artifacts
  insertArtifact(artifact: Omit<Artifact, 'id' | 'created_at'>): Promise<number>;
  getArtifact(id: number): Promise<Artifact | null>;
  getArtifactBySha(sha: string): Promise<Artifact | null>;

  // Heads
  upsertHead(head: Omit<Head, 'updated_at'>): Promise<void>;
  getHead(muni_id: string): Promise<Head | null>;

  // Events
  insertEvent(event: Omit<Event, 'id' | 'ts'>): Promise<void>;
  batchInsertEvents(events: Omit<Event, 'id' | 'ts'>[]): Promise<void>;
  getEventsByMuni(muni_id: string, limit?: number): Promise<Event[]>;
  getEventsByRun(run_id: string): Promise<Event[]>;

  // Views
  getStatus(muni_id: string): Promise<StatusView | null>;
  listStatus(limit?: number, offset?: number): Promise<StatusView[]>;
  getCoverage(): Promise<CoverageView[]>;
  getErrors(limit?: number): Promise<Event[]>;

  // Utility
  close(): Promise<void>;
}

/**
 * Storage adapter interface (content-addressed blobs)
 */
export interface StorageAdapter {
  put(sha256: string, data: Buffer, metadata: Record<string, string>): Promise<void>;
  get(sha256: string): Promise<Buffer | null>;
  exists(sha256: string): Promise<boolean>;
  delete(sha256: string): Promise<void>;
}

// ============================================================================
// Discovery Types (from types/discovery.ts)
// ============================================================================

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

// ============================================================================
// Provider Types (from types/provider.ts)
// ============================================================================

/**
 * Country-specific boundary data provider
 * Handles download, transformation, and versioning for one country
 */
export interface BoundaryProvider {
  /** ISO 3166-1 alpha-2 country code (e.g., 'US', 'CA', 'GB') */
  readonly countryCode: string;

  /** Human-readable provider name */
  readonly name: string;

  /** Official data source organization */
  readonly source: string;

  /** Update frequency */
  readonly updateSchedule: UpdateSchedule;

  /** Supported administrative levels for this country */
  readonly administrativeLevels: readonly AdministrativeLevel[];

  /**
   * Download raw boundary files for specified administrative level
   * @returns Array of raw files (Shapefile, GeoJSON, etc.) before transformation
   */
  download(params: DownloadParams): Promise<RawBoundaryFile[]>;

  /**
   * Transform raw boundary files to normalized WGS84 GeoJSON
   * @returns Validated, standardized boundary features
   */
  transform(raw: RawBoundaryFile[]): Promise<NormalizedBoundary[]>;

  /**
   * Check if new data is available (for incremental updates)
   * @returns Metadata about available updates
   */
  checkForUpdates(): Promise<UpdateMetadata>;

  /**
   * Get source attribution metadata
   */
  getMetadata(): Promise<ProviderSourceMetadata>;
}

/**
 * Parameters for downloading boundary data
 */
export interface DownloadParams {
  /** Administrative level to download */
  level: AdministrativeLevel;

  /** Optional: Filter by region (e.g., specific state/province) */
  region?: string;

  /** Optional: Download specific version/year (defaults to latest) */
  version?: string;

  /** Optional: Force re-download even if cached locally */
  forceRefresh?: boolean;
}

/**
 * Raw boundary file before transformation
 */
export interface RawBoundaryFile {
  /** Download URL */
  url: string;

  /** File format */
  format: BoundaryFileFormat;

  /** Binary data (zip, shapefile, geojson, etc.) */
  data: Buffer;

  /** Provider-specific metadata */
  metadata: Record<string, unknown>;
}

/**
 * Normalized boundary after transformation
 * All providers must transform to this schema
 */
export interface NormalizedBoundary {
  /** Unique identifier (FIPS code, NUTS code, ISO subdivision, etc.) */
  id: string;

  /** Human-readable name */
  name: string;

  /** Administrative level */
  level: AdministrativeLevel;

  /** Parent administrative unit ID (for hierarchical lookups) */
  parentId?: string;

  /** WGS84 GeoJSON geometry (EPSG:4326 only) */
  geometry: Geometry;

  /** Population (if available from source) */
  population?: number;

  /** Additional properties from source data */
  properties: Record<string, unknown>;

  /** Source attribution */
  source: ProviderSourceMetadata;
}

/**
 * Source metadata for provider attribution and versioning
 * Distinct from FetcherSourceMetadata (HTTP caching metadata)
 */
export interface ProviderSourceMetadata {
  /** Provider name */
  provider: string;

  /** Official source URL */
  url: string;

  /** Data version/release date */
  version: string;

  /** License (SPDX identifier) */
  license: string;

  /** Last updated timestamp (ISO 8601) */
  updatedAt: string;

  /** Checksum for data integrity verification */
  checksum: string;

  // Trust Hierarchy
  /** Authority level of data source */
  authorityLevel: AuthorityLevel;

  /** Legal status of boundaries */
  legalStatus: LegalStatus;

  // Provenance Tracking
  /** Collection method used to acquire data */
  collectionMethod: CollectionMethod;

  /** Last verification timestamp (ISO 8601) */
  lastVerified: string;

  /** Who/what verified this data */
  verifiedBy: VerificationSource;

  // Data Quality
  /** Whether topology was validated (no self-intersections, overlaps) */
  topologyValidated: boolean;

  /** Whether geometry repair was applied */
  geometryRepaired: boolean;

  /** Coordinate system (always WGS84 for Shadow Atlas) */
  coordinateSystem: 'EPSG:4326';

  // Update Tracking
  /** Next scheduled update timestamp (ISO 8601) */
  nextScheduledUpdate?: string;

  /** How updates are monitored */
  updateMonitoring: UpdateMonitoringMethod;
}

/**
 * Update availability metadata
 */
export interface UpdateMetadata {
  /** Whether updates are available */
  available: boolean;

  /** Latest available version */
  latestVersion: string;

  /** Current local version */
  currentVersion?: string;

  /** Release date of latest version (ISO 8601) */
  releaseDate: string;

  /** Release notes URL */
  releaseNotesUrl?: string;
}

/**
 * Administrative hierarchy levels
 * Normalized across countries (mapped to local terminology)
 */
export type AdministrativeLevel =
  | 'country'                               // National boundaries
  | 'state' | 'province' | 'region'         // First-level subdivisions
  | 'department' | 'prefecture' | 'canton'  // First-level (varies by country)
  | 'county' | 'district' | 'arrondissement' // Second-level subdivisions
  | 'city' | 'municipality' | 'commune'     // Municipal level
  | 'ward' | 'council-district';            // Sub-municipal level

/**
 * Update schedules for automated refresh
 */
export type UpdateSchedule =
  | 'annual'        // Once per year (e.g., US Census TIGER)
  | 'quarterly'     // Four times per year (e.g., UK Ordnance Survey)
  | 'event-driven'  // After redistricting events
  | 'manual';       // No automated updates

/**
 * Supported boundary file formats
 */
export type BoundaryFileFormat =
  | 'shapefile'     // ESRI Shapefile (.shp + .shx + .dbf + .prj)
  | 'geojson'       // GeoJSON (.geojson)
  | 'kml'           // Keyhole Markup Language (.kml)
  | 'geopackage'    // GeoPackage (.gpkg)
  | 'gml';          // Geography Markup Language (.gml)

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
  | 'national-statistics'    // National statistical agency (StatCan, ONS, etc.)
  | 'portal-discovery'       // Automated portal discovery (ArcGIS, Socrata, CKAN)
  | 'manual-verification'    // Manual download + verification
  | 'commercial-api'         // Commercial API (Cicero, Google Civic, etc.)
  | 'community-aggregation'; // Community aggregation (OSM, etc.)

/**
 * Verification source
 */
export type VerificationSource =
  | 'automated'       // Automated validation (GDAL, topology checks)
  | 'human-reviewed'  // Human verified data quality
  | 'llm-selected'    // LLM selected from multiple sources
  | 'unverified';     // No verification performed

/**
 * Update monitoring method
 */
export type UpdateMonitoringMethod =
  | 'rss-feed'        // RSS feed monitoring
  | 'manual-check'    // Periodic manual checks
  | 'api-polling'     // API version polling
  | 'github-watch'    // GitHub repository watch
  | 'none';           // No monitoring (one-time download)

/**
 * Provider configuration
 * Maps countries to their providers in config/countries.json
 */
export interface ProviderConfig {
  /** ISO 3166-1 alpha-2 country code */
  countryCode: string;

  /** Human-readable country name */
  name: string;

  /** Provider class name (e.g., 'us-census-tiger') */
  provider: string;

  /** Supported administrative levels */
  administrativeLevels: readonly AdministrativeLevel[];

  /** Update schedule */
  updateSchedule: UpdateSchedule;

  /** Last successful update (ISO 8601) */
  lastUpdate?: string;

  /** Coverage statistics */
  coverage?: {
    municipalities?: number;
    population?: number;
  };
}

/**
 * GeoJSON feature collection with type safety
 */
export interface BoundaryFeatureCollection extends FeatureCollection {
  features: Array<{
    type: 'Feature';
    geometry: Geometry;
    properties: {
      id: string;
      name: string;
      level: AdministrativeLevel;
      parentId?: string;
      population?: number;
      [key: string]: unknown;
    };
  }>;
}

/**
 * Transformation options for coordinate system conversion
 */
export interface TransformOptions {
  /** Target CRS (always EPSG:4326 for Shadow Atlas) */
  targetCRS: 'EPSG:4326';

  /** Validate geometry after transformation */
  validate: boolean;

  /** Simplify geometry (Douglas-Peucker tolerance) */
  simplify?: number;

  /** Repair invalid geometries */
  repair?: boolean;
}

/**
 * Provider validation result
 * For validating raw boundary data from providers
 */
export interface ProviderValidationResult {
  /** Whether validation passed */
  valid: boolean;

  /** Validation errors (if any) */
  errors: ValidationError[];

  /** Validation warnings (non-blocking) */
  warnings: ValidationWarning[];
}

export interface ValidationError {
  /** Error type */
  type: 'topology' | 'projection' | 'completeness' | 'duplication';

  /** Error message */
  message: string;

  /** Feature ID that failed validation */
  featureId?: string;
}

export interface ValidationWarning {
  /** Warning type */
  type: 'missing-population' | 'missing-parent' | 'low-precision';

  /** Warning message */
  message: string;

  /** Feature ID with warning */
  featureId?: string;
}

// ============================================================================
// Transformation Pipeline Types (from transformation/types.ts)
// ============================================================================

/**
 * Provenance metadata from acquisition layer
 */
export interface ProvenanceMetadata {
  // Source identification
  readonly source: string;              // URL or identifier
  readonly authority: 'state-gis' | 'federal' | 'municipal' | 'community';
  readonly jurisdiction: string;        // e.g., "Hawaii", "USA", "France"

  // Temporal metadata
  readonly timestamp: number;           // Unix timestamp of scrape
  readonly sourceLastModified?: number; // From HTTP Last-Modified header
  readonly effectiveDate?: string;      // When boundaries became official

  // Verification metadata
  readonly method: string;              // "ArcGIS REST API", "Overpass API", etc.
  readonly responseHash: string;        // sha256(raw HTTP response)
  readonly httpStatus: number;          // 200, etc.

  // Legal metadata
  readonly legalBasis?: string;         // "Hawaii Revised Statutes §3-1"
  readonly license?: string;            // "Public Domain", "CC-BY-4.0", etc.

  // Quality metadata
  readonly featureCount: number;
  readonly geometryType: 'Polygon' | 'MultiPolygon';
  readonly coordinateSystem: string;    // "EPSG:4326" (WGS84)
}

/**
 * Raw dataset from acquisition layer
 */
export interface RawDataset {
  readonly geojson: FeatureCollection;
  readonly provenance: ProvenanceMetadata;
}

/**
 * Transformation validation result
 * For validating processed district data (distinct from provider validation)
 */
export interface TransformationValidationResult {
  readonly valid: boolean;
  readonly confidence: number;  // 0-100
  readonly issues: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Validation context for district count checks
 */
export interface ValidationContext {
  readonly jurisdiction: string;
  readonly expectedDistrictCount?: number;
  readonly districtType: 'council' | 'ward' | 'municipal';
}

/**
 * Normalized district (output of validation + normalization)
 */
export interface NormalizedDistrict {
  readonly id: string;              // Globally unique: "{country}-{state}-{city}-{district}"
  readonly name: string;            // Human-readable
  readonly jurisdiction: string;    // "USA/Hawaii/Honolulu"
  readonly districtType: 'council' | 'ward' | 'municipal';
  readonly geometry: Polygon | MultiPolygon;
  readonly provenance: ProvenanceMetadata;
  readonly bbox: readonly [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
}

/**
 * Bounding Box (extended version from transformation pipeline)
 */
export interface BoundingBox {
  readonly minLon: number;
  readonly maxLon: number;
  readonly minLat: number;
  readonly maxLat: number;
}

/**
 * Merkle proof for client verification
 */
export interface MerkleProof {
  readonly root: string;           // Hex string
  readonly leaf: string;           // Hex string
  readonly siblings: readonly string[];  // Hex strings
  readonly districtId: string;
}

/**
 * Merkle tree structure
 */
export interface MerkleTree {
  readonly root: string;           // Hex string (cryptographic commitment)
  readonly leaves: readonly string[];
  readonly tree: readonly (readonly string[])[]; // Array of layers
  readonly districts: readonly NormalizedDistrict[]; // Sorted by ID
}

/**
 * SQLite database schema types
 */
export interface DistrictRecord {
  readonly id: string;
  readonly name: string;
  readonly jurisdiction: string;
  readonly district_type: string;
  readonly geometry: string;       // JSON-serialized GeoJSON
  readonly provenance: string;     // JSON-serialized ProvenanceMetadata
  readonly min_lon: number;
  readonly min_lat: number;
  readonly max_lon: number;
  readonly max_lat: number;
}

/**
 * Transformation result (output of entire pipeline)
 */
export interface TransformationResult {
  readonly merkleRoot: string;
  readonly ipfsCID: string;
  readonly databasePath: string;
  readonly districtCount: number;
  readonly timestamp: number;
  readonly snapshotId: string;
}

/**
 * Transformation metadata (audit trail)
 */
export interface TransformationMetadata {
  readonly snapshotId: string;
  readonly inputPath: string;
  readonly outputPath: string;
  readonly rawDatasetCount: number;
  readonly validatedCount: number;
  readonly normalizedCount: number;
  readonly rejectionReasons: Record<string, number>;
  readonly merkleRoot: string;
  readonly ipfsCID: string;
  readonly transformationDuration: number; // milliseconds
  readonly transformationCommit: string;   // Git commit hash
  readonly timestamp: number;
}

/**
 * Pipeline stage result
 */
export interface StageResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly duration: number; // milliseconds
}

/**
 * Validation statistics
 */
export interface ValidationStats {
  readonly total: number;
  readonly passed: number;
  readonly rejected: number;
  readonly warnings: number;
  readonly rejectionReasons: Record<string, number>;
}

/**
 * Normalization statistics
 */
export interface NormalizationStats {
  readonly total: number;
  readonly normalized: number;
  readonly avgVertexCountBefore: number;
  readonly avgVertexCountAfter: number;
  readonly simplificationRatio: number;
}

/**
 * IPFS publication result
 */
export interface IPFSPublication {
  readonly cid: string;
  readonly ipns?: string;
  readonly timestamp: number;
  readonly size: number; // bytes
  readonly pinned: boolean;
}

// ============================================================================
// Helper Functions (from types/boundary.ts)
// ============================================================================

/**
 * Check if boundary is currently valid
 */
export function isBoundaryValid(
  boundary: BoundaryMetadata,
  asOf: Date = new Date()
): boolean {
  if (asOf < boundary.validFrom) {
    return false;  // Not yet effective
  }

  if (boundary.validUntil && asOf >= boundary.validUntil) {
    return false;  // Expired
  }

  return true;
}

/**
 * Get precision rank for boundary type
 */
export function getPrecisionRank(type: BoundaryType): number {
  return PRECISION_RANK[type];
}

/**
 * Compare boundary precision (for sorting)
 *
 * Returns:
 * - negative if a has higher precision (finer grain)
 * - positive if b has higher precision
 * - zero if equal precision
 */
export function comparePrecision(a: BoundaryType, b: BoundaryType): number {
  return getPrecisionRank(a) - getPrecisionRank(b);
}

/**
 * Format boundary as human-readable string
 */
export function formatBoundary(boundary: BoundaryMetadata): string {
  return `${boundary.name} (${boundary.type}, ${boundary.jurisdiction})`;
}

/**
 * Extract bounding box from GeoJSON geometry
 */
export function extractBBox(geometry: Polygon | MultiPolygon): BBox {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  const processRing = (ring: Position[]) => {
    for (const [lon, lat] of ring) {
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    }
  };

  if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach(processRing);
  } else {
    // MultiPolygon
    geometry.coordinates.forEach((polygon) => polygon.forEach(processRing));
  }

  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Check if point is inside bounding box
 *
 * Fast O(1) pre-filter before expensive PIP test.
 */
export function isPointInBBox(point: LatLng, bbox: BBox): boolean {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return (
    point.lng >= minLon &&
    point.lng <= maxLon &&
    point.lat >= minLat &&
    point.lat <= maxLat
  );
}
