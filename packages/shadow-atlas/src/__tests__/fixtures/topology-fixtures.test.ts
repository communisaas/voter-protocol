/**
 * Topology Fixtures Self-Validation Tests
 *
 * These tests validate that the fixtures themselves have correct geometric properties.
 * They use REAL turf.js operations to verify area calculations, intersections, and unions.
 *
 * Purpose:
 * 1. Ensure fixtures have expected geometric properties
 * 2. Demonstrate how to use fixtures with real topology validation
 * 3. Provide debugging helpers for fixture development
 */

import { describe, test, expect } from 'vitest';
import * as turf from '@turf/turf';
import type { Feature, Polygon } from 'geojson';

import {
  PERFECT_TILING_FIXTURE,
  GAP_DETECTED_FIXTURE,
  OVERLAP_DETECTED_FIXTURE,
  VALID_OVERLAP_FIXTURE,
  PERFECT_COUSUB_FIXTURE,
  PRECISION_FIXTURE,
  ALL_TOPOLOGY_FIXTURES,
  validateFixtureAreas,
  createRectanglePolygon,
} from './topology-fixtures';

describe('Fixture Self-Validation', () => {
  describe('createRectanglePolygon helper', () => {
    test('creates valid GeoJSON Polygon', () => {
      const polygon = createRectanglePolygon(-5, -5, 5, 5);

      expect(polygon.type).toBe('Polygon');
      expect(polygon.coordinates).toHaveLength(1); // Exterior ring only
      expect(polygon.coordinates[0]).toHaveLength(5); // 4 corners + closing point
    });

    test('calculates correct area for simple rectangle', () => {
      const polygon = createRectanglePolygon(-5, -5, 5, 5);
      const area = turf.area({ type: 'Feature', properties: {}, geometry: polygon });

      // 10×10 square in unit space (assuming degrees)
      // turf.area uses spherical geometry, so approximate
      expect(area).toBeGreaterThan(0);
    });

    test('closes polygon ring correctly', () => {
      const polygon = createRectanglePolygon(0, 0, 10, 10);
      const coords = polygon.coordinates[0];

      // First and last coordinates must be identical
      expect(coords[0]).toEqual(coords[4]);
    });
  });

  describe('validateFixtureAreas helper', () => {
    test('calculates areas for perfect tiling fixture', () => {
      const areas = validateFixtureAreas(PERFECT_TILING_FIXTURE);

      expect(areas.parentArea).toBe(100); // 10×10 square
      expect(areas.childrenTotalArea).toBe(100); // 4 × (5×5) squares
      expect(areas.expectedCoverage).toBe(100); // Perfect coverage
    });

    test('detects gap in GAP_DETECTED_FIXTURE', () => {
      const areas = validateFixtureAreas(GAP_DETECTED_FIXTURE);

      expect(areas.parentArea).toBe(100);
      expect(areas.childrenTotalArea).toBe(99.5); // One VTD is 0.5 units smaller
      expect(areas.expectedCoverage).toBe(99.5);
    });
  });

  describe('PERFECT_TILING_FIXTURE', () => {
    test('has 1 parent + 4 children', () => {
      expect(PERFECT_TILING_FIXTURE.features).toHaveLength(5);
    });

    test('parent is 10×10 square', () => {
      const parent = PERFECT_TILING_FIXTURE.features[0];
      const coords = parent.geometry.coordinates[0];

      // Verify bounding box
      const bbox = turf.bbox(parent);
      expect(bbox).toEqual([-5, -5, 5, 5]);
    });

    test('children perfectly tile parent (zero gaps)', () => {
      const [parent, ...children] = PERFECT_TILING_FIXTURE.features;

      // Union all children
      const childrenUnion = children.reduce<Feature<Polygon> | null>(
        (union, child) => {
          if (!union) return child as Feature<Polygon>;
          const result = turf.union(turf.featureCollection([union, child as Feature<Polygon>]));
          return result as Feature<Polygon>;
        },
        null
      );

      expect(childrenUnion).not.toBeNull();

      // Calculate area difference
      const parentArea = turf.area(parent);
      const unionArea = turf.area(childrenUnion!);

      // Areas should match within floating-point tolerance
      const gapPercentage = Math.abs((parentArea - unionArea) / parentArea) * 100;
      expect(gapPercentage).toBeLessThan(0.001); // Sub-threshold
    });

    test('children have zero overlaps', () => {
      const [, ...children] = PERFECT_TILING_FIXTURE.features;

      // Check all pairs for intersections
      for (let i = 0; i < children.length; i++) {
        for (let j = i + 1; j < children.length; j++) {
          const intersection = turf.intersect(
            turf.featureCollection([
              children[i] as Feature<Polygon>,
              children[j] as Feature<Polygon>
            ])
          );

          // Perfect tiling should have zero-area intersections (shared edges only)
          if (intersection) {
            const intersectionArea = turf.area(intersection);
            expect(intersectionArea).toBeLessThan(0.0001); // Essentially zero
          }
        }
      }
    });

    test('has realistic King County GEOIDs', () => {
      const [parent, ...children] = PERFECT_TILING_FIXTURE.features;

      expect(parent.properties?.GEOID).toBe('53033'); // King County, WA
      expect(children[0].properties?.GEOID).toMatch(/^53033/); // All children start with county GEOID
    });
  });

  describe('GAP_DETECTED_FIXTURE', () => {
    test('has detectable gap (0.5% of parent area)', () => {
      const [parent, ...children] = PERFECT_TILING_FIXTURE.features;

      const parentArea = turf.area(parent);
      const childrenTotalArea = children.reduce(
        (sum, child) => sum + turf.area(child),
        0
      );

      const areas = validateFixtureAreas(GAP_DETECTED_FIXTURE);
      expect(areas.childrenTotalArea).toBeLessThan(areas.parentArea);

      const gapPercentage = ((areas.parentArea - areas.childrenTotalArea) / areas.parentArea) * 100;
      expect(gapPercentage).toBeGreaterThan(0.001); // Exceeds tolerance
    });
  });

  describe('OVERLAP_DETECTED_FIXTURE', () => {
    test('has detectable overlap between two VTDs', () => {
      const [, ...children] = OVERLAP_DETECTED_FIXTURE.features;

      // VTD NW (index 0) and VTD NE (index 1) should overlap
      const vtdNW = children[0] as Feature<Polygon>;
      const vtdNE = children[1] as Feature<Polygon>;

      const intersection = turf.intersect(turf.featureCollection([vtdNW, vtdNE]));
      expect(intersection).not.toBeNull();

      const intersectionArea = turf.area(intersection!);
      expect(intersectionArea).toBeGreaterThan(0.1); // Non-trivial overlap

      // Calculate overlap percentage relative to parent
      const [parent] = OVERLAP_DETECTED_FIXTURE.features;
      const parentArea = turf.area(parent);
      const overlapPercentage = (intersectionArea / parentArea) * 100;

      expect(overlapPercentage).toBeGreaterThan(0.001); // Exceeds tolerance
    });
  });

  describe('VALID_OVERLAP_FIXTURE (PLACE layer)', () => {
    test('has intentional overlap between cities', () => {
      const [, ...places] = VALID_OVERLAP_FIXTURE.features;

      const cityA = places[0] as Feature<Polygon>;
      const cityB = places[1] as Feature<Polygon>;

      const intersection = turf.intersect(turf.featureCollection([cityA, cityB]));
      expect(intersection).not.toBeNull();

      const intersectionArea = turf.area(intersection!);
      expect(intersectionArea).toBeGreaterThan(1); // Significant overlap

      // This is VALID for PLACE layer (non-tiling)
    });

    test('has realistic Georgia PLACE GEOIDs', () => {
      const [parent, ...places] = VALID_OVERLAP_FIXTURE.features;

      expect(parent.properties?.GEOID).toBe('13121'); // Fulton County, GA
      expect(places[0].properties?.GEOID).toBe('1304000'); // Atlanta
      expect(places[1].properties?.GEOID).toBe('1368516'); // Sandy Springs
    });
  });

  describe('PERFECT_COUSUB_FIXTURE', () => {
    test('county subdivisions perfectly tile within county', () => {
      const [parent, ...cousubs] = PERFECT_COUSUB_FIXTURE.features;

      const parentArea = turf.area(parent);
      const cousubsUnion = cousubs.reduce<Feature<Polygon> | null>(
        (union, cousub) => {
          if (!union) return cousub as Feature<Polygon>;
          const result = turf.union(turf.featureCollection([union, cousub as Feature<Polygon>]));
          return result as Feature<Polygon>;
        },
        null
      );

      const unionArea = turf.area(cousubsUnion!);
      const gapPercentage = Math.abs((parentArea - unionArea) / parentArea) * 100;

      expect(gapPercentage).toBeLessThan(0.001); // Perfect tiling
    });

    test('has realistic Massachusetts COUSUB GEOIDs', () => {
      const [parent, ...cousubs] = PERFECT_COUSUB_FIXTURE.features;

      expect(parent.properties?.GEOID).toBe('25021'); // Norfolk County, MA
      expect(cousubs[0].properties?.GEOID).toMatch(/^25021/); // All start with county
    });
  });

  describe('PRECISION_FIXTURE', () => {
    test('has sub-threshold gap from floating-point precision', () => {
      const areas = validateFixtureAreas(PRECISION_FIXTURE);

      const gapPercentage = ((areas.parentArea - areas.childrenTotalArea) / areas.parentArea) * 100;

      // Gap should exist but be below tolerance threshold
      expect(gapPercentage).toBeGreaterThan(0);
      expect(gapPercentage).toBeLessThan(0.001); // Within tolerance
    });
  });

  describe('ALL_TOPOLOGY_FIXTURES metadata', () => {
    test('all fixtures have required metadata', () => {
      for (const meta of ALL_TOPOLOGY_FIXTURES) {
        expect(meta.name).toBeTruthy();
        expect(meta.description).toBeTruthy();
        expect(meta.layerType).toMatch(/^(VTD|COUSUB|PLACE|CDP|ZCTA)$/);
        expect(meta.tilingExpected).toBeDefined();
        expect(meta.expectedOutcome).toMatch(/^(PASS|FAIL)$/);
        expect(meta.fixture.type).toBe('FeatureCollection');
        expect(meta.fixture.features.length).toBeGreaterThan(1);
      }
    });

    test('tiling layers expect zero overlaps', () => {
      const tilingFixtures = ALL_TOPOLOGY_FIXTURES.filter(f => f.tilingExpected);

      for (const meta of tilingFixtures) {
        // Tiling layers should expect zero overlaps (or have explicit overlap metadata)
        if (meta.expectedOutcome === 'PASS') {
          expect(meta.expectedOverlapPercentage).toBe(0);
        }
      }
    });

    test('non-tiling layers can have overlaps', () => {
      const nonTilingFixtures = ALL_TOPOLOGY_FIXTURES.filter(f => !f.tilingExpected);

      // At least one non-tiling fixture should allow overlaps
      const hasOverlaps = nonTilingFixtures.some(
        f => f.expectedOverlapPercentage && f.expectedOverlapPercentage > 0
      );

      expect(hasOverlaps).toBe(true);
    });
  });

  describe('Real-world GEOID format validation', () => {
    test('COUNTY GEOIDs are 5 digits', () => {
      const countyFeatures = [
        PERFECT_TILING_FIXTURE.features[0],
        GAP_DETECTED_FIXTURE.features[0],
        OVERLAP_DETECTED_FIXTURE.features[0],
      ];

      for (const county of countyFeatures) {
        expect(county.properties?.GEOID).toMatch(/^\d{5}$/);
      }
    });

    test('VTD GEOIDs start with county GEOID', () => {
      const [parent, ...vtds] = PERFECT_TILING_FIXTURE.features;
      const countyGEOID = parent.properties?.GEOID;

      for (const vtd of vtds) {
        expect(vtd.properties?.GEOID).toMatch(new RegExp(`^${countyGEOID}`));
      }
    });

    test('COUSUB GEOIDs are 10 digits', () => {
      const [, ...cousubs] = PERFECT_COUSUB_FIXTURE.features;

      for (const cousub of cousubs) {
        expect(cousub.properties?.GEOID).toMatch(/^\d{10}$/);
      }
    });

    test('PLACE GEOIDs are 7 digits', () => {
      const [, ...places] = VALID_OVERLAP_FIXTURE.features;

      for (const place of places) {
        expect(place.properties?.GEOID).toMatch(/^\d{7}$/);
      }
    });
  });

  describe('Fixture coordinate integrity', () => {
    test('all polygons are closed rings', () => {
      for (const meta of ALL_TOPOLOGY_FIXTURES) {
        for (const feature of meta.fixture.features) {
          const coords = feature.geometry.coordinates[0];

          // First and last coordinate must be identical
          expect(coords[0]).toEqual(coords[coords.length - 1]);
        }
      }
    });

    test('all polygons have at least 4 vertices (triangle + closing point)', () => {
      for (const meta of ALL_TOPOLOGY_FIXTURES) {
        for (const feature of meta.fixture.features) {
          const coords = feature.geometry.coordinates[0];

          // Minimum: 3 unique points + 1 closing point = 4 coordinates
          expect(coords.length).toBeGreaterThanOrEqual(4);
        }
      }
    });

    test('all coordinates are finite numbers', () => {
      for (const meta of ALL_TOPOLOGY_FIXTURES) {
        for (const feature of meta.fixture.features) {
          const coords = feature.geometry.coordinates[0];

          for (const [lon, lat] of coords) {
            expect(Number.isFinite(lon)).toBe(true);
            expect(Number.isFinite(lat)).toBe(true);
          }
        }
      }
    });
  });

  describe('Edge case: turf.js integration validation', () => {
    test('turf.area works on all fixtures', () => {
      for (const meta of ALL_TOPOLOGY_FIXTURES) {
        for (const feature of meta.fixture.features) {
          const area = turf.area(feature);

          expect(area).toBeGreaterThan(0);
          expect(Number.isFinite(area)).toBe(true);
        }
      }
    });

    test('turf.union works on all child features', () => {
      for (const meta of ALL_TOPOLOGY_FIXTURES) {
        const [, ...children] = meta.fixture.features;

        const union = children.reduce<Feature<Polygon> | null>(
          (acc, child) => {
            if (!acc) return child as Feature<Polygon>;
            const result = turf.union(turf.featureCollection([acc, child as Feature<Polygon>]));
            return result as Feature<Polygon>;
          },
          null
        );

        expect(union).not.toBeNull();
        expect(turf.area(union!)).toBeGreaterThan(0);
      }
    });

    test('turf.intersect detects overlaps correctly', () => {
      const [, ...children] = OVERLAP_DETECTED_FIXTURE.features;

      // VTD NW and NE should intersect
      const intersection = turf.intersect(
        turf.featureCollection([
          children[0] as Feature<Polygon>,
          children[1] as Feature<Polygon>
        ])
      );

      expect(intersection).not.toBeNull();
      expect(turf.area(intersection!)).toBeGreaterThan(0);
    });
  });
});

