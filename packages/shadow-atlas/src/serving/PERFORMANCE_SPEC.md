# Shadow Atlas Performance Specification

**Target scale**: 190+ countries, millions of districts, 10,000 req/sec sustained throughput

## Performance Targets

### Latency (Single Lookup)

| Metric | Target | Current (US) | Global Target |
|--------|--------|--------------|---------------|
| p50 | <20ms | ~10ms | <20ms |
| p95 | <50ms | ~30ms | <50ms |
| p99 | <100ms | ~50ms | <100ms |

**Measurement conditions**:
- Cold cache: First lookup after server restart
- Warm cache: Districts cached from previous lookups
- Mixed load: 80% warm, 20% cold (realistic traffic)

### Throughput

| Scenario | Target | Measurement |
|----------|--------|-------------|
| Sequential | >1,000 req/sec | Single-threaded sequential requests |
| Concurrent (10 workers) | >5,000 req/sec | 10 parallel request streams |
| Concurrent (100 workers) | >10,000 req/sec | 100 parallel request streams |
| Burst load | >10,000 req/sec | 10,000 requests in <1 second |

**Measurement conditions**:
- Hot cache: 80% cache hit rate
- Geographic diversity: Requests distributed across 10+ countries
- Realistic query pattern: Follows population density distribution

### Memory Budget

| Component | Budget | Notes |
|-----------|--------|-------|
| **Country partitions** | <1MB | 190 countries × ~5KB metadata |
| **R-tree shards (loaded)** | <500MB | 10 countries × ~50MB average |
| **L1 cache (hot districts)** | <100MB | ~10,000 districts, city centers |
| **L2 cache (regional)** | <400MB | State/province level caching |
| **Total global index** | <2GB | All components combined |

**Memory guarantees**:
- No memory leaks over 24-hour operation
- Graceful degradation when approaching limits
- LRU eviction maintains budget

### Cache Performance

| Metric | Target | Measurement |
|--------|--------|-------------|
| **L1 hit rate** | >50% | Hot districts (city centers) |
| **L2 hit rate** | >30% | Regional districts (state-level) |
| **Overall hit rate** | >80% | Combined L1+L2 hits |
| **L1 lookup time** | <1ms | In-memory hash table |
| **L2 lookup time** | <5ms | Regional shard lookup |
| **L3 (IPFS) lookup time** | <20ms | Content-addressed fetch |

## Scaling Characteristics

### Algorithmic Complexity

| Operation | Complexity | Justification |
|-----------|-----------|---------------|
| **Country routing** | O(n) n=190 | Linear scan over country bboxes (fast enough) |
| **R-tree lookup** | O(log m) | Balanced tree, m=districts per country |
| **PIP test** | O(k) | k=candidate polygons (typically 1-3) |
| **Overall lookup** | O(log m) | Dominated by R-tree traversal |

**Scaling proof**:
- At 100x scale (millions of districts globally):
  - Country routing: O(190) = ~1ms (unchanged)
  - R-tree depth: log₂(1M) ≈ 20 levels, ~10ms (acceptable)
  - PIP test: 1-3 candidates, ~5-10ms per candidate (unchanged)
  - **Total: <50ms p95** ✓

### Data Distribution

**Real-world district distribution**:
- **US**: ~20,000 city council districts + 3,143 counties + 435 congressional districts = ~24,000 districts
- **Europe**: ~100,000 districts across 50 countries (communes, councils, wards)
- **Asia**: ~500,000 districts (highly varied, dense urban + sparse rural)
- **Global total**: ~1-2 million districts (estimated)

**Per-country shard size** (average):
- Small countries (<100 districts): ~1MB per shard
- Medium countries (100-10,000 districts): ~10-50MB per shard
- Large countries (>10,000 districts): ~100-500MB per shard (e.g., India, China)

**Lazy loading strategy**:
- Only load shards for requested countries
- Maximum 10 shards in memory (configurable)
- LRU eviction when limit exceeded
- Preload top 10 countries by traffic (US, UK, CA, AU, etc.)

## Degradation Thresholds

### Latency Degradation

**Acceptable degradation under load**:
- p50: <5% increase under 10,000 req/sec
- p95: <10% increase under 10,000 req/sec
- p99: <20% increase under 10,000 req/sec

