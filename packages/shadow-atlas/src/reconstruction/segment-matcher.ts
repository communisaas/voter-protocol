/**
 * Segment Matcher
 *
 * Matches parsed legal description segments to actual street network data.
 * The core "street-snap" engine that reconstructs boundaries from text.
 *
 * PHILOSOPHY:
 * - Boundaries follow streets, not arbitrary coordinates
 * - Match to nearest candidate within tolerance, not best-effort
 * - Binary success (matched or failed, no partial matches in output)
 * - Preserve diagnostic info for human review of failures
 */

import type { Feature, LineString, Position, Polygon, MultiPolygon } from 'geojson';
import type {
  BoundarySegmentDescription,
  StreetSegment,
  StreetNetwork,
  SegmentMatchResult,
  WardMatchResult,
  WardLegalDescription,
} from './types';
import {
  normalizeStreetName,
  streetNameSimilarity,
  type NormalizedStreetName,
} from './street-normalizer';

// =============================================================================
// Configuration
// =============================================================================

/**
 * Matching configuration
 */
export interface MatcherConfig {
  /** Minimum name similarity score for a match (0-1) */
  readonly minNameSimilarity: number;

  /** Maximum distance in meters for snapping to a street */
  readonly maxSnapDistance: number;

  /** Prefer streets that continue in the same direction */
  readonly preferDirectionalContinuity: boolean;

  /** Maximum gap between segments before failing (meters) */
  readonly maxSegmentGap: number;
}

/**
 * Default matching configuration
 */
export function getDefaultMatcherConfig(): MatcherConfig {
  return {
    minNameSimilarity: 0.75,
    maxSnapDistance: 100,
    preferDirectionalContinuity: true,
    maxSegmentGap: 200,
  };
}

// =============================================================================
// Spatial Utilities
// =============================================================================

/**
 * Calculate haversine distance between two points (in meters)
 */
export function haversineDistance(
  [lon1, lat1]: Position,
  [lon2, lat2]: Position
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Find the closest point on a line segment to a given point
 */
function closestPointOnSegment(
  point: Position,
  segStart: Position,
  segEnd: Position
): { point: Position; distance: number; t: number } {
  const [px, py] = point;
  const [x1, y1] = segStart;
  const [x2, y2] = segEnd;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  let t = 0;
  if (lenSq > 0) {
    t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  }

  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;
  const closestPoint: Position = [closestX, closestY];

  return {
    point: closestPoint,
    distance: haversineDistance(point, closestPoint),
    t,
  };
}

/**
 * Find the closest point on a LineString to a given point
 */
function closestPointOnLineString(
  point: Position,
  line: readonly Position[]
): { point: Position; distance: number; segmentIndex: number } {
  let minDistance = Infinity;
  let closestPoint: Position = line[0];
  let segmentIndex = 0;

  for (let i = 0; i < line.length - 1; i++) {
    const result = closestPointOnSegment(point, line[i], line[i + 1]);
    if (result.distance < minDistance) {
      minDistance = result.distance;
      closestPoint = result.point;
      segmentIndex = i;
    }
  }

  return { point: closestPoint, distance: minDistance, segmentIndex };
}

/**
 * Calculate bearing between two points (in degrees, 0 = north)
 */
function calculateBearing([lon1, lat1]: Position, [lon2, lat2]: Position): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

/**
 * Compute line-line intersection using parametric equations
 * Returns null if lines are parallel or don't intersect
 * Returns the intersection point and parametric positions (t1, t2)
 *
 * If 0 <= t1 <= 1 and 0 <= t2 <= 1, intersection is within both segments
 * Otherwise, the lines would intersect if extended
 */
function computeLineIntersection(
  p1: Position,
  p2: Position,
  p3: Position,
  p4: Position
): { point: Position; t1: number; t2: number } | null {
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const [x3, y3] = p3;
  const [x4, y4] = p4;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);

  // Lines are parallel (or coincident)
  if (Math.abs(denom) < 1e-10) {
    return null;
  }

  const t1 = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const t2 = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

  // Compute intersection point
  const x = x1 + t1 * (x2 - x1);
  const y = y1 + t1 * (y2 - y1);

  return {
    point: [x, y],
    t1,
    t2,
  };
}

