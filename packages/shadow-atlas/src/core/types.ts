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

// ============================================================================
// Boundary Hierarchy Types (from types/boundary.ts)
// ============================================================================

import {
  BoundaryType,
  BoundaryMetadata,
  BoundaryGeometry,
  BoundaryResolution,
  LatLng,
  BBox,
  PolygonRing,
  PRECISION_RANK,
} from '../types/boundary.js';

export {
  BoundaryType,
  BoundaryMetadata,
  BoundaryGeometry,
  BoundaryResolution,
  LatLng,
  BBox,
  PolygonRing,
  PRECISION_RANK,
};

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
  | 'city' | 'municipality' | 'commune' | 'municipal'     // Municipal level
  | 'ward' | 'council-district'            // Sub-municipal level
  | 'congressional'                       // Federal legislative
  | 'state-legislative-upper'             // State legislative upper
  | 'state-legislative-lower'             // State legislative lower
  | 'county-commission'                   // County legislative
  | 'school-district';                    // School district

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
  | 'census-bas'             // US Census Bureau Boundary and Annexation Survey
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
// Provenance Type Hierarchy - SINGLE SOURCE OF TRUTH
// ============================================================================

/**
 * Base provenance metadata (required fields for all layers)
 * Used in minimal contexts (serving layer, API responses)
 */
export interface BaseProvenanceMetadata {
  /** Source URL or identifier */
  readonly source: string;

  /** Authority level of data source */
  readonly authority: 'state-gis' | 'federal' | 'municipal' | 'community';

  /** Acquisition timestamp (Unix milliseconds) */
  readonly timestamp: number;

  /** Acquisition method */
  readonly method: string;

  /** SHA-256 hash of raw HTTP response */
  readonly responseHash: string;

  /** Legal basis for boundaries (optional) */
  readonly legalBasis?: string;
}

/**
 * Full provenance metadata (used in core operations)
 * Extends base with complete temporal, legal, and quality metadata
 */
export interface ProvenanceMetadata extends BaseProvenanceMetadata {
  /** Jurisdiction (e.g., "Hawaii", "USA", "France") */
  readonly jurisdiction: string;

  /** Source last modified (from HTTP Last-Modified header) */
  readonly sourceLastModified?: number;

  /** Effective date when boundaries became official (ISO 8601) */
  readonly effectiveDate?: string;

  /** HTTP status code */
  readonly httpStatus: number;

  /** License (e.g., "Public Domain", "CC-BY-4.0") */
  readonly license?: string;

  /** Number of features in dataset */
  readonly featureCount: number;

  /** Geometry type */
  readonly geometryType: 'Polygon' | 'MultiPolygon';

  /** Coordinate system (e.g., "EPSG:4326" for WGS84) */
  readonly coordinateSystem: string;
}

/**
 * Acquisition-specific provenance metadata
 * Extends full provenance with validation metadata from orchestrator
 */
export interface AcquisitionProvenanceMetadata extends ProvenanceMetadata {
  /** Stage 1 validation metadata (added by orchestrator) */
  readonly validation?: {
    readonly confidence: number;
    readonly issues: readonly string[];
    readonly warnings: readonly string[];
    readonly timestamp: string;
  };
}

/**
 * Serving-specific provenance metadata
 * Minimal subset for API responses (reduces payload size)
 */
export type ServingProvenanceMetadata = BaseProvenanceMetadata;

// ============================================================================
// Transformation Pipeline Types (from transformation/types.ts)
// ============================================================================

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
// State FIPS Code Mappings - SINGLE SOURCE OF TRUTH
// ============================================================================

/**
 * State FIPS code → State name mapping
 *
 * Canonical source for all FIPS-to-name conversions.
 * Includes 50 states + DC + 5 territories.
 *
 * Source: US Census Bureau FIPS codes
 * https://www.census.gov/library/reference/code-lists/ansi.html
 */
