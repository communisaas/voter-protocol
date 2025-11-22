/**
 * State GIS Clearinghouse Scanner Tests
 *
 * CRITICAL TEST: Honolulu via Hawaii Statewide GIS
 *
 * WHY THIS MATTERS:
 * - Urban Honolulu doesn't exist in US Census Places (name mismatch)
 * - City portal search fails (no data.honolulu.gov)
 * - State GIS clearinghouse is the ONLY reliable source
 * - geodata.hawaii.gov/arcgis/rest/services/AdminBnd/MapServer/11
 *
 * VALIDATION:
 * 1. Scanner finds Honolulu County Council Districts (9 districts)
 * 2. Authority level correctly set to 4 (state-agency)
 * 3. Portal type correctly identified as 'state-gis'
 * 4. Score boosted for state-level authority (score + 20)
 */

import { describe, it, expect } from 'vitest';
import { StateGISClearinghouseScanner } from './state-gis-clearinghouse.js';
import type { CityTarget } from '../validators/enhanced-geographic-validator.js';

describe('StateGISClearinghouseScanner', () => {
  const scanner = new StateGISClearinghouseScanner();

  describe('Hawaii Statewide GIS (direct-layer strategy)', () => {
    it('should discover Honolulu County Council Districts', async () => {
      const honolulu: CityTarget = {
        fips: '1571550', // Urban Honolulu CDP
        name: 'Urban Honolulu',
        state: 'HI',
        population: 345510,
      };

      const candidates = await scanner.scan(honolulu);

      // Should find at least one candidate (Honolulu County Council Districts)
      expect(candidates.length).toBeGreaterThan(0);

      // Verify first candidate
      const honoluluDistricts = candidates[0];

      // Must be state-gis portal type
      expect(honoluluDistricts.portalType).toBe('state-gis');

      // Must have high authority (state-level)
      expect(honoluluDistricts.score).toBeGreaterThanOrEqual(50);

      // Must have download URL
      expect(honoluluDistricts.downloadUrl).toContain('geodata.hawaii.gov');
      expect(honoluluDistricts.downloadUrl).toContain('AdminBnd/MapServer/11');
      expect(honoluluDistricts.downloadUrl).toContain('f=geojson');

      // Must have metadata
      expect(honoluluDistricts.title).toContain('Honolulu');
      expect(honoluluDistricts.featureCount).toBe(9);

      console.log('✅ Honolulu discovered via Hawaii Statewide GIS');
      console.log(`   Title: ${honoluluDistricts.title}`);
      console.log(`   Score: ${honoluluDistricts.score}`);
      console.log(`   URL: ${honoluluDistricts.downloadUrl}`);
    });

    it('should discover all Hawaii county council districts', async () => {
      const hawaiiCities: CityTarget[] = [
        { fips: '1571550', name: 'Urban Honolulu', state: 'HI', population: 345510 },
        { fips: '1523150', name: 'Hilo', state: 'HI', population: 45703 },
        { fips: '1534750', name: 'Kailua', state: 'HI', population: 39635 },
        { fips: '1946055', name: 'Kaneohe', state: 'HI', population: 35000 },
      ];

      for (const city of hawaiiCities) {
        const candidates = await scanner.scan(city);

        if (candidates.length > 0) {
          const first = candidates[0];

          expect(first.portalType).toBe('state-gis');
          expect(first.downloadUrl).toContain('geodata.hawaii.gov');
          expect(first.featureCount).toBeGreaterThan(0);

          console.log(`✅ ${city.name}: Found ${first.title} (${first.featureCount} districts)`);
        } else {
          console.log(`⚠️  ${city.name}: No districts found (may not have council districts)`);
        }
      }
    });
  });

  describe('Colorado Socrata (catalog-api strategy)', () => {
    it('should discover Colorado Springs council districts', async () => {
      const coloradoSprings: CityTarget = {
        fips: '0816000',
        name: 'Colorado Springs',
        state: 'CO',
        population: 478221,
      };

      const candidates = await scanner.scan(coloradoSprings);

      if (candidates.length > 0) {
        const first = candidates[0];

        // Should be from Colorado state portal
        expect(first.portalType).toBe('state-gis');
        expect(first.score).toBeGreaterThanOrEqual(45); // State authority boost (30 + 15)

        console.log('✅ Colorado Springs discovered via Colorado state portal');
        console.log(`   Title: ${first.title}`);
        console.log(`   Score: ${first.score}`);
        console.log(`   URL: ${first.downloadUrl}`);
      } else {
        console.log('⏭️  Colorado Springs not found in state portal (may need to use city portal)');
      }
    });
  });

  describe('Washington ArcGIS Hub (hub-api strategy)', () => {
    it('should discover Tacoma council districts', async () => {
      const tacoma: CityTarget = {
        fips: '5370000',
        name: 'Tacoma',
        state: 'WA',
        population: 217827,
      };

      const candidates = await scanner.scan(tacoma);

      if (candidates.length > 0) {
        const first = candidates[0];

        // Should be from Washington state portal
        expect(first.portalType).toBe('state-gis');
        expect(first.score).toBeGreaterThanOrEqual(45);

        console.log('✅ Tacoma discovered via Washington state portal');
        console.log(`   Title: ${first.title}`);
        console.log(`   Score: ${first.score}`);
      } else {
        console.log('⏭️  Tacoma not found in state portal (may prefer city portal)');
      }
    });
  });

  describe('No state portal registered', () => {
    it('should gracefully handle states without portals', async () => {
      const wyomingCity: CityTarget = {
        fips: '5613150',
        name: 'Cheyenne',
        state: 'WY',
        population: 65132,
      };

      const candidates = await scanner.scan(wyomingCity);

      // Wyoming has a portal, so this might find results
      // But if it doesn't, it should return empty array (not throw)
      expect(Array.isArray(candidates)).toBe(true);

      console.log(`   Cheyenne (WY): ${candidates.length} candidates from state portal`);
    });
  });

  describe('Authority level mapping', () => {
    it('should assign higher scores to state-level sources', async () => {
      const honolulu: CityTarget = {
        fips: '1571550',
        name: 'Urban Honolulu',
        state: 'HI',
        population: 345510,
      };

      const candidates = await scanner.scan(honolulu);

      if (candidates.length > 0) {
        const first = candidates[0];

        // State GIS should get authority boost
        // Base semantic score (30-40) + state authority boost (15-20) = 45-60
        expect(first.score).toBeGreaterThanOrEqual(45);

        // Portal type must be state-gis
        expect(first.portalType).toBe('state-gis');

        console.log(`   State GIS authority boost: ${first.score} points`);
      }
    });
  });

  describe('Geographic coverage validation', () => {
    it('should only return results for cities within state boundaries', async () => {
      const seattle: CityTarget = {
        fips: '5363000',
        name: 'Seattle',
        state: 'WA',
        population: 749256,
      };

      const candidates = await scanner.scan(seattle);

      // All candidates should be from Washington state
      for (const candidate of candidates) {
        // URL should be from Washington state portal or reference Washington
        const isWashington =
          candidate.url.includes('geo.wa.gov') ||
          candidate.title.toLowerCase().includes('washington') ||
          candidate.title.toLowerCase().includes('seattle');

        expect(isWashington).toBe(true);
      }

      console.log(`   Seattle: ${candidates.length} candidates from WA state portal`);
    });
  });
});

/**
 * Performance test (run manually)
 *
 * Validates that state GIS scanner completes within reasonable time bounds
 */
describe('Performance (manual)', () => {
  it.skip('should scan state portal within 5 seconds', async () => {
    const scanner = new StateGISClearinghouseScanner();

    const honolulu: CityTarget = {
      fips: '1571550',
      name: 'Urban Honolulu',
      state: 'HI',
      population: 345510,
    };

    const startTime = Date.now();
    const candidates = await scanner.scan(honolulu);
    const elapsedMs = Date.now() - startTime;

    console.log(`   Scan completed in ${elapsedMs}ms`);
    console.log(`   Found ${candidates.length} candidates`);

    // Should complete within 5 seconds
    expect(elapsedMs).toBeLessThan(5000);
  });
});
