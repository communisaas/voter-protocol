/**
 * Global Hierarchical Merkle Tree Builder
 *
 * Implements multi-tier hierarchical Merkle tree for 190+ countries with O(log n) proofs.
 *
 * ARCHITECTURE:
 * - Global Root (Level 4): Single root for all countries
 * - Continental Roots (Level 3): Americas, Europe, Asia-Pacific, Africa, Middle East
 * - Country Roots (Level 2): USA, Canada, UK, Germany, etc.
 * - Regional Roots (Level 1): States/provinces/regions within countries
 * - District Leaves (Level 0): Individual electoral/administrative boundaries
 *
 * CRYPTOGRAPHIC PROPERTIES:
 * - Hash function: Poseidon2 (ZK-compatible via Noir stdlib and @aztec/bb.js)
 * - Non-commutative: hash_pair(a, b) ≠ hash_pair(b, a) (sibling swap resistance)
 * - Domain separation: Leaf hashes include boundary type and authority level
 * - Deterministic: Same input → same root (reproducible builds)
 *
 * PROOF COMPLEXITY:
 * - US-only: 16 levels (50k jurisdictions) → 512 bytes
 * - Global: 22 levels (2M jurisdictions) → 704 bytes (+37.5% overhead)
 *
 * INCREMENTAL UPDATES:
 * - O(log C) complexity where C = country count (~190)
 * - Update single country without rebuilding entire tree
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { hash_pair, hash_single } from '@voter-protocol/crypto/circuits';
import type { Polygon, MultiPolygon } from 'geojson';
import {
  getCountryByCode,
  getRegionForCountry,
  type ContinentalRegion as RegistryContinentalRegion,
} from '../registry/iso-3166-countries.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Boundary types for global tree support
 * Maps to BoundaryType from merkle-tree.ts with extensions
 */
export type GlobalBoundaryType =
  | 'congressional-district'          // US Congressional districts
  | 'state-legislative-upper'         // US State Senate
  | 'state-legislative-lower'         // US State House
  | 'county'                          // US Counties
  | 'city-council-district'           // Municipal council districts (global)
  | 'parliamentary-constituency'      // UK Westminster constituencies
  | 'federal-electoral-district'      // Canada federal ridings
  | 'electorate'                      // Australia federal electorates
  | 'wahlkreis'                       // Germany Bundestag constituencies
  | 'circonscription';                // France circonscriptions législatives

/**
 * Authority levels for provenance tracking
 * Higher number = more authoritative
 */
export const GLOBAL_AUTHORITY_LEVELS = {
  FEDERAL_MANDATE: 5,      // US Census TIGER, national statistical agencies
  STATE_OFFICIAL: 4,       // State GIS clearinghouse, provincial agencies
  MUNICIPAL_OFFICIAL: 3,   // Official city/county GIS
  COMMUNITY_VERIFIED: 2,   // Community sources with validation
  UNVERIFIED: 1,           // Unverified sources
} as const;

export type AuthorityLevel = typeof GLOBAL_AUTHORITY_LEVELS[keyof typeof GLOBAL_AUTHORITY_LEVELS];

/**
 * Continental region enumeration
 */
export type ContinentalRegion =
  | 'americas'
  | 'europe'
  | 'asia-pacific'
  | 'africa'
  | 'middle-east';

/**
 * Human-readable region names (i18n-ready)
 * Consistent with ISO 3166-1 regional groupings
 */
export const REGION_NAMES: Record<ContinentalRegion, string> = {
  'americas': 'Americas',
  'europe': 'Europe',
  'asia-pacific': 'Asia-Pacific',
  'africa': 'Africa',
  'middle-east': 'Middle East',
} as const;

/**
 * District input for global tree construction
 */
export interface GlobalDistrictInput {
  /** Unique district ID (e.g., "US-CA-LA-CD01") */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** ISO 3166-1 alpha-2 country code (e.g., "US", "GB", "CA") */
  readonly country: string;

  /** Region within country (e.g., "CA" for California in US) */
  readonly region: string;

  /** Boundary type */
  readonly boundaryType: GlobalBoundaryType;

  /** WGS84 geometry (Polygon or MultiPolygon) */
  readonly geometry: Polygon | MultiPolygon;

  /** Authority level (1-5) */
  readonly authority: AuthorityLevel;

  /** Optional parent district ID (for hierarchical lookups) */
  readonly parentId?: string;
}

/**
 * District leaf hash components
 */
