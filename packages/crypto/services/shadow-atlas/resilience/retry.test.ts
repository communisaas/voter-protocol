/**
 * Retry with Exponential Backoff Tests
 *
 * Validates retry logic, backoff calculation, and timeout handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetryExecutor, RetryExhaustedError, RetryTimeoutError, retry, createRetryExecutor } from './retry.js';
import type { RetryConfig } from './types.js';

describe('RetryExecutor', () => {
  let config: RetryConfig;
  let executor: RetryExecutor;

  beforeEach(() => {
    config = {
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
      jitterFactor: 0,  // No jitter for deterministic tests
      retryableErrors: ['network_timeout', 'network_error', 'rate_limit'],
    };
    executor = new RetryExecutor(config);
  });

  describe('Success Cases', () => {
    it('should succeed on first attempt', async () => {
      let attempts = 0;

      const result = await executor.execute(async () => {
        attempts++;
        return 'success';
      });

      expect(result).toBe('success');
      expect(attempts).toBe(1);
    });

    it('should succeed on retry after transient failure', async () => {
      let attempts = 0;

      const result = await executor.execute(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('ETIMEDOUT');
        }
        return 'success';
      });

      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });
  });

  describe('Retry Logic', () => {
    it('should retry on network timeout', async () => {
      let attempts = 0;

      try {
        await executor.execute(async () => {
          attempts++;
          throw new Error('Connection timeout');
        });
      } catch (error) {
        expect(error).toBeInstanceOf(RetryExhaustedError);
      }

      expect(attempts).toBe(3); // Max attempts
    });

    it('should retry on network error', async () => {
      let attempts = 0;

      try {
        await executor.execute(async () => {
          attempts++;
          throw new Error('ECONNREFUSED');
        });
      } catch (error) {
        expect(error).toBeInstanceOf(RetryExhaustedError);
      }

      expect(attempts).toBe(3);
    });

    it('should retry on rate limit', async () => {
      let attempts = 0;

      try {
        await executor.execute(async () => {
          attempts++;
          throw new Error('429 Rate limit exceeded');
        });
      } catch (error) {
        expect(error).toBeInstanceOf(RetryExhaustedError);
      }

      expect(attempts).toBe(3);
    });

    it('should retry on 503 service unavailable', async () => {
      let attempts = 0;

      try {
        await executor.execute(async () => {
          attempts++;
          throw new Error('503 Service unavailable');
        });
      } catch (error) {
        expect(error).toBeInstanceOf(RetryExhaustedError);
      }

      expect(attempts).toBe(3);
    });

    it('should NOT retry on 400 bad request', async () => {
      let attempts = 0;

      try {
        await executor.execute(async () => {
          attempts++;
          throw new Error('400 Bad Request');
        });
      } catch (error) {
        expect(error).toBeInstanceOf(RetryExhaustedError);
      }

      expect(attempts).toBe(1); // No retries
    });

    it('should NOT retry on 404 not found', async () => {
      let attempts = 0;

      try {
        await executor.execute(async () => {
          attempts++;
          throw new Error('404 Not Found');
        });
      } catch (error) {
        expect(error).toBeInstanceOf(RetryExhaustedError);
      }

      expect(attempts).toBe(1); // No retries
    });
  });

  describe('Exponential Backoff', () => {
    it('should calculate exponential delays', async () => {
      const delays: number[] = [];
      let attempts = 0;

      const executor = new RetryExecutor({
        ...config,
        jitterFactor: 0,  // Disable jitter for deterministic test
      });

      // Mock sleep to capture delays
      const originalSleep = (executor as any).sleep;
      (executor as any).sleep = async (ms: number) => {
        delays.push(ms);
        return originalSleep.call(executor, 0); // Don't actually wait
      };

      try {
        await executor.execute(async () => {
          attempts++;
          throw new Error('ETIMEDOUT');
        });
      } catch (error) {
        // Expected
      }

      expect(delays.length).toBe(2); // 2 retries (after 1st and 2nd attempt)
      expect(delays[0]).toBe(100);    // 100 * 2^0 = 100
      expect(delays[1]).toBe(200);    // 100 * 2^1 = 200
    });

    it('should cap delays at maxDelayMs', async () => {
      const delays: number[] = [];

      const executor = new RetryExecutor({
        ...config,
        maxAttempts: 10,
        initialDelayMs: 100,
        maxDelayMs: 500,
        jitterFactor: 0,
      });

      // Mock sleep
      (executor as any).sleep = async (ms: number) => {
        delays.push(ms);
        return Promise.resolve();
      };

      try {
        await executor.execute(async () => {
          throw new Error('ETIMEDOUT');
        });
      } catch (error) {
        // Expected
      }

      // All delays should be capped at 500ms
      expect(delays.every((delay) => delay <= 500)).toBe(true);
    });

    it('should add jitter to delays', async () => {
      const delays: number[] = [];

      const executor = new RetryExecutor({
        ...config,
        jitterFactor: 0.1,  // 10% jitter
        maxAttempts: 5,
      });

      // Mock sleep
      (executor as any).sleep = async (ms: number) => {
        delays.push(ms);
        return Promise.resolve();
      };

      try {
        await executor.execute(async () => {
          throw new Error('ETIMEDOUT');
        });
      } catch (error) {
        // Expected
      }

      // Delays should be within jitter range
      expect(delays[0]).toBeGreaterThanOrEqual(90);   // 100 - 10%
      expect(delays[0]).toBeLessThanOrEqual(110);     // 100 + 10%
      expect(delays[1]).toBeGreaterThanOrEqual(180);  // 200 - 10%
      expect(delays[1]).toBeLessThanOrEqual(220);     // 200 + 10%
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout after total timeout exceeded', async () => {
      const executor = new RetryExecutor({
        ...config,
        timeoutMs: 500,
        maxAttempts: 10,  // More attempts than timeout allows
      });

      const startTime = Date.now();

      await expect(
        executor.execute(async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          throw new Error('ETIMEDOUT');
        })
      ).rejects.toThrow(RetryTimeoutError);

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(500);
      expect(elapsed).toBeLessThan(1000); // Should not retry indefinitely
    });

    it('should include elapsed time in timeout error', async () => {
      const executor = new RetryExecutor({
        ...config,
        timeoutMs: 100,
      });

      try {
        await executor.execute(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          throw new Error('ETIMEDOUT');
        });
      } catch (error) {
        expect(error).toBeInstanceOf(RetryTimeoutError);
        if (error instanceof RetryTimeoutError) {
          expect(error.timeoutMs).toBe(100);
          expect(error.elapsedMs).toBeGreaterThanOrEqual(100);
        }
      }
    });
  });

  describe('RetryExhaustedError', () => {
    it('should include all attempts in error', async () => {
      try {
        await executor.execute(async () => {
          throw new Error('ETIMEDOUT');
        });
      } catch (error) {
        expect(error).toBeInstanceOf(RetryExhaustedError);
        if (error instanceof RetryExhaustedError) {
          expect(error.attempts).toHaveLength(3);
          expect(error.attempts[0]?.attemptNumber).toBe(1);
          expect(error.attempts[1]?.attemptNumber).toBe(2);
          expect(error.attempts[2]?.attemptNumber).toBe(3);
        }
      }
    });

    it('should include last error', async () => {
      try {
        await executor.execute(async () => {
          throw new Error('Final error');
        });
      } catch (error) {
        expect(error).toBeInstanceOf(RetryExhaustedError);
        if (error instanceof RetryExhaustedError) {
          expect(error.lastError.message).toBe('Final error');
        }
      }
    });

    it('should mark retryable errors', async () => {
      try {
        await executor.execute(async () => {
          throw new Error('ETIMEDOUT'); // Retryable
        });
      } catch (error) {
        expect(error).toBeInstanceOf(RetryExhaustedError);
        if (error instanceof RetryExhaustedError) {
          expect(error.attempts.every((a) => a.retryable)).toBe(true);
        }
      }
    });

    it('should mark non-retryable errors', async () => {
      try {
        await executor.execute(async () => {
          throw new Error('400 Bad Request'); // Not retryable
        });
      } catch (error) {
        expect(error).toBeInstanceOf(RetryExhaustedError);
        if (error instanceof RetryExhaustedError) {
          expect(error.attempts[0]?.retryable).toBe(false);
        }
      }
    });
  });

  describe('Convenience Functions', () => {
    it('should retry with default config', async () => {
      let attempts = 0;

      const result = await retry(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('ETIMEDOUT');
        }
        return 'success';
      });

      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });

    it('should allow config overrides', async () => {
      let attempts = 0;

      try {
        await retry(
          async () => {
            attempts++;
            throw new Error('ETIMEDOUT');
          },
          { maxAttempts: 5 }
        );
      } catch (error) {
        // Expected
      }

      expect(attempts).toBe(5); // Custom max attempts
    });
  });

  describe('Factory Function', () => {
    it('should create executor with defaults', () => {
      const executor = createRetryExecutor();
      expect(executor).toBeInstanceOf(RetryExecutor);
    });

    it('should allow overriding defaults', () => {
      const executor = createRetryExecutor({
        maxAttempts: 5,
      });

      expect(executor).toBeInstanceOf(RetryExecutor);
    });
  });

  describe('Error Classification', () => {
    it('should classify timeout errors', async () => {
      const executor = new RetryExecutor({
        ...config,
        retryableErrors: ['network_timeout'],
      });

      let attempts = 0;

      try {
        await executor.execute(async () => {
          attempts++;
          const error = new Error('Operation timeout');
          error.name = 'TimeoutError';
          throw error;
        });
      } catch (error) {
        // Expected
      }

      expect(attempts).toBe(3); // Retried
    });

    it('should classify network errors', async () => {
      const executor = new RetryExecutor({
        ...config,
        retryableErrors: ['network_error'],
      });

      let attempts = 0;

      try {
        await executor.execute(async () => {
          attempts++;
          const error = new Error('Connection failed');
          error.name = 'NetworkError';
          throw error;
        });
      } catch (error) {
        // Expected
      }

      expect(attempts).toBe(3); // Retried
    });
  });
});
