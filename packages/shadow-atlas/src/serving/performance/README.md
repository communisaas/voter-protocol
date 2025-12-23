# Shadow Atlas Performance Optimization Layer

**Maintains <50ms p95 latency at 100x scale (millions of districts, 190+ countries)**

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     District Lookup Request                      │
│                      (lat: 40.7128, lon: -74.0060)              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    L1 Cache (Hot Districts)                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  us-ny-new_york-district-1 → DistrictBoundary (cached)   │  │
│  │  Cache hit: <1ms return                                   │  │
│  └───────────────────────────────────────────────────────────┘  │
│  Size: <100MB | Hit rate: >50% | TTL: 1 hour                    │
└────────────────────────────┬────────────────────────────────────┘
                             │ Cache miss
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                 L2 Cache (Regional Shards)                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Shard: US-NY (New York state)                            │  │
│  │  Contains: 500 districts                                  │  │
│  │  Lookup: <5ms                                             │  │
│  └───────────────────────────────────────────────────────────┘  │
│  Size: <400MB | Hit rate: >30% | TTL: 24 hours                  │
└────────────────────────────┬────────────────────────────────────┘
                             │ Cache miss
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Hierarchical R-tree (Country Partitions)            │
│                                                                  │
│  Step 1: Route to country (O(n), n=190)                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Check bounding boxes: US, Canada, Mexico, UK, ...        │  │
│  │  Match: US (bbox contains point)                          │  │
│  │  Time: <1ms                                                │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Step 2: Load country shard (lazy loading)                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Load US R-tree from database                             │  │
│  │  Districts: 24,000 (council + county + congressional)     │  │
│  │  Time: ~50ms (first load), cached thereafter              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Step 3: Query R-tree (O(log m), m=24,000)                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Traverse tree: Root → ... → Leaf (depth ~15)             │  │
│  │  Candidates: 2-3 districts (bounding box overlap)         │  │
│  │  Time: ~10ms                                               │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│            Point-in-Polygon Test (Turf.js)                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Test candidates: district-1, district-2, district-3      │  │
│  │  Match: district-1 (point inside polygon)                 │  │
│  │  Time: ~5-10ms per candidate                              │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Result + Cache Update                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  District: us-ny-new_york-district-1                      │  │
│  │  Update L1 cache (hot district)                           │  │
│  │  Update L2 cache (regional shard)                         │  │
│  │  Total time: <50ms (p95)                                  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Hierarchical R-tree

**File**: [`hierarchical-rtree.ts`](./hierarchical-rtree.ts)

**Purpose**: Country-level partitioning with lazy-loaded shards

**Key features**:
- Country routing via bounding box (O(n), n=190 countries)
- Lazy-loaded per-country R-trees (O(log m) lookup within country)
- LRU cache for 10 most-accessed countries
- Bulk-loading algorithm (Sort-Tile-Recursive) for optimal tree structure

**Performance**:
- Country routing: <1ms
- R-tree lookup: <20ms (including lazy load)
- Memory: ~50MB per shard, <500MB total (10 shards)

**Usage**:
```typescript
import { HierarchicalRTree } from './performance';

const rtree = new HierarchicalRTree(db, {
  dbPath: './districts.db',
  maxCountriesInMemory: 10,
  nodeCapacity: 16,
  enableLazyLoading: true,
});

await rtree.initialize();

const candidates = rtree.lookup(40.7128, -74.0060);
// Returns: ['us-ny-new_york-district-1', 'us-ny-new_york-district-2']
```

### 2. Regional Cache

**File**: [`regional-cache.ts`](./regional-cache.ts)

**Purpose**: Three-tier caching with geographic partitioning

**Tiers**:
1. **L1 (Hot districts)**: LRU cache, <100MB, 1-hour TTL
   - City centers, high-traffic districts
   - <1ms lookup time
   - >50% hit rate

2. **L2 (Regional)**: Geographic sharding, <400MB, 24-hour TTL
   - State/province level
   - <5ms lookup time
   - >30% hit rate

3. **L3 (IPFS)**: Content-addressed storage (planned)
   - Full district geometries
   - <20ms fetch time
   - Unlimited size

**Performance**:
- L1 hit: <1ms
- L2 hit: <5ms
- Overall hit rate: >80%

