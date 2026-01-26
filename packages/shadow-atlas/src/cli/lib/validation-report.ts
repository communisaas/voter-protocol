/**
 * Validation Report Formatter
 *
 * Shared utilities for formatting validation results across all CLI commands.
 * Supports table, JSON, and summary output modes.
 *
 * DESIGN:
 * - Consistent formatting across all validation commands
 * - Clear pass/fail/warn status indicators
 * - Actionable remediation suggestions
 * - Machine-readable JSON output option
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Validation status for individual checks
 */
export type ValidationStatus = 'pass' | 'fail' | 'warn' | 'skip';

/**
 * Individual validation result entry
 */
export interface ValidationEntry {
  /** Unique identifier (FIPS, GEOID, etc.) */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Validation status */
  readonly status: ValidationStatus;
  /** Validation tier reached */
  readonly tier?: string;
  /** Human-readable status message */
  readonly message: string;
  /** Detailed diagnostics */
  readonly diagnostics?: Record<string, unknown>;
  /** Remediation suggestion for failures */
  readonly remediation?: string;
  /** Processing time in ms */
  readonly durationMs?: number;
}

/**
 * Aggregated validation summary
 */
export interface ValidationSummary {
  /** Total entries validated */
  readonly total: number;
  /** Entries that passed */
  readonly passed: number;
  /** Entries that failed */
  readonly failed: number;
  /** Entries with warnings */
  readonly warnings: number;
  /** Entries skipped */
  readonly skipped: number;
  /** Pass rate as percentage */
  readonly passRate: number;
  /** Total processing time in ms */
  readonly totalDurationMs: number;
}

/**
 * Complete validation report
 */
export interface ValidationReport {
  /** Report timestamp */
  readonly timestamp: string;
  /** Validator name */
  readonly validator: string;
  /** Validation tier requested */
  readonly tier: string;
  /** Configuration used */
  readonly config: Record<string, unknown>;
  /** Summary statistics */
  readonly summary: ValidationSummary;
  /** Individual results */
  readonly entries: readonly ValidationEntry[];
  /** Overall status */
  readonly overallStatus: ValidationStatus;
}

/**
 * Output format options
 */
export type OutputFormat = 'table' | 'json' | 'summary' | 'csv';

// =============================================================================
// Status Icons (ASCII-safe for CI compatibility)
// =============================================================================

const STATUS_ICONS: Record<ValidationStatus, string> = {
  pass: '[PASS]',
  fail: '[FAIL]',
  warn: '[WARN]',
  skip: '[SKIP]',
};

const STATUS_COLORS: Record<ValidationStatus, string> = {
  pass: '\x1b[32m', // green
  fail: '\x1b[31m', // red
  warn: '\x1b[33m', // yellow
  skip: '\x1b[90m', // gray
};

const RESET = '\x1b[0m';

// =============================================================================
// Report Builder
// =============================================================================

/**
 * Build a validation report from entries
 */
export function buildReport(
  validator: string,
  tier: string,
  entries: ValidationEntry[],
  config: Record<string, unknown> = {}
): ValidationReport {
  const passed = entries.filter((e) => e.status === 'pass').length;
  const failed = entries.filter((e) => e.status === 'fail').length;
  const warnings = entries.filter((e) => e.status === 'warn').length;
  const skipped = entries.filter((e) => e.status === 'skip').length;
  const total = entries.length;
  const totalDurationMs = entries.reduce((sum, e) => sum + (e.durationMs ?? 0), 0);

  const summary: ValidationSummary = {
    total,
    passed,
    failed,
    warnings,
    skipped,
    passRate: total > 0 ? (passed / total) * 100 : 0,
    totalDurationMs,
  };

  // Determine overall status
  let overallStatus: ValidationStatus;
  if (failed > 0) {
    overallStatus = 'fail';
  } else if (warnings > 0) {
    overallStatus = 'warn';
  } else if (skipped === total) {
    overallStatus = 'skip';
  } else {
    overallStatus = 'pass';
  }

  return {
    timestamp: new Date().toISOString(),
    validator,
    tier,
    config,
    summary,
    entries,
    overallStatus,
  };
}

// =============================================================================
// Formatters
// =============================================================================

/**
 * Format report as JSON
 */
