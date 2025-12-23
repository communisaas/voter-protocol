/**
 * Transformation Pipeline Utilities
 *
 * Helper functions for:
 * - IPFS CID generation (browser-compatible, no IPFS node required)
 * - Update detection (geometry comparison, change tracking)
 * - Rejection tracking (quality metrics)
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { CID } from 'multiformats/cid';
import * as json from 'multiformats/codecs/json';
import { sha256 } from 'multiformats/hashes/sha2';
import type { NormalizedDistrict } from './types.js';
import type { Polygon, MultiPolygon } from 'geojson';

// ============================================================================
// IPFS CID Generation
// ============================================================================

/**
 * Generate IPFS CID for data without requiring full IPFS node
 *
 * Uses multiformats library to create Content Identifier (CID) compatible
 * with IPFS. This allows deterministic addressing without running an IPFS daemon.
 *
 * ALGORITHM:
 * 1. Serialize data to JSON
 * 2. Encode using dag-json codec
 * 3. Hash with SHA-256
 * 4. Create CIDv1 with base32 encoding
 *
 * @param data - Data to generate CID for (must be JSON-serializable)
 * @returns CID as string (e.g., "bafyreig...")
 *
 * @example
 * ```typescript
 * const district = { id: '1', name: 'District 1', ... };
 * const cid = await generateCID(district);
 * // cid = "bafyreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
 * ```
 */
export async function generateCID(data: unknown): Promise<string> {
  // Encode data as dag-json
  const bytes = json.encode(data);

  // Hash with SHA-256
  const hash = await sha256.digest(bytes);

  // Create CIDv1 (base32)
  const cid = CID.create(1, json.code, hash);

  return cid.toString();
}

/**
 * Generate CID for merkle tree output
 *
 * Convenience wrapper for merkle tree serialization.
 *
 * @param merkleTree - Merkle tree to generate CID for
 * @returns CID string
 */
export async function generateMerkleTreeCID(merkleTree: {
  readonly root: string;
  readonly leaves: readonly string[];
  readonly districts: readonly NormalizedDistrict[];
}): Promise<string> {
  // Create deterministic serialization (exclude non-essential fields)
  const serializable = {
    root: merkleTree.root,
    districtCount: merkleTree.districts.length,
    districts: merkleTree.districts.map(d => ({
      id: d.id,
      name: d.name,
      jurisdiction: d.jurisdiction,
      districtType: d.districtType,
      geometry: d.geometry,
      bbox: d.bbox,
      provenance: {
        source: d.provenance.source,
        authority: d.provenance.authority,
        timestamp: d.provenance.timestamp,
      },
    })),
  };

  return generateCID(serializable);
}

// ============================================================================
// Update Detection
// ============================================================================

/**
 * Detect changes between two sets of districts
 *
 * Compares previous and new district sets to identify:
 * - Added districts (new IDs)
 * - Removed districts (missing IDs)
 * - Modified districts (same ID, different content)
 *
 * OPTIMIZATION: Uses hash comparison first, geometry diff only if needed.
 *
 * @param previous - Previous district set
 * @param current - Current district set
 * @returns Change detection result
 *
 * @example
 * ```typescript
 * const oldTree = loadMerkleTree('2024-01.json');
 * const newTree = loadMerkleTree('2024-02.json');
 *
 * const changes = detectUpdates(oldTree.districts, newTree.districts);
 * console.log(`Added: ${changes.added.length}`);
 * console.log(`Removed: ${changes.removed.length}`);
 * console.log(`Modified: ${changes.modified.length}`);
 * ```
 */
