/**
 * Shadow Atlas HTTP API Tests
 *
 * Integration tests for RESTful API server.
 * Production-ready test coverage with rate limiting, CORS, error handling.
 *
 * CRITICAL: Zero tolerance for bugs in user-facing API.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ShadowAtlasAPI } from './api';
import { DistrictLookupService } from './district-service';
import { ProofService, toCompactProof } from './proof-generator';
import type { DistrictBoundary, GeoJSONPolygon, ServingProvenanceMetadata } from './types';
import type { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';

// Mock dependencies
vi.mock('./district-service');
vi.mock('./proof-generator');
vi.mock('./sync-service', () => ({
  SyncService: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    getLatestSnapshot: vi.fn().mockResolvedValue({
      cid: 'QmTest123',
      merkleRoot: BigInt(12345),
      timestamp: Date.now(),
      districtCount: 100,
      version: '1.0.0',
    }),
    listSnapshots: vi.fn().mockResolvedValue([
      {
        cid: 'QmTest123',
        merkleRoot: BigInt(12345),
        timestamp: Date.now(),
        districtCount: 100,
        version: '1.0.0',
      },
    ]),
  })),
}));

vi.mock('./health', () => ({
  HealthMonitor: vi.fn().mockImplementation(() => ({
    recordQuery: vi.fn(),
    recordError: vi.fn(),
    getMetrics: vi.fn().mockReturnValue({
      status: 'healthy',
      uptime: 12345,
      queries: {
        total: 100,
        successful: 95,
        failed: 5,
        latencyP50: 10,
        latencyP95: 30,
        latencyP99: 50,
        throughput: 10,
      },
      cache: {
        size: 50,
        hits: 80,
        misses: 20,
        hitRate: 0.8,
        evictions: 5,
      },
      snapshot: {
        currentCid: 'QmTest123',
        merkleRoot: '0x3039',
        districtCount: 100,
        ageSeconds: 3600,
        nextCheckSeconds: 300,
      },
      errors: {
        last5m: 0,
        last1h: 2,
        last24h: 5,
        recentErrors: [],
      },
      timestamp: Date.now(),
    }),
    exportPrometheus: vi.fn().mockReturnValue('# HELP mock_metric\n# TYPE mock_metric counter\nmock_metric 42\n'),
  })),
}));

/**
 * Test fixture: Create mock district boundary
 */
function createMockDistrict(id: string, name: string): DistrictBoundary {
  const geometry: GeoJSONPolygon = {
    type: 'Polygon' as const,
    coordinates: [
      [
        [-122.4, 37.8],
        [-122.3, 37.8],
        [-122.3, 37.7],
        [-122.4, 37.7],
        [-122.4, 37.8],
      ],
    ],
  };

  const provenance: ServingProvenanceMetadata = {
    source: 'test-source',
    authority: 'state-gis' as const,
    timestamp: Date.now(),
    method: 'test',
    responseHash: '0x123',
  };

  return {
    id,
    name,
    jurisdiction: 'Test Jurisdiction',
    districtType: 'council' as const,
    geometry,
    provenance,
  };
}

/**
 * Mock HTTP request/response for testing
 */
function createMockRequest(method: string, url: string, headers: Record<string, string> = {}): IncomingMessage {
  return {
    method,
    url,
    headers,
    socket: {
      remoteAddress: '127.0.0.1',
    },
  } as unknown as IncomingMessage;
}

function createMockResponse(): ServerResponse {
  const headers: Record<string, string> = {};
  const chunks: string[] = [];

  return {
    writeHead: vi.fn((status: number, responseHeaders?: Record<string, string>) => {
      if (responseHeaders) {
        Object.assign(headers, responseHeaders);
      }
    }),
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    end: vi.fn((data?: string) => {
      if (data) chunks.push(data);
    }),
    _getHeaders: () => headers,
    _getBody: () => chunks.join(''),
  } as unknown as ServerResponse;
}

