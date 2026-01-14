/**
 * State GIS Clearinghouse Scanner
 *
 * PHILOSOPHY: When city portals fail, state GIS clearinghouses are the AUTHORITATIVE fallback.
 * States are legally mandated to maintain electoral district boundaries.
 *
 * AUTHORITY HIERARCHY:
 * 1. Municipal portal (data.{city}.gov) - Highest precision, variable reliability
 * 2. State GIS clearinghouse (this scanner) - High precision, high reliability, authoritative
 * 3. Federal data (Census TIGER) - Medium precision, universal coverage
 *
 * EXAMPLE SUCCESS: Urban Honolulu
 * - City portal search failed (name mismatch in US Census Places)
 * - State GIS (Hawaii Statewide GIS Program) has authoritative data
 * - geodata.hawaii.gov/arcgis/rest/services/AdminBnd/MapServer/11
 *
 * STRATEGIES:
 * 1. direct-layer: Known layer IDs for specific cities (Hawaii model)
 * 2. hub-api: Search ArcGIS Hub for municipal boundaries (most states)
 * 3. catalog-api: Search CKAN/Socrata catalogs (Pennsylvania, Colorado)
 * 4. rest-api: Enumerate ArcGIS REST services (Massachusetts model)
 */

import type { CityInfo as CityTarget } from '../../validators/geographic/validator.js';
import type { PortalCandidate } from './arcgis-hub.js';
import { getStatePortal, type StateGISPortal } from '../../core/registry/state-gis-portals.js';
import { SemanticValidator } from '../../validators/semantic/validator.js';
import { logger } from '../../core/utils/logger.js';

/**
 * State GIS Clearinghouse Scanner
 *
 * Queries state-level authoritative GIS portals for municipal boundary data.
 */
export class StateGISClearinghouseScanner {
  private readonly semanticValidator: SemanticValidator;
  private readonly HUB_API_BASE = 'https://hub.arcgis.com/api/v3';

  constructor() {
    this.semanticValidator = new SemanticValidator();
  }

  /**
   * Scan state GIS portal for city council districts
   *
   * Returns candidates from state portal (fallback when city portal fails)
   */
  async scan(city: CityTarget): Promise<PortalCandidate[]> {
    logger.info('Starting State GIS clearinghouse scan', {
      city: city.name,
      state: city.state
    });

    const statePortal = getStatePortal(city.state);

    if (!statePortal) {
      logger.info('No state GIS portal registered', {
        city: city.name,
        state: city.state
      });
      return [];
    }

    logger.info('State GIS portal found', {
      city: city.name,
      state: city.state,
      portalUrl: statePortal.portalUrl,
      authority: statePortal.authority
    });

    // Strategy 1: Direct layer access (Hawaii-style)
    if (statePortal.searchStrategy === 'direct-layer' && statePortal.municipalBoundaryLayers) {
      return await this.scanDirectLayers(city, statePortal);
    }

    // Strategy 2: Hub API search (most states)
    if (statePortal.searchStrategy === 'hub-api') {
      return await this.scanHubAPI(city, statePortal);
    }

    // Strategy 3: Catalog API search (CKAN/Socrata)
    if (statePortal.searchStrategy === 'catalog-api') {
      return await this.scanCatalogAPI(city, statePortal);
    }

    // Strategy 4: REST API enumeration (Massachusetts model)
    if (statePortal.searchStrategy === 'rest-api') {
      return await this.scanRESTAPI(city, statePortal);
    }

    logger.warn('Unknown search strategy for state portal', {
      city: city.name,
      state: city.state,
      searchStrategy: statePortal.searchStrategy
    });
    return [];
  }

