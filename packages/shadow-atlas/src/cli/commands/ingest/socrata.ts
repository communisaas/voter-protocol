/**
 * Ingest Socrata Command
 *
 * Fetch data from Socrata Open Data API endpoints.
 *
 * Usage:
 *   shadow-atlas ingest socrata <dataset-id> [options]
 *
 * Options:
 *   --domain <d>          Socrata domain (e.g., data.sfgov.org)
 *   --where <clause>      SoQL WHERE filter
 *   --limit <n>           Max rows (default: 10000)
 *   --output <file>       Output file path
 *   --format <fmt>        Output format: geojson|ndjson (default: geojson)
 *   --fips <code>         Associated FIPS code for registry
 *   --dry-run             Show what would be fetched without fetching
 *   --verbose             Verbose output
 *   --json                JSON output mode
 *
 * Examples:
 *   shadow-atlas ingest socrata "xn4j-f8kf" --domain data.sfgov.org --output districts.geojson
 *   shadow-atlas ingest socrata "abc-123" --domain opendata.example.com --where "status='ACTIVE'" --limit 5000
 *   shadow-atlas ingest socrata "dataset-id" --domain portal.gov --format ndjson --fips "06075"
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { Command } from 'commander';
import {
  saveGeoJSON,
  saveNDJSON,
  validateGeoJSON,
  type FeatureCollection,
} from '../../lib/ingestion.js';

/**
 * Socrata options from CLI
 */
interface SocrataOptions {
  readonly domain?: string;
  readonly where?: string;
  readonly limit: string;
  readonly output?: string;
  readonly format: 'geojson' | 'ndjson';
  readonly fips?: string;
  readonly dryRun?: boolean;
  readonly verbose?: boolean;
  readonly json?: boolean;
}

/**
 * Register the socrata command
 */
export function registerSocrataIngestCommand(parent: Command): void {
  parent
    .command('socrata <dataset-id>')
    .description('Fetch data from Socrata Open Data API')
    .option('-d, --domain <d>', 'Socrata domain (e.g., data.sfgov.org)')
    .option('-w, --where <clause>', 'SoQL WHERE filter')
    .option('-l, --limit <n>', 'Max rows', '10000')
    .option('-o, --output <file>', 'Output file path')
    .option('--format <fmt>', 'Output format: geojson|ndjson', 'geojson')
    .option('--fips <code>', 'Associated FIPS code for registry')
    .option('--dry-run', 'Show what would be fetched without fetching')
    .option('-v, --verbose', 'Verbose output')
    .option('--json', 'Output metadata as JSON')
    .action(async (datasetId: string, options: SocrataOptions) => {
      await executeSocrata(datasetId, options);
    });
}

/**
 * Execute the socrata command
 */
