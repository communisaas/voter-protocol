/**
 * Regional Cache with Geographic Distribution
 *
 * Three-tier caching strategy for global district lookups:
 * - L1: Hot districts (city centers, high traffic) - LRU cache
 * - L2: Regional cache (state/province level) - Geographic partitioning
 * - L3: IPFS cache (full geometries) - Content-addressed storage
 *
 * Performance targets:
 * - L1 hit: <1ms (in-memory lookup)
 * - L2 hit: <5ms (regional shard lookup)
 * - L3 hit: <20ms (IPFS fetch)
 * - Miss: <50ms (full DB + PIP test)
 *
 * Memory budget: <500MB for L1+L2 combined
 *
 * CRITICAL: Cache invalidation must be coordinated with Merkle tree updates.
 */

import type { DistrictBoundary } from '../types';
import { logger } from '../../core/utils/logger.js';

/**
 * IPFS snapshot data structure
 * Matches the format published to IPFS by ShadowAtlasService
 */
interface SnapshotData {
  readonly districts: Record<string, DistrictBoundary>;
  readonly metadata?: {
    readonly merkleRoot: string;
    readonly version: number;
    readonly timestamp: string;
  };
}

/**
 * Cache entry with TTL and priority
 */
interface CacheEntry<T> {
  readonly value: T;
  readonly timestamp: number;          // Creation time
  readonly lastAccessed: number;       // Last access time (LRU)
  readonly accessCount: number;        // Access frequency
  readonly size: number;               // Memory size in bytes
  readonly priority: CachePriority;
}

/**
 * Cache priority for eviction policy
 */
enum CachePriority {
  LOW = 0,        // Rural districts, low population
  MEDIUM = 1,     // Suburban districts
  HIGH = 2,       // City centers, high traffic
  CRITICAL = 3,   // Emergency preloaded (election day, etc.)
}

/**
 * Regional cache configuration
 */
export interface RegionalCacheConfig {
  readonly l1MaxSizeMB: number;        // L1 cache size limit (hot districts)
  readonly l2MaxSizeMB: number;        // L2 cache size limit (regional shards)
  readonly l1TTLSeconds: number;       // L1 TTL (default: 3600)
  readonly l2TTLSeconds: number;       // L2 TTL (default: 86400)
  readonly enableL3IPFS: boolean;      // Enable IPFS caching
  readonly ipfsGateway?: string;       // IPFS gateway URL
  readonly localCacheDir?: string;     // Local filesystem cache directory
  readonly snapshotCid?: string;       // Current snapshot CID (from SnapshotMetadata)
}

/**
 * Regional cache key (hierarchical)
 */
interface RegionalKey {
  readonly country: string;            // ISO 3166-1 alpha-2
  readonly region: string;             // State/province code
  readonly districtId?: string;        // Optional district ID
}

/**
 * Regional cache shard (state/province level)
 */
interface RegionalShard {
  readonly key: RegionalKey;
  readonly districts: Map<string, CacheEntry<DistrictBoundary>>;
  readonly totalSize: number;          // Total memory size in bytes
  readonly loadedAt: number;           // Timestamp for LRU
}

/**
 * Three-tier regional cache
 */
export class RegionalCache {
  private readonly config: RegionalCacheConfig;

  // L1: Hot districts (LRU cache, <100MB)
  private readonly l1Cache: Map<string, CacheEntry<DistrictBoundary>>;
  private l1Size = 0;  // Total size in bytes

  // L2: Regional shards (state/province level, <400MB)
  private readonly l2Cache: Map<string, RegionalShard>;
  private l2Size = 0;  // Total size in bytes

  // Metrics
  private l1Hits = 0;
  private l2Hits = 0;
  private l3Hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(config: RegionalCacheConfig) {
    this.config = config;
    this.l1Cache = new Map();
    this.l2Cache = new Map();
  }

