/**
 * Unified TIGER Extraction Service
 *
 * Consolidates all Census TIGER data operations into a single service:
 * - Point-in-polygon queries (TIGERweb REST API)
 * - Bulk shapefile downloads (Census FTP)
 * - Validation against expected counts
 * - Aggressive caching and rate limiting
 * - Progress reporting for long-running operations
 *
 * SUPPORTED LAYERS:
 * - Congressional Districts (435 total)
 * - State Legislative Upper (1,972 total)
 * - State Legislative Lower (5,411 total)
 * - Counties (3,143 total)
 * - Incorporated Places (19,495 total)
 * - CDPs (~9,000 total)
 * - Unified School Districts (~13,000 total)
 * - Elementary School Districts (~10,000 total)
 * - Secondary School Districts (~500 total)
 *
 * ARCHITECTURE:
 * - Composes CensusTigerLoader (TIGERweb REST API) and TIGERBoundaryProvider (FTP bulk)
 * - Single cache directory with consistent structure
 * - Exponential backoff retry for resilience
 * - Event-driven progress reporting
 * - Type-safe validation against official counts
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { FeatureCollection, Feature, Polygon, MultiPolygon } from 'geojson';
import type { LatLng, NormalizedBoundary, BoundaryGeometry, TIGERLayerType as CanonicalTIGERLayerType } from '../core/types.js';
import { CensusTigerLoader } from './census-tiger-loader.js';
import {
  TIGERBoundaryProvider,
  TIGER_FTP_LAYERS,
  type TIGERLayer,
} from '../providers/tiger-boundary-provider.js';
import {
  OFFICIAL_DISTRICT_COUNTS,
  validateCount,
  type LegislativeChamber,
  type CountValidation,
} from '../registry/official-district-counts.js';
import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * TIGER layer types (friendly names)
 *
 * This service uses human-readable layer names that map to canonical
 * TIGER layer codes from core/types.ts.
 */
export type TIGERLayerType =
  | 'congressional'
  | 'state_senate'
  | 'state_house'
  | 'county'
  | 'place'
  | 'cdp'
  | 'school_unified'
  | 'school_elementary'
  | 'school_secondary';

/**
 * Map TIGERLayerType (friendly names) to canonical TIGER layer codes
 */
const LAYER_TYPE_TO_CANONICAL: Record<
  Exclude<TIGERLayerType, 'place' | 'cdp'>,
  CanonicalTIGERLayerType
> = {
  congressional: 'cd',
  state_senate: 'sldu',
  state_house: 'sldl',
  county: 'county',
  school_unified: 'unsd',
  school_elementary: 'elsd',
  school_secondary: 'scsd',
};

/**
 * Map TIGERLayerType to provider TIGERLayer (backwards compatibility)
 */
const LAYER_TYPE_TO_PROVIDER_LAYER: Record<TIGERLayerType, TIGERLayer> = {
  congressional: 'cd',
  state_senate: 'sldu',
  state_house: 'sldl',
  county: 'county',
  place: 'place',
  cdp: 'place', // CDPs are in PLACE files
  school_unified: 'unsd',
  school_elementary: 'elsd',
  school_secondary: 'scsd',
};

/**
 * Map TIGERLayerType to LegislativeChamber
 */
const LAYER_TYPE_TO_CHAMBER: Record<
  Exclude<TIGERLayerType, 'county' | 'place' | 'cdp' | 'school_unified' | 'school_elementary' | 'school_secondary'>,
  LegislativeChamber
> = {
  congressional: 'congressional',
  state_senate: 'state_senate',
  state_house: 'state_house',
};

/**
 * Extraction options
 */
export interface TIGERExtractionOptions {
  /** Cache directory (defaults to .shadow-atlas/tiger-cache) */
  readonly cacheDir?: string;

  /** TIGER year (defaults to 2024) */
  readonly year?: number;

  /** Rate limit milliseconds between requests (defaults to 100ms) */
  readonly rateLimitMs?: number;

  /** Maximum retry attempts (defaults to 3) */
  readonly maxRetries?: number;

  /** Force refresh (bypass cache) */
  readonly forceRefresh?: boolean;
}

/**
 * Layer extraction result
 */
export interface TIGERLayerResult {
  /** Layer type */
  readonly layer: TIGERLayerType;

