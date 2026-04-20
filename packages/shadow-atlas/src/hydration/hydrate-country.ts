#!/usr/bin/env npx tsx
/**
 * Unified Country Hydration CLI
 *
 * Single entry point for boundary extraction, officials ingestion,
 * cell map construction, and validation for any supported country.
 *
 * Usage:
 * npx tsx packages/shadow-atlas/src/hydration/hydrate-country.ts --country AU
 * npx tsx packages/shadow-atlas/src/hydration/hydrate-country.ts --country CA --validate-only
 * npx tsx packages/shadow-atlas/src/hydration/hydrate-country.ts --country GB --dry-run
 * npx tsx packages/shadow-atlas/src/hydration/hydrate-country.ts --country NZ --skip-cell-map
 *
 * Pipeline (per country):
 * 1. Extract boundaries via provider.extractAll()
 * 2. Build boundary index (name → boundary)
 * 3. Extract officials via provider.extractOfficials(boundaryIndex)
 * 4. Build cell map via provider.buildCellMap(boundaries) [optional]
 * 5. Validate via provider.validate(boundaries, officials) [optional]
 * 6. Write to SQLite [unless --dry-run]
 *
 * @see country-provider.ts for the abstract CountryProvider class
 * @see memory/country-provider-unification.md for architectural spec
 */

import type { CountryProvider } from '../providers/international/country-provider.js';
import type { InternationalBoundary, AuthorityLevel } from '../providers/international/base-provider.js';
import type { GeocoderFn, OfficialRecord, PIPCheckFn, ValidationReport } from '../providers/international/country-provider-types.js';
import { writeOfficials, logIngestionFailure } from './db-writer.js';

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CLIOptions {
  country: string;
  dbPath: string;
  dryRun: boolean;
  validateOnly: boolean;
  skipCellMap: boolean;
  skipPIP: boolean;
  cacheDir: string;
  verbose: boolean;
  cellMapThreshold: number;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const opts: CLIOptions = {
    country: '',
    dbPath: 'data/shadow-atlas.db',
    dryRun: false,
    validateOnly: false,
    skipCellMap: false,
    skipPIP: false,
    cacheDir: 'data/country-cache',
    verbose: false,
    cellMapThreshold: CELL_MAP_THRESHOLD,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--country':
        opts.country = args[++i]?.toUpperCase() ?? '';
        break;
      case '--db':
        opts.dbPath = args[++i] ?? opts.dbPath;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--validate-only':
        opts.validateOnly = true;
        break;
      case '--skip-cell-map':
        opts.skipCellMap = true;
        break;
      case '--skip-pip':
        opts.skipPIP = true;
        break;
      case '--cache-dir':
        opts.cacheDir = args[++i] ?? opts.cacheDir;
        break;
      case '--cell-map-threshold': {
        const raw = parseFloat(args[++i] ?? String(CELL_MAP_THRESHOLD));
        // R34-M1: Bounds validation — reject NaN, Infinity, and values outside [0.5, 1.0]
        if (!Number.isFinite(raw) || raw < 0.5 || raw > 1.0) {
          console.error(`Invalid --cell-map-threshold: must be a number between 0.5 and 1.0, got "${args[i]}"`);
          process.exit(1);
        }
        opts.cellMapThreshold = raw;
        break;
      }
      case '--verbose':
        opts.verbose = true;
        break;
      case '--help':
        console.log(`
Usage: hydrate-country.ts [options]

Options:
  --country <ISO>      Country code: US, CA, GB, AU, NZ (required)
  --db <path>          SQLite database path (default: data/shadow-atlas.db)
  --dry-run            Fetch and validate only, no DB writes
  --validate-only      Run validation pipeline only (requires existing data)
  --skip-cell-map      Skip Tree 2 cell map construction
  --skip-pip           Skip Layer 4 PIP verification (Nominatim geocoding, slow)
  --cache-dir <path>   Cache directory (default: data/country-cache)
  --verbose            Verbose logging
  --help               Show this help
`);
        process.exit(0);
    }
  }

  if (!opts.country) {
    console.error('Error: --country is required. Use --help for usage.');
    process.exit(1);
  }

  return opts;
}

