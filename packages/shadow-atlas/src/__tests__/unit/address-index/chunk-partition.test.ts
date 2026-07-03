import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addRange,
  buildChunk,
  chunkSizeGuard,
  CHUNK_MAX_LIMIT_BYTES,
  CHUNK_P95_LIMIT_BYTES,
  edgeEndsOf,
  emitSideRange,
  newZipAccumulator,
  writeChunkFile,
  ZIP5_PATTERN,
  type ZipAccumulator,
} from '../../../distribution/addresses/chunk-emit.js';
import {
  normalizeStreet,
  parseLeadingInteger,
} from '../../../distribution/addresses/normalize.js';
import { loadFixture, sidesOf } from './fixture.js';

/**
 * SEAM-CONTRACT v1 §1 ZIP5 partitioning + §2 chunk shape + the size guard
 * (p95 raw ≤ 256 KB, max ≤ 1 MB over chunk-index bytes), driven end-to-end
 * by the real-county ADDRFEAT extract through the same emission code the
 * producer CLI runs.
 */
describe('ZIP5 chunk partitioning (§1/§2)', () => {
  const fixture = loadFixture();
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'address-chunks-'));
  });
  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  /** Run the fixture through the real emission path, partitioned by ZIP5. */
  function accumulate(): Map<string, ZipAccumulator> {
    const byZip = new Map<string, ZipAccumulator>();
    for (const f of fixture.features) {
      const ends = edgeEndsOf(f.geometry);
      if (!ends) continue;
      for (const side of sidesOf(f)) {
        const emitted = emitSideRange(side, ends, parseLeadingInteger, normalizeStreet);
        if (!emitted) continue;
        let acc = byZip.get(emitted.zip);
        if (!acc) {
          acc = newZipAccumulator();
          byZip.set(emitted.zip, acc);
        }
        addRange(acc, emitted.street, emitted.record, 'DE');
      }
    }
    return byZip;
  }

  it('partitions the real extract into multiple ZIP5-keyed chunks', () => {
    const byZip = accumulate();
    expect(byZip.size).toBeGreaterThan(1);
    for (const zip of byZip.keys()) {
      expect(ZIP5_PATTERN.test(zip)).toBe(true);
    }
  });

  it('chunks carry the §2 shape (version/schema/country/zip/state/zipCentroid/streets)', () => {
    for (const [zip, acc] of accumulate()) {
      const chunk = buildChunk(zip, acc);
      expect(chunk.version).toBe(1);
      expect(chunk.schema).toBe('atlas-address-index');
      expect(chunk.country).toBe('US');
      expect(chunk.zip).toBe(zip);
      expect(chunk.state).toBe('DE');
      expect(chunk.zipCentroid).toHaveLength(2);
      const [lat, lng] = chunk.zipCentroid;
      // Kent County, DE sits near 39°N, -75.5°E — a real centroid, not 0,0.
      expect(lat).toBeGreaterThan(37);
      expect(lat).toBeLessThan(41);
      expect(lng).toBeGreaterThan(-77);
      expect(lng).toBeLessThan(-74);
      expect(Object.keys(chunk.streets).length).toBeGreaterThan(0);
      for (const records of Object.values(chunk.streets)) {
        expect(records.r ?? records.p).toBeDefined();
      }
    }
  });

  it('rejects a non-ZIP5 chunk key (fail-loud, satisfies sanitizePathSegment)', () => {
    expect(() => buildChunk('123', newZipAccumulator())).toThrow(/ZIP5/);
    expect(() => buildChunk('1234567', newZipAccumulator())).toThrow(/ZIP5/);
    expect(() => buildChunk('ABCDE', newZipAccumulator())).toThrow(/ZIP5/);
  });

  it('chunk serialization is deterministic (identical bytes + sha256 across builds)', () => {
    const dirA = join(outDir, 'a');
    const dirB = join(outDir, 'b');
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });

    for (const [zip, acc] of accumulate()) {
      const entryA = writeChunkFile(dirA, buildChunk(zip, acc));
      const entryB = writeChunkFile(dirB, buildChunk(zip, acc));
      expect(entryA.sha256).toBe(entryB.sha256);
      expect(entryA.bytes).toBe(entryB.bytes);
      const bytesA = readFileSync(join(dirA, `${zip}.json`));
      expect(createHash('sha256').update(bytesA).digest('hex')).toBe(entryA.sha256);
    }
  });

  it('chunk-index entries carry real street counts and byte sizes', () => {
    for (const [zip, acc] of accumulate()) {
      const chunk = buildChunk(zip, acc);
      const entry = writeChunkFile(outDir, chunk);
      expect(entry.streetCount).toBe(Object.keys(chunk.streets).length);
      expect(entry.bytes).toBe(readFileSync(join(outDir, `${zip}.json`)).length);
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('§1 size guard: p95 raw ≤ 256 KB and max ≤ 1 MB over the produced chunk bytes', () => {
    const sizes: number[] = [];
    for (const [zip, acc] of accumulate()) {
      sizes.push(writeChunkFile(outDir, buildChunk(zip, acc)).bytes);
    }
    expect(sizes.length).toBeGreaterThan(0);
    const guard = chunkSizeGuard(sizes);
    expect(guard.p95Bytes).toBeLessThanOrEqual(CHUNK_P95_LIMIT_BYTES);
    expect(guard.maxBytes).toBeLessThanOrEqual(CHUNK_MAX_LIMIT_BYTES);
    expect(guard.ok).toBe(true);
  });

  it('size guard flags a breach instead of masking it', () => {
    const breached = chunkSizeGuard([100, 200, CHUNK_MAX_LIMIT_BYTES + 1]);
    expect(breached.ok).toBe(false);
    const p95Breach = chunkSizeGuard(
      Array.from({ length: 100 }, () => CHUNK_P95_LIMIT_BYTES + 1)
    );
    expect(p95Breach.ok).toBe(false);
  });
});
