/**
 * Shadow Atlas Performance Optimization Layer
 *
 * Exports all performance optimization components for global scale.
 *
 * Architecture:
 * - HierarchicalRTree: Country-level partitioning with lazy loading
 * - RegionalCache: Three-tier caching (L1/L2/L3)
 * - BatchOptimizer: Locality grouping and parallel PIP testing
 * - PreloadStrategy: Predictive preloading based on traffic patterns
 *
 * Performance targets:
 * - p50: <20ms, p95: <50ms, p99: <100ms
 * - 10,000 req/sec sustained throughput
 * - <2GB memory for global index
 *
 * Usage:
 * ```typescript
 * import {
 *   HierarchicalRTree,
 *   RegionalCache,
 *   BatchOptimizer,
 *   PreloadStrategy,
 * } from './serving/performance';
 * ```
 */

export {
  HierarchicalRTree,
  type HierarchicalRTreeConfig,
  type HierarchicalRTreeMetrics,
} from './hierarchical-rtree';

export {
  RegionalCache,
  type RegionalCacheConfig,
  type RegionalCacheMetrics,
} from './regional-cache';

export {
  BatchOptimizer,
  type BatchOptimizerConfig,
  type BatchOptimizerMetrics,
  type CoordinateLookup,
  type BatchLookupResult,
  type LookupFunction,
} from './batch-optimizer';

export {
  PreloadStrategy,
  type PreloadStrategyConfig,
  type PreloadStrategyMetrics,
  type PreloadTarget,
  type TrafficPattern,
  type PreloadEvent,
  PreloadPriority,
  US_METRO_PRELOAD_TARGETS,
} from './preload-strategy';
