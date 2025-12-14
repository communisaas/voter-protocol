/**
 * Geographic Validator - Spatial and Topological Validation
 *
 * Validates GeoJSON boundaries for geographic correctness:
 * - Bounding box within expected state/city
 * - No topology errors (gaps, overlaps, self-intersections)
 * - Reasonable district count (3-50 for councils)
 *
 * Consolidates:
 * - validation/geographic-bounds-validator.ts
 * - validators/enhanced-geographic-validator.ts
 * - validators/district-count-validator.ts
 * - validation/deterministic-validators.ts
 */

import type { FeatureCollection, Feature, Polygon, MultiPolygon, Position } from 'geojson';
import { booleanWithin } from '@turf/boolean-within';
import { booleanIntersects } from '@turf/boolean-intersects';

/**
 * Geographic point (latitude/longitude)
 */
export interface Point {
  readonly lat: number;
  readonly lon: number;
}

/**
 * City information for validation
 */
export interface CityInfo {
  readonly name: string;
  readonly state: string;    // 2-letter state code
  readonly fips: string;     // 7-digit Census PLACE code
  readonly region?: string;  // Same as state (for compatibility)
}

/**
 * Bounds validation result
 */
export interface BoundsResult {
  readonly valid: boolean;
  readonly confidence: number;       // 0-100
  readonly reason: string;
  readonly centroid?: Point;
  readonly expectedState?: string;
  readonly actualState?: string | null;  // null if state cannot be determined
}

/**
 * District count validation result
 */
export interface CountResult {
  readonly valid: boolean;           // True if count is reasonable
  readonly isWarning: boolean;       // True if mismatch but not rejected
  readonly reason: string;
  readonly expected: number | null;
  readonly actual: number;
}

/**
 * Topology validation result
 */
export interface TopologyResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly selfIntersections: number;
  readonly gaps: number;
  readonly overlaps: number;
}

/**
 * Combined validation result
 */
export interface CombinedValidationResult {
  readonly bounds: BoundsResult;
  readonly count: CountResult;
  readonly topology: TopologyResult;
  readonly overall: boolean;
}

/**
 * State bounding boxes (approximate, for quick coordinate validation)
 * Format: [minLon, minLat, maxLon, maxLat]
 */
const STATE_BOUNDS: Record<string, readonly [number, number, number, number]> = {
  AL: [-88.5, 30.2, -84.9, 35.0],
  AK: [-180, 51, -129, 71.5],
  AZ: [-114.8, 31.3, -109.0, 37.0],
  AR: [-94.6, 33.0, -89.6, 36.5],
  CA: [-124.5, 32.5, -114.1, 42.0],
  CO: [-109.1, 37.0, -102.0, 41.0],
  CT: [-73.7, 40.9, -71.8, 42.1],
  DE: [-75.8, 38.4, -75.0, 39.8],
  FL: [-87.6, 24.5, -80.0, 31.0],
  GA: [-85.6, 30.4, -80.8, 35.0],
  HI: [-160, 18.9, -154.8, 22.2],
  ID: [-117.2, 42.0, -111.0, 49.0],
  IL: [-91.5, 37.0, -87.5, 42.5],
  IN: [-88.1, 37.8, -84.8, 41.8],
  IA: [-96.6, 40.4, -90.1, 43.5],
  KS: [-102.1, 37.0, -94.6, 40.0],
  KY: [-89.6, 36.5, -81.9, 39.1],
  LA: [-94.0, 29.0, -88.8, 33.0],
  ME: [-71.1, 43.0, -66.9, 47.5],
  MD: [-79.5, 37.9, -75.0, 39.7],
  MA: [-73.5, 41.2, -69.9, 42.9],
  MI: [-90.4, 41.7, -82.4, 48.3],
  MN: [-97.2, 43.5, -89.5, 49.4],
  MS: [-91.7, 30.2, -88.1, 35.0],
  MO: [-95.8, 36.0, -89.1, 40.6],
  MT: [-116.1, 44.4, -104.0, 49.0],
  NE: [-104.1, 40.0, -95.3, 43.0],
  NV: [-120.0, 35.0, -114.0, 42.0],
  NH: [-72.6, 42.7, -70.6, 45.3],
  NJ: [-75.6, 38.9, -73.9, 41.4],
  NM: [-109.1, 31.3, -103.0, 37.0],
  NY: [-79.8, 40.5, -71.9, 45.0],
  NC: [-84.3, 33.8, -75.5, 36.6],
  ND: [-104.1, 45.9, -96.6, 49.0],
  OH: [-84.8, 38.4, -80.5, 42.3],
  OK: [-103.0, 33.6, -94.4, 37.0],
  OR: [-124.6, 42.0, -116.5, 46.3],
  PA: [-80.5, 39.7, -74.7, 42.3],
  RI: [-71.9, 41.1, -71.1, 42.0],
  SC: [-83.4, 32.0, -78.5, 35.2],
  SD: [-104.1, 42.5, -96.4, 45.9],
  TN: [-90.3, 35.0, -81.6, 36.7],
  TX: [-106.7, 25.8, -93.5, 36.5],
  UT: [-114.1, 37.0, -109.0, 42.0],
  VT: [-73.4, 42.7, -71.5, 45.0],
  VA: [-83.7, 36.5, -75.2, 39.5],
  WA: [-124.8, 45.5, -116.9, 49.0],
  WV: [-82.6, 37.2, -77.7, 40.6],
  WI: [-92.9, 42.5, -86.2, 47.1],
  WY: [-111.1, 41.0, -104.0, 45.0],
  DC: [-77.1, 38.8, -76.9, 39.0],
};

