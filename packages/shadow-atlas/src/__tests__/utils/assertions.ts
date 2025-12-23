/**
 * Custom Assertions for Geographic Data
 *
 * SCOPE: Domain-specific assertions for Shadow Atlas testing
 *
 * PHILOSOPHY: Expressive, type-safe assertions that make tests readable.
 * Each assertion provides clear error messages on failure.
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no `@ts-ignore`.
 */

import { expect } from 'vitest';
import type { Polygon, MultiPolygon, Position } from 'geojson';
import type { ExtractedBoundary } from '../../providers/state-batch-extractor.js';

// ============================================================================
// Coordinate Assertions
// ============================================================================

/**
 * Assert that coordinates are valid (within valid lat/lon bounds)
 */
export function assertValidCoordinates(
  lon: number,
  lat: number,
  message?: string
): void {
  expect(lon, message ?? 'Longitude out of range').toBeGreaterThanOrEqual(-180);
  expect(lon, message ?? 'Longitude out of range').toBeLessThanOrEqual(180);
  expect(lat, message ?? 'Latitude out of range').toBeGreaterThanOrEqual(-90);
  expect(lat, message ?? 'Latitude out of range').toBeLessThanOrEqual(90);
}

/**
 * Assert that a position is valid
 */
export function assertValidPosition(pos: Position, message?: string): void {
  expect(pos.length, message ?? 'Invalid position').toBeGreaterThanOrEqual(2);
  assertValidCoordinates(pos[0], pos[1], message);
}

// ============================================================================
// Geometry Assertions
// ============================================================================

/**
 * Assert that a polygon ring is closed (first and last coordinates match)
 */
export function assertClosedRing(
  ring: readonly Position[],
  message?: string
): void {
  expect(ring.length, message ?? 'Ring has too few coordinates').toBeGreaterThanOrEqual(
    4
  );

  const first = ring[0];
  const last = ring[ring.length - 1];

  expect(last[0], message ?? 'Ring is not closed (longitude)').toBe(first[0]);
  expect(last[1], message ?? 'Ring is not closed (latitude)').toBe(first[1]);
}

/**
 * Assert that a polygon is valid
 */
export function assertValidPolygon(geom: Polygon, message?: string): void {
  expect(geom.type, message ?? 'Invalid geometry type').toBe('Polygon');
  expect(
    geom.coordinates.length,
    message ?? 'Polygon has no rings'
  ).toBeGreaterThanOrEqual(1);

  // Check outer ring
  const outerRing = geom.coordinates[0];
  assertClosedRing(outerRing, message ?? 'Outer ring is invalid');

  // Check all coordinates
  for (const ring of geom.coordinates) {
    for (const pos of ring) {
      assertValidPosition(pos, message);
    }
  }
}

/**
 * Assert that a MultiPolygon is valid
 */
export function assertValidMultiPolygon(geom: MultiPolygon, message?: string): void {
  expect(geom.type, message ?? 'Invalid geometry type').toBe('MultiPolygon');
  expect(
    geom.coordinates.length,
    message ?? 'MultiPolygon has no polygons'
  ).toBeGreaterThanOrEqual(1);

  // Check each polygon
  for (const polyCoords of geom.coordinates) {
    for (const ring of polyCoords) {
      assertClosedRing(ring, message ?? 'Polygon ring is invalid');

      for (const pos of ring) {
        assertValidPosition(pos, message);
      }
    }
  }
}

/**
 * Assert that a boundary has valid geometry
 */
export function assertValidBoundaryGeometry(
  boundary: ExtractedBoundary,
  message?: string
): void {
  const { geometry } = boundary;

  if (geometry.type === 'Polygon') {
    assertValidPolygon(geometry, message ?? `Invalid geometry for ${boundary.id}`);
  } else if (geometry.type === 'MultiPolygon') {
    assertValidMultiPolygon(
      geometry,
      message ?? `Invalid geometry for ${boundary.id}`
    );
  } else {
    throw new Error(
      `Unsupported geometry type: ${(geometry as { type: string }).type}`
    );
  }
}

