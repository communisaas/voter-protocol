#!/usr/bin/env npx tsx
/**
 * Statewide Ward Extraction Example
 *
 * Demonstrates usage of BatchOrchestrator.extractStatewideWards() method.
 *
 * REPLACES: scripts/extract-statewide-wards.ts (now archived)
 *
 * USAGE:
 * ```bash
 * # Extract Wisconsin wards
 * npx tsx examples/extract-statewide-wards-example.ts WI
 *
 * # Extract Massachusetts wards
 * npx tsx examples/extract-statewide-wards-example.ts MA
 *
 * # Dry run (show extraction plan)
 * DRY_RUN=true npx tsx examples/extract-statewide-wards-example.ts WI
 * ```
 */

import { BatchOrchestrator } from '../services/batch-orchestrator.js';
import type { StatewideWardState } from '../services/batch-orchestrator.types.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const state = args[0] as StatewideWardState | undefined;
  const dryRun = process.env.DRY_RUN === 'true';

  if (!state || (state !== 'WI' && state !== 'MA')) {
    console.error('Usage: npx tsx examples/extract-statewide-wards-example.ts <WI|MA>');
    console.error('\nOptions:');
    console.error('  DRY_RUN=true    Show extraction plan without downloading');
    process.exit(1);
  }

  console.log('\n========================================');
  console.log('  STATEWIDE WARD EXTRACTION');
  console.log('========================================\n');

  if (dryRun) {
    console.log('[DRY RUN MODE] - No downloads will occur\n');
  }

  const orchestrator = new BatchOrchestrator();

  try {
    const result = await orchestrator.extractStatewideWards(state, {
      dryRun,
      onProgress: (progress) => {
        const current = progress.current !== undefined && progress.total !== undefined
          ? ` (${progress.current}/${progress.total})`
          : '';
        console.log(`[${progress.step.toUpperCase()}] ${progress.message}${current}`);
      },
    });

    console.log('\n========================================');
    console.log('  EXTRACTION COMPLETE');
    console.log('========================================\n');

    console.log(`State: ${result.stateName} (${result.state})`);
    console.log(`Cities extracted: ${result.citiesExtracted}`);
    console.log(`Expected cities: ${result.expectedCities}`);
    console.log(`Coverage: ${Math.round((result.citiesExtracted / result.expectedCities) * 100)}%`);
    console.log();

    if (!dryRun) {
      console.log('Output files:');
      console.log(`  Registry entries: ${result.registryEntriesPath}`);
      console.log(`  Summary: ${result.summaryPath}`);
      console.log();

      console.log('Cities with ward data:');
      for (const city of result.cities.slice(0, 10)) {
        console.log(`  - ${city.name} (${city.fips}): ${city.wardCount} wards`);
      }

      if (result.cities.length > 10) {
        console.log(`  ... and ${result.cities.length - 10} more cities`);
      }
    }

    console.log('\nNext steps:');
    console.log('1. Review generated registry entries');
    console.log('2. Validate city GeoJSON files');
    console.log('3. Manually add high-confidence entries to known-portals.ts');

  } catch (error) {
    console.error('\n❌ Extraction failed:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
