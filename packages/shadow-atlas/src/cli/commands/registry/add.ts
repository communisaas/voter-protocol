/**
 * Registry Add Command
 *
 * Add a new entry to the registry.
 *
 * Usage:
 *   shadow-atlas registry add [options]
 *
 * Options:
 *   --fips <code>       7-digit Census PLACE FIPS (required)
 *   --city <name>       City name (required)
 *   --state <code>      State code (required)
 *   --url <url>         Download URL (required)
 *   --portal-type <t>   Portal type (required)
 *   --count <n>         Feature count (required)
 *   --confidence <n>    Confidence score (default: 60)
 *   --discovered-by <s> Discovery attribution (default: manual)
 *   --notes <text>      Optional notes
 *   --skip-validation   Skip URL validation (not recommended)
 *   --dry-run           Show what would happen without executing
 *
 * @module cli/commands/registry/add
 */

import { join } from 'path';
import {
  parseNdjson,
  writeNdjson,
  getRegistryPath,
  findEntry,
  validateFips,
  validateUrl,
  type KnownPortalEntry,
} from '../../lib/ndjson.js';
import { logAdd, configureAudit } from '../../lib/audit.js';
import { printOutput, printError, printSuccess, printWarning } from '../../lib/output.js';
import type { PortalType } from '../../../core/registry/known-portals.generated.js';

/**
 * Valid portal types
 */
const VALID_PORTAL_TYPES: PortalType[] = [
  'arcgis',
  'municipal-gis',
  'regional-gis',
  'county-gis',
  'state-gis',
  'socrata',
  'geojson',
  'webmap-embedded',
  'curated-data',
  'shapefile',
  'kml',
  'golden-vector',
];

/**
 * Add command options
 */
export interface AddOptions {
  fips?: string;
  city?: string;
  state?: string;
  url?: string;
  portalType?: PortalType;
  count?: number;
  confidence?: number;
  discoveredBy?: string;
  notes?: string;
  skipValidation?: boolean;
  dryRun?: boolean;
  dataDir?: string;
  verbose?: boolean;
}

/**
 * Validate all required options
 */
