#!/usr/bin/env npx tsx
/**
 * FIPS Resolver - Multi-Strategy City Attribution
 *
 * Strategies (in order of reliability):
 * 1. ArcGIS Org ID lookup (pre-built registry)
 * 2. Service name parsing (extract city/town names)
 * 3. Spatial Reference WKID → State mapping
 * 4. Extent centroid → Census Place lookup
 * 5. ArcGIS REST API metadata query
 */

// =============================================================================
// Types
// =============================================================================

export interface FipsResolution {
  fips: string;
  name: string;
  state: string;
  method: 'ORG_LOOKUP' | 'NAME_PARSE' | 'WKID_STATE' | 'EXTENT_GEOCODE' | 'API_METADATA';
  confidence: number;
}

export interface FipsResolutionResult {
  url: string;
  name: string;
  resolution: FipsResolution;
}

export interface UnresolvedLayer {
  url: string;
  name: string;
}

interface ServiceMetadata {
  name: string;
  description: string;
  copyrightText: string;
  extent: {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
    spatialReference: {
      wkid: number;
      latestWkid?: number;
    };
  };
}

// =============================================================================
// WKID → State Mapping
// =============================================================================

/**
 * State Plane Coordinate Systems mapped to states
 * See: https://epsg.io/
 */
const WKID_TO_STATE: Record<number, { state: string; zone?: string }> = {
  // Alabama
  102629: { state: 'AL', zone: 'East' },
  102630: { state: 'AL', zone: 'West' },

  // Arizona
  102648: { state: 'AZ', zone: 'Central' },
  102649: { state: 'AZ', zone: 'East' },
  102650: { state: 'AZ', zone: 'West' },

  // California
  2225: { state: 'CA', zone: '1' },
  2226: { state: 'CA', zone: '2' },
  2227: { state: 'CA', zone: '3' }, // San Jose, Sacramento
  2228: { state: 'CA', zone: '4' }, // Los Angeles
  2229: { state: 'CA', zone: '5' }, // San Diego
  2230: { state: 'CA', zone: '6' },

  // Colorado
  2231: { state: 'CO', zone: 'North' },
  2232: { state: 'CO', zone: 'Central' },
  2233: { state: 'CO', zone: 'South' },

  // Florida
  2236: { state: 'FL', zone: 'East' },
  2237: { state: 'FL', zone: 'West' },
  2238: { state: 'FL', zone: 'North' },

  // Georgia
  2239: { state: 'GA', zone: 'East' },
  2240: { state: 'GA', zone: 'West' },

  // Illinois
  3435: { state: 'IL', zone: 'East' },
  3436: { state: 'IL', zone: 'West' },

  // Indiana
  2965: { state: 'IN', zone: 'East' },
  2966: { state: 'IN', zone: 'West' },

  // Massachusetts
  2249: { state: 'MA', zone: 'Mainland' },
  2250: { state: 'MA', zone: 'Island' },

  // Michigan
  2251: { state: 'MI', zone: 'North' },
  2252: { state: 'MI', zone: 'Central' },
  2253: { state: 'MI', zone: 'South' },

  // Minnesota (Skipping 2272 North due to collision with PA)
  2273: { state: 'MN', zone: 'Central' },
  2274: { state: 'MN', zone: 'South' },

  // New Jersey
  3424: { state: 'NJ' },

  // New York
  2260: { state: 'NY', zone: 'East' },
  2261: { state: 'NY', zone: 'Central' },
  2262: { state: 'NY', zone: 'West' },
  2263: { state: 'NY', zone: 'Long Island' },

  // North Carolina
  2264: { state: 'NC' },
  102719: { state: 'NC' }, // NAD83 HARN

  // Ohio
  3734: { state: 'OH', zone: 'North' },
  3735: { state: 'OH', zone: 'South' },

  // Pennsylvania
  2271: { state: 'PA', zone: 'North' },
  2272: { state: 'PA', zone: 'South' },

  // Texas
  2275: { state: 'TX', zone: 'North' },
  2276: { state: 'TX', zone: 'North Central' },
  2277: { state: 'TX', zone: 'Central' },
  2278: { state: 'TX', zone: 'South Central' },
  2279: { state: 'TX', zone: 'South' },

  // Virginia
  2283: { state: 'VA', zone: 'North' },
  2284: { state: 'VA', zone: 'South' },

  // Washington
  2285: { state: 'WA', zone: 'North' },
  2286: { state: 'WA', zone: 'South' },

  // Wisconsin
  2287: { state: 'WI', zone: 'North' },
  2288: { state: 'WI', zone: 'Central' },
  2289: { state: 'WI', zone: 'South' },

  // Web Mercator (global - no state info)
  3857: { state: '' },
  102100: { state: '' },

  // WGS84 (global - no state info)
  4326: { state: '' },
};

