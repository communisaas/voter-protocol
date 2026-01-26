/**
 * Codegen Commands Index
 *
 * Registers all codegen subcommands for the shadow-atlas CLI.
 *
 * @module cli/commands/codegen
 */

export { runGenerate } from './generate.js';
export { runExtract } from './extract.js';
export { runVerify } from './verify.js';
export { runSync } from './sync.js';

/**
 * Codegen command metadata for help display
 */
export const codegenCommands = {
  generate: {
    name: 'generate',
    description: 'Transform NDJSON to TypeScript',
    usage: 'shadow-atlas codegen generate [options]',
    options: [
      '--registry <name>   Specific registry (known-portals|quarantined-portals|at-large-cities)',
      '--verify            Verify round-trip after generation',
      '--check-only        Check if regeneration needed (for CI), exit 1 if out of sync',
    ],
  },
  extract: {
    name: 'extract',
    description: 'Transform TypeScript to NDJSON',
    usage: 'shadow-atlas codegen extract [options]',
    options: [
      '--registry <name>   Specific registry (default: all)',
      '--output-dir <path> Custom output directory',
    ],
  },
  verify: {
    name: 'verify',
    description: 'Compare NDJSON and TypeScript for consistency',
    usage: 'shadow-atlas codegen verify [options]',
    options: [
      '--registry <name>   Specific registry (default: all)',
      '--strict            Fail on any difference',
    ],
  },
  sync: {
    name: 'sync',
    description: 'Full sync workflow: extract, generate, verify',
    usage: 'shadow-atlas codegen sync [options]',
    options: [
      '--registry <name>   Specific registry (default: all)',
    ],
  },
};
