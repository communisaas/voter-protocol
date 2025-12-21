/**
 * SQLite Database Adapter
 *
 * Implements DatabaseAdapter interface using better-sqlite3.
 * Provides synchronous operations with transaction support.
 */

import Database from 'better-sqlite3';
import type { DatabaseAdapter } from '../repository';

export class SQLiteAdapter implements DatabaseAdapter {
  private db: Database.Database;
  private transactionDepth = 0;

  constructor(filepath: string) {
    this.db = new Database(filepath);

    // Enable foreign keys (required for referential integrity)
    this.db.pragma('foreign_keys = ON');

    // WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');

    // Reasonable cache size (10MB)
    this.db.pragma('cache_size = -10000');
  }

  async queryOne<T>(
    sql: string,
    params: ReadonlyArray<unknown> = []
  ): Promise<T | null> {
    const stmt = this.db.prepare(sql);
    const row = stmt.get(...params) as T | undefined;
    return row ?? null;
  }

  async queryMany<T>(
    sql: string,
    params: ReadonlyArray<unknown> = []
  ): Promise<ReadonlyArray<T>> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  async execute(
    sql: string,
    params: ReadonlyArray<unknown> = []
  ): Promise<number> {
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...params);
    return result.changes;
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // Support nested transactions via savepoints
    const savepoint = `sp_${this.transactionDepth}`;
    this.transactionDepth++;

    try {
      if (this.transactionDepth === 1) {
        this.db.exec('BEGIN');
      } else {
        this.db.exec(`SAVEPOINT ${savepoint}`);
      }

      const result = await fn();

      if (this.transactionDepth === 1) {
        this.db.exec('COMMIT');
      } else {
        this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      }

      this.transactionDepth--;
      return result;
    } catch (error) {
      if (this.transactionDepth === 1) {
        this.db.exec('ROLLBACK');
      } else {
        this.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      }

      this.transactionDepth--;
      throw error;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }

  /**
   * Initialize database schema from SQL file.
   */
  async initializeSchema(schemaSQL: string): Promise<void> {
    this.db.exec(schemaSQL);
  }

  /**
   * Optimize database (run periodically).
   */
  async optimize(): Promise<void> {
    this.db.pragma('optimize');
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }

  /**
   * Get database statistics for monitoring.
   */
  async getStats(): Promise<{
    pageCount: number;
    pageSize: number;
    freelistCount: number;
    walSizeBytes: number;
  }> {
    const pageCount = this.db.pragma('page_count', { simple: true }) as number;
    const pageSize = this.db.pragma('page_size', { simple: true }) as number;
    const freelistCount = this.db.pragma('freelist_count', { simple: true }) as number;

    // WAL file size (if exists)
    let walSizeBytes = 0;
    try {
      const walPages = this.db.pragma('wal_checkpoint(PASSIVE)', { simple: true }) as number;
      walSizeBytes = walPages * pageSize;
    } catch {
      // WAL file might not exist
    }

    return {
      pageCount,
      pageSize,
      freelistCount,
      walSizeBytes,
    };
  }

  /**
   * Backup database to file.
   */
  async backup(destinationPath: string): Promise<void> {
    await this.db.backup(destinationPath);
  }
}

/**
 * Create SQLite adapter with schema initialization.
 */
export async function createSQLiteAdapter(
  filepath: string,
  schemaSQL: string
): Promise<SQLiteAdapter> {
  const adapter = new SQLiteAdapter(filepath);
  await adapter.initializeSchema(schemaSQL);
  return adapter;
}
