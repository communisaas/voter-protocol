/**
 * Multi-Project API Key Rotator
 *
 * Manages multiple API keys across different Google Cloud projects
 * to effectively scale beyond per-project rate limits.
 *
 * Key insight: Rate limits are per-PROJECT, not per-key.
 * Multiple keys in the same project share the same quota.
 * Real scaling requires keys from different projects.
 */

export interface KeyConfig {
  /** API key */
  readonly key: string;
  /** Google Cloud project ID (for tracking) */
  readonly projectId: string;
  /** Tier level affects rate limits */
  readonly tier: 'free' | 'tier1' | 'tier2' | 'tier3';
  /** Optional label for debugging */
  readonly label?: string;
}

interface KeyState {
  config: KeyConfig;
  /** Timestamp when rate limit expires (0 = not limited) */
  rateLimitedUntil: number;
  /** Consecutive error count */
  errorCount: number;
  /** Request count since last reset */
  requestCount: number;
  /** Last daily reset timestamp */
  lastDailyReset: number;
}

/**
 * Rate limits by tier (requests per day)
 */
const TIER_LIMITS: Record<KeyConfig['tier'], { rpm: number; rpd: number }> = {
  free: { rpm: 10, rpd: 500 },
  tier1: { rpm: 1000, rpd: 10000 },
  tier2: { rpm: 2000, rpd: 20000 },
  tier3: { rpm: 3000, rpd: 100000 },
};

export class RateLimitError extends Error {
  constructor(
    public readonly retryAfterMs: number,
    public readonly projectId: string
  ) {
    super(`Rate limited. Retry after ${Math.ceil(retryAfterMs / 1000)}s`);
    this.name = 'RateLimitError';
  }
}

export class AllKeysExhaustedError extends Error {
  constructor(public readonly soonestRetryMs: number) {
    super(`All API keys rate limited. Soonest retry: ${Math.ceil(soonestRetryMs / 1000)}s`);
    this.name = 'AllKeysExhaustedError';
  }
}

/**
 * Key Rotator with rate limit awareness
 *
 * Features:
 * - Round-robin distribution across projects
 * - Automatic rate limit detection and backoff
 * - Daily request counting per project
 * - Circuit breaker for failing keys
 */
export class KeyRotator {
  private keys: KeyState[];
  private currentIndex: number = 0;

  constructor(configs: readonly KeyConfig[]) {
    if (configs.length === 0) {
      throw new Error('At least one API key required');
    }

    this.keys = configs.map(config => ({
      config,
      rateLimitedUntil: 0,
      errorCount: 0,
      requestCount: 0,
      lastDailyReset: Date.now(),
    }));
  }

  /**
   * Get next available key using round-robin with rate limit awareness
   *
   * @throws AllKeysExhaustedError if all keys are rate limited
   */
  getNextKey(): { key: string; projectId: string } {
    const now = Date.now();

    // Reset daily counters if needed
    this.resetDailyCountersIfNeeded(now);

    // Try to find an available key starting from current index
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.currentIndex + i) % this.keys.length;
      const keyState = this.keys[idx];

      // Skip if rate limited
      if (keyState.rateLimitedUntil > now) {
        continue;
      }

      // Skip if at daily limit
      const limits = TIER_LIMITS[keyState.config.tier];
      if (keyState.requestCount >= limits.rpd) {
        continue;
      }

      // Found available key
      this.currentIndex = (idx + 1) % this.keys.length;
      keyState.requestCount++;

