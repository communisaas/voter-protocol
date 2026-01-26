/**
 * shadow-atlas quarantine restore <fips>
 *
 * Move an entry back from quarantined-portals to known-portals.
 *
 * OPTIONS:
 *   --url <url>         New URL (required if original was bad)
 *   --validate          Validate URL before restoring
 *   --reason <text>     Audit log reason for restoration
 *
 * BEHAVIOR:
 *   - Removes quarantine-specific fields (quarantineReason, matchedPattern, quarantinedAt)
 *   - Updates lastVerified to current timestamp
 *   - Optionally updates URL if --url provided
 *   - Logs action to audit trail
 *
 * EXAMPLES:
 *   shadow-atlas quarantine restore 0614218 --url "https://new-url/..." --validate
 *   shadow-atlas quarantine restore 0614218 --reason "Found correct GIS layer"
 */

import type { QuarantineCommandContext } from './index.js';
import {
  parseNdjsonFile,
  getRegistryPath,
  restoreFromQuarantine,
  validateUrl,
  type NdjsonEntry,
} from '../../lib/quarantine.js';

interface RestoreOptions {
  url?: string;
  validate?: boolean;
  reason?: string;
}

function parseArgs(args: string[]): { fips: string | null; options: RestoreOptions } {
  const options: RestoreOptions = {};
  let fips: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--url' && i + 1 < args.length) {
      options.url = args[++i];
    } else if (arg === '--validate') {
      options.validate = true;
    } else if (arg === '--reason' && i + 1 < args.length) {
      options.reason = args[++i];
    } else if (!arg.startsWith('-') && !fips) {
      fips = arg;
    }
  }

  return { fips, options };
}

export async function restoreCommand(context: QuarantineCommandContext): Promise<number> {
  const { fips, options } = parseArgs(context.args);

  // Validate FIPS
  if (!fips) {
    console.error('Error: FIPS code is required');
    console.error('Usage: shadow-atlas quarantine restore <fips> [--url <url>] [--validate] [--reason <text>]');
    return 2;
  }

  if (!/^\d{7}$/.test(fips)) {
    console.error(`Error: Invalid FIPS code format: ${fips}`);
    console.error('FIPS must be a 7-digit Census PLACE code');
    return 2;
  }

  try {
    // Load quarantined entry
    const quarantinedPath = getRegistryPath('quarantinedPortals');
    const { entries } = await parseNdjsonFile<NdjsonEntry>(quarantinedPath);

    const entry = entries.get(fips);
    if (!entry) {
      console.error(`Error: Entry not found in quarantined-portals: ${fips}`);

      // Check if already in known-portals
      const knownPath = getRegistryPath('knownPortals');
      const { entries: knownEntries } = await parseNdjsonFile<NdjsonEntry>(knownPath);

      if (knownEntries.has(fips)) {
        const knownEntry = knownEntries.get(fips)!;
        console.error('Entry is already in known-portals:');
        console.error(`  City: ${knownEntry.cityName}, ${knownEntry.state}`);
        console.error(`  URL: ${knownEntry.downloadUrl}`);
      }

      return 5;
    }

    const cityName = entry.cityName as string;
    const state = entry.state as string;
    const originalUrl = entry.downloadUrl as string;
    const pattern = (entry.matchedPattern as string) || 'other';

    // Determine URL to use
    const urlToUse = options.url || originalUrl;

    // Check if URL looks valid (not a quarantine placeholder)
    if (urlToUse.includes('quarantined.invalid')) {
      if (!options.url) {
        console.error('Error: Original URL is a quarantine placeholder.');
        console.error('You must provide a new URL with --url <url>');
        return 2;
      }
    }

    // Show what will be restored
    console.log('Restoring from quarantine:');
    console.log(`  FIPS: ${fips}`);
    console.log(`  City: ${cityName}, ${state}`);
    console.log(`  Pattern: ${pattern}`);
    console.log(`  Original URL: ${originalUrl.slice(0, 60)}${originalUrl.length > 60 ? '...' : ''}`);

    if (options.url) {
      console.log(`  New URL: ${options.url.slice(0, 60)}${options.url.length > 60 ? '...' : ''}`);
    }

    console.log('');

    // Validate URL if requested
    if (options.validate) {
      console.log('Validating URL...');

      const isValid = await validateUrl(urlToUse);

      if (!isValid) {
        console.error('Error: URL validation failed');
        console.error(`URL: ${urlToUse}`);
        console.error('The URL is not accessible or returned an error.');

        if (context.options.json) {
          console.log(JSON.stringify({
            success: false,
            error: 'URL validation failed',
            url: urlToUse,
          }));
        }

        return 4;
      }

      console.log('URL validation passed.');
      console.log('');
    }

    // Dry run mode
    if (context.options.dryRun) {
      console.log('[DRY RUN] Would restore entry. No changes made.');
      console.log('');
      console.log('Entry would be:');
      console.log(`  - Removed from quarantined-portals`);
      console.log(`  - Added to known-portals`);
      console.log(`  - lastVerified updated to now`);
      if (options.url) {
        console.log(`  - URL updated to: ${options.url}`);
      }
      return 0;
    }

    // Perform restoration
    const reason = options.reason || (options.url
      ? `Restored with new URL: ${options.url}`
      : 'Restored from quarantine');

    const restoredEntry = await restoreFromQuarantine(
      fips,
      options.url,
      options.validate,
      'cli',
      reason
    );

    // Output result
    if (context.options.json) {
      console.log(JSON.stringify({
        success: true,
        action: 'restore',
        fips,
        cityName: restoredEntry.cityName,
        state: restoredEntry.state,
        url: restoredEntry.downloadUrl,
        lastVerified: restoredEntry.lastVerified,
        reason,
      }, null, 2));
    } else {
      console.log(`Restored: ${restoredEntry.cityName}, ${restoredEntry.state} (${fips})`);
      console.log('');
      console.log('Changes:');
      console.log(`  - Removed from quarantined-portals`);
      console.log(`  - Added to known-portals`);
      console.log(`  - lastVerified: ${restoredEntry.lastVerified}`);
      if (options.url) {
        console.log(`  - URL updated`);
      }
      console.log('');
      console.log('Audit log updated.');
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
