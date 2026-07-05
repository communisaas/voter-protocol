/**
 * Source Health — per-source freshness SLOs + breach evaluation
 *
 * Implements the design's §Source registry + SLOs and §Breach evaluation:
 * one typed registry (SOURCE_REGISTRY) is the single source of truth for
 * every Shadow Atlas upstream source's expected cadence, retry budget, and
 * daily-lane assignment; evaluateSourceHealth is a pure function turning
 * ledger rows + the registry into structured breach records.
 *
 * This module does NOT fetch anything. The fetch lane lives in
 * change-detector.ts (existing); the probe lane lives in
 * source-prober.ts (new, sibling module). Both write attempt outcomes into
 * the same `source_health` ledger table (schema in db/schema.sql) via
 * SourceHealthStore below.
 *
 * CRITICAL INVARIANT: exactly one lane owns each source's daily reachability
 * clock. `lane: 'fetch'` sources are covered by
 * ChangeDetector.getAllCanonicalSources (muni-derived selections + the 2
 * congressional seeds); `lane: 'probe'` sources get a daily reachability
 * probe from source-prober.ts; `lane: 'none'` sources (manual/dormant) are
 * skipped by both.
 */

import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

// ============================================================================
// Types
// ============================================================================

export type SourceClass =
  | 'boundary-geometry'
  | 'boundary-assignment'
  | 'municipal'
  | 'address'
  | 'officials'
  | 'signal'
  | 'infra';

export type FreshnessClass = 'vintage' | 'rolling' | 'frozen' | 'manual';

export type SourceLane = 'fetch' | 'probe' | 'none';

export type ProbeMethod = 'head' | 'conditional-get' | 'get';

export interface NextVintageProbeConfig {
  /** URL template for the NEXT vintage (e.g. contains a `{year}` placeholder
   *  the prober substitutes, or is otherwise already the fully-resolved next
   *  vintage URL — callers of the registry own template expansion). */
  readonly template: string;
  /** Calendar months (1-12) during which the next-vintage probe should run.
   *  Outside this window the prober skips the probe entirely (window-gated). */
  readonly windowMonths: readonly number[];
}

export interface SourceProbeConfig {
  /** First-choice probe method. The prober auto-falls-back HEAD -> range-GET
   *  (`Range: bytes=0-0`) on 405/501/hang regardless of this setting. */
  readonly method: ProbeMethod;
  /** Override URL when the probe target differs from the fetch/content URL
   *  (directory listing, sample county, service root, etc). */
  readonly url?: string;
  /** Per-file families (BAF x56, per-state TIGER templates): probe ONE
   *  date-rotated representative per day rather than every file. */
  readonly sample?: 'rotate-daily';
  /** Vintage sources only: window-gated probe of the NEXT vintage URL,
   *  recorded on the derived `<id>@next-vintage` ledger row. */
  readonly nextVintage?: NextVintageProbeConfig;
}

export interface SourceHealthConfig {
  /** Stable key, matches detector sourceIds where they exist. */
  readonly id: string;
  readonly class: SourceClass;
  /** The source URL, or a URL template + param list for per-state/per-city
   *  families. `configSite` is the actual edit target on breach — this field
   *  is documentation/probe-target derivation, not necessarily fetched
   *  directly by this module. */
  readonly url: string | { readonly template: string; readonly params: readonly string[] };
  /** file:line where the URL/vintage actually lives — the agent's edit
   *  target on breach (self-healing data ops remediation lane, P15). */
  readonly configSite: string;
  /** Freshness window in days; null = frozen product (fetch-breach only). */
  readonly expectedIntervalDays: number | null;
  /** Consecutive failed attempts before fetch-breach. */
  readonly retryBudget: number;
  readonly freshness: FreshnessClass;
  /** Which atlas resolution slots go stale if this source dies. */
  readonly ownerSlots?: string;
  /**
   * Daily-lane assignment. INVARIANT: exactly one lane owns each source's
   * reachability clock (dual writes would let a bare probe 200 reset
   * consecutive_failures accumulated by a failing checksum fetch).
   *   'fetch' — covered by getAllCanonicalSources (muni-derived + the 2 seeds)
   *   'probe' — daily reachability probe (source-prober.ts)
   *   'none'  — manual/dormant rows, skipped by both lanes
   */
  readonly lane: SourceLane;
  /** Required when lane === 'probe'. */
  readonly probe?: SourceProbeConfig;
}

export interface SourceHealthRow {
  readonly source_id: string;
  readonly last_attempt_at: string | null;
  readonly last_success_at: string | null;
  readonly consecutive_failures: number;
  readonly last_error: string | null;
  readonly breach_state: 'ok' | 'breached' | 'remediating' | 'escalated' | 'manual';
  readonly breach_opened_at: string | null;
  readonly remediation_ref: string | null;
  /**
   * Reachability-only probe columns (never written by the content/fetch
   * clock). Muni fetch-lane rows (numeric ids) are due-filtered on the
   * content clock (`consecutive_failures`/`last_success_at` above, advanced
   * only when a real checksum check actually runs) but MAY additionally get
   * a daily reachability probe. That probe writes ONLY these two columns —
   * a probe 200 can never reset or mask a failing content fetch, and a
   * probe failure never counts toward fetch-breach.
   */
  readonly probe_consecutive_failures: number;
  readonly last_probe_at: string | null;
  /** ISO timestamp of the FIRST attempt of any kind ever recorded for this
   *  source_id — the real, persisted anchor for the never-succeeded
   *  staleness grace period (see evaluateSourceHealth's opts.registeredAt). */
  readonly registered_at: string | null;
}

/**
 * 'config' is the prober's startup lane-exclusivity assertion: a declared
 * `lane: 'fetch'` registry row with NO real counterpart in the actual
 * getAllCanonicalSources() output this run. Recorded (not just
 * console.warn'd) so it surfaces through the same health-summary/issue
 * pipeline as fetch/staleness breaches — "absence is loud" per the design.
 */
export type BreachType = 'fetch' | 'staleness' | 'config';

/** Build a config-breach record for a registry row absent from the real
 *  fetch-lane surface this run. Kept minimal — no attempt history exists
 *  for a row that was never even reachable through the producer walk. */
export function buildConfigBreachRecord(config: SourceHealthConfig): SourceBreachRecord {
  return {
    sourceId: config.id,
    breachType: 'config',
    class: config.class,
    configSite: config.configSite,
    expectedIntervalDays: config.expectedIntervalDays,
    retryBudget: config.retryBudget,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    attempts: [],
    urlChecked: registryUrl(config),
    ...(config.ownerSlots ? { ownerSlots: config.ownerSlots } : {}),
  };
}

export interface SourceBreachAttempt {
  readonly at: string;
  readonly error: string;
}

export interface SourceBreachRecord {
  readonly sourceId: string;
  readonly breachType: BreachType;
  readonly class: SourceClass;
  readonly configSite: string;
  readonly expectedIntervalDays: number | null;
  readonly retryBudget: number;
  readonly lastSuccessAt: string | null;
  readonly consecutiveFailures: number;
  readonly attempts: readonly SourceBreachAttempt[];
  readonly urlChecked: string;
  readonly ownerSlots?: string;
}

// ============================================================================
// Source registry
// ============================================================================

/**
 * The fetch lane's surface, restated here for the lane-exclusivity
 * invariant: the 2 congressional seeds (`congress-legislators-current`,
 * `tiger-cd119`, matched by real, stable `CanonicalSourceSeed.id`) plus the
 * muni-derived ward-ArcGIS family (matched NOT by id — the real producer,
 * `ChangeDetector.getAllCanonicalSources`, emits numeric autoincrement ids
 * for every muni-derived source, per `sources.id INTEGER PRIMARY KEY
 * AUTOINCREMENT` in db/schema.sql — but by URL shape, since every ward
 * source is discovered as an ArcGIS FeatureServer/MapServer endpoint,
 * per ward-registry.ts's own doc comment). There is no invented
 * `ward-arcgis-{city}` id anywhere in this module; membership in the
 * ward-arcgis family is derived from the real `CanonicalSource.url` the
 * producer returns, never from a hand-written string.
 */
export const FETCH_LANE_SEED_IDS: readonly string[] = [
  'congress-legislators-current',
  'tiger-cd119',
];

