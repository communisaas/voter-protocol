#!/usr/bin/env tsx
/**
 * Build the atlas-native address index — SEAM-CONTRACT v2 (atlas-address-index).
 *
 * Ingests two public sources into ZIP5-keyed chunk files:
 *   src:0 — NAD quarterly text release (stream-parsed; NEVER whole-file in
 *           memory — the national file is ~30 GB uncompressed)
 *   src:1 — TIGER ADDRFEAT county files (bounded-parallel download pool +
 *           forked transform workers; each county zip is a few MB, ~3,200
 *           counties nationally)
 *
 * ADDRFEAT orchestration (national scale — output bytes UNCHANGED):
 *   - Downloads run through a bounded pool (default 6 concurrent, Census-
 *     friendly) with exponential backoff + jitter and Retry-After honoring —
 *     census.gov 'terminate's long sequential bulk fetchers, and one county
 *     at a time cannot finish 3,200+ counties inside a CI job ceiling.
 *   - Shapefile→GeoJSON→range transforms run in forked workers (same
 *     child_process.fork pattern as build-chunked-mapping.ts) so CPU and
 *     network overlap.
 *   - Ingestion into the ZIP5 spill store happens IN COUNTY-FIPS ORDER on
 *     the main process regardless of completion order, so spill contents —
 *     and therefore every emitted chunk byte — are identical to the old
 *     sequential loop. This is orchestration only, not a format change.
 *   - County zips persist in --addrfeat-dir keyed by filename and verified
 *     complete (zip magic + EOCD) before reuse; a restarted run skips
 *     verified downloads instead of re-fetching hours of them.
 *   - Fail-loud: a county that exhausts retries THROWS — a missing county
 *     must never become a silent geographic hole in the index.
 *
 * Outputs (under <outputDir>, default ./output/chunked):
 *   US/addresses/{zip5}.json        — §2 chunk file, OR (§1 v2) a tiny stub
 *                                     `{v:2, shards:N, ...}` when the chunk
 *                                     would breach the byte guard
 *   US/addresses/{zip5}.{n}.json    — §1 v2 shard files (only for oversized
 *                                     ZIPs; n in [0, shards))
 *   US/addresses/normalization.json — §3 Pub 28 tables (normVersion pinned)
 *   US/addresses/chunk-index.json   — per-chunk sha256/bytes (§4; NOT inline).
 *                                     For a split ZIP this indexes the STUB
 *                                     only — shard bytes are guard-checked at
 *                                     build time, not separately indexed.
 *   US/manifest.json                — MERGED addressIndex* fields (§4),
 *                                     schemaVersion 2 (§1 split scheme). All
 *                                     pre-existing fields — `generated`,
 *                                     `tigerVintage`, `officialsGenerated` —
 *                                     are left byte-unchanged (third clock).
 *   address-index-sources.json      — download log with computed sha256s
 *                                     (census.gov publishes no pins; we stamp
 *                                     what we compute)
 *
 * Privacy invariant: this producer touches ONLY public NAD/TIGER source data
 * and calls no hosted geocoding API. User addresses never reach it.
 *
 * Usage:
 *   tsx scripts/build-address-index.ts \
 *     --nad <path|-> --nad-vintage 2026-06-30 \
 *     --addrfeat-dir ./data/addrfeat-cache --addrfeat-vintage TIGER2025 \
 *     [--states DE,RI,DC] [--output ./output/chunked] [--dry-run]
 *
 * Vintage discipline (fail-loud): both vintages default to 'unknown' and a
 * real (non-dry) run THROWS via resolveNadVintage / resolveTigerVintage
 * before anything is written — 'unknown' can never land in a produced
 * manifest. (Mirrors --tiger-vintage in build-chunked-mapping.ts.)
 */

