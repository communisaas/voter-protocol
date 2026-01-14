/**
 * Global Merkle Tree Integration Types
 *
 * Type definitions for Shadow Atlas global hierarchical Merkle tree architecture.
 * Extends core boundary types for international multi-jurisdictional coverage.
 *
 * ARCHITECTURE:
 * - Hierarchical: Continental → Country → Region → District (leaf)
 * - Content-addressed: Poseidon hashes at each level
 * - Cryptographic: Zero-knowledge proof support via hierarchical paths
 * - Immutable: Readonly properties throughout
 *
 * NUCLEAR TYPE SAFETY:
 * - No `any` types (ZERO TOLERANCE)
 * - Explicit types for all parameters and returns
 * - Readonly properties prevent mutation
 * - Type guards for runtime validation
 */

import type { Polygon, MultiPolygon } from 'geojson';
import type { BoundaryType } from '../core/types/boundary.js';
import type { ProvenanceMetadata } from '../core/types/provenance.js';

// ============================================================================
// Continental Regions
// ============================================================================

/**
 * Continental regions for hierarchical tree organization
 *
 * Top-level partitioning of global district data.
 * Five continental regions + Antarctica (empty set for civic purposes).
 */
export type ContinentalRegion =
  | 'africa'
  | 'americas'
  | 'asia'
  | 'europe'
  | 'oceania';

// ============================================================================
// Global Boundary Types (International Extensions)
// ============================================================================

/**
 * Global boundary types extending US-centric BoundaryType
 *
 * Adds international governance structures while maintaining
 * compatibility with core BoundaryType enum.
 *
 * NAMING CONVENTION: {country}-{district-type}
 * Examples:
 * - UK: parliamentary-constituency, ward, london-borough
 * - Canada: federal-electoral-district, provincial-riding
 * - Australia: federal-electorate, state-electorate, local-government-area
 * - India: lok-sabha-constituency, vidhan-sabha-constituency
 */
export type GlobalBoundaryType =
  | BoundaryType
  // United Kingdom
  | 'uk-parliamentary-constituency'
  | 'uk-ward'
  | 'uk-london-borough'
  | 'uk-metropolitan-district'
  | 'uk-unitary-authority'
  // Canada
  | 'canada-federal-electoral-district'
  | 'canada-provincial-riding'
  | 'canada-municipal-ward'
  // Australia
  | 'australia-federal-electorate'
  | 'australia-state-electorate'
  | 'australia-local-government-area'
  // India
  | 'india-lok-sabha-constituency'
  | 'india-vidhan-sabha-constituency'
  | 'india-municipal-ward'
  // Germany
  | 'germany-bundestag-wahlkreis'
  | 'germany-landtag-wahlkreis'
  | 'germany-gemeinde'
  // France
  | 'france-circonscription'
  | 'france-commune'
  | 'france-arrondissement'
  // Japan
  | 'japan-shugi-in-district'
  | 'japan-sangi-in-district'
  | 'japan-shi-ku-machi-mura'
  // Brazil
  | 'brazil-federal-district'
  | 'brazil-state-district'
  | 'brazil-municipal-district'
  // Generic fallback for unmapped jurisdictions
  | 'international-administrative-district';

// ============================================================================
// Global District Input (Raw Data)
// ============================================================================

/**
 * Input district for building global Merkle tree
 *
 * Raw district data before tree construction.
 * Contains all metadata needed for hierarchical organization.
 *
 * REQUIREMENTS:
 * - Globally unique ID (format: {country-iso}-{region}-{district-id})
 * - Valid ISO 3166-1 alpha-2 country code
 * - Continental region assignment
 * - GeoJSON geometry (Polygon or MultiPolygon)
 * - Full provenance tracking
 */
