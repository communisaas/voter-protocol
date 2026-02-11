/**
 * IPFS Sync Service — Log-Based Persistence (BR5-007 / SA-008)
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
 * SPEC REFERENCE: IMPLEMENTATION-GAP-ANALYSIS.md BR5-007, SA-008
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import type { IPinningService } from '../distribution/regional-pinning-service.js';
import type { InsertionLog } from './insertion-log.js';
import { logger } from '../core/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/** Pinned log metadata — stored locally for recovery */
export interface PinnedLogMetadata {
  /** IPFS CID of the uploaded log */
  readonly cid: string;
  /** Number of entries at time of upload */
  readonly entryCount: number;
  /** Timestamp of upload */
  readonly uploadedAt: number;
  /** Which service(s) successfully pinned */
  readonly services: readonly string[];
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
export class SyncService {
  private readonly dataDir: string;
  private readonly uploadInterval: number;
  private readonly ipfsGateway: string;
  private readonly pinningServices: readonly IPinningService[];
  private readonly metadataPath: string;
  private insertionsSinceLastUpload = 0;
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

    if (this.insertionsSinceLastUpload >= this.uploadInterval) {
      // Don't reset counter until upload succeeds (HIGH-003 fix).
      // Prevents unbounded data-loss window when uploads fail repeatedly.
      this.uploadLog(log).then(
        (metadata) => {
          if (metadata) {
            this.insertionsSinceLastUpload = 0;
          } else {
            logger.error('SyncService: all pinning services failed, counter NOT reset');
          }
        },
        (error) => {
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
   * Returns the CID from the first successful upload.
   * Persists the metadata locally for recovery.
   */
  async uploadLog(log: InsertionLog): Promise<PinnedLogMetadata | null> {
    if (this.pinningServices.length === 0) {
      logger.warn('SyncService: no pinning services configured, skipping upload');
      return null;
    }

    const logBuffer = await log.export();
    const blob = new Blob([logBuffer], { type: 'application/x-ndjson' });
    const name = `insertion-log-${log.count}.ndjson`;

    const successfulServices: string[] = [];
    let cid = '';

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
        if (!cid) cid = result.value.cid;
      } else {
        logger.warn('SyncService: pin failed on one service', {
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }

    if (!cid) {
      logger.error('SyncService: all pinning services failed');
      return null;
    }

    const metadata: PinnedLogMetadata = {
      cid,
      entryCount: log.count,
      uploadedAt: Date.now(),
      services: successfulServices,
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
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`IPFS gateway returned ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // Verify the recovered log has content
      const lineCount = buffer.toString('utf8').trim().split('\n').length;
      if (lineCount === 0) {
        throw new Error('Recovered log is empty');
      }

      // Write to local path
      await fs.mkdir(dirname(localLogPath), { recursive: true });
      await fs.writeFile(localLogPath, buffer);

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
   * Atomic metadata write: write to .tmp then rename (HIGH-001 fix).
   * Prevents metadata corruption if process crashes mid-write.
   */
  private async saveMetadata(metadata: PinnedLogMetadata): Promise<void> {
    const tmpPath = this.metadataPath + '.tmp';
    await fs.writeFile(tmpPath, JSON.stringify(metadata, null, 2));
    await fs.rename(tmpPath, this.metadataPath);
  }
}
