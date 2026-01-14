#!/usr/bin/env tsx
/**
 * Extract Place GEOIDs from TypeScript to JSON
 *
 * WS-A2: Codebase Surgery - Extract place-geoids.ts data to JSON
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  EXPECTED_PLACE_BY_STATE,
  NATIONAL_PLACE_TOTAL,
  CANONICAL_PLACE_GEOIDS,
} from '../src/validators/place-geoids.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface PlaceGeoidsData {
  meta: {
    source: string;
    generated: string;
    nationalTotal: number;
    description: string;
    format: string;
    includes: string[];
    specialCases: string[];
  };
  expectedCounts: Record<string, number>;
  geoids: Record<string, readonly string[]>;
}

const data: PlaceGeoidsData = {
  meta: {
    source: 'Census TIGER/Line 2024',
    generated: '2026-01-02T19:05:09.650Z',
    nationalTotal: NATIONAL_PLACE_TOTAL,
    description: 'Canonical Place (Incorporated Cities/Towns/Villages) GEOIDs by State',
    format: 'GEOID FORMAT: SSPPPPP (State FIPS 2 digits + Place FIPS 5 digits)',
    includes: [
      'Incorporated places (cities, towns, villages, boroughs)',
      'Census Designated Places (CDPs) - unincorporated communities',
    ],
    specialCases: [
      'New England states (ME, MA, NH, RI, VT) use Minor Civil Divisions (MCDs) as primary local government, so their incorporated place counts are lower',
      'Virginia: Includes independent cities (e.g., Richmond, Norfolk)',
      'Consolidated city-counties (San Francisco, Denver) have single GEOID',
      'Some places span county lines',
    ],
  },
  expectedCounts: EXPECTED_PLACE_BY_STATE as Record<string, number>,
  geoids: CANONICAL_PLACE_GEOIDS as Record<string, readonly string[]>,
};

// Write JSON file
const outputPath = join(
  __dirname,
  '../src/data/canonical/place-geoids.json'
);

writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');

console.log(`✅ Extracted place GEOIDs to ${outputPath}`);
console.log(`   Total states: ${Object.keys(data.geoids).length}`);
console.log(`   Total places: ${data.meta.nationalTotal}`);

// Validation
const actualTotal = Object.values(data.geoids).reduce(
  (sum, arr) => sum + arr.length,
  0
);
const expectedCountsTotal = Object.values(data.expectedCounts).reduce(
  (sum, count) => sum + count,
  0
);

console.log(`\nValidation:`);
console.log(`   Expected total: ${data.meta.nationalTotal}`);
console.log(`   Actual GEOIDs: ${actualTotal}`);
console.log(`   Sum of counts: ${expectedCountsTotal}`);

if (actualTotal !== data.meta.nationalTotal) {
  console.error(`❌ MISMATCH: Actual GEOIDs (${actualTotal}) != National total (${data.meta.nationalTotal})`);
  process.exit(1);
}

if (expectedCountsTotal !== data.meta.nationalTotal) {
  console.error(`❌ MISMATCH: Sum of counts (${expectedCountsTotal}) != National total (${data.meta.nationalTotal})`);
  process.exit(1);
}

console.log(`✅ Validation passed`);
