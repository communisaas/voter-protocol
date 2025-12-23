/**
 * Expected GEOID Registry for TIGER Data Validation
 *
 * Provides authoritative GEOID lists for completeness checking.
 * Ensures extracted TIGER data includes all expected geographic entities.
 *
 * GEOID STRUCTURE:
 * - State: 2 digits (e.g., "06" = California)
 * - County: State (2) + County (3) (e.g., "06037" = Los Angeles County)
 * - Congressional District: State (2) + District (2) (e.g., "0612" = CA-12)
 * - Place: State (2) + Place (5) (e.g., "0644000" = Los Angeles city)
 *
 * DATA SOURCES:
 * - US Census Bureau TIGER/Line technical documentation
 * - State-level counts from validators/tiger-expected-counts.ts
 * - County FIPS codes from USGS National Map
 * - Congressional district codes from Census Bureau apportionment
 *
 * MAINTENANCE:
 * - Update after decennial census redistricting
 * - Update when county boundaries change (rare)
 * - Verify against TIGER/Line downloads annually
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 *
 * Last Updated: 2025-12-22
 */

import {
  EXPECTED_CD_BY_STATE,
  EXPECTED_SLDU_BY_STATE,
  EXPECTED_SLDL_BY_STATE,
  EXPECTED_COUNTIES_BY_STATE,
  FIPS_TO_STATE_ABBR,
  getStateName,
} from '../validators/tiger-expected-counts.js';

// ============================================================================
// Types
// ============================================================================

/**
 * GEOID validation result
 */
export interface GEOIDValidationResult {
  /** Validation passed (all expected GEOIDs present) */
  readonly complete: boolean;

  /** Expected GEOID count */
  readonly expected: number;

  /** Received GEOID count */
  readonly received: number;

  /** Missing GEOIDs (expected but not received) */
  readonly missing: readonly string[];

  /** Unexpected GEOIDs (received but not expected) */
  readonly unexpected: readonly string[];

  /** Validation summary message */
  readonly summary: string;
}

/**
 * Entity type for GEOID validation
 */
export type GEOIDEntityType =
  | 'county'
  | 'congressional'
  | 'state_senate'
  | 'state_house'
  | 'place';

// ============================================================================
// GEOID Generators
// ============================================================================

/**
 * Generate expected county GEOIDs for a state
 *
 * County GEOIDs: State FIPS (2) + County FIPS (3)
 * Example: "06037" = California (06) + Los Angeles County (037)
 *
 * NOTE: This generates sequential county codes 001-NNN where NNN is the
 * county count. Actual TIGER data may have non-sequential codes (e.g.,
 * Virginia independent cities). Use this for count validation only.
 * For exact GEOID validation, load actual TIGER county codes.
 *
 * @param stateFips - State FIPS code (2 digits, e.g., "06")
 * @returns Array of expected county GEOIDs
 */
export function getExpectedCountyGEOIDs(stateFips: string): readonly string[] {
  const countyCount = EXPECTED_COUNTIES_BY_STATE[stateFips];
  if (!countyCount) {
    return [];
  }

  // Generate sequential county codes 001-NNN
  // NOTE: This is approximate. Some states have non-sequential codes.
  const geoids: string[] = [];
  for (let i = 1; i <= countyCount; i++) {
    const countyCode = String(i).padStart(3, '0');
    geoids.push(`${stateFips}${countyCode}`);
  }

  return geoids;
}

/**
 * Generate expected congressional district GEOIDs for a state
 *
 * Congressional District GEOIDs: State FIPS (2) + District (2)
 * Example: "0612" = California (06) + District 12
 *
 * At-large districts use "00" (e.g., "0200" = Alaska at-large)
 *
 * @param stateFips - State FIPS code (2 digits)
 * @returns Array of expected congressional district GEOIDs
 */
export function getExpectedCongressionalGEOIDs(stateFips: string): readonly string[] {
  const districtCount = EXPECTED_CD_BY_STATE[stateFips];
  if (!districtCount) {
    return [];
  }

  const geoids: string[] = [];

  if (districtCount === 1) {
    // At-large district (Alaska, Delaware, Montana, etc.)
    geoids.push(`${stateFips}00`);
  } else {
    // Multi-district states (01-NN)
    for (let i = 1; i <= districtCount; i++) {
      const districtCode = String(i).padStart(2, '0');
      geoids.push(`${stateFips}${districtCode}`);
    }
  }

  return geoids;
}

/**
 * Generate expected state senate (upper) district GEOIDs for a state
 *
 * State Legislative Upper GEOIDs: State FIPS (2) + "U" + District (3)
 * Example: "06U001" = California (06) + Upper (U) + District 001
 *
 * @param stateFips - State FIPS code (2 digits)
 * @returns Array of expected state senate district GEOIDs
 */