**Usage**:
```typescript
import { RegionalCache } from './performance';

const cache = new RegionalCache({
  l1MaxSizeMB: 100,
  l2MaxSizeMB: 400,
  l1TTLSeconds: 3600,
  l2TTLSeconds: 86400,
  enableL3IPFS: false,
});

// Get from cache
const result = cache.get('us-ny-new_york-district-1');

// Set to cache
cache.set('us-ny-new_york-district-1', district);

// Preload hot districts
cache.preload([
  { id: 'us-ny-new_york-district-1', district },
  { id: 'us-ca-los_angeles-district-1', district },
]);
```

### 3. Batch Optimizer

**File**: [`batch-optimizer.ts`](./batch-optimizer.ts)

**Purpose**: Optimize batch geocoding and district lookups

**Optimizations**:
- **Locality grouping**: Cluster nearby coordinates (50km radius)
- **Parallel PIP testing**: Run point-in-polygon tests concurrently (max 10)
- **Early termination**: Stop after first definite match
- **Deduplication**: Cache identical coordinate lookups

**Performance**:
- Batch of 100 coordinates: <500ms total (<5ms per coordinate)
- Batch of 1000 coordinates: <3s total (<3ms per coordinate)
- Locality speedup: 2-3x faster than sequential

**Usage**:
```typescript
import { BatchOptimizer } from './performance';

const optimizer = new BatchOptimizer(lookupFn, {
  maxBatchSize: 1000,
  maxConcurrency: 10,
  clusterRadiusKm: 50,
  enableEarlyTermination: true,
  enableDeduplication: true,
});

const requests = [
  { id: 'req-1', lat: 40.7128, lon: -74.0060 },
  { id: 'req-2', lat: 34.0522, lon: -118.2437 },
  // ... 98 more requests
];

const results = await optimizer.optimizeBatch(requests);
// Returns: [{ id, district, latencyMs, cacheHit }]
```

### 4. Preload Strategy

**File**: [`preload-strategy.ts`](./preload-strategy.ts)

**Purpose**: Predictive preloading based on traffic patterns

**Strategies**:
- **Timezone-aware**: Preload regions in business hours (9am-5pm local)
- **Event-driven**: Election day, voter registration deadlines (CRITICAL priority)
- **Traffic prediction**: Use historical patterns to predict high-traffic regions
- **Population-weighted**: Major metro areas preloaded (HIGH priority)

**Performance**:
- Preload latency: <500ms for top 100 metro areas
- Cache hit rate: >90% during peak hours
- Memory: <200MB for preloaded data

**Usage**:
```typescript
import { PreloadStrategy, US_METRO_PRELOAD_TARGETS } from './performance';

const preload = new PreloadStrategy(cache, {
  enableTimezoneAware: true,
  enableTrafficPrediction: true,
  enableEventDriven: true,
  maxPreloadSizeMB: 200,
  preloadIntervalMinutes: 15,
});

// Register metro area targets
preload.registerTargets(US_METRO_PRELOAD_TARGETS);

// Schedule election day event
preload.scheduleEvent({
  name: 'Election Day 2026',
  startTime: new Date('2026-11-03T06:00:00Z'),
  endTime: new Date('2026-11-04T06:00:00Z'),
  targets: US_METRO_PRELOAD_TARGETS,
  priority: PreloadPriority.CRITICAL,
});

// Start background preload loop
preload.startBackgroundPreload(lookupFn);
```

## Performance Targets

See [PERFORMANCE_SPEC.md](../PERFORMANCE_SPEC.md) for complete specification.

**Key targets**:
- **Latency**: p50 <20ms, p95 <50ms, p99 <100ms
- **Throughput**: 10,000 req/sec sustained
- **Memory**: <2GB for global index (190+ countries)
- **Cache hit rate**: >80% overall (L1+L2 combined)

## Benchmarking

Run benchmarks to validate performance:

```bash
# Quick smoke test (<30s)
npm run bench:quick

# Latency benchmarks (<2min)
npm run bench:latency

# Throughput benchmarks (<5min)
npm run bench:throughput

# Memory benchmarks (<5min)
npm run bench:memory

# Full benchmark suite (~30min)
npm run bench:full
```

**Benchmark files**:
- [`benchmarks/global-lookup.bench.ts`](../../benchmarks/global-lookup.bench.ts) - Latency tests
- [`benchmarks/throughput.bench.ts`](../../benchmarks/throughput.bench.ts) - Throughput tests
- [`benchmarks/memory.bench.ts`](../../benchmarks/memory.bench.ts) - Memory tests

## Integration Example