// =============================================================================
// City Name Patterns for Service Name Parsing
// =============================================================================

interface CityPattern {
  pattern: RegExp;
  fips: string;
  name: string;
  state: string;
}

const SERVICE_NAME_PATTERNS: CityPattern[] = [
  // Extract "City of X" or "X City" patterns
  { pattern: /morrisville/i, fips: '3746060', name: 'Morrisville', state: 'NC' },
  { pattern: /\bnewark\b/i, fips: '3451000', name: 'Newark', state: 'NJ' },
  { pattern: /\bsan\s*jose\b|csj/i, fips: '0668000', name: 'San Jose', state: 'CA' },
  { pattern: /\bsampson.*county\b/i, fips: '3715340', name: 'Sampson County', state: 'NC' },
  { pattern: /\bclinton\b.*nc/i, fips: '3713180', name: 'Clinton', state: 'NC' },
  { pattern: /\bdurham\b/i, fips: '3719000', name: 'Durham', state: 'NC' },
  { pattern: /\braleigh\b/i, fips: '3755000', name: 'Raleigh', state: 'NC' },
  { pattern: /\bcharlotte\b/i, fips: '3712000', name: 'Charlotte', state: 'NC' },
  { pattern: /\bgreensboro\b/i, fips: '3728000', name: 'Greensboro', state: 'NC' },
  { pattern: /\bwilmington\b.*nc/i, fips: '3774440', name: 'Wilmington', state: 'NC' },
  { pattern: /\baugusta\b/i, fips: '1304204', name: 'Augusta', state: 'GA' },
  { pattern: /\bsavannah\b/i, fips: '1369000', name: 'Savannah', state: 'GA' },
  { pattern: /\batlanta\b/i, fips: '1304000', name: 'Atlanta', state: 'GA' },
  { pattern: /\bmacon\b/i, fips: '1349000', name: 'Macon', state: 'GA' },
  { pattern: /\bcolumbus\b.*ga/i, fips: '1319000', name: 'Columbus', state: 'GA' },
  { pattern: /\btampa\b/i, fips: '1271000', name: 'Tampa', state: 'FL' },
  { pattern: /\bjacksonville\b/i, fips: '1235000', name: 'Jacksonville', state: 'FL' },
  { pattern: /\bmiami\b/i, fips: '1245000', name: 'Miami', state: 'FL' },
  { pattern: /\borlando\b/i, fips: '1253000', name: 'Orlando', state: 'FL' },
  { pattern: /\bst\.?\s*petersburg\b/i, fips: '1263000', name: 'St. Petersburg', state: 'FL' },
  { pattern: /\bchicago\b/i, fips: '1714000', name: 'Chicago', state: 'IL' },
  { pattern: /\bspringfield\b.*il/i, fips: '1772000', name: 'Springfield', state: 'IL' },
  { pattern: /\bpeoria\b/i, fips: '1759000', name: 'Peoria', state: 'IL' },
  { pattern: /\brockford\b/i, fips: '1765000', name: 'Rockford', state: 'IL' },
  { pattern: /\bdetroit\b/i, fips: '2622000', name: 'Detroit', state: 'MI' },
  { pattern: /\bgrand\s*rapids\b/i, fips: '2634000', name: 'Grand Rapids', state: 'MI' },
  { pattern: /\bann\s*arbor\b/i, fips: '2603000', name: 'Ann Arbor', state: 'MI' },
  { pattern: /\blansing\b/i, fips: '2646000', name: 'Lansing', state: 'MI' },
  { pattern: /\bminneapolis\b/i, fips: '2743000', name: 'Minneapolis', state: 'MN' },
  { pattern: /\bst\.?\s*paul\b/i, fips: '2758000', name: 'St. Paul', state: 'MN' },
  { pattern: /\bduluth\b/i, fips: '2717000', name: 'Duluth', state: 'MN' },
  { pattern: /\bcleveland\b/i, fips: '3916000', name: 'Cleveland', state: 'OH' },
  { pattern: /\bcolumbus\b.*oh/i, fips: '3918000', name: 'Columbus', state: 'OH' },
  { pattern: /\bcincinnati\b/i, fips: '3915000', name: 'Cincinnati', state: 'OH' },
  { pattern: /\btoledo\b/i, fips: '3977000', name: 'Toledo', state: 'OH' },
  { pattern: /\bakron\b/i, fips: '3901000', name: 'Akron', state: 'OH' },
  { pattern: /\bdayton\b/i, fips: '3921000', name: 'Dayton', state: 'OH' },
  { pattern: /\bphiladelphia\b/i, fips: '4260000', name: 'Philadelphia', state: 'PA' },
  { pattern: /\bpittsburgh\b/i, fips: '4261000', name: 'Pittsburgh', state: 'PA' },
  { pattern: /\ballentown\b/i, fips: '4202000', name: 'Allentown', state: 'PA' },
  { pattern: /\breading\b.*pa/i, fips: '4263624', name: 'Reading', state: 'PA' },
  { pattern: /\bdallas\b/i, fips: '4819000', name: 'Dallas', state: 'TX' },
  { pattern: /\bhouston\b/i, fips: '4835000', name: 'Houston', state: 'TX' },
  { pattern: /\bsan\s*antonio\b/i, fips: '4865000', name: 'San Antonio', state: 'TX' },
  { pattern: /\baustin\b/i, fips: '4805000', name: 'Austin', state: 'TX' },
  { pattern: /\bfort\s*worth\b/i, fips: '4827000', name: 'Fort Worth', state: 'TX' },
  { pattern: /\bel\s*paso\b/i, fips: '4824000', name: 'El Paso', state: 'TX' },
  { pattern: /\barlington\b.*tx/i, fips: '4804000', name: 'Arlington', state: 'TX' },
  { pattern: /\bseattle\b/i, fips: '5363000', name: 'Seattle', state: 'WA' },
  { pattern: /\bspokane\b/i, fips: '5367000', name: 'Spokane', state: 'WA' },
  { pattern: /\btacoma\b/i, fips: '5370000', name: 'Tacoma', state: 'WA' },
  { pattern: /\bbellevue\b.*wa/i, fips: '5305210', name: 'Bellevue', state: 'WA' },
  { pattern: /\bmilwaukee\b/i, fips: '5553000', name: 'Milwaukee', state: 'WI' },
  { pattern: /\bmadison\b.*wi/i, fips: '5548000', name: 'Madison', state: 'WI' },
  { pattern: /\bgreen\s*bay\b/i, fips: '5531000', name: 'Green Bay', state: 'WI' },
];