  /**
   * Get district from cache (three-tier lookup)
   *
   * PERFORMANCE: L1 and L2 are synchronous. L3 (IPFS) requires async.
   * For synchronous use, use getSync() which skips L3.
   *
   * @param districtId - District ID
   * @returns Cached district or null if miss
   */
  async get(districtId: string): Promise<{ district: DistrictBoundary; tier: 'L1' | 'L2' | 'L3' } | null> {
    const startTime = performance.now();

    // L1: Hot district cache
    const l1Entry = this.l1Cache.get(districtId);
    if (l1Entry && !this.isExpired(l1Entry, this.config.l1TTLSeconds)) {
      // Update LRU metadata
      this.l1Cache.set(districtId, {
        ...l1Entry,
        lastAccessed: Date.now(),
        accessCount: l1Entry.accessCount + 1,
      });

      this.l1Hits++;
      const duration = performance.now() - startTime;
      logger.debug('RegionalCache L1 hit', {
        districtId,
        durationMs: duration,
        tier: 'L1',
        method: 'get',
      });

      return { district: l1Entry.value, tier: 'L1' };
    }

    // L2: Regional shard cache
    const regionalKey = this.parseRegionalKey(districtId);
    if (regionalKey) {
      const shard = this.getRegionalShard(regionalKey);
      if (shard) {
        const l2Entry = shard.districts.get(districtId);
        if (l2Entry && !this.isExpired(l2Entry, this.config.l2TTLSeconds)) {
          // Promote to L1 if high priority
          if (l2Entry.priority >= CachePriority.HIGH || l2Entry.accessCount > 5) {
            this.promoteToL1(districtId, l2Entry);
          }

          this.l2Hits++;
          const duration = performance.now() - startTime;
          logger.debug('RegionalCache L2 hit', {
            districtId,
            durationMs: duration,
            tier: 'L2',
            regionalKey,
            method: 'get',
          });

          return { district: l2Entry.value, tier: 'L2' };
        }
      }
    }

    // L3: IPFS cache (content-addressed storage)
    if (this.config.enableL3IPFS) {
      const l3Result = await this.getFromIPFS(districtId);
      if (l3Result) {
        // Promote to L2 cache
        const regionalKey = this.parseRegionalKey(districtId);
        if (regionalKey) {
          const l3Entry: CacheEntry<DistrictBoundary> = {
            value: l3Result,
            timestamp: Date.now(),
            lastAccessed: Date.now(),
            accessCount: 1,
            size: this.estimateSize(l3Result),
            priority: CachePriority.LOW,
          };
          this.setL2(regionalKey, districtId, l3Entry);
        }

        this.l3Hits++;
        const duration = performance.now() - startTime;
        logger.debug('RegionalCache L3 hit', {
          districtId,
          durationMs: duration,
          tier: 'L3',
        });

        return { district: l3Result, tier: 'L3' };
      }
    }

    this.misses++;
    return null;
  }

  /**
   * Get district from cache (synchronous - L1/L2 only)
   *
   * PERFORMANCE: Skips L3 (IPFS) for synchronous access.
   * Use this when you need immediate results without async overhead.
   *
   * @param districtId - District ID
   * @returns Cached district or null if miss in L1/L2
   */
  getSync(districtId: string): { district: DistrictBoundary; tier: 'L1' | 'L2' } | null {
    const startTime = performance.now();

    // L1: Hot district cache
    const l1Entry = this.l1Cache.get(districtId);
    if (l1Entry && !this.isExpired(l1Entry, this.config.l1TTLSeconds)) {
      // Update LRU metadata
      this.l1Cache.set(districtId, {
        ...l1Entry,
        lastAccessed: Date.now(),
        accessCount: l1Entry.accessCount + 1,
      });

      this.l1Hits++;
      const duration = performance.now() - startTime;
      logger.debug('RegionalCache L1 hit', {
        districtId,
        durationMs: duration,
        tier: 'L1',
        method: 'getSync',
      });

      return { district: l1Entry.value, tier: 'L1' };
    }

    // L2: Regional shard cache
    const regionalKey = this.parseRegionalKey(districtId);
    if (regionalKey) {
      const shard = this.getRegionalShard(regionalKey);
      if (shard) {
        const l2Entry = shard.districts.get(districtId);
        if (l2Entry && !this.isExpired(l2Entry, this.config.l2TTLSeconds)) {
          // Promote to L1 if high priority
          if (l2Entry.priority >= CachePriority.HIGH || l2Entry.accessCount > 5) {
            this.promoteToL1(districtId, l2Entry);
          }

          this.l2Hits++;
          const duration = performance.now() - startTime;
          logger.debug('RegionalCache L2 hit', {
            districtId,
            durationMs: duration,
            tier: 'L2',
            regionalKey,
            method: 'getSync',
          });

          return { district: l2Entry.value, tier: 'L2' };
        }
      }
    }

    this.misses++;
    return null;
  }

