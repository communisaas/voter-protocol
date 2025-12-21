/**
 * State Boundary Provider - Base Class
 *
 * Abstract base for state-level authoritative boundary providers.
 * State sources are preferred over TIGER during redistricting gaps
 * (Jan-Jun of years ending in 2) when states have finalized new maps
 * but TIGER hasn't updated yet.
 *
 * AUTHORITY HIERARCHY:
 * - state-redistricting-commission (preference 1) - Official map drawers
 * - state-redistricting (preference 2) - State redistricting portals
 * - census-tiger (preference 3) - Federal aggregator
 * - state-gis (preference 4) - State GIS clearinghouses
 *
 * IMPLEMENTATION PATTERN:
 * 1. Extend StateBoundaryProvider
 * 2. Implement abstract methods for your state's API
 * 3. Register in STATE_GIS_PORTALS
 * 4. Authority resolver automatically picks best source
 *
 * @see tiger-authority-rules.ts for precedence logic
 * @see authority-resolver.ts for conflict resolution
 */

import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * State boundary layer types
 */
export type StateBoundaryLayer =
  | 'congressional'
  | 'state_senate'
  | 'state_house'
  | 'county'
  | 'municipal';

/**
 * State GIS portal configuration
 */
export interface StateGISPortal {
  /** State FIPS code (2 digits) */
  readonly stateFips: string;

  /** State name */
  readonly stateName: string;

  /** Portal name */
  readonly portalName: string;

  /** Base URL for the portal */
  readonly baseUrl: string;

  /** Portal type (affects API strategy) */
  readonly portalType: 'arcgis-hub' | 'arcgis-server' | 'socrata' | 'ckan' | 'custom';

  /** Authority level for this source */
  readonly authorityLevel: 'state-redistricting-commission' | 'state-gis';

  /** Update frequency */
  readonly updateFrequency: 'quarterly' | 'annual' | 'event-driven' | 'manual';

  /** Available boundary layers */
  readonly availableLayers: readonly StateBoundaryLayer[];

  /** Layer-specific endpoints or dataset IDs */
  readonly layerEndpoints: Partial<Record<StateBoundaryLayer, string>>;

  /** Last verified date */
  readonly lastVerified: string;

  /** Contact email for data issues */
  readonly contactEmail?: string;
}

/**
 * Normalized state boundary (matches TIGER provider output)
 */
export interface StateNormalizedBoundary {
  readonly id: string;
  readonly name: string;
  readonly level: 'district' | 'county' | 'municipal';
  readonly geometry: Polygon | MultiPolygon;
  readonly properties: {
    readonly stateFips: string;
    readonly entityFips: string;
    readonly layer: StateBoundaryLayer;
    readonly geoid: string;
    readonly [key: string]: unknown;
  };
  readonly source: {
    readonly provider: string;
    readonly portalName: string;
    readonly authorityLevel: string;
    readonly legalStatus: 'binding' | 'advisory';
    readonly retrievedAt: string;
    readonly dataVintage?: string;
  };
}

/**
 * Download result from state portal
 */
export interface StateDownloadResult {
  readonly layer: StateBoundaryLayer;
  readonly featureCount: number;
  readonly boundaries: readonly StateNormalizedBoundary[];
  readonly metadata: {
    readonly downloadedAt: string;
    readonly sourceUrl: string;
    readonly checksum: string;
  };
}

// ============================================================================
// Abstract Base Class
// ============================================================================

/**
 * Abstract base class for state boundary providers
 *
 * Subclasses implement state-specific API logic while inheriting:
 * - Common normalization
 * - Caching strategy
 * - Error handling
 * - Retry logic
 */
export abstract class StateBoundaryProvider {
  protected readonly portal: StateGISPortal;
  protected readonly cacheDir: string;

  constructor(portal: StateGISPortal, cacheDir?: string) {
    this.portal = portal;
    this.cacheDir = cacheDir ?? `/tmp/shadow-atlas/state-cache/${portal.stateFips}`;
  }

