/**
 * PostgreSQL Database Adapter
 *
 * Implements DatabaseAdapter interface using node-postgres (pg).
 * Provides async operations with connection pooling and transaction support.
 */

import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { DatabaseAdapter } from '../repository';
import { logger } from '../../core/utils/logger.js';

// R62-H1: Per-context transaction isolation. Instance-level transactionClient/transactionDepth
// caused cross-request contamination in concurrent environments (Cloudflare Workers).
// AsyncLocalStorage ensures each async context (request) gets its own transaction client.
interface TransactionContext {
  client: PoolClient;
  depth: number;
}

const txStorage = new AsyncLocalStorage<TransactionContext>();

export class PostgreSQLAdapter implements DatabaseAdapter {
  private pool: Pool;

  constructor(config: PoolConfig) {
    this.pool = new Pool({
      ...config,
      // Recommended production settings
      max: 20, // Maximum pool size
      idleTimeoutMillis: 30000, // Close idle clients after 30s
      connectionTimeoutMillis: 2000, // Fail fast on connection issues
    });

    // Error handler for pool-level errors
    this.pool.on('error', (err: Error) => {
      logger.error('Unexpected PostgreSQL pool error', {
        error: err.message,
        stack: err.stack,
      });
    });
  }

  // R62-H1: Queries route through the current transaction's client (via AsyncLocalStorage)
  // or fall back to the pool for non-transactional queries.
  private getClient(): PoolClient | Pool {
    return txStorage.getStore()?.client ?? this.pool;
  }

  async queryOne<T>(
    sql: string,
    params: ReadonlyArray<unknown> = []
  ): Promise<T | null> {
    const client = this.getClient();
    const result = await client.query(this.parameterize(sql), [...params]);
    return (result.rows[0] as T | undefined) ?? null;
  }

  async queryMany<T>(
    sql: string,
    params: ReadonlyArray<unknown> = []
  ): Promise<ReadonlyArray<T>> {
    const client = this.getClient();
    const result = await client.query(this.parameterize(sql), [...params]);
    return result.rows as T[];
  }

