#!/usr/bin/env npx tsx
/**
 * TIGER GEOID Validation Script
 *
 * Validates programmatically generated SLDU/SLDL GEOIDs against actual
 * TIGER 2024 shapefile data from local cache.
 *
 * PURPOSE:
 * - Detect non-sequential district numbering (Vermont, New Hampshire, etc.)
 * - Identify missing or extra GEOIDs in programmatic generation
 * - Generate corrected GEOID arrays for geoid-reference.ts
 *
 * USAGE:
 *   npx tsx scripts/validate-tiger-geoids.ts
 *
 * REQUIREMENTS:
 * - TIGER cache at packages/crypto/data/tiger-cache/2024/{SLDU,SLDL}/
 * - GeoJSON files extracted from shapefiles (*.geojson)
 *
 * OUTPUT:
 * - Console report of discrepancies
 * - Suggested corrections for geoid-reference.ts
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  CANONICAL_SLDU_GEOIDS,
  CANONICAL_SLDL_GEOIDS,
  validateGEOIDCompleteness,
} from '../validators/geoid/reference.js';
import {
  EXPECTED_SLDU_BY_STATE,
  EXPECTED_SLDL_BY_STATE,
  getStateAbbr,
} from '../validators/tiger-expected-counts.js';

interface GeoJSONFeature {
  type: 'Feature';
  properties: {
    GEOID: string;
    NAMELSAD?: string;
    STATEFP: string;
    [key: string]: unknown;
  };
  geometry: unknown;
}

interface GeoJSON {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

interface ValidationResult {
  stateFips: string;
  stateAbbr: string | null;
  layer: 'SLDU' | 'SLDL';
  expected: number;
  actual: number;
  missing: readonly string[];
  extra: readonly string[];
  valid: boolean;
}

/**
 * Extract GEOIDs from cached GeoJSON file
 */
function extractGEOIDsFromGeoJSON(filePath: string): readonly string[] {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const geojson = JSON.parse(content) as GeoJSON;

    if (!geojson.features || !Array.isArray(geojson.features)) {
      console.warn(`⚠️  Invalid GeoJSON structure in ${filePath}`);
      return [];
    }

    const geoids = geojson.features
      .map((f) => f.properties?.GEOID)
      .filter((g): g is string => typeof g === 'string' && g.length > 0)
      .sort();

    // Remove duplicates
    return Array.from(new Set(geoids));
  } catch (error) {
    console.error(`❌ Error reading ${filePath}: ${(error as Error).message}`);
    return [];
  }
}

/**
 * Find cached GeoJSON files for a layer
 */
function findCachedFiles(layer: 'SLDU' | 'SLDL'): Map<string, string> {
  const cacheDir = join(
    process.cwd(),
    'packages/crypto/data/tiger-cache/2024',
    layer
  );

  if (!existsSync(cacheDir)) {
    console.warn(`⚠️  Cache directory not found: ${cacheDir}`);
    return new Map();
  }

  const files = readdirSync(cacheDir);
  const geojsonFiles = files.filter((f) => f.endsWith('.geojson'));

  const fileMap = new Map<string, string>();

  for (const file of geojsonFiles) {
    // Extract state FIPS from filename (e.g., "06.geojson" -> "06")
    const match = file.match(/^(\d{2})\.geojson$/);
    if (match) {
      const stateFips = match[1];
      fileMap.set(stateFips, join(cacheDir, file));
    }
  }

  return fileMap;
}

/**
 * Validate SLDU GEOIDs against cached data
 */
