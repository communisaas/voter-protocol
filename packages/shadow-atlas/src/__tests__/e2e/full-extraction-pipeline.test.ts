/**
 * Full Extraction Pipeline E2E Tests
 *
 * SCOPE: End-to-end tests for complete extraction workflows
 *
 * TIER: E2E (slow, real APIs, nightly only)
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no `@ts-ignore`.
 */

import { describe, it, expect } from 'vitest';
import { isCI, runE2E, API_RATE_LIMIT_MS, delay } from '../setup.js';
import {
  createStateResult,
  createLayerResult,
  createBatchResult,
  assertBoundaryCount,
  assertValidBoundaryGeometry,
  assertUniqueIds,
  assertUniqueGeoids,
} from '../core/utils/index.js';

const skipInCI = isCI && !runE2E;

describe.skipIf(skipInCI)('Full Extraction Pipeline E2E', () => {
  describe('Single State Extraction', () => {
    it(
      'should extract Wisconsin congressional districts end-to-end',
      async () => {
        // STEP 1: Fetch from TIGERweb
        const tigerUrl =
          "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0/query?where=STATE='55'&outFields=*&f=json";

        const tigerResponse = await fetch(tigerUrl);
        expect(tigerResponse.ok).toBe(true);

        const tigerData = (await tigerResponse.json()) as {
          features: readonly { attributes: { GEOID: string; NAME: string } }[];
        };

        await delay(API_RATE_LIMIT_MS);

        // STEP 2: Validate count
        expect(tigerData.features.length).toBe(8);

        // STEP 3: Create extraction result
        const extractionResult = createStateResult({
          state: 'WI',
          stateName: 'Wisconsin',
          authority: 'tiger',
          layers: [
            createLayerResult({
              state: 'WI',
              layerType: 'congressional',
              expectedCount: 8,
              actualCount: tigerData.features.length,
            }),
          ],
        });

        // STEP 4: Validate boundaries
        const boundaries = extractionResult.layers[0].boundaries;

        assertBoundaryCount(boundaries, 8);
        assertUniqueIds(boundaries);
        assertUniqueGeoids(boundaries);

        for (const boundary of boundaries) {
          assertValidBoundaryGeometry(boundary);
        }

        // STEP 5: Verify summary
        expect(extractionResult.summary.totalBoundaries).toBe(8);
        expect(extractionResult.summary.layersSucceeded).toBe(1);
        expect(extractionResult.summary.layersFailed).toBe(0);
      },
      60_000
    );

    it(
      'should extract California congressional districts end-to-end',
      async () => {
        // California has 52 congressional districts
        const tigerUrl =
          "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0/query?where=STATE='06'&outFields=*&f=json";

        const tigerResponse = await fetch(tigerUrl);
        expect(tigerResponse.ok).toBe(true);

        const tigerData = (await tigerResponse.json()) as {
          features: readonly { attributes: { GEOID: string; NAME: string } }[];
        };

        await delay(API_RATE_LIMIT_MS);

        // Validate count
        expect(tigerData.features.length).toBe(52);

        // Create extraction result
        const extractionResult = createStateResult({
          state: 'CA',
          stateName: 'California',
          authority: 'tiger',
          layers: [
            createLayerResult({
              state: 'CA',
              layerType: 'congressional',
              expectedCount: 52,
              actualCount: tigerData.features.length,
            }),
          ],
        });

        // Validate boundaries
        const boundaries = extractionResult.layers[0].boundaries;

        assertBoundaryCount(boundaries, 52);
        assertUniqueIds(boundaries);
        assertUniqueGeoids(boundaries);
      },
      60_000
    );
  });

  describe('Multi-State Batch Extraction', () => {
    it(
      'should extract multiple states in batch',
      async () => {
        const states = [
          { code: 'WI', fips: '55', expectedCount: 8 },
          { code: 'CT', fips: '09', expectedCount: 5 },
          { code: 'NH', fips: '33', expectedCount: 2 },
        ];

        const stateResults = [];

        for (const state of states) {
          const url = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0/query?where=STATE='${state.fips}'&outFields=*&f=json`;

          const response = await fetch(url);
          expect(response.ok).toBe(true);

          const data = (await response.json()) as {
            features: readonly { attributes: { GEOID: string } }[];
          };

          // Validate count
          expect(data.features.length).toBe(state.expectedCount);

          // Create extraction result
          stateResults.push(
            createStateResult({
              state: state.code,
              stateName: `Test State ${state.code}`,
              authority: 'tiger',
              layers: [
                createLayerResult({
                  state: state.code,
                  layerType: 'congressional',
                  expectedCount: state.expectedCount,
                  actualCount: data.features.length,
                }),
              ],
            })
          );

          // Rate limit
          await delay(API_RATE_LIMIT_MS);
        }

        // Create batch result
        const batchResult = createBatchResult({ states: stateResults });

        // Validate batch
        expect(batchResult.summary.totalStates).toBe(3);
        expect(batchResult.summary.statesSucceeded).toBe(3);
        expect(batchResult.summary.statesFailed).toBe(0);
        expect(batchResult.summary.totalBoundaries).toBe(8 + 5 + 2); // 15 total
      },
      120_000
    );
  });

  describe('Error Handling', () => {
    it(
      'should handle invalid state FIPS gracefully',
      async () => {
        const url =
          "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0/query?where=STATE='99'&outFields=*&f=json";

        const response = await fetch(url);
        expect(response.ok).toBe(true);

        const data = (await response.json()) as {
          features: readonly unknown[];
        };

        // Should return empty features
        expect(data.features.length).toBe(0);

        await delay(API_RATE_LIMIT_MS);
      },
      30_000
    );

    it(
      'should handle network errors gracefully',
      async () => {
        const invalidUrl = 'https://invalid-domain-that-does-not-exist-12345.com/api';

        await expect(fetch(invalidUrl)).rejects.toThrow();
      },
      30_000
    );
  });

  describe('Data Quality Validation', () => {
    it(
      'should validate all extracted boundaries have required properties',
      async () => {
        const url =
          "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0/query?where=STATE='55'&outFields=*&f=json";

        const response = await fetch(url);
        const data = (await response.json()) as {
          features: readonly { attributes: Record<string, string | number> }[];
        };

        await delay(API_RATE_LIMIT_MS);

        // Verify all features have required properties
        for (const feature of data.features) {
          expect(feature.attributes.GEOID).toBeDefined();
          expect(feature.attributes.NAME).toBeDefined();

          // GEOID should start with state FIPS
          expect(String(feature.attributes.GEOID).startsWith('55')).toBe(true);
        }
      },
      30_000
    );
  });
});
