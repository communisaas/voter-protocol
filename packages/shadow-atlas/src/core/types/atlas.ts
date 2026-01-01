/**
 * Atlas Build and TIGER Types
 *
 * Types for building the Shadow Atlas from TIGER/Line data,
 * including validation and layer configuration.
 */

// ============================================================================
// Error Classes
// ============================================================================

export { BuildValidationError } from '../errors.js';

/**
 * TIGER Layer Types - Complete US Civic Boundary Coverage
 *
 * Organized by civic participation priority:
 * - T1 (Elected Federal/State): cd, sldu, sldl
 * - T2 (Elected Local): place, unsd, elsd, scsd
 * - T3 (Administrative): county, cousub, vtd
 * - T4 (Reference): cdp, zcta
 */
export type TIGERLayerType =
  // Federal/State Legislative (Tier 1 - Elected Representatives)
  | 'cd'      // Congressional Districts (435)
  | 'sldu'    // State Legislative Upper (Senate) (~2,000)
  | 'sldl'    // State Legislative Lower (House) (~5,400)

  // County Level (Tier 2 - Elected Commissioners)
  | 'county'  // Counties (3,143)
  | 'cousub'  // County Subdivisions - townships, boroughs (~34,000)
  | 'submcd'  // Subminor Civil Divisions (~200)

  // Municipal (Tier 3 - City Boundaries)
  | 'place'   // Incorporated Places - cities, towns, villages (19,495)
  | 'cdp'     // Census Designated Places - unincorporated communities (~9,500)
  | 'concity' // Consolidated Cities (~40)

  // School Districts (Tier 4 - Elected School Boards)
  | 'unsd'    // Unified School Districts K-12 (~9,135)
  | 'elsd'    // Elementary School Districts K-8 (~3,064)
  | 'scsd'    // Secondary School Districts 9-12 (~273)

  // Electoral Infrastructure (Tier 5 - Finest Civic Unit)
  | 'vtd'     // Voting Districts - precincts (~200,000)

  // Tribal and Indigenous Governance (Tier 6 - Sovereign Nations)
  | 'aiannh'  // American Indian/Alaska Native/Native Hawaiian Areas (~700)
  | 'anrc'    // Alaska Native Regional Corporations (12)
  | 'tbg'     // Tribal Block Groups
  | 'ttract'  // Tribal Census Tracts

  // Metropolitan and Urban Planning (Tier 7 - Regional Coordination)
  | 'cbsa'    // Core Based Statistical Areas - metros (~940)
  | 'csa'     // Combined Statistical Areas (~170)
  | 'metdiv'  // Metropolitan Divisions (~30)
  | 'uac'     // Urban Areas (~3,600)
  | 'necta'   // New England City and Town Areas (~40)
  | 'cnecta'  // Combined NECTA (~10)
  | 'nectadiv' // NECTA Divisions (~7)

  // Reference Layers (Tier 8 - Mail/Demographic)
  | 'zcta'    // ZIP Code Tabulation Areas (~33,000)
  | 'tract'   // Census Tracts (~85,000)
  | 'bg'      // Block Groups (~242,000)
  | 'puma'    // Public Use Microdata Areas (~2,400)

  // Special Cases (Tier 9)
  | 'estate'  // Estates - US Virgin Islands only (3)

  // Federal Installations (P0-2: Overlay Layer)
  | 'mil';    // Military Installations (~850) - voting jurisdiction overlay

/**
 * Backwards compatibility alias
 * @deprecated Use TIGERLayerType instead
 */
export type TIGERLayer = TIGERLayerType;

/**
 * Legislative layer types for state boundary extraction
 */
export type LegislativeLayerType =
  | 'congressional'
  | 'state_senate'
  | 'state_house'
  | 'county';

/**
 * Unified layer type across all sources
 */
export type LayerType = TIGERLayerType | LegislativeLayerType;

/**
 * TIGER validation options
 */
export interface TIGERValidationOptions {
  /** State FIPS code or 'all' for national validation */
  readonly state?: string;

  /** Layers to validate (defaults to all layers) */
  readonly layers?: readonly TIGERLayerType[];

  /** TIGER year to validate (defaults to current year) */
  readonly year?: number;

  /** Minimum quality score threshold (0-100, defaults to 90) */
  readonly qualityThreshold?: number;
}

/**
 * TIGER layer validation result
 */
export interface TIGERLayerValidation {
  /** Layer type */
  readonly layer: TIGERLayerType;

  /** Whether this layer passed all validation checks */
  readonly valid: boolean;

