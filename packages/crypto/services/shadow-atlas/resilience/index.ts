/**
 * Shadow Atlas Resilience Patterns
 *
 * Production-grade resilience infrastructure for distributed systems.
 *
 * PATTERNS:
 * - Circuit Breaker: Prevent cascade failures
 * - Retry with Backoff: Handle transient failures
 * - Bulkhead: Isolate failure domains
 * - Fallback: Graceful degradation
 * - Rate Limiting: Prevent resource exhaustion
 *
 * RELIABILITY TARGET: Graceful degradation under any single failure,
 * full recovery within 5 minutes.
 *
 * @see RESILIENCE_SPEC.md for complete specification
 */

// Types
import type {
  CircuitState,
  CircuitBreakerStats,
  CircuitBreakerConfig,
  RetryConfig,
  RetryableErrorType,
  RetryAttempt,
  BulkheadConfig,
  BulkheadStats,
  FallbackConfig,
  FallbackStrategy,
  RateLimiterConfig,
  RateLimiterStats,
  DegradationLevel,
  HealthState,
  UpstreamHealthStatus,
  TimeoutConfig,
  ChaosFault,
  ChaosFaultType,
  ChaosFaultConfig,
  ResilienceMetrics,
  ResilienceEvent,
  ResilienceEventType,
} from './types.js';

export type {
  CircuitState,
  CircuitBreakerStats,
  CircuitBreakerConfig,
  RetryConfig,
  RetryableErrorType,
  RetryAttempt,
  BulkheadConfig,
  BulkheadStats,
  FallbackConfig,
  FallbackStrategy,
  RateLimiterConfig,
  RateLimiterStats,
  DegradationLevel,
  HealthState,
  UpstreamHealthStatus,
  TimeoutConfig,
  ChaosFault,
  ChaosFaultType,
  ChaosFaultConfig,
  ResilienceMetrics,
  ResilienceEvent,
  ResilienceEventType,
};

// Circuit Breaker
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  createCircuitBreaker,
} from './circuit-breaker.js';

export {
  CircuitBreaker,
  CircuitBreakerOpenError,
  createCircuitBreaker,
};

// Retry
import {
  RetryExecutor,
  RetryExhaustedError,
  RetryTimeoutError,
  retry,
  createRetryExecutor,
} from './retry.js';

export {
  RetryExecutor,
  RetryExhaustedError,
  RetryTimeoutError,
  retry,
  createRetryExecutor,
};

// Bulkhead
import {
  Bulkhead,
  BulkheadRejectionError,
  QueueTimeoutError,
  createBulkhead,
  BulkheadRegistry,
} from './bulkhead.js';

export {
  Bulkhead,
  BulkheadRejectionError,
  QueueTimeoutError,
  createBulkhead,
  BulkheadRegistry,
};

// Fallback
import {
  FallbackExecutor,
  createFallbackExecutor,
  executeWithStaticFallback,
  executeWithStaleCache,
  type CachedValue,
  type FallbackResult
} from './fallback.js';

export type { CachedValue, FallbackResult };
export {
  FallbackExecutor,
  createFallbackExecutor,
  executeWithStaticFallback,
  executeWithStaleCache,
};

// Rate Limiter
import {
  TokenBucketRateLimiter,
  MultiClientRateLimiter,
  RateLimitExceededError,
  createRateLimiter,
  createMultiClientRateLimiter,
} from './rate-limiter.js';

export {
  TokenBucketRateLimiter,
  MultiClientRateLimiter,
  RateLimitExceededError,
  createRateLimiter,
  createMultiClientRateLimiter,
};

// Chaos Engineering
import {
  ChaosFaultInjector,
  ChaosFaultError,
  createChaosFaultInjector,
  type FaultInjectionEvent
} from './chaos/fault-injector.js';

export type { FaultInjectionEvent };
export {
  ChaosFaultInjector,
  ChaosFaultError,
  createChaosFaultInjector,
};

/**
 * Create complete resilience stack for Shadow Atlas
 *
 * @example
 * ```typescript
 * const resilience = createResilienceStack({
 *   circuitBreaker: {
 *     failureThreshold: 5,
 *     openDurationMs: 60000,
 *   },
 *   retry: {
 *     maxAttempts: 3,
 *     initialDelayMs: 100,
 *   },
 *   bulkhead: {
 *     maxConcurrent: 10,
 *     maxQueueSize: 20,
 *   },
 *   rateLimiter: {
 *     maxTokens: 100,
 *     refillRate: 10,
 *   },
 * });
 *
 * // Use combined patterns
 * const result = await resilience.execute('ipfs-gateway', async () => {
 *   return fetch('https://ipfs.io/...');
 * });
 * ```
 */
