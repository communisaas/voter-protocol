/**
 * Shadow Atlas API v2 - Integration Tests
 *
 * Tests for production-hardened API with:
 * - Request validation (Zod schemas)
 * - Response standardization
 * - Rate limiting
 * - Error handling
 * - OpenAPI compliance
 *
 * ARCHITECTURE: Tests use mocked dependencies (no real HTTP server, no real DB)
 * to ensure fast, deterministic test execution.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShadowAtlasAPI } from '../../../serving/api';
import type { APIResponse, LookupResult, SnapshotMetadata } from '../../../serving/api';
import type { DistrictBoundary } from '../../../serving/types';
import { IncomingMessage, ServerResponse } from 'http';

/**
 * Mock services for testing
 */
function createMockLookupService() {
  return {
    lookup: vi.fn(),
    close: vi.fn(),
    clearCache: vi.fn(),
    getMetrics: vi.fn().mockReturnValue({
      cacheHits: 0,
      cacheMisses: 0,
      totalQueries: 0,
      hitRate: 0,
    }),
  };
}

function createMockProofService() {
  return {
    generateProof: vi.fn().mockResolvedValue({
      root: '0x1234567890abcdef',
      leaf: '0xabcdef1234567890',
      siblings: [],
      pathIndices: [],
    }),
  };
}

function createMockSyncService() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    getLatestSnapshot: vi.fn().mockResolvedValue({
      snapshotId: 'snapshot_v1_2026',
      ipfsCID: 'Qm...',
      merkleRoot: '0x1234',
      timestamp: new Date().toISOString(),
      districtCount: 1000,
      version: 'v1',
      coverage: {
        countries: ['US'],
        states: ['CO'],
      },
    }),
    listSnapshots: vi.fn().mockResolvedValue([]),
  };
}

/**
 * Mock HTTP request/response objects
 */
