/**
 * Special District Type System Examples
 *
 * Demonstrates usage of the extended BoundaryType enum and special district helpers.
 * These examples show how to integrate special districts into the Shadow Atlas resolution pipeline.
 */

import { BoundaryType, PRECISION_RANK } from '../src/core/types.js';
import {
  isSpecialDistrict,
  isElectedSpecialDistrict,
  getSpecialDistrictGovernance,
  getSpecialDistrictCategory,
  getCivicParticipationPriority,
  getSpecialDistrictDescription,
  SCHOOL_DISTRICT_TYPES,
} from '../src/core/special-district-types.js';
import { logger } from '../src/core/utils/logger.js';

// ============================================================================
// Example 1: Basic Type Usage
// ============================================================================

function example1_basicTypeUsage(): void {
  // Access new BoundaryType enum values
  const schoolType = BoundaryType.SCHOOL_DISTRICT_UNIFIED;
  const fireType = BoundaryType.FIRE_DISTRICT;
  const waterType = BoundaryType.WATER_DISTRICT;

  // Get precision ranks
  logger.info('School district rank', { rank: PRECISION_RANK[schoolType] }); // 5
  logger.info('Fire district rank', { rank: PRECISION_RANK[fireType] });     // 8
  logger.info('Water district rank', { rank: PRECISION_RANK[waterType] });   // 11

  // Lower rank = higher precision/priority in resolution
  logger.info('School ranks higher than water', {
    schoolRank: PRECISION_RANK[schoolType],
    waterRank: PRECISION_RANK[waterType],
    isHigher: PRECISION_RANK[schoolType] < PRECISION_RANK[waterType],
  }); // true
}

// ============================================================================
// Example 2: Type Narrowing with Type Guards
// ============================================================================

function example2_typeNarrowing(boundaryType: BoundaryType): void {
  // Check if boundary is a special district
  if (isSpecialDistrict(boundaryType)) {
    logger.info('This is a special district', { boundaryType });

    // Further narrow by governance type
    if (isElectedSpecialDistrict(boundaryType)) {
      logger.info('High civic priority - elected board', { boundaryType });
    } else {
      logger.info('Lower civic priority - appointed board', { boundaryType });
    }
  }
}

// ============================================================================
// Example 3: Categorization for VOTER Protocol
// ============================================================================

interface BoundaryWithCivicMetadata {
  readonly type: BoundaryType;
  readonly name: string;
  readonly governance: string;
  readonly category: string;
  readonly civicPriority: number;
  readonly description: string;
}

function example3_civicCategorization(type: BoundaryType): BoundaryWithCivicMetadata {
  return {
    type,
    name: 'Example District',
    governance: getSpecialDistrictGovernance(type),
    category: getSpecialDistrictCategory(type),
    civicPriority: getCivicParticipationPriority(type),
    description: getSpecialDistrictDescription(type),
  };
}

// Usage:
const schoolMetadata = example3_civicCategorization(BoundaryType.SCHOOL_DISTRICT_UNIFIED);
logger.info('School metadata example', { metadata: schoolMetadata });
// {
//   type: 'school_district_unified',
//   name: 'Example District',
//   governance: 'elected',
//   category: 'school',
//   civicPriority: 100,
//   description: 'Unified school district (K-12, elected board)'
// }

// ============================================================================
// Example 4: Filtering by Elected Districts (VOTER Protocol Use Case)
// ============================================================================

function example4_filterElectedDistricts(boundaries: readonly BoundaryType[]): readonly BoundaryType[] {
  // VOTER Protocol prioritizes elected bodies where civic participation is impactful
  return boundaries.filter(isElectedSpecialDistrict);
}

// Usage:
const allBoundaries: readonly BoundaryType[] = [
  BoundaryType.SCHOOL_DISTRICT_UNIFIED,
  BoundaryType.WATER_DISTRICT,
  BoundaryType.FIRE_DISTRICT,
  BoundaryType.TRANSIT_DISTRICT,
];

const electedOnly = example4_filterElectedDistricts(allBoundaries);
logger.info('Elected districts', { districts: electedOnly });
// ['school_district_unified', 'fire_district']

// ============================================================================
// Example 5: Hierarchical Resolution with Special Districts
// ============================================================================

function example5_hierarchicalResolution(
  candidateBoundaries: readonly BoundaryType[]
): BoundaryType | null {
  // Sort by precision rank (lower = higher precision)
  const sorted = [...candidateBoundaries].sort(
    (a, b) => PRECISION_RANK[a] - PRECISION_RANK[b]
  );

  // Return highest precision boundary
  return sorted[0] ?? null;
}

