/**
 * Registration Endpoint Tests
 *
 * Tests POST /v1/register and GET /v1/cell-proof endpoints via the
 * ShadowAtlasAPI HTTP handler. Uses real RegistrationService (no mocks
 * for crypto) but mocked HTTP request/response objects.
 *
 * Coverage:
 * - CR-004: Bearer token authentication
 * - Rate limiting (5 req/min per IP for registration)
 * - Input validation (Zod schema, BN254 bounds)
 * - Duplicate leaf rejection
 * - Tree capacity handling
 * - Response format compliance
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ShadowAtlasAPI } from '../../../serving/api';
import { RegistrationService, type CellMapState } from '../../../serving/registration-service';
import type { IncomingMessage, ServerResponse } from 'http';

// ============================================================================
// Test Helpers
// ============================================================================

const BN254_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const TEST_AUTH_TOKEN = 'test-registration-secret-token-2026';
const VALID_LEAF = '0x' + '1234567890abcdef'.repeat(4);
const VALID_CELL_ID = '6075061200'; // No leading zero — BigInt(x).toString() normalizes

function makeLeaf(i: number): string {
  return '0x' + i.toString(16).padStart(64, '0');
}

/** Mock CellMapState for cell-proof endpoint */
function createMockCellMapState(): CellMapState {
  const districtMap = new Map<string, readonly bigint[]>();
  // Add a known cell for testing — key must match BigInt(cellId).toString()
  districtMap.set(VALID_CELL_ID, Array(24).fill(0n) as readonly bigint[]);

  return {
    tree: {
      getProof: vi.fn().mockResolvedValue({
        siblings: Array(20).fill(0n),
        pathBits: Array(20).fill(0),
      }),
    } as any,
    root: 0xaan,
    commitments: new Map(),
    districtMap,
    depth: 20,
  };
}

function createMockLookupService() {
  return { lookup: vi.fn(), close: vi.fn(), clearCache: vi.fn(), getMetrics: vi.fn().mockReturnValue({ cacheHits: 0, cacheMisses: 0, totalQueries: 0, hitRate: 0 }) };
}

function createMockProofService() {
  return { generateProof: vi.fn().mockResolvedValue({ root: '0x1234', leaf: '0xabcd', siblings: [], pathIndices: [] }) };
}

function createMockSyncService() {
  return { start: vi.fn(), stop: vi.fn(), getLatestSnapshot: vi.fn().mockResolvedValue(null), listSnapshots: vi.fn().mockResolvedValue([]) };
}

