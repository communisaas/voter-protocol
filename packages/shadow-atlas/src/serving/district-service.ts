/**
 * District Lookup Service
 *
 * High-performance point-in-polygon lookup with R-tree spatial index.
 * Target: <50ms latency (p95) with 10,000 query cache.
 *
 * Architecture:
 * 1. R-tree bounding box query (O(log n) - fast filter)
 * 2. Precise point-in-polygon test (O(k) where k = candidate count)
 * 3. LRU cache for hot queries (in-memory, 10,000 entries)
 *
 * PERFORMANCE CRITICAL: This is the user-facing API. Zero tolerance for bugs.
 */

import Database from 'better-sqlite3';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { point, polygon as turfPolygon, multiPolygon as turfMultiPolygon } from '@turf/helpers';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import type { DistrictBoundary, GeoJSONPolygon, ServingProvenanceMetadata } from './types.js';
import type { ProvenanceMetadata } from '../core/types.js';
import { logger } from '../core/utils/logger.js';

/**
 * Layer priority for sorting multi-hit results.
 * Lower number = finer grain = first in array.
 */
const LAYER_PRIORITY: Record<string, number> = {
  ward: 1,
  elsd: 5,
  scsd: 6,
  unsd: 7,
  place: 10,
  cousub: 11,
  submcd: 12,
  concity: 13,
  county: 20,
  sldl: 25,
  sldu: 26,
  cd: 30,
  vtd: 15,
  aiannh: 18,
  anrc: 19,
  // Special districts sort after congressional — they overlap irregularly with
  // existing layers and are supplemental (civic engagement, not primary representation).
  fire: 32,
  library: 33,
  park: 33,
  hospital: 34,
  water: 34,
  utility: 34,
  transit: 34,
  'can': 35, // can-fed prefix extracts as "can"
  'uk': 36,  // uk-parl prefix extracts as "uk"
  'au': 37,  // au-fed prefix extracts as "au"
  'nz': 38,  // nz-gen / nz-maori prefix extracts as "nz"
};

/**
 * Cache entry with TTL (multi-hit: stores ALL matching districts)
 */
interface CacheEntry {
  readonly districts: DistrictBoundary[];
  readonly timestamp: number;
}

/**
 * LRU cache for hot queries
 */
class LRUCache<K, V> {
  private cache: Map<K, V>;
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // Remove if exists (to update position)
    this.cache.delete(key);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

/**
 * District lookup service with R-tree spatial index
 */
export class DistrictLookupService {
  private readonly db: Database.Database;
  private readonly cache: LRUCache<string, CacheEntry>;
  private readonly cacheTTL: number;

  // Metrics
  private queryCount = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private latencies: number[] = [];

  constructor(dbPath: string, cacheSize = 10000, cacheTTLSeconds = 3600) {
    this.db = new Database(dbPath, { readonly: true });
    this.cache = new LRUCache(cacheSize);
    this.cacheTTL = cacheTTLSeconds * 1000;
  }

  /**
   * Lookup district for coordinates (backward-compatible: returns primary match)
   *
   * @param lat - Latitude (WGS84, -90 to 90)
   * @param lon - Longitude (WGS84, -180 to 180)
   * @returns Primary district boundary or null if not found
   * @throws Error if coordinates invalid
   */
  lookup(lat: number, lon: number): { district: DistrictBoundary | null; latencyMs: number; cacheHit: boolean } {
    const result = this.lookupAll(lat, lon);
    return {
      district: result.districts[0] ?? null,
      latencyMs: result.latencyMs,
      cacheHit: result.cacheHit,
    };
  }

  /**
   * Multi-hit lookup: returns ALL districts containing the given point.
   *
   * A single point can belong to a congressional district, state senate,
   * state house, county, city, school district, and ward simultaneously.
   * This method returns all of them, ordered by layer specificity
   * (finest-grain first: ward → school → city → county → state → federal).
   *
   * @param lat - Latitude (WGS84, -90 to 90)
   * @param lon - Longitude (WGS84, -180 to 180)
   * @returns All matching district boundaries
   * @throws Error if coordinates invalid
   */
  lookupAll(lat: number, lon: number): { districts: DistrictBoundary[]; latencyMs: number; cacheHit: boolean } {
    const startTime = performance.now();

    // Validate coordinates
    if (!this.validateCoordinates(lat, lon)) {
      throw new Error(`Invalid coordinates: lat=${lat}, lon=${lon}`);
    }

    // Check cache
    const cacheKey = `${lat.toFixed(6)},${lon.toFixed(6)}`;
    const cached = this.cache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp < this.cacheTTL)) {
      this.queryCount++;
      this.cacheHits++;
      const latencyMs = performance.now() - startTime;
      this.recordLatency(latencyMs);
      return { districts: cached.districts, latencyMs, cacheHit: true };
    }

    // Cache miss - perform database lookup (collects ALL PIP matches)
    this.cacheMisses++;
    const districts = this.performLookup(lat, lon);

    // Update cache if found
    if (districts.length > 0) {
      this.cache.set(cacheKey, { districts, timestamp: Date.now() });
    }

    this.queryCount++;
    const latencyMs = performance.now() - startTime;
    this.recordLatency(latencyMs);

