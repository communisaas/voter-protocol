import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Polygon, MultiPolygon } from 'geojson';
import { buildPIPCheck, buildNominatimGeocoder } from '../../../hydration/pip-wiring.js';
import type { InternationalBoundary } from '../../../providers/international/base-provider.js';

// ============================================================================
// Helpers
// ============================================================================

/** Simple square polygon around a center point */
function makeSquarePoly(
  centerLng: number,
  centerLat: number,
  halfSize: number = 1,
): Polygon {
  return {
    type: 'Polygon',
    coordinates: [[
      [centerLng - halfSize, centerLat - halfSize],
      [centerLng + halfSize, centerLat - halfSize],
      [centerLng + halfSize, centerLat + halfSize],
      [centerLng - halfSize, centerLat + halfSize],
      [centerLng - halfSize, centerLat - halfSize], // close ring
    ]],
  };
}

function makeBoundary(
  id: string,
  name: string,
  geometry: Polygon | MultiPolygon,
): InternationalBoundary {
  return {
    id,
    name,
    type: 'parliamentary',
    geometry,
    source: {
      country: 'GB',
      dataSource: 'test',
      endpoint: 'test',
      authority: 'national-statistics',
      vintage: 2024,
      retrievedAt: new Date().toISOString(),
    },
    properties: {},
  };
}

// ============================================================================
// buildPIPCheck
// ============================================================================

describe('buildPIPCheck', () => {
  it('returns true for point inside boundary (matched by id)', () => {
    const boundary = makeBoundary('E14001234', 'Hackney North', makeSquarePoly(-0.05, 51.55));
    const check = buildPIPCheck([boundary]);

    const result = check({ lat: 51.55, lng: -0.05 }, 'E14001234');
    expect(result).toBe(true);
  });

  it('returns true for point inside boundary (matched by name)', () => {
    const boundary = makeBoundary('E14001234', 'Hackney North', makeSquarePoly(-0.05, 51.55));
    const check = buildPIPCheck([boundary]);

    const result = check({ lat: 51.55, lng: -0.05 }, 'Hackney North');
    expect(result).toBe(true);
  });

  it('returns false for point outside boundary', () => {
    const boundary = makeBoundary('E14001234', 'Hackney North', makeSquarePoly(-0.05, 51.55, 0.01));
    const check = buildPIPCheck([boundary]);

    // Point far outside the tiny polygon
    const result = check({ lat: 52.0, lng: 0.0 }, 'E14001234');
    expect(result).toBe(false);
  });

  it('returns false for unknown boundary code', () => {
    const boundary = makeBoundary('E14001234', 'Hackney North', makeSquarePoly(-0.05, 51.55));
    const check = buildPIPCheck([boundary]);

    const result = check({ lat: 51.55, lng: -0.05 }, 'UNKNOWN');
    expect(result).toBe(false);
  });

  it('handles multiple boundaries correctly', () => {
    const boundaries = [
      makeBoundary('A', 'District A', makeSquarePoly(0, 0, 1)),
      makeBoundary('B', 'District B', makeSquarePoly(10, 10, 1)),
    ];
    const check = buildPIPCheck(boundaries);

    // Point in A, not in B
    expect(check({ lat: 0, lng: 0 }, 'A')).toBe(true);
    expect(check({ lat: 0, lng: 0 }, 'B')).toBe(false);

    // Point in B, not in A
    expect(check({ lat: 10, lng: 10 }, 'B')).toBe(true);
    expect(check({ lat: 10, lng: 10 }, 'A')).toBe(false);
  });

  it('handles MultiPolygon geometry', () => {
    const multiPoly: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [
        // Polygon 1: around (0, 0)
        [[[- 1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]],
        // Polygon 2: around (10, 10)
        [[[9, 9], [11, 9], [11, 11], [9, 11], [9, 9]]],
      ],
    };
    const boundary = makeBoundary('multi', 'Multi District', multiPoly);
    const check = buildPIPCheck([boundary]);

    // In polygon 1
    expect(check({ lat: 0, lng: 0 }, 'multi')).toBe(true);
    // In polygon 2
    expect(check({ lat: 10, lng: 10 }, 'multi')).toBe(true);
    // In neither
    expect(check({ lat: 5, lng: 5 }, 'multi')).toBe(false);
  });
});

// ============================================================================
// Integration: PIPCheckFn with mock geocoder simulates Layer 4
// ============================================================================

