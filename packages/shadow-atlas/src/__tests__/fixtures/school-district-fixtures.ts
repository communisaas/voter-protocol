/**
 * School District Test Fixtures
 *
 * Test data for school district validation and integration tests.
 * Includes known districts, mock API responses, and edge cases.
 *
 * TYPE SAFETY: All fixtures strongly typed, no `any`.
 */

import type { FeatureCollection, Feature, Polygon, MultiPolygon } from 'geojson';

// ============================================================================
// Types
// ============================================================================

export interface SchoolDistrictProperties {
  readonly GEOID: string;
  readonly NAME: string;
  readonly STATEFP: string;
  readonly SCSDLEA?: string;  // Unified district LEA code
  readonly ELSDLEA?: string;  // Elementary district LEA code
  readonly SDLEA?: string;    // Secondary district LEA code
  readonly LOGRADE?: string;  // Lowest grade
  readonly HIGRADE?: string;  // Highest grade
  readonly MTFCC?: string;    // MAF/TIGER Feature Class Code
  readonly FUNCSTAT?: string; // Functional status
  readonly ALAND?: number;    // Land area (square meters)
  readonly AWATER?: number;   // Water area (square meters)
}

export interface SchoolDistrictFixture {
  readonly name: string;
  readonly geoid: string;
  readonly state: string;
  readonly stateFips: string;
  readonly coordinates: readonly [number, number];  // [lat, lng]
  readonly type: 'unified' | 'elementary' | 'secondary';
  readonly geometry?: Polygon | MultiPolygon;
  readonly properties: SchoolDistrictProperties;
}

// ============================================================================
// Known School Districts (Ground Truth)
// ============================================================================

/**
 * Large urban unified school districts
 */
export const URBAN_UNIFIED_DISTRICTS: readonly SchoolDistrictFixture[] = [
  {
    name: 'Seattle Public Schools',
    geoid: '5303780',
    state: 'WA',
    stateFips: '53',
    coordinates: [47.6062, -122.3321],
    type: 'unified',
    properties: {
      GEOID: '5303780',
      NAME: 'Seattle School District No. 1',
      STATEFP: '53',
      SCSDLEA: '03780',
      LOGRADE: 'PK',
      HIGRADE: '12',
      MTFCC: 'G5420',
      FUNCSTAT: 'E',
      ALAND: 142503858,
      AWATER: 34682042,
    },
  },
  {
    name: 'Los Angeles Unified',
    geoid: '0622710',
    state: 'CA',
    stateFips: '06',
    coordinates: [34.0522, -118.2437],
    type: 'unified',
    properties: {
      GEOID: '0622710',
      NAME: 'Los Angeles Unified School District',
      STATEFP: '06',
      SCSDLEA: '22710',
      LOGRADE: 'PK',
      HIGRADE: '12',
      MTFCC: 'G5420',
      FUNCSTAT: 'E',
      ALAND: 1809000000,
      AWATER: 56000000,
    },
  },
  {
    name: 'Chicago Public Schools',
    geoid: '1709930',
    state: 'IL',
    stateFips: '17',
    coordinates: [41.8781, -87.6298],
    type: 'unified',
    properties: {
      GEOID: '1709930',
      NAME: 'City of Chicago SD 299',
      STATEFP: '17',
      SCSDLEA: '09930',
      LOGRADE: 'PK',
      HIGRADE: '12',
      MTFCC: 'G5420',
      FUNCSTAT: 'E',
      ALAND: 589000000,
      AWATER: 47000000,
    },
  },
  {
    name: 'New York City',
    geoid: '3620580',
    state: 'NY',
    stateFips: '36',
    coordinates: [40.7128, -74.0060],
    type: 'unified',
    properties: {
      GEOID: '3620580',
      NAME: 'New York City Geographic District # 1',
      STATEFP: '36',
      SCSDLEA: '20580',
      LOGRADE: 'PK',
      HIGRADE: '12',
      MTFCC: 'G5420',
      FUNCSTAT: 'E',
      ALAND: 783000000,
      AWATER: 429000000,
    },
  },
] as const;

/**
 * Rural unified school districts
 */
