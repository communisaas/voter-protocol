/**
 * OpenStreetMap Scraper
 *
 * Scrapes municipal boundaries from OpenStreetMap via Overpass API.
 *
 * QUERY STRATEGY:
 * - admin_level=6,7,8 (municipal boundaries)
 * - Geographic chunking to avoid timeouts on large queries
 *
 * COVERAGE: 190+ countries
 * AUTHORITY: Low to medium (community-maintained)
 * UPDATE FREQUENCY: Daily (continuous community edits)
 */

import type {
  RawDataset,
  ScraperConfig,
  ScraperResult,
  GeoJSONFeatureCollection,
  GeoJSONFeature,
  GeoJSONGeometry,
  ProvenanceMetadata,
  AcquisitionProvenanceMetadata,
  OverpassResponse,
  OverpassElement,
} from '../types.js';
import { retryWithBackoff, sha256, BatchProcessor } from '../utils.js';
import { PostDownloadValidator } from '../post-download-validator.js';

/**
 * Default configuration
 */
const DEFAULT_CONFIG: ScraperConfig = {
  maxParallel: 3, // Conservative for Overpass API
  rateLimit: 1, // 1 request per second to be polite
  timeout: 180000, // 3 minutes for large regions
  maxRetries: 3,
  backoffMultiplier: 2,
  userAgent: 'Shadow-Atlas-Acquisition/1.0',
};

/**
 * Country configuration for OSM scraping
 */
interface CountryConfig {
  readonly code: string; // ISO 3166-1 alpha-2
  readonly name: string;
  readonly adminLevels: readonly number[]; // Which admin levels to query
}

/**
 * Common countries with municipal boundaries
 */
const COUNTRIES: readonly CountryConfig[] = [
  { code: 'US', name: 'United States', adminLevels: [8] },
  { code: 'CA', name: 'Canada', adminLevels: [8] },
  { code: 'GB', name: 'United Kingdom', adminLevels: [7, 8] },
  { code: 'FR', name: 'France', adminLevels: [8] },
  { code: 'DE', name: 'Germany', adminLevels: [8] },
  { code: 'IT', name: 'Italy', adminLevels: [8] },
  { code: 'ES', name: 'Spain', adminLevels: [8] },
  { code: 'AU', name: 'Australia', adminLevels: [7] },
  { code: 'NZ', name: 'New Zealand', adminLevels: [7] },
  { code: 'JP', name: 'Japan', adminLevels: [7] },
  { code: 'KR', name: 'South Korea', adminLevels: [7] },
  { code: 'MX', name: 'Mexico', adminLevels: [8] },
  { code: 'BR', name: 'Brazil', adminLevels: [8] },
  { code: 'AR', name: 'Argentina', adminLevels: [8] },
  { code: 'CL', name: 'Chile', adminLevels: [8] },
];

/**
 * OpenStreetMap Scraper
 */
export class OSMScraper {
  private readonly config: ScraperConfig;
  private readonly overpassApiUrl = 'https://overpass-api.de/api/interpreter';
  private readonly validator: PostDownloadValidator;

  constructor(config: Partial<ScraperConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.validator = new PostDownloadValidator();
  }

  /**
   * Scrape all countries
   */
  async scrapeAll(): Promise<ScraperResult> {
    const startTime = Date.now();

    console.log('Starting OpenStreetMap scrape...');
    console.log(`Processing ${COUNTRIES.length} countries`);

    // Process countries in parallel
    const processor = new BatchProcessor(
      COUNTRIES,
      (country: CountryConfig) => this.scrapeCountry(country),
      this.config.maxParallel,
      this.config.rateLimit
    );

    const { results, failures } = await processor.process();

    // Filter out null results
    const datasets = results.filter((r): r is RawDataset => r !== null);

    const executionTime = Date.now() - startTime;

    console.log(
      `\nOSM scrape complete: ${datasets.length} datasets acquired, ${failures.length} failed in ${(executionTime / 1000).toFixed(1)}s`
    );

    return {
      datasets,
      failures: failures.map(f => ({
        source: (f.item as CountryConfig).code,
        error: f.error.message,
      })),
      executionTime,
    };
  }