      return {
        key: keyState.config.key,
        projectId: keyState.config.projectId,
      };
    }

    // All keys exhausted - find soonest retry
    const soonestRetry = Math.min(
      ...this.keys.map(k => {
        if (k.rateLimitedUntil > now) {
          return k.rateLimitedUntil - now;
        }
        // At daily limit - retry at midnight UTC
        const tomorrow = new Date();
        tomorrow.setUTCHours(24, 0, 0, 0);
        return tomorrow.getTime() - now;
      })
    );

    throw new AllKeysExhaustedError(soonestRetry);
  }

  /**
   * Mark a key as rate limited
   *
   * @param key The API key that was rate limited
   * @param retryAfterMs How long to wait before retrying (default: 60s)
   */
  markRateLimited(key: string, retryAfterMs: number = 60000): void {
    const keyState = this.keys.find(k => k.config.key === key);
    if (keyState) {
      keyState.rateLimitedUntil = Date.now() + retryAfterMs;
      keyState.errorCount++;

      console.warn(
        `[KeyRotator] Key ${keyState.config.label ?? keyState.config.projectId} ` +
        `rate limited for ${Math.ceil(retryAfterMs / 1000)}s ` +
        `(errors: ${keyState.errorCount})`
      );
    }
  }

  /**
   * Mark a successful request (reset error count)
   */
  markSuccess(key: string): void {
    const keyState = this.keys.find(k => k.config.key === key);
    if (keyState) {
      keyState.errorCount = 0;
    }
  }

  /**
   * Get current status of all keys
   */
  getStatus(): {
    totalKeys: number;
    availableKeys: number;
    rateLimitedKeys: number;
    totalRequestsToday: number;
    keys: Array<{
      projectId: string;
      tier: string;
      available: boolean;
      requestsToday: number;
      dailyLimit: number;
      rateLimitedUntil: number | null;
    }>;
  } {
    const now = Date.now();
    this.resetDailyCountersIfNeeded(now);

    const keyStatuses = this.keys.map(k => {
      const limits = TIER_LIMITS[k.config.tier];
      const available = k.rateLimitedUntil <= now && k.requestCount < limits.rpd;

      return {
        projectId: k.config.projectId,
        tier: k.config.tier,
        available,
        requestsToday: k.requestCount,
        dailyLimit: limits.rpd,
        rateLimitedUntil: k.rateLimitedUntil > now ? k.rateLimitedUntil : null,
      };
    });

    return {
      totalKeys: this.keys.length,
      availableKeys: keyStatuses.filter(k => k.available).length,
      rateLimitedKeys: keyStatuses.filter(k => !k.available).length,
      totalRequestsToday: keyStatuses.reduce((sum, k) => sum + k.requestsToday, 0),
      keys: keyStatuses,
    };
  }

  /**
   * Reset daily counters at UTC midnight
   */
  private resetDailyCountersIfNeeded(now: number): void {
    const todayMidnight = new Date();
    todayMidnight.setUTCHours(0, 0, 0, 0);
    const midnightMs = todayMidnight.getTime();

    for (const keyState of this.keys) {
      if (keyState.lastDailyReset < midnightMs) {
        keyState.requestCount = 0;
        keyState.lastDailyReset = now;
      }
    }
  }
}

/**
 * Create key rotator from environment variables
 *
 * Expected format:
 * GEMINI_KEYS=project1:key1:tier1,project2:key2:free,project3:key3:tier2
 */
export function createKeyRotatorFromEnv(envVar: string = 'GEMINI_KEYS'): KeyRotator {
  const keysString = process.env[envVar];
  if (!keysString) {
    throw new Error(`Environment variable ${envVar} not set`);
  }

  const configs: KeyConfig[] = keysString.split(',').map((entry, i) => {
    const parts = entry.trim().split(':');
    if (parts.length < 2) {
      throw new Error(`Invalid key format at index ${i}: expected "projectId:key[:tier]"`);
    }

    const [projectId, key, tierStr] = parts;
    const tier = (tierStr as KeyConfig['tier']) || 'free';

    if (!['free', 'tier1', 'tier2', 'tier3'].includes(tier)) {
      throw new Error(`Invalid tier "${tier}" at index ${i}`);
    }

    return {
      projectId,
      key,
      tier,
      label: `key-${i + 1}`,
    };
  });

  return new KeyRotator(configs);
}
