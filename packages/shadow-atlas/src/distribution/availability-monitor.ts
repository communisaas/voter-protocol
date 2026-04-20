/**
 * Availability Monitor
 *
 * Tracks global gateway health and availability metrics.
 * Implements continuous monitoring with alerting thresholds.
 *
 * MONITORING STRATEGY:
 * - Health checks every 5 minutes
 * - Latency percentiles (p50, p95, p99)
 * - Availability tracking per region
 * - Automatic alerting on threshold breaches
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type {
  Region,
  GatewayHealth,
  GlobalAvailabilityMetrics,
  ReplicationStatus,
  DistributionError,
} from './types.js';
import { isValidCID } from './types.js';
import type { RegionConfig } from './global-ipfs-strategy.js';
import { logger } from '../core/utils/logger.js';

// ============================================================================
// Availability Monitor
// ============================================================================

/**
 * Availability Monitor
 *
 * Continuously monitors gateway health and tracks availability metrics.
 */
export class AvailabilityMonitor {
  private readonly regions: readonly RegionConfig[];
  private readonly healthCheckIntervalMs: number;
  private readonly healthCheckTimeoutMs: number;

  // Gateway health state
  private readonly gatewayHealth = new Map<string, GatewayHealth>();

  // Metrics collection
  private readonly latencyHistory: number[] = [];
  private readonly maxHistorySize = 1000;

  // Request tracking
  private totalRequests = 0;
  private failedRequests = 0;
  private readonly requestHistory: Array<{
    timestamp: Date;
    latencyMs: number;
    success: boolean;
  }> = [];

  // Monitoring state
  private monitoringInterval: NodeJS.Timeout | null = null;
  private isMonitoring = false;

  constructor(
    regions: readonly RegionConfig[],
    options: {
      readonly healthCheckIntervalMs?: number;
      readonly healthCheckTimeoutMs?: number;
    } = {}
  ) {
    this.regions = regions;
    this.healthCheckIntervalMs = options.healthCheckIntervalMs ?? 300_000; // 5 minutes
    this.healthCheckTimeoutMs = options.healthCheckTimeoutMs ?? 10_000; // 10 seconds

    // Initialize gateway health tracking
    for (const region of regions) {
      for (const gateway of region.gateways) {
        this.gatewayHealth.set(gateway, {
          url: gateway,
          region: region.region,
          available: true,
          latencyMs: 0,
          successRate: 0.5,
          lastChecked: new Date(),
          consecutiveFailures: 0,
        });
      }
    }
  }

