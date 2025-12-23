/**
 * EU Member State Electoral Boundaries Provider (Template)
 *
 * ARCHITECTURE DESIGN: This file serves as a template for implementing
 * EU member state boundary providers. Each of the 27 EU countries requires
 * a country-specific provider extending this template.
 *
 * EU ELECTORAL SYSTEMS (Diverse Approaches):
 * - **Proportional Representation**: Most EU countries (Germany, Netherlands, Spain)
 * - **Mixed Systems**: Some countries combine constituencies + party lists (Germany MMP)
 * - **Single-Member Districts**: Rare in EU (UK was exception before Brexit)
 * - **Multi-Member Districts**: Common (Spain provincial constituencies)
 *
 * DATA SOURCES BY COUNTRY:
 * - **Germany**: Bundeswahlleiter (Federal Returning Officer) - 299 constituencies
 * - **France**: INSEE (National Institute of Statistics) - 577 constituencies
 * - **Italy**: Ministry of Interior - 400 single-member + proportional seats
 * - **Spain**: INE (National Statistics Institute) - 52 provincial constituencies
 * - **Netherlands**: Centraal Bureau voor de Statistiek (CBS) - national list (no districts)
 * - **Poland**: PKW (National Electoral Commission) - 41 multi-member constituencies
 *
 * IMPLEMENTATION STRATEGY:
 * 1. Create country-specific provider extending this template
 * 2. Configure data source URLs (national statistics agencies, electoral commissions)
 * 3. Implement layer extraction for country-specific boundary types
 * 4. Add expected counts from official sources (validate data integrity)
 * 5. Register provider in international-providers.ts
 *
 * EXAMPLE: Germany Implementation
 * ```typescript
 * export class GermanyBoundaryProvider extends EUTemplateProvider<'bundestag' | 'landtag'> {
 *   readonly country = 'DE';
 *   readonly countryName = 'Germany';
 *   readonly dataSource = 'Bundeswahlleiter';
 *   // ... implement extractLayer() for Bundestag constituencies
 * }
 * ```
 *
 * @see GLOBAL_SCALING_SPEC.md for EU expansion roadmap
 */

import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import {
  BaseInternationalProvider,
  type InternationalExtractionResult,
  type LayerConfig,
  type LayerExtractionResult,
  type InternationalBoundary,
  type DataSourceType,
  type AuthorityLevel,
} from './base-provider.js';

// ============================================================================
// EU-Specific Types
// ============================================================================

/**
 * EU member state codes (ISO 3166-1 alpha-2)
 *
 * 27 member states as of 2024 (post-Brexit).
 * Each requires a country-specific provider implementation.
 */
export type EUCountryCode =
  | 'AT' // Austria
  | 'BE' // Belgium
  | 'BG' // Bulgaria
  | 'HR' // Croatia
  | 'CY' // Cyprus
  | 'CZ' // Czech Republic
  | 'DK' // Denmark
  | 'EE' // Estonia
  | 'FI' // Finland
  | 'FR' // France
  | 'DE' // Germany
  | 'GR' // Greece
  | 'HU' // Hungary
  | 'IE' // Ireland
  | 'IT' // Italy
  | 'LV' // Latvia
  | 'LT' // Lithuania
  | 'LU' // Luxembourg
  | 'MT' // Malta
  | 'NL' // Netherlands
  | 'PL' // Poland
  | 'PT' // Portugal
  | 'RO' // Romania
  | 'SK' // Slovakia
  | 'SI' // Slovenia
  | 'ES' // Spain
  | 'SE'; // Sweden

/**
 * Electoral system type
 *
 * EU countries use diverse electoral systems. This classification helps
 * determine whether constituency boundaries exist or if national/regional
 * party lists are used.
 */
export type ElectoralSystemType =
  | 'single-member-district'   // First-past-the-post (rare in EU)
  | 'multi-member-district'    // Proportional within constituencies (Spain, Poland)
  | 'mixed-member-proportional'// Germany MMP (constituencies + party lists)
  | 'national-list'            // Pure proportional (Netherlands, Israel)
  | 'regional-list';           // Regional party lists (Belgium)

