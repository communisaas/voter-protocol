#!/usr/bin/env tsx
/**
 * Extract GEOID data from geoid-reference.ts to JSON
 *
 * This script parses the TypeScript file and extracts the four data structures:
 * - CANONICAL_CD_GEOIDS (Congressional Districts)
 * - CANONICAL_SLDU_GEOIDS (State Senate)
 * - CANONICAL_SLDL_GEOIDS (State House)
 * - CANONICAL_COUNTY_GEOIDS (Counties)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceFile = path.join(__dirname, '../src/validators/geoid-reference.ts.backup');
const outputFile = path.join(__dirname, '../src/data/canonical/geoid-reference.json');

interface GEOIDData {
  meta: {
    source: string;
    generated: string;
    dataVintage: string;
  };
  cd: Record<string, string[]>;
  sldu: Record<string, string[]>;
  sldl: Record<string, string[]>;
  county: Record<string, string[]>;
}

function parseGEOIDConstant(content: string, constantName: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  // Find the constant declaration
  const startPattern = `export const ${constantName}: Record<string, readonly string[]> = {`;
  const startIndex = content.indexOf(startPattern);

  if (startIndex === -1) {
    console.error(`Failed to find ${constantName}`);
    return result;
  }

  // Find the closing pattern: "} as const;"
  const endPattern = '} as const;';
  const searchStart = startIndex + startPattern.length;
  const endIndex = content.indexOf(endPattern, searchStart);

  if (endIndex === -1) {
    console.error(`Failed to find closing pattern for ${constantName}`);
    return result;
  }

  const objectContent = content.substring(startIndex + startPattern.length, endIndex);

  // Parse each state entry - handle both single-line and multi-line arrays
  // Match: '01': ['0101', '0102'] as const
  // or:    '01': [
  //          '0101', '0102'
  //        ] as const
  const stateRegex = /'(\d{2})':\s*\[([\s\S]*?)\]\s*as\s*const/g;
  let stateMatch;

  while ((stateMatch = stateRegex.exec(objectContent)) !== null) {
    const stateFips = stateMatch[1];
    const geoidList = stateMatch[2];

    // Extract GEOIDs from the list (handles numeric, alphanumeric, and special chars like Vermont's '50O-3')
    const geoidMatches = geoidList.matchAll(/'([0-9A-Z-]+)'/g);
    const geoids: string[] = [];

    for (const geoidMatch of geoidMatches) {
      geoids.push(geoidMatch[1]);
    }

    result[stateFips] = geoids;
  }

  return result;
}

function main(): void {
  console.log('Reading source file:', sourceFile);
  const content = fs.readFileSync(sourceFile, 'utf-8');

  console.log('Extracting CANONICAL_CD_GEOIDS...');
  const cd = parseGEOIDConstant(content, 'CANONICAL_CD_GEOIDS');
  console.log(`  Found ${Object.keys(cd).length} states/territories`);

  console.log('Extracting CANONICAL_SLDU_GEOIDS...');
  const sldu = parseGEOIDConstant(content, 'CANONICAL_SLDU_GEOIDS');
  console.log(`  Found ${Object.keys(sldu).length} states`);

  console.log('Extracting CANONICAL_SLDL_GEOIDS...');
  const sldl = parseGEOIDConstant(content, 'CANONICAL_SLDL_GEOIDS');
  console.log(`  Found ${Object.keys(sldl).length} states`);

  console.log('Extracting CANONICAL_COUNTY_GEOIDS...');
  const county = parseGEOIDConstant(content, 'CANONICAL_COUNTY_GEOIDS');
  console.log(`  Found ${Object.keys(county).length} states/territories`);

  const data: GEOIDData = {
    meta: {
      source: 'Census TIGER/Line 2024',
      generated: new Date().toISOString().split('T')[0],
      dataVintage: '2024 TIGER/Line (post-2020 Census redistricting)',
    },
    cd,
    sldu,
    sldl,
    county,
  };

  // Ensure output directory exists
  const outputDir = path.dirname(outputFile);
  fs.mkdirSync(outputDir, { recursive: true });

  console.log('Writing JSON to:', outputFile);
  fs.writeFileSync(outputFile, JSON.stringify(data, null, 2) + '\n', 'utf-8');

  console.log('✓ Successfully extracted GEOID data to JSON');
  console.log(`  CD: ${Object.keys(cd).length} states/territories`);
  console.log(`  SLDU: ${Object.keys(sldu).length} states`);
  console.log(`  SLDL: ${Object.keys(sldl).length} states`);
  console.log(`  County: ${Object.keys(county).length} states/territories`);
}

main();
