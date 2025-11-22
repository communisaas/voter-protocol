/**
 * Municipal Edge Case Handling
 *
 * US municipal boundaries are politically complex. This module handles:
 * - Independent cities (not part of any county)
 * - Consolidated city-counties
 * - Federal districts (DC)
 * - Census Designated Places (CDPs)
 * - Multi-jurisdiction cities
 *
 * Philosophy: Elegant recognition and handling, not brute-force terminology fallback.
 */

export enum MunicipalClassification {
  // Standard municipalities
  INCORPORATED_CITY = 'incorporated_city',           // Normal city within a county
  TOWN = 'town',                                     // Smaller incorporated municipality
  VILLAGE = 'village',                               // Very small incorporated municipality

  // Edge cases requiring special handling
  INDEPENDENT_CITY = 'independent_city',             // City NOT part of any county (VA, MO, MD, NV)
  CONSOLIDATED_CITY_COUNTY = 'consolidated',         // City = County (SF, Denver, etc.)
  FEDERAL_DISTRICT = 'federal_district',             // Washington, DC
  BOROUGH = 'borough',                               // NYC boroughs, Alaska boroughs
  CENSUS_DESIGNATED_PLACE = 'cdp',                   // Statistical area, not legal municipality
  UNINCORPORATED = 'unincorporated',                 // Populated area without municipal govt

  // Multi-jurisdiction complexity
  MULTI_COUNTY_CITY = 'multi_county',                // City spanning multiple counties
}

export interface MunicipalEdgeCase {
  name: string;
  state: string;
  classification: MunicipalClassification;
  fipsCode?: string;                                 // Census Place FIPS code
  countyFIPS?: string[];                             // For multi-county cities
  notes: string;
  discoveryStrategy: 'census_place' | 'county_equivalent' | 'special_district' | 'hybrid';
}

/**
 * INDEPENDENT CITIES - Cities that are NOT part of any county
 * These are county-equivalents for federal purposes
 */
export const INDEPENDENT_CITIES: MunicipalEdgeCase[] = [
  // Virginia (38 independent cities)
  { name: 'Alexandria', state: 'VA', classification: MunicipalClassification.INDEPENDENT_CITY,
    fipsCode: '5101000', notes: 'Independent city, county-equivalent', discoveryStrategy: 'county_equivalent' },
  { name: 'Bristol', state: 'VA', classification: MunicipalClassification.INDEPENDENT_CITY,
    fipsCode: '5152000', notes: 'Independent city on TN border', discoveryStrategy: 'county_equivalent' },
  { name: 'Chesapeake', state: 'VA', classification: MunicipalClassification.INDEPENDENT_CITY,
    fipsCode: '5155000', notes: 'Independent city, county-equivalent', discoveryStrategy: 'county_equivalent' },
  { name: 'Norfolk', state: 'VA', classification: MunicipalClassification.INDEPENDENT_CITY,
    fipsCode: '5571000', notes: 'Independent city, county-equivalent', discoveryStrategy: 'county_equivalent' },
  { name: 'Richmond', state: 'VA', classification: MunicipalClassification.INDEPENDENT_CITY,
    fipsCode: '5167000', notes: 'State capital, independent city', discoveryStrategy: 'county_equivalent' },
  { name: 'Virginia Beach', state: 'VA', classification: MunicipalClassification.INDEPENDENT_CITY,
    fipsCode: '5182000', notes: 'Largest independent city by population', discoveryStrategy: 'county_equivalent' },
  // ... 32 more VA cities omitted for brevity

  // Other states
  { name: 'Baltimore', state: 'MD', classification: MunicipalClassification.INDEPENDENT_CITY,
    fipsCode: '2404000', notes: 'Independent from Baltimore County', discoveryStrategy: 'county_equivalent' },
  { name: 'St. Louis', state: 'MO', classification: MunicipalClassification.INDEPENDENT_CITY,
    fipsCode: '2965000', notes: 'Independent from St. Louis County since 1876', discoveryStrategy: 'county_equivalent' },
  { name: 'Carson City', state: 'NV', classification: MunicipalClassification.INDEPENDENT_CITY,
    fipsCode: '3207000', notes: 'Consolidated municipality (city + county)', discoveryStrategy: 'county_equivalent' },
];

/**
 * CONSOLIDATED CITY-COUNTIES - City government = County government
 * Single jurisdiction serving both city and county functions
 */
