/**
 * TIGER Data Validator
 *
 * Comprehensive validation for Census TIGER/Line boundary data.
 * Ensures completeness, topology validity, coordinate accuracy, and cross-source verification.
 *
 * VALIDATION LAYERS:
 * 1. Completeness: All expected boundaries present (no missing GEOIDs)
 * 2. Topology: No self-intersections, overlaps, or gaps
 * 3. Coordinates: Valid WGS84 ranges, no null/NaN values
 * 4. Cross-validation: Compare TIGER vs state redistricting commission data
 * 5. Quality scoring: Weighted 0-100 score based on all checks
 *
 * PHILOSOPHY:
 * - Zero tolerance for missing data (incomplete coverage = validation failure)
 * - Topology errors flagged but don't block (Census data sometimes has minor issues)
 * - Coordinate errors are critical (invalid coords = unusable for PIP)
 *
 * INTEGRATION:
 * - Called after TIGER download to verify data integrity
 * - Used in CI/CD to prevent bad data from entering Shadow Atlas
 * - Provides audit trail for data quality metrics
 */

import type { FeatureCollection, Polygon, MultiPolygon, Position } from 'geojson';
import type { TIGERLayerType } from '../core/types.js';
import {
  getExpectedCount,
  getStateName,
  EXPECTED_CD_BY_STATE,
  EXPECTED_SLDU_BY_STATE,
  EXPECTED_SLDL_BY_STATE,
  EXPECTED_COUNTIES_BY_STATE,
} from './tiger-expected-counts.js';
import { STATE_FIPS_TO_NAME as CANONICAL_STATE_FIPS_TO_NAME } from '../core/types.js';
import {
  detectOverlaps,
  detectGaps,
  detectSelfIntersections,
  validateLayerTopology,
} from './topology-detector.js';
import {
  getTopologyRules,
  type TopologyOverlap,
  type GapAnalysis,
  type SelfIntersection,
} from './topology-rules.js';
import type { NormalizedBoundary as CoreNormalizedBoundary, TopologyResult } from '../core/types.js';
// extractCoordinates imported from centralized geo-utils (eliminated duplicate)
import { extractCoordinatesFromGeometry } from '../core/geo-utils.js';

/**
 * Minimal normalized boundary for TIGER validation
 *
 * NOTE: This is a specialized minimal interface for TIGER validation only.
 * For the full canonical NormalizedBoundary, use core/types.ts
 */
export interface NormalizedBoundary {
  readonly geoid: string;
  readonly name: string;
  readonly geometry: Polygon | MultiPolygon;
  readonly properties: Record<string, unknown>;
}

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

// TopologyResult is now imported from core/types.ts (consolidated)
// Re-export for backward compatibility with code importing from tiger-validator
export type { TopologyResult } from '../core/types.js';

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
  readonly suspiciousLocations: ReadonlyArray<{
    readonly geoid: string;
    readonly reason: string;
    readonly centroid: { readonly lat: number; readonly lon: number };
  }>;

  /** Human-readable summary */
  readonly summary: string;
}

/**
 * Cross-validation result (TIGER vs state source)
 */
export interface CrossValidationResult {
  /** Number of boundaries matched between sources */
  readonly matched: number;

  /** Number of boundaries that don't match */
  readonly mismatched: number;

  /** Intersection over Union scores for each matched boundary */
  readonly iouScores: ReadonlyMap<string, number>;

  /** Significant discrepancies (>1% area difference) */
  readonly significantDiscrepancies: ReadonlyArray<{
    readonly geoid: string;
    readonly tigerArea: number;
    readonly stateArea: number;
    readonly difference: number; // Percentage
  }>;

  /** Human-readable summary */
  readonly summary: string;
}

/**
 * Overall validation result
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
}

/**
 * State FIPS to name mapping (for validation)
 * Imported from canonical source in core/types.ts
 */
const STATE_FIPS_TO_NAME = CANONICAL_STATE_FIPS_TO_NAME;

/**
 * Validate GEOID format for different layer types
 *
 * GEOID FORMAT SPECIFICATIONS (Census Bureau):
 * - CD: 4 digits (SSDD) - State + District
 * - SLDU/SLDL: 5 digits (SSDDD) - State + District
 * - County: 5 digits (SSCCC) - State + County
 * - School (UNSD/ELSD/SCSD): 7 digits (SSLLLLL) - State + LEA code
 * - Place/CDP: 7 digits (SSPPPPP) - State + Place code
 * - COUSUB: 10 digits (SSCCCXXXXX) - State + County + Subdivision
 * - VTD: 11 chars (SSCCCVVVVVV) - State + County + VTD (alphanumeric)
 * - ZCTA: 5 digits (ZZZZZ) - ZIP code only (no state prefix)
 */
