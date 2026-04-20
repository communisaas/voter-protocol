/**
 * Authority Level Mapper
 *
 * Maps portal types and discovery sources to authority levels for provenance tracking.
 * Also provides circuit slot mapping for the HYBRID 24-SLOT circuit approach.
 *
 * AUTHORITY HIERARCHY:
 * 5 (federal-mandate)   - US Census TIGER, Statistics Canada
 * 4 (state-agency)      - State GIS clearinghouses (geodata.hawaii.gov, gis.ny.gov)
 * 3 (municipal-agency)  - City open data portals (data.seattle.gov)
 * 2 (county-agency)     - County GIS departments
 * 1 (commercial-aggregator) - Commercial APIs (Google Civic)
 * 0 (community-maintained) - OpenStreetMap, volunteer efforts
 *
 * CIRCUIT SLOT ARCHITECTURE:
 * The ZK circuit has 24 fixed slots (0-23). Shadow Atlas BoundaryType enum has 50+
 * values that MAP to these 24 slots. Multiple BoundaryTypes can map to the same slot.
 *
 * This is intentional: BoundaryType is a classification system for data collection,
 * while circuit slots are a fixed-size proof structure. The mapping consolidates
 * related boundary types into shared slots for efficient proof generation.
 */

import type { PortalType } from '../types/discovery.js';
import type { AuthorityLevel } from '../types/provider.js';
import { BoundaryType } from '../types/boundary.js';

/**
 * Map portal type to authority level
 *
 * @param portalType - Portal type from discovery
 * @returns Authority level (0-5 for provenance, or string for provider)
 */
export function mapPortalToAuthority(portalType: PortalType): {
  numeric: 0 | 1 | 2 | 3 | 4 | 5;
  semantic: AuthorityLevel;
} {
  switch (portalType) {
    case 'census-tiger':
      return {
        numeric: 5,
        semantic: 'federal-mandate',
      };

    case 'state-gis':
      return {
        numeric: 4,
        semantic: 'state-agency',
      };

    case 'arcgis':
    case 'socrata':
    case 'ckan':
    case 'arcgis-hub':
    case 'arcgis-online':
    case 'municipal-gis':
      // City/county portals - assume municipal unless we know otherwise
      return {
        numeric: 3,
        semantic: 'municipal-agency',
      };

    case 'custom-api':
    case 'static-file':
      // Could be municipal or commercial - default to commercial
      return {
        numeric: 1,
        semantic: 'commercial-aggregator',
      };

    default:
      // Unknown portal type - lowest authority
      return {
        numeric: 0,
        semantic: 'community-maintained',
      };
  }
}

/**
 * Map collection method to authority level
 *
 * @param collectionMethod - How the data was collected
 * @returns Authority level
 */
export function mapCollectionMethodToAuthority(collectionMethod: string): {
  numeric: 0 | 1 | 2 | 3 | 4 | 5;
  semantic: AuthorityLevel;
} {
  switch (collectionMethod) {
    case 'census-tiger':
    case 'national-statistics':
      return {
        numeric: 5,
        semantic: 'federal-mandate',
      };

    case 'portal-discovery':
      // Default to municipal for portal discovery
      // (can be refined based on actual portal)
      return {
        numeric: 3,
        semantic: 'municipal-agency',
      };

    case 'manual-verification':
      // Manual verification implies human review - municipal quality
      return {
        numeric: 3,
        semantic: 'municipal-agency',
      };

    case 'commercial-api':
      return {
        numeric: 1,
        semantic: 'commercial-aggregator',
      };

    case 'community-aggregation':
      return {
        numeric: 0,
        semantic: 'community-maintained',
      };

    default:
      return {
        numeric: 0,
        semantic: 'community-maintained',
      };
  }
}

/**
 * Determine authority level from portal URL
 *
 * Some portals can be identified as state vs municipal based on URL patterns
 *
 * @param url - Portal URL
 * @param defaultPortalType - Default portal type if URL doesn't match known patterns
 * @returns Authority level
 */
