#!/usr/bin/env npx tsx
/**
 * Codegen Sync Command
 *
 * Full sync workflow: extract TypeScript to NDJSON, regenerate TypeScript, verify.
 * This is a convenience command for development that ensures consistency.
 *
 * USAGE:
 *   shadow-atlas codegen sync [options]
 *
 * OPTIONS:
 *   --registry <name>   Specific registry (default: all)
 *
 * WORKFLOW:
 *   1. Extract current TypeScript to temporary NDJSON (captures any manual TS changes)
 *   2. Generate TypeScript from NDJSON source of truth
 *   3. Verify round-trip fidelity
 *
 * EXAMPLES:
 *   shadow-atlas codegen sync
 *   shadow-atlas codegen sync --registry known-portals
 *
 * @module cli/commands/codegen/sync
 */

import {
  generateAndWrite,
  verifyRoundTrip,
  REGISTRY_NAMES,
  type RegistryName,
} from '../../lib/codegen.js';

// ============================================================================
// Types
// ============================================================================

export interface SyncOptions {
  readonly registry?: RegistryName;
  readonly verbose?: boolean;
  readonly json?: boolean;
}

export interface SyncResult {
  readonly success: boolean;
  readonly steps: readonly SyncStep[];
  readonly errors: readonly string[];
}

export interface SyncStep {
  readonly step: string;
  readonly registry: RegistryName;
  readonly status: 'success' | 'failed' | 'skipped';
  readonly message?: string;
  readonly duration_ms: number;
}

// ============================================================================
// Command Implementation
// ============================================================================

/**
 * Run the sync command
 */
