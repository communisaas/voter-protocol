/**
 * Layer 1: Acquisition - Type Definitions
 *
 * ZERO TOLERANCE TYPE SAFETY: These types define the contract for authoritative
 * geographic data acquisition. Type errors here compromise data provenance.
 */

// ============================================================================
// Re-export Provenance Types from Core (Single Source of Truth)
// ============================================================================

import type {
  BaseProvenanceMetadata as CoreBaseProvenanceMetadata,
  ProvenanceMetadata as CoreProvenanceMetadata,
  AcquisitionProvenanceMetadata as CoreAcquisitionProvenanceMetadata,
  LayerType as CoreLayerType
} from '../core/types.js';

export type BaseProvenanceMetadata = CoreBaseProvenanceMetadata;
export type ProvenanceMetadata = CoreProvenanceMetadata;
export type AcquisitionProvenanceMetadata = CoreAcquisitionProvenanceMetadata;
export type LayerType = CoreLayerType;


/**
 * Authority level of data source
 * Re-exported type for convenience (actual definition in core/types.ts)
 */
export type AuthorityLevel = 'state-gis' | 'federal' | 'municipal' | 'community';

/**
 * Portal type classification
 */
export type PortalType = 'arcgis' | 'socrata' | 'ckan' | 'custom-api' | 'osm';

/**
 * Acquisition method
 */
export type AcquisitionMethod =
  | 'ArcGIS Portal API'
  | 'ArcGIS REST API'
  | 'Overpass API'
  | 'Socrata API'
  | 'CKAN API'
  | 'Direct HTTP';

/**
 * GeoJSON Feature (strict typing)
 */
export interface GeoJSONFeature {
  readonly type: 'Feature';
  readonly id?: string | number;
  readonly properties: Record<string, unknown>;
  readonly geometry: GeoJSONGeometry;
}

/**
 * GeoJSON Geometry (Polygon or MultiPolygon only)
 */
export type GeoJSONGeometry =
  | {
    readonly type: 'Polygon';
    readonly coordinates: readonly (readonly [number, number][])[];
  }
  | {
    readonly type: 'MultiPolygon';
    readonly coordinates: readonly (readonly (readonly [number, number][])[])[];
  };

/**
 * GeoJSON FeatureCollection
 */
export interface GeoJSONFeatureCollection {
  readonly type: 'FeatureCollection';
  readonly features: readonly GeoJSONFeature[];
  readonly bbox?: readonly [number, number, number, number];
}

/**
 * Raw dataset from acquisition
 * Uses AcquisitionProvenanceMetadata (includes validation field)
 */
export interface RawDataset {
  /** GeoJSON data */
  readonly geojson: GeoJSONFeatureCollection;

  /** Provenance metadata with optional validation */
  readonly provenance: AcquisitionProvenanceMetadata;
}

/**
 * Snapshot metadata
 */
export interface SnapshotMetadata {
  /** Snapshot timestamp (ISO 8601 date) */
  readonly timestamp: string;

  /** Output directory path */
  readonly outputDir: string;

  /** SHA-256 hash of entire snapshot directory */
  readonly snapshotHash: string;

  /** Source counts by type */
  readonly sources: readonly {
    readonly type: string;
    readonly count: number;
  }[];
}

/**
 * Scraper configuration
 */
export interface ScraperConfig {
  /** Maximum parallel requests */
  readonly maxParallel: number;

  /** Rate limit (requests per second) */
  readonly rateLimit: number;

  /** Request timeout (milliseconds) */
  readonly timeout: number;

  /** Maximum retry attempts */
  readonly maxRetries: number;

  /** Backoff multiplier for retries */
  readonly backoffMultiplier: number;

  /** User agent string */
  readonly userAgent: string;
}

/**
 * Scraper progress callback
 */
export interface ScraperProgress {
  /** Total items to scrape */
  readonly total: number;

  /** Items completed */
  readonly completed: number;

  /** Items failed */
  readonly failed: number;

  /** Current item being scraped */
  readonly current?: string;
}

/**
 * Scraper result
 */
export interface ScraperResult {
  /** Successfully acquired datasets */
  readonly datasets: readonly RawDataset[];

  /** Failed acquisitions */
  readonly failures: readonly {
    readonly source: string;
    readonly error: string;
  }[];

  /** Execution time (milliseconds) */
  readonly executionTime: number;
}

/**
 * ArcGIS Portal search result item
 */
export interface ArcGISPortalItem {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly url: string;
  readonly description?: string;
  readonly owner?: string;
  readonly created?: number;
  readonly modified?: number;
  readonly numViews?: number;
  readonly tags?: readonly string[];
}

/**
 * ArcGIS Portal search response
 */
export interface ArcGISPortalSearchResponse {
  readonly total: number;
  readonly start: number;
  readonly num: number;
  readonly nextStart: number;
  readonly results: readonly ArcGISPortalItem[];
}

/**
 * ArcGIS Feature Service metadata
 */
export interface ArcGISFeatureServiceMetadata {
  readonly layers: readonly {
    readonly id: number;
    readonly name: string;
    readonly type: string;
    readonly geometryType: string;
  }[];
}

/**
 * Overpass API response (simplified)
 */
export interface OverpassResponse {
  readonly version: number;
  readonly generator: string;
  readonly elements: readonly OverpassElement[];
}

/**
 * Overpass API element
 */
export interface OverpassElement {
  readonly type: 'node' | 'way' | 'relation';
  readonly id: number;
  readonly tags?: Record<string, string>;
  readonly members?: readonly {
    readonly type: string;
    readonly ref: number;
    readonly role: string;
  }[];
  readonly geometry?: readonly {
    readonly lat: number;
    readonly lon: number;
  }[];
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  readonly maxAttempts: number;
  readonly initialDelay: number;
  readonly maxDelay: number;
  readonly backoffMultiplier: number;
}
