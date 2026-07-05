/**
 * No-spurious-breach simulation.
 *
 * Simulates ~90 days of the REAL schedule shape across every registry lane:
 *   - the 2 congressional seeds: content-checked EVERY day (the cadence
 *     fix — check-changes.ts explicitly checks these 2 cheap seeds every
 *     run regardless of checkScheduledSources' due-filter), PLUS a daily
 *     reachability probe into the separate probe columns.
 *   - ward-arcgis muni sources: content-checked due-only (annual, July —
 *     muni checks stay due-filtered per the fix), aggregated by real
 *     numeric ledger id + URL match via wardArcgisLedgerIds. Its staleness
 *     driver is the daily reachability probe clock (last_probe_at) — the
 *     design table's own SLO type for this row is "reachability", not
 *     content staleness.
 *   - vintage/rolling probe-lane sources: probed daily, all healthy.
 *   - the tiger-cd119@next-vintage derived row: probed daily, window-gated
 *     (July-Oct), all healthy when probed.
 *   - lane:'none' rows: never touched.
 *
 * With every source healthy under this REAL schedule, evaluateSourceHealth
 * must emit ZERO breaches across all 90 simulated days — this is the
 * design's rollout gate ("zero spurious breach issues in a quiet week"),
 * verified here end-to-end against the actual scheduling shape rather than
 * an idealized "daily for everything" assumption. Then, one source per
 * class is broken and the corresponding breach is asserted to fire (and
 * ONLY that one).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SOURCE_REGISTRY,
  SourceHealthStore,
  evaluateSourceHealth,
} from '../../../acquisition/source-health.js';
import { CONGRESSIONAL_CANONICAL_SOURCES } from '../../../acquisition/change-detector.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DAY_MS = 24 * 60 * 60 * 1000;
const SIM_START = new Date('2026-01-01T06:00:00.000Z');
const SIM_DAYS = 90;

/** Real fetch-lane muni fixture ids used across the simulation (numeric,
 *  matching change-detector.ts's `selectedSource.id.toString()`). */
const WARD_MUNI_IDS = ['14', '19', '23'];

/** ward-arcgis municipal sources are due-checked on the SAME real
 *  scheduling shape the design assigns tiger-cd119 (annual, July) — muni
 *  boundary re-checks are scheduled the same way per
 *  getAllCanonicalSources' updateTriggers default. Content checks stay
 *  due-filtered for munis (the fix mandate scopes the always-due cadence
 *  fix to the 2 congressional seeds only). */
function wardDueNow(day: Date): boolean {
  return day.getUTCMonth() + 1 === 7;
}