    return { districts, latencyMs, cacheHit: false };
  }

  /**
   * Perform database lookup with R-tree spatial index
   *
   * NOTE: This uses synchronous better-sqlite3 which blocks the event loop.
   * For high-concurrency API serving, consider:
   * 1. Worker thread pool for SQLite queries
   * 2. better-sqlite3-worker-threads wrapper
   * 3. Read-only connection pool with setImmediate yielding
   *
   * Current approach is acceptable for:
   * - Low-to-moderate concurrency (<100 concurrent requests)
   * - Readonly queries with in-memory cache (this.cache) absorbing most load
   * - Sub-millisecond query times (R-tree index is very fast)
   */
  private performLookup(lat: number, lon: number): DistrictBoundary[] {
    // Step 1: R-tree bounding box query (fast filter)
    // PERF: Synchronous SQLite call - blocks event loop but typically <1ms
    const candidates = this.db
      .prepare(
        `
      SELECT d.*
      FROM districts d
      JOIN rtree_index r ON d.rowid = r.id
      WHERE r.min_lon <= ? AND r.max_lon >= ?
        AND r.min_lat <= ? AND r.max_lat >= ?
    `
      )
      .all(lon, lon, lat, lat) as unknown[];

    if (candidates.length === 0) {
      return [];
    }

    // Step 2: Precise point-in-polygon test — collect ALL matches
    const pt = point([lon, lat]);
    const matches: DistrictBoundary[] = [];

    for (const candidate of candidates) {
      const row = candidate as {
        id: string;
        name: string;
        jurisdiction: string;
        district_type: string;
        geometry: string;
        provenance: string;
      };

      try {
        const geometry = JSON.parse(row.geometry) as GeoJSONPolygon;
        const polygon = this.turfPolygon(geometry);

        if (booleanPointInPolygon(pt, polygon)) {
          const fullProvenance = JSON.parse(row.provenance) as ProvenanceMetadata;
          const servingProvenance: ServingProvenanceMetadata = {
            source: fullProvenance.source,
            authority: fullProvenance.authority,
            timestamp: fullProvenance.timestamp,
            method: fullProvenance.method,
            responseHash: fullProvenance.responseHash,
            legalBasis: fullProvenance.legalBasis,
          };
          matches.push({
            id: row.id,
            name: row.name,
            jurisdiction: row.jurisdiction,
            districtType: this.normalizeDistrictType(row.district_type),
            geometry: geometry,
            provenance: servingProvenance,
          });
        }
      } catch (error) {
        logger.error('Failed to parse geometry for district', {
          districtId: row.id,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        continue;
      }
    }

    // Sort by layer specificity: finest-grain first
    // ward > school > place > county > state-lower > state-upper > congressional > canadian
    return matches.sort((a, b) => {
      return (LAYER_PRIORITY[this.layerPrefix(a.id)] ?? 50) -
             (LAYER_PRIORITY[this.layerPrefix(b.id)] ?? 50);
    });
  }

  /**
   * Extract layer prefix from district ID (e.g., "cd-0611" → "cd")
   */
  private layerPrefix(id: string): string {
    const dash = id.indexOf('-');
    return dash > 0 ? id.slice(0, dash) : id;
  }

  /**
   * Convert GeoJSON geometry to Turf polygon
   */
  private turfPolygon(geometry: GeoJSONPolygon): Feature<Polygon | MultiPolygon> {
    if (geometry.type === 'Polygon') {
      return turfPolygon(geometry.coordinates as number[][][]);
    } else if (geometry.type === 'MultiPolygon') {
      return turfMultiPolygon(geometry.coordinates as number[][][][]);
    } else {
      throw new Error(`Unsupported geometry type: ${(geometry as { type: string }).type}`);
    }
  }

  /**
   * Normalize district type string
   */
  private normalizeDistrictType(type: string): 'council' | 'ward' | 'municipal' {
    const normalized = type.toLowerCase();
    if (normalized.includes('council')) return 'council';
    if (normalized.includes('ward')) return 'ward';
    return 'municipal';
  }

  /**
   * Validate WGS84 coordinates
   */
  private validateCoordinates(lat: number, lon: number): boolean {
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return false;
    }
    if (isNaN(lat) || isNaN(lon)) {
      return false;
    }
    if (lat < -90 || lat > 90) {
      return false;
    }
    if (lon < -180 || lon > 180) {
      return false;
    }
    return true;
  }

  /**
   * Record latency for metrics
   */
  private recordLatency(latencyMs: number): void {
    this.latencies.push(latencyMs);

    // Keep last 1000 latencies for metrics
    if (this.latencies.length > 1000) {
      this.latencies.shift();
    }
  }

  /**
   * Get query metrics
   */
  getMetrics(): {
    totalQueries: number;
    cacheHits: number;
    cacheMisses: number;
    cacheHitRate: number;
    cacheSize: number;
    latencyP50: number;
    latencyP95: number;
    latencyP99: number;
  } {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const p50 = this.percentile(sorted, 0.5);
    const p95 = this.percentile(sorted, 0.95);
    const p99 = this.percentile(sorted, 0.99);

    return {
      totalQueries: this.queryCount,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRate: this.queryCount > 0 ? this.cacheHits / this.queryCount : 0,
      cacheSize: this.cache.size,
      latencyP50: p50,
      latencyP95: p95,
      latencyP99: p99,
    };
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Clear cache (for testing)
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}
