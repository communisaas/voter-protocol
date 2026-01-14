/**
 * Boundary Resolver
 *
 * Hierarchical address resolution to political boundaries.
 * Core service that orchestrates geocoding, PIP testing, and caching.
 *
 * PHILOSOPHY:
 * - Precision-first resolution (finest available boundary wins)
 * - Aggressive caching (1-year TTL, boundaries stable for ~10 years)
 * - Fallback gracefully (city → county → state → country)
 * - Zero tolerance for stale data (temporal validity enforced)
 */

import type { Polygon, MultiPolygon } from 'geojson';
import { PointInPolygonEngine, type PIPTestResult } from './pip-engine.js';
import type {
  LatLng,
  BBox,
  BoundaryType,
  BoundaryMetadata,
  BoundaryGeometry,
  BoundaryResolution,
  ProvenanceRecord,
} from '../core/types/boundary.js';
import {
  isBoundaryValid,
  isPointInBBox,
  getPrecisionRank,
  comparePrecision,
  PRECISION_RANK,
} from '../core/types/boundary.js';

/**
 * Geocoding result from any geocoder
 */
export interface GeocodeResult {
  readonly coordinates: LatLng;
  readonly confidence: number; // 0-100
  readonly source: string;
  readonly matchType: 'exact' | 'interpolated' | 'centroid';
}

/**
 * Address input for resolution
 */
export interface AddressInput {
  readonly street: string;
  readonly city: string;
  readonly state: string;
  readonly zip?: string;
  readonly country?: string;
}

/**
 * Full resolution result
 */
export interface ResolutionResult {
  readonly address: AddressInput;
  readonly geocode: GeocodeResult;
  readonly boundaries: BoundaryResolution[];
  readonly finest: BoundaryResolution | null;
  readonly cached: boolean;
  readonly resolvedAt: Date;
  readonly ttlSeconds: number;
}

/**
 * Cache entry for resolved boundaries
 */
interface CacheEntry {
  readonly result: ResolutionResult;
  readonly expiresAt: Date;
  readonly cacheKey: string;
}

/**
 * Geocoder interface (Census, Google, Mapbox, etc.)
 */
export interface Geocoder {
  geocode(address: AddressInput): Promise<GeocodeResult | null>;
}

/**
 * Boundary data source interface
 */
export interface BoundaryDataSource {
  /**
   * Get all boundaries that could contain a point
   * (pre-filtered by bounding box for performance)
   */
  getCandidateBoundaries(point: LatLng): Promise<BoundaryGeometry[]>;

  /**
   * Get boundaries by jurisdiction (e.g., "Seattle, WA")
   */
  getBoundariesByJurisdiction(jurisdiction: string): Promise<BoundaryGeometry[]>;

  /**
   * Get specific boundary by ID
   */
  getBoundaryById(id: string): Promise<BoundaryGeometry | null>;
}

/**
 * Resolver configuration
 */
export interface ResolverConfig {
  /**
   * Cache TTL in seconds (default: 1 year = 31536000)
   * Boundaries change every ~10 years after census
   */
  readonly cacheTTLSeconds: number;

  /**
   * Maximum cache entries (LRU eviction)
   */
  readonly maxCacheEntries: number;

  /**
   * Minimum geocode confidence to proceed (0-100)
   */
  readonly minGeocodeConfidence: number;

  /**
   * Whether to resolve all matching boundaries or just finest
   */
  readonly resolveAllBoundaries: boolean;

  /**
   * Boundary types to resolve (empty = all)
   */
  readonly boundaryTypes: BoundaryType[];
}

/**
 * Default resolver configuration
 */
export const DEFAULT_RESOLVER_CONFIG: ResolverConfig = {
  cacheTTLSeconds: 31536000, // 1 year
  maxCacheEntries: 100000,
  minGeocodeConfidence: 80,
  resolveAllBoundaries: true,
  boundaryTypes: [], // All types
};

/**
 * Boundary Resolver
 *
 * Main entry point for address → boundary resolution.
 * Orchestrates geocoding, PIP testing, caching, and hierarchical resolution.
 */
export class BoundaryResolver {
  private readonly pipEngine: PointInPolygonEngine;
  private readonly cache: Map<string, CacheEntry>;
  private readonly config: ResolverConfig;

  constructor(
    private readonly geocoder: Geocoder,
    private readonly dataSource: BoundaryDataSource,
    config: Partial<ResolverConfig> = {}
  ) {
    this.pipEngine = new PointInPolygonEngine();
    this.cache = new Map();
    this.config = { ...DEFAULT_RESOLVER_CONFIG, ...config };
  }