export const CONSOLIDATED_CITY_COUNTIES: MunicipalEdgeCase[] = [
  { name: 'San Francisco', state: 'CA', classification: MunicipalClassification.CONSOLIDATED_CITY_COUNTY,
    fipsCode: '0667000', countyFIPS: ['06075'], notes: 'City and County of San Francisco (coterminous)',
    discoveryStrategy: 'county_equivalent' },
  { name: 'Denver', state: 'CO', classification: MunicipalClassification.CONSOLIDATED_CITY_COUNTY,
    fipsCode: '0820000', countyFIPS: ['08031'], notes: 'City and County of Denver (coterminous)',
    discoveryStrategy: 'county_equivalent' },
  { name: 'Philadelphia', state: 'PA', classification: MunicipalClassification.CONSOLIDATED_CITY_COUNTY,
    fipsCode: '4260000', countyFIPS: ['42101'], notes: 'City coextensive with Philadelphia County',
    discoveryStrategy: 'county_equivalent' },
  { name: 'Honolulu', state: 'HI', classification: MunicipalClassification.CONSOLIDATED_CITY_COUNTY,
    fipsCode: '1517000', countyFIPS: ['15003'], notes: 'City and County of Honolulu',
    discoveryStrategy: 'county_equivalent' },
  { name: 'Jacksonville', state: 'FL', classification: MunicipalClassification.CONSOLIDATED_CITY_COUNTY,
    fipsCode: '1235000', countyFIPS: ['12031'], notes: 'Consolidated with Duval County (1968)',
    discoveryStrategy: 'county_equivalent' },
  { name: 'Nashville', state: 'TN', classification: MunicipalClassification.CONSOLIDATED_CITY_COUNTY,
    fipsCode: '4752006', countyFIPS: ['47037'], notes: 'Metropolitan Government of Nashville-Davidson County',
    discoveryStrategy: 'county_equivalent' },
  { name: 'Louisville', state: 'KY', classification: MunicipalClassification.CONSOLIDATED_CITY_COUNTY,
    fipsCode: '2148006', countyFIPS: ['21111'], notes: 'Louisville-Jefferson County Metro (2003)',
    discoveryStrategy: 'county_equivalent' },
  { name: 'Indianapolis', state: 'IN', classification: MunicipalClassification.CONSOLIDATED_CITY_COUNTY,
    fipsCode: '1836003', countyFIPS: ['18097'], notes: 'Consolidated with Marion County (Unigov, 1970)',
    discoveryStrategy: 'county_equivalent' },
  { name: 'Columbus', state: 'GA', classification: MunicipalClassification.CONSOLIDATED_CITY_COUNTY,
    fipsCode: '1319000', countyFIPS: ['13215'], notes: 'Consolidated with Muscogee County (1971)',
    discoveryStrategy: 'county_equivalent' },
  { name: 'Augusta', state: 'GA', classification: MunicipalClassification.CONSOLIDATED_CITY_COUNTY,
    fipsCode: '1304204', countyFIPS: ['13245'], notes: 'Augusta-Richmond County (1996)',
    discoveryStrategy: 'county_equivalent' },
  { name: 'Anchorage', state: 'AK', classification: MunicipalClassification.CONSOLIDATED_CITY_COUNTY,
    fipsCode: '0203000', countyFIPS: ['02020'], notes: 'Municipality of Anchorage (city + borough)',
    discoveryStrategy: 'county_equivalent' },
];

/**
 * NEW YORK CITY BOROUGHS - Special case (5 boroughs = 5 counties)
 * Each borough is both a county AND part of NYC
 */
export const NYC_BOROUGHS: MunicipalEdgeCase[] = [
  { name: 'Manhattan', state: 'NY', classification: MunicipalClassification.BOROUGH,
    fipsCode: '3651000', countyFIPS: ['36061'], notes: 'New York County (part of NYC)',
    discoveryStrategy: 'hybrid' },
  { name: 'Brooklyn', state: 'NY', classification: MunicipalClassification.BOROUGH,
    fipsCode: '3651000', countyFIPS: ['36047'], notes: 'Kings County (part of NYC)',
    discoveryStrategy: 'hybrid' },
  { name: 'Queens', state: 'NY', classification: MunicipalClassification.BOROUGH,
    fipsCode: '3651000', countyFIPS: ['36081'], notes: 'Queens County (part of NYC)',
    discoveryStrategy: 'hybrid' },
  { name: 'Bronx', state: 'NY', classification: MunicipalClassification.BOROUGH,
    fipsCode: '3651000', countyFIPS: ['36005'], notes: 'Bronx County (part of NYC)',
    discoveryStrategy: 'hybrid' },
  { name: 'Staten Island', state: 'NY', classification: MunicipalClassification.BOROUGH,
    fipsCode: '3651000', countyFIPS: ['36085'], notes: 'Richmond County (part of NYC)',
    discoveryStrategy: 'hybrid' },
];

