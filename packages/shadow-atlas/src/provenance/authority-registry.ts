/**
 * Authority Registry for Shadow Atlas Data Freshness System
 *
 * Maps boundary types to their legal authorities and tracks both primary
 * sources (authoritative) and aggregator sources (convenience, may lag).
 *
 * CORE PRINCIPLE: `freshest_primary > freshest_aggregator`
 *
 * Census TIGER is an AGGREGATOR, not an authority. During redistricting
 * cycles (2021-2022, 2031-2032), TIGER lags 6-18 months behind authoritative
 * sources.
 *
 * WP-FRESHNESS-1: Authority Registry Implementation
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Boundary types supported by the registry
 *
 * NOTE: Provenance subsystem uses simplified naming convention for internal
 * data freshness tracking. Maps conceptually to canonical BoundaryType enum
 * in ../types/boundary.ts but with different string literal values.
 *
 * See tiger-authority-rules.ts for complete mapping documentation.
 */
export type BoundaryType =
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
 * Update trigger types
 */
export type UpdateTrigger =
  | { readonly type: 'annual'; readonly month: number }
  | { readonly type: 'redistricting'; readonly years: readonly number[] }
  | { readonly type: 'census'; readonly year: number }
  | { readonly type: 'event'; readonly description: string }
  | { readonly type: 'manual' };

/**
 * Primary source (authoritative)
 */
export interface PrimarySource {
  readonly name: string;
  readonly entity: string;
  readonly jurisdiction: string;
  readonly url: string | null;
  readonly format: 'geojson' | 'shapefile' | 'kml' | 'pdf' | 'unknown';
  readonly machineReadable: boolean;
}

/**
 * Aggregator source (convenience, may lag)
 */
export interface AggregatorSource {
  readonly name: string;
  readonly url: string;
  readonly urlTemplate: string;
  readonly format: 'shapefile' | 'geojson';
  readonly lag: string;
  readonly releaseMonth: number;
}

/**
 * Authority entry for a boundary type
 */
export interface AuthorityEntry {
  readonly boundaryType: BoundaryType;
  readonly displayName: string;
  readonly authorityEntity: string;
  readonly legalBasis: string;
  readonly primarySources: readonly PrimarySource[];
  readonly aggregatorSources: readonly AggregatorSource[];
  readonly updateTriggers: readonly UpdateTrigger[];
  readonly expectedLag: {
    readonly normal: string;
    readonly redistricting: string;
  };
}

// ============================================================================
// Registry Data
// ============================================================================

/**
 * State redistricting commission URLs (top 10 by population)
 */
const STATE_REDISTRICTING_URLS: Record<string, string> = {
  CA: 'https://www.wedrawthelinesca.org/',
  TX: 'https://redistricting.capitol.texas.gov/',
  FL: 'https://www.flsenate.gov/Session/Redistricting',
  NY: 'https://www.nyirc.gov/',
  PA: 'https://www.redistricting.state.pa.us/',
  IL: 'https://ilhousedems.com/redistricting/',
  OH: 'https://www.redistricting.ohio.gov/',
  GA: 'https://www.legis.ga.gov/joint-office/reapportionment',
  NC: 'https://www.ncleg.gov/Redistricting',
  MI: 'https://www.michigan.gov/micrc',
};

/**
 * TIGER URL templates by boundary type
 */
const TIGER_URL_TEMPLATES: Record<BoundaryType, string> = {
  congressional: 'https://www2.census.gov/geo/tiger/TIGER{YEAR}/CD/',
  state_senate: 'https://www2.census.gov/geo/tiger/TIGER{YEAR}/SLDU/',
  state_house: 'https://www2.census.gov/geo/tiger/TIGER{YEAR}/SLDL/',
  county: 'https://www2.census.gov/geo/tiger/TIGER{YEAR}/COUNTY/',
  place: 'https://www2.census.gov/geo/tiger/TIGER{YEAR}/PLACE/',
  school_unified: 'https://www2.census.gov/geo/tiger/TIGER{YEAR}/UNSD/',
  city_council: '',
  voting_precinct: '',
  special_district: '',
};

/**
 * Redistricting years (post-census cycles)
 */
const REDISTRICTING_YEARS = [2021, 2022, 2031, 2032, 2041, 2042] as const;

/**
 * Authority registry data
 */
