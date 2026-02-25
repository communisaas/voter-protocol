/**
 * Cell Proof Endpoint Tests (Real CellMapState)
 *
 * Tests GET /v1/cell-proof and GET /v1/cell-map-info using a REAL
 * CellMapState built from buildCellMapTree + generateMockMappings.
 * No mocked SMT — the sparse Merkle tree is real Poseidon2 hashing.
 *
 * Coverage:
 * - 501 when cellMapState is null
 * - 400 for missing cell_id
 * - 404 for unknown cell_id
 * - 200 with valid proof structure for known cell_id
 * - District values match original mappings
 * - cell-map-info metadata endpoint
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { ShadowAtlasAPI } from '../../../serving/api.js';
import { RegistrationService, type CellMapState } from '../../../serving/registration-service.js';
import {
  buildCellMapTree,
  toCellMapState,
  DISTRICT_SLOT_COUNT,
  type CellDistrictMapping,
} from '../../../tree-builder.js';
import { generateMockMappings } from '../../../cell-district-loader.js';
import type { IncomingMessage, ServerResponse } from 'http';

// ============================================================================
// Test Helpers
// ============================================================================

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

  const res = {
    writeHead: vi.fn((status: number, hdrs?: Record<string, string | string[]>) => {
      statusCode = status;
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

  Object.defineProperty(res, 'statusCode', {
    get: () => statusCode,
    set: (v: number) => { statusCode = v; },
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

function createMockLookupService() {
  return {
    lookup: vi.fn(),
    close: vi.fn(),
    clearCache: vi.fn(),
    getMetrics: vi.fn().mockReturnValue({
      cacheHits: 0, cacheMisses: 0, totalQueries: 0, hitRate: 0,
    }),
  };
}

function createMockProofService() {
  return {
    generateProof: vi.fn().mockResolvedValue({
      root: '0x1234', leaf: '0xabcd', siblings: [], pathIndices: [],
    }),
  };
}

function createMockSyncService() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    getLatestSnapshot: vi.fn().mockResolvedValue(null),
    listSnapshots: vi.fn().mockResolvedValue([]),
    notifyInsertion: vi.fn(),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('GET /v1/cell-proof (real CellMapState)', () => {
  const TREE_DEPTH = 20;
  const MAPPING_COUNT = 5;

  let cellMapState: CellMapState;
  let mappings: CellDistrictMapping[];
  let registrationService: RegistrationService;

  beforeAll(async () => {
    // Build a real CellMapState from mock mappings with real Poseidon2 hashing
    mappings = generateMockMappings(MAPPING_COUNT, '06');
    const treeResult = await buildCellMapTree(mappings, TREE_DEPTH);
    cellMapState = toCellMapState(treeResult);
    registrationService = await RegistrationService.create(4);
  }, 120_000); // WASM init can be slow

  function createAPI(overrideCellMapState?: CellMapState | null): ShadowAtlasAPI {
    return new ShadowAtlasAPI(
      createMockLookupService() as any,
      createMockProofService() as any,
      createMockSyncService() as any,
      3000,
      '0.0.0.0',
      ['*'],
      60,
      { version: 'v1', deprecated: false },
      registrationService,
      overrideCellMapState === undefined ? cellMapState : overrideCellMapState,
      null, // no auth token needed for cell-proof
    );
  }

  it('returns 501 when cellMapState is null', async () => {
    const api = createAPI(null);
    const req = createMockRequest(`/v1/cell-proof?cell_id=${mappings[0].cellId.toString()}`);
    const { res, getStatus, getBody } = createMockResponse();

    await (api as any).handleRequest(req, res);

    expect(getStatus()).toBe(501);
    const body = getBody() as any;
    expect(body.error?.code).toBe('CELL_PROOF_UNAVAILABLE');
  });

  it('returns 400 for missing cell_id', async () => {
    const api = createAPI();
    const req = createMockRequest('/v1/cell-proof');
    const { res, getStatus, getBody } = createMockResponse();

    await (api as any).handleRequest(req, res);

    expect(getStatus()).toBe(400);
    const body = getBody() as any;
    expect(body.error?.code).toBe('INVALID_PARAMETERS');
  });

  it('returns 404 for unknown cell_id', async () => {
    const api = createAPI();
    const req = createMockRequest('/v1/cell-proof?cell_id=99999999999');
    const { res, getStatus, getBody } = createMockResponse();

    await (api as any).handleRequest(req, res);

    expect(getStatus()).toBe(404);
    const body = getBody() as any;
    expect(body.error?.code).toBe('CELL_NOT_FOUND');
  });

  it('returns valid proof for known cell_id', async () => {
    const api = createAPI();
    const cellId = mappings[0].cellId.toString();
    const req = createMockRequest(`/v1/cell-proof?cell_id=${cellId}`);
    const { res, getStatus, getBody } = createMockResponse();

    await (api as any).handleRequest(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as any;
    expect(body.success).toBe(true);

    const data = body.data;

    // cellMapRoot is a hex string
    expect(data.cellMapRoot).toMatch(/^0x[0-9a-f]+$/);

    // cellMapPath has `depth` elements (SMT siblings)
    expect(Array.isArray(data.cellMapPath)).toBe(true);
    expect(data.cellMapPath).toHaveLength(TREE_DEPTH);

    // cellMapPathBits has `depth` elements
    expect(Array.isArray(data.cellMapPathBits)).toBe(true);
    expect(data.cellMapPathBits).toHaveLength(TREE_DEPTH);

    // districts has DISTRICT_SLOT_COUNT (24) elements
    expect(Array.isArray(data.districts)).toBe(true);
    expect(data.districts).toHaveLength(DISTRICT_SLOT_COUNT);

    // All districts values are hex strings
    for (const d of data.districts) {
      expect(d).toMatch(/^0x[0-9a-f]+$/);
    }
  });

  it('returns correct districts for the cell', async () => {
    const api = createAPI();
    const targetMapping = mappings[0];
    const cellId = targetMapping.cellId.toString();
    const req = createMockRequest(`/v1/cell-proof?cell_id=${cellId}`);
    const { res, getStatus, getBody } = createMockResponse();

    await (api as any).handleRequest(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as any;
    const returnedDistricts: string[] = body.data.districts;

    // Convert original mapping districts to hex for comparison
    const expectedDistricts = targetMapping.districts.map((d) => '0x' + d.toString(16));

    expect(returnedDistricts).toEqual(expectedDistricts);
  });

  it('returns valid proof for each mapping', async () => {
    const api = createAPI();

    for (const mapping of mappings) {
      const cellId = mapping.cellId.toString();
      const req = createMockRequest(`/v1/cell-proof?cell_id=${cellId}`);
      // Use unique IPs to avoid rate limiter
      (req as any).socket = { remoteAddress: `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}` };
      const { res, getStatus, getBody } = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(getStatus()).toBe(200);
      const body = getBody() as any;
      expect(body.success).toBe(true);
      expect(body.data.cellMapPath).toHaveLength(TREE_DEPTH);
      expect(body.data.districts).toHaveLength(DISTRICT_SLOT_COUNT);
    }
  });
});

describe('GET /v1/cell-map-info', () => {
  const TREE_DEPTH = 20;
  const MAPPING_COUNT = 5;

  let cellMapState: CellMapState;
  let registrationService: RegistrationService;

  beforeAll(async () => {
    const mappings = generateMockMappings(MAPPING_COUNT, '06');
    const treeResult = await buildCellMapTree(mappings, TREE_DEPTH);
    cellMapState = toCellMapState(treeResult);
    registrationService = await RegistrationService.create(4);
  }, 120_000);

  it('returns metadata when cellMapState is configured', async () => {
    const api = new ShadowAtlasAPI(
      createMockLookupService() as any,
      createMockProofService() as any,
      createMockSyncService() as any,
      3000, '0.0.0.0', ['*'], 60,
      { version: 'v1', deprecated: false },
      registrationService,
      cellMapState,
      null,
    );

    const req = createMockRequest('/v1/cell-map-info');
    const { res, getStatus, getBody } = createMockResponse();

    await (api as any).handleRequest(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as any;
    expect(body.success).toBe(true);
    expect(body.data.available).toBe(true);
    expect(body.data.root).toMatch(/^0x[0-9a-f]+$/);
    expect(body.data.depth).toBe(TREE_DEPTH);
    expect(body.data.cellCount).toBe(MAPPING_COUNT);
  });

  it('returns available:false when cellMapState is not configured', async () => {
    const api = new ShadowAtlasAPI(
      createMockLookupService() as any,
      createMockProofService() as any,
      createMockSyncService() as any,
      3000, '0.0.0.0', ['*'], 60,
      { version: 'v1', deprecated: false },
      registrationService,
      null, // no cellMapState
      null,
    );

    const req = createMockRequest('/v1/cell-map-info');
    const { res, getStatus, getBody } = createMockResponse();

    await (api as any).handleRequest(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as any;
    expect(body.success).toBe(true);
    expect(body.data.available).toBe(false);
  });
});
