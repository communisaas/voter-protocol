# Shadow Atlas Caching Architecture

## Overview

Shadow Atlas implements a **three-tier caching strategy** optimized for global district boundary lookups with minimal memory footprint and maximum hit rates.

**Performance Targets:**
- **L1 Hit:** <1ms (in-memory)
- **L2 Hit:** <5ms (regional shard)
- **L3 Hit:** <20ms (IPFS fetch)
- **Cache Miss:** <50ms (full DB + PIP test)
- **Memory Budget:** <500MB total (L1 + L2 combined)

## Architecture

### L1: Hot District Cache (In-Memory LRU)

**Purpose:** Fastest possible lookups for frequently accessed districts.

**Implementation:** `regional-cache.ts` - L1Cache

**Characteristics:**
- In-memory Map with LRU eviction
- Size limit: 100MB (configurable via `l1MaxSizeMB`)
- TTL: 1 hour (configurable via `l1TTLSeconds`)
- Priority-weighted eviction (HIGH priority districts evicted last)
- Promotion from L2: High-traffic districts automatically promoted

**Use Cases:**
- City centers (NYC, LA, Chicago)
- High-traffic metro areas
- Election day hotspots
- Peak hour traffic

### L2: Regional Shard Cache (Geographic Partitioning)

**Purpose:** State/province-level caching with geographic locality.

**Implementation:** `regional-cache.ts` - L2Cache

**Characteristics:**
- Geographic sharding by country + region
- Size limit: 400MB (configurable via `l2MaxSizeMB`)
- TTL: 24 hours (configurable via `l2TTLSeconds`)
- Shard-level eviction (oldest shard first)
- Automatic promotion to L1 for hot districts

**Use Cases:**
- State-level queries (all California districts)
- Regional preloading
- Business hours timezone targeting
- Event-driven preloading (voter registration deadlines)

### L3: IPFS Content-Addressed Cache (Immutable Storage)

**Purpose:** Content-addressed storage for district geometries with indefinite caching.

**Implementation:** `regional-cache.ts` - IPFS Cache + `cache-utils.ts`

**Characteristics:**
- Filesystem cache keyed by CID (SHA-256 content hash)
- No TTL (IPFS content is immutable)
- Configurable size limit (default: 1GB via `cache-utils.ts`)
- LRU eviction when size limit exceeded
- Optional IPFS gateway fallback

**Use Cases:**
- Cold-start scenarios
- Disaster recovery
- Cross-region distribution
- Merkle tree snapshot storage

## Cache Flow

```typescript
// Lookup flow:
async get(districtId: string) {
  // 1. Check L1 (hot cache)
  const l1Hit = this.l1Cache.get(districtId);
  if (l1Hit && !expired(l1Hit)) {
    updateLRU(l1Hit);
    return { district: l1Hit.value, tier: 'L1' };
  }

  // 2. Check L2 (regional shard)
  const regionalKey = parseRegionalKey(districtId);
  const l2Hit = this.l2Cache.get(shardKey(regionalKey))?.districts.get(districtId);
  if (l2Hit && !expired(l2Hit)) {
    promoteToL1IfHot(districtId, l2Hit);  // Auto-promotion
    return { district: l2Hit.value, tier: 'L2' };
  }

  // 3. Check L3 (IPFS cache)
  const l3Hit = await this.getFromIPFS(districtId);
  if (l3Hit) {
    promoteToL2(districtId, l3Hit);  // Populate L2
    return { district: l3Hit, tier: 'L3' };
  }

  // 4. Cache miss - fetch from DB
  return null;
}
```

## Preloading Strategy

**File:** `preload-strategy.ts`

Shadow Atlas implements **predictive preloading** based on:

1. **Traffic Patterns:** Historical data shows peak hours for regions
2. **Timezone Awareness:** Preload regions entering business hours (9am-5pm local)
3. **Event-Driven:** Election days, voter registration deadlines
4. **Population Density:** Major metro areas prioritized

### Preload Priority Levels

```typescript
enum PreloadPriority {
  CRITICAL = 3,    // Election day, voter registration deadline
  HIGH = 2,        // Major metro areas, peak hours
  MEDIUM = 1,      // Secondary cities, business hours
  LOW = 0,         // Background preload during idle time
}
```

### Example: Timezone-Aware Preloading