  /**
   * Set district in cache (write-through to L1)
   *
   * @param districtId - District ID
   * @param district - District boundary
   * @param priority - Cache priority (default: LOW)
   */
  set(districtId: string, district: DistrictBoundary, priority = CachePriority.LOW): void {
    const size = this.estimateSize(district);
    const now = Date.now();

    const entry: CacheEntry<DistrictBoundary> = {
      value: district,
      timestamp: now,
      lastAccessed: now,
      accessCount: 1,
      size,
      priority,
    };

    // Write to L1 (hot cache)
    this.setL1(districtId, entry);

    // Write to L2 (regional shard)
    const regionalKey = this.parseRegionalKey(districtId);
    if (regionalKey) {
      this.setL2(regionalKey, districtId, entry);
    }
  }

  /**
   * Set entry in L1 cache (with eviction)
   */
  private setL1(districtId: string, entry: CacheEntry<DistrictBoundary>): void {
    // Remove old entry if exists
    const oldEntry = this.l1Cache.get(districtId);
    if (oldEntry) {
      this.l1Size -= oldEntry.size;
    }

    // Add new entry
    this.l1Cache.set(districtId, entry);
    this.l1Size += entry.size;

    // Evict if over limit
    const maxSize = this.config.l1MaxSizeMB * 1024 * 1024;
    while (this.l1Size > maxSize) {
      this.evictL1();
    }
  }

  /**
   * Set entry in L2 regional shard
   */
  private setL2(regionalKey: RegionalKey, districtId: string, entry: CacheEntry<DistrictBoundary>): void {
    const shardKey = this.getShardKey(regionalKey);
    let shard = this.l2Cache.get(shardKey);

    if (!shard) {
      shard = {
        key: regionalKey,
        districts: new Map(),
        totalSize: 0,
        loadedAt: Date.now(),
      };
      this.l2Cache.set(shardKey, shard);
    }

    // Remove old entry if exists
    const oldEntry = shard.districts.get(districtId);
    let oldSize = shard.totalSize;
    if (oldEntry) {
      oldSize -= oldEntry.size;
    }

    // Add new entry
    shard.districts.set(districtId, entry);
    const newSize = oldSize + entry.size;

    // Update shard
    this.l2Cache.set(shardKey, {
      ...shard,
      totalSize: newSize,
    });

    this.l2Size = this.l2Size - shard.totalSize + newSize;

    // Evict if over limit
    const maxSize = this.config.l2MaxSizeMB * 1024 * 1024;
    while (this.l2Size > maxSize) {
      this.evictL2();
    }
  }

  /**
   * Promote L2 entry to L1 cache
   */
  private promoteToL1(districtId: string, entry: CacheEntry<DistrictBoundary>): void {
    const promotedEntry: CacheEntry<DistrictBoundary> = {
      ...entry,
      priority: Math.min(entry.priority + 1, CachePriority.CRITICAL),
      lastAccessed: Date.now(),
      accessCount: entry.accessCount + 1,
    };

    this.setL1(districtId, promotedEntry);
    logger.debug('RegionalCache promoted to L1', {
      districtId,
      priority: promotedEntry.priority,
      accessCount: promotedEntry.accessCount,
    });
  }

  /**
   * Get regional shard from L2 cache
   */
  private getRegionalShard(regionalKey: RegionalKey): RegionalShard | null {
    const shardKey = this.getShardKey(regionalKey);
    return this.l2Cache.get(shardKey) ?? null;
  }

