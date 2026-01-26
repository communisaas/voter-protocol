/**
 * Audit Commands Index
 *
 * Registers all audit-related subcommands:
 * - log: View audit log entries
 * - export: Export audit log to file
 * - verify: Verify audit log integrity
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { Command } from 'commander';
import { registerLogCommand } from './log.js';
import { registerExportCommand } from './export.js';
import { registerVerifyCommand } from './verify.js';

/**
 * Register all audit subcommands
 *
 * @param program - Commander program instance
 */
export function registerAuditCommands(program: Command): void {
  const audit = program
    .command('audit')
    .description('Audit log operations for tracking registry changes');

  registerLogCommand(audit);
  registerExportCommand(audit);
  registerVerifyCommand(audit);
}
