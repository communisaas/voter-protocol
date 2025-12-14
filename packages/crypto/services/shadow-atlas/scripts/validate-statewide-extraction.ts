#!/usr/bin/env npx tsx
/**
 * Statewide Extraction Validation Script
 *
 * Validates extracted city ward data for correctness before adding to registry.
 *
 * USAGE:
 * ```bash
 * # Validate Wisconsin extraction
 * npx tsx scripts/validate-statewide-extraction.ts --state WI
 *
 * # Validate Massachusetts extraction
 * npx tsx scripts/validate-statewide-extraction.ts --state MA
 *
 * # Validate both states
 * npx tsx scripts/validate-statewide-extraction.ts --state all
 * ```
 *
 * VALIDATION CHECKS:
 * 1. City count matches expected range
 * 2. All GeoJSON files are valid
 * 3. Ward counts are reasonable (3-50)
 * 4. FIPS codes are valid 7-digit Census PLACE codes
 * 5. Geometries are valid polygons/multipolygons
 * 6. No duplicate cities
 * 7. All cities have unique ward identifiers
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';

interface ValidationResult {
  readonly state: string;
  readonly cityCount: number;
  readonly errors: ValidationError[];
  readonly warnings: ValidationWarning[];
  readonly passed: boolean;
}

interface ValidationError {
  readonly city: string;
  readonly fips: string;
  readonly message: string;
  readonly severity: 'error';
}

interface ValidationWarning {
  readonly city: string;
  readonly fips: string;
  readonly message: string;
  readonly severity: 'warning';
}

/**
 * CLI arguments
 */
interface CliArgs {
  state: 'WI' | 'MA' | 'all';
  dataDir: string;
}

/**
 * Parse CLI arguments
 */
function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  const result: CliArgs = {
    state: 'all',
    dataDir: path.join(process.cwd(), 'services/shadow-atlas/data/statewide-wards'),
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--state':
        result.state = args[++i] as CliArgs['state'];
        break;
      case '--data-dir':
        result.dataDir = args[++i];
        break;
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  return result;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Statewide Extraction Validation

USAGE:
  npx tsx scripts/validate-statewide-extraction.ts [OPTIONS]

OPTIONS:
  --state <state>     State to validate (WI|MA|all) - Default: all
  --data-dir <dir>    Data directory (default: data/statewide-wards)
  --help              Show this help message

EXAMPLES:
  # Validate Wisconsin extraction
  npx tsx scripts/validate-statewide-extraction.ts --state WI

  # Validate Massachusetts extraction
  npx tsx scripts/validate-statewide-extraction.ts --state MA

  # Validate both states
  npx tsx scripts/validate-statewide-extraction.ts --state all
`);
}

/**
 * Load GeoJSON file safely
 */
function loadGeoJSON(filePath: string): FeatureCollection<Polygon | MultiPolygon> | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as FeatureCollection<Polygon | MultiPolygon>;
  } catch (error) {
    return null;
  }
}

/**
 * Validate FIPS code format (7 digits)
 */
function isValidFips(fips: string): boolean {
  return /^\d{7}$/.test(fips);
}

/**
 * Validate ward count is reasonable
 */
function isReasonableWardCount(count: number): boolean {
  return count >= 3 && count <= 50;
}

/**
 * Validate geometry
 */
function validateGeometry(
  geojson: FeatureCollection<Polygon | MultiPolygon>
): { valid: boolean; reason?: string } {
  // Check feature count
  if (geojson.features.length === 0) {
    return { valid: false, reason: 'No features' };
  }

  // Check all features have geometries
  for (const feature of geojson.features) {
    if (!feature.geometry) {
      return { valid: false, reason: 'Missing geometry' };
    }

    if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') {
      return { valid: false, reason: `Invalid geometry type: ${feature.geometry.type}` };
    }

    // Check coordinates exist
    if (!feature.geometry.coordinates || feature.geometry.coordinates.length === 0) {
      return { valid: false, reason: 'Empty coordinates' };
    }
  }

  return { valid: true };
}

/**
 * Validate a single state extraction
 */
function validateStateExtraction(state: string, dataDir: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  Validating ${state} Extraction`);
  console.log(`${'='.repeat(70)}\n`);

  const stateDir = path.join(dataDir, state);
  const citiesDir = path.join(stateDir, 'cities');
  const summaryPath = path.join(stateDir, 'extraction-summary.json');
  const registryPath = path.join(stateDir, 'registry-entries.json');

  // Check directories exist
  if (!fs.existsSync(citiesDir)) {
    errors.push({
      city: 'N/A',
      fips: 'N/A',
      message: `Cities directory not found: ${citiesDir}`,
      severity: 'error',
    });
    return { state, cityCount: 0, errors, warnings, passed: false };
  }

  // Load extraction summary
  let summary: any = null;
  if (fs.existsSync(summaryPath)) {
    summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    console.log(`Extraction summary:`);
    console.log(`  Date: ${summary.extractedAt}`);
    console.log(`  Cities found: ${summary.citiesFound}`);
    console.log(`  Expected: ${summary.expectedCities}`);
    console.log();
  } else {
    warnings.push({
      city: 'N/A',
      fips: 'N/A',
      message: 'extraction-summary.json not found',
      severity: 'warning',
    });
  }

  // Load registry entries
  let registryEntries: any[] = [];
  if (fs.existsSync(registryPath)) {
    registryEntries = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
  } else {
    warnings.push({
      city: 'N/A',
      fips: 'N/A',
      message: 'registry-entries.json not found',
      severity: 'warning',
    });
  }

  // Get all city files
  const cityFiles = fs.readdirSync(citiesDir).filter(f => f.endsWith('.geojson'));

  console.log(`Validating ${cityFiles.length} cities...\n`);

  const fipsSet = new Set<string>();

  for (const cityFile of cityFiles) {
    const fips = cityFile.replace('.geojson', '');
    const cityPath = path.join(citiesDir, cityFile);
    const cityName = registryEntries.find(e => e.cityFips === fips)?.cityName || 'Unknown';

    // Check for duplicate FIPS
    if (fipsSet.has(fips)) {
      errors.push({
        city: cityName,
        fips,
        message: 'Duplicate FIPS code',
        severity: 'error',
      });
      continue;
    }
    fipsSet.add(fips);

    // Validate FIPS format
    if (!isValidFips(fips)) {
      errors.push({
        city: cityName,
        fips,
        message: `Invalid FIPS format: ${fips} (expected 7 digits)`,
        severity: 'error',
      });
      continue;
    }

    // Load GeoJSON
    const geojson = loadGeoJSON(cityPath);

    if (!geojson) {
      errors.push({
        city: cityName,
        fips,
        message: 'Failed to load GeoJSON',
        severity: 'error',
      });
      continue;
    }

    // Validate ward count
    const wardCount = geojson.features.length;

    if (!isReasonableWardCount(wardCount)) {
      warnings.push({
        city: cityName,
        fips,
        message: `Unusual ward count: ${wardCount} (expected 3-50)`,
        severity: 'warning',
      });
    }

    // Validate geometry
    const geometryValidation = validateGeometry(geojson);

    if (!geometryValidation.valid) {
      errors.push({
        city: cityName,
        fips,
        message: `Geometry validation failed: ${geometryValidation.reason}`,
        severity: 'error',
      });
      continue;
    }

    // Check for unique ward identifiers
    const wardIds = new Set<string>();
    for (const feature of geojson.features) {
      const wardId = feature.properties?.WARD_NORMALIZED?.toString() ||
                     feature.properties?.WARD?.toString() ||
                     'unknown';

      if (wardIds.has(wardId)) {
        warnings.push({
          city: cityName,
          fips,
          message: `Duplicate ward identifier: ${wardId}`,
          severity: 'warning',
        });
      }
      wardIds.add(wardId);
    }

    console.log(`  ✅ ${cityName} (${fips}): ${wardCount} wards`);
  }

  // Summary validation
  if (summary) {
    if (cityFiles.length < summary.expectedCities * 0.8) {
      warnings.push({
        city: 'N/A',
        fips: 'N/A',
        message: `Low city count: ${cityFiles.length} (expected ${summary.expectedCities})`,
        severity: 'warning',
      });
    }
  }

  const passed = errors.length === 0;

  return {
    state,
    cityCount: cityFiles.length,
    errors,
    warnings,
    passed,
  };
}

