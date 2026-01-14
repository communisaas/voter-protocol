/**
 * Shadow Atlas Core Types - Barrel Export
 *
 * Single import point for all core type definitions.
 * Types are organized into focused modules by domain.
 *
 * CRITICAL TYPE SAFETY: These types define the contract for event-sourced,
 * content-addressed municipal boundary data. Type errors here can brick
 * the entire discovery pipeline.
 */

// ============================================================================
// Re-exports from Boundary Types (types/boundary.ts)
// ============================================================================

export {
  BoundaryType,
  type BoundaryMetadata,
  type BoundaryGeometry,
  type BoundaryResolution,
  type LatLng,
  type BBox,
  type PolygonRing,
  PRECISION_RANK,
  // Helper functions
  isBoundaryValid,
  getPrecisionRank,
  comparePrecision,
  formatBoundary,
  isPointInBBox,
} from './boundary.js';

// Re-export extractBBox from geo-utils
export { extractBBox } from '../geo-utils.js';

// ============================================================================
// Re-export from Provenance Writer
// ============================================================================

export type { ProvenanceRecord } from '../../provenance/provenance-writer.js';

// ============================================================================
// Database Types
// ============================================================================

export type {
  Municipality,
  SourceKind,
  Source,
  DecisionType,
  Selection,
  Artifact,
  Head,
  EventKind,
  Event,
  StatusType,
  StatusView,
  CoverageView,
  NormalizedGeoJSON,
  GeoJSONFeature,
  GeoJSONGeometry,
  LLMBatchCity,
  LLMBatchCandidate,
  LLMLayerInfo,
  LLMBatchInput,
  LLMBatchCityInput,
  LLMDecision,
  FetcherSourceMetadata,
  FetchResult,
  DatabaseAdapter,
  StorageAdapter,
  DistrictRecord,
} from './database.js';

// ============================================================================
// Discovery Types
// ============================================================================

export type {
  AdministrativeLevel,
  DiscoveryStatus,
  PortalType,
  AuthorityLevel,
  LegalStatus,
  CollectionMethod,
  DiscoveryState,
  DiscoveryQuery,
  DiscoveryResult,
  DiscoveryBatchResult,
} from './discovery.js';

// ============================================================================
// Provider Types
// ============================================================================

export type {
  UpdateSchedule,
  BoundaryFileFormat,
  VerificationSource,
  UpdateMonitoringMethod,
  BoundaryProvider,
  DownloadParams,
  RawBoundaryFile,
  NormalizedBoundary,
  ProviderSourceMetadata,
  UpdateMetadata,
  ProviderConfig,
  BoundaryFeatureCollection,
  TransformOptions,
  ProviderValidationResult,
  ValidationError,
  ValidationWarning,
} from './provider.js';

// ============================================================================
// Provenance Types
// ============================================================================

export type {
  BaseProvenanceMetadata,
  ProvenanceMetadata,
  AcquisitionProvenanceMetadata,
  ServingProvenanceMetadata,
} from './provenance.js';

// ============================================================================
// Transformation Types
// ============================================================================

export type {
  RawDataset,
  TransformationValidationResult,
  ValidationContext,
  NormalizedDistrict,
  BoundingBox,
  TransformationResult,
  TransformationMetadata,
  StageResult,
  ValidationStats,
  NormalizationStats,
  IPFSPublication,
} from './transformation.js';

// ============================================================================
// Merkle Tree Types
// ============================================================================

export type {
  MerkleProof,
  MerkleTree,
} from './merkle.js';

// ============================================================================
// Atlas Build and TIGER Types
// ============================================================================

export type {
  TIGERLayerType,
  TIGERLayer,
  LegislativeLayerType,
  LayerType,
  TIGERValidationOptions,
  TIGERLayerValidation,
  TIGERValidationResult,
  CompletenessResult,
  TopologyResult,
  CoordinateResult,
  AtlasBuildOptions,
  LayerValidationResult,
  CrossValidationStatus,
  AtlasBuildResult,
  CrossValidationSummary,
  SchoolDistrictValidationSummary,
  BuildManifest,
  SourceManifest,
  LayerManifest,
  ValidationManifest,
  EnvironmentManifest,
  // Change detection types
  CheckForChangesOptions,
  ChangeReport,
  ChangeCheckResult,
  BuildIfChangedResult,
  // Proof template types
  ProofTemplate,
  ProofTemplateStore,
} from './atlas.js';

// ============================================================================
// ShadowAtlasService Types
// ============================================================================

export type {
  ExtractionScope,
  RegionConfig,
  IncrementalScope,
  ExtractionOptions,
  ValidationOptions,
  StorageConfig,
  ProgressEvent,
  PipelineResult,
  ExtractionSummary,
  ExtractionFailure,
  ValidationSummary,
  CommitmentResult,
  IncrementalResult,
  IncrementalOptions,
  ChangeDetectionResult,
  HealthCheckResult,
  ProviderHealth,
  JobState,
  SnapshotMetadata,
} from './service.js';

// ============================================================================
// Rate Limiter Types
// ============================================================================

export type {
  UnifiedRateLimiterConfig,
  UnifiedRateLimitResult,
  UnifiedRateLimiter,
} from './rate-limiter.js';

// ============================================================================
// FIPS Code Mappings and Utilities
// ============================================================================

export {
  STATE_FIPS_TO_NAME,
  STATE_ABBR_TO_FIPS,
  getStateNameFromFips,
  getFipsFromStateAbbr,
} from './fips.js';

// ============================================================================
// Federal Jurisdiction Types (P0-2: Military Installations)
// ============================================================================

export type {
  FederalJurisdictionType,
  InstallationStatus,
  MilitaryBranch,
  FederalAgency,
  MilitaryInstallationMetadata,
  VotingJurisdictionResolution,
  VotingResolutionMethod,
} from './federal-jurisdiction.js';

export {
  getVotingJurisdiction,
  allowsStateVoting,
  getResolutionConfidence,
  isJointBase,
  isMultiStateInstallation,
  isActiveInstallation,
  getPrimaryVotingCounty,
} from './federal-jurisdiction.js';

// ============================================================================
// Temporal Versioning Types (P0-1: Court-Ordered Redistricting)
// ============================================================================

export type {
  BoundaryVersionStatus,
  CourtOrderType,
  CourtLevel,
  CourtOrderProvenance,
  BoundaryMetadataVersioned,
  MapSource,
  VersionResolutionQuery,
  VersionResolutionResult,
  ResolutionMethod,
  BoundaryVersionChain,
} from './temporal-versioning.js';

export {
  COURT_ORDER_PRECEDENCE,
  COURT_LEVEL_PRECEDENCE,
  compareCourtOrderPrecedence,
  isVersionEffective,
  getVersionConfidence,
} from './temporal-versioning.js';

// ============================================================================
// Error Types (Validation Halt Gates)
// ============================================================================

export type { ValidationHaltStage, ValidationHaltDetails } from './errors.js';
export { ValidationHaltError, isValidationHaltError } from './errors.js';

// ============================================================================
// Validator Types (Cross-validation and TIGERValidator result types)
// ============================================================================

export type {
  ValidationIssueSeverity,
  ValidationIssue,
  GeometryMismatch,
  CrossValidationResult,
  GapStatus,
  RedistrictingGapWarning,
  ValidationResult,
} from './validators.js';