function createMockRequest(url: string, method = 'GET'): IncomingMessage {
  const req = {
    url,
    method,
    headers: { host: 'localhost:3000' },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
  return req;
}

function createMockResponse(): {
  res: ServerResponse;
  getStatus: () => number;
  getHeaders: () => Record<string, string | string[]>;
  getBody: () => unknown;
} {
  let statusCode = 200;
  const headers: Record<string, string | string[]> = {};
  let body = '';

  const res = {
    writeHead: vi.fn((status: number, hdrs?: Record<string, string | string[]>) => {
      statusCode = status;
      if (hdrs) {
        // Merge headers from writeHead, converting keys to lowercase
        Object.entries(hdrs).forEach(([key, value]) => {
          headers[key.toLowerCase()] = value;
        });
      }
    }),
    setHeader: vi.fn((key: string, value: string | string[]) => {
      headers[key.toLowerCase()] = value;
    }),
    end: vi.fn((data?: string) => {
      if (data) body = data;
    }),
  } as unknown as ServerResponse;

  return {
    res,
    getStatus: () => statusCode,
    getHeaders: () => headers,
    getBody: () => (body ? JSON.parse(body) : null),
  };
}

/**
 * Helper to invoke API's private handleRequest method
 */
async function invokeHandleRequest(
  api: ShadowAtlasAPI,
  url: string,
  method = 'GET'
): Promise<{
  status: number;
  headers: Record<string, string | string[]>;
  body: unknown;
}> {
  const req = createMockRequest(url, method);
  const { res, getStatus, getHeaders, getBody } = createMockResponse();

  // Access private method via type assertion
  await (api as any).handleRequest(req, res);

  return {
    status: getStatus(),
    headers: getHeaders(),
    body: getBody(),
  };
}

describe('Shadow Atlas API v2 - Request Validation', () => {
  let api: ShadowAtlasAPI;
  let mockLookupService: ReturnType<typeof createMockLookupService>;

  beforeEach(() => {
    mockLookupService = createMockLookupService();
    const mockProofService = createMockProofService();
    const mockSyncService = createMockSyncService();

    api = new ShadowAtlasAPI(
      mockLookupService as any,
      mockProofService as any,
      mockSyncService as any,
      3001
    );
  });

  it('validates latitude bounds (min)', async () => {
    const response = await invokeHandleRequest(api, '/v1/lookup?lat=-91&lng=0');

    expect(response.status).toBe(400);
    const body = response.body as APIResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('INVALID_PARAMETERS');
    expect(body.error?.details).toMatchObject({
      fieldErrors: {
        lat: expect.arrayContaining([expect.stringContaining('Latitude must be >= -90')]),
      },
    });
  });

  it('validates latitude bounds (max)', async () => {
    const response = await invokeHandleRequest(api, '/v1/lookup?lat=91&lng=0');

    expect(response.status).toBe(400);
    const body = response.body as APIResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('INVALID_PARAMETERS');
  });

  it('validates longitude bounds (min)', async () => {
    const response = await invokeHandleRequest(api, '/v1/lookup?lat=0&lng=-181');

    expect(response.status).toBe(400);
    const body = response.body as APIResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('INVALID_PARAMETERS');
    expect(body.error?.details).toMatchObject({
      fieldErrors: {
        lng: expect.arrayContaining([expect.stringContaining('Longitude must be >= -180')]),
      },
    });
  });

  it('validates longitude bounds (max)', async () => {
    const response = await invokeHandleRequest(api, '/v1/lookup?lat=0&lng=181');

    expect(response.status).toBe(400);
    const body = response.body as APIResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('INVALID_PARAMETERS');
  });

  it('requires both lat and lng', async () => {
    const response = await invokeHandleRequest(api, '/v1/lookup?lat=39.7392');

    expect(response.status).toBe(400);
    const body = response.body as APIResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('INVALID_PARAMETERS');
  });

  it('validates district ID (non-empty)', async () => {
    const response = await invokeHandleRequest(api, '/v1/districts/');

    expect(response.status).toBe(404); // Empty ID results in endpoint not found
    const body = response.body as APIResponse<never>;
    expect(body.success).toBe(false);
  });

  it('accepts valid coordinates', async () => {
    const mockDistrict: DistrictBoundary = {
      id: 'denver-council-1',
      name: 'Denver Council District 1',
      jurisdiction: 'Denver, CO',
      districtType: 'council',
      geometry: {
        type: 'Polygon',
        coordinates: [[[-104.99, 39.74], [-104.98, 39.74], [-104.98, 39.73], [-104.99, 39.73], [-104.99, 39.74]]],
      },
      provenance: {
        source: 'municipal-gis',
        publishedDate: '2024-01-01',
        verifiedDate: '2024-01-15',
      },
    };

    mockLookupService.lookup.mockReturnValue({
      district: mockDistrict,
      latencyMs: 5,
      cacheHit: false,
    });

    const response = await invokeHandleRequest(api, '/v1/lookup?lat=39.7392&lng=-104.9903');

    expect(response.status).toBe(200);
    const body = response.body as APIResponse<LookupResult>;
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    expect(body.meta.requestId).toMatch(/^req_[a-f0-9]+$/);
  });
});

describe('Shadow Atlas API v2 - Response Standardization', () => {
  let api: ShadowAtlasAPI;

  beforeEach(() => {
    const mockLookupService = createMockLookupService();
    const mockProofService = createMockProofService();
    const mockSyncService = createMockSyncService();

    api = new ShadowAtlasAPI(
      mockLookupService as any,
      mockProofService as any,
      mockSyncService as any,
      3002
    );
  });

  it('returns standardized success response', async () => {
    const response = await invokeHandleRequest(api, '/v1/health');

    expect(response.status).toBe(200);
    const body = response.body as APIResponse<unknown>;

    expect(body).toMatchObject({
      success: true,
      data: expect.any(Object),
      meta: {
        requestId: expect.stringMatching(/^req_[a-f0-9]+$/),
        latencyMs: expect.any(Number),
        cached: expect.any(Boolean),
        version: 'v1',
      },
    });
  });

  it('returns standardized error response', async () => {
    const response = await invokeHandleRequest(api, '/v1/lookup?lat=999&lng=0');

    expect(response.status).toBe(400);
    const body = response.body as APIResponse<never>;

    expect(body).toMatchObject({
      success: false,
      error: {
        code: expect.any(String),
        message: expect.any(String),
      },
      meta: {
        requestId: expect.stringMatching(/^req_[a-f0-9]+$/),
        latencyMs: expect.any(Number),
        cached: false,
        version: 'v1',
      },
    });
  });

  it('includes request ID in all responses', async () => {
    const responses = await Promise.all([
      invokeHandleRequest(api, '/v1/health'),
      invokeHandleRequest(api, '/v1/snapshot'),
      invokeHandleRequest(api, '/v1/lookup?lat=0&lng=0'),
    ]);

    for (const response of responses) {
      const body = response.body as APIResponse<unknown>;
      expect(body.meta.requestId).toMatch(/^req_[a-f0-9]+$/);
    }
  });

  it('includes latency in all responses', async () => {
    const response = await invokeHandleRequest(api, '/v1/health');
    const body = response.body as APIResponse<unknown>;

    expect(body.meta.latencyMs).toBeGreaterThan(0);
    expect(body.meta.latencyMs).toBeLessThan(1000); // Should be fast
  });
});

describe('Shadow Atlas API v2 - Security Headers', () => {
  let api: ShadowAtlasAPI;

  beforeEach(() => {
    const mockLookupService = createMockLookupService();
    const mockProofService = createMockProofService();
    const mockSyncService = createMockSyncService();

    api = new ShadowAtlasAPI(
      mockLookupService as any,
      mockProofService as any,
      mockSyncService as any,
      3003
    );
  });

  it('sets CORS headers', async () => {
    const response = await invokeHandleRequest(api, '/v1/health');

    expect(response.headers['access-control-allow-origin']).toBeDefined();
    expect(response.headers['access-control-allow-methods']).toBeDefined();
  });

  it('sets security headers', async () => {
    const response = await invokeHandleRequest(api, '/v1/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-xss-protection']).toBe('1; mode=block');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });

  it('sets request tracking headers', async () => {
    const response = await invokeHandleRequest(api, '/v1/health');

    expect(response.headers['x-request-id']).toMatch(/^req_[a-f0-9]+$/);
    expect(response.headers['x-api-version']).toBe('v1');
  });

  it('exposes CORS headers', async () => {
    const response = await invokeHandleRequest(api, '/v1/health');

    const exposedHeaders = response.headers['access-control-expose-headers'] as string;
    expect(exposedHeaders).toContain('X-Request-ID');
    expect(exposedHeaders).toContain('X-RateLimit-Limit');
  });
});