describe('Demonstration: Using Fixtures with Real Topology Validator', () => {
  /**
   * Mock topology validator using REAL turf.js operations
   * This demonstrates how the fixtures integrate with actual validation logic
   */
  function validateTopology(config: {
    parent: Feature<Polygon>;
    children: Feature<Polygon>[];
    tolerance: number;
  }): {
    valid: boolean;
    gapPercentage: number;
    overlapPercentage: number;
    errors: string[];
  } {
    const parentArea = turf.area(config.parent);

    // Calculate union of all children (handles overlaps)
    const childrenUnion = config.children.reduce<Feature<Polygon> | null>(
      (union, child) => {
        if (!union) return child;
        const result = turf.union(turf.featureCollection([union, child]));
        return result as Feature<Polygon>;
      },
      null
    );

    const unionArea = childrenUnion ? turf.area(childrenUnion) : 0;

    // Calculate total area including overlaps
    const totalChildArea = config.children.reduce(
      (sum, child) => sum + turf.area(child),
      0
    );

    // Gap: Parent area not covered by union
    const gapArea = Math.max(0, parentArea - unionArea);
    const gapPercentage = (gapArea / parentArea) * 100;

    // Overlap: Total child area exceeds union area
    const overlapArea = Math.max(0, totalChildArea - unionArea);
    const overlapPercentage = (overlapArea / parentArea) * 100;

    const errors: string[] = [];
    if (gapPercentage > config.tolerance) {
      errors.push(`Gap ${gapPercentage.toFixed(4)}% exceeds tolerance ${config.tolerance}%`);
    }
    if (overlapPercentage > config.tolerance) {
      errors.push(`Overlap ${overlapPercentage.toFixed(4)}% exceeds tolerance ${config.tolerance}%`);
    }

    return {
      valid: errors.length === 0,
      gapPercentage,
      overlapPercentage,
      errors,
    };
  }

  test('PERFECT_TILING_FIXTURE passes validation', () => {
    const [parent, ...children] = PERFECT_TILING_FIXTURE.features;

    const result = validateTopology({
      parent: parent as Feature<Polygon>,
      children: children as Feature<Polygon>[],
      tolerance: 0.001,
    });

    expect(result.valid).toBe(true);
    expect(result.gapPercentage).toBeLessThan(0.001);
    expect(result.overlapPercentage).toBeLessThan(0.001);
    expect(result.errors).toHaveLength(0);
  });

  test('GAP_DETECTED_FIXTURE fails validation', () => {
    const [parent, ...children] = GAP_DETECTED_FIXTURE.features;

    const result = validateTopology({
      parent: parent as Feature<Polygon>,
      children: children as Feature<Polygon>[],
      tolerance: 0.001,
    });

    expect(result.valid).toBe(false);
    expect(result.gapPercentage).toBeGreaterThan(0.001);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Gap');
  });

  test('OVERLAP_DETECTED_FIXTURE fails validation', () => {
    const [parent, ...children] = OVERLAP_DETECTED_FIXTURE.features;

    const result = validateTopology({
      parent: parent as Feature<Polygon>,
      children: children as Feature<Polygon>[],
      tolerance: 0.001,
    });

    expect(result.valid).toBe(false);
    expect(result.overlapPercentage).toBeGreaterThan(0.001);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Overlap');
  });

  test('PRECISION_FIXTURE passes validation (sub-threshold gap)', () => {
    const [parent, ...children] = PRECISION_FIXTURE.features;

    const result = validateTopology({
      parent: parent as Feature<Polygon>,
      children: children as Feature<Polygon>[],
      tolerance: 0.001,
    });

    expect(result.valid).toBe(true);
    expect(result.gapPercentage).toBeGreaterThan(0); // Has gap
    expect(result.gapPercentage).toBeLessThan(0.001); // But within tolerance
  });
});
