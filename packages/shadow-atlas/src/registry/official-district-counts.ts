/**
 * Official Legislative District Counts Registry
 *
 * CONSOLIDATED: This file now re-exports from tiger-expected-counts.ts
 * to provide a backwards-compatible state abbreviation API.
 *
 * SINGLE SOURCE OF TRUTH: validators/tiger-expected-counts.ts
 *
 * This file maintains API compatibility for existing code that expects
 * state abbreviation-based lookups (e.g., "CA" instead of FIPS "06").
 *
 * DATA SOURCES:
 * - Congressional: 2020 Census Apportionment (https://www.census.gov/data/tables/2020/dec/2020-apportionment-data.html)
 * - State Legislative: NCSL State Legislatures Database (https://www.ncsl.org/about-state-legislatures/number-of-legislators-and-length-of-terms)
 * - TIGER/Line Shapefiles: https://www2.census.gov/geo/tiger/TIGER2024/
 *
 * VALIDATION:
 * - Congressional: 435 voting seats (fixed by Public Law 62-5, 1911)
 * - Non-voting delegates: DC, PR, AS, GU, MP, VI (6 territories)
 * - State Legislative: Varies by state, typically 30-67 senators, 40-400 house members
 * - Nebraska: Unicameral legislature (49 senators, no house)
 *
 * LAST UPDATED: 2025-12-19 (consolidated with tiger-expected-counts.ts)
 */

import {
  EXPECTED_CD_BY_STATE,
  EXPECTED_SLDU_BY_STATE,
  EXPECTED_SLDL_BY_STATE,
  EXPECTED_COUNTIES_BY_STATE,
  FIPS_TO_STATE_ABBR,
  getStateName,
  getStateAbbr,
  getStateFips,
  NATIONAL_TOTALS,
} from '../validators/tiger-expected-counts.js';
import { STATE_ABBR_TO_FIPS } from '../core/types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Legislative chamber types
 */
export type LegislativeChamber = 'congressional' | 'state_senate' | 'state_house';

/**
 * Official district count record (backwards compatible)
 */
export interface OfficialDistrictCount {
  /** State abbreviation (2-letter) */
  readonly state: string;

  /** State name (for documentation) */
  readonly stateName: string;

  /** State FIPS code */
  readonly fips: string;

  /** Congressional districts (U.S. House) */
  readonly congressional: number;

  /** State Senate seats (upper chamber) */
  readonly stateSenate: number | null;

  /** State House seats (lower chamber) */
  readonly stateHouse: number | null;

  /** County count */
  readonly counties: number;

  /** Data vintage (year) */
  readonly vintage: number;

  /** Last verified date (ISO 8601) */
  readonly lastVerified: string;

  /** Special notes */
  readonly notes?: string;
}

// ============================================================================
// Re-exported constants (computed from canonical source)
// ============================================================================

/**
 * Congressional district counts by state abbreviation (119th Congress)
 *
 * Source: Re-exported from tiger-expected-counts.ts
 * Total: 435 voting seats
 */
export const CONGRESSIONAL_DISTRICTS: Record<string, number> = Object.fromEntries(
  Object.entries(EXPECTED_CD_BY_STATE)
    .map(([fips, count]) => {
      const abbr = FIPS_TO_STATE_ABBR[fips];
      return abbr ? [abbr, count] : null;
    })
    .filter((entry): entry is [string, number] => entry !== null)
);

/**
 * Non-voting delegates (not counted in 435)
 */
export const NON_VOTING_DELEGATES: Record<string, string> = {
  DC: 'District of Columbia',
  PR: 'Puerto Rico',
  AS: 'American Samoa',
  GU: 'Guam',
  MP: 'Northern Mariana Islands',
  VI: 'U.S. Virgin Islands',
};

/**
 * State Senate DISTRICT counts by state abbreviation (upper chamber)
 *
 * Source: Re-exported from tiger-expected-counts.ts
 */
