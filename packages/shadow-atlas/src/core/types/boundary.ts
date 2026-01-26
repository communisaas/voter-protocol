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
 * This is a CLASSIFICATION SYSTEM for Shadow Atlas boundaries.
 * BoundaryType can have 50+ values that MAP to 24 circuit slots.
 *
 * CIRCUIT SLOT MAPPING:
 * The ZK circuit has 24 fixed slots (0-23). Multiple BoundaryTypes
 * can map to the same slot. Use `boundaryTypeToSlot()` for mapping.
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
  // ===========================================================================
  // SLOT 0: CONGRESSIONAL (Federal House districts)
  // ===========================================================================
  CONGRESSIONAL_DISTRICT = 'congressional_district',

  // ===========================================================================
  // SLOT 1: FEDERAL_SENATE (State-wide for US Senate representation)
  // ===========================================================================
  STATE_PROVINCE = 'state_province',

  // ===========================================================================
  // SLOT 2: STATE_SENATE (State upper chamber)
  // ===========================================================================
  STATE_LEGISLATIVE_UPPER = 'state_legislative_upper',

  // ===========================================================================
  // SLOT 3: STATE_HOUSE (State lower chamber / Assembly)
  // ===========================================================================
  STATE_LEGISLATIVE_LOWER = 'state_legislative_lower',

  // ===========================================================================
  // SLOT 4: COUNTY (County-level governance)
  // ===========================================================================
  COUNTY = 'county',
  COUNTY_SUBDIVISION = 'county_subdivision',  // Townships, boroughs in some states
  SUPERVISOR_DISTRICT = 'supervisor_district', // County supervisor districts

  // ===========================================================================
  // SLOT 5: CITY (Municipal governance - city limits)
  // ===========================================================================
  CITY_LIMITS = 'city_limits',
  CDP = 'cdp',                               // Census Designated Places (unincorporated)
  TOWNSHIP = 'township',                     // Civil townships (New England, Midwest)
  BOROUGH = 'borough',                       // Borough (PA, AK, NJ)
  VILLAGE = 'village',                       // Village (various states)

  // ===========================================================================
  // SLOT 6: CITY_COUNCIL (City council / ward districts)
  // ===========================================================================
  CITY_COUNCIL_DISTRICT = 'city_council_district',
  CITY_COUNCIL_WARD = 'city_council_ward',
  ALDERMANIC_DISTRICT = 'aldermanic_district', // Aldermanic wards (Chicago-style)

  // ===========================================================================
  // SLOT 7: SCHOOL_UNIFIED (Unified school districts - K-12)
  // ===========================================================================
  SCHOOL_DISTRICT_UNIFIED = 'school_district_unified',

  // ===========================================================================
  // SLOT 8: SCHOOL_ELEMENTARY (Elementary school districts)
  // ===========================================================================
  SCHOOL_DISTRICT_ELEMENTARY = 'school_district_elementary',

  // ===========================================================================
  // SLOT 9: SCHOOL_SECONDARY (Secondary / High school districts)
  // ===========================================================================
  SCHOOL_DISTRICT_SECONDARY = 'school_district_secondary',

  // ===========================================================================
  // SLOT 10: SCHOOL_BOARD (School board trustee areas)
  // ===========================================================================
  SCHOOL_BOARD_DISTRICT = 'school_board_district',

  // ===========================================================================
  // SLOT 11: VOTING_PRECINCT (Electoral precincts / polling places)
  // ===========================================================================
  VOTING_DISTRICT = 'voting_district',
  VOTING_PRECINCT = 'voting_precinct',
  ELECTION_DISTRICT = 'election_district',

  // ===========================================================================
  // SLOT 12: FIRE_EMS (Fire protection and emergency services)
  // ===========================================================================
  FIRE_DISTRICT = 'fire_district',
  EMERGENCY_SERVICES_DISTRICT = 'emergency_services_district',
  EMS_DISTRICT = 'ems_district',

  // ===========================================================================
  // SLOT 13: WATER (Water and sewer districts)
  // ===========================================================================
  WATER_DISTRICT = 'water_district',
  SEWER_DISTRICT = 'sewer_district',
  SANITATION_DISTRICT = 'sanitation_district',
  IRRIGATION_DISTRICT = 'irrigation_district',
  FLOOD_CONTROL_DISTRICT = 'flood_control_district',
  DRAINAGE_DISTRICT = 'drainage_district',

  // ===========================================================================
  // SLOT 14: UTILITY (General utility districts)
  // ===========================================================================
  UTILITY_DISTRICT = 'utility_district',
  PUBLIC_UTILITY_DISTRICT = 'public_utility_district',
  POWER_DISTRICT = 'power_district',
  ELECTRIC_DISTRICT = 'electric_district',
  GAS_DISTRICT = 'gas_district',

  // ===========================================================================
  // SLOT 15: TRANSIT (Public transportation districts)
  // ===========================================================================
  TRANSIT_DISTRICT = 'transit_district',
  TRANSPORTATION_DISTRICT = 'transportation_district',
  METRO_TRANSIT_DISTRICT = 'metro_transit_district',
  PORT_DISTRICT = 'port_district',
  AIRPORT_DISTRICT = 'airport_district',

  // ===========================================================================
  // SLOT 16: LIBRARY (Library districts - often elected boards)
  // ===========================================================================
  LIBRARY_DISTRICT = 'library_district',

  // ===========================================================================
  // SLOT 17: HOSPITAL (Hospital / Healthcare districts)
  // ===========================================================================
  HOSPITAL_DISTRICT = 'hospital_district',
  HEALTHCARE_DISTRICT = 'healthcare_district',
  AMBULANCE_DISTRICT = 'ambulance_district',

  // ===========================================================================
  // SLOT 18: PARK_REC (Parks and recreation districts)
  // ===========================================================================
  PARK_DISTRICT = 'park_district',
  RECREATION_DISTRICT = 'recreation_district',
  OPEN_SPACE_DISTRICT = 'open_space_district',

  // ===========================================================================
  // SLOT 19: JUDICIAL (Judicial districts / court jurisdictions)
  // ===========================================================================
  JUDICIAL_DISTRICT = 'judicial_district',
  COURT_DISTRICT = 'court_district',
  JUSTICE_COURT_DISTRICT = 'justice_court_district',
  SUPERIOR_COURT_DISTRICT = 'superior_court_district',

  // ===========================================================================
  // SLOT 20: CONSERVATION (Conservation / soil / environmental districts)
  // ===========================================================================
  CONSERVATION_DISTRICT = 'conservation_district',
  SOIL_CONSERVATION_DISTRICT = 'soil_conservation_district',
  RESOURCE_CONSERVATION_DISTRICT = 'resource_conservation_district',
  WATERSHED_DISTRICT = 'watershed_district',
  GROUNDWATER_DISTRICT = 'groundwater_district',

  // ===========================================================================
  // SLOT 21: TRIBAL (Tribal and indigenous governance)
  // ===========================================================================
  TRIBAL_AREA = 'tribal_area',                    // AIANNH - American Indian/Alaska Native/Native Hawaiian Areas
  ALASKA_NATIVE_CORP = 'alaska_native_corp',      // ANRC - Alaska Native Regional Corporations
  TRIBAL_SUBDIVISION = 'tribal_subdivision',      // Tribal subdivisions
  TRIBAL_BLOCK_GROUP = 'tribal_block_group',      // TBG - Tribal Block Groups
  TRIBAL_TRACT = 'tribal_tract',                  // TTRACT - Tribal Census Tracts

  // ===========================================================================
  // SLOT 22: OVERFLOW_1 (Rare/miscellaneous special districts - Group A)
  // ===========================================================================
  CEMETERY_DISTRICT = 'cemetery_district',
  MOSQUITO_DISTRICT = 'mosquito_district',
  PEST_CONTROL_DISTRICT = 'pest_control_district',
  WEED_DISTRICT = 'weed_district',
  LIGHTING_DISTRICT = 'lighting_district',
  STREET_DISTRICT = 'street_district',
  ROAD_DISTRICT = 'road_district',
  COMMUNITY_SERVICES_DISTRICT = 'community_services_district',
  IMPROVEMENT_DISTRICT = 'improvement_district',

  // ===========================================================================
  // SLOT 23: OVERFLOW_2 (Rare/miscellaneous special districts - Group B)
  // ===========================================================================
  ASSESSMENT_DISTRICT = 'assessment_district',
  BUSINESS_IMPROVEMENT_DISTRICT = 'business_improvement_district',
  TAX_INCREMENT_DISTRICT = 'tax_increment_district',
  REDEVELOPMENT_DISTRICT = 'redevelopment_district',
  HOUSING_AUTHORITY_DISTRICT = 'housing_authority_district',
  LEVEE_DISTRICT = 'levee_district',
  RECLAMATION_DISTRICT = 'reclamation_district',

  // ===========================================================================
  // REFERENCE LAYERS (Not mapped to circuit slots - for analysis only)
  // These do NOT have elected governance and are used for geographic reference
  // ===========================================================================
  METRO_AREA = 'metro_area',                      // CBSA/CSA - Core Based Statistical Areas
  METRO_DIVISION = 'metro_division',              // METDIV - Metropolitan Divisions
  URBAN_AREA = 'urban_area',                      // UAC - Urban Areas
  NECTA = 'necta',                                // New England City and Town Areas
  NECTA_DIVISION = 'necta_division',              // NECTA Divisions
  ZIP_CODE_AREA = 'zip_code_area',                // ZCTA - ZIP Code Tabulation Areas
  CENSUS_TRACT = 'census_tract',                  // TRACT - Census Tracts
  BLOCK_GROUP = 'block_group',                    // BG - Block Groups
  PUMA = 'puma',                                  // Public Use Microdata Areas
  SUBMINOR_CIVIL_DIVISION = 'subminor_civil_division',  // SUBMCD - Subminor Civil Divisions
  ESTATE = 'estate',                              // ESTATE - Estates in USVI
  COUNTRY = 'country',                            // National boundary (top level)
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
 *
 * NOTE: All boundary types must be included here for TypeScript to be satisfied.
 * The precision rank is used for resolution priority, NOT circuit slot mapping.
 * Use `boundaryTypeToSlot()` from authority-mapper.ts for circuit slot mapping.
 */