/**
 * EU electoral constituency (generic interface)
 *
 * Extended by country-specific providers to add national properties.
 */
export interface EUConstituency extends InternationalBoundary {
  /** Constituency code (format varies by country) */
  readonly id: string;

  /** Constituency name (local language) */
  readonly name: string;

  /** Constituency name (English translation, if available) */
  readonly nameEn?: string;

  /** Boundary type (e.g., 'bundestag', 'assemblee-nationale') */
  readonly type: string;

  /** Electoral system used in this constituency */
  readonly electoralSystem: ElectoralSystemType;

  /** Number of seats allocated to this constituency */
  readonly seats: number;

  /** Population (from latest census) */
  readonly population?: number;

  /** NUTS code (Nomenclature of Territorial Units for Statistics) */
  readonly nutsCode?: string;

  /** GeoJSON geometry */
  readonly geometry: Polygon | MultiPolygon;

  /** Source metadata */
  readonly source: {
    readonly country: EUCountryCode;
    readonly dataSource: string;
    readonly endpoint: string;
    readonly authority: AuthorityLevel;
    readonly vintage: number;
    readonly retrievedAt: string;
  };

  /** Original properties from national data source */
  readonly properties: Record<string, unknown>;
}

/**
 * Data source configuration for EU member states
 *
 * Maps country codes to their national electoral data sources.
 * This registry grows as we implement country-specific providers.
 */
export interface EUDataSourceConfig {
  /** ISO 3166-1 alpha-2 country code */
  readonly country: EUCountryCode;

  /** Human-readable country name */
  readonly countryName: string;

  /** National data source organization */
  readonly dataSource: string;

  /** API type */
  readonly apiType: DataSourceType;

  /** Data license (SPDX identifier) */
  readonly license: string;

  /** Base URL for data endpoints */
  readonly baseUrl: string;

  /** Electoral system type */
  readonly electoralSystem: ElectoralSystemType;

  /** Available layer types for this country */
  readonly availableLayers: readonly string[];

  /** Expected total seats in national parliament */
  readonly totalSeats: number;

  /** Update schedule */
  readonly updateSchedule: 'annual' | 'event-driven' | 'manual';

  /** Last known redistricting year */
  readonly lastRedistricting: number;

  /** Notes about data source */
  readonly notes?: string;
}

// ============================================================================
// EU Data Source Registry
// ============================================================================

/**
 * EU Member State Data Source Registry
 *
 * WORK IN PROGRESS: This registry will grow to cover all 27 EU member states.
 * Each entry provides the configuration needed to implement a country-specific provider.
 *
 * PRIORITY ORDER (Phase 2 Implementation):
 * 1. Large democracies: Germany, France, Italy, Spain, Poland (175M population)
 * 2. Medium democracies: Netherlands, Belgium, Greece, Portugal, Czech Republic
 * 3. Small democracies: Remaining 17 member states
 */
