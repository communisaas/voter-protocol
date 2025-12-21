/**
 * Shadow Atlas Metrics - Lightweight Observability
 *
 * Pre-launch philosophy: No external infrastructure.
 * Use SQLite for metrics storage, structured logging for events.
 *
 * WHAT WE TRACK:
 * - Extraction outcomes (success/failure by state/layer)
 * - Provider health (latency, availability)
 * - Data quality (boundary counts, validation rates)
 * - Job performance (duration percentiles)
 *
 * WHAT WE DON'T NEED YET:
 * - Real-time dashboards (query SQLite when needed)
 * - Prometheus/Grafana (infrastructure overhead)
 * - APM tools (premature optimization)
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import Database from 'better-sqlite3';
import { join } from 'path';

// ============================================================================
// Metric Types
// ============================================================================

/**
 * Metric types we track
 */
export type MetricType =
  | 'extraction_success'
  | 'extraction_failure'
  | 'provider_latency'
  | 'provider_error'
  | 'validation_pass'
  | 'validation_fail'
  | 'job_duration'
  | 'boundary_count'
  | 'health_check'
  | 'request_count'        // HTTP request counter
  | 'request_latency'      // HTTP request latency histogram
  | 'request_error'        // HTTP request errors
  | 'cache_hit'            // Cache hit
  | 'cache_miss'           // Cache miss
  | 'proof_generation'     // ZK proof generation latency
  | 'merkle_proof'         // Merkle proof generation latency
  | 'db_query'             // Database query latency
  | 'active_connections';  // Active HTTP connections gauge

/**
 * Metric entry
 */
export interface MetricEntry {
  readonly type: MetricType;
  readonly value: number;
  readonly labels: Record<string, string>;
  readonly timestamp: Date;
}

/**
 * Aggregated metric for reporting
 */
export interface AggregatedMetric {
  readonly type: MetricType;
  readonly count: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
  readonly avg: number;
  readonly labels: Record<string, string>;
  readonly period: {
    readonly start: Date;
    readonly end: Date;
  };
}

/**
 * Health summary for alerting
 */
export interface HealthSummary {
  readonly healthy: boolean;
  readonly extractionSuccessRate: number;
  readonly validationPassRate: number;
  readonly providerAvailability: Record<string, boolean>;
  readonly avgJobDurationMs: number;
  readonly lastCheckAt: Date;
  readonly issues: readonly string[];
}

// ============================================================================
// Metrics Store
// ============================================================================

/**
 * Lightweight metrics store using SQLite
 *
 * Pre-launch appropriate: No external dependencies, queryable history,
 * automatic cleanup of old data.
 */
export class MetricsStore {
  private readonly db: Database.Database;
  private readonly retentionDays: number;

  constructor(dbPath: string, retentionDays = 30) {
    this.db = new Database(dbPath);
    this.retentionDays = retentionDays;
    this.initialize();
  }

  /**
   * Initialize schema
   */
  private initialize(): void {
    this.db.exec(`
      -- Metrics table (append-only)
      CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        value REAL NOT NULL,
        labels_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_metrics_type_time
        ON metrics(type, recorded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_metrics_time
        ON metrics(recorded_at DESC);

      -- Alerts table (for tracking alert state)
      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK(status IN ('firing', 'resolved')),
        message TEXT,
        fired_at TEXT NOT NULL,
        resolved_at TEXT,
        acknowledged_at TEXT
      );

      -- Daily summaries (materialized for fast dashboards)
      CREATE TABLE IF NOT EXISTS daily_summaries (
        date TEXT NOT NULL,
        type TEXT NOT NULL,
        labels_json TEXT NOT NULL,
        count INTEGER NOT NULL,
        sum REAL NOT NULL,
        min REAL NOT NULL,
        max REAL NOT NULL,
        PRIMARY KEY (date, type, labels_json)
      );
    `);
  }

