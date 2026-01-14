/**
 * Canada Federal Electoral Districts Provider
 *
 * Fetches boundary data from Represent API (Open North) and Statistics Canada.
 *
 * DATA SOURCES:
 * - Primary: Represent API (Open North) - REST API with geocoding
 * - Secondary: Statistics Canada shapefiles (backup)
 *
 * API TYPE: REST (custom)
 * LICENSE: Open Government License - Canada (OGL-CA)
 *
 * COVERAGE:
 * - Federal Electoral Districts: 338 (2023 Representation Order, post-2021 census)
 * - Covers: All provinces and territories
 *
 * USAGE:
 * ```typescript
 * const provider = new CanadaBoundaryProvider();
 *
 * // Extract all federal electoral districts
 * const result = await provider.extractFederalDistricts();
 * console.log(`Extracted ${result.actualCount}/${result.expectedCount} districts`);
 *
 * // Resolve address to electoral district (Represent API feature)
 * const district = await provider.resolveAddressToDistrict(45.4215, -75.6972);
 * console.log(`District: ${district?.name} (${district?.nameFr})`);
 *
 * // Extract by province
 * const ontario = await provider.extractByProvince('ON');
 * ```
 *
 * API ENDPOINTS:
 * - Represent API: https://represent.opennorth.ca/boundaries/federal-electoral-districts/
 * - Statistics Canada: https://www12.statcan.gc.ca/census-recensement/2021/geo
 *
 * NOTES:
 * - 2023 Representation Order implemented (post-2021 census redistribution)
 * - Federal boundaries updated every ~10 years following census
 * - Next scheduled redistribution: Post-2031 census
 * - Represent API provides bilingual names (English + French)
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
// Canada-Specific Types
// ============================================================================

/**
 * Canada layer types
 */
export type CanadaLayerType = 'federal';

/**
 * Canada province/territory codes (ISO 3166-2:CA)
 */
export type CanadaProvince =
  | 'AB' // Alberta
  | 'BC' // British Columbia
  | 'MB' // Manitoba
  | 'NB' // New Brunswick
  | 'NL' // Newfoundland and Labrador
  | 'NS' // Nova Scotia
  | 'NT' // Northwest Territories
  | 'NU' // Nunavut
  | 'ON' // Ontario
  | 'PE' // Prince Edward Island
  | 'QC' // Quebec
  | 'SK' // Saskatchewan
  | 'YT'; // Yukon

/**
 * Canada federal electoral district (riding)
 */
export interface CanadaRiding {
  /** Federal Electoral District code (e.g., '35001' for Ontario riding) */
  readonly id: string;

  /** District name (English) */
  readonly name: string;

  /** Boundary type */
  readonly type: CanadaLayerType;

  /** District name (French) */
  readonly nameFr: string;

  /** Province/territory code */
  readonly province: CanadaProvince;

  /** GeoJSON geometry */
  readonly geometry: Polygon | MultiPolygon;

  /** Source metadata */
  readonly source: {
    readonly country: 'CA';
    readonly dataSource: 'Elections Canada / Statistics Canada';
    readonly endpoint: string;
    readonly vintage: number;
    readonly retrievedAt: string;
    readonly authority: 'electoral-commission';
  };

  /** Original properties from data source */
  readonly properties: Record<string, unknown>;
}

/**
 * Canada extraction result
 */
export interface CanadaExtractionResult extends LayerExtractionResult {
  readonly layer: CanadaLayerType;
  readonly boundaries: readonly CanadaRiding[];
}

/**
 * Resolved district from geocoding
 */
export interface ResolvedDistrict {
  readonly id: string;
  readonly name: string;
  readonly nameFr: string;
  readonly province: CanadaProvince;
}

/**
 * Represent API boundary response
 */
interface RepresentBoundary {
  readonly boundary_set_name: string;
  readonly external_id: string;
  readonly name: string;
  readonly name_fr?: string;
  readonly related?: {
    readonly province_code?: string;
  };
  readonly simple_shape?: {
    readonly type: string;
    readonly coordinates: number[][][] | number[][][][];
  };
}

/**
 * Represent API boundaries list response
 */
interface RepresentBoundariesResponse {
  readonly objects: readonly RepresentBoundary[];
  readonly meta?: {
    readonly total_count?: number;
    readonly next?: string | null;
  };
}

/**
 * Represent API point-in-polygon response
 */
interface RepresentPointResponse {
  readonly boundaries_centroid?: readonly RepresentBoundary[];
}

// ============================================================================
// Canada Boundary Provider
// ============================================================================

/**
 * Canada Federal Electoral Districts Provider
 */
export class CanadaBoundaryProvider extends BaseInternationalProvider<
  CanadaLayerType,
  CanadaRiding