import { fork, type ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  createReadStream,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { STATE_ABBR_TO_FIPS } from '../src/core/types/fips.js';
import {
  normalizeStreet,
  normalizeHouseNumberKey,
  parseLeadingInteger,
  buildNormalizationJson,
} from '../src/distribution/addresses/normalize.js';
import { NORM_VERSION } from '../src/distribution/addresses/normalization-table.js';
import {
  addPoint,
  addRange,
  buildChunk,
  chunkSizeGuard,
  edgeEndsOf,
  emitSideRange,
  mergeAddressIndexIntoManifest,
  newZipAccumulator,
  writeChunkFileAutoSplit,
  writeJsonArtifact,
  ZIP5_PATTERN,
  type AddressIndexManifestFields,
  type ChunkIndexEntry,
  type ZipAccumulator,
} from '../src/distribution/addresses/chunk-emit.js';
import {
  downloadWithRetry,
  downloadZipToCache,
  Semaphore,
} from '../src/distribution/addresses/download-pool.js';
import { resolveNadVintage } from '../src/distribution/addresses/nad-vintage.js';
import { streamNadRows } from '../src/distribution/addresses/nad-stream.js';
import { resolveTigerVintage } from '../src/distribution/snapshots/tiger-vintage.js';
import { transformShapefileToGeoJSON } from '../src/transformation/shapefile-to-geojson.js';

// ---------------------------------------------------------------------------
// Arg parsing — mirrors the parseArgs switch in publish-source.ts
// ---------------------------------------------------------------------------

interface ParsedArgs {
  nadPath: string;
  addrfeatDir: string;
  nadVintage: string;
  addrfeatVintage: string;
  states: string[];
  outputDir: string;
  dryRun: boolean;
  downloadConcurrency: number;
  transformWorkers: number;
}

/** Census-friendly ceiling — never point more than this at www2.census.gov. */
const MAX_DOWNLOAD_CONCURRENCY = 12;
const MAX_TRANSFORM_WORKERS = 8;

export const DEFAULT_DOWNLOAD_CONCURRENCY = 6;
export const DEFAULT_TRANSFORM_WORKERS = Math.min(
  Math.max(1, cpus().length - 1),
  MAX_TRANSFORM_WORKERS
);

function parseBoundedInt(raw: string, flag: string, max: number): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    console.error(`Error: ${flag} must be an integer in [1, ${max}], got '${raw}'`);
    process.exit(1);
  }
  return n;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let nadPath = '';
  let addrfeatDir = './data/addrfeat-cache';
  let nadVintage = 'unknown';
  let addrfeatVintage = 'unknown';
  let states: string[] = [];
  let outputDir = './output/chunked';
  let dryRun = false;
  let downloadConcurrency = DEFAULT_DOWNLOAD_CONCURRENCY;
  let transformWorkers = DEFAULT_TRANSFORM_WORKERS;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--nad':
        nadPath = argv[++i];
        break;
      case '--addrfeat-dir':
        addrfeatDir = argv[++i];
        break;
      case '--nad-vintage':
        nadVintage = argv[++i];
        break;
      case '--addrfeat-vintage':
        addrfeatVintage = argv[++i];
        break;
      case '--states':
        states = (argv[++i] ?? '')
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter((s) => s.length > 0);
        break;
      case '--output':
        outputDir = argv[++i];
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--download-concurrency':
        downloadConcurrency = parseBoundedInt(
          argv[++i] ?? '',
          '--download-concurrency',
          MAX_DOWNLOAD_CONCURRENCY
        );
        break;
      case '--transform-workers':
        transformWorkers = parseBoundedInt(
          argv[++i] ?? '',
          '--transform-workers',
          MAX_TRANSFORM_WORKERS
        );
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
      default:
        console.error(`Unknown argument: ${arg}`);
        printUsage();
        process.exit(1);
    }
  }

  for (const st of states) {
    if (!(st in STATE_ABBR_TO_FIPS)) {
      console.error(`Error: unknown state abbreviation in --states: ${st}`);
      process.exit(1);
    }
  }

  return {
    nadPath,
    addrfeatDir,
    nadVintage,
    addrfeatVintage,
    states,
    outputDir,
    dryRun,
    downloadConcurrency,
    transformWorkers,
  };
}

