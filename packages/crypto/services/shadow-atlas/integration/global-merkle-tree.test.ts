/**
 * Global Hierarchical Merkle Tree Tests
 *
 * Comprehensive test suite validating:
 * - Hierarchical tree construction (district → region → country → continent → global)
 * - Deterministic root computation (same input → same root)
 * - Proof generation and verification (two-level proofs)
 * - Incremental updates (country-level updates)
 * - Security properties (collision resistance, non-commutativity, domain separation)
 *
 * COVERAGE:
 * - Multi-country tree construction
 * - Cross-country proof verification
 * - Regional aggregation
 * - Continental grouping
 * - Edge cases (single district, single country, empty regions)
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { describe, it, expect } from 'vitest';
import {
  GlobalMerkleTreeBuilder,
  createGlobalMerkleTreeBuilder,
  type GlobalDistrictInput,
  type GlobalMerkleTree,
  type GlobalDistrictProof,
  GLOBAL_AUTHORITY_LEVELS,
} from './global-merkle-tree.js';

// BN254 field modulus for validation
const BN254_FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create test district
 */
function createTestDistrict(params: {
  id: string;
  name: string;
  country: string;
  region: string;
  boundaryType?: string;
  authority?: number;
}): GlobalDistrictInput {
  return {
    id: params.id,
    name: params.name,
    country: params.country,
    region: params.region,
    boundaryType: (params.boundaryType as GlobalDistrictInput['boundaryType']) ||
      'city-council-district',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-118.0, 34.0],
          [-118.0, 34.1],
          [-117.9, 34.1],
          [-117.9, 34.0],
          [-118.0, 34.0],
        ],
      ],
    },
    authority: params.authority || GLOBAL_AUTHORITY_LEVELS.MUNICIPAL_OFFICIAL,
  };
}

/**
 * Create multi-country test dataset
 */
function createMultiCountryDataset(): GlobalDistrictInput[] {
  return [
    // USA - California
    createTestDistrict({
      id: 'US-CA-LA-CD01',
      name: 'Los Angeles City Council District 1',
      country: 'US',
      region: 'CA',
      boundaryType: 'city-council-district',
    }),
    createTestDistrict({
      id: 'US-CA-LA-CD02',
      name: 'Los Angeles City Council District 2',
      country: 'US',
      region: 'CA',
      boundaryType: 'city-council-district',
    }),
    createTestDistrict({
      id: 'US-CA-SF-SD01',
      name: 'San Francisco Supervisor District 1',
      country: 'US',
      region: 'CA',
      boundaryType: 'city-council-district',
    }),

    // USA - Texas
    createTestDistrict({
      id: 'US-TX-HOU-CD01',
      name: 'Houston City Council District 1',
      country: 'US',
      region: 'TX',
      boundaryType: 'city-council-district',
    }),
    createTestDistrict({
      id: 'US-TX-DAL-CD01',
      name: 'Dallas City Council District 1',
      country: 'US',
      region: 'TX',
      boundaryType: 'city-council-district',
    }),

    // Canada - Ontario
    createTestDistrict({
      id: 'CA-ON-TOR-WD01',
      name: 'Toronto Ward 1',
      country: 'CA',
      region: 'ON',
      boundaryType: 'city-council-district',
    }),
    createTestDistrict({
      id: 'CA-ON-TOR-WD02',
      name: 'Toronto Ward 2',
      country: 'CA',
      region: 'ON',
      boundaryType: 'city-council-district',
    }),

    // UK - England
    createTestDistrict({
      id: 'GB-ENG-LON-WM',
      name: 'Westminster Parliamentary Constituency',
      country: 'GB',
      region: 'ENG',
      boundaryType: 'parliamentary-constituency',
      authority: GLOBAL_AUTHORITY_LEVELS.FEDERAL_MANDATE,
    }),
    createTestDistrict({
      id: 'GB-ENG-MAN-CTY',
      name: 'Manchester City Council',
      country: 'GB',
      region: 'ENG',
      boundaryType: 'city-council-district',
    }),

    // Germany - Bavaria
    createTestDistrict({
      id: 'DE-BY-MUC-WK01',
      name: 'Munich Wahlkreis 1',
      country: 'DE',
      region: 'BY',
      boundaryType: 'wahlkreis',
    }),

    // Australia - New South Wales
    createTestDistrict({
      id: 'AU-NSW-SYD-EL01',
      name: 'Sydney Electorate 1',
      country: 'AU',
      region: 'NSW',
      boundaryType: 'electorate',
    }),
  ];
}