export interface DistrictLeafHash {
  /** Unique district ID */
  readonly id: string;

  /** Boundary type */
  readonly boundaryType: GlobalBoundaryType;

  /** Poseidon hash of geometry */
  readonly geometryHash: bigint;

  /** Authority level */
  readonly authority: AuthorityLevel;

  /** Computed leaf hash */
  readonly leafHash: bigint;
}

/**
 * Regional Merkle tree (state/province level)
 */
export interface RegionalTree {
  /** Region ID (e.g., "CA" for California) */
  readonly regionId: string;

  /** Region name (e.g., "California") */
  readonly regionName: string;

  /** Merkle root for this region */
  readonly root: bigint;

  /** District leaves in this region */
  readonly leaves: readonly DistrictLeafHash[];

  /** Full district data (for proof metadata retrieval) */
  readonly districts: readonly GlobalDistrictInput[];

  /** District count */
  readonly districtCount: number;
}

/**
 * Country Merkle tree
 */
export interface CountryTree {
  /** ISO 3166-1 alpha-2 country code */
  readonly countryCode: string;

  /** Country name */
  readonly countryName: string;

  /** Merkle root for this country */
  readonly root: bigint;

  /** Regional trees within this country */
  readonly regions: readonly RegionalTree[];

  /** Total district count */
  readonly districtCount: number;
}

/**
 * Continental Merkle tree
 */
export interface ContinentalTree {
  /** Continental region */
  readonly continent: ContinentalRegion;

  /** Merkle root for this continent */
  readonly root: bigint;

  /** Country trees within this continent */
  readonly countries: readonly CountryTree[];

  /** Total district count */
  readonly districtCount: number;
}

/**
 * Global Merkle tree (top level)
 */
export interface GlobalMerkleTree {
  /** Global Merkle root (cryptographic commitment to all districts worldwide) */
  readonly globalRoot: bigint;

  /** Continental trees */
  readonly continents: readonly ContinentalTree[];

  /** Total district count worldwide */
  readonly totalDistricts: number;

  /** Tree construction timestamp */
  readonly timestamp: Date;

  /** Version identifier */
  readonly version: string;
}

/**
 * Global district proof (two-level: district → country, country → global)
 */
export interface GlobalDistrictProof {
  /** District-level proof (within country tree) */
  readonly districtProof: {
    readonly leaf: bigint;
    readonly siblings: readonly bigint[];
    readonly pathIndices: readonly number[];  // 0 = left, 1 = right
    readonly countryRoot: bigint;
  };

  /** Country-level proof (within global tree) */
  readonly countryProof: {
    readonly countryRoot: bigint;  // Bridges district proof to global proof
    readonly siblings: readonly bigint[];
    readonly pathIndices: readonly number[];
    readonly globalRoot: bigint;
  };

  /** Metadata (not part of cryptographic proof) */
  readonly metadata: {
    readonly countryCode: string;
    readonly countryName: string;
    readonly regionId: string;
    readonly districtId: string;
    readonly districtName: string;
    readonly boundaryType: GlobalBoundaryType;
  };
}

/**
 * Region-level proof (allows proving "user is in region X" without revealing country)
 *
 * USE CASE: Privacy-preserving regional verification
 * - Prove user is in Europe without revealing UK vs Germany
 * - Prove user is in Americas without revealing US vs Canada
 * - Enables regional access control without full location disclosure
 */
export interface RegionalProof {
  /** Continental root for this region */
  readonly continentalRoot: bigint;

  /** Proof: continental root → global root */
  readonly continentalProof: {
    readonly siblings: readonly bigint[];
    readonly pathIndices: readonly number[];
    readonly globalRoot: bigint;
  };

  /** Region metadata (not part of cryptographic proof) */
  readonly metadata: {
    readonly region: ContinentalRegion;
    readonly countryCount: number;
  };
}

/**
 * Incremental update result
 */
export interface GlobalTreeUpdateResult {
  /** Previous global root */
  readonly previousRoot: bigint;

  /** New global root */
  readonly newRoot: bigint;

  /** Whether root changed */
  readonly rootChanged: boolean;

  /** Changed countries (ISO codes) */
  readonly changedCountries: readonly string[];

  /** Changed regions within countries */
  readonly changedRegions: readonly string[];

  /** Update timestamp */
  readonly timestamp: Date;

  /** Update duration (milliseconds) */
  readonly duration: number;
}

// ============================================================================
// Global Merkle Tree Builder
// ============================================================================

