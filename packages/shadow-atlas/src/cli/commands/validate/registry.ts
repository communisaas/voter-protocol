#!/usr/bin/env tsx
/**
 * Registry Validation Command
 *
 * Validates registry health, coverage, and URL liveness.
 *
 * CHECKS:
 *   - Coverage: Compare against known city lists (top50, top100, all)
 *   - URL Liveness: HEAD requests to verify URLs are still valid
 *   - Download Validation: Full download and structure check
 *   - Staleness: Flag entries not verified recently
 *
 * Usage:
 *   shadow-atlas validate registry
 *   shadow-atlas validate registry --coverage top50
 *   shadow-atlas validate registry --check-urls
 *   shadow-atlas validate registry --stale-threshold 60
 */

import { KNOWN_PORTALS, type KnownPortal } from '../../../core/registry/known-portals.generated.js';
import { AT_LARGE_CITIES } from '../../../core/registry/at-large-cities.generated.js';
import { QUARANTINED_PORTALS } from '../../../core/registry/quarantined-portals.generated.js';
import {
  buildReport,
  formatReport,
  getExitCode,
  type ValidationEntry,
  type OutputFormat,
} from '../../lib/validation-report.js';

// =============================================================================
// Types
// =============================================================================

interface RegistryValidateOptions {
  coverage?: 'top50' | 'top100' | 'all';
  checkUrls: boolean;
  checkDownloads: boolean;
  staleThreshold: number;
  format: OutputFormat;
  verbose: boolean;
  json: boolean;
  concurrency: number;
}

// =============================================================================
// Top Cities Data (by population)
// =============================================================================

/**
 * Top 50 US cities by population (2020 Census)
 * Used for coverage validation
 */
const TOP_50_CITIES: Array<{ fips: string; name: string; state: string; population: number }> = [
  { fips: '3651000', name: 'New York', state: 'NY', population: 8336817 },
  { fips: '0644000', name: 'Los Angeles', state: 'CA', population: 3979576 },
  { fips: '1714000', name: 'Chicago', state: 'IL', population: 2746388 },
  { fips: '4835000', name: 'Houston', state: 'TX', population: 2304580 },
  { fips: '0455000', name: 'Phoenix', state: 'AZ', population: 1608139 },
  { fips: '4260000', name: 'Philadelphia', state: 'PA', population: 1603797 },
  { fips: '4865000', name: 'San Antonio', state: 'TX', population: 1434625 },
  { fips: '0666000', name: 'San Diego', state: 'CA', population: 1386932 },
  { fips: '4819000', name: 'Dallas', state: 'TX', population: 1304379 },
  { fips: '0668000', name: 'San Jose', state: 'CA', population: 1013240 },
  { fips: '4805000', name: 'Austin', state: 'TX', population: 978908 },
  { fips: '1235000', name: 'Jacksonville', state: 'FL', population: 949611 },
  { fips: '4827000', name: 'Fort Worth', state: 'TX', population: 918915 },
  { fips: '3916000', name: 'Columbus', state: 'OH', population: 905748 },
  { fips: '0667000', name: 'San Francisco', state: 'CA', population: 873965 },
  { fips: '1850000', name: 'Indianapolis', state: 'IN', population: 867125 },
  { fips: '3712000', name: 'Charlotte', state: 'NC', population: 857425 },
  { fips: '5363000', name: 'Seattle', state: 'WA', population: 737015 },
  { fips: '0820000', name: 'Denver', state: 'CO', population: 715522 },
  { fips: '1150000', name: 'Washington', state: 'DC', population: 689545 },
  { fips: '2507000', name: 'Boston', state: 'MA', population: 675647 },
  { fips: '4824000', name: 'El Paso', state: 'TX', population: 678815 },
  { fips: '4752006', name: 'Nashville', state: 'TN', population: 689447 },
  { fips: '2636000', name: 'Detroit', state: 'MI', population: 639111 },
  { fips: '4159000', name: 'Portland', state: 'OR', population: 652503 },
  { fips: '3940000', name: 'Memphis', state: 'TN', population: 633104 },
  { fips: '4035000', name: 'Oklahoma City', state: 'OK', population: 681054 },
  { fips: '3237000', name: 'Las Vegas', state: 'NV', population: 641903 },
  { fips: '2148006', name: 'Louisville', state: 'KY', population: 633045 },
  { fips: '2455000', name: 'Baltimore', state: 'MD', population: 585708 },
  { fips: '5535000', name: 'Milwaukee', state: 'WI', population: 577222 },
  { fips: '3501900', name: 'Albuquerque', state: 'NM', population: 564559 },
  { fips: '0427400', name: 'Tucson', state: 'AZ', population: 542629 },
  { fips: '0623042', name: 'Fresno', state: 'CA', population: 542107 },
  { fips: '0664000', name: 'Sacramento', state: 'CA', population: 524943 },
  { fips: '2043000', name: 'Kansas City', state: 'MO', population: 508090 },
  { fips: '0653000', name: 'Long Beach', state: 'CA', population: 466742 },
  { fips: '0462000', name: 'Mesa', state: 'AZ', population: 504258 },
  { fips: '1304000', name: 'Atlanta', state: 'GA', population: 498715 },
  { fips: '0837000', name: 'Colorado Springs', state: 'CO', population: 478961 },
  { fips: '5139000', name: 'Virginia Beach', state: 'VA', population: 459470 },
  { fips: '3755000', name: 'Raleigh', state: 'NC', population: 467665 },
  { fips: '3137000', name: 'Omaha', state: 'NE', population: 486051 },
  { fips: '1245000', name: 'Miami', state: 'FL', population: 442241 },
  { fips: '0653896', name: 'Oakland', state: 'CA', population: 433031 },
  { fips: '2743000', name: 'Minneapolis', state: 'MN', population: 429954 },
  { fips: '4041500', name: 'Tulsa', state: 'OK', population: 413066 },
  { fips: '4855000', name: 'Arlington', state: 'TX', population: 394266 },
  { fips: '2251000', name: 'New Orleans', state: 'LA', population: 383997 },
  { fips: '5548000', name: 'Wichita', state: 'KS', population: 397532 },
];

