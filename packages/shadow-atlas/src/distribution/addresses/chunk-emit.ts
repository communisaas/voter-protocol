/**
 * Address-index chunk emission — SEAM-CONTRACT v2 (atlas-address-index) §1/§2/§4.
 *
 * Pure record/chunk construction plus the manifest MERGE. The producer CLI
 * (scripts/build-address-index.ts) streams source rows through these
 * functions; unit tests drive them with a real-county ADDRFEAT extract.
 *
 * Chunk key scheme (§1): 5-digit USPS ZIP (`^\d{5}$`), path
 * `US/addresses/{zip5}.json`. Per-chunk sha256/bytes land in
 * `addresses/chunk-index.json` — NOT inline in the manifest (40K entries
 * would bloat the hot-path manifest by ~5 MB; 977-entry district precedent).
 *
 * §1 oversized-ZIP split (v2): a national build produced ZIP5s whose single
 * chunk file breached the byte guard (p95=519,071B / max=1,911,593B against
 * 262,144B / 1,048,576B limits — see chunkSizeGuard below). Rather than
 * inflate the limits (a serving-budget fact, not a target to move), an
 * oversized chunk is SPLIT: `addresses/{zip5}.json` becomes a tiny stub
 * `{v:2, zip, state, zipCentroid, shards:N}` plus N shard files
 * `addresses/{zip5}.{shard}.json`, each holding the subset of streets that
 * hash to that shard (see street-shard.ts for the deterministic
 * `stableStreetShard` assignment shared byte-identical with the consumer).
 * An UNSPLIT chunk keeps the exact v1 byte shape (`version:1`, no `v`/`shards`
 * fields) — the consumer accepts both, and the overwhelming majority of ZIP5s
 * (everything under the p95 limit) never gain the extra `v2` shape or the
 * second fetch.
 *
 * Manifest clock discipline (§4): `addressIndexGenerated` is a THIRD clock,
 * distinct from `generated` (boundary) and `officialsGenerated` (officials) —
 * never collapsed, never borrowed. The merge below leaves every pre-existing
 * manifest field byte-unchanged; a fresh address ingest must not make a
 * quarter-stale boundary look fresh, and vice versa. `addressIndex.schemaVersion`
 * is bumped 1→2 for the split scheme; the consumer accepts both 1 and 2.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stableStreetShard } from './street-shard.js';

// ---------------------------------------------------------------------------
// Record shapes (§2)
// ---------------------------------------------------------------------------

/** `[lat, lng, src]` — src 0 = NAD, 1 = TIGER-derived. 5-dp coordinates. */
export type PointRecord = [number, number, 0 | 1];

/** `[fromHn, toHn, parity, fromLat, fromLng, toLat, toLng]`, fromHn ≤ toHn. */
export type RangeRecord = [number, number, Parity, number, number, number, number];

export type Parity = 'E' | 'O' | 'B';

export interface StreetRecords {
  /** house-number string key → point */
  p?: Record<string, PointRecord>;
  r?: RangeRecord[];
}

export interface AddressChunk {
  version: 1;
  schema: 'atlas-address-index';
  country: 'US';
  zip: string;
  state: string;
  zipCentroid: [number, number];
  streets: Record<string, StreetRecords>;
}

export interface ChunkIndexEntry {
  streetCount: number;
  bytes: number;
  sha256: string;
}

export const ZIP5_PATTERN = /^\d{5}$/;

/** §2: coordinates are JSON numbers rounded to exactly 5 decimal places (~1.1 m). */
export function round5(x: number): number {
  return Math.round(x * 1e5) / 1e5;
}

// ---------------------------------------------------------------------------
// Range emission (§2) from TIGER ADDRFEAT edge features
// ---------------------------------------------------------------------------

/** One side (L or R) of an ADDRFEAT edge, already extracted from the DBF row. */
export interface AddrfeatSide {
  fromHn: string;
  toHn: string;
  zip: string;
  parity: string;
  fullname: string;
}

/**
 * Line-end coordinates of the edge geometry in [lat, lng] order,
 * first vertex → last vertex.
 */
export interface EdgeEnds {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
}

export interface EmittedRange {
  zip: string;
  /** normalized street key (caller runs normalizeStreet) */
  street: string;
  record: RangeRecord;
}