```typescript
// At 9:00 AM EST (14:00 UTC), preload Eastern US districts
const targets: PreloadTarget[] = [
  { country: 'US', region: 'NY', priority: PreloadPriority.HIGH },
  { country: 'US', region: 'MA', priority: PreloadPriority.HIGH },
  { country: 'US', region: 'PA', priority: PreloadPriority.HIGH },
  // ... all Eastern timezone regions
];

await preloadStrategy.executePreload(targets);
```

## TIGER Data Caching

**File:** `tiger-extraction-service.ts`

Census TIGER data extraction implements **two-level caching**:

### 1. Result Cache (Extracted Districts)

**Location:** `.cache/results/{key}.json`

**Key Format:**
- State extraction: `state_{fips}_{layer}_{year}.json`
- National extraction: `national_{layer}_{year}.json`

**Example:**
```
.cache/results/state_06_congressional_2024.json
.cache/results/national_congressional_2024.json
```

### 2. Provider Cache (Raw Shapefiles)

**Location:** `.cache/{layer}_{year}/`

**Structure:**
```
.cache/
  cd_2024/           # Congressional districts
  sldu_2024/         # State legislative upper
  sldl_2024/         # State legislative lower
  county_2024/       # Counties
```

### Cache Clearing

```typescript
const service = new TIGERExtractionService();

// Clear all cache
await service.clearCache();

// Clear California data only
await service.clearCache({ stateCode: '06' });

// Clear congressional districts only
await service.clearCache({ entityType: 'congressional' });

// Clear California congressional districts
await service.clearCache({ stateCode: '06', entityType: 'congressional' });

// Result:
// { clearedEntries: 15, freedBytes: 45678901 }
```

## Filesystem Cache Utilities

**File:** `cache-utils.ts`

General-purpose filesystem cache with content addressing.

### Features

- **Content Addressing:** SHA-256 CID for deduplication
- **TTL Expiration:** Configurable time-to-live
- **Size-Based Eviction:** LRU policy when size limit exceeded
- **Atomic Writes:** Temp file + rename for consistency
- **Stats Tracking:** Total entries, size, age metrics

### Example Usage

```typescript
import { FilesystemCache } from './cache-utils.js';

// Create cache (1GB max, 24h TTL)
const cache = new FilesystemCache('.cache/districts', 1024 * 1024 * 1024, 86400);

// Set entry
await cache.set('us-ca-los_angeles-council-1', districtData);

// Get entry (null if expired/missing)
const data = await cache.get<DistrictBoundary>('us-ca-los_angeles-council-1');

// Check existence
const exists = await cache.has('us-ca-los_angeles-council-1');

// Delete entry
await cache.delete('us-ca-los_angeles-council-1');

// Clear all
const result = await cache.clear();
// { clearedEntries: 1523, freedBytes: 456789012 }

// Get stats
const stats = await cache.stats();
// {
//   totalEntries: 1523,
//   totalBytes: 456789012,
//   oldestEntry: 1703001234567,
//   newestEntry: 1703123456789,
//   averageSize: 299862
// }
```

## Cache Invalidation

Shadow Atlas uses **event-driven cache invalidation** coordinated with Merkle tree updates.

### Invalidation Triggers

1. **Merkle Tree Update:** New IPFS snapshot published
2. **District Boundary Change:** Municipal redistricting
3. **Manual Invalidation:** Administrative override

### Implementation

```typescript
// RegionalCache invalidation
regionalCache.invalidate([
  'us-ca-los_angeles-council-1',
  'us-ca-los_angeles-council-2',
  // ... changed district IDs
]);

// Result: Removes from L1 and L2, L3 remains (content-addressed)
```

### Why L3 Doesn't Need Invalidation

IPFS content is **immutable** and **content-addressed**:
- CID = SHA-256(content)
- Changing content → new CID
- Old content remains cached (no invalidation needed)
- New content fetched on first access

## Cache Directory Structure

```
.cache/
├── ipfs/                     # L3: Content-addressed storage
│   ├── 00/
│   │   ├── 00a1b2c3...       # CID-keyed district data
│   │   └── 00d4e5f6...
│   ├── 01/
│   └── ...
├── results/                  # TIGER extraction results
│   ├── state_06_congressional_2024.json
│   ├── national_congressional_2024.json
│   └── ...
└── cd_2024/                  # TIGER raw shapefiles
    ├── tl_2024_us_cd118.shp
    └── ...
```

