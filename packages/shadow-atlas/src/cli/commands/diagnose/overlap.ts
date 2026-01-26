#!/usr/bin/env npx tsx
/**
 * Diagnose Overlap Command
 *
 * Detect overlapping districts for a city.
 *
 * USAGE:
 *   shadow-atlas diagnose overlap <fips> [options]
 *
 * OPTIONS:
 *   --verbose, -v       Show detailed overlap information
 *
 * EXAMPLES:
 *   shadow-atlas diagnose overlap 0666000
 *   shadow-atlas diagnose overlap 0666000 --verbose
 *
 * @module cli/commands/diagnose/overlap
 */

import {
  detectOverlaps,
  type OverlapReport,
} from '../../lib/diagnostics.js';

// ============================================================================
// Types
// ============================================================================

export interface OverlapOptions {
  readonly fips: string;
  readonly verbose?: boolean;
  readonly json?: boolean;
}

export interface OverlapResult {
  readonly success: boolean;
  readonly report?: OverlapReport;
  readonly error?: string;
}

// ============================================================================
// Command Implementation
// ============================================================================

/**
 * Run the overlap command
 */
export async function runOverlap(options: OverlapOptions): Promise<OverlapResult> {
  const { fips, verbose = false, json = false } = options;

  if (!json) {
    console.log(`Detecting overlaps for FIPS ${fips}...\n`);
  }

  try {
    const report = await detectOverlaps(fips);

    if (!json) {
      printReport(report, verbose);
    }

    if (json) {
      console.log(JSON.stringify({ success: true, report }, null, 2));
    }

    return { success: report.verdict !== 'fail', report };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (!json) {
      console.error(`Overlap detection failed: ${errorMessage}`);
    }

    if (json) {
      console.log(JSON.stringify({ success: false, error: errorMessage }, null, 2));
    }

    return { success: false, error: errorMessage };
  }
}

/**
 * Print overlap report to console
 */
function printReport(report: OverlapReport, verbose: boolean): void {
  const verdictIcons = { pass: '[PASS]', fail: '[FAIL]', warn: '[WARN]' };
  const verdictIcon = verdictIcons[report.verdict];

  console.log('Overlap Detection Report');
  console.log('========================\n');

  console.log(`City: ${report.cityName}, ${report.state}`);
  console.log(`FIPS: ${report.fips}`);
  console.log('');

  console.log('Analysis Results:');
  console.log(`  Total Districts: ${report.analysis.totalDistricts}`);
  console.log(`  Overlapping Pairs: ${report.analysis.overlappingPairs.length}`);
  console.log(`  Max Overlap Area: ${formatArea(report.analysis.maxOverlapArea)}`);
  console.log(`  Problematic Overlaps: ${report.analysis.hasProblematicOverlaps ? 'Yes' : 'No'}`);
  console.log('');

  if (report.analysis.overlappingPairs.length > 0) {
    console.log('Overlapping District Pairs:');
    for (const pair of report.analysis.overlappingPairs) {
      console.log(`  ${pair.district1} <-> ${pair.district2}:`);
      console.log(`    Overlap Area: ${formatArea(pair.overlapArea)}`);
      console.log(`    Overlap Percentage: ${pair.overlapPercentage.toFixed(2)}%`);
    }
    console.log('');
  }

  if (verbose && report.analysis.overlapMatrix.length > 0) {
    console.log('Overlap Matrix (sq m):');
    printMatrix(report.analysis.overlapMatrix, report.analysis.totalDistricts);
    console.log('');
  }

  console.log(`Verdict: ${verdictIcon}`);
  console.log('');

  if (report.notes.length > 0) {
    console.log('Notes:');
    for (const note of report.notes) {
      console.log(`  - ${note}`);
    }
  }
}

/**
 * Format area in square meters/kilometers
 */
function formatArea(sqm: number): string {
  if (sqm === 0) return '0 sq m';
  if (sqm < 1000000) return `${sqm.toLocaleString()} sq m`;
  return `${(sqm / 1000000).toFixed(2)} sq km`;
}

/**
 * Print overlap matrix
 */
function printMatrix(matrix: readonly readonly number[][], districts: number): void {
  if (matrix.length === 0 || districts === 0) return;

  // Header row
  const header = '     ' + Array.from({ length: districts }, (_, i) => (i + 1).toString().padStart(6)).join('');
  console.log(header);

  // Data rows
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const row = matrix[i];
    if (!row) continue;

    const rowStr = (i + 1).toString().padStart(4) + ' ' +
      row.slice(0, 10).map(v => (v > 0 ? v.toFixed(0) : '-').padStart(6)).join('');
    console.log(rowStr);
  }

  if (districts > 10) {
    console.log('  ... (matrix truncated, showing first 10x10)');
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

function parseArgs(args: readonly string[]): OverlapOptions | null {
  let fips: string | undefined;
  let verbose = false;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--verbose':
      case '-v':
        verbose = true;
        break;

      case '--json':
        json = true;
        break;

      case '--help':
      case '-h':
        printHelp();
        process.exit(0);

      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
        // Positional argument: FIPS
        if (!fips) {
          fips = arg;
        } else {
          console.error(`Unexpected argument: ${arg}`);
          process.exit(1);
        }
    }
  }

  if (!fips) {
    console.error('Error: FIPS code is required.');
    console.error('Usage: shadow-atlas diagnose overlap <fips> [options]');
    process.exit(1);
  }

  // Validate FIPS format (7 digits)
  if (!/^\d{7}$/.test(fips)) {
    console.error('Error: FIPS must be a 7-digit Census PLACE code');
    process.exit(1);
  }

  return { fips, verbose, json };
}

function printHelp(): void {
  console.log(`
shadow-atlas diagnose overlap - Detect overlapping districts

USAGE:
  shadow-atlas diagnose overlap <fips> [options]

ARGUMENTS:
  fips                  7-digit Census PLACE FIPS code

OPTIONS:
  --verbose, -v         Show overlap matrix
  --json                Output results as JSON
  --help, -h            Show this help message

OVERLAP THRESHOLD:
  Overlaps less than 150,000 sq m are considered acceptable (boundary tolerance).
  Larger overlaps indicate data quality issues.

COMMON CAUSES:
  - Topological errors in source data
  - Outdated redistricting data
  - ETL coordinate precision issues

TESSELLATION PRINCIPLE:
  Council districts should tessellate the city boundary:
  - No gaps (exhaustivity)
  - No overlaps (exclusivity)
  - Complete coverage (containment)

EXAMPLES:
  # Basic overlap check
  shadow-atlas diagnose overlap 0666000

  # Show detailed overlap matrix
  shadow-atlas diagnose overlap 0666000 --verbose
`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options) {
    runOverlap(options)
      .then((result) => {
        process.exit(result.success ? 0 : 1);
      })
      .catch((error) => {
        console.error('Overlap detection failed:', error);
        process.exit(1);
      });
  }
}
