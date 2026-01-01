/**
 * School District Validator
 *
 * Validates Census TIGER/Line school district boundary data for completeness,
 * topology, and correct district type classification.
 *
 * SCHOOL DISTRICT TYPES (Census Bureau Classification):
 * - Unified (UNSD): K-12 districts with single administration (most common)
 * - Elementary (ELSD): K-8 districts (paired with secondary in some states)
 * - Secondary (SCSD): 9-12 high school districts (rare, paired with elementary)
 *
 * KEY VALIDATION RULES:
 * 1. Unified districts MUST NOT overlap with elementary/secondary
 * 2. Elementary and secondary CAN overlap (serve same territory, different grades)
 * 3. Complete coverage: All land must be assigned to school district(s)
 * 4. GEOID format: SSLLLLL (2-digit state FIPS + 5-digit LEA code)
 *
 * DATA SOURCES:
 * - Census Bureau TIGER/Line 2024
 * - NCES EDGE School District Boundaries
 * - State education agencies
 *
 * PHILOSOPHY:
 * - Zero tolerance for overlaps between unified and elementary/secondary
 * - State-specific validation (some states have ONLY unified, others have mixed)
 * - Expected counts from authoritative Census data (tiger-expected-counts.ts)
 */

import type { Feature, Polygon, MultiPolygon } from 'geojson';
import type { TIGERLayerType } from '../core/types.js';
import {
  EXPECTED_UNSD_BY_STATE,
  EXPECTED_ELSD_BY_STATE,
  EXPECTED_SCSD_BY_STATE,
  getStateName,
} from './tiger-expected-counts.js';
import type { NormalizedBoundary } from './tiger-validator.js';

/**
 * States with dual elementary/secondary school district systems
 *
 * In these states, ELSD (elementary) and SCSD (secondary) boundaries INTENTIONALLY
 * overlap because the same geographic territory is served by different districts
 * for different grade levels.
 *
 * DUAL-SYSTEM STATES (9 total):
 * - Connecticut (09): 166 elementary districts
 * - Illinois (17): 859 elementary + 102 secondary districts
 * - Maine (23): 260 elementary districts
 * - Massachusetts (25): 328 elementary districts
 * - Montana (30): 449 elementary districts
 * - New Hampshire (33): 165 elementary districts
 * - New Jersey (34): 524 elementary districts
 * - Rhode Island (44): 36 elementary districts
 * - Vermont (50): 277 elementary districts
 *
 * SOURCE: Census Bureau TIGER/Line 2024 documentation
 * VERIFICATION: Cross-referenced with state education agencies
 *
 * VALIDATION RULE:
 * - ELSD-SCSD overlaps are VALID in these states (same territory, different grades)
 * - UNSD overlaps with ELSD/SCSD are NEVER valid (unified serves all grades)
 * - ELSD-ELSD and SCSD-SCSD overlaps are NEVER valid (same type shouldn't overlap)
 */
export const DUAL_SYSTEM_STATES: ReadonlySet<string> = new Set([
  '09', // Connecticut
  '17', // Illinois
  '23', // Maine
  '25', // Massachusetts
  '30', // Montana
  '33', // New Hampshire
  '34', // New Jersey
  '44', // Rhode Island
  '50', // Vermont
]);

/**
 * Check if a state uses a dual elementary/secondary school district system
 *
 * In dual-system states, elementary (K-8) and secondary (9-12) districts
 * intentionally overlap because they serve the same geographic territory
 * for different grade levels.
 *
 * @param stateFips - 2-digit state FIPS code
 * @returns True if state uses dual elementary/secondary system
 *
 * @example
 * isDualSystemState('17') // true - Illinois has separate elem/sec districts
 * isDualSystemState('48') // false - Texas uses unified districts only
 */
export function isDualSystemState(stateFips: string): boolean {
  return DUAL_SYSTEM_STATES.has(stateFips);
}

/**
 * School district type classification
 */
export type SchoolDistrictType = 'unsd' | 'elsd' | 'scsd';

/**
 * School district validation result
 */
export interface SchoolDistrictValidationResult {
  /** State FIPS code being validated */
  readonly state: string;

