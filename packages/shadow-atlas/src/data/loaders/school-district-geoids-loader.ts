/**
 * School District GEOID Loader
 *
 * Loads real administrative LEA IDs from TIGER/Line 2024.
 *
 * CRITICAL: These are actual Census Bureau LEA codes, NOT sequential numbers.
 * LEA IDs have gaps and are administrative codes.
 *
 * District types:
 * - UNSD: Unified school districts (K-12) - most common, all 52 state/territories
 * - ELSD: Elementary school districts (K-8) - only in 26 states
 * - SCSD: Secondary school districts (9-12) - only in 7 states (GA, IL, KY, ME, MA, MN, MT)
 *
 * Source: Census TIGER/Line 2024
 * Extracted: 2026-01-11
 */

import schoolData from '../canonical/school-district-geoids.json';

export type SchoolDistrictType = 'unsd' | 'elsd' | 'scsd';

/**
 * Get school district GEOIDs for a specific state and district type
 *
 * @param type - District type (unsd/elsd/scsd)
 * @param stateFips - 2-digit state FIPS code
 * @returns Array of 7-digit LEA GEOIDs, or empty array if state has no districts of this type
 *
 * @example
 * ```typescript
 * // Get unified districts for Alabama
 * const alabamaUnified = getSchoolDistrictGeoids('unsd', '01');
 * // Returns: ['0100001', '0100003', ...]
 *
 * // Get elementary districts for California (has ELSD)
 * const caElementary = getSchoolDistrictGeoids('elsd', '06');
 *
 * // Get secondary districts for Texas (no SCSD - only 7 states have SCSD)
 * const txSecondary = getSchoolDistrictGeoids('scsd', '48');
 * // Returns: []
 * ```
 */
export function getSchoolDistrictGeoids(
  type: SchoolDistrictType,
  stateFips: string
): readonly string[] {
  return (schoolData[type] as Record<string, readonly string[]>)[stateFips] ?? [];
}

/**
 * Get all school district GEOIDs for a district type across all states
 *
 * @param type - District type (unsd/elsd/scsd)
 * @returns Record mapping state FIPS to arrays of LEA GEOIDs
 *
 * @example
 * ```typescript
 * const allUnified = getAllSchoolDistrictGeoids('unsd');
 * // Returns: { '01': [...], '02': [...], ... }
 *
 * const allElementary = getAllSchoolDistrictGeoids('elsd');
 * // Returns: { '04': [...], '06': [...], ... } (only states with ELSD)
 * ```
 */
export function getAllSchoolDistrictGeoids(
  type: SchoolDistrictType
): Record<string, readonly string[]> {
  return schoolData[type];
}

/**
 * Get metadata about the school district data
 *
 * @returns Metadata including source, generation date, and description
 */
export function getSchoolDistrictMetadata(): {
  readonly source: string;
  readonly generated: string;
  readonly description: string;
} {
  return schoolData.meta;
}

/**
 * Check if a state has school districts of a specific type
 *
 * @param type - District type (unsd/elsd/scsd)
 * @param stateFips - 2-digit state FIPS code
 * @returns true if state has districts of this type
 *
 * @example
 * ```typescript
 * hasSchoolDistricts('scsd', '17'); // true (Illinois has SCSD)
 * hasSchoolDistricts('scsd', '48'); // false (Texas has no SCSD)
 * ```
 */
export function hasSchoolDistricts(
  type: SchoolDistrictType,
  stateFips: string
): boolean {
  const geoids = (schoolData[type] as Record<string, readonly string[]>)[stateFips];
  return geoids !== undefined && geoids.length > 0;
}

/**
 * Get count of school districts for a state and district type
 *
 * @param type - District type (unsd/elsd/scsd)
 * @param stateFips - 2-digit state FIPS code
 * @returns Number of districts, or 0 if state has no districts of this type
 */
export function getSchoolDistrictCount(
  type: SchoolDistrictType,
  stateFips: string
): number {
  return ((schoolData[type] as Record<string, readonly string[]>)[stateFips] ?? []).length;
}

// ============================================================================
// BACKWARD-COMPATIBLE EXPORTS
// ============================================================================

/**
 * Unified (K-12) school district GEOIDs by state
 *
 * @deprecated Use getSchoolDistrictGeoids('unsd', stateFips) or getAllSchoolDistrictGeoids('unsd')
 */
export const CANONICAL_UNSD_GEOIDS: Record<string, readonly string[]> = schoolData.unsd;

/**
 * Elementary (K-8) school district GEOIDs by state
 * Only 26 states have elementary districts.
 *
 * @deprecated Use getSchoolDistrictGeoids('elsd', stateFips) or getAllSchoolDistrictGeoids('elsd')
 */
export const CANONICAL_ELSD_GEOIDS: Record<string, readonly string[]> = schoolData.elsd;

/**
 * Secondary (9-12) school district GEOIDs by state
 * Only 7 states have secondary districts: GA, IL, KY, ME, MA, MN, MT
 *
 * @deprecated Use getSchoolDistrictGeoids('scsd', stateFips) or getAllSchoolDistrictGeoids('scsd')
 */
export const CANONICAL_SCSD_GEOIDS: Record<string, readonly string[]> = schoolData.scsd;
