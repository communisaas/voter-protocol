/**
 * State GIS Clearinghouse Scanner Tests
 *
 * Unit tests for scanner logic (mocked, no network).
 * Network tests require RUN_NETWORK_TESTS=true.
 *
 * ARCHITECTURE:
 * - State GIS portals aggregate municipal data from multiple sources
 * - Scanner queries state-level ArcGIS/Socrata endpoints
 * - Results scored by semantic matching + authority level
 *
 * TEST STRATEGY:
 * - Unit tests: Mock network, validate scoring/filtering logic
 * - Network tests: Skipped by default, validate real endpoints work
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StateGISClearinghouseScanner } from '../../../acquisition/scanners/state-gis-clearinghouse.js';
import type { CityTarget } from '../../../validators/geographic-validator.js';

/**
 * Network test wrapper - skipped by default unless RUN_NETWORK_TESTS=true
 * These tests require live network access to state GIS portals.
 */
const runNetworkTests = process.env.RUN_NETWORK_TESTS === 'true';

function networkTest(name: string, fn: () => Promise<void>, timeout = 30000) {
  const vitestTimeout = timeout + 5000;

  if (!runNetworkTests) {
    return it.skip(`${name} (requires RUN_NETWORK_TESTS=true)`, async () => {});
  }

  return it(
    name,
    async () => {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Network test timed out after ${timeout}ms`)), timeout);
      });
      await Promise.race([fn(), timeoutPromise]);
    },
    vitestTimeout
  );
}

describe('StateGISClearinghouseScanner', () => {
  describe('Unit Tests (mocked)', () => {
    let scanner: StateGISClearinghouseScanner;

    beforeEach(() => {
      scanner = new StateGISClearinghouseScanner();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return empty array for states without registered portals', async () => {
      // Use a state without a registered portal in the scanner's registry
      const unknownStateCity: CityTarget = {
        fips: '0000000',
        name: 'Unknown City',
        state: 'XX', // Invalid state code
        population: 10000,
      };

      const candidates = await scanner.scan(unknownStateCity);

      // Must return empty array (not throw)
      expect(Array.isArray(candidates)).toBe(true);
      expect(candidates).toHaveLength(0);
    });

    it('should correctly identify portal type as state-gis', async () => {
      // Mock the internal fetch to return a valid response
      const mockResponse = {
        layers: [
          {
            id: 1,
            name: 'City Council Districts',
            geometryType: 'esriGeometryPolygon',
          },
        ],
      };

      // Mock global fetch
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const city: CityTarget = {
        fips: '1571550',
        name: 'Urban Honolulu',
        state: 'HI',
        population: 345510,
      };

      const candidates = await scanner.scan(city);

      // All candidates must have portalType = 'state-gis'
      for (const candidate of candidates) {
        expect(candidate.portalType).toBe('state-gis');
      }

      fetchSpy.mockRestore();
    });

    it('should handle network failures gracefully', async () => {
      // Mock fetch to simulate network failure
      const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      const city: CityTarget = {
        fips: '0816000',
        name: 'Colorado Springs',
        state: 'CO',
        population: 478221,
      };

      // Should not throw, should return empty array
      const candidates = await scanner.scan(city);

      expect(Array.isArray(candidates)).toBe(true);
      // Candidates may be empty due to network failure

      fetchSpy.mockRestore();
    });

    it('should handle malformed API responses gracefully', async () => {
      // Mock fetch to return malformed response
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ unexpected: 'format' }),
      } as Response);

      const city: CityTarget = {
        fips: '5363000',
        name: 'Seattle',
        state: 'WA',
        population: 749256,
      };

      // Should not throw
      const candidates = await scanner.scan(city);

      expect(Array.isArray(candidates)).toBe(true);

      fetchSpy.mockRestore();
    });

    it('should handle HTTP error responses gracefully', async () => {
      // Mock fetch to return 404
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response);

      const city: CityTarget = {
        fips: '5613150',
        name: 'Cheyenne',
        state: 'WY',
        population: 65132,
      };

      // Should not throw
      const candidates = await scanner.scan(city);

      expect(Array.isArray(candidates)).toBe(true);

      fetchSpy.mockRestore();
    });
  });

  describe('Network Tests (live endpoints)', () => {
    const scanner = new StateGISClearinghouseScanner();

    networkTest(
      'should discover Honolulu County Council Districts from Hawaii state portal',
      async () => {
        const honolulu: CityTarget = {
          fips: '1571550',
          name: 'Urban Honolulu',
          state: 'HI',
          population: 345510,
        };

        const candidates = await scanner.scan(honolulu);

        // REAL ASSERTION: Must find candidates
        expect(candidates.length).toBeGreaterThan(0);

        const first = candidates[0];

        // Must be state-gis portal type
        expect(first.portalType).toBe('state-gis');

        // Must have high authority score
        expect(first.score).toBeGreaterThanOrEqual(45);

        // Must have download URL from Hawaii portal
        expect(first.downloadUrl).toContain('geodata.hawaii.gov');
        expect(first.downloadUrl).toContain('f=geojson');
      },
      30000
    );

    networkTest(
      'should discover council districts from Colorado state portal',
      async () => {
        const coloradoSprings: CityTarget = {
          fips: '0816000',
          name: 'Colorado Springs',
          state: 'CO',
          population: 478221,
        };

        const candidates = await scanner.scan(coloradoSprings);

        // REAL ASSERTION: Must find candidates
        expect(candidates.length).toBeGreaterThan(0);

        const first = candidates[0];
        expect(first.portalType).toBe('state-gis');
        expect(first.score).toBeGreaterThanOrEqual(45);
      },
      30000
    );

    networkTest(
      'should discover council districts from Washington state portal',
      async () => {
        const seattle: CityTarget = {
          fips: '5363000',
          name: 'Seattle',
          state: 'WA',
          population: 749256,
        };

        const candidates = await scanner.scan(seattle);

        // REAL ASSERTION: Must find candidates
        expect(candidates.length).toBeGreaterThan(0);

        // All candidates must be from Washington
        for (const candidate of candidates) {
          const isWashington =
            candidate.url.includes('geo.wa.gov') ||
            candidate.title.toLowerCase().includes('washington') ||
            candidate.title.toLowerCase().includes('seattle');

          expect(isWashington).toBe(true);
        }
      },
      30000
    );
  });

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
});
