/**
 * Polygon Builder
 *
 * Constructs valid polygons from matched street segments.
 * Handles gap filling, ring closing, and topology repair.
 *
 * PHILOSOPHY:
 * - Valid geometry or explicit failure (no "mostly valid" outputs)
 * - Preserve winding order (exterior CCW, holes CW per RFC 7946)
 * - Minimal intervention (don't over-simplify or over-smooth)
 * - Track all repairs for audit
 */

import type { Feature, Position, Polygon, MultiPolygon } from 'geojson';
import type { WardMatchResult, SegmentMatchResult } from './types';
import { haversineDistance } from './segment-matcher';

// =============================================================================
// Configuration
// =============================================================================

/**
 * Polygon builder configuration
 */
export interface PolygonBuilderConfig {
  /** Maximum gap to fill automatically (meters) */
  readonly maxAutoFillGap: number;

  /** Minimum ring area (square meters) to be valid */
  readonly minRingArea: number;

  /** Simplification tolerance (meters) - 0 to disable */
  readonly simplifyTolerance: number;

  /** Whether to enforce CCW winding for exterior rings */
  readonly enforceWindingOrder: boolean;

  /** Whether to remove self-intersections */
  readonly removeSelfIntersections: boolean;
}

/**
 * Default polygon builder configuration
 */
export function getDefaultPolygonBuilderConfig(): PolygonBuilderConfig {
  return {
    maxAutoFillGap: 200,
    minRingArea: 1000, // 1000 sq meters minimum
    simplifyTolerance: 0, // disabled by default
    enforceWindingOrder: true,
    removeSelfIntersections: true,
  };
}

// =============================================================================
// Geometry Utilities
// =============================================================================

/**
 * Calculate the signed area of a ring (positive = CCW, negative = CW)
 * Using the shoelace formula
 */
export function signedRingArea(ring: readonly Position[]): number {
  let area = 0;
  const n = ring.length;

  for (let i = 0; i < n - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    area += x1 * y2 - x2 * y1;
  }

  return area / 2;
}

/**
 * Calculate approximate area in square meters
 */
export function ringAreaSquareMeters(ring: readonly Position[]): number {
  // Approximate conversion from degrees² to m²
  // This is rough but sufficient for validation
  const signedArea = signedRingArea(ring);
  const centerLat =
    ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
  const latFactor = Math.cos((centerLat * Math.PI) / 180);

  // ~111km per degree latitude, adjusted for longitude
  const metersPerDegLat = 111000;
  const metersPerDegLon = 111000 * latFactor;

  return Math.abs(signedArea) * metersPerDegLat * metersPerDegLon;
}

/**
 * Check if ring winding is counter-clockwise
 */
export function isCounterClockwise(ring: readonly Position[]): boolean {
  return signedRingArea(ring) > 0;
}

/**
 * Reverse a ring to change winding order
 */
export function reverseRing(ring: readonly Position[]): Position[] {
  return [...ring].reverse();
}

/**
 * Ensure ring is closed (first point === last point)
 */
export function closeRing(ring: readonly Position[]): Position[] {
  if (ring.length < 2) return [...ring];

  const first = ring[0];
  const last = ring[ring.length - 1];

  if (first[0] === last[0] && first[1] === last[1]) {
    return [...ring];
  }

  return [...ring, first];
}

/**
 * Check if a point is inside a ring (ray casting algorithm)
 */
export function pointInRing(point: Position, ring: readonly Position[]): boolean {
  const [x, y] = point;
  let inside = false;
  const n = ring.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];

    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Check if two line segments intersect (excluding endpoints)
 */
function segmentsIntersect(
  a1: Position,
  a2: Position,
  b1: Position,
  b2: Position
): boolean {
  const [x1, y1] = a1;
  const [x2, y2] = a2;
  const [x3, y3] = b1;
  const [x4, y4] = b2;

  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (Math.abs(denom) < 1e-10) return false; // Parallel

  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

  // Exclude exact endpoint touches (use epsilon)
  const eps = 1e-10;
  return ua > eps && ua < 1 - eps && ub > eps && ub < 1 - eps;
}

/**
 * Check if a ring has self-intersections
 */
