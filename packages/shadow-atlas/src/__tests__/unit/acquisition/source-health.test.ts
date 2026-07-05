/**
 * Source Health Tests
 *
 * Verifies the SOURCE_REGISTRY shape/coverage invariants and the pure
 * evaluateSourceHealth breach-evaluation logic (self-healing data ops,
 * §Source registry + SLOs, §Breach evaluation).
 *
 * Fixtures that stand in for the real getAllCanonicalSources() surface use
 * the PRODUCER'S actual return shape: numeric string ids for muni-derived
 * sources (matching `sources.id INTEGER PRIMARY KEY AUTOINCREMENT` in
 * db/schema.sql, converted via `.toString()` in change-detector.ts) and a
 * real FeatureServer/MapServer URL for ward-family membership — never an
 * invented 'ward-arcgis-{city}' id string, which the real producer never
 * emits.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SOURCE_REGISTRY,
  FETCH_LANE_SEED_IDS,
  evaluateSourceHealth,
  isWardArcgisFamilyUrl,
  SourceHealthStore,
  type SourceHealthRow,
} from '../../../acquisition/source-health.js';
import { CONGRESSIONAL_CANONICAL_SOURCES } from '../../../acquisition/change-detector.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** A producer-shaped muni fixture: numeric string id (as change-detector.ts
 *  emits via `selectedSource.id.toString()`) + a real FeatureServer URL. */
function muniFixture(numericId: string, url: string): { id: string; url: string } {
  return { id: numericId, url };
}

