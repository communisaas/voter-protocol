/**
 * Canonical GEOID Reference Lists
 *
 * Authoritative GEOID lists for TIGER/Line boundary validation.
 * Enables detection of specific missing boundaries (e.g., "Alabama CD-07 missing")
 * rather than just count mismatches (e.g., "6/7 districts found").
 *
 * DATA SOURCE: Census Bureau TIGER/Line 2024 shapefiles
 * GEOID FORMAT SPECIFICATIONS:
 * - Congressional Districts (CD): 4 digits SSDD (State FIPS + District number)
 * - State Legislative Upper (SLDU): 5 digits SSDDD (State FIPS + District)
 * - State Legislative Lower (SLDL): 5 digits SSDDD (State FIPS + District)
 * - County: 5 digits SSCCC (State FIPS + County FIPS)
 *
 * MAINTENANCE:
 * - Congressional Districts: Update after each decennial census redistricting
 * - State Legislative: Update when states redistrict (varies by state)
 * - Counties: Rare changes (last: Broomfield County, CO added 2001)
 *
 * Last Updated: 2025-12-31
 * Data Vintage: 2024 TIGER/Line (post-2020 Census redistricting)
 */

import type { TIGERLayerType } from '../../core/types.js';
import {
  EXPECTED_CD_BY_STATE,
  EXPECTED_SLDU_BY_STATE,
  EXPECTED_SLDL_BY_STATE,
  EXPECTED_UNSD_BY_STATE,
  EXPECTED_ELSD_BY_STATE,
  EXPECTED_SCSD_BY_STATE,
  EXPECTED_COUNTIES_BY_STATE,
} from '../tiger-expected-counts.js';
import {
  CANONICAL_PLACE_GEOIDS,
  EXPECTED_PLACE_BY_STATE,
} from '../place-geoids.js';
import { logger } from '../../core/utils/logger.js';
import {
  CANONICAL_UNSD_GEOIDS as REAL_CANONICAL_UNSD_GEOIDS,
  CANONICAL_ELSD_GEOIDS as REAL_CANONICAL_ELSD_GEOIDS,
  CANONICAL_SCSD_GEOIDS as REAL_CANONICAL_SCSD_GEOIDS,
} from '../school-district-geoids.js';

// Import canonical GEOID data from JSON (WS-A5: Data extracted to JSON)
import {
  CANONICAL_CD_GEOIDS,
  CANONICAL_SLDU_GEOIDS,
  CANONICAL_SLDL_GEOIDS,
  CANONICAL_COUNTY_GEOIDS,
} from '../../data/loaders/geoid-reference-loader.js';

// Re-export for backward compatibility
export { CANONICAL_CD_GEOIDS, CANONICAL_SLDU_GEOIDS, CANONICAL_SLDL_GEOIDS, CANONICAL_COUNTY_GEOIDS };

/**
 * Canonical Unified School District (UNSD) GEOIDs by State
 *
 * FORMAT: SSGGGGG (State FIPS 2 digits + LEA ID 5 digits)
 * - State FIPS: 2 digits (01-56)
 * - LEA ID: 5 digits (local education agency identifier)
 *
 * UNIFIED SCHOOL DISTRICTS (K-12):
 * - Serve all grade levels from kindergarten through 12th grade
 * - Most common school district type in the US
 * - Unified districts provide both elementary AND secondary education
 * - Do NOT overlap with elementary or secondary districts (mutually exclusive)
 *
 * STATES WITH UNIFIED DISTRICTS:
 * - 41 states use exclusively unified districts
 * - 9 states use mixed systems (unified + elementary + secondary)
 *
 * MIXED SYSTEM STATES:
 * - Arizona (04): 232 unified + 94 secondary districts (elementary covered by unified)
 * - California (06): 1,038 unified + 77 secondary (elementary covered by unified)
 * - Connecticut (09): 17 unified + 166 elementary (most districts are elementary-only)
 * - Illinois (17): 401 unified + 859 elementary + 94 secondary (complex three-tier system)
 * - Maine (23): 98 unified + 260 elementary (mix of both types)
 * - Massachusetts (25): 80 unified + 328 elementary (mostly elementary-only)
 * - Montana (30): 2 unified + 449 elementary + 90 secondary (mostly elementary-secondary split)
 * - New Jersey (34): 549 unified + 524 elementary (mix of both)
 * - Vermont (50): 56 unified + 277 supervisory unions (complex governance)
 *
 * SOURCE: Census TIGER/Line 2024 shapefiles
 * Last Updated: 2026-01-02
 */