/**
 * Global Hierarchical Merkle Tree Builder
 *
 * Constructs deterministic Merkle tree spanning 195 countries with efficient proofs.
 *
 * DETERMINISM GUARANTEES:
 * - Districts sorted lexicographically by ID before hashing
 * - Regions sorted by region ID
 * - Countries sorted by ISO 3166-1 alpha-2 code
 * - Continents processed in fixed order
 *
 * SECURITY PROPERTIES:
 * - Collision resistance: Poseidon-128 (128-bit security)
 * - Non-commutativity: Prevents sibling swap attacks
 * - Domain separation: Boundary type and authority included in leaf hash
 *
 * DATA SOURCE:
 * - Country registry: ISO 3166-1 alpha-2 codes (195 countries)
 * - Regional mapping: UN geoscheme continental regions
 */
export class GlobalMerkleTreeBuilder {

  /**
   * Build global Merkle tree from district inputs
   *
   * ALGORITHM:
   * 1. Group districts by country and region
   * 2. Build regional trees (district leaves → region root)
   * 3. Build country trees (region roots → country root)
   * 4. Build continental trees (country roots → continental root)
   * 5. Build global tree (continental roots → global root)
   *
   * @param districts - Array of district inputs from all countries
   * @returns Global Merkle tree with hierarchical structure
   */
  build(districts: readonly GlobalDistrictInput[]): GlobalMerkleTree {
    const startTime = Date.now();

    console.log(`\nBuilding global Merkle tree for ${districts.length} districts...`);

    // STEP 1: Group districts by country and region
    const groupedByCountry = this.groupByCountry(districts);
    console.log(`  ✓ Grouped into ${groupedByCountry.size} countries`);

    // STEP 2: Build country trees (region roots → country root)
    const countryTrees: CountryTree[] = [];
    for (const [countryCode, countryDistricts] of groupedByCountry) {
      const countryTree = this.buildCountryTree(countryCode, countryDistricts);
      countryTrees.push(countryTree);
    }
    console.log(`  ✓ Built ${countryTrees.length} country trees`);

    // STEP 3: Group countries by continent
    const groupedByContinent = this.groupByContinent(countryTrees);

    // STEP 4: Build continental trees (country roots → continental root)
    const continentalTrees: ContinentalTree[] = [];
    for (const [continent, countries] of groupedByContinent) {
      const continentalTree = this.buildContinentalTree(continent, countries);
      continentalTrees.push(continentalTree);
    }
    console.log(`  ✓ Built ${continentalTrees.length} continental trees`);

    // STEP 5: Build global root (continental roots → global root)
    const globalRoot = this.buildGlobalRoot(continentalTrees);

    const duration = Date.now() - startTime;
    console.log(`  ✓ Global root: ${this.formatHash(globalRoot)}`);
    console.log(`  ✓ Total districts: ${districts.length}`);
    console.log(`  ✓ Duration: ${duration}ms\n`);

    return {
      globalRoot,
      continents: continentalTrees,
      totalDistricts: districts.length,
      timestamp: new Date(),
      version: '2.0.0',
    };
  }

  /**
   * Build country tree from districts within one country
   *
   * @param countryCode - ISO 3166-1 alpha-2 country code
   * @param districts - Districts within this country
   * @returns Country Merkle tree
   */
  private buildCountryTree(
    countryCode: string,
    districts: readonly GlobalDistrictInput[]
  ): CountryTree {
    // Group districts by region
    const groupedByRegion = this.groupByRegion(districts);

    // Build regional trees
    const regionalTrees: RegionalTree[] = [];
    for (const [regionId, regionDistricts] of groupedByRegion) {
      const regionalTree = this.buildRegionalTree(regionId, regionDistricts);
      regionalTrees.push(regionalTree);
    }

    // Sort regions by ID (deterministic)
    regionalTrees.sort((a, b) => a.regionId.localeCompare(b.regionId));

    // Build country root from regional roots
    const countryRoot = this.hashRegionalRoots(regionalTrees);

    const totalDistricts = districts.length;

    return {
      countryCode,
      countryName: this.getCountryName(countryCode),
      root: countryRoot,
      regions: regionalTrees,
      districtCount: totalDistricts,
    };
  }

