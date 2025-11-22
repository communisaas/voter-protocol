/**
 * Boundary Type Definitions and Comprehensive Terminology
 *
 * Source: COMPREHENSIVE-TERMINOLOGY.md
 *
 * This file implements FR-002 (Terminology Fallback) from SPECIFICATION.md v2.0.0
 *
 * Key Principle: Governments use inconsistent terminology. We search ALL possible
 * variants to maximize coverage, stopping at first successful result (score ≥60).
 */

export enum BoundaryType {
  MUNICIPAL = 'municipal',
  COUNTY = 'county',
  STATE_HOUSE = 'state_house',
  STATE_SENATE = 'state_senate',
  CONGRESSIONAL = 'congressional',
  SCHOOL_BOARD = 'school_board',
  SPECIAL_DISTRICT = 'special_district',
  JUDICIAL = 'judicial',
  VOTING_PRECINCT = 'voting_precinct'
}

/**
 * Municipal Boundaries (City/Town Government)
 * Coverage: 80-95% via Hub API with fallback
 */
export const MUNICIPAL_TERMINOLOGY = [
  // Standard Terms (80% of cities) - try these first
  'council districts',
  'city council districts',
  'councilmember districts',
  'council member districts',

  // California-Style Governance (5%) - CRITICAL for SF, LA
  'supervisorial districts',
  'board of supervisors districts',
  'supervisor districts',

  // Ward-Based Systems (10%) - East Coast, Midwest
  'ward',
  'ward boundaries',
  'city wards',
  'municipal wards',

  // Commissioner-Style Governance (3%) - Small Cities
  'commissioner districts',
  'city commissioner districts',
  'commission districts',

  // Alternative Phrasings (2%)
  'representative districts',
  'electoral districts',
  'seat districts',
  'place districts',

  // Regional/Historical (<1%)
  'alderman districts',      // Historical cities (Boston, etc.)
  'aldermanic districts',
  'selectmen districts',     // New England small towns
  'legislative districts'    // At municipal level
] as const;

/**
 * County Boundaries (County Government)
 * Coverage: 90% via Hub API with fallback
 */
export const COUNTY_TERMINOLOGY = [
  // Standard Commissioner Systems
  'commissioner districts',
  'county commissioner districts',
  'board of commissioners districts',
  'commission districts',

  // Supervisor Systems (California, some states)
  'supervisorial districts',
  'board of supervisors districts',
  'supervisor districts',
  'county supervisorial districts',

  // Council Systems (Home Rule Counties)
  'county council districts',
  'council districts',  // In county context

  // Regional Variants
  'magisterial districts',   // Kentucky
  'fiscal court districts',  // Kentucky
  'freeholder districts',    // New Jersey (historical)
  'legislative districts',   // NY counties
  'commissioner precincts'   // Texas (not voting precincts!)
] as const;

/**
 * School Board Boundaries
 * Coverage: 80% (many at-large boards have no geographic districts)
 */
export const SCHOOL_BOARD_TERMINOLOGY = [
  // District-Based Elections
  'school board districts',
  'board of education districts',
  'trustee areas',
  'trustee districts',
  'board member districts',
  'education districts',

  // Trustee-Based Systems (Texas, California common)
  'board trustee districts',
  'single member districts',  // SMD

  // NOTE: Explicitly EXCLUDE attendance boundaries (wrong type):
  // - 'attendance boundaries'
  // - 'enrollment zones'
  // - 'catchment areas'
  // - 'school zones'
] as const;

/**
 * State Legislative Boundaries (Lower Chamber)
 * Coverage: 100% via Census TIGER (authoritative)
 */
export const STATE_HOUSE_TERMINOLOGY = [
  'state house districts',
  'house of representatives districts',
  'representative districts',
  'house districts',
  'lower chamber districts',
  'assembly districts',   // CA, NY, WI
  'delegate districts'    // MD, VA, WV
] as const;

/**
 * State Legislative Boundaries (Upper Chamber)
 * Coverage: 100% via Census TIGER (authoritative)
 */
export const STATE_SENATE_TERMINOLOGY = [
  'state senate districts',
  'senate districts',
  'senatorial districts',
  'upper chamber districts'
] as const;

/**
 * Congressional Boundaries (U.S. House)
 * Coverage: 100% via Census TIGER (authoritative)
 */
export const CONGRESSIONAL_TERMINOLOGY = [
  'congressional districts',
  'house districts',
  'U.S. congressional districts',
  'federal congressional districts',
  'CD'  // Census abbreviation
] as const;

/**
 * Voting Precinct Boundaries
 * Coverage: 100% via Census TIGER VTD (authoritative)
 */
export const VOTING_PRECINCT_TERMINOLOGY = [
  'voting precincts',
  'election precincts',
  'precinct boundaries',
  'VTD',  // Voting Tabulation District (Census term)
  'polling place districts',
  'voting districts',
  'election districts'
] as const;

