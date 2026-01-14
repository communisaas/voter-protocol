/**
 * Bulkhead Isolation Pattern
 *
 * Isolates critical paths from non-critical failures.
 * Prevents resource exhaustion from cascading across services.
 *
 * DESIGN:
 * - Limit concurrent executions per operation type
 * - Queue overflow requests with timeout
 * - Fail fast when capacity exceeded
 * - Isolated failure domains
 *
 * BASED ON:
 * - Ship bulkhead compartments (watertight isolation)
 * - Michael Nygard's "Release It!" bulkhead pattern
 * - Netflix Hystrix semaphore isolation
 */

import type { BulkheadConfig, BulkheadStats, ResilienceEvent } from './types.js';
import { logger } from '../core/utils/logger.js';

/**
 * Bulkhead rejection error (thrown when capacity exceeded)
 */
export class BulkheadRejectionError extends Error {
  readonly bulkheadName: string;
  readonly stats: BulkheadStats;

  constructor(bulkheadName: string, stats: BulkheadStats) {
    super(`Bulkhead '${bulkheadName}' capacity exceeded`);
    this.name = 'BulkheadRejectionError';
    this.bulkheadName = bulkheadName;
    this.stats = stats;
  }
}

/**
 * Queue timeout error (thrown when request times out in queue)
 */
export class QueueTimeoutError extends Error {
  readonly queueWaitMs: number;
  readonly timeoutMs: number;

