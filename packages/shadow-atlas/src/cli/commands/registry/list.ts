/**
 * Registry List Command
 *
 * List registry entries with filtering and pagination.
 *
 * Usage:
 *   shadow-atlas registry list [options]
 *
 * Options:
 *   --registry <name>   Registry: known-portals|quarantined-portals|at-large-cities (default: known-portals)
 *   --state <code>      Filter by state (e.g., CA, TX)
 *   --portal-type <t>   Filter by portal type (arcgis, socrata, etc.)
 *   --confidence <n>    Minimum confidence score (0-100)
 *   --stale <days>      Show entries not verified in N days
 *   --limit <n>         Max results (default: 50)
 *   --offset <n>        Pagination offset
 *   --format <fmt>      Output format: table|json|ndjson|csv
 *
 * @module cli/commands/registry/list
 */

import { join } from 'path';
import {
  parseNdjson,
  getRegistryPath,
  type RegistryName,
  type KnownPortalEntry,
  type QuarantinedPortalEntry,
  type AtLargeCityEntry,
  type RegistryEntry,
} from '../../lib/ndjson.js';
import {
  formatOutput,
  formatters,
  printOutput,
  printError,
  type OutputFormat,
  type TableColumn,
} from '../../lib/output.js';
import type { PortalType } from '../../../core/registry/known-portals.generated.js';

/**
 * List command options
 */
export interface ListOptions {
  registry?: RegistryName;
  state?: string;
  portalType?: PortalType;
  confidence?: number;
  stale?: number;
  limit?: number;
  offset?: number;
  format?: OutputFormat;
  dataDir?: string;
  verbose?: boolean;
}

/**
 * Column definitions for known portals
 */
const KNOWN_PORTAL_COLUMNS: TableColumn[] = [
  { key: '_fips', header: 'FIPS', width: 7 },
  { key: 'cityName', header: 'City', width: 20, formatter: formatters.truncate(20) },
  { key: 'state', header: 'ST', width: 2 },
  { key: 'portalType', header: 'Type', width: 12 },
  { key: 'featureCount', header: 'Count', width: 5, align: 'right' },
  { key: 'confidence', header: 'Conf', width: 4, align: 'right', formatter: formatters.confidence },
  { key: 'lastVerified', header: 'Verified', width: 12, formatter: formatters.relativeDate },
  { key: 'discoveredBy', header: 'Source', width: 15, formatter: formatters.truncate(15) },
];

/**
 * Column definitions for quarantined portals
 */
const QUARANTINED_PORTAL_COLUMNS: TableColumn[] = [
  { key: '_fips', header: 'FIPS', width: 7 },
  { key: 'cityName', header: 'City', width: 20, formatter: formatters.truncate(20) },
  { key: 'state', header: 'ST', width: 2 },
  { key: 'matchedPattern', header: 'Pattern', width: 20 },
  { key: 'quarantinedAt', header: 'Quarantined', width: 12, formatter: formatters.relativeDate },
  {
    key: 'quarantineReason',
    header: 'Reason',
    width: 40,
    formatter: formatters.truncate(40),
  },
];

/**
 * Column definitions for at-large cities
 */
const AT_LARGE_COLUMNS: TableColumn[] = [
  { key: '_fips', header: 'FIPS', width: 7 },
  { key: 'cityName', header: 'City', width: 25, formatter: formatters.truncate(25) },
  { key: 'state', header: 'ST', width: 2 },
  { key: 'councilSize', header: 'Size', width: 4, align: 'right' },
  { key: 'electionMethod', header: 'Method', width: 15 },
  { key: 'source', header: 'Source', width: 35, formatter: formatters.truncate(35) },
];

/**
 * Get columns for a registry type
 */
function getColumns(registry: RegistryName): TableColumn[] {
  switch (registry) {
    case 'quarantined-portals':
      return QUARANTINED_PORTAL_COLUMNS;
    case 'at-large-cities':
      return AT_LARGE_COLUMNS;
    case 'known-portals':
    default:
      return KNOWN_PORTAL_COLUMNS;
  }
}

/**
 * Check if an entry is stale (not verified in N days)
 */
function isStale(entry: RegistryEntry, staleDays: number): boolean {
  const lastVerified =
    (entry as KnownPortalEntry).lastVerified ||
    (entry as QuarantinedPortalEntry).quarantinedAt ||
    (entry as AtLargeCityEntry).lastVerified;

  if (!lastVerified) return true;

  const verifiedDate = new Date(lastVerified);
  const now = new Date();
  const diffDays = (now.getTime() - verifiedDate.getTime()) / (1000 * 60 * 60 * 24);

  return diffDays > staleDays;
}

/**
 * Apply filters to entries
 */