const AUTHORITY_DATA: Record<BoundaryType, AuthorityEntry> = {
  congressional: {
    boundaryType: 'congressional',
    displayName: 'US Congressional Districts',
    authorityEntity: 'State Legislature or Independent Commission',
    legalBasis: 'US Constitution Article I, Section 4',
    primarySources: [
      {
        name: 'CA Citizens Redistricting Commission',
        entity: 'California Citizens Redistricting Commission',
        jurisdiction: 'CA',
        url: STATE_REDISTRICTING_URLS.CA,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'TX Legislative Council',
        entity: 'Texas Legislative Council',
        jurisdiction: 'TX',
        url: STATE_REDISTRICTING_URLS.TX,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'FL Legislature',
        entity: 'Florida Legislature',
        jurisdiction: 'FL',
        url: STATE_REDISTRICTING_URLS.FL,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'NY Independent Redistricting Commission',
        entity: 'New York Independent Redistricting Commission',
        jurisdiction: 'NY',
        url: STATE_REDISTRICTING_URLS.NY,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'PA Legislative Reapportionment Commission',
        entity: 'Pennsylvania Legislative Reapportionment Commission',
        jurisdiction: 'PA',
        url: STATE_REDISTRICTING_URLS.PA,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'IL General Assembly',
        entity: 'Illinois General Assembly',
        jurisdiction: 'IL',
        url: STATE_REDISTRICTING_URLS.IL,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'OH Redistricting Commission',
        entity: 'Ohio Redistricting Commission',
        jurisdiction: 'OH',
        url: STATE_REDISTRICTING_URLS.OH,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'GA General Assembly',
        entity: 'Georgia General Assembly',
        jurisdiction: 'GA',
        url: STATE_REDISTRICTING_URLS.GA,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'NC General Assembly',
        entity: 'North Carolina General Assembly',
        jurisdiction: 'NC',
        url: STATE_REDISTRICTING_URLS.NC,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'MI Independent Citizens Redistricting Commission',
        entity: 'Michigan Independent Citizens Redistricting Commission',
        jurisdiction: 'MI',
        url: STATE_REDISTRICTING_URLS.MI,
        format: 'shapefile',
        machineReadable: true,
      },
    ],
    aggregatorSources: [
      {
        name: 'Census TIGER',
        url: 'https://www2.census.gov/geo/tiger/',
        urlTemplate: TIGER_URL_TEMPLATES.congressional,
        format: 'shapefile',
        lag: '6-18 months during redistricting',
        releaseMonth: 7,
      },
    ],
    updateTriggers: [
      { type: 'redistricting', years: REDISTRICTING_YEARS },
      { type: 'annual', month: 7 },
    ],
    expectedLag: {
      normal: '0-3 months',
      redistricting: '6-18 months for TIGER',
    },
  },

  state_senate: {
    boundaryType: 'state_senate',
    displayName: 'State Senate Districts',
    authorityEntity: 'State Legislature',
    legalBasis: 'State Constitution',
    primarySources: [
      {
        name: 'CA Citizens Redistricting Commission',
        entity: 'California Citizens Redistricting Commission',
        jurisdiction: 'CA',
        url: STATE_REDISTRICTING_URLS.CA,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'TX Legislative Council',
        entity: 'Texas Legislative Council',
        jurisdiction: 'TX',
        url: STATE_REDISTRICTING_URLS.TX,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'FL Legislature',
        entity: 'Florida Legislature',
        jurisdiction: 'FL',
        url: STATE_REDISTRICTING_URLS.FL,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'NY Independent Redistricting Commission',
        entity: 'New York Independent Redistricting Commission',
        jurisdiction: 'NY',
        url: STATE_REDISTRICTING_URLS.NY,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'PA Legislative Reapportionment Commission',
        entity: 'Pennsylvania Legislative Reapportionment Commission',
        jurisdiction: 'PA',
        url: STATE_REDISTRICTING_URLS.PA,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'IL General Assembly',
        entity: 'Illinois General Assembly',
        jurisdiction: 'IL',
        url: STATE_REDISTRICTING_URLS.IL,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'OH Redistricting Commission',
        entity: 'Ohio Redistricting Commission',
        jurisdiction: 'OH',
        url: STATE_REDISTRICTING_URLS.OH,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'GA General Assembly',
        entity: 'Georgia General Assembly',
        jurisdiction: 'GA',
        url: STATE_REDISTRICTING_URLS.GA,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'NC General Assembly',
        entity: 'North Carolina General Assembly',
        jurisdiction: 'NC',
        url: STATE_REDISTRICTING_URLS.NC,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'MI Independent Citizens Redistricting Commission',
        entity: 'Michigan Independent Citizens Redistricting Commission',
        jurisdiction: 'MI',
        url: STATE_REDISTRICTING_URLS.MI,
        format: 'shapefile',
        machineReadable: true,
      },
    ],
    aggregatorSources: [
      {
        name: 'Census TIGER SLDU',
        url: 'https://www2.census.gov/geo/tiger/',
        urlTemplate: TIGER_URL_TEMPLATES.state_senate,
        format: 'shapefile',
        lag: '6-18 months during redistricting',
        releaseMonth: 7,
      },
    ],
    updateTriggers: [
      { type: 'redistricting', years: REDISTRICTING_YEARS },
      { type: 'annual', month: 7 },
    ],
    expectedLag: {
      normal: '0-3 months',
      redistricting: '6-18 months for TIGER',
    },
  },

  state_house: {
    boundaryType: 'state_house',
    displayName: 'State House Districts',
    authorityEntity: 'State Legislature',
    legalBasis: 'State Constitution',
    primarySources: [
      {
        name: 'CA Citizens Redistricting Commission',
        entity: 'California Citizens Redistricting Commission',
        jurisdiction: 'CA',
        url: STATE_REDISTRICTING_URLS.CA,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'TX Legislative Council',
        entity: 'Texas Legislative Council',
        jurisdiction: 'TX',
        url: STATE_REDISTRICTING_URLS.TX,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'FL Legislature',
        entity: 'Florida Legislature',
        jurisdiction: 'FL',
        url: STATE_REDISTRICTING_URLS.FL,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'NY Independent Redistricting Commission',
        entity: 'New York Independent Redistricting Commission',
        jurisdiction: 'NY',
        url: STATE_REDISTRICTING_URLS.NY,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'PA Legislative Reapportionment Commission',
        entity: 'Pennsylvania Legislative Reapportionment Commission',
        jurisdiction: 'PA',
        url: STATE_REDISTRICTING_URLS.PA,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'IL General Assembly',
        entity: 'Illinois General Assembly',
        jurisdiction: 'IL',
        url: STATE_REDISTRICTING_URLS.IL,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'OH Redistricting Commission',
        entity: 'Ohio Redistricting Commission',
        jurisdiction: 'OH',
        url: STATE_REDISTRICTING_URLS.OH,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'GA General Assembly',
        entity: 'Georgia General Assembly',
        jurisdiction: 'GA',
        url: STATE_REDISTRICTING_URLS.GA,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'NC General Assembly',
        entity: 'North Carolina General Assembly',
        jurisdiction: 'NC',
        url: STATE_REDISTRICTING_URLS.NC,
        format: 'shapefile',
        machineReadable: true,
      },
      {
        name: 'MI Independent Citizens Redistricting Commission',
        entity: 'Michigan Independent Citizens Redistricting Commission',
        jurisdiction: 'MI',
        url: STATE_REDISTRICTING_URLS.MI,
        format: 'shapefile',
        machineReadable: true,
      },
    ],
    aggregatorSources: [
      {
        name: 'Census TIGER SLDL',
        url: 'https://www2.census.gov/geo/tiger/',
        urlTemplate: TIGER_URL_TEMPLATES.state_house,
        format: 'shapefile',
        lag: '6-18 months during redistricting',
        releaseMonth: 7,
      },
    ],
    updateTriggers: [
      { type: 'redistricting', years: REDISTRICTING_YEARS },
      { type: 'annual', month: 7 },
    ],
    expectedLag: {
      normal: '0-3 months',
      redistricting: '6-18 months for TIGER',
    },
  },

  county: {
    boundaryType: 'county',
    displayName: 'County Boundaries',
    authorityEntity: 'State',
    legalBasis: 'State Constitution / State Statutes',
    primarySources: [],
    aggregatorSources: [
      {
        name: 'Census TIGER COUNTY',
        url: 'https://www2.census.gov/geo/tiger/',
        urlTemplate: TIGER_URL_TEMPLATES.county,
        format: 'shapefile',
        lag: '0-3 months',
        releaseMonth: 7,
      },
    ],
    updateTriggers: [
      { type: 'annual', month: 7 },
      { type: 'event', description: 'County boundary changes (rare)' },
    ],
    expectedLag: {
      normal: '0-3 months',
      redistricting: '0-3 months',
    },
  },

  place: {
    boundaryType: 'place',
    displayName: 'Places (Incorporated + CDPs)',
    authorityEntity: 'State',
    legalBasis: 'State Municipal Incorporation Laws',
    primarySources: [],
    aggregatorSources: [
      {
        name: 'Census TIGER PLACE',
        url: 'https://www2.census.gov/geo/tiger/',
        urlTemplate: TIGER_URL_TEMPLATES.place,
        format: 'shapefile',
        lag: '0-3 months',
        releaseMonth: 7,
      },
    ],
    updateTriggers: [{ type: 'annual', month: 7 }],
    expectedLag: {
      normal: '0-3 months',
      redistricting: '0-3 months',
    },
  },

  city_council: {
    boundaryType: 'city_council',
    displayName: 'City Council Districts',
    authorityEntity: 'City Council',
    legalBasis: 'Municipal Code / City Charter',
    primarySources: [],
    aggregatorSources: [],
    updateTriggers: [
      { type: 'redistricting', years: REDISTRICTING_YEARS },
      { type: 'event', description: 'Post-redistricting ordinance' },
    ],
    expectedLag: {
      normal: 'Varies by city',
      redistricting: 'Varies by city',
    },
  },

  school_unified: {
    boundaryType: 'school_unified',
    displayName: 'Unified School Districts',
    authorityEntity: 'State Education Agency',
    legalBasis: 'State Education Code',
    primarySources: [],
    aggregatorSources: [
      {
        name: 'Census TIGER UNSD',
        url: 'https://www2.census.gov/geo/tiger/',
        urlTemplate: TIGER_URL_TEMPLATES.school_unified,
        format: 'shapefile',
        lag: '0-3 months',
        releaseMonth: 7,
      },
    ],
    updateTriggers: [{ type: 'annual', month: 7 }],
    expectedLag: {
      normal: '0-3 months',
      redistricting: '0-3 months',
    },
  },

  voting_precinct: {
    boundaryType: 'voting_precinct',
    displayName: 'Voting Precincts',
    authorityEntity: 'County Elections Office',
    legalBasis: 'State Election Code',
    primarySources: [],
    aggregatorSources: [],
    updateTriggers: [
      { type: 'redistricting', years: REDISTRICTING_YEARS },
      { type: 'event', description: 'Post-election precinct consolidation' },
    ],
    expectedLag: {
      normal: 'Varies by county',
      redistricting: 'Varies by county',
    },
  },

  special_district: {
    boundaryType: 'special_district',
    displayName: 'Special Districts',
    authorityEntity: 'Varies (state/county/municipal)',
    legalBasis: 'Varies by district type',
    primarySources: [],
    aggregatorSources: [],
    updateTriggers: [{ type: 'event', description: 'Formation/dissolution' }],
    expectedLag: {
      normal: 'Varies by district',
      redistricting: 'Varies by district',
    },
  },
};