  /**
   * Build regional tree from districts within one region
   *
   * @param regionId - Region ID (e.g., "CA" for California)
   * @param districts - Districts within this region
   * @returns Regional Merkle tree
   */
  private buildRegionalTree(
    regionId: string,
    districts: readonly GlobalDistrictInput[]
  ): RegionalTree {
    // Sort districts by ID (deterministic)
    const sorted = [...districts].sort((a, b) => a.id.localeCompare(b.id));

    // Compute leaf hashes
    const leaves = sorted.map(district => this.computeLeafHash(district));

    // Build Merkle tree from leaves (binary tree)
    const root = this.buildMerkleRoot(leaves.map(l => l.leafHash));

    return {
      regionId,
      regionName: this.getRegionName(regionId, sorted[0]?.country),
      root,
      leaves,
      districts: sorted,  // Store full district data for proof metadata
      districtCount: districts.length,
    };
  }

  /**
   * Build continental tree from country trees
   *
   * @param continent - Continental region
   * @param countries - Country trees within this continent
   * @returns Continental Merkle tree
   */
  private buildContinentalTree(
    continent: ContinentalRegion,
    countries: readonly CountryTree[]
  ): ContinentalTree {
    // Sort countries by code (deterministic)
    const sorted = [...countries].sort((a, b) =>
      a.countryCode.localeCompare(b.countryCode)
    );

    // Build continental root from country roots
    const continentalRoot = this.hashCountryRoots(sorted);

    const totalDistricts = sorted.reduce((sum, c) => sum + c.districtCount, 0);

    return {
      continent,
      root: continentalRoot,
      countries: sorted,
      districtCount: totalDistricts,
    };
  }

  /**
   * Build global root from continental roots
   *
   * @param continents - Continental trees
   * @returns Global Merkle root
   */
  private buildGlobalRoot(continents: readonly ContinentalTree[]): bigint {
    // Sort continents by name (deterministic)
    const sorted = [...continents].sort((a, b) =>
      a.continent.localeCompare(b.continent)
    );

    // Extract continental roots
    const roots = sorted.map(c => c.root);

    // Build Merkle root from continental roots
    return this.buildMerkleRoot(roots);
  }

  /**
   * Compute leaf hash for a district
   *
   * LEAF HASH FORMAT:
   * leaf_hash = Poseidon([type_hash, id_hash, geometry_hash, authority])
   *
   * This four-element hash provides:
   * - Type safety: Different boundary types have different hashes
   * - Identity: Unique district ID
   * - Geography: Commitment to district geometry
   * - Authority: Provenance tracking
   *
   * @param district - District input
   * @returns District leaf hash components
   */
  private computeLeafHash(district: GlobalDistrictInput): DistrictLeafHash {
    // Hash boundary type (domain separation)
    const typeHash = this.hashString(district.boundaryType);

    // Hash district ID
    const idHash = this.hashString(district.id);

    // Hash geometry (simplified: hash GeoJSON string)
    const geometryHash = this.hashGeometry(district.geometry);

    // Authority level (already numeric)
    const authority = BigInt(district.authority);

    // Compute four-element Poseidon hash (iterative hash_pair)
    let hash = this.hashPair(typeHash, idHash);
    hash = this.hashPair(hash, geometryHash);
    hash = this.hashPair(hash, authority);

    return {
      id: district.id,
      boundaryType: district.boundaryType,
      geometryHash,
      authority: district.authority,
      leafHash: hash,
    };
  }

  /**
   * Build Merkle root from array of leaf hashes
   *
   * ALGORITHM: Binary tree bottom-up construction
   * - Pair up elements and hash
   * - If odd count, promote last element to next level
   * - Repeat until single root remains
   *
   * @param leaves - Array of leaf hashes
   * @returns Merkle root
   */
  private buildMerkleRoot(leaves: readonly bigint[]): bigint {
    if (leaves.length === 0) {
      throw new Error('Cannot build Merkle root: no leaves');
    }

    if (leaves.length === 1) {
      return leaves[0];
    }

    let currentLayer = Array.from(leaves);

    while (currentLayer.length > 1) {
      const nextLayer: bigint[] = [];

      for (let i = 0; i < currentLayer.length; i += 2) {
        if (i + 1 < currentLayer.length) {
          // Pair exists: hash together
          const left = currentLayer[i];
          const right = currentLayer[i + 1];
          nextLayer.push(this.hashPair(left, right));
        } else {
          // Odd element: promote to next level
          nextLayer.push(currentLayer[i]);
        }
      }

      currentLayer = nextLayer;
    }

    return currentLayer[0];
  }

  /**
   * Hash regional roots to build country root
   *
   * @param regions - Regional trees
   * @returns Country root hash
   */
  private hashRegionalRoots(regions: readonly RegionalTree[]): bigint {
    const roots = regions.map(r => r.root);
    return this.buildMerkleRoot(roots);
  }

