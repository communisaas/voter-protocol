#!/usr/bin/env npx tsx
/**
 * Codegen Generate Command
 *
 * Transform NDJSON source files to TypeScript generated files.
 *
 * USAGE:
 *   shadow-atlas codegen generate [options]
 *
 * OPTIONS:
 *   --registry <name>   Specific registry (default: all)
 *   --verify            Verify round-trip after generation
 *   --check-only        Check if regeneration needed (for CI)
 *
 * EXAMPLES:
 *   shadow-atlas codegen generate
 *   shadow-atlas codegen generate --registry known-portals --verify
 *   shadow-atlas codegen generate --check-only
 *
 * @module cli/commands/codegen/generate
 */

import {
  generateAndWrite,
  verifyRoundTrip,
  checkNeedsRegeneration,
  REGISTRY_NAMES,
  type RegistryName,
} from '../../lib/codegen.js';

// ============================================================================
// Types
// ============================================================================

export interface GenerateOptions {
  readonly registry?: RegistryName;
  readonly verify?: boolean;
  readonly checkOnly?: boolean;
  readonly verbose?: boolean;
  readonly json?: boolean;
}

export interface GenerateResult {
  readonly success: boolean;
  readonly results: readonly RegistryGenerateResult[];
  readonly errors: readonly string[];
}

export interface RegistryGenerateResult {
  readonly registry: RegistryName;
  readonly entryCount: number;
  readonly outputPath: string;
  readonly timestamp: string;
  readonly verified?: boolean;
  readonly needsRegeneration?: boolean;
  readonly reason?: string;
}

// ============================================================================
// Command Implementation
// ============================================================================

/**
 * Run the generate command
 */
export async function runGenerate(options: GenerateOptions = {}): Promise<GenerateResult> {
  const { registry, verify = false, checkOnly = false, verbose = false, json = false } = options;

  const registries: readonly RegistryName[] = registry
    ? [registry]
    : REGISTRY_NAMES;

  const results: RegistryGenerateResult[] = [];
  const errors: string[] = [];

  if (!json) {
    if (checkOnly) {
      console.log('Checking if regeneration is needed...\n');
    } else {
      console.log('Generating TypeScript registries from NDJSON...\n');
    }
  }

  for (const reg of registries) {
    try {
      if (checkOnly) {
        // Check-only mode: verify without writing
        const { needsRegeneration, reason } = await checkNeedsRegeneration(reg);

        results.push({
          registry: reg,
          entryCount: 0,
          outputPath: '',
          timestamp: new Date().toISOString(),
          needsRegeneration,
          reason,
        });

        if (!json) {
          const status = needsRegeneration ? 'OUT OF SYNC' : 'IN SYNC';
          const icon = needsRegeneration ? 'x' : 'ok';
          console.log(`  [${icon}] ${reg}: ${status}`);
          if (needsRegeneration && reason && verbose) {
            console.log(`      Reason: ${reason}`);
          }
        }
      } else {
        // Generate mode
        const result = await generateAndWrite(reg);

        let verified: boolean | undefined;
        if (verify) {
          const verification = await verifyRoundTrip(reg);
          verified = verification.matches;
        }

        results.push({
          registry: reg,
          entryCount: result.entryCount,
          outputPath: result.outputPath,
          timestamp: result.timestamp,
          verified,
        });

        if (!json) {
          const verifyStatus = verify
            ? verified
              ? ' (verified)'
              : ' (verification FAILED)'
            : '';
          console.log(`  ${reg}.generated.ts: ${result.entryCount} entries${verifyStatus}`);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`${reg}: ${errorMessage}`);

      if (!json) {
        console.error(`  [ERROR] ${reg}: ${errorMessage}`);
      }
    }
  }

  const success =
    errors.length === 0 &&
    (checkOnly
      ? results.every((r) => !r.needsRegeneration)
      : results.every((r) => r.verified !== false));

  if (!json) {
    console.log('');
    if (checkOnly) {
      const outOfSync = results.filter((r) => r.needsRegeneration);
      if (outOfSync.length > 0) {
        console.log(`${outOfSync.length} registry/registries out of sync. Run 'shadow-atlas codegen generate' to fix.`);
      } else {
        console.log('All registries are in sync.');
      }
    } else {
      console.log('Generation complete!');
      if (verify) {
        const verifyFailed = results.filter((r) => r.verified === false);
        if (verifyFailed.length > 0) {
          console.log(`WARNING: ${verifyFailed.length} registry/registries failed verification.`);
        }
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

function parseArgs(args: readonly string[]): GenerateOptions {
  const options: GenerateOptions = {};

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

      case '--verify':
        (options as { verify: boolean }).verify = true;
        break;

      case '--check-only':
        (options as { checkOnly: boolean }).checkOnly = true;
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
shadow-atlas codegen generate - Transform NDJSON to TypeScript

USAGE:
  shadow-atlas codegen generate [options]

OPTIONS:
  --registry <name>   Specific registry to generate (default: all)
                      Valid: known-portals, quarantined-portals, at-large-cities
  --verify            Verify round-trip after generation
  --check-only        Check if regeneration needed (for CI)
                      Exit code 1 if out of sync
  --verbose, -v       Show detailed output
  --json              Output results as JSON
  --help, -h          Show this help message

EXAMPLES:
  # Generate all registries
  shadow-atlas codegen generate

  # Generate specific registry with verification
  shadow-atlas codegen generate --registry known-portals --verify

  # CI check (fails if out of sync)
  shadow-atlas codegen generate --check-only
`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  runGenerate(options)
    .then((result) => {
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error('Generate failed:', error);
      process.exit(1);
    });
}
