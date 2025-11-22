/**
 * City Name Alias Registry
 *
 * Maps Census-designated place names to governance entity search names.
 * Handles cases where Census CDP name ≠ official municipal name.
 *
 * PHILOSOPHY: Public data exists. We're building better search terms, not giving up.
 */

export interface CityNameAlias {
  readonly censusFips: string;
  readonly censusName: string;
  readonly searchNames: readonly string[]; // Try in order
  readonly governanceName: string;
  readonly governanceLevel: 'place' | 'county' | 'consolidated';
  readonly reason: string;
}

export const CITY_NAME_ALIASES: Record<string, CityNameAlias> = {
  // Hawaii consolidated city-counties (ALL Hawaiian cities are CDPs)
  '1571550': { // Urban Honolulu CDP
    censusFips: '1571550',
    censusName: 'Urban Honolulu',
    searchNames: ['Honolulu', 'City and County of Honolulu'],
    governanceName: 'City and County of Honolulu',
    governanceLevel: 'county',
    reason: 'Hawaii has no incorporated places. Census CDP "Urban Honolulu" covers urban core, but governance is county-wide.',
  },

  // Consolidated city-counties
  '1836003': { // Indianapolis city (balance)
    censusFips: '1836003',
    censusName: 'Indianapolis city (balance)',
    searchNames: ['Indianapolis', 'Indianapolis Marion County'],
    governanceName: 'City of Indianapolis',
    governanceLevel: 'consolidated',
    reason: 'Consolidated city-county government (Unigov). Search uses city name.',
  },

  '4752006': { // Nashville-Davidson
    censusFips: '4752006',
    censusName: 'Nashville-Davidson metropolitan government (balance)',
    searchNames: ['Nashville', 'Nashville Davidson', 'Metro Nashville'],
    governanceName: 'Metropolitan Government of Nashville and Davidson County',
    governanceLevel: 'consolidated',
    reason: 'Consolidated metropolitan government. Multiple search name variations.',
  },

  // Add more as discovered by autonomous scanners
};

/**
 * Get search names for a city, including aliases
 */
export function getSearchNames(cityFips: string, defaultName: string): readonly string[] {
  const alias = CITY_NAME_ALIASES[cityFips];

  if (alias) {
    return alias.searchNames;
  }

  // No alias needed, use default name
  return [defaultName];
}

/**
 * Detect if city needs alias (for autonomous discovery)
 */
export function needsAlias(cityFips: string): boolean {
  return cityFips in CITY_NAME_ALIASES;
}