/**
 * Special District Boundaries
 * Coverage: Hub API only (no TIGER equivalent)
 * 
 * Special districts are local government units created for specific purposes
 * like water, fire protection, transit, libraries, etc. (35,000+ nationwide)
 */
export const SPECIAL_DISTRICT_TERMINOLOGY = [
  // Water Districts
  'water district',
  'water authority',
  'irrigation district',
  'water management district',
  'metropolitan water district',
  
  // Fire Districts
  'fire district',
  'fire protection district',
  'fire authority',
  
  // Transit Districts
  'transit district',
  'transportation district',
  'transit authority',
  'metropolitan transit authority',
  'rapid transit district',
  
  // Library Districts
  'library district',
  'library system',
  
  // Utility Districts
  'utility district',
  'public utility district',
  'municipal utility district',
  
  // General Special Districts
  'special district',
  'service district',
  'improvement district'
] as const;

/**
 * Judicial District Boundaries
 * Coverage: Hub API only (no TIGER equivalent)
 * 
 * Court districts for federal and state judicial systems (500+ nationwide)
 */
export const JUDICIAL_TERMINOLOGY = [
  // Federal Courts
  'federal district court',
  'federal judicial district',
  'U.S. district court',
  'circuit court',
  'federal circuit',
  'appellate district',
  
  // State Courts
  'superior court district',
  'district court',
  'judicial district',
  'court district',
  'circuit court district',
  'family court district',
  'probate court district',
  
  // General Judicial
  'court boundaries',
  'judicial boundaries'
] as const;

/**
 * Get terminology list for a given boundary type
 */
export function getTerminologyForBoundaryType(
  boundaryType: BoundaryType
): readonly string[] {
  switch (boundaryType) {
    case BoundaryType.MUNICIPAL:
      return MUNICIPAL_TERMINOLOGY;
    case BoundaryType.COUNTY:
      return COUNTY_TERMINOLOGY;
    case BoundaryType.SCHOOL_BOARD:
      return SCHOOL_BOARD_TERMINOLOGY;
    case BoundaryType.STATE_HOUSE:
      return STATE_HOUSE_TERMINOLOGY;
    case BoundaryType.STATE_SENATE:
      return STATE_SENATE_TERMINOLOGY;
    case BoundaryType.CONGRESSIONAL:
      return CONGRESSIONAL_TERMINOLOGY;
    case BoundaryType.VOTING_PRECINCT:
      return VOTING_PRECINCT_TERMINOLOGY;
    case BoundaryType.SPECIAL_DISTRICT:
      return SPECIAL_DISTRICT_TERMINOLOGY;
    case BoundaryType.JUDICIAL:
      return JUDICIAL_TERMINOLOGY;
    default:
      return [];
  }
}

/**
 * Get boundary-type-specific keywords for scoring (FR-008)
 */
export function getScoringKeywords(boundaryType: BoundaryType): {
  nameKeywords: string[];
  fieldKeywords: string[];
} {
  switch (boundaryType) {
    case BoundaryType.MUNICIPAL:
      return {
        nameKeywords: ['council', 'district', 'supervisorial', 'ward', 'commissioner'],
        fieldKeywords: ['district', 'council', 'ward', 'supervisor', 'commissioner']
      };

    case BoundaryType.COUNTY:
      return {
        nameKeywords: ['commissioner', 'supervisor', 'district', 'council'],
        fieldKeywords: ['district', 'commissioner', 'supervisor', 'precinct']
      };

    case BoundaryType.SCHOOL_BOARD:
      return {
        nameKeywords: ['school', 'board', 'trustee', 'education', 'district'],
        fieldKeywords: ['district', 'trustee', 'board', 'area']
      };

    case BoundaryType.CONGRESSIONAL:
      return {
        nameKeywords: ['congressional', 'congress', 'house', 'federal', 'district'],
        fieldKeywords: ['district', 'cd', 'congress', 'congressional', 'cong_dist']
      };

    case BoundaryType.STATE_HOUSE:
      return {
        nameKeywords: ['house', 'assembly', 'delegate', 'representative', 'district'],
        fieldKeywords: ['district', 'house', 'assembly', 'leg_dist']
      };

    case BoundaryType.STATE_SENATE:
      return {
        nameKeywords: ['senate', 'senatorial', 'upper', 'district'],
        fieldKeywords: ['district', 'senate', 'sen_dist']
      };

    default:
      return {
        nameKeywords: ['district'],
        fieldKeywords: ['district']
      };
  }
}

/**
 * Success rate by terminology variant (from COMPREHENSIVE-TERMINOLOGY.md)
 * Used for ordering (try most successful variants first)
 */
export const MUNICIPAL_COVERAGE_ESTIMATES = {
  'council districts': 0.80,              // 80% coverage
  'supervisorial districts': 0.03,        // 3% (CA cities)
  'ward': 0.10,                          // 10% (East Coast, Midwest)
  'commissioner districts': 0.03,         // 3% (small cities)
  'council member districts': 0.02        // 2% (alternative phrasing)
} as const;