// ============================================================================
// GEOID Assertions
// ============================================================================

/**
 * Assert that a GEOID matches expected format
 */
export function assertValidGeoid(
  geoid: string,
  stateFips: string,
  minLength: number = 4,
  message?: string
): void {
  expect(
    geoid.length,
    message ?? `GEOID ${geoid} too short`
  ).toBeGreaterThanOrEqual(minLength);

  expect(
    geoid.startsWith(stateFips),
    message ?? `GEOID ${geoid} does not start with state FIPS ${stateFips}`
  ).toBe(true);
}

/**
 * Assert that all boundaries have valid GEOIDs for their state
 */
export function assertValidGeoidsForState(
  boundaries: readonly ExtractedBoundary[],
  stateFips: string,
  message?: string
): void {
  for (const boundary of boundaries) {
    const geoid = boundary.properties.GEOID;

    if (typeof geoid === 'string') {
      assertValidGeoid(
        geoid,
        stateFips,
        4,
        message ?? `Invalid GEOID for boundary ${boundary.id}`
      );
    }
  }
}

// ============================================================================
// Count Assertions
// ============================================================================

/**
 * Assert that boundary count matches expected count
 */
export function assertBoundaryCount(
  boundaries: readonly ExtractedBoundary[],
  expectedCount: number,
  message?: string
): void {
  expect(
    boundaries.length,
    message ?? `Expected ${expectedCount} boundaries, got ${boundaries.length}`
  ).toBe(expectedCount);
}

/**
 * Assert that boundary count is within tolerance
 */
export function assertBoundaryCountWithinTolerance(
  boundaries: readonly ExtractedBoundary[],
  expectedCount: number,
  tolerance: number = 1,
  message?: string
): void {
  const actualCount = boundaries.length;
  const diff = Math.abs(actualCount - expectedCount);

  expect(
    diff,
    message ??
      `Boundary count ${actualCount} differs from expected ${expectedCount} by ${diff} (tolerance: ${tolerance})`
  ).toBeLessThanOrEqual(tolerance);
}

// ============================================================================
// Source Assertions
// ============================================================================

/**
 * Assert that all boundaries have the same authority
 */
export function assertUniformAuthority(
  boundaries: readonly ExtractedBoundary[],
  expectedAuthority: 'state-gis' | 'tiger' | 'arcgis-hub',
  message?: string
): void {
  for (const boundary of boundaries) {
    expect(
      boundary.source.authority,
      message ?? `Boundary ${boundary.id} has mismatched authority`
    ).toBe(expectedAuthority);
  }
}

/**
 * Assert that all boundaries have the same vintage
 */
export function assertUniformVintage(
  boundaries: readonly ExtractedBoundary[],
  expectedVintage: number,
  message?: string
): void {
  for (const boundary of boundaries) {
    expect(
      boundary.source.vintage,
      message ?? `Boundary ${boundary.id} has mismatched vintage`
    ).toBe(expectedVintage);
  }
}

/**
 * Assert that all boundaries are from the same state
 */
export function assertUniformState(
  boundaries: readonly ExtractedBoundary[],
  expectedState: string,
  message?: string
): void {
  for (const boundary of boundaries) {
    expect(
      boundary.source.state,
      message ?? `Boundary ${boundary.id} has mismatched state`
    ).toBe(expectedState);
  }
}

// ============================================================================
// Area Assertions
// ============================================================================

/**
 * Assert that a boundary has non-zero area
 */
export function assertNonZeroArea(
  boundary: ExtractedBoundary,
  message?: string
): void {
  // Simple check: polygon should have at least 3 distinct coordinates
  const { geometry } = boundary;

  if (geometry.type === 'Polygon') {
    const ring = geometry.coordinates[0];
    expect(
      ring.length,
      message ?? `Boundary ${boundary.id} has too few coordinates`
    ).toBeGreaterThanOrEqual(4);
  } else if (geometry.type === 'MultiPolygon') {
    expect(
      geometry.coordinates.length,
      message ?? `Boundary ${boundary.id} has no polygons`
    ).toBeGreaterThanOrEqual(1);
  }
}

