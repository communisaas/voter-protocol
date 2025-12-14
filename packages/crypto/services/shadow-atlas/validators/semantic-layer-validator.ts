/**
 * @deprecated Import from '../validation/semantic-validator.js' instead
 * This file is a backward-compatibility shim and will be removed in v2.0
 *
 * MIGRATION PATH:
 * - SemanticLayerValidator → SemanticValidator (renamed)
 * - LayerMatch interface → SemanticScore (renamed with additional fields)
 * - All methods preserved in new class
 */

// Re-export the new SemanticValidator class as SemanticLayerValidator
export { SemanticValidator as SemanticLayerValidator } from '../validation/semantic-validator.js';

// Re-export types (some renamed in new location)
export type {
  SemanticScore,
  CityNameMatch,
  CityNameAlias,
  GovernanceStructure,
} from '../validation/semantic-validator.js';

/**
 * Legacy LayerMatch interface for backward compatibility
 * Maps to SemanticScore in new location
 */
export interface LayerMatch {
  readonly layer: unknown; // Type not available in new validator
  readonly confidence: number;
  readonly reasons: readonly string[];
}
