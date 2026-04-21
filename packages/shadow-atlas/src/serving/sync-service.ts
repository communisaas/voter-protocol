/**
 * IPFS Sync Service — Log-Based Persistence (/ SA-008)
 *
 * Manages IPFS-based backup and recovery of the Tree 1 insertion log.
 *
 * Architecture:
 * - Local: InsertionLog writes append-only NDJSON to disk (fsync'd)
 * - Remote: Periodically uploads the log to Storacha + Lighthouse
 * - Recovery: On startup, if local log is missing, fetches from IPFS
 *
 * The insertion log is the canonical state — the Merkle tree is a
 * deterministic function of the log entries replayed in order.
 *
 * Upload strategy:
 * - After every N insertions (default 10), upload the full log
 * - On graceful shutdown, upload the final state
 * - Each upload produces a new CID (content-addressed, immutable)
 * - Latest CID is persisted locally for fast recovery
 *
 * SPEC REFERENCE: IMPLEMENTATION-GAP-ANALYSIS.md SA-008
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import type { IPinningService } from '../distribution/regional-pinning-service.js';
import type { InsertionLog } from './insertion-log.js';
import { logger } from '../core/utils/logger.js';
import { fetchBufferWithSizeLimit } from '../hydration/fetch-with-size-limit.js';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { sha256 } from 'multiformats/hashes/sha2';

// ============================================================================
// Types
// ============================================================================

/** Per-service CID record for consensus tracking (R52-A1) */
export interface ServiceCidRecord {
  readonly service: string;
  readonly cid: string;
}

/** Pinned log metadata — stored locally for recovery */
export interface PinnedLogMetadata {
  /** IPFS CID of the uploaded log (majority-vote primary CID — R52-A1) */
  readonly cid: string;
  /** Number of entries at time of upload */
  readonly entryCount: number;
  /** Timestamp of upload */
  readonly uploadedAt: number;
  /** Which service(s) successfully pinned */
  readonly services: readonly string[];
  /** Per-service CIDs for divergence detection (R52-A1) */
  readonly serviceCids?: readonly ServiceCidRecord[];
}

/** SyncService configuration */
export interface SyncServiceConfig {
  /** Directory for persisting metadata */
  readonly dataDir: string;
  /** Upload after every N insertions (default: 10) */
  readonly uploadInterval?: number;
  /** IPFS gateway URL for fetching logs (default: https://w3s.link) */
  readonly ipfsGateway?: string;
  /** Pinning services for upload (Storacha, Lighthouse, etc.) */
  readonly pinningServices?: readonly IPinningService[];
}

// ============================================================================
// SyncService
// ============================================================================

/**
 * IPFS sync service for insertion log persistence.
 *
 * Handles upload of local insertion log to IPFS pinning services
 * and recovery from IPFS when local state is lost.
 */
/**
 * Compute CIDv1 (raw codec + sha2-256) from buffer.
 * This matches the CID format used by Storacha/w3up for small files.
 */
async function computeCidV1(content: Buffer): Promise<string> {
  const hash = await sha256.digest(content);
  const cid = CID.createV1(raw.code, hash);
  return cid.toString();
}

/**
 * R52-A1: Select the most common CID from per-service results (majority vote).
 * If there's a tie, the first CID encountered with the highest count wins.
 * With only 1 service, returns that service's CID (no consensus possible).
 */
function selectMajorityCid(serviceCids: readonly ServiceCidRecord[]): string {
  const counts = new Map<string, number>();
  for (const { cid } of serviceCids) {
    counts.set(cid, (counts.get(cid) ?? 0) + 1);
  }

  let bestCid = serviceCids[0].cid;
  let bestCount = 0;
  for (const [cid, count] of counts) {
    if (count > bestCount) {
      bestCid = cid;
      bestCount = count;
    }
  }
  return bestCid;
}

export class SyncService {
  private readonly dataDir: string;
  private readonly uploadInterval: number;
  private readonly ipfsGateway: string;
  private readonly pinningServices: readonly IPinningService[];
  private readonly metadataPath: string;
  private insertionsSinceLastUpload = 0;
  private uploading = false;
  private latestMetadata: PinnedLogMetadata | null = null;

  constructor(config: SyncServiceConfig) {
    this.dataDir = config.dataDir;
    this.uploadInterval = config.uploadInterval ?? 10;
    this.ipfsGateway = config.ipfsGateway ?? 'https://w3s.link';
    this.pinningServices = config.pinningServices ?? [];
    this.metadataPath = join(this.dataDir, 'latest-log-cid.json');
  }

  /**
   * Initialize: load last known CID metadata from disk.
   */
  async init(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    this.latestMetadata = await this.loadMetadata();

    logger.info('SyncService initialized', {
      dataDir: this.dataDir,
      latestCID: this.latestMetadata?.cid ?? 'none',
      latestEntryCount: this.latestMetadata?.entryCount ?? 0,
      pinningServices: this.pinningServices.map(s => s.type),
    });
  }

