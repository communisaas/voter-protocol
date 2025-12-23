/**
 * Test Mocks
 *
 * SCOPE: Service mocks with type safety
 *
 * PHILOSOPHY: Type-safe mocks that match production interfaces exactly.
 * No `any` types, no loose casts. Every mock is fully typed.
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no `@ts-ignore`.
 */

import type { FeatureCollection } from 'geojson';

// ============================================================================
// Fetch Mocks
// ============================================================================

export interface MockResponse {
  readonly ok: boolean;
  readonly status?: number;
  readonly statusText?: string;
  readonly json: () => Promise<unknown>;
}

/**
 * Create a mock fetch function with predefined responses
 *
 * Usage:
 * ```typescript
 * const mockFetch = createMockFetch(new Map([
 *   ['https://api.example.com/data', { features: [...] }],
 * ]));
 * global.fetch = mockFetch as any;
 * ```
 */
export function createMockFetch(
  responses: Map<string, unknown>
): (url: string) => Promise<MockResponse> {
  return async (url: string) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => responses.get(url) ?? { features: [] },
  });
}

/**
 * Create a mock fetch that simulates rate limiting
 */
export function createRateLimitedFetch(
  failureCount: number,
  successResponse: unknown
): (url: string) => Promise<MockResponse> {
  let attemptCount = 0;

  return async () => {
    attemptCount++;

    if (attemptCount <= failureCount) {
      return {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({
          error: {
            code: 429,
            message: 'Rate limit exceeded',
          },
        }),
      };
    }

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => successResponse,
    };
  };
}

/**
 * Create a mock fetch that simulates server errors
 */
export function createServerErrorFetch(
  failureCount: number,
  successResponse: unknown
): (url: string) => Promise<MockResponse> {
  let attemptCount = 0;

  return async () => {
    attemptCount++;

    if (attemptCount <= failureCount) {
      return {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({
          error: {
            code: 503,
            message: 'Service temporarily unavailable',
          },
        }),
      };
    }

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => successResponse,
    };
  };
}

/**
 * Create a mock fetch that always fails with a specific error
 */
export function createFailingFetch(
  status: number,
  statusText: string
): (url: string) => Promise<MockResponse> {
  return async () => ({
    ok: false,
    status,
    statusText,
    json: async () => ({
      error: {
        code: status,
        message: statusText,
      },
    }),
  });
}

/**
 * Create a mock fetch that simulates network errors
 */
export function createNetworkErrorFetch(
  errorMessage: string = 'Network error'
): () => Promise<never> {
  return async () => {
    throw new Error(errorMessage);
  };
}

// ============================================================================
// TIGERweb API Mocks
// ============================================================================

export interface TIGERwebFeature {
  readonly attributes: {
    readonly GEOID: string;
    readonly NAME: string;
    readonly STATE?: string;
    readonly STATEFP?: string;
  };
}

export interface TIGERwebResponse {
  readonly features: readonly TIGERwebFeature[];
}

/**
 * Create a mock TIGERweb fetch that responds based on state FIPS
 */
export function createTIGERwebFetch(
  stateResponses: Map<string, TIGERwebResponse>
): (url: string) => Promise<MockResponse> {
  return async (url: string) => {
    // Extract state FIPS from URL
    const stateMatch = url.match(/STATE='(\d+)'/);
    const stateFips = stateMatch ? stateMatch[1] : null;

    if (!stateFips) {
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: 'Missing STATE parameter' }),
      };
    }

    const response = stateResponses.get(stateFips);

    if (!response) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ features: [] }),
      };
    }

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => response,
    };
  };
}

// ============================================================================
// ArcGIS API Mocks
// ============================================================================

export interface ArcGISFeature {
  readonly attributes: Record<string, string | number>;
  readonly geometry?: {
    readonly rings?: readonly (readonly [number, number])[][];
    readonly x?: number;
    readonly y?: number;
  };
}

export interface ArcGISResponse {
  readonly features: readonly ArcGISFeature[];
  readonly exceededTransferLimit?: boolean;
}

/**
 * Create a mock ArcGIS fetch
 */
export function createArcGISFetch(
  layerResponses: Map<string, ArcGISResponse>
): (url: string) => Promise<MockResponse> {
  return async (url: string) => {
    // Extract layer ID from URL
    const layerMatch = url.match(/MapServer\/(\d+)/);
    const layerId = layerMatch ? layerMatch[1] : null;

    if (!layerId) {
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: 'Invalid layer URL' }),
      };
    }

    const response = layerResponses.get(layerId);

    if (!response) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ features: [] }),
      };
    }

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => response,
    };
  };
}

