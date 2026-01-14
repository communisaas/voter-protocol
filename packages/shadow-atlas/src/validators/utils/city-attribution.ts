/**
 * City Attribution for Council District Layers
 *
 * Strategy to extract city FIPS from ArcGIS Hub layers that lack explicit city names.
 * These are high-confidence council district layers (60%+) missing city attribution.
 *
 * APPROACH:
 * 1. Service URL patterns → known city data portals
 * 2. Layer name extraction → Census Place name matching
 * 3. Organization ID lookup → city registry
 * 4. Fallback: Manual curation queue
 */

// =============================================================================
// Types
// =============================================================================

export interface CityAttribution {
  /** 7-digit Census Place FIPS */
  fips: string;
  /** City name */
  name: string;
  /** State abbreviation */
  state: string;
  /** Confidence in attribution (0-100) */
  confidence: number;
  /** How the attribution was determined */
  method: 'URL_PATTERN' | 'NAME_EXTRACTION' | 'ORG_LOOKUP' | 'MANUAL';
}

// =============================================================================
// Known ArcGIS Organization → City Mapping
// =============================================================================

/**
 * Known ArcGIS Hub organization IDs mapped to cities
 * These are extracted from successful ACCEPT classifications
 */
const ORG_TO_CITY: Record<string, CityAttribution> = {
  // New York City
  'GfwWNkhOj9bNBqoJ': { fips: '3651000', name: 'New York', state: 'NY', confidence: 95, method: 'ORG_LOOKUP' },
  // Los Angeles
  'ZIL9uO234SBBPGL7': { fips: '0644000', name: 'Los Angeles', state: 'CA', confidence: 90, method: 'ORG_LOOKUP' },
  'LMBdfutQCnDGYUyc': { fips: '0644000', name: 'Los Angeles', state: 'CA', confidence: 95, method: 'ORG_LOOKUP' },
  // Dallas
  'rwnOSbfKSwyTBcwN': { fips: '4819000', name: 'Dallas', state: 'TX', confidence: 90, method: 'ORG_LOOKUP' },
  // Boston
  'sFnw0xNflSi8J0uh': { fips: '2507000', name: 'Boston', state: 'MA', confidence: 90, method: 'ORG_LOOKUP' },
  // San Diego
  'oxInpRhVIBxlo4pO': { fips: '0666000', name: 'San Diego', state: 'CA', confidence: 90, method: 'ORG_LOOKUP' },
  'uEH09Hfm70zI2ZxR': { fips: '0666000', name: 'San Diego', state: 'CA', confidence: 95, method: 'ORG_LOOKUP' },
  // Detroit
  'HsXtOCMp1Nis1Ogr': { fips: '2622000', name: 'Detroit', state: 'MI', confidence: 90, method: 'ORG_LOOKUP' },
  // Philadelphia
  '9U43PSoL47wawX5S': { fips: '4260000', name: 'Philadelphia', state: 'PA', confidence: 90, method: 'ORG_LOOKUP' },
  // Seattle
  'SeWsTK5xJp3VxMNM': { fips: '5363000', name: 'Seattle', state: 'WA', confidence: 90, method: 'ORG_LOOKUP' },
  // Houston
  'aCwPyQNOaxgb6Yvi': { fips: '4835000', name: 'Houston', state: 'TX', confidence: 90, method: 'ORG_LOOKUP' },
  // Austin
  'qHb2GdZLkvnyNM35': { fips: '4805000', name: 'Austin', state: 'TX', confidence: 90, method: 'ORG_LOOKUP' },
  // Jacksonville
  'r24cv1JRnR3HZXVQ': { fips: '1235000', name: 'Jacksonville', state: 'FL', confidence: 90, method: 'ORG_LOOKUP' },
  // Milwaukee
  's1wgJQKbKJihhhaT': { fips: '5553000', name: 'Milwaukee', state: 'WI', confidence: 90, method: 'ORG_LOOKUP' },
  // Pittsburgh
  'hQ7B0GgIfZFO93wD': { fips: '4261000', name: 'Pittsburgh', state: 'PA', confidence: 90, method: 'ORG_LOOKUP' },
  // Louisville
  'YbSMWQBaJXXp4uQ8': { fips: '2148006', name: 'Louisville', state: 'KY', confidence: 90, method: 'ORG_LOOKUP' },
  // Oakland
  '9tC74aDHuml0x5Yz': { fips: '0653000', name: 'Oakland', state: 'CA', confidence: 85, method: 'ORG_LOOKUP' },
};

// =============================================================================
// City Name Patterns (Extended from edge-cases.ts)
// =============================================================================

