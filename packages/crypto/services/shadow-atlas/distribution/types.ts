/**
 * Global IPFS Distribution Types
 *
 * Type definitions for globally distributed Shadow Atlas Merkle trees.
 * Supports multi-region pinning, gateway failover, and zero-downtime updates.
 *
 * PERFORMANCE TARGETS:
 * - <100ms lookup latency from any region
 * - 99.9% availability (three-nines SLA)
 * - Graceful degradation on regional failures
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

// ============================================================================
// Geographic Region Types
// ============================================================================

/**
 * Geographic region for IPFS distribution
 *
 * Three primary regions provide global coverage:
 * - Americas (US East/West, South America)
 * - Europe (EU, Middle East, Africa)
 * - Asia-Pacific (APAC, Australia)
 */
export type Region =
  | 'americas-east'
  | 'americas-west'
  | 'americas-south'
  | 'europe-west'
  | 'europe-central'
  | 'africa-south'
  | 'asia-east'
  | 'asia-southeast'
  | 'asia-south'
  | 'oceania';

/**
 * Region configuration
 */
export interface RegionConfig {
  readonly region: Region;
  readonly gateways: readonly string[];
  readonly pinningServices: readonly string[];
  readonly priority: number; // 0 = highest priority
  readonly healthCheckUrl: string;
}

// ============================================================================
// Pinning Service Types
// ============================================================================

/**
 * Supported pinning services
 */
export type PinningServiceType = 'storacha' | 'pinata' | 'web3storage' | 'nftstorage' | 'fleek';

/**
 * Pinning service configuration
 */
export interface PinningServiceConfig {
  readonly type: PinningServiceType;
  readonly name: string;
  readonly apiEndpoint: string;
  readonly authToken?: string; // Optional for public gateways
  readonly regions: readonly Region[];
  readonly priority: number; // 0 = highest priority
  readonly costPerGB: number; // Monthly cost in USD
  readonly freeTierGB: number; // Free tier storage in GB
}

/**
 * Pinning result
 */
export interface PinResult {
  readonly success: boolean;
  readonly cid: string;
  readonly service: PinningServiceType;
  readonly region: Region;
  readonly pinnedAt: Date;
  readonly sizeBytes: number;
  readonly durationMs: number;
  readonly error?: string;
}

// ============================================================================
// Update Strategy Types
// ============================================================================

/**
 * Update strategy for global distribution
 */
export type UpdateStrategy = 'quarterly' | 'on-demand' | 'hybrid';

/**
 * Update rollout phase
 */
export interface RolloutPhase {
  readonly phase: number; // 1-based phase number
  readonly regions: readonly Region[];
  readonly delayMs: number; // Delay before starting this phase
  readonly verifyReplication: boolean;
}

/**
 * Rollout configuration
 */
export interface RolloutConfig {
  readonly strategy: UpdateStrategy;
  readonly phases: readonly RolloutPhase[];
  readonly rollbackOnFailure: boolean;
  readonly maxFailuresPerPhase: number;
}

// ============================================================================
// Distribution Configuration Types
// ============================================================================

/**
 * Global distribution configuration
 */
export interface GlobalDistributionConfig {
  readonly regions: readonly RegionConfig[];
  readonly pinningServices: readonly PinningServiceConfig[];
  readonly replicationFactor: number; // Min copies per region
  readonly updateStrategy: UpdateStrategy;
  readonly rollout: RolloutConfig;
  readonly healthCheck: {
    readonly intervalMs: number;
    readonly timeoutMs: number;
    readonly retries: number;
  };
  readonly monitoring: {
    readonly enabled: boolean;
    readonly alertThresholds: {
      readonly availabilityPercent: number;
      readonly latencyMs: number;
      readonly failureRate: number;
    };
  };
}

// ============================================================================
// Gateway Selection Types
// ============================================================================

/**
 * Gateway health status
 */
export interface GatewayHealth {
  readonly url: string;
  readonly region: Region;
  readonly available: boolean;
  readonly latencyMs: number;
  readonly successRate: number; // 0-1
  readonly lastChecked: Date;
  readonly consecutiveFailures: number;
}