function printUsage(): void {
  console.error(`
Usage:
  tsx scripts/build-address-index.ts [options]

Sources (at least one required for a real run):
  --nad <path|->             NAD quarterly text release (.txt); '-' = stdin
                             (stream-parsed; pair with e.g. curl … | funzip)
  --addrfeat-dir <path>      Download/reuse dir for TIGER ADDRFEAT county
                             zips (retry/resume). Default: ./data/addrfeat-cache

Vintages (fail-loud; 'unknown' can never land in a produced manifest):
  --nad-vintage <YYYY-MM-DD>    NAD release compile date (e.g. 2026-06-30)
  --addrfeat-vintage <TIGER20YY> ADDRFEAT vintage (e.g. TIGER2025); also
                             selects the census.gov download year

Options:
  --states <csv>             Limit to these states (e.g. DE,RI,DC). Default: all.
  --output <path>            Output dir. Default: ./output/chunked
  --download-concurrency <n> Bounded ADDRFEAT download pool size (1-${MAX_DOWNLOAD_CONCURRENCY}).
                             Default: ${DEFAULT_DOWNLOAD_CONCURRENCY} (Census-friendly).
  --transform-workers <n>    Forked shapefile-transform workers (1-${MAX_TRANSFORM_WORKERS}).
                             Default: min(cpus-1, ${MAX_TRANSFORM_WORKERS}).
  --dry-run                  Print the plan without downloading or writing.
  -h, --help                 Print this message
`);
}

// ---------------------------------------------------------------------------
// ZIP5 spill store — bounded memory at national scale
// ---------------------------------------------------------------------------

/**
 * Records are appended per-ZIP to NDJSON spill files, then aggregated one ZIP
 * at a time. Peak memory is max(records of one ZIP) + the flush buffer, not
 * the whole country.
 */
class ZipSpillStore {
  private buffers = new Map<string, string[]>();
  private buffered = 0;
  private readonly flushThreshold: number;
  readonly dir: string;

  constructor(dir: string, flushThreshold = 500_000) {
    this.dir = dir;
    this.flushThreshold = flushThreshold;
    mkdirSync(dir, { recursive: true });
  }

  push(zip: string, record: unknown[]): void {
    let buf = this.buffers.get(zip);
    if (!buf) {
      buf = [];
      this.buffers.set(zip, buf);
    }
    buf.push(JSON.stringify(record));
    this.buffered++;
    if (this.buffered >= this.flushThreshold) this.flush();
  }

  flush(): void {
    for (const [zip, lines] of this.buffers) {
      if (lines.length === 0) continue;
      appendFileSync(join(this.dir, `${zip}.ndjson`), lines.join('\n') + '\n');
    }
    this.buffers.clear();
    this.buffered = 0;
  }

  zips(): string[] {
    this.flush();
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.ndjson'))
      .map((f) => f.slice(0, -'.ndjson'.length))
      .filter((z) => ZIP5_PATTERN.test(z))
      .sort();
  }