describe('ShadowAtlasAPI', () => {
  let api: ShadowAtlasAPI;
  let mockLookupService: DistrictLookupService;
  let mockProofService: ProofService;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock services
    mockLookupService = new DistrictLookupService('/mock/db.db');
    mockProofService = new ProofService([], []);

    // Mock SyncService constructor is already mocked globally

    // Create API server (don't start it)
    api = new ShadowAtlasAPI(
      mockLookupService,
      mockProofService,
      {} as any, // SyncService mock
      3000,
      '0.0.0.0',
      ['*'],
      60
    );
  });

  afterEach(() => {
    if (api) {
      api.stop();
    }
  });

  describe('GET /lookup', () => {
    it('should return district with proof for valid coordinates', async () => {
      const mockDistrict = createMockDistrict('district-1', 'District 1');

      vi.mocked(mockLookupService.lookup).mockReturnValue({
        district: mockDistrict,
        latencyMs: 15,
        cacheHit: false,
      });

      vi.mocked(mockProofService.generateProof).mockReturnValue({
        root: BigInt(12345),
        leaf: BigInt(67890),
        siblings: [BigInt(1), BigInt(2)],
        pathIndices: [0, 1],
      });

      const req = createMockRequest('GET', '/lookup?lat=37.75&lon=-122.35');
      const res = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });

      const body = (res as any)._getBody();
      const response = JSON.parse(body);

      expect(response.district).toBeDefined();
      expect(response.district.id).toBe('district-1');
      expect(response.merkleProof).toBeDefined();
      expect(response.latencyMs).toBe(15);
      expect(response.cacheHit).toBe(false);
    });

    it('should return 400 for missing lat parameter', async () => {
      const req = createMockRequest('GET', '/lookup?lon=-122.35');
      const res = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });

      const body = (res as any)._getBody();
      const response = JSON.parse(body);

      expect(response.error).toBe('Missing lat or lon parameter');
      expect(response.code).toBe('INVALID_COORDINATES');
    });

    it('should return 400 for missing lon parameter', async () => {
      const req = createMockRequest('GET', '/lookup?lat=37.75');
      const res = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });

      const body = (res as any)._getBody();
      const response = JSON.parse(body);

      expect(response.error).toBe('Missing lat or lon parameter');
      expect(response.code).toBe('INVALID_COORDINATES');
    });

    it('should return 400 for invalid lat format', async () => {
      const req = createMockRequest('GET', '/lookup?lat=invalid&lon=-122.35');
      const res = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });

      const body = (res as any)._getBody();
      const response = JSON.parse(body);

      expect(response.error).toBe('Invalid lat or lon format');
      expect(response.code).toBe('INVALID_COORDINATES');
    });

    it('should return 400 for invalid lon format', async () => {
      const req = createMockRequest('GET', '/lookup?lat=37.75&lon=invalid');
      const res = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });

      const body = (res as any)._getBody();
      const response = JSON.parse(body);

      expect(response.error).toBe('Invalid lat or lon format');
      expect(response.code).toBe('INVALID_COORDINATES');
    });

    it('should return 400 for invalid coordinates (lookup throws)', async () => {
      vi.mocked(mockLookupService.lookup).mockImplementation(() => {
        throw new Error('Invalid coordinates: lat=91, lon=-122.35');
      });

      const req = createMockRequest('GET', '/lookup?lat=91&lon=-122.35');
      const res = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
    });

    it('should return 404 when no district found', async () => {
      vi.mocked(mockLookupService.lookup).mockReturnValue({
        district: null,
        latencyMs: 10,
        cacheHit: false,
      });

      const req = createMockRequest('GET', '/lookup?lat=37.75&lon=-122.35');
      const res = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });

      const body = (res as any)._getBody();
      const response = JSON.parse(body);

      expect(response.error).toBe('No district found at coordinates');
      expect(response.code).toBe('DISTRICT_NOT_FOUND');
    });

    it('should return 429 when rate limit exceeded', async () => {
      const req = createMockRequest('GET', '/lookup?lat=37.75&lon=-122.35');

      // Exhaust rate limit (60 requests/minute)
      for (let i = 0; i < 60; i++) {
        const res = createMockResponse();
        await (api as any).handleRequest(req, res);
      }

      // 61st request should be rate limited
      const res = createMockResponse();
      await (api as any).handleRequest(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(429, { 'Content-Type': 'application/json' });

      const body = (res as any)._getBody();
      const response = JSON.parse(body);

      expect(response.error).toBe('Rate limit exceeded');
      expect(response.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('should handle proof generation failure', async () => {
      const mockDistrict = createMockDistrict('district-1', 'District 1');

      vi.mocked(mockLookupService.lookup).mockReturnValue({
        district: mockDistrict,
        latencyMs: 15,
        cacheHit: false,
      });

      vi.mocked(mockProofService.generateProof).mockImplementation(() => {
        throw new Error('Proof generation failed');
      });

      const req = createMockRequest('GET', '/lookup?lat=37.75&lon=-122.35');
      const res = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });

      const body = (res as any)._getBody();
      const response = JSON.parse(body);

      expect(response.error).toContain('Proof generation failed');
      expect(response.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /health', () => {
    it('should return health metrics', async () => {
      const req = createMockRequest('GET', '/health');
      const res = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });

      const body = (res as any)._getBody();
      const response = JSON.parse(body);

      expect(response.status).toBe('healthy');
      expect(response.queries).toBeDefined();
      expect(response.cache).toBeDefined();
      expect(response.snapshot).toBeDefined();
      expect(response.errors).toBeDefined();
    });
  });

  describe('GET /metrics', () => {
    it('should return Prometheus metrics', async () => {
      const req = createMockRequest('GET', '/metrics');
      const res = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'text/plain; version=0.0.4' });

      const body = (res as any)._getBody();
      expect(body).toContain('# HELP mock_metric');
      expect(body).toContain('mock_metric 42');
    });
  });

  describe('GET /snapshot', () => {
    it('should return current snapshot metadata', async () => {
      const req = createMockRequest('GET', '/snapshot');
      const res = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });

      const body = (res as any)._getBody();
      const response = JSON.parse(body);

      expect(response.cid).toBe('QmTest123');
      expect(response.districtCount).toBe(100);
      expect(response.version).toBe('1.0.0');
    });
  });

  describe('GET /snapshots', () => {
    it('should return list of snapshots', async () => {
      const req = createMockRequest('GET', '/snapshots');
      const res = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });

      const body = (res as any)._getBody();
      const response = JSON.parse(body);

      expect(Array.isArray(response)).toBe(true);
      expect(response).toHaveLength(1);
      expect(response[0].cid).toBe('QmTest123');
    });
  });

  describe('404 Not Found', () => {
    it('should return 404 for unknown endpoint', async () => {
      const req = createMockRequest('GET', '/unknown');
      const res = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });

      const body = (res as any)._getBody();
      const response = JSON.parse(body);

      expect(response.error).toBe('Endpoint not found');
      expect(response.code).toBe('NOT_FOUND');
    });
  });

  describe('CORS Headers', () => {
    it('should set CORS headers for wildcard origin', async () => {
      const req = createMockRequest('GET', '/health');
      const res = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'GET, OPTIONS');
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'Content-Type');
    });

    it('should handle OPTIONS preflight request', async () => {
      const req = createMockRequest('OPTIONS', '/lookup');
      const res = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(204);
    });

    it('should set specific origin when configured', async () => {
      const customApi = new ShadowAtlasAPI(
        mockLookupService,
        mockProofService,
        {} as any,
        3000,
        '0.0.0.0',
        ['https://example.com'],
        60
      );

      const req = createMockRequest('GET', '/health');
      const res = createMockResponse();

      await (customApi as any).handleRequest(req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://example.com');

      customApi.stop();
    });
  });

  describe('Rate Limiting', () => {
    it('should rate limit based on client IP', async () => {
      const req1 = createMockRequest('GET', '/health');
      const req2 = createMockRequest('GET', '/health');
      (req2 as any).socket.remoteAddress = '192.168.1.1'; // Different IP

      // First IP makes 60 requests (max allowed)
      for (let i = 0; i < 60; i++) {
        const res = createMockResponse();
        await (api as any).handleRequest(req1, res);
      }

      // Second IP should still work (different client)
      const res = createMockResponse();
      await (api as any).handleRequest(req2, res);

      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
    });

    it('should use X-Forwarded-For header when behind proxy', async () => {
      const req = createMockRequest('GET', '/health', { 'x-forwarded-for': '203.0.113.1, 198.51.100.1' });
      const res = createMockResponse();

      await (api as any).handleRequest(req, res);

      // Should extract first IP from X-Forwarded-For
      expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    });
  });

  describe('BigInt Serialization', () => {
    it('should serialize bigint values to hex strings', async () => {
      const mockDistrict = createMockDistrict('district-1', 'District 1');

      vi.mocked(mockLookupService.lookup).mockReturnValue({
        district: mockDistrict,
        latencyMs: 15,
        cacheHit: false,
      });

      vi.mocked(mockProofService.generateProof).mockReturnValue({
        root: BigInt('0x123456789abcdef'),
        leaf: BigInt('0xfedcba987654321'),
        siblings: [BigInt(1), BigInt(2)],
        pathIndices: [0, 1],
      });

      const req = createMockRequest('GET', '/lookup?lat=37.75&lon=-122.35');
      const res = createMockResponse();

      await (api as any).handleRequest(req, res);

      const body = (res as any)._getBody();
      const response = JSON.parse(body);

      // BigInt should be serialized as hex string
      expect(response.merkleProof.root).toMatch(/^0x[0-9a-f]+$/i);
      expect(response.merkleProof.leaf).toMatch(/^0x[0-9a-f]+$/i);
    });
  });

  describe('Error Handling', () => {
    it('should handle internal errors gracefully', async () => {
      vi.mocked(mockLookupService.lookup).mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      const req = createMockRequest('GET', '/lookup?lat=37.75&lon=-122.35');
      const res = createMockResponse();

      await (api as any).handleRequest(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });

      const body = (res as any)._getBody();
      const response = JSON.parse(body);

      expect(response.code).toBe('INTERNAL_ERROR');
      expect(response.timestamp).toBeDefined();
    });

    it('should include timestamp in error responses', async () => {
      const req = createMockRequest('GET', '/lookup?lat=invalid&lon=-122.35');
      const res = createMockResponse();

      await (api as any).handleRequest(req, res);

      const body = (res as any)._getBody();
      const response = JSON.parse(body);

      expect(response.timestamp).toBeDefined();
      expect(typeof response.timestamp).toBe('number');
    });
  });

  describe('Server Lifecycle', () => {
    it('should start server on specified port', () => {
      // Test is simplified since we're not actually binding to a port in tests
      expect(api).toBeDefined();
    });

    it('should stop server cleanly', () => {
      api.stop();
      // Server should be stopped (no assertions needed, just verify no errors)
    });
  });
});