describe('no-spurious-breach: 90-day simulation of the REAL schedule, all sources healthy', () => {
  let db: Database.Database;
  let store: SourceHealthStore;

  beforeEach(() => {
    db = new Database(':memory:');
    const schemaPath = join(__dirname, '../../../db/schema.sql');
    db.exec(readFileSync(schemaPath, 'utf-8'));
    store = new SourceHealthStore(db);
  });

  function simulateHealthyDay(day: Date): void {
    const at = day.toISOString();

    // --- Fetch-lane seeds: ALWAYS-due content check (the cadence fix —
    // check-changes.ts explicitly checks the 2 seeds every run regardless
    // of the due-filter) + a daily reachability probe into the separate
    // probe columns (belt-and-suspenders reachability signal).
    for (const seed of CONGRESSIONAL_CANONICAL_SOURCES) {
      store.recordSuccess(seed.id, at, { stampSuccess: true });
      store.recordProbeSuccess(seed.id, at);
    }

    // --- ward-arcgis muni sources: due-only content check + daily probe ---
    for (const muniId of WARD_MUNI_IDS) {
      if (wardDueNow(day)) {
        store.recordSuccess(muniId, at, { stampSuccess: true });
      }
      store.recordProbeSuccess(muniId, at);
    }

    // --- probe-lane rows: daily probe, all healthy ---
    for (const config of SOURCE_REGISTRY) {
      if (config.lane !== 'probe') continue;
      if (config.id.endsWith('@next-vintage')) {
        // Window-gated (July-Oct); healthy whenever probed.
        const windowMonths = config.probe?.nextVintage?.windowMonths ?? [];
        if (windowMonths.includes(day.getUTCMonth() + 1)) {
          store.recordSuccess(config.id, at, { stampSuccess: true });
        }
        continue;
      }
      const stampSuccess = config.freshness === 'rolling';
      store.recordSuccess(config.id, at, { stampSuccess });
    }

    // --- lane:'none' rows: never touched (nothing to simulate) ---
  }

  it('emits zero breaches across every simulated day when every source is healthy', () => {
    for (let d = 0; d < SIM_DAYS; d++) {
      const day = new Date(SIM_START.getTime() + d * DAY_MS);
      simulateHealthyDay(day);

      const wardArcgisLedgerIds = WARD_MUNI_IDS;
      const { breaches } = evaluateSourceHealth(store.getAllRows(), SOURCE_REGISTRY, day, {
        registeredAt: store.getRegisteredAtMap(),
        wardArcgisLedgerIds,
      });

      expect(
        breaches,
        `day ${d} (${day.toISOString()}) produced spurious breach(es): ${JSON.stringify(breaches)}`
      ).toHaveLength(0);
    }
  });

  it('breaks tiger-cd119 (fetch-lane seed) via content-clock failures and asserts exactly that fetch-breach fires', () => {
    // Run 30 healthy days first so registration/grace is well established.
    for (let d = 0; d < 30; d++) {
      simulateHealthyDay(new Date(SIM_START.getTime() + d * DAY_MS));
    }

    // Now break tiger-cd119's CONTENT clock for 3 consecutive due-checks.
    // Its only due month in this window is July (day ~181-211); simulate 3
    // failures directly since due-checks are monthly, not daily.
    const day31 = new Date(SIM_START.getTime() + 31 * DAY_MS);
    store.recordFailure('tiger-cd119', day31.toISOString(), 'HTTP 500');
    store.recordFailure('tiger-cd119', new Date(day31.getTime() + DAY_MS).toISOString(), 'HTTP 500');
    store.recordFailure('tiger-cd119', new Date(day31.getTime() + 2 * DAY_MS).toISOString(), 'HTTP 500');

    const { breaches } = evaluateSourceHealth(
      store.getAllRows(),
      SOURCE_REGISTRY,
      new Date(day31.getTime() + 2 * DAY_MS),
      { registeredAt: store.getRegisteredAtMap(), wardArcgisLedgerIds: WARD_MUNI_IDS }
    );

    expect(breaches).toHaveLength(1);
    expect(breaches[0].sourceId).toBe('tiger-cd119');
    expect(breaches[0].breachType).toBe('fetch');
  });

  it('breaks one ward-arcgis muni source and asserts exactly the ward-arcgis breach fires (worst-city aggregation)', () => {
    for (let d = 0; d < 30; d++) {
      simulateHealthyDay(new Date(SIM_START.getTime() + d * DAY_MS));
    }

    const day31 = new Date(SIM_START.getTime() + 31 * DAY_MS);
    // Break city '19' specifically — 5 consecutive content-clock failures
    // (retryBudget for ward-arcgis is 5).
    for (let i = 0; i < 5; i++) {
      store.recordFailure('19', new Date(day31.getTime() + i * DAY_MS).toISOString(), 'HTTP 500');
    }

    const evalDay = new Date(day31.getTime() + 4 * DAY_MS);
    const { breaches } = evaluateSourceHealth(store.getAllRows(), SOURCE_REGISTRY, evalDay, {
      registeredAt: store.getRegisteredAtMap(),
      wardArcgisLedgerIds: WARD_MUNI_IDS,
    });

    expect(breaches).toHaveLength(1);
    expect(breaches[0].sourceId).toBe('ward-arcgis');
    expect(breaches[0].breachType).toBe('fetch');
  });

  it('breaks a probe-lane rolling source (tigerweb-cd) via staleness and asserts exactly that breach fires', () => {
    for (let d = 0; d < 40; d++) {
      simulateHealthyDay(new Date(SIM_START.getTime() + d * DAY_MS));
    }

    // Stop probing tigerweb-cd (simulate an upstream that silently stops
    // responding to probes — no more recordSuccess calls for it) for well
    // past its 30d expectedIntervalDays, while every other source stays
    // healthy day by day.
    for (let d = 41; d < SIM_DAYS; d++) {
      const day = new Date(SIM_START.getTime() + d * DAY_MS);
      const at = day.toISOString();

      for (const seed of CONGRESSIONAL_CANONICAL_SOURCES) {
        store.recordSuccess(seed.id, at, { stampSuccess: true });
        store.recordProbeSuccess(seed.id, at);
      }
      for (const muniId of WARD_MUNI_IDS) {
        if (wardDueNow(day)) store.recordSuccess(muniId, at, { stampSuccess: true });
        store.recordProbeSuccess(muniId, at);
      }
      for (const config of SOURCE_REGISTRY) {
        if (config.lane !== 'probe' || config.id === 'tigerweb-cd') continue;
        if (config.id.endsWith('@next-vintage')) {
          const windowMonths = config.probe?.nextVintage?.windowMonths ?? [];
          if (windowMonths.includes(day.getUTCMonth() + 1)) {
            store.recordSuccess(config.id, at, { stampSuccess: true });
          }
          continue;
        }
        store.recordSuccess(config.id, at, { stampSuccess: config.freshness === 'rolling' });
      }
    }

    const finalDay = new Date(SIM_START.getTime() + (SIM_DAYS - 1) * DAY_MS);
    const { breaches } = evaluateSourceHealth(store.getAllRows(), SOURCE_REGISTRY, finalDay, {
      registeredAt: store.getRegisteredAtMap(),
      wardArcgisLedgerIds: WARD_MUNI_IDS,
    });

    expect(breaches).toHaveLength(1);
    expect(breaches[0].sourceId).toBe('tigerweb-cd');
    expect(breaches[0].breachType).toBe('staleness');
  });

  it('breaks the frozen baf-2020 source via fetch-breach only (never staleness)', () => {
    for (let d = 0; d < 30; d++) {
      simulateHealthyDay(new Date(SIM_START.getTime() + d * DAY_MS));
    }

    const day31 = new Date(SIM_START.getTime() + 31 * DAY_MS);
    store.recordFailure('baf-2020', day31.toISOString(), 'HTTP 404');
    store.recordFailure('baf-2020', new Date(day31.getTime() + DAY_MS).toISOString(), 'HTTP 404');
    store.recordFailure('baf-2020', new Date(day31.getTime() + 2 * DAY_MS).toISOString(), 'HTTP 404');

    const { breaches } = evaluateSourceHealth(
      store.getAllRows(),
      SOURCE_REGISTRY,
      new Date(day31.getTime() + 2 * DAY_MS),
      { registeredAt: store.getRegisteredAtMap(), wardArcgisLedgerIds: WARD_MUNI_IDS }
    );

    expect(breaches).toHaveLength(1);
    expect(breaches[0].sourceId).toBe('baf-2020');
    expect(breaches[0].breachType).toBe('fetch');
  });
});
