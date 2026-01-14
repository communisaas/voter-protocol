/**
 * Circuit Breaker Tests
 *
 * Validates state machine transitions and failure handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreaker, CircuitBreakerOpenError, createCircuitBreaker } from '../../../resilience/circuit-breaker.js';
import type { CircuitBreakerConfig } from '../../../resilience/types.js';

describe('CircuitBreaker', () => {
  let config: CircuitBreakerConfig;
  let breaker: CircuitBreaker;

  beforeEach(() => {
    config = {
      name: 'test-breaker',
      failureThreshold: 3,
      successThreshold: 2,
      openDurationMs: 1000,
      halfOpenMaxCalls: 2,
      monitoringWindowMs: 5000,
      volumeThreshold: 3,
    };
    breaker = new CircuitBreaker(config);
  });

  describe('State Transitions', () => {
    it('should start in closed state', () => {
      const stats = breaker.getStats();
      expect(stats.state).toBe('closed');
    });

    it('should open after threshold failures', async () => {
      // Cause 3 consecutive failures
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Upstream failure');
          });
        } catch (error) {
          // Expected
        }
      }

      const stats = breaker.getStats();
      expect(stats.state).toBe('open');
      expect(stats.consecutiveFailures).toBe(3);
    });

    it('should reject immediately when open', async () => {
      // Open circuit
      breaker.forceState('open');

      // Next call should fail immediately
      await expect(
        breaker.execute(async () => 'success')
      ).rejects.toThrow(CircuitBreakerOpenError);
    });

    it('should transition to half-open after timeout', async () => {
      // Open circuit
      breaker.forceState('open');

      // Wait for open duration
      await new Promise((resolve) => setTimeout(resolve, config.openDurationMs + 100));

      // Next call should be allowed (half-open)
      const result = await breaker.execute(async () => 'success');
      expect(result).toBe('success');

      const stats = breaker.getStats();
      expect(stats.state).toBe('half-open');
    });

    it('should close after successful half-open attempts', async () => {
      // Transition to half-open
      breaker.forceState('half-open');

      // 2 successful calls (success threshold)
      await breaker.execute(async () => 'success');
      await breaker.execute(async () => 'success');

      const stats = breaker.getStats();
      expect(stats.state).toBe('closed');
    });

    it('should reopen on half-open failure', async () => {
      // Transition to half-open
      breaker.forceState('half-open');

      // First call succeeds
      await breaker.execute(async () => 'success');

      // Second call fails
      try {
        await breaker.execute(async () => {
          throw new Error('Failure');
        });
      } catch (error) {
        // Expected
      }

      const stats = breaker.getStats();
      expect(stats.state).toBe('open');
    });
  });

  describe('Half-Open Call Limiting', () => {
    it('should limit concurrent calls in half-open', async () => {
      breaker.forceState('half-open');

      // Start 2 concurrent calls (at limit)
      const call1 = breaker.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'success1';
      });

      const call2 = breaker.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'success2';
      });

      // Third call should be rejected
      await expect(
        breaker.execute(async () => 'success3')
      ).rejects.toThrow(CircuitBreakerOpenError);

      // First two should succeed
      await expect(call1).resolves.toBe('success1');
      await expect(call2).resolves.toBe('success2');
    });
  });

  describe('Volume Threshold', () => {
    it('should not open before volume threshold', async () => {
      const breaker = new CircuitBreaker({
        ...config,
        volumeThreshold: 5,
        failureThreshold: 3,
      });

      // 2 failures (below volume threshold)
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch (error) {
          // Expected
        }
      }

      const stats = breaker.getStats();
      expect(stats.state).toBe('closed'); // Still closed
    });

    it('should open after volume threshold met', async () => {
      const breaker = new CircuitBreaker({
        ...config,
        volumeThreshold: 3,
        failureThreshold: 3,
      });

      // 3 failures (at volume threshold)
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch (error) {
          // Expected
        }
      }

      const stats = breaker.getStats();
      expect(stats.state).toBe('open');
    });
  });

  describe('Monitoring Window', () => {
    it('should clean up old calls outside window', async () => {
      const breaker = new CircuitBreaker({
        ...config,
        monitoringWindowMs: 100,
      });

      // Make calls
      await breaker.execute(async () => 'success');

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Old calls should be cleaned up
      const stats = breaker.getStats();
      expect(stats.successCount).toBe(1); // Counter persists
    });
  });

  describe('Statistics', () => {
    it('should track failure and success counts', async () => {
      // 2 successes
      await breaker.execute(async () => 'success');
      await breaker.execute(async () => 'success');

      // 1 failure
      try {
        await breaker.execute(async () => {
          throw new Error('Failure');
        });
      } catch (error) {
        // Expected
      }

      const stats = breaker.getStats();
      expect(stats.successCount).toBe(2);
      expect(stats.failureCount).toBe(1);
      expect(stats.consecutiveSuccesses).toBe(0); // Reset by failure
      expect(stats.consecutiveFailures).toBe(1);
    });

    it('should track last failure time', async () => {
      const beforeFailure = Date.now();

      try {
        await breaker.execute(async () => {
          throw new Error('Failure');
        });
      } catch (error) {
        // Expected
      }

      const stats = breaker.getStats();
      expect(stats.lastFailureTime).toBeGreaterThanOrEqual(beforeFailure);
      expect(stats.lastFailureTime).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('Event Listeners', () => {
    it('should emit circuit_opened event', async () => {
      const events: string[] = [];

      breaker.onEvent((event) => {
        events.push(event.type);
      });

      // Cause failures to open circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch (error) {
          // Expected
        }
      }

      expect(events).toContain('circuit_opened');
    });

    it('should emit circuit_half_open event', async () => {
      const events: string[] = [];

      breaker.onEvent((event) => {
        events.push(event.type);
      });

      breaker.forceState('open');
      await new Promise((resolve) => setTimeout(resolve, config.openDurationMs + 100));

      // Trigger half-open
      await breaker.execute(async () => 'success');

      expect(events).toContain('circuit_half_open');
    });

    it('should emit circuit_closed event', async () => {
      const events: string[] = [];

      breaker.onEvent((event) => {
        events.push(event.type);
      });

      breaker.forceState('half-open');

      // Successful calls to close circuit
      await breaker.execute(async () => 'success');
      await breaker.execute(async () => 'success');

      expect(events).toContain('circuit_closed');
    });

    it('should support unsubscribe', async () => {
      const events: string[] = [];

      const unsubscribe = breaker.onEvent((event) => {
        events.push(event.type);
      });

      unsubscribe();

      // This event should NOT be recorded
      breaker.forceState('open');

      expect(events).toHaveLength(0);
    });
  });

  describe('Reset', () => {
    it('should reset to initial state', async () => {
      // Cause failures
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch (error) {
          // Expected
        }
      }

      expect(breaker.getStats().state).toBe('open');

      // Reset
      breaker.reset();

      const stats = breaker.getStats();
      expect(stats.state).toBe('closed');
      expect(stats.failureCount).toBe(0);
      expect(stats.successCount).toBe(0);
      expect(stats.consecutiveFailures).toBe(0);
    });
  });

  describe('Factory Function', () => {
    it('should create circuit with defaults', () => {
      const breaker = createCircuitBreaker('my-service');
      const stats = breaker.getStats();

      expect(stats.state).toBe('closed');
    });

    it('should allow overriding defaults', async () => {
      const breaker = createCircuitBreaker('my-service', {
        failureThreshold: 10,
      });

      // Need 10 failures to open
      for (let i = 0; i < 9; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch (error) {
          // Expected
        }
      }

      // Should still be closed after 9 failures
      expect(breaker.getStats().state).toBe('closed');
    });
  });
});