export interface GlobalDistrictInput {
  readonly id: string;                      // "us-ca-sf-district-1"
  readonly name: string;                    // "District 1"
  readonly countryISO: string;              // "US" (ISO 3166-1 alpha-2)
  readonly region: string;                  // "CA" (state/province/region)
  readonly continent: ContinentalRegion;    // "americas"
  readonly geometry: Polygon | MultiPolygon;
  readonly boundaryType: GlobalBoundaryType;
  readonly authority: string;               // "San Francisco Board of Supervisors"
  readonly provenance: ProvenanceMetadata;
  readonly bbox: readonly [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  readonly validFrom: Date;
  readonly validUntil?: Date;               // undefined = current
}

// ============================================================================
// Merkle Tree Structures (Hierarchical)
// ============================================================================

/**
 * Leaf entry in regional tree
 *
 * Individual district leaf containing:
 * - Poseidon hash of district data
 * - Metadata for proof generation
 * - Reference to input district
 */
export interface LeafEntry {
  readonly districtId: string;
  readonly hash: string;                    // Hex string (Poseidon hash)
  readonly metadata: {
    readonly name: string;
    readonly boundaryType: GlobalBoundaryType;
    readonly authority: string;
  };
}

/**
 * Region tree (finest granularity)
 *
 * Contains district leaves for a specific region within a country.
 * Examples:
 * - US: "CA" (California)
 * - UK: "England"
 * - Canada: "ON" (Ontario)
 */
export interface RegionTree {
  readonly regionCode: string;              // "CA", "England", "ON"
  readonly root: string;                    // Merkle root (hex string)
  readonly leaves: ReadonlyMap<string, LeafEntry>; // districtId → leaf
  readonly tree: readonly (readonly string[])[]; // Merkle tree layers
}

/**
 * Country tree (aggregates regions)
 *
 * Contains region trees for a specific country.
 * Root hash commits to all regional roots.
 */
export interface CountryTree {
  readonly countryISO: string;              // "US", "GB", "CA"
  readonly root: string;                    // Merkle root (hex string)
  readonly regions: ReadonlyMap<string, RegionTree>; // regionCode → region tree
  readonly tree: readonly (readonly string[])[]; // Merkle tree over region roots
}

/**
 * Continental tree (aggregates countries)
 *
 * Contains country trees for a specific continent.
 * Root hash commits to all country roots within continent.
 */
export interface ContinentalTree {
  readonly continent: ContinentalRegion;
  readonly root: string;                    // Merkle root (hex string)
  readonly countries: ReadonlyMap<string, CountryTree>; // countryISO → country tree
  readonly tree: readonly (readonly string[])[]; // Merkle tree over country roots
}

/**
 * Global Merkle tree (top level)
 *
 * Complete hierarchical tree structure covering all districts globally.
 * Root hash is single cryptographic commitment to entire dataset.
 *
 * STRUCTURE:
 * - Global root commits to 5 continental roots
 * - Each continental root commits to N country roots
 * - Each country root commits to M region roots
 * - Each region root commits to K district leaves
 *
 * PROOF GENERATION:
 * Client proves district membership by providing:
 * 1. District leaf hash
 * 2. Merkle path to region root
 * 3. Merkle path from region root to country root
 * 4. Merkle path from country root to continental root
 * 5. Merkle path from continental root to global root
 */
export interface GlobalMerkleTree {
  readonly root: string;                    // Global Merkle root (hex string)
  readonly continents: ReadonlyMap<ContinentalRegion, ContinentalTree>;
  readonly tree: readonly (readonly string[])[]; // Merkle tree over continental roots
  readonly buildTimestamp: number;          // Unix timestamp (milliseconds)
  readonly totalDistricts: number;
  readonly version: string;                 // Semantic version (e.g., "2025-Q1")
}

// ============================================================================
// Merkle Proof (Hierarchical)
// ============================================================================

/**
 * Global Merkle proof for district membership
 *
 * Hierarchical proof with paths at each level:
 * - District → Region
 * - Region → Country
 * - Country → Continent
 * - Continent → Global
 *
 * VERIFICATION:
 * 1. Verify leaf hash matches district data
 * 2. Verify path from leaf to region root
 * 3. Verify path from region root to country root
 * 4. Verify path from country root to continental root
 * 5. Verify path from continental root to global root
 * 6. Compare computed global root with published root
 *
 * ZERO-KNOWLEDGE USAGE:
 * Circuit proves:
 * - "I know a district D with hash H"
 * - "H is a leaf in region R with root R_root"
 * - "R_root is in country C with root C_root"
 * - "C_root is in continent CT with root CT_root"
 * - "CT_root is in global tree with root G_root"
 * - "G_root matches published commitment"
 * WITHOUT revealing district ID or address.
 */
export interface GlobalMerkleProof {
  // Global tree commitment
  readonly globalRoot: string;              // Expected global root (hex)

