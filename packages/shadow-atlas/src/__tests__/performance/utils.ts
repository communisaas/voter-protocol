/**
 * Performance Testing Utilities
 *
 * SCOPE: Utilities for measuring latency, memory, and throughput
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no `@ts-ignore`.
 */

// ============================================================================
// Latency Measurement
// ============================================================================

export interface LatencyResult {
  readonly durationMs: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly memoryUsedMB: number;
}

/**
 * Measure latency of an async operation
 */
export async function measureLatency<T>(
  operation: () => Promise<T>
): Promise<LatencyResult & { result: T }> {
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }

  const startMemory = process.memoryUsage().heapUsed;
  const startTime = performance.now();

  const result = await operation();

  const endTime = performance.now();
  const endMemory = process.memoryUsage().heapUsed;

  const durationMs = endTime - startTime;
  const memoryUsedMB = (endMemory - startMemory) / 1024 / 1024;

  return {
    result,
    durationMs,
    startTime,
    endTime,
    memoryUsedMB,
  };
}

/**
 * Measure latency of multiple iterations and return statistics
 */
export async function measureLatencyStats<T>(
  operation: () => Promise<T>,
  iterations: number
): Promise<{
  readonly mean: number;
  readonly median: number;
  readonly p95: number;
  readonly p99: number;
  readonly min: number;
  readonly max: number;
  readonly stdDev: number;
}> {
  const durations: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const result = await measureLatency(operation);
    durations.push(result.durationMs);
  }

  durations.sort((a, b) => a - b);

  const mean = durations.reduce((sum, d) => sum + d, 0) / durations.length;
  const median = durations[Math.floor(durations.length / 2)];
  const p95 = durations[Math.floor(durations.length * 0.95)];
  const p99 = durations[Math.floor(durations.length * 0.99)];
  const min = durations[0];
  const max = durations[durations.length - 1];

  const variance =
    durations.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / durations.length;
  const stdDev = Math.sqrt(variance);

  return {
    mean,
    median,
    p95,
    p99,
    min,
    max,
    stdDev,
  };
}

// ============================================================================
// Memory Measurement
// ============================================================================

export interface MemorySnapshot {
  readonly heapUsedMB: number;
  readonly heapTotalMB: number;
  readonly externalMB: number;
  readonly arrayBuffersMB: number;
  readonly timestamp: number;
}

/**
 * Take a memory snapshot
 */
export function takeMemorySnapshot(): MemorySnapshot {
  const mem = process.memoryUsage();

  return {
    heapUsedMB: mem.heapUsed / 1024 / 1024,
    heapTotalMB: mem.heapTotal / 1024 / 1024,
    externalMB: mem.external / 1024 / 1024,
    arrayBuffersMB: mem.arrayBuffers / 1024 / 1024,
    timestamp: performance.now(),
  };
}

/**
 * Measure memory growth during operation
 */
export async function measureMemory<T>(
  operation: () => Promise<T>
): Promise<{
  readonly result: T;
  readonly before: MemorySnapshot;
  readonly after: MemorySnapshot;
  readonly delta: {
    readonly heapUsedMB: number;
    readonly heapTotalMB: number;
    readonly externalMB: number;
    readonly arrayBuffersMB: number;
  };
}> {
  // Force garbage collection
  if (global.gc) {
    global.gc();
  }

  const before = takeMemorySnapshot();

  const result = await operation();

  const after = takeMemorySnapshot();

  return {
    result,
    before,
    after,
    delta: {
      heapUsedMB: after.heapUsedMB - before.heapUsedMB,
      heapTotalMB: after.heapTotalMB - before.heapTotalMB,
      externalMB: after.externalMB - before.externalMB,
      arrayBuffersMB: after.arrayBuffersMB - before.arrayBuffersMB,
    },
  };
}

/**
 * Monitor memory usage over time during operation
 */
export async function monitorMemory<T>(
  operation: () => Promise<T>,
  intervalMs: number = 100
): Promise<{
  readonly result: T;
  readonly snapshots: readonly MemorySnapshot[];
  readonly peak: MemorySnapshot;
}> {
  const snapshots: MemorySnapshot[] = [];
  let isRunning = true;

  // Start monitoring
  const monitor = setInterval(() => {
    if (isRunning) {
      snapshots.push(takeMemorySnapshot());
    }
  }, intervalMs);

  try {
    const result = await operation();
    isRunning = false;
    clearInterval(monitor);

    // Find peak memory
    const peak = snapshots.reduce((max, snapshot) =>
      snapshot.heapUsedMB > max.heapUsedMB ? snapshot : max
    );

    return {
      result,
      snapshots,
      peak,
    };
  } catch (error) {
    isRunning = false;
    clearInterval(monitor);
    throw error;
  }
}

