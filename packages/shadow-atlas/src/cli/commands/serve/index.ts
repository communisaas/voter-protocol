/**
 * Shadow Atlas Serve Command
 *
 * Start the production HTTP API server with all three trees and Ed25519 signing.
 * The three-tree architecture (User, Cell Map, Engagement) is the primary proof path.
 * Two-tree proofs remain supported as a subset (Trees 1 + 2 only).
 */

import { createShadowAtlasAPI } from '../../../serving/api.js';
import { RegistrationService, type CellMapState } from '../../../serving/registration-service.js';
import { OfficialsService } from '../../../serving/officials-service.js';
import { EngagementService } from '../../../serving/engagement-service.js';
import { SyncService } from '../../../serving/sync-service.js';
import { ChainScanner } from '../../../serving/chain-scanner.js';
import { DebateRelayer } from '../../../serving/relayer.js';
import { DebateService } from '../../../serving/debate-service.js';
import {
  EngagementTreeBuilder,
  createActionCategoryRegistry,
  type ActionCategoryRegistry,
} from '../../../engagement-tree-builder.js';
import { ServerSigner } from '../../../serving/signing.js';
import { loadCellDistrictMappings } from '../../../cell-district-loader.js';
import { buildCellMapTree, toCellMapState } from '../../../tree-builder.js';
import { loadCellMapStateFromSnapshot } from '../../../hydration/snapshot-loader.js';
import { createConfiguredServices } from '../../../distribution/services/index.js';
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

    // Auto-discover IPFS pinning services from env vars
    // STORACHA_SPACE_DID + STORACHA_AGENT_KEY → Storacha
    // LIGHTHOUSE_API_KEY → Lighthouse
    const pinningServices = createConfiguredServices('americas-east');
    if (pinningServices.length > 0) {
      logger.info('IPFS pinning services configured', {
        services: pinningServices.map(s => s.type),
      });
    } else {
      logger.warn('No IPFS pinning services configured. Insertion log will NOT be backed up to IPFS. ' +
        'Set STORACHA_SPACE_DID + STORACHA_AGENT_KEY or LIGHTHOUSE_API_KEY to enable.');
    }

    // BR5-007: Initialize sync service and registration with persistent log
    const syncService = new SyncService({
      dataDir,
      ipfsGateway,
      pinningServices,
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

    // Build Tree 3 (Engagement) with persistent log
    const engagementLogPath = `${dataDir}/engagement-log.ndjson`;
    const engagementService = await EngagementService.create(20, {
      path: engagementLogPath,
      signer,
    });
    logger.info('Engagement service initialized (Tree 3)', {
      depth: engagementService.getDepth(),
      identities: engagementService.getLeafCount(),
      rootPrefix: engagementService.getRootHex().slice(0, 18) + '...',
    });

    // Start chain event scanner (optional — needs CHAIN_RPC_URL)
    let chainScanner: ChainScanner | null = null;
    const chainRpcUrl = process.env.CHAIN_RPC_URL;
    const districtGateAddr = process.env.DISTRICT_GATE_ADDRESS;

    if (chainRpcUrl && districtGateAddr) {
      // Load action domain → category registry (JSON file: { "0xhash": 1, ... })
      // Without this, diversityScore will be 0 for all signers because action
      // domains are keccak256 hashes with no structured prefix byte.
      let categoryRegistry: ActionCategoryRegistry = createActionCategoryRegistry();
      const registryPath = process.env.ACTION_CATEGORY_REGISTRY;
      if (registryPath) {
        try {
          const raw = await fsPromises.readFile(registryPath, 'utf-8');
          const parsed = JSON.parse(raw) as Record<string, number>;
          const mutable = createActionCategoryRegistry();
          for (const [domain, cat] of Object.entries(parsed)) {
            mutable.set(domain.toLowerCase(), cat);
          }
          categoryRegistry = mutable;
          logger.info('Action category registry loaded', {
            path: registryPath,
            entries: mutable.size,
          });
        } catch (err) {
          logger.warn('Failed to load action category registry — diversityScore will be 0', {
            path: registryPath,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        logger.warn('ACTION_CATEGORY_REGISTRY not set — diversityScore will be 0. ' +
          'Create a JSON file mapping action domain hashes to category (1-5).');
      }

      chainScanner = await ChainScanner.create({
        rpcUrl: chainRpcUrl,
        districtGateAddress: districtGateAddr,
        cursorPath: `${dataDir}/chain-scanner-cursor.json`,
        startBlock: parseInt(process.env.CHAIN_START_BLOCK || '0', 10),
        pollIntervalMs: parseInt(process.env.CHAIN_POLL_INTERVAL_MS || '30000', 10),
      });

      // Wire events: chain events → EngagementTreeBuilder → EngagementService
      // Capture categoryRegistry in closure for use across poll cycles
      const registry = categoryRegistry;
      chainScanner.setEventCallback(async (events) => {
        // Build identity map from EngagementService's registered signers
        const identityMap = new Map<string, bigint>();
        for (const event of events) {
          const record = engagementService.getMetricsBySigner(event.signer);
          if (record) {
            identityMap.set(event.signer.toLowerCase(), record.identityCommitment);
          }
        }

        if (identityMap.size === 0) return;

        const result = EngagementTreeBuilder.buildFromEvents(
          events, identityMap, undefined, registry,
        );
        for (const entry of result.entries) {
          await engagementService.updateMetrics(entry.identityCommitment, {
            actionCount: entry.actionCount,
            diversityScore: entry.diversityScore,
            tenureMonths: entry.tenureMonths,
          });
        }

        if (result.entries.length > 0) {
          logger.info('ChainScanner: engagement metrics updated', {
            updated: result.entries.length,
            skipped: result.skippedSigners.length,
          });
        }
      });

      chainScanner.start();
      logger.info('Chain event scanner started', {
        districtGate: districtGateAddr,
        pollInterval: process.env.CHAIN_POLL_INTERVAL_MS || '30000',
        categoryRegistryEntries: (categoryRegistry as Map<string, number>).size,
      });
    } else {
      logger.warn('Chain scanner not configured — Tree 3 (Engagement) metrics will not auto-update. ' +
        'Three-tree proofs require engagement data. Set CHAIN_RPC_URL and DISTRICT_GATE_ADDRESS to enable.');
    }

    // Initialize DebateService (lightweight in-memory — always available for API endpoints)
    const debateService = new DebateService();

    // Start debate relayer + epoch keeper (optional — needs RELAYER_PRIVATE_KEY + DEBATE_MARKET_ADDRESS)
    let debateRelayer: DebateRelayer | null = null;
    const relayerPrivateKey = process.env.RELAYER_PRIVATE_KEY;
    const debateMarketAddr = process.env.DEBATE_MARKET_ADDRESS;

    if (chainRpcUrl && relayerPrivateKey && debateMarketAddr) {
      debateRelayer = await DebateRelayer.create({
        rpcUrl: chainRpcUrl,
        privateKey: relayerPrivateKey,
        debateMarketAddress: debateMarketAddr,
        chainId: parseInt(process.env.CHAIN_ID || '534351', 10),
      });

      debateRelayer.start();
      logger.info('Debate relayer + epoch keeper started', {
        address: debateRelayer.getAddress(),
        debateMarket: debateMarketAddr,
      });
    } else if (debateMarketAddr && !relayerPrivateKey) {
      logger.warn('DEBATE_MARKET_ADDRESS set but RELAYER_PRIVATE_KEY missing — relayer disabled. ' +
        'Users must submit trades directly.');
    }

    // Wire chain scanner debate events → DebateService + DebateRelayer (composed callback).
    // ChainScanner supports a single debate callback, so we compose both consumers here.
    if (chainScanner) {
      chainScanner.setDebateEventCallback(async (events) => {
        // Feed DebateService (in-memory state + SSE push to connected clients)
        debateService.processEvents(events);

        // Feed DebateRelayer (epoch keeper tracking)
        if (debateRelayer) {
          for (const event of events) {
            if (event.type === 'EpochExecuted') {
              // After an epoch executes the new epoch starts; epochStartTime is
              // approximated as the event's block timestamp.
              debateRelayer.trackDebate(
                event.debateId,
                event.epoch + 1,
                event.timestamp,
              );
            } else if (event.type === 'DebateResolved') {
              debateRelayer.untrackDebate(event.debateId);
            } else if (event.type === 'TradeCommitted' && event.epoch === 0) {
              // First commit on a new debate — register with epoch 0 starting now
              debateRelayer.trackDebate(event.debateId, 0, event.timestamp);
            }
          }
        }
      });
    }

    // Initialize Officials Service (pre-ingested Congress data)
    const officialsDbPath = process.env.OFFICIALS_DB_PATH || `${dataDir}/officials.db`;
    let officialsService: OfficialsService | null = null;
    try {
      officialsService = new OfficialsService(officialsDbPath);
      const count = officialsService.getMemberCount();
      if (count > 0) {
        logger.info('Officials service initialized', {
          dbPath: officialsDbPath,
          memberCount: count,
        });
      } else {
        logger.warn('Officials DB exists but is empty. Run: tsx src/scripts/ingest-legislators.ts --db ' + officialsDbPath);
        officialsService.close();
        officialsService = null;
      }
    } catch (err) {
      logger.warn('Officials service not available — /v1/officials will return 501. ' +
        'Run ingest-legislators.ts to populate.', {
        error: err instanceof Error ? err.message : String(err),
      });
      officialsService = null;
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
      engagementService,
      officialsService: officialsService ?? undefined,
      debateService,
    });

    api.start();

    // Start DebateService (keepalive timer for SSE connections)
    debateService.start();
    logger.info('Debate service started (SSE + market state)');

    // MED-005: Graceful shutdown — await async operations before exiting
    const shutdown = async () => {
      logger.info('Received shutdown signal, stopping server...');
      try {
        if (debateRelayer) debateRelayer.stop();
        if (chainScanner) await chainScanner.stop();
        if (officialsService) officialsService.close();
        await syncService.shutdown(registrationService.getInsertionLog());
        await registrationService.close();
        await engagementService.close();
      } catch (err) {
        logger.error('Shutdown error', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      await api.stop();
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
      tree3: 'enabled',
      officials: officialsService ? 'enabled' : 'disabled',
      chainScanner: chainScanner ? 'enabled' : 'disabled',
      relayer: debateRelayer ? 'enabled' : 'disabled',
      debateService: 'enabled',
      signer: 'enabled',
    });
  } catch (error) {
    logger.error('Failed to start server', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}
