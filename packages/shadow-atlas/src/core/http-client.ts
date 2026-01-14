/**
 * Unified HTTP Client for Shadow Atlas
 *
 * Centralizes all HTTP fetch operations with:
 * - Exponential backoff with jitter
 * - Configurable timeouts via AbortController
 * - Proper error classification and retry logic
 * - Type-safe response handling
 *
 * DESIGN PRINCIPLES:
 * - Native fetch API (no external dependencies)
 * - Composable with existing resilience patterns (RetryExecutor, CircuitBreaker)
 * - Logging hooks for observability (Wave 4)
 * - Consistent error types across all providers
 *
 * REPLACES:
 * - 6 duplicate fetch implementations across providers
 * - Inconsistent retry/backoff patterns
 * - Ad-hoc timeout handling
 *
 * USAGE:
 * ```typescript
 * const client = new HTTPClient({
 *   maxRetries: 3,
 *   initialDelayMs: 1000,
 *   timeoutMs: 30000,
 * });
 *
 * // Fetch JSON
 * const data = await client.fetchJSON<MyType>('https://api.example.com/data');
 *
 * // Fetch GeoJSON with custom options
 * const geojson = await client.fetchGeoJSON('https://geo.example.com/boundaries', {
 *   headers: { 'User-Agent': 'Custom/1.0' },
 *   retries: 5,
 * });
 * ```
 */

import type { FeatureCollection } from 'geojson';
import { logger } from './utils/logger.js';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * HTTP client configuration with sensible defaults
 */
export interface HTTPClientConfig {
  /** Maximum retry attempts (default: 3) */
  readonly maxRetries: number;

  /** Initial delay before first retry in milliseconds (default: 1000) */
  readonly initialDelayMs: number;

  /** Exponential backoff multiplier (default: 2) */
  readonly backoffMultiplier: number;

  /** Maximum delay between retries in milliseconds (default: 30000) */
  readonly maxDelayMs: number;

  /** Request timeout in milliseconds (default: 30000) */
  readonly timeoutMs: number;

  /** User-Agent header (default: 'VOTER-Protocol-ShadowAtlas/1.0') */
  readonly userAgent: string;

  /** Jitter factor to prevent thundering herd (0-1, default: 0.1) */
  readonly jitterFactor: number;
}

/**
 * Per-request fetch options (override client defaults)
 */
export interface FetchOptions {
  /** Override request timeout */
  readonly timeoutMs?: number;

  /** Override retry count */
  readonly retries?: number;

  /** Additional HTTP headers */
  readonly headers?: Record<string, string>;

  /** HTTP method (default: 'GET') */
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD';

  /** Request body for POST/PUT */
  readonly body?: BodyInit;

  /** Whether to follow redirects (default: true) */
  readonly redirect?: 'follow' | 'error' | 'manual';

  /** AbortSignal for external cancellation */
  readonly signal?: AbortSignal;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Base HTTP error with status code
 */
export class HTTPError extends Error {
  readonly statusCode: number;
  readonly url: string;
  readonly response?: Response;

  constructor(message: string, statusCode: number, url: string, response?: Response) {
    super(message);
    this.name = 'HTTPError';
    this.statusCode = statusCode;
    this.url = url;
    this.response = response;
  }
}

/**
 * Request timeout error (AbortController triggered)
 */
export class HTTPTimeoutError extends Error {
  readonly url: string;
  readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    super(`Request timeout after ${timeoutMs}ms: ${url}`);
    this.name = 'HTTPTimeoutError';
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Network error (connection failed, DNS resolution, etc.)
 */
export class HTTPNetworkError extends Error {
  readonly url: string;
  readonly cause: Error;

  constructor(url: string, cause: Error) {
    super(`Network error: ${cause.message}`);
    this.name = 'HTTPNetworkError';
    this.url = url;
    this.cause = cause;
  }
}

/**
 * Retry exhausted error (all attempts failed)
 */
export class HTTPRetryExhaustedError extends Error {
  readonly url: string;
  readonly attempts: number;
  readonly lastError: Error;

