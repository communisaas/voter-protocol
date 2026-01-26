/**
 * Registry Diff Command
 *
 * Compare NDJSON source to generated TypeScript files.
 *
 * Usage:
 *   shadow-atlas registry diff [options]
 *
 * Options:
 *   --registry <name>   Specific registry (default: all)
 *   --format <fmt>      Output format: table|json (default: table)
 *   --verbose           Show all differences in detail
 *
 * @module cli/commands/registry/diff
 */

import { join } from 'path';
import { readFile } from 'fs/promises';
import {
  parseNdjson,
  getRegistryPath,
  type RegistryName,
  type KnownPortalEntry,
  type QuarantinedPortalEntry,
  type AtLargeCityEntry,
  type RegistryEntry,
} from '../../lib/ndjson.js';
import { printOutput, printError, printWarning, printSuccess } from '../../lib/output.js';

/**
 * Diff command options
 */
export interface DiffOptions {
  registry?: RegistryName;
  format?: 'table' | 'json';
  verbose?: boolean;
  dataDir?: string;
  srcDir?: string;
}

/**
 * Entry difference
 */
interface EntryDiff {
  fips: string;
  cityName: string;
  state: string;
  type: 'added' | 'removed' | 'modified';
  changes?: Record<string, { ndjson: unknown; typescript: unknown }>;
}

/**
 * Diff result for a registry
 */
interface RegistryDiff {
  registry: RegistryName;
  ndjsonCount: number;
  typescriptCount: number;
  added: EntryDiff[];
  removed: EntryDiff[];
  modified: EntryDiff[];
  identical: number;
}

/**
 * Overall diff result
 */
interface DiffResult {
  timestamp: string;
  registries: RegistryDiff[];
  hasChanges: boolean;
}

/**
 * Parse TypeScript generated file to extract entries
 */
async function parseGeneratedTypeScript(
  filepath: string
): Promise<Map<string, Record<string, unknown>>> {
  const content = await readFile(filepath, 'utf-8');
  const entries = new Map<string, Record<string, unknown>>();

  // Extract the exported record object
  // Pattern: export const KNOWN_PORTALS: Record<string, KnownPortal> = { ... };
  const recordMatch = content.match(
    /export const \w+:\s*Record<string,\s*\w+>\s*=\s*\{([\s\S]*?)\n\};/
  );

  if (!recordMatch) {
    return entries;
  }

  const recordContent = recordMatch[1];

  // Parse each entry - format is:
  // '0101132': {
  //     "cityFips": "0101132",
  //     ...
  // },
  const entryPattern = /'(\d{7})':\s*(\{[\s\S]*?\n\s*\})/g;
  let match;

  while ((match = entryPattern.exec(recordContent)) !== null) {
    const fips = match[1];
    const entryJson = match[2];

    try {
      // The entry is formatted as JSON with comments stripped
      const entry = JSON.parse(entryJson);
      entries.set(fips, entry);
    } catch {
      // Try to parse by extracting key-value pairs manually
      // This handles the TypeScript object literal format
      const cleanedJson = entryJson
        .replace(/,\s*$/, '') // Remove trailing comma
        .replace(/(\w+):/g, '"$1":'); // Quote keys

      try {
        const entry = JSON.parse(cleanedJson);
        entries.set(fips, entry);
      } catch {
        // Skip entries that can't be parsed
      }
    }
  }

  return entries;
}

/**
 * Compare two entries and return differences
 */