// Re-export real UNSD GEOIDs extracted from TIGER 2024 shapefiles
// CRITICAL: These are actual administrative LEA IDs, NOT sequential numbers
export const CANONICAL_UNSD_GEOIDS = REAL_CANONICAL_UNSD_GEOIDS;

/**
 * Canonical Elementary School District (ELSD) GEOIDs by State
 *
 * FORMAT: SSGGGGG (State FIPS 2 digits + LEA ID 5 digits)
 * - State FIPS: 2 digits (01-56)
 * - LEA ID: 5 digits (local education agency identifier)
 *
 * ELEMENTARY SCHOOL DISTRICTS (K-8):
 * - Serve grades K-8 (or K-6 depending on state)
 * - Paired with secondary districts in some states
 * - Elementary and secondary CAN overlap (same territory, different grades)
 *
 * STATES WITH ELEMENTARY DISTRICTS:
 * - Connecticut (09): 166 elementary districts
 * - Illinois (17): 859 elementary districts (largest)
 * - Maine (23): 260 elementary districts
 * - Massachusetts (25): 328 elementary districts
 * - Montana (30): 449 elementary districts
 * - New Hampshire (33): 165 elementary districts
 * - New Jersey (34): 524 elementary districts
 * - Rhode Island (44): 36 elementary districts
 * - Vermont (50): 277 supervisory unions
 *
 * Most states use unified districts only (no separate elementary).
 *
 * SOURCE: Census TIGER/Line 2024 shapefiles
 * Last Updated: 2026-01-02
 */
// Re-export real ELSD GEOIDs extracted from TIGER 2024 shapefiles
// CRITICAL: These are actual administrative LEA IDs, NOT sequential numbers
export const CANONICAL_ELSD_GEOIDS = REAL_CANONICAL_ELSD_GEOIDS;

/**
 * Canonical Secondary School District (SCSD) GEOIDs by State
 *
 * FORMAT: SSGGGGG (State FIPS 2 digits + LEA ID 5 digits)
 * - State FIPS: 2 digits (01-56)
 * - LEA ID: 5 digits (local education agency identifier)
 *
 * SECONDARY SCHOOL DISTRICTS (9-12):
 * - Serve grades 9-12 (high school only)
 * - Rare - only a few states use separate secondary districts
 * - Usually paired with elementary districts
 * - Can overlap with unified districts in some states (Arizona, California)
 *
 * STATES WITH SECONDARY DISTRICTS:
 * - Arizona (04): 94 secondary districts (mixed with unified)
 * - California (06): 77 secondary districts (mixed with unified)
 * - Illinois (17): 94 secondary districts (mixed with unified + elementary)
 * - Montana (30): 90 secondary districts (paired with elementary)
 *
 * SOURCE: Census TIGER/Line 2024 shapefiles
 * Last Updated: 2026-01-02
 */
// Re-export real SCSD GEOIDs extracted from TIGER 2024 shapefiles
// CRITICAL: These are actual administrative LEA IDs, NOT sequential numbers
export const CANONICAL_SCSD_GEOIDS = REAL_CANONICAL_SCSD_GEOIDS;

/**
 * Get canonical GEOID list for a specific layer and state
 *
 * @param layer - TIGER layer type
 * @param stateFips - Two-digit state FIPS code
 * @returns Array of canonical GEOIDs, or null if no canonical list available
 */
export function getCanonicalGEOIDs(
  layer: TIGERLayerType,
  stateFips: string
): readonly string[] | null {
  switch (layer) {
    case 'cd':
      return CANONICAL_CD_GEOIDS[stateFips] ?? null;
    case 'sldu':
      return CANONICAL_SLDU_GEOIDS[stateFips] ?? null;
    case 'sldl':
      return CANONICAL_SLDL_GEOIDS[stateFips] ?? null;
    case 'county':
      return CANONICAL_COUNTY_GEOIDS[stateFips] ?? null;
    case 'unsd':
      return CANONICAL_UNSD_GEOIDS[stateFips] ?? null;
    case 'elsd':
      return CANONICAL_ELSD_GEOIDS[stateFips] ?? null;
    case 'scsd':
      return CANONICAL_SCSD_GEOIDS[stateFips] ?? null;
    case 'place':
      return CANONICAL_PLACE_GEOIDS[stateFips] ?? null;
    case 'vtd':
      // VTD GEOIDs loaded dynamically from per-state JSON files
      // Use loadVTDGEOIDs() from vtd-loader.ts instead
      return null;
    default:
      return null; // Layer not supported yet (cdp, cousub, etc.)
  }
}