  constructor(url: string, attempts: number, lastError: Error) {
    super(`Retry exhausted after ${attempts} attempts: ${lastError.message}`);
    this.name = 'HTTPRetryExhaustedError';
    this.url = url;
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

/**
 * JSON parse error
 */
export class HTTPJSONParseError extends Error {
  readonly url: string;
  readonly responseText: string;
  readonly cause: Error;

  constructor(url: string, responseText: string, cause: Error) {
    super(`Failed to parse JSON response: ${cause.message}`);
    this.name = 'HTTPJSONParseError';
    this.url = url;
    this.responseText = responseText.slice(0, 500); // Truncate for safety
    this.cause = cause;
  }
}

// ============================================================================
// HTTP Client Implementation
// ============================================================================

/**
 * Unified HTTP client with retry, timeout, and exponential backoff
 */
export class HTTPClient {
  private readonly config: HTTPClientConfig;

  constructor(config?: Partial<HTTPClientConfig>) {
    this.config = {
      maxRetries: 3,
      initialDelayMs: 1000,
      backoffMultiplier: 2,
      maxDelayMs: 30000,
      timeoutMs: 30000,
      userAgent: 'VOTER-Protocol-ShadowAtlas/1.0',
      jitterFactor: 0.1,
      ...config,
    };
  }

  /**
   * Fetch and parse JSON response
   *
   * @throws {HTTPError} For HTTP error responses (4xx, 5xx)
   * @throws {HTTPTimeoutError} If request exceeds timeout
   * @throws {HTTPNetworkError} For network failures
   * @throws {HTTPRetryExhaustedError} If all retry attempts fail
   * @throws {HTTPJSONParseError} If response is not valid JSON
   */
  async fetchJSON<T = unknown>(url: string, options?: FetchOptions): Promise<T> {
    const response = await this.fetchWithRetry(url, options);

    // Read response text for better error messages
    const text = await response.text();

    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new HTTPJSONParseError(
        url,
        text,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Fetch and parse GeoJSON response
   *
   * Validates response is a FeatureCollection before returning.
   *
   * @throws Same as fetchJSON, plus validation errors
   */
  async fetchGeoJSON(url: string, options?: FetchOptions): Promise<FeatureCollection> {
    const data = await this.fetchJSON<unknown>(url, options);

    // Validate GeoJSON structure
    if (
      typeof data !== 'object' ||
      data === null ||
      !('type' in data) ||
      data.type !== 'FeatureCollection' ||
      !('features' in data) ||
      !Array.isArray(data.features)
    ) {
      throw new Error(
        `Invalid GeoJSON response: expected FeatureCollection, got ${typeof data === 'object' && data !== null && 'type' in data ? data.type : typeof data}`
      );
    }

    return data as FeatureCollection;
  }

  /**
   * Fetch raw response with retry logic
   *
   * Low-level method for custom response handling (binary data, streaming, etc.)
   */
  async fetchWithRetry(url: string, options?: FetchOptions): Promise<Response> {
    const maxRetries = options?.retries ?? this.config.maxRetries;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const isLastAttempt = attempt === maxRetries + 1;

      try {
        const response = await this.fetchWithTimeout(url, options);

        // Check HTTP status
        if (!response.ok) {
          const error = new HTTPError(
            `HTTP ${response.status}: ${response.statusText}`,
            response.status,
            url,
            response
          );

          // Determine if error is retryable
          if (!this.isRetryableStatus(response.status) || isLastAttempt) {
            throw error;
          }

          lastError = error;
          logger.warn(`HTTPClient attempt failed`, {
            attempt,
            maxAttempts: maxRetries + 1,
            statusCode: response.status,
            url,
          });
        } else {
          // Success
          return response;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on non-retryable errors
        if (!this.isRetryableError(lastError) || isLastAttempt) {
          throw lastError;
        }

        logger.warn(`HTTPClient attempt failed`, {
          attempt,
          maxAttempts: maxRetries + 1,
          error: lastError.message,
          url,
        });
      }

      // Calculate backoff delay
      if (!isLastAttempt) {
        const delay = this.calculateBackoffDelay(attempt);
        await this.sleep(delay);
      }
    }

    // Should never reach here, but TypeScript needs it
    throw new HTTPRetryExhaustedError(url, maxRetries + 1, lastError ?? new Error('Unknown error'));
  }

  /**
   * Fetch with timeout using AbortController
   */
  private async fetchWithTimeout(url: string, options?: FetchOptions): Promise<Response> {
    const timeoutMs = options?.timeoutMs ?? this.config.timeoutMs;

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Merge signals if external signal provided
      const signal = options?.signal
        ? this.mergeAbortSignals([controller.signal, options.signal])
        : controller.signal;

      const response = await fetch(url, {
        method: options?.method ?? 'GET',
        headers: {
          'User-Agent': this.config.userAgent,
          ...options?.headers,
        },
        body: options?.body,
        redirect: options?.redirect ?? 'follow',
        signal,
      });

      return response;
    } catch (error) {
      // Distinguish timeout from other abort reasons
      if (error instanceof Error && error.name === 'AbortError') {
        if (controller.signal.aborted) {
          throw new HTTPTimeoutError(url, timeoutMs);
        }
        // External signal aborted
        throw error;
      }

      // Network error
      throw new HTTPNetworkError(
        url,
        error instanceof Error ? error : new Error(String(error))
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  private calculateBackoffDelay(attempt: number): number {
    // Base exponential backoff: initialDelay * (multiplier ^ (attempt - 1))
    const exponentialDelay =
      this.config.initialDelayMs * Math.pow(this.config.backoffMultiplier, attempt - 1);

    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelayMs);

    // Add jitter to prevent thundering herd
    // Jitter range: [delay * (1 - jitterFactor), delay * (1 + jitterFactor)]
    const jitterRange = cappedDelay * this.config.jitterFactor;
    const jitter = Math.random() * 2 * jitterRange - jitterRange;

    return Math.max(0, Math.floor(cappedDelay + jitter));
  }

  /**
   * Determine if HTTP status code is retryable
   */
  private isRetryableStatus(status: number): boolean {
    return (
      status === 408 || // Request Timeout
      status === 429 || // Too Many Requests
      status === 500 || // Internal Server Error
      status === 502 || // Bad Gateway
      status === 503 || // Service Unavailable
      status === 504    // Gateway Timeout
    );
  }

  /**
   * Determine if error is retryable
   */
  private isRetryableError(error: Error): boolean {
    // Timeout errors are retryable
    if (error instanceof HTTPTimeoutError) {
      return true;
    }

    // Network errors are retryable
    if (error instanceof HTTPNetworkError) {
      return true;
    }

    // HTTP errors delegate to status code check
    if (error instanceof HTTPError) {
      return this.isRetryableStatus(error.statusCode);
    }

    // Parse errors are NOT retryable (deterministic)
    if (error instanceof HTTPJSONParseError) {
      return false;
    }

    // Unknown errors: don't retry (fail fast)
    return false;
  }

  /**
   * Merge multiple AbortSignals into one
   *
   * The merged signal aborts when ANY of the input signals abort.
   */
  private mergeAbortSignals(signals: readonly AbortSignal[]): AbortSignal {
    const controller = new AbortController();

    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort();
        break;
      }

      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    return controller.signal;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Default HTTP client instance (singleton pattern)
 */
let defaultClient: HTTPClient | null = null;

/**
 * Get or create default HTTP client
 */
export function getHTTPClient(): HTTPClient {
  if (!defaultClient) {
    defaultClient = new HTTPClient();
  }
  return defaultClient;
}

/**
 * Convenience: Fetch JSON with default client
 */
export async function fetchJSON<T = unknown>(url: string, options?: FetchOptions): Promise<T> {
  return getHTTPClient().fetchJSON<T>(url, options);
}

/**
 * Convenience: Fetch GeoJSON with default client
 */
export async function fetchGeoJSON(url: string, options?: FetchOptions): Promise<FeatureCollection> {
  return getHTTPClient().fetchGeoJSON(url, options);
}

/**
 * Create HTTP client with custom config
 */
export function createHTTPClient(config?: Partial<HTTPClientConfig>): HTTPClient {
  return new HTTPClient(config);
}
