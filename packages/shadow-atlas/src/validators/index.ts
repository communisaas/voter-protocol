/**
 * Shadow Atlas Validators
 *
 * Consolidated validation modules for geographic, semantic, and deterministic validation.
 *
 * WAVE 2: Reorganized into domain-specific subdirectories (2026-01-10)
 * - tiger/     → TIGER boundary validation
 * - topology/  → Overlap/gap detection
 * - council/   → Council district validation
 * - geoid/     → GEOID validation suite
 * - geographic/ → Geographic bounds validation
 * - semantic/  → Semantic validation
 * - pipeline/  → Deterministic pipeline
 * - cross/     → Cross-source comparison
 * - utils/     → Shared utilities
 */

// ============================================================================
// TIGER Validators (tiger/)
// ============================================================================
export {
  TIGERValidator,
  DEFAULT_HALT_OPTIONS,
  type RedistrictingGapWarning,
  type ValidationResult as TIGERValidationResult,
  type CompletenessResult,
  type CoordinateResult,
  type CrossValidationResult as TIGERCrossValidationResult,
  type TIGERValidationBoundary,
  type ValidationHaltOptions,
} from './tiger/validator.js';

export {
  TIGERCanonicalValidator,
  createTIGERCanonicalValidator,
  formatCrossValidationReport,
  type CanonicalCrossValidationResult,
  type CanonicalCrossValidationReport,
  type ValidatableLayerReport,
  type TIGERCanonicalValidatorOptions,
} from './tiger/canonical-validator.js';

export {
  SchoolDistrictValidator,
  DUAL_SYSTEM_STATES,
  isDualSystemState,
  DEFAULT_SCHOOL_HALT_OPTIONS,
  type SchoolDistrictType,
  type SchoolDistrictValidationResult,
  type SchoolDistrictHaltOptions,
  type ValidationIssue,
  type OverlapIssue,
  type CoverageResult,
  type GapRegion,
  type DistrictSystemConfig,
} from './tiger/school-district.js';

// Validation error types (for halt gates)
export {
  ValidationHaltError,
  isValidationHaltError,
  type ValidationHaltStage,
  type ValidationHaltDetails,
} from '../core/types/errors.js';

// ============================================================================
// Topology Validators (topology/)
// ============================================================================
export {
  detectOverlaps,
  detectGaps,
  detectSelfIntersections,
  validateLayerTopology,
} from './topology/detector.js';

export {
  getTopologyRules,
  NEW_ENGLAND_FIPS,
  USVI_FIPS,
  EXPECTED_ESTATE_COUNT,
  type TopologyOverlap,
  type GapAnalysis,
  type SelfIntersection,
  type TopologyValidationResult,
  type TIGERLayerType as TopologyLayerType,
} from './topology/rules.js';

// ============================================================================
// Council District Validators (council/)
// ============================================================================
export { CouncilDistrictValidator } from './council/validator.js';
export { EdgeCaseAnalyzer, type EdgeCaseAnalysis, type EdgeCaseType } from './council/edge-cases.js';
export { resolveFips, batchResolveFips, type FipsResolutionResult } from './council/fips-resolver.js';

// ============================================================================
// GEOID Validators (geoid/)
// ============================================================================
export {
  getCanonicalGEOIDs,
  getMissingGEOIDs,
  getExtraGEOIDs,
  validateGEOIDCompleteness,
  CANONICAL_CD_GEOIDS,
  CANONICAL_SLDU_GEOIDS,
  CANONICAL_SLDL_GEOIDS,
  CANONICAL_UNSD_GEOIDS,
  CANONICAL_ELSD_GEOIDS,
  CANONICAL_SCSD_GEOIDS,
} from './geoid/reference.js';

export {
  validateAllCanonicalGEOIDs,
  validateLayer,
  validateGEOIDFormat,
  validateCanonicalCoverage,
  validateExpectedCounts,
  generateValidationReport,
  generateComprehensiveReport,
  generateComprehensiveReportText,
  type ValidatableLayer,
  type ValidationReport,
  type LayerValidation,
  type StateLayerValidation,
  type ComprehensiveValidationReport,
  type ComprehensiveReportOptions,
  type VTDCoverageGap,
  GEOID_FORMATS,
} from './geoid/validation-suite.js';

// ============================================================================
// Geographic Validators (geographic/)
// ============================================================================
export {
  GeographicValidator,
  type Point,
  type CityInfo,
  type BoundsResult,
  type CountResult,
  type TopologyResult,
  type CombinedValidationResult,
} from './geographic/validator.js';

export {
  GeographicBoundsValidator,
  type CityTarget as BoundsCityTarget,
} from './geographic/bounds-validator.js';

// ============================================================================
// Semantic Validators (semantic/)
// ============================================================================
export {
  SemanticValidator,
  type SemanticScore,
  type CityNameMatch,
  type CityNameAlias,
  type GovernanceStructure,
} from './semantic/validator.js';

export { GovernanceValidator } from './semantic/governance.js';

// ============================================================================
// Pipeline Validators (pipeline/)
// ============================================================================
export {
  DeterministicValidationPipeline,
  NamePatternValidator,
  DistrictCountValidator as PipelineDistrictCountValidator,
  type ValidationResult,
  type CityTarget as PipelineCityTarget,
  type AggregatedValidationResult,
} from './pipeline/deterministic.js';

export { validateDistrictCount, type DistrictCountValidation } from './pipeline/district-count.js';

// ============================================================================
// Cross-Validation (cross/)
// ============================================================================
export {
  CrossValidator,
  type CrossValidationConfig,
  type CrossValidationResult,
  type GeometryMismatch,
  type BoundaryProvider,
  type StateExtractor,
} from './cross/tiger-vs-state.js';

// ============================================================================
// Utilities (utils/)
// ============================================================================
export {
  geometriesMatch,
  calculateArea,
  calculateCentroid,
  calculateCentroidDistance,
  type GeometryMatchResult,
} from './utils/geometry-compare.js';

export {
  loadVTDGEOIDs,
  getVTDCount,
  hasVTDData,
  getVTDMetadata,
  getStatesWithVTDData,
  getNationalVTDTotal,
} from './utils/vtd-loader.js';

export {
  attributeCity,
  batchAttributeCities,
  ATTRIBUTION_STATS,
  type CityAttribution,
} from './utils/city-attribution.js';

// ============================================================================
// Data (legacy - will be deprecated, use data/loaders instead)
// ============================================================================
export { EXPECTED_COUNTS as TIGER_EXPECTED_COUNTS } from './tiger-expected-counts.js';

// Place GEOIDs (separated due to size - 32,000+ entries)
export {
  CANONICAL_PLACE_GEOIDS,
  EXPECTED_PLACE_BY_STATE,
  NATIONAL_PLACE_TOTAL,
  getPlaceGEOIDs,
  getExpectedPlaceCount,
} from './place-geoids.js';
