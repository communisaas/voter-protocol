/**
 * Hierarchical R-tree with Country-Level Partitioning
 *
 * Partitions global district data into country-level shards for O(log n) lookup
 * at 100x scale (millions of districts across 190+ countries).
 *
 * Architecture:
 * 1. Country-level partitioning: O(1) country lookup via bounding box
 * 2. Per-country R-tree: O(log n) district lookup within country
 * 3. Lazy loading: Load country shards on-demand, cache hot countries
 *
 * Performance targets:
 * - Country routing: <1ms (bounding box check)
 * - District lookup: <20ms p50, <50ms p95 (including DB query)
 * - Memory: <2GB for global index (190 countries)
 *
 * CRITICAL: This is the performance bottleneck for global scale.
 */

import type Database from 'better-sqlite3';

/**
 * Country bounding box for fast routing
 */
interface CountryPartition {
  readonly countryCode: string;           // ISO 3166-1 alpha-2
  readonly bbox: BBox;                    // Geographic bounding box
  readonly districtCount: number;         // Number of districts in country
  readonly population?: number;           // Population for cache priority
  readonly lastAccessed?: number;         // Timestamp for LRU eviction
}

/**
 * Bounding box [minLon, minLat, maxLon, maxLat]
 */
type BBox = readonly [number, number, number, number];

/**
 * R-tree node for spatial indexing
 */
interface RTreeNode {
  readonly id: string | null;             // District ID (leaf nodes only)
  readonly bbox: BBox;                    // Bounding box
  readonly children: readonly RTreeNode[] | null;  // Child nodes (internal only)
  readonly isLeaf: boolean;
}

/**
 * Country-specific R-tree shard
 */
interface CountryRTree {
  readonly countryCode: string;
  readonly root: RTreeNode;
  readonly districtCount: number;
  readonly loadedAt: number;              // Timestamp for memory management
}

/**
 * Hierarchical R-tree configuration
 */
export interface HierarchicalRTreeConfig {
  readonly dbPath: string;
  readonly maxCountriesInMemory: number;  // LRU cache size for country shards
  readonly nodeCapacity: number;          // Max children per R-tree node (default: 16)
  readonly enableLazyLoading: boolean;    // Load country shards on-demand
}

/**
 * Hierarchical R-tree with country-level partitioning
 */
export class HierarchicalRTree {
  private readonly db: Database.Database;
  private readonly config: HierarchicalRTreeConfig;

  // Country partitions (always in memory - ~50KB for 190 countries)
  private readonly countryPartitions: Map<string, CountryPartition>;

  // Country R-tree shards (lazy-loaded, LRU cache)
  private readonly countryTrees: Map<string, CountryRTree>;

  // Metrics
  private countryHits = 0;
  private countryMisses = 0;
  private shardLoads = 0;
  private shardEvictions = 0;

  constructor(db: Database.Database, config: HierarchicalRTreeConfig) {
    this.db = db;
    this.config = config;
    this.countryPartitions = new Map();
    this.countryTrees = new Map();
  }

  /**
   * Initialize country partitions from database
   *
   * Loads country-level bounding boxes and district counts.
   * This is lightweight (~50KB for 190 countries) and stays in memory.
   */
  async initialize(): Promise<void> {
    const startTime = performance.now();

    // Query country-level statistics
    const partitions = this.db.prepare(`
      SELECT
        SUBSTR(id, 1, 2) as country_code,
        COUNT(*) as district_count,
        MIN(min_lon) as min_lon,
        MIN(min_lat) as min_lat,
        MAX(max_lon) as max_lon,
        MAX(max_lat) as max_lat
      FROM districts
      GROUP BY country_code
    `).all() as Array<{
      country_code: string;
      district_count: number;
      min_lon: number;
      min_lat: number;
      max_lon: number;
      max_lat: number;
    }>;

    // Build country partition map
    for (const partition of partitions) {
      this.countryPartitions.set(partition.country_code.toUpperCase(), {
        countryCode: partition.country_code.toUpperCase(),
        bbox: [partition.min_lon, partition.min_lat, partition.max_lon, partition.max_lat],
        districtCount: partition.district_count,
      });
    }

    const duration = performance.now() - startTime;
    console.log(`[HierarchicalRTree] Initialized ${this.countryPartitions.size} country partitions in ${duration.toFixed(2)}ms`);
  }

