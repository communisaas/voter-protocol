#!/usr/bin/env npx tsx
/**
 * Extract TypeScript registries to NDJSON format
 *
 * PURPOSE: Data/code separation - NDJSON files are the source of truth,
 * TypeScript files are generated from them.
 *
 * OUTPUT:
 * - data/registries/known-portals.ndjson
 * - data/registries/quarantined-portals.ndjson
 * - data/registries/at-large-cities.ndjson
 *
 * NDJSON FORMAT:
 * Line 1: Header with metadata {"_schema": "v1", "_type": "...", "_count": N, "_extracted": ISO8601}
 * Lines 2+: One JSON object per line (data entries)
 *
 * USAGE:
 *   npx tsx scripts/extract-registries-to-ndjson.ts
 *   npm run registry:extract
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Import existing registries
import { KNOWN_PORTALS, type KnownPortal } from '../src/core/registry/known-portals.generated.js';
import { QUARANTINED_PORTALS, type QuarantinedPortal } from '../src/core/registry/quarantined-portals.generated.js';
import { AT_LARGE_CITIES, type AtLargeCity } from '../src/core/registry/at-large-cities.generated.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const OUTPUT_DIR = join(ROOT_DIR, 'data', 'registries');

interface NdjsonHeader {
  _schema: string;
  _type: string;
  _count: number;
  _extracted: string;
  _description: string;
}

/**
 * Convert a Record<string, T> to NDJSON string
 * Each entry includes its key as `_fips` field for round-trip fidelity
 */
function toNdjson<T extends object>(
  data: Record<string, T>,
  type: string,
  description: string,
): string {
  const entries = Object.entries(data);
  const now = new Date().toISOString();

  const header: NdjsonHeader = {
    _schema: 'v1',
    _type: type,
    _count: entries.length,
    _extracted: now,
    _description: description,
  };

  const lines: string[] = [JSON.stringify(header)];

  // Sort entries by key (FIPS code) for deterministic output
  entries.sort(([a], [b]) => a.localeCompare(b));

  for (const [fips, entry] of entries) {
    // Include the FIPS key in the entry for round-trip
    const entryWithKey = { _fips: fips, ...entry };
    lines.push(JSON.stringify(entryWithKey));
  }

  return lines.join('\n') + '\n';
}

async function main(): Promise<void> {
  console.log('Extracting registries to NDJSON format...\n');

  // Create output directory
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Extract known-portals
  const knownPortalsNdjson = toNdjson(
    KNOWN_PORTALS,
    'KnownPortal',
    'Verified municipal council district GIS sources with download URLs',
  );
  const knownPortalsPath = join(OUTPUT_DIR, 'known-portals.ndjson');
  await writeFile(knownPortalsPath, knownPortalsNdjson, 'utf-8');
  console.log(`  known-portals.ndjson: ${Object.keys(KNOWN_PORTALS).length} entries`);

  // Extract quarantined-portals
  const quarantinedPortalsNdjson = toNdjson(
    QUARANTINED_PORTALS,
    'QuarantinedPortal',
    'Entries removed due to data quality issues, pending review',
  );
  const quarantinedPortalsPath = join(OUTPUT_DIR, 'quarantined-portals.ndjson');
  await writeFile(quarantinedPortalsPath, quarantinedPortalsNdjson, 'utf-8');
  console.log(`  quarantined-portals.ndjson: ${Object.keys(QUARANTINED_PORTALS).length} entries`);

  // Extract at-large-cities
  const atLargeCitiesNdjson = toNdjson(
    AT_LARGE_CITIES,
    'AtLargeCity',
    'Cities with at-large voting (no geographic districts)',
  );
  const atLargeCitiesPath = join(OUTPUT_DIR, 'at-large-cities.ndjson');
  await writeFile(atLargeCitiesPath, atLargeCitiesNdjson, 'utf-8');
  console.log(`  at-large-cities.ndjson: ${Object.keys(AT_LARGE_CITIES).length} entries`);

  console.log('\nExtraction complete!');
  console.log(`Output directory: ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error('Extraction failed:', error);
  process.exit(1);
});