// =============================================================================
// Resolver Functions
// =============================================================================

/**
 * Extract ArcGIS org ID from URL
 */
function extractOrgId(url: string): string | null {
  const match = url.match(/services\d*\.arcgis\.com\/([a-zA-Z0-9]+)\//);
  return match?.[1] ?? null;
}

/**
 * Parse service name for city/county names
 */
function parseServiceName(serviceName: string, url: string): FipsResolution | null {
  const searchText = `${serviceName} ${url}`.toLowerCase();

  for (const city of SERVICE_NAME_PATTERNS) {
    if (city.pattern.test(searchText)) {
      return {
        fips: city.fips,
        name: city.name,
        state: city.state,
        method: 'NAME_PARSE',
        confidence: 75,
      };
    }
  }

  return null;
}

/**
 * Determine state from WKID (spatial reference)
 */
function resolveStateFromWkid(wkid: number): string | null {
  const stateInfo = WKID_TO_STATE[wkid];
  return stateInfo?.state || null;
}

/**
 * Convert Web Mercator extent to WGS84 lat/lon
 */
function webMercatorToLatLon(
  x: number,
  y: number
): { lat: number; lon: number } {
  const lon = (x / 20037508.34) * 180;
  let lat = (y / 20037508.34) * 180;
  lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2);
  return { lat, lon };
}

/**
 * Fetch metadata from ArcGIS REST API
 */