export function mapUrlToAuthority(
  url: string,
  defaultPortalType: PortalType = 'arcgis'
): {
  numeric: 0 | 1 | 2 | 3 | 4 | 5;
  semantic: AuthorityLevel;
  detectedType: PortalType;
} {
  const urlLower = url.toLowerCase();

  // State GIS patterns — use hostname matching to prevent subdomain spoofing
  // (e.g. 'geodata.hawaii.gov.evil.com' must NOT match 'geodata.hawaii.gov')
  const stateGisHosts = [
    'geodata.hawaii.gov',
    'gis.ny.gov',
    'data.colorado.gov',
    'gisdata.mn.gov',
    'geo.wa.gov',
    'spatialdata.oregonexplorer.info',
    'gis.data.ca.gov',
    'data.tnris.org',
    'geodata.floridagio.gov',
    'www.pasda.psu.edu',
    'clearinghouse.isgs.illinois.edu',
    'ogrip.oit.ohio.gov',
    'gis-michigan.opendata.arcgis.com',
    'www.nconemap.gov',
    'vgin.vdem.virginia.gov',
    'data.georgiaspatial.org',
    'www.mass.gov',
    'data-wi-dnr.opendata.arcgis.com',
  ];

  try {
    const parsedUrl = new URL(urlLower.startsWith('http') ? urlLower : `https://${urlLower}`);
    const host = parsedUrl.hostname;
    for (const pattern of stateGisHosts) {
      if (host === pattern || host.endsWith(`.${pattern}`)) {
        return {
          numeric: 4,
          semantic: 'state-agency',
          detectedType: 'state-gis',
        };
      }
    }
  } catch {
    // Invalid URL — fall through
  }

  // Census TIGER patterns — use hostname parsing to prevent subdomain spoofing
  // (e.g. 'census.gov.evil.com' must NOT match)
  try {
    const parsedUrl = new URL(urlLower.startsWith('http') ? urlLower : `https://${urlLower}`);
    const host = parsedUrl.hostname;
    if (host === 'census.gov' || host.endsWith('.census.gov')) {
      return {
        numeric: 5,
        semantic: 'federal-mandate',
        detectedType: 'census-tiger',
      };
    }
  } catch {
    // Invalid URL — fall through to default
  }

  // Default to provided portal type
  const defaultAuthority = mapPortalToAuthority(defaultPortalType);
  return {
    ...defaultAuthority,
    detectedType: defaultPortalType,
  };
}

/**
 * Get human-readable authority label
 *
 * @param level - Authority level (numeric 0-5)
 * @returns Human-readable label
 */
export function getAuthorityLabel(level: 0 | 1 | 2 | 3 | 4 | 5): string {
  const labels: Record<number, string> = {
    5: 'Federal Mandate (Highest)',
    4: 'State Agency (High)',
    3: 'Municipal Agency (Medium-High)',
    2: 'County Agency (Medium)',
    1: 'Commercial Aggregator (Low)',
    0: 'Community Maintained (Lowest)',
  };

  return labels[level] || 'Unknown';
}

/**
 * Compare authority levels
 *
 * @param a - First authority level
 * @param b - Second authority level
 * @returns Positive if a > b, negative if a < b, 0 if equal
 */
export function compareAuthority(
  a: 0 | 1 | 2 | 3 | 4 | 5,
  b: 0 | 1 | 2 | 3 | 4 | 5
): number {
  return a - b;
}

/**
 * Select highest authority source from multiple candidates
 *
 * @param candidates - Array of candidates with authority levels
 * @returns Candidate with highest authority level
 */
export function selectHighestAuthority<T extends { auth: number }>(
  candidates: T[]
): T | null {
  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((highest, current) =>
    current.auth > highest.auth ? current : highest
  );
}

// =============================================================================
// CIRCUIT SLOT MAPPING - HYBRID 24-SLOT ARCHITECTURE
// =============================================================================

/**
 * Circuit slot names for the 24-slot proof structure.
 *
 * The ZK circuit has 24 fixed slots. Each slot represents a category of
 * governance/boundary type. Multiple Shadow Atlas BoundaryTypes can map
 * to the same circuit slot.
 *
 * SLOT ALLOCATION RATIONALE:
 * - Slots 0-3: Core electoral representation (federal + state legislature)
 * - Slots 4-6: Local government (county, city, council)
 * - Slots 7-10: Education (school districts + school board)
 * - Slot 11: Voting infrastructure (precincts)
 * - Slots 12-18: Special districts by function (fire, water, utility, transit, etc.)
 * - Slots 19-20: Judicial and environmental conservation
 * - Slot 21: Tribal governance
 * - Slots 22-23: Overflow for rare/miscellaneous districts
 *
 * Reference layers (METRO_AREA, ZIP_CODE_AREA, CENSUS_TRACT, etc.) are NOT
 * assigned circuit slots as they don't have elected governance.
 */
