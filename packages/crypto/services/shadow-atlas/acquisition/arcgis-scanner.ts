/**
 * ArcGIS Scanner - Multi-Strategy Portal Discovery
 *
 * Discovers city council district layers from GIS portals using multiple strategies.
 * Priority order: ArcGIS Hub → State GIS Portal → Direct MapServer
 *
 * Consolidates:
 * - scanners/arcgis-hub.ts (Hub API search with geographic filtering)
 * - scanners/direct-mapserver.ts (Direct server enumeration)
 * - scanners/state-gis-clearinghouse.ts (State portal search)
 * - scanners/authoritative-multi-path.ts (Known city portals)
 *
 * TYPE SAFETY: Nuclear-level strictness - no `any`, no loose casts.
 */

import type { FeatureCollection, Feature, Geometry } from 'geojson';
import type { PortalType } from '../core/types.js';
import { SemanticValidator } from '../validators/semantic-validator.js';
import { getStatePortal, type StateGISPortal } from '../registry/state-gis-portals.js';
import { generateSearchQueries } from '../utils/search-term-generator.js';

/**
 * City information for discovery
 */
export interface CityInfo {
  readonly name: string;
  readonly state: string;
  readonly fips: string;
  readonly population?: number;
}

/**
 * Discovered layer metadata
 */
export interface DiscoveredLayer {
  readonly url: string;
  readonly title: string;
  readonly layerIndex?: number;
  readonly source: 'hub' | 'state-portal' | 'direct-mapserver' | 'known-portal';
  readonly semanticScore: number;
  readonly metadata: LayerMetadata;
}

/**
 * Layer metadata from ArcGIS REST API
 */
export interface LayerMetadata {
  readonly lastModified?: string;
  readonly featureCount?: number;
  readonly geometryType?: string;
  readonly fields?: readonly string[];
  readonly description?: string;
}

/**
 * Scan result with discovered layers
 */
export interface ScanResult {
  readonly layers: readonly DiscoveredLayer[];
  readonly searchedSources: readonly string[];
  readonly errors: readonly string[];
  readonly duration: number;
}

/**
 * Validation result for discovered layer
 */
export interface ValidationResult {
  readonly valid: boolean;
  readonly semanticScore: number;
  readonly reasons: readonly string[];
  readonly geojson?: FeatureCollection;
}

// STATE_BOUNDS imported from centralized geo-constants (eliminated duplicate)
import { STATE_BOUNDS } from '../core/geo-constants.js';
// KNOWN_CITY_PORTALS imported from centralized registry (eliminated duplicate)
import { KNOWN_CITY_PORTALS, type KnownCityPortal } from '../registry/known-city-portals.js';

// Re-export interface for backward compatibility
type KnownPortalEntry = KnownCityPortal;

/**
 * ArcGIS Hub dataset response
 */
interface HubDataset {
  readonly id: string;
  readonly type: string;
  readonly attributes: {
    readonly name: string;
    readonly description?: string;
    readonly url?: string;
    readonly serviceUrl?: string;
    readonly itemType?: string;
    readonly geometryType?: string;
    readonly recordCount?: number;
  };
}

/**
 * ArcGIS service reference
 */
interface ArcGISServiceRef {
  readonly name: string;
  readonly type: string;
}

/**
 * ArcGIS folder response
 */
interface ArcGISFolderResponse {
  readonly currentVersion?: string;
  readonly folders?: readonly string[];
  readonly services?: readonly ArcGISServiceRef[];
}

/**
 * ArcGIS service response
 */
interface ArcGISServiceResponse {
  readonly layers?: ReadonlyArray<{
    readonly id: number;
    readonly name: string;
    readonly type?: string;
    readonly geometryType?: string;
  }>;
}

/**
 * Type guard for ArcGIS folder response
 */
function isArcGISFolderResponse(data: unknown): data is ArcGISFolderResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    ('folders' in data || 'services' in data || 'currentVersion' in data)
  );
}

/**
 * Type guard for ArcGIS service response
 */
function isArcGISServiceResponse(data: unknown): data is ArcGISServiceResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'layers' in data
  );
}

/**
 * ArcGIS Scanner - Multi-Strategy Portal Discovery
 */
export class ArcGISScanner {
  private readonly HUB_API_BASE = 'https://hub.arcgis.com/api/v3';
  private readonly PORTAL_API_BASE = 'https://www.arcgis.com/sharing/rest';
  private readonly semanticValidator: SemanticValidator;
  private readonly timeout: number;
  private readonly maxDomainsPerCity: number;

  constructor(options?: {
    readonly timeout?: number;
    readonly maxDomainsPerCity?: number;
  }) {
    this.semanticValidator = new SemanticValidator();
    this.timeout = options?.timeout ?? 5000;
    this.maxDomainsPerCity = options?.maxDomainsPerCity ?? 20;
  }

