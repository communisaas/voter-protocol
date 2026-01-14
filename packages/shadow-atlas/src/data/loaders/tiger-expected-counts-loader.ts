/**
 * TIGER Expected Counts Loader
 *
 * Loads TIGER expected counts from canonical JSON data files.
 * Provides type-safe access to expected feature counts by layer and state.
 *
 * WS-A4: Extracted from validators/tiger-expected-counts.ts
 */

import tigerData from '../canonical/tiger-expected-counts.json' with { type: 'json' };

/**
 * TIGER layer types for expected count lookups
 */
export type TigerCountLayer =
  | 'cd' | 'sldu' | 'sldl' | 'county' | 'cousub' | 'submcd'
  | 'place' | 'cdp' | 'concity' | 'unsd' | 'elsd' | 'scsd'
  | 'vtd' | 'aiannh' | 'anrc' | 'tbg' | 'ttract'
  | 'cbsa' | 'csa' | 'metdiv' | 'uac' | 'necta' | 'cnecta' | 'nectadiv'
  | 'zcta' | 'tract' | 'bg' | 'puma' | 'estate' | 'mil';

/**
 * VTD data vintage metadata
 */
export interface VtdDataVintage {
  readonly cycle: number;
  readonly validUntil: number;
  readonly source: string;
  readonly tigerVintage: number;
}

// Type the JSON data
const data = tigerData as {
  metadata: { description: string; source: string; lastUpdated: string; dataVintage: string };
  nationalTotals: Record<string, number | null>;
  cdByState: Record<string, number>;
  slduByState: Record<string, number>;
  sldlByState: Record<string, number>;
  countiesByState: Record<string, number>;
  unsdByState: Record<string, number>;
  elsdByState: Record<string, number>;
  scsdByState: Record<string, number>;
  vtdByState: Record<string, number>;
  placeByState: Record<string, number>;
  cdpByState: Record<string, number>;
  cousubByState: Record<string, number>;
  submcdByState: Record<string, number>;
  concityByState: Record<string, number>;
  aianhhByState: Record<string, number>;
  vtdDataVintage: VtdDataVintage;
};

/**
 * National totals for all TIGER layer types
 */
export const EXPECTED_COUNTS = data.nationalTotals;

/**
 * Congressional District counts by state FIPS
 */
export const EXPECTED_CD_BY_STATE = data.cdByState;

/**
 * State Legislative Upper (Senate) district counts by state FIPS
 */
export const EXPECTED_SLDU_BY_STATE = data.slduByState;

/**
 * State Legislative Lower (House) district counts by state FIPS
 */
export const EXPECTED_SLDL_BY_STATE = data.sldlByState;

/**
 * County counts by state FIPS
 */
export const EXPECTED_COUNTIES_BY_STATE = data.countiesByState;

/**
 * Unified School District counts by state FIPS
 */
export const EXPECTED_UNSD_BY_STATE = data.unsdByState;

/**
 * Elementary School District counts by state FIPS
 */
export const EXPECTED_ELSD_BY_STATE = data.elsdByState;

/**
 * Secondary School District counts by state FIPS
 */
export const EXPECTED_SCSD_BY_STATE = data.scsdByState;

/**
 * Voting Tabulation District counts by state FIPS
 */
export const EXPECTED_VTD_BY_STATE = data.vtdByState;

/**
 * Place (city/town/village) counts by state FIPS
 */
export const EXPECTED_PLACE_BY_STATE = data.placeByState;

/**
 * Census Designated Place counts by state FIPS
 */
export const EXPECTED_CDP_BY_STATE = data.cdpByState;

/**
 * County Subdivision counts by state FIPS
 */
export const EXPECTED_COUSUB_BY_STATE = data.cousubByState;

/**
 * Subminor Civil Division counts by state FIPS (Puerto Rico only)
 */
export const EXPECTED_SUBMCD_BY_STATE = data.submcdByState;

/**
 * Consolidated City counts by state FIPS
 */
export const EXPECTED_CONCITY_BY_STATE = data.concityByState;

/**
 * American Indian/Alaska Native/Native Hawaiian Area counts by state FIPS
 */
export const EXPECTED_AIANNH_BY_STATE = data.aianhhByState;

/**
 * VTD data freshness metadata
 */
export const VTD_DATA_VINTAGE: VtdDataVintage = data.vtdDataVintage;

/**
 * Check if VTD data is still fresh based on redistricting cycle
 */
export function isVtdDataFresh(currentYear?: number): boolean {
  const year = currentYear ?? new Date().getFullYear();
  return year < VTD_DATA_VINTAGE.validUntil;
}