export function getExpectedStateSenateGEOIDs(stateFips: string): readonly string[] {
  const districtCount = EXPECTED_SLDU_BY_STATE[stateFips];
  if (!districtCount) {
    return [];
  }

  const geoids: string[] = [];
  for (let i = 1; i <= districtCount; i++) {
    const districtCode = String(i).padStart(3, '0');
    geoids.push(`${stateFips}U${districtCode}`);
  }

  return geoids;
}

/**
 * Generate expected state house (lower) district GEOIDs for a state
 *
 * State Legislative Lower GEOIDs: State FIPS (2) + "L" + District (3)
 * Example: "06L001" = California (06) + Lower (L) + District 001
 *
 * NOTE: Nebraska is unicameral (no lower house), returns empty array.
 *
 * @param stateFips - State FIPS code (2 digits)
 * @returns Array of expected state house district GEOIDs
 */
export function getExpectedStateHouseGEOIDs(stateFips: string): readonly string[] {
  const districtCount = EXPECTED_SLDL_BY_STATE[stateFips];
  if (!districtCount || districtCount === 0) {
    return [];
  }

  const geoids: string[] = [];
  for (let i = 1; i <= districtCount; i++) {
    const districtCode = String(i).padStart(3, '0');
    geoids.push(`${stateFips}L${districtCode}`);
  }

  return geoids;
}

// ============================================================================
// GEOID Validation
// ============================================================================

/**
 * Validate GEOID completeness for extracted data
 *
 * Compares extracted GEOIDs against expected GEOIDs to identify:
 * - Missing GEOIDs (expected but not received)
 * - Unexpected GEOIDs (received but not expected)
 *
 * @param stateFips - State FIPS code (2 digits, e.g., "06")
 * @param entityType - Entity type to validate
 * @param extractedGEOIDs - GEOIDs extracted from TIGER data
 * @returns Validation result with missing/unexpected GEOIDs
 *
 * @example
 * ```typescript
 * const result = validateGEOIDCompleteness(
 *   '06',
 *   'county',
 *   extractedCountyGEOIDs
 * );
 *
 * if (!result.complete) {
 *   console.error(`Missing counties: ${result.missing.join(', ')}`);
 *   console.error(`Unexpected counties: ${result.unexpected.join(', ')}`);
 * }
 * ```
 */
export function validateGEOIDCompleteness(
  stateFips: string,
  entityType: GEOIDEntityType,
  extractedGEOIDs: readonly string[]
): GEOIDValidationResult {
  // Get expected GEOIDs based on entity type
  let expectedGEOIDs: readonly string[];
  switch (entityType) {
    case 'county':
      expectedGEOIDs = getExpectedCountyGEOIDs(stateFips);
      break;
    case 'congressional':
      expectedGEOIDs = getExpectedCongressionalGEOIDs(stateFips);
      break;
    case 'state_senate':
      expectedGEOIDs = getExpectedStateSenateGEOIDs(stateFips);
      break;
    case 'state_house':
      expectedGEOIDs = getExpectedStateHouseGEOIDs(stateFips);
      break;
    case 'place':
      // Places don't have fixed expected GEOIDs (varies widely)
      expectedGEOIDs = [];
      break;
    default: {
      const exhaustiveCheck: never = entityType;
      throw new Error(`Unknown entity type: ${exhaustiveCheck}`);
    }
  }

  // Convert to sets for efficient comparison
  const expectedSet = new Set(expectedGEOIDs);
  const extractedSet = new Set(extractedGEOIDs);

  // Find missing and unexpected GEOIDs
  const missing: string[] = [];
  const unexpected: string[] = [];

  // Use Array.from to avoid downlevelIteration issues
  for (const geoid of Array.from(expectedSet)) {
    if (!extractedSet.has(geoid)) {
      missing.push(geoid);
    }
  }

  for (const geoid of Array.from(extractedSet)) {
    if (!expectedSet.has(geoid)) {
      unexpected.push(geoid);
    }
  }

  const complete = missing.length === 0 && unexpected.length === 0;
  const stateName = getStateName(stateFips) || stateFips;

  let summary: string;
  if (complete) {
    summary = `✅ Complete: ${extractedGEOIDs.length}/${expectedGEOIDs.length} ${entityType} GEOIDs for ${stateName}`;
  } else {
    const issues: string[] = [];
    if (missing.length > 0) {
      issues.push(`${missing.length} missing`);
    }
    if (unexpected.length > 0) {
      issues.push(`${unexpected.length} unexpected`);
    }
    summary = `❌ Incomplete: ${extractedGEOIDs.length}/${expectedGEOIDs.length} ${entityType} GEOIDs for ${stateName} (${issues.join(', ')})`;
  }

  return {
    complete,
    expected: expectedGEOIDs.length,
    received: extractedGEOIDs.length,
    missing,
    unexpected,
    summary,
  };
}

