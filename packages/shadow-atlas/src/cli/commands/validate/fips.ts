#!/usr/bin/env tsx
/**
 * FIPS Resolution Validation Command
 *
 * Tests FIPS resolution logic for ArcGIS Feature Service URLs.
 * Validates resolver edge cases: counties, parishes, consolidated cities, Hawaii, etc.
 *
 * TEST SUITES:
 *   edge-cases           - County districts, parishes, consolidated city-counties
 *   consolidated-cities  - San Francisco, Denver, Indianapolis, Louisville
 *   parishes            - Louisiana parish council districts
 *   hawaii              - Hawaiian administrative structure (Honolulu)
 *   all                 - All predefined test cases
 *
 * Usage:
 *   shadow-atlas validate fips --url <arcgis-url>
 *   shadow-atlas validate fips --test-suite edge-cases
 *   shadow-atlas validate fips --from-file tests.jsonl
 *   shadow-atlas validate fips --test-suite all --format junit
 */

import { readFileSync } from 'node:fs';
import { resolveFips, type FipsResolution } from '../../../validators/council/fips-resolver.js';
import {
  buildReport,
  formatReport,
  getExitCode,
  type ValidationEntry,
  type OutputFormat,
  type ValidationReport,
} from '../../lib/validation-report.js';

// =============================================================================
// Types
// =============================================================================

interface FipsValidateOptions {
  url?: string;
  testSuite?: TestSuiteName;
  fromFile?: string;
  format: OutputFormat | 'junit';
  verbose: boolean;
  json: boolean;
  name?: string;
}

type TestSuiteName = 'edge-cases' | 'consolidated-cities' | 'parishes' | 'hawaii' | 'all';

interface TestCase {
  name: string;
  url: string;
  expectedType?: 'CITY' | 'COUNTY' | 'STATE';
  expectedName: string;
  expectedState: string;
  expectedFips?: string;
  notes?: string;
}

// =============================================================================
// Test Suite Definitions
// =============================================================================

/**
 * Predefined test cases covering FIPS resolution edge cases
 */
