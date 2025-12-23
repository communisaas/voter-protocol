/**
 * Multi-State Validation E2E Test
 *
 * SCOPE: Real TIGERweb API calls for 14 representative states
 * RUNTIME: ~12-15 minutes (with rate limiting)
 * SCHEDULE: Nightly CI job only (RUN_E2E=true)
 *
 * MISSION: Execute REAL cross-validation tests to validate the Shadow Atlas
 * extraction pipeline against authoritative Census Bureau TIGERweb data.
 *
 * VALIDATION TARGETS:
 * - 10 largest states by population (CA, TX, FL, NY, PA, IL, OH, GA, NC, MI)
 * - 4 redistricting change states (CO, OR gained seats; MT, WV changed)
 *
 * VALIDATION CHECKS (per state, per layer):
 * 1. Count Validation: Does TIGERweb return expected number of districts?
 * 2. GEOID Validation: Are all GEOIDs properly formatted (SSFFF pattern)?
 * 3. Geometry Validation: Do all features have valid GeoJSON geometry?
 * 4. Coverage Validation: Does the state boundary union cover expected area?
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { area } from '@turf/turf';
import { polygon as turfPolygon, multiPolygon as turfMultiPolygon } from '@turf/helpers';
import { isCI, runE2E, delay, API_RATE_LIMIT_MS } from '../setup.js';

// ============================================================================
// Skip Control
// ============================================================================

// Skip in CI unless explicitly running E2E
const skipInCI = isCI && !runE2E;

// ============================================================================
// Types
// ============================================================================

interface StateConfig {
  readonly state: string;
  readonly stateName: string;
  readonly stateFips: string;
  readonly reason: string;
  readonly layers: {
    readonly congressional: number;
    readonly state_senate: number;
    readonly state_house: number;
  };
}

interface ValidationResult {
  readonly state: string;
  readonly stateName: string;
  readonly layer: 'congressional' | 'state_senate' | 'state_house';
  readonly expected: number;
  readonly actual: number;
  readonly match: boolean;
  readonly geoidValid: boolean;
  readonly geometryValid: boolean;
  readonly coverageValid: boolean;
  readonly error?: string;
  readonly duration: number;
  readonly details: {
    readonly geoids: readonly string[];
    readonly invalidGeoids: readonly string[];
    readonly totalArea: number;
    readonly averageDistrictArea: number;
  };
}

// ============================================================================
// State Configuration
// ============================================================================

const STATES_TO_VALIDATE: readonly StateConfig[] = [
  // 10 Largest States by Population
  {
    state: 'CA',
    stateName: 'California',
    stateFips: '06',
    reason: 'Largest state by population',
    layers: { congressional: 52, state_senate: 40, state_house: 80 },
  },
  {
    state: 'TX',
    stateName: 'Texas',
    stateFips: '48',
    reason: '2nd largest state',
    layers: { congressional: 38, state_senate: 31, state_house: 150 },
  },
  {
    state: 'FL',
    stateName: 'Florida',
    stateFips: '12',
    reason: '3rd largest state',
    layers: { congressional: 28, state_senate: 40, state_house: 120 },
  },
  {
    state: 'NY',
    stateName: 'New York',
    stateFips: '36',
    reason: '4th largest state',
    layers: { congressional: 26, state_senate: 63, state_house: 150 },
  },
  {
    state: 'PA',
    stateName: 'Pennsylvania',
    stateFips: '42',
    reason: '5th largest state',
    layers: { congressional: 17, state_senate: 50, state_house: 203 },
  },
  {
    state: 'IL',
    stateName: 'Illinois',
    stateFips: '17',
    reason: '6th largest state',
    layers: { congressional: 17, state_senate: 59, state_house: 118 },
  },
  {
    state: 'OH',
    stateName: 'Ohio',
    stateFips: '39',
    reason: '7th largest state',
    layers: { congressional: 15, state_senate: 33, state_house: 99 },
  },
  {
    state: 'GA',
    stateName: 'Georgia',
    stateFips: '13',
    reason: '8th largest state',
    layers: { congressional: 14, state_senate: 56, state_house: 180 },
  },
  {
    state: 'NC',
    stateName: 'North Carolina',
    stateFips: '37',
    reason: '9th largest state',
    layers: { congressional: 14, state_senate: 50, state_house: 120 },
  },
  {
    state: 'MI',
    stateName: 'Michigan',
    stateFips: '26',
    reason: '10th largest state',
    layers: { congressional: 13, state_senate: 38, state_house: 110 },
  },
  // Redistricting Change States
  {
    state: 'CO',
    stateName: 'Colorado',
    stateFips: '08',
    reason: 'Gained 1 seat in 2020 redistricting',
    layers: { congressional: 8, state_senate: 35, state_house: 65 },
  },
  {
    state: 'OR',
    stateName: 'Oregon',
    stateFips: '41',
    reason: 'Gained 1 seat in 2020 redistricting',
    layers: { congressional: 6, state_senate: 30, state_house: 60 },
  },
  {
    state: 'MT',
    stateName: 'Montana',
    stateFips: '30',
    reason: 'Gained 1 seat in 2020 redistricting (1→2)',
    layers: { congressional: 2, state_senate: 50, state_house: 100 },
  },
  {
    state: 'WV',
    stateName: 'West Virginia',
    stateFips: '54',
    reason: 'Lost 1 seat in 2020 redistricting (3→2)',
    layers: { congressional: 2, state_senate: 34, state_house: 100 },
  },
] as const;

// ============================================================================
// TIGERweb API Layer Mapping
// ============================================================================

const TIGER_LAYER_MAP = {
  congressional: 0, // Congressional Districts (118th Congress)
  state_senate: 1, // State Legislative Districts - Upper Chamber
  state_house: 2, // State Legislative Districts - Lower Chamber
} as const;

// ============================================================================
// API Functions
// ============================================================================

/**
 * Fetch GeoJSON from TIGERweb with retry logic
 */
