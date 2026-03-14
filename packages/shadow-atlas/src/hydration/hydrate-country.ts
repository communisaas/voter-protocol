#!/usr/bin/env npx tsx
/**
 * Unified Country Hydration CLI
 *
 * Single entry point for boundary extraction, officials ingestion,
 * cell map construction, and validation for any supported country.
 *
 * Usage:
 *   npx tsx packages/shadow-atlas/src/hydration/hydrate-country.ts --country AU
 *   npx tsx packages/shadow-atlas/src/hydration/hydrate-country.ts --country CA --validate-only
 *   npx tsx packages/shadow-atlas/src/hydration/hydrate-country.ts --country GB --dry-run
 *   npx tsx packages/shadow-atlas/src/hydration/hydrate-country.ts --country NZ --skip-cell-map
 *
 * Pipeline (per country):
 *   1. Extract boundaries via provider.extractAll()
 *   2. Build boundary index (name → boundary)
 *   3. Extract officials via provider.extractOfficials(boundaryIndex)
 *   4. Build cell map via provider.buildCellMap(boundaries) [optional]
 *   5. Validate via provider.validate(boundaries, officials) [optional]
 *   6. Write to SQLite [unless --dry-run]
 *
 * @see country-provider.ts for the abstract CountryProvider class
 * @see memory/country-provider-unification.md for architectural spec
 */

import type { CountryProvider } from '../providers/international/country-provider.js';
import type { InternationalBoundary, AuthorityLevel } from '../providers/international/base-provider.js';
import type { OfficialRecord, ValidationReport } from '../providers/international/country-provider-types.js';
import { writeOfficials } from './db-writer.js';

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
  --skip-pip           Skip PIP verification (Layer 4)
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

  // Step 1: Extract boundaries
  console.log('[1/5] Extracting boundaries...');
  const boundaryResult = await provider.extractAll();
  const allBoundaries = boundaryResult.layers.flatMap(l => [...l.boundaries]);

  console.log(`  → ${allBoundaries.length} boundaries extracted`);
  console.log(`  → Successful layers: ${boundaryResult.successfulLayers}/${boundaryResult.layers.length}`);
  console.log(`  → Duration: ${boundaryResult.durationMs}ms`);
  console.log();

  // Step 2: Build boundary index
  console.log('[2/5] Building boundary index...');
  const boundaryIndex = new Map<string, InternationalBoundary>();
  for (const boundary of allBoundaries) {
    boundaryIndex.set(boundary.name, boundary);
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

  // Step 4: Build cell map (optional)
  if (!opts.skipCellMap && !opts.validateOnly) {
    console.log('[4/5] Building cell map (Tree 2)...');
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
  } else {
    console.log('[4/5] Cell map: SKIPPED');
  }
  console.log();

  // Step 5: Validate
  console.log('[5/5] Running 4-layer validation pipeline...');
  const report = await provider.validate(
    allBoundaries,
    [...officialsResult.officials],
  );
  printValidationReport(report);

  // Write to DB (unless dry run or validate only)
  if (!opts.dryRun && !opts.validateOnly) {
    if (report.blocking) {
      console.log('\nValidation BLOCKING — schema validation failed threshold. Skipping DB write.');
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

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
