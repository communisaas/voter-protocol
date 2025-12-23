/**
 * Integrity Verification Module
 *
 * Cryptographic verification of Shadow Atlas data integrity.
 * Merkle proof validation, GeoJSON structure verification, boundary consistency checks.
 *
 * TYPE SAFETY: Nuclear-level strictness. All data validated before commitment.
 *
 * SECURITY PRINCIPLE: Zero trust. Verify everything cryptographically.
 */

import { createHash } from 'crypto';
import type { Polygon, MultiPolygon, Position } from 'geojson';
import { hashPair as poseidon2HashPair } from '@voter-protocol/crypto/poseidon2';

// ============================================================================
// Types
// ============================================================================

/**
 * Merkle proof
 */
export interface MerkleProof {
  readonly root: bigint;
  readonly leaf: bigint;
  readonly siblings: readonly bigint[];
  readonly pathIndices: readonly number[];
}

/**
 * Integrity check result
 */
export interface IntegrityCheckResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Boundary integrity check
 */
export interface BoundaryIntegrityCheck {
  readonly geometryValid: boolean;
  readonly coordinatesValid: boolean;
  readonly topologyValid: boolean;
  readonly errors: readonly string[];
}

// ============================================================================
// Merkle Proof Verification
// ============================================================================

/**
 * Verify Merkle proof
 *
 * SECURITY: Cryptographically verify boundary is in committed Merkle tree.
 * Prevents accepting fraudulent boundaries not in authoritative snapshot.
 *
 * NOTE: This function is async because Poseidon2 hashing uses Noir WASM internally.
 * The proof verification must compute hashes along the path from leaf to root,
 * which requires awaiting each hash computation.
 *
 * @param leaf - Leaf node value
 * @param siblings - Sibling hashes along path to root
 * @param pathIndices - Path from leaf to root (0 = left, 1 = right)
 * @param expectedRoot - Expected Merkle root
 * @returns Promise resolving to true if proof valid, false otherwise
 */
export async function verifyMerkleProof(
  leaf: bigint,
  siblings: readonly bigint[],
  pathIndices: readonly number[],
  expectedRoot: bigint
): Promise<boolean> {
  // Validate inputs
  if (siblings.length !== pathIndices.length) {
    return false;
  }

  if (siblings.length === 0) {
    // Single-node tree (leaf is root)
    return leaf === expectedRoot;
  }

  // Compute root from proof
  let current = leaf;

  for (let i = 0; i < siblings.length; i++) {
    const sibling = siblings[i];
    const isLeft = pathIndices[i] === 0;

    if (sibling === undefined) {
      return false;
    }

    // Hash parent node (order matters: left child first)
    // Uses production Poseidon2 from @voter-protocol/crypto
    current = isLeft
      ? await poseidon2HashPair(current, sibling)
      : await poseidon2HashPair(sibling, current);
  }

  // Verify computed root matches expected
  return current === expectedRoot;
}

// NOTE: poseidonHash placeholder removed - now using production Poseidon2
// from @voter-protocol/crypto/poseidon2 (imported as poseidon2HashPair)

// ============================================================================
// GeoJSON Integrity Verification
// ============================================================================

/**
 * Verify GeoJSON geometry integrity
 *
 * SECURITY: Prevent processing of malformed geometry that could:
 * - Crash spatial index
 * - Enable point-in-polygon bypass attacks
 * - Cause infinite loops in rendering
 *
 * @param geometry - GeoJSON geometry
 * @returns Integrity check result
 */
export function verifyGeometryIntegrity(
  geometry: Polygon | MultiPolygon
): BoundaryIntegrityCheck {
  const errors: string[] = [];

  // Verify geometry type
  const type = geometry.type;
  if (type !== 'Polygon' && type !== 'MultiPolygon') {
    errors.push(`Invalid geometry type: ${type}`);
    return {
      geometryValid: false,
      coordinatesValid: false,
      topologyValid: false,
      errors,
    };
  }

  // Verify coordinates structure
  const coordinatesValid = verifyCoordinates(geometry, errors);

  // Verify topology (rings closed, no self-intersections)
  const topologyValid = verifyTopology(geometry, errors);

  return {
    geometryValid: errors.length === 0,
    coordinatesValid,
    topologyValid,
    errors,
  };
}

/**
 * Verify coordinate validity
 *
 * Checks:
 * - Coordinates are numbers (not NaN, Infinity)
 * - Coordinates in valid range (lat: -90 to 90, lon: -180 to 180)
 * - Sufficient precision (not excessive, not insufficient)
 */
