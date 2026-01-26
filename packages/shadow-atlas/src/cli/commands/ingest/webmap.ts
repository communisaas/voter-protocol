/**
 * Ingest Webmap Command
 *
 * Extract layers from ArcGIS webmaps.
 *
 * Usage:
 *   shadow-atlas ingest webmap <webmap-id> [options]
 *
 * Options:
 *   --portal <url>        Portal URL (default: https://www.arcgis.com)
 *   --layer-name <name>   Target layer name to extract
 *   --list-layers         List available layers without extracting
 *   --output <file>       Output file path
 *   --format <fmt>        Output format: geojson|ndjson (default: geojson)
 *   --timeout <ms>        Timeout in milliseconds (default: 60000)
 *
 * Examples:
 *   shadow-atlas ingest webmap abc123def456 --layer-name "Council Districts"
 *   shadow-atlas ingest webmap abc123def456 --list-layers
 *   shadow-atlas ingest webmap abc123def456 --portal https://maps.city.gov/portal
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { Command } from 'commander';
import {
  extractWebmapLayer,
  listWebmapLayers,
  saveGeoJSON,
  saveNDJSON,
} from '../../lib/ingestion.js';

/**
 * Webmap options from CLI
 */
interface WebmapOptions {
  readonly portal: string;
  readonly layerName?: string;
  readonly listLayers?: boolean;
  readonly output?: string;
  readonly format: 'geojson' | 'ndjson';
  readonly timeout: string;
  readonly verbose?: boolean;
  readonly json?: boolean;
}

/**
 * Register the webmap command
 */
export function registerWebmapCommand(parent: Command): void {
  parent
    .command('webmap <webmap-id>')
    .description('Extract layers from ArcGIS webmap')
    .option('-p, --portal <url>', 'Portal URL', 'https://www.arcgis.com')
    .option('-l, --layer-name <name>', 'Target layer name to extract')
    .option('--list-layers', 'List available layers without extracting')
    .option('-o, --output <file>', 'Output file path')
    .option('--format <fmt>', 'Output format: geojson|ndjson', 'geojson')
    .option('-t, --timeout <ms>', 'Timeout in milliseconds', '60000')
    .option('-v, --verbose', 'Verbose output')
    .option('--json', 'Output metadata as JSON')
    .action(async (webmapId: string, options: WebmapOptions) => {
      await executeWebmap(webmapId, options);
    });
}

/**
 * Execute the webmap command
 */
async function executeWebmap(webmapId: string, options: WebmapOptions): Promise<void> {
  const outputJson = options.json;
  const timeout = parseInt(options.timeout, 10);

  // List layers mode
  if (options.listLayers) {
    await listLayersMode(webmapId, options, outputJson);
    return;
  }

  if (!outputJson) {
    console.log('\nShadow Atlas Webmap Extraction');
    console.log('='.repeat(50));
    console.log(`Webmap ID: ${webmapId}`);
    console.log(`Portal: ${options.portal}`);
    if (options.layerName) console.log(`Target layer: ${options.layerName}`);
    console.log(`Format: ${options.format}`);
    console.log('');
    console.log('Extracting webmap data...\n');
  }

  const startTime = Date.now();

  try {
    const data = await extractWebmapLayer(webmapId, {
      portal: options.portal,
      layerName: options.layerName,
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
          webmapId,
          portal: options.portal,
          layerName: options.layerName ?? 'auto-detected',
          featureCount,
          durationMs,
          outputPath: options.output,
          format: options.format,
        }, null, 2));
      } else {
        console.log(`Successfully extracted ${featureCount} features`);
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
        webmapId,
        portal: options.portal,
        error: error instanceof Error ? error.message : String(error),
      }, null, 2));
    } else {
      console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(1);
  }
}

/**
 * List layers in a webmap
 */
async function listLayersMode(
  webmapId: string,
  options: WebmapOptions,
  outputJson?: boolean
): Promise<void> {
  const timeout = parseInt(options.timeout, 10);

  if (!outputJson) {
    console.log('\nShadow Atlas Webmap Layer List');
    console.log('='.repeat(50));
    console.log(`Webmap ID: ${webmapId}`);
    console.log(`Portal: ${options.portal}`);
    console.log('');
    console.log('Fetching layer list...\n');
  }

  try {
    const layers = await listWebmapLayers(webmapId, {
      portal: options.portal,
      timeout,
    });

    if (outputJson) {
      console.log(JSON.stringify({
        success: true,
        webmapId,
        portal: options.portal,
        layerCount: layers.length,
        layers,
      }, null, 2));
    } else {
      console.log(`Found ${layers.length} layers:\n`);
      console.log('Name                                          Type          Has URL');
      console.log('-'.repeat(70));

      for (const layer of layers) {
        const name =
          layer.name.length > 45
            ? layer.name.substring(0, 42) + '...'
            : layer.name.padEnd(45);
        const type = layer.type.substring(0, 12).padEnd(12);
        const hasUrl = layer.url ? 'Yes' : 'No';
        console.log(`${name}  ${type}  ${hasUrl}`);
      }

      // Show extractable layers
      const extractable = layers.filter((l) => l.url !== null);
      console.log(`\nExtractable layers (with URL): ${extractable.length}`);

      if (extractable.length > 0) {
        console.log('\nTo extract a layer:');
        console.log(
          `  shadow-atlas ingest webmap ${webmapId} --layer-name "${extractable[0]!.name}" --output data.geojson`
        );
      }
    }
  } catch (error) {
    if (outputJson) {
      console.log(JSON.stringify({
        success: false,
        webmapId,
        portal: options.portal,
        error: error instanceof Error ? error.message : String(error),
      }, null, 2));
    } else {
      console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(1);
  }
}