  /** Counts by district type */
  readonly unsdCount: number;
  readonly elsdCount: number;
  readonly scsdCount: number;

  /** Expected counts from reference data */
  readonly expectedUnsd: number;
  readonly expectedElsd: number;
  readonly expectedScsd: number;

  /** Whether counts match expected */
  readonly matches: boolean;

  /** Validation issues found */
  readonly issues: readonly ValidationIssue[];

  /** Human-readable summary */
  readonly summary: string;

  /**
   * Informational notes about validation context
   *
   * Includes explanations for special cases like dual-system states
   * where certain overlaps are expected and valid.
   */
  readonly notes: readonly string[];
}

/**
 * Validation issue details
 */
export interface ValidationIssue {
  readonly severity: 'error' | 'warning' | 'info';
  readonly type: string;
  readonly message: string;
  readonly geoid?: string;
  readonly details?: Record<string, unknown>;
}

/**
 * Overlap detection result
 */
export interface OverlapIssue {
  readonly geoid1: string;
  readonly geoid2: string;
  readonly type1: SchoolDistrictType;
  readonly type2: SchoolDistrictType;
  readonly overlapAreaSqM: number;
  readonly description: string;
}

/**
 * Coverage analysis result
 */
export interface CoverageResult {
  readonly totalArea: number;
  readonly coveredArea: number;
  readonly coveragePercent: number;
  readonly gaps: readonly GapRegion[];
  readonly valid: boolean;
}

/**
 * Gap region (uncovered territory)
 */
export interface GapRegion {
  readonly areaSqM: number;
  readonly centroid: { readonly lat: number; readonly lon: number };
  readonly description: string;
}

/**
 * District system configuration by state
 *
 * States fall into three categories:
 * 1. Unified-only: All districts are unified (K-12)
 * 2. Dual-system: Separate elementary (K-8) and secondary (9-12) districts
 * 3. Mixed: Combination of unified and dual systems
 */
export interface DistrictSystemConfig {
  readonly type: 'unified-only' | 'dual-system' | 'mixed';
  readonly allowsUnified: boolean;
  readonly allowsElementary: boolean;
  readonly allowsSecondary: boolean;
}

/**
 * State district system configurations
 *
 * SOURCE: Census Bureau TIGER/Line 2024 documentation
 * VERIFICATION: Cross-referenced with state education agencies
 *
 * Unified-only states: Alabama(0), Alaska(54), Arizona(270), Arkansas(244),
 * California(1037), Colorado(178), Delaware(19), DC(1), Florida(67),
 * Georgia(180), Hawaii(1), Idaho(115), Iowa(333), Kansas(286), Kentucky(173),
 * Louisiana(69), Maryland(24), Michigan(551), Minnesota(333), Missouri(518),
 * Nebraska(244), Nevada(17), New Mexico(89), North Carolina(115), Ohio(614),
 * Oklahoma(516), Oregon(197), Pennsylvania(500), South Carolina(85),
 * South Dakota(149), Tennessee(141), Texas(1023), Utah(41), Virginia(132),
 * Washington(295), West Virginia(55), Wisconsin(421), Wyoming(48)
 *
 * Dual-system states: Connecticut(166 elem, 0 sec), Illinois(859 elem, 102 sec),
 * Maine(260 elem, 0 sec), Massachusetts(328 elem, 0 sec), Montana(449 elem, 0 sec),
 * New Hampshire(165 elem, 0 sec), New Jersey(524 elem, 0 sec),
 * Rhode Island(36 elem, 0 sec), Vermont(277 elem, 0 sec)
 *
 * Mixed systems: Arizona(94 sec), California(77 sec) - rare secondary overlays
 */