export function hasSelfIntersections(ring: readonly Position[]): boolean {
  const n = ring.length;
  if (n < 4) return false;

  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 2; j < n - 1; j++) {
      // Skip adjacent segments
      if (i === 0 && j === n - 2) continue;

      if (segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Simplify a ring using Douglas-Peucker algorithm
 */
export function simplifyRing(
  ring: readonly Position[],
  toleranceMeters: number
): Position[] {
  if (ring.length <= 4 || toleranceMeters <= 0) {
    return [...ring];
  }

  // Convert tolerance from meters to approximate degrees
  const toleranceDeg = toleranceMeters / 111000;

  const simplified = douglasPeucker([...ring], toleranceDeg);

  // Ensure still closed
  return closeRing(simplified);
}

/**
 * Douglas-Peucker simplification
 */
function douglasPeucker(points: Position[], tolerance: number): Position[] {
  if (points.length <= 2) return points;

  // Find point with maximum distance from line between first and last
  let maxDist = 0;
  let maxIndex = 0;

  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  // If max distance is greater than tolerance, recursively simplify
  if (maxDist > tolerance) {
    const left = douglasPeucker(points.slice(0, maxIndex + 1), tolerance);
    const right = douglasPeucker(points.slice(maxIndex), tolerance);
    return [...left.slice(0, -1), ...right];
  }

  return [start, end];
}

/**
 * Calculate perpendicular distance from point to line
 */
function perpendicularDistance(
  point: Position,
  lineStart: Position,
  lineEnd: Position
): number {
  const [x, y] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;

  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dx === 0 && dy === 0) {
    return Math.sqrt((x - x1) ** 2 + (y - y1) ** 2);
  }

  const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  const nearestX = x1 + t * dx;
  const nearestY = y1 + t * dy;

  return Math.sqrt((x - nearestX) ** 2 + (y - nearestY) ** 2);
}

// =============================================================================
// Polygon Building
// =============================================================================

/**
 * Repair applied during polygon building
 */
export interface PolygonRepair {
  readonly type:
    | 'gap_filled'
    | 'ring_closed'
    | 'winding_reversed'
    | 'self_intersection_removed'
    | 'simplified'
    | 'merged_segments';
  readonly description: string;
  readonly location?: Position;
}

/**
 * Result of polygon building
 */
export interface PolygonBuildResult {
  /** Successfully built a valid polygon */
  readonly success: boolean;

  /** The built polygon (null if failed) */
  readonly polygon: Feature<Polygon> | null;

  /** Repairs applied during building */
  readonly repairs: readonly PolygonRepair[];

  /** Validation results */
  readonly validation: {
    readonly isClosed: boolean;
    readonly isCounterClockwise: boolean;
    readonly hasValidArea: boolean;
    readonly areaSquareMeters: number;
    readonly hasSelfIntersections: boolean;
    readonly vertexCount: number;
  };

  /** Failure reason (if failed) */
  readonly failureReason: string | null;
}

/**
 * Build a polygon from matched segment results
 */
export function buildPolygonFromMatches(
  matches: readonly SegmentMatchResult[],
  config: PolygonBuilderConfig = getDefaultPolygonBuilderConfig()
): PolygonBuildResult {
  const repairs: PolygonRepair[] = [];

  // Collect all coordinates from successful matches
  const allCoords: Position[] = [];
  let lastPoint: Position | null = null;

  for (const match of matches) {
    if (match.coordinates.length === 0) continue;

    const coords = match.coordinates;

    // Check for gap from previous segment
    if (lastPoint && coords.length > 0) {
      const gap = haversineDistance(lastPoint, coords[0]);
      if (gap > config.maxAutoFillGap) {
        return {
          success: false,
          polygon: null,
          repairs: Object.freeze(repairs),
          validation: {
            isClosed: false,
            isCounterClockwise: false,
            hasValidArea: false,
            areaSquareMeters: 0,
            hasSelfIntersections: false,
            vertexCount: allCoords.length,
          },
          failureReason: `Gap of ${gap.toFixed(0)}m between segments exceeds max of ${config.maxAutoFillGap}m`,
        };
      } else if (gap > 1) {
        // Small gap - can be filled
        repairs.push({
          type: 'gap_filled',
          description: `Filled ${gap.toFixed(1)}m gap between segments`,
          location: lastPoint,
        });
        // The gap is implicitly filled by connecting the coordinates
      }
    }

    // Add coordinates (skip first if it duplicates last)
    for (let i = 0; i < coords.length; i++) {
      const coord = coords[i];
      if (
        i === 0 &&
        lastPoint &&
        haversineDistance(lastPoint, coord) < 1
      ) {
        continue; // Skip duplicate point
      }
      allCoords.push(coord);
    }

    lastPoint = coords[coords.length - 1];
  }

  // Need at least 4 points for a valid polygon
  if (allCoords.length < 3) {
    return {
      success: false,
      polygon: null,
      repairs: Object.freeze(repairs),
      validation: {
        isClosed: false,
        isCounterClockwise: false,
        hasValidArea: false,
        areaSquareMeters: 0,
        hasSelfIntersections: false,
        vertexCount: allCoords.length,
      },
      failureReason: `Only ${allCoords.length} coordinates - need at least 3`,
    };
  }

  // Close the ring
  let ring = closeRing(allCoords);
  const closingGap =
    allCoords.length > 0
      ? haversineDistance(allCoords[0], allCoords[allCoords.length - 1])
      : 0;

  if (closingGap > config.maxAutoFillGap) {
    return {
      success: false,
      polygon: null,
      repairs: Object.freeze(repairs),
      validation: {
        isClosed: false,
        isCounterClockwise: false,
        hasValidArea: false,
        areaSquareMeters: 0,
        hasSelfIntersections: false,
        vertexCount: allCoords.length,
      },
      failureReason: `Closing gap of ${closingGap.toFixed(0)}m exceeds max of ${config.maxAutoFillGap}m`,
    };
  }

  if (closingGap > 1) {
    repairs.push({
      type: 'ring_closed',
      description: `Closed ring with ${closingGap.toFixed(1)}m gap`,
      location: allCoords[0],
    });
  }

  // Check and fix winding order
  if (config.enforceWindingOrder && !isCounterClockwise(ring)) {
    ring = reverseRing(ring);
    repairs.push({
      type: 'winding_reversed',
      description: 'Reversed ring to counter-clockwise',
    });
  }

  // Simplify if configured
  if (config.simplifyTolerance > 0) {
    const originalCount = ring.length;
    ring = simplifyRing(ring, config.simplifyTolerance);
    if (ring.length < originalCount) {
      repairs.push({
        type: 'simplified',
        description: `Simplified from ${originalCount} to ${ring.length} vertices`,
      });
    }
  }

  // Check for self-intersections
  const selfIntersects = hasSelfIntersections(ring);
  // Note: Removing self-intersections is complex and typically requires
  // specialized libraries like JSTS. For now, we report but don't repair.

  // Calculate area
  const area = ringAreaSquareMeters(ring);
  const hasValidArea = area >= config.minRingArea;

  if (!hasValidArea) {
    return {
      success: false,
      polygon: null,
      repairs: Object.freeze(repairs),
      validation: {
        isClosed: true,
        isCounterClockwise: isCounterClockwise(ring),
        hasValidArea: false,
        areaSquareMeters: area,
        hasSelfIntersections: selfIntersects,
        vertexCount: ring.length,
      },
      failureReason: `Area of ${area.toFixed(0)}m² below minimum of ${config.minRingArea}m²`,
    };
  }

  if (selfIntersects && config.removeSelfIntersections) {
    // For now, we fail on self-intersections since repair is complex
    return {
      success: false,
      polygon: null,
      repairs: Object.freeze(repairs),
      validation: {
        isClosed: true,
        isCounterClockwise: isCounterClockwise(ring),
        hasValidArea,
        areaSquareMeters: area,
        hasSelfIntersections: true,
        vertexCount: ring.length,
      },
      failureReason: 'Polygon has self-intersections',
    };
  }

  // Build the polygon feature
  const polygon: Feature<Polygon> = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [ring],
    },
  };

  return {
    success: true,
    polygon,
    repairs: Object.freeze(repairs),
    validation: {
      isClosed: true,
      isCounterClockwise: isCounterClockwise(ring),
      hasValidArea: true,
      areaSquareMeters: area,
      hasSelfIntersections: selfIntersects,
      vertexCount: ring.length,
    },
    failureReason: null,
  };
}

