/**
 * Australia Boundary Provider Tests
 *
 * Comprehensive test suite for AustraliaBoundaryProvider.
 * Tests extraction, validation, health checks, and error handling.
 *
 * TEST STRATEGY:
 * - Unit tests: Mock HTTP responses, test normalization logic
 * - Integration tests: Test against live AEC API (optional, slow)
 * - Validation tests: Verify expected counts, confidence scoring
 * - Error handling: Test retry logic, timeout handling, API failures
 *
 * RUN TESTS:
 * ```bash
 * npm run test -- australia-provider.test.ts
 * npm run test:integration -- australia-provider.test.ts  # Live API tests
 * ```
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FeatureCollection } from 'geojson';
import { AustraliaBoundaryProvider, type AustraliaDivision } from '../../../../providers/international/australia-provider.js';

// ============================================================================
// Mock Data
// ============================================================================

/**
 * Mock GeoJSON response from AEC API
 */
const mockAECResponse: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        DIV_CODE: 'NSW01',
        DIV_NAME: 'Banks',
        STATE_AB: 'NSW',
        POPULATION: 169842,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [151.0, -33.9],
            [151.1, -33.9],
            [151.1, -34.0],
            [151.0, -34.0],
            [151.0, -33.9],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: {
        DIV_CODE: 'VIC01',
        DIV_NAME: 'Aston',
        STATE_AB: 'VIC',
        POPULATION: 164234,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [145.2, -37.8],
            [145.3, -37.8],
            [145.3, -37.9],
            [145.2, -37.9],
            [145.2, -37.8],
          ],
        ],
      },
    },
  ],
};

/**
 * Mock ArcGIS service metadata response
 */
const mockServiceMetadata = {
  name: 'Federal_Electoral_Divisions_2021',
  description: 'AEC Federal Electoral Divisions',
  geometryType: 'esriGeometryPolygon',
  count: 151,
  maxRecordCount: 2000,
  editingInfo: {
    lastEditDate: 1640995200000, // 2022-01-01
  },
};

// ============================================================================
// Test Suite
// ============================================================================

