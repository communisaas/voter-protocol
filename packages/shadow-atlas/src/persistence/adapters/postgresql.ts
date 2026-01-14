/**
 * PostgreSQL Database Adapter
 *
 * Implements DatabaseAdapter interface using node-postgres (pg).
 * Provides async operations with connection pooling and transaction support.
 */

import { Pool, type PoolClient, type PoolConfig } from 'pg';
import type { DatabaseAdapter } from '../repository';
import { logger } from '../../core/utils/logger.js';

export class PostgreSQLAdapter implements DatabaseAdapter {
  private pool: Pool;
  private transactionClient: PoolClient | null = null;
  private transactionDepth = 0;

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

  async queryOne<T>(
    sql: string,
    params: ReadonlyArray<unknown> = []
  ): Promise<T | null> {
    const client = this.transactionClient ?? this.pool;
    const result = await client.query(this.parameterize(sql), [...params]);
    return (result.rows[0] as T | undefined) ?? null;
  }

  async queryMany<T>(
    sql: string,
    params: ReadonlyArray<unknown> = []
  ): Promise<ReadonlyArray<T>> {
    const client = this.transactionClient ?? this.pool;
    const result = await client.query(this.parameterize(sql), [...params]);
    return result.rows as T[];
  }

  async execute(
    sql: string,
    params: ReadonlyArray<unknown> = []
  ): Promise<number> {
    const client = this.transactionClient ?? this.pool;
    const result = await client.query(this.parameterize(sql), [...params]);
    return result.rowCount ?? 0;
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // Support nested transactions via savepoints
    const savepoint = `sp_${this.transactionDepth}`;
    this.transactionDepth++;

    try {
      if (this.transactionDepth === 1) {
        // Acquire client for entire transaction
        this.transactionClient = await this.pool.connect();
        await this.transactionClient.query('BEGIN');
      } else {
        // Nested transaction - use savepoint
        if (!this.transactionClient) {
          throw new Error('No active transaction client');
        }
        await this.transactionClient.query(`SAVEPOINT ${savepoint}`);
      }

      const result = await fn();

      if (this.transactionDepth === 1) {
        if (!this.transactionClient) {
          throw new Error('No active transaction client');
        }
        await this.transactionClient.query('COMMIT');
        this.transactionClient.release();
        this.transactionClient = null;
      } else {
        if (!this.transactionClient) {
          throw new Error('No active transaction client');
        }
        await this.transactionClient.query(`RELEASE SAVEPOINT ${savepoint}`);
      }

      this.transactionDepth--;
      return result;
    } catch (error) {
      if (this.transactionDepth === 1) {
        if (this.transactionClient) {
          await this.transactionClient.query('ROLLBACK');
          this.transactionClient.release();
          this.transactionClient = null;
        }
      } else {
        if (this.transactionClient) {
          await this.transactionClient.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        }
      }

      this.transactionDepth--;
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Convert SQLite-style ? placeholders to PostgreSQL $1, $2, etc.
   */
  private parameterize(sql: string): string {
    let paramIndex = 1;
    return sql.replace(/\?/g, () => `$${paramIndex++}`);
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
    if (this.transactionClient) {
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
    const { spawn } = await import('child_process');

    return new Promise((resolve, reject) => {
      const config = this.pool.options;

      const args = [
        '-h', config.host ?? 'localhost',
        '-p', String(config.port ?? 5432),
        '-U', config.user ?? 'postgres',
        '-d', config.database ?? 'postgres',
        '-f', destinationPath,
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
