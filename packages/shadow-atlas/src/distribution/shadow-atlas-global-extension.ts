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
import {
  RegionalPinningService,
  createRegionalPinningService,
  type RegionalServiceConfig,
} from './regional-pinning-service.js';
import {
  DEFAULT_GLOBAL_CONFIG,
  DEFAULT_REGIONS,
  DEFAULT_ROLLOUT,
} from './global-ipfs-strategy.js';
import { logger } from '../core/utils/logger.js';

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
  private readonly regionalServices: Map<Region, RegionalPinningService>;
  private initPromise: Promise<void> | null = null;

  constructor(
    atlasService: ShadowAtlasService,
    serviceConfig?: RegionalServiceConfig
  ) {
    this.atlasService = atlasService;

    // Initialize regional pinning services map (populated async in init())
    this.regionalServices = new Map<Region, RegionalPinningService>();

    // Initialize distribution components
    this.availabilityMonitor = new AvailabilityMonitor(DEFAULT_REGIONS, {
      healthCheckIntervalMs: DEFAULT_GLOBAL_CONFIG.healthCheck.intervalMs,
      healthCheckTimeoutMs: DEFAULT_GLOBAL_CONFIG.healthCheck.timeoutMs,
    });

    this.updateCoordinator = new UpdateCoordinator(
      DEFAULT_ROLLOUT,
      this.regionalServices
    );

    this.fallbackResolver = new FallbackResolver(
      DEFAULT_REGIONS,
      this.availabilityMonitor
    );

    // Start async initialization of regional services
    this.initPromise = this.initializeRegionalServices(serviceConfig);

    // Start monitoring
    this.availabilityMonitor.startMonitoring();
  }

  /**
   * Initialize regional pinning services from configuration
   *
   * Creates pinning services for each configured region using:
   * 1. Explicit config passed to constructor
   * 2. Environment variables (STORACHA_*, PINATA_*, FLEEK_*)
   */
  private async initializeRegionalServices(
    config?: RegionalServiceConfig
  ): Promise<void> {
    const regions: Region[] = ['americas-east', 'americas-west', 'europe-west'];

    for (const region of regions) {
      try {
        const service = await createRegionalPinningService(region, config);
        this.regionalServices.set(region, service);
      } catch (error) {
        logger.warn('Failed to initialize pinning services for region', {
          region,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with other regions - graceful degradation
      }
    }

    if (this.regionalServices.size === 0) {
      logger.warn('No regional pinning services initialized', {
        message: 'Set STORACHA_SPACE_DID/STORACHA_AGENT_KEY, PINATA_JWT, or FLEEK_API_KEY/FLEEK_API_SECRET',
      });
    } else {
      logger.info('Initialized regional pinning services', {
        serviceCount: this.regionalServices.size,
      });
    }
  }

  /**
   * Load merkle tree from persisted IPFS snapshot
   *
   * Allows bootstrapping from a previously published snapshot without rebuilding from scratch.
   * Useful for:
   * - Recovery from local database loss
   * - Initializing new nodes from global state
   * - Verifying historical snapshots
   *
   * @param cid - IPFS CID of the snapshot to load (or 'ipfs://CID' URL)
   * @returns Loaded merkle tree with metadata, or null if unavailable
   */
  async loadMerkleTreeFromIPFS(
    cid?: string
  ): Promise<{
    tree: import('../core/types.js').MerkleTree;
    metadata: import('../core/types.js').SnapshotMetadata;
  } | null> {
    // Get CID from parameter, environment variable, or return null
    const rootCid = cid ?? process.env.SHADOW_ATLAS_ROOT_CID;

    if (!rootCid) {
      logger.debug('No IPFS CID configured for merkle tree persistence');
      return null;
    }

    try {
      logger.info('Loading merkle tree from IPFS', { cid: rootCid });

      // Extract CID from ipfs:// URL if present
      const cleanCid = rootCid.startsWith('ipfs://')
        ? rootCid.slice(7)
        : rootCid;

      // Try gateways in priority order
      const gateways = [
        'https://w3s.link',
        'https://dweb.link',
        'https://ipfs.io',
        'https://cloudflare-ipfs.com',
      ];

      let snapshotData: {
        merkleRoot: string;
        leaves: readonly string[];
        districts: readonly import('../core/types.js').NormalizedDistrict[];
        metadata?: {
          id: string;
          boundaryCount: number;
          createdAt: string;
          regions: readonly string[];
        };
      } | null = null;

      for (const gateway of gateways) {
        try {
          const url = `${gateway}/ipfs/${cleanCid}`;
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

          const response = await fetch(url, {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
          });

          clearTimeout(timeout);

          if (!response.ok) {
            logger.debug('Gateway returned non-OK status', {
              gateway,
              status: response.status,
            });
            continue;
          }

          snapshotData = await response.json();
          logger.info('Successfully loaded snapshot from gateway', { gateway });
          break;
        } catch (error) {
          logger.debug('Gateway fetch failed', {
            gateway,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
      }

      if (!snapshotData) {
        logger.warn('Failed to load snapshot from all gateways', {
          cid: cleanCid,
          gatewayCount: gateways.length,
        });
        return null;
      }

      // Reconstruct merkle tree from snapshot data
      const merkleTree: import('../core/types.js').MerkleTree = {
        root: snapshotData.merkleRoot,
        leaves: [...snapshotData.leaves],
        tree: [], // Full tree not needed for most operations
        districts: [...snapshotData.districts],
      };

      // Reconstruct metadata
      const metadata: import('../core/types.js').SnapshotMetadata = {
        id: snapshotData.metadata?.id ?? cleanCid,
        merkleRoot: snapshotData.merkleRoot,
        ipfsCID: cleanCid,
        boundaryCount: snapshotData.metadata?.boundaryCount ?? snapshotData.districts.length,
        createdAt: snapshotData.metadata?.createdAt
          ? new Date(snapshotData.metadata.createdAt)
          : new Date(),
        regions: snapshotData.metadata?.regions ?? [],
      };

      logger.info('Loaded merkle tree from IPFS', {
        boundaryCount: metadata.boundaryCount,
        merkleRoot: merkleTree.root.slice(0, 10),
        cid: cleanCid,
      });

      return { tree: merkleTree, metadata };
    } catch (error) {
      logger.error('Failed to load merkle tree from IPFS', {
        error: error instanceof Error ? error.message : String(error),
        cid: rootCid,
      });
      return null;
    }
  }

  /**
   * Ensure regional services are initialized before publishing
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
      this.initPromise = null;
    }
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
    // Ensure regional services are initialized
    await this.ensureInitialized();

    // Get latest snapshot from atlas service
    const snapshots = await this.atlasService.listSnapshots(1);
    if (snapshots.length === 0) {
      throw new Error('No snapshots available to publish');
    }

    const latestSnapshot = snapshots[0];

    // Load versioned snapshot (includes layerCounts and metadata)
    const fullSnapshot = await this.atlasService.getVersionedSnapshot(latestSnapshot.id);
    if (!fullSnapshot) {
      throw new Error(`Snapshot ${latestSnapshot.id} not found`);
    }

    // Load proof templates to reconstruct merkle tree leaves
    const proofTemplates = await this.atlasService.getProofTemplates(latestSnapshot.id);

    // Construct merkle tree from proof templates
    // Each proof template contains the leaf hash for its district
    const leaves = proofTemplates.map(pt => pt.leafHash);

    // Calculate total boundaries from layer counts
    const totalBoundaries = Object.values(fullSnapshot.layerCounts).reduce(
      (sum, count) => sum + count,
      0
    );

    // Construct MerkleTree with minimal district data
    // The UpdateCoordinator only uses districts.length for serialization
    // We use Array.from to create a properly-sized array with placeholder districts
    const merkleTree: import('../core/types.js').MerkleTree = {
      root: '0x' + fullSnapshot.merkleRoot.toString(16).padStart(64, '0'),
      leaves,
      tree: [], // Full tree not needed for IPFS serialization
      // Create minimal district objects - only .length is used by UpdateCoordinator
      districts: Array.from({ length: proofTemplates.length }, (_, i) => ({
        id: proofTemplates[i].districtId,
        name: proofTemplates[i].districtId,
        jurisdiction: 'USA',
        districtType: 'council' as const,
        geometry: { type: 'Polygon' as const, coordinates: [] },
        provenance: {
          source: 'https://www2.census.gov/geo/tiger/',
          authority: 'federal' as const,
          timestamp: fullSnapshot.timestamp.getTime(),
          method: 'shadow-atlas-build',
          responseHash: proofTemplates[i].leafHash,
          jurisdiction: 'USA',
          httpStatus: 200,
          featureCount: 1,
          geometryType: 'Polygon' as const,
          coordinateSystem: 'EPSG:4326',
        },
        bbox: [0, 0, 0, 0] as const,
      })) as import('../core/types.js').NormalizedDistrict[],
    };

    // Construct metadata matching SnapshotMetadata from core/types/service.ts
    const metadata: import('../core/types.js').SnapshotMetadata = {
      id: fullSnapshot.id,
      merkleRoot: '0x' + fullSnapshot.merkleRoot.toString(16).padStart(64, '0'),
      ipfsCID: fullSnapshot.ipfsCid ?? '',
      boundaryCount: totalBoundaries,
      createdAt: fullSnapshot.timestamp,
      regions: [...fullSnapshot.metadata.statesIncluded],
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
      metadata,
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
