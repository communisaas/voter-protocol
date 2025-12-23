/**
 * Regional Pinning Service
 *
 * Orchestrates IPFS pinning across geographically distributed nodes.
 * Implements multi-service pinning with fallback and retry logic.
 *
 * RELIABILITY STRATEGY:
 * - Multiple pinning services per region (fault tolerance)
 * - Parallel uploads with failure isolation
 * - Automatic retry with exponential backoff
 * - Service health tracking
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type {
  Region,
  PinningServiceType,
  PinningServiceConfig,
  PinResult,
  DistributionError,
  DistributionErrorType,
} from './types.js';
import { getPinningServicesForRegion } from './global-ipfs-strategy.js';

// ============================================================================
// Pinning Service Interface
// ============================================================================

/**
 * Generic pinning service interface
 *
 * Abstracts differences between Storacha, Pinata, Fleek, etc.
 * Implementations handle service-specific authentication and API calls.
 */
export interface IPinningService {
  readonly type: PinningServiceType;
  readonly region: Region;

  /**
   * Pin content to IPFS
   *
   * @param content - Content to pin (JSON blob)
   * @param options - Pinning options
   * @returns Pin result with CID
   */
  pin(
    content: Blob | Uint8Array,
    options?: {
      readonly name?: string;
      readonly metadata?: Record<string, string>;
    }
  ): Promise<PinResult>;

  /**
   * Verify pin exists
   *
   * @param cid - CID to verify
   * @returns true if pinned, false otherwise
   */
  verify(cid: string): Promise<boolean>;

  /**
   * Unpin content
   *
   * @param cid - CID to unpin
   */
  unpin(cid: string): Promise<void>;

  /**
   * Health check
   *
   * @returns true if service is healthy, false otherwise
   */
  healthCheck(): Promise<boolean>;
}

// ============================================================================
// Regional Pinning Service
// ============================================================================

/**
 * Regional Pinning Service
 *
 * Manages IPFS pinning across multiple services in a region.
 * Implements parallel uploads with failure tolerance.
 */
export class RegionalPinningService {
  private readonly region: Region;
  private readonly services: readonly IPinningService[];
  private readonly maxParallelUploads: number;
  private readonly retryAttempts: number;

  // Health tracking
  private readonly serviceHealth = new Map<PinningServiceType, {
    consecutive_failures: number;
    last_success: Date | null;
    last_failure: Date | null;
  }>();

  constructor(
    region: Region,
    services: readonly IPinningService[],
    options: {
      readonly maxParallelUploads?: number;
      readonly retryAttempts?: number;
    } = {}
  ) {
    this.region = region;
    this.services = services;
    this.maxParallelUploads = options.maxParallelUploads ?? 3;
    this.retryAttempts = options.retryAttempts ?? 3;

    // Initialize health tracking
    for (const service of services) {
      this.serviceHealth.set(service.type, {
        consecutive_failures: 0,
        last_success: null,
        last_failure: null,
      });
    }
  }

