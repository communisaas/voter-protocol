#!/usr/bin/env tsx
/**
 * Council District Validation Command
 *
 * Validates council district tessellation using tiered validation pipeline.
 *
 * TIERS:
 *   structure  - HTTP fetch + GeoJSON structure (~1-2s)
 *   sanity     - + centroid proximity + count ratio (~10ms additional)
 *   full       - + tessellation proof (4 axioms) (~500-2000ms additional)
 *
 * TESSELLATION AXIOMS (full tier):
 *   1. Exclusivity: Districts cannot overlap (< 150,000 sq m)
 *   2. Exhaustivity: Coverage 85-115% (200% for coastal)
 *   3. Containment: Max 15% outside boundary
 *   4. Cardinality: Count matches expected
 *
 * Usage:
 *   shadow-atlas validate council --fips 0666000
 *   shadow-atlas validate council --fips 0666000 --tier sanity
 *   shadow-atlas validate council --batch cities.json --tier structure
 */

import { readFileSync } from 'node:fs';
import {
  IngestionValidator,
  ValidationTier,
  type IngestionValidationResult,
  type IngestionValidationOptions,
} from '../../../validators/council/ingestion-validator.js';
import { KNOWN_PORTALS } from '../../../core/registry/known-portals.generated.js';
import {
  buildReport,
  formatReport,
  getExitCode,
  getRemediation,
  type ValidationEntry,
  type OutputFormat,
} from '../../lib/validation-report.js';

// =============================================================================
// Types
// =============================================================================

interface CouncilValidateOptions {
  fips?: string;
  url?: string;
  tier: 'structure' | 'sanity' | 'full';
  batch?: string;
  limit?: number;
  expected?: number;
  tolerance?: number;
  format: OutputFormat;
  verbose: boolean;
  json: boolean;
}

interface BatchEntry {
  fips: string;
  url?: string;
  expected?: number;
}

// =============================================================================
// CLI Argument Parser
// =============================================================================