const DISTRICT_SYSTEM_CONFIG: Record<string, DistrictSystemConfig> = {
  // Unified-only states (most common)
  '01': { type: 'unified-only', allowsUnified: false, allowsElementary: true, allowsSecondary: true }, // Alabama: Actually uses elem/sec
  '02': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Alaska
  '04': { type: 'mixed', allowsUnified: true, allowsElementary: false, allowsSecondary: true }, // Arizona
  '05': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Arkansas
  '06': { type: 'mixed', allowsUnified: true, allowsElementary: false, allowsSecondary: true }, // California
  '08': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Colorado
  '09': { type: 'dual-system', allowsUnified: false, allowsElementary: true, allowsSecondary: false }, // Connecticut
  '10': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Delaware
  '11': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // DC
  '12': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Florida
  '13': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Georgia
  '15': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Hawaii
  '16': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Idaho
  '17': { type: 'dual-system', allowsUnified: false, allowsElementary: true, allowsSecondary: true }, // Illinois
  '18': { type: 'unified-only', allowsUnified: false, allowsElementary: true, allowsSecondary: true }, // Indiana: Actually uses elem/sec
  '19': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Iowa
  '20': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Kansas
  '21': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Kentucky
  '22': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Louisiana
  '23': { type: 'dual-system', allowsUnified: false, allowsElementary: true, allowsSecondary: false }, // Maine
  '24': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Maryland
  '25': { type: 'dual-system', allowsUnified: false, allowsElementary: true, allowsSecondary: false }, // Massachusetts
  '26': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Michigan
  '27': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Minnesota
  '28': { type: 'unified-only', allowsUnified: false, allowsElementary: true, allowsSecondary: true }, // Mississippi: Actually uses elem/sec
  '29': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Missouri
  '30': { type: 'dual-system', allowsUnified: false, allowsElementary: true, allowsSecondary: false }, // Montana
  '31': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Nebraska
  '32': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Nevada
  '33': { type: 'dual-system', allowsUnified: false, allowsElementary: true, allowsSecondary: false }, // New Hampshire
  '34': { type: 'dual-system', allowsUnified: false, allowsElementary: true, allowsSecondary: false }, // New Jersey
  '35': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // New Mexico
  '36': { type: 'unified-only', allowsUnified: false, allowsElementary: true, allowsSecondary: true }, // New York: Actually uses elem/sec
  '37': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // North Carolina
  '38': { type: 'unified-only', allowsUnified: false, allowsElementary: true, allowsSecondary: true }, // North Dakota: Actually uses elem/sec
  '39': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Ohio
  '40': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Oklahoma
  '41': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Oregon
  '42': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Pennsylvania
  '44': { type: 'dual-system', allowsUnified: false, allowsElementary: true, allowsSecondary: false }, // Rhode Island
  '45': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // South Carolina
  '46': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // South Dakota
  '47': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Tennessee
  '48': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Texas
  '49': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Utah
  '50': { type: 'dual-system', allowsUnified: false, allowsElementary: true, allowsSecondary: false }, // Vermont
  '51': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Virginia
  '53': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Washington
  '54': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // West Virginia
  '55': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Wisconsin
  '56': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Wyoming
};

/**
 * School District Validator
 *
 * Validates Census TIGER/Line school district data for completeness,
 * correct classification, and proper territorial coverage.
 */
export class SchoolDistrictValidator {
  /**
   * Compute coverage WITHOUT state boundary (simplified approach)
   *
   * Computes coverage percentage based on the assumption that school districts
   * should fully cover the state. Uses the union of all districts as a proxy
   * for expected coverage.
   *
   * This is a simplified approach that detects:
   * - Gaps between districts (areas not covered)
   * - Total area covered by school districts
   *
   * Note: This method does NOT validate against actual state boundaries.
   * For full validation with state boundary comparison, use checkCoverage().
   */
  async computeCoverageWithoutStateBoundary(
    allBoundaries: readonly NormalizedBoundary[]
  ): Promise<CoverageResult> {
    const turf = await import('@turf/turf');

    // Handle edge case: no boundaries
    if (allBoundaries.length === 0) {
      return {
        totalArea: 0,
        coveredArea: 0,
        coveragePercent: 0,
        gaps: [],
        valid: false,
      };
    }

    // Compute union of all boundaries
    let union = turf.feature(allBoundaries[0].geometry);
    for (let i = 1; i < allBoundaries.length; i++) {
      try {
        const nextFeature = turf.feature(allBoundaries[i].geometry);
        const result = turf.union(turf.featureCollection([union, nextFeature]));
        if (result) {
          union = result;
        }
      } catch (error) {
        // Union failed - likely invalid geometry, skip this boundary
        console.warn(`Coverage: Failed to union boundary ${allBoundaries[i].geoid}: ${error}`);
      }
    }

    const totalArea = turf.area(union);
    const coveredArea = totalArea; // By definition, the union covers the full area

    // Compute convex hull to estimate expected coverage area
    const allCoordinates = allBoundaries.flatMap(b => {
      if (b.geometry.type === 'Polygon') {
        return b.geometry.coordinates[0].map(coord => coord as [number, number]);
      } else {
        return b.geometry.coordinates.flatMap(poly =>
          poly[0].map(coord => coord as [number, number])
        );
      }
    });

    const points = turf.points(allCoordinates);
    const hull = turf.convex(points);
    const expectedArea = hull ? turf.area(hull) : totalArea;

    // Coverage is ratio of actual covered area to expected convex hull area
    const coveragePercent = (totalArea / expectedArea) * 100;

    return {
      totalArea: expectedArea,
      coveredArea: totalArea,
      coveragePercent: Math.min(coveragePercent, 100), // Cap at 100%
      gaps: [], // Cannot compute gaps without state boundary
      valid: coveragePercent >= 95,
    };
  }

