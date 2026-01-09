#!/usr/bin/env npx tsx
/**
 * Freshness Audit CLI
 *
 * CLI tool to audit Shadow Atlas data freshness against authoritative primary sources.
 * Uses HTTP HEAD requests to compare TIGER data freshness against state redistricting
 * commissions during redistricting years.
 *
 * USAGE:
 *   npx tsx src/scripts/freshness-audit.ts
 *   npx tsx src/scripts/freshness-audit.ts --verbose
 *   npx tsx src/scripts/freshness-audit.ts --type=congressional
 *   npx tsx src/scripts/freshness-audit.ts --json
 *
 * EXIT CODES:
 *   0 = All data fresh
 *   1 = Some stale data (warnings, <90 days)
 *   2 = Critical staleness (>90 days)
 *
 * Last Updated: 2026-01-09
 */

import {
  PrimarySourceComparator,
  type BoundaryType,
  type FreshnessAlert,
} from '../provenance/primary-comparator.js';

/**
 * CLI options interface
 */
interface CliOptions {
  readonly boundaryType?: BoundaryType;
  readonly verbose: boolean;
  readonly json: boolean;
}

/**
 * All valid boundary types
 */
const VALID_BOUNDARY_TYPES: readonly BoundaryType[] = [
  'congressional',
  'state_senate',
  'state_house',
  'county',
  'place',
  'city_council',
  'school_unified',
  'voting_precinct',
  'special_district',
] as const;

/**
 * Threshold for critical staleness (days)
 */
const CRITICAL_STALENESS_THRESHOLD = 90;

/**
 * Parse command line arguments
 */
