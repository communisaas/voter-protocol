/**
 * Audit Export Command
 *
 * Export audit log to file for compliance, backup, or analysis.
 *
 * Usage:
 *   shadow-atlas audit export <output-file> [options]
 *
 * Options:
 *   --format <fmt>     Export format: json|ndjson|csv (default: json)
 *   --fips <code>      Filter by FIPS code
 *   --since <date>     Export entries since date
 *   --until <date>     Export entries until date
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { Command } from 'commander';
import { writeFile } from 'fs/promises';
import { queryAuditLog, type AuditEntry } from '../../lib/audit.js';

/**
 * Export options from CLI
 */
interface ExportOptions {
  readonly format: 'json' | 'ndjson' | 'csv';
  readonly fips?: string;
  readonly since?: string;
  readonly until?: string;
}

/**
 * Register the export command
 */
export function registerExportCommand(parent: Command): void {
  parent
    .command('export <output-file>')
    .description('Export audit log to file')
    .option(
      '-f, --format <fmt>',
      'Export format: json|ndjson|csv',
      'json'
    )
    .option('--fips <code>', 'Filter by FIPS code')
    .option('--since <date>', 'Export entries since date (ISO 8601)')
    .option('--until <date>', 'Export entries until date (ISO 8601)')
    .action(async (outputFile: string, options: ExportOptions) => {
      await executeExport(outputFile, options);
    });
}

/**
 * Execute the export command
 */
async function executeExport(
  outputFile: string,
  options: ExportOptions
): Promise<void> {
  try {
    // Validate format
    const format = validateFormat(options.format);

    // Parse date filters
    const since = options.since ? new Date(options.since) : undefined;
    const until = options.until ? new Date(options.until) : undefined;

    if (since && isNaN(since.getTime())) {
      throw new Error(`Invalid since date: ${options.since}`);
    }
    if (until && isNaN(until.getTime())) {
      throw new Error(`Invalid until date: ${options.until}`);
    }

    console.log('Exporting audit log...');
    console.log(`  Output: ${outputFile}`);
    console.log(`  Format: ${format}`);
    if (options.fips) console.log(`  FIPS filter: ${options.fips}`);
    if (since) console.log(`  Since: ${since.toISOString()}`);
    if (until) console.log(`  Until: ${until.toISOString()}`);
    console.log('');

    // Query audit log
    const entries = await queryAuditLog({
      fips: options.fips,
      since,
      until,
    });

    console.log(`Found ${entries.length} entries to export`);

    // Export based on format
    let content: string;
    switch (format) {
      case 'json':
        content = exportAsJson(entries);
        break;
      case 'ndjson':
        content = exportAsNdjson(entries);
        break;
      case 'csv':
        content = exportAsCsv(entries);
        break;
    }

    // Write to file
    await writeFile(outputFile, content, 'utf-8');

    console.log(`\nExport complete: ${outputFile}`);
    console.log(`  Entries: ${entries.length}`);
    console.log(`  Size: ${Buffer.byteLength(content, 'utf-8')} bytes`);
  } catch (error) {
    console.error(
      `\nError: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}

/**
 * Validate export format
 */
function validateFormat(format: string): 'json' | 'ndjson' | 'csv' {
  const valid = ['json', 'ndjson', 'csv'];
  if (!valid.includes(format)) {
    throw new Error(
      `Invalid format: ${format}. Must be one of: ${valid.join(', ')}`
    );
  }
  return format as 'json' | 'ndjson' | 'csv';
}

/**
 * Export as JSON
 */
function exportAsJson(entries: readonly AuditEntry[]): string {
  const output = {
    exported: new Date().toISOString(),
    total: entries.length,
    entries: entries,
  };
  return JSON.stringify(output, null, 2);
}

/**
 * Export as NDJSON (newline-delimited JSON)
 */
function exportAsNdjson(entries: readonly AuditEntry[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join('\n');
}

/**
 * Export as CSV
 */
function exportAsCsv(entries: readonly AuditEntry[]): string {
  // CSV header
  const header = [
    'id',
    'timestamp',
    'action',
    'registry',
    'fips',
    'actor',
    'reason',
    'cli_version',
    'command',
    'duration_ms',
  ].join(',');

  // CSV rows
  const rows = entries.map((entry) => {
    const fields = [
      entry.id,
      entry.timestamp,
      entry.action,
      entry.registry,
      entry.fips,
      entry.actor,
      csvEscape(entry.reason || ''),
      entry.metadata?.cliVersion || '',
      csvEscape(entry.metadata?.command || ''),
      entry.metadata?.duration_ms?.toString() || '',
    ];
    return fields.join(',');
  });

  return [header, ...rows].join('\n');
}

/**
 * Escape CSV field
 */
function csvEscape(value: string): string {
  // If field contains comma, quote, or newline, wrap in quotes and escape quotes
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
