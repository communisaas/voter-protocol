#!/usr/bin/env npx tsx
/**
 * Validate All GEOIDs Script
 *
 * CLI tool to run comprehensive GEOID validation across all Shadow Atlas layers.
 *
 * VALIDATES:
 * - Congressional Districts (CD)
 * - State Legislative Upper (SLDU)
 * - State Legislative Lower (SLDL)
 * - Unified School Districts (UNSD)
 * - Elementary School Districts (ELSD)
 * - Secondary School Districts (SCSD)
 * - Voting Tabulation Districts (VTD)
 *
 * USAGE:
 *   npx tsx scripts/validate-all-geoids.ts
 *   npx tsx scripts/validate-all-geoids.ts --verbose
 *   npx tsx scripts/validate-all-geoids.ts --layer=cd
 *   npx tsx scripts/validate-all-geoids.ts --state=06
 *
 * EXIT CODES:
 *   0 = All validations passed
 *   1 = Warnings only (no errors)
 *   2 = Validation errors detected
 *
 * Last Updated: 2026-01-02
 */

import {
  validateAllCanonicalGEOIDs,
  validateLayer,
  generateValidationReport,
  type ValidatableLayer,
  type ValidationReport,
  type LayerValidation,
} from '../validators/geoid/validation-suite.js';

interface CliOptions {
  readonly verbose: boolean;
  readonly layer?: ValidatableLayer;
  readonly state?: string;
  readonly json: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let verbose = false;
  let layer: ValidatableLayer | undefined;
  let state: string | undefined;
  let json = false;

  for (const arg of args) {
    if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg.startsWith('--layer=')) {
      const layerValue = arg.split('=')[1] as ValidatableLayer;
      const validLayers: ValidatableLayer[] = ['cd', 'sldu', 'sldl', 'unsd', 'elsd', 'scsd', 'county', 'vtd'];
      if (validLayers.includes(layerValue)) {
        layer = layerValue;
      } else {
        console.error(`Invalid layer: ${layerValue}`);
        console.error(`Valid layers: ${validLayers.join(', ')}`);
        process.exit(2);
      }
    } else if (arg.startsWith('--state=')) {
      state = arg.split('=')[1];
      if (!/^\d{2}$/.test(state)) {
        console.error(`Invalid state FIPS: ${state} (must be 2 digits)`);
        process.exit(2);
      }
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(2);
    }
  }

  return { verbose, layer, state, json };
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Shadow Atlas GEOID Validation Tool

USAGE:
  npx tsx scripts/validate-all-geoids.ts [OPTIONS]

OPTIONS:
  --verbose, -v        Show detailed validation output
  --json               Output results as JSON
  --layer=<layer>      Validate specific layer only
  --state=<fips>       Validate specific state only (2-digit FIPS)
  --help, -h           Show this help message

LAYERS:
  cd       Congressional Districts
  sldu     State Legislative Upper (Senate)
  sldl     State Legislative Lower (House)
  unsd     Unified School Districts
  elsd     Elementary School Districts
  scsd     Secondary School Districts
  county   Counties
  vtd      Voting Tabulation Districts

EXAMPLES:
  # Validate all layers
  npx tsx scripts/validate-all-geoids.ts

  # Validate with verbose output
  npx tsx scripts/validate-all-geoids.ts --verbose

  # Validate only Congressional Districts
  npx tsx scripts/validate-all-geoids.ts --layer=cd

  # Validate California (FIPS 06)
  npx tsx scripts/validate-all-geoids.ts --state=06

  # Output JSON
  npx tsx scripts/validate-all-geoids.ts --json

EXIT CODES:
  0  All validations passed
  1  Warnings only (no errors)
  2  Validation errors detected
