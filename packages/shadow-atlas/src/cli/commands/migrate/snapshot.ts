#!/usr/bin/env npx tsx
/**
 * Migrate Snapshot Command
 *
 * Create a named snapshot of all NDJSON registries.
 *
 * USAGE:
 *   shadow-atlas migrate snapshot <name> [options]
 *
 * OPTIONS:
 *   --metadata <json>   Additional metadata (JSON string)
 *
 * EXAMPLES:
 *   shadow-atlas migrate snapshot pre-cleanup
 *   shadow-atlas migrate snapshot "before-wave-n" --metadata '{"wave": "N"}'
 *
 * @module cli/commands/migrate/snapshot
 */

import { createSnapshot, type Snapshot } from '../../lib/migration.js';

// ============================================================================
// Types
// ============================================================================

export interface SnapshotOptions {
  readonly name: string;
  readonly metadata?: Record<string, unknown>;
  readonly verbose?: boolean;
  readonly json?: boolean;
}

export interface SnapshotResult {
  readonly success: boolean;
  readonly snapshot?: Snapshot;
  readonly error?: string;
}

// ============================================================================
// Command Implementation
// ============================================================================

/**
 * Run the snapshot command
 */
export async function runSnapshot(options: SnapshotOptions): Promise<SnapshotResult> {
  const { name, metadata, verbose = false, json = false } = options;

  if (!json) {
    console.log(`Creating snapshot "${name}"...\n`);
  }

  try {
    const snapshot = await createSnapshot(name, metadata);

    if (!json) {
      console.log('Snapshot created successfully!\n');
      console.log(`  ID: ${snapshot.id}`);
      console.log(`  Name: ${snapshot.name}`);
      console.log(`  Created: ${snapshot.createdAt}`);
      console.log(`  Path: ${snapshot.path}`);
      console.log('');
      console.log('  Registries:');
      for (const reg of snapshot.registries) {
        console.log(`    - ${reg.name}: ${reg.entryCount} entries`);
      }

      if (metadata && verbose) {
        console.log('');
        console.log('  Metadata:', JSON.stringify(metadata, null, 2));
      }

      console.log('');
      console.log('Restore with: shadow-atlas migrate rollback --to', snapshot.id);
    }

    if (json) {
      console.log(JSON.stringify({ success: true, snapshot }, null, 2));
    }

    return { success: true, snapshot };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (!json) {
      console.error(`Snapshot failed: ${errorMessage}`);
    }

    if (json) {
      console.log(JSON.stringify({ success: false, error: errorMessage }, null, 2));
    }

    return { success: false, error: errorMessage };
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

function parseArgs(args: readonly string[]): SnapshotOptions | null {
  let name: string | undefined;
  let metadata: Record<string, unknown> | undefined;
  let verbose = false;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--metadata':
        const metadataStr = args[++i];
        try {
          metadata = JSON.parse(metadataStr);
        } catch {
          console.error('Error: --metadata must be valid JSON');
          process.exit(1);
        }
        break;

      case '--verbose':
      case '-v':
        verbose = true;
        break;

      case '--json':
        json = true;
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
        // Positional argument: snapshot name
        if (!name) {
          name = arg;
        } else {
          console.error(`Unexpected argument: ${arg}`);
          process.exit(1);
        }
    }
  }

  if (!name) {
    console.error('Error: Snapshot name is required.');
    console.error('Usage: shadow-atlas migrate snapshot <name> [options]');
    process.exit(1);
  }

  return { name, metadata, verbose, json };
}

function printHelp(): void {
  console.log(`
shadow-atlas migrate snapshot - Create a named snapshot

USAGE:
  shadow-atlas migrate snapshot <name> [options]

ARGUMENTS:
  name                Snapshot name (descriptive identifier)

OPTIONS:
  --metadata <json>   Additional metadata as JSON string
  --verbose, -v       Show detailed output
  --json              Output results as JSON
  --help, -h          Show this help message

SNAPSHOT CONTENTS:
  Snapshots include copies of all NDJSON registry files:
  - known-portals.ndjson
  - quarantined-portals.ndjson
  - at-large-cities.ndjson

SNAPSHOT NAMING:
  - Use descriptive names: "pre-wave-n", "before-cleanup", "release-1.0"
  - Snapshot ID is auto-generated with timestamp + name

EXAMPLES:
  # Create a simple snapshot
  shadow-atlas migrate snapshot pre-cleanup

  # Create snapshot with metadata
  shadow-atlas migrate snapshot "wave-n-complete" --metadata '{"wave":"N","portals":64}'

  # Create snapshot before major operation
  shadow-atlas migrate snapshot "before-county-removal" --verbose
`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options) {
    runSnapshot(options)
      .then((result) => {
        process.exit(result.success ? 0 : 1);
      })
      .catch((error) => {
        console.error('Snapshot failed:', error);
        process.exit(1);
      });
  }
}