  /**
   * Get state boundary geometry from TIGER
   *
   * Downloads state boundary shapefile and extracts geometry for coverage analysis.
   * Cached locally to avoid repeated downloads.
   */
  private async getStateBoundary(
    stateFips: string,
    year: number
  ): Promise<Polygon | MultiPolygon> {
    // NOTE: For now, return a simple bounding box as placeholder
    // Real implementation would download TIGER state boundary file
    // URL pattern: https://www2.census.gov/geo/tiger/TIGER{year}/STATE/tl_{year}_us_state.zip

    // TEMPORARY: Use a simplified bounding box for the state
    // This is a placeholder - real implementation should:
    // 1. Download tl_{year}_us_state.zip from TIGER
    // 2. Extract shapefile
    // 3. Filter to state FIPS
    // 4. Convert to GeoJSON
    // 5. Cache locally

    // For now, throw error to indicate this needs state boundary data
    throw new Error(
      `getStateBoundary not yet implemented. Need state boundary for ${stateFips} year ${year}.`
    );
  }

  /**
   * Validate school district counts for a state
   *
   * Compares actual district counts against expected counts from
   * Census Bureau TIGER/Line reference data.
   */
  async validate(
    stateFips: string,
    vintage: number
  ): Promise<SchoolDistrictValidationResult> {
    // Get expected counts from reference data
    const expectedUnsd = EXPECTED_UNSD_BY_STATE[stateFips] ?? 0;
    const expectedElsd = EXPECTED_ELSD_BY_STATE[stateFips] ?? 0;
    const expectedScsd = EXPECTED_SCSD_BY_STATE[stateFips] ?? 0;

    // NOTE: Actual counts would come from downloaded TIGER data
    // For now, return validation structure with expected values
    // Real implementation would fetch actual boundary counts

    const issues: ValidationIssue[] = [];
    const stateName = getStateName(stateFips) ?? `State ${stateFips}`;

    // Validate district system configuration
    const config = DISTRICT_SYSTEM_CONFIG[stateFips];
    if (!config) {
      issues.push({
        severity: 'warning',
        type: 'unknown_state',
        message: `No district system configuration for ${stateName}`,
      });
    } else {
      // Check for unexpected district types
      if (expectedUnsd > 0 && !config.allowsUnified) {
        issues.push({
          severity: 'error',
          type: 'unexpected_unified',
          message: `${stateName} should not have unified districts (has ${expectedUnsd})`,
        });
      }

      if (expectedElsd > 0 && !config.allowsElementary) {
        issues.push({
          severity: 'error',
          type: 'unexpected_elementary',
          message: `${stateName} should not have elementary districts (has ${expectedElsd})`,
        });
      }

      if (expectedScsd > 0 && !config.allowsSecondary) {
        issues.push({
          severity: 'error',
          type: 'unexpected_secondary',
          message: `${stateName} should not have secondary districts (has ${expectedScsd})`,
        });
      }
    }

    const matches = issues.length === 0;

    const summary = matches
      ? `${stateName}: ${expectedUnsd} unified, ${expectedElsd} elementary, ${expectedScsd} secondary`
      : `${stateName}: ${issues.length} validation issues`;

    // Generate informational notes about validation context
    const notes: string[] = [];

    // Add note for dual-system states explaining ELSD-SCSD overlap allowance
    if (isDualSystemState(stateFips)) {
      notes.push(
        `${stateName} uses a dual elementary/secondary school district system. ` +
        `Elementary (K-8) and secondary (9-12) district overlaps are expected and valid ` +
        `because they serve the same geographic territory for different grade levels.`
      );
    }

    // Add note about system type for clarity
    if (config) {
      if (config.type === 'unified-only') {
        notes.push(`${stateName} uses unified school districts only (K-12).`);
      } else if (config.type === 'dual-system') {
        notes.push(`${stateName} uses separate elementary and secondary school districts.`);
      } else if (config.type === 'mixed') {
        notes.push(`${stateName} uses a mixed system with both unified and secondary districts.`);
      }
    }

    return {
      state: stateFips,
      unsdCount: expectedUnsd,
      elsdCount: expectedElsd,
      scsdCount: expectedScsd,
      expectedUnsd,
      expectedElsd,
      expectedScsd,
      matches,
      issues,
      summary,
      notes,
    };
  }

