/**
 * Special District Data Sources Registry
 *
 * Documents authoritative sources for special districts that don't have federal TIGER coverage.
 * These districts often have ELECTED boards, making them important for civic participation.
 *
 * PRIORITY ORDER (by governance model):
 * 1. Fire Districts - Often elected commissioners, public safety decisions
 * 2. Library Districts - Often elected boards, cultural infrastructure
 * 3. Hospital Districts - Mixed governance (elected/appointed), healthcare access
 * 4. Water/Utility/Transit - Usually appointed (lower civic priority)
 *
 * DATA SOURCE HIERARCHY:
 * 1. State Special District Registry (authoritative, comprehensive)
 * 2. State GIS Portal (authoritative, may be incomplete)
 * 3. County GIS Portal (authoritative for that county only)
 * 4. LAFCo (Local Agency Formation Commission) - CA only
 * 5. OpenStreetMap (community-maintained, low authority)
 */

import type { BoundaryType } from '../core/types.js';

/**
 * Special district category
 */
export type SpecialDistrictCategory =
  | 'fire'
  | 'library'
  | 'hospital'
  | 'water'
  | 'utility'
  | 'transit'
  | 'school';  // School districts come from TIGER, but included for completeness

/**
 * Governance model for special districts
 */
export type GovernanceModel = 'elected' | 'appointed' | 'mixed';

/**
 * Data source configuration for a special district type in a state
 */
export interface SpecialDistrictSource {
  /** State abbreviation */
  readonly state: string;

  /** District category */
  readonly category: SpecialDistrictCategory;

  /** Governance model (elected boards = higher civic priority) */
  readonly governance: GovernanceModel;

  /** Data source URL */
  readonly endpoint: string;

  /** Source type */
  readonly sourceType: 'arcgis' | 'wfs' | 'rest' | 'static' | 'lafco';

  /** Source authority level (0-5) */
  readonly authority: number;

  /** Expected district count (for validation) */
  readonly expectedCount?: number;

  /** Layer name/ID for multi-layer services */
  readonly layerId?: string | number;

  /** Last verified date */
  readonly lastVerified: string;

  /** Notes about data quality or coverage */
  readonly notes?: string;
}

/**
 * State LAFCo (Local Agency Formation Commission) registry
 *
 * California-specific: LAFCos regulate special district boundaries.
 * https://calafco.org/about-lafco
 */
export const CALIFORNIA_LAFCO_PORTALS: Record<string, string> = {
  // Major California counties with LAFCo GIS portals
  'Alameda': 'https://www.acgov.org/lafco/',
  'Contra Costa': 'https://www.contracostalafco.org/',
  'Fresno': 'https://www.fresnolafco.org/',
  'Kern': 'https://www.kernlafco.com/',
  'Los Angeles': 'https://www.lalafco.org/',
  'Orange': 'https://www.oclafco.org/',
  'Riverside': 'https://www.lafco.org/',
  'Sacramento': 'https://www.saclafco.org/',
  'San Bernardino': 'https://www.sbclafco.org/',
  'San Diego': 'https://www.sdlafco.org/',
  'San Francisco': 'https://sfgov.org/lafco/',
  'San Mateo': 'https://lafco.smcgov.org/',
  'Santa Clara': 'https://www.santaclaralafco.org/',
  'Ventura': 'https://www.ventura.lafco.ca.gov/',
};

/**
 * Fire District Sources by State
 *
 * Fire districts often have ELECTED fire commissioners who make decisions about:
 * - Fire station locations and closures
 * - Equipment purchases and maintenance
 * - Firefighter staffing levels
 * - Emergency response protocols
 * - Property tax levies for fire protection
 *
 * CIVIC PRIORITY: HIGH (many states have elected fire boards)
 */