  /**
   * Search for council district layers using all strategies.
   * Returns layers sorted by semantic score (highest first).
   *
   * Strategy priority:
   * 1. Known city portals (highest confidence)
   * 2. ArcGIS Hub search (primary strategy)
   * 3. State GIS portal (authoritative fallback)
   * 4. Direct MapServer (last resort)
   */
  async search(city: CityInfo): Promise<ScanResult> {
    const startTime = Date.now();
    const allLayers: DiscoveredLayer[] = [];
    const searchedSources: string[] = [];
    const errors: string[] = [];

    console.log(`🔍 Multi-strategy search: ${city.name}, ${city.state}`);

    // Strategy 1: Known city portals (skip if not in registry)
    const knownPortalLayers = await this.searchKnownPortals(city);
    if (knownPortalLayers.length > 0) {
      allLayers.push(...knownPortalLayers);
      searchedSources.push('known-portal');
      console.log(`   ✅ Found ${knownPortalLayers.length} layers from known portal`);
    }

    // Strategy 2: ArcGIS Hub (primary)
    try {
      const hubLayers = await this.searchHub(city);
      if (hubLayers.length > 0) {
        allLayers.push(...hubLayers);
        searchedSources.push('hub');
        console.log(`   ✅ Found ${hubLayers.length} layers from Hub`);
      }
    } catch (error) {
      const message = `Hub search failed: ${(error as Error).message}`;
      errors.push(message);
      console.warn(`   ⚠️  ${message}`);
    }

    // Strategy 3: State GIS portal (if Hub failed or returned nothing)
    if (allLayers.length === 0) {
      try {
        const stateLayers = await this.searchStatePortal(city.state, city);
        if (stateLayers.length > 0) {
          allLayers.push(...stateLayers);
          searchedSources.push('state-portal');
          console.log(`   ✅ Found ${stateLayers.length} layers from state portal`);
        }
      } catch (error) {
        const message = `State portal search failed: ${(error as Error).message}`;
        errors.push(message);
        console.warn(`   ⚠️  ${message}`);
      }
    }

    // Strategy 4: Direct MapServer (last resort)
    if (allLayers.length === 0) {
      try {
        const directLayers = await this.searchDirectMapServer(city);
        if (directLayers.length > 0) {
          allLayers.push(...directLayers);
          searchedSources.push('direct-mapserver');
          console.log(`   ✅ Found ${directLayers.length} layers from direct MapServer`);
        }
      } catch (error) {
        const message = `Direct MapServer search failed: ${(error as Error).message}`;
        errors.push(message);
        console.warn(`   ⚠️  ${message}`);
      }
    }

    // Sort by semantic score (highest first)
    const sortedLayers = allLayers.sort((a, b) => b.semanticScore - a.semanticScore);

    const duration = Date.now() - startTime;
    console.log(`   📊 Search complete: ${sortedLayers.length} layers found in ${duration}ms`);

    return {
      layers: sortedLayers,
      searchedSources,
      errors,
      duration,
    };
  }

  /**
   * Search known city portals (Socrata/ArcGIS Hub)
   * Highest confidence - these are manually verified official sources.
   */
  async searchKnownPortals(city: CityInfo): Promise<readonly DiscoveredLayer[]> {
    const known = KNOWN_CITY_PORTALS[city.fips];
    if (!known) {
      return [];
    }

    console.log(`   🎯 Searching known portal for ${city.name}`);

    // Try Socrata first
    if (known.socrata) {
      try {
        const layer = await this.querySocrataDomain(known.socrata, city);
        if (layer) {
          console.log(`   ✅ Found layer in Socrata portal: ${known.socrata}`);
          return [layer];
        }
      } catch (error) {
        console.warn(`   ⏭️  Socrata failed: ${(error as Error).message}`);
      }
    }

    // Try ArcGIS Hub with known dataset ID
    if (known.arcgis && known.datasetId) {
      try {
        const layer = await this.queryKnownHubDataset(known.datasetId, city);
        if (layer) {
          console.log(`   ✅ Found layer in ArcGIS Hub: ${known.arcgis}`);
          return [layer];
        }
      } catch (error) {
        console.warn(`   ⏭️  ArcGIS Hub failed: ${(error as Error).message}`);
      }
    }

    return [];
  }

