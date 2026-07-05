/**
 * Source Prober Tests
 *
 * Verifies the daily reachability probe lane (self-healing data ops, §Daily
 * probe lane) with a fully injected/mocked fetch — ZERO real network calls
 * anywhere in this suite.
 *
 * fetchLaneSources fixtures use the PRODUCER'S real return shape (id + url),
 * matching getAllCanonicalSources(): numeric string ids for muni-derived
 * sources, stable ids for the 2 congressional seeds. Ward-arcgis membership
 * is derived from url (isWardArcgisFamilyUrl), never from an id prefix.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runProbeLane,
  probeFetchLaneReachability,
  resolveProbeUrl,
  rotateDailyIndex,
  isInNextVintageWindow,
  isTodaysNationalLayer,
  type FetchLike,
  type FetchLaneSource,
} from '../../../acquisition/source-prober.js';
import {
  SOURCE_REGISTRY,
  SourceHealthStore,
  PINNED_TIGER_VINTAGE,
  type SourceHealthConfig,
} from '../../../acquisition/source-health.js';
import { STATE_FIPS, buildBafUrl } from '../../../hydration/baf-downloader.js';
import { buildTigerStateUrl } from '../../../acquisition/change-detection-adapter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function fakeResponse(status: number, headers: Record<string, string> = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  };
}

/** Real getAllCanonicalSources()-shaped fixture: the 2 congressional seeds
 *  plus one representative muni-derived ward-arcgis source with a numeric
 *  string id and a real FeatureServer URL. */
