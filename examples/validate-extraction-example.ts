#!/usr/bin/env npx tsx
/**
 * Example: Validating State Extraction with CityWardValidator
 *
 * This example demonstrates how to use the CityWardValidator service
 * to validate extracted city ward data.
 *
 * Replaces: scripts/validate-statewide-extraction.ts
 *
 * USAGE:
 * ```bash
 * npx tsx examples/validate-extraction-example.ts
 * ```
 */

import { CityWardValidator } from '../services/city-ward-validator.js';
import type { CityWardValidationResult } from '../services/city-ward-validator.types.js';

// ============================================================================
// Example 1: Basic Validation
// ============================================================================

function basicValidation(): void {
  console.log('\n=== Example 1: Basic Validation ===\n');

  const validator = new CityWardValidator();

  // Validate extraction directory
  const result = validator.validateExtractionDirectory('./data/statewide-wards/WI');

  console.log(`State: ${result.state}`);
  console.log(`Cities validated: ${result.cityCount}`);
  console.log(`Errors: ${result.errors.length}`);
  console.log(`Warnings: ${result.warnings.length}`);
  console.log(`Status: ${result.passed ? '✅ PASSED' : '❌ FAILED'}`);

  if (result.extractionSummary) {
    console.log(`\nExtraction Summary:`);
    console.log(`  Extracted at: ${result.extractionSummary.extractedAt}`);
    console.log(`  Cities found: ${result.extractionSummary.citiesFound}`);
    console.log(`  Expected: ${result.extractionSummary.expectedCities}`);
  }
}

// ============================================================================
// Example 2: Validation with Custom Options
// ============================================================================

function validationWithOptions(): void {
  console.log('\n=== Example 2: Validation with Custom Options ===\n');

  const validator = new CityWardValidator({
    minWardCount: 5,
    maxWardCount: 25,
  });

  const result = validator.validateExtractionDirectory('./data/statewide-wards/MA', {
    includeGeometry: true,
    includeWardIdentifiers: true,
    allowWarnings: false, // Fail on warnings
  });

  console.log(`Status: ${result.passed ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Cities validated: ${result.cityCount}`);
}

// ============================================================================
// Example 3: Multiple State Validation
// ============================================================================

function multiStateValidation(): void {
  console.log('\n=== Example 3: Multiple State Validation ===\n');

  const validator = new CityWardValidator();
  const states = ['WI', 'MA'];
  const dataDir = './data/statewide-wards';

  const results: CityWardValidationResult[] = [];

  for (const state of states) {
    console.log(`\nValidating ${state}...`);
    const result = validator.validateStateExtraction(state, dataDir);
    results.push(result);

    console.log(`  Cities: ${result.cityCount}`);
    console.log(`  Errors: ${result.errors.length}`);
    console.log(`  Warnings: ${result.warnings.length}`);
    console.log(`  Status: ${result.passed ? '✅ PASSED' : '❌ FAILED'}`);
  }

  // Summary
  console.log('\n=== Validation Summary ===\n');
  const totalPassed = results.filter(r => r.passed).length;
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
  const totalWarnings = results.reduce((sum, r) => sum + r.warnings.length, 0);

  console.log(`States validated: ${results.length}`);
  console.log(`Passed: ${totalPassed}`);
  console.log(`Total errors: ${totalErrors}`);
  console.log(`Total warnings: ${totalWarnings}`);
}

// ============================================================================
// Example 4: Individual Component Validation
// ============================================================================

function componentValidation(): void {
  console.log('\n=== Example 4: Individual Component Validation ===\n');

  const validator = new CityWardValidator();

  // Validate FIPS code
  const fipsResult = validator.validateFipsCode('5553000');
  console.log('FIPS Validation:', fipsResult);

  // Validate ward count
  const wardCountResult = validator.validateWardCount(15);
  console.log('Ward Count Validation:', wardCountResult);

  // Note: For geometry and ward identifier validation, you need actual GeoJSON data
  console.log('\nFor geometry validation, load GeoJSON and call:');
  console.log('  validator.validateGeometry(geojson)');
  console.log('  validator.validateWardIdentifiers(geojson.features)');
}

// ============================================================================
// Example 5: Error Handling
// ============================================================================

function errorHandling(): void {
  console.log('\n=== Example 5: Error Handling ===\n');

  const validator = new CityWardValidator();
  const result = validator.validateExtractionDirectory('./data/statewide-wards/WI');

  if (!result.passed) {
    console.log('❌ Validation failed!\n');

    // Print errors with codes
    console.log('Errors:');
    for (const error of result.errors) {
      console.log(`  [${error.code}] ${error.city} (${error.fips}): ${error.message}`);
    }

    // Print warnings
    if (result.warnings.length > 0) {
      console.log('\nWarnings:');
      for (const warning of result.warnings.slice(0, 5)) {
        console.log(`  [${warning.code}] ${warning.city} (${warning.fips}): ${warning.message}`);
      }
      if (result.warnings.length > 5) {
        console.log(`  ... and ${result.warnings.length - 5} more warnings`);
      }
    }
  } else {
    console.log('✅ All validations passed!');
  }
}

// ============================================================================
// Example 6: Registry Cross-Reference
// ============================================================================

function registryCrossReference(): void {
  console.log('\n=== Example 6: Registry Cross-Reference ===\n');

  const validator = new CityWardValidator();
  const result = validator.validateExtractionDirectory('./data/statewide-wards/WI');

  if (result.registryEntries) {
    console.log(`Registry entries loaded: ${result.registryEntries.length}`);
    console.log('\nSample entries:');

    for (const entry of result.registryEntries.slice(0, 3)) {
      console.log(`  ${entry.cityName} (FIPS: ${entry.cityFips})`);
    }
  } else {
    console.log('⚠️  No registry entries found');
  }
}

// ============================================================================
// Main Function
// ============================================================================

function main(): void {
  console.log('\n========================================');
  console.log('  CITY WARD VALIDATOR EXAMPLES');
  console.log('========================================');

  // Run examples (comment out as needed)
  try {
    basicValidation();
    // validationWithOptions();
    // multiStateValidation();
    componentValidation();
    errorHandling();
    registryCrossReference();
  } catch (error) {
    console.error('\n❌ Error running examples:', error);
    process.exit(1);
  }

  console.log('\n========================================');
  console.log('  EXAMPLES COMPLETE');
  console.log('========================================\n');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

// Export for use in other modules
export {
  basicValidation,
  validationWithOptions,
  multiStateValidation,
  componentValidation,
  errorHandling,
  registryCrossReference,
};
