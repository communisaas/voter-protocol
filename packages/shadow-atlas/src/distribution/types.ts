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
  readonly healthCheckCID: string;
}

// ============================================================================
// Pinning Service Types
// ============================================================================

/**
 * Supported pinning services
 */
export type PinningServiceType = 'storacha' | 'pinata' | 'web3storage' | 'nftstorage' | 'fleek' | 'lighthouse';

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

// ============================================================================
// CID Validation (R47-F3: Shared utility — defense-in-depth at every gateway URL site)
// ============================================================================

/**
 * CID format regex: CIDv0 (Qm + 44 base58) or CIDv1 in multiple multibase encodings.
 * R73-F11: Accept CIDv1 in base32 (b), base36 (k), and base58btc (z) multibase encodings.
 * Extracted from R20-M2 (fallback-resolver) for reuse across all distribution services.
 */
// R73-F11: Accept CIDv1 in base32 (b), base36 (k), and base58btc (z) multibase encodings
export const CID_FORMAT_REGEX = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,}|k[a-z0-9]{50,}|z[1-9A-HJ-NP-Za-km-z]{46,})$/;

/**
 * Validate CID format before use in URL construction.
 * Prevents SSRF/path-traversal via malformed CID parameters.
 */
export function isValidCID(cid: string): boolean {
  return CID_FORMAT_REGEX.test(cid);
}

// ============================================================================
// Cell Chunk Types (Client-Side ZKP — IPFS-distributed SMT proofs)
// ============================================================================

/**
 * Combined cell chunk file: districts + Tree 2 SMT proofs per H3 res-3 parent.
 *
 * Published to IPFS at `{rootCID}/{country}/cells/{parentCell}.json`.
 * One fetch gives the client everything needed for client-side ZK proof generation:
 * district slots, SMT siblings, path bits, and the tree root.
 *
 * The client never contacts the Shadow Atlas server for Tree 2 data —
 * eliminating the cell_id privacy leak in `GET /cell-proof?cell_id=X`.
 *
 * Size: ~260 KB raw / ~50-80 KB gzipped per chunk (~87 cells avg for US).
 */
export interface CellChunkFile {
  /** Schema version. Must be 1. */
  readonly version: 1;
  /** ISO 3166-1 alpha-2 country code */
  readonly country: string;
  /** H3 cell index of the res-3 parent that groups these cells */
  readonly parentCell: string;
  /** Tree 2 SMT root (0x-hex BN254 field element) — same for all cells in this epoch */
  readonly cellMapRoot: string;
  /** SMT depth (e.g., 20) */
  readonly depth: number;
  /** ISO 8601 generation timestamp */
  readonly generated: string;
  /** Map of cell_id (string) → CellEntry */
  readonly cells: Readonly<Record<string, CellEntry>>;
  /** Number of cells in this chunk (integrity check) */
  readonly cellCount: number;
}

/**
 * Per-cell entry within a CellChunkFile.
 *
 * Field names are single-letter to minimize JSON size on IPFS:
 *   c = cell_id, d = districts, p = path (SMT siblings), b = bits (direction), a = attempt
 *
 * The client reads these directly as circuit inputs:
 *   - `c` → private input `cell_id` (the BN254 field element the circuit uses)
 *   - `d` → public input `districts[24]`
 *   - `p` → private input `cell_map_path[TREE_DEPTH]`
 *   - `b` → private input `cell_map_path_bits[TREE_DEPTH]`
 *   - `a` → used for position derivation verification (informational)
 *
 * IMPORTANT: Cells are keyed by H3 index (what the browser knows from latLngToCell),
 * but the circuit uses the GEOID-encoded `cell_id` (stored in `c`). The browser must
 * use `c` as the circuit's cell_id input.
 */
export interface CellEntry {
  /** cell_id as 0x-hex BN254 field element (GEOID encoded — for circuit private input) */
  readonly c: string;
  /** districts[24] as 0x-hex BN254 field elements (circuit public input) */
  readonly d: readonly string[];
  /** SMT siblings from leaf to root, 0x-hex BN254 (length = depth) */
  readonly p: readonly string[];
  /** SMT direction bits: 0 = left child, 1 = right child (length = depth) */
  readonly b: readonly number[];
  /** SMT collision attempt counter (0 in most cases) */
  readonly a: number;
}
