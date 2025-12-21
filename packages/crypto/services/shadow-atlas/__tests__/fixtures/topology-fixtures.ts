/**
 * Topology Validation Test Fixtures
 *
 * These fixtures test REAL geometric properties using turf.js operations.
 * NO MOCKING - these validate actual polygon intersections, unions, and area calculations.
 *
 * Design Philosophy:
 * - Simple rectangular geometries for predictable area calculations
 * - Realistic GEOIDs following Census Bureau formats
 * - Clear separation between TILING layers (must tesselate) and NON-TILING layers (can overlap)
 * - Sub-0.001% tolerance thresholds to catch precision issues
 */

import type { Feature, Polygon, FeatureCollection } from 'geojson';

/**
 * Helper: Create rectangular polygon from bounding box coordinates
 * Coordinates are in simple unit space for predictable calculations
 */
export function createRectanglePolygon(
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number
): Polygon {
  return {
    type: 'Polygon',
    coordinates: [[
      [minLon, minLat],
      [maxLon, minLat],
      [maxLon, maxLat],
      [minLon, maxLat],
      [minLon, minLat], // Close the ring
    ]],
  };
}

/**
 * Helper: Create GeoJSON Feature with properties
 */
function createFeature(
  geoid: string,
  name: string,
  geometry: Polygon,
  additionalProps: Record<string, unknown> = {}
): Feature<Polygon> {
  return {
    type: 'Feature',
    properties: {
      GEOID: geoid,
      NAME: name,
      ...additionalProps,
    },
    geometry,
  };
}

// =============================================================================
// FIXTURE SET 1: Perfect Tiling (PASS)
// =============================================================================

/**
 * Perfect Tiling: 4 VTDs that perfectly tile within their parent county
 *
 * Expected Validation:
 * - gapPercentage = 0.000%
 * - overlapPercentage = 0.000%
 * - totalCoverage = 100.000%
 * - Result: PASS
 *
 * Geometry:
 * - County: 10x10 unit square (area = 100)
 * - Each VTD: 5x5 unit square (area = 25)
 * - Total child area: 4 × 25 = 100 ✓
 */
export const PERFECT_TILING_COUNTY = createFeature(
  '53033', // King County, Washington
  'King County',
  createRectanglePolygon(-5, -5, 5, 5), // 10×10 square centered at origin
  { STATEFP: '53', COUNTYFP: '033' }
);

export const PERFECT_TILING_VTDS: Feature<Polygon>[] = [
  createFeature(
    '53033NW0001', // King County, VTD NW0001
    'Northwest Precinct',
    createRectanglePolygon(-5, 0, 0, 5), // NW quadrant
    { STATEFP: '53', COUNTYFP: '033', VTDST: 'NW0001' }
  ),
  createFeature(
    '53033NE0002', // King County, VTD NE0002
    'Northeast Precinct',
    createRectanglePolygon(0, 0, 5, 5), // NE quadrant
    { STATEFP: '53', COUNTYFP: '033', VTDST: 'NE0002' }
  ),
  createFeature(
    '53033SW0003', // King County, VTD SW0003
    'Southwest Precinct',
    createRectanglePolygon(-5, -5, 0, 0), // SW quadrant
    { STATEFP: '53', COUNTYFP: '033', VTDST: 'SW0003' }
  ),
  createFeature(
    '53033SE0004', // King County, VTD SE0004
    'Southeast Precinct',
    createRectanglePolygon(0, -5, 5, 0), // SE quadrant
    { STATEFP: '53', COUNTYFP: '033', VTDST: 'SE0004' }
  ),
];

export const PERFECT_TILING_FIXTURE: FeatureCollection<Polygon> = {
  type: 'FeatureCollection',
  features: [PERFECT_TILING_COUNTY, ...PERFECT_TILING_VTDS],
};

// =============================================================================
// FIXTURE SET 2: Gap Detected (FAIL)
// =============================================================================

/**
 * Gap Detection: One VTD is 0.1 units smaller, creating a 0.5 square unit gap
 *
 * Expected Validation:
 * - Gap area: 0.5 square units
 * - gapPercentage: 0.5 / 100 = 0.5% > 0.001% threshold ✗
 * - Result: FAIL
 *
 * Geometry:
 * - County: 10x10 (area = 100)
 * - VTD NW: 5×4.9 (area = 24.5) - 0.1 units shorter in Y direction
 * - VTDs NE, SW, SE: 5×5 (area = 25 each)
 * - Total child area: 24.5 + 75 = 99.5
 * - Gap: 100 - 99.5 = 0.5 square units
 */