/**
 * Main validation function
 */
async function main(): Promise<void> {
  const args = parseArgs();

  console.log('\n========================================');
  console.log('  STATEWIDE EXTRACTION VALIDATION');
  console.log('========================================');

  const statesToValidate: string[] =
    args.state === 'all' ? ['WI', 'MA'] : [args.state];

  const allResults: ValidationResult[] = [];

  for (const state of statesToValidate) {
    const result = validateStateExtraction(state, args.dataDir);
    allResults.push(result);
  }

  // Final summary
  console.log('\n========================================');
  console.log('  VALIDATION SUMMARY');
  console.log('========================================\n');

  let totalPassed = 0;
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const result of allResults) {
    console.log(`${result.state}:`);
    console.log(`  Cities: ${result.cityCount}`);
    console.log(`  Errors: ${result.errors.length}`);
    console.log(`  Warnings: ${result.warnings.length}`);
    console.log(`  Status: ${result.passed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log();

    if (result.passed) {
      totalPassed++;
    }

    totalErrors += result.errors.length;
    totalWarnings += result.warnings.length;

    // Print errors
    if (result.errors.length > 0) {
      console.log(`  Errors:`);
      for (const error of result.errors) {
        console.log(`    ❌ ${error.city} (${error.fips}): ${error.message}`);
      }
      console.log();
    }

    // Print warnings
    if (result.warnings.length > 0) {
      console.log(`  Warnings:`);
      for (const warning of result.warnings.slice(0, 10)) {
        console.log(`    ⚠️  ${warning.city} (${warning.fips}): ${warning.message}`);
      }
      if (result.warnings.length > 10) {
        console.log(`    ... and ${result.warnings.length - 10} more warnings`);
      }
      console.log();
    }
  }

  console.log('Overall:');
  console.log(`  States validated: ${allResults.length}`);
  console.log(`  Passed: ${totalPassed}`);
  console.log(`  Total errors: ${totalErrors}`);
  console.log(`  Total warnings: ${totalWarnings}`);
  console.log();

  if (totalErrors === 0) {
    console.log('🎉 All validations passed!');
    console.log();
    console.log('Next steps:');
    console.log('1. Review warnings (if any)');
    console.log('2. Spot-check 5-10 cities against official sources');
    console.log('3. Add registry entries to known-portals.ts');
    process.exit(0);
  } else {
    console.log('❌ Validation failed. Fix errors before adding to registry.');
    process.exit(1);
  }
}

// Run if executed directly
main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