> {
  readonly country = 'CA';
  readonly countryName = 'Canada';
  readonly dataSource = 'Elections Canada / Statistics Canada';
  readonly apiType = 'rest-api' as const;
  readonly license = 'OGL-CA';

  private readonly representApiUrl = 'https://represent.opennorth.ca';

  /**
   * Available boundary layers
   */
  readonly layers: ReadonlyMap<CanadaLayerType, LayerConfig<CanadaLayerType>> = new Map([
    [
      'federal',
      {
        name: 'Federal Electoral Districts',
        type: 'federal',
        endpoint: 'https://represent.opennorth.ca/boundaries/federal-electoral-districts/',
        expectedCount: 338,
        updateSchedule: 'event-driven',
        authority: 'electoral-commission',
        vintage: 2023,
        lastVerified: '2023-10-01T00:00:00.000Z',
      },
    ],
  ]);

  constructor(options?: { retryAttempts?: number; retryDelayMs?: number }) {
    super(options);
  }

  /**
   * Extract all available layers
   */
  async extractAll(): Promise<InternationalExtractionResult<CanadaLayerType, CanadaRiding>> {
    const startTime = Date.now();
    const federal = await this.extractLayer('federal');

    return {
      country: this.country,
      layers: [federal],
      totalBoundaries: federal.actualCount,
      successfulLayers: federal.success ? 1 : 0,
      failedLayers: federal.success ? 0 : 1,
      extractedAt: new Date(),
      providerVersion: '1.0.0',
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Extract specified layer
   */
  async extractLayer(
    layerType: CanadaLayerType
  ): Promise<LayerExtractionResult<CanadaLayerType, CanadaRiding>> {
    switch (layerType) {
      case 'federal':
        return this.extractFederalDistricts();
      default:
        throw new Error(`Unsupported layer type: ${layerType}`);
    }
  }

  /**
   * Extract federal electoral districts
   */
  async extractFederalDistricts(): Promise<CanadaExtractionResult> {
    const startTime = Date.now();
    const layer = this.layers.get('federal')!;
    const endpoint = layer.endpoint;

    try {
      logger.info('Extracting federal electoral districts', { country: 'Canada' });
      const ridings = await this.fetchAllRidings(endpoint);
      const durationMs = Date.now() - startTime;

      logger.info('Federal extraction complete', {
        country: 'Canada',
        ridingCount: ridings.length,
        expectedCount: layer.expectedCount,
        durationMs
      });

      return {
        layer: 'federal',
        success: true,
        boundaries: ridings,
        expectedCount: layer.expectedCount,
        actualCount: ridings.length,
        matched: ridings.length === layer.expectedCount,
        confidence: this.calculateConfidence(
          ridings.length,
          layer.expectedCount,
          layer.vintage,
          layer.authority
        ),
        extractedAt: new Date(),
        source: endpoint,
        durationMs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Federal extraction failed', { country: 'Canada', error: message });

      return (this.createFailedResult(
        'federal',
        message,
        layer.expectedCount,
        endpoint,
        startTime
      ) as unknown) as CanadaExtractionResult;
    }
  }

  /**
   * Resolve address to electoral district using Represent API geocoding
   *
   * @param lat - Latitude
   * @param lng - Longitude
   * @returns Resolved district or null if not found
   */
  async resolveAddressToDistrict(lat: number, lng: number): Promise<ResolvedDistrict | null> {
    try {
      const url = `${this.representApiUrl}/boundaries/?contains=${lat},${lng}&sets=federal-electoral-districts`;
      logger.info('Resolving address to district', { country: 'Canada', lat, lng });

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as RepresentPointResponse;
      const boundaries = data.boundaries_centroid ?? [];

      if (boundaries.length === 0) {
        return null;
      }

      const boundary = boundaries[0];
      return {
        id: boundary.external_id,
        name: boundary.name,
        nameFr: boundary.name_fr ?? boundary.name,
        province: (boundary.related?.province_code as CanadaProvince) ?? 'ON',
      };
    } catch (error) {
      logger.error('Address resolution failed', {
        country: 'Canada',
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Extract all boundaries for a province
   */
  async extractByProvince(provinceCode: CanadaProvince): Promise<CanadaExtractionResult> {
    const startTime = Date.now();
    const layer = this.layers.get('federal')!;
    const endpoint = layer.endpoint;

    try {
      logger.info('Extracting federal districts by province', {
        country: 'Canada',
        province: provinceCode
      });
      const allRidings = await this.fetchAllRidings(endpoint);
      const provincialRidings = allRidings.filter((r) => r.province === provinceCode);
      const durationMs = Date.now() - startTime;

      logger.info('Province extraction complete', {
        country: 'Canada',
        province: provinceCode,
        ridingCount: provincialRidings.length,
        durationMs
      });

      return {
        layer: 'federal',
        success: true,
        boundaries: provincialRidings,
        expectedCount: provincialRidings.length, // No fixed expectation for provinces
        actualCount: provincialRidings.length,
        matched: true,
        confidence: 100, // Partial extract, assume 100 for subset
        extractedAt: new Date(),
        source: endpoint,
        durationMs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Province extraction failed', {
        country: 'Canada',
        province: provinceCode,
        error: message
      });

      return (this.createFailedResult(
        'federal',
        message,
        0,
        endpoint,
        startTime
      ) as unknown) as CanadaExtractionResult;
    }
  }

  /**
   * Check if data has changed since last extraction
   */
  async hasChangedSince(lastExtraction: Date): Promise<boolean> {
    // Represent API doesn't provide lastEditDate
    // Conservatively return true (assume changed)
    // In production, could check against Elections Canada announcements
    return super.hasChangedSince(lastExtraction);
  }

  /**
   * Health check for provider availability
   */
  async healthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();
    const issues: string[] = [];

    try {
      const url = `${this.representApiUrl}/boundaries/federal-electoral-districts/?limit=1`;
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
        },
      });

      if (!response.ok) {
        issues.push(`HTTP ${response.status}: ${response.statusText}`);
        return {
          available: false,
          latencyMs: Date.now() - startTime,
          lastChecked: new Date(),
          issues,
        };
      }

      const data = (await response.json()) as RepresentBoundariesResponse;
      const latencyMs = Date.now() - startTime;

      // Check if we got valid data
      if (!data.objects || data.objects.length === 0) {
        issues.push('API returned zero boundaries');
      }

      return {
        available: true,
        latencyMs,
        lastChecked: new Date(),
        issues,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`Failed to connect: ${message}`);

      return {
        available: false,
        latencyMs: Date.now() - startTime,
        lastChecked: new Date(),
        issues,
      };
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Fetch all ridings from Represent API (handles pagination)
   */
  private async fetchAllRidings(endpoint: string): Promise<CanadaRiding[]> {
    const ridings: CanadaRiding[] = [];
    let nextUrl: string | null = `${endpoint}?limit=100`;

    while (nextUrl) {
      try {
        logger.debug('Fetching ridings', { url: nextUrl });
        const response = await fetch(nextUrl, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = (await response.json()) as RepresentBoundariesResponse;

        // Normalize each boundary
        for (const boundary of data.objects) {
          const riding = this.normalizeBoundary(boundary, endpoint);
          if (riding) {
            ridings.push(riding);
          }
        }

        // Check for pagination
        nextUrl = data.meta?.next ?? null;
        if (nextUrl && !nextUrl.startsWith('http')) {
          nextUrl = `${this.representApiUrl}${nextUrl}`;
        }
      } catch (err) {
        logger.warn('Error fetching ridings', {
          url: nextUrl,
          error: err instanceof Error ? err.message : String(err)
        });
        // If we haven't fetched any data yet, propagate the error
        // If we have partial data, return what we have (partial success)
        if (ridings.length === 0) {
          throw err;
        }
        break;
      }
    }

    return ridings;
  }

  /**
   * Normalize Represent API boundary to CanadaRiding format
   */
  private normalizeBoundary(boundary: RepresentBoundary, endpoint: string): CanadaRiding | null {
    // Must have geometry
    if (!boundary.simple_shape) {
      return null;
    }

    // Represent API provides simplified geometries
    // Convert to GeoJSON Polygon/MultiPolygon
    const geometry = this.convertToGeoJSON(boundary.simple_shape);
    if (!geometry) {
      return null;
    }

    return {
      id: boundary.external_id,
      name: boundary.name,
      nameFr: boundary.name_fr ?? boundary.name,
      type: 'federal',
      province: (boundary.related?.province_code as CanadaProvince) ?? 'ON',
      geometry,
      source: {
        country: 'CA',
        dataSource: 'Elections Canada / Statistics Canada',
        endpoint,
        vintage: 2023,
        retrievedAt: new Date().toISOString(),
        authority: 'electoral-commission',
      },
      properties: {
        boundary_set_name: boundary.boundary_set_name,
        external_id: boundary.external_id,
        province_code: boundary.related?.province_code,
      },
    };
  }

  /**
   * Convert Represent API simple_shape to GeoJSON geometry
   */
  private convertToGeoJSON(
    shape: RepresentBoundary['simple_shape']
  ): Polygon | MultiPolygon | null {
    if (!shape) return null;

    // Represent API uses GeoJSON-like format
    if (shape.type === 'Polygon') {
      return {
        type: 'Polygon',
        coordinates: shape.coordinates as number[][][],
      };
    }

    if (shape.type === 'MultiPolygon') {
      return {
        type: 'MultiPolygon',
        coordinates: shape.coordinates as number[][][][],
      };
    }

    return null;
  }
}
