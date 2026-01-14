/**
 * Point-in-Polygon Engine
 *
 * Ray-casting algorithm for geometric containment testing.
 * Core primitive for hierarchical boundary resolution.
 *
 * PHILOSOPHY:
 * - Correctness first (handle edge cases: vertices, edges, holes)
 * - Performance second (bounding box pre-filter)
 * - Zero tolerance for geometric bugs (adversarial testing required)
 */

import type { Polygon, MultiPolygon, Position } from 'geojson';
import type {
  LatLng,
  BBox,
  PolygonRing,
  BoundaryGeometry,
  BoundaryType,
} from '../core/types/boundary.js';
import {
  isPointInBBox,
  extractBBox,
  getPrecisionRank,
} from '../core/types/boundary.js';

/**
 * Point-in-Polygon Test Result
 */
export interface PIPTestResult {
  readonly inside: boolean;
  readonly boundaryId: string;
  readonly boundaryType: BoundaryType;
  readonly precisionRank: number;
}

/**
 * Point-in-Polygon Engine
 *
 * Implements ray-casting algorithm with optimizations:
 * - Bounding box pre-filter (O(1) rejection)
 * - MultiPolygon handling
 * - Polygon holes (exterior - interior rings)
 * - Edge cases (point on vertex, point on edge)
 */
export class PointInPolygonEngine {
  /**
   * Test if point is inside polygon
   *
   * Algorithm: Ray-casting (horizontal ray from point to +infinity)
   * - Draw ray from point eastward (increasing x)
   * - Count intersections with polygon edges
   * - Odd intersections = inside, Even = outside
   *
   * Edge cases handled:
   * - Point on vertex: Considered inside (tolerance check)
   * - Point on edge: Considered inside (tolerance check)
   * - Horizontal edges: Skipped (parallel to ray)
   * - Vertex on ray: Counted carefully (avoid double-counting)
   *
   * @param point - Lat/lng coordinates
   * @param polygon - GeoJSON Polygon or MultiPolygon
   * @param tolerance - Distance tolerance for "on boundary" (default 1e-9 ≈ 1mm)
   * @returns true if point inside polygon or on boundary
   */
  isPointInPolygon(
    point: LatLng,
    polygon: Polygon | MultiPolygon,
    tolerance: number = 1e-9
  ): boolean {
    // First check if point is on boundary (edge case handling)
    if (this.isPointOnBoundary(point, polygon, tolerance)) {
      return true; // Points on boundary considered inside
    }

    // Standard ray-casting test
    if (polygon.type === 'Polygon') {
      return this.testPolygon(point, polygon.coordinates);
    } else {
      // MultiPolygon: test each polygon, return true if inside ANY
      return polygon.coordinates.some((polygonCoords) =>
        this.testPolygon(point, polygonCoords)
      );
    }
  }

  /**
   * Find ALL boundaries containing point
   *
   * Returns boundaries sorted by precision rank (finest → coarsest).
   * Uses bounding box pre-filter for performance.
   *
   * @param point - Lat/lng coordinates
   * @param boundaries - Candidate boundaries to test
   * @returns Array of containing boundaries (sorted by precision)
   */
  findContainingBoundaries(
    point: LatLng,
    boundaries: BoundaryGeometry[]
  ): PIPTestResult[] {
    const results: PIPTestResult[] = [];

    for (const boundary of boundaries) {
      // Fast O(1) rejection via bounding box
      if (!isPointInBBox(point, boundary.bbox)) {
        continue;
      }

      // Expensive PIP test (only if bbox check passed)
      const inside = this.isPointInPolygon(point, boundary.geometry);

      if (inside) {
        results.push({
          inside: true,
          boundaryId: boundary.metadata.id,
          boundaryType: boundary.metadata.type,
          precisionRank: getPrecisionRank(boundary.metadata.type),
        });
      }
    }

    // Sort by precision rank (finest first)
    return results.sort((a, b) => a.precisionRank - b.precisionRank);
  }

