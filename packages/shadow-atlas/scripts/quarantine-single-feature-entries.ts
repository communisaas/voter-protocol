#!/usr/bin/env tsx
/**
 * Quarantine Single-Feature Entries Script
 *
 * Moves 21 single-feature entries from known-portals.ts to quarantined-portals.ts
 * These entries cannot represent valid council district tessellations.
 *
 * Usage: tsx scripts/quarantine-single-feature-entries.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// FIPS codes to quarantine
const SINGLE_FEATURE_FIPS = [
  '20177', '40031', '40109', '42091', '48029', '2247560', '3774440',
  '3957750', '4806128', '08005', '0454050', '08059', '0602252',
  '0608142', '0646114', '0653070', '0668378', '0633182', '0670000',
  '0613756', '06065'
];

const REGISTRY_DIR = join(__dirname, '../src/core/registry');
const KNOWN_PORTALS_PATH = join(REGISTRY_DIR, 'known-portals.ts');
const QUARANTINED_PORTALS_PATH = join(REGISTRY_DIR, 'quarantined-portals.ts');
const REPORT_PATH = join(REGISTRY_DIR, 'single-feature-quarantine-report.json');

interface QuarantinedEntry {
  fips: string;
  cityName: string;
  state: string;
  reason: string;
  removedFrom: string;
  addedTo: string;
}

function extractEntryBlock(content: string, fips: string): string | null {
  // Match entry block with proper indentation
  const pattern = new RegExp(
    `^  '${fips}':\\s*\\{[\\s\\S]*?^  \\},?$`,
    'gm'
  );
  const match = content.match(pattern);
  return match ? match[0] : null;
}

function removeEntry(content: string, fips: string): string {
  const pattern = new RegExp(
    `^  '${fips}':\\s*\\{[\\s\\S]*?^  \\},?\\n\\n`,
    'gm'
  );
  return content.replace(pattern, '');
}

function addQuarantineFields(entryBlock: string): string {
  // Remove trailing comma and closing brace
  let modified = entryBlock.replace(/,?\s*\},?\s*$/, '');

  // Add quarantine fields
  modified += `,\n    quarantineReason: 'SINGLE_FEATURE - Only 1 feature, cannot tessellate city into districts',`;
  modified += `\n    matchedPattern: 'single-feature',`;
  modified += `\n    quarantinedAt: '2026-01-16T00:00:00.000Z',`;
  modified += `\n  },\n`;

  return modified;
}

function main(): void {
  console.log('🔍 Starting single-feature quarantine operation...\n');

  // Read source files
  const knownPortalsContent = readFileSync(KNOWN_PORTALS_PATH, 'utf-8');
  const quarantinedPortalsContent = readFileSync(QUARANTINED_PORTALS_PATH, 'utf-8');

  let modifiedKnownPortals = knownPortalsContent;
  let modifiedQuarantined = quarantinedPortalsContent;
  const quarantinedEntries: QuarantinedEntry[] = [];
  const notFoundEntries: string[] = [];

  // Process each FIPS code
  for (const fips of SINGLE_FEATURE_FIPS) {
    console.log(`Processing FIPS ${fips}...`);

    // Extract entry from known-portals.ts
    const entryBlock = extractEntryBlock(knownPortalsContent, fips);

    if (!entryBlock) {
      console.log(`  ⚠️  Entry not found in known-portals.ts`);
      notFoundEntries.push(fips);
      continue;
    }

    // Extract city name and state for report
    const cityMatch = entryBlock.match(/cityName:\s*'([^']+)'/);
    const stateMatch = entryBlock.match(/state:\s*'([^']+)'/);
    const cityName = cityMatch ? cityMatch[1] : 'Unknown';
    const state = stateMatch ? stateMatch[1] : 'Unknown';

    // Add quarantine fields to entry
    const quarantinedEntry = addQuarantineFields(entryBlock);

    // Remove from known-portals.ts
    modifiedKnownPortals = removeEntry(modifiedKnownPortals, fips);

    // Add to quarantined-portals.ts (before the closing brace of QUARANTINED_PORTALS)
    const insertPosition = modifiedQuarantined.lastIndexOf('};');
    if (insertPosition !== -1) {
      // Add entry before closing brace
      const before = modifiedQuarantined.slice(0, insertPosition);
      const after = modifiedQuarantined.slice(insertPosition);
      modifiedQuarantined = before + '\n' + quarantinedEntry + '\n' + after;
    }

    quarantinedEntries.push({
      fips,
      cityName,
      state,
      reason: 'SINGLE_FEATURE - Only 1 feature, cannot tessellate',
      removedFrom: 'known-portals.ts',
      addedTo: 'quarantined-portals.ts',
    });

    console.log(`  ✅ Quarantined: ${cityName}, ${state}`);
  }

  // Update QUARANTINE_COUNT in quarantined-portals.ts
  const currentCount = 3; // Existing entries
  const newCount = currentCount + quarantinedEntries.length;
  modifiedQuarantined = modifiedQuarantined.replace(
    /export const QUARANTINE_COUNT = \d+;/,
    `export const QUARANTINE_COUNT = ${newCount};`
  );

  // Update QUARANTINE_SUMMARY
  modifiedQuarantined = modifiedQuarantined.replace(
    /export const QUARANTINE_SUMMARY = \{[^}]+\};/,
    `export const QUARANTINE_SUMMARY = {
  "sewer": 1,
  "pavement": 1,
  "parcel": 1,
  "single-feature": ${quarantinedEntries.length}
};`
  );

  // Write modified files
  console.log('\n📝 Writing modified files...');
  writeFileSync(KNOWN_PORTALS_PATH, modifiedKnownPortals, 'utf-8');
  writeFileSync(QUARANTINED_PORTALS_PATH, modifiedQuarantined, 'utf-8');

  // Generate report
  const report = {
    timestamp: new Date().toISOString(),
    operation: 'single-feature-quarantine',
    summary: {
      totalProcessed: SINGLE_FEATURE_FIPS.length,
      successfullyQuarantined: quarantinedEntries.length,
      notFound: notFoundEntries.length,
    },
    quarantinedEntries,
    notFoundEntries,
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');

  // Print summary
  console.log('\n✅ Quarantine operation complete!\n');
  console.log(`Summary:`);
  console.log(`  - Total FIPS codes processed: ${SINGLE_FEATURE_FIPS.length}`);
  console.log(`  - Successfully quarantined: ${quarantinedEntries.length}`);
  console.log(`  - Not found: ${notFoundEntries.length}`);
  console.log(`\nReport saved to: ${REPORT_PATH}`);

  if (notFoundEntries.length > 0) {
    console.log(`\n⚠️  Warning: ${notFoundEntries.length} entries not found:`);
    notFoundEntries.forEach(fips => console.log(`    - ${fips}`));
  }
}

main();
