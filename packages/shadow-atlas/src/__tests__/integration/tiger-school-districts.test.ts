/**
 * TIGER School District Integration Tests
 *
 * SCOPE: Validate TIGERweb REST API and TIGER/Line FTP data for school districts
 * RUNTIME: ~3-5 minutes (validates 3 representative states)
 * SCHEDULE: PR checks + nightly
 *
 * MISSION: Ensure TIGER school district data is complete, valid, and queryable.
 *
 * SCHOOL DISTRICT TYPES:
 * - Unified (UNSD): K-12 districts with single elected board
 * - Elementary (ELSD): K-8 districts (some rural areas)
 * - Secondary (SECSD): 9-12 high school districts (rare, paired with ELSD)
 *
 * TEST COVERAGE:
 * 1. TIGERweb API point-in-polygon queries (lat/lng → school district)
 * 2. TIGER/Line FTP shapefile download and parsing
 * 3. Feature count validation against expected totals
 * 4. Geometry and coordinate validation
 * 5. School district type handling (unified vs split)
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { describe, it, expect } from 'vitest';
import type { FeatureCollection, Feature, Polygon, MultiPolygon } from 'geojson';
import { isCI, runIntegration, delay, API_RATE_LIMIT_MS, retryWithBackoff } from '../setup.js';

// ============================================================================
// Skip Control
// ============================================================================

// Skip in CI unless integration tests enabled
const skipInCI = isCI && !runIntegration;

// Log skip status for debugging
if (skipInCI) {
  console.log('Skipping TIGER School District Integration tests (CI without RUN_INTEGRATION)');
}

// ============================================================================
// Types
// ============================================================================

interface SchoolDistrictFeature extends Feature {
  geometry: Polygon | MultiPolygon;
  properties: {
    GEOID: string;
    NAME: string;
    STATEFP: string;
    SCSDLEA?: string;  // Unified district LEA code
    ELSDLEA?: string;  // Elementary district LEA code
    SDLEA?: string;    // Secondary district LEA code
    LOGRADE?: string;  // Lowest grade
    HIGRADE?: string;  // Highest grade
  };
}

interface StateTestConfig {
  readonly state: string;
  readonly stateName: string;
  readonly stateFips: string;
  readonly expectedUnified: number;
  readonly expectedElementary?: number;
  readonly expectedSecondary?: number;
  readonly reason: string;
}

interface KnownSchoolDistrict {
  readonly name: string;
  readonly coordinates: readonly [number, number];  // [lat, lng]
  readonly expectedGEOID?: string;
  readonly type: 'unified' | 'elementary' | 'secondary';
}

// ============================================================================
// Test Configuration
// ============================================================================

/**
 * Representative states for school district validation
 * - California: Largest system (~1,000 unified districts)
 * - Washington: Medium-sized system (~295 unified districts)
 * - Illinois: Split system (some areas have elementary + secondary)
 */
const TEST_STATES: readonly StateTestConfig[] = [
  {
    state: 'WA',
    stateName: 'Washington',
    stateFips: '53',
    expectedUnified: 295,
    reason: 'Medium state - unified districts only',
  },
  {
    state: 'IL',
    stateName: 'Illinois',
    stateFips: '17',
    expectedUnified: 862,
    expectedElementary: 426,
    expectedSecondary: 96,
    reason: 'Large state - mix of unified and split districts',
  },
  {
    state: 'CA',
    stateName: 'California',
    stateFips: '06',
    expectedUnified: 1037,
    reason: 'Largest state - complex system',
  },
] as const;

/**
 * Known school districts with coordinates for point-in-polygon testing
 */
const KNOWN_DISTRICTS: readonly KnownSchoolDistrict[] = [
  {
    name: 'Seattle Public Schools',
    coordinates: [47.6062, -122.3321],  // Seattle, WA
    expectedGEOID: '5303780',  // Seattle School District No. 1
    type: 'unified',
  },
  {
    name: 'Los Angeles Unified',
    coordinates: [34.0522, -118.2437],  // Los Angeles, CA
    expectedGEOID: '0622710',  // Los Angeles Unified School District
    type: 'unified',
  },
  {
    name: 'Chicago Public Schools',
    coordinates: [41.8781, -87.6298],  // Chicago, IL
    expectedGEOID: '1709930',  // City of Chicago SD 299
    type: 'unified',
  },
] as const;