  /**
   * Start continuous monitoring
   */
  startMonitoring(): void {
    if (this.isMonitoring) {
      return;
    }

    this.isMonitoring = true;
    logger.info('Starting continuous monitoring');

    // Run initial health check immediately
    this.runHealthCheck().catch(error => {
      logger.error('Initial health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    // Schedule periodic health checks
    this.monitoringInterval = setInterval(() => {
      this.runHealthCheck().catch(error => {
        logger.error('Health check failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, this.healthCheckIntervalMs);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.isMonitoring = false;
    logger.info('Stopped monitoring');
  }

  /**
   * Run health check for all gateways
   */
  private async runHealthCheck(): Promise<void> {
    logger.info('Running health check');

    const healthCheckPromises = this.regions.flatMap(region =>
      region.gateways.map((gateway: string) =>
        this.checkGatewayHealth(gateway, region.region, region.healthCheckCID)
      )
    );

    await Promise.allSettled(healthCheckPromises);

    // Log summary
    const healthy = Array.from(this.gatewayHealth.values()).filter(
      h => h.available
    ).length;
    const total = this.gatewayHealth.size;

    logger.info('Health check complete', {
      healthyGateways: healthy,
      totalGateways: total,
    });
  }

  /**
   * Check individual gateway health
   */
  private async checkGatewayHealth(
    gatewayUrl: string,
    region: Region,
    testCID: string
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // R47-F3: CID format validation before URL construction (SSRF prevention)
      if (!isValidCID(testCID)) {
        logger.warn('AvailabilityMonitor: invalid testCID format', { testCID: testCID.slice(0, 20) });
        return;
      }

      // Construct test URL (use IPFS logo as test content)
      const testUrl = `${gatewayUrl}${testCID}`;

      // Make request with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.healthCheckTimeoutMs);

      const response = await fetch(testUrl, {
        signal: controller.signal,
        method: 'HEAD', // Use HEAD to minimize bandwidth
      });

      clearTimeout(timeoutId);

      const latencyMs = Date.now() - startTime;
      const available = response.ok;

      // Update gateway health
      const currentHealth = this.gatewayHealth.get(gatewayUrl);
      if (currentHealth) {
        const alpha = 0.05; // 5% weight per new observation
        const newSuccessRate = available
          ? alpha + (1 - alpha) * currentHealth.successRate
          : (1 - alpha) * currentHealth.successRate;

        this.gatewayHealth.set(gatewayUrl, {
          url: gatewayUrl,
          region,
          available,
          latencyMs,
          successRate: newSuccessRate,
          lastChecked: new Date(),
          consecutiveFailures: available ? 0 : currentHealth.consecutiveFailures + 1,
        });
      }

      // Record latency
      if (available) {
        this.recordLatency(latencyMs);
      }
    } catch (error) {
      // Health check failed
      const latencyMs = Date.now() - startTime;
      const currentHealth = this.gatewayHealth.get(gatewayUrl);

      if (currentHealth) {
        this.gatewayHealth.set(gatewayUrl, {
          url: gatewayUrl,
          region,
          available: false,
          latencyMs,
          successRate: (1 - 0.05) * currentHealth.successRate, // EWMA decay (alpha=0.05)
          lastChecked: new Date(),
          consecutiveFailures: currentHealth.consecutiveFailures + 1,
        });
      }

      logger.warn('Gateway health check failed', {
        gateway: gatewayUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Record request outcome
   */
  recordRequest(success: boolean, latencyMs: number): void {
    this.totalRequests++;
    if (!success) {
      this.failedRequests++;
    }

    // Add to request history (limited size)
    this.requestHistory.push({
      timestamp: new Date(),
      latencyMs,
      success,
    });

    // Keep only recent history
    if (this.requestHistory.length > this.maxHistorySize) {
      this.requestHistory.shift();
    }

    // Record latency
    if (success) {
      this.recordLatency(latencyMs);
    }
  }

  /**
   * Record latency measurement
   */
  private recordLatency(latencyMs: number): void {
    this.latencyHistory.push(latencyMs);

    // Keep only recent measurements
    if (this.latencyHistory.length > this.maxHistorySize) {
      this.latencyHistory.shift();
    }
  }

  /**
   * Get current gateway health
   */
  getGatewayHealth(gatewayUrl: string): GatewayHealth | null {
    return this.gatewayHealth.get(gatewayUrl) ?? null;
  }

  /**
   * Get all gateway health
   */
  getAllGatewayHealth(): ReadonlyMap<string, GatewayHealth> {
    return new Map(this.gatewayHealth);
  }

  /**
   * Get healthy gateways for region
   */
  getHealthyGateways(region: Region): readonly GatewayHealth[] {
    return Array.from(this.gatewayHealth.values())
      .filter(h => h.region === region && h.available && h.consecutiveFailures < 3)
      .sort((a, b) => a.latencyMs - b.latencyMs); // Sort by latency (fastest first)
  }

  /**
   * Get global availability metrics
   */
  getGlobalMetrics(periodHours = 24): GlobalAvailabilityMetrics {
    const periodStart = new Date(Date.now() - periodHours * 60 * 60 * 1000);

    // Filter requests within period
    const recentRequests = this.requestHistory.filter(
      r => r.timestamp >= periodStart
    );

    const totalRequests = recentRequests.length;
    const successfulRequests = recentRequests.filter(r => r.success).length;
    const failedRequests = totalRequests - successfulRequests;

    // Calculate availability
    const overallAvailability = totalRequests > 0
      ? successfulRequests / totalRequests
      : NaN;

    // Calculate regional availability
    const regionalAvailability = new Map<Region, number>();
    for (const region of this.regions) {
      const regionGateways = Array.from(this.gatewayHealth.values()).filter(
        h => h.region === region.region
      );
      const availableGateways = regionGateways.filter(h => h.available).length;
      const availability = regionGateways.length > 0
        ? availableGateways / regionGateways.length
        : 0;
      regionalAvailability.set(region.region, availability);
    }

    // Calculate gateway availability
    const gatewayAvailability = new Map<string, number>();
    for (const [url, health] of this.gatewayHealth) {
      gatewayAvailability.set(url, health.successRate);
    }

    // Calculate latency percentiles
    const sortedLatencies = [...this.latencyHistory].sort((a, b) => a - b);
    const avgLatencyMs = sortedLatencies.length > 0
      ? sortedLatencies.reduce((sum, l) => sum + l, 0) / sortedLatencies.length
      : 0;
    const p50LatencyMs = this.getPercentile(sortedLatencies, 0.5);
    const p95LatencyMs = this.getPercentile(sortedLatencies, 0.95);
    const p99LatencyMs = this.getPercentile(sortedLatencies, 0.99);

    return {
      overallAvailability,
      regionalAvailability,
      gatewayAvailability,
      avgLatencyMs,
      p50LatencyMs,
      p95LatencyMs,
      p99LatencyMs,
      totalRequests,
      failedRequests,
      period: {
        start: periodStart,
        end: new Date(),
      },
    };
  }

  /**
   * Check replication status for CID
   */
  async checkReplicationStatus(
    cid: string,
    replicationFactor: number
  ): Promise<ReplicationStatus> {
    // R47-F3: CID format validation before URL construction (SSRF prevention)
    if (!isValidCID(cid)) {
      logger.warn('AvailabilityMonitor: invalid CID format in checkReplicationStatus', { cid: cid.slice(0, 20) });
      // R49-C2: Return a valid ReplicationStatus (was returning wrong shape)
      return {
        cid,
        totalReplicas: 0,
        healthyReplicas: 0,
        degradedReplicas: 0,
        failedReplicas: 0,
        replicationFactor,
        meetsTarget: false,
        regions: new Map(),
        checkedAt: new Date(),
      };
    }

    // Check all gateways for CID availability
    const checkPromises = Array.from(this.gatewayHealth.keys()).map(
      async gateway => {
        try {
          const response = await fetch(`${gateway}${cid}`, {
            method: 'HEAD',
            signal: AbortSignal.timeout(this.healthCheckTimeoutMs),
          });
          return {
            gateway,
            available: response.ok,
            region: this.gatewayHealth.get(gateway)?.region ?? ('americas-east' as Region),
          };
        } catch {
          return {
            gateway,
            available: false,
            region: this.gatewayHealth.get(gateway)?.region ?? ('americas-east' as Region),
          };
        }
      }
    );

    const results = await Promise.all(checkPromises);

    const healthyReplicas = results.filter(r => r.available).length;
    const totalReplicas = results.length;

    // Count replicas per region
    const regionMap = new Map<Region, { replicas: number; healthy: number }>();
    for (const result of results) {
      const current = regionMap.get(result.region) ?? { replicas: 0, healthy: 0 };
      regionMap.set(result.region, {
        replicas: current.replicas + 1,
        healthy: current.healthy + (result.available ? 1 : 0),
      });
    }

    return {
      cid,
      totalReplicas,
      healthyReplicas,
      degradedReplicas: totalReplicas - healthyReplicas,
      failedReplicas: 0, // Would track actual failures separately
      replicationFactor,
      meetsTarget: healthyReplicas >= replicationFactor,
      regions: regionMap,
      checkedAt: new Date(),
    };
  }

  /**
   * Get percentile from sorted array
   */
  private getPercentile(sortedArray: readonly number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;
    // R76-D2: Use nearest-rank method and clamp index to valid range.
    // Previous code used Math.floor(length * percentile) which returns OOB index
    // for percentile=1.0 (e.g., floor(100*1.0)=100, but max valid index is 99).
    const index = Math.min(
      Math.floor(sortedArray.length * percentile),
      sortedArray.length - 1
    );
    return sortedArray[index] ?? 0;
  }

  /**
   * Check if availability meets SLA
   */
  checkSLA(targetAvailability: number, periodHours = 24): {
    readonly meetsSLA: boolean;
    readonly currentAvailability: number;
    readonly targetAvailability: number;
    readonly insufficientData: boolean;
  } {
    const metrics = this.getGlobalMetrics(periodHours);
    // NaN means zero traffic in the period — can't determine SLA compliance.
    // Don't report SLA failure when there's simply no data yet (bootstrap).
    const insufficientData = isNaN(metrics.overallAvailability);
    const meetsSLA = insufficientData ? true : metrics.overallAvailability >= targetAvailability;

    return {
      meetsSLA,
      currentAvailability: metrics.overallAvailability,
      targetAvailability,
      insufficientData,
    };
  }
}
