/**
 * Download pool — bounded-parallel census.gov fetch orchestration.
 *
 * Verifies the four pool guarantees the national ADDRFEAT build stands on:
 *   1. bounded concurrency (never more than N fetches in flight)
 *   2. exponential backoff + jitter between failed attempts, Retry-After honored
 *   3. fail-loud on retry exhaustion (a missing county must never be a
 *      silent geographic hole)
 *   4. verified-complete cache hits skip the network entirely
 *
 * All effects are injected — no real network, no real timers.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  downloadWithRetry,
  downloadZipToCache,
  isCompleteZipBuffer,
  parseRetryAfterMs,
  runBoundedPool,
  Semaphore,
} from '../../../distribution/addresses/download-pool.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal verified-complete zip: local-file magic + EOCD record in the tail. */
function completeZipBuffer(padding = 64): Buffer {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // PK\x05\x06
  return Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(padding), eocd]);
}

/** Truncated download: valid magic, no EOCD — must NOT be treated as cached. */
function truncatedZipBuffer(): Buffer {
  return Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(64)]);
}

function okResponse(body: Buffer): Response {
  return new Response(new Uint8Array(body), { status: 200 });
}

const noSleep = (): Promise<void> => Promise.resolve();

// ---------------------------------------------------------------------------
// Semaphore + runBoundedPool — bounded concurrency
// ---------------------------------------------------------------------------