/**
 * Find geometric intersection between two street segments
 * Handles both actual crossings and near-miss cases with snap tolerance
 */
function findStreetIntersection(
  street1: StreetSegment,
  street2: StreetSegment,
  snapToleranceMeters: number
): { point: Position; distance: number; type: 'crossing' | 'endpoint' | 'near-miss' } | null {
  const coords1 = street1.geometry.geometry.coordinates;
  const coords2 = street2.geometry.geometry.coordinates;

  let bestIntersection: { point: Position; distance: number; type: 'crossing' | 'endpoint' | 'near-miss' } | null = null;
  let minDistance = Infinity;

  // Check all segment pairs for geometric intersections
  for (let i = 0; i < coords1.length - 1; i++) {
    for (let j = 0; j < coords2.length - 1; j++) {
      const seg1Start = coords1[i];
      const seg1End = coords1[i + 1];
      const seg2Start = coords2[j];
      const seg2End = coords2[j + 1];

      const intersection = computeLineIntersection(
        seg1Start,
        seg1End,
        seg2Start,
        seg2End
      );

      if (!intersection) continue;

      const { point, t1, t2 } = intersection;

      // Check if intersection is within both segments (actual crossing)
      if (t1 >= 0 && t1 <= 1 && t2 >= 0 && t2 <= 1) {
        // Verify distance is reasonable (sanity check for geo coordinates)
        const distToSeg1Start = haversineDistance(point, seg1Start);
        if (distToSeg1Start < snapToleranceMeters * 10) {
          return {
            point,
            distance: 0,
            type: 'crossing',
          };
        }
      }

      // Check if intersection is near either segment (near-miss case)
      // This handles OSM data where streets don't quite connect
      const closest1 = closestPointOnSegment(point, seg1Start, seg1End);
      const closest2 = closestPointOnSegment(point, seg2Start, seg2End);

      // Use midpoint of closest approach as intersection candidate
      const midpoint: Position = [
        (closest1.point[0] + closest2.point[0]) / 2,
        (closest1.point[1] + closest2.point[1]) / 2,
      ];
      const dist = haversineDistance(closest1.point, closest2.point);

      if (dist < minDistance && dist < snapToleranceMeters) {
        minDistance = dist;
        bestIntersection = {
          point: midpoint,
          distance: dist,
          type: 'near-miss',
        };
      }
    }
  }

  // Check endpoints (streets that meet at vertices)
  for (const p1 of coords1) {
    for (const p2 of coords2) {
      const dist = haversineDistance(p1, p2);
      if (dist < minDistance && dist < snapToleranceMeters) {
        minDistance = dist;
        bestIntersection = {
          point: [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2],
          distance: dist,
          type: 'endpoint',
        };
      }
    }
  }

  return bestIntersection;
}

/**
 * Check if a bearing matches a cardinal direction
 */
function bearingMatchesDirection(
  bearing: number,
  direction: string | undefined
): boolean {
  if (!direction) return true; // No direction specified, any bearing is acceptable

  const normalized = direction.toLowerCase().replace('erly', '');
  const ranges: Record<string, [number, number][]> = {
    north: [[315, 360], [0, 45]],
    east: [[45, 135]],
    south: [[135, 225]],
    west: [[225, 315]],
    northeast: [[22.5, 67.5]],
    southeast: [[112.5, 157.5]],
    southwest: [[202.5, 247.5]],
    northwest: [[292.5, 337.5]],
  };

  const validRanges = ranges[normalized];
  if (!validRanges) return true;

  return validRanges.some(([min, max]) => bearing >= min && bearing <= max);
}

// =============================================================================
// Candidate Scoring
// =============================================================================

/**
 * Score for a street segment candidate
 */
interface CandidateScore {
  readonly segment: StreetSegment;
  readonly nameSimilarity: number;
  readonly distanceScore: number;
  readonly directionScore: number;
  readonly totalScore: number;
}

/**
 * Score a street segment candidate against a description segment
 */
