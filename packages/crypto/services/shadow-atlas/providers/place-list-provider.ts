/**
 * Place List Provider Interface
 *
 * Country-agnostic abstraction for loading administrative places.
 * Each country implements this interface with their authoritative data source.
 *
 * Examples:
 * - US: Census Bureau TIGERweb API (19,495 incorporated places)
 * - Canada: Statistics Canada boundary files (5,162 census subdivisions)
 * - UK: ONS Geography Portal (9,000+ electoral wards)
 * - Australia: ABS administrative boundaries (565 LGAs)
 *
 * This abstraction enables the same discovery pipeline to work globally
 * by swapping the PlaceListProvider implementation per country.
 */

/**
 * ISO 3166-1 alpha-2 country codes we support
 */
export type SupportedCountry =
  | 'US'  // United States
  | 'CA'  // Canada
  | 'GB'  // United Kingdom
  | 'AU'  // Australia
  | 'NZ'  // New Zealand
  | 'DE'  // Germany
  | 'FR'  // France
  | 'ES'  // Spain
  | 'IT'  // Italy
  | 'NL'  // Netherlands
  | 'BR'  // Brazil
  | 'MX'  // Mexico
  | 'IN'  // India
  | 'JP'; // Japan

/**
 * Administrative level in ISO hierarchy
 * Maps to different names per country
 */
export type AdministrativeLevel =
  | 'country'           // ADM0: Nation state
  | 'region'            // ADM1: State, province, territory, land
  | 'department'        // ADM2: County, department, prefecture, district
  | 'municipality'      // ADM3: City, town, commune, municipality
  | 'ward'              // ADM4: Ward, electoral district, arrondissement
  | 'precinct';         // ADM5: Voting precinct, polling district

/**
 * Generic place record (country-agnostic)
 */
export interface Place {
  /** Unique identifier (format varies by country) */
  readonly id: string;

  /** ISO 3166-1 alpha-2 country code */
  readonly countryCode: SupportedCountry;

  /** Region code within country (ISO 3166-2 subdivision) */
  readonly regionCode: string;

  /** Place name (localized) */
  readonly name: string;

  /** Administrative level */
  readonly adminLevel: AdministrativeLevel;

  /** Population (0 if unknown) */
  readonly population: number;

  /** Whether this place has active governance (city council, etc.) */
  readonly hasActiveGovernance: boolean;

  /** Place type in local terminology (city, town, commune, etc.) */
  readonly localType: string;

  /** Centroid coordinates (optional) */
  readonly centroid?: {
    readonly lat: number;
    readonly lng: number;
  };
}

/**
 * Filter options for place queries
 */
export interface PlaceFilter {
  /** Minimum population threshold */
  readonly minPopulation?: number;

  /** Maximum population threshold */
  readonly maxPopulation?: number;

  /** Specific region codes to include */
  readonly regionCodes?: readonly string[];

  /** Administrative levels to include */
  readonly adminLevels?: readonly AdministrativeLevel[];

  /** Only places with active governance */
  readonly activeGovernanceOnly?: boolean;
}

/**
 * Place List Provider Interface
 *
 * Abstract interface for loading places from any country's authoritative source.
 */
export interface PlaceListProvider {
  /** ISO 3166-1 alpha-2 country code */
  readonly countryCode: SupportedCountry;

  /** Human-readable name of data source */
  readonly sourceName: string;

  /** URL of authoritative data source */
  readonly sourceUrl: string;

  /** Last update timestamp of source data */
  readonly lastUpdated: Date | null;

  /**
   * Load all places from the country
   *
   * @param filter Optional filter criteria
   * @returns All places matching filter
   */
  loadAllPlaces(filter?: PlaceFilter): Promise<Place[]>;

  /**
   * Load places for a specific region (state/province)
   *
   * @param regionCode ISO 3166-2 subdivision code (e.g., 'US-CA', 'CA-ON', 'GB-ENG')
   * @returns Places in that region
   */
  loadPlacesByRegion(regionCode: string): Promise<Place[]>;

  /**
   * Get count of places without loading full data
   *
   * @param filter Optional filter criteria
   * @returns Count of places matching filter
   */
  getPlaceCount(filter?: PlaceFilter): Promise<number>;

  /**
   * Check if data source is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Clear any cached data
   */
  clearCache(): void;
}

/**
 * Country-specific place statistics
 */
export interface CountryPlaceStats {
  readonly countryCode: SupportedCountry;
  readonly totalPlaces: number;
  readonly municipalitiesWithCouncils: number;
  readonly averagePopulation: number;
  readonly dataSource: string;
  readonly lastUpdated: Date | null;
}

