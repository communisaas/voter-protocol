/**
 * VTD GEOID Loader
 *
 * Loads Voting Tabulation District (VTD) GEOIDs from the canonical JSON
 * dataset (src/data/canonical/vtd-geoids.json) via the shared data loader.
 * VTDs are sourced from TIGER 2020 PL VTD (Census Bureau 94-171
 * redistricting product); 2020-vintage, frozen until the 2030 cycle.
 *
 * This module previously delegated to the hardcoded validators/vtd-geoids.ts
 * (now deleted); the delegation is not a behavior-preserving no-op:
 * - getNationalVTDTotal() now returns the dataset-actual total (124,179,
 *   sum of every state's real GEOID array, including Utah) instead of the
 *   old hardcoded NATIONAL_VTD_TOTAL (121,755, the VEST-expected total that
 *   excluded Utah and DC).
 * - getStatesWithVTDData() now iterates the dataset's real geoids keys (50
 *   states, matching hasVTDData()) instead of expectedByState (49 states,
 *   which omits Utah) - the old module's equivalent behavior also iterated
 *   real GEOID keys, so this restores consistency with hasVTDData() rather
 *   than changing it.
 * Callers relying on the old VEST-derived 121,755 figure or a 49-state list
 * should read EXPECTED_VTD_BY_STATE / meta.expectedByState directly instead.
 *
 * GEOID FORMAT: 11 digits (SSCCCVVVVVV)
 * - State FIPS: 2 digits
 * - County FIPS: 3 digits
 * - VTD Code: 6 digits
 */

import {
  getVTDGeoidsForState,
  getAllVTDGeoids,
  getExpectedVTDCount,
  getNationalVTDTotal as getNationalVTDTotalFromLoader,
  getVTDMetadata as getDatasetVTDMetadata,
} from '../../data/loaders/vtd-geoids-loader.js';

/**
 * Load VTD GEOIDs for a state
 *
 * @param stateFips - Two-digit state FIPS code
 * @returns Array of VTD GEOIDs, or null if not available
 */
export function loadVTDGEOIDs(stateFips: string): readonly string[] | null {
  const geoids = getVTDGeoidsForState(stateFips);
  return geoids.length > 0 ? geoids : null;
}

/**
 * Check if VTD data is available for a state
 *
 * @param stateFips - Two-digit state FIPS code
 * @returns True if VTD data exists for the state
 */
export function hasVTDData(stateFips: string): boolean {
  return getVTDGeoidsForState(stateFips).length > 0;
}

/**
 * Get VTD count for a state without loading full GEOID list
 *
 * More efficient than loading full list if you only need the count.
 *
 * @param stateFips - Two-digit state FIPS code
 * @returns Number of VTDs, or 0 if data not available
 */
export function getVTDCount(stateFips: string): number {
  return getExpectedVTDCount(stateFips) ?? 0;
}

interface VTDMetadata {
  readonly stateFips: string;
  readonly count: number;
  readonly timestamp: string;
  readonly source: string;
  readonly vintage: string;
}

/**
 * Get VTD metadata for a state
 *
 * Returns metadata including source and vintage information.
 *
 * @param stateFips - Two-digit state FIPS code
 * @returns VTD metadata, or null if not available
 */
export function getVTDMetadata(stateFips: string): VTDMetadata | null {
  const count = getExpectedVTDCount(stateFips);
  if (count === null) {
    return null;
  }

  const datasetMeta = getDatasetVTDMetadata();

  return {
    stateFips,
    count,
    timestamp: datasetMeta.generated,
    source: datasetMeta.source,
    vintage: '2020 Redistricting cycle, frozen until 2030',
  };
}

/**
 * Get all states with available VTD data
 *
 * Reflects actual GEOID data presence (consistent with hasVTDData()), not
 * the VEST-derived expectedByState table - which currently omits Utah (FIPS
 * 49) even though Utah's GEOIDs are present in the dataset. Iterating the
 * real geoids keys keeps this in sync with hasVTDData() for every state.
 *
 * @returns Array of state FIPS codes with VTD data
 */
export function getStatesWithVTDData(): readonly string[] {
  return Object.keys(getAllVTDGeoids());
}

/**
 * Preload VTD data for multiple states
 *
 * Note: Data is loaded from a single JSON module, so this is a no-op.
 * Kept for API compatibility.
 *
 * @param stateFips - Array of state FIPS codes to preload
 * @returns Number of states successfully loaded
 */
export function preloadVTDData(stateFips: readonly string[]): number {
  let loaded = 0;

  for (const fips of stateFips) {
    if (hasVTDData(fips)) {
      loaded++;
    }
  }

  return loaded;
}

/**
 * Get national VTD total
 *
 * @returns Total number of VTDs across all states
 */
export function getNationalVTDTotal(): number {
  return getNationalVTDTotalFromLoader();
}
