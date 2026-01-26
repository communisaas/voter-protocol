/**
 * shadow-atlas quarantine add <fips>
 *
 * Move an entry from known-portals to quarantined-portals.
 *
 * REQUIRED:
 *   --reason <text>     Detailed quarantine reason
 *
 * OPTIONAL:
 *   --pattern <code>    Quarantine pattern code for classification
 *
 * PATTERN CODES:
 *   cvra_gis_unavailable     - CVRA transition without public GIS
 *   hybrid_gis_unavailable   - Hybrid system without boundaries
 *   containment_failure      - Districts outside city boundary
 *   single_feature           - Only 1 feature (likely at-large)
 *   ward_gis_unavailable     - Ward system without GIS
 *   wrong_data               - URL returns wrong dataset
 *
 * EXAMPLE:
 *   shadow-atlas quarantine add 0614218 \
 *     --reason "CVRA transition - no public GIS for new districts" \
 *     --pattern cvra_gis_unavailable
 */

import type { QuarantineCommandContext } from './index.js';
import {
  moveToQuarantine,
  parseNdjsonFile,
  getRegistryPath,
  type QuarantinePattern,
  type NdjsonEntry,
} from '../../lib/quarantine.js';

const VALID_PATTERNS: QuarantinePattern[] = [
  'cvra_gis_unavailable',
  'hybrid_gis_unavailable',
  'containment_failure',
  'single_feature',
  'ward_gis_unavailable',
  'wrong_data',
  'exclusivity_topology_error',
  'county_for_city',
  'regional_data_bleeding',
  'other',
];

interface AddOptions {
  reason?: string;
  pattern?: string;
}

function parseArgs(args: string[]): { fips: string | null; options: AddOptions } {
  const options: AddOptions = {};
  let fips: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--reason' && i + 1 < args.length) {
      options.reason = args[++i];
    } else if (arg === '--pattern' && i + 1 < args.length) {
      options.pattern = args[++i];
    } else if (!arg.startsWith('-') && !fips) {
      fips = arg;
    }
  }

  return { fips, options };
}

export async function addCommand(context: QuarantineCommandContext): Promise<number> {
  const { fips, options } = parseArgs(context.args);

  // Validate FIPS
  if (!fips) {
    console.error('Error: FIPS code is required');
    console.error('Usage: shadow-atlas quarantine add <fips> --reason <text> [--pattern <code>]');
    return 2;
  }

  if (!/^\d{7}$/.test(fips)) {
    console.error(`Error: Invalid FIPS code format: ${fips}`);
    console.error('FIPS must be a 7-digit Census PLACE code');
    return 2;
  }

  // Validate reason
  if (!options.reason) {
    console.error('Error: --reason is required');
    console.error('Usage: shadow-atlas quarantine add <fips> --reason <text> [--pattern <code>]');
    return 2;
  }

  // Validate pattern if provided
  let pattern: QuarantinePattern = 'other';
  if (options.pattern) {
    if (!VALID_PATTERNS.includes(options.pattern as QuarantinePattern)) {
      console.error(`Error: Invalid pattern code: ${options.pattern}`);
      console.error(`Valid patterns: ${VALID_PATTERNS.join(', ')}`);
      return 2;
    }
    pattern = options.pattern as QuarantinePattern;
  }

  // Check if entry exists in known-portals
  try {
    const knownPath = getRegistryPath('knownPortals');
    const { entries } = await parseNdjsonFile<NdjsonEntry>(knownPath);

    if (!entries.has(fips)) {
      console.error(`Error: Entry not found in known-portals: ${fips}`);

      // Check if already quarantined
      const quarantinedPath = getRegistryPath('quarantinedPortals');
      const { entries: quarantinedEntries } = await parseNdjsonFile<NdjsonEntry>(quarantinedPath);

      if (quarantinedEntries.has(fips)) {
        const entry = quarantinedEntries.get(fips)!;
        console.error(`Entry is already in quarantined-portals:`);
        console.error(`  City: ${entry.cityName}, ${entry.state}`);
        console.error(`  Pattern: ${entry.matchedPattern}`);
        console.error(`  Quarantined: ${entry.quarantinedAt}`);
      }

      return 5;
    }

    const entry = entries.get(fips)!;

    // Show what will be quarantined
    if (context.options.verbose || context.options.dryRun) {
      console.log('Entry to quarantine:');
      console.log(`  FIPS: ${fips}`);
      console.log(`  City: ${entry.cityName}, ${entry.state}`);
      console.log(`  URL: ${entry.downloadUrl}`);
      console.log(`  Features: ${entry.featureCount}`);
      console.log(`  Confidence: ${entry.confidence}`);
      console.log('');
      console.log('Quarantine details:');
      console.log(`  Pattern: ${pattern}`);
      console.log(`  Reason: ${options.reason}`);
      console.log('');
    }

    // Dry run mode
    if (context.options.dryRun) {
      console.log('[DRY RUN] Would quarantine entry. No changes made.');
      return 0;
    }

    // Perform quarantine
    const quarantinedEntry = await moveToQuarantine(fips, options.reason, pattern);

    // Output result
    if (context.options.json) {
      console.log(JSON.stringify({
        success: true,
        action: 'quarantine',
        fips,
        cityName: quarantinedEntry.cityName,
        state: quarantinedEntry.state,
        pattern,
        quarantinedAt: quarantinedEntry.quarantinedAt,
      }, null, 2));
    } else {
      console.log(`Quarantined: ${quarantinedEntry.cityName}, ${quarantinedEntry.state} (${fips})`);
      console.log(`  Pattern: ${pattern}`);
      console.log(`  Reason: ${options.reason.slice(0, 80)}${options.reason.length > 80 ? '...' : ''}`);
      console.log('');
      console.log('Entry moved from known-portals to quarantined-portals.');
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