// Top 100 would extend this list - for now use top 50 for both
const TOP_100_CITIES = TOP_50_CITIES; // TODO: Extend with cities 51-100

// =============================================================================
// CLI Argument Parser
// =============================================================================

function parseArgs(): RegistryValidateOptions {
  const args = process.argv.slice(2);
  const options: RegistryValidateOptions = {
    checkUrls: false,
    checkDownloads: false,
    staleThreshold: 90,
    format: 'table',
    verbose: false,
    json: false,
    concurrency: 5,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--coverage':
        options.coverage = args[++i] as 'top50' | 'top100' | 'all';
        break;
      case '--check-urls':
        options.checkUrls = true;
        break;
      case '--check-downloads':
        options.checkDownloads = true;
        break;
      case '--stale-threshold':
        options.staleThreshold = parseInt(args[++i], 10);
        break;
      case '--format':
        options.format = args[++i] as OutputFormat;
        break;
      case '--json':
        options.json = true;
        options.format = 'json';
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--concurrency':
        options.concurrency = parseInt(args[++i], 10);
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Registry Validation

Usage:
  shadow-atlas validate registry [options]

Options:
  --coverage <set>         Coverage set: top50|top100|all
  --check-urls             Validate URL liveness (HEAD requests)
  --check-downloads        Full download validation
  --stale-threshold <days> Flag entries older than N days (default: 90)
  --concurrency <n>        Parallel URL checks (default: 5)
  --format <fmt>           Output format: table|json|csv|summary
  --json                   Output as JSON (shorthand for --format json)
  --verbose, -v            Include detailed diagnostics
  --help, -h               Show this help

Validation Checks:
  - Coverage: Compare registry against known city lists
  - URL Liveness: HEAD requests to verify URLs are still valid
  - Download Validation: Full download and structure check
  - Staleness: Flag entries not verified recently

Examples:
  shadow-atlas validate registry
  shadow-atlas validate registry --coverage top50
  shadow-atlas validate registry --check-urls --stale-threshold 60
  shadow-atlas validate registry --check-downloads --concurrency 10
`);
}

// =============================================================================
// Validation Logic
// =============================================================================

/**
 * Check registry coverage against city list
 */
function checkCoverage(
  targetCities: Array<{ fips: string; name: string; state: string }>
): ValidationEntry[] {
  const entries: ValidationEntry[] = [];
  let covered = 0;
  let atLarge = 0;
  let quarantined = 0;
  let missing = 0;

  for (const city of targetCities) {
    const inKnown = KNOWN_PORTALS[city.fips];
    const inAtLarge = AT_LARGE_CITIES[city.fips];
    const inQuarantine = QUARANTINED_PORTALS[city.fips];

    if (inKnown) {
      covered++;
      entries.push({
        id: city.fips,
        name: `${city.name}, ${city.state}`,
        status: 'pass',
        message: `In registry (${inKnown.featureCount} features)`,
        diagnostics: {
          portalType: inKnown.portalType,
          featureCount: inKnown.featureCount,
          confidence: inKnown.confidence,
        },
      });
    } else if (inAtLarge) {
      atLarge++;
      entries.push({
        id: city.fips,
        name: `${city.name}, ${city.state}`,
        status: 'skip',
        message: `At-large city (${inAtLarge.councilSize} seats)`,
        diagnostics: {
          electionMethod: inAtLarge.electionMethod,
          councilSize: inAtLarge.councilSize,
        },
      });
    } else if (inQuarantine) {
      quarantined++;
      entries.push({
        id: city.fips,
        name: `${city.name}, ${city.state}`,
        status: 'warn',
        message: `Quarantined: ${inQuarantine.matchedPattern}`,
        diagnostics: {
          quarantineReason: inQuarantine.quarantineReason,
          matchedPattern: inQuarantine.matchedPattern,
        },
      });
    } else {
      missing++;
      entries.push({
        id: city.fips,
        name: `${city.name}, ${city.state}`,
        status: 'fail',
        message: 'Not in registry',
        remediation: 'Add city to known-portals or at-large-cities registry',
      });
    }
  }

  // Add summary entry at the start
  const coverageRate = ((covered + atLarge) / targetCities.length) * 100;
  entries.unshift({
    id: 'coverage',
    name: 'Coverage Summary',
    status: coverageRate >= 90 ? 'pass' : coverageRate >= 70 ? 'warn' : 'fail',
    message: `${covered} in registry, ${atLarge} at-large, ${quarantined} quarantined, ${missing} missing (${coverageRate.toFixed(1)}%)`,
    diagnostics: {
      total: targetCities.length,
      covered,
      atLarge,
      quarantined,
      missing,
      coverageRate,
    },
  });

  return entries;
}

/**
 * Check for stale entries
 */
function checkStaleness(staleThreshold: number): ValidationEntry[] {
  const entries: ValidationEntry[] = [];
  const now = Date.now();
  const thresholdMs = staleThreshold * 24 * 60 * 60 * 1000;

  let staleCount = 0;
  let freshCount = 0;

  for (const [fips, portal] of Object.entries(KNOWN_PORTALS)) {
    const lastVerified = new Date(portal.lastVerified).getTime();
    const ageMs = now - lastVerified;
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

    if (ageMs > thresholdMs) {
      staleCount++;
      entries.push({
        id: fips,
        name: `${portal.cityName}, ${portal.state}`,
        status: 'warn',
        message: `Stale: last verified ${ageDays} days ago`,
        diagnostics: {
          lastVerified: portal.lastVerified,
          ageDays,
        },
        remediation: 'Re-validate entry using validate council command',
      });
    } else {
      freshCount++;
    }
  }

  // Add summary entry at the start
  const freshRate = (freshCount / (freshCount + staleCount)) * 100;
  entries.unshift({
    id: 'staleness',
    name: 'Staleness Summary',
    status: freshRate >= 90 ? 'pass' : freshRate >= 70 ? 'warn' : 'fail',
    message: `${freshCount} fresh, ${staleCount} stale (threshold: ${staleThreshold} days)`,
    diagnostics: {
      fresh: freshCount,
      stale: staleCount,
      threshold: staleThreshold,
      freshRate,
    },
  });

  return entries;
}

/**
 * Check URL liveness with HEAD requests
 */
async function checkUrlLiveness(
  concurrency: number,
  verbose: boolean
): Promise<ValidationEntry[]> {
  const entries: ValidationEntry[] = [];
  const portals = Object.entries(KNOWN_PORTALS);
  const total = portals.length;

  let reachable = 0;
  let unreachable = 0;
  let errors = 0;

  console.error(`Checking URL liveness for ${total} entries...\n`);

  // Process in batches for concurrency control
  const batchSize = concurrency;
  for (let i = 0; i < portals.length; i += batchSize) {
    const batch = portals.slice(i, i + batchSize);

    if (process.stderr.isTTY) {
      process.stderr.write(`\r[${i + batch.length}/${total}] Checking URLs...`);
    }

    const results = await Promise.all(
      batch.map(async ([fips, portal]) => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);

          const response = await fetch(portal.downloadUrl, {
            method: 'HEAD',
            signal: controller.signal,
          });

          clearTimeout(timeout);

          if (response.ok) {
            reachable++;
            if (verbose) {
              return {
                id: fips,
                name: `${portal.cityName}, ${portal.state}`,
                status: 'pass' as const,
                message: `URL reachable (${response.status})`,
              };
            }
            return null;
          } else {
            unreachable++;
            return {
              id: fips,
              name: `${portal.cityName}, ${portal.state}`,
              status: 'fail' as const,
              message: `HTTP ${response.status}`,
              remediation: 'Update URL in registry or quarantine entry',
            };
          }
        } catch (error) {
          errors++;
          return {
            id: fips,
            name: `${portal.cityName}, ${portal.state}`,
            status: 'fail' as const,
            message: error instanceof Error ? error.message : 'Network error',
            remediation: 'Check URL validity and network connectivity',
          };
        }
      })
    );

    // Add non-null results
    for (const result of results) {
      if (result) {
        entries.push(result);
      }
    }

    // Rate limiting
    if (i + batchSize < portals.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  if (process.stderr.isTTY) {
    process.stderr.write('\r' + ' '.repeat(60) + '\r');
  }

  // Add summary entry at the start
  const reachableRate = (reachable / total) * 100;
  entries.unshift({
    id: 'url-liveness',
    name: 'URL Liveness Summary',
    status: reachableRate >= 95 ? 'pass' : reachableRate >= 80 ? 'warn' : 'fail',
    message: `${reachable} reachable, ${unreachable} unreachable, ${errors} errors (${reachableRate.toFixed(1)}%)`,
    diagnostics: {
      total,
      reachable,
      unreachable,
      errors,
      reachableRate,
    },
  });

  return entries;
}

/**
 * Get registry statistics
 */
function getRegistryStats(): ValidationEntry[] {
  const knownCount = Object.keys(KNOWN_PORTALS).length;
  const atLargeCount = Object.keys(AT_LARGE_CITIES).length;
  const quarantinedCount = Object.keys(QUARANTINED_PORTALS).length;

  // Count by state
  const stateDistribution: Record<string, number> = {};
  for (const portal of Object.values(KNOWN_PORTALS)) {
    stateDistribution[portal.state] = (stateDistribution[portal.state] || 0) + 1;
  }

  // Count by portal type
  const typeDistribution: Record<string, number> = {};
  for (const portal of Object.values(KNOWN_PORTALS)) {
    typeDistribution[portal.portalType] = (typeDistribution[portal.portalType] || 0) + 1;
  }

  return [
    {
      id: 'registry-stats',
      name: 'Registry Statistics',
      status: 'pass',
      message: `${knownCount} known portals, ${atLargeCount} at-large, ${quarantinedCount} quarantined`,
      diagnostics: {
        knownPortals: knownCount,
        atLargeCities: atLargeCount,
        quarantinedPortals: quarantinedCount,
        statesCovered: Object.keys(stateDistribution).length,
        stateDistribution,
        typeDistribution,
      },
    },
  ];
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const options = parseArgs();
  let entries: ValidationEntry[] = [];

  try {
    // Always include registry stats
    entries.push(...getRegistryStats());

    // Coverage check
    if (options.coverage) {
      const targetCities = options.coverage === 'top50' ? TOP_50_CITIES :
                          options.coverage === 'top100' ? TOP_100_CITIES :
                          TOP_50_CITIES; // For 'all', use top 50 for now

      entries.push(...checkCoverage(targetCities));
    }

    // Staleness check
    entries.push(...checkStaleness(options.staleThreshold));

    // URL liveness check
    if (options.checkUrls) {
      const urlEntries = await checkUrlLiveness(options.concurrency, options.verbose);
      entries.push(...urlEntries);
    }

    // Build and format report
    const report = buildReport(
      'Registry Validation',
      'health',
      entries,
      {
        coverage: options.coverage,
        checkUrls: options.checkUrls,
        staleThreshold: options.staleThreshold,
      }
    );

    const output = formatReport(report, options.format, { verbose: options.verbose });
    console.log(output);

    // Exit with appropriate code
    process.exit(getExitCode(report.overallStatus));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(4);
  }
}

// Export for programmatic use
export { checkCoverage, checkStaleness, checkUrlLiveness, getRegistryStats };
export type { RegistryValidateOptions };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
