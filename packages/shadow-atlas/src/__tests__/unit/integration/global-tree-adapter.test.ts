/**
 * GlobalTreeAdapter Unit Tests
 *
 * Tests for the global hierarchical tree adapter:
 * - build() returns flat tree for single country
 * - build() returns global tree for multiple countries
 * - convertBoundaries() correctly maps BoundaryType to GlobalBoundaryType
 * - extractCountryRoots() extracts all country roots
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Polygon, MultiPolygon } from 'geojson';
import { BoundaryType } from '../../../types/boundary.js';
import {
  GlobalTreeAdapter,
  extractCountryRoots,
  extractContinentalRoots,
} from '../../../integration/global-tree-adapter.js';
import type {
  GlobalMerkleTreeBuilder,
  GlobalMerkleTree,
  GlobalDistrictInput,
  CountryTree,
  ContinentalTree,
} from '../../../integration/global-merkle-tree.js';
import type { MerkleBoundaryInput } from '../../../core/multi-layer-builder.js';

/**
 * Create a mock polygon for testing
 */
function createMockPolygon(): Polygon {
  return {
    type: 'Polygon',
    coordinates: [[
      [-90.5, 43.0],
      [-90.0, 43.0],
      [-90.0, 43.5],
      [-90.5, 43.5],
      [-90.5, 43.0],
    ]],
  };
}

/**
 * Create a mock MerkleBoundaryInput
 */
function createMockBoundary(options: {
  id: string;
  name: string;
  boundaryType: BoundaryType;
  jurisdiction?: string;
  authority?: number;
}): MerkleBoundaryInput {
  return {
    id: options.id,
    name: options.name,
    boundaryType: options.boundaryType,
    geometry: createMockPolygon(),
    jurisdiction: options.jurisdiction,
    authority: (options.authority ?? 2) as 1 | 2 | 3 | 4 | 5,
  };
}

/**
 * Create a mock GlobalMerkleTreeBuilder
 */
function createMockGlobalBuilder(): GlobalMerkleTreeBuilder {
  return {
    build: vi.fn().mockResolvedValue({
      globalRoot: 123456789n,
      continents: [
        {
          continent: 'north_america',
          root: 111111n,
          countries: [
            {
              countryCode: 'US',
              countryName: 'United States',
              root: 222222n,
              regions: [],
              districtCount: 8,
            },
            {
              countryCode: 'CA',
              countryName: 'Canada',
              root: 333333n,
              regions: [],
              districtCount: 5,
            },
          ],
          districtCount: 13,
        },
        {
          continent: 'europe',
          root: 444444n,
          countries: [
            {
              countryCode: 'GB',
              countryName: 'United Kingdom',
              root: 555555n,
              regions: [],
              districtCount: 3,
            },
          ],
          districtCount: 3,
        },
      ],
      totalDistricts: 16,
      timestamp: new Date(),
      version: '1.0.0',
    } satisfies GlobalMerkleTree),
  } as unknown as GlobalMerkleTreeBuilder;
}

