/**
 * TIGER Layer Topology Rules
 *
 * Layer-specific validation constraints based on Census Bureau TIGER/Line specs.
 * Single source of truth for topology validation across all TIGER layers.
 *
 * KEY CONSTRAINTS:
 * - TILING layers (VTD, COUSUB): Must perfectly partition parent container
 * - NON-TILING layers (PLACE, CDP, ZCTA): Overlaps acceptable
 *
 * Reference: https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2023/TGRSHP2023_TechDoc.pdf
 */

import type { NormalizedBoundary } from '../core/types.js';
import { type TIGERLayerType } from '../core/types.js';
import type { Polygon, MultiPolygon, Point } from 'geojson';

// Re-export for consumers
export type { TIGERLayerType };

// ============================================================================
// Topology Rule Definitions
// ============================================================================

/**
 * Topology validation rules for a TIGER layer.
 *
 * Specifies whether layer must tile within parent, overlap thresholds,
 * and vertex snapping tolerances for floating-point precision handling.
 */
export interface LayerTopologyRules {
  /**
   * Whether this layer must perfectly tile within its parent layer.
   *
   * When true:
   * - Sum(child areas) ≈ parent area (within tolerance)
   * - No overlaps between children
   * - No gaps between children
   */
  readonly mustTileWithinParent: boolean;

  /**
   * Parent layer that this layer tiles within.
   * Null for non-tiling layers or top-level jurisdictions.
   */
  readonly parentLayer: TIGERLayerType | null;

  /**
   * Maximum acceptable overlap percentage between boundaries.
   *
   * Values:
   * - 0.001% for tiling layers (vertex precision tolerance)
   * - 100% for non-tiling layers (overlaps permitted)
   *
   * Formula: (overlap_area / smaller_boundary_area) * 100
   */
  readonly maxOverlapPercentage: number;

  /**
   * Maximum acceptable gap percentage within parent boundary.
   *
   * Values:
   * - 0.001% for tiling layers (floating-point tolerance)
   * - 100% for non-tiling layers (gaps acceptable)
   *
   * Formula: ((parent_area - sum_child_areas) / parent_area) * 100
   */
  readonly maxGapPercentage: number;

  /**
   * Vertex snapping tolerance in meters.
   *
   * Census Bureau uses ~1 meter tolerance for boundary alignment.
   * Accounts for:
   * - Floating point precision
   * - Projection coordinate rounding
   * - Survey measurement precision
   */
  readonly toleranceMeters: number;

  /**
   * Whether boundaries in this layer may legally overlap.
   *
   * Examples:
   * - VTD: false (must partition county)
   * - PLACE: true (cities can cross county lines)
   */
  readonly overlapsPermitted: boolean;

  /**
   * Whether this layer requires complete coverage of parent.
   *
   * Examples:
   * - VTD: true (every point in county in exactly one VTD)
   * - PLACE: false (rural areas may have no incorporated place)
   */
  readonly completeCoverageRequired: boolean;
}

/**
 * Topology validation rules for each TIGER layer type.
 *
 * Based on Census Bureau TIGER/Line technical documentation:
 * - VTDs must completely partition counties (no gaps, no overlaps)
 * - COUSUBs must completely partition counties (no gaps, no overlaps)
 * - PLACEs may cross county boundaries
 * - CDPs may overlap with PLACEs
 * - ZCTAs may cross any jurisdictional boundary
 *
 * Note: VTD and COUSUB are mutually exclusive tiling systems.
 * Both tile within COUNTY but do NOT tile with each other.
 */
