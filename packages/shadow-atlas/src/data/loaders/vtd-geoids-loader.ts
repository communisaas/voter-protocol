/**
 * VTD GEOID Data Loader
 *
 * Provides lazy-loaded access to canonical VTD GEOIDs extracted from
 * Census TIGER/Line 2024 via Redistricting Data Hub (VEST 2020/2022).
 *
 * This loader replaces the 1.6MB hardcoded TypeScript file with a
 * JSON data file and runtime loading, reducing bundle size.
 */

import vtdDataRaw from '../canonical/vtd-geoids.json' with { type: 'json' };

/**
 * Metadata about the VTD GEOID dataset
 */
export interface VTDMetadata {
  source: string;
  generated: string;
  totalCount: number;
  stateCount: number;
  description: string;
  notes: string[];
  expectedByState: Record<string, number>;
  actualByState: Record<string, number>;
}

interface VTDDataStructure {
  geoids: Record<string, readonly string[]>;
  meta: VTDMetadata;
}

const vtdData = vtdDataRaw as unknown as VTDDataStructure;

/**
 * Get VTD GEOIDs for a specific state
 *
 * @param stateFips - Two-digit state FIPS code (e.g., "01" for Alabama)
 * @returns Array of VTD GEOIDs for the state, or empty array if state not found
 *
 * @example
 * ```typescript
 * const alabamaVTDs = getVTDGeoidsForState('01');
 * console.log(`Alabama has ${alabamaVTDs.length} VTDs`);
 * ```
 */
export function getVTDGeoidsForState(stateFips: string): readonly string[] {
  return vtdData.geoids[stateFips] ?? [];
}

/**
 * Get all VTD GEOIDs for all states
 *
 * @returns Record mapping state FIPS codes to arrays of VTD GEOIDs
 *
 * @example
 * ```typescript
 * const allVTDs = getAllVTDGeoids();
 * Object.keys(allVTDs).forEach(state => {
 *   console.log(`State ${state}: ${allVTDs[state].length} VTDs`);
 * });
 * ```
 */
export function getAllVTDGeoids(): Record<string, readonly string[]> {
  return vtdData.geoids;
}

/**
 * Get metadata about the VTD dataset
 *
 * @returns Metadata including source, generation date, counts, and notes
 *
 * @example
 * ```typescript
 * const meta = getVTDMetadata();
 * console.log(`Dataset contains ${meta.totalCount} VTDs across ${meta.stateCount} states`);
 * console.log(`Generated: ${meta.generated}`);
 * ```
 */
export function getVTDMetadata(): VTDMetadata {
  return vtdData.meta;
}

/**
 * Get the expected VTD count for a state
 *
 * @param stateFips - Two-digit state FIPS code
 * @returns Expected number of VTDs, or null if state not found
 *
 * @example
 * ```typescript
 * const expected = getExpectedVTDCount('01');
 * const actual = getVTDGeoidsForState('01').length;
 * if (expected !== actual) {
 *   console.warn(`Alabama VTD count mismatch: expected ${expected}, got ${actual}`);
 * }
 * ```
 */
export function getExpectedVTDCount(stateFips: string): number | null {
  return vtdData.meta.expectedByState[stateFips] ?? null;
}

/**
 * Get the actual VTD count for a state
 *
 * @param stateFips - Two-digit state FIPS code
 * @returns Actual number of VTDs in the dataset, or null if state not found
 */
export function getActualVTDCount(stateFips: string): number | null {
  return vtdData.meta.actualByState[stateFips] ?? null;
}

/**
 * Validate that a GEOID exists in a state's VTD list
 *
 * @param stateFips - Two-digit state FIPS code
 * @param geoid - VTD GEOID to check
 * @returns True if the GEOID exists in the state's VTD list
 *
 * @example
 * ```typescript
 * if (isValidVTDGeoid('01', '01001000001')) {
 *   console.log('Valid Alabama VTD');
 * }
 * ```
 */
export function isValidVTDGeoid(stateFips: string, geoid: string): boolean {
  const stateVTDs = getVTDGeoidsForState(stateFips);
  return stateVTDs.includes(geoid);
}

/**
 * Get national total VTD count
 *
 * @returns Total number of VTDs across all states
 */
export function getNationalVTDTotal(): number {
  return vtdData.meta.totalCount;
}