  constructor(queueWaitMs: number, timeoutMs: number) {
    super(`Queue timeout after ${queueWaitMs}ms (limit: ${timeoutMs}ms)`);
    this.name = 'QueueTimeoutError';
    this.queueWaitMs = queueWaitMs;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Queued execution request
 */
interface QueuedRequest<T> {
  readonly fn: () => Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly queuedAt: number;
  timeoutHandle?: ReturnType<typeof setTimeout>;
}

/**
 * Bulkhead Isolator
 *
 * Limits concurrent executions and queues overflow requests.
 * Prevents resource exhaustion and isolates failure domains.
 *
 * @example
 * ```typescript
 * const bulkhead = new Bulkhead({
 *   name: 'ipfs-downloads',
 *   maxConcurrent: 5,
 *   maxQueueSize: 10,
 *   queueTimeoutMs: 5000,
 * });
 *
 * const result = await bulkhead.execute(async () => {
 *   return downloadFromIPFS(cid);
 * });
 * ```
 */
export class Bulkhead {
  private readonly config: BulkheadConfig;
  private activeCount = 0;
  private readonly queue: Array<QueuedRequest<unknown>> = [];
  private rejectedCount = 0;
  private completedCount = 0;
  private totalExecutionMs = 0;
  private readonly eventListeners: Array<(event: ResilienceEvent) => void> = [];

  constructor(config: BulkheadConfig) {
    this.config = config;
  }

  /**
   * Execute function with bulkhead protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if we can execute immediately
    if (this.activeCount < this.config.maxConcurrent) {
      return this.executeImmediate(fn);
    }

    // Check if queue has capacity
    if (this.queue.length >= this.config.maxQueueSize) {
      this.rejectedCount++;
      this.emitEvent({
        type: 'bulkhead_rejected',
        component: this.config.name,
        timestamp: Date.now(),
        metadata: {
          activeCount: this.activeCount,
          queuedCount: this.queue.length,
          rejectedCount: this.rejectedCount,
        },
      });
      throw new BulkheadRejectionError(this.config.name, this.getStats());
    }

    // Queue the request
    return this.enqueue(fn);
  }

  /**
   * Execute immediately (slot available)
   */
  private async executeImmediate<T>(fn: () => Promise<T>): Promise<T> {
    this.activeCount++;
    const startTime = Date.now();

    try {
      const result = await fn();
      return result;
    } finally {
      const executionTime = Date.now() - startTime;
      this.activeCount--;
      this.completedCount++;
      this.totalExecutionMs += executionTime;

      // Process next queued request if any
      this.processNextQueued();
    }
  }

  /**
   * Enqueue request for later execution
   */
  private async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const queuedAt = Date.now();

      // Create timeout handle
      const timeoutHandle = setTimeout(() => {
        // Remove from queue
        const index = this.queue.findIndex((req) => req === request);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }

        reject(
          new QueueTimeoutError(
            Date.now() - queuedAt,
            this.config.queueTimeoutMs
          )
        );
      }, this.config.queueTimeoutMs);

      // Add to queue
      // We cast to QueuedRequest<unknown> because the queue stores mixed types
      const request: QueuedRequest<unknown> = {
        fn: fn as unknown as () => Promise<unknown>,
        resolve: resolve as unknown as (value: unknown) => void,
        reject,
        queuedAt,
        timeoutHandle,
      };

      this.queue.push(request);
    });
  }

  /**
   * Process next queued request
   */
  private processNextQueued(): void {
    if (this.queue.length === 0 || this.activeCount >= this.config.maxConcurrent) {
      return;
    }

    const request = this.queue.shift();
    if (!request) {
      return;
    }

    // Clear timeout
    if (request.timeoutHandle) {
      clearTimeout(request.timeoutHandle);
    }

    // Execute
    this.executeImmediate(request.fn)
      .then(request.resolve)
      .catch(request.reject);
  }

  /**
   * Get current bulkhead statistics
   */
  getStats(): BulkheadStats {
    return {
      name: this.config.name,
      activeCount: this.activeCount,
      queuedCount: this.queue.length,
      rejectedCount: this.rejectedCount,
      completedCount: this.completedCount,
      avgExecutionMs:
        this.completedCount > 0 ? this.totalExecutionMs / this.completedCount : 0,
    };
  }

  /**
   * Reset bulkhead statistics
   */
  reset(): void {
    // Clear queue
    for (const request of this.queue) {
      if (request.timeoutHandle) {
        clearTimeout(request.timeoutHandle);
      }
      request.reject(new Error('Bulkhead reset'));
    }
    this.queue.length = 0;

    // Reset counters
    this.rejectedCount = 0;
    this.completedCount = 0;
    this.totalExecutionMs = 0;
  }

  /**
   * Subscribe to bulkhead events
   */
  onEvent(listener: (event: ResilienceEvent) => void): () => void {
    this.eventListeners.push(listener);

    // Return unsubscribe function
    return () => {
      const index = this.eventListeners.indexOf(listener);
      if (index !== -1) {
        this.eventListeners.splice(index, 1);
      }
    };
  }

  /**
   * Emit resilience event to listeners
   */
  private emitEvent(event: ResilienceEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error('Bulkhead event listener error', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

/**
 * Create bulkhead with Shadow Atlas defaults
 */
export function createBulkhead(
  name: string,
  overrides?: Partial<BulkheadConfig>
): Bulkhead {
  const config: BulkheadConfig = {
    name,
    maxConcurrent: 10,
    maxQueueSize: 20,
    queueTimeoutMs: 5000,
    ...overrides,
  };

  return new Bulkhead(config);
}

/**
 * Bulkhead registry for managing multiple bulkheads
 */
export class BulkheadRegistry {
  private readonly bulkheads = new Map<string, Bulkhead>();

  /**
   * Get or create bulkhead
   */
  getBulkhead(name: string, config?: Partial<BulkheadConfig>): Bulkhead {
    let bulkhead = this.bulkheads.get(name);

    if (!bulkhead) {
      bulkhead = createBulkhead(name, config);
      this.bulkheads.set(name, bulkhead);
    }

    return bulkhead;
  }

  /**
   * Get all bulkhead statistics
   */
  getAllStats(): readonly BulkheadStats[] {
    return Array.from(this.bulkheads.values()).map((bulkhead) =>
      bulkhead.getStats()
    );
  }

  /**
   * Reset all bulkheads
   */
  resetAll(): void {
    for (const bulkhead of this.bulkheads.values()) {
      bulkhead.reset();
    }
  }
}
