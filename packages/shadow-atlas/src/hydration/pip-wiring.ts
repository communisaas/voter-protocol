/**
 * PIP Wiring — adapters that bridge the PointInPolygonEngine and external
 * geocoders to the GeocoderFn / PIPCheckFn signatures expected by the
 * country-provider validation pipeline (Layer 4).
 *
 * Two geocoder backends:
 * - Nominatim (OSM): works for ALL countries, 1 req/sec rate limit
 * - Census Bureau: US-only, batch geocoding (much faster for US)
 *
 * @see country-provider-types.ts — GeocoderFn, PIPCheckFn
 * @see services/pip-engine.ts — PointInPolygonEngine (ray-casting)
 */

import { PointInPolygonEngine } from '../services/pip-engine.js';
import type { InternationalBoundary } from '../providers/international/base-provider.js';
import type { GeocoderFn, PIPCheckFn } from '../providers/international/country-provider-types.js';
import { fetchWithSizeLimit } from './fetch-with-size-limit.js';

/**
 * Build a PIPCheckFn from a boundary array.
 *
 * Creates a Map<boundaryCode, geometry> from boundary IDs and names,
 * then uses the PointInPolygonEngine for ray-casting containment tests.
 */
export function buildPIPCheck(
  boundaries: readonly InternationalBoundary[],
): PIPCheckFn {
  const engine = new PointInPolygonEngine();
  const geometryIndex = new Map<string, InternationalBoundary['geometry']>();

  for (const b of boundaries) {
    geometryIndex.set(b.id, b.geometry);
    geometryIndex.set(b.name, b.geometry);
  }

  return (point, boundaryCode) => {
    const geom = geometryIndex.get(boundaryCode);
    if (!geom) return false;
    return engine.isPointInPolygon(point, geom);
  };
}

/**
 * Build a geocoder using Nominatim (OpenStreetMap).
 *
 * Works for all countries. Rate limited to 1 request/second per
 * Nominatim usage policy.
 *
 * Note: for 650 UK MPs this means ~11 minutes of geocoding.
 * Use --pip flag deliberately; PIP is opt-in for this reason.
 */
export function buildNominatimGeocoder(): GeocoderFn {
  let lastRequestTime = 0;

  return async (address: string) => {
    // Enforce 1 req/sec rate limit
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < 1100) {
      await new Promise(r => setTimeout(r, 1100 - elapsed));
    }
    lastRequestTime = Date.now();

    try {
      const params = new URLSearchParams({
        q: address,
        format: 'json',
        limit: '1',
      });
      const url = `https://nominatim.openstreetmap.org/search?${params}`;
      // Use fetchWithSizeLimit instead of raw fetch — prevents SSRF via redirect
      // and memory exhaustion from malicious/oversized responses. 1MB limit is generous
      // for Nominatim JSON responses (typically <1KB).
      const body = await fetchWithSizeLimit(url, 1_048_576, {
        headers: { 'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0 (validation)' },
        signal: AbortSignal.timeout(10_000),
      });

      const data = JSON.parse(body);
      if (!Array.isArray(data) || data.length === 0) return null;
      const first = data[0];
      if (!first || first.lat == null || first.lon == null) return null;
      const lat = parseFloat(first.lat);
      const lng = parseFloat(first.lon);
      if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
      return { lat, lng };
    } catch {
      // Geocoding failure is non-fatal — official will be skipped
    }
    return null;
  };
}
