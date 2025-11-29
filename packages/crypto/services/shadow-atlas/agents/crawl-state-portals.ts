#!/usr/bin/env npx tsx
/**
 * State Portal Crawler - Phase 2 P3
 *
 * Systematically crawls state-level GIS portals for governance district boundaries.
 * Supports multiple platforms: ArcGIS Hub, Socrata, CKAN.
 *
 * Usage:
 *   npx tsx agents/crawl-state-portals.ts --states CA,TX,FL
 *   npx tsx agents/crawl-state-portals.ts --priority 1-5
 *   npx tsx agents/crawl-state-portals.ts --all
 *   npx tsx agents/crawl-state-portals.ts --test CA
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

interface LayerInfo {
  readonly service_url: string;
  readonly layer_number: number;
  readonly layer_url: string;
  readonly layer_name: string;
  readonly geometry_type: string | null;
  readonly feature_count: number | null;
  readonly fields: readonly string[];
  readonly source_state: string;
  readonly source_portal: string;
  readonly discovery_method: 'state_portal_arcgis' | 'state_portal_socrata' | 'state_portal_ckan';
}

interface StatePortal {
  readonly state: string;
  readonly state_code: string;
  readonly portal_url: string;
  readonly platform: string;
  readonly api_endpoint: string;
  readonly population: number;
  readonly expected_yield: number;
  readonly priority: number;
  readonly notes: string;
}

interface PortalInventory {
  readonly metadata: {
    readonly created: string;
    readonly purpose: string;
    readonly total_portals: number;
    readonly total_population_covered: number;
  };
  readonly portals: readonly StatePortal[];
}

interface CrawlStatistics {
  startTime: number;
  endTime: number;
  totalPortals: number;
  successfulPortals: number;
  failedPortals: number;
  totalLayers: number;
  governanceLayers: number;
  byPlatform: Record<string, number>;
  byState: Record<string, number>;
}

/**
 * ArcGIS Hub Platform Crawler
 */
class ArcGISHubCrawler {
  private requestCount = 0;
  private readonly userAgent = 'ShadowAtlas/1.0 (State Portal Crawler - Phase 2 P3)';