describe('AustraliaBoundaryProvider', () => {
  let provider: AustraliaBoundaryProvider;

  beforeEach(() => {
    provider = new AustraliaBoundaryProvider();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Configuration Tests
  // ==========================================================================

  describe('Configuration', () => {
    it('should have correct country metadata', () => {
      expect(provider.country).toBe('AU');
      expect(provider.countryName).toBe('Australia');
      expect(provider.dataSource).toBe('AEC (Australian Electoral Commission)');
      expect(provider.apiType).toBe('arcgis-rest');
      expect(provider.license).toBe('CC-BY-4.0');
    });

    it('should have federal layer configured', () => {
      const federalLayer = provider.layers.get('federal');
      expect(federalLayer).toBeDefined();
      expect(federalLayer?.type).toBe('federal');
      expect(federalLayer?.expectedCount).toBe(151);
      expect(federalLayer?.authority).toBe('electoral-commission');
      expect(federalLayer?.vintage).toBe(2021);
    });

    it('should have valid layer endpoint URL', () => {
      const federalLayer = provider.layers.get('federal');
      expect(federalLayer?.endpoint).toMatch(/^https:\/\//);
      expect(federalLayer?.endpoint).toContain('Federal_Electoral_Divisions_2021');
      expect(federalLayer?.endpoint).toContain('FeatureServer/0');
    });
  });

  // ==========================================================================
  // Extraction Tests
  // ==========================================================================

  describe('extractFederalDivisions', () => {
    it('should extract divisions successfully', async () => {
      // Mock fetch to return mock GeoJSON
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockAECResponse,
      });

      const result = await provider.extractFederalDivisions();

      expect(result.success).toBe(true);
      expect(result.layer).toBe('federal');
      expect(result.boundaries).toHaveLength(2);
      expect(result.actualCount).toBe(2);
      expect(result.error).toBeUndefined();
    });

    it('should normalize division properties correctly', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockAECResponse,
      });

      const result = await provider.extractFederalDivisions();
      const division = result.boundaries[0] as AustraliaDivision;

      expect(division.id).toBe('NSW01');
      expect(division.name).toBe('Banks');
      expect(division.type).toBe('federal');
      expect(division.state).toBe('NSW');
      expect(division.population).toBe(169842);
      expect(division.geometry.type).toBe('Polygon');
    });

    it('should extract state codes correctly', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockAECResponse,
      });

      const result = await provider.extractFederalDivisions();
      const states = result.boundaries.map((d) => d.state);

      expect(states).toContain('NSW');
      expect(states).toContain('VIC');
    });

    it('should include source metadata', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockAECResponse,
      });

      const result = await provider.extractFederalDivisions();
      const division = result.boundaries[0] as AustraliaDivision;

      expect(division.source.country).toBe('AU');
      expect(division.source.dataSource).toBe('AEC');
      expect(division.source.authority).toBe('electoral-commission');
      expect(division.source.vintage).toBe(2021);
      expect(division.source.retrievedAt).toBeDefined();
    });

    it('should calculate confidence score', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockAECResponse,
      });

      const result = await provider.extractFederalDivisions();

      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(100);
    });

    it('should track extraction duration', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockAECResponse,
      });

      const result = await provider.extractFederalDivisions();

      // Mocked fetches may complete in < 1ms, so accept >= 0
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.extractedAt).toBeInstanceOf(Date);
    });
  });

  // ==========================================================================
  // Validation Tests
  // ==========================================================================

  describe('Validation', () => {
    it('should validate count match', async () => {
      // Create mock response with exactly 151 features (expected count)
      const fullResponse: FeatureCollection = {
        type: 'FeatureCollection',
        features: Array.from({ length: 151 }, (_, i) => ({
          type: 'Feature' as const,
          properties: {
            DIV_CODE: `DIV${i.toString().padStart(3, '0')}`,
            DIV_NAME: `Division ${i + 1}`,
            STATE_AB: 'NSW',
          },
          geometry: {
            type: 'Polygon' as const,
            coordinates: [
              [
                [151.0, -33.9],
                [151.1, -33.9],
                [151.1, -34.0],
                [151.0, -34.0],
                [151.0, -33.9],
              ],
            ],
          },
        })),
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => fullResponse,
      });

      const result = await provider.extractFederalDivisions();

      expect(result.actualCount).toBe(151);
      expect(result.expectedCount).toBe(151);
      expect(result.matched).toBe(true);
    });

    it('should flag count mismatch', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockAECResponse, // Only 2 features
      });

      const result = await provider.extractFederalDivisions();

      expect(result.actualCount).toBe(2);
      expect(result.expectedCount).toBe(151);
      expect(result.matched).toBe(false);
    });

    it('should filter invalid geometries', async () => {
      const invalidResponse: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { DIV_CODE: 'NSW01', DIV_NAME: 'Banks' },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [151.0, -33.9],
                  [151.1, -33.9],
                ],
              ], // Invalid (not closed ring)
            },
          },
          {
            type: 'Feature',
            properties: { DIV_CODE: 'VIC01', DIV_NAME: 'Aston' },
            // Missing geometry
            geometry: null as any,
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => invalidResponse,
      });

      const result = await provider.extractFederalDivisions();

      // Should filter out invalid geometries
      expect(result.boundaries.length).toBeLessThan(2);
    });
  });

  // ==========================================================================
  // State Filtering Tests
  // ==========================================================================

  describe('extractByState', () => {
    it('should extract divisions for specific state', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockAECResponse,
      });

      const result = await provider.extractByState('NSW');

      expect(result.success).toBe(true);
      expect(result.boundaries).toHaveLength(1);
      expect(result.boundaries[0]?.state).toBe('NSW');
    });

    it('should return empty for state with no divisions', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockAECResponse,
      });

      const result = await provider.extractByState('NT');

      expect(result.boundaries).toHaveLength(0);
    });

    it('should handle all valid state codes', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockAECResponse,
      });

      const validStates: Array<'NSW' | 'VIC' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'NT' | 'ACT'> = [
        'NSW',
        'VIC',
        'QLD',
        'SA',
        'WA',
        'TAS',
        'NT',
        'ACT',
      ];

      for (const state of validStates) {
        const result = await provider.extractByState(state);
        expect(result.layer).toBe('federal');
      }
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('Error Handling', () => {
    it('should handle HTTP errors gracefully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const result = await provider.extractFederalDivisions();

      expect(result.success).toBe(false);
      expect(result.boundaries).toHaveLength(0);
      expect(result.error).toContain('404');
    });

    it('should handle network errors', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await provider.extractFederalDivisions();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('should handle invalid JSON responses', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      const result = await provider.extractFederalDivisions();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should retry on transient failures', async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Transient error');
        }
        return {
          ok: true,
          json: async () => mockAECResponse,
        };
      });

      const result = await provider.extractFederalDivisions();

      expect(result.success).toBe(true);
      expect(callCount).toBe(3); // Should have retried twice
    });
  });

  // ==========================================================================
  // Health Check Tests
  // ==========================================================================

  describe('healthCheck', () => {
    it('should return healthy status when API is available', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockServiceMetadata,
      });

      const health = await provider.healthCheck();

      expect(health.available).toBe(true);
      // Mocked fetches may complete in < 1ms, so accept >= 0
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      expect(health.issues).toHaveLength(0);
      expect(health.lastChecked).toBeInstanceOf(Date);
    });

    it('should detect API unavailability', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      const health = await provider.healthCheck();

      expect(health.available).toBe(false);
      expect(health.issues).toContain('HTTP 503: Service Unavailable');
    });

    it('should detect network failures', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection timeout'));

      const health = await provider.healthCheck();

      expect(health.available).toBe(false);
      expect(health.issues.some((issue) => issue.includes('Connection timeout'))).toBe(true);
    });

    it('should flag zero feature count', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ...mockServiceMetadata, count: 0 }),
      });

      const health = await provider.healthCheck();

      expect(health.available).toBe(true); // Still available, but with issues
      expect(health.issues).toContain('Service reports zero features');
    });
  });

  // ==========================================================================
  // Integration Tests (Optional, Slow)
  // ==========================================================================

  describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)('Integration Tests (Live API)', () => {
    it('should extract from live AEC API', async () => {
      const result = await provider.extractFederalDivisions();

      expect(result.success).toBe(true);
      expect(result.actualCount).toBeGreaterThan(0);
      expect(result.boundaries).toHaveLength(result.actualCount);

      // Should match expected count (151 divisions)
      if (result.actualCount === 151) {
        expect(result.matched).toBe(true);
      }
    }, 30000); // 30s timeout for network requests

    it('should pass live health check', async () => {
      const health = await provider.healthCheck();

      expect(health.available).toBe(true);
      expect(health.latencyMs).toBeLessThan(10000); // Should respond within 10s
      expect(health.issues).toHaveLength(0);
    }, 15000);
  });

  // ==========================================================================
  // Expected Counts Tests
  // ==========================================================================

  describe('getExpectedCounts', () => {
    it('should return expected counts for all layers', async () => {
      const counts = await provider.getExpectedCounts();

      expect(counts.get('federal')).toBe(151);
    });
  });

  // ==========================================================================
  // Change Detection Tests
  // ==========================================================================

  describe('hasChangedSince', () => {
    it('should detect no changes if Last-Modified is old', async () => {
      const oldDate = new Date('2023-01-01');

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([['Last-Modified', 'Mon, 01 Jan 2022 00:00:00 GMT']]),
      });

      const hasChanged = await provider.hasChangedSince(oldDate);

      expect(hasChanged).toBe(false);
    });

    it('should detect changes if Last-Modified is recent', async () => {
      const recentDate = new Date('2022-06-01');

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([['Last-Modified', 'Mon, 01 Jan 2024 00:00:00 GMT']]),
      });

      const hasChanged = await provider.hasChangedSince(recentDate);

      expect(hasChanged).toBe(true);
    });

    it('should conservatively return true on check failure', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const hasChanged = await provider.hasChangedSince(new Date());

      expect(hasChanged).toBe(true); // Conservative assumption
    });
  });
});