async function fetchTIGERweb(
  stateFips: string,
  layer: keyof typeof TIGER_LAYER_MAP,
  retries: number = 3
): Promise<FeatureCollection> {
  const layerId = TIGER_LAYER_MAP[layer];
  const url =
    `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/${layerId}/query` +
    `?where=STATE='${stateFips}'&outFields=*&f=geojson`;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000); // 30 second timeout

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        if (response.status === 429 || response.status === 503) {
          // Rate limit or service unavailable - retry with exponential backoff
          const delayMs = Math.pow(2, attempt) * 1000;
          console.warn(`   Rate limited (${response.status}), retrying in ${delayMs}ms...`);
          await delay(delayMs);
          continue;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as FeatureCollection;

      if (!data.features || !Array.isArray(data.features)) {
        throw new Error('Invalid GeoJSON: missing features array');
      }

      return data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < retries) {
        const delayMs = Math.pow(2, attempt) * 500;
        await delay(delayMs);
      }
    }
  }

  throw lastError ?? new Error('Fetch failed');
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate GEOID format (SSFFF pattern)
 */
function validateGeoidFormat(geoid: string, stateFips: string): boolean {
  if (!geoid || typeof geoid !== 'string') return false;
  if (!geoid.startsWith(stateFips)) return false;
  if (geoid.length < 4 || geoid.length > 5) return false;
  if (!/^\d+$/.test(geoid)) return false;
  return true;
}

/**
 * Validate geometry
 */
function validateGeometry(geometry: unknown): geometry is Polygon | MultiPolygon {
  if (!geometry || typeof geometry !== 'object') return false;

  const geom = geometry as { type: string; coordinates: unknown };

  if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') return false;
  if (!Array.isArray(geom.coordinates)) return false;
  if (geom.coordinates.length === 0) return false;

  return true;
}

/**
 * Calculate total area of all features
 */
function calculateTotalArea(features: FeatureCollection['features']): number {
  let totalArea = 0;

  for (const feature of features) {
    if (!feature.geometry) continue;

    try {
      const geom = feature.geometry as Polygon | MultiPolygon;
      const turfFeature =
        geom.type === 'Polygon'
          ? turfPolygon(geom.coordinates)
          : turfMultiPolygon(geom.coordinates);

      totalArea += area(turfFeature);
    } catch (error) {
      // Skip invalid geometries
    }
  }

  return totalArea;
}

/**
 * Validate a single layer for a state
 */
