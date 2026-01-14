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
import type { ProvenanceRecord } from '../../provenance/provenance-writer.js';
import { extractBBox } from '../geo-utils.js';
export type { ProvenanceRecord };
export { extractBBox };  // Re-export for backward compatibility

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

  // Tribal and Indigenous Governance (sovereign representation)
  TRIBAL_AREA = 'tribal_area',                    // AIANNH - American Indian/Alaska Native/Native Hawaiian Areas
  ALASKA_NATIVE_CORP = 'alaska_native_corp',      // ANRC - Alaska Native Regional Corporations

  // Metropolitan and Urban Planning (regional coordination)
  METRO_AREA = 'metro_area',                      // CBSA/CSA - Core Based Statistical Areas
  METRO_DIVISION = 'metro_division',              // METDIV - Metropolitan Divisions
  URBAN_AREA = 'urban_area',                      // UAC - Urban Areas
  NECTA = 'necta',                                // New England City and Town Areas
  NECTA_DIVISION = 'necta_division',              // NECTA Divisions

  // Reference and Analysis Layers
  ZIP_CODE_AREA = 'zip_code_area',                // ZCTA - ZIP Code Tabulation Areas
  CENSUS_TRACT = 'census_tract',                  // TRACT - Census Tracts
  BLOCK_GROUP = 'block_group',                    // BG - Block Groups
  PUMA = 'puma',                                  // Public Use Microdata Areas

  // Tribal Census Infrastructure (demographic analysis)
  TRIBAL_BLOCK_GROUP = 'tribal_block_group',      // TBG - Tribal Block Groups
  TRIBAL_TRACT = 'tribal_tract',                  // TTRACT - Tribal Census Tracts

  // Minor Civil Divisions (New England governance)
  SUBMINOR_CIVIL_DIVISION = 'subminor_civil_division',  // SUBMCD - Subminor Civil Divisions

  // Estates (US Virgin Islands only)
  ESTATE = 'estate',                              // ESTATE - Estates in USVI
}

/**
 * Precision rank for hierarchical resolution
 *
 * Lower rank = higher precision (preferred in resolution).
 * Used to sort boundaries when multiple matches exist.
 *
 * RESOLUTION STRATEGY:
 * 1. Attempt finest available (council district)
 * 2. Fall back to special districts (school, fire, water, etc.)
 * 3. Fall back to city limits or CDP
 * 4. Fall back to county (guaranteed)
 * 5. Congressional district available in parallel (federal representation)
 */
export const PRECISION_RANK: Record<BoundaryType, number> = {
  // Tier 0: Finest civic representation
  [BoundaryType.CITY_COUNCIL_DISTRICT]: 0,
  [BoundaryType.CITY_COUNCIL_WARD]: 1,

  // Tier 1: Incorporated/unincorporated place boundaries
  [BoundaryType.CITY_LIMITS]: 2,
  [BoundaryType.CDP]: 3,

  // Tier 1.5: Special districts (between CDP and COUNTY)
  // School districts (highest priority special districts - elected)
  [BoundaryType.SCHOOL_DISTRICT_UNIFIED]: 3.5,
  [BoundaryType.SCHOOL_DISTRICT_ELEMENTARY]: 3.6,
  [BoundaryType.SCHOOL_DISTRICT_SECONDARY]: 3.7,

  // Special Districts - Public Safety/Cultural (often elected)
  [BoundaryType.FIRE_DISTRICT]: 3.8,
  [BoundaryType.LIBRARY_DISTRICT]: 3.9,
  [BoundaryType.HOSPITAL_DISTRICT]: 4.0,

  // Special Districts - Utilities/Infrastructure (usually appointed)
  [BoundaryType.WATER_DISTRICT]: 4.1,
  [BoundaryType.UTILITY_DISTRICT]: 4.2,
  [BoundaryType.TRANSIT_DISTRICT]: 4.3,

  // Voting districts (electoral infrastructure)
  [BoundaryType.VOTING_DISTRICT]: 4.4,

  [BoundaryType.COUNTY_SUBDIVISION]: 4.5,
  [BoundaryType.SUBMINOR_CIVIL_DIVISION]: 4.6,

  // Tier 2: County (universal US fallback)
  [BoundaryType.COUNTY]: 5,

  // Tier 2.5: Tribal and Indigenous Governance (sovereign nations)
  [BoundaryType.TRIBAL_AREA]: 5.5,
  [BoundaryType.ALASKA_NATIVE_CORP]: 5.6,
  [BoundaryType.ESTATE]: 5.7,  // USVI estates (county-equivalent)

  // Federal/State representation (parallel track, not fallback)
  [BoundaryType.CONGRESSIONAL_DISTRICT]: 6,
  [BoundaryType.STATE_LEGISLATIVE_UPPER]: 7,
  [BoundaryType.STATE_LEGISLATIVE_LOWER]: 8,

  // Tier 3: Metropolitan and Regional Planning
  [BoundaryType.METRO_DIVISION]: 8.5,  // Finer than metro area
  [BoundaryType.METRO_AREA]: 9,
  [BoundaryType.NECTA_DIVISION]: 9.3,
  [BoundaryType.NECTA]: 9.5,
  [BoundaryType.URBAN_AREA]: 9.7,

  // Tier 4: State/Province
  [BoundaryType.STATE_PROVINCE]: 10,

  // Tier 5: Reference and Analysis Layers (demographic, not civic)
  [BoundaryType.PUMA]: 11,            // Public Use Microdata Areas
  [BoundaryType.ZIP_CODE_AREA]: 12,   // ZIP codes (mail delivery)
  [BoundaryType.CENSUS_TRACT]: 13,    // Demographic analysis
  [BoundaryType.TRIBAL_TRACT]: 13.5,  // Tribal census tracts
  [BoundaryType.BLOCK_GROUP]: 14,     // Fine demographic unit
  [BoundaryType.TRIBAL_BLOCK_GROUP]: 14.5,  // Tribal block groups

  // Tier 6: Country (coarsest)
  [BoundaryType.COUNTRY]: 15,
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

// extractBBox moved to core/geo-utils.ts (imported above)

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
