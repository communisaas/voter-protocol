/**
 * Direct MapServer/FeatureServer Scanner (Type A Failure Resolution)
 *
 * Autonomous discovery of municipal GIS endpoints through systematic enumeration.
 *
 * PURPOSE: Resolve Type A failures (data exists but not indexed in Hub/Portal APIs)
 *
 * EXAMPLE CASE: Aurora, CO
 * - Data exists: ags.auroragov.org/aurora/rest/services/OpenData/MapServer/22
 * - NOT indexed in ArcGIS Hub API
 * - Requires direct server enumeration
 *
 * STRATEGY:
 * 1. Domain Discovery: Generate likely municipal GIS domain patterns
 * 2. Service Enumeration: Find MapServer/FeatureServer endpoints
 * 3. Layer Enumeration: List all layers in each service
 * 4. Semantic Validation: Apply SemanticLayerValidator to layer names
 * 5. Data Retrieval: Download GeoJSON for high-scoring layers
 *
 * PROVENANCE: Tracks data availability states
 * - 'found': Data discovered and validated
 * - 'not-indexed': Data exists but not in portal APIs (this scanner found it)
 * - 'no-public-portal': No GIS server found, but data may exist elsewhere
 * - 'truly-unavailable': Exhausted all autonomous discovery paths
 *
 * TYPE SAFETY: Nuclear-level strictness - no `any`, no loose casts.
 */

import type { CityInfo as CityTarget } from '../validators/geographic-validator.js';
import type { PortalCandidate } from './arcgis-hub.js';
import { SemanticValidator } from '../validators/semantic-validator.js';

/**
 * Layer metadata from ArcGIS REST API
 */
interface LayerMetadata {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly geometryType: string | null;
  readonly serviceUrl: string;
  readonly layerUrl: string;
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
  readonly layers?: readonly {
    readonly id: number;
    readonly name: string;
    readonly type?: string;
    readonly geometryType?: string;
  }[];
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
 * Discovery attempt metadata for provenance
 */
export interface DiscoveryAttempt {
  readonly scanner: string;
  readonly domainsChecked?: readonly string[];
  readonly servicesChecked?: number;
  readonly layersChecked?: number;
  readonly result: 'success' | 'no-data' | 'blocked' | 'error';
}

/**
 * Data availability classification
 */
export type DataAvailability = 'found' | 'not-indexed' | 'no-public-portal' | 'truly-unavailable';

/**
 * Direct MapServer Scanner
 *
 * Discovers municipal GIS endpoints NOT indexed in ArcGIS Hub/Portal APIs.
 */
export class DirectMapServerScanner {
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
   * Search for council district layers via direct MapServer enumeration
   */
  async search(city: CityTarget): Promise<PortalCandidate[]> {
    console.log(`   🔍 Direct MapServer scan: ${city.name}, ${city.state}`);

    const candidates: PortalCandidate[] = [];
    const domainsChecked: string[] = [];
    let servicesChecked = 0;
    let layersChecked = 0;

    // 1. Generate likely GIS domains
    const domains = this.generateMunicipalGISDomains(city);
    console.log(`   Generated ${domains.length} potential GIS domains`);

    // 2. Try each domain
    for (const domain of domains.slice(0, this.maxDomainsPerCity)) {
      domainsChecked.push(domain);
      console.log(`   Checking domain: ${domain}`);

      try {
        const services = await this.discoverServices(domain, city);

        if (services.length === 0) continue;

        console.log(`   ✅ Found ${services.length} services on ${domain}`);
        servicesChecked += services.length;

        // 3. Enumerate layers in each service
        for (const serviceUrl of services) {
          const layers = await this.enumerateLayers(serviceUrl);
          layersChecked += layers.length;

          // 4. Score each layer
          for (const layer of layers) {
            const result = this.semanticValidator.scoreTitle(layer.name);

            // Accept high-confidence (40) and medium-confidence (30) patterns
            if (result.score >= 30) {
              console.log(`   ✅ High-scoring layer: "${layer.name}" (score: ${result.score})`);

              candidates.push({
                id: `${layer.serviceUrl}/${layer.id}`,
                title: layer.name,
                description: `Layer ${layer.id} from ${domain}`,
                url: layer.layerUrl,
                downloadUrl: `${layer.layerUrl}/query?where=1%3D1&outFields=*&f=geojson`,
                score: result.score,
                portalType: 'arcgis-online', // Reuse type for GIS server data
              });
            } else if (result.score === 0) {
              console.log(`   ⚠️  Layer rejected: "${layer.name}" (${result.reasons.join(', ')})`);
            }
          }
        }
      } catch (error) {
        // Domain check failed (expected for non-existent servers)
        continue;
      }
    }

    // Track discovery metadata
    const discoveryAttempt: DiscoveryAttempt = {
      scanner: 'direct-mapserver',
      domainsChecked,
      servicesChecked,
      layersChecked,
      result: candidates.length > 0 ? 'success' : 'no-data',
    };

    // Store discovery attempt for provenance (would be used by caller)
    console.log(`   📊 Scan complete: ${candidates.length} candidates found (${domainsChecked.length} domains checked)`);

    return candidates;
  }