// ============================================================================
// Construction Tests
// ============================================================================

describe('Global Merkle Tree Construction', () => {
  it('should build tree for single district', () => {
    const builder = createGlobalMerkleTreeBuilder();
    const districts = [
      createTestDistrict({
        id: 'US-CA-LA-CD01',
        name: 'Los Angeles City Council District 1',
        country: 'US',
        region: 'CA',
      }),
    ];

    const tree = builder.build(districts);

    expect(tree.totalDistricts).toBe(1);
    expect(tree.globalRoot).toBeGreaterThan(0n);
    expect(tree.globalRoot).toBeLessThan(BN254_FIELD_MODULUS);
    expect(tree.continents.length).toBeGreaterThan(0);
  });

  it('should build tree for multi-country dataset', () => {
    const builder = createGlobalMerkleTreeBuilder();
    const districts = createMultiCountryDataset();

    const tree = builder.build(districts);

    expect(tree.totalDistricts).toBe(11);
    expect(tree.globalRoot).toBeGreaterThan(0n);
    expect(tree.globalRoot).toBeLessThan(BN254_FIELD_MODULUS);

    // Should have multiple continents
    expect(tree.continents.length).toBeGreaterThanOrEqual(2);

    // Find Americas continent
    const americas = tree.continents.find(c => c.continent === 'americas');
    expect(americas).toBeDefined();
    expect(americas!.countries.length).toBeGreaterThanOrEqual(2); // US + CA

    // Find Europe continent
    const europe = tree.continents.find(c => c.continent === 'europe');
    expect(europe).toBeDefined();
    expect(europe!.countries.length).toBeGreaterThanOrEqual(2); // GB + DE
  });

  it('should group districts by country correctly', () => {
    const builder = createGlobalMerkleTreeBuilder();
    const districts = createMultiCountryDataset();

    const tree = builder.build(districts);

    // Find US country
    const americas = tree.continents.find(c => c.continent === 'americas');
    const usa = americas?.countries.find(c => c.countryCode === 'US');

    expect(usa).toBeDefined();
    expect(usa!.districtCount).toBe(5); // 3 CA + 2 TX

    // Find Canada
    const canada = americas?.countries.find(c => c.countryCode === 'CA');
    expect(canada).toBeDefined();
    expect(canada!.districtCount).toBe(2); // 2 ON
  });

  it('should group districts by region correctly', () => {
    const builder = createGlobalMerkleTreeBuilder();
    const districts = createMultiCountryDataset();

    const tree = builder.build(districts);

    // Find US
    const americas = tree.continents.find(c => c.continent === 'americas');
    const usa = americas?.countries.find(c => c.countryCode === 'US');

    // Check California region
    const california = usa?.regions.find(r => r.regionId === 'CA');
    expect(california).toBeDefined();
    expect(california!.districtCount).toBe(3);

    // Check Texas region
    const texas = usa?.regions.find(r => r.regionId === 'TX');
    expect(texas).toBeDefined();
    expect(texas!.districtCount).toBe(2);
  });
});

// ============================================================================
// Determinism Tests
// ============================================================================

