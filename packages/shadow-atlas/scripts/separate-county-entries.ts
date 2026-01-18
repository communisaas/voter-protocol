#!/usr/bin/env npx tsx
/**
 * Separate County Entries from Known Portals
 *
 * PROBLEM: known-portals.ts contains 94 county commissioner entries mixed with city councils.
 * County FIPS (5-digit: SSCCC) don't belong with city FIPS (7-digit: SSCCPPP).
 *
 * SOLUTION: Move county entries to a dedicated county-portals.ts registry.
 * Counties need validation against county boundaries, not city boundaries.
 *
 * USAGE: npx tsx scripts/separate-county-entries.ts [--dry-run]
 */

import { KNOWN_PORTALS, type KnownPortal } from '../src/core/registry/known-portals.js';

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Detect if a FIPS code is county-level (5-digit) vs city-level (7-digit)
 * County FIPS: SSFFF (2-digit state + 3-digit county)
 * City FIPS: SSCCCCC (2-digit state + 5-digit place)
 */
function isCountyFips(fips: string): boolean {
  // County FIPS are 5 digits (with optional leading zeros)
  // City FIPS are 7 digits
  const normalized = fips.padStart(7, '0');

  // If the last 4 digits are all zeros except the last 3, it might be a county
  // Actually, let's just check the name for "County" or "Parish"
  return false; // Will check by name instead
}

function isCountyEntry(portal: KnownPortal): boolean {
  const name = portal.cityName.toLowerCase();
  return (
    name.includes(' county') ||
    name.includes(' parish') ||
    name.endsWith(' county') ||
    name.endsWith(' parish')
  );
}

async function main() {
  console.log('Analyzing known-portals registry...\n');

  const allPortals = Object.entries(KNOWN_PORTALS);
  const countyEntries: [string, KnownPortal][] = [];
  const cityEntries: [string, KnownPortal][] = [];

  for (const [fips, portal] of allPortals) {
    if (isCountyEntry(portal)) {
      countyEntries.push([fips, portal]);
    } else {
      cityEntries.push([fips, portal]);
    }
  }

  console.log(`Total entries: ${allPortals.length}`);
  console.log(`County/Parish entries: ${countyEntries.length}`);
  console.log(`City entries: ${cityEntries.length}`);
  console.log('');

  // List county entries
  console.log('=== COUNTY/PARISH ENTRIES ===');
  for (const [fips, portal] of countyEntries.slice(0, 20)) {
    console.log(`  ${fips}: ${portal.cityName}, ${portal.state} (${portal.featureCount} districts)`);
  }
  if (countyEntries.length > 20) {
    console.log(`  ... and ${countyEntries.length - 20} more`);
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would move county entries to county-portals.ts');
    console.log(`[DRY RUN] City-only pass rate would be: ${cityEntries.length} entries`);
    return;
  }

  // Generate county-portals.ts content
  const countyPortalsContent = `/**
 * County Commissioner District Portals
 *
 * SEPARATED FROM known-portals.ts on ${new Date().toISOString().split('T')[0]}
 *
 * These entries track county commissioner/supervisor districts, NOT city councils.
 * Validation should be against county boundaries (TIGER counties), not city boundaries.
 *
 * FIPS FORMAT: 5-digit county FIPS (SSCCC)
 * VALIDATION: County tessellation (different from city tessellation)
 */

import type { KnownPortal } from './known-portals.js';

export const COUNTY_PORTALS: Record<string, KnownPortal> = {
${countyEntries.map(([fips, portal]) => {
  return `  '${fips}': ${JSON.stringify(portal, null, 2).replace(/\n/g, '\n  ')},`;
}).join('\n\n')}
};

export const COUNTY_PORTAL_COUNT = ${countyEntries.length};
`;

  console.log('\n=== Generated county-portals.ts ===');
  console.log(`${countyEntries.length} county entries ready for separation`);

  // Write the file
  const fs = await import('fs/promises');
  await fs.writeFile(
    'src/core/registry/county-portals.ts',
    countyPortalsContent,
    'utf-8'
  );
  console.log('\nWrote: src/core/registry/county-portals.ts');

  // Generate list of FIPS to remove from known-portals
  console.log('\n=== FIPS codes to remove from known-portals.ts ===');
  console.log('Run this to update known-portals.ts:');
  console.log('```');
  console.log(`// Remove these ${countyEntries.length} county FIPS from known-portals.ts:`);
  for (const [fips] of countyEntries) {
    console.log(`// - ${fips}`);
  }
  console.log('```');
}

main().catch(console.error);
