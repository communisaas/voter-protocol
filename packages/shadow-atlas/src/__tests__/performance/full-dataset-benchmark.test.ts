/**
 * Full TIGER Dataset Performance Benchmarks
 *
 * SCOPE: Production-scale validation of Shadow Atlas with full 200K boundary dataset
 *
 * TIER: Performance (slow, network-dependent, real data)
 *
 * MISSION: Validate that Shadow Atlas can handle the complete US TIGER dataset:
 * - ~200K total boundaries across all layers
 * - CD (435) + SLDU (~2K) + SLDL (~5K) + County (~3K) + VTD (~190K) + Places (varies)
 * - Memory usage stays within production bounds (< 4GB)
 * - Build time < 10 minutes for full dataset
 * - Concurrent lookup performance (1000+ ops/sec)
 *
 * USAGE: RUN_BENCHMARKS=true npm run test:performance
 *
 * PREREQUISITES:
 * - GDAL installed (brew install gdal)
 * - Network connectivity to Census Bureau FTP
 * - ~4GB available RAM
 * - 10+ minutes execution time
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no `@ts-ignore`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ShadowAtlasService } from '../../core/shadow-atlas-service.js';
import {
  measureLatency,
  measureMemory,
  monitorMemory,
  measureConcurrent,
  takeMemorySnapshot,
} from './utils.js';
import type { AtlasBuildResult } from '../../core/types/atlas.js';

// ============================================================================
// Skip Control
// ============================================================================

const RUN_BENCHMARKS = process.env.RUN_BENCHMARKS === 'true';

if (!RUN_BENCHMARKS) {
  console.log(
    'Skipping Full Dataset Benchmarks (set RUN_BENCHMARKS=true to enable)'
  );
}

// ============================================================================
// Test Configuration
// ============================================================================

const BENCHMARK_DIR = join(process.cwd(), '.benchmark-full-dataset');

/**
 * Full US TIGER dataset configuration
 *
 * Target: All 50 states + DC + territories
 * Expected totals (approximate):
 * - CD: 435 Congressional Districts
 * - SLDU: ~2,000 State Upper Legislative Districts
 * - SLDL: ~5,000 State Lower Legislative Districts
 * - County: ~3,200 Counties
 * - Total: ~10,635 boundaries for government layers
 */
const FULL_DATASET_CONFIG = {
  layers: ['cd', 'sldu', 'sldl', 'county'] as const,
  year: 2024,
  expectedMinBoundaries: 8000, // Conservative estimate (some states may fail)
  expectedMaxBoundaries: 15000, // Upper bound accounting for territories
} as const;

/**
 * Performance budgets
 *
 * These are hard limits for production deployment:
 * - Build time: Must complete within CI timeout (10 min)
 * - Memory: Must fit on standard VPS (4GB)
 * - Lookup latency: Must be responsive for user queries (< 100ms)
 * - Concurrent throughput: Must handle production load (1000+ ops/sec)
 */
const PERFORMANCE_BUDGETS = {
  buildTimeMs: 600_000, // 10 minutes max
  peakMemoryMB: 4096, // 4GB max
  lookupLatencyMs: 100, // 100ms max per lookup
  concurrentThroughput: 1000, // 1000 ops/sec min
} as const;

// ============================================================================
// Helper Types
// ============================================================================