const TEST_SUITES: Record<TestSuiteName, TestCase[]> = {
  'edge-cases': [
    // County District (North Carolina) - Previously NO_CENSUS_PLACE
    {
      name: 'Sampson County Commissioner Districts',
      url: 'https://services3.arcgis.com/fM4kjZmPOS4ay2Ff/arcgis/rest/services/Sampson_County_Viewer/FeatureServer/18',
      expectedType: 'COUNTY',
      expectedName: 'Sampson County',
      expectedState: 'NC',
      notes: 'County-level governance, not a place',
    },
    // Parish (Louisiana) - Previously NO_CENSUS_PLACE
    {
      name: 'Terrebonne Council Districts',
      url: 'https://services2.arcgis.com/LJwIycC0yIuqCBxq/arcgis/rest/services/Terrebonne_Parish_Lookup_Map_WFL1/FeatureServer/1',
      expectedType: 'COUNTY',
      expectedName: 'Terrebonne Parish',
      expectedState: 'LA',
      notes: 'Parish = County equivalent in Louisiana',
    },
    // Consolidated City (Indiana) - Indianapolis
    {
      name: 'Indy City County Council Districts',
      url: 'https://services5.arcgis.com/xBsPUWYKO89lShIO/arcgis/rest/services/Indy_City_County_Council_Districts/FeatureServer/0',
      expectedType: 'CITY',
      expectedName: 'Indianapolis city (balance)',
      expectedState: 'IN',
      notes: 'Consolidated city-county government',
    },
    // Consolidated City (Kentucky) - Louisville
    {
      name: 'Louisville Metro Council Districts',
      url: 'https://services1.arcgis.com/cRvLdSPAsRupRo7I/arcgis/rest/services/Metro_Council_Districts_Updated/FeatureServer/0',
      expectedType: 'CITY',
      expectedName: 'Louisville/Jefferson County metro government (balance)',
      expectedState: 'KY',
      notes: 'Louisville-Jefferson County Metro Government',
    },
    // Hawaii (Honolulu) - Previously OUTSIDE_CONUS / Geocoder fail
    {
      name: 'Honolulu City Council Districts',
      url: 'https://services.arcgis.com/tNJpAOha4mODLkXz/arcgis/rest/services/City_Council_2023/FeatureServer/0',
      expectedType: 'CITY',
      expectedName: 'Honolulu',
      expectedState: 'HI',
      notes: 'Hawaii administrative structure, handled as county in some datasets',
    },
  ],

  'consolidated-cities': [
    // San Francisco (California)
    {
      name: 'San Francisco Board of Supervisors',
      url: 'https://services3.arcgis.com/2uGYaBfVtW0F3rYR/arcgis/rest/services/Supervisor_Districts/FeatureServer/0',
      expectedType: 'CITY',
      expectedName: 'San Francisco',
      expectedState: 'CA',
      expectedFips: '0667000',
      notes: 'City and County of San Francisco',
    },
    // Denver (Colorado)
    {
      name: 'Denver City Council Districts',
      url: 'https://services3.arcgis.com/rKIM834JYFvpGDVU/arcgis/rest/services/City_Council_Districts/FeatureServer/0',
      expectedType: 'CITY',
      expectedName: 'Denver',
      expectedState: 'CO',
      notes: 'Consolidated city-county',
    },
    // Indianapolis (Indiana)
    {
      name: 'Indy City County Council Districts',
      url: 'https://services5.arcgis.com/xBsPUWYKO89lShIO/arcgis/rest/services/Indy_City_County_Council_Districts/FeatureServer/0',
      expectedType: 'CITY',
      expectedName: 'Indianapolis city (balance)',
      expectedState: 'IN',
      notes: 'Unigov consolidation',
    },
    // Louisville (Kentucky)
    {
      name: 'Louisville Metro Council Districts',
      url: 'https://services1.arcgis.com/cRvLdSPAsRupRo7I/arcgis/rest/services/Metro_Council_Districts_Updated/FeatureServer/0',
      expectedType: 'CITY',
      expectedName: 'Louisville/Jefferson County metro government (balance)',
      expectedState: 'KY',
      notes: 'Louisville-Jefferson County merger',
    },
  ],

  parishes: [
    // Terrebonne Parish
    {
      name: 'Terrebonne Council Districts',
      url: 'https://services2.arcgis.com/LJwIycC0yIuqCBxq/arcgis/rest/services/Terrebonne_Parish_Lookup_Map_WFL1/FeatureServer/1',
      expectedType: 'COUNTY',
      expectedName: 'Terrebonne Parish',
      expectedState: 'LA',
      notes: 'Louisiana parish governance',
    },
    // East Baton Rouge Parish
    {
      name: 'East Baton Rouge Parish Council',
      url: 'https://services.arcgis.com/37mzP5U0KppoOmU6/arcgis/rest/services/Metro_Council_Districts/FeatureServer/0',
      expectedType: 'COUNTY',
      expectedName: 'East Baton Rouge',
      expectedState: 'LA',
      notes: 'Parish-city consolidated government',
    },
  ],

  hawaii: [
    // Honolulu (City and County)
    {
      name: 'Honolulu City Council Districts',
      url: 'https://services.arcgis.com/tNJpAOha4mODLkXz/arcgis/rest/services/City_Council_2023/FeatureServer/0',
      expectedType: 'CITY',
      expectedName: 'Honolulu',
      expectedState: 'HI',
      notes: 'City and County of Honolulu',
    },
    // Maui County Council
    {
      name: 'Maui County Council Residency Areas',
      url: 'https://services1.arcgis.com/bAz0vTy0MoZKU9nZ/arcgis/rest/services/County_Council_Residency_Areas/FeatureServer/0',
      expectedType: 'COUNTY',
      expectedName: 'Maui',
      expectedState: 'HI',
      notes: 'Hawaiian county governance',
    },
  ],

  all: [], // Populated below by combining all suites
};

