/**
 * Global Portal Registry
 *
 * Authoritative open data portals for political boundary discovery.
 * Organized by country with portal type, search strategy, and coverage level.
 *
 * This registry enables the discovery pipeline to work globally by providing
 * country-specific portal configurations rather than hardcoded US sources.
 *
 * Sources compiled from:
 * - National statistical agencies
 * - Electoral commissions
 * - National mapping agencies
 * - Open data government portals
 */

import type { SupportedCountry } from '../../providers/place-list-provider.js';

/**
 * Portal technology types
 */
export type PortalType =
  | 'arcgis-hub'         // Esri ArcGIS Hub/Portal
  | 'arcgis-server'      // Direct ArcGIS Server REST
  | 'ckan'               // CKAN data portal
  | 'socrata'            // Socrata/Tyler Data & Insights
  | 'wfs'                // OGC Web Feature Service
  | 'geojson-download'   // Direct GeoJSON download
  | 'shapefile-download' // Shapefile archive download
  | 'api-rest';          // Custom REST API

/**
 * Administrative levels a portal covers
 */
export type CoverageLevel =
  | 'national'        // Country-level boundaries
  | 'regional'        // State/province level
  | 'local'           // City/municipality level
  | 'ward';           // Ward/district level (finest)

/**
 * Portal entry configuration
 */
export interface PortalEntry {
  /** Portal identifier */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Base URL */
  readonly url: string;

  /** Portal technology type */
  readonly type: PortalType;

  /** Administrative levels covered */
  readonly coverage: readonly CoverageLevel[];

  /** Search terms for boundary discovery */
  readonly searchTerms: readonly string[];

  /** Whether portal requires API key */
  readonly requiresAuth: boolean;

  /** Open data license */
  readonly license: string;

  /** Notes about data quality or usage */
  readonly notes?: string;
}

/**
 * Country portal configuration
 */
export interface CountryPortals {
  /** ISO 3166-1 alpha-2 country code */
  readonly countryCode: SupportedCountry;

  /** Country name */
  readonly countryName: string;

  /** Primary authoritative portal */
  readonly primary: PortalEntry;

  /** Secondary/fallback portals */
  readonly secondary: readonly PortalEntry[];

  /** Regional bounding box [minLon, minLat, maxLon, maxLat] */
  readonly bounds: readonly [number, number, number, number];

  /** Local terminology for council districts */
  readonly districtTerms: readonly string[];

  /** Local terminology for wards */
  readonly wardTerms: readonly string[];
}

/**
 * Global Portal Registry
 *
 * Authoritative sources for 14 countries covering 1.5B+ people.
 */
