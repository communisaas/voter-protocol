/**
 * Token Bucket Base Class
 *
 * Shared token bucket implementation for both security/ and resilience/ rate limiters.
 * Provides core token refill and consumption logic with DRY principle.
 *
 * ALGORITHM:
 * - Bucket holds tokens (up to capacity)
 * - Tokens refill at constant rate
 * - Each request consumes N tokens
 * - Burst = bucket capacity
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, explicit types throughout.
 */

import type { UnifiedRateLimiterConfig } from './types.js';

/**
 * Token Bucket base implementation
 *
 * Used by both MultiTierRateLimiter (security/) and TokenBucketRateLimiter (resilience/)
 */
export class TokenBucket {
  protected tokens: number;
  protected lastRefill: number;
  protected readonly maxTokens: number;
  protected readonly refillRate: number; // Tokens per second
  protected readonly refillIntervalMs: number;

  constructor(config: UnifiedRateLimiterConfig) {
    this.maxTokens = config.maxTokens;
    this.tokens = config.maxTokens; // Start with full bucket
    this.lastRefill = Date.now();
    this.refillRate = config.refillRate;
    this.refillIntervalMs = config.refillIntervalMs ?? 1000;
  }

  /**
   * Refill tokens based on elapsed time
   */
  public refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;

    // Calculate tokens to add
    const tokensToAdd = (elapsed / 1000) * this.refillRate;

    // Add tokens up to max capacity
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Check if enough tokens are available
   *
   * @param cost - Number of tokens required
   * @returns true if tokens available, false otherwise
   */
  hasTokens(cost: number): boolean {
    this.refill();
    return this.tokens >= cost;
  }

  /**
   * Consume tokens if available
   *
   * @param cost - Number of tokens to consume
   * @returns true if tokens consumed, false if insufficient
   */
  consume(cost: number): boolean {
    this.refill();

    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }

    return false;
  }

  /**
   * Get remaining tokens
   */
  getRemaining(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  /**
   * Get milliseconds until bucket refills to target
   *
   * @param targetTokens - Target token count (defaults to 1)
   * @returns Milliseconds until target tokens available
   */
  msUntilRefill(targetTokens = 1): number {
    this.refill();

    const tokensNeeded = Math.max(0, targetTokens - this.tokens);
    if (tokensNeeded === 0) return 0;

    return Math.ceil((tokensNeeded / this.refillRate) * 1000);
  }

  /**
   * Get Unix timestamp when bucket will be full
   */
  getResetTime(): number {
    const tokensNeeded = this.maxTokens - this.tokens;
    const msToRefill = (tokensNeeded / this.refillRate) * 1000;
    return Math.ceil((Date.now() + msToRefill) / 1000);
  }

  /**
   * Get seconds until next token available
   */
  getRetryAfter(): number {
    const msToRefill = this.msUntilRefill(1);
    return Math.ceil(msToRefill / 1000);
  }

  /**
   * Get current configuration
   */
  getConfig(): UnifiedRateLimiterConfig {
    return {
      maxTokens: this.maxTokens,
      refillRate: this.refillRate,
      refillIntervalMs: this.refillIntervalMs,
    };
  }
  /**
   * Reset bucket state (full tokens)
   */
  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
  }
}
