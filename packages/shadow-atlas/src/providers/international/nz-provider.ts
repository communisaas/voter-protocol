/**
 * New Zealand Electoral Districts Provider
 *
 * Fetches boundary data from Stats NZ (Statistics New Zealand) WFS services.
 *
 * DATA SOURCE:
 * - Organization: Statistics New Zealand (Stats NZ)
 * - API Type: WFS (OGC Web Feature Service) + ArcGIS REST
 * - Format: GeoJSON via WFS or f=geojson parameter
 * - License: Creative Commons Attribution 4.0 International
 *
 * COVERAGE:
 * - General Electorates: 65 (as of 2025 boundary review)
 * - Māori Electorates: 7 (dedicated representation for Māori voters)
 * - Covers: North Island, South Island, Chatham Islands
 *
 * USAGE:
 * ```typescript
 * const provider = new NewZealandBoundaryProvider();
 *
 * // Extract all electoral districts
 * const result = await provider.extractAll();
 * console.log(`Extracted ${result.totalBoundaries}/72 electorates`);
 *
 * // Check for upstream changes
 * const hasChanged = await provider.hasChangedSince(lastExtraction);
 *
 * // Health check
 * const health = await provider.healthCheck();
 * ```
 *
 * API ENDPOINTS:
 * - General Electorates: https://datafinder.stats.govt.nz/layer/122741-general-electorates-2025/
 * - Māori Electorates: https://datafinder.stats.govt.nz/layer/122742-maori-electorates-2025/
 *
 * NOTES:
 * - 2025 boundary review finalized August 2025
 * - Data updates are event-driven (following boundary reviews)
 * - Next scheduled review: Post-2028 census
 * - Māori electorates provide dedicated representation (Electoral Act 1993)
 *
 * SOURCES:
 * - Stats NZ Boundary Review: https://www.stats.govt.nz/news/final-electorate-names-and-boundaries-released/
 * - Elections NZ Maps: https://elections.nz/democracy-in-nz/historical-events/boundary-review-2025/electorate-maps/
 * - Stats NZ Geographic Data Service: https://datafinder.stats.govt.nz/group/census/data/category/electorates/
 */

import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import {
  BaseInternationalProvider,
  type InternationalBoundaryProvider,
  type InternationalExtractionResult,
  type LayerConfig,
  type ProviderHealth,
  type LayerExtractionResult,
} from './base-provider.js';

// ============================================================================
// NZ-Specific Types
// ============================================================================

/**
 * NZ layer types
 */
export type NZLayerType = 'general' | 'maori';

/**
 * NZ region (North Island, South Island, Chatham Islands)
 */
export type NZRegion = 'North Island' | 'South Island' | 'Chatham Islands';

/**
 * NZ electoral district
 */
export interface NZElectorate {
  /** Stats NZ electorate code (e.g., '1' for Northland, '72' for Te Tai Tonga) */
  readonly id: string;

  /** Electorate name (e.g., 'Auckland Central', 'Te Tai Tonga') */
  readonly name: string;

  /** Boundary type */
  readonly type: NZLayerType;

  /** Region */
  readonly region: NZRegion;

  /** Population (2023 census) */
  readonly population?: number;

  /** GeoJSON geometry */
  readonly geometry: Polygon | MultiPolygon;

  /** Source metadata */
  readonly source: {
    readonly country: 'NZ';
    readonly dataSource: 'Stats NZ';
    readonly endpoint: string;
    readonly vintage: number;
    readonly retrievedAt: string;
    readonly authority: 'national-statistics';
  };

  /** Original properties from Stats NZ */
  readonly properties: Record<string, unknown>;
}

/**
 * NZ extraction result
 */
export interface NZExtractionResult extends LayerExtractionResult {
  readonly layer: NZLayerType;
  readonly boundaries: readonly NZElectorate[];
}

/**
 * Layer metadata from Stats NZ service
 */
export interface LayerMetadata {
  readonly name: string;
  readonly description: string;
  readonly geometryType: string;
  readonly featureCount: number;
  readonly maxRecordCount: number;
  readonly lastEditDate?: number;
}

// ============================================================================
// NZ Boundary Provider
// ============================================================================

