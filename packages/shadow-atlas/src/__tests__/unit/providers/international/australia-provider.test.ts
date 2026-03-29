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
      expect(federalLayer?.authority).toBe('national-statistics');
      expect(federalLayer?.vintage).toBe(2024);
    });

    it('should have valid layer endpoint URL', () => {
      const federalLayer = provider.layers.get('federal');
      expect(federalLayer?.endpoint).toMatch(/^https:\/\//);
      expect(federalLayer?.endpoint).toContain('ASGS2024/CED');
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
      expect(division.source.authority).toBe('national-statistics');
      expect(division.source.vintage).toBe(2024);
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
    it('should return false when editingInfo.lastEditDate is older than lastExtraction', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          editingInfo: { lastEditDate: new Date('2023-06-01').getTime() },
        }),
      });

      const hasChanged = await provider.hasChangedSince(new Date('2024-01-01'));
      expect(hasChanged).toBe(false);
    });

    it('should return true when editingInfo.lastEditDate is newer than lastExtraction', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          editingInfo: { lastEditDate: new Date('2024-06-01').getTime() },
        }),
      });

      const hasChanged = await provider.hasChangedSince(new Date('2024-01-01'));
      expect(hasChanged).toBe(true);
    });

    it('should fall back to HTTP headers when editingInfo is absent', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
        headers: new Map([['Last-Modified', 'Mon, 01 Jan 2024 00:00:00 GMT']]),
      });

      const hasChanged = await provider.hasChangedSince(new Date('2022-06-01'));
      // Falls back to super.hasChangedSince which checks HTTP headers
      // The mock returns Last-Modified in 2024, lastExtraction is 2022 => changed
      expect(hasChanged).toBe(true);
    });

    it('should conservatively return true on network error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const hasChanged = await provider.hasChangedSince(new Date());
      expect(hasChanged).toBe(true);
    });
  });

  // ==========================================================================
  // Cell Map Tests (buildCellMap)
  // ==========================================================================

  describe('buildCellMap', () => {
    /**
     * Mock concordance CSV for SA1→CED.
     * Simulates ABS CG_SA1_2021_CED_2021.csv format.
     *
     * Column convention:
     *   SA1_MAINCODE_2021, SA1_NAME, CED_MAINCODE_2021, CED_NAME,
     *   RATIO_FROM_TO, INDIV_TO_REGION_QLTY_INDICATOR, OVERALL_QUALITY_INDICATOR
     */
    const MOCK_CONCORDANCE_CSV = [
      'SA1_MAINCODE_2021,CED_MAINCODE_2021,RATIO_FROM_TO',
      '10101100101,101,1.0',   // NSW SA1 → CED 101 (state=1)
      '10101100102,101,1.0',   // NSW SA1 → CED 101 (state=1)
      '20201200201,201,1.0',   // VIC SA1 → CED 201 (state=2)
      '30301300301,301,1.0',   // QLD SA1 → CED 301 (state=3)
      '40401400401,401,1.0',   // SA  SA1 → CED 401 (state=4)
      '50501500501,501,1.0',   // WA  SA1 → CED 501 (state=5)
      '60601600601,601,1.0',   // TAS SA1 → CED 601 (state=6)
      '70701700701,701,1.0',   // NT  SA1 → CED 701 (state=7)
      '80801800801,801,1.0',   // ACT SA1 → CED 801 (state=8)
      '90901900901,901,1.0',   // Non-geographic — should be filtered
    ].join('\n');

    /**
     * Mock concordance CSV with split SA1s (one SA1 spanning two CEDs).
     * The plurality resolver should keep the row with higher RATIO_FROM_TO.
     */
    const MOCK_SPLIT_CSV = [
      'SA1_MAINCODE_2021,CED_MAINCODE_2021,RATIO_FROM_TO',
      '10101100101,101,0.7',   // SA1 maps to CED 101 (70%)
      '10101100101,102,0.3',   // SA1 also maps to CED 102 (30%) — should be dropped
      '20201200201,201,1.0',   // Clean 1:1 mapping
    ].join('\n');

    /**
     * Helper to set up mocks for buildCellMap by mocking the private
     * loadSA1CEDConcordance method via fs cache simulation.
     */
    function mockConcordanceLoader(csvContent: string) {
      // Mock fs.existsSync to return true for cache dir, true for CSV file
      const existsSync = vi.fn().mockReturnValue(true);
      // Mock the concordance loader module
      vi.doMock('../../../../hydration/concordance-loader.js', () => ({
        loadConcordance: vi.fn().mockImplementation(async () => {
          // Parse the CSV inline (simulate what loadConcordance would do)
          const lines = csvContent.split('\n');
          const headers = lines[0].split(',').map(h => h.trim());
          const sa1Idx = headers.indexOf('SA1_MAINCODE_2021');
          const cedIdx = headers.indexOf('CED_MAINCODE_2021');

          const mappings = [];
          for (let i = 1; i < lines.length; i++) {
            const fields = lines[i].split(',').map(f => f.trim());
            if (!fields[sa1Idx]) continue;
            mappings.push({
              unitId: fields[sa1Idx],
              boundaryCode: fields[cedIdx],
            });
          }

          return {
            mappings,
            rowCount: mappings.length,
            columns: headers,
            fromCache: true,
          };
        }),
      }));

      return existsSync;
    }

    it('should map SA1s to CED codes and state codes', async () => {
      // We need to test the provider's buildCellMap with mock data.
      // The simplest approach: mock the private loadSA1CEDConcordance method.
      const testProvider = new AustraliaBoundaryProvider();

      // Mock the private method using prototype override
      const originalMethod = (testProvider as any).loadSA1CEDConcordance;
      (testProvider as any).loadSA1CEDConcordance = vi.fn().mockResolvedValue({
        mappings: [
          { unitId: '10101100101', boundaryCode: '101' },
          { unitId: '10101100102', boundaryCode: '101' },
          { unitId: '20201200201', boundaryCode: '201' },
          { unitId: '30301300301', boundaryCode: '301' },
          { unitId: '80801800801', boundaryCode: '801' },
        ],
        rowCount: 5,
        columns: ['SA1_MAINCODE_2021', 'CED_MAINCODE_2021'],
        fromCache: true,
      });

      const result = await testProvider.buildCellMap([]);

      expect(result.country).toBe('AU');
      expect(result.statisticalUnit).toBe('sa1');
      expect(result.cellCount).toBe(5);
      expect(result.depth).toBe(18);
      expect(result.root).toBeDefined();
      expect(typeof result.root).toBe('bigint');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      // Verify mappings
      expect(result.mappings).toHaveLength(5);

      // Check first mapping — NSW SA1 → CED 101, state 1
      const first = result.mappings[0];
      expect(first.cellId).toBe(BigInt('10101100101'));
      expect(first.districts[0]).toBe(101n);  // CED code
      expect(first.districts[1]).toBe(1n);    // State code (NSW)
      expect(first.districts.length).toBe(24);

      // Check ACT mapping — state 8
      const act = result.mappings.find(m => m.cellId === BigInt('80801800801'));
      expect(act).toBeDefined();
      expect(act!.districts[0]).toBe(801n);   // CED code
      expect(act!.districts[1]).toBe(8n);     // State code (ACT)

      // Verify unused slots are 0n
      for (const mapping of result.mappings) {
        for (let slot = 2; slot < 24; slot++) {
          expect(mapping.districts[slot]).toBe(0n);
        }
      }
    });

    it('should filter out non-geographic CED codes (>= 900)', async () => {
      const testProvider = new AustraliaBoundaryProvider();

      (testProvider as any).loadSA1CEDConcordance = vi.fn().mockResolvedValue({
        mappings: [
          { unitId: '10101100101', boundaryCode: '101' },
          { unitId: '90901900901', boundaryCode: '901' },  // Non-geographic
          { unitId: '90901900902', boundaryCode: '999' },  // Non-geographic
        ],
        rowCount: 3,
        columns: ['SA1_MAINCODE_2021', 'CED_MAINCODE_2021'],
        fromCache: true,
      });

      const result = await testProvider.buildCellMap([]);

      // Only 1 valid mapping (CED 101); CED 901 and 999 are filtered
      expect(result.cellCount).toBe(1);
      expect(result.mappings).toHaveLength(1);
      expect(result.mappings[0].districts[0]).toBe(101n);
    });

    it('should deduplicate SA1 cell IDs', async () => {
      const testProvider = new AustraliaBoundaryProvider();

      (testProvider as any).loadSA1CEDConcordance = vi.fn().mockResolvedValue({
        mappings: [
          { unitId: '10101100101', boundaryCode: '101' },
          { unitId: '10101100101', boundaryCode: '102' }, // Duplicate SA1 — should be skipped
        ],
        rowCount: 2,
        columns: ['SA1_MAINCODE_2021', 'CED_MAINCODE_2021'],
        fromCache: true,
      });

      const result = await testProvider.buildCellMap([]);

      expect(result.cellCount).toBe(1);
      expect(result.mappings[0].districts[0]).toBe(101n); // First one wins
    });

    it('should skip SA1s with empty CED assignment', async () => {
      const testProvider = new AustraliaBoundaryProvider();

      (testProvider as any).loadSA1CEDConcordance = vi.fn().mockResolvedValue({
        mappings: [
          { unitId: '10101100101', boundaryCode: '101' },
          { unitId: '10101100102', boundaryCode: '' },     // Empty CED
          { unitId: '10101100103', boundaryCode: 'abc' },  // Non-numeric CED
        ],
        rowCount: 3,
        columns: ['SA1_MAINCODE_2021', 'CED_MAINCODE_2021'],
        fromCache: true,
      });

      const result = await testProvider.buildCellMap([]);

      // 'abc' results in NaN from parseInt, filtered by >= 900 check
      // '' results in districts[0] = 0n, filtered by empty check
      expect(result.cellCount).toBe(1);
    });

    it('should resolve split SA1s using plurality (highest ratio)', () => {
      const testProvider = new AustraliaBoundaryProvider();

      const splitCsv = [
        'SA1_MAINCODE_2021,CED_MAINCODE_2021,RATIO_FROM_TO',
        '10101100101,101,0.7',
        '10101100101,102,0.3',
        '20201200201,201,1.0',
      ].join('\n');

      // Access private method via type assertion
      const resolved = (testProvider as any).resolvePluralityCED(splitCsv) as string;

      const lines = resolved.split('\n').filter(l => l.trim());
      // Header + 2 data lines (one for each unique SA1)
      expect(lines.length).toBe(3);

      // SA1 10101100101 should map to CED 101 (ratio 0.7 > 0.3)
      const sa1Line = lines.find(l => l.includes('10101100101'));
      expect(sa1Line).toBeDefined();
      expect(sa1Line).toContain('101');
      expect(sa1Line).not.toContain('102');
    });

    it('should derive correct state codes from SA1 code prefixes', async () => {
      const testProvider = new AustraliaBoundaryProvider();

      const stateTests = [
        { sa1: '10101100101', expectedState: 1n, stateName: 'NSW' },
        { sa1: '20201200201', expectedState: 2n, stateName: 'VIC' },
        { sa1: '30301300301', expectedState: 3n, stateName: 'QLD' },
        { sa1: '40401400401', expectedState: 4n, stateName: 'SA' },
        { sa1: '50501500501', expectedState: 5n, stateName: 'WA' },
        { sa1: '60601600601', expectedState: 6n, stateName: 'TAS' },
        { sa1: '70701700701', expectedState: 7n, stateName: 'NT' },
        { sa1: '80801800801', expectedState: 8n, stateName: 'ACT' },
      ];

      (testProvider as any).loadSA1CEDConcordance = vi.fn().mockResolvedValue({
        mappings: stateTests.map(t => ({
          unitId: t.sa1,
          boundaryCode: t.sa1.charAt(0) + '01', // CED code matches state
        })),
        rowCount: stateTests.length,
        columns: ['SA1_MAINCODE_2021', 'CED_MAINCODE_2021'],
        fromCache: true,
      });

      const result = await testProvider.buildCellMap([]);

      expect(result.cellCount).toBe(stateTests.length);

      for (const test of stateTests) {
        const mapping = result.mappings.find(
          m => m.cellId === BigInt(test.sa1)
        );
        expect(mapping).toBeDefined();
        expect(mapping!.districts[1]).toBe(test.expectedState);
      }
    });

    it('should extract CSV from a ZIP buffer', async () => {
      const testProvider = new AustraliaBoundaryProvider();

      // Create a minimal ZIP file with a test CSV
      const { deflateRawSync } = await import('zlib');

      const csvContent = 'SA1_MAINCODE_2021,CED_MAINCODE_2021\n10101100101,101\n';
      const csvBuffer = Buffer.from(csvContent, 'utf-8');
      const compressed = deflateRawSync(csvBuffer);

      const filename = 'CG_SA1_2021_CED_2021.csv';
      const filenameBuffer = Buffer.from(filename, 'utf-8');

      // Build local file header
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);  // Signature
      header.writeUInt16LE(20, 4);           // Version needed
      header.writeUInt16LE(0, 6);            // General purpose bit flag
      header.writeUInt16LE(8, 8);            // Compression method: Deflate
      header.writeUInt16LE(0, 10);           // Modification time
      header.writeUInt16LE(0, 12);           // Modification date
      header.writeUInt32LE(0, 14);           // CRC-32 (not checked)
      header.writeUInt32LE(compressed.length, 18); // Compressed size
      header.writeUInt32LE(csvBuffer.length, 22);  // Uncompressed size
      header.writeUInt16LE(filenameBuffer.length, 26); // Filename length
      header.writeUInt16LE(0, 28);           // Extra field length

      const zipBuffer = Buffer.concat([header, filenameBuffer, compressed]);

      const extracted = await (testProvider as any).extractCSVFromZip(
        zipBuffer,
        'CG_SA1_2021_CED_2021.csv',
      );

      expect(extracted).toBe(csvContent);
    });

    it('should return null when target file not found in ZIP', async () => {
      const testProvider = new AustraliaBoundaryProvider();

      // Empty/invalid ZIP buffer
      const emptyBuffer = Buffer.alloc(4);

      const result = await (testProvider as any).extractCSVFromZip(
        emptyBuffer,
        'nonexistent.csv',
      );

      expect(result).toBeNull();
    });
  });
});
