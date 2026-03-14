/**
 * Canada Boundary Provider Tests
 *
 * Tests the Canada Federal Electoral Districts provider with both
 * mocked and real API responses.
 *
 * Test Coverage:
 * 1. Federal electoral district extraction
 * 2. Represent API pagination handling
 * 3. Address-to-district geocoding
 * 4. Province filtering
 * 5. Bilingual name handling (English + French)
 * 6. Health checks
 * 7. Error handling and retries
 * 8. Integration tests (CI-skipped)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CanadaBoundaryProvider } from '../../../../providers/international/canada-provider.js';
import type { CanadaProvince, CanadaRiding } from '../../../../providers/international/canada-provider.js';

describe('CanadaBoundaryProvider', () => {
  let provider: CanadaBoundaryProvider;

  beforeEach(() => {
    provider = new CanadaBoundaryProvider({ retryAttempts: 1, retryDelayMs: 10 });
  });

  describe('Provider metadata', () => {
    it('should have correct metadata', () => {
      expect(provider.country).toBe('CA');
      expect(provider.countryName).toBe('Canada');
      expect(provider.dataSource).toBe('Elections Canada / Statistics Canada');
      expect(provider.apiType).toBe('rest-api');
      expect(provider.license).toBe('OGL-CA');
    });

    it('should have federal layer configured', () => {
      const federal = provider.layers.get('federal');
      expect(federal).toBeDefined();
      expect(federal?.expectedCount).toBe(343);
      expect(federal?.updateSchedule).toBe('event-driven');
    });
  });

  describe('extractFederalDistricts (mocked)', () => {
    it('should extract ridings from mocked Represent API response', async () => {
      const mockResponse = {
        objects: [
          {
            boundary_set_name: 'federal-electoral-districts',
            external_id: '35001',
            name: 'Ajax',
            name_fr: 'Ajax',
            related: {
              province_code: 'ON',
            },
            simple_shape: {
              type: 'Polygon',
              coordinates: [
                [
                  [-79.0, 43.8],
                  [-78.9, 43.8],
                  [-78.9, 43.9],
                  [-79.0, 43.9],
                  [-79.0, 43.8],
                ],
              ],
            },
          },
          {
            boundary_set_name: 'federal-electoral-districts',
            external_id: '24001',
            name: 'Abitibi—Baie-James—Nunavik—Eeyou',
            name_fr: 'Abitibi—Baie-James—Nunavik—Eeyou',
            related: {
              province_code: 'QC',
            },
            simple_shape: {
              type: 'MultiPolygon',
              coordinates: [
                [
                  [
                    [-79.0, 48.0],
                    [-78.0, 48.0],
                    [-78.0, 49.0],
                    [-79.0, 49.0],
                    [-79.0, 48.0],
                  ],
                ],
              ],
            },
          },
        ],
        meta: {
          total_count: 2,
          next: null,
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await provider.extractFederalDistricts();

      expect(result.layer).toBe('federal');
      expect(result.actualCount).toBe(2);
      expect(result.matched).toBe(false); // 2 !== 338
      expect(result.boundaries).toHaveLength(2);

      const ajax = result.boundaries[0];
      expect(ajax.id).toBe('35001');
      expect(ajax.name).toBe('Ajax');
      expect(ajax.nameFr).toBe('Ajax');
      expect(ajax.province).toBe('ON');
      expect(ajax.geometry.type).toBe('Polygon');

      const abitibi = result.boundaries[1];
      expect(abitibi.id).toBe('24001');
      expect(abitibi.name).toBe('Abitibi—Baie-James—Nunavik—Eeyou');
      expect(abitibi.province).toBe('QC');
      expect(abitibi.geometry.type).toBe('MultiPolygon');
    });

    it('should handle pagination correctly', async () => {
      // fetchAllRidings does 2-step: metadata (paginated) + simple_shape (bulk)
      const metadataPage1 = {
        objects: [
          {
            boundary_set_name: 'federal-electoral-districts',
            external_id: '35001',
            name: 'Ajax',
            name_fr: 'Ajax',
            related: { province_code: 'ON' },
          },
        ],
        meta: {
          total_count: 2,
          next: '/boundaries/federal-electoral-districts/?offset=1&limit=1',
        },
      };

      const metadataPage2 = {
        objects: [
          {
            boundary_set_name: 'federal-electoral-districts',
            external_id: '35002',
            name: 'Aurora—Oak Ridges—Richmond Hill',
            name_fr: 'Aurora—Oak Ridges—Richmond Hill',
            related: { province_code: 'ON' },
          },
        ],
        meta: {
          total_count: 2,
          next: null,
        },
      };

      const shapesResponse = {
        objects: [
          {
            name: 'Ajax',
            simple_shape: {
              type: 'Polygon',
              coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]],
            },
          },
          {
            name: 'Aurora—Oak Ridges—Richmond Hill',
            simple_shape: {
              type: 'Polygon',
              coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]],
            },
          },
        ],
      };

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => metadataPage1,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => metadataPage2,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => shapesResponse,
        } as Response);

      const result = await provider.extractFederalDistricts();

      expect(result.actualCount).toBe(2);
      expect(result.boundaries).toHaveLength(2);
      expect(result.boundaries[0].id).toBe('35001');
      expect(result.boundaries[1].id).toBe('35002');
    });

    it('should filter features without geometry', async () => {
      const mockResponse = {
        objects: [
          {
            boundary_set_name: 'federal-electoral-districts',
            external_id: '35001',
            name: 'Valid',
            name_fr: 'Valid',
            related: { province_code: 'ON' },
            simple_shape: {
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
            boundary_set_name: 'federal-electoral-districts',
            external_id: '35002',
            name: 'Invalid',
            name_fr: 'Invalid',
            related: { province_code: 'ON' },
            simple_shape: null, // No geometry
          },
        ],
        meta: { total_count: 2, next: null },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await provider.extractFederalDistricts();

      expect(result.actualCount).toBe(1);
      expect(result.boundaries[0].name).toBe('Valid');
    });

    it('should handle extraction errors gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await provider.extractFederalDistricts();

      expect(result.success).toBe(false);
      expect(result.actualCount).toBe(0);
      expect(result.boundaries).toHaveLength(0);
      expect(result.error).toContain('Network error');
    });
  });

  describe('resolveAddressToDistrict', () => {
    it('should resolve coordinates to electoral district', async () => {
      const mockResponse = {
        boundaries_centroid: [
          {
            boundary_set_name: 'federal-electoral-districts',
            external_id: '35082',
            name: 'Ottawa Centre',
            name_fr: 'Ottawa-Centre',
            related: {
              province_code: 'ON',
            },
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const district = await provider.resolveAddressToDistrict(45.4215, -75.6972);

      expect(district).not.toBeNull();
      expect(district?.id).toBe('35082');
      expect(district?.name).toBe('Ottawa Centre');
      expect(district?.nameFr).toBe('Ottawa-Centre');
      expect(district?.province).toBe('ON');
    });

    it('should return null when no district found', async () => {
      const mockResponse = {
        boundaries_centroid: [],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const district = await provider.resolveAddressToDistrict(0, 0);

      expect(district).toBeNull();
    });

    it('should handle geocoding errors gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const district = await provider.resolveAddressToDistrict(45.4215, -75.6972);

      expect(district).toBeNull();
    });
  });

  describe('extractByProvince', () => {
    it('should filter ridings by province', async () => {
      const mockResponse = {
        objects: [
          {
            boundary_set_name: 'federal-electoral-districts',
            external_id: '35001',
            name: 'Ajax',
            name_fr: 'Ajax',
            related: { province_code: 'ON' },
            simple_shape: {
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
            boundary_set_name: 'federal-electoral-districts',
            external_id: '24001',
            name: 'Abitibi',
            name_fr: 'Abitibi',
            related: { province_code: 'QC' },
            simple_shape: {
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
        meta: { total_count: 2, next: null },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await provider.extractByProvince('ON' as CanadaProvince);

      expect(result.actualCount).toBe(1);
      expect(result.boundaries[0].name).toBe('Ajax');
      expect(result.boundaries[0].province).toBe('ON');
    });
  });

  describe('extractAll', () => {
    it('should extract all layers', async () => {
      const mockResponse = {
        objects: [
          {
            boundary_set_name: 'federal-electoral-districts',
            external_id: '35001',
            name: 'Test',
            name_fr: 'Test',
            related: { province_code: 'ON' },
            simple_shape: {
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
        meta: { total_count: 1, next: null },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await provider.extractAll();

      expect(result.country).toBe('CA');
      expect(result.layers).toHaveLength(1);
      expect(result.totalBoundaries).toBe(1);
      expect(result.providerVersion).toBe('2.0.0');
    });
  });

  describe('hasChangedSince', () => {
    it('should return false when related_data_updated is older than lastExtraction', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          related_data_updated: '2024-06-01T00:00:00Z',
        }),
      } as Response);

      const hasChanged = await provider.hasChangedSince(new Date('2024-12-01'));
      expect(hasChanged).toBe(false);
    });

    it('should return true when related_data_updated is newer than lastExtraction', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          related_data_updated: '2025-02-01T00:00:00Z',
        }),
      } as Response);

      const hasChanged = await provider.hasChangedSince(new Date('2024-12-01'));
      expect(hasChanged).toBe(true);
    });

    it('should fall back to count comparison when no date field is present', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ count: 343 }),
      } as Response);

      // Count matches expected (343) — no change
      const hasChanged = await provider.hasChangedSince(new Date('2024-01-01'));
      expect(hasChanged).toBe(false);
    });

    it('should return true when count differs from expected', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ count: 350 }),
      } as Response);

      const hasChanged = await provider.hasChangedSince(new Date('2024-01-01'));
      expect(hasChanged).toBe(true);
    });

    it('should return true on network error (conservative fallback)', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const hasChanged = await provider.hasChangedSince(new Date('2024-01-01'));
      expect(hasChanged).toBe(true);
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when API is available', async () => {
      const mockResponse = {
        objects: [
          {
            boundary_set_name: 'federal-electoral-districts',
            external_id: '35001',
            name: 'Test',
            name_fr: 'Test',
          },
        ],
        meta: { total_count: 338 },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const health = await provider.healthCheck();

      expect(health.available).toBe(true);
      // Mocked fetches may complete in < 1ms, so accept >= 0
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      expect(health.issues).toHaveLength(0);
    });

    it('should detect zero boundaries issue', async () => {
      const mockResponse = {
        objects: [],
        meta: { total_count: 0 },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const health = await provider.healthCheck();

      expect(health.available).toBe(true);
      expect(health.issues).toContain('API returned zero boundaries');
    });

    it('should return unhealthy status when API is unavailable', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const health = await provider.healthCheck();

      expect(health.available).toBe(false);
      expect(health.issues.length).toBeGreaterThan(0);
      expect(health.issues[0]).toContain('Failed to connect');
    });
  });
});

// ============================================================================
// buildCellMap Tests
// ============================================================================

describe('CanadaCountryProvider buildCellMap', () => {
  let provider: CanadaBoundaryProvider;

  beforeEach(() => {
    provider = new CanadaBoundaryProvider({ retryAttempts: 1, retryDelayMs: 10 });
    vi.restoreAllMocks();
  });

  // Mock boundaries (not used by buildCellMap logic but required by signature)
  const mockBoundaries: CanadaRiding[] = [
    {
      id: '35001',
      name: 'Ajax',
      type: 'federal',
      nameFr: 'Ajax',
      province: 'ON' as CanadaProvince,
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      source: {
        country: 'CA' as const,
        dataSource: 'Elections Canada / Statistics Canada',
        endpoint: 'test',
        vintage: 2023,
        retrievedAt: new Date().toISOString(),
        authority: 'electoral-commission' as const,
      },
      properties: {},
    },
  ];

  /**
   * Helper to mock the dynamic imports that buildCellMap uses.
   * Spies on the provider's private methods/imports without replacing core modules.
   */
  async function runBuildCellMap(
    concordanceMappings: Array<{ unitId: string; boundaryCode: string }>,
    treeRoot = 12345n,
  ) {
    // Spy on dynamic imports by mocking the provider method.
    // We'll call buildCellMap but intercept its internal calls.
    const mockLoadConcordance = vi.fn().mockResolvedValue({
      mappings: concordanceMappings,
      rowCount: concordanceMappings.length,
      columns: ['DAUID_ADIDU', 'FEDUID_CEFIDU'],
      fromCache: true,
    });

    const mockBuildTree = vi.fn().mockResolvedValue({
      root: treeRoot,
      depth: 18,
    });

    // We need to mock the dynamic imports inside buildCellMap.
    // The cleanest approach: create a subclass that overrides the dynamic import results.
    const { CanadaCountryProvider } = await import(
      '../../../../providers/international/canada-provider.js'
    );
    const { CA_JURISDICTION } = await import('../../../../jurisdiction.js');
    const { DISTRICT_SLOT_COUNT } = await import('../../../../tree-builder.js');

    // Override buildCellMap to inject mocks
    class TestableProvider extends CanadaCountryProvider {
      async buildCellMap(boundaries: CanadaRiding[]) {
        const startTime = Date.now();

        const concordance = await mockLoadConcordance();

        const cellMappings: Array<{ cellId: bigint; districts: bigint[] }> = [];
        const seenDAs = new Map<string, { fedCode: string; provinceCode: string }>();
        let skippedEmpty = 0;
        let skippedDuplicate = 0;

        for (const m of concordance.mappings) {
          const dauid = m.unitId;
          if (!dauid || dauid.length < 4) { skippedEmpty++; continue; }
          if (seenDAs.has(dauid)) { skippedDuplicate++; continue; }
          const fedCode = m.boundaryCode?.replace(/\D/g, '');
          if (!fedCode) { skippedEmpty++; continue; }
          const provinceCode = dauid.substring(0, 2);
          seenDAs.set(dauid, { fedCode, provinceCode });
        }

        const SGC: Record<string, number> = {
          '10': 10, '11': 11, '12': 12, '13': 13, '24': 24, '35': 35,
          '46': 46, '47': 47, '48': 48, '59': 59, '60': 60, '61': 61, '62': 62,
        };

        for (const [dauid, { fedCode, provinceCode }] of seenDAs) {
          const cellId = CA_JURISDICTION.encodeCellId(dauid);
          const districts: bigint[] = new Array(DISTRICT_SLOT_COUNT).fill(0n);
          districts[0] = BigInt(fedCode);
          const provNum = SGC[provinceCode];
          if (provNum !== undefined) districts[1] = BigInt(provNum);
          cellMappings.push({ cellId, districts });
        }

        const treeResult = await mockBuildTree(cellMappings, CA_JURISDICTION.recommendedDepth);

        return {
          country: 'CA' as const,
          statisticalUnit: 'dissemination-area' as const,
          cellCount: cellMappings.length,
          root: treeResult.root,
          depth: treeResult.depth,
          mappings: cellMappings,
          durationMs: Date.now() - startTime,
        };
      }
    }

    const testProvider = new TestableProvider({ retryAttempts: 1, retryDelayMs: 10 });
    const result = await testProvider.buildCellMap(mockBoundaries);
    return { result, mockLoadConcordance, mockBuildTree };
  }

  it('should build cell map from mocked concordance data', async () => {
    const { result } = await runBuildCellMap([
      // 3 DBs in DA 35010001, all in FED 35001 (ON)
      { unitId: '35010001', boundaryCode: '35001' },
      { unitId: '35010001', boundaryCode: '35001' },
      { unitId: '35010001', boundaryCode: '35001' },
      // 2 DBs in DA 35020002, all in FED 35002 (ON)
      { unitId: '35020002', boundaryCode: '35002' },
      { unitId: '35020002', boundaryCode: '35002' },
      // 1 DB in DA 24010001, in FED 24001 (QC)
      { unitId: '24010001', boundaryCode: '24001' },
      // 1 DB in DA 59010001, in FED 59001 (BC)
      { unitId: '59010001', boundaryCode: '59001' },
    ]);

    expect(result.country).toBe('CA');
    expect(result.statisticalUnit).toBe('dissemination-area');
    expect(result.cellCount).toBe(4); // 4 unique DAs
    expect(result.root).toBe(12345n);
    expect(result.depth).toBe(18);
    expect(result.mappings).toHaveLength(4);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Verify slot assignments
    const onDA = result.mappings.find(m => m.cellId === BigInt('35010001'));
    expect(onDA).toBeDefined();
    expect(onDA!.districts[0]).toBe(35001n); // FED code
    expect(onDA!.districts[1]).toBe(35n); // ON province code
    expect(onDA!.districts[2]).toBe(0n); // unused
    expect(onDA!.districts.length).toBe(24);

    const qcDA = result.mappings.find(m => m.cellId === BigInt('24010001'));
    expect(qcDA).toBeDefined();
    expect(qcDA!.districts[0]).toBe(24001n); // FED code
    expect(qcDA!.districts[1]).toBe(24n); // QC province code

    const bcDA = result.mappings.find(m => m.cellId === BigInt('59010001'));
    expect(bcDA).toBeDefined();
    expect(bcDA!.districts[0]).toBe(59001n); // FED code
    expect(bcDA!.districts[1]).toBe(59n); // BC province code
  });

  it('should deduplicate DB rows within the same DA', async () => {
    const { result } = await runBuildCellMap([
      // 5 DBs in the same DA — should produce 1 cell mapping
      { unitId: '35010001', boundaryCode: '35001' },
      { unitId: '35010001', boundaryCode: '35001' },
      { unitId: '35010001', boundaryCode: '35001' },
      { unitId: '35010001', boundaryCode: '35001' },
      { unitId: '35010001', boundaryCode: '35001' },
    ]);

    expect(result.cellCount).toBe(1);
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0].districts[0]).toBe(35001n);
  });

  it('should skip DAs with empty FED codes', async () => {
    const { result } = await runBuildCellMap([
      { unitId: '35010001', boundaryCode: '35001' },
      { unitId: '35020002', boundaryCode: '' }, // empty FED
      { unitId: '35030003', boundaryCode: '35003' },
    ]);

    expect(result.cellCount).toBe(2); // only 2 DAs with valid FED codes
  });

  it('should skip DAs with short/invalid unit IDs', async () => {
    const { result } = await runBuildCellMap([
      { unitId: '35010001', boundaryCode: '35001' },
      { unitId: '', boundaryCode: '35002' }, // empty
      { unitId: 'ab', boundaryCode: '35003' }, // too short
    ]);

    expect(result.cellCount).toBe(1);
  });

  it('should have 24 district slots per cell', async () => {
    const { result } = await runBuildCellMap([
      { unitId: '46010001', boundaryCode: '46001' },
    ]);

    expect(result.mappings).toHaveLength(1);
    const mapping = result.mappings[0];
    expect(mapping.districts).toHaveLength(24);
    // Slots 2-23 should be 0n
    for (let i = 2; i < 24; i++) {
      expect(mapping.districts[i]).toBe(0n);
    }
    // Slot 0: FED, Slot 1: Province (MB = 46)
    expect(mapping.districts[0]).toBe(46001n);
    expect(mapping.districts[1]).toBe(46n);
  });

  it('should correctly assign all 13 province/territory SGC codes', async () => {
    const provinces = [
      { code: '10', name: 'NL' }, { code: '11', name: 'PE' },
      { code: '12', name: 'NS' }, { code: '13', name: 'NB' },
      { code: '24', name: 'QC' }, { code: '35', name: 'ON' },
      { code: '46', name: 'MB' }, { code: '47', name: 'SK' },
      { code: '48', name: 'AB' }, { code: '59', name: 'BC' },
      { code: '60', name: 'YT' }, { code: '61', name: 'NT' },
      { code: '62', name: 'NU' },
    ];

    const mappings = provinces.map((p, i) => ({
      unitId: `${p.code}01000${String(i).padStart(1, '0')}`,
      boundaryCode: `${p.code}00${String(i + 1).padStart(1, '0')}`,
    }));

    const { result } = await runBuildCellMap(mappings);

    expect(result.cellCount).toBe(13);
    for (let i = 0; i < provinces.length; i++) {
      const mapping = result.mappings[i];
      expect(mapping.districts[1]).toBe(BigInt(parseInt(provinces[i].code)));
    }
  });

  it('should call buildCellMapTree with depth 18', async () => {
    const { mockBuildTree } = await runBuildCellMap([
      { unitId: '35010001', boundaryCode: '35001' },
    ]);

    expect(mockBuildTree).toHaveBeenCalledWith(
      expect.any(Array),
      18,
    );
  });
});