export const STATE_FIPS_TO_NAME: Readonly<Record<string, string>> = {
  // 50 States + DC
  '01': 'Alabama',
  '02': 'Alaska',
  '04': 'Arizona',
  '05': 'Arkansas',
  '06': 'California',
  '08': 'Colorado',
  '09': 'Connecticut',
  '10': 'Delaware',
  '11': 'District of Columbia',
  '12': 'Florida',
  '13': 'Georgia',
  '15': 'Hawaii',
  '16': 'Idaho',
  '17': 'Illinois',
  '18': 'Indiana',
  '19': 'Iowa',
  '20': 'Kansas',
  '21': 'Kentucky',
  '22': 'Louisiana',
  '23': 'Maine',
  '24': 'Maryland',
  '25': 'Massachusetts',
  '26': 'Michigan',
  '27': 'Minnesota',
  '28': 'Mississippi',
  '29': 'Missouri',
  '30': 'Montana',
  '31': 'Nebraska',
  '32': 'Nevada',
  '33': 'New Hampshire',
  '34': 'New Jersey',
  '35': 'New Mexico',
  '36': 'New York',
  '37': 'North Carolina',
  '38': 'North Dakota',
  '39': 'Ohio',
  '40': 'Oklahoma',
  '41': 'Oregon',
  '42': 'Pennsylvania',
  '44': 'Rhode Island',
  '45': 'South Carolina',
  '46': 'South Dakota',
  '47': 'Tennessee',
  '48': 'Texas',
  '49': 'Utah',
  '50': 'Vermont',
  '51': 'Virginia',
  '53': 'Washington',
  '54': 'West Virginia',
  '55': 'Wisconsin',
  '56': 'Wyoming',
  // US Territories
  '60': 'American Samoa',
  '66': 'Guam',
  '69': 'Northern Mariana Islands',
  '72': 'Puerto Rico',
  '78': 'US Virgin Islands',
} as const;

/**
 * State abbreviation → FIPS code mapping
 *
 * Reverse mapping for lookups by state code.
 * Used primarily by TIGER boundary provider for state filtering.
 */
export const STATE_ABBR_TO_FIPS: Readonly<Record<string, string>> = {
  // 50 States
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06',
  CO: '08', CT: '09', DE: '10', FL: '12', GA: '13',
  HI: '15', ID: '16', IL: '17', IN: '18', IA: '19',
  KS: '20', KY: '21', LA: '22', ME: '23', MD: '24',
  MA: '25', MI: '26', MN: '27', MS: '28', MO: '29',
  MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34',
  NM: '35', NY: '36', NC: '37', ND: '38', OH: '39',
  OK: '40', OR: '41', PA: '42', RI: '44', SC: '45',
  SD: '46', TN: '47', TX: '48', UT: '49', VT: '50',
  VA: '51', WA: '53', WV: '54', WI: '55', WY: '56',
  // DC + Territories
  DC: '11',
  AS: '60', GU: '66', MP: '69', PR: '72', VI: '78',
} as const;

/**
 * Get state name from FIPS code
 *
 * @param fips - 2-digit FIPS code (e.g., "06" for California)
 * @returns State name or null if FIPS code not found
 *
 * @example
 * getStateNameFromFips('06') // 'California'
 * getStateNameFromFips('72') // 'Puerto Rico'
 * getStateNameFromFips('99') // null
 */
export function getStateNameFromFips(fips: string): string | null {
  return STATE_FIPS_TO_NAME[fips] ?? null;
}

/**
 * Get FIPS code from state abbreviation
 *
 * @param abbr - 2-letter state abbreviation (e.g., "CA" for California)
 * @returns FIPS code or null if abbreviation not found
 *
 * @example
 * getFipsFromStateAbbr('CA') // '06'
 * getFipsFromStateAbbr('PR') // '72'
 * getFipsFromStateAbbr('XX') // null
 */
export function getFipsFromStateAbbr(abbr: string): string | null {
  return STATE_ABBR_TO_FIPS[abbr] ?? null;
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

// ============================================================================
// Rate Limiter Types (Unified Interface)
// ============================================================================

/**
 * Unified rate limiter configuration
 *
 * Used by both MultiTierRateLimiter (security/) and TokenBucketRateLimiter (resilience/)
 */
export interface UnifiedRateLimiterConfig {
  readonly maxTokens: number;
  readonly refillRate: number; // tokens per second
  readonly refillIntervalMs?: number; // defaults to 1000ms
}

/**
 * Unified rate limit check result
 *
 * Returned by all rate limiter implementations for consistent handling
 */
export interface UnifiedRateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetMs: number; // milliseconds until bucket refills
  readonly retryAfterMs?: number; // milliseconds to wait if rate limited
}

/**
 * Unified rate limiter interface
 *
 * All rate limiter implementations MUST satisfy this interface
 * for consistent behavior across security/ and resilience/ modules
 */
export interface UnifiedRateLimiter {
  /**
   * Check if request is allowed without consuming tokens
   *
   * @param clientId - Client identifier (IP address, API key, etc.)
   * @param cost - Number of tokens required (default: 1)
   * @returns Rate limit result with remaining tokens and retry timing
   */
  check(clientId: string, cost?: number): UnifiedRateLimitResult;

