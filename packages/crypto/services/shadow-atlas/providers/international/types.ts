/**
 * International Boundary Provider Types
 *
 * Common interfaces for all international boundary providers.
 * These providers fetch legislative/electoral district boundaries from
 * national data sources outside the United States.
 *
 * DESIGN PHILOSOPHY:
 * - Uniform interface for diverse data sources (ArcGIS REST, WFS, custom APIs)
 * - Explicit expected counts for validation
 * - Health monitoring for upstream availability
 * - Update schedule awareness (annual vs event-driven)
 *
 * USAGE:
 * ```typescript
 * const ukProvider = new UKBoundaryProvider();
 * const result = await ukProvider.extractAll();
 * const health = await ukProvider.healthCheck();
 * ```
 */

import type { Polygon, MultiPolygon } from 'geojson';

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Common interface for all international boundary providers
 *
 * Each country implements this interface to provide a uniform API for:
 * - Extracting all available boundary layers
 * - Checking for upstream data changes
 * - Monitoring provider health and availability
 */
export interface InternationalBoundaryProvider {
  /** ISO 3166-1 alpha-2 country code (e.g., 'GB', 'CA') */
  readonly country: string;

  /** Human-readable country name */
  readonly countryName: string;

  /** Data source organization (e.g., 'ONS', 'Elections Canada') */
  readonly dataSource: string;

  /** API type for this provider */
  readonly apiType: 'arcgis-rest' | 'wfs' | 'rest-custom' | 'manual';

  /** License identifier (e.g., 'OGL', 'OGL-CA') */
  readonly license: string;

  /** Available boundary layers */
  readonly layers: Record<string, LayerConfig>;

  /**
   * Extract all available layers
   */
  extractAll(): Promise<InternationalExtractionResult>;

  /**
   * Check for upstream changes since last extraction
   *
   * @param lastExtraction - Previous extraction timestamp
   * @returns true if upstream data has changed
   */
  hasChangedSince(lastExtraction: Date): Promise<boolean>;

  /**
   * Health check for provider availability
   */
  healthCheck(): Promise<ProviderHealth>;
}

// ============================================================================
// Layer Configuration
// ============================================================================

/**
 * Layer configuration (boundary type available from provider)
 */
export interface LayerConfig {
  /** Layer name */
  readonly name: string;

  /** Layer type identifier */
  readonly type: string;

  /** Expected boundary count (for validation) */
  readonly expectedCount: number;

  /** Update schedule */
  readonly updateSchedule: 'annual' | 'event-driven' | 'quarterly';
}

// ============================================================================
// Extraction Results
// ============================================================================

/**
 * Result from extracting all layers from a provider
 */
export interface InternationalExtractionResult {
  /** ISO 3166-1 alpha-2 country code */
  readonly country: string;

  /** Extraction results for each layer */
  readonly layers: readonly LayerExtractionResult[];

  /** Total boundaries across all layers */
  readonly totalBoundaries: number;

  /** Extraction timestamp */
  readonly extractedAt: Date;

  /** Provider version/identifier */
  readonly providerVersion: string;
}

/**
 * Result from extracting a single layer
 */
export interface LayerExtractionResult {
  /** Layer type */
  readonly layer: string;

  /** Extracted boundaries */
  readonly boundaries: readonly InternationalBoundary[];

  /** Expected count for validation */
  readonly expectedCount: number;

  /** Actual count extracted */
  readonly actualCount: number;

  /** Whether count matches expected */
  readonly matched: boolean;

  /** Extraction timestamp */
  readonly extractedAt: Date;

  /** Source endpoint URL */
  readonly source: string;

  /** Extraction duration */
  readonly durationMs?: number;

  /** Error message if extraction failed */
  readonly error?: string;
}

/**
 * Generic international boundary (base interface)
 */
export interface InternationalBoundary {
  /** Unique identifier (format varies by country) */
  readonly id: string;

  /** Boundary name */
  readonly name: string;

  /** Boundary type (e.g., 'parliamentary', 'federal') */
  readonly type: string;

  /** GeoJSON geometry */
  readonly geometry: Polygon | MultiPolygon;

  /** Source metadata */
  readonly source: {
    readonly country: string;
    readonly dataSource: string;
    readonly endpoint: string;
    readonly vintage: number;
    readonly retrievedAt: string;
  };

  /** Original properties from data source */
  readonly properties: Record<string, unknown>;
}

// ============================================================================
// Provider Health
// ============================================================================

/**
 * Provider health status
 */
export interface ProviderHealth {
  /** Is provider available? */
  readonly available: boolean;

  /** Response latency in milliseconds */
  readonly latencyMs: number;

  /** Last health check timestamp */
  readonly lastChecked: Date;

  /** Issues detected during health check */
  readonly issues: readonly string[];
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Update schedule for boundary data
 */
export type UpdateSchedule = 'annual' | 'event-driven' | 'quarterly';

/**
 * API type for provider
 */
export type ProviderAPIType = 'arcgis-rest' | 'wfs' | 'rest-custom' | 'manual';

/**
 * License type for data
 */
export type LicenseType = 'OGL' | 'OGL-CA' | 'CC-BY' | 'public-domain';
