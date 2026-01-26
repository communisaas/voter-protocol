/**
 * Ingest TIGER Command
 *
 * Download data from Census TIGER/Line API with optional field mapping.
 *
 * Usage:
 *   shadow-atlas ingest tiger [options]
 *
 * Options:
 *   --layer <type>        Layer: place|county|cd|sldu|sldl|vtd|unsd|elsd|scsd
 *   --state <code>        State FIPS code (2-digit, required for state layers)
 *   --vintage <year>      TIGER vintage (default: 2024)
 *   --cache-dir <path>    Cache directory (default: .shadow-atlas/tiger-cache)
 *   --force-refresh       Force download even if cached
 *   --output <file>       Copy result to output file
 *   --field-mapping <file> JSON field mapping config for non-standard schemas
 *   --schema-profile <name> Use named profile (e.g., vest-utah)
 *
 * Examples:
 *   shadow-atlas ingest tiger --layer place --state 06
 *   shadow-atlas ingest tiger --layer cd --vintage 2024
 *   shadow-atlas ingest tiger --layer sldu --state 48 --output texas-senate.geojson
 *   shadow-atlas ingest tiger --layer vtd --state 49 --schema-profile vest-utah
 *   shadow-atlas ingest tiger --layer vtd --state 49 --field-mapping ./utah-vest-mapping.json
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { Command } from 'commander';
import { copyFile, readFile, stat, writeFile } from 'fs/promises';
import { fetchTIGER, type TIGERLayer, loadGeoJSON } from '../../lib/ingestion.js';
import { FieldMapper } from '../../lib/field-mapper.js';

/**
 * TIGER options from CLI
 */
interface TIGEROptions {
  readonly layer: string;
  readonly state?: string;
  readonly vintage: string;
  readonly cacheDir: string;
  readonly forceRefresh?: boolean;
  readonly output?: string;
  readonly verbose?: boolean;
  readonly json?: boolean;
  readonly fieldMapping?: string;
  readonly schemaProfile?: string;
}

/**
 * Valid TIGER layers
 */
const VALID_LAYERS: TIGERLayer[] = [
  'place',
  'county',
  'cd',
  'sldu',
  'sldl',
  'vtd',
  'unsd',
  'elsd',
  'scsd',
];

/**
 * Layers that require state
 */
const STATE_REQUIRED_LAYERS: TIGERLayer[] = [
  'place',
  'sldu',
  'sldl',
  'vtd',
  'unsd',
  'elsd',
  'scsd',
];

/**
 * Layer descriptions
 */
const LAYER_DESCRIPTIONS: Record<TIGERLayer, string> = {
  place: 'Incorporated places and CDPs',
  county: 'County boundaries',
  cd: 'Congressional districts',
  sldu: 'State Legislative Districts - Upper chamber (Senate)',
  sldl: 'State Legislative Districts - Lower chamber (House/Assembly)',
  vtd: 'Voting Tabulation Districts (precincts)',
  unsd: 'Unified School Districts',
  elsd: 'Elementary School Districts',
  scsd: 'Secondary School Districts',
};

/**
 * Register the tiger command
 */
export function registerTIGERCommand(parent: Command): void {
  parent
    .command('tiger')
    .description('Download data from Census TIGER/Line with optional field mapping')
    .requiredOption('-l, --layer <type>', 'Layer type (place|county|cd|sldu|sldl|vtd|unsd|elsd|scsd)')
    .option('-s, --state <code>', 'State FIPS code (2-digit)')
    .option('-y, --vintage <year>', 'TIGER vintage year', '2024')
    .option('-c, --cache-dir <path>', 'Cache directory', '.shadow-atlas/tiger-cache')
    .option('-f, --force-refresh', 'Force download even if cached')
    .option('-o, --output <file>', 'Copy result to output file')
    .option('-v, --verbose', 'Verbose output')
    .option('--json', 'Output metadata as JSON')
    .option('-m, --field-mapping <file>', 'JSON field mapping config for non-standard schemas')
    .option('-p, --schema-profile <name>', 'Use named profile (e.g., vest-utah)')
    .action(async (options: TIGEROptions) => {
      await executeTIGER(options);
    });
}

/**
 * Execute the tiger command
 */