describe('SOURCE_REGISTRY', () => {
  it('has unique ids', () => {
    const ids = SOURCE_REGISTRY.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every row carries exactly one lane', () => {
    for (const row of SOURCE_REGISTRY) {
      expect(['fetch', 'probe', 'none']).toContain(row.lane);
    }
  });

  it('every lane:probe row carries a probe config', () => {
    for (const row of SOURCE_REGISTRY) {
      if (row.lane === 'probe') {
        expect(row.probe).toBeDefined();
      }
    }
  });

  it('covers every CONGRESSIONAL_CANONICAL_SOURCES id', () => {
    for (const seed of CONGRESSIONAL_CANONICAL_SOURCES) {
      const row = SOURCE_REGISTRY.find(r => r.id === seed.id);
      expect(row, `missing registry row for congressional seed ${seed.id}`).toBeDefined();
      expect(row!.lane).toBe('fetch');
    }
  });

  it('isWardArcgisFamilyUrl matches real FeatureServer/MapServer muni URLs, not arbitrary URLs', () => {
    expect(
      isWardArcgisFamilyUrl(
        'https://services.arcgis.com/ykpntM6e3tHvzKRJ/arcgis/rest/services/Maricopa_County_City_Council_Districts/FeatureServer/0'
      )
    ).toBe(true);
    expect(
      isWardArcgisFamilyUrl(
        'https://gis.fdot.gov/arcgis/rest/services/Admin_Boundaries/MapServer/7'
      )
    ).toBe(true);
    expect(isWardArcgisFamilyUrl('https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_us_cd119.zip')).toBe(
      false
    );
  });

  it('the fetch lane is the 2 congressional seeds (real, stable ids) + the ward-arcgis template row (aggregated by URL, never by id) + the 3 precinct-overlay checksum sources (PRECINCT-CURRENCY-LANE.md §4)', () => {
    const fetchRows = SOURCE_REGISTRY.filter(r => r.lane === 'fetch');
    const fetchIds = fetchRows.map(r => r.id);

    expect(fetchIds).toContain('congress-legislators-current');
    expect(fetchIds).toContain('tiger-cd119');
    expect(fetchIds).toContain('ward-arcgis');
    // precinct-{ar,nc,ut}: the 3 rolling/cheap-checksum precinct-overlay
    // sources §4 assigns to the fetch lane (AR FeatureServer, NC S3
    // listing, UT item JSON) — declared here ahead of their real
    // getAllCanonicalSources() producer wiring, same as any other
    // registry-first source; the prober's config-breach check (see
    // source-prober.test.ts) is what makes that absence loud until a
    // later wave wires the real fetch producer.
    expect(fetchIds).toContain('precinct-ar');
    expect(fetchIds).toContain('precinct-nc');
    expect(fetchIds).toContain('precinct-ut');
    expect(fetchIds).toHaveLength(6);

    expect(FETCH_LANE_SEED_IDS).toContain('congress-legislators-current');
    expect(FETCH_LANE_SEED_IDS).toContain('tiger-cd119');
    // The seed list intentionally does NOT contain 'ward-arcgis' or any
    // ward id — ward membership is derived by URL, never enumerated here.
    expect(FETCH_LANE_SEED_IDS).not.toContain('ward-arcgis');
  });

  it('lane:none rows are exactly the manual/dormant sources (rdh removed — P16 sweep owns it)', () => {
    const noneRows = SOURCE_REGISTRY.filter(r => r.lane === 'none');
    const noneIds = noneRows.map(r => r.id);
    expect(noneIds).toEqual(expect.arrayContaining(['redraw-signal', 'dc-urls']));
    expect(noneIds).not.toContain('rdh');
    for (const row of noneRows) {
      expect(row.freshness === 'manual').toBe(true);
    }
  });

  it('matches design-table intervals/budgets for representative sources', () => {
    const cd119 = SOURCE_REGISTRY.find(r => r.id === 'tiger-cd119')!;
    expect(cd119.expectedIntervalDays).toBe(400);
    expect(cd119.retryBudget).toBe(3);

    const congress = SOURCE_REGISTRY.find(r => r.id === 'congress-legislators-current')!;
    expect(congress.expectedIntervalDays).toBe(7);
    expect(congress.retryBudget).toBe(3);

    const nad = SOURCE_REGISTRY.find(r => r.id === 'nad')!;
    expect(nad.expectedIntervalDays).toBe(120);
    expect(nad.retryBudget).toBe(3);

    const baf = SOURCE_REGISTRY.find(r => r.id === 'baf-2020')!;
    expect(baf.expectedIntervalDays).toBeNull();
    expect(baf.freshness).toBe('frozen');

    const bef = SOURCE_REGISTRY.find(r => r.id === 'bef-cd119')!;
    expect(bef.expectedIntervalDays).toBe(800);

    const ward = SOURCE_REGISTRY.find(r => r.id === 'ward-arcgis')!;
    expect(ward.expectedIntervalDays).toBe(30);
    expect(ward.retryBudget).toBe(5);

    const au = SOURCE_REGISTRY.find(r => r.id === 'au-mps')!;
    expect(au.retryBudget).toBe(5);

    const ipfs = SOURCE_REGISTRY.find(r => r.id === 'ipfs-gateways')!;
    expect(ipfs.expectedIntervalDays).toBe(7);
  });

  it('nz-mps and au-mps registry URLs match the real, actually-fetched ingest targets', () => {
    // au-mps: ingest-au-mps.ts's own BASE_URL (L183), not the bare origin.
    const au = SOURCE_REGISTRY.find(r => r.id === 'au-mps')!;
    expect(au.url).toBe('https://www.aph.gov.au/Senators_and_Members/Parliamentarian_Search_Results');

    // nz-mps: ingest-nz-mps.ts's real downloadUrl (L333) — the CSV
    // resource actually fetched — not the unused DATA_GOVT_NZ_URL constant.
    const nz = SOURCE_REGISTRY.find(r => r.id === 'nz-mps')!;
    expect(nz.url).toBe(
      'https://catalogue.data.govt.nz/dataset/d97b9a53-4660-4dd5-89df-6c4536e92a02/resource/89069a40-abcf-4190-9665-3513ff004dd8/download/mp-contact-details.csv'
    );
  });

  it('nad registry URL matches the quarterly workflow default nad_url', () => {
    const nad = SOURCE_REGISTRY.find(r => r.id === 'nad')!;
    expect(nad.url).toBe('https://data.transportation.gov/download/fc2s-wawr/application/x-zip-compressed');
  });
});