  /**
   * Strategy 1: Direct layer access (Hawaii model - known layer IDs)
   *
   * WHEN: State maintains centralized municipal boundary layers with known IDs
   * EXAMPLE: Hawaii Statewide GIS - AdminBnd/MapServer/11 (Honolulu County)
   */
  private async scanDirectLayers(
    city: CityTarget,
    portal: StateGISPortal
  ): Promise<PortalCandidate[]> {
    const candidates: PortalCandidate[] = [];

    for (const layer of portal.municipalBoundaryLayers || []) {
      // Check if this layer covers our city
      if (!this.layerCoversCity(layer.coverage, city)) {
        continue;
      }

      const layerUrl = `${portal.portalUrl}/arcgis/rest/services/${layer.layer}`;

      try {
        // Get layer metadata
        const metadataUrl = `${layerUrl}?f=json`;
        const response = await fetch(metadataUrl, {
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          logger.warn('Failed to fetch state GIS layer metadata', {
            city: city.name,
            state: city.state,
            layer: layer.layer,
            status: response.status
          });
          continue;
        }

        const layerInfo = await response.json() as {
          name: string;
          description?: string;
          type: string;
          geometryType?: string;
        };

        // Verify this is a polygon layer (council districts must be polygons)
        if (layerInfo.geometryType !== 'esriGeometryPolygon' && layerInfo.geometryType !== 'esriGeometryMultiPolygon') {
          logger.debug('Skipping non-polygon layer', {
            city: city.name,
            state: city.state,
            layerName: layerInfo.name,
            geometryType: layerInfo.geometryType
          });
          continue;
        }

        // Score the layer title
        const score = this.semanticValidator.scoreTitle(layerInfo.name);

        if (score.score >= 30) {
          // Medium confidence or higher
          const downloadUrl = `${layerUrl}/query?where=1%3D1&outFields=*&f=geojson`;

          candidates.push({
            id: layer.layer,
            title: layerInfo.name,
            description: layerInfo.description || layer.coverage,
            url: layerUrl,
            downloadUrl,
            score: score.score + 20, // Boost score for state-level authority
            portalType: 'state-gis',
            featureCount: layer.featureCount,
          });

          logger.info('Direct state GIS layer found', {
            city: city.name,
            state: city.state,
            layerName: layerInfo.name,
            score: score.score + 20
          });
        } else {
          logger.debug('State GIS layer rejected', {
            city: city.name,
            state: city.state,
            layerName: layerInfo.name,
            score: score.score,
            reasons: score.reasons
          });
        }
      } catch (error) {
        logger.warn('Failed to check state GIS layer', {
          city: city.name,
          state: city.state,
          layer: layer.layer,
          error: (error as Error).message
        });
      }
    }

    return candidates;
  }

  /**
   * Strategy 2: Hub API search (standard state portals)
   *
   * WHEN: State uses ArcGIS Hub for open data
   * EXAMPLE: Washington State GIS, Minnesota Geospatial Commons
   */
  private async scanHubAPI(
    city: CityTarget,
    portal: StateGISPortal
  ): Promise<PortalCandidate[]> {
    // Search state portal for city council districts (use /datasets endpoint, not /search)
    const query = `${city.name} ${city.state} council district OR ward`;
    const url = `${this.HUB_API_BASE}/datasets?q=${encodeURIComponent(query)}`;

    try {
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        logger.warn('State Hub API search failed', {
          city: city.name,
          state: city.state,
          status: response.status
        });
        return [];
      }

      const data = await response.json() as {
        data: Array<{
          id: string;
          type: string;
          attributes: {
            name: string;
            description?: string;
            url?: string;
            serviceUrl?: string;
            recordCount?: number;
          };
        }>;
      };

      // Filter and score results
      const candidates: PortalCandidate[] = [];

      for (const dataset of data.data) {
        const title = dataset.attributes.name;
        const score = this.semanticValidator.scoreTitle(title);

        if (score.score < 30) {
          // Reject low-confidence matches
          continue;
        }

        // Get service URL for this dataset
        const serviceUrl = dataset.attributes.serviceUrl || dataset.attributes.url;
        if (!serviceUrl) {
          continue;
        }

        // Find polygon layer in service
        const layerId = await this.findPolygonLayer(serviceUrl);
        if (layerId === null) {
          continue;
        }

        const downloadUrl = `${serviceUrl}/${layerId}/query?where=1%3D1&outFields=*&f=geojson`;

        candidates.push({
          id: dataset.id,
          title,
          description: dataset.attributes.description || '',
          url: serviceUrl,
          downloadUrl,
          score: score.score + 15, // Boost for state-level authority
          portalType: 'state-gis',
          featureCount: dataset.attributes.recordCount,
        });

        logger.info('State Hub API result found', { city: city.name, state: city.state, title, score: score.score + 15 });
      }

      return candidates;
    } catch (error) {
      logger.warn('State Hub API search failed', { city: city.name, state: city.state, error: (error as Error).message });
      return [];
    }
  }

