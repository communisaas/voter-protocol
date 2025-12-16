/**
 * TIGER Authority Rules - Federal Census Data as Authoritative Source
 *
 * Defines authority hierarchy for Census TIGER data across boundary types.
 * TIGER is a FEDERAL MANDATE source (authority level 5) for congressional
 * districts, state legislative districts, and counties.
 *
 * KEY INSIGHT: TIGER's authority level doesn't change, but its FRESHNESS
 * varies by redistricting cycle. During redistricting gaps (Jan-Jun of years
 * ending in 2), state commissions have NEWER data, so we prefer primary
 * sources even though TIGER has equal or higher authority.
 *
 * AUTHORITY vs FRESHNESS:
 * - Authority = Legal/official status of the source
 * - Freshness = How recently the data was updated
 * - During redistricting: freshest_primary > stale_federal
 *
 * Integration:
 * - Works with validity-window.ts for temporal freshness
 * - Works with gap-detector.ts for redistricting periods
 * - Works with authority-registry.ts for source hierarchy
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Boundary types with TIGER data
 * Matches BoundaryType from authority-registry.ts
 */
export type TIGERBoundaryType =
  | 'congressional'
  | 'state_senate'
  | 'state_house'
  | 'county'
  | 'place'
  | 'school_unified'
  | 'voting_precinct'
  | 'special_district';

/**
 * Authority levels (0-5 scale)
 * Matches PROVENANCE-SPEC.md authority pyramid
 */
export enum AuthorityLevel {
  UNKNOWN = 0,
  COMMUNITY_MAINTAINED = 1,
  HUB_AGGREGATOR = 2,
  MUNICIPAL_OFFICIAL = 3,
  STATE_MANDATE = 4,
  FEDERAL_MANDATE = 5,
}

/**
 * Legal status of boundary data
 */
export type LegalStatus = 'binding' | 'advisory' | 'unofficial';

/**
 * Source provider types
 */
export type SourceProvider =
  | 'census-tiger'
  | 'state-redistricting-commission'
  | 'state-redistricting'
  | 'state-gis'
  | 'county-gis'
  | 'municipal-gis'
  | 'arcgis-hub'
  | 'osm';

/**
 * Validity window configuration
 * Defines when TIGER data is considered current
 */
export interface ValidityWindow {
  /** Month when TIGER releases (1-12) */
  readonly releaseMonth: number;

  /** How many months the data is valid */
  readonly validMonths: number;
}

/**
 * Source precedence entry
 * Defines preference order when multiple sources available
 */
export interface SourcePrecedence {
  /** Source provider type */
  readonly source: SourceProvider;

  /** Authority level (0-5) */
  readonly authority: AuthorityLevel;

  /** Preference rank (1 = highest) */
  readonly preference: number;
}

/**
 * TIGER authority rule for a boundary type
 */
export interface TIGERAuthorityRule {
  /** Authority level for TIGER data */
  readonly authorityLevel: AuthorityLevel;

  /** Legal status of TIGER boundaries */
  readonly legalStatus: LegalStatus;

  /** Validity window configuration */
  readonly validityWindow: ValidityWindow;

  /** Source precedence order (sorted by preference) */
  readonly precedence: readonly SourcePrecedence[];
}

// ============================================================================
// TIGER Authority Rules Data
// ============================================================================

/**
 * TIGER authority rules by boundary type
 *
 * PRECEDENCE LOGIC:
 * 1. During normal periods: TIGER (federal) is authoritative
 * 2. During redistricting gaps: State commissions have newer data, prefer primary
 * 3. Counties/places: TIGER is always authoritative (rare changes)
 *
 * AUTHORITY LEVELS:
 * - Congressional districts: Federal mandate (5)
 * - State legislative: State mandate (4), but TIGER also authoritative (5) as aggregator
 * - Counties: Federal mandate (5) - TIGER is definitive source
 */
