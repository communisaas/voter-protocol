/**
 * HTTPClient Usage Examples
 *
 * Practical examples for migrating from raw fetch() to HTTPClient.
 * Copy-paste these patterns into your provider code.
 */

import {
  HTTPClient,
  HTTPError,
  HTTPTimeoutError,
  HTTPNetworkError,
  HTTPRetryExhaustedError,
  fetchJSON,
  fetchGeoJSON,
  createHTTPClient,
  type HTTPClientConfig,
} from './http-client.js';
import type { FeatureCollection } from 'geojson';
import { logger } from './utils/logger.js';

// ============================================================================
// Example 1: Simple JSON Fetch (Most Common)
// ============================================================================

async function example1_simpleJSON() {
  // Before: Raw fetch
  const response1 = await fetch('https://api.example.com/data');
  if (!response1.ok) throw new Error(`HTTP ${response1.status}`);
  const data1 = await response1.json();

  // After: HTTPClient with retry
  const data2 = await fetchJSON('https://api.example.com/data');

  // Type-safe version
  interface MyData {
    id: string;
    name: string;
  }
  const data3 = await fetchJSON<MyData>('https://api.example.com/data');
}

// ============================================================================
// Example 2: GeoJSON Fetch with Validation
// ============================================================================

async function example2_geoJSON() {
  // Before: Manual validation
  const response1 = await fetch('https://geo.example.com/boundaries');
  const geojson1 = (await response1.json()) as FeatureCollection;
  if (geojson1.type !== 'FeatureCollection') {
    throw new Error('Invalid GeoJSON');
  }

  // After: Automatic validation
  const geojson2 = await fetchGeoJSON('https://geo.example.com/boundaries');
}

// ============================================================================
// Example 3: Custom Client Configuration
// ============================================================================

class MyProvider {
  // Create client instance with custom config
  private readonly httpClient = createHTTPClient({
    maxRetries: 5,
    initialDelayMs: 2000,
    timeoutMs: 60000,
    userAgent: 'MyProvider/1.0',
  });

  async fetchData(url: string): Promise<unknown> {
    return this.httpClient.fetchJSON(url);
  }

  async fetchBoundaries(url: string): Promise<FeatureCollection> {
    return this.httpClient.fetchGeoJSON(url);
  }
}

// ============================================================================
// Example 4: Error Handling Patterns
// ============================================================================

async function example4_errorHandling() {
  try {
    const data = await fetchJSON('https://api.example.com/data');
    return data;
  } catch (error) {
    // Typed error handling
    if (error instanceof HTTPError) {
      // HTTP status errors (4xx, 5xx)
      logger.error(`HTTP ${error.statusCode}: ${error.message}`, {
        statusCode: error.statusCode,
        url: error.url,
      });

      if (error.statusCode === 404) {
        logger.error('Resource not found', { statusCode: 404, url: error.url });
      } else if (error.statusCode === 429) {
        logger.error('Rate limited', { statusCode: 429, url: error.url });
      }
    } else if (error instanceof HTTPTimeoutError) {
      // Timeout errors
      logger.error(`Request timeout after ${error.timeoutMs}ms: ${error.url}`, {
        timeoutMs: error.timeoutMs,
        url: error.url,
      });
    } else if (error instanceof HTTPNetworkError) {
      // Network failures (DNS, connection refused)
      logger.error(`Network error: ${error.cause.message}`, {
        url: error.url,
        error: error.cause.message,
      });
    } else if (error instanceof HTTPRetryExhaustedError) {
      // All retry attempts failed
      logger.error(`Retry exhausted after ${error.attempts} attempts`, {
        attempts: error.attempts,
        url: error.url,
        lastError: error.lastError.message,
      });
    } else {
      // Unknown error
      logger.error('Unknown error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    throw error; // Re-throw or return fallback
  }
}

// ============================================================================
// Example 5: Binary Download (Buffer/ArrayBuffer)
// ============================================================================

async function example5_binaryDownload() {
  // Before: Manual retry
  async function downloadWithRetry(url: string, retries = 3): Promise<Buffer> {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    throw new Error('Should not reach here');
  }

  // After: HTTPClient
  const client = createHTTPClient();
  const response = await client.fetchWithRetry('https://example.com/file.zip');
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
}

// ============================================================================
// Example 6: Custom Headers and Method
// ============================================================================

async function example6_customRequest() {
  const client = createHTTPClient();

  // GET with custom headers
  const data1 = await client.fetchJSON('/api/data', {
    headers: {
      'Authorization': 'Bearer token123',
      'X-Custom-Header': 'value',
    },
  });

  // POST with body
  const data2 = await client.fetchJSON('/api/data', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ key: 'value' }),
  });

  // HEAD request (metadata only)
  const response = await client.fetchWithRetry('/api/data', {
    method: 'HEAD',
  });
  const etag = response.headers.get('etag');
  const lastModified = response.headers.get('last-modified');
}

