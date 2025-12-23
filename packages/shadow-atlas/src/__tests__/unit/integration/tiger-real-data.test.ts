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
import { TIGERBoundaryProvider } from '../providers/tiger-boundary-provider.js';
import { TIGERValidator } from '../validators/tiger-validator.js';
import { getTIGERValidityStatus } from '../provenance/tiger-validity.js';

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

      // REAL: Parse and count features
      const geojson = JSON.parse(rawFiles[0].data.toString('utf-8'));
      console.log('📊 Features:', geojson.features.length);

      // Congressional districts: Exactly 435 required by Public Law 62-5
      expect(geojson.features.length).toBe(435);

      // REAL: Validate with TIGERValidator
      const validator = new TIGERValidator();
      const boundaries = geojson.features.map((f: any) => ({
        geoid: f.properties.GEOID,
        name: f.properties.NAMELSAD,
        geometry: f.geometry,
        properties: f.properties,
      }));

      const result = validator.validate('cd', boundaries);
      console.log('🎯 Quality Score:', result.qualityScore, '/100');
      console.log('✅ Completeness:', result.completeness.valid ? 'PASS' : 'FAIL');
      console.log('✅ Topology:', result.topology.valid ? 'PASS' : 'FAIL');
      console.log('✅ Coordinates:', result.coordinates.valid ? 'PASS' : 'FAIL');

      expect(result.qualityScore).toBeGreaterThanOrEqual(90);
      expect(result.completeness.valid).toBe(true);
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
    it('validates TIGER 2024 is currently valid', () => {
      const status = getTIGERValidityStatus('congressional', 2024, new Date());

      console.log('📅 TIGER 2024 Status:', status.isValid ? 'VALID' : 'INVALID');
      console.log('🎯 Confidence:', (status.confidence * 100).toFixed(0) + '%');
      console.log('📝 Reason:', status.reason);
      console.log('💡 Recommendation:', status.recommendation);

      // TIGER 2024 released July 2024, valid until July 2025
      // This test will fail after July 2025 (expected - update to TIGER 2025)
      expect(status.isValid).toBe(true);
      expect(status.confidence).toBeGreaterThan(0.5);

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
      expect(sample).toHaveProperty('CD118FP'); // 118th Congress
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
      expect(vt.provenance).toBeDefined();
      expect(vt.provenance.provider).toBe('census-tiger');
      expect(vt.provenance.year).toBe(2024);

      console.log('✅ Vermont CD:', vt.name);
      console.log('📍 GEOID:', vt.id);
      console.log('🗓️  Acquired:', vt.provenance.acquiredAt.toISOString());
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

      const geojson = JSON.parse(rawFiles[0].data.toString('utf-8'));

      // Extract unique state FIPS
      const states = new Set<string>();
      for (const feature of geojson.features) {
        states.add(feature.properties.STATEFP);
      }

      console.log('📊 States represented:', states.size);
      console.log('🗺️  State FIPS:', Array.from(states).sort().join(', '));

      // Should have all 50 states + DC (56 total with territories)
      expect(states.size).toBeGreaterThanOrEqual(51); // At least 50 states + DC

      console.log('✅ Coverage:', states.size, 'jurisdictions');
    }, 300000);
  });
});
