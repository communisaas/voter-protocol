#!/usr/bin/env tsx
/**
 * International Registry Verification
 *
 * Validates ISO 3166-1 country registry completeness and coverage.
 *
 * VERIFIES:
 * - Total country count (195 countries)
 * - Regional distribution (Americas, Europe, Asia-Pacific, Africa, Middle East)
 * - Provider coverage
 * - ISO code uniqueness and validity
 * - UN member status
 *
 * This subsumes the functionality from src/scripts/verify-195-countries.ts
 * with improved CLI integration and output formatting.
 *
 * Usage:
 *   shadow-atlas validate international
 *   shadow-atlas validate international --region americas
 *   shadow-atlas validate international --format json
 */

import {
  COUNTRIES,
  getCountryByCode,
  getCountriesByRegion,
  getCountriesWithProviders,
  getRegistryStatistics,
  type ContinentalRegion,
  type CountryEntry,
} from '../../../core/registry/iso-3166-countries.js';
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

interface InternationalValidateOptions {
  region?: ContinentalRegion;
  checkProviders: boolean;
  checkUniqueness: boolean;
  format: OutputFormat;
  verbose: boolean;
  json: boolean;
}

// =============================================================================
// Expected Regional Distribution
// =============================================================================

/**
 * Expected country counts per region
 * Based on official UN geoscheme and ISO 3166-1
 */
const EXPECTED_REGIONS: Record<ContinentalRegion, { min: number; max: number }> = {
  'americas': { min: 35, max: 35 },      // Exact count expected
  'europe': { min: 50, max: 50 },        // Exact count expected
  'asia-pacific': { min: 48, max: 48 },  // Exact count expected
  'africa': { min: 54, max: 54 },        // Exact count expected
  'middle-east': { min: 8, max: 15 },    // Flexible (classification varies)
};

// =============================================================================
// CLI Argument Parser
// =============================================================================