  /**
   * Notify the sync service that a leaf was inserted.
   *
   * After every `uploadInterval` insertions, triggers an async upload
   * of the insertion log to all configured pinning services.
   *
   * The upload is fire-and-forget — registration is not blocked.
   */
  notifyInsertion(log: InsertionLog): void {
    this.insertionsSinceLastUpload++;

    if (this.insertionsSinceLastUpload >= this.uploadInterval && !this.uploading) {
      this.uploading = true;
      this.uploadLog(log).then(
        (metadata) => {
          this.uploading = false;
          if (metadata) {
            this.insertionsSinceLastUpload = 0;
          } else {
            logger.error('SyncService: all pinning services failed, counter NOT reset');
          }
        },
        (error) => {
          this.uploading = false;
          logger.error('SyncService: background upload failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        },
      );
    }
  }

  /**
   * Upload the insertion log to all configured pinning services.
   *
   * R52-A1: Collects CIDs from ALL successful services, checks for consensus,
   * logs a WARNING on divergence, and uses the majority-vote CID as primary.
   *
   * Persists per-service CIDs in metadata for auditability.
   */
  async uploadLog(log: InsertionLog): Promise<PinnedLogMetadata | null> {
    if (this.pinningServices.length === 0) {
      logger.warn('SyncService: no pinning services configured, skipping upload');
      return null;
    }

    const logBuffer = await log.export();
    const blob = new Blob([new Uint8Array(logBuffer)], { type: 'application/x-ndjson' });
    const name = `insertion-log-${log.count}.ndjson`;

    const successfulServices: string[] = [];
    // R52-A1: Collect ALL per-service CIDs, not just the first
    const serviceCids: ServiceCidRecord[] = [];

    // Upload to all services in parallel
    const results = await Promise.allSettled(
      this.pinningServices.map(async (service) => {
        const result = await service.pin(blob, { name });
        if (result.success) {
          return { service: service.type, cid: result.cid };
        }
        throw new Error(result.error ?? 'Pin failed');
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        successfulServices.push(result.value.service);
        serviceCids.push({ service: result.value.service, cid: result.value.cid });
      } else {
        logger.warn('SyncService: pin failed on one service', {
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }

    if (serviceCids.length === 0) {
      logger.error('SyncService: all pinning services failed');
      return null;
    }

    // R52-A1: Determine primary CID via majority vote (consensus check)
    const cid = selectMajorityCid(serviceCids);

    // R52-A1: Warn on CID divergence across services
    if (serviceCids.length > 1) {
      const uniqueCids = new Set(serviceCids.map(sc => sc.cid));
      if (uniqueCids.size > 1) {
        logger.warn('SyncService: CID DIVERGENCE detected across pinning services (R52-A1)', {
          serviceCids,
          primaryCid: cid,
          uniqueCidCount: uniqueCids.size,
        });
      }
    }

    const metadata: PinnedLogMetadata = {
      cid,
      entryCount: log.count,
      uploadedAt: Date.now(),
      services: successfulServices,
      serviceCids, // R52-A1: per-service CIDs for auditability
    };

    // Persist metadata locally
    await this.saveMetadata(metadata);
    this.latestMetadata = metadata;

    logger.info('SyncService: insertion log uploaded', {
      cid,
      entryCount: log.count,
      services: successfulServices,
    });

    return metadata;
  }

  /**
   * Recover the insertion log from IPFS.
   *
   * Fetches the log from the IPFS gateway using the last known CID.
   * Writes the recovered log to the specified local path.
   *
   * @returns Path to the recovered log file, or null if recovery failed
   */
  async recoverLog(localLogPath: string): Promise<string | null> {
    if (!this.latestMetadata) {
      logger.info('SyncService: no previous CID known, cannot recover');
      return null;
    }

    const cid = this.latestMetadata.cid;
    const url = `${this.ipfsGateway}/ipfs/${cid}`;

    logger.info('SyncService: attempting log recovery from IPFS', {
      cid,
      url,
      expectedEntries: this.latestMetadata.entryCount,
    });

    try {
      // R52-S1: Use size-limited fetch to prevent OOM from oversized IPFS responses
      const buffer = await fetchBufferWithSizeLimit(url, undefined, {
        signal: AbortSignal.timeout(30000),
      });

      // Verify content integrity — CID must match expected
      try {
        const computedCid = await computeCidV1(buffer);
        const expectedCid = this.latestMetadata!.cid;
        
        // CID comparison: try exact match first, then base-encoded match
        if (computedCid !== expectedCid) {
          // CIDs may use different base encodings (base32 vs base58btc)
          // Parse both and compare the raw bytes
          try {
            const computed = CID.parse(computedCid);
            const expected = CID.parse(expectedCid);
            if (!computed.equals(expected)) {
              throw new Error(
                `CID mismatch: expected ${expectedCid}, computed ${computedCid}. ` +
                `Content may have been tampered with by the IPFS gateway.`
              );
            }
          } catch (parseError) {
            // If CID parsing fails, the mismatch stands
            if (parseError instanceof Error && parseError.message.includes('CID mismatch')) {
              throw parseError;
            }
            // R55-A1: Reject on CID parse failure — don't proceed with unverifiable content
            throw new Error(
              `CID verification failed: unable to parse CIDs for comparison. ` +
              `computed=${computedCid}, expected=${expectedCid}, ` +
              `parseError=${parseError instanceof Error ? parseError.message : String(parseError)}`
            );
          }
        }
        
        logger.info('SyncService: CID verification passed', {
          cid: expectedCid,
        });
      } catch (cidError) {
        if (cidError instanceof Error && cidError.message.includes('CID mismatch')) {
          throw cidError;  // Re-throw CID mismatch — don't write tampered content
        }
        // Fail-closed on CID computation errors — do not trust unverified content.
        // Previously warned and proceeded; now rejects to maintain zero-trust guarantee.
        logger.error('SyncService: CID verification failed (computation error), rejecting content', {
          error: cidError instanceof Error ? cidError.message : String(cidError),
        });
        throw new Error(`CID verification failed: ${cidError instanceof Error ? cidError.message : String(cidError)}`);
      }

      // Verify the recovered log has content
      const lineCount = buffer.toString('utf8').trim().split('\n').length;
      if (lineCount === 0) {
        throw new Error('Recovered log is empty');
      }

      // R70-H2: Atomic write — tmp+rename prevents corrupt canonical state on crash.
      await fs.mkdir(dirname(localLogPath), { recursive: true });
      const tmpPath = `${localLogPath}.recovery.tmp`;
      await fs.writeFile(tmpPath, buffer);
      await fs.rename(tmpPath, localLogPath);

      logger.info('SyncService: log recovered from IPFS', {
        cid,
        lines: lineCount,
        localPath: localLogPath,
      });

      return localLogPath;
    } catch (error) {
      logger.error('SyncService: log recovery failed', {
        cid,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Perform a final upload on graceful shutdown.
   */
  async shutdown(log: InsertionLog | null): Promise<void> {
    if (log && log.count > 0) {
      logger.info('SyncService: uploading final state before shutdown');
      await this.uploadLog(log);
    }
    logger.info('SyncService stopped');
  }

  /** Get the latest pinned log metadata */
  getLatestMetadata(): PinnedLogMetadata | null {
    return this.latestMetadata;
  }

  // ============================================================================
  // Legacy API compatibility (used by ShadowAtlasAPI)
  // ============================================================================

  /** Start periodic sync checks (legacy — now driven by insertion notifications) */
  start(): void {
    // No-op: sync is now driven by notifyInsertion()
    logger.info('SyncService started (event-driven mode)');
  }

  /** Stop sync service */
  stop(): void {
    // No-op in event-driven mode
    logger.info('SyncService stopped');
  }

  /** Get latest snapshot metadata (legacy compat) */
  async getLatestSnapshot(): Promise<{
    cid: string;
    merkleRoot: bigint;
    timestamp: number;
    districtCount: number;
    version: string;
  } | null> {
    if (!this.latestMetadata) return null;
    return {
      cid: this.latestMetadata.cid,
      merkleRoot: 0n,
      timestamp: this.latestMetadata.uploadedAt,
      districtCount: this.latestMetadata.entryCount,
      version: '1.0.0',
    };
  }

  /** List snapshots (legacy compat) */
  async listSnapshots(): Promise<readonly {
    cid: string;
    merkleRoot: bigint;
    timestamp: number;
    districtCount: number;
    version: string;
  }[]> {
    const latest = await this.getLatestSnapshot();
    return latest ? [latest] : [];
  }

  // ============================================================================
  // Internal
  // ============================================================================

  private async loadMetadata(): Promise<PinnedLogMetadata | null> {
    try {
      const data = await fs.readFile(this.metadataPath, 'utf8');
      return JSON.parse(data) as PinnedLogMetadata;
    } catch {
      return null;
    }
  }

  /**
   * Atomic metadata write: write to.tmp then rename (HIGH-001 fix).
   * Prevents metadata corruption if process crashes mid-write.
   */
  private async saveMetadata(metadata: PinnedLogMetadata): Promise<void> {
    const tmpPath = this.metadataPath + '.tmp';
    await fs.writeFile(tmpPath, JSON.stringify(metadata, null, 2));
    await fs.rename(tmpPath, this.metadataPath);
  }
}
