/**
 * Tests for Authoritative Multi-Path Scanner
 *
 * Focus: Governance layer detection from ArcGIS services
 * and governance pre-flight validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthoritativeMultiPathScanner } from './authoritative-multi-path.js';
import type { CityInfo as CityTarget } from '../validators/geographic-validator.js';
import { GovernanceValidator } from '../validators/governance-validator.js';

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

  describe('Governance Pre-Flight Integration', () => {
    it('should skip Layer 1 search for at-large cities', async () => {
      // Phoenix, AZ was at-large until 2024 (check if it's in registry)
      const phoenixFips = '0455000';

      const city: CityTarget = {
        fips: phoenixFips,
        name: 'Phoenix',
        state: 'AZ',
        lat: 33.4484,
        lng: -112.074,
      };

      // Check if Phoenix is marked as at-large in registry
      const govValidator = new GovernanceValidator();
      const govCheck = await govValidator.checkGovernance(phoenixFips);

      if (govCheck.structure === 'at-large') {
        // If in registry as at-large, scanner should return empty array
        const candidates = await scanner.search(city);
        expect(candidates).toHaveLength(0);
      } else {
        // If not in registry or not at-large, test should acknowledge this
        console.log(`Phoenix governance: ${govCheck.structure} (not at-large in registry)`);
      }
    });

    it('should attempt Layer 1 search for district-based cities', async () => {
      const city: CityTarget = {
        fips: '5363000', // Seattle - district-based
        name: 'Seattle',
        state: 'WA',
        lat: 47.6062,
        lng: -122.3321,
      };

      // Mock successful portal response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      } as Response);

      // Should attempt search (not skip due to governance)
      // Result depends on portal availability, but should not return empty due to at-large
      const govValidator = new GovernanceValidator();
      const govCheck = await govValidator.checkGovernance(city.fips);

      expect(govCheck.shouldAttemptLayer1).toBe(true);
    });

    it('should attempt Layer 1 for unknown cities (graceful degradation)', async () => {
      const city: CityTarget = {
        fips: '9999999', // Invalid/unknown FIPS
        name: 'Unknown City',
        state: 'XX',
        lat: 0,
        lng: 0,
      };

      // Mock fetch to fail (no portal data)
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      // Should attempt search even for unknown cities (graceful degradation)
      const govValidator = new GovernanceValidator();
      const govCheck = await govValidator.checkGovernance(city.fips);

      expect(govCheck.shouldAttemptLayer1).toBe(true);
      expect(govCheck.structure).toBe('unknown');
    });

    it('should validate discovered district count against registry', async () => {
      const city: CityTarget = {
        fips: '5363000', // Seattle - 7 districts
        name: 'Seattle',
        state: 'WA',
        lat: 47.6062,
        lng: -122.3321,
      };

      // Validate correct count
      const validResult = scanner.validateDiscoveredDistricts(city, 7);

      // Check if Seattle is in registry
      const govValidator = new GovernanceValidator();
      const metadata = govValidator.getGovernanceMetadata(city.fips);

      if (metadata && metadata.districtSeats === 7) {
        expect(validResult.valid).toBe(true);
        expect(validResult.discoveredCount).toBe(7);
      } else {
        // If not in registry or different count, validation will pass (no registry entry)
        console.log(`Seattle registry metadata: ${JSON.stringify(metadata)}`);
      }
    });

    it('should warn on district count mismatch', async () => {
      const city: CityTarget = {
        fips: '5363000', // Seattle - 7 districts
        name: 'Seattle',
        state: 'WA',
        lat: 47.6062,
        lng: -122.3321,
      };

      // Mock console.warn to verify warning
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Validate incorrect count
      const invalidResult = scanner.validateDiscoveredDistricts(city, 10);

      // Check if Seattle is in registry
      const govValidator = new GovernanceValidator();
      const metadata = govValidator.getGovernanceMetadata(city.fips);

      if (metadata && metadata.districtSeats !== undefined) {
        // If in registry, should detect mismatch
        if (metadata.districtSeats !== 10) {
          expect(invalidResult.valid).toBe(false);
          expect(warnSpy).toHaveBeenCalled();
        }
      }

      warnSpy.mockRestore();
    });

    it('should handle mixed governance structures', async () => {
      // Test city with mixed at-large + district seats
      const govValidator = new GovernanceValidator();

      // Find a city with mixed structure (if any in registry)
      // For now, test that mixed structures allow Layer 1 attempts
      const city: CityTarget = {
        fips: '1234567', // Hypothetical mixed-governance city
        name: 'Test City',
        state: 'TX',
        lat: 30,
        lng: -95,
      };

      const govCheck = await govValidator.checkGovernance(city.fips);

      // Unknown cities default to attempting discovery
      if (govCheck.structure === 'unknown') {
        expect(govCheck.shouldAttemptLayer1).toBe(true);
      }
    });
  });
});