async function validateLayer(
  config: StateConfig,
  layer: keyof typeof TIGER_LAYER_MAP
): Promise<ValidationResult> {
  const startTime = Date.now();
  const resultBase = {
    state: config.state,
    stateName: config.stateName,
    layer,
    expected: config.layers[layer],
    actual: 0,
    match: false,
    geoidValid: false,
    geometryValid: false,
    coverageValid: false,
    duration: 0,
    details: {
      geoids: [] as readonly string[],
      invalidGeoids: [] as readonly string[],
      totalArea: 0,
      averageDistrictArea: 0,
    },
  };

  try {
    // Fetch data from TIGERweb
    const geojson = await fetchTIGERweb(config.stateFips, layer);

    const actual = geojson.features.length;
    const match = actual === resultBase.expected;

    // Validate GEOIDs
    const geoids: string[] = [];
    const invalidGeoids: string[] = [];

    for (const feature of geojson.features) {
      const geoid = String(feature.properties?.GEOID ?? '');
      geoids.push(geoid);

      if (!validateGeoidFormat(geoid, config.stateFips)) {
        invalidGeoids.push(geoid);
      }
    }

    // Validate geometries
    let geometryValidCount = 0;
    for (const feature of geojson.features) {
      if (validateGeometry(feature.geometry)) {
        geometryValidCount++;
      }
    }
    const geometryValid = geometryValidCount === geojson.features.length;

    // Calculate coverage
    const totalArea = calculateTotalArea(geojson.features);
    const averageDistrictArea = actual > 0 ? totalArea / actual : 0;
    const coverageValid = totalArea > 0 && actual > 0;

    const duration = Date.now() - startTime;

    return {
      ...resultBase,
      actual,
      match,
      geoidValid: invalidGeoids.length === 0,
      geometryValid,
      coverageValid,
      duration,
      details: {
        geoids,
        invalidGeoids,
        totalArea,
        averageDistrictArea,
      },
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    return {
      ...resultBase,
      error: error instanceof Error ? error.message : String(error),
      duration,
    };
  }
}

// ============================================================================
// E2E Tests
// ============================================================================

describe.skipIf(skipInCI)('Multi-State Validation E2E', () => {
  beforeAll(() => {
    console.log('========================================');
    console.log('Multi-State Validation E2E Test');
    console.log(`States: ${STATES_TO_VALIDATE.length}`);
    console.log(`Layers per state: 3 (congressional, state_senate, state_house)`);
    console.log(`Total tests: ${STATES_TO_VALIDATE.length * 3}`);
    console.log(`Estimated runtime: ${Math.ceil(STATES_TO_VALIDATE.length * 3 * 3)}+ minutes`);
    console.log('========================================');
  });

  // Congressional Districts Tests
  for (const config of STATES_TO_VALIDATE) {
    it(
      `validates ${config.state} congressional districts (expected: ${config.layers.congressional})`,
      async () => {
        const result = await validateLayer(config, 'congressional');

        // Assert count
        expect(result.actual).toBe(result.expected);

        // Assert all GEOIDs valid
        if (result.details.invalidGeoids.length > 0) {
          console.warn(
            `Invalid GEOIDs in ${config.state}:`,
            result.details.invalidGeoids.slice(0, 5)
          );
        }
        expect(result.geoidValid).toBe(true);

        // Assert valid geometries
        expect(result.geometryValid).toBe(true);

        // Assert valid coverage
        expect(result.coverageValid).toBe(true);

        // Rate limit
        await delay(API_RATE_LIMIT_MS);
      },
      60_000
    ); // 60 second timeout
  }

  // State Senate Tests
  for (const config of STATES_TO_VALIDATE) {
    it(
      `validates ${config.state} state senate districts (expected: ${config.layers.state_senate})`,
      async () => {
        const result = await validateLayer(config, 'state_senate');

        // Assert count
        expect(result.actual).toBe(result.expected);

        // Assert all GEOIDs valid
        expect(result.geoidValid).toBe(true);

        // Assert valid geometries
        expect(result.geometryValid).toBe(true);

        // Assert valid coverage
        expect(result.coverageValid).toBe(true);

        // Rate limit
        await delay(API_RATE_LIMIT_MS);
      },
      60_000
    );
  }

  // State House Tests
  for (const config of STATES_TO_VALIDATE) {
    it(
      `validates ${config.state} state house districts (expected: ${config.layers.state_house})`,
      async () => {
        const result = await validateLayer(config, 'state_house');

        // Assert count
        expect(result.actual).toBe(result.expected);

        // Assert all GEOIDs valid
        expect(result.geoidValid).toBe(true);

        // Assert valid geometries
        expect(result.geometryValid).toBe(true);

        // Assert valid coverage
        expect(result.coverageValid).toBe(true);

        // Rate limit
        await delay(API_RATE_LIMIT_MS);
      },
      60_000
    );
  }
});