export function formatJson(report: ValidationReport, verbose = false): string {
  if (verbose) {
    return JSON.stringify(report, null, 2);
  }

  // Non-verbose: summary only
  return JSON.stringify(
    {
      timestamp: report.timestamp,
      validator: report.validator,
      tier: report.tier,
      overallStatus: report.overallStatus,
      summary: report.summary,
      failures: report.entries
        .filter((e) => e.status === 'fail')
        .map((e) => ({
          id: e.id,
          name: e.name,
          message: e.message,
          remediation: e.remediation,
        })),
    },
    null,
    2
  );
}

/**
 * Format report as table
 */
export function formatTable(report: ValidationReport, useColor = true): string {
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push('=' .repeat(80));
  lines.push(`VALIDATION REPORT: ${report.validator.toUpperCase()}`);
  lines.push('=' .repeat(80));
  lines.push(`Timestamp: ${report.timestamp}`);
  lines.push(`Tier: ${report.tier}`);
  lines.push('');

  // Summary
  const { summary } = report;
  const statusIcon = useColor
    ? `${STATUS_COLORS[report.overallStatus]}${STATUS_ICONS[report.overallStatus]}${RESET}`
    : STATUS_ICONS[report.overallStatus];

  lines.push(`Overall Status: ${statusIcon}`);
  lines.push(`Total: ${summary.total} | Passed: ${summary.passed} | Failed: ${summary.failed} | Warnings: ${summary.warnings} | Skipped: ${summary.skipped}`);
  lines.push(`Pass Rate: ${summary.passRate.toFixed(1)}%`);
  lines.push(`Duration: ${(summary.totalDurationMs / 1000).toFixed(2)}s`);
  lines.push('');

  // Entries table
  if (report.entries.length > 0) {
    lines.push('-'.repeat(80));
    lines.push(padEnd('ID', 12) + padEnd('Name', 25) + padEnd('Status', 10) + 'Message');
    lines.push('-'.repeat(80));

    for (const entry of report.entries) {
      const icon = useColor
        ? `${STATUS_COLORS[entry.status]}${STATUS_ICONS[entry.status]}${RESET}`
        : STATUS_ICONS[entry.status];

      const line = padEnd(entry.id.slice(0, 11), 12) +
                   padEnd(truncate(entry.name, 24), 25) +
                   padEnd(icon, useColor ? 18 : 10) + // Account for color codes
                   truncate(entry.message, 35);
      lines.push(line);
    }

    lines.push('-'.repeat(80));
  }

  // Failures with remediation
  const failures = report.entries.filter((e) => e.status === 'fail');
  if (failures.length > 0) {
    lines.push('');
    lines.push('FAILURES:');
    lines.push('-'.repeat(80));

    for (const entry of failures) {
      lines.push(`  ${entry.id} (${entry.name}):`);
      lines.push(`    ${entry.message}`);
      if (entry.remediation) {
        lines.push(`    Remediation: ${entry.remediation}`);
      }
      lines.push('');
    }
  }

  // Warnings
  const warnings = report.entries.filter((e) => e.status === 'warn');
  if (warnings.length > 0 && warnings.length <= 10) {
    lines.push('WARNINGS:');
    lines.push('-'.repeat(80));

    for (const entry of warnings) {
      lines.push(`  ${entry.id}: ${entry.message}`);
    }
    lines.push('');
  } else if (warnings.length > 10) {
    lines.push(`WARNINGS: ${warnings.length} entries with warnings (use --verbose to see all)`);
    lines.push('');
  }

  lines.push('=' .repeat(80));

  return lines.join('\n');
}

/**
 * Format report as summary (one-line per entry)
 */
export function formatSummary(report: ValidationReport, useColor = true): string {
  const lines: string[] = [];

  const statusIcon = useColor
    ? `${STATUS_COLORS[report.overallStatus]}${STATUS_ICONS[report.overallStatus]}${RESET}`
    : STATUS_ICONS[report.overallStatus];

  lines.push(`${statusIcon} ${report.validator}: ${report.summary.passed}/${report.summary.total} passed (${report.summary.passRate.toFixed(1)}%)`);

  if (report.summary.failed > 0) {
    lines.push(`  Failed: ${report.summary.failed}`);
  }
  if (report.summary.warnings > 0) {
    lines.push(`  Warnings: ${report.summary.warnings}`);
  }

  return lines.join('\n');
}