/**
 * Build a polygon from a ward match result
 */
export function buildWardPolygon(
  wardMatch: WardMatchResult,
  config?: PolygonBuilderConfig
): PolygonBuildResult {
  const result = buildPolygonFromMatches(wardMatch.segmentMatches, config);

  // Add ward properties to polygon
  if (result.success && result.polygon) {
    result.polygon.properties = {
      ...result.polygon.properties,
      wardId: wardMatch.description.wardId,
      wardName: wardMatch.description.wardName,
      cityFips: wardMatch.description.cityFips,
      cityName: wardMatch.description.cityName,
      state: wardMatch.description.state,
    };
  }

  return result;
}

// =============================================================================
// Batch Processing
// =============================================================================

/**
 * Build polygons for all wards in a city
 */
export function buildCityPolygons(
  wardMatches: readonly WardMatchResult[],
  config?: PolygonBuilderConfig
): readonly PolygonBuildResult[] {
  return wardMatches.map((wm) => buildWardPolygon(wm, config));
}

/**
 * Combine ward polygons into a FeatureCollection
 */
export function combineWardPolygons(
  buildResults: readonly PolygonBuildResult[]
): {
  readonly featureCollection: {
    readonly type: 'FeatureCollection';
    readonly features: readonly Feature<Polygon>[];
  };
  readonly successCount: number;
  readonly failureCount: number;
} {
  const features: Feature<Polygon>[] = [];
  let successCount = 0;
  let failureCount = 0;

  for (const result of buildResults) {
    if (result.success && result.polygon) {
      features.push(result.polygon);
      successCount++;
    } else {
      failureCount++;
    }
  }

  return {
    featureCollection: {
      type: 'FeatureCollection',
      features: Object.freeze(features),
    },
    successCount,
    failureCount,
  };
}
