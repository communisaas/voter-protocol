import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  checkFreshness,
  checkCountryFreshness,
  DEFAULT_FRESHNESS_THRESHOLDS,
} from '../../../hydration/freshness-monitor.js';

// ============================================================================
// Helpers
// ============================================================================

const INGESTION_LOG_DDL = `
CREATE TABLE IF NOT EXISTS ingestion_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failure')),
  records_upserted INTEGER NOT NULL DEFAULT 0,
  records_deleted INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  error TEXT,
  source_vintage TEXT,
  run_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

function createTestDb(dbPath?: string): InstanceType<typeof Database> {
  const db = new Database(dbPath ?? ':memory:');
  db.exec(INGESTION_LOG_DDL);
  return db;
}

function insertIngestion(
  db: InstanceType<typeof Database>,
  source: string,
  status: 'success' | 'failure',
  runAt: string,
  sourceVintage?: string,
): void {
  db.prepare(
    `INSERT INTO ingestion_log (source, status, records_upserted, run_at, source_vintage) VALUES (?, ?, 100, ?, ?)`
  ).run(source, status, runAt, sourceVintage ?? null);
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// ============================================================================
// Tests — checkFreshness (all countries)
// ============================================================================

describe('checkFreshness', () => {
  it('returns all never-ingested for empty DB', () => {
    const db = createTestDb();
    // Write to a temp file so checkFreshness can open it
    const tmpPath = join(tmpdir(), `freshness-test-${Date.now()}-empty.db`);
    db.close();
    const fileDb = new Database(tmpPath);
    fileDb.exec(INGESTION_LOG_DDL);
    fileDb.close();

    try {
      const reports = checkFreshness(tmpPath);
      expect(reports).toHaveLength(5);
      for (const r of reports) {
        expect(r.status).toBe('never-ingested');
        expect(r.lastIngestion).toBeNull();
        expect(r.ageInDays).toBeNull();
      }
    } finally {
      rmSync(tmpPath, { force: true });
    }
  });

  it('returns never-ingested for non-existent DB path', () => {
    const reports = checkFreshness('/nonexistent/path/to/db.sqlite');
    expect(reports).toHaveLength(5);
    for (const r of reports) {
      expect(r.status).toBe('never-ingested');
    }
  });

  it('returns mixed statuses across countries', () => {
    const tmpPath = join(tmpdir(), `freshness-test-${Date.now()}-mixed.db`);
    const db = new Database(tmpPath);
    db.exec(INGESTION_LOG_DDL);

    insertIngestion(db, 'congress-legislators', 'success', daysAgo(2));
    insertIngestion(db, 'canada-mps', 'success', daysAgo(45));
    insertIngestion(db, 'uk-mps', 'success', daysAgo(100));
    // AU and NZ not ingested

    db.close();

    try {
      const reports = checkFreshness(tmpPath);
      const byCountry = new Map(reports.map(r => [r.country, r]));

      expect(byCountry.get('US')!.status).toBe('fresh');
      expect(byCountry.get('CA')!.status).toBe('stale-warn');
      expect(byCountry.get('GB')!.status).toBe('stale-critical');
      expect(byCountry.get('AU')!.status).toBe('never-ingested');
      expect(byCountry.get('NZ')!.status).toBe('never-ingested');
    } finally {
      rmSync(tmpPath, { force: true });
    }
  });
});

// ============================================================================
// Tests — checkCountryFreshness (single country)
// ============================================================================

describe('checkCountryFreshness', () => {
  let tmpPath: string;
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    tmpPath = join(tmpdir(), `freshness-test-${Date.now()}-single.db`);
    db = new Database(tmpPath);
    db.exec(INGESTION_LOG_DDL);
  });

  afterEach(() => {
    try { db.close(); } catch { /* already closed */ }
    rmSync(tmpPath, { force: true });
  });

  it('returns fresh for recent ingestion', () => {
    insertIngestion(db, 'nz-mps', 'success', daysAgo(5));
    db.close();

    const report = checkCountryFreshness(tmpPath, 'NZ');
    expect(report.status).toBe('fresh');
    expect(report.ageInDays).toBeLessThanOrEqual(5);
    expect(report.lastIngestion).toBeInstanceOf(Date);
    expect(report.source).toBe('nz-mps');
  });

  it('returns stale-warn for 45-day-old ingestion', () => {
    insertIngestion(db, 'au-mps', 'success', daysAgo(45));
    db.close();

    const report = checkCountryFreshness(tmpPath, 'AU');
    expect(report.status).toBe('stale-warn');
    expect(report.ageInDays).toBeGreaterThanOrEqual(44);
    expect(report.ageInDays).toBeLessThanOrEqual(46);
  });

  it('returns stale-critical for 100-day-old ingestion', () => {
    insertIngestion(db, 'uk-mps', 'success', daysAgo(100));
    db.close();

    const report = checkCountryFreshness(tmpPath, 'GB');
    expect(report.status).toBe('stale-critical');
    expect(report.ageInDays).toBeGreaterThanOrEqual(99);
  });

  it('uses custom thresholds', () => {
    insertIngestion(db, 'canada-mps', 'success', daysAgo(10));
    db.close();

    // With tight thresholds, 10 days should be critical
    const report = checkCountryFreshness(tmpPath, 'CA', {
      warnAfterDays: 5,
      criticalAfterDays: 8,
    });
    expect(report.status).toBe('stale-critical');
  });

  it('handles missing DB file gracefully', () => {
    db.close();
    rmSync(tmpPath, { force: true });

    const report = checkCountryFreshness('/nonexistent/path.db', 'US');
    expect(report.status).toBe('never-ingested');
    expect(report.lastIngestion).toBeNull();
    expect(report.ageInDays).toBeNull();
  });

  it('uses most recent ingestion when multiple exist', () => {
    // Insert older one first, then a recent one
    insertIngestion(db, 'congress-legislators', 'success', daysAgo(60));
    insertIngestion(db, 'congress-legislators', 'success', daysAgo(2));
    insertIngestion(db, 'congress-legislators', 'failure', daysAgo(0)); // failure should be ignored
    db.close();

    const report = checkCountryFreshness(tmpPath, 'US');
    expect(report.status).toBe('fresh');
    expect(report.ageInDays).toBeLessThanOrEqual(2);
  });

  it('ignores failure rows', () => {
    insertIngestion(db, 'nz-mps', 'failure', daysAgo(1));
    // No success rows
    db.close();

    const report = checkCountryFreshness(tmpPath, 'NZ');
    expect(report.status).toBe('never-ingested');
  });

  it('handles DB with no ingestion_log table', () => {
    // Create a DB without the ingestion_log table
    const barePath = join(tmpdir(), `freshness-test-${Date.now()}-bare.db`);
    const bareDb = new Database(barePath);
    bareDb.exec('CREATE TABLE dummy (id INTEGER PRIMARY KEY)');
    bareDb.close();

    try {
      const report = checkCountryFreshness(barePath, 'US');
      expect(report.status).toBe('never-ingested');
    } finally {
      rmSync(barePath, { force: true });
    }
  });
});

// ============================================================================
// Tests — source vintage tracking (M-2)
// ============================================================================

describe('source vintage tracking', () => {
  let tmpPath: string;
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    tmpPath = join(tmpdir(), `freshness-test-${Date.now()}-vintage.db`);
    db = new Database(tmpPath);
    db.exec(INGESTION_LOG_DDL);
  });

  afterEach(() => {
    try { db.close(); } catch { /* already closed */ }
    rmSync(tmpPath, { force: true });
  });

  it('reports sourceVintage when present in ingestion_log', () => {
    const vintage = '2026-01-15T00:00:00Z';
    insertIngestion(db, 'nz-mps', 'success', daysAgo(5), vintage);
    db.close();

    const report = checkCountryFreshness(tmpPath, 'NZ');
    expect(report.sourceVintage).toBeInstanceOf(Date);
    expect(report.sourceVintage!.toISOString()).toContain('2026-01-15');
    expect(report.message).toContain('source vintage');
  });

  it('reports sourceVintage as null when not set', () => {
    insertIngestion(db, 'au-mps', 'success', daysAgo(3));
    db.close();

    const report = checkCountryFreshness(tmpPath, 'AU');
    expect(report.sourceVintage).toBeNull();
    expect(report.message).not.toContain('source vintage');
  });

  it('reports sourceVintage as null for never-ingested countries', () => {
    db.close();

    const report = checkCountryFreshness(tmpPath, 'US');
    expect(report.sourceVintage).toBeNull();
  });

  it('tracks vintage across multiple countries in checkFreshness', () => {
    insertIngestion(db, 'congress-legislators', 'success', daysAgo(1), '2026-03-01T00:00:00Z');
    insertIngestion(db, 'uk-mps', 'success', daysAgo(2));
    db.close();

    const reports = checkFreshness(tmpPath);
    const usReport = reports.find(r => r.country === 'US')!;
    const gbReport = reports.find(r => r.country === 'GB')!;

    expect(usReport.sourceVintage).toBeInstanceOf(Date);
    expect(gbReport.sourceVintage).toBeNull();
  });

  it('handles legacy DB without source_vintage column', () => {
    // Create a DB with the old schema (no source_vintage column)
    const legacyPath = join(tmpdir(), `freshness-test-${Date.now()}-legacy.db`);
    const legacyDb = new Database(legacyPath);
    legacyDb.exec(`
      CREATE TABLE IF NOT EXISTS ingestion_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('success', 'failure')),
        records_upserted INTEGER NOT NULL DEFAULT 0,
        records_deleted INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER,
        error TEXT,
        run_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `);
    legacyDb.prepare(
      `INSERT INTO ingestion_log (source, status, records_upserted, run_at) VALUES (?, ?, 100, ?)`
    ).run('canada-mps', 'success', daysAgo(3));
    legacyDb.close();

    try {
      const report = checkCountryFreshness(legacyPath, 'CA');
      expect(report.status).toBe('fresh');
      expect(report.sourceVintage).toBeNull();
    } finally {
      rmSync(legacyPath, { force: true });
    }
  });
});
