#!/usr/bin/env npx tsx
/**
 * TIGER Data Validation Script
 *
 * Downloads and validates Census TIGER boundary data.
 * Reports completeness, topology, and coordinate issues.
 *
 * Usage:
 *   npx tsx scripts/validate-tiger-data.ts --layer cd --year 2024
 *   npx tsx scripts/validate-tiger-data.ts --layer sldu --state 06
 *   npx tsx scripts/validate-tiger-data.ts --all --year 2024
 */

import { parseArgs } from 'node:util';
import { TIGERBoundaryProvider, TIGER_LAYERS, type TIGERLayer } from '../providers/tiger-boundary-provider.js';
import { TIGERValidator, type NormalizedBoundary } from '../validators/tiger-validator.js';
import { getStateName } from '../validators/tiger-expected-counts.js';

// Parse CLI arguments
const { values } = parseArgs({
  options: {
    layer: { type: 'string', short: 'l' },
    state: { type: 'string', short: 's' },
    year: { type: 'string', short: 'y', default: '2024' },
    all: { type: 'boolean', short: 'a' },
    help: { type: 'boolean', short: 'h' },
  },
});

// Print usage
function printUsage(): void {
  console.log(`
TIGER Data Validation Script

Usage:
  npx tsx scripts/validate-tiger-data.ts [options]

Options:
  -l, --layer <layer>   TIGER layer: cd, sldu, sldl, county
  -s, --state <fips>    State FIPS code (e.g., 06 for California)
  -y, --year <year>     TIGER year (default: 2024)
  -a, --all             Validate all layers
  -h, --help            Show this help

Examples:
  # Validate Congressional Districts nationally
  npx tsx scripts/validate-tiger-data.ts --layer cd

  # Validate California State Senate districts
  npx tsx scripts/validate-tiger-data.ts --layer sldu --state 06

  # Validate all layers for 2024
  npx tsx scripts/validate-tiger-data.ts --all --year 2024
`);
}

// Main validation function
async function main(): Promise<void> {
  if (values.help) {
    printUsage();
    process.exit(0);
  }

  const year = parseInt(values.year || '2024', 10);
  const stateFips = values.state;

  console.log(`\n🗺️  TIGER Data Validation`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Year: ${year}`);
  console.log(`State: ${stateFips ? getStateName(stateFips) : 'National'}\n`);

  const provider = new TIGERBoundaryProvider({ year });
  const validator = new TIGERValidator();

  const layers: TIGERLayer[] = values.all
    ? ['cd', 'sldu', 'sldl', 'county']
    : values.layer
      ? [values.layer as TIGERLayer]
      : ['cd'];

  const results: Array<{ layer: string; score: number; valid: boolean }> = [];

  for (const layer of layers) {
    console.log(`\n📊 Validating ${TIGER_LAYERS[layer].name}...`);
    console.log(`─────────────────────────────────────`);

    try {
      // Download
      const rawFiles = await provider.downloadLayer({
        layer,
        stateFips,
        year,
      });

      if (rawFiles.length === 0) {
        console.log(`   ⚠️  No data downloaded`);
        continue;
      }

      // Transform
      const boundaries = await provider.transform(rawFiles);
      console.log(`   Downloaded: ${boundaries.length} boundaries`);

      // Convert to validator format
      const validatorBoundaries: NormalizedBoundary[] = boundaries.map(b => ({
        geoid: b.id,
        name: b.name,
        geometry: b.geometry,
        properties: b.properties,
      }));

      // Validate
      const result = validator.validate(layer, validatorBoundaries, stateFips);

      console.log(`\n${result.summary}`);

      results.push({
        layer,
        score: result.qualityScore,
        valid: result.completeness.valid && result.topology.valid && result.coordinates.valid,
      });

    } catch (error) {
      console.error(`   ❌ Error: ${(error as Error).message}`);
      results.push({ layer, score: 0, valid: false });
    }
  }

  // Summary
  console.log(`\n\n📋 VALIDATION SUMMARY`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━`);

  for (const r of results) {
    const status = r.valid ? '✅' : '❌';
    console.log(`${status} ${r.layer.toUpperCase()}: Score ${r.score}/100`);
  }

  const overallValid = results.every(r => r.valid);
  const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;

  console.log(`\nOverall: ${overallValid ? '✅ PASS' : '❌ FAIL'} (Avg Score: ${avgScore.toFixed(1)})`);

  process.exit(overallValid ? 0 : 1);
}

main().catch((error) => {
  console.error(`\n❌ Fatal error: ${error.message}`);
  process.exit(1);
});