export const GLOBAL_PORTALS: Record<SupportedCountry, CountryPortals> = {
  // ===================
  // NORTH AMERICA
  // ===================
  US: {
    countryCode: 'US',
    countryName: 'United States',
    bounds: [-179.1, 17.9, -66.9, 71.4],
    districtTerms: ['council district', 'city council district', 'aldermanic district'],
    wardTerms: ['ward', 'borough'],
    primary: {
      id: 'us-census-tiger',
      name: 'Census Bureau TIGER/Line',
      url: 'https://tigerweb.geo.census.gov',
      type: 'arcgis-server',
      coverage: ['national', 'regional', 'local'],
      searchTerms: ['council district', 'incorporated place', 'county'],
      requiresAuth: false,
      license: 'Public Domain',
    },
    secondary: [
      {
        id: 'us-arcgis-hub',
        name: 'ArcGIS Hub (US)',
        url: 'https://hub.arcgis.com',
        type: 'arcgis-hub',
        coverage: ['local', 'ward'],
        searchTerms: ['council district', 'ward', 'city council'],
        requiresAuth: false,
        license: 'Varies by dataset',
      },
      {
        id: 'us-data-gov',
        name: 'Data.gov',
        url: 'https://catalog.data.gov',
        type: 'ckan',
        coverage: ['national', 'regional', 'local'],
        searchTerms: ['boundary', 'district', 'municipal'],
        requiresAuth: false,
        license: 'Public Domain / CC0',
      },
    ],
  },

  CA: {
    countryCode: 'CA',
    countryName: 'Canada',
    bounds: [-141.0, 41.7, -52.6, 83.1],
    districtTerms: ['electoral district', 'riding', 'ward'],
    wardTerms: ['ward', 'division'],
    primary: {
      id: 'ca-statcan',
      name: 'Statistics Canada',
      url: 'https://www12.statcan.gc.ca/census-recensement',
      type: 'geojson-download',
      coverage: ['national', 'regional', 'local'],
      searchTerms: ['federal electoral district', 'census subdivision'],
      requiresAuth: false,
      license: 'Statistics Canada Open License',
    },
    secondary: [
      {
        id: 'ca-open-canada',
        name: 'Open Canada',
        url: 'https://open.canada.ca',
        type: 'ckan',
        coverage: ['national', 'regional'],
        searchTerms: ['electoral district', 'administrative boundary'],
        requiresAuth: false,
        license: 'Open Government License - Canada',
      },
      {
        id: 'ca-elections',
        name: 'Elections Canada',
        url: 'https://www.elections.ca',
        type: 'shapefile-download',
        coverage: ['national'],
        searchTerms: ['federal electoral district'],
        requiresAuth: false,
        license: 'Open Government License - Canada',
      },
    ],
  },

  MX: {
    countryCode: 'MX',
    countryName: 'Mexico',
    bounds: [-118.4, 14.5, -86.7, 32.7],
    districtTerms: ['distrito electoral', 'municipio'],
    wardTerms: ['sección electoral'],
    primary: {
      id: 'mx-inegi',
      name: 'INEGI Marco Geoestadístico',
      url: 'https://www.inegi.org.mx/temas/mg',
      type: 'shapefile-download',
      coverage: ['national', 'regional', 'local'],
      searchTerms: ['municipio', 'entidad federativa'],
      requiresAuth: false,
      license: 'INEGI Open License',
    },
    secondary: [
      {
        id: 'mx-datos-gob',
        name: 'datos.gob.mx',
        url: 'https://datos.gob.mx',
        type: 'ckan',
        coverage: ['regional', 'local'],
        searchTerms: ['límites municipales', 'división política'],
        requiresAuth: false,
        license: 'CC BY 4.0',
      },
    ],
  },

  BR: {
    countryCode: 'BR',
    countryName: 'Brazil',
    bounds: [-73.9, -33.7, -28.8, 5.3],
    districtTerms: ['município', 'zona eleitoral'],
    wardTerms: ['seção eleitoral'],
    primary: {
      id: 'br-ibge',
      name: 'IBGE Geociências',
      url: 'https://www.ibge.gov.br/geociencias',
      type: 'geojson-download',
      coverage: ['national', 'regional', 'local'],
      searchTerms: ['município', 'microrregião', 'mesorregião'],
      requiresAuth: false,
      license: 'CC BY 4.0',
    },
    secondary: [
      {
        id: 'br-dados-gov',
        name: 'dados.gov.br',
        url: 'https://dados.gov.br',
        type: 'ckan',
        coverage: ['regional', 'local'],
        searchTerms: ['limites municipais', 'divisão territorial'],
        requiresAuth: false,
        license: 'CC BY 4.0',
      },
    ],
  },

  // ===================
  // EUROPE
  // ===================
  GB: {
    countryCode: 'GB',
    countryName: 'United Kingdom',
    bounds: [-8.6, 49.9, 1.8, 60.8],
    districtTerms: ['parliamentary constituency', 'council area'],
    wardTerms: ['electoral ward', 'ward', 'parish'],
    primary: {
      id: 'gb-ons',
      name: 'ONS Geography Portal',
      url: 'https://geoportal.statistics.gov.uk',
      type: 'wfs',
      coverage: ['national', 'regional', 'local', 'ward'],
      searchTerms: ['ward', 'constituency', 'local authority'],
      requiresAuth: false,
      license: 'Open Government License 3.0',
    },
    secondary: [
      {
        id: 'gb-os',
        name: 'Ordnance Survey Open Data',
        url: 'https://osdatahub.os.uk',
        type: 'api-rest',
        coverage: ['national', 'regional', 'local', 'ward'],
        searchTerms: ['boundary', 'electoral division', 'ward'],
        requiresAuth: true, // Free API key required
        license: 'Open Government License 3.0',
        notes: 'Free API key required - register at osdatahub.os.uk',
      },
      {
        id: 'gb-data-gov',
        name: 'data.gov.uk',
        url: 'https://data.gov.uk',
        type: 'ckan',
        coverage: ['regional', 'local', 'ward'],
        searchTerms: ['ward boundary', 'council district'],
        requiresAuth: false,
        license: 'Open Government License 3.0',
      },
    ],
  },

  DE: {
    countryCode: 'DE',
    countryName: 'Germany',
    bounds: [5.9, 47.3, 15.0, 55.0],
    districtTerms: ['Wahlkreis', 'Landkreis', 'kreisfreie Stadt'],
    wardTerms: ['Gemeinde', 'Stadtteil', 'Bezirk'],
    primary: {
      id: 'de-bkg',
      name: 'BKG Open Data',
      url: 'https://gdz.bkg.bund.de',
      type: 'wfs',
      coverage: ['national', 'regional', 'local'],
      searchTerms: ['Verwaltungsgebiete', 'Gemeinde', 'Kreis'],
      requiresAuth: false,
      license: 'DL-DE-BY-2.0',
    },
    secondary: [
      {
        id: 'de-govdata',
        name: 'GovData',
        url: 'https://www.govdata.de',
        type: 'ckan',
        coverage: ['regional', 'local'],
        searchTerms: ['Gemeindegrenzen', 'Verwaltungsgrenzen'],
        requiresAuth: false,
        license: 'DL-DE-BY-2.0',
      },
    ],
  },

  FR: {
    countryCode: 'FR',
    countryName: 'France',
    bounds: [-5.1, 41.3, 9.6, 51.1],
    districtTerms: ['circonscription', 'département', 'commune'],
    wardTerms: ['canton', 'arrondissement'],
    primary: {
      id: 'fr-ign',
      name: 'IGN Admin Express',
      url: 'https://geoservices.ign.fr',
      type: 'wfs',
      coverage: ['national', 'regional', 'local'],
      searchTerms: ['commune', 'département', 'région'],
      requiresAuth: false,
      license: 'Licence Ouverte 2.0',
    },
    secondary: [
      {
        id: 'fr-data-gouv',
        name: 'data.gouv.fr',
        url: 'https://data.gouv.fr',
        type: 'ckan',
        coverage: ['regional', 'local'],
        searchTerms: ['limites communales', 'découpage administratif'],
        requiresAuth: false,
        license: 'Licence Ouverte 2.0',
      },
    ],
  },

  ES: {
    countryCode: 'ES',
    countryName: 'Spain',
    bounds: [-18.2, 27.6, 4.3, 43.8],
    districtTerms: ['circunscripción', 'municipio', 'provincia'],
    wardTerms: ['distrito', 'barrio'],
    primary: {
      id: 'es-ign',
      name: 'IGN España',
      url: 'https://www.ign.es/web/ign/portal',
      type: 'wfs',
      coverage: ['national', 'regional', 'local'],
      searchTerms: ['municipio', 'provincia', 'comunidad autónoma'],
      requiresAuth: false,
      license: 'CC BY 4.0',
    },
    secondary: [
      {
        id: 'es-datos-gob',
        name: 'datos.gob.es',
        url: 'https://datos.gob.es',
        type: 'ckan',
        coverage: ['regional', 'local'],
        searchTerms: ['límites municipales', 'división administrativa'],
        requiresAuth: false,
        license: 'CC BY 4.0',
      },
    ],
  },

  IT: {
    countryCode: 'IT',
    countryName: 'Italy',
    bounds: [6.6, 35.5, 18.5, 47.1],
    districtTerms: ['circoscrizione', 'comune', 'provincia'],
    wardTerms: ['municipio', 'quartiere'],
    primary: {
      id: 'it-istat',
      name: 'ISTAT Confini',
      url: 'https://www.istat.it/it/archivio/222527',
      type: 'geojson-download',
      coverage: ['national', 'regional', 'local'],
      searchTerms: ['comune', 'provincia', 'regione'],
      requiresAuth: false,
      license: 'CC BY 3.0 IT',
    },
    secondary: [
      {
        id: 'it-dati-gov',
        name: 'dati.gov.it',
        url: 'https://dati.gov.it',
        type: 'ckan',
        coverage: ['regional', 'local'],
        searchTerms: ['confini comunali', 'limiti amministrativi'],
        requiresAuth: false,
        license: 'CC BY 3.0 IT',
      },
    ],
  },

  NL: {
    countryCode: 'NL',
    countryName: 'Netherlands',
    bounds: [3.4, 50.8, 7.2, 53.5],
    districtTerms: ['gemeente', 'provincie'],
    wardTerms: ['wijk', 'buurt'],
    primary: {
      id: 'nl-cbs',
      name: 'CBS Open Data',
      url: 'https://www.cbs.nl/nl-nl/onze-diensten/open-data',
      type: 'api-rest',
      coverage: ['national', 'regional', 'local'],
      searchTerms: ['gemeente', 'wijk', 'buurt'],
      requiresAuth: false,
      license: 'CC BY 4.0',
    },
    secondary: [
      {
        id: 'nl-pdok',
        name: 'PDOK',
        url: 'https://www.pdok.nl',
        type: 'wfs',
        coverage: ['national', 'regional', 'local'],
        searchTerms: ['bestuurlijke grenzen', 'gemeentegrenzen'],
        requiresAuth: false,
        license: 'CC0 1.0',
      },
    ],
  },

  // ===================
  // ASIA-PACIFIC
  // ===================
  AU: {
    countryCode: 'AU',
    countryName: 'Australia',
    bounds: [113.3, -43.6, 153.6, -10.7],
    districtTerms: ['electoral division', 'local government area'],
    wardTerms: ['ward'],
    primary: {
      id: 'au-abs',
      name: 'ABS Administrative Boundaries',
      url: 'https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3',
      type: 'geojson-download',
      coverage: ['national', 'regional', 'local'],
      searchTerms: ['local government area', 'electoral division'],
      requiresAuth: false,
      license: 'CC BY 4.0',
    },
    secondary: [
      {
        id: 'au-aec',
        name: 'AEC Electoral Boundaries',
        url: 'https://www.aec.gov.au/Electorates',
        type: 'shapefile-download',
        coverage: ['national'],
        searchTerms: ['electoral division', 'federal electorate'],
        requiresAuth: false,
        license: 'CC BY 4.0',
      },
      {
        id: 'au-data-gov',
        name: 'data.gov.au',
        url: 'https://data.gov.au',
        type: 'ckan',
        coverage: ['regional', 'local'],
        searchTerms: ['boundary', 'local government'],
        requiresAuth: false,
        license: 'CC BY 4.0',
      },
    ],
  },

  NZ: {
    countryCode: 'NZ',
    countryName: 'New Zealand',
    bounds: [166.4, -47.3, 178.6, -34.4],
    districtTerms: ['electorate', 'territorial authority', 'regional council'],
    wardTerms: ['ward', 'subdivision'],
    primary: {
      id: 'nz-linz',
      name: 'LINZ Data Service',
      url: 'https://data.linz.govt.nz',
      type: 'wfs',
      coverage: ['national', 'regional', 'local'],
      searchTerms: ['territorial authority', 'regional council'],
      requiresAuth: true, // Free API key required
      license: 'CC BY 4.0',
      notes: 'Free API key required - register at data.linz.govt.nz',
    },
    secondary: [
      {
        id: 'nz-stats',
        name: 'Stats NZ Geographic Data',
        url: 'https://datafinder.stats.govt.nz',
        type: 'api-rest',
        coverage: ['national', 'regional'],
        searchTerms: ['statistical area', 'territorial authority'],
        requiresAuth: false,
        license: 'CC BY 4.0',
      },
    ],
  },

  IN: {
    countryCode: 'IN',
    countryName: 'India',
    bounds: [68.2, 6.7, 97.4, 35.5],
    districtTerms: ['parliamentary constituency', 'assembly constituency', 'district'],
    wardTerms: ['ward', 'polling booth'],
    primary: {
      id: 'in-datameet',
      name: 'DataMeet Maps',
      url: 'https://github.com/datameet/maps',
      type: 'geojson-download',
      coverage: ['national', 'regional', 'local'],
      searchTerms: ['constituency', 'district', 'state'],
      requiresAuth: false,
      license: 'ODbL 1.0',
      notes: 'Community-maintained, high quality',
    },
    secondary: [
      {
        id: 'in-data-gov',
        name: 'data.gov.in',
        url: 'https://data.gov.in',
        type: 'ckan',
        coverage: ['regional', 'local'],
        searchTerms: ['boundary', 'district', 'state'],
        requiresAuth: false,
        license: 'Government Open Data License',
      },
    ],
  },

  JP: {
    countryCode: 'JP',
    countryName: 'Japan',
    bounds: [122.9, 24.2, 153.9, 45.5],
    districtTerms: ['選挙区', '市区町村'],
    wardTerms: ['区'],
    primary: {
      id: 'jp-estat',
      name: 'e-Stat Administrative Boundaries',
      url: 'https://www.e-stat.go.jp',
      type: 'shapefile-download',
      coverage: ['national', 'regional', 'local'],
      searchTerms: ['市区町村', '都道府県'],
      requiresAuth: false,
      license: 'CC BY 4.0',
    },
    secondary: [
      {
        id: 'jp-gsi',
        name: 'GSI Maps',
        url: 'https://maps.gsi.go.jp',
        type: 'api-rest',
        coverage: ['national', 'regional'],
        searchTerms: ['行政界', '市町村'],
        requiresAuth: false,
        license: 'CC BY 4.0',
      },
    ],
  },
};

