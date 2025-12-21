/**
 * GIS Server Discovery Service
 *
 * Recursive exploration of municipal GIS servers to discover council district layers.
 *
 * Architecture:
 * 1. Server probing: Detect ArcGIS/GeoServer endpoints via REST API
 * 2. Folder recursion: Traverse nested folder structures (max depth 5)
 * 3. Layer enumeration: Query all layers in discovered services
 * 4. Rate limiting: Max 10 requests/second per server
 *
 * Completes Path 4: Direct GIS server exploration for cities like Portland
 * where Hub APIs miss district data buried in folder hierarchies.
 *
 * TYPE SAFETY: Nuclear-level strictness - no `any`, no loose casts.
 * Zero tolerance for type bypasses.
 */

import type { CityTarget } from '../validators/deterministic-validators.js';

/**
 * GIS server endpoint metadata
 */
export interface GISServerEndpoint {
  readonly url: string;
  readonly serverType: 'ArcGIS' | 'GeoServer' | 'MapServer' | 'QGIS';
  readonly version: string | null;
  readonly isHealthy: boolean;
}

/**
 * GIS layer metadata
 */
export interface GISLayer {
  readonly id: number;
  readonly name: string;
  readonly type: 'Feature Layer' | 'Raster Layer' | 'Group Layer' | string;
  readonly geometryType: 'esriGeometryPolygon' | 'esriGeometryPolyline' | 'esriGeometryPoint' | string | null;
  readonly fields: readonly LayerField[];
  readonly featureCount: number | null;
  readonly extent: LayerExtent | null;
  readonly url: string;
}

/**
 * Layer field schema
 */
export interface LayerField {
  readonly name: string;
  readonly type: string;
  readonly alias: string | null;
}

/**
 * Geographic extent
 */
export interface LayerExtent {
  readonly xmin: number;
  readonly ymin: number;
  readonly xmax: number;
  readonly ymax: number;
  readonly spatialReference: { readonly wkid: number };
}

/**
 * GIS service metadata
 */
export interface GISService {
  readonly name: string;
  readonly type: 'MapServer' | 'FeatureServer' | 'ImageServer';
  readonly url: string;
  readonly layers: readonly GISLayer[];
  readonly folders: readonly string[] | null;
}

/**
 * ArcGIS REST API response types (external API contracts)
 */
interface ArcGISRootResponse {
  readonly currentVersion?: number | string; // ArcGIS returns number (e.g., 11.1)
  readonly folders?: readonly string[];
  readonly services?: readonly ArcGISServiceReference[];
}

interface ArcGISServiceReference {
  readonly name: string;
  readonly type: string;
}

interface ArcGISServiceResponse {
  readonly mapName?: string;
  readonly name?: string;
  readonly layers?: readonly ArcGISLayerReference[];
  readonly folders?: readonly string[];
}

interface ArcGISLayerReference {
  readonly id: number;
  readonly name: string;
}

interface ArcGISLayerDetails {
  readonly id: number;
  readonly name: string;
  readonly type?: string;
  readonly geometryType?: string;
  readonly fields?: readonly ArcGISFieldDetails[];
  readonly extent?: {
    readonly xmin: number;
    readonly ymin: number;
    readonly xmax: number;
    readonly ymax: number;
    readonly spatialReference: { readonly wkid: number };
  };
  readonly advancedQueryCapabilities?: {
    readonly standardizedQueries?: boolean;
  };
}

interface ArcGISFieldDetails {
  readonly name: string;
  readonly type: string;
  readonly alias?: string;
}

interface ArcGISCountResponse {
  readonly count?: number;
}

interface GeoServerVersionResponse {
  readonly about?: {
    readonly resource?: ReadonlyArray<{ readonly Version?: string }>;
  };
}

/**
 * Type guard for ArcGIS root response
 */
function isArcGISRootResponse(data: unknown): data is ArcGISRootResponse {
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
    ('layers' in data || 'mapName' in data || 'name' in data)
  );
}

/**
 * Type guard for ArcGIS layer details
 */
