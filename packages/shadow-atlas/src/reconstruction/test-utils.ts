/**
 * Test Utilities for Boundary Reconstruction
 *
 * Provides mock data generators, test fixtures, and assertions
 * for testing the reconstruction pipeline.
 *
 * PHILOSOPHY:
 * - Tests should be deterministic
 * - Mock data should be realistic but simple
 * - Golden vectors are sacred (no auto-generation)
 */

import type { Feature, LineString, Polygon, Position } from 'geojson';
import type {
  StreetSegment,
  WardLegalDescription,
  BoundarySegmentDescription,
  SourceDocument,
  GoldenVector,
} from './types';

// =============================================================================
// Mock Street Segments
// =============================================================================

/**
 * Create a mock street segment for testing
 */
export function createMockStreetSegment(params: {
  id: string;
  name: string;
  coordinates: Position[];
  altNames?: string[];
  streetType?: string;
  highway?: string;
}): StreetSegment {
  const lons = params.coordinates.map(([lon]) => lon);
  const lats = params.coordinates.map(([, lat]) => lat);

  return {
    id: params.id,
    name: params.name,
    altNames: Object.freeze(params.altNames ?? []),
    streetType: params.streetType ?? 'street',
    highway: params.highway ?? 'residential',
    geometry: {
      type: 'Feature',
      properties: { id: params.id, name: params.name },
      geometry: {
        type: 'LineString',
        coordinates: params.coordinates,
      },
    },
    bbox: [
      Math.min(...lons),
      Math.min(...lats),
      Math.max(...lons),
      Math.max(...lats),
    ],
  };
}

/**
 * Create a simple grid of streets for testing
 */
export function createMockStreetGrid(params: {
  centerLon: number;
  centerLat: number;
  gridSize: number; // in degrees
  streetCount: number;
}): readonly StreetSegment[] {
  const segments: StreetSegment[] = [];
  const halfGrid = params.gridSize / 2;
  const spacing = params.gridSize / (params.streetCount - 1);

  // East-West streets (named by number)
  for (let i = 0; i < params.streetCount; i++) {
    const lat = params.centerLat - halfGrid + i * spacing;
    const ordinal = getOrdinalSuffix(i + 1);
    segments.push(
      createMockStreetSegment({
        id: `ew-${i}`,
        name: `${i + 1}${ordinal} Street`,
        coordinates: [
          [params.centerLon - halfGrid, lat],
          [params.centerLon + halfGrid, lat],
        ],
      })
    );
  }

  // North-South streets (named alphabetically)
  const streetNames = [
    'Main Street',
    'Oak Avenue',
    'Elm Boulevard',
    'Maple Drive',
    'Pine Road',
    'Cedar Lane',
    'Birch Way',
    'Walnut Court',
  ];

  for (let i = 0; i < params.streetCount; i++) {
    const lon = params.centerLon - halfGrid + i * spacing;
    segments.push(
      createMockStreetSegment({
        id: `ns-${i}`,
        name: streetNames[i % streetNames.length],
        coordinates: [
          [lon, params.centerLat - halfGrid],
          [lon, params.centerLat + halfGrid],
        ],
      })
    );
  }

  return Object.freeze(segments);
}

function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

// =============================================================================
// Mock Legal Descriptions
// =============================================================================

/**
 * Create a mock boundary segment description
 */
export function createMockSegmentDescription(params: {
  index: number;
  featureName: string;
  direction?: 'north' | 'south' | 'east' | 'west';
  from?: string;
  to?: string;
}): BoundarySegmentDescription {
  return {
    index: params.index,
    referenceType: 'street_centerline',
    featureName: params.featureName,
    direction: params.direction,
    from: params.from,
    to: params.to,
    rawText: `along ${params.featureName}${params.direction ? ` ${params.direction}` : ''}`,
    parseConfidence: 'high',
  };
}

/**
 * Create a mock source document
 */