  /**
   * Consume tokens if available
   *
   * @param clientId - Client identifier
   * @param cost - Number of tokens to consume (default: 1)
   * @returns true if tokens consumed, false if rate limited
   */
  consume(clientId: string, cost?: number): boolean;

  /**
   * Get remaining tokens for client
   *
   * @param clientId - Client identifier
   * @returns Number of tokens remaining
   */
  getRemainingTokens(clientId: string): number;
}

// ============================================================================
// ShadowAtlasService Types (Unified Facade)
// ============================================================================

/**
 * Legislative layer types for state boundary extraction
 */
export type LegislativeLayerType =
  | 'congressional'
  | 'state_senate'
  | 'state_house'
  | 'county';

/**
 * Extraction scope types
 */
export type ExtractionScope =
  | { readonly type: 'state'; readonly states: readonly string[] }
  | { readonly type: 'country'; readonly country: string }
  | { readonly type: 'region'; readonly regions: readonly RegionConfig[] }
  | { readonly type: 'global' };

export interface RegionConfig {
  readonly state: string;
  readonly layers?: readonly LegislativeLayerType[];
}

export interface IncrementalScope {
  readonly states?: readonly string[];
  readonly layers?: readonly LegislativeLayerType[];
  readonly since?: Date;
}

/**
 * Extraction options
 */
export interface ExtractionOptions {
  readonly validation?: ValidationOptions;
  readonly concurrency?: number;
  readonly continueOnError?: boolean;
  readonly minPassRate?: number;
  readonly storage?: StorageConfig;
  readonly resumeFromJob?: string;
  readonly onProgress?: (progress: ProgressEvent) => void;
}

export interface ValidationOptions {
  readonly crossValidate?: boolean;
  readonly minConfidence?: number;
  readonly storeResults?: boolean;
}

export interface StorageConfig {
  readonly storeDir: string;
  readonly persistJobState?: boolean;
}

export interface ProgressEvent {
  readonly completed: number;
  readonly total: number;
  readonly currentItem: string;
}

/**
 * Pipeline result types
 */
export interface PipelineResult {
  readonly jobId: string;
  readonly status: 'committed' | 'validation_failed' | 'extraction_failed';
  readonly duration: number;
  readonly extraction: ExtractionSummary;
  readonly validation: ValidationSummary;
  readonly commitment?: CommitmentResult;
}

export interface ExtractionSummary {
  readonly totalBoundaries: number;
  readonly successfulExtractions: number;
  readonly failedExtractions: readonly ExtractionFailure[];
}

export interface ExtractionFailure {
  readonly state: string;
  readonly layer: LegislativeLayerType;
  readonly error: string;
  readonly timestamp: string;
}

export interface ValidationSummary {
  readonly passed: number;
  readonly warned: number;
  readonly failed: number;
  readonly passRate: number;
  readonly results: ReadonlyMap<string, TransformationValidationResult>;
}

export interface CommitmentResult {
  readonly snapshotId: string;
  readonly merkleRoot: string;
  readonly ipfsCID: string;
  readonly includedBoundaries: number;
  readonly excludedBoundaries: number;
}

/**
 * Incremental update types
 */
export interface IncrementalResult {
  readonly status: 'updated' | 'unchanged' | 'no_changes';
  readonly previousRoot: string;
  readonly newRoot: string;
  readonly changes: readonly string[];
  readonly stats?: {
    readonly added: number;
    readonly updated: number;
    readonly unchanged: number;
  };
}

export interface IncrementalOptions extends ExtractionOptions {
  readonly forceRefresh?: boolean;
}

/**
 * Change detection types
 */
export interface ChangeDetectionResult {
  readonly hasChanges: boolean;
  readonly changedRegions: readonly string[];
  readonly unchangedRegions: readonly string[];
  readonly checkMethod: 'etag' | 'last-modified' | 'count' | 'hash';
  readonly confidence: number;
}

/**
 * Health check types
 */
export interface HealthCheckResult {
  readonly healthy: boolean;
  readonly providers: readonly ProviderHealth[];
  readonly checkedAt: Date;
}

export interface ProviderHealth {
  readonly name: string;
  readonly available: boolean;
  readonly latencyMs: number;
  readonly lastSuccessfulExtraction?: Date;
  readonly issues: readonly string[];
}

/**
 * Job state for resume capability
 */