const CITY_NAME_PATTERNS: Array<{ pattern: RegExp; fips: string; name: string; state: string }> = [
  // Top 50 cities
  { pattern: /new.*york|nyc|\bnyc\b/i, fips: '3651000', name: 'New York', state: 'NY' },
  { pattern: /los.*angeles|\bla\b.*city.*council|la_city_council/i, fips: '0644000', name: 'Los Angeles', state: 'CA' },
  { pattern: /\bchicago\b/i, fips: '1714000', name: 'Chicago', state: 'IL' },
  { pattern: /\bhouston\b/i, fips: '4835000', name: 'Houston', state: 'TX' },
  { pattern: /\bphoenix\b/i, fips: '0455000', name: 'Phoenix', state: 'AZ' },
  { pattern: /philadelphia|phila|philly/i, fips: '4260000', name: 'Philadelphia', state: 'PA' },
  { pattern: /san.*antonio/i, fips: '4865000', name: 'San Antonio', state: 'TX' },
  { pattern: /san.*diego/i, fips: '0666000', name: 'San Diego', state: 'CA' },
  { pattern: /\bdallas\b/i, fips: '4819000', name: 'Dallas', state: 'TX' },
  { pattern: /san.*jose/i, fips: '0668000', name: 'San Jose', state: 'CA' },
  { pattern: /\baustin\b/i, fips: '4805000', name: 'Austin', state: 'TX' },
  { pattern: /jacksonville/i, fips: '1235000', name: 'Jacksonville', state: 'FL' },
  { pattern: /fort.*worth/i, fips: '4827000', name: 'Fort Worth', state: 'TX' },
  { pattern: /\bcolumbus\b/i, fips: '3918000', name: 'Columbus', state: 'OH' },
  { pattern: /san.*francisco|\bsf\b.*city/i, fips: '0667000', name: 'San Francisco', state: 'CA' },
  { pattern: /\bcharlotte\b/i, fips: '3712000', name: 'Charlotte', state: 'NC' },
  { pattern: /indianapolis|indy/i, fips: '1836003', name: 'Indianapolis', state: 'IN' },
  { pattern: /\bseattle\b/i, fips: '5363000', name: 'Seattle', state: 'WA' },
  { pattern: /\bdenver\b/i, fips: '0820000', name: 'Denver', state: 'CO' },
  { pattern: /washington.*dc|\bdc\b.*gov/i, fips: '1150000', name: 'Washington', state: 'DC' },
  { pattern: /\bboston\b/i, fips: '2507000', name: 'Boston', state: 'MA' },
  { pattern: /\bnashville\b/i, fips: '4752006', name: 'Nashville', state: 'TN' },
  { pattern: /\bdetroit\b/i, fips: '2622000', name: 'Detroit', state: 'MI' },
  { pattern: /portland.*or/i, fips: '4159000', name: 'Portland', state: 'OR' },
  { pattern: /las.*vegas/i, fips: '3240000', name: 'Las Vegas', state: 'NV' },
  { pattern: /\bmemphis\b/i, fips: '4748000', name: 'Memphis', state: 'TN' },
  { pattern: /\blouisville\b/i, fips: '2148006', name: 'Louisville', state: 'KY' },
  { pattern: /\bbaltimore\b/i, fips: '2404000', name: 'Baltimore', state: 'MD' },
  { pattern: /\bmilwaukee\b/i, fips: '5553000', name: 'Milwaukee', state: 'WI' },
  { pattern: /albuquerque/i, fips: '3502000', name: 'Albuquerque', state: 'NM' },
  { pattern: /\btucson\b/i, fips: '0477000', name: 'Tucson', state: 'AZ' },
  { pattern: /sacramento/i, fips: '0664000', name: 'Sacramento', state: 'CA' },
  { pattern: /kansas.*city/i, fips: '2938000', name: 'Kansas City', state: 'MO' },
  { pattern: /\batlanta\b/i, fips: '1304000', name: 'Atlanta', state: 'GA' },
  { pattern: /\braleigh\b/i, fips: '3755000', name: 'Raleigh', state: 'NC' },
  { pattern: /\boakland\b/i, fips: '0653000', name: 'Oakland', state: 'CA' },
  { pattern: /minneapolis/i, fips: '2743000', name: 'Minneapolis', state: 'MN' },
  { pattern: /\bcleveland\b/i, fips: '3916000', name: 'Cleveland', state: 'OH' },
  { pattern: /\btampa\b/i, fips: '1271000', name: 'Tampa', state: 'FL' },
  { pattern: /new.*orleans/i, fips: '2255000', name: 'New Orleans', state: 'LA' },
  { pattern: /cincinnati/i, fips: '3915000', name: 'Cincinnati', state: 'OH' },
  { pattern: /pittsburgh/i, fips: '4261000', name: 'Pittsburgh', state: 'PA' },
  { pattern: /st\.?\s*louis|saint.*louis/i, fips: '2965000', name: 'St. Louis', state: 'MO' },
  { pattern: /\borlando\b/i, fips: '1253000', name: 'Orlando', state: 'FL' },
  // Extended cities (51-100)
  { pattern: /\bmiami\b/i, fips: '1245000', name: 'Miami', state: 'FL' },
  { pattern: /\bglendale\b/i, fips: '0430000', name: 'Glendale', state: 'AZ' },
  { pattern: /long\s*beach/i, fips: '0643000', name: 'Long Beach', state: 'CA' },
  { pattern: /\bfresno\b/i, fips: '0627000', name: 'Fresno', state: 'CA' },
  { pattern: /virgin.*beach/i, fips: '5182000', name: 'Virginia Beach', state: 'VA' },
  { pattern: /\bst\.?\s*paul\b/i, fips: '2758000', name: 'St. Paul', state: 'MN' },
  { pattern: /\bomaha\b/i, fips: '3137000', name: 'Omaha', state: 'NE' },
  { pattern: /colorado.*springs/i, fips: '0816000', name: 'Colorado Springs', state: 'CO' },
  { pattern: /\btulsa\b/i, fips: '4075000', name: 'Tulsa', state: 'OK' },
  { pattern: /arlington.*tx/i, fips: '4804000', name: 'Arlington', state: 'TX' },
  // Consolidated Cities / Counties / Parishes
  { pattern: /honolulu/i, fips: '15003', name: 'Honolulu County', state: 'HI' },
  { pattern: /terrebonne/i, fips: '22109', name: 'Terrebonne Parish', state: 'LA' },
  { pattern: /sampson.*county/i, fips: '3715340', name: 'Sampson County', state: 'NC' },
  { pattern: /louisville.*metro/i, fips: '2148006', name: 'Louisville', state: 'KY' },
  { pattern: /indy.*council|indianale/i, fips: '1836003', name: 'Indianapolis', state: 'IN' },
];

