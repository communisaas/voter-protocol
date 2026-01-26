/**
 * Registry Delete Command
 *
 * Soft-delete an entry by moving to quarantine.
 *
 * Usage:
 *   shadow-atlas registry delete <fips> [options]
 *
 * Arguments:
 *   fips                7-digit Census PLACE FIPS
 *
 * Options:
 *   --reason <text>     Deletion reason (required)
 *   --pattern <code>    Quarantine pattern code
 *   --hard              Hard delete (remove completely, requires --force)
 *   --force             Confirm hard delete
 *   --dry-run           Show what would happen without executing
 *
 * @module cli/commands/registry/delete
 */

import { join } from 'path';
import {
  parseNdjson,
  writeNdjson,
  getRegistryPath,
  validateFips,
  type RegistryName,
  type KnownPortalEntry,
  type QuarantinedPortalEntry,
  type QuarantinePattern,
  type RegistryEntry,
} from '../../lib/ndjson.js';
import { logDelete, logQuarantine, configureAudit } from '../../lib/audit.js';
import { printOutput, printError, printSuccess, printWarning } from '../../lib/output.js';

/**
 * Valid quarantine patterns
 */
const VALID_PATTERNS: QuarantinePattern[] = [
  'cvra_gis_unavailable',
  'hybrid_gis_unavailable',
  'containment_failure',
  'single_feature',
  'ward_gis_unavailable',
  'wrong_data',
  'exclusivity_topology_error',
  'unknown',
];

/**
 * Delete command options
 */
export interface DeleteOptions {
  reason?: string;
  pattern?: QuarantinePattern;
  hard?: boolean;
  force?: boolean;
  dryRun?: boolean;
  dataDir?: string;
  verbose?: boolean;
}

/**
 * Find entry in known-portals registry
 */
async function findKnownPortalEntry(
  dataDir: string,
  fips: string
): Promise<{ entry: KnownPortalEntry; entries: Map<string, KnownPortalEntry> } | null> {
  const filepath = getRegistryPath('known-portals', dataDir);
  try {
    const { entries } = await parseNdjson<KnownPortalEntry>(filepath);
    const entry = entries.get(fips);
    if (entry) {
      return { entry, entries };
    }
  } catch {
    // Registry doesn't exist
  }
  return null;
}

/**
 * Convert known portal entry to quarantined entry
 */
function toQuarantinedEntry(
  entry: KnownPortalEntry,
  reason: string,
  pattern: QuarantinePattern
): QuarantinedPortalEntry {
  return {
    ...entry,
    confidence: 0, // Reset confidence to 0 on quarantine
    quarantineReason: reason,
    matchedPattern: pattern,
    quarantinedAt: new Date().toISOString(),
  };
}

/**
 * Execute the delete command
 */
