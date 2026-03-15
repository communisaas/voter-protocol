/**
 * Freshness Monitor — reports how stale each country's ingested data is.
 *
 * Reads the ingestion_log table (populated by db-writer.ts on each hydration)
 * and compares the most recent successful run_at timestamp against configurable
 * warn/critical thresholds.
 *
 * @see ../db/officials-schema.sql — ingestion_log DDL
 * @see ./db-writer.ts — writes ingestion_log rows
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';

// ============================================================================
// Types & Config
// ============================================================================

export interface FreshnessConfig {
  warnAfterDays: number;
  criticalAfterDays: number;
}

export const DEFAULT_FRESHNESS_THRESHOLDS: Record<string, FreshnessConfig> = {
  US: { warnAfterDays: 30, criticalAfterDays: 90 },
  CA: { warnAfterDays: 30, criticalAfterDays: 90 },
  GB: { warnAfterDays: 30, criticalAfterDays: 90 },
  AU: { warnAfterDays: 30, criticalAfterDays: 90 },
  NZ: { warnAfterDays: 30, criticalAfterDays: 90 },
};

/** Reverse map: ingestion source name -> country code */
const SOURCE_TO_COUNTRY: Record<string, string> = {
  'congress-legislators': 'US',
  'canada-mps': 'CA',
  'uk-mps': 'GB',
  'au-mps': 'AU',
  'nz-mps': 'NZ',
};

/** Forward map: country code -> ingestion source name */
const COUNTRY_TO_SOURCE: Record<string, string> = {
  US: 'congress-legislators',
  CA: 'canada-mps',
  GB: 'uk-mps',
  AU: 'au-mps',
  NZ: 'nz-mps',
};

export type FreshnessStatus = 'fresh' | 'stale-warn' | 'stale-critical' | 'never-ingested';

export interface FreshnessReport {
  country: string;
  source: string;
  lastIngestion: Date | null;
  ageInDays: number | null;
  /** When the upstream source data was last updated (from provider metadata). */
  sourceVintage: Date | null;
  status: FreshnessStatus;
  message: string;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Check freshness for all tracked countries.
 *
 * Opens the DB read-only, queries ingestion_log for the most recent successful
 * run per source, and compares against thresholds.
 */
export function checkFreshness(
  dbPath: string,
  thresholds?: Record<string, FreshnessConfig>,
): FreshnessReport[] {
  const effectiveThresholds = thresholds ?? DEFAULT_FRESHNESS_THRESHOLDS;
  const countries = Object.keys(effectiveThresholds);

  // If the DB doesn't exist, return all as never-ingested
  if (!existsSync(dbPath)) {
    return countries.map((country) => ({
      country,
      source: COUNTRY_TO_SOURCE[country] ?? `${country.toLowerCase()}-officials`,
      lastIngestion: null,
      ageInDays: null,
      sourceVintage: null,
      status: 'never-ingested' as const,
      message: `No database found at ${dbPath}`,
    }));
  }

  let db: InstanceType<typeof Database>;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    return countries.map((country) => ({
      country,
      source: COUNTRY_TO_SOURCE[country] ?? `${country.toLowerCase()}-officials`,
      lastIngestion: null,
      ageInDays: null,
      sourceVintage: null,
      status: 'never-ingested' as const,
      message: `Failed to open database at ${dbPath}`,
    }));
  }

  try {
    const lastSuccessMap = queryLastSuccessPerSource(db);

    return countries.map((country) => {
      const source = COUNTRY_TO_SOURCE[country] ?? `${country.toLowerCase()}-officials`;
      const threshold = effectiveThresholds[country];
      return buildReport(country, source, lastSuccessMap.get(source) ?? null, threshold);
    });
  } finally {
    db.close();
  }
}

/**
 * Check freshness for a single country.
 */
