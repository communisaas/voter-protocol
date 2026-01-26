/**
 * Shadow Atlas CLI Configuration Management
 *
 * Loads configuration from .shadow-atlasrc (YAML) with environment variable
 * overrides and sensible defaults. Provides typed configuration interface
 * for all CLI operations.
 *
 * Configuration precedence (highest to lowest):
 * 1. Command-line options
 * 2. Environment variables (SHADOW_ATLAS_*)
 * 3. Config file (.shadow-atlasrc or --config path)
 * 4. Default values
 *
 * @module cli/lib/config
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Registry names
 */
export type RegistryName = 'known-portals' | 'quarantined' | 'at-large';

/**
 * Validation tier levels
 */
export type ValidationTier = 'structure' | 'sanity' | 'full';

/**
 * Coverage set for validation
 */
export type CoverageSet = 'top50' | 'top100' | 'all';

/**
 * External service configuration
 */
export interface ServiceConfig {
  readonly baseUrl: string;
  readonly vintage?: number;
  readonly timeout?: number;
}

/**
 * Paths configuration
 */
export interface PathsConfig {
  /** Directory containing NDJSON registry data */
  readonly data: string;
  /** Directory for generated TypeScript files */
  readonly generated: string;
  /** Cache directory for downloads */
  readonly cache: string;
  /** Audit log directory */
  readonly audit: string;
  /** Migrations directory */
  readonly migrations: string;
  /** Snapshots directory */
  readonly snapshots: string;
}

/**
 * Default operation settings
 */
export interface DefaultsConfig {
  /** Operation timeout in milliseconds */
  readonly timeout: number;
  /** Maximum concurrent operations */
  readonly concurrency: number;
  /** Default validation settings */
  readonly validation: {
    readonly tier: ValidationTier;
    readonly coverage: CoverageSet;
  };
}

/**
 * Audit configuration
 */
export interface AuditConfig {
  /** Enable audit logging */
  readonly enabled: boolean;
  /** Audit log retention in days */
  readonly retentionDays: number;
  /** Audit log file name */
  readonly fileName: string;
}

/**
 * Services configuration
 */
export interface ServicesConfig {
  readonly tiger: ServiceConfig;
  readonly arcgis: ServiceConfig;
}

/**
 * Full CLI configuration
 */
export interface CLIConfig {
  /** Configuration file version */
  readonly version: number;

  /** Path configuration */
  readonly paths: PathsConfig;

  /** Default settings */
  readonly defaults: DefaultsConfig;

  /** External services */
  readonly services: ServicesConfig;

  /** Audit settings */
  readonly audit: AuditConfig;

  // Runtime overrides (from CLI flags)
  /** Enable verbose output */
  readonly verbose: boolean;
  /** Output as JSON */
  readonly json: boolean;
  /** Dry run mode */
  readonly dryRun: boolean;
  /** Disable audit logging for this run */
  readonly noAudit: boolean;
  /** Override timeout */
  readonly timeout: number;
  /** Override concurrency */
  readonly concurrency: number;
  /** Resolved config file path */
  readonly configPath: string | null;
}

/**
 * Config file structure (YAML)
 */
interface ConfigFileSchema {
  version?: number;
  paths?: Partial<PathsConfig>;
  defaults?: {
    timeout?: number;
    concurrency?: number;
    validation?: {
      tier?: ValidationTier;
      coverage?: CoverageSet;
    };
  };
  services?: {
    tiger?: Partial<ServiceConfig>;
    arcgis?: Partial<ServiceConfig>;
  };
  audit?: {
    enabled?: boolean;
    retention_days?: number;
    file_name?: string;
  };
}

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Omit<
  CLIConfig,
  'verbose' | 'json' | 'dryRun' | 'noAudit' | 'timeout' | 'concurrency' | 'configPath'
> = {
  version: 1,

  paths: {
    data: './data/registries',
    generated: './src/core/registry',
    cache: './data/cache',
    audit: './data/audit',
    migrations: './data/migrations',
    snapshots: './data/snapshots',
  },

  defaults: {
    timeout: 30000,
    concurrency: 5,
    validation: {
      tier: 'full',
      coverage: 'top50',
    },
  },

  services: {
    tiger: {
      baseUrl: 'https://tigerweb.geo.census.gov/arcgis/rest/services',
      vintage: 2024,
      timeout: 60000,
    },
    arcgis: {
      baseUrl: 'https://www.arcgis.com',
      timeout: 30000,
    },
  },

  audit: {
    enabled: true,
    retentionDays: 365,
    fileName: 'audit.ndjson',
  },
};