function parseArgs(): CouncilValidateOptions {
  const args = process.argv.slice(2);
  const options: CouncilValidateOptions = {
    tier: 'full',
    format: 'table',
    verbose: false,
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--fips':
        options.fips = args[++i];
        break;
      case '--url':
        options.url = args[++i];
        break;
      case '--tier':
        options.tier = args[++i] as 'structure' | 'sanity' | 'full';
        break;
      case '--batch':
        options.batch = args[++i];
        break;
      case '--limit':
        options.limit = parseInt(args[++i], 10);
        break;
      case '--expected':
        options.expected = parseInt(args[++i], 10);
        break;
      case '--tolerance':
        options.tolerance = parseFloat(args[++i]);
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
Council District Validation

Usage:
  shadow-atlas validate council [options]

Options:
  --fips <code>       Validate single city by FIPS code
  --url <url>         Override download URL
  --tier <level>      Validation tier: structure|sanity|full (default: full)
  --batch <file>      Batch validation from JSON file
  --limit <n>         Max cities to validate (batch mode)
  --expected <n>      Expected district count (overrides registry)
  --tolerance <pct>   Coverage tolerance override
  --format <fmt>      Output format: table|json|csv|summary
  --json              Output as JSON (shorthand for --format json)
  --verbose, -v       Include detailed diagnostics
  --help, -h          Show this help

Validation Tiers:
  structure  - HTTP fetch + GeoJSON structure (~1-2s)
  sanity     - + Centroid proximity + count ratio (~10ms additional)
  full       - + Tessellation proof (4 axioms) (~500-2000ms additional)

Tessellation Axioms (full tier):
  1. Exclusivity: Districts cannot overlap (< 150,000 sq m)
  2. Exhaustivity: Coverage 85-115% (200% for coastal)
  3. Containment: Max 15% outside boundary
  4. Cardinality: Count matches expected

Examples:
  shadow-atlas validate council --fips 0666000
  shadow-atlas validate council --fips 0666000 --tier sanity
  shadow-atlas validate council --batch top50.json --tier structure
  shadow-atlas validate council --fips 0666000 --json
`);
}

// =============================================================================
// Validation Logic
// =============================================================================

/**
 * Map CLI tier to ValidationTier enum
 */
function mapTier(tier: 'structure' | 'sanity' | 'full'): ValidationTier {
  switch (tier) {
    case 'structure':
      return ValidationTier.STRUCTURE;
    case 'sanity':
      return ValidationTier.SANITY;
    case 'full':
      return ValidationTier.FULL;
  }
}

/**
 * Convert IngestionValidationResult to ValidationEntry
 */
function toValidationEntry(result: IngestionValidationResult): ValidationEntry {
  const statusMap: Record<string, 'pass' | 'fail' | 'warn' | 'skip'> = {
    valid: 'pass',
    invalid: 'fail',
    quarantined: 'skip',
    at_large_city: 'skip',
  };

  // Determine status
  let status: 'pass' | 'fail' | 'warn' | 'skip';
  if (result.valid) {
    status = 'pass';
  } else if (result.failureStage === 'quarantined' || result.failureStage === 'at_large_city') {
    status = 'skip';
  } else {
    status = 'fail';
  }

  // Build diagnostics
  const diagnostics: Record<string, unknown> = {
    featureCount: result.featureCount.actual,
    expectedCount: result.featureCount.expected,
    governanceType: result.featureCount.governanceType,
  };

  if (result.sanityCheck) {
    diagnostics.sanityCheck = {
      passed: result.sanityCheck.passed,
      centroidDistanceKm: result.sanityCheck.checks.centroidProximity.distanceKm,
      featureCountRatio: result.sanityCheck.checks.featureCount.ratio,
    };
  }

  if (result.tessellationProof) {
    diagnostics.tessellation = {
      valid: result.tessellationProof.valid,
      failedAxiom: result.tessellationProof.failedAxiom,
      coverageRatio: result.tessellationProof.diagnostics.coverageRatio,
      overlapArea: result.tessellationProof.diagnostics.totalOverlapArea,
      outsideArea: result.tessellationProof.diagnostics.outsideBoundaryArea,
    };
  }

  if (result.fipsCorrection) {
    diagnostics.fipsCorrection = result.fipsCorrection;
  }

  // Get remediation
  let remediation: string | undefined;
  if (!result.valid && result.failureStage) {
    remediation = result.remediation ?? getRemediation(result.failureStage);
  }

  return {
    id: result.city.fips,
    name: result.city.name ?? 'Unknown',
    status,
    tier: result.achievedTier ?? undefined,
    message: result.status,
    diagnostics,
    remediation,
    durationMs: result.processingTimeMs,
  };
}

/**
 * Validate a single city
 */
async function validateSingle(
  validator: IngestionValidator,
  fips: string,
  url: string | undefined,
  options: CouncilValidateOptions
): Promise<ValidationEntry> {
  // Get URL from registry if not provided
  if (!url) {
    const portal = KNOWN_PORTALS[fips];
    if (!portal) {
      return {
        id: fips,
        name: 'Unknown',
        status: 'fail',
        message: `No entry found in registry for FIPS ${fips}`,
        remediation: 'Add entry to known-portals registry or provide --url',
      };
    }
    url = portal.downloadUrl;
  }

  const validationOptions: IngestionValidationOptions = {
    tier: mapTier(options.tier),
  };

  const result = await validator.validate(fips, url, validationOptions);
  return toValidationEntry(result);
}

/**
 * Load batch file
 */
function loadBatch(filepath: string, limit?: number): BatchEntry[] {
  const content = readFileSync(filepath, 'utf-8');
  let entries: BatchEntry[];

  if (filepath.endsWith('.json')) {
    const data = JSON.parse(content);
    entries = Array.isArray(data) ? data : data.entries ?? data.cities ?? [];
  } else if (filepath.endsWith('.ndjson')) {
    entries = content
      .trim()
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('{\"_'))
      .map((line) => JSON.parse(line));
  } else {
    // Assume CSV: fips,url
    entries = content
      .trim()
      .split('\n')
      .slice(1) // Skip header
      .map((line) => {
        const [fips, url] = line.split(',');
        return { fips: fips.trim(), url: url?.trim() };
      });
  }

  if (limit && limit > 0) {
    entries = entries.slice(0, limit);
  }

  return entries;
}

/**
 * Validate batch of cities
 */
async function validateBatch(
  validator: IngestionValidator,
  entries: BatchEntry[],
  options: CouncilValidateOptions
): Promise<ValidationEntry[]> {
  const results: ValidationEntry[] = [];
  const total = entries.length;

  console.error(`Validating ${total} cities at tier: ${options.tier}...\n`);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const progress = `[${i + 1}/${total}]`;

    if (!options.json && process.stderr.isTTY) {
      process.stderr.write(`\r${progress} Validating ${entry.fips}...`);
    }

    const result = await validateSingle(validator, entry.fips, entry.url, options);
    results.push(result);
  }

  if (!options.json && process.stderr.isTTY) {
    process.stderr.write('\r' + ' '.repeat(60) + '\r');
  }

  return results;
}

/**
 * Validate all entries in registry
 */
async function validateRegistry(
  validator: IngestionValidator,
  options: CouncilValidateOptions
): Promise<ValidationEntry[]> {
  const entries = Object.entries(KNOWN_PORTALS).map(([fips, portal]) => ({
    fips,
    url: portal.downloadUrl,
  }));

  const limited = options.limit ? entries.slice(0, options.limit) : entries;
  return validateBatch(validator, limited, options);
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const options = parseArgs();

  // Validate options
  if (!options.fips && !options.batch) {
    console.error('Error: Must specify --fips or --batch');
    console.error('Use --help for usage information.');
    process.exit(3);
  }

  if (options.tier && !['structure', 'sanity', 'full'].includes(options.tier)) {
    console.error(`Error: Invalid tier '${options.tier}'. Must be structure, sanity, or full.`);
    process.exit(3);
  }

  const validator = new IngestionValidator();
  let entries: ValidationEntry[];

  try {
    if (options.fips) {
      // Single city validation
      const result = await validateSingle(validator, options.fips, options.url, options);
      entries = [result];
    } else if (options.batch) {
      // Batch validation from file
      const batchEntries = loadBatch(options.batch, options.limit);
      entries = await validateBatch(validator, batchEntries, options);
    } else {
      // This shouldn't happen due to earlier check
      entries = [];
    }

    // Build and format report
    const report = buildReport(
      'Council District Validation',
      options.tier,
      entries,
      {
        tier: options.tier,
        limit: options.limit,
        tolerance: options.tolerance,
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
export { validateSingle, validateBatch, loadBatch };
export type { CouncilValidateOptions, BatchEntry };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