async function executeTIGER(options: TIGEROptions): Promise<void> {
  const outputJson = options.json;

  // Validate mutually exclusive options
  if (options.fieldMapping && options.schemaProfile) {
    const error = 'Cannot specify both --field-mapping and --schema-profile';
    if (outputJson) {
      console.log(JSON.stringify({ success: false, error }, null, 2));
    } else {
      console.error(`\nError: ${error}`);
    }
    process.exit(1);
  }

  // Validate layer
  const layer = options.layer as TIGERLayer;
  if (!VALID_LAYERS.includes(layer)) {
    const error = `Invalid layer: ${layer}. Valid layers: ${VALID_LAYERS.join(', ')}`;
    if (outputJson) {
      console.log(JSON.stringify({ success: false, error }, null, 2));
    } else {
      console.error(`\nError: ${error}`);
    }
    process.exit(1);
  }

  // Validate state for state-required layers
  if (STATE_REQUIRED_LAYERS.includes(layer) && !options.state) {
    const error = `Layer "${layer}" requires --state option`;
    if (outputJson) {
      console.log(JSON.stringify({ success: false, error }, null, 2));
    } else {
      console.error(`\nError: ${error}`);
    }
    process.exit(1);
  }

  // Validate state FIPS format
  if (options.state && !/^\d{2}$/.test(options.state)) {
    const error = `Invalid state FIPS: ${options.state}. Must be 2-digit code (e.g., 06 for California)`;
    if (outputJson) {
      console.log(JSON.stringify({ success: false, error }, null, 2));
    } else {
      console.error(`\nError: ${error}`);
    }
    process.exit(1);
  }

  const vintage = parseInt(options.vintage, 10);

  // Load field mapper if specified
  let fieldMapper: FieldMapper | null = null;
  if (options.fieldMapping || options.schemaProfile) {
    try {
      if (options.schemaProfile) {
        if (!outputJson) {
          console.log(`\nLoading field mapping profile: ${options.schemaProfile}\n`);
        }
        fieldMapper = await FieldMapper.fromProfile(options.schemaProfile, {
          verbose: options.verbose,
          failFast: false,
        });
      } else if (options.fieldMapping) {
        if (!outputJson) {
          console.log(`\nLoading field mapping: ${options.fieldMapping}\n`);
        }
        fieldMapper = await FieldMapper.fromFile(options.fieldMapping, {
          verbose: options.verbose,
          failFast: false,
        });
      }

      // Show mapping metadata
      if (fieldMapper && !outputJson) {
        const metadata = fieldMapper.getMetadata();
        console.log('Field Mapping Configuration:');
        console.log(`  Version: ${metadata.version}`);
        if (metadata.description) {
          console.log(`  Description: ${metadata.description}`);
        }
        if (metadata.source) {
          console.log(`  Source: ${metadata.source.name}`);
          if (metadata.source.url) {
            console.log(`  URL: ${metadata.source.url}`);
          }
        }
        console.log('');
      }
    } catch (error) {
      const errorMsg = `Failed to load field mapping: ${error instanceof Error ? error.message : String(error)}`;
      if (outputJson) {
        console.log(JSON.stringify({ success: false, error: errorMsg }, null, 2));
      } else {
        console.error(`\nError: ${errorMsg}`);
      }
      process.exit(1);
    }
  }

  if (!outputJson) {
    console.log('Shadow Atlas TIGER Ingestion');
    console.log('='.repeat(50));
    console.log(`Layer: ${layer} (${LAYER_DESCRIPTIONS[layer]})`);
    if (options.state) console.log(`State: ${options.state}`);
    console.log(`Vintage: ${vintage}`);
    console.log(`Cache: ${options.cacheDir}`);
    console.log(`Force refresh: ${options.forceRefresh ?? false}`);
    if (fieldMapper) {
      console.log(`Field mapping: ${options.schemaProfile ? `profile/${options.schemaProfile}` : options.fieldMapping}`);
    }
    console.log('');
    console.log('Fetching TIGER data...\n');
  }

  const startTime = Date.now();

  try {
    const cachePath = await fetchTIGER(layer, options.state ?? 'us', {
      vintage,
      cacheDir: options.cacheDir,
      forceRefresh: options.forceRefresh,
    });

    const fetchDurationMs = Date.now() - startTime;

    // Get file stats
    const fileStats = await stat(cachePath);
    const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);

    // Load GeoJSON for processing
    let geojson = await loadGeoJSON(cachePath);
    let featureCount = geojson.features.length;
    let mappedCount = 0;
    let mappingErrors = 0;
    let skippedCount = 0;

    // Apply field mapping if configured
    if (fieldMapper) {
      if (!outputJson) {
        console.log('Applying field mapping transformations...\n');
      }

      const mappingStartTime = Date.now();
      const mappingResult = fieldMapper.mapFeatureCollection(geojson);
      const mappingDurationMs = Date.now() - mappingStartTime;

      geojson = mappingResult.mapped;
      mappedCount = mappingResult.mapped.features.length;
      mappingErrors = mappingResult.errors.length;
      skippedCount = mappingResult.skippedCount;

      if (!outputJson) {
        console.log(`Field mapping results:`);
        console.log(`  Original features: ${featureCount}`);
        console.log(`  Mapped features: ${mappedCount}`);
        if (skippedCount > 0) {
          console.log(`  Skipped features: ${skippedCount}`);
        }
        if (mappingErrors > 0) {
          console.log(`  Features with errors: ${mappingErrors}`);
        }
        console.log(`  Duration: ${mappingDurationMs}ms\n`);

        // Show sample errors if any
        if (mappingErrors > 0 && options.verbose) {
          console.log('Sample mapping errors (first 5):');
          for (const errorEntry of mappingResult.errors.slice(0, 5)) {
            console.log(`  Feature ${errorEntry.featureIndex}:`);
            for (const error of errorEntry.errors) {
              console.log(`    - ${error.field}: ${error.message}`);
            }
          }
          console.log('');
        }
      }

      // Exit if critical errors occurred
      if (mappingErrors > 0 && !fieldMapper.getMetadata()) {
        const errorMsg = `Field mapping failed with ${mappingErrors} errors`;
        if (outputJson) {
          console.log(JSON.stringify({ success: false, error: errorMsg }, null, 2));
        } else {
          console.error(`\nError: ${errorMsg}`);
        }
        process.exit(1);
      }
    }

    const totalDurationMs = Date.now() - startTime;

    // Write output if specified (use mapped data if available)
    if (options.output) {
      await writeFile(options.output, JSON.stringify(geojson, null, 2));
    }

    if (outputJson) {
      console.log(JSON.stringify({
        success: true,
        layer,
        state: options.state ?? null,
        vintage,
        cachePath,
        outputPath: options.output ?? null,
        featureCount: fieldMapper ? mappedCount : featureCount,
        originalFeatureCount: fieldMapper ? featureCount : undefined,
        fileSizeMB: parseFloat(fileSizeMB),
        durationMs: totalDurationMs,
        fetchDurationMs,
        mappingDurationMs: fieldMapper ? totalDurationMs - fetchDurationMs : undefined,
        fromCache: fetchDurationMs < 1000, // Likely from cache if very fast
        fieldMapping: fieldMapper ? {
          applied: true,
          profile: options.schemaProfile ?? null,
          customFile: options.fieldMapping ?? null,
          mappedCount,
          skippedCount,
          errorCount: mappingErrors,
        } : undefined,
      }, null, 2));
    } else {
      const fromCache = fetchDurationMs < 1000 ? ' (from cache)' : '';
      console.log(`Successfully fetched TIGER data${fromCache}`);
      console.log(`  Fetch duration: ${fetchDurationMs}ms`);
      if (fieldMapper) {
        console.log(`  Total duration: ${totalDurationMs}ms`);
        console.log(`  Mapped features: ${mappedCount}`);
      } else {
        console.log(`  Features: ${featureCount}`);
      }
      console.log(`  File size: ${fileSizeMB} MB`);
      console.log(`  Cache path: ${cachePath}`);
      if (options.output) {
        console.log(`  Output written to: ${options.output}`);
      }
    }

    // Verbose output
    if (options.verbose && !outputJson) {
      try {
        console.log('\nData Summary:');

        // Property keys from first feature (use mapped data if available)
        if (geojson.features.length > 0 && geojson.features[0]?.properties) {
          const keys = Object.keys(geojson.features[0].properties);
          console.log(`  Properties: ${keys.slice(0, 10).join(', ')}${keys.length > 10 ? '...' : ''}`);

          // If field mapping was applied, show before/after comparison
          if (fieldMapper) {
            const originalContent = await readFile(cachePath, 'utf-8');
            const originalData = JSON.parse(originalContent);
            if (originalData.features && originalData.features.length > 0 && originalData.features[0].properties) {
              const originalKeys = Object.keys(originalData.features[0].properties);
              console.log(`  Original properties: ${originalKeys.slice(0, 10).join(', ')}${originalKeys.length > 10 ? '...' : ''}`);
            }
          }
        }

        // Sample feature names
        const names = geojson.features
          .slice(0, 5)
          .map((f) =>
            f.properties?.NAME ?? f.properties?.NAMELSAD ?? f.properties?.name ?? '(unnamed)'
          );
        if (names.length > 0) {
          console.log(`  Sample names: ${names.join(', ')}`);
        }

        // Show sample GEOID if available (common for mapped data)
        if (fieldMapper && geojson.features.length > 0 && geojson.features[0]?.properties?.GEOID) {
          const geoids = geojson.features
            .slice(0, 5)
            .map((f) => f.properties?.GEOID)
            .filter((g) => g !== undefined);
          if (geoids.length > 0) {
            console.log(`  Sample GEOIDs: ${geoids.join(', ')}`);
          }
        }
      } catch {
        // Couldn't parse for verbose output
      }
    }
  } catch (error) {
    if (outputJson) {
      console.log(JSON.stringify({
        success: false,
        layer,
        state: options.state ?? null,
        vintage,
        error: error instanceof Error ? error.message : String(error),
      }, null, 2));
    } else {
      console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(1);
  }
}
