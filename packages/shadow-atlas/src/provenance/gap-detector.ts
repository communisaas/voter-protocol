/**
 * Redistricting Gap Detector - WP-FRESHNESS-5
 *
 * Detects when we're in the "redistricting gap" period where TIGER is guaranteed stale.
 *
 * GAP TIMELINE:
 *   Dec 2021: States finalize new redistricting maps
 *   Jan 2022: New districts take LEGAL EFFECT
 *             → TIGER still shows OLD districts
 *             → Anyone using TIGER serves WRONG data
 *   Jul 2022: Census releases TIGER 2022
 *             → Finally includes new districts
 *
 * GAP PERIOD: Jan-Jun 2022 (6 months of guaranteed TIGER staleness)
 *
 * Implements DATA-FRESHNESS-SPEC Section 6 (Redistricting Gap Detection).
 */

/**
 * Boundary types supported by the gap detector
 *
 * NOTE: Provenance subsystem uses simplified naming convention for internal
 * data freshness tracking. Maps conceptually to canonical BoundaryType enum
 * in ../types/boundary.ts but with different string literal values.
 *
 * See tiger-authority-rules.ts for complete mapping documentation.
 */
export type GapBoundaryType =
  | 'congressional'
  | 'state_senate'
  | 'state_house'
  | 'county'
  | 'place'
  | 'city_council'
  | 'school_unified'
  | 'voting_precinct'
  | 'special_district';

/**
 * Redistricting cycle information
 *
 * Each cycle spans 2 years:
 * - Year 1 (2021): States finalize redistricting
 * - Year 2 (2022): Gap period + TIGER update
 */
interface RedistrictingCycle {
  /** Census year that triggered redistricting (2020, 2030, 2040) */
  readonly cycleYear: number;

  /** Years when redistricting occurs [finalization year, gap year] */
  readonly redistrictingYears: readonly [number, number];

  /** Start of gap period (Jan 1 of second year) */
  readonly gapPeriodStart: Date;

  /** End of gap period (Jul 1 of second year, when TIGER updates) */
  readonly gapPeriodEnd: Date;

  /** Expected TIGER release date (mid-July) */
  readonly tigerExpectedRelease: Date;
}

/**
 * State finalization information
 *
 * Tracks when each state finalized and activated new districts.
 * Historical data from 2020 redistricting cycle.
 */
interface StateFinalization {
  /** State name */
  readonly state: string;

  /** Two-letter state code */
  readonly stateCode: string;

  /** Date state finalized new maps */
  readonly finalizedDate: Date;

  /** Date new maps became legally effective */
  readonly effectiveDate: Date;

  /** Whether state faced court challenges */
  readonly courtChallenges: boolean;

  /** Additional context about finalization */
  readonly notes?: string;
}

/**
 * Gap status for a specific boundary and jurisdiction
 */
interface GapStatus {
  /** Whether currently in gap period */
  readonly inGap: boolean;

  /** Type of gap situation */
  readonly gapType: 'pre-finalization' | 'post-finalization-pre-tiger' | 'post-tiger' | 'none';

  /** Recommended action */
  readonly recommendation: 'use-tiger' | 'use-primary' | 'wait' | 'manual-review';

  /** Explanation of status */
  readonly reasoning: string;

  /** State finalization info (if applicable) */
  readonly finalizationInfo?: StateFinalization;
}

/**
 * State currently in gap period
 */
interface StateGapInfo {
  /** State name */
  readonly state: string;

  /** Two-letter state code */
  readonly stateCode: string;

  /** When state finalized new maps */
  readonly finalizedAt: Date;

  /** When new maps became effective */
  readonly effectiveAt: Date;

  /** Days since effective date */
  readonly gapDays: number;

  /** What to do about it */
  readonly recommendation: string;
}

/**
 * Boundary types affected by redistricting gaps
 *
 * Legislative boundaries affected by redistricting:
 * - Congressional districts
 * - State senate districts
 * - State house districts
 *
 * VTDs are affected by DIFFERENT gap patterns (post-election, precinct consolidation).
 */
const REDISTRICTING_BOUNDARY_TYPES = new Set<GapBoundaryType>([
  'congressional',
  'state_senate',
  'state_house',
]);

/**
 * Boundary types affected by VTD-specific gaps
 *
 * VTDs have different gap patterns than legislative districts:
 * - Post-election precinct consolidation (Q1 each year)
 * - State-specific redistricting cycles
 * - No TIGER source (VTDs not in TIGER)
 */
