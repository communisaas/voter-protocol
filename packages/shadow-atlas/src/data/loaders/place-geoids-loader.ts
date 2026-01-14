/**
 * Place GEOIDs Data Loader
 *
 * Type-safe loader for canonical Place GEOID data extracted from TIGER 2024 shapefiles.
 *
 * ARCHITECTURE:
 * - JSON data stored in src/data/canonical/place-geoids.json (534KB)
 * - TypeScript loader provides typed access with validation
 * - Replaces 371KB src/validators/place-geoids.ts with data/code separation
 *
 * USAGE:
 * ```typescript
 * import { NATIONAL_PLACE_TOTAL, getPlaceGeoidsForState } from './place-geoids-loader';
 *
 * const totalPlaces = NATIONAL_PLACE_TOTAL; // 32041
 * const alabamaPlaces = getPlaceGeoidsForState('01'); // Array of 594 GEOIDs
 * ```
 */

import placeDataRaw from '../canonical/place-geoids.json' with { type: 'json' };

interface PlaceDataStructure {
  meta: {
    nationalTotal: number;
    source: string;
    generated: string;
    description: string;
  };
  expectedCounts: Record<string, number>;
  geoids: Record<string, readonly string[]>;
}

const placeData = placeDataRaw as unknown as PlaceDataStructure;

/**
 * National total of Place GEOIDs across all states
 *
 * SOURCE: Census TIGER/Line 2024
 * Includes both incorporated places AND Census Designated Places (CDPs)
 */
export const NATIONAL_PLACE_TOTAL: number = placeData.meta.nationalTotal;

/**
 * Expected Place counts by state FIPS code
 *
 * Maps state FIPS (2 digits) to expected count of places in that state.
 * Used for validation during data pipeline processing.
 *
 * @example
 * ```typescript
 * EXPECTED_PLACE_BY_STATE['06'] // 1618 (California)
 * EXPECTED_PLACE_BY_STATE['36'] // 1293 (New York)
 * ```
 */
export const EXPECTED_PLACE_BY_STATE: Readonly<Record<string, number>> =
  placeData.expectedCounts;

/**
 * Get all Place GEOIDs for a specific state
 *
 * GEOID FORMAT: SSPPPPP (State FIPS 2 digits + Place FIPS 5 digits)
 * Examples:
 *   - 0644000 = Los Angeles city, California
 *   - 3651000 = New York city, New York
 *   - 4835000 = Houston city, Texas
 *
 * @param stateFips - Two-digit state FIPS code (e.g., '06' for California)
 * @returns Read-only array of Place GEOIDs for the state, or empty array if state not found
 *
 * @example
 * ```typescript
 * const caPlaces = getPlaceGeoidsForState('06'); // 1618 California places
 * const dcPlaces = getPlaceGeoidsForState('11'); // 1 place (Washington DC)
 * const invalid = getPlaceGeoidsForState('99'); // []
 * ```
 */
export function getPlaceGeoidsForState(stateFips: string): readonly string[] {
  return placeData.geoids[stateFips] ?? [];
}

/**
 * Get all Place GEOIDs as a complete state-to-GEOIDs mapping
 *
 * Returns the full canonical dataset. Use sparingly - prefer getPlaceGeoidsForState()
 * for state-specific queries to avoid loading entire dataset.
 *
 * @returns Complete mapping of state FIPS codes to Place GEOID arrays
 *
 * @example
 * ```typescript
 * const allPlaces = getAllPlaceGeoids();
 * Object.keys(allPlaces).length // 51 (states + DC)
 * ```
 */
export function getAllPlaceGeoids(): Record<string, readonly string[]> {
  return placeData.geoids;
}

/**
 * Get expected Place count for a state
 *
 * Returns the number of places expected for a given state FIPS code.
 * Used for validation during data pipeline processing.
 *
 * @param stateFips - Two-digit state FIPS code
 * @returns Expected Place count, or null if state not found
 *
 * @example
 * ```typescript
 * getExpectedPlaceCount('06') // 1618 (California)
 * getExpectedPlaceCount('11') // 1 (DC)
 * getExpectedPlaceCount('99') // null
 * ```
 */
export function getExpectedPlaceCount(stateFips: string): number | null {
  return EXPECTED_PLACE_BY_STATE[stateFips] ?? null;
}

/**
 * Validate that actual GEOIDs match expected count for a state
 *
 * @param stateFips - Two-digit state FIPS code
 * @returns true if counts match, false otherwise
 *
 * @example
 * ```typescript
 * validatePlaceCount('06') // true (1618 GEOIDs matches expected 1618)
 * ```
 */
export function validatePlaceCount(stateFips: string): boolean {
  const expected = getExpectedPlaceCount(stateFips);
  if (expected === null) return false;

  const actual = getPlaceGeoidsForState(stateFips).length;
  return actual === expected;
}

/**
 * Get metadata about the Place GEOIDs dataset
 *
 * @returns Metadata object with source, generation date, and descriptions
 */
export function getPlaceMetadata() {
  return placeData.meta;
}
