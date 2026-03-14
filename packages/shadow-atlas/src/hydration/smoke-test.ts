#!/usr/bin/env npx tsx
/**
 * Smoke Test Runner
 *
 * Runs dry-run hydration for all (or specified) countries and validates
 * extraction results against minimum thresholds. Designed for CI.
 *
 * Exit codes:
 *   0 = all countries pass
 *   1 = at least one country has a CRITICAL failure
 *   2 = warnings only (non-blocking)
 *
 * Usage:
 *   npx tsx src/hydration/smoke-test.ts                    # All countries
 *   npx tsx src/hydration/smoke-test.ts --country US,GB    # Specific countries
 *   npx tsx src/hydration/smoke-test.ts --json             # JSON output for CI parsing
 *   npx tsx src/hydration/smoke-test.ts --timeout 600000   # Custom timeout (ms)
 *
 * NOTE: These tests hit REAL APIs (TIGERweb, Represent, ONS, APH, Stats NZ).
 * They WILL fail if any upstream API is down. Mark as expected-flaky in CI.
 */

import type { CountryProvider } from '../providers/international/country-provider.js';
import type { InternationalBoundary } from '../providers/international/base-provider.js';
import type { OfficialRecord } from '../providers/international/country-provider-types.js';

// ============================================================================
// Types
// ============================================================================

interface SmokeTestResult {
  country: string;
  boundaryCount: number;
  expectedBoundaryCount: number;
  officialCount: number;
  expectedOfficialCount: number;
  resolvedCount: number;
  unmatchedCount: number;
  confidence: number;
  passed: boolean;
  warnings: string[];
  errors: string[];
  durationMs: number;
}

interface SmokeTestSummary {
  results: SmokeTestResult[];
  totalDurationMs: number;
  passed: boolean;
  hasWarnings: boolean;
  exitCode: 0 | 1 | 2;
}

// ============================================================================
// Per-Country Minimum Thresholds
// ============================================================================

const MINIMUM_THRESHOLDS: Record<
  string,
  { minBoundaries: number; minOfficials: number; minConfidence: number }
> = {
  US: { minBoundaries: 400, minOfficials: 530, minConfidence: 90 },
  CA: { minBoundaries: 330, minOfficials: 330, minConfidence: 85 },
  GB: { minBoundaries: 640, minOfficials: 640, minConfidence: 90 },
  AU: { minBoundaries: 140, minOfficials: 145, minConfidence: 90 },
  NZ: { minBoundaries: 65, minOfficials: 70, minConfidence: 90 },
};

const SUPPORTED_COUNTRIES = Object.keys(MINIMUM_THRESHOLDS);

// Critical failure = count drops > 20% below threshold
const CRITICAL_DROP_RATIO = 0.8;

// Delay between countries to avoid rate limiting (ms)
const INTER_COUNTRY_DELAY_MS = 3000;

// ============================================================================
// Provider Registry (lazy imports)
// ============================================================================

const PROVIDER_REGISTRY: Record<
  string,
  () => Promise<CountryProvider<string, InternationalBoundary, OfficialRecord>>
> = {
  AU: async () =>
    new (await import('../providers/international/australia-provider.js')).AustraliaCountryProvider(),
  CA: async () =>
    new (await import('../providers/international/canada-provider.js')).CanadaCountryProvider(),
  GB: async () =>
    new (await import('../providers/international/uk-provider.js')).UKCountryProvider(),
  NZ: async () =>
    new (await import('../providers/international/nz-provider.js')).NZCountryProvider(),
  US: async () =>
    new (await import('../providers/international/us-provider.js')).USCountryProvider(),
};

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CLIOptions {
  countries: string[];
  json: boolean;
  timeout: number;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const opts: CLIOptions = {
    countries: [...SUPPORTED_COUNTRIES],
    json: false,
    timeout: 600000, // 10 minutes
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--country': {
        const val = args[++i];
        if (val) {
          opts.countries = val
            .split(',')
            .map((c) => c.trim().toUpperCase())
            .filter((c) => SUPPORTED_COUNTRIES.includes(c));
          if (opts.countries.length === 0) {
            console.error(
              `Error: No valid countries. Supported: ${SUPPORTED_COUNTRIES.join(', ')}`,
            );
            process.exit(1);
          }
        }
        break;
      }
      case '--json':
        opts.json = true;
        break;
      case '--timeout':
        opts.timeout = parseInt(args[++i] ?? '600000', 10);
        break;
      case '--help':
        console.log(`
Smoke Test Runner — CI validation for Shadow Atlas country providers

Usage:
  npx tsx src/hydration/smoke-test.ts [options]

Options:
  --country <codes>  Comma-separated country codes (default: all)
                     Supported: ${SUPPORTED_COUNTRIES.join(', ')}
  --json             Output results as JSON (for CI pipeline parsing)
  --timeout <ms>     Per-country timeout in ms (default: 600000)
  --help             Show this help

Exit codes:
  0  All countries pass
  1  At least one CRITICAL failure (count drops >20% below threshold)
  2  Warnings only (non-blocking, count slightly below threshold)

Examples:
  npx tsx src/hydration/smoke-test.ts                    # All countries
  npx tsx src/hydration/smoke-test.ts --country US,GB    # Just US and GB
  npx tsx src/hydration/smoke-test.ts --json             # JSON for CI
`);
        process.exit(0);
    }
  }

  return opts;
}

