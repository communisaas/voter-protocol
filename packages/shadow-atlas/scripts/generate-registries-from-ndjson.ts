#!/usr/bin/env npx tsx
/**
 * Generate TypeScript registries from NDJSON source files
 *
 * PURPOSE: Data/code separation - NDJSON files are the source of truth,
 * this script generates TypeScript files from them.
 *
 * INPUT:
 * - data/registries/known-portals.ndjson
 * - data/registries/quarantined-portals.ndjson
 * - data/registries/at-large-cities.ndjson
 *
 * OUTPUT:
 * - src/core/registry/known-portals.generated.ts
 * - src/core/registry/quarantined-portals.generated.ts
 * - src/core/registry/at-large-cities.generated.ts
 *
 * USAGE:
 *   npx tsx scripts/generate-registries-from-ndjson.ts
 *   npm run registry:generate
 *
 * NOTE: Generated files include a header warning against manual edits.
 * All changes should be made to the NDJSON source files.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const INPUT_DIR = join(ROOT_DIR, 'data', 'registries');
const OUTPUT_DIR = join(ROOT_DIR, 'src', 'core', 'registry');

interface NdjsonHeader {
  _schema: string;
  _type: string;
  _count: number;
  _extracted: string;
  _description: string;
}

/**
 * Parse NDJSON file into header and entries
 */
async function parseNdjson<T extends { _fips: string }>(
  filename: string,
): Promise<{ header: NdjsonHeader; entries: Map<string, Omit<T, '_fips'>> }> {
  const filepath = join(INPUT_DIR, filename);
  const content = await readFile(filepath, 'utf-8');
  const lines = content.trim().split('\n');

  if (lines.length === 0) {
    throw new Error(`Empty NDJSON file: ${filename}`);
  }

  const header = JSON.parse(lines[0]) as NdjsonHeader;
  const entries = new Map<string, Omit<T, '_fips'>>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const entry = JSON.parse(line) as T;
    const { _fips, ...rest } = entry;
    entries.set(_fips, rest);
  }

  return { header, entries };
}

/**
 * Generate the known-portals.generated.ts file
 */
async function generateKnownPortals(): Promise<number> {
  const { header, entries } = await parseNdjson<{
    _fips: string;
    cityFips: string;
    cityName: string;
    state: string;
    portalType: string;
    downloadUrl: string;
    featureCount: number;
    lastVerified: string;
    confidence: number;
    discoveredBy: string;
    notes?: string;
    webmapLayerName?: string;
    authoritativeSource?: string;
  }>('known-portals.ndjson');

  const now = new Date().toISOString();

  let output = `/**
 * Known Council District Data Portals
 *
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * !! THIS FILE IS AUTO-GENERATED - DO NOT EDIT MANUALLY !!
 * !! Source: data/registries/known-portals.ndjson
 * !! Generated: ${now}
 * !! To modify: Edit the NDJSON file, then run: npm run registry:generate
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 *
 * City entries: ${entries.size}
 * Description: ${header._description}
 */

export type PortalType =
  | 'arcgis'           // Generic ArcGIS REST services
  | 'municipal-gis'    // City-operated GIS portal
  | 'regional-gis'     // Regional council operated GIS
  | 'county-gis'       // County-operated GIS portal
  | 'state-gis'        // State-operated GIS portal
  | 'socrata'          // Socrata open data platform
  | 'geojson'          // Direct GeoJSON file
  | 'webmap-embedded'  // Extracted from ArcGIS webmap
  | 'curated-data'     // Manually digitized/curated
  | 'shapefile'        // Shapefile download
  | 'kml';             // KML/KMZ file

/**
 * Discovery source for portal entries.
 * Common values: 'manual', 'automated', 'authoritative'
 * Wave-specific values: 'wave-g-extraction', 'wave-h-ca-specialist', etc.
 */
export type DiscoveredBy = string;

export interface KnownPortal {
  readonly cityFips: string;
  readonly cityName: string;
  readonly state: string;
  readonly portalType: PortalType;
  readonly downloadUrl: string;
  readonly featureCount: number;
  readonly lastVerified: string;
  readonly confidence: number;
  readonly discoveredBy: DiscoveredBy;
  readonly notes?: string;
  readonly webmapLayerName?: string;
  readonly authoritativeSource?: string;
}

export const KNOWN_PORTALS: Record<string, KnownPortal> = {\n`;

  // Sort entries by FIPS for deterministic output
  const sortedEntries = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b));

  for (const [fips, entry] of sortedEntries) {
    output += `  '${fips}': ${JSON.stringify(entry, null, 4).replace(/\n/g, '\n  ')},\n`;
  }

  output += `};\n\nexport const PORTAL_COUNT = ${entries.size};\n`;

  await writeFile(join(OUTPUT_DIR, 'known-portals.generated.ts'), output, 'utf-8');
  return entries.size;
}

