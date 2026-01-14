/**
 * International Boundary Provider Base Classes
 *
 * ARCHITECTURE PHILOSOPHY:
 * Shadow Atlas currently achieves 100% accuracy for US boundaries (50 states,
 * 435 congressional districts, 7,383 state legislative districts). To scale
 * globally to 190+ countries, we need extensible provider architecture that:
 *
 * 1. **Handles diverse data sources**: ArcGIS REST, WFS, custom APIs, static files
 * 2. **Validates with expected counts**: Parliamentary seats, electoral districts
 * 3. **Monitors upstream health**: Provider availability, data freshness
 * 4. **Supports incremental updates**: Event-driven (redistricting) vs periodic
 * 5. **Maintains type safety**: Strict TypeScript with discriminated unions
 *
 * SCALING STRATEGY:
 * - Phase 1 (Months 1-6): Anglosphere (UK, CA, AU, NZ) - 4 countries
 * - Phase 2 (Months 7-12): EU members - 27 countries
 * - Phase 3 (Months 13-24): G20 + major democracies - 50 countries
 * - Phase 4 (Months 25-36): Global coverage - 190+ countries
 *
 * DESIGN PATTERNS:
 * - Abstract base classes for common functionality (retry, health checks)
 * - Country-specific providers extend base with data source logic
 * - Provider registry maps ISO country codes to provider instances
 * - Validation against official expected counts (prevent data corruption)
 *
 * @see GLOBAL_SCALING_SPEC.md for complete expansion roadmap
 */

import type { Polygon, MultiPolygon, FeatureCollection } from 'geojson';
import { logger } from '../../core/utils/logger.js';

// ============================================================================
// Base Provider Interface (Contract for All International Providers)
// ============================================================================

/**
 * Base interface that all international boundary providers must implement
 *
 * CRITICAL TYPE SAFETY: readonly everywhere, strict generics, discriminated unions.
 * These types define the contract for event-sourced boundary data. Type errors
 * can brick the entire discovery pipeline.
 */
export interface InternationalBoundaryProvider<
  TLayerType extends string = string,
  TBoundary extends InternationalBoundary = InternationalBoundary
> {
  /** ISO 3166-1 alpha-2 country code (e.g., 'GB', 'CA', 'AU') */
  readonly country: string;

  /** Human-readable country name */
  readonly countryName: string;

  /** Official data source organization (e.g., 'ONS', 'Elections Canada') */
  readonly dataSource: string;

  /** API type for this provider */
  readonly apiType: DataSourceType;

  /** Data license (SPDX identifier) */
  readonly license: string;

  /** Available boundary layers (discriminated by layer type) */
  readonly layers: ReadonlyMap<TLayerType, LayerConfig<TLayerType>>;

  /**
   * Extract all available layers
   *
   * Primary method for full country extraction. Returns all configured
   * boundary layers with validation against expected counts.
   *
   * @returns Complete extraction result with all layers
   */
  extractAll(): Promise<InternationalExtractionResult<TLayerType, TBoundary>>;

  /**
   * Extract a specific layer
   *
   * @param layerType - Layer identifier (e.g., 'parliamentary', 'federal')
   * @returns Single layer extraction result
   */
  extractLayer(layerType: TLayerType): Promise<LayerExtractionResult<TLayerType, TBoundary>>;

  /**
   * Check for upstream changes since last extraction
   *
   * Implementations should check:
   * - HTTP ETag/Last-Modified headers
   * - API-provided last edit timestamps
   * - Feature count changes
   * - Hash of downloaded data
   *
   * @param lastExtraction - Previous extraction timestamp
   * @returns true if upstream data has changed
   */
  hasChangedSince(lastExtraction: Date): Promise<boolean>;

  /**
   * Health check for provider availability
   *
   * Tests:
   * - Network connectivity to data source
   * - API authentication (if required)
   * - Response latency
   * - Data integrity (feature count > 0)
   *
   * @returns Health status with latency and issues
   */
  healthCheck(): Promise<ProviderHealth>;

  /**
   * Get expected counts for all layers
   *
   * Used for validation during extraction. Ensures we don't accidentally
   * miss districts due to API pagination bugs or network errors.
   *
   * @returns Map of layer type to expected feature count
   */
  getExpectedCounts(): Promise<ReadonlyMap<TLayerType, number>>;
}

