/**
 * Health Monitoring Service
 *
 * Tracks performance metrics for observability:
 * - Query latency (p50, p95, p99)
 * - Cache hit rate
 * - Snapshot freshness
 * - Error rate
 *
 * Provides /health endpoint for load balancers and monitoring systems.
 *
 * PRODUCTION READY: Prometheus-compatible metrics export.
 */

import type { HealthMetrics, QueryMetrics, CacheMetrics, SnapshotMetrics, ErrorMetrics, ErrorSample } from './types';

/**
 * Health monitoring service
 */
export class HealthMonitor {
  private startTime: number;
  private queryCount = 0;
  private successCount = 0;
  private errorCount = 0;
  private latencies: number[] = [];
  private errors: ErrorSample[] = [];

  // Cache metrics
  private cacheHits = 0;
  private cacheMisses = 0;
  private cacheEvictions = 0;
  private cacheSize = 0;

  // Snapshot metrics
  private currentCid = '';
  private merkleRoot = '';
  private districtCount = 0;
  private snapshotTimestamp = 0;
  private nextCheckTimestamp = 0;

  // Time windows for error tracking
  private readonly ERROR_WINDOW_5M = 5 * 60 * 1000;
  private readonly ERROR_WINDOW_1H = 60 * 60 * 1000;
  private readonly ERROR_WINDOW_24H = 24 * 60 * 60 * 1000;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Record successful query
   */
  recordQuery(latencyMs: number, cacheHit: boolean): void {
    this.queryCount++;
    this.successCount++;
    this.latencies.push(latencyMs);

    if (cacheHit) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }

    // Keep last 10,000 latencies for accurate percentiles
    if (this.latencies.length > 10000) {
      this.latencies.shift();
    }
  }

  /**
   * Record failed query
   */
  recordError(error: string, lat?: number, lon?: number): void {
    this.queryCount++;
    this.errorCount++;

    const errorSample: ErrorSample = {
      timestamp: Date.now(),
      error,
      lat,
      lon,
    };

    this.errors.push(errorSample);

    // Keep last 1000 errors
    if (this.errors.length > 1000) {
      this.errors.shift();
    }
  }

  /**
   * Record cache eviction
   */
  recordCacheEviction(): void {
    this.cacheEvictions++;
  }

  /**
   * Update cache size
   */
  updateCacheSize(size: number): void {
    this.cacheSize = size;
  }

  /**
   * Update snapshot metadata
   */
  updateSnapshot(cid: string, merkleRoot: string, districtCount: number, timestamp: number): void {
    this.currentCid = cid;
    this.merkleRoot = merkleRoot;
    this.districtCount = districtCount;
    this.snapshotTimestamp = timestamp;
  }

  /**
   * Update next sync check time
   */
  updateNextCheck(timestamp: number): void {
    this.nextCheckTimestamp = timestamp;
  }

  /**
   * Get comprehensive health metrics
   */
  getMetrics(): HealthMetrics {
    const now = Date.now();
    const uptime = (now - this.startTime) / 1000;

    // Calculate query metrics
    const queries: QueryMetrics = {
      total: this.queryCount,
      successful: this.successCount,
      failed: this.errorCount,
      latencyP50: this.calculatePercentile(0.5),
      latencyP95: this.calculatePercentile(0.95),
      latencyP99: this.calculatePercentile(0.99),
      throughput: uptime > 0 ? this.queryCount / uptime : 0,
    };

    // Calculate cache metrics
    const cache: CacheMetrics = {
      size: this.cacheSize,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: this.cacheHits + this.cacheMisses > 0 ? this.cacheHits / (this.cacheHits + this.cacheMisses) : 0,
      evictions: this.cacheEvictions,
    };

    // Calculate snapshot metrics
    const snapshot: SnapshotMetrics = {
      currentCid: this.currentCid,
      merkleRoot: this.merkleRoot,
      districtCount: this.districtCount,
      ageSeconds: this.snapshotTimestamp > 0 ? (now - this.snapshotTimestamp) / 1000 : 0,
      nextCheckSeconds: this.nextCheckTimestamp > 0 ? Math.max(0, (this.nextCheckTimestamp - now) / 1000) : 0,
    };

    // Calculate error metrics
    const errorMetrics: ErrorMetrics = {
      last5m: this.countErrorsInWindow(this.ERROR_WINDOW_5M),
      last1h: this.countErrorsInWindow(this.ERROR_WINDOW_1H),
      last24h: this.countErrorsInWindow(this.ERROR_WINDOW_24H),
      recentErrors: this.errors.slice(-10), // Last 10 errors
    };

    // Determine overall health status
    const status = this.determineHealthStatus(queries, cache, snapshot, errorMetrics);

    return {
      status,
      uptime,
      queries,
      cache,
      snapshot,
      errors: errorMetrics,
      timestamp: now,
    };
  }

  /**
   * Calculate latency percentile
   */
  private calculatePercentile(p: number): number {
    if (this.latencies.length === 0) {
      return 0;
    }

    const sorted = [...this.latencies].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Count errors within time window
   */
  private countErrorsInWindow(windowMs: number): number {
    const cutoff = Date.now() - windowMs;
    return this.errors.filter((e) => e.timestamp >= cutoff).length;
  }

  /**
   * Determine overall health status
   */
  private determineHealthStatus(
    queries: QueryMetrics,
    cache: CacheMetrics,
    snapshot: SnapshotMetrics,
    errors: ErrorMetrics
  ): 'healthy' | 'degraded' | 'unhealthy' {
    // Unhealthy conditions
    if (errors.last5m > 50) {
      return 'unhealthy'; // >50 errors in 5 minutes
    }
    if (queries.latencyP99 > 500) {
      return 'unhealthy'; // p99 latency >500ms
    }
    if (snapshot.ageSeconds > 90 * 24 * 60 * 60) {
      return 'unhealthy'; // Snapshot >90 days old
    }

    // Degraded conditions
    if (errors.last5m > 10) {
      return 'degraded'; // >10 errors in 5 minutes
    }
    if (queries.latencyP95 > 100) {
      return 'degraded'; // p95 latency >100ms
    }
    if (cache.hitRate < 0.5) {
      return 'degraded'; // Cache hit rate <50%
    }
    if (snapshot.ageSeconds > 30 * 24 * 60 * 60) {
      return 'degraded'; // Snapshot >30 days old
    }

    return 'healthy';
  }

  /**
   * Export Prometheus-compatible metrics
   */
  exportPrometheus(): string {
    const metrics = this.getMetrics();
    const lines: string[] = [];

    // Query metrics
    lines.push('# HELP shadow_atlas_queries_total Total number of lookup queries');
    lines.push('# TYPE shadow_atlas_queries_total counter');
    lines.push(`shadow_atlas_queries_total ${metrics.queries.total}`);

    lines.push('# HELP shadow_atlas_query_latency_seconds Query latency percentiles');
    lines.push('# TYPE shadow_atlas_query_latency_seconds summary');
    lines.push(`shadow_atlas_query_latency_seconds{quantile="0.5"} ${metrics.queries.latencyP50 / 1000}`);
    lines.push(`shadow_atlas_query_latency_seconds{quantile="0.95"} ${metrics.queries.latencyP95 / 1000}`);
    lines.push(`shadow_atlas_query_latency_seconds{quantile="0.99"} ${metrics.queries.latencyP99 / 1000}`);

    // Cache metrics
    lines.push('# HELP shadow_atlas_cache_hits_total Cache hits');
    lines.push('# TYPE shadow_atlas_cache_hits_total counter');
    lines.push(`shadow_atlas_cache_hits_total ${metrics.cache.hits}`);

    lines.push('# HELP shadow_atlas_cache_hit_rate Cache hit rate');
    lines.push('# TYPE shadow_atlas_cache_hit_rate gauge');
    lines.push(`shadow_atlas_cache_hit_rate ${metrics.cache.hitRate}`);

    // Error metrics
    lines.push('# HELP shadow_atlas_errors_total Total errors');
    lines.push('# TYPE shadow_atlas_errors_total counter');
    lines.push(`shadow_atlas_errors_total ${metrics.queries.failed}`);

    // Health status (0=unhealthy, 1=degraded, 2=healthy)
    lines.push('# HELP shadow_atlas_health Health status');
    lines.push('# TYPE shadow_atlas_health gauge');
    const healthValue = metrics.status === 'healthy' ? 2 : metrics.status === 'degraded' ? 1 : 0;
    lines.push(`shadow_atlas_health ${healthValue}`);

    return lines.join('\n') + '\n';
  }

  /**
   * Reset all metrics (for testing)
   */
  reset(): void {
    this.startTime = Date.now();
    this.queryCount = 0;
    this.successCount = 0;
    this.errorCount = 0;
    this.latencies = [];
    this.errors = [];
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.cacheEvictions = 0;
    this.cacheSize = 0;
  }
}