// =============================================================================
// Attribution Functions
// =============================================================================

/**
 * Extract ArcGIS organization ID from service URL
 */
function extractOrgId(url: string): string | null {
  // Pattern: https://services[N].arcgis.com/{orgId}/arcgis/rest/...
  const match = url.match(/services\d*\.arcgis\.com\/([a-zA-Z0-9]+)\//);
  return match?.[1] ?? null;
}

/**
 * Attempt to attribute a layer to a city
 */
export function attributeCity(url: string, layerName: string): CityAttribution | null {
  // Method 1: Organization ID lookup (highest confidence)
  const orgId = extractOrgId(url);
  if (orgId && ORG_TO_CITY[orgId]) {
    return ORG_TO_CITY[orgId];
  }

  // Method 2: City name in URL or layer name
  const searchText = `${url} ${layerName}`.toLowerCase();

  for (const city of CITY_NAME_PATTERNS) {
    if (city.pattern.test(searchText)) {
      return {
        fips: city.fips,
        name: city.name,
        state: city.state,
        confidence: 80,
        method: 'NAME_EXTRACTION',
      };
    }
  }

  // Method 3: URL domain patterns for known city portals
  // (These are cities with custom ArcGIS portal domains)
  const domainPatterns: Array<{ domain: RegExp; city: CityAttribution }> = [
    { domain: /data\.seattle\.gov/i, city: { fips: '5363000', name: 'Seattle', state: 'WA', confidence: 95, method: 'URL_PATTERN' } },
    { domain: /data\.cityofchicago\.org/i, city: { fips: '1714000', name: 'Chicago', state: 'IL', confidence: 95, method: 'URL_PATTERN' } },
    { domain: /data\.boston\.gov/i, city: { fips: '2507000', name: 'Boston', state: 'MA', confidence: 95, method: 'URL_PATTERN' } },
    { domain: /gis\.atlantaga\.gov/i, city: { fips: '1304000', name: 'Atlanta', state: 'GA', confidence: 95, method: 'URL_PATTERN' } },
    { domain: /opendata\.dc\.gov/i, city: { fips: '1150000', name: 'Washington', state: 'DC', confidence: 95, method: 'URL_PATTERN' } },
  ];

  for (const { domain, city } of domainPatterns) {
    if (domain.test(url)) {
      return city;
    }
  }

  return null;
}

/**
 * Batch process layers needing city context
 */
export function batchAttributeCities(
  layers: readonly { url: string; name: string }[]
): {
  attributed: Array<{ url: string; name: string; city: CityAttribution }>;
  unattributed: Array<{ url: string; name: string }>;
} {
  const attributed: Array<{ url: string; name: string; city: CityAttribution }> = [];
  const unattributed: Array<{ url: string; name: string }> = [];

  for (const layer of layers) {
    const city = attributeCity(layer.url, layer.name);
    if (city) {
      attributed.push({ url: layer.url, name: layer.name, city });
    } else {
      unattributed.push(layer);
    }
  }

  return { attributed, unattributed };
}

// =============================================================================
// Stats
// =============================================================================

export const ATTRIBUTION_STATS = {
  knownOrgIds: Object.keys(ORG_TO_CITY).length,
  cityPatterns: CITY_NAME_PATTERNS.length,
};
