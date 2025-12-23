/**
 * Shadow Atlas: Global Boundary Provider Interface
 *
 * Composable abstraction for country-specific boundary data sources.
 * All providers (US Census TIGER, Canada StatCan, UK Ordnance Survey, etc.)
 * implement this interface for uniform global expansion.
 */

import type { FeatureCollection, Geometry } from 'geojson';

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
  getMetadata(): Promise<SourceMetadata>;
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
 * Canonical definition in core/types.ts - imported and re-exported here
 */
import type { NormalizedBoundary as CoreNormalizedBoundary } from '../core/types.js';
export type NormalizedBoundary = CoreNormalizedBoundary;

/**
 * Source metadata for attribution and versioning
 */
export interface SourceMetadata {
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
 * Canonical definition in core/types.ts
 */
import type { AdministrativeLevel as CoreAdministrativeLevel } from '../core/types.js';
export type AdministrativeLevel = CoreAdministrativeLevel;

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
 * Validation result
 */
export interface ValidationResult {
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
