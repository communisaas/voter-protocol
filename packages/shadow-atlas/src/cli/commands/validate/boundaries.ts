#!/usr/bin/env tsx
/**
 * Boundary Validation Command
 *
 * Downloads and validates GeoJSON boundary data structure.
 *
 * CHECKS:
 *   - Download: Fetch GeoJSON from URL
 *   - Structure: Validate GeoJSON FeatureCollection structure
 *   - Feature Count: Verify count matches registry
 *   - District Names: Extract names from various field patterns
 *
 * SOURCES:
 *   - registry: Validate entries from known-portals registry
 *   - tiger-cache: Validate cached TIGER boundaries
 *   - golden: Validate golden vector datasets
 *
 * Usage:
 *   shadow-atlas validate boundaries
 *   shadow-atlas validate boundaries --source registry --limit 10
 *   shadow-atlas validate boundaries --source golden
 */

import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { KNOWN_PORTALS, type KnownPortal } from '../../../core/registry/known-portals.generated.js';
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

interface BoundaryValidateOptions {
  source: 'registry' | 'tiger-cache' | 'golden';
  limit?: number;
  fips?: string;
  format: OutputFormat;
  verbose: boolean;
  json: boolean;
  concurrency: number;
  timeout: number;
}

/**
 * Common district name field patterns
 */
const DISTRICT_NAME_FIELDS = [
  // Primary patterns
  'NAME',
  'Name',
  'name',
  'DISTRICT',
  'District',
  'district',
  'DIST_NAME',
  'DistrictName',
  'DIST',
  // Ward patterns
  'WARD',
  'Ward',
  'ward',
  'WARD_NAME',
  'WardName',
  'WARD_NUM',
  // Council patterns
  'COUNCIL',
  'Council',
  'COUNCIL_DIST',
  'CouncilDistrict',
  'COUNCIL_NAME',
  // Number patterns
  'DISTRICTNO',
  'DISTRICT_NO',
  'DISTRICT_NUM',
  'DIST_NUM',
  'NUMBER',
  // ID patterns
  'ID',
  'id',
  'OBJECTID',
  'FID',
  // Representative patterns
  'REP_NAME',
  'REPRESENTATIVE',
  'COUNCILMEMBER',
  'MEMBER',
];

// =============================================================================
// CLI Argument Parser
// =============================================================================

