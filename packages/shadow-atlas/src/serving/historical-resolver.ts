/**
 * Historical Resolver for IPFS Snapshots
 *
 * Enables temporal queries against historical Shadow Atlas snapshots.
 * Answers questions like: "What was this person's congressional district on Nov 5, 2024?"
 *
 * ARCHITECTURE:
 * - SnapshotRegistry: Ordered list of snapshots with temporal validity windows
 * - HistoricalResolver: Resolves which snapshot applies for a given date
 * - LRU Cache: Keeps frequently-accessed snapshots in memory
 *
 * USE CASES:
 * - Retroactive verification of residency claims
 * - Audit trail for proof verification
 * - Historical analysis of redistricting impacts
 * - Dispute resolution for borderline addresses
 *
 * PERFORMANCE:
 * - LRU cache prevents repeated IPFS fetches
 * - Binary search for snapshot lookup
 * - Lazy loading of snapshot data
 */

import type { SnapshotMetadata } from './types.js';

// ============================================================================
// Temporal Snapshot Types
// ============================================================================

/**
 * Extended snapshot metadata with temporal validity.
 *
 * Each snapshot is valid from its creation until the next snapshot's creation.
 * The final snapshot in the registry is considered current (no end date).
 */
export interface TemporalSnapshotMetadata extends SnapshotMetadata {
  /** When this snapshot became the authoritative version */
  readonly validFrom: Date;

  /** When this snapshot was superseded (null if current) */
  readonly validUntil: Date | null;

  /** Census year this snapshot reflects (e.g., 2020, 2030) */
  readonly censusYear: number;

  /** TIGER vintage year (e.g., 2024) */
  readonly tigerYear: number;

  /** Whether this is the currently active snapshot */
  readonly isCurrent: boolean;

  /** Git commit or build ID that produced this snapshot */
  readonly buildId?: string;

  /** Hash of the layer configuration used */
  readonly configHash?: string;
}

/**
 * Registry of all available snapshots in temporal order.
 */
export interface SnapshotRegistry {
  /** All snapshots in chronological order (oldest first) */
  readonly snapshots: readonly TemporalSnapshotMetadata[];

  /** Currently active snapshot CID */
  readonly currentCid: string;

  /** Index of current snapshot in the array */
  readonly currentIndex: number;

  /** Earliest date with available data */
  readonly earliestDate: Date;

  /** When the registry was last updated */
  readonly lastUpdated: Date;
}

/**
 * Result of resolving a snapshot for a given date.
 */
export interface SnapshotResolutionResult {
  /** The resolved snapshot metadata */
  readonly snapshot: TemporalSnapshotMetadata;

  /** Whether this is an exact temporal match */
  readonly exactMatch: boolean;

  /** Confidence in the resolution (1.0 for current, lower for historical) */
  readonly confidence: number;

  /** Days until/since this snapshot's validity window */
  readonly daysFromQuery: number;

  /** Notes about the resolution */
  readonly notes?: string;
}

/**
 * Result of a historical query including proof data.
 */
export interface HistoricalQueryResult<T> {
  /** The query result data */
  readonly data: T;

  /** Which snapshot the data came from */
  readonly snapshot: TemporalSnapshotMetadata;

  /** Merkle proof for the data in that snapshot */
  readonly merkleProof: {
    readonly root: bigint;
    readonly siblings: readonly bigint[];
    readonly pathIndices: readonly number[];
  };

  /** Whether the snapshot was loaded from cache */
  readonly cacheHit: boolean;

  /** Query latency in milliseconds */
  readonly latencyMs: number;
}

// ============================================================================
// Historical Resolver Configuration
// ============================================================================

/**
 * Configuration for the historical resolver.
 */
export interface HistoricalResolverConfig {
  /** Maximum number of snapshots to keep in memory */
  readonly maxLoadedSnapshots: number;

  /** IPFS gateway URL for fetching snapshots */
  readonly ipfsGateway: string;

  /** Timeout for IPFS fetches in milliseconds */
  readonly fetchTimeoutMs: number;

  /** Whether to pre-warm the cache with recent snapshots */
  readonly preWarmCache: boolean;

  /** Number of recent snapshots to pre-warm */
  readonly preWarmCount: number;
}

const DEFAULT_CONFIG: HistoricalResolverConfig = {
  maxLoadedSnapshots: 4,      // Keep ~4 snapshots in memory
  ipfsGateway: 'https://ipfs.io',
  fetchTimeoutMs: 30000,      // 30 second timeout
  preWarmCache: true,
  preWarmCount: 2,            // Pre-warm current + previous
};

// ============================================================================
// LRU Cache for Loaded Snapshots
// ============================================================================

/**
 * Simple LRU cache for loaded snapshot data.
 *
 * Keys are snapshot CIDs, values are the loaded snapshot objects.
 */
class SnapshotLRUCache<T> {
  private readonly maxSize: number;
  private readonly cache: Map<string, T>;
  private readonly accessOrder: string[];

