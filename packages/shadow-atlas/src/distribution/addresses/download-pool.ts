/**
 * Bounded-parallel download pool for census.gov bulk fetches.
 *
 * Census throttles long sequential bulk fetchers ('terminated' mid-body after
 * hours of one-at-a-time requests — observed on the national ADDRFEAT crawl).
 * The cure is the opposite shape: a SMALL bounded pool (default 6 concurrent,
 * Census-friendly) where each request carries exponential backoff + jitter,
 * honors Retry-After on 429/503, and re-fetches through a per-attempt timeout
 * so a hung socket can never stall the pool.
 *
 * Fail-loud discipline: exhausting retries THROWS with the url — a missing
 * county must never be silently skipped (the index would carry a silent
 * geographic hole).
 *
 * All effects (fetch, sleep, random) are injectable for unit tests.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Semaphore — the bounded-concurrency primitive the pipeline runs on
// ---------------------------------------------------------------------------

export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`Semaphore limit must be a positive integer, got ${limit}`);
    }
    this.available = limit;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next(); // hand the permit straight to the next waiter
    } else {
      this.available++;
    }
  }

  /** Run fn under a permit; always releases, even on throw. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/**
 * Map fn over items with at most `concurrency` in flight. Rejects with the
 * first error AFTER in-flight work settles (no unhandled rejections, no
 * silently-skipped items). Result order matches input order.
 */
export async function runBoundedPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const sem = new Semaphore(concurrency);
  const results = new Array<R>(items.length);
  const errors: unknown[] = [];
  await Promise.all(
    items.map((item, i) =>
      sem.run(async () => {
        if (errors.length > 0) return; // stop starting new work after a failure
        try {
          results[i] = await fn(item, i);
        } catch (err) {
          errors.push(err);
        }
      })
    )
  );
  if (errors.length > 0) throw errors[0];
  return results;
}

// ---------------------------------------------------------------------------
// Retrying download — exponential backoff + jitter + Retry-After
// ---------------------------------------------------------------------------

export interface DownloadRetryOptions {
  /** Total attempts before failing loud. Default 6. */
  maxRetries?: number;
  /** First backoff delay; doubles each attempt. Default 2000 ms. */
  baseDelayMs?: number;
  /** Backoff ceiling (Retry-After may exceed it, clamped to 5 min). Default 60000 ms. */
  maxDelayMs?: number;
  /** Per-attempt timeout — a hung socket must not stall the pool. Default 120000 ms. */
  timeoutMs?: number;
  /** Injectable effects (tests). */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const RETRY_AFTER_CLAMP_MS = 5 * 60_000;

/** Parse a Retry-After header (delta-seconds or HTTP-date) into ms, or null. */
export function parseRetryAfterMs(header: string | null, nowMs: number = Date.now()): number | null {
  if (header === null || header.trim().length === 0) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.min(parseInt(trimmed, 10) * 1000, RETRY_AFTER_CLAMP_MS);
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return null;
  return Math.min(Math.max(dateMs - nowMs, 0), RETRY_AFTER_CLAMP_MS);
}

class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    statusText: string,
    readonly retryAfterMs: number | null
  ) {
    super(`HTTP ${status}: ${statusText}`);
  }
}

/**
 * Fetch url → Buffer with maxRetries attempts. Backoff between attempts is
 * exponential with 50-100% jitter; a Retry-After on 429/503 overrides the
 * computed backoff when longer. Exhaustion throws (fail-loud) with the url.
 */
export async function downloadWithRetry(
  url: string,
  options: DownloadRetryOptions = {}
): Promise<Buffer> {
  const maxRetries = options.maxRetries ?? 6;
  const baseDelayMs = options.baseDelayMs ?? 2_000;
  const maxDelayMs = options.maxDelayMs ?? 60_000;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = options.random ?? Math.random;

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        const retryAfterMs =
          response.status === 429 || response.status === 503
            ? parseRetryAfterMs(response.headers.get('retry-after'))
            : null;
        throw new HttpStatusError(response.status, response.statusText, retryAfterMs);
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        // Exponential backoff with 50-100% jitter (decorrelates a pool of
        // failing fetchers so retries don't stampede census.gov in lockstep).
        const exp = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
        const jittered = Math.round(exp * (0.5 + random() * 0.5));
        const retryAfterMs =
          lastError instanceof HttpStatusError ? lastError.retryAfterMs : null;
        const delayMs = retryAfterMs !== null ? Math.max(retryAfterMs, jittered) : jittered;
        console.warn(
          `  download attempt ${attempt}/${maxRetries} failed (${lastError.message}); retrying in ${delayMs} ms: ${url}`
        );
        await sleep(delayMs);
      }
    }
  }
  throw new Error(`Download failed after ${maxRetries} attempts: ${url}: ${lastError?.message}`);
}

// ---------------------------------------------------------------------------
// Zip cache — resume-after-restart without re-downloading verified files
// ---------------------------------------------------------------------------

/**
 * A cached zip is verified-complete iff it starts with the zip local-file
 * magic (PK\x03\x04) AND carries an end-of-central-directory record in its
 * tail — a truncated download passes the magic check but never the EOCD one.
 */
export function isCompleteZipBuffer(buf: Buffer): boolean {
  if (buf.length < 22) return false;
  if (!(buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04)) return false;
  // EOCD signature PK\x05\x06 sits within the last 22 + 65535 bytes (comment).
  const tail = buf.subarray(Math.max(0, buf.length - (22 + 65_535)));
  return tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) !== -1;
}

export interface CachedDownloadResult {
  path: string;
  bytes: number;
  sha256: string;
  /** true when a verified-complete cached file was reused (no fetch issued). */
  reused: boolean;
}

/**
 * Download url into cachePath unless a verified-complete zip is already
 * there (keyed by filename + non-trivial size + zip magic + EOCD). Always
 * returns the computed sha256 — census.gov publishes no pins; we stamp what
 * we compute.
 */
export async function downloadZipToCache(
  url: string,
  cachePath: string,
  options: DownloadRetryOptions = {}
): Promise<CachedDownloadResult> {
  if (existsSync(cachePath) && statSync(cachePath).size > 4) {
    const candidate = readFileSync(cachePath);
    if (isCompleteZipBuffer(candidate)) {
      return {
        path: cachePath,
        bytes: candidate.length,
        sha256: createHash('sha256').update(candidate).digest('hex'),
        reused: true,
      };
    }
  }
  const buf = await downloadWithRetry(url, options);
  if (!isCompleteZipBuffer(buf)) {
    // Fail-loud: census served bytes that are not a complete zip (throttling
    // proxies have been observed truncating bodies with HTTP 200).
    throw new Error(`Downloaded file is not a complete zip (${buf.length} bytes): ${url}`);
  }
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, buf);
  return {
    path: cachePath,
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
    reused: false,
  };
}