// ============================================================================
// Configuration Loading
// ============================================================================

/**
 * Standard config file names to search for
 */
const CONFIG_FILE_NAMES = [
  '.shadow-atlasrc',
  '.shadow-atlasrc.yaml',
  '.shadow-atlasrc.yml',
  '.shadow-atlasrc.json',
];

/**
 * Find config file in current directory or parent directories
 */
function findConfigFile(startDir: string): string | null {
  let dir = resolve(startDir);
  const root = resolve('/');

  while (dir !== root) {
    for (const fileName of CONFIG_FILE_NAMES) {
      const filePath = join(dir, fileName);
      if (existsSync(filePath)) {
        return filePath;
      }
    }
    dir = resolve(dir, '..');
  }

  return null;
}

/**
 * Parse config file content
 */
function parseConfigFile(filePath: string): ConfigFileSchema {
  const content = readFileSync(filePath, 'utf-8');

  if (filePath.endsWith('.json')) {
    return JSON.parse(content) as ConfigFileSchema;
  }

  // Parse as YAML (also handles plain JSON)
  return parseYaml(content) as ConfigFileSchema;
}

/**
 * Get environment variable with prefix
 */
function getEnvVar(name: string): string | undefined {
  return process.env[`SHADOW_ATLAS_${name}`];
}

/**
 * Get boolean environment variable
 */