export function createMockSourceDocument(params?: {
  type?: 'pdf_ward_map' | 'ordinance_text';
  source?: string;
  title?: string;
}): SourceDocument {
  return {
    type: params?.type ?? 'ordinance_text',
    source: params?.source ?? 'https://example.com/ordinance-123',
    title: params?.title ?? 'Test City Ward Ordinance',
    effectiveDate: '2024-01-01',
    retrievedAt: new Date().toISOString(),
    contentHash: 'sha256:mock-hash-for-testing',
    notes: 'Mock document for testing',
  };
}

/**
 * Create a mock ward legal description
 */
export function createMockWardDescription(params: {
  cityFips: string;
  cityName: string;
  state: string;
  wardId: string;
  wardName: string;
  segments: readonly BoundarySegmentDescription[];
}): WardLegalDescription {
  return {
    cityFips: params.cityFips,
    cityName: params.cityName,
    state: params.state,
    wardId: params.wardId,
    wardName: params.wardName,
    segments: params.segments,
    source: createMockSourceDocument(),
    notes: 'Mock ward for testing',
  };
}

/**
 * Create a simple rectangular ward description
 */
export function createRectangularWardDescription(params: {
  cityFips: string;
  cityName: string;
  state: string;
  wardId: string;
  northStreet: string;
  southStreet: string;
  eastStreet: string;
  westStreet: string;
}): WardLegalDescription {
  const segments: BoundarySegmentDescription[] = [
    createMockSegmentDescription({
      index: 0,
      featureName: params.northStreet,
      direction: 'east',
      from: `intersection with ${params.westStreet}`,
      to: `intersection with ${params.eastStreet}`,
    }),
    createMockSegmentDescription({
      index: 1,
      featureName: params.eastStreet,
      direction: 'south',
      from: `intersection with ${params.northStreet}`,
      to: `intersection with ${params.southStreet}`,
    }),
    createMockSegmentDescription({
      index: 2,
      featureName: params.southStreet,
      direction: 'west',
      from: `intersection with ${params.eastStreet}`,
      to: `intersection with ${params.westStreet}`,
    }),
    createMockSegmentDescription({
      index: 3,
      featureName: params.westStreet,
      direction: 'north',
      from: `intersection with ${params.southStreet}`,
      to: `intersection with ${params.northStreet}`,
    }),
  ];

  return createMockWardDescription({
    cityFips: params.cityFips,
    cityName: params.cityName,
    state: params.state,
    wardId: params.wardId,
    wardName: `Ward ${params.wardId}`,
    segments,
  });
}

// =============================================================================
// Mock Polygons
// =============================================================================

/**
 * Create a mock polygon feature
 */
export function createMockPolygon(params: {
  wardId: string;
  wardName: string;
  cityFips: string;
  coordinates: Position[];
}): Feature<Polygon> {
  // Ensure closed ring
  const coords = [...params.coordinates];
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    coords.push(first);
  }

  return {
    type: 'Feature',
    properties: {
      wardId: params.wardId,
      wardName: params.wardName,
      cityFips: params.cityFips,
    },
    geometry: {
      type: 'Polygon',
      coordinates: [coords],
    },
  };
}

/**
 * Create a rectangular polygon
 */
export function createRectangularPolygon(params: {
  wardId: string;
  wardName: string;
  cityFips: string;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}): Feature<Polygon> {
  return createMockPolygon({
    wardId: params.wardId,
    wardName: params.wardName,
    cityFips: params.cityFips,
    coordinates: [
      [params.minLon, params.minLat], // SW
      [params.maxLon, params.minLat], // SE
      [params.maxLon, params.maxLat], // NE
      [params.minLon, params.maxLat], // NW
      [params.minLon, params.minLat], // Close
    ],
  });
}

// =============================================================================
// Golden Vector Test Fixtures
// =============================================================================

/**
 * Create a complete test fixture with street network, descriptions, and golden vector
 */
