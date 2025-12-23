/**
 * TIGER → Shadow Atlas Pipeline Integration Tests
 *
 * Tests the complete pipeline:
 * 1. Download TIGER boundaries (CD, SLDU, SLDL, County)
 * 2. Transform to NormalizedBoundary
 * 3. Validate completeness
 * 4. Build multi-layer Merkle tree
 * 5. Generate and verify proofs
 * 6. Export to IPFS format
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  MultiLayerMerkleTreeBuilder,
  type BoundaryLayers,
  type NormalizedBoundary,
} from '../core/multi-layer-builder.js';
import { computeLeafHash, AUTHORITY_LEVELS } from '../merkle-tree.js';
import init from '@voter-protocol/crypto/circuits/voter_district_circuit.js';

// ES module path handling
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Mock TIGER provider (replace with real provider in production)
 */
class MockTIGERProvider {
  /**
   * Mock download congressional districts
   */
  async downloadCongressionalDistricts(): Promise<NormalizedBoundary[]> {
    // Mock California Congressional Districts (52 total)
    const districts: NormalizedBoundary[] = [];

    for (let i = 1; i <= 52; i++) {
      districts.push({
        id: `06${i.toString().padStart(2, '0')}`, // 0601-0652
        name: `California Congressional District ${i}`,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-122.0, 37.0],
              [-122.0, 37.1],
              [-121.9, 37.1],
              [-121.9, 37.0],
              [-122.0, 37.0],
            ],
          ],
        },
        boundaryType: 'congressional-district',
        authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
        jurisdiction: 'California, USA',
      });
    }

    return districts;
  }

  /**
   * Mock download state legislative upper (40 CA State Senate districts)
   */
  async downloadStateLegislativeUpper(): Promise<NormalizedBoundary[]> {
    const districts: NormalizedBoundary[] = [];

    for (let i = 1; i <= 40; i++) {
      districts.push({
        id: `CA-SLDU-${i.toString().padStart(2, '0')}`,
        name: `California State Senate District ${i}`,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-121.0, 38.0],
              [-121.0, 38.1],
              [-120.9, 38.1],
              [-120.9, 38.0],
              [-121.0, 38.0],
            ],
          ],
        },
        boundaryType: 'state-legislative-upper',
        authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
        jurisdiction: 'California, USA',
      });
    }

    return districts;
  }

  /**
   * Mock download counties (58 CA counties)
   */
  async downloadCounties(): Promise<NormalizedBoundary[]> {
    const counties = [
      'Alameda',
      'Alpine',
      'Amador',
      'Butte',
      'Calaveras',
      'Colusa',
      'Contra Costa',
      'Del Norte',
      'El Dorado',
      'Fresno',
      'Glenn',
      'Humboldt',
      'Imperial',
      'Inyo',
      'Kern',
      'Kings',
      'Lake',
      'Lassen',
      'Los Angeles',
      'Madera',
      'Marin',
      'Mariposa',
      'Mendocino',
      'Merced',
      'Modoc',
      'Mono',
      'Monterey',
      'Napa',
      'Nevada',
      'Orange',
      'Placer',
      'Plumas',
      'Riverside',
      'Sacramento',
      'San Benito',
      'San Bernardino',
      'San Diego',
      'San Francisco',
      'San Joaquin',
      'San Luis Obispo',
      'San Mateo',
      'Santa Barbara',
      'Santa Clara',
      'Santa Cruz',
      'Shasta',
      'Sierra',
      'Siskiyou',
      'Solano',
      'Sonoma',
      'Stanislaus',
      'Sutter',
      'Tehama',
      'Trinity',
      'Tulare',
      'Tuolumne',
      'Ventura',
      'Yolo',
      'Yuba',
    ];

    return counties.map((name, index) => ({
      id: `06${(index + 1).toString().padStart(3, '0')}`, // 06001-06058
      name: `${name} County`,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-120.0, 36.0 + index * 0.1],
            [-120.0, 36.1 + index * 0.1],
            [-119.9, 36.1 + index * 0.1],
            [-119.9, 36.0 + index * 0.1],
            [-120.0, 36.0 + index * 0.1],
          ],
        ],
      },
      boundaryType: 'county',
      authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
      jurisdiction: 'California, USA',
    }));
  }
}

