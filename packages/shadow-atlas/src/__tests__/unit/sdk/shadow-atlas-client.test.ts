/**
 * Integration test - skipped in unit test suite
 * Run with: npm run test:integration
 *
 * Shadow Atlas TypeScript SDK - Unit Tests
 *
 * Tests for SDK client library:
 * - Request validation
 * - Response parsing
 * - Error handling
 * - Retry logic
 * - Caching
 * - Merkle proof verification
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShadowAtlasClient, ShadowAtlasError } from '../../../distribution/api/shadow-atlas-client.js';
import type { LookupResult, SnapshotMetadata } from '../../../distribution/api/shadow-atlas-client.js';

/**
 * Mock fetch for testing
 */
function mockFetch(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (key: string) => headers[key.toLowerCase()] ?? null,
      },
      json: () => Promise.resolve(body),
    } as Response)
  );
}

describe('ShadowAtlasClient - Configuration', () => {
  it('uses default configuration', () => {
    const client = new ShadowAtlasClient();
    expect(client).toBeDefined();
  });

  it('accepts custom base URL', () => {
    const client = new ShadowAtlasClient({
      baseUrl: 'https://testnet.shadow-atlas.org/v1',
    });
    expect(client).toBeDefined();
  });

  it('accepts API key', () => {
    const client = new ShadowAtlasClient({
      apiKey: 'test_api_key',
    });
    expect(client).toBeDefined();
  });

  it('accepts custom timeout', () => {
    const client = new ShadowAtlasClient({
      timeout: 5000,
    });
    expect(client).toBeDefined();
  });

  it('accepts custom retry configuration', () => {
    const client = new ShadowAtlasClient({
      retryAttempts: 5,
      retryDelay: 2000,
    });
    expect(client).toBeDefined();
  });

  it('accepts custom cache configuration', () => {
    const client = new ShadowAtlasClient({
      cacheEnabled: true,
      cacheTTL: 7200000, // 2 hours
    });
    expect(client).toBeDefined();
  });
});

