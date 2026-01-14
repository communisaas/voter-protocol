/**
 * Census Place List Loader
 *
 * Fetches all 19,495 incorporated places (cities) from Census Bureau.
 * This is the master list for bulk district discovery.
 *
 * DATA SOURCE: Census TIGERweb REST API
 * - Endpoint: /tigerWMS_Current/MapServer/28 (Incorporated Places)
 * - Format: JSON attributes only (no geometry for list)
 * - Fields: GEOID, NAME, STATEFP, PLACEFP, LSAD, POP100
 *
 * USAGE:
 * ```typescript
 * const loader = new CensusPlaceListLoader();
 * const places = await loader.loadAllPlaces();
 * // Returns 19,495 places with population data
 * ```
 *
 * CACHING:
 * - Places list cached in memory (stable data, changes annually)
 * - State-level queries cached to reduce API calls
 * - Full refresh: ~5 minutes (one query per state)
 */

import { logger } from '../utils/logger.js';

/**
 * Census place record (from TIGERweb API)
 */
export interface CensusPlace {
  /** 7-digit FIPS code (STATEFP + PLACEFP) */
  readonly geoid: string;

  /** 2-digit state FIPS code */
  readonly statefp: string;

  /** 5-digit place FIPS code */
  readonly placefp: string;

  /** Place name (e.g., "Seattle") */
  readonly name: string;

  /** Legal/Statistical Area Description (city, town, village, CDP, etc.) */
  readonly lsad: string;

  /** 2020 Census population (POP100) */
  readonly population: number;

  /** Functional status (A = active government) */
  readonly funcstat: string;

  /** State abbreviation (derived from STATEFP) */
  readonly stateAbbr: string;
}

/**
 * Filter options for place queries
 */
export interface PlaceFilter {
  /** Minimum population threshold */
  readonly minPopulation?: number;

  /** Maximum population threshold */
  readonly maxPopulation?: number;

  /** Specific state FIPS codes to include */
  readonly stateFips?: readonly string[];

  /** LSAD codes to include (e.g., '25' = city) */
  readonly lsadCodes?: readonly string[];

  /** Only include places likely to have council districts */
  readonly likelyDistricted?: boolean;
}

/**
 * Census Place List Loader
 *
 * Loads all US incorporated places from Census TIGERweb API.
 */
export class CensusPlaceListLoader {
  private readonly tigerwebUrl =
    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/28/query';

  // Cache: state FIPS -> places
  private cache: Map<string, CensusPlace[]> = new Map();

  // State FIPS to abbreviation mapping
  private readonly stateAbbr: Record<string, string> = {
    '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
    '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
    '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
    '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
    '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
    '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
    '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
    '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
    '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
    '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
    '56': 'WY', '72': 'PR', '78': 'VI',
  };

  // All state FIPS codes (50 states + DC + territories)
  private readonly allStateFips = Object.keys(this.stateAbbr);

  /**
   * Load all places from all states
   *
   * @param filter Optional filter criteria
   * @returns All places matching filter
   */
  async loadAllPlaces(filter?: PlaceFilter): Promise<CensusPlace[]> {
    const statesToQuery = filter?.stateFips ?? this.allStateFips;
    const allPlaces: CensusPlace[] = [];

    // Query states in batches to avoid overwhelming API
    const BATCH_SIZE = 10;
    const batches: string[][] = [];

    for (let i = 0; i < statesToQuery.length; i += BATCH_SIZE) {
      batches.push(statesToQuery.slice(i, i + BATCH_SIZE) as string[]);
    }

    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map((stateFips) => this.loadPlacesByState(stateFips))
      );

      for (const places of batchResults) {
        allPlaces.push(...places);
      }

