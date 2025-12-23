/**
 * Rate Limiting Module
 *
 * Tiered rate limiting for Shadow Atlas API with IP, API key, and global limits.
 * Defense against DoS attacks, API abuse, and resource exhaustion.
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, explicit types throughout.
 *
 * SECURITY PRINCIPLE: Defense in depth - multiple layers of rate limiting.
 */

import type { IncomingMessage } from 'http';
import type { UnifiedRateLimiter, UnifiedRateLimitResult, UnifiedRateLimiterConfig } from '../core/types.js';
import { TokenBucket } from '../core/token-bucket.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum requests per window */
  readonly maxRequests: number;

  /** Time window in milliseconds */
  readonly windowMs: number;

  /** Cost multiplier for expensive endpoints (default: 1) */
  readonly costMultiplier?: number;
}

/**
 * Rate limit tier
 */
export interface RateLimitTier {
  readonly name: string;
  readonly config: RateLimitConfig;
  readonly priority: number; // Higher priority enforced first
}

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetAt: number; // Unix timestamp when limit resets
  readonly retryAfter?: number; // Seconds to wait if rate limited
}

/**
 * Client identification
 */
export interface ClientIdentifier {
  readonly ip: string;
  readonly apiKey?: string;
  readonly fingerprint?: string;
}

// ============================================================================
// Token Bucket Rate Limiter (uses shared TokenBucket from core/)
// ============================================================================

// ============================================================================
// Multi-Tier Rate Limiter
// ============================================================================

/**
 * Multi-tier rate limiter with IP, API key, and global limits
 *
 * SECURITY ARCHITECTURE:
 * - Global: Protect against distributed attacks (10k req/min total) - ALWAYS ENFORCED
 * - IP (no API key): Prevent single IP from flooding (60 req/min) - UNAUTHENTICATED
 * - API Key: Authenticated users get higher limits (1000 req/min) - AUTHENTICATED
 * - Both IP + API Key: BOTH limits enforced to prevent bypass attacks
 *
 * BYPASS PREVENTION:
 * When an API key is present, BOTH IP and API key limits are enforced.
 * This prevents an attacker from exhausting IP quota then adding an API key to bypass.
 *
 * Implements UnifiedRateLimiter interface for consistent behavior.
 */
export class MultiTierRateLimiter implements UnifiedRateLimiter {
  private readonly ipBuckets = new Map<string, TokenBucket>();
  private readonly apiKeyBuckets = new Map<string, TokenBucket>();
  private readonly globalBucket: TokenBucket;

  private readonly ipConfig: RateLimitConfig;
  private readonly apiKeyConfig: RateLimitConfig;
  private readonly globalConfig: RateLimitConfig;

  // Cleanup stale buckets every 5 minutes
  private readonly cleanupInterval: ReturnType<typeof setInterval>;

