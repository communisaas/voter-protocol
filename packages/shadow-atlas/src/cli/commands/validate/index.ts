#!/usr/bin/env tsx
/**
 * Validate Commands Index
 *
 * Entry point for all validation subcommands.
 * Routes to specific validation commands based on first argument.
 *
 * SUBCOMMANDS:
 *   council          - Council district tessellation validation
 *   geoids           - GEOID format/coverage validation
 *   registry         - Registry health checks
 *   boundaries       - Boundary download validation
 *   international    - ISO 3166-1 country registry verification
 *   fips             - FIPS resolution edge case testing
 *   discover-results - Discovery output audit and classification
 *   comprehensive    - Full validation suite
 *   production-ready - Quick deployment check
 *
 * Usage:
 *   shadow-atlas validate <subcommand> [options]
 *   shadow-atlas validate --help
 */

// =============================================================================
// Subcommand Routing
// =============================================================================

const SUBCOMMANDS = {
  council: () => import('./council.js'),
  geoids: () => import('./geoids.js'),
  registry: () => import('./registry.js'),
  boundaries: () => import('./boundaries.js'),
  comprehensive: () => import('./comprehensive.js'),
  'production-ready': () => import('./production-ready.js'),
  international: () => import('./international.js'),
  fips: () => import('./fips.js'),
  'discover-results': () => import('./discover-results.js'),
} as const;

type Subcommand = keyof typeof SUBCOMMANDS;

// =============================================================================
// Help Text
// =============================================================================

function printHelp(): void {
  console.log(`
Shadow Atlas Validation Commands

Usage:
  shadow-atlas validate <subcommand> [options]

Subcommands:
  council          Council district tessellation validation
                   Options: --fips, --url, --tier, --batch, --limit

  geoids           GEOID format and coverage validation
                   Options: --layer, --state, --cross-validate

  registry         Registry health and coverage checks
                   Options: --coverage, --check-urls, --stale-threshold

  boundaries       Boundary download and structure validation
                   Options: --source, --limit, --fips

  international    International country registry verification
                   Options: --region, --format, --verbose

  fips             FIPS resolution edge case testing
                   Options: --url, --test-suite, --from-file, --format

  discover-results Discovery output audit and classification
                   Options: --input, --threshold, --attribute-cities, --report

  comprehensive    Full validation suite with readiness report
                   Options: --include-cross, --include-freshness, --output

  production-ready Quick pre-deployment check
                   Options: --strict, --stale-threshold

Global Options:
  --format <fmt>   Output format: table|json|csv|summary
  --json           Output as JSON
  --verbose, -v    Include detailed diagnostics
  --help, -h       Show this help

Examples:
  shadow-atlas validate council --fips 0666000
  shadow-atlas validate geoids --layer cd
  shadow-atlas validate registry --coverage top50
  shadow-atlas validate fips --test-suite edge-cases
  shadow-atlas validate discover-results --attribute-cities
  shadow-atlas validate international --region americas
  shadow-atlas validate comprehensive --full
  shadow-atlas validate production-ready --strict

For subcommand-specific help:
  shadow-atlas validate <subcommand> --help
`);
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Check for help flag
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  // Get subcommand
  const subcommand = args[0] as Subcommand;

  if (!(subcommand in SUBCOMMANDS)) {
    console.error(`Unknown subcommand: ${subcommand}`);
    console.error('');
    console.error('Available subcommands:');
    for (const cmd of Object.keys(SUBCOMMANDS)) {
      console.error(`  ${cmd}`);
    }
    console.error('');
    console.error('Use --help for more information.');
    process.exit(127);
  }

  // Remove subcommand from args before passing to subcommand module
  process.argv = [process.argv[0], process.argv[1], ...args.slice(1)];

  // Load and execute subcommand
  try {
    const module = await SUBCOMMANDS[subcommand]();
    // Module will execute on import if it has a main() that runs
    // Most modules use the pattern: if (import.meta.url === ...) main()
    // which won't trigger here, so we need to ensure they run

    // The modules are designed to run when executed directly
    // When imported, they just export functions
    // Since we're dispatching from index, the subcommand file needs to be the entry
    // We'll re-execute by updating process.argv and requiring the module execute itself

    // Actually, since we import the modules dynamically and they check import.meta.url,
    // they won't run automatically. We need a different approach.

    // Solution: Each module should export a main function we can call
    // For now, let's use dynamic import with explicit main call
    // But the modules use: if (import.meta.url === `file://${process.argv[1]}`)
    // which won't match when imported from here.

    // The cleanest solution is to have each module export its main function
    // and call it explicitly. But the modules are already written.
    // Let's use Node's child_process to spawn the correct file.

    // Actually, let's use a simpler approach: spawn the subcommand file directly
    const { spawn } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const subcommandFile = join(__dirname, `${subcommand}.ts`);
    const subcommandArgs = args.slice(1);

    const child = spawn('npx', ['tsx', subcommandFile, ...subcommandArgs], {
      stdio: 'inherit',
      shell: true,
    });

    child.on('close', (code) => {
      process.exit(code ?? 0);
    });

    child.on('error', (err) => {
      console.error(`Error executing subcommand: ${err.message}`);
      process.exit(1);
    });
  } catch (error) {
    console.error(`Error loading subcommand ${subcommand}:`);
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Export subcommand modules for programmatic use
export { SUBCOMMANDS };

// Export individual command validators for programmatic use
export * from './council.js';
export * from './geoids.js';
export * from './registry.js';
export * from './boundaries.js';
export * from './international.js';
export * from './fips.js';
export * from './discover-results.js';
export * from './comprehensive.js';
export * from './production-ready.js';

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
