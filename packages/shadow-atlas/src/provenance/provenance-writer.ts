/**
 * Unified Provenance Writer - Complete Audit Trail System
 *
 * Consolidates provenance-writer.ts and provenance-staging-writer.ts
 * into a single, comprehensive provenance logging system with:
 *
 * 1. Staging buffer for batch writes (zero contention)
 * 2. Log compression (gzip)
 * 3. Query interface with filters
 * 4. FIPS-based sharding (50-state parallelism)
 * 5. Full audit trail with authority and freshness metadata
 *
 * CRITICAL TYPE SAFETY: Provenance entries are our audit trail.
 * Type errors break our ability to understand agent decisions and
 * validate boundary data integrity.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { logger } from '../core/utils/logger.js';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * Provenance Record - Full Data Source Attribution
 *
 * This is the complete provenance record attached to boundary metadata.
 * Includes source, authority, freshness, and verification information.
 */
export interface ProvenanceRecord {
  /** Source type (e.g., "census-tiger", "arcgis", "municipal-gis") */
  readonly source: string;

  /** Direct URL to source data */
  readonly sourceUrl: string;

  /** When data was retrieved (ISO timestamp) */
  readonly retrievedAt: Date;

  /** Data version or publication date */
  readonly dataVersion: string;

  /** License (SPDX identifier or description) */
  readonly license: string;

  /** Processing steps applied */
  readonly processingSteps: readonly string[];

  /** Authority source information (if available) */
  readonly authority?: {
    readonly entity: string;
    readonly legalBasis: string;
    readonly isPrimary: boolean;
  };

  /** Freshness metadata (if available) */
  readonly freshness?: {
    readonly lastModified: number; // Unix milliseconds
    readonly etag: string | null;
    readonly isValid: boolean;
  };

  /** Conflict resolution metadata (if applicable) */
  readonly resolution?: {
    readonly hadConflict: boolean;
    readonly alternativesConsidered: number;
    readonly confidence: number;
    readonly reason: string;
  };
}

/**
 * Compact Discovery Entry - Compressed Format for Logs
 *
 * This is the compact format used in NDJSON logs for storage efficiency.
 * ~150-250 bytes per entry.
 */
export interface CompactDiscoveryEntry {
  // Identity
  /** FIPS code (7 chars) */
  readonly f: string;
  /** City name (optional, for human readability) */
  readonly n?: string;
  /** State code (optional, 2 chars) */
  readonly s?: string;
  /** Population (optional) */
  readonly p?: number;

  // Granularity assessment
  /** Granularity tier (0-4) */
  readonly g: number;
  /** Feature count */
  readonly fc?: number | null;
  /** Confidence (0-100) */
  readonly conf: number;
  /** Authority level (0-5) */
  readonly auth: number;

  // Data source
  /** Source type (e.g., "arcgis", "socrata", "muni-gis") */
  readonly src?: string;
  /** Download URL */
  readonly url?: string | null;

  // Quality metrics (optional)
  readonly q?: {
    /** GeoJSON valid */
    readonly v: boolean;
    /** Topology: 0=gaps, 1=clean, 2=overlaps */
    readonly t: number;
    /** Response time (ms) */
    readonly r: number;
    /** Data vintage (YYYY-MM-DD) */
    readonly d: string | null;
  };

  // Reasoning chain (ESSENTIAL for audit)
  /** Why this tier was chosen */
  readonly why: readonly string[];
  /** Tiers attempted (e.g., [0, 1, 2]) */
  readonly tried: readonly number[];
  /** Blocker code preventing higher tier (or null) */
  readonly blocked: string | null;

  // Metadata
  /** ISO timestamp */
  readonly ts: string;
  /** Agent ID (8 chars) */
  readonly aid: string;
  /** Supersedes attempt ID (retry chain) */
  readonly sup?: string | null;
}

/**
 * Query filter for provenance entries
 */