// ============================================================================
// Single Country Smoke Test
// ============================================================================

async function runCountrySmokeTest(
  country: string,
  timeout: number,
): Promise<SmokeTestResult> {
  const startTime = Date.now();
  const warnings: string[] = [];
  const errors: string[] = [];
  const thresholds = MINIMUM_THRESHOLDS[country];

  if (!thresholds) {
    return {
      country,
      boundaryCount: 0,
      expectedBoundaryCount: 0,
      officialCount: 0,
      expectedOfficialCount: 0,
      resolvedCount: 0,
      unmatchedCount: 0,
      confidence: 0,
      passed: false,
      warnings: [],
      errors: [`Unsupported country: ${country}`],
      durationMs: Date.now() - startTime,
    };
  }

  try {
    // Instantiate provider
    const factory = PROVIDER_REGISTRY[country];
    if (!factory) {
      throw new Error(`No provider registered for ${country}`);
    }
    const provider = await factory();

    // Step 1: Extract boundaries (with timeout)
    const boundaryResult = await Promise.race([
      provider.extractAll(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Boundary extraction timed out after ${timeout}ms`)), timeout),
      ),
    ]);

    const allBoundaries = boundaryResult.layers.flatMap((l) => [...l.boundaries]);
    const boundaryCount = allBoundaries.length;
    const expectedBoundaryCount = boundaryResult.layers.reduce(
      (sum, l) => sum + (l.expectedCount ?? 0),
      0,
    );

    // Check boundary thresholds
    if (boundaryCount < thresholds.minBoundaries * CRITICAL_DROP_RATIO) {
      errors.push(
        `CRITICAL: Boundary count ${boundaryCount} is >20% below minimum ${thresholds.minBoundaries}`,
      );
    } else if (boundaryCount < thresholds.minBoundaries) {
      warnings.push(
        `Boundary count ${boundaryCount} below minimum ${thresholds.minBoundaries} (redistricting?)`,
      );
    }

    // Check failed layers
    if (boundaryResult.failedLayers > 0) {
      warnings.push(`${boundaryResult.failedLayers} layer(s) failed extraction`);
    }

    // Step 2: Build boundary index
    const boundaryIndex = new Map<string, InternationalBoundary>();
    for (const boundary of allBoundaries) {
      boundaryIndex.set(boundary.name, boundary);
    }

    // Step 3: Extract officials (with timeout)
    const officialsResult = await Promise.race([
      provider.extractOfficials(boundaryIndex),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Officials extraction timed out after ${timeout}ms`)), timeout),
      ),
    ]);

    const officialCount = officialsResult.actualCount;
    const expectedOfficialCount = officialsResult.expectedCount;

    // Check official thresholds
    if (officialCount < thresholds.minOfficials * CRITICAL_DROP_RATIO) {
      errors.push(
        `CRITICAL: Official count ${officialCount} is >20% below minimum ${thresholds.minOfficials}`,
      );
    } else if (officialCount < thresholds.minOfficials) {
      warnings.push(
        `Official count ${officialCount} below minimum ${thresholds.minOfficials}`,
      );
    }

    // Step 4: Validate (no PIP — too slow for CI)
    const report = await provider.validate(
      allBoundaries,
      [...officialsResult.officials],
    );

    const resolvedCount = report.layers.codeResolution.resolved;
    const unmatchedCount = report.layers.codeResolution.unmatched.length;
    const confidence = report.overallConfidence;

    // Check confidence threshold
    if (confidence < thresholds.minConfidence * CRITICAL_DROP_RATIO) {
      errors.push(
        `CRITICAL: Confidence ${confidence}% is >20% below minimum ${thresholds.minConfidence}%`,
      );
    } else if (confidence < thresholds.minConfidence) {
      warnings.push(
        `Confidence ${confidence}% below minimum ${thresholds.minConfidence}%`,
      );
    }

    // Schema validation blocking
    if (report.blocking) {
      errors.push('CRITICAL: Schema validation failed (would block DB write)');
    }

    return {
      country,
      boundaryCount,
      expectedBoundaryCount,
      officialCount,
      expectedOfficialCount,
      resolvedCount,
      unmatchedCount,
      confidence,
      passed: errors.length === 0,
      warnings,
      errors,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`CRITICAL: ${message}`);

    return {
      country,
      boundaryCount: 0,
      expectedBoundaryCount: 0,
      officialCount: 0,
      expectedOfficialCount: 0,
      resolvedCount: 0,
      unmatchedCount: 0,
      confidence: 0,
      passed: false,
      warnings,
      errors,
      durationMs: Date.now() - startTime,
    };
  }
}