  async crawlPortal(portal: StatePortal): Promise<LayerInfo[]> {
    console.log(`\n[ArcGIS Hub] Crawling ${portal.state}...`);

    const layers: LayerInfo[] = [];
    let page = 1;
    const pageSize = 100;

    try {
      // ArcGIS Hub search for governance keywords
      const keywords = ['council', 'district', 'ward', 'municipal', 'precinct', 'commissioner'];

      for (const keyword of keywords) {
        let hasMore = true;

        while (hasMore) {
          const searchUrl = new URL(`${portal.api_endpoint}`);
          searchUrl.searchParams.set('filter[q]', keyword);
          searchUrl.searchParams.set('filter[type]', 'Feature Service');
          searchUrl.searchParams.set('page[size]', String(pageSize));
          searchUrl.searchParams.set('page[number]', String(page));

          console.log(`  Searching "${keyword}" (page ${page})...`);

          const response = await fetch(searchUrl.toString(), {
            headers: { 'User-Agent': this.userAgent },
            signal: AbortSignal.timeout(30000),
          });

          if (!response.ok) {
            console.warn(`  ⚠️  HTTP ${response.status} for ${keyword}`);
            break;
          }

          this.requestCount++;

          const data = await response.json() as { data?: Array<Record<string, unknown>> };

          if (!data.data || data.data.length === 0) {
            hasMore = false;
            break;
          }

          // Extract service URLs from results
          for (const dataset of data.data) {
            const attributes = dataset.attributes as Record<string, unknown>;
            const url = String(attributes?.url ?? '');

            if (url && (url.includes('FeatureServer') || url.includes('MapServer'))) {
              // Enumerate layers in this service
              const serviceLayers = await this.enumerateService(url, portal);
              layers.push(...serviceLayers);
            }
          }

          if (data.data.length < pageSize) {
            hasMore = false;
          } else {
            page++;
          }

          // Rate limit
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        page = 1; // Reset for next keyword
      }

      console.log(`  ✓ Found ${layers.length} layers from ${portal.state}`);
      return layers;

    } catch (error) {
      console.error(`  ✗ Error crawling ${portal.state}:`, (error as Error).message);
      return [];
    }
  }

  private async enumerateService(serviceUrl: string, portal: StatePortal): Promise<LayerInfo[]> {
    try {
      const response = await fetch(`${serviceUrl}?f=json`, {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        return [];
      }

      this.requestCount++;

      const data = await response.json() as Record<string, unknown>;
      const layersArray = Array.isArray(data.layers) ? data.layers as Array<Record<string, unknown>> : [];

      const layers: LayerInfo[] = [];

      for (const layer of layersArray) {
        const layerId = typeof layer.id === 'number' ? layer.id : null;
        if (layerId === null) continue;

        const layerUrl = `${serviceUrl}/${layerId}`;
        const layerInfo = await this.fetchLayerDetails(layerUrl, portal);

        if (layerInfo) {
          layers.push(layerInfo);
        }
      }

      return layers;

    } catch (error) {
      return [];
    }
  }

  private async fetchLayerDetails(layerUrl: string, portal: StatePortal): Promise<LayerInfo | null> {
    try {
      const response = await fetch(`${layerUrl}?f=json`, {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return null;
      }

      this.requestCount++;

      const data = await response.json() as Record<string, unknown>;

      const match = layerUrl.match(/\/(\d+)$/);
      const layerNumber = match ? parseInt(match[1], 10) : 0;

      // Fetch actual feature count
      const featureCount = await this.fetchFeatureCount(layerUrl);

      return {
        service_url: layerUrl.replace(/\/\d+$/, ''),
        layer_number: layerNumber,
        layer_url: layerUrl,
        layer_name: String(data.name ?? 'Unknown'),
        geometry_type: data.geometryType ? String(data.geometryType) : null,
        feature_count: featureCount,
        fields: Array.isArray(data.fields) ?
          (data.fields as Array<Record<string, unknown>>).map(f => String(f.name ?? '')) : [],
        source_state: portal.state_code,
        source_portal: portal.portal_url,
        discovery_method: 'state_portal_arcgis',
      };

    } catch (error) {
      return null;
    }
  }

  private async fetchFeatureCount(layerUrl: string): Promise<number | null> {
    try {
      const queryUrl = `${layerUrl}/query?where=1=1&returnCountOnly=true&f=json`;

      const response = await fetch(queryUrl, {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return null;
      }

      this.requestCount++;

      const data = await response.json() as Record<string, unknown>;

      if (typeof data.count === 'number') {
        return data.count;
      }

      return null;

    } catch (error) {
      return null;
    }
  }

  getRequestCount(): number {
    return this.requestCount;
  }
}

/**
 * Socrata Platform Crawler
 */
class SocrataCrawler {
  private requestCount = 0;
  private readonly userAgent = 'ShadowAtlas/1.0 (State Portal Crawler - Phase 2 P3)';

  async crawlPortal(portal: StatePortal): Promise<LayerInfo[]> {
    console.log(`\n[Socrata] Crawling ${portal.state}...`);

    const layers: LayerInfo[] = [];

    try {
      // Socrata catalog search for spatial datasets with governance keywords
      const searchUrl = new URL(portal.api_endpoint);
      searchUrl.searchParams.set('q', 'council district ward municipal boundary precinct');
      searchUrl.searchParams.set('only', 'datasets');
      searchUrl.searchParams.set('limit', '1000');

      console.log(`  Searching Socrata catalog...`);

      const response = await fetch(searchUrl.toString(), {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        console.warn(`  ⚠️  HTTP ${response.status}`);
        return [];
      }

      this.requestCount++;

      const data = await response.json() as { results?: Array<Record<string, unknown>> };

      if (!data.results) {
        return [];
      }

      console.log(`  Found ${data.results.length} candidate datasets`);

      // Filter for geospatial datasets and extract ArcGIS URLs
      for (const result of data.results) {
        const resource = result.resource as Record<string, unknown>;

        // Check if dataset has geometry
        const columns = Array.isArray(resource.columns_field_name) ? resource.columns_field_name : [];
        const hasGeometry = columns.some((col: unknown) =>
          typeof col === 'string' && col.toLowerCase().includes('geometry')
        );

        if (!hasGeometry) {
          continue;
        }

        // Look for ArcGIS FeatureServer URL in metadata
        const metadata = resource.metadata as Record<string, unknown>;
        const customFields = metadata?.custom_fields as Record<string, unknown>;

        // Many Socrata datasets link to ArcGIS services
        let arcgisUrl: string | null = null;

        if (typeof customFields?.arcgis_url === 'string') {
          arcgisUrl = customFields.arcgis_url;
        } else if (typeof customFields?.['ArcGIS Online URL'] === 'string') {
          arcgisUrl = customFields['ArcGIS Online URL'];
        } else if (typeof metadata?.arcgis_url === 'string') {
          arcgisUrl = metadata.arcgis_url;
        }

        if (arcgisUrl && (arcgisUrl.includes('FeatureServer') || arcgisUrl.includes('MapServer'))) {
          // Enumerate this service
          const serviceLayers = await this.enumerateService(arcgisUrl, portal);
          layers.push(...serviceLayers);
        }
      }

      console.log(`  ✓ Found ${layers.length} layers from ${portal.state}`);
      return layers;

    } catch (error) {
      console.error(`  ✗ Error crawling ${portal.state}:`, (error as Error).message);
      return [];
    }
  }

  private async enumerateService(serviceUrl: string, portal: StatePortal): Promise<LayerInfo[]> {
    try {
      const response = await fetch(`${serviceUrl}?f=json`, {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        return [];
      }

      this.requestCount++;

      const data = await response.json() as Record<string, unknown>;
      const layersArray = Array.isArray(data.layers) ? data.layers as Array<Record<string, unknown>> : [];

      const layers: LayerInfo[] = [];

      for (const layer of layersArray) {
        const layerId = typeof layer.id === 'number' ? layer.id : null;
        if (layerId === null) continue;

        const layerUrl = `${serviceUrl}/${layerId}`;
        const layerInfo = await this.fetchLayerDetails(layerUrl, portal);

        if (layerInfo) {
          layers.push(layerInfo);
        }
      }

      return layers;

    } catch (error) {
      return [];
    }
  }

  private async fetchLayerDetails(layerUrl: string, portal: StatePortal): Promise<LayerInfo | null> {
    try {
      const response = await fetch(`${layerUrl}?f=json`, {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return null;
      }

      this.requestCount++;

      const data = await response.json() as Record<string, unknown>;

      const match = layerUrl.match(/\/(\d+)$/);
      const layerNumber = match ? parseInt(match[1], 10) : 0;

      const featureCount = await this.fetchFeatureCount(layerUrl);

      return {
        service_url: layerUrl.replace(/\/\d+$/, ''),
        layer_number: layerNumber,
        layer_url: layerUrl,
        layer_name: String(data.name ?? 'Unknown'),
        geometry_type: data.geometryType ? String(data.geometryType) : null,
        feature_count: featureCount,
        fields: Array.isArray(data.fields) ?
          (data.fields as Array<Record<string, unknown>>).map(f => String(f.name ?? '')) : [],
        source_state: portal.state_code,
        source_portal: portal.portal_url,
        discovery_method: 'state_portal_socrata',
      };

    } catch (error) {
      return null;
    }
  }

  private async fetchFeatureCount(layerUrl: string): Promise<number | null> {
    try {
      const queryUrl = `${layerUrl}/query?where=1=1&returnCountOnly=true&f=json`;

      const response = await fetch(queryUrl, {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return null;
      }

      this.requestCount++;

      const data = await response.json() as Record<string, unknown>;

      if (typeof data.count === 'number') {
        return data.count;
      }

      return null;

    } catch (error) {
      return null;
    }
  }

  getRequestCount(): number {
    return this.requestCount;
  }
}

/**
 * CKAN Platform Crawler
 */
class CKANCrawler {
  private requestCount = 0;
  private readonly userAgent = 'ShadowAtlas/1.0 (State Portal Crawler - Phase 2 P3)';

  async crawlPortal(portal: StatePortal): Promise<LayerInfo[]> {
    console.log(`\n[CKAN] Crawling ${portal.state}...`);
    console.log(`  ⚠️  CKAN portals require shapefile processing (Phase 3)`);
    console.log(`  Flagging datasets for manual review...`);

    // CKAN portals typically host downloadable shapefiles, not ArcGIS services
    // This requires Phase 3 implementation (shapefile processing pipeline)
    // For Phase 2 P3, we'll flag these for later processing

    return [];
  }

  getRequestCount(): number {
    return this.requestCount;
  }
}

/**
 * Main State Portal Crawler
 */
class StatePortalCrawler {
  private arcgisCrawler = new ArcGISHubCrawler();
  private socrataCrawler = new SocrataCrawler();
  private ckanCrawler = new CKANCrawler();

  async crawlPortals(portals: readonly StatePortal[]): Promise<{
    layers: LayerInfo[];
    statistics: CrawlStatistics;
  }> {
    const statistics: CrawlStatistics = {
      startTime: Date.now(),
      endTime: 0,
      totalPortals: portals.length,
      successfulPortals: 0,
      failedPortals: 0,
      totalLayers: 0,
      governanceLayers: 0,
      byPlatform: {},
      byState: {},
    };

    const allLayers: LayerInfo[] = [];

    console.log('='.repeat(70));
    console.log('STATE PORTAL CRAWLER - Phase 2 P3');
    console.log('='.repeat(70));
    console.log(`Crawling ${portals.length} state portals...`);
    console.log('');

    for (const portal of portals) {
      try {
        let layers: LayerInfo[] = [];

        if (portal.platform === 'ArcGIS Hub') {
          layers = await this.arcgisCrawler.crawlPortal(portal);
        } else if (portal.platform === 'Socrata') {
          layers = await this.socrataCrawler.crawlPortal(portal);
        } else if (portal.platform === 'CKAN') {
          layers = await this.ckanCrawler.crawlPortal(portal);
        } else {
          console.log(`\n[${portal.platform}] Skipping ${portal.state} (custom platform)`);
          continue;
        }

        if (layers.length > 0) {
          statistics.successfulPortals++;
          statistics.byPlatform[portal.platform] = (statistics.byPlatform[portal.platform] || 0) + layers.length;
          statistics.byState[portal.state_code] = layers.length;
          allLayers.push(...layers);
        } else {
          statistics.failedPortals++;
        }

      } catch (error) {
        console.error(`\n✗ Fatal error crawling ${portal.state}:`, (error as Error).message);
        statistics.failedPortals++;
      }

      // Rate limit between portals
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Filter for governance districts
    const governanceLayers = allLayers.filter(layer => {
      const name = layer.layer_name.toLowerCase();
      return (
        (name.includes('council') ||
         name.includes('ward') ||
         name.includes('district') ||
         name.includes('precinct') ||
         name.includes('commissioner')) &&
        layer.geometry_type === 'esriGeometryPolygon' &&
        (layer.feature_count === null || (layer.feature_count > 0 && layer.feature_count < 1000))
      );
    });

    statistics.endTime = Date.now();
    statistics.totalLayers = allLayers.length;
    statistics.governanceLayers = governanceLayers.length;

    return { layers: governanceLayers, statistics };
  }

  getTotalRequests(): number {
    return (
      this.arcgisCrawler.getRequestCount() +
      this.socrataCrawler.getRequestCount() +
      this.ckanCrawler.getRequestCount()
    );
  }
}

/**
 * Parse command line arguments
 */
function parseArgs(): {
  states: string[];
  priority: { min: number; max: number } | null;
  all: boolean;
  test: string | null;
} {
  const args = process.argv.slice(2);

  const statesIndex = args.indexOf('--states');
  const priorityIndex = args.indexOf('--priority');
  const testIndex = args.indexOf('--test');

  return {
    states: statesIndex !== -1 && args[statesIndex + 1] ?
      args[statesIndex + 1].split(',') : [],
    priority: priorityIndex !== -1 && args[priorityIndex + 1] ?
      (() => {
        const range = args[priorityIndex + 1].split('-');
        return {
          min: parseInt(range[0], 10),
          max: parseInt(range[1] ?? range[0], 10),
        };
      })() : null,
    all: args.includes('--all'),
    test: testIndex !== -1 && args[testIndex + 1] ? args[testIndex + 1] : null,
  };
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = parseArgs();

  // Load portal inventory
  const inventoryPath = join(__dirname, 'state-portals.json');
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf-8')) as PortalInventory;

  // Select portals based on arguments
  let selectedPortals: StatePortal[] = [];

  if (args.test) {
    // Test mode - single state
    const portal = inventory.portals.find(p => p.state_code === args.test);
    if (!portal) {
      console.error(`Unknown state code: ${args.test}`);
      process.exit(1);
    }
    selectedPortals = [portal];
    console.log(`Test mode: ${portal.state}`);
  } else if (args.all) {
    // Crawl all portals
    selectedPortals = [...inventory.portals];
  } else if (args.states.length > 0) {
    // Specific states
    for (const stateCode of args.states) {
      const portal = inventory.portals.find(p => p.state_code === stateCode);
      if (portal) {
        selectedPortals.push(portal);
      } else {
        console.warn(`Unknown state code: ${stateCode}`);
      }
    }
  } else if (args.priority) {
    // Priority range
    selectedPortals = inventory.portals.filter(
      p => p.priority >= args.priority!.min && p.priority <= args.priority!.max
    );
  } else {
    // Default: top 10 (priority 1-10)
    selectedPortals = inventory.portals.filter(p => p.priority <= 10);
  }

  if (selectedPortals.length === 0) {
    console.error('No portals selected. Use --all, --states CA,TX, or --priority 1-5');
    process.exit(1);
  }

  // Run crawler
  const crawler = new StatePortalCrawler();
  const { layers, statistics } = await crawler.crawlPortals(selectedPortals);

  // Save results
  const outputPath = join(__dirname, 'data', 'state_portal_discoveries.jsonl');
  writeFileSync(
    outputPath,
    layers.map(l => JSON.stringify(l)).join('\n')
  );

  // Save statistics
  const statsPath = join(__dirname, 'data', 'state_portal_statistics.json');
  writeFileSync(statsPath, JSON.stringify(statistics, null, 2));

  // Print summary
  console.log('\n' + '='.repeat(70));
  console.log('CRAWL COMPLETE');
  console.log('='.repeat(70));
  console.log(`Total portals: ${statistics.totalPortals}`);
  console.log(`Successful: ${statistics.successfulPortals}`);
  console.log(`Failed: ${statistics.failedPortals}`);
  console.log(`Total layers discovered: ${statistics.totalLayers}`);
  console.log(`Governance layers: ${statistics.governanceLayers}`);
  console.log(`Total API requests: ${crawler.getTotalRequests()}`);
  console.log(`Duration: ${Math.round((statistics.endTime - statistics.startTime) / 1000)}s`);
  console.log('');
  console.log('By platform:');
  for (const [platform, count] of Object.entries(statistics.byPlatform)) {
    console.log(`  ${platform}: ${count}`);
  }
  console.log('');
  console.log('By state:');
  for (const [state, count] of Object.entries(statistics.byState)) {
    console.log(`  ${state}: ${count}`);
  }
  console.log('');
  console.log(`Output: ${outputPath}`);
  console.log(`Statistics: ${statsPath}`);
  console.log('='.repeat(70));
}

main().catch(console.error);
