/**
 * Shadow Atlas Service Configuration
 *
 * Default configuration for the ShadowAtlasService unified facade.
 * Provides sensible defaults for extraction, validation, and commitment operations.
 *
 * TYPE SAFETY: All configuration is strongly typed and immutable.
 */

// ============================================================================
// IPFS Credentials Types
// ============================================================================

/**
 * IPFS service credentials
 *
 * Loaded from environment variables at runtime.
 * NEVER hardcode credentials in source code.
 */
export interface IPFSCredentials {
  readonly storacha?: {
    readonly spaceDid?: string;
    readonly agentPrivateKey?: string;
  };
  readonly pinata?: {
    readonly jwt?: string;
    readonly apiKey?: string;
    readonly apiSecret?: string;
  };
  readonly fleek?: {
    readonly apiKey?: string;
    readonly apiSecret?: string;
  };
}

/**
 * Get IPFS credentials from environment variables
 *
 * Reads credentials at runtime from process.env.
 * Returns undefined for services without configured credentials.
 *
 * Environment variables:
 * - STORACHA_SPACE_DID, STORACHA_AGENT_KEY
 * - PINATA_JWT or PINATA_API_KEY + PINATA_API_SECRET
 * - FLEEK_API_KEY, FLEEK_API_SECRET
 *
 * @returns IPFS credentials object
 */
export function getIPFSCredentials(): IPFSCredentials {
  return {
    storacha: {
      spaceDid: process.env.STORACHA_SPACE_DID,
      agentPrivateKey: process.env.STORACHA_AGENT_KEY,
    },
    pinata: {
      jwt: process.env.PINATA_JWT,
      apiKey: process.env.PINATA_API_KEY,
      apiSecret: process.env.PINATA_API_SECRET,
    },
    fleek: {
      apiKey: process.env.FLEEK_API_KEY,
      apiSecret: process.env.FLEEK_API_SECRET,
    },
  };
}

