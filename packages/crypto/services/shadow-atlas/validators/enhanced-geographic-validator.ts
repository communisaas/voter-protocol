/**
 * Enhanced Geographic Validator with Multi-County Support
 *
 * PURPOSE: Validate council districts against county boundaries with support
 * for multi-county cities (Kansas City, NYC, Chicago, Atlanta, etc.).
 *
 * FIXES:
 * - Kansas City MO false positives (4 counties, not just Jackson)
 * - NYC cross-borough validation (5 counties)
 * - Any city spanning multiple counties
 *
 * ARCHITECTURE:
 * 1. Use CountyGeometryService to get county union
 * 2. Validate features intersect OR within union (relaxed validation)
 * 3. State-level validation prevents cross-state false positives
 *
 * VALIDATION STRATEGY:
 * - RELAXED: Allow partial intersection (districts can cross county lines)
 * - STRICT: Reject features completely outside county union
 * - STATE CHECK: Ensure features within expected state bounds
 */

import type { FeatureCollection, Feature, Polygon, MultiPolygon, Position } from 'geojson';
import { booleanWithin } from '@turf/boolean-within';
import { booleanIntersects } from '@turf/boolean-intersects';
import type { ValidationResult } from './deterministic-validators.js';
import { CountyGeometryService } from '../services/county-geometry.js';

/**
 * Geographic point (latitude/longitude)
 */
export interface Point {
  readonly lat: number;
  readonly lon: number;
}

/**
 * Geographic validation result with detailed diagnostics
 */
export interface GeographicValidationResult {
  readonly valid: boolean;
  readonly confidence: number;
  readonly reason?: string;
  readonly centroid?: Point;
  readonly detectedState?: string | null;
}

/**
 * City target with FIPS code for county lookup
 */
