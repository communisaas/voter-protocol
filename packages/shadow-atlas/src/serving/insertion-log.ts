/**
 * Append-Only Insertion Log for Tree 1 Persistence
 *
 * Records every leaf insertion as a newline-delimited JSON (NDJSON) entry.
 * The log is the canonical source of truth — on restart, the tree is
 * deterministically rebuilt by replaying the log in order.
 *
 * Format (one JSON object per line, v2 with integrity fields):
 * {"leaf":"0xabc...","index":0,"ts":1707600000000,"prevHash":"0x...","sig":"0x..."}
 *
 * Integrity properties (Wave 39 — Verifiable Solo Operator):
 * - Hash-chained: each entry includes SHA-256 of the previous entry's JSON line.
 * First entry uses genesis hash SHA-256("genesis"). Tampering with any entry
 * breaks the chain for all subsequent entries.
 * - Signed: each entry includes an Ed25519 signature over its canonical JSON
 * (excluding the `sig` field itself). Anyone with the public key can verify.
 * - Attestation-bound: entries may include an `attestationHash` linking
 * the insertion to a real identity verification event.
 *
 * Backward compatibility:
 * - Entries without prevHash/sig are accepted during replay (v1 format)
 * - Hash chain verification starts from the first entry that has prevHash
 *
 * SPEC REFERENCE: IMPLEMENTATION-GAP-ANALYSIS.md
 */

import { promises as fs, createReadStream } from 'fs';
import { createInterface } from 'readline';
import { createHash } from 'crypto';
import { dirname } from 'path';
import { logger } from '../core/utils/logger.js';
import type { ServerSigner } from './signing.js';

// ============================================================================
// Constants
// ============================================================================

/** Genesis hash for the first entry in a hash chain */
const GENESIS_HASH = createHash('sha256').update('genesis').digest('hex');

// ============================================================================
// Types
// ============================================================================

/** A single insertion log entry (v2 with integrity fields) */
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
  /** SHA-256 hash of the previous entry's JSON line (hex). First entry uses genesis hash. */
  readonly prevHash?: string;
  /** Hash of the identity attestation that authorized this insertion (hex). */
  readonly attestationHash?: string;
  /** Ed25519 signature over the canonical JSON of this entry (excluding sig field). Hex-encoded. */
  readonly sig?: string;
}

/** Options for creating an InsertionLog */
export interface InsertionLogOptions {
  /** Path to the NDJSON log file */
  readonly path: string;
  /** Whether to fsync after each write (default: true) */
  readonly fsync?: boolean;
  /** Server signer for Ed25519 signatures (optional — entries are unsigned if not provided) */
  readonly signer?: ServerSigner;
}

/** Result of hash chain verification during replay */
export interface ChainVerificationResult {
  /** Total entries replayed */
  readonly totalEntries: number;
  /** Number of entries with valid hash chain links */
  readonly validChainLinks: number;
  /** Number of entries missing prevHash (v1 legacy entries) */
  readonly legacyEntries: number;
  /** Number of broken chain links (CRITICAL — possible tampering) */
  readonly brokenLinks: number;
  /** Number of entries with valid signatures */
  readonly validSignatures: number;
  /** Number of entries with invalid signatures (CRITICAL) */
  readonly invalidSignatures: number;
  /** Number of unsigned entries */
  readonly unsignedEntries: number;
  /** True if the only broken link is the very last entry (indicates crash recovery scenario) */
  readonly lastEntryBroken: boolean;
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
  private readonly signer: ServerSigner | null;
  private fd: fs.FileHandle | null = null;
  /** Write serialization queue */
  private writeChain: Promise<void> = Promise.resolve();
  private entryCount = 0;
  /** SHA-256 of the last written entry's JSON line (for hash chaining) */
  private lastEntryHash: string = GENESIS_HASH;

  private constructor(logPath: string, fsync: boolean, signer?: ServerSigner) {
    this.logPath = logPath;
    this.shouldFsync = fsync;
    this.signer = signer ?? null;
  }

  /**
   * Open or create an insertion log file.
   *
   * If the file exists, counts existing entries and computes the
   * hash of the last entry (for continuing the hash chain).
   * If the file does not exist, creates it (and parent directories).
   */
  static async open(options: InsertionLogOptions): Promise<InsertionLog> {
    const log = new InsertionLog(options.path, options.fsync ?? true, options.signer);

    // Ensure parent directory exists
    await fs.mkdir(dirname(options.path), { recursive: true });

    // Open for appending (creates if needed). 0o600 = owner read/write only (MED-001).
    log.fd = await fs.open(options.path, 'a+', 0o600);

    // Count existing entries and compute last entry hash
    const { count, lastHash } = await log.scanEntries();
    log.entryCount = count;
    log.lastEntryHash = lastHash;

    logger.info('InsertionLog opened', {
      path: options.path,
      existingEntries: log.entryCount,
      signed: log.signer != null,
      lastEntryHash: log.lastEntryHash.slice(0, 16) + '...',
    });

    return log;
  }

