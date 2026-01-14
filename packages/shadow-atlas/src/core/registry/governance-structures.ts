/**
 * Governance Structure Registry
 *
 * PROBLEM: ~200 US cities use at-large representation (no geographic districts).
 * Current architecture wastes compute attempting Layer 1 discovery where it cannot succeed.
 *
 * SOLUTION: Authoritative governance registry for pre-flight checks.
 *
 * DESIGN PRINCIPLES:
 * - Zero false positives: Never skip Layer 1 for district-based cities
 * - Authoritative sources: Municipal charters, state municipal league databases, Wikipedia
 * - Graceful degradation: Unknown governance → attempt Layer 1 discovery
 * - Git-trackable curation: Central registry for manual verification
 */

/**
 * Governance structure types
 */
export type GovernanceStructure =
  | 'district-based'    // Geographic districts elect representatives
  | 'at-large'          // All representatives elected city-wide
  | 'mixed'             // Some district, some at-large (treat as district-based)
  | 'unknown';          // No authoritative data (attempt discovery)

/**
 * Governance record with authoritative source metadata
 */
export interface GovernanceRecord {
  readonly cityFips: string;
  readonly cityName: string;
  readonly state: string;
  readonly structure: GovernanceStructure;
  readonly councilSize: number;           // Total number of council members
  readonly districtSeats?: number;        // Number of district-based seats (for mixed systems)
  readonly atLargeSeats?: number;         // Number of at-large seats
  readonly source: string;                // URL to authoritative source
  readonly lastVerified: string;          // ISO date (YYYY-MM-DD)
  readonly notes?: string;
}

/**
 * Governance Registry
 *
 * Manually curated governance structures for US cities.
 * Sources: Municipal charters, Wikipedia governance infoboxes, Ballotpedia
 *
 * MAINTENANCE:
 * - Add entries when Layer 1 discovery fails for at-large cities
 * - Update entries when cities change governance (rare, via referendums)
 * - Verify sources annually (check lastVerified timestamps)
 */
export const GOVERNANCE_REGISTRY: Record<string, GovernanceRecord> = {
  // ============================================================================
  // AT-LARGE CITIES (no geographic districts)
  // ============================================================================

  '0803000': { // Boulder, CO
    cityFips: '0803000',
    cityName: 'Boulder',
    state: 'CO',
    structure: 'at-large',
    councilSize: 9,
    atLargeSeats: 9,
    source: 'https://bouldercolorado.gov/government/city-council',
    lastVerified: '2025-11-18',
    notes: 'All 9 council members elected at-large',
  },

  '2603000': { // Ann Arbor, MI
    cityFips: '2603000',
    cityName: 'Ann Arbor',
    state: 'MI',
    structure: 'at-large',
    councilSize: 11,
    atLargeSeats: 11,
    source: 'https://www.a2gov.org/departments/city-council/',
    lastVerified: '2025-11-18',
    notes: 'Mayor + 10 council members, all elected at-large',
  },

  // ============================================================================
  // MIXED SYSTEMS (treat as district-based for Layer 1 discovery)
  // ============================================================================

  '0667000': { // San Francisco, CA
    cityFips: '0667000',
    cityName: 'San Francisco',
    state: 'CA',
    structure: 'district-based', // Changed from at-large to district-based in 2000
    councilSize: 11,
    districtSeats: 11,
    atLargeSeats: 0,
    source: 'https://sfgov.org/electionscommission/board-supervisors',
    lastVerified: '2025-11-18',
    notes: 'All 11 supervisors elected by district (changed from at-large in 2000)',
  },

  // ============================================================================
  // DISTRICT-BASED CITIES (geographic districts)
  // ============================================================================

  '4159000': { // Portland, OR
    cityFips: '4159000',
    cityName: 'Portland',
    state: 'OR',
    structure: 'district-based',
    councilSize: 12,
    districtSeats: 12,
    source: 'https://www.portland.gov/bts/cgis/open-data-site',
    lastVerified: '2025-11-18',
    notes: 'New 2024 voting district system (4 districts, 3 reps each)',
  },

  '2938000': { // Kansas City, MO
    cityFips: '2938000',
    cityName: 'Kansas City',
    state: 'MO',
    structure: 'district-based',
    councilSize: 13,
    districtSeats: 6, // 6 in-district, 6 at-large, 1 mayor
    atLargeSeats: 6,
    source: 'https://www.kcmo.gov/city-hall/city-officials/city-council',
    lastVerified: '2025-11-18',
    notes: 'Mixed: 6 district representatives + 6 at-large council members',
  },

  '5363000': { // Seattle, WA
    cityFips: '5363000',
    cityName: 'Seattle',
    state: 'WA',
    structure: 'district-based',
    councilSize: 9,
    districtSeats: 7,
    atLargeSeats: 2,
    source: 'https://www.seattle.gov/council',
    lastVerified: '2025-11-18',
    notes: 'Mixed: 7 district representatives + 2 at-large positions',
  },

  '0644000': { // Los Angeles, CA
    cityFips: '0644000',
    cityName: 'Los Angeles',
    state: 'CA',
    structure: 'district-based',
    councilSize: 15,
    districtSeats: 15,
    source: 'https://www.lacity.org/government/popular-information/city-government-la-101/elected-officials',
    lastVerified: '2025-11-18',
    notes: 'All 15 council members elected by district',
  },

  '3651000': { // New York, NY
    cityFips: '3651000',
    cityName: 'New York',
    state: 'NY',
    structure: 'district-based',
    councilSize: 51,
    districtSeats: 51,
    source: 'https://council.nyc.gov/districts/',
    lastVerified: '2025-11-18',
    notes: 'All 51 council members elected by district',
  },

  '1714000': { // Chicago, IL
    cityFips: '1714000',
    cityName: 'Chicago',
    state: 'IL',
    structure: 'district-based',
    councilSize: 50,
    districtSeats: 50,
    source: 'https://www.chicago.gov/city/en/about/wards.html',
    lastVerified: '2025-11-18',
    notes: 'All 50 aldermen elected by ward (district)',
  },

  '4805000': { // Austin, TX
    cityFips: '4805000',
    cityName: 'Austin',
    state: 'TX',
    structure: 'district-based',
    councilSize: 11,
    districtSeats: 10,
    atLargeSeats: 1, // Mayor elected at-large
    source: 'https://www.austintexas.gov/department/city-council',
    lastVerified: '2025-11-18',
    notes: '10 single-member districts + mayor elected at-large',
  },
};