describe('Deterministic Tree Construction', () => {
  it('should produce same root for same districts (multiple builds)', () => {
    const builder = createGlobalMerkleTreeBuilder();
    const districts = createMultiCountryDataset();

    const tree1 = builder.build(districts);
    const tree2 = builder.build(districts);
    const tree3 = builder.build(districts);

    expect(tree1.globalRoot).toBe(tree2.globalRoot);
    expect(tree2.globalRoot).toBe(tree3.globalRoot);
  });

  it('should produce different roots for different district order (but same after sorting)', () => {
    const builder = createGlobalMerkleTreeBuilder();
    const districts = createMultiCountryDataset();

    // Reverse order
    const reversed = [...districts].reverse();

    const tree1 = builder.build(districts);
    const tree2 = builder.build(reversed);

    // Should be same (internal sorting ensures determinism)
    expect(tree1.globalRoot).toBe(tree2.globalRoot);
  });

  it('should produce different roots when district changes', () => {
    const builder = createGlobalMerkleTreeBuilder();
    const districts = createMultiCountryDataset();

    const tree1 = builder.build(districts);

    // Modify one district name
    const modifiedDistricts = [...districts];
    modifiedDistricts[0] = {
      ...modifiedDistricts[0],
      name: 'Modified District Name',
    };

    const tree2 = builder.build(modifiedDistricts);

    // Roots must differ
    expect(tree1.globalRoot).not.toBe(tree2.globalRoot);
  });

  it('should produce different roots for different boundary types', () => {
    const builder = createGlobalMerkleTreeBuilder();

    const district1 = createTestDistrict({
      id: 'US-CA-LA-CD01',
      name: 'Test District',
      country: 'US',
      region: 'CA',
      boundaryType: 'congressional-district',
    });

    const district2 = createTestDistrict({
      id: 'US-CA-LA-CD01',
      name: 'Test District',
      country: 'US',
      region: 'CA',
      boundaryType: 'state-legislative-upper',
    });

    const tree1 = builder.build([district1]);
    const tree2 = builder.build([district2]);

    // Different boundary types → different roots (domain separation)
    expect(tree1.globalRoot).not.toBe(tree2.globalRoot);
  });
});

// ============================================================================
// Proof Generation Tests
// ============================================================================

describe('Global District Proof Generation', () => {
  it('should generate valid proof for district in tree', () => {
    const builder = createGlobalMerkleTreeBuilder();
    const districts = createMultiCountryDataset();
    const tree = builder.build(districts);

    // Generate proof for first district
    const districtId = 'US-CA-LA-CD01';
    const proof = builder.generateProof(tree, districtId);

    expect(proof).toBeDefined();
    expect(proof.districtProof.leaf).toBeGreaterThan(0n);
    expect(proof.districtProof.siblings.length).toBeGreaterThan(0);
    expect(proof.countryProof.siblings.length).toBeGreaterThan(0);
    expect(proof.metadata.districtId).toBe(districtId);
    expect(proof.metadata.countryCode).toBe('US');
  });

  it('should generate proof with correct metadata', () => {
    const builder = createGlobalMerkleTreeBuilder();
    const districts = createMultiCountryDataset();
    const tree = builder.build(districts);

    const proof = builder.generateProof(tree, 'GB-ENG-LON-WM');

    expect(proof.metadata.countryCode).toBe('GB');
    expect(proof.metadata.countryName).toBe('United Kingdom');
    expect(proof.metadata.regionId).toBe('ENG');
    expect(proof.metadata.districtId).toBe('GB-ENG-LON-WM');
    expect(proof.metadata.boundaryType).toBe('parliamentary-constituency');
  });

  it('should throw error for district not in tree', () => {
    const builder = createGlobalMerkleTreeBuilder();
    const districts = createMultiCountryDataset();
    const tree = builder.build(districts);

    expect(() => {
      builder.generateProof(tree, 'NONEXISTENT-DISTRICT');
    }).toThrow('District not found');
  });

  it('should generate proofs for all districts in tree', () => {
    const builder = createGlobalMerkleTreeBuilder();
    const districts = createMultiCountryDataset();
    const tree = builder.build(districts);

    // Generate proofs for all districts
    for (const district of districts) {
      const proof = builder.generateProof(tree, district.id);
      expect(proof).toBeDefined();
      expect(proof.metadata.districtId).toBe(district.id);
    }
  });
});

// ============================================================================
// Proof Verification Tests
// ============================================================================