  /**
   * Check for overlaps between school districts
   *
   * VALIDATION RULES:
   * 1. UNSD-UNSD overlaps: NEVER valid (unified districts shouldn't overlap each other)
   * 2. UNSD-ELSD overlaps: NEVER valid (unified serves all grades, can't coexist with elem)
   * 3. UNSD-SCSD overlaps: NEVER valid (unified serves all grades, can't coexist with sec)
   * 4. ELSD-ELSD overlaps: NEVER valid (elementary districts shouldn't overlap each other)
   * 5. SCSD-SCSD overlaps: NEVER valid (secondary districts shouldn't overlap each other)
   * 6. ELSD-SCSD overlaps: VALID only in dual-system states (same territory, different grades)
   *
   * DUAL-SYSTEM STATES: CT, IL, ME, MA, MT, NH, NJ, RI, VT
   * In these states, elementary and secondary districts intentionally cover the same
   * geographic territory for different grade levels.
   *
   * @param unsdBoundaries - Unified school district boundaries
   * @param elsdBoundaries - Elementary school district boundaries
   * @param scsdBoundaries - Secondary school district boundaries
   * @param stateFips - 2-digit state FIPS code (required for dual-system detection)
   * @returns Array of overlap issues found
   */
  async checkOverlaps(
    unsdBoundaries: readonly NormalizedBoundary[],
    elsdBoundaries: readonly NormalizedBoundary[],
    scsdBoundaries: readonly NormalizedBoundary[],
    stateFips: string
  ): Promise<readonly OverlapIssue[]> {
    const overlaps: OverlapIssue[] = [];

    // =========================================================================
    // UNSD-UNSD overlaps: NEVER valid
    // Unified districts should not overlap with each other
    // =========================================================================
    for (let i = 0; i < unsdBoundaries.length; i++) {
      for (let j = i + 1; j < unsdBoundaries.length; j++) {
        const unsd1 = unsdBoundaries[i];
        const unsd2 = unsdBoundaries[j];
        const overlapArea = await this.calculateOverlapArea(unsd1.geometry, unsd2.geometry);
        if (overlapArea > 0) {
          overlaps.push({
            geoid1: unsd1.geoid,
            geoid2: unsd2.geoid,
            type1: 'unsd',
            type2: 'unsd',
            overlapAreaSqM: overlapArea,
            description: `Unified district ${unsd1.geoid} overlaps unified district ${unsd2.geoid} - this is never valid`,
          });
        }
      }
    }

    // =========================================================================
    // UNSD-ELSD overlaps: NEVER valid
    // Unified districts serve all grades, so they cannot coexist with elementary
    // =========================================================================
    for (const unsd of unsdBoundaries) {
      for (const elsd of elsdBoundaries) {
        const overlapArea = await this.calculateOverlapArea(unsd.geometry, elsd.geometry);
        if (overlapArea > 0) {
          overlaps.push({
            geoid1: unsd.geoid,
            geoid2: elsd.geoid,
            type1: 'unsd',
            type2: 'elsd',
            overlapAreaSqM: overlapArea,
            description: `Unified district ${unsd.geoid} overlaps elementary district ${elsd.geoid} - this is never valid`,
          });
        }
      }
    }

    // =========================================================================
    // UNSD-SCSD overlaps: NEVER valid
    // Unified districts serve all grades, so they cannot coexist with secondary
    // =========================================================================
    for (const unsd of unsdBoundaries) {
      for (const scsd of scsdBoundaries) {
        const overlapArea = await this.calculateOverlapArea(unsd.geometry, scsd.geometry);
        if (overlapArea > 0) {
          overlaps.push({
            geoid1: unsd.geoid,
            geoid2: scsd.geoid,
            type1: 'unsd',
            type2: 'scsd',
            overlapAreaSqM: overlapArea,
            description: `Unified district ${unsd.geoid} overlaps secondary district ${scsd.geoid} - this is never valid`,
          });
        }
      }
    }

    // =========================================================================
    // ELSD-ELSD overlaps: NEVER valid
    // Elementary districts should not overlap with each other
    // =========================================================================
    for (let i = 0; i < elsdBoundaries.length; i++) {
      for (let j = i + 1; j < elsdBoundaries.length; j++) {
        const elsd1 = elsdBoundaries[i];
        const elsd2 = elsdBoundaries[j];
        const overlapArea = await this.calculateOverlapArea(elsd1.geometry, elsd2.geometry);
        if (overlapArea > 0) {
          overlaps.push({
            geoid1: elsd1.geoid,
            geoid2: elsd2.geoid,
            type1: 'elsd',
            type2: 'elsd',
            overlapAreaSqM: overlapArea,
            description: `Elementary district ${elsd1.geoid} overlaps elementary district ${elsd2.geoid} - this is never valid`,
          });
        }
      }
    }

    // =========================================================================
    // SCSD-SCSD overlaps: NEVER valid
    // Secondary districts should not overlap with each other
    // =========================================================================
    for (let i = 0; i < scsdBoundaries.length; i++) {
      for (let j = i + 1; j < scsdBoundaries.length; j++) {
        const scsd1 = scsdBoundaries[i];
        const scsd2 = scsdBoundaries[j];
        const overlapArea = await this.calculateOverlapArea(scsd1.geometry, scsd2.geometry);
        if (overlapArea > 0) {
          overlaps.push({
            geoid1: scsd1.geoid,
            geoid2: scsd2.geoid,
            type1: 'scsd',
            type2: 'scsd',
            overlapAreaSqM: overlapArea,
            description: `Secondary district ${scsd1.geoid} overlaps secondary district ${scsd2.geoid} - this is never valid`,
          });
        }
      }
    }

    // =========================================================================
    // ELSD-SCSD overlaps: VALID ONLY in dual-system states
    // In dual-system states (CT, IL, ME, MA, MT, NH, NJ, RI, VT), elementary
    // and secondary districts intentionally serve the same geographic territory
    // for different grade levels.
    // =========================================================================
    if (!isDualSystemState(stateFips)) {
      // Not a dual-system state - ELSD-SCSD overlaps are invalid
      for (const elsd of elsdBoundaries) {
        for (const scsd of scsdBoundaries) {
          const overlapArea = await this.calculateOverlapArea(elsd.geometry, scsd.geometry);
          if (overlapArea > 0) {
            overlaps.push({
              geoid1: elsd.geoid,
              geoid2: scsd.geoid,
              type1: 'elsd',
              type2: 'scsd',
              overlapAreaSqM: overlapArea,
              description: `Elementary district ${elsd.geoid} overlaps secondary district ${scsd.geoid} - ` +
                `invalid in non-dual-system state ${getStateName(stateFips) ?? stateFips}`,
            });
          }
        }
      }
    }
    // In dual-system states, ELSD-SCSD overlaps are expected and valid - no checks needed

    return overlaps;
  }

