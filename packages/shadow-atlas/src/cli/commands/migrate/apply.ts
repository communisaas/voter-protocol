#!/usr/bin/env npx tsx
/**
 * Migrate Apply Command
 *
 * Apply a migration file to transform registry data.
 *
 * USAGE:
 *   shadow-atlas migrate apply <migration> [options]
 *
 * OPTIONS:
 *   --dry-run           Show changes without applying
 *   --force             Apply even with validation warnings
 *   --snapshot          Create snapshot before applying (default: true)
 *   --no-snapshot       Skip snapshot creation
 *   --verbose, -v       Show detailed output
 *
 * MIGRATION FILE FORMAT:
 *   Migration files export: { name, description?, up, down?, validate? }
 *
 * EXAMPLES:
 *   shadow-atlas migrate apply 2026-01-25-remove-county-entries
 *   shadow-atlas migrate apply ./migrations/fix-fips-codes.ts --dry-run
 *   shadow-atlas migrate apply ./migrations/update-urls.ts --force
 *
 * @module cli/commands/migrate/apply
 */

import { resolve, isAbsolute } from 'node:path';
import {
  applyMigration,
  getMigrationsDir,
  type MigrationResult,
} from '../../lib/migration.js';

// ============================================================================
// Types
// ============================================================================

export interface ApplyOptions {
  readonly migration: string;
  readonly dryRun?: boolean;
  readonly force?: boolean;
  readonly snapshot?: boolean;
  readonly verbose?: boolean;
  readonly json?: boolean;
}

// ============================================================================
// Command Implementation
// ============================================================================

/**
 * Run the apply command
 */
export async function runApply(options: ApplyOptions): Promise<MigrationResult> {
  const {
    migration,
    dryRun = false,
    force = false,
    snapshot = true,
    verbose = false,
    json = false,
  } = options;

  // Resolve migration file path
  let migrationPath = migration;

  if (!isAbsolute(migration)) {
    // Check if it's a migration name (without path)
    if (!migration.includes('/') && !migration.includes('\\')) {
      // Look in migrations directory
      const migrationsDir = getMigrationsDir();
      const possiblePaths = [
        resolve(migrationsDir, `${migration}.ts`),
        resolve(migrationsDir, `${migration}.js`),
        resolve(migrationsDir, migration, 'index.ts'),
        resolve(migrationsDir, migration, 'index.js'),
      ];

      // Use the first existing path or default to .ts
      migrationPath = possiblePaths[0];
    } else {
      // It's a relative path
      migrationPath = resolve(process.cwd(), migration);
    }
  }

  if (!json) {
    console.log('Applying migration...\n');
    console.log(`  Migration: ${migration}`);
    console.log(`  Path: ${migrationPath}`);
    console.log(`  Dry run: ${dryRun}`);
    console.log(`  Force: ${force}`);
    console.log(`  Snapshot: ${snapshot && !dryRun}`);
    console.log('');
  }

  const result = await applyMigration(migrationPath, {
    dryRun,
    force,
    snapshot: snapshot && !dryRun,
    verbose,
  });

  if (!json) {
    if (result.success) {
      console.log(`Migration "${result.migrationName}" applied successfully!`);
      if (result.snapshotId) {
        console.log(`  Snapshot created: ${result.snapshotId}`);
      }
      if (dryRun) {
        console.log('\n  (Dry run - no changes were made)');
      }
    } else {
      console.error(`Migration "${result.migrationName}" failed.`);
      if (result.errors && result.errors.length > 0) {
        console.error('\nErrors:');
        for (const error of result.errors) {
          console.error(`  - ${error}`);
        }
      }
    }

    if (result.changes.length > 0) {
      console.log(`\nChanges (${result.changes.length}):`);
      for (const change of result.changes.slice(0, 10)) {
        const actionSymbol = change.action === 'add' ? '+' : change.action === 'delete' ? '-' : '~';
        console.log(`  [${actionSymbol}] ${change.registry}:${change.fips}`);
        if (change.field) {
          console.log(`      ${change.field}: ${JSON.stringify(change.oldValue)} -> ${JSON.stringify(change.newValue)}`);
        }
      }
      if (result.changes.length > 10) {
        console.log(`  ... and ${result.changes.length - 10} more`);
      }
    }
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  }

  return result;
}

// ============================================================================
// CLI Entry Point
// ============================================================================

function parseArgs(args: readonly string[]): ApplyOptions | null {
  let migration: string | undefined;
  let dryRun = false;
  let force = false;
  let snapshot = true;
  let verbose = false;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--dry-run':
        dryRun = true;
        break;

      case '--force':
        force = true;
        break;

      case '--snapshot':
        snapshot = true;
        break;

      case '--no-snapshot':
        snapshot = false;
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
        // Positional argument: migration path
        if (!migration) {
          migration = arg;
        } else {
          console.error(`Unexpected argument: ${arg}`);
          process.exit(1);
        }
    }
  }

  if (!migration) {
    console.error('Error: Migration path is required.');
    console.error('Usage: shadow-atlas migrate apply <migration> [options]');
    process.exit(1);
  }

  return { migration, dryRun, force, snapshot, verbose, json };
}

function printHelp(): void {
  console.log(`
shadow-atlas migrate apply - Apply a migration

USAGE:
  shadow-atlas migrate apply <migration> [options]

ARGUMENTS:
  migration           Migration name or file path

OPTIONS:
  --dry-run           Show changes without applying
  --force             Apply even with validation warnings
  --snapshot          Create snapshot before applying (default)
  --no-snapshot       Skip snapshot creation
  --verbose, -v       Show detailed output
  --json              Output results as JSON
  --help, -h          Show this help message

MIGRATION FILE FORMAT:
  Migrations are TypeScript/JavaScript files that export:

  {
    name: string;           // Required: migration identifier
    description?: string;   // Optional: human-readable description
    up: async (ctx) => {};  // Required: apply migration
    down?: async (ctx) => {};  // Optional: rollback migration
    validate?: async (ctx) => MigrationValidation;  // Optional: pre-validation
  }

  Migration context (ctx) provides:
  - dryRun: boolean
  - verbose: boolean
  - log(message): void
  - warn(message): void
  - readNdjson(registry): Promise<NdjsonData>
  - writeNdjson(registry, data): Promise<void>

EXAMPLES:
  # Apply a migration by name (looks in data/migrations/)
  shadow-atlas migrate apply 2026-01-25-remove-county-entries

  # Apply a migration by path
  shadow-atlas migrate apply ./migrations/fix-fips-codes.ts

  # Dry run to preview changes
  shadow-atlas migrate apply ./migrations/update-urls.ts --dry-run

  # Apply without creating snapshot
  shadow-atlas migrate apply ./migrations/minor-fix.ts --no-snapshot
`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options) {
    runApply(options)
      .then((result) => {
        process.exit(result.success ? 0 : 1);
      })
      .catch((error) => {
        console.error('Migration apply failed:', error);
        process.exit(1);
      });
  }
}
