#!/usr/bin/env npx tsx
/**
 * Migrate Rollback Command
 *
 * Rollback to a previous snapshot or by number of migrations.
 *
 * USAGE:
 *   shadow-atlas migrate rollback [options]
 *
 * OPTIONS:
 *   --to <snapshot>     Rollback to specific snapshot ID or name
 *   --steps <n>         Rollback N migrations (default: 1)
 *   --list              List available snapshots
 *
 * EXAMPLES:
 *   shadow-atlas migrate rollback
 *   shadow-atlas migrate rollback --steps 2
 *   shadow-atlas migrate rollback --to pre-migration-name
 *   shadow-atlas migrate rollback --list
 *
 * @module cli/commands/migrate/rollback
 */

import {
  rollback,
  listSnapshots,
  type Snapshot,
} from '../../lib/migration.js';

// ============================================================================
// Types
// ============================================================================

export interface RollbackOptions {
  readonly to?: string;
  readonly steps?: number;
  readonly list?: boolean;
  readonly verbose?: boolean;
  readonly json?: boolean;
}

export interface RollbackResult {
  readonly success: boolean;
  readonly snapshotId?: string;
  readonly error?: string;
}

// ============================================================================
// Command Implementation
// ============================================================================

/**
 * Run the rollback command
 */
export async function runRollback(options: RollbackOptions = {}): Promise<RollbackResult> {
  const { to, steps = 1, list = false, verbose = false, json = false } = options;

  // List mode
  if (list) {
    return await runListSnapshots({ verbose, json });
  }

  if (!json) {
    console.log('Rolling back to snapshot...\n');
    if (to) {
      console.log(`  Target: ${to}`);
    } else {
      console.log(`  Steps: ${steps}`);
    }
    console.log('');
  }

  const result = await rollback({ to, steps });

  if (!json) {
    if (result.success) {
      console.log(`Rollback successful!`);
      console.log(`  Restored from snapshot: ${result.snapshotId}`);
      console.log('\nNote: Regenerate TypeScript files with: shadow-atlas codegen generate');
    } else {
      console.error(`Rollback failed: ${result.error}`);
    }
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  }

  return result;
}

/**
 * List available snapshots
 */
async function runListSnapshots(options: {
  verbose?: boolean;
  json?: boolean;
}): Promise<RollbackResult> {
  const { verbose = false, json = false } = options;

  const snapshots = await listSnapshots();

  if (json) {
    console.log(JSON.stringify({ success: true, snapshots }, null, 2));
    return { success: true };
  }

  if (snapshots.length === 0) {
    console.log('No snapshots available.');
    console.log('\nCreate a snapshot with: shadow-atlas migrate snapshot <name>');
    return { success: true };
  }

  console.log(`Available snapshots (${snapshots.length}):\n`);

  for (const snapshot of snapshots) {
    const age = getAge(new Date(snapshot.createdAt));
    console.log(`  ${snapshot.id}`);
    console.log(`    Name: ${snapshot.name}`);
    console.log(`    Created: ${snapshot.createdAt} (${age})`);

    if (verbose) {
      console.log(`    Path: ${snapshot.path}`);
      console.log(`    Registries:`);
      for (const reg of snapshot.registries) {
        console.log(`      - ${reg.name}: ${reg.entryCount} entries`);
      }
      if (snapshot.metadata) {
        console.log(`    Metadata: ${JSON.stringify(snapshot.metadata)}`);
      }
    } else {
      const totalEntries = snapshot.registries.reduce((sum, r) => sum + r.entryCount, 0);
      console.log(`    Registries: ${snapshot.registries.length} (${totalEntries} total entries)`);
    }
    console.log('');
  }

  console.log('Rollback to a snapshot with: shadow-atlas migrate rollback --to <id>');

  return { success: true };
}

/**
 * Get human-readable age string
 */
function getAge(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} minute(s) ago`;
  if (diffHours < 24) return `${diffHours} hour(s) ago`;
  if (diffDays < 7) return `${diffDays} day(s) ago`;
  return `${Math.floor(diffDays / 7)} week(s) ago`;
}

// ============================================================================
// CLI Entry Point
// ============================================================================

function parseArgs(args: readonly string[]): RollbackOptions {
  const options: RollbackOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--to':
        (options as { to: string }).to = args[++i];
        break;

      case '--steps':
        const stepsValue = parseInt(args[++i], 10);
        if (isNaN(stepsValue) || stepsValue < 1) {
          console.error('Error: --steps must be a positive integer');
          process.exit(1);
        }
        (options as { steps: number }).steps = stepsValue;
        break;

      case '--list':
        (options as { list: boolean }).list = true;
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
shadow-atlas migrate rollback - Rollback to a snapshot

USAGE:
  shadow-atlas migrate rollback [options]

OPTIONS:
  --to <snapshot>     Rollback to specific snapshot ID or name
  --steps <n>         Rollback N snapshots (default: 1)
  --list              List available snapshots
  --verbose, -v       Show detailed output
  --json              Output results as JSON
  --help, -h          Show this help message

BEHAVIOR:
  - Restores NDJSON files from the snapshot
  - Does NOT automatically regenerate TypeScript files
  - Run 'shadow-atlas codegen generate' after rollback

SNAPSHOTS:
  Snapshots are created automatically before migrations (unless --no-snapshot).
  You can also create manual snapshots with 'shadow-atlas migrate snapshot'.

EXAMPLES:
  # Rollback to the most recent snapshot
  shadow-atlas migrate rollback

  # Rollback 2 snapshots
  shadow-atlas migrate rollback --steps 2

  # Rollback to a specific snapshot
  shadow-atlas migrate rollback --to pre-remove-county-entries

  # List available snapshots
  shadow-atlas migrate rollback --list
`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  runRollback(options)
    .then((result) => {
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error('Rollback failed:', error);
      process.exit(1);
    });
}