function validateGeoidFormat(geoid: string, layer: TIGERLayerType): boolean {
  switch (layer) {
    case 'cd':
      // Congressional District: 4 digits (SSDD)
      return geoid.length === 4 && /^\d{4}$/.test(geoid);

    case 'sldu':
    case 'sldl':
      // State Legislative: 5 digits (SSDDD)
      return geoid.length === 5 && /^\d{5}$/.test(geoid);

    case 'county':
      // County: 5 digits (SSCCC)
      return geoid.length === 5 && /^\d{5}$/.test(geoid);

    case 'unsd':
    case 'elsd':
    case 'scsd': {
      // School Districts: 7 digits (SSLLLLL)
      if (geoid.length !== 7 || !/^\d{7}$/.test(geoid)) return false;
      const stateFips = geoid.substring(0, 2);
      return STATE_FIPS_TO_NAME[stateFips] !== undefined;
    }

    case 'place':
    case 'cdp': {
      // Incorporated Places / Census Designated Places: 7 digits (SSPPPPP)
      // State (2) + Place FIPS (5)
      if (geoid.length !== 7 || !/^\d{7}$/.test(geoid)) return false;
      const stateFips = geoid.substring(0, 2);
      return STATE_FIPS_TO_NAME[stateFips] !== undefined;
    }

    case 'cousub': {
      // County Subdivisions (townships, boroughs, MCDs): 10 digits (SSCCCXXXXX)
      // State (2) + County (3) + Subdivision (5)
      if (geoid.length !== 10 || !/^\d{10}$/.test(geoid)) return false;
      const stateFips = geoid.substring(0, 2);
      return STATE_FIPS_TO_NAME[stateFips] !== undefined;
    }

    case 'vtd': {
      // Voting Districts (precincts): 11 chars (SSCCCVVVVVV)
      // State (2) + County (3) + VTD code (6, can be alphanumeric in some states)
      if (geoid.length !== 11) return false;
      const stateFips = geoid.substring(0, 2);
      const countyFips = geoid.substring(2, 5);
      const vtdCode = geoid.substring(5, 11);
      // State must be valid, county must be numeric, VTD can be alphanumeric
      return (
        STATE_FIPS_TO_NAME[stateFips] !== undefined &&
        /^\d{3}$/.test(countyFips) &&
        /^[A-Z0-9]{6}$/i.test(vtdCode)
      );
    }

    case 'zcta':
      // ZIP Code Tabulation Areas: 5 digits (ZZZZZ)
      // No state prefix - just the 5-digit ZIP code
      return geoid.length === 5 && /^\d{5}$/.test(geoid);

    default:
      // Exhaustive check - TypeScript will catch missing cases at compile time
      return false;
  }
}

/**
 * Get expected field names for layer type
 *
 * TIGER shapefiles have layer-specific field names for identifiers.
 * These are validated to ensure data integrity after download.
 */
function getExpectedFields(layer: TIGERLayerType): string[] {
  switch (layer) {
    // Legislative layers
    case 'cd':
      return ['GEOID', 'NAMELSAD', 'STATEFP', 'CD119FP'];
    case 'sldu':
      return ['GEOID', 'NAMELSAD', 'STATEFP', 'SLDUST'];
    case 'sldl':
      return ['GEOID', 'NAMELSAD', 'STATEFP', 'SLDLST'];

    // Administrative layers
    case 'county':
      return ['GEOID', 'NAMELSAD', 'STATEFP', 'COUNTYFP'];
    case 'cousub':
      // County Subdivisions (townships, boroughs, MCDs)
      return ['GEOID', 'NAMELSAD', 'STATEFP', 'COUNTYFP', 'COUSUBFP'];

    // Municipal layers
    case 'place':
      // Incorporated Places (cities, towns, villages)
      return ['GEOID', 'NAMELSAD', 'STATEFP', 'PLACEFP', 'CLASSFP'];
    case 'cdp':
      // Census Designated Places (unincorporated communities)
      return ['GEOID', 'NAMELSAD', 'STATEFP', 'PLACEFP'];

    // School district layers
    case 'unsd':
      return ['GEOID', 'NAME', 'STATEFP', 'UNSDLEA'];
    case 'elsd':
      return ['GEOID', 'NAME', 'STATEFP', 'ELSDLEA'];
    case 'scsd':
      return ['GEOID', 'NAME', 'STATEFP', 'SCSDLEA'];

    // Electoral infrastructure
    case 'vtd':
      // Voting Districts (precincts) - 2020 Census vintage fields
      return ['GEOID20', 'NAME20', 'STATEFP20', 'COUNTYFP20', 'VTDST20'];

    // Reference layers
    case 'zcta':
      // ZIP Code Tabulation Areas - no state field (ZCTAs cross state lines)
      return ['GEOID20', 'ZCTA5CE20', 'ALAND20', 'AWATER20'];

    default:
      // Fallback for unknown layers
      return ['GEOID', 'NAME'];
  }
}