function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let verbose = false;
  let boundaryType: BoundaryType | undefined;
  let json = false;

  for (const arg of args) {
    if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg.startsWith('--type=')) {
      const typeValue = arg.split('=')[1] as BoundaryType;
      if (VALID_BOUNDARY_TYPES.includes(typeValue)) {
        boundaryType = typeValue;
      } else {
        console.error(`Invalid boundary type: ${typeValue}`);
        console.error(`Valid types: ${VALID_BOUNDARY_TYPES.join(', ')}`);
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

  return { boundaryType, verbose, json };
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Shadow Atlas Freshness Audit Tool

USAGE:
  npx tsx src/scripts/freshness-audit.ts [OPTIONS]

OPTIONS:
  --type=<boundary_type>  Audit specific boundary type only
  --verbose, -v           Show detailed output including fresh jurisdictions
  --json                  Output results as JSON
  --help, -h              Show this help message

BOUNDARY TYPES:
  congressional       Congressional Districts
  state_senate        State Senate Districts
  state_house         State House Districts
  county              Counties
  place               Census Places
  city_council        City Council Districts
  school_unified      Unified School Districts
  voting_precinct     Voting Precincts
  special_district    Special Districts

EXAMPLES:
  # Audit all boundary types
  npx tsx src/scripts/freshness-audit.ts

  # Audit with verbose output
  npx tsx src/scripts/freshness-audit.ts --verbose

  # Audit only congressional districts
  npx tsx src/scripts/freshness-audit.ts --type=congressional

  # Output JSON for CI integration
  npx tsx src/scripts/freshness-audit.ts --json

EXIT CODES:
  0  All data fresh
  1  Some stale data (warnings, <90 days)
  2  Critical staleness (>90 days)
`);
}

/**
 * Format date for display
 */
function formatDate(date: Date | null): string {
  if (!date) {
    return 'unknown';
  }
  return date.toISOString().split('T')[0];
}

/**
 * Group alerts by staleness status
 */
interface GroupedAlerts {
  readonly stale: readonly FreshnessAlert[];
  readonly manualReview: readonly FreshnessAlert[];
}

function groupAlerts(alerts: readonly FreshnessAlert[]): GroupedAlerts {
  const stale: FreshnessAlert[] = [];
  const manualReview: FreshnessAlert[] = [];

  for (const alert of alerts) {
    if (alert.recommendation === 'manual-review') {
      manualReview.push(alert);
    } else {
      stale.push(alert);
    }
  }

  return { stale, manualReview };
}

/**
 * Get states without alerts (fresh states)
 * Uses the static method from PrimarySourceComparator
 */
function getFreshStates(
  boundaryType: BoundaryType,
  alerts: readonly FreshnessAlert[]
): readonly string[] {
  const statesWithPrimarySources =
    PrimarySourceComparator.getStatesWithPrimarySources(boundaryType);
  const staleJurisdictions = new Set(alerts.map((a) => a.jurisdiction));

  return statesWithPrimarySources.filter(
    (state) => !staleJurisdictions.has(state)
  );
}

/**
 * Print report for a single boundary type
 */
function printBoundaryTypeReport(
  boundaryType: BoundaryType,
  alerts: readonly FreshnessAlert[],
  verbose: boolean
): void {
  const grouped = groupAlerts(alerts);
  const freshStates = getFreshStates(boundaryType, alerts);
  const totalStates = freshStates.length + alerts.length;

  console.log(`\nBoundary Type: ${boundaryType}`);
  console.log('-'.repeat(40));

  // Fresh states
  if (freshStates.length > 0) {
    console.log(`\n  FRESH (${freshStates.length} states)`);
    if (verbose) {
      console.log(`     ${freshStates.join(', ')}`);
    }
  }

  // Stale states (use-primary recommendation)
  if (grouped.stale.length > 0) {
    console.log(`\n  STALE - Use Primary (${grouped.stale.length} states):`);
    for (const alert of grouped.stale) {
      const staleDaysDisplay =
        alert.staleDays > 0 ? `${alert.staleDays} days stale` : 'staleness unknown';
      const lastModifiedDisplay = alert.lastModified
        ? `last modified: ${formatDate(alert.lastModified)}`
        : 'no modification date';

      console.log(`     ${alert.jurisdiction}: ${staleDaysDisplay} (${lastModifiedDisplay})`);
      console.log(`        Recommendation: ${alert.recommendation}`);
      console.log(`        Reason: ${alert.reason}`);
    }
  }

  // Manual review states
  if (grouped.manualReview.length > 0) {
    console.log(`\n  MANUAL REVIEW (${grouped.manualReview.length} states):`);
    for (const alert of grouped.manualReview) {
      console.log(`     ${alert.jurisdiction}: ${alert.reason}`);
    }
  }

  // Summary line
  const staleCount = grouped.stale.length + grouped.manualReview.length;
  const summaryParts: string[] = [];
  summaryParts.push(`${freshStates.length}/${totalStates} fresh`);
  if (grouped.stale.length > 0) {
    summaryParts.push(`${grouped.stale.length} stale`);
  }
  if (grouped.manualReview.length > 0) {
    summaryParts.push(`${grouped.manualReview.length} manual review`);
  }

  console.log(`\n  Summary: ${summaryParts.join(', ')}`);
}

/**
 * Audit report interface for JSON output
 */
interface AuditReport {
  readonly timestamp: string;
  readonly boundaryTypes: ReadonlyArray<{
    readonly type: BoundaryType;
    readonly alerts: readonly FreshnessAlert[];
    readonly freshStates: readonly string[];
    readonly summary: {
      readonly totalStates: number;
      readonly freshCount: number;
      readonly staleCount: number;
      readonly manualReviewCount: number;
    };
  }>;
  readonly overall: {
    readonly totalAlerts: number;
    readonly criticalAlerts: number;
    readonly maxStaleDays: number;
    readonly status: 'fresh' | 'warning' | 'critical';
  };
}

/**
 * Build audit report for JSON output
 */
function buildAuditReport(
  results: Map<BoundaryType, FreshnessAlert[]>
): AuditReport {
  let totalAlerts = 0;
  let criticalAlerts = 0;
  let maxStaleDays = 0;

  const boundaryTypes = Array.from(results.entries()).map(
    ([boundaryType, alerts]) => {
      const grouped = groupAlerts(alerts);
      const freshStates = getFreshStates(boundaryType, alerts);
      const totalStates = freshStates.length + alerts.length;

      totalAlerts += alerts.length;
      for (const alert of alerts) {
        if (alert.staleDays > CRITICAL_STALENESS_THRESHOLD) {
          criticalAlerts++;
        }
        if (alert.staleDays > maxStaleDays) {
          maxStaleDays = alert.staleDays;
        }
      }

      return {
        type: boundaryType,
        alerts,
        freshStates,
        summary: {
          totalStates,
          freshCount: freshStates.length,
          staleCount: grouped.stale.length,
          manualReviewCount: grouped.manualReview.length,
        },
      };
    }
  );

  const status: 'fresh' | 'warning' | 'critical' =
    criticalAlerts > 0 ? 'critical' : totalAlerts > 0 ? 'warning' : 'fresh';

  return {
    timestamp: new Date().toISOString(),
    boundaryTypes,
    overall: {
      totalAlerts,
      criticalAlerts,
      maxStaleDays,
      status,
    },
  };
}

/**
 * Print full text report
 */
function printFullReport(
  results: Map<BoundaryType, FreshnessAlert[]>,
  verbose: boolean
): void {
  console.log('='.repeat(80));
  console.log('FRESHNESS AUDIT REPORT');
  console.log('='.repeat(80));

  for (const [boundaryType, alerts] of results) {
    printBoundaryTypeReport(boundaryType, alerts, verbose);
  }

  // Overall summary
  const report = buildAuditReport(results);

  console.log('\n' + '='.repeat(80));
  console.log('OVERALL SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total alerts: ${report.overall.totalAlerts}`);
  console.log(`Critical alerts (>${CRITICAL_STALENESS_THRESHOLD} days): ${report.overall.criticalAlerts}`);
  console.log(`Max stale days: ${report.overall.maxStaleDays}`);
  console.log(`Status: ${report.overall.status.toUpperCase()}`);
  console.log('='.repeat(80));
}