export interface JobState {
  readonly jobId: string;
  readonly scope: ExtractionScope;
  readonly options: ExtractionOptions;
  readonly startedAt: Date;
  readonly completedScopes: readonly string[];
  readonly failedScopes: readonly string[];
  readonly status: 'in_progress' | 'completed' | 'failed' | 'paused';
}

/**
 * Snapshot metadata for incremental updates
 */
export interface SnapshotMetadata {
  readonly id: string;
  readonly merkleRoot: string;
  readonly ipfsCID: string;
  readonly boundaryCount: number;
  readonly createdAt: Date;
  readonly regions: readonly string[];
  readonly globalReplication?: {
    readonly totalReplicas: number;
    readonly healthyReplicas: number;
    readonly replicatedRegions: readonly string[];
  };
}

// ============================================================================
// TIGER Validation Types
// ============================================================================

/**
 * TIGER validation options
 */
export interface TIGERValidationOptions {
  /** State FIPS code or 'all' for national validation */
  readonly state?: string;

  /** Layers to validate (defaults to all layers) */
  readonly layers?: readonly TIGERLayerType[];

  /** TIGER year to validate (defaults to current year) */
  readonly year?: number;

  /** Minimum quality score threshold (0-100, defaults to 90) */
  readonly qualityThreshold?: number;
}

/**
 * TIGER layer validation result
 */
export interface TIGERLayerValidation {
  /** Layer type */
  readonly layer: TIGERLayerType;

  /** Whether this layer passed all validation checks */
  readonly valid: boolean;

  /** Overall quality score (0-100) */
  readonly qualityScore: number;

  /** Completeness validation result */
  readonly completeness: CompletenessResult;

  /** Topology validation result */
  readonly topology: TopologyResult;

  /** Coordinate validation result */
  readonly coordinates: CoordinateResult;

  /** When validation was performed */
  readonly validatedAt: Date;

  /** Human-readable summary */
  readonly summary: string;
}

/**
 * Overall TIGER validation result
 */
export interface TIGERValidationResult {
  /** State FIPS code or 'all' */
  readonly state: string;

  /** Human-readable state name */
  readonly stateName: string;

  /** TIGER year validated */
  readonly year: number;

  /** Results for each validated layer */
  readonly layers: readonly TIGERLayerValidation[];

  /** Whether all layers passed validation and met quality threshold */
  readonly overallValid: boolean;

  /** Average quality score across all layers */
  readonly averageQualityScore: number;

  /** Quality threshold that was applied */
  readonly qualityThreshold: number;

  /** Validation duration in milliseconds */
  readonly duration: number;

  /** When validation was performed */
  readonly validatedAt: Date;

  /** Human-readable summary */
  readonly summary: string;
}

/**
 * Completeness validation result (from TIGERValidator)
 */
export interface CompletenessResult {
  readonly valid: boolean;
  readonly expected: number;
  readonly actual: number;
  readonly percentage: number;
  readonly missingGEOIDs: readonly string[];
  readonly extraGEOIDs: readonly string[];
  readonly summary: string;
}

/**
 * Topology validation result (from TIGERValidator)
 */
export interface TopologyResult {
  readonly valid: boolean;
  readonly selfIntersections: number;
  readonly overlaps: readonly {
    readonly geoid1: string;
    readonly geoid2: string;
    readonly overlapArea: number;
  }[];
  readonly gaps: number;
  readonly invalidGeometries: readonly string[];
  readonly summary: string;
}

/**
 * Coordinate validation result (from TIGERValidator)
 */
export interface CoordinateResult {
  readonly valid: boolean;
  readonly outOfRangeCount: number;
  readonly nullCoordinates: readonly string[];
  readonly suspiciousLocations: readonly {
    readonly geoid: string;
    readonly reason: string;
    readonly centroid: { readonly lat: number; readonly lon: number };
  }[];
  readonly summary: string;
}

// ============================================================================
// Atlas Build Types
// ============================================================================

/**
 * Canonical TIGER layer types
 *
 * Maps to Census Bureau TIGER/Line file categories.
 * Single source of truth - import from here, never redefine.
 *
 * @see https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html
 */