describe('GlobalTreeAdapter', () => {
  describe('convertBoundaries', () => {
    it('should extract US state FIPS from GEOID', () => {
      const mockBuilder = createMockGlobalBuilder();
      const adapter = new GlobalTreeAdapter(mockBuilder, {
        countries: ['US'],
        useSingleCountryOptimization: false,
      });

      const boundaries: readonly MerkleBoundaryInput[] = [
        createMockBoundary({
          id: '5501', // Wisconsin CD 1 (55 = WI FIPS)
          name: 'Congressional District 1',
          boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
        }),
        createMockBoundary({
          id: '0601', // California CD 1 (06 = CA FIPS)
          name: 'Congressional District 1',
          boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
        }),
      ];

      const converted = adapter.convertBoundaries(boundaries, 'US');

      expect(converted.length).toBe(2);
      expect(converted[0].region).toBe('55'); // Wisconsin FIPS
      expect(converted[1].region).toBe('06'); // California FIPS
    });

    it('should extract region from jurisdiction field', () => {
      const mockBuilder = createMockGlobalBuilder();
      const adapter = new GlobalTreeAdapter(mockBuilder, {
        countries: ['CA'],
        useSingleCountryOptimization: false,
      });

      const boundaries: readonly MerkleBoundaryInput[] = [
        createMockBoundary({
          id: 'ON-001',
          name: 'Toronto-Danforth',
          boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
          jurisdiction: 'Ontario, Canada',
        }),
        createMockBoundary({
          id: 'BC-001',
          name: 'Vancouver Centre',
          boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
          jurisdiction: 'British Columbia, Canada',
        }),
      ];

      const converted = adapter.convertBoundaries(boundaries, 'CA');

      expect(converted[0].region).toBe('Ontario');
      expect(converted[1].region).toBe('British Columbia');
    });

    it('should fallback to country code when no region info', () => {
      const mockBuilder = createMockGlobalBuilder();
      const adapter = new GlobalTreeAdapter(mockBuilder, {
        countries: ['GB'],
        useSingleCountryOptimization: false,
      });

      const boundaries: readonly MerkleBoundaryInput[] = [
        createMockBoundary({
          id: 'X', // Too short for FIPS extraction
          name: 'Westminster',
          boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
          // No jurisdiction
        }),
      ];

      const converted = adapter.convertBoundaries(boundaries, 'GB');

      expect(converted[0].region).toBe('GB'); // Falls back to country code
    });

    it('should map BoundaryType to GlobalBoundaryType correctly', () => {
      const mockBuilder = createMockGlobalBuilder();
      const adapter = new GlobalTreeAdapter(mockBuilder, {
        countries: ['US'],
        useSingleCountryOptimization: false,
      });

      const boundaries: readonly MerkleBoundaryInput[] = [
        createMockBoundary({
          id: '5501',
          name: 'CD 1',
          boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
        }),
        createMockBoundary({
          id: '5502',
          name: 'Senate District 1',
          boundaryType: BoundaryType.STATE_LEGISLATIVE_UPPER,
        }),
        createMockBoundary({
          id: '5503',
          name: 'Assembly District 1',
          boundaryType: BoundaryType.STATE_LEGISLATIVE_LOWER,
        }),
        createMockBoundary({
          id: '55001',
          name: 'Adams County',
          boundaryType: BoundaryType.COUNTY,
        }),
      ];

      const converted = adapter.convertBoundaries(boundaries, 'US');

      expect(converted[0].boundaryType).toBe(BoundaryType.CONGRESSIONAL_DISTRICT);
      expect(converted[1].boundaryType).toBe(BoundaryType.STATE_LEGISLATIVE_UPPER);
      expect(converted[2].boundaryType).toBe(BoundaryType.STATE_LEGISLATIVE_LOWER);
      expect(converted[3].boundaryType).toBe(BoundaryType.COUNTY);
    });

    it('should set country code to uppercase', () => {
      const mockBuilder = createMockGlobalBuilder();
      const adapter = new GlobalTreeAdapter(mockBuilder, {
        countries: ['us'],
        useSingleCountryOptimization: false,
      });

      const boundaries: readonly MerkleBoundaryInput[] = [
        createMockBoundary({
          id: '5501',
          name: 'CD 1',
          boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
        }),
      ];

      const converted = adapter.convertBoundaries(boundaries, 'us');

      expect(converted[0].country).toBe('US');
    });

    it('should preserve authority level', () => {
      const mockBuilder = createMockGlobalBuilder();
      const adapter = new GlobalTreeAdapter(mockBuilder, {
        countries: ['US'],
        useSingleCountryOptimization: false,
      });

      const boundaries: readonly MerkleBoundaryInput[] = [
        createMockBoundary({
          id: '5501',
          name: 'CD 1',
          boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
          authority: 4, // Federal
        }),
        createMockBoundary({
          id: '55001',
          name: 'Adams County',
          boundaryType: BoundaryType.COUNTY,
          authority: 3, // State
        }),
      ];

      const converted = adapter.convertBoundaries(boundaries, 'US');

      expect(converted[0].authority).toBe(4);
      expect(converted[1].authority).toBe(3);
    });
  });

  describe('build', () => {
    it('should return flat tree for single country with optimization enabled', async () => {
      const mockBuilder = createMockGlobalBuilder();
      const adapter = new GlobalTreeAdapter(mockBuilder, {
        countries: ['US'], // Single country
        useSingleCountryOptimization: true, // Optimization enabled
      });

      const boundaries: readonly MerkleBoundaryInput[] = [
        createMockBoundary({
          id: '5501',
          name: 'CD 1',
          boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
        }),
        createMockBoundary({
          id: '5502',
          name: 'CD 2',
          boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
        }),
      ];

      const result = await adapter.build(boundaries, 'US');

      expect(result.type).toBe('flat');
      // Global builder should NOT be called for flat builds
      expect(mockBuilder.build).not.toHaveBeenCalled();
    });

    it('should return global tree for multiple countries', async () => {
      const mockBuilder = createMockGlobalBuilder();
      const adapter = new GlobalTreeAdapter(mockBuilder, {
        countries: ['US', 'CA'], // Multiple countries
        useSingleCountryOptimization: true,
      });

      const boundaries: readonly MerkleBoundaryInput[] = [
        createMockBoundary({
          id: '5501',
          name: 'CD 1',
          boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
        }),
      ];

      const result = await adapter.build(boundaries, 'US');

      expect(result.type).toBe('global');
      expect(mockBuilder.build).toHaveBeenCalled();

      if (result.type === 'global') {
        expect(result.tree.globalRoot).toBe(123456789n);
      }
    });

    it('should return global tree when optimization disabled', async () => {
      const mockBuilder = createMockGlobalBuilder();
      const adapter = new GlobalTreeAdapter(mockBuilder, {
        countries: ['US'], // Single country
        useSingleCountryOptimization: false, // Optimization disabled
      });

      const boundaries: readonly MerkleBoundaryInput[] = [
        createMockBoundary({
          id: '5501',
          name: 'CD 1',
          boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
        }),
      ];

      const result = await adapter.build(boundaries, 'US');

      expect(result.type).toBe('global');
      expect(mockBuilder.build).toHaveBeenCalled();
    });

    it('should pass converted boundaries to global builder', async () => {
      const mockBuilder = createMockGlobalBuilder();
      const adapter = new GlobalTreeAdapter(mockBuilder, {
        countries: ['US', 'CA'],
        useSingleCountryOptimization: true,
      });

      const boundaries: readonly MerkleBoundaryInput[] = [
        createMockBoundary({
          id: '5501',
          name: 'Wisconsin CD 1',
          boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
        }),
        createMockBoundary({
          id: '0601',
          name: 'California CD 1',
          boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
        }),
      ];

      await adapter.build(boundaries, 'US');

      expect(mockBuilder.build).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: '5501',
            country: 'US',
            region: '55',
            boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
          }),
          expect.objectContaining({
            id: '0601',
            country: 'US',
            region: '06',
          }),
        ])
      );
    });
  });

  describe('extractCountryRoots', () => {
    it('should extract all country roots from global tree', () => {
      const mockTree: GlobalMerkleTree = {
        globalRoot: 123456789n,
        continents: [
          {
            continent: 'north_america',
            root: 111111n,
            countries: [
              {
                countryCode: 'US',
                countryName: 'United States',
                root: 222222n,
                regions: [],
                districtCount: 8,
              },
              {
                countryCode: 'CA',
                countryName: 'Canada',
                root: 333333n,
                regions: [],
                districtCount: 5,
              },
            ],
            districtCount: 13,
          },
          {
            continent: 'europe',
            root: 444444n,
            countries: [
              {
                countryCode: 'GB',
                countryName: 'United Kingdom',
                root: 555555n,
                regions: [],
                districtCount: 3,
              },
            ],
            districtCount: 3,
          },
        ],
        totalDistricts: 16,
        timestamp: new Date(),
        version: '1.0.0',
      };

      const roots = extractCountryRoots(mockTree);

      expect(roots.size).toBe(3);
      expect(roots.get('US')).toBe(222222n);
      expect(roots.get('CA')).toBe(333333n);
      expect(roots.get('GB')).toBe(555555n);
    });

    it('should return empty map for tree with no countries', () => {
      const mockTree: GlobalMerkleTree = {
        globalRoot: 0n,
        continents: [],
        totalDistricts: 0,
        timestamp: new Date(),
        version: '1.0.0',
      };

      const roots = extractCountryRoots(mockTree);

      expect(roots.size).toBe(0);
    });
  });

  describe('extractContinentalRoots', () => {
    it('should extract all continental roots from global tree', () => {
      const mockTree: GlobalMerkleTree = {
        globalRoot: 123456789n,
        continents: [
          {
            continent: 'north_america',
            root: 111111n,
            countries: [],
            districtCount: 10,
          },
          {
            continent: 'europe',
            root: 222222n,
            countries: [],
            districtCount: 5,
          },
          {
            continent: 'asia',
            root: 333333n,
            countries: [],
            districtCount: 3,
          },
        ],
        totalDistricts: 18,
        timestamp: new Date(),
        version: '1.0.0',
      };

      const roots = extractContinentalRoots(mockTree);

      expect(roots.size).toBe(3);
      expect(roots.get('north_america')).toBe(111111n);
      expect(roots.get('europe')).toBe(222222n);
      expect(roots.get('asia')).toBe(333333n);
    });

    it('should return empty map for tree with no continents', () => {
      const mockTree: GlobalMerkleTree = {
        globalRoot: 0n,
        continents: [],
        totalDistricts: 0,
        timestamp: new Date(),
        version: '1.0.0',
      };

      const roots = extractContinentalRoots(mockTree);

      expect(roots.size).toBe(0);
    });
  });

  describe('flat tree grouping', () => {
    it('should group boundaries by type for flat tree', async () => {
      const mockBuilder = createMockGlobalBuilder();
      const adapter = new GlobalTreeAdapter(mockBuilder, {
        countries: ['US'],
        useSingleCountryOptimization: true,
      });

      // Mix of different boundary types
      const boundaries: readonly MerkleBoundaryInput[] = [
        createMockBoundary({
          id: '5501',
          name: 'CD 1',
          boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
        }),
        createMockBoundary({
          id: '5502',
          name: 'CD 2',
          boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
        }),
        createMockBoundary({
          id: '55001',
          name: 'Adams County',
          boundaryType: BoundaryType.COUNTY,
        }),
        createMockBoundary({
          id: '55SD1',
          name: 'Senate District 1',
          boundaryType: BoundaryType.STATE_LEGISLATIVE_UPPER,
        }),
      ];

      const result = await adapter.build(boundaries, 'US');

      // Should be flat for single country with optimization
      expect(result.type).toBe('flat');

      if (result.type === 'flat') {
        // Verify the flat tree was built with grouped layers
        expect(result.tree).toBeDefined();
      }
    });
  });
});
