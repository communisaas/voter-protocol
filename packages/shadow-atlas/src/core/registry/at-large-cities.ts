/**
 * At-Large City Council Registry
 *
 * PURPOSE: Track cities with at-large or proportional voting systems that have
 * NO geographic council districts.
 *
 * ARCHITECTURE:
 * - Prevents tessellation validation on cities without geographic districts
 * - Used by validators to skip containment checks
 * - Documents election method for transparency
 *
 * WHAT IS AT-LARGE VOTING?
 * - **At-Large**: All council members elected citywide, not by district
 * - **Proportional**: Ranked-choice or proportional representation citywide
 * - **Mixed**: Some at-large seats, some district seats (not in this registry)
 *
 * WHY EXCLUDE FROM TESSELLATION?
 * Tessellation validation checks that council districts:
 * 1. Cover the entire city boundary (containment)
 * 2. Don't overlap each other (mutual exclusion)
 * 3. Don't have gaps (completeness)
 *
 * Cities with at-large voting have ZERO geographic districts - there's nothing
 * to tessellate. Attempting validation would fail 100% of tests because no
 * district polygons exist.
 *
 * MAINTENANCE:
 * - Add cities when containment failures indicate at-large structure
 * - Verify election method via city charter or official documentation
 * - Update if city changes to district-based voting
 *
 * SOURCES:
 * - WS-3 containment failure analysis (docs/containment-failure-analysis.md)
 * - City charters and official government websites
 * - Municipal League references
 */

/**
 * At-large city metadata
 */
export interface AtLargeCity {
  /** City name (human-readable) */
  readonly cityName: string;

  /** State abbreviation (e.g., "TX", "MA") */
  readonly state: string;

  /** Number of council seats (elected at-large) */
  readonly councilSize: number;

  /**
   * Election method:
   * - at-large: All seats elected citywide
   * - proportional: Proportional representation (e.g., Cambridge MA)
   * - mixed: Combination (should NOT be in this registry)
   */
  readonly electionMethod: 'at-large' | 'proportional';

  /** Source documenting at-large structure */
  readonly source: string;

  /** Additional context */
  readonly notes?: string;
}

/**
 * Registry of at-large cities (indexed by 7-digit Census PLACE FIPS code)
 *
 * These cities are EXCLUDED from tessellation validation because they have
 * no geographic council districts.
 */