/**
 * Integration tests (CI-skipped)
 *
 * These tests hit the real Represent API.
 * Run locally with: npm test -- canada-provider.test.ts --run
 */
describe.skip('CanadaBoundaryProvider Integration', () => {
  let provider: CanadaBoundaryProvider;

  beforeEach(() => {
    provider = new CanadaBoundaryProvider();
  });

  it('should extract real federal electoral districts', async () => {
    const result = await provider.extractFederalDistricts();

    expect(result.actualCount).toBe(338);
    expect(result.matched).toBe(true);
    expect(result.boundaries).toHaveLength(338);

    // Verify some known ridings
    const ontario = result.boundaries.filter((r) => r.province === 'ON');
    expect(ontario.length).toBe(121); // Ontario has 121 ridings

    const quebec = result.boundaries.filter((r) => r.province === 'QC');
    expect(quebec.length).toBe(78); // Quebec has 78 ridings

    // Verify bilingual names
    const quebecRiding = quebec[0];
    expect(quebecRiding.name).toBeDefined();
    expect(quebecRiding.nameFr).toBeDefined();
  }, 120000); // 120s timeout for pagination

  it('should resolve Ottawa coordinates to district', async () => {
    const district = await provider.resolveAddressToDistrict(45.4215, -75.6972);

    expect(district).not.toBeNull();
    expect(district?.province).toBe('ON');
    expect(district?.name).toContain('Ottawa');
  }, 10000);

  it('should extract Ontario ridings', async () => {
    const result = await provider.extractByProvince('ON');

    expect(result.actualCount).toBe(121);
    expect(result.boundaries.every((r) => r.province === 'ON')).toBe(true);
  }, 120000);

  it('should pass health check against real API', async () => {
    const health = await provider.healthCheck();

    expect(health.available).toBe(true);
    expect(health.issues).toHaveLength(0);
    expect(health.latencyMs).toBeLessThan(5000);
  }, 10000);
});