  readZip(zip: string): unknown[][] {
    const raw = readFileSync(join(this.dir, `${zip}.ndjson`), 'utf-8');
    return raw
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as unknown[]);
  }

  cleanup(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Source download helpers (pooled ADDRFEAT)
// ---------------------------------------------------------------------------

interface SourceLogEntry {
  url: string;
  file: string;
  sha256: string;
  bytes: number;
  reused: boolean;
}

/**
 * Resolve the county-FIPS list for the requested states by scanning the
 * census.gov ADDRFEAT directory index — always matches what census actually
 * published for that vintage (no maintained county list to drift).
 */
async function listAddrfeatCounties(
  tigerYear: string,
  stateFipsSet: ReadonlySet<string>
): Promise<string[]> {
  const indexUrl = `https://www2.census.gov/geo/tiger/TIGER${tigerYear}/ADDRFEAT/`;
  const html = (await downloadWithRetry(indexUrl)).toString('utf-8');
  const re = new RegExp(`tl_${tigerYear}_(\\d{5})_addrfeat\\.zip`, 'g');
  const counties = new Set<string>();
  for (const m of html.matchAll(re)) {
    const fips5 = m[1];
    if (stateFipsSet.size === 0 || stateFipsSet.has(fips5.slice(0, 2))) {
      counties.add(fips5);
    }
  }
  return [...counties].sort();
}

// ---------------------------------------------------------------------------
// ADDRFEAT transform workers (child_process.fork — same pattern as
// build-chunked-mapping.ts). A worker receives a cached county zip path,
// runs shapefile→GeoJSON→range emission, and writes the spill records as
// NDJSON [zip5, record] lines for the main process to ingest IN COUNTY ORDER.
// ---------------------------------------------------------------------------

const IS_ADDRFEAT_WORKER = process.env.__ADDRFEAT_WORKER__ === '1';

interface WorkerCountyTask {
  type: 'county';
  fips5: string;
  stateAbbr: string;
  zipPath: string;
  outPath: string;
}

interface WorkerExit {
  type: 'exit';
}

interface WorkerCountyDone {
  type: 'done';
  fips5: string;
  outPath: string;
  edges: number;
  ranges: number;
  skipped: number;
}

interface WorkerCountyError {
  type: 'error';
  fips5: string;
  message: string;
}

class AddrfeatWorkerPool {
  private readonly children: ChildProcess[] = [];
  private readonly idle: ChildProcess[] = [];
  private readonly waiters: Array<(w: ChildProcess) => void> = [];

  constructor(count: number, workerFile: string) {
    for (let i = 0; i < count; i++) {
      const child = fork(workerFile, [], {
        env: { ...process.env, __ADDRFEAT_WORKER__: '1' },
      });
      this.children.push(child);
      this.idle.push(child);
    }
  }

  private acquire(): Promise<ChildProcess> {
    const w = this.idle.pop();
    if (w) return Promise.resolve(w);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private release(w: ChildProcess): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(w);
    else this.idle.push(w);
  }

  /** Run one county on the next free worker. Fail-loud: transform errors and
   *  worker deaths reject — they surface at the ordered-ingest await. */
  async run(task: Omit<WorkerCountyTask, 'type'>): Promise<WorkerCountyDone> {
    const child = await this.acquire();
    try {
      return await new Promise<WorkerCountyDone>((resolve, reject) => {
        const onMessage = (msg: WorkerCountyDone | WorkerCountyError): void => {
          if (msg.fips5 !== task.fips5) return;
          cleanup();
          if (msg.type === 'done') resolve(msg);
          else reject(new Error(`county ${task.fips5} transform failed: ${msg.message}`));
        };
        const onExit = (code: number | null): void => {
          cleanup();
          reject(
            new Error(`ADDRFEAT worker exited (code ${code}) while processing county ${task.fips5}`)
          );
        };
        const cleanup = (): void => {
          child.off('message', onMessage);
          child.off('exit', onExit);
        };
        child.on('message', onMessage);
        child.on('exit', onExit);
        if (!child.connected) {
          cleanup();
          reject(new Error(`ADDRFEAT worker not connected for county ${task.fips5}`));
          return;
        }
        try {
          child.send({ type: 'county', ...task } satisfies WorkerCountyTask);
        } catch (error) {
          cleanup();
          reject(error as Error);
        }
      });
    } finally {
      this.release(child);
    }
  }

  shutdown(): void {
    for (const child of this.children) {
      try {
        child.send({ type: 'exit' } satisfies WorkerExit);
      } catch {
        /* already gone */
      }
      const killer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, 5_000);
      killer.unref();
      child.once('exit', () => clearTimeout(killer));
    }
  }
}

// ---------------------------------------------------------------------------
// ADDRFEAT feature → spill records
// ---------------------------------------------------------------------------

interface AddrfeatProps {
  FULLNAME?: string | null;
  LFROMHN?: string | null;
  LTOHN?: string | null;
  RFROMHN?: string | null;
  RTOHN?: string | null;
  ZIPL?: string | null;
  ZIPR?: string | null;
  PARITYL?: string | null;
  PARITYR?: string | null;
}

/** Minimal spill-write seam — satisfied by ZipSpillStore (main process) and
 *  by the worker's NDJSON line collector. Same records either way. */
interface SpillSink {
  push(zip: string, record: unknown[]): void;
}

