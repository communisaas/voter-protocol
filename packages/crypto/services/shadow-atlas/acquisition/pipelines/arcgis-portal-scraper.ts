/**
 * ArcGIS Portal Scraper
 *
 * Scrapes ALL Feature Services matching "council district" from ArcGIS Portal API.
 * Uses Portal API (NOT Hub API - it never worked).
 *
 * QUERY STRATEGY: Global search across all portals, not per-city.
 * RATE LIMIT: 10 requests/sec (Portal API limit)
 * OUTPUT: Raw GeoJSON with provenance metadata
 */

import type {
  RawDataset,
  ScraperConfig,
  ScraperResult,
  ArcGISPortalSearchResponse,
  ArcGISPortalItem,
  ArcGISFeatureServiceMetadata,
  GeoJSONFeatureCollection,
  ProvenanceMetadata,
} from '../types.js';
import { retryWithBackoff, sha256, parseLastModified, BatchProcessor } from '../utils.js';
import { PostDownloadValidator } from '../post-download-validator.js';

/**
 * Default configuration
 */
const DEFAULT_CONFIG: ScraperConfig = {
  maxParallel: 5,
  rateLimit: 10, // Portal API limit
  timeout: 30000,
  maxRetries: 3,
  backoffMultiplier: 2,
  userAgent: 'Shadow-Atlas-Acquisition/1.0',
};

/**
 * ArcGIS Portal Scraper
 */
export class ArcGISPortalScraper {
  private readonly config: ScraperConfig;
  private readonly portalApiBase = 'https://www.arcgis.com/sharing/rest';
  private readonly validator: PostDownloadValidator;

  constructor(config: Partial<ScraperConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.validator = new PostDownloadValidator();
  }

  /**
   * Scrape all council district Feature Services from Portal
   */
  async scrapeAll(): Promise<ScraperResult> {
    const startTime = Date.now();

    console.log('Starting ArcGIS Portal scrape...');

    // 1. Search for all relevant Feature Services
    const items = await this.searchPortal();
    console.log(`Found ${items.length} potential Feature Services`);

    // 2. Download all Feature Services in parallel
    const processor = new BatchProcessor(
      items,
      (item: ArcGISPortalItem) => this.downloadFeatureService(item),
      this.config.maxParallel,
      this.config.rateLimit
    );

    const { results, failures } = await processor.process();

    // Filter out null results (failed downloads)
    const datasets = results.filter((r): r is RawDataset => r !== null);

    const executionTime = Date.now() - startTime;

    console.log(
      `\nArcGIS Portal scrape complete: ${datasets.length} datasets acquired, ${failures.length} failed in ${(executionTime / 1000).toFixed(1)}s`
    );

    return {
      datasets,
      failures: failures.map(f => ({
        source: (f.item as ArcGISPortalItem).url,
        error: f.error.message,
      })),
      executionTime,
    };
  }

  /**
   * Search Portal for council district Feature Services
   */
  private async searchPortal(): Promise<readonly ArcGISPortalItem[]> {
    const items: ArcGISPortalItem[] = [];
    let start = 1;
    const num = 100; // Max results per page

    // Search query targeting council districts and wards
    const query = '("council district" OR ward) AND type:"Feature Service"';

    while (true) {
      const url = new URL(`${this.portalApiBase}/search`);
      url.searchParams.set('q', query);
      url.searchParams.set('f', 'json');
      url.searchParams.set('num', num.toString());
      url.searchParams.set('start', start.toString());
      url.searchParams.set('sortField', 'modified');
      url.searchParams.set('sortOrder', 'desc');

      const response = await retryWithBackoff(
        async () => {
          const res = await fetch(url.toString(), {
            headers: { 'User-Agent': this.config.userAgent },
            signal: AbortSignal.timeout(this.config.timeout),
          });

          if (!res.ok) {
            throw new Error(`Portal search failed: ${res.status} ${res.statusText}`);
          }

          return res.json() as Promise<ArcGISPortalSearchResponse>;
        },
        {
          maxAttempts: this.config.maxRetries,
          initialDelay: 1000,
          maxDelay: 10000,
          backoffMultiplier: this.config.backoffMultiplier,
        }
      );

      items.push(...response.results);

      console.log(`Fetched ${items.length}/${response.total} items`);

      if (items.length >= response.total || response.results.length === 0) {
        break;
      }

      start = response.nextStart;
    }

    return items;
  }

