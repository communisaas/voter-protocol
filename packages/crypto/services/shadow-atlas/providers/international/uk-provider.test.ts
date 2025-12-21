/**
 * UK Boundary Provider Tests
 *
 * Tests the UK Parliamentary Constituencies provider with both
 * mocked and real API responses.
 *
 * Test Coverage:
 * 1. Parliamentary constituency extraction
 * 2. ONS code parsing (England, Scotland, Wales, Northern Ireland)
 * 3. Region extraction (England only)
 * 4. Health checks
 * 5. Change detection
 * 6. Error handling and retries
 * 7. Integration tests (CI-skipped)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UKBoundaryProvider } from './uk-provider.js';
import type { FeatureCollection } from 'geojson';

describe('UKBoundaryProvider', () => {
  let provider: UKBoundaryProvider;

  beforeEach(() => {
    provider = new UKBoundaryProvider({ retryAttempts: 1, retryDelayMs: 10 });
  });

  describe('Provider metadata', () => {
    it('should have correct metadata', () => {
      expect(provider.country).toBe('GB');
      expect(provider.countryName).toBe('United Kingdom');
      expect(provider.dataSource).toBe('ONS (Office for National Statistics)');
      expect(provider.apiType).toBe('arcgis-rest');
      expect(provider.license).toBe('OGL');
    });

    it('should have parliamentary layer configured', () => {
      expect(provider.layers.parliamentary).toBeDefined();
      expect(provider.layers.parliamentary.expectedCount).toBe(650);
      expect(provider.layers.parliamentary.updateSchedule).toBe('event-driven');
    });
  });

  describe('extractParliamentaryConstituencies (mocked)', () => {
    it('should extract constituencies from mocked GeoJSON', async () => {
      const mockGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {
              PCON24CD: 'E14000530',
              PCON24NM: 'Aberavon',
              RGN24NM: 'Wales',
            },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-3.5, 51.5],
                  [-3.4, 51.5],
                  [-3.4, 51.6],
                  [-3.5, 51.6],
                  [-3.5, 51.5],
                ],
              ],
            },
          },
          {
            type: 'Feature',
            properties: {
              PCON24CD: 'S14000001',
              PCON24NM: 'Aberdeen North',
              RGN24NM: null,
            },
            geometry: {
              type: 'MultiPolygon',
              coordinates: [
                [
                  [
                    [-2.1, 57.1],
                    [-2.0, 57.1],
                    [-2.0, 57.2],
                    [-2.1, 57.2],
                    [-2.1, 57.1],
                  ],
                ],
              ],
            },
          },
        ],
      };

      // Mock fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockGeoJSON,
      } as Response);

      const result = await provider.extractParliamentaryConstituencies();

      expect(result.layer).toBe('parliamentary');
      expect(result.actualCount).toBe(2);
      expect(result.matched).toBe(false); // 2 !== 650
      expect(result.boundaries).toHaveLength(2);

      const aberavon = result.boundaries[0];
      expect(aberavon.id).toBe('E14000530');
      expect(aberavon.name).toBe('Aberavon');
      expect(aberavon.country).toBe('England'); // E prefix
      expect(aberavon.geometry.type).toBe('Polygon');

      const aberdeen = result.boundaries[1];
      expect(aberdeen.id).toBe('S14000001');
      expect(aberdeen.name).toBe('Aberdeen North');
      expect(aberdeen.country).toBe('Scotland'); // S prefix
      expect(aberdeen.geometry.type).toBe('MultiPolygon');
    });

    it('should determine country from ONS code prefix', async () => {
      const testCases = [
        { code: 'E14000001', expectedCountry: 'England' },
        { code: 'S14000001', expectedCountry: 'Scotland' },
        { code: 'W07000001', expectedCountry: 'Wales' },
        { code: 'N06000001', expectedCountry: 'Northern Ireland' },
      ];

      for (const { code, expectedCountry } of testCases) {
        const mockGeoJSON: FeatureCollection = {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { PCON24CD: code, PCON24NM: 'Test Constituency' },
              geometry: {
                type: 'Polygon',
                coordinates: [
                  [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 1],
                    [0, 0],
                  ],
                ],
              },
            },
          ],
        };

        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => mockGeoJSON,
        } as Response);

        const result = await provider.extractParliamentaryConstituencies();
        expect(result.boundaries[0].country).toBe(expectedCountry);
      }
    });

    it('should extract region for England constituencies', async () => {
      const mockGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {
              PCON24CD: 'E14000001',
              PCON24NM: 'Test Constituency',
              RGN24NM: 'South East',
            },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                  [0, 0],
                ],
              ],
            },
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockGeoJSON,
      } as Response);

      const result = await provider.extractParliamentaryConstituencies();
      expect(result.boundaries[0].region).toBe('South East');
    });

    it('should not extract region for non-England constituencies', async () => {
      const mockGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {
              PCON24CD: 'S14000001',
              PCON24NM: 'Test Constituency',
              RGN24NM: 'Scotland', // Should be ignored
            },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                  [0, 0],
                ],
              ],
            },
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockGeoJSON,
      } as Response);

      const result = await provider.extractParliamentaryConstituencies();
      expect(result.boundaries[0].region).toBeUndefined();
    });

    it('should filter features without valid geometry', async () => {
      const mockGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { PCON24CD: 'E14000001', PCON24NM: 'Valid' },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                  [0, 0],
                ],
              ],
            },
          },
          {
            type: 'Feature',
            properties: { PCON24CD: 'E14000002', PCON24NM: 'Invalid' },
            geometry: null, // Invalid geometry
          },
          {
            type: 'Feature',
            properties: { PCON24CD: 'E14000003', PCON24NM: 'Invalid Point' },
            geometry: {
              type: 'Point',
              coordinates: [0, 0],
            },
          } as unknown as GeoJSON.Feature['geometry'],
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockGeoJSON,
      } as Response);

      const result = await provider.extractParliamentaryConstituencies();
      expect(result.actualCount).toBe(1); // Only valid polygon
      expect(result.boundaries[0].name).toBe('Valid');
    });

    it('should handle extraction errors gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await provider.extractParliamentaryConstituencies();

      expect(result.success).toBe(false);
      expect(result.actualCount).toBe(0);
      expect(result.boundaries).toHaveLength(0);
      expect(result.error).toContain('Network error');
    });
  });

  describe('extractAll', () => {
    it('should extract all layers', async () => {
      const mockGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { PCON24CD: 'E14000001', PCON24NM: 'Test' },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                  [0, 0],
                ],
              ],
            },
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockGeoJSON,
      } as Response);

      const result = await provider.extractAll();

      expect(result.country).toBe('GB');
      expect(result.layers).toHaveLength(1);
      expect(result.totalBoundaries).toBe(1);
      expect(result.providerVersion).toBe('1.0.0');
    });
  });

  describe('hasChangedSince', () => {
    it('should return true if metadata has lastEditDate after extraction', async () => {
      const mockMetadata = {
        name: 'Parliamentary',
        count: 650,
        editingInfo: {
          lastEditDate: new Date('2025-01-01').getTime(),
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockMetadata,
      } as Response);

      const hasChanged = await provider.hasChangedSince(new Date('2024-12-01'));
      expect(hasChanged).toBe(true);
    });

    it('should return false if metadata has lastEditDate before extraction', async () => {
      const mockMetadata = {
        name: 'Parliamentary',
        count: 650,
        editingInfo: {
          lastEditDate: new Date('2024-11-01').getTime(),
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockMetadata,
      } as Response);

      const hasChanged = await provider.hasChangedSince(new Date('2024-12-01'));
      expect(hasChanged).toBe(false);
    });

    it('should return true if metadata lacks lastEditDate', async () => {
      const mockMetadata = {
        name: 'Parliamentary',
        count: 650,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockMetadata,
      } as Response);

      const hasChanged = await provider.hasChangedSince(new Date('2024-12-01'));
      expect(hasChanged).toBe(true);
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when API is available', async () => {
      const mockMetadata = {
        name: 'Parliamentary',
        count: 650,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockMetadata,
      } as Response);

      const health = await provider.healthCheck();

      expect(health.available).toBe(true);
      expect(health.latencyMs).toBeGreaterThan(0);
      expect(health.issues).toHaveLength(0);
    });

    it('should detect zero features issue', async () => {
      const mockMetadata = {
        name: 'Parliamentary',
        count: 0,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockMetadata,
      } as Response);

      const health = await provider.healthCheck();

      expect(health.available).toBe(true);
      expect(health.issues).toContain('Layer reports zero features');
    });

    it('should return unhealthy status when API is unavailable', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const health = await provider.healthCheck();

      expect(health.available).toBe(false);
      expect(health.issues.length).toBeGreaterThan(0);
      expect(health.issues[0]).toContain('Failed to fetch metadata');
    });
  });

  describe('getLayerMetadata', () => {
    it('should fetch layer metadata', async () => {
      const mockMetadata = {
        name: 'Parliamentary Constituencies',
        description: 'Westminster constituencies',
        geometryType: 'esriGeometryPolygon',
        count: 650,
        maxRecordCount: 2000,
        editingInfo: {
          lastEditDate: 1704067200000, // 2024-01-01
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockMetadata,
      } as Response);

      const metadata = await provider.getLayerMetadata('parliamentary');

      expect(metadata.name).toBe('Parliamentary Constituencies');
      expect(metadata.description).toBe('Westminster constituencies');
      expect(metadata.featureCount).toBe(650);
      expect(metadata.lastEditDate).toBe(1704067200000);
    });
  });
});

/**
 * Integration tests (CI-skipped)
 *
 * These tests hit the real ONS ArcGIS API.
 * Run locally with: npm test -- uk-provider.test.ts --run
 */
