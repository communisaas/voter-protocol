/**
 * Registry Validator Tests
 *
 * PURPOSE: Validate health check logic
 * STRATEGY: Mock HTTP responses, test edge cases
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validatePortal, validateRegistry } from '../../../services/registry-validator.js';
import type { KnownPortal } from '../registry/known-portals.js';

describe('Registry Validator', () => {
  // Mock fetch
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('validatePortal', () => {
    it('detects unstable hub.arcgis.com download URLs', async () => {
      const mockPortal: KnownPortal = {
        cityFips: '4865000',
        cityName: 'San Antonio',
        state: 'TX',
        portalType: 'arcgis',
        downloadUrl: 'https://hub.arcgis.com/api/download/v1/items/abc123/geojson',
        featureCount: 10,
        lastVerified: new Date().toISOString(),
        confidence: 80,
        discoveredBy: 'automated',
      };

      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          type: 'FeatureCollection',
          features: Array(10).fill({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [] },
            properties: { DISTRICT: 1 },
          }),
        }),
      } as Response);

      const result = await validatePortal('4865000', mockPortal);

      expect(result.status).toBe('warning');
      expect(result.issues.some(i => i.includes('hub.arcgis.com download API'))).toBe(true);
      expect(result.issues.some(i => i.includes('temporary Azure blobs'))).toBe(true);
    });

    it('accepts stable FeatureServer URLs', async () => {
      const mockPortal: KnownPortal = {
        cityFips: '4865000',
        cityName: 'San Antonio',
        state: 'TX',
        portalType: 'arcgis',
        downloadUrl: 'https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/RedistrictedCouncilDistricts2022/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
        featureCount: 10,
        lastVerified: new Date().toISOString(),
        confidence: 95,
        discoveredBy: 'manual',
      };

      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          type: 'FeatureCollection',
          features: Array(10).fill({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [] },
            properties: { DISTRICT: 1 },
          }),
        }),
      } as Response);

      const result = await validatePortal('4865000', mockPortal);

      expect(result.status).toBe('healthy');
      expect(result.issues).toHaveLength(0);
    });

    it('accepts stable MapServer URLs', async () => {
      const mockPortal: KnownPortal = {
        cityFips: '4835000',
        cityName: 'Houston',
        state: 'TX',
        portalType: 'arcgis',
        downloadUrl: 'https://mycity2.houstontx.gov/pubgis02/rest/services/HoustonMap/Administrative_Boundary/MapServer/2/query?where=1%3D1&outFields=*&f=geojson',
        featureCount: 11,
        lastVerified: new Date().toISOString(),
        confidence: 95,
        discoveredBy: 'manual',
      };

      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          type: 'FeatureCollection',
          features: Array(11).fill({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [] },
            properties: { DISTRICT: 'A' },
          }),
        }),
      } as Response);

      const result = await validatePortal('4835000', mockPortal);

      expect(result.status).toBe('healthy');
      expect(result.issues).toHaveLength(0);
    });

    it('validates healthy portal (200 OK, correct feature count)', async () => {
      const mockPortal: KnownPortal = {
        cityFips: '4805000',
        cityName: 'Austin',
        state: 'TX',
        portalType: 'arcgis',
        downloadUrl: 'https://example.com/data.geojson',
        featureCount: 10,
        lastVerified: new Date().toISOString(),
        confidence: 80,
        discoveredBy: 'automated',
      };

      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          type: 'FeatureCollection',
          features: Array(10).fill({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [] },
            properties: { DISTRICT: 1 },
          }),
        }),
      } as Response);

      const result = await validatePortal('4805000', mockPortal);

      expect(result.status).toBe('healthy');
      expect(result.httpStatus).toBe(200);
      expect(result.featureCount).toBe(10);
      expect(result.featureCountMatch).toBe(true);
      expect(result.schemaValid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('detects HTTP 404 errors', async () => {
      const mockPortal: KnownPortal = {
        cityFips: '4805000',
        cityName: 'Austin',
        state: 'TX',
        portalType: 'arcgis',
        downloadUrl: 'https://example.com/data.geojson',
        featureCount: 10,
        lastVerified: new Date().toISOString(),
        confidence: 80,
        discoveredBy: 'automated',
      };

      global.fetch = vi.fn().mockResolvedValue({
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
      } as Response);

      const result = await validatePortal('4805000', mockPortal);

      expect(result.status).toBe('error');
      expect(result.httpStatus).toBe(404);
      expect(result.issues).toContain('HTTP 404: Not Found');
    });

    it('detects feature count mismatches', async () => {
      const mockPortal: KnownPortal = {
        cityFips: '4805000',
        cityName: 'Austin',
        state: 'TX',
        portalType: 'arcgis',
        downloadUrl: 'https://example.com/data.geojson',
        featureCount: 10,
        lastVerified: new Date().toISOString(),
        confidence: 80,
        discoveredBy: 'automated',
      };

      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          type: 'FeatureCollection',
          features: Array(15).fill({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [] },
            properties: { DISTRICT: 1 },
          }),
        }),
      } as Response);

      const result = await validatePortal('4805000', mockPortal);

      expect(result.status).toBe('warning');
      expect(result.featureCount).toBe(15);
      expect(result.featureCountMatch).toBe(false);
      expect(result.issues.some(i => i.includes('Feature count mismatch'))).toBe(true);
    });

    it('detects invalid GeoJSON structure', async () => {
      const mockPortal: KnownPortal = {
        cityFips: '4805000',
        cityName: 'Austin',
        state: 'TX',
        portalType: 'arcgis',
        downloadUrl: 'https://example.com/data.geojson',
        featureCount: 10,
        lastVerified: new Date().toISOString(),
        confidence: 80,
        discoveredBy: 'automated',
      };

      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          type: 'Feature', // Wrong type
          features: [],
        }),
      } as Response);

      const result = await validatePortal('4805000', mockPortal);

      expect(result.status).toBe('warning');
      expect(result.schemaValid).toBe(false);
      expect(result.issues).toContain('Invalid GeoJSON structure');
    });

    it('handles timeouts gracefully', async () => {
      const mockPortal: KnownPortal = {
        cityFips: '4805000',
        cityName: 'Austin',
        state: 'TX',
        portalType: 'arcgis',
        downloadUrl: 'https://example.com/data.geojson',
        featureCount: 10,
        lastVerified: new Date().toISOString(),
        confidence: 80,
        discoveredBy: 'automated',
      };

      global.fetch = vi.fn().mockRejectedValue(
        Object.assign(new Error('Timeout'), { name: 'AbortError' })
      );

      const result = await validatePortal('4805000', mockPortal);

      expect(result.status).toBe('error');
      expect(result.issues).toContain('Request timeout (>30s)');
    });

    it('detects missing geometry/properties', async () => {
      const mockPortal: KnownPortal = {
        cityFips: '4805000',
        cityName: 'Austin',
        state: 'TX',
        portalType: 'arcgis',
        downloadUrl: 'https://example.com/data.geojson',
        featureCount: 10,
        lastVerified: new Date().toISOString(),
        confidence: 80,
        discoveredBy: 'automated',
      };

      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              // Missing geometry and properties
            },
          ],
        }),
      } as Response);

      const result = await validatePortal('4805000', mockPortal);

      expect(result.status).toBe('warning');
      expect(result.schemaValid).toBe(false);
      expect(result.issues.some(i => i.includes('missing geometry or properties'))).toBe(true);
    });
  });

  describe('validateRegistry', () => {
    it('processes all entries with concurrency', async () => {
      const mockRegistry: Record<string, KnownPortal> = {
        '4805000': {
          cityFips: '4805000',
          cityName: 'Austin',
          state: 'TX',
          portalType: 'arcgis',
          downloadUrl: 'https://example.com/austin.geojson',
          featureCount: 10,
          lastVerified: new Date().toISOString(),
          confidence: 80,
          discoveredBy: 'automated',
        },
        '5363000': {
          cityFips: '5363000',
          cityName: 'Seattle',
          state: 'WA',
          portalType: 'arcgis',
          downloadUrl: 'https://example.com/seattle.geojson',
          featureCount: 7,
          lastVerified: new Date().toISOString(),
          confidence: 90,
          discoveredBy: 'automated',
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          type: 'FeatureCollection',
          features: Array(10).fill({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [] },
            properties: { DISTRICT: 1 },
          }),
        }),
      } as Response);

      const summary = await validateRegistry(mockRegistry, 2);

      expect(summary.totalEntries).toBe(2);
      expect(summary.results).toHaveLength(2);
      expect(summary.averageResponseTime).toBeGreaterThanOrEqual(0);
    });

    it('calculates summary statistics correctly', async () => {
      const mockRegistry: Record<string, KnownPortal> = {
        '1': {
          cityFips: '1',
          cityName: 'City1',
          state: 'TX',
          portalType: 'arcgis',
          downloadUrl: 'https://services.arcgis.com/abc/FeatureServer/0/query?f=geojson',
          featureCount: 10,
          lastVerified: new Date().toISOString(),
          confidence: 80,
          discoveredBy: 'automated',
        },
        '2': {
          cityFips: '2',
          cityName: 'City2',
          state: 'WA',
          portalType: 'arcgis',
          downloadUrl: 'https://services.arcgis.com/def/FeatureServer/1/query?f=geojson',
          featureCount: 7,
          lastVerified: new Date().toISOString(),
          confidence: 90,
          discoveredBy: 'automated',
        },
        '3': {
          cityFips: '3',
          cityName: 'City3',
          state: 'CA',
          portalType: 'arcgis',
          downloadUrl: 'https://services.arcgis.com/ghi/MapServer/2/query?f=geojson',
          featureCount: 5,
          lastVerified: new Date().toISOString(),
          confidence: 70,
          discoveredBy: 'automated',
        },
      };

      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Healthy
          return Promise.resolve({
            status: 200,
            statusText: 'OK',
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              type: 'FeatureCollection',
              features: Array(10).fill({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [] },
                properties: { DISTRICT: 1 },
              }),
            }),
          } as Response);
        } else if (callCount === 2) {
          // Warning (feature count mismatch)
          return Promise.resolve({
            status: 200,
            statusText: 'OK',
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              type: 'FeatureCollection',
              features: Array(15).fill({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [] },
                properties: { DISTRICT: 1 },
              }),
            }),
          } as Response);
        } else {
          // Error (404)
          return Promise.resolve({
            status: 404,
            statusText: 'Not Found',
            headers: new Headers(),
          } as Response);
        }
      });

      const summary = await validateRegistry(mockRegistry, 3);

      expect(summary.totalEntries).toBe(3);
      expect(summary.healthy).toBe(1);
      expect(summary.warnings).toBe(1);
      expect(summary.errors).toBe(1);
    });
  });
});