describe('Layer 4 integration (mock geocoder + PIP check)', () => {
  it('confirmed when geocoded address is inside boundary', async () => {
    const boundary = makeBoundary('E14001234', 'Hackney North', makeSquarePoly(-0.05, 51.55));
    const pipCheck = buildPIPCheck([boundary]);

    // Mock geocoder returns point inside Hackney North
    const geocoder = async (_address: string) => ({ lat: 51.55, lng: -0.05 });

    const coords = await geocoder('Constituency Office, Hackney');
    expect(coords).not.toBeNull();
    expect(pipCheck(coords!, 'E14001234')).toBe(true);
  });

  it('mismatch when geocoded address is outside boundary', async () => {
    const boundary = makeBoundary('E14001234', 'Hackney North', makeSquarePoly(-0.05, 51.55, 0.01));
    const pipCheck = buildPIPCheck([boundary]);

    // Mock geocoder returns Westminster (outside Hackney)
    const geocoder = async (_address: string) => ({ lat: 51.50, lng: -0.12 });

    const coords = await geocoder('House of Commons, London SW1A 0AA');
    expect(coords).not.toBeNull();
    expect(pipCheck(coords!, 'E14001234')).toBe(false);
  });

  it('skipped when geocoder returns null', async () => {
    const boundary = makeBoundary('E14001234', 'Hackney North', makeSquarePoly(-0.05, 51.55));
    const pipCheck = buildPIPCheck([boundary]);

    const geocoder = async (_address: string) => null;

    const coords = await geocoder('Unknown Address');
    expect(coords).toBeNull();
    // PIP check not called — would be skipped in verifyPIP()
  });
});

// ============================================================================
// M-5: Schema-validate Nominatim geocoder responses
// ============================================================================

describe('M-5: buildNominatimGeocoder response validation', () => {
  let originalFetch: typeof globalThis.fetch;

  // buildNominatimGeocoder now uses fetchWithSizeLimit (streaming body reader)
  // instead of res.json(). Mocks must return proper Response-like objects.
  function mockFetchOk(body: unknown) {
    const text = JSON.stringify(body);
    const encoded = new TextEncoder().encode(text);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-length': String(encoded.byteLength) }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoded);
          controller.close();
        },
      }),
    });
  }

  function mockFetchError(status: number) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText: 'Error',
      headers: new Headers(),
      body: null,
    });
  }

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns null for empty array response', async () => {
    mockFetchOk([]);
    const geocoder = buildNominatimGeocoder();
    const result = await geocoder('Nonexistent Place');
    expect(result).toBeNull();
  });

  it('returns null for non-array response', async () => {
    mockFetchOk({ error: 'not found' });
    const geocoder = buildNominatimGeocoder();
    const result = await geocoder('Bad Response');
    expect(result).toBeNull();
  });

  it('returns null when lat is missing', async () => {
    mockFetchOk([{ lon: '-0.1' }]);
    const geocoder = buildNominatimGeocoder();
    const result = await geocoder('Missing Lat');
    expect(result).toBeNull();
  });

  it('returns null when lon is missing', async () => {
    mockFetchOk([{ lat: '51.5' }]);
    const geocoder = buildNominatimGeocoder();
    const result = await geocoder('Missing Lon');
    expect(result).toBeNull();
  });

  it('returns null when lat parses to NaN', async () => {
    mockFetchOk([{ lat: 'not-a-number', lon: '-0.1' }]);
    const geocoder = buildNominatimGeocoder();
    const result = await geocoder('NaN Lat');
    expect(result).toBeNull();
  });

  it('returns null when lon parses to NaN', async () => {
    mockFetchOk([{ lat: '51.5', lon: 'invalid' }]);
    const geocoder = buildNominatimGeocoder();
    const result = await geocoder('NaN Lon');
    expect(result).toBeNull();
  });

  it('returns valid coordinates for well-formed response', async () => {
    mockFetchOk([{ lat: '51.5074', lon: '-0.1278' }]);
    const geocoder = buildNominatimGeocoder();
    const result = await geocoder('London, UK');
    expect(result).toEqual({ lat: 51.5074, lng: -0.1278 });
  });

  it('returns null when first element is null', async () => {
    mockFetchOk([null]);
    const geocoder = buildNominatimGeocoder();
    const result = await geocoder('Null element');
    expect(result).toBeNull();
  });

  it('returns null for HTTP error', async () => {
    mockFetchError(500);
    const geocoder = buildNominatimGeocoder();
    const result = await geocoder('Server Error');
    expect(result).toBeNull();
  });
});