// ============================================================================
// Authority Registry Class
// ============================================================================

/**
 * Authority Registry
 *
 * Maps boundary types to their legal authorities and tracks both primary
 * sources (authoritative) and aggregator sources (convenience, may lag).
 */
export class AuthorityRegistry {
  private readonly entries: Map<BoundaryType, AuthorityEntry>;

  constructor() {
    this.entries = new Map(
      Object.entries(AUTHORITY_DATA) as Array<[BoundaryType, AuthorityEntry]>
    );
  }

  /**
   * Get authority configuration for a boundary type
   */
  getAuthority(boundaryType: BoundaryType): AuthorityEntry {
    const entry = this.entries.get(boundaryType);
    if (!entry) {
      throw new Error(`No authority entry found for boundary type: ${boundaryType}`);
    }
    return entry;
  }

  /**
   * Get all primary sources for a state
   */
  getPrimarySourcesForState(state: string): PrimarySource[] {
    const sources: PrimarySource[] = [];

    for (const entry of Array.from(this.entries.values())) {
      for (const source of entry.primarySources) {
        if (source.jurisdiction === state || source.jurisdiction === '*') {
          sources.push(source);
        }
      }
    }

    return sources;
  }

  /**
   * Check if we're in a redistricting window
   * Returns true for years [2021, 2022, 2031, 2032, 2041, 2042]
   */
  isRedistrictingWindow(year?: number): boolean {
    const currentYear = year ?? new Date().getFullYear();
    return REDISTRICTING_YEARS.includes(currentYear as typeof REDISTRICTING_YEARS[number]);
  }

  /**
   * Get aggregator sources for a boundary type
   */
  getAggregatorSources(boundaryType: BoundaryType): readonly AggregatorSource[] {
    const entry = this.entries.get(boundaryType);
    if (!entry) {
      throw new Error(`No authority entry found for boundary type: ${boundaryType}`);
    }
    return entry.aggregatorSources;
  }

  /**
   * Get all boundary types
   */
  getBoundaryTypes(): readonly BoundaryType[] {
    return Array.from(this.entries.keys());
  }

  /**
   * Check if a boundary type has primary sources
   */
  hasPrimarySources(boundaryType: BoundaryType): boolean {
    const entry = this.entries.get(boundaryType);
    return entry ? entry.primarySources.length > 0 : false;
  }

  /**
   * Get all states with primary sources
   */
  getStatesWithPrimarySources(): readonly string[] {
    const states = new Set<string>();

    for (const entry of Array.from(this.entries.values())) {
      for (const source of entry.primarySources) {
        if (source.jurisdiction !== '*') {
          states.add(source.jurisdiction);
        }
      }
    }

    return Array.from(states).sort();
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Singleton instance of the Authority Registry
 */
export const authorityRegistry = new AuthorityRegistry();
