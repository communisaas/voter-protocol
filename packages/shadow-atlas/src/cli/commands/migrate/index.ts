/**
 * Migrate Commands Index
 *
 * Registers all migration subcommands for the shadow-atlas CLI.
 *
 * @module cli/commands/migrate
 */

export { runApply } from './apply.js';
export { runRollback } from './rollback.js';
export { runStatus } from './status.js';
export { runSnapshot } from './snapshot.js';

/**
 * Migrate command metadata for help display
 */
export const migrateCommands = {
  apply: {
    name: 'apply',
    description: 'Apply a migration file',
    usage: 'shadow-atlas migrate apply <migration> [options]',
    options: [
      '--dry-run           Show changes without applying',
      '--force             Apply even with warnings',
      '--snapshot          Create snapshot before applying (default: true)',
      '--no-snapshot       Skip snapshot creation',
    ],
  },
  rollback: {
    name: 'rollback',
    description: 'Rollback to a previous snapshot',
    usage: 'shadow-atlas migrate rollback [options]',
    options: [
      '--to <snapshot>     Rollback to specific snapshot ID or name',
      '--steps <n>         Rollback N migrations (default: 1)',
      '--list              List available snapshots',
    ],
  },
  status: {
    name: 'status',
    description: 'Show migration status',
    usage: 'shadow-atlas migrate status',
    options: [
      '--verbose, -v       Show detailed information',
    ],
  },
  snapshot: {
    name: 'snapshot',
    description: 'Create a named snapshot',
    usage: 'shadow-atlas migrate snapshot <name> [options]',
    options: [
      '--metadata <json>   Additional metadata (JSON string)',
    ],
  },
};