  /**
   * Generate likely municipal GIS domain patterns
   */
  private generateMunicipalGISDomains(city: CityTarget): readonly string[] {
    const citySlug = city.name.toLowerCase().replace(/\s+/g, '');
    const cityDash = city.name.toLowerCase().replace(/\s+/g, '-');
    const cityUnderscore = city.name.toLowerCase().replace(/\s+/g, '_');
    const stateSlug = city.state.toLowerCase();

    const domains: string[] = [
      // Pattern 1: City-specific ArcGIS Server subdomains (HIGHEST PRIORITY - Aurora CO pattern)
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

      // Pattern 4: Alternative city slug formats
      `gis.${cityDash}.gov`,
      `maps.${cityDash}.gov`,
      `gis.city${citySlug}.gov`,
      `maps.cityof${citySlug}.gov`,

      // Pattern 5: Common municipal patterns
      `${citySlug}arcgis.gov`,
      `${citySlug}.maps.arcgis.com`,
    ];

    return Object.freeze(domains);
  }

  /**
   * Discover ArcGIS REST services on a domain
   */
  private async discoverServices(domain: string, city: CityTarget): Promise<readonly string[]> {
    const serviceEndpoints: string[] = [];

    // Extract city name for Aurora CO pattern: /aurora/rest/services
    const citySlug = city.name.toLowerCase().replace(/\s+/g, '');

    const basePaths = [
      '/arcgis/rest/services',
      '/server/rest/services',
      '/rest/services',
      '/gis/rest/services',
      // Aurora CO pattern: /{cityname}/rest/services
      `/${citySlug}/rest/services`,
    ];

    // ALSO try known service paths directly (faster than folder recursion)
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
          redirect: 'follow', // Follow redirects (Aurora redirects ags.auroragov.org → data-auroraco.opendata.arcgis.com)
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          // Base path not found, try known service paths directly
          for (const servicePath of knownServicePaths) {
            try {
              const directUrl = `https://${domain}${basePath}${servicePath}`;
              const serviceCheck = await this.checkDirectService(directUrl);
              if (serviceCheck) {
                serviceEndpoints.push(directUrl);
              }
            } catch {
              // Service doesn't exist, continue
            }
          }
          // If we found direct services, return them
          if (serviceEndpoints.length > 0) {
            return Object.freeze(serviceEndpoints);
          }
          continue;
        }

        const data: unknown = await response.json();

        if (!isArcGISFolderResponse(data)) continue;

        // Found valid ArcGIS REST endpoint
        const baseServiceUrl = `https://${domain}${basePath}`;

        // Add services from root folder
        if (data.services) {
          for (const service of data.services) {
            const serviceUrl = `${baseServiceUrl}/${service.name}/${service.type}`;
            serviceEndpoints.push(serviceUrl);
          }
        }

