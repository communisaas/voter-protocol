/**
 * Pre-Validation Sanity Checks - Unit Tests
 *
 * Test fast geometric checks that catch wrong data sources before
 * expensive tessellation validation.
 */

import { describe, it, expect } from 'vitest';
import * as turf from '@turf/turf';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { runSanityChecks, passesSanityChecks } from '../../../validators/council/pre-validation-sanity.js';
import type { MunicipalBoundary } from '../../../validators/council/municipal-boundary.js';

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a simple rectangular polygon centered at given coordinates
 */
function createRectangle(
  centerLon: number,
  centerLat: number,
  widthKm: number,
  heightKm: number
): Polygon {
  // Convert km to approximate degrees (rough approximation for testing)
  const widthDeg = widthKm / 111.32; // 1 degree longitude ≈ 111.32 km at equator
  const heightDeg = heightKm / 110.574; // 1 degree latitude ≈ 110.574 km

  const halfWidth = widthDeg / 2;
  const halfHeight = heightDeg / 2;

  return {
    type: 'Polygon',
    coordinates: [[
      [centerLon - halfWidth, centerLat - halfHeight],
      [centerLon + halfWidth, centerLat - halfHeight],
      [centerLon + halfWidth, centerLat + halfHeight],
      [centerLon - halfWidth, centerLat + halfHeight],
      [centerLon - halfWidth, centerLat - halfHeight],
    ]],
  };
}

/**
 * Create a mock municipal boundary
 */
function createMockBoundary(
  fips: string,
  centerLon: number,
  centerLat: number,
  widthKm: number = 10,
  heightKm: number = 10
): MunicipalBoundary {
  const polygon = createRectangle(centerLon, centerLat, widthKm, heightKm);
  const area = turf.area(turf.polygon(polygon.coordinates));

  return {
    fips,
    name: 'Test City',
    stateFips: '06',
    stateAbbr: 'CA',
    geometry: turf.feature(polygon),
    areaSqM: area,
    landAreaSqM: area,
    waterAreaSqM: 0,
    vintage: 2024,
    retrievedAt: new Date().toISOString(),
  };
}

/**
 * Create a feature collection of districts
 */
function createDistricts(
  count: number,
  centerLon: number,
  centerLat: number,
  spreadKm: number = 5
): FeatureCollection<Polygon | MultiPolygon> {
  const features = [];

  for (let i = 0; i < count; i++) {
    // Distribute districts around center point
    const angle = (i / count) * 2 * Math.PI;
    const offsetLon = (spreadKm / 111.32) * Math.cos(angle);
    const offsetLat = (spreadKm / 110.574) * Math.sin(angle);

    const polygon = createRectangle(
      centerLon + offsetLon,
      centerLat + offsetLat,
      2, // 2km width
      2  // 2km height
    );

    features.push(turf.feature(polygon, { districtId: i + 1 }));
  }

  return turf.featureCollection(features);
}

// =============================================================================
// Test Suites
// =============================================================================

