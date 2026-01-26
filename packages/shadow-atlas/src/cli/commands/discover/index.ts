/**
 * Discover Commands Index
 *
 * Registers all discovery-related subcommands:
 * - search: Search for new portals
 * - import: Bulk import discoveries
 * - validate: Validate discovered URLs
 * - wave: Wave management
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { Command } from 'commander';
import { registerSearchCommand } from './search.js';
import { registerImportCommand } from './import.js';
import { registerValidateCommand } from './validate.js';
import { registerWaveCommand } from './wave.js';

/**
 * Register all discover subcommands
 *
 * @param program - Commander program instance
 */
export function registerDiscoverCommands(program: Command): void {
  const discover = program
    .command('discover')
    .description('Discovery operations for finding new municipal GIS portals');

  registerSearchCommand(discover);
  registerImportCommand(discover);
  registerValidateCommand(discover);
  registerWaveCommand(discover);
}