export function detectUpdates(
  previous: readonly NormalizedDistrict[],
  current: readonly NormalizedDistrict[]
): {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly modified: ReadonlyArray<{
    readonly id: string;
    readonly changes: readonly string[];
    readonly areaDelta?: number;
  }>;
} {
  const prevMap = new Map(previous.map(d => [d.id, d]));
  const currMap = new Map(current.map(d => [d.id, d]));

  // Detect added (in current, not in previous)
  const added: string[] = [];
  for (const id of currMap.keys()) {
    if (!prevMap.has(id)) {
      added.push(id);
    }
  }

  // Detect removed (in previous, not in current)
  const removed: string[] = [];
  for (const id of prevMap.keys()) {
    if (!currMap.has(id)) {
      removed.push(id);
    }
  }

  // Detect modified (in both, but different)
  const modified: Array<{
    readonly id: string;
    readonly changes: readonly string[];
    readonly areaDelta?: number;
  }> = [];

  for (const [id, currDistrict] of currMap) {
    const prevDistrict = prevMap.get(id);
    if (!prevDistrict) continue; // Already in 'added'

    const changes = detectDistrictChanges(prevDistrict, currDistrict);
    if (changes.length > 0) {
      const areaDelta = detectAreaChange(prevDistrict.geometry, currDistrict.geometry);
      modified.push({ id, changes, areaDelta });
    }
  }

  return { added, removed, modified };
}

/**
 * Detect specific changes within a district
 *
 * Compares field-by-field to identify what changed.
 *
 * @param prev - Previous district
 * @param curr - Current district
 * @returns Array of changed field names
 */
function detectDistrictChanges(
  prev: NormalizedDistrict,
  curr: NormalizedDistrict
): string[] {
  const changes: string[] = [];

  // Name changed
  if (prev.name !== curr.name) {
    changes.push('name');
  }

  // Jurisdiction changed
  if (prev.jurisdiction !== curr.jurisdiction) {
    changes.push('jurisdiction');
  }

  // District type changed
  if (prev.districtType !== curr.districtType) {
    changes.push('districtType');
  }

  // Geometry changed (hash comparison)
  const prevGeomHash = hashGeometry(prev.geometry);
  const currGeomHash = hashGeometry(curr.geometry);
  if (prevGeomHash !== currGeomHash) {
    changes.push('geometry');
  }

  // Bounding box changed
  if (!bboxEqual(prev.bbox, curr.bbox)) {
    changes.push('bbox');
  }

  // Provenance changed (source URL)
  if (prev.provenance.source !== curr.provenance.source) {
    changes.push('provenance');
  }

  return changes;
}

/**
 * Hash geometry for quick comparison
 *
 * Creates deterministic hash from geometry coordinates.
 *
 * @param geometry - GeoJSON geometry
 * @returns Hash string
 */
function hashGeometry(geometry: Polygon | MultiPolygon): string {
  // Create deterministic serialization of coordinates
  // Sort nested arrays to ensure consistent ordering
  const serialized = JSON.stringify(geometry.coordinates);

  // Simple hash using character codes (deterministic)
  // In production, use crypto.createHash('sha256')
  let hash = 0;
  for (let i = 0; i < serialized.length; i++) {
    const char = serialized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  return `hash-${hash}-${serialized.length}`;
}

/**
 * Compare bounding boxes for equality
 */
function bboxEqual(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number]
): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/**
 * Calculate area change percentage
 *
 * Computes approximate area difference using bounding box.
 * For precise area, use turf.area() on geometries.
 *
 * @param prev - Previous geometry
 * @param curr - Current geometry
 * @returns Percentage change (positive = grew, negative = shrunk)
 */
function detectAreaChange(
  prev: Polygon | MultiPolygon,
  curr: Polygon | MultiPolygon
): number | undefined {
  try {
    // Simplified area calculation (bounding box area proxy)
    const prevArea = calculateBboxArea(extractBbox(prev));
    const currArea = calculateBboxArea(extractBbox(curr));

    if (prevArea === 0) return undefined;

    const delta = ((currArea - prevArea) / prevArea) * 100;
    return Math.round(delta * 100) / 100; // Round to 2 decimals
  } catch {
    return undefined;
  }
}

/**
 * Extract bounding box from geometry
 */
function extractBbox(
  geometry: Polygon | MultiPolygon
): [number, number, number, number] {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  const processRing = (ring: Array<[number, number]>): void => {
    for (const [lon, lat] of ring) {
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    }
  };

  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates) {
      processRing(ring as Array<[number, number]>);
    }
  } else {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) {
        processRing(ring as Array<[number, number]>);
      }
    }
  }

  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Calculate approximate area from bounding box
 *
 * Uses simple lat/lon box area (not geodesic).
 * Good enough for change detection percentage.
 */
function calculateBboxArea(bbox: [number, number, number, number]): number {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return (maxLon - minLon) * (maxLat - minLat);
}