/**
 * TIGER Layer Configuration Strategy
 *
 * Two configuration sets exist for different access patterns:
 *
 * 1. TIGERWEB_LAYER_CONFIG (census-tiger-loader.ts)
 *    - For TIGERweb REST API point-in-polygon queries
 *    - Contains: tigerwebService, tigerwebLayer IDs for MapServer endpoints
 *    - Use case: Real-time coordinate lookups (e.g., "which district is this address in?")
 *    - Access pattern: Individual queries, millisecond response times
 *
 * 2. TIGER_FTP_LAYERS (tiger-boundary-provider.ts)
 *    - For Census FTP bulk shapefile downloads
 *    - Contains: ftpDir paths, expectedCount, field mappings for extraction
 *    - Use case: Quarterly batch extractions (download all districts nationwide)
 *    - Access pattern: Bulk downloads, multi-minute operations
 *
 * WHY SEPARATE CONFIGURATIONS?
 * - Different data sources (REST API vs FTP) require different metadata
 * - MapServer layer IDs (18, 20, 22) ≠ FTP directory names (CD, SLDU, SLDL)
 * - Real-time queries need minimal metadata; bulk downloads need validation counts
 */
/**
 * TIGER Layer Types - Complete US Civic Boundary Coverage
 *
 * Organized by civic participation priority:
 * - T1 (Elected Federal/State): cd, sldu, sldl
 * - T2 (Elected Local): place, unsd, elsd, scsd
 * - T3 (Administrative): county, cousub, vtd
 * - T4 (Reference): cdp, zcta
 */
export type TIGERLayerType =
  // Federal/State Legislative (Tier 1 - Elected Representatives)
  | 'cd'      // Congressional Districts (435)
  | 'sldu'    // State Legislative Upper (Senate) (~2,000)
  | 'sldl'    // State Legislative Lower (House) (~5,400)

  // County Level (Tier 2 - Elected Commissioners)
  | 'county'  // Counties (3,143)
  | 'cousub'  // County Subdivisions - townships, boroughs (~34,000)

  // Municipal (Tier 3 - City Boundaries)
  | 'place'   // Incorporated Places - cities, towns, villages (19,495)
  | 'cdp'     // Census Designated Places - unincorporated communities (~9,500)

  // School Districts (Tier 4 - Elected School Boards)
  | 'unsd'    // Unified School Districts K-12 (~9,135)
  | 'elsd'    // Elementary School Districts K-8 (~3,064)
  | 'scsd'    // Secondary School Districts 9-12 (~273)

  // Electoral Infrastructure (Tier 5 - Finest Civic Unit)
  | 'vtd'     // Voting Districts - precincts (~200,000)

  // Reference Layers (Tier 6 - Mail/Demographic)
  | 'zcta';   // ZIP Code Tabulation Areas (~33,000)

/**
 * Backwards compatibility alias
 * @deprecated Use TIGERLayerType instead
 */
export type TIGERLayer = TIGERLayerType;

/**
 * Unified layer type across all sources
 */
export type LayerType = TIGERLayerType | LegislativeLayerType;


/**
 * Atlas build options
 */
export interface AtlasBuildOptions {
  /** Layers to include in the Atlas */
  readonly layers: readonly TIGERLayerType[];

  /** Optional: Filter to specific states (FIPS codes) */
  readonly states?: readonly string[];

  /** Optional: TIGER year (defaults to 2024) */
  readonly year?: number;

  /** Optional: Minimum quality threshold for validation (0-100, defaults to 80) */
  readonly qualityThreshold?: number;

  /** Optional: Output path for JSON export */
  readonly outputPath?: string;
}

/**
 * Layer validation result for Atlas build
 */
export interface LayerValidationResult {
  /** Layer type */
  readonly layer: string;

  /** Quality score (0-100) */
  readonly qualityScore: number;

  /** Number of boundaries in layer */
  readonly boundaryCount: number;

  /** Expected boundary count */
  readonly expectedCount: number;

  /** Full validation result (null if failed before validation) */
  readonly validation: import('../validators/tiger-validator.js').ValidationResult | null;

  /** Error message if layer failed */
  readonly error?: string;
}

/**
 * Atlas build result
 */
export interface AtlasBuildResult {
  /** Job ID for this build */
  readonly jobId: string;

  /** Merkle root of the built tree */
  readonly merkleRoot: bigint;

  /** Total number of boundaries in the Atlas */
  readonly totalBoundaries: number;

  /** Boundary counts per layer type */
  readonly layerCounts: Record<string, number>;

  /** Validation results for each layer */
  readonly layerValidations: readonly LayerValidationResult[];

  /** Tree depth */
  readonly treeDepth: number;

  /** Build duration in milliseconds */
  readonly duration: number;

  /** Build timestamp */
  readonly timestamp: Date;
}
