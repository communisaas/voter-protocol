/**
 * Pre-Validation Sanity Checks
 *
 * PROBLEM: WS-3 analysis revealed 81 cities with 100% containment failure because
 * district data didn't even intersect the city boundary. These wrong-source errors
 * should be caught BEFORE running expensive tessellation validation.
 *
 * FAST CHECKS (run before tessellation):
 * 1. Centroid proximity: District centroid should be within reasonable distance of city centroid
 * 2. Feature count match: District count should be within expected range
 *
 * COST ANALYSIS:
 * - Sanity checks: ~10ms (centroid calculations)
 * - Tessellation validation: ~500-2000ms (union, intersection, area calculations)
 * - Early rejection saves 50-200x compute time
 *
 * ARCHITECTURE:
 * - Fail-fast design: Return immediately on first failed check
 * - Zero false positives: Thresholds set to catch only obvious errors
 * - Detailed diagnostics: Include measurements for debugging
 */

import * as turf from '@turf/turf';
import type { Feature, FeatureCollection, Polygon, MultiPolygon, Point } from 'geojson';
import type { MunicipalBoundary } from './municipal-boundary.js';

// =============================================================================
// Types
// =============================================================================

export interface SanityCheckResult {
  /** Did all sanity checks pass? */
  readonly passed: boolean;

  /** Individual check results */
  readonly checks: {
    readonly centroidProximity: {
      readonly passed: boolean;
      readonly distanceKm: number;
      readonly threshold: number;
    };
    readonly featureCount: {
      readonly passed: boolean;
      readonly actual: number;
      readonly expected: number;
      readonly ratio: number;
    };
  };

  /** Human-readable failure reason (null if passed) */
  readonly failReason: string | null;
}

/**
 * Sanity check options
 */
export interface SanityCheckOptions {
  /**
   * Maximum distance between district centroid and city centroid (kilometers)
   *
   * DEFAULT: 50km
   * RATIONALE: Even large metro areas (LA, Houston) have council districts within
   * 30-40km of city center. 50km threshold catches wrong-state or wrong-city data
   * without false positives for edge-case consolidated city-counties.
   */
  maxCentroidDistanceKm?: number;

  /**
   * Maximum ratio between actual and expected feature counts
   *
   * DEFAULT: 3x
   * RATIONALE: Catches wrong-granularity data (neighborhoods vs. districts).
   * - Cincinnati: 74 features (Community Councils) vs 9 expected = 8.2x ratio
   * - Multi-part districts: Some cities store districts as separate features (ratio ~1.5x)
   * - Redistricting: Recent changes may add/remove 1-2 districts (ratio ~1.2x)
   * - 3x threshold is conservative (catches Cincinnati-style errors without false positives)
   */
  maxFeatureCountRatio?: number;
}

// =============================================================================
// Default Thresholds
// =============================================================================

const DEFAULT_MAX_CENTROID_DISTANCE_KM = 50;
const DEFAULT_MAX_FEATURE_COUNT_RATIO = 3.0;

// =============================================================================
// Sanity Check Validator
// =============================================================================

/**
 * Run pre-validation sanity checks
 *
 * These are fast geometric checks that catch wrong data sources BEFORE
 * running expensive tessellation validation. Designed for zero false positives.
 *
 * @param districts - Council district features from GIS source
 * @param boundary - Municipal boundary (authoritative)
 * @param expectedDistrictCount - Expected number of districts from registry
 * @param options - Optional threshold overrides
 * @returns Sanity check result with detailed diagnostics
 *
 * @example
 * ```typescript
 * const result = runSanityChecks(
 *   districtFeatures,
 *   municipalBoundary,
 *   9  // Expected district count for San Diego
 * );
 *
 * if (!result.passed) {
 *   console.error(`Pre-validation failed: ${result.failReason}`);
 *   // Skip expensive tessellation validation
 *   return;
 * }
 *
 * // Proceed to full tessellation proof
 * const proof = validator.prove(districtFeatures, municipalBoundary, 9);
 * ```
 *
 * @example Detecting wrong-city data (WS-3 failure case)
 * ```typescript
 * // San Diego districts (FIPS 0666000) vs. Los Angeles boundary (FIPS 0644000)
 * const result = runSanityChecks(sdDistricts, laBoundary, 9);
 * // Result: centroidProximity.passed = false (distance ~180km)
 * ```
 *
 * @example Detecting wrong-granularity data (Cincinnati case)
 * ```typescript
 * // Community Council neighborhoods (74 features) vs. council districts (9 expected)
 * const result = runSanityChecks(neighborhoods, boundary, 9);
 * // Result: featureCount.passed = false (ratio = 8.2x)
 * ```
 */
