/**
 * Database Adapter Factory (Legacy Event-Sourced System)
 *
 * Creates database adapter for the incremental orchestrator.
 * This is the LEGACY adapter system used by src/db/sqlite-adapter.ts
 *
 * NOTE: This is separate from the NEW persistence layer (src/persistence/).
 * The incremental orchestrator uses the simpler event-sourced DatabaseAdapter
 * interface defined in src/core/types.ts
 *
 * CRITICAL TYPE SAFETY: Factory ensures type-safe adapter initialization.
 * Wrong adapter configuration can corrupt the event-sourced provenance log.
 *
 * Environment variable format:
 * - DATABASE_URL=sqlite:///path/to/db.sqlite (or omit for default)
 *
 * Currently only SQLite is supported for the legacy system.
 * PostgreSQL support would require implementing the DatabaseAdapter interface
 * from src/core/types.ts for PostgreSQL.
 */

import { readFile } from 'fs/promises';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { DatabaseAdapter } from '../core/types.js';
import { SQLiteAdapter } from './sqlite-adapter.js';

/**
 * Get the directory path of the current module
 * Works in both ESM and when transpiled
 */
function getModuleDir(): string {
  // In ESM, import.meta.url is available at runtime
  const moduleUrl: string = import.meta.url;
  const modulePath = fileURLToPath(moduleUrl);
  return dirname(modulePath);
}

/**
 * Create database adapter from environment configuration
 *
 * Reads DATABASE_URL environment variable and creates appropriate adapter.
 * Falls back to SQLite at .shadow-atlas/shadow-atlas.db if not set.
 *
 * Currently only SQLite is supported for the legacy system.
 *
 * @param schemaDir - Optional directory containing schema.sql and views.sql (defaults to module directory)
 * @returns Initialized database adapter
 *
 * @example
 * ```typescript
 * // Use environment configuration (or default to SQLite)
 * const db = await createDatabaseAdapter();
 *
 * // Use the adapter
 * const munis = await db.listMunicipalities(100, 0);
 * ```
 */
export async function createDatabaseAdapter(
  schemaDir?: string
): Promise<DatabaseAdapter> {
  const databaseUrl = process.env.DATABASE_URL;

  // Parse database URL or use default
  let dbPath: string;

  if (!databaseUrl) {
    // Default to SQLite
    dbPath = '.shadow-atlas/shadow-atlas.db';
  } else {
    try {
      const url = new URL(databaseUrl);

      if (url.protocol !== 'sqlite:') {
        throw new Error(
          `Unsupported database protocol for legacy adapter: ${url.protocol}. ` +
          `Only 'sqlite:' is supported. Use src/persistence/ adapters for PostgreSQL.`
        );
      }

      // SQLite: sqlite:///absolute/path or sqlite://relative/path
      dbPath = url.pathname.startsWith('/')
        ? url.pathname.slice(1) // Remove leading slash for absolute paths
        : url.pathname;

      if (!dbPath) {
        dbPath = '.shadow-atlas/shadow-atlas.db';
      }
    } catch (error) {
      // If URL parsing fails, treat as file path
      dbPath = databaseUrl;
    }
  }

  // Create SQLite adapter
  const adapter = new SQLiteAdapter(dbPath);

  // Initialize schema and views
  // Use provided schemaDir or default to module directory
  const baseDir = schemaDir ?? getModuleDir();
  const schemaPath = join(baseDir, 'schema.sql');
  const viewsPath = join(baseDir, 'views.sql');

  const schemaSQL = await readFile(schemaPath, 'utf-8');
  const viewsSQL = await readFile(viewsPath, 'utf-8');

  await adapter.initialize(schemaSQL, viewsSQL);

  return adapter;
}

/**
 * Create SQLite adapter with explicit path
 *
 * Useful for testing or when DATABASE_URL is not available.
 *
 * @param dbPath - Path to SQLite database file
 * @param schemaDir - Optional directory containing schema.sql and views.sql
 * @returns Initialized SQLite adapter
 *
 * @example
 * ```typescript
 * // Test adapter
 * const db = await createSQLiteAdapter(':memory:');
 *
 * // Production adapter
 * const db = await createSQLiteAdapter('/data/shadow-atlas.db');
 * ```
 */
export async function createSQLiteAdapter(
  dbPath: string = '.shadow-atlas/shadow-atlas.db',
  schemaDir?: string
): Promise<SQLiteAdapter> {
  const adapter = new SQLiteAdapter(dbPath);

  // Initialize schema and views
  const baseDir = schemaDir ?? getModuleDir();
  const schemaPath = join(baseDir, 'schema.sql');
  const viewsPath = join(baseDir, 'views.sql');

  const schemaSQL = await readFile(schemaPath, 'utf-8');
  const viewsSQL = await readFile(viewsPath, 'utf-8');

  await adapter.initialize(schemaSQL, viewsSQL);

  return adapter;
}
