/**
 * Audit Log Command
 *
 * View audit log entries with filtering and formatting options.
 *
 * Usage:
 *   shadow-atlas audit log [options]
 *
 * Options:
 *   --fips <code>      Filter by FIPS code
 *   --action <type>    Filter by action type
 *   --registry <name>  Filter by registry
 *   --since <date>     Entries since date (ISO 8601 or relative like '7d')
 *   --until <date>     Entries until date (ISO 8601)
 *   --limit <n>        Maximum entries (default: 50)
 *   --json             Output as JSON
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { Command } from 'commander';
import {
  queryAuditLog,
  formatAuditEntry,
  type AuditAction,
  type AuditEntry,
} from '../../lib/audit.js';
import type { RegistryName } from '../../lib/ndjson.js';

/**
 * Log options from CLI
 */
interface LogOptions {
  readonly fips?: string;
  readonly action?: string;
  readonly registry?: string;
  readonly since?: string;
  readonly until?: string;
  readonly limit: string;
  readonly json?: boolean;
}

/**
 * Register the log command
 */
export function registerLogCommand(parent: Command): void {
  parent
    .command('log')
    .description('View audit log entries')
    .option('--fips <code>', 'Filter by FIPS code')
    .option('--action <type>', 'Filter by action type')
    .option('--registry <name>', 'Filter by registry name')
    .option('--since <date>', 'Entries since date (ISO 8601 or relative like "7d")')
    .option('--until <date>', 'Entries until date (ISO 8601)')
    .option('-l, --limit <n>', 'Maximum entries', '50')
    .option('--json', 'Output as JSON')
    .action(async (options: LogOptions) => {
      await executeLog(options);
    });
}

/**
 * Execute the log command
 */
async function executeLog(options: LogOptions): Promise<void> {
  try {
    // Parse options
    const limit = parseInt(options.limit, 10);
    const action = options.action ? validateAction(options.action) : undefined;
    const registry = options.registry
      ? validateRegistry(options.registry)
      : undefined;
    const since = options.since ? parseDate(options.since) : undefined;
    const until = options.until ? parseDate(options.until) : undefined;

    // Query audit log
    const entries = await queryAuditLog({
      fips: options.fips,
      action,
      registry,
      since,
      until,
      limit,
    });

    // Output results
    if (options.json) {
      console.log(JSON.stringify({ total: entries.length, entries }, null, 2));
    } else {
      printLogTable(entries, {
        fips: options.fips,
        action: options.action,
        registry: options.registry,
        since: options.since,
        until: options.until,
        limit,
      });
    }
  } catch (error) {
    if (options.json) {
      console.log(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        })
      );
    } else {
      console.error(
        `\nError: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    process.exit(1);
  }
}

/**
 * Validate action type
 */
function validateAction(action: string): AuditAction {
  const valid: AuditAction[] = [
    'add',
    'update',
    'delete',
    'quarantine',
    'restore',
    'promote',
    'migrate',
    'rollback',
  ];

  if (!valid.includes(action as AuditAction)) {
    throw new Error(
      `Invalid action: ${action}. Must be one of: ${valid.join(', ')}`
    );
  }

  return action as AuditAction;
}

/**
 * Validate registry name
 */
function validateRegistry(registry: string): RegistryName {
  const valid: RegistryName[] = [
    'known-portals',
    'quarantined-portals',
    'at-large-cities',
  ];

  if (!valid.includes(registry as RegistryName)) {
    throw new Error(
      `Invalid registry: ${registry}. Must be one of: ${valid.join(', ')}`
    );
  }

  return registry as RegistryName;
}

/**
 * Parse date from string
 * Supports ISO 8601 or relative formats like "7d", "2w", "1m"
 */
function parseDate(dateStr: string): Date {
  // Try ISO 8601 first
  const isoDate = new Date(dateStr);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }

  // Try relative format (e.g., "7d", "2w", "1m")
  const relativeMatch = dateStr.match(/^(\d+)([dwmy])$/);
  if (relativeMatch) {
    const [, amount, unit] = relativeMatch;
    const now = new Date();
    const value = parseInt(amount, 10);

    switch (unit) {
      case 'd':
        now.setDate(now.getDate() - value);
        break;
      case 'w':
        now.setDate(now.getDate() - value * 7);
        break;
      case 'm':
        now.setMonth(now.getMonth() - value);
        break;
      case 'y':
        now.setFullYear(now.getFullYear() - value);
        break;
    }

    return now;
  }

  throw new Error(
    `Invalid date format: ${dateStr}. Use ISO 8601 or relative format (e.g., "7d", "2w", "1m")`
  );
}

/**
 * Print audit log in table format
 */
function printLogTable(
  entries: readonly AuditEntry[],
  filters: {
    fips?: string;
    action?: string;
    registry?: string;
    since?: string;
    until?: string;
    limit: number;
  }
): void {
  console.log('\nAudit Log');
  console.log('='.repeat(80));

  // Print active filters
  const activeFilters: string[] = [];
  if (filters.fips) activeFilters.push(`FIPS: ${filters.fips}`);
  if (filters.action) activeFilters.push(`Action: ${filters.action}`);
  if (filters.registry) activeFilters.push(`Registry: ${filters.registry}`);
  if (filters.since) activeFilters.push(`Since: ${filters.since}`);
  if (filters.until) activeFilters.push(`Until: ${filters.until}`);
  if (activeFilters.length > 0) {
    console.log(`Filters: ${activeFilters.join(', ')}`);
  }
  console.log(`Showing: ${entries.length} entries (limit: ${filters.limit})`);
  console.log('');

  if (entries.length === 0) {
    console.log('No audit entries found matching criteria.');
    return;
  }

  // Print header
  console.log(
    'Timestamp            Action       FIPS       Registry              Actor           Reason'
  );
  console.log('-'.repeat(120));

  // Print each entry
  for (const entry of entries) {
    const timestamp = new Date(entry.timestamp)
      .toISOString()
      .substring(0, 19)
      .replace('T', ' ');
    const action = entry.action.padEnd(12);
    const fips = entry.fips.substring(0, 10).padEnd(10);
    const registry = entry.registry.substring(0, 21).padEnd(21);
    const actor = entry.actor.substring(0, 15).padEnd(15);
    const reason = entry.reason
      ? entry.reason.length > 30
        ? entry.reason.substring(0, 27) + '...'
        : entry.reason
      : '-';

    console.log(`${timestamp}  ${action}  ${fips}  ${registry}  ${actor}  ${reason}`);
  }

  // Summary statistics
  console.log('');
  console.log('Summary:');

  // Group by action
  const byAction = new Map<string, number>();
  for (const entry of entries) {
    const count = byAction.get(entry.action) ?? 0;
    byAction.set(entry.action, count + 1);
  }

  console.log('  By action:');
  for (const [action, count] of Array.from(byAction.entries())) {
    console.log(`    ${action}: ${count}`);
  }

  // Group by actor
  const byActor = new Map<string, number>();
  for (const entry of entries) {
    const count = byActor.get(entry.actor) ?? 0;
    byActor.set(entry.actor, count + 1);
  }

  console.log('  By actor:');
  for (const [actor, count] of Array.from(byActor.entries())) {
    console.log(`    ${actor}: ${count}`);
  }

  // Date range
  if (entries.length > 0) {
    const timestamps = entries.map((e) => new Date(e.timestamp).getTime());
    const earliest = new Date(Math.min(...timestamps));
    const latest = new Date(Math.max(...timestamps));
    console.log(`  Date range: ${earliest.toISOString()} to ${latest.toISOString()}`);
  }
}
