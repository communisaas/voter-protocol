/**
 * Golden Vector Validator
 *
 * Validates reconstructed boundaries against known-correct reference data.
 * The cornerstone of regression prevention.
 *
 * PHILOSOPHY:
 * - Golden vectors are TRUTH (verified by humans, not generated)
 * - Binary pass/fail with explicit tolerance
 * - Any regression from golden vectors blocks deployment
 * - New golden vectors require human verification
 */

import type { Feature, Polygon, Position } from 'geojson';
import type { GoldenVector, WardMatchResult, TessellationProofSummary } from './types';
import {
  signedRingArea,
  ringAreaSquareMeters,
  hasSelfIntersections,
} from './polygon-builder';
import { haversineDistance } from './segment-matcher';

/** Maximum ring vertices for O(n²) Hausdorff — 5000² = 25M ops max */
const MAX_RING_VERTICES = 5000;

// =============================================================================
// Configuration
// =============================================================================

/**
 * Golden vector validation configuration
 */
export interface GoldenVectorConfig {
  /** Maximum Hausdorff distance tolerance in meters */
  readonly maxHausdorffDistance: number;

  /** Maximum area difference ratio (0.05 = 5%) */
  readonly maxAreaDifferenceRatio: number;

  /** Maximum centroid distance in meters */
  readonly maxCentroidDistance: number;

  /** Minimum overlap ratio (IoU) */
  readonly minOverlapRatio: number;

  /** Whether to fail fast on first mismatch */
  readonly failFast: boolean;
}

/**
 * Default validation configuration
 */
export function getDefaultGoldenVectorConfig(): GoldenVectorConfig {
  return {
    maxHausdorffDistance: 50, // 50 meters
    maxAreaDifferenceRatio: 0.05, // 5%
    maxCentroidDistance: 100, // 100 meters
    minOverlapRatio: 0.90, // 90% IoU
    failFast: false,
  };
}

// =============================================================================
// Geometry Comparison Utilities
// =============================================================================

/**
 * Calculate the centroid of a polygon ring
 */
function calculateCentroid(ring: readonly Position[]): Position {
  let cx = 0;
  let cy = 0;
  let area = 0;

  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }

  area /= 2;
  // Guard degenerate polygons (collinear points, near-zero area).
  if (Math.abs(area) < 1e-10) {
    // Fallback: arithmetic mean of vertices.
    const n = ring.length - 1; // exclude closing vertex
    const mx = ring.slice(0, n).reduce((s, [x]) => s + x, 0) / n;
    const my = ring.slice(0, n).reduce((s, [, y]) => s + y, 0) / n;
    return [mx, my];
  }
  cx /= 6 * area;
  cy /= 6 * area;

  // NaN centroid guard — near-zero area can produce NaN via division.
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
    const n = ring.length - 1;
    const mx = ring.slice(0, n).reduce((s, [x]) => s + x, 0) / n;
    const my = ring.slice(0, n).reduce((s, [, y]) => s + y, 0) / n;
    return [mx, my];
  }

  return [cx, cy];
}

/** Uniformly sample a ring down to maxVertices if it exceeds the limit */
function sampleRing(ring: readonly Position[], maxVertices: number): readonly Position[] {
  if (ring.length <= maxVertices) return ring;
  const stride = Math.ceil(ring.length / maxVertices);
  return ring.filter((_, i) => i % stride === 0);
}

/**
 * Calculate approximate Hausdorff distance between two rings
 * (Maximum of minimum distances from each point to the other ring)
 */
function hausdorffDistance(
  ring1: readonly Position[],
  ring2: readonly Position[]
): number {
  // Limit ring size to prevent O(n²) explosion.
  const sampled1 = sampleRing(ring1, MAX_RING_VERTICES);
  const sampled2 = sampleRing(ring2, MAX_RING_VERTICES);
  const d1 = maxMinDistance(sampled1, sampled2);
  const d2 = maxMinDistance(sampled2, sampled1);
  return Math.max(d1, d2);
}

/**
 * Find max of minimum distances from points in ring1 to ring2
 */