export const FIRE_DISTRICT_SOURCES: readonly SpecialDistrictSource[] = [
  // States with comprehensive fire district GIS data
  {
    state: 'CA',
    category: 'fire',
    governance: 'elected',
    endpoint: 'https://gis.data.ca.gov/datasets/fire-protection-districts',
    sourceType: 'arcgis',
    authority: 4,
    expectedCount: 380,  // Approximate - varies as districts form/dissolve
    lastVerified: '2025-01-01',
    notes: 'California has ~380 fire districts, most with elected boards. LAFCo regulates boundaries.',
  },
  {
    state: 'WA',
    category: 'fire',
    governance: 'elected',
    endpoint: 'https://geo.wa.gov/datasets/fire-protection-districts',
    sourceType: 'arcgis',
    authority: 4,
    expectedCount: 350,
    lastVerified: '2025-01-01',
    notes: 'Washington fire districts have elected 3-5 member boards.',
  },
  {
    state: 'OR',
    category: 'fire',
    governance: 'elected',
    endpoint: 'https://spatialdata.oregonexplorer.info/geoportal/rest/metadata/item/fire_districts',
    sourceType: 'arcgis',
    authority: 4,
    expectedCount: 200,
    lastVerified: '2025-01-01',
    notes: 'Oregon has ~200 fire districts with elected boards.',
  },
  {
    state: 'CO',
    category: 'fire',
    governance: 'elected',
    endpoint: 'https://data.colorado.gov/Local-Aggregation/Fire-Protection-Districts/xyz',
    sourceType: 'arcgis',
    authority: 4,
    expectedCount: 280,
    lastVerified: '2025-01-01',
    notes: 'Colorado fire protection districts with elected boards.',
  },
  {
    state: 'TX',
    category: 'fire',
    governance: 'mixed',
    endpoint: 'https://data.tnris.org/fire-districts',
    sourceType: 'arcgis',
    authority: 3,
    lastVerified: '2025-01-01',
    notes: 'Texas has Emergency Services Districts (ESDs) - some elected, some appointed.',
  },
  // States where fire is municipal (no special districts)
  // NY, MA, PA, NJ, etc. - fire departments are city departments, not special districts
];

/**
 * Library District Sources by State
 *
 * Library districts are special districts that fund and operate public libraries.
 * Many have ELECTED trustees who make decisions about:
 * - Branch locations and hours
 * - Collection policies
 * - Programming and services
 * - Property tax levies for library funding
 *
 * CIVIC PRIORITY: MEDIUM-HIGH (elected boards where they exist)
 *
 * NOTE: Distinguish from library SYSTEMS (county/city departments) vs library DISTRICTS (special districts)
 */
export const LIBRARY_DISTRICT_SOURCES: readonly SpecialDistrictSource[] = [
  {
    state: 'CA',
    category: 'library',
    governance: 'elected',
    endpoint: 'https://gis.data.ca.gov/datasets/library-districts',
    sourceType: 'arcgis',
    authority: 4,
    expectedCount: 50,  // California has ~50 library districts
    lastVerified: '2025-01-01',
    notes: 'California library districts (NOT county library systems). Elected trustees.',
  },
  {
    state: 'IL',
    category: 'library',
    governance: 'elected',
    endpoint: 'https://clearinghouse.isgs.illinois.edu/data/boundary/library-districts',
    sourceType: 'arcgis',
    authority: 4,
    expectedCount: 300,  // Illinois has many library districts
    lastVerified: '2025-01-01',
    notes: 'Illinois library districts - one of the largest systems of library districts in US.',
  },
  {
    state: 'OR',
    category: 'library',
    governance: 'elected',
    endpoint: 'https://spatialdata.oregonexplorer.info/geoportal/rest/metadata/item/library_districts',
    sourceType: 'arcgis',
    authority: 4,
    expectedCount: 20,
    lastVerified: '2025-01-01',
    notes: 'Oregon library districts with elected boards.',
  },
];

/**
 * Hospital District Sources by State
 *
 * Hospital districts are special districts that operate public hospitals.
 * Governance varies significantly by state:
 * - Some have ELECTED boards (civic participation opportunity)
 * - Some have APPOINTED boards (lower civic priority)
 * - Some are transitioning between models
 *
 * CIVIC PRIORITY: MEDIUM (mixed governance)
 */