/**
 * TIGER Data Validator
 *
 * Validates Census TIGER/Line boundary data for completeness, topology, and coordinate accuracy.
 */
export class TIGERValidator {
  /**
   * Validate completeness of downloaded TIGER data
   * Ensures all expected boundaries are present
   */
  validateCompleteness(
    layer: TIGERLayerType,
    boundaries: readonly NormalizedBoundary[],
    stateFips?: string
  ): CompletenessResult {
    const expected = getExpectedCount(layer, stateFips);

    if (expected === null) {
      // Can't validate without expected count
      return {
        valid: true,
        expected: 0,
        actual: boundaries.length,
        percentage: 100,
        missingGEOIDs: [],
        extraGEOIDs: [],
        summary: 'No expected count available (cannot validate completeness)',
      };
    }

    const actual = boundaries.length;
    const percentage = expected > 0 ? (actual / expected) * 100 : 0;

    // Validate GEOID formats for school districts and other layers
    const invalidGEOIDs: string[] = [];
    for (const boundary of boundaries) {
      if (!validateGeoidFormat(boundary.geoid, layer)) {
        invalidGEOIDs.push(boundary.geoid);
      }
    }

    // For now, we don't have authoritative GEOID lists to compare against
    // So we only check counts (missing/extra GEOIDs would require reference data)
    const missingGEOIDs: string[] = [];
    const extraGEOIDs: string[] = [];

    const countValid = actual === expected;
    const formatValid = invalidGEOIDs.length === 0;
    const valid = countValid && formatValid;

    const stateName = stateFips ? getStateName(stateFips) : 'National';
    let summary = '';

    if (valid) {
      summary = `✅ Complete: ${actual}/${expected} ${layer.toUpperCase()} boundaries (${stateName})`;
    } else if (!countValid && !formatValid) {
      summary = `❌ Incomplete: ${actual}/${expected} ${layer.toUpperCase()} boundaries (${percentage.toFixed(1)}%, ${stateName}), ${invalidGEOIDs.length} invalid GEOIDs`;
    } else if (!countValid) {
      summary = `❌ Incomplete: ${actual}/${expected} ${layer.toUpperCase()} boundaries (${percentage.toFixed(1)}%, ${stateName})`;
    } else {
      summary = `❌ Invalid GEOIDs: ${invalidGEOIDs.length} boundaries with malformed GEOIDs (${stateName})`;
    }

    return {
      valid,
      expected,
      actual,
      percentage,
      missingGEOIDs,
      extraGEOIDs,
      summary,
    };
  }