/**
 * Emit a §2 range record from one ADDRFEAT side. Descending source ranges are
 * swapped to `fromHn ≤ toHn` AND the coordinate ends are flipped with them,
 * so interpolation `t = (hn − fromHn)/(toHn − fromHn)` still walks the edge
 * in the correct physical direction. Returns null when the side carries no
 * usable range (blank house numbers / ZIP, non-numeric leading segment).
 *
 * `parseHn` is the §2 leading-integer parse; `normalize` is the §3 street
 * normalizer — injected so this stays a pure seam-shape function.
 */
export function emitSideRange(
  side: AddrfeatSide,
  ends: EdgeEnds,
  parseHn: (raw: string) => number | null,
  normalize: (raw: string) => string
): EmittedRange | null {
  if (!ZIP5_PATTERN.test(side.zip)) return null;
  const street = normalize(side.fullname);
  if (street.length === 0) return null;

  const from = parseHn(side.fromHn);
  const to = parseHn(side.toHn);
  if (from === null || to === null) return null;

  let [fromHn, toHn] = [from, to];
  let { fromLat, fromLng, toLat, toLng } = ends;
  if (fromHn > toHn) {
    // Swap the house numbers AND flip the coordinate ends together.
    [fromHn, toHn] = [toHn, fromHn];
    [fromLat, toLat] = [toLat, fromLat];
    [fromLng, toLng] = [toLng, fromLng];
  }

  const parity = resolveParity(side.parity, fromHn, toHn);

  return {
    zip: side.zip,
    street,
    record: [
      fromHn,
      toHn,
      parity,
      round5(fromLat),
      round5(fromLng),
      round5(toLat),
      round5(toLng),
    ],
  };
}

/**
 * Parity: trust the source PARITYL/PARITYR when it is a valid enum; derive
 * from the endpoints otherwise (both even → E, both odd → O, mixed → B).
 */
export function resolveParity(raw: string, fromHn: number, toHn: number): Parity {
  const t = raw.trim().toUpperCase();
  if (t === 'E' || t === 'O' || t === 'B') return t;
  const fromEven = fromHn % 2 === 0;
  const toEven = toHn % 2 === 0;
  if (fromEven && toEven) return 'E';
  if (!fromEven && !toEven) return 'O';
  return 'B';
}

/** Extract first/last vertices of a (Multi)LineString geometry as EdgeEnds. */
export function edgeEndsOf(geometry: {
  type: string;
  coordinates: unknown;
}): EdgeEnds | null {
  let coords: number[][] | null = null;
  if (geometry.type === 'LineString') {
    coords = geometry.coordinates as number[][];
  } else if (geometry.type === 'MultiLineString') {
    const parts = geometry.coordinates as number[][][];
    if (parts.length === 0) return null;
    coords = [...parts[0], ...(parts.length > 1 ? parts[parts.length - 1] : [])];
  }
  if (!coords || coords.length < 1) return null;
  const first = coords[0];
  const last = coords[coords.length - 1];
  // GeoJSON positions are [lng, lat].
  return { fromLat: first[1], fromLng: first[0], toLat: last[1], toLng: last[0] };
}

// ---------------------------------------------------------------------------
// ZIP5 accumulation (§1) — deterministic chunk assembly
// ---------------------------------------------------------------------------

export interface ZipAccumulator {
  state: Map<string, number>;
  /** street → hn → point */
  points: Map<string, Map<string, PointRecord>>;
  /** street → ranges */
  ranges: Map<string, RangeRecord[]>;
  latSum: number;
  lngSum: number;
  coordCount: number;
}

export function newZipAccumulator(): ZipAccumulator {
  return {
    state: new Map(),
    points: new Map(),
    ranges: new Map(),
    latSum: 0,
    lngSum: 0,
    coordCount: 0,
  };
}

export function addPoint(
  acc: ZipAccumulator,
  street: string,
  hnKey: string,
  lat: number,
  lng: number,
  src: 0 | 1,
  state: string
): boolean {
  let byHn = acc.points.get(street);
  if (!byHn) {
    byHn = new Map();
    acc.points.set(street, byHn);
  }
  // First record wins — deterministic under stable source order; NAD is
  // ingested before ADDRFEAT so src:0 points take precedence by construction.
  if (byHn.has(hnKey)) return false;
  byHn.set(hnKey, [round5(lat), round5(lng), src]);
  tallyState(acc, state);
  acc.latSum += lat;
  acc.lngSum += lng;
  acc.coordCount += 1;
  return true;
}