function scoreCandidateSegment(
  candidate: StreetSegment,
  description: BoundarySegmentDescription,
  normalizedDescName: NormalizedStreetName,
  referencePoint: Position | null,
  config: MatcherConfig
): CandidateScore {
  // Name similarity
  const candidateName = normalizeStreetName(candidate.name);
  const nameSimilarity = streetNameSimilarity(normalizedDescName, candidateName);

  // Also check alt names
  let bestNameSim = nameSimilarity;
  for (const altName of candidate.altNames) {
    const altNormalized = normalizeStreetName(altName);
    const altSim = streetNameSimilarity(normalizedDescName, altNormalized);
    bestNameSim = Math.max(bestNameSim, altSim);
  }

  // Distance score (1.0 at 0 meters, 0.0 at maxSnapDistance)
  let distanceScore = 1.0;
  if (referencePoint) {
    const coords = candidate.geometry.geometry.coordinates;
    const closest = closestPointOnLineString(referencePoint, coords);
    distanceScore = Math.max(
      0,
      1 - closest.distance / config.maxSnapDistance
    );
  }

  // Direction score
  let directionScore = 1.0;
  if (description.direction && candidate.geometry.geometry.coordinates.length >= 2) {
    const coords = candidate.geometry.geometry.coordinates;
    const start = coords[0];
    const end = coords[coords.length - 1];
    const bearing = calculateBearing(start, end);
    directionScore = bearingMatchesDirection(bearing, description.direction) ? 1.0 : 0.5;
  }

  // Weighted total score
  const totalScore =
    bestNameSim * 0.5 + // Name is most important
    distanceScore * 0.3 + // Distance is second
    directionScore * 0.2; // Direction is third

  return {
    segment: candidate,
    nameSimilarity: bestNameSim,
    distanceScore,
    directionScore,
    totalScore,
  };
}

// =============================================================================
// Street Network Query
// =============================================================================

/**
 * Query interface for street network
 */
export interface StreetNetworkQuery {
  /** Find streets by normalized name */
  findByName(normalizedName: string): readonly StreetSegment[];

  /** Find streets within a bounding box */
  findInBbox(
    minLon: number,
    minLat: number,
    maxLon: number,
    maxLat: number
  ): readonly StreetSegment[];

  /** Find streets near a point */
  findNearPoint(point: Position, radiusMeters: number): readonly StreetSegment[];
}

/**
 * Simple in-memory street network query implementation
 */
export class SimpleStreetNetworkQuery implements StreetNetworkQuery {
  private readonly segments: readonly StreetSegment[];
  private readonly byName: Map<string, StreetSegment[]>;

  constructor(segments: readonly StreetSegment[]) {
    this.segments = segments;
    this.byName = new Map();

    // Index by normalized name
    for (const seg of segments) {
      const normalized = normalizeStreetName(seg.name).normalized;
      const existing = this.byName.get(normalized) ?? [];
      existing.push(seg);
      this.byName.set(normalized, existing);

      // Also index alt names
      for (const alt of seg.altNames) {
        const altNorm = normalizeStreetName(alt).normalized;
        const altExisting = this.byName.get(altNorm) ?? [];
        altExisting.push(seg);
        this.byName.set(altNorm, altExisting);
      }
    }
  }

  findByName(normalizedName: string): readonly StreetSegment[] {
    const normalized = normalizeStreetName(normalizedName).normalized;
    return this.byName.get(normalized) ?? [];
  }

  findInBbox(
    minLon: number,
    minLat: number,
    maxLon: number,
    maxLat: number
  ): readonly StreetSegment[] {
    return this.segments.filter((seg) => {
      const [bMinLon, bMinLat, bMaxLon, bMaxLat] = seg.bbox;
      return !(
        bMaxLon < minLon ||
        bMinLon > maxLon ||
        bMaxLat < minLat ||
        bMinLat > maxLat
      );
    });
  }

  findNearPoint(point: Position, radiusMeters: number): readonly StreetSegment[] {
    // Convert radius to approximate degrees (rough approximation)
    const radiusDeg = radiusMeters / 111000;
    const [lon, lat] = point;

    const bbox = this.findInBbox(
      lon - radiusDeg,
      lat - radiusDeg,
      lon + radiusDeg,
      lat + radiusDeg
    );

    // Filter by actual distance
    return bbox.filter((seg) => {
      const closest = closestPointOnLineString(
        point,
        seg.geometry.geometry.coordinates
      );
      return closest.distance <= radiusMeters;
    });
  }
}

