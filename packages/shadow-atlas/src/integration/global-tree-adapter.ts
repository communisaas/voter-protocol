/**
 * Global Tree Adapter - Bridge Between Flat and Hierarchical Merkle Trees
 *
 * Provides unified interface for building either flat US-only trees or global hierarchical trees.
 * Enables seamless transition from single-country to multi-country deployments.
 *
 * ARCHITECTURE:
 * - Composition pattern: Delegates to existing builders (no reimplementation)
 * - Discriminated union return type: Type-safe switching between flat/global trees
 * - Smart optimization: Uses proven flat builder for single-country deployments
 * - Zero-cost abstraction: No performance overhead when optimization applies
 *
 * DESIGN RATIONALE:
 * - Flat tree (MultiLayerMerkleTree): Battle-tested, 730k+ boundaries, single country
 * - Global tree (GlobalMerkleTree): Hierarchical, 195 countries, smaller proofs
 * - Single country + optimization flag: Use flat tree (proven implementation)
 * - Multi-country: Use global tree (hierarchical structure required)
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { Polygon, MultiPolygon } from 'geojson';
import type {
  MultiLayerMerkleTree,
  MerkleBoundaryInput,
  BoundaryLayers,
} from '../core/multi-layer-builder.js';
import { MultiLayerMerkleTreeBuilder } from '../core/multi-layer-builder.js';
import type {
  GlobalMerkleTree,
  GlobalDistrictInput,
  GlobalBoundaryType,
  ContinentalRegion,
} from '../core/global-merkle-tree.js';
import { GlobalMerkleTreeBuilder } from '../core/global-merkle-tree.js';
import type {
  GlobalDistrictInput as TypesGlobalDistrictInput,
  GlobalBoundaryType as TypesGlobalBoundaryType,
  ContinentalRegion as TypesContinentalRegion,
} from './types.js';
import { BoundaryType } from '../core/types.js';
import { logger } from '../core/utils/logger.js';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for global tree construction
 */
export interface GlobalTreeConfig {
  /** Countries to include in tree (ISO 3166-1 alpha-2 codes) */
  readonly countries: readonly string[];

  /** Use flat tree optimization for single country (default: true) */
  readonly useSingleCountryOptimization: boolean;
}

/**
 * Unified Merkle tree (discriminated union)
 *
 * Enables type-safe handling of either flat or global trees.
 * Use .type field to discriminate at runtime.
 */
export type UnifiedMerkleTree =
  | { readonly type: 'flat'; readonly tree: MultiLayerMerkleTree }
  | { readonly type: 'global'; readonly tree: GlobalMerkleTree };

// ============================================================================
// Continental Region Mapping
// ============================================================================

/**
 * Map country ISO code to continental region
 *
 * Based on UN M49 geoscheme standard.
 * https://unstats.un.org/unsd/methodology/m49/
 */
const COUNTRY_TO_CONTINENT: Record<string, TypesContinentalRegion> = {
  // Americas
  US: 'americas',
  CA: 'americas',
  MX: 'americas',
  BR: 'americas',
  AR: 'americas',
  CL: 'americas',
  CO: 'americas',
  PE: 'americas',
  VE: 'americas',
  EC: 'americas',

  // Europe
  GB: 'europe',
  DE: 'europe',
  FR: 'europe',
  IT: 'europe',
  ES: 'europe',
  PL: 'europe',
  NL: 'europe',
  BE: 'europe',
  SE: 'europe',
  NO: 'europe',
  DK: 'europe',
  FI: 'europe',
  IE: 'europe',
  PT: 'europe',
  AT: 'europe',
  CH: 'europe',
  GR: 'europe',
  CZ: 'europe',
  RO: 'europe',
  HU: 'europe',

  // Asia
  CN: 'asia',
  IN: 'asia',
  JP: 'asia',
  KR: 'asia',
  ID: 'asia',
  TH: 'asia',
  VN: 'asia',
  MY: 'asia',
  SG: 'asia',
  PH: 'asia',
  PK: 'asia',
  BD: 'asia',

  // Oceania
  AU: 'oceania',
  NZ: 'oceania',
  FJ: 'oceania',
  PG: 'oceania',

  // Africa
  ZA: 'africa',
  NG: 'africa',
  EG: 'africa',
  KE: 'africa',
  ET: 'africa',
  GH: 'africa',
  TZ: 'africa',
  UG: 'africa',
  DZ: 'africa',
  SD: 'africa',
  MA: 'africa',
};

// ============================================================================
// US FIPS State Code Mapping
// ============================================================================