// Combine all suites into 'all'
TEST_SUITES.all = [
  ...TEST_SUITES['edge-cases'],
  ...TEST_SUITES['consolidated-cities'],
  ...TEST_SUITES.parishes,
  ...TEST_SUITES.hawaii,
];

// =============================================================================
// CLI Argument Parser
// =============================================================================

function parseArgs(): FipsValidateOptions {
  const args = process.argv.slice(2);
  const options: FipsValidateOptions = {
    format: 'table',
    verbose: false,
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--url':
        options.url = args[++i];
        break;
      case '--name':
        options.name = args[++i];
        break;
      case '--test-suite':
        options.testSuite = args[++i] as TestSuiteName;
        break;
      case '--from-file':
        options.fromFile = args[++i];
        break;
      case '--format':
        options.format = args[++i] as OutputFormat | 'junit';
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
FIPS Resolution Validation

Usage:
  shadow-atlas validate fips [options]

Options:
  --url <url>             Test single ArcGIS Feature Service URL
  --name <name>           Layer name (required with --url)
  --test-suite <name>     Run predefined test suite
  --from-file <path>      Load test cases from JSONL file
  --format <fmt>          Output format: table|json|csv|summary|junit
  --json                  Output as JSON (shorthand for --format json)
  --verbose, -v           Include detailed resolution diagnostics
  --help, -h              Show this help

Test Suites:
  edge-cases             County districts, parishes, consolidated city-counties
  consolidated-cities    San Francisco, Denver, Indianapolis, Louisville
  parishes               Louisiana parish council districts
  hawaii                 Hawaiian administrative structure (Honolulu, Maui)
  all                    All predefined test cases

JSONL File Format:
  Each line should be a JSON object with:
  {
    "name": "Test Name",
    "url": "https://services.arcgis.com/...",
    "expectedName": "City Name",
    "expectedState": "CA",
    "expectedFips": "0666000" (optional)
  }

Examples:
  # Test single URL
  shadow-atlas validate fips --url "https://..." --name "City Council"

  # Run edge cases suite
  shadow-atlas validate fips --test-suite edge-cases

  # Run all tests with verbose output
  shadow-atlas validate fips --test-suite all --verbose

  # Load tests from file with JUnit output
  shadow-atlas validate fips --from-file tests.jsonl --format junit

  # CI/CD integration
  shadow-atlas validate fips --test-suite all --format junit > results.xml
`);
}

// =============================================================================
// Validation Logic
// =============================================================================

/**
 * Validate a single test case
 */
async function validateTestCase(testCase: TestCase): Promise<ValidationEntry> {
  const startTime = Date.now();

  try {
    const resolution = await resolveFips(testCase.url, testCase.name);

    if (!resolution) {
      return {
        id: testCase.url.slice(-20),
        name: testCase.name,
        status: 'fail',
        message: 'Could not resolve FIPS',
        diagnostics: {
          url: testCase.url,
          expected: {
            name: testCase.expectedName,
            state: testCase.expectedState,
            fips: testCase.expectedFips,
          },
        },
        remediation: 'FIPS resolver returned null. Check URL accessibility and metadata availability.',
        durationMs: Date.now() - startTime,
      };
    }

    // Check resolution against expectations
    const nameMatch = matchesName(resolution.name, testCase.expectedName);
    const stateMatch = resolution.state === testCase.expectedState;
    const fipsMatch = !testCase.expectedFips || resolution.fips === testCase.expectedFips;

    const allMatch = nameMatch && stateMatch && fipsMatch;

    // Build diagnostics
    const diagnostics: Record<string, unknown> = {
      url: testCase.url,
      resolution: {
        fips: resolution.fips,
        name: resolution.name,
        state: resolution.state,
        method: resolution.method,
        confidence: resolution.confidence,
      },
      expected: {
        name: testCase.expectedName,
        state: testCase.expectedState,
        fips: testCase.expectedFips,
      },
      checks: {
        nameMatch,
        stateMatch,
        fipsMatch,
      },
    };

    if (testCase.notes) {
      diagnostics.notes = testCase.notes;
    }

    let status: 'pass' | 'fail' | 'warn' = allMatch ? 'pass' : 'fail';
    let message: string;

    if (allMatch) {
      message = `Resolved via ${resolution.method} (confidence: ${resolution.confidence}%)`;
    } else {
      const failures: string[] = [];
      if (!nameMatch) failures.push(`name mismatch: got "${resolution.name}", expected "${testCase.expectedName}"`);
      if (!stateMatch) failures.push(`state mismatch: got "${resolution.state}", expected "${testCase.expectedState}"`);
      if (!fipsMatch) failures.push(`FIPS mismatch: got "${resolution.fips}", expected "${testCase.expectedFips}"`);
      message = failures.join('; ');
    }

    return {
      id: testCase.expectedFips || testCase.url.slice(-20),
      name: testCase.name,
      status,
      tier: resolution.method,
      message,
      diagnostics,
      remediation: allMatch ? undefined : 'Check expected values or update FIPS resolver patterns.',
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: testCase.url.slice(-20),
      name: testCase.name,
      status: 'fail',
      message: `Error: ${message}`,
      diagnostics: {
        url: testCase.url,
        error: message,
      },
      remediation: 'Check URL validity and network connectivity.',
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Check if resolved name matches expected name (fuzzy matching)
 */
function matchesName(resolved: string, expected: string): boolean {
  // Normalize for comparison
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const resolvedNorm = normalize(resolved);
  const expectedNorm = normalize(expected);

  // Exact match
  if (resolvedNorm === expectedNorm) return true;

  // Check if resolved contains expected (or vice versa)
  if (resolvedNorm.includes(expectedNorm) || expectedNorm.includes(resolvedNorm)) return true;

  // Check first word match (e.g., "Sampson County" vs "Sampson")
  const firstWordResolved = resolvedNorm.split(' ')[0];
  const firstWordExpected = expectedNorm.split(' ')[0];
  if (firstWordResolved === firstWordExpected && firstWordResolved.length > 3) return true;

  return false;
}

/**
 * Load test cases from JSONL file
 */
function loadTestCases(filepath: string): TestCase[] {
  const content = readFileSync(filepath, 'utf-8');
  const lines = content.trim().split('\n');
  const testCases: TestCase[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue; // Skip empty lines and comments

    try {
      const testCase = JSON.parse(line) as TestCase;
      testCases.push(testCase);
    } catch (error) {
      console.error(`Error parsing line ${i + 1}: ${error}`);
    }
  }

  return testCases;
}

/**
 * Validate multiple test cases
 */
async function validateTestCases(testCases: TestCase[], verbose: boolean): Promise<ValidationEntry[]> {
  const results: ValidationEntry[] = [];
  const total = testCases.length;

  if (!verbose) {
    console.error(`Validating ${total} test cases...\n`);
  }

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];

    if (!verbose && process.stderr.isTTY) {
      process.stderr.write(`\r[${i + 1}/${total}] Testing: ${testCase.name.slice(0, 50)}...`);
    } else if (verbose) {
      console.error(`\n[${i + 1}/${total}] Testing: ${testCase.name}`);
      console.error(`  URL: ${testCase.url}`);
    }

    const result = await validateTestCase(testCase);
    results.push(result);

    if (verbose) {
      console.error(`  Result: ${result.status.toUpperCase()} - ${result.message}`);
    }
  }

  if (!verbose && process.stderr.isTTY) {
    process.stderr.write('\r' + ' '.repeat(80) + '\r');
  }

  return results;
}

// =============================================================================
// JUnit XML Formatter
// =============================================================================

/**
 * Format validation report as JUnit XML for CI/CD integration
 */
function formatJUnit(report: ValidationReport): string {
  const failures = report.entries.filter((e) => e.status === 'fail');
  const skipped = report.entries.filter((e) => e.status === 'skip');
  const errors = report.entries.filter((e) => e.message.includes('Error:'));

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<testsuites>');
  lines.push(
    `  <testsuite name="${escapeXml(report.validator)}" ` +
      `tests="${report.summary.total}" ` +
      `failures="${failures.length}" ` +
      `errors="${errors.length}" ` +
      `skipped="${skipped.length}" ` +
      `time="${(report.summary.totalDurationMs / 1000).toFixed(3)}" ` +
      `timestamp="${report.timestamp}">`
  );

  for (const entry of report.entries) {
    const testName = escapeXml(`${entry.name} [${entry.id}]`);
    const time = ((entry.durationMs ?? 0) / 1000).toFixed(3);

    lines.push(`    <testcase name="${testName}" classname="${escapeXml(report.validator)}" time="${time}">`);

    if (entry.status === 'fail') {
      const failureMsg = escapeXml(entry.message);
      const details = entry.diagnostics ? escapeXml(JSON.stringify(entry.diagnostics, null, 2)) : '';
      lines.push(`      <failure message="${failureMsg}" type="ValidationFailure">`);
      if (details) {
        lines.push(`${details}`);
      }
      if (entry.remediation) {
        lines.push(`\nRemediation: ${escapeXml(entry.remediation)}`);
      }
      lines.push(`      </failure>`);
    } else if (entry.status === 'skip') {
      lines.push(`      <skipped message="${escapeXml(entry.message)}"/>`);
    }

    if (entry.diagnostics) {
      const systemOut = JSON.stringify(entry.diagnostics, null, 2);
      lines.push(`      <system-out>${escapeXml(systemOut)}</system-out>`);
    }

    lines.push('    </testcase>');
  }

  lines.push('  </testsuite>');
  lines.push('</testsuites>');

  return lines.join('\n');
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const options = parseArgs();

  // Validate options
  if (!options.url && !options.testSuite && !options.fromFile) {
    console.error('Error: Must specify --url, --test-suite, or --from-file');
    console.error('Use --help for usage information.');
    process.exit(3);
  }

  if (options.url && !options.name) {
    console.error('Error: --name is required when using --url');
    console.error('Use --help for usage information.');
    process.exit(3);
  }

  if (options.testSuite && !TEST_SUITES[options.testSuite]) {
    const validSuites = Object.keys(TEST_SUITES).filter((s) => s !== 'all').join(', ');
    console.error(`Error: Invalid test suite '${options.testSuite}'.`);
    console.error(`Valid suites: ${validSuites}, all`);
    process.exit(3);
  }

  // Collect test cases
  let testCases: TestCase[] = [];

  if (options.url && options.name) {
    // Single URL test
    testCases = [
      {
        name: options.name,
        url: options.url,
        expectedName: 'Unknown', // User must verify manually
        expectedState: 'Unknown',
      },
    ];
  } else if (options.testSuite) {
    // Load test suite
    testCases = TEST_SUITES[options.testSuite];
  } else if (options.fromFile) {
    // Load from file
    try {
      testCases = loadTestCases(options.fromFile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error loading test cases from file: ${message}`);
      process.exit(4);
    }
  }

  if (testCases.length === 0) {
    console.error('Error: No test cases to validate.');
    process.exit(3);
  }

  // Run validation
  try {
    const entries = await validateTestCases(testCases, options.verbose);

    // Build report
    const report = buildReport('FIPS Resolution Validation', options.testSuite || 'custom', entries, {
      testSuite: options.testSuite,
      fromFile: options.fromFile,
      url: options.url,
    });

    // Format output
    let output: string;
    if (options.format === 'junit') {
      output = formatJUnit(report);
    } else {
      output = formatReport(report, options.format as OutputFormat, {
        verbose: options.verbose,
      });
    }

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
export { validateTestCase, validateTestCases, TEST_SUITES };
export type { FipsValidateOptions, TestCase, TestSuiteName };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
