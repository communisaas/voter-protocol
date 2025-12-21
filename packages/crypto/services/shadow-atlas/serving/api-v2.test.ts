/**
 * Shadow Atlas API v2 - Integration Tests
 *
 * Tests for production-hardened API with:
 * - Request validation (Zod schemas)
 * - Response standardization
 * - Rate limiting
 * - Error handling
 * - OpenAPI compliance
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ShadowAtlasAPIv2, createShadowAtlasAPIv2 } from './api-v2';
import type { APIResponse, LookupResult, SnapshotMetadata } from './api-v2';

/**
 * Mock HTTP client for testing
 */
class MockHTTPClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async get(path: string, headers: Record<string, string> = {}): Promise<{
    status: number;
    headers: Record<string, string>;
    body: unknown;
  }> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, { headers });

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const body = await response.json();

    return {
      status: response.status,
      headers: responseHeaders,
      body,
    };
  }
}

describe('Shadow Atlas API v2 - Request Validation', () => {
  let api: ShadowAtlasAPIv2;
  let client: MockHTTPClient;
  const port = 3001;

  beforeEach(async () => {
    api = await createShadowAtlasAPIv2('./test.db', { port });
    api.start();
    client = new MockHTTPClient(`http://localhost:${port}`);
  });

  afterEach(() => {
    api.stop();
  });

  it('validates latitude bounds (min)', async () => {
    const response = await client.get('/v1/lookup?lat=-91&lng=0');

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
    const response = await client.get('/v1/lookup?lat=91&lng=0');

    expect(response.status).toBe(400);
    const body = response.body as APIResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('INVALID_PARAMETERS');
  });

  it('validates longitude bounds (min)', async () => {
    const response = await client.get('/v1/lookup?lat=0&lng=-181');

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
    const response = await client.get('/v1/lookup?lat=0&lng=181');

    expect(response.status).toBe(400);
    const body = response.body as APIResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('INVALID_PARAMETERS');
  });

  it('requires both lat and lng', async () => {
    const response = await client.get('/v1/lookup?lat=39.7392');

    expect(response.status).toBe(400);
    const body = response.body as APIResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('INVALID_PARAMETERS');
  });

  it('validates district ID (non-empty)', async () => {
    const response = await client.get('/v1/districts/');

    expect(response.status).toBe(404); // Empty ID results in endpoint not found
    const body = response.body as APIResponse<never>;
    expect(body.success).toBe(false);
  });

  it('accepts valid coordinates', async () => {
    const response = await client.get('/v1/lookup?lat=39.7392&lng=-104.9903');

    // May be 200 (district found) or 404 (no district) depending on test data
    expect([200, 404]).toContain(response.status);
    const body = response.body as APIResponse<LookupResult>;

    if (response.status === 200) {
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.meta.requestId).toMatch(/^req_[a-f0-9]+$/);
    } else {
      expect(body.success).toBe(false);
      expect(body.error?.code).toBe('DISTRICT_NOT_FOUND');
    }
  });
});

describe('Shadow Atlas API v2 - Response Standardization', () => {
  let api: ShadowAtlasAPIv2;
  let client: MockHTTPClient;
  const port = 3002;

  beforeEach(async () => {
    api = await createShadowAtlasAPIv2('./test.db', { port });
    api.start();
    client = new MockHTTPClient(`http://localhost:${port}`);
  });

  afterEach(() => {
    api.stop();
  });

  it('returns standardized success response', async () => {
    const response = await client.get('/v1/health');

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
    const response = await client.get('/v1/lookup?lat=999&lng=0');

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
      client.get('/v1/health'),
      client.get('/v1/snapshot'),
      client.get('/v1/lookup?lat=0&lng=0'),
    ]);

    for (const response of responses) {
      const body = response.body as APIResponse<unknown>;
      expect(body.meta.requestId).toMatch(/^req_[a-f0-9]+$/);
    }
  });

  it('includes latency in all responses', async () => {
    const response = await client.get('/v1/health');
    const body = response.body as APIResponse<unknown>;

    expect(body.meta.latencyMs).toBeGreaterThan(0);
    expect(body.meta.latencyMs).toBeLessThan(1000); // Should be fast
  });
});