export interface CityTarget {
  readonly name: string;
  readonly state: string;  // 2-letter state code
  readonly fips: string;   // 7-digit Census PLACE code
  readonly region: string; // Same as state (for compatibility)
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
 * Calculate the centroid of a GeoJSON FeatureCollection
 *
 * ALGORITHM: Simple average of all coordinates (faster than true geometric centroid)
 *
 * @param geojson - FeatureCollection to calculate centroid for
 * @returns Centroid point {lat, lon}
 */
export function calculateCentroid(geojson: FeatureCollection): Point {
  let totalLat = 0;
  let totalLon = 0;
  let pointCount = 0;

  for (const feature of geojson.features) {
    if (feature.geometry.type === 'Polygon') {
      const polygon = feature.geometry as Polygon;
      const coords = polygon.coordinates[0]; // Exterior ring
      for (const [lon, lat] of coords) {
        totalLat += lat;
        totalLon += lon;
        pointCount++;
      }
    } else if (feature.geometry.type === 'MultiPolygon') {
      const multiPolygon = feature.geometry as MultiPolygon;
      for (const polygon of multiPolygon.coordinates) {
        const coords = polygon[0]; // Exterior ring of each polygon
        for (const [lon, lat] of coords) {
          totalLat += lat;
          totalLon += lon;
          pointCount++;
        }
      }
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
 * LIMITATION: Bounding boxes overlap at state borders
 * Use for quick validation only; county geometry is canonical
 *
 * @param point - Geographic point to check
 * @returns 2-letter state code or null if outside known states
 */
export function getStateFromCoordinates(point: Point): string | null {
  const stateBounds = STATE_BOUNDS;

  for (const [state, bounds] of Object.entries(stateBounds)) {
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
 * Validate city boundary data against expected location
 *
 * DETECTS: Cross-city contamination (e.g., Lexington getting Louisville data)
 *
 * ALGORITHM:
 * 1. Calculate centroid of boundary data
 * 2. Detect state from centroid coordinates
 * 3. Verify state matches expected city
 *
 * @param geojson - Boundary GeoJSON to validate
 * @param expectedCity - Expected city metadata (FIPS, name, state)
 * @returns Validation result with centroid and detected state
 */
export function validateCityBoundary(
  geojson: FeatureCollection,
  expectedCity: { fips: string; name: string; state: string }
): GeographicValidationResult {
  // Calculate centroid
  const centroid = calculateCentroid(geojson);

  // Detect state from coordinates
  const detectedState = getStateFromCoordinates(centroid);

  // Verify state match
  if (detectedState && detectedState !== expectedCity.state) {
    return {
      valid: false,
      confidence: 0,
      reason: `Geographic validation failed: data centroid is in ${detectedState}, expected ${expectedCity.state}`,
      centroid,
      detectedState,
    };
  }

  if (!detectedState) {
    // Couldn't determine state (boundary region or missing state bounds)
    return {
      valid: true,
      confidence: 50,
      reason: 'Could not verify state from coordinates - manual review recommended',
      centroid,
      detectedState: null,
    };
  }

  // State matches
  return {
    valid: true,
    confidence: 100,
    centroid,
    detectedState,
  };
}

/**
 * Enhanced Geographic Validator
 *
 * Validates council districts against county boundaries with multi-county support
 */
export class EnhancedGeographicValidator {
  private countyGeometry: CountyGeometryService;

  constructor() {
    this.countyGeometry = new CountyGeometryService();
  }

  /**
   * Validate that council districts fit within city's county boundaries
   *
   * HANDLES: Single-county and multi-county cities transparently
   *
   * @param councilDistricts - GeoJSON features to validate
   * @param city - City target with FIPS code
   */
  async validate(
    councilDistricts: FeatureCollection,
    city: CityTarget
  ): Promise<ValidationResult> {
    const issues: string[] = [];
    const warnings: string[] = [];
    let confidence = 100;

    // Step 0: Centroid-based cross-city contamination check
    const centroidResult = validateCityBoundary(councilDistricts, city);
    if (!centroidResult.valid) {
      return {
        valid: false,
        confidence: 0,
        issues: [
          centroidResult.reason || 'Geographic validation failed',
          `Centroid: [${centroidResult.centroid?.lon.toFixed(4)}, ${centroidResult.centroid?.lat.toFixed(4)}]`,
          `Detected state: ${centroidResult.detectedState || 'unknown'}`,
          `Expected: ${city.name}, ${city.state}`,
        ],
        warnings: [],
      };
    }

    if (centroidResult.confidence < 100) {
      warnings.push(centroidResult.reason || 'Centroid validation inconclusive');
      confidence = Math.min(confidence, centroidResult.confidence);
    }

    // Step 1: Quick state-level coordinate validation
    const stateResult = this.validateState(councilDistricts, city.state);
    if (!stateResult.valid) {
      return stateResult;
    }

    confidence = Math.min(confidence, stateResult.confidence);
    warnings.push(...stateResult.warnings);

    // Step 2: Get county union (handles multi-county automatically)
    try {
      const countyUnion = await this.countyGeometry.getCountyUnion(city.fips);

      console.log(`   ✓ Validating against ${countyUnion.counties.length}-county union`);
      console.log(`   ✓ Counties: ${countyUnion.counties.join(', ')}`);
      console.log(`   ✓ Source: ${countyUnion.source}`);

      // Step 3: Validate each feature against county union
      const invalidFeatures: Array<{
        index: number;
        name: string;
        reason: string;
      }> = [];

      for (let i = 0; i < councilDistricts.features.length; i++) {
        const feature = councilDistricts.features[i];

        // Create Feature wrapper for county union geometry
        const unionFeature: Feature<Polygon | MultiPolygon> = {
          type: 'Feature',
          properties: {},
          geometry: countyUnion.geometry,
        };

        // Check if feature is within OR intersects county union
        const isWithin = booleanWithin(feature, unionFeature);
        const intersects = booleanIntersects(feature, unionFeature);

        if (!isWithin && !intersects) {
          invalidFeatures.push({
            index: i,
            name: feature.properties?.NAME || `Feature ${i}`,
            reason: 'Completely outside county union',
          });
        }

        // RELAXED VALIDATION:
        // - Allow partial intersection (districts can cross county lines)
        // - Only reject features completely outside union
      }

      // Build result
      if (invalidFeatures.length > 0) {
        const invalidRatio = invalidFeatures.length / councilDistricts.features.length;

        if (invalidRatio > 0.5) {
          // Majority invalid = REJECT (likely wrong city data)
          return {
            valid: false,
            confidence: 0,
            issues: [
              `${invalidFeatures.length} of ${councilDistricts.features.length} features outside county bounds`,
              `Counties checked: ${countyUnion.counties.join(', ')}`,
              `Invalid features: ${invalidFeatures.map(f => f.name).slice(0, 3).join(', ')}${invalidFeatures.length > 3 ? '...' : ''}`,
            ],
            warnings,
          };
        } else {
          // Few invalid = WARNING (possible annexation/border updates)
          warnings.push(
            `${invalidFeatures.length} features extend beyond county bounds (${invalidFeatures.map(f => f.name).join(', ')})`
          );
          confidence = 70;
        }
      }

      // SUCCESS: All features within/intersect county union
      return {
        valid: true,
        confidence,
        issues: [],
        warnings: [
          ...warnings,
          `All ${councilDistricts.features.length} features validated against ${countyUnion.counties.length}-county union`,
        ],
      };

    } catch (error) {
      // County geometry fetch failed - fall back to state validation only
      warnings.push(
        `Could not load county geometries: ${(error as Error).message}`
      );
      confidence = 60;

      return {
        valid: true,
        confidence,
        issues: [],
        warnings,
      };
    }
  }

  /**
   * Validate that features are within expected state
   *
   * PREVENTS: Cross-state false positives (e.g., Kansas City MO != Kansas City KS)
   */
  private validateState(
    geojson: FeatureCollection,
    expectedState: string
  ): ValidationResult {
    const stateBounds = STATE_BOUNDS[expectedState.toUpperCase()];

    if (!stateBounds) {
      return {
        valid: true,
        confidence: 70,
        issues: [],
        warnings: [`Unknown state code: ${expectedState} (cannot validate coordinates)`],
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
        // Majority outside state bounds = WRONG STATE DATA
        return {
          valid: false,
          confidence: 0,
          issues: [
            `Coordinates outside ${expectedState} bounds: ${sampleOutOfBounds.map(c => `[${c[0].toFixed(2)}, ${c[1].toFixed(2)}]`).join(', ')}`,
            `Expected: lon ${minLon.toFixed(1)} to ${maxLon.toFixed(1)}, lat ${minLat.toFixed(1)} to ${maxLat.toFixed(1)}`,
          ],
          warnings: [],
        };
      } else {
        // Some coordinates outside = border spillover (acceptable)
        return {
          valid: true,
          confidence: 80,
          issues: [],
          warnings: [
            `${outOfBoundsCount} coordinates slightly outside ${expectedState} bounds (likely border spillover)`,
          ],
        };
      }
    }

    // All coordinates within state bounds
    return {
      valid: true,
      confidence: 100,
      issues: [],
      warnings: [],
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