/**
 * FEDERAL DISTRICT - Washington, DC
 * Not a state, not a city, unique federal jurisdiction
 */
export const FEDERAL_DISTRICT: MunicipalEdgeCase = {
  name: 'Washington',
  state: 'DC',
  classification: MunicipalClassification.FEDERAL_DISTRICT,
  fipsCode: '1150000',
  notes: 'District of Columbia - federal district, county-equivalent, no state',
  discoveryStrategy: 'county_equivalent'
};

/**
 * MULTI-COUNTY CITIES - Cities spanning multiple counties
 * Need to handle jurisdictional complexity
 */
export const MULTI_COUNTY_CITIES: MunicipalEdgeCase[] = [
  { name: 'Kansas City', state: 'MO', classification: MunicipalClassification.MULTI_COUNTY_CITY,
    fipsCode: '2938000', countyFIPS: ['29047', '29095', '29165', '29037'], // Clay, Jackson, Platte, Cass
    notes: 'Spans 4 counties in MO', discoveryStrategy: 'census_place' },
  { name: 'New York', state: 'NY', classification: MunicipalClassification.MULTI_COUNTY_CITY,
    fipsCode: '3651000', countyFIPS: ['36061', '36047', '36081', '36005', '36085'], // 5 boroughs
    notes: 'Coterminous with 5 counties (boroughs)', discoveryStrategy: 'hybrid' },
  { name: 'Oklahoma City', state: 'OK', classification: MunicipalClassification.MULTI_COUNTY_CITY,
    fipsCode: '4055000', countyFIPS: ['40027', '40051', '40083', '40087', '40109', '40125', '40143'],
    notes: 'Spans 7 counties', discoveryStrategy: 'census_place' },
  { name: 'Charlotte', state: 'NC', classification: MunicipalClassification.MULTI_COUNTY_CITY,
    fipsCode: '3712000', countyFIPS: ['37119', '37025'], // Mecklenburg (primary), Cabarrus, Union, others
    notes: 'Primarily Mecklenburg, extends to others', discoveryStrategy: 'census_place' },
  { name: 'Atlanta', state: 'GA', classification: MunicipalClassification.MULTI_COUNTY_CITY,
    fipsCode: '1304000', countyFIPS: ['13089', '13121', '13063', '13067'], // Fulton (primary), DeKalb, Cobb
    notes: 'Primarily Fulton County, extends to DeKalb and Cobb', discoveryStrategy: 'census_place' },
];

/**
 * UNINCORPORATED AREAS - Major populated areas without municipal government
 * Use Census Designated Places (CDPs)
 */
export const MAJOR_UNINCORPORATED_AREAS: MunicipalEdgeCase[] = [
  { name: 'Arlington', state: 'VA', classification: MunicipalClassification.UNINCORPORATED,
    fipsCode: '5103000', countyFIPS: ['51013'], notes: 'Arlington County (unincorporated)',
    discoveryStrategy: 'county_equivalent' },
  { name: 'Metairie', state: 'LA', classification: MunicipalClassification.CENSUS_DESIGNATED_PLACE,
    fipsCode: '2250000', notes: 'CDP in Jefferson Parish', discoveryStrategy: 'census_place' },
  { name: 'East Los Angeles', state: 'CA', classification: MunicipalClassification.CENSUS_DESIGNATED_PLACE,
    fipsCode: '0620956', notes: 'CDP in LA County', discoveryStrategy: 'census_place' },
  { name: 'Spring Valley', state: 'NV', classification: MunicipalClassification.CENSUS_DESIGNATED_PLACE,
    fipsCode: '3268400', notes: 'Unincorporated Clark County (Las Vegas area)', discoveryStrategy: 'census_place' },
  { name: 'Paradise', state: 'NV', classification: MunicipalClassification.CENSUS_DESIGNATED_PLACE,
    fipsCode: '3254600', notes: 'Unincorporated Clark County (Las Vegas Strip)', discoveryStrategy: 'census_place' },
];

/**
 * Lookup municipal edge case by name and state
 */