  /**
   * Resolve address to political boundaries
   *
   * Steps:
   * 1. Check cache for existing resolution
   * 2. Geocode address to coordinates
   * 3. Get candidate boundaries (bbox pre-filtered)
   * 4. Run PIP tests to find containing boundaries
   * 5. Sort by precision (finest first)
   * 6. Cache result
   *
   * @param address - Address to resolve
   * @returns Resolution result with all matching boundaries
   */
  async resolve(address: AddressInput): Promise<ResolutionResult> {
    const cacheKey = this.computeCacheKey(address);

    // Check cache
    const cached = this.getCached(cacheKey);
    if (cached) {
      return { ...cached.result, cached: true };
    }

    // Geocode address
    const geocodeResult = await this.geocoder.geocode(address);

    if (!geocodeResult) {
      throw new ResolutionError(
        'GEOCODE_FAILED',
        `Failed to geocode address: ${this.formatAddress(address)}`
      );
    }

    if (geocodeResult.confidence < this.config.minGeocodeConfidence) {
      throw new ResolutionError(
        'LOW_CONFIDENCE',
        `Geocode confidence ${geocodeResult.confidence} below minimum ${this.config.minGeocodeConfidence}`
      );
    }

    // Resolve coordinates to boundaries
    const boundaries = await this.resolveCoordinates(geocodeResult.coordinates);

    const result: ResolutionResult = {
      address,
      geocode: geocodeResult,
      boundaries,
      finest: boundaries.length > 0 ? boundaries[0] : null,
      cached: false,
      resolvedAt: new Date(),
      ttlSeconds: this.config.cacheTTLSeconds,
    };

    // Cache result
    this.setCached(cacheKey, result);

    return result;
  }

  /**
   * Resolve coordinates directly (skip geocoding)
   *
   * Useful when you already have lat/lng from external source.
   *
   * @param coordinates - Lat/lng to resolve
   * @returns Array of matching boundaries (sorted by precision)
   */
  async resolveCoordinates(coordinates: LatLng): Promise<BoundaryResolution[]> {
    const now = new Date();

    // Get candidate boundaries (bbox pre-filtered by data source)
    const candidates = await this.dataSource.getCandidateBoundaries(coordinates);

    // Filter by boundary type if configured
    const filteredCandidates =
      this.config.boundaryTypes.length > 0
        ? candidates.filter((b) =>
            this.config.boundaryTypes.includes(b.metadata.type)
          )
        : candidates;

    // Filter by temporal validity
    const validCandidates = filteredCandidates.filter((b) =>
      isBoundaryValid(b.metadata, now)
    );

    // Run PIP tests
    const pipResults = this.pipEngine.findContainingBoundaries(
      coordinates,
      validCandidates
    );

    // Convert to BoundaryResolution
    const resolutions: BoundaryResolution[] = pipResults.map((pipResult) => {
      const boundary = validCandidates.find(
        (b) => b.metadata.id === pipResult.boundaryId
      )!;

      return {
        boundary: boundary.metadata,
        precision: boundary.metadata.type,
        confidence: this.computeResolutionConfidence(boundary, coordinates),
        coordinates,
        cached: false,
        resolvedAt: now,
      };
    });

    // Return all or just finest based on config
    if (this.config.resolveAllBoundaries) {
      return resolutions;
    } else {
      return resolutions.length > 0 ? [resolutions[0]] : [];
    }
  }

  /**
   * Get finest boundary for coordinates
   *
   * Convenience method that returns only the most precise match.
   *
   * @param coordinates - Lat/lng to resolve
   * @returns Finest matching boundary, or null if no match
   */
  async getFinestBoundary(coordinates: LatLng): Promise<BoundaryResolution | null> {
    const resolutions = await this.resolveCoordinates(coordinates);
    return resolutions.length > 0 ? resolutions[0] : null;
  }

  /**
   * Get boundary at specific precision level
   *
   * @param coordinates - Lat/lng to resolve
   * @param type - Boundary type to find
   * @returns Matching boundary at specified precision, or null
   */
  async getBoundaryAtPrecision(
    coordinates: LatLng,
    type: BoundaryType
  ): Promise<BoundaryResolution | null> {
    const resolutions = await this.resolveCoordinates(coordinates);
    return resolutions.find((r) => r.precision === type) ?? null;
  }

  /**
   * Clear entire cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    entries: number;
    maxEntries: number;
    hitRate: number;
  } {
    return {
      entries: this.cache.size,
      maxEntries: this.config.maxCacheEntries,
      hitRate: 0, // Would need to track hits/misses for accurate rate
    };
  }

  /**
   * Compute cache key from address
   *
   * Normalizes address for consistent cache hits.
   */
  private computeCacheKey(address: AddressInput): string {
    const normalized = [
      address.street.toLowerCase().trim(),
      address.city.toLowerCase().trim(),
      address.state.toLowerCase().trim(),
      (address.zip ?? '').trim(),
      (address.country ?? 'us').toLowerCase().trim(),
    ].join('|');

    return normalized;
  }

