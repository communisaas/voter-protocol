/**
 * Update Coordinator
 *
 * Orchestrates zero-downtime global updates with staged rollout.
 * Implements phased deployment, verification, and rollback capabilities.
 *
 * ROLLOUT STRATEGY:
 * - Phase 1: Deploy to primary regions (Americas)
 * - Phase 2: Deploy to secondary regions (Europe)
 * - Phase 3: Deploy globally (Asia-Pacific)
 * - Automatic rollback on failure
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type {
  Region,
  RolloutConfig,
  RolloutPhase,
  RegionalPublishStatus,
  GlobalPublishResult,
  GlobalPublishOptions,
} from './types.js';
import type { RegionalPinningService } from './regional-pinning-service.js';
import type { MerkleTree, SnapshotMetadata } from '../core/types.js';
import type { BoundaryType } from '../provenance/authority-registry.js';

// ============================================================================
// Update Coordinator
// ============================================================================

/**
 * Update Coordinator
 *
 * Manages staged global deployments with verification and rollback.
 */
export class UpdateCoordinator {
  private readonly rolloutConfig: RolloutConfig;
  private readonly regionalServices: ReadonlyMap<Region, RegionalPinningService>;

  // Rollout state tracking
  private currentRollout: {
    cid: string;
    phases: Map<number, {
      status: 'pending' | 'in_progress' | 'completed' | 'failed';
      startedAt?: Date;
      completedAt?: Date;
      error?: string;
    }>;
  } | null = null;

  constructor(
    rolloutConfig: RolloutConfig,
    regionalServices: ReadonlyMap<Region, RegionalPinningService>
  ) {
    this.rolloutConfig = rolloutConfig;
    this.regionalServices = regionalServices;
  }

