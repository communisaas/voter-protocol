#!/usr/bin/env tsx
/**
 * GEOID Validation Command
 *
 * Validates GEOID format, coverage, and counts across all layer types.
 *
 * LAYER TYPES:
 *   cd     - Congressional Districts (SSDD)
 *   sldu   - State Legislative Upper (SSDDD)
 *   sldl   - State Legislative Lower (variable)
 *   unsd   - Unified School Districts (SSGGGGG)
 *   elsd   - Elementary School Districts (SSGGGGG)
 *   scsd   - Secondary School Districts (SSGGGGG)
 *   county - Counties (SSCCC)
 *   vtd    - Voting Tabulation Districts (variable)
 *
 * VALIDATION CHECKS:
 *   - Format validation (GEOID regex patterns)
 *   - Coverage validation (all states covered)
 *   - Count validation (actual vs expected)
 *   - Duplicate detection
 *   - State prefix validation
 *
 * Usage:
 *   shadow-atlas validate geoids
 *   shadow-atlas validate geoids --layer cd --state 06
 *   shadow-atlas validate geoids --cross-validate
 */

import {
  validateAllCanonicalGEOIDs,
  validateLayer,
  validateGEOIDFormat,
  validateCanonicalCoverage,
  generateValidationReport,
  GEOID_FORMATS,
  type ValidatableLayer,
  type ValidationReport as GEOIDValidationReport,
  type StateLayerValidation,
} from '../../../validators/geoid/validation-suite.js';
import {
  buildReport,
  formatReport,
  getExitCode,
  type ValidationEntry,
  type OutputFormat,
} from '../../lib/validation-report.js';

// =============================================================================
// Types
// =============================================================================

interface GeoidValidateOptions {
  layer?: ValidatableLayer;
  state?: string;
  crossValidate: boolean;
  includeCounts: boolean;
  format: OutputFormat;
  verbose: boolean;
  json: boolean;
}

// =============================================================================
// CLI Argument Parser
// =============================================================================