  /**
   * Download Feature Service as GeoJSON
   */
  private async downloadFeatureService(item: ArcGISPortalItem): Promise<RawDataset | null> {
    try {
      // 1. Find polygon layer
      const layerId = await this.findPolygonLayer(item.url);
      if (layerId === null) {
        console.warn(`No polygon layer found for ${item.url}`);
        return null;
      }

      // 2. Download GeoJSON
      const layerUrl = `${item.url}/${layerId}`;
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

      // 3. Stage 1 Validation (Post-Download)
      const validation = this.validator.validate(geojson, {
        source: layerUrl,
        city: item.title, // Use item title as context
      });

      // Confidence routing: Reject <60%, log warning 60-84%, accept 85-100%
      if (validation.confidence < 60) {
        console.log(`❌ REJECTED: ${item.title} (${validation.confidence}% confidence)`);
        console.log(`   Issues: ${validation.issues.join(', ')}`);
        return null;
      }

      if (validation.confidence < 85) {
        console.log(`⚠️  REVIEW NEEDED: ${item.title} (${validation.confidence}% confidence)`);
        console.log(`   Warnings: ${validation.warnings.join(', ')}`);
        // Continue but log for review
      } else {
        console.log(`✅ ACCEPTED: ${item.title} (${validation.confidence}% confidence, ${validation.metadata.featureCount} features)`);
      }

      // 4. Extract metadata
      const lastModified = parseLastModified(response.headers.get('Last-Modified'));

      // 5. Build provenance with validation metadata
      const provenance: ProvenanceMetadata = {
        source: layerUrl,
        authority: 'municipal',
        jurisdiction: 'USA',
        timestamp: Date.now(),
        sourceLastModified: lastModified,
        method: 'ArcGIS Portal API',
        responseHash: sha256(geojsonText),
        httpStatus: response.status,
        license: 'Various (municipal data)',
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
      console.error(`Failed to download ${item.url}: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Find first polygon layer in Feature Service
   */
  private async findPolygonLayer(serviceUrl: string): Promise<number | null> {
    try {
      const metadataUrl = new URL(serviceUrl);
      metadataUrl.searchParams.set('f', 'json');

      const metadata = await retryWithBackoff(
        async () => {
          const res = await fetch(metadataUrl.toString(), {
            headers: { 'User-Agent': this.config.userAgent },
            signal: AbortSignal.timeout(this.config.timeout),
          });

          if (!res.ok) {
            throw new Error(`Metadata fetch failed: ${res.status} ${res.statusText}`);
          }

          return res.json() as Promise<ArcGISFeatureServiceMetadata>;
        },
        {
          maxAttempts: this.config.maxRetries,
          initialDelay: 1000,
          maxDelay: 10000,
          backoffMultiplier: this.config.backoffMultiplier,
        }
      );

      const polygonLayer = metadata.layers.find(
        layer => layer.type === 'Feature Layer' && (layer.geometryType === 'esriGeometryPolygon' || layer.geometryType === 'Polygon')
      );

      return polygonLayer ? polygonLayer.id : null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to fetch metadata for ${serviceUrl}: ${errorMessage}`);
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
  const scraper = new ArcGISPortalScraper();
  const result = await scraper.scrapeAll();

  console.log('\n=== Final Results ===');
  console.log(`Datasets acquired: ${result.datasets.length}`);
  console.log(`Failures: ${result.failures.length}`);
  console.log(`Execution time: ${(result.executionTime / 1000).toFixed(1)}s`);

  if (result.failures.length > 0) {
    console.log('\n=== Failures ===');
    result.failures.slice(0, 10).forEach(f => {
      console.log(`  ${f.source}: ${f.error}`);
    });
    if (result.failures.length > 10) {
      console.log(`  ... and ${result.failures.length - 10} more`);
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