export const GAP_DETECTED_COUNTY = createFeature(
  '06037', // Los Angeles County, California
  'Los Angeles County',
  createRectanglePolygon(-5, -5, 5, 5),
  { STATEFP: '06', COUNTYFP: '037' }
);

export const GAP_DETECTED_VTDS: Feature<Polygon>[] = [
  createFeature(
    '06037VTD001',
    'Precinct 001',
    createRectanglePolygon(-5, 0.1, 0, 5), // 0.1 unit gap at bottom edge
    { STATEFP: '06', COUNTYFP: '037', VTDST: 'VTD001' }
  ),
  createFeature(
    '06037VTD002',
    'Precinct 002',
    createRectanglePolygon(0, 0, 5, 5),
    { STATEFP: '06', COUNTYFP: '037', VTDST: 'VTD002' }
  ),
  createFeature(
    '06037VTD003',
    'Precinct 003',
    createRectanglePolygon(-5, -5, 0, 0),
    { STATEFP: '06', COUNTYFP: '037', VTDST: 'VTD003' }
  ),
  createFeature(
    '06037VTD004',
    'Precinct 004',
    createRectanglePolygon(0, -5, 5, 0),
    { STATEFP: '06', COUNTYFP: '037', VTDST: 'VTD004' }
  ),
];

export const GAP_DETECTED_FIXTURE: FeatureCollection<Polygon> = {
  type: 'FeatureCollection',
  features: [GAP_DETECTED_COUNTY, ...GAP_DETECTED_VTDS],
};

// =============================================================================
// FIXTURE SET 3: Overlap Detected (FAIL)
// =============================================================================

/**
 * Overlap Detection: Two VTDs overlap by 0.25 square units
 *
 * Expected Validation:
 * - Overlap area: 0.25 square units (0.5 × 0.5 overlap region)
 * - overlapPercentage: 0.25 / 100 = 0.25% > 0.001% threshold ✗
 * - Result: FAIL
 *
 * Geometry:
 * - County: 10x10 (area = 100)
 * - VTD NE extends 0.5 units into NW territory
 * - Overlap region: 0.5 × 0.5 = 0.25 square units
 */
export const OVERLAP_DETECTED_COUNTY = createFeature(
  '36061', // New York County (Manhattan)
  'New York County',
  createRectanglePolygon(-5, -5, 5, 5),
  { STATEFP: '36', COUNTYFP: '061' }
);

export const OVERLAP_DETECTED_VTDS: Feature<Polygon>[] = [
  createFeature(
    '36061ED001',
    'Election District 001',
    createRectanglePolygon(-5, 0, 0, 5), // NW quadrant (normal)
    { STATEFP: '36', COUNTYFP: '061', VTDST: 'ED001' }
  ),
  createFeature(
    '36061ED002',
    'Election District 002',
    createRectanglePolygon(-0.5, 0, 5, 5), // NE quadrant extends 0.5 units into NW
    { STATEFP: '36', COUNTYFP: '061', VTDST: 'ED002' }
  ),
  createFeature(
    '36061ED003',
    'Election District 003',
    createRectanglePolygon(-5, -5, 0, 0), // SW quadrant (normal)
    { STATEFP: '36', COUNTYFP: '061', VTDST: 'ED003' }
  ),
  createFeature(
    '36061ED004',
    'Election District 004',
    createRectanglePolygon(0, -5, 5, 0), // SE quadrant (normal)
    { STATEFP: '36', COUNTYFP: '061', VTDST: 'ED004' }
  ),
];

export const OVERLAP_DETECTED_FIXTURE: FeatureCollection<Polygon> = {
  type: 'FeatureCollection',
  features: [OVERLAP_DETECTED_COUNTY, ...OVERLAP_DETECTED_VTDS],
};

// =============================================================================
// FIXTURE SET 4: Valid Overlapping PLACEs (PASS for non-tiling layers)
// =============================================================================

/**
 * Valid Overlaps: Two incorporated cities that share territory
 *
 * Expected Validation:
 * - Layer type: PLACE (non-tiling, overlaps permitted)
 * - Overlap percentage: 20%
 * - Result: PASS (overlaps are valid for PLACE layer)
 *
 * Real-world analog: Cities like Atlant/Fulton County where city boundaries
 * can overlap with CDPs or cross county lines.
 *
 * Geometry:
 * - County: 10x10 (area = 100)
 * - City A: 6×5 (area = 30), left side
 * - City B: 6×5 (area = 30), right side
 * - Overlap region: 2×5 = 10 square units (both cities claim this area)
 * - Coverage: 30 + 30 - 10 = 50% of county (valid for PLACE)
 */