`);
}

/**
 * Print detailed layer validation
 */
function printLayerDetails(layer: LayerValidation, verbose: boolean): void {
  const statusIcon = layer.status === 'PASS' ? '✅' : layer.status === 'WARNING' ? '⚠️' : '❌';

  console.log(`\n${statusIcon} ${layer.layer.toUpperCase()}: ${layer.description}`);
  console.log(`   Format: ${layer.formatSpec}`);
  console.log(`   States: ${layer.statesPassed}/${layer.statesValidated} passed`);
  console.log(`   GEOIDs: ${layer.totalGEOIDs.toLocaleString()} (expected: ${layer.totalExpected.toLocaleString()})`);

  if (layer.statesFailed > 0 || verbose) {
    const failedStates = layer.stateResults.filter((s) => !s.valid && s.errors.length > 0);
    const warningStates = layer.stateResults.filter((s) => s.warnings.length > 0 && s.valid);

    if (failedStates.length > 0) {
      console.log(`\n   FAILURES (${failedStates.length}):`);
      for (const state of failedStates) {
        console.log(`   ❌ ${state.stateAbbr?.padEnd(2) ?? '??'} (${state.stateFips}): ${state.stateName ?? 'Unknown'}`);
        for (const error of state.errors) {
          console.log(`      • ${error}`);
        }
      }
    }

    if (verbose && warningStates.length > 0) {
      console.log(`\n   WARNINGS (${warningStates.length}):`);
      for (const state of warningStates) {
        console.log(`   ⚠️  ${state.stateAbbr?.padEnd(2) ?? '??'} (${state.stateFips}): ${state.stateName ?? 'Unknown'}`);
        for (const warning of state.warnings) {
          console.log(`      • ${warning}`);
        }
      }
    }

    if (verbose) {
      const passedStates = layer.stateResults.filter((s) => s.valid && s.errors.length === 0);
      if (passedStates.length > 0) {
        console.log(`\n   PASSED (${passedStates.length}):`);
        const grouped: Record<number, string[]> = {};
        for (const state of passedStates) {
          const count = state.actualCount;
          if (!grouped[count]) {
            grouped[count] = [];
          }
          grouped[count].push(state.stateAbbr ?? state.stateFips);
        }
        for (const [count, states] of Object.entries(grouped)) {
          console.log(`   ✅ ${count.padStart(3)} districts: ${states.join(', ')}`);
        }
      }
    }
  }
}

/**
 * Print summary report
 */
function printSummary(report: ValidationReport): void {
  console.log('\n' + '='.repeat(80));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(80));

  console.log(`\nLayers:`);
  console.log(`  Validated: ${report.summary.layersValidated}`);
  console.log(`  Passed:    ${report.summary.layersPassed}`);
  console.log(`  Failed:    ${report.summary.layersFailed}`);
  console.log(`  Warnings:  ${report.summary.layersWithWarnings}`);

  console.log(`\nStates:`);
  console.log(`  Validated: ${report.summary.totalStatesValidated}`);
  console.log(`  Passed:    ${report.summary.totalStatesPassed}`);
  console.log(`  Failed:    ${report.summary.totalStatesFailed}`);

  const statusIcon = report.summary.overallStatus === 'PASS' ? '✅' :
                     report.summary.overallStatus === 'WARNING' ? '⚠️' : '❌';
  console.log(`\nOverall Status: ${statusIcon} ${report.summary.overallStatus}`);
  console.log('='.repeat(80));
}

/**
 * Filter report by state
 */
function filterByState(report: ValidationReport, stateFips: string): ValidationReport {
  const filteredLayers = report.layers.map((layer) => ({
    ...layer,
    stateResults: layer.stateResults.filter((s) => s.stateFips === stateFips),
    statesValidated: layer.stateResults.filter((s) => s.stateFips === stateFips).length,
    statesPassed: layer.stateResults.filter((s) => s.stateFips === stateFips && s.valid).length,
    statesFailed: layer.stateResults.filter((s) => s.stateFips === stateFips && !s.valid).length,
  }));

  const totalStatesValidated = filteredLayers.reduce((sum, l) => sum + l.statesValidated, 0);
  const totalStatesPassed = filteredLayers.reduce((sum, l) => sum + l.statesPassed, 0);
  const totalStatesFailed = filteredLayers.reduce((sum, l) => sum + l.statesFailed, 0);

  return {
    ...report,
    layers: filteredLayers,
    summary: {
      ...report.summary,
      totalStatesValidated,
      totalStatesPassed,
      totalStatesFailed,
    },
  };
}

/**
 * Main execution
 */
function main(): void {
  const options = parseArgs();

  console.log('='.repeat(80));
  console.log('SHADOW ATLAS GEOID VALIDATION');
  console.log('='.repeat(80));

  let report: ValidationReport;

  if (options.layer) {
    // Validate single layer
    console.log(`\nValidating layer: ${options.layer.toUpperCase()}`);
    const layerResult = validateLayer(options.layer);
    report = {
      timestamp: new Date().toISOString(),
      layers: [layerResult],
      summary: {
        layersValidated: 1,
        layersPassed: layerResult.status === 'PASS' ? 1 : 0,
        layersFailed: layerResult.status === 'FAIL' ? 1 : 0,
        layersWithWarnings: layerResult.status === 'WARNING' ? 1 : 0,
        totalStatesValidated: layerResult.statesValidated,
        totalStatesPassed: layerResult.statesPassed,
        totalStatesFailed: layerResult.statesFailed,
        overallStatus: layerResult.status,
      },
    };
  } else {
    // Validate all layers
    console.log('\nValidating all layers...');
    report = validateAllCanonicalGEOIDs();
  }

  // Filter by state if requested
  if (options.state) {
    console.log(`Filtering by state: ${options.state}`);
    report = filterByState(report, options.state);
  }

  // Output results
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const layer of report.layers) {
      printLayerDetails(layer, options.verbose);
    }
    printSummary(report);

    // Print next steps if failures
    if (report.summary.overallStatus === 'FAIL') {
      console.log('\n' + '='.repeat(80));
      console.log('NEXT STEPS');
      console.log('='.repeat(80));
      console.log('1. Review failed validations above');
      console.log('2. Check TIGER/Line 2024 shapefiles for discrepancies');
      console.log('3. Update canonical GEOID references in src/validators/geoid-reference.ts');
      console.log('4. Update expected counts in src/validators/tiger-expected-counts.ts');
      console.log('5. Re-run validation: npm run validate:geoids');
      console.log('');
    }
  }

  // Exit with appropriate code
  if (report.summary.overallStatus === 'FAIL') {
    process.exit(2);
  } else if (report.summary.overallStatus === 'WARNING') {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

// Run if called directly
if (import.meta.url.startsWith('file:')) {
  const modulePath = new URL(import.meta.url).pathname;
  const scriptPath = process.argv[1];
  if (modulePath === scriptPath || process.argv[1]?.endsWith('validate-all-geoids.ts')) {
    main();
  }
}