export const PRECISION_RANK: Record<BoundaryType, number> = {
  // ===========================================================================
  // Tier 0: Finest civic representation (sub-municipal)
  // ===========================================================================
  [BoundaryType.CITY_COUNCIL_DISTRICT]: 0,
  [BoundaryType.CITY_COUNCIL_WARD]: 0.1,
  [BoundaryType.ALDERMANIC_DISTRICT]: 0.2,
  [BoundaryType.SCHOOL_BOARD_DISTRICT]: 0.3,

  // ===========================================================================
  // Tier 1: Municipal boundaries
  // ===========================================================================
  [BoundaryType.CITY_LIMITS]: 1,
  [BoundaryType.CDP]: 1.1,
  [BoundaryType.TOWNSHIP]: 1.2,
  [BoundaryType.BOROUGH]: 1.3,
  [BoundaryType.VILLAGE]: 1.4,

  // ===========================================================================
  // Tier 2: School districts (highest priority special districts - elected)
  // ===========================================================================
  [BoundaryType.SCHOOL_DISTRICT_UNIFIED]: 2,
  [BoundaryType.SCHOOL_DISTRICT_ELEMENTARY]: 2.1,
  [BoundaryType.SCHOOL_DISTRICT_SECONDARY]: 2.2,

  // ===========================================================================
  // Tier 3: Special Districts - Public Safety (often elected)
  // ===========================================================================
  [BoundaryType.FIRE_DISTRICT]: 3,
  [BoundaryType.EMERGENCY_SERVICES_DISTRICT]: 3.1,
  [BoundaryType.EMS_DISTRICT]: 3.2,

  // ===========================================================================
  // Tier 4: Special Districts - Cultural/Healthcare (often elected)
  // ===========================================================================
  [BoundaryType.LIBRARY_DISTRICT]: 4,
  [BoundaryType.HOSPITAL_DISTRICT]: 4.1,
  [BoundaryType.HEALTHCARE_DISTRICT]: 4.2,
  [BoundaryType.AMBULANCE_DISTRICT]: 4.3,
  [BoundaryType.PARK_DISTRICT]: 4.4,
  [BoundaryType.RECREATION_DISTRICT]: 4.5,
  [BoundaryType.OPEN_SPACE_DISTRICT]: 4.6,

  // ===========================================================================
  // Tier 5: Special Districts - Utilities/Infrastructure
  // ===========================================================================
  [BoundaryType.WATER_DISTRICT]: 5,
  [BoundaryType.SEWER_DISTRICT]: 5.1,
  [BoundaryType.SANITATION_DISTRICT]: 5.2,
  [BoundaryType.IRRIGATION_DISTRICT]: 5.3,
  [BoundaryType.FLOOD_CONTROL_DISTRICT]: 5.4,
  [BoundaryType.DRAINAGE_DISTRICT]: 5.5,
  [BoundaryType.UTILITY_DISTRICT]: 5.6,
  [BoundaryType.PUBLIC_UTILITY_DISTRICT]: 5.7,
  [BoundaryType.POWER_DISTRICT]: 5.8,
  [BoundaryType.ELECTRIC_DISTRICT]: 5.9,
  [BoundaryType.GAS_DISTRICT]: 5.95,
  [BoundaryType.TRANSIT_DISTRICT]: 5.96,
  [BoundaryType.TRANSPORTATION_DISTRICT]: 5.97,
  [BoundaryType.METRO_TRANSIT_DISTRICT]: 5.98,
  [BoundaryType.PORT_DISTRICT]: 5.99,
  [BoundaryType.AIRPORT_DISTRICT]: 5.995,

  // ===========================================================================
  // Tier 6: Electoral infrastructure
  // ===========================================================================
  [BoundaryType.VOTING_DISTRICT]: 6,
  [BoundaryType.VOTING_PRECINCT]: 6.1,
  [BoundaryType.ELECTION_DISTRICT]: 6.2,

  // ===========================================================================
  // Tier 7: County subdivisions
  // ===========================================================================
  [BoundaryType.COUNTY_SUBDIVISION]: 7,
  [BoundaryType.SUPERVISOR_DISTRICT]: 7.1,
  [BoundaryType.SUBMINOR_CIVIL_DIVISION]: 7.2,

  // ===========================================================================
  // Tier 8: County (universal US fallback)
  // ===========================================================================
  [BoundaryType.COUNTY]: 8,

  // ===========================================================================
  // Tier 9: Judicial / Conservation districts
  // ===========================================================================
  [BoundaryType.JUDICIAL_DISTRICT]: 9,
  [BoundaryType.COURT_DISTRICT]: 9.1,
  [BoundaryType.JUSTICE_COURT_DISTRICT]: 9.2,
  [BoundaryType.SUPERIOR_COURT_DISTRICT]: 9.3,
  [BoundaryType.CONSERVATION_DISTRICT]: 9.4,
  [BoundaryType.SOIL_CONSERVATION_DISTRICT]: 9.5,
  [BoundaryType.RESOURCE_CONSERVATION_DISTRICT]: 9.6,
  [BoundaryType.WATERSHED_DISTRICT]: 9.7,
  [BoundaryType.GROUNDWATER_DISTRICT]: 9.8,

  // ===========================================================================
  // Tier 10: Tribal and Indigenous Governance (sovereign nations)
  // ===========================================================================
  [BoundaryType.TRIBAL_AREA]: 10,
  [BoundaryType.ALASKA_NATIVE_CORP]: 10.1,
  [BoundaryType.TRIBAL_SUBDIVISION]: 10.2,
  [BoundaryType.ESTATE]: 10.3,  // USVI estates (county-equivalent)

  // ===========================================================================
  // Tier 11: Federal/State representation (parallel track, not fallback)
  // ===========================================================================
  [BoundaryType.CONGRESSIONAL_DISTRICT]: 11,
  [BoundaryType.STATE_LEGISLATIVE_UPPER]: 11.1,
  [BoundaryType.STATE_LEGISLATIVE_LOWER]: 11.2,

  // ===========================================================================
  // Tier 12: Overflow / Miscellaneous special districts
  // ===========================================================================
  [BoundaryType.CEMETERY_DISTRICT]: 12,
  [BoundaryType.MOSQUITO_DISTRICT]: 12.1,
  [BoundaryType.PEST_CONTROL_DISTRICT]: 12.2,
  [BoundaryType.WEED_DISTRICT]: 12.3,
  [BoundaryType.LIGHTING_DISTRICT]: 12.4,
  [BoundaryType.STREET_DISTRICT]: 12.5,
  [BoundaryType.ROAD_DISTRICT]: 12.6,
  [BoundaryType.COMMUNITY_SERVICES_DISTRICT]: 12.7,
  [BoundaryType.IMPROVEMENT_DISTRICT]: 12.8,
  [BoundaryType.ASSESSMENT_DISTRICT]: 12.9,
  [BoundaryType.BUSINESS_IMPROVEMENT_DISTRICT]: 12.95,
  [BoundaryType.TAX_INCREMENT_DISTRICT]: 12.96,
  [BoundaryType.REDEVELOPMENT_DISTRICT]: 12.97,
  [BoundaryType.HOUSING_AUTHORITY_DISTRICT]: 12.98,
  [BoundaryType.LEVEE_DISTRICT]: 12.99,
  [BoundaryType.RECLAMATION_DISTRICT]: 12.995,

  // ===========================================================================
  // Tier 13: Metropolitan and Regional Planning
  // ===========================================================================
  [BoundaryType.METRO_DIVISION]: 13,
  [BoundaryType.METRO_AREA]: 13.1,
  [BoundaryType.NECTA_DIVISION]: 13.2,
  [BoundaryType.NECTA]: 13.3,
  [BoundaryType.URBAN_AREA]: 13.4,

  // ===========================================================================
  // Tier 14: State/Province
  // ===========================================================================
  [BoundaryType.STATE_PROVINCE]: 14,

  // ===========================================================================
  // Tier 15: Reference and Analysis Layers (demographic, not civic)
  // ===========================================================================
  [BoundaryType.PUMA]: 15,
  [BoundaryType.ZIP_CODE_AREA]: 15.1,
  [BoundaryType.CENSUS_TRACT]: 15.2,
  [BoundaryType.TRIBAL_TRACT]: 15.3,
  [BoundaryType.BLOCK_GROUP]: 15.4,
  [BoundaryType.TRIBAL_BLOCK_GROUP]: 15.5,

  // ===========================================================================
  // Tier 16: Country (coarsest)
  // ===========================================================================
  [BoundaryType.COUNTRY]: 16,
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