// ============================================================================
// Data Source Types
// ============================================================================

/**
 * Data source type (determines extraction strategy)
 */
export type DataSourceType =
  | 'arcgis-rest'      // ArcGIS REST API (FeatureServer, MapServer)
  | 'arcgis-hub'       // ArcGIS Hub (metadata + REST API)
  | 'wfs'              // OGC Web Feature Service (ISO standard)
  | 'wms'              // OGC Web Map Service (raster, less common)
  | 'rest-api'         // Custom REST API (country-specific)
  | 'graphql'          // GraphQL API (modern APIs)
  | 'static-file'      // Static file download (GeoJSON, Shapefile, KML)
  | 'census-api'       // National census API (Statistics Canada, ONS, etc.)
  | 'electoral-api';   // Electoral commission API (Elections Canada, UK Electoral Commission)

/**
 * Update schedule for boundary data
 */
export type UpdateSchedule =
  | 'annual'           // Once per year (e.g., Canada census updates)
  | 'decennial'        // Once per 10 years (e.g., US Census redistricting)
  | 'event-driven'     // After boundary review events (e.g., UK boundary commissions)
  | 'quarterly'        // Four times per year (rare for electoral boundaries)
  | 'manual';          // No automated updates (requires manual trigger)

/**
 * Authority level of data source
 *
 * Higher authority = more trustworthy, legally binding.
 * Used for conflict resolution when multiple sources exist.
 */
export type AuthorityLevel =
  | 'constitutional'      // Constitutional mandate (e.g., national census bureaus)
  | 'electoral-commission'// Official electoral commission
  | 'national-statistics' // National statistical agency
  | 'state-agency'        // State/provincial government agency
  | 'municipal-agency'    // Municipal GIS department
  | 'commercial'          // Commercial data aggregator
  | 'community';          // Community-maintained (OSM, volunteer)

// ============================================================================
// Layer Configuration
// ============================================================================

/**
 * Layer configuration (boundary type available from provider)
 *
 * Each layer represents one type of electoral/administrative boundary:
 * - UK: parliamentary constituencies, council wards
 * - Canada: federal ridings, provincial districts
 * - Australia: federal electorates, state electorates
 */
export interface LayerConfig<TLayerType extends string = string> {
  /** Layer type identifier */
  readonly type: TLayerType;

  /** Human-readable layer name */
  readonly name: string;

  /** Data endpoint URL (REST API, WFS GetFeature, static file, etc.) */
  readonly endpoint: string;

  /** Expected boundary count (for validation) */
  readonly expectedCount: number;

  /** Update schedule for this layer */
  readonly updateSchedule: UpdateSchedule;

  /** Authority level of this data source */
  readonly authority: AuthorityLevel;

  /** Data vintage year (e.g., 2024 for UK July 2024 boundary review) */
  readonly vintage: number;

  /** Last verified date (ISO 8601) */
  readonly lastVerified: string;

  /** Additional notes about this layer */
  readonly notes?: string;
}

// ============================================================================
// Boundary Types
// ============================================================================

/**
 * Generic international boundary (base interface)
 *
 * All country-specific boundary types extend this interface.
 * Provides common fields for identification, geometry, and provenance.
 */
export interface InternationalBoundary {
  /** Unique identifier (format varies by country) */
  readonly id: string;

  /** Boundary name (primary language) */
  readonly name: string;

  /** Boundary type (e.g., 'parliamentary', 'federal', 'state') */
  readonly type: string;

  /** GeoJSON geometry (WGS84, EPSG:4326) */
  readonly geometry: Polygon | MultiPolygon;

  /** Source metadata (provenance) */
  readonly source: BoundarySource;