export function getMunicipalEdgeCase(name: string, state: string): MunicipalEdgeCase | null {
  const normalized = name.toLowerCase().trim();
  const stateUpper = state.toUpperCase();

  // Check federal district
  if (normalized.includes('washington') && stateUpper === 'DC') {
    return FEDERAL_DISTRICT;
  }

  // Check all edge case lists
  const allEdgeCases = [
    ...INDEPENDENT_CITIES,
    ...CONSOLIDATED_CITY_COUNTIES,
    ...NYC_BOROUGHS,
    ...MULTI_COUNTY_CITIES,
    ...MAJOR_UNINCORPORATED_AREAS
  ];

  return allEdgeCases.find(ec =>
    ec.name.toLowerCase() === normalized && ec.state === stateUpper
  ) || null;
}

/**
 * Determine discovery strategy based on municipal classification
 */
export function getDiscoveryStrategy(
  name: string,
  state: string
): {
  strategy: 'standard' | 'county_equivalent' | 'census_place' | 'hybrid' | 'special_district';
  classification: MunicipalClassification | null;
  metadata: MunicipalEdgeCase | null;
} {
  const edgeCase = getMunicipalEdgeCase(name, state);

  if (!edgeCase) {
    return {
      strategy: 'standard',
      classification: MunicipalClassification.INCORPORATED_CITY,
      metadata: null
    };
  }

  return {
    strategy: edgeCase.discoveryStrategy,
    classification: edgeCase.classification,
    metadata: edgeCase
  };
}

/**
 * Get appropriate terminology based on municipal classification
 */
export function getMunicipalTerminology(classification: MunicipalClassification): string[] {
  switch (classification) {
    case MunicipalClassification.INDEPENDENT_CITY:
      return [
        'independent city',
        'city limits',
        'city boundaries',
        'county equivalent'  // VA independent cities are county-equivalents
      ];

    case MunicipalClassification.CONSOLIDATED_CITY_COUNTY:
      return [
        'consolidated city',
        'city and county',
        'city limits',
        'county boundaries'  // Because city = county
      ];

    case MunicipalClassification.FEDERAL_DISTRICT:
      return [
        'district',
        'district of columbia',
        'federal district',
        'district boundaries'
      ];

    case MunicipalClassification.BOROUGH:
      return [
        'borough boundaries',
        'county boundaries',  // NYC boroughs are counties
        'city boundaries'     // But also part of NYC
      ];

    case MunicipalClassification.CENSUS_DESIGNATED_PLACE:
      return [
        'census designated place',
        'cdp',
        'place boundaries'
      ];

    case MunicipalClassification.UNINCORPORATED:
      return [
        'unincorporated area',
        'county boundaries',  // Unincorporated areas use county boundaries
        'census place'
      ];

    case MunicipalClassification.MULTI_COUNTY_CITY:
      return [
        'city limits',
        'municipal boundaries',
        'city boundaries',
        'place boundaries'  // Census uses "place" for multi-county cities
      ];

    default:
      return [
        'city limits',
        'municipal boundaries',
        'city boundaries',
        'incorporated area'
      ];
  }
}

/**
 * Human-readable explanation of municipal complexity
 */
export function explainMunicipalClassification(edgeCase: MunicipalEdgeCase): string {
  switch (edgeCase.classification) {
    case MunicipalClassification.INDEPENDENT_CITY:
      return `${edgeCase.name} is an independent city (not part of any county). ` +
             `It functions as a county-equivalent for federal purposes. ${edgeCase.notes}`;

    case MunicipalClassification.CONSOLIDATED_CITY_COUNTY:
      return `${edgeCase.name} is a consolidated city-county where the city and county ` +
             `governments are merged into a single jurisdiction. ${edgeCase.notes}`;

    case MunicipalClassification.FEDERAL_DISTRICT:
      return `Washington, DC is a federal district under the jurisdiction of the US Congress. ` +
             `It is not part of any state and has unique governance. ${edgeCase.notes}`;

    case MunicipalClassification.BOROUGH:
      return `${edgeCase.name} is a borough of New York City. Each NYC borough is also a county ` +
             `(${edgeCase.notes}), creating dual jurisdictional complexity.`;

    case MunicipalClassification.MULTI_COUNTY_CITY:
      return `${edgeCase.name} spans multiple counties (${edgeCase.countyFIPS?.length || 0} counties). ` +
             `${edgeCase.notes}`;

    case MunicipalClassification.CENSUS_DESIGNATED_PLACE:
      return `${edgeCase.name} is a Census Designated Place (CDP) - a statistical area without ` +
             `incorporated municipal government. ${edgeCase.notes}`;

    case MunicipalClassification.UNINCORPORATED:
      return `${edgeCase.name} is an unincorporated area governed at the county level. ` +
             `${edgeCase.notes}`;

    default:
      return edgeCase.notes;
  }
}
