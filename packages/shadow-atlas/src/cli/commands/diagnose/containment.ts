#!/usr/bin/env npx tsx
/**
 * Diagnose Containment Command
 *
 * Analyze containment failures for a city - detect when districts extend
 * beyond the city boundary.
 *
 * USAGE:
 *   shadow-atlas diagnose containment <fips> [options]
 *
 * OPTIONS:
 *   --url <url>           Override download URL
 *   --boundary-source     Boundary source: tiger or authoritative
 *   --output <file>       Write detailed report to file
 *
 * EXAMPLES:
 *   shadow-atlas diagnose containment 0666000
 *   shadow-atlas diagnose containment 0666000 --boundary-source authoritative
 *   shadow-atlas diagnose containment 0666000 --output report.md
 *
 * @module cli/commands/diagnose/containment
 */

import { writeFile } from 'node:fs/promises';
import {
  analyzeContainment,
  type ContainmentReport,
  type BoundarySource,
} from '../../lib/diagnostics.js';

// ============================================================================
// Types
// ============================================================================

export interface ContainmentOptions {
  readonly fips: string;
  readonly url?: string;
  readonly boundarySource?: BoundarySource;
  readonly output?: string;
  readonly verbose?: boolean;
  readonly json?: boolean;
}

export interface ContainmentResult {
  readonly success: boolean;
  readonly report?: ContainmentReport;
  readonly error?: string;
}

// ============================================================================
// Command Implementation
// ============================================================================

/**
 * Run the containment command
 */
export async function runContainment(options: ContainmentOptions): Promise<ContainmentResult> {
  const { fips, url, boundarySource, output, verbose = false, json = false } = options;

  if (!json) {
    console.log(`Analyzing containment for FIPS ${fips}...\n`);
  }

  try {
    const report = await analyzeContainment(fips, { url, boundarySource });

    if (!json) {
      printReport(report, verbose);

      // Write to output file if specified
      if (output) {
        const content = formatReportMarkdown(report);
        await writeFile(output, content, 'utf-8');
        console.log(`\nReport written to: ${output}`);
      }
    }

    if (json) {
      console.log(JSON.stringify({ success: true, report }, null, 2));
    }

    return { success: report.verdict !== 'fail', report };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (!json) {
      console.error(`Containment analysis failed: ${errorMessage}`);
    }

    if (json) {
      console.log(JSON.stringify({ success: false, error: errorMessage }, null, 2));
    }

    return { success: false, error: errorMessage };
  }
}

/**
 * Print containment report to console
 */