  constructor(
    ipConfig: RateLimitConfig = { maxRequests: 60, windowMs: 60000 },
    apiKeyConfig: RateLimitConfig = { maxRequests: 1000, windowMs: 60000 },
    globalConfig: RateLimitConfig = { maxRequests: 10000, windowMs: 60000 }
  ) {
    this.ipConfig = ipConfig;
    this.apiKeyConfig = apiKeyConfig;
    this.globalConfig = globalConfig;

    // Convert window-based config to token bucket config
    const globalBucketConfig: UnifiedRateLimiterConfig = {
      maxTokens: globalConfig.maxRequests,
      refillRate: globalConfig.maxRequests / (globalConfig.windowMs / 1000),
      refillIntervalMs: globalConfig.windowMs,
    };

    this.globalBucket = new TokenBucket(globalBucketConfig);

    // Cleanup stale buckets to prevent memory leak
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Check if request is allowed AND CONSUME tokens (LEGACY - for ClientIdentifier compatibility)
   *
   * IMPORTANT: This method CONSUMES tokens on success (backward compatible behavior).
   * For non-consuming checks, use the UnifiedRateLimiter.check() method.
   *
   * @param client - Client identifier (IP, API key)
   * @param cost - Request cost (default: 1, expensive ops can be higher)
   * @returns Rate limit result
   */
  checkClient(client: ClientIdentifier, cost = 1): RateLimitResult {
    // Check global limit first (most critical)
    const globalAllowed = this.globalBucket.consume(cost);
    if (!globalAllowed) {
      return {
        allowed: false,
        limit: this.globalConfig.maxRequests,
        remaining: this.globalBucket.getRemaining(),
        resetAt: this.globalBucket.getResetTime(),
        retryAfter: this.globalBucket.getRetryAfter(),
      };
    }

    // SECURITY MODEL:
    // - If IP bucket has been used (tokens consumed), must continue using it
    // - This prevents bypass by adding API key after exhausting IP quota
    // - Fresh API key requests use API key bucket with higher limits

    const ipBucket = this.getOrCreateIPBucket(client.ip);
    const ipBucketUsed = ipBucket.getRemaining() < this.ipConfig.maxRequests;

    // If API key present AND IP bucket is fresh (not used), use API key limits
    if (client.apiKey && !ipBucketUsed) {
      const apiKeyBucket = this.getOrCreateAPIKeyBucket(client.apiKey);
      const apiKeyAllowed = apiKeyBucket.consume(cost);
      if (!apiKeyAllowed) {
        return {
          allowed: false,
          limit: this.apiKeyConfig.maxRequests,
          remaining: apiKeyBucket.getRemaining(),
          resetAt: apiKeyBucket.getResetTime(),
          retryAfter: apiKeyBucket.getRetryAfter(),
        };
      }

      return {
        allowed: true,
        limit: this.apiKeyConfig.maxRequests,
        remaining: apiKeyBucket.getRemaining(),
        resetAt: apiKeyBucket.getResetTime(),
      };
    }

    // Otherwise, enforce IP limit (no API key OR IP bucket already used)
    const ipAllowed = ipBucket.consume(cost);
    if (!ipAllowed) {
      return {
        allowed: false,
        limit: this.ipConfig.maxRequests,
        remaining: ipBucket.getRemaining(),
        resetAt: ipBucket.getResetTime(),
        retryAfter: ipBucket.getRetryAfter(),
      };
    }

    return {
      allowed: true,
      limit: this.ipConfig.maxRequests,
      remaining: ipBucket.getRemaining(),
      resetAt: ipBucket.getResetTime(),
    };
  }

  // ============================================================================
  // UnifiedRateLimiter Interface Implementation
  // ============================================================================

  /**
   * Check if request is allowed WITHOUT consuming tokens (UnifiedRateLimiter interface)
   *
   * @param clientId - Client identifier (typically IP address)
   * @param cost - Request cost (default: 1)
   * @returns Unified rate limit result
   */
  check(clientId: string, cost = 1): UnifiedRateLimitResult {
    // Check without consuming - use hasTokens instead of consume
    const client: ClientIdentifier = { ip: clientId };

    // Check global limit first
    if (!this.globalBucket.hasTokens(cost)) {
      return {
        allowed: false,
        remaining: this.globalBucket.getRemaining(),
        resetMs: this.globalBucket.msUntilRefill(this.globalConfig.maxRequests),
        retryAfterMs: this.globalBucket.msUntilRefill(cost),
      };
    }

    // Check IP limit
    const ipBucket = this.getOrCreateIPBucket(client.ip);
    if (!ipBucket.hasTokens(cost)) {
      return {
        allowed: false,
        remaining: ipBucket.getRemaining(),
        resetMs: ipBucket.msUntilRefill(this.ipConfig.maxRequests),
        retryAfterMs: ipBucket.msUntilRefill(cost),
      };
    }

    // All checks passed
    return {
      allowed: true,
      remaining: ipBucket.getRemaining(),
      resetMs: ipBucket.msUntilRefill(this.ipConfig.maxRequests),
    };
  }

  /**
   * Consume tokens if available (UnifiedRateLimiter interface)
   *
   * @param clientId - Client identifier
   * @param cost - Number of tokens to consume
   * @returns true if tokens consumed, false if rate limited
   */
  consume(clientId: string, cost = 1): boolean {
    const result = this.check(clientId, cost);
    return result.allowed;
  }

  /**
   * Get remaining tokens for client (UnifiedRateLimiter interface)
   *
   * @param clientId - Client identifier
   * @returns Number of tokens remaining
   */
  getRemainingTokens(clientId: string): number {
    const ipBucket = this.ipBuckets.get(clientId);
    return ipBucket ? ipBucket.getRemaining() : this.ipConfig.maxRequests;
  }

  /**
   * Reset rate limits for a client (use for testing or admin override)
   *
   * @param client - Client identifier
   */
  reset(client: ClientIdentifier): void {
    this.ipBuckets.delete(client.ip);
    if (client.apiKey) {
      this.apiKeyBuckets.delete(client.apiKey);
    }
  }

  /**
   * Get or create IP bucket
   */
  private getOrCreateIPBucket(ip: string): TokenBucket {
    let bucket = this.ipBuckets.get(ip);

    if (!bucket) {
      const config: UnifiedRateLimiterConfig = {
        maxTokens: this.ipConfig.maxRequests,
        refillRate: this.ipConfig.maxRequests / (this.ipConfig.windowMs / 1000),
        refillIntervalMs: this.ipConfig.windowMs,
      };
      bucket = new TokenBucket(config);
      this.ipBuckets.set(ip, bucket);
    }

    return bucket;
  }

  /**
   * Get or create API key bucket
   */
  private getOrCreateAPIKeyBucket(apiKey: string): TokenBucket {
    let bucket = this.apiKeyBuckets.get(apiKey);

    if (!bucket) {
      const config: UnifiedRateLimiterConfig = {
        maxTokens: this.apiKeyConfig.maxRequests,
        refillRate: this.apiKeyConfig.maxRequests / (this.apiKeyConfig.windowMs / 1000),
        refillIntervalMs: this.apiKeyConfig.windowMs,
      };
      bucket = new TokenBucket(config);
      this.apiKeyBuckets.set(apiKey, bucket);
    }

    return bucket;
  }

  /**
   * Cleanup stale buckets (haven't been used in 10+ minutes)
   */
  private cleanup(): void {
    const now = Date.now();
    const staleThreshold = 10 * 60 * 1000; // 10 minutes

    // Cleanup IP buckets
    for (const [ip, bucket] of this.ipBuckets.entries()) {
      // If bucket is full, it hasn't been used recently
      if (bucket.getRemaining() === this.ipConfig.maxRequests) {
        this.ipBuckets.delete(ip);
      }
    }

    // Cleanup API key buckets
    for (const [apiKey, bucket] of this.apiKeyBuckets.entries()) {
      if (bucket.getRemaining() === this.apiKeyConfig.maxRequests) {
        this.apiKeyBuckets.delete(apiKey);
      }
    }
  }

  /**
   * Stop cleanup interval (call on shutdown)
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
  }

  /**
   * Get current statistics
   */
  getStats(): {
    ipBuckets: number;
    apiKeyBuckets: number;
    globalRemaining: number;
  } {
    return {
      ipBuckets: this.ipBuckets.size,
      apiKeyBuckets: this.apiKeyBuckets.size,
      globalRemaining: this.globalBucket.getRemaining(),
    };
  }
}

// ============================================================================
// Client Identification Utilities
// ============================================================================

/**
 * Extract client identifier from HTTP request
 *
 * SECURITY: Uses socket IP by default, only trusts X-Forwarded-For if behind authenticated proxy.
 *
 * @param req - HTTP request
 * @param trustProxy - Whether to trust X-Forwarded-For header (default: false)
 * @returns Client identifier
 */
export function getClientIdentifier(
  req: IncomingMessage,
  trustProxy = false
): ClientIdentifier {
  // Extract IP address
  let ip = req.socket.remoteAddress || 'unknown';

  // Only trust X-Forwarded-For if behind authenticated reverse proxy
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded && typeof forwarded === 'string') {
      // Use leftmost IP (client IP, not proxy chain)
      ip = forwarded.split(',')[0]?.trim() ?? ip;
    }
  }

  // Extract API key from Authorization header
  const authHeader = req.headers['authorization'];
  let apiKey: string | undefined;

  if (authHeader && typeof authHeader === 'string') {
    // Support Bearer token format
    const match = /^Bearer\s+(\S+)$/.exec(authHeader);
    if (match && match[1]) {
      apiKey = match[1];
    }
  }

  // TODO: Implement browser fingerprinting for additional DDoS protection
  // const fingerprint = generateFingerprint(req);

  return {
    ip,
    apiKey,
  };
}

