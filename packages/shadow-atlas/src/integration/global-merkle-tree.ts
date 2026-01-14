/**
 * Global Merkle Tree Builder
 *
 * Builds hierarchical global Merkle tree for Shadow Atlas international coverage.
 * Implements Continental → Country → Region → District tree structure with
 * deterministic hashing and proof generation.
 *
 * ARCHITECTURE:
 * - Four-level hierarchy: Continental → Country → Region → District (leaf)
 * - Deterministic ordering: Lexicographic sorting at each level
 * - Keccak256 hashing: Ethereum-compatible (matches on-chain verification)
 * - Immutable structures: Readonly properties throughout
 *
 * DETERMINISM REQUIREMENTS:
 * - Same input districts → same root hash (critical for ZK proofs)
 * - Canonical ordering: Sort by continent/country/region/district IDs
 * - Consistent hashing: Keccak256(left || right) for all pairs
 *
 * USAGE:
 * ```typescript
 * const builder = new GlobalMerkleTreeBuilder();
 * const tree = await builder.buildTree(districts);
 * const proof = await builder.generateProof(tree, "us-ca-sf-district-1");
 * const valid = builder.verifyProof(proof);
 * ```
 *
 * @module global-merkle-tree
 */

import { keccak_256 } from '@noble/hashes/sha3';
import { logger } from '../core/utils/logger.js';
import type {
  ContinentalRegion,
  GlobalDistrictInput,
  GlobalMerkleTree,
  GlobalMerkleProof,
  ContinentalTree,
  CountryTree,
  RegionTree,
  LeafEntry,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Map ISO 3166-1 alpha-2 country codes to continental regions
 *
 * COMPREHENSIVE COVERAGE:
 * - 195 UN member states
 * - 2 UN observer states (Vatican City, Palestine)
 * - 6 partially recognized states
 * - Major territories and dependencies
 *
 * MAINTENANCE:
 * Update when new countries recognized or regions change.
 */
const COUNTRY_TO_CONTINENT: Record<string, ContinentalRegion> = {
  // Africa (54 countries)
  DZ: 'africa', AO: 'africa', BJ: 'africa', BW: 'africa', BF: 'africa',
  BI: 'africa', CM: 'africa', CV: 'africa', CF: 'africa', TD: 'africa',
  KM: 'africa', CG: 'africa', CD: 'africa', CI: 'africa', DJ: 'africa',
  EG: 'africa', GQ: 'africa', ER: 'africa', ET: 'africa', GA: 'africa',
  GM: 'africa', GH: 'africa', GN: 'africa', GW: 'africa', KE: 'africa',
  LS: 'africa', LR: 'africa', LY: 'africa', MG: 'africa', MW: 'africa',
  ML: 'africa', MR: 'africa', MU: 'africa', YT: 'africa', MA: 'africa',
  MZ: 'africa', NA: 'africa', NE: 'africa', NG: 'africa', RE: 'africa',
  RW: 'africa', ST: 'africa', SN: 'africa', SC: 'africa', SL: 'africa',
  SO: 'africa', ZA: 'africa', SS: 'africa', SD: 'africa', SZ: 'africa',
  TZ: 'africa', TG: 'africa', TN: 'africa', UG: 'africa', ZM: 'africa',
  ZW: 'africa',

  // Americas (35 countries + territories)
  AI: 'americas', AG: 'americas', AR: 'americas', AW: 'americas', BS: 'americas',
  BB: 'americas', BZ: 'americas', BM: 'americas', BO: 'americas', BR: 'americas',
  CA: 'americas', KY: 'americas', CL: 'americas', CO: 'americas', CR: 'americas',
  CU: 'americas', CW: 'americas', DM: 'americas', DO: 'americas', EC: 'americas',
  SV: 'americas', FK: 'americas', GF: 'americas', GL: 'americas', GD: 'americas',
  GP: 'americas', GT: 'americas', GY: 'americas', HT: 'americas', HN: 'americas',
  JM: 'americas', MQ: 'americas', MX: 'americas', MS: 'americas', NI: 'americas',
  PA: 'americas', PY: 'americas', PE: 'americas', PR: 'americas', BL: 'americas',
  KN: 'americas', LC: 'americas', MF: 'americas', PM: 'americas', VC: 'americas',
  SR: 'americas', TT: 'americas', TC: 'americas', US: 'americas', UY: 'americas',
  VE: 'americas', VG: 'americas', VI: 'americas',

  // Asia (50 countries + territories)
  AF: 'asia', AM: 'asia', AZ: 'asia', BH: 'asia', BD: 'asia',
  BT: 'asia', BN: 'asia', KH: 'asia', CN: 'asia', CX: 'asia',
  CC: 'asia', GE: 'asia', HK: 'asia', IN: 'asia', ID: 'asia',
  IR: 'asia', IQ: 'asia', IL: 'asia', JP: 'asia', JO: 'asia',
  KZ: 'asia', KP: 'asia', KR: 'asia', KW: 'asia', KG: 'asia',
  LA: 'asia', LB: 'asia', MO: 'asia', MY: 'asia', MV: 'asia',
  MN: 'asia', MM: 'asia', NP: 'asia', OM: 'asia', PK: 'asia',
  PS: 'asia', PH: 'asia', QA: 'asia', SA: 'asia', SG: 'asia',
  LK: 'asia', SY: 'asia', TW: 'asia', TJ: 'asia', TH: 'asia',
  TL: 'asia', TR: 'asia', TM: 'asia', AE: 'asia', UZ: 'asia',
  VN: 'asia', YE: 'asia',

  // Europe (51 countries + territories)
  AX: 'europe', AL: 'europe', AD: 'europe', AT: 'europe', BY: 'europe',
  BE: 'europe', BA: 'europe', BG: 'europe', HR: 'europe', CY: 'europe',
  CZ: 'europe', DK: 'europe', EE: 'europe', FO: 'europe', FI: 'europe',
  FR: 'europe', DE: 'europe', GI: 'europe', GR: 'europe', GG: 'europe',
  HU: 'europe', IS: 'europe', IE: 'europe', IM: 'europe', IT: 'europe',
  JE: 'europe', XK: 'europe', LV: 'europe', LI: 'europe', LT: 'europe',
  LU: 'europe', MK: 'europe', MT: 'europe', MD: 'europe', MC: 'europe',
  ME: 'europe', NL: 'europe', NO: 'europe', PL: 'europe', PT: 'europe',
  RO: 'europe', RU: 'europe', SM: 'europe', RS: 'europe', SK: 'europe',
  SI: 'europe', ES: 'europe', SJ: 'europe', SE: 'europe', CH: 'europe',
  UA: 'europe', GB: 'europe', VA: 'europe',

  // Oceania (27 countries + territories)
  AS: 'oceania', AU: 'oceania', CK: 'oceania', FJ: 'oceania', PF: 'oceania',
  GU: 'oceania', KI: 'oceania', MH: 'oceania', FM: 'oceania', NR: 'oceania',
  NC: 'oceania', NZ: 'oceania', NU: 'oceania', NF: 'oceania', MP: 'oceania',
  PW: 'oceania', PG: 'oceania', PN: 'oceania', WS: 'oceania', SB: 'oceania',
  TK: 'oceania', TO: 'oceania', TV: 'oceania', UM: 'oceania', VU: 'oceania',
  WF: 'oceania',
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Keccak256 hash function (Ethereum-compatible)
 *
 * @param data - Input string to hash
 * @returns Hex-encoded hash with 0x prefix
 */
function keccak256(data: string): string {
  const hash = keccak_256(data);
  return '0x' + Array.from(hash)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert bigint to hex string with 0x prefix
 *
 * @param value - BigInt value
 * @returns Hex string with 0x prefix
 */
function bigintToHex(value: bigint): string {
  return '0x' + value.toString(16).padStart(64, '0');
}

/**
 * Convert hex string to bigint
 *
 * @param hex - Hex string (with or without 0x prefix)
 * @returns BigInt value
 */
function hexToBigint(hex: string): bigint {
  return BigInt(hex.startsWith('0x') ? hex : '0x' + hex);
}

// ============================================================================
// GlobalMerkleTreeBuilder Class
// ============================================================================

/**
 * Builder for hierarchical global Merkle tree
 *
 * Constructs Continental → Country → Region → District tree structure
 * with deterministic ordering and cryptographic commitments at each level.
 */
export class GlobalMerkleTreeBuilder {
  /**
   * Map country ISO code to continental region
   *
   * @param countryISO - ISO 3166-1 alpha-2 country code
   * @returns Continental region
   * @throws Error if country code not recognized
   */
  private getContinentForCountry(countryISO: string): ContinentalRegion {
    const continent = COUNTRY_TO_CONTINENT[countryISO.toUpperCase()];
    if (!continent) {
      throw new Error(`Unknown country code: ${countryISO}`);
    }
    return continent;
  }

  /**
   * Hash district leaf data
   *
   * Computes Keccak256 hash of district metadata for leaf entry.
   * Uses deterministic serialization of essential fields.
   *
   * @param district - District input data
   * @returns Hex-encoded hash
   */
  private hashLeaf(district: GlobalDistrictInput): string {
    // Deterministic serialization
    const data = JSON.stringify({
      id: district.id,
      name: district.name,
      countryISO: district.countryISO,
      region: district.region,
      boundaryType: district.boundaryType,
      authority: district.authority,
      // Geometry hash (simplified - full implementation would hash geometry)
      bbox: district.bbox,
    });

    return keccak256(data);
  }

  /**
   * Hash a pair of nodes (non-commutative)
   *
   * Critical: Hash(left, right) ≠ Hash(right, left)
   * This ensures tree structure is encoded in the hash.
   *
   * @param left - Left child hash
   * @param right - Right child hash
   * @returns Parent hash
   */
  private hashPair(left: string, right: string): string {
    // Non-commutative: order matters
    return keccak256(left + right);
  }

  /**
   * Build Merkle root from array of hashes
   *
   * Constructs binary tree bottom-up, duplicating last node if odd count.
   * Returns root hash and intermediate tree layers.
   *
   * @param hashes - Leaf hashes (must be sorted for determinism)
   * @returns Object containing root hash and tree layers
   */
  private buildMerkleRoot(hashes: readonly string[]): {
    readonly root: string;
    readonly tree: readonly (readonly string[])[];
  } {
    if (hashes.length === 0) {
      throw new Error('Cannot build Merkle root from empty hash array');
    }

    if (hashes.length === 1) {
      return {
        root: hashes[0],
        tree: [hashes],
      };
    }

    const layers: string[][] = [Array.from(hashes)];
    let currentLayer = Array.from(hashes);

    while (currentLayer.length > 1) {
      const nextLayer: string[] = [];

      for (let i = 0; i < currentLayer.length; i += 2) {
        const left = currentLayer[i];
        const right = i + 1 < currentLayer.length
          ? currentLayer[i + 1]
          : left; // Duplicate if odd count

        nextLayer.push(this.hashPair(left, right));
      }

      layers.push(nextLayer);
      currentLayer = nextLayer;
    }

    return {
      root: currentLayer[0],
      tree: layers,
    };
  }

  /**
   * Group districts by hierarchical structure
   *
   * Organizes districts into nested maps:
   * Continent → Country → Region → Districts[]
   *
   * @param districts - All district inputs
   * @returns Nested map structure
   */
  private groupDistricts(
    districts: readonly GlobalDistrictInput[]
  ): ReadonlyMap<
    ContinentalRegion,
    ReadonlyMap<string, ReadonlyMap<string, readonly GlobalDistrictInput[]>>
  > {
    const continentMap = new Map<
      ContinentalRegion,
      Map<string, Map<string, GlobalDistrictInput[]>>
    >();

    for (const district of districts) {
      const continent = district.continent;
      const country = district.countryISO;
      const region = district.region;

      // Initialize nested structure
      if (!continentMap.has(continent)) {
        continentMap.set(continent, new Map());
      }

      const countryMap = continentMap.get(continent)!;
      if (!countryMap.has(country)) {
        countryMap.set(country, new Map());
      }

      const regionMap = countryMap.get(country)!;
      if (!regionMap.has(region)) {
        regionMap.set(region, []);
      }

      regionMap.get(region)!.push(district);
    }

    return continentMap;
  }

  /**
   * Build complete hierarchical global Merkle tree
   *
   * Constructs tree bottom-up:
   * 1. Build region trees (district leaves)
   * 2. Build country trees (region roots)
   * 3. Build continental trees (country roots)
   * 4. Build global tree (continental roots)
   *
   * @param districts - All district inputs
   * @returns Complete global Merkle tree
   */
  async buildTree(
    districts: readonly GlobalDistrictInput[]
  ): Promise<GlobalMerkleTree> {
    logger.info('Building global Merkle tree', {
      totalDistricts: districts.length,
    });

    if (districts.length === 0) {
      throw new Error('Cannot build tree from empty district set');
    }

    const startTime = Date.now();

    // Group districts by hierarchy
    const grouped = this.groupDistricts(districts);

    const continentTrees = new Map<ContinentalRegion, ContinentalTree>();

    // Build continental trees
    for (const [continent, countryMap] of grouped) {
      logger.info(`Building continental tree: ${continent}`);

      const countryTrees = new Map<string, CountryTree>();

      // Build country trees
      for (const [countryISO, regionMap] of countryMap) {
        logger.debug(`  Building country tree: ${countryISO}`);

        const regionTrees = new Map<string, RegionTree>();

        // Build region trees
        for (const [regionCode, regionDistricts] of regionMap) {
          logger.debug(`    Building region tree: ${regionCode}`, {
            districtCount: regionDistricts.length,
          });

          // Sort districts deterministically
          const sortedDistricts = [...regionDistricts].sort((a, b) =>
            a.id.localeCompare(b.id)
          );

          // Create leaf entries
          const leaves = new Map<string, LeafEntry>();
          const leafHashes: string[] = [];

          for (const district of sortedDistricts) {
            const hash = this.hashLeaf(district);

            leaves.set(district.id, {
              districtId: district.id,
              hash,
              metadata: {
                name: district.name,
                boundaryType: district.boundaryType,
                authority: district.authority,
              },
            });

            leafHashes.push(hash);
          }

          // Build region Merkle tree
          const { root, tree } = this.buildMerkleRoot(leafHashes);

          regionTrees.set(regionCode, {
            regionCode,
            root,
            leaves,
            tree,
          });
        }

        // Build country tree from region roots
        const sortedRegions = Array.from(regionTrees.keys()).sort();
        const regionRoots = sortedRegions.map(
          regionCode => regionTrees.get(regionCode)!.root
        );

        const { root: countryRoot, tree: countryTree } =
          this.buildMerkleRoot(regionRoots);

        countryTrees.set(countryISO, {
          countryISO,
          root: countryRoot,
          regions: regionTrees,
          tree: countryTree,
        });
      }

      // Build continental tree from country roots
      const sortedCountries = Array.from(countryTrees.keys()).sort();
      const countryRoots = sortedCountries.map(
        countryISO => countryTrees.get(countryISO)!.root
      );

      const { root: continentalRoot, tree: continentalTree } =
        this.buildMerkleRoot(countryRoots);

      continentTrees.set(continent, {
        continent,
        root: continentalRoot,
        countries: countryTrees,
        tree: continentalTree,
      });
    }

    // Build global tree from continental roots
    const sortedContinents = Array.from(continentTrees.keys()).sort();
    const continentalRoots = sortedContinents.map(
      continent => continentTrees.get(continent)!.root
    );

    const { root: globalRoot, tree: globalTree } =
      this.buildMerkleRoot(continentalRoots);

    const elapsedMs = Date.now() - startTime;

    logger.info('Global Merkle tree built successfully', {
      globalRoot,
      continents: continentTrees.size,
      totalDistricts: districts.length,
      elapsedMs,
    });

    return {
      root: globalRoot,
      continents: continentTrees,
      tree: globalTree,
      buildTimestamp: Date.now(),
      totalDistricts: districts.length,
      version: new Date().toISOString().slice(0, 7), // YYYY-MM format
    };
  }

  /**
   * Generate Merkle proof for district
   *
   * Produces hierarchical proof with paths at each level:
   * - District → Region
   * - Region → Country
   * - Country → Continent
   * - Continent → Global
   *
   * @param tree - Complete global Merkle tree
   * @param districtId - District ID to prove
   * @returns Hierarchical Merkle proof
   * @throws Error if district not found in tree
   */
  async generateProof(
    tree: GlobalMerkleTree,
    districtId: string
  ): Promise<GlobalMerkleProof> {
    logger.debug('Generating proof', { districtId });

    // Find district in tree
    let foundContinent: ContinentalRegion | null = null;
    let foundCountry: string | null = null;
    let foundRegion: string | null = null;
    let foundLeaf: LeafEntry | null = null;

    for (const [continent, continentalTree] of tree.continents) {
      for (const [countryISO, countryTree] of continentalTree.countries) {
        for (const [regionCode, regionTree] of countryTree.regions) {
          const leaf = regionTree.leaves.get(districtId);
          if (leaf) {
            foundContinent = continent;
            foundCountry = countryISO;
            foundRegion = regionCode;
            foundLeaf = leaf;
            break;
          }
        }
        if (foundLeaf) break;
      }
      if (foundLeaf) break;
    }

    if (!foundContinent || !foundCountry || !foundRegion || !foundLeaf) {
      throw new Error(`District not found in tree: ${districtId}`);
    }

    // Get trees
    const continentalTree = tree.continents.get(foundContinent)!;
    const countryTree = continentalTree.countries.get(foundCountry)!;
    const regionTree = countryTree.regions.get(foundRegion)!;

    // Generate district → region proof
    const districtToRegion = this.generatePathProof(
      regionTree.tree,
      Array.from(regionTree.leaves.keys()).sort(),
      districtId,
      regionTree.root
    );

    // Generate region → country proof
    const regionToCountry = this.generatePathProof(
      countryTree.tree,
      Array.from(countryTree.regions.keys()).sort(),
      foundRegion,
      countryTree.root
    );

    // Generate country → continent proof
    const countryToContinent = this.generatePathProof(
      continentalTree.tree,
      Array.from(continentalTree.countries.keys()).sort(),
      foundCountry,
      continentalTree.root
    );

    // Generate continent → global proof
    const continentToGlobal = this.generatePathProof(
      tree.tree,
      Array.from(tree.continents.keys()).sort(),
      foundContinent,
      tree.root
    );

    return {
      globalRoot: tree.root,
      districtId,
      districtHash: foundLeaf.hash,
      continent: foundContinent,
      countryISO: foundCountry,
      regionCode: foundRegion,
      districtToRegion,
      regionToCountry,
      countryToContinent,
      continentToGlobal,
      generatedAt: Date.now(),
      treeVersion: tree.version,
    };
  }

  /**
   * Generate Merkle path proof for single level
   *
   * @param tree - Tree layers
   * @param sortedKeys - Sorted keys at this level
   * @param targetKey - Key to prove
   * @param expectedRoot - Expected root hash
   * @returns Path proof with siblings and indices
   */
  private generatePathProof(
    tree: readonly (readonly string[])[],
    sortedKeys: readonly string[],
    targetKey: string,
    expectedRoot: string
  ): {
    readonly root: string;
    readonly siblings: readonly string[];
    readonly pathIndices: readonly number[];
  } {
    const leafIndex = sortedKeys.indexOf(targetKey);
    if (leafIndex === -1) {
      throw new Error(`Key not found in sorted keys: ${targetKey}`);
    }

    const siblings: string[] = [];
    const pathIndices: number[] = [];
    let currentIndex = leafIndex;

    for (let level = 0; level < tree.length - 1; level++) {
      const isRightNode = currentIndex % 2 === 1;
      const siblingIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;

      const siblingHash =
        tree[level][siblingIndex] || tree[level][currentIndex]; // Duplicate if no sibling

      siblings.push(siblingHash);
      pathIndices.push(isRightNode ? 1 : 0);

      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      root: expectedRoot,
      siblings,
      pathIndices,
    };
  }

  /**
   * Verify Merkle proof reconstructs global root
   *
   * Validates hierarchical proof at each level:
   * 1. District → Region
   * 2. Region → Country
   * 3. Country → Continent
   * 4. Continent → Global
   *
   * @param proof - Hierarchical Merkle proof
   * @returns true if proof is valid, false otherwise
   */
  verifyProof(proof: GlobalMerkleProof): boolean {
    try {
      // Verify district → region
      const regionRoot = this.verifyPath(
        proof.districtHash,
        proof.districtToRegion.siblings,
        proof.districtToRegion.pathIndices
      );

      if (regionRoot !== proof.districtToRegion.root) {
        logger.warn('Region root mismatch', { expected: proof.districtToRegion.root, computed: regionRoot });
        return false;
      }

      // Verify region → country
      const countryRoot = this.verifyPath(
        regionRoot,
        proof.regionToCountry.siblings,
        proof.regionToCountry.pathIndices
      );

      if (countryRoot !== proof.regionToCountry.root) {
        logger.warn('Country root mismatch', { expected: proof.regionToCountry.root, computed: countryRoot });
        return false;
      }

      // Verify country → continent
      const continentalRoot = this.verifyPath(
        countryRoot,
        proof.countryToContinent.siblings,
        proof.countryToContinent.pathIndices
      );

      if (continentalRoot !== proof.countryToContinent.root) {
        logger.warn('Continental root mismatch', { expected: proof.countryToContinent.root, computed: continentalRoot });
        return false;
      }

      // Verify continent → global
      const computedGlobalRoot = this.verifyPath(
        continentalRoot,
        proof.continentToGlobal.siblings,
        proof.continentToGlobal.pathIndices
      );

      if (computedGlobalRoot !== proof.globalRoot) {
        logger.warn('Global root mismatch', { expected: proof.globalRoot, computed: computedGlobalRoot });
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Proof verification error', { error: (error as Error).message });
      return false;
    }
  }

  /**
   * Verify single Merkle path
   *
   * @param leafHash - Starting leaf hash
   * @param siblings - Sibling hashes along path
   * @param pathIndices - Path directions (0 = left, 1 = right)
   * @returns Computed root hash
   */
  private verifyPath(
    leafHash: string,
    siblings: readonly string[],
    pathIndices: readonly number[]
  ): string {
    let computedHash = leafHash;

    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      const isRightNode = pathIndices[i] === 1;

      computedHash = isRightNode
        ? this.hashPair(sibling, computedHash)
        : this.hashPair(computedHash, sibling);
    }

    return computedHash;
  }
}

// ============================================================================
// Exports
// ============================================================================

export { keccak256, COUNTRY_TO_CONTINENT };
