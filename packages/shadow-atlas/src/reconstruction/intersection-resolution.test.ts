/**
 * Intersection Resolution Tests
 *
 * Tests for geometric intersection finding between streets.
 * Validates the critical starting point calculation for boundary reconstruction.
 *
 * PHILOSOPHY:
 * - Intersection point is where boundary starts and must close
 * - Must handle actual crossings, endpoint meetings, and near-misses
 * - OSM data often has small gaps - snap tolerance is essential
 */

import { describe, it, expect } from 'vitest';
import type { Position } from 'geojson';
import {
  matchSegment,
  SimpleStreetNetworkQuery,
  haversineDistance,
  getDefaultMatcherConfig,
} from './segment-matcher';
import { createMockStreetSegment } from './test-utils';
import type { BoundarySegmentDescription } from './types';

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Create an intersection description for testing
 */
function createIntersectionDescription(
  street1: string,
  street2: string
): BoundarySegmentDescription {
  return {
    index: 0,
    referenceType: 'coordinate',
    featureName: `intersection:${street1}:${street2}`,
    rawText: `Beginning at the intersection of ${street1} and ${street2}`,
    parseConfidence: 'high',
  };
}

// =============================================================================
// Geometric Intersection Tests
// =============================================================================

describe('IntersectionResolution', () => {
  describe('crossing streets (actual intersection)', () => {
    it('finds intersection where streets cross perpendicularity', () => {
      // Create a perfect X intersection
      const mainStreet = createMockStreetSegment({
        id: 'main',
        name: 'Main Street',
        coordinates: [
          [-95.0, 30.0],
          [-94.99, 30.0], // East-West street
        ],
      });

      const oakAve = createMockStreetSegment({
        id: 'oak',
        name: 'Oak Avenue',
        coordinates: [
          [-94.995, 29.995], // North-South street crossing Main
          [-94.995, 30.005],
        ],
      });

      const query = new SimpleStreetNetworkQuery([mainStreet, oakAve]);
      const description = createIntersectionDescription('Main Street', 'Oak Avenue');
      const result = matchSegment(description, query, null, getDefaultMatcherConfig());

      expect(result.matchQuality).toBe('exact');
      expect(result.coordinates.length).toBe(1);

      const [lon, lat] = result.coordinates[0];
      expect(lon).toBeCloseTo(-94.995, 3);
      expect(lat).toBeCloseTo(30.0, 3);
      expect(result.diagnostics.reason).toContain('crossing');
    });

    it('finds intersection where streets cross at angle', () => {
      // Diagonal crossing
      const broadway = createMockStreetSegment({
        id: 'broadway',
        name: 'Broadway',
        coordinates: [
          [-95.0, 30.0],
          [-94.99, 30.01], // Diagonal NE
        ],
      });

      const main = createMockStreetSegment({
        id: 'main',
        name: 'Main Street',
        coordinates: [
          [-95.0, 30.01],
          [-94.99, 30.0], // Diagonal SE
        ],
      });

      const query = new SimpleStreetNetworkQuery([broadway, main]);
      const description = createIntersectionDescription('Broadway', 'Main Street');
      const result = matchSegment(description, query, null, getDefaultMatcherConfig());

      expect(result.matchQuality).toBe('exact');
      expect(result.coordinates.length).toBe(1);

      // Should find intersection near midpoint
      const [lon, lat] = result.coordinates[0];
      expect(lon).toBeCloseTo(-94.995, 2);
      expect(lat).toBeCloseTo(30.005, 2);
      expect(result.diagnostics.reason).toContain('crossing');
    });

    it('finds intersection on multi-segment streets', () => {
      // Multi-segment street that crosses another
      const curved = createMockStreetSegment({
        id: 'curved',
        name: 'Curved Road',
        coordinates: [
          [-95.0, 29.99],
          [-94.995, 30.0], // Crosses Main
          [-94.99, 30.01],
        ],
      });

      const main = createMockStreetSegment({
        id: 'main',
        name: 'Main Street',
        coordinates: [
          [-95.0, 30.0],
          [-94.99, 30.0],
        ],
      });

      const query = new SimpleStreetNetworkQuery([curved, main]);
      const description = createIntersectionDescription('Curved Road', 'Main Street');
      const result = matchSegment(description, query, null, getDefaultMatcherConfig());

      expect(result.matchQuality).toBe('exact');
      expect(result.coordinates.length).toBe(1);
      expect(result.diagnostics.reason).toContain('crossing');
    });
  });

  describe('endpoint meetings', () => {
    it('finds intersection where streets meet at vertex', () => {
      // T-intersection where Oak ends at Main
      const main = createMockStreetSegment({
        id: 'main',
        name: 'Main Street',
        coordinates: [
          [-95.0, 30.0],
          [-94.99, 30.0],
        ],
      });

      const oak = createMockStreetSegment({
        id: 'oak',
        name: 'Oak Avenue',
        coordinates: [
          [-94.995, 29.99],
          [-94.995, 30.0], // Ends exactly at Main
        ],
      });

      const query = new SimpleStreetNetworkQuery([main, oak]);
      const description = createIntersectionDescription('Main Street', 'Oak Avenue');
      const result = matchSegment(description, query, null, getDefaultMatcherConfig());

      expect(result.matchQuality).not.toBe('failed');
      expect(result.coordinates.length).toBe(1);

      const [lon, lat] = result.coordinates[0];
      expect(lon).toBeCloseTo(-94.995, 4);
      expect(lat).toBeCloseTo(30.0, 4);
    });

    it('finds intersection at shared vertex', () => {
      // Both streets share exact endpoint
      const first = createMockStreetSegment({
        id: 'first',
        name: '1st Street',
        coordinates: [
          [-95.0, 30.0],
          [-94.995, 30.0], // Shared point
        ],
      });

      const second = createMockStreetSegment({
        id: 'second',
        name: '2nd Street',
        coordinates: [
          [-94.995, 30.0], // Shared point
          [-94.99, 30.0],
        ],
      });

      const query = new SimpleStreetNetworkQuery([first, second]);
      const description = createIntersectionDescription('1st Street', '2nd Street');
      const result = matchSegment(description, query, null, getDefaultMatcherConfig());

      expect(result.matchQuality).not.toBe('failed');
      expect(result.coordinates.length).toBe(1);

      const [lon, lat] = result.coordinates[0];
      expect(lon).toBeCloseTo(-94.995, 5);
      expect(lat).toBeCloseTo(30.0, 5);
    });
  });

  describe('near-miss cases (OSM gaps)', () => {
    it('snaps to intersection when streets nearly meet within tolerance', () => {
      // Streets that should connect but have small gap in OSM data
      const main = createMockStreetSegment({
        id: 'main',
        name: 'Main Street',
        coordinates: [
          [-95.0, 30.0],
          [-94.99, 30.0],
        ],
      });

      const oak = createMockStreetSegment({
        id: 'oak',
        name: 'Oak Avenue',
        coordinates: [
          [-94.995, 29.99],
          [-94.995, 29.9995], // ~55m gap (within 100m default tolerance but not crossing)
        ],
      });

      const query = new SimpleStreetNetworkQuery([main, oak]);
      const description = createIntersectionDescription('Main Street', 'Oak Avenue');
      const result = matchSegment(description, query, null, getDefaultMatcherConfig());

      expect(result.matchQuality).not.toBe('failed');
      expect(result.coordinates.length).toBe(1);

      // Should snap to midpoint of gap
      const [lon, lat] = result.coordinates[0];
      expect(lon).toBeCloseTo(-94.995, 3);
      expect(lat).toBeCloseTo(29.99975, 4);
      // Can be either near-miss or endpoint depending on algorithm choice
      expect(['near-miss', 'endpoint']).toContain(
        result.diagnostics.reason.includes('near-miss')
          ? 'near-miss'
          : result.diagnostics.reason.includes('endpoint')
            ? 'endpoint'
            : 'unknown'
      );
    });

    it('fails when gap exceeds snap tolerance', () => {
      // Streets too far apart to snap
      const main = createMockStreetSegment({
        id: 'main',
        name: 'Main Street',
        coordinates: [
          [-95.0, 30.0],
          [-94.99, 30.0],
        ],
      });

      const distant = createMockStreetSegment({
        id: 'distant',
        name: 'Distant Avenue',
        coordinates: [
          [-94.995, 29.98], // More than 100m away
          [-94.995, 29.99],
        ],
      });

      const query = new SimpleStreetNetworkQuery([main, distant]);
      const description = createIntersectionDescription('Main Street', 'Distant Avenue');
      const result = matchSegment(description, query, null, getDefaultMatcherConfig());

      expect(result.matchQuality).toBe('failed');
      expect(result.diagnostics.reason).toContain('Could not find intersection');
    });

    it('uses custom snap tolerance', () => {
      const main = createMockStreetSegment({
        id: 'main',
        name: 'Main Street',
        coordinates: [
          [-95.0, 30.0],
          [-94.99, 30.0],
        ],
      });

      const near = createMockStreetSegment({
        id: 'near',
        name: 'Near Avenue',
        coordinates: [
          [-94.995, 29.995],
          [-94.995, 29.9995], // ~55m gap
        ],
      });

      const query = new SimpleStreetNetworkQuery([main, near]);
      const description = createIntersectionDescription('Main Street', 'Near Avenue');

      // Should fail with 50m tolerance
      const strictConfig = {
        ...getDefaultMatcherConfig(),
        maxSnapDistance: 50,
      };
      const result1 = matchSegment(description, query, null, strictConfig);
      expect(result1.matchQuality).toBe('failed');

      // Should succeed with 100m tolerance
      const lenientConfig = {
        ...getDefaultMatcherConfig(),
        maxSnapDistance: 100,
      };
      const result2 = matchSegment(description, query, null, lenientConfig);
      expect(result2.matchQuality).not.toBe('failed');
    });
  });

  describe('multiple intersections', () => {
    it('disambiguates with reference point', () => {
      // Two parallel Main Streets intersecting Oak Avenue
      const mainNorth = createMockStreetSegment({
        id: 'main-n',
        name: 'Main Street',
        coordinates: [
          [-95.0, 30.01],
          [-94.99, 30.01],
        ],
      });

      const mainSouth = createMockStreetSegment({
        id: 'main-s',
        name: 'Main Street',
        coordinates: [
          [-95.0, 30.0],
          [-94.99, 30.0],
        ],
      });

      const oak = createMockStreetSegment({
        id: 'oak',
        name: 'Oak Avenue',
        coordinates: [
          [-94.995, 29.99],
          [-94.995, 30.02], // Crosses both
        ],
      });

      const query = new SimpleStreetNetworkQuery([mainNorth, mainSouth, oak]);
      const description = createIntersectionDescription('Main Street', 'Oak Avenue');

      // With southern reference point, should prefer southern intersection
      const southRef: Position = [-94.995, 29.995];
      const result = matchSegment(description, query, southRef, getDefaultMatcherConfig());

      expect(result.matchQuality).not.toBe('failed');
      expect(result.coordinates.length).toBe(1);

      const [lon, lat] = result.coordinates[0];
      expect(lat).toBeLessThan(30.005); // Should be southern intersection
    });

    it('prefers crossing over endpoint when both exist', () => {
      // Oak crosses Main in middle and also meets at endpoint
      const main = createMockStreetSegment({
        id: 'main',
        name: 'Main Street',
        coordinates: [
          [-95.0, 30.0],
          [-94.995, 30.0], // Oak starts here
          [-94.99, 30.0],
        ],
      });

      const oak = createMockStreetSegment({
        id: 'oak',
        name: 'Oak Avenue',
        coordinates: [
          [-94.995, 30.0], // Endpoint at Main
          [-94.9925, 29.995],
          [-94.99, 30.0], // Also crosses Main again
        ],
      });

      const query = new SimpleStreetNetworkQuery([main, oak]);
      const description = createIntersectionDescription('Main Street', 'Oak Avenue');
      const result = matchSegment(description, query, null, getDefaultMatcherConfig());

      expect(result.matchQuality).toBe('exact');
      expect(result.diagnostics.reason).toContain('crossing');
    });
  });

  describe('precision validation', () => {
    it('returns precise coordinates for clean crossings', () => {
      const vertical = createMockStreetSegment({
        id: 'v',
        name: 'Vertical Street',
        coordinates: [
          [-95.0, 29.99],
          [-95.0, 30.01],
        ],
      });

      const horizontal = createMockStreetSegment({
        id: 'h',
        name: 'Horizontal Avenue',
        coordinates: [
          [-95.01, 30.0],
          [-94.99, 30.0],
        ],
      });

      const query = new SimpleStreetNetworkQuery([vertical, horizontal]);
      const description = createIntersectionDescription('Vertical Street', 'Horizontal Avenue');
      const result = matchSegment(description, query, null, getDefaultMatcherConfig());

      // Should find exact crossing or endpoint (both are acceptable for perfect intersection)
      expect(['exact', 'fuzzy']).toContain(result.matchQuality);
      expect(result.coordinates.length).toBe(1);

      const [lon, lat] = result.coordinates[0];
      expect(lon).toBeCloseTo(-95.0, 6);
      expect(lat).toBeCloseTo(30.0, 6);
      // For a perfect crossing, distance should be very small
      expect(result.diagnostics.distanceToCandidate).toBeLessThan(1);
    });

    it('reports distance for near-miss cases', () => {
      const main = createMockStreetSegment({
        id: 'main',
        name: 'Main Street',
        coordinates: [
          [-95.0, 30.0],
          [-94.99, 30.0],
        ],
      });

      const oak = createMockStreetSegment({
        id: 'oak',
        name: 'Oak Avenue',
        coordinates: [
          [-94.995, 29.99],
          [-94.995, 29.9999], // ~11m gap
        ],
      });

      const query = new SimpleStreetNetworkQuery([main, oak]);
      const description = createIntersectionDescription('Main Street', 'Oak Avenue');
      const result = matchSegment(description, query, null, getDefaultMatcherConfig());

      expect(result.matchQuality).not.toBe('failed');
      expect(result.diagnostics.distanceToCandidate).toBeGreaterThan(0);
      expect(result.diagnostics.distanceToCandidate).toBeLessThan(20);
    });
  });

  describe('error cases', () => {
    it('fails gracefully when first street not found', () => {
      const oak = createMockStreetSegment({
        id: 'oak',
        name: 'Oak Avenue',
        coordinates: [
          [-94.995, 29.99],
          [-94.995, 30.01],
        ],
      });

      const query = new SimpleStreetNetworkQuery([oak]);
      const description = createIntersectionDescription('Nonexistent Street', 'Oak Avenue');
      const result = matchSegment(description, query, null, getDefaultMatcherConfig());

      expect(result.matchQuality).toBe('failed');
      expect(result.diagnostics.reason).toContain('Could not find intersection');
    });

    it('fails gracefully when second street not found', () => {
      const main = createMockStreetSegment({
        id: 'main',
        name: 'Main Street',
        coordinates: [
          [-95.0, 30.0],
          [-94.99, 30.0],
        ],
      });

      const query = new SimpleStreetNetworkQuery([main]);
      const description = createIntersectionDescription('Main Street', 'Nonexistent Avenue');
      const result = matchSegment(description, query, null, getDefaultMatcherConfig());

      expect(result.matchQuality).toBe('failed');
      expect(result.diagnostics.reason).toContain('Could not find intersection');
    });

    it('fails when streets are parallel', () => {
      const first = createMockStreetSegment({
        id: 'first',
        name: '1st Street',
        coordinates: [
          [-95.0, 30.0],
          [-94.99, 30.0],
        ],
      });

      const second = createMockStreetSegment({
        id: 'second',
        name: '2nd Street',
        coordinates: [
          [-95.0, 30.01],
          [-94.99, 30.01], // Parallel, never intersects
        ],
      });

      const query = new SimpleStreetNetworkQuery([first, second]);
      const description = createIntersectionDescription('1st Street', '2nd Street');
      const result = matchSegment(description, query, null, getDefaultMatcherConfig());

      expect(result.matchQuality).toBe('failed');
    });
  });

  describe('real-world scenario simulation', () => {
    it('handles typical ward boundary starting point', () => {
      // Simulate St. Louis-style ward boundary:
      // "Beginning at the intersection of Big Bend Boulevard and Sappington Road"

      const bigBend = createMockStreetSegment({
        id: 'bigbend',
        name: 'Big Bend Boulevard',
        coordinates: [
          [-90.35, 38.56],
          [-90.34, 38.565], // Major diagonal boulevard
        ],
      });

      const sappington = createMockStreetSegment({
        id: 'sappington',
        name: 'Sappington Road',
        coordinates: [
          [-90.345, 38.555],
          [-90.345, 38.57], // North-south road
        ],
      });

      const query = new SimpleStreetNetworkQuery([bigBend, sappington]);
      const description = createIntersectionDescription('Big Bend Boulevard', 'Sappington Road');
      const result = matchSegment(description, query, null, getDefaultMatcherConfig());

      expect(result.matchQuality).toBe('exact');
      expect(result.coordinates.length).toBe(1);
      expect(result.matchedSegments.length).toBe(2);

      // Verify intersection is near expected location
      const [lon, lat] = result.coordinates[0];
      expect(lon).toBeCloseTo(-90.345, 2);
      expect(lat).toBeCloseTo(38.5625, 2);

      // This point must connect back to close the polygon
      const startPoint = result.coordinates[0];
      expect(startPoint).toBeDefined();
      expect(Array.isArray(startPoint)).toBe(true);
      expect(startPoint.length).toBe(2);
    });
  });
});
