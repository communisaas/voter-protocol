## Performance Testing Infrastructure

Shadow Atlas performance tests for load testing, latency benchmarking, and throughput analysis.

### Test Categories

**Load Testing**: Test system behavior under high concurrent load
**Latency Benchmarks**: Measure operation latency across different scenarios
**Memory Profiling**: Track memory usage during large operations
**Throughput Tests**: Measure data processing throughput

### Running Performance Tests

```bash
# Run all performance tests
npm run test:atlas:performance

# Run specific performance test category
npm run test:atlas:performance -- --grep="Load Testing"
npm run test:atlas:performance -- --grep="Latency"
npm run test:atlas:performance -- --grep="Memory"
npm run test:atlas:performance -- --grep="Throughput"
```

### Performance Baselines

**Target Metrics:**
- Single state extraction: < 30 seconds
- Batch extraction (10 states): < 5 minutes
- Merkle tree build (50 states): < 60 seconds
- Point-in-polygon lookup: < 100ms (cold), < 10ms (warm)
- Database write (1000 boundaries): < 5 seconds

**Memory Constraints:**
- Peak memory for full US extraction: < 2GB
- Merkle tree build (all states): < 500MB
- Per-state extraction: < 100MB

### CI Integration

Performance tests run in nightly CI jobs with trend tracking:
- Detect performance regressions (> 10% slower)
- Track memory growth over time
- Alert on threshold violations

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
  --config vitest.shadow-atlas.config.ts \
  __tests__/performance/memory-profiling.test.ts
```

**CPU profiling:**
```bash
node --prof node_modules/vitest/vitest.mjs run \
  --config vitest.shadow-atlas.config.ts \
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
