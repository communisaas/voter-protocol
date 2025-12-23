/**
 * State Batch to Merkle Integration Tests
 *
 * Tests the complete pipeline from state GIS extraction to merkle tree commitment.
 * Uses REAL data from Wisconsin LTSB to validate the integration.
 *
 * CRITICAL TESTS:
 * - Boundary metadata preservation through pipeline
 * - Deterministic merkle root computation
 * - Authority resolution application
 * - Incremental update correctness
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { StateExtractionResult, ExtractedBoundary } from '../providers/state-batch-extractor.js';
import { StateBatchExtractor } from '../providers/state-batch-extractor.js';
import {
  integrateStateExtractionResult,
  integrateMultipleStates,
  incrementalUpdate,
  extractedBoundaryToNormalizedDistrict,
  quickIntegrateState,
} from '../../../integration/state-batch-to-merkle.js';
import { MerkleTreeBuilder } from '../transformation/merkle-builder.js';

// ============================================================================
// Test Data Setup
// ============================================================================

describe('State Batch to Merkle Integration', () => {
  let wisconsinData: StateExtractionResult | null = null;
  let extractor: StateBatchExtractor;

  beforeAll(async () => {
    extractor = new StateBatchExtractor();

    // Extract REAL Wisconsin data for testing
    // NOTE: This makes a live API call to Wisconsin LTSB
    try {
      console.log('Extracting REAL Wisconsin data...');
      wisconsinData = await extractor.extractState('WI');
      console.log(`  ✓ Extracted ${wisconsinData.summary.totalBoundaries} boundaries`);
    } catch (error) {
      console.warn('Could not extract Wisconsin data (API may be unavailable):',
                   error instanceof Error ? error.message : String(error));
      // Tests will skip if data unavailable
    }
  }, 60000); // 60 second timeout for API calls

  // ==========================================================================
  // Format Conversion Tests
  // ==========================================================================

  describe('Format Conversion', () => {
    it('should convert ExtractedBoundary to NormalizedDistrict', () => {
      // Mock boundary (matches Wisconsin structure)
      const mockBoundary: ExtractedBoundary = {
        id: '5501',
        name: 'Congressional District 1',
        layerType: 'congressional',
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-88.0, 42.5],
            [-88.0, 43.0],
            [-87.5, 43.0],
            [-87.5, 42.5],
            [-88.0, 42.5],
          ]],
        },
        source: {
          state: 'WI',
          portalName: 'Wisconsin',
          endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/13',
          authority: 'state-gis',
          vintage: 2024,
          retrievedAt: new Date('2024-01-15').toISOString(),
        },
        properties: {
          GEOID: '5501',
          NAMELSAD: 'Congressional District 1',
        },
      };

      const normalized = extractedBoundaryToNormalizedDistrict(mockBoundary);

      // Verify all fields mapped correctly
      expect(normalized.id).toBe('5501');
      expect(normalized.name).toBe('Congressional District 1');
      expect(normalized.jurisdiction).toBe('USA/WI/Congressional District 1');
      expect(normalized.districtType).toBe('municipal');
      expect(normalized.geometry.type).toBe('Polygon');
      expect(normalized.bbox).toHaveLength(4);

      // Verify bounding box computed correctly
      const [minLon, minLat, maxLon, maxLat] = normalized.bbox;
      expect(minLon).toBe(-88.0);
      expect(minLat).toBe(42.5);
      expect(maxLon).toBe(-87.5);
      expect(maxLat).toBe(43.0);

      // Verify provenance metadata
      expect(normalized.provenance.source).toBe(mockBoundary.source.endpoint);
      expect(normalized.provenance.authority).toBe('state-gis');
      expect(normalized.provenance.coordinateSystem).toBe('EPSG:4326');
      expect(normalized.provenance.geometryType).toBe('Polygon');
    });

    it('should handle MultiPolygon geometries', () => {
      const mockBoundary: ExtractedBoundary = {
        id: '5508',
        name: 'Congressional District 8',
        layerType: 'congressional',
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [[
              [-90.0, 45.0],
              [-90.0, 46.0],
              [-89.0, 46.0],
              [-89.0, 45.0],
              [-90.0, 45.0],
            ]],
            [[
              [-91.0, 45.5],
              [-91.0, 46.5],
              [-90.5, 46.5],
              [-90.5, 45.5],
              [-91.0, 45.5],
            ]],
          ],
        },
        source: {
          state: 'WI',
          portalName: 'Wisconsin',
          endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/13',
          authority: 'state-gis',
          vintage: 2024,
          retrievedAt: new Date().toISOString(),
        },
        properties: {},
      };

      const normalized = extractedBoundaryToNormalizedDistrict(mockBoundary);

      expect(normalized.geometry.type).toBe('MultiPolygon');
      expect(normalized.provenance.geometryType).toBe('MultiPolygon');

      // Verify bounding box covers both polygons
      const [minLon, minLat, maxLon, maxLat] = normalized.bbox;
      expect(minLon).toBe(-91.0);
      expect(minLat).toBe(45.0);
      expect(maxLon).toBe(-89.0);
      expect(maxLat).toBe(46.5);
    });
  });

  // ==========================================================================
  // Single State Integration Tests
  // ==========================================================================

  describe('Single State Integration', () => {
    it('should integrate Wisconsin extraction into merkle tree', () => {
      if (!wisconsinData) {
        console.warn('Skipping test: Wisconsin data not available');
        return;
      }

      const result = integrateStateExtractionResult(wisconsinData, {
        applyAuthorityResolution: false, // Skip resolution for basic test
      });

      // Verify merkle tree created
      expect(result.merkleTree).toBeDefined();
      expect(result.merkleTree.root).toMatch(/^0x[0-9a-f]+$/); // Hex hash
      expect(result.merkleTree.districts.length).toBeGreaterThan(0);

      // Verify statistics
      expect(result.stats.totalBoundaries).toBe(wisconsinData.summary.totalBoundaries);
      expect(result.stats.includedBoundaries).toBe(wisconsinData.summary.totalBoundaries);
      expect(result.stats.deduplicatedBoundaries).toBe(0); // No duplicates without resolution

      // Verify metadata
      expect(result.metadata.processedAt).toBeInstanceOf(Date);
      expect(result.metadata.durationMs).toBeGreaterThan(0);
      expect(result.metadata.config.applyAuthorityResolution).toBe(false);

      console.log(`  ✓ Merkle root: ${result.merkleTree.root}`);
      console.log(`  ✓ Tree depth: ${result.merkleTree.tree.length}`);
      console.log(`  ✓ Included boundaries: ${result.stats.includedBoundaries}`);
    });

    it('should preserve boundary metadata through pipeline', () => {
      if (!wisconsinData) {
        console.warn('Skipping test: Wisconsin data not available');
        return;
      }

      const result = integrateStateExtractionResult(wisconsinData);

      // Verify districts match source data
      const originalBoundaries = wisconsinData.layers.flatMap(l => l.boundaries);
      const merkleDistricts = result.merkleTree.districts;

      // Check that all IDs are preserved
      const originalIds = new Set(originalBoundaries.map(b => b.id));
      const merkleIds = new Set(merkleDistricts.map(d => d.id));

      for (const id of originalIds) {
        expect(merkleIds.has(id)).toBe(true);
      }

      // Verify first district metadata
      const firstOriginal = originalBoundaries[0];
      const firstMerkle = merkleDistricts.find(d => d.id === firstOriginal.id);

      if (firstMerkle) {
        expect(firstMerkle.name).toBe(firstOriginal.name);
        expect(firstMerkle.geometry.type).toBe(firstOriginal.geometry.type);
        expect(firstMerkle.provenance.source).toBe(firstOriginal.source.endpoint);
      }
    });

    it('should produce deterministic merkle roots', () => {
      if (!wisconsinData) {
        console.warn('Skipping test: Wisconsin data not available');
        return;
      }

      // Integrate same data twice
      const result1 = integrateStateExtractionResult(wisconsinData, {
        applyAuthorityResolution: false,
      });
      const result2 = integrateStateExtractionResult(wisconsinData, {
        applyAuthorityResolution: false,
      });

      // Merkle roots must be identical
      expect(result1.merkleTree.root).toBe(result2.merkleTree.root);

      // Verify all hashes match
      expect(result1.merkleTree.leaves).toEqual(result2.merkleTree.leaves);
      expect(result1.merkleTree.tree).toEqual(result2.merkleTree.tree);

      console.log(`  ✓ Deterministic root: ${result1.merkleTree.root}`);
    });

    it('should apply authority resolution when enabled', () => {
      if (!wisconsinData) {
        console.warn('Skipping test: Wisconsin data not available');
        return;
      }

      const result = integrateStateExtractionResult(wisconsinData, {
        applyAuthorityResolution: true,
        resolutionDate: new Date('2024-01-15'),
      });

      // Authority decisions should be recorded
      expect(result.authorityDecisions.size).toBeGreaterThan(0);

      // Verify decision structure
      for (const [layerType, decision] of result.authorityDecisions) {
        expect(decision.boundary).toBeDefined();
        expect(decision.authority).toBeGreaterThanOrEqual(0);
        expect(decision.preference).toBeGreaterThanOrEqual(1);
        expect(decision.confidence).toBeGreaterThanOrEqual(0);
        expect(decision.confidence).toBeLessThanOrEqual(1);
        expect(decision.reasoning).toBeDefined();

        console.log(`  ✓ ${layerType}: ${decision.reasoning}`);
      }
    });
  });

  // ==========================================================================
  // Multi-State Integration Tests
  // ==========================================================================

  describe('Multi-State Integration', () => {
    it('should integrate multiple states into single merkle tree', async () => {
      // Create mock multi-state data
      const mockStates: StateExtractionResult[] = [
        {
          state: 'WI',
          stateName: 'Wisconsin',
          authority: 'state-redistricting-commission',
          layers: [
            {
              state: 'WI',
              layerType: 'congressional',
              success: true,
              featureCount: 8,
              expectedCount: 8,
              boundaries: createMockBoundaries('WI', 'congressional', 8),
              metadata: {
                endpoint: 'https://example.com/wi',
                extractedAt: new Date().toISOString(),
                durationMs: 1000,
              },
            },
          ],
          summary: {
            totalBoundaries: 8,
            layersSucceeded: 1,
            layersFailed: 0,
            durationMs: 1000,
          },
        },
        {
          state: 'TX',
          stateName: 'Texas',
          authority: 'state-gis',
          layers: [
            {
              state: 'TX',
              layerType: 'congressional',
              success: true,
              featureCount: 38,
              expectedCount: 38,
              boundaries: createMockBoundaries('TX', 'congressional', 38),
              metadata: {
                endpoint: 'https://example.com/tx',
                extractedAt: new Date().toISOString(),
                durationMs: 2000,
              },
            },
          ],
          summary: {
            totalBoundaries: 38,
            layersSucceeded: 1,
            layersFailed: 0,
            durationMs: 2000,
          },
        },
      ];

      const result = integrateMultipleStates(mockStates, {
        applyAuthorityResolution: true,
      });

      // Verify combined merkle tree
      expect(result.merkleTree.districts.length).toBe(46); // 8 WI + 38 TX
      expect(result.stats.totalBoundaries).toBe(46);
      expect(result.stats.includedBoundaries).toBe(46);

      // Verify authority decisions recorded for each state
      expect(result.authorityDecisions.size).toBeGreaterThan(0);

      console.log(`  ✓ Multi-state merkle root: ${result.merkleTree.root}`);
      console.log(`  ✓ Total districts: ${result.merkleTree.districts.length}`);
    });

    it('should deduplicate boundaries across states', () => {
      // Create mock data with duplicate boundary IDs
      const mockStates: StateExtractionResult[] = [
        {
          state: 'WI',
          stateName: 'Wisconsin',
          authority: undefined,
          layers: [
            {
              state: 'WI',
              layerType: 'congressional',
              success: true,
              featureCount: 2,
              expectedCount: 2,
              boundaries: [
                createMockBoundary('WI', 'congressional', '5501'),
                createMockBoundary('WI', 'congressional', '5502'),
              ],
              metadata: {
                endpoint: 'https://example.com/wi',
                extractedAt: new Date().toISOString(),
                durationMs: 1000,
              },
            },
          ],
          summary: {
            totalBoundaries: 2,
            layersSucceeded: 1,
            layersFailed: 0,
            durationMs: 1000,
          },
        },
        {
          state: 'WI',
          stateName: 'Wisconsin (duplicate source)',
          authority: undefined,
          layers: [
            {
              state: 'WI',
              layerType: 'congressional',
              success: true,
              featureCount: 2,
              expectedCount: 2,
              boundaries: [
                createMockBoundary('WI', 'congressional', '5501'), // Duplicate ID
                createMockBoundary('WI', 'congressional', '5503'),
              ],
              metadata: {
                endpoint: 'https://example.com/wi2',
                extractedAt: new Date().toISOString(),
                durationMs: 1000,
              },
            },
          ],
          summary: {
            totalBoundaries: 2,
            layersSucceeded: 1,
            layersFailed: 0,
            durationMs: 1000,
          },
        },
      ];

      const result = integrateMultipleStates(mockStates, {
        applyAuthorityResolution: false,
      });

      // Should deduplicate: 4 total, 3 unique (5501 appears twice)
      expect(result.stats.totalBoundaries).toBe(4);
      expect(result.stats.includedBoundaries).toBe(3);
      expect(result.stats.deduplicatedBoundaries).toBe(1);

      // Verify unique IDs in tree
      const ids = result.merkleTree.districts.map(d => d.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);
      expect(uniqueIds.has('5501')).toBe(true);
      expect(uniqueIds.has('5502')).toBe(true);
      expect(uniqueIds.has('5503')).toBe(true);
    });
  });

  // ==========================================================================
  // Incremental Update Tests
  // ==========================================================================

  describe('Incremental Updates', () => {
    it('should add new boundaries to existing tree', () => {
      // Create initial tree with 2 boundaries
      const initial = integrateStateExtractionResult({
        state: 'WI',
        stateName: 'Wisconsin',
        authority: undefined,
        layers: [
          {
            state: 'WI',
            layerType: 'congressional',
            success: true,
            featureCount: 2,
            expectedCount: 8,
            boundaries: createMockBoundaries('WI', 'congressional', 2),
            metadata: {
              endpoint: 'https://example.com/wi',
              extractedAt: new Date().toISOString(),
              durationMs: 1000,
            },
          },
        ],
        summary: {
          totalBoundaries: 2,
          layersSucceeded: 1,
          layersFailed: 0,
          durationMs: 1000,
        },
      });

      // Add 3 new boundaries
      const newBoundaries = createMockBoundaries('WI', 'congressional', 3, 3); // Start at ID 3

      const update = incrementalUpdate(initial.merkleTree, newBoundaries, {
        applyAuthorityResolution: false,
      });

      // Verify update
      expect(update.stats.previousBoundaries).toBe(2);
      expect(update.stats.newBoundaries).toBe(3);
      expect(update.stats.totalBoundaries).toBe(5);
      expect(update.rootChanged).toBe(true);
      expect(update.previousRoot).toBe(initial.merkleTree.root);
      expect(update.merkleTree.root).not.toBe(initial.merkleTree.root);

      console.log(`  ✓ Previous root: ${update.previousRoot}`);
      console.log(`  ✓ New root: ${update.merkleTree.root}`);
    });

    it('should not change root when adding duplicate boundaries', () => {
      // Create initial tree
      const initial = integrateStateExtractionResult({
        state: 'WI',
        stateName: 'Wisconsin',
        authority: undefined,
        layers: [
          {
            state: 'WI',
            layerType: 'congressional',
            success: true,
            featureCount: 2,
            expectedCount: 2,
            boundaries: createMockBoundaries('WI', 'congressional', 2),
            metadata: {
              endpoint: 'https://example.com/wi',
              extractedAt: new Date().toISOString(),
              durationMs: 1000,
            },
          },
        ],
        summary: {
          totalBoundaries: 2,
          layersSucceeded: 1,
          layersFailed: 0,
          durationMs: 1000,
        },
      });

      // Try to add same boundaries again
      const duplicates = createMockBoundaries('WI', 'congressional', 2);

      const update = incrementalUpdate(initial.merkleTree, duplicates, {
        applyAuthorityResolution: false,
      });

      // No new boundaries added
      expect(update.stats.newBoundaries).toBe(0);
      expect(update.stats.totalBoundaries).toBe(2);
      expect(update.rootChanged).toBe(false);
      expect(update.merkleTree.root).toBe(initial.merkleTree.root);
    });
  });

  // ==========================================================================
  // Merkle Proof Tests
  // ==========================================================================

  describe('Merkle Proof Generation', () => {
    it('should generate valid merkle proofs for all boundaries', () => {
      if (!wisconsinData) {
        console.warn('Skipping test: Wisconsin data not available');
        return;
      }

      const result = integrateStateExtractionResult(wisconsinData);
      const builder = new MerkleTreeBuilder();

      // Generate proofs for all districts
      const allProofs = builder.generateAllProofs(result.merkleTree);

      expect(allProofs.length).toBe(result.merkleTree.districts.length);

      // Verify all proofs
      const allValid = builder.verifyAllProofs(allProofs);
      expect(allValid).toBe(true);

      console.log(`  ✓ Generated ${allProofs.length} valid proofs`);
    });

    it('should verify individual merkle proofs', () => {
      const mockData: StateExtractionResult = {
        state: 'WI',
        stateName: 'Wisconsin',
        authority: undefined,
        layers: [
          {
            state: 'WI',
            layerType: 'congressional',
            success: true,
            featureCount: 4,
            expectedCount: 4,
            boundaries: createMockBoundaries('WI', 'congressional', 4),
            metadata: {
              endpoint: 'https://example.com/wi',
              extractedAt: new Date().toISOString(),
              durationMs: 1000,
            },
          },
        ],
        summary: {
          totalBoundaries: 4,
          layersSucceeded: 1,
          layersFailed: 0,
          durationMs: 1000,
        },
      };

      const result = integrateStateExtractionResult(mockData);
      const builder = new MerkleTreeBuilder();

      // Generate proof for first district
      const firstDistrict = result.merkleTree.districts[0];
      const proof = builder.generateProof(result.merkleTree, firstDistrict.id);

      // Verify proof
      expect(proof.districtId).toBe(firstDistrict.id);
      expect(proof.root).toBe(result.merkleTree.root);
      expect(builder.verifyProof(proof)).toBe(true);

      console.log(`  ✓ Verified proof for district: ${firstDistrict.id}`);
      console.log(`  ✓ Proof siblings: ${proof.siblings.length}`);
    });
  });

  // ==========================================================================
  // Quick Integration Convenience Tests
  // ==========================================================================

  describe('Convenience Functions', () => {
    it('should provide quick integration for single state', () => {
      const mockData: StateExtractionResult = {
        state: 'WI',
        stateName: 'Wisconsin',
        authority: undefined,
        layers: [
          {
            state: 'WI',
            layerType: 'congressional',
            success: true,
            featureCount: 2,
            expectedCount: 2,
            boundaries: createMockBoundaries('WI', 'congressional', 2),
            metadata: {
              endpoint: 'https://example.com/wi',
              extractedAt: new Date().toISOString(),
              durationMs: 1000,
            },
          },
        ],
        summary: {
          totalBoundaries: 2,
          layersSucceeded: 1,
          layersFailed: 0,
          durationMs: 1000,
        },
      };

      const tree = quickIntegrateState(mockData);

      expect(tree.root).toMatch(/^0x[0-9a-f]+$/);
      expect(tree.districts.length).toBe(2);
    });
  });
});

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create mock boundaries for testing
 */
