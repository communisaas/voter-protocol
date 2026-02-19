/**
 * Supplemental Overlay Tests
 *
 * Tests the general-purpose overlay engine with synthetic data:
 * - Blocks in a city get ward assignments via PIP
 * - Blocks outside ward boundaries are counted as unmatched
 * - Virtual cell splitting occurs when blocks in a tract disagree on slot 6
 */

import { describe, it, expect } from 'vitest';
import type { BlockRecord } from '../../hydration/baf-parser.js';
import type { CityWardBoundaries } from '../../hydration/ward-boundary-loader.js';
import type { TractCentroidIndex } from '../../hydration/tract-centroid-index.js';
import { overlaySupplementalDistricts } from '../../hydration/supplemental-overlay.js';

// ============================================================================
// Test Fixtures
// ============================================================================

function makeBlock(
  blockId: string,
  stateFips: string,
  tractGeoid: string,
  placeFips?: string,
): BlockRecord {
  const districts = new Map<number, string>();
  if (placeFips) districts.set(5, placeFips);
  return {
    blockId,
    stateFips,
    countyFips: blockId.slice(0, 5),
    tractGeoid,
    districts,
  };
}

// Simple square ward polygons for testing
// Ward 1: covers area around [-77.0, 38.9]
// Ward 2: covers area around [-77.0, 38.95]
const TEST_CITY_FIPS = '1100000';
const TEST_WARDS: CityWardBoundaries = {
  cityFips: TEST_CITY_FIPS,
  cityName: 'Test City',
  state: 'DC',
  wards: [
    {
      wardNumber: 1,
      wardGeoid: '110000001',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-77.1, 38.85], [-76.9, 38.85], [-76.9, 38.92],
          [-77.1, 38.92], [-77.1, 38.85],
        ]],
      },
      properties: {},
    },
    {
      wardNumber: 2,
      wardGeoid: '110000002',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-77.1, 38.92], [-76.9, 38.92], [-76.9, 39.0],
          [-77.1, 39.0], [-77.1, 38.92],
        ]],
      },
      properties: {},
    },
  ],
};

