/**
 * TIGER Shapefile Ground Truth Integration Tests
 *
 * SCOPE: Validate TIGERweb API against official TIGER/Line shapefile counts
 * RUNTIME: ~1-2 minutes (validates representative states)
 * SCHEDULE: Nightly only
 *
 * MISSION: Ensure TIGERweb REST API returns same counts as official shapefiles.
 * This validates that our production data source (TIGERweb API) matches the
 * authoritative ground truth (TIGER/Line shapefiles).
 *
 * VALIDATION APPROACH:
 * 1. Query TIGERweb REST API for congressional districts
 * 2. Compare against official-district-counts.ts registry
 * 3. Verify counts match official Census shapefiles
 *
 * DATA SOURCES:
 * - TIGERweb API: https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0
 * - Official Registry: registry/official-district-counts.ts
 * - Ground Truth: TIGER/Line 2024 shapefiles (119th Congress)
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { describe, it, expect } from 'vitest';
import { isCI, runIntegration, delay, API_RATE_LIMIT_MS, retryWithBackoff } from '../setup.js';
import {
  getOfficialCount,
  validateCount,
  getTotalCongressionalDistricts,
  type LegislativeChamber,
} from '../../core/registry/official-district-counts.js';

// ============================================================================
// Skip Control
// ============================================================================

// Skip in CI unless integration tests enabled
const skipInCI = isCI && !runIntegration;

// ============================================================================
// Types
// ============================================================================

interface TIGERwebFeature {
  readonly type: 'Feature';
  readonly properties: Record<string, unknown>;
  readonly geometry: unknown;
}

interface TIGERwebResponse {
  readonly type: 'FeatureCollection';
  readonly features: readonly TIGERwebFeature[];
}

interface StateTestConfig {
  readonly state: string;
  readonly stateName: string;
  readonly fips: string;
  readonly expectedCongressional: number;
  readonly reason: string;
}

// ============================================================================
// Configuration
// ============================================================================

const TIGERWEB_BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb';

const TIGERWEB_ENDPOINTS = {
  congressional: `${TIGERWEB_BASE}/Legislative/MapServer/0`,
  state_senate: `${TIGERWEB_BASE}/Legislative/MapServer/1`,
  state_house: `${TIGERWEB_BASE}/Legislative/MapServer/2`,
} as const;

/**
 * Representative states for shapefile validation
 * - Small, medium, large states for comprehensive coverage
 */
const TEST_STATES: readonly StateTestConfig[] = [
  {
    state: 'MT',
    stateName: 'Montana',
    fips: '30',
    expectedCongressional: 2,
    reason: 'Gained seat in 2020 reapportionment (1 → 2)',
  },
  {
    state: 'WI',
    stateName: 'Wisconsin',
    fips: '55',
    expectedCongressional: 8,
    reason: 'Medium state - stable count',
  },
  {
    state: 'TX',
    stateName: 'Texas',
    fips: '48',
    expectedCongressional: 38,
    reason: 'Gained 2 seats in 2020 reapportionment (36 → 38)',
  },
  {
    state: 'CA',
    stateName: 'California',
    fips: '06',
    expectedCongressional: 52,
    reason: 'Lost seat in 2020 reapportionment (53 → 52)',
  },
] as const;

// ============================================================================
// API Client
// ============================================================================

/**
 * Query TIGERweb REST API for a state
 */
