/**
 * International Boundary Data Source Registry
 *
 * PHILOSOPHY: Democratic infrastructure extends beyond US borders.
 * This registry maps international electoral boundary data sources,
 * enabling global Shadow Atlas coverage.
 *
 * AUTHORITY HIERARCHY (International):
 * 1. National statistical agencies (ONS, Statistics Canada, etc.)
 * 2. National electoral commissions (Elections Canada, UK Electoral Commission)
 * 3. Open data initiatives (Represent API, Open North)
 *
 * COVERAGE STRATEGY:
 * Phase 1: UK (650 constituencies), Canada (338 ridings) - English-speaking democracies
 * Phase 2: EU democracies (Germany, France, Netherlands) - INSPIRE directive compliance
 * Phase 3: Global democracies (Australia, New Zealand, India)
 *
 * USAGE:
 * ```typescript
 * import { INTERNATIONAL_PORTALS } from './international-portals.js';
 *
 * const ukPortal = INTERNATIONAL_PORTALS['GB'];
 * console.log(ukPortal.layers.parliamentary.endpoint);
 * ```
 *
 * DATA SOURCES:
 * - UK: Office for National Statistics (ONS) ArcGIS services
 * - Canada: Represent API (Open North) + Statistics Canada
 *
 * NOTES:
 * - All endpoints verified as of lastVerified date
 * - Expected counts match official electoral district counts
 * - Vintage indicates year of current boundary review/redistribution
 */

import type { ProviderAPIType } from '../providers/international/types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * International portal configuration
 */
export interface InternationalPortalConfig {
  /** ISO 3166-1 alpha-2 country code */
  readonly country: string;

  /** Country name */
  readonly countryName: string;

  /** Provider implementation identifier */
  readonly provider: string;

  /** Data source organization */
  readonly dataSource: string;

  /** API type */
  readonly apiType: ProviderAPIType;

  /** License identifier */
  readonly license: string;

  /** Available boundary layers */
  readonly layers: Record<string, InternationalLayerConfig>;

  /** Update schedule */
  readonly updateSchedule?: 'annual' | 'event-driven' | 'quarterly';

  /** Notes about data source */
  readonly notes?: string;

  /** Contact for data issues */
  readonly contact?: string;
}

/**
 * International layer configuration
 */
export interface InternationalLayerConfig {
  /** Layer endpoint URL */
  readonly endpoint: string;

  /** Expected boundary count */
  readonly expectedCount: number;

  /** Data vintage (year of boundary review/redistribution) */
  readonly vintage: number;

  /** Last verified date (ISO 8601) */
  readonly lastVerified: string;

  /** Notes about this layer */
  readonly notes?: string;
}

// ============================================================================
// International Portals Registry
// ============================================================================

/**
 * International boundary data source registry
 *
 * Maps country codes to authoritative boundary data sources.
 * Each entry includes layer endpoints, expected counts, and metadata.
 */
export const INTERNATIONAL_PORTALS: Record<string, InternationalPortalConfig> = {
  /**
   * UNITED KINGDOM
   * Westminster Parliamentary Constituencies
   */
  GB: {
    country: 'GB',
    countryName: 'United Kingdom',
    provider: 'uk-provider',
    dataSource: 'ONS (Office for National Statistics)',
    apiType: 'arcgis-rest',
    license: 'OGL',
    updateSchedule: 'event-driven',
    layers: {
      parliamentary: {
        endpoint:
          'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BFC/FeatureServer/0',
        expectedCount: 650,
        vintage: 2024,
        lastVerified: '2025-12-17',
        notes:
          'July 2024 boundary review implemented. Next review scheduled post-2031 census.',
      },
    },
    notes:
      'ONS is the authoritative source for UK electoral boundaries. Westminster constituencies cover England (543), Scotland (57), Wales (32), and Northern Ireland (18).',
    contact: 'https://geoportal.statistics.gov.uk/',
  },

  /**
   * CANADA
   * Federal Electoral Districts (Ridings)
   */
  CA: {
    country: 'CA',
    countryName: 'Canada',
    provider: 'canada-provider',
    dataSource: 'Elections Canada / Statistics Canada',
    apiType: 'rest-custom',
    license: 'OGL-CA',
    updateSchedule: 'event-driven',
    layers: {
      federal: {
        endpoint: 'https://represent.opennorth.ca/boundaries/federal-electoral-districts/',
        expectedCount: 338,
        vintage: 2023,
        lastVerified: '2025-12-17',
        notes:
          '2023 Representation Order (post-2021 census redistribution). Next redistribution post-2031 census.',
      },
    },
    notes:
      'Represent API (Open North) provides REST interface to Elections Canada data. Federal electoral districts updated every ~10 years following census. Includes bilingual names (English + French).',
    contact: 'https://represent.opennorth.ca/',
  },
};

// ============================================================================
// Registry Functions
// ============================================================================

/**
 * Get all countries with international boundary data
 */
export function getInternationalCountries(): InternationalPortalConfig[] {
  return Object.values(INTERNATIONAL_PORTALS);
}

/**
 * Get portal config for a specific country
 */
export function getInternationalPortal(countryCode: string): InternationalPortalConfig | undefined {
  return INTERNATIONAL_PORTALS[countryCode.toUpperCase()];
}

/**
 * Get layer endpoint for a specific country and layer type
 */
export function getInternationalLayerEndpoint(
  countryCode: string,
  layerType: string
): InternationalLayerConfig | undefined {
  const portal = getInternationalPortal(countryCode);
  return portal?.layers[layerType];
}

/**
 * Check if a country has international boundary data
 */
export function hasInternationalData(countryCode: string): boolean {
  return countryCode.toUpperCase() in INTERNATIONAL_PORTALS;
}

/**
 * Get total expected boundary count across all international sources
 */
export function getTotalInternationalBoundaries(): number {
  return Object.values(INTERNATIONAL_PORTALS).reduce((total, portal) => {
    const layerTotals = Object.values(portal.layers).reduce(
      (sum, layer) => sum + layer.expectedCount,
      0
    );
    return total + layerTotals;
  }, 0);
}
