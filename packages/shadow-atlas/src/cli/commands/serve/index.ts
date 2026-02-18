/**
 * Shadow Atlas Serve Command
 *
 * Start the production HTTP API server with both trees and Ed25519 signing.
 */

import { createShadowAtlasAPI } from '../../../serving/api.js';
import { RegistrationService, type CellMapState } from '../../../serving/registration-service.js';
import { SyncService } from '../../../serving/sync-service.js';
import { ServerSigner } from '../../../serving/signing.js';
import { loadCellDistrictMappings } from '../../../cell-district-loader.js';
import { buildCellMapTree, toCellMapState } from '../../../dual-tree-builder.js';
import { loadCellMapStateFromSnapshot } from '../../../hydration/snapshot-loader.js';
import { logger } from '../../../core/utils/logger.js';
import { promises as fsPromises } from 'fs';

export interface ServeOptions {
  port?: number;
  host?: string;
  dbPath?: string;
  corsOrigins?: string;
  rateLimitPerMinute?: number;
  ipfsGateway?: string;
  snapshotsDir?: string;
  dataDir?: string;
  cellMapSnapshot?: string;
  cellMapState?: string;
  bafCacheDir?: string;
}

export async function serveCommand(options: ServeOptions): Promise<void> {
  const {
    port = parseInt(process.env.PORT || '3000', 10),
    host = process.env.HOST || '0.0.0.0',
    dbPath = process.env.DB_PATH || '/data/shadow-atlas.db',
    corsOrigins = process.env.CORS_ORIGINS || '',
    rateLimitPerMinute = parseInt(process.env.RATE_LIMIT_PER_MINUTE || '60', 10),
    ipfsGateway = process.env.IPFS_GATEWAY || 'https://w3s.link',
    snapshotsDir = process.env.SNAPSHOTS_DIR || '/data/snapshots',
    dataDir = process.env.DATA_DIR || '/data/shadow-atlas',
  } = options;

  logger.info('Starting Shadow Atlas API server...', {
    port,
    host,
    dbPath,
    corsOrigins,
    rateLimitPerMinute,
    ipfsGateway,
    dataDir,
  });

  try {
    // Initialize Ed25519 signer for verifiable operator
    const signingKeyPath = process.env.SIGNING_KEY_PATH;
    const signer = await ServerSigner.init(signingKeyPath);
    logger.info('Ed25519 signer initialized', {
      persistent: !!signingKeyPath,
      fingerprint: signer.info.fingerprint,
    });

    // BR5-007: Initialize sync service and registration with persistent log
    const syncService = new SyncService({
      dataDir,
      ipfsGateway,
    });
    await syncService.init();

    // CRIT-002: Attempt IPFS recovery if local insertion log is missing
    const logPath = `${dataDir}/insertion-log.ndjson`;
    try {
      await fsPromises.access(logPath);
    } catch {
      logger.warn('Local insertion log not found, attempting IPFS recovery...');
      const recovered = await syncService.recoverLog(logPath);
      if (recovered) {
        logger.info('Insertion log recovered from IPFS', { path: recovered });
      } else {
        logger.warn('No prior state found in IPFS, starting with empty tree');
      }
    }

    // Create registration service with persistent insertion log + signer
    const registrationService = await RegistrationService.create(20, {
      path: logPath,
      signer,
    });

    // Build Tree 2 (Cell-District Map) if configured
    let cellMapState: CellMapState | null = null;
    const snapshotPath = options.cellMapSnapshot ?? process.env.CELL_MAP_SNAPSHOT;
    const stateCode = options.cellMapState ?? process.env.CELL_MAP_STATE;

    if (snapshotPath) {
      // Fast path: load pre-built snapshot (seconds, not minutes)
      logger.info('Loading Tree 2 from snapshot...', { path: snapshotPath });
      cellMapState = await loadCellMapStateFromSnapshot(snapshotPath);
      logger.info('Tree 2 loaded from snapshot', {
        root: '0x' + cellMapState.root.toString(16).slice(0, 16) + '...',
        cellCount: cellMapState.commitments.size,
        depth: cellMapState.depth,
      });
    } else if (stateCode) {
      // Build from BAFs (use for dev/single-state testing)
      const bafCacheDir = options.bafCacheDir ?? process.env.BAF_CACHE_DIR ?? 'data/baf-cache';
      const filterState = stateCode === 'all' ? undefined : stateCode;
      logger.info('Building Tree 2 from BAFs...', {
        stateFilter: filterState ?? 'ALL',
        cacheDir: bafCacheDir,
      });
      const mappings = await loadCellDistrictMappings({
        stateCode: filterState,
        cacheDir: bafCacheDir,
      });
      const result = await buildCellMapTree(mappings);
      cellMapState = toCellMapState(result);
      logger.info('Tree 2 built from BAFs', {
        root: '0x' + cellMapState.root.toString(16).slice(0, 16) + '...',
        cellCount: cellMapState.commitments.size,
        depth: cellMapState.depth,
      });
    } else {
      logger.warn('Tree 2 not configured — cell proof endpoint will return 501. ' +
        'Set CELL_MAP_SNAPSHOT or CELL_MAP_STATE to enable.');
    }

    // Create and start API server
    const api = await createShadowAtlasAPI(dbPath, {
      port,
      host,
      corsOrigins: corsOrigins.split(',').map((o) => o.trim()),
      rateLimitPerMinute,
      ipfsGateway,
      dataDir,
      syncService,
      registrationService,
      cellMapState,
      signer,
    });

    api.start();

    // MED-005: Graceful shutdown — await async operations before exiting
    const shutdown = async () => {
      logger.info('Received shutdown signal, stopping server...');
      try {
        await syncService.shutdown(registrationService.getInsertionLog());
        await registrationService.close();
      } catch (err) {
        logger.error('Shutdown error', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      api.stop();
      process.exit(0);
    };

    process.on('SIGTERM', () => { shutdown().catch(() => process.exit(1)); });
    process.on('SIGINT', () => { shutdown().catch(() => process.exit(1)); });

    logger.info('Server started successfully', {
      url: `http://${host}:${port}`,
      endpoints: {
        health: `http://${host}:${port}/v1/health`,
        lookup: `http://${host}:${port}/v1/lookup?lat={lat}&lng={lng}`,
        cellMapInfo: `http://${host}:${port}/v1/cell-map-info`,
        metrics: `http://${host}:${port}/v1/metrics`,
      },
      tree2: cellMapState ? 'enabled' : 'disabled',
      signer: 'enabled',
    });
  } catch (error) {
    logger.error('Failed to start server', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}