export const HOSPITAL_DISTRICT_SOURCES: readonly SpecialDistrictSource[] = [
  {
    state: 'CA',
    category: 'hospital',
    governance: 'elected',
    endpoint: 'https://gis.data.ca.gov/datasets/healthcare-districts',
    sourceType: 'arcgis',
    authority: 4,
    expectedCount: 75,  // California has ~75 healthcare districts
    lastVerified: '2025-01-01',
    notes: 'California healthcare districts - most have elected boards.',
  },
  {
    state: 'TX',
    category: 'hospital',
    governance: 'elected',
    endpoint: 'https://data.tnris.org/hospital-districts',
    sourceType: 'arcgis',
    authority: 3,
    expectedCount: 200,
    lastVerified: '2025-01-01',
    notes: 'Texas hospital districts - elected boards, fund indigent care.',
  },
];

/**
 * Get special district sources for a state
 */
export function getSpecialDistrictSources(
  state: string,
  category?: SpecialDistrictCategory
): readonly SpecialDistrictSource[] {
  const allSources = [
    ...FIRE_DISTRICT_SOURCES,
    ...LIBRARY_DISTRICT_SOURCES,
    ...HOSPITAL_DISTRICT_SOURCES,
  ];

  return allSources.filter(source => {
    if (source.state !== state) return false;
    if (category && source.category !== category) return false;
    return true;
  });
}

/**
 * Get civic priority score for a special district category
 *
 * Higher scores = more civic participation opportunity
 */
export function getCivicPriority(category: SpecialDistrictCategory): number {
  switch (category) {
    case 'school': return 100;   // Highest - education policy, always elected
    case 'fire': return 80;      // High - public safety, often elected
    case 'library': return 70;   // Medium-high - cultural infrastructure, often elected
    case 'hospital': return 60;  // Medium - healthcare, mixed governance
    case 'water': return 40;     // Lower - infrastructure, usually appointed
    case 'utility': return 40;   // Lower - infrastructure, usually appointed
    case 'transit': return 40;   // Lower - transportation, usually appointed
    default: return 0;
  }
}

/**
 * Map special district category to BoundaryType
 */
export function categoryToBoundaryType(category: SpecialDistrictCategory): BoundaryType {
  switch (category) {
    case 'school': return 'school_district_unified' as BoundaryType;
    case 'fire': return 'fire_district' as BoundaryType;
    case 'library': return 'library_district' as BoundaryType;
    case 'hospital': return 'hospital_district' as BoundaryType;
    case 'water': return 'water_district' as BoundaryType;
    case 'utility': return 'utility_district' as BoundaryType;
    case 'transit': return 'transit_district' as BoundaryType;
    default: return 'county' as BoundaryType;  // Fallback
  }
}

/**
 * States with comprehensive special district registries
 *
 * These states maintain statewide registries of special districts with boundary data.
 */
export const STATES_WITH_SPECIAL_DISTRICT_REGISTRIES: readonly string[] = [
  'CA',  // California - Most comprehensive (LAFCo system)
  'CO',  // Colorado - Good coverage via state portal
  'WA',  // Washington - Comprehensive fire/water districts
  'OR',  // Oregon - Good coverage via Oregon Explorer
  'TX',  // Texas - TNRIS has some special district data
  'IL',  // Illinois - Library districts well-documented
];

/**
 * Recommendation for data acquisition by state
 *
 * Returns recommended approach for acquiring special district data.
 */
export function getDataAcquisitionStrategy(state: string): {
  strategy: 'state-registry' | 'county-by-county' | 'osm-fallback';
  notes: string;
} {
  if (STATES_WITH_SPECIAL_DISTRICT_REGISTRIES.includes(state)) {
    return {
      strategy: 'state-registry',
      notes: `${state} has statewide special district registry. Query state GIS portal.`,
    };
  }

  if (state === 'CA') {
    return {
      strategy: 'county-by-county',
      notes: 'California LAFCo counties have authoritative special district boundaries.',
    };
  }

  return {
    strategy: 'osm-fallback',
    notes: `${state} lacks comprehensive special district registry. Use OSM or skip.`,
  };
}