function createMockBoundaries(
  state: string,
  layerType: 'congressional' | 'state_senate' | 'state_house' | 'county',
  count: number,
  startIndex: number = 1
): ExtractedBoundary[] {
  const boundaries: ExtractedBoundary[] = [];
  const stateFips = state === 'WI' ? '55' : state === 'TX' ? '48' : '00';

  for (let i = 0; i < count; i++) {
    const districtNum = (startIndex + i).toString().padStart(2, '0');
    const geoid = `${stateFips}${districtNum}`;

    boundaries.push(createMockBoundary(state, layerType, geoid, startIndex + i));
  }

  return boundaries;
}

/**
 * Create single mock boundary
 */
function createMockBoundary(
  state: string,
  layerType: 'congressional' | 'state_senate' | 'state_house' | 'county',
  geoid: string,
  districtNum?: number
): ExtractedBoundary {
  const num = districtNum ?? parseInt(geoid.slice(-2), 10);

  // Create simple polygon centered around different coordinates for each district
  const baseLon = -90.0 + (num * 0.5);
  const baseLat = 43.0 + (num * 0.3);

  return {
    id: geoid,
    name: `${layerType === 'congressional' ? 'Congressional' : 'Legislative'} District ${num}`,
    layerType,
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [baseLon, baseLat],
        [baseLon, baseLat + 0.5],
        [baseLon + 0.5, baseLat + 0.5],
        [baseLon + 0.5, baseLat],
        [baseLon, baseLat],
      ]],
    },
    source: {
      state,
      portalName: `${state} Portal`,
      endpoint: `https://example.com/${state.toLowerCase()}`,
      authority: 'state-gis',
      vintage: 2024,
      retrievedAt: new Date('2024-01-15').toISOString(),
    },
    properties: {
      GEOID: geoid,
      DISTRICT: num,
    },
  };
}
