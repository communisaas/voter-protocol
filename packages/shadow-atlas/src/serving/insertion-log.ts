/**
 * Append-Only Insertion Log for Tree 1 Persistence (BR5-007)
 *
 * Records every leaf insertion as a newline-delimited JSON (NDJSON) entry.
 * The log is the canonical source of truth — on restart, the tree is
 * deterministically rebuilt by replaying the log in order.
 *
 * Format (one JSON object per line):
 *   {"leaf":"0xabc...","index":0,"ts":1707600000000}
 *
 * Properties:
 * - Append-only: entries are never modified or deleted
 * - Deterministic replay: inserting the same leaves in order produces
 *   the same tree root (Poseidon2 is deterministic)
 * - Crash-safe: fsync after each write ensures durability
 * - Exportable: the log file can be uploaded to IPFS for backup
 *
 * SPEC REFERENCE: IMPLEMENTATION-GAP-ANALYSIS.md BR5-007
 */

import { promises as fs, createReadStream } from 'fs';
import { createInterface } from 'readline';
import { dirname } from 'path';
import { logger } from '../core/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/** A single insertion log entry */
export interface InsertionLogEntry {
  /** Hex-encoded leaf hash (with 0x prefix) */
  readonly leaf: string;
  /** Sequential index in Tree 1 */
  readonly index: number;
  /** Unix timestamp (ms) of insertion */
  readonly ts: number;
  /** Entry type: 'insert' or 'replace'. Undefined treated as 'insert' during replay (backward compat). */
  readonly type?: 'insert' | 'replace';
  /** For replace entries: the old leaf index that was zeroed */
  readonly oldIndex?: number;
}

/** Options for creating an InsertionLog */
export interface InsertionLogOptions {
  /** Path to the NDJSON log file */
  readonly path: string;
  /** Whether to fsync after each write (default: true) */
  readonly fsync?: boolean;
}

// ============================================================================
// InsertionLog
// ============================================================================

/**
 * Append-only insertion log backed by a local NDJSON file.
 *
 * Thread safety: All writes are serialized via an internal queue.
 * Reads (replay) should not be called concurrently with writes.
 */
export class InsertionLog {
  private readonly logPath: string;
  private readonly shouldFsync: boolean;
  private fd: fs.FileHandle | null = null;
  /** Write serialization queue */
  private writeChain: Promise<void> = Promise.resolve();
  private entryCount = 0;

  private constructor(logPath: string, fsync: boolean) {
    this.logPath = logPath;
    this.shouldFsync = fsync;
  }

  /**
   * Open or create an insertion log file.
   *
   * If the file exists, counts existing entries.
   * If the file does not exist, creates it (and parent directories).
   */
  static async open(options: InsertionLogOptions): Promise<InsertionLog> {
    const log = new InsertionLog(options.path, options.fsync ?? true);

    // Ensure parent directory exists
    await fs.mkdir(dirname(options.path), { recursive: true });

    // Open for appending (creates if needed). 0o600 = owner read/write only (MED-001).
    log.fd = await fs.open(options.path, 'a+', 0o600);

    // Count existing entries
    log.entryCount = await log.countEntries();

    logger.info('InsertionLog opened', {
      path: options.path,
      existingEntries: log.entryCount,
    });

    return log;
  }

  /**
   * Append a leaf insertion entry to the log.
   *
   * Writes are serialized — concurrent calls are queued.
   * Each write is followed by an fsync for crash safety.
   */
  async append(entry: InsertionLogEntry): Promise<void> {
    const obj: Record<string, unknown> = {
      leaf: entry.leaf,
      index: entry.index,
      ts: entry.ts,
    };
    if (entry.type) obj.type = entry.type;
    if (entry.oldIndex !== undefined) obj.oldIndex = entry.oldIndex;
    const line = JSON.stringify(obj) + '\n';

    // Serialize writes
    const writePromise = this.writeChain.then(async () => {
      if (!this.fd) {
        throw new Error('InsertionLog is closed');
      }
      await this.fd.write(line);
      if (this.shouldFsync) {
        await this.fd.sync();
      }
      this.entryCount++;
    });

    this.writeChain = writePromise.catch(() => {
      // Prevent unhandled rejection from breaking the chain
    });

    return writePromise;
  }

  /**
   * Replay all entries in order via a streaming line reader.
   *
   * Returns entries in insertion order (index 0, 1, 2, ...).
   * Validates each line and skips malformed entries with a warning.
   */
  async replay(): Promise<InsertionLogEntry[]> {
    const entries: InsertionLogEntry[] = [];

    // Ensure writes are flushed before reading
    await this.writeChain;

    const stream = createReadStream(this.logPath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    let lineNumber = 0;
    for await (const line of rl) {
      lineNumber++;
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;

        if (
          typeof parsed.leaf !== 'string' ||
          typeof parsed.index !== 'number' ||
          typeof parsed.ts !== 'number'
        ) {
          logger.warn('InsertionLog: skipping malformed entry', {
            lineNumber,
            reason: 'missing required fields',
          });
          continue;
        }

        const result: InsertionLogEntry = {
          leaf: parsed.leaf as string,
          index: parsed.index as number,
          ts: parsed.ts as number,
        };
        if (parsed.type === 'insert' || parsed.type === 'replace') {
          (result as any).type = parsed.type;
        }
        if (typeof parsed.oldIndex === 'number') {
          (result as any).oldIndex = parsed.oldIndex;
        }
        entries.push(result);
      } catch {
        logger.warn('InsertionLog: skipping malformed entry', {
          lineNumber,
          reason: 'invalid JSON',
        });
      }
    }

    logger.info('InsertionLog replayed', {
      path: this.logPath,
      entries: entries.length,
    });

    return entries;
  }

  /**
   * Export the entire log as a single Buffer (for IPFS upload).
   */
  async export(): Promise<Buffer> {
    await this.writeChain;
    return fs.readFile(this.logPath);
  }

  /** Number of entries in the log */
  get count(): number {
    return this.entryCount;
  }

  /** Path to the log file */
  get path(): string {
    return this.logPath;
  }

  /**
   * Close the log file handle.
   */
  async close(): Promise<void> {
    await this.writeChain;
    if (this.fd) {
      await this.fd.close();
      this.fd = null;
    }
    logger.info('InsertionLog closed', { path: this.logPath });
  }

  // ============================================================================
  // Internal
  // ============================================================================

  /**
   * Count existing VALID entries (matches replay logic).
   * Uses streaming to avoid loading entire file into memory (MED-006/MED-007).
   */
  private async countEntries(): Promise<number> {
    try {
      const stream = createReadStream(this.logPath, { encoding: 'utf8' });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      let count = 0;
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          if (
            typeof parsed.leaf === 'string' &&
            typeof parsed.index === 'number' &&
            typeof parsed.ts === 'number'
          ) {
            count++;
          }
        } catch {
          // Skip malformed — consistent with replay()
        }
      }
      return count;
    } catch {
      return 0;
    }
  }
}