// =============================================================================
// Contiguous Segment Selection
// =============================================================================

/**
 * Find contiguous segments starting from a reference point
 *
 * When multiple segments match a street name (e.g., 96 segments for "Watson Road"),
 * this selects only the contiguous chain that:
 * 1. Starts near the reference point (last matched coordinate)
 * 2. Chains segments that share endpoints
 * 3. Stops when no more connected segments are found
 */
function findContiguousSegments(
  candidates: readonly StreetSegment[],
  referencePoint: Position | null,
  config: MatcherConfig
): readonly StreetSegment[] {
  if (candidates.length === 0) {
    return [];
  }

  // If no reference point or only one candidate, return best single segment
  if (!referencePoint || candidates.length === 1) {
    return [candidates[0]];
  }

  // Find the segment with an endpoint closest to the reference point
  let bestStartSegment: StreetSegment | null = null;
  let minStartDistance = Infinity;
  let useStartPoint = true; // Whether to use start or end of the segment

  for (const candidate of candidates) {
    const coords = candidate.geometry.geometry.coordinates;
    if (coords.length < 2) continue;

    const startPoint = coords[0];
    const endPoint = coords[coords.length - 1];

    const distToStart = haversineDistance(referencePoint, startPoint);
    const distToEnd = haversineDistance(referencePoint, endPoint);

    if (distToStart < minStartDistance) {
      minStartDistance = distToStart;
      bestStartSegment = candidate;
      useStartPoint = true;
    }

    if (distToEnd < minStartDistance) {
      minStartDistance = distToEnd;
      bestStartSegment = candidate;
      useStartPoint = false;
    }
  }

  if (!bestStartSegment || minStartDistance > config.maxSnapDistance) {
    // No segment close enough to reference point, return best by name similarity
    return [candidates[0]];
  }

  // Build chain of connected segments
  const chain: StreetSegment[] = [bestStartSegment];
  const used = new Set<string>([bestStartSegment.id]);

  // Get the endpoint where we'll look for the next segment
  const startCoords = bestStartSegment.geometry.geometry.coordinates;
  let currentEndpoint: Position = useStartPoint
    ? startCoords[startCoords.length - 1]
    : startCoords[0];

  // Maximum chain length to prevent infinite loops
  const maxChainLength = Math.min(candidates.length, 50);
  const connectionTolerance = 50; // meters - two segments must be within 50m to connect

  // Chain segments until we can't find a connected one
  while (chain.length < maxChainLength) {
    let nextSegment: StreetSegment | null = null;
    let nextUseStart = true;
    let minConnectionDist = Infinity;

    // Find the next segment that connects to our current endpoint
    for (const candidate of candidates) {
      if (used.has(candidate.id)) continue;

      const coords = candidate.geometry.geometry.coordinates;
      if (coords.length < 2) continue;

      const candidateStart = coords[0];
      const candidateEnd = coords[coords.length - 1];

      const distToStart = haversineDistance(currentEndpoint, candidateStart);
      const distToEnd = haversineDistance(currentEndpoint, candidateEnd);

      // Check if this segment connects to our current endpoint
      if (distToStart < minConnectionDist && distToStart <= connectionTolerance) {
        minConnectionDist = distToStart;
        nextSegment = candidate;
        nextUseStart = true;
      }

      if (distToEnd < minConnectionDist && distToEnd <= connectionTolerance) {
        minConnectionDist = distToEnd;
        nextSegment = candidate;
        nextUseStart = false;
      }
    }

    // If no connected segment found, stop chaining
    if (!nextSegment) {
      break;
    }

    // Add to chain and update current endpoint
    chain.push(nextSegment);
    used.add(nextSegment.id);

    const nextCoords = nextSegment.geometry.geometry.coordinates;
    currentEndpoint = nextUseStart
      ? nextCoords[nextCoords.length - 1]
      : nextCoords[0];
  }

  return chain;
}

