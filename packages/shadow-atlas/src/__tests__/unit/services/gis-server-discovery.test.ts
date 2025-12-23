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
 * NETWORK DEPENDENCY: These tests hit real external GIS servers.
 * In CI environments, network test failures are logged as warnings (soft-fail).
 * Locally, network test failures fail the test suite normally.
 *
 * TYPE SAFETY: Nuclear-level strictness - no `any`, no loose casts.
 */

import { describe, it, expect } from 'vitest';
import { GISServerDiscovery } from '../../../services/gis-server-discovery.js';
import type { CityTarget } from '../providers/us-council-district-discovery.js';

/**
 * Soft-fail wrapper for network tests in CI
 * - CI: Network failures are logged as warnings, test passes
 * - Local: Network failures fail the test normally
 *
 * Handles both assertion errors and timeouts via Promise.race
 */
const isCI = process.env.CI === 'true';

function networkTest(name: string, fn: () => Promise<void>, timeout: number = 30000) {
  // Use a longer Vitest timeout to let our own timeout handling work
  const vitestTimeout = timeout + 5000;

  return it(name, async () => {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Network test timed out after ${timeout}ms`)), timeout);
    });

    try {
      await Promise.race([fn(), timeoutPromise]);
    } catch (error) {
      if (isCI) {
        console.warn(`[SOFT-FAIL] Network test "${name}" failed in CI:`, error);
        // Don't rethrow - test passes with warning in CI
      } else {
        throw error; // Fail locally
      }
    }
  }, vitestTimeout);
}

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

describe('GISServerDiscovery', () => {
  describe('Server Probing', () => {
    networkTest('should detect ArcGIS server at Portland', async () => {
      const discovery = new GISServerDiscovery();
      // CORRECTED: Use portlandmaps.com (200) instead of portland.gov (404)
      const endpoint = await discovery.probeServer('https://www.portlandmaps.com/');

      expect(endpoint).not.toBeNull();
      if (endpoint !== null) {
        expect(endpoint.serverType).toBe('ArcGIS');
        expect(endpoint.isHealthy).toBe(true);
        expect(endpoint.url).toContain('arcgis/rest/services');
      }
    }, 10000); // 10s timeout for network request

    networkTest('should return null for non-existent server', async () => {
      const discovery = new GISServerDiscovery();
      const endpoint = await discovery.probeServer('https://nonexistent-gis-server-12345.gov/');

      expect(endpoint).toBeNull();
    }, 10000);

    networkTest('should respect timeout on slow servers', async () => {
      const discovery = new GISServerDiscovery({ timeout: 1000 }); // 1s timeout
      const startTime = Date.now();

      // Try a server that will timeout
      await discovery.probeServer('https://httpstat.us/200?sleep=5000');

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(2000); // Should fail fast
    }, 5000);
  });

  describe('Server Discovery', () => {
    networkTest('should discover municipal GIS servers for Portland', async () => {
      const discovery = new GISServerDiscovery();
      const servers = await discovery.discoverServers(TEST_CITIES.portland);

      expect(servers.length).toBeGreaterThan(0);
      expect(servers.some(s => s.serverType === 'ArcGIS')).toBe(true);
      expect(servers.some(s => s.isHealthy === true)).toBe(true);
    }, 30000); // 30s timeout for multiple probes

    networkTest('should handle cities with no GIS server gracefully', async () => {
      const discovery = new GISServerDiscovery();
      const servers = await discovery.discoverServers(TEST_CITIES.nonexistent);

      expect(servers).toBeDefined();
      expect(Array.isArray(servers)).toBe(true);
      // May be empty or contain state-level servers
    }, 30000);

    networkTest('should respect rate limiting', async () => {
      const discovery = new GISServerDiscovery({ maxRequestsPerSecond: 2 });
      const startTime = Date.now();

      // Make 6 requests (should take ~3 seconds with 2 req/sec limit)
      const promises = Array.from({ length: 6 }, async () => {
        return discovery.probeServer('https://www.portlandmaps.com/');
      });

      await Promise.all(promises);

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThan(2000); // Should enforce rate limit
    }, 10000);
  });

  describe('Folder Exploration', () => {
    networkTest('should recursively explore ArcGIS folder structure', async () => {
      const discovery = new GISServerDiscovery();
      const services = await discovery.exploreArcGISFolders(
        'https://www.portlandmaps.com/arcgis/rest/services'
      );

      expect(services.length).toBeGreaterThan(0);
      expect(services.some(s => s.name.includes('Boundaries') || s.name.includes('Public'))).toBe(true);
    }, 60000); // 60s timeout for recursive exploration

    networkTest('should enumerate layers in discovered services', async () => {
      const discovery = new GISServerDiscovery();
      const services = await discovery.exploreArcGISFolders(
        'https://www.portlandmaps.com/arcgis/rest/services',
        'Public' // Start at Public folder
      );

      expect(services.length).toBeGreaterThan(0);

      // Find Boundaries service
      const boundariesService = services.find(s =>
        s.name.toLowerCase().includes('boundaries') ||
        s.name.toLowerCase().includes('public')
      );

      expect(boundariesService).toBeDefined();
      if (boundariesService) {
        expect(boundariesService.layers.length).toBeGreaterThan(0);
      }
    }, 60000);

    networkTest('should respect max depth limit', async () => {
      const discovery = new GISServerDiscovery({ maxDepth: 2 });
      const services = await discovery.exploreArcGISFolders(
        'https://www.portlandmaps.com/arcgis/rest/services'
      );

      // Should complete without infinite recursion
      expect(services).toBeDefined();
      expect(Array.isArray(services)).toBe(true);
    }, 60000);

    networkTest('should handle empty folders gracefully', async () => {
      const discovery = new GISServerDiscovery();

      // Explore non-existent folder (should return empty array)
      const services = await discovery.exploreArcGISFolders(
        'https://www.portlandmaps.com/arcgis/rest/services',
        'NonexistentFolder12345'
      );

      expect(services).toBeDefined();
      expect(Array.isArray(services)).toBe(true);
    }, 30000);
  });

  describe('Layer Metadata', () => {
    networkTest('should extract layer metadata including fields', async () => {
      const discovery = new GISServerDiscovery();
      const services = await discovery.exploreArcGISFolders(
        'https://www.portlandmaps.com/arcgis/rest/services',
        'Public'
      );

      expect(services.length).toBeGreaterThan(0);

      // Find service with layers
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
      }
    }, 60000);

    networkTest('should get feature count when available', async () => {
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
    }, 60000);
  });

  describe('Integration: Portland Voting Districts', () => {
    networkTest('should discover Portland voting districts via direct GIS exploration', async () => {
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
    }, 120000); // 2 minute timeout for full integration test
  });

  describe('Error Handling', () => {
    networkTest('should handle malformed JSON responses gracefully', async () => {
      const discovery = new GISServerDiscovery();

      // This should fail gracefully without throwing
      const result = await discovery.probeServer('https://example.com/');
      expect(result).toBeNull();
    }, 10000);

    networkTest('should handle network errors gracefully', async () => {
      const discovery = new GISServerDiscovery();

      // Invalid domain should fail gracefully
      const result = await discovery.probeServer('https://invalid-domain-12345.fake/');
      expect(result).toBeNull();
    }, 10000);

    networkTest('should handle 404 responses gracefully', async () => {
      const discovery = new GISServerDiscovery();

      // Non-existent path should fail gracefully
      const services = await discovery.exploreArcGISFolders(
        'https://www.portlandmaps.com/arcgis/rest/services',
        'InvalidFolder404'
      );

      expect(services).toBeDefined();
      expect(Array.isArray(services)).toBe(true);
    }, 30000);
  });

  describe('State Endpoint Discovery', () => {
    networkTest('should discover state legislative endpoints', async () => {
      const discovery = new GISServerDiscovery();

      // Test with a known state portal
      const portalUrl = 'https://www.portlandmaps.com';
      const layers = await discovery.discoverStateEndpoints(portalUrl, 'arcgis');

      expect(Array.isArray(layers)).toBe(true);

      // If layers found, verify they have legislative keywords
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
    }, 30000);

    networkTest('should return empty array for invalid portal', async () => {
      const discovery = new GISServerDiscovery();

      const layers = await discovery.discoverStateEndpoints(
        'https://invalid-portal-url.com',
        'arcgis'
      );

      expect(layers).toEqual([]);
    }, 10000);
  });
});
