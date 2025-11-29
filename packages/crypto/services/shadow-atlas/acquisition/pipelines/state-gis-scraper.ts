/**
 * State GIS Portal Scraper
 *
 * Scrapes municipal boundaries from state-level GIS clearinghouses.
 * Uses registry from registry/state-gis-portals.ts
 *
 * STRATEGY:
 * 1. Direct-layer: Download known layers (Hawaii model)
 * 2. Hub API fallback: Search portal for boundaries
 * 3. REST API fallback: Query catalog API
 *
 * PORTAL TYPES: ArcGIS, CKAN, Socrata, custom REST
 * PARALLELISM: Process 50 states concurrently
 */

import type {
  RawDataset,
  ScraperConfig,
  ScraperResult,
  GeoJSONFeatureCollection,
  ProvenanceMetadata,
  PortalType,
} from '../types.js';
import { STATE_GIS_PORTALS, type StateGISPortal } from '../../registry/state-gis-portals.js';
import { retryWithBackoff, sha256, parseLastModified, BatchProcessor } from '../utils.js';
import { PostDownloadValidator } from '../post-download-validator.js';

/**
 * Default configuration
 */
const DEFAULT_CONFIG: ScraperConfig = {
  maxParallel: 10,
  rateLimit: 5, // Conservative for state portals
  timeout: 60000, // Longer timeout for large datasets
  maxRetries: 3,
  backoffMultiplier: 2,
  userAgent: 'Shadow-Atlas-Acquisition/1.0',
};

/**
 * State GIS Portal Scraper
 */
export class StateGISPortalScraper {
  private readonly config: ScraperConfig;
  private readonly validator: PostDownloadValidator;

  constructor(config: Partial<ScraperConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.validator = new PostDownloadValidator();
  }

  /**
   * Scrape all state GIS portals
   */
  async scrapeAll(): Promise<ScraperResult> {
    const startTime = Date.now();

    console.log('Starting State GIS portal scrape...');

    const portals = Object.values(STATE_GIS_PORTALS);
    console.log(`Found ${portals.length} state portals`);

    // Process all portals in parallel
    const processor = new BatchProcessor(
      portals,
      (portal: StateGISPortal) => this.scrapePortal(portal),
      this.config.maxParallel,
      this.config.rateLimit
    );

    const { results, failures } = await processor.process();

    // Flatten results (each portal can yield multiple datasets)
    const datasets = results.flat().filter((r): r is RawDataset => r !== null);

    const executionTime = Date.now() - startTime;

    console.log(
      `\nState GIS scrape complete: ${datasets.length} datasets acquired, ${failures.length} portal failures in ${(executionTime / 1000).toFixed(1)}s`
    );

    return {
      datasets,
      failures: failures.map(f => ({
        source: (f.item as StateGISPortal).portalUrl,
        error: f.error.message,
      })),
      executionTime,
    };
  }

  /**
   * Scrape single state portal
   */
  private async scrapePortal(portal: StateGISPortal): Promise<readonly (RawDataset | null)[]> {
    console.log(`\nScraping ${portal.stateName} (${portal.portalUrl})`);

    try {
      switch (portal.searchStrategy) {
        case 'direct-layer':
          return await this.scrapeDirectLayers(portal);

        case 'hub-api':
          return await this.scrapeHubAPI(portal);

        case 'rest-api':
          return await this.scrapeRESTAPI(portal);

        case 'catalog-api':
          return await this.scrapeCatalogAPI(portal);

        default:
          console.warn(`Unknown search strategy for ${portal.state}: ${portal.searchStrategy}`);
          return [];
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to scrape ${portal.state}: ${errorMessage}`);
      return [];
    }
  }

  /**
   * Scrape known direct layers (Hawaii model)
   */
  private async scrapeDirectLayers(portal: StateGISPortal): Promise<readonly (RawDataset | null)[]> {
    if (!portal.municipalBoundaryLayers || portal.municipalBoundaryLayers.length === 0) {
      console.warn(`No direct layers configured for ${portal.state}`);
      return [];
    }

    const datasets: (RawDataset | null)[] = [];

    for (const layer of portal.municipalBoundaryLayers) {
      try {
        const layerUrl = `${portal.portalUrl}/arcgis/rest/services/${layer.layer}`;
        const dataset = await this.downloadArcGISLayer(layerUrl, portal);

        if (dataset) {
          datasets.push(dataset);
          console.log(`  ✓ Downloaded ${layer.coverage} (${dataset.provenance.featureCount} features)`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`  ✗ Failed to download ${layer.layer}: ${errorMessage}`);
        datasets.push(null);
      }
    }

    return datasets;
  }

  /**
   * Scrape using ArcGIS Hub API
   */
  private async scrapeHubAPI(portal: StateGISPortal): Promise<readonly (RawDataset | null)[]> {
    // Hub API search for municipal boundaries
    const searchUrl = new URL(`${portal.portalUrl}/api/v3/datasets`);
    searchUrl.searchParams.set('q', 'council district OR ward OR municipal boundary');
    searchUrl.searchParams.set('page[size]', '100');

    try {
      const response = await retryWithBackoff(
        async () => {
          const res = await fetch(searchUrl.toString(), {
            headers: {
              'User-Agent': this.config.userAgent,
              Accept: 'application/json',
            },
            signal: AbortSignal.timeout(this.config.timeout),
          });

          if (!res.ok) {
            throw new Error(`Hub API search failed: ${res.status} ${res.statusText}`);
          }

          return res.json() as Promise<{ data: Array<{ attributes: { url: string } }> }>;
        },
        {
          maxAttempts: this.config.maxRetries,
          initialDelay: 1000,
          maxDelay: 10000,
          backoffMultiplier: this.config.backoffMultiplier,
        }
      );

      // Download all found layers
      const datasets: (RawDataset | null)[] = [];
      for (const item of response.data) {
        const dataset = await this.downloadArcGISLayer(item.attributes.url, portal);
        datasets.push(dataset);
      }

      return datasets;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Hub API search failed for ${portal.state}: ${errorMessage}`);
      return [];
    }
  }