  /**
   * Get provider metadata
   */
  get metadata(): StateGISPortal {
    return this.portal;
  }

  /**
   * Check if layer is available from this state portal
   */
  hasLayer(layer: StateBoundaryLayer): boolean {
    return this.portal.availableLayers.includes(layer);
  }

  /**
   * Download boundaries for a specific layer
   *
   * @param layer - Boundary layer to download
   * @returns Download result with normalized boundaries
   */
  abstract downloadLayer(layer: StateBoundaryLayer): Promise<StateDownloadResult>;

  /**
   * Download all available layers
   *
   * @returns Map of layer → download result
   */
  async downloadAllLayers(): Promise<Map<StateBoundaryLayer, StateDownloadResult>> {
    const results = new Map<StateBoundaryLayer, StateDownloadResult>();

    for (const layer of this.portal.availableLayers) {
      try {
        console.log(`[${this.portal.stateName}] Downloading ${layer}...`);
        const result = await this.downloadLayer(layer);
        results.set(layer, result);
        console.log(`[${this.portal.stateName}] ✓ ${layer}: ${result.featureCount} features`);
      } catch (error) {
        console.error(`[${this.portal.stateName}] ✗ ${layer}: ${error}`);
      }
    }

    return results;
  }

  /**
   * Fetch GeoJSON from URL with retry logic
   */
  protected async fetchGeoJSON(url: string, retries = 3): Promise<FeatureCollection> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`   Fetching: ${url} (attempt ${attempt}/${retries})`);

        const response = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json() as FeatureCollection;

        if (!data.features || !Array.isArray(data.features)) {
          throw new Error('Invalid GeoJSON: missing features array');
        }

        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`   Attempt ${attempt} failed: ${lastError.message}`);

        if (attempt < retries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError ?? new Error('Download failed');
  }

  /**
   * Normalize a GeoJSON feature to StateNormalizedBoundary
   */
  protected abstract normalizeFeature(
    feature: Feature,
    layer: StateBoundaryLayer
  ): StateNormalizedBoundary;

  /**
   * Transform GeoJSON collection to normalized boundaries
   */
  protected transformFeatures(
    geojson: FeatureCollection,
    layer: StateBoundaryLayer
  ): StateNormalizedBoundary[] {
    return geojson.features
      .filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
      .map(f => this.normalizeFeature(f, layer));
  }

  /**
   * Compute checksum for data integrity
   */
  protected computeChecksum(data: unknown): string {
    const str = JSON.stringify(data);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }
}

// ============================================================================
// ArcGIS Hub Provider (Common Pattern - 14 states)
// ============================================================================

/**
 * ArcGIS Hub provider implementation
 *
 * Used by: WA, OR, MN, CO, TX, FL, NY, MI, NC, VA, GA, UT, ID, WI
 *
 * API Pattern:
 * 1. Query: https://{org}.hub.arcgis.com/api/v3/datasets?q={search}
 * 2. Download: https://services.arcgis.com/{orgId}/arcgis/rest/services/{layer}/FeatureServer/0/query?where=1%3D1&f=geojson
 */
export class ArcGISHubProvider extends StateBoundaryProvider {
  /**
   * Download layer from ArcGIS Hub
   */
  async downloadLayer(layer: StateBoundaryLayer): Promise<StateDownloadResult> {
    if (!this.hasLayer(layer)) {
      throw new Error(`Layer ${layer} not available from ${this.portal.portalName}`);
    }

    const endpoint = this.portal.layerEndpoints[layer];
    if (!endpoint) {
      throw new Error(`No endpoint configured for ${layer}`);
    }

    // ArcGIS FeatureServer query endpoint
    const url = endpoint.includes('?')
      ? `${endpoint}&f=geojson`
      : `${endpoint}/query?where=1%3D1&outFields=*&f=geojson`;

    const geojson = await this.fetchGeoJSON(url);
    const boundaries = this.transformFeatures(geojson, layer);

    return {
      layer,
      featureCount: boundaries.length,
      boundaries,
      metadata: {
        downloadedAt: new Date().toISOString(),
        sourceUrl: url,
        checksum: this.computeChecksum(boundaries),
      },
    };
  }