// ============================================================================
// Summary Table Printer
// ============================================================================

function printSummaryTable(summary: SmokeTestSummary): void {
  const SEP = '-'.repeat(100);

  console.log();
  console.log('=== Shadow Atlas Smoke Test Results ===');
  console.log();
  console.log(SEP);
  console.log(
    padRight('Country', 10) +
      padRight('Boundaries', 14) +
      padRight('Officials', 14) +
      padRight('Resolved', 12) +
      padRight('Unmatched', 12) +
      padRight('Conf.', 8) +
      padRight('Time', 10) +
      padRight('Status', 10),
  );
  console.log(SEP);

  for (const r of summary.results) {
    const status = r.passed
      ? r.warnings.length > 0
        ? 'WARN'
        : 'PASS'
      : 'FAIL';

    const statusColor =
      status === 'PASS' ? '\x1b[32m' : status === 'WARN' ? '\x1b[33m' : '\x1b[31m';
    const reset = '\x1b[0m';

    console.log(
      padRight(r.country, 10) +
        padRight(`${r.boundaryCount}/${r.expectedBoundaryCount}`, 14) +
        padRight(`${r.officialCount}/${r.expectedOfficialCount}`, 14) +
        padRight(String(r.resolvedCount), 12) +
        padRight(String(r.unmatchedCount), 12) +
        padRight(`${r.confidence}%`, 8) +
        padRight(`${(r.durationMs / 1000).toFixed(1)}s`, 10) +
        `${statusColor}${status}${reset}`,
    );
  }

  console.log(SEP);

  // Print warnings and errors
  for (const r of summary.results) {
    if (r.warnings.length > 0 || r.errors.length > 0) {
      console.log();
      console.log(`  ${r.country}:`);
      for (const w of r.warnings) {
        console.log(`    \x1b[33mWARN\x1b[0m  ${w}`);
      }
      for (const e of r.errors) {
        console.log(`    \x1b[31mFAIL\x1b[0m  ${e}`);
      }
    }
  }

  console.log();
  console.log(
    `Total: ${summary.results.length} countries, ` +
      `${summary.results.filter((r) => r.passed && r.warnings.length === 0).length} passed, ` +
      `${summary.results.filter((r) => r.passed && r.warnings.length > 0).length} warnings, ` +
      `${summary.results.filter((r) => !r.passed).length} failed ` +
      `(${(summary.totalDurationMs / 1000).toFixed(1)}s)`,
  );
  console.log();

  switch (summary.exitCode) {
    case 0:
      console.log('\x1b[32mAll smoke tests passed.\x1b[0m');
      break;
    case 1:
      console.log('\x1b[31mSmoke tests FAILED — critical issues detected.\x1b[0m');
      break;
    case 2:
      console.log('\x1b[33mSmoke tests passed with warnings (non-blocking).\x1b[0m');
      break;
  }
}

function padRight(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const opts = parseArgs();
  const startTime = Date.now();

  if (!opts.json) {
    console.log(`Smoke testing ${opts.countries.length} countries: ${opts.countries.join(', ')}`);
    console.log(`Per-country timeout: ${(opts.timeout / 1000).toFixed(0)}s`);
    console.log();
  }

  const results: SmokeTestResult[] = [];

  for (let i = 0; i < opts.countries.length; i++) {
    const country = opts.countries[i];
    if (!opts.json) {
      console.log(`[${i + 1}/${opts.countries.length}] Testing ${country}...`);
    }

    const result = await runCountrySmokeTest(country, opts.timeout);
    results.push(result);

    if (!opts.json) {
      const status = result.passed ? (result.warnings.length > 0 ? 'WARN' : 'PASS') : 'FAIL';
      console.log(
        `  ${status}: ${result.boundaryCount} boundaries, ` +
          `${result.officialCount} officials, ` +
          `${result.confidence}% confidence ` +
          `(${(result.durationMs / 1000).toFixed(1)}s)`,
      );
    }

    // Delay between countries to avoid rate limiting
    if (i < opts.countries.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, INTER_COUNTRY_DELAY_MS));
    }
  }

  const totalDurationMs = Date.now() - startTime;
  const hasCritical = results.some((r) => !r.passed);
  const hasWarnings = results.some((r) => r.warnings.length > 0);

  const exitCode: 0 | 1 | 2 = hasCritical ? 1 : hasWarnings ? 2 : 0;

  const summary: SmokeTestSummary = {
    results,
    totalDurationMs,
    passed: !hasCritical,
    hasWarnings,
    exitCode,
  };

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printSummaryTable(summary);
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error('Smoke test runner crashed:', error);
  process.exit(1);
});