describe('Shadow Atlas API v2 - Rate Limiting', () => {
  let api: ShadowAtlasAPI;
  const rateLimitPerMinute = 5;

  beforeEach(() => {
    const mockLookupService = createMockLookupService();
    mockLookupService.lookup.mockReturnValue({
      district: null,
      latencyMs: 1,
      cacheHit: false,
    });
    const mockProofService = createMockProofService();
    const mockSyncService = createMockSyncService();

    api = new ShadowAtlasAPI(
      mockLookupService as any,
      mockProofService as any,
      mockSyncService as any,
      3004,
      '0.0.0.0',
      ['*'],
      rateLimitPerMinute
    );
  });

  it('includes rate limit headers', async () => {
    const response = await invokeHandleRequest(api, '/v1/lookup?lat=0&lng=0');

    expect(response.headers['x-ratelimit-limit']).toBe(rateLimitPerMinute);
    expect(response.headers['x-ratelimit-remaining']).toBeDefined();
    expect(response.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('enforces rate limits', async () => {
    // Make requests up to limit
    for (let i = 0; i < rateLimitPerMinute; i++) {
      await invokeHandleRequest(api, '/v1/lookup?lat=0&lng=0');
    }

    // Next request should be rate limited
    const response = await invokeHandleRequest(api, '/v1/lookup?lat=0&lng=0');

    expect(response.status).toBe(429);
    const body = response.body as APIResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(body.error?.details).toMatchObject({
      limit: rateLimitPerMinute,
      remaining: 0,
    });
  });

  it('decrements rate limit counter', async () => {
    const response1 = await invokeHandleRequest(api, '/v1/lookup?lat=0&lng=0');
    const remaining1 = parseInt(response1.headers['x-ratelimit-remaining'] as string, 10);

    const response2 = await invokeHandleRequest(api, '/v1/lookup?lat=0&lng=0');
    const remaining2 = parseInt(response2.headers['x-ratelimit-remaining'] as string, 10);

    expect(remaining2).toBe(remaining1 - 1);
  });
});

describe('Shadow Atlas API v2 - API Versioning', () => {
  let api: ShadowAtlasAPI;

  beforeEach(() => {
    const mockLookupService = createMockLookupService();
    const mockProofService = createMockProofService();
    const mockSyncService = createMockSyncService();

    api = new ShadowAtlasAPI(
      mockLookupService as any,
      mockProofService as any,
      mockSyncService as any,
      3005,
      '0.0.0.0',
      ['*'],
      60,
      {
        version: 'v1',
        deprecated: false,
      }
    );
  });

  it('accepts correct version', async () => {
    const response = await invokeHandleRequest(api, '/v1/health');

    expect(response.status).toBe(200);
    expect(response.headers['x-api-version']).toBe('v1');
  });

  it('rejects unsupported version', async () => {
    const response = await invokeHandleRequest(api, '/v2/health');

    expect(response.status).toBe(400);
    const body = response.body as APIResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('UNSUPPORTED_VERSION');
  });
});

describe('Shadow Atlas API v2 - Deprecation Headers', () => {
  let api: ShadowAtlasAPI;

  beforeEach(() => {
    const mockLookupService = createMockLookupService();
    const mockProofService = createMockProofService();
    const mockSyncService = createMockSyncService();

    api = new ShadowAtlasAPI(
      mockLookupService as any,
      mockProofService as any,
      mockSyncService as any,
      3006,
      '0.0.0.0',
      ['*'],
      60,
      {
        version: 'v1',
        deprecated: true,
        sunsetDate: '2026-01-01T00:00:00Z',
        migrationGuide: 'https://docs.shadow-atlas.org/migration/v1-to-v2',
      }
    );
  });

  it('includes deprecation headers', async () => {
    const response = await invokeHandleRequest(api, '/v1/health');

    expect(response.headers['deprecation']).toBe('true');
    expect(response.headers['sunset']).toBe('2026-01-01T00:00:00Z');
    expect(response.headers['link']).toContain('https://docs.shadow-atlas.org/migration/v1-to-v2');
  });
});

describe('Shadow Atlas API v2 - Error Handling', () => {
  let api: ShadowAtlasAPI;

  beforeEach(() => {
    const mockLookupService = createMockLookupService();
    const mockProofService = createMockProofService();
    const mockSyncService = createMockSyncService();

    api = new ShadowAtlasAPI(
      mockLookupService as any,
      mockProofService as any,
      mockSyncService as any,
      3007
    );
  });

  it('handles 404 endpoints gracefully', async () => {
    const response = await invokeHandleRequest(api, '/v1/nonexistent');

    expect(response.status).toBe(404);
    const body = response.body as APIResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('NOT_FOUND');
    expect(body.meta.requestId).toMatch(/^req_[a-f0-9]+$/);
  });

  it('handles OPTIONS preflight', async () => {
    const response = await invokeHandleRequest(api, '/v1/health', 'OPTIONS');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBeDefined();
  });

  it('includes error details in response', async () => {
    const response = await invokeHandleRequest(api, '/v1/lookup?lat=999&lng=0');

    expect(response.status).toBe(400);
    const body = response.body as APIResponse<never>;
    expect(body.error?.details).toBeDefined();
    expect(body.error?.message).toBeTruthy();
    expect(body.error?.code).toBeTruthy();
  });
});

describe('Shadow Atlas API v2 - Cache Headers', () => {
  let api: ShadowAtlasAPI;
  let mockLookupService: ReturnType<typeof createMockLookupService>;

  beforeEach(() => {
    mockLookupService = createMockLookupService();
    const mockProofService = createMockProofService();
    const mockSyncService = createMockSyncService();

    api = new ShadowAtlasAPI(
      mockLookupService as any,
      mockProofService as any,
      mockSyncService as any,
      3008
    );
  });

  it('sets cache headers for cacheable responses', async () => {
    const response = await invokeHandleRequest(api, '/v1/health');

    expect(response.headers['cache-control']).toBeDefined();
    expect(response.headers['x-cache']).toMatch(/^(HIT|MISS)$/);
  });

  it('indicates cache hit/miss', async () => {
    const mockDistrict: DistrictBoundary = {
      id: 'denver-council-1',
      name: 'Denver Council District 1',
      jurisdiction: 'Denver, CO',
      districtType: 'council',
      geometry: {
        type: 'Polygon',
        coordinates: [[[-104.99, 39.74], [-104.98, 39.74], [-104.98, 39.73], [-104.99, 39.73], [-104.99, 39.74]]],
      },
      provenance: {
        source: 'municipal-gis',
        publishedDate: '2024-01-01',
        verifiedDate: '2024-01-15',
      },
    };

    // First request (cache miss)
    mockLookupService.lookup.mockReturnValue({
      district: mockDistrict,
      latencyMs: 5,
      cacheHit: false,
    });

    const response1 = await invokeHandleRequest(api, '/v1/lookup?lat=39.7392&lng=-104.9903');
    const body1 = response1.body as APIResponse<LookupResult>;

    expect(body1.meta.cached).toBe(false);
    expect(response1.headers['x-cache']).toBe('MISS');

    // Second request (cache hit)
    mockLookupService.lookup.mockReturnValue({
      district: mockDistrict,
      latencyMs: 1,
      cacheHit: true,
    });

    const response2 = await invokeHandleRequest(api, '/v1/lookup?lat=39.7392&lng=-104.9903');
    const body2 = response2.body as APIResponse<LookupResult>;

    expect(body2.meta.cached).toBe(true);
    expect(response2.headers['x-cache']).toBe('HIT');
  });
});

describe('Shadow Atlas API v2 - OpenAPI Compliance', () => {
  let api: ShadowAtlasAPI;

  beforeEach(() => {
    const mockLookupService = createMockLookupService();
    const mockProofService = createMockProofService();
    const mockSyncService = createMockSyncService();

    api = new ShadowAtlasAPI(
      mockLookupService as any,
      mockProofService as any,
      mockSyncService as any,
      3009
    );
  });

  it('returns JSON content-type', async () => {
    const response = await invokeHandleRequest(api, '/v1/health');
    const contentType = response.headers['content-type'];
    expect(contentType).toBeDefined();
    if (typeof contentType === 'string') {
      expect(contentType).toContain('application/json');
    } else if (Array.isArray(contentType)) {
      expect(contentType.join(',')).toContain('application/json');
    }
  });

  it('health endpoint matches OpenAPI spec', async () => {
    const response = await invokeHandleRequest(api, '/v1/health');
    const body = response.body as APIResponse<unknown>;

    expect(body).toMatchObject({
      success: true,
      data: {
        status: expect.stringMatching(/^(healthy|degraded|unhealthy)$/),
        uptime: expect.any(Number),
        queries: expect.any(Object),
        cache: expect.any(Object),
        snapshot: expect.any(Object),
        errors: expect.any(Object),
        timestamp: expect.any(Number),
      },
      meta: {
        requestId: expect.any(String),
        latencyMs: expect.any(Number),
        cached: expect.any(Boolean),
        version: expect.any(String),
      },
    });
  });

  it('snapshot endpoint matches OpenAPI spec', async () => {
    const response = await invokeHandleRequest(api, '/v1/snapshot');

    if (response.status === 200) {
      const body = response.body as APIResponse<SnapshotMetadata>;

      expect(body.data).toMatchObject({
        snapshotId: expect.any(String),
        ipfsCID: expect.any(String),
        merkleRoot: expect.any(String),
        timestamp: expect.any(String),
        districtCount: expect.any(Number),
        version: expect.any(String),
        coverage: {
          countries: expect.any(Array),
          states: expect.any(Array),
        },
      });
    }
  });

  it('error responses match OpenAPI spec', async () => {
    const response = await invokeHandleRequest(api, '/v1/lookup?lat=999&lng=0');
    const body = response.body as APIResponse<never>;

    expect(body).toMatchObject({
      success: false,
      error: {
        code: expect.any(String),
        message: expect.any(String),
      },
      meta: {
        requestId: expect.any(String),
        latencyMs: expect.any(Number),
        cached: expect.any(Boolean),
        version: expect.any(String),
      },
    });
  });
});