// ============================================================================
// Example 7: Per-Request Timeout Override
// ============================================================================

async function example7_perRequestTimeout() {
  const client = createHTTPClient({
    timeoutMs: 30000, // Default: 30 seconds
  });

  // Override for long-running request
  const largeFile = await client.fetchWithRetry('/large-file.zip', {
    timeoutMs: 120000, // 2 minutes for this specific request
  });

  // Override for fast endpoint
  const quickData = await client.fetchJSON('/quick-endpoint', {
    timeoutMs: 5000, // 5 seconds
  });
}

// ============================================================================
// Example 8: External Cancellation (AbortSignal)
// ============================================================================

async function example8_cancellation() {
  const client = createHTTPClient();
  const controller = new AbortController();

  // Cancel after 10 seconds
  setTimeout(() => controller.abort(), 10000);

  try {
    const data = await client.fetchJSON('/slow-endpoint', {
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.info('Request cancelled by external signal');
    }
  }
}

// ============================================================================
// Example 9: Parallel Requests with Error Handling
// ============================================================================

async function example9_parallelRequests() {
  const client = createHTTPClient();

  const urls = [
    'https://api.example.com/data1',
    'https://api.example.com/data2',
    'https://api.example.com/data3',
  ];

  // Fetch all in parallel
  const results = await Promise.allSettled(
    urls.map((url) => client.fetchJSON(url))
  );

  // Handle mixed success/failure
  const successful = results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => (r as PromiseFulfilledResult<unknown>).value);

  const failed = results
    .filter((r) => r.status === 'rejected')
    .map((r) => (r as PromiseRejectedResult).reason);

  logger.info('Parallel requests completed', {
    successful: successful.length,
    failed: failed.length,
  });
}

// ============================================================================
// Example 10: Migrating TIGER Provider Pattern
// ============================================================================

class TIGERProviderMigration {
  private readonly httpClient = createHTTPClient({
    maxRetries: 3,
    initialDelayMs: 2000,
    userAgent: 'VOTER-Protocol-ShadowAtlas/1.0',
  });