export const RURAL_UNIFIED_DISTRICTS: readonly SchoolDistrictFixture[] = [
  {
    name: 'Whitman County SD',
    geoid: '5339630',
    state: 'WA',
    stateFips: '53',
    coordinates: [46.7298, -117.1817],  // Pullman, WA
    type: 'unified',
    properties: {
      GEOID: '5339630',
      NAME: 'Pullman School District',
      STATEFP: '53',
      SCSDLEA: '39630',
      LOGRADE: 'KG',
      HIGRADE: '12',
      MTFCC: 'G5420',
      FUNCSTAT: 'E',
      ALAND: 45000000,
      AWATER: 500000,
    },
  },
] as const;

/**
 * Split district systems (elementary + secondary)
 */
export const SPLIT_DISTRICTS: readonly SchoolDistrictFixture[] = [
  {
    name: 'Example Elementary',
    geoid: '1712345',
    state: 'IL',
    stateFips: '17',
    coordinates: [41.8, -87.8],
    type: 'elementary',
    properties: {
      GEOID: '1712345',
      NAME: 'Example CCSD 123',
      STATEFP: '17',
      ELSDLEA: '12345',
      LOGRADE: 'PK',
      HIGRADE: '08',
      MTFCC: 'G5410',
      FUNCSTAT: 'E',
      ALAND: 25000000,
      AWATER: 100000,
    },
  },
  {
    name: 'Example Secondary',
    geoid: '1767890',
    state: 'IL',
    stateFips: '17',
    coordinates: [41.8, -87.8],  // Same coords as elementary (overlapping)
    type: 'secondary',
    properties: {
      GEOID: '1767890',
      NAME: 'Example CHSD 456',
      STATEFP: '17',
      SDLEA: '67890',
      LOGRADE: '09',
      HIGRADE: '12',
      MTFCC: 'G5400',
      FUNCSTAT: 'E',
      ALAND: 30000000,
      AWATER: 150000,
    },
  },
] as const;

// ============================================================================
// Mock GeoJSON Responses
// ============================================================================

/**
 * Create mock feature for testing
 */
function createMockFeature(fixture: SchoolDistrictFixture): Feature {
  return {
    type: 'Feature',
    geometry: fixture.geometry ?? createMockPolygon(),
    properties: fixture.properties,
  };
}

/**
 * Create simple polygon for testing
 */
function createMockPolygon(): Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [-122.0, 47.0],
        [-122.0, 48.0],
        [-121.0, 48.0],
        [-121.0, 47.0],
        [-122.0, 47.0],  // Closed ring
      ],
    ],
  };
}

/**
 * Mock TIGERweb response for Seattle unified district
 */
export const MOCK_SEATTLE_UNIFIED_RESPONSE: FeatureCollection = {
  type: 'FeatureCollection',
  features: [createMockFeature(URBAN_UNIFIED_DISTRICTS[0])],
};

/**
 * Mock TIGERweb response for Washington state unified districts
 */
export const MOCK_WASHINGTON_UNIFIED_RESPONSE: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    createMockFeature(URBAN_UNIFIED_DISTRICTS[0]),
    createMockFeature(RURAL_UNIFIED_DISTRICTS[0]),
  ],
};

/**
 * Mock empty response (no districts found)
 */
export const MOCK_EMPTY_RESPONSE: FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/**
 * Mock invalid response (missing required properties)
 */
export const MOCK_INVALID_RESPONSE: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: createMockPolygon(),
      properties: {
        // Missing GEOID, NAME, STATEFP
        LOGRADE: 'PK',
        HIGRADE: '12',
      },
    },
  ],
};

// ============================================================================
// Edge Cases
// ============================================================================

/**
 * Edge case: School district with no name
 */
export const EDGE_CASE_NO_NAME: SchoolDistrictFixture = {
  name: 'Unknown District',
  geoid: '5399999',
  state: 'WA',
  stateFips: '53',
  coordinates: [47.0, -122.0],
  type: 'unified',
  properties: {
    GEOID: '5399999',
    NAME: '',  // Empty name
    STATEFP: '53',
    SCSDLEA: '99999',
    MTFCC: 'G5420',
    FUNCSTAT: 'E',
    ALAND: 1000000,
    AWATER: 0,
  },
};

/**
 * Edge case: School district with very large area (Alaska)
 */
export const EDGE_CASE_LARGE_AREA: SchoolDistrictFixture = {
  name: 'North Slope Borough SD',
  geoid: '0200270',
  state: 'AK',
  stateFips: '02',
  coordinates: [70.0, -150.0],  // Arctic Alaska
  type: 'unified',
  properties: {
    GEOID: '0200270',
    NAME: 'North Slope Borough School District',
    STATEFP: '02',
    SCSDLEA: '00270',
    LOGRADE: 'PK',
    HIGRADE: '12',
    MTFCC: 'G5420',
    FUNCSTAT: 'E',
    ALAND: 230000000000,  // 230,000 sq km (largest SD in US)
    AWATER: 9000000000,
  },
};