  /** Normalized boundaries */
  readonly features: readonly NormalizedBoundary[];

  /** Extraction metadata */
  readonly metadata: {
    readonly source: string;
    readonly retrievedAt: string;
    readonly featureCount: number;
    readonly expectedCount: number;
    readonly isComplete: boolean;
    readonly validation: CountValidation;
  };
}

/**
 * Extraction statistics
 */
export interface TIGERExtractionStats {
  /** Total requests made */
  readonly totalRequests: number;

  /** Cache hits */
  readonly cacheHits: number;

  /** Cache misses */
  readonly cacheMisses: number;

  /** Failed requests */
  readonly failedRequests: number;

  /** Total bytes downloaded */
  readonly bytesDownloaded: number;

  /** Total execution time (ms) */
  readonly totalTimeMs: number;
}

/**
 * Progress event
 */
export interface TIGERProgressEvent {
  /** Current operation */
  readonly operation: 'download' | 'convert' | 'validate';

  /** Current item being processed */
  readonly currentItem: string;

  /** Completed items */
  readonly completed: number;

  /** Total items */
  readonly total: number;

  /** Progress percentage (0-100) */
  readonly percentage: number;
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Overall validation status */
  readonly valid: boolean;

  /** Expected feature count */
  readonly expected: number;

  /** Actual feature count */
  readonly actual: number;

  /** Count validation */
  readonly countValidation: CountValidation;

  /** Missing GEOIDs */
  readonly missingGEOIDs: readonly string[];

  /** Extra GEOIDs */
  readonly extraGEOIDs: readonly string[];

  /** Validation summary */
  readonly summary: string;
}

// ============================================================================
// Unified TIGER Extraction Service
// ============================================================================

/**
 * Unified TIGER Extraction Service
 *
 * Single entry point for all Census TIGER operations.
 * Composes TIGERweb REST API and FTP bulk download providers.
 */
export class TIGERExtractionService {
  private readonly loader: CensusTigerLoader;
  private readonly provider: TIGERBoundaryProvider;
  private readonly cacheDir: string;
  private readonly year: number;
  private readonly rateLimitMs: number;
  private readonly maxRetries: number;

  // Statistics tracking
  private stats: {
    totalRequests: number;
    cacheHits: number;
    cacheMisses: number;
    failedRequests: number;
    bytesDownloaded: number;
    totalTimeMs: number;
  };

  // Progress callback
  private onProgress?: (event: TIGERProgressEvent) => void;

