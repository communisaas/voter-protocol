/**
 * UK Parliamentary Constituencies Provider
 *
 * Fetches boundary data from ONS (Office for National Statistics) ArcGIS services.
 *
 * DATA SOURCE:
 * - Organization: Office for National Statistics (ONS)
 * - API Type: ArcGIS REST
 * - Format: GeoJSON via f=geojson parameter
 * - License: Open Government License (OGL)
 *
 * COVERAGE:
 * - Westminster Parliamentary Constituencies: 650 (as of July 2024 boundary review)
 * - Covers: England, Scotland, Wales, Northern Ireland
 *
 * USAGE:
 * ```typescript
 * const provider = new UKBoundaryProvider();
 *
 * // Extract all parliamentary constituencies
 * const result = await provider.extractParliamentaryConstituencies();
 * console.log(`Extracted ${result.actualCount}/${result.expectedCount} constituencies`);
 *
 * // Check for upstream changes
 * const hasChanged = await provider.hasChangedSince(lastExtraction);
 *
 * // Health check
 * const health = await provider.healthCheck();
 * ```
 *
 * API ENDPOINT:
 * https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BFC/FeatureServer/0
 *
 * NOTES:
 * - July 2024 boundary review implemented new constituency boundaries
 * - Data updates are event-driven (following boundary reviews)
 * - Next scheduled review: Post-2031 census
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
import { logger } from '../../core/utils/logger.js';

// ============================================================================
// UK-Specific Types
// ============================================================================

/**
 * UK layer types
 */
export type UKLayerType = 'parliamentary';

/**
 * UK country subdivision
 */
export type UKCountry = 'England' | 'Scotland' | 'Wales' | 'Northern Ireland';

/**
 * UK parliamentary constituency
 */
export interface UKConstituency {
  /** ONS code (e.g., 'E14001234' for England, 'S14000001' for Scotland) */
  readonly id: string;

  /** Constituency name (e.g., 'Aberavon', 'Aberdeen North') */
  readonly name: string;

  /** Boundary type (e.g., 'parliamentary') */
  readonly type: UKLayerType;

  /** Country within UK */
  readonly country: UKCountry;

  /** English region (England only) */
  readonly region?: string;

  /** GeoJSON geometry */
  readonly geometry: Polygon | MultiPolygon;

  /** Source metadata */
  readonly source: {
    readonly country: 'GB';
    readonly dataSource: 'ONS';
    readonly endpoint: string;
    readonly vintage: number;
    readonly retrievedAt: string;
    readonly authority: 'national-statistics';
  };

  /** Original properties from ONS */
  readonly properties: Record<string, unknown>;
}

/**
 * UK extraction result
 */
export interface UKExtractionResult extends LayerExtractionResult {
  readonly layer: UKLayerType;
  readonly boundaries: readonly UKConstituency[];
}

/**
 * Layer metadata from ArcGIS service
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
// UK Boundary Provider
// ============================================================================

/**
 * UK Parliamentary Constituencies Provider
 */
/**
 * UK Parliamentary Constituencies Provider
 */
export class UKBoundaryProvider extends BaseInternationalProvider<
  UKLayerType,
  UKConstituency