  /** Overall quality score (0-100) */
  readonly qualityScore: number;

  /** Completeness validation result */
  readonly completeness: CompletenessResult;

  /** Topology validation result */
  readonly topology: TopologyResult;

  /** Coordinate validation result */
  readonly coordinates: CoordinateResult;

  /** When validation was performed */
  readonly validatedAt: Date;

  /** Human-readable summary */
  readonly summary: string;
}

/**
 * Overall TIGER validation result
 */
export interface TIGERValidationResult {
  /** State FIPS code or 'all' */
  readonly state: string;

  /** Human-readable state name */
  readonly stateName: string;

  /** TIGER year validated */
  readonly year: number;

  /** Results for each validated layer */
  readonly layers: readonly TIGERLayerValidation[];

  /** Whether all layers passed validation and met quality threshold */
  readonly overallValid: boolean;

  /** Average quality score across all layers */
  readonly averageQualityScore: number;

  /** Quality threshold that was applied */
  readonly qualityThreshold: number;

  /** Validation duration in milliseconds */
  readonly duration: number;

  /** When validation was performed */
  readonly validatedAt: Date;

  /** Human-readable summary */
  readonly summary: string;
}

/**
 * Completeness validation result (from TIGERValidator)
 */
export interface CompletenessResult {
  readonly valid: boolean;
  readonly expected: number;
  readonly actual: number;
  readonly percentage: number;
  readonly missingGEOIDs: readonly string[];
  readonly extraGEOIDs: readonly string[];
  readonly summary: string;
}

/**
 * Topology validation result (from TIGERValidator)
 */
export interface TopologyResult {
  readonly valid: boolean;
  readonly selfIntersections: number;
  readonly overlaps: readonly {
    readonly geoid1: string;
    readonly geoid2: string;
    readonly overlapArea: number;
  }[];
  readonly gaps: number;
  readonly invalidGeometries: readonly string[];
  readonly summary: string;
}

/**
 * Coordinate validation result (from TIGERValidator)
 */
export interface CoordinateResult {
  readonly valid: boolean;
  readonly outOfRangeCount: number;
  readonly nullCoordinates: readonly string[];
  readonly suspiciousLocations: readonly {
    readonly geoid: string;
    readonly reason: string;
    readonly centroid: { readonly lat: number; readonly lon: number };
  }[];
  readonly summary: string;
}

/**
 * Cross-validation configuration
 */
export interface CrossValidationConfig {
  /** Geometry match tolerance as percentage (default: 0.1% = 99.9% similarity required) */
  readonly tolerancePercent: number;

  /** Fail validation if state source unavailable (default: false) */
  readonly requireBothSources: boolean;

  /** Minimum geometry overlap percentage for match (default: 95%) */
  readonly minOverlapPercent: number;
}

/**
 * Validation issue severity levels
 */
export type ValidationIssueSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Validation issue
 */
export interface ValidationIssue {
  /** Issue severity level */
  readonly severity: ValidationIssueSeverity;

  /** Issue category */
  readonly category: 'count' | 'geoid' | 'geometry' | 'vintage';

  /** Human-readable message */
  readonly message: string;

  /** Optional details */
  readonly details?: Record<string, unknown>;
}

/**
 * Geometry mismatch between TIGER and state sources
 */
export interface GeometryMismatch {
  /** District identifier (GEOID) */
  readonly districtId: string;

  /** TIGER area in square meters */
  readonly tigerArea: number;

  /** State area in square meters */
  readonly stateArea: number;

  /** Area difference as percentage */
  readonly areaDifference: number;

  /** Overlap percentage (0-100) */
  readonly overlapPercent: number;

  /** Severity based on overlap percentage */
  readonly severity: ValidationIssueSeverity;
}

/**
 * Cross-validation result (TIGER vs State GIS portals)
 */
export interface DetailedCrossValidationResult {
  /** Layer type validated */
  readonly layer: string;

  /** State FIPS code */
  readonly state: string;

  /** Count of boundaries in TIGER source */
  readonly tigerCount: number;

  /** Count of boundaries in state source */
  readonly stateCount: number;

  /** Count of matched boundaries between sources */
  readonly matchedCount: number;

  /** Boundaries only in TIGER (missing from state) */
  readonly unmatchedTiger: readonly string[];

  /** Boundaries only in state (missing from TIGER) */
  readonly unmatchedState: readonly string[];

  /** Geometry mismatches above threshold */
  readonly geometryMismatches: readonly GeometryMismatch[];