export const CIRCUIT_SLOT_NAMES = [
  'CONGRESSIONAL',      // 0: US House districts
  'FEDERAL_SENATE',     // 1: State-wide (for US Senate representation)
  'STATE_SENATE',       // 2: State upper chamber
  'STATE_HOUSE',        // 3: State lower chamber / Assembly
  'COUNTY',             // 4: County-level governance
  'CITY',               // 5: Municipal governance (city limits)
  'CITY_COUNCIL',       // 6: City council / ward districts
  'SCHOOL_UNIFIED',     // 7: Unified school districts (K-12)
  'SCHOOL_ELEMENTARY',  // 8: Elementary school districts
  'SCHOOL_SECONDARY',   // 9: Secondary / High school districts
  'COMMUNITY_COLLEGE',  // 10: Community college districts
  'WATER_SEWER',        // 11: Water / sewer / sanitation districts
  'FIRE_EMS',           // 12: Fire protection and emergency services
  'TRANSIT',            // 13: Transit / transportation districts
  'HOSPITAL',           // 14: Hospital / healthcare districts
  'LIBRARY',            // 15: Library districts
  'PARK_REC',           // 16: Parks and recreation districts
  'CONSERVATION',       // 17: Conservation / soil / environmental districts
  'UTILITY',            // 18: PUD / MUD / electric co-op districts
  'JUDICIAL',           // 19: Judicial districts / court jurisdictions
  'TOWNSHIP',           // 20: Township / MCD / New England town
  'VOTING_PRECINCT',    // 21: Voting tabulation districts / precincts
  'TRIBAL',             // 22: Tribal / indigenous governance (AIANNH)
  'OVERFLOW',           // 23: Rare/miscellaneous special districts
] as const;

/**
 * Type representing a valid circuit slot index (0-23).
 */
export type CircuitSlotIndex =
  | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19
  | 20 | 21 | 22 | 23;

/**
 * Type for circuit slot names.
 */
export type CircuitSlotName = (typeof CIRCUIT_SLOT_NAMES)[number];

/**
 * Total number of circuit slots in the HYBRID 24-SLOT architecture.
 */
export const CIRCUIT_SLOT_COUNT = 24 as const;

/**
 * Special value indicating a boundary type has no circuit slot mapping.
 * Used for reference layers that don't have elected governance.
 */
export const NO_CIRCUIT_SLOT = -1 as const;

/**
 * Maps Shadow Atlas BoundaryType to circuit slot index (0-23).
 *
 * Multiple BoundaryTypes can map to the same slot. This consolidates
 * related district types for efficient proof generation while preserving
 * the detailed classification in the Shadow Atlas data model.
 *
 * Returns NO_CIRCUIT_SLOT (-1) for reference layers that don't have
 * elected governance and shouldn't appear in proofs.
 *
 * @param type - The BoundaryType to map
 * @returns Circuit slot index (0-23) or NO_CIRCUIT_SLOT (-1) for reference layers
 *
 * @example
 * ```typescript
 * boundaryTypeToSlot(BoundaryType.CONGRESSIONAL_DISTRICT) // => 0
 * boundaryTypeToSlot(BoundaryType.FIRE_DISTRICT) // => 12
 * boundaryTypeToSlot(BoundaryType.EMERGENCY_SERVICES_DISTRICT) // => 12 (same as FIRE_DISTRICT)
 * boundaryTypeToSlot(BoundaryType.CENSUS_TRACT) // => -1 (no circuit slot)
 * ```
 */