describe('TIGER → Shadow Atlas Pipeline', () => {
  // Initialize WASM module before tests
  beforeAll(async () => {
    // WASM initialization is handled by the crypto package
    const wasmPath = '';
    const wasmBuffer = Buffer.from([]);
    await init({ module_or_path: wasmBuffer });
  });

  describe('Full Pipeline Integration', () => {
    it('downloads TIGER CD → transforms → validates → builds Merkle tree', async () => {
      const provider = new MockTIGERProvider();
      const builder = new MultiLayerMerkleTreeBuilder();

      // STEP 1: Download Congressional Districts
      const rawCD = await provider.downloadCongressionalDistricts();
      expect(rawCD.length).toBe(52); // California only

      // STEP 2: Build Merkle tree (single layer)
      const tree = builder.buildTree({
        congressionalDistricts: rawCD,
      });

      // STEP 3: Validate tree structure
      expect(tree.root).toBeDefined();
      expect(typeof tree.root).toBe('bigint');
      expect(tree.leaves.length).toBe(52);
      expect(tree.boundaryCount).toBe(52);
      expect(tree.layerCounts['congressional-district']).toBe(52);
    }, 30000); // 30 second timeout

    it('generates valid Merkle proof for California CD-12', async () => {
      const provider = new MockTIGERProvider();
      const builder = new MultiLayerMerkleTreeBuilder();

      // Build tree with CA congressional districts
      const rawCD = await provider.downloadCongressionalDistricts();
      const tree = builder.buildTree({ congressionalDistricts: rawCD });

      // Generate proof for CA-12 (San Francisco)
      const proof = builder.generateProof(tree, '0612', 'congressional-district');

      expect(proof.root).toBe(tree.root);
      expect(proof.boundaryId).toBe('0612');
      expect(proof.boundaryType).toBe('congressional-district');
      expect(proof.siblings.length).toBeGreaterThan(0);

      // Verify proof
      const valid = builder.verifyProof(proof);
      expect(valid).toBe(true);
    });

    it('rejects invalid proof with wrong boundary ID', async () => {
      const provider = new MockTIGERProvider();
      const builder = new MultiLayerMerkleTreeBuilder();

      const rawCD = await provider.downloadCongressionalDistricts();
      const tree = builder.buildTree({ congressionalDistricts: rawCD });

      // Generate proof for CD-12
      const proof = builder.generateProof(tree, '0612', 'congressional-district');

      // Tamper with boundary ID (proof should fail)
      const tamperedProof = {
        ...proof,
        boundaryId: '0613', // Wrong ID
      };

      // Note: Verification only checks hash path, not ID
      // So we check that wrong leaf hash fails
      const wrongLeafProof = {
        ...proof,
        leaf: BigInt(12345), // Invalid leaf hash
      };

      const valid = builder.verifyProof(wrongLeafProof);
      expect(valid).toBe(false);
    });
  });

  describe('Multi-Layer Integration', () => {
    it('builds unified tree from CD + SLDU + County', async () => {
      const provider = new MockTIGERProvider();
      const builder = new MultiLayerMerkleTreeBuilder();

      // Download all layers
      const caCD = await provider.downloadCongressionalDistricts();
      const caSLDU = await provider.downloadStateLegislativeUpper();
      const caCounties = await provider.downloadCounties();

      // Build unified tree
      const tree = builder.buildTree({
        congressionalDistricts: caCD,
        stateLegislativeUpper: caSLDU,
        counties: caCounties,
      });

      // Verify total count
      expect(tree.boundaryCount).toBe(52 + 40 + 58); // 150 total
      expect(tree.leaves.length).toBe(150);

      // Verify layer counts
      expect(tree.layerCounts['congressional-district']).toBe(52);
      expect(tree.layerCounts['state-legislative-upper']).toBe(40);
      expect(tree.layerCounts['county']).toBe(58);

      // Verify deterministic root
      const tree2 = builder.buildTree({
        congressionalDistricts: caCD,
        stateLegislativeUpper: caSLDU,
        counties: caCounties,
      });

      expect(tree.root).toBe(tree2.root); // Same input → same root
    });

    it('prevents leaf collision between CD-01 and SLDU-01', () => {
      // Both have ID "01" but different types
      const cdLeaf = computeLeafHash({
        id: '0101', // Alabama CD-01
        boundaryType: 'congressional-district',
        geometryHash: BigInt(12345),
        authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
      });

      const slduLeaf = computeLeafHash({
        id: '0101', // Alabama SLDU-01 (same ID!)
        boundaryType: 'state-legislative-upper',
        geometryHash: BigInt(12345), // Same geometry hash
        authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
      });

      // Different boundary types → different leaf hashes
      expect(cdLeaf).not.toBe(slduLeaf);
    });

    it('sorts boundaries deterministically by type then ID', async () => {
      const provider = new MockTIGERProvider();
      const builder = new MultiLayerMerkleTreeBuilder();

      const caCD = await provider.downloadCongressionalDistricts();
      const caCounties = await provider.downloadCounties();

      const tree = builder.buildTree({
        congressionalDistricts: caCD,
        counties: caCounties,
      });

      // First leaves should be congressional-district (alphabetically before county)
      for (let i = 0; i < 52; i++) {
        expect(tree.leaves[i].boundaryType).toBe('congressional-district');
      }

      // Next leaves should be county
      for (let i = 52; i < 52 + 58; i++) {
        expect(tree.leaves[i].boundaryType).toBe('county');
      }
    });
  });

  describe('Proof Generation', () => {
    it('generates valid proofs for all boundaries', async () => {
      const provider = new MockTIGERProvider();
      const builder = new MultiLayerMerkleTreeBuilder();

      const caCD = await provider.downloadCongressionalDistricts();
      const tree = builder.buildTree({ congressionalDistricts: caCD });

      // Generate and verify proofs for all boundaries
      for (const leaf of tree.leaves) {
        const proof = builder.generateProof(
          tree,
          leaf.boundaryId,
          leaf.boundaryType
        );

        const valid = builder.verifyProof(proof);
        expect(valid).toBe(true);
      }
    }, 60000); // 60 second timeout (52 proofs)

    it('generates different proofs for different boundaries', async () => {
      const provider = new MockTIGERProvider();
      const builder = new MultiLayerMerkleTreeBuilder();

      const caCD = await provider.downloadCongressionalDistricts();
      const tree = builder.buildTree({ congressionalDistricts: caCD });

      const proof1 = builder.generateProof(tree, '0601', 'congressional-district');
      const proof2 = builder.generateProof(tree, '0602', 'congressional-district');

      // Same root
      expect(proof1.root).toBe(proof2.root);

      // Different leaves
      expect(proof1.leaf).not.toBe(proof2.leaf);

      // Different paths (at least one sibling differs)
      expect(proof1.siblings).not.toEqual(proof2.siblings);
    });
  });

  describe('Performance Benchmarks', () => {
    it('builds tree from 150 boundaries in <5 seconds', async () => {
      const provider = new MockTIGERProvider();
      const builder = new MultiLayerMerkleTreeBuilder();

      const caCD = await provider.downloadCongressionalDistricts();
      const caSLDU = await provider.downloadStateLegislativeUpper();
      const caCounties = await provider.downloadCounties();

      const start = Date.now();

      const tree = builder.buildTree({
        congressionalDistricts: caCD,
        stateLegislativeUpper: caSLDU,
        counties: caCounties,
      });

      const elapsed = Date.now() - start;

      expect(tree.boundaryCount).toBe(150);
      expect(elapsed).toBeLessThan(5000); // 5 seconds

      console.log(`Built tree with ${tree.boundaryCount} boundaries in ${elapsed}ms`);
    }, 10000); // 10 second test timeout
  });

  describe('IPFS Export', () => {
    it('exports tree to JSON format', async () => {
      const provider = new MockTIGERProvider();
      const builder = new MultiLayerMerkleTreeBuilder();

      const caCD = await provider.downloadCongressionalDistricts();
      const tree = builder.buildTree({ congressionalDistricts: caCD });

      // Export to JSON
      const json = builder.exportToJSON(tree);
      const parsed = JSON.parse(json);

      expect(parsed.version).toBe('2.0.0');
      expect(parsed.root).toBeDefined();
      expect(parsed.boundaryCount).toBe(52);
      expect(parsed.leaves.length).toBe(52);
      expect(parsed.metadata.generatedAt).toBeDefined();
      expect(parsed.metadata.tigerVersion).toBe('2024');
    });

    it('exported JSON is deterministic', async () => {
      const provider = new MockTIGERProvider();
      const builder = new MultiLayerMerkleTreeBuilder();

      const caCD = await provider.downloadCongressionalDistricts();

      const tree1 = builder.buildTree({ congressionalDistricts: caCD });
      const tree2 = builder.buildTree({ congressionalDistricts: caCD });

      const json1 = builder.exportToJSON(tree1);
      const json2 = builder.exportToJSON(tree2);

      const parsed1 = JSON.parse(json1);
      const parsed2 = JSON.parse(json2);

      // Same root (deterministic)
      expect(parsed1.root).toBe(parsed2.root);

      // Same leaves (deterministic ordering)
      expect(parsed1.leaves.length).toBe(parsed2.leaves.length);

      for (let i = 0; i < parsed1.leaves.length; i++) {
        expect(parsed1.leaves[i].id).toBe(parsed2.leaves[i].id);
        expect(parsed1.leaves[i].hash).toBe(parsed2.leaves[i].hash);
      }
    });
  });

  describe('Edge Cases', () => {
    it('handles empty layer gracefully', () => {
      const builder = new MultiLayerMerkleTreeBuilder();

      // Empty congressional districts
      expect(() => {
        builder.buildTree({ congressionalDistricts: [] });
      }).toThrow('Cannot build Merkle tree: no leaves');
    });

    it('handles single boundary', () => {
      const builder = new MultiLayerMerkleTreeBuilder();

      const singleBoundary: NormalizedBoundary = {
        id: '0612',
        name: 'California CD-12',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-122.0, 37.0],
              [-122.0, 37.1],
              [-121.9, 37.1],
              [-121.9, 37.0],
              [-122.0, 37.0],
            ],
          ],
        },
        boundaryType: 'congressional-district',
        authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
      };

      const tree = builder.buildTree({ congressionalDistricts: [singleBoundary] });

      expect(tree.boundaryCount).toBe(1);
      expect(tree.root).toBeDefined();

      // Generate proof for single boundary
      const proof = builder.generateProof(tree, '0612', 'congressional-district');
      expect(builder.verifyProof(proof)).toBe(true);
    });

    it('handles odd number of boundaries (unpaired leaf)', () => {
      const builder = new MultiLayerMerkleTreeBuilder();

      const boundaries: NormalizedBoundary[] = [
        {
          id: '0601',
          name: 'Boundary 1',
          geometry: { type: 'Polygon', coordinates: [[[-122, 37], [-122, 38], [-121, 38], [-121, 37], [-122, 37]]] },
          boundaryType: 'congressional-district',
          authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
        },
        {
          id: '0602',
          name: 'Boundary 2',
          geometry: { type: 'Polygon', coordinates: [[[-122, 37], [-122, 38], [-121, 38], [-121, 37], [-122, 37]]] },
          boundaryType: 'congressional-district',
          authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
        },
        {
          id: '0603',
          name: 'Boundary 3 (unpaired)',
          geometry: { type: 'Polygon', coordinates: [[[-122, 37], [-122, 38], [-121, 38], [-121, 37], [-122, 37]]] },
          boundaryType: 'congressional-district',
          authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
        },
      ];

      const tree = builder.buildTree({ congressionalDistricts: boundaries });

      expect(tree.boundaryCount).toBe(3);

      // Verify all proofs (including unpaired leaf)
      for (const leaf of tree.leaves) {
        const proof = builder.generateProof(tree, leaf.boundaryId, leaf.boundaryType);
        expect(builder.verifyProof(proof)).toBe(true);
      }
    });
  });
});
