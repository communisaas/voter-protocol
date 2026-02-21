/**
 * Engagement API Integration Tests
 *
 * Tests the 4 engagement endpoints with a real EngagementService
 * and mock HTTP primitives (same pattern as api.test.ts).
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { IncomingMessage, ServerResponse } from 'http';
import { ShadowAtlasAPI } from '../../serving/api';
import { EngagementService } from '../../serving/engagement-service';

const AUTH_TOKEN = 'test-engagement-auth-token-123';

let engagementService: EngagementService;
let api: ShadowAtlasAPI;

function createMockLookupService() {
  return { lookup: vi.fn(), close: vi.fn(), clearCache: vi.fn(), getMetrics: vi.fn().mockReturnValue({ cacheHits: 0, cacheMisses: 0, totalQueries: 0, hitRate: 0 }) };
}
function createMockProofService() {
  return { generateProof: vi.fn() };
}
function createMockSyncService() {
  return { start: vi.fn(), stop: vi.fn(), getLatestSnapshot: vi.fn(), listSnapshots: vi.fn().mockResolvedValue([]) };
}

function createMockRequest(url: string, method = 'GET', headers: Record<string, string> = {}): IncomingMessage {
  return {
    url,
    method,
    headers: { host: 'localhost:3000', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
}

function createMockResponse(): {
  res: ServerResponse;
  getStatus: () => number;
  getBody: () => unknown;
} {
  let statusCode = 200;
  const headers: Record<string, string | string[]> = {};
  let body = '';
  const res = {
    writeHead: vi.fn((status: number, hdrs?: Record<string, string | string[]>) => {
      statusCode = status;
      if (hdrs) Object.entries(hdrs).forEach(([k, v]) => { headers[k.toLowerCase()] = v; });
    }),
    setHeader: vi.fn((key: string, value: string | string[]) => { headers[key.toLowerCase()] = value; }),
    getHeader: vi.fn((key: string) => headers[key.toLowerCase()]),
    end: vi.fn((data?: string) => { if (data) body = data; }),
  } as unknown as ServerResponse;
  return { res, getStatus: () => statusCode, getBody: () => (body ? JSON.parse(body) : null) };
}

/** Create a mock POST request with body readable via the API's readBody() */
function createMockPostRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): IncomingMessage {
  const payload = JSON.stringify(body);
  const req = createMockRequest(url, 'POST', {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(payload)),
    ...headers,
  });

  // Simulate readable stream
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  (req as any).on = (event: string, handler: (...args: unknown[]) => void) => {
    (listeners[event] ??= []).push(handler);
    if (event === 'data') {
      // Emit data on next tick so the handler is registered first
      process.nextTick(() => handler(Buffer.from(payload)));
    }
    if (event === 'end') {
      process.nextTick(() => process.nextTick(() => handler()));
    }
    return req;
  };

  return req;
}

async function invoke(
  url: string,
  method = 'GET',
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = body
    ? createMockPostRequest(url, body, headers)
    : createMockRequest(url, method, headers);
  const { res, getStatus, getBody } = createMockResponse();
  await (api as any).handleRequest(req, res);
  return { status: getStatus(), body: getBody() as Record<string, unknown> };
}