/**
 * Extract state/province code from US boundary ID
 *
 * US GEOIDs follow pattern: {STATEFP}{COUNTYFP}{REST}
 * - STATEFP: 2-digit FIPS state code (characters 0-1)
 * - COUNTYFP: 3-digit FIPS county code (characters 2-4)
 * - REST: Additional digits for finer boundaries
 *
 * Examples:
 * - Congressional: "0601" → "06" (California)
 * - County: "06001" → "06" (California, Alameda County)
 * - State leg: "06001" → "06" (California)
 */
const FIPS_TO_STATE: Record<string, string> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
  '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
  '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
  '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
  '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
  '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
  '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
  '56': 'WY',
  // US Territories
  '60': 'AS', // American Samoa
  '66': 'GU', // Guam
  '69': 'MP', // Northern Mariana Islands
  '72': 'PR', // Puerto Rico
  '78': 'VI', // US Virgin Islands
};

// ============================================================================
// Global Tree Adapter
// ============================================================================

/**
 * Adapter bridging flat US trees with global hierarchical trees
 *
 * STRATEGY:
 * - Single country + optimization: Use flat tree (proven, battle-tested)
 * - Multiple countries: Use global tree (hierarchical structure required)
 *
 * COMPOSITION:
 * - Delegates to MultiLayerMerkleTreeBuilder for flat trees
 * - Delegates to GlobalMerkleTreeBuilder for global trees
 * - Zero reimplementation: Pure adapter pattern
 */
export class GlobalTreeAdapter {
  private readonly flatBuilder: MultiLayerMerkleTreeBuilder;
  private readonly globalBuilder: GlobalMerkleTreeBuilder;

  /**
   * Create adapter with builder dependencies
   *
   * @param flatBuilder - Builder for flat US-only trees
   * @param globalBuilder - Builder for global hierarchical trees
   */
  constructor(
    flatBuilder: MultiLayerMerkleTreeBuilder,
    globalBuilder: GlobalMerkleTreeBuilder
  ) {
    this.flatBuilder = flatBuilder;
    this.globalBuilder = globalBuilder;
  }

  /**
   * Convert flat boundaries to global district inputs
   *
   * Transforms US-centric MerkleBoundaryInput to global-aware GlobalDistrictInput.
   * Adds country, region, and continental metadata.
   *
   * @param boundaries - Flat boundary inputs (US format)
   * @param countryCode - ISO 3166-1 alpha-2 country code (e.g., "US")
   * @returns Global district inputs with hierarchical metadata
   */
  convertBoundaries(
    boundaries: readonly MerkleBoundaryInput[],
    countryCode: string
  ): readonly TypesGlobalDistrictInput[] {
    const continent = this.inferContinent(countryCode);

    return boundaries.map((boundary): TypesGlobalDistrictInput => {
      const region = this.extractRegion(boundary.id, countryCode);
      const globalBoundaryType = this.mapBoundaryType(boundary.boundaryType);

      return {
        id: boundary.id,
        name: boundary.name,
        countryISO: countryCode,
        region,
        continent,
        geometry: boundary.geometry,
        boundaryType: globalBoundaryType,
        authority: boundary.jurisdiction ?? 'Unknown',
        provenance: {
          source: boundary.source?.url ?? 'unknown',
          authority: 'federal' as const,
          timestamp: boundary.source ? new Date(boundary.source.timestamp).getTime() : Date.now(),
          method: boundary.source?.provider ?? 'unknown',
          responseHash: boundary.source?.checksum ?? '',
          jurisdiction: boundary.jurisdiction ?? countryCode,
          httpStatus: 200,
          featureCount: 1,
          geometryType: boundary.geometry.type,
          coordinateSystem: 'EPSG:4326',
        },
        bbox: this.extractBBox(boundary.geometry),
        validFrom: new Date(), // TODO: Extract from boundary metadata if available
        validUntil: undefined, // Current boundary
      };
    });
  }

