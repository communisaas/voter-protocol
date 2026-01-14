/**
 * Global Merkle Tree Builder Tests
 *
 * Comprehensive test suite for hierarchical global Merkle tree construction,
 * proof generation, and verification.
 *
 * COVERAGE:
 * - Tree construction with deterministic ordering
 * - Proof generation at all hierarchy levels
 * - Proof verification (valid and invalid cases)
 * - Edge cases (empty input, single district, odd counts)
 * - Country-to-continent mapping
 *
 * @module global-merkle-tree.test
 */

import { describe, it, expect } from 'vitest';
import { GlobalMerkleTreeBuilder, keccak256, COUNTRY_TO_CONTINENT } from '../../../integration/global-merkle-tree.js';
import type {
  GlobalDistrictInput,
  GlobalMerkleTree,
  GlobalMerkleProof,
  ContinentalRegion,
} from '../../../integration/types.js';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create mock district for testing
 */
function createMockDistrict(
  id: string,
  countryISO: string,
  region: string,
  continent: ContinentalRegion
): GlobalDistrictInput {
  return {
    id,
    name: `District ${id}`,
    countryISO,
    region,
    continent,
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
    boundaryType: 'congressional-district',
    authority: 'Test Authority',
    provenance: {
      source: 'test',
      sourceUrl: 'https://test.example.com',
      retrievedAt: new Date(),
      vintage: '2025',
      checksumSHA256: 'test-checksum',
    },
    bbox: [0, 0, 1, 1],
    validFrom: new Date('2025-01-01'),
  };
}

/**
 * Create test district set with hierarchical structure
 */
function createTestDistricts(): GlobalDistrictInput[] {
  return [
    // United States (Americas)
    createMockDistrict('us-ca-sf-1', 'US', 'CA', 'americas'),
    createMockDistrict('us-ca-sf-2', 'US', 'CA', 'americas'),
    createMockDistrict('us-ny-nyc-1', 'US', 'NY', 'americas'),
    createMockDistrict('us-tx-dal-1', 'US', 'TX', 'americas'),

    // United Kingdom (Europe)
    createMockDistrict('gb-eng-lon-1', 'GB', 'England', 'europe'),
    createMockDistrict('gb-sct-edi-1', 'GB', 'Scotland', 'europe'),

    // Canada (Americas)
    createMockDistrict('ca-on-tor-1', 'CA', 'ON', 'americas'),
    createMockDistrict('ca-qc-mtl-1', 'CA', 'QC', 'americas'),

    // Australia (Oceania)
    createMockDistrict('au-nsw-syd-1', 'AU', 'NSW', 'oceania'),

    // India (Asia)
    createMockDistrict('in-dl-del-1', 'IN', 'DL', 'asia'),

    // South Africa (Africa)
    createMockDistrict('za-wc-cpt-1', 'ZA', 'WC', 'africa'),
  ];
}

// ============================================================================
// Tests
// ============================================================================