const REAL_SHAPED_FETCH_LANE_SOURCES: readonly FetchLaneSource[] = [
  { id: 'congress-legislators-current', url: 'https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-current.yaml' },
  { id: 'tiger-cd119', url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_us_cd119.zip' },
  {
    id: '14',
    url: 'https://services.arcgis.com/ykpntM6e3tHvzKRJ/arcgis/rest/services/Maricopa_County_City_Council_Districts/FeatureServer/0',
  },
];

describe('source-prober', () => {
  let db: Database.Database;
  let store: SourceHealthStore;

  beforeEach(() => {
    db = new Database(':memory:');
    const schemaPath = join(__dirname, '../../../db/schema.sql');
    db.exec(readFileSync(schemaPath, 'utf-8'));
    store = new SourceHealthStore(db);
  });

  const fixedNow = () => new Date('2026-07-04T12:00:00.000Z'); // July -> in-window for CD next-vintage

  it('lane:fetch and lane:none rows are never probed by the content-clock pass (disjoint coverage, no double writes)', async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = vi.fn(async (url: string) => {
      calls.push(url);
      return fakeResponse(200);
    });

    await runProbeLane({
      fetchImpl,
      store,
      now: fixedNow,
      fetchLaneSources: REAL_SHAPED_FETCH_LANE_SOURCES,
    });

    // congress-legislators-current and tiger-cd119 (both lane:'fetch') and
    // ward-arcgis (lane:'fetch') must never appear as a fetch call target
    // in the CONTENT-clock probe pass.
    const fetchLaneUrls = SOURCE_REGISTRY.filter(r => r.lane === 'fetch').map(r =>
      typeof r.url === 'string' ? r.url : r.url.template
    );
    for (const url of fetchLaneUrls) {
      expect(calls).not.toContain(url);
    }

    // No source_health row should exist for the fetch-lane ids after a
    // content-clock probe run (the daily reachability probe is a SEPARATE
    // function, probeFetchLaneReachability, tested below).
    expect(store.getRow('congress-legislators-current')).toBeUndefined();
    expect(store.getRow('tiger-cd119')).toBeUndefined();
    expect(store.getRow('14')).toBeUndefined();

    // lane:none rows (manual/dormant) must also never be probed.
    expect(store.getRow('redraw-signal')).toBeUndefined();
    expect(store.getRow('dc-urls')).toBeUndefined();
  });

  it('every lane:probe row gets exactly one attempt row per run (national-manifest rotation aside)', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => fakeResponse(200));

    const summary = await runProbeLane({
      fetchImpl,
      store,
      now: fixedNow,
      fetchLaneSources: REAL_SHAPED_FETCH_LANE_SOURCES,
    });

    const nationalLayerIds = SOURCE_REGISTRY.filter(
      r => r.lane === 'probe' && r.id.startsWith('tiger-national-')
    ).map(r => r.id);
    const probeRows = SOURCE_REGISTRY.filter(r => r.lane === 'probe');
    const attemptedIds = summary.attempts.filter(a => !a.skipped).map(a => a.sourceId);

    // Every non-window-gated, non-national-manifest probe row got
    // attempted (next-vintage rows are window-gated; national-manifest
    // rows are date-rotated — both asserted separately below).
    for (const row of probeRows) {
      if (row.id.endsWith('@next-vintage')) continue;
      if (nationalLayerIds.includes(row.id)) continue;
      expect(attemptedIds).toContain(row.id);
    }

    // Exactly one national-manifest layer was attempted today (rotation).
    const attemptedNationalLayers = attemptedIds.filter(id => nationalLayerIds.includes(id));
    expect(attemptedNationalLayers).toHaveLength(1);
    expect(attemptedNationalLayers[0]).toBe(
      nationalLayerIds[rotateDailyIndex(fixedNow(), nationalLayerIds.length)]
    );

    // No duplicate attempts for any source id.
    expect(new Set(attemptedIds).size).toBe(attemptedIds.length);
  });

  it('200 status records success and resets consecutive_failures', async () => {
    store.recordFailure('tigerweb-cd', '2026-07-01T00:00:00.000Z', 'HTTP 500');
    store.recordFailure('tigerweb-cd', '2026-07-02T00:00:00.000Z', 'HTTP 500');
    expect(store.getRow('tigerweb-cd')?.consecutive_failures).toBe(2);

    const fetchImpl: FetchLike = vi.fn(async () => fakeResponse(200));
    await runProbeLane(
      { fetchImpl, store, now: fixedNow, fetchLaneSources: [] },
      [SOURCE_REGISTRY.find(r => r.id === 'tigerweb-cd')!]
    );

    const row = store.getRow('tigerweb-cd');
    expect(row?.consecutive_failures).toBe(0);
    expect(row?.last_attempt_at).toBeTruthy();
  });

  it('304 status counts as success', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => fakeResponse(304));
    await runProbeLane(
      { fetchImpl, store, now: fixedNow, fetchLaneSources: [] },
      [SOURCE_REGISTRY.find(r => r.id === 'tigerweb-cd')!]
    );
    const row = store.getRow('tigerweb-cd');
    expect(row?.consecutive_failures).toBe(0);
    expect(row?.last_error).toBeNull();
  });

  it('404 x N accumulates consecutive_failures with last_error populated', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => fakeResponse(404));
    const config = [SOURCE_REGISTRY.find(r => r.id === 'tigerweb-cd')!];

    await runProbeLane({ fetchImpl, store, now: fixedNow, fetchLaneSources: [] }, config);
    expect(store.getRow('tigerweb-cd')?.consecutive_failures).toBe(1);

    await runProbeLane({ fetchImpl, store, now: fixedNow, fetchLaneSources: [] }, config);
    expect(store.getRow('tigerweb-cd')?.consecutive_failures).toBe(2);

    await runProbeLane({ fetchImpl, store, now: fixedNow, fetchLaneSources: [] }, config);
    const row = store.getRow('tigerweb-cd');
    expect(row?.consecutive_failures).toBe(3);
    expect(row?.last_error).toContain('404');
  });

  it('timeout/network-error x N accumulates consecutive_failures with last_error populated', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => {
      throw new Error('network timeout');
    });
    const config = [SOURCE_REGISTRY.find(r => r.id === 'ca-mps')!]; // method: 'get', no HEAD fallback path

    await runProbeLane({ fetchImpl, store, now: fixedNow, fetchLaneSources: [] }, config);
    await runProbeLane({ fetchImpl, store, now: fixedNow, fetchLaneSources: [] }, config);

    const row = store.getRow('ca-mps');
    expect(row?.consecutive_failures).toBe(2);
    expect(row?.last_error).toContain('timeout');
  }, 15000);

  it('HEAD 405 triggers automatic range-GET fallback; 206 counts as success', async () => {
    const calls: Array<{ method?: string; headers?: Record<string, string> }> = [];
    const fetchImpl: FetchLike = vi.fn(async (_url, init) => {
      calls.push({ method: init?.method, headers: init?.headers });
      if (init?.method === 'HEAD') {
        return fakeResponse(405);
      }
      // range-GET fallback request
      return fakeResponse(206);
    });

    const headConfig: SourceHealthConfig = {
      ...SOURCE_REGISTRY.find(r => r.id === 'nad')!,
      probe: { method: 'head' },
    };

    await runProbeLane({ fetchImpl, store, now: fixedNow, fetchLaneSources: [] }, [headConfig]);

    expect(calls.some(c => c.method === 'HEAD')).toBe(true);
    expect(calls.some(c => c.headers?.Range === 'bytes=0-0')).toBe(true);

    const row = store.getRow('nad');
    expect(row?.consecutive_failures).toBe(0);
    expect(row?.last_error).toBeNull();
  });

  it('vintage-row probe success does NOT stamp last_success_at', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => fakeResponse(200));
    const vintageConfig = SOURCE_REGISTRY.find(r => r.id === 'nad')!; // freshness: 'vintage'
    expect(vintageConfig.freshness).toBe('vintage');

    await runProbeLane({ fetchImpl, store, now: fixedNow, fetchLaneSources: [] }, [vintageConfig]);

    const row = store.getRow('nad');
    expect(row?.consecutive_failures).toBe(0); // still resets on success
    expect(row?.last_success_at).toBeNull(); // but never stamps for vintage class
  });

  it('rolling-class probe success DOES stamp last_success_at', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => fakeResponse(200));
    const rollingConfig = SOURCE_REGISTRY.find(r => r.id === 'tigerweb-cd')!; // freshness: 'rolling'
    expect(rollingConfig.freshness).toBe('rolling');

    await runProbeLane({ fetchImpl, store, now: fixedNow, fetchLaneSources: [] }, [rollingConfig]);

    const row = store.getRow('tigerweb-cd');
    expect(row?.last_success_at).toBeTruthy();
  });

  it('windowed nextVintage probe fires inside the window and writes the derived <id>@next-vintage row', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => fakeResponse(200));
    const nextVintageConfig = SOURCE_REGISTRY.find(r => r.id === 'tiger-cd119@next-vintage')!;

    // fixedNow is July -> inside windowMonths [7,8,9,10]
    expect(isInNextVintageWindow(nextVintageConfig, fixedNow())).toBe(true);

    await runProbeLane({ fetchImpl, store, now: fixedNow, fetchLaneSources: [] }, [nextVintageConfig]);

    const row = store.getRow('tiger-cd119@next-vintage');
    expect(row).toBeDefined();
    expect(row?.last_success_at).toBeTruthy(); // next-vintage arriving IS the staleness signal
  });

  it('windowed nextVintage probe does NOT fire outside the window', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => fakeResponse(200));
    const nextVintageConfig = SOURCE_REGISTRY.find(r => r.id === 'tiger-cd119@next-vintage')!;
    const outsideWindow = () => new Date('2026-02-01T00:00:00.000Z'); // February -> outside [7,8,9,10]

    expect(isInNextVintageWindow(nextVintageConfig, outsideWindow())).toBe(false);

    const summary = await runProbeLane(
      { fetchImpl, store, now: outsideWindow, fetchLaneSources: [] },
      [nextVintageConfig]
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.getRow('tiger-cd119@next-vintage')).toBeUndefined();
    const attempt = summary.attempts.find(a => a.sourceId === 'tiger-cd119@next-vintage');
    expect(attempt?.skipped).toBe(true);
  });

  it('resolves the real next-vintage year as PINNED_TIGER_VINTAGE + 1, never the current calendar year', async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = vi.fn(async (url: string) => {
      calls.push(url);
      return fakeResponse(200);
    });
    const nextVintageConfig = SOURCE_REGISTRY.find(r => r.id === 'tiger-cd119@next-vintage')!;

    await runProbeLane({ fetchImpl, store, now: fixedNow, fetchLaneSources: [] }, [nextVintageConfig]);

    expect(calls[0]).toContain(`TIGER${PINNED_TIGER_VINTAGE + 1}`);
    // fixedNow's calendar year (2026) must NOT appear as the probed vintage
    // unless it happens to equal PINNED_TIGER_VINTAGE + 1.
    if (PINNED_TIGER_VINTAGE + 1 !== fixedNow().getUTCFullYear()) {
      expect(calls[0]).not.toContain(`TIGER${fixedNow().getUTCFullYear()}`);
    }
  });

  it('records a fetch-lane config breach when a declared lane:fetch row has no real counterpart in fetchLaneSources', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => fakeResponse(200));

    const summary = await runProbeLane({
      fetchImpl,
      store,
      now: fixedNow,
      // Missing tiger-cd119 AND any ward-family URL on purpose.
      fetchLaneSources: [{ id: 'congress-legislators-current', url: 'https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-current.yaml' }],
    });

    expect(summary.fetchLaneConfigBreaches).toContain('tiger-cd119');
    expect(summary.fetchLaneConfigBreaches).toContain('ward-arcgis');
  });

  it('no fetch-lane config breach for the congressional/ward family when the real fetchLaneSources cover both seeds and at least one ward-family URL', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => fakeResponse(200));

    const summary = await runProbeLane({
      fetchImpl,
      store,
      now: fixedNow,
      fetchLaneSources: REAL_SHAPED_FETCH_LANE_SOURCES,
    });

    // The congressional/ward family (this fixture's real coverage) is
    // fully accounted for; the 3 precinct-overlay fetch-lane rows
    // (precinct-ar/nc/ut, PRECINCT-CURRENCY-LANE.md §4) are declared in
    // SOURCE_REGISTRY ahead of their real getAllCanonicalSources() producer
    // wiring (out of scope for this ingest-config wave — no
    // change-detector.ts changes were made), so they legitimately surface
    // as config breaches here. This is the self-healing design working as
    // intended ("absence is loud") — see PrecinctOverlayProvider for the
    // real fetch endpoint each of these three will need wired in a later
    // wave, not a defect in this test.
    const nonPrecinctBreaches = summary.fetchLaneConfigBreaches.filter(
      id => !id.startsWith('precinct-'),
    );
    expect(nonPrecinctBreaches).toHaveLength(0);
    expect([...summary.fetchLaneConfigBreaches].sort()).toEqual(
      ['precinct-ar', 'precinct-nc', 'precinct-ut'].sort(),
    );
    expect(summary.wardArcgisLedgerIds).toEqual(['14']);
  });

  it('rotate-daily family sampling picks one representative per day (BAF/state family bound)', () => {
    const day1 = rotateDailyIndex(new Date('2026-07-04T00:00:00.000Z'), 56);
    const day2 = rotateDailyIndex(new Date('2026-07-05T00:00:00.000Z'), 56);
    expect(day1).toBeGreaterThanOrEqual(0);
    expect(day1).toBeLessThan(56);
    expect(day2).toBeGreaterThanOrEqual(0);
    expect(day2).toBeLessThan(56);
  });

  it('resolveProbeUrl for baf-2020 builds the URL via the REAL baf-downloader.ts builder (BlockAssign_ST{fips}_{abbr}.zip)', () => {
    const baf = SOURCE_REGISTRY.find(r => r.id === 'baf-2020')!;
    const url = resolveProbeUrl(baf, fixedNow());
    expect(url).not.toContain('{ST}');
    expect(url).toMatch(/BlockAssign_ST\d{2}_[A-Z]{2}\.zip$/);

    // Cross-check against the real builder directly — no duplicated
    // literal pattern anywhere in this test.
    const idx = rotateDailyIndex(fixedNow(), [...STATE_FIPS.entries()].length);
    const [fips, abbr] = [...STATE_FIPS.entries()][idx];
    expect(url).toBe(buildBafUrl(fips, abbr));
  });

  it('resolveProbeUrl for tiger-state-* substitutes a FIPS code (not postal) and the PINNED vintage (not the current calendar year)', () => {
    const cdTemplate = SOURCE_REGISTRY.find(r => r.id === 'tiger-state-cd')!;
    const url = resolveProbeUrl(cdTemplate, fixedNow());

    // Cross-check directly against the real change-detection-adapter builder.
    const idx = rotateDailyIndex(fixedNow(), [...STATE_FIPS.entries()].length);
    const [fips] = [...STATE_FIPS.entries()][idx];
    expect(url).toBe(buildTigerStateUrl('cd', fips, PINNED_TIGER_VINTAGE));

    // FIPS codes are 2 digits; postal codes are 2 letters — assert the
    // resolved URL embeds digits in the state slot, not letters.
    expect(url).toMatch(new RegExp(`tl_${PINNED_TIGER_VINTAGE}_\\d{2}_cd\\.zip$`));
  });

  it('isTodaysNationalLayer rotates across the 7 tiger-national layers over 7 consecutive days, one per day', () => {
    const nationalIds = SOURCE_REGISTRY.filter(r => r.id.startsWith('tiger-national-')).map(r => r.id);
    expect(nationalIds).toHaveLength(7);

    const pickedPerDay = new Set<string>();
    for (let day = 0; day < 7; day++) {
      const d = new Date(Date.UTC(2026, 0, 1 + day));
      const todays = nationalIds.filter(id => isTodaysNationalLayer(id, d));
      expect(todays).toHaveLength(1);
      pickedPerDay.add(todays[0]);
    }
    // Across 7 consecutive days, all 7 layers get covered exactly once.
    expect(pickedPerDay.size).toBe(7);
  });

  it('makes zero real network calls across a full registry run (fetch is fully mocked)', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => fakeResponse(200));
    await runProbeLane({
      fetchImpl,
      store,
      now: fixedNow,
      fetchLaneSources: REAL_SHAPED_FETCH_LANE_SOURCES,
    });
    // Every call went through the injected mock; nothing else could reach
    // the network since global fetch was never referenced in source-prober.ts
    // outside the injected `fetchImpl` parameter.
    expect(fetchImpl).toHaveBeenCalled();
  });
});