function isArcGISLayerDetails(data: unknown): data is ArcGISLayerDetails {
  return (
    typeof data === 'object' &&
    data !== null &&
    'id' in data &&
    'name' in data &&
    typeof (data as ArcGISLayerDetails).id === 'number' &&
    typeof (data as ArcGISLayerDetails).name === 'string'
  );
}

/**
 * Type guard for ArcGIS count response
 */
function isArcGISCountResponse(data: unknown): data is ArcGISCountResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    ('count' in data)
  );
}

/**
 * Type guard for GeoServer version response
 */
function isGeoServerVersionResponse(data: unknown): data is GeoServerVersionResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'about' in data
  );
}

/**
 * Rate limiter for server requests
 */
class RateLimiter {
  private requestTimestamps: number[] = [];
  private readonly maxRequestsPerSecond: number;

  constructor(maxRequestsPerSecond: number = 10) {
    this.maxRequestsPerSecond = maxRequestsPerSecond;
  }

  /**
   * Wait until rate limit allows next request
   */
  async waitForSlot(): Promise<void> {
    const now = Date.now();
    const oneSecondAgo = now - 1000;

    // Remove timestamps older than 1 second
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > oneSecondAgo);

    // If at capacity, wait until oldest request expires
    if (this.requestTimestamps.length >= this.maxRequestsPerSecond) {
      const oldestTimestamp = this.requestTimestamps[0];
      const waitTime = 1000 - (now - oldestTimestamp);
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      // Remove oldest timestamp
      this.requestTimestamps.shift();
    }

    // Record this request
    this.requestTimestamps.push(Date.now());
  }
}

/**
 * GIS Server Discovery Service
 *
 * Discovers and explores municipal GIS servers to find council district layers.
 */
export class GISServerDiscovery {
  private readonly rateLimiter: RateLimiter;
  private readonly timeout: number;
  private readonly maxDepth: number;

  constructor(options: {
    readonly maxRequestsPerSecond?: number;
    readonly timeout?: number;
    readonly maxDepth?: number;
  } = {}) {
    this.rateLimiter = new RateLimiter(options.maxRequestsPerSecond ?? 10);
    this.timeout = options.timeout ?? 5000;
    this.maxDepth = options.maxDepth ?? 5;
  }

  /**
   * Discover municipal GIS servers for a city
   */
  async discoverServers(city: CityTarget): Promise<readonly GISServerEndpoint[]> {
    const candidates: GISServerEndpoint[] = [];

    // Common municipal GIS URL patterns
    const cityNameLower = city.name.toLowerCase().replace(/\s+/g, '-');
    const cityNameUnderscore = city.name.toLowerCase().replace(/\s+/g, '_');
    const stateLower = city.state.toLowerCase();

    const urlPatterns: readonly string[] = [
      // ArcGIS patterns
      `https://${cityNameLower}.maps.arcgis.com/`,
      `https://gis.${cityNameLower}.gov/`,
      `https://maps.${cityNameLower}.gov/`,
      `https://www.${cityNameLower}.gov/`,
      `https://data.${cityNameLower}.gov/`,
      `https://${cityNameLower}.${stateLower}.gov/`,
      // Special patterns (city-specific naming conventions)
      `https://www.${cityNameLower}maps.com/`, // Portland, etc.
      `https://${cityNameLower}maps.com/`,

      // GeoServer patterns
      `https://geoserver.${cityNameLower}.gov/`,
      `https://${cityNameLower}.gov/geoserver/`,

      // State-level patterns (fallback)
      `https://gis.${stateLower}.gov/`,
      `https://maps.${stateLower}.gov/`,
    ];

    // Probe servers in parallel with individual error handling
    const probePromises = urlPatterns.map(async (baseUrl): Promise<GISServerEndpoint | null> => {
      try {
        return await this.probeServer(baseUrl);
      } catch (error) {
        // Silently ignore probe failures (expected for non-existent servers)
        return null;
      }
    });

    const results = await Promise.all(probePromises);

    for (const endpoint of results) {
      if (endpoint !== null && endpoint.isHealthy) {
        candidates.push(endpoint);
      }
    }

    return candidates;
  }