  // District identification (private in ZK proof)
  readonly districtId: string;
  readonly districtHash: string;            // Leaf hash (hex)

  // Hierarchical location
  readonly continent: ContinentalRegion;
  readonly countryISO: string;
  readonly regionCode: string;

  // Merkle paths at each level
  readonly districtToRegion: {
    readonly root: string;                  // Region root
    readonly siblings: readonly string[];   // Sibling hashes
    readonly pathIndices: readonly number[]; // 0 = left, 1 = right
  };

  readonly regionToCountry: {
    readonly root: string;                  // Country root
    readonly siblings: readonly string[];
    readonly pathIndices: readonly number[];
  };

  readonly countryToContinent: {
    readonly root: string;                  // Continental root
    readonly siblings: readonly string[];
    readonly pathIndices: readonly number[];
  };

  readonly continentToGlobal: {
    readonly root: string;                  // Global root (should match globalRoot)
    readonly siblings: readonly string[];
    readonly pathIndices: readonly number[];
  };

  // Metadata (for debugging/audit)
  readonly generatedAt: number;             // Unix timestamp
  readonly treeVersion: string;             // Tree version (e.g., "2025-Q1")
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard: Check if value is valid ContinentalRegion
 */
export function isContinentalRegion(value: unknown): value is ContinentalRegion {
  return (
    typeof value === 'string' &&
    ['africa', 'americas', 'asia', 'europe', 'oceania'].includes(value)
  );
}

/**
 * Type guard: Check if value is valid GlobalDistrictInput
 */
export function isGlobalDistrictInput(value: unknown): value is GlobalDistrictInput {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.countryISO === 'string' &&
    typeof obj.region === 'string' &&
    isContinentalRegion(obj.continent) &&
    typeof obj.geometry === 'object' &&
    typeof obj.boundaryType === 'string' &&
    typeof obj.authority === 'string' &&
    typeof obj.provenance === 'object' &&
    Array.isArray(obj.bbox) &&
    obj.bbox.length === 4 &&
    obj.validFrom instanceof Date
  );
}

/**
 * Type guard: Check if value is valid LeafEntry
 */
export function isLeafEntry(value: unknown): value is LeafEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.districtId === 'string' &&
    typeof obj.hash === 'string' &&
    typeof obj.metadata === 'object' &&
    obj.metadata !== null
  );
}

/**
 * Type guard: Check if value is valid GlobalMerkleTree
 */
export function isGlobalMerkleTree(value: unknown): value is GlobalMerkleTree {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.root === 'string' &&
    obj.continents instanceof Map &&
    Array.isArray(obj.tree) &&
    typeof obj.buildTimestamp === 'number' &&
    typeof obj.totalDistricts === 'number' &&
    typeof obj.version === 'string'
  );
}

/**
 * Type guard: Check if value is valid GlobalMerkleProof
 */
export function isGlobalMerkleProof(value: unknown): value is GlobalMerkleProof {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.globalRoot === 'string' &&
    typeof obj.districtId === 'string' &&
    typeof obj.districtHash === 'string' &&
    isContinentalRegion(obj.continent) &&
    typeof obj.countryISO === 'string' &&
    typeof obj.regionCode === 'string' &&
    typeof obj.districtToRegion === 'object' &&
    typeof obj.regionToCountry === 'object' &&
    typeof obj.countryToContinent === 'object' &&
    typeof obj.continentToGlobal === 'object' &&
    typeof obj.generatedAt === 'number' &&
    typeof obj.treeVersion === 'string'
  );
}