export interface ProvenanceFilter {
  /** Filter by granularity tier */
  readonly tier?: number;
  /** Filter by state code */
  readonly state?: string;
  /** Filter by blocker code */
  readonly blockerCode?: string;
  /** Minimum confidence threshold (0-100) */
  readonly minConfidence?: number;
  /** Start date (ISO string) */
  readonly startDate?: string;
  /** End date (ISO string) */
  readonly endDate?: string;
  /** FIPS code */
  readonly fips?: string;
  /** Authority level */
  readonly authorityLevel?: number;
}

/**
 * File lock implementation using filesystem-based locking
 *
 * CRITICAL: Prevents concurrent write corruption from multiple agents
 */
class FileLock {
  private lockPath: string;
  private lockHandle: fs.FileHandle | null = null;
  private maxRetries: number = 50;
  private retryDelayMs: number = 100;

  constructor(filePath: string) {
    this.lockPath = `${filePath}.lock`;
  }

  /**
   * Acquire exclusive lock
   *
   * RETRY STRATEGY: 50 attempts × 100ms = 5 second timeout
   */
  async acquire(): Promise<void> {
    // Clean up any leaked handles before acquiring new lock
    if (this.lockHandle) {
      try {
        await this.lockHandle.close();
      } catch {
        // Ignore errors on cleanup
      }
      this.lockHandle = null;
    }

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        // O_CREAT | O_EXCL ensures atomic lock acquisition
        this.lockHandle = await fs.open(this.lockPath, 'wx');
        return;
      } catch (error) {
        if (attempt === this.maxRetries - 1) {
          throw new Error(`Failed to acquire lock after ${this.maxRetries} attempts`);
        }
        // Exponential backoff with jitter
        const delay = this.retryDelayMs * (1 + Math.random());
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Release lock
   *
   * CRITICAL: Close handle FIRST (guaranteed cleanup even if unlink fails)
   */
  async release(): Promise<void> {
    // CRITICAL: Close handle FIRST
    if (this.lockHandle) {
      try {
        await this.lockHandle.close();
      } catch (error) {
        logger.warn('Failed to close lock handle', {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.lockHandle = null;
      }
    }

    // THEN delete lock file
    try {
      await fs.unlink(this.lockPath);
    } catch {
      // Safe to ignore - lock is already released
    }
  }
}

/**
 * Unified Provenance Writer
 *
 * Combines staging writer (zero contention) with compressed storage
 * and query interface.
 */
export class ProvenanceWriter {
  private baseDir: string;
  private stagingDir: string;

  constructor(baseDir: string = './discovery-attempts') {
    this.baseDir = baseDir;
    this.stagingDir = path.join(path.dirname(baseDir), 'discovery-staging');
  }

  /**
   * Append provenance entry to log
   *
   * MODES:
   * - Standard mode: FIPS sharding with file locks
   * - Staging mode: Zero lock contention (requires merge worker)
   *
   * @param entry - Provenance entry to append
   * @param options - Optional configuration
   */
  async append(
    entry: CompactDiscoveryEntry,
    options?: { staging?: boolean; agentId?: string }
  ): Promise<void> {
    // Validate entry structure
    this.validateEntry(entry);

    // STAGING MODE: Zero lock contention
    if (options?.staging) {
      const agentId = options.agentId || entry.aid;
      await this.appendToStaging(entry, agentId);
      return;
    }

    // STANDARD MODE: FIPS sharding with file locks
    await this.appendToCompressed(entry);
  }

  /**
   * Append to staging area (zero contention)
   *
   * Each write creates a unique file (agentId + timestamp).
   * Background worker merges staging files periodically.
   */
  private async appendToStaging(
    entry: CompactDiscoveryEntry,
    agentId: string
  ): Promise<void> {
    // Create staging directory
    await fs.mkdir(this.stagingDir, { recursive: true });

    // Unique staging file per agent + timestamp
    const timestamp = Date.now();
    const stagingFile = path.join(this.stagingDir, `${agentId}-${timestamp}.ndjson`);

    // Append entry (no lock needed - file is unique)
    const line = JSON.stringify(entry) + '\n';
    await fs.appendFile(stagingFile, line, 'utf-8');
  }

  /**
   * Append to compressed log with FIPS sharding
   *
   * Uses file locks to prevent corruption from concurrent agents.
   */
  private async appendToCompressed(entry: CompactDiscoveryEntry): Promise<void> {
    const logPath = this.getShardedLogPath(entry.f);

    // Ensure directory exists
    await this.ensureMonthlyDirectory(logPath);

    const lock = new FileLock(logPath);

    try {
      // Acquire exclusive lock
      await lock.acquire();

      // Read existing compressed data (if file exists)
      let existingData = '';
      try {
        const compressed = await fs.readFile(logPath);
        const decompressed = await gunzip(compressed);
        existingData = decompressed.toString('utf-8');
      } catch {
        // File doesn't exist yet
        existingData = '';
      }

      // Append new entry as NDJSON line
      const newLine = JSON.stringify(entry) + '\n';
      const updatedData = existingData + newLine;

      // Compress and write back
      const compressed = await gzip(Buffer.from(updatedData, 'utf-8'));
      await fs.writeFile(logPath, compressed);
    } finally {
      // Always release lock
      await lock.release();
    }
  }

  /**
   * Query provenance entries with filters
   *
   * Scans both compressed logs and staging area.
   *
   * @param filter - Query filters
   * @returns Filtered provenance entries
   */
  async query(filter: ProvenanceFilter = {}): Promise<CompactDiscoveryEntry[]> {
    const results: CompactDiscoveryEntry[] = [];

    // 1. Scan compressed shards
    const monthsToScan = await this.getMonthlyLogsToScan(filter.startDate, filter.endDate);

    for (const logPath of monthsToScan) {
      try {
        const compressed = await fs.readFile(logPath);
        const decompressed = await gunzip(compressed);
        const lines = decompressed.toString('utf-8').split('\n').filter((line) => line.trim());

        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as CompactDiscoveryEntry;

            if (this.matchesFilter(entry, filter)) {
              results.push(entry);
            }
          } catch {
            // Skip malformed entries
          }
        }
      } catch {
        // Log file doesn't exist or is corrupted
      }
    }

    // 2. Also scan staging area
    const stagingEntries = await this.readStagingEntries();
    for (const entry of stagingEntries) {
      if (this.matchesFilter(entry, filter)) {
        results.push(entry);
      }
    }

    return results;
  }

  /**
   * Merge staging files into compressed logs
   *
   * Background worker calls this periodically.
   */
  async mergeStagingFiles(): Promise<{ merged: number; errors: number }> {
    const stagingFiles = await this.getStagingFiles();
    let merged = 0;
    let errors = 0;

    for (const file of stagingFiles) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const lines = content.split('\n').filter((line) => line.trim());

        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as CompactDiscoveryEntry;
            await this.appendToCompressed(entry);
            merged++;
          } catch (error) {
            logger.warn('Failed to merge entry from staging file', {
              file,
              error: error instanceof Error ? error.message : String(error),
            });
            errors++;
          }
        }