export interface ResilienceStack {
  readonly circuitBreaker: CircuitBreaker;
  readonly retry: RetryExecutor;
  readonly bulkhead: Bulkhead;
  readonly rateLimiter: TokenBucketRateLimiter;
  readonly fallback: FallbackExecutor<unknown>;
  readonly chaos?: ChaosFaultInjector;

  /**
   * Execute with all resilience patterns applied
   */
  execute<T>(
    upstreamName: string,
    fn: () => Promise<T>,
    options?: {
      fallbackValue?: T;
      cachedValue?: CachedValue<T>;
      enableChaos?: boolean;
    }
  ): Promise<T>;

  /**
   * Get health state of all resilience components
   */
  getHealthState(): HealthState;

  /**
   * Reset all resilience components
   */
  reset(): void;
}

export interface ResilienceStackConfig {
  readonly name: string;
  readonly circuitBreaker?: Partial<CircuitBreakerConfig>;
  readonly retry?: Partial<RetryConfig>;
  readonly bulkhead?: Partial<BulkheadConfig>;
  readonly rateLimiter?: Partial<RateLimiterConfig>;
  readonly enableChaos?: boolean;
}

/**
 * Create resilience stack with integrated patterns
 */
export function createResilienceStack(config: ResilienceStackConfig): ResilienceStack {
  const circuitBreaker = createCircuitBreaker(config.name, config.circuitBreaker);
  const retryExecutor = createRetryExecutor(config.retry);
  const bulkhead = createBulkhead(config.name, config.bulkhead);
  const rateLimiter = createRateLimiter(config.rateLimiter);
  const fallback = createFallbackExecutor<unknown>('static_response');
  const chaos = config.enableChaos ? createChaosFaultInjector(true) : undefined;

  return {
    circuitBreaker,
    retry: retryExecutor,
    bulkhead,
    rateLimiter,
    fallback,
    chaos,

    async execute<T>(
      upstreamName: string,
      fn: () => Promise<T>,
      options?: {
        fallbackValue?: T;
        cachedValue?: CachedValue<T>;
        enableChaos?: boolean;
      }
    ): Promise<T> {
      // Rate limiting
      if (!rateLimiter.tryConsume()) {
        throw new RateLimitExceededError(
          upstreamName,
          rateLimiter.getStats(),
          1000
        );
      }

      // Chaos injection (if enabled)
      const executeFn = async () => {
        if (chaos && options?.enableChaos) {
          return chaos.execute('network_delay', fn);
        }
        return fn();
      };

      // Circuit breaker + Retry + Bulkhead
      try {
        return await circuitBreaker.execute(async () => {
          return await retryExecutor.execute(async () => {
            return await bulkhead.execute(executeFn);
          });
        });
      } catch (error) {
        // Fallback on failure
        if (options?.fallbackValue !== undefined) {
          const fallbackExecutor = createFallbackExecutor<T>('static_response', {
            staticValue: options.fallbackValue,
          });
          const result = await fallbackExecutor.execute(
            async () => {
              throw error;
            }
          );
          return result.value;
        }

        if (options?.cachedValue !== undefined) {
          const fallbackExecutor = createFallbackExecutor<T>('stale_cache');
          const result = await fallbackExecutor.execute(
            async () => {
              throw error;
            },
            options.cachedValue
          );
          return result.value;
        }

        throw error;
      }
    },

    getHealthState(): HealthState {
      const circuitStats = circuitBreaker.getStats();
      const bulkheadStats = bulkhead.getStats();
      const rateLimiterStats = rateLimiter.getStats();

      // Determine degradation level
      let level: DegradationLevel = 'healthy';

      if (circuitStats.state === 'open') {
        level = 'critical';
      } else if (circuitStats.state === 'half-open') {
        level = 'degraded_major';
      } else if (bulkheadStats.rejectedCount > 0) {
        level = 'degraded_minor';
      }

      return {
        level,
        upstreamHealth: {
          [config.name]: {
            name: config.name,
            available: circuitStats.state === 'closed',
            latencyMs: bulkheadStats.avgExecutionMs,
            errorRate:
              circuitStats.failureCount > 0
                ? circuitStats.failureCount /
                (circuitStats.failureCount + circuitStats.successCount)
                : 0,
            lastCheckTime: circuitStats.lastStateChange,
            circuitState: circuitStats.state,
          },
        },
        activeCircuitBreakers:
          circuitStats.state === 'open' ? [config.name] : [],
        rateLimitedClients: rateLimiterStats.requestsRejected,
        timestamp: Date.now(),
      };
    },

    reset(): void {
      circuitBreaker.reset();
      bulkhead.reset();
      rateLimiter.reset();
      if (chaos) {
        chaos.reset();
      }
    },
  };
}