  /**
   * Probe a URL to determine GIS server type and health
   */
  async probeServer(baseUrl: string): Promise<GISServerEndpoint | null> {
    // Try ArcGIS REST API endpoint
    try {
      const arcgisUrl = `${baseUrl}arcgis/rest/services?f=json`;
      await this.rateLimiter.waitForSlot();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const arcgisResponse = await fetch(arcgisUrl, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });

      clearTimeout(timeoutId);

      if (arcgisResponse.ok) {
        const data: unknown = await arcgisResponse.json();

        if (isArcGISRootResponse(data)) {
          // Convert version to string (ArcGIS returns number like 11.1)
          const version = data.currentVersion !== undefined
            ? String(data.currentVersion)
            : null;
          return {
            url: `${baseUrl}arcgis/rest/services`,
            serverType: 'ArcGIS',
            version,
            isHealthy: true,
          };
        }
      }
    } catch (error) {
      // ArcGIS probe failed, try GeoServer
    }

    // Try GeoServer REST API endpoint
    try {
      const geoserverUrl = `${baseUrl}geoserver/rest/about/version.json`;
      await this.rateLimiter.waitForSlot();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const geoserverResponse = await fetch(geoserverUrl, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });

      clearTimeout(timeoutId);

      if (geoserverResponse.ok) {
        const data: unknown = await geoserverResponse.json();

        if (isGeoServerVersionResponse(data)) {
          const version = data.about?.resource?.[0]?.Version ?? null;
          return {
            url: baseUrl,
            serverType: 'GeoServer',
            version,
            isHealthy: true,
          };
        }
      }
    } catch (error) {
      // GeoServer probe failed
    }

    return null; // No GIS server found at this URL
  }

  /**
   * Recursively explore ArcGIS server folder structure
   */
  async exploreArcGISFolders(
    serverUrl: string,
    folder: string = '',
    depth: number = 0
  ): Promise<readonly GISService[]> {
    // Depth limit to prevent infinite recursion
    if (depth >= this.maxDepth) {
      console.warn(`   Max depth ${this.maxDepth} reached at folder: ${folder}`);
      return [];
    }

    const services: GISService[] = [];
    const folderUrl = folder
      ? `${serverUrl}/${folder}?f=json`
      : `${serverUrl}?f=json`;

    try {
      await this.rateLimiter.waitForSlot();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(folderUrl, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: unknown = await response.json();

      if (!isArcGISRootResponse(data)) {
        throw new Error('Invalid ArcGIS response structure');
      }

      // Process services in current folder
      if (data.services) {
        for (const service of data.services) {
          // NOTE: service.name already contains full path from root (e.g., "Public/Boundaries")
          // Do NOT prepend folder - the API returns fully-qualified service names
          const serviceUrl = `${serverUrl}/${service.name}/${service.type}`;
          const serviceDetails = await this.exploreService(serviceUrl);
          if (serviceDetails !== null) {
            services.push(serviceDetails);
          }
        }
      }

      // Recursively explore subfolders
      if (data.folders) {
        for (const subfolder of data.folders) {
          const subfolderPath = folder ? `${folder}/${subfolder}` : subfolder;
          const subfolderServices = await this.exploreArcGISFolders(
            serverUrl,
            subfolderPath,
            depth + 1
          );
          services.push(...subfolderServices);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`   Failed to explore folder ${folder || '(root)'}: ${errorMessage}`);
    }

    return services;
  }

  /**
   * Explore a specific ArcGIS MapServer or FeatureServer
   */
  private async exploreService(serviceUrl: string): Promise<GISService | null> {
    try {
      await this.rateLimiter.waitForSlot();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${serviceUrl}?f=json`, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: unknown = await response.json();

      if (!isArcGISServiceResponse(data)) {
        throw new Error('Invalid service response structure');
      }

      const layers: GISLayer[] = [];

      // Enumerate all layers in service
      if (data.layers) {
        for (const layer of data.layers) {
          const layerDetails = await this.getLayerDetails(`${serviceUrl}/${layer.id}`);
          if (layerDetails !== null) {
            layers.push(layerDetails);
          }
        }
      }

      return {
        name: data.mapName ?? data.name ?? 'Unknown',
        type: serviceUrl.includes('MapServer') ? 'MapServer' : 'FeatureServer',
        url: serviceUrl,
        layers,
        folders: data.folders ?? null,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`   Failed to explore service ${serviceUrl}: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Get detailed metadata for a specific layer
   */
  private async getLayerDetails(layerUrl: string): Promise<GISLayer | null> {
    try {
      await this.rateLimiter.waitForSlot();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${layerUrl}?f=json`, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: unknown = await response.json();

      if (!isArcGISLayerDetails(data)) {
        throw new Error('Invalid layer response structure');
      }

      // Get feature count if supported
      const featureCount = data.advancedQueryCapabilities?.standardizedQueries
        ? await this.getFeatureCount(layerUrl)
        : null;

      return {
        id: data.id,
        name: data.name,
        type: data.type ?? 'Feature Layer',
        geometryType: data.geometryType ?? null,
        fields: data.fields?.map(f => ({
          name: f.name,
          type: f.type,
          alias: f.alias ?? null,
        })) ?? [],
        featureCount,
        extent: data.extent ?? null,
        url: layerUrl,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`   Failed to get layer details ${layerUrl}: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Get feature count for a layer
   */
  private async getFeatureCount(layerUrl: string): Promise<number | null> {
    try {
      await this.rateLimiter.waitForSlot();

      const countUrl = `${layerUrl}/query?where=1=1&returnCountOnly=true&f=json`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(countUrl, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return null;
      }

      const data: unknown = await response.json();

      if (isArcGISCountResponse(data) && typeof data.count === 'number') {
        return data.count;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Discover state legislative boundary endpoints
   *
   * Searches state GIS portals for legislative boundary service URLs.
   * Used to populate state-gis-portals.ts registry with discovered endpoints.
   */
  async discoverStateEndpoints(
    portalUrl: string,
    portalType: 'arcgis' | 'socrata'
  ): Promise<readonly GISLayer[]> {
    const allLayers: GISLayer[] = [];

    if (portalType === 'arcgis') {
      // Try Hub API first
      const servers = await this.probeServer(portalUrl);
      if (servers !== null && servers.serverType === 'ArcGIS') {
        const services = await this.exploreArcGISFolders(servers.url);
        for (const service of services) {
          allLayers.push(...service.layers);
        }
      }
    }

    // Filter for legislative layers based on naming patterns
    const legislativeKeywords = [
      'congress', 'senate', 'house', 'assembly', 'legislative',
      'district', 'ward', 'county', 'cd', 'sldust', 'sldlst'
    ];

    return allLayers.filter(layer => {
      const nameLower = layer.name.toLowerCase();
      return legislativeKeywords.some(keyword => nameLower.includes(keyword));
    });
  }
}

/**
 * Example usage (for integration into multi-path-scanner.ts):
 *
 * async path4_DirectGISExploration(city: CityTarget): Promise<PortalCandidate[]> {
 *   const discovery = new GISServerDiscovery();
 *   const servers = await discovery.discoverServers(city);
 *
 *   const allLayers: GISLayer[] = [];
 *
 *   for (const server of servers) {
 *     if (server.serverType === 'ArcGIS') {
 *       const services = await discovery.exploreArcGISFolders(server.url);
 *       for (const service of services) {
 *         allLayers.push(...service.layers);
 *       }
 *     }
 *   }
 *
 *   const validator = new SemanticLayerValidator();
 *   const matches = validator.filterCouncilDistrictLayers(allLayers, city);
 *
 *   return matches.map(m => ({
 *     id: m.layer.id.toString(),
 *     title: m.layer.name,
 *     url: m.layer.url,
 *     downloadUrl: `${m.layer.url}/query?where=1=1&outFields=*&f=geojson`,
 *     score: m.confidence,
 *     portalType: 'gis-server' as const,
 *     featureCount: m.layer.featureCount ?? undefined,
 *   }));
 * }
 */