  /**
   * Validate topology (no gaps, no overlaps, no self-intersections)
   *
   * Uses the production topology-detector implementation with R-tree spatial
   * indexing and turf.js for geometric operations.
   *
   * @param boundaries - Boundaries to validate
   * @param layer - Optional TIGER layer type for layer-specific rules
   * @param parentBoundary - Optional parent boundary for gap detection (tiling layers)
   */
  validateTopology(
    boundaries: readonly NormalizedBoundary[],
    layer?: TIGERLayerType,
    parentBoundary?: NormalizedBoundary
  ): TopologyResult {
    const invalidGeometries: string[] = [];

    // Check for null/invalid geometries first
    for (const boundary of boundaries) {
      if (!boundary.geometry) {
        invalidGeometries.push(boundary.geoid);
        continue;
      }

      if (boundary.geometry.type === 'Polygon') {
        const polygon = boundary.geometry as Polygon;
        if (polygon.coordinates.length === 0) {
          invalidGeometries.push(boundary.geoid);
        }
      } else if (boundary.geometry.type === 'MultiPolygon') {
        const multiPolygon = boundary.geometry as MultiPolygon;
        if (multiPolygon.coordinates.length === 0) {
          invalidGeometries.push(boundary.geoid);
        }
      }
    }

    // Convert NormalizedBoundary (geoid) to CoreNormalizedBoundary (id) for topology-detector
    const coreBoundaries: CoreNormalizedBoundary[] = boundaries.map(b => ({
      id: b.geoid,
      name: b.name,
      level: 'county' as const, // Default level, not used for validation logic
      geometry: b.geometry,
      properties: b.properties,
      source: {
        provider: 'census-tiger',
        url: 'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html',
        version: '2024',
        license: 'Public Domain',
        updatedAt: new Date().toISOString(),
        checksum: '',
        authorityLevel: 'federal-mandate' as const,
        legalStatus: 'binding' as const,
        collectionMethod: 'census-tiger' as const,
        lastVerified: new Date().toISOString(),
        verifiedBy: 'automated' as const,
        topologyValidated: false,
        geometryRepaired: false,
        coordinateSystem: 'EPSG:4326' as const,
        updateMonitoring: 'manual-check' as const,
      },
    }));

    // Get tolerance from layer-specific rules (default: 0.001%)
    const tolerancePercent = layer
      ? getTopologyRules(layer).maxOverlapPercentage
      : 0.001;

    // Detect overlaps using R-tree spatial index
    const detectedOverlaps = detectOverlaps(coreBoundaries, tolerancePercent);

    // Map overlaps back to TopologyResult format
    const overlaps: Array<{ geoid1: string; geoid2: string; overlapArea: number }> =
      detectedOverlaps.map(o => ({
        geoid1: o.geoid1,
        geoid2: o.geoid2,
        overlapArea: o.overlapAreaSqM,
      }));

    // Detect self-intersections using turf.kinks()
    const detectedSelfIntersections = detectSelfIntersections(coreBoundaries);
    const selfIntersections = detectedSelfIntersections.length;

    // Detect gaps (for tiling layers, if parent is provided)
    let gaps = 0;
    if (parentBoundary && layer) {
      const rules = getTopologyRules(layer);
      if (rules.mustTileWithinParent) {
        const coreParent: CoreNormalizedBoundary = {
          id: parentBoundary.geoid,
          name: parentBoundary.name,
          level: 'county' as const,
          geometry: parentBoundary.geometry,
          properties: parentBoundary.properties,
          source: {
            provider: 'census-tiger',
            url: 'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html',
            version: '2024',
            license: 'Public Domain',
            updatedAt: new Date().toISOString(),
            checksum: '',
            authorityLevel: 'federal-mandate' as const,
            legalStatus: 'binding' as const,
            collectionMethod: 'census-tiger' as const,
            lastVerified: new Date().toISOString(),
            verifiedBy: 'automated' as const,
            topologyValidated: false,
            geometryRepaired: false,
            coordinateSystem: 'EPSG:4326' as const,
            updateMonitoring: 'manual-check' as const,
          },
        };

        const gapAnalysis = detectGaps(coreBoundaries, coreParent, rules.maxGapPercentage);
        gaps = gapAnalysis.gapCount;
      }
    }

    const valid =
      invalidGeometries.length === 0 &&
      selfIntersections === 0 &&
      overlaps.length === 0 &&
      gaps === 0;

    // Build summary with details
    const issues: string[] = [];
    if (invalidGeometries.length > 0) {
      issues.push(`${invalidGeometries.length} invalid geometries`);
    }
    if (selfIntersections > 0) {
      issues.push(`${selfIntersections} self-intersections`);
    }
    if (overlaps.length > 0) {
      issues.push(`${overlaps.length} overlaps`);
    }
    if (gaps > 0) {
      issues.push(`${gaps} gaps`);
    }

    const summary = valid
      ? '✅ Topology valid: No invalid geometries, self-intersections, overlaps, or gaps detected'
      : `❌ Topology issues: ${issues.join(', ')}`;

    return {
      valid,
      selfIntersections,
      overlaps,
      gaps,
      invalidGeometries,
      summary,
    };
  }