  /**
   * Lookup district for coordinates
   *
   * Two-stage lookup:
   * 1. Route to country partition (O(n) linear scan, but n=190 countries)
   * 2. Query country R-tree (O(log m) where m=districts in country)
   *
   * @param lat - Latitude (WGS84)
   * @param lon - Longitude (WGS84)
   * @returns District ID candidates (still need PIP test)
   */
  lookup(lat: number, lon: number): readonly string[] {
    const startTime = performance.now();

    // Stage 1: Route to country partition (O(n) but n=190)
    const countryCode = this.routeToCountry(lat, lon);

    if (!countryCode) {
      this.countryMisses++;
      return [];  // No country found (ocean, Antarctica, etc.)
    }

    this.countryHits++;

    // Stage 2: Load country R-tree (lazy load if not in cache)
    const countryTree = this.getCountryTree(countryCode);

    if (!countryTree) {
      console.warn(`[HierarchicalRTree] Failed to load R-tree for country ${countryCode}`);
      return [];
    }

    // Stage 3: Query country R-tree
    const candidates = this.queryShard(countryTree, lat, lon);

    const duration = performance.now() - startTime;
    console.debug(`[HierarchicalRTree] Lookup in ${duration.toFixed(2)}ms: ${countryCode}, ${candidates.length} candidates`);

    return candidates;
  }

  /**
   * Route coordinates to country partition
   *
   * O(n) linear scan over country bounding boxes (n=190).
   * This is fast enough (<1ms) that spatial indexing isn't needed.
   *
   * OPTIMIZATION: Could use R-tree over country bboxes if >1000 countries.
   */
  private routeToCountry(lat: number, lon: number): string | null {
    for (const [countryCode, partition] of this.countryPartitions) {
      if (this.isPointInBBox(lat, lon, partition.bbox)) {
        // Update LRU timestamp
        this.countryPartitions.set(countryCode, {
          ...partition,
          lastAccessed: Date.now(),
        });
        return countryCode;
      }
    }

    return null;
  }

  /**
   * Get country R-tree shard (lazy load + LRU cache)
   */
  private getCountryTree(countryCode: string): CountryRTree | null {
    // Check cache
    const cached = this.countryTrees.get(countryCode);
    if (cached) {
      return cached;
    }

    // Lazy load from database
    const tree = this.loadCountryTree(countryCode);

    if (!tree) {
      return null;
    }

    // Cache shard
    this.countryTrees.set(countryCode, tree);
    this.shardLoads++;

    // Evict oldest shard if cache full
    if (this.countryTrees.size > this.config.maxCountriesInMemory) {
      this.evictOldestShard();
    }

    return tree;
  }

  /**
   * Load country R-tree from database
   *
   * Builds in-memory R-tree from district bounding boxes.
   * Uses bulk-loading algorithm for optimal tree structure.
   */
  private loadCountryTree(countryCode: string): CountryRTree | null {
    const startTime = performance.now();

    // Query all districts for country
    const districts = this.db.prepare(`
      SELECT id, min_lon, min_lat, max_lon, max_lat
      FROM districts
      WHERE id LIKE ?
    `).all(`${countryCode.toLowerCase()}%`) as Array<{
      id: string;
      min_lon: number;
      min_lat: number;
      max_lon: number;
      max_lat: number;
    }>;

    if (districts.length === 0) {
      return null;
    }

    // Build R-tree using bulk-loading
    const leafNodes: RTreeNode[] = districts.map(d => ({
      id: d.id,
      bbox: [d.min_lon, d.min_lat, d.max_lon, d.max_lat] as BBox,
      children: null,
      isLeaf: true,
    }));

    const root = this.bulkLoadRTree(leafNodes);

    const duration = performance.now() - startTime;
    console.log(`[HierarchicalRTree] Loaded R-tree for ${countryCode}: ${districts.length} districts in ${duration.toFixed(2)}ms`);

    return {
      countryCode,
      root,
      districtCount: districts.length,
      loadedAt: Date.now(),
    };
  }

  /**
   * Bulk-load R-tree using Sort-Tile-Recursive (STR) algorithm
   *
   * Optimal tree structure for static data (no insertions/deletions).
   * Time complexity: O(n log n)
   *
   * Reference: Leutenegger, Lopez, Edgington (1997)
   */
  private bulkLoadRTree(nodes: RTreeNode[]): RTreeNode {
    if (nodes.length === 0) {
      throw new Error('Cannot bulk-load empty R-tree');
    }

    if (nodes.length === 1) {
      return nodes[0];
    }

    const { nodeCapacity } = this.config;

    // Calculate number of leaf-level slices
    const leafCount = nodes.length;
    const sliceCount = Math.ceil(Math.sqrt(leafCount / nodeCapacity));

    // Sort by x-coordinate (longitude)
    const sortedByX = [...nodes].sort((a, b) => a.bbox[0] - b.bbox[0]);

    // Partition into vertical slices
    const slices: RTreeNode[][] = [];
    const sliceSize = Math.ceil(sortedByX.length / sliceCount);

    for (let i = 0; i < sliceCount; i++) {
      const start = i * sliceSize;
      const end = Math.min(start + sliceSize, sortedByX.length);
      const slice = sortedByX.slice(start, end);

      // Sort each slice by y-coordinate (latitude)
      slice.sort((a, b) => a.bbox[1] - b.bbox[1]);

      slices.push(slice);
    }

    // Group into parent nodes
    const parentNodes: RTreeNode[] = [];

    for (const slice of slices) {
      for (let i = 0; i < slice.length; i += nodeCapacity) {
        const group = slice.slice(i, Math.min(i + nodeCapacity, slice.length));
        const bbox = this.computeBBox(group.map(n => n.bbox));

        parentNodes.push({
          id: null,
          bbox,
          children: group,
          isLeaf: false,
        });
      }
    }

    // Recurse if more than one parent
    if (parentNodes.length === 1) {
      return parentNodes[0];
    }

    return this.bulkLoadRTree(parentNodes);
  }