export function boundaryTypeToSlot(type: BoundaryType): CircuitSlotIndex | typeof NO_CIRCUIT_SLOT {
  switch (type) {
    // =========================================================================
    // SLOT 0: CONGRESSIONAL (Federal House districts)
    // =========================================================================
    case BoundaryType.CONGRESSIONAL_DISTRICT:
      return 0;

    // =========================================================================
    // SLOT 1: FEDERAL_SENATE (State-wide for US Senate representation)
    // =========================================================================
    case BoundaryType.STATE_PROVINCE:
      return 1;

    // =========================================================================
    // SLOT 2: STATE_SENATE (State upper chamber)
    // =========================================================================
    case BoundaryType.STATE_LEGISLATIVE_UPPER:
      return 2;

    // =========================================================================
    // SLOT 3: STATE_HOUSE (State lower chamber / Assembly)
    // =========================================================================
    case BoundaryType.STATE_LEGISLATIVE_LOWER:
      return 3;

    // =========================================================================
    // SLOT 4: COUNTY (County-level governance)
    // =========================================================================
    case BoundaryType.COUNTY:
    case BoundaryType.COUNTY_SUBDIVISION:
    case BoundaryType.SUPERVISOR_DISTRICT:
      return 4;

    // =========================================================================
    // SLOT 5: CITY (Municipal governance - city limits)
    // =========================================================================
    case BoundaryType.CITY_LIMITS:
    case BoundaryType.CDP:
    case BoundaryType.BOROUGH:
    case BoundaryType.VILLAGE:
    case BoundaryType.CONSOLIDATED_CITY:
      return 5;

    // =========================================================================
    // SLOT 6: CITY_COUNCIL (City council / ward districts)
    // =========================================================================
    case BoundaryType.CITY_COUNCIL_DISTRICT:
    case BoundaryType.CITY_COUNCIL_WARD:
    case BoundaryType.ALDERMANIC_DISTRICT:
      return 6;

    // =========================================================================
    // SLOT 7: SCHOOL_UNIFIED (Unified school districts - K-12)
    // =========================================================================
    case BoundaryType.SCHOOL_DISTRICT_UNIFIED:
      return 7;

    // =========================================================================
    // SLOT 8: SCHOOL_ELEMENTARY (Elementary school districts)
    // =========================================================================
    case BoundaryType.SCHOOL_DISTRICT_ELEMENTARY:
      return 8;

    // =========================================================================
    // SLOT 9: SCHOOL_SECONDARY (Secondary / High school districts)
    // =========================================================================
    case BoundaryType.SCHOOL_DISTRICT_SECONDARY:
      return 9;

    // =========================================================================
    // SLOT 10: COMMUNITY_COLLEGE (Community college districts)
    // =========================================================================
    case BoundaryType.SCHOOL_BOARD_DISTRICT:
      // School board trustee areas share slot 10 with community college
      return 10;

    // =========================================================================
    // SLOT 11: WATER_SEWER (Water / sewer / sanitation districts)
    // =========================================================================
    case BoundaryType.WATER_DISTRICT:
    case BoundaryType.SEWER_DISTRICT:
    case BoundaryType.SANITATION_DISTRICT:
    case BoundaryType.IRRIGATION_DISTRICT:
    case BoundaryType.FLOOD_CONTROL_DISTRICT:
    case BoundaryType.DRAINAGE_DISTRICT:
      return 11;

    // =========================================================================
    // SLOT 12: FIRE_EMS (Fire protection and emergency services)
    // =========================================================================
    case BoundaryType.FIRE_DISTRICT:
    case BoundaryType.EMERGENCY_SERVICES_DISTRICT:
    case BoundaryType.EMS_DISTRICT:
      return 12;

    // =========================================================================
    // SLOT 13: TRANSIT (Transit / transportation districts)
    // =========================================================================
    case BoundaryType.TRANSIT_DISTRICT:
    case BoundaryType.TRANSPORTATION_DISTRICT:
    case BoundaryType.METRO_TRANSIT_DISTRICT:
    case BoundaryType.PORT_DISTRICT:
    case BoundaryType.AIRPORT_DISTRICT:
      return 13;

    // =========================================================================
    // SLOT 14: HOSPITAL (Hospital / healthcare districts)
    // =========================================================================
    case BoundaryType.HOSPITAL_DISTRICT:
    case BoundaryType.HEALTHCARE_DISTRICT:
    case BoundaryType.AMBULANCE_DISTRICT:
      return 14;

    // =========================================================================
    // SLOT 15: LIBRARY (Library districts)
    // =========================================================================
    case BoundaryType.LIBRARY_DISTRICT:
      return 15;

    // =========================================================================
    // SLOT 16: PARK_REC (Parks and recreation districts)
    // =========================================================================
    case BoundaryType.PARK_DISTRICT:
    case BoundaryType.RECREATION_DISTRICT:
    case BoundaryType.OPEN_SPACE_DISTRICT:
      return 16;

    // =========================================================================
    // SLOT 17: CONSERVATION (Conservation / soil / environmental districts)
    // =========================================================================
    case BoundaryType.CONSERVATION_DISTRICT:
    case BoundaryType.SOIL_CONSERVATION_DISTRICT:
    case BoundaryType.RESOURCE_CONSERVATION_DISTRICT:
    case BoundaryType.WATERSHED_DISTRICT:
    case BoundaryType.GROUNDWATER_DISTRICT:
      return 17;

    // =========================================================================
    // SLOT 18: UTILITY (PUD / MUD / electric co-op districts)
    // =========================================================================
    case BoundaryType.UTILITY_DISTRICT:
    case BoundaryType.PUBLIC_UTILITY_DISTRICT:
    case BoundaryType.POWER_DISTRICT:
    case BoundaryType.ELECTRIC_DISTRICT:
    case BoundaryType.GAS_DISTRICT:
      return 18;

    // =========================================================================
    // SLOT 19: JUDICIAL (Judicial districts / court jurisdictions)
    // =========================================================================
    case BoundaryType.JUDICIAL_DISTRICT:
    case BoundaryType.COURT_DISTRICT:
    case BoundaryType.JUSTICE_COURT_DISTRICT:
    case BoundaryType.SUPERIOR_COURT_DISTRICT:
      return 19;

    // =========================================================================
    // SLOT 20: TOWNSHIP (Township / MCD / New England town)
    // =========================================================================
    case BoundaryType.TOWNSHIP:
      return 20;

    // =========================================================================
    // SLOT 21: VOTING_PRECINCT (Voting tabulation districts / precincts)
    // =========================================================================
    case BoundaryType.VOTING_DISTRICT:
    case BoundaryType.VOTING_PRECINCT:
    case BoundaryType.ELECTION_DISTRICT:
      return 21;

    // =========================================================================
    // SLOT 22: TRIBAL (Tribal / indigenous governance)
    // =========================================================================
    case BoundaryType.TRIBAL_AREA:
    case BoundaryType.ALASKA_NATIVE_CORP:
    case BoundaryType.TRIBAL_SUBDIVISION:
    case BoundaryType.TRIBAL_BLOCK_GROUP:
    case BoundaryType.TRIBAL_TRACT:
      return 22;

    // =========================================================================
    // SLOT 23: OVERFLOW (Rare/miscellaneous special districts)
    // =========================================================================
    case BoundaryType.CEMETERY_DISTRICT:
    case BoundaryType.MOSQUITO_DISTRICT:
    case BoundaryType.PEST_CONTROL_DISTRICT:
    case BoundaryType.WEED_DISTRICT:
    case BoundaryType.LIGHTING_DISTRICT:
    case BoundaryType.STREET_DISTRICT:
    case BoundaryType.ROAD_DISTRICT:
    case BoundaryType.COMMUNITY_SERVICES_DISTRICT:
    case BoundaryType.IMPROVEMENT_DISTRICT:
    case BoundaryType.ASSESSMENT_DISTRICT:
    case BoundaryType.BUSINESS_IMPROVEMENT_DISTRICT:
    case BoundaryType.TAX_INCREMENT_DISTRICT:
    case BoundaryType.REDEVELOPMENT_DISTRICT:
    case BoundaryType.HOUSING_AUTHORITY_DISTRICT:
    case BoundaryType.LEVEE_DISTRICT:
    case BoundaryType.RECLAMATION_DISTRICT:
      return 23;

    // =========================================================================
    // REFERENCE LAYERS - No circuit slot (not elected governance)
    // =========================================================================
    case BoundaryType.METRO_AREA:
    case BoundaryType.METRO_DIVISION:
    case BoundaryType.URBAN_AREA:
    case BoundaryType.NECTA:
    case BoundaryType.NECTA_DIVISION:
    case BoundaryType.ZIP_CODE_AREA:
    case BoundaryType.CENSUS_TRACT:
    case BoundaryType.BLOCK_GROUP:
    case BoundaryType.PUMA:
    case BoundaryType.SUBMINOR_CIVIL_DIVISION:
    case BoundaryType.ESTATE:
    case BoundaryType.COMBINED_NECTA:
    case BoundaryType.MILITARY_INSTALLATION:
    case BoundaryType.COUNTRY:
      return NO_CIRCUIT_SLOT;

    default:
      // Exhaustive check - if TypeScript complains here, a new BoundaryType
      // was added but not mapped to a circuit slot
      const _exhaustiveCheck: never = type;
      return NO_CIRCUIT_SLOT;
  }
}

