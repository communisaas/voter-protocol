#!/usr/bin/env npx tsx
/**
 * Migrate Status Command
 *
 * Show migration status including applied migrations, pending migrations,
 * and current snapshot.
 *
 * USAGE:
 *   shadow-atlas migrate status [options]
 *
 * OPTIONS:
 *   --verbose, -v       Show detailed information
 *
 * EXAMPLES:
 *   shadow-atlas migrate status
 *   shadow-atlas migrate status --verbose
 *
 * @module cli/commands/migrate/status
 */

import { getMigrationStatus, type MigrationStatus } from '../../lib/migration.js';

// ============================================================================
// Types
// ============================================================================

export interface StatusOptions {
  readonly verbose?: boolean;
  readonly json?: boolean;
}

export interface StatusResult {
  readonly success: boolean;
  readonly status: MigrationStatus;
}

// ============================================================================
// Command Implementation
// ============================================================================

/**
 * Run the status command
 */
export async function runStatus(options: StatusOptions = {}): Promise<StatusResult> {
  const { verbose = false, json = false } = options;

  const status = await getMigrationStatus();

  if (json) {
    console.log(JSON.stringify({ success: true, status }, null, 2));
    return { success: true, status };
  }

  console.log('Migration Status\n');
  console.log('================\n');

  // Applied migrations
  console.log('Applied Migrations:');
  if (status.appliedMigrations.length === 0) {
    console.log('  No migrations have been applied.\n');
  } else {
    for (const migration of status.appliedMigrations) {
      const age = getAge(new Date(migration.appliedAt));
      console.log(`  - ${migration.name}`);
      console.log(`    Applied: ${migration.appliedAt} (${age})`);
      if (verbose && migration.snapshotId) {
        console.log(`    Snapshot: ${migration.snapshotId}`);
      }
    }
    console.log('');
  }

  // Pending migrations
  console.log('Pending Migrations:');
  if (status.pendingMigrations.length === 0) {
    console.log('  No pending migrations.\n');
  } else {
    for (const migration of status.pendingMigrations) {
      console.log(`  - ${migration}`);
    }
    console.log('');
  }

  // Current snapshot
  console.log('Current Snapshot:');
  if (status.currentSnapshot) {
    const snap = status.currentSnapshot;
    const age = getAge(new Date(snap.createdAt));
    console.log(`  ID: ${snap.id}`);
    console.log(`  Name: ${snap.name}`);
    console.log(`  Created: ${snap.createdAt} (${age})`);

    if (verbose) {
      console.log(`  Path: ${snap.path}`);
      console.log(`  Registries:`);
      for (const reg of snap.registries) {
        console.log(`    - ${reg.name}: ${reg.entryCount} entries`);
      }
    } else {
      const totalEntries = snap.registries.reduce((sum, r) => sum + r.entryCount, 0);
      console.log(`  Total entries: ${totalEntries}`);
    }
  } else {
    console.log('  No snapshots available.');
    console.log('  Create one with: shadow-atlas migrate snapshot <name>');
  }
  console.log('');

  // Summary
  console.log('Summary:');
  console.log(`  Applied: ${status.appliedMigrations.length} migration(s)`);
  console.log(`  Pending: ${status.pendingMigrations.length} migration(s)`);
  console.log(`  Snapshot: ${status.currentSnapshot ? 'Available' : 'None'}`);

  return { success: true, status };
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

function parseArgs(args: readonly string[]): StatusOptions {
  const options: StatusOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
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
shadow-atlas migrate status - Show migration status

USAGE:
  shadow-atlas migrate status [options]

OPTIONS:
  --verbose, -v       Show detailed information
  --json              Output results as JSON
  --help, -h          Show this help message

OUTPUT:
  - Applied migrations with timestamps
  - Pending migrations found in data/migrations/
  - Current (most recent) snapshot information

EXAMPLES:
  # Show status
  shadow-atlas migrate status

  # Show detailed status
  shadow-atlas migrate status --verbose

  # JSON output for scripting
  shadow-atlas migrate status --json
`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  runStatus(options)
    .then((result) => {
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error('Status failed:', error);
      process.exit(1);
    });
}