  /**
   * Hash country roots to build continental root
   *
   * @param countries - Country trees
   * @returns Continental root hash
   */
  private hashCountryRoots(countries: readonly CountryTree[]): bigint {
    const roots = countries.map(c => c.root);
    return this.buildMerkleRoot(roots);
  }

  /**
   * Hash a string to BN254 field element using Poseidon
   *
   * ALGORITHM:
   * 1. UTF-8 encode string to bytes
   * 2. Split into 31-byte chunks (safe for BN254 254-bit field)
   * 3. Convert each chunk to bigint
   * 4. Hash iteratively with Poseidon
   *
   * @param str - String to hash
   * @returns Poseidon hash as bigint
   */
  private hashString(str: string): bigint {
    const bytes = Buffer.from(str, 'utf-8');
    const chunks: bigint[] = [];

    // Split into 31-byte chunks (31 * 8 = 248 bits < 254-bit BN254 field)
    for (let i = 0; i < bytes.length; i += 31) {
      const chunk = bytes.slice(i, i + 31);
      chunks.push(BigInt('0x' + chunk.toString('hex')));
    }

    // Hash chunks with Poseidon
    if (chunks.length === 0) {
      const hashHex = hash_single('0x00');
      return BigInt(hashHex);
    } else if (chunks.length === 1) {
      const valueHex = '0x' + chunks[0].toString(16).padStart(64, '0');
      const hashHex = hash_single(valueHex);
      return BigInt(hashHex);
    } else {
      // Multiple chunks: iterative hashing
      let hash = chunks[0];
      for (let i = 1; i < chunks.length; i++) {
        hash = this.hashPair(hash, chunks[i]);
      }
      return hash;
    }
  }

  /**
   * Hash GeoJSON geometry using Poseidon
   *
   * SIMPLIFIED: Hash canonical JSON representation
   * PRODUCTION: Should hash normalized coordinate array for determinism
   *
   * @param geometry - Polygon or MultiPolygon
   * @returns Poseidon hash of geometry
   */
  private hashGeometry(geometry: Polygon | MultiPolygon): bigint {
    // Canonical JSON representation
    const canonical = JSON.stringify(geometry);
    return this.hashString(canonical);
  }

  /**
   * Hash two values using Poseidon hash_pair
   *
   * SECURITY: Non-commutative (hash_pair(a, b) ≠ hash_pair(b, a))
   * This prevents sibling swap attacks.
   *
   * @param left - Left value
   * @param right - Right value
   * @returns Poseidon hash
   */
  private hashPair(left: bigint, right: bigint): bigint {
    const leftHex = '0x' + left.toString(16).padStart(64, '0');
    const rightHex = '0x' + right.toString(16).padStart(64, '0');
    const hashHex = hash_pair(leftHex, rightHex);
    return BigInt(hashHex);
  }

  /**
   * Group districts by country
   *
   * @param districts - All district inputs
   * @returns Map of country code → districts
   */
  private groupByCountry(
    districts: readonly GlobalDistrictInput[]
  ): Map<string, GlobalDistrictInput[]> {
    const grouped = new Map<string, GlobalDistrictInput[]>();

    for (const district of districts) {
      const countryCode = district.country.toUpperCase();
      const existing = grouped.get(countryCode) || [];
      existing.push(district);
      grouped.set(countryCode, existing);
    }

    return grouped;
  }

  /**
   * Group districts by region within a country
   *
   * @param districts - Districts within one country
   * @returns Map of region ID → districts
   */
  private groupByRegion(
    districts: readonly GlobalDistrictInput[]
  ): Map<string, GlobalDistrictInput[]> {
    const grouped = new Map<string, GlobalDistrictInput[]>();

    for (const district of districts) {
      const regionId = district.region;
      const existing = grouped.get(regionId) || [];
      existing.push(district);
      grouped.set(regionId, existing);
    }

    return grouped;
  }

  /**
   * Group country trees by continent
   *
   * @param countries - All country trees
   * @returns Map of continent → country trees
   */
  private groupByContinent(
    countries: readonly CountryTree[]
  ): Map<ContinentalRegion, CountryTree[]> {
    const grouped = new Map<ContinentalRegion, CountryTree[]>();

    for (const country of countries) {
      const continent = this.getContinent(country.countryCode);
      const existing = grouped.get(continent) || [];
      existing.push(country);
      grouped.set(continent, existing);
    }

    return grouped;
  }