  /**
   * Get cached result if valid
   */
  private getCached(cacheKey: string): CacheEntry | null {
    const entry = this.cache.get(cacheKey);

    if (!entry) {
      return null;
    }

    // Check expiration
    if (new Date() > entry.expiresAt) {
      this.cache.delete(cacheKey);
      return null;
    }

    return entry;
  }

  /**
   * Cache resolution result
   */
  private setCached(cacheKey: string, result: ResolutionResult): void {
    // LRU eviction if at capacity
    if (this.cache.size >= this.config.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    const expiresAt = new Date(
      Date.now() + this.config.cacheTTLSeconds * 1000
    );

    this.cache.set(cacheKey, {
      result,
      expiresAt,
      cacheKey,
    });
  }

  /**
   * Compute confidence score for resolution
   *
   * Factors:
   * - Geocode confidence
   * - Distance from boundary edge
   * - Boundary data freshness
   */
  private computeResolutionConfidence(
    boundary: BoundaryGeometry,
    coordinates: LatLng
  ): number {
    // Base confidence from being inside boundary
    let confidence = 100;

    // Reduce confidence near boundary edges (would need distance calculation)
    // For now, just return high confidence for valid containment

    return confidence;
  }

  /**
   * Format address for error messages
   */
  private formatAddress(address: AddressInput): string {
    return [
      address.street,
      address.city,
      address.state,
      address.zip,
      address.country,
    ]
      .filter(Boolean)
      .join(', ');
  }
}

/**
 * Resolution error with typed error codes
 */
export class ResolutionError extends Error {
  constructor(
    public readonly code:
      | 'GEOCODE_FAILED'
      | 'LOW_CONFIDENCE'
      | 'NO_BOUNDARIES'
      | 'DATA_SOURCE_ERROR',
    message: string
  ) {
    super(message);
    this.name = 'ResolutionError';
  }
}

/**
 * In-memory boundary data source (for testing and small datasets)
 *
 * Production would use SQLite/PostgreSQL with spatial indexes.
 */
export class InMemoryBoundaryDataSource implements BoundaryDataSource {
  private readonly boundaries: Map<string, BoundaryGeometry> = new Map();
  private readonly spatialIndex: BoundaryGeometry[] = [];

  /**
   * Add boundary to data source
   */
  addBoundary(boundary: BoundaryGeometry): void {
    this.boundaries.set(boundary.metadata.id, boundary);
    this.spatialIndex.push(boundary);
  }

  /**
   * Add multiple boundaries
   */
  addBoundaries(boundaries: BoundaryGeometry[]): void {
    for (const boundary of boundaries) {
      this.addBoundary(boundary);
    }
  }

  async getCandidateBoundaries(point: LatLng): Promise<BoundaryGeometry[]> {
    // Filter by bounding box (simple spatial index)
    return this.spatialIndex.filter((b) => isPointInBBox(point, b.bbox));
  }

  async getBoundariesByJurisdiction(
    jurisdiction: string
  ): Promise<BoundaryGeometry[]> {
    const normalized = jurisdiction.toLowerCase();
    return this.spatialIndex.filter((b) =>
      b.metadata.jurisdiction.toLowerCase().includes(normalized)
    );
  }

  async getBoundaryById(id: string): Promise<BoundaryGeometry | null> {
    return this.boundaries.get(id) ?? null;
  }

  /**
   * Get total boundary count
   */
  get size(): number {
    return this.boundaries.size;
  }

  /**
   * Clear all boundaries
   */
  clear(): void {
    this.boundaries.clear();
    this.spatialIndex.length = 0;
  }
}

/**
 * Mock geocoder for testing
 */
export class MockGeocoder implements Geocoder {
  private readonly results: Map<string, GeocodeResult> = new Map();

  /**
   * Add mock geocode result
   */
  addResult(address: AddressInput, result: GeocodeResult): void {
    const key = this.computeKey(address);
    this.results.set(key, result);
  }

  async geocode(address: AddressInput): Promise<GeocodeResult | null> {
    const key = this.computeKey(address);
    return this.results.get(key) ?? null;
  }

  private computeKey(address: AddressInput): string {
    return [
      address.street.toLowerCase(),
      address.city.toLowerCase(),
      address.state.toLowerCase(),
    ].join('|');
  }
}
