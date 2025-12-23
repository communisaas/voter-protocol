#!/usr/bin/env npx tsx
/**
 * TIGER Data Validation CLI
 *
 * Thin CLI wrapper around ShadowAtlasService.validateTIGER()
 * Replaces the standalone validate-tiger-data.ts script with a unified service-based approach.
 *
 * Usage:
 *   npx tsx cli/validate-tiger.ts --layer cd --year 2024
 *   npx tsx cli/validate-tiger.ts --layer sldu --state 06
 *   npx tsx cli/validate-tiger.ts --all --threshold 95
 *
 * Exit codes:
 *   0 - Validation passed (all layers meet quality threshold)
 *   1 - Validation failed (one or more layers below threshold)
 *   2 - CLI argument error
 *   3 - Runtime error during validation
 */

import { parseArgs } from 'node:util';
import { ShadowAtlasService } from '../../packages/crypto/services/shadow-atlas/core/shadow-atlas-service.js';
import { DEFAULT_CONFIG } from '../../packages/crypto/services/shadow-atlas/core/config.js';
import type { TIGERLayerType, TIGERValidationResult } from '../../packages/crypto/services/shadow-atlas/core/types.js';

/**
 * Print usage information
 */
function printUsage(): void {
  console.log(`
TIGER Data Validation CLI

Usage:
  npx tsx cli/validate-tiger.ts [options]

Options:
  -l, --layer <layer>       TIGER layer: cd, sldu, sldl, county (can specify multiple)
  -s, --state <fips>        State FIPS code (e.g., 06 for California)
  -y, --year <year>         TIGER year (default: current year)
  -a, --all                 Validate all layers
  -t, --threshold <score>   Minimum quality score threshold 0-100 (default: 90)
  -h, --help                Show this help

Examples:
  # Validate Congressional Districts nationally
  npx tsx cli/validate-tiger.ts --layer cd

  # Validate California State Senate districts
  npx tsx cli/validate-tiger.ts --layer sldu --state 06

  # Validate all layers for 2024 with 95% threshold
  npx tsx cli/validate-tiger.ts --all --year 2024 --threshold 95

Exit Codes:
  0 - Validation passed
  1 - Validation failed (below quality threshold)
  2 - CLI argument error
  3 - Runtime error
`);
}

/**
 * Format validation result for console output
 */
function formatResult(result: TIGERValidationResult): void {
  console.log(`\n🗺️  TIGER Data Validation`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Year: ${result.year}`);
  console.log(`State: ${result.stateName}`);
  console.log(`Duration: ${(result.duration / 1000).toFixed(2)}s\n`);

  // Layer results
  for (const layer of result.layers) {
    const status = layer.valid ? '✅' : '❌';
    console.log(`${status} ${layer.layer.toUpperCase()}: Score ${layer.qualityScore}/100`);
    console.log(`   ${layer.completeness.summary}`);
    console.log(`   ${layer.topology.summary}`);
    console.log(`   ${layer.coordinates.summary}\n`);
  }

  // Summary
  console.log(`\n📋 VALIDATION SUMMARY`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━`);
  console.log(result.summary);
  console.log(`\nThreshold: ${result.qualityThreshold}/100`);
  console.log(`Average Score: ${result.averageQualityScore}/100`);
  console.log(`Overall: ${result.overallValid ? '✅ PASS' : '❌ FAIL'}\n`);
}

/**
 * Main CLI entrypoint
 */
async function main(): Promise<void> {
  // Parse CLI arguments
  const { values } = parseArgs({
    options: {
      layer: { type: 'string', short: 'l', multiple: true },
      state: { type: 'string', short: 's' },
      year: { type: 'string', short: 'y' },
      all: { type: 'boolean', short: 'a' },
      threshold: { type: 'string', short: 't' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  // Print usage
  if (values.help) {
    printUsage();
    process.exit(0);
  }

  // Parse options
  const year = values.year ? parseInt(values.year, 10) : undefined;
  const threshold = values.threshold ? parseInt(values.threshold, 10) : undefined;

  // Validate threshold
  if (threshold !== undefined && (threshold < 0 || threshold > 100)) {
    console.error('❌ Error: Threshold must be between 0 and 100');
    process.exit(2);
  }

  // Determine layers
  let layers: TIGERLayerType[] | undefined;
  if (values.all) {
    layers = ['cd', 'sldu', 'sldl', 'county'];
  } else if (values.layer && values.layer.length > 0) {
    // Validate layer types
    const validLayers: TIGERLayerType[] = ['cd', 'sldu', 'sldl', 'county'];
    for (const layer of values.layer) {
      if (!validLayers.includes(layer as TIGERLayerType)) {
        console.error(`❌ Error: Invalid layer '${layer}'. Must be one of: cd, sldu, sldl, county`);
        process.exit(2);
      }
    }
    layers = values.layer as TIGERLayerType[];
  } else {
    // Default to congressional districts
    layers = ['cd'];
  }

  // Create service instance (in-memory mode for CLI)
  const service = new ShadowAtlasService({
    ...DEFAULT_CONFIG,
    storageDir: ':memory:', // CLI uses in-memory storage
    persistence: {
      enabled: false,
      databasePath: ':memory:',
      autoMigrate: false,
    },
  });

  try {
    // Run validation
    const result = await service.validateTIGER({
      state: values.state,
      layers,
      year,
      qualityThreshold: threshold,
    });

    // Format and print results
    formatResult(result);

    // Close service
    service.close();

    // Exit with appropriate code
    process.exit(result.overallValid ? 0 : 1);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ Fatal error: ${errorMessage}`);

    // Close service
    service.close();

    process.exit(3);
  }
}

main().catch((error) => {
  console.error(`\n❌ Unhandled error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(3);
});
