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
import type { AvailabilityMonitor } from './availability-monitor.js';
import type { RegionConfig } from './global-ipfs-strategy.js';

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
  }>();

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
        const delayMs = this.fallbackStrategy.exponentialBackoff
          ? Math.pow(2, attemptCount - 2) * this.fallbackStrategy.retryDelayMs
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
    try {
      const url = `${gatewayUrl}${cid}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15_000); // 15s timeout

      const response = await fetch(url, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorType: DistributionErrorType =
          response.status === 404 ? 'invalid_cid' :
          response.status === 429 ? 'quota_exceeded' :
          'gateway_unavailable';

        return {
          success: false,
          error: {
            type: errorType,
            message: `Gateway returned ${response.status}: ${response.statusText}`,
            region,
            retryable: errorType !== 'invalid_cid',
            timestamp: new Date(),
          },
        };
      }

      const data = await response.blob();

      return {
        success: true,
        data,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorType: DistributionErrorType =
        errorMessage.includes('aborted') ? 'network_timeout' : 'gateway_unavailable';

      return {
        success: false,
        error: {
          type: errorType,
          message: errorMessage,
          region,
          retryable: true,
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
  private cacheResponse(cid: string, data: Blob): void {
    this.responseCache.set(cid, {
      data,
      cachedAt: new Date(),
    });
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
   * Clear all caches
   */
  clearCaches(): void {
    this.responseCache.clear();
    this.failureCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    readonly responseCacheSize: number;
    readonly failureCacheSize: number;
    readonly oldestResponseAge: number;
    readonly newestResponseAge: number;
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
    };
  }
}
