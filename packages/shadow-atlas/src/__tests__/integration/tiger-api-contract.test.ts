/**
 * TIGERweb API Contract Integration Tests
 *
 * SCOPE: Validate TIGERweb REST API responses match expected structure
 * RUNTIME: ~2-3 minutes (validates 3 representative states)
 * SCHEDULE: PR checks + nightly
 *
 * MISSION: Ensure TIGERweb API contract remains stable and returns
 * correct district counts for representative states.
 *
 * VALIDATION APPROACH:
 * 1. Query TIGERweb REST API for congressional districts
 * 2. Verify feature count matches official counts
 * 3. Validate response structure (GeoJSON format)
 * 4. Check GEOID format and properties
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { describe, it, expect } from 'vitest';
import type { FeatureCollection } from 'geojson';
import { isCI, runIntegration, delay, API_RATE_LIMIT_MS, retryWithBackoff } from '../setup.js';

// ============================================================================
// Skip Control
// ============================================================================

// Skip in CI unless integration tests enabled
const skipInCI = isCI && !runIntegration;

// ============================================================================
// Types
// ============================================================================

interface StateTestConfig {
  readonly state: string;
  readonly stateName: string;
  readonly stateFips: string;
  readonly expectedCongressional: number;
  readonly reason: string;
}

// ============================================================================
// Test Configuration
// ============================================================================

/**
 * Representative states for API contract validation
 * - Small state (WI): Fast test, 8 districts
 * - Medium state (FL): 28 districts
 * - Large state (CA): 52 districts (most complex)
 */
const TEST_STATES: readonly StateTestConfig[] = [
  {
    state: 'WI',
    stateName: 'Wisconsin',
    stateFips: '55',
    expectedCongressional: 8,
    reason: 'Small state - fast validation',
  },
  {
    state: 'FL',
    stateName: 'Florida',
    stateFips: '12',
    expectedCongressional: 28,
    reason: 'Medium state - moderate complexity',
  },
  {
    state: 'CA',
    stateName: 'California',
    stateFips: '06',
    expectedCongressional: 52,
    reason: 'Largest state - maximum complexity',
  },
] as const;

// ============================================================================
// API Client
// ============================================================================

const TIGERWEB_CONGRESSIONAL_ENDPOINT =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0';

/**
 * Fetch congressional districts from TIGERweb API
 */
