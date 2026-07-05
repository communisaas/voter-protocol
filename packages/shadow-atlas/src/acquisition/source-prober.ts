/**
 * Source Prober — daily reachability probe lane
 *
 * Implements the design's §Daily probe lane: a lightweight, method-appropriate
 * reachability prober for every registry source the fetch lane never
 * touches (`lane: 'probe'` rows in SOURCE_REGISTRY). Runs as a step in the
 * same scheduled change-check workflow, AFTER the R2 DB get and BEFORE
 * breach evaluation, so probe attempts are visible to the same run's
 * evaluation.
 *
 * PROBING IS REACHABILITY-ONLY. This module never computes a checksum,
 * never emits a ChangeReport/change event, and never writes to the
 * artifacts/heads/events tables real change detection owns. It only writes
 * attempt outcomes to the shared `source_health` ledger (source-health.ts).
 *
 * LANE EXCLUSIVITY INVARIANT: every `lane: 'fetch'` and `lane: 'none'` row
 * is skipped. Probing congress-legislators-current (a fetch-lane seed) would
 * let a bare HEAD 200 reset consecutive_failures accumulated by a failing
 * checksum check on the exact same URL — masking the failure class the
 * ledger exists to catch.
 */

import {
  SOURCE_REGISTRY,
  SourceHealthStore,
  isWardArcgisFamilyUrl,
  PINNED_TIGER_VINTAGE,
  type SourceHealthConfig,
  type ProbeExpectShape,
} from './source-health.js';
import { STATE_FIPS, buildBafUrl } from '../hydration/baf-downloader.js';
import { buildTigerStateUrl } from './change-detection-adapter.js';
import { CONGRESSIONAL_CANONICAL_SOURCES } from './change-detector.js';

// ============================================================================
// Types
// ============================================================================

export type ProbeOutcomeKind = 'success' | 'failure';

export interface ProbeAttemptResult {
  readonly sourceId: string;
  readonly outcome: ProbeOutcomeKind;
  readonly status?: number;
  readonly error?: string;
  /** True when this attempt targeted the derived `<id>@next-vintage` row. */
  readonly isNextVintage?: boolean;
  /** True when the registry row was skipped (fetch/none lane, or
   *  window-gated next-vintage probe outside its window). */
  readonly skipped?: boolean;
}

/**
 * Minimal injectable fetch surface — matches the subset of the global
 * `fetch` signature this module needs. Tests inject a mock; production
 * uses the real global `fetch`. No network call happens anywhere in this
 * module's own logic — every request goes through this seam.
 */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<{ status: number; ok: boolean; headers: { get(name: string): string | null } }>;

/**
 * The real fetch-lane surface, id + url, exactly as
 * `ChangeDetector.getAllCanonicalSources()` returns it (id is the numeric
 * autoincrement string for muni-derived sources, or the stable seed id for
 * the 2 congressional seeds). Passing url alongside id is what lets the
 * prober derive ward-arcgis family membership from the real producer output
 * instead of matching against an invented id shape.
 */
export interface FetchLaneSource {
  readonly id: string;
  readonly url: string;
}

export interface ProberDeps {
  readonly fetchImpl: FetchLike;
  readonly store: SourceHealthStore;
  readonly now: () => Date;
  /** Sources the fetch lane actually covers this run (real
   *  getAllCanonicalSources() output, id+url) — used for the startup
   *  lane-exclusivity assertion (registry `lane: 'fetch'` rows must have a
   *  real counterpart here, else a fetch-lane config breach is recorded)
   *  AND to compute which numeric muni ledger ids belong to the
   *  ward-arcgis family for breach evaluation + optional daily reachability
   *  probing (never the content clock). */
  readonly fetchLaneSources: readonly FetchLaneSource[];
}

const PROBE_TIMEOUT_MS = 5000;
const PROBE_BACKOFF_ATTEMPTS = 3;
const PROBE_BACKOFF_INITIAL_MS = 500;

// ============================================================================
// Daily rotation helpers (family sampling)
// ============================================================================