export const VALID_OVERLAP_COUNTY = createFeature(
  '13121', // Fulton County, Georgia
  'Fulton County',
  createRectanglePolygon(-5, -5, 5, 5),
  { STATEFP: '13', COUNTYFP: '121' }
);

export const VALID_OVERLAP_PLACES: Feature<Polygon>[] = [
  createFeature(
    '1304000', // Atlanta city
    'Atlanta',
    createRectanglePolygon(-5, 0, 1, 5), // 6×5 rectangle, left side
    { STATEFP: '13', PLACEFP: '04000', PLACENS: '00351615' }
  ),
  createFeature(
    '1368516', // Sandy Springs city
    'Sandy Springs',
    createRectanglePolygon(-1, 0, 5, 5), // 6×5 rectangle, right side (2 unit overlap)
    { STATEFP: '13', PLACEFP: '68516', PLACENS: '02560329' }
  ),
];

export const VALID_OVERLAP_FIXTURE: FeatureCollection<Polygon> = {
  type: 'FeatureCollection',
  features: [VALID_OVERLAP_COUNTY, ...VALID_OVERLAP_PLACES],
};

// =============================================================================
// FIXTURE SET 5: County Subdivisions (COUSUB) - Perfect Tiling
// =============================================================================

/**
 * Perfect Tiling: County subdivisions (towns/townships) that tile within county
 *
 * Expected Validation:
 * - gapPercentage = 0.000%
 * - overlapPercentage = 0.000%
 * - totalCoverage = 100.000%
 * - Result: PASS
 *
 * Real-world: New England towns perfectly tile within counties
 *
 * Geometry:
 * - County: 10x10 (area = 100)
 * - 4 COUSUBs, each 5×5 (area = 25)
 */
export const PERFECT_COUSUB_COUNTY = createFeature(
  '25021', // Norfolk County, Massachusetts
  'Norfolk County',
  createRectanglePolygon(-5, -5, 5, 5),
  { STATEFP: '25', COUNTYFP: '021' }
);

export const PERFECT_COUSUB_DIVISIONS: Feature<Polygon>[] = [
  createFeature(
    '2502107000', // Brookline town
    'Brookline',
    createRectanglePolygon(-5, 0, 0, 5),
    { STATEFP: '25', COUNTYFP: '021', COUSUBFP: '07000' }
  ),
  createFeature(
    '2502151600', // Newton city
    'Newton',
    createRectanglePolygon(0, 0, 5, 5),
    { STATEFP: '25', COUNTYFP: '021', COUSUBFP: '51600' }
  ),
  createFeature(
    '2502162535', // Quincy city
    'Quincy',
    createRectanglePolygon(-5, -5, 0, 0),
    { STATEFP: '25', COUNTYFP: '021', COUSUBFP: '62535' }
  ),
  createFeature(
    '2502177075', // Weymouth town
    'Weymouth',
    createRectanglePolygon(0, -5, 5, 0),
    { STATEFP: '25', COUNTYFP: '021', COUSUBFP: '77075' }
  ),
];

export const PERFECT_COUSUB_FIXTURE: FeatureCollection<Polygon> = {
  type: 'FeatureCollection',
  features: [PERFECT_COUSUB_COUNTY, ...PERFECT_COUSUB_DIVISIONS],
};

// =============================================================================
// FIXTURE SET 6: Edge Case - Floating Point Precision
// =============================================================================

/**
 * Floating Point Precision: Tests sub-0.001% tolerance threshold
 *
 * Expected Validation:
 * - Gap due to floating point rounding: ~0.0001 square units
 * - gapPercentage: 0.0001 / 100 = 0.0001% < 0.001% threshold ✓
 * - Result: PASS (within tolerance)
 *
 * Geometry:
 * - Uses coordinates that trigger floating point precision issues
 * - Gap is invisible at typical map zoom levels but detectable in calculations
 */
export const PRECISION_COUNTY = createFeature(
  '48201', // Harris County, Texas
  'Harris County',
  createRectanglePolygon(-5, -5, 5, 5),
  { STATEFP: '48', COUNTYFP: '201' }
);

export const PRECISION_VTDS: Feature<Polygon>[] = [
  createFeature(
    '48201VTD100',
    'Precinct 100',
    createRectanglePolygon(-5, 0, 0, 5),
    { STATEFP: '48', COUNTYFP: '201', VTDST: 'VTD100' }
  ),
  createFeature(
    '48201VTD200',
    'Precinct 200',
    createRectanglePolygon(0, 0.00001, 5, 5), // 0.00001 unit gap (sub-threshold)
    { STATEFP: '48', COUNTYFP: '201', VTDST: 'VTD200' }
  ),
  createFeature(
    '48201VTD300',
    'Precinct 300',
    createRectanglePolygon(-5, -5, 0, 0),
    { STATEFP: '48', COUNTYFP: '201', VTDST: 'VTD300' }
  ),
  createFeature(
    '48201VTD400',
    'Precinct 400',
    createRectanglePolygon(0, -5, 5, 0),
    { STATEFP: '48', COUNTYFP: '201', VTDST: 'VTD400' }
  ),
];