export function addRange(
  acc: ZipAccumulator,
  street: string,
  record: RangeRecord,
  state: string
): void {
  let list = acc.ranges.get(street);
  if (!list) {
    list = [];
    acc.ranges.set(street, list);
  }
  list.push(record);
  tallyState(acc, state);
  // Both ends contribute to the ZIP centroid.
  acc.latSum += record[3] + record[5];
  acc.lngSum += record[4] + record[6];
  acc.coordCount += 2;
}

function tallyState(acc: ZipAccumulator, state: string): void {
  const s = state.trim().toUpperCase();
  if (s.length === 0) return;
  acc.state.set(s, (acc.state.get(s) ?? 0) + 1);
}

/**
 * Assemble the final §2 chunk for one ZIP. Street keys, house numbers and
 * ranges are sorted so the emitted bytes (and per-chunk sha256) are
 * deterministic for a given source set.
 */
export function buildChunk(zip: string, acc: ZipAccumulator): AddressChunk {
  if (!ZIP5_PATTERN.test(zip)) {
    throw new Error(`invalid ZIP5 chunk key: "${zip}"`);
  }
  const streets: Record<string, StreetRecords> = {};
  const streetNames = new Set<string>([
    ...acc.points.keys(),
    ...acc.ranges.keys(),
  ]);
  for (const street of [...streetNames].sort()) {
    const rec: StreetRecords = {};
    const pts = acc.points.get(street);
    if (pts && pts.size > 0) {
      const p: Record<string, PointRecord> = {};
      for (const hn of [...pts.keys()].sort(compareHnKeys)) {
        p[hn] = pts.get(hn)!;
      }
      rec.p = p;
    }
    const rng = acc.ranges.get(street);
    if (rng && rng.length > 0) {
      rec.r = [...rng].sort(compareRanges);
    }
    streets[street] = rec;
  }

  const state =
    [...acc.state.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? '';

  const zipCentroid: [number, number] =
    acc.coordCount > 0
      ? [round5(acc.latSum / acc.coordCount), round5(acc.lngSum / acc.coordCount)]
      : [0, 0];

  return {
    version: 1,
    schema: 'atlas-address-index',
    country: 'US',
    zip,
    state,
    zipCentroid,
    streets,
  };
}

function compareHnKeys(a: string, b: string): number {
  const na = Number.parseInt(a, 10);
  const nb = Number.parseInt(b, 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareRanges(a: RangeRecord, b: RangeRecord): number {
  return a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Writers — chunks, normalization table, chunk-index (§1/§3/§4)
// ---------------------------------------------------------------------------

export interface WrittenArtifact {
  path: string;
  sha256: string;
  bytes: number;
}

/** Serialize + write one chunk; returns its chunk-index entry. */
export function writeChunkFile(
  addressesDir: string,
  chunk: AddressChunk
): ChunkIndexEntry {
  const json = JSON.stringify(chunk);
  const buf = Buffer.from(json, 'utf-8');
  writeFileSync(join(addressesDir, `${chunk.zip}.json`), buf);
  return {
    streetCount: Object.keys(chunk.streets).length,
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
  };
}

// ---------------------------------------------------------------------------
// §1 oversized-ZIP split (v2) — stub + deterministic shard files
// ---------------------------------------------------------------------------

/** Tiny stub written at `addresses/{zip5}.json` in place of an oversized v1 chunk. */
export interface AddressChunkStubV2 {
  v: 2;
  schema: 'atlas-address-index';
  country: 'US';
  zip: string;
  state: string;
  zipCentroid: [number, number];
  shards: number;
}

/** One shard file at `addresses/{zip5}.{shard}.json` — the streets subset only. */
export interface AddressChunkShardV2 {
  v: 2;
  zip: string;
  shard: number;
  shards: number;
  streets: Record<string, StreetRecords>;
}

/** Headroom multiplier: worst post-split shard must clear the target with ≥30% margin. */
const SPLIT_HEADROOM = 1.3;

/** Hard ceiling on shard doubling — a real chunk can never need this many. */
const MAX_SHARDS = 128;

/**
 * Partition a chunk's streets deterministically into `shards` buckets via
 * `stableStreetShard` (byte-identical hash on the consumer side). Bucket
 * iteration order follows the chunk's already-sorted street keys, so output
 * bytes are deterministic for a given (chunk, shards) pair regardless of
 * source ordering upstream.
 */
function partitionStreets(
  chunk: AddressChunk,
  shards: number
): Record<string, StreetRecords>[] {
  const buckets: Record<string, StreetRecords>[] = Array.from({ length: shards }, () => ({}));
  for (const [street, rec] of Object.entries(chunk.streets)) {
    const idx = stableStreetShard(street, shards);
    buckets[idx][street] = rec;
  }
  return buckets;
}

/** Serialize one shard file's bytes without writing (used by the guard's dry-run doubling loop). */
function serializeShard(zip: string, shard: number, shards: number, streets: Record<string, StreetRecords>): Buffer {
  const body: AddressChunkShardV2 = { v: 2, zip, shard, shards, streets };
  return Buffer.from(JSON.stringify(body), 'utf-8');
}

/** Smallest power of 2 ≥ n (n ≥ 1). */
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Minimal power-of-2 starting estimate for the shard count, derived from the
 * chunk's actual serialized size against the p95 byte target with the §1
 * headroom multiplier. This is a STARTING point only — `splitOversizedChunk`
 * re-checks the real emitted bytes and doubles N until every shard actually
 * clears the target, so the estimate does not need to be exact, only a
 * reasonable first guess (streets are not uniformly distributed across hash
 * buckets, so the true worst shard can exceed the naive mean/N).
 */
export function estimateInitialShardCount(chunkBytes: number, targetBytes = CHUNK_P95_LIMIT_BYTES): number {
  const raw = chunkBytes / (targetBytes / SPLIT_HEADROOM);
  return Math.max(2, nextPow2(Math.ceil(raw)));
}

export interface SplitOversizedChunkResult {
  stub: AddressChunkStubV2;
  shards: number;
  /** Per-shard written artifacts, index-aligned with shard number. */
  shardArtifacts: WrittenArtifact[];
  /**
   * Set when the split converged on an irreducible shard above the headroom
   * target: a single street whose own serialized ranges exceed
   * `targetBytes / SPLIT_HEADROOM` (a street's ranges are never split across
   * shards, so no shard count isolates it further). Accepted — not thrown —
   * because the §1 contract's HARD limits are the corpus-wide p95 and the
   * per-file max, both still enforced by `chunkSizeGuard` over every emitted
   * file; the headroom target is the splitter's aim, not the contract line.
   */
  floorAccepted?: { worstShardBytes: number; shards: number };
}

/**
 * Split an oversized chunk into a stub + N deterministic shard files, writing
 * both to `addressesDir`. Starts from `estimateInitialShardCount` and DOUBLES
 * N (re-partitioning and re-serializing from scratch each time — no
 * incremental merge) until every shard's serialized bytes clear the p95
 * target with the §1 headroom.
 *
 * Doubling N helps only because a real ZIP5's bytes are spread over ~190
 * streets on average (7.5M streets / 38K chunks, the national build this
 * scheme was built for) — pushing a hot street into ever-smaller company as
 * N grows. It CANNOT help a single street whose own serialized ranges alone
 * exceed the target: that street's entire byte weight lands in one shard
 * bucket no matter how large N gets (a street's ranges are never split
 * across shards). Such an irreducible shard is ACCEPTED (with
 * `floorAccepted` set so the caller can log it) as long as it clears the
 * hard per-file `CHUNK_MAX_LIMIT_BYTES` — the headroom target is the
 * splitter's aim, while the contract's real lines are the corpus-wide p95
 * and the per-file max, both still enforced by `chunkSizeGuard` over every
 * emitted file. (Real case: a national build surfaced a ~245KB single-street
 * shard — within both hard limits; refusing to publish it was over-strict.)
 * This throws ONLY when the irreducible shard exceeds the hard max itself —
 * that would breach the contract no matter how the split is arranged, and
 * would need range-level splitting (a v3 scheme change). Nothing is written
 * to `addressesDir` on the throw path (the failure is detected before any
 * file touches disk).
 *
 * Deterministic by contract: same input chunk → same N → same bytes on every
 * re-run (no randomness, no wall-clock, no Map/Set iteration-order
 * dependence — `partitionStreets` walks the chunk's already-sorted street
 * keys).
 */
export function splitOversizedChunk(
  addressesDir: string,
  chunk: AddressChunk,
  targetBytes = CHUNK_P95_LIMIT_BYTES
): SplitOversizedChunkResult {
  const originalBytes = Buffer.byteLength(JSON.stringify(chunk), 'utf-8');
  let shards = estimateInitialShardCount(originalBytes, targetBytes);

  let buckets: Record<string, StreetRecords>[];
  let serialized: Buffer[];
  let worst: number;
  let worstIsIrreducible: boolean;
  for (;;) {
    buckets = partitionStreets(chunk, shards);
    serialized = buckets.map((streets, i) => serializeShard(chunk.zip, i, shards, streets));
    worst = Math.max(...serialized.map((b) => b.length));
    const worstIdx = serialized.findIndex((b) => b.length === worst);
    // A worst shard holding exactly one street cannot shrink with more
    // shards — a street's ranges are never split across shards.
    worstIsIrreducible = Object.keys(buckets[worstIdx]).length <= 1;
    if (worst <= targetBytes / SPLIT_HEADROOM || worstIsIrreducible || shards >= MAX_SHARDS) break;
    shards *= 2;
  }

  if (worst > CHUNK_MAX_LIMIT_BYTES) {
    throw new Error(
      `chunk split guard: ZIP ${chunk.zip} has an irreducible ${worst.toLocaleString()}B shard ` +
        `(hard max ${CHUNK_MAX_LIMIT_BYTES.toLocaleString()}B) — a single street's own bytes exceed the ` +
        `per-file contract limit; sharding cannot help. Producer bug (needs range-level splitting), do not publish.`
    );
  }
  const floorAccepted =
    worst > targetBytes / SPLIT_HEADROOM ? { worstShardBytes: worst, shards } : undefined;

  const shardArtifacts: WrittenArtifact[] = serialized.map((buf, i) => {
    const path = join(addressesDir, `${chunk.zip}.${i}.json`);
    writeFileSync(path, buf);
    return { path, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
  });

  const stub: AddressChunkStubV2 = {
    v: 2,
    schema: 'atlas-address-index',
    country: 'US',
    zip: chunk.zip,
    state: chunk.state,
    zipCentroid: chunk.zipCentroid,
    shards,
  };
  const stubBuf = Buffer.from(JSON.stringify(stub), 'utf-8');
  writeFileSync(join(addressesDir, `${chunk.zip}.json`), stubBuf);

  return { stub, shards, shardArtifacts, ...(floorAccepted ? { floorAccepted } : {}) };
}

export interface WriteChunkAutoSplitResult {
  /** chunk-index entry for `addresses/{zip5}.json` — the stub's entry when split. */
  entry: ChunkIndexEntry;
  /**
   * Byte size of EVERY file this call wrote (the guard runs over every
   * emitted file — §1 v2 — not just the chunk-index entry, which for a split
   * ZIP names only the stub). Length 1 for an unsplit chunk (itself); length
   * 1 + shards for a split chunk (stub + every shard).
   */
  emittedFileBytes: number[];
  /** Present when the split accepted an irreducible over-target shard — see `SplitOversizedChunkResult.floorAccepted`. */
  floorAccepted?: { worstShardBytes: number; shards: number };
}

/**
 * Write a chunk, splitting it into stub + shards when oversized (serialized
 * bytes > `targetBytes`, default the §1 p95 limit) and writing the plain v1
 * shape otherwise. The returned chunk-index entry for `addresses/{zip5}.json`
 * is the STUB's entry for a split chunk (shard bytes are not separately
 * indexed in chunk-index.json — see `emittedFileBytes` for the guard's real
 * per-file view).
 */
export function writeChunkFileAutoSplit(
  addressesDir: string,
  chunk: AddressChunk,
  targetBytes = CHUNK_P95_LIMIT_BYTES
): WriteChunkAutoSplitResult {
  const originalBytes = Buffer.byteLength(JSON.stringify(chunk), 'utf-8');
  if (originalBytes <= targetBytes) {
    const entry = writeChunkFile(addressesDir, chunk);
    return { entry, emittedFileBytes: [entry.bytes] };
  }
  const { stub, shardArtifacts, floorAccepted } = splitOversizedChunk(addressesDir, chunk, targetBytes);
  const stubBuf = Buffer.from(JSON.stringify(stub), 'utf-8');
  const entry: ChunkIndexEntry = {
    streetCount: Object.keys(chunk.streets).length,
    bytes: Math.max(stubBuf.length, ...shardArtifacts.map((a) => a.bytes)),
    sha256: createHash('sha256').update(stubBuf).digest('hex'),
  };
  return {
    entry,
    emittedFileBytes: [stubBuf.length, ...shardArtifacts.map((a) => a.bytes)],
    ...(floorAccepted ? { floorAccepted } : {}),
  };
}

export function writeJsonArtifact(
  filePath: string,
  value: unknown
): WrittenArtifact {
  const buf = Buffer.from(JSON.stringify(value), 'utf-8');
  writeFileSync(filePath, buf);
  return {
    path: filePath,
    sha256: createHash('sha256').update(buf).digest('hex'),
    bytes: buf.length,
  };
}

// ---------------------------------------------------------------------------
// §1 size guard — p95 raw ≤ 256 KB, max ≤ 1 MB over chunkIndex bytes
// ---------------------------------------------------------------------------

export const CHUNK_P95_LIMIT_BYTES = 256 * 1024;
export const CHUNK_MAX_LIMIT_BYTES = 1024 * 1024;

export interface SizeGuardResult {
  p95Bytes: number;
  maxBytes: number;
  ok: boolean;
}

export function chunkSizeGuard(byteSizes: number[]): SizeGuardResult {
  if (byteSizes.length === 0) return { p95Bytes: 0, maxBytes: 0, ok: true };
  const sorted = [...byteSizes].sort((a, b) => a - b);
  const p95Idx = Math.min(
    sorted.length - 1,
    Math.ceil(0.95 * sorted.length) - 1
  );
  const p95Bytes = sorted[Math.max(0, p95Idx)];
  const maxBytes = sorted[sorted.length - 1];
  return {
    p95Bytes,
    maxBytes,
    ok: p95Bytes <= CHUNK_P95_LIMIT_BYTES && maxBytes <= CHUNK_MAX_LIMIT_BYTES,
  };
}

// ---------------------------------------------------------------------------
// Manifest MERGE (§4) — third clock, never clobber boundary/officials fields
// ---------------------------------------------------------------------------

export interface AddressIndexManifestFields {
  addressIndexGenerated: string;
  addressIndexVersion: 1;
  addressIndex: {
    /** 1 = every chunk unsplit (pre-v2 builds); 2 = split scheme active (§1). Consumer accepts both. */
    schemaVersion: 1 | 2;
    normVersion: number;
    normTable: { path: string; sha256: string; bytes: number };
    nadVintage: string | null;
    addrfeatVintage: string | null;
    totalChunks: number;
    totalStreets: number;
    totalPoints: number;
    totalRanges: number;
    chunkIndex: { path: string; sha256: string; bytes: number };
    /**
     * Per-state actual source mix (additive field): how many src:0 NAD
     * points vs src:1 TIGER-derived ranges each state contributed.
     */
    sourceMix: Record<string, { nadPoints: number; tigerRanges: number }>;
  };
}

/**
 * MERGE the addressIndex fields into `US/manifest.json`, leaving every
 * pre-existing field (notably the `generated` boundary clock, `tigerVintage`,
 * and the `officialsGenerated` officials clock) byte-unchanged. The manifest
 * is re-serialized with the same `JSON.stringify(…, null, 2)` formatting the
 * boundary writer uses, and JSON.parse/stringify round-trips preserve both
 * key order and value bytes for untouched fields.
 *
 * When no manifest exists yet (sample builds outside the quarterly chain),
 * a minimal shell is created — the boundary/officials clocks are simply
 * absent, never fabricated (degrade-to-null on the consumer side).
 */
export function mergeAddressIndexIntoManifest(
  outputDir: string,
  fields: AddressIndexManifestFields
): string {
  const manifestPath = join(outputDir, 'US', 'manifest.json');
  let manifest: Record<string, unknown>;
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
  } else {
    mkdirSync(join(outputDir, 'US'), { recursive: true });
    manifest = { version: 1, country: 'US' };
  }

  manifest['addressIndexGenerated'] = fields.addressIndexGenerated;
  manifest['addressIndexVersion'] = fields.addressIndexVersion;
  manifest['addressIndex'] = fields.addressIndex;

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}