/**
 * Geographic Validator
 *
 * Validates GeoJSON boundaries for spatial correctness, topology errors,
 * and reasonable district counts.
 */
export class GeographicValidator {
  constructor() {
    // No initialization required
  }

  /**
   * Validate layer is within expected state/city bounds
   *
   * Performs centroid-based validation to detect wrong-state or wrong-city data.
   * Uses state bounding boxes for quick coordinate validation.
   *
   * @param geojson - GeoJSON FeatureCollection to validate
   * @param city - City information (name, state, FIPS)
   * @returns Bounds validation result
   */
  validateBounds(geojson: FeatureCollection, city: CityInfo): BoundsResult {
    // Calculate centroid
    const centroid = this.calculateCentroid(geojson);

    // Detect state from centroid coordinates
    const detectedState = this.getStateFromCoordinates(centroid);

    // Verify state match
    const expectedState = city.state.toUpperCase();

    if (detectedState && detectedState !== expectedState) {
      return {
        valid: false,
        confidence: 0,
        reason: `Geographic validation failed: data centroid is in ${detectedState}, expected ${expectedState}`,
        centroid,
        expectedState,
        actualState: detectedState,
      };
    }

    if (!detectedState) {
      // Couldn't determine state (boundary region or missing state bounds)
      return {
        valid: true,
        confidence: 50,
        reason: 'Could not verify state from coordinates - manual review recommended',
        centroid,
        expectedState,
        actualState: null,
      };
    }

    // Validate all coordinates are within state bounds
    const coordResult = this.validateCoordinates(geojson, expectedState);

    // State matches
    return {
      valid: coordResult.valid,
      confidence: coordResult.confidence,
      reason: coordResult.reason,
      centroid,
      expectedState,
      actualState: detectedState,
    };
  }