export function checkCountryFreshness(
  dbPath: string,
  country: string,
  threshold?: FreshnessConfig,
): FreshnessReport {
  const effectiveThreshold = threshold ?? DEFAULT_FRESHNESS_THRESHOLDS[country] ?? {
    warnAfterDays: 30,
    criticalAfterDays: 90,
  };
  const source = COUNTRY_TO_SOURCE[country] ?? `${country.toLowerCase()}-officials`;

  if (!existsSync(dbPath)) {
    return {
      country,
      source,
      lastIngestion: null,
      ageInDays: null,
      sourceVintage: null,
      status: 'never-ingested',
      message: `No database found at ${dbPath}`,
    };
  }

  let db: InstanceType<typeof Database>;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    return {
      country,
      source,
      lastIngestion: null,
      ageInDays: null,
      sourceVintage: null,
      status: 'never-ingested',
      message: `Failed to open database at ${dbPath}`,
    };
  }

  try {
    const lastSuccessMap = queryLastSuccessPerSource(db);
    return buildReport(country, source, lastSuccessMap.get(source) ?? null, effectiveThreshold);
  } finally {
    db.close();
  }
}

// ============================================================================
// Internals
// ============================================================================

interface IngestionRow {
  source: string;
  last_success: string;
  source_vintage: string | null;
}

interface IngestionRecord {
  lastSuccess: string;
  sourceVintage: string | null;
}

/**
 * Query ingestion_log for the most recent successful run per source.
 * Returns a Map<sourceName, { lastSuccess, sourceVintage }>.
 */
function queryLastSuccessPerSource(db: InstanceType<typeof Database>): Map<string, IngestionRecord> {
  const map = new Map<string, IngestionRecord>();

  // Check if the table exists before querying
  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='ingestion_log'"
  ).get();

  if (!tableExists) {
    return map;
  }

  // Check if source_vintage column exists (backward compat with older DBs)
  const hasVintageColumn = (db.prepare(
    "SELECT COUNT(*) as cnt FROM pragma_table_info('ingestion_log') WHERE name='source_vintage'"
  ).get() as { cnt: number })?.cnt > 0;

  const query = hasVintageColumn
    ? `SELECT source, MAX(run_at) as last_success, source_vintage
       FROM ingestion_log
       WHERE status = 'success'
       GROUP BY source`
    : `SELECT source, MAX(run_at) as last_success, NULL as source_vintage
       FROM ingestion_log
       WHERE status = 'success'
       GROUP BY source`;

  const rows = db.prepare(query).all() as IngestionRow[];

  for (const row of rows) {
    if (SOURCE_TO_COUNTRY[row.source]) {
      map.set(row.source, {
        lastSuccess: row.last_success,
        sourceVintage: row.source_vintage,
      });
    }
  }

  return map;
}

function buildReport(
  country: string,
  source: string,
  record: IngestionRecord | null,
  threshold: FreshnessConfig,
): FreshnessReport {
  if (!record) {
    return {
      country,
      source,
      lastIngestion: null,
      ageInDays: null,
      sourceVintage: null,
      status: 'never-ingested',
      message: `${country} has never been ingested`,
    };
  }

  const lastDate = new Date(record.lastSuccess);
  const sourceVintage = record.sourceVintage ? new Date(record.sourceVintage) : null;
  const now = new Date();
  const ageMs = now.getTime() - lastDate.getTime();
  const ageInDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

  let status: FreshnessStatus;
  let message: string;

  if (ageInDays >= threshold.criticalAfterDays) {
    status = 'stale-critical';
    message = `${country} data is ${ageInDays}d old (critical threshold: ${threshold.criticalAfterDays}d)`;
  } else if (ageInDays >= threshold.warnAfterDays) {
    status = 'stale-warn';
    message = `${country} data is ${ageInDays}d old (warn threshold: ${threshold.warnAfterDays}d)`;
  } else {
    status = 'fresh';
    message = `${country} data is ${ageInDays}d old`;
  }

  if (sourceVintage) {
    message += `, source vintage: ${sourceVintage.toISOString().split('T')[0]}`;
  }

  return { country, source, lastIngestion: lastDate, ageInDays, sourceVintage, status, message };
}
