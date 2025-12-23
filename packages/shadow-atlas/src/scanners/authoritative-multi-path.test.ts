/**
 * Tests for Authoritative Multi-Path Scanner
 *
 * Focus: Governance layer detection from ArcGIS services
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthoritativeMultiPathScanner } from './authoritative-multi-path.js';
import type { CityInfo as CityTarget } from '../validators/geographic-validator.js';

describe('AuthoritativeMultiPathScanner - Layer Detection', () => {
  let scanner: AuthoritativeMultiPathScanner;

  beforeEach(() => {
    scanner = new AuthoritativeMultiPathScanner();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('findGovernanceLayers()', () => {
    it('should identify council district layers with high confidence', async () => {
      // Mock ArcGIS layers response
      const mockLayersResponse = {
        layers: [
          {
            id: 0,
            name: 'City Council Districts',
            type: 'Feature Layer',
            geometryType: 'esriGeometryPolygon',
            description: 'Current city council district boundaries',
          },
          {
            id: 1,
            name: 'Census Tracts',
            type: 'Feature Layer',
            geometryType: 'esriGeometryPolygon',
          },
          {
            id: 2,
            name: 'Street Centerlines',
            type: 'Feature Layer',
            geometryType: 'esriGeometryPolyline',
          },
        ],
      };

      // Mock fetch for /layers endpoint
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockLayersResponse,
      } as Response);

      const city: CityTarget = {
        fips: '5363000',
        name: 'Seattle',
        state: 'WA',
        lat: 47.6062,
        lng: -122.3321,
      };

      // Access private method via type assertion
      const candidates = await (scanner as any).findGovernanceLayers(
        'https://gis.seattle.gov/server/rest/services/CityGIS/MapServer',
        city
      );

      expect(candidates).toHaveLength(1);
      expect(candidates[0].name).toBe('City Council Districts');
      expect(candidates[0].confidenceScore).toBeGreaterThanOrEqual(95);
      expect(candidates[0].geometryType).toBe('esriGeometryPolygon');
      expect(candidates[0].matchedKeywords).toContain('city council');
    });

    it('should filter out non-polygon layers', async () => {
      const mockLayersResponse = {
        layers: [
          {
            id: 0,
            name: 'Council District Boundaries',
            type: 'Feature Layer',
            geometryType: 'esriGeometryPolyline', // Line, not polygon
          },
          {
            id: 1,
            name: 'Council Office Points',
            type: 'Feature Layer',
            geometryType: 'esriGeometryPoint', // Point, not polygon
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockLayersResponse,
      } as Response);

      const city: CityTarget = {
        fips: '5363000',
        name: 'Seattle',
        state: 'WA',
        lat: 47.6062,
        lng: -122.3321,
      };

      const candidates = await (scanner as any).findGovernanceLayers(
        'https://gis.seattle.gov/server/rest/services/Test/MapServer',
        city
      );

      expect(candidates).toHaveLength(0);
    });

    it('should score wards with high confidence', async () => {
      const mockLayersResponse = {
        layers: [
          {
            id: 0,
            name: 'City Wards',
            type: 'Feature Layer',
            geometryType: 'esriGeometryPolygon',
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockLayersResponse,
      } as Response);

      const city: CityTarget = {
        fips: '3651000',
        name: 'New York',
        state: 'NY',
        lat: 40.7128,
        lng: -74.006,
      };

      const candidates = await (scanner as any).findGovernanceLayers(
        'https://maps.nyc.gov/arcgis/rest/services/Boundaries/MapServer',
        city
      );

      expect(candidates).toHaveLength(1);
      expect(candidates[0].name).toBe('City Wards');
      expect(candidates[0].confidenceScore).toBeGreaterThanOrEqual(90);
    });

    it('should reject layers with low confidence scores', async () => {
      const mockLayersResponse = {
        layers: [
          {
            id: 0,
            name: 'Administrative Zones', // Low confidence keyword
            type: 'Feature Layer',
            geometryType: 'esriGeometryPolygon',
          },
          {
            id: 1,
            name: 'Planning Areas', // No governance keywords
            type: 'Feature Layer',
            geometryType: 'esriGeometryPolygon',
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockLayersResponse,
      } as Response);

      const city: CityTarget = {
        fips: '4865000',
        name: 'Austin',
        state: 'TX',
        lat: 30.2672,
        lng: -97.7431,
      };

      const candidates = await (scanner as any).findGovernanceLayers(
        'https://gis.austintexas.gov/arcgis/rest/services/Boundaries/MapServer',
        city
      );

      // Should reject "Planning Areas", may accept "Administrative Zones" if zone score >= 40
      // Based on current scoring: zone = 20 (too low)
      expect(candidates).toHaveLength(0);
    });

    it('should rank multiple candidates by confidence score', async () => {
      const mockLayersResponse = {
        layers: [
          {
            id: 0,
            name: 'District Boundaries',
            type: 'Feature Layer',
            geometryType: 'esriGeometryPolygon',
          },
          {
            id: 1,
            name: 'City Council Districts',
            type: 'Feature Layer',
            geometryType: 'esriGeometryPolygon',
          },
          {
            id: 2,
            name: 'Municipal Wards',
            type: 'Feature Layer',
            geometryType: 'esriGeometryPolygon',
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockLayersResponse,
      } as Response);

      const city: CityTarget = {
        fips: '1714000',
        name: 'Chicago',
        state: 'IL',
        lat: 41.8781,
        lng: -87.6298,
      };

      const candidates = await (scanner as any).findGovernanceLayers(
        'https://gis.chicago.gov/arcgis/rest/services/MapServer',
        city
      );

      expect(candidates.length).toBeGreaterThan(0);

      // Should be ranked: City Council Districts matches "council district" (100)
      // Municipal Wards matches "ward" (90)
      // District Boundaries matches "district" (50)
      expect(candidates[0].name).toBe('City Council Districts');
      expect(candidates[0].confidenceScore).toBe(100); // "council district" keyword = 100
    });

    it('should handle fetch errors gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const city: CityTarget = {
        fips: '0644000',
        name: 'Los Angeles',
        state: 'CA',
        lat: 34.0522,
        lng: -118.2437,
      };

      const candidates = await (scanner as any).findGovernanceLayers(
        'https://invalid-url.example.com/arcgis/rest/services/MapServer',
        city
      );

      expect(candidates).toHaveLength(0);
    });

    it('should handle timeout with AbortSignal', async () => {
      // Mock fetch to reject with AbortError (timeout scenario)
      global.fetch = vi.fn().mockRejectedValue(new DOMException('AbortError', 'AbortError'));

      const city: CityTarget = {
        fips: '4805000',
        name: 'Dallas',
        state: 'TX',
        lat: 32.7767,
        lng: -96.797,
      };

      const candidates = await (scanner as any).findGovernanceLayers(
        'https://gis.dallas.gov/arcgis/rest/services/MapServer',
        city
      );

      // Should return empty array on timeout
      expect(candidates).toHaveLength(0);
    });

    it('should match multiple keywords and use highest score', async () => {
      const mockLayersResponse = {
        layers: [
          {
            id: 0,
            name: 'Council District Boundary', // Multiple keywords
            type: 'Feature Layer',
            geometryType: 'esriGeometryPolygon',
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockLayersResponse,
      } as Response);

      const city: CityTarget = {
        fips: '2507000',
        name: 'Boston',
        state: 'MA',
        lat: 42.3601,
        lng: -71.0589,
      };

      const candidates = await (scanner as any).findGovernanceLayers(
        'https://bostonopendata-boston.opendata.arcgis.com/MapServer',
        city
      );

      expect(candidates).toHaveLength(1);
      // "Council District Boundary" matches "council district" (100 points)
      // This is the highest scoring keyword, so confidence = 100
      expect(candidates[0].confidenceScore).toBe(100);
      expect(candidates[0].matchedKeywords.length).toBeGreaterThan(1);
    });
  });
});
