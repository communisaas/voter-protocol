/**
 * Boundary Types
 *
 * Type definitions for hierarchical political boundary resolution.
 *
 * PHILOSOPHY:
 * - Precision-first hierarchy (district → city → county → state → country)
 * - Immutable data structures (functional programming)
 * - Explicit temporal validity (boundaries change every 10 years)
 * - Full provenance tracking (audit trail for every boundary)
 */

import type { Polygon, MultiPolygon, Position } from 'geojson';
import type { ProvenanceRecord } from '../provenance-writer.js';

/**
 * Boundary Type Enumeration
 *
 * Ordered by precision rank (finest → coarsest).
 * Used for hierarchical resolution fallback.
 */
export enum BoundaryType {
  CITY_COUNCIL_DISTRICT = 'city_council_district',
  CITY_COUNCIL_WARD = 'city_council_ward',
  CITY_LIMITS = 'city_limits',
  COUNTY = 'county',
  STATE_PROVINCE = 'state_province',
  COUNTRY = 'country',
}

/**
 * Precision rank for hierarchical resolution
 *
 * Lower rank = higher precision (preferred in resolution).
 * Used to sort boundaries when multiple matches exist.
 */
export const PRECISION_RANK: Record<BoundaryType, number> = {
  [BoundaryType.CITY_COUNCIL_DISTRICT]: 0,
  [BoundaryType.CITY_COUNCIL_WARD]: 1,
  [BoundaryType.CITY_LIMITS]: 2,
  [BoundaryType.COUNTY]: 3,
  [BoundaryType.STATE_PROVINCE]: 4,
  [BoundaryType.COUNTRY]: 5,
};

/**
 * Boundary Metadata
 *
 * Identifies a political boundary without geometry.
 * Lightweight for caching and indexing.
 */
export interface BoundaryMetadata {
  readonly id: string;                    // Unique boundary ID (e.g., "us-wa-seattle-district-1")
  readonly type: BoundaryType;            // Boundary type
  readonly name: string;                  // Human-readable name (e.g., "District 1")
  readonly jurisdiction: string;          // Parent jurisdiction (e.g., "Seattle, WA, USA")
  readonly jurisdictionFips?: string;     // FIPS code (US only, e.g., "5363000" for Seattle)
  readonly provenance: ProvenanceRecord;  // Full audit trail
  readonly validFrom: Date;               // Effective date
  readonly validUntil?: Date;             // Expiration date (null = current)
}

/**
 * Boundary Geometry
 *
 * Complete boundary with geometry for PIP testing.
 * Includes bounding box for performance optimization.
 */
export interface BoundaryGeometry {
  readonly metadata: BoundaryMetadata;
  readonly geometry: Polygon | MultiPolygon;  // GeoJSON geometry (WGS84)
  readonly bbox: readonly [number, number, number, number];  // [minLon, minLat, maxLon, maxLat]
}

/**
 * Boundary Resolution Result
 *
 * Result of resolving an address to a boundary.
 * Includes caching metadata and confidence score.
 */
export interface BoundaryResolution {
  readonly boundary: BoundaryMetadata;
  readonly precision: BoundaryType;
  readonly confidence: number;             // 0-100 (from provenance)
  readonly coordinates: { readonly lat: number; readonly lng: number };
  readonly cached: boolean;
  readonly resolvedAt: Date;
}

/**
 * Lat/Lng Point
 *
 * Simple coordinate type for clarity.
 */
export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/**
 * Bounding Box
 *
 * Geographic bounding box [minLon, minLat, maxLon, maxLat].
 * Alias for clarity in function signatures.
 */
export type BBox = readonly [number, number, number, number];

/**
 * Polygon Ring
 *
 * Array of GeoJSON positions forming a polygon ring.
 * Alias for clarity in PIP algorithm.
 */
export type PolygonRing = Position[];

/**
 * Helper Functions
 */

/**
 * Check if boundary is currently valid
 */
export function isBoundaryValid(
  boundary: BoundaryMetadata,
  asOf: Date = new Date()
): boolean {
  if (asOf < boundary.validFrom) {
    return false;  // Not yet effective
  }

  if (boundary.validUntil && asOf >= boundary.validUntil) {
    return false;  // Expired
  }

  return true;
}

/**
 * Get precision rank for boundary type
 */
export function getPrecisionRank(type: BoundaryType): number {
  return PRECISION_RANK[type];
}

/**
 * Compare boundary precision (for sorting)
 *
 * Returns:
 * - negative if a has higher precision (finer grain)
 * - positive if b has higher precision
 * - zero if equal precision
 */
export function comparePrecision(a: BoundaryType, b: BoundaryType): number {
  return getPrecisionRank(a) - getPrecisionRank(b);
}

/**
 * Format boundary as human-readable string
 */
export function formatBoundary(boundary: BoundaryMetadata): string {
  return `${boundary.name} (${boundary.type}, ${boundary.jurisdiction})`;
}

/**
 * Extract bounding box from GeoJSON geometry
 */
export function extractBBox(geometry: Polygon | MultiPolygon): BBox {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  const processRing = (ring: Position[]) => {
    for (const [lon, lat] of ring) {
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    }
  };

  if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach(processRing);
  } else {
    // MultiPolygon
    geometry.coordinates.forEach((polygon) => polygon.forEach(processRing));
  }

  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Check if point is inside bounding box
 *
 * Fast O(1) pre-filter before expensive PIP test.
 */
export function isPointInBBox(point: LatLng, bbox: BBox): boolean {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return (
    point.lng >= minLon &&
    point.lng <= maxLon &&
    point.lat >= minLat &&
    point.lat <= maxLat
  );
}