// ============================================================================
// Provider Registry
// ============================================================================

/**
 * Supported country codes → provider factory.
 *
 * Wave 2 agents will register their providers here as they implement them.
 * Each entry is a lazy factory to avoid importing all providers upfront.
 */
const PROVIDER_REGISTRY: Record<string, () => Promise<CountryProvider<string, InternationalBoundary, OfficialRecord>>> = {
  AU: async () => new (await import('../providers/international/australia-provider.js')).AustraliaCountryProvider(),
  CA: async () => new (await import('../providers/international/canada-provider.js')).CanadaCountryProvider(),
  GB: async () => new (await import('../providers/international/uk-provider.js')).UKCountryProvider(),
  NZ: async () => new (await import('../providers/international/nz-provider.js')).NZCountryProvider(),
  US: async () => new (await import('../providers/international/us-provider.js')).USCountryProvider(),
};

// ============================================================================
// Thresholds
// ============================================================================

/**
 * Minimum boundary coverage required to proceed with cell map construction.
 * Cell maps feed into the ZK tree — a corrupted map means bad proofs.
 * The DB write path uses the existing 80% schema threshold (diagnostic/non-blocking).
 */
export const CELL_MAP_THRESHOLD = 0.95;

/** Maximum boundary name collisions before logging ERROR (data is suspect). */
export const MAX_BOUNDARY_COLLISIONS = 10;

// ============================================================================
// Exported Utilities (testable)
// ============================================================================

export interface BoundaryIndexResult {
  index: Map<string, InternationalBoundary>;
  collisionCount: number;
}

/**
 * Build a boundary index from a list of boundaries, detecting name collisions.
 * On collision, both entries are re-keyed with compound key `type:name`.
 */
export function buildBoundaryIndex(
  boundaries: readonly InternationalBoundary[],
): BoundaryIndexResult {
  const index = new Map<string, InternationalBoundary>();
  // R49-F7: Track names that have been promoted to compound keys so the 3rd+
  // boundary with the same name goes straight to compound key storage, instead
  // of re-inserting under the simple key (which was deleted on the 2nd hit).
  const promotedNames = new Set<string>();
  let collisionCount = 0;

  for (const boundary of boundaries) {
    if (index.has(boundary.name)) {
      // First collision for this name — promote existing + store new under compound keys
      collisionCount++;
      const existing = index.get(boundary.name)!;
      const existingKey = `${existing.type}:${existing.name}`;
      const newKey = `${boundary.type}:${boundary.name}`;
      if (!index.has(existingKey)) {
        index.set(existingKey, existing);
      }
      index.set(newKey, boundary);
      // Delete the stale simple key — callers must use compound keys
      // when collisions exist, otherwise they get the first (arbitrary) entry.
      index.delete(boundary.name);
      promotedNames.add(boundary.name);
    } else if (promotedNames.has(boundary.name)) {
      // R49-F7: Name was already promoted — go straight to compound key
      collisionCount++;
      const newKey = `${boundary.type}:${boundary.name}`;
      index.set(newKey, boundary);
    } else {
      index.set(boundary.name, boundary);
    }
  }

  return { index, collisionCount };
}

/**
 * Check if boundary coverage meets the cell map threshold.
 * Returns true if coverage is sufficient to build a cell map.
 */
export function checkCellMapCoverage(
  actualCount: number,
  expectedCount: number,
  threshold: number = CELL_MAP_THRESHOLD,
): { allowed: boolean; coverage: number } {
  const coverage = expectedCount > 0 ? actualCount / expectedCount : 0;
  return { allowed: coverage >= threshold, coverage };
}

// ============================================================================
// Main Pipeline
// ============================================================================

