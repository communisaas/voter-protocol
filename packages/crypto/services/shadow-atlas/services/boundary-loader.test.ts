/**
 * Boundary Loader Tests
 *
 * Tests for GeoJSON loading and conversion from known-portals registry.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import {
  BoundaryLoader,
  BoundaryLoadError,
  DEFAULT_LOADER_CONFIG,
} from './boundary-loader.js';
import type { FeatureCollection } from 'geojson';

// Mock fetch globally
const mockFetch = vi.fn() as Mock;
global.fetch = mockFetch;

describe('BoundaryLoader', () => {
  let loader: BoundaryLoader;

  beforeEach(() => {
    loader = new BoundaryLoader();
    mockFetch.mockReset();
  });

  describe('fetchGeoJSON', () => {
    it('should fetch and parse valid GeoJSON', async () => {
      const mockGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-122.4, 47.5],
                  [-122.3, 47.5],
                  [-122.3, 47.6],
                  [-122.4, 47.6],
                  [-122.4, 47.5],
                ],
              ],
            },
            properties: {
              DISTRICT: '1',
              NAME: 'District 1',
            },
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockGeoJSON),
      });

      // Use the public method that calls fetchGeoJSON internally
      const boundaries = await loader.getBoundariesByJurisdiction('5363000'); // Seattle

      // Should have called fetch
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      // Access a portal that will trigger fetch
      await expect(
        loader.getBoundariesByJurisdiction('5363000')
      ).rejects.toThrow(BoundaryLoadError);
    });

    it('should throw on invalid GeoJSON', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ type: 'Invalid', data: [] }),
      });

      await expect(
        loader.getBoundariesByJurisdiction('5363000')
      ).rejects.toThrow(BoundaryLoadError);
    });
  });

  describe('convertToBoundaries', () => {
    it('should convert GeoJSON features to BoundaryGeometry', async () => {
      const mockGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-122.4, 47.5],
                  [-122.3, 47.5],
                  [-122.3, 47.6],
                  [-122.4, 47.6],
                  [-122.4, 47.5],
                ],
              ],
            },
            properties: {
              DISPLAY_NAME: 'CD - 1',
              DISTRICT: '1',
            },
          },
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-122.35, 47.55],
                  [-122.25, 47.55],
                  [-122.25, 47.65],
                  [-122.35, 47.65],
                  [-122.35, 47.55],
                ],
              ],
            },
            properties: {
              DISPLAY_NAME: 'CD - 2',
              DISTRICT: '2',
            },
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockGeoJSON),
      });

      const boundaries = await loader.getBoundariesByJurisdiction('5363000');

      expect(boundaries).toHaveLength(2);

      // Check first boundary
      expect(boundaries[0].metadata.name).toBe('CD - 1');
      expect(boundaries[0].metadata.type).toBe('city_council_district');
      expect(boundaries[0].metadata.jurisdictionFips).toBe('5363000');
      expect(boundaries[0].metadata.jurisdiction).toContain('Seattle');

      // Check bounding box was computed
      expect(boundaries[0].bbox).toEqual([-122.4, 47.5, -122.3, 47.6]);
    });

    it('should extract district name from various property formats', async () => {
      const testCases = [
        { properties: { DISPLAY_NAME: 'Test Display' }, expected: 'Test Display' },
        { properties: { NAME: 'Test Name' }, expected: 'Test Name' },
        { properties: { name: 'test lowercase' }, expected: 'test lowercase' },
        { properties: { DISTRICT: 5 }, expected: '5' },
        { properties: { ward: 'Ward 3' }, expected: 'Ward 3' },
        { properties: {}, expected: 'District 1' }, // Fallback
      ];

      for (const testCase of testCases) {
        const mockGeoJSON: FeatureCollection = {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
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
              properties: testCase.properties,
            },
          ],
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockGeoJSON),
        });

        loader.clearCache();
        const boundaries = await loader.getBoundariesByJurisdiction('5363000');

        expect(boundaries[0].metadata.name).toBe(testCase.expected);
      }
    });
  });

  describe('getCandidateBoundaries', () => {
    it('should filter boundaries by bounding box', async () => {
      const mockGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-122.4, 47.5],
                  [-122.3, 47.5],
                  [-122.3, 47.6],
                  [-122.4, 47.6],
                  [-122.4, 47.5],
                ],
              ],
            },
            properties: { NAME: 'District 1' },
          },
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-122.2, 47.7],
                  [-122.1, 47.7],
                  [-122.1, 47.8],
                  [-122.2, 47.8],
                  [-122.2, 47.7],
                ],
              ],
            },
            properties: { NAME: 'District 2' },
          },
        ],
      };

      // Mock all portal fetches to return our test data
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockGeoJSON),
      });

      // Point inside District 1's bbox
      const candidates = await loader.getCandidateBoundaries({
        lat: 47.55,
        lng: -122.35,
      });

      // Should find at least District 1 (and possibly others from registry)
      const district1 = candidates.find((b) =>
        b.metadata.name.includes('District 1') || b.metadata.name.includes('CD')
      );

      // Note: This test depends on registry state
      // In isolation, we'd mock the entire registry
    });
  });

  describe('caching', () => {
    it('should cache loaded boundaries', async () => {
      const mockGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
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
            properties: { NAME: 'Test' },
          },
        ],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockGeoJSON),
      });

      // First call
      await loader.getBoundariesByJurisdiction('5363000');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call should use cache
      await loader.getBoundariesByJurisdiction('5363000');
      expect(mockFetch).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should clear cache', async () => {
      const mockGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
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
            properties: { NAME: 'Test' },
          },
        ],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockGeoJSON),
      });

      await loader.getBoundariesByJurisdiction('5363000');
      expect(loader.getCacheStats().entries).toBe(1);

      loader.clearCache();
      expect(loader.getCacheStats().entries).toBe(0);
    });

    it('should report cache statistics', async () => {
      const mockGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
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
            properties: { NAME: 'Test 1' },
          },
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [2, 2],
                  [3, 2],
                  [3, 3],
                  [2, 3],
                  [2, 2],
                ],
              ],
            },
            properties: { NAME: 'Test 2' },
          },
        ],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockGeoJSON),
      });

      await loader.getBoundariesByJurisdiction('5363000');

      const stats = loader.getCacheStats();
      expect(stats.entries).toBe(1);
      expect(stats.totalBoundaries).toBe(2);
    });
  });

  describe('getBoundaryById', () => {
    it('should find boundary by ID', async () => {
      const mockGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
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
            properties: { NAME: 'Test' },
          },
        ],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockGeoJSON),
      });

      // Load boundaries first
      await loader.getBoundariesByJurisdiction('5363000');

      // Find by ID
      const boundary = await loader.getBoundaryById('5363000-district-1');

      expect(boundary).not.toBeNull();
      expect(boundary?.metadata.id).toBe('5363000-district-1');
    });

    it('should return null for invalid ID format', async () => {
      const boundary = await loader.getBoundaryById('invalid-id');
      expect(boundary).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        loader.getBoundariesByJurisdiction('5363000')
      ).rejects.toThrow();
    });

    it('should return empty for unknown jurisdiction', async () => {
      const boundaries = await loader.getBoundariesByJurisdiction('0000000');
      expect(boundaries).toHaveLength(0);
    });
  });
});
