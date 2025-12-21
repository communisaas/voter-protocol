/**
 * Shadow Atlas Validators
 *
 * Consolidated validation modules for geographic, semantic, and deterministic validation.
 */

// Core validators
export { TIGERValidator } from './tiger-validator.js';
export { GovernanceValidator } from './governance-validator.js';
export { validateDistrictCount, type DistrictCountValidation } from './district-count-validator.js';

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

// Data
export { EXPECTED_COUNTS as TIGER_EXPECTED_COUNTS } from './tiger-expected-counts.js';