  /**
   * Search ArcGIS Hub (opendata.arcgis.com).
   * This is the primary strategy - most cities publish here.
   */
  async searchHub(city: CityInfo): Promise<readonly DiscoveredLayer[]> {
    console.log(`   🔍 Searching ArcGIS Hub for ${city.name}`);

    const searchQueries = generateSearchQueries(city.name, city.state, 10);
    console.log(`   Generated ${searchQueries.length} search query variations`);

    const allLayers: DiscoveredLayer[] = [];
    const seenDatasetIds = new Set<string>();

    for (const query of searchQueries) {
      console.log(`   Trying query: "${query}"`);

      try {
        const url = `${this.HUB_API_BASE}/datasets?q=${encodeURIComponent(query)}`;

        const response = await fetch(url, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
          console.warn(`   ⚠️  Query failed with ${response.status}`);
          continue;
        }

        const data = await response.json() as { data: HubDataset[] };

        for (const dataset of data.data) {
          // Skip duplicates across queries
          if (seenDatasetIds.has(dataset.id)) {
            continue;
          }

          // Apply semantic filtering
          const semanticResult = this.semanticValidator.scoreTitle(dataset.attributes.name);
          if (semanticResult.score < 20) {
            continue; // Too low quality
          }

          // Get service URL and validate
          const serviceInfo = await this.getServiceUrl(dataset.id);
          if (!serviceInfo) {
            continue;
          }

          seenDatasetIds.add(dataset.id);

          const downloadUrl = `${serviceInfo.url}/${serviceInfo.layerId}/query?where=1%3D1&outFields=*&f=geojson`;

          allLayers.push({
            url: downloadUrl,
            title: dataset.attributes.name,
            layerIndex: serviceInfo.layerId,
            source: 'hub',
            semanticScore: semanticResult.score,
            metadata: {
              featureCount: dataset.attributes.recordCount,
              geometryType: dataset.attributes.geometryType,
              description: dataset.attributes.description,
            },
          });
        }

        // If we found results, stop searching
        if (allLayers.length > 0) {
          console.log(`   ✅ Found ${allLayers.length} candidates with query: "${query}"`);
          break;
        }
      } catch (error) {
        console.warn(`   ⚠️  Query error: ${(error as Error).message}`);
      }
    }

    // Apply geographic filtering
    const geoFiltered = await this.filterByGeography(allLayers, city);

    return geoFiltered;
  }

  /**
   * Search state GIS clearinghouse portals.
   * Falls back when Hub search fails or returns low-quality results.
   */
  async searchStatePortal(state: string, city?: CityInfo): Promise<readonly DiscoveredLayer[]> {
    const statePortal = getStatePortal(state);

    if (!statePortal) {
      console.log(`   ⏭️  No state GIS portal registered for ${state}`);
      return [];
    }

    console.log(`   🏛️  Searching state portal: ${statePortal.stateName}`);
    console.log(`   Portal: ${statePortal.portalUrl} (${statePortal.authority} authority)`);

    // Route to appropriate strategy
    switch (statePortal.searchStrategy) {
      case 'direct-layer':
        return await this.scanDirectLayers(city!, statePortal);
      case 'hub-api':
        return await this.scanStateHubAPI(city!, statePortal);
      case 'catalog-api':
        return await this.scanCatalogAPI(city!, statePortal);
      case 'rest-api':
        return await this.scanStateRESTAPI(city!, statePortal);
      default:
        console.warn(`   ⚠️  Unknown search strategy: ${statePortal.searchStrategy}`);
        return [];
    }
  }

  /**
   * Search direct MapServer endpoints.
   * Last resort - tries common city GIS URL patterns.
   */
  async searchDirectMapServer(city: CityInfo): Promise<readonly DiscoveredLayer[]> {
    console.log(`   🔍 Direct MapServer scan: ${city.name}, ${city.state}`);

    const layers: DiscoveredLayer[] = [];
    const domains = this.generateMunicipalGISDomains(city);

    console.log(`   Generated ${domains.length} potential GIS domains`);

    for (const domain of domains.slice(0, this.maxDomainsPerCity)) {
      console.log(`   Checking domain: ${domain}`);

      try {
        const services = await this.discoverServices(domain, city);

        if (services.length === 0) continue;

        console.log(`   ✅ Found ${services.length} services on ${domain}`);

        // Enumerate layers in each service
        for (const serviceUrl of services) {
          const serviceLayers = await this.enumerateLayers(serviceUrl);

          for (const layer of serviceLayers) {
            const semanticResult = this.semanticValidator.scoreTitle(layer.name);

            if (semanticResult.score >= 30) {
              console.log(`   ✅ High-scoring layer: "${layer.name}" (score: ${semanticResult.score})`);

              const downloadUrl = `${layer.layerUrl}/query?where=1%3D1&outFields=*&f=geojson`;

              layers.push({
                url: downloadUrl,
                title: layer.name,
                layerIndex: layer.id,
                source: 'direct-mapserver',
                semanticScore: semanticResult.score,
                metadata: {
                  geometryType: layer.geometryType ?? undefined,
                  description: `Layer ${layer.id} from ${domain}`,
                },
              });
            } else if (semanticResult.score === 0) {
              console.log(`   ⚠️  Layer rejected: "${layer.name}" (${semanticResult.reasons.join(', ')})`);
            }
          }
        }
      } catch (error) {
        // Domain check failed (expected for non-existent servers)
        continue;
      }
    }

    console.log(`   📊 Direct scan complete: ${layers.length} layers found`);

    return layers;
  }