function getEnvBool(name: string): boolean | undefined {
  const value = getEnvVar(name);
  if (value === undefined) return undefined;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Get numeric environment variable
 */
function getEnvNumber(name: string): number | undefined {
  const value = getEnvVar(name);
  if (value === undefined) return undefined;
  const num = parseInt(value, 10);
  return isNaN(num) ? undefined : num;
}

/**
 * Load configuration options
 */
export interface LoadConfigOptions {
  /** Explicit config file path */
  configPath?: string;
  /** CLI flag overrides */
  overrides?: {
    verbose?: boolean;
    json?: boolean;
    dryRun?: boolean;
    noAudit?: boolean;
    timeout?: number;
    concurrency?: number;
  };
}

/**
 * Load and merge configuration from all sources
 *
 * @param options - Configuration loading options
 * @returns Merged configuration
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<CLIConfig> {
  // Find config file
  let configPath: string | null = null;
  let fileConfig: ConfigFileSchema = {};

  if (options.configPath) {
    // Explicit config path provided
    configPath = resolve(options.configPath);
    if (!existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }
    fileConfig = parseConfigFile(configPath);
  } else {
    // Search for config file
    const envConfigPath = getEnvVar('CONFIG');
    if (envConfigPath) {
      configPath = resolve(envConfigPath);
      if (existsSync(configPath)) {
        fileConfig = parseConfigFile(configPath);
      }
    } else {
      configPath = findConfigFile(process.cwd());
      if (configPath) {
        fileConfig = parseConfigFile(configPath);
      }
    }
  }

  // Merge configuration layers
  const config: CLIConfig = {
    version: fileConfig.version ?? DEFAULT_CONFIG.version,

    paths: {
      data: fileConfig.paths?.data ?? getEnvVar('DATA_DIR') ?? DEFAULT_CONFIG.paths.data,
      generated:
        fileConfig.paths?.generated ??
        getEnvVar('GENERATED_DIR') ??
        DEFAULT_CONFIG.paths.generated,
      cache:
        fileConfig.paths?.cache ?? getEnvVar('CACHE_DIR') ?? DEFAULT_CONFIG.paths.cache,
      audit:
        fileConfig.paths?.audit ?? getEnvVar('AUDIT_DIR') ?? DEFAULT_CONFIG.paths.audit,
      migrations:
        fileConfig.paths?.migrations ??
        getEnvVar('MIGRATIONS_DIR') ??
        DEFAULT_CONFIG.paths.migrations,
      snapshots:
        fileConfig.paths?.snapshots ??
        getEnvVar('SNAPSHOTS_DIR') ??
        DEFAULT_CONFIG.paths.snapshots,
    },

    defaults: {
      timeout:
        options.overrides?.timeout ??
        getEnvNumber('TIMEOUT') ??
        fileConfig.defaults?.timeout ??
        DEFAULT_CONFIG.defaults.timeout,
      concurrency:
        options.overrides?.concurrency ??
        getEnvNumber('CONCURRENCY') ??
        fileConfig.defaults?.concurrency ??
        DEFAULT_CONFIG.defaults.concurrency,
      validation: {
        tier:
          (fileConfig.defaults?.validation?.tier as ValidationTier) ??
          DEFAULT_CONFIG.defaults.validation.tier,
        coverage:
          (fileConfig.defaults?.validation?.coverage as CoverageSet) ??
          DEFAULT_CONFIG.defaults.validation.coverage,
      },
    },

    services: {
      tiger: {
        baseUrl:
          fileConfig.services?.tiger?.baseUrl ?? DEFAULT_CONFIG.services.tiger.baseUrl,
        vintage:
          fileConfig.services?.tiger?.vintage ?? DEFAULT_CONFIG.services.tiger.vintage,
        timeout:
          fileConfig.services?.tiger?.timeout ?? DEFAULT_CONFIG.services.tiger.timeout,
      },
      arcgis: {
        baseUrl:
          fileConfig.services?.arcgis?.baseUrl ?? DEFAULT_CONFIG.services.arcgis.baseUrl,
        timeout:
          fileConfig.services?.arcgis?.timeout ?? DEFAULT_CONFIG.services.arcgis.timeout,
      },
    },

    audit: {
      enabled:
        options.overrides?.noAudit !== undefined
          ? !options.overrides.noAudit
          : getEnvBool('NO_AUDIT') !== undefined
            ? !getEnvBool('NO_AUDIT')
            : fileConfig.audit?.enabled ?? DEFAULT_CONFIG.audit.enabled,
      retentionDays:
        fileConfig.audit?.retention_days ?? DEFAULT_CONFIG.audit.retentionDays,
      fileName: fileConfig.audit?.file_name ?? DEFAULT_CONFIG.audit.fileName,
    },

    // Runtime flags
    verbose:
      options.overrides?.verbose ?? getEnvBool('VERBOSE') ?? false,
    json: options.overrides?.json ?? getEnvBool('JSON') ?? false,
    dryRun: options.overrides?.dryRun ?? getEnvBool('DRY_RUN') ?? false,
    noAudit: options.overrides?.noAudit ?? getEnvBool('NO_AUDIT') ?? false,
    timeout:
      options.overrides?.timeout ??
      getEnvNumber('TIMEOUT') ??
      fileConfig.defaults?.timeout ??
      DEFAULT_CONFIG.defaults.timeout,
    concurrency:
      options.overrides?.concurrency ??
      getEnvNumber('CONCURRENCY') ??
      fileConfig.defaults?.concurrency ??
      DEFAULT_CONFIG.defaults.concurrency,
    configPath,
  };

  return config;
}

/**
 * Resolve a path relative to the package root
 *
 * @param config - CLI configuration
 * @param pathKey - Path key from config
 * @returns Resolved absolute path
 */
export function resolvePath(
  config: CLIConfig,
  pathKey: keyof PathsConfig
): string {
  const basePath = config.configPath
    ? resolve(config.configPath, '..')
    : process.cwd();
  return resolve(basePath, config.paths[pathKey]);
}

/**
 * Get audit log file path
 *
 * @param config - CLI configuration
 * @returns Absolute path to audit log file
 */
export function getAuditLogPath(config: CLIConfig): string {
  return join(resolvePath(config, 'audit'), config.audit.fileName);
}

/**
 * Validate configuration
 *
 * @param config - Configuration to validate
 * @throws Error if configuration is invalid
 */
export function validateConfig(config: CLIConfig): void {
  // Validate version
  if (config.version !== 1) {
    throw new Error(`Unsupported config version: ${config.version}. Expected 1.`);
  }

  // Validate timeout
  if (config.timeout <= 0) {
    throw new Error('Timeout must be a positive number');
  }

  // Validate concurrency
  if (config.concurrency <= 0 || config.concurrency > 100) {
    throw new Error('Concurrency must be between 1 and 100');
  }

  // Validate validation tier
  const validTiers: ValidationTier[] = ['structure', 'sanity', 'full'];
  if (!validTiers.includes(config.defaults.validation.tier)) {
    throw new Error(
      `Invalid validation tier: ${config.defaults.validation.tier}. Must be one of: ${validTiers.join(', ')}`
    );
  }

  // Validate coverage set
  const validCoverage: CoverageSet[] = ['top50', 'top100', 'all'];
  if (!validCoverage.includes(config.defaults.validation.coverage)) {
    throw new Error(
      `Invalid coverage set: ${config.defaults.validation.coverage}. Must be one of: ${validCoverage.join(', ')}`
    );
  }
}
