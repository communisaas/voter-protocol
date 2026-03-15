/**
 * Tests for hydrate-country utilities.
 *
 * H-1: Cell map threshold gate (95% boundary coverage required).
 * H-4: Boundary index collision detection.
 */

import { describe, it, expect } from 'vitest';
import type { InternationalBoundary } from '../../../providers/international/base-provider.js';
import {
  CELL_MAP_THRESHOLD,
  MAX_BOUNDARY_COLLISIONS,
  buildBoundaryIndex,
  checkCellMapCoverage,
} from '../../../hydration/hydrate-country.js';

// ============================================================================
// Helpers
// ============================================================================

function makeBoundary(
  id: string,
  name: string,
  type: string = 'federal',
): InternationalBoundary {
  return {
    id,
    name,
    type,
    geometry: {
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    },
    source: {
      country: 'XX',
      dataSource: 'test',
      endpoint: 'https://example.com',
      authority: 'national-statistics',
      vintage: 2025,
      retrievedAt: new Date().toISOString(),
    },
    properties: {},
  };
}

// ============================================================================
// H-1: Cell Map Threshold
// ============================================================================

describe('CELL_MAP_THRESHOLD constant', () => {
  it('is 0.95 (95%)', () => {
    expect(CELL_MAP_THRESHOLD).toBe(0.95);
  });
});

describe('checkCellMapCoverage', () => {
  it('allows when coverage meets threshold', () => {
    const result = checkCellMapCoverage(100, 100);
    expect(result.allowed).toBe(true);
    expect(result.coverage).toBe(1.0);
  });

  it('allows at exactly 95% coverage', () => {
    const result = checkCellMapCoverage(95, 100);
    expect(result.allowed).toBe(true);
    expect(result.coverage).toBe(0.95);
  });

  it('rejects below 95% coverage', () => {
    const result = checkCellMapCoverage(94, 100);
    expect(result.allowed).toBe(false);
    expect(result.coverage).toBe(0.94);
  });

  it('rejects at 80% coverage (old threshold)', () => {
    const result = checkCellMapCoverage(80, 100);
    expect(result.allowed).toBe(false);
    expect(result.coverage).toBe(0.80);
  });

  it('allows with custom lower threshold', () => {
    const result = checkCellMapCoverage(80, 100, 0.80);
    expect(result.allowed).toBe(true);
  });

  it('handles zero expected count gracefully', () => {
    const result = checkCellMapCoverage(0, 0);
    expect(result.allowed).toBe(false);
    expect(result.coverage).toBe(0);
  });

  it('handles over-extraction (more than expected)', () => {
    const result = checkCellMapCoverage(110, 100);
    expect(result.allowed).toBe(true);
    expect(result.coverage).toBe(1.1);
  });

  it('uses realistic counts (e.g., UK 650 constituencies)', () => {
    // 620/650 = 95.4% — should pass
    expect(checkCellMapCoverage(620, 650).allowed).toBe(true);
    // 615/650 = 94.6% — should fail
    expect(checkCellMapCoverage(615, 650).allowed).toBe(false);
  });
});

// ============================================================================
// H-4: Boundary Index Collision Detection
// ============================================================================

describe('MAX_BOUNDARY_COLLISIONS constant', () => {
  it('is 10', () => {
    expect(MAX_BOUNDARY_COLLISIONS).toBe(10);
  });
});

describe('buildBoundaryIndex', () => {
  it('indexes unique boundaries by name', () => {
    const boundaries = [
      makeBoundary('a', 'District A'),
      makeBoundary('b', 'District B'),
      makeBoundary('c', 'District C'),
    ];

    const { index, collisionCount } = buildBoundaryIndex(boundaries);

    expect(collisionCount).toBe(0);
    expect(index.size).toBe(3);
    expect(index.get('District A')?.id).toBe('a');
    expect(index.get('District B')?.id).toBe('b');
    expect(index.get('District C')?.id).toBe('c');
  });

  it('detects collision and creates compound keys', () => {
    const boundaries = [
      makeBoundary('a', 'Springfield', 'state'),
      makeBoundary('b', 'Springfield', 'county'),
    ];

    const { index, collisionCount } = buildBoundaryIndex(boundaries);

    expect(collisionCount).toBe(1);
    // Original key still points to first entry
    expect(index.get('Springfield')?.id).toBe('a');
    // Compound keys exist for both
    expect(index.get('state:Springfield')?.id).toBe('a');
    expect(index.get('county:Springfield')?.id).toBe('b');
  });

  it('handles triple collision', () => {
    const boundaries = [
      makeBoundary('a', 'Portland', 'state'),
      makeBoundary('b', 'Portland', 'county'),
      makeBoundary('c', 'Portland', 'municipal'),
    ];

    const { index, collisionCount } = buildBoundaryIndex(boundaries);

    expect(collisionCount).toBe(2);
    expect(index.get('state:Portland')?.id).toBe('a');
    expect(index.get('county:Portland')?.id).toBe('b');
    expect(index.get('municipal:Portland')?.id).toBe('c');
  });

  it('does not create compound key for non-colliding names', () => {
    const boundaries = [
      makeBoundary('a', 'Unique A', 'federal'),
      makeBoundary('b', 'Collision', 'state'),
      makeBoundary('c', 'Collision', 'county'),
      makeBoundary('d', 'Unique B', 'federal'),
    ];

    const { index, collisionCount } = buildBoundaryIndex(boundaries);

    expect(collisionCount).toBe(1);
    // Unique entries indexed normally
    expect(index.get('Unique A')?.id).toBe('a');
    expect(index.get('Unique B')?.id).toBe('d');
    // No compound key for unique entries
    expect(index.has('federal:Unique A')).toBe(false);
    // Compound keys for collisions
    expect(index.get('state:Collision')?.id).toBe('b');
    expect(index.get('county:Collision')?.id).toBe('c');
  });

  it('returns zero collisions for empty array', () => {
    const { index, collisionCount } = buildBoundaryIndex([]);
    expect(collisionCount).toBe(0);
    expect(index.size).toBe(0);
  });

  it('handles same type collision with compound key', () => {
    // Two boundaries with same name AND same type — compound keys will collide
    // This is edge-case behavior: the second overwrites the first compound key
    const boundaries = [
      makeBoundary('a', 'Dup', 'federal'),
      makeBoundary('b', 'Dup', 'federal'),
    ];

    const { index, collisionCount } = buildBoundaryIndex(boundaries);

    expect(collisionCount).toBe(1);
    // When type is the same, compound key collides — last write wins
    expect(index.get('federal:Dup')?.id).toBe('b');
  });
});