export const STATE_SENATE_DISTRICTS: Record<string, number> = Object.fromEntries(
  Object.entries(EXPECTED_SLDU_BY_STATE)
    .map(([fips, count]) => {
      const abbr = FIPS_TO_STATE_ABBR[fips];
      return abbr ? [abbr, count] : null;
    })
    .filter((entry): entry is [string, number] => entry !== null)
);

/**
 * State House DISTRICT counts by state abbreviation (lower chamber)
 *
 * Source: Re-exported from tiger-expected-counts.ts
 */
export const STATE_HOUSE_DISTRICTS: Record<string, number | null> = Object.fromEntries(
  Object.entries(EXPECTED_SLDL_BY_STATE)
    .map(([fips, count]) => {
      const abbr = FIPS_TO_STATE_ABBR[fips];
      return abbr ? [abbr, count === 0 ? null : count] : null;
    })
    .filter((entry): entry is [string, number | null] => entry !== null)
);

/**
 * County counts by state abbreviation
 *
 * Source: Re-exported from tiger-expected-counts.ts
 */
export const COUNTY_COUNTS: Record<string, number> = Object.fromEntries(
  Object.entries(EXPECTED_COUNTIES_BY_STATE)
    .map(([fips, count]) => {
      const abbr = FIPS_TO_STATE_ABBR[fips];
      return abbr ? [abbr, count] : null;
    })
    .filter((entry): entry is [string, number] => entry !== null)
);

// ============================================================================
// Complete Registry (backwards compatible)
// ============================================================================

/**
 * Official District Counts Registry
 *
 * Complete reference for all legislative boundary counts by state.
 * Use this as ground truth for validation.
 *
 * NOTE: Data sourced from tiger-expected-counts.ts (single source of truth)
 */
export const OFFICIAL_DISTRICT_COUNTS: Record<string, OfficialDistrictCount> = Object.fromEntries(
  Object.entries(STATE_ABBR_TO_FIPS).map(([abbr, fipsCode]): [string, OfficialDistrictCount] => {
    const congressional = EXPECTED_CD_BY_STATE[fipsCode] ?? 0;
    const stateSenate = EXPECTED_SLDU_BY_STATE[fipsCode] ?? 0;
    const stateHouse = EXPECTED_SLDL_BY_STATE[fipsCode] ?? 0;
    const counties = EXPECTED_COUNTIES_BY_STATE[fipsCode] ?? 0;
    const stateName = getStateName(fipsCode) ?? abbr;

    // Special notes for specific states
    const notes: Record<string, string> = {
      NE: 'Unicameral legislature (only state with no house chamber)',
      DC: 'Non-voting delegate. City Council has 8 wards (not state legislature)',
      PR: 'Non-voting resident commissioner',
      CA: 'Lost 1 seat in 2020 reapportionment (53 → 52)',
      CO: 'Gained 1 seat in 2020 reapportionment (7 → 8)',
      FL: 'Gained 1 seat in 2020 reapportionment (27 → 28)',
      IL: 'Lost 1 seat in 2020 reapportionment (18 → 17)',
      MI: 'Lost 1 seat in 2020 reapportionment (14 → 13)',
      MT: 'Gained 1 seat in 2020 reapportionment (1 → 2)',
      NC: 'Gained 1 seat in 2020 reapportionment (13 → 14)',
      NY: 'Lost 1 seat in 2020 reapportionment (27 → 26)',
      OH: 'Lost 1 seat in 2020 reapportionment (16 → 15)',
      OR: 'Gained 1 seat in 2020 reapportionment (5 → 6)',
      PA: 'Lost 1 seat in 2020 reapportionment (18 → 17)',
      TX: 'Gained 2 seats in 2020 reapportionment (36 → 38). Most counties in U.S. (254)',
      WV: 'Lost 1 seat in 2020 reapportionment (3 → 2)',
      AZ: 'Multi-member house districts: 30 districts × 2 = 60 seats',
      ID: 'Multi-member house districts: 35 districts × 2 = 70 seats',
      MD: 'Multi-member house districts: 71 districts (variable membership) = 141 seats',
      NH: 'Largest state house in U.S. (400 seats). Floterial system: 164 districts with variable membership',
      NJ: 'Multi-member house districts: 40 districts × 2 = 80 seats',
      ND: 'Multi-member house districts: 48 districts (mostly 2-member) = 94 seats',
      SD: 'Multi-member house districts: 37 districts (mostly 2-member) = 70 seats',
      VT: 'Multi-member districts: 16 senate districts = 30 seats, 109 house districts = 150 seats',
      WA: 'Multi-member house districts: 49 districts × 2 = 98 seats',
    };

    return [
      abbr,
      {
        state: abbr,
        stateName,
        fips: fipsCode,
        congressional,
        stateSenate: stateSenate > 0 ? stateSenate : null,
        stateHouse: stateHouse > 0 ? stateHouse : null,
        counties,
        vintage: 2024,
        lastVerified: '2025-12-19',
        notes: notes[abbr],
      },
    ];
  })
);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get official district count for a state and chamber
 */
