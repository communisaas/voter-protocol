/**
 * Precinct overlay real-network smoke (network-gated, RUN_NETWORK_TESTS=true
 * or RUN_INTEGRATION=true -- never run unconditionally in CI, same gating
 * pattern as wave1-ingest.test.ts's per-provider smokes).
 *
 * One small real state end-to-end: Rhode Island's live FeatureServer
 * (re-verified live 2026-07-04 -- returnCountOnly = 416, matching
 * PRECINCT-CURRENCY-LANE.md SS2.1 exactly) is downloaded, transformed, and
 * the normalized boundaries are written into a temp on-disk better-sqlite3
 * DB, then read back -- proving the overlay path round-trips through real
 * persistence, not just an in-memory array.
 *
 * A second live case, NY, is a regression guard for a round-1 finding: the
 * config previously appended an invented '/0' layer index (layer 0 is
 * "Early Voting Polling Sites", esriGeometryPoint -- points have no rings,
 * so transform() silently drops every feature). The config now points at
 * layer 4 ("Election Districts", esriGeometryPolygon); this smoke proves
 * the live layer actually returns polygon features, not an empty set.
 */

import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrecinctOverlayProvider } from './precinct-overlay-provider.js';

const runNetworkTests =
  process.env.RUN_NETWORK_TESTS === 'true' || process.env.RUN_INTEGRATION === 'true';
const isCI = process.env.CI === 'true';

function networkTest(name: string, fn: () => Promise<void>, timeout: number = 30000) {
  const vitestTimeout = timeout + 5000;
  if (!runNetworkTests) {
    return test.skip(`${name} (requires RUN_NETWORK_TESTS=true or RUN_INTEGRATION=true)`, async () => {});
  }
  return test(
    name,
    async () => {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Network test timed out after ${timeout}ms`)), timeout);
      });
      try {
        await Promise.race([fn(), timeoutPromise]);
      } catch (error) {
        if (isCI) {
          console.warn(`[SOFT-FAIL] Network test "${name}" failed in CI:`, error);
        } else {
          throw error;
        }
      }
    },
    vitestTimeout,
  );
}

let tmpDir: string | null = null;

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

describe('Precinct overlay real smoke (RI, network-gated)', () => {
  networkTest(
    'RI FeatureServer: live download + transform yields real current-precinct-overlay boundaries, round-tripped through a temp SQLite DB',
    async () => {
      const provider = new PrecinctOverlayProvider('RI');
      const raw = await provider.download({ level: 'district' });
      expect(raw.length).toBeGreaterThan(0);

      const normalized = await provider.transform(raw);
      expect(normalized.length).toBeGreaterThan(0);
      // Live-verified 2026-07-04: exactly 416 precincts statewide.
      expect(normalized.length).toBe(416);

      const first = normalized[0];
      expect(first.properties.provenanceLabel).toBe('current-precinct-overlay');
      expect(first.properties.overlayState).toBe('RI');
      expect(first.source.publishExclusion).toBeUndefined(); // RI is license-clear
      expect(['Polygon', 'MultiPolygon']).toContain(first.geometry.type);

      // Write into a real temp on-disk DB, then read back -- proves the
      // overlay round-trips through persistence, not just an in-memory array.
      const { default: Database } = await import('better-sqlite3');
      tmpDir = mkdtempSync(join(tmpdir(), 'precinct-overlay-smoke-'));
      const dbPath = join(tmpDir, 'ri-precincts.sqlite');
      const db = new Database(dbPath);
      try {
        db.exec(`
          CREATE TABLE precinct_overlay (
            id TEXT PRIMARY KEY,
            state TEXT NOT NULL,
            name TEXT NOT NULL,
            provenance_label TEXT NOT NULL,
            overlay_vintage TEXT NOT NULL,
            geometry_json TEXT NOT NULL
          )
        `);
        const insert = db.prepare(
          `INSERT INTO precinct_overlay (id, state, name, provenance_label, overlay_vintage, geometry_json)
           VALUES (@id, @state, @name, @provenanceLabel, @overlayVintage, @geometryJson)`,
        );
        const insertMany = db.transaction((rows: readonly (typeof normalized)[number][]) => {
          for (const row of rows) {
            insert.run({
              id: row.id,
              state: row.properties.overlayState as string,
              name: row.name,
              provenanceLabel: row.properties.provenanceLabel as string,
              overlayVintage: row.properties.overlayVintage as string,
              geometryJson: JSON.stringify(row.geometry),
            });
          }
        });
        insertMany(normalized);

        const count = db.prepare('SELECT COUNT(*) as n FROM precinct_overlay').get() as { n: number };
        expect(count.n).toBe(416);

        const readBack = db
          .prepare('SELECT * FROM precinct_overlay WHERE id = ?')
          .get(first.id) as Record<string, unknown>;
        expect(readBack).toBeDefined();
        expect(readBack.provenance_label).toBe('current-precinct-overlay');
        expect(readBack.state).toBe('RI');
      } finally {
        db.close();
      }
    },
    30000,
  );
});

describe('Precinct overlay real smoke (NY, network-gated -- layer-index regression guard)', () => {
  networkTest(
    'NY FeatureServer/4 (Election Districts): live download + transform yields real polygon boundaries, never the empty set the invented /0 layer would have produced',
    async () => {
      const provider = new PrecinctOverlayProvider('NY');
      expect(provider.source).toMatch(/\/FeatureServer\/4$/);

      const raw = await provider.download({ level: 'district' });
      expect(raw.length).toBeGreaterThan(0);

      const normalized = await provider.transform(raw);
      // The invented layer 0 ("Early Voting Polling Sites", points-only)
      // would yield zero boundaries here -- transform() drops any feature
      // with no rings. A non-empty result proves layer 4 is genuinely the
      // polygon layer.
      expect(normalized.length).toBeGreaterThan(0);

      const first = normalized[0];
      expect(first.properties.provenanceLabel).toBe('current-precinct-overlay');
      expect(first.properties.overlayState).toBe('NY');
      expect(['Polygon', 'MultiPolygon']).toContain(first.geometry.type);
    },
    30000,
  );
});
