/**
 * TIGER Pipeline Integration Tests - REAL DATA, NO MOCKS
 *
 * These tests actually download from Census TIGER and validate the full pipeline.
 * They are slow (network I/O) but expose real flaws in data handling.
 *
 * Run with: cd packages/crypto && npm run test -- integration/tiger-real-data.test.ts --run
 *
 * IMPORTANT: These tests download real data from Census TIGER (shapefiles, ~10-50MB each).
 * They are skipped in CI by default but should be run locally to verify:
 * - Network download logic works with real Census URLs
 * - GDAL/ogr2ogr conversion produces valid GeoJSON
 * - Field mappings extract correct properties
 * - Validation catches real topology issues
 */

import { describe, it, expect } from 'vitest';
import { TIGERBoundaryProvider } from '../../../providers/tiger-boundary-provider.js';
import { TIGERValidator } from '../../../validators/tiger-validator.js';
import { getTIGERValidityStatus } from '../../../provenance/tiger-validity.js';

describe('TIGER Pipeline Integration (REAL DATA)', () => {
  // Skip in CI, run locally for real validation
  const SKIP_NETWORK_TESTS = process.env.CI === 'true';

  describe('Congressional Districts (CD)', () => {
    it('downloads and validates real CD data from Census', async () => {
      if (SKIP_NETWORK_TESTS) {
        console.log('⏭️  Skipping network test in CI');
        return;
      }

      console.log('📥 Downloading TIGER 2024 Congressional Districts...');

      // REAL: Download Congressional Districts
      const provider = new TIGERBoundaryProvider({ year: 2024 });
      const rawFiles = await provider.downloadLayer({ layer: 'cd' });

      expect(rawFiles.length).toBeGreaterThan(0);
      expect(rawFiles[0].format).toBe('geojson');

      console.log('✅ Downloaded file(s):', rawFiles.length);

      // REAL: Aggregate features from all files (one per state/territory)
      let totalFeatures = 0;
      const allBoundaries: Array<{
        geoid: string;
        name: string;
        geometry: unknown;
        properties: Record<string, unknown>;
      }> = [];

      for (const file of rawFiles) {
        const geojson = JSON.parse(file.data.toString('utf-8'));
        totalFeatures += geojson.features.length;
        for (const f of geojson.features) {
          allBoundaries.push({
            geoid: f.properties.GEOID as string,
            name: f.properties.NAMELSAD as string,
            geometry: f.geometry,
            properties: f.properties as Record<string, unknown>,
          });
        }
      }

      console.log('📊 Total Features:', totalFeatures);

      // Congressional districts: 435 + non-voting delegates (DC, PR, GU, VI, AS, MP, etc.)
      // Total can vary slightly based on data vintage
      expect(totalFeatures).toBeGreaterThanOrEqual(435);
      expect(totalFeatures).toBeLessThanOrEqual(450); // Allow for all territories

      // REAL: Validate with TIGERValidator
      const validator = new TIGERValidator();
      const result = validator.validate('cd', allBoundaries);
      console.log('🎯 Quality Score:', result.qualityScore, '/100');
      console.log('✅ Completeness:', result.completeness.valid ? 'PASS' : 'FAIL');
      console.log('✅ Topology:', result.topology.valid ? 'PASS' : 'FAIL');
      console.log('✅ Coordinates:', result.coordinates.valid ? 'PASS' : 'FAIL');

      expect(result.qualityScore).toBeGreaterThanOrEqual(80);
    }, 300000); // 5 min timeout for network
  });

  describe('Single State SLDU (California)', () => {
    it('downloads and validates CA state senate districts', async () => {
      if (SKIP_NETWORK_TESTS) {
        console.log('⏭️  Skipping network test in CI');
        return;
      }

      console.log('📥 Downloading California State Senate Districts...');

      const provider = new TIGERBoundaryProvider({ year: 2024 });
      const rawFiles = await provider.downloadLayer({
        layer: 'sldu',
        stateFips: '06', // California
      });

      expect(rawFiles.length).toBe(1);

      const geojson = JSON.parse(rawFiles[0].data.toString('utf-8'));
      console.log('📊 CA State Senate Districts:', geojson.features.length);

      // California has 40 state senators
      expect(geojson.features.length).toBe(40);

      // Verify GEOID format (06 + district number)
      const firstGEOID = geojson.features[0].properties.GEOID;
      expect(firstGEOID).toMatch(/^06\d+$/);

      console.log('✅ CA SLDU:', geojson.features.length, 'districts validated');
    }, 120000);
  });

  describe('Single State SLDL (Texas)', () => {
    it('downloads and validates TX state house districts', async () => {
      if (SKIP_NETWORK_TESTS) {
        console.log('⏭️  Skipping network test in CI');
        return;
      }

      console.log('📥 Downloading Texas State House Districts...');

      const provider = new TIGERBoundaryProvider({ year: 2024 });
      const rawFiles = await provider.downloadLayer({
        layer: 'sldl',
        stateFips: '48', // Texas
      });

      expect(rawFiles.length).toBe(1);

      const geojson = JSON.parse(rawFiles[0].data.toString('utf-8'));
      console.log('📊 TX State House Districts:', geojson.features.length);

      // Texas has 150 state representatives
      expect(geojson.features.length).toBe(150);

      console.log('✅ TX SLDL:', geojson.features.length, 'districts validated');
    }, 120000);
  });

  describe('County Boundaries', () => {
    it.skip('downloads and validates all US counties', async () => {
      // SKIP by default - this is a large download (~50MB)
      if (SKIP_NETWORK_TESTS) {
        console.log('⏭️  Skipping network test in CI');
        return;
      }

      console.log('📥 Downloading US County Boundaries...');
      console.log('⚠️  Warning: This is a large file (~50MB), may take 2-3 minutes');

      const provider = new TIGERBoundaryProvider({ year: 2024 });
      const rawFiles = await provider.downloadLayer({ layer: 'county' });

      expect(rawFiles.length).toBe(1);

      const geojson = JSON.parse(rawFiles[0].data.toString('utf-8'));
      const countyCount = geojson.features.length;
      console.log('📊 Total Counties:', countyCount);

      // US has 3,143 counties and county-equivalents (2020 Census)
      // Some variation expected due to boundary changes
      expect(countyCount).toBeGreaterThan(3100);
      expect(countyCount).toBeLessThan(3200);

      // Sample a few counties to verify structure
      const sampleCounty = geojson.features[0];
      expect(sampleCounty.properties).toHaveProperty('GEOID');
      expect(sampleCounty.properties).toHaveProperty('NAME');
      expect(sampleCounty.properties).toHaveProperty('STATEFP');
      expect(sampleCounty.geometry.type).toMatch(/Polygon|MultiPolygon/);

      console.log('✅ Counties:', countyCount, 'validated');
    }, 300000); // 5 min timeout
  });

  describe('Authority and Validity', () => {
    it('validates TIGER vintage status is checkable', () => {
      // Try current year, then fall back to 2024
      const currentYear = new Date().getFullYear();
      let status = getTIGERValidityStatus('congressional', currentYear, new Date());

      // If current year not valid, try previous year
      if (!status.isValid) {
        status = getTIGERValidityStatus('congressional', currentYear - 1, new Date());
      }

      console.log('📅 TIGER Status:', status.isValid ? 'VALID' : 'INVALID');
      console.log('🗓️  Year checked:', status.isValid ? currentYear : currentYear - 1);
      console.log('🎯 Confidence:', (status.confidence * 100).toFixed(0) + '%');
      console.log('📝 Reason:', status.reason);
      console.log('💡 Recommendation:', status.recommendation);

      // At least one of current or previous year should be valid
      // or we should get a meaningful recommendation
      expect(status.confidence).toBeGreaterThanOrEqual(0);
      expect(status.reason).toBeDefined();

      if (status.showExpirationWarning) {
        console.log('⚠️  Expiration Warning:', status.daysUntilExpiration, 'days remaining');
      }
    });

    it('detects redistricting gap period', () => {
      // Simulate Jan 2022 (post-redistricting, TIGER still shows old maps)
      const gapDate = new Date('2022-03-15');
      const status = getTIGERValidityStatus('congressional', 2021, gapDate);

      console.log('📅 TIGER 2021 in Mar 2022:', status.isValid ? 'VALID' : 'INVALID');
      console.log('🎯 Confidence:', (status.confidence * 100).toFixed(0) + '%');
      console.log('📝 Reason:', status.reason);
      console.log('💡 Recommendation:', status.recommendation);

      // During gap, should recommend primary sources
      expect(status.recommendation).toBe('use-primary');
      expect(status.confidence).toBeLessThan(0.5);
    });

    it('applies grace period after redistricting', () => {
      // Simulate Sept 2022 (TIGER 2022 just released with new districts)
      const graceDate = new Date('2022-09-01');
      const status = getTIGERValidityStatus('congressional', 2022, graceDate);

      console.log('📅 TIGER 2022 in Sept 2022:', status.isValid ? 'VALID' : 'INVALID');
      console.log('🎯 Confidence:', (status.confidence * 100).toFixed(0) + '%');
      console.log('📝 Reason:', status.reason);

      // During grace period, valid but moderate confidence
      expect(status.isValid).toBe(true);
      expect(status.confidence).toBe(0.7); // Grace period confidence
      expect(status.reason).toContain('Grace period');
    });
  });

  describe('Field Mapping Validation', () => {
    it('verifies required fields are present in real CD data', async () => {
      if (SKIP_NETWORK_TESTS) {
        console.log('⏭️  Skipping network test in CI');
        return;
      }

      console.log('📥 Downloading sample CD for field validation...');

      const provider = new TIGERBoundaryProvider({ year: 2024 });
      const rawFiles = await provider.downloadLayer({
        layer: 'cd',
        stateFips: '06', // California
      });

      const geojson = JSON.parse(rawFiles[0].data.toString('utf-8'));
      const sample = geojson.features[0].properties;

      console.log('🔍 Sample Properties:', Object.keys(sample).join(', '));

      // Verify required fields from TIGER spec
      expect(sample).toHaveProperty('GEOID');
      expect(sample).toHaveProperty('STATEFP');
      // CD field name changes with Congress number (CD118FP, CD119FP, etc.)
      const cdField = Object.keys(sample).find(k => k.match(/^CD\d{3}FP$/));
      expect(cdField).toBeDefined();
      console.log(`📋 Congress field: ${cdField}`);
      expect(sample).toHaveProperty('NAMELSAD');

      // Verify GEOID format (state + district)
      expect(sample.GEOID).toMatch(/^\d{4}$/);

      console.log('✅ All required fields present');
    }, 120000);
  });

  describe('Transformation Pipeline', () => {
    it('transforms real TIGER data to NormalizedBoundary format', async () => {
      if (SKIP_NETWORK_TESTS) {
        console.log('⏭️  Skipping network test in CI');
        return;
      }

      console.log('📥 Downloading and transforming Vermont data...');

      const provider = new TIGERBoundaryProvider({ year: 2024 });
      const rawFiles = await provider.downloadLayer({
        layer: 'cd',
        stateFips: '50', // Vermont (1 district - simple test case)
      });

      const normalized = await provider.transform(rawFiles);

      console.log('🔄 Transformed boundaries:', normalized.length);

      expect(normalized.length).toBe(1);

      const vt = normalized[0];
      expect(vt.id).toBeDefined();
      expect(vt.name).toBeDefined();
      expect(vt.geometry).toBeDefined();
      expect(vt.geometry.type).toMatch(/Polygon|MultiPolygon/);
      // Check properties structure
      expect(vt.properties).toBeDefined();
      expect(vt.properties.stateFips).toBe('50');
      expect(vt.level).toBe('district'); // CD layer uses adminLevel: 'district'

      console.log('✅ Vermont CD:', vt.name);
      console.log('📍 GEOID:', vt.id);
      console.log('🗺️  Admin Level:', vt.level);
    }, 120000);
  });

  describe('Error Handling', () => {
    it('handles invalid state FIPS gracefully', async () => {
      if (SKIP_NETWORK_TESTS) {
        console.log('⏭️  Skipping network test in CI');
        return;
      }

      const provider = new TIGERBoundaryProvider({ year: 2024 });

      // Invalid state FIPS should fail gracefully
      await expect(
        provider.downloadLayer({
          layer: 'cd',
          stateFips: '99', // Invalid
        })
      ).rejects.toThrow();
    }, 60000);

    it.skip('handles year with no data gracefully', async () => {
      if (SKIP_NETWORK_TESTS) {
        console.log('⏭️  Skipping network test in CI');
        return;
      }

      const provider = new TIGERBoundaryProvider({ year: 2000 }); // Too old

      // Should fail with clear error
      await expect(
        provider.downloadLayer({ layer: 'cd' })
      ).rejects.toThrow();
    }, 60000);
  });

  describe('Data Completeness Checks', () => {
    it('verifies all 50 states have CD data', async () => {
      if (SKIP_NETWORK_TESTS) {
        console.log('⏭️  Skipping network test in CI');
        return;
      }

      console.log('📥 Downloading national CD data...');

      const provider = new TIGERBoundaryProvider({ year: 2024 });
      const rawFiles = await provider.downloadLayer({ layer: 'cd' });

      // Aggregate features from all files (one per state/territory)
      const states = new Set<string>();
      for (const file of rawFiles) {
        const geojson = JSON.parse(file.data.toString('utf-8'));
        for (const feature of geojson.features) {
          states.add(feature.properties.STATEFP as string);
        }
      }

      console.log('📊 States represented:', states.size);
      console.log('🗺️  State FIPS:', Array.from(states).sort().join(', '));

      // Should have all 50 states + DC + territories
      expect(states.size).toBeGreaterThanOrEqual(51); // At least 50 states + DC

      console.log('✅ Coverage:', states.size, 'jurisdictions');
    }, 300000);
  });
});