function printReport(report: ContainmentReport, verbose: boolean): void {
  const verdictIcons = { pass: '[PASS]', fail: '[FAIL]', warn: '[WARN]' };
  const verdictIcon = verdictIcons[report.verdict];

  console.log('Containment Analysis Report');
  console.log('===========================\n');

  console.log(`City: ${report.cityName}, ${report.state}`);
  console.log(`FIPS: ${report.fips}`);
  console.log(`Boundary Source: ${report.boundarySource}`);
  console.log(`URL: ${report.url}`);
  console.log('');

  console.log('Analysis Results:');
  console.log(`  Total Features: ${report.analysis.totalFeatures}`);
  console.log(`  Total District Area: ${formatArea(report.analysis.totalDistrictArea)}`);
  console.log(`  City Boundary Area: ${formatArea(report.analysis.cityBoundaryArea)}`);
  console.log(`  Outside Area: ${formatArea(report.analysis.outsideArea)}`);
  console.log(`  Outside Percentage: ${report.analysis.outsidePercentage.toFixed(2)}%`);
  console.log('');

  if (verbose && report.analysis.districtBreakdown.length > 0) {
    console.log('District Breakdown:');
    for (const district of report.analysis.districtBreakdown) {
      const name = district.districtName || district.districtId;
      console.log(`  ${name}:`);
      console.log(`    Area: ${formatArea(district.area)}`);
      console.log(`    Outside: ${formatArea(district.outsideArea)} (${district.outsidePercentage.toFixed(2)}%)`);
    }
    console.log('');
  }

  console.log(`Verdict: ${verdictIcon}`);
  console.log('');

  if (report.remediation.length > 0) {
    console.log('Remediation Suggestions:');
    for (const suggestion of report.remediation) {
      console.log(`  - ${suggestion}`);
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
 * Format report as Markdown
 */
function formatReportMarkdown(report: ContainmentReport): string {
  const verdictBadge = report.verdict === 'pass'
    ? 'PASS'
    : report.verdict === 'fail'
      ? 'FAIL'
      : 'WARN';

  let md = `# Containment Analysis Report

**City:** ${report.cityName}, ${report.state}
**FIPS:** ${report.fips}
**Boundary Source:** ${report.boundarySource}
**Verdict:** ${verdictBadge}

## Overview

| Metric | Value |
|--------|-------|
| Total Features | ${report.analysis.totalFeatures} |
| Total District Area | ${formatArea(report.analysis.totalDistrictArea)} |
| City Boundary Area | ${formatArea(report.analysis.cityBoundaryArea)} |
| Outside Area | ${formatArea(report.analysis.outsideArea)} |
| Outside Percentage | ${report.analysis.outsidePercentage.toFixed(2)}% |

## Source URL

\`\`\`
${report.url}
\`\`\`

`;

  if (report.analysis.districtBreakdown.length > 0) {
    md += `## District Breakdown

| District | Area | Outside Area | Outside % |
|----------|------|--------------|-----------|
`;
    for (const d of report.analysis.districtBreakdown) {
      const name = d.districtName || d.districtId;
      md += `| ${name} | ${formatArea(d.area)} | ${formatArea(d.outsideArea)} | ${d.outsidePercentage.toFixed(2)}% |\n`;
    }
    md += '\n';
  }

  if (report.remediation.length > 0) {
    md += `## Remediation Suggestions

`;
    for (const suggestion of report.remediation) {
      md += `- ${suggestion}\n`;
    }
  }

  md += `\n---\n*Generated: ${new Date().toISOString()}*\n`;

  return md;
}

// ============================================================================
// CLI Entry Point
// ============================================================================

function parseArgs(args: readonly string[]): ContainmentOptions | null {
  let fips: string | undefined;
  let url: string | undefined;
  let boundarySource: BoundarySource | undefined;
  let output: string | undefined;
  let verbose = false;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--url':
        url = args[++i];
        break;

      case '--boundary-source':
        const sourceValue = args[++i];
        if (sourceValue !== 'tiger' && sourceValue !== 'authoritative') {
          console.error('Error: --boundary-source must be "tiger" or "authoritative"');
          process.exit(1);
        }
        boundarySource = sourceValue;
        break;

      case '--output':
        output = args[++i];
        break;

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
    console.error('Usage: shadow-atlas diagnose containment <fips> [options]');
    process.exit(1);
  }

  // Validate FIPS format (7 digits)
  if (!/^\d{7}$/.test(fips)) {
    console.error('Error: FIPS must be a 7-digit Census PLACE code');
    process.exit(1);
  }

  return { fips, url, boundarySource, output, verbose, json };
}

function printHelp(): void {
  console.log(`
shadow-atlas diagnose containment - Analyze containment failures

USAGE:
  shadow-atlas diagnose containment <fips> [options]

ARGUMENTS:
  fips                  7-digit Census PLACE FIPS code

OPTIONS:
  --url <url>           Override the download URL from registry
  --boundary-source <s> Boundary source: tiger (default) or authoritative
  --output <file>       Write detailed Markdown report to file
  --verbose, -v         Show detailed district breakdown
  --json                Output results as JSON
  --help, -h            Show this help message

CONTAINMENT THRESHOLD:
  Districts should have less than 15% of their area outside the city boundary.
  Exceeding this threshold indicates potential data quality issues.

COMMON CAUSES:
  - Wrong data source (county/regional data instead of city)
  - Outdated boundaries (annexations, boundary changes)
  - ETL errors (coordinate projection issues)

EXAMPLES:
  # Basic containment check
  shadow-atlas diagnose containment 0666000

  # Use authoritative boundary instead of TIGER
  shadow-atlas diagnose containment 0666000 --boundary-source authoritative

  # Generate detailed report
  shadow-atlas diagnose containment 0666000 --output sf-containment.md --verbose
`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options) {
    runContainment(options)
      .then((result) => {
        process.exit(result.success ? 0 : 1);
      })
      .catch((error) => {
        console.error('Containment analysis failed:', error);
        process.exit(1);
      });
  }
}
