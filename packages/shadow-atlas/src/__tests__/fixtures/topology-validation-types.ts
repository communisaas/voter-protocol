/**
 * Topology Validation Type Definitions
 *
 * These types define the contract between test fixtures and the topology validator service.
 * NO implementation logic - pure type definitions for type-safe validation.
 */

import type { Feature, Polygon } from 'geojson';

/**
 * Layer types with different topology requirements
 */
export type TilingLayerType = 'VTD' | 'COUSUB'; // Must perfectly tile parent
export type NonTilingLayerType = 'PLACE' | 'CDP' | 'ZCTA'; // Can overlap
export type LayerType = TilingLayerType | NonTilingLayerType;

/**
 * Configuration for topology validation
 */
export interface TopologyValidationConfig {
  /** Parent geographic feature (e.g., COUNTY) */
  readonly parent: Feature<Polygon>;

  /** Child features that should tile/cover the parent */
  readonly children: readonly Feature<Polygon>[];

  /** Type of geographic layer being validated */
  readonly layerType: LayerType;

  /**
   * Tolerance threshold as percentage (e.g., 0.001 = 0.001%)
   * Gaps/overlaps below this threshold are considered acceptable
   * Default: 0.001 (allows floating-point precision errors)
   */
  readonly tolerance: number;

  /**
   * Whether overlaps are permitted for this layer type
   * Automatically determined from layerType if not specified
   * - VTD, COUSUB: false (must tile perfectly)
   * - PLACE, CDP, ZCTA: true (can overlap)
   */
  readonly allowOverlaps?: boolean;
}

/**
 * Result of topology validation
 */
export interface TopologyValidationResult {
  /** Whether validation passed (all metrics within tolerance) */
  readonly valid: boolean;

  /** Percentage of parent area NOT covered by children (gap) */
  readonly gapPercentage: number;

  /** Percentage of parent area covered by multiple children (overlap) */
  readonly overlapPercentage: number;

  /** Percentage of parent area covered by children (including overlaps) */
  readonly totalCoverage: number;

  /** Absolute area of parent feature (square meters if using WGS84) */
  readonly parentArea: number;

  /** Absolute area of union of all children (square meters) */
  readonly childrenUnionArea: number;

  /** Absolute area of overlaps between children (square meters) */
  readonly overlapArea: number;

  /** Absolute area of gaps (parent not covered) (square meters) */
  readonly gapArea: number;

  /** Human-readable error messages (empty if valid) */
  readonly errors: readonly string[];

  /** Warnings for non-critical issues */
  readonly warnings: readonly string[];

  /** Metadata about validation process */
  readonly metadata: {
    /** Number of child features validated */
    readonly childCount: number;

    /** Layer type validated */
    readonly layerType: LayerType;

    /** Tolerance threshold used */
    readonly tolerance: number;

    /** Whether overlaps were permitted */
    readonly allowOverlaps: boolean;

    /** Validation timestamp */
    readonly timestamp: number;
  };
}

/**
 * Detailed overlap information between two features
 */
export interface OverlapDetails {
  /** First feature GEOID */
  readonly featureA: string;

  /** Second feature GEOID */
  readonly featureB: string;

  /** Area of intersection (square meters) */
  readonly intersectionArea: number;

  /** Percentage of parent covered by this overlap */
  readonly overlapPercentage: number;

  /** GeoJSON geometry of overlap region (for debugging) */
  readonly intersectionGeometry?: Polygon;
}

/**
 * Detailed gap information
 */
export interface GapDetails {
  /** Area of gap (square meters) */
  readonly gapArea: number;

  /** Percentage of parent area */
  readonly gapPercentage: number;

  /** GeoJSON geometry of gap region (for debugging) */
  readonly gapGeometry?: Polygon;
}

/**
 * Extended validation result with detailed diagnostics
 */
export interface DetailedTopologyValidationResult extends TopologyValidationResult {
  /** Detailed information about each overlap (for tiling layers) */
  readonly overlaps: readonly OverlapDetails[];

  /** Detailed information about gaps */
  readonly gaps: readonly GapDetails[];

  /** Features that failed individual validation */
  readonly invalidFeatures: readonly {
    readonly geoid: string;
    readonly reason: string;
  }[];
}

/**
 * Topology validator interface
 */
export interface TopologyValidator {
  /**
   * Validate that children properly tile/cover parent feature
   * @param config Validation configuration
   * @returns Validation result
   */
  validate(config: TopologyValidationConfig): TopologyValidationResult;

  /**
   * Validate with detailed diagnostics
   * @param config Validation configuration
   * @returns Detailed validation result with overlap/gap geometries
   */
  validateDetailed(config: TopologyValidationConfig): DetailedTopologyValidationResult;