describe('Engagement API Integration', () => {
  beforeAll(async () => {
    engagementService = await EngagementService.create(4);
    api = new ShadowAtlasAPI(
      createMockLookupService() as any,
      createMockProofService() as any,
      createMockSyncService() as any,
      3099,
      '127.0.0.1',
      [],
      60,
      undefined,
      null,
      null,
      AUTH_TOKEN,
      null,
      engagementService,
    );
  }, 120_000);

  // ========================================================================
  // GET /v1/engagement-info
  // ========================================================================

  describe('GET /v1/engagement-info', () => {
    it('returns available=true with tree metadata', async () => {
      const { status, body } = await invoke('/v1/engagement-info');
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      const d = body.data as Record<string, unknown>;
      expect(d.available).toBe(true);
      expect(d.depth).toBe(4);
      expect(d.leafCount).toBe(0);
      expect(d.root).toMatch(/^0x[0-9a-f]+$/);
    });
  });

  // ========================================================================
  // POST /v1/engagement/register
  // ========================================================================

  describe('POST /v1/engagement/register', () => {
    beforeEach(() => {
      // Reset registration rate limiter between tests to prevent budget exhaustion
      (api as any).registrationRateLimiter.reset('127.0.0.1');
    });

    it('registers identity with valid auth', async () => {
      const { status, body } = await invoke(
        '/v1/engagement/register',
        'POST',
        {
          signerAddress: '0x' + 'a'.repeat(40),
          identityCommitment: '0x' + '1'.padStart(64, '0'),
        },
        { authorization: `Bearer ${AUTH_TOKEN}` },
      );
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      const d = body.data as Record<string, unknown>;
      expect(d.leafIndex).toBe(0);
      expect(d.engagementRoot).toMatch(/^0x[0-9a-f]+$/);
    });

    it('rejects duplicate identity', async () => {
      // W-004: Returns 400 INVALID_PARAMETERS (not 409) — oracle-resistant,
      // indistinguishable from other validation errors (matches Tree 1 pattern).
      const { status, body } = await invoke(
        '/v1/engagement/register',
        'POST',
        {
          signerAddress: '0x' + 'b'.repeat(40),
          identityCommitment: '0x' + '1'.padStart(64, '0'),
        },
        { authorization: `Bearer ${AUTH_TOKEN}` },
      );
      expect(status).toBe(400);
      expect(body.success).toBe(false);
    });

    it('rejects duplicate signer', async () => {
      // W-004: Returns 400 INVALID_PARAMETERS (not 409) — oracle-resistant,
      // indistinguishable from other validation errors (matches Tree 1 pattern).
      const { status, body } = await invoke(
        '/v1/engagement/register',
        'POST',
        {
          signerAddress: '0x' + 'a'.repeat(40),
          identityCommitment: '0x' + '2'.padStart(64, '0'),
        },
        { authorization: `Bearer ${AUTH_TOKEN}` },
      );
      expect(status).toBe(400);
      expect(body.success).toBe(false);
    });

    it('rejects without auth', async () => {
      const { status } = await invoke(
        '/v1/engagement/register',
        'POST',
        {
          signerAddress: '0x' + 'c'.repeat(40),
          identityCommitment: '0x' + '3'.padStart(64, '0'),
        },
      );
      expect(status).toBe(401);
    });

    it('rejects with wrong auth token', async () => {
      const { status } = await invoke(
        '/v1/engagement/register',
        'POST',
        {
          signerAddress: '0x' + 'c'.repeat(40),
          identityCommitment: '0x' + '3'.padStart(64, '0'),
        },
        { authorization: 'Bearer wrong-token' },
      );
      expect(status).toBe(403);
    });

    it('rejects invalid signer address', async () => {
      const { status, body } = await invoke(
        '/v1/engagement/register',
        'POST',
        {
          signerAddress: 'not-an-address',
          identityCommitment: '0x' + '4'.padStart(64, '0'),
        },
        { authorization: `Bearer ${AUTH_TOKEN}` },
      );
      expect(status).toBe(400);
      expect(body.success).toBe(false);
    });

    it('rejects zero identityCommitment', async () => {
      const { status, body } = await invoke(
        '/v1/engagement/register',
        'POST',
        {
          signerAddress: '0x' + 'd'.repeat(40),
          identityCommitment: '0x0',
        },
        { authorization: `Bearer ${AUTH_TOKEN}` },
      );
      expect(status).toBe(400);
      expect(body.success).toBe(false);
    });
  });

  // ========================================================================
  // GET /v1/engagement-path/:leafIndex
  // ========================================================================

  describe('GET /v1/engagement-path/:leafIndex', () => {
    it('returns proof for registered leaf', async () => {
      const { status, body } = await invoke('/v1/engagement-path/0');
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      const d = body.data as Record<string, unknown>;
      expect(d.leafIndex).toBe(0);
      expect(d.engagementRoot).toMatch(/^0x[0-9a-f]+$/);
      expect(d.engagementPath).toHaveLength(4);
      expect(d.pathIndices).toHaveLength(4);
      expect(d.tier).toBe(0);
    });

    it('returns 404 for out-of-range index', async () => {
      const { status, body } = await invoke('/v1/engagement-path/999');
      expect(status).toBe(404);
      expect(body.success).toBe(false);
    });
  });

  // ========================================================================
  // GET /v1/engagement-metrics/:identityCommitment
  // ========================================================================

  describe('GET /v1/engagement-metrics/:identityCommitment', () => {
    it('returns metrics for registered identity', async () => {
      const ic = '0x' + '1'.padStart(64, '0');
      const { status, body } = await invoke(`/v1/engagement-metrics/${ic}`);
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      const d = body.data as Record<string, unknown>;
      expect(d.tier).toBe(0);
      expect(d.actionCount).toBe(0);
      expect(d.diversityScore).toBe(0);
      expect(d.tenureMonths).toBe(0);
    });

    it('returns 404 for unregistered identity', async () => {
      const { status, body } = await invoke('/v1/engagement-metrics/0xdeadbeef');
      expect(status).toBe(404);
      expect(body.success).toBe(false);
    });
  });

  // ========================================================================
  // Engagement-info without service (unavailable)
  // ========================================================================

  describe('without engagement service', () => {
    it('engagement-info returns available=false', async () => {
      const bareApi = new ShadowAtlasAPI(
        createMockLookupService() as any,
        createMockProofService() as any,
        createMockSyncService() as any,
        3098,
      );
      const req = createMockRequest('/v1/engagement-info');
      const { res, getStatus, getBody } = createMockResponse();
      await (bareApi as any).handleRequest(req, res);
      expect(getStatus()).toBe(200);
      const body = getBody() as Record<string, unknown>;
      const d = (body as any).data;
      expect(d.available).toBe(false);
    });

    it('engagement-path returns 501', async () => {
      const bareApi = new ShadowAtlasAPI(
        createMockLookupService() as any,
        createMockProofService() as any,
        createMockSyncService() as any,
        3098,
      );
      const req = createMockRequest('/v1/engagement-path/0');
      const { res, getStatus, getBody } = createMockResponse();
      await (bareApi as any).handleRequest(req, res);
      expect(getStatus()).toBe(501);
    });
  });
});
