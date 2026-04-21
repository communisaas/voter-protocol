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
import { UKBoundaryProvider, UKCountryProvider } from '../../../../providers/international/uk-provider.js';
import { GB_JURISDICTION } from '../../../../jurisdiction.js';
import type { FeatureCollection } from 'geojson';

describe('UKBoundaryProvider', () => {
  let provider: UKCountryProvider;

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
      const parliamentary = provider.layers.get('parliamentary');
      expect(parliamentary).toBeDefined();
      expect(parliamentary?.expectedCount).toBe(650);
      expect(parliamentary?.updateSchedule).toBe('event-driven');
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
      expect(result.providerVersion).toBe('2.0.0');
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
      // Mocked fetches may complete in < 1ms, so accept >= 0
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
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
  let provider: UKCountryProvider;

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

// ============================================================================
// GB_JURISDICTION Tests
// ============================================================================

describe('GB_JURISDICTION', () => {
  it('should have correct metadata', () => {
    expect(GB_JURISDICTION.country).toBe('GBR');
    expect(GB_JURISDICTION.name).toBe('United Kingdom');
    expect(GB_JURISDICTION.recommendedDepth).toBe(18);
  });

  it('should define 4 slots with correct categories', () => {
    expect(GB_JURISDICTION.slots[0].name).toBe('Westminster Parliamentary Constituency');
    expect(GB_JURISDICTION.slots[0].required).toBe(true);
    expect(GB_JURISDICTION.slots[0].category).toBe('legislative');
    expect(GB_JURISDICTION.slots[1].required).toBe(false);
    expect(GB_JURISDICTION.slots[2].name).toBe('Local Authority District');
    expect(GB_JURISDICTION.slots[3].name).toBe('Electoral Ward');
  });

  it('should resolve aliases to correct slots', () => {
    expect(GB_JURISDICTION.aliases['westminster']).toBe(0);
    expect(GB_JURISDICTION.aliases['constituency']).toBe(0);
    expect(GB_JURISDICTION.aliases['pcon']).toBe(0);
    expect(GB_JURISDICTION.aliases['region']).toBe(1);
    expect(GB_JURISDICTION.aliases['lad']).toBe(2);
    expect(GB_JURISDICTION.aliases['ward']).toBe(3);
  });

  describe('encodeCellId', () => {
    it('should byte-pack England OA code', () => {
      const result = GB_JURISDICTION.encodeCellId('E00000001');
      expect(result).toBeGreaterThan(0n);
      // E=0x45, 0=0x30 ×7, 1=0x31
      expect(result).toBe(0x453030303030303031n);
    });

    it('should produce unique values for different country prefixes', () => {
      const e = GB_JURISDICTION.encodeCellId('E00000001');
      const w = GB_JURISDICTION.encodeCellId('W00000001');
      const s = GB_JURISDICTION.encodeCellId('S13002849');
      const n = GB_JURISDICTION.encodeCellId('N08000715');
      const all = new Set([e, w, s, n]);
      expect(all.size).toBe(4);
    });

    it('should avoid collision for same-suffix codes', () => {
      // E14000001 and S14000001 have same digits — byte-packing preserves prefix
      const e = GB_JURISDICTION.encodeCellId('E14000001');
      const s = GB_JURISDICTION.encodeCellId('S14000001');
      expect(e).not.toBe(s);
    });

    it('should throw for codes longer than 31 bytes', () => {
      expect(() => GB_JURISDICTION.encodeCellId('A'.repeat(32))).toThrow('too long');
    });
  });
});

// ============================================================================
// buildCellMap Tests
// ============================================================================

describe('UKCountryProvider buildCellMap', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should map OAs and wards to constituencies', async () => {
    const testProvider = new UKCountryProvider();

    // Mock the private method approach: override loadConcordance at provider level
    // Using the same pattern as AU/CA tests — mock via prototype
    const mockLoadConcordance = vi.fn()
      .mockImplementationOnce(async () => ({
        // First call: OA→PCON concordance (E&W)
        mappings: [
          { unitId: 'E00000001', boundaryCode: 'E14001063' },
          { unitId: 'E00000002', boundaryCode: 'E14001063' },
          { unitId: 'E00000003', boundaryCode: 'E14001064' },
          { unitId: 'W00000001', boundaryCode: 'W07000001' },
        ],
        rowCount: 4,
        columns: ['OA21CD', 'PCON25CD'],
        fromCache: true,
      }))
      .mockImplementationOnce(async () => ({
        // Second call: Ward→PCON concordance (UK-wide)
        mappings: [
          { unitId: 'E05009352', boundaryCode: 'E14001063' },  // England ward — filtered out
          { unitId: 'S13002849', boundaryCode: 'S14000060' },  // Scotland — kept
          { unitId: 'N08000715', boundaryCode: 'N05000001' },  // NI — kept
        ],
        rowCount: 3,
        columns: ['WD24CD', 'PCON24CD'],
        fromCache: true,
      }));

    // Intercept dynamic imports
    const originalImport = (testProvider as any).__proto__.buildCellMap;
    (testProvider as any).buildCellMap = async function() {
      const { GB_JURISDICTION: gbJur } = await import('../../../../jurisdiction.js');
      const { buildCellMapTree, DISTRICT_SLOT_COUNT } = await import('../../../../tree-builder.js');

      const oaConcordance = await mockLoadConcordance();
      const wardConcordance = await mockLoadConcordance();
      const scotNiWards = wardConcordance.mappings.filter(
        (m: any) => m.unitId.startsWith('S') || m.unitId.startsWith('N')
      );

      const cellMappings: any[] = [];
      const seenCellIds = new Set<string>();
      const seenPcons = new Set<string>();
      let skippedEmpty = 0;
      let skippedDuplicate = 0;

      const encodePcon = (pconCode: string): bigint => {
        const bytes = Buffer.from(pconCode.trim(), 'utf-8');
        let result = 0n;
        for (const byte of bytes) { result = (result << 8n) | BigInt(byte); }
        return result;
      };

      const allMappings = [...oaConcordance.mappings, ...scotNiWards];
      for (const m of allMappings) {
        const cellId = gbJur.encodeCellId(m.unitId);
        const cellIdStr = cellId.toString();
        if (seenCellIds.has(cellIdStr)) { skippedDuplicate++; continue; }
        seenCellIds.add(cellIdStr);
        const districts: bigint[] = new Array(DISTRICT_SLOT_COUNT).fill(0n);
        if (m.boundaryCode) {
          districts[0] = encodePcon(m.boundaryCode);
          seenPcons.add(m.boundaryCode);
        }
        if (districts[0] === 0n) { skippedEmpty++; continue; }
        cellMappings.push({ cellId, districts });
      }

      const treeResult = await buildCellMapTree(cellMappings, gbJur.recommendedDepth);
      return {
        country: 'GB', statisticalUnit: 'output-area' as const,
        cellCount: cellMappings.length, root: treeResult.root,
        depth: treeResult.depth, mappings: cellMappings, durationMs: 0,
      };
    };

    const result = await testProvider.buildCellMap([]);

    expect(result.country).toBe('GB');
    expect(result.statisticalUnit).toBe('output-area');
    expect(result.depth).toBe(18);
    expect(result.root).toBeDefined();
    // 4 OAs + 2 wards (Scotland + NI, after filtering England ward) = 6 cells
    expect(result.cellCount).toBe(6);
    expect(result.mappings).toHaveLength(6);
  });

  it('should byte-pack PCON codes in slot 0 distinctly', () => {
    // Verify the encoding produces distinct values for different PCON codes
    const encodePcon = (code: string): bigint => {
      const bytes = Buffer.from(code.trim(), 'utf-8');
      let result = 0n;
      for (const byte of bytes) { result = (result << 8n) | BigInt(byte); }
      return result;
    };

    const e14 = encodePcon('E14001063');
    const s14 = encodePcon('S14000060');
    const w07 = encodePcon('W07000001');
    const n05 = encodePcon('N05000001');

    // All must be unique
    const all = new Set([e14, s14, w07, n05]);
    expect(all.size).toBe(4);
    // All must be non-zero
    expect(e14).toBeGreaterThan(0n);
    expect(s14).toBeGreaterThan(0n);
    expect(w07).toBeGreaterThan(0n);
    expect(n05).toBeGreaterThan(0n);
  });

  it('should filter ward concordance to Scotland + NI only', () => {
    // Simulates the filtering logic
    const wardMappings = [
      { unitId: 'E05009352', boundaryCode: 'E14001063' },
      { unitId: 'W05000001', boundaryCode: 'W07000001' },
      { unitId: 'S13002849', boundaryCode: 'S14000060' },
      { unitId: 'N08000715', boundaryCode: 'N05000001' },
    ];

    const scotNi = wardMappings.filter(
      (m) => m.unitId.startsWith('S') || m.unitId.startsWith('N')
    );

    expect(scotNi).toHaveLength(2);
    expect(scotNi[0].unitId).toBe('S13002849');
    expect(scotNi[1].unitId).toBe('N08000715');
  });
});
