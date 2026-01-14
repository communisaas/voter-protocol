/**
 * Type Guards for Shadow Atlas
 *
 * Nuclear-level type safety enforcement. Zero tolerance for `any` types.
 * All runtime type narrowing must use proper type guards with `is` predicates.
 *
 * CRITICAL TYPE SAFETY: These guards protect against runtime type errors
 * that could corrupt Merkle roots or brick the discovery pipeline.
 */

import type { Polygon, MultiPolygon, Geometry } from 'geojson';
import type { TIGERLayerType, ExtractionScope } from './types.js';
import { BoundaryType } from '../core/types/boundary.js';

/**
 * Type guard for TIGER layer types
 *
 * Validates that a string is a valid TIGER layer type at runtime.
 * Used to narrow unknown strings to TIGERLayerType.
 */
export function isTIGERLayerType(layer: unknown): layer is TIGERLayerType {
  if (typeof layer !== 'string') return false;

  const validLayers: readonly string[] = [
    // Federal/State Legislative (Tier 1)
    'cd', 'sldu', 'sldl',
    // County Level (Tier 2)
    'county', 'cousub', 'submcd',
    // Municipal (Tier 3)
    'place', 'cdp', 'concity',
    // School Districts (Tier 4)
    'unsd', 'elsd', 'scsd',
    // Electoral Infrastructure (Tier 5)
    'vtd',
    // Tribal and Indigenous Governance (Tier 6)
    'aiannh', 'anrc', 'tbg', 'ttract',
    // Metropolitan and Urban Planning (Tier 7)
    'cbsa', 'csa', 'metdiv', 'uac', 'necta', 'cnecta', 'nectadiv',
    // Reference Layers (Tier 8)
    'zcta', 'tract', 'bg', 'puma',
    // Special Cases (Tier 9)
    'estate',
    // Federal Installations
    'mil',
  ];

  return validLayers.includes(layer);
}

/**
 * Type guard for Polygon or MultiPolygon geometry
 *
 * Validates GeoJSON geometry types at runtime.
 * Used to narrow unknown geometry to Polygon | MultiPolygon.
 */
export function isPolygonOrMultiPolygon(geom: unknown): geom is Polygon | MultiPolygon {
  if (geom === null || typeof geom !== 'object') return false;
  if (!('type' in geom)) return false;

  return geom.type === 'Polygon' || geom.type === 'MultiPolygon';
}

/**
 * Type guard for GeoJSON Geometry
 *
 * Validates that an unknown value is a valid GeoJSON Geometry.
 */
export function isGeometry(geom: unknown): geom is Geometry {
  if (geom === null || typeof geom !== 'object') return false;
  if (!('type' in geom)) return false;

  const validTypes = [
    'Point',
    'MultiPoint',
    'LineString',
    'MultiLineString',
    'Polygon',
    'MultiPolygon',
    'GeometryCollection',
  ];

  return typeof geom.type === 'string' && validTypes.includes(geom.type);
}

/**
 * Type guard for extraction scope with exhaustive checking
 *
 * Uses discriminated union to validate extraction scope type.
 */
export function hasExtractionScopeType(scope: ExtractionScope): scope is ExtractionScope & { type: string } {
  return 'type' in scope && typeof scope.type === 'string';
}

/**
 * Map TIGER layer type to BoundaryType enum
 *
 * Type-safe conversion from TIGER layer strings to BoundaryType enum.
 * Throws on invalid input to prevent silent failures.
 *
 * @throws {Error} If layer is not a valid TIGER layer type
 */
export function mapLayerToBoundaryType(layer: TIGERLayerType): BoundaryType {
  const mapping: Record<string, BoundaryType> = {
    'cd': BoundaryType.CONGRESSIONAL_DISTRICT,
    'sldu': BoundaryType.STATE_LEGISLATIVE_UPPER,
    'sldl': BoundaryType.STATE_LEGISLATIVE_LOWER,
    'county': BoundaryType.COUNTY,
    'cousub': BoundaryType.COUNTY_SUBDIVISION,
    'place': BoundaryType.CITY_LIMITS,
    'cdp': BoundaryType.CDP,
    'unsd': BoundaryType.SCHOOL_DISTRICT_UNIFIED,
    'elsd': BoundaryType.SCHOOL_DISTRICT_ELEMENTARY,
    'scsd': BoundaryType.SCHOOL_DISTRICT_SECONDARY,
    'vtd': BoundaryType.VOTING_DISTRICT,
    'aiannh': BoundaryType.TRIBAL_AREA,
    'anrc': BoundaryType.ALASKA_NATIVE_CORP,
    'tbg': BoundaryType.TRIBAL_BLOCK_GROUP,
    'ttract': BoundaryType.TRIBAL_TRACT,
    'cbsa': BoundaryType.METRO_AREA,
    'csa': BoundaryType.METRO_AREA,
    'metdiv': BoundaryType.METRO_DIVISION,
    'uac': BoundaryType.URBAN_AREA,
    'necta': BoundaryType.NECTA,
    'nectadiv': BoundaryType.NECTA_DIVISION,
    'zcta': BoundaryType.ZIP_CODE_AREA,
    'tract': BoundaryType.CENSUS_TRACT,
    'bg': BoundaryType.BLOCK_GROUP,
    'puma': BoundaryType.PUMA,
    'submcd': BoundaryType.SUBMINOR_CIVIL_DIVISION,
    'estate': BoundaryType.ESTATE,
  };

  const boundaryType = mapping[layer];
  if (!boundaryType) {
    throw new Error(`Unknown TIGER layer type: ${layer}`);
  }

  return boundaryType;
}

/**
 * Filter array to only TIGER layer types that can be validated
 *
 * Type-safe filter that narrows string[] to TIGERLayerType[]
 */
export function filterValidatableLayers(
  layers: readonly unknown[]
): Array<'cd' | 'sldu' | 'sldl' | 'county'> {
  const validatableLayers = ['cd', 'sldu', 'sldl', 'county'] as const;

  return layers.filter((layer): layer is 'cd' | 'sldu' | 'sldl' | 'county' => {
    return typeof layer === 'string' && validatableLayers.includes(layer as any);
  });
}

/**
 * Assert that geometry is Polygon or MultiPolygon
 *
 * Throws if geometry is not the expected type.
 * Use for cases where type narrowing is guaranteed by prior validation.
 *
 * @throws {Error} If geometry is not Polygon or MultiPolygon
 */
export function assertPolygonGeometry(
  geom: Geometry,
  boundaryId: string
): asserts geom is Polygon | MultiPolygon {
  if (!isPolygonOrMultiPolygon(geom)) {
    throw new Error(
      `Invalid geometry type for ${boundaryId}: expected Polygon or MultiPolygon, got ${geom.type}`
    );
  }
}
