/**
 * DC Wards Provider Tests
 *
 * Validates DC ward boundary data acquisition and transformation.
 *
 * KEY TEST CASES:
 * - Provider interface implementation
 * - API URL construction
 * - GeoJSON transformation and ward ID format
 * - Expected ward count (exactly 8)
 * - Ward ID validation (1101-1108)
 * - Network operations (soft-fail in CI)
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DCWardsProvider,
  createDCWardsProvider,
  isValidDCWardId,
  getWardNumber,
} from '../../../providers/dc-wards-provider.js';
import type { FeatureCollection, Polygon } from 'geojson';

/**
 * Network test wrapper - skipped by default unless RUN_NETWORK_TESTS=true
 * These tests require live network access to external GIS servers.
 */
const runNetworkTests = process.env.RUN_NETWORK_TESTS === 'true';

function networkTest(name: string, fn: () => Promise<void>, timeout = 30000) {
  const vitestTimeout = timeout + 5000;

  // Skip network tests by default
  if (!runNetworkTests) {
    return test.skip(`${name} (requires RUN_NETWORK_TESTS=true)`, async () => {});
  }

  return test(name, async () => {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Network test timed out after ${timeout}ms`)),
        timeout
      );
    });

    await Promise.race([fn(), timeoutPromise]);
  }, vitestTimeout);
}

/**
 * Mock DC ward GeoJSON for unit tests
 */
function createMockWardGeoJSON(): FeatureCollection<Polygon> {
  const wards: FeatureCollection<Polygon> = {
    type: 'FeatureCollection',
    features: [],
  };

  // Create 8 mock wards
  for (let i = 1; i <= 8; i++) {
    wards.features.push({
      type: 'Feature',
      properties: {
        WARD: String(i),
        NAME: `Ward ${i}`,
        AREASQMI: 10 + i,
        POP100: 80000 + i * 1000,
        OBJECTID: i,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-77.0 + i * 0.01, 38.9],
            [-77.0 + i * 0.01 + 0.05, 38.9],
            [-77.0 + i * 0.01 + 0.05, 38.95],
            [-77.0 + i * 0.01, 38.95],
            [-77.0 + i * 0.01, 38.9],
          ],
        ],
      },
    });
  }

  return wards;
}

describe('DCWardsProvider', () => {
  describe('Provider Interface', () => {
    test('implements BoundaryProvider interface', () => {
      const provider = new DCWardsProvider();

      expect(provider.countryCode).toBe('US');
      expect(provider.name).toBe('DC Open Data Ward Boundaries');
      expect(provider.source).toContain('opendata.dc.gov');
      expect(provider.updateSchedule).toBe('event-driven');
      expect(provider.administrativeLevels).toContain('ward');
      expect(provider.administrativeLevels.length).toBe(1);
    });

    test('createDCWardsProvider factory function works', () => {
      const provider = createDCWardsProvider();

      expect(provider).toBeInstanceOf(DCWardsProvider);
      expect(provider.countryCode).toBe('US');
    });
  });

  describe('Transformation', () => {
    test('transforms mock GeoJSON to NormalizedBoundary', async () => {
      const provider = new DCWardsProvider();
      const mockGeoJSON = createMockWardGeoJSON();

      const mockRawFile = {
        url: 'https://maps2.dcgis.dc.gov/test',
        format: 'geojson' as const,
        data: Buffer.from(JSON.stringify(mockGeoJSON), 'utf-8'),
        metadata: {
          source: 'DC Open Data',
          provider: 'DCWardsProvider',
          layer: 'dc_ward',
          checksum: 'mock-checksum',
        },
      };

      const normalized = await provider.transform([mockRawFile]);

      // Verify exactly 8 wards
      expect(normalized.length).toBe(8);

      // Verify first ward
      const ward1 = normalized.find((b) => b.id === '1101');
      expect(ward1).toBeDefined();
      expect(ward1?.name).toBe('Ward 1');
      expect(ward1?.level).toBe('ward');
      expect(ward1?.parentId).toBe('11'); // DC FIPS
      expect(ward1?.properties.wardNumber).toBe(1);
      expect(ward1?.properties.stateFips).toBe('11');
      expect(ward1?.source.authorityLevel).toBe('municipal-agency');
      expect(ward1?.source.legalStatus).toBe('official');
    });

    test('assigns correct IDs to all 8 wards', async () => {
      const provider = new DCWardsProvider();
      const mockGeoJSON = createMockWardGeoJSON();

      const mockRawFile = {
        url: 'https://maps2.dcgis.dc.gov/test',
        format: 'geojson' as const,
        data: Buffer.from(JSON.stringify(mockGeoJSON), 'utf-8'),
        metadata: {
          source: 'DC Open Data',
          provider: 'DCWardsProvider',
          layer: 'dc_ward',
          checksum: 'mock-checksum',
        },
      };

      const normalized = await provider.transform([mockRawFile]);

      // Verify all ward IDs
      const expectedIds = ['1101', '1102', '1103', '1104', '1105', '1106', '1107', '1108'];
      const actualIds = normalized.map((b) => b.id).sort();

      expect(actualIds).toEqual(expectedIds);
    });

    test('throws error for wrong ward count', async () => {
      const provider = new DCWardsProvider();

      // Create GeoJSON with only 7 wards
      const incompleteGeoJSON = createMockWardGeoJSON();
      incompleteGeoJSON.features.pop(); // Remove one ward

      const mockRawFile = {
        url: 'https://maps2.dcgis.dc.gov/test',
        format: 'geojson' as const,
        data: Buffer.from(JSON.stringify(incompleteGeoJSON), 'utf-8'),
        metadata: {
          source: 'DC Open Data',
          provider: 'DCWardsProvider',
          layer: 'dc_ward',
          checksum: 'mock-checksum',
        },
      };

      await expect(provider.transform([mockRawFile])).rejects.toThrow(
        'Expected 8 DC wards, got 7'
      );
    });

    test('skips features with missing ward number', async () => {
      const provider = new DCWardsProvider();
      const mockGeoJSON = createMockWardGeoJSON();

      // Add an invalid feature
      mockGeoJSON.features.push({
        type: 'Feature',
        properties: {
          // Missing WARD and NAME
          OBJECTID: 99,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-77.1, 38.9],
              [-77.05, 38.9],
              [-77.05, 38.95],
              [-77.1, 38.95],
              [-77.1, 38.9],
            ],
          ],
        },
      } as unknown as FeatureCollection<Polygon>['features'][0]);

      const mockRawFile = {
        url: 'https://maps2.dcgis.dc.gov/test',
        format: 'geojson' as const,
        data: Buffer.from(JSON.stringify(mockGeoJSON), 'utf-8'),
        metadata: {
          source: 'DC Open Data',
          provider: 'DCWardsProvider',
          layer: 'dc_ward',
          checksum: 'mock-checksum',
        },
      };

      // Should still return 8 valid wards (invalid feature skipped)
      const normalized = await provider.transform([mockRawFile]);
      expect(normalized.length).toBe(8);
    });

    test('skips features with invalid geometry type', async () => {
      const provider = new DCWardsProvider();
      const mockGeoJSON = createMockWardGeoJSON();

      // Replace one ward's geometry with Point
      mockGeoJSON.features[0].geometry = {
        type: 'Point',
        coordinates: [-77.0, 38.9],
      } as unknown as Polygon;

      const mockRawFile = {
        url: 'https://maps2.dcgis.dc.gov/test',
        format: 'geojson' as const,
        data: Buffer.from(JSON.stringify(mockGeoJSON), 'utf-8'),
        metadata: {
          source: 'DC Open Data',
          provider: 'DCWardsProvider',
          layer: 'dc_ward',
          checksum: 'mock-checksum',
        },
      };

      // Should throw because we now have only 7 valid wards
      await expect(provider.transform([mockRawFile])).rejects.toThrow(
        'Expected 8 DC wards, got 7'
      );
    });

    test('extracts ward number from NAME when WARD is missing', async () => {
      const provider = new DCWardsProvider();
      const mockGeoJSON = createMockWardGeoJSON();

      // Remove WARD property from first feature, keep only NAME
      const firstFeature = mockGeoJSON.features[0];
      delete (firstFeature.properties as Record<string, unknown>).WARD;
      firstFeature.properties = {
        ...firstFeature.properties,
        NAME: 'Ward 1', // Should extract "1" from this
      };

      const mockRawFile = {
        url: 'https://maps2.dcgis.dc.gov/test',
        format: 'geojson' as const,
        data: Buffer.from(JSON.stringify(mockGeoJSON), 'utf-8'),
        metadata: {
          source: 'DC Open Data',
          provider: 'DCWardsProvider',
          layer: 'dc_ward',
          checksum: 'mock-checksum',
        },
      };

      const normalized = await provider.transform([mockRawFile]);
      expect(normalized.length).toBe(8);

      const ward1 = normalized.find((b) => b.id === '1101');
      expect(ward1).toBeDefined();
      expect(ward1?.name).toBe('Ward 1');
    });
  });

  describe('Metadata', () => {
    test('returns source metadata', async () => {
      const provider = new DCWardsProvider();
      const metadata = await provider.getMetadata();

      expect(metadata.provider).toBe('DC Open Data Ward Boundaries');
      expect(metadata.version).toBe('2022');
      expect(metadata.license).toBe('CC0-1.0');
      expect(metadata.authorityLevel).toBe('municipal-agency');
      expect(metadata.legalStatus).toBe('official');
      expect(metadata.collectionMethod).toBe('portal-discovery');
      expect(metadata.coordinateSystem).toBe('EPSG:4326');
      expect(metadata.updateMonitoring).toBe('api-polling');
    });

    test('includes next scheduled update after 2030 census', async () => {
      const provider = new DCWardsProvider();
      const metadata = await provider.getMetadata();

      expect(metadata.nextScheduledUpdate).toContain('2032');
    });
  });

  describe('Update Checking', () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('returns no update when metadata check fails', async () => {
      // Mock fetch to fail
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const provider = new DCWardsProvider();
      const updateInfo = await provider.checkForUpdates();

      expect(updateInfo.available).toBe(false);
      expect(updateInfo.latestVersion).toBe('2022');
      expect(updateInfo.currentVersion).toBe('2022');
    });

    test('returns no update when layer has not been modified', async () => {
      // Mock fetch to return old modification date
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          editingInfo: {
            lastEditDate: new Date('2022-01-01').getTime(),
          },
        }),
      });

      const provider = new DCWardsProvider();
      const updateInfo = await provider.checkForUpdates();

      expect(updateInfo.available).toBe(false);
      expect(updateInfo.latestVersion).toBe('2022');
    });

    test('returns update available when layer was modified this year', async () => {
      const currentYear = new Date().getFullYear();

      // Mock fetch to return current year modification date
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          editingInfo: {
            lastEditDate: new Date(`${currentYear}-06-15`).getTime(),
          },
        }),
      });

      const provider = new DCWardsProvider();
      const updateInfo = await provider.checkForUpdates();

      expect(updateInfo.available).toBe(true);
      expect(updateInfo.latestVersion).toBe(String(currentYear));
      expect(updateInfo.currentVersion).toBe('2022');
    });
  });

  describe('Helper Functions', () => {
    describe('isValidDCWardId', () => {
      test('validates correct ward IDs', () => {
        expect(isValidDCWardId('1101')).toBe(true);
        expect(isValidDCWardId('1102')).toBe(true);
        expect(isValidDCWardId('1108')).toBe(true);
      });

      test('rejects invalid ward IDs', () => {
        expect(isValidDCWardId('1100')).toBe(false); // Ward 0 doesn't exist
        expect(isValidDCWardId('1109')).toBe(false); // Ward 9 doesn't exist
        expect(isValidDCWardId('0601')).toBe(false); // Wrong state FIPS (California)
        expect(isValidDCWardId('11')).toBe(false); // Too short
        expect(isValidDCWardId('110001')).toBe(false); // Too long
        expect(isValidDCWardId('')).toBe(false);
        expect(isValidDCWardId('abcd')).toBe(false);
      });
    });

    describe('getWardNumber', () => {
      test('extracts ward number from valid IDs', () => {
        expect(getWardNumber('1101')).toBe(1);
        expect(getWardNumber('1105')).toBe(5);
        expect(getWardNumber('1108')).toBe(8);
      });

      test('returns null for invalid IDs', () => {
        expect(getWardNumber('1100')).toBeNull();
        expect(getWardNumber('0601')).toBeNull();
        expect(getWardNumber('')).toBeNull();
      });
    });
  });

  // Network-intensive tests (soft-fail in CI)
  describe('Network Operations', () => {
    networkTest('downloads DC ward boundaries from live API', async () => {
      const provider = new DCWardsProvider();

      const files = await provider.download({ level: 'ward' });

      expect(files.length).toBe(1);

      const file = files[0];
      expect(file.format).toBe('geojson');
      expect(file.url).toContain('dcgis.dc.gov');
      expect(file.metadata.layer).toBe('dc_ward');
      expect(file.metadata.stateFips).toBe('11');

      // Verify GeoJSON is valid
      const geojson = JSON.parse(file.data.toString('utf-8')) as FeatureCollection;
      expect(geojson.type).toBe('FeatureCollection');
      expect(geojson.features.length).toBeGreaterThan(0);

      console.log(`   Downloaded ${geojson.features.length} DC ward features`);
    }, 30000);

    networkTest('downloads and transforms DC wards end-to-end', async () => {
      const provider = new DCWardsProvider();

      const files = await provider.download({ level: 'ward' });
      const normalized = await provider.transform(files);

      // Verify exactly 8 wards
      expect(normalized.length).toBe(8);

      // Verify ward ID uniqueness
      const ids = normalized.map((b) => b.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);

      // Verify all wards have correct level
      for (const boundary of normalized) {
        expect(boundary.level).toBe('ward');
        expect(boundary.parentId).toBe('11');
        expect(isValidDCWardId(boundary.id)).toBe(true);
      }

      // Verify ward names
      const wardNames = normalized.map((b) => b.name).sort();
      expect(wardNames).toEqual([
        'Ward 1',
        'Ward 2',
        'Ward 3',
        'Ward 4',
        'Ward 5',
        'Ward 6',
        'Ward 7',
        'Ward 8',
      ]);

      console.log('   All 8 DC wards downloaded and transformed successfully');
    }, 60000);

    networkTest('checks for updates from live API', async () => {
      const provider = new DCWardsProvider();
      const updateInfo = await provider.checkForUpdates();

      expect(updateInfo).toHaveProperty('available');
      expect(updateInfo).toHaveProperty('latestVersion');
      expect(updateInfo).toHaveProperty('currentVersion');
      expect(updateInfo).toHaveProperty('releaseDate');

      console.log(`   Update available: ${updateInfo.available}`);
      console.log(`   Latest version: ${updateInfo.latestVersion}`);
    }, 10000);
  });

  describe('Geometry Validation', () => {
    test('accepts Polygon geometry', async () => {
      const provider = new DCWardsProvider();
      const mockGeoJSON = createMockWardGeoJSON();

      const mockRawFile = {
        url: 'https://maps2.dcgis.dc.gov/test',
        format: 'geojson' as const,
        data: Buffer.from(JSON.stringify(mockGeoJSON), 'utf-8'),
        metadata: {
          source: 'DC Open Data',
          provider: 'DCWardsProvider',
          layer: 'dc_ward',
          checksum: 'mock-checksum',
        },
      };

      const normalized = await provider.transform([mockRawFile]);

      // All should have Polygon geometry
      for (const boundary of normalized) {
        expect(boundary.geometry.type).toBe('Polygon');
      }
    });

    test('accepts MultiPolygon geometry', async () => {
      const provider = new DCWardsProvider();
      const mockGeoJSON = createMockWardGeoJSON();

      // Convert first ward to MultiPolygon
      const firstWard = mockGeoJSON.features[0];
      firstWard.geometry = {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [-77.0, 38.9],
              [-77.05, 38.9],
              [-77.05, 38.95],
              [-77.0, 38.95],
              [-77.0, 38.9],
            ],
          ],
          [
            [
              [-77.1, 38.9],
              [-77.15, 38.9],
              [-77.15, 38.95],
              [-77.1, 38.95],
              [-77.1, 38.9],
            ],
          ],
        ],
      } as unknown as Polygon;

      const mockRawFile = {
        url: 'https://maps2.dcgis.dc.gov/test',
        format: 'geojson' as const,
        data: Buffer.from(JSON.stringify(mockGeoJSON), 'utf-8'),
        metadata: {
          source: 'DC Open Data',
          provider: 'DCWardsProvider',
          layer: 'dc_ward',
          checksum: 'mock-checksum',
        },
      };

      const normalized = await provider.transform([mockRawFile]);
      expect(normalized.length).toBe(8);

      // First ward should have MultiPolygon geometry
      const ward1 = normalized.find((b) => b.id === '1101');
      expect(ward1?.geometry.type).toBe('MultiPolygon');
    });

    test('validates WGS84 coordinates are in valid range', async () => {
      const provider = new DCWardsProvider();
      const mockGeoJSON = createMockWardGeoJSON();

      const mockRawFile = {
        url: 'https://maps2.dcgis.dc.gov/test',
        format: 'geojson' as const,
        data: Buffer.from(JSON.stringify(mockGeoJSON), 'utf-8'),
        metadata: {
          source: 'DC Open Data',
          provider: 'DCWardsProvider',
          layer: 'dc_ward',
          checksum: 'mock-checksum',
        },
      };

      const normalized = await provider.transform([mockRawFile]);

      for (const boundary of normalized) {
        if (boundary.geometry.type === 'Polygon') {
          for (const ring of boundary.geometry.coordinates) {
            for (const [lon, lat] of ring) {
              // Valid longitude range: -180 to 180
              expect(lon).toBeGreaterThanOrEqual(-180);
              expect(lon).toBeLessThanOrEqual(180);

              // Valid latitude range: -90 to 90
              expect(lat).toBeGreaterThanOrEqual(-90);
              expect(lat).toBeLessThanOrEqual(90);

              // DC-specific bounds (approximately)
              expect(lon).toBeGreaterThan(-78);
              expect(lon).toBeLessThan(-76);
              expect(lat).toBeGreaterThan(38);
              expect(lat).toBeLessThan(40);
            }
          }
        }
      }
    });
  });
});
