/**
 * End-to-End Proof Path Test (Two-Tree Subset)
 *
 * NOTE: This test validates the two-tree subset of the three-tree pipeline.
 * Trees 1 and 2 are shared by both proof paths. A three-tree e2e test
 * should additionally exercise Tree 3 (Engagement) via EngagementService.
 *
 * Validates the complete two-tree proof pipeline:
 *   1. Build CellMapState from mock data
 *   2. Register a user (insert leaf into Tree 1)
 *   3. POST /v1/register → get Tree 1 proof
 *   4. GET /v1/cell-proof → get Tree 2 proof
 *   5. Combine into TwoTreeProofInput format
 *   6. Verify format matches what the Noir circuit expects
 *
 * Does NOT run the actual Noir prover (requires nargo/bb) — validates
 * that all serving layer pieces connect and produce correct input format.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { ShadowAtlasAPI } from '../../../serving/api';
import { RegistrationService, type CellMapState } from '../../../serving/registration-service';
import { buildCellMapTree, toCellMapState, DISTRICT_SLOT_COUNT } from '../../../tree-builder';
import { generateMockMappings } from '../../../cell-district-loader';
import type { CellDistrictMapping } from '../../../tree-builder';
import type { IncomingMessage, ServerResponse } from 'http';

// ============================================================================
// Test Helpers
// ============================================================================

const TEST_AUTH_TOKEN = 'e2e-test-token-2026';
// Shallower than prod depth (20) — test validates proof shape & two-tree
// wiring; Noir-WASM Poseidon2 at depth 20 costs ~90s per beforeAll.
const TREE_DEPTH = 10;

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
  getBody: () => any;
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
    getHeader: vi.fn((name: string) => headers[name.toLowerCase()]),
    end: vi.fn((data?: string) => { if (data) body = data; }),
    write: vi.fn((data: string) => { body += data; return true; }),
    statusCode: 200,
  } as unknown as ServerResponse;

  Object.defineProperty(res, 'statusCode', {
    get: () => statusCode,
    set: (v: number) => { statusCode = v; },
  });

  return {
    res,
    getStatus: () => statusCode,
    getBody: () => { try { return JSON.parse(body); } catch { return body; } },
  };
}

function createMockLookupService() {
  return {
    lookup: vi.fn(),
    close: vi.fn(),
    clearCache: vi.fn(),
    getMetrics: vi.fn().mockReturnValue({ cacheHits: 0, cacheMisses: 0, totalQueries: 0, hitRate: 0 }),
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

describe('End-to-End Proof Path', () => {
  let cellMapState: CellMapState;
  let mappings: CellDistrictMapping[];
  let api: ShadowAtlasAPI;
  let registrationService: RegistrationService;

  beforeAll(async () => {
    // Build Tree 2 from mock data (5 cells, CA)
    mappings = generateMockMappings(5, '06');
    const treeResult = await buildCellMapTree(mappings, TREE_DEPTH);
    cellMapState = toCellMapState(treeResult);

    // Create Tree 1 (registration service)
    registrationService = await RegistrationService.create(TREE_DEPTH);

    // Create API with both trees
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
      cellMapState,
      TEST_AUTH_TOKEN,
    );
  }, 120_000);

  it('should complete full register → cell-proof → format pipeline', async () => {
    // Step 1: Register a user leaf (compute a deterministic leaf hash)
    const userSecret = 12345n;
    const cellId = mappings[0].cellId;
    const registrationSalt = 99999n;

    // Compute the leaf: H3(userSecret, cellId, registrationSalt)
    const { getHasher } = await import('@voter-protocol/crypto/poseidon2');
    const hasher = await getHasher();
    const leaf = await hasher.hash3(userSecret, cellId, registrationSalt);
    const leafHex = '0x' + leaf.toString(16).padStart(64, '0');

    // POST /v1/register
    const registerReq = createMockRequest('/v1/register', 'POST',
      JSON.stringify({ leaf: leafHex }),
      {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_AUTH_TOKEN}`,
      },
    );
    const registerResp = createMockResponse();

    await (api as any).handleRequest(registerReq, registerResp.res);

    expect(registerResp.getStatus()).toBe(200);
    const registerBody = registerResp.getBody();
    expect(registerBody.success).toBe(true);
    expect(registerBody.data.leafIndex).toBe(0);
    expect(registerBody.data.userRoot).toMatch(/^0x[0-9a-f]+$/);
    expect(registerBody.data.userPath).toHaveLength(TREE_DEPTH);
    expect(registerBody.data.pathIndices).toHaveLength(TREE_DEPTH);

    // Step 2: GET /v1/cell-proof for the user's cell
    const cellIdStr = cellId.toString();
    const cellProofReq = createMockRequest(
      `/v1/cell-proof?cell_id=${cellIdStr}`,
    );
    const cellProofResp = createMockResponse();

    await (api as any).handleRequest(cellProofReq, cellProofResp.res);

    expect(cellProofResp.getStatus()).toBe(200);
    const cellProofBody = cellProofResp.getBody();
    expect(cellProofBody.success).toBe(true);
    expect(cellProofBody.data.cellMapRoot).toMatch(/^0x[0-9a-f]+$/);
    expect(cellProofBody.data.cellMapPath).toHaveLength(TREE_DEPTH);
    expect(cellProofBody.data.cellMapPathBits).toHaveLength(TREE_DEPTH);
    expect(cellProofBody.data.districts).toHaveLength(DISTRICT_SLOT_COUNT);

    // Step 3: Combine into TwoTreeProofInput format
    const twoTreeInput = {
      // Public inputs
      userRoot: BigInt(registerBody.data.userRoot),
      cellMapRoot: BigInt(cellProofBody.data.cellMapRoot),
      districts: cellProofBody.data.districts.map((d: string) => BigInt(d)),
      nullifier: 0n,          // Would come from H2(identityCommitment, actionDomain)
      actionDomain: 1n,       // Example action domain
      authorityLevel: 1,      // CWC tier

      // Private inputs
      userSecret,
      cellId,
      registrationSalt,
      identityCommitment: 42n, // Placeholder for test

      // Tree 1 proof
      userPath: registerBody.data.userPath.map((s: string) => BigInt(s)),
      userIndex: registerBody.data.leafIndex,

      // Tree 2 proof
      cellMapPath: cellProofBody.data.cellMapPath.map((s: string) => BigInt(s)),
      cellMapPathBits: cellProofBody.data.cellMapPathBits,
    };

    // Verify format matches TwoTreeProofInput schema
    expect(typeof twoTreeInput.userRoot).toBe('bigint');
    expect(typeof twoTreeInput.cellMapRoot).toBe('bigint');
    expect(twoTreeInput.districts).toHaveLength(DISTRICT_SLOT_COUNT);
    expect(twoTreeInput.districts.every((d: bigint) => typeof d === 'bigint')).toBe(true);
    expect(twoTreeInput.userPath).toHaveLength(TREE_DEPTH);
    expect(twoTreeInput.userPath.every((s: bigint) => typeof s === 'bigint')).toBe(true);
    expect(typeof twoTreeInput.userIndex).toBe('number');
    expect(twoTreeInput.cellMapPath).toHaveLength(TREE_DEPTH);
    expect(twoTreeInput.cellMapPath.every((s: bigint) => typeof s === 'bigint')).toBe(true);
    expect(twoTreeInput.cellMapPathBits).toHaveLength(TREE_DEPTH);

    // Verify Tree 2 root consistency
    expect(twoTreeInput.cellMapRoot).toBe(cellMapState.root);

    // Verify districts match the original mapping
    for (let i = 0; i < DISTRICT_SLOT_COUNT; i++) {
      expect(twoTreeInput.districts[i]).toBe(mappings[0].districts[i]);
    }
  });

  it('should return consistent cell-map-info', async () => {
    const req = createMockRequest('/v1/cell-map-info');
    const { res, getStatus, getBody } = createMockResponse();

    await (api as any).handleRequest(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody();
    expect(body.success).toBe(true);
    expect(body.data.available).toBe(true);
    expect(BigInt(body.data.root)).toBe(cellMapState.root);
    expect(body.data.depth).toBe(TREE_DEPTH);
    expect(body.data.cellCount).toBe(5);
  });

  it('should allow multiple registrations with different cells', async () => {
    // Register a second user in a different cell
    const { getHasher } = await import('@voter-protocol/crypto/poseidon2');
    const hasher = await getHasher();
    const leaf2 = await hasher.hash3(67890n, mappings[1].cellId, 11111n);
    const leaf2Hex = '0x' + leaf2.toString(16).padStart(64, '0');

    const registerReq = createMockRequest('/v1/register', 'POST',
      JSON.stringify({ leaf: leaf2Hex }),
      {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_AUTH_TOKEN}`,
      },
    );
    const registerResp = createMockResponse();
    await (api as any).handleRequest(registerReq, registerResp.res);
    expect(registerResp.getStatus()).toBe(200);
    expect(registerResp.getBody().data.leafIndex).toBe(1);

    // Get cell proof for second user's cell
    const cellProofReq = createMockRequest(
      `/v1/cell-proof?cell_id=${mappings[1].cellId.toString()}`,
    );
    const cellProofResp = createMockResponse();
    await (api as any).handleRequest(cellProofReq, cellProofResp.res);
    expect(cellProofResp.getStatus()).toBe(200);

    const cellProofData = cellProofResp.getBody().data;
    expect(cellProofData.districts).toHaveLength(DISTRICT_SLOT_COUNT);

    // Districts should match second mapping
    for (let i = 0; i < DISTRICT_SLOT_COUNT; i++) {
      expect(BigInt(cellProofData.districts[i])).toBe(mappings[1].districts[i]);
    }
  });

  it('should return 404 for cell_id not in Tree 2', async () => {
    const req = createMockRequest('/v1/cell-proof?cell_id=999999999');
    const { res, getStatus, getBody } = createMockResponse();

    await (api as any).handleRequest(req, res);

    expect(getStatus()).toBe(404);
    expect(getBody().error?.code).toBe('CELL_NOT_FOUND');
  });
});