function parseArgs(): GeoidValidateOptions {
  const args = process.argv.slice(2);
  const options: GeoidValidateOptions = {
    crossValidate: false,
    includeCounts: false,
    format: 'table',
    verbose: false,
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--layer':
        options.layer = args[++i] as ValidatableLayer;
        break;
      case '--state':
        options.state = args[++i];
        break;
      case '--cross-validate':
        options.crossValidate = true;
        break;
      case '--include-counts':
        options.includeCounts = true;
        break;
      case '--format':
        options.format = args[++i] as OutputFormat;
        break;
      case '--json':
        options.json = true;
        options.format = 'json';
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
GEOID Validation

Usage:
  shadow-atlas validate geoids [options]

Options:
  --layer <type>      Layer: cd|sldu|sldl|county|unsd|elsd|scsd|vtd
  --state <code>      State FIPS (2-digit)
  --cross-validate    Compare TIGER vs canonical GEOIDs
  --include-counts    Validate against expected counts
  --format <fmt>      Output format: table|json|csv|summary
  --json              Output as JSON (shorthand for --format json)
  --verbose, -v       Include detailed per-state results
  --help, -h          Show this help

Layer Types:
  cd      - Congressional Districts (SSDD, e.g., 0601)
  sldu    - State Legislative Upper (SSDDD, e.g., 06001)
  sldl    - State Legislative Lower (variable length)
  unsd    - Unified School Districts (SSGGGGG, e.g., 0600001)
  elsd    - Elementary School Districts (SSGGGGG)
  scsd    - Secondary School Districts (SSGGGGG)
  county  - Counties (SSCCC, e.g., 06001)
  vtd     - Voting Tabulation Districts (variable)

Validation Checks:
  - Format validation (GEOID regex patterns per layer)
  - Coverage validation (all states covered)
  - Count validation (actual vs expected)
  - Duplicate detection
  - State prefix validation

Examples:
  shadow-atlas validate geoids
  shadow-atlas validate geoids --layer cd
  shadow-atlas validate geoids --layer cd --state 06
  shadow-atlas validate geoids --cross-validate
  shadow-atlas validate geoids --json
`);
}

// =============================================================================
// Validation Logic
// =============================================================================

/**
 * Convert GEOID validation report to standard validation entries
 */
function toValidationEntries(report: GEOIDValidationReport): ValidationEntry[] {
  const entries: ValidationEntry[] = [];

  for (const layerResult of report.layers) {
    // Add layer-level entry
    const layerStatus = layerResult.status === 'PASS' ? 'pass' :
                        layerResult.status === 'WARNING' ? 'warn' : 'fail';

    entries.push({
      id: layerResult.layer,
      name: layerResult.description,
      status: layerStatus,
      message: `${layerResult.statesPassed}/${layerResult.statesValidated} states passed, ${layerResult.totalGEOIDs.toLocaleString()} GEOIDs`,
      diagnostics: {
        totalGEOIDs: layerResult.totalGEOIDs,
        totalExpected: layerResult.totalExpected,
        statesPassed: layerResult.statesPassed,
        statesFailed: layerResult.statesFailed,
      },
    });

    // Add failed state entries
    const failedStates = layerResult.stateResults.filter((s) => !s.valid && s.errors.length > 0);
    for (const state of failedStates) {
      entries.push({
        id: `${layerResult.layer}:${state.stateFips}`,
        name: `${state.stateAbbr} (${state.stateName})`,
        status: 'fail',
        message: state.errors[0] ?? 'Unknown error',
        diagnostics: {
          layer: layerResult.layer,
          stateFips: state.stateFips,
          expectedCount: state.expectedCount,
          actualCount: state.actualCount,
          errors: state.errors,
        },
        remediation: 'Check GEOID data source and re-extract from TIGER if needed',
      });
    }
  }

  return entries;
}

/**
 * Validate a single layer
 */
function validateSingleLayer(layer: ValidatableLayer, stateFips?: string): ValidationEntry[] {
  const entries: ValidationEntry[] = [];
  const result = validateLayer(layer);

  // Filter by state if specified
  let stateResults = result.stateResults;
  if (stateFips) {
    stateResults = stateResults.filter((s) => s.stateFips === stateFips);
    if (stateResults.length === 0) {
      return [{
        id: `${layer}:${stateFips}`,
        name: `State ${stateFips}`,
        status: 'skip',
        message: `No data found for state ${stateFips} in layer ${layer}`,
      }];
    }
  }

  // Layer summary
  const passed = stateResults.filter((s) => s.valid).length;
  const total = stateResults.length;
  const totalGEOIDs = stateResults.reduce((sum, s) => sum + s.actualCount, 0);

  const status = result.status === 'PASS' ? 'pass' :
                 result.status === 'WARNING' ? 'warn' : 'fail';

  entries.push({
    id: layer,
    name: result.description,
    status,
    message: `${passed}/${total} states passed, ${totalGEOIDs.toLocaleString()} GEOIDs`,
    diagnostics: {
      format: result.formatSpec,
      totalGEOIDs,
      totalExpected: stateResults.reduce((sum, s) => sum + s.expectedCount, 0),
    },
  });

  // State-level details
  for (const state of stateResults) {
    if (!state.valid && state.errors.length > 0) {
      entries.push({
        id: `${layer}:${state.stateFips}`,
        name: `${state.stateAbbr ?? state.stateFips}`,
        status: 'fail',
        message: state.errors[0],
        diagnostics: {
          expectedCount: state.expectedCount,
          actualCount: state.actualCount,
          errors: state.errors,
        },
      });
    } else if (state.warnings.length > 0) {
      entries.push({
        id: `${layer}:${state.stateFips}`,
        name: `${state.stateAbbr ?? state.stateFips}`,
        status: 'warn',
        message: state.warnings[0],
        diagnostics: {
          expectedCount: state.expectedCount,
          actualCount: state.actualCount,
        },
      });
    }
  }

  return entries;
}

/**
 * Run cross-validation between TIGER and canonical
 */
async function runCrossValidation(options: GeoidValidateOptions): Promise<ValidationEntry[]> {
  const entries: ValidationEntry[] = [];

  try {
    // Dynamic import to avoid loading TIGER validator unless needed
    const { createTIGERCanonicalValidator } = await import('../../../validators/tiger/canonical-validator.js');
    const validator = createTIGERCanonicalValidator();

    console.error('Running TIGER cross-validation (this may take several minutes)...\n');

    const report = await validator.validateAllLayers();

    // Convert to validation entries
    for (const layerReport of report.layers) {
      const status = layerReport.averageMatchRate >= 0.99 ? 'pass' :
                     layerReport.averageMatchRate >= 0.95 ? 'warn' : 'fail';

      entries.push({
        id: `cross:${layerReport.layer}`,
        name: `Cross-validate ${layerReport.layer.toUpperCase()}`,
        status,
        message: `${(layerReport.averageMatchRate * 100).toFixed(2)}% match rate`,
        diagnostics: {
          matchRate: layerReport.averageMatchRate,
          statesValidated: layerReport.statesValidated,
        },
      });

      // Add state-level failures
      for (const state of layerReport.stateResults) {
        if (state.matchRate < 0.95) {
          entries.push({
            id: `cross:${layerReport.layer}:${state.stateFips}`,
            name: `${state.stateAbbr}`,
            status: state.matchRate < 0.90 ? 'fail' : 'warn',
            message: `${(state.matchRate * 100).toFixed(1)}% match (${state.missingFromCanonical} missing, ${state.extraInCanonical} extra)`,
          });
        }
      }
    }

    // Overall summary
    const overallStatus = report.summary.overallMatchRate >= 0.99 ? 'pass' :
                          report.summary.overallMatchRate >= 0.95 ? 'warn' : 'fail';

    entries.unshift({
      id: 'cross:overall',
      name: 'TIGER Cross-Validation',
      status: overallStatus,
      message: `${(report.summary.overallMatchRate * 100).toFixed(2)}% overall match rate`,
      diagnostics: {
        overallMatchRate: report.summary.overallMatchRate,
        alerts: report.summary.alerts,
      },
    });
  } catch (error) {
    entries.push({
      id: 'cross:error',
      name: 'Cross-Validation',
      status: 'fail',
      message: `Failed to run cross-validation: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }

  return entries;
}

