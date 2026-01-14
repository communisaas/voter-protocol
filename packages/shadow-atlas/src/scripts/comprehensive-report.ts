#!/usr/bin/env tsx
/**
 * Comprehensive Validation Report Generator CLI
 *
 * Generates a unified validation report aggregating:
 * - GEOID format and count validation
 * - TIGER cross-validation (canonical vs actual)
 * - Freshness monitoring (staleness alerts)
 * - VTD coverage analysis
 *
 * Usage:
 *   npm run report:comprehensive           # Basic report (fast)
 *   npm run report:comprehensive:full      # Full report with all subsystems
 *   npm run report:comprehensive -- --json # Output as JSON
 *
 * Options:
 *   --full          Run full validation including cross-validation and freshness
 *   --cross         Include TIGER cross-validation only
 *   --freshness     Include freshness audit only
 *   --json          Output as JSON instead of formatted text
 *   --verbose       Include detailed per-state results
 */

import {
  generateComprehensiveReport,
  generateComprehensiveReportText,
  type ComprehensiveValidationReport,
} from '../validators/geoid/validation-suite.js';

interface CLIOptions {
  full: boolean;
  cross: boolean;
  freshness: boolean;
  json: boolean;
  verbose: boolean;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  return {
    full: args.includes('--full'),
    cross: args.includes('--cross'),
    freshness: args.includes('--freshness'),
    json: args.includes('--json'),
    verbose: args.includes('--verbose'),
  };
}

function formatJSON(report: ComprehensiveValidationReport, verbose: boolean): string {
  if (verbose) {
    return JSON.stringify(report, null, 2);
  }

  // Non-verbose: exclude large per-state results
  const summary = {
    timestamp: report.timestamp,
    readiness: report.readiness,
    geoidValidation: {
      status: report.summary.overallStatus,
      layersPassed: report.summary.layersPassed,
      layersValidated: report.summary.layersValidated,
      totalStatesPassed: report.summary.totalStatesPassed,
      totalStatesValidated: report.summary.totalStatesValidated,
    },
    crossValidation: {
      overallMatchRate: report.crossValidation.overallMatchRate,
      lastChecked: report.crossValidation.lastChecked,
      tigerMatch: report.crossValidation.tigerMatch,
      alertCount: report.crossValidation.alerts.length,
    },
    freshness: {
      lastAudit: report.freshness.lastAudit,
      boundaryTypesAudited: report.freshness.boundaryTypesAudited.length,
      staleCount: report.freshness.staleJurisdictions.length,
    },
    coverage: {
      vtdStatesExtracted: report.coverage.vtdStatesExtracted,
      vtdTotalExtracted: report.coverage.vtdTotalExtracted,
      gapCount: report.coverage.vtdMissingStates.length,
      gaps: report.coverage.vtdMissingStates,
    },
  };

  return JSON.stringify(summary, null, 2);
}

async function main(): Promise<void> {
  const options = parseArgs();

  console.log('Generating comprehensive validation report...\n');

  const startTime = Date.now();

  // Determine which subsystems to include
  const includeCrossValidation = options.full || options.cross;
  const includeFreshnessAudit = options.full || options.freshness;

  if (includeCrossValidation) {
    console.log('  [*] Including TIGER cross-validation (may take several minutes)');
  }
  if (includeFreshnessAudit) {
    console.log('  [*] Including freshness audit (requires network)');
  }

  try {
    const report = await generateComprehensiveReport({
      includeCrossValidation,
      includeFreshnessAudit,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nReport generated in ${elapsed}s\n`);

    // Output report
    if (options.json) {
      console.log(formatJSON(report, options.verbose));
    } else {
      console.log(generateComprehensiveReportText(report));
    }

    // Exit with appropriate code
    if (report.readiness.status === 'not-ready') {
      process.exit(2);
    } else if (report.readiness.status === 'needs-review') {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nError generating report: ${message}`);
    process.exit(3);
  }
}

main();
