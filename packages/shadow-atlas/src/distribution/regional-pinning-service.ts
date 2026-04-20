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
import { logger } from '../core/utils/logger.js';

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

  // R36-H1: Health tracking keyed by compound key (type:index) to prevent collision
  // when multiple instances of the same service type are registered
  private readonly serviceHealth = new Map<string, {
    consecutive_failures: number;
    last_success: Date | null;
    last_failure: Date | null;
  }>();

  /** Map service instance to its health key */
  private readonly serviceKeyMap = new Map<IPinningService, string>();

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

    // Initialize health tracking with unique keys per instance
    const typeCounts = new Map<PinningServiceType, number>();
    for (const service of services) {
      const idx = typeCounts.get(service.type) ?? 0;
      typeCounts.set(service.type, idx + 1);
      const key = idx === 0 ? service.type : `${service.type}:${idx}`;
      this.serviceKeyMap.set(service, key);
      this.serviceHealth.set(key, {
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
    // R38-M1+R39-H2: Validate requiredSuccesses — must be finite positive integer
    // Math.max(1, Math.floor(NaN)) === NaN, so guard with Number.isFinite
    const rawRequired = options.requiredSuccesses ?? 1;
    const requiredSuccesses = Number.isFinite(rawRequired) ? Math.max(1, Math.floor(rawRequired)) : 1;
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

    // R33-M3: Enforce maxParallelUploads concurrency limit
    const limited = healthyServices.slice(0, this.maxParallelUploads);
    const pinPromises = limited.map(service =>
      this.pinWithRetry(service, content, options)
    );

    const settled = await Promise.allSettled(pinPromises);

    // R37-H1: Zip results with service instances for per-instance health tracking
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      const service = limited[i];
      if (result.status === 'fulfilled') {
        results.push(result.value);
        // R41-NOTE: pinWithRetry always returns success:true or throws,
        // so this branch always records success. The fulfilled+!success path
        // is structurally unreachable but kept as defensive fallback.
        if (result.value.success) {
          this.recordSuccess(service);
        } else {
          this.recordFailure(service, result.value.error ?? 'Pin returned success:false');
        }
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
  /**
   * R38-H1b: Use compound keys (matching serviceKeyMap) to avoid multi-instance collision
   */
  async verifyPin(cid: string): Promise<{
    readonly pinned: boolean;
    readonly services: readonly string[];
    readonly unavailable: readonly string[];
  }> {
    const verifyPromises = this.services.map(async service => {
      const key = this.serviceKeyMap.get(service) ?? service.type;
      try {
        const pinned = await service.verify(cid);
        return { key, pinned };
      } catch {
        return { key, pinned: false };
      }
    });

    const results = await Promise.all(verifyPromises);

    const pinnedServices = results
      .filter(r => r.pinned)
      .map(r => r.key);

    const unavailable = results
      .filter(r => !r.pinned)
      .map(r => r.key);

    return {
      pinned: pinnedServices.length > 0,
      services: pinnedServices,
      unavailable,
    };
  }

  /**
   * Unpin content from all services in region
   *
   * Attempts to unpin from all services in parallel.
   * Logs per-service results but does not throw on partial failure.
   */
  async unpin(cid: string): Promise<void> {
    const unpinPromises = this.services.map(async service => {
      // R39-M1: Use compound key for per-instance log disambiguation
      const serviceKey = this.serviceKeyMap.get(service) ?? service.type;
      try {
        await service.unpin(cid);
        logger.info('Unpinned from service', {
          region: this.region,
          service: serviceKey,
          cid,
        });
      } catch (error) {
        logger.warn('Failed to unpin from service', {
          region: this.region,
          service: serviceKey,
          cid,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    await Promise.allSettled(unpinPromises);
  }

  /**
   * Health check for all services in region
   * R38-H1a: Use compound keys (matching serviceKeyMap) to avoid multi-instance collision
   */
  async healthCheck(): Promise<ReadonlyMap<string, boolean>> {
    const healthPromises = this.services.map(async service => {
      const key = this.serviceKeyMap.get(service) ?? service.type;
      try {
        const healthy = await service.healthCheck();
        return { key, healthy };
      } catch {
        return { key, healthy: false };
      }
    });

    const results = await Promise.all(healthPromises);
    return new Map(results.map(r => [r.key, r.healthy]));
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
        if (result.success) {
          return result;
        }
        // Treat success:false as retryable failure
        lastError = new Error(`Pin returned success:false from ${service.type ?? 'unknown'}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      // Exponential backoff: 1s, 2s, 4s
      if (attempt < this.retryAttempts - 1) {
        const delayMs = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    // All retries failed — R37-H1: pass instance, not type
    this.recordFailure(service, lastError?.message ?? 'Unknown error');

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
      const key = this.serviceKeyMap.get(service);
      const health = key ? this.serviceHealth.get(key) : undefined;
      return health && health.consecutive_failures < 3;
    });
  }

  /**
   * Record successful pin
   * R37-H1: Takes service instance (not type) for per-instance health tracking
   */
  private recordSuccess(service: IPinningService): void {
    const key = this.serviceKeyMap.get(service);
    const health = key ? this.serviceHealth.get(key) : undefined;
    if (health && key) {
      this.serviceHealth.set(key, {
        consecutive_failures: 0,
        last_success: new Date(),
        last_failure: health.last_failure,
      });
    }
  }

  /**
   * Record failed pin
   * R37-H1: Takes service instance (not type) for per-instance health tracking
   */
  private recordFailure(service: IPinningService, error: string): void {
    const key = this.serviceKeyMap.get(service);
    const health = key ? this.serviceHealth.get(key) : undefined;
    if (health && key) {
      this.serviceHealth.set(key, {
        consecutive_failures: health.consecutive_failures + 1,
        last_success: health.last_success,
        last_failure: new Date(),
      });
    }
  }

  /**
   * Get service health statistics
   */
  getHealthStats(): ReadonlyMap<string, {
    readonly consecutiveFailures: number;
    readonly lastSuccess: Date | null;
    readonly lastFailure: Date | null;
    readonly healthy: boolean;
  }> {
    const stats = new Map<string, {
      readonly consecutiveFailures: number;
      readonly lastSuccess: Date | null;
      readonly lastFailure: Date | null;
      readonly healthy: boolean;
    }>();

    for (const [key, health] of this.serviceHealth) {
      stats.set(key, {
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
 * Service configuration for creating regional pinning service
 */
export interface RegionalServiceConfig {
  readonly maxParallelUploads?: number;
  readonly retryAttempts?: number;
  readonly storacha?: {
    readonly spaceDid?: string;
    readonly agentPrivateKey?: string;
    readonly proof?: string;
  };
  readonly pinata?: {
    readonly jwt?: string;
    readonly apiKey?: string;
    readonly apiSecret?: string;
  };
  readonly fleek?: {
    readonly apiKey?: string;
    readonly apiSecret?: string;
  };
  readonly timeoutMs?: number;
}

/**
 * Create regional pinning service with default configuration
 *
 * Initializes all pinning services available in the region.
 * Services are created based on available environment variables or explicit config.
 */
export async function createRegionalPinningService(
  region: Region,
  options: RegionalServiceConfig = {}
): Promise<RegionalPinningService> {
  // Import service factory (lazy load to avoid circular deps)
  const { createConfiguredServices } = await import('./services/index.js');

  // Create all configured services for this region
  const services = createConfiguredServices(region, {
    storacha: options.storacha,
    pinata: options.pinata,
    fleek: options.fleek,
    timeoutMs: options.timeoutMs,
  });

  if (services.length === 0) {
    logger.warn('No pinning services configured for region', {
      region,
      message: 'Set environment variables: STORACHA_SPACE_DID/STORACHA_AGENT_KEY, PINATA_JWT or PINATA_API_KEY/PINATA_API_SECRET, FLEEK_API_KEY/FLEEK_API_SECRET',
    });
  }

  return new RegionalPinningService(region, services, {
    maxParallelUploads: options.maxParallelUploads,
    retryAttempts: options.retryAttempts,
  });
}
