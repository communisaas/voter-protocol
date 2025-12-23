/**
 * Shadow Atlas Serving Layer
 *
 * Production-ready API for <50ms district lookups with cryptographic verification.
 *
 * @example
 * ```typescript
 * import { createShadowAtlasAPI } from '@voter-protocol/crypto/shadow-atlas/serving';
 *
 * const api = await createShadowAtlasAPI('/data/shadow-atlas-v1.db', {
 *   port: 3000,
 *   corsOrigins: ['https://voter-protocol.org'],
 *   rateLimitPerMinute: 60,
 * });
 *
 * api.start();
 * ```
 */

// Core services
export { DistrictLookupService } from './district-service';
export { ProofService, toCompactProof, fromCompactProof } from './proof-generator';
export { SyncService } from './sync-service';
export { HealthMonitor } from './health';
export { ShadowAtlasAPI, createShadowAtlasAPI } from './api';

// Types
export type {
  DistrictBoundary,
  GeoJSONPolygon,
  ProvenanceMetadata,
  LookupResult,
  SnapshotMetadata,
  HealthMetrics,
  QueryMetrics,
  CacheMetrics,
  SnapshotMetrics,
  ErrorMetrics,
  ErrorSample,
  VerificationResult,
  APIError,
  ErrorCode,
  ServingConfig,
  DatabaseConfig,
  CacheConfig,
  SyncConfig,
  APIConfig,
} from './types';

export type { CompactProof } from './proof-generator';
