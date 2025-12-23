/**
 * Database Adapter Factory
 *
 * Creates the appropriate database adapter based on configuration.
 * Supports SQLite (default) and PostgreSQL via DATABASE_URL environment variable.
 *
 * CRITICAL TYPE SAFETY: Factory ensures type-safe adapter initialization
 * with proper error handling. Wrong adapter configuration can corrupt
 * the entire persistence layer.
 *
 * Environment variable format:
 * - SQLite: DATABASE_URL=sqlite:///path/to/db.sqlite
 * - PostgreSQL: DATABASE_URL=postgresql://user:pass@host:port/dbname
 *
 * If DATABASE_URL is not set, defaults to SQLite at .shadow-atlas/shadow-atlas.db
 */

import { readFile } from 'fs/promises';
import { resolve } from 'path';
import type { DatabaseAdapter } from '../repository.js';
import { SQLiteAdapter } from './sqlite.js';
import { PostgreSQLAdapter } from './postgresql.js';

/**
 * Database adapter configuration
 */
export interface AdapterConfig {
  readonly type: 'sqlite' | 'postgresql';
  readonly url: string;
  readonly schemaPath?: string;
}

/**
 * Parse DATABASE_URL environment variable
 *
 * @param databaseUrl - Database connection URL
 * @returns Adapter configuration
 */
export function parseDatabaseUrl(databaseUrl: string): AdapterConfig {
  const url = new URL(databaseUrl);

  if (url.protocol === 'sqlite:') {
    // SQLite: sqlite:///absolute/path or sqlite://relative/path
    const filepath = url.pathname.startsWith('/')
      ? url.pathname.slice(1) // Remove leading slash for absolute paths
      : url.pathname;

    return {
      type: 'sqlite',
      url: filepath || '.shadow-atlas/shadow-atlas.db',
    };
  }

  if (url.protocol === 'postgresql:' || url.protocol === 'postgres:') {
    return {
      type: 'postgresql',
      url: databaseUrl,
    };
  }

  throw new Error(
    `Unsupported database protocol: ${url.protocol}. ` +
    `Supported protocols: sqlite:, postgresql:`
  );
}

/**
 * Create database adapter from environment configuration
 *
 * Reads DATABASE_URL environment variable and creates appropriate adapter.
 * Falls back to SQLite at .shadow-atlas/shadow-atlas.db if not set.
 *
 * @param schemaPath - Optional path to schema SQL file (defaults to ../schema.sql)
 * @returns Initialized database adapter
 *
 * @example
 * ```typescript
 * // Use environment configuration
 * const adapter = await createDatabaseAdapter();
 *
 * // Custom schema path
 * const adapter = await createDatabaseAdapter('/custom/schema.sql');
 * ```
 */
export async function createDatabaseAdapter(
  schemaPath?: string
): Promise<DatabaseAdapter> {
  // Read DATABASE_URL from environment
  const databaseUrl = process.env.DATABASE_URL;

  // Default to SQLite if not configured
  const config: AdapterConfig = databaseUrl
    ? parseDatabaseUrl(databaseUrl)
    : {
        type: 'sqlite',
        url: '.shadow-atlas/shadow-atlas.db',
      };

  // Read schema SQL
  const resolvedSchemaPath = schemaPath ?? resolve(__dirname, '../schema.sql');
  const schemaSQL = await readFile(resolvedSchemaPath, 'utf-8');

  // Create appropriate adapter
  if (config.type === 'sqlite') {
    const adapter = new SQLiteAdapter(config.url);
    await adapter.initializeSchema(schemaSQL);
    return adapter;
  }

  if (config.type === 'postgresql') {
    // Parse PostgreSQL connection URL
    const url = new URL(config.url);
    const poolConfig = {
      host: url.hostname,
      port: url.port ? parseInt(url.port, 10) : 5432,
      user: url.username,
      password: url.password,
      database: url.pathname.slice(1), // Remove leading slash
      ssl: url.searchParams.get('ssl') === 'true' ? { rejectUnauthorized: false } : undefined,
    };

    const adapter = new PostgreSQLAdapter(poolConfig);
    await adapter.initializeSchema(schemaSQL);
    return adapter;
  }

  throw new Error(`Unsupported adapter type: ${config.type}`);
}

/**
 * Create database adapter with explicit configuration
 *
 * Useful for testing or when DATABASE_URL is not available.
 *
 * @param config - Adapter configuration
 * @param schemaPath - Optional path to schema SQL file
 * @returns Initialized database adapter
 *
 * @example
 * ```typescript
 * // SQLite adapter
 * const adapter = await createAdapterFromConfig({
 *   type: 'sqlite',
 *   url: 'test.db',
 * });
 *
 * // PostgreSQL adapter
 * const adapter = await createAdapterFromConfig({
 *   type: 'postgresql',
 *   url: 'postgresql://localhost/test',
 * });
 * ```
 */
export async function createAdapterFromConfig(
  config: AdapterConfig,
  schemaPath?: string
): Promise<DatabaseAdapter> {
  const resolvedSchemaPath = schemaPath ?? resolve(__dirname, '../schema.sql');
  const schemaSQL = await readFile(resolvedSchemaPath, 'utf-8');

  if (config.type === 'sqlite') {
    const adapter = new SQLiteAdapter(config.url);
    await adapter.initializeSchema(schemaSQL);
    return adapter;
  }

  if (config.type === 'postgresql') {
    const url = new URL(config.url);
    const poolConfig = {
      host: url.hostname,
      port: url.port ? parseInt(url.port, 10) : 5432,
      user: url.username,
      password: url.password,
      database: url.pathname.slice(1),
      ssl: url.searchParams.get('ssl') === 'true' ? { rejectUnauthorized: false } : undefined,
    };

    const adapter = new PostgreSQLAdapter(poolConfig);
    await adapter.initializeSchema(schemaSQL);
    return adapter;
  }

  throw new Error(`Unsupported adapter type: ${config.type}`);
}

/**
 * Create SQLite adapter with default configuration
 *
 * Convenience function for SQLite-only applications.
 *
 * @param filepath - Path to SQLite database file
 * @param schemaPath - Optional path to schema SQL file
 * @returns Initialized SQLite adapter
 */
export async function createDefaultSQLiteAdapter(
  filepath: string = '.shadow-atlas/shadow-atlas.db',
  schemaPath?: string
): Promise<SQLiteAdapter> {
  const adapter = await createAdapterFromConfig(
    { type: 'sqlite', url: filepath },
    schemaPath
  );

  // Type assertion safe because we know we created a SQLite adapter
  return adapter as SQLiteAdapter;
}