## Performance Monitoring

### Cache Hit Rates

```typescript
const metrics = regionalCache.getMetrics();

console.log(`L1 Hit Rate: ${(metrics.l1.hitRate * 100).toFixed(2)}%`);
console.log(`L2 Hit Rate: ${(metrics.l2.hitRate * 100).toFixed(2)}%`);
console.log(`L3 Hit Rate: ${(metrics.l3.hitRate * 100).toFixed(2)}%`);
console.log(`Overall Hit Rate: ${(metrics.overall.hitRate * 100).toFixed(2)}%`);
```

**Target Hit Rates (Production):**
- L1: 60-70% (hot districts)
- L2: 25-30% (regional queries)
- L3: 5-10% (cold starts)
- Overall: >90% cache hit rate

### Preload Metrics

```typescript
const preloadMetrics = preloadStrategy.getMetrics();

console.log(`Preloaded ${preloadMetrics.preloadedDistricts} districts`);
console.log(`Average preload time: ${preloadMetrics.avgPreloadTimeMs.toFixed(2)}ms`);
console.log(`Active events: ${preloadMetrics.activeEvents}`);
```

## Configuration

### Regional Cache Config

```typescript
const config: RegionalCacheConfig = {
  l1MaxSizeMB: 100,           // L1 cache size limit
  l2MaxSizeMB: 400,           // L2 cache size limit
  l1TTLSeconds: 3600,         // L1 TTL (1 hour)
  l2TTLSeconds: 86400,        // L2 TTL (24 hours)
  enableL3IPFS: true,         // Enable IPFS caching
  ipfsGateway: 'https://ipfs.io',  // IPFS gateway URL
};
```

### Preload Strategy Config

```typescript
const config: PreloadStrategyConfig = {
  enableTimezoneAware: true,       // Timezone-based preloading
  enableTrafficPrediction: true,   // Historical traffic patterns
  enableEventDriven: true,         // Event-based triggers
  maxPreloadSizeMB: 200,           // Memory budget
  preloadIntervalMinutes: 60,      // Background preload frequency
};
```

## Production Deployment

### Cache Warm-Up

```typescript
// On startup, preload top 100 metro areas
const preloadStrategy = new PreloadStrategy(cache, config);
preloadStrategy.registerTargets(US_METRO_PRELOAD_TARGETS);
await preloadStrategy.executePreload(lookupFn);

// Start background preload loop (runs every hour)
preloadStrategy.startBackgroundPreload(lookupFn);
```

### Monitoring

```bash
# Check cache size
du -sh .cache/
# 843M    .cache/

# Check cache hit rates (from application logs)
grep "Cache hit" logs/shadow-atlas.log | tail -100

# Clear expired entries
tsx -e "import {clearExpiredEntries} from './cache-utils.js'; await clearExpiredEntries('.cache/ipfs');"
```

## Cost Analysis

**At 1M lookups/month:**

| Tier | Hit Rate | Latency | Cost/Lookup | Monthly Cost |
|------|----------|---------|-------------|--------------|
| L1   | 60%      | <1ms    | $0.000      | $0           |
| L2   | 30%      | <5ms    | $0.000      | $0           |
| L3   | 5%       | <20ms   | $0.0001     | $50          |
| Miss | 5%       | <50ms   | $0.001      | $50          |
| **Total** | **100%** | **~2ms avg** | **$0.0001** | **$100** |

**Savings vs. no cache:** 99% cost reduction (would be $10k/month with 100% DB queries).

## Future Optimizations

1. **Adaptive TTL:** Adjust TTL based on data freshness (election years = shorter TTL)
2. **Predictive Prefetch:** ML model predicts next query based on current query
3. **Edge Caching:** Deploy regional caches closer to users (Cloudflare Workers)
4. **Compressed Storage:** Use MessagePack + zstd for 60% size reduction
5. **Tiered Storage:** Move cold data to S3 Glacier (99% cost savings)

## References

- **Regional Cache:** `/src/serving/performance/regional-cache.ts`
- **Preload Strategy:** `/src/serving/performance/preload-strategy.ts`
- **TIGER Extraction:** `/src/services/tiger-extraction-service.ts`
- **Cache Utils:** `/src/serving/performance/cache-utils.ts`