/**
 * Deterministic day-of-year rotation index into a family of size `n`.
 * Used so BAF/per-state/national-manifest families get ONE representative
 * probed per day rather than one request per file — the design's "about a
 * dozen requests/day" bound.
 */
export function rotateDailyIndex(now: Date, n: number): number {
  if (n <= 0) return 0;
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const diff = now.getTime() - start;
  const dayOfYear = Math.floor(diff / 86_400_000);
  return dayOfYear % n;
}

/**
 * The real state FIPS -> postal abbreviation entries, imported from
 * baf-downloader.ts's own STATE_FIPS map — the SAME 56-entry family
 * (50 states + DC + 5 territories) the BAF downloader actually iterates.
 * Both the BAF rotation and the generic per-state TIGER template rotation
 * (cd/sldu/sldl/county) sample one (state) per day from this list; TIGER
 * file names take the FIPS code, never the postal abbreviation (see
 * buildTigerStateUrl's contract).
 */
const STATE_FIPS_ENTRIES: readonly [fips: string, abbr: string][] = [...STATE_FIPS.entries()];

const TIGER_NATIONAL_LAYER_IDS = [
  'tiger-national-aiannh',
  'tiger-national-cbsa',
  'tiger-national-state',
  'tiger-national-county',
  'tiger-national-zcta520',
  'tiger-national-uac',
  'tiger-national-mil',
];

/**
 * Resolve the concrete probe target URL for a registry row on a given day.
 * Family rows (sample: 'rotate-daily') pick one representative; the
 * national-manifest family additionally rotates WHICH layer id is probed
 * that day (the rest are silently deferred to a later day — the "about a
 * dozen requests/day" bound).
 */
export function resolveProbeUrl(config: SourceHealthConfig, now: Date): string {
  if (config.probe?.url) {
    return config.probe.url;
  }

  const baseUrl = typeof config.url === 'string' ? config.url : config.url.template;

  if (config.probe?.sample !== 'rotate-daily') {
    return baseUrl;
  }

  if (config.id === 'baf-2020') {
    // Import the SAME builder baf-downloader.ts uses to construct its real
    // download URL (BlockAssign_ST{fips}_{abbr}.zip) — never a hand-typed
    // template. Rotates over the real STATE_FIPS entries (50 states + DC +
    // 5 territories, DC included).
    const idx = rotateDailyIndex(now, STATE_FIPS_ENTRIES.length);
    const [fips, abbr] = STATE_FIPS_ENTRIES[idx];
    return buildBafUrl(fips, abbr);
  }

  if (config.id.startsWith('tiger-state-')) {
    // Import change-detection-adapter's own getSourceUrl builder
    // (buildTigerStateUrl) — FIPS code (not postal) + the PINNED vintage
    // (parsed off the tiger-cd119 seed's own registry URL), matching the
    // adapter's documented "@param state - State FIPS code" contract.
    const idx = rotateDailyIndex(now, STATE_FIPS_ENTRIES.length);
    const [fips] = STATE_FIPS_ENTRIES[idx];
    const layer = config.id.replace('tiger-state-', '') as 'cd' | 'sldu' | 'sldl' | 'county';
    return buildTigerStateUrl(layer, fips, PINNED_TIGER_VINTAGE);
  }

  if (config.id === 'tiger-tract-centroids' || config.id === 'addrfeat') {
    // Directory-listing families: the listing URL itself is the probe
    // target (one request either way); rotation is a no-op here.
    return baseUrl;
  }

  return baseUrl;
}

/**
 * Whether a national-manifest layer id is "today's" rotation pick. Only
 * used by the CLI/wiring layer to decide which of the 7 national layer rows
 * to probe today — kept here so the rotation logic has one home.
 */
export function isTodaysNationalLayer(sourceId: string, now: Date): boolean {
  const idx = TIGER_NATIONAL_LAYER_IDS.indexOf(sourceId);
  if (idx === -1) return true; // not a national-layer id — no gating
  const pick = rotateDailyIndex(now, TIGER_NATIONAL_LAYER_IDS.length);
  return idx === pick;
}

// ============================================================================
// Next-vintage window gating
// ============================================================================