  /**
   * Validate a discovered layer is actually council districts.
   * Downloads sample data and checks semantic + geographic validity.
   */
  async validateLayer(layer: DiscoveredLayer, city: CityInfo): Promise<ValidationResult> {
    try {
      // Download sample data (first feature)
      const sampleUrl = layer.url.includes('resultRecordCount')
        ? layer.url
        : layer.url.replace('where=1%3D1', 'where=1%3D1&resultRecordCount=1');

      const response = await fetch(sampleUrl, {
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return {
          valid: false,
          semanticScore: 0,
          reasons: [`HTTP ${response.status}: ${response.statusText}`],
        };
      }

      const geojson = await response.json() as FeatureCollection;

      if (!geojson.features || geojson.features.length === 0) {
        return {
          valid: false,
          semanticScore: 0,
          reasons: ['No features in layer'],
        };
      }

      // Validate geography
      const feature = geojson.features[0];
      if (!this.isFeatureInState(feature, city.state)) {
        return {
          valid: false,
          semanticScore: 0,
          reasons: ['Feature coordinates outside expected state bounds'],
        };
      }

      // Semantic score already computed during discovery
      return {
        valid: true,
        semanticScore: layer.semanticScore,
        reasons: ['Layer validated successfully'],
        geojson,
      };
    } catch (error) {
      return {
        valid: false,
        semanticScore: 0,
        reasons: [`Validation error: ${(error as Error).message}`],
      };
    }
  }

  /**
   * Download full GeoJSON from validated layer.
   */
  async downloadLayer(layer: DiscoveredLayer): Promise<FeatureCollection> {
    const response = await fetch(layer.url, {
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const geojson = await response.json() as FeatureCollection;

    if (!geojson.features || geojson.features.length === 0) {
      throw new Error('Downloaded layer contains no features');
    }

    return geojson;
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Query Socrata domain for council districts
   */
  private async querySocrataDomain(
    domain: string,
    city: CityInfo
  ): Promise<DiscoveredLayer | null> {
    const catalogUrl = `https://${domain}/api/catalog/v1?q=council districts&only=datasets`;

    const response = await fetch(catalogUrl, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Socrata catalog returned ${response.status}`);
    }

    const data = await response.json() as {
      results?: Array<{
        resource: {
          id: string;
          name: string;
          description?: string;
        };
        link: string;
      }>;
    };

    const results = data.results || [];
    if (results.length === 0) {
      return null;
    }

    const first = results[0];
    const semanticResult = this.semanticValidator.scoreTitle(first.resource.name);

    if (semanticResult.score < 30) {
      return null; // Too low quality
    }

    const geojsonUrl = `https://${domain}/resource/${first.resource.id}.geojson?$limit=50000`;

    return {
      url: geojsonUrl,
      title: first.resource.name,
      source: 'known-portal',
      semanticScore: semanticResult.score + 20, // Boost for known portal
      metadata: {
        description: first.resource.description,
      },
    };
  }

  /**
   * Query known ArcGIS Hub dataset
   */
  private async queryKnownHubDataset(
    datasetId: string,
    city: CityInfo
  ): Promise<DiscoveredLayer | null> {
    const downloadUrl = `https://hub.arcgis.com/api/v3/datasets/${datasetId}/downloads/data?format=geojson&spatialRefId=4326&where=1%3D1`;

    // Verify dataset exists
    const response = await fetch(downloadUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return null;
    }

    return {
      url: downloadUrl,
      title: `${city.name} City Council Districts`,
      source: 'known-portal',
      semanticScore: 95, // High score - known verified source
      metadata: {
        description: 'Official city data via hub.arcgis.com',
      },
    };
  }

  /**
   * Get Feature Service URL from Hub dataset and validate geometry type
   */
  private async getServiceUrl(datasetId: string): Promise<{ url: string; layerId: number } | null> {
    try {
      const url = `${this.HUB_API_BASE}/datasets/${datasetId}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as {
        data: {
          attributes: {
            url?: string;
            serviceUrl?: string;
          };
        };
      };

      const serviceUrl = data.data.attributes.serviceUrl || data.data.attributes.url;
      if (!serviceUrl) {
        return null;
      }

      const layerId = await this.findPolygonLayer(serviceUrl);
      if (layerId === null) {
        return null;
      }

      return { url: serviceUrl, layerId };
    } catch (error) {
      return null;
    }
  }

  /**
   * Find first layer with polygon geometry in FeatureServer
   */
  private async findPolygonLayer(serviceUrl: string): Promise<number | null> {
    try {
      const metadataUrl = `${serviceUrl}?f=json`;
      const response = await fetch(metadataUrl, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return null;
      }

      const metadata = await response.json() as {
        layers?: Array<{
          id: number;
          name: string;
          geometryType?: string;
        }>;
      };

      const polygonLayer = metadata.layers?.find(layer =>
        layer.geometryType === 'esriGeometryPolygon' ||
        layer.geometryType === 'esriGeometryMultiPolygon'
      );

      return polygonLayer?.id ?? null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Filter candidates by geographic validity (removes wrong-country matches)
   */
  private async filterByGeography(
    layers: readonly DiscoveredLayer[],
    city: CityInfo
  ): Promise<readonly DiscoveredLayer[]> {
    const stateBounds = STATE_BOUNDS[city.state];
    if (!stateBounds) {
      return layers; // No bounds, skip filtering
    }

    const filtered: DiscoveredLayer[] = [];

    for (const layer of layers) {
      try {
        const isValid = await this.validateGeography(layer.url, stateBounds);

        if (isValid) {
          filtered.push(layer);
        } else {
          console.log(`   ⏭️  Filtered out "${layer.title}" (coordinates outside ${city.state})`);
        }
      } catch (error) {
        // Conservative: keep if validation fails
        filtered.push(layer);
      }
    }

    return filtered;
  }

  /**
   * Validate that dataset coordinates fall within expected state bounds
   */
  private async validateGeography(
    downloadUrl: string,
    stateBounds: readonly [number, number, number, number]
  ): Promise<boolean> {
    try {
      const sampleUrl = downloadUrl.includes('resultRecordCount')
        ? downloadUrl
        : downloadUrl.replace('where=1%3D1', 'where=1%3D1&resultRecordCount=1');

      const response = await fetch(sampleUrl, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return true; // Conservative: allow if we can't validate
      }

      const geojson = await response.json() as FeatureCollection;

      if (!geojson.features || geojson.features.length === 0) {
        return true;
      }

      const feature = geojson.features[0];
      if (!feature.geometry || feature.geometry.type === 'GeometryCollection' || !feature.geometry.coordinates) {
        return true;
      }

      const coords = this.extractSampleCoordinate(feature.geometry.coordinates);
      if (!coords) {
        return true;
      }

      const [lon, lat] = coords;
      const [minLon, minLat, maxLon, maxLat] = stateBounds;

      // Check with 0.5 degree tolerance for border cities
      const tolerance = 0.5;
      return (
        lon >= minLon - tolerance &&
        lon <= maxLon + tolerance &&
        lat >= minLat - tolerance &&
        lat <= maxLat + tolerance
      );
    } catch (error) {
      return true; // Conservative
    }
  }

  /**
   * Extract a sample coordinate from GeoJSON geometry
   */
  private extractSampleCoordinate(coords: unknown): [number, number] | null {
    if (!Array.isArray(coords)) {
      return null;
    }

    // Point: [lon, lat]
    if (coords.length === 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      return [coords[0], coords[1]];
    }

    // Nested array (LineString, Polygon, MultiPolygon)
    if (Array.isArray(coords[0])) {
      return this.extractSampleCoordinate(coords[0]);
    }

    return null;
  }

  /**
   * Check if feature is in expected state
   */
  private isFeatureInState(feature: Feature<Geometry>, state: string): boolean {
    const stateBounds = STATE_BOUNDS[state];
    if (!stateBounds) {
      return true; // No bounds, assume valid
    }

    if (!feature.geometry || feature.geometry.type === 'GeometryCollection' || !feature.geometry.coordinates) {
      return false;
    }

    const coords = this.extractSampleCoordinate(feature.geometry.coordinates);
    if (!coords) {
      return false;
    }

    const [lon, lat] = coords;
    const [minLon, minLat, maxLon, maxLat] = stateBounds;
    const tolerance = 0.5;

    return (
      lon >= minLon - tolerance &&
      lon <= maxLon + tolerance &&
      lat >= minLat - tolerance &&
      lat <= maxLat + tolerance
    );
  }

  /**
   * State portal: Direct layer access (Hawaii model)
   */
  private async scanDirectLayers(
    city: CityInfo,
    portal: StateGISPortal
  ): Promise<readonly DiscoveredLayer[]> {
    const layers: DiscoveredLayer[] = [];

    for (const layerInfo of portal.municipalBoundaryLayers || []) {
      if (!this.layerCoversCity(layerInfo.coverage, city)) {
        continue;
      }

      const layerUrl = `${portal.portalUrl}/arcgis/rest/services/${layerInfo.layer}`;

      try {
        const metadataUrl = `${layerUrl}?f=json`;
        const response = await fetch(metadataUrl, {
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          console.warn(`   ⚠️  Failed to fetch layer metadata: ${layerInfo.layer}`);
          continue;
        }

        const metadata = await response.json() as {
          name: string;
          description?: string;
          geometryType?: string;
        };

        if (metadata.geometryType !== 'esriGeometryPolygon') {
          console.log(`   ⏭️  Skipping non-polygon layer: ${metadata.name}`);
          continue;
        }

        const semanticResult = this.semanticValidator.scoreTitle(metadata.name);

        if (semanticResult.score >= 30) {
          const downloadUrl = `${layerUrl}/query?where=1%3D1&outFields=*&f=geojson`;

          layers.push({
            url: downloadUrl,
            title: metadata.name,
            source: 'state-portal',
            semanticScore: semanticResult.score + 20, // Boost for state authority
            metadata: {
              description: metadata.description || layerInfo.coverage,
              featureCount: layerInfo.featureCount,
              geometryType: metadata.geometryType,
            },
          });

          console.log(`   ✅ Direct layer: ${metadata.name} (score: ${semanticResult.score + 20})`);
        }
      } catch (error) {
        console.warn(`   ⚠️  Failed to check layer: ${(error as Error).message}`);
      }
    }

    return layers;
  }

  /**
   * State portal: Hub API search
   */
  private async scanStateHubAPI(
    city: CityInfo,
    portal: StateGISPortal
  ): Promise<readonly DiscoveredLayer[]> {
    const query = `${city.name} ${city.state} council district OR ward`;
    const url = `${this.HUB_API_BASE}/datasets?q=${encodeURIComponent(query)}`;

    try {
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        console.warn(`   ⚠️  State Hub API failed: ${response.status}`);
        return [];
      }

      const data = await response.json() as {
        data: Array<{
          id: string;
          attributes: {
            name: string;
            description?: string;
            url?: string;
            serviceUrl?: string;
            recordCount?: number;
          };
        }>;
      };

      const layers: DiscoveredLayer[] = [];

      for (const dataset of data.data) {
        const semanticResult = this.semanticValidator.scoreTitle(dataset.attributes.name);

        if (semanticResult.score < 30) {
          continue;
        }

        const serviceUrl = dataset.attributes.serviceUrl || dataset.attributes.url;
        if (!serviceUrl) {
          continue;
        }

        const layerId = await this.findPolygonLayer(serviceUrl);
        if (layerId === null) {
          continue;
        }

        const downloadUrl = `${serviceUrl}/${layerId}/query?where=1%3D1&outFields=*&f=geojson`;

        layers.push({
          url: downloadUrl,
          title: dataset.attributes.name,
          layerIndex: layerId,
          source: 'state-portal',
          semanticScore: semanticResult.score + 15, // Boost for state authority
          metadata: {
            description: dataset.attributes.description,
            featureCount: dataset.attributes.recordCount,
          },
        });

        console.log(`   ✅ State Hub result: ${dataset.attributes.name}`);
      }

      return layers;
    } catch (error) {
      console.warn(`   ⚠️  State Hub API error: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * State portal: Catalog API (CKAN/Socrata)
   */
  private async scanCatalogAPI(
    city: CityInfo,
    portal: StateGISPortal
  ): Promise<readonly DiscoveredLayer[]> {
    if (portal.portalType === 'ckan') {
      return await this.scanCKAN(city, portal);
    }

    if (portal.portalType === 'socrata') {
      return await this.scanSocrata(city, portal);
    }

    return [];
  }

  /**
   * Scan CKAN portal
   */
  private async scanCKAN(
    city: CityInfo,
    portal: StateGISPortal
  ): Promise<readonly DiscoveredLayer[]> {
    const query = `${city.name} council district`;
    const searchUrl = `${portal.portalUrl}/api/3/action/package_search?q=${encodeURIComponent(query)}&rows=10`;

    try {
      const response = await fetch(searchUrl, {
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as {
        result?: {
          results?: Array<{
            id: string;
            title: string;
            name: string;
            notes?: string;
            resources?: Array<{
              url: string;
              format: string;
            }>;
          }>;
        };
      };

      const packages = data.result?.results || [];
      const layers: DiscoveredLayer[] = [];

      for (const pkg of packages) {
        const semanticResult = this.semanticValidator.scoreTitle(pkg.title);

        if (semanticResult.score < 30) {
          continue;
        }

        const geoResource = pkg.resources?.find(r =>
          r.format.toLowerCase().includes('geojson') ||
          r.format.toLowerCase().includes('json')
        );

        if (geoResource) {
          layers.push({
            url: geoResource.url,
            title: pkg.title,
            source: 'state-portal',
            semanticScore: semanticResult.score + 15,
            metadata: {
              description: pkg.notes,
            },
          });

          console.log(`   ✅ CKAN result: ${pkg.title}`);
        }
      }

      return layers;
    } catch (error) {
      console.warn(`   ⚠️  CKAN error: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Scan Socrata portal
   */
  private async scanSocrata(
    city: CityInfo,
    portal: StateGISPortal
  ): Promise<readonly DiscoveredLayer[]> {
    const domain = portal.portalUrl.replace(/^https?:\/\//, '');
    const catalogUrl = `https://${domain}/api/catalog/v1?q=${encodeURIComponent(`${city.name} council district`)}&only=datasets&limit=10`;

    try {
      const response = await fetch(catalogUrl, {
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as {
        results?: Array<{
          resource: {
            id: string;
            name: string;
            description?: string;
          };
          link: string;
        }>;
      };

      const results = data.results || [];
      const layers: DiscoveredLayer[] = [];

      for (const result of results) {
        const semanticResult = this.semanticValidator.scoreTitle(result.resource.name);

        if (semanticResult.score < 30) {
          continue;
        }

        const geojsonUrl = `https://${domain}/resource/${result.resource.id}.geojson?$limit=50000`;

        layers.push({
          url: geojsonUrl,
          title: result.resource.name,
          source: 'state-portal',
          semanticScore: semanticResult.score + 15,
          metadata: {
            description: result.resource.description,
          },
        });

        console.log(`   ✅ Socrata result: ${result.resource.name}`);
      }

      return layers;
    } catch (error) {
      console.warn(`   ⚠️  Socrata error: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * State portal: REST API enumeration (not yet implemented)
   */
  private async scanStateRESTAPI(
    city: CityInfo,
    portal: StateGISPortal
  ): Promise<readonly DiscoveredLayer[]> {
    console.log(`   ⏭️  REST enumeration not yet implemented for ${portal.stateName}`);
    return [];
  }

  /**
   * Check if layer covers target city
   */
  private layerCoversCity(coverage: string, city: CityInfo): boolean {
    const coverageLower = coverage.toLowerCase();
    const cityLower = city.name.toLowerCase();

    if (coverageLower.includes(cityLower)) {
      return true;
    }

    const cityWords = cityLower.split(/\s+/);
    return cityWords.some(word => word.length > 3 && coverageLower.includes(word));
  }

  /**
   * Generate municipal GIS domain patterns
   */
  private generateMunicipalGISDomains(city: CityInfo): readonly string[] {
    const citySlug = city.name.toLowerCase().replace(/\s+/g, '');
    const cityDash = city.name.toLowerCase().replace(/\s+/g, '-');
    const stateSlug = city.state.toLowerCase();

    const domains: string[] = [
      // Pattern 1: City-specific ArcGIS Server subdomains
      `ags.${citySlug}gov.org`,
      `ags.${citySlug}.gov`,
      `arcgis.${citySlug}gov.org`,
      `arcgis.${citySlug}.gov`,
      `gis.${citySlug}gov.org`,
      `gisserver.${citySlug}.gov`,

      // Pattern 2: City portal subdomains
      `gis.${citySlug}.gov`,
      `maps.${citySlug}.gov`,
      `data.${citySlug}.gov`,
      `opendata.${citySlug}.gov`,
      `${citySlug}gis.gov`,

      // Pattern 3: State + city patterns
      `gis.${citySlug}.${stateSlug}.us`,
      `maps.${citySlug}.${stateSlug}.us`,
      `gis.ci.${citySlug}.${stateSlug}.us`,

      // Pattern 4: Alternative formats
      `gis.${cityDash}.gov`,
      `maps.${cityDash}.gov`,
      `gis.city${citySlug}.gov`,
      `maps.cityof${citySlug}.gov`,
    ];

    return Object.freeze(domains);
  }

  /**
   * Discover ArcGIS REST services on a domain
   */
  private async discoverServices(domain: string, city: CityInfo): Promise<readonly string[]> {
    const serviceEndpoints: string[] = [];
    const citySlug = city.name.toLowerCase().replace(/\s+/g, '');

    const basePaths = [
      '/arcgis/rest/services',
      '/server/rest/services',
      '/rest/services',
      '/gis/rest/services',
      `/${citySlug}/rest/services`,
    ];

    const knownServicePaths = [
      '/OpenData/MapServer',
      '/OpenData/FeatureServer',
      '/Public/MapServer',
      '/Public/FeatureServer',
      '/GIS/MapServer',
      '/GIS/FeatureServer',
    ];

    for (const basePath of basePaths) {
      try {
        const url = `https://${domain}${basePath}?f=json`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          signal: controller.signal,
          headers: { 'Accept': 'application/json' },
          redirect: 'follow',
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          // Try known service paths directly
          for (const servicePath of knownServicePaths) {
            const directUrl = `https://${domain}${basePath}${servicePath}`;
            if (await this.checkDirectService(directUrl)) {
              serviceEndpoints.push(directUrl);
            }
          }

          if (serviceEndpoints.length > 0) {
            return Object.freeze(serviceEndpoints);
          }
          continue;
        }

        const data: unknown = await response.json();

        if (!isArcGISFolderResponse(data)) continue;

        const baseServiceUrl = `https://${domain}${basePath}`;

        // Add services from root folder
        if (data.services) {
          for (const service of data.services) {
            serviceEndpoints.push(`${baseServiceUrl}/${service.name}/${service.type}`);
          }
        }

        // Check subfolders (max depth 2)
        if (data.folders) {
          for (const folder of data.folders) {
            const folderServices = await this.discoverServicesInFolder(
              baseServiceUrl,
              folder,
              1
            );
            serviceEndpoints.push(...folderServices);
          }
        }

        if (serviceEndpoints.length > 0) {
          return Object.freeze(serviceEndpoints);
        }
      } catch (error) {
        // Try direct service paths
        for (const servicePath of knownServicePaths) {
          const directUrl = `https://${domain}${basePath}${servicePath}`;
          if (await this.checkDirectService(directUrl)) {
            serviceEndpoints.push(directUrl);
          }
        }

        if (serviceEndpoints.length > 0) {
          return Object.freeze(serviceEndpoints);
        }
        continue;
      }
    }

    return Object.freeze(serviceEndpoints);
  }

  /**
   * Check if direct service URL exists
   */
  private async checkDirectService(serviceUrl: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${serviceUrl}?f=json`, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
        redirect: 'follow',
      });

      clearTimeout(timeoutId);

      if (!response.ok) return false;

      const data: unknown = await response.json();
      return isArcGISServiceResponse(data);
    } catch {
      return false;
    }
  }

  /**
   * Recursively discover services in folder
   */
  private async discoverServicesInFolder(
    baseUrl: string,
    folder: string,
    depth: number
  ): Promise<readonly string[]> {
    if (depth > 2) return [];

    const serviceEndpoints: string[] = [];

    try {
      const folderUrl = `${baseUrl}/${folder}?f=json`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(folderUrl, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });

      clearTimeout(timeoutId);

      if (!response.ok) return [];

      const data: unknown = await response.json();

      if (!isArcGISFolderResponse(data)) return [];

      if (data.services) {
        for (const service of data.services) {
          serviceEndpoints.push(`${baseUrl}/${folder}/${service.name}/${service.type}`);
        }
      }

      if (data.folders) {
        for (const subfolder of data.folders) {
          const subfolderServices = await this.discoverServicesInFolder(
            baseUrl,
            `${folder}/${subfolder}`,
            depth + 1
          );
          serviceEndpoints.push(...subfolderServices);
        }
      }
    } catch (error) {
      return [];
    }

    return Object.freeze(serviceEndpoints);
  }

  /**
   * Enumerate layers in MapServer/FeatureServer
   */
  private async enumerateLayers(serviceUrl: string): Promise<ReadonlyArray<{
    readonly id: number;
    readonly name: string;
    readonly type: string;
    readonly geometryType: string | null;
    readonly serviceUrl: string;
    readonly layerUrl: string;
  }>> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${serviceUrl}?f=json`, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });

      clearTimeout(timeoutId);

      if (!response.ok) return [];

      const data: unknown = await response.json();

      if (!isArcGISServiceResponse(data)) return [];

      const layers: Array<{
        id: number;
        name: string;
        type: string;
        geometryType: string | null;
        serviceUrl: string;
        layerUrl: string;
      }> = [];

      if (data.layers) {
        for (const layer of data.layers) {
          layers.push({
            id: layer.id,
            name: layer.name,
            type: layer.type ?? 'Feature Layer',
            geometryType: layer.geometryType ?? null,
            serviceUrl: serviceUrl,
            layerUrl: `${serviceUrl}/${layer.id}`,
          });
        }
      }

      return Object.freeze(layers);
    } catch (error) {
      console.warn(`   ⚠️  Failed to enumerate layers: ${(error as Error).message}`);
      return [];
    }
  }
}