export const LAYER_TOPOLOGY_RULES: Readonly<Record<TIGERLayerType, LayerTopologyRules>> = {
  // Electoral Infrastructure - Must partition counties
  vtd: {
    mustTileWithinParent: true,
    parentLayer: 'county',
    maxOverlapPercentage: 0.001,
    maxGapPercentage: 0.001,
    toleranceMeters: 1.0,
    overlapsPermitted: false,
    completeCoverageRequired: true,
  },

  // County Subdivisions - Must partition counties
  cousub: {
    mustTileWithinParent: true,
    parentLayer: 'county',
    maxOverlapPercentage: 0.001,
    maxGapPercentage: 0.001,
    toleranceMeters: 1.0,
    overlapsPermitted: false,
    completeCoverageRequired: true,
  },

  // Incorporated Places - May cross county lines
  place: {
    mustTileWithinParent: false,
    parentLayer: null,
    maxOverlapPercentage: 100.0,
    maxGapPercentage: 100.0,
    toleranceMeters: 1.0,
    overlapsPermitted: true,
    completeCoverageRequired: false,
  },

  // Census Designated Places - Statistical areas, may overlap
  cdp: {
    mustTileWithinParent: false,
    parentLayer: null,
    maxOverlapPercentage: 100.0,
    maxGapPercentage: 100.0,
    toleranceMeters: 1.0,
    overlapsPermitted: true,
    completeCoverageRequired: false,
  },

  // ZIP Code Tabulation Areas - Cross all jurisdictions
  zcta: {
    mustTileWithinParent: false,
    parentLayer: null,
    maxOverlapPercentage: 100.0,
    maxGapPercentage: 100.0,
    toleranceMeters: 1.0,
    overlapsPermitted: true,
    completeCoverageRequired: false,
  },

  // Counties - Must partition states
  county: {
    mustTileWithinParent: true,
    parentLayer: null, // State not in TIGERLayerType, handled specially
    maxOverlapPercentage: 0.001,
    maxGapPercentage: 0.001,
    toleranceMeters: 1.0,
    overlapsPermitted: false,
    completeCoverageRequired: true,
  },

  // Congressional Districts - Must partition states
  cd: {
    mustTileWithinParent: true,
    parentLayer: null, // State not in TIGERLayerType
    maxOverlapPercentage: 0.001,
    maxGapPercentage: 0.001,
    toleranceMeters: 1.0,
    overlapsPermitted: false,
    completeCoverageRequired: true,
  },

  // State Legislative Upper - Must partition states
  sldu: {
    mustTileWithinParent: true,
    parentLayer: null,
    maxOverlapPercentage: 0.001,
    maxGapPercentage: 0.001,
    toleranceMeters: 1.0,
    overlapsPermitted: false,
    completeCoverageRequired: true,
  },

  // State Legislative Lower - Must partition states
  sldl: {
    mustTileWithinParent: true,
    parentLayer: null,
    maxOverlapPercentage: 0.001,
    maxGapPercentage: 0.001,
    toleranceMeters: 1.0,
    overlapsPermitted: false,
    completeCoverageRequired: true,
  },

  // School Districts - Various coverage models
  unsd: {
    mustTileWithinParent: false, // May have gaps (home school, private)
    parentLayer: null,
    maxOverlapPercentage: 0.001, // Districts shouldn't overlap
    maxGapPercentage: 100.0, // Gaps acceptable
    toleranceMeters: 1.0,
    overlapsPermitted: false,
    completeCoverageRequired: false,
  },

  elsd: {
    mustTileWithinParent: false,
    parentLayer: null,
    maxOverlapPercentage: 0.001,
    maxGapPercentage: 100.0,
    toleranceMeters: 1.0,
    overlapsPermitted: false,
    completeCoverageRequired: false,
  },

  scsd: {
    mustTileWithinParent: false,
    parentLayer: null,
    maxOverlapPercentage: 0.001,
    maxGapPercentage: 100.0,
    toleranceMeters: 1.0,
    overlapsPermitted: false,
    completeCoverageRequired: false,
  },
};

// ============================================================================
// Topology Validation Result Types
// ============================================================================

/**
 * Detected overlap between two boundaries.
 */
export interface TopologyOverlap {
  /** First boundary GEOID */
  readonly geoid1: string;

  /** Second boundary GEOID */
  readonly geoid2: string;

  /** Area of overlap in square meters */
  readonly overlapAreaSqM: number;

  /** Percentage of first boundary covered by overlap */
  readonly overlapPercentage1: number;