function applyFilters(
  entries: Map<string, RegistryEntry>,
  options: ListOptions
): RegistryEntry[] {
  let result = Array.from(entries.values());

  // Filter by state
  if (options.state) {
    const state = options.state.toUpperCase();
    result = result.filter((e) => e.state === state);
  }

  // Filter by portal type (only applicable to known and quarantined portals)
  if (options.portalType) {
    result = result.filter((e) => {
      const portal = e as KnownPortalEntry | QuarantinedPortalEntry;
      return 'portalType' in portal && portal.portalType === options.portalType;
    });
  }

  // Filter by minimum confidence (only applicable to known and quarantined portals)
  if (options.confidence !== undefined) {
    result = result.filter((e) => {
      const portal = e as KnownPortalEntry | QuarantinedPortalEntry;
      return 'confidence' in portal && portal.confidence >= options.confidence!;
    });
  }

  // Filter by stale entries
  if (options.stale !== undefined) {
    result = result.filter((e) => isStale(e, options.stale!));
  }

  return result;
}

/**
 * Apply pagination to results
 */
function applyPagination(
  entries: RegistryEntry[],
  options: ListOptions
): { entries: RegistryEntry[]; total: number; hasMore: boolean } {
  const total = entries.length;
  const offset = options.offset || 0;
  const limit = options.limit || 50;

  const paginated = entries.slice(offset, offset + limit);
  const hasMore = offset + limit < total;

  return { entries: paginated, total, hasMore };
}

/**
 * Execute the list command
 */
export async function listCommand(options: ListOptions = {}): Promise<void> {
  const registryName = options.registry || 'known-portals';
  const format = options.format || 'table';
  const dataDir = options.dataDir || join(process.cwd(), 'data');

  try {
    const filepath = getRegistryPath(registryName, dataDir);
    const { header, entries } = await parseNdjson<RegistryEntry>(filepath);

    // Apply filters
    const filtered = applyFilters(entries, options);

    // Sort by state, then city name
    filtered.sort((a, b) => {
      if (a.state !== b.state) return a.state.localeCompare(b.state);
      return a.cityName.localeCompare(b.cityName);
    });

    // Apply pagination
    const { entries: paginated, total, hasMore } = applyPagination(filtered, options);

    // Get columns for output
    const columns = getColumns(registryName);

    // Format and output
    if (format === 'json') {
      // Include metadata in JSON output
      const output = {
        registry: registryName,
        schema: header._schema,
        description: header._description,
        total: total,
        offset: options.offset || 0,
        limit: options.limit || 50,
        hasMore,
        entries: paginated,
      };
      printOutput(JSON.stringify(output, null, 2));
    } else {
      // For table/csv/ndjson, just output entries
      const output = formatOutput(
        paginated as unknown as Record<string, unknown>[],
        format,
        columns
      );
      printOutput(output);

      // Print pagination info for table format
      if (format === 'table') {
        console.log('');
        console.log(
          `Showing ${paginated.length} of ${total} entries` +
            (hasMore ? ` (use --offset ${(options.offset || 0) + (options.limit || 50)} for next page)` : '')
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    printError(`Failed to list registry: ${message}`);
    process.exit(2);
  }
}

/**
 * Parse CLI arguments and execute
 */
export function parseListArgs(args: string[]): ListOptions {
  const options: ListOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--registry':
      case '-r':
        if (nextArg && !nextArg.startsWith('-')) {
          options.registry = nextArg as RegistryName;
          i++;
        }
        break;

      case '--state':
      case '-s':
        if (nextArg && !nextArg.startsWith('-')) {
          options.state = nextArg;
          i++;
        }
        break;

      case '--portal-type':
      case '-t':
        if (nextArg && !nextArg.startsWith('-')) {
          options.portalType = nextArg as PortalType;
          i++;
        }
        break;

      case '--confidence':
      case '-c':
        if (nextArg && !nextArg.startsWith('-')) {
          options.confidence = parseInt(nextArg, 10);
          i++;
        }
        break;

      case '--stale':
        if (nextArg && !nextArg.startsWith('-')) {
          options.stale = parseInt(nextArg, 10);
          i++;
        }
        break;

      case '--limit':
      case '-l':
        if (nextArg && !nextArg.startsWith('-')) {
          options.limit = parseInt(nextArg, 10);
          i++;
        }
        break;

      case '--offset':
      case '-o':
        if (nextArg && !nextArg.startsWith('-')) {
          options.offset = parseInt(nextArg, 10);
          i++;
        }
        break;

      case '--format':
      case '-f':
        if (nextArg && !nextArg.startsWith('-')) {
          options.format = nextArg as OutputFormat;
          i++;
        }
        break;

      case '--data-dir':
        if (nextArg && !nextArg.startsWith('-')) {
          options.dataDir = nextArg;
          i++;
        }
        break;

      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
    }
  }

  return options;
}

/**
 * CLI entry point
 */
export async function main(args: string[]): Promise<void> {
  const options = parseListArgs(args);
  await listCommand(options);
}
