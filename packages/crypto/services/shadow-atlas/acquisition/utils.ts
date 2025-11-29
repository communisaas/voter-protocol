/**
 * Layer 1: Acquisition - Utility Functions
 *
 * Retry logic, rate limiting, progress tracking
 */

import { createHash } from 'crypto';
import type { RetryConfig, ScraperProgress } from './types.js';

/**
 * SHA-256 hash of data
 */
export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  onRetry?: (attempt: number, error: Error) => void
): Promise<T> {
  let lastError: Error | undefined;
  let delay = config.initialDelay;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === config.maxAttempts) {
        break;
      }

      if (onRetry) {
        onRetry(attempt, lastError);
      }

      await sleep(delay);
      delay = Math.min(delay * config.backoffMultiplier, config.maxDelay);
    }
  }

  throw lastError || new Error('Retry failed with unknown error');
}

/**
 * Rate limiter using token bucket algorithm
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number;

  constructor(requestsPerSecond: number) {
    this.capacity = requestsPerSecond;
    this.tokens = requestsPerSecond;
    this.lastRefill = Date.now();
    this.refillRate = requestsPerSecond;
  }

  /**
   * Wait until a token is available
   */
  async acquire(): Promise<void> {
    this.refill();

    while (this.tokens < 1) {
      await sleep(100);
      this.refill();
    }

    this.tokens -= 1;
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

/**
 * Progress tracker for batch operations
 */
export class ProgressTracker {
  private total: number;
  private completed: number;
  private failed: number;
  private startTime: number;
  private lastReport: number;
  private reportInterval: number;
  private onProgress?: (progress: ScraperProgress) => void;

  constructor(total: number, reportInterval: number = 100, onProgress?: (progress: ScraperProgress) => void) {
    this.total = total;
    this.completed = 0;
    this.failed = 0;
    this.startTime = Date.now();
    this.lastReport = 0;
    this.reportInterval = reportInterval;
    this.onProgress = onProgress;
  }

  /**
   * Mark item as completed
   */
  complete(current?: string): void {
    this.completed += 1;
    this.maybeReport(current);
  }

  /**
   * Mark item as failed
   */
  fail(current?: string): void {
    this.failed += 1;
    this.maybeReport(current);
  }

  /**
   * Report progress if interval reached
   */
  private maybeReport(current?: string): void {
    const processed = this.completed + this.failed;

    if (processed - this.lastReport >= this.reportInterval || processed === this.total) {
      this.lastReport = processed;

      const elapsed = Date.now() - this.startTime;
      const rate = (processed / elapsed) * 1000;
      const remaining = this.total - processed;
      const eta = remaining / rate;

      console.log(
        `Progress: ${processed}/${this.total} (${((processed / this.total) * 100).toFixed(1)}%) | ` +
          `Completed: ${this.completed} | Failed: ${this.failed} | ` +
          `Rate: ${rate.toFixed(1)} items/sec | ETA: ${(eta / 60).toFixed(1)} min`
      );

      if (this.onProgress) {
        this.onProgress({
          total: this.total,
          completed: this.completed,
          failed: this.failed,
          current,
        });
      }
    }
  }

  /**
   * Get final stats
   */
  getStats(): {
    total: number;
    completed: number;
    failed: number;
    duration: number;
    rate: number;
  } {
    const duration = Date.now() - this.startTime;
    const rate = ((this.completed + this.failed) / duration) * 1000;

    return {
      total: this.total,
      completed: this.completed,
      failed: this.failed,
      duration,
      rate,
    };
  }
}

/**
 * Batch processor with concurrency control
 */
export class BatchProcessor<T, R> {
  private readonly items: readonly T[];
  private readonly processor: (item: T) => Promise<R>;
  private readonly maxParallel: number;
  private readonly rateLimiter: RateLimiter;
  private readonly tracker: ProgressTracker;

  constructor(
    items: readonly T[],
    processor: (item: T) => Promise<R>,
    maxParallel: number,
    rateLimit: number,
    onProgress?: (progress: ScraperProgress) => void
  ) {
    this.items = items;
    this.processor = processor;
    this.maxParallel = maxParallel;
    this.rateLimiter = new RateLimiter(rateLimit);
    this.tracker = new ProgressTracker(items.length, 100, onProgress);
  }

  /**
   * Process all items with concurrency control
   */
  async process(): Promise<{
    results: readonly R[];
    failures: readonly { item: T; error: Error }[];
  }> {
    const results: R[] = [];
    const failures: { item: T; error: Error }[] = [];

    const processItem = async (item: T): Promise<void> => {
      await this.rateLimiter.acquire();

      try {
        const result = await this.processor(item);
        results.push(result);
        this.tracker.complete();
      } catch (error) {
        failures.push({
          item,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        this.tracker.fail();
      }
    };

    const batches: T[][] = [];
    for (let i = 0; i < this.items.length; i += this.maxParallel) {
      batches.push(this.items.slice(i, i + this.maxParallel) as T[]);
    }

    for (const batch of batches) {
      await Promise.all(batch.map(item => processItem(item)));
    }

    const stats = this.tracker.getStats();
    console.log(
      `\nBatch complete: ${stats.completed} succeeded, ${stats.failed} failed in ${(stats.duration / 1000).toFixed(1)}s (${stats.rate.toFixed(1)} items/sec)`
    );

    return { results, failures };
  }
}

/**
 * Parse Last-Modified header to Unix timestamp
 */
export function parseLastModified(header: string | null): number | undefined {
  if (!header) return undefined;

  try {
    return new Date(header).getTime();
  } catch {
    return undefined;
  }
}

/**
 * Extract ETag from header
 */
export function parseETag(header: string | null): string | undefined {
  if (!header) return undefined;
  return header.replace(/^"(.*)"$/, '$1');
}