  /** Percentage of second boundary covered by overlap */
  readonly overlapPercentage2: number;

  /** Geometry of overlap region */
  readonly overlapGeometry?: Polygon | MultiPolygon;
}

/**
 * Gap analysis result for tiling layers.
 */
export interface GapAnalysis {
  /** Total area of parent boundary in square meters */
  readonly parentAreaSqM: number;

  /** Sum of child boundary areas in square meters */
  readonly childrenAreaSqM: number;

  /** Unaccounted area (parent - children) in square meters */
  readonly gapAreaSqM: number;

  /** Gap as percentage of parent area */
  readonly gapPercentage: number;

  /** Whether gap exceeds maximum allowed threshold */
  readonly exceedsThreshold: boolean;

  /** Number of discrete gap regions */
  readonly gapCount: number;

  /** Gap region geometries (if computed) */
  readonly gapRegions?: ReadonlyArray<Polygon | MultiPolygon>;
}

/**
 * Self-intersection detected in boundary geometry.
 */
export interface SelfIntersection {
  /** Boundary GEOID with self-intersection */
  readonly geoid: string;

  /** Boundary name */
  readonly name: string;

  /** Number of self-intersection points (kinks) */
  readonly kinkCount: number;

  /** Locations of self-intersections */
  readonly kinkLocations?: ReadonlyArray<Point>;
}

/**
 * Complete topology validation result for a layer.
 */
export interface TopologyValidationResult {
  /** Whether the layer passed all topology checks */
  readonly valid: boolean;

  /** Layer that was validated */
  readonly layer: TIGERLayerType;

  /** Number of boundaries validated */
  readonly boundaryCount: number;

  /** Overlaps detected (if any) */
  readonly overlaps: ReadonlyArray<TopologyOverlap>;

  /** Gap analysis (for tiling layers only) */
  readonly gapAnalysis: GapAnalysis | null;

  /** Self-intersections detected */
  readonly selfIntersections: ReadonlyArray<SelfIntersection>;

  /** Validation errors (blocking) */
  readonly errors: ReadonlyArray<string>;

  /** Validation warnings (non-blocking) */
  readonly warnings: ReadonlyArray<string>;

  /** Human-readable summary */
  readonly summary: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get topology rules for a TIGER layer.
 */
export function getTopologyRules(layer: TIGERLayerType): LayerTopologyRules {
  return LAYER_TOPOLOGY_RULES[layer];
}

/**
 * Check if a layer requires tiling validation.
 */
export function requiresTilingValidation(layer: TIGERLayerType): boolean {
  return LAYER_TOPOLOGY_RULES[layer].mustTileWithinParent;
}

/**
 * Check if overlaps are permitted for a layer.
 */
export function overlapsPermitted(layer: TIGERLayerType): boolean {
  return LAYER_TOPOLOGY_RULES[layer].overlapsPermitted;
}

/**
 * Get parent layer for tiling validation.
 */
export function getParentLayer(layer: TIGERLayerType): TIGERLayerType | null {
  return LAYER_TOPOLOGY_RULES[layer].parentLayer;
}

/**
 * Get maximum overlap percentage threshold.
 */
export function getMaxOverlapPercent(layer: TIGERLayerType): number {
  return LAYER_TOPOLOGY_RULES[layer].maxOverlapPercentage;
}

/**
 * Get maximum gap percentage threshold.
 */
export function getMaxGapPercent(layer: TIGERLayerType): number {
  return LAYER_TOPOLOGY_RULES[layer].maxGapPercentage;
}

/**
 * Layers that require perfect tiling (for batch validation).
 */
export const TILING_LAYERS: readonly TIGERLayerType[] = [
  'vtd',
  'cousub',
  'county',
  'cd',
  'sldu',
  'sldl',
] as const;

/**
 * Layers where overlaps are permitted.
 */
export const OVERLAPPING_LAYERS: readonly TIGERLayerType[] = [
  'place',
  'cdp',
  'zcta',
] as const;