describe('Global District Proof Verification', () => {
  it('should verify valid proof', () => {
    const builder = createGlobalMerkleTreeBuilder();
    const districts = createMultiCountryDataset();
    const tree = builder.build(districts);

    const proof = builder.generateProof(tree, 'US-CA-LA-CD01');
    const isValid = builder.verifyProof(proof);

    expect(isValid).toBe(true);
  });

  it('should verify all generated proofs', () => {
    const builder = createGlobalMerkleTreeBuilder();
    const districts = createMultiCountryDataset();
    const tree = builder.build(districts);

    // Verify all proofs
    for (const district of districts) {
      const proof = builder.generateProof(tree, district.id);
      const isValid = builder.verifyProof(proof);
      expect(isValid).toBe(true);
    }
  });

  it('should reject proof with tampered leaf hash', () => {
    const builder = createGlobalMerkleTreeBuilder();
    const districts = createMultiCountryDataset();
    const tree = builder.build(districts);

    const proof = builder.generateProof(tree, 'US-CA-LA-CD01');

    // Tamper with leaf hash
    const tamperedProof: GlobalDistrictProof = {
      ...proof,
      districtProof: {
        ...proof.districtProof,
        leaf: proof.districtProof.leaf ^ 1n,  // Flip one bit
      },
    };

    const isValid = builder.verifyProof(tamperedProof);
    expect(isValid).toBe(false);
  });

  it('should reject proof with tampered country root', () => {
    const builder = createGlobalMerkleTreeBuilder();
    const districts = createMultiCountryDataset();
    const tree = builder.build(districts);

    const proof = builder.generateProof(tree, 'US-CA-LA-CD01');

    // Tamper with country root
    const tamperedProof: GlobalDistrictProof = {
      ...proof,
      countryProof: {
        ...proof.countryProof,
        countryRoot: proof.countryProof.countryRoot + 1n,
      },
    };

    const isValid = builder.verifyProof(tamperedProof);
    expect(isValid).toBe(false);
  });

  it('should reject proof with swapped siblings (non-commutativity)', () => {
    const builder = createGlobalMerkleTreeBuilder();
    const districts = createMultiCountryDataset();
    const tree = builder.build(districts);

    const proof = builder.generateProof(tree, 'US-CA-LA-CD01');

    // Swap first two siblings in district proof
    if (proof.districtProof.siblings.length >= 2) {
      const tamperedProof: GlobalDistrictProof = {
        ...proof,
        districtProof: {
          ...proof.districtProof,
          siblings: [
            proof.districtProof.siblings[1],
            proof.districtProof.siblings[0],
            ...proof.districtProof.siblings.slice(2),
          ],
        },
      };

      const isValid = builder.verifyProof(tamperedProof);
      expect(isValid).toBe(false);
    }
  });

  it('should reject proof with truncated siblings', () => {
    const builder = createGlobalMerkleTreeBuilder();
    const districts = createMultiCountryDataset();
    const tree = builder.build(districts);

    const proof = builder.generateProof(tree, 'US-CA-LA-CD01');

    // Truncate siblings
    const tamperedProof: GlobalDistrictProof = {
      ...proof,
      districtProof: {
        ...proof.districtProof,
        siblings: proof.districtProof.siblings.slice(0, -1),
        pathIndices: proof.districtProof.pathIndices.slice(0, -1),
      },
    };

    const isValid = builder.verifyProof(tamperedProof);
    expect(isValid).toBe(false);
  });
});

// ============================================================================
// Security Tests
// ============================================================================