function ingestAddrfeatFeature(
  feature: { properties?: unknown; geometry?: unknown },
  stateAbbr: string,
  spill: SpillSink,
  counters: { ranges: number; skipped: number }
): void {
  const props = (feature.properties ?? {}) as AddrfeatProps;
  const geometry = feature.geometry as { type: string; coordinates: unknown } | undefined;
  if (!geometry) {
    counters.skipped++;
    return;
  }
  const ends = edgeEndsOf(geometry);
  if (!ends) {
    counters.skipped++;
    return;
  }
  const fullname = (props.FULLNAME ?? '').trim();
  if (fullname.length === 0) {
    counters.skipped++;
    return;
  }

  const sides = [
    {
      fromHn: (props.LFROMHN ?? '').trim(),
      toHn: (props.LTOHN ?? '').trim(),
      zip: (props.ZIPL ?? '').trim(),
      parity: (props.PARITYL ?? '').trim(),
      fullname,
    },
    {
      fromHn: (props.RFROMHN ?? '').trim(),
      toHn: (props.RTOHN ?? '').trim(),
      zip: (props.ZIPR ?? '').trim(),
      parity: (props.PARITYR ?? '').trim(),
      fullname,
    },
  ];

  for (const side of sides) {
    if (side.fromHn.length === 0 && side.toHn.length === 0) continue;
    const emitted = emitSideRange(side, ends, parseLeadingInteger, normalizeStreet);
    if (!emitted) {
      counters.skipped++;
      continue;
    }
    spill.push(emitted.zip, ['r', emitted.street, emitted.record, stateAbbr]);
    counters.ranges++;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const FIPS_TO_ABBR: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_ABBR_TO_FIPS).map(([abbr, fips]) => [fips, abbr])
);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Fail-loud vintage resolution BEFORE any download or write. A dry run
  // passes raw values through so an operator can preview the plan.
  const nadVintage = args.nadPath
    ? resolveNadVintage(args.nadVintage, { dryRun: args.dryRun })
    : null;
  const addrfeatVintage = resolveTigerVintage(args.addrfeatVintage, {
    dryRun: args.dryRun,
  });
  const tigerYear = addrfeatVintage.replace(/^TIGER/, '');

  const stateFipsSet = new Set(
    args.states.map((abbr) => STATE_ABBR_TO_FIPS[abbr])
  );
  const stateAbbrSet = new Set(args.states);

  console.log('Atlas-native address index build');
  console.log(`  NAD:          ${args.nadPath || '(none — src:0 skipped)'}`);
  console.log(`  NAD vintage:  ${nadVintage ?? '(n/a)'}`);
  console.log(`  ADDRFEAT dir: ${args.addrfeatDir}`);
  console.log(`  ADDRFEAT:     ${addrfeatVintage}`);
  console.log(`  States:       ${args.states.length > 0 ? args.states.join(',') : '(all)'}`);
  console.log(`  Output:       ${args.outputDir}`);
  console.log(`  Dry run:      ${args.dryRun}`);

  if (args.dryRun) {
    console.log('\nPlan:');
    console.log('  1. Stream-parse NAD rows (src:0) → ZIP5 spill files');
    console.log(
      `  2. Pooled TIGER${tigerYear} ADDRFEAT downloads (src:1, ${args.downloadConcurrency} concurrent) → ${args.transformWorkers} transform workers → range records (ordered ingest)`
    );
    console.log('  3. Aggregate per ZIP5 → US/addresses/{zip5}.json (5-dp coords, E/O/B parity)');
    console.log('  4. Emit normalization.json (Pub 28 B/C1/C2) + chunk-index.json (sha256/bytes)');
    console.log('  5. MERGE addressIndex*/third clock into US/manifest.json (boundary/officials clocks untouched)');
    console.log('\nDry run — nothing downloaded, nothing written.');
    return;
  }

  const addressesDir = join(args.outputDir, 'US', 'addresses');
  mkdirSync(addressesDir, { recursive: true });
  const spill = new ZipSpillStore(join(args.outputDir, 'US', 'addresses.tmp'));
  const sourcesLog: SourceLogEntry[] = [];
  const sourceMix: Record<string, { nadPoints: number; tigerRanges: number }> = {};
  const mixOf = (state: string) => {
    const key = state || '??';
    let m = sourceMix[key];
    if (!m) {
      m = { nadPoints: 0, tigerRanges: 0 };
      sourceMix[key] = m;
    }
    return m;
  };

  // ---- Phase 1: NAD (src:0) — stream, never whole-file ----
  let nadRows = 0;
  let nadSkipped = 0;
  if (args.nadPath) {
    console.log('\nPhase 1: streaming NAD text release…');
    const input: Readable =
      args.nadPath === '-' ? process.stdin : createReadStream(args.nadPath);
    for await (const row of streamNadRows(input, {
      states: stateAbbrSet.size > 0 ? stateAbbrSet : undefined,
      onSkip: () => {
        nadSkipped++;
      },
    })) {
      const street = normalizeStreet(row.streetLine);
      const hnKey = normalizeHouseNumberKey(row.houseNumber);
      if (street.length === 0 || hnKey === null) {
        nadSkipped++;
        continue;
      }
      spill.push(row.zip, ['p', street, hnKey, row.latitude, row.longitude, 0, row.state]);
      nadRows++;
      if (nadRows % 1_000_000 === 0) {
        console.log(`  ${nadRows.toLocaleString()} NAD rows ingested…`);
      }
    }
    console.log(`  NAD rows ingested: ${nadRows.toLocaleString()} (skipped ${nadSkipped.toLocaleString()})`);
  }

  // ---- Phase 2: TIGER ADDRFEAT (src:1) — pooled downloads + forked
  //      transform workers, ordered ingest (spill bytes identical to the
  //      old sequential loop) ----
  const addrfeatCounters = { ranges: 0, skipped: 0 };
  console.log(`\nPhase 2: TIGER${tigerYear} ADDRFEAT county batches…`);
  const counties = await listAddrfeatCounties(tigerYear, stateFipsSet);
  const totalStates = new Set(counties.map((f) => f.slice(0, 2))).size;
  console.log(
    `  Counties to ingest: ${counties.length} across ${totalStates} states | downloads: ${args.downloadConcurrency} | workers: ${args.transformWorkers}`
  );

  if (counties.length > 0) {
    const downloadSem = new Semaphore(args.downloadConcurrency);
    // Lookahead window: bounds downloaded-but-uningested counties so tmp
    // NDJSON backlog stays small while keeping both pools saturated.
    const windowSem = new Semaphore(
      Math.max(args.downloadConcurrency + args.transformWorkers, 32)
    );
    const pool = new AddrfeatWorkerPool(args.transformWorkers, fileURLToPath(import.meta.url));
    const tmpDir = join(args.outputDir, 'US', 'addrfeat.tmp');
    mkdirSync(tmpDir, { recursive: true });
    mkdirSync(args.addrfeatDir, { recursive: true });
    const sourceEntries = new Map<string, SourceLogEntry>();

    const phase2Start = Date.now();
    try {
      const countyPromises = counties.map((fips5) => {
        const p = (async (): Promise<WorkerCountyDone> => {
          await windowSem.acquire(); // released after this county is ingested
          const name = `tl_${tigerYear}_${fips5}_addrfeat.zip`;
          const url = `https://www2.census.gov/geo/tiger/TIGER${tigerYear}/ADDRFEAT/${name}`;
          const cached = join(args.addrfeatDir, name);
          const dl = await downloadSem.run(() => downloadZipToCache(url, cached));
          sourceEntries.set(fips5, {
            url,
            file: name,
            sha256: dl.sha256,
            bytes: dl.bytes,
            reused: dl.reused,
          });
          return pool.run({
            fips5,
            stateAbbr: FIPS_TO_ABBR[fips5.slice(0, 2)] ?? '??',
            zipPath: cached,
            outPath: join(tmpDir, `${fips5}.ndjson`),
          });
        })();
        // Mark handled — the ordered-ingest loop below rethrows in county
        // order, so a failure can never be silently skipped.
        p.catch(() => {});
        return p;
      });

      // Ordered ingest: county-FIPS order regardless of completion order.
      let stateIdx = 0;
      let currentStateFips = '';
      let stateStartMs = 0;
      let stateCounties = 0;
      const finishState = (): void => {
        if (currentStateFips === '') return;
        const mins = (Date.now() - stateStartMs) / 60_000;
        const rate = mins > 0 ? (stateCounties / mins).toFixed(1) : '∞';
        console.log(
          `  [state ${stateIdx}/${totalStates}] ${FIPS_TO_ABBR[currentStateFips] ?? currentStateFips} done: ${stateCounties} counties in ${mins.toFixed(1)} min (${rate} counties/min)`
        );
      };

      for (let i = 0; i < counties.length; i++) {
        const fips5 = counties[i];
        const stateFips = fips5.slice(0, 2);
        const stateAbbr = FIPS_TO_ABBR[stateFips] ?? '??';
        if (stateFips !== currentStateFips) {
          finishState();
          currentStateFips = stateFips;
          stateIdx++;
          stateStartMs = Date.now();
          stateCounties = 0;
          console.log(
            `  [state ${stateIdx}/${totalStates}] ${stateAbbr} starting (county ${i + 1}/${counties.length})`
          );
        }
        const done = await countyPromises[i]; // fail-loud: rejection aborts here
        const raw = readFileSync(done.outPath, 'utf-8');
        for (const line of raw.split('\n')) {
          if (line.length === 0) continue;
          const [zip5, record] = JSON.parse(line) as [string, unknown[]];
          spill.push(zip5, record);
        }
        rmSync(done.outPath, { force: true });
        addrfeatCounters.ranges += done.ranges;
        addrfeatCounters.skipped += done.skipped;
        stateCounties++;
        windowSem.release();
        console.log(
          `  ${fips5} (${stateAbbr}): ${done.edges.toLocaleString()} edges → ${done.ranges.toLocaleString()} ranges`
        );
      }
      finishState();
    } finally {
      pool.shutdown();
      rmSync(tmpDir, { recursive: true, force: true });
    }

    // Sources log in county order — deterministic regardless of download
    // completion order.
    for (const fips5 of counties) {
      const entry = sourceEntries.get(fips5);
      if (!entry) throw new Error(`missing sources-log entry for county ${fips5}`); // unreachable
      sourcesLog.push(entry);
    }

    const phase2Mins = (Date.now() - phase2Start) / 60_000;
    const overallRate = phase2Mins > 0 ? (counties.length / phase2Mins).toFixed(1) : '∞';
    console.log(
      `  ADDRFEAT throughput: ${counties.length} counties in ${phase2Mins.toFixed(1)} min → ${overallRate} counties/min`
    );
  }
  console.log(
    `  ADDRFEAT ranges: ${addrfeatCounters.ranges.toLocaleString()} (skipped sides: ${addrfeatCounters.skipped.toLocaleString()})`
  );

  // ---- Phase 3: aggregate per ZIP5 → chunk files ----
  console.log('\nPhase 3: assembling ZIP5 chunks…');
  const chunkIndex: Record<string, ChunkIndexEntry> = {};
  // §1 guard v2 runs over EVERY emitted file (stubs + shards + unsplit), not
  // one number per ZIP — a split ZIP's chunk-index entry only names its stub.
  const emittedFileBytes: number[] = [];
  let splitZipCount = 0;
  let totalStreets = 0;
  let totalPoints = 0;
  let totalRanges = 0;
  const zips = spill.zips();
  for (const zip of zips) {
    const acc: ZipAccumulator = newZipAccumulator();
    for (const rec of spill.readZip(zip)) {
      if (rec[0] === 'p') {
        const [, street, hnKey, lat, lng, src, state] = rec as [
          string, string, string, number, number, 0 | 1, string,
        ];
        if (addPoint(acc, street, hnKey, lat, lng, src, state)) {
          totalPoints++;
          if (src === 0) mixOf(state).nadPoints++;
        }
      } else if (rec[0] === 'r') {
        const [, street, record, state] = rec as [
          string, string, [number, number, 'E' | 'O' | 'B', number, number, number, number], string,
        ];
        addRange(acc, street, record, state);
        totalRanges++;
        mixOf(state).tigerRanges++;
      }
    }
    const chunk = buildChunk(zip, acc);
    const written = writeChunkFileAutoSplit(addressesDir, chunk);
    chunkIndex[zip] = written.entry;
    emittedFileBytes.push(...written.emittedFileBytes);
    if (written.emittedFileBytes.length > 1) splitZipCount++;
    totalStreets += chunkIndex[zip].streetCount;
  }
  spill.cleanup();
  console.log(
    `  Chunks: ${zips.length.toLocaleString()} (${splitZipCount.toLocaleString()} split) | streets: ${totalStreets.toLocaleString()} | points: ${totalPoints.toLocaleString()} | ranges: ${totalRanges.toLocaleString()}`
  );

  // §1 size guard — over every emitted file; a breach is a producer bug.
  const guard = chunkSizeGuard(emittedFileBytes);
  console.log(
    `  Size guard: p95=${guard.p95Bytes.toLocaleString()} B (≤262144), max=${guard.maxBytes.toLocaleString()} B (≤1048576) → ${guard.ok ? 'OK' : 'BREACH'}`
  );
  if (!guard.ok) {
    throw new Error(
      `chunk size guard breach: p95=${guard.p95Bytes} max=${guard.maxBytes} — producer bug, do not publish`
    );
  }

  // ---- Phase 4: normalization.json + chunk-index.json (§3/§4) ----
  const normArtifact = writeJsonArtifact(
    join(addressesDir, 'normalization.json'),
    buildNormalizationJson()
  );
  const chunkIndexArtifact = writeJsonArtifact(
    join(addressesDir, 'chunk-index.json'),
    chunkIndex
  );

  // ---- Phase 5: MERGE the manifest (third clock; never clobber) ----
  const fields: AddressIndexManifestFields = {
    addressIndexGenerated: new Date().toISOString(),
    addressIndexVersion: 1,
    addressIndex: {
      // §1 split scheme (SEAM-CONTRACT v2): oversized ZIP5 chunks are now
      // stub+shard; the consumer accepts both 1 (all-unsplit) and 2.
      schemaVersion: 2,
      normVersion: NORM_VERSION,
      normTable: {
        path: 'addresses/normalization.json',
        sha256: normArtifact.sha256,
        bytes: normArtifact.bytes,
      },
      nadVintage,
      addrfeatVintage,
      totalChunks: zips.length,
      totalStreets,
      totalPoints,
      totalRanges,
      chunkIndex: {
        path: 'addresses/chunk-index.json',
        sha256: chunkIndexArtifact.sha256,
        bytes: chunkIndexArtifact.bytes,
      },
      sourceMix,
    },
  };
  const manifestPath = mergeAddressIndexIntoManifest(args.outputDir, fields);
  console.log(`  Manifest merged: ${manifestPath}`);

  // ---- Phase 6: sources log (computed sha256s — census publishes no pins) ----
  const sourcesPath = join(args.outputDir, 'address-index-sources.json');
  writeFileSync(
    sourcesPath,
    JSON.stringify(
      {
        generated: fields.addressIndexGenerated,
        nad: args.nadPath
          ? { path: args.nadPath, vintage: nadVintage, rowsIngested: nadRows, rowsSkipped: nadSkipped }
          : null,
        addrfeat: {
          vintage: addrfeatVintage,
          downloads: sourcesLog,
          rangesEmitted: addrfeatCounters.ranges,
          sidesSkipped: addrfeatCounters.skipped,
        },
        sourceMix,
      },
      null,
      2
    )
  );
  console.log(`  Sources log: ${sourcesPath}`);
  console.log('\nDone.');
}

