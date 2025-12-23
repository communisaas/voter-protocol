/**
 * State GIS Clearinghouse Scanner Tests
 *
 * Tests recursive service exploration for ArcGIS REST endpoints.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StateGISClearinghouseScanner } from './state-gis-clearinghouse.js';
import type { CityInfo as CityTarget } from '../validators/geographic-validator.js';

// Mock state GIS portal registry
vi.mock('../registry/state-gis-portals.js', () => ({
  getStatePortal: vi.fn((state: string) => {
    if (state === 'MA') {
      return {
        stateName: 'Massachusetts',
        portalUrl: 'https://gis.massgis.state.ma.us',
        searchStrategy: 'rest-api' as const,
        authority: 'authoritative' as const,
        portalType: 'arcgis' as const,
      };
    }
    if (state === 'CA') {
      return {
        stateName: 'California',
        portalUrl: 'https://gis.data.ca.gov',
        searchStrategy: 'rest-api' as const,
        authority: 'authoritative' as const,
        portalType: 'arcgis' as const,
      };
    }
    return null;
  }),
}));

describe('StateGISClearinghouseScanner - Recursive Service Exploration', () => {
  let scanner: StateGISClearinghouseScanner;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scanner = new StateGISClearinghouseScanner();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('exploreServicesRecursively', () => {
    it('should explore root-level services', async () => {
      const city: CityTarget = {
        name: 'Boston',
        state: 'MA',
        county: 'Suffolk',
        population: 675000,
      };

      // Mock root services response
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          folders: [],
          services: [
            { name: 'Municipal/CouncilDistricts', type: 'MapServer' },
            { name: 'Transportation/Roads', type: 'MapServer' },
          ],
        }),
      });

      // Mock service exploration (CouncilDistricts)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'CouncilDistricts',
          layers: [
            { id: 0, name: 'Boston City Council Districts' },
          ],
        }),
      });

      // Mock layer metadata
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 0,
          name: 'Boston City Council Districts',
          geometryType: 'esriGeometryPolygon',
          description: 'Official council district boundaries',
        }),
      });

      // Mock service exploration (Roads - should be skipped by governance filter)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'Roads',
          layers: [
            { id: 0, name: 'Street Network' },
          ],
        }),
      });

      const result = await scanner.scan(city);

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].title).toContain('Council District');
      expect(result[0].portalType).toBe('state-gis');
    });

    it('should recursively explore nested folders', async () => {
      const city: CityTarget = {
        name: 'Sacramento',
        state: 'CA',
        county: 'Sacramento',
        population: 525000,
      };

      // Mock root response with nested folders
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          folders: ['Administrative', 'Planning'],
          services: [],
        }),
      });

      // Mock Administrative folder
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          folders: ['Boundaries'],
          services: [],
        }),
      });

      // Mock Administrative/Boundaries folder
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          folders: [],
          services: [
            { name: 'Administrative/Boundaries/CityCouncil', type: 'FeatureServer' },
          ],
        }),
      });

      // Mock service exploration
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'CityCouncil',
          layers: [
            { id: 0, name: 'City Council Districts' },
          ],
        }),
      });

      // Mock layer metadata
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 0,
          name: 'City Council Districts',
          geometryType: 'esriGeometryPolygon',
          description: 'Municipal council district boundaries',
        }),
      });

      // Mock Planning folder (should be explored but yield nothing)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          folders: [],
          services: [],
        }),
      });

      const result = await scanner.scan(city);

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].title).toContain('Council District');
    });

    it('should enforce max recursion depth', async () => {
      const city: CityTarget = {
        name: 'Boston',
        state: 'MA',
        county: 'Suffolk',
        population: 675000,
      };

      // Create deeply nested folder structure (6 levels)
      const mockDeepFolders = (depth: number): unknown => ({
        folders: depth < 6 ? ['Level' + (depth + 1)] : [],
        services: [],
      });

      // Mock 6 levels of nesting
      for (let i = 0; i < 6; i++) {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => mockDeepFolders(i),
        });
      }

      const result = await scanner.scan(city);

      // Should stop at depth 5, so level 6 should not be fetched
      expect(fetchMock).toHaveBeenCalledTimes(5); // Stops at max depth
      expect(result).toEqual([]);
    });

    it('should skip non-governance folders', async () => {
      const city: CityTarget = {
        name: 'Boston',
        state: 'MA',
        county: 'Suffolk',
        population: 675000,
      };

      // Mock root with utilities folder (should be skipped)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          folders: ['Utilities', 'Administrative'],
          services: [],
        }),
      });

      // Administrative folder should be explored
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          folders: [],
          services: [
            { name: 'Administrative/Districts', type: 'MapServer' },
          ],
        }),
      });

      // Mock service
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'Districts',
          layers: [{ id: 0, name: 'Council Districts' }],
        }),
      });

      // Mock layer
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 0,
          name: 'Council Districts',
          geometryType: 'esriGeometryPolygon',
        }),
      });

      const result = await scanner.scan(city);

      // Should only fetch root, Administrative folder, service, and layer
      // Utilities folder should be skipped (not fetched)
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('should filter layers by governance keywords', async () => {
      const city: CityTarget = {
        name: 'Boston',
        state: 'MA',
        county: 'Suffolk',
        population: 675000,
      };

      // Mock root
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          folders: [],
          services: [
            { name: 'Administrative/Mixed', type: 'MapServer' },
          ],
        }),
      });

      // Mock service with mixed layers
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'Mixed',
          layers: [
            { id: 0, name: 'Council Districts' }, // Should be included
            { id: 1, name: 'Zoning Boundaries' }, // Should be filtered out (no governance keyword)
            { id: 2, name: 'Voting Precincts' }, // Should be included
          ],
        }),
      });

      // Mock Council Districts layer
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 0,
          name: 'Council Districts',
          geometryType: 'esriGeometryPolygon',
        }),
      });

      // Mock Voting Precincts layer
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 2,
          name: 'Voting Precincts',
          geometryType: 'esriGeometryPolygon',
        }),
      });

      const result = await scanner.scan(city);

      // Should have 2 candidates (Council Districts and Voting Precincts)
      expect(result.length).toBe(2);
      expect(result.some(r => r.title.includes('Council'))).toBe(true);
      expect(result.some(r => r.title.includes('Voting'))).toBe(true);
    });

    it('should filter out non-polygon layers', async () => {
      const city: CityTarget = {
        name: 'Boston',
        state: 'MA',
        county: 'Suffolk',
        population: 675000,
      };

      // Mock root
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          folders: [],
          services: [
            { name: 'Points/Locations', type: 'MapServer' },
          ],
        }),
      });

      // Mock service with point layer
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'Locations',
          layers: [
            { id: 0, name: 'District Offices' }, // Point layer with governance keyword
          ],
        }),
      });

      // Mock point layer metadata
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 0,
          name: 'District Offices',
          geometryType: 'esriGeometryPoint', // Not a polygon
        }),
      });

      const result = await scanner.scan(city);

      // Should filter out point layer
      expect(result).toEqual([]);
    });

    it('should handle rate limiting correctly', async () => {
      const city: CityTarget = {
        name: 'Boston',
        state: 'MA',
        county: 'Suffolk',
        population: 675000,
      };

      const startTime = Date.now();

      // Mock multiple service requests
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          folders: [],
          services: [
            { name: 'Service1', type: 'MapServer' },
            { name: 'Service2', type: 'MapServer' },
          ],
        }),
      });

      // Mock services (both return empty layers)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ layers: [] }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ layers: [] }),
      });

      await scanner.scan(city);

      const elapsed = Date.now() - startTime;

      // Should have at least 200ms delay (2 services × 100ms rate limit)
      expect(elapsed).toBeGreaterThanOrEqual(200);
    });

    it('should handle fetch errors gracefully', async () => {
      const city: CityTarget = {
        name: 'Boston',
        state: 'MA',
        county: 'Suffolk',
        population: 675000,
      };

      // Mock root with error
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await scanner.scan(city);

      // Should return empty array, not throw
      expect(result).toEqual([]);
    });

    it('should handle HTTP errors gracefully', async () => {
      const city: CityTarget = {
        name: 'Boston',
        state: 'MA',
        county: 'Suffolk',
        population: 675000,
      };

      // Mock root with 500 error
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await scanner.scan(city);

      // Should return empty array
      expect(result).toEqual([]);
    });

    it('should apply semantic scoring to layer titles', async () => {
      const city: CityTarget = {
        name: 'Boston',
        state: 'MA',
        county: 'Suffolk',
        population: 675000,
      };

      // Mock root
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          folders: [],
          services: [
            { name: 'Admin/Boundaries', type: 'MapServer' },
          ],
        }),
      });

      // Mock service
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'Boundaries',
          layers: [
            { id: 0, name: 'Boston City Council Districts' }, // High score
            { id: 1, name: 'District' }, // Low score (too generic)
          ],
        }),
      });

      // Mock high-scoring layer
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 0,
          name: 'Boston City Council Districts',
          geometryType: 'esriGeometryPolygon',
        }),
      });

      // Mock low-scoring layer
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 1,
          name: 'District',
          geometryType: 'esriGeometryPolygon',
        }),
      });

      const result = await scanner.scan(city);

      // Should only include high-scoring layer (score ≥ 30)
      expect(result.length).toBe(1);
      expect(result[0].title).toBe('Boston City Council Districts');
      expect(result[0].score).toBeGreaterThanOrEqual(45); // 30 base + 15 state boost
    });

    it('should generate correct download URLs', async () => {
      const city: CityTarget = {
        name: 'Boston',
        state: 'MA',
        county: 'Suffolk',
        population: 675000,
      };

      // Mock root
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          folders: [],
          services: [
            { name: 'Municipal/CouncilDistricts', type: 'FeatureServer' },
          ],
        }),
      });

      // Mock service
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'CouncilDistricts',
          layers: [
            { id: 5, name: 'Boston City Council Districts' },
          ],
        }),
      });

      // Mock layer
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 5,
          name: 'Boston City Council Districts',
          geometryType: 'esriGeometryPolygon',
        }),
      });

      const result = await scanner.scan(city);

      expect(result.length).toBe(1);
      expect(result[0].downloadUrl).toContain('/Municipal/CouncilDistricts/FeatureServer/5/query');
      expect(result[0].downloadUrl).toContain('where=1%3D1');
      expect(result[0].downloadUrl).toContain('outFields=*');
      expect(result[0].downloadUrl).toContain('f=geojson');
    });
  });
});
