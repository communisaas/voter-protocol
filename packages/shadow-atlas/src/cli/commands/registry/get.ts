/**
 * Registry Get Command
 *
 * Get detailed information about a single entry by FIPS.
 *
 * Usage:
 *   shadow-atlas registry get <fips> [options]
 *
 * Arguments:
 *   fips                7-digit Census PLACE FIPS
 *
 * Options:
 *   --registry <name>   Which registry to search (default: auto-detect)
 *   --include-history   Show modification history from audit log
 *   --validate          Run validation checks on entry
 *   --format <fmt>      Output format: json|table (default: table)
 *
 * @module cli/commands/registry/get
 */

import { join } from 'path';
import {
  findEntry,
  parseNdjson,
  getRegistryPath,
  validateFips,
  validateUrl,
  type RegistryName,
  type RegistryEntry,
  type KnownPortalEntry,
  type QuarantinedPortalEntry,
  type AtLargeCityEntry,
} from '../../lib/ndjson.js';
import { queryAuditLog, formatAuditEntry, configureAudit } from '../../lib/audit.js';
import { printOutput, printError, printWarning } from '../../lib/output.js';

/**
 * Get command options
 */
export interface GetOptions {
  registry?: RegistryName;
  includeHistory?: boolean;
  validate?: boolean;
  format?: 'json' | 'table';
  dataDir?: string;
  verbose?: boolean;
}

/**
 * Validation result for an entry
 */
interface ValidationResult {
  fipsValid: boolean;
  urlReachable?: boolean;
  urlStatus?: number;
  issues: string[];
  warnings: string[];
}

/**
 * Format a field value for display
 */
function formatValue(key: string, value: unknown): string {
  if (value === undefined || value === null) return '-';

  if (key === 'lastVerified' || key === 'quarantinedAt') {
    const date = new Date(String(value));
    if (!isNaN(date.getTime())) {
      const now = new Date();
      const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
      return `${date.toLocaleDateString()} (${diffDays} days ago)`;
    }
  }

  if (key === 'confidence') {
    return `${value}%`;
  }

  if (key === 'downloadUrl') {
    return String(value);
  }

  return String(value);
}

/**
 * Format entry as table for display
 */
function formatEntryAsTable(entry: RegistryEntry, registry: RegistryName): string {
  const lines: string[] = [];
  const maxKeyWidth = 20;

  // Header
  lines.push('='.repeat(60));
  lines.push(`Registry: ${registry}`);
  lines.push('='.repeat(60));
  lines.push('');

  // Common fields
  const commonFields = ['_fips', 'cityName', 'state'];

  // Registry-specific fields
  let fields: string[];

  if (registry === 'at-large-cities') {
    fields = [
      ...commonFields,
      'councilSize',
      'electionMethod',
      'source',
      'notes',
      'discoveredBy',
      'lastVerified',
    ];
  } else if (registry === 'quarantined-portals') {
    fields = [
      ...commonFields,
      'portalType',
      'downloadUrl',
      'featureCount',
      'confidence',
      'quarantineReason',
      'matchedPattern',
      'quarantinedAt',
      'notes',
      'discoveredBy',
      'lastVerified',
    ];
  } else {
    fields = [
      ...commonFields,
      'portalType',
      'downloadUrl',
      'featureCount',
      'confidence',
      'discoveredBy',
      'lastVerified',
      'notes',
      'webmapLayerName',
      'authoritativeSource',
    ];
  }

  for (const field of fields) {
    const value = (entry as unknown as Record<string, unknown>)[field];
    if (value !== undefined && value !== null && value !== '') {
      const label = field.padEnd(maxKeyWidth);
      const formatted = formatValue(field, value);
      lines.push(`${label}: ${formatted}`);
    }
  }

  return lines.join('\n');
}

/**
 * Validate an entry
 */
async function validateEntry(
  entry: RegistryEntry,
  registry: RegistryName
): Promise<ValidationResult> {
  const issues: string[] = [];
  const warnings: string[] = [];

  // Validate FIPS
  const fipsResult = validateFips(entry._fips);
  if (!fipsResult.valid) {
    issues.push(`Invalid FIPS: ${fipsResult.error}`);
  }

  // Validate URL (for portal entries)
  let urlReachable: boolean | undefined;
  let urlStatus: number | undefined;

  if (registry !== 'at-large-cities') {
    const portal = entry as KnownPortalEntry | QuarantinedPortalEntry;

    if (portal.downloadUrl) {
      // Skip validation for quarantined.invalid URLs
      if (portal.downloadUrl.includes('quarantined.invalid')) {
        warnings.push('URL is a quarantine placeholder (quarantined.invalid)');
        urlReachable = false;
      } else {
        const urlResult = await validateUrl(portal.downloadUrl, true);
        urlReachable = urlResult.valid;
        urlStatus = urlResult.statusCode;

        if (!urlResult.valid) {
          issues.push(`URL not reachable: ${urlResult.error}`);
        }
      }
    }

    // Check confidence score
    if (portal.confidence < 50) {
      warnings.push(`Low confidence score (${portal.confidence}%)`);
    }

    // Check feature count
    if (portal.featureCount === 0) {
      issues.push('Feature count is 0');
    } else if (portal.featureCount === 1) {
      warnings.push('Feature count is 1 (possible at-large city)');
    } else if (portal.featureCount > 100) {
      warnings.push(`High feature count (${portal.featureCount}) - may be wrong data`);
    }

    // Check last verified date
    const lastVerified = new Date(portal.lastVerified);
    const now = new Date();
    const daysSinceVerified = (now.getTime() - lastVerified.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceVerified > 90) {
      warnings.push(`Entry is stale (${Math.floor(daysSinceVerified)} days since verification)`);
    }
  }

  return {
    fipsValid: fipsResult.valid,
    urlReachable,
    urlStatus,
    issues,
    warnings,
  };
}

