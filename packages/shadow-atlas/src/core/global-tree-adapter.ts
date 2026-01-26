/**
 * Global Tree Adapter
 *
 * Bridges the gap between flat US-only Merkle trees and global hierarchical trees.
 * Provides backwards-compatible interface with automatic optimization for single-country builds.
 *
 * ARCHITECTURE:
 * - US-only builds: Skip hierarchy, use flat tree (existing optimization)
 * - Multi-country builds: Use GlobalMerkleTreeBuilder with continental grouping
 * - Automatic boundary conversion: ProcessedBoundary → GlobalDistrictInput
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { Polygon, MultiPolygon } from 'geojson';
import type {
  GlobalMerkleTreeBuilder,
  GlobalDistrictInput,
  GlobalMerkleTree,
  GlobalBoundaryType,
  AuthorityLevel,
} from './global-merkle-tree.js';
import { AUTHORITY_LEVELS } from './constants.js';
import type { MerkleBoundaryInput } from '../core/multi-layer-builder.js';
import type { MultiLayerMerkleTree } from '../core/multi-layer-builder.js';
import { BoundaryType } from '../core/types/boundary.js';

/**
 * Global tree configuration
 */
export interface GlobalTreeConfig {
  /** ISO 3166-1 alpha-2 country codes (e.g., ['US', 'CA', 'GB']) */
  readonly countries: readonly string[];

  /** Skip hierarchy for single-country optimization (faster builds) */
  readonly useSingleCountryOptimization: boolean;
}

/**
 * Unified tree result (either flat or global)
 */
export type UnifiedMerkleTree = {
  readonly type: 'flat';
  readonly tree: MultiLayerMerkleTree;
} | {
  readonly type: 'global';
  readonly tree: GlobalMerkleTree;
};

/**
 * Global Tree Adapter
 *
 * Converts between flat boundary arrays and global hierarchical trees.
 * Provides backwards compatibility while enabling multi-country support.
 */
export class GlobalTreeAdapter {
  constructor(
    private readonly globalBuilder: GlobalMerkleTreeBuilder,
    private readonly config: GlobalTreeConfig
  ) {}

  /**
   * Convert MerkleBoundaryInput to GlobalDistrictInput
   *
   * Maps flat boundary format to global hierarchical format.
   * Extracts region from boundary ID or jurisdiction metadata.
   *
   * @param boundaries - Flat boundaries from TIGER/municipal sources
   * @param countryCode - ISO 3166-1 alpha-2 country code
   * @returns Global district inputs with country + region metadata
   */
  convertBoundaries(
    boundaries: readonly MerkleBoundaryInput[],
    countryCode: string
  ): readonly GlobalDistrictInput[] {
    return boundaries.map(boundary => {
      // Extract region from boundary ID or jurisdiction
      // For US TIGER data: State FIPS is first 2 chars of GEOID
      // For other countries: Use jurisdiction field or default to country code
      const region = this.extractRegion(boundary, countryCode);

      // Map BoundaryType to GlobalBoundaryType
      const globalType = this.mapToGlobalBoundaryType(boundary.boundaryType);

      return {
        id: boundary.id,
        name: boundary.name,
        country: countryCode.toUpperCase(),
        region,
        boundaryType: globalType,
        geometry: boundary.geometry,
        authority: boundary.authority as AuthorityLevel,
        parentId: undefined, // Optional hierarchical lookup
      };
    });
  }

  /**
   * Build unified Merkle tree (flat or global depending on config)
   *
   * OPTIMIZATION: Single-country builds skip continental hierarchy.
   *
   * @param boundaries - Boundaries to commit
   * @param countryCode - Primary country code (defaults to 'US')
   * @returns Unified tree (flat or global)
   */
  async build(
    boundaries: readonly MerkleBoundaryInput[],
    countryCode: string = 'US'
  ): Promise<UnifiedMerkleTree> {
    // Check if we need hierarchy
    if (this.needsHierarchy()) {
      // Multi-country build: Use global hierarchical tree
      const globalDistricts = this.convertBoundaries(boundaries, countryCode);
      const globalTree = await this.globalBuilder.build(globalDistricts);

      return {
        type: 'global',
        tree: globalTree,
      };
    } else {
      // Single-country optimization: Use flat tree
      // Import MultiLayerMerkleTreeBuilder dynamically to avoid circular deps
      const { MultiLayerMerkleTreeBuilder } = await import('../core/multi-layer-builder.js');
      const flatBuilder = new MultiLayerMerkleTreeBuilder();

      // Group boundaries by type
      const layers = this.groupByBoundaryType(boundaries);
      const flatTree = await flatBuilder.buildTree(layers);

      return {
        type: 'flat',
        tree: flatTree,
      };
    }
  }

  /**
   * Determine if hierarchical tree is needed
   *
   * @returns true if multi-country or optimization disabled
   */
  private needsHierarchy(): boolean {
    if (!this.config.useSingleCountryOptimization) {
      return true; // User disabled optimization
    }

    return this.config.countries.length > 1;
  }