        // Delete staging file after successful merge
        await fs.unlink(file);
      } catch (error) {
        logger.error('Failed to merge staging file', {
          file,
          error: error instanceof Error ? error.message : String(error),
        });
        errors++;
      }
    }

    return { merged, errors };
  }

  /**
   * Get statistics from provenance log
   */
  async getStats(): Promise<{
    totalEntries: number;
    byTier: Record<number, number>;
    byAuthority: Record<number, number>;
    byBlocker: Record<string, number>;
    avgConfidence: number;
  }> {
    const allEntries = await this.query({});

    const stats = {
      totalEntries: allEntries.length,
      byTier: {} as Record<number, number>,
      byAuthority: {} as Record<number, number>,
      byBlocker: {} as Record<string, number>,
      avgConfidence: 0,
    };

    let totalConfidence = 0;

    for (const entry of allEntries) {
      stats.byTier[entry.g] = (stats.byTier[entry.g] || 0) + 1;
      stats.byAuthority[entry.auth] = (stats.byAuthority[entry.auth] || 0) + 1;
      if (entry.blocked) {
        stats.byBlocker[entry.blocked] = (stats.byBlocker[entry.blocked] || 0) + 1;
      }
      totalConfidence += entry.conf;
    }

    stats.avgConfidence = allEntries.length > 0 ? totalConfidence / allEntries.length : 0;

    return stats;
  }

  // ========== Private Helper Methods ==========

  private validateEntry(entry: CompactDiscoveryEntry): void {
    const required: Array<keyof CompactDiscoveryEntry> = [
      'f', 'g', 'conf', 'auth', 'why', 'tried', 'blocked', 'ts', 'aid'
    ];

    for (const field of required) {
      if (entry[field] === undefined) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    if (entry.g < 0 || entry.g > 4) {
      throw new Error(`Invalid granularity tier: ${entry.g} (must be 0-4)`);
    }

    if (entry.conf < 0 || entry.conf > 100) {
      throw new Error(`Invalid confidence: ${entry.conf} (must be 0-100)`);
    }

    if (entry.auth < 0 || entry.auth > 5) {
      throw new Error(`Invalid authority level: ${entry.auth} (must be 0-5)`);
    }

    if (!Array.isArray(entry.why) || entry.why.length === 0) {
      throw new Error('Reasoning chain (why) must be non-empty array');
    }

    if (!Array.isArray(entry.tried) || entry.tried.length === 0) {
      throw new Error('Tried tiers (tried) must be non-empty array');
    }
  }

  private matchesFilter(entry: CompactDiscoveryEntry, filter: ProvenanceFilter): boolean {
    if (filter.tier !== undefined && entry.g !== filter.tier) return false;
    if (filter.state && entry.s !== filter.state) return false;
    if (filter.blockerCode && entry.blocked !== filter.blockerCode) return false;
    if (filter.minConfidence !== undefined && entry.conf < filter.minConfidence) return false;
    if (filter.fips && entry.f !== filter.fips) return false;
    if (filter.startDate && entry.ts < filter.startDate) return false;
    if (filter.endDate && entry.ts > filter.endDate) return false;
    if (filter.authorityLevel !== undefined && entry.auth !== filter.authorityLevel) return false;

    return true;
  }

  private getShardedLogPath(fips: string): string {
    if (!fips || fips.length < 2) {
      throw new Error(`Invalid FIPS code: ${fips} (must be at least 2 digits)`);
    }

    const shard = fips.substring(0, 2); // First 2 digits = state code
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const monthDir = path.join(this.baseDir, `${year}-${month}`);
    return path.join(monthDir, `discovery-log-${shard}.ndjson.gz`);
  }

  private async ensureMonthlyDirectory(logPath: string): Promise<void> {
    const dir = path.dirname(logPath);
    await fs.mkdir(dir, { recursive: true });
  }

  private async getMonthlyLogsToScan(
    startDate?: string,
    endDate?: string
  ): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.baseDir, { withFileTypes: true });
      const monthDirs = entries.filter((e) => e.isDirectory() && e.name.match(/^\d{4}-\d{2}$/));

      const logPaths: string[] = [];

      for (const dir of monthDirs) {
        const monthPath = path.join(this.baseDir, dir.name);

        // Filter by date range
        if (startDate && dir.name < startDate.substring(0, 7)) continue;
        if (endDate && dir.name > endDate.substring(0, 7)) continue;

        // Scan for shard files
        const shardFiles = await fs.readdir(monthPath);
        const shardLogs = shardFiles
          .filter((f) => f.match(/^discovery-log-\d{2}\.ndjson\.gz$/))
          .map((f) => path.join(monthPath, f));

        logPaths.push(...shardLogs);
      }

      return logPaths;
    } catch {
      return [];
    }
  }

  private async getStagingFiles(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.stagingDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && e.name.endsWith('.ndjson'))
        .map((e) => path.join(this.stagingDir, e.name));
    } catch {
      return [];
    }
  }

  private async readStagingEntries(): Promise<CompactDiscoveryEntry[]> {
    const stagingFiles = await this.getStagingFiles();
    const entries: CompactDiscoveryEntry[] = [];

    for (const file of stagingFiles) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const lines = content.split('\n').filter((line) => line.trim());

        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as CompactDiscoveryEntry;
            entries.push(entry);
          } catch {
            // Skip malformed entries
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return entries;
  }
}

// Export singleton instance for convenience
export const provenanceWriter = new ProvenanceWriter();

// Note: ProvenanceFilter is already exported as an interface above