describe('GlobalMerkleTreeBuilder', () => {
  describe('buildTree', () => {
    it('should build hierarchical tree from multiple districts', async () => {
      const builder = new GlobalMerkleTreeBuilder();
      const districts = createTestDistricts();

      const tree = await builder.buildTree(districts);

      // Validate tree structure
      expect(tree).toBeDefined();
      expect(tree.root).toMatch(/^0x[0-9a-f]{64}$/);
      expect(tree.totalDistricts).toBe(districts.length);
      expect(tree.continents.size).toBeGreaterThan(0);
      expect(tree.tree.length).toBeGreaterThan(0);

      // Validate continental structure
      expect(tree.continents.has('americas')).toBe(true);
      expect(tree.continents.has('europe')).toBe(true);
      expect(tree.continents.has('oceania')).toBe(true);
      expect(tree.continents.has('asia')).toBe(true);
      expect(tree.continents.has('africa')).toBe(true);

      // Validate Americas structure
      const americas = tree.continents.get('americas')!;
      expect(americas).toBeDefined();
      expect(americas.countries.has('US')).toBe(true);
      expect(americas.countries.has('CA')).toBe(true);

      // Validate US structure
      const us = americas.countries.get('US')!;
      expect(us).toBeDefined();
      expect(us.regions.has('CA')).toBe(true);
      expect(us.regions.has('NY')).toBe(true);
      expect(us.regions.has('TX')).toBe(true);

      // Validate CA region structure
      const ca = us.regions.get('CA')!;
      expect(ca).toBeDefined();
      expect(ca.leaves.size).toBe(2); // us-ca-sf-1, us-ca-sf-2
      expect(ca.leaves.has('us-ca-sf-1')).toBe(true);
      expect(ca.leaves.has('us-ca-sf-2')).toBe(true);
    });

    it('should produce deterministic root for same input', async () => {
      const builder = new GlobalMerkleTreeBuilder();
      const districts = createTestDistricts();

      const tree1 = await builder.buildTree(districts);
      const tree2 = await builder.buildTree(districts);

      expect(tree1.root).toBe(tree2.root);
    });

    it('should produce deterministic root regardless of input order', async () => {
      const builder = new GlobalMerkleTreeBuilder();
      const districts = createTestDistricts();

      // Build tree with original order
      const tree1 = await builder.buildTree(districts);

      // Build tree with shuffled order
      const shuffled = [...districts].reverse();
      const tree2 = await builder.buildTree(shuffled);

      // Roots should match (deterministic sorting)
      expect(tree1.root).toBe(tree2.root);
    });

    it('should handle single district', async () => {
      const builder = new GlobalMerkleTreeBuilder();
      const districts = [createMockDistrict('us-ca-sf-1', 'US', 'CA', 'americas')];

      const tree = await builder.buildTree(districts);

      expect(tree).toBeDefined();
      expect(tree.root).toMatch(/^0x[0-9a-f]{64}$/);
      expect(tree.totalDistricts).toBe(1);
      expect(tree.continents.size).toBe(1);
    });

    it('should handle odd number of districts in region', async () => {
      const builder = new GlobalMerkleTreeBuilder();
      const districts = [
        createMockDistrict('us-ca-sf-1', 'US', 'CA', 'americas'),
        createMockDistrict('us-ca-sf-2', 'US', 'CA', 'americas'),
        createMockDistrict('us-ca-sf-3', 'US', 'CA', 'americas'),
      ];

      const tree = await builder.buildTree(districts);

      expect(tree).toBeDefined();
      expect(tree.root).toMatch(/^0x[0-9a-f]{64}$/);

      const ca = tree.continents.get('americas')!.countries.get('US')!.regions.get('CA')!;
      expect(ca.leaves.size).toBe(3);
    });

    it('should throw error for empty input', async () => {
      const builder = new GlobalMerkleTreeBuilder();

      await expect(builder.buildTree([])).rejects.toThrow(
        'Cannot build tree from empty district set'
      );
    });

    it('should include version and timestamp', async () => {
      const builder = new GlobalMerkleTreeBuilder();
      const districts = createTestDistricts();

      const tree = await builder.buildTree(districts);

      expect(tree.version).toMatch(/^\d{4}-\d{2}$/); // YYYY-MM format
      expect(tree.buildTimestamp).toBeGreaterThan(0);
      expect(tree.buildTimestamp).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('generateProof', () => {
    it('should generate valid proof for district', async () => {
      const builder = new GlobalMerkleTreeBuilder();
      const districts = createTestDistricts();
      const tree = await builder.buildTree(districts);

      const proof = await builder.generateProof(tree, 'us-ca-sf-1');

      expect(proof).toBeDefined();
      expect(proof.globalRoot).toBe(tree.root);
      expect(proof.districtId).toBe('us-ca-sf-1');
      expect(proof.districtHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(proof.continent).toBe('americas');
      expect(proof.countryISO).toBe('US');
      expect(proof.regionCode).toBe('CA');

      // Validate proof paths exist
      expect(proof.districtToRegion).toBeDefined();
      expect(proof.districtToRegion.siblings.length).toBeGreaterThan(0);
      expect(proof.districtToRegion.pathIndices.length).toBe(
        proof.districtToRegion.siblings.length
      );

      expect(proof.regionToCountry).toBeDefined();
      expect(proof.countryToContinent).toBeDefined();
      expect(proof.continentToGlobal).toBeDefined();
    });

    it('should generate proof with correct hierarchy metadata', async () => {
      const builder = new GlobalMerkleTreeBuilder();
      const districts = createTestDistricts();
      const tree = await builder.buildTree(districts);

      const proof = await builder.generateProof(tree, 'gb-eng-lon-1');

      expect(proof.continent).toBe('europe');
      expect(proof.countryISO).toBe('GB');
      expect(proof.regionCode).toBe('England');
      expect(proof.treeVersion).toBe(tree.version);
    });

    it('should throw error for non-existent district', async () => {
      const builder = new GlobalMerkleTreeBuilder();
      const districts = createTestDistricts();
      const tree = await builder.buildTree(districts);

      await expect(
        builder.generateProof(tree, 'non-existent-id')
      ).rejects.toThrow('District not found in tree: non-existent-id');
    });

    it('should include generation timestamp', async () => {
      const builder = new GlobalMerkleTreeBuilder();
      const districts = createTestDistricts();
      const tree = await builder.buildTree(districts);

      const proof = await builder.generateProof(tree, 'us-ca-sf-1');

      expect(proof.generatedAt).toBeGreaterThan(0);
      expect(proof.generatedAt).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('verifyProof', () => {
    it('should verify valid proof', async () => {
      const builder = new GlobalMerkleTreeBuilder();
      const districts = createTestDistricts();
      const tree = await builder.buildTree(districts);

      const proof = await builder.generateProof(tree, 'us-ca-sf-1');
      const valid = builder.verifyProof(proof);

      expect(valid).toBe(true);
    });

    it('should verify proofs for all districts', async () => {
      const builder = new GlobalMerkleTreeBuilder();
      const districts = createTestDistricts();
      const tree = await builder.buildTree(districts);

      for (const district of districts) {
        const proof = await builder.generateProof(tree, district.id);
        const valid = builder.verifyProof(proof);

        expect(valid).toBe(true);
      }
    });

    it('should reject proof with tampered district hash', async () => {
      const builder = new GlobalMerkleTreeBuilder();
      const districts = createTestDistricts();
      const tree = await builder.buildTree(districts);

      const proof = await builder.generateProof(tree, 'us-ca-sf-1');

      // Tamper with district hash
      const tamperedProof: GlobalMerkleProof = {
        ...proof,
        districtHash: '0x' + '0'.repeat(64),
      };

      const valid = builder.verifyProof(tamperedProof);
      expect(valid).toBe(false);
    });

    it('should reject proof with tampered global root', async () => {
      const builder = new GlobalMerkleTreeBuilder();
      const districts = createTestDistricts();
      const tree = await builder.buildTree(districts);

      const proof = await builder.generateProof(tree, 'us-ca-sf-1');

      // Tamper with global root
      const tamperedProof: GlobalMerkleProof = {
        ...proof,
        globalRoot: '0x' + 'f'.repeat(64),
      };

      const valid = builder.verifyProof(tamperedProof);
      expect(valid).toBe(false);
    });

    it('should reject proof with tampered sibling hashes', async () => {
      const builder = new GlobalMerkleTreeBuilder();
      const districts = createTestDistricts();
      const tree = await builder.buildTree(districts);

      const proof = await builder.generateProof(tree, 'us-ca-sf-1');

      // Tamper with sibling hash
      const tamperedSiblings = [...proof.districtToRegion.siblings];
      if (tamperedSiblings.length > 0) {
        tamperedSiblings[0] = '0x' + '0'.repeat(64);
      }

      const tamperedProof: GlobalMerkleProof = {
        ...proof,
        districtToRegion: {
          ...proof.districtToRegion,
          siblings: tamperedSiblings,
        },
      };

      const valid = builder.verifyProof(tamperedProof);
      expect(valid).toBe(false);
    });

    it('should reject proof with swapped path indices', async () => {
      const builder = new GlobalMerkleTreeBuilder();
      const districts = createTestDistricts();
      const tree = await builder.buildTree(districts);

      const proof = await builder.generateProof(tree, 'us-ca-sf-1');

      // Swap path indices
      const tamperedIndices = [...proof.districtToRegion.pathIndices];
      if (tamperedIndices.length > 0) {
        tamperedIndices[0] = tamperedIndices[0] === 0 ? 1 : 0;
      }

      const tamperedProof: GlobalMerkleProof = {
        ...proof,
        districtToRegion: {
          ...proof.districtToRegion,
          pathIndices: tamperedIndices,
        },
      };

      const valid = builder.verifyProof(tamperedProof);
      expect(valid).toBe(false);
    });
  });

  describe('keccak256', () => {
    it('should produce consistent hashes', () => {
      const data = 'test-data';
      const hash1 = keccak256(data);
      const hash2 = keccak256(data);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = keccak256('test-1');
      const hash2 = keccak256('test-2');

      expect(hash1).not.toBe(hash2);
    });

    it('should be non-commutative for pairs', () => {
      const left = keccak256('left');
      const right = keccak256('right');

      const hash1 = keccak256(left + right);
      const hash2 = keccak256(right + left);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('COUNTRY_TO_CONTINENT mapping', () => {
    it('should map all major countries correctly', () => {
      expect(COUNTRY_TO_CONTINENT.US).toBe('americas');
      expect(COUNTRY_TO_CONTINENT.GB).toBe('europe');
      expect(COUNTRY_TO_CONTINENT.CA).toBe('americas');
      expect(COUNTRY_TO_CONTINENT.AU).toBe('oceania');
      expect(COUNTRY_TO_CONTINENT.IN).toBe('asia');
      expect(COUNTRY_TO_CONTINENT.ZA).toBe('africa');
    });

    it('should include all continents', () => {
      const continents = new Set(Object.values(COUNTRY_TO_CONTINENT));

      expect(continents.has('africa')).toBe(true);
      expect(continents.has('americas')).toBe(true);
      expect(continents.has('asia')).toBe(true);
      expect(continents.has('europe')).toBe(true);
      expect(continents.has('oceania')).toBe(true);
    });

    it('should map at least 190 countries', () => {
      const countryCount = Object.keys(COUNTRY_TO_CONTINENT).length;

      expect(countryCount).toBeGreaterThanOrEqual(190);
    });
  });

  describe('edge cases', () => {
    it('should handle multiple regions in same country', async () => {
      const builder = new GlobalMerkleTreeBuilder();
      const districts = [
        createMockDistrict('us-ca-sf-1', 'US', 'CA', 'americas'),
        createMockDistrict('us-ny-nyc-1', 'US', 'NY', 'americas'),
        createMockDistrict('us-tx-dal-1', 'US', 'TX', 'americas'),
      ];

      const tree = await builder.buildTree(districts);

      const us = tree.continents.get('americas')!.countries.get('US')!;
      expect(us.regions.size).toBe(3);
    });

    it('should handle multiple countries in same continent', async () => {
      const builder = new GlobalMerkleTreeBuilder();
      const districts = [
        createMockDistrict('us-ca-sf-1', 'US', 'CA', 'americas'),
        createMockDistrict('ca-on-tor-1', 'CA', 'ON', 'americas'),
      ];

      const tree = await builder.buildTree(districts);

      const americas = tree.continents.get('americas')!;
      expect(americas.countries.size).toBe(2);
    });

    it('should handle all five continents', async () => {
      const builder = new GlobalMerkleTreeBuilder();
      const districts = createTestDistricts();

      const tree = await builder.buildTree(districts);

      expect(tree.continents.size).toBe(5);
    });

    it('should handle power-of-two leaf counts', async () => {
      const builder = new GlobalMerkleTreeBuilder();
      const districts = [
        createMockDistrict('us-ca-sf-1', 'US', 'CA', 'americas'),
        createMockDistrict('us-ca-sf-2', 'US', 'CA', 'americas'),
        createMockDistrict('us-ca-sf-3', 'US', 'CA', 'americas'),
        createMockDistrict('us-ca-sf-4', 'US', 'CA', 'americas'),
      ];

      const tree = await builder.buildTree(districts);

      const ca = tree.continents.get('americas')!.countries.get('US')!.regions.get('CA')!;
      expect(ca.leaves.size).toBe(4);

      // Verify proof for all leaves
      for (const district of districts) {
        const proof = await builder.generateProof(tree, district.id);
        expect(builder.verifyProof(proof)).toBe(true);
      }
    });

    it('should handle non-power-of-two leaf counts', async () => {
      const builder = new GlobalMerkleTreeBuilder();
      const districts = [
        createMockDistrict('us-ca-sf-1', 'US', 'CA', 'americas'),
        createMockDistrict('us-ca-sf-2', 'US', 'CA', 'americas'),
        createMockDistrict('us-ca-sf-3', 'US', 'CA', 'americas'),
      ];

      const tree = await builder.buildTree(districts);

      // Verify proof for all leaves
      for (const district of districts) {
        const proof = await builder.generateProof(tree, district.id);
        expect(builder.verifyProof(proof)).toBe(true);
      }
    });
  });
});