/**
 * Generate the quarantined-portals.generated.ts file
 */
async function generateQuarantinedPortals(): Promise<number> {
  const { header, entries } = await parseNdjson<{
    _fips: string;
    cityFips: string;
    cityName: string;
    state: string;
    portalType: string;
    downloadUrl: string;
    featureCount: number;
    lastVerified: string;
    confidence: number;
    discoveredBy: string;
    notes?: string;
    quarantineReason: string;
    matchedPattern: string;
    quarantinedAt: string;
  }>('quarantined-portals.ndjson');

  const now = new Date().toISOString();

  let output = `/**
 * Quarantined Portal Entries
 *
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * !! THIS FILE IS AUTO-GENERATED - DO NOT EDIT MANUALLY !!
 * !! Source: data/registries/quarantined-portals.ndjson
 * !! Generated: ${now}
 * !! To modify: Edit the NDJSON file, then run: npm run registry:generate
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 *
 * PURPOSE: Entries removed from known-portals due to data quality issues
 * Quarantined entries: ${entries.size}
 * Description: ${header._description}
 */

import type { PortalType, DiscoveredBy } from './known-portals.generated.js';

export interface QuarantinedPortal {
  readonly cityFips: string;
  readonly cityName: string;
  readonly state: string;
  readonly portalType: PortalType;
  readonly downloadUrl: string;
  readonly featureCount: number;
  readonly lastVerified: string;
  readonly confidence: number;
  readonly discoveredBy: DiscoveredBy;
  readonly notes?: string;
  readonly quarantineReason: string;
  readonly matchedPattern: string;
  readonly quarantinedAt: string;
}

export const QUARANTINED_PORTALS: Record<string, QuarantinedPortal> = {\n`;

  const sortedEntries = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b));

  for (const [fips, entry] of sortedEntries) {
    output += `  '${fips}': ${JSON.stringify(entry, null, 4).replace(/\n/g, '\n  ')},\n`;
  }

  output += `};\n\nexport const QUARANTINE_COUNT = ${entries.size};\n`;

  await writeFile(join(OUTPUT_DIR, 'quarantined-portals.generated.ts'), output, 'utf-8');
  return entries.size;
}

/**
 * Generate the at-large-cities.generated.ts file
 */
async function generateAtLargeCities(): Promise<number> {
  const { header, entries } = await parseNdjson<{
    _fips: string;
    cityName: string;
    state: string;
    councilSize: number;
    electionMethod: 'at-large' | 'proportional';
    source: string;
    notes?: string;
  }>('at-large-cities.ndjson');

  const now = new Date().toISOString();

  let output = `/**
 * At-Large City Council Registry
 *
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * !! THIS FILE IS AUTO-GENERATED - DO NOT EDIT MANUALLY !!
 * !! Source: data/registries/at-large-cities.ndjson
 * !! Generated: ${now}
 * !! To modify: Edit the NDJSON file, then run: npm run registry:generate
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 *
 * PURPOSE: Cities with at-large voting (no geographic districts)
 * At-large cities: ${entries.size}
 * Description: ${header._description}
 */

export interface AtLargeCity {
  readonly cityName: string;
  readonly state: string;
  readonly councilSize: number;
  readonly electionMethod: 'at-large' | 'proportional';
  readonly source: string;
  readonly notes?: string;
}

export const AT_LARGE_CITIES: Record<string, AtLargeCity> = {\n`;

  const sortedEntries = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b));

  for (const [fips, entry] of sortedEntries) {
    output += `  '${fips}': ${JSON.stringify(entry, null, 4).replace(/\n/g, '\n  ')},\n`;
  }

  output += `};\n\nexport const AT_LARGE_COUNT = ${entries.size};\n`;

  await writeFile(join(OUTPUT_DIR, 'at-large-cities.generated.ts'), output, 'utf-8');
  return entries.size;
}

async function main(): Promise<void> {
  console.log('Generating TypeScript registries from NDJSON...\n');

  const knownCount = await generateKnownPortals();
  console.log(`  known-portals.generated.ts: ${knownCount} entries`);

  const quarantinedCount = await generateQuarantinedPortals();
  console.log(`  quarantined-portals.generated.ts: ${quarantinedCount} entries`);

  const atLargeCount = await generateAtLargeCities();
  console.log(`  at-large-cities.generated.ts: ${atLargeCount} entries`);

  console.log('\nGeneration complete!');
  console.log(`Output directory: ${OUTPUT_DIR}`);
  console.log('\nNote: Generated files have .generated.ts suffix.');
  console.log('Update imports in consuming code to use the generated files.');
}

main().catch((error) => {
  console.error('Generation failed:', error);
  process.exit(1);
});
