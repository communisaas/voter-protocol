/**
 * Quarantine Workflow Commands
 *
 * CLI commands for managing the quarantine state machine:
 * - add: Move entry from known-portals to quarantined-portals
 * - list: List all quarantined entries with filters
 * - resolve: Attempt automated resolution
 * - restore: Restore entry to known-portals
 * - promote: Promote to at-large-cities (terminal state)
 *
 * STATE MACHINE:
 * ```
 * KNOWN_PORTALS (active)
 *        |
 *        v (quarantine add)
 * QUARANTINED (suspended)
 *       / \
 *      v   v
 * (restore) (promote)
 *    |         |
 *    v         v
 * KNOWN_PORTALS  AT_LARGE_CITIES
 *  (restored)      (terminal)
 * ```
 */

import { addCommand } from './add.js';
import { listCommand } from './list.js';
import { resolveCommand } from './resolve.js';
import { restoreCommand } from './restore.js';
import { promoteCommand } from './promote.js';

export interface CommandOptions {
  verbose?: boolean;
  json?: boolean;
  dryRun?: boolean;
}

export interface QuarantineCommandContext {
  options: CommandOptions;
  args: string[];
}

/**
 * Quarantine command dispatcher
 */
export async function quarantineCommand(
  subcommand: string,
  args: string[],
  options: CommandOptions
): Promise<number> {
  const context: QuarantineCommandContext = { options, args };

  switch (subcommand) {
    case 'add':
      return addCommand(context);
    case 'list':
      return listCommand(context);
    case 'resolve':
      return resolveCommand(context);
    case 'restore':
      return restoreCommand(context);
    case 'promote':
      return promoteCommand(context);
    default:
      console.error(`Unknown quarantine subcommand: ${subcommand}`);
      console.error('Available subcommands: add, list, resolve, restore, promote');
      return 127;
  }
}

// Re-export subcommands for direct usage
export { addCommand } from './add.js';
export { listCommand } from './list.js';
export { resolveCommand } from './resolve.js';
export { restoreCommand } from './restore.js';
export { promoteCommand } from './promote.js';