// ============================================================================
// Throughput Measurement
// ============================================================================

export interface ThroughputResult {
  readonly itemsProcessed: number;
  readonly durationMs: number;
  readonly itemsPerSecond: number;
  readonly bytesProcessed: number;
  readonly bytesPerSecond: number;
}

/**
 * Measure throughput of data processing operation
 */
export async function measureThroughput<T>(
  operation: () => Promise<T>,
  itemCount: number,
  bytesProcessed: number = 0
): Promise<ThroughputResult & { result: T }> {
  const startTime = performance.now();

  const result = await operation();

  const endTime = performance.now();
  const durationMs = endTime - startTime;
  const durationSec = durationMs / 1000;

  const itemsPerSecond = itemCount / durationSec;
  const bytesPerSecond = bytesProcessed / durationSec;

  return {
    result,
    itemsProcessed: itemCount,
    durationMs,
    itemsPerSecond,
    bytesProcessed,
    bytesPerSecond,
  };
}

// ============================================================================
// Load Testing
// ============================================================================

export interface ConcurrentResult<T> {
  readonly results: readonly T[];
  readonly durationMs: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly errors: readonly Error[];
}

/**
 * Execute operations concurrently and measure performance
 */
export async function measureConcurrent<T>(
  operations: readonly (() => Promise<T>)[],
  concurrency: number = 10
): Promise<ConcurrentResult<T>> {
  const startTime = performance.now();

  const results: T[] = [];
  const errors: Error[] = [];
  let successCount = 0;
  let failureCount = 0;

  // Execute in batches
  for (let i = 0; i < operations.length; i += concurrency) {
    const batch = operations.slice(i, i + concurrency);

    const batchResults = await Promise.allSettled(batch.map((op) => op()));

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
        successCount++;
      } else {
        errors.push(result.reason as Error);
        failureCount++;
      }
    }
  }

  const endTime = performance.now();
  const durationMs = endTime - startTime;

  return {
    results,
    durationMs,
    successCount,
    failureCount,
    errors,
  };
}

// ============================================================================
// Benchmarking
// ============================================================================

export interface BenchmarkResult {
  readonly name: string;
  readonly iterations: number;
  readonly totalDurationMs: number;
  readonly avgDurationMs: number;
  readonly minDurationMs: number;
  readonly maxDurationMs: number;
  readonly opsPerSecond: number;
}

/**
 * Run a benchmark with multiple iterations
 */
export async function benchmark(
  name: string,
  operation: () => Promise<void>,
  iterations: number = 100
): Promise<BenchmarkResult> {
  const durations: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await operation();
    const end = performance.now();
    durations.push(end - start);
  }

  const totalDurationMs = durations.reduce((sum, d) => sum + d, 0);
  const avgDurationMs = totalDurationMs / iterations;
  const minDurationMs = Math.min(...durations);
  const maxDurationMs = Math.max(...durations);
  const opsPerSecond = 1000 / avgDurationMs;

  return {
    name,
    iterations,
    totalDurationMs,
    avgDurationMs,
    minDurationMs,
    maxDurationMs,
    opsPerSecond,
  };
}

/**
 * Run multiple benchmarks and compare results
 */
export async function compareBenchmarks(
  benchmarks: readonly {
    readonly name: string;
    readonly operation: () => Promise<void>;
    readonly iterations?: number;
  }[]
): Promise<readonly BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  for (const bench of benchmarks) {
    const result = await benchmark(
      bench.name,
      bench.operation,
      bench.iterations ?? 100
    );
    results.push(result);
  }

  return results;
}

// ============================================================================
// Performance Assertions
// ============================================================================

/**
 * Assert that operation completes within time budget
 */
export function assertWithinTimeBudget(
  actualMs: number,
  budgetMs: number,
  name: string = 'Operation'
): void {
  if (actualMs > budgetMs) {
    throw new Error(
      `${name} exceeded time budget: ${actualMs.toFixed(2)}ms > ${budgetMs}ms`
    );
  }
}

/**
 * Assert that memory usage is within budget
 */
export function assertWithinMemoryBudget(
  actualMB: number,
  budgetMB: number,
  name: string = 'Operation'
): void {
  if (actualMB > budgetMB) {
    throw new Error(
      `${name} exceeded memory budget: ${actualMB.toFixed(2)}MB > ${budgetMB}MB`
    );
  }
}

/**
 * Assert that throughput meets minimum requirement
 */
export function assertMinimumThroughput(
  actualItemsPerSec: number,
  minimumItemsPerSec: number,
  name: string = 'Operation'
): void {
  if (actualItemsPerSec < minimumItemsPerSec) {
    throw new Error(
      `${name} below minimum throughput: ${actualItemsPerSec.toFixed(
        2
      )} items/sec < ${minimumItemsPerSec} items/sec`
    );
  }
}