  /**
   * Scrape using REST API
   */
  private async scrapeRESTAPI(portal: StateGISPortal): Promise<readonly (RawDataset | null)[]> {
    console.log(`REST API scraping not yet implemented for ${portal.state}`);
    return [];
  }

  /**
   * Scrape using Catalog API (CKAN, Socrata)
   */
  private async scrapeCatalogAPI(portal: StateGISPortal): Promise<readonly (RawDataset | null)[]> {
    if (portal.portalType === 'socrata') {
      return await this.scrapeSocrata(portal);
    } else if (portal.portalType === 'ckan') {
      return await this.scrapeCKAN(portal);
    } else {
      console.warn(`Unknown catalog type for ${portal.state}: ${portal.portalType}`);
      return [];
    }
  }

  /**
   * Scrape Socrata portal
   */
  private async scrapeSocrata(portal: StateGISPortal): Promise<readonly (RawDataset | null)[]> {
    console.log(`Socrata scraping not yet implemented for ${portal.state}`);
    return [];
  }

  /**
   * Scrape CKAN portal
   */
  private async scrapeCKAN(portal: StateGISPortal): Promise<readonly (RawDataset | null)[]> {
    console.log(`CKAN scraping not yet implemented for ${portal.state}`);
    return [];
  }

  /**
   * Download ArcGIS layer as GeoJSON
   */
  private async downloadArcGISLayer(layerUrl: string, portal: StateGISPortal): Promise<RawDataset | null> {
    try {
      const downloadUrl = new URL(`${layerUrl}/query`);
      downloadUrl.searchParams.set('where', '1=1');
      downloadUrl.searchParams.set('outFields', '*');
      downloadUrl.searchParams.set('f', 'geojson');
      downloadUrl.searchParams.set('returnGeometry', 'true');

      const response = await retryWithBackoff(
        async () => {
          const res = await fetch(downloadUrl.toString(), {
            headers: { 'User-Agent': this.config.userAgent },
            signal: AbortSignal.timeout(this.config.timeout),
          });

          if (!res.ok) {
            throw new Error(`Download failed: ${res.status} ${res.statusText}`);
          }

          return res;
        },
        {
          maxAttempts: this.config.maxRetries,
          initialDelay: 1000,
          maxDelay: 10000,
          backoffMultiplier: this.config.backoffMultiplier,
        }
      );

      const geojsonText = await response.text();
      const geojson = JSON.parse(geojsonText) as GeoJSONFeatureCollection;

      // Stage 1 Validation (Post-Download)
      const validation = this.validator.validate(geojson, {
        source: layerUrl,
        city: portal.stateName,
      });

      // Confidence routing
      if (validation.confidence < 60) {
        console.log(`❌ REJECTED: ${portal.stateName} (${validation.confidence}% confidence)`);
        console.log(`   Issues: ${validation.issues.join(', ')}`);
        return null;
      }

      if (validation.confidence < 85) {
        console.log(`⚠️  REVIEW NEEDED: ${portal.stateName} (${validation.confidence}% confidence)`);
        console.log(`   Warnings: ${validation.warnings.join(', ')}`);
      } else {
        console.log(`✅ ACCEPTED: ${portal.stateName} (${validation.confidence}% confidence, ${validation.metadata.featureCount} features)`);
      }

      const lastModified = parseLastModified(response.headers.get('Last-Modified'));

      const provenance: ProvenanceMetadata = {
        source: layerUrl,
        authority: 'state-gis',
        jurisdiction: `USA/${portal.stateName}`,
        timestamp: Date.now(),
        sourceLastModified: lastModified,
        method: 'ArcGIS REST API',
        responseHash: sha256(geojsonText),
        httpStatus: response.status,
        legalBasis: portal.notes.includes('Authoritative') ? 'State statute' : undefined,
        license: 'Public Domain (state data)',
        featureCount: geojson.features.length,
        geometryType: this.inferGeometryType(geojson),
        coordinateSystem: 'EPSG:4326',
        validation: {
          confidence: validation.confidence,
          issues: validation.issues,
          warnings: validation.warnings,
          timestamp: new Date().toISOString(),
        },
      };

      return { geojson, provenance };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to download ${layerUrl}: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Infer geometry type from GeoJSON
   */
  private inferGeometryType(geojson: GeoJSONFeatureCollection): 'Polygon' | 'MultiPolygon' {
    if (geojson.features.length === 0) return 'Polygon';

    const firstGeometry = geojson.features[0]?.geometry;
    if (!firstGeometry) return 'Polygon';

    return firstGeometry.type as 'Polygon' | 'MultiPolygon';
  }
}

/**
 * CLI entry point
 */
export async function main(): Promise<void> {
  const scraper = new StateGISPortalScraper();
  const result = await scraper.scrapeAll();

  console.log('\n=== Final Results ===');
  console.log(`Datasets acquired: ${result.datasets.length}`);
  console.log(`Failures: ${result.failures.length}`);
  console.log(`Execution time: ${(result.executionTime / 1000).toFixed(1)}s`);

  if (result.failures.length > 0) {
    console.log('\n=== Failures ===');
    result.failures.forEach(f => {
      console.log(`  ${f.source}: ${f.error}`);
    });
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