/**
 * Find missing GEOIDs (expected but not present in actual data)
 *
 * @param layer - TIGER layer type
 * @param stateFips - Two-digit state FIPS code
 * @param actualGEOIDs - Array of GEOIDs from downloaded TIGER data
 * @returns Array of missing GEOIDs (empty if none missing)
 */
export function getMissingGEOIDs(
  layer: TIGERLayerType,
  stateFips: string,
  actualGEOIDs: readonly string[]
): readonly string[] {
  const canonical = getCanonicalGEOIDs(layer, stateFips);
  if (!canonical) return [];

  const actualSet = new Set(actualGEOIDs);
  return canonical.filter(geoid => !actualSet.has(geoid));
}

/**
 * Find extra GEOIDs (present in data but not expected)
 *
 * Extra GEOIDs may indicate:
 * - Duplicate features in TIGER data
 * - Placeholder districts (ZZ, 00, 98, 99)
 * - Data corruption or processing errors
 *
 * @param layer - TIGER layer type
 * @param stateFips - Two-digit state FIPS code
 * @param actualGEOIDs - Array of GEOIDs from downloaded TIGER data
 * @returns Array of extra GEOIDs (empty if none extra)
 */
export function getExtraGEOIDs(
  layer: TIGERLayerType,
  stateFips: string,
  actualGEOIDs: readonly string[]
): readonly string[] {
  const canonical = getCanonicalGEOIDs(layer, stateFips);
  if (!canonical) return [];

  const canonicalSet = new Set(canonical);
  return actualGEOIDs.filter(geoid => !canonicalSet.has(geoid));
}

/**
 * Validate GEOID list completeness
 *
 * Checks both missing and extra GEOIDs to detect data quality issues.
 *
 * @param layer - TIGER layer type
 * @param stateFips - Two-digit state FIPS code
 * @param actualGEOIDs - Array of GEOIDs from downloaded TIGER data
 * @returns Validation result with missing/extra GEOIDs
 */
export function validateGEOIDCompleteness(
  layer: TIGERLayerType,
  stateFips: string,
  actualGEOIDs: readonly string[]
): {
  readonly valid: boolean;
  readonly missing: readonly string[];
  readonly extra: readonly string[];
  readonly expected: number;
  readonly actual: number;
} {
  const canonical = getCanonicalGEOIDs(layer, stateFips);

  if (!canonical) {
    // No canonical list available, can't validate
    return {
      valid: true,
      missing: [],
      extra: [],
      expected: 0,
      actual: actualGEOIDs.length,
    };
  }

  const missing = getMissingGEOIDs(layer, stateFips, actualGEOIDs);
  const extra = getExtraGEOIDs(layer, stateFips, actualGEOIDs);

  return {
    valid: missing.length === 0 && extra.length === 0,
    missing,
    extra,
    expected: canonical.length,
    actual: actualGEOIDs.length,
  };
}

/**
 * Self-validation: Ensure canonical GEOID counts match expected counts
 *
 * This validation runs at module load time to catch data entry errors
 * in the canonical GEOID lists.
 *
 * @returns Validation result with any discrepancies found
 */