/**
 * Get expected count for a TIGER layer at national or state level
 */
export function getExpectedCount(
  layer: TigerCountLayer,
  stateFips?: string
): number | null {
  const stateCountMaps: Record<string, Record<string, number>> = {
    cd: EXPECTED_CD_BY_STATE,
    sldu: EXPECTED_SLDU_BY_STATE,
    sldl: EXPECTED_SLDL_BY_STATE,
    county: EXPECTED_COUNTIES_BY_STATE,
    unsd: EXPECTED_UNSD_BY_STATE,
    elsd: EXPECTED_ELSD_BY_STATE,
    scsd: EXPECTED_SCSD_BY_STATE,
    vtd: EXPECTED_VTD_BY_STATE,
    place: EXPECTED_PLACE_BY_STATE,
    cdp: EXPECTED_CDP_BY_STATE,
    cousub: EXPECTED_COUSUB_BY_STATE,
    submcd: EXPECTED_SUBMCD_BY_STATE,
    concity: EXPECTED_CONCITY_BY_STATE,
    aiannh: EXPECTED_AIANNH_BY_STATE,
  };

  if (stateFips && stateCountMaps[layer]) {
    return stateCountMaps[layer][stateFips] ?? null;
  }

  // For layers with state-level data but national request, compute total
  if (!stateFips && stateCountMaps[layer]) {
    return Object.values(stateCountMaps[layer]).reduce((a, b) => a + b, 0);
  }

  // National-only counts
  return EXPECTED_COUNTS[layer] ?? null;
}

/**
 * National totals computed from state-level data
 */
export const NATIONAL_TOTALS = {
  cd: 435,
  sldu: Object.values(EXPECTED_SLDU_BY_STATE).reduce((a, b) => a + b, 0),
  sldl: Object.values(EXPECTED_SLDL_BY_STATE).reduce((a, b) => a + b, 0),
  county: 3235,
  unsd: Object.values(EXPECTED_UNSD_BY_STATE).reduce((a, b) => a + b, 0),
  elsd: Object.values(EXPECTED_ELSD_BY_STATE).reduce((a, b) => a + b, 0),
  scsd: Object.values(EXPECTED_SCSD_BY_STATE).reduce((a, b) => a + b, 0),
  place: Object.values(EXPECTED_PLACE_BY_STATE).reduce((a, b) => a + b, 0),
  cdp: Object.values(EXPECTED_CDP_BY_STATE).reduce((a, b) => a + b, 0),
  cousub: Object.values(EXPECTED_COUSUB_BY_STATE).reduce((a, b) => a + b, 0),
  vtd: Object.values(EXPECTED_VTD_BY_STATE).reduce((a, b) => a + b, 0),
  submcd: Object.values(EXPECTED_SUBMCD_BY_STATE).reduce((a, b) => a + b, 0),
  concity: Object.values(EXPECTED_CONCITY_BY_STATE).reduce((a, b) => a + b, 0),
  aiannh: Object.values(EXPECTED_AIANNH_BY_STATE).reduce((a, b) => a + b, 0),
} as const;

/**
 * Validate that reference counts are internally consistent
 */
export function validateReferenceCounts(): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Congressional Districts must sum to 435
  const cdTotal = Object.values(EXPECTED_CD_BY_STATE).reduce((sum, n) => sum + n, 0);
  if (cdTotal !== EXPECTED_COUNTS.cd) {
    errors.push(`CD total mismatch: ${cdTotal} !== ${EXPECTED_COUNTS.cd}`);
  }

  // Counties must sum to 3235
  const countyTotal = Object.values(EXPECTED_COUNTIES_BY_STATE).reduce((sum, n) => sum + n, 0);
  if (countyTotal !== EXPECTED_COUNTS.county) {
    errors.push(`County total mismatch: ${countyTotal} !== ${EXPECTED_COUNTS.county}`);
  }

  // Nebraska SLDU must be 49, SLDL must be 0 (unicameral)
  if (EXPECTED_SLDU_BY_STATE['31'] !== 49) {
    errors.push(`Nebraska SLDU must be 49, got ${EXPECTED_SLDU_BY_STATE['31']}`);
  }
  if (EXPECTED_SLDL_BY_STATE['31'] !== 0) {
    errors.push(`Nebraska SLDL must be 0, got ${EXPECTED_SLDL_BY_STATE['31']}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Get metadata about the TIGER expected counts data
 */
export function getMetadata() {
  return data.metadata;
}