        // Recursively check subfolders (max depth 2 to prevent timeout)
        if (data.folders) {
          for (const folder of data.folders) {
            const folderServices = await this.discoverServicesInFolder(
              baseServiceUrl,
              folder,
              1 // depth
            );
            serviceEndpoints.push(...folderServices);
          }
        }

        // Found services on this domain, return
        if (serviceEndpoints.length > 0) {
          return Object.freeze(serviceEndpoints);
        }
      } catch (error) {
        // This basePath doesn't exist, try direct service paths
        for (const servicePath of knownServicePaths) {
          try {
            const directUrl = `https://${domain}${basePath}${servicePath}`;
            const serviceCheck = await this.checkDirectService(directUrl);
            if (serviceCheck) {
              serviceEndpoints.push(directUrl);
            }
          } catch {
            // Service doesn't exist, continue
          }
        }
        // If we found direct services, return them
        if (serviceEndpoints.length > 0) {
          return Object.freeze(serviceEndpoints);
        }
        continue;
      }
    }

    return Object.freeze(serviceEndpoints);
  }

  /**
   * Check if a direct service URL exists (faster than folder recursion)
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
   * Recursively discover services in a folder
   */
  private async discoverServicesInFolder(
    baseUrl: string,
    folder: string,
    depth: number
  ): Promise<readonly string[]> {
    // Depth limit to prevent infinite recursion
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

      // Add services from this folder
      if (data.services) {
        for (const service of data.services) {
          const serviceUrl = `${baseUrl}/${folder}/${service.name}/${service.type}`;
          serviceEndpoints.push(serviceUrl);
        }
      }

      // Recursively check subfolders
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
      // Folder check failed
      return [];
    }

    return Object.freeze(serviceEndpoints);
  }

  /**
   * Enumerate all layers in a MapServer/FeatureServer
   */
  private async enumerateLayers(serviceUrl: string): Promise<readonly LayerMetadata[]> {
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

      const layers: LayerMetadata[] = [];

      // MapServer/FeatureServer has {layers: [...]} property
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
      console.warn(`   ⚠️ Failed to enumerate layers: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Get discovery attempt metadata (for provenance tracking)
   *
   * This method would be called by the orchestrator to track what was attempted.
   */
  getDiscoveryMetadata(
    domainsChecked: readonly string[],
    servicesChecked: number,
    layersChecked: number,
    foundData: boolean
  ): DiscoveryAttempt {
    return {
      scanner: 'direct-mapserver',
      domainsChecked,
      servicesChecked,
      layersChecked,
      result: foundData ? 'success' : 'no-data',
    };
  }

  /**
   * Classify data availability based on scan results
   */
  classifyDataAvailability(
    scanResults: {
      readonly portalIndexed: boolean; // Found in Hub/Portal APIs?
      readonly directScanFound: boolean; // Found via direct scan?
      readonly domainsChecked: number;
    }
  ): DataAvailability {
    if (scanResults.portalIndexed || scanResults.directScanFound) {
      // Data exists
      if (!scanResults.portalIndexed && scanResults.directScanFound) {
        // Type A failure: Data exists but not indexed
        return 'not-indexed';
      }
      return 'found';
    }

    if (scanResults.domainsChecked > 0) {
      // We checked domains but found nothing
      // Data may exist elsewhere (state GIS, manual submission needed)
      return 'no-public-portal';
    }

    // Truly unavailable (RARE - municipalities are legally required to publish districts)
    return 'truly-unavailable';
  }
}

/**
 * Example usage (for integration into orchestrator):
 *
 * ```typescript
 * const scanner = new DirectMapServerScanner();
 * const candidates = await scanner.search({
 *   name: 'Aurora',
 *   state: 'CO',
 *   fips: '0804000',
 * });
 *
 * // Track provenance
 * const availability = scanner.classifyDataAvailability({
 *   portalIndexed: false,
 *   directScanFound: candidates.length > 0,
 *   domainsChecked: 20,
 * });
 *
 * console.log(`Data availability: ${availability}`);
 * // Output: "Data availability: not-indexed" (Aurora CO case)
 * ```
 */