/**
 * Gateway selection criteria
 */
export interface GatewaySelectionCriteria {
  readonly userRegion?: Region;
  readonly preferredGateways?: readonly string[];
  readonly maxLatencyMs: number;
  readonly minSuccessRate: number;
}

/**
 * Gateway selection result
 */
export interface GatewaySelectionResult {
  readonly gateway: string;
  readonly region: Region;
  readonly estimatedLatencyMs: number;
  readonly confidence: number; // 0-100
  readonly fallbacks: readonly string[];
}

// ============================================================================
// Global Publish Types
// ============================================================================

/**
 * Global publish options
 */
export interface GlobalPublishOptions {
  readonly regions: readonly Region[];
  readonly verifyReplication: boolean;
  readonly parallelUploads: number;
  readonly retryAttempts: number;
  readonly timeoutMs: number;
}

/**
 * Regional publish status
 */
export interface RegionalPublishStatus {
  readonly region: Region;
  readonly status: 'pending' | 'in_progress' | 'completed' | 'failed';
  readonly cid?: string;
  readonly pinResults: readonly PinResult[];
  readonly error?: string;
  readonly startedAt: Date;
  readonly completedAt?: Date;
}

/**
 * Global publish result
 */
export interface GlobalPublishResult {
  readonly success: boolean;
  readonly cid: string;
  readonly regions: readonly RegionalPublishStatus[];
  readonly totalReplicaCount: number;
  readonly totalDurationMs: number;
  readonly publishedAt: Date;
  readonly verificationStatus?: {
    readonly verified: boolean;
    readonly reachableGateways: number;
    readonly totalGateways: number;
    readonly avgLatencyMs: number;
  };
}

// ============================================================================
// Monitoring Types
// ============================================================================

/**
 * Global availability metrics
 */
export interface GlobalAvailabilityMetrics {
  readonly overallAvailability: number; // 0-1 (99.9% = 0.999)
  readonly regionalAvailability: ReadonlyMap<Region, number>;
  readonly gatewayAvailability: ReadonlyMap<string, number>;
  readonly avgLatencyMs: number;
  readonly p50LatencyMs: number;
  readonly p95LatencyMs: number;
  readonly p99LatencyMs: number;
  readonly totalRequests: number;
  readonly failedRequests: number;
  readonly period: {
    readonly start: Date;
    readonly end: Date;
  };
}

/**
 * Replication status
 */
export interface ReplicationStatus {
  readonly cid: string;
  readonly totalReplicas: number;
  readonly healthyReplicas: number;
  readonly degradedReplicas: number;
  readonly failedReplicas: number;
  readonly replicationFactor: number;
  readonly meetsTarget: boolean;
  readonly regions: ReadonlyMap<Region, {
    readonly replicas: number;
    readonly healthy: number;
  }>;
  readonly checkedAt: Date;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Distribution error types
 */
export type DistributionErrorType =
  | 'network_timeout'
  | 'authentication_failed'
  | 'quota_exceeded'
  | 'gateway_unavailable'
  | 'replication_failed'
  | 'verification_failed'
  | 'invalid_cid'
  | 'unknown';

/**
 * Distribution error
 */
export interface DistributionError {
  readonly type: DistributionErrorType;
  readonly message: string;
  readonly region?: Region;
  readonly service?: PinningServiceType;
  readonly retryable: boolean;
  readonly timestamp: Date;
}

// ============================================================================
// Fallback Strategy Types
// ============================================================================

/**
 * Fallback strategy for gateway failures
 */
export interface FallbackStrategy {
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly exponentialBackoff: boolean;
  readonly fallbackToSlowGateways: boolean;
  readonly cacheFailures: boolean;
  readonly failureWindowMs: number; // How long to cache failure status
}

/**
 * Fallback resolution result
 */
export interface FallbackResolutionResult {
  readonly success: boolean;
  readonly gateway: string;
  readonly region: Region;
  readonly attemptCount: number;
  readonly totalDurationMs: number;
  readonly errors: readonly DistributionError[];
}
