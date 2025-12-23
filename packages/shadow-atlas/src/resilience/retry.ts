/**
 * Retry with Exponential Backoff
 *
 * Retries failed operations with exponential backoff and jitter.
 * Prevents thundering herd problem and respects upstream rate limits.
 *
 * DESIGN:
 * - Exponential backoff: delay = base * (multiplier ^ attempt)
 * - Jitter: randomness prevents synchronized retries
 * - Timeout: abort if taking too long
 * - Retry predicates: only retry transient failures
 *
 * BASED ON:
 * - AWS SDK exponential backoff
 * - Google Cloud Retry Strategy
 * - "Exponential Backoff And Jitter" (AWS Architecture Blog)
 */

import type { RetryConfig, RetryAttempt, RetryableErrorType } from './types.js';

/**
 * Retry exhausted error (thrown after max attempts)
 */
export class RetryExhaustedError extends Error {
  readonly attempts: readonly RetryAttempt[];
  readonly lastError: Error;

  constructor(attempts: readonly RetryAttempt[], lastError: Error) {
    super(`Retry exhausted after ${attempts.length} attempts: ${lastError.message}`);
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

/**
 * Retry timeout error (thrown when total time exceeds timeout)
 */
export class RetryTimeoutError extends Error {
  readonly elapsedMs: number;
  readonly timeoutMs: number;

  constructor(elapsedMs: number, timeoutMs: number) {
    super(`Retry timeout after ${elapsedMs}ms (limit: ${timeoutMs}ms)`);
    this.name = 'RetryTimeoutError';
    this.elapsedMs = elapsedMs;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Retry executor with exponential backoff
 *
 * @example
 * ```typescript
 * const retry = new RetryExecutor({
 *   maxAttempts: 3,
 *   initialDelayMs: 100,
 *   maxDelayMs: 5000,
 *   backoffMultiplier: 2,
 *   jitterFactor: 0.1,
 *   retryableErrors: ['network_timeout', 'rate_limit'],
 *   timeoutMs: 30000,
 * });
 *
 * const result = await retry.execute(async () => {
 *   return fetch('https://upstream.example.com/api');
 * });
 * ```
 */
export class RetryExecutor {
  private readonly config: RetryConfig;

  constructor(config: RetryConfig) {
    this.config = config;
  }

  /**
   * Execute function with retry logic
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const attempts: RetryAttempt[] = [];
    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      // Check timeout
      const elapsed = Date.now() - startTime;
      if (this.config.timeoutMs && elapsed >= this.config.timeoutMs) {
        throw new RetryTimeoutError(elapsed, this.config.timeoutMs);
      }

      try {
        // Execute function
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Determine if error is retryable
        const errorType = this.classifyError(lastError);
        const retryable = errorType !== null && this.config.retryableErrors.includes(errorType);

        // Calculate backoff delay
        const delay = this.calculateDelay(attempt);

        // Record attempt
        const attemptRecord: RetryAttempt = {
          attemptNumber: attempt,
          delayMs: delay,
          totalElapsedMs: Date.now() - startTime,
          error: lastError,
          retryable,
        };
        attempts.push(attemptRecord);

        // If not retryable or last attempt, throw
        if (!retryable || attempt === this.config.maxAttempts) {
          throw new RetryExhaustedError(attempts, lastError);
        }

        // Wait before retry
        await this.sleep(delay);
      }
    }

    // Should never reach here, but TypeScript needs it
    throw new RetryExhaustedError(attempts, lastError ?? new Error('Unknown error'));
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  private calculateDelay(attempt: number): number {
    // Base exponential backoff: initialDelay * (multiplier ^ (attempt - 1))
    const exponentialDelay = this.config.initialDelayMs * Math.pow(this.config.backoffMultiplier, attempt - 1);

    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelayMs);

    // Add jitter to prevent thundering herd
    // Jitter range: [delay * (1 - jitterFactor), delay * (1 + jitterFactor)]
    const jitterRange = cappedDelay * this.config.jitterFactor;
    const jitter = Math.random() * 2 * jitterRange - jitterRange;

    return Math.max(0, Math.floor(cappedDelay + jitter));
  }

  /**
   * Classify error into retry type
   */
  private classifyError(error: Error): RetryableErrorType | null {
    const message = error.message.toLowerCase();

    // Network timeouts
    if (
      message.includes('timeout') ||
      message.includes('etimedout') ||
      error.name === 'TimeoutError'
    ) {
      return 'network_timeout';
    }

    // Network errors
    if (
      message.includes('network') ||
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('enetunreach') ||
      error.name === 'NetworkError'
    ) {
      return 'network_error';
    }

    // Rate limiting
    if (message.includes('rate limit') || message.includes('429')) {
      return 'rate_limit';
    }

    // Service unavailable
    if (message.includes('503') || message.includes('service unavailable')) {
      return 'service_unavailable';
    }

    // Gateway timeout
    if (message.includes('504') || message.includes('gateway timeout')) {
      return 'gateway_timeout';
    }

    // Temporary failures (circuit breaker open, etc.)
    if (message.includes('temporary') || message.includes('circuit breaker')) {
      return 'temporary_failure';
    }

    // Unknown error - not retryable
    return null;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Convenience function: retry with default config
 */
export async function retry<T>(
  fn: () => Promise<T>,
  config?: Partial<RetryConfig>
): Promise<T> {
  const executor = new RetryExecutor({
    maxAttempts: 3,
    initialDelayMs: 100,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    jitterFactor: 0.1,
    retryableErrors: [
      'network_timeout',
      'network_error',
      'rate_limit',
      'service_unavailable',
      'gateway_timeout',
      'temporary_failure',
    ],
    ...config,
  });

  return executor.execute(fn);
}

/**
 * Create retry executor with Shadow Atlas defaults
 */
export function createRetryExecutor(
  overrides?: Partial<RetryConfig>
): RetryExecutor {
  const config: RetryConfig = {
    maxAttempts: 3,
    initialDelayMs: 100,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    jitterFactor: 0.1,
    retryableErrors: [
      'network_timeout',
      'network_error',
      'rate_limit',
      'service_unavailable',
      'gateway_timeout',
      'temporary_failure',
    ],
    timeoutMs: 30000, // 30 seconds total
    ...overrides,
  };

  return new RetryExecutor(config);
}
