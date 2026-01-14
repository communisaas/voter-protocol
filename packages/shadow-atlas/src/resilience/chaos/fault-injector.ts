/**
 * Chaos Engineering Fault Injector
 *
 * Controlled fault injection for testing resilience patterns.
 * Simulates production failure modes in safe testing environments.
 *
 * DESIGN:
 * - Probability-based fault injection
 * - Multiple fault types (network, upstream, data)
 * - Enable/disable per fault type
 * - Observable injection events
 *
 * BASED ON:
 * - Netflix Chaos Monkey
 * - Gremlin chaos engineering platform
 * - Principles of Chaos Engineering (O'Reilly)
 *
 * WARNING: Only enable in testing/staging environments!
 */

import type { ChaosFault, ChaosFaultType, ChaosFaultConfig } from '../types.js';
import { logger } from '../../core/utils/logger.js';

/**
 * Chaos fault injection error
 */
export class ChaosFaultError extends Error {
  readonly faultType: ChaosFaultType;
  readonly injected: boolean = true;

  constructor(faultType: ChaosFaultType, message: string) {
    super(`[CHAOS] ${message}`);
    this.name = 'ChaosFaultError';
    this.faultType = faultType;
  }
}

/**
 * Fault injection event
 */
export interface FaultInjectionEvent {
  readonly faultType: ChaosFaultType;
  readonly timestamp: number;
  readonly config: ChaosFaultConfig;
}

/**
 * Chaos Fault Injector
 *
 * Probabilistic fault injection for testing resilience.
 *
 * @example
 * ```typescript
 * const injector = new ChaosFaultInjector();
 *
 * // Configure network delay fault
 * injector.configureFault('network_delay', {
 *   enabled: true,
 *   probability: 0.2, // 20% of requests
 *   delayMs: 1000,
 * });
 *
 * // Execute with potential fault injection
 * await injector.execute('network_delay', async () => {
 *   return fetch('https://upstream.example.com');
 * });
 * ```
 */
export class ChaosFaultInjector {
  private readonly faults = new Map<ChaosFaultType, ChaosFault>();
  private readonly eventListeners: Array<(event: FaultInjectionEvent) => void> = [];
  private enabled = false;

  constructor(globalEnabled = false) {
    this.enabled = globalEnabled;
  }

  /**
   * Configure fault injection for specific fault type
   */
  configureFault(
    type: ChaosFaultType,
    config: ChaosFaultConfig & { probability: number; enabled: boolean }
  ): void {
    this.faults.set(type, {
      type,
      probability: config.probability,
      enabled: config.enabled,
      config,
    });
  }

  /**
   * Execute function with potential fault injection
   */
  async execute<T>(faultType: ChaosFaultType, fn: () => Promise<T>): Promise<T> {
    // Check if fault injection globally enabled
    if (!this.enabled) {
      return fn();
    }

    // Check if this fault type is configured and enabled
    const fault = this.faults.get(faultType);
    if (!fault || !fault.enabled) {
      return fn();
    }

    // Probabilistic injection
    if (Math.random() > fault.probability) {
      return fn(); // No injection this time
    }

    // Inject fault
    return this.injectFault(fault, fn);
  }

  /**
   * Inject specific fault
   */
  private async injectFault<T>(fault: ChaosFault, fn: () => Promise<T>): Promise<T> {
    // Emit injection event
    this.emitEvent({
      faultType: fault.type,
      timestamp: Date.now(),
      config: fault.config,
    });

    switch (fault.type) {
      case 'network_delay':
        return this.injectNetworkDelay(fault.config, fn);

      case 'network_failure':
        return this.injectNetworkFailure(fault.config);

      case 'upstream_error':
        return this.injectUpstreamError(fault.config);

      case 'timeout':
        return this.injectTimeout(fault.config, fn);

      case 'data_corruption':
        return this.injectDataCorruption(fault.config, fn);

      case 'resource_exhaustion':
        return this.injectResourceExhaustion(fault.config);

      default:
        return fn(); // Unknown fault type - execute normally
    }
  }

