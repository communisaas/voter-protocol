#!/usr/bin/env npx tsx
/**
 * Utah VTD Custom Extractor
 *
 * Utah VEST shapefiles use non-standard field names:
 *   - vistapre: VISTA precinct identifier (e.g., "BV01", "SL203")
 *   - CountyID: Sequential county number (1-29, not FIPS)
 *
 * This extractor maps CountyID to proper 3-digit FIPS codes and generates
 * standardized VTD identifiers in the format: {state_fips}{county_fips}{vistapre}
 *
 * Utah County FIPS mapping:
 *   CountyID 1  → 001 (Beaver)      CountyID 16 → 031 (Piute)
 *   CountyID 2  → 003 (Box Elder)   CountyID 17 → 033 (Rich)
 *   CountyID 3  → 005 (Cache)       CountyID 18 → 035 (Salt Lake)
 *   ... pattern: FIPS = (CountyID * 2) - 1
 *
 * Usage:
 *   npx tsx src/scripts/extract-utah-vtd.ts
 *   npx tsx src/scripts/extract-utah-vtd.ts --dry-run
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Utah state FIPS
const UTAH_FIPS = '49';

// Utah county names (alphabetical order matches CountyID 1-29)
const UTAH_COUNTIES = [
  'Beaver', 'Box Elder', 'Cache', 'Carbon', 'Daggett',
  'Davis', 'Duchesne', 'Emery', 'Garfield', 'Grand',
  'Iron', 'Juab', 'Kane', 'Millard', 'Morgan',
  'Piute', 'Rich', 'Salt Lake', 'San Juan', 'Sanpete',
  'Sevier', 'Summit', 'Tooele', 'Uintah', 'Utah',
  'Wasatch', 'Washington', 'Wayne', 'Weber'
];

/**
 * Map CountyID (1-29) to 3-digit FIPS code
 * Pattern: Utah counties use odd FIPS codes 001-057
 */
function countyIdToFips(countyId: number): string {
  const fips = (countyId * 2) - 1;
  return fips.toString().padStart(3, '0');
}

/**
 * Extract Utah VTD data from shapefile
 */
async function extractUtahVTDs(): Promise<Map<string, string[]>> {
  const shpPath = join(
    __dirname,
    '../../packages/crypto/data/rdh-cache/UT/ut_vest_20.shp'
  );

  console.log('Utah VTD Extractor');
  console.log('═'.repeat(60));
  console.log(`\nShapefile: ${shpPath}\n`);

  // Extract all vistapre + CountyID combinations
  const { stdout } = await execFileAsync('ogrinfo', [
    '-sql',
    'SELECT vistapre, CountyID FROM ut_vest_20 ORDER BY CountyID, vistapre',
    shpPath
  ], { maxBuffer: 50 * 1024 * 1024 });

  // Parse output
  const vtdsByCounty = new Map<number, Set<string>>();
  const lines = stdout.split('\n');

  let currentVistapre: string | null = null;
  let currentCountyId: number | null = null;

  for (const line of lines) {
    const vistapreMatch = line.match(/vistapre \(String\) = (.+)$/);
    const countyMatch = line.match(/CountyID \(Integer64\) = (\d+)$/);

    if (vistapreMatch) {
      currentVistapre = vistapreMatch[1].trim();
    }
    if (countyMatch) {
      currentCountyId = parseInt(countyMatch[1], 10);
    }

    // When we have both, add to map
    if (currentVistapre !== null && currentCountyId !== null) {
      if (!vtdsByCounty.has(currentCountyId)) {
        vtdsByCounty.set(currentCountyId, new Set());
      }
      vtdsByCounty.get(currentCountyId)!.add(currentVistapre);
      currentVistapre = null;
      currentCountyId = null;
    }
  }

  // Convert to GEOID format and organize by county
  const result = new Map<string, string[]>();
  let totalVTDs = 0;

  console.log('County Breakdown:');
  console.log('─'.repeat(50));

  for (let countyId = 1; countyId <= 29; countyId++) {
    const precincts = vtdsByCounty.get(countyId);
    if (!precincts || precincts.size === 0) continue;

    const countyFips = countyIdToFips(countyId);
    const countyName = UTAH_COUNTIES[countyId - 1];

    // Generate full GEOIDs: 49 + county_fips + vistapre
    const geoids = Array.from(precincts)
      .sort()
      .map(precinct => `${UTAH_FIPS}${countyFips}${precinct}`);

    result.set(countyFips, geoids);
    totalVTDs += geoids.length;

    console.log(
      `  ${countyId.toString().padStart(2)}) ${countyName.padEnd(12)} ` +
      `(FIPS ${countyFips}): ${geoids.length.toString().padStart(4)} precincts`
    );
  }

  console.log('─'.repeat(50));
  console.log(`TOTAL: ${totalVTDs} VTDs across ${result.size} counties\n`);

  return result;
}

/**
 * Format VTD array for TypeScript output
 */
function formatVTDArray(geoids: string[]): string {
  // Format as compact array literal
  const items = geoids.map(g => `'${g}'`).join(', ');
  return `[${items}]`;
}

/**
 * Generate TypeScript code snippet for vtd-geoids.ts
 */
function generateTypeScriptSnippet(vtdsByCounty: Map<string, string[]>): string {
  // Flatten all GEOIDs
  const allGeoids: string[] = [];
  for (const geoids of vtdsByCounty.values()) {
    allGeoids.push(...geoids);
  }
  allGeoids.sort();

  const formatted = allGeoids.map(g => `'${g}'`).join(', ');
  return `  '49': [${formatted}],`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  try {
    const vtdsByCounty = await extractUtahVTDs();

    // Flatten all GEOIDs
    const allGeoids: string[] = [];
    for (const geoids of vtdsByCounty.values()) {
      allGeoids.push(...geoids);
    }
    allGeoids.sort();

    console.log(`Generated ${allGeoids.length} Utah VTD GEOIDs\n`);

    if (dryRun) {
      console.log('DRY RUN - Sample output (first 20 GEOIDs):');
      console.log(allGeoids.slice(0, 20).join('\n'));
      console.log('...');
      return;
    }

    // Write to a standalone file for review
    const outputPath = join(__dirname, '../../data/utah-vtd-geoids.json');
    await writeFile(outputPath, JSON.stringify({
      state: 'Utah',
      stateFips: '49',
      count: allGeoids.length,
      source: 'VEST 2020 via Redistricting Data Hub',
      extractedAt: new Date().toISOString(),
      note: 'Extracted using custom extractor for non-standard vistapre/CountyID fields',
      geoids: allGeoids
    }, null, 2));
    console.log(`Wrote: ${outputPath}`);

    // Generate TypeScript snippet
    const tsSnippet = generateTypeScriptSnippet(vtdsByCounty);
    const snippetPath = join(__dirname, '../../data/utah-vtd-snippet.ts');
    await writeFile(snippetPath, `// Utah VTD GEOIDs - Add to vtd-geoids.ts CANONICAL_VTD_GEOIDS\n// Generated: ${new Date().toISOString()}\n// Count: ${allGeoids.length}\n\n${tsSnippet}\n`);
    console.log(`Wrote: ${snippetPath}`);

    console.log('\n✅ Utah VTD extraction complete');
    console.log('   Next: Merge into vtd-geoids.ts');

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nError: ${message}`);
    process.exit(1);
  }
}

main();
