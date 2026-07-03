import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createSQLiteAdapter } from '../../../db/factory.js';
import { ChangeDetector } from '../../../acquisition/change-detector.js';
import type { SQLiteAdapter } from '../../../db/sqlite-adapter.js';

/**
 * Guards the change-check runner's bootstrap (mirrors src/scripts/check-changes.ts):
 * building the adapter through createSQLiteAdapter (db/factory.ts) initializes
 * schema + views on a freshly created SQLite file, so the first run no longer
 * throws `no such table: municipalities` from the canonical-source walk.
 *
 * A raw `new SQLiteAdapter(path)` (the prior runner bootstrap) left the file
 * empty, so getAllCanonicalSources -> listMunicipalities threw on the first run.
 */
describe('check-changes fresh-DB bootstrap', () => {
  let tmpDir: string;
  let db: SQLiteAdapter | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'shadow-atlas-changecheck-'));
    // Benign HEAD response — the assertion is "no schema error", not a specific
    // change result. Some/none of the canonical sources may be due depending on
    // the calendar, so fetch may or may not be invoked; either way is fine.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ etag: '"fresh"' }),
    });
  });

  afterEach(async () => {
    if (db) {
      await db.close();
      db = undefined;
    }
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('runs checkScheduledSources on a freshly created DB without `no such table` error', async () => {
    const dbPath = join(tmpDir, 'shadow-atlas.db');

    // Reuse the runner's exact bootstrap path (factory init, not raw adapter).
    db = await createSQLiteAdapter(dbPath);
    const detector = new ChangeDetector(db);

    // Schema is present (factory ran initialize), so the canonical-source walk
    // queries `municipalities` cleanly instead of throwing. completes => array.
    const changes = await detector.checkScheduledSources();
    expect(Array.isArray(changes)).toBe(true);
  });
});