describe('runBoundedPool', () => {
  it('never exceeds the concurrency bound', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await runBoundedPool(items, 3, async (i) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2 + (i % 3)));
      inFlight--;
      return i * 2;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // it actually parallelized
  });

  it('preserves input order in results', async () => {
    const items = [5, 1, 4, 2, 3];
    const results = await runBoundedPool(items, 2, async (n) => {
      await new Promise((r) => setTimeout(r, n)); // finish out of order
      return n * 10;
    });
    expect(results).toEqual([50, 10, 40, 20, 30]);
  });

  it('fails loud on the first error after in-flight work settles', async () => {
    const seen: number[] = [];
    await expect(
      runBoundedPool([1, 2, 3, 4, 5, 6, 7, 8], 2, async (n) => {
        seen.push(n);
        if (n === 3) throw new Error('county 3 exploded');
        await new Promise((r) => setTimeout(r, 1));
        return n;
      })
    ).rejects.toThrow('county 3 exploded');
    // Stops starting new work after the failure — no silent full-run.
    expect(seen.length).toBeLessThan(8);
  });

  it('Semaphore.run releases the permit on throw', async () => {
    const sem = new Semaphore(1);
    await expect(sem.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    // Permit must be back — a second run would hang forever otherwise.
    await expect(sem.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('Semaphore rejects a non-positive limit', () => {
    expect(() => new Semaphore(0)).toThrow(/positive integer/);
  });
});

// ---------------------------------------------------------------------------
// downloadWithRetry — backoff, jitter, Retry-After, fail-loud
// ---------------------------------------------------------------------------

describe('downloadWithRetry', () => {
  it('returns the body on first success without sleeping', async () => {
    const body = completeZipBuffer();
    const fetchImpl = vi.fn(async () => okResponse(body));
    const sleep = vi.fn(noSleep);
    const buf = await downloadWithRetry('https://example.test/a.zip', { fetchImpl, sleep });
    expect(Buffer.compare(buf, body)).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('backs off exponentially with jitter between failures', async () => {
    const body = completeZipBuffer();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('terminated'))
      .mockRejectedValueOnce(new Error('terminated'))
      .mockResolvedValueOnce(okResponse(body));
    const sleep = vi.fn(noSleep);
    const random = () => 1; // deterministic top-of-jitter-band (100%)

    await downloadWithRetry('https://example.test/b.zip', {
      fetchImpl,
      sleep,
      random,
      baseDelayMs: 1_000,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 1_000); // base * 2^0 * 1.0
    expect(sleep).toHaveBeenNthCalledWith(2, 2_000); // base * 2^1 * 1.0
  });

  it('jitter keeps delays within [50%, 100%] of the exponential step', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('terminated'))
      .mockResolvedValueOnce(okResponse(completeZipBuffer()));
    const sleep = vi.fn(noSleep);
    const random = () => 0; // deterministic bottom-of-band (50%)
    await downloadWithRetry('https://example.test/c.zip', {
      fetchImpl,
      sleep,
      random,
      baseDelayMs: 1_000,
    });
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it('caps the exponential step at maxDelayMs', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('terminated'))
      .mockRejectedValueOnce(new Error('terminated'))
      .mockRejectedValueOnce(new Error('terminated'))
      .mockResolvedValueOnce(okResponse(completeZipBuffer()));
    const sleep = vi.fn(noSleep);
    await downloadWithRetry('https://example.test/d.zip', {
      fetchImpl,
      sleep,
      random: () => 1,
      baseDelayMs: 1_000,
      maxDelayMs: 1_500,
    });
    expect(sleep).toHaveBeenNthCalledWith(1, 1_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 1_500); // capped, not 2000
    expect(sleep).toHaveBeenNthCalledWith(3, 1_500); // capped, not 4000
  });

  it('honors Retry-After (seconds) on 429 when longer than the backoff', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('slow down', { status: 429, headers: { 'retry-after': '30' } })
      )
      .mockResolvedValueOnce(okResponse(completeZipBuffer()));
    const sleep = vi.fn(noSleep);
    await downloadWithRetry('https://example.test/e.zip', {
      fetchImpl,
      sleep,
      random: () => 1,
      baseDelayMs: 1_000,
    });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(30_000); // Retry-After wins over 1s backoff
  });

  it('fails loud after exhausting retries, naming the url', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('terminated'));
    const sleep = vi.fn(noSleep);
    await expect(
      downloadWithRetry('https://example.test/tl_2025_18013_addrfeat.zip', {
        fetchImpl,
        sleep,
        maxRetries: 4,
      })
    ).rejects.toThrow(
      'Download failed after 4 attempts: https://example.test/tl_2025_18013_addrfeat.zip: terminated'
    );
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3); // no sleep after the final attempt
  });

  it('treats non-2xx as a retryable failure', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('busy', { status: 503, statusText: 'Service Unavailable' }))
      .mockResolvedValueOnce(okResponse(completeZipBuffer()));
    const sleep = vi.fn(noSleep);
    await downloadWithRetry('https://example.test/f.zip', { fetchImpl, sleep });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('parseRetryAfterMs', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfterMs('7')).toBe(7_000);
  });
  it('parses an HTTP-date relative to now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfterMs('Thu, 01 Jan 2026 00:00:45 GMT', now)).toBe(45_000);
  });
  it('clamps absurd values to 5 minutes', () => {
    expect(parseRetryAfterMs('86400')).toBe(300_000);
  });
  it('returns null for absent or garbage headers', () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs('soon')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Zip cache — verified-complete reuse (resume without re-downloading)
// ---------------------------------------------------------------------------

describe('downloadZipToCache', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'addrfeat-pool-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('cache hit: a verified-complete zip skips the download entirely', async () => {
    const cached = join(dir, 'tl_2025_10001_addrfeat.zip');
    writeFileSync(cached, completeZipBuffer());
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await downloadZipToCache('https://example.test/g.zip', cached, { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.reused).toBe(true);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.bytes).toBe(completeZipBuffer().length);
  });

  it('cache miss: downloads, verifies, and persists the zip', async () => {
    const body = completeZipBuffer(128);
    const cached = join(dir, 'nested', 'tl_2025_44001_addrfeat.zip');
    const fetchImpl = vi.fn(async () => okResponse(body));
    const result = await downloadZipToCache('https://example.test/h.zip', cached, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.reused).toBe(false);
    expect(Buffer.compare(readFileSync(cached), body)).toBe(0);
  });

  it('a truncated cached zip (no EOCD) is re-downloaded, not trusted', async () => {
    const cached = join(dir, 'tl_2025_18013_addrfeat.zip');
    writeFileSync(cached, truncatedZipBuffer());
    const body = completeZipBuffer(256);
    const fetchImpl = vi.fn(async () => okResponse(body));
    const result = await downloadZipToCache('https://example.test/i.zip', cached, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.reused).toBe(false);
    expect(Buffer.compare(readFileSync(cached), body)).toBe(0);
  });

  it('fails loud when the server returns a non-zip body with HTTP 200', async () => {
    const cached = join(dir, 'tl_2025_18013_addrfeat.zip');
    const fetchImpl = vi.fn(async () => okResponse(Buffer.from('<html>throttled</html>')));
    await expect(
      downloadZipToCache('https://example.test/j.zip', cached, { fetchImpl })
    ).rejects.toThrow(/not a complete zip/);
  });
});

describe('isCompleteZipBuffer', () => {
  it('accepts magic + EOCD', () => {
    expect(isCompleteZipBuffer(completeZipBuffer())).toBe(true);
  });
  it('rejects missing EOCD (truncated)', () => {
    expect(isCompleteZipBuffer(truncatedZipBuffer())).toBe(false);
  });
  it('rejects non-zip bodies and tiny buffers', () => {
    expect(isCompleteZipBuffer(Buffer.from('<html>err</html>'))).toBe(false);
    expect(isCompleteZipBuffer(Buffer.from('PK'))).toBe(false);
  });
});