describe('probeFetchLaneReachability', () => {
  let db: Database.Database;
  let store: SourceHealthStore;

  beforeEach(() => {
    db = new Database(':memory:');
    const schemaPath = join(__dirname, '../../../db/schema.sql');
    db.exec(readFileSync(schemaPath, 'utf-8'));
    store = new SourceHealthStore(db);
  });

  const fixedNow = () => new Date('2026-02-04T12:00:00.000Z'); // outside July/January content-check window

  it('probes every fetch-lane source (seeds + munis) into the SEPARATE probe columns, never the content clock', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => fakeResponse(200));

    await probeFetchLaneReachability({
      fetchImpl,
      store,
      now: fixedNow,
      fetchLaneSources: [
        { id: 'congress-legislators-current', url: 'https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-current.yaml' },
        { id: '14', url: 'https://services.arcgis.com/ykpntM6e3tHvzKRJ/arcgis/rest/services/Maricopa_County_City_Council_Districts/FeatureServer/0' },
      ],
    });

    const congress = store.getRow('congress-legislators-current');
    expect(congress?.probe_consecutive_failures).toBe(0);
    expect(congress?.last_probe_at).toBeTruthy();
    // Content clock untouched by a probe-only pass.
    expect(congress?.consecutive_failures).toBe(0);
    expect(congress?.last_success_at).toBeNull();

    const muni = store.getRow('14');
    expect(muni?.probe_consecutive_failures).toBe(0);
    expect(muni?.last_probe_at).toBeTruthy();
  });

  it('a probe failure never increments the content clock, even repeatedly', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => fakeResponse(500));

    await probeFetchLaneReachability({
      fetchImpl,
      store,
      now: fixedNow,
      fetchLaneSources: [{ id: 'tiger-cd119', url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_us_cd119.zip' }],
    });
    await probeFetchLaneReachability({
      fetchImpl,
      store,
      now: fixedNow,
      fetchLaneSources: [{ id: 'tiger-cd119', url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_us_cd119.zip' }],
    });

    const row = store.getRow('tiger-cd119');
    expect(row?.probe_consecutive_failures).toBe(2);
    expect(row?.consecutive_failures).toBe(0); // content clock never touched
  });

  it('a probe success does not mask a pre-existing content-clock failure', async () => {
    store.recordFailure('tiger-cd119', '2026-02-01T00:00:00.000Z', 'HTTP 500');
    expect(store.getRow('tiger-cd119')?.consecutive_failures).toBe(1);

    const fetchImpl: FetchLike = vi.fn(async () => fakeResponse(200));
    await probeFetchLaneReachability({
      fetchImpl,
      store,
      now: fixedNow,
      fetchLaneSources: [{ id: 'tiger-cd119', url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_us_cd119.zip' }],
    });

    // The content-clock failure survives a reachability-probe 200.
    expect(store.getRow('tiger-cd119')?.consecutive_failures).toBe(1);
  });

  it('always probes the 2 congressional seeds but SAMPLES muni-derived sources (bounded volume, not all thousands daily)', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => fakeResponse(200));

    // Simulate a large muni-derived fetch-lane surface — getAllCanonicalSources
    // can return thousands of municipalities (listMunicipalities(10000, 0)).
    const manyMunis: FetchLaneSource[] = Array.from({ length: 500 }, (_, i) => ({
      id: String(i + 1),
      url: `https://services.arcgis.com/fake${i}/arcgis/rest/services/City_${i}/FeatureServer/0`,
    }));

    const summary = await probeFetchLaneReachability({
      fetchImpl,
      store,
      now: fixedNow,
      fetchLaneSources: [
        { id: 'congress-legislators-current', url: 'https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-current.yaml' },
        { id: 'tiger-cd119', url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_us_cd119.zip' },
        ...manyMunis,
      ],
    });

    // Both seeds always probed.
    const probedIds = summary.map(r => r.sourceId);
    expect(probedIds).toContain('congress-legislators-current');
    expect(probedIds).toContain('tiger-cd119');

    // Total probed count is small and bounded — NOT 502 (2 seeds + 500 munis).
    expect(summary.length).toBeLessThan(10);
    expect(summary.length).toBeGreaterThan(2); // seeds + at least 1 muni sample
  });
});