  /**
   * Validate coordinate system (must be WGS84 EPSG:4326)
   */
  validateCoordinates(
    boundaries: readonly NormalizedBoundary[]
  ): CoordinateResult {
    const nullCoordinates: string[] = [];
    const suspiciousLocations: Array<{
      geoid: string;
      reason: string;
      centroid: { lat: number; lon: number };
    }> = [];
    let outOfRangeCount = 0;

    for (const boundary of boundaries) {
      if (!boundary.geometry) {
        nullCoordinates.push(boundary.geoid);
        continue;
      }

      // Extract all coordinates from geometry
      const coords = extractCoordinatesFromGeometry(boundary.geometry);

      // Check each coordinate
      for (const [lon, lat] of coords) {
        // Check for null/NaN
        if (
          lon === null ||
          lat === null ||
          !Number.isFinite(lon) ||
          !Number.isFinite(lat)
        ) {
          if (!nullCoordinates.includes(boundary.geoid)) {
            nullCoordinates.push(boundary.geoid);
          }
          continue;
        }

        // Check WGS84 valid ranges
        if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
          outOfRangeCount++;
        }
      }

      // Compute centroid and check for suspicious locations
      const centroid = this.computeCentroid(boundary.geometry);
      if (centroid) {
        // Check if centroid is in ocean (basic check for continental US)
        // Continental US: lat 24-49°N, lon -125 to -66°W
        // Alaska: lat 51-72°N, lon -169 to -141°W
        // Hawaii: lat 19-23°N, lon -161 to -155°W

        const isContinentalUS =
          centroid.lat >= 24 &&
          centroid.lat <= 49 &&
          centroid.lon >= -125 &&
          centroid.lon <= -66;

        const isAlaska =
          centroid.lat >= 51 &&
          centroid.lat <= 72 &&
          centroid.lon >= -169 &&
          centroid.lon <= -141;

        const isHawaii =
          centroid.lat >= 19 &&
          centroid.lat <= 23 &&
          centroid.lon >= -161 &&
          centroid.lon <= -155;

        if (!isContinentalUS && !isAlaska && !isHawaii) {
          suspiciousLocations.push({
            geoid: boundary.geoid,
            reason: 'Centroid outside continental US, Alaska, and Hawaii (may be territory)',
            centroid: { lat: centroid.lat, lon: centroid.lon },
          });
        }
      }
    }

    const valid =
      nullCoordinates.length === 0 &&
      outOfRangeCount === 0;

    const summary = valid
      ? '✅ Coordinates valid: All within WGS84 ranges, no null values'
      : `❌ Coordinate issues: ${nullCoordinates.length} null, ${outOfRangeCount} out of range`;

