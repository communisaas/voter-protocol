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
import type { CanadaProvince } from '../../../../providers/international/canada-provider.js';

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
      expect(federal?.expectedCount).toBe(338);
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
      const page1Response = {
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
        ],
        meta: {
          total_count: 2,
          next: '/boundaries/federal-electoral-districts/?offset=1&limit=1',
        },
      };

      const page2Response = {
        objects: [
          {
            boundary_set_name: 'federal-electoral-districts',
            external_id: '35002',
            name: 'Aurora—Oak Ridges—Richmond Hill',
            name_fr: 'Aurora—Oak Ridges—Richmond Hill',
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
        meta: {
          total_count: 2,
          next: null,
        },
      };

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => page1Response,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => page2Response,
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
      expect(result.providerVersion).toBe('1.0.0');
    });
  });

  describe('hasChangedSince', () => {
    it('should always return true (Represent API lacks lastEditDate)', async () => {
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