function validateSLDU(): ValidationResult[] {
  console.log('\n🔍 Validating SLDU (State Senate) GEOIDs...\n');

  const cachedFiles = findCachedFiles('SLDU');
  console.log(`   Found ${cachedFiles.size} cached SLDU files\n`);

  const results: ValidationResult[] = [];

  for (const [stateFips, canonicalGEOIDs] of Object.entries(
    CANONICAL_SLDU_GEOIDS
  )) {
    const stateAbbr = getStateAbbr(stateFips);
    const expectedCount = EXPECTED_SLDU_BY_STATE[stateFips] ?? 0;

    // Skip states with 0 expected (DC, Nebraska unicameral handled separately)
    if (expectedCount === 0) {
      continue;
    }

    const cachedFile = cachedFiles.get(stateFips);

    if (!cachedFile) {
      // No cached data - can't validate
      console.log(
        `   ⏭️  ${stateAbbr?.padEnd(2)} (${stateFips}): No cached data (expected ${expectedCount})`
      );
      continue;
    }

    // Extract actual GEOIDs from cached file
    const actualGEOIDs = extractGEOIDsFromGeoJSON(cachedFile);

    // Validate completeness
    const validation = validateGEOIDCompleteness('sldu', stateFips, actualGEOIDs);

    results.push({
      stateFips,
      stateAbbr,
      layer: 'SLDU',
      expected: expectedCount,
      actual: actualGEOIDs.length,
      missing: validation.missing,
      extra: validation.extra,
      valid: validation.valid,
    });

    if (validation.valid) {
      console.log(
        `   ✅ ${stateAbbr?.padEnd(2)} (${stateFips}): ${actualGEOIDs.length} GEOIDs match (${expectedCount} expected)`
      );
    } else {
      console.log(
        `   ❌ ${stateAbbr?.padEnd(2)} (${stateFips}): Mismatch detected`
      );
      console.log(`      Expected: ${expectedCount}, Actual: ${actualGEOIDs.length}`);

      if (validation.missing.length > 0) {
        console.log(
          `      Missing: ${validation.missing.slice(0, 5).join(', ')}${validation.missing.length > 5 ? '...' : ''}`
        );
      }

      if (validation.extra.length > 0) {
        console.log(
          `      Extra: ${validation.extra.slice(0, 5).join(', ')}${validation.extra.length > 5 ? '...' : ''}`
        );
      }

      // Show actual GEOIDs for correction
      if (actualGEOIDs.length !== expectedCount) {
        console.log(`      Actual GEOIDs: [${actualGEOIDs.slice(0, 10).join(', ')}${actualGEOIDs.length > 10 ? ', ...' : ''}]`);
      }
    }
  }

  return results;
}

/**
 * Validate SLDL GEOIDs against cached data
 */
function validateSLDL(): ValidationResult[] {
  console.log('\n🔍 Validating SLDL (State House) GEOIDs...\n');

  const cachedFiles = findCachedFiles('SLDL');
  console.log(`   Found ${cachedFiles.size} cached SLDL files\n`);

  const results: ValidationResult[] = [];

  for (const [stateFips, canonicalGEOIDs] of Object.entries(
    CANONICAL_SLDL_GEOIDS
  )) {
    const stateAbbr = getStateAbbr(stateFips);
    const expectedCount = EXPECTED_SLDL_BY_STATE[stateFips] ?? 0;

    // Skip states with 0 expected (DC, Nebraska unicameral)
    if (expectedCount === 0) {
      continue;
    }

    const cachedFile = cachedFiles.get(stateFips);

    if (!cachedFile) {
      // No cached data - can't validate
      console.log(
        `   ⏭️  ${stateAbbr?.padEnd(2)} (${stateFips}): No cached data (expected ${expectedCount})`
      );
      continue;
    }

    // Extract actual GEOIDs from cached file
    const actualGEOIDs = extractGEOIDsFromGeoJSON(cachedFile);

    // Validate completeness
    const validation = validateGEOIDCompleteness('sldl', stateFips, actualGEOIDs);

    results.push({
      stateFips,
      stateAbbr,
      layer: 'SLDL',
      expected: expectedCount,
      actual: actualGEOIDs.length,
      missing: validation.missing,
      extra: validation.extra,
      valid: validation.valid,
    });

    if (validation.valid) {
      console.log(
        `   ✅ ${stateAbbr?.padEnd(2)} (${stateFips}): ${actualGEOIDs.length} GEOIDs match (${expectedCount} expected)`
      );
    } else {
      console.log(
        `   ❌ ${stateAbbr?.padEnd(2)} (${stateFips}): Mismatch detected`
      );
      console.log(`      Expected: ${expectedCount}, Actual: ${actualGEOIDs.length}`);

      if (validation.missing.length > 0) {
        console.log(
          `      Missing: ${validation.missing.slice(0, 5).join(', ')}${validation.missing.length > 5 ? '...' : ''}`
        );
      }

      if (validation.extra.length > 0) {
        console.log(
          `      Extra: ${validation.extra.slice(0, 5).join(', ')}${validation.extra.length > 5 ? '...' : ''}`
        );
      }

      // Show actual GEOIDs for correction
      if (actualGEOIDs.length !== expectedCount) {
        console.log(`      Actual GEOIDs: [${actualGEOIDs.slice(0, 10).join(', ')}${actualGEOIDs.length > 10 ? ', ...' : ''}]`);
      }
    }
  }

  return results;
}