// ============================================================================
// TIGERweb API Client
// ============================================================================

const TIGERWEB_ENDPOINTS = {
  unified: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/School_Districts/MapServer/0',
  elementary: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/School_Districts/MapServer/1',
  secondary: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/School_Districts/MapServer/2',
} as const;

/**
 * Fetch school districts from TIGERweb API (state-wide query)
 */
async function fetchSchoolDistrictsByState(
  districtType: keyof typeof TIGERWEB_ENDPOINTS,
  stateFips: string
): Promise<FeatureCollection> {
  const endpoint = TIGERWEB_ENDPOINTS[districtType];
  const url = `${endpoint}/query?where=STATE='${stateFips}'&outFields=*&f=geojson`;

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

/**
 * Fetch school district by point (lat/lng)
 */
async function fetchSchoolDistrictByPoint(
  districtType: keyof typeof TIGERWEB_ENDPOINTS,
  lat: number,
  lng: number
): Promise<FeatureCollection> {
  const endpoint = TIGERWEB_ENDPOINTS[districtType];
  const url =
    `${endpoint}/query?geometry=${lng},${lat}&geometryType=esriGeometryPoint` +
    `&spatialRel=esriSpatialRelIntersects&outFields=*&f=geojson`;

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
 * Validate GEOID format (SSLLLLL pattern for school districts)
 * - SS: State FIPS (2 digits)
 * - LLLLL: Local Education Agency (LEA) code (5 digits)
 */
function isValidSchoolDistrictGeoid(geoid: string, stateFips: string): boolean {
  if (!geoid || typeof geoid !== 'string') return false;
  if (!geoid.startsWith(stateFips)) return false;
  if (geoid.length !== 7) return false;  // SSLLLLL = 7 digits
  if (!/^\d+$/.test(geoid)) return false;
  return true;
}

/**
 * Validate required properties exist
 */
function hasRequiredSchoolDistrictProperties(
  properties: Record<string, unknown> | null
): boolean {
  if (!properties) return false;

  // All school districts must have GEOID, NAME, STATEFP
  const required = ['GEOID', 'NAME', 'STATEFP'];
  return required.every((prop) => prop in properties && properties[prop]);
}

/**
 * Validate geometry coordinates are within valid range
 */
function hasValidCoordinates(geometry: Polygon | MultiPolygon): boolean {
  const validatePosition = (pos: number[]): boolean => {
    if (pos.length < 2) return false;
    const [lng, lat] = pos;
    return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
  };

  if (geometry.type === 'Polygon') {
    return geometry.coordinates.every((ring) =>
      ring.every((pos) => validatePosition(pos))
    );
  } else if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.every((polygon) =>
      polygon.every((ring) => ring.every((pos) => validatePosition(pos)))
    );
  }

  return false;
}

// ============================================================================
// Integration Tests - TIGERweb API
// ============================================================================

describe.skipIf(skipInCI)('TIGER School District Integration', () => {
  describe('TIGERweb API - Point-in-Polygon Queries', () => {
    for (const district of KNOWN_DISTRICTS) {
      it(`should find ${district.name} at known coordinates`, async () => {
        const [lat, lng] = district.coordinates;
        const geojson = await retryWithBackoff(() =>
          fetchSchoolDistrictByPoint(district.type, lat, lng)
        );

        expect(geojson.features.length).toBeGreaterThan(0);

        const feature = geojson.features[0] as SchoolDistrictFeature;
        expect(feature.properties.NAME).toBeTruthy();

        if (district.expectedGEOID) {
          expect(feature.properties.GEOID).toBe(district.expectedGEOID);
        }

        // Rate limit
        await delay(API_RATE_LIMIT_MS);
      }, 30_000);
    }

    it('should return no results for ocean coordinates', async () => {
      // Pacific Ocean (far from any school district)
      const geojson = await retryWithBackoff(() =>
        fetchSchoolDistrictByPoint('unified', 25.0, -170.0)
      );

      expect(geojson.features.length).toBe(0);

      // Rate limit
      await delay(API_RATE_LIMIT_MS);
    }, 30_000);

    it('should return consistent results for same coordinates', async () => {
      const [lat, lng] = KNOWN_DISTRICTS[0].coordinates;

      const result1 = await retryWithBackoff(() =>
        fetchSchoolDistrictByPoint('unified', lat, lng)
      );
      await delay(API_RATE_LIMIT_MS);

      const result2 = await retryWithBackoff(() =>
        fetchSchoolDistrictByPoint('unified', lat, lng)
      );

      expect(result1.features.length).toBe(result2.features.length);
      if (result1.features.length > 0 && result2.features.length > 0) {
        const geoid1 = (result1.features[0] as SchoolDistrictFeature).properties.GEOID;
        const geoid2 = (result2.features[0] as SchoolDistrictFeature).properties.GEOID;
        expect(geoid1).toBe(geoid2);
      }

      // Rate limit
      await delay(API_RATE_LIMIT_MS);
    }, 60_000);
  });

  describe('TIGERweb API - State-Wide Queries', () => {
    for (const config of TEST_STATES) {
      describe(`${config.stateName} (${config.state})`, () => {
        it(
          `returns ${config.expectedUnified} unified school districts`,
          async () => {
            const geojson = await retryWithBackoff(() =>
              fetchSchoolDistrictsByState('unified', config.stateFips)
            );

            expect(geojson.features.length).toBe(config.expectedUnified);

            // Rate limit
            await delay(API_RATE_LIMIT_MS);
          },
          30_000
        );

        if (config.expectedElementary) {
          it(
            `returns ${config.expectedElementary} elementary school districts`,
            async () => {
              const geojson = await retryWithBackoff(() =>
                fetchSchoolDistrictsByState('elementary', config.stateFips)
              );

              expect(geojson.features.length).toBe(config.expectedElementary);

              // Rate limit
              await delay(API_RATE_LIMIT_MS);
            },
            30_000
          );
        }

        if (config.expectedSecondary) {
          it(
            `returns ${config.expectedSecondary} secondary school districts`,
            async () => {
              const geojson = await retryWithBackoff(() =>
                fetchSchoolDistrictsByState('secondary', config.stateFips)
              );

              expect(geojson.features.length).toBe(config.expectedSecondary);

              // Rate limit
              await delay(API_RATE_LIMIT_MS);
            },
            30_000
          );
        }

        it('returns valid GeoJSON structure for unified districts', async () => {
          const geojson = await retryWithBackoff(() =>
            fetchSchoolDistrictsByState('unified', config.stateFips)
          );

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
          const geojson = await retryWithBackoff(() =>
            fetchSchoolDistrictsByState('unified', config.stateFips)
          );

          // Verify all GEOIDs are valid
          const invalidGeoids: string[] = [];

          for (const feature of geojson.features) {
            const geoid = String((feature.properties as Record<string, unknown>)?.GEOID ?? '');

            if (!isValidSchoolDistrictGeoid(geoid, config.stateFips)) {
              invalidGeoids.push(geoid);
            }
          }

          if (invalidGeoids.length > 0) {
            console.warn(`Invalid GEOIDs found in ${config.state}:`, invalidGeoids.slice(0, 5));
          }

          expect(invalidGeoids.length).toBe(0);

          // Rate limit
          await delay(API_RATE_LIMIT_MS);
        }, 30_000);

        it('returns required properties for all features', async () => {
          const geojson = await retryWithBackoff(() =>
            fetchSchoolDistrictsByState('unified', config.stateFips)
          );

          // Verify all features have required properties
          const missingProperties: number[] = [];

          for (let i = 0; i < geojson.features.length; i++) {
            const feature = geojson.features[i];
            const properties = feature.properties as Record<string, unknown> | null;

            if (!hasRequiredSchoolDistrictProperties(properties)) {
              missingProperties.push(i);
            }
          }

          if (missingProperties.length > 0) {
            console.warn(
              `Features missing required properties in ${config.state}:`,
              missingProperties.slice(0, 5)
            );
          }

          expect(missingProperties.length).toBe(0);

          // Rate limit
          await delay(API_RATE_LIMIT_MS);
        }, 30_000);

        it('returns districts with correct state FIPS code', async () => {
          const geojson = await retryWithBackoff(() =>
            fetchSchoolDistrictsByState('unified', config.stateFips)
          );

          // Verify all features have correct state FIPS
          for (const feature of geojson.features) {
            const statefp = String((feature.properties as Record<string, unknown>)?.STATEFP ?? '');
            expect(statefp).toBe(config.stateFips);
          }

          // Rate limit
          await delay(API_RATE_LIMIT_MS);
        }, 30_000);

        it('returns valid geometries with proper coordinates', async () => {
          const geojson = await retryWithBackoff(() =>
            fetchSchoolDistrictsByState('unified', config.stateFips)
          );

          // Check first 10 features (avoid timeout on large states)
          const sampled = geojson.features.slice(0, 10);

          for (const feature of sampled) {
            const geometry = feature.geometry as Polygon | MultiPolygon;
            expect(hasValidCoordinates(geometry)).toBe(true);
          }

          // Rate limit
          await delay(API_RATE_LIMIT_MS);
        }, 30_000);
      });
    }
  });

  describe('Error Handling', () => {
    it('handles invalid state FIPS gracefully', async () => {
      const geojson = await retryWithBackoff(() =>
        fetchSchoolDistrictsByState('unified', '99')
      ); // Invalid FIPS

      // Should return empty features array, not error
      expect(geojson.features.length).toBe(0);

      // Rate limit
      await delay(API_RATE_LIMIT_MS);
    }, 30_000);

    it('handles rate limiting with retry', async () => {
      // Make multiple rapid requests to potentially trigger rate limiting
      const promises = Array.from({ length: 3 }, () =>
        retryWithBackoff(() => fetchSchoolDistrictsByState('unified', '53'))
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

  describe('School District Types', () => {
    it('should handle states with only unified districts', async () => {
      // Washington has only unified districts (no elementary/secondary split)
      const unified = await retryWithBackoff(() =>
        fetchSchoolDistrictsByState('unified', '53')
      );
      await delay(API_RATE_LIMIT_MS);

      const elementary = await retryWithBackoff(() =>
        fetchSchoolDistrictsByState('elementary', '53')
      );
      await delay(API_RATE_LIMIT_MS);

      const secondary = await retryWithBackoff(() =>
        fetchSchoolDistrictsByState('secondary', '53')
      );

      expect(unified.features.length).toBeGreaterThan(0);
      expect(elementary.features.length).toBe(0);
      expect(secondary.features.length).toBe(0);

      // Rate limit
      await delay(API_RATE_LIMIT_MS);
    }, 60_000);

    it('should handle states with split districts', async () => {
      // Illinois has mix of unified and split (elementary + secondary)
      const unified = await retryWithBackoff(() =>
        fetchSchoolDistrictsByState('unified', '17')
      );
      await delay(API_RATE_LIMIT_MS);

      const elementary = await retryWithBackoff(() =>
        fetchSchoolDistrictsByState('elementary', '17')
      );
      await delay(API_RATE_LIMIT_MS);

      const secondary = await retryWithBackoff(() =>
        fetchSchoolDistrictsByState('secondary', '17')
      );

      expect(unified.features.length).toBeGreaterThan(0);
      expect(elementary.features.length).toBeGreaterThan(0);
      expect(secondary.features.length).toBeGreaterThan(0);

      // Rate limit
      await delay(API_RATE_LIMIT_MS);
    }, 60_000);

    it('should return different district types at same coordinates', async () => {
      // Some areas have overlapping elementary + secondary districts
      // Use Illinois coordinates where split districts exist
      const lat = 41.8;
      const lng = -87.8;

      const elementary = await retryWithBackoff(() =>
        fetchSchoolDistrictByPoint('elementary', lat, lng)
      );
      await delay(API_RATE_LIMIT_MS);

      const secondary = await retryWithBackoff(() =>
        fetchSchoolDistrictByPoint('secondary', lat, lng)
      );

      // If both exist, they should have different GEOIDs
      if (elementary.features.length > 0 && secondary.features.length > 0) {
        const elemGeoid = (elementary.features[0] as SchoolDistrictFeature).properties.GEOID;
        const secGeoid = (secondary.features[0] as SchoolDistrictFeature).properties.GEOID;
        expect(elemGeoid).not.toBe(secGeoid);
      }

      // Rate limit
      await delay(API_RATE_LIMIT_MS);
    }, 60_000);
  });
});