  /**
   * Validate only for overlaps (faster than full validation)
   * @param children Child features to check for overlaps
   * @returns Overlap details
   */
  validateOverlaps(children: readonly Feature<Polygon>[]): readonly OverlapDetails[];

  /**
   * Validate only for gaps (faster than full validation)
   * @param parent Parent feature
   * @param children Child features
   * @returns Gap details
   */
  validateGaps(
    parent: Feature<Polygon>,
    children: readonly Feature<Polygon>[]
  ): readonly GapDetails[];
}

/**
 * Type guard: Check if layer type requires perfect tiling
 */
export function isTilingLayer(layerType: LayerType): layerType is TilingLayerType {
  return layerType === 'VTD' || layerType === 'COUSUB';
}

/**
 * Type guard: Check if layer type permits overlaps
 */
export function isNonTilingLayer(layerType: LayerType): layerType is NonTilingLayerType {
  return layerType === 'PLACE' || layerType === 'CDP' || layerType === 'ZCTA';
}

/**
 * Helper: Get default allowOverlaps setting for layer type
 */
export function getDefaultOverlapSetting(layerType: LayerType): boolean {
  return isNonTilingLayer(layerType);
}

/**
 * Helper: Format validation result as human-readable string
 */
export function formatValidationResult(result: TopologyValidationResult): string {
  const status = result.valid ? '✅ PASS' : '❌ FAIL';
  const lines = [
    `${status} - ${result.metadata.layerType} Topology Validation`,
    `Coverage: ${result.totalCoverage.toFixed(4)}%`,
    `Gaps: ${result.gapPercentage.toFixed(4)}% (${result.gapArea.toFixed(2)} m²)`,
    `Overlaps: ${result.overlapPercentage.toFixed(4)}% (${result.overlapArea.toFixed(2)} m²)`,
    `Children: ${result.metadata.childCount} features`,
  ];

  if (result.errors.length > 0) {
    lines.push('', 'Errors:');
    result.errors.forEach(error => lines.push(`  - ${error}`));
  }

  if (result.warnings.length > 0) {
    lines.push('', 'Warnings:');
    result.warnings.forEach(warning => lines.push(`  - ${warning}`));
  }

  return lines.join('\n');
}

/**
 * Helper: Create validation config with defaults
 */
export function createValidationConfig(
  parent: Feature<Polygon>,
  children: readonly Feature<Polygon>[],
  layerType: LayerType,
  options?: {
    readonly tolerance?: number;
    readonly allowOverlaps?: boolean;
  }
): TopologyValidationConfig {
  return {
    parent,
    children,
    layerType,
    tolerance: options?.tolerance ?? 0.001,
    allowOverlaps: options?.allowOverlaps ?? getDefaultOverlapSetting(layerType),
  };
}

/**
 * Helper: Validate that result matches expected outcome
 * Useful for testing
 */
export function assertValidationResult(
  result: TopologyValidationResult,
  expected: {
    readonly valid: boolean;
    readonly maxGapPercentage?: number;
    readonly maxOverlapPercentage?: number;
    readonly minCoverage?: number;
  }
): void {
  if (result.valid !== expected.valid) {
    throw new Error(
      `Validation result mismatch: expected ${expected.valid ? 'PASS' : 'FAIL'}, got ${result.valid ? 'PASS' : 'FAIL'}\n${formatValidationResult(result)}`
    );
  }

  if (expected.maxGapPercentage !== undefined && result.gapPercentage > expected.maxGapPercentage) {
    throw new Error(
      `Gap percentage ${result.gapPercentage.toFixed(4)}% exceeds maximum ${expected.maxGapPercentage}%`
    );
  }

  if (expected.maxOverlapPercentage !== undefined && result.overlapPercentage > expected.maxOverlapPercentage) {
    throw new Error(
      `Overlap percentage ${result.overlapPercentage.toFixed(4)}% exceeds maximum ${expected.maxOverlapPercentage}%`
    );
  }

  if (expected.minCoverage !== undefined && result.totalCoverage < expected.minCoverage) {
    throw new Error(
      `Total coverage ${result.totalCoverage.toFixed(4)}% below minimum ${expected.minCoverage}%`
    );
  }
}

/**
 * Constants for validation
 */
export const VALIDATION_CONSTANTS = {
  /** Default tolerance threshold (0.001% = 1 part per 100,000) */
  DEFAULT_TOLERANCE: 0.001,

  /** Minimum area for a feature to be considered valid (square meters) */
  MIN_FEATURE_AREA: 0.0001,

  /** Maximum allowed gap percentage for tiling layers */
  MAX_GAP_PERCENTAGE: 0.001,

  /** Maximum allowed overlap percentage for tiling layers */
  MAX_OVERLAP_PERCENTAGE: 0.001,

  /** Minimum coverage percentage for all layers */
  MIN_COVERAGE_PERCENTAGE: 99.999,
} as const;