export function isInNextVintageWindow(config: SourceHealthConfig, now: Date): boolean {
  const windowMonths = config.probe?.nextVintage?.windowMonths;
  if (!windowMonths || windowMonths.length === 0) return false;
  const month = now.getUTCMonth() + 1;
  return windowMonths.includes(month);
}

function resolveNextVintageUrl(config: SourceHealthConfig, _now: Date): string {
  const template = config.probe?.nextVintage?.template ?? '';
  // The next vintage is PINNED_TIGER_VINTAGE + 1 (e.g. TIGER2025 while the
  // pipeline is pinned to TIGER2024) — never the current calendar year,
  // which does not exist as a published TIGER vintage until the release
  // actually ships (TIGER2026 does not appear until ~fall 2026 even though
  // the calendar year is 2026 for most of it).
  const nextYear = PINNED_TIGER_VINTAGE + 1;
  return template.replace(/\{nextYear\}/g, String(nextYear));
}

// ============================================================================
// HTTP probe primitives (single attempt, no retry — retry lives in probeOne)
// ============================================================================

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}

interface RawProbeResult {
  readonly status: number;
  readonly ok: boolean;
  /** Raw `Content-Type` response header, or null when absent/unavailable
   *  (e.g. a thrown network error never reaches a response at all). Read
   *  regardless of probe method — HEAD responses carry headers same as
   *  GET, just no body. */
  readonly contentType: string | null;
}

/**
 * Whether a Content-Type header is consistent with an `expectShape`
 * declaration. Substring match against the shape's registered MIME
 * fragment (e.g. "zip" matches "application/zip",
 * "application/x-zip-compressed"; "json" matches
 * "application/json;charset=UTF-8"). A missing/unparseable Content-Type is
 * treated as "no contradiction" — this is a shape MISMATCH detector, not a
 * shape-presence requirement, so silence is never itself a failure.
 *
 * Byte-level sniffing (the "first bytes when available" half of the
 * design's check) is deliberately not implemented here: FetchLike is a
 * reachability-only surface (see this module's header doc) that never
 * exposes a response body, and every currently-wired expectShape row is
 * fully decided by Content-Type alone (the incident this exists to catch
 * — an HTTP-200 JSON error body in place of a zip — already changes
 * Content-Type, not just body bytes).
 */
function contentTypeMatchesShape(contentType: string | null, shape: ProbeExpectShape): boolean {
  if (!contentType) return true;
  const lower = contentType.toLowerCase();
  return lower.includes(shape);
}

/**
 * Issue one probe attempt per the registry row's configured method, with
 * the design's mandated fallbacks:
 *   - HEAD first; on 405/501 (or a thrown hang/abort), automatic fallback
 *     to range-GET (`Range: bytes=0-0`) — 206 or 200 counts as success.
 *   - conditional-get: GET with If-None-Match when a validator is held
 *     (304 = success). Falls back to plain GET semantics otherwise.
 *   - get: plain GET, read status only (first-bytes — body is not read by
 *     this module; reachability only).
 */
async function issueProbe(
  fetchImpl: FetchLike,
  url: string,
  method: NonNullable<SourceHealthConfig['probe']>['method'],
  opts: { etag?: string | null } = {}
): Promise<RawProbeResult> {
  if (method === 'head') {
    try {
      const res = await withTimeout(signal =>
        fetchImpl(url, { method: 'HEAD', signal: signal as AbortSignal })
      );
      if (res.status === 405 || res.status === 501) {
        return rangeGetFallback(fetchImpl, url);
      }
      return { status: res.status, ok: res.ok, contentType: res.headers.get('content-type') };
    } catch {
      // Hang/abort/network error on HEAD — automatic range-GET fallback,
      // per the design ("on 405/501/hang").
      return rangeGetFallback(fetchImpl, url);
    }
  }

  if (method === 'conditional-get') {
    const headers: Record<string, string> = {};
    if (opts.etag) headers['If-None-Match'] = opts.etag;
    const res = await withTimeout(signal =>
      fetchImpl(url, { method: 'GET', headers, signal: signal as AbortSignal })
    );
    return {
      status: res.status,
      ok: res.ok || res.status === 304,
      contentType: res.headers.get('content-type'),
    };
  }

  // 'get' — plain GET first-bytes for HEAD-hostile targets.
  const res = await withTimeout(signal =>
    fetchImpl(url, { method: 'GET', signal: signal as AbortSignal })
  );
  return { status: res.status, ok: res.ok, contentType: res.headers.get('content-type') };
}