describe('Pre-Validation Sanity Checks', () => {
  // ===========================================================================
  // PASSING CASES - All checks should pass
  // ===========================================================================

  describe('Passing Cases', () => {
    it('should pass for correct district data (exact count match)', () => {
      const boundary = createMockBoundary('0666000', -117.1611, 32.7157); // San Diego coords
      const districts = createDistricts(9, -117.1611, 32.7157); // 9 districts

      const result = runSanityChecks(districts, boundary, 9);

      expect(result.passed).toBe(true);
      expect(result.failReason).toBeNull();
      expect(result.checks.centroidProximity.passed).toBe(true);
      expect(result.checks.featureCount.passed).toBe(true);
      expect(result.checks.featureCount.ratio).toBe(1.0);
    });

    it('should pass for multi-part districts (count within tolerance)', () => {
      const boundary = createMockBoundary('0675000', -121.2907, 37.9577); // Stockton coords
      const districts = createDistricts(8, -121.2907, 37.9577); // 8 features, 6 expected

      const result = runSanityChecks(districts, boundary, 6);

      expect(result.passed).toBe(true);
      expect(result.checks.featureCount.ratio).toBeCloseTo(1.33, 2); // 8/6 = 1.33x
      expect(result.checks.featureCount.passed).toBe(true); // Within 3x threshold
    });

    it('should pass for districts slightly offset from boundary center', () => {
      const boundary = createMockBoundary('0644000', -118.2437, 34.0522); // LA coords
      // Districts offset 10km east (still well within 50km threshold)
      const districts = createDistricts(15, -118.1537, 34.0522, 8);

      const result = runSanityChecks(districts, boundary, 15);

      expect(result.passed).toBe(true);
      expect(result.checks.centroidProximity.distanceKm).toBeLessThan(20);
      expect(result.checks.centroidProximity.passed).toBe(true);
    });

    it('should pass for recent redistricting (±2 district variation)', () => {
      const boundary = createMockBoundary('4159000', -122.6765, 45.5231); // Portland coords
      const districts = createDistricts(4, -122.6765, 45.5231); // 4 districts (new 2024 system)

      const result = runSanityChecks(districts, boundary, 5); // Expected 5, got 4

      expect(result.passed).toBe(true);
      expect(result.checks.featureCount.ratio).toBeCloseTo(0.8, 2); // 4/5 = 0.8x
      expect(result.checks.featureCount.passed).toBe(true); // Within 1/3x to 3x range
    });
  });

  // ===========================================================================
  // FAILING CASES - Feature Count
  // ===========================================================================

  describe('Feature Count Failures', () => {
    it('should fail for wrong-granularity data (Cincinnati case)', () => {
      const boundary = createMockBoundary('3915000', -84.5120, 39.1031); // Cincinnati coords
      // Community Council neighborhoods (74 features) vs. council districts (9 expected)
      const neighborhoods = createDistricts(74, -84.5120, 39.1031, 10);

      const result = runSanityChecks(neighborhoods, boundary, 9);

      expect(result.passed).toBe(false);
      expect(result.failReason).toContain('Feature count mismatch');
      expect(result.failReason).toContain('too many');
      expect(result.checks.featureCount.passed).toBe(false);
      expect(result.checks.featureCount.actual).toBe(74);
      expect(result.checks.featureCount.expected).toBe(9);
      expect(result.checks.featureCount.ratio).toBeCloseTo(8.22, 2); // 74/9 = 8.22x
    });

    it('should fail for severe under-count (missing districts)', () => {
      const boundary = createMockBoundary('3651000', -74.0060, 40.7128); // NYC coords
      const districts = createDistricts(12, -74.0060, 40.7128); // Only 12 of 51 districts

      const result = runSanityChecks(districts, boundary, 51);

      expect(result.passed).toBe(false);
      expect(result.failReason).toContain('Feature count mismatch');
      expect(result.failReason).toContain('too few');
      expect(result.checks.featureCount.passed).toBe(false);
      expect(result.checks.featureCount.ratio).toBeCloseTo(0.235, 2); // 12/51 = 0.235x
    });

    it('should fail for extreme over-count (planning districts)', () => {
      const boundary = createMockBoundary('3755000', -78.6382, 35.7796); // Raleigh coords
      // 19 planning districts vs. 5 council districts
      const planningDistricts = createDistricts(19, -78.6382, 35.7796, 8);

      const result = runSanityChecks(planningDistricts, boundary, 5);

      expect(result.passed).toBe(false);
      expect(result.checks.featureCount.ratio).toBeCloseTo(3.8, 2); // 19/5 = 3.8x
      expect(result.checks.featureCount.passed).toBe(false);
    });
  });

  // ===========================================================================
  // FAILING CASES - Centroid Proximity
  // ===========================================================================

  describe('Centroid Proximity Failures', () => {
    it('should fail for wrong-city data (cross-city contamination)', () => {
      const sdBoundary = createMockBoundary('0666000', -117.1611, 32.7157); // San Diego
      // LA districts (180km north)
      const laDistricts = createDistricts(9, -118.2437, 34.0522, 10);

      const result = runSanityChecks(laDistricts, sdBoundary, 9);

      expect(result.passed).toBe(false);
      expect(result.failReason).toContain('District centroid too far');
      expect(result.failReason).toContain('wrong city or state');
      expect(result.checks.centroidProximity.passed).toBe(false);
      expect(result.checks.centroidProximity.distanceKm).toBeGreaterThan(100);
    });

    it('should fail for wrong-state data', () => {
      const caBoundary = createMockBoundary('0644000', -118.2437, 34.0522); // LA, CA
      // Phoenix, AZ districts (600km away)
      const azDistricts = createDistricts(8, -112.0740, 33.4484, 10);

      const result = runSanityChecks(azDistricts, caBoundary, 8);

      expect(result.passed).toBe(false);
      expect(result.checks.centroidProximity.passed).toBe(false);
      expect(result.checks.centroidProximity.distanceKm).toBeGreaterThan(500);
    });

    it('should fail at exact threshold boundary', () => {
      const boundary = createMockBoundary('0666000', -117.1611, 32.7157);
      // Districts exactly 60km away (well over 50km threshold)
      // At ~33°N latitude, 1° longitude ≈ 93km, so 0.65° ≈ 60km
      const districts = createDistricts(9, -117.1611 + 0.65, 32.7157, 5);

      const result = runSanityChecks(districts, boundary, 9);

      expect(result.passed).toBe(false);
      expect(result.checks.centroidProximity.passed).toBe(false);
      expect(result.checks.centroidProximity.distanceKm).toBeGreaterThan(50);
    });
  });

  // ===========================================================================
  // CUSTOM THRESHOLDS
  // ===========================================================================

  describe('Custom Thresholds', () => {
    it('should respect custom centroid distance threshold', () => {
      const boundary = createMockBoundary('0666000', -117.1611, 32.7157);
      // Districts 60km away (at ~33°N, 0.65° longitude ≈ 60km)
      const districts = createDistricts(9, -117.1611 + 0.65, 32.7157, 5);

      // With default 50km threshold: FAIL
      const defaultResult = runSanityChecks(districts, boundary, 9);
      expect(defaultResult.passed).toBe(false);

      // With custom 100km threshold: PASS
      const customResult = runSanityChecks(districts, boundary, 9, {
        maxCentroidDistanceKm: 100,
      });
      expect(customResult.passed).toBe(true);
    });

    it('should respect custom feature count ratio threshold', () => {
      const boundary = createMockBoundary('3915000', -84.5120, 39.1031);
      const districts = createDistricts(20, -84.5120, 39.1031, 8); // 20/9 = 2.22x ratio

      // With default 3x threshold: PASS
      const defaultResult = runSanityChecks(districts, boundary, 9);
      expect(defaultResult.passed).toBe(true);

      // With custom 2x threshold: FAIL
      const customResult = runSanityChecks(districts, boundary, 9, {
        maxFeatureCountRatio: 2.0,
      });
      expect(customResult.passed).toBe(false);
      expect(customResult.checks.featureCount.passed).toBe(false);
    });
  });

  // ===========================================================================
  // EDGE CASES
  // ===========================================================================

  describe('Edge Cases', () => {
    it('should handle empty district collection', () => {
      const boundary = createMockBoundary('0666000', -117.1611, 32.7157);
      const emptyDistricts = turf.featureCollection([]);

      const result = runSanityChecks(emptyDistricts, boundary, 9);

      expect(result.passed).toBe(false);
      expect(result.checks.featureCount.passed).toBe(false);
      expect(result.checks.featureCount.actual).toBe(0);
    });

    it('should handle single-district city', () => {
      const boundary = createMockBoundary('0636770', -117.8265, 33.6846); // Irvine (at-large)
      const districts = createDistricts(1, -117.8265, 33.6846, 2);

      const result = runSanityChecks(districts, boundary, 1);

      expect(result.passed).toBe(true);
      expect(result.checks.featureCount.ratio).toBe(1.0);
    });

    it('should handle large consolidated city-county', () => {
      const boundary = createMockBoundary('1235000', -81.6557, 30.3322, 50, 50); // Jacksonville (large)
      const districts = createDistricts(14, -81.6557, 30.3322, 25); // Spread across large area

      const result = runSanityChecks(districts, boundary, 14);

      expect(result.passed).toBe(true);
      expect(result.checks.centroidProximity.distanceKm).toBeLessThan(50);
    });

    it('should handle geometry computation errors gracefully', () => {
      const boundary = createMockBoundary('0666000', -117.1611, 32.7157);
      // Create invalid geometry (self-intersecting polygon)
      const invalidFeature = turf.feature({
        type: 'Polygon',
        coordinates: [[
          [-117.16, 32.71],
          [-117.17, 32.72],
          [-117.16, 32.72], // Creates invalid geometry
          [-117.17, 32.71],
          [-117.16, 32.71],
        ]],
      } as Polygon);
      const invalidDistricts = turf.featureCollection([invalidFeature]);

      // Should not throw, should pass (allow tessellation to handle geometry errors)
      const result = runSanityChecks(invalidDistricts, boundary, 9);

      expect(result.passed).toBe(false); // Fails on count check
      expect(result.checks.featureCount.passed).toBe(false);
    });
  });

  // ===========================================================================
  // CONVENIENCE FUNCTIONS
  // ===========================================================================

  describe('Convenience Functions', () => {
    it('passesSanityChecks() should return boolean', () => {
      const boundary = createMockBoundary('0666000', -117.1611, 32.7157);
      const districts = createDistricts(9, -117.1611, 32.7157);

      const passes = passesSanityChecks(districts, boundary, 9);

      expect(passes).toBe(true);
      expect(typeof passes).toBe('boolean');
    });

    it('passesSanityChecks() should return false for failures', () => {
      const boundary = createMockBoundary('3915000', -84.5120, 39.1031);
      const neighborhoods = createDistricts(74, -84.5120, 39.1031, 10);

      const passes = passesSanityChecks(neighborhoods, boundary, 9);

      expect(passes).toBe(false);
    });
  });

  // ===========================================================================
  // DIAGNOSTIC INFORMATION
  // ===========================================================================

  describe('Diagnostic Information', () => {
    it('should provide detailed measurements on success', () => {
      const boundary = createMockBoundary('0666000', -117.1611, 32.7157);
      const districts = createDistricts(9, -117.1611, 32.7157);

      const result = runSanityChecks(districts, boundary, 9);

      expect(result.checks.centroidProximity.distanceKm).toBeGreaterThanOrEqual(0);
      expect(result.checks.centroidProximity.threshold).toBe(50);
      expect(result.checks.featureCount.actual).toBe(9);
      expect(result.checks.featureCount.expected).toBe(9);
      expect(result.checks.featureCount.ratio).toBe(1.0);
    });

    it('should provide detailed measurements on failure', () => {
      const boundary = createMockBoundary('3915000', -84.5120, 39.1031);
      const neighborhoods = createDistricts(74, -84.5120, 39.1031, 10);

      const result = runSanityChecks(neighborhoods, boundary, 9);

      expect(result.failReason).toBeTruthy();
      expect(result.failReason).toMatch(/74 features, expected 9/);
      expect(result.checks.featureCount.actual).toBe(74);
      expect(result.checks.featureCount.expected).toBe(9);
      expect(result.checks.featureCount.ratio).toBeCloseTo(8.22, 2);
    });
  });
});
