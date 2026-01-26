/**
 * Registry Update Command
 *
 * Update fields on an existing entry.
 *
 * Usage:
 *   shadow-atlas registry update <fips> [options]
 *
 * Arguments:
 *   fips                7-digit Census PLACE FIPS
 *
 * Options:
 *   --url <url>         Update download URL
 *   --count <n>         Update feature count
 *   --confidence <n>    Update confidence score
 *   --notes <text>      Update notes (append with --append-notes)
 *   --append-notes      Append to existing notes instead of replacing
 *   --last-verified     Update lastVerified to now
 *   --portal-type <t>   Update portal type
 *   --reason <text>     Audit log reason (required for significant changes)
 *   --dry-run           Show what would happen without executing
 *
 * @module cli/commands/registry/update
 */

import { join } from 'path';
import {
  parseNdjson,
  writeNdjson,
  getRegistryPath,
  validateFips,
  validateUrl,
  type RegistryName,
  type KnownPortalEntry,
  type QuarantinedPortalEntry,
  type AtLargeCityEntry,
  type RegistryEntry,
} from '../../lib/ndjson.js';
import { logUpdate, configureAudit } from '../../lib/audit.js';
import { printOutput, printError, printSuccess, printWarning } from '../../lib/output.js';
import type { PortalType } from '../../../core/registry/known-portals.generated.js';

/**
 * Update command options
 */
export interface UpdateOptions {
  url?: string;
  count?: number;
  confidence?: number;
  notes?: string;
  appendNotes?: boolean;
  lastVerified?: boolean;
  portalType?: PortalType;
  reason?: string;
  registry?: RegistryName;
  skipValidation?: boolean;
  dryRun?: boolean;
  dataDir?: string;
  verbose?: boolean;
}

/**
 * Fields that require a reason for change
 */
const SIGNIFICANT_FIELDS = ['url', 'portalType', 'count'];

/**
 * Check if any significant fields are being updated
 */
function hasSignificantChanges(options: UpdateOptions): boolean {
  return SIGNIFICANT_FIELDS.some((field) => (options as Record<string, unknown>)[field] !== undefined);
}

/**
 * Build updates object from options
 */
function buildUpdates(
  existing: RegistryEntry,
  options: UpdateOptions
): Partial<RegistryEntry> {
  const updates: Record<string, unknown> = {};

  if (options.url !== undefined) {
    updates.downloadUrl = options.url;
  }

  if (options.count !== undefined) {
    updates.featureCount = options.count;
  }

  if (options.confidence !== undefined) {
    updates.confidence = options.confidence;
  }

  if (options.portalType !== undefined) {
    updates.portalType = options.portalType;
  }

  if (options.notes !== undefined) {
    if (options.appendNotes && (existing as KnownPortalEntry).notes) {
      updates.notes = `${(existing as KnownPortalEntry).notes}; ${options.notes}`;
    } else {
      updates.notes = options.notes;
    }
  }

  if (options.lastVerified) {
    updates.lastVerified = new Date().toISOString();
  }

  return updates as Partial<RegistryEntry>;
}

/**
 * Format diff between before and after
 */