describe('Security Properties', () => {
  it('should enforce BN254 field bounds for all hashes', () => {
    const builder = createGlobalMerkleTreeBuilder();
    const districts = createMultiCountryDataset();
    const tree = builder.build(districts);

    // Check global root
    expect(tree.globalRoot).toBeGreaterThanOrEqual(0n);
    expect(tree.globalRoot).toBeLessThan(BN254_FIELD_MODULUS);

    // Check all continental roots
    for (const continent of tree.continents) {
      expect(continent.root).toBeGreaterThanOrEqual(0n);
      expect(continent.root).toBeLessThan(BN254_FIELD_MODULUS);

      // Check all country roots
      for (const country of continent.countries) {
        expect(country.root).toBeGreaterThanOrEqual(0n);
        expect(country.root).toBeLessThan(BN254_FIELD_MODULUS);

        // Check all regional roots
        for (const region of country.regions) {
          expect(region.root).toBeGreaterThanOrEqual(0n);
          expect(region.root).toBeLessThan(BN254_FIELD_MODULUS);

          // Check all leaf hashes
          for (const leaf of region.leaves) {
            expect(leaf.leafHash).toBeGreaterThanOrEqual(0n);
            expect(leaf.leafHash).toBeLessThan(BN254_FIELD_MODULUS);
          }
        }
      }
    }
  });

  it('should prevent cross-country proof replay', () => {
    const builder = createGlobalMerkleTreeBuilder();
    const districts = createMultiCountryDataset();
    const tree = builder.build(districts);

    // Generate proof for US district
    const usProof = builder.generateProof(tree, 'US-CA-LA-CD01');

    // Generate proof for Canada district
    const caProof = builder.generateProof(tree, 'CA-ON-TOR-WD01');

    // Proofs should have different country roots
    expect(usProof.districtProof.countryRoot).not.toBe(
      caProof.districtProof.countryRoot
    );

    // Trying to use US district proof with Canada country root should fail
    const crossProof: GlobalDistrictProof = {
      districtProof: usProof.districtProof,
      countryProof: {
        ...caProof.countryProof,
        countryRoot: usProof.districtProof.countryRoot,  // Wrong country root
      },
      metadata: usProof.metadata,
    };

    const isValid = builder.verifyProof(crossProof);
    expect(isValid).toBe(false);
  });

  it('should enforce authority level in leaf hash', () => {
    const builder = createGlobalMerkleTreeBuilder();

    const district1 = createTestDistrict({
      id: 'US-CA-LA-CD01',
      name: 'Test District',
      country: 'US',
      region: 'CA',
      authority: GLOBAL_AUTHORITY_LEVELS.FEDERAL_MANDATE,
    });

    const district2 = createTestDistrict({
      id: 'US-CA-LA-CD01',
      name: 'Test District',
      country: 'US',
      region: 'CA',
      authority: GLOBAL_AUTHORITY_LEVELS.MUNICIPAL_OFFICIAL,
    });

    const tree1 = builder.build([district1]);
    const tree2 = builder.build([district2]);

    // Different authority levels → different roots
    expect(tree1.globalRoot).not.toBe(tree2.globalRoot);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('should handle single district per region', () => {
    const builder = createGlobalMerkleTreeBuilder();
    const districts = [
      createTestDistrict({
        id: 'US-CA-LA-CD01',
        name: 'Los Angeles District 1',
        country: 'US',
        region: 'CA',
      }),
    ];

    const tree = builder.build(districts);

    expect(tree.totalDistricts).toBe(1);
    expect(tree.globalRoot).toBeGreaterThan(0n);

    const proof = builder.generateProof(tree, 'US-CA-LA-CD01');
    expect(builder.verifyProof(proof)).toBe(true);
  });

  it('should handle single country', () => {
    const builder = createGlobalMerkleTreeBuilder();
    const districts = [
      createTestDistrict({
        id: 'US-CA-LA-CD01',
        name: 'District 1',
        country: 'US',
        region: 'CA',
      }),
      createTestDistrict({
        id: 'US-CA-LA-CD02',
        name: 'District 2',
        country: 'US',
        region: 'CA',
      }),
    ];

    const tree = builder.build(districts);

    expect(tree.totalDistricts).toBe(2);
    expect(tree.continents.length).toBeGreaterThan(0);

    const americas = tree.continents.find(c => c.continent === 'americas');
    expect(americas?.countries.length).toBe(1);
  });

  it('should handle multiple regions in single country', () => {
    const builder = createGlobalMerkleTreeBuilder();
    const districts = [
      createTestDistrict({
        id: 'US-CA-LA-CD01',
        name: 'CA District 1',
        country: 'US',
        region: 'CA',
      }),
      createTestDistrict({
        id: 'US-TX-HOU-CD01',
        name: 'TX District 1',
        country: 'US',
        region: 'TX',
      }),
      createTestDistrict({
        id: 'US-NY-NYC-CD01',
        name: 'NY District 1',
        country: 'US',
        region: 'NY',
      }),
    ];

    const tree = builder.build(districts);

    expect(tree.totalDistricts).toBe(3);

    const americas = tree.continents.find(c => c.continent === 'americas');
    const usa = americas?.countries.find(c => c.countryCode === 'US');

    expect(usa?.regions.length).toBe(3);
  });

  it('should handle very long district IDs (chunking test)', () => {
    const builder = createGlobalMerkleTreeBuilder();

    // Create district with very long ID (>31 bytes, triggers chunking)
    const longId = 'US-CA-' + 'A'.repeat(100) + '-CD01';

    const district = createTestDistrict({
      id: longId,
      name: 'Long ID District',
      country: 'US',
      region: 'CA',
    });

    const tree = builder.build([district]);

    expect(tree.totalDistricts).toBe(1);
    expect(tree.globalRoot).toBeGreaterThan(0n);

    const proof = builder.generateProof(tree, longId);
    expect(builder.verifyProof(proof)).toBe(true);
  });

  it('should handle unicode characters in district names', () => {
    const builder = createGlobalMerkleTreeBuilder();

    const districts = [
      createTestDistrict({
        id: 'DE-BY-MUC-01',
        name: 'München Wahlkreis 1',  // German umlaut
        country: 'DE',
        region: 'BY',
      }),
      createTestDistrict({
        id: 'FR-IDF-PAR-01',
        name: 'Île-de-France Circonscription 1',  // French accents
        country: 'FR',
        region: 'IDF',
      }),
      createTestDistrict({
        id: 'JP-TKY-01',
        name: '東京都第1区',  // Japanese kanji
        country: 'JP',
        region: 'TKY',
      }),
    ];

    const tree = builder.build(districts);

    expect(tree.totalDistricts).toBe(3);

    // All proofs should verify
    for (const district of districts) {
      const proof = builder.generateProof(tree, district.id);
      expect(builder.verifyProof(proof)).toBe(true);
    }
  });
});

// ============================================================================
// Performance Tests
// ============================================================================

describe('Performance', () => {
  it('should build tree for 100 districts in reasonable time', () => {
    const builder = createGlobalMerkleTreeBuilder();

    // Generate 100 districts across multiple countries
    const districts: GlobalDistrictInput[] = [];
    const countries = ['US', 'CA', 'GB', 'DE', 'FR', 'AU'];
    const regions = ['R1', 'R2', 'R3', 'R4', 'R5'];

    for (let i = 0; i < 100; i++) {
      const country = countries[i % countries.length];
      const region = regions[Math.floor(i / 20) % regions.length];

      districts.push(
        createTestDistrict({
          id: `${country}-${region}-D${i.toString().padStart(3, '0')}`,
          name: `District ${i}`,
          country,
          region,
        })
      );
    }

    const startTime = Date.now();
    const tree = builder.build(districts);
    const duration = Date.now() - startTime;

    expect(tree.totalDistricts).toBe(100);
    expect(duration).toBeLessThan(10000);  // Should complete in <10 seconds

    console.log(`Built tree for 100 districts in ${duration}ms`);
  });

  it('should generate proofs efficiently', () => {
    const builder = createGlobalMerkleTreeBuilder();
    const districts = createMultiCountryDataset();
    const tree = builder.build(districts);

    const startTime = Date.now();

    // Generate proofs for all districts
    for (const district of districts) {
      builder.generateProof(tree, district.id);
    }

    const duration = Date.now() - startTime;

    console.log(`Generated ${districts.length} proofs in ${duration}ms`);
    expect(duration).toBeLessThan(5000);  // Should be fast
  });
});
