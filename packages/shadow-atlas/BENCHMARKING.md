# Shadow Atlas Performance Benchmarking Guide

Production-scale performance validation for the Shadow Atlas Merkle tree builder.

## Quick Start

```bash
# Navigate to shadow-atlas package
cd packages/shadow-atlas

# Run full dataset benchmarks (requires GDAL, ~10 minutes)
RUN_BENCHMARKS=true npm run test:performance

# Run with verbose output and garbage collection enabled
RUN_BENCHMARKS=true node --expose-gc node_modules/.bin/vitest run --config vitest.performance.config.ts
```

## What Gets Benchmarked

### 1. Full Dataset Build (Primary Test)

**Target:** Complete US TIGER dataset
- All 50 states + DC + territories
- All government layers: CD, SLDU, SLDL, County
- Expected: ~10,000+ boundaries

**Performance Budgets:**
- Build time: < 10 minutes
- Peak memory: < 4GB
- Throughput: > 15 boundaries/sec

**What This Validates:**
- System can handle production-scale data
- Memory usage stays within VPS limits
- Build completes within CI timeout constraints
- Merkle root computation is deterministic

### 2. Memory Efficiency

**What Gets Tested:**
- Memory leaks detection
- Garbage collection effectiveness
- Memory retention after builds
- Incremental build overhead

**Performance Budgets:**
- Memory retention: < 20% of peak after GC
- No runaway memory growth across builds

### 3. Concurrent Lookup Performance

**What Gets Tested:**
- 1000 concurrent district lookups
- Random US coordinates
- Latency distribution (p50, p95, p99)

**Performance Budgets:**
- Throughput: > 1000 ops/sec
- p95 latency: < 100ms

### 4. Layer Scaling

**What Gets Tested:**
- Build time for 1, 2, and 3 layer combinations
- Algorithmic complexity validation

**Performance Budgets:**
- Scaling factor: < 2x for 3 layers vs 1 layer
- Sub-quadratic scaling

### 5. Cache Effectiveness

**What Gets Tested:**
- Cold cache (network downloads) vs warm cache (local files)
- Deterministic builds with cached data

**Performance Budgets:**
- Cache speedup: > 1.2x on warm cache

## Prerequisites

### Required Software

1. **GDAL** - Geospatial Data Abstraction Library
   ```bash
   # macOS
   brew install gdal

   # Ubuntu/Debian
   apt install gdal-bin

   # Verify installation
   ogr2ogr --version
   ```

2. **Node.js** - v20+ with exposed garbage collection
   ```bash
   node --version  # Should be v20+
   ```

3. **Network Access** - Census Bureau FTP server
   - Must be able to connect to `ftp2.census.gov`
   - Firewall must allow FTP connections

### Hardware Requirements

**Minimum:**
- 4GB RAM
- 2 CPU cores
- 10GB free disk space
- 10Mbps network

**Recommended:**
- 8GB RAM
- 4 CPU cores
- 50GB free disk space (for full TIGER cache)
- 100Mbps network

**Optimal:**
- 16GB+ RAM
- 8+ CPU cores
- NVMe SSD (1000+ MB/s)
- 1Gbps+ network

## Running Benchmarks

### Basic Run

```bash
# Run all benchmarks (skips if RUN_BENCHMARKS not set)
RUN_BENCHMARKS=true npm run test:performance
```

### Advanced Options

```bash
# Run with garbage collection exposed (recommended for memory tests)
RUN_BENCHMARKS=true node --expose-gc node_modules/.bin/vitest run --config vitest.performance.config.ts

# Run specific benchmark suite
RUN_BENCHMARKS=true npm run test:performance -- --grep="Full Dataset Build"

# Run with verbose output
RUN_BENCHMARKS=true npm run test:performance -- --reporter=verbose

# Save results to file
RUN_BENCHMARKS=true npm run test:performance 2>&1 | tee benchmark-results.txt
```

## Interpreting Results

### Expected Output Format

```
✅ PASS Full Dataset Build
  Duration: 342.56s
  Peak Memory: 2847.32MB
  Boundaries: 10,234
  Throughput: 29.89 boundaries/sec

Detailed Metrics:
  Total boundaries: 10234
  Tree depth: 18
  Layer counts: { congressional_district: 435, ... }
  Memory samples: 6851
  Avg memory: 2134.45MB

✅ Determinism Check:
  Merkle root: 12345678901234567890...
  Boundaries: 10234
  ✅ Deterministic hashing verified
```

### Success Criteria

**PASS:** All budgets met
- Duration < 10 minutes ✅
- Peak memory < 4GB ✅
- No budget violations ✅

