/**
 * CLI Commands Index
 *
 * Central registry of all CLI command groups.
 *
 * @module cli/commands
 */

// Codegen commands
export {
  runGenerate,
  runExtract,
  runVerify,
  runSync,
  codegenCommands,
} from './codegen/index.js';

// Migration commands
export {
  runApply,
  runRollback,
  runStatus,
  runSnapshot,
  migrateCommands,
} from './migrate/index.js';

// Diagnostic commands
export {
  runContainment,
  runCoverage,
  runOverlap,
  runHealth,
  diagnoseCommands,
} from './diagnose/index.js';

// Discovery commands
export { registerDiscoverCommands } from './discover/index.js';

// Ingestion commands
export { registerIngestCommands } from './ingest/index.js';