  /**
   * Normalize ArcGIS feature
   */
  protected normalizeFeature(
    feature: Feature,
    layer: StateBoundaryLayer
  ): StateNormalizedBoundary {
    const props = feature.properties ?? {};

    // Common ArcGIS field name patterns
    const stateFips = props.STATEFP ?? props.STATE_FIPS ?? props.STATEFP20 ?? this.portal.stateFips;
    const entityFips = props.DISTRICT ?? props.DISTRICTNO ?? props.SLDUST ?? props.SLDLST ?? props.CD ?? '';
    const geoid = props.GEOID ?? props.GEOID20 ?? `${stateFips}${entityFips}`;
    const name = props.NAMELSAD ?? props.NAME ?? props.DISTRICT_NAME ?? `District ${entityFips}`;

    return {
      id: geoid,
      name,
      level: layer === 'county' ? 'county' : layer === 'municipal' ? 'municipal' : 'district',
      geometry: feature.geometry as Polygon | MultiPolygon,
      properties: {
        stateFips: String(stateFips),
        entityFips: String(entityFips),
        layer,
        geoid,
        ...props,
      },
      source: {
        provider: this.portal.authorityLevel,
        portalName: this.portal.portalName,
        authorityLevel: this.portal.authorityLevel,
        legalStatus: 'binding',
        retrievedAt: new Date().toISOString(),
      },
    };
  }
}

// ============================================================================
// Socrata Provider (CO, IL, cities)
// ============================================================================

/**
 * Socrata/Tyler Data & Insights provider
 *
 * API Pattern:
 * https://data.{domain}/api/geospatial/{dataset-id}?method=export&format=GeoJSON
 */
export class SocrataProvider extends StateBoundaryProvider {
  async downloadLayer(layer: StateBoundaryLayer): Promise<StateDownloadResult> {
    if (!this.hasLayer(layer)) {
      throw new Error(`Layer ${layer} not available from ${this.portal.portalName}`);
    }

    const datasetId = this.portal.layerEndpoints[layer];
    if (!datasetId) {
      throw new Error(`No dataset ID configured for ${layer}`);
    }

    // Socrata geospatial export endpoint
    const url = `${this.portal.baseUrl}/api/geospatial/${datasetId}?method=export&format=GeoJSON`;

    const geojson = await this.fetchGeoJSON(url);
    const boundaries = this.transformFeatures(geojson, layer);

    return {
      layer,
      featureCount: boundaries.length,
      boundaries,
      metadata: {
        downloadedAt: new Date().toISOString(),
        sourceUrl: url,
        checksum: this.computeChecksum(boundaries),
      },
    };
  }

  protected normalizeFeature(
    feature: Feature,
    layer: StateBoundaryLayer
  ): StateNormalizedBoundary {
    const props = feature.properties ?? {};

    // Socrata field patterns vary more - do best effort
    const stateFips = props.statefp ?? props.state_fips ?? this.portal.stateFips;
    const entityFips = props.district ?? props.districtno ?? props.id ?? '';
    const geoid = props.geoid ?? `${stateFips}${entityFips}`;
    const name = props.name ?? props.namelsad ?? `District ${entityFips}`;

    return {
      id: geoid,
      name,
      level: layer === 'county' ? 'county' : layer === 'municipal' ? 'municipal' : 'district',
      geometry: feature.geometry as Polygon | MultiPolygon,
      properties: {
        stateFips: String(stateFips),
        entityFips: String(entityFips),
        layer,
        geoid,
        ...props,
      },
      source: {
        provider: this.portal.authorityLevel,
        portalName: this.portal.portalName,
        authorityLevel: this.portal.authorityLevel,
        legalStatus: 'binding',
        retrievedAt: new Date().toISOString(),
      },
    };
  }
}
