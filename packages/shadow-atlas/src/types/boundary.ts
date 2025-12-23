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
export type { ProvenanceRecord };

/**
 * Boundary Type Enumeration
 *
 * Ordered by precision rank (finest → coarsest).
 * Used for hierarchical resolution fallback.
 *
 * US COVERAGE STRATEGY:
 * - Tier 0: City council districts (finest civic representation)
 * - Tier 1: City limits (incorporated places - Census PLACE)
 * - Tier 2: CDP (Census Designated Places - unincorporated communities)
 * - Tier 3: County (universal fallback)
 * - Tier 4: Congressional district (federal representation)
 * - Tier 5: State (coarsest)
 *
 * Data sources:
 * - Council districts: Municipal portals, state GIS clearinghouses
 * - City limits: Census TIGER/Line PLACE files (FREE, 19,495 places)
 * - CDPs: Census TIGER/Line PLACE files (FREE, ~9,000 CDPs)
 * - Counties: Census TIGER/Line COUNTY files (FREE, 3,143 counties)
 * - Congressional: Census TIGER/Line CD files (FREE, 435 districts)
 */
export enum BoundaryType {
  // Finest grain: Local civic representation
  CITY_COUNCIL_DISTRICT = 'city_council_district',
  CITY_COUNCIL_WARD = 'city_council_ward',

  // Incorporated places (Census PLACE with LSAD = city/town/village)
  CITY_LIMITS = 'city_limits',

  // Unincorporated communities (Census PLACE with LSAD = CDP)
  CDP = 'cdp',

  // County subdivision (townships, boroughs in some states)
  COUNTY_SUBDIVISION = 'county_subdivision',

  // County (universal US fallback)
  COUNTY = 'county',

  // Federal representation
  CONGRESSIONAL_DISTRICT = 'congressional_district',

  // State legislative (optional enhancement)
  STATE_LEGISLATIVE_UPPER = 'state_legislative_upper',
  STATE_LEGISLATIVE_LOWER = 'state_legislative_lower',

  // Coarsest grain
  STATE_PROVINCE = 'state_province',
  COUNTRY = 'country',

  // Special districts
  VOTING_DISTRICT = 'voting_district',
  SCHOOL_DISTRICT_UNIFIED = 'school_district_unified',
  SCHOOL_DISTRICT_ELEMENTARY = 'school_district_elementary',
  SCHOOL_DISTRICT_SECONDARY = 'school_district_secondary',

  // Special Districts - Public Safety (often elected)
  FIRE_DISTRICT = 'fire_district',

  // Special Districts - Cultural/Educational (often elected)
  LIBRARY_DISTRICT = 'library_district',

  // Special Districts - Healthcare (sometimes elected)
  HOSPITAL_DISTRICT = 'hospital_district',

  // Special Districts - Utilities (usually appointed, lower priority)
  WATER_DISTRICT = 'water_district',
  UTILITY_DISTRICT = 'utility_district',

  // Special Districts - Transportation (usually appointed)
  TRANSIT_DISTRICT = 'transit_district',
}

/**
 * Precision rank for hierarchical resolution
 *
 * Lower rank = higher precision (preferred in resolution).
 * Used to sort boundaries when multiple matches exist.
 *
 * RESOLUTION STRATEGY:
 * 1. Attempt finest available (council district)
 * 2. Fall back to city limits or CDP
 * 3. Fall back to county (guaranteed)
 * 4. Congressional district available in parallel (federal representation)
 */
export const PRECISION_RANK: Record<BoundaryType, number> = {
  // Tier 0: Finest civic representation
  [BoundaryType.CITY_COUNCIL_DISTRICT]: 0,
  [BoundaryType.CITY_COUNCIL_WARD]: 1,

  // Tier 1: Incorporated/unincorporated place boundaries
  [BoundaryType.CITY_LIMITS]: 2,
  [BoundaryType.CDP]: 3,
  [BoundaryType.COUNTY_SUBDIVISION]: 4,

  // Tier 2: County (universal US fallback)
  [BoundaryType.COUNTY]: 5,

  // Federal/State representation (parallel track, not fallback)
  [BoundaryType.CONGRESSIONAL_DISTRICT]: 6,
  [BoundaryType.STATE_LEGISLATIVE_UPPER]: 7,
  [BoundaryType.STATE_LEGISLATIVE_LOWER]: 8,

  // Tier 3: Coarsest
  [BoundaryType.STATE_PROVINCE]: 9,
  [BoundaryType.COUNTRY]: 10,

  // Special districts (parallel tracks)
  [BoundaryType.VOTING_DISTRICT]: 11,
  [BoundaryType.SCHOOL_DISTRICT_UNIFIED]: 12,
  [BoundaryType.SCHOOL_DISTRICT_ELEMENTARY]: 13,
  [BoundaryType.SCHOOL_DISTRICT_SECONDARY]: 14,

  // Special Districts - Public Safety/Cultural (Tier 3: Medium priority - often elected)
  [BoundaryType.FIRE_DISTRICT]: 15,
  [BoundaryType.LIBRARY_DISTRICT]: 16,
  [BoundaryType.HOSPITAL_DISTRICT]: 17,

  // Special Districts - Utilities/Infrastructure (Tier 4: Lower priority - usually appointed)
  [BoundaryType.WATER_DISTRICT]: 18,
  [BoundaryType.UTILITY_DISTRICT]: 19,
  [BoundaryType.TRANSIT_DISTRICT]: 20,
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