/**
 * Registry of implemented PlaceListProviders
 */
export const PLACE_LIST_PROVIDERS: Record<SupportedCountry, {
  readonly sourceName: string;
  readonly sourceUrl: string;
  readonly adminLevels: readonly AdministrativeLevel[];
  readonly estimatedPlaces: number;
  readonly implemented: boolean;
}> = {
  US: {
    sourceName: 'Census Bureau TIGERweb',
    sourceUrl: 'https://tigerweb.geo.census.gov',
    adminLevels: ['region', 'department', 'municipality'],
    estimatedPlaces: 19495,
    implemented: true, // CensusPlaceListLoader
  },
  CA: {
    sourceName: 'Statistics Canada',
    sourceUrl: 'https://www12.statcan.gc.ca',
    adminLevels: ['region', 'department', 'municipality'],
    estimatedPlaces: 5162,
    implemented: false,
  },
  GB: {
    sourceName: 'ONS Geography Portal',
    sourceUrl: 'https://geoportal.statistics.gov.uk',
    adminLevels: ['region', 'department', 'municipality', 'ward'],
    estimatedPlaces: 9000,
    implemented: false,
  },
  AU: {
    sourceName: 'Australian Bureau of Statistics',
    sourceUrl: 'https://www.abs.gov.au',
    adminLevels: ['region', 'municipality'],
    estimatedPlaces: 565,
    implemented: false,
  },
  NZ: {
    sourceName: 'LINZ Data Service',
    sourceUrl: 'https://data.linz.govt.nz',
    adminLevels: ['region', 'municipality'],
    estimatedPlaces: 78,
    implemented: false,
  },
  DE: {
    sourceName: 'BKG Open Data',
    sourceUrl: 'https://www.bkg.bund.de',
    adminLevels: ['region', 'department', 'municipality'],
    estimatedPlaces: 10787,
    implemented: false,
  },
  FR: {
    sourceName: 'IGN Admin Express',
    sourceUrl: 'https://www.ign.fr',
    adminLevels: ['region', 'department', 'municipality'],
    estimatedPlaces: 34945,
    implemented: false,
  },
  ES: {
    sourceName: 'IGN España',
    sourceUrl: 'https://www.ign.es',
    adminLevels: ['region', 'department', 'municipality'],
    estimatedPlaces: 8131,
    implemented: false,
  },
  IT: {
    sourceName: 'ISTAT Confini',
    sourceUrl: 'https://www.istat.it',
    adminLevels: ['region', 'department', 'municipality'],
    estimatedPlaces: 7903,
    implemented: false,
  },
  NL: {
    sourceName: 'CBS Open Data',
    sourceUrl: 'https://www.cbs.nl',
    adminLevels: ['region', 'municipality'],
    estimatedPlaces: 342,
    implemented: false,
  },
  BR: {
    sourceName: 'IBGE Geociências',
    sourceUrl: 'https://www.ibge.gov.br',
    adminLevels: ['region', 'department', 'municipality'],
    estimatedPlaces: 5570,
    implemented: false,
  },
  MX: {
    sourceName: 'INEGI Marco Geoestadístico',
    sourceUrl: 'https://www.inegi.org.mx',
    adminLevels: ['region', 'municipality'],
    estimatedPlaces: 2469,
    implemented: false,
  },
  IN: {
    sourceName: 'Census of India',
    sourceUrl: 'https://censusindia.gov.in',
    adminLevels: ['region', 'department', 'municipality'],
    estimatedPlaces: 7933,
    implemented: false,
  },
  JP: {
    sourceName: 'e-Stat Portal',
    sourceUrl: 'https://www.e-stat.go.jp',
    adminLevels: ['region', 'municipality'],
    estimatedPlaces: 1718,
    implemented: false,
  },
};

/**
 * Get total potential coverage across all countries
 */
export function getTotalPotentialCoverage(): {
  implementedCountries: number;
  totalCountries: number;
  implementedPlaces: number;
  totalPlaces: number;
} {
  const entries = Object.entries(PLACE_LIST_PROVIDERS);

  const implementedCountries = entries.filter(([, v]) => v.implemented).length;
  const totalCountries = entries.length;

  const implementedPlaces = entries
    .filter(([, v]) => v.implemented)
    .reduce((sum, [, v]) => sum + v.estimatedPlaces, 0);

  const totalPlaces = entries.reduce((sum, [, v]) => sum + v.estimatedPlaces, 0);

  return {
    implementedCountries,
    totalCountries,
    implementedPlaces,
    totalPlaces,
  };
}