  /**
   * Find finest-grain boundary containing point
   *
   * Returns first match in precision order, or null if no match.
   *
   * @param point - Lat/lng coordinates
   * @param boundaries - Candidate boundaries to test
   * @returns Finest boundary containing point, or null
   */
  findFinestBoundary(
    point: LatLng,
    boundaries: BoundaryGeometry[]
  ): PIPTestResult | null {
    const results = this.findContainingBoundaries(point, boundaries);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Test if point is inside a single Polygon (with holes)
   *
   * GeoJSON Polygon structure:
   * - coordinates[0]: Exterior ring (must contain point)
   * - coordinates[1..n]: Interior rings (holes, must NOT contain point)
   *
   * @param point - Lat/lng coordinates
   * @param coordinates - Polygon ring coordinates
   * @returns true if inside exterior and outside all holes
   */
  private testPolygon(point: LatLng, coordinates: Position[][]): boolean {
    // Must be inside exterior ring
    const exteriorRing = coordinates[0];
    if (!this.testRing(point, exteriorRing)) {
      return false;
    }

    // Must be outside all interior rings (holes)
    for (let i = 1; i < coordinates.length; i++) {
      const hole = coordinates[i];
      if (this.testRing(point, hole)) {
        return false; // Inside a hole = outside polygon
      }
    }

    return true;
  }

  /**
   * Ray-casting test for single polygon ring
   *
   * Algorithm:
   * 1. Cast horizontal ray from point to +infinity (eastward)
   * 2. Count intersections with ring edges
   * 3. Odd = inside, Even = outside
   *
   * Edge case handling:
   * - Horizontal edges (y1 == y2): Skip (parallel to ray, no intersection)
   * - Ray above/below edge: Skip (no intersection possible)
   * - Vertex on ray: Handled by min/max comparison (avoid double-counting)
   *
   * @param point - Lat/lng coordinates
   * @param ring - Polygon ring (array of [lng, lat] positions)
   * @returns true if odd number of intersections (inside)
   */
  private testRing(point: LatLng, ring: PolygonRing): boolean {
    const intersections = this.countRayIntersections(point, ring);
    return intersections % 2 === 1; // Odd = inside
  }

  /**
   * Count ray intersections with polygon ring
   *
   * CRITICAL IMPLEMENTATION DETAILS:
   * - GeoJSON uses [lng, lat] order (x, y)
   * - Ray direction: horizontal, from point to +infinity x
   * - Intersection condition: ray crosses edge strictly to the right
   *
   * Mathematical derivation:
   * Given edge from (x1, y1) to (x2, y2), ray at height py:
   * - Edge intersects ray if: min(y1, y2) < py <= max(y1, y2)
   * - Intersection x-coordinate: x1 + (py - y1) / (y2 - y1) * (x2 - x1)
   * - Count intersection if: xIntersection > px
   *
   * @param point - Lat/lng coordinates
   * @param ring - Polygon ring (array of [lng, lat] positions)
   * @returns Number of ray intersections
   */
  private countRayIntersections(point: LatLng, ring: PolygonRing): number {
    let intersections = 0;
    const px = point.lng;
    const py = point.lat;

    // Iterate through edges (ring is closed: last point == first point)
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];

      // Skip horizontal edges (parallel to ray)
      if (y1 === y2) {
        continue;
      }

      // Check if ray height is within edge y-range
      // Use < and <= to handle vertex-on-ray case consistently
      if (py < Math.min(y1, y2) || py >= Math.max(y1, y2)) {
        continue;
      }

      // Compute x-coordinate where ray intersects edge
      // Formula: x = x1 + t * (x2 - x1), where t = (py - y1) / (y2 - y1)
      const t = (py - y1) / (y2 - y1);
      const xIntersection = x1 + t * (x2 - x1);

      // Count intersection if it's to the right of point
      if (xIntersection > px) {
        intersections++;
      }
    }

    return intersections;
  }

  /**
   * Test if point is exactly on polygon boundary
   *
   * Useful for debugging and edge case analysis.
   * NOT used in normal PIP testing (considered inside).
   *
   * @param point - Lat/lng coordinates
   * @param polygon - GeoJSON Polygon or MultiPolygon
   * @param tolerance - Distance tolerance (degrees, default 1e-9 ≈ 1mm)
   * @returns true if point is on boundary within tolerance
   */
  isPointOnBoundary(
    point: LatLng,
    polygon: Polygon | MultiPolygon,
    tolerance: number = 1e-9
  ): boolean {
    const rings =
      polygon.type === 'Polygon'
        ? polygon.coordinates
        : polygon.coordinates.flat();

    return rings.some((ring) => this.isPointOnRing(point, ring, tolerance));
  }

  /**
   * Test if point is on polygon ring
   *
   * Checks if point is within tolerance of any edge.
   *
   * @param point - Lat/lng coordinates
   * @param ring - Polygon ring
   * @param tolerance - Distance tolerance (degrees)
   * @returns true if point is on ring
   */
  private isPointOnRing(
    point: LatLng,
    ring: PolygonRing,
    tolerance: number
  ): boolean {
    const px = point.lng;
    const py = point.lat;

    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];

      // Compute perpendicular distance from point to line segment
      const distance = this.pointToSegmentDistance(px, py, x1, y1, x2, y2);

      if (distance <= tolerance) {
        return true;
      }
    }

    return false;
  }

  /**
   * Perpendicular distance from point to line segment
   *
   * @param px - Point x-coordinate
   * @param py - Point y-coordinate
   * @param x1 - Segment start x
   * @param y1 - Segment start y
   * @param x2 - Segment end x
   * @param y2 - Segment end y
   * @returns Perpendicular distance
   */
  private pointToSegmentDistance(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
      // Degenerate segment (point)
      return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    }

    // Project point onto line (parameter t ∈ [0, 1] for segment)
    let t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t)); // Clamp to segment

    // Closest point on segment
    const closestX = x1 + t * dx;
    const closestY = y1 + t * dy;

    // Distance to closest point
    return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
  }

  /**
   * Validate polygon ring geometry
   *
   * Checks for common errors:
   * - Non-closed ring (first != last point)
   * - Too few points (< 4 for closed ring)
   * - Self-intersection (expensive, optional)
   *
   * @param ring - Polygon ring to validate
   * @returns Validation errors (empty if valid)
   */
  validateRing(ring: PolygonRing): string[] {
    const errors: string[] = [];

    if (ring.length < 4) {
      errors.push(
        `Ring has ${ring.length} points, minimum 4 required (triangle + closure)`
      );
    }

    // Check if ring is closed (first point == last point)
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      errors.push('Ring is not closed (first point != last point)');
    }

    return errors;
  }
}
