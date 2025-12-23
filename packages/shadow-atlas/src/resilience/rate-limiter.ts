/**
 * Rate Limiter (Token Bucket Algorithm)
 *
 * Prevents resource exhaustion from traffic spikes.
 * Token bucket allows controlled bursts while maintaining rate limits.
 *
 * ALGORITHM:
 * - Bucket holds tokens (up to capacity)
 * - Tokens refill at constant rate
 * - Each request consumes 1 token
 * - Burst = bucket capacity
 *
 * BASED ON:
 * - Token bucket algorithm (Tanenbaum, Computer Networks)
 * - AWS API Gateway rate limiting
 * - NGINX rate limiting
 *
 * Implements UnifiedRateLimiter interface for consistent behavior.
 */

import type { RateLimiterConfig, RateLimiterStats } from './types.js';
import type { UnifiedRateLimiter, UnifiedRateLimitResult } from '../core/types.js';
import { TokenBucket } from '../core/token-bucket.js';

/**
 * Rate limit exceeded error
 */
export class RateLimitExceededError extends Error {
  readonly clientId: string;
  readonly stats: RateLimiterStats;
  readonly retryAfterMs: number;

  constructor(clientId: string, stats: RateLimiterStats, retryAfterMs: number) {
    super(`Rate limit exceeded for client '${clientId}'. Retry after ${retryAfterMs}ms`);
    this.name = 'RateLimitExceededError';
    this.clientId = clientId;
    this.stats = stats;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Token Bucket Rate Limiter
 *
 * Per-client rate limiting with configurable burst capacity.
 * Uses shared TokenBucket from core/ and implements UnifiedRateLimiter interface.
 *
 * @example
 * ```typescript
 * const limiter = new TokenBucketRateLimiter({
 *   maxTokens: 100,
 *   refillRate: 10, // 10 tokens per second
 *   refillIntervalMs: 100, // refill every 100ms
 *   burstSize: 20,
 * });
 *
 * if (limiter.tryConsume()) {
 *   // Process request
 * } else {
 *   // Rate limited
 * }
 * ```
 */
export class TokenBucketRateLimiter implements UnifiedRateLimiter {
  private readonly config: RateLimiterConfig;
  private readonly bucket: TokenBucket;
  private requestsAllowed = 0;
  private requestsRejected = 0;
  private refillIntervalHandle?: ReturnType<typeof setInterval>;

  constructor(config: RateLimiterConfig) {
    this.bucket = new TokenBucket({
      maxTokens: config.maxTokens,
      refillRate: config.refillRate,
      refillIntervalMs: config.refillIntervalMs,
    });

    this.config = config;
  }

  /**
   * Consume tokens if available (UnifiedRateLimiter interface)
   *
   * @param clientId - Client identifier (unused for single-client limiter)
   * @param cost - Number of tokens to consume (default: 1)
   * @returns true if tokens consumed, false if rate limited
   */
  consume(clientId: string, cost = 1): boolean {
    const consumed = this.bucket.consume(cost);

    if (consumed) {
      this.requestsAllowed++;
    } else {
      this.requestsRejected++;
    }

    return consumed;
  }

  /**
   * Try to consume tokens for request (LEGACY - use consume() instead)
   *
   * @param tokens - Number of tokens to consume (default: 1)
   * @returns true if tokens consumed, false if rate limited
   */
  tryConsume(tokens = 1): boolean {
    return this.consume('legacy', tokens);
  }

  /**
   * Consume tokens or throw error (LEGACY - for backward compatibility)
   *
   * @param clientId - Client identifier (used in error message)
   * @param tokens - Number of tokens to consume
   * @throws RateLimitExceededError if rate limited
   */
  consumeOrThrow(clientId: string, tokens = 1): void {
    if (!this.tryConsume(tokens)) {
      const retryAfterMs = this.bucket.msUntilRefill(tokens);
      throw new RateLimitExceededError(clientId, this.getStats(), retryAfterMs);
    }
  }

  // ============================================================================
  // UnifiedRateLimiter Interface Implementation
  // ============================================================================

  /**
   * Check if request is allowed (UnifiedRateLimiter interface)
   *
   * @param clientId - Client identifier (used for error messages)
   * @param cost - Number of tokens required (default: 1)
   * @returns Unified rate limit result
   */
  check(clientId: string, cost = 1): UnifiedRateLimitResult {
    const allowed = this.bucket.hasTokens(cost);
    const remaining = this.bucket.getRemaining();
    const resetMs = this.bucket.msUntilRefill(this.config.maxTokens);
    const retryAfterMs = allowed ? undefined : this.bucket.msUntilRefill(cost);

    return {
      allowed,
      remaining,
      resetMs,
      retryAfterMs,
    };
  }

  /**
   * Get remaining tokens for client (UnifiedRateLimiter interface)
   *
   * @param clientId - Client identifier (not used for single-client limiter)
   * @returns Number of tokens remaining
   */
  getRemainingTokens(clientId: string): number {
    return this.bucket.getRemaining();
  }

  // ============================================================================
  // Legacy API (for backward compatibility)
  // ============================================================================

  /**
   * Get current rate limiter statistics
   */
  getStats(): RateLimiterStats {
    return {
      currentTokens: this.bucket.getRemaining(),
      maxTokens: this.config.maxTokens,
      refillRate: this.config.refillRate,
      requestsAllowed: this.requestsAllowed,
      requestsRejected: this.requestsRejected,
      lastRefillTime: Date.now(), // Approximate - base class doesn't expose this
    };
  }

  /**
   * Reset rate limiter state
   */
  reset(): void {
    // Reset counters (bucket state is managed by base class)
    this.requestsAllowed = 0;
    this.requestsRejected = 0;
    // Note: Token bucket state is reset by creating a new instance
    this.bucket.reset();
  }

  /**
   * Start automatic token refill (background task)
   */
  startAutoRefill(): void {
    if (this.refillIntervalHandle) {
      return; // Already running
    }

    this.refillIntervalHandle = setInterval(() => {
      this.refillTokens();
    }, this.config.refillIntervalMs);
  }

  /**
   * Stop automatic token refill
   */
  stopAutoRefill(): void {
    if (this.refillIntervalHandle) {
      clearInterval(this.refillIntervalHandle);
      this.refillIntervalHandle = undefined;
    }
  }

  /**
   * Refill tokens manually (delegates to bucket)
   */
  refillTokens(): void {
    this.bucket.refill();
  }
}

/**
 * Multi-client rate limiter (manages multiple buckets)
 *
 * Implements UnifiedRateLimiter interface for consistent behavior.
 */
export class MultiClientRateLimiter implements UnifiedRateLimiter {
  private readonly config: RateLimiterConfig;
  private readonly limiters = new Map<string, TokenBucketRateLimiter>();
  private cleanupIntervalHandle?: ReturnType<typeof setInterval>;

  constructor(config: RateLimiterConfig) {
    this.config = config;
  }

  // ============================================================================
  // UnifiedRateLimiter Interface Implementation
  // ============================================================================

  /**
   * Check if request is allowed (UnifiedRateLimiter interface)
   *
   * @param clientId - Client identifier
   * @param cost - Number of tokens required (default: 1)
   * @returns Unified rate limit result
   */
  check(clientId: string, cost = 1): UnifiedRateLimitResult {
    const limiter = this.getLimiter(clientId);
    return limiter.check(clientId, cost);
  }

  /**
   * Consume tokens if available (UnifiedRateLimiter interface)
   *
   * @param clientId - Client identifier
   * @param cost - Number of tokens to consume (default: 1)
   * @returns true if tokens consumed, false if rate limited
   */
  consume(clientId: string, cost = 1): boolean {
    const limiter = this.getLimiter(clientId);
    return limiter.consume(clientId, cost);
  }

  /**
   * Get remaining tokens for client (UnifiedRateLimiter interface)
   *
   * @param clientId - Client identifier
   * @returns Number of tokens remaining
   */
  getRemainingTokens(clientId: string): number {
    const limiter = this.limiters.get(clientId);
    return limiter ? limiter.getRemainingTokens(clientId) : this.config.maxTokens;
  }

  // ============================================================================
  // Legacy API (for backward compatibility)
  // ============================================================================

  /**
   * Try to consume tokens for client (LEGACY - use consume() instead)
   */
  tryConsume(clientId: string, tokens = 1): boolean {
    const limiter = this.getLimiter(clientId);
    return limiter.tryConsume(tokens);
  }

  /**
   * Consume tokens or throw error (LEGACY)
   */
  consumeOrThrow(clientId: string, tokens = 1): void {
    const limiter = this.getLimiter(clientId);
    limiter.consumeOrThrow(clientId, tokens);
  }

  /**
   * Get or create limiter for client
   */
  private getLimiter(clientId: string): TokenBucketRateLimiter {
    let limiter = this.limiters.get(clientId);

    if (!limiter) {
      limiter = new TokenBucketRateLimiter(this.config);
      this.limiters.set(clientId, limiter);
    }

    return limiter;
  }

  /**
   * Get stats for specific client
   */
  getClientStats(clientId: string): RateLimiterStats | null {
    const limiter = this.limiters.get(clientId);
    return limiter ? limiter.getStats() : null;
  }

  /**
   * Get stats for all clients
   */
  getAllStats(): Map<string, RateLimiterStats> {
    const stats = new Map<string, RateLimiterStats>();

    for (const [clientId, limiter] of this.limiters.entries()) {
      stats.set(clientId, limiter.getStats());
    }

    return stats;
  }

  /**
   * Reset specific client
   */
  resetClient(clientId: string): void {
    const limiter = this.limiters.get(clientId);
    if (limiter) {
      limiter.reset();
    }
  }

  /**
   * Reset all clients
   */
  resetAll(): void {
    for (const limiter of this.limiters.values()) {
      limiter.reset();
    }
  }

  /**
   * Remove inactive clients (cleanup)
   */
  cleanup(inactiveThresholdMs = 3600000): void {
    const now = Date.now();

    for (const [clientId, limiter] of this.limiters.entries()) {
      const stats = limiter.getStats();
      const inactive = now - stats.lastRefillTime > inactiveThresholdMs;

      if (inactive && stats.currentTokens === this.config.maxTokens) {
        this.limiters.delete(clientId);
      }
    }
  }

  /**
   * Start automatic cleanup of inactive clients
   */
  startAutoCleanup(intervalMs = 3600000, inactiveThresholdMs = 3600000): void {
    if (this.cleanupIntervalHandle) {
      return; // Already running
    }

    this.cleanupIntervalHandle = setInterval(() => {
      this.cleanup(inactiveThresholdMs);
    }, intervalMs);
  }

  /**
   * Stop automatic cleanup
   */
  stopAutoCleanup(): void {
    if (this.cleanupIntervalHandle) {
      clearInterval(this.cleanupIntervalHandle);
      this.cleanupIntervalHandle = undefined;
    }
  }
}

/**
 * Create rate limiter with Shadow Atlas defaults
 */
export function createRateLimiter(
  overrides?: Partial<RateLimiterConfig>
): TokenBucketRateLimiter {
  const config: RateLimiterConfig = {
    maxTokens: 100,
    refillRate: 10, // 10 requests per second
    refillIntervalMs: 100, // refill every 100ms
    burstSize: 20, // allow bursts up to 20
    ...overrides,
  };

  return new TokenBucketRateLimiter(config);
}

/**
 * Create multi-client rate limiter with Shadow Atlas defaults
 */
export function createMultiClientRateLimiter(
  overrides?: Partial<RateLimiterConfig>
): MultiClientRateLimiter {
  const config: RateLimiterConfig = {
    maxTokens: 60,
    refillRate: 1, // 1 request per second per client
    refillIntervalMs: 1000,
    burstSize: 10,
    ...overrides,
  };

  return new MultiClientRateLimiter(config);
}
