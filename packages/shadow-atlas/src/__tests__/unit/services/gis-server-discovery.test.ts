/**
 * GIS Server Discovery Tests
 *
 * Validates server probing, recursive folder exploration, and layer enumeration.
 *
 * Test Strategy:
 * 1. Server probing: Detect ArcGIS, detect GeoServer, handle failures
 * 2. Folder recursion: Explore nested folders, depth limit enforcement
 * 3. Layer enumeration: Parse service metadata, handle errors gracefully
 * 4. Integration: End-to-end Portland voting districts discovery
 *
 * MOCK STRATEGY: Tests use mocked fetch to avoid network dependencies.
 * Real integration tests for external GIS servers should be in /integration suite.
 *
 * TYPE SAFETY: Nuclear-level strictness - no `any`, no loose casts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GISServerDiscovery } from '../../../services/gis-server-discovery.js';
import type { CityTarget } from '../providers/us-council-district-discovery.js';

/**
 * Test cities with known GIS servers
 */
const TEST_CITIES = {
  portland: {
    fips: '4159000',
    name: 'Portland',
    state: 'OR',
  } as CityTarget,

  seattle: {
    fips: '5363000',
    name: 'Seattle',
    state: 'WA',
  } as CityTarget,

  nonexistent: {
    fips: '9999999',
    name: 'NonexistentCity',
    state: 'XX',
  } as CityTarget,
};

/**
 * Mock fetch responses for different endpoint types
 */
const MOCK_RESPONSES = {
  arcgisRoot: {
    currentVersion: 11.1,
    folders: ['Public', 'Transportation'],
    services: [
      { name: 'Basemap', type: 'MapServer' },
    ],
  },
  arcgisPublicFolder: {
    currentVersion: 11.1,
    folders: [],
    services: [
      { name: 'Public/Boundaries', type: 'MapServer' },
      { name: 'Public/VotingDistricts', type: 'FeatureServer' },
    ],
  },
  arcgisTransportationFolder: {
    currentVersion: 11.1,
    folders: [],
    services: [
      { name: 'Transportation/Streets', type: 'MapServer' },
    ],
  },
  arcgisService: {
    mapName: 'Voting Districts',
    layers: [
      { id: 0, name: 'Voting Districts' },
      { id: 1, name: 'Polling Places' },
    ],
  },
  arcgisLayerDetails: {
    id: 0,
    name: 'Voting Districts',
    type: 'Feature Layer',
    geometryType: 'esriGeometryPolygon',
    fields: [
      { name: 'DISTRICT', type: 'esriFieldTypeString', alias: 'District Number' },
      { name: 'OBJECTID', type: 'esriFieldTypeOID', alias: 'Object ID' },
    ],
    extent: {
      xmin: -122.8,
      ymin: 45.4,
      xmax: -122.5,
      ymax: 45.6,
      spatialReference: { wkid: 4326 },
    },
    advancedQueryCapabilities: {
      standardizedQueries: true,
    },
  },
  arcgisFeatureCount: {
    count: 4,
  },
  geoserverVersion: {
    about: {
      resource: [
        { Version: '2.20.0' },
      ],
    },
  },
};

