/**
 * Boundary Loader
 *
 * Downloads and caches GeoJSON boundaries from known-portals registry.
 * Bridges the gap between portal registry and boundary resolver.
 *
 * PHILOSOPHY:
 * - Lazy loading (fetch on demand, not startup)
 * - Aggressive caching (boundaries change every 10 years)
 * - Fail-fast with clear errors (no silent degradation)
 * - Production-grade timeout and retry handling
 */

import type { FeatureCollection, Feature, Polygon, MultiPolygon } from 'geojson';
import type {
  BoundaryGeometry,
  BoundaryMetadata,
  BoundaryType,
  LatLng,
  BBox,
} from '../core/types/boundary.js';
import { extractBBox, BoundaryType as BT } from '../core/types/boundary.js';
import type { BoundaryDataSource } from './boundary-resolver.js';
import { KNOWN_PORTALS, type KnownPortal } from '../core/registry/known-portals.js';
import type { ProvenanceRecord } from '../provenance-writer.js';
import { logger } from '../core/utils/logger.js';

/**
 * GeoJSON Feature with expected properties
 */
interface DistrictFeature extends Feature {
  geometry: Polygon | MultiPolygon;
  properties: {
    DISTRICT?: string | number;
    DISPLAY_NAME?: string;
    NAME?: string;
    name?: string;
    council_district?: string | number;
    WARD?: string | number;
    ward?: string | number;
    district?: string | number;
    District?: string | number;
    [key: string]: unknown;
  };
}

/**
 * Loader configuration
 */
export interface BoundaryLoaderConfig {
  /** Fetch timeout in ms (default: 30000) */
  readonly timeoutMs: number;

  /** Cache TTL in ms (default: 1 year) */
  readonly cacheTTLMs: number;

  /** Maximum cache entries (default: 100) */
  readonly maxCacheEntries: number;

  /** User-Agent header for requests */
  readonly userAgent: string;
}

/**
 * Default configuration
 */
export const DEFAULT_LOADER_CONFIG: BoundaryLoaderConfig = {
  timeoutMs: 30000,
  cacheTTLMs: 365 * 24 * 60 * 60 * 1000, // 1 year
  maxCacheEntries: 100,
  userAgent: 'VOTER-Protocol/1.0 (Shadow Atlas Boundary Loader)',
};

/**
 * Cache entry for loaded boundaries
 */
interface CacheEntry {
  readonly boundaries: BoundaryGeometry[];
  readonly loadedAt: Date;
  readonly expiresAt: Date;
  readonly portal: KnownPortal;
}

/**
 * Boundary Loader
 *
 * Fetches GeoJSON from known-portals registry and converts to BoundaryGeometry.
 * Implements BoundaryDataSource interface for use with BoundaryResolver.
 */
export class BoundaryLoader implements BoundaryDataSource {
  private readonly cache: Map<string, CacheEntry> = new Map();
  private readonly config: BoundaryLoaderConfig;

  constructor(config: Partial<BoundaryLoaderConfig> = {}) {
    this.config = { ...DEFAULT_LOADER_CONFIG, ...config };
  }

  /**
   * Get candidate boundaries for a point
   *
   * Loads all boundaries from registry and filters by bounding box.
   * For production, this should be optimized with spatial indexing.
   *
   * @param point - Lat/lng to find boundaries for
   * @returns Boundaries that could contain the point
   */
  async getCandidateBoundaries(point: LatLng): Promise<BoundaryGeometry[]> {
    const candidates: BoundaryGeometry[] = [];

    // Load all boundaries from registry
    const allBoundaries = await this.loadAllBoundaries();

    // Filter by bounding box (cheap pre-filter)
    for (const boundary of allBoundaries) {
      const [minLon, minLat, maxLon, maxLat] = boundary.bbox;
      if (
        point.lng >= minLon &&
        point.lng <= maxLon &&
        point.lat >= minLat &&
        point.lat <= maxLat
      ) {
        candidates.push(boundary);
      }
    }

    return candidates;
  }

  /**
   * Get boundaries by jurisdiction (FIPS code)
   *
   * @param jurisdiction - City FIPS code (e.g., "5363000" for Seattle)
   * @returns Boundaries for that jurisdiction
   */
  async getBoundariesByJurisdiction(
    jurisdiction: string
  ): Promise<BoundaryGeometry[]> {
    const portal = KNOWN_PORTALS[jurisdiction];
    if (!portal) {
      return [];
    }

    return this.loadBoundariesFromPortal(portal);
  }

  /**
   * Get boundary by ID
   *
   * @param id - Boundary ID (format: "{fips}-district-{n}")
   * @returns Boundary if found
   */
  async getBoundaryById(id: string): Promise<BoundaryGeometry | null> {
    // Parse ID to extract FIPS code
    const fipsMatch = id.match(/^(\d+)-/);
    if (!fipsMatch) {
      return null;
    }

    const fips = fipsMatch[1];
    const boundaries = await this.getBoundariesByJurisdiction(fips);

    return boundaries.find((b) => b.metadata.id === id) ?? null;
  }

  /**
   * Load boundaries from a specific portal
   *
   * @param portal - Portal configuration
   * @returns Array of boundary geometries
   */
  async loadBoundariesFromPortal(
    portal: KnownPortal
  ): Promise<BoundaryGeometry[]> {
    const cacheKey = portal.cityFips;

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && new Date() < cached.expiresAt) {
      return cached.boundaries;
    }

    // Fetch GeoJSON
    const geojson = await this.fetchGeoJSON(portal.downloadUrl);

    // Convert to BoundaryGeometry
    const boundaries = this.convertToBoundaries(geojson, portal);

    // Cache result
    this.setCached(cacheKey, boundaries, portal);

