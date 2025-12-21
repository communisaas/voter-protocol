/**
 * Factory for Creating ShadowAtlasService with Proper Dependencies
 *
 * Provides dependency injection for the ShadowAtlasService facade.
 * Ensures all dependencies are properly initialized and configured.
 *
 * TYPE SAFETY: All dependencies are strongly typed and validated at construction time.
 */

import { ShadowAtlasService } from './shadow-atlas-service.js';
import { createConfig, DEFAULT_CONFIG, type ShadowAtlasConfig } from './config.js';

/**
 * Create ShadowAtlasService with proper dependencies
 *
 * @param config - Partial configuration to override defaults
 * @returns Fully configured ShadowAtlasService instance
 *
 * @example
 * ```typescript
 * // Use default configuration
 * const atlas = createShadowAtlasService();
 *
 * // Custom configuration
 * const atlas = createShadowAtlasService({
 *   extraction: {
 *     concurrency: 10,  // More concurrent extractions
 *   },
 *   validation: {
 *     minPassRate: 0.95,  // Stricter validation
 *   },
 * });
 * ```
 */
export function createShadowAtlasService(
  config: Partial<ShadowAtlasConfig> = {}
): ShadowAtlasService {
  const fullConfig = createConfig(config);

  // Create service with full configuration
  return new ShadowAtlasService(fullConfig);
}

/**
 * Create ShadowAtlasService with production configuration
 *
 * Production defaults:
 * - Higher concurrency (10 concurrent extractions)
 * - Stricter validation (95% pass rate)
 * - Persistent job state (SQLite)
 * - IPFS pinning enabled
 *
 * @returns Production-configured ShadowAtlasService
 */
export async function createProductionService(): Promise<ShadowAtlasService> {
  const service = createShadowAtlasService({
    extraction: {
      concurrency: 10,
      retryAttempts: 5,
      retryDelayMs: 3000,
      timeoutMs: 60_000,
    },
    validation: {
      minPassRate: 0.95,
      crossValidate: true,
      storeResults: true,
    },
    persistence: {
      enabled: true,
      databasePath: 'shadow-atlas.db',
      autoMigrate: true,
    },
  });

  // Initialize persistence layer (runs migrations)
  await service.initialize();
  return service;
}

/**
 * Create ShadowAtlasService with development configuration
 *
 * Development defaults:
 * - Lower concurrency (2 concurrent extractions for debugging)
 * - Relaxed validation (80% pass rate)
 * - SQLite persistence enabled (for debugging job history)
 * - Local IPFS gateway
 *
 * @returns Development-configured ShadowAtlasService
 */
export async function createDevelopmentService(): Promise<ShadowAtlasService> {
  const service = createShadowAtlasService({
    extraction: {
      concurrency: 2,
      retryAttempts: 1,
      retryDelayMs: 1000,
      timeoutMs: 15_000,
    },
    validation: {
      minPassRate: 0.8,
      crossValidate: false,
      storeResults: false,
    },
    ipfs: {
      gateway: 'http://localhost:8080/ipfs/',
    },
    persistence: {
      enabled: true,
      databasePath: 'shadow-atlas-dev.db',
      autoMigrate: true,
    },
  });

  await service.initialize();
  return service;
}

/**
 * Create ShadowAtlasService with testing configuration
 *
 * Testing defaults:
 * - No concurrency (sequential for determinism)
 * - No retries (fast failures)
 * - Minimal validation
 * - In-memory only (no persistence)
 *
 * @returns Test-configured ShadowAtlasService
 */
export function createTestService(): ShadowAtlasService {
  return createShadowAtlasService({
    storageDir: ':memory:',
    extraction: {
      concurrency: 1,
      retryAttempts: 0,
      retryDelayMs: 0,
      timeoutMs: 5_000,
    },
    validation: {
      minPassRate: 0.5,
      crossValidate: false,
      storeResults: false,
    },
    persistence: {
      enabled: false, // In-memory for tests
      databasePath: 'test.db',
      autoMigrate: false,
    },
  });
}

/**
 * Create ShadowAtlasService with SQLite persistence enabled for integration tests
 *
 * @param dbPath - Path to the test database file
 * @returns ShadowAtlasService with persistence
 */
export async function createPersistentTestService(
  dbPath: string
): Promise<ShadowAtlasService> {
  const service = createShadowAtlasService({
    storageDir: '.',
    extraction: {
      concurrency: 1,
      retryAttempts: 0,
      retryDelayMs: 0,
      timeoutMs: 5_000,
    },
    validation: {
      minPassRate: 0.5,
      crossValidate: false,
      storeResults: true,
    },
    persistence: {
      enabled: true,
      databasePath: dbPath,
      autoMigrate: true,
    },
  });

  await service.initialize();
  return service;
}
