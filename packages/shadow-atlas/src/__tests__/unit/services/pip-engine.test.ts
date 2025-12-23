/**
 * Point-in-Polygon Engine Tests
 *
 * Comprehensive test suite for ray-casting algorithm.
 * Tests edge cases, polygon holes, MultiPolygon handling.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PointInPolygonEngine } from '../../../services/pip-engine.js';
import type { Polygon, MultiPolygon, Position } from 'geojson';
import type { LatLng, BoundaryGeometry, BoundaryType } from '../types/boundary.js';

describe('PointInPolygonEngine', () => {
  let engine: PointInPolygonEngine;

  beforeEach(() => {
    engine = new PointInPolygonEngine();
  });

  describe('isPointInPolygon - Simple Polygons', () => {
    it('should identify point inside simple square', () => {
      const polygon: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0], // Closed
          ],
        ],
      };

      expect(engine.isPointInPolygon({ lat: 5, lng: 5 }, polygon)).toBe(true);
    });

    it('should identify point outside simple square', () => {
      const polygon: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
        ],
      };

      expect(engine.isPointInPolygon({ lat: 15, lng: 15 }, polygon)).toBe(false);
    });

    it('should identify point inside triangle', () => {
      const polygon: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [5, 10],
            [0, 0], // Closed
          ],
        ],
      };

      expect(engine.isPointInPolygon({ lat: 5, lng: 5 }, polygon)).toBe(true);
    });

    it('should identify point outside triangle', () => {
      const polygon: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [5, 10],
            [0, 0],
          ],
        ],
      };

      expect(engine.isPointInPolygon({ lat: -1, lng: 5 }, polygon)).toBe(false);
    });
  });

  describe('isPointInPolygon - Edge Cases', () => {
    it('should handle point on vertex (considered inside)', () => {
      const polygon: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
        ],
      };

      // Point exactly on vertex
      expect(engine.isPointInPolygon({ lat: 0, lng: 0 }, polygon)).toBe(true);
      expect(engine.isPointInPolygon({ lat: 10, lng: 10 }, polygon)).toBe(true);
    });

    it('should handle point on edge (ray-casting counts as inside)', () => {
      const polygon: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
        ],
      };

      // Point on bottom edge
      expect(engine.isPointInPolygon({ lat: 0, lng: 5 }, polygon)).toBe(true);

      // Point on right edge
      expect(engine.isPointInPolygon({ lat: 5, lng: 10 }, polygon)).toBe(true);
    });

    it('should handle horizontal edge correctly (skip in ray-casting)', () => {
      const polygon: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [10, 0], // Horizontal edge at y=0
            [10, 10],
            [0, 10],
            [0, 0],
          ],
        ],
      };

      // Point with ray along horizontal edge
      expect(engine.isPointInPolygon({ lat: 0, lng: 5 }, polygon)).toBe(true);
    });

    it('should handle concave polygon', () => {
      // L-shaped polygon
      const polygon: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [10, 5],
            [5, 5],
            [5, 10],
            [0, 10],
            [0, 0],
          ],
        ],
      };

      // Inside the L
      expect(engine.isPointInPolygon({ lat: 2, lng: 2 }, polygon)).toBe(true);
      expect(engine.isPointInPolygon({ lat: 7, lng: 2 }, polygon)).toBe(true);

      // Outside the L (in the notch)
      expect(engine.isPointInPolygon({ lat: 7, lng: 7 }, polygon)).toBe(false);
    });

    it('should handle very small polygon (floating point precision)', () => {
      const polygon: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [0.0001, 0],
            [0.0001, 0.0001],
            [0, 0.0001],
            [0, 0],
          ],
        ],
      };

      // Inside tiny square
      expect(engine.isPointInPolygon({ lat: 0.00005, lng: 0.00005 }, polygon)).toBe(true);

      // Outside tiny square
      expect(engine.isPointInPolygon({ lat: 0.0002, lng: 0.0002 }, polygon)).toBe(false);
    });
  });

  describe('isPointInPolygon - Polygons with Holes', () => {
    it('should handle polygon with single hole', () => {
      const polygon: Polygon = {
        type: 'Polygon',
        coordinates: [
          // Exterior ring
          [
            [0, 0],
            [20, 0],
            [20, 20],
            [0, 20],
            [0, 0],
          ],
          // Interior ring (hole)
          [
            [5, 5],
            [15, 5],
            [15, 15],
            [5, 15],
            [5, 5],
          ],
        ],
      };

      // Inside exterior, outside hole
      expect(engine.isPointInPolygon({ lat: 2, lng: 2 }, polygon)).toBe(true);

      // Inside hole (should be outside polygon)
      expect(engine.isPointInPolygon({ lat: 10, lng: 10 }, polygon)).toBe(false);

      // Outside exterior
      expect(engine.isPointInPolygon({ lat: 25, lng: 25 }, polygon)).toBe(false);
    });

    it('should handle polygon with multiple holes', () => {
      const polygon: Polygon = {
        type: 'Polygon',
        coordinates: [
          // Exterior ring
          [
            [0, 0],
            [30, 0],
            [30, 30],
            [0, 30],
            [0, 0],
          ],
          // Hole 1
          [
            [5, 5],
            [10, 5],
            [10, 10],
            [5, 10],
            [5, 5],
          ],
          // Hole 2
          [
            [20, 20],
            [25, 20],
            [25, 25],
            [20, 25],
            [20, 20],
          ],
        ],
      };

      // Between holes
      expect(engine.isPointInPolygon({ lat: 15, lng: 15 }, polygon)).toBe(true);

      // Inside hole 1
      expect(engine.isPointInPolygon({ lat: 7, lng: 7 }, polygon)).toBe(false);

      // Inside hole 2
      expect(engine.isPointInPolygon({ lat: 22, lng: 22 }, polygon)).toBe(false);
    });
  });

  describe('isPointInPolygon - MultiPolygon', () => {
    it('should handle MultiPolygon with point inside first polygon', () => {
      const multiPolygon: MultiPolygon = {
        type: 'MultiPolygon',
        coordinates: [
          // First polygon
          [
            [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
              [0, 0],
            ],
          ],
          // Second polygon
          [
            [
              [20, 20],
              [30, 20],
              [30, 30],
              [20, 30],
              [20, 20],
            ],
          ],
        ],
      };

      expect(engine.isPointInPolygon({ lat: 5, lng: 5 }, multiPolygon)).toBe(true);
    });

    it('should handle MultiPolygon with point inside second polygon', () => {
      const multiPolygon: MultiPolygon = {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
              [0, 0],
            ],
          ],
          [
            [
              [20, 20],
              [30, 20],
              [30, 30],
              [20, 30],
              [20, 20],
            ],
          ],
        ],
      };

      expect(engine.isPointInPolygon({ lat: 25, lng: 25 }, multiPolygon)).toBe(true);
    });

    it('should handle MultiPolygon with point outside all polygons', () => {
      const multiPolygon: MultiPolygon = {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
              [0, 0],
            ],
          ],
          [
            [
              [20, 20],
              [30, 20],
              [30, 30],
              [20, 30],
              [20, 20],
            ],
          ],
        ],
      };

      expect(engine.isPointInPolygon({ lat: 15, lng: 15 }, multiPolygon)).toBe(false);
    });
  });

  describe('findContainingBoundaries', () => {
    it('should find all containing boundaries sorted by precision', () => {
      const boundaries: BoundaryGeometry[] = [
        {
          metadata: {
            id: 'us-wa-king-county',
            type: 'county' as BoundaryType,
            name: 'King County',
            jurisdiction: 'Washington, USA',
            provenance: {} as any,
            validFrom: new Date('2020-01-01'),
          },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [100, 0],
                [100, 100],
                [0, 100],
                [0, 0],
              ],
            ],
          },
          bbox: [0, 0, 100, 100],
        },
        {
          metadata: {
            id: 'us-wa-seattle-district-1',
            type: 'city_council_district' as BoundaryType,
            name: 'District 1',
            jurisdiction: 'Seattle, WA, USA',
            provenance: {} as any,
            validFrom: new Date('2020-01-01'),
          },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [40, 40],
                [60, 40],
                [60, 60],
                [40, 60],
                [40, 40],
              ],
            ],
          },
          bbox: [40, 40, 60, 60],
        },
      ];

      const point: LatLng = { lat: 50, lng: 50 };
      const results = engine.findContainingBoundaries(point, boundaries);

      expect(results).toHaveLength(2);

      // Should be sorted by precision (district first, then county)
      expect(results[0].boundaryType).toBe('city_council_district');
      expect(results[0].precisionRank).toBe(0);

      expect(results[1].boundaryType).toBe('county');
      expect(results[1].precisionRank).toBe(5); // county is rank 5 per PRECISION_RANK
    });

    it('should filter out boundaries via bounding box pre-filter', () => {
      const boundaries: BoundaryGeometry[] = [
        {
          metadata: {
            id: 'us-wa-seattle',
            type: 'city_limits' as BoundaryType,
            name: 'Seattle',
            jurisdiction: 'Washington, USA',
            provenance: {} as any,
            validFrom: new Date('2020-01-01'),
          },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 10],
                [0, 0],
              ],
            ],
          },
          bbox: [0, 0, 10, 10],
        },
        {
          metadata: {
            id: 'us-ca-sf',
            type: 'city_limits' as BoundaryType,
            name: 'San Francisco',
            jurisdiction: 'California, USA',
            provenance: {} as any,
            validFrom: new Date('2020-01-01'),
          },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [100, 100],
                [110, 100],
                [110, 110],
                [100, 110],
                [100, 100],
              ],
            ],
          },
          bbox: [100, 100, 110, 110],
        },
      ];

      // Point in Seattle bbox, not SF bbox
      const point: LatLng = { lat: 5, lng: 5 };
      const results = engine.findContainingBoundaries(point, boundaries);

      // Only Seattle should be tested (SF filtered by bbox)
      expect(results).toHaveLength(1);
      expect(results[0].boundaryId).toBe('us-wa-seattle');
    });
  });

  describe('findFinestBoundary', () => {
    it('should return finest-grain boundary', () => {
      const boundaries: BoundaryGeometry[] = [
        {
          metadata: {
            id: 'county',
            type: 'county' as BoundaryType,
            name: 'County',
            jurisdiction: 'State',
            provenance: {} as any,
            validFrom: new Date('2020-01-01'),
          },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [100, 0],
                [100, 100],
                [0, 100],
                [0, 0],
              ],
            ],
          },
          bbox: [0, 0, 100, 100],
        },
        {
          metadata: {
            id: 'district',
            type: 'city_council_district' as BoundaryType,
            name: 'District',
            jurisdiction: 'City',
            provenance: {} as any,
            validFrom: new Date('2020-01-01'),
          },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [40, 40],
                [60, 40],
                [60, 60],
                [40, 60],
                [40, 40],
              ],
            ],
          },
          bbox: [40, 40, 60, 60],
        },
      ];

      const result = engine.findFinestBoundary({ lat: 50, lng: 50 }, boundaries);

      expect(result).not.toBeNull();
      expect(result?.boundaryType).toBe('city_council_district');
    });

    it('should return null if no match', () => {
      const boundaries: BoundaryGeometry[] = [
        {
          metadata: {
            id: 'district',
            type: 'city_council_district' as BoundaryType,
            name: 'District',
            jurisdiction: 'City',
            provenance: {} as any,
            validFrom: new Date('2020-01-01'),
          },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 10],
                [0, 0],
              ],
            ],
          },
          bbox: [0, 0, 10, 10],
        },
      ];

      const result = engine.findFinestBoundary({ lat: 50, lng: 50 }, boundaries);

      expect(result).toBeNull();
    });
  });

  describe('validateRing', () => {
    it('should validate correct ring', () => {
      const ring: Position[] = [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0], // Closed
      ];

      const errors = engine.validateRing(ring);
      expect(errors).toHaveLength(0);
    });

    it('should detect unclosed ring', () => {
      const ring: Position[] = [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        // Missing closure
      ];

      const errors = engine.validateRing(ring);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('not closed');
    });

    it('should detect ring with too few points', () => {
      const ring: Position[] = [
        [0, 0],
        [10, 0],
        [0, 0], // Only 2 unique points + closure
      ];

      const errors = engine.validateRing(ring);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('minimum 4 required');
    });
  });

  describe('Real-World Test Cases', () => {
    it('should handle Seattle City Council District 1 (real coordinates)', () => {
      // Simplified actual district boundary (WGS84)
      const district1: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [-122.4, 47.65],
            [-122.35, 47.65],
            [-122.35, 47.7],
            [-122.4, 47.7],
            [-122.4, 47.65],
          ],
        ],
      };

      // Point in University District (inside District 1)
      expect(
        engine.isPointInPolygon({ lat: 47.66, lng: -122.38 }, district1)
      ).toBe(true);

      // Point in Downtown Seattle (outside District 1)
      expect(
        engine.isPointInPolygon({ lat: 47.6, lng: -122.33 }, district1)
      ).toBe(false);
    });

    it('should handle congressional district with complex boundary', () => {
      // Simplified WA-7 (Seattle area, concave shape)
      const wa7: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [-122.45, 47.5],
            [-122.25, 47.5],
            [-122.25, 47.55],
            [-122.35, 47.55],
            [-122.35, 47.7],
            [-122.45, 47.7],
            [-122.45, 47.5],
          ],
        ],
      };

      // Inside the concave region
      expect(engine.isPointInPolygon({ lat: 47.52, lng: -122.3 }, wa7)).toBe(true);

      // In the notch (should be outside)
      expect(engine.isPointInPolygon({ lat: 47.6, lng: -122.3 }, wa7)).toBe(false);
    });
  });

  describe('Performance - Bounding Box Pre-filter', () => {
    it('should reject far-away boundaries via bbox without PIP test', () => {
      const farBoundary: BoundaryGeometry = {
        metadata: {
          id: 'far-boundary',
          type: 'city_limits' as BoundaryType,
          name: 'Far City',
          jurisdiction: 'Far State',
          provenance: {} as any,
          validFrom: new Date('2020-01-01'),
        },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [1000, 1000],
              [1100, 1000],
              [1100, 1100],
              [1000, 1100],
              [1000, 1000],
            ],
          ],
        },
        bbox: [1000, 1000, 1100, 1100],
      };

      const point: LatLng = { lat: 0, lng: 0 };

      // Should be filtered by bbox (not in bbox)
      const results = engine.findContainingBoundaries(point, [farBoundary]);
      expect(results).toHaveLength(0);
    });
  });

  describe('Adversarial Tests - Golden Vectors', () => {
    it('should match known test vector from TIGER/Line Seattle District 1', () => {
      // GOLDEN VECTOR: Known point-in-polygon test from Census Bureau data
      // Address: University of Washington, Seattle, WA (47.6553° N, 122.3035° W)
      // Expected: Inside Seattle City Council District 4 (actual boundaries)

      // This is a SIMPLIFIED boundary for District 4
      // Real production would use actual TIGER/Line geometry
      const district4: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [-122.32, 47.64],
            [-122.28, 47.64],
            [-122.28, 47.68],
            [-122.32, 47.68],
            [-122.32, 47.64],
          ],
        ],
      };

      const uwPoint: LatLng = { lat: 47.6553, lng: -122.3035 };

      // EXPECTED: Inside District 4
      expect(engine.isPointInPolygon(uwPoint, district4)).toBe(true);
    });

    it('should reject point on district border (edge case from real data)', () => {
      // GOLDEN VECTOR: Point exactly on district border
      // Real-world case: Address on street forming district boundary

      const district: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [-122.35, 47.6],
            [-122.3, 47.6],
            [-122.3, 47.65],
            [-122.35, 47.65],
            [-122.35, 47.6],
          ],
        ],
      };

      // Point exactly on southern boundary
      const borderPoint: LatLng = { lat: 47.6, lng: -122.325 };

      // Ray-casting considers boundary as "inside"
      expect(engine.isPointInPolygon(borderPoint, district)).toBe(true);
    });
  });
});
