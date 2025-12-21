/**
 * Fallback Strategies
 *
 * Graceful degradation when primary path fails.
 * Provides partial functionality instead of total failure.
 *
 * STRATEGIES:
 * - Static response: Pre-configured fallback value
 * - Stale cache: Serve expired cached data
 * - Degraded service: Reduced functionality
 * - Fail open: Allow through without validation
 *
 * BASED ON:
 * - Netflix fallback pattern
 * - Graceful degradation principle
 * - Cache-aside with stale-while-revalidate
 */

import type { FallbackConfig, FallbackStrategy } from './types.js';

/**
 * Fallback executor with multiple strategies
 *
 * @example
 * ```typescript
 * // Static fallback
 * const fallback = new FallbackExecutor({
 *   strategy: 'static_response',
 *   staticValue: { districts: [] },
 * });
 *
 * const result = await fallback.execute(
 *   async () => fetchFromIPFS(),
 *   staleCache // optional cached value
 * );
 *
 * // Stale cache fallback
 * const staleFallback = new FallbackExecutor({
 *   strategy: 'stale_cache',
 *   staleDataMaxAgeMs: 3600000, // 1 hour
 * });
 * ```
 */
export class FallbackExecutor<T> {
  private readonly config: FallbackConfig<T>;

  constructor(config: FallbackConfig<T>) {
    this.config = config;
  }

  /**
   * Execute with fallback on failure
   */
  async execute(
    primaryFn: () => Promise<T>,
    cachedValue?: CachedValue<T>
  ): Promise<FallbackResult<T>> {
    try {
      // Try primary path
      const result = await primaryFn();
      return {
        value: result,
        source: 'primary',
        degraded: false,
      };
    } catch (error) {
      // Primary failed - use fallback strategy
      return this.executeFallback(error, cachedValue);
    }
  }

  /**
   * Execute fallback strategy
   */
  private executeFallback(
    error: unknown,
    cachedValue?: CachedValue<T>
  ): FallbackResult<T> {
    const errorObj = error instanceof Error ? error : new Error(String(error));

    switch (this.config.strategy) {
      case 'static_response':
        return this.staticResponseFallback();

      case 'stale_cache':
        return this.staleCacheFallback(cachedValue, errorObj);

      case 'degraded_service':
        return this.degradedServiceFallback();

      case 'fail_open':
        return this.failOpenFallback();

      default:
        // No fallback configured - rethrow
        throw errorObj;
    }
  }

  /**
   * Static response fallback
   */
  private staticResponseFallback(): FallbackResult<T> {
    if (this.config.staticValue === undefined) {
      throw new Error('Static fallback configured but no static value provided');
    }

    return {
      value: this.config.staticValue,
      source: 'static_fallback',
      degraded: true,
    };
  }

  /**
   * Stale cache fallback
   */
  private staleCacheFallback(
    cachedValue: CachedValue<T> | undefined,
    error: Error
  ): FallbackResult<T> {
    if (!cachedValue) {
      throw new Error('Stale cache fallback configured but no cached value provided');
    }

    // Check if cache is too old
    const age = Date.now() - cachedValue.timestamp;
    const maxAge = this.config.staleDataMaxAgeMs ?? Infinity;

    if (age > maxAge) {
      throw new Error(
        `Cached value too old (${age}ms > ${maxAge}ms), cannot use as fallback: ${error.message}`
      );
    }

    console.warn(
      `[Fallback] Using stale cache (age: ${age}ms) due to error: ${error.message}`
    );

    return {
      value: cachedValue.value,
      source: 'stale_cache',
      degraded: true,
      cacheAge: age,
    };
  }

  /**
   * Degraded service fallback
   */
  private degradedServiceFallback(): FallbackResult<T> {
    // Return partial/limited functionality
    // Implementation depends on specific service
    throw new Error('Degraded service fallback not implemented');
  }

  /**
   * Fail open fallback
   */
  private failOpenFallback(): FallbackResult<T> {
    // Allow through without validation
    // DANGEROUS - use only when availability > correctness
    throw new Error('Fail open fallback not implemented');
  }
}

/**
 * Cached value with timestamp
 */
export interface CachedValue<T> {
  readonly value: T;
  readonly timestamp: number;
  readonly ttl?: number;
}

/**
 * Fallback result with metadata
 */
export interface FallbackResult<T> {
  readonly value: T;
  readonly source: 'primary' | 'static_fallback' | 'stale_cache' | 'degraded' | 'fail_open';
  readonly degraded: boolean;
  readonly cacheAge?: number;
}

/**
 * Create fallback executor with defaults
 */
export function createFallbackExecutor<T>(
  strategy: FallbackStrategy,
  overrides?: Partial<FallbackConfig<T>>
): FallbackExecutor<T> {
  const config: FallbackConfig<T> = {
    strategy,
    staleDataMaxAgeMs: 3600000, // 1 hour default
    degradedMode: true,
    ...overrides,
  };

  return new FallbackExecutor(config);
}

/**
 * Convenience: Execute with static fallback
 */
export async function executeWithStaticFallback<T>(
  fn: () => Promise<T>,
  fallbackValue: T
): Promise<FallbackResult<T>> {
  const executor = new FallbackExecutor<T>({
    strategy: 'static_response',
    staticValue: fallbackValue,
  });

  return executor.execute(fn);
}

/**
 * Convenience: Execute with stale cache fallback
 */
export async function executeWithStaleCache<T>(
  fn: () => Promise<T>,
  cachedValue: CachedValue<T>,
  maxAgeMs = 3600000
): Promise<FallbackResult<T>> {
  const executor = new FallbackExecutor<T>({
    strategy: 'stale_cache',
    staleDataMaxAgeMs: maxAgeMs,
  });

  return executor.execute(fn, cachedValue);
}