  async execute(
    sql: string,
    params: ReadonlyArray<unknown> = []
  ): Promise<number> {
    const client = this.getClient();
    const result = await client.query(this.parameterize(sql), [...params]);
    return result.rowCount ?? 0;
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const existing = txStorage.getStore();

    if (existing) {
      // Nested transaction — use savepoint on the existing client
      const savepoint = `sp_${existing.depth}`;
      existing.depth++;
      try {
        await existing.client.query(`SAVEPOINT ${savepoint}`);
        const result = await fn();
        await existing.client.query(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        await existing.client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        throw error;
      } finally {
        existing.depth--;
      }
    }

    // Top-level transaction — acquire a dedicated client for this async context
    const client = await this.pool.connect();
    const ctx: TransactionContext = { client, depth: 1 };

    try {
      await client.query('BEGIN');
      const result = await txStorage.run(ctx, fn);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Convert SQLite-style ? placeholders to PostgreSQL $1, $2, etc.
   *
   * R62-H2: The naive regex `/\?/g` replaced ALL `?` characters, including those
   * inside string literals ('What?'), comments, and PostgreSQL's JSONB `?` operator.
   * This parser skips quoted strings so only actual parameter placeholders are replaced.
   */
  private parameterize(sql: string): string {
    let paramIndex = 1;
    let result = '';
    let i = 0;
    while (i < sql.length) {
      const ch = sql[i];
      // Skip single-quoted string literals
      if (ch === "'") {
        let j = i + 1;
        while (j < sql.length) {
          if (sql[j] === "'" && sql[j + 1] === "'") {
            j += 2; // escaped quote
          } else if (sql[j] === "'") {
            j++;
            break;
          } else {
            j++;
          }
        }
        result += sql.slice(i, j);
        i = j;
      // Skip double-quoted identifiers
      } else if (ch === '"') {
        let j = i + 1;
        while (j < sql.length && sql[j] !== '"') j++;
        j++; // closing quote
        result += sql.slice(i, j);
        i = j;
      // Replace parameter placeholder
      } else if (ch === '?') {
        result += `$${paramIndex++}`;
        i++;
      } else {
        result += ch;
        i++;
      }
    }
    return result;
  }

  /**
   * Initialize database schema from SQL file.
   */
  async initializeSchema(schemaSQL: string): Promise<void> {
    // PostgreSQL uses same SQL as SQLite (by design)
    await this.pool.query(schemaSQL);
  }

  /**
   * Run VACUUM ANALYZE for optimization.
   */
  async optimize(): Promise<void> {
    // VACUUM cannot run inside transaction
    // R63-M2: Updated from stale `this.transactionClient` (removed in R62-H1)
    // to use AsyncLocalStorage context check.
    if (txStorage.getStore()) {
      throw new Error('Cannot vacuum inside transaction');
    }

    await this.pool.query('VACUUM ANALYZE');
  }

  /**
   * Get database statistics for monitoring.
   */
  async getStats(): Promise<{
    databaseSize: string;
    tableCount: number;
    indexCount: number;
    activeConnections: number;
  }> {
    const sizeResult = await this.pool.query<{ pg_database_size: string }>(
      "SELECT pg_size_pretty(pg_database_size(current_database())) AS pg_database_size"
    );

    const tableResult = await this.pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = 'public'"
    );

    const indexResult = await this.pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM pg_indexes WHERE schemaname = 'public'"
    );

    const connResult = await this.pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM pg_stat_activity WHERE datname = current_database()"
    );

    return {
      databaseSize: sizeResult.rows[0]?.pg_database_size ?? 'unknown',
      tableCount: parseInt(tableResult.rows[0]?.count ?? '0', 10),
      indexCount: parseInt(indexResult.rows[0]?.count ?? '0', 10),
      activeConnections: parseInt(connResult.rows[0]?.count ?? '0', 10),
    };
  }

  /**
   * Create database backup using pg_dump.
   * Requires pg_dump binary in PATH.
   */
  async backup(destinationPath: string): Promise<void> {
    // Reject path traversal AND arbitrary absolute paths.
    // R78-C2-P only blocked ".." but accepted "/etc/cron.d/backdoor".
    const { resolve, isAbsolute } = await import('path');
    if (destinationPath.includes('..')) {
      throw new Error('Backup destination path must not contain ".." traversal');
    }
    if (isAbsolute(destinationPath)) {
      throw new Error('Backup destination must be a relative path');
    }
    const resolved = resolve(destinationPath);
    // Validate resolved path stays under cwd to prevent symlink traversal.
    const cwd = process.cwd();
    if (!resolved.startsWith(cwd + '/') && resolved !== cwd) {
      throw new Error('Backup destination resolves outside working directory');
    }
    const { spawn } = await import('child_process');

    return new Promise((resolve, reject) => {
      const config = this.pool.options;

      const args = [
        '-h', config.host ?? 'localhost',
        '-p', String(config.port ?? 5432),
        '-U', config.user ?? 'postgres',
        '-d', config.database ?? 'postgres',
        '-f', resolved,
        '-F', 'c', // Custom format (compressed)
      ];

      const pgDumpProcess = spawn('pg_dump', args, {
        env: {
          ...process.env,
          PGPASSWORD: config.password,
        },
      });

      let stderr = '';

      pgDumpProcess.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      pgDumpProcess.on('close', (code: number | null) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`pg_dump failed with code ${code}: ${stderr}`));
        }
      });

      pgDumpProcess.on('error', (error: Error) => {
        reject(error);
      });
    });
  }

  /**
   * Check connection health.
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create PostgreSQL adapter with schema initialization.
 */
export async function createPostgreSQLAdapter(
  config: PoolConfig,
  schemaSQL: string
): Promise<PostgreSQLAdapter> {
  const adapter = new PostgreSQLAdapter(config);
  await adapter.initializeSchema(schemaSQL);
  return adapter;
}