const VTD_BOUNDARY_TYPES = new Set<GapBoundaryType>(['voting_precinct']);

/**
 * Redistricting cycle calendar
 *
 * Redistricting follows 10-year census cycles.
 * Each cycle has a predictable timeline:
 * - Year 0 (2020): Decennial Census
 * - Year 1 (2021): States draw new maps
 * - Year 2 (2022): Gap period (Jan-Jun), TIGER update (Jul)
 */
const REDISTRICTING_CYCLES = new Map<number, RedistrictingCycle>([
  [2020, {
    cycleYear: 2020,
    redistrictingYears: [2021, 2022],
    gapPeriodStart: new Date('2022-01-01T00:00:00Z'),
    gapPeriodEnd: new Date('2022-07-01T00:00:00Z'),
    tigerExpectedRelease: new Date('2022-07-15T00:00:00Z'),
  }],
  [2030, {
    cycleYear: 2030,
    redistrictingYears: [2031, 2032],
    gapPeriodStart: new Date('2032-01-01T00:00:00Z'),
    gapPeriodEnd: new Date('2032-07-01T00:00:00Z'),
    tigerExpectedRelease: new Date('2032-07-15T00:00:00Z'),
  }],
  [2040, {
    cycleYear: 2040,
    redistrictingYears: [2041, 2042],
    gapPeriodStart: new Date('2042-01-01T00:00:00Z'),
    gapPeriodEnd: new Date('2042-07-01T00:00:00Z'),
    tigerExpectedRelease: new Date('2042-07-15T00:00:00Z'),
  }],
]);

/**
 * State finalization dates for 2020 redistricting cycle
 *
 * Historical data from actual 2021-2022 redistricting.
 * Dates are approximate (within 1 week of actual finalization).
 *
 * Sources:
 * - Brennan Center for Justice redistricting tracker
 * - All About Redistricting (redistricting.lls.edu)
 * - State redistricting commission websites
 */