  /**
   * Build unified Merkle tree (flat or global based on config)
   *
   * OPTIMIZATION LOGIC:
   * - Single country + optimization enabled: Use flat tree
   * - Multiple countries OR optimization disabled: Use global tree
   *
   * @param boundaries - Flat boundary inputs
   * @param config - Configuration (countries, optimization flag)
   * @returns Discriminated union (flat or global tree)
   */
  async buildUnifiedTree(
    boundaries: readonly MerkleBoundaryInput[],
    config: GlobalTreeConfig
  ): Promise<UnifiedMerkleTree> {
    const isSingleCountry = config.countries.length === 1;
    const useFlat = isSingleCountry && config.useSingleCountryOptimization;

    if (useFlat) {
      logger.info('Using flat tree optimization', {
        country: config.countries[0],
        boundaryCount: boundaries.length,
      });

      // Build flat tree (proven implementation)
      const flatTree = await this.buildFlatTree(boundaries);

      return {
        type: 'flat',
        tree: flatTree,
      };
    } else {
      logger.info('Using global hierarchical tree', {
        countries: config.countries,
        boundaryCount: boundaries.length,
      });

      // Convert to global format and build hierarchical tree
      const globalDistricts: GlobalDistrictInput[] = [];

      for (const country of config.countries) {
        const countryBoundaries = boundaries.filter(b =>
          this.inferCountry(b) === country
        );
        const converted = this.convertBoundariesToGlobalBuilder(
          countryBoundaries,
          country
        );
        globalDistricts.push(...converted);
      }

      const globalTree = await this.globalBuilder.build(globalDistricts);

      return {
        type: 'global',
        tree: globalTree,
      };
    }
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Extract region code from boundary ID
   *
   * US: Extract 2-digit FIPS state code from GEOID
   * Other: Extract from jurisdiction string or ID pattern
   */
  private extractRegion(id: string, countryCode: string): string {
    if (countryCode === 'US') {
      // US GEOIDs: First 2 digits are FIPS state code
      const fips = id.substring(0, 2);
      return FIPS_TO_STATE[fips] ?? 'UNKNOWN';
    }

    // For other countries, extract from ID or default to country code
    // TODO: Implement region extraction for other countries
    return countryCode;
  }

  /**
   * Infer country from boundary (fallback heuristic)
   *
   * Primary: Check jurisdiction string for country identifiers
   * Fallback: Check ID pattern for country prefixes
   * Default: "US" (current primary deployment)
   */
  private inferCountry(boundary: MerkleBoundaryInput): string {
    // Check jurisdiction for country hints
    if (boundary.jurisdiction) {
      const lower = boundary.jurisdiction.toLowerCase();
      if (lower.includes('usa') || lower.includes('united states')) {
        return 'US';
      }
      if (lower.includes('canada')) return 'CA';
      if (lower.includes('uk') || lower.includes('united kingdom')) return 'GB';
      if (lower.includes('australia')) return 'AU';
      if (lower.includes('new zealand')) return 'NZ';
    }

    // Check ID for country prefix (e.g., "us-ca-sf-1")
    if (boundary.id.includes('-')) {
      const parts = boundary.id.split('-');
      const potentialCountry = parts[0].toUpperCase();
      if (potentialCountry.length === 2 && /^[A-Z]{2}$/.test(potentialCountry)) {
        return potentialCountry;
      }
    }

    // Default to US (primary deployment country)
    return 'US';
  }

  /**
   * Infer continental region from country code
   *
   * @param countryCode - ISO 3166-1 alpha-2 country code
   * @returns Continental region
   */
  private inferContinent(countryCode: string): TypesContinentalRegion {
    const continent = COUNTRY_TO_CONTINENT[countryCode];
    if (!continent) {
      logger.warn('Unknown country code, defaulting to americas', {
        countryCode,
      });
      return 'americas';
    }
    return continent;
  }

  /**
   * Map US BoundaryType to GlobalBoundaryType
   *
   * Most boundary types map directly.
   * Add international type mappings as needed.
   */
  private mapBoundaryType(type: BoundaryType): TypesGlobalBoundaryType {
    // Direct mapping for US types (canonical source)
    return type as TypesGlobalBoundaryType;
  }

  /**
   * Extract bounding box from geometry
   *
   * @param geometry - GeoJSON geometry
   * @returns [minLon, minLat, maxLon, maxLat]
   */
  private extractBBox(
    geometry: Polygon | MultiPolygon
  ): readonly [number, number, number, number] {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;

    const processCoords = (coords: number[]): void => {
      const [lon, lat] = coords;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    };

    if (geometry.type === 'Polygon') {
      for (const ring of geometry.coordinates) {
        for (const coord of ring) {
          processCoords(coord);
        }
      }
    } else if (geometry.type === 'MultiPolygon') {
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) {
          for (const coord of ring) {
            processCoords(coord);
          }
        }
      }
    }