/**
 * Generate summary report
 */
function generateReport(
  slduResults: ValidationResult[],
  sldlResults: ValidationResult[]
): void {
  console.log('\n' + '='.repeat(80));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(80));

  const slduValid = slduResults.filter((r) => r.valid).length;
  const slduInvalid = slduResults.filter((r) => !r.valid).length;
  const slduTotal = slduResults.length;

  const sldlValid = sldlResults.filter((r) => r.valid).length;
  const sldlInvalid = sldlResults.filter((r) => !r.valid).length;
  const sldlTotal = sldlResults.length;

  console.log(`\nSLDU (State Senate):`);
  console.log(`  ✅ Valid:   ${slduValid}/${slduTotal}`);
  console.log(`  ❌ Invalid: ${slduInvalid}/${slduTotal}`);

  console.log(`\nSLDL (State House):`);
  console.log(`  ✅ Valid:   ${sldlValid}/${sldlTotal}`);
  console.log(`  ❌ Invalid: ${sldlInvalid}/${sldlTotal}`);

  const allResults = [...slduResults, ...sldlResults];
  const totalValid = allResults.filter((r) => r.valid).length;
  const totalInvalid = allResults.filter((r) => !r.valid).length;
  const totalChecked = allResults.length;

  console.log(`\nOverall:`);
  console.log(`  ✅ Valid:   ${totalValid}/${totalChecked}`);
  console.log(`  ❌ Invalid: ${totalInvalid}/${totalChecked}`);

  // List states needing correction
  const needsCorrection = allResults.filter((r) => !r.valid);

  if (needsCorrection.length > 0) {
    console.log('\n' + '-'.repeat(80));
    console.log('STATES NEEDING CORRECTION:');
    console.log('-'.repeat(80));

    for (const result of needsCorrection) {
      console.log(
        `\n${result.stateAbbr} (${result.stateFips}) - ${result.layer}:`
      );
      console.log(`  Expected: ${result.expected} districts`);
      console.log(`  Actual:   ${result.actual} districts`);

      if (result.missing.length > 0) {
        console.log(`  Missing GEOIDs (${result.missing.length}):`, result.missing.slice(0, 10));
      }

      if (result.extra.length > 0) {
        console.log(`  Extra GEOIDs (${result.extra.length}):`, result.extra.slice(0, 10));
      }
    }

    console.log('\n' + '-'.repeat(80));
    console.log('NEXT STEPS:');
    console.log('-'.repeat(80));
    console.log('1. For states with cached data showing discrepancies:');
    console.log('   - Update CANONICAL_SLDU_GEOIDS/CANONICAL_SLDL_GEOIDS in geoid-reference.ts');
    console.log('   - Use actual GEOIDs from cached files (shown above)');
    console.log('   - Add inline comments documenting non-sequential numbering');
    console.log('');
    console.log('2. For states without cached data:');
    console.log('   - Download shapefiles: https://www2.census.gov/geo/tiger/TIGER2024/{SLDU,SLDL}/');
    console.log('   - Extract GeoJSON using ogr2ogr or extract-geojson.sh');
    console.log('   - Re-run this validation script');
    console.log('');
    console.log('3. After corrections, verify with:');
    console.log('   npm run build');
    console.log('   npm run test:run');
  } else {
    console.log('\n✅ All validated states have correct GEOID lists!');
  }

  console.log('\n' + '='.repeat(80) + '\n');
}

/**
 * Main execution
 */
function main(): void {
  console.log('='.repeat(80));
  console.log('TIGER GEOID VALIDATION SCRIPT');
  console.log('='.repeat(80));
  console.log('\nValidating programmatic GEOID generation against TIGER 2024 cache...');

  const slduResults = validateSLDU();
  const sldlResults = validateSLDL();

  generateReport(slduResults, sldlResults);

  // Exit with error code if validation failed
  const hasErrors =
    slduResults.some((r) => !r.valid) || sldlResults.some((r) => !r.valid);

  if (hasErrors) {
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url.startsWith('file:')) {
  const modulePath = new URL(import.meta.url).pathname;
  const scriptPath = process.argv[1];
  if (modulePath === scriptPath) {
    main();
  }
}