  /**
   * Query R-tree shard for point
   *
   * Recursive tree traversal with bounding box pruning.
   * Time complexity: O(log n) average case
   */
  private queryShard(shard: CountryRTree, lat: number, lon: number): readonly string[] {
    const candidates: string[] = [];
    const queue: RTreeNode[] = [shard.root];

    while (queue.length > 0) {
      const node = queue.shift()!;

      // Check if point in bounding box
      if (!this.isPointInBBox(lat, lon, node.bbox)) {
        continue;
      }

      // Leaf node: add district candidate
      if (node.isLeaf && node.id) {
        candidates.push(node.id);
        continue;
      }

      // Internal node: add children to queue
      if (node.children) {
        queue.push(...node.children);
      }
    }

    return candidates;
  }

  /**
   * Evict least recently used country shard
   */
  private evictOldestShard(): void {
    let oldestCode: string | null = null;
    let oldestTime = Infinity;

    for (const [code, tree] of this.countryTrees) {
      const partition = this.countryPartitions.get(code);
      const lastAccessed = partition?.lastAccessed ?? tree.loadedAt;

      if (lastAccessed < oldestTime) {
        oldestTime = lastAccessed;
        oldestCode = code;
      }
    }

    if (oldestCode) {
      this.countryTrees.delete(oldestCode);
      this.shardEvictions++;
      console.log(`[HierarchicalRTree] Evicted shard: ${oldestCode}`);
    }
  }

  /**
   * Check if point is inside bounding box
   */
  private isPointInBBox(lat: number, lon: number, bbox: BBox): boolean {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
  }

  /**
   * Compute bounding box from multiple bounding boxes
   */
  private computeBBox(bboxes: readonly BBox[]): BBox {
    if (bboxes.length === 0) {
      throw new Error('Cannot compute bounding box from empty array');
    }

    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;

    for (const bbox of bboxes) {
      minLon = Math.min(minLon, bbox[0]);
      minLat = Math.min(minLat, bbox[1]);
      maxLon = Math.max(maxLon, bbox[2]);
      maxLat = Math.max(maxLat, bbox[3]);
    }

    return [minLon, minLat, maxLon, maxLat];
  }

  /**
   * Get performance metrics
   */
  getMetrics(): HierarchicalRTreeMetrics {
    return {
      countryPartitions: this.countryPartitions.size,
      loadedShards: this.countryTrees.size,
      countryHits: this.countryHits,
      countryMisses: this.countryMisses,
      countryHitRate: this.countryHits > 0
        ? this.countryHits / (this.countryHits + this.countryMisses)
        : 0,
      shardLoads: this.shardLoads,
      shardEvictions: this.shardEvictions,
    };
  }

  /**
   * Clear all cached shards (for testing)
   */
  clearCache(): void {
    this.countryTrees.clear();
    console.log('[HierarchicalRTree] Cleared all cached shards');
  }

  /**
   * Preload hot countries (e.g., US, UK, CA for expected traffic)
   */
  async preloadCountries(countryCodes: readonly string[]): Promise<void> {
    const startTime = performance.now();

    for (const code of countryCodes) {
      this.getCountryTree(code.toUpperCase());
    }

    const duration = performance.now() - startTime;
    console.log(`[HierarchicalRTree] Preloaded ${countryCodes.length} countries in ${duration.toFixed(2)}ms`);
  }
}

/**
 * Performance metrics for hierarchical R-tree
 */
export interface HierarchicalRTreeMetrics {
  readonly countryPartitions: number;     // Total countries indexed
  readonly loadedShards: number;          // Countries currently in memory
  readonly countryHits: number;           // Successful country lookups
  readonly countryMisses: number;         // Failed country lookups (ocean, etc.)
  readonly countryHitRate: number;        // Hit rate for country routing
  readonly shardLoads: number;            // Number of times shards loaded
  readonly shardEvictions: number;        // Number of shard evictions (LRU)
}