async function fetchServiceMetadata(url: string): Promise<ServiceMetadata | null> {
  try {
    const response = await fetch(`${url}?f=json`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    return await response.json() as ServiceMetadata;
  } catch {
    return null;
  }
}

/**
 * Query ArcGIS feature service for a sample geometry centroid
 */
async function fetchSampleCentroid(url: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const queryUrl = `${url}/query?where=1=1&returnGeometry=true&outSR=4326&resultRecordCount=1&f=json`;
    const response = await fetch(queryUrl, {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;

    const data = await response.json() as {
      features?: Array<{
        geometry?: {
          rings?: number[][][];
          x?: number;
          y?: number;
        };
      }>;
    };

    const geom = data.features?.[0]?.geometry;
    if (!geom) return null;

    // Handle polygon geometry
    if (geom.rings && geom.rings[0]) {
      const ring = geom.rings[0];
      // Calculate centroid from first ring
      let sumX = 0, sumY = 0;
      for (const [x, y] of ring) {
        sumX += x;
        sumY += y;
      }
      return {
        lon: sumX / ring.length,
        lat: sumY / ring.length,
      };
    }

    // Handle point geometry
    if (typeof geom.x === 'number' && typeof geom.y === 'number') {
      return { lon: geom.x, lat: geom.y };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Reverse geocode coordinates to Census Place FIPS using Census Geocoder API
 */
async function reverseGeocodeToCensusPlace(
  lat: number,
  lon: number
): Promise<{ fips: string; name: string; state: string; type: 'city' | 'county' } | null> {
  try {
    // Request defaults (includes Incorporated Places, Counties, States, etc.) by omitting 'layers' param
    const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lon}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;

    const data = await response.json() as {
      result?: {
        geographies?: {
          'Incorporated Places'?: Array<{
            GEOID: string;
            NAME: string;
            STATE: string;
          }>;
          'Counties'?: Array<{
            GEOID: string;
            NAME: string;
            STATE: string;
          }>;
        };
      };
    };

    // Priority 1: Incorporated Places (Cities, Towns, Villages, CDPs)
    const place = data.result?.geographies?.['Incorporated Places']?.[0];
    if (place) {
      // Extract city name (remove "city", "town", etc. suffix)
      const name = place.NAME.replace(/\s+(city|town|village|CDP)$/i, '');
      const stateFips = place.STATE;
      const stateAbbr = FIPS_TO_STATE[stateFips] || stateFips;

      return {
        fips: place.GEOID,
        name,
        state: stateAbbr,
        type: 'city',
      };
    }

    // Priority 2: Counties (for County Commissioner Districts and consolidated city-counties like Honolulu)
    const county = data.result?.geographies?.['Counties']?.[0];
    if (county) {
      const stateFips = county.STATE;
      const stateAbbr = FIPS_TO_STATE[stateFips] || stateFips;

      return {
        fips: county.GEOID,
        name: county.NAME,
        state: stateAbbr,
        type: 'county',
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * State FIPS to abbreviation mapping
 */
const FIPS_TO_STATE: Record<string, string> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
  '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
  '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
  '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
  '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
  '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
  '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
  '56': 'WY',
};

/**
 * Resolve FIPS using multiple strategies
 */
export async function resolveFips(
  url: string,
  layerName: string,
  orgIdRegistry?: Record<string, FipsResolution>,
  useGeocode = true
): Promise<FipsResolution | null> {
  // Strategy 1: Org ID lookup (fastest, highest confidence)
  const orgId = extractOrgId(url);
  if (orgId && orgIdRegistry?.[orgId]) {
    return orgIdRegistry[orgId];
  }

  // Strategy 2: Parse service name for city names
  const nameResult = parseServiceName(layerName, url);
  if (nameResult) {
    return nameResult;
  }

  // Strategy 3: Fetch metadata and parse name/copyright
  const metadata = await fetchServiceMetadata(url);
  if (metadata) {
    // Try parsing the service name from metadata
    const metaNameResult = parseServiceName(metadata.name, url);
    if (metaNameResult) {
      return metaNameResult;
    }

    // Try copyright text
    if (metadata.copyrightText) {
      const copyrightResult = parseServiceName(metadata.copyrightText, '');
      if (copyrightResult) {
        return { ...copyrightResult, confidence: 70 };
      }
    }
  }

  // Strategy 4: Query feature geometry and reverse geocode via Census API
  if (useGeocode) {
    const centroid = await fetchSampleCentroid(url);
    if (centroid) {
      const place = await reverseGeocodeToCensusPlace(centroid.lat, centroid.lon);
      if (place) {
        // If it's a "City and County" or "Metro Government", it's effectively a city
        const isConsolidated = place.name.match(/metro|consolidated|city and county/i);

        // If we found a county but the layer name implies a city council, we might want to be careful
        // But many "City Council" layers are actually consolidated city-counties
        const confidence = isConsolidated ? 85 : (place.type === 'county' ? 75 : 85);

        return {
          fips: place.fips,
          name: place.name,
          state: place.state,
          method: 'EXTENT_GEOCODE',
          confidence,
        };
      }
    }
  }

  // Strategy 5: Fall back to WKID state detection (partial resolution)
  if (metadata) {
    const wkid = metadata.extent?.spatialReference?.latestWkid ||
      metadata.extent?.spatialReference?.wkid;
    if (wkid) {
      const state = resolveStateFromWkid(wkid);
      if (state) {
        return {
          fips: `STATE:${state}`,
          name: `Unknown city in ${state}`,
          state,
          method: 'WKID_STATE',
          confidence: 40,
        };
      }
    }
  }

  return null;
}

/**
 * Batch resolve FIPS for multiple layers
 */
export async function batchResolveFips(
  layers: readonly { url: string; name: string }[],
  orgIdRegistry?: Record<string, FipsResolution>,
  concurrency = 5
): Promise<{
  resolved: Array<{ url: string; name: string; resolution: FipsResolution }>;
  unresolved: Array<{ url: string; name: string }>;
  byState: Record<string, number>;
}> {
  const resolved: Array<{ url: string; name: string; resolution: FipsResolution }> = [];
  const unresolved: Array<{ url: string; name: string }> = [];
  const byState: Record<string, number> = {};

  // Process in batches for concurrency control
  for (let i = 0; i < layers.length; i += concurrency) {
    const batch = layers.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (layer) => {
        const resolution = await resolveFips(layer.url, layer.name, orgIdRegistry);
        return { layer, resolution };
      })
    );

    for (const { layer, resolution } of results) {
      if (resolution) {
        resolved.push({ url: layer.url, name: layer.name, resolution });
        byState[resolution.state] = (byState[resolution.state] || 0) + 1;
      } else {
        unresolved.push(layer);
      }
    }

    // Progress indicator
    if ((i + concurrency) % 50 === 0) {
      console.log(`  Processed ${Math.min(i + concurrency, layers.length)}/${layers.length}...`);
    }
  }

  return { resolved, unresolved, byState };
}

// =============================================================================
// CLI Entry Point
// =============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  import('node:fs').then(async (fs) => {
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    const resultsPath = path.join(__dirname, '../agents/data/edge-case-analysis-results.json');
    const results = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));

    console.log('='.repeat(80));
    console.log('FIPS RESOLVER - Multi-Strategy Attribution');
    console.log('='.repeat(80));

    // Process ALL layers needing review

    // Output path
    const outputPath = path.join(__dirname, '../agents/data/attributed-council-districts.json');

    // Load existing results to support resume
    let existingResolved: FipsResolutionResult[] = [];
    let existingUnresolved: UnresolvedLayer[] = [];

    if (fs.existsSync(outputPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
        existingResolved = data.resolved || [];
        existingUnresolved = data.unresolved || [];
        console.log(`Loaded existing results: ${existingResolved.length} resolved, ${existingUnresolved.length} unresolved.`);
      } catch (e) {
        console.warn('Could not parse existing results, starting fresh.');
      }
    }

    // Filter out already processed layers
    const processedUrls = new Set([
      ...existingResolved.map(r => r.url),
      ...existingUnresolved.map(r => r.url)
    ]);

    const remainingToProcess = results.needsReview.filter((l: any) => !processedUrls.has(l.url));
    console.log(`\nProcessing ${remainingToProcess.length} remaining layers (of ${results.needsReview.length} total)...`);

    if (remainingToProcess.length === 0) {
      console.log('All layers already processed.');
    } else {
      // Process in chunks to save incrementally
      const CHUNK_SIZE = 100; // Save every 100 items
      let processedCount = 0;

      for (let i = 0; i < remainingToProcess.length; i += CHUNK_SIZE) {
        const chunk = remainingToProcess.slice(i, i + CHUNK_SIZE);
        const { resolved: chunkResolved, unresolved: chunkUnresolved, byState } = await batchResolveFips(chunk, undefined, 50);

        existingResolved.push(...chunkResolved);
        existingUnresolved.push(...chunkUnresolved);
        processedCount += chunk.length;

        // Save incremental progress
        fs.writeFileSync(outputPath, JSON.stringify({
          metadata: {
            totalProcessed: processedUrls.size + processedCount,
            resolvedCount: existingResolved.length,
            unresolvedCount: existingUnresolved.length,
            generatedAt: new Date().toISOString(),
          },
          resolved: existingResolved,
          unresolved: existingUnresolved
        }, null, 2));

        console.log(`  Saved progress: ${processedCount}/${remainingToProcess.length} (Total Resolved: ${existingResolved.length})`);
      }
    }

    console.log('\n' + '-'.repeat(80));
    console.log('FINAL RESULTS');
    console.log('-'.repeat(80));
    console.log(`  Resolved: ${existingResolved.length} (${((existingResolved.length / results.needsReview.length) * 100).toFixed(1)}%)`);
    console.log(`  Unresolved: ${existingUnresolved.length}`);

    console.log(`\nResults saved to: ${outputPath}`);

    console.log(`\nResults saved to: ${outputPath}`);
  });
}