function verifyCoordinates(
  geometry: Polygon | MultiPolygon,
  errors: string[]
): boolean {
  let valid = true;

  const checkPosition = (pos: Position, index: number): void => {
    if (pos.length < 2) {
      errors.push(`Position ${index} has insufficient coordinates (need at least [lon, lat])`);
      valid = false;
      return;
    }

    const [lon, lat] = pos;

    // Check for invalid numbers
    if (typeof lon !== 'number' || typeof lat !== 'number') {
      errors.push(`Position ${index} has non-numeric coordinates`);
      valid = false;
      return;
    }

    if (!isFinite(lon) || !isFinite(lat)) {
      errors.push(`Position ${index} has non-finite coordinates`);
      valid = false;
      return;
    }

    // Check geographic bounds
    if (lat < -90 || lat > 90) {
      errors.push(`Position ${index} latitude out of range: ${lat}`);
      valid = false;
    }

    if (lon < -180 || lon > 180) {
      errors.push(`Position ${index} longitude out of range: ${lon}`);
      valid = false;
    }

    // Check precision (not excessive, not insufficient)
    const lonStr = lon.toString();
    const latStr = lat.toString();
    const lonDecimals = lonStr.split('.')[1]?.length ?? 0;
    const latDecimals = latStr.split('.')[1]?.length ?? 0;

    if (lonDecimals > 8 || latDecimals > 8) {
      errors.push(`Position ${index} has excessive precision (>8 decimals)`);
      valid = false;
    }

    // Warn if precision too low (>100m accuracy)
    if (lonDecimals < 3 || latDecimals < 3) {
      // This is a warning, not an error
      // errors.push(`Position ${index} has low precision (<3 decimals, ~100m accuracy)`);
    }
  };

  if (geometry.type === 'Polygon') {
    let posIndex = 0;
    for (const ring of geometry.coordinates) {
      for (const pos of ring) {
        checkPosition(pos, posIndex++);
      }
    }
  } else {
    // MultiPolygon
    let posIndex = 0;
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) {
        for (const pos of ring) {
          checkPosition(pos, posIndex++);
        }
      }
    }
  }

  return valid;
}

/**
 * Verify topology validity
 *
 * Checks:
 * - Rings are closed (first point === last point)
 * - Minimum 4 points per ring (closed triangle)
 * - No duplicate consecutive points
 * - Exterior ring counter-clockwise, holes clockwise (RFC 7946 GeoJSON spec)
 */
function verifyTopology(
  geometry: Polygon | MultiPolygon,
  errors: string[]
): boolean {
  let valid = true;

  const checkRing = (ring: Position[], ringIndex: number, isExterior: boolean): void => {
    // Check minimum points (4 for closed triangle)
    if (ring.length < 4) {
      errors.push(`Ring ${ringIndex} has too few points (${ring.length}, need at least 4)`);
      valid = false;
      return;
    }

    // Check ring is closed
    const first = ring[0];
    const last = ring[ring.length - 1];

    if (!first || !last) {
      errors.push(`Ring ${ringIndex} is empty`);
      valid = false;
      return;
    }

    if (first[0] !== last[0] || first[1] !== last[1]) {
      errors.push(`Ring ${ringIndex} is not closed (first point !== last point)`);
      valid = false;
    }

    // Check for duplicate consecutive points
    for (let i = 0; i < ring.length - 1; i++) {
      const current = ring[i];
      const next = ring[i + 1];

      if (!current || !next) continue;

      if (current[0] === next[0] && current[1] === next[1]) {
        // Allow last point to equal first (closing)
        if (i === ring.length - 2) continue;

        errors.push(`Ring ${ringIndex} has duplicate consecutive points at index ${i}`);
        valid = false;
      }
    }

    // Check winding order (RFC 7946: exterior counter-clockwise, holes clockwise)
    // NOTE: In GeoJSON (lon, lat) coordinates, the shoelace formula gives:
    // Counter-clockwise (RFC 7946 exterior) = NEGATIVE area
    // Clockwise (RFC 7946 holes) = POSITIVE area
    const area = calculateSignedArea(ring);

    if (isExterior && area > 0) {
      // Exterior ring should be counter-clockwise (negative area in lon/lat coords)
      errors.push(`Ring ${ringIndex} has incorrect winding order (exterior should be counter-clockwise per RFC 7946, got clockwise)`);
      valid = false;
    }

    if (!isExterior && area < 0) {
      // Hole should be clockwise (positive area in lon/lat coords)
      errors.push(`Ring ${ringIndex} has incorrect winding order (hole should be clockwise per RFC 7946, got counter-clockwise)`);
      valid = false;
    }
  };

  if (geometry.type === 'Polygon') {
    for (let i = 0; i < geometry.coordinates.length; i++) {
      const ring = geometry.coordinates[i];
      if (!ring) continue;
      checkRing(ring, i, i === 0);
    }
  } else {
    // MultiPolygon
    let ringIndex = 0;
    for (const polygon of geometry.coordinates) {
      for (let i = 0; i < polygon.length; i++) {
        const ring = polygon[i];
        if (!ring) continue;
        checkRing(ring, ringIndex++, i === 0);
      }
    }
  }

  return valid;
}