function createMockRequest(
  url: string,
  method = 'GET',
  body?: string,
  headers: Record<string, string> = {},
): IncomingMessage {
  const chunks: Buffer[] = body ? [Buffer.from(body)] : [];
  const req = {
    url,
    method,
    headers: { host: 'localhost:3000', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
    on(event: string, cb: (arg?: unknown) => void) {
      if (event === 'data') {
        chunks.forEach((c) => cb(c));
      }
      if (event === 'end') {
        cb();
      }
      if (event === 'error') {
        // no-op
      }
      return req;
    },
  } as unknown as IncomingMessage;
  return req;
}

function createMockResponse(): {
  res: ServerResponse;
  getStatus: () => number;
  getBody: () => unknown;
  getHeaders: () => Record<string, string | string[]>;
} {
  let statusCode = 200;
  const headers: Record<string, string | string[]> = {};
  let body = '';

  let headersSent = false;
  const res = {
    headersSent: false,
    socket: { writableEnded: false, destroyed: false },
    writeHead: vi.fn((status: number, hdrs?: Record<string, string | string[]>) => {
      statusCode = status;
      headersSent = true;
      if (hdrs) Object.entries(hdrs).forEach(([k, v]) => { headers[k.toLowerCase()] = v; });
      return res;
    }),
    setHeader: vi.fn((name: string, value: string | string[]) => {
      headers[name.toLowerCase()] = value;
      return res;
    }),
    getHeader: vi.fn((name: string) => {
      return headers[name.toLowerCase()];
    }),
    end: vi.fn((data?: string) => {
      if (data) body = data;
    }),
    write: vi.fn((data: string) => {
      body += data;
      return true;
    }),
    statusCode: 200,
  } as unknown as ServerResponse;

  // Sync statusCode and headersSent properties with writeHead calls
  Object.defineProperty(res, 'statusCode', {
    get: () => statusCode,
    set: (v: number) => { statusCode = v; },
  });
  Object.defineProperty(res, 'headersSent', {
    get: () => headersSent,
  });

  return {
    res,
    getStatus: () => statusCode,
    getHeaders: () => headers,
    getBody: () => {
      try { return JSON.parse(body); } catch { return body; }
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('POST /v1/register', () => {
  let api: ShadowAtlasAPI;
  let registrationService: RegistrationService;

  beforeEach(async () => {
    registrationService = await RegistrationService.create(4); // depth=4 for fast tests

    api = new ShadowAtlasAPI(
      createMockLookupService() as any,
      createMockProofService() as any,
      createMockSyncService() as any,
      3000,
      '0.0.0.0',
      ['*'],
      60,
      { version: 'v1', deprecated: false },
      registrationService,
      createMockCellMapState() as any,
      TEST_AUTH_TOKEN,
    );
  });

  describe('CR-004: Authentication', () => {
    it('rejects requests without Authorization header', async () => {
      const req = createMockRequest('/v1/register', 'POST',
        JSON.stringify({ leaf: VALID_LEAF }),
        { 'content-type': 'application/json' },
      );
      const { res, getStatus, getBody } = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(getStatus()).toBe(401);
      const body = getBody() as any;
      expect(body.error?.code).toBe('UNAUTHORIZED');
    });

    it('rejects requests with wrong token', async () => {
      const req = createMockRequest('/v1/register', 'POST',
        JSON.stringify({ leaf: VALID_LEAF }),
        {
          'content-type': 'application/json',
          authorization: 'Bearer wrong-token',
        },
      );
      const { res, getStatus, getBody } = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(getStatus()).toBe(403);
      const body = getBody() as any;
      expect(body.error?.code).toBe('FORBIDDEN');
    });

    it('accepts requests with correct token', async () => {
      const req = createMockRequest('/v1/register', 'POST',
        JSON.stringify({ leaf: VALID_LEAF }),
        {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        },
      );
      const { res, getStatus, getBody } = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(getStatus()).toBe(200);
      const body = getBody() as any;
      expect(body.success).toBe(true);
      expect(body.data.leafIndex).toBe(0);
    });

    it('skips auth when no token configured (backward compat)', async () => {
      const noAuthApi = new ShadowAtlasAPI(
        createMockLookupService() as any,
        createMockProofService() as any,
        createMockSyncService() as any,
        3000, '0.0.0.0', ['*'], 60,
        { version: 'v1', deprecated: false },
        registrationService,
        createMockCellMapState() as any,
        null, // no auth token
      );

      const req = createMockRequest('/v1/register', 'POST',
        JSON.stringify({ leaf: VALID_LEAF }),
        { 'content-type': 'application/json' },
      );
      const { res, getStatus, getBody } = createMockResponse();

      await (noAuthApi as any).handleRequest(req, res);

      expect(getStatus()).toBe(200);
      const body = getBody() as any;
      expect(body.success).toBe(true);
    });
  });

  describe('CR-004: Authentication edge cases', () => {
    it('rejects empty Bearer token', async () => {
      const req = createMockRequest('/v1/register', 'POST',
        JSON.stringify({ leaf: VALID_LEAF }),
        {
          'content-type': 'application/json',
          authorization: 'Bearer ',
        },
      );
      const { res, getStatus } = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(getStatus()).toBe(403);
    });

    it('rejects non-Bearer scheme', async () => {
      const req = createMockRequest('/v1/register', 'POST',
        JSON.stringify({ leaf: VALID_LEAF }),
        {
          'content-type': 'application/json',
          authorization: 'Basic dGVzdDp0ZXN0',
        },
      );
      const { res, getStatus } = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(getStatus()).toBe(401);
    });
  });

  describe('Rate limiting', () => {
    it('returns 429 after 5 requests from same IP', async () => {
      // Send 5 requests (should all succeed or fail on validation, not rate limit)
      for (let i = 0; i < 5; i++) {
        const req = createMockRequest('/v1/register', 'POST',
          JSON.stringify({ leaf: makeLeaf(i + 100) }),
          {
            'content-type': 'application/json',
            authorization: `Bearer ${TEST_AUTH_TOKEN}`,
          },
        );
        const { res } = createMockResponse();
        await (api as any).handleRequest(req, res);
      }

      // 6th request should be rate limited
      const req = createMockRequest('/v1/register', 'POST',
        JSON.stringify({ leaf: makeLeaf(200) }),
        {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        },
      );
      const { res, getStatus, getBody } = createMockResponse();
      await (api as any).handleRequest(req, res);

      expect(getStatus()).toBe(429);
      const body = getBody() as any;
      expect(body.error?.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  describe('Input validation', () => {
    it('rejects non-JSON content type', async () => {
      const req = createMockRequest('/v1/register', 'POST',
        JSON.stringify({ leaf: VALID_LEAF }),
        {
          'content-type': 'text/plain',
          authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        },
      );
      const { res, getStatus } = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(getStatus()).toBe(415);
    });

    it('rejects missing leaf field', async () => {
      const req = createMockRequest('/v1/register', 'POST',
        JSON.stringify({}),
        {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        },
      );
      const { res, getStatus } = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(getStatus()).toBe(400);
    });

    it('rejects non-hex leaf', async () => {
      const req = createMockRequest('/v1/register', 'POST',
        JSON.stringify({ leaf: 'not-a-hex-string' }),
        {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        },
      );
      const { res, getStatus } = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(getStatus()).toBe(400);
    });

    it('rejects leaf value at BN254 modulus', async () => {
      const modulusHex = '0x' + BN254_MODULUS.toString(16).padStart(64, '0');
      const req = createMockRequest('/v1/register', 'POST',
        JSON.stringify({ leaf: modulusHex }),
        {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        },
      );
      const { res, getStatus } = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(getStatus()).toBe(400);
    });

    it('rejects leaf value at 2^256 - 1', async () => {
      const maxUint256 = '0x' + 'f'.repeat(64);
      const req = createMockRequest('/v1/register', 'POST',
        JSON.stringify({ leaf: maxUint256 }),
        {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        },
      );
      const { res, getStatus } = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(getStatus()).toBe(400);
    });

    it('rejects zero leaf', async () => {
      const zeroLeaf = '0x' + '0'.repeat(64);
      const req = createMockRequest('/v1/register', 'POST',
        JSON.stringify({ leaf: zeroLeaf }),
        {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        },
      );
      const { res, getStatus } = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(getStatus()).toBe(400);
    });
  });

  describe('Registration flow', () => {
    it('returns leafIndex, userRoot, userPath, pathIndices', async () => {
      const req = createMockRequest('/v1/register', 'POST',
        JSON.stringify({ leaf: VALID_LEAF }),
        {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        },
      );
      const { res, getStatus, getBody } = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(getStatus()).toBe(200);
      const body = getBody() as any;
      expect(body.success).toBe(true);
      expect(typeof body.data.leafIndex).toBe('number');
      expect(body.data.userRoot).toMatch(/^0x[0-9a-f]+$/);
      expect(Array.isArray(body.data.userPath)).toBe(true);
      expect(body.data.userPath).toHaveLength(4); // depth=4
      expect(Array.isArray(body.data.pathIndices)).toBe(true);
      expect(body.data.pathIndices).toHaveLength(4);
    });

    it('assigns sequential leaf indices', async () => {
      for (let i = 0; i < 3; i++) {
        const req = createMockRequest('/v1/register', 'POST',
          JSON.stringify({ leaf: makeLeaf(i + 1) }),
          {
            'content-type': 'application/json',
            authorization: `Bearer ${TEST_AUTH_TOKEN}`,
          },
        );
        const { res, getBody } = createMockResponse();
        await (api as any).handleRequest(req, res);
        const body = getBody() as any;
        expect(body.data.leafIndex).toBe(i);
      }
    });

    it('rejects duplicate leaf', async () => {
      // First registration succeeds
      const req1 = createMockRequest('/v1/register', 'POST',
        JSON.stringify({ leaf: VALID_LEAF }),
        {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        },
      );
      const { res: res1 } = createMockResponse();
      await (api as any).handleRequest(req1, res1);

      // Second registration with same leaf should fail
      const req2 = createMockRequest('/v1/register', 'POST',
        JSON.stringify({ leaf: VALID_LEAF }),
        {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        },
      );
      const { res: res2, getStatus, getBody } = createMockResponse();
      await (api as any).handleRequest(req2, res2);

      // CR-006: Duplicate returns 400 (not 409) — indistinguishable from
      // other validation errors to prevent registration oracle attacks
      expect(getStatus()).toBe(400);
      const body = getBody() as any;
      expect(body.error?.code).toBe('INVALID_PARAMETERS');
    });

    it('rejects when tree is full', async () => {
      // Fill tree (depth=4 → 16 leaves)
      // Use different source IPs to avoid 5/min rate limiter
      for (let i = 1; i <= 16; i++) {
        const req = createMockRequest('/v1/register', 'POST',
          JSON.stringify({ leaf: makeLeaf(i) }),
          {
            'content-type': 'application/json',
            authorization: `Bearer ${TEST_AUTH_TOKEN}`,
          },
        );
        // Bypass rate limiter by using unique IPs
        (req as any).socket = { remoteAddress: `10.0.0.${i}` };
        const { res } = createMockResponse();
        await (api as any).handleRequest(req, res);
      }

      // 17th should fail with TREE_FULL
      const req = createMockRequest('/v1/register', 'POST',
        JSON.stringify({ leaf: makeLeaf(17) }),
        {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        },
      );
      (req as any).socket = { remoteAddress: '10.0.0.17' };
      const { res, getStatus, getBody } = createMockResponse();
      await (api as any).handleRequest(req, res);

      expect(getStatus()).toBe(503);
      const body = getBody() as any;
      expect(body.error?.code).toBe('TREE_FULL');
    });
  });
});

describe('GET /v1/cell-proof', () => {
  let api: ShadowAtlasAPI;
  let mockCellMapState: CellMapState;

  beforeEach(async () => {
    mockCellMapState = createMockCellMapState();
    const registrationService = await RegistrationService.create(4);

    api = new ShadowAtlasAPI(
      createMockLookupService() as any,
      createMockProofService() as any,
      createMockSyncService() as any,
      3000, '0.0.0.0', ['*'], 60,
      { version: 'v1', deprecated: false },
      registrationService,
      mockCellMapState as any,
      null,
    );
  });

  it('returns cell proof for valid cell_id', async () => {
    const req = createMockRequest(`/v1/cell-proof?cell_id=${VALID_CELL_ID}`);
    const { res, getStatus, getBody } = createMockResponse();

    await (api as any).handleRequest(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as any;
    expect(body.success).toBe(true);
    expect(body.data.cellMapRoot).toBeDefined();
    expect(body.data.cellMapPath).toBeDefined();
    expect(body.data.districts).toBeDefined();
    expect(body.data.districts).toHaveLength(24);
  });

  it('returns 400 for missing cell_id parameter', async () => {
    const req = createMockRequest('/v1/cell-proof');
    const { res, getStatus } = createMockResponse();

    await (api as any).handleRequest(req, res);

    expect(getStatus()).toBe(400);
  });

  it('returns 404 when cell not found', async () => {
    // Use a cell_id that is NOT in the districtMap
    const req = createMockRequest('/v1/cell-proof?cell_id=9999999999');
    const { res, getStatus, getBody } = createMockResponse();

    await (api as any).handleRequest(req, res);

    expect(getStatus()).toBe(404);
    const body = getBody() as any;
    expect(body.error?.code).toBe('CELL_NOT_FOUND');
  });
});

describe('registration receipts (BR7-009)', () => {
  let api: ShadowAtlasAPI;
  let registrationService: RegistrationService;
  let signer: any; // ServerSigner

  beforeEach(async () => {
    // Import ServerSigner dynamically
    const { ServerSigner } = await import('../../../serving/signing.js');
    signer = await ServerSigner.init(); // ephemeral key, no persistence

    registrationService = await RegistrationService.create(4); // depth=4

    // Create mock sync service with notifyInsertion
    const mockSyncService = {
      start: vi.fn(),
      stop: vi.fn(),
      getLatestSnapshot: vi.fn().mockResolvedValue(null),
      listSnapshots: vi.fn().mockResolvedValue([]),
      notifyInsertion: vi.fn(), // BR7-009: required for receipt tests
    };

    api = new ShadowAtlasAPI(
      createMockLookupService() as any,
      createMockProofService() as any,
      mockSyncService as any,
      3000,
      '0.0.0.0',
      ['*'],
      60,
      { version: 'v1', deprecated: false },
      registrationService,
      createMockCellMapState() as any,
      TEST_AUTH_TOKEN,
      signer, // Pass signer to API
    );
  });

  it('returns receipt with data and sig fields', async () => {
    const req = createMockRequest('/v1/register', 'POST',
      JSON.stringify({ leaf: VALID_LEAF }),
      {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_AUTH_TOKEN}`,
      },
    );
    const { res, getStatus, getBody } = createMockResponse();

    await (api as any).handleRequest(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as any;
    expect(body.success).toBe(true);
    expect(body.data.receipt).toBeDefined();
    expect(typeof body.data.receipt.data).toBe('string');
    expect(typeof body.data.receipt.sig).toBe('string');
  });

  it('receipt signature is valid', async () => {
    const req = createMockRequest('/v1/register', 'POST',
      JSON.stringify({ leaf: VALID_LEAF }),
      {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_AUTH_TOKEN}`,
      },
    );
    const { res, getStatus, getBody } = createMockResponse();

    await (api as any).handleRequest(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as any;
    const { receipt } = body.data;

    // Verify signature using the signer's public key
    const isValid = signer.verify(receipt.data, receipt.sig);
    expect(isValid).toBe(true);
  });

  it('receipt data contains leafIndex, leaf, userRoot, ts', async () => {
    const req = createMockRequest('/v1/register', 'POST',
      JSON.stringify({ leaf: VALID_LEAF }),
      {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_AUTH_TOKEN}`,
      },
    );
    const { res, getStatus, getBody } = createMockResponse();

    await (api as any).handleRequest(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as any;
    const { receipt } = body.data;

    // Parse receipt data
    const receiptData = JSON.parse(receipt.data);

    expect(typeof receiptData.leafIndex).toBe('number');
    expect(receiptData.leafIndex).toBe(0); // First registration
    expect(receiptData.leaf).toBe(VALID_LEAF);
    expect(typeof receiptData.userRoot).toBe('string');
    expect(receiptData.userRoot).toMatch(/^0x[0-9a-f]+$/);
    expect(typeof receiptData.ts).toBe('number');
    expect(receiptData.ts).toBeGreaterThan(0);
  });

  it('no receipt when signer not configured', async () => {
    // Create API without signer
    const noSignerApi = new ShadowAtlasAPI(
      createMockLookupService() as any,
      createMockProofService() as any,
      createMockSyncService() as any,
      3000,
      '0.0.0.0',
      ['*'],
      60,
      { version: 'v1', deprecated: false },
      registrationService,
      createMockCellMapState() as any,
      TEST_AUTH_TOKEN,
      undefined, // No signer
    );

    const req = createMockRequest('/v1/register', 'POST',
      JSON.stringify({ leaf: makeLeaf(999) }), // Different leaf to avoid duplicate
      {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_AUTH_TOKEN}`,
      },
    );
    const { res, getStatus, getBody } = createMockResponse();

    await (noSignerApi as any).handleRequest(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as any;
    expect(body.success).toBe(true);
    expect(body.data.receipt).toBeUndefined();
  });
});