  /**
   * Evict least valuable entry from L1 cache
   *
   * Eviction policy: LRU with priority weighting
   * - Lower priority = evict first
   * - Within same priority, evict LRU
   */
  private evictL1(): void {
    let evictKey: string | null = null;
    let lowestScore = Infinity;

    for (const [key, entry] of this.l1Cache) {
      // Score = priority * 1000 + lastAccessed (higher is better)
      const score = entry.priority * 1000 + entry.lastAccessed;

      if (score < lowestScore) {
        lowestScore = score;
        evictKey = key;
      }
    }

    if (evictKey) {
      const entry = this.l1Cache.get(evictKey)!;
      this.l1Cache.delete(evictKey);
      this.l1Size -= entry.size;
      this.evictions++;
      logger.debug('RegionalCache evicted from L1', {
        districtId: evictKey,
        priority: entry.priority,
        accessCount: entry.accessCount,
      });
    }
  }

  /**
   * Evict oldest regional shard from L2 cache
   */
  private evictL2(): void {
    let evictKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, shard] of this.l2Cache) {
      if (shard.loadedAt < oldestTime) {
        oldestTime = shard.loadedAt;
        evictKey = key;
      }
    }

    if (evictKey) {
      const shard = this.l2Cache.get(evictKey)!;
      this.l2Cache.delete(evictKey);
      this.l2Size -= shard.totalSize;
      this.evictions++;
      logger.debug('RegionalCache evicted from L2', {
        regionalKey: evictKey,
        districtCount: shard.districts.size,
      });
    }
  }

  /**
   * Check if cache entry is expired
   */
  private isExpired(entry: CacheEntry<unknown>, ttlSeconds: number): boolean {
    const age = (Date.now() - entry.timestamp) / 1000;
    return age > ttlSeconds;
  }

  /**
   * Parse regional key from district ID
   *
   * District ID format: "{country}-{region}-{city}-{district}"
   * Example: "us-ca-los_angeles-district-1"
   */
  private parseRegionalKey(districtId: string): RegionalKey | null {
    const parts = districtId.split('-');
    if (parts.length < 2) {
      return null;
    }

    return {
      country: parts[0].toUpperCase(),
      region: parts[1].toUpperCase(),
      districtId,
    };
  }

  /**
   * Get shard key from regional key
   */
  private getShardKey(regionalKey: RegionalKey): string {
    return `${regionalKey.country}-${regionalKey.region}`;
  }

  /**
   * Estimate memory size of district boundary
   *
   * Rough estimate: 1KB base + geometry size
   */
  private estimateSize(district: DistrictBoundary): number {
    const baseSize = 1024;  // 1KB for metadata
    const geometrySize = JSON.stringify(district.geometry).length;
    return baseSize + geometrySize;
  }

  /**
   * Preload hot districts (e.g., major city centers)
   *
   * @param districts - Districts to preload with CRITICAL priority
   */
  preload(districts: readonly { id: string; district: DistrictBoundary }[]): void {
    const startTime = performance.now();

    for (const { id, district } of districts) {
      this.set(id, district, CachePriority.CRITICAL);
    }

    const duration = performance.now() - startTime;
    logger.info('RegionalCache preloaded critical districts', {
      districtCount: districts.length,
      durationMs: duration,
    });
  }

  /**
   * Get cache metrics
   */
  getMetrics(): RegionalCacheMetrics {
    const totalRequests = this.l1Hits + this.l2Hits + this.l3Hits + this.misses;

    return {
      l1: {
        size: this.l1Cache.size,
        sizeBytes: this.l1Size,
        hits: this.l1Hits,
        hitRate: totalRequests > 0 ? this.l1Hits / totalRequests : 0,
      },
      l2: {
        shards: this.l2Cache.size,
        districts: Array.from(this.l2Cache.values()).reduce(
          (sum, shard) => sum + shard.districts.size,
          0
        ),
        sizeBytes: this.l2Size,
        hits: this.l2Hits,
        hitRate: totalRequests > 0 ? this.l2Hits / totalRequests : 0,
      },
      l3: {
        hits: this.l3Hits,
        hitRate: totalRequests > 0 ? this.l3Hits / totalRequests : 0,
      },
      overall: {
        totalRequests,
        totalHits: this.l1Hits + this.l2Hits + this.l3Hits,
        misses: this.misses,
        hitRate: totalRequests > 0 ? (this.l1Hits + this.l2Hits + this.l3Hits) / totalRequests : 0,
        evictions: this.evictions,
      },
    };
  }

  /**
   * Clear all caches (for testing)
   */
  clear(): void {
    this.l1Cache.clear();
    this.l2Cache.clear();
    this.l1Size = 0;
    this.l2Size = 0;
    logger.info('RegionalCache cleared all caches', {
      l1Size: this.l1Cache.size,
      l2ShardCount: this.l2Cache.size,
    });
  }

  /**
   * Invalidate cache entries after Merkle tree update
   *
   * @param districtIds - Districts that changed in new snapshot
   */
  invalidate(districtIds: readonly string[]): void {
    let invalidated = 0;

    for (const id of districtIds) {
      // Remove from L1
      const l1Entry = this.l1Cache.get(id);
      if (l1Entry) {
        this.l1Cache.delete(id);
        this.l1Size -= l1Entry.size;
        invalidated++;
      }

      // Remove from L2
      const regionalKey = this.parseRegionalKey(id);
      if (regionalKey) {
        const shard = this.getRegionalShard(regionalKey);
        if (shard) {
          const l2Entry = shard.districts.get(id);
          if (l2Entry) {
            shard.districts.delete(id);
            this.l2Size -= l2Entry.size;
            invalidated++;
          }
        }
      }
    }

    logger.info('RegionalCache invalidated cache entries', {
      invalidatedCount: invalidated,
      districtCount: districtIds.length,
    });
  }

  // ============================================================================
  // L3: IPFS Content-Addressed Cache
  // ============================================================================

  /**
   * Get district from IPFS cache
   *
   * Fetches entire snapshot from IPFS and extracts requested district.
   * IPFS content is immutable (content-addressed), so we can cache indefinitely.
   *
   * Architecture:
   * 1. Check local filesystem cache for snapshot (keyed by CID)
   * 2. If miss, fetch from IPFS gateway
   * 3. Extract requested district from snapshot
   * 4. Cache snapshot locally for future requests
   *
   * @param districtId - District ID
   * @returns District boundary or null if not found
   */
  private async getFromIPFS(districtId: string): Promise<DistrictBoundary | null> {
    const { ipfsGateway, snapshotCid, localCacheDir } = this.config;

    // Verify IPFS is configured
    if (!ipfsGateway || !snapshotCid) {
      return null;
    }

    try {
      // Check local filesystem cache first
      let snapshotData: SnapshotData | null = null;

      if (localCacheDir) {
        snapshotData = await this.loadSnapshotFromCache(snapshotCid, localCacheDir);
      }

      // Cache miss - fetch from IPFS gateway
      if (!snapshotData) {
        snapshotData = await this.fetchSnapshotFromIPFS(snapshotCid, ipfsGateway);

        // Store in local cache for future requests
        if (snapshotData && localCacheDir) {
          await this.saveSnapshotToCache(snapshotCid, snapshotData, localCacheDir);
        }
      }

      // Extract requested district from snapshot
      if (snapshotData) {
        return this.extractDistrictFromSnapshot(districtId, snapshotData);
      }

      return null;
    } catch (error) {
      logger.warn('RegionalCache IPFS fetch failed', {
        districtId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Load snapshot from local filesystem cache
   */
  private async loadSnapshotFromCache(
    cid: string,
    cacheDir: string
  ): Promise<SnapshotData | null> {
    try {
      const { join } = await import('node:path');
      const { readFile } = await import('node:fs/promises');

      const cachePath = join(cacheDir, 'ipfs', `${cid}.json`);
      const cached = await readFile(cachePath, 'utf-8');
      return JSON.parse(cached) as SnapshotData;
    } catch {
      // Cache miss or read error
      return null;
    }
  }

  /**
   * Fetch snapshot from IPFS gateway with fallback chain
   *
   * Tries multiple gateways in priority order:
   * 1. Primary gateway from config
   * 2. w3s.link (Storacha gateway)
   * 3. dweb.link (Protocol Labs)
   * 4. ipfs.io (Public fallback)
   *
   * IPFS URLs (ipfs://CID) are automatically resolved.
   */
  private async fetchSnapshotFromIPFS(
    cidOrUrl: string,
    primaryGateway: string
  ): Promise<SnapshotData | null> {
    // Extract CID from ipfs:// URL if present
    const cid = cidOrUrl.startsWith('ipfs://')
      ? cidOrUrl.slice(7) // Remove 'ipfs://' prefix
      : cidOrUrl;

    // Gateway fallback chain (ordered by reliability)
    const gateways = [
      primaryGateway,
      'https://w3s.link',
      'https://dweb.link',
      'https://ipfs.io',
    ].filter((url, index, arr) => arr.indexOf(url) === index); // Deduplicate

    // Try each gateway in sequence
    for (const gateway of gateways) {
      try {
        const url = `${gateway}/ipfs/${cid}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });

        clearTimeout(timeout);

        if (!response.ok) {
          logger.debug('RegionalCache gateway response', {
            gateway,
            cid,
            statusCode: response.status,
          });
          continue; // Try next gateway
        }

        const data = await response.json();
        logger.debug('RegionalCache successfully fetched from gateway', {
          cid,
          gateway,
        });
        return data as SnapshotData;
      } catch (error) {
        logger.debug('RegionalCache gateway failed', {
          gateway,
          cid,
          error: error instanceof Error ? error.message : String(error),
        });
        continue; // Try next gateway
      }
    }

    // All gateways failed
    logger.warn('RegionalCache all gateways failed', {
      cid,
    });
    return null;
  }

  /**
   * Save snapshot to local filesystem cache
   */
  private async saveSnapshotToCache(
    cid: string,
    snapshot: SnapshotData,
    cacheDir: string
  ): Promise<void> {
    try {
      const { join, dirname } = await import('node:path');
      const { mkdir } = await import('node:fs/promises');
      const { atomicWriteJSON } = await import('../../core/utils/atomic-write.js');

      const cachePath = join(cacheDir, 'ipfs', `${cid}.json`);
      await mkdir(dirname(cachePath), { recursive: true });
      // Use atomic write to prevent cache corruption on crash
      await atomicWriteJSON(cachePath, snapshot);
    } catch (error) {
      logger.warn('RegionalCache failed to cache snapshot', {
        cid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Extract district from snapshot data
   *
   * Snapshot format: { districts: { [id: string]: DistrictBoundary } }
   * This matches the structure published to IPFS by ShadowAtlasService.
   */
  private extractDistrictFromSnapshot(
    districtId: string,
    snapshot: SnapshotData
  ): DistrictBoundary | null {
    if (!snapshot.districts || typeof snapshot.districts !== 'object') {
      logger.warn('RegionalCache invalid snapshot format', {
        reason: 'missing districts object',
      });
      return null;
    }

    return snapshot.districts[districtId] ?? null;
  }

  /**
   * Store district in IPFS cache
   *
   * Writes district data to local filesystem cache and optionally pins to IPFS.
   *
   * @param districtId - District ID
   * @param district - District boundary
   */
  private async storeInIPFS(districtId: string, district: DistrictBoundary): Promise<void> {
    if (!this.config.ipfsGateway) {
      return;
    }

    try {
      // In production, this would:
      // 1. Serialize district data
      // 2. Compute IPFS CID (SHA-256 hash)
      // 3. Write to local cache at .cache/ipfs/{cid}
      // 4. Optionally pin to IPFS network
      //
      // const data = JSON.stringify(district);
      // const cid = await this.computeCID(data);
      // const cachePath = join(this.cacheDir, 'ipfs', cid);
      // await mkdir(dirname(cachePath), { recursive: true });
      // await writeFile(cachePath, data);

      // Placeholder: IPFS integration not yet implemented
    } catch (error) {
      logger.warn('RegionalCache IPFS store failed', {
        districtId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Regional cache metrics
 */
export interface RegionalCacheMetrics {
  readonly l1: {
    readonly size: number;              // Number of entries
    readonly sizeBytes: number;         // Memory usage
    readonly hits: number;
    readonly hitRate: number;
  };
  readonly l2: {
    readonly shards: number;            // Number of regional shards
    readonly districts: number;         // Total districts in L2
    readonly sizeBytes: number;
    readonly hits: number;
    readonly hitRate: number;
  };
  readonly l3: {
    readonly hits: number;
    readonly hitRate: number;
  };
  readonly overall: {
    readonly totalRequests: number;
    readonly totalHits: number;
    readonly misses: number;
    readonly hitRate: number;
    readonly evictions: number;
  };
}
