/**
 * FIPS Code Mappings and Utilities
 *
 * Single source of truth for US state FIPS code conversions.
 * Includes 50 states + DC + 5 territories.
 *
 * Source: US Census Bureau FIPS codes
 * https://www.census.gov/library/reference/code-lists/ansi.html
 */

/**
 * State FIPS code → State name mapping
 *
 * Canonical source for all FIPS-to-name conversions.
 */
export const STATE_FIPS_TO_NAME: Readonly<Record<string, string>> = {
  // 50 States + DC
  '01': 'Alabama',
  '02': 'Alaska',
  '04': 'Arizona',
  '05': 'Arkansas',
  '06': 'California',
  '08': 'Colorado',
  '09': 'Connecticut',
  '10': 'Delaware',
  '11': 'District of Columbia',
  '12': 'Florida',
  '13': 'Georgia',
  '15': 'Hawaii',
  '16': 'Idaho',
  '17': 'Illinois',
  '18': 'Indiana',
  '19': 'Iowa',
  '20': 'Kansas',
  '21': 'Kentucky',
  '22': 'Louisiana',
  '23': 'Maine',
  '24': 'Maryland',
  '25': 'Massachusetts',
  '26': 'Michigan',
  '27': 'Minnesota',
  '28': 'Mississippi',
  '29': 'Missouri',
  '30': 'Montana',
  '31': 'Nebraska',
  '32': 'Nevada',
  '33': 'New Hampshire',
  '34': 'New Jersey',
  '35': 'New Mexico',
  '36': 'New York',
  '37': 'North Carolina',
  '38': 'North Dakota',
  '39': 'Ohio',
  '40': 'Oklahoma',
  '41': 'Oregon',
  '42': 'Pennsylvania',
  '44': 'Rhode Island',
  '45': 'South Carolina',
  '46': 'South Dakota',
  '47': 'Tennessee',
  '48': 'Texas',
  '49': 'Utah',
  '50': 'Vermont',
  '51': 'Virginia',
  '53': 'Washington',
  '54': 'West Virginia',
  '55': 'Wisconsin',
  '56': 'Wyoming',
  // US Territories
  '60': 'American Samoa',
  '66': 'Guam',
  '69': 'Northern Mariana Islands',
  '72': 'Puerto Rico',
  '78': 'US Virgin Islands',
} as const;

/**
 * State abbreviation → FIPS code mapping
 *
 * Reverse mapping for lookups by state code.
 * Used primarily by TIGER boundary provider for state filtering.
 */
export const STATE_ABBR_TO_FIPS: Readonly<Record<string, string>> = {
  // 50 States
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06',
  CO: '08', CT: '09', DE: '10', FL: '12', GA: '13',
  HI: '15', ID: '16', IL: '17', IN: '18', IA: '19',
  KS: '20', KY: '21', LA: '22', ME: '23', MD: '24',
  MA: '25', MI: '26', MN: '27', MS: '28', MO: '29',
  MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34',
  NM: '35', NY: '36', NC: '37', ND: '38', OH: '39',
  OK: '40', OR: '41', PA: '42', RI: '44', SC: '45',
  SD: '46', TN: '47', TX: '48', UT: '49', VT: '50',
  VA: '51', WA: '53', WV: '54', WI: '55', WY: '56',
  // DC + Territories
  DC: '11',
  AS: '60', GU: '66', MP: '69', PR: '72', VI: '78',
} as const;

/**
 * Get state name from FIPS code
 *
 * @param fips - 2-digit FIPS code (e.g., "06" for California)
 * @returns State name or null if FIPS code not found
 *
 * @example
 * getStateNameFromFips('06') // 'California'
 * getStateNameFromFips('72') // 'Puerto Rico'
 * getStateNameFromFips('99') // null
 */
export function getStateNameFromFips(fips: string): string | null {
  return STATE_FIPS_TO_NAME[fips] ?? null;
}

/**
 * Get FIPS code from state abbreviation
 *
 * @param abbr - 2-letter state abbreviation (e.g., "CA" for California)
 * @returns FIPS code or null if abbreviation not found
 *
 * @example
 * getFipsFromStateAbbr('CA') // '06'
 * getFipsFromStateAbbr('PR') // '72'
 * getFipsFromStateAbbr('XX') // null
 */
export function getFipsFromStateAbbr(abbr: string): string | null {
  return STATE_ABBR_TO_FIPS[abbr] ?? null;
}
