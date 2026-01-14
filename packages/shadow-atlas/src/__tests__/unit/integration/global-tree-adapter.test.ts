/**
 * Global Tree Adapter Tests
 *
 * Comprehensive test suite for unified Merkle tree adapter that bridges
 * flat US-only trees with global hierarchical trees.
 *
 * COVERAGE:
 * - Single-country optimization (flat tree selection)
 * - Multi-country hierarchical tree construction
 * - Boundary conversion to global format
 * - Type discrimination (flat vs global)
 * - Edge cases (empty input, unknown countries)
 * - Determinism and consistency
 *
 * @module global-tree-adapter.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GlobalTreeAdapter } from '../../../integration/global-tree-adapter.js';
import type { GlobalTreeConfig } from '../../../integration/global-tree-adapter.js';
import { MultiLayerMerkleTreeBuilder } from '../../../core/multi-layer-builder.js';
import { GlobalMerkleTreeBuilder } from '../../../core/global-merkle-tree.js';
import type { MerkleBoundaryInput } from '../../../core/multi-layer-builder.js';
import { BoundaryType } from '../../../core/types/boundary.js';
import type { Polygon } from 'geojson';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create mock boundary for testing
 */
function createMockBoundary(
  id: string,
  type: BoundaryType,
  jurisdiction?: string
): MerkleBoundaryInput {
  const geometry: Polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ],
  };

  return {
    id,
    name: `Boundary ${id}`,
    boundaryType: type,
    geometry,
    jurisdiction,
    authority: 5, // FEDERAL_MANDATE level
    source: {
      url: 'https://test.example.com',
      timestamp: Date.now(),
      provider: 'test-provider',
      checksum: 'test-checksum',
    },
  };
}

/**
 * Create US congressional district boundaries
 */
function createUSCongressionalBoundaries(): MerkleBoundaryInput[] {
  return [
    // California districts (FIPS: 06)
    createMockBoundary('0601', BoundaryType.CONGRESSIONAL_DISTRICT, 'United States'),
    createMockBoundary('0602', BoundaryType.CONGRESSIONAL_DISTRICT, 'United States'),

    // New York districts (FIPS: 36)
    createMockBoundary('3601', BoundaryType.CONGRESSIONAL_DISTRICT, 'United States'),
    createMockBoundary('3602', BoundaryType.CONGRESSIONAL_DISTRICT, 'United States'),

    // Texas districts (FIPS: 48)
    createMockBoundary('4801', BoundaryType.CONGRESSIONAL_DISTRICT, 'United States'),
  ];
}

/**
 * Create multi-country boundaries
 */
function createMultiCountryBoundaries(): MerkleBoundaryInput[] {
  return [
    // US boundaries
    createMockBoundary('0601', BoundaryType.CONGRESSIONAL_DISTRICT, 'United States'),
    createMockBoundary('3601', BoundaryType.CONGRESSIONAL_DISTRICT, 'United States'),

    // UK boundaries (using custom ID format)
    createMockBoundary('gb-eng-lon-1', BoundaryType.CONGRESSIONAL_DISTRICT, 'United Kingdom'),
    createMockBoundary('gb-sct-edi-1', BoundaryType.CONGRESSIONAL_DISTRICT, 'United Kingdom'),

    // Canada boundaries
    createMockBoundary('ca-on-tor-1', BoundaryType.CONGRESSIONAL_DISTRICT, 'Canada'),
    createMockBoundary('ca-qc-mtl-1', BoundaryType.CONGRESSIONAL_DISTRICT, 'Canada'),
  ];
}

// ============================================================================
// Tests
// ============================================================================