/**
 * Calculate exit code based on audit results
 */
function calculateExitCode(results: Map<BoundaryType, FreshnessAlert[]>): number {
  let hasCritical = false;
  let hasWarning = false;

  for (const alerts of results.values()) {
    for (const alert of alerts) {
      if (alert.staleDays > CRITICAL_STALENESS_THRESHOLD) {
        hasCritical = true;
      } else if (alert.staleDays > 0 || alert.recommendation !== 'use-tiger') {
        hasWarning = true;
      }
    }
  }

  if (hasCritical) {
    return 2;
  }
  if (hasWarning) {
    return 1;
  }
  return 0;
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  const options = parseArgs();
  const comparator = new PrimarySourceComparator();

  // Run audit
  let results: Map<BoundaryType, FreshnessAlert[]>;

  if (options.boundaryType) {
    // Single boundary type audit
    if (!options.json) {
      console.log(`\nAuditing freshness for: ${options.boundaryType}...`);
    }
    const alerts = await comparator.runFreshnessAudit(options.boundaryType);
    results = new Map([[options.boundaryType, alerts]]);
  } else {
    // Full audit
    if (!options.json) {
      console.log('\nRunning full freshness audit...');
    }
    results = await comparator.runFullAudit();
  }

  // Output results
  if (options.json) {
    const report = buildAuditReport(results);
    console.log(JSON.stringify(report, null, 2));
  } else {
    printFullReport(results, options.verbose);
  }

  // Exit with appropriate code
  const exitCode = calculateExitCode(results);
  process.exit(exitCode);
}

// Run if called directly
if (import.meta.url.startsWith('file:')) {
  const modulePath = new URL(import.meta.url).pathname;
  const scriptPath = process.argv[1];
  if (
    modulePath === scriptPath ||
    process.argv[1]?.endsWith('freshness-audit.ts')
  ) {
    main().catch((error: unknown) => {
      console.error(
        'Fatal error:',
        error instanceof Error ? error.message : 'Unknown error'
      );
      process.exit(2);
    });
  }
}