export const EU_DATA_SOURCES: Record<EUCountryCode, EUDataSourceConfig> = {
  // ===== PRIORITY 1: Large Democracies =====

  DE: {
    country: 'DE',
    countryName: 'Germany',
    dataSource: 'Bundeswahlleiter (Federal Returning Officer)',
    apiType: 'static-file',
    license: 'public-domain',
    baseUrl: 'https://www.bundeswahlleiter.de/dam/jcr',
    electoralSystem: 'mixed-member-proportional',
    availableLayers: ['bundestag', 'landtag'],
    totalSeats: 598, // Bundestag (can vary due to overhang seats)
    updateSchedule: 'event-driven',
    lastRedistricting: 2023,
    notes: 'MMP system: 299 single-member constituencies + party lists',
  },

  FR: {
    country: 'FR',
    countryName: 'France',
    dataSource: 'INSEE (National Institute of Statistics)',
    apiType: 'wfs',
    license: 'ODbL',
    baseUrl: 'https://geoservices.ign.fr',
    electoralSystem: 'single-member-district',
    availableLayers: ['assemblee-nationale', 'senat'],
    totalSeats: 577, // National Assembly
    updateSchedule: 'event-driven',
    lastRedistricting: 2010,
    notes: 'Two-round system in single-member constituencies',
  },

  IT: {
    country: 'IT',
    countryName: 'Italy',
    dataSource: 'Ministry of Interior',
    apiType: 'rest-api',
    license: 'CC-BY-4.0',
    baseUrl: 'https://dait.interno.gov.it',
    electoralSystem: 'multi-member-district',
    availableLayers: ['camera', 'senato'],
    totalSeats: 400, // Chamber of Deputies (post-2020 reform)
    updateSchedule: 'event-driven',
    lastRedistricting: 2017,
    notes: 'Mixed system: 61% proportional, 37% single-member',
  },

  ES: {
    country: 'ES',
    countryName: 'Spain',
    dataSource: 'INE (National Statistics Institute)',
    apiType: 'rest-api',
    license: 'CC-BY-4.0',
    baseUrl: 'https://www.ine.es',
    electoralSystem: 'multi-member-district',
    availableLayers: ['congreso', 'senado'],
    totalSeats: 350, // Congress of Deputies
    updateSchedule: 'annual',
    lastRedistricting: 2023,
    notes: 'Provincial constituencies with proportional allocation',
  },

  PL: {
    country: 'PL',
    countryName: 'Poland',
    dataSource: 'PKW (National Electoral Commission)',
    apiType: 'static-file',
    license: 'public-domain',
    baseUrl: 'https://pkw.gov.pl',
    electoralSystem: 'multi-member-district',
    availableLayers: ['sejm', 'senat'],
    totalSeats: 460, // Sejm
    updateSchedule: 'event-driven',
    lastRedistricting: 2018,
    notes: '41 multi-member constituencies, proportional representation',
  },

  // ===== PRIORITY 2: Medium Democracies =====

  NL: {
    country: 'NL',
    countryName: 'Netherlands',
    dataSource: 'CBS (Statistics Netherlands)',
    apiType: 'rest-api',
    license: 'CC0-1.0',
    baseUrl: 'https://www.cbs.nl',
    electoralSystem: 'national-list',
    availableLayers: ['tweede-kamer'], // No geographic constituencies
    totalSeats: 150,
    updateSchedule: 'manual',
    lastRedistricting: 0, // No constituencies (national list)
    notes: 'Pure proportional representation, no geographic districts',
  },

  // ===== PRIORITY 3: Remaining Member States (Placeholders) =====
  // These will be implemented in Phase 2, Months 9-12

  AT: {
    country: 'AT',
    countryName: 'Austria',
    dataSource: 'Statistics Austria',
    apiType: 'rest-api',
    license: 'CC-BY-4.0',
    baseUrl: 'https://www.statistik.at',
    electoralSystem: 'regional-list',
    availableLayers: ['nationalrat'],
    totalSeats: 183,
    updateSchedule: 'manual',
    lastRedistricting: 2023,
  },

  BE: {
    country: 'BE',
    countryName: 'Belgium',
    dataSource: 'Statbel',
    apiType: 'wfs',
    license: 'CC0-1.0',
    baseUrl: 'https://statbel.fgov.be',
    electoralSystem: 'regional-list',
    availableLayers: ['chamber', 'senate'],
    totalSeats: 150,
    updateSchedule: 'manual',
    lastRedistricting: 2018,
    notes: 'Complex federal system with regional parliaments',
  },

  // Remaining 20 EU countries (minimal placeholders for now)
  BG: { country: 'BG', countryName: 'Bulgaria', dataSource: 'TBD', apiType: 'rest-api', license: 'TBD', baseUrl: '', electoralSystem: 'multi-member-district', availableLayers: [], totalSeats: 240, updateSchedule: 'manual', lastRedistricting: 2023 },
  HR: { country: 'HR', countryName: 'Croatia', dataSource: 'TBD', apiType: 'rest-api', license: 'TBD', baseUrl: '', electoralSystem: 'multi-member-district', availableLayers: [], totalSeats: 151, updateSchedule: 'manual', lastRedistricting: 2023 },
  CY: { country: 'CY', countryName: 'Cyprus', dataSource: 'TBD', apiType: 'rest-api', license: 'TBD', baseUrl: '', electoralSystem: 'national-list', availableLayers: [], totalSeats: 80, updateSchedule: 'manual', lastRedistricting: 2023 },
  CZ: { country: 'CZ', countryName: 'Czech Republic', dataSource: 'TBD', apiType: 'rest-api', license: 'TBD', baseUrl: '', electoralSystem: 'multi-member-district', availableLayers: [], totalSeats: 200, updateSchedule: 'manual', lastRedistricting: 2023 },
  DK: { country: 'DK', countryName: 'Denmark', dataSource: 'TBD', apiType: 'rest-api', license: 'TBD', baseUrl: '', electoralSystem: 'multi-member-district', availableLayers: [], totalSeats: 179, updateSchedule: 'manual', lastRedistricting: 2023 },
  EE: { country: 'EE', countryName: 'Estonia', dataSource: 'TBD', apiType: 'rest-api', license: 'TBD', baseUrl: '', electoralSystem: 'multi-member-district', availableLayers: [], totalSeats: 101, updateSchedule: 'manual', lastRedistricting: 2023 },
  FI: { country: 'FI', countryName: 'Finland', dataSource: 'TBD', apiType: 'rest-api', license: 'TBD', baseUrl: '', electoralSystem: 'multi-member-district', availableLayers: [], totalSeats: 200, updateSchedule: 'manual', lastRedistricting: 2023 },
  GR: { country: 'GR', countryName: 'Greece', dataSource: 'TBD', apiType: 'rest-api', license: 'TBD', baseUrl: '', electoralSystem: 'multi-member-district', availableLayers: [], totalSeats: 300, updateSchedule: 'manual', lastRedistricting: 2023 },
  HU: { country: 'HU', countryName: 'Hungary', dataSource: 'TBD', apiType: 'rest-api', license: 'TBD', baseUrl: '', electoralSystem: 'mixed-member-proportional', availableLayers: [], totalSeats: 199, updateSchedule: 'manual', lastRedistricting: 2023 },
  IE: { country: 'IE', countryName: 'Ireland', dataSource: 'TBD', apiType: 'rest-api', license: 'TBD', baseUrl: '', electoralSystem: 'multi-member-district', availableLayers: [], totalSeats: 160, updateSchedule: 'manual', lastRedistricting: 2023 },
  LV: { country: 'LV', countryName: 'Latvia', dataSource: 'TBD', apiType: 'rest-api', license: 'TBD', baseUrl: '', electoralSystem: 'multi-member-district', availableLayers: [], totalSeats: 100, updateSchedule: 'manual', lastRedistricting: 2023 },
  LT: { country: 'LT', countryName: 'Lithuania', dataSource: 'TBD', apiType: 'rest-api', license: 'TBD', baseUrl: '', electoralSystem: 'mixed-member-proportional', availableLayers: [], totalSeats: 141, updateSchedule: 'manual', lastRedistricting: 2023 },
  LU: { country: 'LU', countryName: 'Luxembourg', dataSource: 'TBD', apiType: 'rest-api', license: 'TBD', baseUrl: '', electoralSystem: 'multi-member-district', availableLayers: [], totalSeats: 60, updateSchedule: 'manual', lastRedistricting: 2023 },
  MT: { country: 'MT', countryName: 'Malta', dataSource: 'TBD', apiType: 'rest-api', license: 'TBD', baseUrl: '', electoralSystem: 'multi-member-district', availableLayers: [], totalSeats: 67, updateSchedule: 'manual', lastRedistricting: 2023 },
  PT: { country: 'PT', countryName: 'Portugal', dataSource: 'TBD', apiType: 'rest-api', license: 'TBD', baseUrl: '', electoralSystem: 'multi-member-district', availableLayers: [], totalSeats: 230, updateSchedule: 'manual', lastRedistricting: 2023 },
  RO: { country: 'RO', countryName: 'Romania', dataSource: 'TBD', apiType: 'rest-api', license: 'TBD', baseUrl: '', electoralSystem: 'multi-member-district', availableLayers: [], totalSeats: 330, updateSchedule: 'manual', lastRedistricting: 2023 },
  SK: { country: 'SK', countryName: 'Slovakia', dataSource: 'TBD', apiType: 'rest-api', license: 'TBD', baseUrl: '', electoralSystem: 'multi-member-district', availableLayers: [], totalSeats: 150, updateSchedule: 'manual', lastRedistricting: 2023 },
  SI: { country: 'SI', countryName: 'Slovenia', dataSource: 'TBD', apiType: 'rest-api', license: 'TBD', baseUrl: '', electoralSystem: 'multi-member-district', availableLayers: [], totalSeats: 90, updateSchedule: 'manual', lastRedistricting: 2023 },
  SE: { country: 'SE', countryName: 'Sweden', dataSource: 'TBD', apiType: 'rest-api', license: 'TBD', baseUrl: '', electoralSystem: 'multi-member-district', availableLayers: [], totalSeats: 349, updateSchedule: 'manual', lastRedistricting: 2023 },
};