/**
 * Get all portals for a country (primary + secondary)
 */
export function getPortalsForCountry(countryCode: SupportedCountry): PortalEntry[] {
  const config = GLOBAL_PORTALS[countryCode];
  return [config.primary, ...config.secondary];
}

/**
 * Get portals that support a specific coverage level
 */
export function getPortalsByCoverage(
  countryCode: SupportedCountry,
  level: CoverageLevel
): PortalEntry[] {
  return getPortalsForCountry(countryCode).filter((p) => p.coverage.includes(level));
}

/**
 * Get all CKAN portals across all countries
 */
export function getAllCKANPortals(): PortalEntry[] {
  return Object.values(GLOBAL_PORTALS)
    .flatMap((config) => [config.primary, ...config.secondary])
    .filter((p) => p.type === 'ckan');
}

/**
 * Get country bounding box
 */
export function getCountryBounds(
  countryCode: SupportedCountry
): readonly [number, number, number, number] {
  return GLOBAL_PORTALS[countryCode].bounds;
}

/**
 * Get district search terms for a country
 */
export function getDistrictTerms(countryCode: SupportedCountry): readonly string[] {
  return GLOBAL_PORTALS[countryCode].districtTerms;
}

/**
 * Get ward search terms for a country
 */
export function getWardTerms(countryCode: SupportedCountry): readonly string[] {
  return GLOBAL_PORTALS[countryCode].wardTerms;
}

/**
 * Summary statistics for global portal registry
 */
export function getRegistryStats(): {
  totalCountries: number;
  totalPortals: number;
  portalsByType: Record<PortalType, number>;
  coverageByLevel: Record<CoverageLevel, number>;
} {
  const allPortals = Object.values(GLOBAL_PORTALS).flatMap((config) => [
    config.primary,
    ...config.secondary,
  ]);

  const portalsByType: Record<PortalType, number> = {
    'arcgis-hub': 0,
    'arcgis-server': 0,
    ckan: 0,
    socrata: 0,
    wfs: 0,
    'geojson-download': 0,
    'shapefile-download': 0,
    'api-rest': 0,
  };

  const coverageByLevel: Record<CoverageLevel, number> = {
    national: 0,
    regional: 0,
    local: 0,
    ward: 0,
  };

  for (const portal of allPortals) {
    portalsByType[portal.type]++;
    for (const level of portal.coverage) {
      coverageByLevel[level]++;
    }
  }

  return {
    totalCountries: Object.keys(GLOBAL_PORTALS).length,
    totalPortals: allPortals.length,
    portalsByType,
    coverageByLevel,
  };
}