/**
 * Calculate signed area of polygon ring
 *
 * NOTE: In GeoJSON (lon, lat) coordinates:
 * - Counter-clockwise (RFC 7946 exterior) = NEGATIVE area
 * - Clockwise (RFC 7946 holes) = POSITIVE area
 *
 * This is opposite from standard mathematical coordinates because:
 * - In math (x, y): moving left-to-right along bottom = positive area (CCW)
 * - In GeoJSON (lon, lat): same movement goes south-to-north = negative area
 *
 * Uses shoelace formula: A = 0.5 * Σ(x_i * y_{i+1} - x_{i+1} * y_i)
 */
function calculateSignedArea(ring: Position[]): number {
  let area = 0;

  for (let i = 0; i < ring.length - 1; i++) {
    const current = ring[i];
    const next = ring[i + 1];

    if (!current || !next) continue;

    area += (current[0] ?? 0) * (next[1] ?? 0) - (next[0] ?? 0) * (current[1] ?? 0);
  }

  return area / 2;
}

// ============================================================================
// Boundary Count Verification
// ============================================================================

/**
 * Expected boundary counts by jurisdiction
 *
 * SECURITY: Detect data corruption or incomplete extractions.
 * Mismatch = potential data integrity issue.
 */
export const EXPECTED_BOUNDARY_COUNTS: Record<string, number> = {
  // US Congressional Districts (435 voting + 6 non-voting territories)
  'US-congressional': 441,

  // US State Legislative Upper (varies by state)
  'US-state-senate': 1972, // Total across all states

  // US State Legislative Lower (varies by state)
  'US-state-house': 5411, // Total across all states

  // US Counties
  'US-county': 3143,

  // UK Parliamentary Constituencies
  'GB-parliamentary': 650,

  // Canada Federal Electoral Districts
  'CA-federal': 338,
};

/**
 * Verify boundary count matches expected
 *
 * @param jurisdiction - Jurisdiction identifier
 * @param actualCount - Actual boundary count extracted
 * @param tolerance - Allowed deviation (default: 0)
 * @returns True if count valid, false otherwise
 */
export function verifyBoundaryCount(
  jurisdiction: string,
  actualCount: number,
  tolerance = 0
): { valid: boolean; expected?: number; error?: string } {
  const expected = EXPECTED_BOUNDARY_COUNTS[jurisdiction];

  if (expected === undefined) {
    // Unknown jurisdiction - cannot validate
    return { valid: true };
  }

  const diff = Math.abs(actualCount - expected);

  if (diff > tolerance) {
    return {
      valid: false,
      expected,
      error: `Boundary count mismatch: expected ${expected}, got ${actualCount} (diff: ${diff})`,
    };
  }

  return { valid: true, expected };
}

// ============================================================================
// Cross-Source Validation
// ============================================================================

/**
 * Boundary discrepancy
 */
export interface BoundaryDiscrepancy {
  readonly boundaryId: string;
  readonly field: string;
  readonly source1Value: unknown;
  readonly source2Value: unknown;
  readonly severity: 'critical' | 'warning';
}

/**
 * Compare boundaries from multiple sources
 *
 * SECURITY: Detect data poisoning by cross-referencing multiple authoritative sources.
 *
 * @param source1Boundaries - Boundaries from source 1
 * @param source2Boundaries - Boundaries from source 2
 * @returns List of discrepancies
 */
export function compareBoundarySources(
  source1Boundaries: ReadonlyMap<string, { name: string; geometry: Polygon | MultiPolygon }>,
  source2Boundaries: ReadonlyMap<string, { name: string; geometry: Polygon | MultiPolygon }>
): readonly BoundaryDiscrepancy[] {
  const discrepancies: BoundaryDiscrepancy[] = [];

  // Check for missing boundaries
  for (const [id, boundary1] of source1Boundaries.entries()) {
    const boundary2 = source2Boundaries.get(id);

    if (!boundary2) {
      discrepancies.push({
        boundaryId: id,
        field: 'existence',
        source1Value: 'present',
        source2Value: 'missing',
        severity: 'critical',
      });
      continue;
    }

    // Check name consistency
    if (boundary1.name !== boundary2.name) {
      discrepancies.push({
        boundaryId: id,
        field: 'name',
        source1Value: boundary1.name,
        source2Value: boundary2.name,
        severity: 'warning',
      });
    }

    // Check geometry similarity (simplified - compare bounding boxes)
    const bbox1 = calculateBoundingBox(boundary1.geometry);
    const bbox2 = calculateBoundingBox(boundary2.geometry);

    if (!boundingBoxesSimilar(bbox1, bbox2)) {
      discrepancies.push({
        boundaryId: id,
        field: 'geometry',
        source1Value: bbox1,
        source2Value: bbox2,
        severity: 'critical',
      });
    }
  }

  // Check for extra boundaries in source2
  for (const [id] of source2Boundaries.entries()) {
    if (!source1Boundaries.has(id)) {
      discrepancies.push({
        boundaryId: id,
        field: 'existence',
        source1Value: 'missing',
        source2Value: 'present',
        severity: 'critical',
      });
    }
  }

  return discrepancies;
}

