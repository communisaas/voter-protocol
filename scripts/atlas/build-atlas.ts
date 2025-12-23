#!/usr/bin/env npx tsx
/**
 * Shadow Atlas Builder CLI
 *
 * Command-line interface for building complete Shadow Atlas from TIGER data.
 * This replaces the standalone build-tiger-atlas.ts script with service-based orchestration.
 *
 * Usage:
 *   npx tsx cli/build-atlas.ts --layers cd,county --year 2024
 *   npx tsx cli/build-atlas.ts --state 06 --layers cd,sldu,county
 *   npx tsx cli/build-atlas.ts --full --year 2024 --export
 *
 * TYPE SAFETY: Zero `any` types, explicit return types, readonly types where appropriate.
 */

import { parseArgs } from 'node:util';
import { ShadowAtlasService } from '../../packages/crypto/services/shadow-atlas/core/shadow-atlas-service.js';
import type { TIGERLayerType } from '../../packages/crypto/services/shadow-atlas/core/types.js';

/**
 * Parse CLI arguments
 */
interface CLIArgs {
  readonly layers?: string;
  readonly state?: string;
  readonly year?: string;
  readonly full?: boolean;
  readonly export?: boolean;
  readonly output?: string;
  readonly threshold?: string;
  readonly help?: boolean;
}

/**
 * Print usage information
 */
function printUsage(): void {
  console.log(`
Shadow Atlas Builder

Usage:
  npx tsx cli/build-atlas.ts [options]

Options:
  -l, --layers <list>       Layers to include: cd,sldu,sldl,county (comma-separated)
  -s, --state <fips>        Build for single state (FIPS code)
  -y, --year <year>         TIGER year (default: 2024)
  -f, --full                Include all layers (cd,sldu,sldl,county)
  -e, --export              Export tree to JSON file
  -o, --output <dir>        Output directory (default: ./shadow-atlas-output)
  -t, --threshold <score>   Quality threshold (0-100, default: 80)
  -h, --help                Show this help

Examples:
  # Build CD + County tree
  npx tsx cli/build-atlas.ts --layers cd,county

  # Build full US atlas and export
  npx tsx cli/build-atlas.ts --full --export

  # Build California-only atlas
  npx tsx cli/build-atlas.ts --state 06 --full --export
`);
}

/**
 * Format duration for display
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  // Parse arguments
  const { values } = parseArgs({
    options: {
      layers: { type: 'string', short: 'l', default: 'cd,county' },
      state: { type: 'string', short: 's' },
      year: { type: 'string', short: 'y', default: '2024' },
      full: { type: 'boolean', short: 'f' },
      export: { type: 'boolean', short: 'e' },
      output: { type: 'string', short: 'o', default: './shadow-atlas-output' },
      threshold: { type: 'string', short: 't', default: '80' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const args = values as CLIArgs;

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  // Parse layer list
  const layerList: TIGERLayerType[] = args.full
    ? ['cd', 'sldu', 'sldl', 'county']
    : ((args.layers?.split(',') || ['cd', 'county']) as TIGERLayerType[]);

  // Parse options
  const year = parseInt(args.year || '2024', 10);
  const qualityThreshold = parseInt(args.threshold || '80', 10);
  const stateFips = args.state;
  const shouldExport = args.export || false;
  const outputDir = args.output || './shadow-atlas-output';

  // Print header
  console.log('\n🏗️  Shadow Atlas Builder');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Year: ${year}`);
  console.log(`Layers: ${layerList.join(', ')}`);
  console.log(`Scope: ${stateFips ? `State ${stateFips}` : 'National'}`);
  console.log(`Quality Threshold: ${qualityThreshold}/100`);
  console.log('');

  // Initialize service
  const atlas = new ShadowAtlasService();
  await atlas.initialize();

  try {
    // Build atlas
    const result = await atlas.buildAtlas({
      layers: layerList,
      states: stateFips ? [stateFips] : undefined,
      year,
      qualityThreshold,
      outputPath: shouldExport
        ? `${outputDir}/shadow-atlas-${year}${stateFips ? `-${stateFips}` : ''}.json`
        : undefined,
    });

    // Print results
    console.log('\n📊 BUILD RESULTS');
    console.log('━━━━━━━━━━━━━━━━');
    console.log(`Job ID: ${result.jobId}`);
    console.log(`Merkle Root: 0x${result.merkleRoot.toString(16).slice(0, 32)}...`);
    console.log(`Total Boundaries: ${result.totalBoundaries}`);
    console.log(`Tree Depth: ${result.treeDepth}`);
    console.log(`Duration: ${formatDuration(result.duration)}`);
    console.log('');

    // Print layer breakdown
    console.log('Layer Breakdown:');
    for (const [layer, count] of Object.entries(result.layerCounts)) {
      console.log(`  ${layer}: ${count} boundaries`);
    }
    console.log('');

    // Print validation results
    console.log('Validation Results:');
    for (const validation of result.layerValidations) {
      const status = validation.qualityScore >= qualityThreshold ? '✅' : '⚠️';
      const score = `${validation.qualityScore}/100`;
      const counts = `${validation.boundaryCount}/${validation.expectedCount}`;

      console.log(`  ${status} ${validation.layer.toUpperCase()}: ${score} (${counts} boundaries)`);

      if (validation.error) {
        console.log(`     Error: ${validation.error}`);
      }
    }
    console.log('');

    // Export summary
    if (shouldExport && result.layerValidations.length > 0) {
      const filename = `shadow-atlas-${year}${stateFips ? `-${stateFips}` : ''}.json`;
      console.log(`📁 Exported to ${outputDir}/${filename}`);
      console.log('');
    }

    console.log('✅ Build complete!');

    // Close service
    atlas.close();

    // Exit with success
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Build failed:', (error as Error).message);

    // Close service
    atlas.close();

    // Exit with error
    process.exit(1);
  }
}

// Run CLI
main().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