Complete integration with district lookup service:

```typescript
import Database from 'better-sqlite3';
import { DistrictLookupService } from '../district-service';
import {
  HierarchicalRTree,
  RegionalCache,
  BatchOptimizer,
  PreloadStrategy,
  US_METRO_PRELOAD_TARGETS,
  PreloadPriority,
} from './performance';

// Initialize database
const db = new Database('./districts.db', { readonly: true });

// Initialize hierarchical R-tree
const rtree = new HierarchicalRTree(db, {
  dbPath: './districts.db',
  maxCountriesInMemory: 10,
  nodeCapacity: 16,
  enableLazyLoading: true,
});

await rtree.initialize();

// Preload hot countries (US, UK, CA)
await rtree.preloadCountries(['US', 'UK', 'CA']);

// Initialize regional cache
const cache = new RegionalCache({
  l1MaxSizeMB: 100,
  l2MaxSizeMB: 400,
  l1TTLSeconds: 3600,
  l2TTLSeconds: 86400,
  enableL3IPFS: false,
});

// Initialize lookup service
const lookupService = new DistrictLookupService('./districts.db', 10000, 3600);

// Create lookup function for batch optimizer
const lookupFn = (lat: number, lon: number) => lookupService.lookup(lat, lon);

// Initialize batch optimizer
const batchOptimizer = new BatchOptimizer(lookupFn, {
  maxBatchSize: 1000,
  maxConcurrency: 10,
  clusterRadiusKm: 50,
  enableEarlyTermination: true,
  enableDeduplication: true,
});

// Initialize preload strategy
const preload = new PreloadStrategy(cache, {
  enableTimezoneAware: true,
  enableTrafficPrediction: true,
  enableEventDriven: true,
  maxPreloadSizeMB: 200,
  preloadIntervalMinutes: 15,
});

// Register preload targets
preload.registerTargets(US_METRO_PRELOAD_TARGETS);

// Schedule election day event
preload.scheduleEvent({
  name: 'Election Day 2026',
  startTime: new Date('2026-11-03T06:00:00Z'),
  endTime: new Date('2026-11-04T06:00:00Z'),
  targets: US_METRO_PRELOAD_TARGETS,
  priority: PreloadPriority.CRITICAL,
});

// Start background preload
preload.startBackgroundPreload(async (districtId) => {
  const result = lookupService.lookup(/* coordinates from districtId */);
  return result.district;
});

// Single lookup
const result = lookupService.lookup(40.7128, -74.0060);
console.log('District:', result.district?.name);
console.log('Latency:', result.latencyMs, 'ms');
console.log('Cache hit:', result.cacheHit);

// Batch lookup
const requests = [
  { id: 'req-1', lat: 40.7128, lon: -74.0060 },
  { id: 'req-2', lat: 34.0522, lon: -118.2437 },
  // ... more requests
];

const batchResults = await batchOptimizer.optimizeBatch(requests);
console.log('Batch processed:', batchResults.length, 'requests');

// Get metrics
console.log('R-tree metrics:', rtree.getMetrics());
console.log('Cache metrics:', cache.getMetrics());
console.log('Batch metrics:', batchOptimizer.getMetrics());
console.log('Preload metrics:', preload.getMetrics());
```

## Production Deployment

**Recommended infrastructure**:
- **Compute**: 4 vCPU, 8GB RAM per instance
- **Instances**: 3-5 instances (load balanced)
- **Database**: Replicated SQLite (read-only)
- **Cache**: Redis for shared L1 cache (optional)
- **Cost**: ~$150-250/month

**Autoscaling triggers**:
- Scale up: p95 latency >100ms for 5 minutes
- Scale down: p95 latency <20ms for 30 minutes

**Monitoring**:
- Prometheus metrics: `/metrics` endpoint
- Health checks: `/health` endpoint
- Grafana dashboards: Latency, throughput, cache hit rate

## Future Optimizations

**Post-MVP improvements**:
1. **WebAssembly PIP testing**: 5-10x faster point-in-polygon tests
2. **GPU-accelerated indexing**: 100,000+ req/sec throughput
3. **Distributed R-tree**: Horizontal sharding across instances
4. **Learned index structures**: ML-optimized spatial index (<1ms lookup)

See [PERFORMANCE_SPEC.md](../PERFORMANCE_SPEC.md) for details.

---

**Last updated**: 2025-12-18
**Author**: Performance Engineering Team
**Status**: Production-ready