  /**
   * Record a metric
   */
  record(entry: Omit<MetricEntry, 'timestamp'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO metrics (type, value, labels_json, recorded_at)
      VALUES (?, ?, ?, datetime('now'))
    `);
    stmt.run(entry.type, entry.value, JSON.stringify(entry.labels));
  }

  /**
   * Record extraction outcome
   */
  recordExtraction(
    state: string,
    layer: string,
    success: boolean,
    durationMs: number,
    boundaryCount?: number
  ): void {
    const labels = { state, layer };

    // Record outcome
    this.record({
      type: success ? 'extraction_success' : 'extraction_failure',
      value: 1,
      labels,
    });

    // Record duration
    this.record({
      type: 'job_duration',
      value: durationMs,
      labels,
    });

    // Record boundary count if provided
    if (boundaryCount !== undefined) {
      this.record({
        type: 'boundary_count',
        value: boundaryCount,
        labels,
      });
    }
  }

  /**
   * Record provider health check
   */
  recordProviderHealth(
    provider: string,
    available: boolean,
    latencyMs: number,
    error?: string
  ): void {
    const labels = { provider };

    this.record({
      type: 'health_check',
      value: available ? 1 : 0,
      labels,
    });

    this.record({
      type: 'provider_latency',
      value: latencyMs,
      labels,
    });

    if (error) {
      this.record({
        type: 'provider_error',
        value: 1,
        labels: { ...labels, error: error.substring(0, 100) },
      });
    }
  }

  /**
   * Record validation result
   */
  recordValidation(
    state: string,
    layer: string,
    passed: boolean,
    confidence: number
  ): void {
    this.record({
      type: passed ? 'validation_pass' : 'validation_fail',
      value: confidence,
      labels: { state, layer },
    });
  }

  /**
   * Record HTTP request
   */
  recordRequest(
    method: string,
    path: string,
    statusCode: number,
    latencyMs: number,
    cacheHit: boolean
  ): void {
    const labels = { method, path, status: statusCode.toString() };

    // Record request count
    this.record({
      type: 'request_count',
      value: 1,
      labels,
    });

    // Record latency
    this.record({
      type: 'request_latency',
      value: latencyMs,
      labels,
    });

    // Record errors (4xx/5xx)
    if (statusCode >= 400) {
      this.record({
        type: 'request_error',
        value: 1,
        labels,
      });
    }

    // Record cache metrics
    this.record({
      type: cacheHit ? 'cache_hit' : 'cache_miss',
      value: 1,
      labels: { path },
    });
  }

  /**
   * Record proof generation latency
   */
  recordProofGeneration(
    proofType: 'zk' | 'merkle',
    latencyMs: number,
    success: boolean
  ): void {
    this.record({
      type: proofType === 'zk' ? 'proof_generation' : 'merkle_proof',
      value: latencyMs,
      labels: { success: success.toString() },
    });
  }

  /**
   * Record database query latency
   */
  recordDbQuery(
    queryType: string,
    latencyMs: number
  ): void {
    this.record({
      type: 'db_query',
      value: latencyMs,
      labels: { queryType },
    });
  }

  /**
   * Update active connections gauge
   */
  updateActiveConnections(count: number): void {
    this.record({
      type: 'active_connections',
      value: count,
      labels: {},
    });
  }

  /**
   * Get aggregated metrics for a time period
   */
  getAggregated(
    type: MetricType,
    hours = 24,
    labels?: Record<string, string>
  ): AggregatedMetric {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    let query = `
      SELECT
        COUNT(*) as count,
        SUM(value) as sum,
        MIN(value) as min,
        MAX(value) as max,
        AVG(value) as avg
      FROM metrics
      WHERE type = ? AND recorded_at >= ?
    `;

    const params: (string | number)[] = [type, cutoff];

    if (labels) {
      for (const [key, value] of Object.entries(labels)) {
        query += ` AND json_extract(labels_json, '$.' || ?) = ?`;
        params.push(key, value);
      }
    }

    const row = this.db.prepare(query).get(...params) as {
      count: number;
      sum: number;
      min: number;
      max: number;
      avg: number;
    };

    return {
      type,
      count: row.count ?? 0,
      sum: row.sum ?? 0,
      min: row.min ?? 0,
      max: row.max ?? 0,
      avg: row.avg ?? 0,
      labels: labels ?? {},
      period: {
        start: new Date(cutoff),
        end: new Date(),
      },
    };
  }

  /**
   * Get health summary for the last N hours
   */
  getHealthSummary(hours = 24): HealthSummary {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const issues: string[] = [];

    // Extraction success rate
    const successCount = this.db
      .prepare(
        `SELECT COUNT(*) as c FROM metrics
         WHERE type = 'extraction_success' AND recorded_at >= ?`
      )
      .get(cutoff) as { c: number };

    const failureCount = this.db
      .prepare(
        `SELECT COUNT(*) as c FROM metrics
         WHERE type = 'extraction_failure' AND recorded_at >= ?`
      )
      .get(cutoff) as { c: number };

    const totalExtractions = successCount.c + failureCount.c;
    const extractionSuccessRate =
      totalExtractions > 0 ? successCount.c / totalExtractions : 1;

    if (extractionSuccessRate < 0.9) {
      issues.push(
        `Extraction success rate ${(extractionSuccessRate * 100).toFixed(1)}% (target: 90%)`
      );
    }

    // Validation pass rate
    const passCount = this.db
      .prepare(
        `SELECT COUNT(*) as c FROM metrics
         WHERE type = 'validation_pass' AND recorded_at >= ?`
      )
      .get(cutoff) as { c: number };

    const failCount = this.db
      .prepare(
        `SELECT COUNT(*) as c FROM metrics
         WHERE type = 'validation_fail' AND recorded_at >= ?`
      )
      .get(cutoff) as { c: number };

    const totalValidations = passCount.c + failCount.c;
    const validationPassRate =
      totalValidations > 0 ? passCount.c / totalValidations : 1;

    if (validationPassRate < 0.9) {
      issues.push(
        `Validation pass rate ${(validationPassRate * 100).toFixed(1)}% (target: 90%)`
      );
    }

    // Provider availability
    const providerHealth = this.db
      .prepare(
        `
        SELECT
          json_extract(labels_json, '$.provider') as provider,
          AVG(value) as availability
        FROM metrics
        WHERE type = 'health_check' AND recorded_at >= ?
        GROUP BY json_extract(labels_json, '$.provider')
      `
      )
      .all(cutoff) as Array<{ provider: string; availability: number }>;

    const providerAvailability: Record<string, boolean> = {};
    for (const row of providerHealth) {
      providerAvailability[row.provider] = row.availability >= 0.95;
      if (row.availability < 0.95) {
        issues.push(
          `Provider ${row.provider} availability ${(row.availability * 100).toFixed(1)}%`
        );
      }
    }

    // Average job duration
    const durationStats = this.db
      .prepare(
        `SELECT AVG(value) as avg FROM metrics
         WHERE type = 'job_duration' AND recorded_at >= ?`
      )
      .get(cutoff) as { avg: number | null };

    const avgJobDurationMs = durationStats.avg ?? 0;

    return {
      healthy: issues.length === 0,
      extractionSuccessRate,
      validationPassRate,
      providerAvailability,
      avgJobDurationMs,
      lastCheckAt: new Date(),
      issues,
    };
  }

  /**
   * Get recent errors for debugging
   */
  getRecentErrors(limit = 20): Array<{
    type: MetricType;
    labels: Record<string, string>;
    recordedAt: Date;
  }> {
    const rows = this.db
      .prepare(
        `
        SELECT type, labels_json, recorded_at
        FROM metrics
        WHERE type IN ('extraction_failure', 'provider_error', 'validation_fail')
        ORDER BY recorded_at DESC
        LIMIT ?
      `
      )
      .all(limit) as Array<{
      type: MetricType;
      labels_json: string;
      recorded_at: string;
    }>;

    return rows.map((row) => ({
      type: row.type,
      labels: JSON.parse(row.labels_json) as Record<string, string>,
      recordedAt: new Date(row.recorded_at),
    }));
  }

  /**
   * Clean up old metrics (call periodically)
   */
  cleanup(): number {
    const cutoff = new Date(
      Date.now() - this.retentionDays * 24 * 60 * 60 * 1000
    ).toISOString();

    const result = this.db
      .prepare(`DELETE FROM metrics WHERE recorded_at < ?`)
      .run(cutoff);

    return result.changes;
  }

  /**
   * Generate daily summary (call once per day)
   */
  generateDailySummary(date?: string): void {
    const targetDate = date ?? new Date().toISOString().split('T')[0];

    this.db
      .prepare(
        `
        INSERT OR REPLACE INTO daily_summaries (date, type, labels_json, count, sum, min, max)
        SELECT
          date(recorded_at) as date,
          type,
          labels_json,
          COUNT(*) as count,
          SUM(value) as sum,
          MIN(value) as min,
          MAX(value) as max
        FROM metrics
        WHERE date(recorded_at) = ?
        GROUP BY date(recorded_at), type, labels_json
      `
      )
      .run(targetDate);
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}

// ============================================================================
// Structured Logger
// ============================================================================

/**
 * Log levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured log entry
 */
export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: string;
  readonly context: Record<string, unknown>;
}

/**
 * Minimal structured logger
 *
 * Outputs JSON to stdout for easy parsing.
 * No external dependencies (Pino, Winston, etc.).
 */
export class StructuredLogger {
  private readonly component: string;
  private readonly minLevel: LogLevel;

  private static readonly LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(component: string, minLevel: LogLevel = 'info') {
    this.component = component;
    this.minLevel = minLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    return (
      StructuredLogger.LEVELS[level] >= StructuredLogger.LEVELS[this.minLevel]
    );
  }

  private log(
    level: LogLevel,
    message: string,
    context: Record<string, unknown> = {}
  ): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context: {
        component: this.component,
        ...context,
      },
    };

    // JSON to stdout (can be piped to file or log aggregator later)
    console.log(JSON.stringify(entry));
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  /**
   * Create a child logger with additional context
   */
  child(context: Record<string, unknown>): StructuredLogger {
    const child = new StructuredLogger(this.component, this.minLevel);
    // Override log method to include parent context
    const parentLog = child.log.bind(child);
    child.log = (
      level: LogLevel,
      message: string,
      childContext: Record<string, unknown> = {}
    ) => {
      parentLog(level, message, { ...context, ...childContext });
    };
    return child;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create metrics store with default path
 */
export function createMetricsStore(
  storageDir = '.shadow-atlas'
): MetricsStore {
  const dbPath = join(storageDir, 'metrics.db');
  return new MetricsStore(dbPath);
}

/**
 * Create logger for a component
 */
export function createLogger(
  component: string,
  level: LogLevel = 'info'
): StructuredLogger {
  return new StructuredLogger(component, level);
}