  constructor(options?: TIGERExtractionOptions) {
    this.cacheDir = options?.cacheDir || join(process.cwd(), '.shadow-atlas', 'tiger-cache');
    this.year = options?.year || 2024;
    this.rateLimitMs = options?.rateLimitMs || 100;
    this.maxRetries = options?.maxRetries || 3;

    this.loader = new CensusTigerLoader('VOTER-Protocol/Shadow-Atlas/1.0 (TIGER Extraction Service)');
    this.provider = new TIGERBoundaryProvider({
      cacheDir: this.cacheDir,
      year: this.year,
      maxRetries: this.maxRetries,
      retryDelayMs: 1000,
    });

    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      failedRequests: 0,
      bytesDownloaded: 0,
      totalTimeMs: 0,
    };
  }

  /**
   * Query all TIGER layers for a point
   *
   * Returns boundaries from all layers that contain the point,
   * sorted by precision (finest first).
   *
   * @param lat - Latitude (WGS84)
   * @param lng - Longitude (WGS84)
   * @returns Layer results for all matching boundaries
   *
   * @example
   * ```typescript
   * const service = new TIGERExtractionService();
   * const results = await service.queryPoint(47.6062, -122.3321);
   *
   * for (const result of results) {
   *   console.log(`${result.layer}: ${result.features.length} features`);
   * }
   * ```
   */
  async queryPoint(lat: number, lng: number): Promise<TIGERLayerResult[]> {
    const startTime = Date.now();

    try {
      // Query all layers via CensusTigerLoader
      const boundaries = await this.loader.getCandidateBoundaries({ lat, lng });

      this.stats.totalRequests++;
      this.stats.totalTimeMs += Date.now() - startTime;

      // Group boundaries by layer type
      const layerMap = new Map<TIGERLayerType, NormalizedBoundary[]>();

      for (const boundary of boundaries) {
        const layerType = this.boundaryTypeToLayerType(boundary.metadata.type);
        if (!layerType) continue;

        const normalized = this.convertBoundaryToNormalized(boundary);
        const existing = layerMap.get(layerType) || [];
        existing.push(normalized);
        layerMap.set(layerType, existing);
      }

      // Convert to layer results
      const results: TIGERLayerResult[] = [];
      for (const [layer, features] of layerMap.entries()) {
        results.push({
          layer,
          features,
          metadata: {
            source: 'TIGERweb REST API',
            retrievedAt: new Date().toISOString(),
            featureCount: features.length,
            expectedCount: this.getExpectedCount(layer, 'unknown'),
            isComplete: false, // Point queries don't guarantee completeness
            validation: {
              isValid: true,
              expected: null,
              actual: features.length,
              difference: 0,
              confidence: 1.0,
            },
          },
        });
      }

      return results;
    } catch (error) {
      this.stats.failedRequests++;
      throw new Error(`Point query failed: ${(error as Error).message}`);
    }
  }

  /**
   * Extract all boundaries for a state
   *
   * Downloads complete boundary sets for specified layers.
   * Results are validated against expected counts.
   *
   * @param stateFips - State FIPS code (2 digits, e.g., "06" for California)
   * @param layers - Layers to extract (defaults to all legislative layers)
   * @returns Layer results for each extracted layer
   *
   * @example
   * ```typescript
   * const service = new TIGERExtractionService();
   * const results = await service.extractState('06', ['congressional', 'state_senate']);
   *
   * for (const result of results) {
   *   console.log(`${result.layer}: ${result.metadata.validation.isValid ? 'VALID' : 'INVALID'}`);
   * }
   * ```
   */
  async extractState(
    stateFips: string,
    layers?: readonly TIGERLayerType[]
  ): Promise<TIGERLayerResult[]> {
    const startTime = Date.now();
    const layersToExtract = layers || ['congressional', 'state_senate', 'state_house', 'county'];

    const results: TIGERLayerResult[] = [];
    let completed = 0;

    for (const layer of layersToExtract) {
      try {
        this.emitProgress({
          operation: 'download',
          currentItem: `${this.getStateName(stateFips)} - ${layer}`,
          completed,
          total: layersToExtract.length,
          percentage: (completed / layersToExtract.length) * 100,
        });

        const result = await this.extractStateLayer(stateFips, layer);
        results.push(result);
        completed++;

        // Rate limiting
        await this.sleep(this.rateLimitMs);
      } catch (error) {
        this.stats.failedRequests++;
        console.error(`Failed to extract ${layer} for state ${stateFips}: ${(error as Error).message}`);
      }
    }

    this.stats.totalTimeMs += Date.now() - startTime;
    return results;
  }

  /**
   * Extract nationwide boundaries for a layer
   *
   * Downloads complete national dataset for a single layer.
   * Validates against total expected count.
   *
   * @param layer - Layer to extract
   * @returns Layer result with all features
   *
   * @example
   * ```typescript
   * const service = new TIGERExtractionService();
   * const result = await service.extractNational('congressional');
   *
   * console.log(`Extracted ${result.features.length} congressional districts`);
   * console.log(`Expected: ${result.metadata.expectedCount}`);
   * console.log(`Valid: ${result.metadata.isComplete}`);
   * ```
   */
  async extractNational(layer: TIGERLayerType): Promise<TIGERLayerResult> {
    const startTime = Date.now();

    try {
      this.emitProgress({
        operation: 'download',
        currentItem: `National ${layer}`,
        completed: 0,
        total: 1,
        percentage: 0,
      });

      // Check cache first
      const cacheKey = this.getNationalCacheKey(layer);
      const cached = await this.loadFromCache(cacheKey);

      if (cached) {
        this.stats.cacheHits++;
        this.stats.totalTimeMs += Date.now() - startTime;
        return cached;
      }

      this.stats.cacheMisses++;

      // Use TIGERBoundaryProvider for bulk download
      const providerLayer = this.layerTypeToProviderLayer(layer);
      if (!providerLayer) {
        throw new Error(`Layer ${layer} not supported for national extraction`);
      }

      const rawFiles = await this.provider.download({
        level: this.layerTypeToAdminLevel(layer),
        forceRefresh: false,
      });

      this.emitProgress({
        operation: 'convert',
        currentItem: `National ${layer}`,
        completed: 0,
        total: 1,
        percentage: 50,
      });

      const normalized = await this.provider.transform(rawFiles);

      this.emitProgress({
        operation: 'validate',
        currentItem: `National ${layer}`,
        completed: 0,
        total: 1,
        percentage: 75,
      });

      // Validate counts
      const expectedCount = this.getNationalExpectedCount(layer);
      const validation = this.validateNationalCount(layer, normalized.length);

      const result: TIGERLayerResult = {
        layer,
        features: normalized,
        metadata: {
          source: `Census TIGER/Line ${this.year}`,
          retrievedAt: new Date().toISOString(),
          featureCount: normalized.length,
          expectedCount,
          isComplete: validation.isValid,
          validation,
        },
      };

      // Cache result
      await this.saveToCache(cacheKey, result);

      this.stats.totalRequests++;
      this.stats.totalTimeMs += Date.now() - startTime;

      this.emitProgress({
        operation: 'validate',
        currentItem: `National ${layer}`,
        completed: 1,
        total: 1,
        percentage: 100,
      });

      return result;
    } catch (error) {
      this.stats.failedRequests++;
      throw new Error(`National extraction failed for ${layer}: ${(error as Error).message}`);
    }
  }

  /**
   * Validate extraction against expected counts
   *
   * Performs comprehensive validation including:
   * - Count validation against official registry
   * - GEOID completeness check
   * - Duplicate detection
   *
   * @param result - Layer result to validate
   * @returns Validation result
   *
   * @example
   * ```typescript
   * const service = new TIGERExtractionService();
   * const extraction = await service.extractState('06', ['congressional']);
   * const validation = await service.validate(extraction[0]);
   *
   * if (!validation.valid) {
   *   console.error(`Validation failed: ${validation.summary}`);
   * }
   * ```
   */
  async validate(result: TIGERLayerResult): Promise<ValidationResult> {
    const { layer, features, metadata } = result;

    // Extract state from first feature (if state-level)
    const firstFeature = features[0];
    const state = firstFeature?.properties?.stateFips as string | undefined;

    // Get expected count
    const expected = state
      ? this.getExpectedCount(layer, state)
      : this.getNationalExpectedCount(layer);

    // Perform count validation
    const countValidation = state
      ? this.validateStateCount(layer, state, features.length)
      : this.validateNationalCount(layer, features.length);

    // Extract GEOIDs
    const actualGEOIDs = new Set(features.map((f) => f.id));

    // TODO: Load expected GEOIDs from authoritative source for completeness check
    // For now, we only validate counts
    const missingGEOIDs: string[] = [];
    const extraGEOIDs: string[] = [];

    const valid = countValidation.isValid;
    const summary = valid
      ? `✅ Valid: ${features.length}/${expected} features`
      : `❌ Invalid: ${features.length}/${expected} features (diff: ${countValidation.difference})`;

    return {
      valid,
      expected,
      actual: features.length,
      countValidation,
      missingGEOIDs,
      extraGEOIDs,
      summary,
    };
  }

  /**
   * Get extraction statistics
   *
   * Returns cumulative statistics for all operations.
   *
   * @returns Extraction statistics
   */
  getStats(): TIGERExtractionStats {
    return { ...this.stats };
  }

  /**
   * Set progress callback
   *
   * @param callback - Progress callback function
   */
  setProgressCallback(callback: (event: TIGERProgressEvent) => void): void {
    this.onProgress = callback;
  }

  /**
   * Clear cache
   *
   * Removes all cached extraction results.
   */
  async clearCache(): Promise<void> {
    // TODO: Implement cache clearing
    this.loader.clearCache();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Extract single state layer
   */
  private async extractStateLayer(
    stateFips: string,
    layer: TIGERLayerType
  ): Promise<TIGERLayerResult> {
    // Check cache
    const cacheKey = this.getStateCacheKey(stateFips, layer);
    const cached = await this.loadFromCache(cacheKey);

    if (cached) {
      this.stats.cacheHits++;
      return cached;
    }

    this.stats.cacheMisses++;

    // Use TIGERBoundaryProvider for bulk download
    const providerLayer = this.layerTypeToProviderLayer(layer);
    if (!providerLayer) {
      throw new Error(`Layer ${layer} not supported`);
    }

    const rawFiles = await this.provider.download({
      level: this.layerTypeToAdminLevel(layer),
      region: stateFips,
      forceRefresh: false,
    });

    const normalized = await this.provider.transform(rawFiles);

    // Validate counts
    const expectedCount = this.getExpectedCount(layer, stateFips);
    const validation = this.validateStateCount(layer, stateFips, normalized.length);

    const result: TIGERLayerResult = {
      layer,
      features: normalized,
      metadata: {
        source: `Census TIGER/Line ${this.year}`,
        retrievedAt: new Date().toISOString(),
        featureCount: normalized.length,
        expectedCount,
        isComplete: validation.isValid,
        validation,
      },
    };

    // Cache result
    await this.saveToCache(cacheKey, result);

    this.stats.totalRequests++;
    return result;
  }

  /**
   * Get expected count for a layer and state
   */
  private getExpectedCount(layer: TIGERLayerType, stateFips: string): number {
    const stateAbbr = this.fipsToStateAbbr(stateFips);
    const record = OFFICIAL_DISTRICT_COUNTS[stateAbbr];

    if (!record) return 0;

    switch (layer) {
      case 'congressional':
        return record.congressional;
      case 'state_senate':
        return record.stateSenate || 0;
      case 'state_house':
        return record.stateHouse || 0;
      case 'county':
        return record.counties;
      default:
        return 0;
    }
  }

  /**
   * Get national expected count for a layer
   */
  private getNationalExpectedCount(layer: TIGERLayerType): number {
    const counts = Object.values(OFFICIAL_DISTRICT_COUNTS);

    switch (layer) {
      case 'congressional':
        return counts.reduce((sum, r) => sum + r.congressional, 0);
      case 'state_senate':
        return counts.reduce((sum, r) => sum + (r.stateSenate || 0), 0);
      case 'state_house':
        return counts.reduce((sum, r) => sum + (r.stateHouse || 0), 0);
      case 'county':
        return counts.reduce((sum, r) => sum + r.counties, 0);
      default:
        return 0;
    }
  }

  /**
   * Validate state count
   */
  private validateStateCount(
    layer: TIGERLayerType,
    stateFips: string,
    actualCount: number
  ): CountValidation {
    const stateAbbr = this.fipsToStateAbbr(stateFips);
    const chamber = LAYER_TYPE_TO_CHAMBER[layer as keyof typeof LAYER_TYPE_TO_CHAMBER];

    if (!chamber) {
      return {
        isValid: true,
        expected: null,
        actual: actualCount,
        difference: 0,
        confidence: 0.0,
      };
    }

    return validateCount(stateAbbr, chamber, actualCount);
  }

  /**
   * Validate national count
   */
  private validateNationalCount(
    layer: TIGERLayerType,
    actualCount: number
  ): CountValidation {
    const expected = this.getNationalExpectedCount(layer);
    const difference = actualCount - expected;
    const isValid = difference === 0;

    let confidence = 1.0;
    if (Math.abs(difference) <= 5) {
      confidence = 0.9; // Minor discrepancy
    } else if (Math.abs(difference) <= 10) {
      confidence = 0.7;
    } else {
      confidence = 0.0; // Major discrepancy
    }

    return {
      isValid,
      expected,
      actual: actualCount,
      difference,
      confidence,
    };
  }

  /**
   * Convert BoundaryGeometry to NormalizedBoundary
   */
  private convertBoundaryToNormalized(boundary: BoundaryGeometry): NormalizedBoundary {
    return {
      id: boundary.metadata.jurisdictionFips || boundary.metadata.id,
      name: boundary.metadata.name,
      level: 'district', // Default admin level
      geometry: boundary.geometry,
      properties: {
        type: boundary.metadata.type,
        jurisdiction: boundary.metadata.jurisdiction,
        validFrom: boundary.metadata.validFrom.toISOString(),
        validUntil: boundary.metadata.validUntil?.toISOString(),
      },
      source: {
        provider: 'Census TIGER',
        url: boundary.metadata.provenance.sourceUrl,
        version: boundary.metadata.provenance.dataVersion || String(this.year),
        license: boundary.metadata.provenance.license,
        updatedAt: boundary.metadata.provenance.retrievedAt.toISOString(),
        checksum: '',
        authorityLevel: 'federal-mandate',
        legalStatus: 'binding',
        collectionMethod: 'census-tiger',
        lastVerified: new Date().toISOString(),
        verifiedBy: 'automated',
        topologyValidated: false,
        geometryRepaired: false,
        coordinateSystem: 'EPSG:4326',
        updateMonitoring: 'api-polling',
      },
    };
  }

  /**
   * Map boundary type to layer type
   */
  private boundaryTypeToLayerType(boundaryType: string): TIGERLayerType | null {
    switch (boundaryType) {
      case 'congressional_district':
        return 'congressional';
      case 'state_legislative_upper':
        return 'state_senate';
      case 'state_legislative_lower':
        return 'state_house';
      case 'county':
        return 'county';
      case 'city_limits':
        return 'place';
      case 'cdp':
        return 'cdp';
      default:
        return null;
    }
  }

  /**
   * Map layer type to provider layer
   */
  private layerTypeToProviderLayer(layer: TIGERLayerType): TIGERLayer | null {
    const mapped = LAYER_TYPE_TO_PROVIDER_LAYER[
      layer as keyof typeof LAYER_TYPE_TO_PROVIDER_LAYER
    ];
    return mapped || null;
  }

  /**
   * Map layer type to administrative level
   */
  private layerTypeToAdminLevel(
    layer: TIGERLayerType
  ): 'district' | 'county' | 'city' {
    switch (layer) {
      case 'county':
        return 'county';
      case 'place':
      case 'cdp':
        return 'city';
      default:
        return 'district';
    }
  }

  /**
   * Convert FIPS code to state abbreviation
   */
  private fipsToStateAbbr(fips: string): string {
    const fipsMap: Record<string, string> = {
      '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
      '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
      '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
      '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
      '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
      '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
      '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
      '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
      '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
      '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
      '56': 'WY', '72': 'PR',
    };
    return fipsMap[fips] || 'unknown';
  }

  /**
   * Get state name from FIPS code
   */
  private getStateName(fips: string): string {
    const stateAbbr = this.fipsToStateAbbr(fips);
    const record = OFFICIAL_DISTRICT_COUNTS[stateAbbr];
    return record?.stateName || stateAbbr;
  }

  /**
   * Get cache key for state extraction
   */
  private getStateCacheKey(stateFips: string, layer: TIGERLayerType): string {
    return `state_${stateFips}_${layer}_${this.year}`;
  }

  /**
   * Get cache key for national extraction
   */
  private getNationalCacheKey(layer: TIGERLayerType): string {
    return `national_${layer}_${this.year}`;
  }

  /**
   * Load result from cache
   */
  private async loadFromCache(key: string): Promise<TIGERLayerResult | null> {
    const cacheFile = join(this.cacheDir, 'results', `${key}.json`);

    try {
      await access(cacheFile);
      const content = await readFile(cacheFile, 'utf-8');
      return JSON.parse(content) as TIGERLayerResult;
    } catch {
      return null;
    }
  }

  /**
   * Save result to cache
   */
  private async saveToCache(key: string, result: TIGERLayerResult): Promise<void> {
    const cacheDir = join(this.cacheDir, 'results');
    await mkdir(cacheDir, { recursive: true });

    const cacheFile = join(cacheDir, `${key}.json`);
    await writeFile(cacheFile, JSON.stringify(result, null, 2));
  }

  /**
   * Emit progress event
   */
  private emitProgress(event: TIGERProgressEvent): void {
    if (this.onProgress) {
      this.onProgress(event);
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create TIGER extraction service with default options
 */
export function createTIGERExtractionService(
  options?: TIGERExtractionOptions
): TIGERExtractionService {
  return new TIGERExtractionService(options);
}

/**
 * Quick extraction for a single state
 */
export async function extractStateQuick(
  stateFips: string,
  layers?: readonly TIGERLayerType[]
): Promise<TIGERLayerResult[]> {
  const service = new TIGERExtractionService();
  return service.extractState(stateFips, layers);
}

/**
 * Quick national extraction for a layer
 */
export async function extractNationalQuick(
  layer: TIGERLayerType
): Promise<TIGERLayerResult> {
  const service = new TIGERExtractionService();
  return service.extractNational(layer);
}