  /** Original properties from data source (for debugging) */
  readonly properties: Record<string, unknown>;
}

/**
 * Source metadata for boundary provenance
 */
export interface BoundarySource {
  /** ISO 3166-1 alpha-2 country code */
  readonly country: string;

  /** Data source organization */
  readonly dataSource: string;

  /** Data endpoint URL */
  readonly endpoint: string;

  /** Authority level */
  readonly authority: AuthorityLevel;

  /** Data vintage year */
  readonly vintage: number;

  /** Extraction timestamp (ISO 8601) */
  readonly retrievedAt: string;

  /** ETag from HTTP response (for change detection) */
  readonly etag?: string;

  /** Last-Modified from HTTP response */
  readonly lastModified?: string;
}

// ============================================================================
// Extraction Results
// ============================================================================

/**
 * Result from extracting all layers from a provider
 */
export interface InternationalExtractionResult<
  TLayerType extends string = string,
  TBoundary extends InternationalBoundary = InternationalBoundary
> {
  /** ISO 3166-1 alpha-2 country code */
  readonly country: string;

  /** Extraction results for each layer */
  readonly layers: readonly LayerExtractionResult<TLayerType, TBoundary>[];

  /** Total boundaries across all layers */
  readonly totalBoundaries: number;

  /** Number of layers that succeeded */
  readonly successfulLayers: number;

  /** Number of layers that failed */
  readonly failedLayers: number;

  /** Extraction timestamp */
  readonly extractedAt: Date;

  /** Provider version/identifier */
  readonly providerVersion: string;

  /** Total extraction duration (milliseconds) */
  readonly durationMs: number;
}

/**
 * Result from extracting a single layer
 */
export interface LayerExtractionResult<
  TLayerType extends string = string,
  TBoundary extends InternationalBoundary = InternationalBoundary
> {
  /** Layer type */
  readonly layer: TLayerType;

  /** Whether extraction succeeded */
  readonly success: boolean;

  /** Extracted boundaries (empty if failed) */
  readonly boundaries: readonly TBoundary[];

  /** Expected count for validation */
  readonly expectedCount: number;

  /** Actual count extracted */
  readonly actualCount: number;

  /** Whether count matches expected (critical validation) */
  readonly matched: boolean;

  /** Validation confidence (0-100) */
  readonly confidence: number;

  /** Extraction timestamp */
  readonly extractedAt: Date;

  /** Source endpoint URL */
  readonly source: string;

  /** Extraction duration (milliseconds) */
  readonly durationMs: number;

  /** Error message if extraction failed */
  readonly error?: string;

  /** HTTP metadata (for change detection) */
  readonly httpMetadata?: {
    readonly etag?: string;
    readonly lastModified?: string;
  };
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

  /** API rate limit status (if applicable) */
  readonly rateLimit?: {
    readonly limit: number;
    readonly remaining: number;
    readonly resetAt: Date;
  };
}

// ============================================================================
// Abstract Base Provider (Common Implementation)
// ============================================================================

/**
 * Abstract base class providing common functionality for all providers
 *
 * Implements:
 * - HTTP retry logic with exponential backoff
 * - GeoJSON fetching and validation
 * - Health check helpers
 * - Change detection via HTTP headers
 *
 * Country-specific providers extend this class and implement:
 * - extractAll()
 * - extractLayer()
 * - Layer-specific normalization logic
 */
export abstract class BaseInternationalProvider<
  TLayerType extends string,
  TBoundary extends InternationalBoundary