function maxMinDistance(
  ring1: readonly Position[],
  ring2: readonly Position[]
): number {
  let maxMin = 0;

  for (const p1 of ring1) {
    let minDist = Infinity;
    for (const p2 of ring2) {
      const dist = haversineDistance(p1, p2);
      minDist = Math.min(minDist, dist);
    }
    maxMin = Math.max(maxMin, minDist);
  }

  return maxMin;
}

/**
 * Calculate approximate Intersection over Union (IoU) for two polygons
 * Using a grid-based approximation
 */
function approximateIoU(
  ring1: readonly Position[],
  ring2: readonly Position[]
): number {
  // Calculate bounding box of both rings
  const allPoints = [...ring1, ...ring2];
  const lons = allPoints.map(([lon]) => lon);
  const lats = allPoints.map(([, lat]) => lat);

  // Avoid spread on large arrays (stack overflow risk).
  const minLon = lons.reduce((a, b) => a < b ? a : b, Infinity);
  const maxLon = lons.reduce((a, b) => a > b ? a : b, -Infinity);
  const minLat = lats.reduce((a, b) => a < b ? a : b, Infinity);
  const maxLat = lats.reduce((a, b) => a > b ? a : b, -Infinity);

  // Sample on a grid
  const gridSize = 50;
  const lonStep = (maxLon - minLon) / gridSize;
  const latStep = (maxLat - minLat) / gridSize;

  let intersection = 0;
  let union = 0;

  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      const point: Position = [
        minLon + (i + 0.5) * lonStep,
        minLat + (j + 0.5) * latStep,
      ];

      const in1 = pointInPolygon(point, ring1);
      const in2 = pointInPolygon(point, ring2);

      if (in1 && in2) intersection++;
      if (in1 || in2) union++;
    }
  }

  return union > 0 ? intersection / union : 0;
}

/**
 * Ray casting point-in-polygon test
 */
function pointInPolygon(
  point: Position,
  ring: readonly Position[]
): boolean {
  const [x, y] = point;
  let inside = false;
  const n = ring.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];

    if (
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }

  return inside;
}

// =============================================================================
// Validation Results
// =============================================================================

/**
 * Individual ward validation result
 */
export interface WardValidationResult {
  /** Ward ID */
  readonly wardId: string;

  /** Validation passed */
  readonly passed: boolean;

  /** Metrics */
  readonly metrics: {
    /** Hausdorff distance in meters */
    readonly hausdorffDistance: number;
    /** Area difference ratio */
    readonly areaDifferenceRatio: number;
    /** Centroid distance in meters */
    readonly centroidDistance: number;
    /** Intersection over Union */
    readonly iou: number;
    /** Expected area (m²) */
    readonly expectedArea: number;
    /** Actual area (m²) */
    readonly actualArea: number;
  };

  /** Which checks failed */
  readonly failures: readonly string[];
}

/**
 * Complete validation result for a city
 */
export interface GoldenVectorValidationResult {
  /** City FIPS */
  readonly cityFips: string;

  /** City name */
  readonly cityName: string;

  /** All wards passed */
  readonly passed: boolean;

  /** Individual ward results */
  readonly wardResults: readonly WardValidationResult[];

  /** Summary statistics */
  readonly summary: {
    /** Total wards validated */
    readonly totalWards: number;
    /** Wards that passed */
    readonly passedWards: number;
    /** Average IoU across all wards */
    readonly averageIoU: number;
    /** Maximum Hausdorff distance */
    readonly maxHausdorffDistance: number;
  };