async function queryTIGERweb(
  chamber: LegislativeChamber,
  stateFips: string
): Promise<TIGERwebResponse> {
  const endpoint = TIGERWEB_ENDPOINTS[chamber];

  const params = new URLSearchParams({
    where: `STATE = '${stateFips}'`,
    outFields: '*',
    f: 'geojson',
    returnGeometry: 'false',
  });

  const url = `${endpoint}/query?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as TIGERwebResponse;

  if (!data.features || !Array.isArray(data.features)) {
    throw new Error('Invalid GeoJSON: missing features array');
  }

  return data;
}

/**
 * Get count of districts from TIGERweb for a state
 */
async function getTIGERwebCount(chamber: LegislativeChamber, stateFips: string): Promise<number> {
  const response = await queryTIGERweb(chamber, stateFips);

  // Filter out non-voting delegates (code 98) and at-large placeholders (code ZZ)
  const validFeatures = response.features.filter((f) => {
    const geoid = String(f.properties.GEOID ?? '');
    return !geoid.endsWith('98') && !geoid.endsWith('ZZ');
  });

  return validFeatures.length;
}

// ============================================================================
// Integration Tests
// ============================================================================

describe.skipIf(skipInCI)('TIGER Shapefile Ground Truth Validation', () => {
  describe('Congressional Districts', () => {
    for (const config of TEST_STATES) {
      it(
        `TIGERweb matches official count for ${config.stateName} (${config.expectedCongressional} districts)`,
        async () => {
          const tigerwebCount = await retryWithBackoff(() =>
            getTIGERwebCount('congressional', config.fips)
          );

          const validation = validateCount(config.state, 'congressional', tigerwebCount);

          expect(validation.isValid).toBe(true);
          expect(tigerwebCount).toBe(config.expectedCongressional);
          expect(validation.confidence).toBe(1.0);

          // Rate limit
          await delay(API_RATE_LIMIT_MS);
        },
        30_000
      );
    }
  });

  describe('Registry Integrity', () => {
    it('registry totals exactly 435 congressional seats', () => {
      const total = getTotalCongressionalDistricts();
      expect(total).toBe(435);
    });

    it('all test states exist in official registry', () => {
      for (const config of TEST_STATES) {
        const officialCount = getOfficialCount(config.state, 'congressional');
        expect(officialCount).not.toBeNull();
        expect(officialCount).toBe(config.expectedCongressional);
      }
    });
  });

  describe('API Response Validation', () => {
    it(
      'returns valid GeoJSON structure for congressional districts',
      async () => {
        const response = await retryWithBackoff(() => queryTIGERweb('congressional', '30')); // Montana

        expect(response.type).toBe('FeatureCollection');
        expect(Array.isArray(response.features)).toBe(true);
        expect(response.features.length).toBeGreaterThan(0);

        // Verify all features have required structure
        for (const feature of response.features) {
          expect(feature.type).toBe('Feature');
          expect(feature.properties).toBeDefined();
          expect(typeof feature.properties).toBe('object');
        }

        // Rate limit
        await delay(API_RATE_LIMIT_MS);
      },
      30_000
    );

    it(
      'includes required properties in all features',
      async () => {
        const response = await retryWithBackoff(() => queryTIGERweb('congressional', '30')); // Montana

        const requiredProps = ['GEOID', 'STATEFP', 'CD118FP', 'NAMELSAD'];

        for (const feature of response.features) {
          for (const prop of requiredProps) {
            expect(feature.properties).toHaveProperty(prop);
          }
        }

        // Rate limit
        await delay(API_RATE_LIMIT_MS);
      },
      30_000
    );
  });

  describe('Reapportionment Validation', () => {
    it(
      'Montana has exactly 2 districts (gained 1 in 2020)',
      async () => {
        const count = await retryWithBackoff(() => getTIGERwebCount('congressional', '30'));
        expect(count).toBe(2);

        // Rate limit
        await delay(API_RATE_LIMIT_MS);
      },
      30_000
    );

    it(
      'Texas has exactly 38 districts (gained 2 in 2020)',
      async () => {
        const count = await retryWithBackoff(() => getTIGERwebCount('congressional', '48'));
        expect(count).toBe(38);

        // Rate limit
        await delay(API_RATE_LIMIT_MS);
      },
      30_000
    );

    it(
      'California has exactly 52 districts (lost 1 in 2020)',
      async () => {
        const count = await retryWithBackoff(() => getTIGERwebCount('congressional', '06'));
        expect(count).toBe(52);

        // Rate limit
        await delay(API_RATE_LIMIT_MS);
      },
      30_000
    );
  });

  describe('Error Handling', () => {
    it(
      'handles invalid state FIPS gracefully',
      async () => {
        const response = await retryWithBackoff(() => queryTIGERweb('congressional', '99'));

        // Should return empty features array, not error
        expect(response.features.length).toBe(0);

        // Rate limit
        await delay(API_RATE_LIMIT_MS);
      },
      30_000
    );
  });
});