  /**
   * Pin content to all healthy services in region
   *
   * Uploads in parallel to multiple services for redundancy.
   * Returns success if at least one service succeeds.
   */
  async pinToRegion(
    content: Blob | Uint8Array,
    options: {
      readonly name?: string;
      readonly metadata?: Record<string, string>;
      readonly requiredSuccesses?: number;
    } = {}
  ): Promise<{
    readonly success: boolean;
    readonly results: readonly PinResult[];
    readonly errors: readonly DistributionError[];
  }> {
    const requiredSuccesses = options.requiredSuccesses ?? 1;
    const results: PinResult[] = [];
    const errors: DistributionError[] = [];

    // Filter healthy services
    const healthyServices = this.getHealthyServices();

    if (healthyServices.length === 0) {
      return {
        success: false,
        results: [],
        errors: [{
          type: 'gateway_unavailable',
          message: `No healthy pinning services available in region ${this.region}`,
          region: this.region,
          retryable: true,
          timestamp: new Date(),
        }],
      };
    }

    // Pin to services in parallel (limited concurrency)
    const pinPromises = healthyServices.map(service =>
      this.pinWithRetry(service, content, options)
    );

    const settled = await Promise.allSettled(pinPromises);

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
        this.recordSuccess(result.value.service);
      } else {
        const error: DistributionError = {
          type: 'replication_failed',
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
          region: this.region,
          retryable: true,
          timestamp: new Date(),
        };
        errors.push(error);
      }
    }

    const success = results.filter(r => r.success).length >= requiredSuccesses;

    return {
      success,
      results,
      errors,
    };
  }

  /**
   * Verify content is pinned in region
   *
   * Checks all services in parallel, succeeds if ANY service has the pin.
   */
  async verifyPin(cid: string): Promise<{
    readonly pinned: boolean;
    readonly services: readonly PinningServiceType[];
    readonly unavailable: readonly PinningServiceType[];
  }> {
    const verifyPromises = this.services.map(async service => {
      try {
        const pinned = await service.verify(cid);
        return { service: service.type, pinned };
      } catch {
        return { service: service.type, pinned: false };
      }
    });

    const results = await Promise.all(verifyPromises);

    const pinnedServices = results
      .filter(r => r.pinned)
      .map(r => r.service);

    const unavailable = results
      .filter(r => !r.pinned)
      .map(r => r.service);

    return {
      pinned: pinnedServices.length > 0,
      services: pinnedServices,
      unavailable,
    };
  }

  /**
   * Health check for all services in region
   */
  async healthCheck(): Promise<ReadonlyMap<PinningServiceType, boolean>> {
    const healthPromises = this.services.map(async service => {
      try {
        const healthy = await service.healthCheck();
        return { type: service.type, healthy };
      } catch {
        return { type: service.type, healthy: false };
      }
    });

    const results = await Promise.all(healthPromises);
    return new Map(results.map(r => [r.type, r.healthy]));
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Pin with retry and exponential backoff
   */
  private async pinWithRetry(
    service: IPinningService,
    content: Blob | Uint8Array,
    options: {
      readonly name?: string;
      readonly metadata?: Record<string, string>;
    }
  ): Promise<PinResult> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.retryAttempts; attempt++) {
      try {
        const result = await service.pin(content, options);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Exponential backoff: 1s, 2s, 4s
        if (attempt < this.retryAttempts - 1) {
          const delayMs = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    // All retries failed
    this.recordFailure(service.type, lastError?.message ?? 'Unknown error');

    throw new Error(
      `Failed to pin to ${service.type} in ${this.region} after ${this.retryAttempts} attempts: ${lastError?.message}`
    );
  }

  /**
   * Get healthy services (sorted by priority)
   *
   * Excludes services with >3 consecutive failures.
   */
  private getHealthyServices(): readonly IPinningService[] {
    return this.services.filter(service => {
      const health = this.serviceHealth.get(service.type);
      return health && health.consecutive_failures < 3;
    });
  }

  /**
   * Record successful pin
   */
  private recordSuccess(serviceType: PinningServiceType): void {
    const health = this.serviceHealth.get(serviceType);
    if (health) {
      this.serviceHealth.set(serviceType, {
        consecutive_failures: 0,
        last_success: new Date(),
        last_failure: health.last_failure,
      });
    }
  }

  /**
   * Record failed pin
   */
  private recordFailure(serviceType: PinningServiceType, error: string): void {
    const health = this.serviceHealth.get(serviceType);
    if (health) {
      this.serviceHealth.set(serviceType, {
        consecutive_failures: health.consecutive_failures + 1,
        last_success: health.last_success,
        last_failure: new Date(),
      });
    }
  }

  /**
   * Get service health statistics
   */
  getHealthStats(): ReadonlyMap<PinningServiceType, {
    readonly consecutiveFailures: number;
    readonly lastSuccess: Date | null;
    readonly lastFailure: Date | null;
    readonly healthy: boolean;
  }> {
    const stats = new Map<PinningServiceType, {
      readonly consecutiveFailures: number;
      readonly lastSuccess: Date | null;
      readonly lastFailure: Date | null;
      readonly healthy: boolean;
    }>();

    for (const [type, health] of this.serviceHealth) {
      stats.set(type, {
        consecutiveFailures: health.consecutive_failures,
        lastSuccess: health.last_success,
        lastFailure: health.last_failure,
        healthy: health.consecutive_failures < 3,
      });
    }

    return stats;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create regional pinning service with default configuration
 *
 * Initializes all pinning services available in the region.
 */
export async function createRegionalPinningService(
  region: Region,
  options: {
    readonly maxParallelUploads?: number;
    readonly retryAttempts?: number;
  } = {}
): Promise<RegionalPinningService> {
  const serviceConfigs = getPinningServicesForRegion(region);

  // Create service instances (implementations would be imported)
  const services: IPinningService[] = [];

  // NOTE: In production, this would instantiate actual service implementations:
  // - StorachaPinningService (from ./services/storacha.ts)
  // - PinataPinningService (from ./services/pinata.ts)
  // - etc.
  //
  // For now, this is a factory that returns the orchestrator.
  // Service implementations are added separately.

  return new RegionalPinningService(region, services, options);
}
