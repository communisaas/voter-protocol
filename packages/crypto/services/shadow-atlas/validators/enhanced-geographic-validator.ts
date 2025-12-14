/**
 * @deprecated Import from '../validation/geographic-validator.js' instead
 * This file is a backward-compatibility shim and will be removed in v2.0
 *
 * MIGRATION PATH:
 * - EnhancedGeographicValidator → GeographicValidator (renamed)
 * - GeographicValidationResult → BoundsResult (renamed)
 * - All validation methods preserved
 */

// Re-export the new GeographicValidator class as EnhancedGeographicValidator
export { GeographicValidator as EnhancedGeographicValidator } from '../validation/geographic-validator.js';

// Re-export types with correct naming
export type {
  Point,
  CityInfo,
  BoundsResult,
  CountResult,
  TopologyResult,
  CombinedValidationResult,
} from '../validation/geographic-validator.js';

/**
 * Legacy GeographicValidationResult interface for backward compatibility
 * Maps to BoundsResult in new location
 */
export interface GeographicValidationResult {
  readonly valid: boolean;
  readonly confidence: number;
  readonly reason?: string;
  readonly centroid?: { readonly lat: number; readonly lon: number };
  readonly detectedState?: string | null;
}

/**
 * BREAKING CHANGE: The following functions from the old file are no longer exported:
 * - calculateCentroid() - now a private method in GeographicValidator class
 * - getStateFromCoordinates() - now a private method in GeographicValidator class
 * - validateCityBoundary() - functionality merged into GeographicValidator.validateBounds()
 *
 * Migration: Use GeographicValidator.validateBounds() instead, which provides
 * the same functionality with improved multi-county support.
 *
 * Legacy tests should use the new API directly on the validator instance.
 */