  /** Overall quality score (0-100) */
  readonly qualityScore: number;

  /** Validation issues detected */
  readonly issues: readonly ValidationIssue[];
}

/**
 * Atlas build options
 */
export interface AtlasBuildOptions {
  /** Layers to include in the Atlas */
  readonly layers: readonly TIGERLayerType[];

  /** Optional: Filter to specific states (FIPS codes) */
  readonly states?: readonly string[];

  /** Optional: TIGER year (defaults to 2024) */
  readonly year?: number;

  /** Optional: Minimum quality threshold for validation (0-100, defaults to 80) */
  readonly qualityThreshold?: number;

  /** Optional: Output path for JSON export */
  readonly outputPath?: string;

  /** Optional: Cross-validation against state GIS portals */
  readonly crossValidation?: {
    /** Enable cross-validation */
    readonly enabled: boolean;

    /** States to cross-validate (FIPS codes) */
    readonly states: readonly string[];

    /** Fail build if cross-validation fails */
    readonly failOnMismatch: boolean;

    /** Cross-validation configuration */
    readonly config?: Partial<CrossValidationConfig>;
  };

  /**
   * Optional: Generate proof templates for all districts
   *
   * When enabled, generates Merkle proofs (siblings + path indices) for
   * each district in the tree. These are "proof templates" that can be
   * completed client-side with a user secret for nullifier computation.
   *
   * Stored in snapshot for later retrieval via getProofTemplate().
   *
   * @default false
   */
  readonly generateProofs?: boolean;
}

/**
 * Layer validation result for Atlas build
 */
export interface LayerValidationResult {
  /** Layer type */
  readonly layer: string;

  /** Quality score (0-100) */
  readonly qualityScore: number;

  /** Number of boundaries in layer */
  readonly boundaryCount: number;

  /** Expected boundary count */
  readonly expectedCount: number;

  /** Full validation result (null if failed before validation) */
  readonly validation: import('../../validators/tiger-validator.js').ValidationResult | null;

  /** Error message if layer failed */
  readonly error?: string;
}

/**
 * Cross-validation summary for Atlas build
 *
 * Summarizes the comparison between TIGER and state GIS portal boundaries.
 */
export interface CrossValidationSummary {
  /** Layer type that was cross-validated */
  readonly layer: string;

  /** State FIPS code */
  readonly state: string;

  /** Overall quality score (0-100) */
  readonly qualityScore: number;

  /** Count of boundaries in TIGER source */
  readonly tigerCount: number;

  /** Count of boundaries in state source */
  readonly stateCount: number;

  /** Count of matched boundaries between sources */
  readonly matchedCount: number;

  /** Number of validation issues detected */
  readonly issues: number;
}

/**
 * Cross-validation execution status
 *
 * Tracks whether cross-validation ran and how it completed:
 * - 'completed': All states validated successfully
 * - 'partial': Some states validated, others failed gracefully
 * - 'skipped': Explicitly skipped via config (enabled: false)
 * - 'failed_graceful': All states failed but build continued gracefully
 * - 'disabled': Cross-validation disabled in config
 */
export type CrossValidationStatus =
  | 'completed'
  | 'partial'
  | 'skipped'
  | 'failed_graceful'
  | 'disabled';

/**
 * Atlas build result
 */
export interface AtlasBuildResult {
  /** Job ID for this build */
  readonly jobId: string;

  /** Merkle root of the built tree */
  readonly merkleRoot: bigint;

  /** Total number of boundaries in the Atlas */
  readonly totalBoundaries: number;

  /** Boundary counts per layer type */
  readonly layerCounts: Record<string, number>;

  /** Validation results for each layer */
  readonly layerValidations: readonly LayerValidationResult[];

  /** Tree depth */
  readonly treeDepth: number;

  /** Build duration in milliseconds */
  readonly duration: number;

  /** Build timestamp */
  readonly timestamp: Date;

  /** Snapshot ID (if snapshot was created) */
  readonly snapshotId?: string;

  /** Snapshot version (if snapshot was created) */
  readonly snapshotVersion?: number;

  /** Tree type: flat (US-only) or global (multi-country) */
  readonly treeType: 'flat' | 'global';

  /** Country-level Merkle roots (ISO 3166-1 alpha-2 → root) */
  readonly countryRoots?: ReadonlyMap<string, bigint>;

  /** Continental-level Merkle roots (continent → root) */
  readonly continentalRoots?: ReadonlyMap<string, bigint>;

  /** Cross-validation execution status */
  readonly crossValidationStatus: CrossValidationStatus;