  /**
   * Strategy 3: Catalog API search (CKAN/Socrata)
   *
   * WHEN: State uses CKAN or Socrata for open data
   * EXAMPLE: Pennsylvania PASDA (CKAN), Colorado Information Marketplace (Socrata)
   */
  private async scanCatalogAPI(
    city: CityTarget,
    portal: StateGISPortal
  ): Promise<PortalCandidate[]> {
    if (portal.portalType === 'ckan') {
      return await this.scanCKAN(city, portal);
    }

    if (portal.portalType === 'socrata') {
      return await this.scanSocrata(city, portal);
    }

    logger.warn('Unknown state portal catalog type', { city: city.name, state: city.state, portalType: portal.portalType });
    return [];
  }

  /**
   * Scan CKAN portal (Pennsylvania PASDA model)
   */
  private async scanCKAN(
    city: CityTarget,
    portal: StateGISPortal
  ): Promise<PortalCandidate[]> {
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
              name: string;
            }>;
          }>;
        };
      };

      const packages = data.result?.results || [];
      const candidates: PortalCandidate[] = [];

      for (const pkg of packages) {
        const score = this.semanticValidator.scoreTitle(pkg.title);

        if (score.score < 30) {
          continue;
        }

        // Find GeoJSON or Shapefile resource
        const geoResource = pkg.resources?.find(r =>
          r.format.toLowerCase().includes('geojson') ||
          r.format.toLowerCase().includes('json') ||
          r.format.toLowerCase().includes('shapefile') ||
          r.format.toLowerCase().includes('shp')
        );

        if (geoResource) {
          candidates.push({
            id: pkg.id,
            title: pkg.title,
            description: pkg.notes || '',
            url: `${portal.portalUrl}/dataset/${pkg.name}`,
            downloadUrl: geoResource.url,
            score: score.score + 15,
            portalType: 'state-gis',
          });

          logger.info('State CKAN result found', { city: city.name, state: city.state, title: pkg.title, score: score.score + 15 });
        }
      }

      return candidates;
    } catch (error) {
      logger.warn('State CKAN search failed', { city: city.name, state: city.state, error: (error as Error).message });
      return [];
    }
  }

  /**
   * Scan Socrata portal (Colorado model)
   */
  private async scanSocrata(
    city: CityTarget,
    portal: StateGISPortal
  ): Promise<PortalCandidate[]> {
    // Extract domain from portal URL
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
          metadata?: {
            domain: string;
          };
        }>;
      };

      const results = data.results || [];
      const candidates: PortalCandidate[] = [];

      for (const result of results) {
        const score = this.semanticValidator.scoreTitle(result.resource.name);

        if (score.score < 30) {
          continue;
        }

        const geojsonUrl = `https://${domain}/resource/${result.resource.id}.geojson?$limit=50000`;

        candidates.push({
          id: result.resource.id,
          title: result.resource.name,
          description: result.resource.description || '',
          url: result.link,
          downloadUrl: geojsonUrl,
          score: score.score + 15,
          portalType: 'state-gis',
        });

        logger.info('State Socrata result found', { city: city.name, state: city.state, name: result.resource.name, score: score.score + 15 });
      }

      return candidates;
    } catch (error) {
      logger.warn('State Socrata search failed', { city: city.name, state: city.state, error: (error as Error).message });
      return [];
    }
  }

  /**
   * Strategy 4: REST API enumeration (Massachusetts model)
   *
   * WHEN: State has ArcGIS REST services but no Hub
   * EXAMPLE: MassGIS REST endpoints
   */
  private async scanRESTAPI(
    city: CityTarget,
    portal: StateGISPortal
  ): Promise<PortalCandidate[]> {
    // Try common REST service patterns
    const patterns = [
      `${portal.portalUrl}/rest/services`,
      `${portal.portalUrl}/arcgis/rest/services`,
      `${portal.portalUrl}/server/rest/services`,
    ];

    for (const baseUrl of patterns) {
      try {
        const response = await fetch(`${baseUrl}?f=json`, {
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          // Found REST endpoint - recursively explore services
          logger.info('REST endpoint found', { city: city.name, state: city.state, baseUrl });
          return await this.exploreServicesRecursively(baseUrl, city);
        }
      } catch {
        // Continue to next pattern
      }
    }

    logger.info('No REST endpoint found for state', { city: city.name, state: city.state, stateName: portal.stateName });
    return [];
  }

  /**
   * Recursively explore ArcGIS REST services to find governance layers
   *
   * ARCHITECTURE:
   * - Recursive folder traversal with depth limit (max 5 levels)
   * - Rate limiting (10 req/sec) to avoid server throttling
   * - Governance keyword filtering for relevance
   * - Timeout handling for slow servers
   * - Skip known non-governance folders (Utilities, Transportation, etc.)
   */
  private async exploreServicesRecursively(
    baseUrl: string,
    city: CityTarget,
    folder: string = '',
    depth: number = 0
  ): Promise<PortalCandidate[]> {
    // Safety: Max recursion depth
    if (depth >= 5) {
      logger.debug('Max recursion depth reached', { folder: folder || '(root)' });
      return [];
    }

    // Safety: Skip known non-governance folders
    const skipFolders = [
      'utilities', 'transportation', 'basemaps', 'imagery',
      'elevation', 'parcels', 'environment', 'recreation'
    ];

    const folderLower = folder.toLowerCase();
    if (skipFolders.some(skip => folderLower.includes(skip))) {
      logger.debug('Skipping non-governance folder', { folder });
      return [];
    }

    const candidates: PortalCandidate[] = [];
    const folderUrl = folder
      ? `${baseUrl}/${folder}?f=json`
      : `${baseUrl}?f=json`;

    try {
      // Rate limiting: 100ms delay between requests (~10 req/sec)
      await new Promise(resolve => setTimeout(resolve, 100));

      const response = await fetch(folderUrl, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        logger.warn('Failed to fetch folder', { folder: folder || '(root)', status: response.status });
        return [];
      }

      const data = await response.json() as {
        folders?: string[];
        services?: Array<{
          name: string;
          type: string;
        }>;
      };

      // Process services in current folder
      if (data.services) {
        for (const service of data.services) {
          // Only process MapServer and FeatureServer
          if (service.type !== 'MapServer' && service.type !== 'FeatureServer') {
            continue;
          }

          // service.name contains full path (e.g., "Public/Boundaries")
          const serviceUrl = `${baseUrl}/${service.name}/${service.type}`;
          const serviceCandidates = await this.exploreService(serviceUrl, city);
          candidates.push(...serviceCandidates);
        }
      }

      // Recursively explore subfolders
      if (data.folders) {
        for (const subfolder of data.folders) {
          const subfolderPath = folder ? `${folder}/${subfolder}` : subfolder;
          const subfolderCandidates = await this.exploreServicesRecursively(
            baseUrl,
            city,
            subfolderPath,
            depth + 1
          );
          candidates.push(...subfolderCandidates);
        }
      }
    } catch (error) {
      logger.warn('Error exploring folder', { folder: folder || '(root)', error: (error as Error).message });
    }

    return candidates;
  }

  /**
   * Explore a single ArcGIS service for governance layers
   */
  private async exploreService(
    serviceUrl: string,
    city: CityTarget
  ): Promise<PortalCandidate[]> {
    try {
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));

      const response = await fetch(`${serviceUrl}?f=json`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return [];
      }

      const serviceData = await response.json() as {
        mapName?: string;
        name?: string;
        layers?: Array<{
          id: number;
          name: string;
        }>;
      };

      const candidates: PortalCandidate[] = [];

      // Check each layer for governance relevance
      if (serviceData.layers) {
        for (const layer of serviceData.layers) {
          const layerCandidate = await this.evaluateLayer(
            serviceUrl,
            layer.id,
            layer.name,
            city
          );

          if (layerCandidate) {
            candidates.push(layerCandidate);
          }
        }
      }

      return candidates;
    } catch (error) {
      logger.warn('Error exploring service', { serviceUrl, error: (error as Error).message });
      return [];
    }
  }

  /**
   * Evaluate a single layer for governance relevance
   *
   * GOVERNANCE KEYWORDS: council, district, ward, precinct, electoral, boundary,
   * voting, legislative, municipal, city, county, governance
   */
  private async evaluateLayer(
    serviceUrl: string,
    layerId: number,
    layerName: string,
    city: CityTarget
  ): Promise<PortalCandidate | null> {
    // Governance keyword filtering
    const governanceKeywords = [
      'council', 'district', 'ward', 'precinct', 'voting', 'electoral',
      'boundary', 'legislative', 'municipal', 'city', 'county', 'governance'
    ];

    const nameLower = layerName.toLowerCase();
    const hasGovernanceKeyword = governanceKeywords.some(keyword =>
      nameLower.includes(keyword)
    );

    if (!hasGovernanceKeyword) {
      return null; // Skip non-governance layers
    }

    try {
      // Get layer metadata
      const layerUrl = `${serviceUrl}/${layerId}`;

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));

      const response = await fetch(`${layerUrl}?f=json`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return null;
      }

      const layerData = await response.json() as {
        id: number;
        name: string;
        type?: string;
        geometryType?: string;
        description?: string;
      };

      // Must be polygon layer (governance boundaries are polygons)
      if (layerData.geometryType !== 'esriGeometryPolygon' && layerData.geometryType !== 'esriGeometryMultiPolygon') {
        return null;
      }

      // Score layer title using semantic validator
      const score = this.semanticValidator.scoreTitle(layerData.name);

      // Require at least medium confidence (≥30)
      if (score.score < 30) {
        logger.debug('State GIS layer rejected', { layerName: layerData.name, score: score.score, reasons: score.reasons });
         
        return null;
      }

      const downloadUrl = `${layerUrl}/query?where=1%3D1&outFields=*&f=geojson`;

      logger.info('Governance layer found', { layerName: layerData.name, score: score.score + 15 });

      return {
        id: `${serviceUrl}/${layerId}`,
        title: layerData.name,
        description: layerData.description || '',
        url: layerUrl,
        downloadUrl,
        score: score.score + 15, // Boost for state-level authority
        portalType: 'state-gis',
      };
    } catch (error) {
      logger.warn('Error evaluating layer', { layerId, error: (error as Error).message });
      return null;
    }
  }

  /**
   * Check if a layer covers the target city
   */
  private layerCoversCity(coverage: string, city: CityTarget): boolean {
    const coverageLower = coverage.toLowerCase();
    const cityLower = city.name.toLowerCase();

    // Direct name match
    if (coverageLower.includes(cityLower)) {
      return true;
    }

    // Special cases (e.g., "Honolulu County" for "Urban Honolulu")
    const cityWords = cityLower.split(/\s+/);
    return cityWords.some(word => word.length > 3 && coverageLower.includes(word));
  }

  /**
   * Find first polygon layer in ArcGIS FeatureServer/MapServer
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

      // Find first layer with polygon geometry
      const polygonLayer = metadata.layers?.find(layer =>
        layer.geometryType === 'esriGeometryPolygon' ||
        layer.geometryType === 'esriGeometryMultiPolygon'
      );

      return polygonLayer?.id ?? null;
    } catch (error) {
      return null;
    }
  }
}