function makeCentroidIndex(centroids: Record<string, [number, number]>): TractCentroidIndex {
  const map = new Map(Object.entries(centroids));
  return {
    getCentroid: (geoid: string) => map.get(geoid),
    get size() { return map.size; },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('overlaySupplementalDistricts', () => {
  it('assigns ward GEOID to blocks in covered city (slot 6)', () => {
    const blocks = new Map<string, BlockRecord>();
    // Block in tract whose centroid falls in Ward 1
    blocks.set('110010001001001', makeBlock('110010001001001', '11', '11001000100', TEST_CITY_FIPS));

    const centroidIndex = makeCentroidIndex({
      '11001000100': [-77.0, 38.88], // Inside Ward 1
    });

    const result = overlaySupplementalDistricts(blocks, {
      slot: 6,
      boundaries: [TEST_WARDS],
      centroidIndex,
    });

    expect(result.totalUpdated).toBe(1);
    expect(result.unmatched).toBe(0);
    expect(blocks.get('110010001001001')!.districts.get(6)).toBe('110000001');
  });

  it('assigns different wards to blocks in different tracts', () => {
    const blocks = new Map<string, BlockRecord>();
    // Tract A centroid → Ward 1
    blocks.set('110010001001001', makeBlock('110010001001001', '11', '11001000100', TEST_CITY_FIPS));
    // Tract B centroid → Ward 2
    blocks.set('110010002001001', makeBlock('110010002001001', '11', '11001000200', TEST_CITY_FIPS));

    const centroidIndex = makeCentroidIndex({
      '11001000100': [-77.0, 38.88], // Ward 1
      '11001000200': [-77.0, 38.96], // Ward 2
    });

    const result = overlaySupplementalDistricts(blocks, {
      slot: 6,
      boundaries: [TEST_WARDS],
      centroidIndex,
    });

    expect(result.totalUpdated).toBe(2);
    expect(blocks.get('110010001001001')!.districts.get(6)).toBe('110000001');
    expect(blocks.get('110010002001001')!.districts.get(6)).toBe('110000002');
  });

  it('marks blocks as unmatched when centroid is outside all wards', () => {
    const blocks = new Map<string, BlockRecord>();
    blocks.set('110010003001001', makeBlock('110010003001001', '11', '11001000300', TEST_CITY_FIPS));

    const centroidIndex = makeCentroidIndex({
      '11001000300': [-78.0, 39.5], // Way outside both wards
    });

    const result = overlaySupplementalDistricts(blocks, {
      slot: 6,
      boundaries: [TEST_WARDS],
      centroidIndex,
    });

    expect(result.totalUpdated).toBe(0);
    expect(result.unmatched).toBe(1);
    expect(blocks.get('110010003001001')!.districts.has(6)).toBe(false);
  });

  it('skips blocks without city assignment (slot 5)', () => {
    const blocks = new Map<string, BlockRecord>();
    // No place FIPS → no city → skipped entirely
    blocks.set('110010001001001', makeBlock('110010001001001', '11', '11001000100'));

    const centroidIndex = makeCentroidIndex({
      '11001000100': [-77.0, 38.88],
    });

    const result = overlaySupplementalDistricts(blocks, {
      slot: 6,
      boundaries: [TEST_WARDS],
      centroidIndex,
    });

    expect(result.totalUpdated).toBe(0);
    expect(result.unmatched).toBe(0);
    expect(result.totalInCoveredCities).toBe(0);
  });

  it('skips blocks in cities without ward data', () => {
    const blocks = new Map<string, BlockRecord>();
    // City FIPS doesn't match any boundary set
    blocks.set('060010001001001', makeBlock('060010001001001', '06', '06001000100', '0600100'));

    const centroidIndex = makeCentroidIndex({
      '06001000100': [-122.0, 37.7],
    });

    const result = overlaySupplementalDistricts(blocks, {
      slot: 6,
      boundaries: [TEST_WARDS], // Only has DC city
      centroidIndex,
    });

    expect(result.totalUpdated).toBe(0);
    expect(result.totalInCoveredCities).toBe(0);
  });

  it('caches tract centroid PIP results across blocks in same tract', () => {
    const blocks = new Map<string, BlockRecord>();
    // Two blocks in the same tract
    blocks.set('110010001001001', makeBlock('110010001001001', '11', '11001000100', TEST_CITY_FIPS));
    blocks.set('110010001001002', makeBlock('110010001001002', '11', '11001000100', TEST_CITY_FIPS));

    let lookupCount = 0;
    const centroidIndex: TractCentroidIndex = {
      getCentroid(geoid: string) {
        lookupCount++;
        if (geoid === '11001000100') return [-77.0, 38.88];
        return undefined;
      },
      get size() { return 1; },
    };

    const result = overlaySupplementalDistricts(blocks, {
      slot: 6,
      boundaries: [TEST_WARDS],
      centroidIndex,
    });

    expect(result.totalUpdated).toBe(2);
    // Centroid should only be looked up once (cached for second block)
    expect(lookupCount).toBe(1);
  });

  it('computes correct coverage ratio', () => {
    const blocks = new Map<string, BlockRecord>();
    // 3 blocks: 2 in Ward 1, 1 unmatched
    blocks.set('110010001001001', makeBlock('110010001001001', '11', '11001000100', TEST_CITY_FIPS));
    blocks.set('110010001001002', makeBlock('110010001001002', '11', '11001000100', TEST_CITY_FIPS));
    blocks.set('110010003001001', makeBlock('110010003001001', '11', '11001000300', TEST_CITY_FIPS));

    const centroidIndex = makeCentroidIndex({
      '11001000100': [-77.0, 38.88],  // Ward 1
      '11001000300': [-78.0, 39.5],    // Outside
    });

    const result = overlaySupplementalDistricts(blocks, {
      slot: 6,
      boundaries: [TEST_WARDS],
      centroidIndex,
    });

    expect(result.totalUpdated).toBe(2);
    expect(result.unmatched).toBe(1);
    expect(result.totalInCoveredCities).toBe(3);
    expect(result.coverage).toBeCloseTo(2 / 3, 5);
  });

  it('works with any target slot (not just 6)', () => {
    const blocks = new Map<string, BlockRecord>();
    blocks.set('110010001001001', makeBlock('110010001001001', '11', '11001000100', TEST_CITY_FIPS));

    const centroidIndex = makeCentroidIndex({
      '11001000100': [-77.0, 38.88],
    });

    // Use slot 12 (fire district) instead of slot 6
    const result = overlaySupplementalDistricts(blocks, {
      slot: 12,
      boundaries: [TEST_WARDS],
      centroidIndex,
    });

    expect(result.totalUpdated).toBe(1);
    expect(blocks.get('110010001001001')!.districts.get(12)).toBe('110000001');
    expect(blocks.get('110010001001001')!.districts.has(6)).toBe(false);
  });
});