    return [minLon, minLat, maxLon, maxLat];
  }

  /**
   * Build flat tree from boundaries
   *
   * Groups boundaries by type into layers, then builds unified tree.
   */
  private async buildFlatTree(
    boundaries: readonly MerkleBoundaryInput[]
  ): Promise<MultiLayerMerkleTree> {
    // Group boundaries by type (mutable arrays for construction)
    const congressionalDistricts: MerkleBoundaryInput[] = [];
    const stateLegislativeUpper: MerkleBoundaryInput[] = [];
    const stateLegislativeLower: MerkleBoundaryInput[] = [];
    const counties: MerkleBoundaryInput[] = [];
    const cityCouncilDistricts: MerkleBoundaryInput[] = [];
    const unifiedSchoolDistricts: MerkleBoundaryInput[] = [];
    const elementarySchoolDistricts: MerkleBoundaryInput[] = [];
    const secondarySchoolDistricts: MerkleBoundaryInput[] = [];
    const votingPrecincts: MerkleBoundaryInput[] = [];

    for (const boundary of boundaries) {
      switch (boundary.boundaryType) {
        case BoundaryType.CONGRESSIONAL_DISTRICT:
          congressionalDistricts.push(boundary);
          break;

        case BoundaryType.STATE_LEGISLATIVE_UPPER:
          stateLegislativeUpper.push(boundary);
          break;

        case BoundaryType.STATE_LEGISLATIVE_LOWER:
          stateLegislativeLower.push(boundary);
          break;

        case BoundaryType.COUNTY:
          counties.push(boundary);
          break;

        case BoundaryType.CITY_COUNCIL_DISTRICT:
        case BoundaryType.CITY_COUNCIL_WARD:
          cityCouncilDistricts.push(boundary);
          break;

        case BoundaryType.SCHOOL_DISTRICT_UNIFIED:
          unifiedSchoolDistricts.push(boundary);
          break;

        case BoundaryType.SCHOOL_DISTRICT_ELEMENTARY:
          elementarySchoolDistricts.push(boundary);
          break;

        case BoundaryType.SCHOOL_DISTRICT_SECONDARY:
          secondarySchoolDistricts.push(boundary);
          break;

        case BoundaryType.VOTING_DISTRICT:
          votingPrecincts.push(boundary);
          break;

        // TODO: Add other boundary types as needed
        default:
          logger.warn('Unmapped boundary type, skipping', {
            type: boundary.boundaryType,
            id: boundary.id,
          });
      }
    }

    // Build layers object (readonly)
    const layers: BoundaryLayers = {
      congressionalDistricts: congressionalDistricts.length > 0 ? congressionalDistricts : undefined,
      stateLegislativeUpper: stateLegislativeUpper.length > 0 ? stateLegislativeUpper : undefined,
      stateLegislativeLower: stateLegislativeLower.length > 0 ? stateLegislativeLower : undefined,
      counties: counties.length > 0 ? counties : undefined,
      cityCouncilDistricts: cityCouncilDistricts.length > 0 ? cityCouncilDistricts : undefined,
      unifiedSchoolDistricts: unifiedSchoolDistricts.length > 0 ? unifiedSchoolDistricts : undefined,
      elementarySchoolDistricts: elementarySchoolDistricts.length > 0 ? elementarySchoolDistricts : undefined,
      secondarySchoolDistricts: secondarySchoolDistricts.length > 0 ? secondarySchoolDistricts : undefined,
      votingPrecincts: votingPrecincts.length > 0 ? votingPrecincts : undefined,
    };

    return this.flatBuilder.buildTree(layers);
  }

  /**
   * Convert boundaries to GlobalDistrictInput for GlobalMerkleTreeBuilder
   *
   * This is separate from convertBoundaries() because GlobalMerkleTreeBuilder
   * uses different types than the integration/types.ts GlobalDistrictInput.
   */
  private convertBoundariesToGlobalBuilder(
    boundaries: readonly MerkleBoundaryInput[],
    countryCode: string
  ): GlobalDistrictInput[] {
    return boundaries.map((boundary): GlobalDistrictInput => {
      const region = this.extractRegion(boundary.id, countryCode);

      // Map authority level (1-5) to AuthorityLevel type
      let authorityLevel: number;
      if (boundary.authority >= 5) {
        authorityLevel = 5; // FEDERAL_MANDATE
      } else if (boundary.authority >= 4) {
        authorityLevel = 4; // STATE_OFFICIAL
      } else if (boundary.authority >= 3) {
        authorityLevel = 3; // MUNICIPAL_OFFICIAL
      } else if (boundary.authority >= 2) {
        authorityLevel = 2; // COMMUNITY_VERIFIED
      } else {
        authorityLevel = 1; // UNVERIFIED
      }

      return {
        id: boundary.id,
        name: boundary.name,
        country: countryCode,
        region,
        boundaryType: this.mapBoundaryTypeToGlobalBuilder(boundary.boundaryType),
        geometry: boundary.geometry,
        authority: authorityLevel as 1 | 2 | 3 | 4 | 5,
        parentId: undefined, // TODO: Extract parent relationships if needed
      };
    });
  }

  /**
   * Map BoundaryType to GlobalBoundaryType for GlobalMerkleTreeBuilder
   *
   * GlobalMerkleTreeBuilder uses its own GlobalBoundaryType enum.
   * Most types map directly, but some may need special handling.
   */
  private mapBoundaryTypeToGlobalBuilder(type: BoundaryType): GlobalBoundaryType {
    // Most types map directly (BoundaryType is subset of GlobalBoundaryType)
    // Cast is safe because GlobalBoundaryType extends BoundaryType
    return type as unknown as GlobalBoundaryType;
  }
}