async function rangeGetFallback(fetchImpl: FetchLike, url: string): Promise<RawProbeResult> {
  const res = await withTimeout(signal =>
    fetchImpl(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: signal as AbortSignal })
  );
  const ok = res.status === 206 || res.status === 200;
  return { status: res.status, ok, contentType: res.headers.get('content-type') };
}

function isSuccessStatus(status: number): boolean {
  return status === 200 || status === 206 || status === 304;
}

async function probeWithBackoff(
  fetchImpl: FetchLike,
  url: string,
  method: NonNullable<SourceHealthConfig['probe']>['method'],
  expectShape?: ProbeExpectShape
): Promise<{ success: boolean; status?: number; error?: string }> {
  let delayMs = PROBE_BACKOFF_INITIAL_MS;
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= PROBE_BACKOFF_ATTEMPTS; attempt++) {
    try {
      const result = await issueProbe(fetchImpl, url, method);
      if (isSuccessStatus(result.status)) {
        if (!expectShape || contentTypeMatchesShape(result.contentType, expectShape)) {
          return { success: true, status: result.status };
        }
        // A 2xx/304 status is not "healthy" when the body isn't shaped
        // like what this source is supposed to serve — the motivating
        // case being an upstream error page/API returning HTTP 200 with a
        // JSON body in place of the real zip artifact. Recorded exactly
        // like any other probe failure (retried within budget, then
        // advances consecutive_failures).
        lastError = `shape mismatch: expected ${expectShape}, got ${result.contentType ?? 'unknown content-type'}`;
      } else {
        lastError = `HTTP ${result.status}`;
      }
      // 4xx/5xx are not retried further within one probe cycle if the
      // status is a definitive client/server error — but per the design's
      // "x3 backoff" posture we retry transient-looking failures uniformly,
      // mirroring change-detector.ts's fetchHeadersWithRetry shape.
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < PROBE_BACKOFF_ATTEMPTS) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }

  return { success: false, error: lastError ?? 'unknown probe failure' };
}

// ============================================================================
// Prober — orchestrates the full registry pass
// ============================================================================

export interface ProbeRunSummary {
  readonly attempts: readonly ProbeAttemptResult[];
  /** Registry `lane: 'fetch'` ids with NO real counterpart in
   *  fetchLaneSources — a config breach recorded per the design's startup
   *  assertion. For the 2 congressional seeds this is an id match; for
   *  `ward-arcgis` it means NO fetchLaneSources entry's URL matched the
   *  ward-arcgis family at all (a real, non-hypothetical absence, since
   *  ward ids can never be enumerated statically). */
  readonly fetchLaneConfigBreaches: readonly string[];
  /** Real (numeric) fetchLaneSources ids whose URL matched the ward-arcgis
   *  family this run — the caller passes this straight into
   *  evaluateSourceHealth's `wardArcgisLedgerIds` opt. */
  readonly wardArcgisLedgerIds: readonly string[];
}

/**
 * Run one full probe pass over SOURCE_REGISTRY.
 *
 * Skips every `lane: 'fetch'` and `lane: 'none'` row for the CONTENT-clock
 * probe (no checksum, no change event, no content-clock write). `lane:
 * 'fetch'` muni rows MAY additionally get a daily REACHABILITY probe into
 * the separate `probe_consecutive_failures`/`last_probe_at` columns — see
 * `probeFetchLaneReachability` below — which never touches
 * consecutive_failures/last_success_at/last_error.
 *
 * Vintage-class rows never stamp `last_success_at` on their own
 * (current-vintage) row; a window-gated next-vintage probe instead writes
 * to the derived `<id>@next-vintage` row.
 */