/**
 * Execute the get command
 */
export async function getCommand(fips: string, options: GetOptions = {}): Promise<void> {
  const format = options.format || 'table';
  const dataDir = options.dataDir || join(process.cwd(), 'data');

  // Configure audit for history lookup
  configureAudit({ dataDir });

  // Validate FIPS format
  const fipsValidation = validateFips(fips);
  if (!fipsValidation.valid) {
    printError(fipsValidation.error || 'Invalid FIPS');
    process.exit(2);
  }

  try {
    let result: { registry: RegistryName; entry: RegistryEntry } | null = null;

    // If registry specified, search only that registry
    if (options.registry) {
      const filepath = getRegistryPath(options.registry, dataDir);
      const { entries } = await parseNdjson<RegistryEntry>(filepath);
      const entry = entries.get(fips);
      if (entry) {
        result = { registry: options.registry, entry };
      }
    } else {
      // Auto-detect: search all registries
      result = await findEntry(dataDir, fips);
    }

    if (!result) {
      printError(`Entry not found: ${fips}`);
      process.exit(2);
    }

    const { registry, entry } = result;

    // Run validation if requested
    let validation: ValidationResult | undefined;
    if (options.validate) {
      validation = await validateEntry(entry, registry);
    }

    // Get history if requested
    let history: string[] = [];
    if (options.includeHistory) {
      const auditEntries = await queryAuditLog({ fips, limit: 20 });
      history = auditEntries.map(formatAuditEntry);
    }

    // Output based on format
    if (format === 'json') {
      const output: Record<string, unknown> = {
        registry,
        entry,
      };

      if (validation) {
        output.validation = validation;
      }

      if (history.length > 0) {
        output.history = history;
      }

      printOutput(JSON.stringify(output, null, 2));
    } else {
      // Table format
      printOutput(formatEntryAsTable(entry, registry));

      // Print validation results
      if (validation) {
        console.log('');
        console.log('Validation Results');
        console.log('-'.repeat(40));

        if (validation.issues.length === 0 && validation.warnings.length === 0) {
          console.log('All checks passed');
        }

        for (const issue of validation.issues) {
          printError(issue);
        }

        for (const warning of validation.warnings) {
          printWarning(warning);
        }

        if (validation.urlReachable !== undefined) {
          console.log(
            `URL Status: ${validation.urlReachable ? 'Reachable' : 'Unreachable'}` +
              (validation.urlStatus ? ` (${validation.urlStatus})` : '')
          );
        }
      }

      // Print history
      if (history.length > 0) {
        console.log('');
        console.log('Modification History');
        console.log('-'.repeat(40));
        for (const line of history) {
          console.log(line);
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    printError(`Failed to get entry: ${message}`);
    process.exit(2);
  }
}

/**
 * Parse CLI arguments and execute
 */
export function parseGetArgs(args: string[]): { fips: string; options: GetOptions } {
  const options: GetOptions = {};
  let fips = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    if (arg.startsWith('-')) {
      switch (arg) {
        case '--registry':
        case '-r':
          if (nextArg && !nextArg.startsWith('-')) {
            options.registry = nextArg as RegistryName;
            i++;
          }
          break;

        case '--include-history':
        case '--history':
        case '-h':
          options.includeHistory = true;
          break;

        case '--validate':
          options.validate = true;
          break;

        case '--format':
        case '-f':
          if (nextArg && !nextArg.startsWith('-')) {
            options.format = nextArg as 'json' | 'table';
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
    } else if (!fips) {
      fips = arg;
    }
  }

  return { fips, options };
}

/**
 * CLI entry point
 */
export async function main(args: string[]): Promise<void> {
  const { fips, options } = parseGetArgs(args);

  if (!fips) {
    printError('FIPS code is required');
    console.log('');
    console.log('Usage: shadow-atlas registry get <fips> [options]');
    console.log('');
    console.log('Options:');
    console.log('  --registry <name>   Which registry to search (default: auto-detect)');
    console.log('  --include-history   Show modification history from audit log');
    console.log('  --validate          Run validation checks on entry');
    console.log('  --format <fmt>      Output format: json|table (default: table)');
    process.exit(1);
  }

  await getCommand(fips, options);
}