  /** Cross-validation results (when status is 'completed' or 'partial') */
  readonly crossValidationResults?: readonly CrossValidationSummary[];

  /** States that failed cross-validation gracefully */
  readonly crossValidationFailedStates?: readonly string[];

  /** School district validation results (when unsd/elsd/scsd layers are processed) */
  readonly schoolDistrictValidation?: readonly SchoolDistrictValidationSummary[];
}

/**
 * School district validation summary for Atlas build
 *
 * Summarizes validation of school district boundaries (unsd, elsd, scsd).
 * Checks for forbidden overlaps and coverage completeness.
 */
export interface SchoolDistrictValidationSummary {
  /** State FIPS code being validated */
  readonly state: string;

  /** Human-readable state name */
  readonly stateName: string;

  /** Counts by district type */
  readonly unsdCount: number;
  readonly elsdCount: number;
  readonly scsdCount: number;

  /** Expected counts from reference data */
  readonly expectedUnsd: number;
  readonly expectedElsd: number;
  readonly expectedScsd: number;

  /** Whether counts match expected */
  readonly countsMatch: boolean;

  /** Number of forbidden overlaps detected (unified vs elem/sec) */
  readonly forbiddenOverlaps: number;

  /** Coverage percentage (0-100) */
  readonly coveragePercent: number;

  /** Overall validation passed */
  readonly valid: boolean;

  /** Human-readable summary */
  readonly summary: string;
}

/**
 * Source manifest entry - attribution for each layer source
 */
export interface SourceManifest {
  /** Layer type */
  readonly layer: string;

  /** Download URL */
  readonly url: string;

  /** SHA-256 hash of downloaded data */
  readonly checksum: string;

  /** Download timestamp (ISO 8601) */
  readonly downloadedAt: string;

  /** TIGER data vintage/year */
  readonly vintage: number;

  /** Data format (e.g., "shapefile", "geojson") */
  readonly format: string;

  /** Number of features in raw source */
  readonly featureCount: number;
}

/**
 * Layer manifest entry - summary for each processed layer
 */
export interface LayerManifest {
  /** Layer type */
  readonly layer: string;

  /** Number of boundaries in layer */
  readonly boundaryCount: number;

  /** Expected boundary count (from validation) */
  readonly expectedCount: number;

  /** Quality score (0-100) */
  readonly qualityScore: number;

  /** Whether layer passed validation */
  readonly valid: boolean;

  /** Processing duration (ms) */
  readonly processingDuration: number;
}

/**
 * Validation manifest - overall validation summary
 */
export interface ValidationManifest {
  /** Total layers validated */
  readonly totalLayers: number;

  /** Layers that passed validation */
  readonly layersPassed: number;

  /** Layers that failed validation */
  readonly layersFailed: number;

  /** Average quality score across all layers */
  readonly averageQualityScore: number;

  /** Minimum quality threshold applied */
  readonly qualityThreshold: number;

  /** Overall validation status */
  readonly overallValid: boolean;
}

/**
 * Environment manifest - build environment metadata
 */
export interface EnvironmentManifest {
  /** Node.js version */
  readonly nodeVersion: string;

  /** Operating system platform */
  readonly platform: string;

  /** Operating system architecture */
  readonly arch: string;

  /** Hostname where build was executed */
  readonly hostname: string;

  /** Shadow Atlas package version */
  readonly packageVersion: string;
}

/**
 * Complete build manifest - comprehensive audit trail
 */
export interface BuildManifest {
  /** Unique build identifier */
  readonly buildId: string;

  /** Build timestamp (ISO 8601) */
  readonly timestamp: string;

  /** Merkle root commitment (0x-prefixed hex) */
  readonly merkleRoot: string;

  /** Layer-by-layer summaries */
  readonly layers: readonly LayerManifest[];

  /** Total boundaries across all layers */
  readonly totalBoundaries: number;

  /** Tree depth */
  readonly treeDepth: number;

  /** Source attribution for each layer */
  readonly sources: readonly SourceManifest[];

  /** Validation summary */
  readonly validation: ValidationManifest;

  /** Build environment metadata */
  readonly environment: EnvironmentManifest;

  /** Build duration (ms) */
  readonly duration: number;
}

// ============================================================================
// Change Detection Types for buildAtlas / checkForChanges
// ============================================================================

/**
 * Options for checkForChanges() method
 *
 * Configures which layers and states to check for upstream changes
 * before triggering a full rebuild.
 */