async function executeSocrata(datasetId: string, options: SocrataOptions): Promise<void> {
  const outputJson = options.json;

  // Validate required domain
  if (!options.domain) {
    if (outputJson) {
      console.log(JSON.stringify({
        success: false,
        datasetId,
        error: 'Domain is required. Use --domain <d> to specify the Socrata domain.',
      }, null, 2));
    } else {
      console.error('\nError: Domain is required. Use --domain <d> to specify the Socrata domain.');
      console.error('Example: --domain data.sfgov.org');
    }
    process.exit(1);
  }

  const limit = parseInt(options.limit, 10);

  // Build URLs
  const geospatialUrl = `https://${options.domain}/api/geospatial/${datasetId}?method=export&format=GeoJSON`;
  const resourceUrl = `https://${options.domain}/resource/${datasetId}.geojson`;

  // Build query params for resource API
  const resourceParams = new URLSearchParams();
  if (options.where) {
    resourceParams.set('$where', options.where);
  }
  resourceParams.set('$limit', String(limit));

  const resourceUrlWithParams = `${resourceUrl}?${resourceParams.toString()}`;

  // Dry run mode
  if (options.dryRun) {
    if (outputJson) {
      console.log(JSON.stringify({
        dryRun: true,
        datasetId,
        domain: options.domain,
        geospatialUrl,
        resourceUrl: resourceUrlWithParams,
        where: options.where ?? null,
        limit,
        fips: options.fips ?? null,
      }, null, 2));
    } else {
      console.log('\nShadow Atlas Socrata Ingestion (DRY RUN)');
      console.log('='.repeat(50));
      console.log(`Dataset ID: ${datasetId}`);
      console.log(`Domain: ${options.domain}`);
      console.log(`Limit: ${limit}`);
      if (options.where) console.log(`WHERE: ${options.where}`);
      if (options.fips) console.log(`FIPS: ${options.fips}`);
      console.log('');
      console.log('Would attempt URLs:');
      console.log(`  1. ${geospatialUrl}`);
      console.log(`  2. ${resourceUrlWithParams}`);
    }
    return;
  }

  // Normal execution
  if (!outputJson) {
    console.log('\nShadow Atlas Socrata Ingestion');
    console.log('='.repeat(50));
    console.log(`Dataset ID: ${datasetId}`);
    console.log(`Domain: ${options.domain}`);
    console.log(`Limit: ${limit}`);
    if (options.where) console.log(`WHERE: ${options.where}`);
    if (options.fips) console.log(`FIPS: ${options.fips}`);
    console.log(`Format: ${options.format}`);
    console.log('');
    console.log('Fetching data...\n');
  }

  const startTime = Date.now();

  try {
    // Try geospatial API first, fall back to resource API
    let data: FeatureCollection;
    let apiUsed: 'geospatial' | 'resource';

    try {
      data = await fetchSocrataGeospatial(geospatialUrl, Boolean(options.verbose && !outputJson));
      apiUsed = 'geospatial';
    } catch (geospatialError) {
      if (options.verbose && !outputJson) {
        console.log(`Geospatial API failed: ${geospatialError instanceof Error ? geospatialError.message : String(geospatialError)}`);
        console.log('Trying Resource API...\n');
      }

      data = await fetchSocrataResource(resourceUrlWithParams, Boolean(options.verbose && !outputJson));
      apiUsed = 'resource';
    }

    const durationMs = Date.now() - startTime;
    const featureCount = data.features.length;

    // Validate GeoJSON
    try {
      validateGeoJSON(data);
    } catch (error) {
      if (outputJson) {
        console.log(JSON.stringify({
          success: false,
          datasetId,
          domain: options.domain,
          apiUsed,
          error: `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
        }, null, 2));
      } else {
        console.error(
          `\nValidation error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      process.exit(2);
    }

    // Output results
    if (options.output) {
      if (options.format === 'ndjson') {
        await saveNDJSON(data, options.output);
      } else {
        await saveGeoJSON(data, options.output);
      }

      if (outputJson) {
        console.log(JSON.stringify({
          success: true,
          datasetId,
          domain: options.domain,
          apiUsed,
          featureCount,
          durationMs,
          outputPath: options.output,
          format: options.format,
          fips: options.fips ?? null,
          where: options.where ?? null,
          limit,
        }, null, 2));
      } else {
        console.log(`Successfully fetched ${featureCount} features using ${apiUsed} API`);
        console.log(`Duration: ${durationMs}ms`);
        console.log(`Output saved to: ${options.output}`);
        if (options.fips) {
          console.log(`FIPS: ${options.fips}`);
        }
      }
    } else {
      // Output to stdout
      if (options.format === 'ndjson') {
        for (const feature of data.features) {
          console.log(JSON.stringify(feature));
        }
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
    }

    // Verbose output
    if (options.verbose && options.output && !outputJson) {
      console.log('\nFeature Summary:');
      console.log(`  Total features: ${featureCount}`);
      console.log(`  API used: ${apiUsed}`);

      // Geometry types
      const geoTypes = new Map<string, number>();
      let hasNullGeometry = 0;
      for (const feature of data.features) {
        if (feature.geometry === null) {
          hasNullGeometry++;
        } else {
          const type = feature.geometry?.type ?? 'null';
          geoTypes.set(type, (geoTypes.get(type) ?? 0) + 1);
        }
      }
      console.log('  Geometry types:');
      for (const [type, count] of Array.from(geoTypes.entries())) {
        console.log(`    ${type}: ${count}`);
      }
      if (hasNullGeometry > 0) {
        console.log(`    null: ${hasNullGeometry}`);
      }

      // Property keys
      if (data.features.length > 0 && data.features[0]!.properties) {
        const keys = Object.keys(data.features[0]!.properties);
        console.log(`  Properties: ${keys.slice(0, 10).join(', ')}${keys.length > 10 ? '...' : ''}`);
      }

      // Bounding box
      const bounds = calculateBounds(data);
      if (bounds) {
        console.log(
          `  Bounds: [${bounds.minLon.toFixed(4)}, ${bounds.minLat.toFixed(4)}] to [${bounds.maxLon.toFixed(4)}, ${bounds.maxLat.toFixed(4)}]`
        );
      }
    }
  } catch (error) {
    if (outputJson) {
      console.log(JSON.stringify({
        success: false,
        datasetId,
        domain: options.domain,
        error: error instanceof Error ? error.message : String(error),
      }, null, 2));
    } else {
      console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(1);
  }
}

/**
 * Fetch from Socrata Geospatial API
 *
 * Uses the /api/geospatial endpoint which exports full dataset as GeoJSON.
 */
async function fetchSocrataGeospatial(url: string, verbose: boolean): Promise<FeatureCollection> {
  if (verbose) {
    console.log(`Trying Geospatial API: ${url}`);
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json, application/geo+json',
      'User-Agent': 'VOTER-Protocol/1.0 (Shadow Atlas Socrata Ingestion)',
    },
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data: unknown = await response.json();

  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid response: not a JSON object');
  }

  const obj = data as Record<string, unknown>;

  if (obj.type !== 'FeatureCollection') {
    throw new Error(`Expected FeatureCollection, got ${obj.type}`);
  }

  if (!Array.isArray(obj.features)) {
    throw new Error('FeatureCollection must have features array');
  }

  return data as FeatureCollection;
}

/**
 * Fetch from Socrata Resource API
 *
 * Uses the /resource endpoint with SoQL query parameters.
 */
async function fetchSocrataResource(url: string, verbose: boolean): Promise<FeatureCollection> {
  if (verbose) {
    console.log(`Trying Resource API: ${url}`);
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json, application/geo+json',
      'User-Agent': 'VOTER-Protocol/1.0 (Shadow Atlas Socrata Ingestion)',
    },
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data: unknown = await response.json();

  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid response: not a JSON object');
  }

  const obj = data as Record<string, unknown>;

  if (obj.type !== 'FeatureCollection') {
    throw new Error(`Expected FeatureCollection, got ${obj.type}`);
  }

  if (!Array.isArray(obj.features)) {
    throw new Error('FeatureCollection must have features array');
  }

  return data as FeatureCollection;
}

/**
 * Calculate bounding box from GeoJSON
 */
function calculateBounds(
  data: { features: readonly { geometry?: { type: string; coordinates: unknown } | null }[] }
): { minLon: number; minLat: number; maxLon: number; maxLat: number } | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  const processCoord = (coord: readonly number[]): void => {
    const [lon, lat] = coord;
    if (lon !== undefined && lat !== undefined) {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  };

  const processCoords = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;

    if (
      coords.length >= 2 &&
      typeof coords[0] === 'number' &&
      typeof coords[1] === 'number'
    ) {
      processCoord(coords as number[]);
      return;
    }

    for (const item of coords) {
      processCoords(item);
    }
  };

  for (const feature of data.features) {
    if (feature.geometry?.coordinates) {
      processCoords(feature.geometry.coordinates);
    }
  }

  if (minLon === Infinity) return null;

  return { minLon, minLat, maxLon, maxLat };
}