export async function deleteCommand(fips: string, options: DeleteOptions): Promise<void> {
  const dataDir = options.dataDir || join(process.cwd(), 'data');

  // Configure audit
  configureAudit({ dataDir, enabled: !options.dryRun });

  // Validate FIPS
  const fipsValidation = validateFips(fips);
  if (!fipsValidation.valid) {
    printError(fipsValidation.error || 'Invalid FIPS');
    process.exit(2);
  }

  // Validate required options
  if (!options.reason) {
    printError('--reason is required');
    process.exit(2);
  }

  // Validate pattern if provided
  if (options.pattern && !VALID_PATTERNS.includes(options.pattern)) {
    printError(`Invalid pattern: ${options.pattern}. Valid patterns: ${VALID_PATTERNS.join(', ')}`);
    process.exit(2);
  }

  // Hard delete requires force
  if (options.hard && !options.force) {
    printError('--hard requires --force to confirm permanent deletion');
    process.exit(2);
  }

  try {
    // Find entry in known-portals
    const result = await findKnownPortalEntry(dataDir, fips);

    if (!result) {
      printError(`Entry not found in known-portals: ${fips}`);
      printWarning('Note: Only entries in known-portals can be deleted via this command');
      process.exit(2);
    }

    const { entry, entries: knownEntries } = result;
    const pattern = options.pattern || 'unknown';

    if (options.hard) {
      // Hard delete - completely remove from registry
      if (options.dryRun) {
        console.log('');
        console.log('DRY RUN - Would PERMANENTLY DELETE entry:');
        console.log('-'.repeat(40));
        console.log(`FIPS: ${fips}`);
        console.log(`City: ${entry.cityName}, ${entry.state}`);
        console.log(`Portal Type: ${entry.portalType}`);
        console.log(`URL: ${entry.downloadUrl}`);
        console.log('');
        printWarning('This action cannot be undone!');
        return;
      }

      // Remove from known-portals
      knownEntries.delete(fips);

      const knownPath = getRegistryPath('known-portals', dataDir);
      const { header: knownHeader } = await parseNdjson<KnownPortalEntry>(knownPath);
      await writeNdjson(knownPath, knownHeader, knownEntries);

      // Log to audit
      await logDelete('known-portals', fips, entry, {
        reason: `HARD DELETE: ${options.reason}`,
        command: 'registry delete --hard',
      });

      printSuccess(`Permanently deleted: ${entry.cityName}, ${entry.state} (${fips})`);
      printWarning('Entry has been permanently removed and cannot be recovered');
    } else {
      // Soft delete - move to quarantine
      const quarantinedEntry = toQuarantinedEntry(entry, options.reason!, pattern);

      if (options.dryRun) {
        console.log('');
        console.log('DRY RUN - Would move entry to quarantine:');
        console.log('-'.repeat(40));
        console.log(`FIPS: ${fips}`);
        console.log(`City: ${entry.cityName}, ${entry.state}`);
        console.log(`Pattern: ${pattern}`);
        console.log(`Reason: ${options.reason}`);
        console.log('');
        console.log('Quarantined entry:');
        printOutput(JSON.stringify(quarantinedEntry, null, 2));
        return;
      }

      // Load quarantined registry
      const quarantinedPath = getRegistryPath('quarantined-portals', dataDir);
      const { header: quarantinedHeader, entries: quarantinedEntries } =
        await parseNdjson<QuarantinedPortalEntry>(quarantinedPath);

      // Check if already quarantined
      if (quarantinedEntries.has(fips)) {
        printError(`Entry already exists in quarantine: ${fips}`);
        process.exit(2);
      }

      // Remove from known-portals
      knownEntries.delete(fips);

      // Add to quarantine
      quarantinedEntries.set(fips, quarantinedEntry);

      // Write both registries
      const knownPath = getRegistryPath('known-portals', dataDir);
      const { header: knownHeader } = await parseNdjson<KnownPortalEntry>(knownPath);

      await Promise.all([
        writeNdjson(knownPath, knownHeader, knownEntries),
        writeNdjson(quarantinedPath, quarantinedHeader, quarantinedEntries),
      ]);

      // Log to audit
      await logQuarantine(fips, entry, quarantinedEntry, {
        reason: options.reason,
        command: 'registry delete',
      });

      printSuccess(`Moved to quarantine: ${entry.cityName}, ${entry.state} (${fips})`);
      console.log(`Pattern: ${pattern}`);
      console.log(`Reason: ${options.reason}`);
      console.log('');
      console.log(`known-portals: ${knownEntries.size} entries`);
      console.log(`quarantined-portals: ${quarantinedEntries.size} entries`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    printError(`Failed to delete entry: ${message}`);
    process.exit(2);
  }
}

/**
 * Parse CLI arguments
 */
export function parseDeleteArgs(args: string[]): { fips: string; options: DeleteOptions } {
  const options: DeleteOptions = {};
  let fips = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    if (arg.startsWith('-')) {
      switch (arg) {
        case '--reason':
          if (nextArg && !nextArg.startsWith('-')) {
            options.reason = nextArg;
            i++;
          }
          break;

        case '--pattern':
          if (nextArg && !nextArg.startsWith('-')) {
            options.pattern = nextArg as QuarantinePattern;
            i++;
          }
          break;

        case '--hard':
          options.hard = true;
          break;

        case '--force':
          options.force = true;
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
  console.log('Usage: shadow-atlas registry delete <fips> [options]');
  console.log('');
  console.log('Soft-delete an entry by moving it to the quarantine registry.');
  console.log('');
  console.log('Arguments:');
  console.log('  fips                7-digit Census PLACE FIPS');
  console.log('');
  console.log('Options:');
  console.log('  --reason <text>     Deletion reason (required)');
  console.log('  --pattern <code>    Quarantine pattern code (default: unknown)');
  console.log('  --hard              Hard delete (permanent, requires --force)');
  console.log('  --force             Confirm hard delete');
  console.log('  --dry-run           Show what would happen without executing');
  console.log('');
  console.log('Quarantine Patterns:');
  console.log('  cvra_gis_unavailable       CVRA transition without public GIS');
  console.log('  hybrid_gis_unavailable     Hybrid system without boundaries');
  console.log('  containment_failure        Districts outside city boundary');
  console.log('  single_feature             Only 1 feature (likely at-large)');
  console.log('  ward_gis_unavailable       Ward system without GIS');
  console.log('  wrong_data                 URL returns wrong dataset');
  console.log('  exclusivity_topology_error Overlapping districts');
  console.log('  unknown                    Unclassified issue');
  console.log('');
  console.log('Examples:');
  console.log('  shadow-atlas registry delete 0666000 --reason "City confirmed at-large"');
  console.log('  shadow-atlas registry delete 0666000 --reason "Wrong data" --pattern wrong_data');
  console.log('  shadow-atlas registry delete 0666000 --reason "Duplicate entry" --hard --force');
}

/**
 * CLI entry point
 */
export async function main(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const { fips, options } = parseDeleteArgs(args);

  if (!fips) {
    printError('FIPS code is required');
    console.log('');
    printHelp();
    process.exit(1);
  }

  await deleteCommand(fips, options);
}