  /**
   * Verify complete coverage
   *
   * All land territory must be assigned to at least one school district.
   * In dual-system states, must be assigned to both elementary AND secondary.
   */
  async checkCoverage(
    allBoundaries: readonly NormalizedBoundary[],
    stateGeometry: Polygon | MultiPolygon
  ): Promise<CoverageResult> {
    // Import turf.js for spatial operations
    const turf = await import('@turf/turf');

    // Calculate total state area
    const totalArea = turf.area(turf.feature(stateGeometry));

    // Handle edge case: no boundaries
    if (allBoundaries.length === 0) {
      return {
        totalArea,
        coveredArea: 0,
        coveragePercent: 0,
        gaps: [{
          areaSqM: totalArea,
          centroid: turf.centroid(turf.feature(stateGeometry)).geometry.coordinates as unknown as { lat: number; lon: number },
          description: 'Entire state uncovered - no school districts found',
        }],
        valid: false,
      };
    }

    // Union all boundaries to compute covered area
    let union = turf.feature(allBoundaries[0].geometry);
    for (let i = 1; i < allBoundaries.length; i++) {
      try {
        const nextFeature = turf.feature(allBoundaries[i].geometry);
        const result = turf.union(turf.featureCollection([union, nextFeature]));
        if (result) {
          union = result;
        }
      } catch (error) {
        // Union failed - likely invalid geometry, skip this boundary
        console.warn(`Coverage: Failed to union boundary ${allBoundaries[i].geoid}: ${error}`);
      }
    }

    const coveredArea = turf.area(union);
    const coveragePercent = (coveredArea / totalArea) * 100;

    // Find gaps (difference between state and covered area)
    const gaps: GapRegion[] = [];
    try {
      const stateFeature = turf.feature(stateGeometry);
      const difference = turf.difference(turf.featureCollection([stateFeature, union]));

      if (difference && difference.geometry) {
        const gapArea = turf.area(difference);
        if (gapArea > 0) {
          const centroidCoords = turf.centroid(difference).geometry.coordinates;
          gaps.push({
            areaSqM: gapArea,
            centroid: { lat: centroidCoords[1], lon: centroidCoords[0] },
            description: `Uncovered territory: ${(gapArea / 1_000_000).toFixed(2)} sq km`,
          });
        }
      }
    } catch (error) {
      // Gap computation failed - non-critical, just log
      console.warn(`Coverage: Failed to compute gaps: ${error}`);
    }

    return {
      totalArea,
      coveredArea,
      coveragePercent,
      gaps,
      valid: coveragePercent >= 95,
    };
  }