/**
 * Validate coverage gaps
 */
function validateCoverage(layer: ValidatableLayer): ValidationEntry[] {
  const entries: ValidationEntry[] = [];
  const missing = validateCanonicalCoverage(layer);

  if (missing.length === 0) {
    entries.push({
      id: `coverage:${layer}`,
      name: `Coverage: ${layer.toUpperCase()}`,
      status: 'pass',
      message: 'All applicable states covered',
    });
  } else {
    entries.push({
      id: `coverage:${layer}`,
      name: `Coverage: ${layer.toUpperCase()}`,
      status: 'fail',
      message: `Missing ${missing.length} states: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''}`,
      diagnostics: {
        missingStates: missing,
      },
      remediation: 'Extract missing state data from TIGER',
    });
  }

  return entries;
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const options = parseArgs();
  let entries: ValidationEntry[] = [];

  // Validate layer option
  if (options.layer && !Object.keys(GEOID_FORMATS).includes(options.layer)) {
    console.error(`Error: Invalid layer '${options.layer}'. Must be one of: ${Object.keys(GEOID_FORMATS).join(', ')}`);
    process.exit(3);
  }

  // Validate state format
  if (options.state && !/^\d{2}$/.test(options.state)) {
    console.error(`Error: Invalid state FIPS '${options.state}'. Must be 2 digits.`);
    process.exit(3);
  }

  try {
    if (options.crossValidate) {
      // Cross-validation mode
      entries = await runCrossValidation(options);
    } else if (options.layer) {
      // Single layer validation
      entries = validateSingleLayer(options.layer, options.state);

      // Add coverage check
      const coverageEntries = validateCoverage(options.layer);
      entries.push(...coverageEntries);
    } else {
      // Full validation of all layers
      console.error('Validating all GEOID layers...\n');
      const report = validateAllCanonicalGEOIDs();
      entries = toValidationEntries(report);
    }

    // Build and format report
    const report = buildReport(
      'GEOID Validation',
      options.layer ?? 'all',
      entries,
      {
        layer: options.layer,
        state: options.state,
        crossValidate: options.crossValidate,
      }
    );

    const output = formatReport(report, options.format, { verbose: options.verbose });
    console.log(output);

    // Exit with appropriate code
    process.exit(getExitCode(report.overallStatus));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(4);
  }
}

// Export for programmatic use
export { validateSingleLayer, runCrossValidation, validateCoverage };
export type { GeoidValidateOptions };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