> {
  readonly country = 'GB';
  readonly countryName = 'United Kingdom';
  readonly dataSource = 'ONS (Office for National Statistics)';
  readonly apiType = 'arcgis-rest' as const;
  readonly license = 'OGL';

  private readonly baseUrl = 'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services';

  /**
   * Available boundary layers
   */
  readonly layers: ReadonlyMap<UKLayerType, LayerConfig<UKLayerType>> = new Map([
    [
      'parliamentary',
      {
        type: 'parliamentary',
        name: 'Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BFC',
        endpoint: 'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BFC/FeatureServer/0',
        expectedCount: 650,
        updateSchedule: 'event-driven',
        authority: 'national-statistics',
        vintage: 2024,
        lastVerified: '2024-07-04T00:00:00.000Z',
      },
    ],
  ]);

  constructor(options?: { retryAttempts?: number; retryDelayMs?: number }) {
    super(options);
  }

  /**
   * Extract all available layers
   */
  /**
   * Extract all available layers
   */
  async extractAll(): Promise<InternationalExtractionResult<UKLayerType, UKConstituency>> {
    const startTime = Date.now();
    const parliamentary = await this.extractLayer('parliamentary');

    return {
      country: this.country,
      layers: [parliamentary],
      totalBoundaries: parliamentary.actualCount,
      successfulLayers: parliamentary.success ? 1 : 0,
      failedLayers: parliamentary.success ? 0 : 1,
      extractedAt: new Date(),
      providerVersion: '1.0.0',
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Extract specific layer
   */
  async extractLayer(layerType: UKLayerType): Promise<LayerExtractionResult<UKLayerType, UKConstituency>> {
    switch (layerType) {
      case 'parliamentary':
        return this.extractParliamentaryConstituencies();
      default:
        throw new Error(`Unsupported layer type: ${layerType}`);
    }
  }

  /**
   * Extract parliamentary constituencies
   */
  async extractParliamentaryConstituencies(): Promise<UKExtractionResult> {
    const startTime = Date.now();
    const layer = this.layers.get('parliamentary');

    if (!layer) {
      throw new Error('Parliamentary layer configuration missing');
    }

    const endpoint = this.buildLayerEndpoint(layer.name);

    try {
      logger.info('Extracting parliamentary constituencies', { country: 'UK' });
      const geojson = await this.fetchGeoJSON(endpoint);
      const constituencies = this.normalizeConstituencies(geojson, endpoint);
      const durationMs = Date.now() - startTime;

      logger.info('Parliamentary extraction complete', {
        country: 'UK',
        constituencyCount: constituencies.length,
        expectedCount: layer.expectedCount,
        durationMs
      });

      // Calculate confidence
      const confidence = this.calculateConfidence(
        constituencies.length,
        layer.expectedCount,
        layer.vintage,
        layer.authority
      );

      return {
        layer: 'parliamentary',
        success: true,
        boundaries: constituencies,
        expectedCount: layer.expectedCount,
        actualCount: constituencies.length,
        matched: constituencies.length === layer.expectedCount,
        confidence,
        extractedAt: new Date(),
        source: endpoint,
        durationMs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Parliamentary extraction failed', { country: 'UK', error: message });

      return this.createFailedResult(
        'parliamentary',
        message,
        layer.expectedCount,
        endpoint,
        startTime
      );
    }
  }

  /**
   * Check if data has changed since last extraction
   */
  /**
   * Check if data has changed since last extraction
   */
  async hasChangedSince(lastExtraction: Date): Promise<boolean> {
    try {
      const metadata = await this.getLayerMetadata('parliamentary');

      // If we have lastEditDate from ArcGIS, use it
      if (metadata.lastEditDate) {
        const lastEdit = new Date(metadata.lastEditDate);
        return lastEdit > lastExtraction;
      }

      // Fallback to base implementation (HTTP headers)
      return super.hasChangedSince(lastExtraction);
    } catch (error) {
      logger.warn('Could not check for changes', {
        country: 'UK',
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  /**
   * Health check for provider availability
   */
  async healthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();
    const issues: string[] = [];

    try {
      const metadata = await this.getLayerMetadata('parliamentary');
      const latencyMs = Date.now() - startTime;

      // Check if feature count is reasonable
      if (metadata.featureCount === 0) {
        issues.push('Layer reports zero features');
      }

      return {
        available: true,
        latencyMs,
        lastChecked: new Date(),
        issues,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`Failed to fetch metadata: ${message}`);

      return {
        available: false,
        latencyMs: Date.now() - startTime,
        lastChecked: new Date(),
        issues,
      };
    }
  }

  /**
   * Get layer metadata from ArcGIS service
   */
  async getLayerMetadata(layer: UKLayerType): Promise<LayerMetadata> {
    const layerConfig = this.layers.get(layer);

    if (!layerConfig) {
      throw new Error(`Layer configuration missing for ${layer}`);
    }

    const endpoint = this.buildLayerEndpoint(layerConfig.name);
    const metadataUrl = `${endpoint}?f=json`;

    const response = await fetch(metadataUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      name?: string;
      description?: string;
      geometryType?: string;
      count?: number;
      maxRecordCount?: number;
      editingInfo?: { lastEditDate?: number };
    };

    return {
      name: data.name ?? layerConfig.name,
      description: data.description ?? '',
      geometryType: data.geometryType ?? 'esriGeometryPolygon',
      featureCount: data.count ?? 0,
      maxRecordCount: data.maxRecordCount ?? 2000,
      lastEditDate: data.editingInfo?.lastEditDate,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Build layer endpoint URL
   */
  private buildLayerEndpoint(layerName: string): string {
    return `${this.baseUrl}/${layerName}/FeatureServer/0`;
  }

  // fetchGeoJSON inherited from BaseInternationalProvider

  /**
   * Normalize GeoJSON features to UKConstituency format
   */
  private normalizeConstituencies(geojson: FeatureCollection, endpoint: string): UKConstituency[] {
    return geojson.features
      .filter((f) => {
        // Must have valid polygon geometry
        return f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');
      })
      .map((f) => {
        const props = f.properties ?? {};

        // Extract ONS code and name
        const onsCode = String(props.PCON24CD ?? props.PCONCD ?? props.code ?? '');
        const name = String(props.PCON24NM ?? props.PCONNM ?? props.name ?? 'Unknown Constituency');

        // Determine country from ONS code prefix
        const country = this.determineCountry(onsCode);

        // Extract region (England only)
        const region = props.RGN24NM ?? props.RGNNM ?? undefined;

        return {
          id: onsCode,
          name,
          type: 'parliamentary',
          country,
          region: country === 'England' ? String(region) : undefined,
          geometry: f.geometry as Polygon | MultiPolygon,
          source: {
            country: 'GB',
            dataSource: 'ONS',
            endpoint,
            vintage: 2024,
            retrievedAt: new Date().toISOString(),
            authority: 'national-statistics',
          },
          properties: props,
        };
      });
  }

  /**
   * Determine UK country from ONS code prefix
   *
   * ONS codes follow pattern: E (England), S (Scotland), W (Wales), N (Northern Ireland)
   */
  private determineCountry(onsCode: string): UKCountry {
    const prefix = onsCode.charAt(0).toUpperCase();

    switch (prefix) {
      case 'E':
        return 'England';
      case 'S':
        return 'Scotland';
      case 'W':
        return 'Wales';
      case 'N':
        return 'Northern Ireland';
      default:
        return 'England'; // Default fallback
    }
  }
}
