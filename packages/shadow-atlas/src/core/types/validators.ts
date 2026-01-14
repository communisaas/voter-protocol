/**
 * Validator Types - Core Type Definitions
 *
 * These types are used by both core modules and validators.
 * Extracted here to break circular dependencies between core/types and validators/.
 *
 * ARCHITECTURE:
 * - Types defined here are the canonical source for cross-validation types
 * - validators/ modules re-export these types for backward compatibility
 * - core/ modules import directly from this file
 *
 * IMPORTANT: This file MUST NOT import from atlas.ts to avoid circular dependencies.
 * atlas.ts -> errors.ts -> validators.ts would create a cycle if we import from atlas.ts.
 *
 * Types like CompletenessResult, TopologyResult, CoordinateResult are defined
 * both here and in atlas.ts. atlas.ts is the canonical source, but we duplicate
 * the definitions here to break the circular dependency.
 */

// ============================================================================
// TIGER Layer Type (duplicated to avoid circular import from atlas.ts)
// ============================================================================

/**
 * TIGER Layer Types - duplicated here to break circular dependency
 * Canonical definition is in atlas.ts
 */
export type TIGERLayerType =
  | 'cd' | 'sldu' | 'sldl'
  | 'county' | 'cousub' | 'submcd'
  | 'place' | 'cdp' | 'concity'
  | 'unsd' | 'elsd' | 'scsd'
  | 'vtd'
  | 'aiannh' | 'anrc' | 'tbg' | 'ttract'
  | 'cbsa' | 'csa' | 'metdiv' | 'uac' | 'necta' | 'cnecta' | 'nectadiv'
  | 'zcta' | 'tract' | 'bg' | 'puma'
  | 'estate'
  | 'mil';

// ============================================================================
// Validation Result Types (duplicated to avoid circular import from atlas.ts)
// ============================================================================

/**
 * Completeness validation result
 */
export interface CompletenessResult {
  /** Whether all expected boundaries are present */
  readonly valid: boolean;

  /** Expected count from reference data */
  readonly expected: number;

  /** Actual count from downloaded data */
  readonly actual: number;

  /** Completeness percentage (0-100) */
  readonly percentage: number;

  /** Missing GEOIDs (expected but not found) */
  readonly missingGEOIDs: readonly string[];

  /** Extra GEOIDs (found but not expected - may indicate duplicates) */
  readonly extraGEOIDs: readonly string[];

  /** Human-readable summary */
  readonly summary: string;
}

/**
 * Topology validation result
 */
export interface TopologyResult {
  /** Whether topology is valid */
  readonly valid: boolean;

  /** Number of self-intersecting geometries */
  readonly selfIntersections: number;

  /** Overlapping boundary pairs */
  readonly overlaps: readonly {
    readonly geoid1: string;
    readonly geoid2: string;
    readonly overlapArea: number;
  }[];

  /** Number of gaps detected */
  readonly gaps: number;

  /** GEOIDs with invalid geometries */
  readonly invalidGeometries: readonly string[];

  /** Human-readable summary */
  readonly summary: string;
}

/**
 * Coordinate validation result
 */
export interface CoordinateResult {
  /** Whether all coordinates are valid */
  readonly valid: boolean;

  /** Count of coordinates outside valid WGS84 ranges */
  readonly outOfRangeCount: number;

  /** GEOIDs with null or NaN coordinates */
  readonly nullCoordinates: readonly string[];

  /** Suspicious locations (e.g., points in ocean for US data) */
  readonly suspiciousLocations: readonly {
    readonly geoid: string;
    readonly reason: string;
    readonly centroid: { readonly lat: number; readonly lon: number };
  }[];

  /** Human-readable summary */
  readonly summary: string;
}

// ============================================================================
// Validation Issue Types
// ============================================================================

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

// ============================================================================
// Geometry Mismatch Types
// ============================================================================

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

// ============================================================================
// Cross-Validation Result Types
// ============================================================================

/**
 * Cross-validation result (TIGER vs State GIS portals)
 *
 * Used by core/errors.ts BuildValidationError and validators/cross/tiger-vs-state.ts
 */
export interface CrossValidationResult {
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

// ============================================================================
// TIGER Validation Result Types (used by atlas.ts LayerValidationResult)
// ============================================================================

/**
 * Redistricting gap status from gap detector
 */
export interface GapStatus {
  /** Whether we are in a redistricting gap period */
  readonly inGap: boolean;

  /** Reasoning for the gap determination */
  readonly reasoning: string;

  /** Recommended action */
  readonly recommendation: 'use-tiger' | 'use-primary' | 'wait' | 'manual-review';
}

/**
 * Redistricting gap warning for legislative layers
 *
 * During redistricting periods (Jan-Jun of years ending in 2, e.g., 2022, 2032),
 * TIGER data may be stale for legislative boundaries. This warning alerts
 * consumers to potential data freshness issues without failing validation.
 */
export interface RedistrictingGapWarning {
  /** Warning message describing the gap situation */
  readonly message: string;

  /** Gap status from the detector */
  readonly gapStatus: GapStatus;

  /** Recommended action */
  readonly recommendation: string;
}

/**
 * Single layer validation result from TIGERValidator
 *
 * This is the full validation result for a single TIGER layer.
 * Used by atlas.ts LayerValidationResult.
 *
 * NOTE: This is different from TIGERValidationResult in atlas.ts which is
 * an aggregate result across multiple layers.
 */
export interface ValidationResult {
  /** Layer being validated */
  readonly layer: TIGERLayerType;

  /** State FIPS (null for national data) */
  readonly stateFips: string | null;

  /** Overall quality score (0-100) */
  readonly qualityScore: number;

  /** Individual validation results */
  readonly completeness: CompletenessResult;
  readonly topology: TopologyResult;
  readonly coordinates: CoordinateResult;

  /** Timestamp of validation */
  readonly validatedAt: Date;

  /** Human-readable summary */
  readonly summary: string;

  /**
   * Non-blocking warnings (e.g., redistricting gap detection)
   *
   * Warnings indicate potential issues but do not fail validation.
   * Consumers should review warnings and take appropriate action.
   */
  readonly warnings?: readonly string[];

  /**
   * Redistricting gap warning for legislative layers (cd, sldu, sldl)
   *
   * Present when validation detects a redistricting gap period where
   * TIGER data may be stale. Does NOT fail validation - informational only.
   */
  readonly redistrictingGapWarning?: RedistrictingGapWarning;
}
