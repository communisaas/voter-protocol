/**
 * Rate Limiter Types
 *
 * Unified rate limiter interface for consistent behavior across
 * security/ and resilience/ modules.
 */

/**
 * Unified rate limiter configuration
 *
 * Used by both MultiTierRateLimiter (security/) and TokenBucketRateLimiter (resilience/)
 */
export interface UnifiedRateLimiterConfig {
  readonly maxTokens: number;
  readonly refillRate: number; // tokens per second
  readonly refillIntervalMs?: number; // defaults to 1000ms
}

/**
 * Unified rate limit check result
 *
 * Returned by all rate limiter implementations for consistent handling
 */
export interface UnifiedRateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetMs: number; // milliseconds until bucket refills
  readonly retryAfterMs?: number; // milliseconds to wait if rate limited
}

/**
 * Unified rate limiter interface
 *
 * All rate limiter implementations MUST satisfy this interface
 * for consistent behavior across security/ and resilience/ modules
 */
export interface UnifiedRateLimiter {
  /**
   * Check if request is allowed without consuming tokens
   *
   * @param clientId - Client identifier (IP address, API key, etc.)
   * @param cost - Number of tokens required (default: 1)
   * @returns Rate limit result with remaining tokens and retry timing
   */
  check(clientId: string, cost?: number): UnifiedRateLimitResult;

  /**
   * Consume tokens if available
   *
   * @param clientId - Client identifier
   * @param cost - Number of tokens to consume (default: 1)
   * @returns true if tokens consumed, false if rate limited
   */
  consume(clientId: string, cost?: number): boolean;

  /**
   * Get remaining tokens for client
   *
   * @param clientId - Client identifier
   * @returns Number of tokens remaining
   */
  getRemainingTokens(clientId: string): number;
}
