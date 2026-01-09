/**
 * Shadow Atlas Validators
 *
 * Consolidated validation modules for geographic, semantic, and deterministic validation.
 */

// Core validators
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
} from './tiger-validator.js';

// Validation error types (for halt gates)
export {
  ValidationHaltError,
  isValidationHaltError,
  type ValidationHaltStage,
  type ValidationHaltDetails,
} from '../core/types/errors.js';
export { GovernanceValidator } from './governance-validator.js';
export { validateDistrictCount, type DistrictCountValidation } from './district-count-validator.js';
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
} from './school-district-validator.js';

// Geographic validation
export {
  GeographicValidator,
  type Point,
  type CityInfo,
  type BoundsResult,
  type CountResult,
  type TopologyResult,
  type CombinedValidationResult,
} from './geographic-validator.js';

export {
  GeographicBoundsValidator,
  type CityTarget as BoundsCityTarget,
} from './geographic-bounds-validator.js';

// Semantic validation
export {
  SemanticValidator,
  type SemanticScore,
  type CityNameMatch,
  type CityNameAlias,
  type GovernanceStructure,
} from './semantic-validator.js';

// Pipeline
export {
  DeterministicValidationPipeline,
  NamePatternValidator,
  DistrictCountValidator as PipelineDistrictCountValidator,
  type ValidationResult,
  type CityTarget as PipelineCityTarget,
  type AggregatedValidationResult,
} from './deterministic-validators.js';

// Cross-validation (TIGER vs State)
export {
  CrossValidator,
  type CrossValidationConfig,
  type CrossValidationResult,
  type GeometryMismatch,
  type BoundaryProvider,
  type StateExtractor,
} from './cross-validator.js';

// Geometry comparison utilities
export {
  geometriesMatch,
  calculateArea,
  calculateCentroid,
  calculateCentroidDistance,
  type GeometryMatchResult,
} from './geometry-compare.js';

// Data
export { EXPECTED_COUNTS as TIGER_EXPECTED_COUNTS } from './tiger-expected-counts.js';

// GEOID Reference Lists
export {
  getCanonicalGEOIDs,
  getMissingGEOIDs,
  getExtraGEOIDs,
  validateGEOIDCompleteness,
  CANONICAL_CD_GEOIDS,
} from './geoid-reference.js';

// Place GEOIDs (separated due to size - 32,000+ entries)
export {
  CANONICAL_PLACE_GEOIDS,
  EXPECTED_PLACE_BY_STATE,
  NATIONAL_PLACE_TOTAL,
  getPlaceGEOIDs,
  getExpectedPlaceCount,
} from './place-geoids.js';

// TIGER Canonical Cross-Validation (TIGER vs canonical GEOIDs)
export {
  TIGERCanonicalValidator,
  createTIGERCanonicalValidator,
  formatCrossValidationReport,
  type CanonicalCrossValidationResult,
  type CanonicalCrossValidationReport,
  type ValidatableLayerReport,
  type TIGERCanonicalValidatorOptions,
} from './tiger-canonical-validator.js';

// GEOID Validation Suite & Comprehensive Reporting
export {
  // Core validation
  validateAllCanonicalGEOIDs,
  validateLayer,
  validateGEOIDFormat,
  validateCanonicalCoverage,
  validateExpectedCounts,
  generateValidationReport,
  // Comprehensive reporting (Task 4.1)
  generateComprehensiveReport,
  generateComprehensiveReportText,
  // Types
  type ValidatableLayer,
  type ValidationReport,
  type LayerValidation,
  type StateLayerValidation,
  type ComprehensiveValidationReport,
  type ComprehensiveReportOptions,
  type VTDCoverageGap,
  GEOID_FORMATS,
} from './geoid-validation-suite.js';