/**
 * Format report as CSV
 */
export function formatCsv(report: ValidationReport): string {
  const lines: string[] = [];

  // Header
  lines.push('id,name,status,tier,message,remediation,duration_ms');

  // Entries
  for (const entry of report.entries) {
    const row = [
      csvEscape(entry.id),
      csvEscape(entry.name),
      entry.status,
      entry.tier ?? '',
      csvEscape(entry.message),
      csvEscape(entry.remediation ?? ''),
      entry.durationMs?.toString() ?? '',
    ];
    lines.push(row.join(','));
  }

  return lines.join('\n');
}

/**
 * Format report based on output format option
 */
export function formatReport(
  report: ValidationReport,
  format: OutputFormat,
  options: { verbose?: boolean; color?: boolean } = {}
): string {
  const useColor = options.color ?? process.stdout.isTTY ?? false;

  switch (format) {
    case 'json':
      return formatJson(report, options.verbose);
    case 'table':
      return formatTable(report, useColor);
    case 'summary':
      return formatSummary(report, useColor);
    case 'csv':
      return formatCsv(report);
    default:
      return formatTable(report, useColor);
  }
}

// =============================================================================
// Remediation Suggestions
// =============================================================================

/**
 * Standard remediation suggestions by failure type
 */
export const REMEDIATION_SUGGESTIONS: Record<string, string> = {
  // Council validation
  cardinality: 'Verify correct layer - district count does not match expected. Check registry expected count.',
  exclusivity: 'Check for duplicate features or topology errors. Districts should not overlap.',
  exhaustivity: 'Districts do not cover full municipal boundary. May indicate missing districts or boundary vintage mismatch.',
  containment: 'Districts extend outside city boundary. Check for boundary vintage mismatch or wrong city data.',
  fetch_error: 'URL unreachable. Check network connectivity and verify URL is still valid.',
  structure_invalid: 'GeoJSON structure invalid. Verify source returns valid GeoJSON FeatureCollection.',
  sanity_check_fail: 'Data may be for wrong city/region. Check FIPS code and data source.',
  quarantined: 'Entry is quarantined. Review quarantine reason and resolve before re-validation.',
  at_large_city: 'City uses at-large elections. No geographic districts to validate.',

  // GEOID validation
  format_invalid: 'GEOID format does not match expected pattern for this layer type.',
  count_mismatch: 'GEOID count does not match expected count from TIGER documentation.',
  duplicate_geoid: 'Duplicate GEOIDs detected. Each GEOID should be unique.',
  state_prefix_invalid: 'GEOID has wrong state prefix for the specified state.',

  // Registry validation
  url_unreachable: 'URL returned non-2xx status. Verify URL is still valid.',
  stale_entry: 'Entry has not been verified recently. Consider re-validating.',
  missing_coverage: 'City not found in registry. Consider adding it.',

  // Generic
  unknown: 'Unknown validation failure. Check logs for details.',
};

/**
 * Get remediation suggestion for a failure type
 */
export function getRemediation(failureType: string): string {
  return REMEDIATION_SUGGESTIONS[failureType] ?? REMEDIATION_SUGGESTIONS.unknown;
}

// =============================================================================
// Utility Functions
// =============================================================================

function padEnd(str: string, length: number): string {
  return str.padEnd(length);
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

function csvEscape(str: string): string {
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// =============================================================================
// Exit Codes
// =============================================================================

/**
 * Standard exit codes per CLI spec
 */
export const EXIT_CODES = {
  SUCCESS: 0,
  VALIDATION_WARNING: 1,
  VALIDATION_ERROR: 2,
  CONFIG_ERROR: 3,
  NETWORK_ERROR: 4,
  DATA_INTEGRITY_ERROR: 5,
  USER_CANCELLED: 10,
  UNKNOWN_COMMAND: 127,
} as const;

/**
 * Get exit code based on validation report status
 */
export function getExitCode(status: ValidationStatus): number {
  switch (status) {
    case 'pass':
      return EXIT_CODES.SUCCESS;
    case 'warn':
      return EXIT_CODES.VALIDATION_WARNING;
    case 'fail':
      return EXIT_CODES.VALIDATION_ERROR;
    case 'skip':
      return EXIT_CODES.SUCCESS;
    default:
      return EXIT_CODES.VALIDATION_ERROR;
  }
}
