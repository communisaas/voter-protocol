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
export { DistrictLookupService } from './district-service.js';
export { ProofService, toCompactProof, fromCompactProof } from './proof-generator.js';
export { SyncService } from './sync-service.js';
export { HealthMonitor } from './health.js';
export { ShadowAtlasAPI, createShadowAtlasAPI } from './api.js';
export { RegistrationService } from './registration-service.js';
export { InsertionLog } from './insertion-log.js';
export { BubbleService } from './bubble-service.js';
export { CommunityFieldService } from './community-field-service.js';

// Community field types
export type {
  CommunityFieldContribution,
  CommunityFieldSubmission,
  EpochSummary,
} from './community-field-service.js';

// Bubble types
export type {
  BubbleQueryRequest,
  BubbleQueryResponse,
  FenceResult,
  ClippedDistrict,
  PostalExtent,
} from './bubble-service.js';

// Registration types
export type {
  RegistrationResult,
  CellProofResult,
  CellMapState,
} from './registration-service.js';

// Insertion log types
export type {
  InsertionLogEntry,
  InsertionLogOptions,
} from './insertion-log.js';

// Sync service types
export type {
  PinnedLogMetadata,
  SyncServiceConfig,
} from './sync-service.js';

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
} from './types.js';

export type { CompactProof } from './proof-generator.js';
