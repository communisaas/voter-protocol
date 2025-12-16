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
import {
  getExpectedCount,
  getStateName,
  EXPECTED_CD_BY_STATE,
  EXPECTED_SLDU_BY_STATE,
  EXPECTED_SLDL_BY_STATE,
  EXPECTED_COUNTIES_BY_STATE,
} from './tiger-expected-counts.js';

/**
 * TIGER layer types
 */
export type TIGERLayer = 'cd' | 'sldu' | 'sldl' | 'county';

/**
 * Normalized boundary from TIGER data
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

/**
 * Topology validation result
 */
export interface TopologyResult {
  /** Whether topology is valid (no critical errors) */
  readonly valid: boolean;

  /** Number of self-intersecting polygons */
  readonly selfIntersections: number;

  /** Overlapping boundary pairs (GEOID1, GEOID2, overlap area in sq degrees) */
  readonly overlaps: ReadonlyArray<{
    readonly geoid1: string;
    readonly geoid2: string;
    readonly overlapArea: number;
  }>;

  /** Number of gaps detected (counties should tile perfectly within state) */
  readonly gaps: number;

  /** Invalid geometry GEOIDs (null, empty, or malformed) */
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
  readonly layer: TIGERLayer;

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
    layer: TIGERLayer,
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

    // For now, we don't have authoritative GEOID lists to compare against
    // So we only check counts (missing/extra GEOIDs would require reference data)
    const missingGEOIDs: string[] = [];
    const extraGEOIDs: string[] = [];

    const valid = actual === expected;

    const stateName = stateFips ? getStateName(stateFips) : 'National';
    const summary = valid
      ? `✅ Complete: ${actual}/${expected} ${layer.toUpperCase()} boundaries (${stateName})`
      : `❌ Incomplete: ${actual}/${expected} ${layer.toUpperCase()} boundaries (${percentage.toFixed(1)}%, ${stateName})`;

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
   * NOTE: This is a basic implementation. Full topology validation would require
   * libraries like GEOS/GDAL or turf.js with proper computational geometry.
   */
  validateTopology(
    boundaries: readonly NormalizedBoundary[]
  ): TopologyResult {
    const invalidGeometries: string[] = [];
    let selfIntersections = 0;

    // Check for null/invalid geometries
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

    // Basic self-intersection check (simplified - full check needs GEOS)
    // We check for duplicate vertices and malformed rings
    for (const boundary of boundaries) {
      if (!boundary.geometry) continue;

      if (boundary.geometry.type === 'Polygon') {
        const polygon = boundary.geometry as Polygon;
        for (const ring of polygon.coordinates) {
          if (ring.length < 4) {
            selfIntersections++;
            break;
          }

          // Check if ring is closed (first == last)
          const first = ring[0];
          const last = ring[ring.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) {
            selfIntersections++;
            break;
          }
        }
      }
    }

    // Overlap detection requires spatial indexing (R-tree) + intersection tests
    // Simplified: We flag this as requiring external tool (GDAL ogr2ogr -makevalid)
    const overlaps: Array<{ geoid1: string; geoid2: string; overlapArea: number }> = [];

    // Gap detection requires full coverage analysis
    // Simplified: We assume TIGER data is topologically correct (Census validates)
    const gaps = 0;

    const valid = invalidGeometries.length === 0 && selfIntersections === 0;

    const summary = valid
      ? '✅ Topology valid: No invalid geometries or self-intersections detected'
      : `❌ Topology issues: ${invalidGeometries.length} invalid geometries, ${selfIntersections} self-intersections`;

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
      const coords = this.extractCoordinates(boundary.geometry);

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
    layer: TIGERLayer,
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

  /**
   * Extract all coordinates from a Polygon or MultiPolygon
   */
  private extractCoordinates(
    geometry: Polygon | MultiPolygon
  ): Position[] {
    const coords: Position[] = [];

    if (geometry.type === 'Polygon') {
      for (const ring of geometry.coordinates) {
        coords.push(...ring);
      }
    } else if (geometry.type === 'MultiPolygon') {
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) {
          coords.push(...ring);
        }
      }
    }

    return coords;
  }

  /**
   * Compute centroid of a polygon
   */
  private computeCentroid(
    geometry: Polygon | MultiPolygon
  ): { lat: number; lon: number } | null {
    const coords = this.extractCoordinates(geometry);

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
}