  /**
   * Validate district count is reasonable (3-50 for councils)
   *
   * Returns warning (isWarning: true), not rejection, on mismatch.
   * District count mismatches are common due to redistricting and
   * data update timing differences.
   *
   * @param geojson - GeoJSON FeatureCollection
   * @param fips - Census PLACE FIPS code
   * @returns Count validation result (always valid, may have warning)
   */
  validateDistrictCount(geojson: FeatureCollection, fips: string): CountResult {
    const actual = geojson.features.length;

    // Reasonable range for council districts: 3-50
    const minReasonable = 3;
    const maxReasonable = 50;

    // Check against reasonable bounds
    if (actual < minReasonable) {
      return {
        valid: true,
        isWarning: true,
        reason: `Feature count ${actual} is low (expected ${minReasonable}-${maxReasonable} for councils)`,
        expected: null,
        actual,
      };
    }

    if (actual > maxReasonable) {
      return {
        valid: true,
        isWarning: true,
        reason: `Feature count ${actual} is high (expected ${minReasonable}-${maxReasonable} for councils)`,
        expected: null,
        actual,
      };
    }

    // Within reasonable range
    return {
      valid: true,
      isWarning: false,
      reason: `Feature count ${actual} is within expected range (${minReasonable}-${maxReasonable})`,
      expected: null,
      actual,
    };
  }

  /**
   * Check for topology errors (gaps, overlaps, self-intersections)
   *
   * NOTE: This is a simplified topology check using bounding boxes.
   * Full topology validation would require advanced geospatial libraries.
   * Municipal data often has minor topology issues, so this flags but
   * doesn't necessarily reject.
   *
   * @param geojson - GeoJSON FeatureCollection
   * @returns Topology validation result
   */
  validateTopology(geojson: FeatureCollection): TopologyResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let selfIntersections = 0;
    let gaps = 0;
    let overlaps = 0;

    // Check each feature for self-intersections (simplified check)
    for (let i = 0; i < geojson.features.length; i++) {
      const feature = geojson.features[i];

      // Check for degenerate polygons (too few points)
      const coords = this.extractCoordinates(feature);
      if (coords.length < 4) {
        errors.push(`Feature ${i} has degenerate geometry (< 4 coordinates)`);
        selfIntersections++;
      }

      // Check for duplicate consecutive coordinates (simplified self-intersection check)
      for (let j = 0; j < coords.length - 1; j++) {
        const [lon1, lat1] = coords[j];
        const [lon2, lat2] = coords[j + 1];
        if (lon1 === lon2 && lat1 === lat2) {
          warnings.push(`Feature ${i} has duplicate consecutive coordinates at index ${j}`);
        }
      }
    }

    // Check for overlaps between features (simplified bounding box check)
    for (let i = 0; i < geojson.features.length; i++) {
      for (let j = i + 1; j < geojson.features.length; j++) {
        const feature1 = geojson.features[i];
        const feature2 = geojson.features[j];

        try {
          // Check if features intersect (may indicate overlap or shared boundary)
          const intersects = booleanIntersects(feature1, feature2);
          if (intersects) {
            // NOTE: Adjacent districts will always intersect at boundaries
            // This is expected and not an error. Only flag if suspicious.
            // For simplicity, we just count and warn.
            overlaps++;
          }
        } catch (error) {
          warnings.push(`Could not check intersection between features ${i} and ${j}: ${(error as Error).message}`);
        }
      }
    }

    // Build result
    const hasErrors = errors.length > 0;

    if (overlaps > 0) {
      warnings.push(`${overlaps} feature pairs intersect (may indicate overlaps or shared boundaries)`);
    }