function formatDiff(before: RegistryEntry, after: RegistryEntry): string {
  const lines: string[] = [];
  const beforeRecord = before as unknown as Record<string, unknown>;
  const afterRecord = after as unknown as Record<string, unknown>;

  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    const beforeVal = beforeRecord[key];
    const afterVal = afterRecord[key];

    if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
      lines.push(`  ${key}:`);
      lines.push(`    - ${JSON.stringify(beforeVal)}`);
      lines.push(`    + ${JSON.stringify(afterVal)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Find entry in registries
 */
async function findEntryInRegistries(
  dataDir: string,
  fips: string,
  specificRegistry?: RegistryName
): Promise<{ registry: RegistryName; entry: RegistryEntry; entries: Map<string, RegistryEntry> } | null> {
  const registries: RegistryName[] = specificRegistry
    ? [specificRegistry]
    : ['known-portals', 'quarantined-portals', 'at-large-cities'];

  for (const registryName of registries) {
    const filepath = getRegistryPath(registryName, dataDir);
    try {
      const { entries } = await parseNdjson<RegistryEntry>(filepath);
      const entry = entries.get(fips);
      if (entry) {
        return { registry: registryName, entry, entries };
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Execute the update command
 */
export async function updateCommand(fips: string, options: UpdateOptions): Promise<void> {
  const dataDir = options.dataDir || join(process.cwd(), 'data');

  // Configure audit
  configureAudit({ dataDir, enabled: !options.dryRun });

  // Validate FIPS
  const fipsValidation = validateFips(fips);
  if (!fipsValidation.valid) {
    printError(fipsValidation.error || 'Invalid FIPS');
    process.exit(2);
  }

  // Check if reason is required
  if (hasSignificantChanges(options) && !options.reason && !options.dryRun) {
    printError('--reason is required for significant changes (url, portal-type, count)');
    process.exit(2);
  }

  try {
    // Find entry
    const result = await findEntryInRegistries(dataDir, fips, options.registry);

    if (!result) {
      printError(`Entry not found: ${fips}`);
      process.exit(2);
    }

    const { registry, entry, entries } = result;

    // Build updates
    const updates = buildUpdates(entry, options);

    if (Object.keys(updates).length === 0) {
      printWarning('No updates specified');
      return;
    }

    // Apply updates
    const before = entry;
    const after = { ...entry, ...updates } as RegistryEntry;

    // Validate new URL if being updated
    if (options.url && !options.skipValidation) {
      console.log('Validating new URL...');
      const urlResult = await validateUrl(options.url, true);

      if (!urlResult.valid) {
        printError(`URL validation failed: ${urlResult.error}`);
        printWarning('Use --skip-validation to bypass this check');
        process.exit(2);
      }

      console.log(`URL is reachable (status: ${urlResult.statusCode})`);
    }

    if (options.dryRun) {
      console.log('');
      console.log('DRY RUN - Would update entry in', registry);
      console.log('-'.repeat(40));
      console.log(`FIPS: ${fips}`);
      console.log(`City: ${entry.cityName}, ${entry.state}`);
      console.log('');
      console.log('Changes:');
      console.log(formatDiff(before, after));
      return;
    }

    // Update entry in map
    entries.set(fips, after);

    // Write updated registry
    const filepath = getRegistryPath(registry, dataDir);
    const { header } = await parseNdjson<RegistryEntry>(filepath);
    await writeNdjson(filepath, header, entries);

    // Log to audit
    await logUpdate(registry, fips, before, after, {
      reason: options.reason || 'Updated via CLI',
      command: 'registry update',
    });

    printSuccess(`Updated entry: ${entry.cityName}, ${entry.state} (${fips})`);
    console.log('');
    console.log('Changes:');
    console.log(formatDiff(before, after));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    printError(`Failed to update entry: ${message}`);
    process.exit(2);
  }
}

/**
 * Parse CLI arguments
 */
export function parseUpdateArgs(args: string[]): { fips: string; options: UpdateOptions } {
  const options: UpdateOptions = {};
  let fips = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    if (arg.startsWith('-')) {
      switch (arg) {
        case '--url':
          if (nextArg && !nextArg.startsWith('-')) {
            options.url = nextArg;
            i++;
          }
          break;

        case '--count':
          if (nextArg && !nextArg.startsWith('-')) {
            options.count = parseInt(nextArg, 10);
            i++;
          }
          break;

        case '--confidence':
          if (nextArg && !nextArg.startsWith('-')) {
            options.confidence = parseInt(nextArg, 10);
            i++;
          }
          break;

        case '--notes':
          if (nextArg && !nextArg.startsWith('-')) {
            options.notes = nextArg;
            i++;
          }
          break;

        case '--append-notes':
          options.appendNotes = true;
          break;

        case '--last-verified':
          options.lastVerified = true;
          break;

        case '--portal-type':
        case '--type':
          if (nextArg && !nextArg.startsWith('-')) {
            options.portalType = nextArg as PortalType;
            i++;
          }
          break;

        case '--reason':
          if (nextArg && !nextArg.startsWith('-')) {
            options.reason = nextArg;
            i++;
          }
          break;

        case '--registry':
        case '-r':
          if (nextArg && !nextArg.startsWith('-')) {
            options.registry = nextArg as RegistryName;
            i++;
          }
          break;

        case '--skip-validation':
          options.skipValidation = true;
          break;

        case '--dry-run':
          options.dryRun = true;
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
    } else if (!fips) {
      fips = arg;
    }
  }

  return { fips, options };
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log('Usage: shadow-atlas registry update <fips> [options]');
  console.log('');
  console.log('Update fields on an existing registry entry.');
  console.log('');
  console.log('Arguments:');
  console.log('  fips                7-digit Census PLACE FIPS');
  console.log('');
  console.log('Options:');
  console.log('  --url <url>         Update download URL');
  console.log('  --count <n>         Update feature count');
  console.log('  --confidence <n>    Update confidence score (0-100)');
  console.log('  --notes <text>      Update notes');
  console.log('  --append-notes      Append to existing notes instead of replacing');
  console.log('  --last-verified     Update lastVerified to current time');
  console.log('  --portal-type <t>   Update portal type');
  console.log('  --reason <text>     Reason for change (required for significant changes)');
  console.log('  --registry <name>   Which registry to update (default: auto-detect)');
  console.log('  --skip-validation   Skip URL validation');
  console.log('  --dry-run           Show what would happen without executing');
  console.log('');
  console.log('Examples:');
  console.log('  shadow-atlas registry update 0666000 --url "https://new-url/..." --reason "URL migration"');
  console.log('  shadow-atlas registry update 0666000 --last-verified --count 9');
  console.log('  shadow-atlas registry update 0666000 --notes "Fixed layer index" --append-notes');
}

/**
 * CLI entry point
 */
export async function main(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const { fips, options } = parseUpdateArgs(args);

  if (!fips) {
    printError('FIPS code is required');
    console.log('');
    printHelp();
    process.exit(1);
  }

  await updateCommand(fips, options);
}
