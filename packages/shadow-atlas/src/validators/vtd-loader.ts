/**
 * VTD GEOID Loader
 *
 * Loads Voting Tabulation District (VTD) GEOIDs from vtd-geoids.ts.
 * VTDs are sourced from Redistricting Data Hub (Princeton Gerrymandering Project).
 *
 * GEOID FORMAT: 11 digits (SSCCCVVVVVV)
 * - State FIPS: 2 digits
 * - County FIPS: 3 digits
 * - VTD Code: 6 digits
 *
 * DATA SOURCE: https://redistrictingdatahub.org/
 */

import {
  CANONICAL_VTD_GEOIDS,
  EXPECTED_VTD_BY_STATE,
  NATIONAL_VTD_TOTAL,
} from './vtd-geoids.js';

/**
 * Load VTD GEOIDs for a state
 *
 * @param stateFips - Two-digit state FIPS code
 * @returns Array of VTD GEOIDs, or null if not available
 */
export function loadVTDGEOIDs(stateFips: string): readonly string[] | null {
  return CANONICAL_VTD_GEOIDS[stateFips] ?? null;
}

/**
 * Check if VTD data is available for a state
 *
 * @param stateFips - Two-digit state FIPS code
 * @returns True if VTD data exists for the state
 */
export function hasVTDData(stateFips: string): boolean {
  return stateFips in CANONICAL_VTD_GEOIDS;
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
  return EXPECTED_VTD_BY_STATE[stateFips] ?? 0;
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
  const count = EXPECTED_VTD_BY_STATE[stateFips];
  if (count === undefined) {
    return null;
  }

  return {
    stateFips,
    count,
    timestamp: '2026-01-09T22:03:27.515Z',
    source: 'https://redistrictingdatahub.org',
    vintage: 'VEST 2020/2022',
  };
}

/**
 * Get all states with available VTD data
 *
 * @returns Array of state FIPS codes with VTD data
 */
export function getStatesWithVTDData(): readonly string[] {
  return Object.keys(CANONICAL_VTD_GEOIDS);
}

/**
 * Preload VTD data for multiple states
 *
 * Note: Since data is now stored in TypeScript, this is a no-op.
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
  return NATIONAL_VTD_TOTAL;
}