export function createTestFixture(params: {
  cityFips: string;
  cityName: string;
  state: string;
  wardCount: number;
  centerLon: number;
  centerLat: number;
  gridSize: number;
}): {
  readonly streetSegments: readonly StreetSegment[];
  readonly wardDescriptions: readonly WardLegalDescription[];
  readonly goldenVector: GoldenVector;
} {
  // Create street grid
  const streetSegments = createMockStreetGrid({
    centerLon: params.centerLon,
    centerLat: params.centerLat,
    gridSize: params.gridSize,
    streetCount: params.wardCount + 1,
  });

  // Create ward descriptions and polygons
  const wardDescriptions: WardLegalDescription[] = [];
  const expectedPolygons: Feature<Polygon>[] = [];

  const halfGrid = params.gridSize / 2;
  const wardSize = params.gridSize / params.wardCount;

  for (let i = 0; i < params.wardCount; i++) {
    const wardId = String(i + 1);
    const minLat = params.centerLat - halfGrid + i * wardSize;
    const maxLat = minLat + wardSize;

    // Get street names for this ward
    const iOrdinal = getOrdinalSuffix(i + 1);
    const i1Ordinal = getOrdinalSuffix(i + 2);

    wardDescriptions.push(
      createRectangularWardDescription({
        cityFips: params.cityFips,
        cityName: params.cityName,
        state: params.state,
        wardId,
        northStreet: `${i + 2}${i1Ordinal} Street`,
        southStreet: `${i + 1}${iOrdinal} Street`,
        eastStreet: 'Main Street',
        westStreet: 'Oak Avenue',
      })
    );

    expectedPolygons.push(
      createRectangularPolygon({
        wardId,
        wardName: `Ward ${wardId}`,
        cityFips: params.cityFips,
        minLon: params.centerLon - halfGrid,
        maxLon: params.centerLon - halfGrid + wardSize,
        minLat,
        maxLat,
      })
    );
  }

  const goldenVector: GoldenVector = {
    cityFips: params.cityFips,
    cityName: params.cityName,
    state: params.state,
    expectedWardCount: params.wardCount,
    legalDescriptions: wardDescriptions,
    expectedPolygons,
    verifiedAt: new Date().toISOString(),
    verificationSource: 'test-fixture',
    notes: 'Auto-generated test fixture',
  };

  return {
    streetSegments: Object.freeze(streetSegments),
    wardDescriptions: Object.freeze(wardDescriptions),
    goldenVector,
  };
}

// =============================================================================
// Test Assertions
// =============================================================================

/**
 * Assert that a polygon is valid
 */
export function assertValidPolygon(
  polygon: Feature<Polygon>,
  message?: string
): void {
  const prefix = message ? `${message}: ` : '';

  if (polygon.type !== 'Feature') {
    throw new Error(`${prefix}Expected Feature, got ${polygon.type}`);
  }

  if (polygon.geometry.type !== 'Polygon') {
    throw new Error(`${prefix}Expected Polygon geometry, got ${polygon.geometry.type}`);
  }

  const ring = polygon.geometry.coordinates[0];
  if (ring.length < 4) {
    throw new Error(`${prefix}Ring has ${ring.length} points, need at least 4`);
  }

  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    throw new Error(`${prefix}Ring is not closed`);
  }
}

/**
 * Assert that two polygons are approximately equal
 */
export function assertPolygonsApproximatelyEqual(
  actual: Feature<Polygon>,
  expected: Feature<Polygon>,
  toleranceMeters: number,
  message?: string
): void {
  const prefix = message ? `${message}: ` : '';

  const actualRing = actual.geometry.coordinates[0];
  const expectedRing = expected.geometry.coordinates[0];

  // Compare centroids
  const actualCentroid = calculateSimpleCentroid(actualRing);
  const expectedCentroid = calculateSimpleCentroid(expectedRing);

  const centroidDist = haversineDistanceSimple(actualCentroid, expectedCentroid);
  if (centroidDist > toleranceMeters) {
    throw new Error(
      `${prefix}Centroid distance ${centroidDist.toFixed(1)}m exceeds tolerance ${toleranceMeters}m`
    );
  }
}

function calculateSimpleCentroid(ring: Position[]): Position {
  let sumLon = 0;
  let sumLat = 0;
  for (const [lon, lat] of ring) {
    sumLon += lon;
    sumLat += lat;
  }
  return [sumLon / ring.length, sumLat / ring.length];
}

function haversineDistanceSimple([lon1, lat1]: Position, [lon2, lat2]: Position): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