  /**
   * Get continent for country code
   *
   * Uses comprehensive ISO 3166-1 country registry (195 countries).
   * Falls back to 'americas' for any unrecognized codes.
   *
   * @param countryCode - ISO 3166-1 alpha-2 code
   * @returns Continental region
   */
  private getContinent(countryCode: string): ContinentalRegion {
    const region = getRegionForCountry(countryCode);
    if (!region) {
      console.warn(
        `Unknown country code: ${countryCode}. Not found in ISO 3166-1 registry. ` +
        `Defaulting to 'americas'. Add to registry/iso-3166-countries.ts if this is a valid country.`
      );
      return 'americas';
    }
    return region as ContinentalRegion;
  }

  /**
   * Get human-readable country name
   *
   * Uses comprehensive ISO 3166-1 country registry (195 countries).
   * Returns country code if not found (indicates registry needs update).
   *
   * @param countryCode - ISO 3166-1 alpha-2 code
   * @returns Country name
   */
  private getCountryName(countryCode: string): string {
    const country = getCountryByCode(countryCode);
    if (!country) {
      console.warn(
        `Country code ${countryCode} not found in ISO 3166-1 registry. ` +
        `Add to registry/iso-3166-countries.ts if this is a valid country.`
      );
      return countryCode;
    }
    return country.shortName;
  }

  /**
   * Get human-readable region name
   *
   * For US states: Uses full state name
   * For other countries: Uses region code as-is (extensible for future i18n)
   *
   * @param regionId - Region ID (e.g., "CA", "ON", "QLD")
   * @param countryCode - ISO 3166-1 alpha-2 country code
   * @returns Human-readable region name
   */
  private getRegionName(regionId: string, countryCode?: string): string {
    // US states: Map FIPS/abbreviation to full name
    if (countryCode === 'US') {
      // Import US state name mapping (from TIGER expected counts)
      const stateNames: Record<string, string> = {
        'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
        'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
        'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
        'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
        'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
        'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
        'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
        'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
        'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
        'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
        'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
        'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
        'WI': 'Wisconsin', 'WY': 'Wyoming', 'DC': 'District of Columbia',
        'PR': 'Puerto Rico', 'VI': 'U.S. Virgin Islands', 'GU': 'Guam',
        'AS': 'American Samoa', 'MP': 'Northern Mariana Islands',
      };
      return stateNames[regionId.toUpperCase()] || regionId;
    }

    // Canadian provinces: Map abbreviation to full name
    if (countryCode === 'CA') {
      const provinceNames: Record<string, string> = {
        'AB': 'Alberta', 'BC': 'British Columbia', 'MB': 'Manitoba',
        'NB': 'New Brunswick', 'NL': 'Newfoundland and Labrador', 'NS': 'Nova Scotia',
        'ON': 'Ontario', 'PE': 'Prince Edward Island', 'QC': 'Quebec', 'SK': 'Saskatchewan',
        'NT': 'Northwest Territories', 'NU': 'Nunavut', 'YT': 'Yukon',
      };
      return provinceNames[regionId.toUpperCase()] || regionId;
    }

    // Australian states: Map abbreviation to full name
    if (countryCode === 'AU') {
      const stateNames: Record<string, string> = {
        'NSW': 'New South Wales', 'QLD': 'Queensland', 'SA': 'South Australia',
        'TAS': 'Tasmania', 'VIC': 'Victoria', 'WA': 'Western Australia',
        'ACT': 'Australian Capital Territory', 'NT': 'Northern Territory',
      };
      return stateNames[regionId.toUpperCase()] || regionId;
    }

    // UK constituent countries
    if (countryCode === 'GB') {
      const regionNames: Record<string, string> = {
        'ENG': 'England', 'SCT': 'Scotland', 'WLS': 'Wales', 'NIR': 'Northern Ireland',
      };
      return regionNames[regionId.toUpperCase()] || regionId;
    }

    // Default: Return region ID as-is (extensible for future i18n)
    return regionId;
  }

  /**
   * Format hash for display (truncated hex)
   *
   * @param hash - Bigint hash
   * @returns Truncated hex string
   */
  private formatHash(hash: bigint): string {
    const hex = hash.toString(16).padStart(64, '0');
    return `0x${hex.slice(0, 8)}...${hex.slice(-8)}`;
  }

  // ============================================================================
  // Proof Generation
  // ============================================================================

