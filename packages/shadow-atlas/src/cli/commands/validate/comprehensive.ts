#!/usr/bin/env tsx
/**
 * Comprehensive Validation Command
 *
 * Runs all validation suites and generates a production readiness report.
 *
 * OUTPUT SECTIONS:
 *   - GEOID validation: Format, coverage, count checks
 *   - TIGER cross-validation: Canonical vs actual GEOID comparison
 *   - Freshness monitoring: Staleness alerts
 *   - VTD coverage: Voting tabulation district coverage
 *   - Production readiness: Overall deployment assessment
 *
 * Usage:
 *   shadow-atlas validate comprehensive
 *   shadow-atlas validate comprehensive --include-cross
 *   shadow-atlas validate comprehensive --output report.json
 */

import { writeFileSync } from 'node:fs';
import {
  generateComprehensiveReport,
  generateComprehensiveReportText,
  type ComprehensiveValidationReport,
  type ComprehensiveReportOptions,
} from '../../../validators/geoid/validation-suite.js';
import {
  buildReport,
  formatReport,
  getExitCode,
  type ValidationEntry,
  type OutputFormat,
  type ValidationStatus,
} from '../../lib/validation-report.js';

// =============================================================================
// Types
// =============================================================================

interface ComprehensiveValidateOptions {
  includeCross: boolean;
  includeFreshness: boolean;
  includeVtd: boolean;
  output?: string;
  format: OutputFormat;
  verbose: boolean;
  json: boolean;
}

// =============================================================================
// CLI Argument Parser
// =============================================================================

