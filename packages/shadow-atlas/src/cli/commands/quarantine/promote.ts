/**
 * shadow-atlas quarantine promote <fips>
 *
 * Promote a quarantined entry to at-large-cities (terminal state).
 * This is for cities confirmed to use at-large voting with no geographic districts.
 *
 * REQUIRED:
 *   --council-size <n>  Number of council seats
 *   --source <text>     Verification source (e.g., city charter, Ballotpedia)
 *
 * OPTIONAL:
 *   --election-method <m>  Election method: at-large|at-large-with-residency|proportional
 *                          (default: at-large)
 *   --notes <text>         Additional notes
 *
 * BEHAVIOR:
 *   - Removes entry from quarantined-portals
 *   - Adds entry to at-large-cities with new schema
 *   - This is a TERMINAL state - entry cannot be restored to known-portals
 *   - Logs action to audit trail
 *
 * EXAMPLES:
 *   shadow-atlas quarantine promote 0632548 \
 *     --council-size 5 \
 *     --election-method at-large \
 *     --source "City of Hawthorne Municipal Code, Chapter 2"
 */

import type { QuarantineCommandContext } from './index.js';
import {
  parseNdjsonFile,
  getRegistryPath,
  promoteToAtLarge,
  type NdjsonEntry,
} from '../../lib/quarantine.js';

type ElectionMethod = 'at-large' | 'at-large-with-residency' | 'proportional';

interface PromoteOptions {
  councilSize?: number;
  source?: string;
  electionMethod?: ElectionMethod;
  notes?: string;
}

function parseArgs(args: string[]): { fips: string | null; options: PromoteOptions } {
  const options: PromoteOptions = {};
  let fips: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--council-size' && i + 1 < args.length) {
      options.councilSize = parseInt(args[++i]!, 10);
    } else if (arg === '--source' && i + 1 < args.length) {
      options.source = args[++i];
    } else if (arg === '--election-method' && i + 1 < args.length) {
      options.electionMethod = args[++i] as ElectionMethod;
    } else if (arg === '--notes' && i + 1 < args.length) {
      options.notes = args[++i];
    } else if (!arg.startsWith('-') && !fips) {
      fips = arg;
    }
  }

  return { fips, options };
}

export async function promoteCommand(context: QuarantineCommandContext): Promise<number> {
  const { fips, options } = parseArgs(context.args);

  // Validate FIPS
  if (!fips) {
    console.error('Error: FIPS code is required');
    console.error('Usage: shadow-atlas quarantine promote <fips> --council-size <n> --source <text>');
    return 2;
  }

  if (!/^\d{7}$/.test(fips)) {
    console.error(`Error: Invalid FIPS code format: ${fips}`);
    console.error('FIPS must be a 7-digit Census PLACE code');
    return 2;
  }

  // Validate required options
  if (!options.councilSize || options.councilSize <= 0) {
    console.error('Error: --council-size is required and must be a positive number');
    console.error('Usage: shadow-atlas quarantine promote <fips> --council-size <n> --source <text>');
    return 2;
  }

  if (!options.source) {
    console.error('Error: --source is required');
    console.error('Provide a verification source (e.g., city charter, Ballotpedia, official website)');
    return 2;
  }

  // Validate election method
  const validMethods: ElectionMethod[] = ['at-large', 'at-large-with-residency', 'proportional'];
  if (options.electionMethod && !validMethods.includes(options.electionMethod)) {
    console.error(`Error: Invalid election method: ${options.electionMethod}`);
    console.error(`Valid methods: ${validMethods.join(', ')}`);
    return 2;
  }

  const electionMethod = options.electionMethod || 'at-large';

  try {
    // Load quarantined entry
    const quarantinedPath = getRegistryPath('quarantinedPortals');
    const { entries } = await parseNdjsonFile<NdjsonEntry>(quarantinedPath);

    const entry = entries.get(fips);
    if (!entry) {
      console.error(`Error: Entry not found in quarantined-portals: ${fips}`);

      // Check if already in at-large-cities
      const atLargePath = getRegistryPath('atLargeCities');
      const { entries: atLargeEntries } = await parseNdjsonFile<NdjsonEntry>(atLargePath);

      if (atLargeEntries.has(fips)) {
        const atLargeEntry = atLargeEntries.get(fips)!;
        console.error('Entry is already in at-large-cities:');
        console.error(`  City: ${atLargeEntry.cityName}, ${atLargeEntry.state}`);
        console.error(`  Council Size: ${atLargeEntry.councilSize}`);
        console.error(`  Method: ${atLargeEntry.electionMethod}`);
      }

      return 5;
    }

    const cityName = entry.cityName as string;
    const state = entry.state as string;
    const pattern = (entry.matchedPattern as string) || 'other';

    // Show what will be promoted
    console.log('Promoting to at-large registry:');
    console.log(`  FIPS: ${fips}`);
    console.log(`  City: ${cityName}, ${state}`);
    console.log(`  Quarantine Pattern: ${pattern}`);
    console.log('');
    console.log('At-large details:');
    console.log(`  Council Size: ${options.councilSize}`);
    console.log(`  Election Method: ${electionMethod}`);
    console.log(`  Source: ${options.source}`);
    if (options.notes) {
      console.log(`  Notes: ${options.notes}`);
    }
    console.log('');

    // Warning for terminal state
    console.log('WARNING: This is a TERMINAL state.');
    console.log('The entry will be permanently removed from quarantine.');
    console.log('To undo, you would need to manually add back to known-portals.');
    console.log('');

    // Dry run mode
    if (context.options.dryRun) {
      console.log('[DRY RUN] Would promote entry. No changes made.');
      return 0;
    }

    // Perform promotion
    const atLargeEntry = await promoteToAtLarge(
      fips,
      options.councilSize,
      options.source,
      electionMethod,
      options.notes,
      'cli'
    );

    // Output result
    if (context.options.json) {
      console.log(JSON.stringify({
        success: true,
        action: 'promote',
        fips,
        cityName: atLargeEntry.cityName,
        state: atLargeEntry.state,
        councilSize: atLargeEntry.councilSize,
        electionMethod: atLargeEntry.electionMethod,
        source: atLargeEntry.source,
        notes: atLargeEntry.notes,
      }, null, 2));
    } else {
      console.log(`Promoted: ${atLargeEntry.cityName}, ${atLargeEntry.state} (${fips})`);
      console.log('');
      console.log('Changes:');
      console.log(`  - Removed from quarantined-portals`);
      console.log(`  - Added to at-large-cities`);
      console.log(`  - Council Size: ${atLargeEntry.councilSize}`);
      console.log(`  - Election Method: ${atLargeEntry.electionMethod}`);
      console.log('');
      console.log('Audit log updated.');
      console.log('');
      console.log('Next steps:');
      console.log('  - Run `npm run registry:generate` to regenerate TypeScript files');
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);

    if (context.options.json) {
      console.log(JSON.stringify({
        success: false,
        error: message,
      }));
    }

    return 5;
  }
}