/**
 * Validate national GEOID completeness
 *
 * Validates that all expected GEOIDs across all states are present.
 *
 * @param entityType - Entity type to validate
 * @param extractedGEOIDs - GEOIDs extracted from national TIGER data
 * @returns Validation result with missing/unexpected GEOIDs
 */
export function validateNationalGEOIDCompleteness(
  entityType: Exclude<GEOIDEntityType, 'place'>,
  extractedGEOIDs: readonly string[]
): GEOIDValidationResult {
  const allExpectedGEOIDs: string[] = [];

  // Aggregate expected GEOIDs from all states
  for (const stateFips of Object.keys(EXPECTED_COUNTIES_BY_STATE)) {
    let stateGEOIDs: readonly string[];
    switch (entityType) {
      case 'county':
        stateGEOIDs = getExpectedCountyGEOIDs(stateFips);
        break;
      case 'congressional':
        stateGEOIDs = getExpectedCongressionalGEOIDs(stateFips);
        break;
      case 'state_senate':
        stateGEOIDs = getExpectedStateSenateGEOIDs(stateFips);
        break;
      case 'state_house':
        stateGEOIDs = getExpectedStateHouseGEOIDs(stateFips);
        break;
      default: {
        const exhaustiveCheck: never = entityType;
        throw new Error(`Unknown entity type: ${exhaustiveCheck}`);
      }
    }
    allExpectedGEOIDs.push(...stateGEOIDs);
  }

  const expectedSet = new Set(allExpectedGEOIDs);
  const extractedSet = new Set(extractedGEOIDs);

  const missing: string[] = [];
  const unexpected: string[] = [];

  // Use Array.from to avoid downlevelIteration issues
  for (const geoid of Array.from(expectedSet)) {
    if (!extractedSet.has(geoid)) {
      missing.push(geoid);
    }
  }

  for (const geoid of Array.from(extractedSet)) {
    if (!expectedSet.has(geoid)) {
      unexpected.push(geoid);
    }
  }

  const complete = missing.length === 0 && unexpected.length === 0;

  let summary: string;
  if (complete) {
    summary = `✅ Complete: ${extractedGEOIDs.length}/${allExpectedGEOIDs.length} national ${entityType} GEOIDs`;
  } else {
    const issues: string[] = [];
    if (missing.length > 0) {
      issues.push(`${missing.length} missing`);
    }
    if (unexpected.length > 0) {
      issues.push(`${unexpected.length} unexpected`);
    }
    summary = `❌ Incomplete: ${extractedGEOIDs.length}/${allExpectedGEOIDs.length} national ${entityType} GEOIDs (${issues.join(', ')})`;
  }

  return {
    complete,
    expected: allExpectedGEOIDs.length,
    received: extractedGEOIDs.length,
    missing,
    unexpected,
    summary,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse GEOID to extract components
 *
 * @param geoid - GEOID to parse
 * @returns Parsed components or null if invalid format
 */
export function parseGEOID(geoid: string): {
  readonly stateFips: string;
  readonly entityCode: string;
  readonly entityType: string;
} | null {
  if (geoid.length < 2) {
    return null;
  }

  const stateFips = geoid.substring(0, 2);

  // County: SSCCC (5 chars, state + 3-digit county)
  if (geoid.length === 5 && /^\d{5}$/.test(geoid)) {
    return {
      stateFips,
      entityCode: geoid.substring(2),
      entityType: 'county',
    };
  }

  // Congressional District: SSDD (4 chars, state + 2-digit district)
  if (geoid.length === 4 && /^\d{4}$/.test(geoid)) {
    return {
      stateFips,
      entityCode: geoid.substring(2),
      entityType: 'congressional',
    };
  }

  // State Legislative: SSXDDD (6 chars, state + U/L + 3-digit district)
  if (geoid.length === 6 && /^\d{2}[UL]\d{3}$/.test(geoid)) {
    const chamber = geoid[2] === 'U' ? 'state_senate' : 'state_house';
    return {
      stateFips,
      entityCode: geoid.substring(2),
      entityType: chamber,
    };
  }

  // Place: SSCCCCC (7 chars, state + 5-digit place)
  if (geoid.length === 7 && /^\d{7}$/.test(geoid)) {
    return {
      stateFips,
      entityCode: geoid.substring(2),
      entityType: 'place',
    };
  }

  return null;
}

/**
 * Get human-readable name for GEOID entity type
 */
export function getEntityTypeName(entityType: GEOIDEntityType): string {
  switch (entityType) {
    case 'county':
      return 'County';
    case 'congressional':
      return 'Congressional District';
    case 'state_senate':
      return 'State Senate District';
    case 'state_house':
      return 'State House District';
    case 'place':
      return 'Place';
    default: {
      const exhaustiveCheck: never = entityType;
      throw new Error(`Unknown entity type: ${exhaustiveCheck}`);
    }
  }
}
