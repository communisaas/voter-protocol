/**
 * Boundary Schema Validation Tests
 *
 * Tests Zod schemas for boundary geometry validation:
 * - BoundaryGeometrySchema (Polygon / MultiPolygon)
 * - BoundarySourceSchema
 * - InternationalBoundarySchema
 */

import { describe, it, expect } from 'vitest';
import {
  BoundaryGeometrySchema,
  BoundarySourceSchema,
  InternationalBoundarySchema,
} from '../../../../providers/international/country-provider-types.js';

// ============================================================================
// Test Fixtures
// ============================================================================

/** Simple triangle (4 positions — ring must close) */
const VALID_RING = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 0],
];

const VALID_POLYGON = {
  type: 'Polygon' as const,
  coordinates: [VALID_RING],
};

const VALID_MULTIPOLYGON = {
  type: 'MultiPolygon' as const,
  coordinates: [[VALID_RING], [VALID_RING]],
};

const VALID_SOURCE = {
  country: 'GB',
  dataSource: 'ONS',
  endpoint: 'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services',
  authority: 'national-statistics' as const,
  vintage: 2024,
  retrievedAt: '2026-03-13T00:00:00Z',
};

const VALID_BOUNDARY = {
  id: 'uk-parl-E14001234',
  name: 'Islington North',
  type: 'parliamentary',
  geometry: VALID_POLYGON,
  source: VALID_SOURCE,
  properties: { ons_code: 'E14001234' },
};

// ============================================================================
// BoundaryGeometrySchema Tests
// ============================================================================

describe('BoundaryGeometrySchema', () => {
  it('accepts valid Polygon geometry', () => {
    const result = BoundaryGeometrySchema.safeParse(VALID_POLYGON);
    expect(result.success).toBe(true);
  });

  it('accepts valid MultiPolygon geometry', () => {
    const result = BoundaryGeometrySchema.safeParse(VALID_MULTIPOLYGON);
    expect(result.success).toBe(true);
  });

  it('rejects null geometry', () => {
    const result = BoundaryGeometrySchema.safeParse(null);
    expect(result.success).toBe(false);
  });

  it('rejects empty coordinates array', () => {
    const result = BoundaryGeometrySchema.safeParse({
      type: 'Polygon',
      coordinates: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects ring with fewer than 4 positions', () => {
    const shortRing = [
      [0, 0],
      [1, 0],
      [0, 0],
    ];
    const result = BoundaryGeometrySchema.safeParse({
      type: 'Polygon',
      coordinates: [shortRing],
    });
    expect(result.success).toBe(false);
  });

  it('accepts Polygon with altitude in positions', () => {
    const ring3d = [
      [0, 0, 100],
      [1, 0, 100],
      [1, 1, 100],
      [0, 0, 100],
    ];
    const result = BoundaryGeometrySchema.safeParse({
      type: 'Polygon',
      coordinates: [ring3d],
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown geometry type', () => {
    const result = BoundaryGeometrySchema.safeParse({
      type: 'Point',
      coordinates: [0, 0],
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// BoundarySourceSchema Tests
// ============================================================================

describe('BoundarySourceSchema', () => {
  it('accepts valid source', () => {
    const result = BoundarySourceSchema.safeParse(VALID_SOURCE);
    expect(result.success).toBe(true);
  });

  it('rejects missing endpoint', () => {
    const result = BoundarySourceSchema.safeParse({
      ...VALID_SOURCE,
      endpoint: '',
    });
    expect(result.success).toBe(false);
  });

  it('validates authority enum values', () => {
    const result = BoundarySourceSchema.safeParse({
      ...VALID_SOURCE,
      authority: 'invalid-authority',
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid authority levels', () => {
    const authorities = [
      'constitutional', 'electoral-commission', 'national-statistics',
      'state-agency', 'municipal-agency', 'commercial', 'community',
    ];
    for (const authority of authorities) {
      const result = BoundarySourceSchema.safeParse({ ...VALID_SOURCE, authority });
      expect(result.success).toBe(true);
    }
  });

  it('accepts optional etag and lastModified', () => {
    const result = BoundarySourceSchema.safeParse({
      ...VALID_SOURCE,
      etag: '"abc123"',
      lastModified: 'Thu, 13 Mar 2026 00:00:00 GMT',
    });
    expect(result.success).toBe(true);
  });

  it('rejects vintage outside valid range', () => {
    const result = BoundarySourceSchema.safeParse({
      ...VALID_SOURCE,
      vintage: 1999,
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// InternationalBoundarySchema Tests
// ============================================================================

describe('InternationalBoundarySchema', () => {
  it('validates a complete boundary object', () => {
    const result = InternationalBoundarySchema.safeParse(VALID_BOUNDARY);
    expect(result.success).toBe(true);
  });

  it('rejects missing boundary id', () => {
    const result = InternationalBoundarySchema.safeParse({
      ...VALID_BOUNDARY,
      id: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing boundary name', () => {
    const result = InternationalBoundarySchema.safeParse({
      ...VALID_BOUNDARY,
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects boundary with null geometry', () => {
    const result = InternationalBoundarySchema.safeParse({
      ...VALID_BOUNDARY,
      geometry: null,
    });
    expect(result.success).toBe(false);
  });

  it('accepts boundary with MultiPolygon geometry', () => {
    const result = InternationalBoundarySchema.safeParse({
      ...VALID_BOUNDARY,
      geometry: VALID_MULTIPOLYGON,
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty properties record', () => {
    const result = InternationalBoundarySchema.safeParse({
      ...VALID_BOUNDARY,
      properties: {},
    });
    expect(result.success).toBe(true);
  });
});
