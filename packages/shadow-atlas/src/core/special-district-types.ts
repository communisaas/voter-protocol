/**
 * Special District Type Guards and Helpers
 *
 * Type guards, categorization helpers, and utility functions for special district boundaries.
 * Special districts are independent governmental units with specific purposes (schools, fire, water, etc.).
 *
 * CIVIC PARTICIPATION HIERARCHY:
 * 1. School districts: CRITICAL - elected boards, direct impact on education policy
 * 2. Fire/Library/Hospital: HIGH - often elected, direct community services
 * 3. Water/Utility/Transit: MEDIUM - usually appointed, infrastructure-focused
 *
 * TYPE SAFETY: All functions use readonly arrays and strict type narrowing.
 */

import { BoundaryType } from './types.js';

// ============================================================================
// Type Guard Collections (Readonly)
// ============================================================================

/**
 * All special district boundary types
 */
export const SPECIAL_DISTRICT_TYPES = [
  BoundaryType.SCHOOL_DISTRICT_UNIFIED,
  BoundaryType.SCHOOL_DISTRICT_ELEMENTARY,
  BoundaryType.SCHOOL_DISTRICT_SECONDARY,
  BoundaryType.FIRE_DISTRICT,
  BoundaryType.LIBRARY_DISTRICT,
  BoundaryType.HOSPITAL_DISTRICT,
  BoundaryType.WATER_DISTRICT,
  BoundaryType.UTILITY_DISTRICT,
  BoundaryType.TRANSIT_DISTRICT,
] as const;

/**
 * School district types (K-12 education, elected boards)
 */
export const SCHOOL_DISTRICT_TYPES = [
  BoundaryType.SCHOOL_DISTRICT_UNIFIED,
  BoundaryType.SCHOOL_DISTRICT_ELEMENTARY,
  BoundaryType.SCHOOL_DISTRICT_SECONDARY,
] as const;

/**
 * Public safety special districts (fire protection)
 */
export const PUBLIC_SAFETY_DISTRICT_TYPES = [
  BoundaryType.FIRE_DISTRICT,
] as const;

/**
 * Cultural/educational special districts (libraries)
 */
export const CULTURAL_DISTRICT_TYPES = [
  BoundaryType.LIBRARY_DISTRICT,
] as const;

/**
 * Healthcare special districts (hospital districts)
 */
export const HEALTHCARE_DISTRICT_TYPES = [
  BoundaryType.HOSPITAL_DISTRICT,
] as const;

/**
 * Utility special districts (water, general utilities)
 */
export const UTILITY_DISTRICT_TYPES = [
  BoundaryType.WATER_DISTRICT,
  BoundaryType.UTILITY_DISTRICT,
] as const;

/**
 * Transportation special districts (transit authorities)
 */
export const TRANSPORTATION_DISTRICT_TYPES = [
  BoundaryType.TRANSIT_DISTRICT,
] as const;

/**
 * Special districts typically with elected boards (HIGH civic participation priority)
 */
export const ELECTED_SPECIAL_DISTRICT_TYPES = [
  BoundaryType.SCHOOL_DISTRICT_UNIFIED,
  BoundaryType.SCHOOL_DISTRICT_ELEMENTARY,
  BoundaryType.SCHOOL_DISTRICT_SECONDARY,
  BoundaryType.FIRE_DISTRICT,
  BoundaryType.LIBRARY_DISTRICT,
] as const;

/**
 * Special districts typically with appointed boards (LOWER civic participation priority)
 */
export const APPOINTED_SPECIAL_DISTRICT_TYPES = [
  BoundaryType.WATER_DISTRICT,
  BoundaryType.UTILITY_DISTRICT,
  BoundaryType.TRANSIT_DISTRICT,
] as const;

/**
 * Special districts with mixed governance (sometimes elected, sometimes appointed)
 */
export const MIXED_GOVERNANCE_DISTRICT_TYPES = [
  BoundaryType.HOSPITAL_DISTRICT,
] as const;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if boundary type is any special district
 */
export function isSpecialDistrict(type: BoundaryType): boolean {
  return SPECIAL_DISTRICT_TYPES.includes(type as typeof SPECIAL_DISTRICT_TYPES[number]);
}

/**
 * Check if boundary type is a school district
 */
export function isSchoolDistrict(type: BoundaryType): boolean {
  return SCHOOL_DISTRICT_TYPES.includes(type as typeof SCHOOL_DISTRICT_TYPES[number]);
}

/**
 * Check if boundary type is a public safety district
 */
export function isPublicSafetyDistrict(type: BoundaryType): boolean {
  return PUBLIC_SAFETY_DISTRICT_TYPES.includes(type as typeof PUBLIC_SAFETY_DISTRICT_TYPES[number]);
}

/**
 * Check if boundary type is a cultural/educational district
 */
export function isCulturalDistrict(type: BoundaryType): boolean {
  return CULTURAL_DISTRICT_TYPES.includes(type as typeof CULTURAL_DISTRICT_TYPES[number]);
}

/**
 * Check if boundary type is a healthcare district
 */
export function isHealthcareDistrict(type: BoundaryType): boolean {
  return HEALTHCARE_DISTRICT_TYPES.includes(type as typeof HEALTHCARE_DISTRICT_TYPES[number]);
}

/**
 * Check if boundary type is a utility district
 */
export function isUtilityDistrict(type: BoundaryType): boolean {
  return UTILITY_DISTRICT_TYPES.includes(type as typeof UTILITY_DISTRICT_TYPES[number]);
}

/**
 * Check if boundary type is a transportation district
 */