/**
 * Merge contiguous segments into a single coordinate array
 */
function mergeSegmentCoordinates(
  segments: readonly StreetSegment[],
  referencePoint: Position | null,
  config: MatcherConfig
): readonly Position[] {
  if (segments.length === 0) {
    return [];
  }

  if (segments.length === 1) {
    return segments[0].geometry.geometry.coordinates;
  }

  const allCoords: Position[] = [];

  // Add first segment's coordinates
  const firstSegment = segments[0];
  const firstCoords = firstSegment.geometry.geometry.coordinates;

  // If we have a reference point, check if we should reverse the first segment
  if (referencePoint && firstCoords.length >= 2) {
    const distToStart = haversineDistance(referencePoint, firstCoords[0]);
    const distToEnd = haversineDistance(referencePoint, firstCoords[firstCoords.length - 1]);

    // If end is closer, we should reverse to start from reference point
    if (distToEnd < distToStart) {
      allCoords.push(...[...firstCoords].reverse());
    } else {
      allCoords.push(...firstCoords);
    }
  } else {
    allCoords.push(...firstCoords);
  }

  // Add remaining segments, checking orientation
  for (let i = 1; i < segments.length; i++) {
    const prevEndpoint = allCoords[allCoords.length - 1];
    const currentCoords = segments[i].geometry.geometry.coordinates;

    if (currentCoords.length < 2) continue;

    const distToStart = haversineDistance(prevEndpoint, currentCoords[0]);
    const distToEnd = haversineDistance(prevEndpoint, currentCoords[currentCoords.length - 1]);

    // Skip duplicate first point if segments overlap
    const skipFirst = distToStart < 10; // Within 10m, consider it a duplicate
    const reversed = distToEnd < distToStart;

    if (reversed) {
      const reversedCoords = [...currentCoords].reverse();
      allCoords.push(...(skipFirst ? reversedCoords.slice(1) : reversedCoords));
    } else {
      allCoords.push(...(skipFirst ? currentCoords.slice(1) : currentCoords));
    }
  }

  return allCoords;
}

// =============================================================================
// Segment Matching
// =============================================================================

/**
 * Match a single description segment to street network
 */