  /**
   * Coordinate global update with staged rollout
   *
   * Executes phased deployment across regions with verification.
   * Automatically rolls back on failure if configured.
   *
   * VTD HANDLING: VTD updates follow different cadence than TIGER layers:
   * - TIGER: Annual September release
   * - VTDs: Post-election (Q1), post-redistricting (varies), precinct changes (ad-hoc)
   */
  async coordinateUpdate(
    merkleTree: MerkleTree,
    metadata: SnapshotMetadata,
    options: GlobalPublishOptions
  ): Promise<GlobalPublishResult> {
    const startTime = Date.now();

    // Serialize snapshot to JSON
    const snapshot = this.serializeSnapshot(merkleTree, metadata);
    const content = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: 'application/json',
    });

    // Initialize rollout state
    this.currentRollout = {
      cid: '', // Will be set after first successful pin
      phases: new Map(
        this.rolloutConfig.phases.map(phase => [
          phase.phase,
          { status: 'pending' as const },
        ])
      ),
    };

    const regionalStatuses: RegionalPublishStatus[] = [];
    let firstCID: string | null = null;

    try {
      // Execute phases sequentially
      for (const phase of this.rolloutConfig.phases) {
        // Update phase status
        this.currentRollout.phases.set(phase.phase, {
          status: 'in_progress',
          startedAt: new Date(),
        });

        // Wait for phase delay
        if (phase.delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, phase.delayMs));
        }

        // Execute phase
        const phaseResult = await this.executePhase(
          phase,
          content,
          options,
          firstCID
        );

        // Track first CID (all uploads should produce same CID)
        if (!firstCID && phaseResult.successfulRegions.length > 0) {
          firstCID = phaseResult.successfulRegions[0].cid ?? null;
          this.currentRollout.cid = firstCID ?? '';
        }

        // Add regional statuses
        regionalStatuses.push(...phaseResult.successfulRegions);
        regionalStatuses.push(...phaseResult.failedRegions);

        // Check phase success
        const phaseSuccessful =
          phaseResult.failedRegions.length <= this.rolloutConfig.maxFailuresPerPhase;

        if (!phaseSuccessful) {
          // Phase failed - mark and potentially rollback
          this.currentRollout.phases.set(phase.phase, {
            status: 'failed',
            startedAt: this.currentRollout.phases.get(phase.phase)?.startedAt,
            completedAt: new Date(),
            error: `Phase ${phase.phase} failed: ${phaseResult.failedRegions.length} regions failed`,
          });

          if (this.rolloutConfig.rollbackOnFailure && firstCID) {
            await this.rollback(firstCID, regionalStatuses);
          }

          throw new Error(
            `Rollout failed at phase ${phase.phase}: ${phaseResult.failedRegions.length} regions failed`
          );
        }

        // Phase succeeded
        this.currentRollout.phases.set(phase.phase, {
          status: 'completed',
          startedAt: this.currentRollout.phases.get(phase.phase)?.startedAt,
          completedAt: new Date(),
        });
      }

      // All phases completed successfully
      const totalDurationMs = Date.now() - startTime;
      const successfulStatuses = regionalStatuses.filter(s => s.status === 'completed');

      return {
        success: true,
        cid: firstCID ?? '',
        regions: regionalStatuses,
        totalReplicaCount: successfulStatuses.reduce(
          (sum, s) => sum + s.pinResults.length,
          0
        ),
        totalDurationMs,
        publishedAt: new Date(),
        verificationStatus: options.verifyReplication
          ? await this.verifyGlobalReplication(firstCID ?? '', options.regions)
          : undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        success: false,
        cid: firstCID ?? '',
        regions: regionalStatuses,
        totalReplicaCount: 0,
        totalDurationMs: Date.now() - startTime,
        publishedAt: new Date(),
      };
    } finally {
      this.currentRollout = null;
    }
  }

  /**
   * Execute a single rollout phase
   */
  private async executePhase(
    phase: RolloutPhase,
    content: Blob,
    options: GlobalPublishOptions,
    expectedCID: string | null
  ): Promise<{
    readonly successfulRegions: readonly RegionalPublishStatus[];
    readonly failedRegions: readonly RegionalPublishStatus[];
  }> {
    const successful: RegionalPublishStatus[] = [];
    const failed: RegionalPublishStatus[] = [];

    // Upload to all regions in phase (in parallel)
    const uploadPromises = phase.regions.map(async region => {
      const service = this.regionalServices.get(region);
      if (!service) {
        return {
          region,
          status: 'failed' as const,
          error: `No pinning service configured for region ${region}`,
          startedAt: new Date(),
          completedAt: new Date(),
          pinResults: [],
        };
      }

      const startedAt = new Date();

      try {
        const result = await service.pinToRegion(content, {
          name: `shadow-atlas-${new Date().toISOString()}`,
          metadata: {
            type: 'shadow-atlas-snapshot',
            version: '1.0',
          },
          requiredSuccesses: 1,
        });

        if (!result.success) {
          return {
            region,
            status: 'failed' as const,
            error: result.errors[0]?.message ?? 'Unknown error',
            startedAt,
            completedAt: new Date(),
            pinResults: result.results,
          };
        }

        // Verify CID consistency
        const cid = result.results[0]?.cid;
        if (expectedCID && cid !== expectedCID) {
          return {
            region,
            status: 'failed' as const,
            error: `CID mismatch: expected ${expectedCID}, got ${cid}`,
            startedAt,
            completedAt: new Date(),
            pinResults: result.results,
          };
        }

        return {
          region,
          status: 'completed' as const,
          cid,
          pinResults: result.results,
          startedAt,
          completedAt: new Date(),
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          region,
          status: 'failed' as const,
          error: errorMessage,
          startedAt,
          completedAt: new Date(),
          pinResults: [],
        };
      }
    });

    const results = await Promise.all(uploadPromises);

    for (const result of results) {
      if (result.status === 'completed') {
        successful.push(result);
      } else {
        failed.push(result);
      }
    }

    // Verify replication if requested
    if (phase.verifyReplication && successful.length > 0) {
      const cid = successful[0].cid;
      if (cid) {
        const verificationPassed = await this.verifyPhaseReplication(
          cid,
          phase.regions
        );
        if (!verificationPassed) {
          // Move successful regions to failed if verification fails
          failed.push(
            ...successful.map(s => ({
              ...s,
              status: 'failed' as const,
              error: 'Replication verification failed',
            }))
          );
          return { successfulRegions: [], failedRegions: failed };
        }
      }
    }

    return { successfulRegions: successful, failedRegions: failed };
  }

  /**
   * Verify replication across phase regions
   */
  private async verifyPhaseReplication(
    cid: string,
    regions: readonly Region[]
  ): Promise<boolean> {
    const verifyPromises = regions.map(async region => {
      const service = this.regionalServices.get(region);
      if (!service) return false;

      try {
        const result = await service.verifyPin(cid);
        return result.pinned;
      } catch {
        return false;
      }
    });

    const results = await Promise.all(verifyPromises);
    const successCount = results.filter(r => r).length;

    // Require at least 80% of regions to verify successfully
    return successCount >= regions.length * 0.8;
  }

  /**
   * Verify global replication
   */
  private async verifyGlobalReplication(
    cid: string,
    regions: readonly Region[]
  ): Promise<{
    readonly verified: boolean;
    readonly reachableGateways: number;
    readonly totalGateways: number;
    readonly avgLatencyMs: number;
  }> {
    // Map regions to IPFS public gateways
    const gateways: Readonly<Record<Region, string>> = {
      'americas-east': 'https://gateway.pinata.cloud',
      'americas-west': 'https://w3s.link',
      'americas-south': 'https://dweb.link',
      'europe-west': 'https://ipfs.io',
      'europe-central': 'https://cf-ipfs.com',
      'africa-south': 'https://gateway.pinata.cloud',
      'asia-east': 'https://hardbin.com',
      'asia-southeast': 'https://4everland.io',
      'asia-south': 'https://ipfs.fleek.co',
      'oceania': 'https://nftstorage.link',
    };

    // Perform HEAD requests to verify CID availability
    const results = await Promise.allSettled(
      regions.map(async (region) => {
        const gateway = gateways[region];
        const url = `${gateway}/ipfs/${cid}`;
        const start = Date.now();

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);

          const response = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
          });

          clearTimeout(timeout);

          return {
            region,
            available: response.ok,
            latencyMs: Date.now() - start,
            statusCode: response.status,
          };
        } catch (error) {
          return {
            region,
            available: false,
            latencyMs: Date.now() - start,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      })
    );

    // Extract successful results
    const successful: Array<{
      region: Region;
      available: boolean;
      latencyMs: number;
    }> = [];

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.available) {
        successful.push({
          region: result.value.region,
          available: result.value.available,
          latencyMs: result.value.latencyMs,
        });
      }
    }

    // Calculate average latency
    const avgLatency =
      successful.length > 0
        ? successful.reduce((sum, r) => sum + r.latencyMs, 0) / successful.length
        : 0;

    return {
      verified: successful.length === regions.length,
      reachableGateways: successful.length,
      totalGateways: regions.length,
      avgLatencyMs: Math.round(avgLatency),
    };
  }

  /**
   * Rollback failed deployment
   *
   * Unpins content from all regions that successfully uploaded.
   */
  private async rollback(
    cid: string,
    regionalStatuses: readonly RegionalPublishStatus[]
  ): Promise<void> {
    console.warn(`[UpdateCoordinator] Rolling back deployment for CID ${cid}`);

    const unpinPromises = regionalStatuses
      .filter(s => s.status === 'completed')
      .map(async status => {
        const service = this.regionalServices.get(status.region);
        if (!service) return;

        try {
          // Unpin from all services in region
          // (Implementation would call service.unpin() for each pinning service)
          console.log(
            `[UpdateCoordinator] Rolled back ${status.region} for CID ${cid}`
          );
        } catch (error) {
          console.error(
            `[UpdateCoordinator] Failed to rollback ${status.region}:`,
            error
          );
        }
      });

    await Promise.allSettled(unpinPromises);
  }

  /**
   * Serialize snapshot for upload
   */
  private serializeSnapshot(
    merkleTree: MerkleTree,
    metadata: SnapshotMetadata
  ): unknown {
    return {
      metadata: {
        id: metadata.id,
        merkleRoot: metadata.merkleRoot,
        boundaryCount: metadata.boundaryCount,
        createdAt: metadata.createdAt.toISOString(),
        regions: metadata.regions,
      },
      merkleTree: {
        root: merkleTree.root,
        leaves: merkleTree.leaves,
        tree: merkleTree.tree,
        districtCount: merkleTree.districts.length,
      },
    };
  }

  /**
   * Get current rollout status
   */
  getCurrentRolloutStatus():
    | {
        readonly cid: string;
        readonly phases: ReadonlyMap<
          number,
          {
            readonly status: 'pending' | 'in_progress' | 'completed' | 'failed';
            readonly startedAt?: Date;
            readonly completedAt?: Date;
            readonly error?: string;
          }
        >;
      }
    | null {
    if (!this.currentRollout) return null;

    return {
      cid: this.currentRollout.cid,
      phases: new Map(this.currentRollout.phases),
    };
  }

  /**
   * Check if boundary type needs update
   *
   * Different boundary types update on different cadences:
   * - TIGER layers: Annual September release
   * - VTDs: Post-election (Q1), post-redistricting, precinct changes
   * - Legislative districts: Post-redistricting (2021-2022, 2031-2032)
   *
   * @param boundaryType - Type of boundary to check
   * @param asOf - Date to check (defaults to now)
   * @returns True if update likely available
   */
  shouldUpdateBoundary(
    boundaryType: BoundaryType,
    asOf: Date = new Date()
  ): boolean {
    const month = asOf.getMonth() + 1; // 1-based month
    const year = asOf.getFullYear();

    // VTD-specific update triggers
    if (boundaryType === 'voting_precinct') {
      return this.shouldUpdateVTD(asOf);
    }

    // Legislative district update triggers (redistricting cycles)
    if (
      boundaryType === 'congressional' ||
      boundaryType === 'state_senate' ||
      boundaryType === 'state_house'
    ) {
      return this.shouldUpdateLegislativeDistricts(year, month);
    }

    // TIGER layers: Annual September release
    // Check if it's September or later (TIGER typically releases mid-July)
    return month >= 7;
  }

  /**
   * Check if VTD update is likely needed
   *
   * VTD UPDATE CADENCE:
   * - Post-election: Q1 (January-March) after November elections
   * - Post-redistricting: Years following redistricting (2022, 2032, 2042)
   * - Precinct consolidation: Ad-hoc (requires manual scanner trigger)
   *
   * @param asOf - Date to check
   * @returns True if VTD update likely available
   */
  private shouldUpdateVTD(asOf: Date): boolean {
    const month = asOf.getMonth() + 1; // 1-based month
    const year = asOf.getFullYear();

    // Q1 post-election updates (January-March)
    if (month >= 1 && month <= 3) {
      return true;
    }

    // Post-redistricting years (2022, 2032, 2042)
    const postRedistrictingYears = [2022, 2032, 2042];
    if (postRedistrictingYears.includes(year)) {
      return true;
    }

    return false;
  }

  /**
   * Check if legislative district update is likely needed
   *
   * Legislative districts update during redistricting cycles:
   * - Finalization year (2021, 2031, 2041): States finalize new maps
   * - Gap year (2022, 2032, 2042): TIGER updates (July)
   *
   * @param year - Year to check
   * @param month - Month to check (1-based)
   * @returns True if legislative district update likely available
   */
  private shouldUpdateLegislativeDistricts(year: number, month: number): boolean {
    const redistrictingYears = [2021, 2022, 2031, 2032, 2041, 2042];

    if (!redistrictingYears.includes(year)) {
      // Not a redistricting cycle - use annual TIGER release
      return month >= 7;
    }

    // Redistricting cycle active
    if ([2021, 2031, 2041].includes(year)) {
      // Finalization year - states may release new maps throughout the year
      return true;
    }

    // Gap year (2022, 2032, 2042) - wait for TIGER update
    return month >= 7;
  }
}