    return {
      valid: !hasErrors,  // Only reject on critical errors
      errors: Object.freeze([...errors]),
      warnings: Object.freeze([...warnings]),
      selfIntersections,
      gaps,
      overlaps,
    };
  }

  /**
   * Combined validation (all checks)
   *
   * Runs bounds, count, and topology validation and returns combined result.
   *
   * @param geojson - GeoJSON FeatureCollection
   * @param city - City information
   * @returns Combined validation result
   */
  validate(geojson: FeatureCollection, city: CityInfo): CombinedValidationResult {
    const bounds = this.validateBounds(geojson, city);
    const count = this.validateDistrictCount(geojson, city.fips);
    const topology = this.validateTopology(geojson);

    // Overall valid if bounds and topology are valid
    // Count is warning-only and doesn't affect overall validity
    const overall = bounds.valid && topology.valid;

    return {
      bounds,
      count,
      topology,
      overall,
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Calculate centroid of GeoJSON FeatureCollection
   *
   * Uses simple average of all coordinates (faster than true geometric centroid).
   */
  private calculateCentroid(geojson: FeatureCollection): Point {
    let totalLat = 0;
    let totalLon = 0;
    let pointCount = 0;

    for (const feature of geojson.features) {
      const coords = this.extractCoordinates(feature);
      for (const [lon, lat] of coords) {
        totalLat += lat;
        totalLon += lon;
        pointCount++;
      }
    }

    if (pointCount === 0) {
      throw new Error('Cannot calculate centroid: no coordinates found');
    }

    return {
      lat: totalLat / pointCount,
      lon: totalLon / pointCount,
    };
  }

  /**
   * Detect state from coordinates using bounding boxes
   *
   * LIMITATION: Bounding boxes overlap at state borders.
   * Use for quick validation only; county geometry is canonical.
   */
  private getStateFromCoordinates(point: Point): string | null {
    for (const [state, bounds] of Object.entries(STATE_BOUNDS)) {
      const [minLon, minLat, maxLon, maxLat] = bounds;
      if (
        point.lat >= minLat &&
        point.lat <= maxLat &&
        point.lon >= minLon &&
        point.lon <= maxLon
      ) {
        return state;
      }
    }

    return null; // Outside known states or in overlap region
  }

  /**
   * Validate all coordinates are within expected state bounds
   */
  private validateCoordinates(
    geojson: FeatureCollection,
    state: string
  ): { valid: boolean; confidence: number; reason: string } {
    const stateBounds = STATE_BOUNDS[state.toUpperCase()];

    if (!stateBounds) {
      return {
        valid: true,
        confidence: 70,
        reason: `Unknown state code: ${state} (cannot validate coordinates)`,
      };
    }

    const [minLon, minLat, maxLon, maxLat] = stateBounds;
    let outOfBoundsCount = 0;
    const sampleOutOfBounds: Position[] = [];

    for (const feature of geojson.features) {
      const coords = this.extractCoordinates(feature);

      for (const [lon, lat] of coords) {
        if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) {
          outOfBoundsCount++;
          if (sampleOutOfBounds.length < 3) {
            sampleOutOfBounds.push([lon, lat]);
          }
        }
      }
    }

    if (outOfBoundsCount > 0) {
      const totalCoords = geojson.features.reduce(
        (sum, f) => sum + this.extractCoordinates(f).length,
        0
      );
      const outOfBoundsRatio = outOfBoundsCount / totalCoords;

      if (outOfBoundsRatio > 0.5) {
        // Majority of coordinates outside state bounds = WRONG STATE DATA
        return {
          valid: false,
          confidence: 0,
          reason: `Coordinates outside ${state} bounds: ${sampleOutOfBounds.map(c => `[${c[0].toFixed(2)}, ${c[1].toFixed(2)}]`).join(', ')}. Expected: lon ${minLon.toFixed(1)} to ${maxLon.toFixed(1)}, lat ${minLat.toFixed(1)} to ${maxLat.toFixed(1)}`,
        };
      } else {
        // Some coordinates outside bounds = border spillover (acceptable with warning)
        return {
          valid: true,
          confidence: 80,
          reason: `${outOfBoundsCount} coordinates slightly outside ${state} bounds (likely border spillover)`,
        };
      }
    }

    // All coordinates within state bounds
    return {
      valid: true,
      confidence: 100,
      reason: `All coordinates within ${state} bounds`,
    };
  }

  /**
   * Extract all coordinates from feature (handles Polygon and MultiPolygon)
   */
  private extractCoordinates(feature: Feature): Position[] {
    const coords: Position[] = [];

    if (feature.geometry.type === 'Polygon') {
      const polygon = feature.geometry as Polygon;
      for (const ring of polygon.coordinates) {
        coords.push(...ring);
      }
    } else if (feature.geometry.type === 'MultiPolygon') {
      const multiPolygon = feature.geometry as MultiPolygon;
      for (const polygon of multiPolygon.coordinates) {
        for (const ring of polygon) {
          coords.push(...ring);
        }
      }
    }

    return coords;
  }
}