export function matchSegment(
  description: BoundarySegmentDescription,
  query: StreetNetworkQuery,
  referencePoint: Position | null,
  config: MatcherConfig
): SegmentMatchResult {
  const normalizedDesc = normalizeStreetName(description.featureName);

  // Special handling for non-street references
  if (description.referenceType === 'municipal_boundary') {
    // Municipal boundaries need special handling - they aren't in street network
    return {
      description,
      matchedSegments: [],
      matchQuality: 'partial',
      coordinates: [],
      diagnostics: {
        nameSimilarity: 1.0,
        distanceToCandidate: 0,
        alternativesConsidered: 0,
        reason: 'Municipal boundary - requires external boundary data',
      },
    };
  }

  // Special handling for intersection starting points
  if (description.referenceType === 'coordinate' && description.featureName.startsWith('intersection:')) {
    // Parse intersection: "intersection:Street1:Street2"
    const parts = description.featureName.split(':');
    if (parts.length >= 3) {
      const street1 = parts[1];
      const street2 = parts[2];

      // Find both streets and compute their intersection
      const segments1 = query.findByName(street1);
      const segments2 = query.findByName(street2);

      if (segments1.length > 0 && segments2.length > 0) {
        // Find the geometric intersection between streets
        let bestIntersection: { point: Position; distance: number; type: string } | null = null;
        let bestPair: { s1: StreetSegment; s2: StreetSegment } | null = null;

        // If we have a reference point, use it to disambiguate multiple intersections
        for (const s1 of segments1) {
          for (const s2 of segments2) {
            const intersection = findStreetIntersection(
              s1,
              s2,
              config.maxSnapDistance
            );

            if (!intersection) continue;

            // If we have a reference point, prefer intersection closest to it
            if (referencePoint) {
              const distToRef = haversineDistance(intersection.point, referencePoint);
              if (!bestIntersection || distToRef < haversineDistance(bestIntersection.point, referencePoint)) {
                bestIntersection = intersection;
                bestPair = { s1, s2 };
              }
            } else if (!bestIntersection || intersection.distance < bestIntersection.distance) {
              // No reference point, prefer best quality intersection
              bestIntersection = intersection;
              bestPair = { s1, s2 };
            }
          }
        }

        if (bestIntersection && bestPair) {
          const quality = bestIntersection.type === 'crossing' ? 'exact' : 'fuzzy';
          return {
            description,
            matchedSegments: [bestPair.s1, bestPair.s2],
            matchQuality: quality,
            coordinates: [bestIntersection.point],
            diagnostics: {
              nameSimilarity: 1.0,
              distanceToCandidate: bestIntersection.distance,
              alternativesConsidered: segments1.length * segments2.length - 1,
              reason: `Intersection found (${bestIntersection.type}) at ${bestIntersection.distance.toFixed(1)}m precision`,
            },
          };
        }
      }

      // Could not find intersection
      return {
        description,
        matchedSegments: [],
        matchQuality: 'failed',
        coordinates: [],
        diagnostics: {
          nameSimilarity: 0,
          distanceToCandidate: Infinity,
          alternativesConsidered: segments1.length * segments2.length,
          reason: `Could not find intersection of "${street1}" and "${street2}" within ${config.maxSnapDistance}m tolerance`,
        },
      };
    }
  }

  // Get candidates by name
  let candidates = query.findByName(description.featureName);

  // If no direct matches, try fuzzy search in nearby area
  if (candidates.length === 0 && referencePoint) {
    const nearby = query.findNearPoint(referencePoint, config.maxSnapDistance * 2);
    candidates = nearby.filter((seg) => {
      const segNorm = normalizeStreetName(seg.name);
      return streetNameSimilarity(normalizedDesc, segNorm) >= config.minNameSimilarity;
    });
  }

  // If still no candidates, this is a failed match
  if (candidates.length === 0) {
    return {
      description,
      matchedSegments: [],
      matchQuality: 'failed',
      coordinates: [],
      diagnostics: {
        nameSimilarity: 0,
        distanceToCandidate: Infinity,
        alternativesConsidered: 0,
        reason: `No street found matching "${description.featureName}"`,
      },
    };
  }

  // Score all candidates for initial filtering
  const scored = candidates.map((c) =>
    scoreCandidateSegment(c, description, normalizedDesc, referencePoint, config)
  );

  // Sort by total score
  scored.sort((a, b) => b.totalScore - a.totalScore);

  // Filter candidates to only those meeting minimum thresholds
  const validCandidates = scored
    .filter(s => s.nameSimilarity >= config.minNameSimilarity)
    .map(s => s.segment);

  if (validCandidates.length === 0) {
    // No candidates meet threshold
    const best = scored[0];
    return {
      description,
      matchedSegments: [],
      matchQuality: 'failed',
      coordinates: [],
      diagnostics: {
        nameSimilarity: best?.nameSimilarity ?? 0,
        distanceToCandidate: Infinity,
        alternativesConsidered: scored.length,
        reason: `Best candidate similarity ${best?.nameSimilarity.toFixed(2) ?? 0} below threshold ${config.minNameSimilarity}`,
      },
    };
  }

  // Find contiguous segments if we have multiple candidates
  const contiguousSegments = findContiguousSegments(validCandidates, referencePoint, config);

  // Merge coordinates from contiguous segments
  const coords = mergeSegmentCoordinates(contiguousSegments, referencePoint, config);

  // Determine match quality based on best candidate
  const best = scored[0];
  let matchQuality: 'exact' | 'fuzzy' | 'partial' | 'failed';
  if (best.nameSimilarity >= 0.95 && best.distanceScore >= 0.8) {
    matchQuality = 'exact';
  } else if (best.nameSimilarity >= config.minNameSimilarity && best.distanceScore >= 0.5) {
    matchQuality = 'fuzzy';
  } else if (best.nameSimilarity >= config.minNameSimilarity) {
    matchQuality = 'partial';
  } else {
    matchQuality = 'failed';
  }

  const segmentDescription = contiguousSegments.length > 1
    ? `${contiguousSegments.length} contiguous segments`
    : 'single segment';

  return {
    description,
    matchedSegments: contiguousSegments,
    matchQuality,
    coordinates: coords,
    diagnostics: {
      nameSimilarity: best.nameSimilarity,
      distanceToCandidate:
        referencePoint
          ? closestPointOnLineString(referencePoint, coords).distance
          : 0,
      alternativesConsidered: scored.length - 1,
      reason:
        matchQuality === 'exact'
          ? `Exact match (${segmentDescription})`
          : matchQuality === 'fuzzy'
            ? `Fuzzy match with similarity ${best.nameSimilarity.toFixed(2)} (${segmentDescription})`
            : matchQuality === 'partial'
              ? `Partial match - location mismatch (${segmentDescription})`
              : `Best candidate similarity ${best.nameSimilarity.toFixed(2)} below threshold`,
    },
  };
}