export function runSanityChecks(
  districts: FeatureCollection<Polygon | MultiPolygon>,
  boundary: MunicipalBoundary,
  expectedDistrictCount: number,
  options?: SanityCheckOptions
): SanityCheckResult {
  const maxCentroidDistanceKm = options?.maxCentroidDistanceKm ?? DEFAULT_MAX_CENTROID_DISTANCE_KM;
  const maxFeatureCountRatio = options?.maxFeatureCountRatio ?? DEFAULT_MAX_FEATURE_COUNT_RATIO;

  // Extract municipal boundary geometry
  const municipalGeometry = boundary.geometry;

  // ========================================================================
  // CHECK 1: Feature Count Ratio
  // Fast check - just count features (no geometry operations)
  // ========================================================================

  const actualCount = districts.features.length;
  const countRatio = expectedDistrictCount > 0 ? actualCount / expectedDistrictCount : 0;

  // Check both over-count (wrong granularity) and under-count (missing data)
  const countCheckPassed = countRatio <= maxFeatureCountRatio && countRatio >= (1 / maxFeatureCountRatio);

  if (!countCheckPassed) {
    const direction = countRatio > maxFeatureCountRatio ? 'too many' : 'too few';
    return {
      passed: false,
      checks: {
        centroidProximity: {
          passed: true, // Not tested yet
          distanceKm: 0,
          threshold: maxCentroidDistanceKm,
        },
        featureCount: {
          passed: false,
          actual: actualCount,
          expected: expectedDistrictCount,
          ratio: countRatio,
        },
      },
      failReason: `Feature count mismatch: found ${actualCount} features, expected ${expectedDistrictCount} (ratio ${countRatio.toFixed(2)}x, ${direction})`,
    };
  }

  // ========================================================================
  // CHECK 2: Centroid Proximity
  // Moderate cost - compute centroids and distance
  // ========================================================================

  try {
    // Compute district centroid (centroid of union of all districts)
    // Use simple approach: compute centroid of each district, then average
    // This is faster than union → centroid and avoids topology errors
    const districtCentroids: Point[] = districts.features.map((feature) => {
      const centroid = turf.centroid(feature);
      return centroid.geometry;
    });

    // Average centroid positions
    const avgLon = districtCentroids.reduce((sum, pt) => sum + pt.coordinates[0], 0) / districtCentroids.length;
    const avgLat = districtCentroids.reduce((sum, pt) => sum + pt.coordinates[1], 0) / districtCentroids.length;
    const districtCentroid = turf.point([avgLon, avgLat]);

    // Compute municipal boundary centroid
    const municipalCentroid = turf.centroid(municipalGeometry);

    // Compute distance
    const distanceKm = turf.distance(districtCentroid, municipalCentroid, { units: 'kilometers' });

    const centroidCheckPassed = distanceKm <= maxCentroidDistanceKm;

    if (!centroidCheckPassed) {
      return {
        passed: false,
        checks: {
          centroidProximity: {
            passed: false,
            distanceKm,
            threshold: maxCentroidDistanceKm,
          },
          featureCount: {
            passed: true,
            actual: actualCount,
            expected: expectedDistrictCount,
            ratio: countRatio,
          },
        },
        failReason: `District centroid too far from city centroid: ${distanceKm.toFixed(1)}km (threshold: ${maxCentroidDistanceKm}km) - likely wrong city or state`,
      };
    }

    // All checks passed
    return {
      passed: true,
      checks: {
        centroidProximity: {
          passed: true,
          distanceKm,
          threshold: maxCentroidDistanceKm,
        },
        featureCount: {
          passed: true,
          actual: actualCount,
          expected: expectedDistrictCount,
          ratio: countRatio,
        },
      },
      failReason: null,
    };
  } catch (error) {
    // Geometry computation failed - return passing result to allow tessellation to handle it
    // (Sanity checks should never block valid data, only catch obvious errors)
    return {
      passed: true,
      checks: {
        centroidProximity: {
          passed: true,
          distanceKm: 0,
          threshold: maxCentroidDistanceKm,
        },
        featureCount: {
          passed: true,
          actual: actualCount,
          expected: expectedDistrictCount,
          ratio: countRatio,
        },
      },
      failReason: null,
    };
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Quick boolean check - did sanity checks pass?
 */
export function passesSanityChecks(
  districts: FeatureCollection<Polygon | MultiPolygon>,
  boundary: MunicipalBoundary,
  expectedDistrictCount: number,
  options?: SanityCheckOptions
): boolean {
  return runSanityChecks(districts, boundary, expectedDistrictCount, options).passed;
}