// ============================================================================
// Database Mocks
// ============================================================================

export interface MockDatabase {
  readonly exec: (sql: string) => void;
  readonly prepare: (sql: string) => MockStatement;
  readonly close: () => void;
}

export interface MockStatement {
  readonly run: (...params: readonly unknown[]) => MockRunResult;
  readonly get: (...params: readonly unknown[]) => unknown;
  readonly all: (...params: readonly unknown[]) => readonly unknown[];
  readonly finalize: () => void;
}

export interface MockRunResult {
  readonly changes: number;
  readonly lastInsertRowid: number | bigint;
}

/**
 * Create a mock SQLite database
 */
export function createMockDatabase(): MockDatabase {
  const data = new Map<string, unknown>();

  return {
    exec: () => {
      // No-op
    },
    prepare: (sql: string) => ({
      run: () => ({ changes: 1, lastInsertRowid: 1 }),
      get: () => null,
      all: () => [],
      finalize: () => {
        // No-op
      },
    }),
    close: () => {
      // No-op
    },
  };
}

// ============================================================================
// File System Mocks
// ============================================================================

export interface MockFileSystem {
  readonly readFile: (path: string) => Promise<string>;
  readonly writeFile: (path: string, data: string) => Promise<void>;
  readonly exists: (path: string) => Promise<boolean>;
  readonly mkdir: (path: string) => Promise<void>;
  readonly rm: (path: string) => Promise<void>;
}

/**
 * Create a mock file system
 */
export function createMockFileSystem(
  files: Map<string, string> = new Map()
): MockFileSystem {
  const fileData = new Map(files);

  return {
    readFile: async (path: string) => {
      const data = fileData.get(path);
      if (data === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
      return data;
    },
    writeFile: async (path: string, data: string) => {
      fileData.set(path, data);
    },
    exists: async (path: string) => fileData.has(path),
    mkdir: async () => {
      // No-op
    },
    rm: async (path: string) => {
      fileData.delete(path);
    },
  };
}

// ============================================================================
// Timer Mocks
// ============================================================================

/**
 * Create a mock delay function for testing rate limiting
 */
export function createMockDelay(): {
  delay: (ms: number) => Promise<void>;
  getDelayCount: () => number;
  getTotalDelayMs: () => number;
} {
  let delayCount = 0;
  let totalDelayMs = 0;

  return {
    delay: async (ms: number) => {
      delayCount++;
      totalDelayMs += ms;
      // Instant resolve for tests
    },
    getDelayCount: () => delayCount,
    getTotalDelayMs: () => totalDelayMs,
  };
}

// ============================================================================
// Logger Mocks
// ============================================================================

export interface MockLogger {
  readonly info: (...args: readonly unknown[]) => void;
  readonly warn: (...args: readonly unknown[]) => void;
  readonly error: (...args: readonly unknown[]) => void;
  readonly debug: (...args: readonly unknown[]) => void;
  readonly getLogs: () => readonly string[];
}

/**
 * Create a mock logger that captures logs for assertions
 */
export function createMockLogger(): MockLogger {
  const logs: string[] = [];

  const createLogFn = (level: string) => (...args: readonly unknown[]) => {
    logs.push(`[${level}] ${args.map((a) => String(a)).join(' ')}`);
  };

  return {
    info: createLogFn('INFO'),
    warn: createLogFn('WARN'),
    error: createLogFn('ERROR'),
    debug: createLogFn('DEBUG'),
    getLogs: () => [...logs],
  };
}

// ============================================================================
// HTTP Client Mocks
// ============================================================================

export interface MockHttpClient {
  readonly get: (url: string) => Promise<unknown>;
  readonly post: (url: string, data: unknown) => Promise<unknown>;
  readonly getRequestCount: () => number;
  readonly getLastUrl: () => string | null;
}

/**
 * Create a mock HTTP client
 */
export function createMockHttpClient(
  responses: Map<string, unknown>
): MockHttpClient {
  let requestCount = 0;
  let lastUrl: string | null = null;

  return {
    get: async (url: string) => {
      requestCount++;
      lastUrl = url;
      return responses.get(url) ?? null;
    },
    post: async (url: string) => {
      requestCount++;
      lastUrl = url;
      return responses.get(url) ?? null;
    },
    getRequestCount: () => requestCount,
    getLastUrl: () => lastUrl,
  };
}