**Circuit breaker triggers**:
- p95 latency >200ms for 60 seconds → DEGRADED status
- p99 latency >500ms for 60 seconds → UNHEALTHY status
- Memory usage >90% of budget → Rate limiting enabled

### Error Handling

**Graceful degradation**:
- Database connection failure → Serve from L1/L2 cache only (degraded mode)
- IPFS unavailable → Skip L3 cache, fallback to database
- Memory pressure → Reduce cache size, evict L2 first, then L1

**Error budget**:
- <0.01% error rate (1 in 10,000 requests)
- All errors logged with full context
- Automatic retry for transient failures (max 3 attempts)

## Optimization Strategies

### Hierarchical R-tree

**Architecture**:
1. **Country partitioning**: Split global data into 190 country shards
2. **Lazy loading**: Load country shards on-demand
3. **Bulk loading**: Use Sort-Tile-Recursive (STR) algorithm for optimal tree structure
4. **LRU caching**: Keep 10 most-accessed country shards in memory

**Performance characteristics**:
- Country routing: O(190) linear scan, <1ms
- R-tree construction: O(n log n) bulk loading
- Lookup: O(log n) tree traversal
- Memory: ~50MB per shard (average), <500MB total for 10 shards

### Regional Cache

**Three-tier caching**:
1. **L1 (hot districts)**: LRU cache, <100MB, 1-hour TTL
   - City centers, high-traffic districts
   - <1ms lookup time
   - >50% hit rate

2. **L2 (regional)**: Geographic partitioning, <400MB, 24-hour TTL
   - State/province level sharding
   - <5ms lookup time
   - >30% hit rate

3. **L3 (IPFS)**: Content-addressed storage, unlimited size
   - Full geometries for all districts
   - <20ms fetch time
   - Fallback for cache misses

**Cache invalidation**:
- Coordinated with Merkle tree updates (quarterly)
- Invalidate changed districts only (incremental)
- No global cache flush (partial invalidation)

### Batch Optimization

**Locality grouping**:
- Grid-based clustering (50km radius)
- Shared R-tree traversals for nearby coordinates
- 2-3x speedup for clustered requests

**Parallel PIP testing**:
- Run point-in-polygon tests concurrently (max 10 parallel)
- Early termination on first match
- <5ms per coordinate in batch mode

**Deduplication**:
- Cache identical coordinate lookups (6 decimal precision)
- 10-20% reduction in redundant queries
- <100KB memory overhead

### Predictive Preload

**Traffic-aware preloading**:
- **Timezone-based**: Preload regions in business hours (9am-5pm local)
- **Event-driven**: Election day, voter registration deadlines (CRITICAL priority)
- **Population-weighted**: Major metro areas preloaded (HIGH priority)

**Preload targets**:
- Top 100 US metro areas: ~5,000 districts, <50MB
- Top 50 global cities: ~2,000 districts, <20MB
- Total preload budget: <200MB

**Background preload**:
- Run every 15 minutes during idle time
- Evict cold cache entries before preloading
- Preload takes <500ms (non-blocking)

## Monitoring & Observability

### Key Metrics (Prometheus)

```
# Latency metrics
shadow_atlas_lookup_latency_seconds{quantile="0.5"}  # p50
shadow_atlas_lookup_latency_seconds{quantile="0.95"} # p95
shadow_atlas_lookup_latency_seconds{quantile="0.99"} # p99

# Throughput metrics
shadow_atlas_requests_total                          # Total requests
shadow_atlas_requests_per_second                     # Current throughput

# Cache metrics
shadow_atlas_cache_hits_total{tier="L1"}             # L1 cache hits
shadow_atlas_cache_hits_total{tier="L2"}             # L2 cache hits
shadow_atlas_cache_misses_total                      # Cache misses
shadow_atlas_cache_size_bytes{tier="L1"}             # L1 memory usage
shadow_atlas_cache_size_bytes{tier="L2"}             # L2 memory usage

# R-tree metrics
shadow_atlas_rtree_country_hits_total                # Country routing hits
shadow_atlas_rtree_country_misses_total              # Country routing misses
shadow_atlas_rtree_shard_loads_total                 # Shard load count
shadow_atlas_rtree_shard_evictions_total             # Shard eviction count

# Error metrics
shadow_atlas_errors_total{code="DISTRICT_NOT_FOUND"} # Not found errors
shadow_atlas_errors_total{code="INTERNAL_ERROR"}     # Internal errors
```