export async function runProbeLane(
  deps: ProberDeps,
  registry: readonly SourceHealthConfig[] = SOURCE_REGISTRY
): Promise<ProbeRunSummary> {
  const { fetchImpl, store, now, fetchLaneSources } = deps;
  const attempts: ProbeAttemptResult[] = [];
  const fetchLaneConfigBreaches: string[] = [];

  const fetchLaneIds = fetchLaneSources.map(s => s.id);
  const wardArcgisLedgerIds = fetchLaneSources
    .filter(s => isWardArcgisFamilyUrl(s.url))
    .map(s => s.id);

  // Startup lane-exclusivity assertion: every `lane: 'fetch'` row must have
  // a REAL counterpart in the actual fetch-lane surface (a real
  // getAllCanonicalSources() walk, passed in as fetchLaneSources). Absence
  // is loud — a recorded config breach, never a silent neither-lane gap.
  // The `ward-arcgis` template row is covered iff at least one real
  // fetchLaneSources entry's URL matched the ward-arcgis family — id
  // matching is impossible for it (muni ids are numeric, never
  // 'ward-arcgis-*').
  for (const config of registry) {
    if (config.lane !== 'fetch') continue;
    const covered =
      config.id === 'ward-arcgis' ? wardArcgisLedgerIds.length > 0 : fetchLaneIds.includes(config.id);
    if (!covered) {
      fetchLaneConfigBreaches.push(config.id);
    }
  }

  for (const config of registry) {
    if (config.lane !== 'probe') {
      attempts.push({ sourceId: config.id, outcome: 'success', skipped: true });
      continue;
    }

    const nowDate = now();

    // National-manifest family: only "today's" rotation pick gets probed;
    // the other 6 layers are deferred to a later day (wired here — was
    // dead code previously). Keeps daily probe volume within the design's
    // "about a dozen requests/day" bound instead of probing all 7 every run.
    if (!isTodaysNationalLayer(config.id, nowDate)) {
      attempts.push({ sourceId: config.id, outcome: 'success', skipped: true });
      continue;
    }

    const isNextVintageRow = config.id.endsWith('@next-vintage');

    if (isNextVintageRow) {
      // Window-gated: only probe inside the configured window months.
      if (!isInNextVintageWindow(config, nowDate)) {
        attempts.push({ sourceId: config.id, outcome: 'success', skipped: true, isNextVintage: true });
        continue;
      }

      const url = resolveNextVintageUrl(config, nowDate);
      const method = config.probe!.method;
      const result = await probeWithBackoff(fetchImpl, url, method, config.probe?.expectShape);
      const at = nowDate.toISOString();

      if (result.success) {
        // Next-vintage arriving IS the freshness signal for vintage
        // sources — this derived row's last_success_at is exactly what
        // evaluateSourceHealth reads for staleness.
        store.recordSuccess(config.id, at, { stampSuccess: true });
        attempts.push({ sourceId: config.id, outcome: 'success', status: result.status, isNextVintage: true });
      } else {
        store.recordFailure(config.id, at, result.error ?? 'unknown error');
        attempts.push({ sourceId: config.id, outcome: 'failure', error: result.error, isNextVintage: true });
      }
      continue;
    }

    const url = resolveProbeUrl(config, nowDate);
    const method = config.probe!.method;
    const result = await probeWithBackoff(fetchImpl, url, method, config.probe?.expectShape);
    const at = nowDate.toISOString();

    if (result.success) {
      // Freshness-class clock rule: 'vintage' rows NEVER get last_success_at
      // stamped by a current-URL reachability probe (old-vintage reachable
      // != new vintage arrived). 'rolling' rows DO — endpoint-alive IS the
      // freshness signal at that SLO. 'frozen' rows: moot (no staleness
      // clock), but reachability itself is still tracked via
      // consecutive_failures, so we pass stampSuccess: false uniformly for
      // non-rolling classes.
      const stampSuccess = config.freshness === 'rolling';
      store.recordSuccess(config.id, at, { stampSuccess });
      attempts.push({ sourceId: config.id, outcome: 'success', status: result.status });
    } else {
      store.recordFailure(config.id, at, result.error ?? 'unknown error');
      attempts.push({ sourceId: config.id, outcome: 'failure', error: result.error });
    }
  }

  return { attempts, fetchLaneConfigBreaches, wardArcgisLedgerIds };
}