  // Before: Custom retry implementation
  private async downloadWithRetry_OLD(
    url: string,
    maxRetries = 3,
    retryDelay = 2000
  ): Promise<Buffer> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      } catch (error) {
        lastError = error as Error;
        logger.warn(`Attempt ${attempt}/${maxRetries} failed: ${lastError.message}`, {
          attempt,
          maxRetries,
          error: lastError.message,
        });

        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      }
    }

    throw new Error(`Download failed after ${maxRetries} attempts: ${lastError?.message}`);
  }

  // After: HTTPClient (simpler, more features)
  private async downloadWithRetry_NEW(url: string): Promise<Buffer> {
    const response = await this.httpClient.fetchWithRetry(url);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

// ============================================================================
// Example 11: Singleton vs Instance Pattern
// ============================================================================

async function example11_singletonVsInstance() {
  // Singleton (default client, most common)
  const data1 = await fetchJSON('https://api.example.com/data');

  // Custom instance (provider-specific config)
  class MyProvider {
    private readonly client = createHTTPClient({
      maxRetries: 5,
      timeoutMs: 60000,
    });

    async fetchData(): Promise<unknown> {
      return this.client.fetchJSON('https://api.example.com/data');
    }
  }

  // Multiple instances (different configs for different endpoints)
  const fastClient = createHTTPClient({ timeoutMs: 5000, maxRetries: 1 });
  const slowClient = createHTTPClient({ timeoutMs: 120000, maxRetries: 5 });

  const quickData = await fastClient.fetchJSON('/quick');
  const largeData = await slowClient.fetchJSON('/slow');
}

// ============================================================================
// Example 12: ArcGIS Scanner Migration Pattern
// ============================================================================

async function example12_arcgisScannerMigration() {
  // Before: Manual fetch in each scanner function
  async function fetchArcGIS_OLD(url: string, layerId: number): Promise<FeatureCollection> {
    const queryUrl = `${url}/${layerId}/query?where=1=1&outFields=*&f=geojson&outSR=4326`;
    const response = await fetch(queryUrl);

    if (!response.ok) {
      throw new Error(`ArcGIS fetch failed: ${response.status}`);
    }

    return (await response.json()) as FeatureCollection;
  }

  // After: HTTPClient with automatic retry + validation
  async function fetchArcGIS_NEW(url: string, layerId: number): Promise<FeatureCollection> {
    const queryUrl = `${url}/${layerId}/query?where=1=1&outFields=*&f=geojson&outSR=4326`;
    return fetchGeoJSON(queryUrl); // Handles retry + validation
  }
}

// ============================================================================
// Example 13: International Provider Base Class Pattern
// ============================================================================

abstract class InternationalProviderBase {
  protected readonly httpClient = createHTTPClient({
    maxRetries: 4,
    timeoutMs: 45000,
    userAgent: 'VOTER-Protocol-ShadowAtlas/1.0',
  });

  // Helper method for all derived classes
  protected async fetchJSON<T>(url: string): Promise<T> {
    return this.httpClient.fetchJSON<T>(url);
  }

  protected async fetchGeoJSON(url: string): Promise<FeatureCollection> {
    return this.httpClient.fetchGeoJSON(url);
  }

  // Derived classes use helpers
  abstract extractBoundaries(): Promise<FeatureCollection>;
}

class UKProvider extends InternationalProviderBase {
  async extractBoundaries(): Promise<FeatureCollection> {
    // Uses inherited httpClient
    return this.fetchGeoJSON('https://uk.example.com/constituencies');
  }
}

// ============================================================================
// Example 14: Testing Patterns (Pseudo-code for illustration)
// ============================================================================

async function example14_testingPatterns() {
  /**
   * Example Vitest test:
   *
   * describe('HTTPClient', () => {
   *   it('retries transient failures', async () => {
   *     const client = createHTTPClient({
   *       maxRetries: 3,
   *       initialDelayMs: 100,
   *     });
   *
   *     // Mock fetch to fail twice, then succeed
   *     let attemptCount = 0;
   *     vi.spyOn(global, 'fetch').mockImplementation(async () => {
   *       attemptCount++;
   *       if (attemptCount < 3) {
   *         throw new Error('Network error');
   *       }
   *       return new Response(JSON.stringify({ success: true }));
   *     });
   *
   *     const data = await client.fetchJSON('/test');
   *     expect(attemptCount).toBe(3);
   *     expect(data).toEqual({ success: true });
   *   });
   *
   *   it('throws HTTPTimeoutError on timeout', async () => {
   *     const client = createHTTPClient({ timeoutMs: 100 });
   *
   *     vi.spyOn(global, 'fetch').mockImplementation(async () => {
   *       await new Promise((resolve) => setTimeout(resolve, 500));
   *       return new Response('{}');
   *     });
   *
   *     await expect(client.fetchJSON('/slow')).rejects.toThrow(HTTPTimeoutError);
   *   });
   * });
   */
}

// ============================================================================
// Checklist for Migration
// ============================================================================

/**
 * MIGRATION CHECKLIST:
 *
 * 1. Import HTTPClient or convenience functions:
 *    import { fetchJSON, fetchGeoJSON, createHTTPClient } from '../core/http-client.js';
 *
 * 2. Replace raw fetch() calls:
 *    - Simple JSON: Use fetchJSON<T>(url)
 *    - GeoJSON: Use fetchGeoJSON(url)
 *    - Binary: Use client.fetchWithRetry(url) then .arrayBuffer()
 *
 * 3. Remove custom retry logic:
 *    - Delete downloadWithRetry functions
 *    - Delete sleep/delay utilities
 *    - HTTPClient handles this automatically
 *
 * 4. Update error handling:
 *    - Catch HTTPError for HTTP status errors
 *    - Catch HTTPTimeoutError for timeouts
 *    - Catch HTTPNetworkError for network failures
 *
 * 5. Configure client (if needed):
 *    - Default config works for most cases
 *    - Use createHTTPClient({ ... }) for custom config
 *    - Use per-request options for overrides
 *
 * 6. Test thoroughly:
 *    - Verify retry logic with fault injection
 *    - Test timeout handling
 *    - Verify error types are caught correctly
 */