// ============================================================================
// EU Template Provider (Abstract Base for Country Implementations)
// ============================================================================

/**
 * Abstract template provider for EU member states
 *
 * Country-specific providers extend this class and implement:
 * - extractAll(): Extract all available layers for the country
 * - extractLayer(): Extract a specific layer type
 * - Country-specific normalization logic
 *
 * Provides:
 * - Common retry/health check logic (from BaseInternationalProvider)
 * - EU-specific type constraints
 * - Data source configuration lookup
 */
export abstract class EUTemplateProvider<
  TLayerType extends string
> extends BaseInternationalProvider<TLayerType, EUConstituency> {
  /**
   * Get data source configuration for this country
   */
  protected getDataSourceConfig(): EUDataSourceConfig {
    const config = EU_DATA_SOURCES[this.country as EUCountryCode];
    if (!config) {
      throw new Error(`No data source configuration for country: ${this.country}`);
    }
    return config;
  }
}

// ============================================================================
// Example: Germany Provider (Demonstrates Template Usage)
// ============================================================================

/**
 * Germany Bundestag Constituencies Provider (Example Implementation)
 *
 * DATA SOURCE: Bundeswahlleiter (Federal Returning Officer)
 * SYSTEM: Mixed-Member Proportional (MMP)
 * CONSTITUENCIES: 299 single-member districts
 *
 * NOTE: This is a TEMPLATE EXAMPLE. Full implementation requires:
 * 1. Actual Bundeswahlleiter API endpoints
 * 2. Shapefile parsing (they use .shp files, not REST API)
 * 3. Handling of overhang/leveling seats in MMP system
 */
export class GermanyBoundaryProvider extends EUTemplateProvider<'bundestag'> {
  readonly country = 'DE';
  readonly countryName = 'Germany';
  readonly dataSource = 'Bundeswahlleiter';
  readonly apiType = 'static-file' as const;
  readonly license = 'public-domain';

  readonly layers = new Map([
    [
      'bundestag' as const,
      {
        type: 'bundestag' as const,
        name: 'Bundestag Electoral Constituencies 2023',
        endpoint: 'https://www.bundeswahlleiter.de/dam/jcr/.../wahlkreise-shp.zip',
        expectedCount: 299,
        updateSchedule: 'event-driven' as const,
        authority: 'electoral-commission' as const,
        vintage: 2023,
        lastVerified: '2024-01-01',
        notes: 'MMP system: 299 constituencies + party list seats',
      },
    ],
  ]);

  async extractAll(): Promise<InternationalExtractionResult<'bundestag', EUConstituency>> {
    throw new Error(
      'Germany provider is a template example. Full implementation requires shapefile parsing.'
    );
  }

  async extractLayer(): Promise<LayerExtractionResult<'bundestag', EUConstituency>> {
    throw new Error(
      'Germany provider is a template example. Full implementation requires shapefile parsing.'
    );
  }
}