export function getOfficialCount(
  state: string,
  chamber: LegislativeChamber
): number | null {
  const record = OFFICIAL_DISTRICT_COUNTS[state];
  if (!record) return null;

  switch (chamber) {
    case 'congressional':
      return record.congressional;
    case 'state_senate':
      return record.stateSenate;
    case 'state_house':
      return record.stateHouse;
    default:
      return null;
  }
}

/**
 * Get complete record for a state
 */
export function getStateRecord(state: string): OfficialDistrictCount | null {
  return OFFICIAL_DISTRICT_COUNTS[state] || null;
}

/**
 * Validate count against official data
 */
export interface CountValidation {
  readonly isValid: boolean;
  readonly expected: number | null;
  readonly actual: number;
  readonly difference: number;
  readonly confidence: number;
}

export function validateCount(
  state: string,
  chamber: LegislativeChamber,
  actualCount: number
): CountValidation {
  const expected = getOfficialCount(state, chamber);

  if (expected === null) {
    return {
      isValid: false,
      expected: null,
      actual: actualCount,
      difference: 0,
      confidence: 0.0,
    };
  }

  const difference = actualCount - expected;
  const isValid = difference === 0;

  // Confidence based on difference
  let confidence = 1.0;
  if (Math.abs(difference) === 1) {
    confidence = 0.7; // Minor discrepancy
  } else if (Math.abs(difference) >= 2) {
    confidence = 0.0; // Major discrepancy
  }

  return {
    isValid,
    expected,
    actual: actualCount,
    difference,
    confidence,
  };
}

/**
 * Get total congressional districts (should be 435)
 */
export function getTotalCongressionalDistricts(): number {
  return NATIONAL_TOTALS.cd;
}

/**
 * Get states that changed after 2020 reapportionment
 */
export interface ReapportionmentChange {
  readonly state: string;
  readonly oldCount: number;
  readonly newCount: number;
  readonly change: number;
}

export const REAPPORTIONMENT_CHANGES: ReapportionmentChange[] = [
  { state: 'TX', oldCount: 36, newCount: 38, change: +2 },
  { state: 'FL', oldCount: 27, newCount: 28, change: +1 },
  { state: 'NC', oldCount: 13, newCount: 14, change: +1 },
  { state: 'CO', oldCount: 7, newCount: 8, change: +1 },
  { state: 'OR', oldCount: 5, newCount: 6, change: +1 },
  { state: 'MT', oldCount: 1, newCount: 2, change: +1 },
  { state: 'CA', oldCount: 53, newCount: 52, change: -1 },
  { state: 'NY', oldCount: 27, newCount: 26, change: -1 },
  { state: 'IL', oldCount: 18, newCount: 17, change: -1 },
  { state: 'MI', oldCount: 14, newCount: 13, change: -1 },
  { state: 'OH', oldCount: 16, newCount: 15, change: -1 },
  { state: 'PA', oldCount: 18, newCount: 17, change: -1 },
  { state: 'WV', oldCount: 3, newCount: 2, change: -1 },
];
