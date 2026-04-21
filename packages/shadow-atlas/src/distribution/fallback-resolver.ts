/**
 * Fallback Resolver
 *
 * Implements intelligent gateway failover with exponential backoff.
 * Handles regional failures gracefully with automatic fallback chains.
 *
 * FALLBACK STRATEGY:
 * 1. Try regional gateway (fastest)
 * 2. Try secondary regional gateway
 * 3. Try global public gateways
 * 4. Return cached data if available
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type {
  Region,
  GatewaySelectionCriteria,
  GatewaySelectionResult,
  FallbackStrategy,
  FallbackResolutionResult,
  DistributionError,
  DistributionErrorType,
} from './types.js';
import { isValidCID } from './types.js';
import type { AvailabilityMonitor } from './availability-monitor.js';
import type { RegionConfig } from './global-ipfs-strategy.js';
import { fetchBufferWithSizeLimit, DEFAULT_MAX_BYTES } from '../hydration/fetch-with-size-limit.js';

// ============================================================================
// Fallback Resolver
// ============================================================================

/**
 * Fallback Resolver
 *
 * Resolves content requests with intelligent gateway selection and failover.
 */
export class FallbackResolver {
  private readonly regions: readonly RegionConfig[];
  private readonly availabilityMonitor: AvailabilityMonitor;
  private readonly fallbackStrategy: FallbackStrategy;

  // Failure cache (prevent repeated failures)
  private readonly failureCache = new Map<string, {
    failedAt: Date;
    reason: string;
  }>();

  // Response cache (optional performance optimization)
  private readonly responseCache = new Map<string, {
    data: Blob;
    cachedAt: Date;
    size: number; // Track entry byte size for budget eviction
  }>();

  // Byte-budget cache eviction — prevent memory bomb.
  // 100 MB budget (vs prior 1000-entry × 100 MB = 100 GB theoretical max).
  private static readonly MAX_CACHE_BYTES = 100 * 1024 * 1024;
  private cacheBytes = 0;

  private readonly cacheTTLMs: number;

  constructor(
    regions: readonly RegionConfig[],
    availabilityMonitor: AvailabilityMonitor,
    options: {
      readonly fallbackStrategy?: Partial<FallbackStrategy>;
      readonly cacheTTLMs?: number;
    } = {}
  ) {
    this.regions = regions;
    this.availabilityMonitor = availabilityMonitor;
    this.cacheTTLMs = options.cacheTTLMs ?? 3600_000; // 1 hour default

    // Merge with default fallback strategy
    this.fallbackStrategy = {
      maxRetries: 3,
      retryDelayMs: 1000,
      exponentialBackoff: true,
      fallbackToSlowGateways: true,
      cacheFailures: true,
      failureWindowMs: 300_000, // 5 minutes
      ...options.fallbackStrategy,
    };
  }