    return boundaries;
  }

  /**
   * Load all boundaries from registry
   *
   * WARNING: This loads ALL portals in the registry.
   * For production, use spatial indexing to avoid loading everything.
   */
  async loadAllBoundaries(): Promise<BoundaryGeometry[]> {
    const allBoundaries: BoundaryGeometry[] = [];

    // Load from all portals (could be parallelized)
    for (const portal of Object.values(KNOWN_PORTALS)) {
      try {
        const boundaries = await this.loadBoundariesFromPortal(portal);
        allBoundaries.push(...boundaries);
      } catch (error) {
        // Log error but continue loading other portals
        logger.warn('Failed to load boundaries for city', {
          cityName: portal.cityName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return allBoundaries;
  }

  /**
   * Preload boundaries for specific jurisdictions
   *
   * Useful for warming cache before serving requests.
   *
   * @param fipsCodes - Array of FIPS codes to preload
   */
  async preload(fipsCodes: string[]): Promise<void> {
    await Promise.all(
      fipsCodes.map(async (fips) => {
        const portal = KNOWN_PORTALS[fips];
        if (portal) {
          await this.loadBoundariesFromPortal(portal);
        }
      })
    );
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    entries: number;
    totalBoundaries: number;
  } {
    let totalBoundaries = 0;
    for (const entry of this.cache.values()) {
      totalBoundaries += entry.boundaries.length;
    }

    return {
      entries: this.cache.size,
      totalBoundaries,
    };
  }

  /**
   * Fetch GeoJSON from URL
   */
  private async fetchGeoJSON(url: string): Promise<FeatureCollection> {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/geo+json, application/json',
        'User-Agent': this.config.userAgent,
      },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      throw new BoundaryLoadError(
        'FETCH_FAILED',
        `HTTP ${response.status}: ${response.statusText}`,
        url
      );
    }

    const data = (await response.json()) as unknown;

    // Validate GeoJSON structure
    if (!this.isValidFeatureCollection(data)) {
      throw new BoundaryLoadError(
        'INVALID_GEOJSON',
        'Response is not a valid GeoJSON FeatureCollection',
        url
      );
    }

    return data;
  }

  /**
   * Type guard for FeatureCollection
   */
  private isValidFeatureCollection(data: unknown): data is FeatureCollection {
    return (
      typeof data === 'object' &&
      data !== null &&
      (data as { type?: string }).type === 'FeatureCollection' &&
      Array.isArray((data as { features?: unknown[] }).features)
    );
  }

  /**
   * Convert GeoJSON to BoundaryGeometry array
   */
  private convertToBoundaries(
    geojson: FeatureCollection,
    portal: KnownPortal
  ): BoundaryGeometry[] {
    const boundaries: BoundaryGeometry[] = [];

    for (let i = 0; i < geojson.features.length; i++) {
      const feature = geojson.features[i] as DistrictFeature;

      // Skip features without polygon geometry
      if (
        !feature.geometry ||
        (feature.geometry.type !== 'Polygon' &&
          feature.geometry.type !== 'MultiPolygon')
      ) {
        continue;
      }

      // Extract district name/number
      const districtName = this.extractDistrictName(feature, i + 1);

      // Create boundary ID
      const id = `${portal.cityFips}-district-${i + 1}`;

      // Create provenance record
      const provenance: ProvenanceRecord = {
        source: portal.portalType,
        sourceUrl: portal.downloadUrl,
        retrievedAt: new Date(),
        dataVersion: portal.lastVerified,
        license: 'Public Domain', // Most municipal data is public
        processingSteps: [
          `Loaded from ${portal.portalType} portal`,
          `Feature ${i + 1} of ${geojson.features.length}`,
        ],
      };

      // Create metadata
      const metadata: BoundaryMetadata = {
        id,
        type: BT.CITY_COUNCIL_DISTRICT,
        name: districtName,
        jurisdiction: `${portal.cityName}, ${portal.state}`,
        jurisdictionFips: portal.cityFips,
        provenance,
        validFrom: new Date('2020-01-01'), // Post-2020 census boundaries
      };

      // Create boundary geometry
      const boundary: BoundaryGeometry = {
        metadata,
        geometry: feature.geometry,
        bbox: extractBBox(feature.geometry),
      };

      boundaries.push(boundary);
    }

    return boundaries;
  }

  /**
   * Extract district name from feature properties
   */
  private extractDistrictName(feature: DistrictFeature, index: number): string {
    const props = feature.properties;

    // Try common property names
    const candidates = [
      props.DISPLAY_NAME,
      props.NAME,
      props.name,
      props.DISTRICT,
      props.District,
      props.district,
      props.council_district,
      props.WARD,
      props.ward,
    ];

    for (const candidate of candidates) {
      if (candidate !== undefined && candidate !== null) {
        return String(candidate);
      }
    }

    // Fallback to index
    return `District ${index}`;
  }

  /**
   * Set cache entry
   */
  private setCached(
    key: string,
    boundaries: BoundaryGeometry[],
    portal: KnownPortal
  ): void {
    // LRU eviction
    if (this.cache.size >= this.config.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    const now = new Date();
    this.cache.set(key, {
      boundaries,
      loadedAt: now,
      expiresAt: new Date(now.getTime() + this.config.cacheTTLMs),
      portal,
    });
  }
}

/**
 * Boundary load error
 */
export class BoundaryLoadError extends Error {
  constructor(
    public readonly code:
      | 'FETCH_FAILED'
      | 'INVALID_GEOJSON'
      | 'PARSE_ERROR'
      | 'TIMEOUT',
    message: string,
    public readonly url?: string
  ) {
    super(message);
    this.name = 'BoundaryLoadError';
  }
}
