/**
 * Shadow Atlas Serving Layer - Type Definitions
 *
 * CRITICAL TYPE SAFETY: Production serving layer with strict types.
 * Zero tolerance for loose typing in user-facing API.
 */

import type { MerkleProof } from '../merkle-tree';

// ============================================================================
// Re-export Provenance Types from Core (Single Source of Truth)
// ============================================================================

export type {
  BaseProvenanceMetadata,
  ServingProvenanceMetadata,
  ServingProvenanceMetadata as ProvenanceMetadata,
} from '../core/types.js';

import type { ServingProvenanceMetadata } from '../core/types.js';

/**
 * District boundary result from lookup
 * Uses ServingProvenanceMetadata (minimal subset for API responses)
 */
export interface DistrictBoundary {
  readonly id: string;
  readonly name: string;
  readonly jurisdiction: string;
  readonly districtType: 'council' | 'ward' | 'municipal';
  readonly geometry: GeoJSONPolygon;
  readonly provenance: ServingProvenanceMetadata;
}

/**
 * GeoJSON Polygon geometry (WGS84)
 */
export interface GeoJSONPolygon {
  readonly type: 'Polygon' | 'MultiPolygon';
  readonly coordinates: readonly number[][][] | readonly number[][][][];
}

/**
 * Lookup result with Merkle proof
 */
export interface LookupResult {
  readonly district: DistrictBoundary;
  readonly merkleProof: MerkleProof;
  readonly latencyMs: number;
  readonly cacheHit: boolean;
}

/**
 * Snapshot metadata (IPFS + Merkle root)
 */
export interface SnapshotMetadata {
  readonly cid: string;
  readonly merkleRoot: bigint;
  readonly timestamp: number;
  readonly districtCount: number;
  readonly version: string;
}

/**
 * Health check metrics
 */
export interface HealthMetrics {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly uptime: number;
  readonly queries: QueryMetrics;
  readonly cache: CacheMetrics;
  readonly snapshot: SnapshotMetrics;
  readonly errors: ErrorMetrics;
  readonly timestamp: number;
}

export interface QueryMetrics {
  readonly total: number;
  readonly successful: number;
  readonly failed: number;
  readonly latencyP50: number;
  readonly latencyP95: number;
  readonly latencyP99: number;
  readonly throughput: number;
}

export interface CacheMetrics {
  readonly size: number;
  readonly hits: number;
  readonly misses: number;
  readonly hitRate: number;
  readonly evictions: number;
}

export interface SnapshotMetrics {
  readonly currentCid: string;
  readonly merkleRoot: string;
  readonly districtCount: number;
  readonly ageSeconds: number;
  readonly nextCheckSeconds: number;
}

export interface ErrorMetrics {
  readonly last5m: number;
  readonly last1h: number;
  readonly last24h: number;
  readonly recentErrors: readonly ErrorSample[];
}

export interface ErrorSample {
  readonly timestamp: number;
  readonly error: string;
  readonly lat?: number;
  readonly lon?: number;
}

/**
 * Verification result for Merkle proof
 */
export interface VerificationResult {
  readonly valid: boolean;
  readonly computedRoot: bigint;
  readonly expectedRoot: bigint;
}

/**
 * API error response
 */
export interface APIError {
  readonly error: string;
  readonly code: ErrorCode;
  readonly timestamp: number;
  readonly requestId?: string;
}

export type ErrorCode =
  | 'INVALID_COORDINATES'
  | 'DISTRICT_NOT_FOUND'
  | 'PROOF_GENERATION_FAILED'
  | 'SNAPSHOT_UNAVAILABLE'
  | 'INTERNAL_ERROR'
  | 'RATE_LIMIT_EXCEEDED'
  | 'NOT_FOUND';

/**
 * Configuration for serving layer
 */
export interface ServingConfig {
  readonly database: DatabaseConfig;
  readonly cache: CacheConfig;
  readonly sync: SyncConfig;
  readonly api: APIConfig;
}

export interface DatabaseConfig {
  readonly path: string;
  readonly readonly: boolean;
}

export interface CacheConfig {
  readonly maxSize: number;
  readonly ttlSeconds: number;
}

export interface SyncConfig {
  readonly ipfsGateway: string;
  readonly checkIntervalSeconds: number;
  readonly autoUpdate: boolean;
}

export interface APIConfig {
  readonly port: number;
  readonly host: string;
  readonly corsOrigins: readonly string[];
  readonly rateLimitPerMinute: number;
}
