#!/usr/bin/env npx tsx
/**
 * Cross-Validation CLI
 *
 * CLI tool to validate TIGER data against state GIS portals.
 * Uses CrossValidator from src/validators/cross-validator.ts.
 *
 * VALIDATES:
 * - Congressional Districts (CD)
 * - State Legislative Upper (SLDU)
 * - State Legislative Lower (SLDL)
 * - Counties (COUNTY)
 *
 * USAGE:
 *   npx tsx scripts/cross-validate.ts
 *   npx tsx scripts/cross-validate.ts --verbose
 *   npx tsx scripts/cross-validate.ts --layer=cd
 *   npx tsx scripts/cross-validate.ts --state=06
 *   npx tsx scripts/cross-validate.ts --json
 *
 * EXIT CODES:
 *   0 = All validations >99.5% match
 *   1 = Warnings (some match rates below 99.5%)
 *   2 = Errors (validation failures or critical issues)
 *
 * Last Updated: 2026-01-09
 */

import type { TIGERLayerType } from '../core/types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Layers supported by cross-validation
 */
type CrossValidatableLayer = 'cd' | 'sldu' | 'sldl' | 'county';

/**
 * CLI options
 */
interface CliOptions {
  readonly verbose: boolean;
  readonly layer?: CrossValidatableLayer;
  readonly state?: string;
  readonly json: boolean;
}

/**
 * Layer summary result
 */
interface LayerSummary {
  readonly layer: CrossValidatableLayer;
  readonly totalTiger: number;
  readonly totalMatched: number;
  readonly matchRate: number;
  readonly missingGEOIDs: readonly string[];
  readonly extraGEOIDs: readonly string[];
  readonly status: 'PASS' | 'WARNING' | 'FAIL';
}

/**
 * Cross-validation report
 */
interface CrossValidationReport {
  readonly timestamp: string;
  readonly layers: readonly LayerSummary[];
  readonly overallMatchRate: number;
  readonly overallStatus: 'PASS' | 'WARNING' | 'FAIL';
}

// ============================================================================
// Constants
// ============================================================================

const VALID_LAYERS: readonly CrossValidatableLayer[] = ['cd', 'sldu', 'sldl', 'county'];

/**
 * Match rate thresholds
 */
const MATCH_THRESHOLD_PASS = 99.5;
const MATCH_THRESHOLD_WARNING = 95.0;

/**
 * State FIPS to abbreviation mapping
 */
const FIPS_TO_ABBR: Record<string, string> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
  '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
  '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
  '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
  '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
  '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
  '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
  '56': 'WY', '60': 'AS', '66': 'GU', '69': 'MP', '72': 'PR',
  '78': 'VI',
};

const ALL_STATE_FIPS = Object.keys(FIPS_TO_ABBR);

// ============================================================================
// CLI Parsing
// ============================================================================

/**
 * Parse command line arguments
 */
