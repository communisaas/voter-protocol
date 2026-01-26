/**
 * Ingest GeoJSON Command
 *
 * Fetch GeoJSON data directly from URL.
 *
 * Usage:
 *   shadow-atlas ingest geojson <url> [options]
 *
 * Options:
 *   --output <file>       Save to output file
 *   --validate            Validate GeoJSON structure (default: true)
 *   --no-validate         Skip validation
 *   --timeout <ms>        Timeout in milliseconds (default: 60000)
 *   --format <fmt>        Output format: geojson|ndjson (default: geojson)
 *
 * Examples:
 *   shadow-atlas ingest geojson "https://example.com/districts.geojson" --output data.geojson
 *   shadow-atlas ingest geojson "https://..." --format ndjson --output data.ndjson
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { Command } from 'commander';
import {
  fetchGeoJSON,
  saveGeoJSON,
  saveNDJSON,
  validateGeoJSON,
} from '../../lib/ingestion.js';

/**
 * GeoJSON options from CLI
 */
interface GeoJSONOptions {
  readonly output?: string;
  readonly validate: boolean;
  readonly timeout: string;
  readonly format: 'geojson' | 'ndjson';
  readonly verbose?: boolean;
  readonly json?: boolean;
}

/**
 * Register the geojson command
 */
export function registerGeoJSONCommand(parent: Command): void {
  parent
    .command('geojson <url>')
    .description('Fetch GeoJSON data directly from URL')
    .option('-o, --output <file>', 'Save to output file')
    .option('--validate', 'Validate GeoJSON structure', true)
    .option('--no-validate', 'Skip validation')
    .option('-t, --timeout <ms>', 'Timeout in milliseconds', '60000')
    .option('--format <fmt>', 'Output format: geojson|ndjson', 'geojson')
    .option('-v, --verbose', 'Verbose output')
    .option('--json', 'Output metadata as JSON')
    .action(async (url: string, options: GeoJSONOptions) => {
      await executeGeoJSON(url, options);
    });
}

/**
 * Execute the geojson command
 */
async function executeGeoJSON(url: string, options: GeoJSONOptions): Promise<void> {
  const outputJson = options.json;
  const timeout = parseInt(options.timeout, 10);

  if (!outputJson) {
    console.log('\nShadow Atlas GeoJSON Ingestion');
    console.log('='.repeat(50));
    console.log(`URL: ${url}`);
    console.log(`Validate: ${options.validate}`);
    console.log(`Format: ${options.format}`);
    console.log('');
    console.log('Fetching GeoJSON...\n');
  }

  const startTime = Date.now();

  try {
    const data = await fetchGeoJSON(url, {
      timeout,
      validate: options.validate,
    });

    const durationMs = Date.now() - startTime;
    const featureCount = data.features.length;

    // Additional validation if requested
    if (options.validate) {
      try {
        validateGeoJSON(data);
      } catch (error) {
        if (outputJson) {
          console.log(JSON.stringify({
            success: false,
            url,
            error: `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
          }, null, 2));
        } else {
          console.error(
            `\nValidation error: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        process.exit(2);
      }
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
          url,
          featureCount,
          durationMs,
          outputPath: options.output,
          format: options.format,
          validated: options.validate,
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

    // Verbose output
    if (options.verbose && options.output && !outputJson) {
      console.log('\nFeature Summary:');
      console.log(`  Total features: ${featureCount}`);

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
      for (const [type, count] of geoTypes) {
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
        url,
        error: error instanceof Error ? error.message : String(error),
      }, null, 2));
    } else {
      console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(1);
  }
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