// ============================================================================
// Shadow Atlas Service Configuration
// ============================================================================

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
    /**
     * Halt processing if topology validation fails (self-intersections, invalid polygons).
     * CRITICAL: Self-intersecting polygons break ZK proof generation.
     * Default: true (halt on topology errors)
     */
    readonly haltOnTopologyError: boolean;
    /**
     * Halt processing if completeness validation fails (missing districts below threshold).
     * CRITICAL: Missing districts create coverage gaps that invalidate proofs.
     * Default: true (halt on completeness errors)
     */
    readonly haltOnCompletenessError: boolean;
    /**
     * Halt processing if coordinate validation fails (invalid lat/lng values).
     * CRITICAL: Invalid coordinates produce incorrect Merkle tree commitments.
     * Default: true (halt on coordinate errors)
     */
    readonly haltOnCoordinateError: boolean;
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

  /** Change detection configuration (optional) */
  readonly changeDetection?: {
    /** Enable change detection before builds */
    readonly enabled: boolean;
    /** Path to checksum cache file (relative to storageDir) */
    readonly checksumCachePath?: string;
    /** Skip downloading unchanged layers during build */
    readonly skipUnchanged?: boolean;
  };

  /** Global tree configuration (optional) */
  readonly globalTree?: {
    /** Enable global hierarchical Merkle tree */
    readonly enabled: boolean;
    /** ISO 3166-1 alpha-2 country codes to include */
    readonly countries: readonly string[];
    /** Generate proofs during build (slower but enables immediate verification) */
    readonly includeProofs?: boolean;
  };

  /** Cross-validation configuration */
  readonly crossValidation: {
    /** Enable cross-validation of TIGER vs State GIS portal boundaries */
    readonly enabled: boolean;
    /** FIPS codes of states to cross-validate (default: all available) */
    readonly states?: readonly string[];
    /** Fail build if cross-validation quality score below threshold */
    readonly failOnMismatch: boolean;
    /** Minimum quality score required (0-100, default: 70) */
    readonly minQualityScore: number;
    /** Continue build gracefully when state GIS sources are unavailable (default: true) */
    readonly gracefulFallback: boolean;
  };

  /** School district validation configuration (optional) */
  readonly schoolDistrictValidation?: {
    /** Enable school district validation during buildAtlas for unsd/elsd/scsd layers */
    readonly enabled: boolean;
    /** Check for forbidden overlaps between unified and elementary/secondary districts */
    readonly checkOverlaps?: boolean;
    /** Verify complete coverage of state territory by school districts */
    readonly checkCoverage?: boolean;
    /** Fail build if forbidden overlaps are detected (default: false = warn only) */
    readonly failOnOverlap?: boolean;
  };

  /** IPFS distribution configuration (optional) */
  readonly ipfsDistribution?: {
    /** Enable IPFS distribution */
    readonly enabled: boolean;
    /** Geographic regions to pin to */
    readonly regions: readonly ('americas-east' | 'americas-west' | 'europe-west' | 'asia-east')[];
    /** Pinning services to use */
    readonly services: readonly ('storacha' | 'pinata' | 'fleek')[];
    /** Publish to IPFS automatically after successful build */
    readonly publishOnBuild: boolean;
    /** Maximum parallel uploads per region */
    readonly maxParallelUploads?: number;
    /** Retry attempts for failed uploads */
    readonly retryAttempts?: number;
  };

  /** Batch ingestion configuration for multi-state, multi-layer downloads (optional) */
  readonly batchIngestion?: {
    /** Enable batch ingestion orchestration */
    readonly enabled: boolean;
    /** Directory for checkpoint files (relative to storageDir, default: 'checkpoints') */
    readonly checkpointDir: string;
    /** Maximum concurrent state downloads (default: 5) */
    readonly maxConcurrentStates: number;
    /** Consecutive failures before circuit breaker trips (default: 5) */
    readonly circuitBreakerThreshold: number;
    /** Attempt to resume from last checkpoint on restart (default: true) */
    readonly resumeOnRestart: boolean;
    /** Maximum retry attempts per state (default: 3) */
    readonly maxRetryAttempts?: number;
    /** Initial retry delay in milliseconds (default: 1000) */
    readonly retryDelayMs?: number;
    /** Retry delay multiplier for exponential backoff (default: 2) */
    readonly retryBackoffMultiplier?: number;
  };

  /** TIGER cache configuration (optional) */
  readonly tigerCache?: {
    /**
     * Auto-expire cache based on TIGER release schedule (default: true)
     *
     * TIGER data is released annually on September 1st. When enabled, cached files
     * are automatically treated as stale after the grace period following the next
     * TIGER release date. Stale files trigger fresh downloads instead of using cache.
     *
     * Example: Cache from 2024 expires October 1, 2025 (30 days after Sept 1 release)
     */
    readonly autoExpire?: boolean;

    /**
     * Days after September 1st release before expiring old cache (default: 30)
     *
     * Grace period allows time for TIGER data to stabilize and become fully available
     * across all FTP mirrors. Recommended: 30-60 days for production systems.
     */
    readonly gracePeriodDays?: number;
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
    haltOnTopologyError: true,
    haltOnCompletenessError: true,
    haltOnCoordinateError: true,
  },
  ipfs: {
    gateway: 'https://ipfs.io/ipfs/',
  },
  persistence: {
    enabled: false,
    databasePath: 'shadow-atlas.db',
    autoMigrate: true,
  },
  changeDetection: {
    enabled: false,
    skipUnchanged: true,
  },
  crossValidation: {
    enabled: true,
    failOnMismatch: false,
    minQualityScore: 70,
    gracefulFallback: true,
  },
};

/**
 * Deep partial type for nested configuration objects
 * Allows partial specification at any nesting level
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Create custom configuration by merging with defaults
 *
 * @param overrides - Partial configuration to override defaults (supports deep partial)
 * @returns Full configuration with overrides applied
 */
export function createConfig(
  overrides: DeepPartial<ShadowAtlasConfig> = {}
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
    changeDetection: overrides.changeDetection
      ? {
          ...DEFAULT_CONFIG.changeDetection,
          ...overrides.changeDetection,
        }
      : DEFAULT_CONFIG.changeDetection,
    globalTree: overrides.globalTree
      ? {
          ...overrides.globalTree,
        }
      : undefined,
    crossValidation: {
      ...DEFAULT_CONFIG.crossValidation,
      ...overrides.crossValidation,
    },
    schoolDistrictValidation: overrides.schoolDistrictValidation
      ? {
          ...overrides.schoolDistrictValidation,
        }
      : undefined,
    ipfsDistribution: overrides.ipfsDistribution
      ? {
          ...overrides.ipfsDistribution,
        }
      : undefined,
    batchIngestion: overrides.batchIngestion
      ? {
          ...overrides.batchIngestion,
        }
      : undefined,
    tigerCache: overrides.tigerCache
      ? {
          ...overrides.tigerCache,
        }
      : undefined,
  };
}