function parseArgs(): BoundaryValidateOptions {
  const args = process.argv.slice(2);
  const options: BoundaryValidateOptions = {
    source: 'registry',
    format: 'table',
    verbose: false,
    json: false,
    concurrency: 5,
    timeout: 30000,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--source':
        options.source = args[++i] as 'registry' | 'tiger-cache' | 'golden';
        break;
      case '--limit':
        options.limit = parseInt(args[++i], 10);
        break;
      case '--fips':
        options.fips = args[++i];
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
      case '--timeout':
        options.timeout = parseInt(args[++i], 10);
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
Boundary Validation

Usage:
  shadow-atlas validate boundaries [options]

Options:
  --source <type>     Source: registry|tiger-cache|golden (default: registry)
  --limit <n>         Max entries to validate
  --fips <code>       Validate single entry by FIPS
  --timeout <ms>      Download timeout in ms (default: 30000)
  --concurrency <n>   Parallel downloads (default: 5)
  --format <fmt>      Output format: table|json|csv|summary
  --json              Output as JSON (shorthand for --format json)
  --verbose, -v       Include detailed diagnostics
  --help, -h          Show this help

Validation Checks:
  - Download: Fetch GeoJSON from URL
  - Structure: Validate GeoJSON FeatureCollection structure
  - Feature Count: Verify count matches registry
  - District Names: Extract names from various field patterns

Sources:
  registry     - Validate entries from known-portals registry
  tiger-cache  - Validate cached TIGER boundaries
  golden       - Validate golden vector datasets

Examples:
  shadow-atlas validate boundaries
  shadow-atlas validate boundaries --source registry --limit 10
  shadow-atlas validate boundaries --fips 0666000 --verbose
  shadow-atlas validate boundaries --source golden
`);
}

// =============================================================================
// Validation Logic
// =============================================================================

/**
 * Extract district name from feature properties
 */
function extractDistrictName(properties: Record<string, unknown> | null): string | null {
  if (!properties) return null;

  for (const field of DISTRICT_NAME_FIELDS) {
    const value = properties[field];
    if (value !== undefined && value !== null && value !== '') {
      return String(value);
    }
  }

  return null;
}

/**
 * Validate GeoJSON structure
 */
function validateGeoJSONStructure(
  data: unknown
): { valid: true; featureCount: number; features: Feature[] } | { valid: false; error: string } {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Response is not a valid object' };
  }

  const fc = data as FeatureCollection;

  if (fc.type !== 'FeatureCollection') {
    return { valid: false, error: `Expected FeatureCollection, got ${fc.type ?? 'undefined'}` };
  }

  if (!Array.isArray(fc.features)) {
    return { valid: false, error: 'features is not an array' };
  }

  const featureCount = fc.features.length;
  if (featureCount === 0) {
    return { valid: false, error: 'FeatureCollection is empty' };
  }

  // Check for valid geometry
  let validGeomCount = 0;
  for (const feature of fc.features) {
    if (feature.geometry?.type && feature.geometry?.coordinates) {
      validGeomCount++;
    }
  }

  if (validGeomCount === 0) {
    return { valid: false, error: 'No features have valid geometry' };
  }

  return { valid: true, featureCount, features: fc.features as Feature[] };
}

/**
 * Fetch and validate a single boundary entry
 */
async function validateBoundaryEntry(
  fips: string,
  portal: KnownPortal,
  timeout: number
): Promise<ValidationEntry> {
  const startTime = Date.now();

  try {
    // Fetch GeoJSON
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(portal.downloadUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'VOTER-Protocol/1.0 (Boundary-Validation)',
        Accept: 'application/geo+json, application/json',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        id: fips,
        name: `${portal.cityName}, ${portal.state}`,
        status: 'fail',
        message: `HTTP ${response.status}: ${response.statusText}`,
        durationMs: Date.now() - startTime,
        remediation: 'Check URL validity or update in registry',
      };
    }

    const data = await response.json();
    const structureResult = validateGeoJSONStructure(data);

    if (!structureResult.valid) {
      return {
        id: fips,
        name: `${portal.cityName}, ${portal.state}`,
        status: 'fail',
        message: structureResult.error,
        durationMs: Date.now() - startTime,
        remediation: 'Fix GeoJSON structure at source or find alternative URL',
      };
    }

    // Validate feature count
    const expectedCount = portal.featureCount;
    const actualCount = structureResult.featureCount;
    const countMatches = actualCount === expectedCount;

    // Extract district names
    const districtNames: string[] = [];
    const nameFieldUsed = new Set<string>();

    for (const feature of structureResult.features) {
      const name = extractDistrictName(feature.properties as Record<string, unknown>);
      if (name) {
        districtNames.push(name);
        // Track which field was used
        for (const field of DISTRICT_NAME_FIELDS) {
          if (feature.properties && (feature.properties as Record<string, unknown>)[field] !== undefined) {
            nameFieldUsed.add(field);
            break;
          }
        }
      }
    }

    // Determine status
    let status: 'pass' | 'warn' | 'fail';
    let message: string;

    if (!countMatches) {
      status = 'warn';
      message = `Feature count mismatch: expected ${expectedCount}, got ${actualCount}`;
    } else {
      status = 'pass';
      message = `Valid: ${actualCount} features`;
    }

    return {
      id: fips,
      name: `${portal.cityName}, ${portal.state}`,
      status,
      message,
      durationMs: Date.now() - startTime,
      diagnostics: {
        featureCount: actualCount,
        expectedCount,
        districtNames: districtNames.slice(0, 5),
        nameFieldUsed: Array.from(nameFieldUsed),
        hasGeometry: true,
      },
      remediation: !countMatches ? 'Update feature count in registry' : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const isTimeout = message.includes('abort') || message.includes('timeout');

    return {
      id: fips,
      name: `${portal.cityName}, ${portal.state}`,
      status: 'fail',
      message: isTimeout ? 'Request timed out' : message,
      durationMs: Date.now() - startTime,
      remediation: isTimeout ? 'Increase timeout or check network' : 'Check URL and network connectivity',
    };
  }
}

/**
 * Validate registry entries
 */
async function validateRegistryBoundaries(
  options: BoundaryValidateOptions
): Promise<ValidationEntry[]> {
  const entries: ValidationEntry[] = [];
  let portals = Object.entries(KNOWN_PORTALS);

  // Filter by FIPS if specified
  if (options.fips) {
    portals = portals.filter(([fips]) => fips === options.fips);
    if (portals.length === 0) {
      return [{
        id: options.fips,
        name: 'Unknown',
        status: 'fail',
        message: `FIPS ${options.fips} not found in registry`,
      }];
    }
  }

  // Apply limit
  if (options.limit && options.limit > 0) {
    portals = portals.slice(0, options.limit);
  }

  const total = portals.length;
  console.error(`Validating ${total} boundary entries...\n`);

  // Process in batches for concurrency control
  const batchSize = options.concurrency;
  for (let i = 0; i < portals.length; i += batchSize) {
    const batch = portals.slice(i, i + batchSize);

    if (process.stderr.isTTY) {
      process.stderr.write(`\r[${i + batch.length}/${total}] Downloading boundaries...`);
    }

    const results = await Promise.all(
      batch.map(([fips, portal]) => validateBoundaryEntry(fips, portal, options.timeout))
    );

    entries.push(...results);

    // Rate limiting
    if (i + batchSize < portals.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  if (process.stderr.isTTY) {
    process.stderr.write('\r' + ' '.repeat(60) + '\r');
  }

  // Add summary entry
  const passed = entries.filter((e) => e.status === 'pass').length;
  const warnings = entries.filter((e) => e.status === 'warn').length;
  const failed = entries.filter((e) => e.status === 'fail').length;
  const avgDuration = entries.reduce((sum, e) => sum + (e.durationMs ?? 0), 0) / entries.length;

  entries.unshift({
    id: 'summary',
    name: 'Boundary Validation Summary',
    status: failed > 0 ? 'fail' : warnings > 0 ? 'warn' : 'pass',
    message: `${passed} passed, ${warnings} warnings, ${failed} failed (avg ${avgDuration.toFixed(0)}ms)`,
    diagnostics: {
      total,
      passed,
      warnings,
      failed,
      avgDurationMs: avgDuration,
    },
  });

  return entries;
}

/**
 * Validate golden vector boundaries
 */
async function validateGoldenBoundaries(options: BoundaryValidateOptions): Promise<ValidationEntry[]> {
  const entries: ValidationEntry[] = [];

  // Filter golden vector entries from registry
  const goldenPortals = Object.entries(KNOWN_PORTALS).filter(
    ([, portal]) => portal.portalType === 'golden-vector'
  );

  if (goldenPortals.length === 0) {
    return [{
      id: 'golden',
      name: 'Golden Vector',
      status: 'skip',
      message: 'No golden vector entries found in registry',
    }];
  }

  const total = options.limit ? Math.min(goldenPortals.length, options.limit) : goldenPortals.length;
  const portalsToValidate = goldenPortals.slice(0, total);

  console.error(`Validating ${total} golden vector entries...\n`);

  for (let i = 0; i < portalsToValidate.length; i++) {
    const [fips, portal] = portalsToValidate[i];

    if (process.stderr.isTTY) {
      process.stderr.write(`\r[${i + 1}/${total}] Validating ${portal.cityName}...`);
    }

    const result = await validateBoundaryEntry(fips, portal, options.timeout);
    entries.push(result);
  }

  if (process.stderr.isTTY) {
    process.stderr.write('\r' + ' '.repeat(60) + '\r');
  }

  return entries;
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const options = parseArgs();
  let entries: ValidationEntry[] = [];

  // Validate source option
  if (!['registry', 'tiger-cache', 'golden'].includes(options.source)) {
    console.error(`Error: Invalid source '${options.source}'. Must be registry, tiger-cache, or golden.`);
    process.exit(3);
  }

  try {
    switch (options.source) {
      case 'registry':
        entries = await validateRegistryBoundaries(options);
        break;

      case 'golden':
        entries = await validateGoldenBoundaries(options);
        break;

      case 'tiger-cache':
        // TODO: Implement TIGER cache validation
        entries = [{
          id: 'tiger-cache',
          name: 'TIGER Cache',
          status: 'skip',
          message: 'TIGER cache validation not yet implemented',
        }];
        break;
    }

    // Build and format report
    const report = buildReport(
      'Boundary Validation',
      options.source,
      entries,
      {
        source: options.source,
        limit: options.limit,
        timeout: options.timeout,
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
  validateBoundaryEntry,
  validateRegistryBoundaries,
  validateGoldenBoundaries,
  extractDistrictName,
  validateGeoJSONStructure,
  DISTRICT_NAME_FIELDS,
};
export type { BoundaryValidateOptions };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