  /**
   * Inject network delay
   */
  private async injectNetworkDelay<T>(
    config: ChaosFaultConfig,
    fn: () => Promise<T>
  ): Promise<T> {
    const delayMs = config.delayMs ?? 1000;
    await this.delay(delayMs);
    return fn();
  }

  /**
   * Inject network failure
   */
  private injectNetworkFailure<T>(config: ChaosFaultConfig): Promise<T> {
    const errorMessage = config.errorMessage ?? 'Network connection failed';
    throw new ChaosFaultError('network_failure', errorMessage);
  }

  /**
   * Inject upstream error
   */
  private injectUpstreamError<T>(config: ChaosFaultConfig): Promise<T> {
    const errorCode = config.errorCode ?? '503';
    const errorMessage = config.errorMessage ?? `Upstream service error: ${errorCode}`;
    throw new ChaosFaultError('upstream_error', errorMessage);
  }

  /**
   * Inject timeout
   */
  private async injectTimeout<T>(
    config: ChaosFaultConfig,
    fn: () => Promise<T>
  ): Promise<T> {
    // Start timeout that never resolves
    const timeoutPromise = new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new ChaosFaultError('timeout', 'Operation timed out'));
      }, config.delayMs ?? 5000);
    });

    // Race between actual operation and timeout
    return Promise.race([fn(), timeoutPromise]);
  }

  /**
   * Inject data corruption
   */
  private async injectDataCorruption<T>(
    config: ChaosFaultConfig,
    fn: () => Promise<T>
  ): Promise<T> {
    const result = await fn();

    // Corrupt result data (probabilistically)
    if (config.failureRate && Math.random() < config.failureRate) {
      // For testing - return corrupted data structure
      // In real implementation, this would mutate response data
      throw new ChaosFaultError('data_corruption', 'Response data corrupted');
    }

    return result;
  }

  /**
   * Inject resource exhaustion
   */
  private injectResourceExhaustion<T>(config: ChaosFaultConfig): Promise<T> {
    throw new ChaosFaultError(
      'resource_exhaustion',
      config.errorMessage ?? 'Resource exhausted'
    );
  }

  /**
   * Enable/disable fault injection globally
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if fault injection is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable specific fault type
   */
  enableFault(faultType: ChaosFaultType): void {
    const fault = this.faults.get(faultType);
    if (fault) {
      this.faults.set(faultType, { ...fault, enabled: true });
    }
  }

  /**
   * Disable specific fault type
   */
  disableFault(faultType: ChaosFaultType): void {
    const fault = this.faults.get(faultType);
    if (fault) {
      this.faults.set(faultType, { ...fault, enabled: false });
    }
  }

  /**
   * Reset all fault configurations
   */
  reset(): void {
    this.faults.clear();
  }

  /**
   * Subscribe to fault injection events
   */
  onEvent(listener: (event: FaultInjectionEvent) => void): () => void {
    this.eventListeners.push(listener);

    return () => {
      const index = this.eventListeners.indexOf(listener);
      if (index !== -1) {
        this.eventListeners.splice(index, 1);
      }
    };
  }

  /**
   * Emit fault injection event
   */
  private emitEvent(event: FaultInjectionEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error('ChaosFaultInjector event listener error', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create chaos fault injector with common faults configured
 */
export function createChaosFaultInjector(enabled = false): ChaosFaultInjector {
  const injector = new ChaosFaultInjector(enabled);

  // Configure common faults (all disabled by default)
  injector.configureFault('network_delay', {
    enabled: false,
    probability: 0.1,
    delayMs: 1000,
  });

  injector.configureFault('network_failure', {
    enabled: false,
    probability: 0.05,
    errorMessage: 'ECONNREFUSED',
  });

  injector.configureFault('upstream_error', {
    enabled: false,
    probability: 0.1,
    errorCode: '503',
    errorMessage: 'Service unavailable',
  });

  injector.configureFault('timeout', {
    enabled: false,
    probability: 0.05,
    delayMs: 5000,
  });

  return injector;
}