export function isTransportationDistrict(type: BoundaryType): boolean {
  return TRANSPORTATION_DISTRICT_TYPES.includes(type as typeof TRANSPORTATION_DISTRICT_TYPES[number]);
}

/**
 * Check if special district typically has elected board (HIGH civic participation priority)
 *
 * VOTER Protocol targets elected bodies where civic participation is impactful.
 */
export function isElectedSpecialDistrict(type: BoundaryType): boolean {
  return ELECTED_SPECIAL_DISTRICT_TYPES.includes(type as typeof ELECTED_SPECIAL_DISTRICT_TYPES[number]);
}

/**
 * Check if special district typically has appointed board (LOWER civic participation priority)
 *
 * Still trackable but lower priority for VOTER Protocol civic engagement flows.
 */
export function isAppointedSpecialDistrict(type: BoundaryType): boolean {
  return APPOINTED_SPECIAL_DISTRICT_TYPES.includes(type as typeof APPOINTED_SPECIAL_DISTRICT_TYPES[number]);
}

/**
 * Check if special district has mixed governance (varies by jurisdiction)
 */
export function isMixedGovernanceDistrict(type: BoundaryType): boolean {
  return MIXED_GOVERNANCE_DISTRICT_TYPES.includes(type as typeof MIXED_GOVERNANCE_DISTRICT_TYPES[number]);
}

// ============================================================================
// Categorization Helpers
// ============================================================================

/**
 * Governance model for special districts
 */
export type SpecialDistrictGovernance = 'elected' | 'appointed' | 'mixed' | 'unknown';

/**
 * Get governance model for a special district type
 *
 * Returns:
 * - 'elected': Board members elected by voters (HIGH civic priority)
 * - 'appointed': Board members appointed by other officials (LOWER civic priority)
 * - 'mixed': Varies by jurisdiction (requires local research)
 * - 'unknown': Not a special district
 */
export function getSpecialDistrictGovernance(type: BoundaryType): SpecialDistrictGovernance {
  if (isElectedSpecialDistrict(type)) {
    return 'elected';
  }

  if (isAppointedSpecialDistrict(type)) {
    return 'appointed';
  }

  if (isMixedGovernanceDistrict(type)) {
    return 'mixed';
  }

  return 'unknown';
}

/**
 * Special district category
 */
export type SpecialDistrictCategory =
  | 'school'
  | 'public-safety'
  | 'cultural'
  | 'healthcare'
  | 'utility'
  | 'transportation'
  | 'none';

/**
 * Get category for a special district type
 */
export function getSpecialDistrictCategory(type: BoundaryType): SpecialDistrictCategory {
  if (isSchoolDistrict(type)) return 'school';
  if (isPublicSafetyDistrict(type)) return 'public-safety';
  if (isCulturalDistrict(type)) return 'cultural';
  if (isHealthcareDistrict(type)) return 'healthcare';
  if (isUtilityDistrict(type)) return 'utility';
  if (isTransportationDistrict(type)) return 'transportation';

  return 'none';
}

/**
 * Get civic participation priority score for a boundary type
 *
 * Higher score = higher priority for civic engagement.
 * Based on:
 * - Elected vs appointed governance
 * - Direct impact on community services
 * - Accessibility of decision-making processes
 *
 * Scale: 0 (not a special district) to 100 (highest civic priority)
 */
export function getCivicParticipationPriority(type: BoundaryType): number {
  if (!isSpecialDistrict(type)) {
    return 0;
  }

  // School districts: Highest priority (education policy, elected boards)
  if (isSchoolDistrict(type)) {
    return 100;
  }

  // Fire/Library: High priority (public safety, culture, often elected)
  if (isPublicSafetyDistrict(type) || isCulturalDistrict(type)) {
    return 80;
  }

  // Hospital: Medium-high (healthcare access, mixed governance)
  if (isHealthcareDistrict(type)) {
    return 60;
  }

  // Utilities/Transportation: Medium (infrastructure, usually appointed)
  if (isUtilityDistrict(type) || isTransportationDistrict(type)) {
    return 40;
  }

  return 0;
}

/**
 * Get human-readable description for special district type
 */
export function getSpecialDistrictDescription(type: BoundaryType): string {
  switch (type) {
    case BoundaryType.SCHOOL_DISTRICT_UNIFIED:
      return 'Unified school district (K-12, elected board)';
    case BoundaryType.SCHOOL_DISTRICT_ELEMENTARY:
      return 'Elementary school district (K-8, elected board)';
    case BoundaryType.SCHOOL_DISTRICT_SECONDARY:
      return 'Secondary school district (9-12, elected board)';
    case BoundaryType.FIRE_DISTRICT:
      return 'Fire protection district (often elected commissioners)';
    case BoundaryType.LIBRARY_DISTRICT:
      return 'Library district (often elected board)';
    case BoundaryType.HOSPITAL_DISTRICT:
      return 'Hospital district (governance varies by jurisdiction)';
    case BoundaryType.WATER_DISTRICT:
      return 'Water district (usually appointed board)';
    case BoundaryType.UTILITY_DISTRICT:
      return 'Utility district (usually appointed board)';
    case BoundaryType.TRANSIT_DISTRICT:
      return 'Transit district (usually appointed board)';
    default:
      return 'Not a special district';
  }
}

// ============================================================================
// Type Exports
// ============================================================================

/**
 * Type-safe special district type
 */
export type SpecialDistrictType = typeof SPECIAL_DISTRICT_TYPES[number];

/**
 * Type-safe school district type
 */
export type SchoolDistrictType = typeof SCHOOL_DISTRICT_TYPES[number];

/**
 * Type-safe elected special district type
 */
export type ElectedSpecialDistrictType = typeof ELECTED_SPECIAL_DISTRICT_TYPES[number];