/**
 * Get the circuit slot name for a given slot index.
 *
 * @param slotIndex - The circuit slot index (0-23)
 * @returns The slot name, or undefined if index is out of range
 */
export function getSlotName(slotIndex: CircuitSlotIndex): CircuitSlotName {
  return CIRCUIT_SLOT_NAMES[slotIndex];
}

/**
 * Get the circuit slot index for a given slot name.
 *
 * @param slotName - The circuit slot name
 * @returns The slot index (0-23)
 */
export function getSlotIndex(slotName: CircuitSlotName): CircuitSlotIndex {
  const index = CIRCUIT_SLOT_NAMES.indexOf(slotName);
  if (index === -1) {
    throw new Error(`Unknown circuit slot name: ${slotName}`);
  }
  return index as CircuitSlotIndex;
}

/**
 * Check if a BoundaryType has a circuit slot mapping.
 *
 * Reference layers (CENSUS_TRACT, ZIP_CODE_AREA, etc.) do not have
 * circuit slots as they don't have elected governance.
 *
 * @param type - The BoundaryType to check
 * @returns true if the type has a circuit slot, false otherwise
 */
export function hasCircuitSlot(type: BoundaryType): boolean {
  return boundaryTypeToSlot(type) !== NO_CIRCUIT_SLOT;
}

