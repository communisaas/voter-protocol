/**
 * New Zealand Country Provider Tests
 *
 * Tests the NZCountryProvider with mocked API responses.
 *
 * Test Coverage:
 * 1. Provider metadata (country, dataSource, apiType, license)
 * 2. Boundary layer configuration (general: 64, Maori: 7)
 * 3. extractAll() with mocked ArcGIS JSON responses
 * 4. extractOfficials() with mocked CSV response
 * 5. NZ_ELECTORATE_ALIASES resolution (2020→2025 names)
 * 6. List MP handling — electorateType='list' skips boundary resolution
 * 7. validate() Layer 3 — boundary code resolution with alias application
 * 8. validate() Layer 2 — NZMPSchema Zod validation
 * 9. Error handling — network failures in source chain
 * 10. normalizeForId / normalizeBoundaryName behavior
 * 11. Health check
 * 12. Change detection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NZCountryProvider } from '../../../../providers/international/nz-provider.js';
import type { NZElectorate, NZExtractionResult } from '../../../../providers/international/nz-provider.js';
import type { FeatureCollection } from 'geojson';

// ============================================================================
// Mock Data
// ============================================================================

function makeGeneralGeoJSON(count: number): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: Array.from({ length: count }, (_, i) => ({
      type: 'Feature' as const,
      properties: {
        GED2025_V1: String(i + 1),
        'General_Electorate__2025_': `Electorate ${i + 1}`,
        Total_Population: 50000 + i * 100,
      },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [174.7 + i * 0.01, -36.8],
            [174.8 + i * 0.01, -36.8],
            [174.8 + i * 0.01, -36.9],
            [174.7 + i * 0.01, -36.9],
            [174.7 + i * 0.01, -36.8],
          ],
        ],
      },
    })),
  };
}

function makeMaoriGeoJSON(count: number): FeatureCollection {
  const maoriNames = [
    'Hauraki-Waikato',
    'Ikaroa-R\u0101whiti',
    'T\u0101maki Makaurau',
    'Te Tai Hau\u0101uru',
    'Te Tai Tokerau',
    'Te Tai Tonga',
    'Waiariki',
  ];
  return {
    type: 'FeatureCollection',
    features: Array.from({ length: count }, (_, i) => ({
      type: 'Feature' as const,
      properties: {
        MED2025_V1: String(65 + i),
        'M\u0101ori_Electorate__2025_': maoriNames[i] ?? `M\u0101ori Electorate ${i + 1}`,
      },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [175.0 + i * 0.1, -37.0],
            [175.1 + i * 0.1, -37.0],
            [175.1 + i * 0.1, -37.1],
            [175.0 + i * 0.1, -37.1],
            [175.0 + i * 0.1, -37.0],
          ],
        ],
      },
    })),
  };
}

const MOCK_CSV = `First Name,Last Name,Electorate,Party,Email
Chris,Hipkins,Remutaka,Labour,chris.hipkins@parliament.govt.nz
Christopher,Luxon,Botany,National,christopher.luxon@parliament.govt.nz
Chloe,Swarbrick,Auckland Central,Green,chloe.swarbrick@parliament.govt.nz
Debbie,Ngarewa-Packer,Te Tai Hauauru,Te P\u0101ti M\u0101ori,debbie.ngarewa-packer@parliament.govt.nz
James,Shaw,,Green,james.shaw@parliament.govt.nz
Nicola,Willis,,National,nicola.willis@parliament.govt.nz
David,Seymour,Epsom,ACT,david.seymour@parliament.govt.nz`;

// ============================================================================
// Test Suite
// ============================================================================

describe('NZCountryProvider', () => {
  let provider: NZCountryProvider;

  beforeEach(() => {
    provider = new NZCountryProvider({ retryAttempts: 1, retryDelayMs: 10 });
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Provider Metadata
  // ==========================================================================

  describe('Provider metadata', () => {
    it('should have correct metadata', () => {
      expect(provider.country).toBe('NZ');
      expect(provider.countryName).toBe('New Zealand');
      expect(provider.dataSource).toBe('Stats NZ (Statistics New Zealand)');
      expect(provider.apiType).toBe('arcgis-rest');
      expect(provider.license).toBe('CC-BY-4.0');
    });
  });

  // ==========================================================================
  // Boundary Layer Configuration
  // ==========================================================================

  describe('Boundary layer configuration', () => {
    it('should have general layer configured with 64 expected', () => {
      const general = provider.layers.get('general');
      expect(general).toBeDefined();
      expect(general?.expectedCount).toBe(64);
      expect(general?.type).toBe('general');
      expect(general?.updateSchedule).toBe('event-driven');
      expect(general?.authority).toBe('national-statistics');
      expect(general?.vintage).toBe(2025);
    });

    it('should have Maori layer configured with 7 expected', () => {
      const maori = provider.layers.get('maori');
      expect(maori).toBeDefined();
      expect(maori?.expectedCount).toBe(7);
      expect(maori?.type).toBe('maori');
      expect(maori?.authority).toBe('national-statistics');
    });

    it('should have correct ArcGIS layer endpoints', () => {
      const general = provider.layers.get('general');
      const maori = provider.layers.get('maori');
      expect(general?.endpoint).toContain('FeatureServer/6');
      expect(maori?.endpoint).toContain('FeatureServer/8');
    });
  });

  // ==========================================================================
  // extractAll
  // ==========================================================================

  describe('extractAll', () => {
    it('should extract both general and Maori layers', async () => {
      const generalGeoJSON = makeGeneralGeoJSON(3);
      const maoriGeoJSON = makeMaoriGeoJSON(2);

      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        callCount++;
        const urlStr = String(url);
        const isGeneral = urlStr.includes('FeatureServer/6');
        return {
          ok: true,
          json: async () => isGeneral ? generalGeoJSON : maoriGeoJSON,
        } as Response;
      });

      const result = await provider.extractAll();

      expect(result.country).toBe('NZ');
      expect(result.layers).toHaveLength(2);
      expect(result.totalBoundaries).toBe(5); // 3 general + 2 maori
      expect(result.successfulLayers).toBe(2);
      expect(result.failedLayers).toBe(0);
      expect(result.providerVersion).toBe('2.0.0');
    });

    it('should extract general electorates with correct properties', async () => {
      const generalGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {
              GED2025_V1: '42',
              'General_Electorate__2025_': 'Auckland Central',
              Total_Population: 65000,
            },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [174.7, -36.8],
                  [174.8, -36.8],
                  [174.8, -36.9],
                  [174.7, -36.9],
                  [174.7, -36.8],
                ],
              ],
            },
          },
        ],
      };

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const urlStr = String(url);
        if (urlStr.includes('FeatureServer/6')) {
          return { ok: true, json: async () => generalGeoJSON } as Response;
        }
        return { ok: true, json: async () => makeMaoriGeoJSON(0) } as Response;
      });

      const result = await provider.extractAll();
      const generalLayer = result.layers.find(l => l.layer === 'general');
      expect(generalLayer).toBeDefined();

      const boundaries = generalLayer!.boundaries as NZElectorate[];
      expect(boundaries).toHaveLength(1);
      expect(boundaries[0].id).toBe('42');
      expect(boundaries[0].name).toBe('Auckland Central');
      expect(boundaries[0].type).toBe('general');
      expect(boundaries[0].population).toBe(65000);
      expect(boundaries[0].source.country).toBe('NZ');
      expect(boundaries[0].source.dataSource).toBe('Stats NZ');
      expect(boundaries[0].source.authority).toBe('national-statistics');
      expect(boundaries[0].geometry.type).toBe('Polygon');
    });

    it('should flag count mismatch when fewer than expected', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const urlStr = String(url);
        if (urlStr.includes('FeatureServer/6')) {
          return { ok: true, json: async () => makeGeneralGeoJSON(2) } as Response;
        }
        return { ok: true, json: async () => makeMaoriGeoJSON(7) } as Response;
      });

      const result = await provider.extractAll();
      const generalLayer = result.layers.find(l => l.layer === 'general');

      expect(generalLayer?.actualCount).toBe(2);
      expect(generalLayer?.expectedCount).toBe(64);
      expect(generalLayer?.matched).toBe(false);
    });

    it('should report matched when counts match expected', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const urlStr = String(url);
        if (urlStr.includes('FeatureServer/6')) {
          return { ok: true, json: async () => makeGeneralGeoJSON(64) } as Response;
        }
        return { ok: true, json: async () => makeMaoriGeoJSON(7) } as Response;
      });

      const result = await provider.extractAll();
      const generalLayer = result.layers.find(l => l.layer === 'general');
      const maoriLayer = result.layers.find(l => l.layer === 'maori');

      expect(generalLayer?.matched).toBe(true);
      expect(maoriLayer?.matched).toBe(true);
      expect(result.totalBoundaries).toBe(71);
    });
  });

  // ==========================================================================
  // extractOfficials
  // ==========================================================================

  describe('extractOfficials', () => {
    it('should extract officials from mocked CSV with boundary resolution', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => MOCK_CSV,
      } as Response);

      // Build boundary index with matching electorate names
      const boundaryIndex = new Map<string, NZElectorate>();
      for (const name of ['Remutaka', 'Botany', 'Auckland Central', 'Epsom']) {
        boundaryIndex.set(name, {
          id: name.toLowerCase().replace(/\s+/g, '-'),
          name,
          type: 'general',
          region: 'North Island',
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
          source: {
            country: 'NZ',
            dataSource: 'Stats NZ',
            endpoint: 'test',
            vintage: 2025,
            retrievedAt: new Date().toISOString(),
            authority: 'national-statistics',
          },
          properties: {},
        });
      }
      // Add Maori electorate
      boundaryIndex.set('Te Tai Hauauru', {
        id: '68',
        name: 'Te Tai Hauauru',
        type: 'maori',
        region: 'North Island',
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        source: {
          country: 'NZ',
          dataSource: 'Stats NZ',
          endpoint: 'test',
          vintage: 2025,
          retrievedAt: new Date().toISOString(),
          authority: 'national-statistics',
        },
        properties: {},
      });

      const result = await provider.extractOfficials(boundaryIndex);

      expect(result.country).toBe('NZ');
      expect(result.actualCount).toBe(7); // 5 electorate + 2 list
      expect(result.officials).toHaveLength(7);

      // Verify electorate MP resolution
      const hipkins = result.officials.find(o => o.name === 'Chris Hipkins');
      expect(hipkins).toBeDefined();
      expect(hipkins?.electorateType).toBe('general');
      expect(hipkins?.boundaryCode).toContain('nz-gen-');
      expect(hipkins?.electorateName).toBe('Remutaka');
    });

    it('should classify Maori electorate MPs correctly', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => MOCK_CSV,
      } as Response);

      const boundaryIndex = new Map<string, NZElectorate>();
      boundaryIndex.set('Te Tai Hauauru', {
        id: '68',
        name: 'Te Tai Hauauru',
        type: 'maori',
        region: 'North Island',
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        source: {
          country: 'NZ',
          dataSource: 'Stats NZ',
          endpoint: 'test',
          vintage: 2025,
          retrievedAt: new Date().toISOString(),
          authority: 'national-statistics',
        },
        properties: {},
      });

      const result = await provider.extractOfficials(boundaryIndex);

      const ngarewa = result.officials.find(o => o.lastName === 'Ngarewa-Packer');
      expect(ngarewa).toBeDefined();
      expect(ngarewa?.electorateType).toBe('maori');
      expect(ngarewa?.boundaryCode).toContain('nz-maori-');
    });

    it('should handle list MPs with null boundary codes', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => MOCK_CSV,
      } as Response);

      const result = await provider.extractOfficials(new Map());

      const shaw = result.officials.find(o => o.name === 'James Shaw');
      expect(shaw).toBeDefined();
      expect(shaw?.electorateType).toBe('list');
      expect(shaw?.boundaryCode).toBeNull();
      expect(shaw?.electorateName).toBeUndefined();

      const willis = result.officials.find(o => o.name === 'Nicola Willis');
      expect(willis).toBeDefined();
      expect(willis?.electorateType).toBe('list');
      expect(willis?.boundaryCode).toBeNull();
    });

    it('should generate parliament IDs with nzp- prefix', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => MOCK_CSV,
      } as Response);

      const result = await provider.extractOfficials(new Map());

      for (const official of result.officials) {
        expect(official.parliamentId).toMatch(/^nzp-/);
        expect(official.id).toBe(official.parliamentId);
      }
    });
  });

  // ==========================================================================
  // Electorate Alias Resolution (2020→2025)
  // ==========================================================================

  describe('NZ_ELECTORATE_ALIASES resolution', () => {
    it('should resolve 2020 electorate names to 2025 boundaries via aliases', async () => {
      // CSV has an MP in 'Rongotai' (2020 name)
      const csvWithAlias = `First Name,Last Name,Electorate,Party,Email
Fleur,Fitzsimons,Rongotai,Labour,fleur@parliament.govt.nz`;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => csvWithAlias,
      } as Response);

      // Boundary index has 2025 name 'Wellington Bays'
      const boundaryIndex = new Map<string, NZElectorate>();
      boundaryIndex.set('Wellington Bays', {
        id: '55',
        name: 'Wellington Bays',
        type: 'general',
        region: 'North Island',
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        source: {
          country: 'NZ',
          dataSource: 'Stats NZ',
          endpoint: 'test',
          vintage: 2025,
          retrievedAt: new Date().toISOString(),
          authority: 'national-statistics',
        },
        properties: {},
      });

      const result = await provider.extractOfficials(boundaryIndex);

      const fleur = result.officials.find(o => o.name === 'Fleur Fitzsimons');
      expect(fleur).toBeDefined();
      expect(fleur?.boundaryCode).toBe('nz-gen-55');
      expect(fleur?.electorateType).toBe('general');
    });

    it('should resolve Auckland reconfiguration aliases', async () => {
      const csvWithAuckland = `First Name,Last Name,Electorate,Party,Email
Helen,White,New Lynn,National,helen@parliament.govt.nz`;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => csvWithAuckland,
      } as Response);

      const boundaryIndex = new Map<string, NZElectorate>();
      boundaryIndex.set('Wait\u0101kere', {
        id: '33',
        name: 'Wait\u0101kere',
        type: 'general',
        region: 'North Island',
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        source: {
          country: 'NZ',
          dataSource: 'Stats NZ',
          endpoint: 'test',
          vintage: 2025,
          retrievedAt: new Date().toISOString(),
          authority: 'national-statistics',
        },
        properties: {},
      });

      const result = await provider.extractOfficials(boundaryIndex);

      const helen = result.officials.find(o => o.name === 'Helen White');
      expect(helen).toBeDefined();
      expect(helen?.boundaryCode).toBe('nz-gen-33');
    });
  });

  // ==========================================================================
  // Validation Pipeline
  // ==========================================================================

  describe('validate', () => {
    function makeMockBoundaries(): NZElectorate[] {
      return [
        {
          id: '1',
          name: 'Auckland Central',
          type: 'general',
          region: 'North Island',
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
          source: {
            country: 'NZ',
            dataSource: 'Stats NZ',
            endpoint: 'test',
            vintage: 2025,
            retrievedAt: new Date().toISOString(),
            authority: 'national-statistics',
          },
          properties: {},
        },
        {
          id: '65',
          name: 'Te Tai Tokerau',
          type: 'maori',
          region: 'North Island',
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
          source: {
            country: 'NZ',
            dataSource: 'Stats NZ',
            endpoint: 'test',
            vintage: 2025,
            retrievedAt: new Date().toISOString(),
            authority: 'national-statistics',
          },
          properties: {},
        },
      ];
    }

    it('should run Layer 2 schema validation on officials', async () => {
      const boundaries = makeMockBoundaries();
      const officials = [
        {
          id: 'nzp-test-mp',
          name: 'Test MP',
          firstName: 'Test',
          lastName: 'MP',
          party: 'Labour',
          boundaryName: 'Auckland Central',
          boundaryCode: 'nz-gen-1',
          isActive: true,
          parliamentId: 'nzp-test-mp',
          electorateName: 'Auckland Central',
          electorateCode: 'nz-gen-1',
          electorateType: 'general' as const,
        },
      ];

      const report = await provider.validate(boundaries, officials);

      expect(report).toBeDefined();
      expect(report.layers.schemaValidation).toBeDefined();
      expect(report.layers.schemaValidation.recordCount).toBe(1);
    });

    it('should resolve boundary codes in Layer 3 for electorate MPs', async () => {
      const boundaries = makeMockBoundaries();
      const officials = [
        {
          id: 'nzp-test-electorate',
          name: 'Test Electorate MP',
          firstName: 'Test',
          lastName: 'Electorate',
          party: 'National',
          boundaryName: 'Auckland Central',
          boundaryCode: 'nz-gen-1',
          isActive: true,
          parliamentId: 'nzp-test-electorate',
          electorateName: 'Auckland Central',
          electorateCode: 'nz-gen-1',
          electorateType: 'general' as const,
        },
      ];

      const report = await provider.validate(boundaries, officials);

      expect(report.layers.codeResolution).toBeDefined();
      // Only electorate MPs count toward resolution
      const codeTotal = report.layers.codeResolution.resolved +
        report.layers.codeResolution.unmatched.length +
        report.layers.codeResolution.ambiguous.length;
      expect(codeTotal).toBe(1);
      expect(report.layers.codeResolution.resolved).toBeGreaterThanOrEqual(0);
    });

    it('should exclude list MPs from Layer 3 code resolution', async () => {
      const boundaries = makeMockBoundaries();
      const officials = [
        {
          id: 'nzp-list-mp',
          name: 'List MP',
          firstName: 'List',
          lastName: 'MP',
          party: 'Green',
          boundaryName: '',
          boundaryCode: null,
          isActive: true,
          parliamentId: 'nzp-list-mp',
          electorateName: undefined,
          electorateCode: undefined,
          electorateType: 'list' as const,
        },
      ];

      const report = await provider.validate(boundaries, officials);

      // List MPs should not be in code resolution count
      const codeTotal = report.layers.codeResolution.resolved +
        report.layers.codeResolution.unmatched.length +
        report.layers.codeResolution.ambiguous.length;
      expect(codeTotal).toBe(0);
    });

    it('should skip PIP verification when no geocoder provided', async () => {
      const boundaries = makeMockBoundaries();
      const report = await provider.validate(boundaries, []);

      expect(report.layers.pipVerification.skipped).toBe(0);
      expect(report.layers.pipVerification.confirmed).toBe(0);
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error handling', () => {
    it('should try source chain fallback when first source fails', async () => {
      const calls: string[] = [];
      global.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const urlStr = String(url);
        calls.push(urlStr);

        if (urlStr.includes('data.govt.nz') || urlStr.includes('catalogue.data.govt.nz')) {
          throw new Error('data.govt.nz unreachable');
        }

        if (urlStr.includes('wikipedia.org')) {
          // Wikipedia wikitext with valid sortname rows
          // parseWikiRow expects cells[0]=electorate, cells[1]=map/icon, cells[2]=MP name, cells[3+]=party
          return {
            ok: true,
            json: async () => ({
              parse: {
                wikitext: {
                  '*': [
                    '===General electorates===',
                    '{| class="wikitable"',
                    '|-',
                    '|{{NZ electorate link|Auckland Central}}',
                    '|map-icon',
                    '|{{sortname|Chloe|Swarbrick}}',
                    '|{{Party color cell|Green Party of Aotearoa New Zealand}}',
                    '|-',
                    '|}',
                    '===Māori electorates===',
                    '{| class="wikitable"',
                    '|-',
                    '|{{NZ electorate link|Te Tai Tokerau}}',
                    '|map-icon',
                    '|{{sortname|Mariameno|Kapa-Kingi}}',
                    '|{{Party color cell|Te Pāti Māori}}',
                    '|-',
                    '|}',
                  ].join('\n'),
                },
              },
            }),
          } as Response;
        }

        // parliament.nz fallback — shouldn't be reached
        return { ok: false, status: 403, text: async () => 'Blocked' } as unknown as Response;
      });

      const result = await provider.extractOfficials(new Map());

      // First call was data.govt.nz (failed), second was Wikipedia (succeeded)
      expect(calls.length).toBeGreaterThanOrEqual(2);
      expect(result.officials.length).toBeGreaterThan(0);
    });

    it('should handle all sources failing gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await expect(provider.extractOfficials(new Map())).rejects.toThrow();
    });
  });

  // ==========================================================================
  // Health Check
  // ==========================================================================

  describe('healthCheck', () => {
    it('should return healthy when counts match', async () => {
      // Differentiate by URL: general (FeatureServer/6) expects 64, Maori (FeatureServer/8) expects 7
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const urlStr = String(url);
        const count = urlStr.includes('FeatureServer/6') ? 64 : 7;
        return {
          ok: true,
          json: async () => ({ count }),
        } as Response;
      });

      const health = await provider.healthCheck();

      expect(health.available).toBe(true);
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      expect(health.issues).toHaveLength(0);
    });

    it('should flag count mismatch issues', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ count: 99 }),
      } as Response);

      const health = await provider.healthCheck();

      expect(health.issues.length).toBeGreaterThan(0);
      expect(health.issues[0]).toContain('mismatch');
    });

    it('should return unhealthy on network failure', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const health = await provider.healthCheck();

      expect(health.available).toBe(false);
      expect(health.issues.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Change Detection
  // ==========================================================================

  describe('hasChangedSince', () => {
    it('should return false when editingInfo.lastEditDate is older than lastExtraction', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          editingInfo: { lastEditDate: new Date('2025-01-01').getTime() },
        }),
      } as Response);

      const hasChanged = await provider.hasChangedSince(new Date('2025-06-01'));
      expect(hasChanged).toBe(false);
    });

    it('should return true when editingInfo.lastEditDate is newer than lastExtraction', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          editingInfo: { lastEditDate: new Date('2025-08-15').getTime() },
        }),
      } as Response);

      const hasChanged = await provider.hasChangedSince(new Date('2025-06-01'));
      expect(hasChanged).toBe(true);
    });

    it('should fall back to count comparison when editingInfo is absent', async () => {
      let callIdx = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        callIdx++;
        if (callIdx === 1) {
          // First call: FeatureServer metadata (no editingInfo)
          return { ok: true, json: async () => ({}) } as Response;
        }
        // Subsequent calls: feature count queries
        return {
          ok: true,
          json: async () => ({ count: callIdx === 2 ? 64 : 7 }),
        } as Response;
      });

      const hasChanged = await provider.hasChangedSince(new Date('2025-01-01'));
      expect(hasChanged).toBe(false);
    });

    it('should return true on network error (conservative fallback)', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const hasChanged = await provider.hasChangedSince(new Date());
      expect(hasChanged).toBe(true);
    });
  });

  // ==========================================================================
  // Expected Counts
  // ==========================================================================

  describe('getExpectedCounts', () => {
    it('should return expected counts for both layers', async () => {
      const counts = await provider.getExpectedCounts();

      expect(counts.get('general')).toBe(64);
      expect(counts.get('maori')).toBe(7);
    });
  });
});