function validateOptions(options: AddOptions): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!options.fips) {
    errors.push('--fips is required');
  } else {
    const fipsResult = validateFips(options.fips);
    if (!fipsResult.valid) {
      errors.push(`Invalid FIPS: ${fipsResult.error}`);
    }
  }

  if (!options.city) {
    errors.push('--city is required');
  }

  if (!options.state) {
    errors.push('--state is required');
  } else if (!/^[A-Z]{2}$/.test(options.state.toUpperCase())) {
    errors.push('--state must be a 2-letter state code');
  }

  if (!options.url) {
    errors.push('--url is required');
  }

  if (!options.portalType) {
    errors.push('--portal-type is required');
  } else if (!VALID_PORTAL_TYPES.includes(options.portalType)) {
    errors.push(
      `Invalid portal type: ${options.portalType}. Valid types: ${VALID_PORTAL_TYPES.join(', ')}`
    );
  }

  if (options.count === undefined || options.count === null) {
    errors.push('--count is required');
  } else if (options.count < 1) {
    errors.push('--count must be at least 1');
  }

  if (options.confidence !== undefined) {
    if (options.confidence < 0 || options.confidence > 100) {
      errors.push('--confidence must be between 0 and 100');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Execute the add command
 */
export async function addCommand(options: AddOptions): Promise<void> {
  const dataDir = options.dataDir || join(process.cwd(), 'data');

  // Configure audit
  configureAudit({ dataDir, enabled: !options.dryRun });

  // Validate required options
  const validation = validateOptions(options);
  if (!validation.valid) {
    for (const error of validation.errors) {
      printError(error);
    }
    process.exit(2);
  }

  const fips = options.fips!;
  const state = options.state!.toUpperCase();

  try {
    // Check if entry already exists in any registry
    const existing = await findEntry(dataDir, fips);
    if (existing) {
      printError(
        `Entry already exists in ${existing.registry}: ${existing.entry.cityName}, ${existing.entry.state}`
      );
      process.exit(2);
    }

    // Validate URL if not skipped
    if (!options.skipValidation && options.url) {
      console.log('Validating URL...');
      const urlResult = await validateUrl(options.url, true);

      if (!urlResult.valid) {
        printError(`URL validation failed: ${urlResult.error}`);
        printWarning('Use --skip-validation to bypass this check (not recommended)');
        process.exit(2);
      }

      console.log(`URL is reachable (status: ${urlResult.statusCode})`);
    }

    // Build entry
    const entry: KnownPortalEntry = {
      _fips: fips,
      cityFips: fips,
      cityName: options.city!,
      state: state,
      portalType: options.portalType!,
      downloadUrl: options.url!,
      featureCount: options.count!,
      lastVerified: new Date().toISOString(),
      confidence: options.confidence ?? 60,
      discoveredBy: options.discoveredBy || 'manual',
      notes: options.notes,
    };

    // Remove undefined fields
    const cleanEntry = JSON.parse(JSON.stringify(entry)) as KnownPortalEntry;

    if (options.dryRun) {
      console.log('');
      console.log('DRY RUN - Would add the following entry:');
      console.log('-'.repeat(40));
      printOutput(JSON.stringify(cleanEntry, null, 2));
      return;
    }

    // Load known-portals registry
    const filepath = getRegistryPath('known-portals', dataDir);
    const { header, entries } = await parseNdjson<KnownPortalEntry>(filepath);

    // Add entry
    entries.set(fips, cleanEntry);

    // Write updated registry
    await writeNdjson(filepath, header, entries);

    // Log to audit
    await logAdd('known-portals', fips, cleanEntry, {
      reason: options.notes || 'Added via CLI',
      command: 'registry add',
    });

    printSuccess(`Added entry: ${options.city}, ${state} (${fips})`);
    console.log(`Registry now contains ${entries.size} entries`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    printError(`Failed to add entry: ${message}`);
    process.exit(2);
  }
}

/**
 * Parse CLI arguments
 */
export function parseAddArgs(args: string[]): AddOptions {
  const options: AddOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--fips':
        if (nextArg && !nextArg.startsWith('-')) {
          options.fips = nextArg;
          i++;
        }
        break;

      case '--city':
        if (nextArg && !nextArg.startsWith('-')) {
          options.city = nextArg;
          i++;
        }
        break;

      case '--state':
        if (nextArg && !nextArg.startsWith('-')) {
          options.state = nextArg;
          i++;
        }
        break;

      case '--url':
        if (nextArg && !nextArg.startsWith('-')) {
          options.url = nextArg;
          i++;
        }
        break;

      case '--portal-type':
      case '--type':
        if (nextArg && !nextArg.startsWith('-')) {
          options.portalType = nextArg as PortalType;
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

      case '--discovered-by':
      case '--source':
        if (nextArg && !nextArg.startsWith('-')) {
          options.discoveredBy = nextArg;
          i++;
        }
        break;

      case '--notes':
        if (nextArg && !nextArg.startsWith('-')) {
          options.notes = nextArg;
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
  }

  return options;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log('Usage: shadow-atlas registry add [options]');
  console.log('');
  console.log('Add a new entry to the known-portals registry.');
  console.log('');
  console.log('Required Options:');
  console.log('  --fips <code>       7-digit Census PLACE FIPS');
  console.log('  --city <name>       City name');
  console.log('  --state <code>      2-letter state code');
  console.log('  --url <url>         Download URL');
  console.log('  --portal-type <t>   Portal type');
  console.log('  --count <n>         Feature count');
  console.log('');
  console.log('Optional:');
  console.log('  --confidence <n>    Confidence score 0-100 (default: 60)');
  console.log('  --discovered-by <s> Discovery attribution (default: manual)');
  console.log('  --notes <text>      Optional notes');
  console.log('  --skip-validation   Skip URL validation');
  console.log('  --dry-run           Show what would happen without executing');
  console.log('');
  console.log('Valid Portal Types:');
  console.log(`  ${VALID_PORTAL_TYPES.join(', ')}`);
  console.log('');
  console.log('Example:');
  console.log('  shadow-atlas registry add \\');
  console.log('    --fips 0601234 \\');
  console.log('    --city "Example City" \\');
  console.log('    --state CA \\');
  console.log('    --url "https://services.arcgis.com/.../FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson" \\');
  console.log('    --portal-type arcgis \\');
  console.log('    --count 7');
}

/**
 * CLI entry point
 */
export async function main(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const options = parseAddArgs(args);

  // Check if any required options are missing
  if (!options.fips && !options.city && !options.url) {
    printHelp();
    process.exit(1);
  }

  await addCommand(options);
}