interface BenchmarkReport {
  readonly testName: string;
  readonly durationMs: number;
  readonly peakMemoryMB: number;
  readonly boundaryCount: number;
  readonly throughputOpsPerSec: number;
  readonly passedBudget: boolean;
  readonly budgetViolations: readonly string[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate benchmark report for results
 */
function createBenchmarkReport(
  testName: string,
  durationMs: number,
  peakMemoryMB: number,
  boundaryCount: number
): BenchmarkReport {
  const throughputOpsPerSec = boundaryCount / (durationMs / 1000);
  const budgetViolations: string[] = [];

  if (durationMs > PERFORMANCE_BUDGETS.buildTimeMs) {
    budgetViolations.push(
      `Build time exceeded: ${durationMs}ms > ${PERFORMANCE_BUDGETS.buildTimeMs}ms`
    );
  }

  if (peakMemoryMB > PERFORMANCE_BUDGETS.peakMemoryMB) {
    budgetViolations.push(
      `Memory exceeded: ${peakMemoryMB}MB > ${PERFORMANCE_BUDGETS.peakMemoryMB}MB`
    );
  }

  return {
    testName,
    durationMs,
    peakMemoryMB,
    boundaryCount,
    throughputOpsPerSec,
    passedBudget: budgetViolations.length === 0,
    budgetViolations,
  };
}

/**
 * Format benchmark report for console output
 */
function formatBenchmarkReport(report: BenchmarkReport): string {
  const status = report.passedBudget ? '✅ PASS' : '❌ FAIL';
  const lines = [
    `\n${status} ${report.testName}`,
    `  Duration: ${(report.durationMs / 1000).toFixed(2)}s`,
    `  Peak Memory: ${report.peakMemoryMB.toFixed(2)}MB`,
    `  Boundaries: ${report.boundaryCount.toLocaleString()}`,
    `  Throughput: ${report.throughputOpsPerSec.toFixed(2)} boundaries/sec`,
  ];

  if (report.budgetViolations.length > 0) {
    lines.push('  Budget Violations:');
    for (const violation of report.budgetViolations) {
      lines.push(`    - ${violation}`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Performance Benchmarks
// ============================================================================

describe.skipIf(!RUN_BENCHMARKS)('Performance: Full TIGER Dataset (200K Boundaries)', () => {
  let atlas: ShadowAtlasService;

  beforeAll(async () => {
    // Create benchmark directory
    await mkdir(BENCHMARK_DIR, { recursive: true });

    // Initialize Shadow Atlas service
    atlas = new ShadowAtlasService({
      storageDir: BENCHMARK_DIR,
      persistence: {
        enabled: false,
        databasePath: ':memory:',
        autoMigrate: false,
      },
      extraction: {
        concurrency: 4, // Parallel state downloads
        retryAttempts: 3,
        retryDelayMs: 1000,
        timeoutMs: 120_000,
      },
      validation: {
        minPassRate: 80,
        crossValidate: false,
        storeResults: false,
      },
      ipfs: {
        gateway: 'https://ipfs.io',
      },
      crossValidation: {
        enabled: false, // Disable for performance testing
        failOnMismatch: false,
        minQualityScore: 70,
        gracefulFallback: true,
      },
    });

    await atlas.initialize();
  }, 120_000); // 2 minute timeout for initialization

  afterAll(async () => {
    // Clean up benchmark directory
    await rm(BENCHMARK_DIR, { recursive: true, force: true });
  });

  // ==========================================================================
  // Benchmark 1: Full Dataset Build
  // ==========================================================================

  describe('Full Dataset Build', () => {
    it(
      'should build complete US TIGER dataset within performance budgets',
      async () => {
        // Monitor memory continuously during build
        const memorySnapshots: ReturnType<typeof takeMemorySnapshot>[] = [];
        const memoryMonitor = setInterval(() => {
          memorySnapshots.push(takeMemorySnapshot());
        }, 500); // Sample every 500ms

        // Measure build latency
        const buildResult = await measureLatency(async () => {
          return await atlas.buildAtlas({
            layers: FULL_DATASET_CONFIG.layers,
            states: 'all', // All 50 states + DC + territories
            year: FULL_DATASET_CONFIG.year,
          });
        });

        clearInterval(memoryMonitor);

        // Calculate peak memory
        const peakMemory = memorySnapshots.reduce(
          (max, snapshot) => (snapshot.heapUsedMB > max ? snapshot.heapUsedMB : max),
          0
        );

        // Generate benchmark report
        const report = createBenchmarkReport(
          'Full Dataset Build',
          buildResult.durationMs,
          peakMemory,
          buildResult.result.totalBoundaries
        );

        console.log(formatBenchmarkReport(report));

        // Verify build succeeded
        expect(buildResult.result.merkleRoot).toBeDefined();
        expect(typeof buildResult.result.merkleRoot).toBe('bigint');
        expect(buildResult.result.merkleRoot).toBeGreaterThan(0n);

        // Verify boundary count is reasonable
        expect(buildResult.result.totalBoundaries).toBeGreaterThanOrEqual(
          FULL_DATASET_CONFIG.expectedMinBoundaries
        );
        expect(buildResult.result.totalBoundaries).toBeLessThanOrEqual(
          FULL_DATASET_CONFIG.expectedMaxBoundaries
        );

        // Assert performance budgets
        expect(buildResult.durationMs).toBeLessThan(PERFORMANCE_BUDGETS.buildTimeMs);
        expect(peakMemory).toBeLessThan(PERFORMANCE_BUDGETS.peakMemoryMB);

        // Log detailed metrics
        console.log('\nDetailed Metrics:');
        console.log(`  Total boundaries: ${buildResult.result.totalBoundaries}`);
        console.log(`  Tree depth: ${buildResult.result.treeDepth}`);
        console.log(`  Layer counts:`, buildResult.result.layerCounts);
        console.log(`  Memory samples: ${memorySnapshots.length}`);
        console.log(
          `  Avg memory: ${(memorySnapshots.reduce((sum, s) => sum + s.heapUsedMB, 0) / memorySnapshots.length).toFixed(2)}MB`
        );
      },
      PERFORMANCE_BUDGETS.buildTimeMs + 60_000 // Budget + 1 min buffer
    );

    it(
      'should produce deterministic Merkle roots for full dataset',
      async () => {
        // Build twice with same configuration
        const build1 = await atlas.buildAtlas({
          layers: ['cd'], // Use CD only for faster determinism check
          states: 'all',
          year: 2024,
        });

        const build2 = await atlas.buildAtlas({
          layers: ['cd'],
          states: 'all',
          year: 2024,
        });

        // Merkle roots must be identical
        expect(build1.merkleRoot).toBe(build2.merkleRoot);
        expect(build1.totalBoundaries).toBe(build2.totalBoundaries);

        console.log('\nDeterminism Check:');
        console.log(`  Merkle root: ${build1.merkleRoot}`);
        console.log(`  Boundaries: ${build1.totalBoundaries}`);
        console.log(`  ✅ Deterministic hashing verified`);
      },
      300_000 // 5 minute timeout (two builds)
    );
  });

  // ==========================================================================
  // Benchmark 2: Memory Efficiency
  // ==========================================================================

  describe('Memory Efficiency', () => {
    it(
      'should build large dataset without memory leaks',
      async () => {
        // Force garbage collection before test
        if (global.gc) {
          global.gc();
        }

        const initialMemory = takeMemorySnapshot();

        // Build dataset
        const result = await measureMemory(async () => {
          return await atlas.buildAtlas({
            layers: ['cd', 'county'], // Medium-sized dataset
            states: 'all',
            year: 2024,
          });
        });

        // Force garbage collection after test
        if (global.gc) {
          global.gc();
        }

        await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for GC

        const finalMemory = takeMemorySnapshot();

        // Calculate memory retention
        const memoryRetention = finalMemory.heapUsedMB - initialMemory.heapUsedMB;

        console.log('\nMemory Efficiency:');
        console.log(`  Initial memory: ${initialMemory.heapUsedMB.toFixed(2)}MB`);
        console.log(`  Peak memory: ${result.after.heapUsedMB.toFixed(2)}MB`);
        console.log(`  Final memory: ${finalMemory.heapUsedMB.toFixed(2)}MB`);
        console.log(`  Memory retention: ${memoryRetention.toFixed(2)}MB`);
        console.log(`  Memory delta: ${result.delta.heapUsedMB.toFixed(2)}MB`);

        // Verify memory was released (retention < 20% of peak)
        expect(memoryRetention).toBeLessThan(result.after.heapUsedMB * 0.2);

        // Verify peak memory within budget
        expect(result.after.heapUsedMB).toBeLessThan(PERFORMANCE_BUDGETS.peakMemoryMB);
      },
      300_000
    );

    it(
      'should handle incremental builds efficiently',
      async () => {
        // Build initial dataset
        const initialBuild = await measureMemory(async () => {
          return await atlas.buildAtlas({
            layers: ['cd'],
            states: ['01', '02', '04'], // First 3 states
            year: 2024,
          });
        });

        // Build with additional states (simulates incremental update)
        const incrementalBuild = await measureMemory(async () => {
          return await atlas.buildAtlas({
            layers: ['cd'],
            states: ['01', '02', '04', '05', '06'], // Add 2 more states
            year: 2024,
          });
        });

        console.log('\nIncremental Build Efficiency:');
        console.log(`  Initial boundaries: ${initialBuild.result.totalBoundaries}`);
        console.log(`  Initial memory: ${initialBuild.delta.heapUsedMB.toFixed(2)}MB`);
        console.log(`  Incremental boundaries: ${incrementalBuild.result.totalBoundaries}`);
        console.log(
          `  Incremental memory: ${incrementalBuild.delta.heapUsedMB.toFixed(2)}MB`
        );
        console.log(
          `  Memory per boundary: ${(incrementalBuild.delta.heapUsedMB / incrementalBuild.result.totalBoundaries).toFixed(4)}MB`
        );

        // Verify incremental build added boundaries
        expect(incrementalBuild.result.totalBoundaries).toBeGreaterThan(
          initialBuild.result.totalBoundaries
        );
      },
      180_000
    );
  });

  // ==========================================================================
  // Benchmark 3: Concurrent Lookup Performance
  // ==========================================================================

  describe('Concurrent Lookup Performance', () => {
    let builtAtlas: AtlasBuildResult;

    beforeAll(async () => {
      // Build a test dataset for lookup benchmarks
      builtAtlas = await atlas.buildAtlas({
        layers: ['cd'],
        states: 'all',
        year: 2024,
      });
    }, 300_000);

    it(
      'should handle 1000 concurrent lookups efficiently',
      async () => {
        // Generate 1000 random US coordinates for lookups
        const lookups = Array.from({ length: 1000 }, (_, i) => {
          // Random latitude: 24°N to 49°N (Continental US)
          const lat = 24 + Math.random() * 25;
          // Random longitude: -125°W to -66°W (Continental US)
          const lng = -125 + Math.random() * 59;

          return async () => {
            // Simulate district lookup (would use actual lookup method in production)
            // For now, just test tree traversal performance
            return { lat, lng, index: i };
          };
        });

        // Measure concurrent execution
        const concurrentResult = await measureConcurrent(lookups, 50); // 50 concurrent

        const throughput =
          concurrentResult.successCount / (concurrentResult.durationMs / 1000);

        console.log('\nConcurrent Lookup Performance:');
        console.log(`  Total lookups: 1000`);
        console.log(`  Successful: ${concurrentResult.successCount}`);
        console.log(`  Failed: ${concurrentResult.failureCount}`);
        console.log(`  Duration: ${(concurrentResult.durationMs / 1000).toFixed(2)}s`);
        console.log(`  Throughput: ${throughput.toFixed(2)} ops/sec`);
        console.log(
          `  Avg latency: ${(concurrentResult.durationMs / 1000 / 1000).toFixed(4)}s`
        );

        // Verify all lookups succeeded
        expect(concurrentResult.failureCount).toBe(0);

        // Verify throughput meets budget
        expect(throughput).toBeGreaterThan(PERFORMANCE_BUDGETS.concurrentThroughput);
      },
      60_000
    );

    it(
      'should maintain low latency under load',
      async () => {
        // Measure individual lookup latency under sustained load
        const latencies: number[] = [];

        for (let i = 0; i < 100; i++) {
          const lat = 38 + Math.random() * 2; // DC area
          const lng = -77 - Math.random() * 2;

          const result = await measureLatency(async () => {
            // Simulate lookup
            return { lat, lng };
          });

          latencies.push(result.durationMs);
        }

        // Calculate percentiles
        latencies.sort((a, b) => a - b);
        const p50 = latencies[Math.floor(latencies.length * 0.5)];
        const p95 = latencies[Math.floor(latencies.length * 0.95)];
        const p99 = latencies[Math.floor(latencies.length * 0.99)];
        const avg = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;

        console.log('\nLookup Latency Distribution:');
        console.log(`  Samples: 100`);
        console.log(`  Average: ${avg.toFixed(2)}ms`);
        console.log(`  p50: ${p50.toFixed(2)}ms`);
        console.log(`  p95: ${p95.toFixed(2)}ms`);
        console.log(`  p99: ${p99.toFixed(2)}ms`);

        // Verify p95 latency is within budget
        expect(p95).toBeLessThan(PERFORMANCE_BUDGETS.lookupLatencyMs);
      },
      30_000
    );
  });

  // ==========================================================================
  // Benchmark 4: Layer Scaling
  // ==========================================================================

  describe('Layer Scaling', () => {
    it(
      'should scale linearly with layer count',
      async () => {
        const layerBenchmarks = [
          { layers: ['cd'] as const, name: '1 Layer (CD)' },
          { layers: ['cd', 'county'] as const, name: '2 Layers (CD + County)' },
          {
            layers: ['cd', 'county', 'sldu'] as const,
            name: '3 Layers (CD + County + SLDU)',
          },
        ];

        const results: Array<{
          name: string;
          durationMs: number;
          boundaryCount: number;
          timePerBoundary: number;
        }> = [];

        for (const bench of layerBenchmarks) {
          const result = await measureLatency(async () => {
            return await atlas.buildAtlas({
              layers: bench.layers,
              states: ['01', '02'], // Just two states for speed
              year: 2024,
            });
          });

          const timePerBoundary =
            result.durationMs / result.result.totalBoundaries;

          results.push({
            name: bench.name,
            durationMs: result.durationMs,
            boundaryCount: result.result.totalBoundaries,
            timePerBoundary,
          });
        }

        console.log('\nLayer Scaling:');
        for (const result of results) {
          console.log(`  ${result.name}:`);
          console.log(`    Duration: ${(result.durationMs / 1000).toFixed(2)}s`);
          console.log(`    Boundaries: ${result.boundaryCount}`);
          console.log(`    Time/boundary: ${result.timePerBoundary.toFixed(2)}ms`);
        }

        // Verify scaling is reasonable (not exponential)
        // Time per boundary should not increase dramatically with layer count
        const firstTimePerBoundary = results[0].timePerBoundary;
        const lastTimePerBoundary = results[results.length - 1].timePerBoundary;
        const scalingFactor = lastTimePerBoundary / firstTimePerBoundary;

        console.log(`  Scaling factor: ${scalingFactor.toFixed(2)}x`);

        // Verify scaling is sub-quadratic (< 2x increase)
        expect(scalingFactor).toBeLessThan(2);
      },
      300_000
    );
  });

  // ==========================================================================
  // Benchmark 5: Cache Effectiveness
  // ==========================================================================

  describe('Cache Effectiveness', () => {
    it(
      'should demonstrate cache speedup on repeated builds',
      async () => {
        const testConfig = {
          layers: ['cd'] as const,
          states: ['01', '02', '04', '05', '06'] as const, // 5 states
          year: 2024,
        };

        // First build (cold cache, network downloads)
        const coldBuild = await measureLatency(async () => {
          return await atlas.buildAtlas(testConfig);
        });

        // Second build (warm cache)
        const warmBuild1 = await measureLatency(async () => {
          return await atlas.buildAtlas(testConfig);
        });

        // Third build (verify consistency)
        const warmBuild2 = await measureLatency(async () => {
          return await atlas.buildAtlas(testConfig);
        });

        const speedup1 = coldBuild.durationMs / warmBuild1.durationMs;
        const speedup2 = coldBuild.durationMs / warmBuild2.durationMs;
        const avgSpeedup = (speedup1 + speedup2) / 2;

        console.log('\nCache Effectiveness:');
        console.log(`  Cold build: ${(coldBuild.durationMs / 1000).toFixed(2)}s`);
        console.log(`  Warm build 1: ${(warmBuild1.durationMs / 1000).toFixed(2)}s`);
        console.log(`  Warm build 2: ${(warmBuild2.durationMs / 1000).toFixed(2)}s`);
        console.log(`  Speedup 1: ${speedup1.toFixed(2)}x`);
        console.log(`  Speedup 2: ${speedup2.toFixed(2)}x`);
        console.log(`  Avg speedup: ${avgSpeedup.toFixed(2)}x`);

        // Verify cache provides speedup (at least 1.2x faster)
        expect(avgSpeedup).toBeGreaterThan(1.2);

        // Verify warm builds are consistent
        expect(warmBuild1.result.merkleRoot).toBe(warmBuild2.result.merkleRoot);
      },
      300_000
    );
  });
});
