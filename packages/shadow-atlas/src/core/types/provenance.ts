/**
 * Provenance Types
 *
 * Type hierarchy for tracking data lineage, authority, and quality.
 * Single source of truth for provenance metadata across the system.
 */

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

/**
 * Re-export from provenance-writer.js for convenience
 */
export type { ProvenanceRecord } from '../../provenance/provenance-writer.js';
