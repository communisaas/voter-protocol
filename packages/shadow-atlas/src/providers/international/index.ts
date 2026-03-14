/**
 * International Boundary Providers
 *
 * Central export point for all international boundary providers.
 * Import from this file to access base classes, country providers, and types.
 *
 * USAGE:
 * ```typescript
 * import { UKBoundaryProvider, CanadaBoundaryProvider, AustraliaBoundaryProvider } from './providers/international';
 * import type { InternationalBoundaryProvider, LayerExtractionResult } from './providers/international';
 * ```
 *
 * @see GLOBAL_SCALING_SPEC.md for expansion roadmap
 */

// ============================================================================
// Base Provider (Abstract Classes and Interfaces)
// ============================================================================

export {
  // Base provider class
  BaseInternationalProvider,

  // Provider interface
  type InternationalBoundaryProvider,

  // Configuration types
  type LayerConfig,
  type ProviderConfig,

  // Boundary types
  type InternationalBoundary,
  type BoundarySource,

  // Extraction result types
  type InternationalExtractionResult,
  type LayerExtractionResult,

  // Health monitoring types
  type ProviderHealth,

  // Batch extraction types
  type BatchExtractionOptions,
  type ExtractionProgress,

  // Data source types
  type DataSourceType,
  type UpdateSchedule,
  type AuthorityLevel,
} from './base-provider.js';

// ============================================================================
// Unified Country Provider (extends BaseInternationalProvider)
// ============================================================================

export { CountryProvider } from './country-provider.js';

export {
  // Source chain
  type SourceConfig,
  type SourceAttempt,

  // Officials
  type OfficialRecord,
  type OfficialsExtractionResult,

  // Cell map (Tree 2)
  type StatisticalUnitType,
  type CellMapResult,
  type CellDistrictMapping,

  // Validation pipeline
  type ValidationReport,
  type SourceAssessment,
  type SchemaError,
  type OfficialDiagnostic,
  type OfficialDiagnosticType,
  type PIPDiagnostic,
  type PIPDiagnosticType,
  type ChamberCount,
  type GeocoderFn,
  type PIPCheckFn,

  // Expected counts
  EXPECTED_OFFICIAL_COUNTS,

  // Zod schemas
  BaseOfficialSchema,
  USFederalMemberSchema,
  CanadianMPSchema,
  UKMPSchema,
  AustralianMPSchema,
  NZMPSchema,
} from './country-provider-types.js';

// ============================================================================
// Country-Specific Providers (Phase 1: Anglosphere)
// ============================================================================

export {
  // United Kingdom
  UKCountryProvider,
  UKBoundaryProvider,
  type UKOfficial,
  type UKConstituency,
  type UKLayerType,
  type UKCountry,
  type UKExtractionResult,
} from './uk-provider.js';

export {
  // Canada
  CanadaCountryProvider,
  CanadaBoundaryProvider,
  type CAOfficial,
  type CanadaRiding,
  type CanadaLayerType,
  type CanadaProvince,
  type CanadaExtractionResult,
  type ResolvedDistrict,
} from './canada-provider.js';

export {
  // Australia
  AustraliaCountryProvider,
  AustraliaBoundaryProvider,
  type AUOfficial,
  type AustraliaDivision,
  type AustraliaLayerType,
  type AustraliaState,
  type AustraliaExtractionResult,
} from './australia-provider.js';

export {
  // New Zealand
  NZCountryProvider,
  NewZealandBoundaryProvider,
  type NZOfficial,
  type NZElectorate,
  type NZLayerType,
  type NZRegion,
  type NZExtractionResult,
} from './nz-provider.js';

// ============================================================================
// EU Template (Phase 2: European Union)
// ============================================================================

export {
  // EU template provider
  EUTemplateProvider,
  GermanyBoundaryProvider,

  // EU-specific types
  type EUConstituency,
  type EUCountryCode,
  type ElectoralSystemType,
  type EUDataSourceConfig,

  // EU data source registry
  EU_DATA_SOURCES,
} from './eu-template-provider.js';

// ============================================================================
// Common Types (Re-exports for Convenience)
// ============================================================================

export type {
  // GeoJSON types (from geojson package)
  Polygon,
  MultiPolygon,
  FeatureCollection,
} from 'geojson';
