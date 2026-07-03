import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { readOfficialsGenerated } from '../../../../scripts/build-chunked-mapping.js';
import { OFFICIALS_SCHEMA_DDL } from '../../../db/officials-schema.js';

/**
 * readOfficialsGenerated reads the officials clock (last successful
 * congress-legislators ingest) from a REAL officials-schema database —
 * bootstrapped with the canonical OFFICIALS_SCHEMA_DDL, the same DDL the
 * hydration pipeline execs (hydration/db-writer.ts) — never from the atlas
 * boundary DB, which has no ingestion_log table.
 *
 * Degrade-never-fabricate: every honestly-unknown case (null path, missing
 * file, table-less DB, no success row) must return null — never Date.now(),
 * never a borrowed boundary clock.
 */
describe('readOfficialsGenerated', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'read-officials-generated-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Bootstrap a real officials-schema DB and run the given inserts. */
  function createOfficialsDb(
    name: string,
    seed?: (db: ReturnType<typeof Database>) => void
  ): string {
    const dbPath = join(dir, name);
    const db = new Database(dbPath);
    try {
      db.exec(OFFICIALS_SCHEMA_DDL);
      seed?.(db);
    } finally {
      db.close();
    }
    return dbPath;
  }

  it('returns the newest run_at among congress-legislators success rows, ignoring failures and other sources', () => {
    const dbPath = createOfficialsDb('officials.db', (db) => {
      const insert = db.prepare(
        `INSERT INTO ingestion_log (source, status, records_upserted, records_deleted, duration_ms, error, run_at)
         VALUES (?, ?, ?, 0, 1200, ?, ?)`
      );
      // Older success — must lose to the newer one.
      insert.run('congress-legislators', 'success', 541, null, '2026-05-01T06:00:00.000Z');
      // Newest success — the expected winner.
      insert.run('congress-legislators', 'success', 541, null, '2026-06-20T04:30:00.000Z');
      // Even-newer FAILURE — must be ignored (status filter).
      insert.run('congress-legislators', 'failure', 0, 'upstream 503', '2026-06-28T04:30:00.000Z');
      // Even-newer success from ANOTHER source — must be ignored (source filter).
      insert.run('canada-mps', 'success', 338, null, '2026-06-30T04:30:00.000Z');
    });

    expect(readOfficialsGenerated(dbPath)).toBe('2026-06-20T04:30:00.000Z');
  });

  it('returns null when the only congress-legislators rows are failures', () => {
    const dbPath = createOfficialsDb('failures-only.db', (db) => {
      db.prepare(
        `INSERT INTO ingestion_log (source, status, records_upserted, records_deleted, duration_ms, error, run_at)
         VALUES ('congress-legislators', 'failure', 0, 0, 900, 'upstream 503', '2026-06-28T04:30:00.000Z')`
      ).run();
    });

    expect(readOfficialsGenerated(dbPath)).toBeNull();
  });

  it('returns null for a nonexistent path', () => {
    expect(readOfficialsGenerated(join(dir, 'does-not-exist.db'))).toBeNull();
  });

  it('returns null for a null path', () => {
    expect(readOfficialsGenerated(null)).toBeNull();
  });

  it('returns null for a sqlite DB lacking the ingestion_log table', () => {
    // Minimal boundary-style DB — deliberately NOT seeded with ingestion_log
    // (the atlas DB never carries it; that wrong-DB read was the original bug).
    const dbPath = join(dir, 'no-log.db');
    const db = new Database(dbPath);
    try {
      db.exec('CREATE TABLE districts (id TEXT PRIMARY KEY, geometry TEXT)');
    } finally {
      db.close();
    }

    expect(readOfficialsGenerated(dbPath)).toBeNull();
  });
});