  /**
   * Extract region (state/province) from boundary
   *
   * For US TIGER data: Use first 2 chars of GEOID (state FIPS)
   * For other sources: Extract from jurisdiction or use country code
   *
   * @param boundary - Boundary input
   * @param countryCode - Country code
   * @returns Region ID (e.g., 'CA' for California, 'ON' for Ontario)
   */
  private extractRegion(
    boundary: MerkleBoundaryInput,
    countryCode: string
  ): string {
    if (countryCode === 'US') {
      // US TIGER GEOID format: SSCCCDDDD (SS=state, CCC=county, DDDD=district)
      // Extract first 2 chars as state FIPS
      if (boundary.id.length >= 2) {
        const stateFips = boundary.id.substring(0, 2);
        return stateFips;
      }
    }

    // Check jurisdiction field for region (e.g., "California, USA")
    if (boundary.jurisdiction) {
      const parts = boundary.jurisdiction.split(',').map(p => p.trim());
      if (parts.length > 0) {
        // Use first part as region (state/province name)
        return parts[0];
      }
    }

    // Fallback: Use country code as region (no subdivision)
    return countryCode.toUpperCase();
  }

  /**
   * Map BoundaryType to GlobalBoundaryType
   *
   * US boundary types map to canonical global types.
   * Since GlobalBoundaryType includes BoundaryType as a union member,
   * we can directly return the BoundaryType enum value.
   *
   * @param type - Canonical boundary type
   * @returns Global boundary type
   */
  private mapToGlobalBoundaryType(type: BoundaryType): GlobalBoundaryType {
    // GlobalBoundaryType = BoundaryType | international-types
    // BoundaryType enum values are already valid GlobalBoundaryType values
    return type;
  }

  /**
   * Group boundaries by type for flat tree construction
   *
   * @param boundaries - Flat boundaries
   * @returns Boundaries grouped by layer
   */
  private groupByBoundaryType(
    boundaries: readonly MerkleBoundaryInput[]
  ): {
    readonly congressionalDistricts?: readonly MerkleBoundaryInput[];
    readonly stateLegislativeUpper?: readonly MerkleBoundaryInput[];
    readonly stateLegislativeLower?: readonly MerkleBoundaryInput[];
    readonly counties?: readonly MerkleBoundaryInput[];
    readonly cityCouncilDistricts?: readonly MerkleBoundaryInput[];
  } {
    const grouped: {
      congressionalDistricts?: MerkleBoundaryInput[];
      stateLegislativeUpper?: MerkleBoundaryInput[];
      stateLegislativeLower?: MerkleBoundaryInput[];
      counties?: MerkleBoundaryInput[];
      cityCouncilDistricts?: MerkleBoundaryInput[];
    } = {};

    for (const boundary of boundaries) {
      if (boundary.boundaryType === BoundaryType.CONGRESSIONAL_DISTRICT) {
        if (!grouped.congressionalDistricts) {
          grouped.congressionalDistricts = [];
        }
        grouped.congressionalDistricts.push(boundary);
      } else if (boundary.boundaryType === BoundaryType.STATE_LEGISLATIVE_UPPER) {
        if (!grouped.stateLegislativeUpper) {
          grouped.stateLegislativeUpper = [];
        }
        grouped.stateLegislativeUpper.push(boundary);
      } else if (boundary.boundaryType === BoundaryType.STATE_LEGISLATIVE_LOWER) {
        if (!grouped.stateLegislativeLower) {
          grouped.stateLegislativeLower = [];
        }
        grouped.stateLegislativeLower.push(boundary);
      } else if (boundary.boundaryType === BoundaryType.COUNTY) {
        if (!grouped.counties) {
          grouped.counties = [];
        }
        grouped.counties.push(boundary);
      } else if (
        boundary.boundaryType === BoundaryType.CITY_COUNCIL_DISTRICT ||
        boundary.boundaryType === BoundaryType.CITY_COUNCIL_WARD
      ) {
        if (!grouped.cityCouncilDistricts) {
          grouped.cityCouncilDistricts = [];
        }
        grouped.cityCouncilDistricts.push(boundary);
      }
    }

    return grouped;
  }
}

/**
 * Extract country roots from global tree
 *
 * Flattens hierarchical tree to country-level roots for on-chain commitment.
 *
 * @param tree - Global Merkle tree
 * @returns Map of ISO code → country root
 */
export function extractCountryRoots(
  tree: GlobalMerkleTree
): ReadonlyMap<string, bigint> {
  const roots = new Map<string, bigint>();

  for (const continent of tree.continents) {
    for (const country of continent.countries) {
      roots.set(country.countryCode, country.root);
    }
  }

  return roots;
}

/**
 * Extract continental roots from global tree
 *
 * @param tree - Global Merkle tree
 * @returns Map of continent → continental root
 */
export function extractContinentalRoots(
  tree: GlobalMerkleTree
): ReadonlyMap<string, bigint> {
  const roots = new Map<string, bigint>();

  for (const continent of tree.continents) {
    roots.set(continent.continent, continent.root);
  }

  return roots;
}
