#!/usr/bin/env npx tsx
/**
 * Codegen Extract Command
 *
 * Transform TypeScript generated files to NDJSON source files.
 *
 * USAGE:
 *   shadow-atlas codegen extract [options]
 *
 * OPTIONS:
 *   --registry <name>   Specific registry (default: all)
 *   --output-dir <path> Custom output directory
 *
 * EXAMPLES:
 *   shadow-atlas codegen extract
 *   shadow-atlas codegen extract --registry known-portals
 *   shadow-atlas codegen extract --output-dir ./backup
 *
 * @module cli/commands/codegen/extract
 */

import {
  extractAndWrite,
  REGISTRY_NAMES,
  type RegistryName,
  type ExtractionResult,
} from '../../lib/codegen.js';

// ============================================================================
// Types
// ============================================================================

export interface ExtractOptions {
  readonly registry?: RegistryName;
  readonly outputDir?: string;
  readonly verbose?: boolean;
  readonly json?: boolean;
}

export interface ExtractCommandResult {
  readonly success: boolean;
  readonly results: readonly ExtractionResult[];
  readonly errors: readonly string[];
}

// ============================================================================
// Command Implementation
// ============================================================================

/**
 * Run the extract command
 */
export async function runExtract(options: ExtractOptions = {}): Promise<ExtractCommandResult> {
  const { registry, outputDir, verbose = false, json = false } = options;

  const registries: readonly RegistryName[] = registry
    ? [registry]
    : REGISTRY_NAMES;

  const results: ExtractionResult[] = [];
  const errors: string[] = [];

  if (!json) {
    console.log('Extracting registries to NDJSON format...\n');
    if (outputDir) {
      console.log(`Output directory: ${outputDir}\n`);
    }
  }

  for (const reg of registries) {
    try {
      const result = await extractAndWrite(reg, outputDir);

      results.push(result);

      if (!json) {
        console.log(`  ${reg}.ndjson: ${result.entryCount} entries`);
        if (verbose) {
          console.log(`    Path: ${result.outputPath}`);
          console.log(`    Extracted: ${result.timestamp}`);
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

  const success = errors.length === 0;

  if (!json) {
    console.log('');
    if (success) {
      console.log('Extraction complete!');
      if (!outputDir) {
        console.log('Output: data/registries/');
      }
    } else {
      console.log(`Extraction completed with ${errors.length} error(s).`);
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

function parseArgs(args: readonly string[]): ExtractOptions {
  const options: ExtractOptions = {};

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

      case '--output-dir':
        (options as { outputDir: string }).outputDir = args[++i];
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
shadow-atlas codegen extract - Transform TypeScript to NDJSON

USAGE:
  shadow-atlas codegen extract [options]

OPTIONS:
  --registry <name>   Specific registry to extract (default: all)
                      Valid: known-portals, quarantined-portals, at-large-cities
  --output-dir <path> Custom output directory (default: data/registries/)
  --verbose, -v       Show detailed output
  --json              Output results as JSON
  --help, -h          Show this help message

NDJSON FORMAT:
  Line 1:    Header with schema, type, count, extracted timestamp, description
  Lines 2+:  One JSON object per line, sorted by FIPS

EXAMPLES:
  # Extract all registries to default location
  shadow-atlas codegen extract

  # Extract specific registry
  shadow-atlas codegen extract --registry known-portals

  # Extract to custom directory (e.g., for backup)
  shadow-atlas codegen extract --output-dir ./backup
`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  runExtract(options)
    .then((result) => {
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error('Extract failed:', error);
      process.exit(1);
    });
}
