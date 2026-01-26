/**
 * Ingest ArcGIS Command
 *
 * Fetch data from ArcGIS REST FeatureServer/MapServer.
 *
 * Usage:
 *   shadow-atlas ingest arcgis <url> [options]
 *
 * Options:
 *   --layer <n>           Layer index (default: 0)
 *   --where <expr>        SQL WHERE clause filter
 *   --fields <list>       Fields to include (comma-separated)
 *   --output <file>       Output file path
 *   --format <fmt>        Output format: geojson|ndjson (default: geojson)
 *   --page-size <n>       Page size for pagination (default: 1000)
 *   --timeout <ms>        Timeout in milliseconds (default: 60000)
 *
 * Examples:
 *   shadow-atlas ingest arcgis "https://services.arcgis.com/.../FeatureServer/0"
 *   shadow-atlas ingest arcgis "https://..." --where "DISTRICT_ID IS NOT NULL" --output data.geojson
 *   shadow-atlas ingest arcgis "https://..." --layer 2 --fields "ID,NAME,GEOMETRY"
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { Command } from 'commander';
import { writeFile } from 'fs/promises';
import { fetchArcGIS, saveGeoJSON, saveNDJSON } from '../../lib/ingestion.js';

/**
 * ArcGIS options from CLI
 */
interface ArcGISOptions {
  readonly layer: string;
  readonly where?: string;
  readonly fields?: string;
  readonly output?: string;
  readonly format: 'geojson' | 'ndjson';
  readonly pageSize: string;
  readonly timeout: string;
  readonly verbose?: boolean;
  readonly json?: boolean;
}

/**
 * Register the arcgis command
 */
export function registerArcGISCommand(parent: Command): void {
  parent
    .command('arcgis <url>')
    .description('Fetch data from ArcGIS REST FeatureServer/MapServer')
    .option('-l, --layer <n>', 'Layer index', '0')
    .option('-w, --where <expr>', 'SQL WHERE clause filter')
    .option('-f, --fields <list>', 'Fields to include (comma-separated)')
    .option('-o, --output <file>', 'Output file path')
    .option('--format <fmt>', 'Output format: geojson|ndjson', 'geojson')
    .option('-p, --page-size <n>', 'Page size for pagination', '1000')
    .option('-t, --timeout <ms>', 'Timeout in milliseconds', '60000')
    .option('-v, --verbose', 'Verbose output')
    .option('--json', 'Output metadata as JSON')
    .action(async (url: string, options: ArcGISOptions) => {
      await executeArcGIS(url, options);
    });
}

/**
 * Execute the arcgis command
 */
async function executeArcGIS(url: string, options: ArcGISOptions): Promise<void> {
  const outputJson = options.json;

  if (!outputJson) {
    console.log('\nShadow Atlas ArcGIS Ingestion');
    console.log('='.repeat(50));
    console.log(`URL: ${url}`);
    console.log(`Layer: ${options.layer}`);
    if (options.where) console.log(`WHERE: ${options.where}`);
    if (options.fields) console.log(`Fields: ${options.fields}`);
    console.log(`Format: ${options.format}`);
    console.log('');
    console.log('Fetching data...\n');
  }

  const startTime = Date.now();

  try {
    const layer = parseInt(options.layer, 10);
    const pageSize = parseInt(options.pageSize, 10);
    const timeout = parseInt(options.timeout, 10);
    const fields = options.fields?.split(',').map((f) => f.trim());

    const data = await fetchArcGIS(url, {
      layer,
      where: options.where,
      fields,
      pageSize,
      timeout,
    });

    const durationMs = Date.now() - startTime;
    const featureCount = data.features.length;

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
          url,
          featureCount,
          durationMs,
          outputPath: options.output,
          format: options.format,
        }, null, 2));
      } else {
        console.log(`Successfully fetched ${featureCount} features`);
        console.log(`Duration: ${durationMs}ms`);
        console.log(`Output saved to: ${options.output}`);
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

    // Print metadata if verbose and output specified
    if (options.verbose && options.output && !outputJson) {
      console.log('\nFeature Summary:');
      console.log(`  Total features: ${featureCount}`);

      // Geometry types
      const geoTypes = new Map<string, number>();
      for (const feature of data.features) {
        const type = feature.geometry?.type ?? 'null';
        geoTypes.set(type, (geoTypes.get(type) ?? 0) + 1);
      }
      console.log('  Geometry types:');
      for (const [type, count] of geoTypes) {
        console.log(`    ${type}: ${count}`);
      }

      // Property keys
      if (data.features.length > 0 && data.features[0]!.properties) {
        const keys = Object.keys(data.features[0]!.properties);
        console.log(`  Properties: ${keys.slice(0, 10).join(', ')}${keys.length > 10 ? '...' : ''}`);
      }
    }
  } catch (error) {
    if (outputJson) {
      console.log(JSON.stringify({
        success: false,
        url,
        error: error instanceof Error ? error.message : String(error),
      }, null, 2));
    } else {
      console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(1);
  }
}