export const TIGER_AUTHORITY_RULES: Record<TIGERBoundaryType, TIGERAuthorityRule> = {
  'congressional': {
    authorityLevel: AuthorityLevel.FEDERAL_MANDATE,
    legalStatus: 'binding',
    validityWindow: {
      releaseMonth: 7,  // July (September in task description is incorrect - TIGER releases in July)
      validMonths: 12,
    },
    precedence: [
      // During redistricting gaps (Jan-Jun post-redistricting):
      // State commissions finalize first → prefer their data
      {
        source: 'state-redistricting-commission',
        authority: AuthorityLevel.FEDERAL_MANDATE,  // Commissions draw the official maps
        preference: 1,
      },
      {
        source: 'state-redistricting',
        authority: AuthorityLevel.STATE_MANDATE,
        preference: 2,
      },
      // After July update: TIGER has incorporated state data → use TIGER
      {
        source: 'census-tiger',
        authority: AuthorityLevel.FEDERAL_MANDATE,
        preference: 3,
      },
      // Fallback sources (low confidence)
      {
        source: 'state-gis',
        authority: AuthorityLevel.STATE_MANDATE,
        preference: 4,
      },
      {
        source: 'arcgis-hub',
        authority: AuthorityLevel.HUB_AGGREGATOR,
        preference: 5,
      },
    ],
  },

  'state_senate': {
    authorityLevel: AuthorityLevel.FEDERAL_MANDATE,
    legalStatus: 'binding',
    validityWindow: {
      releaseMonth: 7,
      validMonths: 12,
    },
    precedence: [
      {
        source: 'state-redistricting-commission',
        authority: AuthorityLevel.FEDERAL_MANDATE,
        preference: 1,
      },
      {
        source: 'state-redistricting',
        authority: AuthorityLevel.STATE_MANDATE,
        preference: 2,
      },
      {
        source: 'census-tiger',
        authority: AuthorityLevel.FEDERAL_MANDATE,
        preference: 3,
      },
      {
        source: 'state-gis',
        authority: AuthorityLevel.STATE_MANDATE,
        preference: 4,
      },
    ],
  },

  'state_house': {
    authorityLevel: AuthorityLevel.FEDERAL_MANDATE,
    legalStatus: 'binding',
    validityWindow: {
      releaseMonth: 7,
      validMonths: 12,
    },
    precedence: [
      {
        source: 'state-redistricting-commission',
        authority: AuthorityLevel.FEDERAL_MANDATE,
        preference: 1,
      },
      {
        source: 'state-redistricting',
        authority: AuthorityLevel.STATE_MANDATE,
        preference: 2,
      },
      {
        source: 'census-tiger',
        authority: AuthorityLevel.FEDERAL_MANDATE,
        preference: 3,
      },
      {
        source: 'state-gis',
        authority: AuthorityLevel.STATE_MANDATE,
        preference: 4,
      },
    ],
  },

  'county': {
    authorityLevel: AuthorityLevel.FEDERAL_MANDATE,
    legalStatus: 'binding',
    validityWindow: {
      releaseMonth: 7,
      validMonths: 12,
    },
    precedence: [
      // Counties: TIGER is THE authoritative source
      // County boundaries change rarely (annexations, consolidations)
      {
        source: 'census-tiger',
        authority: AuthorityLevel.FEDERAL_MANDATE,
        preference: 1,
      },
      // County GIS may have newer data for recent changes
      {
        source: 'county-gis',
        authority: AuthorityLevel.MUNICIPAL_OFFICIAL,
        preference: 2,
      },
      {
        source: 'state-gis',
        authority: AuthorityLevel.STATE_MANDATE,
        preference: 3,
      },
    ],
  },

  'place': {
    authorityLevel: AuthorityLevel.FEDERAL_MANDATE,
    legalStatus: 'binding',
    validityWindow: {
      releaseMonth: 7,
      validMonths: 12,
    },
    precedence: [
      {
        source: 'census-tiger',
        authority: AuthorityLevel.FEDERAL_MANDATE,
        preference: 1,
      },
      {
        source: 'municipal-gis',
        authority: AuthorityLevel.MUNICIPAL_OFFICIAL,
        preference: 2,
      },
      {
        source: 'state-gis',
        authority: AuthorityLevel.STATE_MANDATE,
        preference: 3,
      },
    ],
  },

  'school_unified': {
    authorityLevel: AuthorityLevel.FEDERAL_MANDATE,
    legalStatus: 'binding',
    validityWindow: {
      releaseMonth: 7,
      validMonths: 12,
    },
    precedence: [
      {
        source: 'census-tiger',
        authority: AuthorityLevel.FEDERAL_MANDATE,
        preference: 1,
      },
      {
        source: 'state-gis',
        authority: AuthorityLevel.STATE_MANDATE,
        preference: 2,
      },
    ],
  },

  'voting_precinct': {
    authorityLevel: AuthorityLevel.UNKNOWN,
    legalStatus: 'unofficial',
    validityWindow: {
      releaseMonth: 7,
      validMonths: 12,
    },
    precedence: [
      // TIGER does NOT provide voting precincts
      // County elections offices are authoritative
      {
        source: 'county-gis',
        authority: AuthorityLevel.MUNICIPAL_OFFICIAL,
        preference: 1,
      },
      {
        source: 'state-gis',
        authority: AuthorityLevel.STATE_MANDATE,
        preference: 2,
      },
    ],
  },

  'special_district': {
    authorityLevel: AuthorityLevel.UNKNOWN,
    legalStatus: 'unofficial',
    validityWindow: {
      releaseMonth: 7,
      validMonths: 12,
    },
    precedence: [
      // TIGER does NOT provide special districts
      // Varies by district type (water, fire, library, etc.)
      {
        source: 'state-gis',
        authority: AuthorityLevel.STATE_MANDATE,
        preference: 1,
      },
      {
        source: 'county-gis',
        authority: AuthorityLevel.MUNICIPAL_OFFICIAL,
        preference: 2,
      },
    ],
  },
};