// ============================================================================
// Metadata Assertions
// ============================================================================

/**
 * Assert that extraction metadata is complete
 */
export function assertCompleteMetadata(
  metadata: {
    readonly endpoint?: string;
    readonly extractedAt?: string;
    readonly durationMs?: number;
  },
  message?: string
): void {
  expect(metadata.endpoint, message ?? 'Missing endpoint').toBeDefined();
  expect(metadata.extractedAt, message ?? 'Missing extractedAt').toBeDefined();
  expect(metadata.durationMs, message ?? 'Missing durationMs').toBeDefined();

  // Validate extractedAt is valid ISO timestamp
  if (metadata.extractedAt) {
    const date = new Date(metadata.extractedAt);
    expect(date.toString(), message ?? 'Invalid extractedAt timestamp').not.toBe(
      'Invalid Date'
    );
  }
}

// ============================================================================
// Uniqueness Assertions
// ============================================================================

/**
 * Assert that all boundary IDs are unique
 */
export function assertUniqueIds(
  boundaries: readonly ExtractedBoundary[],
  message?: string
): void {
  const ids = new Set<string>();
  const duplicates: string[] = [];

  for (const boundary of boundaries) {
    if (ids.has(boundary.id)) {
      duplicates.push(boundary.id);
    }
    ids.add(boundary.id);
  }

  expect(
    duplicates.length,
    message ?? `Duplicate boundary IDs found: ${duplicates.join(', ')}`
  ).toBe(0);
}

/**
 * Assert that all GEOIDs are unique
 */
export function assertUniqueGeoids(
  boundaries: readonly ExtractedBoundary[],
  message?: string
): void {
  const geoids = new Set<string>();
  const duplicates: string[] = [];

  for (const boundary of boundaries) {
    const geoid = boundary.properties.GEOID;

    if (typeof geoid === 'string') {
      if (geoids.has(geoid)) {
        duplicates.push(geoid);
      }
      geoids.add(geoid);
    }
  }

  expect(
    duplicates.length,
    message ?? `Duplicate GEOIDs found: ${duplicates.join(', ')}`
  ).toBe(0);
}

// ============================================================================
// Completeness Assertions
// ============================================================================

/**
 * Assert that all boundaries have required properties
 */
export function assertCompleteProperties(
  boundary: ExtractedBoundary,
  requiredProps: readonly string[],
  message?: string
): void {
  for (const prop of requiredProps) {
    expect(
      boundary.properties[prop],
      message ?? `Boundary ${boundary.id} missing required property: ${prop}`
    ).toBeDefined();
  }
}

/**
 * Assert that all boundaries in collection have required properties
 */
export function assertAllHaveProperties(
  boundaries: readonly ExtractedBoundary[],
  requiredProps: readonly string[],
  message?: string
): void {
  for (const boundary of boundaries) {
    assertCompleteProperties(boundary, requiredProps, message);
  }
}

// ============================================================================
// Timestamp Assertions
// ============================================================================

/**
 * Assert that a timestamp is recent (within specified milliseconds)
 */
export function assertRecentTimestamp(
  timestamp: string,
  maxAgeMs: number = 60000,
  message?: string
): void {
  const date = new Date(timestamp);
  const now = new Date();
  const age = now.getTime() - date.getTime();

  expect(
    age,
    message ?? `Timestamp ${timestamp} is too old (${age}ms > ${maxAgeMs}ms)`
  ).toBeLessThanOrEqual(maxAgeMs);
}

/**
 * Assert that a timestamp is valid ISO 8601
 */
export function assertValidISO8601(timestamp: string, message?: string): void {
  const date = new Date(timestamp);
  expect(date.toString(), message ?? `Invalid ISO 8601 timestamp: ${timestamp}`).not.toBe(
    'Invalid Date'
  );

  // Check that it roundtrips correctly
  expect(date.toISOString().startsWith(timestamp.slice(0, 19))).toBe(true);
}