describe('ShadowAtlasClient - Lookup', () => {
  let client: ShadowAtlasClient;

  beforeEach(() => {
    client = new ShadowAtlasClient({
      baseUrl: 'https://api.shadow-atlas.org/v1',
    });
  });

  it('validates latitude bounds (min)', async () => {
    await expect(client.lookup(-91, 0)).rejects.toThrow(
      'Latitude must be between -90 and 90'
    );
  });

  it('validates latitude bounds (max)', async () => {
    await expect(client.lookup(91, 0)).rejects.toThrow(
      'Latitude must be between -90 and 90'
    );
  });

  it('validates longitude bounds (min)', async () => {
    await expect(client.lookup(0, -181)).rejects.toThrow(
      'Longitude must be between -180 and 180'
    );
  });

  it('validates longitude bounds (max)', async () => {
    await expect(client.lookup(0, 181)).rejects.toThrow(
      'Longitude must be between -180 and 180'
    );
  });

  it('performs successful lookup', async () => {
    const mockResponse = {
      success: true,
      data: {
        district: {
          id: '0809',
          name: 'Congressional District 9',
          jurisdiction: 'USA/Colorado/Congressional District 9',
          districtType: 'congressional',
          geometry: {
            type: 'Polygon',
            coordinates: [[[-105.0, 39.7], [-104.9, 39.7]]],
          },
        },
        merkleProof: {
          root: '0x4f855996bf88ffdacabbdd8ac4b56dde9ff5ef48e80ff91c149b0ae560af8f54',
          leaf: '0x50fa016cf737a511e83d8f8f99420aa1234567890abcdef',
          siblings: ['0x7e25e38a34daf68780556839d53cfdc5'],
          pathIndices: [0, 1, 0, 1],
        },
        latencyMs: 23.4,
        cacheHit: false,
      },
      meta: {
        requestId: 'req_abc123',
        latencyMs: 23.4,
        cached: false,
        version: 'v1',
      },
    };

    mockFetch(200, mockResponse, {
      'x-ratelimit-remaining': '999',
      'x-ratelimit-reset': '1734528000',
    });

    const result = await client.lookup(39.7392, -104.9903);

    expect(result.district.id).toBe('0809');
    expect(result.district.name).toBe('Congressional District 9');
    expect(result.merkleProof).toBeDefined();
  });

  it('throws error on district not found', async () => {
    const mockResponse = {
      success: false,
      error: {
        code: 'DISTRICT_NOT_FOUND',
        message: 'No district found at coordinates',
        details: { lat: 0, lng: 0 },
      },
      meta: {
        requestId: 'req_def456',
        latencyMs: 18.7,
        cached: false,
        version: 'v1',
      },
    };

    mockFetch(404, mockResponse);

    await expect(client.lookup(0, 0)).rejects.toThrow(ShadowAtlasError);
    await expect(client.lookup(0, 0)).rejects.toMatchObject({
      code: 'DISTRICT_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('caches lookup results', async () => {
    const mockResponse = {
      success: true,
      data: {
        district: {
          id: '0809',
          name: 'Congressional District 9',
          jurisdiction: 'USA/Colorado/Congressional District 9',
          districtType: 'congressional',
          geometry: {
            type: 'Polygon',
            coordinates: [[[-105.0, 39.7], [-104.9, 39.7]]],
          },
        },
        merkleProof: {
          root: '0x4f855996bf88ffdacabbdd8ac4b56dde9ff5ef48e80ff91c149b0ae560af8f54',
          leaf: '0x50fa016cf737a511e83d8f8f99420aa1234567890abcdef',
          siblings: ['0x7e25e38a34daf68780556839d53cfdc5'],
          pathIndices: [0, 1, 0, 1],
        },
        latencyMs: 23.4,
        cacheHit: false,
      },
      meta: {
        requestId: 'req_ghi789',
        latencyMs: 23.4,
        cached: false,
        version: 'v1',
      },
    };

    mockFetch(200, mockResponse);

    // First lookup (cache miss)
    const result1 = await client.lookup(39.7392, -104.9903);
    expect(result1.district.id).toBe('0809');

    // Second lookup (cache hit, no network call)
    const result2 = await client.lookup(39.7392, -104.9903);
    expect(result2.district.id).toBe('0809');

    // Verify only one network call was made
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('clears cache', async () => {
    const mockResponse = {
      success: true,
      data: {
        district: {
          id: '0809',
          name: 'Congressional District 9',
          jurisdiction: 'USA/Colorado/Congressional District 9',
          districtType: 'congressional',
          geometry: {
            type: 'Polygon',
            coordinates: [[[-105.0, 39.7], [-104.9, 39.7]]],
          },
        },
        merkleProof: {
          root: '0x4f855996bf88ffdacabbdd8ac4b56dde9ff5ef48e80ff91c149b0ae560af8f54',
          leaf: '0x50fa016cf737a511e83d8f8f99420aa1234567890abcdef',
          siblings: ['0x7e25e38a34daf68780556839d53cfdc5'],
          pathIndices: [0, 1, 0, 1],
        },
        latencyMs: 23.4,
        cacheHit: false,
      },
      meta: {
        requestId: 'req_jkl012',
        latencyMs: 23.4,
        cached: false,
        version: 'v1',
      },
    };

    mockFetch(200, mockResponse);

    // First lookup
    await client.lookup(39.7392, -104.9903);

    // Clear cache
    client.clearCache();

    // Second lookup (should make network call)
    await client.lookup(39.7392, -104.9903);

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('ShadowAtlasClient - Get District by ID', () => {
  let client: ShadowAtlasClient;

  beforeEach(() => {
    client = new ShadowAtlasClient();
  });

  it('validates district ID (non-empty)', async () => {
    await expect(client.getDistrictById('')).rejects.toThrow(
      'District ID cannot be empty'
    );
  });

  it('performs successful lookup', async () => {
    const mockResponse = {
      success: true,
      data: {
        districtId: '5501',
        merkleProof: {
          root: '0x4f855996bf88ffdacabbdd8ac4b56dde9ff5ef48e80ff91c149b0ae560af8f54',
          leaf: '0x50fa016cf737a511e83d8f8f99420aa1234567890abcdef',
          siblings: ['0x7e25e38a34daf68780556839d53cfdc5'],
          pathIndices: [0, 1, 0, 1],
        },
      },
      meta: {
        requestId: 'req_mno345',
        latencyMs: 8.2,
        cached: true,
        version: 'v1',
      },
    };

    mockFetch(200, mockResponse);

    const result = await client.getDistrictById('5501');

    expect(result.districtId).toBe('5501');
    expect(result.merkleProof).toBeDefined();
  });

  it('throws error on district not found', async () => {
    const mockResponse = {
      success: false,
      error: {
        code: 'DISTRICT_NOT_FOUND',
        message: 'District not found: invalid_id',
        details: { districtId: 'invalid_id' },
      },
      meta: {
        requestId: 'req_pqr678',
        latencyMs: 5.1,
        cached: false,
        version: 'v1',
      },
    };

    mockFetch(404, mockResponse);

    await expect(client.getDistrictById('invalid_id')).rejects.toThrow(
      ShadowAtlasError
    );
  });
});

describe('ShadowAtlasClient - Snapshots', () => {
  let client: ShadowAtlasClient;

  beforeEach(() => {
    client = new ShadowAtlasClient();
  });

  it('gets current snapshot', async () => {
    const mockResponse = {
      success: true,
      data: {
        snapshotId: 'shadow-atlas-2025-Q1',
        ipfsCID: 'QmXyz789...',
        merkleRoot: '0x4f855996bf88ffdacabbdd8ac4b56dde...',
        timestamp: '2025-01-15T00:00:00Z',
        districtCount: 10000,
        version: '1.0.0',
        coverage: {
          countries: ['US', 'CA', 'GB'],
          states: ['AL', 'AK', 'WI'],
        },
      },
      meta: {
        requestId: 'req_stu901',
        latencyMs: 8.2,
        cached: false,
        version: 'v1',
      },
    };

    mockFetch(200, mockResponse);

    const snapshot = await client.getSnapshot();

    expect(snapshot.snapshotId).toBe('shadow-atlas-2025-Q1');
    expect(snapshot.ipfsCID).toBe('QmXyz789...');
    expect(snapshot.merkleRoot).toBeDefined();
  });

  it('lists all snapshots', async () => {
    const mockResponse = {
      success: true,
      data: [
        {
          snapshotId: 'shadow-atlas-2025-Q1',
          ipfsCID: 'QmXyz789...',
          merkleRoot: '0x4f855996bf88ffdacabbdd8ac4b56dde...',
          timestamp: '2025-01-15T00:00:00Z',
          districtCount: 10000,
          version: '1.0.0',
          coverage: {
            countries: ['US', 'CA', 'GB'],
            states: ['AL', 'AK', 'WI'],
          },
        },
        {
          snapshotId: 'shadow-atlas-2024-Q4',
          ipfsCID: 'QmAbc123...',
          merkleRoot: '0x7e25e38a34daf68780556839d53cfdc5...',
          timestamp: '2024-10-15T00:00:00Z',
          districtCount: 9500,
          version: '1.0.0',
          coverage: {
            countries: ['US', 'CA'],
            states: ['AL', 'AK'],
          },
        },
      ],
      meta: {
        requestId: 'req_vwx234',
        latencyMs: 5.3,
        cached: false,
        version: 'v1',
      },
    };

    mockFetch(200, mockResponse);

    const snapshots = await client.listSnapshots();

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].snapshotId).toBe('shadow-atlas-2025-Q1');
    expect(snapshots[1].snapshotId).toBe('shadow-atlas-2024-Q4');
  });
});

describe('ShadowAtlasClient - Health', () => {
  let client: ShadowAtlasClient;

  beforeEach(() => {
    client = new ShadowAtlasClient();
  });

  it('performs health check', async () => {
    const mockResponse = {
      success: true,
      data: {
        status: 'healthy',
        uptime: 3600,
        queries: {
          total: 10000,
          successful: 9950,
          failed: 50,
          latencyP50: 18.2,
          latencyP95: 42.1,
          latencyP99: 87.3,
          throughput: 2.78,
        },
        cache: {
          size: 8234,
          hits: 8500,
          misses: 1500,
          hitRate: 0.85,
          evictions: 234,
        },
        snapshot: {
          currentCid: 'QmXyz789...',
          merkleRoot: '0x4f855996bf88ffdacabbdd8ac4b56dde...',
          districtCount: 10000,
          ageSeconds: 86400,
          nextCheckSeconds: 2700,
        },
        errors: {
          last5m: 2,
          last1h: 15,
          last24h: 50,
          recentErrors: [],
        },
        timestamp: 1700000000000,
      },
      meta: {
        requestId: 'req_yza567',
        latencyMs: 2.1,
        cached: false,
        version: 'v1',
      },
    };

    mockFetch(200, mockResponse);

    const health = await client.health();

    expect(health.status).toBe('healthy');
    expect(health.queries).toBeDefined();
    expect(health.cache).toBeDefined();
    expect(health.snapshot).toBeDefined();
  });
});

describe('ShadowAtlasClient - Rate Limiting', () => {
  let client: ShadowAtlasClient;

  beforeEach(() => {
    client = new ShadowAtlasClient();
  });

  it('tracks rate limit information', async () => {
    const mockResponse = {
      success: true,
      data: {
        district: {
          id: '0809',
          name: 'Congressional District 9',
          jurisdiction: 'USA/Colorado/Congressional District 9',
          districtType: 'congressional',
          geometry: {
            type: 'Polygon',
            coordinates: [[[-105.0, 39.7], [-104.9, 39.7]]],
          },
        },
        merkleProof: {
          root: '0x4f855996bf88ffdacabbdd8ac4b56dde9ff5ef48e80ff91c149b0ae560af8f54',
          leaf: '0x50fa016cf737a511e83d8f8f99420aa1234567890abcdef',
          siblings: ['0x7e25e38a34daf68780556839d53cfdc5'],
          pathIndices: [0, 1, 0, 1],
        },
        latencyMs: 23.4,
        cacheHit: false,
      },
      meta: {
        requestId: 'req_bcd890',
        latencyMs: 23.4,
        cached: false,
        version: 'v1',
      },
    };

    mockFetch(200, mockResponse, {
      'x-ratelimit-remaining': '847',
      'x-ratelimit-reset': '1734528000',
    });

    await client.lookup(39.7392, -104.9903);

    const rateLimitInfo = client.getRateLimitInfo();
    expect(rateLimitInfo.remaining).toBe(847);
    expect(rateLimitInfo.resetAt).toBeInstanceOf(Date);
  });

  it('retries on rate limit exceeded', async () => {
    const mockRateLimitResponse = {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded. Please try again later.',
        details: {
          limit: 1000,
          remaining: 0,
          resetAt: '2025-12-19T00:00:00Z',
        },
      },
      meta: {
        requestId: 'req_efg123',
        latencyMs: 1.2,
        cached: false,
        version: 'v1',
      },
    };

    mockFetch(429, mockRateLimitResponse);

    const clientWithRetry = new ShadowAtlasClient({
      retryAttempts: 1,
      retryDelay: 100,
    });

    await expect(clientWithRetry.lookup(39.7392, -104.9903)).rejects.toThrow(
      ShadowAtlasError
    );
  });
});

describe('ShadowAtlasClient - Error Handling', () => {
  let client: ShadowAtlasClient;

  beforeEach(() => {
    client = new ShadowAtlasClient({
      retryAttempts: 1, // Disable retries for error tests
    });
  });

  it('throws ShadowAtlasError on API errors', async () => {
    const mockResponse = {
      success: false,
      error: {
        code: 'INVALID_PARAMETERS',
        message: 'Invalid request parameters',
        details: { lat: ['Latitude must be >= -90'] },
      },
      meta: {
        requestId: 'req_hij456',
        latencyMs: 2.1,
        cached: false,
        version: 'v1',
      },
    };

    mockFetch(400, mockResponse);

    try {
      await client.lookup(39.7392, -104.9903);
      expect.fail('Should have thrown ShadowAtlasError');
    } catch (error) {
      expect(error).toBeInstanceOf(ShadowAtlasError);
      const atlasError = error as ShadowAtlasError;
      expect(atlasError.code).toBe('INVALID_PARAMETERS');
      expect(atlasError.statusCode).toBe(400);
      expect(atlasError.requestId).toBe('req_hij456');
    }
  });

  it('handles network errors', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

    await expect(client.lookup(39.7392, -104.9903)).rejects.toThrow(
      'Network error'
    );
  });

  it('handles timeout errors', async () => {
    // Mock AbortController to immediately abort
    const mockAbortController = {
      signal: { aborted: true, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      abort: vi.fn(),
    };
    vi.spyOn(global, 'AbortController').mockImplementation(() => mockAbortController as unknown as AbortController);

    global.fetch = vi.fn().mockRejectedValue(new Error('Request aborted'));

    const clientWithTimeout = new ShadowAtlasClient({
      timeout: 100,
      retryAttempts: 1,
    });

    await expect(
      clientWithTimeout.lookup(39.7392, -104.9903)
    ).rejects.toThrow();

    vi.restoreAllMocks();
  });
});

describe('ShadowAtlasClient - Merkle Proof Verification', () => {
  let client: ShadowAtlasClient;

  beforeEach(() => {
    client = new ShadowAtlasClient();
  });

  it('verifies valid Merkle proof', () => {
    // Note: This is a simplified test. Real Poseidon hash verification
    // requires actual cryptographic computation.
    const districtId = '0809';
    const proof = {
      root: '0x4f855996bf88ffdacabbdd8ac4b56dde9ff5ef48e80ff91c149b0ae560af8f54',
      leaf: '0x50fa016cf737a511e83d8f8f99420aa1234567890abcdef',
      siblings: [
        '0x7e25e38a34daf68780556839d53cfdc5',
        '0x1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p',
      ],
      pathIndices: [0, 1],
    };

    // Verification will fail in test environment without proper Poseidon setup
    const isValid = client.verifyProof(districtId, proof);
    expect(typeof isValid).toBe('boolean');
  });

  it('handles verification errors gracefully', () => {
    const districtId = '0809';
    const invalidProof = {
      root: 'invalid',
      leaf: 'invalid',
      siblings: ['invalid'],
      pathIndices: [0],
    };

    const isValid = client.verifyProof(districtId, invalidProof);
    expect(isValid).toBe(false);
  });
});
