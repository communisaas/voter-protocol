#!/usr/bin/env npx tsx
/**
 * VTD Extraction Script
 *
 * Production-grade entry point for extracting VTD GEOIDs from Redistricting Data Hub.
 * Uses the architectural RDHVTDExtractor service.
 *
 * Usage:
 *   npm run extract:vtd              # Extract all states
 *   npm run extract:vtd CA TX        # Extract specific states
 *   npm run extract:vtd -- --force   # Force re-download
 *
 * Environment:
 *   RDH_USERNAME - Redistricting Data Hub username
 *   RDH_PASSWORD - Redistricting Data Hub password
 *
 * Output:
 *   data/vtd-geoids/{state}.json - Per-state VTD GEOID files for vtd-loader.ts
 *   packages/crypto/data/rdh-cache/vtd-manifest.json - Extraction manifest
 *
 * REPLACES: scripts/extract-vtd-geoids.mjs (orphaned script)
 */

import { createRDHVTDExtractor, STATE_CODES } from '../acquisition/extractors/rdh-vtd-extractor.js';
import { config } from 'dotenv';

// Load .env file
config();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const forceRefresh = args.includes('--force') || args.includes('-f');
  const targetStates = args
    .filter(a => !a.startsWith('-'))
    .map(s => s.toUpperCase())
    .filter(s => STATE_CODES.includes(s));

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Shadow Atlas VTD Extraction (via RDHVTDExtractor)');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Check environment
  if (!process.env['RDH_USERNAME'] || !process.env['RDH_PASSWORD']) {
    console.error('Error: RDH_USERNAME and RDH_PASSWORD environment variables required');
    console.error('');
    console.error('Set them in .env file or environment:');
    console.error('  RDH_USERNAME=your_username');
    console.error('  RDH_PASSWORD=your_password');
    process.exit(1);
  }

  // Create extractor
  const extractor = createRDHVTDExtractor({ forceRefresh });
  if (!extractor) {
    process.exit(1);
  }

  const statesToProcess = targetStates.length > 0 ? targetStates : undefined;
  const count = statesToProcess?.length ?? STATE_CODES.length;

  console.log(`Processing ${count} state(s)${forceRefresh ? ' (force refresh)' : ''}...\n`);

  const results = await extractor.extractAll(statesToProcess);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  EXTRACTION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Processed: ${results.length}/${count} states`);
  console.log(`Total VTDs: ${results.reduce((sum, r) => sum + r.count, 0).toLocaleString()}`);

  if (results.length > 0) {
    console.log('\nTop 5 states by VTD count:');
    const sorted = [...results].sort((a, b) => b.count - a.count);
    for (const r of sorted.slice(0, 5)) {
      console.log(`  ${r.stateCode} (${r.stateFips}): ${r.count.toLocaleString()} VTDs`);
    }
  }

  // Report missing states
  const processedFips = new Set(results.map(r => r.stateCode));
  const processedStates = statesToProcess ?? STATE_CODES;
  const missing = processedStates.filter(s => !processedFips.has(s));
  if (missing.length > 0) {
    console.log(`\nMissing states (no data): ${missing.join(', ')}`);
  }

  console.log('\n✅ Extraction complete');
  console.log('   Output: data/vtd-geoids/');
  console.log('   Manifest: packages/crypto/data/rdh-cache/vtd-manifest.json');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
