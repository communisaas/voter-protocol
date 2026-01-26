/**
 * Curate Commands Index
 *
 * Registers all data curation subcommands:
 * - categorize: Categorize unresolved layers for recovery analysis
 * - promote: Promote categorized layers to target registry
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { Command } from 'commander';
import { registerCategorizeCommand } from './categorize.js';
import { registerPromoteCommand } from './promote.js';

/**
 * Register all curate subcommands
 *
 * @param program - Commander program instance
 */
export function registerCurateCommands(program: Command): void {
  const curate = program
    .command('curate')
    .description('Data curation workflows for layer recovery and registry management');

  registerCategorizeCommand(curate);
  registerPromoteCommand(curate);
}