/**
 * New Zealand Electoral Districts Provider
 */
export class NewZealandBoundaryProvider extends BaseInternationalProvider<
  NZLayerType,
  NZElectorate
> {
  readonly country = 'NZ';
  readonly countryName = 'New Zealand';
  readonly dataSource = 'Stats NZ (Statistics New Zealand)';
  readonly apiType = 'arcgis-rest' as const;
  readonly license = 'CC-BY-4.0';

  private readonly baseUrl = 'https://datafinder.stats.govt.nz/services';

  /**
   * Available boundary layers
   *
   * EXPECTED COUNTS (2025 boundary review):
   * - General Electorates: 65 (North Island: 49, South Island: 16)
   * - Māori Electorates: 7 (Te Tai Tokerau, Tāmaki Makaurau, Hauraki-Waikato,
   *   Waiariki, Ikaroa-Rāwhiti, Te Tai Hauāuru, Te Tai Tonga)
   *
   * TOTAL: 72 electorates
   *
   * Source: https://www.stats.govt.nz/news/final-electorate-names-and-boundaries-released/
   */
  readonly layers: ReadonlyMap<NZLayerType, LayerConfig<NZLayerType>> = new Map([
    [
      'general',
      {
        type: 'general',
        name: 'General_Electorates_2025',
        endpoint: 'https://datafinder.stats.govt.nz/services/hosted/122741_general_electorates_2025/FeatureServer/0',
        expectedCount: 65,
        updateSchedule: 'event-driven',
        authority: 'national-statistics',
        vintage: 2025,
        lastVerified: '2025-08-08T00:00:00.000Z',
      },
    ],
    [
      'maori',
      {
        type: 'maori',
        name: 'Maori_Electorates_2025',
        endpoint: 'https://datafinder.stats.govt.nz/services/hosted/122742_maori_electorates_2025/FeatureServer/0',
        expectedCount: 7,
        updateSchedule: 'event-driven',
        authority: 'national-statistics',
        vintage: 2025,
        lastVerified: '2025-08-08T00:00:00.000Z',
      },
    ],
  ]);

  constructor(options?: { retryAttempts?: number; retryDelayMs?: number }) {
    super(options);
  }

  /**
   * Extract all available layers
   */
  async extractAll(): Promise<InternationalExtractionResult<NZLayerType, NZElectorate>> {
    const startTime = Date.now();

    // Extract both general and Māori electorates in parallel
    const [general, maori] = await Promise.all([
      this.extractLayer('general'),
      this.extractLayer('maori'),
    ]);

    const totalBoundaries = general.actualCount + maori.actualCount;
    const successfulLayers = (general.success ? 1 : 0) + (maori.success ? 1 : 0);

    return {
      country: this.country,
      layers: [general, maori],
      totalBoundaries,
      successfulLayers,
      failedLayers: 2 - successfulLayers,
      extractedAt: new Date(),
      providerVersion: '1.0.0',
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Extract specific layer
   */
  async extractLayer(layerType: NZLayerType): Promise<LayerExtractionResult<NZLayerType, NZElectorate>> {
    switch (layerType) {
      case 'general':
        return this.extractGeneralElectorates();
      case 'maori':
        return this.extractMaoriElectorates();
      default:
        throw new Error(`Unsupported layer type: ${layerType}`);
    }
  }

  /**
   * Extract general electorates
   */
  private async extractGeneralElectorates(): Promise<NZExtractionResult> {
    const layerConfig = this.layers.get('general');
    if (!layerConfig) {
      throw new Error('General electorate layer not configured');
    }

    const geojson = await this.fetchArcGISFeatureService(layerConfig.endpoint);

    const electorates: NZElectorate[] = geojson.features.map((feature) => {
      const props = feature.properties || {};

      return {
        id: String(props.electorate_code || props.ELECTORATE_CODE || props.id || ''),
        name: String(props.electorate_name || props.ELECTORATE_NAME || props.name || 'Unknown'),
        type: 'general' as const,
        region: this.inferRegion(props),
        population: this.parsePopulation(props),
        geometry: feature.geometry as Polygon | MultiPolygon,
        source: {
          country: 'NZ',
          dataSource: 'Stats NZ',
          endpoint: layerConfig.endpoint,
          vintage: layerConfig.vintage,
          retrievedAt: new Date().toISOString(),
          authority: 'national-statistics',
        },
        properties: props,
      };
    });

    const validationErrors = this.validateCounts('general', electorates.length, layerConfig.expectedCount);
    const matched = electorates.length === layerConfig.expectedCount;
    const confidence = matched ? 100 : Math.max(0, 100 - (Math.abs(electorates.length - layerConfig.expectedCount) * 10));

    return {
      layer: 'general',
      boundaries: electorates,
      success: true,
      expectedCount: layerConfig.expectedCount,
      actualCount: electorates.length,
      matched,
      confidence,
      extractedAt: new Date(),
      source: layerConfig.endpoint,
      durationMs: 0, // Will be set by caller
      error: validationErrors.length > 0 ? validationErrors.join('; ') : undefined,
    };
  }

  /**
   * Extract Māori electorates
   */
  private async extractMaoriElectorates(): Promise<NZExtractionResult> {
    const layerConfig = this.layers.get('maori');
    if (!layerConfig) {
      throw new Error('Māori electorate layer not configured');
    }

    const geojson = await this.fetchArcGISFeatureService(layerConfig.endpoint);

    const electorates: NZElectorate[] = geojson.features.map((feature) => {
      const props = feature.properties || {};

      return {
        id: String(props.electorate_code || props.ELECTORATE_CODE || props.id || ''),
        name: String(props.electorate_name || props.ELECTORATE_NAME || props.name || 'Unknown'),
        type: 'maori' as const,
        region: this.inferRegion(props),
        population: this.parsePopulation(props),
        geometry: feature.geometry as Polygon | MultiPolygon,
        source: {
          country: 'NZ',
          dataSource: 'Stats NZ',
          endpoint: layerConfig.endpoint,
          vintage: layerConfig.vintage,
          retrievedAt: new Date().toISOString(),
          authority: 'national-statistics',
        },
        properties: props,
      };
    });

    const validationErrors = this.validateCounts('maori', electorates.length, layerConfig.expectedCount);
    const matched = electorates.length === layerConfig.expectedCount;
    const confidence = matched ? 100 : Math.max(0, 100 - (Math.abs(electorates.length - layerConfig.expectedCount) * 10));

    return {
      layer: 'maori',
      boundaries: electorates,
      success: true,
      expectedCount: layerConfig.expectedCount,
      actualCount: electorates.length,
      matched,
      confidence,
      extractedAt: new Date(),
      source: layerConfig.endpoint,
      durationMs: 0, // Will be set by caller
      error: validationErrors.length > 0 ? validationErrors.join('; ') : undefined,
    };
  }

  /**
   * Fetch GeoJSON from ArcGIS FeatureServer
   */
  private async fetchArcGISFeatureService(endpoint: string): Promise<FeatureCollection> {
    // ArcGIS REST API query parameters for full extraction
    const params = new URLSearchParams({
      where: '1=1',
      outFields: '*',
      f: 'geojson',
      returnGeometry: 'true',
    });

    const url = `${endpoint}/query?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ShadowAtlas/1.0 (NZ Electoral Districts Extraction)',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const geojson = await response.json() as FeatureCollection;

    if (!geojson.features || geojson.features.length === 0) {
      throw new Error('No features returned from Stats NZ service');
    }

    return geojson;
  }

  /**
   * Infer region from properties
   */
  private inferRegion(props: Record<string, unknown>): NZRegion {
    const name = String(props.electorate_name || props.ELECTORATE_NAME || '').toLowerCase();
    const region = String(props.region || props.REGION || '').toLowerCase();

    // Chatham Islands is its own region
    if (name.includes('chatham') || region.includes('chatham')) {
      return 'Chatham Islands';
    }

    // South Island regions: Canterbury, Otago, Southland, West Coast, etc.
    const southIslandRegions = [
      'canterbury', 'otago', 'southland', 'west coast', 'marlborough',
      'nelson', 'tasman', 'christchurch', 'dunedin', 'invercargill'
    ];

    if (southIslandRegions.some(r => region.includes(r) || name.includes(r))) {
      return 'South Island';
    }

    // Default to North Island (most electorates)
    return 'North Island';
  }

  /**
   * Parse population from properties
   */
  private parsePopulation(props: Record<string, unknown>): number | undefined {
    const population = props.population || props.POPULATION || props.pop_2023 || props.POP_2023;

    if (typeof population === 'number') {
      return population;
    }

    if (typeof population === 'string') {
      const parsed = parseInt(population, 10);
      return isNaN(parsed) ? undefined : parsed;
    }

    return undefined;
  }

  /**
   * Validate feature counts against expected
   */
  private validateCounts(
    layerType: NZLayerType,
    actualCount: number,
    expectedCount: number
  ): string[] {
    const errors: string[] = [];

    if (actualCount !== expectedCount) {
      errors.push(
        `Count mismatch for ${layerType} electorates: expected ${expectedCount}, got ${actualCount}`
      );
    }

    if (actualCount === 0) {
      errors.push(`No ${layerType} electorates extracted`);
    }

    return errors;
  }

  /**
   * Count duplicate IDs
   */
  private countDuplicates(ids: string[]): number {
    const seen = new Set<string>();
    let duplicates = 0;

    for (const id of ids) {
      if (seen.has(id)) {
        duplicates++;
      } else {
        seen.add(id);
      }
    }

    return duplicates;
  }

  /**
   * Check for upstream changes
   */
  async hasChangedSince(lastExtraction: Date): Promise<boolean> {
    // Stats NZ doesn't provide Last-Modified headers on FeatureServer endpoints
    // We'll check feature counts as a proxy for changes
    try {
      const [generalConfig, maoriConfig] = [
        this.layers.get('general'),
        this.layers.get('maori'),
      ];

      if (!generalConfig || !maoriConfig) {
        return false;
      }

      // Query feature counts
      const generalCount = await this.fetchFeatureCount(generalConfig.endpoint);
      const maoriCount = await this.fetchFeatureCount(maoriConfig.endpoint);

      // If counts don't match expected, data has changed
      const hasChanged =
        generalCount !== generalConfig.expectedCount ||
        maoriCount !== maoriConfig.expectedCount;

      return hasChanged;
    } catch (error) {
      console.warn('[NZ Provider] Change detection failed:', error);
      return false;
    }
  }

  /**
   * Fetch feature count from ArcGIS service
   */
  private async fetchFeatureCount(endpoint: string): Promise<number> {
    const params = new URLSearchParams({
      where: '1=1',
      returnCountOnly: 'true',
      f: 'json',
    });

    const url = `${endpoint}/query?${params.toString()}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json() as { count?: number };
    return data.count || 0;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();
    const issues: string[] = [];

    try {
      // Check both endpoints
      const [generalConfig, maoriConfig] = [
        this.layers.get('general'),
        this.layers.get('maori'),
      ];

      if (!generalConfig || !maoriConfig) {
        throw new Error('Layer configuration missing');
      }

      // Test connectivity to both services
      const [generalCount, maoriCount] = await Promise.all([
        this.fetchFeatureCount(generalConfig.endpoint),
        this.fetchFeatureCount(maoriConfig.endpoint),
      ]);

      // Validate counts
      if (generalCount !== generalConfig.expectedCount) {
        issues.push(`General electorate count mismatch: expected ${generalConfig.expectedCount}, got ${generalCount}`);
      }

      if (maoriCount !== maoriConfig.expectedCount) {
        issues.push(`Māori electorate count mismatch: expected ${maoriConfig.expectedCount}, got ${maoriCount}`);
      }

      const latencyMs = Date.now() - startTime;

      return {
        available: issues.length === 0,
        latencyMs,
        lastChecked: new Date(),
        issues,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        available: false,
        latencyMs: Date.now() - startTime,
        lastChecked: new Date(),
        issues: [`Health check failed: ${message}`],
      };
    }
  }

  /**
   * Get expected counts for all layers
   */
  async getExpectedCounts(): Promise<ReadonlyMap<NZLayerType, number>> {
    return new Map([
      ['general', 65],
      ['maori', 7],
    ]);
  }
}
