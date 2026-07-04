import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addPoint,
  addRange,
  buildChunk,
  chunkSizeGuard,
  CHUNK_MAX_LIMIT_BYTES,
  CHUNK_P95_LIMIT_BYTES,
  estimateInitialShardCount,
  newZipAccumulator,
  splitOversizedChunk,
  writeChunkFile,
  writeChunkFileAutoSplit,
  type AddressChunk,
  type AddressChunkShardV2,
  type AddressChunkStubV2,
  type ZipAccumulator,
} from '../../../distribution/addresses/chunk-emit.js';
import { stableStreetShard } from '../../../distribution/addresses/street-shard.js';
import sharedVectors from '../../../distribution/addresses/shared-vectors/stable-street-shard.vectors.json';

/**
 * SEAM-CONTRACT v2 §1 — oversized-ZIP5 stub+shard split. Reproduces the
 * breach class from the national build (p95=519,071B / max=1,911,593B
 * against 262,144B / 1,048,576B limits) with a synthetic ZIP inflated past
 * 1 MB, and asserts: every emitted file clears the guard, the split is
 * byte-identical on re-run, and a street resolves through the shared
 * stableStreetShard vectors exactly like the consumer would.
 */
describe('oversized ZIP5 split (§1 v2)', () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'address-chunk-split-'));
  });
  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  /** A synthetic ZIP with enough streets/ranges to breach CHUNK_MAX_LIMIT_BYTES. */
  function buildOversizedChunk(zip: string, streetCount: number, rangesPerStreet: number): AddressChunk {
    const acc: ZipAccumulator = newZipAccumulator();
    for (let s = 0; s < streetCount; s++) {
      const street = `SYNTHETIC STREET NUMBER ${s} AVE`;
      for (let r = 0; r < rangesPerStreet; r++) {
        const from = r * 100 + 1;
        const to = from + 98;
        addRange(
          acc,
          street,
          [from, to, 'O', 37.7 + r * 0.001, -122.4 - r * 0.001, 37.701 + r * 0.001, -122.401 - r * 0.001],
          'CA'
        );
      }
      addPoint(acc, street, '1', 37.7, -122.4, 0, 'CA');
    }
    return buildChunk(zip, acc);
  }

  it('reproduces the breach class: a synthetic chunk past 1 MB fails the plain v1 guard', () => {
    const chunk = buildOversizedChunk('94999', 800, 40);
    const bytes = Buffer.byteLength(JSON.stringify(chunk), 'utf-8');
    expect(bytes).toBeGreaterThan(CHUNK_MAX_LIMIT_BYTES);
    const guard = chunkSizeGuard([bytes]);
    expect(guard.ok).toBe(false);
  });

  it('splits into a stub + N shards, all within the p95 target with headroom', () => {
    const chunk = buildOversizedChunk('94999', 800, 40);
    const { stub, shards, shardArtifacts } = splitOversizedChunk(outDir, chunk);

    expect(stub.v).toBe(2);
    expect(stub.schema).toBe('atlas-address-index');
    expect(stub.zip).toBe('94999');
    expect(stub.shards).toBe(shards);
    expect(shards).toBeGreaterThanOrEqual(2);
    expect(shardArtifacts.length).toBe(shards);

    const target = CHUNK_P95_LIMIT_BYTES / 1.3; // §1 headroom
    for (const artifact of shardArtifacts) {
      expect(artifact.bytes).toBeLessThanOrEqual(target);
    }

    // The guard itself, run over every emitted file, passes.
    const stubBytes = Buffer.byteLength(JSON.stringify(stub), 'utf-8');
    const guard = chunkSizeGuard([stubBytes, ...shardArtifacts.map((a) => a.bytes)]);
    expect(guard.ok).toBe(true);
  });

  it('doubles N when the naive estimate under-shards a skewed distribution', () => {
    // A hot street (large range list) plus many small streets: a naive
    // even-split estimate would put the hot street's shard over target
    // regardless of N, UNLESS the doubling loop keeps growing N so hashing
    // eventually isolates it into a shard with few (or zero) neighbors. This
    // hot street is sized to be splittable — the shard it lands in alone,
    // once isolated by a large enough N, clears the target on its own.
    const acc = newZipAccumulator();
    for (let r = 0; r < 3500; r++) {
      const from = r * 10 + 1;
      addRange(acc, 'ONE HOT AVE', [from, from + 8, 'O', 37.7, -122.4, 37.701, -122.401], 'CA');
    }
    for (let s = 0; s < 800; s++) {
      const street = `SYNTHETIC STREET NUMBER ${s} AVE`;
      for (let r = 0; r < 40; r++) {
        const from = r * 100 + 1;
        addRange(
          acc,
          street,
          [from, from + 98, 'O', 37.7 + r * 0.001, -122.4 - r * 0.001, 37.701 + r * 0.001, -122.401 - r * 0.001],
          'CA'
        );
      }
    }
    const chunk = buildChunk('94998', acc);
    const bytes = Buffer.byteLength(JSON.stringify(chunk), 'utf-8');
    expect(bytes).toBeGreaterThan(CHUNK_MAX_LIMIT_BYTES);

    const naiveN = estimateInitialShardCount(bytes);
    const { shards, shardArtifacts } = splitOversizedChunk(outDir, chunk);

    // Whatever N the guard converges on, every shard clears the target —
    // the doubling loop, not the initial estimate, is what makes this true.
    const target = CHUNK_P95_LIMIT_BYTES / 1.3;
    for (const artifact of shardArtifacts) {
      expect(artifact.bytes).toBeLessThanOrEqual(target);
    }
    // Sanity: N only grows via doubling from the naive estimate.
    expect(shards).toBeGreaterThanOrEqual(naiveN);
    expect(Number.isInteger(Math.log2(shards))).toBe(true);
  });

  it('throws rather than silently publishing when a single street alone exceeds the target (doubling cannot help)', () => {
    // A single street whose own ranges alone breach the target: no shard
    // count isolates it below the limit, because a street's ranges are
    // never split across shards. This must fail loudly, not publish a shard
    // that still breaches the guard.
    const acc = newZipAccumulator();
    for (let r = 0; r < 23000; r++) {
      const from = r * 10 + 1;
      addRange(acc, 'ONE GIANT AVE', [from, from + 8, 'O', 37.7, -122.4, 37.701, -122.401], 'CA');
    }
    const chunk = buildChunk('94997', acc);
    const bytes = Buffer.byteLength(JSON.stringify(chunk), 'utf-8');
    expect(bytes).toBeGreaterThan(CHUNK_MAX_LIMIT_BYTES);

    expect(() => splitOversizedChunk(outDir, chunk)).toThrow(/producer bug/i);
  });

  it('re-run is byte-identical (deterministic emission)', () => {
    const chunk = buildOversizedChunk('94999', 800, 40);
    const dirA = mkdtempSync(join(tmpdir(), 'address-chunk-split-a-'));
    const dirB = mkdtempSync(join(tmpdir(), 'address-chunk-split-b-'));
    try {
      const a = splitOversizedChunk(dirA, chunk);
      const b = splitOversizedChunk(dirB, chunk);
      expect(a.shards).toBe(b.shards);
      expect(JSON.stringify(a.stub)).toBe(JSON.stringify(b.stub));
      expect(a.shardArtifacts.map((x) => x.sha256)).toEqual(b.shardArtifacts.map((x) => x.sha256));

      for (let i = 0; i < a.shards; i++) {
        const bufA = readFileSync(join(dirA, `94999.${i}.json`));
        const bufB = readFileSync(join(dirB, `94999.${i}.json`));
        expect(bufA.equals(bufB)).toBe(true);
      }
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it('writeChunkFileAutoSplit leaves an unsplit (under-target) chunk in the plain v1 shape', () => {
    const acc = newZipAccumulator();
    addRange(acc, 'MAIN ST', [1, 99, 'O', 37.7, -122.4, 37.701, -122.401], 'CA');
    const chunk = buildChunk('10001', acc);
    const viaAutoSplit = writeChunkFileAutoSplit(outDir, chunk);
    const plainDir = join(outDir, 'plain-check-unused');
    mkdirSync(plainDir, { recursive: true });
    const viaPlain = writeChunkFile(plainDir, chunk);
    // Same chunk written the plain v1 way produces the identical sha256 the
    // auto-split path used for this (unsplit) case.
    expect(viaAutoSplit.entry.sha256).toBe(viaPlain.sha256);
    expect(viaAutoSplit.emittedFileBytes).toEqual([viaAutoSplit.entry.bytes]);

    const written = JSON.parse(readFileSync(join(outDir, '10001.json'), 'utf-8'));
    expect(written.version).toBe(1);
    expect(written.v).toBeUndefined();
    expect(written.shards).toBeUndefined();
  });

  it('consumer resolves a street from a sharded ZIP via the shared vectors', () => {
    const chunk = buildOversizedChunk('94999', 800, 40);
    const { stub, shards } = splitOversizedChunk(outDir, chunk);

    // Pick a real street from the chunk and confirm the shard the producer
    // actually wrote it into matches stableStreetShard(street, shards) — the
    // exact computation the consumer runs against the published stub.
    const anyStreet = Object.keys(chunk.streets)[0];
    const expectedShard = stableStreetShard(anyStreet, shards);
    const shardFile: AddressChunkShardV2 = JSON.parse(
      readFileSync(join(outDir, `94999.${expectedShard}.json`), 'utf-8')
    );
    expect(shardFile.v).toBe(2);
    expect(shardFile.shard).toBe(expectedShard);
    expect(shardFile.shards).toBe(shards);
    expect(shardFile.streets[anyStreet]).toBeDefined();
    expect(shardFile.streets[anyStreet]).toEqual(chunk.streets[anyStreet]);

    // The stub alone is enough to know N and the ZIP-level fallback fields.
    const stubOnDisk: AddressChunkStubV2 = JSON.parse(readFileSync(join(outDir, '94999.json'), 'utf-8'));
    expect(stubOnDisk).toEqual(stub);
  });

  it('shared hash vectors: fnv1a32-derived shard assignment matches the committed vector file byte-for-byte', () => {
    expect(sharedVectors.hashAlgorithm).toBe('fnv1a32');
    expect(sharedVectors.vectors.length).toBeGreaterThan(0);
    for (const v of sharedVectors.vectors as Array<{ streetKey: string; shards: number; shard: number }>) {
      expect(stableStreetShard(v.streetKey, v.shards)).toBe(v.shard);
    }
  });
});