export interface CheckForChangesOptions {
  /** Layers to check for changes (defaults to all supported layers) */
  readonly layers?: readonly TIGERLayerType[];

  /** States to check (FIPS codes) or ['all'] for all states */
  readonly states?: readonly string[];

  /** Ignore cache and force fresh check via HTTP HEAD */
  readonly forceCheck?: boolean;

  /** TIGER vintage year (defaults to 2024) */
  readonly year?: number;
}

/**
 * Individual change report from upstream source check
 */
export interface ChangeReport {
  /** Unique identifier for this source (format: layer:state:vintage) */
  readonly sourceId: string;

  /** URL that was checked */
  readonly url: string;

  /** Previous checksum (ETag or Last-Modified), null if new */
  readonly oldChecksum: string | null;

  /** Current checksum (ETag or Last-Modified) */
  readonly newChecksum: string;

  /** When the change was detected (ISO 8601) */
  readonly detectedAt: string;

  /** What triggered this check */
  readonly trigger: 'scheduled' | 'manual' | 'forced';

  /** Type of change detected */
  readonly changeType: 'new' | 'modified' | 'deleted';
}

/**
 * Result from checkForChanges() method
 *
 * Contains structured information about which layers and states
 * have changed since the last successful build.
 */
export interface ChangeCheckResult {
  /** Whether any upstream sources have changed */
  readonly hasChanges: boolean;

  /** List of layer types that have changes (e.g., ['cd', 'sldu']) */
  readonly changedLayers: readonly string[];

  /** List of state FIPS codes with changes (e.g., ['01', '55']) */
  readonly changedStates: readonly string[];

  /** When this check was performed */
  readonly lastChecked: Date;

  /** Detailed reports for each changed source */
  readonly reports: readonly ChangeReport[];

  /** Total sources checked */
  readonly sourcesChecked: number;

  /** Duration of the check in milliseconds */
  readonly durationMs: number;
}

/**
 * Result from buildIfChanged() convenience method
 *
 * Either a full AtlasBuildResult if changes were detected and build succeeded,
 * or a SkippedBuildResult if no changes were detected.
 */
export type BuildIfChangedResult =
  | { readonly status: 'built'; readonly result: AtlasBuildResult }
  | { readonly status: 'skipped'; readonly reason: 'no_changes'; readonly lastChecked: Date }

// ============================================================================
// Proof Template Types for ZK Proof Generation
// ============================================================================

/**
 * Proof Template - Server-side Merkle proof without nullifier
 *
 * ZK proofs require `userSecret` for nullifier computation. Since we're
 * generating proofs server-side during build, we create proof templates
 * (Merkle proof without nullifier). Client completes with their secret.
 *
 * SECURITY: The proof template contains everything needed to verify
 * district membership EXCEPT the user-specific nullifier. This enables:
 * - Server pre-computation of expensive Merkle proofs
 * - Client-side nullifier computation with user secret
 * - Privacy preservation (server never sees user secret)
 *
 * @example Client-side completion:
 * ```typescript
 * const template = await getProofTemplate(snapshotId, districtId);
 * const nullifier = poseidon2(userSecret, template.districtId);
 * const fullProof = { ...template, nullifier };
 * ```
 */
export interface ProofTemplate {
  /** District identifier (GEOID for TIGER, custom for municipal) */
  readonly districtId: string;

  /** Merkle root commitment (bigint as hex string for serialization) */
  readonly merkleRoot: string;

  /** Sibling hashes for tree traversal (hex strings) */
  readonly siblings: readonly string[];

  /** Path indices (0 = left, 1 = right) */
  readonly pathIndices: readonly number[];

  /** Leaf hash for this district (hex string) */
  readonly leafHash: string;

  /** Boundary type (e.g., 'congressional-district', 'county') */
  readonly boundaryType: string;

  /** Authority level (1-5) */
  readonly authority: number;

  /** Leaf index in tree (for verification) */
  readonly leafIndex: number;
}

/**
 * Serialized proof templates for snapshot storage
 *
 * Maps district ID to its proof template.
 * Stored as JSON in snapshot metadata.
 */
export interface ProofTemplateStore {
  /** Merkle root for this snapshot (hex string) */
  readonly merkleRoot: string;

  /** Tree depth */
  readonly treeDepth: number;

  /** Total proof templates stored */
  readonly templateCount: number;

  /** Generated at timestamp (ISO 8601) */
  readonly generatedAt: string;

  /** Proof templates keyed by districtId */
  readonly templates: Readonly<Record<string, ProofTemplate>>;
}