function parseArgs(): ComprehensiveValidateOptions {
  const args = process.argv.slice(2);
  const options: ComprehensiveValidateOptions = {
    includeCross: false,
    includeFreshness: false,
    includeVtd: true, // VTD is included by default
    format: 'table',
    verbose: false,
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--include-cross':
        options.includeCross = true;
        break;
      case '--include-freshness':
        options.includeFreshness = true;
        break;
      case '--include-vtd':
        options.includeVtd = true;
        break;
      case '--full':
        options.includeCross = true;
        options.includeFreshness = true;
        options.includeVtd = true;
        break;
      case '--output':
      case '-o':
        options.output = args[++i];
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
Comprehensive Validation

Usage:
  shadow-atlas validate comprehensive [options]

Options:
  --include-cross      Include TIGER cross-validation (slower)
  --include-freshness  Include freshness monitoring (requires network)
  --include-vtd        Include VTD coverage checks (default: true)
  --full               Include all subsystems
  --output, -o <file>  Write report to file
  --format <fmt>       Output format: table|json|csv|summary
  --json               Output as JSON (shorthand for --format json)
  --verbose, -v        Include detailed per-state results
  --help, -h           Show this help

Output Sections:
  - GEOID validation: Format, coverage, count checks
  - TIGER cross-validation: Canonical vs actual comparison
  - Freshness monitoring: Staleness alerts
  - VTD coverage: Voting tabulation district coverage
  - Production readiness: Overall deployment assessment

Examples:
  shadow-atlas validate comprehensive
  shadow-atlas validate comprehensive --include-cross
  shadow-atlas validate comprehensive --full --output report.json
  shadow-atlas validate comprehensive --json > report.json
`);
}

// =============================================================================
// Report Conversion
// =============================================================================

/**
 * Convert comprehensive report to validation entries
 */
function toValidationEntries(report: ComprehensiveValidationReport): ValidationEntry[] {
  const entries: ValidationEntry[] = [];

  // Production readiness summary (first)
  entries.push({
    id: 'readiness',
    name: 'Production Readiness',
    status: report.readiness.status === 'production-ready' ? 'pass' :
            report.readiness.status === 'needs-review' ? 'warn' : 'fail',
    message: report.readiness.status.toUpperCase(),
    diagnostics: {
      blockers: report.readiness.blockers,
      warnings: report.readiness.warnings,
    },
  });

  // GEOID validation section
  const geoidStatus = report.summary.overallStatus === 'PASS' ? 'pass' :
                      report.summary.overallStatus === 'WARNING' ? 'warn' : 'fail';
  entries.push({
    id: 'geoid',
    name: 'GEOID Validation',
    status: geoidStatus,
    message: `${report.summary.layersPassed}/${report.summary.layersValidated} layers, ${report.summary.totalStatesPassed}/${report.summary.totalStatesValidated} states`,
    diagnostics: {
      layersPassed: report.summary.layersPassed,
      layersValidated: report.summary.layersValidated,
      totalStatesPassed: report.summary.totalStatesPassed,
      totalStatesValidated: report.summary.totalStatesValidated,
    },
  });

  // Per-layer GEOID results
  for (const layer of report.layers) {
    const layerStatus = layer.status === 'PASS' ? 'pass' :
                        layer.status === 'WARNING' ? 'warn' : 'fail';
    entries.push({
      id: `geoid:${layer.layer}`,
      name: `  ${layer.layer.toUpperCase()}`,
      status: layerStatus,
      message: `${layer.statesPassed}/${layer.statesValidated} states, ${layer.totalGEOIDs.toLocaleString()} GEOIDs`,
      diagnostics: {
        totalGEOIDs: layer.totalGEOIDs,
        totalExpected: layer.totalExpected,
      },
    });
  }

  // Cross-validation section
  const crossStatus = report.crossValidation.overallMatchRate >= 0.99 ? 'pass' :
                      report.crossValidation.overallMatchRate >= 0.95 ? 'warn' : 'fail';
  entries.push({
    id: 'cross-validation',
    name: 'TIGER Cross-Validation',
    status: crossStatus,
    message: `${(report.crossValidation.overallMatchRate * 100).toFixed(2)}% match rate`,
    diagnostics: {
      overallMatchRate: report.crossValidation.overallMatchRate,
      lastChecked: report.crossValidation.lastChecked,
      alerts: report.crossValidation.alerts,
    },
  });

  // Per-layer cross-validation
  for (const [layer, rate] of Object.entries(report.crossValidation.tigerMatch)) {
    if (rate !== undefined) {
      const layerStatus = rate >= 0.99 ? 'pass' : rate >= 0.95 ? 'warn' : 'fail';
      entries.push({
        id: `cross:${layer}`,
        name: `  ${layer.toUpperCase()}`,
        status: layerStatus,
        message: `${(rate * 100).toFixed(1)}% match`,
      });
    }
  }

  // Freshness section
  const staleCount = report.freshness.staleJurisdictions.length;
  const freshnessStatus = staleCount === 0 ? 'pass' : staleCount <= 5 ? 'warn' : 'fail';
  entries.push({
    id: 'freshness',
    name: 'Freshness Monitoring',
    status: freshnessStatus,
    message: `${staleCount} stale jurisdictions`,
    diagnostics: {
      staleCount,
      boundaryTypesAudited: report.freshness.boundaryTypesAudited.length,
      lastAudit: report.freshness.lastAudit,
    },
  });

  // VTD coverage section
  const vtdCoverageRate = report.coverage.vtdStatesExtracted / 50;
  const vtdStatus = vtdCoverageRate >= 0.95 ? 'pass' : vtdCoverageRate >= 0.80 ? 'warn' : 'fail';
  entries.push({
    id: 'vtd-coverage',
    name: 'VTD Coverage',
    status: vtdStatus,
    message: `${report.coverage.vtdStatesExtracted}/50 states, ${report.coverage.vtdTotalExtracted.toLocaleString()} VTDs`,
    diagnostics: {
      statesExtracted: report.coverage.vtdStatesExtracted,
      totalExtracted: report.coverage.vtdTotalExtracted,
      gapCount: report.coverage.vtdMissingStates.length,
      gaps: report.coverage.vtdMissingStates,
    },
  });

  // Add blockers and warnings as entries
  for (const blocker of report.readiness.blockers) {
    entries.push({
      id: `blocker:${entries.length}`,
      name: 'BLOCKER',
      status: 'fail',
      message: blocker,
    });
  }

  for (const warning of report.readiness.warnings) {
    entries.push({
      id: `warning:${entries.length}`,
      name: 'WARNING',
      status: 'warn',
      message: warning,
    });
  }

  return entries;
}

/**
 * Format comprehensive report as custom text output
 */
function formatComprehensiveText(report: ComprehensiveValidationReport): string {
  // Use the existing comprehensive report formatter
  return generateComprehensiveReportText(report);
}

/**
 * Format comprehensive report as JSON
 */
function formatComprehensiveJson(report: ComprehensiveValidationReport, verbose: boolean): string {
  if (verbose) {
    return JSON.stringify(report, null, 2);
  }

  // Non-verbose: summary only
  return JSON.stringify({
    timestamp: report.timestamp,
    readiness: report.readiness,
    summary: {
      geoid: {
        status: report.summary.overallStatus,
        layersPassed: report.summary.layersPassed,
        layersValidated: report.summary.layersValidated,
      },
      crossValidation: {
        matchRate: report.crossValidation.overallMatchRate,
        alertCount: report.crossValidation.alerts.length,
      },
      freshness: {
        staleCount: report.freshness.staleJurisdictions.length,
      },
      vtdCoverage: {
        statesExtracted: report.coverage.vtdStatesExtracted,
        totalVTDs: report.coverage.vtdTotalExtracted,
      },
    },
  }, null, 2);
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const options = parseArgs();

  console.error('Generating comprehensive validation report...\n');

  // Log which subsystems will be included
  if (options.includeCross) {
    console.error('  [*] Including TIGER cross-validation (may take several minutes)');
  }
  if (options.includeFreshness) {
    console.error('  [*] Including freshness audit (requires network)');
  }
  if (options.includeVtd) {
    console.error('  [*] Including VTD coverage analysis');
  }
  console.error('');

  const startTime = Date.now();

  try {
    // Generate comprehensive report
    const reportOptions: ComprehensiveReportOptions = {
      includeCrossValidation: options.includeCross,
      includeFreshnessAudit: options.includeFreshness,
    };

    const comprehensiveReport = await generateComprehensiveReport(reportOptions);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`Report generated in ${elapsed}s\n`);

    // Format output
    let output: string;

    if (options.format === 'json' || options.json) {
      output = formatComprehensiveJson(comprehensiveReport, options.verbose);
    } else if (options.format === 'table') {
      output = formatComprehensiveText(comprehensiveReport);
    } else {
      // For other formats, convert to validation entries and use standard formatter
      const entries = toValidationEntries(comprehensiveReport);
      const report = buildReport(
        'Comprehensive Validation',
        'full',
        entries,
        {
          includeCross: options.includeCross,
          includeFreshness: options.includeFreshness,
          includeVtd: options.includeVtd,
        }
      );
      output = formatReport(report, options.format, { verbose: options.verbose });
    }

    // Write to file if specified
    if (options.output) {
      writeFileSync(options.output, output, 'utf-8');
      console.error(`Report written to ${options.output}`);
    } else {
      console.log(output);
    }

    // Exit with appropriate code
    const exitCode = comprehensiveReport.readiness.status === 'production-ready' ? 0 :
                     comprehensiveReport.readiness.status === 'needs-review' ? 1 : 2;
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(4);
  }
}

// Export for programmatic use
export { toValidationEntries, formatComprehensiveText, formatComprehensiveJson };
export type { ComprehensiveValidateOptions };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