export async function runSync(options: SyncOptions = {}): Promise<SyncResult> {
  const { registry, verbose = false, json = false } = options;

  const registries: readonly RegistryName[] = registry
    ? [registry]
    : REGISTRY_NAMES;

  const steps: SyncStep[] = [];
  const errors: string[] = [];

  if (!json) {
    console.log('Running codegen sync workflow...\n');
    console.log('Step 1: Generate TypeScript from NDJSON');
    console.log('Step 2: Verify round-trip fidelity\n');
  }

  // Step 1: Generate TypeScript from NDJSON
  if (!json) {
    console.log('--- Step 1: Generate ---\n');
  }

  for (const reg of registries) {
    const startTime = Date.now();

    try {
      const result = await generateAndWrite(reg);

      steps.push({
        step: 'generate',
        registry: reg,
        status: 'success',
        message: `${result.entryCount} entries`,
        duration_ms: Date.now() - startTime,
      });

      if (!json) {
        console.log(`  [ok] ${reg}: ${result.entryCount} entries`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`generate ${reg}: ${errorMessage}`);

      steps.push({
        step: 'generate',
        registry: reg,
        status: 'failed',
        message: errorMessage,
        duration_ms: Date.now() - startTime,
      });

      if (!json) {
        console.log(`  [x] ${reg}: ${errorMessage}`);
      }
    }
  }

  // Step 2: Verify round-trip fidelity
  if (!json) {
    console.log('\n--- Step 2: Verify ---\n');
  }

  for (const reg of registries) {
    const startTime = Date.now();

    // Skip verification if generation failed
    const genStep = steps.find((s) => s.step === 'generate' && s.registry === reg);
    if (genStep?.status === 'failed') {
      steps.push({
        step: 'verify',
        registry: reg,
        status: 'skipped',
        message: 'Skipped due to generation failure',
        duration_ms: 0,
      });

      if (!json) {
        console.log(`  [skip] ${reg}: skipped (generation failed)`);
      }
      continue;
    }

    try {
      const result = await verifyRoundTrip(reg);

      steps.push({
        step: 'verify',
        registry: reg,
        status: result.matches ? 'success' : 'failed',
        message: result.matches
          ? `${result.ndjsonCount} entries verified`
          : `Mismatches found: ${result.fieldMismatches.length} fields, ${result.missingInGenerated.length + result.missingInNdjson.length} missing`,
        duration_ms: Date.now() - startTime,
      });

      if (!json) {
        if (result.matches) {
          console.log(`  [ok] ${reg}: ${result.ndjsonCount} entries verified`);
        } else {
          console.log(`  [x] ${reg}: verification failed`);
          if (verbose) {
            if (result.missingInGenerated.length > 0) {
              console.log(`      Missing in generated: ${result.missingInGenerated.length}`);
            }
            if (result.missingInNdjson.length > 0) {
              console.log(`      Missing in NDJSON: ${result.missingInNdjson.length}`);
            }
            if (result.fieldMismatches.length > 0) {
              console.log(`      Field mismatches: ${result.fieldMismatches.length}`);
            }
          }
          errors.push(`verify ${reg}: verification failed`);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`verify ${reg}: ${errorMessage}`);

      steps.push({
        step: 'verify',
        registry: reg,
        status: 'failed',
        message: errorMessage,
        duration_ms: Date.now() - startTime,
      });

      if (!json) {
        console.log(`  [x] ${reg}: ${errorMessage}`);
      }
    }
  }

  // Summary
  const success = errors.length === 0;
  const totalDuration = steps.reduce((acc, s) => acc + s.duration_ms, 0);

  if (!json) {
    console.log('\n--- Summary ---\n');

    const generateOk = steps.filter((s) => s.step === 'generate' && s.status === 'success').length;
    const verifyOk = steps.filter((s) => s.step === 'verify' && s.status === 'success').length;
    const total = registries.length;

    console.log(`  Generate: ${generateOk}/${total} succeeded`);
    console.log(`  Verify:   ${verifyOk}/${total} succeeded`);
    console.log(`  Duration: ${totalDuration}ms`);
    console.log('');

    if (success) {
      console.log('Sync completed successfully!');
    } else {
      console.log(`Sync completed with ${errors.length} error(s).`);
    }
  }

  if (json) {
    console.log(JSON.stringify({ success, steps, errors, duration_ms: totalDuration }, null, 2));
  }

  return { success, steps, errors };
}

// ============================================================================
// CLI Entry Point
// ============================================================================

function parseArgs(args: readonly string[]): SyncOptions {
  const options: SyncOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--registry':
        const registryValue = args[++i];
        if (!REGISTRY_NAMES.includes(registryValue as RegistryName)) {
          console.error(`Invalid registry: ${registryValue}`);
          console.error(`Valid registries: ${REGISTRY_NAMES.join(', ')}`);
          process.exit(1);
        }
        (options as { registry: RegistryName }).registry = registryValue as RegistryName;
        break;

      case '--verbose':
      case '-v':
        (options as { verbose: boolean }).verbose = true;
        break;

      case '--json':
        (options as { json: boolean }).json = true;
        break;

      case '--help':
      case '-h':
        printHelp();
        process.exit(0);

      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
shadow-atlas codegen sync - Full sync workflow

USAGE:
  shadow-atlas codegen sync [options]

OPTIONS:
  --registry <name>   Specific registry to sync (default: all)
                      Valid: known-portals, quarantined-portals, at-large-cities
  --verbose, -v       Show detailed output
  --json              Output results as JSON
  --help, -h          Show this help message

WORKFLOW:
  1. Generate TypeScript from NDJSON source of truth
  2. Verify round-trip fidelity between NDJSON and TypeScript

This command ensures that the NDJSON source files and generated TypeScript
files are in sync. It's useful during development after making changes to
NDJSON data files.

EXAMPLES:
  # Sync all registries
  shadow-atlas codegen sync

  # Sync specific registry with verbose output
  shadow-atlas codegen sync --registry known-portals --verbose
`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  runSync(options)
    .then((result) => {
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error('Sync failed:', error);
      process.exit(1);
    });
}
