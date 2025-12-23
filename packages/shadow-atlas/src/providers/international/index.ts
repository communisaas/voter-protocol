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
// Country-Specific Providers (Phase 1: Anglosphere)
// ============================================================================

export {
  // United Kingdom
  UKBoundaryProvider,
  type UKConstituency,
  type UKLayerType,
  type UKCountry,
  type UKExtractionResult,
} from './uk-provider.js';

export {
  // Canada
  CanadaBoundaryProvider,
  type CanadaRiding,
  type CanadaLayerType,
  type CanadaProvince,
  type CanadaExtractionResult,
  type ResolvedDistrict,
} from './canada-provider.js';

export {
  // Australia
  AustraliaBoundaryProvider,
  type AustraliaDivision,
  type AustraliaLayerType,
  type AustraliaState,
  type AustraliaExtractionResult,
} from './australia-provider.js';

export {
  // New Zealand
  NewZealandBoundaryProvider,
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