// Usage: User's address matches multiple boundaries
const matches: readonly BoundaryType[] = [
  BoundaryType.COUNTY,
  BoundaryType.SCHOOL_DISTRICT_UNIFIED,
  BoundaryType.FIRE_DISTRICT,
  BoundaryType.CONGRESSIONAL_DISTRICT,
];

const bestMatch = example5_hierarchicalResolution(matches);
logger.info('Best boundary for ZK proof', { bestMatch });
// 'school_district_unified' (rank 5, higher precision than county/congressional)

// ============================================================================
// Example 6: Building VOTER Protocol Civic Participation Dashboard
// ============================================================================

interface CivicBoundaryInfo {
  readonly type: BoundaryType;
  readonly priorityScore: number;
  readonly actionable: boolean; // Can users contact elected officials?
  readonly description: string;
}

function example6_buildCivicDashboard(
  userBoundaries: readonly BoundaryType[]
): readonly CivicBoundaryInfo[] {
  return userBoundaries
    .map((type) => ({
      type,
      priorityScore: getCivicParticipationPriority(type),
      actionable: isElectedSpecialDistrict(type),
      description: getSpecialDistrictDescription(type),
    }))
    .filter((info) => info.priorityScore > 0) // Only special districts
    .sort((a, b) => b.priorityScore - a.priorityScore); // Highest priority first
}

// Usage: Show user their actionable civic boundaries
const userMatches: readonly BoundaryType[] = [
  BoundaryType.SCHOOL_DISTRICT_UNIFIED,
  BoundaryType.FIRE_DISTRICT,
  BoundaryType.WATER_DISTRICT,
  BoundaryType.HOSPITAL_DISTRICT,
  BoundaryType.COUNTY,
];

const dashboard = example6_buildCivicDashboard(userMatches);
logger.info('Civic participation opportunities', { dashboard });
// [
//   { type: 'school_district_unified', priorityScore: 100, actionable: true, ... },
//   { type: 'fire_district', priorityScore: 80, actionable: true, ... },
//   { type: 'hospital_district', priorityScore: 60, actionable: false, ... },
//   { type: 'water_district', priorityScore: 40, actionable: false, ... }
// ]

// ============================================================================
// Example 7: Type-Safe Iteration over School Districts
// ============================================================================

function example7_iterateSchoolDistricts(): void {
  // Type-safe iteration over all school district types
  for (const districtType of SCHOOL_DISTRICT_TYPES) {
    const description = getSpecialDistrictDescription(districtType);
    const priority = getCivicParticipationPriority(districtType);

    logger.info('School district info', {
      districtType,
      description,
      priority,
    });
  }

  // Output:
  // school_district_unified: Unified school district (K-12, elected board) (priority: 100)
  // school_district_elementary: Elementary school district (K-8, elected board) (priority: 100)
  // school_district_secondary: Secondary school district (9-12, elected board) (priority: 100)
}

// ============================================================================
// Example 8: Integration with Shadow Atlas Merkle Tree
// ============================================================================

interface MerkleLeafMetadata {
  readonly boundaryType: BoundaryType;
  readonly precisionRank: number;
  readonly isElected: boolean;
  readonly civicPriority: number;
}

function example8_merkleLeafMetadata(type: BoundaryType): MerkleLeafMetadata {
  return {
    boundaryType: type,
    precisionRank: PRECISION_RANK[type],
    isElected: isElectedSpecialDistrict(type),
    civicPriority: getCivicParticipationPriority(type),
  };
}

// Usage: Build Merkle tree with special district metadata
const boundaryTypes: readonly BoundaryType[] = [
  BoundaryType.SCHOOL_DISTRICT_UNIFIED,
  BoundaryType.FIRE_DISTRICT,
  BoundaryType.WATER_DISTRICT,
];

const merkleMetadata = boundaryTypes.map(example8_merkleLeafMetadata);
logger.info('Merkle leaf metadata', { metadata: merkleMetadata });

// ============================================================================
// Export Examples (for documentation)
// ============================================================================

export const examples = {
  example1_basicTypeUsage,
  example2_typeNarrowing,
  example3_civicCategorization,
  example4_filterElectedDistricts,
  example5_hierarchicalResolution,
  example6_buildCivicDashboard,
  example7_iterateSchoolDistricts,
  example8_merkleLeafMetadata,
};