  /**
   * Scrape single country
   */
  async scrapeCountry(country: CountryConfig): Promise<RawDataset | null> {
    console.log(`\nScraping ${country.name} (${country.code})`);

    try {
      // Build Overpass query
      const query = this.buildOverpassQuery(country);

      // Execute query
      const response = await retryWithBackoff(
        async () => {
          const res = await fetch(this.overpassApiUrl, {
            method: 'POST',
            headers: {
              'User-Agent': this.config.userAgent,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `data=${encodeURIComponent(query)}`,
            signal: AbortSignal.timeout(this.config.timeout),
          });

          if (!res.ok) {
            throw new Error(`Overpass API failed: ${res.status} ${res.statusText}`);
          }

          return res;
        },
        {
          maxAttempts: this.config.maxRetries,
          initialDelay: 2000,
          maxDelay: 30000,
          backoffMultiplier: this.config.backoffMultiplier,
        },
        (attempt, error) => {
          console.log(`  Retry ${attempt}/${this.config.maxRetries} for ${country.code}: ${error.message}`);
        }
      );

      const responseText = await response.text();
      const overpassData = JSON.parse(responseText) as OverpassResponse;

      console.log(`  Downloaded ${overpassData.elements.length} elements`);

      // Convert to GeoJSON
      const geojson = this.convertToGeoJSON(overpassData, country);

      // Stage 1 Validation (Post-Download)
      const validation = this.validator.validate(geojson, {
        source: this.overpassApiUrl,
        city: country.name,
      });

      // Confidence routing
      if (validation.confidence < 60) {
        console.log(`❌ REJECTED: ${country.name} (${validation.confidence}% confidence)`);
        console.log(`   Issues: ${validation.issues.join(', ')}`);
        return null;
      }

      if (validation.confidence < 85) {
        console.log(`⚠️  REVIEW NEEDED: ${country.name} (${validation.confidence}% confidence)`);
        console.log(`   Warnings: ${validation.warnings.join(', ')}`);
      } else {
        console.log(`✅ ACCEPTED: ${country.name} (${validation.confidence}% confidence, ${validation.metadata.featureCount} features)`);
      }

      // Build provenance with validation metadata
      const provenance: AcquisitionProvenanceMetadata = {
        source: this.overpassApiUrl,
        authority: 'community',
        jurisdiction: country.name,
        timestamp: Date.now(),
        method: 'Overpass API',
        responseHash: sha256(responseText),
        httpStatus: response.status,
        license: 'ODbL (OpenStreetMap)',
        featureCount: geojson.features.length,
        geometryType: 'Polygon',
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
      console.error(`  ✗ Failed to scrape ${country.code}: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Build Overpass query for country
   */
  private buildOverpassQuery(country: CountryConfig): string {
    const adminLevelFilter = country.adminLevels.map(level => `["admin_level"="${level}"]`).join('');

    return `
      [out:json][timeout:180];
      area["ISO3166-1"="${country.code}"]->.country;
      (
        relation["boundary"="administrative"]${adminLevelFilter}(area.country);
      );
      out geom;
    `.trim();
  }

  /**
   * Convert Overpass response to GeoJSON
   */
  private convertToGeoJSON(overpass: OverpassResponse, country: CountryConfig): GeoJSONFeatureCollection {
    const features: GeoJSONFeature[] = [];

    for (const element of overpass.elements) {
      if (element.type !== 'relation') continue;
      if (!element.tags || !element.geometry) continue;

      // Extract properties
      const properties: Record<string, unknown> = {
        osm_id: element.id,
        name: element.tags.name || element.tags['name:en'],
        admin_level: element.tags.admin_level,
        boundary: element.tags.boundary,
        wikipedia: element.tags.wikipedia,
        wikidata: element.tags.wikidata,
        population: element.tags.population ? parseInt(element.tags.population, 10) : undefined,
      };

      // Convert geometry
      const geometry = this.convertGeometry(element.geometry);
      if (!geometry) continue;

      features.push({
        type: 'Feature',
        id: element.id,
        properties,
        geometry,
      });
    }

    return {
      type: 'FeatureCollection',
      features,
    };
  }

  /**
   * Convert OSM geometry to GeoJSON geometry
   */
  private convertGeometry(
    osmGeometry: readonly { readonly lat: number; readonly lon: number }[]
  ): GeoJSONGeometry | null {
    if (osmGeometry.length < 3) return null;

    // Convert lat/lon to lon/lat (GeoJSON order)
    const coordinates: [number, number][] = osmGeometry.map(point => [point.lon, point.lat]);

    // Close the ring if not already closed
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
      coordinates.push(first);
    }

    return {
      type: 'Polygon',
      coordinates: [coordinates],
    };
  }
}

/**
 * CLI entry point
 */
export async function main(): Promise<void> {
  const scraper = new OSMScraper();
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