async function fetchCongressionalDistricts(stateFips: string): Promise<FeatureCollection> {
  const url =
    `${TIGERWEB_CONGRESSIONAL_ENDPOINT}/query` +
    `?where=STATE='${stateFips}'&outFields=*&f=geojson`;

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as FeatureCollection;

  if (!data.features || !Array.isArray(data.features)) {
    throw new Error('Invalid GeoJSON: missing features array');
  }

  return data;
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate GEOID format (SSFFF pattern)
 * - SS: State FIPS (2 digits)
 * - FFF: District number (2-3 digits)
 */
function isValidGeoidFormat(geoid: string, stateFips: string): boolean {
  if (!geoid || typeof geoid !== 'string') return false;
  if (!geoid.startsWith(stateFips)) return false;
  if (geoid.length < 4 || geoid.length > 5) return false;
  if (!/^\d+$/.test(geoid)) return false;
  return true;
}

/**
 * Validate required properties exist
 */
function hasRequiredProperties(properties: Record<string, unknown> | null): boolean {
  if (!properties) return false;

  const required = ['GEOID', 'STATEFP', 'CD118FP', 'NAMELSAD'];
  return required.every((prop) => prop in properties);
}

// ============================================================================
// Integration Tests
// ============================================================================

describe.skipIf(skipInCI)('TIGERweb API Contract', () => {
  for (const config of TEST_STATES) {
    describe(`${config.stateName} (${config.state})`, () => {
      it(
        `returns exactly ${config.expectedCongressional} congressional districts`,
        async () => {
          const geojson = await retryWithBackoff(() => fetchCongressionalDistricts(config.stateFips));

          // Filter out "ZZ" districts (at-large placeholders)
          const validFeatures = geojson.features.filter((f) => {
            const geoid = String(f.properties?.GEOID ?? '');
            return !geoid.endsWith('ZZ');
          });

          expect(validFeatures.length).toBe(config.expectedCongressional);

          // Rate limit
          await delay(API_RATE_LIMIT_MS);
        },
        30_000
      );

      it('returns valid GeoJSON structure', async () => {
        const geojson = await retryWithBackoff(() => fetchCongressionalDistricts(config.stateFips));

        // Verify GeoJSON structure
        expect(geojson.type).toBe('FeatureCollection');
        expect(Array.isArray(geojson.features)).toBe(true);
        expect(geojson.features.length).toBeGreaterThan(0);

        // Verify all features have valid structure
        for (const feature of geojson.features) {
          expect(feature.type).toBe('Feature');
          expect(feature.geometry).toBeDefined();
          expect(['Polygon', 'MultiPolygon']).toContain(feature.geometry.type);
          expect(feature.properties).toBeDefined();
        }

        // Rate limit
        await delay(API_RATE_LIMIT_MS);
      }, 30_000);

      it('returns properly formatted GEOIDs', async () => {
        const geojson = await retryWithBackoff(() => fetchCongressionalDistricts(config.stateFips));

        // Verify all GEOIDs are valid
        const invalidGeoids: string[] = [];

        for (const feature of geojson.features) {
          const geoid = String(feature.properties?.GEOID ?? '');

          if (!isValidGeoidFormat(geoid, config.stateFips)) {
            invalidGeoids.push(geoid);
          }
        }

        if (invalidGeoids.length > 0) {
          console.warn(`Invalid GEOIDs found in ${config.state}:`, invalidGeoids);
        }

        expect(invalidGeoids.length).toBe(0);

        // Rate limit
        await delay(API_RATE_LIMIT_MS);
      }, 30_000);

      it('returns required properties for all features', async () => {
        const geojson = await retryWithBackoff(() => fetchCongressionalDistricts(config.stateFips));

        // Verify all features have required properties
        const missingProperties: number[] = [];

        for (let i = 0; i < geojson.features.length; i++) {
          const feature = geojson.features[i];
          const properties = feature.properties as Record<string, unknown> | null;

          if (!hasRequiredProperties(properties)) {
            missingProperties.push(i);
          }
        }

        if (missingProperties.length > 0) {
          console.warn(
            `Features missing required properties in ${config.state}:`,
            missingProperties
          );
        }

        expect(missingProperties.length).toBe(0);

        // Rate limit
        await delay(API_RATE_LIMIT_MS);
      }, 30_000);

      it('returns districts with correct state FIPS code', async () => {
        const geojson = await retryWithBackoff(() => fetchCongressionalDistricts(config.stateFips));

        // Verify all features have correct state FIPS
        for (const feature of geojson.features) {
          const statefp = String(feature.properties?.STATEFP ?? '');
          expect(statefp).toBe(config.stateFips);
        }

        // Rate limit
        await delay(API_RATE_LIMIT_MS);
      }, 30_000);
    });
  }

  describe('Error Handling', () => {
    it('handles invalid state FIPS gracefully', async () => {
      const geojson = await retryWithBackoff(() => fetchCongressionalDistricts('99')); // Invalid FIPS

      // Should return empty features array, not error
      expect(geojson.features.length).toBe(0);
    }, 30_000);

    it('handles rate limiting with retry', async () => {
      // Make multiple rapid requests to potentially trigger rate limiting
      const promises = Array.from({ length: 3 }, () =>
        retryWithBackoff(() => fetchCongressionalDistricts('55'))
      );

      const results = await Promise.all(promises);

      // All requests should eventually succeed
      for (const result of results) {
        expect(result.features.length).toBeGreaterThan(0);
      }

      // Rate limit after burst
      await delay(API_RATE_LIMIT_MS * 2);
    }, 60_000);
  });
});