// ============================================================================
// Boundary Type Sets
// ============================================================================

/**
 * Boundary types where TIGER is the authoritative federal source
 */
export const TIGER_AUTHORITATIVE_TYPES = new Set<TIGERBoundaryType>([
  'congressional',
  'state_senate',
  'state_house',
  'county',
  'place',
  'school_unified',
]);

/**
 * Boundary types affected by redistricting
 * During redistricting gaps, prefer state primary sources
 */
export const REDISTRICTING_AFFECTED_TYPES = new Set<TIGERBoundaryType>([
  'congressional',
  'state_senate',
  'state_house',
]);

/**
 * Boundary types where TIGER does NOT provide data
 */
export const TIGER_NOT_PROVIDED_TYPES = new Set<TIGERBoundaryType>([
  'voting_precinct',
  'special_district',
]);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get TIGER authority rule for a boundary type
 *
 * @param boundaryType - Type of boundary
 * @returns Authority rule configuration
 */
export function getTIGERAuthorityRule(
  boundaryType: TIGERBoundaryType
): TIGERAuthorityRule {
  const rule = TIGER_AUTHORITY_RULES[boundaryType];
  if (!rule) {
    throw new Error(`No TIGER authority rule found for boundary type: ${boundaryType}`);
  }
  return rule;
}

/**
 * Check if TIGER is authoritative for a boundary type
 *
 * @param boundaryType - Type of boundary
 * @returns True if TIGER is authoritative source
 */
export function isTIGERAuthoritative(boundaryType: TIGERBoundaryType): boolean {
  return TIGER_AUTHORITATIVE_TYPES.has(boundaryType);
}

/**
 * Check if boundary type is affected by redistricting
 *
 * @param boundaryType - Type of boundary
 * @returns True if redistricting affects this boundary
 */
export function isRedistrictingAffected(boundaryType: TIGERBoundaryType): boolean {
  return REDISTRICTING_AFFECTED_TYPES.has(boundaryType);
}

/**
 * Check if TIGER provides data for this boundary type
 *
 * @param boundaryType - Type of boundary
 * @returns True if TIGER provides this data
 */
export function doesTIGERProvide(boundaryType: TIGERBoundaryType): boolean {
  return !TIGER_NOT_PROVIDED_TYPES.has(boundaryType);
}

/**
 * Get source precedence for a boundary type
 * Returns sources sorted by preference (highest first)
 *
 * @param boundaryType - Type of boundary
 * @returns Sorted array of source precedence entries
 */
export function getSourcePrecedence(
  boundaryType: TIGERBoundaryType
): readonly SourcePrecedence[] {
  const rule = getTIGERAuthorityRule(boundaryType);
  return rule.precedence;
}

/**
 * Get highest authority source for a boundary type
 *
 * @param boundaryType - Type of boundary
 * @returns Source with highest preference
 */
export function getPreferredSource(
  boundaryType: TIGERBoundaryType
): SourcePrecedence {
  const precedence = getSourcePrecedence(boundaryType);
  if (precedence.length === 0) {
    throw new Error(`No sources defined for boundary type: ${boundaryType}`);
  }
  return precedence[0];
}

/**
 * Find source precedence by provider
 *
 * @param boundaryType - Type of boundary
 * @param provider - Source provider to find
 * @returns Source precedence entry or undefined
 */
export function findSourcePrecedence(
  boundaryType: TIGERBoundaryType,
  provider: SourceProvider
): SourcePrecedence | undefined {
  const precedence = getSourcePrecedence(boundaryType);
  return precedence.find((p) => p.source === provider);
}

/**
 * Get authority level for a source provider
 *
 * @param boundaryType - Type of boundary
 * @param provider - Source provider
 * @returns Authority level or undefined if not found
 */
export function getSourceAuthority(
  boundaryType: TIGERBoundaryType,
  provider: SourceProvider
): AuthorityLevel | undefined {
  const precedence = findSourcePrecedence(boundaryType, provider);
  return precedence?.authority;
}