/**
 * Get all BoundaryTypes that map to a specific circuit slot.
 *
 * @param slotIndex - The circuit slot index (0-23)
 * @returns Array of BoundaryTypes that map to this slot
 */
export function getBoundaryTypesForSlot(slotIndex: CircuitSlotIndex): BoundaryType[] {
  const types: BoundaryType[] = [];
  for (const type of Object.values(BoundaryType)) {
    if (boundaryTypeToSlot(type) === slotIndex) {
      types.push(type);
    }
  }
  return types;
}

/**
 * Metadata for a circuit slot including its purpose and mapped boundary types.
 */
export interface CircuitSlotMetadata {
  /** Slot index (0-23) */
  index: CircuitSlotIndex;
  /** Slot name (e.g., 'CONGRESSIONAL', 'FIRE_EMS') */
  name: CircuitSlotName;
  /** Human-readable description of the slot's purpose */
  description: string;
  /** All BoundaryTypes that map to this slot */
  boundaryTypes: BoundaryType[];
}

/**
 * Get metadata for all 24 circuit slots.
 *
 * @returns Array of metadata for all circuit slots
 */
export function getAllCircuitSlotMetadata(): CircuitSlotMetadata[] {
  const descriptions: Record<CircuitSlotName, string> = {
    CONGRESSIONAL: 'US House of Representatives districts',
    FEDERAL_SENATE: 'State-wide representation (US Senate)',
    STATE_SENATE: 'State upper chamber (State Senate)',
    STATE_HOUSE: 'State lower chamber (State Assembly/House)',
    COUNTY: 'County-level governance and subdivisions',
    CITY: 'Municipal boundaries (cities, towns, villages)',
    CITY_COUNCIL: 'City council districts and wards',
    SCHOOL_UNIFIED: 'Unified K-12 school districts',
    SCHOOL_ELEMENTARY: 'Elementary school districts',
    SCHOOL_SECONDARY: 'Secondary/high school districts',
    COMMUNITY_COLLEGE: 'Community college districts',
    WATER_SEWER: 'Water, sewer, and sanitation districts',
    FIRE_EMS: 'Fire protection and emergency services districts',
    TRANSIT: 'Transit and transportation districts',
    HOSPITAL: 'Hospital and healthcare districts',
    LIBRARY: 'Library districts',
    PARK_REC: 'Parks and recreation districts',
    CONSERVATION: 'Conservation and environmental districts',
    UTILITY: 'Public utility districts (PUD, MUD, electric co-op)',
    JUDICIAL: 'Judicial districts and court jurisdictions',
    TOWNSHIP: 'Township / MCD / New England town',
    VOTING_PRECINCT: 'Voting tabulation districts and precincts',
    TRIBAL: 'Tribal and indigenous governance areas (AIANNH)',
    OVERFLOW: 'Miscellaneous special districts',
  };

  return CIRCUIT_SLOT_NAMES.map((name, index) => ({
    index: index as CircuitSlotIndex,
    name,
    description: descriptions[name],
    boundaryTypes: getBoundaryTypesForSlot(index as CircuitSlotIndex),
  }));
}
