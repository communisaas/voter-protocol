/**
 * Registry Commands Index
 *
 * Registers all registry subcommands for the shadow-atlas CLI.
 *
 * Usage:
 *   shadow-atlas registry <subcommand> [options]
 *
 * Subcommands:
 *   list      List registry entries with filters
 *   get       Get single entry by FIPS
 *   add       Add new entry
 *   update    Update entry fields
 *   delete    Soft-delete to quarantine
 *   stats     Registry statistics
 *   diff      Show registry drift
 *
 * @module cli/commands/registry
 */

import { main as listMain, listCommand, parseListArgs, type ListOptions } from './list.js';
import { main as getMain, getCommand, parseGetArgs, type GetOptions } from './get.js';
import { main as addMain, addCommand, parseAddArgs, type AddOptions } from './add.js';
import { main as updateMain, updateCommand, parseUpdateArgs, type UpdateOptions } from './update.js';
import { main as deleteMain, deleteCommand, parseDeleteArgs, type DeleteOptions } from './delete.js';
import { main as statsMain, statsCommand, parseStatsArgs, type StatsOptions } from './stats.js';
import { main as diffMain, diffCommand, parseDiffArgs, type DiffOptions } from './diff.js';

/**
 * Registry subcommands
 */
export type RegistrySubcommand = 'list' | 'get' | 'add' | 'update' | 'delete' | 'stats' | 'diff';

/**
 * Print registry help
 */
function printHelp(): void {
  console.log('Usage: shadow-atlas registry <subcommand> [options]');
  console.log('');
  console.log('Registry CRUD operations for Shadow Atlas data sources.');
  console.log('');
  console.log('Subcommands:');
  console.log('  list      List registry entries with filters');
  console.log('  get       Get single entry by FIPS');
  console.log('  add       Add new entry to known-portals');
  console.log('  update    Update entry fields');
  console.log('  delete    Soft-delete entry to quarantine');
  console.log('  stats     Show registry statistics');
  console.log('  diff      Compare NDJSON to generated TypeScript');
  console.log('');
  console.log('Examples:');
  console.log('  shadow-atlas registry list --state CA --confidence 70');
  console.log('  shadow-atlas registry get 0666000 --include-history');
  console.log('  shadow-atlas registry add --fips 0601234 --city "Example City" --state CA \\');
  console.log('                           --url "https://..." --portal-type arcgis --count 7');
  console.log('  shadow-atlas registry update 0666000 --last-verified');
  console.log('  shadow-atlas registry delete 0666000 --reason "Wrong data" --pattern wrong_data');
  console.log('  shadow-atlas registry stats --detailed');
  console.log('  shadow-atlas registry diff --verbose');
  console.log('');
  console.log('For subcommand help:');
  console.log('  shadow-atlas registry <subcommand> --help');
}

/**
 * Registry command router
 *
 * Routes to the appropriate subcommand based on the first argument.
 *
 * @param args - CLI arguments after "registry"
 */
export async function registryCommand(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    return;
  }

  const subcommand = args[0] as RegistrySubcommand;
  const subArgs = args.slice(1);

  switch (subcommand) {
    case 'list':
      await listMain(subArgs);
      break;

    case 'get':
      await getMain(subArgs);
      break;

    case 'add':
      await addMain(subArgs);
      break;

    case 'update':
      await updateMain(subArgs);
      break;

    case 'delete':
      await deleteMain(subArgs);
      break;

    case 'stats':
      await statsMain(subArgs);
      break;

    case 'diff':
      await diffMain(subArgs);
      break;

    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error('');
      printHelp();
      process.exit(1);
  }
}

/**
 * CLI entry point
 */
export async function main(args: string[]): Promise<void> {
  await registryCommand(args);
}

// Re-export all subcommand functions and types for programmatic use
export {
  // List
  listCommand,
  parseListArgs,
  type ListOptions,
  // Get
  getCommand,
  parseGetArgs,
  type GetOptions,
  // Add
  addCommand,
  parseAddArgs,
  type AddOptions,
  // Update
  updateCommand,
  parseUpdateArgs,
  type UpdateOptions,
  // Delete
  deleteCommand,
  parseDeleteArgs,
  type DeleteOptions,
  // Stats
  statsCommand,
  parseStatsArgs,
  type StatsOptions,
  // Diff
  diffCommand,
  parseDiffArgs,
  type DiffOptions,
};
