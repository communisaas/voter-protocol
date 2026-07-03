/**
 * Address-index chunk emission — SEAM-CONTRACT v1 (atlas-address-index) §1/§2/§4.
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
 * Manifest clock discipline (§4): `addressIndexGenerated` is a THIRD clock,
 * distinct from `generated` (boundary) and `officialsGenerated` (officials) —
 * never collapsed, never borrowed. The merge below leaves every pre-existing
 * manifest field byte-unchanged; a fresh address ingest must not make a
 * quarter-stale boundary look fresh, and vice versa.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
    schemaVersion: 1;
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