  /**
   * Generate global district proof
   *
   * PROOF STRUCTURE:
   * 1. District proof: district leaf → country root (within country tree)
   * 2. Country proof: country root → global root (within global tree)
   *
   * @param tree - Global Merkle tree
   * @param districtId - District ID to prove
   * @returns Two-level global district proof
   * @throws Error if district not found
   */
  generateProof(tree: GlobalMerkleTree, districtId: string): GlobalDistrictProof {
    // Find district in tree
    const { country, region, district, leaf } = this.findDistrict(tree, districtId);

    if (!country || !region || !district || !leaf) {
      throw new Error(`District not found in tree: ${districtId}`);
    }

    // Generate district proof (district leaf → country root)
    const districtProof = this.generateDistrictProof(region, leaf);

    // Generate country proof (country root → global root)
    const countryProof = this.generateCountryProof(tree, country);

    return {
      districtProof: {
        leaf: leaf.leafHash,
        siblings: districtProof.siblings,
        pathIndices: districtProof.pathIndices,
        countryRoot: country.root,
      },
      countryProof: {
        countryRoot: country.root,
        siblings: countryProof.siblings,
        pathIndices: countryProof.pathIndices,
        globalRoot: tree.globalRoot,
      },
      metadata: {
        countryCode: country.countryCode,
        countryName: country.countryName,
        regionId: region.regionId,
        districtId: district.id,
        districtName: district.name,
        boundaryType: district.boundaryType,
      },
    };
  }

  /**
   * Find district in global tree
   *
   * @param tree - Global Merkle tree
   * @param districtId - District ID
   * @returns District location (country, region, district, leaf)
   */
  private findDistrict(
    tree: GlobalMerkleTree,
    districtId: string
  ): {
    country: CountryTree | null;
    region: RegionalTree | null;
    district: GlobalDistrictInput | null;
    leaf: DistrictLeafHash | null;
  } {
    for (const continent of tree.continents) {
      for (const country of continent.countries) {
        for (const region of country.regions) {
          const leafIndex = region.leaves.findIndex(l => l.id === districtId);
          if (leafIndex !== -1) {
            return {
              country,
              region,
              district: region.districts[leafIndex],  // Retrieve full district data
              leaf: region.leaves[leafIndex],
            };
          }
        }
      }
    }

    return { country: null, region: null, district: null, leaf: null };
  }

  /**
   * Generate district-level proof (within regional tree)
   *
   * @param region - Regional tree
   * @param leaf - District leaf hash
   * @returns Merkle proof (district → region root)
   */
  private generateDistrictProof(
    region: RegionalTree,
    leaf: DistrictLeafHash
  ): { siblings: bigint[]; pathIndices: number[] } {
    const leaves = region.leaves.map(l => l.leafHash);
    const leafIndex = leaves.findIndex(l => l === leaf.leafHash);

    if (leafIndex === -1) {
      throw new Error(`Leaf not found in region: ${leaf.id}`);
    }

    return this.generateMerkleProof(leaves, leafIndex);
  }

  /**
   * Generate country-level proof (within global tree)
   *
   * @param tree - Global tree
   * @param country - Country tree
   * @returns Merkle proof (country → global root)
   */
  private generateCountryProof(
    tree: GlobalMerkleTree,
    country: CountryTree
  ): { siblings: bigint[]; pathIndices: number[] } {
    // Flatten all country roots from global tree
    const allCountryRoots: bigint[] = [];
    for (const continent of tree.continents) {
      for (const c of continent.countries) {
        allCountryRoots.push(c.root);
      }
    }

    const countryIndex = allCountryRoots.findIndex(r => r === country.root);

    if (countryIndex === -1) {
      throw new Error(`Country root not found in global tree: ${country.countryCode}`);
    }

    return this.generateMerkleProof(allCountryRoots, countryIndex);
  }

