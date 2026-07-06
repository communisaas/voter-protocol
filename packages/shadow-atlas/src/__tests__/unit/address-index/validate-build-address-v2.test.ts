import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { checkAddressIndex } from '../../../../scripts/validate-build.js';

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function writeJson(path: string, value: unknown): { bytes: number; sha256: string } {
  const buf = Buffer.from(JSON.stringify(value), 'utf-8');
  writeFileSync(path, buf);
  return { bytes: buf.length, sha256: sha256(buf) };
}

describe('validate-build address index v2 shard integrity', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), 'validate-address-v2-'));
    mkdirSync(join(outputDir, 'US', 'addresses'), { recursive: true });
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  function writeFixture(tamperShardHash = false): Record<string, unknown> {
    const addressesDir = join(outputDir, 'US', 'addresses');
    const shard = {
      v: 2,
      zip: '94999',
      shard: 0,
      shards: 1,
      streets: {
        'MAIN ST': { points: [['1', 37.7, -122.4, 0, 'CA']], ranges: [] },
      },
    };
    const shardArtifact = writeJson(join(addressesDir, '94999.0.json'), shard);
    const stub = {
      v: 2,
      schema: 'atlas-address-index',
      country: 'US',
      zip: '94999',
      state: 'CA',
      zipCentroid: [37.7, -122.4],
      shards: 1,
      shardHashes: [
        {
          bytes: shardArtifact.bytes,
          sha256: tamperShardHash ? '0'.repeat(64) : shardArtifact.sha256,
        },
      ],
    };
    const stubArtifact = writeJson(join(addressesDir, '94999.json'), stub);
    const chunkIndexArtifact = writeJson(join(addressesDir, 'chunk-index.json'), {
      '94999': { streetCount: 1, bytes: stubArtifact.bytes, sha256: stubArtifact.sha256 },
    });
    const normArtifact = writeJson(join(addressesDir, 'normalization.json'), { normVersion: 1 });

    return {
      version: 1,
      generated: '2026-01-01T00:00:00.000Z',
      country: 'US',
      totalCells: 0,
      totalChunks: 0,
      resolution: 7,
      slotNames: {},
      chunks: {},
      addressIndexGenerated: '2026-01-01T00:00:00.000Z',
      addressIndexVersion: 1,
      addressIndex: {
        schemaVersion: 2,
        normVersion: 1,
        normTable: { path: 'addresses/normalization.json', ...normArtifact },
        nadVintage: null,
        addrfeatVintage: null,
        totalChunks: 1,
        totalStreets: 1,
        totalPoints: 1,
        totalRanges: 0,
        chunkIndex: { path: 'addresses/chunk-index.json', ...chunkIndexArtifact },
      },
    };
  }

  it('passes on coherent v2 stub and shard pins', () => {
    const manifest = writeFixture();
    const result = checkAddressIndex(outputDir, 'US', manifest as never);

    expect(result.status).toBe('pass');
    expect(result.message).toContain('addressIndex valid');
    const chunkIndex = JSON.parse(readFileSync(join(outputDir, 'US', 'addresses', 'chunk-index.json'), 'utf-8')) as {
      '94999': { bytes: number };
    };
    expect(readFileSync(join(outputDir, 'US', 'addresses', '94999.json')).length).toBe(
      chunkIndex['94999'].bytes
    );
  });

  it('fails when a v2 shard hash does not match the stub pin', () => {
    const manifest = writeFixture(true);
    const result = checkAddressIndex(outputDir, 'US', manifest as never);

    expect(result.status).toBe('fail');
    expect((result.details?.failures as string[]).some((f) => f.includes('addresses/94999.0.json: sha256 mismatch'))).toBe(
      true
    );
  });
});