describe('GISServerDiscovery', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  describe('Server Probing', () => {
    it('should detect ArcGIS server at Portland', async () => {
      // Mock successful ArcGIS response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => MOCK_RESPONSES.arcgisRoot,
      } as Response);

      const discovery = new GISServerDiscovery();
      const endpoint = await discovery.probeServer('https://www.portlandmaps.com/');

      expect(endpoint).not.toBeNull();
      if (endpoint !== null) {
        expect(endpoint.serverType).toBe('ArcGIS');
        expect(endpoint.isHealthy).toBe(true);
        expect(endpoint.url).toContain('arcgis/rest/services');
        expect(endpoint.version).toBe('11.1');
      }
    });

    it('should return null for non-existent server', async () => {
      // Mock network error (server doesn't exist)
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const discovery = new GISServerDiscovery();
      const endpoint = await discovery.probeServer('https://nonexistent-gis-server-12345.gov/');

      expect(endpoint).toBeNull();
    });

    it('should respect timeout on slow servers', async () => {
      // Mock slow server that aborts on timeout
      let abortCalled = false;
      global.fetch = vi.fn().mockImplementation((url: string, options?: { signal?: AbortSignal }) => {
        return new Promise((resolve, reject) => {
          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              abortCalled = true;
              reject(new Error('Aborted'));
            });
          }
          // Never resolve naturally - should be aborted by timeout
          setTimeout(() => resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisRoot,
          } as Response), 10000); // 10s delay
        });
      });

      const discovery = new GISServerDiscovery({ timeout: 1000 }); // 1s timeout
      const startTime = Date.now();

      await discovery.probeServer('https://slow-server.gov/');

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(3000); // Should timeout quickly (allow 2x buffer for test stability)
      expect(abortCalled).toBe(true); // Verify abort was called
    });

    it('should detect GeoServer', async () => {
      // Mock ArcGIS failure, then GeoServer success
      global.fetch = vi.fn()
        .mockRejectedValueOnce(new Error('Not ArcGIS'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_RESPONSES.geoserverVersion,
        } as Response);

      const discovery = new GISServerDiscovery();
      const endpoint = await discovery.probeServer('https://geoserver.example.com/');

      expect(endpoint).not.toBeNull();
      if (endpoint !== null) {
        expect(endpoint.serverType).toBe('GeoServer');
        expect(endpoint.version).toBe('2.20.0');
        expect(endpoint.isHealthy).toBe(true);
      }
    });
  });

  describe('Server Discovery', () => {
    it('should discover municipal GIS servers for Portland', async () => {
      // Mock successful response for Portland-specific URLs
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('portlandmaps.com')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisRoot,
          } as Response);
        }
        // All other URLs fail
        return Promise.reject(new Error('Not found'));
      });

      const discovery = new GISServerDiscovery();
      const servers = await discovery.discoverServers(TEST_CITIES.portland);

      expect(servers.length).toBeGreaterThan(0);
      expect(servers.some(s => s.serverType === 'ArcGIS')).toBe(true);
      expect(servers.some(s => s.isHealthy === true)).toBe(true);
    });

    it('should handle cities with no GIS server gracefully', async () => {
      // Mock all requests failing
      global.fetch = vi.fn().mockRejectedValue(new Error('Not found'));

      const discovery = new GISServerDiscovery();
      const servers = await discovery.discoverServers(TEST_CITIES.nonexistent);

      expect(servers).toBeDefined();
      expect(Array.isArray(servers)).toBe(true);
      expect(servers.length).toBe(0);
    });

    it('should respect rate limiting', async () => {
      const requestTimestamps: number[] = [];

      global.fetch = vi.fn().mockImplementation(() => {
        requestTimestamps.push(Date.now());
        return Promise.resolve({
          ok: true,
          json: async () => MOCK_RESPONSES.arcgisRoot,
        } as Response);
      });

      const discovery = new GISServerDiscovery({ maxRequestsPerSecond: 2 });
      const startTime = Date.now();

      // Make 6 sequential requests to test rate limiting
      for (let i = 0; i < 6; i++) {
        await discovery.probeServer('https://www.portlandmaps.com/');
      }

      const elapsed = Date.now() - startTime;

      // With 2 req/sec, 6 requests should take at least 2 seconds
      // (0ms, 0ms, 500ms, 500ms, 1000ms, 1000ms wait times)
      expect(elapsed).toBeGreaterThanOrEqual(2000);

      // Verify that requests were spaced out properly
      // First 2 should be immediate, next 2 after ~500ms, last 2 after ~1000ms
      if (requestTimestamps.length >= 6) {
        const gap1 = requestTimestamps[2] - requestTimestamps[0];
        const gap2 = requestTimestamps[4] - requestTimestamps[0];
        expect(gap1).toBeGreaterThan(400); // ~500ms gap
        expect(gap2).toBeGreaterThan(900); // ~1000ms gap
      }
    });
  });

  describe('Folder Exploration', () => {
    it('should recursively explore ArcGIS folder structure', async () => {
      // Mock progressive folder exploration
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('?f=json') && !url.includes('/Public') && !url.includes('/Transportation')) {
          // Root folder
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisRoot,
          } as Response);
        } else if (url.includes('/Public?f=json')) {
          // Public subfolder
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisPublicFolder,
          } as Response);
        } else if (url.includes('/Transportation?f=json')) {
          // Transportation subfolder
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisTransportationFolder,
          } as Response);
        } else if (url.includes('MapServer?f=json') || url.includes('FeatureServer?f=json')) {
          // Service metadata
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisService,
          } as Response);
        } else if (url.includes('/0?f=json') || url.includes('/1?f=json')) {
          // Layer details
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisLayerDetails,
          } as Response);
        } else if (url.includes('returnCountOnly=true')) {
          // Feature count
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisFeatureCount,
          } as Response);
        }
        return Promise.reject(new Error('Unknown endpoint'));
      });

      const discovery = new GISServerDiscovery();
      const services = await discovery.exploreArcGISFolders(
        'https://www.portlandmaps.com/arcgis/rest/services'
      );

      expect(services.length).toBeGreaterThan(0);
      expect(services.some(s => s.name.includes('Voting') || s.name.includes('Boundaries'))).toBe(true);
    });

    it('should enumerate layers in discovered services', async () => {
      // Mock service and layer exploration
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/Public?f=json')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisPublicFolder,
          } as Response);
        } else if (url.includes('MapServer?f=json') || url.includes('FeatureServer?f=json')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisService,
          } as Response);
        } else if (url.includes('/0?f=json') || url.includes('/1?f=json')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisLayerDetails,
          } as Response);
        } else if (url.includes('returnCountOnly=true')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisFeatureCount,
          } as Response);
        }
        return Promise.reject(new Error('Unknown endpoint'));
      });

      const discovery = new GISServerDiscovery();
      const services = await discovery.exploreArcGISFolders(
        'https://www.portlandmaps.com/arcgis/rest/services',
        'Public'
      );

      expect(services.length).toBeGreaterThan(0);

      const serviceWithLayers = services.find(s => s.layers.length > 0);
      expect(serviceWithLayers).toBeDefined();
      if (serviceWithLayers) {
        expect(serviceWithLayers.layers.length).toBeGreaterThan(0);
      }
    });

    it('should respect max depth limit', async () => {
      // Mock infinite folder nesting
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('?f=json')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              currentVersion: 11.1,
              folders: ['Nested'], // Always return a nested folder
              services: [],
            }),
          } as Response);
        }
        return Promise.reject(new Error('Unknown endpoint'));
      });

      const discovery = new GISServerDiscovery({ maxDepth: 2 });
      const services = await discovery.exploreArcGISFolders(
        'https://www.portlandmaps.com/arcgis/rest/services'
      );

      // Should complete without infinite recursion
      expect(services).toBeDefined();
      expect(Array.isArray(services)).toBe(true);
    });

    it('should handle empty folders gracefully', async () => {
      // Mock empty folder response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          currentVersion: 11.1,
          folders: [],
          services: [],
        }),
      } as Response);

      const discovery = new GISServerDiscovery();
      const services = await discovery.exploreArcGISFolders(
        'https://www.portlandmaps.com/arcgis/rest/services',
        'NonexistentFolder12345'
      );

      expect(services).toBeDefined();
      expect(Array.isArray(services)).toBe(true);
      expect(services.length).toBe(0);
    });
  });

  describe('Layer Metadata', () => {
    it('should extract layer metadata including fields', async () => {
      // Mock service and layer exploration
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/Public?f=json')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisPublicFolder,
          } as Response);
        } else if (url.includes('MapServer?f=json') || url.includes('FeatureServer?f=json')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisService,
          } as Response);
        } else if (url.includes('/0?f=json') || url.includes('/1?f=json')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisLayerDetails,
          } as Response);
        } else if (url.includes('returnCountOnly=true')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisFeatureCount,
          } as Response);
        }
        return Promise.reject(new Error('Unknown endpoint'));
      });

      const discovery = new GISServerDiscovery();
      const services = await discovery.exploreArcGISFolders(
        'https://www.portlandmaps.com/arcgis/rest/services',
        'Public'
      );

      expect(services.length).toBeGreaterThan(0);

      const serviceWithLayers = services.find(s => s.layers.length > 0);
      expect(serviceWithLayers).toBeDefined();

      if (serviceWithLayers) {
        const layer = serviceWithLayers.layers[0];

        // Validate layer structure
        expect(layer).toBeDefined();
        expect(typeof layer.id).toBe('number');
        expect(typeof layer.name).toBe('string');
        expect(layer.url).toContain('MapServer');
        expect(Array.isArray(layer.fields)).toBe(true);

        // Check geometry type
        if (layer.geometryType !== null) {
          expect(typeof layer.geometryType).toBe('string');
        }

        // Check fields
        expect(layer.fields.length).toBeGreaterThan(0);
        const field = layer.fields[0];
        expect(typeof field.name).toBe('string');
        expect(typeof field.type).toBe('string');
      }
    });

    it('should get feature count when available', async () => {
      // Mock service and layer exploration with feature count
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/Public?f=json')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisPublicFolder,
          } as Response);
        } else if (url.includes('MapServer?f=json') || url.includes('FeatureServer?f=json')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisService,
          } as Response);
        } else if (url.includes('/0?f=json') || url.includes('/1?f=json')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisLayerDetails,
          } as Response);
        } else if (url.includes('returnCountOnly=true')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisFeatureCount,
          } as Response);
        }
        return Promise.reject(new Error('Unknown endpoint'));
      });

      const discovery = new GISServerDiscovery();
      const services = await discovery.exploreArcGISFolders(
        'https://www.portlandmaps.com/arcgis/rest/services',
        'Public'
      );

      // Find a layer with features
      let foundLayerWithCount = false;
      for (const service of services) {
        for (const layer of service.layers) {
          if (layer.featureCount !== null && layer.featureCount > 0) {
            foundLayerWithCount = true;
            expect(typeof layer.featureCount).toBe('number');
            expect(layer.featureCount).toBeGreaterThan(0);
            break;
          }
        }
        if (foundLayerWithCount) break;
      }

      // At least one layer should have a feature count
      expect(foundLayerWithCount).toBe(true);
    });
  });

  describe('Integration: Portland Voting Districts', () => {
    it('should discover Portland voting districts via direct GIS exploration', async () => {
      // Mock complete discovery workflow
      global.fetch = vi.fn().mockImplementation((url: string) => {
        // Server discovery
        if (url.includes('portlandmaps.com/arcgis/rest/services?f=json')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisRoot,
          } as Response);
        }
        // Root folder exploration
        else if (url.includes('arcgis/rest/services?f=json') && !url.includes('/Public')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisRoot,
          } as Response);
        }
        // Public folder
        else if (url.includes('/Public?f=json')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisPublicFolder,
          } as Response);
        }
        // Transportation folder
        else if (url.includes('/Transportation?f=json')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisTransportationFolder,
          } as Response);
        }
        // Service metadata
        else if (url.includes('MapServer?f=json') || url.includes('FeatureServer?f=json')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisService,
          } as Response);
        }
        // Layer details
        else if (url.includes('/0?f=json') || url.includes('/1?f=json')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisLayerDetails,
          } as Response);
        }
        // Feature count
        else if (url.includes('returnCountOnly=true')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisFeatureCount,
          } as Response);
        }
        // GeoServer probe (fails)
        return Promise.reject(new Error('Not found'));
      });

      const discovery = new GISServerDiscovery();

      // Step 1: Discover servers
      const servers = await discovery.discoverServers(TEST_CITIES.portland);
      expect(servers.length).toBeGreaterThan(0);

      // Step 2: Find ArcGIS server
      const arcgisServer = servers.find(s => s.serverType === 'ArcGIS');
      expect(arcgisServer).toBeDefined();

      if (!arcgisServer) {
        throw new Error('ArcGIS server not found for Portland');
      }

      // Step 3: Explore folder structure
      const services = await discovery.exploreArcGISFolders(arcgisServer.url);
      expect(services.length).toBeGreaterThan(0);

      // Step 4: Collect all layers
      const allLayers = services.flatMap(service => service.layers);
      expect(allLayers.length).toBeGreaterThan(0);

      // Step 5: Find voting district layer
      const votingLayer = allLayers.find(layer =>
        layer.name.toLowerCase().includes('voting') ||
        layer.name.toLowerCase().includes('district')
      );

      expect(votingLayer).toBeDefined();
      if (votingLayer) {
        expect(votingLayer.geometryType).toContain('Polygon');
        expect(votingLayer.url).toContain('MapServer');

        // Portland has 4 voting districts (as of 2024)
        if (votingLayer.featureCount !== null) {
          expect(votingLayer.featureCount).toBeGreaterThanOrEqual(3);
          expect(votingLayer.featureCount).toBeLessThanOrEqual(6);
        }
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON responses gracefully', async () => {
      // Mock invalid JSON
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      } as Response);

      const discovery = new GISServerDiscovery();
      const result = await discovery.probeServer('https://example.com/');

      expect(result).toBeNull();
    });

    it('should handle network errors gracefully', async () => {
      // Mock network error
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const discovery = new GISServerDiscovery();
      const result = await discovery.probeServer('https://invalid-domain-12345.fake/');

      expect(result).toBeNull();
    });

    it('should handle 404 responses gracefully', async () => {
      // Mock 404 response
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      const discovery = new GISServerDiscovery();
      const services = await discovery.exploreArcGISFolders(
        'https://www.portlandmaps.com/arcgis/rest/services',
        'InvalidFolder404'
      );

      expect(services).toBeDefined();
      expect(Array.isArray(services)).toBe(true);
      expect(services.length).toBe(0);
    });
  });

  describe('State Endpoint Discovery', () => {
    it('should discover state legislative endpoints', async () => {
      // Mock successful discovery
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('arcgis/rest/services?f=json')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_RESPONSES.arcgisRoot,
          } as Response);
        } else if (url.includes('?f=json') && !url.includes('MapServer') && !url.includes('FeatureServer')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              currentVersion: 11.1,
              folders: [],
              services: [
                { name: 'CongressionalDistricts', type: 'FeatureServer' },
              ],
            }),
          } as Response);
        } else if (url.includes('FeatureServer?f=json')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              mapName: 'Congressional Districts',
              layers: [
                { id: 0, name: 'Congressional Districts' },
              ],
            }),
          } as Response);
        } else if (url.includes('/0?f=json')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: 0,
              name: 'Congressional Districts',
              type: 'Feature Layer',
              geometryType: 'esriGeometryPolygon',
              fields: [{ name: 'DISTRICT', type: 'esriFieldTypeString' }],
            }),
          } as Response);
        }
        return Promise.reject(new Error('Not found'));
      });

      const discovery = new GISServerDiscovery();
      const layers = await discovery.discoverStateEndpoints('https://www.portlandmaps.com', 'arcgis');

      expect(Array.isArray(layers)).toBe(true);

      // Should find legislative layers
      if (layers.length > 0) {
        const hasLegislativeKeyword = layers.some(layer => {
          const nameLower = layer.name.toLowerCase();
          return (
            nameLower.includes('congress') ||
            nameLower.includes('senate') ||
            nameLower.includes('house') ||
            nameLower.includes('legislative') ||
            nameLower.includes('district')
          );
        });

        expect(hasLegislativeKeyword).toBe(true);
      }
    });

    it('should return empty array for invalid portal', async () => {
      // Mock failed probe
      global.fetch = vi.fn().mockRejectedValue(new Error('Not found'));

      const discovery = new GISServerDiscovery();
      const layers = await discovery.discoverStateEndpoints(
        'https://invalid-portal-url.com',
        'arcgis'
      );

      expect(layers).toEqual([]);
    });
  });
});