export function validateCanonicalCounts(): {
  readonly valid: boolean;
  readonly errors: readonly string[];
} {
  const errors: string[] = [];

  // Validate Congressional Districts
  for (const [stateFips, geoids] of Object.entries(CANONICAL_CD_GEOIDS)) {
    const expectedCount = EXPECTED_CD_BY_STATE[stateFips];
    if (expectedCount === undefined) {
      errors.push(`CD: Unknown state FIPS ${stateFips} in canonical GEOIDs`);
      continue;
    }

    if (geoids.length !== expectedCount) {
      errors.push(
        `CD: State ${stateFips} has ${geoids.length} canonical GEOIDs but expected ${expectedCount}`
      );
    }
  }

  // Validate State Legislative Upper (when implemented)
  for (const [stateFips, geoids] of Object.entries(CANONICAL_SLDU_GEOIDS)) {
    const expectedCount = EXPECTED_SLDU_BY_STATE[stateFips];
    if (expectedCount === undefined) {
      errors.push(`SLDU: Unknown state FIPS ${stateFips} in canonical GEOIDs`);
      continue;
    }

    if (geoids.length !== expectedCount) {
      errors.push(
        `SLDU: State ${stateFips} has ${geoids.length} canonical GEOIDs but expected ${expectedCount}`
      );
    }
  }

  // Validate State Legislative Lower (when implemented)
  for (const [stateFips, geoids] of Object.entries(CANONICAL_SLDL_GEOIDS)) {
    const expectedCount = EXPECTED_SLDL_BY_STATE[stateFips];
    if (expectedCount === undefined) {
      errors.push(`SLDL: Unknown state FIPS ${stateFips} in canonical GEOIDs`);
      continue;
    }

    if (geoids.length !== expectedCount) {
      errors.push(
        `SLDL: State ${stateFips} has ${geoids.length} canonical GEOIDs but expected ${expectedCount}`
      );
    }
  }

  // Validate Unified School Districts
  for (const [stateFips, geoids] of Object.entries(CANONICAL_UNSD_GEOIDS)) {
    const expectedCount = EXPECTED_UNSD_BY_STATE[stateFips];
    if (expectedCount === undefined) {
      errors.push(`UNSD: Unknown state FIPS ${stateFips} in canonical GEOIDs`);
      continue;
    }

    if (geoids.length !== expectedCount) {
      errors.push(
        `UNSD: State ${stateFips} has ${geoids.length} canonical GEOIDs but expected ${expectedCount}`
      );
    }
  }

  // Validate Elementary School Districts
  for (const [stateFips, geoids] of Object.entries(CANONICAL_ELSD_GEOIDS)) {
    const expectedCount = EXPECTED_ELSD_BY_STATE[stateFips];
    if (expectedCount === undefined) {
      errors.push(`ELSD: Unknown state FIPS ${stateFips} in canonical GEOIDs`);
      continue;
    }

    if (geoids.length !== expectedCount) {
      errors.push(
        `ELSD: State ${stateFips} has ${geoids.length} canonical GEOIDs but expected ${expectedCount}`
      );
    }
  }

  // Validate Secondary School Districts
  for (const [stateFips, geoids] of Object.entries(CANONICAL_SCSD_GEOIDS)) {
    const expectedCount = EXPECTED_SCSD_BY_STATE[stateFips];
    if (expectedCount === undefined) {
      errors.push(`SCSD: Unknown state FIPS ${stateFips} in canonical GEOIDs`);
      continue;
    }

    if (geoids.length !== expectedCount) {
      errors.push(
        `SCSD: State ${stateFips} has ${geoids.length} canonical GEOIDs but expected ${expectedCount}`
      );
    }
  }

  // Validate Counties
  for (const [stateFips, geoids] of Object.entries(CANONICAL_COUNTY_GEOIDS)) {
    const expectedCount = EXPECTED_COUNTIES_BY_STATE[stateFips];
    if (expectedCount === undefined) {
      errors.push(`COUNTY: Unknown state FIPS ${stateFips} in canonical GEOIDs`);
      continue;
    }

    if (geoids.length !== expectedCount) {
      errors.push(
        `COUNTY: State ${stateFips} has ${geoids.length} canonical GEOIDs but expected ${expectedCount}`
      );
    }
  }

  // Validate Places
  for (const [stateFips, geoids] of Object.entries(CANONICAL_PLACE_GEOIDS)) {
    const expectedCount = EXPECTED_PLACE_BY_STATE[stateFips];
    if (expectedCount === undefined) {
      errors.push(`PLACE: Unknown state FIPS ${stateFips} in canonical GEOIDs`);
      continue;
    }

    if (geoids.length !== expectedCount) {
      errors.push(
        `PLACE: State ${stateFips} has ${geoids.length} canonical GEOIDs but expected ${expectedCount}`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// Self-validate canonical counts at module load time
const validation = validateCanonicalCounts();
if (!validation.valid) {
  logger.error('Canonical GEOID validation failed', {
    errorCount: validation.errors.length,
    errors: validation.errors,
  });
  throw new Error('Canonical GEOID counts do not match expected counts');
}
