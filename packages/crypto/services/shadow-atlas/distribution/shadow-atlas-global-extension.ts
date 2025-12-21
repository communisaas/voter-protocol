/**
 * ShadowAtlasService Global Distribution Extension
 *
 * Extends ShadowAtlasService with global IPFS distribution capabilities.
 * Adds publishGlobal() method for geographically distributed pinning.
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { ShadowAtlasService } from '../core/shadow-atlas-service.js';
import type {
  GlobalPublishOptions,
  GlobalPublishResult,
  Region,
} from './types.js';
import { UpdateCoordinator } from './update-coordinator.js';
import { AvailabilityMonitor } from './availability-monitor.js';
import { FallbackResolver } from './fallback-resolver.js';
import { RegionalPinningService } from './regional-pinning-service.js';
import {
  DEFAULT_GLOBAL_CONFIG,
  DEFAULT_REGIONS,
  DEFAULT_ROLLOUT,
} from './global-ipfs-strategy.js';

/**
 * Global distribution extension for ShadowAtlasService
 *
 * Usage:
 * ```typescript
 * const atlas = new ShadowAtlasService();
 * const globalExt = new ShadowAtlasGlobalExtension(atlas);
 *
 * const result = await globalExt.publishGlobal({
 *   regions: ['americas-east', 'europe-west', 'asia-east'],
 *   verifyReplication: true,
 * });
 * ```
 */
export class ShadowAtlasGlobalExtension {
  private readonly atlasService: ShadowAtlasService;
  private readonly updateCoordinator: UpdateCoordinator;
  private readonly availabilityMonitor: AvailabilityMonitor;
  private readonly fallbackResolver: FallbackResolver;

  constructor(atlasService: ShadowAtlasService) {
    this.atlasService = atlasService;

    // Initialize regional pinning services
    const regionalServices = new Map<Region, RegionalPinningService>();
    // Note: In production, this would initialize actual pinning service implementations
    // For now, this is a placeholder for the architecture

    // Initialize distribution components
    this.availabilityMonitor = new AvailabilityMonitor(DEFAULT_REGIONS, {
      healthCheckIntervalMs: DEFAULT_GLOBAL_CONFIG.healthCheck.intervalMs,
      healthCheckTimeoutMs: DEFAULT_GLOBAL_CONFIG.healthCheck.timeoutMs,
    });

    this.updateCoordinator = new UpdateCoordinator(
      DEFAULT_ROLLOUT,
      regionalServices
    );

    this.fallbackResolver = new FallbackResolver(
      DEFAULT_REGIONS,
      this.availabilityMonitor
    );

    // Start monitoring
    this.availabilityMonitor.startMonitoring();
  }

  /**
   * Publish snapshot globally with geographic redundancy
   *
   * Orchestrates multi-region pinning with staged rollout and verification.
   *
   * @param options - Global publish options
   * @returns Global publish result with replication status
   */
  async publishGlobal(
    options: Partial<GlobalPublishOptions> = {}
  ): Promise<GlobalPublishResult> {
    // Get latest snapshot from atlas service
    const snapshots = await this.atlasService.listSnapshots(1);
    if (snapshots.length === 0) {
      throw new Error('No snapshots available to publish');
    }

    const latestSnapshot = snapshots[0];

    // Load snapshot data (would retrieve merkle tree from persistence)
    // For now, this is a placeholder
    const merkleTree = {
      root: latestSnapshot.merkleRoot,
      leaves: [],
      tree: [],
      districts: [],
    };

    const publishOptions: GlobalPublishOptions = {
      regions: options.regions ?? ['americas-east', 'americas-west', 'europe-west'],
      verifyReplication: options.verifyReplication ?? true,
      parallelUploads: options.parallelUploads ?? 3,
      retryAttempts: options.retryAttempts ?? 3,
      timeoutMs: options.timeoutMs ?? 60_000,
    };

    // Execute coordinated global update
    const result = await this.updateCoordinator.coordinateUpdate(
      merkleTree,
      latestSnapshot,
      publishOptions
    );

    return result;
  }

  /**
   * Get global availability metrics
   *
   * @param periodHours - Time period for metrics (default: 24 hours)
   * @returns Global availability metrics
   */
  getAvailabilityMetrics(periodHours = 24) {
    return this.availabilityMonitor.getGlobalMetrics(periodHours);
  }

  /**
   * Check SLA compliance
   *
   * @param targetAvailability - Target availability (e.g., 0.999 for 99.9%)
   * @param periodHours - Time period to check (default: 24 hours)
   * @returns SLA compliance status
   */
  checkSLA(targetAvailability = 0.999, periodHours = 24) {
    return this.availabilityMonitor.checkSLA(targetAvailability, periodHours);
  }

  /**
   * Resolve content with intelligent fallback
   *
   * @param cid - IPFS CID to resolve
   * @param userRegion - User's geographic region for gateway optimization
   * @returns Fallback resolution result
   */
  async resolveWithFallback(cid: string, userRegion?: Region) {
    return this.fallbackResolver.resolve(cid, {
      userRegion,
      maxLatencyMs: 1000,
      minSuccessRate: 0.8,
    });
  }

  /**
   * Get current rollout status
   *
   * @returns Current rollout status or null if no rollout in progress
   */
  getRolloutStatus() {
    return this.updateCoordinator.getCurrentRolloutStatus();
  }

  /**
   * Stop monitoring and cleanup
   */
  cleanup(): void {
    this.availabilityMonitor.stopMonitoring();
  }
}

/**
 * Helper function to estimate global distribution costs
 *
 * @param snapshotSizeMB - Size of quarterly snapshot in MB
 * @param monthlyRequests - Estimated monthly requests
 * @param replicationFactor - Replication factor per region
 * @returns Cost estimate
 */
export function estimateGlobalDistributionCost(
  snapshotSizeMB: number,
  monthlyRequests: number,
  replicationFactor: number
): {
  readonly monthly: number;
  readonly yearly: number;
  readonly breakdown: string;
} {
  // Use Storacha free tier for base storage (5GB free)
  const storageGB = (snapshotSizeMB * replicationFactor) / 1024;
  const egressGB = (snapshotSizeMB * monthlyRequests) / 1024;

  // Free tier covers most Shadow Atlas use cases
  if (storageGB <= 5 && egressGB <= 5) {
    return {
      monthly: 0,
      yearly: 0,
      breakdown: 'Free tier (Storacha) sufficient for current load',
    };
  }

  // Calculate overages
  const storageOverage = Math.max(0, storageGB - 5);
  const egressOverage = Math.max(0, egressGB - 5);

  // Pinata pricing: $0.15/GB
  const monthly = (storageOverage + egressOverage) * 0.15;

  return {
    monthly: Math.round(monthly * 100) / 100,
    yearly: Math.round(monthly * 12 * 100) / 100,
    breakdown: `Storage: ${storageGB.toFixed(2)}GB, Egress: ${egressGB.toFixed(2)}GB/month`,
  };
}
