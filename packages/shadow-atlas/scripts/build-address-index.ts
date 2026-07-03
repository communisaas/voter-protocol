#!/usr/bin/env tsx
/**
 * Build the atlas-native address index — SEAM-CONTRACT v1 (atlas-address-index).
 *
 * Ingests two public sources into ZIP5-keyed chunk files:
 *   src:0 — NAD quarterly text release (stream-parsed; NEVER whole-file in
 *           memory — the national file is ~30 GB uncompressed)
 *   src:1 — TIGER ADDRFEAT county files (county-batched download with
 *           retry/resume; each county zip is a few MB)
 *
 * Outputs (under <outputDir>, default ./output/chunked):
 *   US/addresses/{zip5}.json        — §2 chunk files
 *   US/addresses/normalization.json — §3 Pub 28 tables (normVersion pinned)
 *   US/addresses/chunk-index.json   — per-chunk sha256/bytes (§4; NOT inline)
 *   US/manifest.json                — MERGED addressIndex* fields (§4). All
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

import { createHash } from 'node:crypto';
import {
  appendFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

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
  writeChunkFile,
  writeJsonArtifact,
  ZIP5_PATTERN,
  type AddressIndexManifestFields,
  type ChunkIndexEntry,
  type ZipAccumulator,
} from '../src/distribution/addresses/chunk-emit.js';
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
}

export function parseArgs(argv: string[]): ParsedArgs {
  let nadPath = '';
  let addrfeatDir = './data/addrfeat-cache';
  let nadVintage = 'unknown';
  let addrfeatVintage = 'unknown';
  let states: string[] = [];
  let outputDir = './output/chunked';
  let dryRun = false;

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

  return { nadPath, addrfeatDir, nadVintage, addrfeatVintage, states, outputDir, dryRun };
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
// Source download helpers (county-batched ADDRFEAT)
// ---------------------------------------------------------------------------

interface SourceLogEntry {
  url: string;
  file: string;
  sha256: string;
  bytes: number;
  reused: boolean;
}

async function downloadWithRetry(
  url: string,
  maxRetries = 4,
  retryDelayMs = 3_000
): Promise<Buffer> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error as Error;
      console.warn(`  download attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
      }
    }
  }
  throw new Error(`Download failed after ${maxRetries} attempts: ${url}: ${lastError?.message}`);
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

/**
 * Download one county ADDRFEAT zip with retry/resume: an existing non-empty
 * cached file with a valid zip magic is reused instead of re-fetched.
 */
async function fetchCountyZip(
  tigerYear: string,
  fips5: string,
  cacheDir: string,
  sourcesLog: SourceLogEntry[]
): Promise<Buffer> {
  const name = `tl_${tigerYear}_${fips5}_addrfeat.zip`;
  const url = `https://www2.census.gov/geo/tiger/TIGER${tigerYear}/ADDRFEAT/${name}`;
  const cached = join(cacheDir, name);

  let buf: Buffer | null = null;
  let reused = false;
  if (existsSync(cached) && statSync(cached).size > 4) {
    const candidate = readFileSync(cached);
    // Zip local-file-header magic: PK\x03\x04 — guards truncated downloads.
    if (candidate[0] === 0x50 && candidate[1] === 0x4b) {
      buf = candidate;
      reused = true;
    }
  }
  if (!buf) {
    buf = await downloadWithRetry(url);
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cached, buf);
  }

  sourcesLog.push({
    url,
    file: name,
    sha256: createHash('sha256').update(buf).digest('hex'),
    bytes: buf.length,
    reused,
  });
  return buf;
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

function ingestAddrfeatFeature(
  feature: { properties?: unknown; geometry?: unknown },
  stateAbbr: string,
  spill: ZipSpillStore,
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
    console.log(`  2. County-batched TIGER${tigerYear} ADDRFEAT download (src:1) → range records`);
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

  // ---- Phase 2: TIGER ADDRFEAT (src:1) — county-batched, always runs ----
  const addrfeatCounters = { ranges: 0, skipped: 0 };
  console.log(`\nPhase 2: TIGER${tigerYear} ADDRFEAT county batches…`);
  const counties = await listAddrfeatCounties(tigerYear, stateFipsSet);
  console.log(`  Counties to ingest: ${counties.length}`);
  for (const fips5 of counties) {
    const stateAbbr = FIPS_TO_ABBR[fips5.slice(0, 2)] ?? '??';
    const zip = await fetchCountyZip(tigerYear, fips5, args.addrfeatDir, sourcesLog);
    const fc = await transformShapefileToGeoJSON(zip);
    const before = addrfeatCounters.ranges;
    for (const feature of fc.features) {
      ingestAddrfeatFeature(feature, stateAbbr, spill, addrfeatCounters);
    }
    console.log(
      `  ${fips5} (${stateAbbr}): ${fc.features.length.toLocaleString()} edges → ${(addrfeatCounters.ranges - before).toLocaleString()} ranges`
    );
  }
  console.log(
    `  ADDRFEAT ranges: ${addrfeatCounters.ranges.toLocaleString()} (skipped sides: ${addrfeatCounters.skipped.toLocaleString()})`
  );

  // ---- Phase 3: aggregate per ZIP5 → chunk files ----
  console.log('\nPhase 3: assembling ZIP5 chunks…');
  const chunkIndex: Record<string, ChunkIndexEntry> = {};
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
    chunkIndex[zip] = writeChunkFile(addressesDir, chunk);
    totalStreets += chunkIndex[zip].streetCount;
  }
  spill.cleanup();
  console.log(
    `  Chunks: ${zips.length.toLocaleString()} | streets: ${totalStreets.toLocaleString()} | points: ${totalPoints.toLocaleString()} | ranges: ${totalRanges.toLocaleString()}`
  );

  // §1 size guard — a breach is a producer bug (split scheme revisited at v2).
  const guard = chunkSizeGuard(Object.values(chunkIndex).map((e) => e.bytes));
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
      schemaVersion: 1,
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

// Only run main() when invoked as a CLI (mirrors the IS_WORKER guard pattern);
// unit tests import parseArgs and the emission modules without side effects.
const invokedDirectly =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('build-address-index.ts') ||
    process.argv[1].endsWith('build-address-index.js'));

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
