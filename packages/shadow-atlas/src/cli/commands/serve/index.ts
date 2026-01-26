/**
 * Shadow Atlas Serve Command
 *
 * Start the production HTTP API server
 */

import { createShadowAtlasAPI } from '../../../serving/api.js';
import { logger } from '../../../core/utils/logger.js';

export interface ServeOptions {
  port?: number;
  host?: string;
  dbPath?: string;
  corsOrigins?: string;
  rateLimitPerMinute?: number;
  ipfsGateway?: string;
  snapshotsDir?: string;
}

export async function serveCommand(options: ServeOptions): Promise<void> {
  const {
    port = parseInt(process.env.PORT || '3000', 10),
    host = process.env.HOST || '0.0.0.0',
    dbPath = process.env.DB_PATH || '/data/shadow-atlas.db',
    corsOrigins = process.env.CORS_ORIGINS || '*',
    rateLimitPerMinute = parseInt(process.env.RATE_LIMIT_PER_MINUTE || '60', 10),
    ipfsGateway = process.env.IPFS_GATEWAY || 'https://w3s.link',
    snapshotsDir = process.env.SNAPSHOTS_DIR || '/data/snapshots',
  } = options;

  logger.info('Starting Shadow Atlas API server...', {
    port,
    host,
    dbPath,
    corsOrigins,
    rateLimitPerMinute,
    ipfsGateway,
  });

  try {
    // Create and start API server
    const api = await createShadowAtlasAPI(dbPath, {
      port,
      host,
      corsOrigins: corsOrigins.split(',').map((o) => o.trim()),
      rateLimitPerMinute,
      ipfsGateway,
      snapshotsDir,
    });

    api.start();

    // Graceful shutdown
    const shutdown = () => {
      logger.info('Received shutdown signal, stopping server...');
      api.stop();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    logger.info('Server started successfully', {
      url: `http://${host}:${port}`,
      endpoints: {
        health: `http://${host}:${port}/v1/health`,
        lookup: `http://${host}:${port}/v1/lookup?lat={lat}&lng={lng}`,
        metrics: `http://${host}:${port}/v1/metrics`,
      },
    });
  } catch (error) {
    logger.error('Failed to start server', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}