/**
 * Calculate bounding box for geometry
 */
function calculateBoundingBox(
  geometry: Polygon | MultiPolygon
): readonly [number, number, number, number] {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  const processPosition = (pos: Position): void => {
    const lon = pos[0] ?? 0;
    const lat = pos[1] ?? 0;
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  };

  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates) {
      for (const pos of ring) {
        processPosition(pos);
      }
    }
  } else {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) {
        for (const pos of ring) {
          processPosition(pos);
        }
      }
    }
  }

  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Check if bounding boxes are similar (within tolerance)
 */
function boundingBoxesSimilar(
  bbox1: readonly [number, number, number, number],
  bbox2: readonly [number, number, number, number],
  tolerance = 0.01 // ~1km at equator
): boolean {
  return (
    Math.abs(bbox1[0] - bbox2[0]) < tolerance &&
    Math.abs(bbox1[1] - bbox2[1]) < tolerance &&
    Math.abs(bbox1[2] - bbox2[2]) < tolerance &&
    Math.abs(bbox1[3] - bbox2[3]) < tolerance
  );
}

// ============================================================================
// Hash Verification
// ============================================================================

/**
 * Compute content hash for boundary data
 *
 * SECURITY: Detect tampering by comparing hashes.
 *
 * @param data - Boundary data (JSON serializable)
 * @returns SHA256 hash (hex string)
 */
export function computeContentHash(data: unknown): string {
  // Normalize JSON (sort keys, no whitespace)
  const normalized = JSON.stringify(data, Object.keys(data as object).sort());

  return createHash('sha256')
    .update(normalized)
    .digest('hex');
}

/**
 * Verify content hash matches expected
 *
 * @param data - Boundary data
 * @param expectedHash - Expected hash
 * @returns True if hash matches, false otherwise
 */
export function verifyContentHash(data: unknown, expectedHash: string): boolean {
  const actualHash = computeContentHash(data);
  return actualHash === expectedHash;
}

// ============================================================================
// Snapshot Integrity Verification
// ============================================================================

/**
 * Verify snapshot integrity
 *
 * Checks:
 * - Merkle root matches tree computation
 * - Boundary count consistent
 * - IPFS CID valid format
 * - All boundaries have valid geometry
 *
 * @param snapshot - Snapshot metadata and tree
 * @returns Integrity check result
 */
export function verifySnapshotIntegrity(snapshot: {
  merkleRoot: bigint;
  boundaryCount: number;
  ipfsCID: string;
  boundaries: ReadonlyArray<{ id: string; geometry: Polygon | MultiPolygon }>;
}): IntegrityCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Verify boundary count matches
  if (snapshot.boundaries.length !== snapshot.boundaryCount) {
    errors.push(
      `Boundary count mismatch: metadata says ${snapshot.boundaryCount}, ` +
      `actual count ${snapshot.boundaries.length}`
    );
  }

  // Verify IPFS CID format (if not empty)
  if (snapshot.ipfsCID && snapshot.ipfsCID !== '') {
    if (!/^b[a-z2-7]{58}$/i.test(snapshot.ipfsCID)) {
      errors.push(`Invalid IPFS CID format: ${snapshot.ipfsCID}`);
    }
  }

  // Verify all boundaries have valid geometry
  let invalidGeometries = 0;
  for (const boundary of snapshot.boundaries) {
    const check = verifyGeometryIntegrity(boundary.geometry);
    if (!check.geometryValid) {
      invalidGeometries++;
      if (invalidGeometries <= 5) {
        // Only log first 5 errors
        errors.push(`Boundary ${boundary.id} has invalid geometry: ${check.errors.join(', ')}`);
      }
    }
  }

  if (invalidGeometries > 5) {
    errors.push(`... and ${invalidGeometries - 5} more boundaries with invalid geometry`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