describe('Shadow Atlas API v2 - Security Headers', () => {
  let api: ShadowAtlasAPIv2;
  let client: MockHTTPClient;
  const port = 3003;

  beforeEach(async () => {
    api = await createShadowAtlasAPIv2('./test.db', { port });
    api.start();
    client = new MockHTTPClient(`http://localhost:${port}`);
  });

  afterEach(() => {
    api.stop();
  });

  it('sets CORS headers', async () => {
    const response = await client.get('/v1/health');

    expect(response.headers['access-control-allow-origin']).toBeDefined();
    expect(response.headers['access-control-allow-methods']).toBeDefined();
  });

  it('sets security headers', async () => {
    const response = await client.get('/v1/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-xss-protection']).toBe('1; mode=block');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });

  it('sets request tracking headers', async () => {
    const response = await client.get('/v1/health');

    expect(response.headers['x-request-id']).toMatch(/^req_[a-f0-9]+$/);
    expect(response.headers['x-api-version']).toBe('v1');
  });

  it('exposes CORS headers', async () => {
    const response = await client.get('/v1/health');

    const exposedHeaders = response.headers['access-control-expose-headers'];
    expect(exposedHeaders).toContain('X-Request-ID');
    expect(exposedHeaders).toContain('X-RateLimit-Limit');
  });
});