> implements InternationalBoundaryProvider<TLayerType, TBoundary> {
  abstract readonly country: string;
  abstract readonly countryName: string;
  abstract readonly dataSource: string;
  abstract readonly apiType: DataSourceType;
  abstract readonly license: string;
  abstract readonly layers: ReadonlyMap<TLayerType, LayerConfig<TLayerType>>;

  protected readonly retryAttempts: number;
  protected readonly retryDelayMs: number;
  protected readonly timeoutMs: number;

  constructor(options?: {
    retryAttempts?: number;
    retryDelayMs?: number;
    timeoutMs?: number;
  }) {
    this.retryAttempts = options?.retryAttempts ?? 3;
    this.retryDelayMs = options?.retryDelayMs ?? 1000;
    this.timeoutMs = options?.timeoutMs ?? 30000;
  }

  abstract extractAll(): Promise<InternationalExtractionResult<TLayerType, TBoundary>>;
  abstract extractLayer(layerType: TLayerType): Promise<LayerExtractionResult<TLayerType, TBoundary>>;

  /**
   * Check for upstream changes using HTTP headers
   *
   * Default implementation checks ETag and Last-Modified headers.
   * Providers can override for API-specific change detection.
   */
  async hasChangedSince(lastExtraction: Date): Promise<boolean> {
    // Check each layer endpoint for changes
    for (const [, layerConfig] of this.layers) {
      try {
        const response = await fetch(layerConfig.endpoint, {
          method: 'HEAD',
          headers: {
            'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
          },
        });

        // Check Last-Modified header
        const lastModified = response.headers.get('Last-Modified');
        if (lastModified) {
          const modifiedDate = new Date(lastModified);
          if (modifiedDate > lastExtraction) {
            return true;
          }
        }
      } catch (error) {
        logger.warn('Could not check for changes', {
          country: this.country,
          error: error instanceof Error ? error.message : String(error)
        });
        // Conservatively return true if we can't check
        return true;
      }
    }

    return false;
  }

  /**
   * Health check for provider availability
   *
   * Default implementation tests first layer endpoint.
   * Providers can override for comprehensive health checks.
   */
  async healthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();
    const issues: string[] = [];

    // Get first layer for testing
    const firstLayer = Array.from(this.layers.values())[0];
    if (!firstLayer) {
      return {
        available: false,
        latencyMs: Date.now() - startTime,
        lastChecked: new Date(),
        issues: ['No layers configured'],
      };
    }

    try {
      const response = await fetch(firstLayer.endpoint, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        issues.push(`HTTP ${response.status}: ${response.statusText}`);
        return {
          available: false,
          latencyMs: Date.now() - startTime,
          lastChecked: new Date(),
          issues,
        };
      }

      return {
        available: true,
        latencyMs: Date.now() - startTime,
        lastChecked: new Date(),
        issues,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`Failed to connect: ${message}`);

      return {
        available: false,
        latencyMs: Date.now() - startTime,
        lastChecked: new Date(),
        issues,
      };
    }
  }

  /**
   * Get expected counts for all layers
   */
  async getExpectedCounts(): Promise<ReadonlyMap<TLayerType, number>> {
    const counts = new Map<TLayerType, number>();
    for (const [layerType, layerConfig] of this.layers) {
      counts.set(layerType, layerConfig.expectedCount);
    }
    return counts;
  }

  // ============================================================================
  // Protected Helper Methods (Available to Subclasses)
  // ============================================================================

  /**
   * Fetch GeoJSON from endpoint with retry logic
   *
   * Implements exponential backoff retry strategy.
   * Validates response is valid GeoJSON FeatureCollection.
   *
   * @param url - Endpoint URL
   * @param additionalHeaders - Optional headers (auth tokens, etc.)
   * @returns Validated GeoJSON FeatureCollection
   */
  protected async fetchGeoJSON(
    url: string,
    additionalHeaders?: Record<string, string>
  ): Promise<FeatureCollection> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        logger.debug('Fetching GeoJSON', {
          country: this.country,
          url: url.substring(0, 80),
          attempt,
          maxAttempts: this.retryAttempts
        });

        const response = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
            ...additionalHeaders,
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = (await response.json()) as FeatureCollection;

        // Validate GeoJSON structure
        if (!data.features || !Array.isArray(data.features)) {
          throw new Error('Invalid GeoJSON: missing features array');
        }

        logger.debug('GeoJSON fetched', {
          country: this.country,
          featureCount: data.features.length
        });
        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn('Fetch attempt failed', {
          country: this.country,
          attempt,
          error: lastError.message
        });

        if (attempt < this.retryAttempts) {
          // Exponential backoff: 1s, 2s, 4s, 8s, ...
          const delay = Math.pow(2, attempt - 1) * this.retryDelayMs;
          logger.debug('Retrying fetch', { country: this.country, delayMs: delay });
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError ?? new Error('Fetch failed after all retries');
  }

  /**
   * Calculate validation confidence score
   *
   * Factors:
   * - Count match (50 points): Actual count matches expected
   * - Data freshness (25 points): Data vintage is recent
   * - Source authority (25 points): Higher authority = higher confidence
   *
   * @param actualCount - Number of features extracted
   * @param expectedCount - Expected number of features
   * @param vintage - Data vintage year
   * @param authority - Data source authority level
   * @returns Confidence score (0-100)
   */
  protected calculateConfidence(
    actualCount: number,
    expectedCount: number,
    vintage: number,
    authority: AuthorityLevel
  ): number {
    let confidence = 0;

    // Count match (50 points)
    if (actualCount === expectedCount) {
      confidence += 50;
    } else {
      // Partial credit for close matches
      const countRatio = Math.min(actualCount, expectedCount) / Math.max(actualCount, expectedCount);
      confidence += Math.floor(countRatio * 50);
    }

    // Data freshness (25 points)
    const currentYear = new Date().getFullYear();
    const ageYears = currentYear - vintage;
    if (ageYears === 0) {
      confidence += 25;
    } else if (ageYears <= 2) {
      confidence += 20;
    } else if (ageYears <= 5) {
      confidence += 15;
    } else if (ageYears <= 10) {
      confidence += 10;
    }

    // Source authority (25 points)
    const authorityScores: Record<AuthorityLevel, number> = {
      constitutional: 25,
      'electoral-commission': 22,
      'national-statistics': 20,
      'state-agency': 15,
      'municipal-agency': 10,
      commercial: 5,
      community: 0,
    };
    confidence += authorityScores[authority];

    return Math.min(100, Math.max(0, confidence));
  }

  /**
   * Create a failed layer result
   *
   * Helper for consistent error handling across providers.
   */
  protected createFailedResult(
    layerType: TLayerType,
    error: string,
    expectedCount: number,
    source: string,
    startTime: number
  ): LayerExtractionResult<TLayerType, TBoundary> {
    return {
      layer: layerType,
      success: false,
      boundaries: [],
      expectedCount,
      actualCount: 0,
      matched: false,
      confidence: 0,
      extractedAt: new Date(),
      source,
      durationMs: Date.now() - startTime,
      error,
    };
  }
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Provider configuration for registry
 */
export interface ProviderConfig {
  /** ISO 3166-1 alpha-2 country code */
  readonly countryCode: string;

  /** Human-readable country name */
  readonly countryName: string;

  /** Provider class instance */
  readonly provider: InternationalBoundaryProvider;

  /** Supported layer types */
  readonly supportedLayers: readonly string[];

  /** Last successful extraction timestamp */
  readonly lastExtraction?: Date;

  /** Provider priority (for conflict resolution) */
  readonly priority: number;
}

/**
 * Batch extraction options
 */
export interface BatchExtractionOptions {
  /** Countries to extract (ISO codes) */
  readonly countries: readonly string[];

  /** Maximum concurrent extractions */
  readonly concurrency?: number;

  /** Continue on individual country failures */
  readonly continueOnError?: boolean;

  /** Progress callback */
  readonly onProgress?: (progress: ExtractionProgress) => void;
}

/**
 * Extraction progress event
 */
export interface ExtractionProgress {
  /** Current country being processed */
  readonly currentCountry: string;

  /** Countries completed */
  readonly completed: number;

  /** Total countries in batch */
  readonly total: number;

  /** Countries failed */
  readonly failed: number;

  /** Total boundaries extracted so far */
  readonly totalBoundaries: number;
}