  /**
   * Append a leaf insertion entry to the log.
   *
   * Automatically adds:
   * - prevHash: SHA-256 of the previous entry's JSON line
   * - sig: Ed25519 signature (if signer is configured)
   *
   * Writes are serialized — concurrent calls are queued.
   * Each write is followed by an fsync for crash safety.
   */
  async append(entry: InsertionLogEntry): Promise<void> {
    // Build the canonical JSON object (deterministic key order)
    const obj: Record<string, unknown> = {
      leaf: entry.leaf,
      index: entry.index,
      ts: entry.ts,
    };
    if (entry.type) obj.type = entry.type;
    if (entry.oldIndex !== undefined) obj.oldIndex = entry.oldIndex;
    if (entry.attestationHash) obj.attestationHash = entry.attestationHash;

    // Serialize writes (prevHash depends on state from previous write)
    const writePromise = this.writeChain.then(async () => {
      if (!this.fd) {
        throw new Error('InsertionLog is closed');
      }

      // Hash chain: link to previous entry
      obj.prevHash = this.lastEntryHash;

      // Sign the canonical JSON (everything except `sig`)
      if (this.signer) {
        const signable = JSON.stringify(obj);
        obj.sig = this.signer.sign(signable);
      }

      const line = JSON.stringify(obj);
      const lineWithNewline = line + '\n';

      await this.fd.write(lineWithNewline);
      if (this.shouldFsync) {
        await this.fd.sync();
      }

      // Update chain state
      this.lastEntryHash = createHash('sha256').update(line).digest('hex');
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
   * Returns entries in insertion order (index 0, 1, 2,...).
   * Validates each line and skips malformed entries with a warning.
   *
   * Also verifies hash chain integrity and signatures if a signer is provided.
   */
  async replay(signer?: ServerSigner): Promise<{
    entries: InsertionLogEntry[];
    verification: ChainVerificationResult;
  }> {
    const entries: InsertionLogEntry[] = [];
    let prevHash = GENESIS_HASH;
    let validChainLinks = 0;
    let legacyEntries = 0;
    let brokenLinks = 0;
    let validSignatures = 0;
    let invalidSignatures = 0;
    let unsignedEntries = 0;
    let lastBrokenLineNumber = -1;

    const verifier = signer ?? this.signer;

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

        // Verify hash chain
        if (typeof parsed.prevHash === 'string') {
          if (parsed.prevHash === prevHash) {
            validChainLinks++;
          } else {
            brokenLinks++;
            lastBrokenLineNumber = lineNumber;
            logger.error('InsertionLog: HASH CHAIN BROKEN', {
              lineNumber,
              expected: prevHash.slice(0, 16) + '...',
              found: (parsed.prevHash as string).slice(0, 16) + '...',
            });
          }
        } else {
          legacyEntries++;
        }

        // Verify signature
        if (typeof parsed.sig === 'string' && verifier) {
          // W40-005: Reconstruct signable with EXPLICIT key ordering (matches append()).
          // Using object spread + JSON.stringify relies on engine-specific key enumeration.
          const signableObj: Record<string, unknown> = {
            leaf: parsed.leaf,
            index: parsed.index,
            ts: parsed.ts,
          };
          if (parsed.type) signableObj.type = parsed.type;
          if (parsed.oldIndex !== undefined) signableObj.oldIndex = parsed.oldIndex;
          if (parsed.attestationHash) signableObj.attestationHash = parsed.attestationHash;
          signableObj.prevHash = parsed.prevHash;
          const signable = JSON.stringify(signableObj);
          if (verifier.verify(signable, parsed.sig as string)) {
            validSignatures++;
          } else {
            invalidSignatures++;
            logger.error('InsertionLog: INVALID SIGNATURE', {
              lineNumber,
              index: parsed.index,
            });
          }
        } else {
          unsignedEntries++;
        }

        // Build entry
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
        if (typeof parsed.attestationHash === 'string') {
          (result as any).attestationHash = parsed.attestationHash;
        }
        if (typeof parsed.prevHash === 'string') {
          (result as any).prevHash = parsed.prevHash;
        }
        if (typeof parsed.sig === 'string') {
          (result as any).sig = parsed.sig;
        }
        entries.push(result);

        // Update chain state: hash of the raw JSON line (as written)
        prevHash = createHash('sha256').update(trimmed).digest('hex');
      } catch {
        logger.warn('InsertionLog: skipping malformed entry', {
          lineNumber,
          reason: 'invalid JSON',
        });
      }
    }

    // Determine if the only broken link is the last entry (crash recovery scenario)
    const lastEntryBroken = brokenLinks === 1 && lastBrokenLineNumber === lineNumber;

    const verification: ChainVerificationResult = {
      totalEntries: entries.length,
      validChainLinks,
      legacyEntries,
      brokenLinks,
      validSignatures,
      invalidSignatures,
      unsignedEntries,
      lastEntryBroken,
    };

    if (brokenLinks > 0) {
      logger.error('InsertionLog: CHAIN INTEGRITY COMPROMISED', {
        brokenLinks,
        totalEntries: entries.length,
      });
    }

    if (invalidSignatures > 0) {
      logger.error('InsertionLog: SIGNATURE INTEGRITY COMPROMISED', {
        invalidSignatures,
        totalEntries: entries.length,
      });
    }

    logger.info('InsertionLog replayed', {
      path: this.logPath,
      entries: entries.length,
      verification,
    });

    return { entries, verification };
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

  /** SHA-256 of the last entry's JSON line (for external consumers) */
  get chainHead(): string {
    return this.lastEntryHash;
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
   * Scan existing entries: count valid entries and compute the hash
   * of the last valid entry (for continuing the hash chain).
   * Uses streaming to avoid loading entire file into memory (MED-006/MED-007).
   */
  private async scanEntries(): Promise<{ count: number; lastHash: string }> {
    try {
      const stream = createReadStream(this.logPath, { encoding: 'utf8' });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      let count = 0;
      let lastHash = GENESIS_HASH;

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
            lastHash = createHash('sha256').update(trimmed).digest('hex');
          }
        } catch {
          // Skip malformed — consistent with replay()
        }
      }
      return { count, lastHash };
    } catch {
      return { count: 0, lastHash: GENESIS_HASH };
    }
  }
}