function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let verbose = false;
  let layer: CrossValidatableLayer | undefined;
  let state: string | undefined;
  let json = false;

  for (const arg of args) {
    if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg.startsWith('--layer=')) {
      const layerValue = arg.split('=')[1];
      if (isValidLayer(layerValue)) {
        layer = layerValue;
      } else {
        console.error(`Invalid layer: ${layerValue}`);
        console.error(`Valid layers: ${VALID_LAYERS.join(', ')}`);
        process.exit(2);
      }
    } else if (arg.startsWith('--state=')) {
      state = arg.split('=')[1];
      if (!/^\d{2}$/.test(state)) {
        console.error(`Invalid state FIPS: ${state} (must be 2 digits)`);
        process.exit(2);
      }
      if (!FIPS_TO_ABBR[state]) {
        console.error(`Unknown state FIPS: ${state}`);
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
 * Type guard for valid layer
 */
function isValidLayer(value: string): value is CrossValidatableLayer {
  return VALID_LAYERS.includes(value as CrossValidatableLayer);
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Shadow Atlas Cross-Validation Tool

Validates TIGER/Line data against state GIS portals to detect discrepancies.

USAGE:
  npx tsx src/scripts/cross-validate.ts [OPTIONS]

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
  county   Counties

EXAMPLES:
  # Validate all layers for all states
  npx tsx src/scripts/cross-validate.ts

  # Validate with verbose output
  npx tsx src/scripts/cross-validate.ts --verbose

  # Validate only Congressional Districts
  npx tsx src/scripts/cross-validate.ts --layer=cd

  # Validate California (FIPS 06)
  npx tsx src/scripts/cross-validate.ts --state=06

  # Output JSON
  npx tsx src/scripts/cross-validate.ts --json

EXIT CODES:
  0  All layers >99.5% match rate
  1  Warnings (some layers 95-99.5% match rate)
  2  Errors (match rate <95% or validation failures)
`);
}

// ============================================================================
// Cross-Validation Logic
// ============================================================================

/**
 * Attempt to import cross-validator module
 * Returns null if module not yet implemented
 */
async function loadCrossValidator(): Promise<typeof import('../validators/cross-validator.js') | null> {
  try {
    return await import('../validators/cross-validator.js');
  } catch (error) {
    const err = error as Error & { code?: string };
    if (err.message.includes('Cannot find module') || err.code === 'ERR_MODULE_NOT_FOUND') {
      return null;
    }
    throw error;
  }
}

/**
 * Run cross-validation for a single layer
 */
async function validateLayer(
  layer: CrossValidatableLayer,
  stateFips: readonly string[],
  verbose: boolean
): Promise<LayerSummary> {
  // Try to load cross-validator
  const crossValidatorModule = await loadCrossValidator();

  if (!crossValidatorModule) {
    console.error('Cross-validator module not found.');
    console.error('Ensure src/validators/cross-validator.ts is implemented.');
    return {
      layer,
      totalTiger: 0,
      totalMatched: 0,
      matchRate: 0,
      missingGEOIDs: [],
      extraGEOIDs: [],
      status: 'FAIL',
    };
  }

  // For now, return placeholder until full integration
  // The actual implementation would use CrossValidator class
  if (verbose) {
    console.log(`  Validating ${layer.toUpperCase()} across ${stateFips.length} states...`);
  }

  // Placeholder: In production, this would instantiate CrossValidator
  // and call validateBatch() with the provided states
  //
  // Example usage (when fully implemented):
  // const validator = new crossValidatorModule.CrossValidator(tigerLoader, stateExtractor);
  // const results = await validator.validateBatch(layer as TIGERLayerType, stateFips, 2024);

  // Return stub result indicating cross-validator needs configuration
  const stubResult: LayerSummary = {
    layer,
    totalTiger: 0,
    totalMatched: 0,
    matchRate: 0,
    missingGEOIDs: [],
    extraGEOIDs: [],
    status: 'WARNING',
  };

  // Check if CrossValidator class exists
  if (!crossValidatorModule.CrossValidator) {
    console.warn(`  CrossValidator class not exported from module`);
    return stubResult;
  }

  console.log(`  Layer ${layer.toUpperCase()}: CrossValidator available but requires BoundaryProvider and StateExtractor configuration`);

  return stubResult;
}

/**
 * Run full cross-validation
 */
async function runCrossValidation(options: CliOptions): Promise<CrossValidationReport> {
  const layersToValidate = options.layer ? [options.layer] : [...VALID_LAYERS];
  const statesToValidate = options.state ? [options.state] : ALL_STATE_FIPS;

  const layerSummaries: LayerSummary[] = [];

  for (const layer of layersToValidate) {
    if (options.verbose) {
      console.log(`\nValidating layer: ${layer.toUpperCase()}`);
    }

    const summary = await validateLayer(layer, statesToValidate, options.verbose);
    layerSummaries.push(summary);
  }

  // Calculate overall stats
  const totalTiger = layerSummaries.reduce((sum, l) => sum + l.totalTiger, 0);
  const totalMatched = layerSummaries.reduce((sum, l) => sum + l.totalMatched, 0);
  const overallMatchRate = totalTiger > 0 ? (totalMatched / totalTiger) * 100 : 0;

  // Determine overall status
  const hasFailures = layerSummaries.some(l => l.status === 'FAIL');
  const hasWarnings = layerSummaries.some(l => l.status === 'WARNING');

  let overallStatus: 'PASS' | 'WARNING' | 'FAIL';
  if (hasFailures) {
    overallStatus = 'FAIL';
  } else if (hasWarnings) {
    overallStatus = 'WARNING';
  } else {
    overallStatus = 'PASS';
  }

  return {
    timestamp: new Date().toISOString(),
    layers: layerSummaries,
    overallMatchRate,
    overallStatus,
  };
}

// ============================================================================
// Output Formatting
// ============================================================================

/**
 * Get status icon for display
 */
function getStatusIcon(status: 'PASS' | 'WARNING' | 'FAIL'): string {
  switch (status) {
    case 'PASS':
      return '[PASS]';
    case 'WARNING':
      return '[WARN]';
    case 'FAIL':
      return '[FAIL]';
  }
}

/**
 * Print layer summary
 */
function printLayerSummary(summary: LayerSummary, verbose: boolean): void {
  const icon = getStatusIcon(summary.status);
  const matchRateStr = summary.totalTiger > 0
    ? `${summary.matchRate.toFixed(1)}%`
    : 'N/A';

  console.log(`${icon} ${summary.layer.toUpperCase()}: ${summary.totalMatched}/${summary.totalTiger} (${matchRateStr})`);

  if (summary.missingGEOIDs.length > 0) {
    const missing = summary.missingGEOIDs.slice(0, 10);
    console.log(`   Missing from TIGER: ${missing.join(', ')}${summary.missingGEOIDs.length > 10 ? '...' : ''}`);
  }

  if (summary.extraGEOIDs.length > 0) {
    const extra = summary.extraGEOIDs.slice(0, 10);
    console.log(`   Extra in TIGER: ${extra.join(', ')}${summary.extraGEOIDs.length > 10 ? '...' : ''}`);
  }

  if (verbose && summary.totalTiger === 0) {
    console.log(`   Note: No data available - cross-validator requires configuration`);
  }
}

/**
 * Print full report
 */
function printReport(report: CrossValidationReport, verbose: boolean): void {
  console.log('='.repeat(80));
  console.log('CROSS-VALIDATION REPORT');
  console.log('='.repeat(80));
  console.log(`Generated: ${report.timestamp}`);
  console.log('');

  for (const layer of report.layers) {
    printLayerSummary(layer, verbose);
  }

  console.log('');
  console.log('-'.repeat(80));

  const passedLayers = report.layers.filter(l => l.status === 'PASS').length;
  const totalLayers = report.layers.length;
  const overallIcon = getStatusIcon(report.overallStatus);

  console.log(`Summary: ${passedLayers}/${totalLayers} layers validated, ${report.overallMatchRate.toFixed(1)}% overall match rate`);
  console.log(`Status: ${overallIcon} ${report.overallStatus}`);
  console.log('='.repeat(80));
}

// ============================================================================
// Main Execution
// ============================================================================

async function main(): Promise<void> {
  const options = parseArgs();

  if (!options.json) {
    console.log('='.repeat(80));
    console.log('SHADOW ATLAS CROSS-VALIDATION');
    console.log('='.repeat(80));
    console.log('Validating TIGER data against state GIS portals...');
  }

  try {
    const report = await runCrossValidation(options);

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report, options.verbose);

      // Print next steps if there are issues
      if (report.overallStatus !== 'PASS') {
        console.log('');
        console.log('NEXT STEPS');
        console.log('-'.repeat(80));
        console.log('1. Review discrepancies above');
        console.log('2. Check state GIS portal for updated boundaries');
        console.log('3. Verify TIGER vintage matches redistricting year');
        console.log('4. Update canonical GEOID references if needed');
        console.log('5. Re-run validation: npm run validate:cross');
        console.log('');
      }
    }

    // Exit with appropriate code
    if (report.overallStatus === 'FAIL') {
      process.exit(2);
    } else if (report.overallStatus === 'WARNING') {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (error) {
    const err = error as Error;
    console.error(`Cross-validation failed: ${err.message}`);
    if (options.verbose) {
      console.error(err.stack);
    }
    process.exit(2);
  }
}

// Run if called directly
if (import.meta.url.startsWith('file:')) {
  const modulePath = new URL(import.meta.url).pathname;
  const scriptPath = process.argv[1];
  if (modulePath === scriptPath || process.argv[1]?.endsWith('cross-validate.ts')) {
    main();
  }
}
