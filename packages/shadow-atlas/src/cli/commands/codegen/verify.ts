#!/usr/bin/env npx tsx
/**
 * Codegen Verify Command
 *
 * Compare NDJSON source files with TypeScript generated files for consistency.
 *
 * USAGE:
 *   shadow-atlas codegen verify [options]
 *
 * OPTIONS:
 *   --registry <name>   Specific registry (default: all)
 *   --strict            Fail on any difference
 *
 * EXAMPLES:
 *   shadow-atlas codegen verify
 *   shadow-atlas codegen verify --registry known-portals --strict
 *
 * @module cli/commands/codegen/verify
 */

import {
  verifyRoundTrip,
  REGISTRY_NAMES,
  type RegistryName,
  type VerificationResult,
} from '../../lib/codegen.js';

// ============================================================================
// Types
// ============================================================================

export interface VerifyOptions {
  readonly registry?: RegistryName;
  readonly strict?: boolean;
  readonly verbose?: boolean;
  readonly json?: boolean;
}

export interface VerifyCommandResult {
  readonly success: boolean;
  readonly results: readonly VerificationResult[];
  readonly errors: readonly string[];
}

// ============================================================================
// Command Implementation
// ============================================================================

/**
 * Run the verify command
 */
export async function runVerify(options: VerifyOptions = {}): Promise<VerifyCommandResult> {
  const { registry, strict = false, verbose = false, json = false } = options;

  const registries: readonly RegistryName[] = registry
    ? [registry]
    : REGISTRY_NAMES;

  const results: VerificationResult[] = [];
  const errors: string[] = [];

  if (!json) {
    console.log('Verifying registry round-trip fidelity...\n');
  }

  for (const reg of registries) {
    try {
      const result = await verifyRoundTrip(reg);
      results.push(result);

      if (!json) {
        const status = result.matches ? 'ok' : 'MISMATCH';
        const icon = result.matches ? 'ok' : 'x';
        console.log(`[${icon}] ${reg}`);
        console.log(`    NDJSON: ${result.ndjsonCount} entries`);
        console.log(`    Generated: ${result.generatedCount} entries`);

        if (!result.matches) {
          if (result.missingInGenerated.length > 0) {
            const preview = result.missingInGenerated.slice(0, 5);
            const more = result.missingInGenerated.length > 5
              ? ` (+${result.missingInGenerated.length - 5} more)`
              : '';
            console.log(`    Missing in generated: ${preview.join(', ')}${more}`);
          }

          if (result.missingInNdjson.length > 0) {
            const preview = result.missingInNdjson.slice(0, 5);
            const more = result.missingInNdjson.length > 5
              ? ` (+${result.missingInNdjson.length - 5} more)`
              : '';
            console.log(`    Missing in NDJSON: ${preview.join(', ')}${more}`);
          }

          if (result.fieldMismatches.length > 0) {
            console.log(`    Field mismatches: ${result.fieldMismatches.length}`);
            if (verbose) {
              for (const mismatch of result.fieldMismatches.slice(0, 5)) {
                console.log(
                  `      ${mismatch.fips}.${mismatch.field}: ` +
                  `${JSON.stringify(mismatch.ndjsonValue)} !== ${JSON.stringify(mismatch.generatedValue)}`
                );
              }
              if (result.fieldMismatches.length > 5) {
                console.log(`      ... and ${result.fieldMismatches.length - 5} more`);
              }
            }
          }
        }
        console.log('');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`${reg}: ${errorMessage}`);

      if (!json) {
        console.log(`[x] ${reg}`);
        console.log(`    Error: ${errorMessage}`);
        console.log('');
      }
    }
  }

  // Determine success based on mode
  const allMatch = results.every((r) => r.matches);
  const success = strict ? allMatch && errors.length === 0 : errors.length === 0;

  if (!json) {
    if (allMatch && errors.length === 0) {
      console.log('All registries verified successfully!');
    } else {
      const mismatchCount = results.filter((r) => !r.matches).length;
      if (mismatchCount > 0) {
        console.log(`${mismatchCount} registry/registries have mismatches.`);
      }
      if (errors.length > 0) {
        console.log(`${errors.length} registry/registries had errors.`);
      }

      if (strict) {
        console.log('\nStrict mode: failing due to mismatches.');
      } else {
        console.log('\nRun with --strict to fail on mismatches.');
      }
    }
  }

  if (json) {
    console.log(JSON.stringify({ success, results, errors }, null, 2));
  }

  return { success, results, errors };
}

// ============================================================================
// CLI Entry Point
// ============================================================================

function parseArgs(args: readonly string[]): VerifyOptions {
  const options: VerifyOptions = {};

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

      case '--strict':
        (options as { strict: boolean }).strict = true;
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
shadow-atlas codegen verify - Verify NDJSON/TypeScript consistency

USAGE:
  shadow-atlas codegen verify [options]

OPTIONS:
  --registry <name>   Specific registry to verify (default: all)
                      Valid: known-portals, quarantined-portals, at-large-cities
  --strict            Fail on any difference (exit code 1)
  --verbose, -v       Show detailed mismatch information
  --json              Output results as JSON
  --help, -h          Show this help message

VERIFICATION CHECKS:
  1. Entry counts match between NDJSON and generated TypeScript
  2. All FIPS keys present in both
  3. All field values match (deep comparison)

EXAMPLES:
  # Verify all registries
  shadow-atlas codegen verify

  # Verify specific registry with details
  shadow-atlas codegen verify --registry known-portals --verbose

  # CI mode: fail on any mismatch
  shadow-atlas codegen verify --strict
`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  runVerify(options)
    .then((result) => {
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error('Verify failed:', error);
      process.exit(1);
    });
}