**FAIL:** One or more budgets exceeded
- Duration: 652.34s > 600s ❌
- Memory: 4512.23MB > 4096MB ❌

### Performance Regression Detection

Compare results across commits:

```bash
# Baseline (main branch)
git checkout main
RUN_BENCHMARKS=true npm run test:performance | tee baseline.txt

# Current branch
git checkout feature-branch
RUN_BENCHMARKS=true npm run test:performance | tee current.txt

# Compare
diff baseline.txt current.txt
```

**Regression indicators:**
- Build time increase > 10%
- Memory usage increase > 15%
- Throughput decrease > 10%

## Troubleshooting

### "ogr2ogr not found"

**Solution:** Install GDAL
```bash
brew install gdal  # macOS
apt install gdal-bin  # Ubuntu/Debian
```

### "Build time exceeded: 652s > 600s"

**Possible causes:**
1. Slow network connection to Census FTP
2. CPU throttling (thermal limits)
3. Disk I/O bottleneck
4. Performance regression in code

**Solutions:**
- Check network speed: `speedtest-cli`
- Monitor CPU: `top` or Activity Monitor
- Check disk I/O: `iostat -x 1`
- Profile code: `node --prof`

### "Memory exceeded: 4512MB > 4096MB"

**Possible causes:**
1. Memory leak in new code
2. Inefficient data structures
3. GeoJSON features not being released

**Solutions:**
- Run with GC exposed: `node --expose-gc`
- Profile memory: `node --inspect`
- Check for large retained objects
- Review recent changes for memory leaks

### "Network timeout downloading TIGER files"

**Possible causes:**
1. Census FTP server down
2. Firewall blocking FTP
3. Rate limiting

**Solutions:**
- Check FTP status: `ftp ftp2.census.gov`
- Test with smaller state: `states: ['56']` (Wyoming)
- Use cached files (warm cache)
- Retry with backoff

### "Tests skipped (RUN_BENCHMARKS not set)"

This is **expected behavior**. Benchmarks are skipped by default.

**Solution:** Set environment variable
```bash
RUN_BENCHMARKS=true npm run test:performance
```

## Performance Optimization

If benchmarks fail due to performance issues, investigate these areas:

### 1. Network Performance

```bash
# Test FTP download speed
time curl -o test.zip ftp://ftp2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_56_cd.zip

# Expected: < 5 seconds for Wyoming (~50KB)
```

### 2. Disk I/O

```bash
# Test disk write speed
dd if=/dev/zero of=test.bin bs=1M count=1000
# Expected: > 100 MB/s for SSD

# Test disk read speed
dd if=test.bin of=/dev/null bs=1M
# Expected: > 500 MB/s for SSD
```

### 3. CPU Performance

```bash
# Profile CPU usage during build
RUN_BENCHMARKS=true node --prof node_modules/.bin/vitest run --config vitest.performance.config.ts

# Analyze profile
node --prof-process isolate-*.log > profile.txt
```

### 4. Memory Profile

```bash
# Profile memory allocation
RUN_BENCHMARKS=true node --expose-gc --inspect node_modules/.bin/vitest run --config vitest.performance.config.ts

# Open Chrome DevTools → Memory → Take Heap Snapshot
# Analyze retained objects and memory leaks
```

## CI/CD Integration

**IMPORTANT:** Do NOT run these benchmarks in CI.

**Why:**
- Too slow (10+ minutes)
- Network-dependent (unreliable)
- Resource-intensive (exceeds CI limits)
- Non-deterministic (network variance)

**When to run:**
- Locally before release
- Manual performance regression testing
- Hardware capacity planning
- Performance optimization validation

## Updating Performance Budgets

If hardware improves or optimizations are made, update budgets in:

**File:** `src/__tests__/performance/full-dataset-benchmark.test.ts`

```typescript
const PERFORMANCE_BUDGETS = {
  buildTimeMs: 600_000, // 10 minutes max
  peakMemoryMB: 4096, // 4GB max
  lookupLatencyMs: 100, // 100ms max per lookup
  concurrentThroughput: 1000, // 1000 ops/sec min
} as const;
```

**When to update:**
- Significant optimization landed (25%+ improvement)
- Hardware baseline changed (new VPS tier)
- Dataset size changed significantly
- Algorithmic improvements validated

**Process:**
1. Run benchmarks 3 times on target hardware
2. Take conservative estimate (worst of 3)
3. Add 20% safety margin
4. Update budget constants
5. Document in README.md

## Questions?

Open an issue with:
- Hardware specs (CPU, RAM, disk)
- Benchmark results (`benchmark-results.txt`)
- Expected vs actual performance
- Profiling data (if available)