describe('GlobalTreeAdapter', () => {
  let adapter: GlobalTreeAdapter;
  let flatBuilder: MultiLayerMerkleTreeBuilder;
  let globalBuilder: GlobalMerkleTreeBuilder;

  beforeEach(() => {
    flatBuilder = new MultiLayerMerkleTreeBuilder();
    globalBuilder = new GlobalMerkleTreeBuilder();
    adapter = new GlobalTreeAdapter(flatBuilder, globalBuilder);
  });

  describe('constructor', () => {
    it('should create adapter with builder dependencies', () => {
      expect(adapter).toBeDefined();
      expect(adapter).toBeInstanceOf(GlobalTreeAdapter);
    });
  });

  describe('convertBoundaries', () => {
    it('should convert US boundaries to global format', () => {
      const boundaries = createUSCongressionalBoundaries();
      const converted = adapter.convertBoundaries(boundaries, 'US');

      expect(converted).toHaveLength(boundaries.length);

      // Verify first boundary conversion
      const first = converted[0];
      expect(first.id).toBe('0601');
      expect(first.name).toBe('Boundary 0601');
      expect(first.countryISO).toBe('US');
      expect(first.region).toBe('CA'); // FIPS 06 → California
      expect(first.continent).toBe('americas');
      expect(first.boundaryType).toBe(BoundaryType.CONGRESSIONAL_DISTRICT);
      expect(first.authority).toBe('United States'); // Uses jurisdiction field
      expect(first.geometry).toBeDefined();
      expect(first.bbox).toHaveLength(4);
      expect(first.validFrom).toBeInstanceOf(Date);
    });

    it('should extract correct state codes from FIPS', () => {
      const boundaries = [
        createMockBoundary('0601', BoundaryType.CONGRESSIONAL_DISTRICT), // CA
        createMockBoundary('3601', BoundaryType.CONGRESSIONAL_DISTRICT), // NY
        createMockBoundary('4801', BoundaryType.CONGRESSIONAL_DISTRICT), // TX
      ];

      const converted = adapter.convertBoundaries(boundaries, 'US');

      expect(converted[0].region).toBe('CA');
      expect(converted[1].region).toBe('NY');
      expect(converted[2].region).toBe('TX');
    });

    it('should handle non-US countries', () => {
      const boundaries = [
        createMockBoundary('gb-eng-lon-1', BoundaryType.CONGRESSIONAL_DISTRICT),
      ];

      const converted = adapter.convertBoundaries(boundaries, 'GB');

      expect(converted[0].countryISO).toBe('GB');
      expect(converted[0].continent).toBe('europe');
      expect(converted[0].region).toBe('GB'); // Falls back to country code
    });

    it('should compute correct bounding boxes', () => {
      const boundaries = createUSCongressionalBoundaries();
      const converted = adapter.convertBoundaries(boundaries, 'US');

      for (const district of converted) {
        const [minLon, minLat, maxLon, maxLat] = district.bbox;

        expect(minLon).toBeLessThanOrEqual(maxLon);
        expect(minLat).toBeLessThanOrEqual(maxLat);
        expect(minLon).toBe(0); // Test fixture has [0,0] to [1,1]
        expect(maxLon).toBe(1);
      }
    });

    it('should include provenance metadata', () => {
      const boundaries = createUSCongressionalBoundaries();
      const converted = adapter.convertBoundaries(boundaries, 'US');

      const first = converted[0];
      expect(first.provenance).toBeDefined();
      expect(first.provenance.source).toBe('https://test.example.com');
      expect(first.provenance.authority).toBe('federal');
      expect(first.provenance.method).toBe('test-provider');
      expect(first.provenance.responseHash).toBe('test-checksum');
      expect(first.provenance.jurisdiction).toBe('United States'); // Uses jurisdiction field
      expect(first.provenance.httpStatus).toBe(200);
    });
  });

  describe('buildUnifiedTree - single country optimization', () => {
    it('should use flat tree for single US country', async () => {
      const boundaries = createUSCongressionalBoundaries();
      const config: GlobalTreeConfig = {
        countries: ['US'],
        useSingleCountryOptimization: true,
      };

      const result = await adapter.buildUnifiedTree(boundaries, config);

      expect(result.type).toBe('flat');
      expect(result).toHaveProperty('tree');

      if (result.type === 'flat') {
        expect(typeof result.tree.root).toBe('bigint');
        expect(result.tree.layerCounts).toBeDefined();
      }
    });

    it('should use flat tree when optimization enabled', async () => {
      const boundaries = createUSCongressionalBoundaries();
      const config: GlobalTreeConfig = {
        countries: ['US'],
        useSingleCountryOptimization: true,
      };

      const result = await adapter.buildUnifiedTree(boundaries, config);

      expect(result.type).toBe('flat');
    });

    it('should produce deterministic flat tree', async () => {
      const boundaries = createUSCongressionalBoundaries();
      const config: GlobalTreeConfig = {
        countries: ['US'],
        useSingleCountryOptimization: true,
      };

      const result1 = await adapter.buildUnifiedTree(boundaries, config);
      const result2 = await adapter.buildUnifiedTree(boundaries, config);

      expect(result1.type).toBe('flat');
      expect(result2.type).toBe('flat');

      if (result1.type === 'flat' && result2.type === 'flat') {
        expect(result1.tree.root).toBe(result2.tree.root);
      }
    });
  });

  describe('buildUnifiedTree - global hierarchical', () => {
    it('should use global tree for multiple countries', async () => {
      const boundaries = createMultiCountryBoundaries();
      const config: GlobalTreeConfig = {
        countries: ['US', 'GB', 'CA'],
        useSingleCountryOptimization: true, // Should be ignored
      };

      const result = await adapter.buildUnifiedTree(boundaries, config);

      expect(result.type).toBe('global');

      if (result.type === 'global') {
        expect(typeof result.tree.globalRoot).toBe('bigint');
        expect(result.tree.continents).toBeDefined();
        expect(Array.isArray(result.tree.continents)).toBe(true);
        expect(result.tree.totalDistricts).toBeGreaterThan(0);
      }
    });

    it('should use global tree when optimization disabled', async () => {
      const boundaries = createUSCongressionalBoundaries();
      const config: GlobalTreeConfig = {
        countries: ['US'],
        useSingleCountryOptimization: false,
      };

      const result = await adapter.buildUnifiedTree(boundaries, config);

      expect(result.type).toBe('global');
    });

    it('should handle multi-continental boundaries', async () => {
      const boundaries = createMultiCountryBoundaries();
      const config: GlobalTreeConfig = {
        countries: ['US', 'GB', 'CA'],
        useSingleCountryOptimization: false,
      };

      const result = await adapter.buildUnifiedTree(boundaries, config);

      expect(result.type).toBe('global');

      if (result.type === 'global') {
        // Should have Americas (US, CA) and/or Europe (GB)
        expect(result.tree.continents.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('should produce deterministic global tree', async () => {
      const boundaries = createMultiCountryBoundaries();
      const config: GlobalTreeConfig = {
        countries: ['US', 'GB', 'CA'],
        useSingleCountryOptimization: false,
      };

      const result1 = await adapter.buildUnifiedTree(boundaries, config);
      const result2 = await adapter.buildUnifiedTree(boundaries, config);

      expect(result1.type).toBe('global');
      expect(result2.type).toBe('global');

      if (result1.type === 'global' && result2.type === 'global') {
        expect(result1.tree.globalRoot).toBe(result2.tree.globalRoot);
      }
    });
  });

  describe('type discrimination', () => {
    it('should discriminate flat vs global trees correctly', async () => {
      const boundaries = createUSCongressionalBoundaries();

      const flatConfig: GlobalTreeConfig = {
        countries: ['US'],
        useSingleCountryOptimization: true,
      };

      const globalConfig: GlobalTreeConfig = {
        countries: ['US'],
        useSingleCountryOptimization: false,
      };

      const flatResult = await adapter.buildUnifiedTree(boundaries, flatConfig);
      const globalResult = await adapter.buildUnifiedTree(boundaries, globalConfig);

      // Type guards should work
      if (flatResult.type === 'flat') {
        expect(flatResult.tree.layerCounts).toBeDefined();
      } else {
        throw new Error('Expected flat tree');
      }

      if (globalResult.type === 'global') {
        expect(globalResult.tree.continents).toBeDefined();
      } else {
        throw new Error('Expected global tree');
      }
    });
  });

  describe('edge cases', () => {
    it('should handle boundaries with jurisdiction metadata', () => {
      const boundaries = [
        createMockBoundary('0601', BoundaryType.CONGRESSIONAL_DISTRICT, 'United States Congress'),
        createMockBoundary('gb-1', BoundaryType.CONGRESSIONAL_DISTRICT, 'UK Parliament'),
        createMockBoundary('ca-1', BoundaryType.CONGRESSIONAL_DISTRICT, 'Canada Federal'),
      ];

      const usConverted = adapter.convertBoundaries([boundaries[0]], 'US');
      const gbConverted = adapter.convertBoundaries([boundaries[1]], 'GB');
      const caConverted = adapter.convertBoundaries([boundaries[2]], 'CA');

      expect(usConverted[0].countryISO).toBe('US');
      expect(gbConverted[0].countryISO).toBe('GB');
      expect(caConverted[0].countryISO).toBe('CA');
    });

    it('should handle different boundary types', () => {
      const boundaries = [
        createMockBoundary('0601', BoundaryType.CONGRESSIONAL_DISTRICT),
        createMockBoundary('06001', BoundaryType.COUNTY),
        createMockBoundary('0601', BoundaryType.STATE_LEGISLATIVE_UPPER),
        createMockBoundary('0601', BoundaryType.CITY_COUNCIL_DISTRICT),
      ];

      const converted = adapter.convertBoundaries(boundaries, 'US');

      expect(converted[0].boundaryType).toBe(BoundaryType.CONGRESSIONAL_DISTRICT);
      expect(converted[1].boundaryType).toBe(BoundaryType.COUNTY);
      expect(converted[2].boundaryType).toBe(BoundaryType.STATE_LEGISLATIVE_UPPER);
      expect(converted[3].boundaryType).toBe(BoundaryType.CITY_COUNCIL_DISTRICT);
    });

    it('should handle unknown FIPS codes gracefully', () => {
      const boundaries = [
        createMockBoundary('9901', BoundaryType.CONGRESSIONAL_DISTRICT), // Invalid FIPS
      ];

      const converted = adapter.convertBoundaries(boundaries, 'US');

      expect(converted[0].region).toBe('UNKNOWN');
    });

    it('should handle unknown country codes', () => {
      const boundaries = [
        createMockBoundary('xx-01', BoundaryType.CONGRESSIONAL_DISTRICT),
      ];

      // Should default to americas for unknown countries
      const converted = adapter.convertBoundaries(boundaries, 'XX');

      expect(converted[0].countryISO).toBe('XX');
      expect(converted[0].continent).toBe('americas'); // Default fallback
    });

    it('should handle boundaries without source metadata', () => {
      const boundary: MerkleBoundaryInput = {
        id: '0601',
        name: 'Test District',
        boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0],
            ],
          ],
        },
        jurisdiction: 'Test',
        authority: 5,
        // No source field
      };

      const converted = adapter.convertBoundaries([boundary], 'US');

      expect(converted[0].provenance.source).toBe('unknown');
      expect(converted[0].provenance.method).toBe('unknown');
      expect(converted[0].provenance.responseHash).toBe('');
    });

    it('should handle MultiPolygon geometries', () => {
      const boundary: MerkleBoundaryInput = {
        id: '0601',
        name: 'Test District',
        boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
                [0, 0],
              ],
            ],
            [
              [
                [2, 2],
                [3, 2],
                [3, 3],
                [2, 3],
                [2, 2],
              ],
            ],
          ],
        },
        jurisdiction: 'Test',
        authority: 5,
      };

      const converted = adapter.convertBoundaries([boundary], 'US');

      expect(converted[0].geometry.type).toBe('MultiPolygon');
      expect(converted[0].bbox).toHaveLength(4);

      const [minLon, minLat, maxLon, maxLat] = converted[0].bbox;
      expect(minLon).toBe(0);
      expect(minLat).toBe(0);
      expect(maxLon).toBe(3);
      expect(maxLat).toBe(3);
    });
  });

  describe('continental region mapping', () => {
    it('should map major countries to correct continents', () => {
      const testCases = [
        { countryISO: 'US', expectedContinent: 'americas' },
        { countryISO: 'CA', expectedContinent: 'americas' },
        { countryISO: 'BR', expectedContinent: 'americas' },
        { countryISO: 'GB', expectedContinent: 'europe' },
        { countryISO: 'DE', expectedContinent: 'europe' },
        { countryISO: 'FR', expectedContinent: 'europe' },
        { countryISO: 'CN', expectedContinent: 'asia' },
        { countryISO: 'IN', expectedContinent: 'asia' },
        { countryISO: 'JP', expectedContinent: 'asia' },
        { countryISO: 'AU', expectedContinent: 'oceania' },
        { countryISO: 'NZ', expectedContinent: 'oceania' },
        { countryISO: 'ZA', expectedContinent: 'africa' },
        { countryISO: 'NG', expectedContinent: 'africa' },
      ];

      for (const { countryISO, expectedContinent } of testCases) {
        const boundaries = [createMockBoundary('test-01', BoundaryType.CONGRESSIONAL_DISTRICT)];
        const converted = adapter.convertBoundaries(boundaries, countryISO);

        expect(converted[0].continent).toBe(expectedContinent);
      }
    });
  });

  describe('consistency', () => {
    it('should produce same result for same input regardless of order', async () => {
      const boundaries = createUSCongressionalBoundaries();
      const config: GlobalTreeConfig = {
        countries: ['US'],
        useSingleCountryOptimization: true,
      };

      const result1 = await adapter.buildUnifiedTree(boundaries, config);
      const shuffled = [...boundaries].reverse();
      const result2 = await adapter.buildUnifiedTree(shuffled, config);

      if (result1.type === 'flat' && result2.type === 'flat') {
        expect(result1.tree.root).toBe(result2.tree.root);
      }
    });

    it('should handle repeated conversions consistently', () => {
      const boundaries = createUSCongressionalBoundaries();

      const converted1 = adapter.convertBoundaries(boundaries, 'US');
      const converted2 = adapter.convertBoundaries(boundaries, 'US');

      expect(converted1).toHaveLength(converted2.length);

      for (let i = 0; i < converted1.length; i++) {
        expect(converted1[i].id).toBe(converted2[i].id);
        expect(converted1[i].countryISO).toBe(converted2[i].countryISO);
        expect(converted1[i].region).toBe(converted2[i].region);
        expect(converted1[i].continent).toBe(converted2[i].continent);
      }
    });
  });
});
