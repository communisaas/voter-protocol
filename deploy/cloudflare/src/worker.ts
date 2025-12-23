/**
 * Shadow Atlas Cloudflare Worker
 *
 * Global edge API for district lookups with cryptographic verification.
 * Deployed to 330+ edge locations worldwide for <50ms p95 latency.
 *
 * Architecture:
 * - Cloudflare Workers (edge compute)
 * - R2 Object Storage (GeoJSON districts)
 * - Workers KV (rate limiting, caching)
 * - Point-in-polygon algorithm (ray casting)
 *
 * Cost: $5-100/month for 1M-100M requests
 */

import { Router } from 'itty-router';
import pointInPolygon from 'point-in-polygon-hao';

/**
 * Environment bindings (injected by Cloudflare)
 */
interface Env {
  DISTRICTS_BUCKET: R2Bucket;
  RATE_LIMIT_KV: KVNamespace;
  CACHE_KV: KVNamespace;
  ENVIRONMENT: string;
  API_VERSION: string;
}

/**
 * District GeoJSON file structure (R2)
 */
interface R2DistrictFile {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id: string;
    properties: {
      id: string;
      name: string;
      districtType: string;
      jurisdiction: string;
    };
    geometry: {
      type: 'Polygon' | 'MultiPolygon';
      coordinates: number[][][] | number[][][][];
    };
  }>;
  metadata: {
    state: string;
    country: string;
    lastUpdated: string;
    districtCount: number;
    merkleRoot: string;
  };
}

/**
 * Snapshot metadata (R2)
 */
interface R2SnapshotMetadata {
  snapshotId: string;
  merkleRoot: string;
  ipfsCID: string;
  timestamp: string;
  districtCount: number;
  version: string;
  coverage: {
    countries: string[];
    states: string[];
  };
}

/**
 * API Response types
 */
interface LookupResponse {
  district: {
    id: string;
    name: string;
    jurisdiction: string;
    districtType: string;
    geometry: Record<string, unknown>;
  };
  coordinates: {
    lat: number;
    lng: number;
  };
  merkleProof: {
    root: string;
    leaf: string;
    siblings: string[];
    pathIndices: number[];
  };
  provenance: {
    snapshotId: string;
    ipfsCID: string;
    merkleRoot: string;
    retrievedAt: string;
  };
  latencyMs: number;
  cacheHit: boolean;
}

interface ErrorResponse {
  error: string;
  code: string;
  timestamp: number;
}

/**
 * CORS headers for all responses
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * Rate limiting configuration
 */
const RATE_LIMITS = {
  FREE_TIER: 1000, // requests per day
  WINDOW_SECONDS: 86400, // 24 hours
};

/**
 * Router setup
 */
const router = Router();

/**
 * GET /v1/districts - District lookup by address/coordinates
 */
router.get('/v1/districts', async (request: Request, env: Env) => {
  const startTime = Date.now();

  try {
    // Rate limiting
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateLimitOk = await checkRateLimit(env, clientIP);

    if (!rateLimitOk) {
      return jsonResponse(
        {
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          timestamp: Date.now(),
        },
        429
      );
    }

    // Parse query parameters
    const url = new URL(request.url);
    const lat = parseFloat(url.searchParams.get('lat') || '');
    const lng = parseFloat(url.searchParams.get('lng') || '');

    // Validate coordinates
    if (isNaN(lat) || isNaN(lng)) {
      return jsonResponse(
        {
          error: 'Invalid or missing lat/lng parameters',
          code: 'INVALID_PARAMETERS',
          timestamp: Date.now(),
        },
        400
      );
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return jsonResponse(
        {
          error: 'Coordinates out of range',
          code: 'INVALID_COORDINATES',
          timestamp: Date.now(),
        },
        400
      );
    }

    // Determine state from coordinates
    const state = await determineState(lat, lng);

    if (!state) {
      return jsonResponse(
        {
          error: 'Coordinates not in supported region',
          code: 'UNSUPPORTED_REGION',
          timestamp: Date.now(),
        },
        404
      );
    }

    // Fetch district GeoJSON from R2
    const districtFile = await env.DISTRICTS_BUCKET.get(`districts/US/${state}.geojson`);

    if (!districtFile) {
      return jsonResponse(
        {
          error: 'District data not found for state',
          code: 'STATE_NOT_FOUND',
          timestamp: Date.now(),
        },
        404
      );
    }

    const districts = (await districtFile.json()) as R2DistrictFile;

    // Point-in-polygon test
    const matchingDistrict = findDistrictByPoint(districts, lat, lng);

    if (!matchingDistrict) {
      return jsonResponse(
        {
          error: 'No district found at coordinates',
          code: 'DISTRICT_NOT_FOUND',
          timestamp: Date.now(),
        },
        404
      );
    }

    // Fetch snapshot metadata
    const snapshotObj = await env.DISTRICTS_BUCKET.get('metadata/snapshot-current.json');
    const snapshot = snapshotObj ? ((await snapshotObj.json()) as R2SnapshotMetadata) : null;

    // Generate mock Merkle proof (TODO: implement actual proof generation)
    const merkleProof = {
      root: snapshot?.merkleRoot || '0x0000000000000000000000000000000000000000000000000000000000000000',
      leaf: '0x0000000000000000000000000000000000000000000000000000000000000000',
      siblings: [],
      pathIndices: [],
    };

    // Build response
    const response: LookupResponse = {
      district: {
        id: matchingDistrict.id,
        name: matchingDistrict.properties.name,
        jurisdiction: matchingDistrict.properties.jurisdiction,
        districtType: matchingDistrict.properties.districtType,
        geometry: matchingDistrict.geometry,
      },
      coordinates: { lat, lng },
      merkleProof,
      provenance: {
        snapshotId: snapshot?.snapshotId || 'unknown',
        ipfsCID: snapshot?.ipfsCID || 'unknown',
        merkleRoot: snapshot?.merkleRoot || '0x00',
        retrievedAt: new Date().toISOString(),
      },
      latencyMs: Date.now() - startTime,
      cacheHit: false,
    };

    return jsonResponse(response, 200);
  } catch (error) {
    console.error('Lookup error:', error);
    return jsonResponse(
      {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        timestamp: Date.now(),
      },
      500
    );
  }
});