// ---------------------------------------------------------------------------
// Worker process — transforms one county at a time on request
// ---------------------------------------------------------------------------

function runAddrfeatWorker(): void {
  process.on('message', (msg: WorkerCountyTask | WorkerExit) => {
    if (msg.type === 'exit') process.exit(0);
    if (msg.type !== 'county') return;
    void (async () => {
      try {
        const zip = readFileSync(msg.zipPath);
        const fc = await transformShapefileToGeoJSON(zip);
        const counters = { ranges: 0, skipped: 0 };
        const lines: string[] = [];
        const sink: SpillSink = {
          push: (zip5, record) => {
            lines.push(JSON.stringify([zip5, record]));
          },
        };
        for (const feature of fc.features) {
          ingestAddrfeatFeature(feature, msg.stateAbbr, sink, counters);
        }
        writeFileSync(msg.outPath, lines.length > 0 ? lines.join('\n') + '\n' : '');
        process.send!({
          type: 'done',
          fips5: msg.fips5,
          outPath: msg.outPath,
          edges: fc.features.length,
          ranges: counters.ranges,
          skipped: counters.skipped,
        } satisfies WorkerCountyDone);
      } catch (error) {
        process.send!({
          type: 'error',
          fips5: msg.fips5,
          message: error instanceof Error ? error.message : String(error),
        } satisfies WorkerCountyError);
      }
    })();
  });
}

// Only run main() when invoked as a CLI (mirrors the IS_WORKER guard pattern);
// unit tests import parseArgs and the emission modules without side effects.
// A forked child shares argv[1], so the worker check MUST come first.
const invokedDirectly =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('build-address-index.ts') ||
    process.argv[1].endsWith('build-address-index.js'));

if (IS_ADDRFEAT_WORKER) {
  runAddrfeatWorker();
} else if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
