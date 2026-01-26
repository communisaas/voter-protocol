## Performance Testing Infrastructure

Shadow Atlas performance tests for load testing, latency benchmarking, and throughput analysis.

### Test Categories

**Full Dataset Benchmarks**: Production-scale validation with 200K boundaries
**Load Testing**: Test system behavior under high concurrent load
**Latency Benchmarks**: Measure operation latency across different scenarios
**Memory Profiling**: Track memory usage during large operations
**Throughput Tests**: Measure data processing throughput

### Running Performance Tests

```bash
# Run all performance tests
npm run test:atlas:performance

# Run full dataset benchmarks (slow, ~10 minutes)
RUN_BENCHMARKS=true npm run test:performance

# Run with garbage collection exposed (for memory tests)
RUN_BENCHMARKS=true node --expose-gc node_modules/.bin/vitest run --config vitest.performance.config.ts

# Run specific performance test category
npm run test:performance -- --grep="Load Testing"
npm run test:performance -- --grep="Latency"
npm run test:performance -- --grep="Memory"
npm run test:performance -- --grep="Throughput"
```

### Performance Baselines

**Full Dataset (200K Boundaries) - Production Scale:**
- Full dataset build (all layers, all states): < 10 minutes
- Peak memory usage: < 4GB
- Throughput: > 15 boundaries/sec
- Concurrent lookups: > 1000 ops/sec
- p95 lookup latency: < 100ms
- Cache speedup: > 1.2x on warm cache
- Layer scaling: < 2x time increase for 3 layers

**Individual Operations:**
- Single state extraction: < 30 seconds
- Batch extraction (10 states): < 5 minutes
- Merkle tree build (50 states): < 60 seconds
- Point-in-polygon lookup: < 100ms (cold), < 10ms (warm)
- Database write (1000 boundaries): < 5 seconds

**Memory Constraints:**
- Peak memory for full US extraction: < 4GB (production scale)
- Merkle tree build (all states): < 2GB
- Per-state extraction: < 100MB
- Memory retention after GC: < 20% of peak

### Full Dataset Benchmark Details

**File:** `full-dataset-benchmark.test.ts`

**Purpose:** Validate production-scale performance with the complete US TIGER dataset (~200K boundaries).

**Benchmark Suites:**

1. **Full Dataset Build**
   - Downloads and processes all 50 states + DC + territories
   - All layers: CD, SLDU, SLDL, County
   - Expected: 8,000-15,000 boundaries
   - Budget: < 10 minutes, < 4GB memory
   - Tests: Build completion, deterministic Merkle roots

2. **Memory Efficiency**
   - Tests for memory leaks
   - Measures garbage collection effectiveness
   - Validates incremental build memory overhead
   - Budget: < 20% memory retention after GC

3. **Concurrent Lookup Performance**
   - 1000 concurrent district lookups
   - Random US coordinates
   - Budget: > 1000 ops/sec throughput, < 100ms p95 latency

4. **Layer Scaling**
   - Compares build time for 1, 2, and 3 layer combinations
   - Verifies sub-quadratic scaling
   - Budget: < 2x time increase for 3 layers vs 1 layer

5. **Cache Effectiveness**
   - Compares cold cache (network downloads) vs warm cache
   - Validates deterministic builds with cached data
   - Budget: > 1.2x speedup on warm cache

**Prerequisites:**
- GDAL installed (`brew install gdal`)
- Network connectivity to Census Bureau FTP
- ~4GB available RAM
- 10+ minutes execution time

**Note:** Do NOT run in CI (too slow, network-dependent). Run manually for:
- Pre-release performance validation
- Performance regression testing
- Hardware capacity planning

### CI Integration

Performance tests run in nightly CI jobs with trend tracking:
- Detect performance regressions (> 10% slower)
- Track memory growth over time
- Alert on threshold violations
- **Note:** Full dataset benchmarks excluded from CI (manual execution only)

### Test Data

Performance tests use production-scale datasets:
- Real TIGERweb API responses (cached for determinism)
- Full-scale GeoJSON files (50 states, ~50k boundaries)
- Representative query patterns

### Profiling Tools

**Memory profiling:**
```bash
node --expose-gc --max-old-space-size=4096 \
  node_modules/vitest/vitest.mjs run \
  --config vitest.performance.config.ts \
  __tests__/performance/memory-profiling.test.ts
```

**CPU profiling:**
```bash
node --prof node_modules/vitest/vitest.mjs run \
  --config vitest.performance.config.ts \
  __tests__/performance/latency-benchmarks.test.ts
```

### Performance Test Structure

Each performance test follows this pattern:

```typescript
import { describe, it, expect } from 'vitest';
import { measureLatency, measureMemory, measureThroughput } from '../utils/performance.js';

describe('Performance: Extraction', () => {
  it('should extract Wisconsin in < 30 seconds', async () => {
    const result = await measureLatency(() => extractState('WI'));

    expect(result.durationMs).toBeLessThan(30_000);
    expect(result.memoryUsedMB).toBeLessThan(100);
  });
});
```

### Continuous Monitoring

Performance metrics are tracked over time:
- Daily baseline updates
- Regression detection
- Performance trend graphs
- Historical comparison

See individual test files for detailed benchmarks.
