/**
 * Search Term Generator
 *
 * Generates comprehensive search term variations to maximize discovery recall.
 * PHILOSOPHY: If data exists, we'll find it through exhaustive search variations.
 */

export interface SearchTerms {
  readonly cityVariations: readonly string[];
  readonly districtSynonyms: readonly string[];
  readonly stateVariations: readonly string[];
}

/**
 * Generate city name variations
 */
export function getCityNameVariations(cityName: string): readonly string[] {
  const variations = new Set<string>([cityName]); // Always include original

  // St./Saint variations
  if (cityName.startsWith('St. ')) {
    variations.add(cityName.replace('St. ', 'Saint '));
    variations.add(cityName.replace('St. ', 'St '));
  } else if (cityName.startsWith('Saint ')) {
    variations.add(cityName.replace('Saint ', 'St. '));
    variations.add(cityName.replace('Saint ', 'St '));
  }

  // Fort/Ft. variations
  if (cityName.startsWith('Fort ')) {
    variations.add(cityName.replace('Fort ', 'Ft. '));
    variations.add(cityName.replace('Fort ', 'Ft '));
  } else if (cityName.startsWith('Ft. ')) {
    variations.add(cityName.replace('Ft. ', 'Fort '));
    variations.add(cityName.replace('Ft. ', 'Ft '));
  }

  // Mount/Mt. variations
  if (cityName.startsWith('Mount ')) {
    variations.add(cityName.replace('Mount ', 'Mt. '));
    variations.add(cityName.replace('Mount ', 'Mt '));
  } else if (cityName.startsWith('Mt. ')) {
    variations.add(cityName.replace('Mt. ', 'Mount '));
    variations.add(cityName.replace('Mt. ', 'Mt '));
  }

  return Array.from(variations);
}

/**
 * Get district terminology synonyms
 */
export function getDistrictSynonyms(): readonly string[] {
  return [
    'council district',
    'council ward',
    'ward',
    'district',
    'municipal district',
    'city council district',
  ];
}

/**
 * Get state name variations (full name + abbreviation)
 */
export function getStateVariations(state: string): readonly string[] {
  const STATE_NAMES: Record<string, string> = {
    'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
    'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
    'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
    'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
    'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
    'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
    'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
    'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
    'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
    'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
    'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
    'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
    'WI': 'Wisconsin', 'WY': 'Wyoming', 'DC': 'District of Columbia',
  };

  // If given abbreviation, return both
  if (state.length === 2) {
    const fullName = STATE_NAMES[state];
    if (fullName) {
      return [state, fullName];
    }
    // Unknown abbreviation, return just the input
    return [state];
  }

  // If given full name, find abbreviation
  const abbrev = Object.entries(STATE_NAMES).find(([_, name]) => name === state)?.[0];
  return abbrev ? [abbrev, state] : [state];
}

/**
 * Generate comprehensive search query variations
 */
export function generateSearchQueries(
  cityName: string,
  state: string,
  maxQueries: number = 20
): readonly string[] {
  const cityVariations = getCityNameVariations(cityName);
  const districtSynonyms = getDistrictSynonyms();
  const stateVariations = getStateVariations(state);

  const queries: string[] = [];

  // Generate all combinations (city + state + district synonym)
  for (const city of cityVariations) {
    for (const stateVar of stateVariations) {
      for (const synonym of districtSynonyms) {
        queries.push(`${city} ${stateVar} ${synonym}`);

        if (queries.length >= maxQueries) {
          return queries.slice(0, maxQueries);
        }
      }
    }
  }

  return queries;
}