export const PRECISION_FIXTURE: FeatureCollection<Polygon> = {
  type: 'FeatureCollection',
  features: [PRECISION_COUNTY, ...PRECISION_VTDS],
};

// =============================================================================
// FIXTURE METADATA
// =============================================================================

export interface TopologyFixtureMeta {
  name: string;
  description: string;
  layerType: 'VTD' | 'COUSUB' | 'PLACE' | 'CDP' | 'ZCTA';
  tilingExpected: boolean;
  expectedOutcome: 'PASS' | 'FAIL';
  expectedGapPercentage?: number;
  expectedOverlapPercentage?: number;
  fixture: FeatureCollection<Polygon>;
}

export const ALL_TOPOLOGY_FIXTURES: TopologyFixtureMeta[] = [
  {
    name: 'Perfect Tiling VTDs',
    description: 'Four VTDs that perfectly tile within county boundaries with zero gaps or overlaps',
    layerType: 'VTD',
    tilingExpected: true,
    expectedOutcome: 'PASS',
    expectedGapPercentage: 0,
    expectedOverlapPercentage: 0,
    fixture: PERFECT_TILING_FIXTURE,
  },
  {
    name: 'Gap Detected VTDs',
    description: 'VTD missing 0.1 units creates 0.5% gap (exceeds 0.001% threshold)',
    layerType: 'VTD',
    tilingExpected: true,
    expectedOutcome: 'FAIL',
    expectedGapPercentage: 0.5,
    expectedOverlapPercentage: 0,
    fixture: GAP_DETECTED_FIXTURE,
  },
  {
    name: 'Overlap Detected VTDs',
    description: 'Two VTDs overlap by 0.25 square units (0.25% exceeds threshold)',
    layerType: 'VTD',
    tilingExpected: true,
    expectedOutcome: 'FAIL',
    expectedGapPercentage: 0,
    expectedOverlapPercentage: 0.25,
    fixture: OVERLAP_DETECTED_FIXTURE,
  },
  {
    name: 'Valid Overlapping PLACEs',
    description: 'Two cities with 20% overlap (valid for non-tiling PLACE layer)',
    layerType: 'PLACE',
    tilingExpected: false,
    expectedOutcome: 'PASS',
    expectedGapPercentage: 0,
    expectedOverlapPercentage: 20,
    fixture: VALID_OVERLAP_FIXTURE,
  },
  {
    name: 'Perfect Tiling COUSUBs',
    description: 'Four county subdivisions (towns) that perfectly tile within county',
    layerType: 'COUSUB',
    tilingExpected: true,
    expectedOutcome: 'PASS',
    expectedGapPercentage: 0,
    expectedOverlapPercentage: 0,
    fixture: PERFECT_COUSUB_FIXTURE,
  },
  {
    name: 'Floating Point Precision',
    description: 'Sub-threshold gap (0.0001%) from floating point rounding (should pass)',
    layerType: 'VTD',
    tilingExpected: true,
    expectedOutcome: 'PASS',
    expectedGapPercentage: 0.0001,
    expectedOverlapPercentage: 0,
    fixture: PRECISION_FIXTURE,
  },
];

// =============================================================================
// HELPER FUNCTIONS FOR TEST VALIDATION
// =============================================================================

/**
 * Validate fixture area calculations
 * Useful for debugging test failures
 */
export function validateFixtureAreas(fixture: FeatureCollection<Polygon>): {
  parentArea: number;
  childrenTotalArea: number;
  expectedCoverage: number;
} {
  const [parent, ...children] = fixture.features;

  // Simple area calculation for rectangles
  const calculateRectArea = (coords: number[][]): number => {
    const [minLon, minLat] = coords[0];
    const [maxLon, maxLat] = coords[2];
    return Math.abs((maxLon - minLon) * (maxLat - minLat));
  };

  const parentArea = calculateRectArea(parent.geometry.coordinates[0]);
  const childrenTotalArea = children.reduce(
    (sum, child) => sum + calculateRectArea(child.geometry.coordinates[0]),
    0
  );

  return {
    parentArea,
    childrenTotalArea,
    expectedCoverage: (childrenTotalArea / parentArea) * 100,
  };
}