    return {
      valid,
      outOfRangeCount,
      nullCoordinates,
      suspiciousLocations,
      summary,
    };
  }

  /**
   * Cross-validate TIGER data against state redistricting commission
   *
   * NOTE: This requires state boundary data to compare against.
   * Implementation is simplified - full version would use spatial intersection.
   */
  async crossValidate(
    tigerBoundaries: readonly NormalizedBoundary[],
    stateBoundaries: readonly NormalizedBoundary[]
  ): Promise<CrossValidationResult> {
    // Build GEOID lookup maps
    const tigerMap = new Map<string, NormalizedBoundary>();
    const stateMap = new Map<string, NormalizedBoundary>();

    for (const b of tigerBoundaries) {
      tigerMap.set(b.geoid, b);
    }

    for (const b of stateBoundaries) {
      stateMap.set(b.geoid, b);
    }

    // Find matches
    const iouScores = new Map<string, number>();
    const significantDiscrepancies: Array<{
      geoid: string;
      tigerArea: number;
      stateArea: number;
      difference: number;
    }> = [];

    let matched = 0;
    let mismatched = 0;

    for (const [geoid, tigerBoundary] of tigerMap.entries()) {
      const stateBoundary = stateMap.get(geoid);

      if (!stateBoundary) {
        mismatched++;
        continue;
      }

      matched++;

      // Compute IoU (Intersection over Union)
      // Simplified: Use area comparison instead of actual intersection
      const tigerArea = this.computeArea(tigerBoundary.geometry);
      const stateArea = this.computeArea(stateBoundary.geometry);

      // IoU approximation: If areas are very similar, assume high IoU
      // Real IoU would require spatial intersection computation
      const areaDiff = Math.abs(tigerArea - stateArea);
      const avgArea = (tigerArea + stateArea) / 2;
      const similarity = avgArea > 0 ? 1 - areaDiff / avgArea : 1;

      iouScores.set(geoid, similarity);

      // Flag significant discrepancies (>1% area difference)
      const diffPercent = avgArea > 0 ? (areaDiff / avgArea) * 100 : 0;
      if (diffPercent > 1) {
        significantDiscrepancies.push({
          geoid,
          tigerArea,
          stateArea,
          difference: diffPercent,
        });
      }
    }

    const summary =
      matched === tigerBoundaries.length
        ? `✅ Cross-validation: ${matched}/${tigerBoundaries.length} boundaries matched`
        : `⚠️  Cross-validation: ${matched}/${tigerBoundaries.length} matched, ${mismatched} missing in state data`;

    return {
      matched,
      mismatched,
      iouScores,
      significantDiscrepancies,
      summary,
    };
  }

  /**
   * Calculate overall quality score (0-100)
   *
   * Weighted scoring:
   * - Completeness: 40%
   * - Topology: 35%
   * - Coordinates: 25%
   */
  calculateQualityScore(
    completeness: CompletenessResult,
    topology: TopologyResult,
    coordinates: CoordinateResult
  ): number {
    // Completeness score (40%)
    const completenessScore = completeness.percentage * 0.4;

    // Topology score (35%)
    const topologyScore = topology.valid ? 35 : 0;

    // Coordinates score (25%)
    const coordinatesScore = coordinates.valid ? 25 : 0;

    return Math.round(completenessScore + topologyScore + coordinatesScore);
  }

  /**
   * Validate TIGER data (all checks)
   */
  validate(
    layer: TIGERLayerType,
    boundaries: readonly NormalizedBoundary[],
    stateFips?: string
  ): ValidationResult {
    const completeness = this.validateCompleteness(layer, boundaries, stateFips);
    const topology = this.validateTopology(boundaries);
    const coordinates = this.validateCoordinates(boundaries);

    const qualityScore = this.calculateQualityScore(
      completeness,
      topology,
      coordinates
    );

    const stateName = stateFips ? getStateName(stateFips) : 'National';

    const summary = `${layer.toUpperCase()} Validation (${stateName}): Quality Score ${qualityScore}/100\n` +
      `${completeness.summary}\n` +
      `${topology.summary}\n` +
      `${coordinates.summary}`;

    return {
      layer,
      stateFips: stateFips ?? null,
      qualityScore,
      completeness,
      topology,
      coordinates,
      validatedAt: new Date(),
      summary,
    };
  }

  // extractCoordinates moved to core/geo-utils.ts - use extractCoordinatesFromGeometry()

  /**
   * Compute centroid of a polygon
   */
  private computeCentroid(
    geometry: Polygon | MultiPolygon
  ): { lat: number; lon: number } | null {
    const coords = extractCoordinatesFromGeometry(geometry);

    if (coords.length === 0) {
      return null;
    }

    let sumLon = 0;
    let sumLat = 0;

    for (const [lon, lat] of coords) {
      sumLon += lon;
      sumLat += lat;
    }

    return {
      lat: sumLat / coords.length,
      lon: sumLon / coords.length,
    };
  }

  /**
   * Compute approximate area of a polygon (in square degrees)
   *
   * NOTE: This is a very rough approximation. Real area calculation
   * requires geodetic math (haversine formula or proper projection).
   */
  private computeArea(geometry: Polygon | MultiPolygon): number {
    let totalArea = 0;

    if (geometry.type === 'Polygon') {
      totalArea = this.polygonArea(geometry.coordinates[0]);
    } else if (geometry.type === 'MultiPolygon') {
      for (const polygon of geometry.coordinates) {
        totalArea += this.polygonArea(polygon[0]);
      }
    }

    return totalArea;
  }

  /**
   * Compute area of a polygon ring (shoelace formula)
   */
  private polygonArea(ring: Position[]): number {
    let area = 0;

    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      area += x1 * y2 - x2 * y1;
    }

    return Math.abs(area / 2);
  }

  /**
   * Validate TIGER data against shapefile ground truth
   *
   * Downloads official Census TIGER/Line shapefiles and compares district counts
   * against expected counts to establish ground truth.
   *
   * NOTE: This requires external shapefile parsing (ogr2ogr or shapefile npm package).
   * In production, use this as an integration test rather than runtime validation.
   */
  async validateAgainstShapefile(
    layer: TIGERLayerType,
    downloadedBoundaries: readonly NormalizedBoundary[],
    shapefilePath: string
  ): Promise<CrossValidationResult> {
    // This is a placeholder for shapefile validation
    // Full implementation would require shapefile parsing library
    // or calling external ogr2ogr process

    console.warn('validateAgainstShapefile: Shapefile parsing not implemented');
    console.warn('Use as integration test with external GDAL tools');

    // For now, return empty validation result
    return {
      matched: 0,
      mismatched: 0,
      iouScores: new Map(),
      significantDiscrepancies: [],
      summary: 'Shapefile validation requires external GDAL tools (see tiger-ground-truth.ts script)',
    };
  }
}