describe.skip('UKBoundaryProvider Integration', () => {
  let provider: UKBoundaryProvider;

  beforeEach(() => {
    provider = new UKBoundaryProvider();
  });

  it('should extract real parliamentary constituencies', async () => {
    const result = await provider.extractParliamentaryConstituencies();

    expect(result.actualCount).toBe(650);
    expect(result.matched).toBe(true);
    expect(result.boundaries).toHaveLength(650);

    // Verify some known constituencies
    const london = result.boundaries.filter((c) => c.country === 'England');
    expect(london.length).toBeGreaterThan(0);

    const scotland = result.boundaries.filter((c) => c.country === 'Scotland');
    expect(scotland.length).toBe(57);

    const wales = result.boundaries.filter((c) => c.country === 'Wales');
    expect(wales.length).toBe(32);

    const ni = result.boundaries.filter((c) => c.country === 'Northern Ireland');
    expect(ni.length).toBe(18);
  }, 60000); // 60s timeout for real API

  it('should pass health check against real API', async () => {
    const health = await provider.healthCheck();

    expect(health.available).toBe(true);
    expect(health.issues).toHaveLength(0);
    expect(health.latencyMs).toBeLessThan(5000);
  }, 10000);

  it('should fetch real layer metadata', async () => {
    const metadata = await provider.getLayerMetadata('parliamentary');

    expect(metadata.name).toContain('Parliamentary');
    expect(metadata.featureCount).toBeGreaterThan(0);
  }, 10000);
});