/**
 * GET /v1/health - Health check
 */
router.get('/v1/health', async (request: Request, env: Env) => {
  const health = {
    status: 'healthy',
    environment: env.ENVIRONMENT,
    version: env.API_VERSION,
    timestamp: Date.now(),
  };

  return jsonResponse(health, 200);
});

/**
 * GET /v1/snapshot - Current snapshot metadata
 */
router.get('/v1/snapshot', async (request: Request, env: Env) => {
  try {
    const snapshotObj = await env.DISTRICTS_BUCKET.get('metadata/snapshot-current.json');

    if (!snapshotObj) {
      return jsonResponse(
        {
          error: 'Snapshot metadata not found',
          code: 'SNAPSHOT_UNAVAILABLE',
          timestamp: Date.now(),
        },
        404
      );
    }

    const snapshot = (await snapshotObj.json()) as R2SnapshotMetadata;
    return jsonResponse(snapshot, 200);
  } catch (error) {
    console.error('Snapshot error:', error);
    return jsonResponse(
      {
        error: 'Failed to fetch snapshot metadata',
        code: 'INTERNAL_ERROR',
        timestamp: Date.now(),
      },
      500
    );
  }
});

/**
 * OPTIONS /* - CORS preflight
 */
router.options('*', () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
});

/**
 * 404 handler
 */
router.all('*', () => {
  return jsonResponse(
    {
      error: 'Endpoint not found',
      code: 'NOT_FOUND',
      timestamp: Date.now(),
    },
    404
  );
});

/**
 * Rate limiting check
 */
async function checkRateLimit(env: Env, clientIP: string): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];
  const key = `ratelimit:${clientIP}:${today}`;

  const currentCount = await env.RATE_LIMIT_KV.get(key);
  const count = currentCount ? parseInt(currentCount, 10) : 0;

  if (count >= RATE_LIMITS.FREE_TIER) {
    return false;
  }

  await env.RATE_LIMIT_KV.put(key, String(count + 1), {
    expirationTtl: RATE_LIMITS.WINDOW_SECONDS,
  });

  return true;
}

/**
 * Determine US state from coordinates (bounding box approximation)
 */
async function determineState(lat: number, lng: number): Promise<string | null> {
  // Simple bounding box check for US states
  // TODO: Implement precise state boundary lookup
  const stateBounds: Record<string, { minLat: number; maxLat: number; minLng: number; maxLng: number }> = {
    WI: { minLat: 42.5, maxLat: 47.3, minLng: -92.9, maxLng: -86.8 },
    CO: { minLat: 36.9, maxLat: 41.0, minLng: -109.1, maxLng: -102.0 },
    CA: { minLat: 32.5, maxLat: 42.0, minLng: -124.5, maxLng: -114.1 },
    // Add more states as needed
  };

  for (const [state, bounds] of Object.entries(stateBounds)) {
    if (lat >= bounds.minLat && lat <= bounds.maxLat && lng >= bounds.minLng && lng <= bounds.maxLng) {
      return state;
    }
  }

  return null;
}

/**
 * Find district containing point (ray casting algorithm)
 */
function findDistrictByPoint(
  districts: R2DistrictFile,
  lat: number,
  lng: number
): R2DistrictFile['features'][0] | null {
  const point: [number, number] = [lng, lat];

  for (const feature of districts.features) {
    const { geometry } = feature;

    if (geometry.type === 'Polygon') {
      const polygon = geometry.coordinates as number[][][];
      for (const ring of polygon) {
        if (pointInPolygon(point, ring)) {
          return feature;
        }
      }
    } else if (geometry.type === 'MultiPolygon') {
      const multiPolygon = geometry.coordinates as number[][][][];
      for (const polygon of multiPolygon) {
        for (const ring of polygon) {
          if (pointInPolygon(point, ring)) {
            return feature;
          }
        }
      }
    }
  }

  return null;
}

/**
 * JSON response helper
 */
function jsonResponse(data: Record<string, unknown> | LookupResponse | ErrorResponse, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

/**
 * Worker entry point
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return router.handle(request, env, ctx);
  },
};