describe('Shadow Atlas API v2 - Rate Limiting', () => {
  let api: ShadowAtlasAPIv2;
  let client: MockHTTPClient;
  const port = 3004;
  const rateLimitPerMinute = 5;

  beforeEach(async () => {
    api = await createShadowAtlasAPIv2('./test.db', { port, rateLimitPerMinute });
    api.start();
    client = new MockHTTPClient(`http://localhost:${port}`);
  });

  afterEach(() => {
    api.stop();
  });

  it('includes rate limit headers', async () => {
    const response = await client.get('/v1/lookup?lat=0&lng=0');

    expect(response.headers['x-ratelimit-limit']).toBe(String(rateLimitPerMinute));
    expect(response.headers['x-ratelimit-remaining']).toBeDefined();
    expect(response.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('enforces rate limits', async () => {
    // Make requests up to limit
    const requests = [];
    for (let i = 0; i < rateLimitPerMinute; i++) {
      requests.push(client.get('/v1/lookup?lat=0&lng=0'));
    }

    await Promise.all(requests);

    // Next request should be rate limited
    const response = await client.get('/v1/lookup?lat=0&lng=0');

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
    const response1 = await client.get('/v1/lookup?lat=0&lng=0');
    const remaining1 = parseInt(response1.headers['x-ratelimit-remaining'], 10);

    const response2 = await client.get('/v1/lookup?lat=0&lng=0');
    const remaining2 = parseInt(response2.headers['x-ratelimit-remaining'], 10);

    expect(remaining2).toBe(remaining1 - 1);
  });
});

describe('Shadow Atlas API v2 - API Versioning', () => {
  let api: ShadowAtlasAPIv2;
  let client: MockHTTPClient;
  const port = 3005;

  beforeEach(async () => {
    api = await createShadowAtlasAPIv2('./test.db', {
      port,
      apiVersion: {
        version: 'v1',
        deprecated: false,
      },
    });
    api.start();
    client = new MockHTTPClient(`http://localhost:${port}`);
  });

  afterEach(() => {
    api.stop();
  });

  it('accepts correct version', async () => {
    const response = await client.get('/v1/health');

    expect(response.status).toBe(200);
    expect(response.headers['x-api-version']).toBe('v1');
  });

  it('rejects unsupported version', async () => {
    const response = await client.get('/v2/health');

    expect(response.status).toBe(400);
    const body = response.body as APIResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('UNSUPPORTED_VERSION');
  });
});

describe('Shadow Atlas API v2 - Deprecation Headers', () => {
  let api: ShadowAtlasAPIv2;
  let client: MockHTTPClient;
  const port = 3006;

  beforeEach(async () => {
    api = await createShadowAtlasAPIv2('./test.db', {
      port,
      apiVersion: {
        version: 'v1',
        deprecated: true,
        sunsetDate: '2026-01-01T00:00:00Z',
        migrationGuide: 'https://docs.shadow-atlas.org/migration/v1-to-v2',
      },
    });
    api.start();
    client = new MockHTTPClient(`http://localhost:${port}`);
  });

  afterEach(() => {
    api.stop();
  });

  it('includes deprecation headers', async () => {
    const response = await client.get('/v1/health');

    expect(response.headers['deprecation']).toBe('true');
    expect(response.headers['sunset']).toBe('2026-01-01T00:00:00Z');
    expect(response.headers['link']).toContain('https://docs.shadow-atlas.org/migration/v1-to-v2');
  });
});

describe('Shadow Atlas API v2 - Error Handling', () => {
  let api: ShadowAtlasAPIv2;
  let client: MockHTTPClient;
  const port = 3007;

  beforeEach(async () => {
    api = await createShadowAtlasAPIv2('./test.db', { port });
    api.start();
    client = new MockHTTPClient(`http://localhost:${port}`);
  });

  afterEach(() => {
    api.stop();
  });

  it('handles 404 endpoints gracefully', async () => {
    const response = await client.get('/v1/nonexistent');

    expect(response.status).toBe(404);
    const body = response.body as APIResponse<never>;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('NOT_FOUND');
    expect(body.meta.requestId).toMatch(/^req_[a-f0-9]+$/);
  });

  it('handles OPTIONS preflight', async () => {
    const response = await fetch(`http://localhost:${port}/v1/health`, {
      method: 'OPTIONS',
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBeDefined();
  });

  it('includes error details in response', async () => {
    const response = await client.get('/v1/lookup?lat=999&lng=0');

    expect(response.status).toBe(400);
    const body = response.body as APIResponse<never>;
    expect(body.error?.details).toBeDefined();
    expect(body.error?.message).toBeTruthy();
    expect(body.error?.code).toBeTruthy();
  });
});

describe('Shadow Atlas API v2 - Cache Headers', () => {
  let api: ShadowAtlasAPIv2;
  let client: MockHTTPClient;
  const port = 3008;

  beforeEach(async () => {
    api = await createShadowAtlasAPIv2('./test.db', { port });
    api.start();
    client = new MockHTTPClient(`http://localhost:${port}`);
  });

  afterEach(() => {
    api.stop();
  });

  it('sets cache headers for cacheable responses', async () => {
    const response = await client.get('/v1/health');

    expect(response.headers['cache-control']).toBeDefined();
    expect(response.headers['x-cache']).toMatch(/^(HIT|MISS)$/);
  });

  it('indicates cache hit/miss', async () => {
    // First request (cache miss)
    const response1 = await client.get('/v1/lookup?lat=39.7392&lng=-104.9903');
    const body1 = response1.body as APIResponse<LookupResult>;

    if (response1.status === 200) {
      expect(body1.meta.cached).toBe(false);
      expect(response1.headers['x-cache']).toBe('MISS');

      // Second request (potential cache hit)
      const response2 = await client.get('/v1/lookup?lat=39.7392&lng=-104.9903');
      const body2 = response2.body as APIResponse<LookupResult>;

      if (body2.meta.cached) {
        expect(response2.headers['x-cache']).toBe('HIT');
      }
    }
  });
});

describe('Shadow Atlas API v2 - OpenAPI Compliance', () => {
  let api: ShadowAtlasAPIv2;
  let client: MockHTTPClient;
  const port = 3009;

  beforeEach(async () => {
    api = await createShadowAtlasAPIv2('./test.db', { port });
    api.start();
    client = new MockHTTPClient(`http://localhost:${port}`);
  });

  afterEach(() => {
    api.stop();
  });

  it('returns JSON content-type', async () => {
    const response = await client.get('/v1/health');
    expect(response.headers['content-type']).toContain('application/json');
  });

  it('health endpoint matches OpenAPI spec', async () => {
    const response = await client.get('/v1/health');
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
    const response = await client.get('/v1/snapshot');

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
    const response = await client.get('/v1/lookup?lat=999&lng=0');
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
