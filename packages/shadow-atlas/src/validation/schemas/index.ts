/**
 * Shadow Atlas Schema Exports
 *
 * Central export point for all schema types and utilities.
 */

// Core types
export type {
  GovernanceDistrict,
  ShadowAtlasMetadata,
  ShadowAtlasDataset,
  ValidationError,
} from './governance-district.js';

// Enumerations
export {
  DistrictType,
  GovernanceLevel,
  QualityTier,
  GeometryType,
} from './governance-district.js';

// Validation functions
export {
  isDistrictType,
  isGovernanceLevel,
  isQualityTier,
  isGeometryType,
  isGovernanceDistrict,
  isShadowAtlasDataset,
  validateGovernanceDistrict,
} from './governance-district.js';

// Re-export everything for convenience
export * from './governance-district.js';