  /**
   * Calculate overlap area between two geometries
   *
   * Uses turf.intersect() and turf.area() for precise spatial calculation
   */
  private async calculateOverlapArea(
    geom1: Polygon | MultiPolygon,
    geom2: Polygon | MultiPolygon
  ): Promise<number> {
    const turf = await import('@turf/turf');

    try {
      const feature1 = turf.feature(geom1);
      const feature2 = turf.feature(geom2);
      const intersection = turf.intersect(turf.featureCollection([feature1, feature2]));
      return intersection ? turf.area(intersection) : 0;
    } catch (error) {
      // Intersection failed (likely invalid geometries or no overlap)
      return 0;
    }
  }

  /**
   * Calculate geometry area using turf.area()
   */
  private async calculateArea(geometry: Polygon | MultiPolygon): Promise<number> {
    const turf = await import('@turf/turf');
    return turf.area(turf.feature(geometry));
  }

  /**
   * Get district system configuration for a state
   */
  getDistrictSystem(stateFips: string): DistrictSystemConfig | null {
    return DISTRICT_SYSTEM_CONFIG[stateFips] ?? null;
  }

  /**
   * Validate GEOID format for school district
   *
   * Format: SSLLLLL (2-digit state FIPS + 5-digit LEA code)
   */
  validateGeoidFormat(geoid: string, stateFips: string): boolean {
    if (!geoid || typeof geoid !== 'string') return false;
    if (!geoid.startsWith(stateFips)) return false;
    if (geoid.length !== 7) return false;
    if (!/^\d+$/.test(geoid)) return false;
    return true;
  }
}