const FINALIZATIONS_2020 = new Map<string, StateFinalization>([
  ['CA', {
    state: 'California',
    stateCode: 'CA',
    finalizedDate: new Date('2021-12-20'),
    effectiveDate: new Date('2022-01-01'),
    courtChallenges: false,
  }],
  ['TX', {
    state: 'Texas',
    stateCode: 'TX',
    finalizedDate: new Date('2021-10-25'),
    effectiveDate: new Date('2022-01-01'),
    courtChallenges: true,
    notes: 'Voting Rights Act challenges',
  }],
  ['NY', {
    state: 'New York',
    stateCode: 'NY',
    finalizedDate: new Date('2022-02-02'),
    effectiveDate: new Date('2022-06-28'),
    courtChallenges: true,
    notes: 'Court-ordered redraw after initial maps struck down',
  }],
  ['FL', {
    state: 'Florida',
    stateCode: 'FL',
    finalizedDate: new Date('2022-04-22'),
    effectiveDate: new Date('2022-04-22'),
    courtChallenges: false,
  }],
  ['PA', {
    state: 'Pennsylvania',
    stateCode: 'PA',
    finalizedDate: new Date('2022-02-23'),
    effectiveDate: new Date('2022-02-23'),
    courtChallenges: true,
    notes: 'PA Supreme Court adopted its own map',
  }],
  ['OH', {
    state: 'Ohio',
    stateCode: 'OH',
    finalizedDate: new Date('2022-03-02'),
    effectiveDate: new Date('2022-03-02'),
    courtChallenges: true,
    notes: 'Multiple court challenges and redraws',
  }],
  ['NC', {
    state: 'North Carolina',
    stateCode: 'NC',
    finalizedDate: new Date('2021-11-04'),
    effectiveDate: new Date('2022-01-01'),
    courtChallenges: true,
    notes: 'State court ordered redraw',
  }],
  ['GA', {
    state: 'Georgia',
    stateCode: 'GA',
    finalizedDate: new Date('2021-11-18'),
    effectiveDate: new Date('2022-01-01'),
    courtChallenges: true,
  }],
  ['IL', {
    state: 'Illinois',
    stateCode: 'IL',
    finalizedDate: new Date('2021-09-24'),
    effectiveDate: new Date('2022-01-01'),
    courtChallenges: false,
  }],
  ['MI', {
    state: 'Michigan',
    stateCode: 'MI',
    finalizedDate: new Date('2021-12-28'),
    effectiveDate: new Date('2022-01-01'),
    courtChallenges: false,
    notes: 'Independent Citizens Redistricting Commission',
  }],
  ['AZ', {
    state: 'Arizona',
    stateCode: 'AZ',
    finalizedDate: new Date('2021-12-22'),
    effectiveDate: new Date('2022-01-01'),
    courtChallenges: false,
    notes: 'Independent Redistricting Commission',
  }],
  ['CO', {
    state: 'Colorado',
    stateCode: 'CO',
    finalizedDate: new Date('2021-09-28'),
    effectiveDate: new Date('2022-01-01'),
    courtChallenges: false,
  }],
  ['WA', {
    state: 'Washington',
    stateCode: 'WA',
    finalizedDate: new Date('2021-11-16'),
    effectiveDate: new Date('2022-01-01'),
    courtChallenges: false,
  }],
  ['OR', {
    state: 'Oregon',
    stateCode: 'OR',
    finalizedDate: new Date('2021-09-27'),
    effectiveDate: new Date('2022-01-01'),
    courtChallenges: false,
  }],
  ['NV', {
    state: 'Nevada',
    stateCode: 'NV',
    finalizedDate: new Date('2021-11-16'),
    effectiveDate: new Date('2022-01-01'),
    courtChallenges: false,
  }],
  ['VA', {
    state: 'Virginia',
    stateCode: 'VA',
    finalizedDate: new Date('2021-12-28'),
    effectiveDate: new Date('2022-01-01'),
    courtChallenges: false,
  }],
  ['MD', {
    state: 'Maryland',
    stateCode: 'MD',
    finalizedDate: new Date('2021-12-09'),
    effectiveDate: new Date('2022-01-01'),
    courtChallenges: true,
  }],
  ['MN', {
    state: 'Minnesota',
    stateCode: 'MN',
    finalizedDate: new Date('2022-02-15'),
    effectiveDate: new Date('2022-02-15'),
    courtChallenges: false,
    notes: 'Court-drawn after legislature deadlocked',
  }],
  ['WI', {
    state: 'Wisconsin',
    stateCode: 'WI',
    finalizedDate: new Date('2022-03-03'),
    effectiveDate: new Date('2022-03-03'),
    courtChallenges: true,
    notes: 'State Supreme Court selected map',
  }],
  ['NJ', {
    state: 'New Jersey',
    stateCode: 'NJ',
    finalizedDate: new Date('2021-12-23'),
    effectiveDate: new Date('2022-01-01'),
    courtChallenges: false,
  }],
  ['IN', {
    state: 'Indiana',
    stateCode: 'IN',
    finalizedDate: new Date('2021-09-29'),
    effectiveDate: new Date('2022-01-01'),
    courtChallenges: false,
  }],
  ['TN', {
    state: 'Tennessee',
    stateCode: 'TN',
    finalizedDate: new Date('2022-01-20'),
    effectiveDate: new Date('2022-01-20'),
    courtChallenges: false,
  }],
  ['MO', {
    state: 'Missouri',
    stateCode: 'MO',
    finalizedDate: new Date('2022-01-26'),
    effectiveDate: new Date('2022-01-26'),
    courtChallenges: false,
  }],
  ['AL', {
    state: 'Alabama',
    stateCode: 'AL',
    finalizedDate: new Date('2021-11-04'),
    effectiveDate: new Date('2022-01-01'),
    courtChallenges: true,
    notes: 'Federal court ordered redraw for VRA violation',
  }],
  ['LA', {
    state: 'Louisiana',
    stateCode: 'LA',
    finalizedDate: new Date('2022-03-30'),
    effectiveDate: new Date('2022-03-30'),
    courtChallenges: true,
  }],
]);

/**
 * Redistricting Gap Detector
 *
 * Identifies when we're in the redistricting gap period where TIGER is guaranteed stale.
 * Only applies to legislative boundaries (congressional, state senate, state house).
 *
 * USAGE:
 *   const detector = new RedistrictingGapDetector();
 *
 *   // Check if we're currently in a gap
 *   const inGap = detector.isInGap();
 *
 *   // Get gap status for specific boundary
 *   const status = detector.checkBoundaryGap('congressional', 'CA');
 *
 *   // Get all states currently in gap
 *   const states = detector.getStatesInGap();
 */