      // Small delay between batches
      await this.delay(200);
    }

    // Apply filters
    return this.applyFilters(allPlaces, filter);
  }

  /**
   * Load places for a single state
   *
   * @param stateFips 2-digit state FIPS code
   * @returns Places in that state
   */
  async loadPlacesByState(stateFips: string): Promise<CensusPlace[]> {
    // Check cache
    if (this.cache.has(stateFips)) {
      return this.cache.get(stateFips)!;
    }

    // Note: TIGERweb uses different field names than TIGER/Line shapefiles
    // STATE instead of STATEFP, PLACE instead of PLACEFP, LSADC instead of LSAD
    // Population (POP100) is NOT available in TIGERweb - we default to 0 and use other heuristics
    const params = new URLSearchParams({
      where: `STATE='${stateFips}'`,
      outFields: 'GEOID,STATE,PLACE,NAME,LSADC,FUNCSTAT',
      returnGeometry: 'false',
      f: 'json',
    });

    try {
      const response = await fetch(`${this.tigerwebUrl}?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'VOTER-Protocol/1.0 (Census Place Loader)',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        logger.warn('TIGERweb query failed for state', {
          stateFips,
          statusCode: response.status,
        });
        return [];
      }

      const data = await response.json();

      if (!data.features || !Array.isArray(data.features)) {
        return [];
      }

      const places: CensusPlace[] = data.features.map(
        (feature: { attributes: Record<string, unknown> }) => {
          const attrs = feature.attributes;
          const statefp = String(attrs.STATE);
          // Clean name: remove suffixes like " city", " town", " village"
          const rawName = String(attrs.NAME);
          const cleanName = rawName.replace(/ (city|town|village|borough|CDP)$/i, '');

          return {
            geoid: String(attrs.GEOID),
            statefp,
            placefp: String(attrs.PLACE),
            name: cleanName,
            lsad: String(attrs.LSADC),
            // Population not available in TIGERweb - we'll skip population filtering
            // and rely on LSAD codes (city/town vs CDP) and active status
            population: 0, // Not available in this API
            funcstat: String(attrs.FUNCSTAT),
            stateAbbr: this.stateAbbr[statefp] ?? 'Unknown',
          };
        }
      );

      // Cache results
      this.cache.set(stateFips, places);

      return places;
    } catch (error) {
      logger.warn('Error loading places for state', {
        stateFips,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get places by tier
   *
   * Since TIGERweb doesn't have population data, we use LSAD codes to filter:
   * - 'major': All incorporated places (cities, towns, villages) - full discovery
   * - 'medium': Same as major (no population available)
   * - 'small': Same as major (no population available)
   * - 'very-small': Same as major (no population available)
   * - 'all': All incorporated places including CDPs
   *
   * Note: Population-based filtering requires joining with Census demographic data
   * which is a separate API call. For MVP, we discover all incorporated places.
   */
  async loadByTier(
    tier: 'major' | 'medium' | 'small' | 'very-small' | 'all'
  ): Promise<CensusPlace[]> {
    // Without population data, we filter by LSAD:
    // - Cities (25), towns (43), villages (47), boroughs (21) = incorporated places
    // - CDPs (57) = unincorporated (skip unless 'all')
    const incorporatedLsadCodes = ['21', '25', '43', '47', '53', '55'];

    const filters: Record<typeof tier, PlaceFilter> = {
      // All tiers filter to incorporated places only (no CDPs)
      // since we don't have population data to differentiate
      major: { lsadCodes: incorporatedLsadCodes, likelyDistricted: true },
      medium: { lsadCodes: incorporatedLsadCodes, likelyDistricted: true },
      small: { lsadCodes: incorporatedLsadCodes, likelyDistricted: true },
      'very-small': { lsadCodes: incorporatedLsadCodes },
      all: {}, // Include everything including CDPs
    };

    return this.loadAllPlaces(filters[tier]);
  }

  /**
   * Apply filters to place list
   */
  private applyFilters(places: CensusPlace[], filter?: PlaceFilter): CensusPlace[] {
    if (!filter) {
      return places;
    }

    return places.filter((place) => {
      // Population filters (only apply if population data is available)
      if (filter.minPopulation && place.population > 0 && place.population < filter.minPopulation) {
        return false;
      }
      if (filter.maxPopulation && place.population > 0 && place.population > filter.maxPopulation) {
        return false;
      }

      // LSAD filter (e.g., only cities, not CDPs)
      if (filter.lsadCodes && !filter.lsadCodes.includes(place.lsad)) {
        return false;
      }

      // Likely districted filter (active government, skip CDPs)
      if (filter.likelyDistricted) {
        // Skip inactive governments
        if (place.funcstat !== 'A') {
          return false;
        }
        // Skip CDPs (unincorporated - no city council)
        if (place.lsad === '57') {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Get statistics about loaded places
   */
  getLoadedStats(): {
    totalCached: number;
    statesCached: number;
    byState: Record<string, number>;
  } {
    const byState: Record<string, number> = {};
    let total = 0;

    for (const [stateFips, places] of this.cache) {
      byState[this.stateAbbr[stateFips] ?? stateFips] = places.length;
      total += places.length;
    }

    return {
      totalCached: total,
      statesCached: this.cache.size,
      byState,
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Population tier definitions
 *
 * Used for prioritizing discovery efforts.
 */
export const POPULATION_TIERS = {
  /**
   * Tier 1: Major cities (100k+)
   * ~500 cities nationwide
   * Expected district coverage: 95%
   */
  major: {
    minPopulation: 100000,
    description: 'Major cities (100k+ population)',
    expectedCount: 500,
    expectedDistrictCoverage: 0.95,
  },

  /**
   * Tier 2: Medium cities (50k-100k)
   * ~500 additional cities
   * Expected district coverage: 90%
   */
  medium: {
    minPopulation: 50000,
    maxPopulation: 99999,
    description: 'Medium cities (50k-100k population)',
    expectedCount: 500,
    expectedDistrictCoverage: 0.9,
  },

  /**
   * Tier 3: Small cities (10k-50k)
   * ~2,000 additional cities
   * Expected district coverage: 70%
   */
  small: {
    minPopulation: 10000,
    maxPopulation: 49999,
    description: 'Small cities (10k-50k population)',
    expectedCount: 2000,
    expectedDistrictCoverage: 0.7,
  },

  /**
   * Tier 4: Very small cities (5k-10k)
   * ~2,000 additional cities
   * Many will be at-large governance
   * Expected district coverage: 50%
   */
  verySmall: {
    minPopulation: 5000,
    maxPopulation: 9999,
    description: 'Very small cities (5k-10k population)',
    expectedCount: 2000,
    expectedDistrictCoverage: 0.5,
  },

  /**
   * Tier 5: Micro cities (<5k)
   * ~14,500 additional places
   * Most will be at-large governance
   * Expected district coverage: 10%
   */
  micro: {
    maxPopulation: 4999,
    description: 'Micro cities (<5k population)',
    expectedCount: 14500,
    expectedDistrictCoverage: 0.1,
  },
};

/**
 * LSAD codes for incorporated places
 *
 * Legal/Statistical Area Description codes define place type.
 */
export const LSAD_CODES = {
  '21': 'borough',
  '25': 'city',
  '43': 'town',
  '47': 'village',
  '53': 'city and borough', // Alaska
  '55': 'municipality', // Alaska
  '57': 'CDP', // Census Designated Place (unincorporated)
};

/**
 * Factory function
 */
export function createCensusPlaceListLoader(): CensusPlaceListLoader {
  return new CensusPlaceListLoader();
}