function compareEntries(
  ndjsonEntry: RegistryEntry,
  tsEntry: Record<string, unknown>
): Record<string, { ndjson: unknown; typescript: unknown }> | null {
  const changes: Record<string, { ndjson: unknown; typescript: unknown }> = {};
  const ndjsonRecord = ndjsonEntry as unknown as Record<string, unknown>;

  // Keys to compare (excluding _fips which is internal)
  const keysToCompare = new Set([
    ...Object.keys(ndjsonRecord).filter((k) => !k.startsWith('_')),
    ...Object.keys(tsEntry).filter((k) => !k.startsWith('_')),
  ]);

  for (const key of keysToCompare) {
    const ndjsonVal = ndjsonRecord[key];
    const tsVal = tsEntry[key];

    // Normalize undefined/null comparisons
    const ndjsonNorm = ndjsonVal === undefined ? null : ndjsonVal;
    const tsNorm = tsVal === undefined ? null : tsVal;

    if (JSON.stringify(ndjsonNorm) !== JSON.stringify(tsNorm)) {
      changes[key] = { ndjson: ndjsonVal, typescript: tsVal };
    }
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

/**
 * Get TypeScript file path for a registry
 */
function getTypeScriptPath(registryName: RegistryName, srcDir: string): string {
  const filename =
    registryName === 'known-portals'
      ? 'known-portals.generated.ts'
      : registryName === 'quarantined-portals'
        ? 'quarantined-portals.generated.ts'
        : 'at-large-cities.generated.ts';

  return join(srcDir, 'core', 'registry', filename);
}

/**
 * Diff a single registry
 */
async function diffRegistry(
  registryName: RegistryName,
  dataDir: string,
  srcDir: string
): Promise<RegistryDiff> {
  // Load NDJSON source
  const ndjsonPath = getRegistryPath(registryName, dataDir);
  const { entries: ndjsonEntries } = await parseNdjson<RegistryEntry>(ndjsonPath);

  // Load TypeScript generated file
  const tsPath = getTypeScriptPath(registryName, srcDir);
  const tsEntries = await parseGeneratedTypeScript(tsPath);

  const result: RegistryDiff = {
    registry: registryName,
    ndjsonCount: ndjsonEntries.size,
    typescriptCount: tsEntries.size,
    added: [],
    removed: [],
    modified: [],
    identical: 0,
  };

  // Find entries in NDJSON but not in TypeScript (would be added)
  for (const [fips, ndjsonEntry] of ndjsonEntries) {
    const tsEntry = tsEntries.get(fips);

    if (!tsEntry) {
      result.added.push({
        fips,
        cityName: ndjsonEntry.cityName,
        state: ndjsonEntry.state,
        type: 'added',
      });
    } else {
      const changes = compareEntries(ndjsonEntry, tsEntry);
      if (changes) {
        result.modified.push({
          fips,
          cityName: ndjsonEntry.cityName,
          state: ndjsonEntry.state,
          type: 'modified',
          changes,
        });
      } else {
        result.identical++;
      }
    }
  }

  // Find entries in TypeScript but not in NDJSON (would be removed)
  for (const [fips, tsEntry] of tsEntries) {
    if (!ndjsonEntries.has(fips)) {
      result.removed.push({
        fips,
        cityName: String(tsEntry.cityName || 'Unknown'),
        state: String(tsEntry.state || 'XX'),
        type: 'removed',
      });
    }
  }

  return result;
}

/**
 * Format diff result as table
 */
function formatDiffAsTable(result: DiffResult, verbose: boolean): string {
  const lines: string[] = [];

  lines.push('Registry Diff Report');
  lines.push('='.repeat(60));
  lines.push(`Generated: ${new Date(result.timestamp).toLocaleString()}`);
  lines.push('');

  for (const reg of result.registries) {
    lines.push(`${reg.registry}`);
    lines.push('-'.repeat(60));
    lines.push(`NDJSON entries:     ${reg.ndjsonCount}`);
    lines.push(`TypeScript entries: ${reg.typescriptCount}`);
    lines.push('');

    if (reg.added.length === 0 && reg.removed.length === 0 && reg.modified.length === 0) {
      lines.push('No differences - registries are in sync');
    } else {
      lines.push(`Added (in NDJSON, not in TS):    ${reg.added.length}`);
      lines.push(`Removed (in TS, not in NDJSON):  ${reg.removed.length}`);
      lines.push(`Modified:                        ${reg.modified.length}`);
      lines.push(`Identical:                       ${reg.identical}`);

      if (verbose) {
        if (reg.added.length > 0) {
          lines.push('');
          lines.push('Entries to be added:');
          for (const entry of reg.added.slice(0, 20)) {
            lines.push(`  + ${entry.fips} ${entry.cityName}, ${entry.state}`);
          }
          if (reg.added.length > 20) {
            lines.push(`  ... and ${reg.added.length - 20} more`);
          }
        }

        if (reg.removed.length > 0) {
          lines.push('');
          lines.push('Entries to be removed:');
          for (const entry of reg.removed.slice(0, 20)) {
            lines.push(`  - ${entry.fips} ${entry.cityName}, ${entry.state}`);
          }
          if (reg.removed.length > 20) {
            lines.push(`  ... and ${reg.removed.length - 20} more`);
          }
        }

        if (reg.modified.length > 0) {
          lines.push('');
          lines.push('Entries with changes:');
          for (const entry of reg.modified.slice(0, 10)) {
            lines.push(`  ~ ${entry.fips} ${entry.cityName}, ${entry.state}`);
            if (entry.changes) {
              for (const [key, { ndjson, typescript }] of Object.entries(entry.changes)) {
                lines.push(`      ${key}:`);
                lines.push(`        NDJSON: ${JSON.stringify(ndjson)}`);
                lines.push(`        TS:     ${JSON.stringify(typescript)}`);
              }
            }
          }
          if (reg.modified.length > 10) {
            lines.push(`  ... and ${reg.modified.length - 10} more`);
          }
        }
      }
    }

    lines.push('');
  }

  // Summary
  const totalChanges = result.registries.reduce(
    (sum, r) => sum + r.added.length + r.removed.length + r.modified.length,
    0
  );

  lines.push('='.repeat(60));
  if (totalChanges === 0) {
    lines.push('All registries are in sync. No regeneration needed.');
  } else {
    lines.push(`Total changes: ${totalChanges}`);
    lines.push('Run "npm run registry:generate" to regenerate TypeScript files.');
  }

  return lines.join('\n');
}

/**
 * Execute the diff command
 */
export async function diffCommand(options: DiffOptions = {}): Promise<void> {
  const format = options.format || 'table';
  const dataDir = options.dataDir || join(process.cwd(), 'data');
  const srcDir = options.srcDir || join(process.cwd(), 'src');

  const registries: RegistryName[] = options.registry
    ? [options.registry]
    : ['known-portals', 'quarantined-portals', 'at-large-cities'];

  try {
    const registryDiffs: RegistryDiff[] = [];

    for (const registryName of registries) {
      try {
        const diff = await diffRegistry(registryName, dataDir, srcDir);
        registryDiffs.push(diff);
      } catch (error) {
        printWarning(`Could not diff ${registryName}: ${error instanceof Error ? error.message : error}`);
      }
    }

    const result: DiffResult = {
      timestamp: new Date().toISOString(),
      registries: registryDiffs,
      hasChanges: registryDiffs.some(
        (r) => r.added.length > 0 || r.removed.length > 0 || r.modified.length > 0
      ),
    };

    // Output based on format
    if (format === 'json') {
      printOutput(JSON.stringify(result, null, 2));
    } else {
      printOutput(formatDiffAsTable(result, options.verbose || false));
    }

    // Exit code based on changes
    if (result.hasChanges) {
      process.exit(1); // Indicates changes need to be synced
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    printError(`Failed to diff registries: ${message}`);
    process.exit(2);
  }
}

/**
 * Parse CLI arguments
 */
export function parseDiffArgs(args: string[]): DiffOptions {
  const options: DiffOptions = {};

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

      case '--format':
      case '-f':
        if (nextArg && !nextArg.startsWith('-')) {
          options.format = nextArg as 'table' | 'json';
          i++;
        }
        break;

      case '--verbose':
      case '-v':
        options.verbose = true;
        break;

      case '--data-dir':
        if (nextArg && !nextArg.startsWith('-')) {
          options.dataDir = nextArg;
          i++;
        }
        break;

      case '--src-dir':
        if (nextArg && !nextArg.startsWith('-')) {
          options.srcDir = nextArg;
          i++;
        }
        break;
    }
  }

  return options;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log('Usage: shadow-atlas registry diff [options]');
  console.log('');
  console.log('Compare NDJSON source files to generated TypeScript files.');
  console.log('');
  console.log('Options:');
  console.log('  --registry <name>   Specific registry (default: all)');
  console.log('  --format <fmt>      Output format: table|json (default: table)');
  console.log('  --verbose, -v       Show all differences in detail');
  console.log('');
  console.log('Exit Codes:');
  console.log('  0  Registries are in sync');
  console.log('  1  Changes detected (regeneration needed)');
  console.log('  2  Error occurred');
  console.log('');
  console.log('Examples:');
  console.log('  shadow-atlas registry diff');
  console.log('  shadow-atlas registry diff --verbose');
  console.log('  shadow-atlas registry diff --registry known-portals --format json');
}

/**
 * CLI entry point
 */
export async function main(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const options = parseDiffArgs(args);
  await diffCommand(options);
}
