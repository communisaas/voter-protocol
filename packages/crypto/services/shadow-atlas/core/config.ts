/**
 * Shadow Atlas Service Configuration
 *
 * Default configuration for the ShadowAtlasService unified facade.
 * Provides sensible defaults for extraction, validation, and commitment operations.
 *
 * TYPE SAFETY: All configuration is strongly typed and immutable.
 */

/**
 * Shadow Atlas Service Configuration
 */
export interface ShadowAtlasConfig {
  /** Storage directory for job state and results */
  readonly storageDir: string;

  /** Default extraction options */
  readonly extraction: {
    readonly concurrency: number;
    readonly retryAttempts: number;
    readonly retryDelayMs: number;
    readonly timeoutMs: number;
  };

  /** Default validation options */
  readonly validation: {
    readonly minPassRate: number;
    readonly crossValidate: boolean;
    readonly storeResults: boolean;
  };

  /** IPFS configuration */
  readonly ipfs: {
    readonly gateway: string;
    readonly pinService?: string;
  };

  /** Persistence configuration */
  readonly persistence: {
    /** Enable SQLite persistence (default: false for in-memory) */
    readonly enabled: boolean;
    /** Path to SQLite database file (relative to storageDir) */
    readonly databasePath: string;
    /** Run migrations on startup (default: true) */
    readonly autoMigrate: boolean;
  };
}

/**
 * Default configuration
 *
 * Production-ready defaults:
 * - 5 concurrent extractions (balance between speed and rate limiting)
 * - 3 retry attempts with exponential backoff
 * - 30-second timeout per extraction
 * - 90% validation pass rate required for commitment
 * - Cross-validation enabled for accuracy
 * - IPFS gateway for merkle tree publishing
 */
export const DEFAULT_CONFIG: ShadowAtlasConfig = {
  storageDir: '.shadow-atlas',
  extraction: {
    concurrency: 5,
    retryAttempts: 3,
    retryDelayMs: 2000,
    timeoutMs: 30_000,
  },
  validation: {
    minPassRate: 0.9,
    crossValidate: true,
    storeResults: true,
  },
  ipfs: {
    gateway: 'https://ipfs.io/ipfs/',
  },
  persistence: {
    enabled: false,
    databasePath: 'shadow-atlas.db',
    autoMigrate: true,
  },
};

/**
 * Create custom configuration by merging with defaults
 *
 * @param overrides - Partial configuration to override defaults
 * @returns Full configuration with overrides applied
 */
export function createConfig(
  overrides: Partial<ShadowAtlasConfig> = {}
): ShadowAtlasConfig {
  return {
    storageDir: overrides.storageDir ?? DEFAULT_CONFIG.storageDir,
    extraction: {
      ...DEFAULT_CONFIG.extraction,
      ...overrides.extraction,
    },
    validation: {
      ...DEFAULT_CONFIG.validation,
      ...overrides.validation,
    },
    ipfs: {
      ...DEFAULT_CONFIG.ipfs,
      ...overrides.ipfs,
    },
    persistence: {
      ...DEFAULT_CONFIG.persistence,
      ...overrides.persistence,
    },
  };
}