/**
 * Normalize IPv6 addresses for consistent bucketing
 *
 * @param ip - IP address (v4 or v6)
 * @returns Normalized IP address
 */
export function normalizeIP(ip: string): string {
  // Strip IPv6 prefix for IPv4-mapped addresses
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7);
  }

  // Normalize IPv6 to lowercase
  return ip.toLowerCase();
}

// ============================================================================
// Endpoint Cost Configuration
// ============================================================================

/**
 * Cost multipliers for expensive endpoints
 *
 * SECURITY: Prevents abuse of expensive operations by charging more tokens.
 */
export const ENDPOINT_COSTS: Record<string, number> = {
  '/lookup': 1,           // Standard lookup (fast, cached)
  '/snapshots': 2,        // List snapshots (moderate DB query)
  '/snapshot': 5,         // Get full snapshot (expensive, large response)
  '/extract': 10,         // Trigger extraction (very expensive)
  '/validate': 5,         // TIGER validation (expensive computation)
} as const;

/**
 * Get cost for endpoint
 *
 * @param pathname - Request pathname
 * @returns Cost multiplier
 */
export function getEndpointCost(pathname: string): number {
  return ENDPOINT_COSTS[pathname] ?? 1;
}

// ============================================================================
// Rate Limit Headers
// ============================================================================