/**
 * Match all segments in a ward legal description
 */
export function matchWardDescription(
  description: WardLegalDescription,
  query: StreetNetworkQuery,
  config: MatcherConfig = getDefaultMatcherConfig()
): WardMatchResult {
  const segmentMatches: SegmentMatchResult[] = [];
  const failedSegments: number[] = [];
  let lastPoint: Position | null = null;

  // Match each segment in order
  for (const segment of description.segments) {
    const match = matchSegment(segment, query, lastPoint, config);
    segmentMatches.push(match);

    if (match.matchQuality === 'failed') {
      failedSegments.push(segment.index);
    } else if (match.coordinates.length > 0) {
      // Update last point for continuity
      lastPoint = match.coordinates[match.coordinates.length - 1];
    }
  }

  // Build polygon if successful
  let polygon: Feature<Polygon | MultiPolygon> | null = null;
  let ringClosed = false;
  let geometryValid = false;

  if (failedSegments.length === 0 && segmentMatches.length > 0) {
    // Collect all coordinates
    const allCoords: Position[] = [];
    for (const match of segmentMatches) {
      // Avoid duplicating points at segment junctions
      if (allCoords.length > 0 && match.coordinates.length > 0) {
        const lastCoord = allCoords[allCoords.length - 1];
        const firstCoord = match.coordinates[0];
        const gap = haversineDistance(lastCoord, firstCoord);
        if (gap > config.maxSegmentGap) {
          // Gap too large - this is a failure
          failedSegments.push(match.description.index);
          continue;
        }
      }
      allCoords.push(...match.coordinates);
    }

    // Check if ring closes
    if (allCoords.length >= 4) {
      const first = allCoords[0];
      const last = allCoords[allCoords.length - 1];
      const closingGap = haversineDistance(first, last);

      if (closingGap <= config.maxSegmentGap) {
        // Close the ring
        const closedRing = [...allCoords, first];
        ringClosed = true;

        // Create polygon feature
        polygon = {
          type: 'Feature',
          properties: {
            wardId: description.wardId,
            wardName: description.wardName,
            cityFips: description.cityFips,
          },
          geometry: {
            type: 'Polygon',
            coordinates: [closedRing],
          },
        };

        // Basic validity check (enough points, closed)
        geometryValid = closedRing.length >= 4;
      }
    }
  }

  // Calculate diagnostics
  const totalSegments = description.segments.length;
  const matchedCount = totalSegments - failedSegments.length;

  return {
    description,
    segmentMatches: Object.freeze(segmentMatches),
    success: failedSegments.length === 0 && polygon !== null,
    failedSegments: Object.freeze(failedSegments),
    polygon,
    diagnostics: {
      totalSegments,
      matchedSegments: matchedCount,
      matchRate: totalSegments > 0 ? matchedCount / totalSegments : 0,
      ringClosed,
      geometryValid,
    },
  };
}

// =============================================================================
// Batch Processing
// =============================================================================

/**
 * Match multiple ward descriptions (batch processing)
 */
export function matchCityWards(
  descriptions: readonly WardLegalDescription[],
  query: StreetNetworkQuery,
  config?: MatcherConfig
): readonly WardMatchResult[] {
  return descriptions.map((desc) => matchWardDescription(desc, query, config));
}