  /** Validation timestamp */
  readonly validatedAt: string;
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validate a single reconstructed ward against its golden vector
 */
export function validateWardAgainstGolden(
  reconstructed: Feature<Polygon>,
  golden: Feature<Polygon>,
  wardId: string,
  config: GoldenVectorConfig = getDefaultGoldenVectorConfig()
): WardValidationResult {
  const failures: string[] = [];

  // Extract exterior rings
  const actualRing = reconstructed.geometry.coordinates[0];
  const expectedRing = golden.geometry.coordinates[0];

  // Calculate metrics
  const hausdorff = hausdorffDistance(actualRing, expectedRing);
  const expectedArea = ringAreaSquareMeters(expectedRing);
  const actualArea = ringAreaSquareMeters(actualRing);
  const areaDiff = Math.abs(actualArea - expectedArea) / expectedArea;

  const actualCentroid = calculateCentroid(actualRing);
  const expectedCentroid = calculateCentroid(expectedRing);
  const centroidDist = haversineDistance(actualCentroid, expectedCentroid);

  const iou = approximateIoU(actualRing, expectedRing);

  // Check against thresholds
  // NaN/Infinity guard — non-finite metrics must fail validation.
  if (!Number.isFinite(hausdorff) || hausdorff > config.maxHausdorffDistance) {
    failures.push(
      `Hausdorff distance ${hausdorff.toFixed(1)}m exceeds max ${config.maxHausdorffDistance}m`
    );
  }

  if (!Number.isFinite(areaDiff) || areaDiff > config.maxAreaDifferenceRatio) {
    failures.push(
      `Area difference ${(areaDiff * 100).toFixed(1)}% exceeds max ${config.maxAreaDifferenceRatio * 100}%`
    );
  }

  if (!Number.isFinite(centroidDist) || centroidDist > config.maxCentroidDistance) {
    failures.push(
      `Centroid distance ${centroidDist.toFixed(1)}m exceeds max ${config.maxCentroidDistance}m`
    );
  }

  if (!Number.isFinite(iou) || iou < config.minOverlapRatio) {
    failures.push(
      `IoU ${(iou * 100).toFixed(1)}% below minimum ${config.minOverlapRatio * 100}%`
    );
  }

  return {
    wardId,
    passed: failures.length === 0,
    metrics: {
      hausdorffDistance: hausdorff,
      areaDifferenceRatio: areaDiff,
      centroidDistance: centroidDist,
      iou,
      expectedArea,
      actualArea,
    },
    failures: Object.freeze(failures),
  };
}

/**
 * Validate all reconstructed wards against a golden vector
 */
export function validateCityAgainstGolden(
  reconstructedPolygons: readonly Feature<Polygon>[],
  goldenVector: GoldenVector,
  config: GoldenVectorConfig = getDefaultGoldenVectorConfig()
): GoldenVectorValidationResult {
  // Build lookup by ward ID
  const reconstructedByWard = new Map<string, Feature<Polygon>>();
  for (const poly of reconstructedPolygons) {
    const wardId = poly.properties?.wardId as string;
    if (wardId) {
      reconstructedByWard.set(wardId, poly);
    }
  }

  const wardResults: WardValidationResult[] = [];
  let totalIoU = 0;
  let maxHausdorff = 0;

  // Validate each expected ward
  for (const expectedPoly of goldenVector.expectedPolygons) {
    const wardId = expectedPoly.properties?.wardId as string;
    const actualPoly = reconstructedByWard.get(wardId);

    if (!actualPoly) {
      wardResults.push({
        wardId,
        passed: false,
        metrics: {
          hausdorffDistance: Infinity,
          areaDifferenceRatio: 1,
          centroidDistance: Infinity,
          iou: 0,
          expectedArea: ringAreaSquareMeters(expectedPoly.geometry.coordinates[0]),
          actualArea: 0,
        },
        failures: [`Ward ${wardId} not found in reconstructed polygons`],
      });
      continue;
    }

    const result = validateWardAgainstGolden(actualPoly, expectedPoly, wardId, config);
    wardResults.push(result);

    totalIoU += result.metrics.iou;
    maxHausdorff = Math.max(maxHausdorff, result.metrics.hausdorffDistance);

    if (config.failFast && !result.passed) {
      break;
    }
  }

  const passedWards = wardResults.filter((r) => r.passed).length;
  const allPassed = passedWards === goldenVector.expectedWardCount;

  return {
    cityFips: goldenVector.cityFips,
    cityName: goldenVector.cityName,
    passed: allPassed,
    wardResults: Object.freeze(wardResults),
    summary: {
      totalWards: goldenVector.expectedWardCount,
      passedWards,
      averageIoU: wardResults.length > 0 ? totalIoU / wardResults.length : 0,
      maxHausdorffDistance: maxHausdorff,
    },
    validatedAt: new Date().toISOString(),
  };
}

// =============================================================================
// Golden Vector Management
// =============================================================================

/**
 * Create a golden vector from verified polygons
 *
 * IMPORTANT: Golden vectors should only be created after human verification
 * of the polygon accuracy against authoritative sources.
 */
export function createGoldenVector(params: {
  readonly cityFips: string;
  readonly cityName: string;
  readonly state: string;
  readonly polygons: readonly Feature<Polygon>[];
  readonly legalDescriptions: readonly import('./types').WardLegalDescription[];
  readonly verificationSource: string;
  readonly notes?: string;
}): GoldenVector {
  return {
    cityFips: params.cityFips,
    cityName: params.cityName,
    state: params.state,
    expectedWardCount: params.polygons.length,
    legalDescriptions: params.legalDescriptions,
    expectedPolygons: params.polygons,
    verifiedAt: new Date().toISOString(),
    verificationSource: params.verificationSource,
    notes: params.notes,
  };
}

/**
 * Serialize golden vector to JSON for storage
 */
export function serializeGoldenVector(vector: GoldenVector): string {
  return JSON.stringify(vector, null, 2);
}

/**
 * Deserialize golden vector from JSON
 */
export function deserializeGoldenVector(json: string): GoldenVector {
  const parsed = JSON.parse(json);

  // Validate all required GoldenVector fields, not just 3.
  if (
    typeof parsed.cityFips !== 'string' ||
    typeof parsed.cityName !== 'string' ||
    typeof parsed.state !== 'string' ||
    typeof parsed.expectedWardCount !== 'number' ||
    !Array.isArray(parsed.expectedPolygons) ||
    !Array.isArray(parsed.legalDescriptions) ||
    typeof parsed.verifiedAt !== 'string' ||
    typeof parsed.verificationSource !== 'string'
  ) {
    throw new Error('Invalid golden vector: missing or malformed required fields');
  }

  return parsed as GoldenVector;
}

// =============================================================================
// Regression Detection
// =============================================================================

/**
 * Compare two validation results to detect regressions
 */
export function detectRegressions(
  previous: GoldenVectorValidationResult,
  current: GoldenVectorValidationResult
): {
  readonly hasRegressions: boolean;
  readonly regressions: readonly string[];
  readonly improvements: readonly string[];
} {
  const regressions: string[] = [];
  const improvements: string[] = [];

  // Overall pass/fail
  if (previous.passed && !current.passed) {
    regressions.push(
      `Overall validation regressed from PASS to FAIL`
    );
  } else if (!previous.passed && current.passed) {
    improvements.push(
      `Overall validation improved from FAIL to PASS`
    );
  }

  // Ward-level comparison
  const prevByWard = new Map(
    previous.wardResults.map((r) => [r.wardId, r])
  );

  for (const curr of current.wardResults) {
    const prev = prevByWard.get(curr.wardId);
    if (!prev) continue;

    if (prev.passed && !curr.passed) {
      regressions.push(
        `Ward ${curr.wardId}: regressed from PASS to FAIL - ${curr.failures.join(', ')}`
      );
    } else if (!prev.passed && curr.passed) {
      improvements.push(
        `Ward ${curr.wardId}: improved from FAIL to PASS`
      );
    }

    // Metric degradation (even if still passing)
    if (curr.metrics.iou < prev.metrics.iou - 0.05) {
      regressions.push(
        `Ward ${curr.wardId}: IoU degraded from ${(prev.metrics.iou * 100).toFixed(1)}% to ${(curr.metrics.iou * 100).toFixed(1)}%`
      );
    }

    if (curr.metrics.hausdorffDistance > prev.metrics.hausdorffDistance * 1.5) {
      regressions.push(
        `Ward ${curr.wardId}: Hausdorff distance degraded from ${prev.metrics.hausdorffDistance.toFixed(1)}m to ${curr.metrics.hausdorffDistance.toFixed(1)}m`
      );
    }
  }

  return {
    hasRegressions: regressions.length > 0,
    regressions: Object.freeze(regressions),
    improvements: Object.freeze(improvements),
  };
}