/**
 * True if a real canonical-source URL belongs to the ward-arcgis family:
 * a municipal ArcGIS REST endpoint serving a FeatureServer or MapServer
 * layer (ward-registry.ts:34, "ArcGIS FeatureServer layer URL"; municipal
 * council-district sources also occasionally live on MapServer — see
 * regional-aggregators.ts's Toledo entry). This is the ONLY test used to
 * decide ward-family membership anywhere in this module or the prober —
 * never an id prefix, because muni-derived ledger rows carry numeric ids.
 */
export function isWardArcgisFamilyUrl(url: string): boolean {
  return /\/(FeatureServer|MapServer)(\/|$)/i.test(url);
}

function urlOf(url: SourceHealthConfig['url']): string {
  return typeof url === 'string' ? url : url.template;
}

export const SOURCE_REGISTRY: readonly SourceHealthConfig[] = [
  {
    id: 'tiger-cd119',
    class: 'boundary-geometry',
    url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_us_cd119.zip',
    configSite: 'providers/tiger-manifest.ts:107; detector seed acquisition/change-detector.ts:167',
    expectedIntervalDays: 400,
    retryBudget: 3,
    freshness: 'vintage',
    ownerSlots: 'cd (slot 0)',
    lane: 'fetch',
    // fetch-lane sources carry no `probe` config; the next-vintage window
    // check for this source lives on the probe-lane row below
    // (`tiger-cd119@next-vintage` is a distinct registry entry so the
    // window-gated probe has its own lane:'probe' config, per the design's
    // "TIGER{next} CD URL (July-Oct)" probe target).
  },
  {
    id: 'tiger-cd119@next-vintage',
    class: 'boundary-geometry',
    url: {
      template: 'https://www2.census.gov/geo/tiger/TIGER{nextYear}/CD/tl_{nextYear}_us_cd119.zip',
      params: ['nextYear'],
    },
    configSite: 'providers/tiger-manifest.ts:107; detector seed acquisition/change-detector.ts:167',
    expectedIntervalDays: 400,
    retryBudget: 3,
    freshness: 'vintage',
    ownerSlots: 'cd (slot 0)',
    lane: 'probe',
    probe: {
      method: 'head',
      nextVintage: { template: 'https://www2.census.gov/geo/tiger/TIGER{nextYear}/CD/tl_{nextYear}_us_cd119.zip', windowMonths: [7, 8, 9, 10] },
    },
  },
  {
    id: 'tiger-state-cd',
    class: 'boundary-geometry',
    url: {
      template: 'https://www2.census.gov/geo/tiger/TIGER{vintage}/CD/tl_{vintage}_{state}_cd.zip',
      params: ['vintage', 'state'],
    },
    configSite: 'acquisition/change-detection-adapter.ts:233-242',
    expectedIntervalDays: 400,
    retryBudget: 3,
    freshness: 'vintage',
    ownerSlots: 'cd per BAF map',
    lane: 'probe',
    probe: { method: 'head', sample: 'rotate-daily' },
  },
  {
    id: 'tiger-state-sldu',
    class: 'boundary-geometry',
    url: {
      template: 'https://www2.census.gov/geo/tiger/TIGER{vintage}/SLDU/tl_{vintage}_{state}_sldu.zip',
      params: ['vintage', 'state'],
    },
    configSite: 'acquisition/change-detection-adapter.ts:233-242',
    expectedIntervalDays: 400,
    retryBudget: 3,
    freshness: 'vintage',
    ownerSlots: 'sldu per BAF map',
    lane: 'probe',
    probe: { method: 'head', sample: 'rotate-daily' },
  },
  {
    id: 'tiger-state-sldl',
    class: 'boundary-geometry',
    url: {
      template: 'https://www2.census.gov/geo/tiger/TIGER{vintage}/SLDL/tl_{vintage}_{state}_sldl.zip',
      params: ['vintage', 'state'],
    },
    configSite: 'acquisition/change-detection-adapter.ts:233-242',
    expectedIntervalDays: 400,
    retryBudget: 3,
    freshness: 'vintage',
    ownerSlots: 'sldl per BAF map',
    lane: 'probe',
    probe: { method: 'head', sample: 'rotate-daily' },
  },
  {
    id: 'tiger-state-county',
    class: 'boundary-geometry',
    url: {
      template: 'https://www2.census.gov/geo/tiger/TIGER{vintage}/COUNTY/tl_{vintage}_{state}_county.zip',
      params: ['vintage', 'state'],
    },
    configSite: 'acquisition/change-detection-adapter.ts:233-242',
    expectedIntervalDays: 400,
    retryBudget: 3,
    freshness: 'vintage',
    ownerSlots: 'county per BAF map',
    lane: 'probe',
    probe: { method: 'head', sample: 'rotate-daily' },
  },
  {
    id: 'tiger-place',
    class: 'boundary-geometry',
    url: 'https://www2.census.gov/geo/tiger/TIGER2024/PLACE/tl_2024_us_place.zip',
    configSite: 'providers/tiger-place.ts:423; national providers/census/census-tiger-parser.ts:260',
    expectedIntervalDays: 400,
    retryBudget: 3,
    freshness: 'vintage',
    ownerSlots: 'place',
    lane: 'probe',
    probe: { method: 'head' },
  },
  {
    id: 'tiger-tract-centroids',
    class: 'boundary-geometry',
    url: 'https://www2.census.gov/geo/tiger/TIGER2024/TRACT/',
    configSite: 'hydration/tract-centroid-index.ts:49,126',
    expectedIntervalDays: 400,
    retryBudget: 3,
    freshness: 'vintage',
    ownerSlots: 'PIP substrate (all slots)',
    lane: 'probe',
    probe: { method: 'head', sample: 'rotate-daily' },
  },
  {
    id: 'tiger-national-aiannh',
    class: 'boundary-geometry',
    url: 'https://www2.census.gov/geo/tiger/TIGER2024/AIANNH/tl_2024_us_aiannh.zip',
    configSite: 'providers/tiger-manifest.ts:93-183',
    expectedIntervalDays: 400,
    retryBudget: 3,
    freshness: 'vintage',
    ownerSlots: 'context + aiannh',
    lane: 'probe',
    probe: { method: 'head', sample: 'rotate-daily' },
  },
  {
    id: 'tiger-national-cbsa',
    class: 'boundary-geometry',
    url: 'https://www2.census.gov/geo/tiger/TIGER2024/CBSA/tl_2024_us_cbsa.zip',
    configSite: 'providers/tiger-manifest.ts:93-183',
    expectedIntervalDays: 400,
    retryBudget: 3,
    freshness: 'vintage',
    ownerSlots: 'context + aiannh',
    lane: 'probe',
    probe: { method: 'head', sample: 'rotate-daily' },
  },
  {
    id: 'tiger-national-state',
    class: 'boundary-geometry',
    url: 'https://www2.census.gov/geo/tiger/TIGER2024/STATE/tl_2024_us_state.zip',
    configSite: 'providers/tiger-manifest.ts:93-183',
    expectedIntervalDays: 400,
    retryBudget: 3,
    freshness: 'vintage',
    ownerSlots: 'context + aiannh',
    lane: 'probe',
    probe: { method: 'head', sample: 'rotate-daily' },
  },
  {
    id: 'tiger-national-county',
    class: 'boundary-geometry',
    url: 'https://www2.census.gov/geo/tiger/TIGER2024/COUNTY/tl_2024_us_county.zip',
    configSite: 'providers/tiger-manifest.ts:93-183',
    expectedIntervalDays: 400,
    retryBudget: 3,
    freshness: 'vintage',
    ownerSlots: 'context + aiannh',
    lane: 'probe',
    probe: { method: 'head', sample: 'rotate-daily' },
  },
  {
    id: 'tiger-national-zcta520',
    class: 'boundary-geometry',
    url: 'https://www2.census.gov/geo/tiger/TIGER2024/ZCTA520/tl_2024_us_zcta520.zip',
    configSite: 'providers/tiger-manifest.ts:93-183',
    expectedIntervalDays: 400,
    retryBudget: 3,
    freshness: 'vintage',
    ownerSlots: 'context + aiannh',
    lane: 'probe',
    probe: { method: 'head', sample: 'rotate-daily' },
  },
  {
    id: 'tiger-national-uac',
    class: 'boundary-geometry',
    url: 'https://www2.census.gov/geo/tiger/TIGER2024/UAC/tl_2024_us_uac.zip',
    configSite: 'providers/tiger-manifest.ts:93-183',
    expectedIntervalDays: 400,
    retryBudget: 3,
    freshness: 'vintage',
    ownerSlots: 'context + aiannh',
    lane: 'probe',
    probe: { method: 'head', sample: 'rotate-daily' },
  },
  {
    id: 'tiger-national-mil',
    class: 'boundary-geometry',
    url: 'https://www2.census.gov/geo/tiger/TIGER2024/MIL/tl_2024_us_mil.zip',
    configSite: 'providers/tiger-manifest.ts:93-183',
    expectedIntervalDays: 400,
    retryBudget: 3,
    freshness: 'vintage',
    ownerSlots: 'context + aiannh',
    lane: 'probe',
    probe: { method: 'head', sample: 'rotate-daily' },
  },
  {
    id: 'bef-cd119',
    class: 'boundary-geometry',
    url: 'https://www2.census.gov/programs-surveys/decennial/rdo/mapping-files/2025/119-congressional-district-befs/cd119.zip',
    configSite: 'hydration/bef-overlay.ts:33',
    expectedIntervalDays: 800,
    retryBudget: 3,
    freshness: 'vintage',
    ownerSlots: 'cd overlay',
    lane: 'probe',
    probe: { method: 'head' },
  },
  {
    id: 'baf-2020',
    class: 'boundary-assignment',
    url: {
      template: 'https://www2.census.gov/geo/docs/maps-data/data/baf2020/BAF2020_{ST}.zip',
      params: ['ST'],
    },
    configSite: 'hydration/baf-downloader.ts:8,49; entities L10-13',
    // frozen 2020 product; revised only on mid-decade redistricting — no
    // staleness clock. Daily reachability still tracked via the probe lane's
    // date-rotated sample across the 56-file family.
    expectedIntervalDays: null,
    retryBudget: 3,
    freshness: 'frozen',
    ownerSlots: 'slots 0-5, 7-9, 20-21 (jurisdiction.ts:262)',
    lane: 'probe',
    probe: { method: 'head', sample: 'rotate-daily' },
  },
  {
    // Aggregate template row for the ward-arcgis family — NOT a real
    // fetchable URL (the real producer emits one numeric-id row per city;
    // see isWardArcgisFamilyUrl). This row's SLO is evaluated by
    // aggregating every muni ledger row whose recorded URL matched the
    // ward-arcgis family (see evaluateSourceHealth's `wardArcgisLedgerIds`
    // param, computed by the caller from a real getAllCanonicalSources()
    // walk) — never by looking up a ledger row keyed literally 'ward-arcgis'.
    id: 'ward-arcgis',
    class: 'municipal',
    url: {
      template: '{city-featureserver-url}',
      params: ['city'],
    },
    configSite: 'hydration/ward-registry.ts:34',
    expectedIntervalDays: 30,
    retryBudget: 5,
    freshness: 'rolling',
    ownerSlots: 'ward (slot 6)',
    // Explicit lane: 'fetch' — per-city FeatureServer/MapServer endpoints
    // enter through the change-DB muni selections that
    // getAllCanonicalSources walks, and are deliberately excluded from the
    // probe list (lane exclusivity — a probe 200 would reset
    // consecutive_failures accrued by failing content fetches). Because
    // muni sources carry numeric autoincrement ids (never a stable
    // 'ward-arcgis-{city}' string), the prober's startup assertion checks
    // for the PRESENCE of at least one ward-family URL in the real
    // getAllCanonicalSources() output, not an id match.
    lane: 'fetch',
  },
  {
    id: 'addrfeat',
    class: 'address',
    url: 'https://www2.census.gov/geo/tiger/TIGER2024/ADDRFEAT/',
    configSite: "scripts/build-address-index.ts:336 (directory-index crawl), --addrfeat-vintage L164-165",
    expectedIntervalDays: 400,
    retryBudget: 3,
    freshness: 'vintage',
    ownerSlots: 'address src:1',
    lane: 'probe',
    probe: { method: 'get', sample: 'rotate-daily' },
  },
  {
    id: 'nad',
    class: 'address',
    // The operator can override this per-dispatch (quarterly workflow input
    // `nad_url`), but the workflow's own default — and thus the stable daily
    // probe target — is this DOT/data.transportation.gov release endpoint
    // (shadow-atlas-quarterly.yml:81, `inputs.nad_url.default`).
    url: 'https://data.transportation.gov/download/fc2s-wawr/application/x-zip-compressed',
    configSite: "quarterly workflow input nad_url (shadow-atlas-quarterly.yml:78-84); vintage gate distribution/addresses/nad-vintage.ts:18-35",
    expectedIntervalDays: 120,
    retryBudget: 3,
    freshness: 'vintage',
    ownerSlots: 'address src:0',
    lane: 'probe',
    probe: { method: 'head' },
  },
  {
    id: 'congress-legislators-current',
    class: 'officials',
    url: 'https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-current.yaml',
    configSite: 'detector seed acquisition/change-detector.ts:154-174; ingest scripts/ingest-legislators.ts:85-86',
    expectedIntervalDays: 7,
    retryBudget: 3,
    freshness: 'rolling',
    ownerSlots: 'US federal officials',
    // Fetch-lane seed — see FETCH_LANE_SEED_IDS. NEVER probed by the
    // content-clock probe pass: dual-writing would let a bare HEAD 200
    // reset consecutive_failures accumulated by a failing checksum check on
    // the exact same URL. It DOES get a daily reachability probe into the
    // separate probe_consecutive_failures/last_probe_at columns (see
    // probeFetchLaneReachability in source-prober.ts) — cadence fix for the
    // due-filtered content clock (checkScheduledSources only content-checks
    // this row in January).
    lane: 'fetch',
  },
  {
    id: 'tigerweb-cd',
    class: 'officials',
    url: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/54',
    configSite: 'providers/international/us-provider.ts:216-217',
    expectedIntervalDays: 30,
    retryBudget: 3,
    freshness: 'rolling',
    ownerSlots: 'CD geometry service',
    lane: 'probe',
    probe: { method: 'get', url: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/54?f=json' },
  },
  {
    id: 'uk-mps',
    class: 'officials',
    url: 'https://members-api.parliament.uk/',
    configSite: 'scripts/ingest-uk-mps.ts:102',
    expectedIntervalDays: 30,
    retryBudget: 3,
    freshness: 'rolling',
    ownerSlots: 'UK officials',
    lane: 'probe',
    probe: { method: 'head' },
  },
  {
    id: 'ca-mps',
    class: 'officials',
    url: 'https://represent.opennorth.ca/',
    configSite: 'scripts/ingest-canadian-mps.ts:93',
    expectedIntervalDays: 30,
    retryBudget: 3,
    freshness: 'rolling',
    ownerSlots: 'CA officials',
    lane: 'probe',
    probe: { method: 'get' },
  },
  {
    id: 'au-mps',
    class: 'officials',
    // The real ingest target (ingest-au-mps.ts's own BASE_URL, L183) — not
    // the bare origin, which is a different (and less representative) page.
    url: 'https://www.aph.gov.au/Senators_and_Members/Parliamentarian_Search_Results',
    configSite: 'scripts/ingest-au-mps.ts:183 (BASE_URL)',
    expectedIntervalDays: 30,
    retryBudget: 5,
    freshness: 'rolling',
    ownerSlots: 'AU officials',
    lane: 'probe',
    probe: { method: 'get' },
  },
  {
    id: 'nz-mps',
    class: 'officials',
    // The real, actually-fetched CSV download (ingest-nz-mps.ts:333's
    // `downloadUrl`) — NOT the DATA_GOVT_NZ_URL constant at L126, which is
    // declared but never used by any fetch call in that script (a dataset
    // catalogue page, not the resource download).
    url: 'https://catalogue.data.govt.nz/dataset/d97b9a53-4660-4dd5-89df-6c4536e92a02/resource/89069a40-abcf-4190-9665-3513ff004dd8/download/mp-contact-details.csv',
    configSite: 'scripts/ingest-nz-mps.ts:333 (downloadUrl, the real fetch target)',
    expectedIntervalDays: 30,
    retryBudget: 5,
    freshness: 'rolling',
    ownerSlots: 'NZ officials',
    lane: 'probe',
    probe: { method: 'get' },
  },
  {
    id: 'redraw-signal',
    class: 'signal',
    url: '{redraw-signal-feed}',
    configSite: 'commons src/lib/core/shadow-atlas/redraw-guard.ts + redraw-signal.data.ts',
    // manual until a feed is provisioned (ledger item, ELEVATED 2026-07-04) —
    // hand-curated today, no feed wired.
    expectedIntervalDays: null,
    retryBudget: 3,
    freshness: 'manual',
    ownerSlots: 'redraw guard',
    lane: 'none',
  },
  {
    // dc-urls' configSite (config/providers.ts) still resolves post-P16's
    // RDH removal sweep — DC_URLS.arcgisBase is defined there (currently at
    // config/providers.ts:132-134); this row stays manual-dormant honestly
    // (referenced by code, not scheduled by any lane) rather than claiming
    // a cadence nothing enforces.
    id: 'dc-urls',
    class: 'infra',
    url: 'https://maps2.dcgis.dc.gov/dcgis/rest/services',
    configSite: 'config/providers.ts:132 (DC_URLS.arcgisBase)',
    // dormant — referenced but not scheduled.
    expectedIntervalDays: null,
    retryBudget: 3,
    freshness: 'manual',
    ownerSlots: 'DC',
    lane: 'none',
  },
  {
    id: 'ipfs-gateways',
    class: 'infra',
    url: 'https://ipfs.io',
    configSite: 'config/providers.ts:174-180',
    expectedIntervalDays: 7,
    retryBudget: 3,
    freshness: 'rolling',
    ownerSlots: 'serving, not acquisition — escalate-only, never in the fix lane',
    lane: 'probe',
    probe: { method: 'head' },
  },
  // ==========================================================================
  // Wave 1 (P17-wave1-ingest, 2026-07-04) — six new national/near-national
  // sources filling previously-empty slots. See docs/design/
  // MISSING-SLOTS-SOURCING.md (commons repo) for the founder-approved sourcing
  // brief and per-source license verification. Ranks 1-3 and the addendum
  // reuse the existing TIGER path (config-level additions, no new fetch
  // infra); ranks 4-5 are genuinely new single-national-layer sources.
  // ==========================================================================
  {
    // Rank 1: TIGER 2020 PL VTDs -> slot 21. Reuses the TIGER county/VTD FTP
    // path (providers/tiger-boundary-provider.ts, layer 'vtd') with the 2020
    // PL product year — CC0, national, MT/OR partial, frozen until 2030.
    //
    // URL template corrected 2026-07-04 (P17-wave1-ingest): the original
    // template here (STATE/{vintage}/{state}/...) 404s — verified live
    // against the real TIGER2020PL/STATE/ directory listing, whose actual
    // segment is `{fips}_{STATE_NAME_UPPER}` (e.g. `44_RHODE_ISLAND`), not a
    // vintage-year folder. Cross-checked against the same fix applied to
    // TIGERBoundaryProvider.getStateFileUrl's vtd special-case, which this
    // probe target must stay consistent with.
    id: 'tiger-2020pl-vtd',
    class: 'boundary-geometry',
    url: {
      template: 'https://www2.census.gov/geo/tiger/TIGER2020PL/STATE/{stateFips}_{stateNameUpper}/{stateFips}/tl_2020_{stateFips}_vtd20.zip',
      params: ['stateFips', 'stateNameUpper'],
    },
    configSite: 'jurisdiction.ts:330 (vtd/voting_precinct alias -> slot 21); providers/tiger-boundary-provider.ts (layer vtd, getVtd2020PlUrl)',
    // frozen 2020 product — no redistricting-style staleness clock until 2030.
    expectedIntervalDays: null,
    retryBudget: 3,
    freshness: 'frozen',
    ownerSlots: 'voting_precinct/vtd (slot 21)',
    lane: 'probe',
    probe: { method: 'head' },
  },
  {
    // Rank 2: Census tracts -> slot 23 (label 'statistical', not governance).
    // Reuses the same national TIGER layer path as ranks 1/3 (providers/
    // tiger-boundary-provider.ts, layer 'tract' — already defined there).
    id: 'tiger-tract',
    class: 'boundary-geometry',
    url: {
      template: 'https://www2.census.gov/geo/tiger/TIGER{vintage}/TRACT/tl_{vintage}_{state}_tract.zip',
      params: ['vintage', 'state'],
    },
    configSite: 'jurisdiction.ts:334 (tract/statistical alias -> slot 23); providers/tiger-boundary-provider.ts (layer tract)',
    expectedIntervalDays: 400,
    retryBudget: 3,
    freshness: 'vintage',
    ownerSlots: 'statistical/tract (slot 23, overflow)',
    lane: 'probe',
    probe: { method: 'head' },
  },
  {
    // Rank 3: federal judicial districts -> slot 19. Derived (statute
    // dissolve over TIGER counties), not directly fetched — the probe
    // target is the underlying TIGER county layer this dissolve depends on.
    // DOJ US Attorneys directory is a secondary validation source (JS-
    // rendered; not machine-probed here).
    id: 'tiger-county-for-judicial-dissolve',
    class: 'boundary-geometry',
    url: 'https://www2.census.gov/geo/tiger/TIGER2024/COUNTY/tl_2024_us_county.zip',
    configSite: 'providers/judicial-district-provider.ts (dissolveJudicialDistricts); jurisdiction.ts:326 (judicial alias -> slot 19)',
    expectedIntervalDays: 400,
    retryBudget: 3,
    freshness: 'vintage',
    ownerSlots: 'judicial (slot 19)',
    lane: 'probe',
    probe: { method: 'head' },
  },
  {
    // Rank 4: EPA Community Water System Service Area Boundaries v3 ->
    // slot 11. Label 'service-area' (drinking water, not governance);
    // per-feature authoritative(60%)/EPA-modeled(40%) split. SIGNED PUBLISH
    // blocked on O8-license-confirms — see publishExclusion on the provider
    // output; ingest-dev may proceed ahead of the confirm.
    id: 'epa-cws-sab-v3',
    class: 'boundary-geometry',
    url: 'https://github.com/USEPA/ORD_SAB_Model/raw/refs/heads/main/Version_History/PWS_Boundaries_Latest.zip',
    configSite: 'providers/epa-cws-provider.ts',
    expectedIntervalDays: 400,
    retryBudget: 3,
    freshness: 'vintage',
    ownerSlots: 'water_sewer (slot 11) — service-area label, publish-gated on O8',
    lane: 'probe',
    probe: { method: 'head' },
  },
  {
    // Rank 5: EIA Electric Retail Service Territories -> slot 18. Label
    // 'service-area' (incl. IOUs, no elected board). SIGNED PUBLISH blocked
    // on O8-license-confirms (DOE-contractor/ORNL provenance + third-party
    // carve-out). The authoritative atlas.eia.gov org's own FeatureServer
    // item id could not be resolved live in this session (its ArcGIS Hub
    // "about" pages are JS-rendered); this URL is a verified-live, commonly-
    // mirrored HIFLD-derived copy of the same layer — O8's operator-run
    // license confirmation must re-verify the canonical EIA source before
    // any signed publish, independent of which mirror ingest-dev used.
    id: 'eia-electric-retail-service-territories',
    class: 'boundary-geometry',
    url: 'https://services6.arcgis.com/BAJNi3EgCdtQ1BCG/arcgis/rest/services/Electric_Retail_Service_Territories/FeatureServer',
    configSite: 'providers/eia-territories-provider.ts',
    expectedIntervalDays: 400,
    retryBudget: 3,
    freshness: 'vintage',
    ownerSlots: 'utility (slot 18) — service-area label, publish-gated on O8',
    lane: 'probe',
    probe: { method: 'head' },
  },
  {
    // Addendum rank: USGS Watershed Boundary Dataset (HUC-8/10/12) -> slot
    // 17. Label 'hydrologic' — hydrologic units, NOT governance districts.
    // US federal work -> public domain; NOT O8-gated (no license ambiguity
    // like EPA/EIA). Closes Cicero's WATERSHED type.
    id: 'usgs-wbd',
    class: 'boundary-geometry',
    url: 'https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer',
    configSite: 'providers/usgs-wbd-provider.ts; jurisdiction.ts:337 (hydrologic/huc/watershed alias -> slot 17)',
    expectedIntervalDays: 400,
    retryBudget: 3,
    freshness: 'vintage',
    ownerSlots: 'hydrologic/huc (slot 17)',
    lane: 'probe',
    probe: { method: 'head' },
  },
  // ==========================================================================
  // Precinct currency overlays (docs/design/PRECINCT-CURRENCY-LANE.md §4,
  // commons repo) -> slot 21 overlay (never displaces the frozen 2020 VTD
  // baseline at `tiger-vtd` above). 23 CONFIRMED-state rows; lane split
  // exactly per §4: `fetch` reserved for the 3 rolling/cheap-checksum
  // sources (AR FeatureServer, NC S3 listing, UT item JSON), `probe` for the
  // other 20. `expectedIntervalDays` copied verbatim from §4's table --
  // never re-derived or guessed. `configSite` points at each state's row in
  // PRECINCT_OVERLAY_CONFIGS (providers/precinct-overlay-provider.ts).
  // ==========================================================================
  {
    id: 'precinct-ar',
    class: 'boundary-geometry',
    url: 'https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Boundaries/FeatureServer/11',
    configSite: 'providers/precinct-overlay-provider.ts (PRECINCT_OVERLAY_CONFIGS.AR)',
    expectedIntervalDays: 90,
    retryBudget: 6,
    freshness: 'rolling',
    ownerSlots: '21',
    lane: 'fetch',
  },
  {
    id: 'precinct-ca',
    class: 'boundary-geometry',
    url: 'https://statewidedatabase.org/election.html',
    configSite: 'providers/precinct-overlay-provider.ts (PRECINCT_OVERLAY_CONFIGS.CA)',
    expectedIntervalDays: 400,
    retryBudget: 6,
    freshness: 'vintage',
    ownerSlots: '21',
    lane: 'probe',
    probe: { method: 'conditional-get' },
  },
  {
    id: 'precinct-hi',
    class: 'boundary-geometry',
    url: 'https://geodata.hawaii.gov/arcgis/rest/services/AdminBnd/MapServer/13?f=pjson',
    configSite: 'providers/precinct-overlay-provider.ts (PRECINCT_OVERLAY_CONFIGS.HI)',
    expectedIntervalDays: 780,
    retryBudget: 6,
    freshness: 'vintage',
    ownerSlots: '21',
    lane: 'probe',
    probe: { method: 'get' },
  },
  {
    id: 'precinct-id',
    class: 'boundary-geometry',
    url: 'https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Idaho_Voting_Precincts_Precinct_Boundaries_-_Master_Data_-_DO_NOT_SHARE_view/FeatureServer?f=json',
    configSite: 'providers/precinct-overlay-provider.ts (PRECINCT_OVERLAY_CONFIGS.ID)',
    expectedIntervalDays: 780,
    retryBudget: 6,
    freshness: 'vintage',
    ownerSlots: '21',
    lane: 'probe',
    probe: { method: 'get' },
  },
  {
    id: 'precinct-in',
    class: 'boundary-geometry',
    // Without f=json, ArcGIS Server returns the browsable HTML "REST
    // Services Directory" page (live-verified 2026-07-04, text/html) --
    // harmless for a plain reachability probe but inconsistent with every
    // sibling row's f=json/f=pjson suffix and yields no parseable metadata.
    url: 'https://gisdata.in.gov/server/rest/services/Hosted/Voting_District_Boundaries_2024/FeatureServer?f=json',
    configSite: 'providers/precinct-overlay-provider.ts (PRECINCT_OVERLAY_CONFIGS.IN)',
    expectedIntervalDays: 400,
    retryBudget: 6,
    freshness: 'vintage',
    ownerSlots: '21',
    lane: 'probe',
    probe: {
      method: 'get',
      nextVintage: { template: 'Voting_District_Boundaries_{yyyy}', windowMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
    },
  },
  {
    id: 'precinct-ia',
    class: 'boundary-geometry',
    url: 'https://services.arcgis.com/vPD5PVLI6sfkZ5E4/arcgis/rest/services/Iowa_Precincts/FeatureServer?f=json',
    configSite: 'providers/precinct-overlay-provider.ts (PRECINCT_OVERLAY_CONFIGS.IA)',
    // decennial reprecincting + opportunistic corrections -- honest interval,
    // probe still runs daily (§4's own reasoning for this row, verbatim).
    expectedIntervalDays: 3650,
    retryBudget: 6,
    freshness: 'vintage',
    ownerSlots: '21',
    lane: 'probe',
    probe: { method: 'get' },
  },
  {
    id: 'precinct-md',
    class: 'boundary-geometry',
    url: 'https://mdgeodata.md.gov/imap/rest/services/Boundaries/MD_ElectionBoundaries/FeatureServer/2?f=pjson',
    configSite: 'providers/precinct-overlay-provider.ts (PRECINCT_OVERLAY_CONFIGS.MD)',
    expectedIntervalDays: 400,
    retryBudget: 6,
    freshness: 'rolling',
    ownerSlots: '21',
    lane: 'probe',
    probe: { method: 'get' },
  },
  {
    id: 'precinct-ma',
    class: 'boundary-geometry',
    // gis.data.mass.gov/datasets/... is a Hub page (text/html); the live
    // FeatureServer resolved from AGOL item 6d4ae7efad4f4c77907db7cbfb012e64
    // (see PRECINCT_OVERLAY_CONFIGS.MA) is the real probe target.
    url: 'https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/WardsPrecincts2022/FeatureServer?f=json',
    configSite: 'providers/precinct-overlay-provider.ts (PRECINCT_OVERLAY_CONFIGS.MA)',
    expectedIntervalDays: 730,
    retryBudget: 6,
    freshness: 'rolling',
    ownerSlots: '21',
    lane: 'probe',
    probe: { method: 'get' },
  },
  {
    id: 'precinct-mi',
    class: 'boundary-geometry',
    // gis-michigan.opendata.arcgis.com/datasets/... is a Hub page
    // (text/html); the live FeatureServer resolved from AGOL item
    // 02d40893317d46569017beeb14f9c63e (see PRECINCT_OVERLAY_CONFIGS.MI) is
    // the real probe target.
    url: 'https://gisagocss.state.mi.us/arcgis/rest/services/OpenData/boundaries/MapServer/9?f=json',
    configSite: 'providers/precinct-overlay-provider.ts (PRECINCT_OVERLAY_CONFIGS.MI)',
    expectedIntervalDays: 780,
    retryBudget: 6,
    freshness: 'vintage',
    ownerSlots: '21',
    lane: 'probe',
    // AGOL search JSON (owner:michigan_admin title:"Voting Precincts") --
    // picks up new cycle items rather than a pinned year (§4, verbatim).
    probe: { method: 'get' },
  },
  {
    id: 'precinct-mt',
    class: 'boundary-geometry',
    url: 'https://ftpgeoinfo.msl.mt.gov/Data/Spatial/MSDI/AdministrativeBoundaries/MontanaVotingPrecincts_shp.zip',
    configSite: 'providers/precinct-overlay-provider.ts (PRECINCT_OVERLAY_CONFIGS.MT)',
    expectedIntervalDays: 730,
    retryBudget: 6,
    freshness: 'rolling',
    ownerSlots: '21',
    lane: 'probe',
    probe: { method: 'head' },
  },
  {
    id: 'precinct-nh',
    class: 'boundary-geometry',
    url: 'https://ftp.granit.unh.edu/GRANIT_Data/Vector_Data/Administrative_and_Political_Boundaries/d-nhpolitdists/',
    configSite: 'providers/precinct-overlay-provider.ts (PRECINCT_OVERLAY_CONFIGS.NH)',
    expectedIntervalDays: 3650,
    retryBudget: 6,
    freshness: 'vintage',
    ownerSlots: '21',
    lane: 'probe',
    probe: { method: 'get' },
  },
  {
    id: 'precinct-nm',
    class: 'boundary-geometry',
    url: 'https://www.sos.nm.gov/voting-and-elections/data-and-maps/gis-voting-district-data/',
    configSite: 'providers/precinct-overlay-provider.ts (PRECINCT_OVERLAY_CONFIGS.NM)',
    expectedIntervalDays: 730,
    retryBudget: 6,
    freshness: 'rolling',
    ownerSlots: '21',
    lane: 'probe',
    // New vintages get new UUIDs -- watch the SOS clearinghouse page, not a
    // pinned UUID (§4/§2.1, verbatim).
    probe: { method: 'conditional-get' },
  },
  {
    id: 'precinct-ny',
    class: 'boundary-geometry',
    url: 'https://services6.arcgis.com/EbVsqZ18sv1kVJ3k/arcgis/rest/services/NYS_Elections_Districts_and_Polling_Locations/FeatureServer?f=json',
    configSite: 'providers/precinct-overlay-provider.ts (PRECINCT_OVERLAY_CONFIGS.NY)',
    expectedIntervalDays: 365,
    retryBudget: 6,
    freshness: 'rolling',
    ownerSlots: '21',
    lane: 'probe',
    probe: { method: 'get' },
  },
  {
    id: 'precinct-nc',
    class: 'boundary-geometry',
    // The dl.ncsbe.gov custom-domain form (with or without list-type=2)
    // renders a client-side JS listing app and returns text/html, not the
    // XML checksum surface -- live-verified 2026-07-04. The direct
    // s3.amazonaws.com ListObjectsV2 form returns real XML against the same
    // bucket (per §2.1's own "direct S3 list-type=2 query" evidence).
    url: 'https://s3.amazonaws.com/dl.ncsbe.gov?list-type=2&prefix=ShapeFiles/Precinct/',
    configSite: 'providers/precinct-overlay-provider.ts (PRECINCT_OVERLAY_CONFIGS.NC)',
    expectedIntervalDays: 180,
    retryBudget: 6,
    freshness: 'rolling',
    ownerSlots: '21',
    lane: 'fetch',
  },
  {
    id: 'precinct-nd',
    class: 'boundary-geometry',
    url: 'https://www.sos.nd.gov/sites/default/files/documents/elections/map-shape-files/voting-shape-files-2026.zip',
    configSite: 'providers/precinct-overlay-provider.ts (PRECINCT_OVERLAY_CONFIGS.ND)',
    expectedIntervalDays: 780,
    retryBudget: 6,
    freshness: 'vintage',
    ownerSlots: '21',
    lane: 'probe',
    probe: {
      method: 'head',
      nextVintage: { template: 'voting-shape-files-{yyyy}.zip', windowMonths: [1, 2, 3, 4] },
    },
  },
  {
    id: 'precinct-ri',
    class: 'boundary-geometry',
    // www.rigis.org/datasets/.../about is a Hub "about" page (text/html),
    // live-verified 2026-07-04 -- same defect class as the MI/UT/MA/VT
    // findings, caught on a full-roster re-audit. The live FeatureServer
    // (item 9104ca2e5e9b4cdb9985e8935ef2514d, see
    // PRECINCT_OVERLAY_CONFIGS.RI, already re-derived in that provider
    // config) is the real probe target.
    url: 'https://services2.arcgis.com/S8zZg9pg23JUEexQ/arcgis/rest/services/BND_Voting_Precincts_2022/FeatureServer?f=json',
    configSite: 'providers/precinct-overlay-provider.ts (PRECINCT_OVERLAY_CONFIGS.RI)',
    expectedIntervalDays: 730,
    retryBudget: 6,
    freshness: 'vintage',
    ownerSlots: '21',
    lane: 'probe',
    probe: { method: 'get' },
  },
  {
    id: 'precinct-sc',
    class: 'boundary-geometry',
    url: 'https://rfa.sc.gov/programs-services/precinct-demographics/jurisdictional-mapping/political-gis-data',
    configSite: 'providers/precinct-overlay-provider.ts (PRECINCT_OVERLAY_CONFIGS.SC)',
    expectedIntervalDays: 400,
    retryBudget: 6,
    freshness: 'rolling',
    ownerSlots: '21',
    // WAF risk: treat 403/timeout as reachability-unknown -> escalate to a
    // browser-grade fallback, not a fetch-breach (§4, verbatim).
    lane: 'probe',
    probe: { method: 'get' },
  },
  {
    id: 'precinct-tx',
    class: 'boundary-geometry',
    url: 'https://data.capitol.texas.gov/api/3/action/package_show?id=vtds',
    configSite: 'providers/precinct-overlay-provider.ts (PRECINCT_OVERLAY_CONFIGS.TX)',
    expectedIntervalDays: 780,
    retryBudget: 6,
    freshness: 'vintage',
    ownerSlots: '21',
    // CKAN API, NOT the Cloudflare-fronted HTML (§4, verbatim).
    lane: 'probe',
    probe: { method: 'get' },
  },
  {
    id: 'precinct-ut',
    class: 'boundary-geometry',
    // gis.utah.gov/products/sgid/... is a product-description HTML page,
    // not the item JSON §4 specifies; the live FeatureServer resolved from
    // AGOL item d33f596419d74948a45070275632b8e0 (see
    // PRECINCT_OVERLAY_CONFIGS.UT) is the real checksum-fetch target.
    url: 'https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/VistaBallotAreas/FeatureServer/0?f=json',
    configSite: 'providers/precinct-overlay-provider.ts (PRECINCT_OVERLAY_CONFIGS.UT)',
    expectedIntervalDays: 180,
    retryBudget: 6,
    freshness: 'rolling',
    ownerSlots: '21',
    lane: 'fetch',
  },
  {
    id: 'precinct-vt',
    class: 'boundary-geometry',
    // geodata.vermont.gov/datasets/.../about is a Hub "about" page
    // (text/html); the live FeatureServer resolved from AGOL item
    // fae5aad934a74108812dbe8ecd6232d4 (see PRECINCT_OVERLAY_CONFIGS.VT) is
    // the real probe target.
    url: 'https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/FS_VCGI_VT_Municipal_Voting_Districts_SP_v1/FeatureServer?f=json',
    configSite: 'providers/precinct-overlay-provider.ts (PRECINCT_OVERLAY_CONFIGS.VT)',
    expectedIntervalDays: 3650,
    retryBudget: 6,
    freshness: 'vintage',
    ownerSlots: '21',
    lane: 'probe',
    probe: { method: 'get' },
  },
  {
    id: 'precinct-wa',
    class: 'boundary-geometry',
    url: 'https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Statewide_Precincts_2019General_SPS/FeatureServer?f=json',
    configSite: 'providers/precinct-overlay-provider.ts (PRECINCT_OVERLAY_CONFIGS.WA)',
    expectedIntervalDays: 400,
    retryBudget: 6,
    freshness: 'vintage',
    ownerSlots: '21',
    lane: 'probe',
    probe: {
      method: 'get',
      nextVintage: { template: 'Statewide_Precincts_{yyyy}General.zip', windowMonths: [11, 12, 1] },
    },
  },
  {
    id: 'precinct-wi',
    class: 'boundary-geometry',
    url: 'https://services1.arcgis.com/FDsAtKBk8Hy4cAH0/arcgis/rest/services/WI_Wards_Jan_2026/FeatureServer?f=json',
    configSite: 'providers/precinct-overlay-provider.ts (PRECINCT_OVERLAY_CONFIGS.WI)',
    expectedIntervalDays: 230,
    retryBudget: 6,
    freshness: 'vintage',
    ownerSlots: '21',
    lane: 'probe',
    probe: {
      method: 'get',
      nextVintage: { template: 'LTSB hub new-cycle items', windowMonths: [2, 3, 8, 9] },
    },
  },
  {
    id: 'precinct-dc',
    class: 'boundary-geometry',
    url: 'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Administrative_Other_Boundaries_WebMercator/MapServer/0?f=json',
    configSite: 'providers/precinct-overlay-provider.ts (PRECINCT_OVERLAY_CONFIGS.DC)',
    expectedIntervalDays: 730,
    retryBudget: 6,
    freshness: 'rolling',
    ownerSlots: '21',
    lane: 'probe',
    probe: { method: 'get' },
  },
];

// ============================================================================
// Registry helpers
// ============================================================================

/**
 * The pinned TIGER vintage year, parsed out of the `tiger-cd119` seed's own
 * registry URL (`.../TIGER2024/CD/tl_2024_us_cd119.zip`) — the same literal
 * `change-detector.ts`'s CONGRESSIONAL_CANONICAL_SOURCES seed and every
 * `tiger-manifest.ts` national-layer URL use. Deriving it here (rather than
 * hardcoding a second `2024` literal, or using the current calendar year —
 * TIGER{currentYear} does not exist until the vintage actually ships)
 * means the per-state/national probe URLs below can never drift from the
 * pinned vintage this repo's fetch lane actually targets.
 */
export const PINNED_TIGER_VINTAGE: number = (() => {
  const seed = SOURCE_REGISTRY.find(r => r.id === 'tiger-cd119');
  const url = seed ? urlOf(seed.url) : '';
  const match = /TIGER(\d{4})/.exec(url);
  if (!match) {
    throw new Error(
      'PINNED_TIGER_VINTAGE: could not parse a TIGER vintage year out of the tiger-cd119 registry URL'
    );
  }
  return Number(match[1]);
})();

/** The registry row's effective probe/staleness target URL, resolving
 *  a template row to its literal `.template` string (params unexpanded —
 *  callers needing a concrete URL must supply params; this is used only
 *  for reporting `urlChecked` on registry rows that are already literal). */
export function registryUrl(config: SourceHealthConfig): string {
  return urlOf(config.url);
}

// ============================================================================
// Breach evaluation (pure — no fetch, no I/O)
// ============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;

function parseTimestamp(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Look up the ledger row for a source id (or its derived
 * `<id>@next-vintage` row), returning a safe empty-row default when absent
 * (a source that has never been attempted has no ledger row yet).
 */
function findLedgerRow(
  ledgerRows: readonly SourceHealthRow[],
  sourceId: string
): SourceHealthRow | undefined {
  return ledgerRows.find(row => row.source_id === sourceId);
}

/**
 * Aggregate every ledger row belonging to the ward-arcgis family (numeric
 * muni ids, membership supplied by the caller via `wardArcgisLedgerIds` —
 * computed from a real `getAllCanonicalSources()` walk, never invented) into
 * one synthetic row shaped like a single source's ledger state:
 *   - consecutive_failures: the WORST (max) across the family — one
 *     fragile city endpoint failing repeatedly should not be diluted away
 *     by dozens of healthy ones.
 *   - last_success_at: the MOST RECENT success across the family — the SLO
 *     asks "is the ward-arcgis family reachable", and any city succeeding
 *     recently answers that.
 *   - last_error / last_attempt_at: carried from whichever row is currently
 *     driving consecutive_failures (the worst one), so the breach record's
 *     evidence points at an actual failing city endpoint.
 * Returns undefined when no ward-family ledger rows exist yet (never
 * attempted) — same "no row" semantics as any other source.
 */
function aggregateWardArcgisRow(
  ledgerRows: readonly SourceHealthRow[],
  wardArcgisLedgerIds: readonly string[]
): SourceHealthRow | undefined {
  const familyRows = ledgerRows.filter(row => wardArcgisLedgerIds.includes(row.source_id));
  if (familyRows.length === 0) return undefined;

  let worst = familyRows[0];
  let mostRecentSuccessMs = parseTimestamp(familyRows[0].last_success_at);

  for (const row of familyRows.slice(1)) {
    if (row.consecutive_failures > worst.consecutive_failures) {
      worst = row;
    }
    const successMs = parseTimestamp(row.last_success_at);
    if (successMs !== null && (mostRecentSuccessMs === null || successMs > mostRecentSuccessMs)) {
      mostRecentSuccessMs = successMs;
    }
  }

  // Earliest registered_at across the family — the family has existed (for
  // grace purposes) since its first-ever discovered member was attempted.
  let earliestRegisteredMs = parseTimestamp(familyRows[0].registered_at);
  for (const r of familyRows.slice(1)) {
    const ms = parseTimestamp(r.registered_at);
    if (ms !== null && (earliestRegisteredMs === null || ms < earliestRegisteredMs)) {
      earliestRegisteredMs = ms;
    }
  }

  return {
    source_id: 'ward-arcgis',
    last_attempt_at: worst.last_attempt_at,
    last_success_at:
      mostRecentSuccessMs !== null ? new Date(mostRecentSuccessMs).toISOString() : null,
    consecutive_failures: worst.consecutive_failures,
    last_error: worst.last_error,
    breach_state: worst.breach_state,
    breach_opened_at: worst.breach_opened_at,
    remediation_ref: worst.remediation_ref,
    probe_consecutive_failures: worst.probe_consecutive_failures,
    last_probe_at: worst.last_probe_at,
    registered_at: earliestRegisteredMs !== null ? new Date(earliestRegisteredMs).toISOString() : null,
  };
}

/**
 * evaluateSourceHealth — pure breach evaluation.
 *
 * fetch-breach:     consecutive_failures >= retryBudget
 * staleness-breach: expectedIntervalDays != null
 *                   AND now - last_success_at > expectedIntervalDays
 *                   ('frozen' never staleness-breaches; 'manual'/lane:'none'
 *                   are skipped entirely; 'vintage' sources key staleness
 *                   off the derived `<id>@next-vintage` ledger row instead
 *                   of the row's own last_success_at)
 * grace:            a source that has never succeeded gets one
 *                   expectedIntervalDays of staleness grace from
 *                   registration before staleness-breach can fire
 *                   (fetch-breach is UNAFFECTED by this grace)
 * next-vintage:     a `<id>@next-vintage` derived row is exempt from
 *                   fetch-breach entirely — the expected 404s while inside
 *                   the release window are not failures, they are the
 *                   window not having closed yet. The window-close-without-
 *                   a-2xx signal is a staleness-breach on the PARENT
 *                   vintage row (handled by the vintage staleness branch
 *                   above), not a fetch-breach on the derived row itself.
 * ward-arcgis:      the `ward-arcgis` template row's ledger state is not
 *                   looked up directly (no ledger row is ever written under
 *                   that literal id) — it is aggregated from every real
 *                   muni ledger row the caller identifies as ward-family
 *                   (`opts.wardArcgisLedgerIds`, derived from a real
 *                   getAllCanonicalSources() walk). Its staleness driver is
 *                   the aggregated PROBE clock (last_probe_at), not the
 *                   content clock — the design table's own SLO type for
 *                   this row is "30d reachability", and muni content checks
 *                   are due-filtered to ~once/year, which cannot service a
 *                   30d interval alone. fetch-breach still reads the
 *                   content clock's consecutive_failures (fragile
 *                   FeatureServer endpoints failing real content checks).
 *
 * `now` and a `registeredAt` lookup are both injectable so tests never
 * depend on the wall clock.
 */
export function evaluateSourceHealth(
  ledgerRows: readonly SourceHealthRow[],
  registry: readonly SourceHealthConfig[],
  now: Date,
  opts: {
    /** ISO timestamp a source was first registered, keyed by source id.
     *  Used only for the never-succeeded staleness grace period. Sources
     *  absent from this map are treated as registered "now" (maximum
     *  grace) — a source with no known registration time cannot be
     *  penalized for staleness on its very first observed run. */
    registeredAt?: Readonly<Record<string, string>>;
    /** Real (numeric) ledger ids the caller has identified as belonging to
     *  the ward-arcgis family, via a real getAllCanonicalSources() walk
     *  (isWardArcgisFamilyUrl matched against each muni source's actual
     *  URL). Required to evaluate the `ward-arcgis` registry row's SLO —
     *  without it, that row is treated as never-attempted. */
    wardArcgisLedgerIds?: readonly string[];
  } = {}
): { breaches: SourceBreachRecord[] } {
  const nowMs = now.getTime();
  const breaches: SourceBreachRecord[] = [];
  const wardArcgisLedgerIds = opts.wardArcgisLedgerIds ?? [];

  for (const config of registry) {
    if (config.lane === 'none' || config.freshness === 'manual') {
      continue;
    }

    const row =
      config.id === 'ward-arcgis'
        ? aggregateWardArcgisRow(ledgerRows, wardArcgisLedgerIds)
        : findLedgerRow(ledgerRows, config.id);
    const consecutiveFailures = row?.consecutive_failures ?? 0;
    const lastError = row?.last_error ?? null;
    const lastAttemptAt = row?.last_attempt_at ?? null;

    const attempts: SourceBreachAttempt[] =
      lastError && lastAttemptAt ? [{ at: lastAttemptAt, error: lastError }] : [];

    // --- fetch-breach ---------------------------------------------------
    // Derived next-vintage rows are exempt: expected in-window 404s are not
    // fetch failures, they are the window not having closed yet (see
    // "next-vintage" in the doc comment above).
    const isNextVintageRow = config.id.endsWith('@next-vintage');
    const fetchBreached = !isNextVintageRow && consecutiveFailures >= config.retryBudget;

    // --- staleness-breach -------------------------------------------------
    let stalenessBreached = false;
    let lastSuccessAt: string | null = row?.last_success_at ?? null;

    if (config.expectedIntervalDays != null && config.freshness !== 'frozen') {
      if (config.freshness === 'vintage' && !isNextVintageRow) {
        // Staleness for vintage sources is keyed off the derived
        // `<id>@next-vintage` ledger row — never off the current-vintage
        // URL's own probe/fetch successes (a 200 on the OLD vintage proves
        // the old file still serves, not that the new one arrived).
        const nextVintageRow = findLedgerRow(ledgerRows, `${config.id}@next-vintage`);
        lastSuccessAt = nextVintageRow?.last_success_at ?? null;
      }

      if (config.id === 'ward-arcgis') {
        // The design table's own SLO type for ward-arcgis is explicitly
        // "30d REACHABILITY" (SELF-HEALING-DATA-OPS.md's source table), not
        // content staleness — and muni content checks are due-filtered to
        // ~once/year (annual, July), which cannot service a 30d interval on
        // its own. The daily reachability probe (probeFetchLaneReachability)
        // is what actually keeps this SLO's clock live; its probe-only
        // columns (last_probe_at) never touch the content clock
        // (last_success_at/consecutive_failures — the invariant that a
        // probe 200 can never mask a failing content fetch still holds),
        // but THIS row's staleness driver reads that probe clock instead of
        // the content clock, matching what the design actually specifies.
        lastSuccessAt = row?.last_probe_at ?? null;
      }

      const successMs = parseTimestamp(lastSuccessAt);

      if (successMs === null) {
        // Never succeeded: one expectedIntervalDays of grace from
        // registration before staleness-breach can fire. fetch-breach is
        // unaffected by this grace (handled above independently).
        // Prefer the ledger row's own persisted registered_at (real for
        // every directly-attempted source, and for the ward-arcgis
        // aggregate — the earliest registered_at across the family) over
        // the caller-supplied opts.registeredAt map, which exists mainly
        // for tests and for sources with no ledger row at all yet.
        const registeredIso = row?.registered_at ?? opts.registeredAt?.[config.id];
        const registeredMs = registeredIso ? parseTimestamp(registeredIso) : nowMs;
        const graceDeadline = (registeredMs ?? nowMs) + config.expectedIntervalDays * DAY_MS;
        stalenessBreached = nowMs > graceDeadline;
      } else {
        stalenessBreached = nowMs - successMs > config.expectedIntervalDays * DAY_MS;
      }
    }

    if (fetchBreached) {
      breaches.push({
        sourceId: config.id,
        breachType: 'fetch',
        class: config.class,
        configSite: config.configSite,
        expectedIntervalDays: config.expectedIntervalDays,
        retryBudget: config.retryBudget,
        lastSuccessAt: row?.last_success_at ?? null,
        consecutiveFailures,
        attempts,
        urlChecked: config.probe?.url ?? registryUrl(config),
        ...(config.ownerSlots ? { ownerSlots: config.ownerSlots } : {}),
      });
    } else if (stalenessBreached) {
      breaches.push({
        sourceId: config.id,
        breachType: 'staleness',
        class: config.class,
        configSite: config.configSite,
        expectedIntervalDays: config.expectedIntervalDays,
        retryBudget: config.retryBudget,
        lastSuccessAt: row?.last_success_at ?? null,
        consecutiveFailures,
        attempts,
        urlChecked: config.probe?.url ?? registryUrl(config),
        ...(config.ownerSlots ? { ownerSlots: config.ownerSlots } : {}),
      });
    }
  }

  return { breaches };
}

// ============================================================================
// Ledger store — thin wrapper over the shared better-sqlite3 connection
// ============================================================================

/**
 * SourceHealthStore — reads/writes the `source_health` ledger table.
 *
 * Shares the SAME better-sqlite3 connection the event-sourced
 * DatabaseAdapter uses (SQLiteAdapter.rawDb()), so ledger writes land in the
 * identical DB file/transaction scope that round-trips through R2 —
 * no new infra, no second database.
 */
export class SourceHealthStore {
  constructor(private readonly db: BetterSqliteDatabase) {}

  recordSuccess(sourceId: string, at: string, opts: { stampSuccess: boolean }): void {
    const existing = this.getRow(sourceId);
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO source_health (source_id, last_attempt_at, last_success_at, consecutive_failures, last_error, breach_state, registered_at)
           VALUES (?, ?, ?, 0, NULL, 'ok', ?)`
        )
        .run(sourceId, at, opts.stampSuccess ? at : null, at);
      return;
    }

    this.db
      .prepare(
        `UPDATE source_health
         SET last_attempt_at = ?,
             last_success_at = CASE WHEN ? THEN ? ELSE last_success_at END,
             consecutive_failures = 0,
             last_error = NULL,
             breach_state = CASE WHEN breach_state = 'breached' THEN 'ok' ELSE breach_state END
         WHERE source_id = ?`
      )
      .run(at, opts.stampSuccess ? 1 : 0, at, sourceId);
  }

  recordFailure(sourceId: string, at: string, error: string): void {
    const existing = this.getRow(sourceId);
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO source_health (source_id, last_attempt_at, last_success_at, consecutive_failures, last_error, breach_state, registered_at)
           VALUES (?, ?, NULL, 1, ?, 'ok', ?)`
        )
        .run(sourceId, at, error, at);
      return;
    }

    this.db
      .prepare(
        `UPDATE source_health
         SET last_attempt_at = ?,
             consecutive_failures = consecutive_failures + 1,
             last_error = ?
         WHERE source_id = ?`
      )
      .run(at, error, sourceId);
  }

  /**
   * Record a daily REACHABILITY probe outcome for a fetch-lane row (muni
   * sources + the 2 congressional seeds). Writes ONLY
   * `probe_consecutive_failures`/`last_probe_at` — NEVER
   * `consecutive_failures`/`last_success_at`/`last_error`, the columns the
   * content/checksum clock owns. This is the invariant the design
   * elevated: a probe 200 can never mask (or a probe failure never
   * fabricate) a content-fetch outcome — the two clocks are structurally
   * disjoint columns on the same row, not just disjoint lanes on different
   * rows.
   */
  recordProbeSuccess(sourceId: string, at: string): void {
    const existing = this.getRow(sourceId);
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO source_health
             (source_id, last_attempt_at, last_success_at, consecutive_failures, last_error, breach_state, probe_consecutive_failures, last_probe_at, registered_at)
           VALUES (?, NULL, NULL, 0, NULL, 'ok', 0, ?, ?)`
        )
        .run(sourceId, at, at);
      return;
    }

    this.db
      .prepare(
        `UPDATE source_health
         SET probe_consecutive_failures = 0,
             last_probe_at = ?
         WHERE source_id = ?`
      )
      .run(at, sourceId);
  }

  recordProbeFailure(sourceId: string, at: string): void {
    const existing = this.getRow(sourceId);
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO source_health
             (source_id, last_attempt_at, last_success_at, consecutive_failures, last_error, breach_state, probe_consecutive_failures, last_probe_at, registered_at)
           VALUES (?, NULL, NULL, 0, NULL, 'ok', 1, ?, ?)`
        )
        .run(sourceId, at, at);
      return;
    }

    this.db
      .prepare(
        `UPDATE source_health
         SET probe_consecutive_failures = probe_consecutive_failures + 1,
             last_probe_at = ?
         WHERE source_id = ?`
      )
      .run(at, sourceId);
  }

  getRow(sourceId: string): SourceHealthRow | undefined {
    return this.db
      .prepare(`SELECT * FROM source_health WHERE source_id = ?`)
      .get(sourceId) as SourceHealthRow | undefined;
  }

  getAllRows(): SourceHealthRow[] {
    return this.db.prepare(`SELECT * FROM source_health`).all() as SourceHealthRow[];
  }

  /**
   * Real, persisted `registeredAt` map for evaluateSourceHealth — every
   * source_id (or `<id>@next-vintage` row) that has EVER had any attempt
   * recorded, keyed to that row's registered_at. Sources never attempted
   * are simply absent (evaluateSourceHealth's own "registered now" default
   * applies to them, correctly — a never-seen source cannot be penalized).
   */
  getRegisteredAtMap(): Record<string, string> {
    const rows = this.getAllRows();
    const map: Record<string, string> = {};
    for (const row of rows) {
      if (row.registered_at) {
        map[row.source_id] = row.registered_at;
      }
    }
    return map;
  }
}