export class RedistrictingGapDetector {
  /**
   * Are we currently in a redistricting gap period?
   *
   * @param asOf - Date to check (defaults to now)
   * @returns True if in gap period
   */
  isInGap(asOf: Date = new Date()): boolean {
    const cycle = this.getCurrentCycle(asOf);
    if (!cycle) {
      return false;
    }

    return asOf >= cycle.gapPeriodStart && asOf < cycle.gapPeriodEnd;
  }

  /**
   * Get the current redistricting cycle info
   *
   * @param asOf - Date to check (defaults to now)
   * @returns Cycle info or null if not in redistricting year
   */
  getCurrentCycle(asOf: Date = new Date()): RedistrictingCycle | null {
    const year = asOf.getFullYear();

    // Check each cycle to see if we're in a redistricting year
    for (const [cycleYear, cycle] of Array.from(REDISTRICTING_CYCLES)) {
      if (cycle.redistrictingYears.includes(year)) {
        return cycle;
      }
    }

    return null;
  }

  /**
   * Check gap status for a specific boundary and jurisdiction
   *
   * ALGORITHM:
   * 1. Check if VTD (voting_precinct) - use VTD-specific gap logic
   * 2. Check if legislative boundary - use redistricting gap logic
   * 3. Other boundaries: no gap issues
   *
   * @param boundaryType - Type of boundary to check
   * @param jurisdiction - State code (e.g., "CA", "TX")
   * @param asOf - Date to check (defaults to now)
   * @returns Gap status with recommendation
   */
  checkBoundaryGap(
    boundaryType: GapBoundaryType,
    jurisdiction: string,
    asOf: Date = new Date()
  ): GapStatus {
    // Step 1: Check if VTD - use VTD-specific gap logic
    if (VTD_BOUNDARY_TYPES.has(boundaryType)) {
      return this.checkVTDGap(jurisdiction, asOf);
    }

    // Step 2: Only legislative boundaries are affected by redistricting gaps
    if (!REDISTRICTING_BOUNDARY_TYPES.has(boundaryType)) {
      return {
        inGap: false,
        gapType: 'none',
        recommendation: 'use-tiger',
        reasoning: `${boundaryType} is not affected by redistricting gaps. TIGER is authoritative.`,
      };
    }

    // Step 2: Are we in a redistricting year?
    const cycle = this.getCurrentCycle(asOf);
    if (!cycle) {
      return {
        inGap: false,
        gapType: 'none',
        recommendation: 'use-tiger',
        reasoning: `Not a redistricting year. TIGER is authoritative.`,
      };
    }

    // Step 3: Get finalization info for this state
    const finalization = this.getFinalizationDates(cycle.cycleYear).get(jurisdiction);

    if (!finalization) {
      // No finalization date known
      return {
        inGap: false,
        gapType: 'pre-finalization',
        recommendation: 'use-tiger',
        reasoning: `${jurisdiction} has not yet finalized redistricting. TIGER shows current valid districts.`,
      };
    }

    // Step 4: Determine gap status based on timeline
    if (asOf < finalization.effectiveDate) {
      // Before effective date - old maps still valid
      return {
        inGap: false,
        gapType: 'pre-finalization',
        recommendation: 'use-tiger',
        reasoning: `${jurisdiction} has finalized new maps but they are not yet effective. TIGER shows current valid districts.`,
        finalizationInfo: finalization,
      };
    }

    if (asOf >= finalization.effectiveDate && asOf < cycle.gapPeriodEnd) {
      // In gap: new maps are effective but TIGER hasn't updated
      const gapDays = Math.floor(
        (asOf.getTime() - finalization.effectiveDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      return {
        inGap: true,
        gapType: 'post-finalization-pre-tiger',
        recommendation: 'use-primary',
        reasoning: `${jurisdiction} finalized redistricting on ${this.formatDate(finalization.finalizedDate)}, effective ${this.formatDate(finalization.effectiveDate)}, but TIGER won't update until ${this.formatDate(cycle.tigerExpectedRelease)}. TIGER is ${gapDays} days stale. Use primary source from ${jurisdiction} redistricting authority.`,
        finalizationInfo: finalization,
      };
    }

    if (asOf >= cycle.gapPeriodEnd) {
      // Post-TIGER update - TIGER should have new maps
      return {
        inGap: false,
        gapType: 'post-tiger',
        recommendation: 'use-tiger',
        reasoning: `TIGER updated ${this.formatDate(cycle.tigerExpectedRelease)} with ${jurisdiction} redistricting. TIGER is current.`,
        finalizationInfo: finalization,
      };
    }

    // Fallback (should not reach here)
    return {
      inGap: false,
      gapType: 'none',
      recommendation: 'manual-review',
      reasoning: 'Unable to determine gap status. Manual review required.',
      finalizationInfo: finalization,
    };
  }

  /**
   * Get all states that have finalized but TIGER hasn't updated
   *
   * Returns states sorted by gap duration (longest gap first).
   * These are the states where we MUST use primary sources.
   *
   * @param asOf - Date to check (defaults to now)
   * @returns Array of states in gap, sorted by gap duration
   */
  getStatesInGap(asOf: Date = new Date()): StateGapInfo[] {
    const cycle = this.getCurrentCycle(asOf);
    if (!cycle) {
      return [];
    }

    const finalizations = this.getFinalizationDates(cycle.cycleYear);
    const statesInGap: StateGapInfo[] = [];

    for (const [code, info] of Array.from(finalizations)) {
      // Check if state is in gap (effective but pre-TIGER)
      if (asOf >= info.effectiveDate && asOf < cycle.gapPeriodEnd) {
        const gapDays = Math.floor(
          (asOf.getTime() - info.effectiveDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        statesInGap.push({
          state: info.state,
          stateCode: code,
          finalizedAt: info.finalizedDate,
          effectiveAt: info.effectiveDate,
          gapDays,
          recommendation: `Use ${info.state} primary source. TIGER is ${gapDays} days stale.`,
        });
      }
    }

    // Sort by gap duration (longest first)
    return statesInGap.sort((a, b) => b.gapDays - a.gapDays);
  }

  /**
   * Get known finalization dates for a redistricting cycle
   *
   * @param cycle - Census year (2020, 2030, 2040)
   * @returns Map of state code to finalization info
   */
  getFinalizationDates(cycle: number): Map<string, StateFinalization> {
    if (cycle === 2020) {
      return FINALIZATIONS_2020;
    }

    // Future cycles: return empty map (will be populated as redistricting occurs)
    return new Map();
  }

  /**
   * Check VTD-specific gap status
   *
   * VTD GAP PATTERNS (different from legislative districts):
   * - Post-election: Q1 (January-March) after November elections
   *   - Counties consolidate precincts based on turnout
   *   - New VTD data typically available by March
   * - Post-redistricting: Years following redistricting (2022, 2032, 2042)
   *   - VTD boundaries may change to align with new legislative districts
   * - No TIGER source: VTDs not included in Census TIGER
   *   - Must use RDH (Redistricting Data Hub) or state sources
   *
   * @param jurisdiction - State code (e.g., "CA", "TX")
   * @param asOf - Date to check
   * @returns Gap status with recommendation
   */
  private checkVTDGap(jurisdiction: string, asOf: Date): GapStatus {
    const month = asOf.getMonth() + 1; // 1-based month
    const year = asOf.getFullYear();

    // Q1 post-election window (January-March)
    if (month >= 1 && month <= 3) {
      return {
        inGap: true,
        gapType: 'post-finalization-pre-tiger',
        recommendation: 'use-primary',
        reasoning: `Post-election precinct consolidation period (Q1). VTD data for ${jurisdiction} may be stale. Check Redistricting Data Hub (https://redistrictingdatahub.org/) or ${jurisdiction} state election office for latest VTD boundaries.`,
      };
    }

    // Post-redistricting years (2022, 2032, 2042)
    const postRedistrictingYears = [2022, 2032, 2042];
    if (postRedistrictingYears.includes(year)) {
      return {
        inGap: true,
        gapType: 'post-finalization-pre-tiger',
        recommendation: 'use-primary',
        reasoning: `Post-redistricting year ${year}. VTD boundaries for ${jurisdiction} may have changed to align with new legislative districts. Use Redistricting Data Hub or ${jurisdiction} state source for current VTD data.`,
      };
    }

    // Outside gap periods - existing VTD data is current
    return {
      inGap: false,
      gapType: 'none',
      recommendation: 'use-primary',
      reasoning: `VTD data for ${jurisdiction} is current. Use Redistricting Data Hub (primary source) or cached VTD data. Note: VTDs are not available in Census TIGER.`,
    };
  }

  /**
   * Format date for display
   *
   * @param date - Date to format
   * @returns ISO date string (YYYY-MM-DD)
   */
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}

/**
 * Default instance for convenience
 */
export const gapDetector = new RedistrictingGapDetector();

/**
 * Export types for external use
 */
export type {
  RedistrictingCycle,
  StateFinalization,
  GapStatus,
  StateGapInfo,
};