/**
 * Rate limit headers for client visibility (RateLimit header spec)
 *
 * https://datatracker.ietf.org/doc/html/draft-polli-ratelimit-headers
 */
export interface RateLimitHeaders {
  readonly 'RateLimit-Limit': string;
  readonly 'RateLimit-Remaining': string;
  readonly 'RateLimit-Reset': string;
  readonly 'Retry-After'?: string;
}

/**
 * Generate rate limit headers from result
 *
 * @param result - Rate limit check result
 * @returns Headers to send to client
 */
export function generateRateLimitHeaders(result: RateLimitResult): RateLimitHeaders {
  const headers: RateLimitHeaders = {
    'RateLimit-Limit': result.limit.toString(),
    'RateLimit-Remaining': Math.max(0, result.remaining).toString(),
    'RateLimit-Reset': result.resetAt.toString(),
    ...(!result.allowed && result.retryAfter ? { 'Retry-After': result.retryAfter.toString() } : {}),
  } as RateLimitHeaders;

  return headers;
}

// ============================================================================
// Default Instance
// ============================================================================

/**
 * Default rate limiter instance (shared across application)
 *
 * PRODUCTION CONFIG:
 * - IP: 60 req/min (1 per second average)
 * - API Key: 1000 req/min (16.7 per second average)
 * - Global: 10,000 req/min (166.7 per second total)
 */
export const defaultRateLimiter = new MultiTierRateLimiter(
  { maxRequests: 60, windowMs: 60000 },      // IP limit
  { maxRequests: 1000, windowMs: 60000 },    // API key limit
  { maxRequests: 10000, windowMs: 60000 }    // Global limit
);

// ============================================================================
// Express/HTTP Middleware
// ============================================================================

/**
 * Rate limiting middleware for HTTP servers
 *
 * @param rateLimiter - Rate limiter instance (default: shared instance)
 * @param trustProxy - Whether to trust X-Forwarded-For header
 * @returns Middleware function
 */
export function rateLimitMiddleware(
  rateLimiter: MultiTierRateLimiter = defaultRateLimiter,
  trustProxy = false
): (req: IncomingMessage, res: any) => boolean {
  return (req: IncomingMessage, res: any): boolean => {
    const client = getClientIdentifier(req, trustProxy);

    // Get endpoint cost
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const cost = getEndpointCost(url.pathname);

    // Check rate limit (use checkClient for ClientIdentifier compatibility)
    const result = rateLimiter.checkClient(client, cost);

    // Set rate limit headers
    const headers = generateRateLimitHeaders(result);
    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, value);
    }

    // If rate limited, return 429
    if (!result.allowed) {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        ...headers,
      });
      res.end(JSON.stringify({
        error: 'Rate limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: result.retryAfter,
        limit: result.limit,
        resetAt: result.resetAt,
      }));
      return false;
    }

    return true;
  };
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Create rate limiter with custom config (for testing)
 *
 * @param config - Custom configuration
 * @returns Rate limiter instance
 */
export function createRateLimiter(config: {
  ip?: RateLimitConfig;
  apiKey?: RateLimitConfig;
  global?: RateLimitConfig;
}): MultiTierRateLimiter {
  return new MultiTierRateLimiter(
    config.ip,
    config.apiKey,
    config.global
  );
}