// ============================================================================
// Fetch-lane daily reachability probe (separate probe columns only)
// ============================================================================

export interface FetchLaneReachabilityDeps {
  readonly fetchImpl: FetchLike;
  readonly store: SourceHealthStore;
  readonly now: () => Date;
  /** Real getAllCanonicalSources() output — the 2 congressional seeds plus
   *  every muni-derived source, numeric ids included. */
  readonly fetchLaneSources: readonly FetchLaneSource[];
}

export interface FetchLaneReachabilityResult {
  readonly sourceId: string;
  readonly outcome: ProbeOutcomeKind;
  readonly status?: number;
  readonly error?: string;
}

/** Cap on how many muni-derived (numeric-id) fetch-lane sources get a daily
 *  reachability probe. getAllCanonicalSources() can return thousands of
 *  municipalities (listMunicipalities(10000, 0)); probing all of them daily
 *  would blow the design's "~a dozen requests/day" cost posture. The 2
 *  congressional seeds are ALWAYS probed (they are the mandate's explicit
 *  "2 cheap requests"); munis are date-rotated-sampled the same way BAF/
 *  per-state families are, so ward-family reachability coverage accrues
 *  across days rather than all firing in one run. */
const MUNI_REACHABILITY_PROBE_SAMPLE_SIZE = 3;

/**
 * Daily REACHABILITY probe for the fetch lane (self-healing data ops fix:
 * the content-check clock for `lane: 'fetch'` rows is due-filtered —
 * congress-legislators-current only content-checks in January,
 * tiger-cd119/ward munis only in July — so relying on the content clock
 * alone for "reachable today" coverage leaves ~11 months/year with no
 * signal). This function gives the 2 congressional seeds (ALWAYS) plus a
 * small date-rotated sample of muni-derived sources (bounded volume — see
 * MUNI_REACHABILITY_PROBE_SAMPLE_SIZE) a lightweight daily HEAD (range-GET
 * fallback on 405/501/hang, matching the design's method-appropriate
 * posture) into the SEPARATE probe_consecutive_failures/last_probe_at
 * columns.
 *
 * INVARIANT: this function NEVER calls store.recordSuccess/recordFailure
 * (the content-clock writers) — only store.recordProbeSuccess/
 * recordProbeFailure. A probe 200 can never reset consecutive_failures
 * accrued by a failing content check, and a probe failure can never
 * increment it either. The two clocks are fully disjoint columns on the
 * same row.
 */
export async function probeFetchLaneReachability(
  deps: FetchLaneReachabilityDeps
): Promise<readonly FetchLaneReachabilityResult[]> {
  const { fetchImpl, store, now, fetchLaneSources } = deps;
  const results: FetchLaneReachabilityResult[] = [];
  const nowDate = now();

  const seedIds = new Set(CONGRESSIONAL_CANONICAL_SOURCES.map(s => s.id));
  const seeds = fetchLaneSources.filter(s => seedIds.has(s.id));
  const munis = fetchLaneSources.filter(s => !seedIds.has(s.id));

  const sampledMunis: FetchLaneSource[] = [];
  if (munis.length > 0) {
    const sampleSize = Math.min(MUNI_REACHABILITY_PROBE_SAMPLE_SIZE, munis.length);
    const startIdx = rotateDailyIndex(nowDate, munis.length);
    for (let i = 0; i < sampleSize; i++) {
      sampledMunis.push(munis[(startIdx + i) % munis.length]);
    }
  }

  for (const source of [...seeds, ...sampledMunis]) {
    const result = await probeWithBackoff(fetchImpl, source.url, 'head');
    const at = nowDate.toISOString();

    if (result.success) {
      store.recordProbeSuccess(source.id, at);
      results.push({ sourceId: source.id, outcome: 'success', status: result.status });
    } else {
      store.recordProbeFailure(source.id, at);
      results.push({ sourceId: source.id, outcome: 'failure', error: result.error });
    }
  }

  return results;
}