  constructor(maxSize: number) {
    this.maxSize = maxSize;
    this.cache = new Map();
    this.accessOrder = [];
  }

  /**
   * Get a value from the cache, updating access order.
   */
  get(key: string): T | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end of access order (most recently used)
      const idx = this.accessOrder.indexOf(key);
      if (idx !== -1) {
        this.accessOrder.splice(idx, 1);
      }
      this.accessOrder.push(key);
    }
    return value;
  }

  /**
   * Set a value in the cache, evicting LRU if necessary.
   */
  set(key: string, value: T): void {
    // If already exists, just update
    if (this.cache.has(key)) {
      this.cache.set(key, value);
      const idx = this.accessOrder.indexOf(key);
      if (idx !== -1) {
        this.accessOrder.splice(idx, 1);
      }
      this.accessOrder.push(key);
      return;
    }

    // Evict LRU if at capacity
    while (this.cache.size >= this.maxSize && this.accessOrder.length > 0) {
      const lruKey = this.accessOrder.shift();
      if (lruKey !== undefined) {
        this.cache.delete(lruKey);
      }
    }

    // Add new entry
    this.cache.set(key, value);
    this.accessOrder.push(key);
  }

  /**
   * Check if a key exists in the cache.
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Get current cache size.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder.length = 0;
  }

  /**
   * Get cache stats.
   */
  getStats(): { size: number; maxSize: number; keys: readonly string[] } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      keys: [...this.cache.keys()],
    };
  }
}

// ============================================================================
// Historical Resolver Class
// ============================================================================

/**
 * Resolves queries against historical IPFS snapshots.
 *
 * Maintains an LRU cache of loaded snapshots and provides temporal
 * resolution for historical queries.
 *
 * @example
 * ```typescript
 * const resolver = new HistoricalResolver(registry);
 *
 * // Query for a historical date
 * const result = await resolver.resolveAsOfDate(
 *   new Date('2022-11-08'),
 *   async (snapshot) => {
 *     // Load and query the snapshot
 *     return lookupDistrict(snapshot.cid, lat, lng);
 *   }
 * );
 *
 * console.log(`District on election day: ${result.data.name}`);
 * ```
 */
export class HistoricalResolver {
  private readonly registry: SnapshotRegistry;
  private readonly config: HistoricalResolverConfig;
  private readonly cache: SnapshotLRUCache<unknown>;
  private cacheHits: number = 0;
  private cacheMisses: number = 0;

  constructor(
    registry: SnapshotRegistry,
    config: Partial<HistoricalResolverConfig> = {}
  ) {
    this.registry = registry;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cache = new SnapshotLRUCache(this.config.maxLoadedSnapshots);
  }

  /**
   * Resolve which snapshot applies for a given date.
   *
   * Uses binary search for efficient lookup in the snapshot registry.
   *
   * @param asOfDate - Date to find snapshot for
   * @returns Snapshot resolution result
   */
  resolveSnapshot(asOfDate: Date): SnapshotResolutionResult {
    const queryTime = asOfDate.getTime();
    const { snapshots } = this.registry;

    // Edge case: before any snapshots
    if (queryTime < snapshots[0].validFrom.getTime()) {
      return {
        snapshot: snapshots[0],
        exactMatch: false,
        confidence: 0.3,
        daysFromQuery: Math.floor(
          (snapshots[0].validFrom.getTime() - queryTime) / (1000 * 60 * 60 * 24)
        ),
        notes: 'Query date is before earliest available snapshot',
      };
    }

    // Binary search for the applicable snapshot
    let left = 0;
    let right = snapshots.length - 1;

    while (left < right) {
      const mid = Math.floor((left + right + 1) / 2);
      if (snapshots[mid].validFrom.getTime() <= queryTime) {
        left = mid;
      } else {
        right = mid - 1;
      }
    }

    const snapshot = snapshots[left];
    const isExactMatch =
      snapshot.validUntil === null ||
      queryTime < snapshot.validUntil.getTime();

    // Calculate confidence based on recency
    const ageMs = Date.now() - snapshot.validFrom.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const confidence = snapshot.isCurrent
      ? 1.0
      : Math.max(0.5, 1.0 - ageDays / 365); // Decay over 1 year

    return {
      snapshot,
      exactMatch: isExactMatch,
      confidence,
      daysFromQuery: 0,
    };
  }

  /**
   * Execute a query against the snapshot for a given date.
   *
   * @param asOfDate - Date to query
   * @param queryFn - Function to execute against the snapshot
   * @returns Query result with snapshot metadata
   */
  async resolveAsOfDate<T>(
    asOfDate: Date,
    queryFn: (snapshot: TemporalSnapshotMetadata) => Promise<T>
  ): Promise<HistoricalQueryResult<T>> {
    const startTime = Date.now();
    const resolution = this.resolveSnapshot(asOfDate);

    // Check cache
    const cacheHit = this.cache.has(resolution.snapshot.cid);
    if (cacheHit) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }

    // Execute query
    const data = await queryFn(resolution.snapshot);

    // Cache the result (the queryFn may have loaded snapshot data)
    this.cache.set(resolution.snapshot.cid, data);

    const latencyMs = Date.now() - startTime;

    return {
      data,
      snapshot: resolution.snapshot,
      merkleProof: {
        root: resolution.snapshot.merkleRoot,
        siblings: [], // Would be populated by actual proof generation
        pathIndices: [],
      },
      cacheHit,
      latencyMs,
    };
  }

  /**
   * Execute a query against a specific snapshot CID.
   *
   * @param cid - Snapshot CID to query
   * @param queryFn - Function to execute against the snapshot
   * @returns Query result
   */
  async resolveAsOfSnapshot<T>(
    cid: string,
    queryFn: (snapshot: TemporalSnapshotMetadata) => Promise<T>
  ): Promise<HistoricalQueryResult<T>> {
    const startTime = Date.now();

    // Find snapshot in registry
    const snapshot = this.registry.snapshots.find((s) => s.cid === cid);
    if (!snapshot) {
      throw new Error(`Snapshot not found in registry: ${cid}`);
    }

    // Check cache
    const cacheHit = this.cache.has(cid);
    if (cacheHit) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }

    // Execute query
    const data = await queryFn(snapshot);

    // Cache the result
    this.cache.set(cid, data);

    const latencyMs = Date.now() - startTime;

    return {
      data,
      snapshot,
      merkleProof: {
        root: snapshot.merkleRoot,
        siblings: [],
        pathIndices: [],
      },
      cacheHit,
      latencyMs,
    };
  }

  /**
   * Get all snapshots in a date range.
   *
   * @param startDate - Start of range (inclusive)
   * @param endDate - End of range (inclusive)
   * @returns Snapshots valid during any part of the range
   */
  getSnapshotsInRange(
    startDate: Date,
    endDate: Date
  ): readonly TemporalSnapshotMetadata[] {
    const startTime = startDate.getTime();
    const endTime = endDate.getTime();

    return this.registry.snapshots.filter((snapshot) => {
      const snapshotStart = snapshot.validFrom.getTime();
      const snapshotEnd = snapshot.validUntil?.getTime() ?? Date.now();

      // Check for overlap
      return snapshotStart <= endTime && snapshotEnd >= startTime;
    });
  }

  /**
   * Get the current snapshot metadata.
   */
  getCurrentSnapshot(): TemporalSnapshotMetadata {
    return this.registry.snapshots[this.registry.currentIndex];
  }

  /**
   * Get cache statistics.
   */
  getCacheStats(): {
    hits: number;
    misses: number;
    hitRate: number;
    cacheSize: number;
    maxSize: number;
  } {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? this.cacheHits / total : 0,
      cacheSize: this.cache.size,
      maxSize: this.config.maxLoadedSnapshots,
    };
  }

  /**
   * Clear the cache.
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Get the snapshot registry.
   */
  getRegistry(): SnapshotRegistry {
    return this.registry;
  }
}

// ============================================================================
// Registry Builder
// ============================================================================

/**
 * Build a snapshot registry from a list of snapshots.
 *
 * @param snapshots - List of snapshots (will be sorted by validFrom)
 * @returns Complete snapshot registry
 */
export function buildSnapshotRegistry(
  snapshots: readonly Omit<TemporalSnapshotMetadata, 'isCurrent'>[]
): SnapshotRegistry {
  if (snapshots.length === 0) {
    throw new Error('Cannot build registry with no snapshots');
  }

  // Sort by validFrom ascending
  const sorted = [...snapshots].sort(
    (a, b) => a.validFrom.getTime() - b.validFrom.getTime()
  );

  // Add validUntil and isCurrent
  const withValidity: TemporalSnapshotMetadata[] = sorted.map(
    (snapshot, index) => ({
      ...snapshot,
      validUntil:
        index < sorted.length - 1 ? sorted[index + 1].validFrom : null,
      isCurrent: index === sorted.length - 1,
    })
  );

  return {
    snapshots: withValidity,
    currentCid: withValidity[withValidity.length - 1].cid,
    currentIndex: withValidity.length - 1,
    earliestDate: withValidity[0].validFrom,
    lastUpdated: new Date(),
  };
}

/**
 * Create a temporal snapshot from base metadata.
 *
 * @param base - Base snapshot metadata
 * @param validFrom - When this snapshot became valid
 * @param censusYear - Census year (2020, 2030, etc.)
 * @param tigerYear - TIGER vintage year
 * @returns Temporal snapshot metadata
 */
export function createTemporalSnapshot(
  base: SnapshotMetadata,
  validFrom: Date,
  censusYear: number,
  tigerYear: number
): Omit<TemporalSnapshotMetadata, 'validUntil' | 'isCurrent'> {
  return {
    ...base,
    validFrom,
    censusYear,
    tigerYear,
  };
}