  /**
   * Resolve content with intelligent gateway selection
   *
   * Automatically falls back through gateway hierarchy on failure.
   */
  async resolve(
    cid: string,
    criteria: GatewaySelectionCriteria = {
      maxLatencyMs: 1000,
      minSuccessRate: 0.8,
    }
  ): Promise<FallbackResolutionResult> {
    // R20-M2: Validate CID format before constructing gateway URLs (now using shared utility)
    if (!isValidCID(cid)) {
      return {
        success: false,
        gateway: '',
        region: 'americas-east' as import('./types.js').Region,
        attemptCount: 0,
        totalDurationMs: 0,
        errors: [{ type: 'invalid_cid' as const, message: `Invalid CID format: ${cid.slice(0, 20)}...`, retryable: false, timestamp: new Date() }],
      };
    }

    const startTime = Date.now();
    const errors: DistributionError[] = [];
    let attemptCount = 0;

    // Check cache first
    const cached = this.getFromCache(cid);
    if (cached) {
      return {
        success: true,
        gateway: 'cache',
        region: criteria.userRegion ?? 'americas-east',
        attemptCount: 0,
        totalDurationMs: Date.now() - startTime,
        errors: [],
      };
    }

    // Select optimal gateway
    const gatewaySelection = this.selectGateway(criteria);

    // Try primary gateway
    const primaryResult = await this.tryGateway(
      gatewaySelection.gateway,
      cid,
      gatewaySelection.region
    );

    attemptCount++;

    if (primaryResult.success && primaryResult.data) {
      // Cache successful response
      this.cacheResponse(cid, primaryResult.data);

      // Record success
      this.availabilityMonitor.recordRequest(true, Date.now() - startTime);

      return {
        success: true,
        gateway: gatewaySelection.gateway,
        region: gatewaySelection.region,
        attemptCount,
        totalDurationMs: Date.now() - startTime,
        errors: [],
      };
    }

    if (primaryResult.error) {
      errors.push(primaryResult.error);
      this.cacheFailure(gatewaySelection.gateway, cid, primaryResult.error.message);
    }

    // Try fallback gateways
    for (const fallbackGateway of gatewaySelection.fallbacks) {
      // Check if gateway is in failure cache
      if (this.isInFailureCache(fallbackGateway, cid)) {
        continue;
      }

      attemptCount++;

      // Apply retry delay with exponential backoff
      if (attemptCount > 1 && this.fallbackStrategy.retryDelayMs > 0) {
        // Cap exponential backoff at 30 seconds
        const MAX_BACKOFF_MS = 30_000;
        const delayMs = this.fallbackStrategy.exponentialBackoff
          ? Math.min(Math.pow(2, attemptCount - 2) * this.fallbackStrategy.retryDelayMs, MAX_BACKOFF_MS)
          : this.fallbackStrategy.retryDelayMs;
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      const fallbackResult = await this.tryGateway(
        fallbackGateway,
        cid,
        this.getRegionForGateway(fallbackGateway)
      );

      if (fallbackResult.success && fallbackResult.data) {
        // Cache successful response
        this.cacheResponse(cid, fallbackResult.data);

        // Record success
        this.availabilityMonitor.recordRequest(true, Date.now() - startTime);

        return {
          success: true,
          gateway: fallbackGateway,
          region: this.getRegionForGateway(fallbackGateway),
          attemptCount,
          totalDurationMs: Date.now() - startTime,
          errors,
        };
      }

      if (fallbackResult.error) {
        errors.push(fallbackResult.error);
        this.cacheFailure(fallbackGateway, cid, fallbackResult.error.message);
      }
    }

    // All gateways failed
    this.availabilityMonitor.recordRequest(false, Date.now() - startTime);

    return {
      success: false,
      gateway: gatewaySelection.gateway,
      region: gatewaySelection.region,
      attemptCount,
      totalDurationMs: Date.now() - startTime,
      errors,
    };
  }

  /**
   * Select optimal gateway based on criteria
   */
  selectGateway(criteria: GatewaySelectionCriteria): GatewaySelectionResult {
    const userRegion = criteria.userRegion ?? 'americas-east';

    // Get healthy gateways for user's region
    const healthyGateways = this.availabilityMonitor.getHealthyGateways(userRegion);

    // Filter by criteria
    const suitableGateways = healthyGateways.filter(
      h =>
        h.latencyMs <= criteria.maxLatencyMs &&
        h.successRate >= criteria.minSuccessRate
    );

    // Select primary gateway (lowest latency)
    const primary = suitableGateways[0] ?? healthyGateways[0];

    if (!primary) {
      // No healthy gateways in region - use global fallback
      const allHealthy = Array.from(this.availabilityMonitor.getAllGatewayHealth().values())
        .filter(h => h.available)
        .sort((a, b) => a.latencyMs - b.latencyMs);

      const fallback = allHealthy[0];

      return {
        gateway: fallback?.url ?? 'https://ipfs.io/ipfs/',
        region: fallback?.region ?? 'americas-east',
        estimatedLatencyMs: fallback?.latencyMs ?? 500,
        confidence: 50, // Low confidence - using fallback
        fallbacks: allHealthy.slice(1).map(h => h.url),
      };
    }

    // Build fallback chain
    const fallbacks = [
      ...suitableGateways.slice(1).map(h => h.url),
      ...healthyGateways.slice(suitableGateways.length).map(h => h.url),
      // Add global gateways as final fallback
      'https://ipfs.io/ipfs/',
      'https://cloudflare-ipfs.com/ipfs/',
      'https://dweb.link/ipfs/',
    ].filter((url, index, arr) => arr.indexOf(url) === index); // Deduplicate

    return {
      gateway: primary.url,
      region: userRegion,
      estimatedLatencyMs: primary.latencyMs,
      confidence: Math.round(primary.successRate * 100),
      fallbacks,
    };
  }

  /**
   * Try fetching from a single gateway
   */
  private async tryGateway(
    gatewayUrl: string,
    cid: string,
    region: Region
  ): Promise<{
    readonly success: boolean;
    readonly data?: Blob;
    readonly error?: DistributionError;
  }> {
    // R50-S4: Defense-in-depth CID validation (resolve() already validates, but guard refactoring)
    if (!isValidCID(cid)) {
      return { success: false, error: { type: 'invalid_cid', message: `Invalid CID format: ${cid.slice(0, 20)}...`, retryable: false, timestamp: new Date() } };
    }

    try {
      const url = `${gatewayUrl}${cid}`;

      // R52-S2: Use size-limited fetch to prevent OOM from oversized IPFS responses (100 MB cap)
      const buffer = await fetchBufferWithSizeLimit(url, DEFAULT_MAX_BYTES, {
        signal: AbortSignal.timeout(15_000), // 15s timeout
      });

      const data = new Blob([new Uint8Array(buffer)]);

      return {
        success: true,
        data,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Map error messages to appropriate distribution error types
      const errorType: DistributionErrorType =
        errorMessage.includes('aborted') || errorMessage.includes('timeout') ? 'network_timeout' :
        errorMessage.includes('404') ? 'invalid_cid' :
        errorMessage.includes('429') ? 'quota_exceeded' :
        errorMessage.includes('exceeds size limit') ? 'gateway_unavailable' :
        'gateway_unavailable';

      return {
        success: false,
        error: {
          type: errorType,
          message: errorMessage,
          region,
          retryable: errorType !== 'invalid_cid',
          timestamp: new Date(),
        },
      };
    }
  }

  /**
   * Get region for gateway URL
   */
  private getRegionForGateway(gatewayUrl: string): Region {
    for (const region of this.regions) {
      if (region.gateways.includes(gatewayUrl)) {
        return region.region;
      }
    }
    return 'americas-east'; // Default fallback
  }

  /**
   * Cache successful response
   */
  /**
   * Max cache entries before pruning stale entries.
   * R53-S4: Reduced from 10K to 1K to limit worst-case heap usage.
   * Each entry can hold up to 100 MB (DEFAULT_MAX_BYTES), so
   * 1,000 entries × 100 MB = 100 GB theoretical max (vs 1 TB at 10K).
   */
  private readonly maxCacheSize = 1_000;

  private cacheResponse(cid: string, data: Blob): void {
    const entrySize = data.size;

    // Evict oldest entries until byte budget has room
    while (this.cacheBytes + entrySize > FallbackResolver.MAX_CACHE_BYTES && this.responseCache.size > 0) {
      const oldestKey = this.responseCache.keys().next().value;
      if (!oldestKey) break;
      const oldEntry = this.responseCache.get(oldestKey);
      if (oldEntry) {
        this.cacheBytes -= oldEntry.size;
        this.responseCache.delete(oldestKey);
      }
    }

    // R20-M1: Also prune stale entries when entry count limit reached
    if (this.responseCache.size >= this.maxCacheSize) {
      this.pruneCache();
    }

    this.responseCache.set(cid, {
      data,
      cachedAt: new Date(),
      size: entrySize,
    });
    this.cacheBytes += entrySize;
  }

  /**
   * Get from response cache
   */
  private getFromCache(cid: string): Blob | null {
    const cached = this.responseCache.get(cid);
    if (!cached) return null;

    // Check if cache is still valid
    const age = Date.now() - cached.cachedAt.getTime();
    if (age > this.cacheTTLMs) {
      // Decrement byte counter on TTL eviction
      this.cacheBytes -= cached.size;
      this.responseCache.delete(cid);
      return null;
    }

    return cached.data;
  }

  /**
   * Cache gateway failure
   */
  private cacheFailure(gateway: string, cid: string, reason: string): void {
    if (!this.fallbackStrategy.cacheFailures) return;

    // R20-M1: Prune stale entries when failure cache grows too large
    if (this.failureCache.size >= this.maxCacheSize) {
      this.pruneCache();
    }

    const key = `${gateway}:${cid}`;
    this.failureCache.set(key, {
      failedAt: new Date(),
      reason,
    });
  }

  /**
   * Check if gateway/CID combo is in failure cache
   */
  private isInFailureCache(gateway: string, cid: string): boolean {
    const key = `${gateway}:${cid}`;
    const cached = this.failureCache.get(key);

    if (!cached) return false;

    // Check if failure is still within window
    const age = Date.now() - cached.failedAt.getTime();
    if (age > this.fallbackStrategy.failureWindowMs) {
      this.failureCache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Prune stale entries from both caches when size limits are reached.
   */
  private pruneCache(): void {
    const now = Date.now();
    // Prune response cache entries past TTL
    for (const [key, entry] of this.responseCache) {
      if (now - entry.cachedAt.getTime() > this.cacheTTLMs) {
        // Decrement byte counter on eviction
        this.cacheBytes -= entry.size;
        this.responseCache.delete(key);
      }
    }
    // Prune failure cache entries past window
    for (const [key, entry] of this.failureCache) {
      if (now - entry.failedAt.getTime() > this.fallbackStrategy.failureWindowMs) {
        this.failureCache.delete(key);
      }
    }
  }

  /**
   * Clear all caches
   */
  clearCaches(): void {
    this.responseCache.clear();
    this.failureCache.clear();
    this.cacheBytes = 0; // Reset byte counter
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    readonly responseCacheSize: number;
    readonly failureCacheSize: number;
    readonly oldestResponseAge: number;
    readonly newestResponseAge: number;
    readonly cacheBytes: number;
    readonly maxCacheBytes: number;
  } {
    const now = Date.now();
    const responseAges = Array.from(this.responseCache.values()).map(
      cached => now - cached.cachedAt.getTime()
    );

    return {
      responseCacheSize: this.responseCache.size,
      failureCacheSize: this.failureCache.size,
      oldestResponseAge: responseAges.length > 0 ? Math.max(...responseAges) : 0,
      newestResponseAge: responseAges.length > 0 ? Math.min(...responseAges) : 0,
      cacheBytes: this.cacheBytes,
      maxCacheBytes: FallbackResolver.MAX_CACHE_BYTES,
    };
  }
}