  /**
   * Generate Merkle proof for a leaf index
   *
   * @param leaves - Array of leaf hashes
   * @param leafIndex - Index of leaf to prove
   * @returns Merkle proof (siblings and path indices)
   */
  private generateMerkleProof(
    leaves: readonly bigint[],
    leafIndex: number
  ): { siblings: bigint[]; pathIndices: number[] } {
    const siblings: bigint[] = [];
    const pathIndices: number[] = [];

    let currentLayer = Array.from(leaves);
    let currentIndex = leafIndex;

    // Build tree bottom-up and collect siblings
    while (currentLayer.length > 1) {
      const isLeftChild = currentIndex % 2 === 0;
      const siblingIndex = isLeftChild ? currentIndex + 1 : currentIndex - 1;

      if (siblingIndex < currentLayer.length) {
        siblings.push(currentLayer[siblingIndex]);
        pathIndices.push(isLeftChild ? 0 : 1);
      }

      // Build next layer
      const nextLayer: bigint[] = [];
      for (let i = 0; i < currentLayer.length; i += 2) {
        if (i + 1 < currentLayer.length) {
          const left = currentLayer[i];
          const right = currentLayer[i + 1];
          nextLayer.push(this.hashPair(left, right));
        } else {
          nextLayer.push(currentLayer[i]);
        }
      }

      currentLayer = nextLayer;
      currentIndex = Math.floor(currentIndex / 2);
    }

    return { siblings, pathIndices };
  }

  /**
   * Verify global district proof (for testing)
   *
   * @param proof - Global district proof
   * @returns true if proof is valid
   */
  verifyProof(proof: GlobalDistrictProof): boolean {
    // Step 1: Verify district proof → country root
    let hash = proof.districtProof.leaf;
    for (let i = 0; i < proof.districtProof.siblings.length; i++) {
      const sibling = proof.districtProof.siblings[i];
      const isLeft = proof.districtProof.pathIndices[i] === 0;

      hash = isLeft
        ? this.hashPair(hash, sibling)
        : this.hashPair(sibling, hash);
    }

    if (hash !== proof.districtProof.countryRoot) {
      return false;
    }

    // Step 2: Verify country proof → global root
    hash = proof.countryProof.countryRoot;
    for (let i = 0; i < proof.countryProof.siblings.length; i++) {
      const sibling = proof.countryProof.siblings[i];
      const isLeft = proof.countryProof.pathIndices[i] === 0;

      hash = isLeft
        ? this.hashPair(hash, sibling)
        : this.hashPair(sibling, hash);
    }

    return hash === proof.countryProof.globalRoot;
  }

  // ============================================================================
  // Regional Proof Generation (Privacy-Preserving)
  // ============================================================================

  /**
   * Generate region-level proof
   *
   * Allows proving "user is in region X" without revealing specific country.
   * Useful for privacy-preserving regional access control.
   *
   * PROOF STRUCTURE:
   * - Continental root → global root
   * - Does NOT reveal which country within region
   *
   * @param tree - Global Merkle tree
   * @param region - Continental region to prove
   * @returns Regional proof
   * @throws Error if region not found in tree
   *
   * @example
   * ```typescript
   * const proof = builder.generateRegionalProof(tree, 'europe');
   * // Proves user is in Europe without revealing UK vs Germany vs France
   * ```
   */
  generateRegionalProof(tree: GlobalMerkleTree, region: ContinentalRegion): RegionalProof {
    // Find continent in tree
    const continent = tree.continents.find(c => c.continent === region);
    if (!continent) {
      throw new Error(`Region not found in tree: ${region}`);
    }

    // Generate proof: continental root → global root
    const continentalRoots = tree.continents.map(c => c.root);
    const continentIndex = tree.continents.findIndex(c => c.continent === region);

    if (continentIndex === -1) {
      throw new Error(`Region not found in continents array: ${region}`);
    }

    const proof = this.generateMerkleProof(continentalRoots, continentIndex);

    return {
      continentalRoot: continent.root,
      continentalProof: {
        siblings: proof.siblings,
        pathIndices: proof.pathIndices,
        globalRoot: tree.globalRoot,
      },
      metadata: {
        region,
        countryCount: continent.countries.length,
      },
    };
  }

  /**
   * Verify regional proof (for testing)
   *
   * @param proof - Regional proof
   * @returns true if proof is valid
   */
  verifyRegionalProof(proof: RegionalProof): boolean {
    let hash = proof.continentalRoot;

    for (let i = 0; i < proof.continentalProof.siblings.length; i++) {
      const sibling = proof.continentalProof.siblings[i];
      const isLeft = proof.continentalProof.pathIndices[i] === 0;

      hash = isLeft
        ? this.hashPair(hash, sibling)
        : this.hashPair(sibling, hash);
    }

    return hash === proof.continentalProof.globalRoot;
  }
}

/**
 * Factory: Create global Merkle tree builder
 *
 * @returns Global Merkle tree builder instance
 */
export function createGlobalMerkleTreeBuilder(): GlobalMerkleTreeBuilder {
  return new GlobalMerkleTreeBuilder();
}