### Health Check Endpoints

**GET /health**:
```json
{
  "status": "healthy" | "degraded" | "unhealthy",
  "uptime": 3600,
  "queries": {
    "total": 1000000,
    "successful": 999990,
    "failed": 10,
    "latencyP50": 15.2,
    "latencyP95": 42.1,
    "latencyP99": 89.3,
    "throughput": 8500
  },
  "cache": {
    "size": 5000,
    "hits": 850000,
    "misses": 150000,
    "hitRate": 0.85,
    "evictions": 1200
  },
  "snapshot": {
    "currentCid": "QmXxx...",
    "merkleRoot": "0x123...",
    "districtCount": 1500000,
    "ageSeconds": 7200
  }
}
```

**GET /metrics**:
- Prometheus-formatted metrics export
- Updated every 5 seconds
- Compatible with Grafana dashboards

## Benchmarking Protocol

### Continuous Benchmarking (CI)

**Pre-commit benchmarks**:
```bash
npm run bench:quick        # Fast smoke test (<30s)
npm run bench:latency      # Latency regression test (<2min)
npm run bench:memory       # Memory leak detection (<5min)
```

**Nightly benchmarks**:
```bash
npm run bench:full         # Full benchmark suite (~30min)
npm run bench:stress       # 1-hour stress test
npm run bench:scale        # Global scale simulation
```

### Performance Regression Detection

**Automated alerts**:
- p50 regression >5% → Warning
- p95 regression >10% → Failure (block PR)
- Memory regression >20% → Failure (block PR)

**Benchmark history**:
- Track performance over time (Git commit hash)
- Visualize trends in Grafana
- Automatic bisection for regressions

## Production Deployment

### Recommended Infrastructure

**Single-instance deployment** (low traffic, <1000 req/sec):
- **Compute**: 2 vCPU, 4GB RAM
- **Storage**: 10GB SSD (SQLite database)
- **Cost**: ~$20/month (Fly.io, Railway)

**Multi-instance deployment** (high traffic, >10,000 req/sec):
- **Compute**: 4 vCPU, 8GB RAM per instance
- **Instances**: 3-5 instances (load balanced)
- **Database**: Replicated SQLite (read-only)
- **Cache**: Redis for shared L1 cache (optional)
- **Cost**: ~$150-250/month

### Autoscaling Triggers

**Scale up** when:
- Average latency p95 >100ms for 5 minutes
- CPU usage >80% for 5 minutes
- Request queue depth >1000

**Scale down** when:
- Average latency p95 <20ms for 30 minutes
- CPU usage <30% for 30 minutes
- Request queue depth <100

### Global Distribution (CDN)

**Edge caching** (Cloudflare, Fastly):
- Cache `/lookup?lat=X&lon=Y` responses for 1 hour
- Purge cache on Merkle tree update (quarterly)
- 95% cache hit rate at edge → <5ms global latency

**Regional instances** (multi-region deployment):
- US East, US West, Europe, Asia-Pacific
- Route to nearest instance via GeoDNS
- Cross-region replication for database snapshots

## Future Optimizations (Post-MVP)

### WebAssembly PIP Testing

**Replace Turf.js with Wasm**:
- 5-10x faster point-in-polygon tests
- ~2-5ms → <500μs per test
- Reduces p95 latency from 50ms → 20ms

### GPU-Accelerated Spatial Indexing

**Parallel R-tree traversal on GPU**:
- Process 1000s of lookups in parallel
- Batch throughput: 100,000+ req/sec
- Requires CUDA/OpenCL infrastructure

### Distributed R-tree (Sharding)

**Horizontal sharding across instances**:
- Split country shards across multiple servers
- Country routing → instance routing
- Linear scalability to millions of req/sec

### Learned Index Structures

**ML-optimized spatial index**:
- Replace R-tree with learned index (NN model)
- Predicts leaf node directly from coordinates
- <1ms lookup time (no tree traversal)

---

**Last updated**: 2025-12-18
**Performance baseline**: US districts only (~20,000 districts)
**Global target**: 190+ countries, 1-2M districts
**Verification**: Run `npm run bench:full` to validate targets