async function main(): Promise<void> {
  const opts = parseArgs();
  const startTime = Date.now();

  console.log('=== Country Hydration Pipeline ===');
  console.log(`Country:       ${opts.country}`);
  console.log(`DB:            ${opts.dbPath}`);
  console.log(`Dry run:       ${opts.dryRun}`);
  console.log(`Validate only: ${opts.validateOnly}`);
  console.log(`Skip cell map: ${opts.skipCellMap}`);
  console.log(`Skip PIP:      ${opts.skipPIP}`);
  console.log();

  // Resolve provider
  const factory = PROVIDER_REGISTRY[opts.country];
  if (!factory) {
    const supported = Object.keys(PROVIDER_REGISTRY);
    if (supported.length === 0) {
      console.error(`Error: No country providers registered yet.`);
      console.error(`Wave 2 implementation will add providers for: AU, CA, GB, NZ`);
    } else {
      console.error(`Error: Unsupported country "${opts.country}". Supported: ${supported.join(', ')}`);
    }
    process.exit(1);
  }

  const provider = await factory();
  console.log(`Provider: ${provider.countryName} (${provider.dataSource})`);
  console.log();

  // Check current freshness before extraction
  try {
    const { checkCountryFreshness } = await import('./freshness-monitor.js');
    const freshness = checkCountryFreshness(opts.dbPath, opts.country);
    console.log(`Current data age: ${freshness.ageInDays !== null ? `${freshness.ageInDays}d` : 'never ingested'} (${freshness.status})`);
    console.log();
  } catch {
    // DB may not exist yet — skip
  }

  // Step 1: Extract boundaries
  console.log('[1/5] Extracting boundaries...');
  const boundaryResult = await provider.extractAll();
  const allBoundaries = boundaryResult.layers.flatMap(l => [...l.boundaries]);

  console.log(`  → ${allBoundaries.length} boundaries extracted`);
  console.log(`  → Successful layers: ${boundaryResult.successfulLayers}/${boundaryResult.layers.length}`);
  console.log(`  → Duration: ${boundaryResult.durationMs}ms`);
  console.log();

  // Step 2: Build boundary index (with collision detection)
  console.log('[2/5] Building boundary index...');
  const { index: boundaryIndex, collisionCount } = buildBoundaryIndex(allBoundaries);
  if (collisionCount > MAX_BOUNDARY_COLLISIONS) {
    console.error(`  ERROR: ${collisionCount} boundary name collisions detected (threshold: ${MAX_BOUNDARY_COLLISIONS}). Data may be corrupt.`);
  } else if (collisionCount > 0) {
    for (const boundary of allBoundaries) {
      if (boundaryIndex.has(`${boundary.type}:${boundary.name}`)) {
        console.warn(`  WARNING: Boundary name collision "${boundary.name}" (${boundary.id}, ${boundary.type})`);
      }
    }
    console.warn(`  ${collisionCount} boundary name collision(s) resolved with compound keys.`);
  }
  console.log(`  → ${boundaryIndex.size} boundaries indexed by name`);
  console.log();

  // Step 3: Extract officials
  console.log('[3/5] Extracting officials (source chain)...');
  const officialsResult = await provider.extractOfficials(boundaryIndex);

  console.log(`  → ${officialsResult.actualCount}/${officialsResult.expectedCount} officials extracted`);
  console.log(`  → Matched: ${officialsResult.matched}`);
  console.log(`  → Confidence: ${officialsResult.confidence}`);
  console.log(`  → Sources tried:`);
  for (const attempt of officialsResult.sources) {
    const status = attempt.success ? 'SUCCESS' : `FAILED (${attempt.error})`;
    console.log(`    → ${attempt.source}: ${status} (${attempt.durationMs}ms)`);
  }
  console.log();

  // Step 4: Build cell map (optional, gated on boundary coverage)
  if (!opts.skipCellMap && !opts.validateOnly) {
    const totalExpected = boundaryResult.layers.reduce((sum, l) => sum + l.expectedCount, 0);
    const { allowed, coverage } = checkCellMapCoverage(allBoundaries.length, totalExpected, opts.cellMapThreshold);
    const thresholdPct = (opts.cellMapThreshold * 100).toFixed(0);

    console.log('[4/5] Building cell map (Tree 2)...');
    if (!allowed) {
      console.error(`  CRITICAL: Boundary coverage ${(coverage * 100).toFixed(1)}% is below cell map threshold (${thresholdPct}%).`);
      console.error(`  → ${allBoundaries.length}/${totalExpected} boundaries extracted. Cell map construction SKIPPED.`);
      console.error(`  → A corrupted cell map produces invalid ZK proofs. Fix boundary extraction first.`);
    } else {
      console.log(`  → Boundary coverage: ${(coverage * 100).toFixed(1)}% (threshold: ${thresholdPct}%)`);
      try {
        const cellMapResult = await provider.buildCellMap(allBoundaries);
        console.log(`  → ${cellMapResult.cellCount} cells mapped`);
        console.log(`  → Statistical unit: ${cellMapResult.statisticalUnit}`);
        console.log(`  → Root: 0x${cellMapResult.root.toString(16)}`);
        console.log(`  → Depth: ${cellMapResult.depth}`);
        console.log(`  → Duration: ${cellMapResult.durationMs}ms`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.log(`  → Cell map construction failed: ${msg}`);
        console.log(`  → This is expected during early development.`);
      }
    }
  } else {
    console.log('[4/5] Cell map: SKIPPED');
  }
  console.log();

  // Step 5: Validate
  console.log('[5/5] Running 4-layer validation pipeline...');
  let geocoder: GeocoderFn | undefined;
  let pipCheck: PIPCheckFn | undefined;
  if (!opts.skipPIP) {
    const { buildPIPCheck, buildNominatimGeocoder } = await import('./pip-wiring.js');
    pipCheck = buildPIPCheck(allBoundaries);
    geocoder = buildNominatimGeocoder();
    console.log('  PIP verification ENABLED (Nominatim geocoding, ~1 req/sec)');
  }
  const report = await provider.validate(
    allBoundaries,
    [...officialsResult.officials],
    geocoder,
    pipCheck,
  );
  printValidationReport(report);

  // Regression check BEFORE DB write — prevents data corruption when upstream
  // source degrades. Previous pattern wrote officials first, detected regression after,
  // leaving the DB corrupted even though the regression was caught.
  const { saveBaseline, loadBaseline, compareToBaseline } = await import('./regression-tracker.js');
  const baseline = {
    country: opts.country,
    timestamp: new Date().toISOString(),
    boundaries: boundaryResult.layers.map(l => ({
      layer: l.layer,
      count: l.boundaries.length,
      expectedCount: l.expectedCount,
    })),
    officials: {
      count: officialsResult.actualCount,
      expectedCount: officialsResult.expectedCount,
      resolved: report.layers.codeResolution.resolved,
      unmatched: report.layers.codeResolution.unmatched.length,
    },
    overallConfidence: report.overallConfidence,
  };

  const previous = loadBaseline(opts.dbPath, opts.country);
  let hasCriticalRegression = false;
  if (previous) {
    const regression = compareToBaseline(baseline, previous);
    hasCriticalRegression = regression.criticals.length > 0;
    console.log('\n  Regression Check');
    console.log(`    Previous: ${regression.previousTimestamp}`);
    console.log(`    Current:  ${regression.currentTimestamp}`);
    if (regression.criticals.length > 0) {
      console.log(`    CRITICAL (${regression.criticals.length}):`);
      for (const c of regression.criticals) console.log(`      !! ${c}`);
    }
    if (regression.warnings.length > 0) {
      console.log(`    WARNINGS (${regression.warnings.length}):`);
      for (const w of regression.warnings) console.log(`      -> ${w}`);
    }
    if (regression.passed && regression.warnings.length === 0) {
      console.log('    No regressions detected.');
    }
  } else {
    console.log('\n  Regression Check: first run, no previous baseline.');
  }

  // Write to DB (unless dry run, validate only, blocking, or critical regression)
  if (!opts.dryRun && !opts.validateOnly) {
    if (report.blocking) {
      console.log('\nValidation BLOCKING — schema validation failed threshold. Skipping DB write.');
    } else if (hasCriticalRegression) {
      console.log('\nCritical regression detected — skipping DB write to preserve existing data.');
    } else {
      console.log('\nWriting officials to DB...');
      const summary = writeOfficials(
        opts.dbPath,
        opts.country,
        [...officialsResult.officials],
      );
      console.log(`  Inserted: ${summary.inserted}`);
      console.log(`  Updated:  ${summary.updated}`);
      console.log(`  Total:    ${summary.inserted + summary.updated}`);
    }
  } else {
    console.log(`\n${opts.dryRun ? 'Dry run' : 'Validate only'}: skipping DB write.`);
  }

  // R35-F4: Don't overwrite good baseline with bad data — skip save on critical regression
  if (!opts.dryRun && !hasCriticalRegression) {
    saveBaseline(opts.dbPath, baseline);
  } else if (hasCriticalRegression) {
    console.log('    Baseline NOT saved — critical regression detected. Previous baseline preserved.');
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s.`);
}

// ============================================================================
// Validation Report Printer
// ============================================================================

function printValidationReport(report: ValidationReport): void {
  const l = report.layers;

  console.log(`\n  Layer 1 — Source Authority`);
  console.log(`    Confidence: ${l.sourceAuthority.confidence}/100`);
  for (const src of l.sourceAuthority.sources) {
    console.log(`    → ${src.name} (${src.type}): ${src.authority}, vintage ${src.vintage}`);
  }

  console.log(`\n  Layer 2 — Schema & Count`);
  console.log(`    Passed: ${l.schemaValidation.passed}`);
  console.log(`    Records: ${l.schemaValidation.recordCount}/${l.schemaValidation.expectedCount}`);
  if (l.schemaValidation.errors.length > 0) {
    console.log(`    Errors: ${l.schemaValidation.errors.length}`);
    for (const err of l.schemaValidation.errors.slice(0, 5)) {
      console.log(`      → ${err.recordId ?? '?'}: ${err.field} — ${err.message}`);
    }
    if (l.schemaValidation.errors.length > 5) {
      console.log(`      → ... and ${l.schemaValidation.errors.length - 5} more`);
    }
  }

  console.log(`\n  Layer 3 — Boundary Code Resolution`);
  console.log(`    Resolved: ${l.codeResolution.resolved}`);
  console.log(`    Unmatched: ${l.codeResolution.unmatched.length}`);
  console.log(`    Ambiguous: ${l.codeResolution.ambiguous.length}`);
  console.log(`    Vacant: ${l.codeResolution.vacant.length}`);
  if (l.codeResolution.unmatched.length > 0) {
    for (const u of l.codeResolution.unmatched.slice(0, 5)) {
      console.log(`      → ${u.officialName}: "${u.boundaryName}" matches no boundary`);
    }
    if (l.codeResolution.unmatched.length > 5) {
      console.log(`      → ... and ${l.codeResolution.unmatched.length - 5} more`);
    }
  }

  console.log(`\n  Layer 4 — PIP Verification`);
  console.log(`    Confirmed: ${l.pipVerification.confirmed}`);
  console.log(`    Mismatched: ${l.pipVerification.mismatched.length}`);
  console.log(`    Skipped: ${l.pipVerification.skipped}`);
  console.log(`    Total: ${l.pipVerification.total}`);

  console.log(`\n  Overall`);
  console.log(`    Confidence: ${report.overallConfidence}/100`);
  console.log(`    Blocking: ${report.blocking}`);
}

// ============================================================================
// Entry Point
// ============================================================================

// Only run main() when executed directly (not when imported for testing)
const isDirectRun = process.argv[1] &&
  (process.argv[1].endsWith('hydrate-country.ts') || process.argv[1].endsWith('hydrate-country.js'));

if (isDirectRun) {
  main().catch(err => {
    console.error('Fatal:', err);
    // R48-F2: Log failure to ingestion_log so freshness-monitor can detect it
    try {
      const failOpts = parseArgs();
      logIngestionFailure(failOpts.dbPath, failOpts.country, String(err));
    } catch { /* best-effort */ }
    process.exit(1);
  });
}