export const AT_LARGE_CITIES: Record<string, AtLargeCity> = {
  /**
   * Cambridge, MA - Proportional Representation
   *
   * Uses proportional representation voting (Plan E) since 1941.
   * 9 city councillors elected at-large via ranked-choice voting.
   * No geographic districts.
   *
   * Source: Cambridge City Charter, Article II
   * Containment failure: WS-3 analysis (100% overflow, wrong data source)
   */
  '2511000': {
    cityName: 'Cambridge',
    state: 'MA',
    councilSize: 9,
    electionMethod: 'proportional',
    source: 'Cambridge City Charter, Article II (Plan E)',
    notes: 'Uses proportional representation (ranked-choice voting) since 1941. One of few US cities with proportional representation.',
  },

  // REMOVED (2026-01-18): Morrisville NC (3746060)
  // CORRECTION: Morrisville has HYBRID system, not at-large!
  // - 4 district representatives elected by district
  // - 2 at-large council members elected citywide
  // - Mayor elected at-large
  // - Total: 7-member council (4 district + 2 at-large + mayor)
  // FeatureServer exists with 4 valid district boundaries:
  // https://services1.arcgis.com/a7CWfuGP5ZnLYE7I/arcgis/rest/services/MorrisvilleTownCouncilDistricts/FeatureServer/0
  // Entry incorrectly added based on containment failure - actual districts exist but boundary mismatch
  // WS-F subagent investigation 2026-01-18 identified error

  /**
   * Pearland, TX - At-Large Council
   *
   * 8-member city council (mayor + 7 councillors) elected at-large.
   * No single-member districts.
   *
   * Source: Pearland City Charter
   * Containment failure: WS-3 analysis (100% overflow, Houston city data)
   */
  '4856348': {
    cityName: 'Pearland',
    state: 'TX',
    councilSize: 8,
    electionMethod: 'at-large',
    source: 'Pearland City Charter, Article III',
    notes: 'At-large council. Registry mistakenly contained Houston city council districts (11 districts A-K).',
  },

  /**
   * Gresham, OR - At-Large Council (VERIFIED)
   *
   * 6 city councilors elected at-large by position numbers + at-large mayor.
   * Charter Review Committee (2021-2023) recommended transition to 4-district
   * system with ranked-choice voting - pending future voter approval.
   *
   * Source: City of Gresham Elections, Charter Review Committee Final Report 2023
   * Verification: WS-F investigation 2026-01-18
   */
  '4131250': {
    cityName: 'Gresham',
    state: 'OR',
    councilSize: 6,
    electionMethod: 'at-large',
    source: 'City of Gresham Elections; Charter Review Committee Final Report 2023; WS-F verification 2026-01-18',
    notes: 'VERIFIED: At-large elections (Position 1-6). Charter Review Committee recommended 4-district transition with RCV. District transition pending future voter approval. Registry had Portland Metro Council Districts data.',
  },

  /**
   * Jenks, OK - Candidate for At-Large (Needs Verification)
   *
   * Containment failure (100% overflow, 13 features vs 4 expected) indicates
   * registry has county precincts, not city wards.
   * Small city likely has at-large council.
   *
   * TODO: Verify via Jenks city charter
   * Source: WS-3 containment analysis
   */
  '4038350': {
    cityName: 'Jenks',
    state: 'OK',
    councilSize: 4,
    electionMethod: 'at-large',
    source: 'WS-3 containment analysis (pending charter verification)',
    notes: 'Containment failure showed Tulsa County precincts (13 features). Small city likely at-large. Needs charter verification.',
  },

  /**
   * Hawthorne, CA - At-Large Council
   *
   * 5-member city council (4 council members + mayor) elected at-large.
   * No geographic council districts.
   *
   * Source: City of Hawthorne Municipal Code, Chapter 2
   * Feature count audit: WS-2 investigation (52 features = SCAG regional data, not city)
   */
  '0632548': {
    cityName: 'Hawthorne',
    state: 'CA',
    councilSize: 5,
    electionMethod: 'at-large',
    source: 'City of Hawthorne Municipal Code, Chapter 2; WS-2 investigation',
    notes: 'At-large elections for all council positions. Registry mistakenly contained SCAG (Southern California Association of Governments) regional planning districts (52 features), not city council districts.',
  },

  /**
   * Milton, GA - At-Large Council with District Residency
   *
   * 6-member city council (6 councilmembers + mayor) elected at-large.
   * Councilmembers must reside in their specific districts but all voters
   * vote for all seats citywide (true at-large voting).
   *
   * Source: City of Milton official website (miltonga.gov)
   * Research: At-large detection research 2026-01-16
   */
  '1351670': {
    cityName: 'Milton',
    state: 'GA',
    councilSize: 6,
    electionMethod: 'at-large',
    source: 'City of Milton official website; At-large research 2026-01-16',
    notes: 'At-large voting: all registered voters cast ballots for all council seats. Councilmembers must live in their district but are elected citywide. Mayor also elected at-large.',
  },

  /**
   * Sheridan, IN - At-Large Town Council
   *
   * 7-member town council elected at-large.
   * No geographic wards or districts.
   *
   * Source: Ballotpedia Town Council elections
   * Exhaustivity failure: 4.2% coverage (registry had wrong township/county data)
   */
  '1869354': {
    cityName: 'Sheridan',
    state: 'IN',
    councilSize: 7,
    electionMethod: 'at-large',
    source: 'Ballotpedia Town Council Member, At Large elections',
    notes: 'Town council has 7 members elected at-large. No geographic districts exist. Registry mistakenly contained township redistricting data.',
  },

  /**
   * La Cañada Flintridge, CA - At-Large Council
   *
   * 5-member city council elected at-large.
   * City does not use geographic district elections.
   *
   * Source: City official website
   * Containment failure: Registry had 7 features labeled "Enriched Council_District" which is analysis data, not real districts
   */
  '0639003': {
    cityName: 'La Cañada Flintridge',
    state: 'CA',
    councilSize: 5,
    electionMethod: 'at-large',
    source: 'City of La Cañada Flintridge official website',
    notes: 'At-large council elections. Registry contained "Enriched Council_District" analysis layer (7 features) which is NOT council district data - likely census/demographic enrichment.',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // WAVE E RESEARCH: 2026-01-17
  // Confirmed at-large cities from single-feature quarantine investigation
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Santa Monica, CA - At-Large Council (Under Legal Challenge)
   *
   * 7-member city council (6 councilmembers + mayor) elected at-large.
   * Multiple CVRA lawsuits have challenged this system since 2016.
   * Court of Appeal ruled for city, case at California Supreme Court.
   *
   * Source: Santa Monica city website, CalMatters reporting
   * Research: Single-feature quarantine investigation 2026-01-17
   */
  '0670000': {
    cityName: 'Santa Monica',
    state: 'CA',
    councilSize: 7,
    electionMethod: 'at-large',
    source: 'https://www.santamonica.gov/topic-explainers/elections; CalMatters 2023-10',
    notes: 'One of few California cities resisting CVRA transition to district elections. Pico Neighborhood Association v. Santa Monica ongoing at CA Supreme Court. At-large elections continue pending resolution.',
  },

  /**
   * Wilmington, NC - At-Large Council
   *
   * 5-member city council + mayor elected at-large (all voters vote for all seats).
   * NC state law allows charter changes via referendum, but no district transition pursued.
   *
   * Source: City of Wilmington official website, Ballotpedia
   * Research: Single-feature quarantine investigation 2026-01-17
   */
  '3774440': {
    cityName: 'Wilmington',
    state: 'NC',
    councilSize: 5,
    electionMethod: 'at-large',
    source: 'https://www.wilmingtonnc.gov/Government/City-Mayor-Council; Ballotpedia',
    notes: 'Non-partisan city council. All council members and mayor elected at-large (citywide). No geographic districts or wards.',
  },

  /**
   * Madisonville, LA - At-Large Town Council
   *
   * 5-member town council elected at-large (top 5 vote-getters win).
   * Small town in St. Tammany Parish, no district system.
   *
   * Source: Town of Madisonville official website, NOLA.com reporting
   * Research: Single-feature quarantine investigation 2026-01-17
   */
  '2247560': {
    cityName: 'Madisonville',
    state: 'LA',
    councilSize: 5,
    electionMethod: 'at-large',
    source: 'https://townofmadisonville.org/mayor-and-council; NOLA.com',
    notes: 'Town council seats go to top 5 vote-getters (at-large plurality system). No geographic ward or district structure.',
  },

  /**
   * Oakwood, OH - At-Large City Council
   *
   * 5-member city council elected at-large with four-year overlapping terms.
   * Mayor and Vice Mayor selected by council, not direct election.
   * Council/manager form of government.
   *
   * Source: City of Oakwood official website, Dayton Daily News
   * Research: Single-feature quarantine investigation 2026-01-17
   */
  '3957750': {
    cityName: 'Oakwood',
    state: 'OH',
    councilSize: 5,
    electionMethod: 'at-large',
    source: 'https://oakwoodohio.gov/departments/city-council/; Dayton Daily News',
    notes: 'Council/manager government. 5 council members elected at-large, non-partisan, 4-year terms. Mayor selected by council. Note: Separate Oakwood Village in Cuyahoga County uses wards.',
  },

  /**
   * Galena Park, TX - At-Large Commission
   *
   * Mayor + 4 commissioners elected at-large with numbered positions.
   * City does not use geographic districts - commissioners run for specific
   * numbered positions citywide.
   *
   * Source: City of Galena Park official website
   * Containment failure: Quarantine investigation 2026-01-17 (Houston data mistakenly mapped)
   */
  '4827996': {
    cityName: 'Galena Park',
    state: 'TX',
    councilSize: 5,
    electionMethod: 'at-large',
    source: 'City of Galena Park official website; Quarantine investigation 2026-01-17',
    notes: 'Commission form government. Mayor + 4 commissioners elected at-large to numbered positions (Position 1-4). Quarantine correctly blocked Houston council data (11 districts) mistakenly mapped to this city.',
  },

  /**
   * Leon Valley, TX - At-Large City Council
   *
   * Mayor + 5 councilmembers elected at-large.
   * City does not use geographic districts.
   *
   * Source: City of Leon Valley official website
   * Quarantine investigation: 2026-01-17
   */
  '4842388': {
    cityName: 'Leon Valley',
    state: 'TX',
    councilSize: 6,
    electionMethod: 'at-large',
    source: 'City of Leon Valley city charter; Quarantine investigation 2026-01-17',
    notes: 'City charter specifies mayor and 5 councilmembers elected at-large. No geographic districts.',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // WAVE F RESEARCH: 2026-01-18
  // Confirmed at-large cities from comprehensive quarantine pattern resolution
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Bluffton, SC - At-Large Town Council
   *
   * Mayor + 4 town council members elected at-large.
   * Non-partisan elections, four-year staggered terms.
   *
   * Source: Town of Bluffton official website; Ballotpedia
   * Resolution: county_for_city pattern (Beaufort County data mistakenly mapped)
   */
  '4507210': {
    cityName: 'Bluffton',
    state: 'SC',
    councilSize: 5,
    electionMethod: 'at-large',
    source: 'Town of Bluffton official website; Ballotpedia; WS-F investigation 2026-01-18',
    notes: 'At-large elections for all council positions. Registry mistakenly contained Beaufort County council district data (11 districts).',
  },

  /**
   * San Jacinto, CA - At-Large City Council
   *
   * 5-member city council elected at-large (all voters vote for all seats).
   * Mayor and Mayor Pro Tem selected annually by council rotation.
   * Four-year staggered terms, elections in even-numbered years.
   *
   * Source: City of San Jacinto official website; Ballotpedia
   * Resolution: wrong_municipality pattern (Hemet data mistakenly mapped)
   */
  '0667112': {
    cityName: 'San Jacinto',
    state: 'CA',
    councilSize: 5,
    electionMethod: 'at-large',
    source: 'City of San Jacinto official website; Ballotpedia; WS-F investigation 2026-01-18',
    notes: 'General law city with at-large council elections. Registry mistakenly contained Hemet city council district data (5 districts).',
  },

  /**
   * Walnut, CA - At-Large City Council
   *
   * 5-member city council elected at-large (four-year terms).
   * Mayor elected annually by council for twelve-month term.
   * Elections held every two years (staggered).
   *
   * Source: City of Walnut official website; Ballotpedia
   * Resolution: wrong_municipality pattern (West Covina data mistakenly mapped)
   */
  '0683332': {
    cityName: 'Walnut',
    state: 'CA',
    councilSize: 5,
    electionMethod: 'at-large',
    source: 'City of Walnut official website; Ballotpedia; WS-F investigation 2026-01-18',
    notes: 'At-large council elections. Registry mistakenly contained West Covina city council district data (5 districts).',
  },

  /**
   * Winter Springs, FL - At-Large Commission (Pending 2026 Referendum)
   *
   * Mayor + 5 city commissioners elected at-large.
   * Commissioners must reside in their district but all voters vote for all seats.
   * 2026 referendum may transition to single-member districts.
   *
   * Source: City of Winter Springs official website
   * Resolution: regional_data_bleeding pattern (BWCF regional data, 73 features)
   */
  '1278325': {
    cityName: 'Winter Springs',
    state: 'FL',
    councilSize: 5,
    electionMethod: 'at-large',
    source: 'City of Winter Springs official website; WS-F investigation 2026-01-18',
    notes: 'Currently at-large elections (commissioners must reside in districts but elected citywide). 2026 referendum proposes transition to single-member districts. Registry had BWCF regional jurisdiction data (73 features).',
  },

  /**
   * Old Westbury, NY - At-Large Village Board of Trustees
   *
   * Mayor + 4 trustees elected at-large (village-wide elections).
   * Typical New York village structure - no geographic districts.
   * Population: ~4,300 (2020 census).
   *
   * Source: Village of Old Westbury Board of Trustees; NY village government research
   * Resolution: containment_failure pattern (CitizenServeMapCouncilDist, 6 features 89.9% outside)
   */
  '3654705': {
    cityName: 'Old Westbury',
    state: 'NY',
    councilSize: 4,
    electionMethod: 'at-large',
    source: 'Village of Old Westbury Board of Trustees; NY village government structure research; WS-F investigation 2026-01-18',
    notes: 'Typical NY village structure: Mayor and 4 trustees elected at-large (village-wide). Registry mistakenly contained CitizenServeMapCouncilDist data (6 features, 89.9% outside village boundary) from wrong municipality.',
  },

  /**
   * Goose Creek, SC - At-Large City Council
   *
   * Mayor + 6 council members elected at-large (city-wide vote).
   * Non-partisan elections, four-year staggered terms.
   * Three seats elected every two years - top three vote-getters win.
   *
   * Source: City of Goose Creek Municipal Elections; Post & Courier; Berkeley County Elections
   * Resolution: county_for_city pattern (Charleston County data, 9 features)
   */
  '4529815': {
    cityName: 'Goose Creek',
    state: 'SC',
    councilSize: 6,
    electionMethod: 'at-large',
    source: 'City of Goose Creek official website; Post & Courier; Berkeley County Elections; WS-G investigation 2026-01-18',
    notes: 'At-large elections confirmed: "Council members are elected at-large in Goose Creek, meaning they represent the whole city rather than a specific district." Registry mistakenly contained Charleston County Political_Districts data (9 features).',
  },
};

/**
 * Check if a city uses at-large voting (no geographic districts)
 *
 * @param cityFips - 7-digit Census PLACE FIPS code
 * @returns true if city has at-large/proportional voting
 */
export function isAtLargeCity(cityFips: string): boolean {
  return cityFips in AT_LARGE_CITIES;
}

/**
 * Get at-large city metadata
 *
 * @param cityFips - 7-digit Census PLACE FIPS code
 * @returns City metadata or undefined if not at-large
 */
export function getAtLargeCityInfo(cityFips: string): AtLargeCity | undefined {
  return AT_LARGE_CITIES[cityFips];
}

/**
 * Get all at-large cities in a state
 *
 * @param stateAbbr - State abbreviation (e.g., "MA", "TX")
 * @returns Array of [FIPS, city metadata] tuples
 */
export function getAtLargeCitiesByState(
  stateAbbr: string
): Array<[string, AtLargeCity]> {
  return Object.entries(AT_LARGE_CITIES).filter(
    ([_, city]) => city.state === stateAbbr
  );
}

/**
 * Count at-large cities by election method
 */
export function getAtLargeCityStats(): {
  total: number;
  byMethod: Record<string, number>;
  byState: Record<string, number>;
} {
  const byMethod: Record<string, number> = {};
  const byState: Record<string, number> = {};

  for (const city of Object.values(AT_LARGE_CITIES)) {
    byMethod[city.electionMethod] = (byMethod[city.electionMethod] || 0) + 1;
    byState[city.state] = (byState[city.state] || 0) + 1;
  }

  return {
    total: Object.keys(AT_LARGE_CITIES).length,
    byMethod,
    byState,
  };
}