function parseArgs(): InternationalValidateOptions {
  const args = process.argv.slice(2);
  const options: InternationalValidateOptions = {
    checkProviders: true,
    checkUniqueness: true,
    format: 'table',
    verbose: false,
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--region':
        options.region = args[++i] as ContinentalRegion;
        break;
      case '--no-providers':
        options.checkProviders = false;
        break;
      case '--no-uniqueness':
        options.checkUniqueness = false;
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
International Registry Verification

Validates ISO 3166-1 country registry completeness and provider coverage.
This ensures the Shadow Atlas has comprehensive global coverage metadata.

Usage:
  shadow-atlas validate international [options]

Options:
  --region <region>      Verify specific region: americas|europe|asia-pacific|africa|middle-east
  --no-providers         Skip provider coverage checks
  --no-uniqueness        Skip ISO code uniqueness validation
  --format <fmt>         Output format: table|json|csv|summary
  --json                 Output as JSON (shorthand for --format json)
  --verbose, -v          Include detailed diagnostics
  --help, -h             Show this help

Validation Checks:
  - Country Count: Verifies 195 countries (193 UN members + 2 observers)
  - Regional Distribution: Validates continental groupings
  - Provider Coverage: Checks which countries have boundary providers
  - ISO Code Uniqueness: Ensures no duplicate alpha-2/alpha-3/numeric codes
  - UN Member Status: Validates UN membership metadata

Examples:
  shadow-atlas validate international
  shadow-atlas validate international --region americas
  shadow-atlas validate international --format json
  shadow-atlas validate international --verbose
`);
}

// =============================================================================
// Validation Logic
// =============================================================================

/**
 * Verify total country count
 */
function checkCountryCount(): ValidationEntry[] {
  const expectedTotal = 195; // 193 UN members + 2 observer states
  const actualTotal = COUNTRIES.length;
  const status = actualTotal === expectedTotal ? 'pass' : 'fail';

  return [
    {
      id: 'country-count',
      name: 'Total Country Count',
      status,
      message: `${actualTotal} countries (expected: ${expectedTotal})`,
      diagnostics: {
        expected: expectedTotal,
        actual: actualTotal,
        unMembers: COUNTRIES.filter(c => c.unMember).length,
        observers: COUNTRIES.filter(c => !c.unMember).length,
      },
      remediation:
        status === 'fail'
          ? 'Update iso-3166-countries.ts to match official ISO 3166-1 registry'
          : undefined,
    },
  ];
}

/**
 * Verify regional distribution
 */
function checkRegionalDistribution(targetRegion?: ContinentalRegion): ValidationEntry[] {
  const entries: ValidationEntry[] = [];
  const stats = getRegistryStatistics();

  const regionsToCheck = targetRegion ? [targetRegion] : Object.keys(EXPECTED_REGIONS) as ContinentalRegion[];

  for (const region of regionsToCheck) {
    const count = stats.byRegion[region];
    const expected = EXPECTED_REGIONS[region];
    const inRange = count >= expected.min && count <= expected.max;

    entries.push({
      id: `region-${region}`,
      name: `${region.charAt(0).toUpperCase() + region.slice(1)} Region`,
      status: inRange ? 'pass' : 'fail',
      message: `${count} countries (expected: ${expected.min}-${expected.max})`,
      diagnostics: {
        region,
        count,
        expectedMin: expected.min,
        expectedMax: expected.max,
        countries: getCountriesByRegion(region).map(c => c.code),
      },
      remediation: inRange
        ? undefined
        : `Review ${region} classification in iso-3166-countries.ts`,
    });
  }

  return entries;
}

/**
 * Check provider coverage
 */
function checkProviderCoverage(): ValidationEntry[] {
  const entries: ValidationEntry[] = [];
  const withProviders = getCountriesWithProviders();
  const stats = getRegistryStatistics();

  // Add summary entry
  entries.push({
    id: 'provider-coverage',
    name: 'Boundary Provider Coverage',
    status: withProviders.length >= 4 ? 'pass' : 'warn',
    message: `${withProviders.length} countries with providers (${stats.providerCoverage})`,
    diagnostics: {
      total: COUNTRIES.length,
      withProviders: withProviders.length,
      coveragePercent: stats.providerCoverage,
      roadmap: {
        phase1: { countries: 4, target: 'US, CA, GB, AU' },
        phase2: { countries: 27, target: '+ EU countries' },
        phase3: { countries: 'G20', target: '+ major democracies' },
        phase4: { countries: 195, target: 'Global coverage' },
      },
    },
  });

  // List countries with providers
  for (const code of withProviders) {
    const country = getCountryByCode(code);
    if (country) {
      entries.push({
        id: `provider-${code}`,
        name: `${country.shortName} (${code})`,
        status: 'pass',
        message: `Provider: Active (${country.electoralSystem || 'unknown'} system)`,
        diagnostics: {
          code: country.code,
          code3: country.code3,
          region: country.region,
          electoralSystem: country.electoralSystem,
        },
      });
    }
  }

  return entries;
}

/**
 * Check ISO code uniqueness
 */
function checkCodeUniqueness(): ValidationEntry[] {
  const entries: ValidationEntry[] = [];

  const code2Set = new Set<string>();
  const code3Set = new Set<string>();
  const numericSet = new Set<string>();

  const duplicates: { type: string; code: string; country: string }[] = [];

  for (const country of COUNTRIES) {
    // Check alpha-2
    if (code2Set.has(country.code)) {
      duplicates.push({
        type: 'alpha-2',
        code: country.code,
        country: country.shortName,
      });
    }
    code2Set.add(country.code);

    // Check alpha-3
    if (code3Set.has(country.code3)) {
      duplicates.push({
        type: 'alpha-3',
        code: country.code3,
        country: country.shortName,
      });
    }
    code3Set.add(country.code3);

    // Check numeric
    if (numericSet.has(country.numeric)) {
      duplicates.push({
        type: 'numeric',
        code: country.numeric,
        country: country.shortName,
      });
    }
    numericSet.add(country.numeric);
  }

  entries.push({
    id: 'iso-code-uniqueness',
    name: 'ISO Code Uniqueness',
    status: duplicates.length === 0 ? 'pass' : 'fail',
    message:
      duplicates.length === 0
        ? `All ISO codes unique (${code2Set.size} alpha-2, ${code3Set.size} alpha-3, ${numericSet.size} numeric)`
        : `${duplicates.length} duplicate codes found`,
    diagnostics: {
      alpha2Count: code2Set.size,
      alpha3Count: code3Set.size,
      numericCount: numericSet.size,
      duplicates,
    },
    remediation:
      duplicates.length > 0
        ? 'Fix duplicate ISO codes in iso-3166-countries.ts'
        : undefined,
  });

  return entries;
}

/**
 * Check UN member status
 */
function checkUnMemberStatus(): ValidationEntry[] {
  const entries: ValidationEntry[] = [];
  const unMembers = COUNTRIES.filter(c => c.unMember);
  const nonMembers = COUNTRIES.filter(c => !c.unMember);

  const expectedUnMembers = 193;
  const status = unMembers.length === expectedUnMembers ? 'pass' : 'warn';

  entries.push({
    id: 'un-member-status',
    name: 'UN Member Status',
    status,
    message: `${unMembers.length} UN members (expected: ${expectedUnMembers})`,
    diagnostics: {
      unMembers: unMembers.length,
      expected: expectedUnMembers,
      nonMembers: nonMembers.map(c => ({
        code: c.code,
        name: c.shortName,
        notes: c.notes || 'No notes',
      })),
    },
  });

  // List non-members
  for (const country of nonMembers) {
    entries.push({
      id: `non-member-${country.code}`,
      name: `${country.shortName} (${country.code})`,
      status: 'skip',
      message: country.notes || 'Non-UN member state',
      diagnostics: {
        code: country.code,
        region: country.region,
        notes: country.notes,
      },
    });
  }

  return entries;
}

/**
 * Sample lookups to verify data integrity
 */
function checkSampleLookups(): ValidationEntry[] {
  const samples = [
    { code: 'US', expected: 'United States' },
    { code: 'GB', expected: 'United Kingdom' },
    { code: 'JP', expected: 'Japan' },
    { code: 'BR', expected: 'Brazil' },
    { code: 'ZA', expected: 'South Africa' },
    { code: 'AE', expected: 'UAE' },
  ];

  const entries: ValidationEntry[] = [];
  let passCount = 0;

  for (const sample of samples) {
    const country = getCountryByCode(sample.code);
    const match = country?.shortName === sample.expected;

    if (match) passCount++;

    entries.push({
      id: `lookup-${sample.code}`,
      name: `Lookup ${sample.code}`,
      status: match ? 'pass' : 'fail',
      message: match
        ? `Resolved to ${country?.shortName}`
        : `Expected ${sample.expected}, got ${country?.shortName || 'NOT FOUND'}`,
      diagnostics: {
        code: sample.code,
        expected: sample.expected,
        actual: country?.shortName,
        found: !!country,
      },
      remediation: match ? undefined : 'Check country data in iso-3166-countries.ts',
    });
  }

  // Add summary
  entries.unshift({
    id: 'sample-lookups',
    name: 'Sample Lookups',
    status: passCount === samples.length ? 'pass' : 'fail',
    message: `${passCount}/${samples.length} sample lookups succeeded`,
    diagnostics: {
      total: samples.length,
      passed: passCount,
      failed: samples.length - passCount,
    },
  });

  return entries;
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const options = parseArgs();
  let entries: ValidationEntry[] = [];

  try {
    // 1. Country count verification
    entries.push(...checkCountryCount());

    // 2. Regional distribution
    entries.push(...checkRegionalDistribution(options.region));

    // 3. Provider coverage
    if (options.checkProviders) {
      entries.push(...checkProviderCoverage());
    }

    // 4. ISO code uniqueness
    if (options.checkUniqueness) {
      entries.push(...checkCodeUniqueness());
    }

    // 5. UN member status
    entries.push(...checkUnMemberStatus());

    // 6. Sample lookups
    if (options.verbose) {
      entries.push(...checkSampleLookups());
    }

    // Build and format report
    const report = buildReport(
      'International Registry Verification',
      'international',
      entries,
      {
        region: options.region,
        checkProviders: options.checkProviders,
        checkUniqueness: options.checkUniqueness,
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
export {
  checkCountryCount,
  checkRegionalDistribution,
  checkProviderCoverage,
  checkCodeUniqueness,
  checkUnMemberStatus,
  checkSampleLookups,
};
export type { InternationalValidateOptions };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
