/**
 * Shadow Atlas CLI
 *
 * Unified command-line interface for Shadow Atlas registry management,
 * code generation, migrations, and diagnostics.
 *
 * @module cli
 */

// Re-export library utilities
export * from './lib/index.js';

// Re-export commands
export * from './commands/index.js';

// Command metadata for help generation
export const CLI_VERSION = '1.0.0';
export const CLI_NAME = 'shadow-atlas';

export const COMMAND_GROUPS = {
  codegen: {
    name: 'codegen',
    description: 'Code generation (NDJSON <-> TypeScript)',
    commands: ['generate', 'extract', 'verify', 'sync'],
  },
  migrate: {
    name: 'migrate',
    description: 'Data migrations and snapshots',
    commands: ['apply', 'rollback', 'status', 'snapshot'],
  },
  diagnose: {
    name: 'diagnose',
    description: 'Diagnostics and health checks',
    commands: ['containment', 'coverage', 'overlap', 'health'],
  },
  discover: {
    name: 'discover',
    description: 'Portal discovery and search',
    commands: ['search', 'import', 'validate', 'wave'],
  },
  ingest: {
    name: 'ingest',
    description: 'Data ingestion pipelines',
    commands: ['arcgis', 'tiger', 'webmap', 'geojson'],
  },
} as const;