describe('evaluateSourceHealth', () => {
  const now = new Date('2026-07-04T00:00:00.000Z');

  function row(partial: Partial<SourceHealthRow> & { source_id: string }): SourceHealthRow {
    return {
      last_attempt_at: null,
      last_success_at: null,
      consecutive_failures: 0,
      last_error: null,
      breach_state: 'ok',
      breach_opened_at: null,
      remediation_ref: null,
      probe_consecutive_failures: 0,
      last_probe_at: null,
      registered_at: null,
      ...partial,
    };
  }

  it('fires fetch-breach when consecutive_failures >= retryBudget', () => {
    const registry = [SOURCE_REGISTRY.find(r => r.id === 'tiger-cd119')!];
    const ledger = [row({ source_id: 'tiger-cd119', consecutive_failures: 3, last_error: 'HTTP 404', last_attempt_at: now.toISOString() })];

    const { breaches } = evaluateSourceHealth(ledger, registry, now);
    expect(breaches).toHaveLength(1);
    expect(breaches[0].breachType).toBe('fetch');
    expect(breaches[0].sourceId).toBe('tiger-cd119');
  });

  it('does not fire fetch-breach below retryBudget', () => {
    const registry = [SOURCE_REGISTRY.find(r => r.id === 'tiger-cd119')!];
    const ledger = [row({ source_id: 'tiger-cd119', consecutive_failures: 2, last_success_at: now.toISOString() })];

    const { breaches } = evaluateSourceHealth(ledger, registry, now);
    expect(breaches).toHaveLength(0);
  });

  it('fires staleness-breach when past expectedIntervalDays', () => {
    const registry = [SOURCE_REGISTRY.find(r => r.id === 'congress-legislators-current')!]; // 7d interval
    const staleSuccess = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const ledger = [row({ source_id: 'congress-legislators-current', last_success_at: staleSuccess })];

    const { breaches } = evaluateSourceHealth(ledger, registry, now);
    expect(breaches).toHaveLength(1);
    expect(breaches[0].breachType).toBe('staleness');
  });

  it('does not fire staleness-breach inside expectedIntervalDays', () => {
    const registry = [SOURCE_REGISTRY.find(r => r.id === 'congress-legislators-current')!];
    const freshSuccess = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const ledger = [row({ source_id: 'congress-legislators-current', last_success_at: freshSuccess })];

    const { breaches } = evaluateSourceHealth(ledger, registry, now);
    expect(breaches).toHaveLength(0);
  });

  it('frozen class never staleness-breaches, even with no success ever and huge failure count below budget', () => {
    const registry = [SOURCE_REGISTRY.find(r => r.id === 'baf-2020')!];
    // registered long ago, never succeeded, 2 failures (below retryBudget 3)
    const ledger = [row({ source_id: 'baf-2020', consecutive_failures: 2, last_success_at: null })];

    const { breaches } = evaluateSourceHealth(ledger, registry, now, {
      registeredAt: { 'baf-2020': new Date(now.getTime() - 5000 * 24 * 60 * 60 * 1000).toISOString() },
    });
    expect(breaches).toHaveLength(0);
  });

  it('frozen class still fetch-breaches when failures >= retryBudget', () => {
    const registry = [SOURCE_REGISTRY.find(r => r.id === 'baf-2020')!];
    const ledger = [row({ source_id: 'baf-2020', consecutive_failures: 3, last_error: 'HTTP 404' })];

    const { breaches } = evaluateSourceHealth(ledger, registry, now);
    expect(breaches).toHaveLength(1);
    expect(breaches[0].breachType).toBe('fetch');
  });

  it('manual/lane:none rows are skipped entirely, regardless of ledger state', () => {
    const registry = [SOURCE_REGISTRY.find(r => r.id === 'redraw-signal')!];
    const ledger = [row({ source_id: 'redraw-signal', consecutive_failures: 99 })];

    const { breaches } = evaluateSourceHealth(ledger, registry, now);
    expect(breaches).toHaveLength(0);
  });

  it('never-succeeded sources get one expectedIntervalDays of grace from registration', () => {
    const registry = [SOURCE_REGISTRY.find(r => r.id === 'nad')!]; // 120d interval
    const ledger: SourceHealthRow[] = []; // no ledger row at all — never attempted

    const registeredAt = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago
    const { breaches: withinGrace } = evaluateSourceHealth(ledger, registry, now, {
      registeredAt: { nad: registeredAt },
    });
    expect(withinGrace).toHaveLength(0);

    const registeredLongAgo = new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const { breaches: pastGrace } = evaluateSourceHealth(ledger, registry, now, {
      registeredAt: { nad: registeredLongAgo },
    });
    expect(pastGrace).toHaveLength(1);
    expect(pastGrace[0].breachType).toBe('staleness');
  });

  it('a ledger row registered_at takes precedence over the opts.registeredAt map', () => {
    const registry = [SOURCE_REGISTRY.find(r => r.id === 'nad')!];
    // Ledger row itself carries registered_at from long ago — past grace —
    // even though opts.registeredAt claims it was registered "now".
    const ledger = [
      row({
        source_id: 'nad',
        registered_at: new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ];

    const { breaches } = evaluateSourceHealth(ledger, registry, now, {
      registeredAt: { nad: now.toISOString() },
    });
    expect(breaches).toHaveLength(1);
    expect(breaches[0].breachType).toBe('staleness');
  });

  it('grace period does not suppress fetch-breach for never-succeeded sources', () => {
    const registry = [SOURCE_REGISTRY.find(r => r.id === 'nad')!];
    const ledger = [row({ source_id: 'nad', consecutive_failures: 3, last_error: 'timeout', last_success_at: null })];

    const { breaches } = evaluateSourceHealth(ledger, registry, now, {
      registeredAt: { nad: now.toISOString() }, // registered "now" — max grace
    });
    expect(breaches).toHaveLength(1);
    expect(breaches[0].breachType).toBe('fetch');
  });

  it('vintage staleness keys off the derived <id>@next-vintage row, never off current-URL success', () => {
    const registry = [SOURCE_REGISTRY.find(r => r.id === 'tiger-cd119')!]; // vintage, 400d
    const veryFreshCurrentSuccess = now.toISOString();
    const ledger = [
      row({ source_id: 'tiger-cd119', last_success_at: veryFreshCurrentSuccess }),
      // no @next-vintage row at all => treated as never-succeeded for staleness
    ];

    // Register long enough ago that grace has expired, so the absence of a
    // next-vintage success should breach even though the CURRENT vintage's
    // own last_success_at is very fresh.
    const { breaches } = evaluateSourceHealth(ledger, registry, now, {
      registeredAt: { 'tiger-cd119': new Date(now.getTime() - 3000 * 24 * 60 * 60 * 1000).toISOString() },
    });
    expect(breaches).toHaveLength(1);
    expect(breaches[0].breachType).toBe('staleness');
  });

  it('vintage staleness clears once the next-vintage row records a success', () => {
    const registry = [SOURCE_REGISTRY.find(r => r.id === 'tiger-cd119')!];
    const ledger = [
      row({ source_id: 'tiger-cd119', last_success_at: now.toISOString() }),
      row({ source_id: 'tiger-cd119@next-vintage', last_success_at: now.toISOString() }),
    ];

    const { breaches } = evaluateSourceHealth(ledger, registry, now, {
      registeredAt: { 'tiger-cd119': new Date(now.getTime() - 3000 * 24 * 60 * 60 * 1000).toISOString() },
    });
    expect(breaches).toHaveLength(0);
  });

  it('a derived @next-vintage row is exempt from fetch-breach — expected in-window 404s are not failures', () => {
    const registry = [SOURCE_REGISTRY.find(r => r.id === 'tiger-cd119@next-vintage')!];
    // 5 consecutive failures — well past retryBudget 3 — but this is the
    // EXPECTED shape of an in-window not-yet-published vintage.
    const ledger = [
      row({ source_id: 'tiger-cd119@next-vintage', consecutive_failures: 5, last_error: 'HTTP 404' }),
    ];

    const { breaches } = evaluateSourceHealth(ledger, registry, now);
    expect(breaches).toHaveLength(0);
  });

  it('ward-arcgis SLO is evaluated by aggregating real numeric muni ledger rows whose URL matched the ward family', () => {
    const registry = [SOURCE_REGISTRY.find(r => r.id === 'ward-arcgis')!]; // 30d, retryBudget 5
    // Real producer shape: numeric string ids, exactly as
    // change-detector.ts's `selectedSource.id.toString()` emits.
    const ledger = [
      row({ source_id: '14', consecutive_failures: 5, last_error: 'HTTP 500', last_attempt_at: now.toISOString() }),
      row({ source_id: '19', consecutive_failures: 0, last_success_at: now.toISOString() }),
    ];

    const { breaches } = evaluateSourceHealth(ledger, registry, now, {
      wardArcgisLedgerIds: ['14', '19'],
    });

    // Worst-city aggregation: city '14' has 5 consecutive failures >=
    // retryBudget 5 => fetch-breach, even though city '19' is healthy.
    expect(breaches).toHaveLength(1);
    expect(breaches[0].sourceId).toBe('ward-arcgis');
    expect(breaches[0].breachType).toBe('fetch');
  });

  it('ward-arcgis does not breach when every real muni ledger row in the family is healthy', () => {
    const registry = [SOURCE_REGISTRY.find(r => r.id === 'ward-arcgis')!];
    const ledger = [
      row({ source_id: '14', consecutive_failures: 0, last_success_at: now.toISOString() }),
      row({ source_id: '19', consecutive_failures: 1, last_success_at: now.toISOString() }),
    ];

    const { breaches } = evaluateSourceHealth(ledger, registry, now, {
      wardArcgisLedgerIds: ['14', '19'],
    });
    expect(breaches).toHaveLength(0);
  });

  it('ward-arcgis is treated as never-attempted (grace applies, no fabricated breach) when wardArcgisLedgerIds is empty', () => {
    const registry = [SOURCE_REGISTRY.find(r => r.id === 'ward-arcgis')!];
    const ledger: SourceHealthRow[] = [];

    const { breaches } = evaluateSourceHealth(ledger, registry, now, {
      wardArcgisLedgerIds: [],
      registeredAt: { 'ward-arcgis': now.toISOString() }, // max grace
    });
    expect(breaches).toHaveLength(0);
  });
});

describe('error-threading via SourceHealthStore (fresh DB bootstrap)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    const schemaPath = join(__dirname, '../../../db/schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
  });

  it('bootstraps the source_health table with no prior data', () => {
    const store = new SourceHealthStore(db);
    expect(store.getAllRows()).toEqual([]);
  });

  it('records a failure without emitting a change event (ledger-only side effect)', () => {
    const store = new SourceHealthStore(db);
    store.recordFailure('tiger-cd119', '2026-07-04T00:00:00.000Z', 'HTTP 404 not found');

    const row = store.getRow('tiger-cd119');
    expect(row?.consecutive_failures).toBe(1);
    expect(row?.last_error).toBe('HTTP 404 not found');
    expect(row?.registered_at).toBe('2026-07-04T00:00:00.000Z');

    // No events table row was created by this ledger write — the `events`
    // table is the change-detector's own audit log and must remain
    // untouched by health-ledger writes.
    const eventCount = db.prepare('SELECT COUNT(*) as n FROM events').get() as { n: number };
    expect(eventCount.n).toBe(0);
  });

  it('a subsequent success resets consecutive_failures and stamps last_success_at', () => {
    const store = new SourceHealthStore(db);
    store.recordFailure('tiger-cd119', '2026-07-01T00:00:00.000Z', 'timeout');
    store.recordFailure('tiger-cd119', '2026-07-02T00:00:00.000Z', 'timeout');
    expect(store.getRow('tiger-cd119')?.consecutive_failures).toBe(2);

    store.recordSuccess('tiger-cd119', '2026-07-03T00:00:00.000Z', { stampSuccess: true });
    const row = store.getRow('tiger-cd119');
    expect(row?.consecutive_failures).toBe(0);
    expect(row?.last_error).toBeNull();
    expect(row?.last_success_at).toBe('2026-07-03T00:00:00.000Z');
    // registered_at stamped on FIRST attempt, unchanged by later attempts.
    expect(row?.registered_at).toBe('2026-07-01T00:00:00.000Z');
  });

  it('recordSuccess with stampSuccess:false resets failures but does not advance last_success_at (vintage/frozen clock rule)', () => {
    const store = new SourceHealthStore(db);
    store.recordFailure('baf-2020', '2026-07-01T00:00:00.000Z', 'HTTP 404');
    store.recordSuccess('baf-2020', '2026-07-02T00:00:00.000Z', { stampSuccess: false });

    const row = store.getRow('baf-2020');
    expect(row?.consecutive_failures).toBe(0);
    expect(row?.last_success_at).toBeNull();
    expect(row?.last_attempt_at).toBe('2026-07-02T00:00:00.000Z');
  });

  it('recordProbeSuccess/recordProbeFailure write ONLY the probe columns, never the content clock', () => {
    const store = new SourceHealthStore(db);
    // Seed a content-clock failure first (as the real fetch lane would).
    store.recordFailure('congress-legislators-current', '2026-07-01T00:00:00.000Z', 'HTTP 500');
    expect(store.getRow('congress-legislators-current')?.consecutive_failures).toBe(1);

    // A daily reachability probe succeeds — must NOT reset the content
    // clock's consecutive_failures.
    store.recordProbeSuccess('congress-legislators-current', '2026-07-02T00:00:00.000Z');
    const afterProbeSuccess = store.getRow('congress-legislators-current');
    expect(afterProbeSuccess?.consecutive_failures).toBe(1); // untouched
    expect(afterProbeSuccess?.last_success_at).toBeNull(); // untouched
    expect(afterProbeSuccess?.probe_consecutive_failures).toBe(0);
    expect(afterProbeSuccess?.last_probe_at).toBe('2026-07-02T00:00:00.000Z');

    // A subsequent probe failure must NOT increment the content clock either.
    store.recordProbeFailure('congress-legislators-current', '2026-07-03T00:00:00.000Z');
    const afterProbeFailure = store.getRow('congress-legislators-current');
    expect(afterProbeFailure?.consecutive_failures).toBe(1); // still untouched
    expect(afterProbeFailure?.probe_consecutive_failures).toBe(1);
  });

  it('getRegisteredAtMap returns registered_at for every attempted source, real content or probe', () => {
    const store = new SourceHealthStore(db);
    store.recordFailure('tiger-cd119', '2026-07-01T00:00:00.000Z', 'timeout');
    store.recordProbeSuccess('nad', '2026-07-02T00:00:00.000Z');

    const map = store.getRegisteredAtMap();
    expect(map['tiger-cd119']).toBe('2026-07-01T00:00:00.000Z');
    expect(map['nad']).toBe('2026-07-02T00:00:00.000Z');
  });
});
