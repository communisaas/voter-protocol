/**
 * CityWardValidator Type Definitions
 *
 * Type system for validating extracted city ward data from statewide extractions.
 * Consolidates validation logic from validate-statewide-extraction.ts script.
 *
 * TYPE SAFETY: Nuclear-level strictness. Zero `any`, zero `@ts-ignore`.
 * Every validation result must be comprehensively typed for audit trail.
 */

import type { FeatureCollection, Polygon, MultiPolygon, Feature } from 'geojson';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * City ward validation options
 */
export interface CityWardValidationOptions {
  /** Include GeoJSON geometry validation */
  readonly includeGeometry?: boolean;

  /** Include ward identifier uniqueness checks */
  readonly includeWardIdentifiers?: boolean;

  /** Include FIPS code format validation */
  readonly includeFipsValidation?: boolean;

  /** Minimum acceptable ward count (default: 3) */
  readonly minWardCount?: number;

  /** Maximum acceptable ward count (default: 50) */
  readonly maxWardCount?: number;

  /** Allow warnings without failing validation */
  readonly allowWarnings?: boolean;
}

/**
 * Extraction summary metadata
 */
export interface ExtractionSummary {
  /** Extraction timestamp */
  readonly extractedAt: string;

  /** Number of cities found during extraction */
  readonly citiesFound: number;

  /** Number of cities expected based on registry */
  readonly expectedCities: number;

  /** State code */
  readonly state: string;

  /** Additional metadata */
  readonly [key: string]: unknown;
}

/**
 * Registry entry for a city
 */
export interface CityRegistryEntry {
  /** 7-digit Census PLACE code */
  readonly cityFips: string;

  /** City name */
  readonly cityName: string;

  /** State code */
  readonly state: string;

  /** Expected ward count (if known) */
  readonly expectedWards?: number;

  /** Additional metadata */
  readonly [key: string]: unknown;
}

// ============================================================================
// Validation Result Types
// ============================================================================

/**
 * City ward validation result for a single state
 */
export interface CityWardValidationResult {
  /** State code */
  readonly state: string;

  /** Total cities validated */
  readonly cityCount: number;

  /** Overall validation status */
  readonly passed: boolean;

  /** Validation errors (critical issues) */
  readonly errors: readonly CityWardError[];

  /** Validation warnings (non-critical issues) */
  readonly warnings: readonly CityWardWarning[];

  /** Validation timestamp */
  readonly validatedAt: Date;

  /** Extraction summary (if available) */
  readonly extractionSummary?: ExtractionSummary;

  /** Registry entries (if available) */
  readonly registryEntries?: readonly CityRegistryEntry[];
}

/**
 * City ward validation error (critical issue)
 */
export interface CityWardError {
  /** City name */
  readonly city: string;

  /** 7-digit Census PLACE code */
  readonly fips: string;

  /** Error message */
  readonly message: string;

  /** Severity level */
  readonly severity: 'error';

  /** Error code for programmatic handling */
  readonly code?: CityWardErrorCode;
}

/**
 * City ward validation warning (non-critical issue)
 */
export interface CityWardWarning {
  /** City name */
  readonly city: string;

  /** 7-digit Census PLACE code */
  readonly fips: string;

  /** Warning message */
  readonly message: string;

  /** Severity level */
  readonly severity: 'warning';

  /** Warning code for programmatic handling */
  readonly code?: CityWardWarningCode;
}

/**
 * Error codes for programmatic handling
 */
export type CityWardErrorCode =
  | 'INVALID_FIPS'
  | 'DUPLICATE_FIPS'
  | 'MISSING_GEOJSON'
  | 'INVALID_GEOJSON'
  | 'INVALID_GEOMETRY'
  | 'NO_FEATURES'
  | 'DIRECTORY_NOT_FOUND';

/**
 * Warning codes for programmatic handling
 */
export type CityWardWarningCode =
  | 'UNUSUAL_WARD_COUNT'
  | 'DUPLICATE_WARD_ID'
  | 'MISSING_EXTRACTION_SUMMARY'
  | 'MISSING_REGISTRY_ENTRIES'
  | 'LOW_CITY_COUNT';

/**
 * FIPS validation result
 */
export interface FipsValidationResult {
  /** FIPS code being validated */
  readonly fips: string;

  /** Validation status */
  readonly valid: boolean;

  /** Error message (if invalid) */
  readonly error?: string;
}

/**
 * Ward count validation result
 */
export interface WardCountValidationResult {
  /** Ward count */
  readonly count: number;

  /** Validation status */
  readonly valid: boolean;

  /** Whether count is within reasonable range */
  readonly reasonable: boolean;

  /** Expected range */
  readonly expectedRange: {
    readonly min: number;
    readonly max: number;
  };
}

/**
 * Geometry validation result for GeoJSON
 */
export interface GeometryValidationResult {
  /** Validation status */
  readonly valid: boolean;

  /** Number of features */
  readonly featureCount: number;

  /** Error message (if invalid) */
  readonly error?: string;

  /** Geometry issues found */
  readonly issues: readonly GeometryIssue[];
}

/**
 * Geometry issue
 */
export interface GeometryIssue {
  /** Feature index */
  readonly featureIndex: number;

  /** Issue type */
  readonly type: 'missing-geometry' | 'invalid-type' | 'empty-coordinates' | 'unclosed-ring';

  /** Description */
  readonly description: string;
}

/**
 * Ward identifier validation result
 */
export interface WardIdentifierValidationResult {
  /** Validation status */
  readonly valid: boolean;

  /** Total ward identifiers */
  readonly totalWards: number;

  /** Unique ward identifiers */
  readonly uniqueWards: number;

  /** Duplicate ward identifiers */
  readonly duplicates: readonly string[];
}

/**
 * Single city validation result
 */
export interface SingleCityValidationResult {
  /** City name */
  readonly cityName: string;

  /** 7-digit Census PLACE code */
  readonly fips: string;

  /** Validation passed */
  readonly passed: boolean;

  /** Ward count */
  readonly wardCount: number;

  /** FIPS validation */
  readonly fipsValidation: FipsValidationResult;

  /** Ward count validation */
  readonly wardCountValidation: WardCountValidationResult;

  /** Geometry validation */
  readonly geometryValidation?: GeometryValidationResult;

  /** Ward identifier validation */
  readonly wardIdentifierValidation?: WardIdentifierValidationResult;

  /** Errors for this city */
  readonly errors: readonly CityWardError[];

  /** Warnings for this city */
  readonly warnings: readonly CityWardWarning[];
}

// ============================================================================
// Internal Types
// ============================================================================

/**
 * Ward GeoJSON feature properties
 */
export interface WardFeatureProperties {
  /** Normalized ward identifier */
  readonly WARD_NORMALIZED?: string | number;

  /** Original ward identifier */
  readonly WARD?: string | number;

  /** Additional properties */
  readonly [key: string]: unknown;
}

/**
 * Ward GeoJSON feature
 */
export interface WardFeature extends Feature<Polygon | MultiPolygon> {
  readonly properties: WardFeatureProperties;
}

/**
 * Ward GeoJSON feature collection
 */
export interface WardFeatureCollection extends FeatureCollection<Polygon | MultiPolygon> {
  readonly features: WardFeature[];
}

/**
 * State directory structure
 */
export interface StateDirectoryStructure {
  /** State directory path */
  readonly stateDir: string;

  /** Cities directory path */
  readonly citiesDir: string;

  /** Extraction summary path */
  readonly summaryPath: string;

  /** Registry entries path */
  readonly registryPath: string;

  /** Whether directories exist */
  readonly exists: boolean;
}
