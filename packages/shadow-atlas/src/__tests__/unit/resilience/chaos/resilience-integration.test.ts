/**
 * End-to-End Resilience Integration Tests
 *
 * Tests combined resilience patterns under chaos scenarios.
 * Validates production readiness and failure recovery.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createResilienceStack } from '../../../../resilience/index.js';
import type { ResilienceStack } from '../../../../resilience/index.js';
import { ChaosFaultInjector, createChaosFaultInjector } from '../../../../resilience/chaos/fault-injector.js';

describe('Resilience Integration', () => {
  let stack: ResilienceStack;
  let chaos: ChaosFaultInjector;

  beforeEach(() => {
    stack = createResilienceStack({
      name: 'test-upstream',
      circuitBreaker: {
        failureThreshold: 3,
        successThreshold: 2,
        openDurationMs: 1000,
        halfOpenMaxCalls: 2,
        monitoringWindowMs: 5000,
        volumeThreshold: 3,
      },
      retry: {
        maxAttempts: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
        jitterFactor: 0,
        retryableErrors: ['network_timeout', 'network_error'],
      },
      bulkhead: {
        maxConcurrent: 5,
        maxQueueSize: 10,
        queueTimeoutMs: 1000,
      },
      rateLimiter: {
        maxTokens: 100,
        refillRate: 10,
        refillIntervalMs: 100,
      },
      enableChaos: true,
    });

    chaos = stack.chaos!;
  });

  describe('Happy Path', () => {
    it('should execute successfully without failures', async () => {
      const result = await stack.execute('test-upstream', async () => {
        return 'success';
      });

      expect(result).toBe('success');
    });

    it('should report healthy state', () => {
      const health = stack.getHealthState();

      expect(health.level).toBe('healthy');
      expect(health.upstreamHealth['test-upstream']?.available).toBe(true);
      expect(health.activeCircuitBreakers).toHaveLength(0);
    });
  });

  describe('Transient Network Failures', () => {
    it('should retry and succeed after transient failure', async () => {
      let attempts = 0;

      const result = await stack.execute('test-upstream', async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('ETIMEDOUT'); // Retryable
        }
        return 'success';
      });

      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });

    it('should recover from intermittent failures', async () => {
      const results: string[] = [];

      // Simulate 10 requests with 30% failure rate
      for (let i = 0; i < 10; i++) {
        let attempts = 0;
        try {
          const result = await stack.execute('test-upstream', async () => {
            attempts++;
            // 30% failure on first attempt, always succeed on retry
            if (attempts === 1 && Math.random() < 0.3) {
              throw new Error('ETIMEDOUT');
            }
            return 'success';
          });
          results.push(result);
        } catch (error) {
          results.push('failed');
        }
      }

      // All requests should eventually succeed due to retry
      expect(results.filter((r) => r === 'success').length).toBeGreaterThan(7);
    });
  });

  describe('Circuit Breaker Under Load', () => {
    it('should open circuit after repeated failures', async () => {
      const results: Array<{ success: boolean; circuitOpen: boolean }> = [];

      // Cause repeated failures
      for (let i = 0; i < 10; i++) {
        try {
          await stack.execute('test-upstream', async () => {
            throw new Error('Service down');
          });
          results.push({ success: true, circuitOpen: false });
        } catch (error) {
          const health = stack.getHealthState();
          results.push({
            success: false,
            circuitOpen: health.upstreamHealth['test-upstream']?.circuitState === 'open',
          });
        }
      }

      // Circuit should open after threshold failures
      const circuitOpenedAt = results.findIndex((r) => r.circuitOpen);
      expect(circuitOpenedAt).toBeGreaterThanOrEqual(0);
      expect(circuitOpenedAt).toBeLessThan(5); // Should open within first few failures
    });

    it('should recover after circuit opens', async () => {
      // Cause circuit to open
      for (let i = 0; i < 3; i++) {
        try {
          await stack.execute('test-upstream', async () => {
            throw new Error('Service down');
          });
        } catch (error) {
          // Expected
        }
      }

      // Verify circuit is open
      expect(stack.circuitBreaker.getStats().state).toBe('open');

      // Wait for half-open timeout
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Successful requests should close circuit
      await stack.execute('test-upstream', async () => 'success');
      await stack.execute('test-upstream', async () => 'success');

      // Circuit should be closed
      expect(stack.circuitBreaker.getStats().state).toBe('closed');
    });
  });

  describe('Bulkhead Protection', () => {
    it('should limit concurrent executions', async () => {
      const concurrentCalls: number[] = [];
      let currentConcurrent = 0;
      let maxObserved = 0;

      const calls = Array(20)
        .fill(0)
        .map(async () => {
          try {
            return await stack.execute('test-upstream', async () => {
              currentConcurrent++;
              maxObserved = Math.max(maxObserved, currentConcurrent);
              concurrentCalls.push(currentConcurrent);

              await new Promise((resolve) => setTimeout(resolve, 50));

              currentConcurrent--;
              return 'success';
            });
          } catch (error) {
            currentConcurrent--;
            throw error;
          }
        });

      await Promise.allSettled(calls);

      // Max concurrent should not exceed bulkhead limit
      expect(maxObserved).toBeLessThanOrEqual(5);
    });

    it('should reject when bulkhead capacity exceeded', async () => {
      const results: Array<'success' | 'rejected'> = [];

      // Start many concurrent long-running calls
      const calls = Array(20)
        .fill(0)
        .map(async () => {
          try {
            await stack.execute('test-upstream', async () => {
              await new Promise((resolve) => setTimeout(resolve, 100));
              return 'success';
            });
            results.push('success');
          } catch (error) {
            results.push('rejected');
          }
        });

      await Promise.allSettled(calls);

      // Some should be rejected due to bulkhead limit
      expect(results.filter((r) => r === 'rejected').length).toBeGreaterThan(0);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      const results: Array<'allowed' | 'limited'> = [];

      // Make 150 rapid requests (exceeds 100 token limit)
      for (let i = 0; i < 150; i++) {
        try {
          await stack.execute('test-upstream', async () => 'success');
          results.push('allowed');
        } catch (error) {
          results.push('limited');
        }
      }

      // Some requests should be rate limited
      expect(results.filter((r) => r === 'limited').length).toBeGreaterThan(0);
    });

    it('should allow bursts within bucket capacity', async () => {
      const results: Array<'allowed' | 'limited'> = [];

      // Make 50 rapid requests (within burst capacity)
      for (let i = 0; i < 50; i++) {
        try {
          await stack.execute('test-upstream', async () => 'success');
          results.push('allowed');
        } catch (error) {
          results.push('limited');
        }
      }

      // All should be allowed within burst
      expect(results.filter((r) => r === 'allowed').length).toBe(50);
    });
  });

  describe('Fallback Strategies', () => {
    it('should use static fallback on failure', async () => {
      const result = await stack.execute(
        'test-upstream',
        async () => {
          throw new Error('Service down');
        },
        {
          fallbackValue: 'fallback-value',
        }
      );

      expect(result).toBe('fallback-value');
    });

    it('should use stale cache on failure', async () => {
      const cachedValue = {
        value: 'cached-data',
        timestamp: Date.now() - 30000, // 30 seconds old
      };

      const result = await stack.execute(
        'test-upstream',
        async () => {
          throw new Error('Service down');
        },
        {
          cachedValue,
        }
      );

      expect(result).toBe('cached-data');
    });
  });

  describe('Chaos Scenarios', () => {
    it('should handle chaos network delay', async () => {
      chaos.configureFault('network_delay', {
        enabled: true,
        probability: 1.0, // Always inject
        delayMs: 50,
      });

      const startTime = Date.now();

      const result = await stack.execute(
        'test-upstream',
        async () => 'success',
        { enableChaos: true }
      );

      const elapsed = Date.now() - startTime;

      expect(result).toBe('success');
      expect(elapsed).toBeGreaterThanOrEqual(50);
    });

    it('should recover from chaos network failures', async () => {
      chaos.configureFault('network_failure', {
        enabled: true,
        probability: 0.5, // 50% failure rate
        errorMessage: 'ECONNREFUSED',
      });

      const results: string[] = [];

      // Make 10 requests - some will fail, but retry should help
      for (let i = 0; i < 10; i++) {
        try {
          const result = await stack.execute(
            'test-upstream',
            async () => 'success',
            {
              enableChaos: true,
              fallbackValue: 'fallback',
            }
          );
          results.push(result);
        } catch (error) {
          results.push('failed');
        }
      }

      // Most should succeed or use fallback
      expect(results.filter((r) => r !== 'failed').length).toBeGreaterThan(5);
    });
  });

  describe('Health State Reporting', () => {
    it('should report degraded state during failures', async () => {
      // Cause failures
      for (let i = 0; i < 3; i++) {
        try {
          await stack.execute('test-upstream', async () => {
            throw new Error('Service down');
          });
        } catch (error) {
          // Expected
        }
      }

      const health = stack.getHealthState();

      expect(health.level).not.toBe('healthy');
      expect(health.upstreamHealth['test-upstream']?.available).toBe(false);
      expect(health.activeCircuitBreakers).toContain('test-upstream');
    });

    it('should report healthy state after recovery', async () => {
      // Cause failures
      for (let i = 0; i < 3; i++) {
        try {
          await stack.execute('test-upstream', async () => {
            throw new Error('Service down');
          });
        } catch (error) {
          // Expected
        }
      }

      // Wait for recovery
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Successful requests
      await stack.execute('test-upstream', async () => 'success');
      await stack.execute('test-upstream', async () => 'success');

      const health = stack.getHealthState();

      expect(health.level).toBe('healthy');
      expect(health.upstreamHealth['test-upstream']?.available).toBe(true);
      expect(health.activeCircuitBreakers).toHaveLength(0);
    });
  });

  describe('Production Scenarios', () => {
    it('should survive upstream total failure with fallback', async () => {
      const results: Array<{ value: string; source: string }> = [];

      // Simulate upstream total failure
      for (let i = 0; i < 100; i++) {
        try {
          const result = await stack.execute(
            'test-upstream',
            async () => {
              throw new Error('Total upstream failure');
            },
            {
              fallbackValue: 'degraded-mode',
            }
          );
          results.push({ value: result as string, source: 'fallback' });
        } catch (error) {
          results.push({ value: 'error', source: 'none' });
        }
      }

      // All should use fallback
      expect(results.filter((r) => r.value === 'degraded-mode').length).toBe(100);
    });

    it('should handle traffic spike gracefully', async () => {
      const results: Array<'success' | 'limited' | 'failed'> = [];

      // Simulate 500 concurrent requests
      const calls = Array(500)
        .fill(0)
        .map(async () => {
          try {
            await stack.execute('test-upstream', async () => {
              await new Promise((resolve) => setTimeout(resolve, 10));
              return 'success';
            });
            results.push('success');
          } catch (error) {
            if (error instanceof Error && error.name === 'RateLimitExceededError') {
              results.push('limited');
            } else {
              results.push('failed');
            }
          }
        });

      await Promise.allSettled(calls);

      // Should handle gracefully with rate limiting and bulkhead
      expect(results.filter((r) => r === 'success').length).toBeGreaterThan(0);
      expect(results.filter((r) => r === 'limited').length).toBeGreaterThan(0);
    });

    it('should recover within 5 minutes after total failure', async () => {
      // Cause total failure
      for (let i = 0; i < 10; i++) {
        try {
          await stack.execute('test-upstream', async () => {
            throw new Error('Service down');
          });
        } catch (error) {
          // Expected
        }
      }

      // Circuit should be open
      expect(stack.circuitBreaker.getStats().state).toBe('open');

      // Simulate service recovery after 1 minute
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should automatically recover
      let recovered = false;
      let attempts = 0;

      while (!recovered && attempts < 5) {
        try {
          await stack.execute('test-upstream', async () => 'success');
          recovered = true;
        } catch (error) {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 1100));
        }
      }

      expect(recovered).toBe(true);

      // Need one more successful call to fully close the circuit (successThreshold: 2)
      await stack.execute('test-upstream', async () => 'success');

      expect(stack.circuitBreaker.getStats().state).toBe('closed');
    }, 10000); // 10 second timeout for this test
  });
});
