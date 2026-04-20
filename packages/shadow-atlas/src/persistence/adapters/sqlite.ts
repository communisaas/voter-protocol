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
    this.db.pragma('busy_timeout = 5000');
    // R72-M3: Match R62-M1 from legacy adapter — FULL sync prevents silent
    // transaction loss on crash with WAL mode (critical for Merkle root integrity)
    this.db.pragma('synchronous = FULL');

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
      // Use stat() on WAL file instead of wal_checkpoint(PASSIVE)
      // which triggers an actual checkpoint (write op masquerading as monitoring read).
      const { statSync } = await import('fs');
      const dbPath = this.db.name;
      const walStats = statSync(`${dbPath}-wal`);
      walSizeBytes = walStats.size;
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
    // Reject path traversal AND arbitrary absolute paths.
    // R78-C2-P's relative() logic was dead code — it never caught absolute paths.
    const { resolve, isAbsolute } = await import('path');
    if (destinationPath.includes('..')) {
      throw new Error('Backup destination path must not contain ".." traversal');
    }
    if (isAbsolute(destinationPath)) {
      throw new Error('Backup destination must be a relative path');
    }
    // Validate resolved path stays under cwd to prevent symlink traversal.
    const resolvedDest = resolve(destinationPath);
    const cwd = process.cwd();
    if (!resolvedDest.startsWith(cwd + '/') && resolvedDest !== cwd) {
      throw new Error('Backup destination resolves outside working directory');
    }
    await this.db.backup(resolvedDest);
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
