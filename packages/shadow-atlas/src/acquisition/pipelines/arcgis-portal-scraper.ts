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
  AcquisitionProvenanceMetadata,
} from '../types.js';
import { retryWithBackoff, sha256, parseLastModified, BatchProcessor } from '../utils.js';
import { PostDownloadValidator } from '../post-download-validator.js';
import { logger } from '../../core/utils/logger.js';

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

    logger.info('Starting ArcGIS Portal scrape');

    // 1. Search for all relevant Feature Services
    const items = await this.searchPortal();
    logger.info('Found potential Feature Services', { count: items.length });

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

    logger.info('ArcGIS Portal scrape complete', {
      datasetsAcquired: datasets.length,
      failures: failures.length,
      executionSeconds: (executionTime / 1000).toFixed(1)
    });

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

      logger.info('Fetching Portal items', { fetched: items.length, total: response.total });

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
        logger.warn('No polygon layer found', { url: item.url });
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
        logger.info('Dataset rejected', { title: item.title, confidence: validation.confidence, issues: validation.issues });
         
        return null;
      }

      if (validation.confidence < 85) {
        logger.warn('Dataset needs review', { title: item.title, confidence: validation.confidence, warnings: validation.warnings });
         
        // Continue but log for review
      } else {
        logger.info('Dataset accepted', { title: item.title, confidence: validation.confidence, featureCount: validation.metadata.featureCount });
      }

      // 4. Extract metadata
      const lastModified = parseLastModified(response.headers.get('Last-Modified'));

      // 5. Build provenance with validation metadata
      const provenance: AcquisitionProvenanceMetadata = {
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
      logger.error('Failed to download dataset', { url: item.url, error: errorMessage });
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
      logger.error('Failed to fetch metadata', { serviceUrl, error: errorMessage });
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

  logger.info('Final Results', {
    datasetsAcquired: result.datasets.length,
    failures: result.failures.length,
    executionSeconds: (result.executionTime / 1000).toFixed(1)
  });

  if (result.failures.length > 0) {
    logger.info('Failures', {
      totalFailures: result.failures.length,
      showing: Math.min(result.failures.length, 10)
    });
    result.failures.slice(0, 10).forEach(f => {
      logger.info('Failure', { source: f.source, error: f.error });
    });
    if (result.failures.length > 10) {
      logger.info('Additional failures', {
        count: result.failures.length - 10
      });
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    logger.error('Fatal error in ArcGIS Portal scraper', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
  });
}
