/**
 * Provenance Writer - Compact NDJSON Audit Trail
 *
 * PURPOSE: Append-only, compressed discovery provenance log for autonomous agents
 * FORMAT: Compact NDJSON (~150-250 bytes per entry) with gzip compression
 * STORAGE: discovery-attempts/YYYY-MM/discovery-log.ndjson.gz
 * THREAD-SAFETY: File locking prevents concurrent write corruption
 *
 * CRITICAL TYPE SAFETY: Provenance entries are our audit trail. Missing fields
 * or incorrect formats break our ability to understand why agents made decisions.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { logger } from '../core/utils/logger.js';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * Granularity tier (0-4, finest to coarsest)
 */
export type GranularityTier = 0 | 1 | 2 | 3 | 4;

/**
 * Authority level (0-5, unknown to federal mandate)
 */
export type AuthorityLevel = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Quality metrics for discovered boundaries
 */
export interface QualityMetrics {
  /** GeoJSON valid */
  readonly v: boolean;
  /** Validation tests passed */
  readonly t: number;
  /** Response time (ms) */
  readonly r: number;
  /** Data freshness (ISO date) */
  readonly d?: string;
}

/**
 * Compact provenance entry
 *
 * DESIGN: Field names are abbreviated for storage efficiency
 * TARGET: ~150-250 bytes per entry
 * SCALE: 19,495 US cities × 200 bytes = ~3.9MB raw, ~1.5MB gzipped
 */
export interface ProvenanceEntry {
  /** FIPS code (7 chars) */
  readonly f: string;
  /** City name (optional, for human readability) */
  readonly n?: string;
  /** State code (optional, 2 chars) */
  readonly s?: string;
  /** Population (optional) */
  readonly p?: number;
  /** Granularity tier (0-4) */
  readonly g: GranularityTier;
  /** Feature count */
  readonly fc?: number;
  /** Confidence (0-100) */
  readonly conf: number;
  /** Authority level (0-5) */
  readonly auth: AuthorityLevel;
  /** Source type (gis-server, arcgis, socrata, etc.) */
  readonly src?: string;
  /** Download URL */
  readonly url?: string;
  /** Quality metrics */
  readonly q?: QualityMetrics;
  /** Reasoning chain (why this tier chosen) */
  readonly why: readonly string[];
  /** Tiers attempted (e.g., [0, 1, 2]) */
  readonly tried: readonly number[];
  /** Blocker code preventing higher tier (or null) */
  readonly blocked: string | null;
  /** ISO timestamp */
  readonly ts: string;
  /** Agent ID (8 chars) */
  readonly aid: string;
  /** Supplemental notes (optional) */
  readonly sup?: string;
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
}

