/**
 * Shadow Atlas - Geospatial Voting District Registry
 * 
 * @voter-protocol/shadow-atlas provides:
 * - Merkle tree construction for voting district boundaries
 * - Geospatial data acquisition from TIGER/Census and municipal sources
 * - Proof generation for ZK-based voter eligibility verification
 * - IPFS distribution for decentralized registry storage
 * 
 * @packageDocumentation
 */

// Core Merkle Tree (async API - uses Noir Poseidon2)
export {
    ShadowAtlasMerkleTree,
    createShadowAtlasMerkleTree,
    computeLeafHash,
    computeLeafHashesBatch,
    AUTHORITY_LEVELS,
    type MerkleLeafInput,
    type MerkleProof,
    type MerkleTreeConfig,
    type IPFSExportResult,
    type ProvenanceSource,
    exportToIPFS,
} from './merkle-tree.js';

// Multi-Layer Builder
export {
    MultiLayerMerkleTreeBuilder,
    type MerkleBoundaryInput,
    /**
     * @deprecated Use MerkleBoundaryInput instead. This alias exists for backward compatibility
     * and will be removed in v2.0. For general boundary provider types, import from
     * './core/types.js' directly.
     */
    type NormalizedBoundary,
    type MultiLayerMerkleTree,
    type MerkleLeafWithMetadata,
    type MultiLayerMerkleProof,
    type BoundaryLayers,
} from './core/multi-layer-builder.js';

// Global Merkle Tree (for multi-country support)
export {
    GlobalMerkleTreeBuilder,
    GLOBAL_AUTHORITY_LEVELS,
    REGION_NAMES,
    type GlobalBoundaryType,
    type AuthorityLevel,
    type ContinentalRegion,
    type GlobalDistrictInput,
    type DistrictLeafHash,
    type RegionalTree,
    type CountryTree,
    type ContinentalTree,
    type GlobalMerkleTree,
    type GlobalDistrictProof,
    type GlobalTreeUpdateResult,
} from './core/global-merkle-tree.js';

// TIGER boundary types
export type { TIGERBoundaryType } from './provenance/tiger-authority-rules.js';

// Legislative layer types
export type { LegislativeLayerType } from './core/registry/state-gis-portals.js';

// Transformation and Validation
export {
    TransformationValidator,
    type FIPSValidation,
} from './transformation/validator.js';

// Core Boundary Types and Utilities
export {
    BoundaryType,
    type BoundaryMetadata,
    type BoundaryGeometry,
    type BoundaryResolution,
    type LatLng,
    type BBox,
    type PolygonRing,
    PRECISION_RANK,
    isBoundaryValid,
    getPrecisionRank,
    comparePrecision,
    formatBoundary,
    isPointInBBox,
} from './core/types/boundary.js';

// Geographic Utilities
export {
    extractCoordinatesFromFeature,
    extractCoordinatesFromGeometry,
    extractExteriorCoordinates,
    type GeoPoint,
    calculateCentroid,
    calculateFeatureCentroid,
    computeBoundingBox,
    computeFeatureBoundingBox,
    extractBBox,
    calculateCentroidFromGeometry,
    calculateCentroidFromBBox,
    pointInPolygon,
    pointInGeometry,
} from './core/geo-utils.js';

// Provenance Types
export type { ProvenanceRecord } from './provenance/provenance-writer.js';

// Poseidon2 hasher (async version using Noir) - re-exported from crypto package
export {
    Poseidon2Hasher,
    getHasher,
    hashPair,
    hashSingle,
    hashString,
} from '@voter-protocol/crypto/poseidon2';

// Snapshot Versioning
export {
    SnapshotManager,
    type Snapshot,
    type SnapshotMetadata,
    type SnapshotDiff,
    type SnapshotListEntry,
} from './distribution/snapshots/index.js';

// Change Detection (TIGER source monitoring)
export {
    ChangeDetectionAdapter,
    type TigerSourceConfig,
    type ChangeDetectionConfig,
    type ChangeDetectionAdapterResult,
} from './acquisition/change-detection-adapter.js';

// TIGER Batch Ingestion Orchestrator
export {
    TIGERIngestionOrchestrator,
    createTIGERIngestionOrchestrator,
    type BatchIngestionOptions,
    type BatchIngestionResult,
    type BatchIngestionError,
    type CheckpointState,
} from './acquisition/tiger-ingestion-orchestrator.js';

// Global Tree Adapter (multi-country support)
export {
    GlobalTreeAdapter,
    extractCountryRoots,
    extractContinentalRoots,
    type GlobalTreeConfig,
    type UnifiedMerkleTree,
} from './core/global-tree-adapter.js';

// Cross-Validation and School District Validation
export {
    CrossValidator,
    SchoolDistrictValidator,
    type CrossValidationConfig,
    type CrossValidationResult,
    type GeometryMismatch,
    type SchoolDistrictValidationResult,
} from './validators/index.js';

// Shadow Atlas Service (unified entry point)
export { ShadowAtlasService } from './core/shadow-atlas-service.js';

// Core Types (for service configuration and results)
export type {
    AtlasBuildOptions,
    AtlasBuildResult,
    TIGERLayerType,
    TIGERValidationOptions,
    TIGERValidationResult,
    TIGERLayerValidation,
    LayerValidationResult,
    BuildManifest,
    SourceManifest,
    LayerManifest,
    ValidationManifest,
    CheckForChangesOptions,
    ChangeCheckResult,
    BuildIfChangedResult,
} from './core/types.js';

// Configuration
export { DEFAULT_CONFIG, createConfig, type ShadowAtlasConfig } from './core/config.js';

// Boundary Providers
export {
    DCWardsProvider,
    createDCWardsProvider,
    isValidDCWardId,
    getWardNumber,
} from './providers/dc-wards-provider.js';

// Special District Providers (non-TIGER boundaries)
export {
    SpecialDistrictProvider,
    CaliforniaFireDistrictsProvider,
    SPECIAL_DISTRICT_PROVIDERS,
    SPECIAL_DISTRICT_PRIORITY,
    getSpecialDistrictProvider,
    registerSpecialDistrictProvider,
    getProvidersForState,
    getProvidersByType,
    getDistrictTypesForState,
    type SpecialDistrictType,
    type SpecialDistrictMetadata,
    type NormalizedSpecialDistrict,
    type GovernanceType,
} from './providers/special-district-provider.js';

// Registry Exports (generated from canonical NDJSON data)
export {
    KNOWN_PORTALS,
    PORTAL_COUNT,
    type KnownPortal,
    type PortalType,
    type DiscoveredBy,
} from './core/registry/known-portals.generated.js';

export {
    QUARANTINED_PORTALS,
    QUARANTINE_COUNT,
    type QuarantinedPortal,
} from './core/registry/quarantined-portals.generated.js';

export {
    AT_LARGE_CITIES,
    AT_LARGE_COUNT,
    type AtLargeCity,
} from './core/registry/at-large-cities.generated.js';

// Registry Utility Functions
export {
    // Known Portals utilities
    isStale,
    getPortal,
    hasPortal,
    // Quarantined Portals utilities
    isQuarantined,
    getQuarantinedPortal,
    getQuarantineSummary,
    // At-Large Cities utilities
    isAtLargeCity,
    getAtLargeCityInfo,
    getAtLargeCitiesByState,
    getAtLargeCityStats,
} from './core/registry/registry-utils.js';
