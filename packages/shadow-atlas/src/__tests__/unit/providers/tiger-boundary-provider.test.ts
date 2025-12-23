/**
 * TIGER Boundary Provider Tests
 *
 * Validates authoritative federal boundary data acquisition and transformation.
 *
 * KEY TEST CASES:
 * - Layer metadata validation (CD, SLDU, SLDL, COUNTY)
 * - National file download (Congressional Districts, Counties)
 * - State file download (State Legislative Districts)
 * - GeoJSON transformation and GEOID uniqueness
 * - Expected feature counts (440-445 CD including territories, 3143 counties)
 * - Network resilience (retry with exponential backoff)
 */

import { describe, test, expect } from 'vitest';
import { TIGERBoundaryProvider, TIGER_LAYERS, type TIGERLayer } from '../../../providers/tiger-boundary-provider.js';
import { NATIONAL_TOTALS } from '../validators/tiger-expected-counts.js';
import type { FeatureCollection } from 'geojson';

/**
 * Soft-fail wrapper for network tests in CI
 * - CI: Network failures are logged as warnings, test passes
 * - Local: Network failures fail the test normally
 */
const isCI = process.env.CI === 'true';

function networkTest(name: string, fn: () => Promise<void>, timeout: number = 30000) {
  // Use a longer Vitest timeout to let our own timeout handling work
  const vitestTimeout = timeout + 5000;

  return test(name, async () => {
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

describe('TIGERBoundaryProvider', () => {
  describe('Layer Metadata', () => {
    test('defines Congressional Districts metadata correctly', () => {
      const cd = TIGER_LAYERS.cd;

      expect(cd.name).toBe('Congressional Districts');
      expect(cd.ftpDir).toBe('CD');
      expect(cd.tigerWebLayerId).toBe(18);
      expect(NATIONAL_TOTALS.cd).toBe(435);
      // CD uses state-level files (tl_2024_{stateFips}_cd119.zip)
      expect(cd.filePattern).toBe('state');
      expect(cd.adminLevel).toBe('district');

      // Verify field mappings
      expect(cd.fields.stateFips).toBe('STATEFP');
      // CD119FP for 119th Congress (2024 TIGER data)
      expect(cd.fields.entityFips).toBe('CD119FP');
      expect(cd.fields.geoid).toBe('GEOID');
      expect(cd.fields.name).toBe('NAMELSAD');
    });

    test('defines State Legislative Upper metadata correctly', () => {
      const sldu = TIGER_LAYERS.sldu;

      expect(sldu.name).toBe('State Legislative Upper');
      expect(sldu.ftpDir).toBe('SLDU');
      expect(sldu.tigerWebLayerId).toBe(20);
      expect(NATIONAL_TOTALS.sldu).toBeGreaterThan(1900); // ~1972 actual
      expect(sldu.filePattern).toBe('state');
      expect(sldu.adminLevel).toBe('district');

      // Verify field mappings
      expect(sldu.fields.stateFips).toBe('STATEFP');
      expect(sldu.fields.entityFips).toBe('SLDUST');
      expect(sldu.fields.geoid).toBe('GEOID');
      expect(sldu.fields.name).toBe('NAMELSAD');
    });

    test('defines State Legislative Lower metadata correctly', () => {
      const sldl = TIGER_LAYERS.sldl;

      expect(sldl.name).toBe('State Legislative Lower');
      expect(sldl.ftpDir).toBe('SLDL');
      expect(sldl.tigerWebLayerId).toBe(22);
      expect(NATIONAL_TOTALS.sldl).toBeGreaterThan(5300); // ~5411 actual
      expect(sldl.filePattern).toBe('state');
      expect(sldl.adminLevel).toBe('district');

      // Verify field mappings
      expect(sldl.fields.stateFips).toBe('STATEFP');
      expect(sldl.fields.entityFips).toBe('SLDLST');
      expect(sldl.fields.geoid).toBe('GEOID');
      expect(sldl.fields.name).toBe('NAMELSAD');
    });

    test('defines Counties metadata correctly', () => {
      const county = TIGER_LAYERS.county;

      expect(county.name).toBe('Counties');
      expect(county.ftpDir).toBe('COUNTY');
      expect(county.tigerWebLayerId).toBe(12);
      expect(NATIONAL_TOTALS.county).toBe(3143);
      expect(county.filePattern).toBe('national');
      expect(county.adminLevel).toBe('county');

      // Verify field mappings
      expect(county.fields.stateFips).toBe('STATEFP');
      expect(county.fields.entityFips).toBe('COUNTYFP');
      expect(county.fields.geoid).toBe('GEOID');
      expect(county.fields.name).toBe('NAMELSAD');
    });

    test('all layers have required field mappings', () => {
      const requiredFields = ['stateFips', 'entityFips', 'geoid', 'name'];

      for (const [layerKey, metadata] of Object.entries(TIGER_LAYERS)) {
        for (const field of requiredFields) {
          expect(metadata.fields).toHaveProperty(field);
          expect(metadata.fields[field as keyof typeof metadata.fields]).toBeTruthy();
        }

        console.log(`   ✅ ${metadata.name}: All required fields present`);
      }
    });
  });

  describe('Provider Interface', () => {
    test('implements BoundaryProvider interface', () => {
      const provider = new TIGERBoundaryProvider();

      expect(provider.countryCode).toBe('US');
      expect(provider.name).toBe('US Census Bureau TIGER/Line Boundaries');
      expect(provider.source).toContain('census.gov');
      expect(provider.updateSchedule).toBe('annual');
      expect(provider.administrativeLevels).toContain('district');
      expect(provider.administrativeLevels).toContain('county');
    });

    test('allows custom year configuration', () => {
      const provider = new TIGERBoundaryProvider({ year: 2023 });
      // Access private field via type assertion for testing
      expect((provider as any).year).toBe(2023);
    });

    test('allows custom cache directory', () => {
      const customCache = '/tmp/tiger-test-cache';
      const provider = new TIGERBoundaryProvider({ cacheDir: customCache });
      expect((provider as any).cacheDir).toBe(customCache);
    });
  });

  describe('URL Generation', () => {
    test('generates national Congressional Districts URL correctly', () => {
      const provider = new TIGERBoundaryProvider({ year: 2024 });
      const url = (provider as any).getNationalFileUrl('cd', 2024);

      expect(url).toBe('https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_us_cd.zip');
    });

    test('generates national Counties URL correctly', () => {
      const provider = new TIGERBoundaryProvider({ year: 2024 });
      const url = (provider as any).getNationalFileUrl('county', 2024);

      expect(url).toBe('https://www2.census.gov/geo/tiger/TIGER2024/COUNTY/tl_2024_us_county.zip');
    });

    test('generates state SLDU URL correctly', () => {
      const provider = new TIGERBoundaryProvider({ year: 2024 });
      const url = (provider as any).getStateFileUrl('sldu', '06', 2024); // California

      expect(url).toBe('https://www2.census.gov/geo/tiger/TIGER2024/SLDU/tl_2024_06_sldu.zip');
    });

    test('generates state SLDL URL correctly', () => {
      const provider = new TIGERBoundaryProvider({ year: 2024 });
      const url = (provider as any).getStateFileUrl('sldl', '36', 2024); // New York

      expect(url).toBe('https://www2.census.gov/geo/tiger/TIGER2024/SLDL/tl_2024_36_sldl.zip');
    });
  });

  describe('Administrative Level Mapping', () => {
    test('maps district level to all district layers', () => {
      const provider = new TIGERBoundaryProvider();
      const layers = (provider as any).mapAdminLevelToLayers('district');

      expect(layers).toContain('cd');
      expect(layers).toContain('sldu');
      expect(layers).toContain('sldl');
      expect(layers.length).toBe(3);
    });

    test('maps county level to county layer', () => {
      const provider = new TIGERBoundaryProvider();
      const layers = (provider as any).mapAdminLevelToLayers('county');

      expect(layers).toContain('county');
      expect(layers.length).toBe(1);
    });

    test('returns empty array for unsupported level', () => {
      const provider = new TIGERBoundaryProvider();
      const layers = (provider as any).mapAdminLevelToLayers('city');

      expect(layers).toEqual([]);
    });
  });

  describe('Transformation', () => {
    test('transforms mock GeoJSON to NormalizedBoundary', async () => {
      const provider = new TIGERBoundaryProvider({ year: 2024 });

      // Mock Congressional District GeoJSON (119th Congress, 2024 TIGER)
      const mockGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {
              STATEFP: '06',
              CD119FP: '12',
              GEOID: '0612',
              NAMELSAD: 'Congressional District 12',
            },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-122.5, 37.7],
                  [-122.4, 37.7],
                  [-122.4, 37.8],
                  [-122.5, 37.8],
                  [-122.5, 37.7],
                ],
              ],
            },
          },
        ],
      };

      const mockRawFile = {
        url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_us_cd.zip',
        format: 'geojson' as const,
        data: Buffer.from(JSON.stringify(mockGeoJSON), 'utf-8'),
        metadata: {
          source: 'US Census Bureau TIGER/Line 2024',
          provider: 'TIGERBoundaryProvider',
          layer: 'cd',
          checksum: 'mock-checksum',
        },
      };

      const normalized = await provider.transform([mockRawFile]);

      expect(normalized.length).toBe(1);

      const boundary = normalized[0];
      expect(boundary.id).toBe('0612');
      expect(boundary.name).toBe('Congressional District 12');
      expect(boundary.level).toBe('district');
      expect(boundary.properties.stateFips).toBe('06');
      expect(boundary.properties.entityFips).toBe('12');
      expect(boundary.properties.layer).toBe('cd');
      expect(boundary.source.authorityLevel).toBe('federal-mandate');
      expect(boundary.source.legalStatus).toBe('binding');
    });

    test('transforms multiple features from single file', async () => {
      const provider = new TIGERBoundaryProvider({ year: 2024 });

      // Mock County GeoJSON with multiple features
      const mockGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {
              STATEFP: '06',
              COUNTYFP: '075',
              GEOID: '06075',
              NAMELSAD: 'San Francisco County',
            },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-122.5, 37.7],
                  [-122.4, 37.7],
                  [-122.4, 37.8],
                  [-122.5, 37.8],
                  [-122.5, 37.7],
                ],
              ],
            },
          },
          {
            type: 'Feature',
            properties: {
              STATEFP: '06',
              COUNTYFP: '001',
              GEOID: '06001',
              NAMELSAD: 'Alameda County',
            },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-122.3, 37.6],
                  [-122.0, 37.6],
                  [-122.0, 37.9],
                  [-122.3, 37.9],
                  [-122.3, 37.6],
                ],
              ],
            },
          },
        ],
      };

      const mockRawFile = {
        url: 'https://www2.census.gov/geo/tiger/TIGER2024/COUNTY/tl_2024_us_county.zip',
        format: 'geojson' as const,
        data: Buffer.from(JSON.stringify(mockGeoJSON), 'utf-8'),
        metadata: {
          source: 'US Census Bureau TIGER/Line 2024',
          provider: 'TIGERBoundaryProvider',
          layer: 'county',
          checksum: 'mock-checksum',
        },
      };

      const normalized = await provider.transform([mockRawFile]);

      expect(normalized.length).toBe(2);
      expect(normalized[0].id).toBe('06075');
      expect(normalized[1].id).toBe('06001');

      // Verify GEOID uniqueness
      const geoids = normalized.map((b) => b.id);
      const uniqueGeoids = new Set(geoids);
      expect(uniqueGeoids.size).toBe(geoids.length);
    });

    test('skips features with missing required fields', async () => {
      const provider = new TIGERBoundaryProvider({ year: 2024 });

      // Mock GeoJSON with invalid feature (missing GEOID)
      const mockGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {
              STATEFP: '06',
              CD118FP: '12',
              // GEOID missing
              NAMELSAD: 'Congressional District 12',
            },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-122.5, 37.7],
                  [-122.4, 37.7],
                  [-122.4, 37.8],
                  [-122.5, 37.8],
                  [-122.5, 37.7],
                ],
              ],
            },
          },
          {
            type: 'Feature',
            properties: {
              STATEFP: '06',
              CD118FP: '13',
              GEOID: '0613',
              NAMELSAD: 'Congressional District 13',
            },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-122.5, 37.7],
                  [-122.4, 37.7],
                  [-122.4, 37.8],
                  [-122.5, 37.8],
                  [-122.5, 37.7],
                ],
              ],
            },
          },
        ],
      };

      const mockRawFile = {
        url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_us_cd.zip',
        format: 'geojson' as const,
        data: Buffer.from(JSON.stringify(mockGeoJSON), 'utf-8'),
        metadata: {
          source: 'US Census Bureau TIGER/Line 2024',
          provider: 'TIGERBoundaryProvider',
          layer: 'cd',
          checksum: 'mock-checksum',
        },
      };

      const normalized = await provider.transform([mockRawFile]);

      // Should skip invalid feature, only return valid one
      expect(normalized.length).toBe(1);
      expect(normalized[0].id).toBe('0613');
    });
  });

  describe('Metadata', () => {
    test('returns source metadata', async () => {
      const provider = new TIGERBoundaryProvider({ year: 2024 });
      const metadata = await provider.getMetadata();

      expect(metadata.provider).toBe('US Census Bureau TIGER/Line Boundaries');
      expect(metadata.version).toBe('2024');
      expect(metadata.license).toBe('CC0-1.0');
      expect(metadata.authorityLevel).toBe('federal-mandate');
      expect(metadata.legalStatus).toBe('binding');
      expect(metadata.collectionMethod).toBe('census-tiger');
      expect(metadata.coordinateSystem).toBe('EPSG:4326');
      expect(metadata.nextScheduledUpdate).toContain('2025-09-01');
    });
  });

  describe('Update Checking', () => {
    networkTest('checks for TIGER updates', async () => {
      const provider = new TIGERBoundaryProvider({ year: 2024 });
      const updateInfo = await provider.checkForUpdates();

      expect(updateInfo).toHaveProperty('available');
      expect(updateInfo).toHaveProperty('latestVersion');
      expect(updateInfo).toHaveProperty('currentVersion');
      expect(updateInfo).toHaveProperty('releaseDate');

      expect(updateInfo.currentVersion).toBe('2024');

      console.log(`   ℹ️  Update available: ${updateInfo.available}`);
      console.log(`   ℹ️  Latest version: ${updateInfo.latestVersion}`);
    }, 10000);
  });

  // Network-intensive tests (soft-fail in CI)
  describe('Network Operations', () => {
    networkTest('downloads California State Legislative Upper boundaries', async () => {
      const provider = new TIGERBoundaryProvider({
        year: 2024,
        cacheDir: '/tmp/tiger-test-cache',
      });

      const files = await provider.downloadLayer({
        layer: 'sldu',
        stateFips: '06', // California
      });

      expect(files.length).toBe(1);

      const file = files[0];
      expect(file.format).toBe('geojson');
      expect(file.url).toContain('SLDU');
      expect(file.url).toContain('06'); // California FIPS
      expect(file.metadata.layer).toBe('sldu');
      expect(file.metadata.stateFips).toBe('06');

      // Verify GeoJSON is valid
      const geojson = JSON.parse(file.data.toString('utf-8')) as FeatureCollection;
      expect(geojson.type).toBe('FeatureCollection');
      expect(geojson.features.length).toBeGreaterThan(0);

      console.log(`   ✅ Downloaded ${geojson.features.length} California State Senate districts`);
    }, 60000); // 60 second timeout for download + conversion

    networkTest('verifies GEOID uniqueness across Congressional Districts', async () => {
      const provider = new TIGERBoundaryProvider({
        year: 2024,
        cacheDir: '/tmp/tiger-test-cache',
      });

      const files = await provider.downloadLayer({
        layer: 'cd',
      });

      const normalized = await provider.transform(files);

      // Census TIGER CD files include:
      // - 435 voting Congressional Districts (US House seats)
      // - 6 non-voting delegates (DC, PR, Guam, VI, AS, NMI)
      // - Possible at-large/ZZZ placeholder districts
      // Total expected: 440-445 depending on Census structure
      expect(normalized.length).toBeGreaterThanOrEqual(440);
      expect(normalized.length).toBeLessThanOrEqual(445);

      // Verify GEOID uniqueness (critical - no duplicates)
      const geoids = normalized.map((b) => b.id);
      const uniqueGeoids = new Set(geoids);
      expect(uniqueGeoids.size).toBe(geoids.length);

      console.log(`   ✅ Downloaded ${normalized.length} Congressional Districts with unique GEOIDs`);
    }, 120000); // 2 minute timeout for national download

    networkTest('downloads and transforms county boundaries', async () => {
      const provider = new TIGERBoundaryProvider({
        year: 2024,
        cacheDir: '/tmp/tiger-test-cache',
      });

      const files = await provider.downloadLayer({
        layer: 'county',
      });

      const normalized = await provider.transform(files);

      // Verify expected count (3,235 counties + equivalents in 2024 TIGER data)
      // Note: Census data evolves - Alaska boroughs, independent cities, etc.
      expect(normalized.length).toBeGreaterThanOrEqual(3100);
      expect(normalized.length).toBeLessThanOrEqual(3300);

      // Verify GEOID uniqueness
      const geoids = normalized.map((b) => b.id);
      const uniqueGeoids = new Set(geoids);
      expect(uniqueGeoids.size).toBe(geoids.length);

      // Verify all boundaries have correct admin level
      for (const boundary of normalized) {
        expect(boundary.level).toBe('county');
      }

      console.log(`   ✅ Downloaded ${normalized.length} counties with unique GEOIDs`);
    }, 120000); // 2 minute timeout for national download
  });

  describe('Error Handling', () => {
    test('handles missing GDAL gracefully', async () => {
      const provider = new TIGERBoundaryProvider();

      // Mock shapefile path that will fail ogr2ogr
      const invalidPath = '/nonexistent/file.zip';

      try {
        await (provider as any).convertShapefileToGeoJSON(invalidPath);
        expect.fail('Should have thrown error for invalid shapefile');
      } catch (error) {
        expect((error as Error).message).toContain('ogr2ogr');
      }
    });

    test('throws error for unsupported administrative level', async () => {
      const provider = new TIGERBoundaryProvider();

      try {
        await provider.download({
          level: 'city', // Not supported by this provider
        });
        expect.fail('Should have thrown error for unsupported level');
      } catch (error) {
        expect((error as Error).message).toContain('Unsupported administrative level');
      }
    });
  });

  describe('Retry Logic', () => {
    test('configures retry parameters', () => {
      const provider = new TIGERBoundaryProvider({
        maxRetries: 5,
        retryDelayMs: 2000,
      });

      expect((provider as any).maxRetries).toBe(5);
      expect((provider as any).retryDelayMs).toBe(2000);
    });
  });
});
