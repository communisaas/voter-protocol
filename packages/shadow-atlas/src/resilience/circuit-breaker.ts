/**
 * Circuit Breaker Implementation
 *
 * Prevents cascade failures by monitoring upstream dependencies.
 * Implements finite state machine: closed → open → half-open → closed
 *
 * DESIGN:
 * - Fail fast when upstream is unhealthy (open state)
 * - Gradual recovery testing (half-open state)
 * - Automatic recovery on sustained success
 *
 * BASED ON:
 * - Netflix Hystrix circuit breaker pattern
 * - Release It! by Michael Nygard
 * - Martin Fowler's CircuitBreaker pattern
 */

import type {
  CircuitState,
  CircuitBreakerStats,
  CircuitBreakerConfig,
  ResilienceEvent,
} from './types.js';
import { logger } from '../core/utils/logger.js';

/**
 * Circuit breaker error (thrown when circuit is open)
 */
export class CircuitBreakerOpenError extends Error {
  readonly circuitName: string;
  readonly stats: CircuitBreakerStats;

  constructor(circuitName: string, stats: CircuitBreakerStats) {
    super(`Circuit breaker '${circuitName}' is open`);
    this.name = 'CircuitBreakerOpenError';
    this.circuitName = circuitName;
    this.stats = stats;
  }
}

/**
 * Circuit Breaker
 *
 * Protects against cascading failures by monitoring error rates
 * and temporarily blocking requests when thresholds are exceeded.
 *
 * @example
 * ```typescript
 * const breaker = new CircuitBreaker({
 *   name: 'ipfs-gateway',
 *   failureThreshold: 5,
 *   successThreshold: 2,
 *   openDurationMs: 60000,
 *   halfOpenMaxCalls: 3,
 *   monitoringWindowMs: 60000,
 *   volumeThreshold: 10,
 * });
 *
 * try {
 *   const result = await breaker.execute(async () => {
 *     return fetch('https://ipfs.io/...');
 *   });
 * } catch (error) {
 *   if (error instanceof CircuitBreakerOpenError) {
 *     // Use fallback
 *   }
 * }
 * ```
 */
export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private lastFailureTime: number | null = null;
  private lastStateChange: number = Date.now();
  private halfOpenCalls = 0;
  private readonly recentCalls: Array<{ success: boolean; timestamp: number }> = [];
  private readonly eventListeners: Array<(event: ResilienceEvent) => void> = [];

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  /**
   * Execute function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit allows execution
    this.checkState();

    // Track call in half-open state
    if (this.state === 'half-open') {
      this.halfOpenCalls++;
    }

    const startTime = Date.now();

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      // Cleanup monitoring window
      this.cleanupRecentCalls();
    }
  }

  /**
   * Check circuit state and determine if execution is allowed
   */
  private checkState(): void {
    const now = Date.now();

    switch (this.state) {
      case 'closed':
        // Normal operation
        return;

      case 'open':
        // Check if enough time has passed to try half-open
        if (now - this.lastStateChange >= this.config.openDurationMs) {
          this.transitionTo('half-open');
          this.halfOpenCalls = 0;
        } else {
          throw new CircuitBreakerOpenError(this.config.name, this.getStats());
        }
        return;

      case 'half-open':
        // Limit concurrent calls in half-open state
        if (this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
          throw new CircuitBreakerOpenError(this.config.name, this.getStats());
        }
        return;
    }
  }

  /**
   * Record successful execution
   */
  private recordSuccess(): void {
    this.successCount++;
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;

    this.recentCalls.push({ success: true, timestamp: Date.now() });

    // State transitions on success
    if (this.state === 'half-open') {
      this.halfOpenCalls--;
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        this.transitionTo('closed');
      }
    }
  }

  /**
   * Record failed execution
   */
  private recordFailure(error: Error): void {
    this.failureCount++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = Date.now();

    this.recentCalls.push({ success: false, timestamp: Date.now() });

    // State transitions on failure
    if (this.state === 'half-open') {
      this.halfOpenCalls--;
      // Single failure in half-open → back to open
      this.transitionTo('open');
    } else if (this.state === 'closed') {
      // Check if we should open circuit
      if (this.shouldOpenCircuit()) {
        this.transitionTo('open');
      }
    }
  }

  /**
   * Determine if circuit should open based on failure threshold
   */
  private shouldOpenCircuit(): boolean {
    // Need minimum volume before opening
    if (this.recentCalls.length < this.config.volumeThreshold) {
      return false;
    }

    // Check consecutive failures
    if (this.consecutiveFailures >= this.config.failureThreshold) {
      return true;
    }

    // Check failure rate in monitoring window
    const failuresInWindow = this.recentCalls.filter((call) => !call.success).length;
    const failureRate = failuresInWindow / this.recentCalls.length;
    const thresholdRate = this.config.failureThreshold / this.config.volumeThreshold;

    return failureRate >= thresholdRate;
  }

  /**
   * Transition to new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    // Reset counters on state change
    if (newState === 'closed') {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses = 0;
      this.halfOpenCalls = 0;
    } else if (newState === 'half-open') {
      this.consecutiveSuccesses = 0;
      this.halfOpenCalls = 0;
    }

    // Emit event
    this.emitEvent({
      type:
        newState === 'open'
          ? 'circuit_opened'
          : newState === 'closed'
          ? 'circuit_closed'
          : 'circuit_half_open',
      component: this.config.name,
      timestamp: Date.now(),
      metadata: {
        oldState,
        newState,
        failureCount: this.failureCount,
        successCount: this.successCount,
        consecutiveFailures: this.consecutiveFailures,
      },
    });
  }

  /**
   * Clean up calls outside monitoring window
   */
  private cleanupRecentCalls(): void {
    const now = Date.now();
    const cutoff = now - this.config.monitoringWindowMs;

    // Remove calls outside window
    while (this.recentCalls.length > 0 && this.recentCalls[0]!.timestamp < cutoff) {
      this.recentCalls.shift();
    }
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastStateChange: this.lastStateChange,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
    };
  }

  /**
   * Force circuit to specific state (for testing/admin)
   */
  forceState(state: CircuitState): void {
    this.transitionTo(state);
  }

  /**
   * Reset circuit breaker to initial state
   */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = null;
    this.lastStateChange = Date.now();
    this.halfOpenCalls = 0;
    this.recentCalls.length = 0;
  }

  /**
   * Subscribe to circuit breaker events
   */
  onEvent(listener: (event: ResilienceEvent) => void): () => void {
    this.eventListeners.push(listener);

    // Return unsubscribe function
    return () => {
      const index = this.eventListeners.indexOf(listener);
      if (index !== -1) {
        this.eventListeners.splice(index, 1);
      }
    };
  }

  /**
   * Emit resilience event to listeners
   */
  private emitEvent(event: ResilienceEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error('CircuitBreaker event listener error', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

/**
 * Create circuit breaker with defaults for Shadow Atlas
 */
export function createCircuitBreaker(
  name: string,
  overrides?: Partial<CircuitBreakerConfig>
): CircuitBreaker {
  const config: CircuitBreakerConfig = {
    name,
    failureThreshold: 5,
    successThreshold: 2,
    openDurationMs: 60000, // 1 minute
    halfOpenMaxCalls: 3,
    monitoringWindowMs: 60000, // 1 minute window
    volumeThreshold: 10,
    ...overrides,
  };

  return new CircuitBreaker(config);
}