/**
 * Edge case: School district on state boundary
 */
export const EDGE_CASE_STATE_BOUNDARY: SchoolDistrictFixture = {
  name: 'Bristol Bay SD',
  geoid: '0200090',
  state: 'AK',
  stateFips: '02',
  coordinates: [58.7578, -156.8619],
  type: 'unified',
  properties: {
    GEOID: '0200090',
    NAME: 'Bristol Bay Borough School District',
    STATEFP: '02',
    SCSDLEA: '00090',
    LOGRADE: 'PK',
    HIGRADE: '12',
    MTFCC: 'G5420',
    FUNCSTAT: 'E',
    ALAND: 1300000000,
    AWATER: 1800000000,  // More water than land
  },
};

// ============================================================================
// Expected Counts by State
// ============================================================================

/**
 * Expected school district counts by state (FIPS code)
 *
 * Source: Census TIGER/Line 2024 metadata
 *
 * NOTE: These are DISTRICT counts, not school counts.
 * Some states have only unified, others have elementary + secondary split.
 */
export const EXPECTED_SCHOOL_DISTRICT_COUNTS: Record<
  string,
  {
    readonly unified: number;
    readonly elementary?: number;
    readonly secondary?: number;
  }
> = {
  // States with only unified districts
  '53': { unified: 295 },  // Washington
  '06': { unified: 1037 }, // California
  '12': { unified: 75 },   // Florida
  '48': { unified: 1217 }, // Texas

  // States with split districts
  '17': {
    unified: 862,
    elementary: 426,
    secondary: 96,
  }, // Illinois

  '36': {
    unified: 731,
    elementary: 0,
    secondary: 0,
  }, // New York

  // Add more states as needed for testing
};

/**
 * Get expected count for state and district type
 */
export function getExpectedSchoolDistrictCount(
  stateFips: string,
  type: 'unified' | 'elementary' | 'secondary'
): number | null {
  const counts = EXPECTED_SCHOOL_DISTRICT_COUNTS[stateFips];
  if (!counts) return null;

  if (type === 'unified') return counts.unified;
  if (type === 'elementary') return counts.elementary ?? 0;
  if (type === 'secondary') return counts.secondary ?? 0;

  return null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get all urban district fixtures
 */
export function getUrbanDistricts(): readonly SchoolDistrictFixture[] {
  return URBAN_UNIFIED_DISTRICTS;
}

/**
 * Get all rural district fixtures
 */
export function getRuralDistricts(): readonly SchoolDistrictFixture[] {
  return RURAL_UNIFIED_DISTRICTS;
}

/**
 * Get split district fixtures
 */
export function getSplitDistricts(): readonly SchoolDistrictFixture[] {
  return SPLIT_DISTRICTS;
}

/**
 * Get all edge case fixtures
 */
export function getEdgeCaseDistricts(): readonly SchoolDistrictFixture[] {
  return [EDGE_CASE_NO_NAME, EDGE_CASE_LARGE_AREA, EDGE_CASE_STATE_BOUNDARY];
}

/**
 * Get fixture by GEOID
 */
export function getFixtureByGeoid(geoid: string): SchoolDistrictFixture | null {
  const allFixtures = [
    ...URBAN_UNIFIED_DISTRICTS,
    ...RURAL_UNIFIED_DISTRICTS,
    ...SPLIT_DISTRICTS,
    EDGE_CASE_NO_NAME,
    EDGE_CASE_LARGE_AREA,
    EDGE_CASE_STATE_BOUNDARY,
  ];

  return allFixtures.find((f) => f.geoid === geoid) ?? null;
}

/**
 * Get fixtures by state
 */
export function getFixturesByState(stateFips: string): readonly SchoolDistrictFixture[] {
  const allFixtures = [
    ...URBAN_UNIFIED_DISTRICTS,
    ...RURAL_UNIFIED_DISTRICTS,
    ...SPLIT_DISTRICTS,
    EDGE_CASE_NO_NAME,
    EDGE_CASE_LARGE_AREA,
    EDGE_CASE_STATE_BOUNDARY,
  ];

  return allFixtures.filter((f) => f.stateFips === stateFips);
}
