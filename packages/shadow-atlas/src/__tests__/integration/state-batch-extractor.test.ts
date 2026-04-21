/**
 * State Batch Extractor Integration Tests
 *
 * SCOPE: Integration tests for state batch extraction with real API calls
 *
 * TIER: Integration (conditional real APIs, skip in CI by default)
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no `@ts-ignore`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { isCI, runIntegration, API_RATE_LIMIT_MS, delay } from '../setup.js';
import {
  createBoundary,
  createLayerResult,
  createStateResult,
  assertValidBoundaryGeometry,
  assertValidGeoidsForState,
  assertUniformAuthority,
} from '../utils/index.js';

const skipInCI = isCI && !runIntegration;

describe.skipIf(skipInCI)('StateBatchExtractor Integration', () => {
  describe('TIGERweb Integration', () => {
    it(
      'should fetch Wisconsin congressional districts from TIGERweb',
      async () => {
        const url =
          "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0/query?where=STATE='55'&outFields=*&f=json";

        const response = await fetch(url);
        expect(response.ok).toBe(true);

        const data = (await response.json()) as {
          features: readonly { attributes: { GEOID: string; NAME: string } }[];
        };

        expect(data.features).toBeDefined();
        expect(data.features.length).toBe(8);

        // Verify GEOIDs
        const geoids = data.features.map((f) => f.attributes.GEOID);
        expect(geoids).toContain('5501');
        expect(geoids).toContain('5508');

        await delay(API_RATE_LIMIT_MS);
      },
      30_000
    );

    it(
      'should fetch Texas congressional districts from TIGERweb',
      async () => {
        const url =
          "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0/query?where=STATE='48'&outFields=*&f=json";

        const response = await fetch(url);
        expect(response.ok).toBe(true);

        const data = (await response.json()) as {
          features: readonly { attributes: { GEOID: string; NAME: string } }[];
        };

        expect(data.features).toBeDefined();
        expect(data.features.length).toBe(38);

        await delay(API_RATE_LIMIT_MS);
      },
      30_000
    );

    it(
      'should handle invalid state gracefully',
      async () => {
        const url =
          "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0/query?where=STATE='99'&outFields=*&f=json";

        const response = await fetch(url);
        expect(response.ok).toBe(true);

        const data = (await response.json()) as {
          features: readonly unknown[];
        };

        // Invalid state should return empty features
        expect(data.features.length).toBe(0);

        await delay(API_RATE_LIMIT_MS);
      },
      30_000
    );
  });

  describe('Cross-Validation', () => {
    it('should validate extracted boundaries against TIGERweb', async () => {
      // Create mock extraction result
      const mockResult = createStateResult({
        state: 'WI',
        stateName: 'Wisconsin',
        authority: 'state-gis',
        layers: [
          createLayerResult({
            state: 'WI',
            layerType: 'congressional',
            expectedCount: 8,
            actualCount: 8,
          }),
        ],
      });

      // Fetch TIGERweb data
      const url =
        "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0/query?where=STATE='55'&outFields=*&f=json";

      const response = await fetch(url);
      const data = (await response.json()) as {
        features: readonly { attributes: { GEOID: string } }[];
      };

      // Compare counts
      expect(mockResult.layers[0].featureCount).toBe(data.features.length);

      // Verify GEOIDs exist in both
      const extractedGeoids = mockResult.layers[0].boundaries.map(
        (b) => b.properties.GEOID
      );
      const tigerGeoids = data.features.map((f) => f.attributes.GEOID);

      for (const geoid of extractedGeoids) {
        expect(tigerGeoids).toContain(geoid);
      }

      await delay(API_RATE_LIMIT_MS);
    }, 30_000);
  });

  describe('Geometry Validation', () => {
    it('should validate all boundary geometries', () => {
      // Create test boundaries
      const boundaries = [
        createBoundary({
          id: '5501',
          name: 'District 1',
          state: 'WI',
          geoid: '5501',
        }),
        createBoundary({
          id: '5502',
          name: 'District 2',
          state: 'WI',
          geoid: '5502',
        }),
      ];

      // Validate each boundary
      for (const boundary of boundaries) {
        expect(() => assertValidBoundaryGeometry(boundary)).not.toThrow();
      }
    });

    it('should validate GEOIDs for state', () => {
      const boundaries = [
        createBoundary({
          id: '5501',
          name: 'District 1',
          state: 'WI',
          geoid: '5501',
        }),
        createBoundary({
          id: '5502',
          name: 'District 2',
          state: 'WI',
          geoid: '5502',
        }),
      ];

      expect(() => assertValidGeoidsForState(boundaries, '55')).not.toThrow();
    });

    it('should validate authority uniformity', () => {
      const boundaries = [
        createBoundary({
          id: '5501',
          name: 'District 1',
          state: 'WI',
          authority: 'state-gis',
        }),
        createBoundary({
          id: '5502',
          name: 'District 2',
          state: 'WI',
          authority: 'state-gis',
        }),
      ];

      expect(() => assertUniformAuthority(boundaries, 'state-gis')).not.toThrow();
    });
  });
});