/**
 * File lock implementation using filesystem-based locking
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
   * CRITICAL: Close handle FIRST (guaranteed cleanup even if unlink fails)
   */
  async release(): Promise<void> {
    // CRITICAL: Close handle FIRST (guaranteed cleanup even if unlink fails)
    if (this.lockHandle) {
      try {
        await this.lockHandle.close();
      } catch (error) {
        // Log but don't throw - we MUST set handle to null
        logger.warn('Failed to close lock handle', {
          module: 'FileLock',
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        // ALWAYS clear the reference (prevents GC leak)
        this.lockHandle = null;
      }
    }

    // THEN try to delete lock file (failure is safe - lock is already released)
    try {
      await fs.unlink(this.lockPath);
    } catch (error) {
      // Safe to ignore - file may not exist or may be deleted by another process
      // Lock is already released by closing the handle
    }
  }
}

/**
 * Validate provenance entry structure
 * CRITICAL: Reject entries with missing required fields
 *
 * @param entry - Provenance entry to validate
 * @throws Error if validation fails
 */
function validateEntry(entry: ProvenanceEntry): void {
  const required: Array<keyof ProvenanceEntry> = ['f', 'g', 'conf', 'auth', 'why', 'tried', 'blocked', 'ts', 'aid'];

  for (const field of required) {
    if (entry[field] === undefined) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  // Validate field constraints
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

  // Validate ISO timestamp format
  if (!entry.ts.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/)) {
    throw new Error(`Invalid ISO timestamp: ${entry.ts}`);
  }
}

/**
 * Get monthly log file path
 *
 * STORAGE STRATEGY: Monthly directories for efficient organization
 * EXAMPLE: discovery-attempts/2025-11/discovery-log.ndjson.gz
 *
 * @param baseDir - Base directory for logs
 * @param date - Date for log file (defaults to now)
 * @returns Absolute path to monthly log file
 */
function getMonthlyLogPath(baseDir: string, date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const monthDir = path.join(baseDir, `${year}-${month}`);
  return path.join(monthDir, 'discovery-log.ndjson.gz');
}

/**
 * Get FIPS-sharded log file path
 *
 * SHARDING STRATEGY: Partition by first 2 FIPS digits (state code)
 * SCALE: 50 US states = 50 lock files = zero contention at 100-agent scale
 *
 * @param baseDir - Base directory for logs
 * @param fips - FIPS code (7 digits, first 2 = state code)
 * @param date - Date for log file (defaults to now)
 * @returns Absolute path to sharded log file
 *
 * @example
 * getShardedLogPath('.', '0666000') // → discovery-attempts/2025-11/discovery-log-06.ndjson.gz
 * getShardedLogPath('.', '4827000') // → discovery-attempts/2025-11/discovery-log-48.ndjson.gz
 */
function getShardedLogPath(baseDir: string, fips: string, date: Date = new Date()): string {
  if (!fips || fips.length < 2) {
    throw new Error(`Invalid FIPS code: ${fips} (must be at least 2 digits)`);
  }

  const shard = fips.substring(0, 2); // First 2 digits = state code
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const monthDir = path.join(baseDir, `${year}-${month}`);
  return path.join(monthDir, `discovery-log-${shard}.ndjson.gz`);
}

/**
 * Ensure monthly directory exists
 *
 * @param logPath - Path to log file
 */
async function ensureMonthlyDirectory(logPath: string): Promise<void> {
  const dir = path.dirname(logPath);
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Append provenance entry to compressed log
 *
 * THREAD-SAFETY: Uses file locking to prevent concurrent write corruption (or staging mode for zero contention)
 * COMPRESSION: Gzip for efficient storage (~1.5MB for 19,495 cities)
 * APPEND-ONLY: Never overwrites existing entries
 *
 * @param entry - Provenance entry to append
 * @param baseDir - Base directory for logs (defaults to ./discovery-attempts)
 * @param options - Optional configuration
 * @param options.staging - Use staging mode (zero lock contention, requires merge worker)
 * @param options.agentId - Agent ID for staging files (required if staging=true)
 *
 * @example
 * ```typescript
 * // Standard mode (FIPS sharding with file locks)
 * await appendProvenance({
 *   f: '0666000',
 *   n: 'San Diego',
 *   s: 'CA',
 *   p: 1386932,
 *   g: 1,
 *   fc: 9,
 *   conf: 85,
 *   auth: 3,
 *   src: 'muni-gis',
 *   url: 'https://seshat.datasd.org/...',
 *   q: { v: true, t: 1, r: 474, d: '2021-12-14' },
 *   why: ['T0 blocked: No precinct data', 'T1 success: 9 districts'],
 *   tried: [0, 1],
 *   blocked: null,
 *   ts: '2025-11-19T07:42:00Z',
 *   aid: 'agt-001',
 * });
 *
 * // Staging mode (100+ concurrent agents, zero contention)
 * await appendProvenance(entry, './discovery-attempts', {
 *   staging: true,
 *   agentId: 'agt-042',
 * });
 * ```
 */
export async function appendProvenance(
  entry: ProvenanceEntry,
  baseDir: string = './discovery-attempts',
  options?: { staging?: boolean; agentId?: string }
): Promise<void> {
  // Validate entry structure
  validateEntry(entry);

  // STAGING MODE: Zero lock contention (requires merge worker)
  if (options?.staging) {
    const agentId = options.agentId || entry.aid;
    // Staging must be sibling to baseDir (e.g., ./test-dir-staging)
    const baseName = path.basename(baseDir);
    const parentDir = path.dirname(baseDir);
    const stagingDir = path.join(parentDir, `${baseName}-staging`);

    // Import staging writer dynamically to avoid circular deps
    const { appendToStaging } = await import('./provenance-staging-writer.js');
    await appendToStaging(entry, agentId, stagingDir);
    return;
  }

  // STANDARD MODE: FIPS sharding with file locks
  // CRITICAL: Use entry timestamp to determine month directory (not current date)
  const entryDate = new Date(entry.ts);
  const logPath = getShardedLogPath(baseDir, entry.f, entryDate);

  // Ensure directory exists BEFORE creating lock file
  // This is safe because mkdir is idempotent
  await ensureMonthlyDirectory(logPath);

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
    } catch (error) {
      // File doesn't exist yet, start fresh
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
 * PERFORMANCE: Decompresses entire monthly log and filters in-memory
 * STAGING: Also scans staging area for recent unmerged entries
 * OPTIMIZATION: For production, consider indexing or database storage
 *
 * @param filter - Query filters
 * @param baseDir - Base directory for logs (defaults to ./discovery-attempts)
 * @returns Filtered provenance entries (compressed + staging)
 *
 * @example
 * ```typescript
 * // Find all high-population cities with low confidence
 * const lowConfidence = await queryProvenance({
 *   minConfidence: 0,
 *   state: 'CA',
 * });
 *
 * // Find all cities blocked by at-large governance
 * const atLarge = await queryProvenance({
 *   blockerCode: 'at-large-governance',
 * });
 *
 * // Find all Tier 1 (council district) discoveries
 * const tier1 = await queryProvenance({
 *   tier: 1,
 * });
 * ```
 */
export async function queryProvenance(
  filter: ProvenanceFilter,
  baseDir: string = './discovery-attempts'
): Promise<ProvenanceEntry[]> {
  const results: ProvenanceEntry[] = [];

  // 1. Scan compressed shards
  let monthsToScan = await getMonthlyLogsToScan(baseDir, filter.startDate, filter.endDate);

  // OPTIMIZATION: If filtering by state, only scan matching shard
  if (filter.state) {
    const stateFips = getStateFipsCode(filter.state);
    if (stateFips) {
      // Only scan this state's shard files
      const shardPattern = `discovery-log-${stateFips}.ndjson.gz`;
      monthsToScan = monthsToScan.filter((path) => path.includes(shardPattern));
    }
  }

  for (const logPath of monthsToScan) {
    try {
      // Read and decompress log file
      const compressed = await fs.readFile(logPath);
      const decompressed = await gunzip(compressed);
      const lines = decompressed.toString('utf-8').split('\n').filter((line) => line.trim());

      // Parse and filter entries
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as ProvenanceEntry;

          // Apply filters
          if (filter.tier !== undefined && entry.g !== filter.tier) continue;
          if (filter.state && entry.s !== filter.state) continue;
          if (filter.blockerCode && entry.blocked !== filter.blockerCode) continue;
          if (filter.minConfidence !== undefined && entry.conf < filter.minConfidence) continue;
          if (filter.fips && entry.f !== filter.fips) continue;
          if (filter.startDate && entry.ts < filter.startDate) continue;
          if (filter.endDate && entry.ts > filter.endDate) continue;

          results.push(entry);
        } catch (parseError) {
          // Skip malformed entries
          logger.warn('Skipping malformed entry', {
            line: line.substring(0, 100), // Truncate for logging
          });
        }
      }
    } catch (error) {
      // Log file doesn't exist or is corrupted, skip
      logger.warn('Failed to read log', {
        logPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 2. ALSO scan staging area for recent unmerged entries
  // CRITICAL FIX: Only scan staging if it's in the SAME directory tree as baseDir
  // This prevents test isolation issues where shared staging pollutes results
  try {
    // Staging must be sibling to baseDir (e.g., ./test-dir-staging)
    const baseName = path.basename(baseDir);
    const parentDir = path.dirname(baseDir);
    const stagingDir = path.join(parentDir, `${baseName}-staging`);

    const { readStagingEntries } = await import('./provenance-staging-writer.js');
    const stagingEntries = await readStagingEntries(stagingDir);

    for (const entry of stagingEntries) {
      // Apply same filters as compressed logs
      if (filter.tier !== undefined && entry.g !== filter.tier) continue;
      if (filter.state && entry.s !== filter.state) continue;
      if (filter.blockerCode && entry.blocked !== filter.blockerCode) continue;
      if (filter.minConfidence !== undefined && entry.conf < filter.minConfidence) continue;
      if (filter.fips && entry.f !== filter.fips) continue;
      if (filter.startDate && entry.ts < filter.startDate) continue;
      if (filter.endDate && entry.ts > filter.endDate) continue;

      results.push(entry);
    }
  } catch (error) {
    // Staging area doesn't exist or is empty - this is normal
    // Don't log warning (staging is optional)
  }

  return results;
}

/**
 * Get FIPS code prefix for state (first 2 digits)
 *
 * @param stateCode - 2-letter state code (e.g., 'CA', 'TX', 'NY')
 * @returns FIPS prefix or null if unknown
 */
function getStateFipsCode(stateCode: string): string | null {
  const stateFips: Record<string, string> = {
    AL: '01',
    AK: '02',
    AZ: '04',
    AR: '05',
    CA: '06',
    CO: '08',
    CT: '09',
    DE: '10',
    FL: '12',
    GA: '13',
    HI: '15',
    ID: '16',
    IL: '17',
    IN: '18',
    IA: '19',
    KS: '20',
    KY: '21',
    LA: '22',
    ME: '23',
    MD: '24',
    MA: '25',
    MI: '26',
    MN: '27',
    MS: '28',
    MO: '29',
    MT: '30',
    NE: '31',
    NV: '32',
    NH: '33',
    NJ: '34',
    NM: '35',
    NY: '36',
    NC: '37',
    ND: '38',
    OH: '39',
    OK: '40',
    OR: '41',
    PA: '42',
    RI: '44',
    SC: '45',
    SD: '46',
    TN: '47',
    TX: '48',
    UT: '49',
    VT: '50',
    VA: '51',
    WA: '53',
    WV: '54',
    WI: '55',
    WY: '56',
    DC: '11', // Washington DC
  };
  return stateFips[stateCode] || null;
}

/**
 * Get list of monthly log files to scan based on date range
 *
 * @param baseDir - Base directory for logs
 * @param startDate - Start date filter (ISO string)
 * @param endDate - End date filter (ISO string)
 * @returns Paths to monthly log files
 */
async function getMonthlyLogsToScan(
  baseDir: string,
  startDate?: string,
  endDate?: string
): Promise<string[]> {
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    const monthDirs = entries.filter((e) => e.isDirectory() && e.name.match(/^\d{4}-\d{2}$/));

    const logPaths: string[] = [];

    for (const dir of monthDirs) {
      const monthPath = path.join(baseDir, dir.name);

      // Filter by date range (month-level filtering)
      // CRITICAL: Use inclusive comparisons to catch all possible matches
      // Month "2025-11" contains dates from 2025-11-01 through 2025-11-30
      const monthStart = `${dir.name}-01T00:00:00.000Z`;
      const monthEnd = `${dir.name}-31T23:59:59.999Z`;

      // Skip if month ends before startDate OR month starts after endDate
      if (startDate && monthEnd < startDate) continue;
      if (endDate && monthStart > endDate) continue;

      // Scan for shard files (discovery-log-XX.ndjson.gz)
      const shardFiles = await fs.readdir(monthPath);
      const shardLogs = shardFiles
        .filter((f) => f.match(/^discovery-log-\d{2}\.ndjson\.gz$/))
        .map((f) => path.join(monthPath, f));

      logPaths.push(...shardLogs);
    }

    // Filter to existing files
    const existingLogs: string[] = [];
    for (const logPath of logPaths) {
      try {
        await fs.access(logPath);
        existingLogs.push(logPath);
      } catch {
        // File doesn't exist, skip
      }
    }

    return existingLogs;
  } catch (error) {
    // Base directory doesn't exist
    return [];
  }
}

/**
 * Get statistics from provenance log
 *
 * @param baseDir - Base directory for logs
 * @returns Summary statistics
 */
export async function getProvenanceStats(
  baseDir: string = './discovery-attempts'
): Promise<{
  totalEntries: number;
  byTier: Record<number, number>;
  byAuthority: Record<number, number>;
  byBlocker: Record<string, number>;
  avgConfidence: number;
}> {
  const allEntries = await queryProvenance({}, baseDir);

  const stats = {
    totalEntries: allEntries.length,
    byTier: {} as Record<number, number>,
    byAuthority: {} as Record<number, number>,
    byBlocker: {} as Record<string, number>,
    avgConfidence: 0,
  };

  let totalConfidence = 0;

  for (const entry of allEntries) {
    // Tier stats
    stats.byTier[entry.g] = (stats.byTier[entry.g] || 0) + 1;

    // Authority stats
    stats.byAuthority[entry.auth] = (stats.byAuthority[entry.auth] || 0) + 1;

    // Blocker stats
    if (entry.blocked) {
      stats.byBlocker[entry.blocked] = (stats.byBlocker[entry.blocked] || 0) + 1;
    }

    // Confidence stats
    totalConfidence += entry.conf;
  }

  stats.avgConfidence = allEntries.length > 0 ? totalConfidence / allEntries.length : 0;

  return stats;
}
