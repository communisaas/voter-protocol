#!/usr/bin/env npx tsx
/**
 * Top Cities Council District Discovery
 *
 * Systematically discovers council district boundaries for top US cities.
 * Phase 1: Top 100 cities by population
 *
 * Usage:
 *   npx tsx src/scripts/discover-top-cities.ts --limit 100
 *   npx tsx src/scripts/discover-top-cities.ts --state CA --limit 50
 *   npx tsx src/scripts/discover-top-cities.ts --tier 1  # >500K population
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// =============================================================================
// Types
// =============================================================================

interface CityRecord {
  readonly rank: number;
  readonly name: string;
  readonly state: string;
  readonly population: number;
  readonly fips?: string;
  readonly status?: 'pending' | 'found' | 'not_found' | 'at_large' | 'error';
  readonly districtCount?: number | null;
  readonly portalUrl?: string | null;
  readonly confidence?: number;
  readonly discoveredAt?: string;
  readonly notes?: string;
}

interface DiscoveryState {
  readonly lastRun: string;
  readonly totalCities: number;
  readonly discovered: number;
  readonly notFound: number;
  readonly atLarge: number;
  readonly pending: number;
  readonly cities: CityRecord[];
}

// =============================================================================
// Top 100 US Cities by Population (2020 Census)
// =============================================================================

const TOP_100_CITIES: CityRecord[] = [
  { rank: 1, name: 'New York', state: 'NY', population: 8336817, fips: '3651000' },
  { rank: 2, name: 'Los Angeles', state: 'CA', population: 3979576, fips: '0644000' },
  { rank: 3, name: 'Chicago', state: 'IL', population: 2693976, fips: '1714000' },
  { rank: 4, name: 'Houston', state: 'TX', population: 2304580, fips: '4835000' },
  { rank: 5, name: 'Phoenix', state: 'AZ', population: 1608139, fips: '0455000' },
  { rank: 6, name: 'Philadelphia', state: 'PA', population: 1584064, fips: '4260000' },
  { rank: 7, name: 'San Antonio', state: 'TX', population: 1547253, fips: '4865000' },
  { rank: 8, name: 'San Diego', state: 'CA', population: 1423851, fips: '0666000' },
  { rank: 9, name: 'Dallas', state: 'TX', population: 1304379, fips: '4819000' },
  { rank: 10, name: 'San Jose', state: 'CA', population: 1013240, fips: '0668000' },
  { rank: 11, name: 'Austin', state: 'TX', population: 978908, fips: '4805000' },
  { rank: 12, name: 'Jacksonville', state: 'FL', population: 954614, fips: '1235000' },
  { rank: 13, name: 'Fort Worth', state: 'TX', population: 918915, fips: '4827000' },
  { rank: 14, name: 'Columbus', state: 'OH', population: 905748, fips: '3918000' },
  { rank: 15, name: 'San Francisco', state: 'CA', population: 873965, fips: '0667000' },
  { rank: 16, name: 'Charlotte', state: 'NC', population: 874579, fips: '3712000' },
  { rank: 17, name: 'Indianapolis', state: 'IN', population: 887642, fips: '1836003' },
  { rank: 18, name: 'Seattle', state: 'WA', population: 737015, fips: '5363000' },
  { rank: 19, name: 'Denver', state: 'CO', population: 715522, fips: '0820000' },
  { rank: 20, name: 'Washington', state: 'DC', population: 689545, fips: '1150000' },
  { rank: 21, name: 'Boston', state: 'MA', population: 675647, fips: '2507000' },
  { rank: 22, name: 'El Paso', state: 'TX', population: 678815, fips: '4824000' },
  { rank: 23, name: 'Nashville', state: 'TN', population: 689447, fips: '4752006' },
  { rank: 24, name: 'Detroit', state: 'MI', population: 639111, fips: '2622000' },
  { rank: 25, name: 'Oklahoma City', state: 'OK', population: 681054, fips: '4055000' },
  { rank: 26, name: 'Portland', state: 'OR', population: 652503, fips: '4159000' },
  { rank: 27, name: 'Las Vegas', state: 'NV', population: 641903, fips: '3240000' },
  { rank: 28, name: 'Memphis', state: 'TN', population: 633104, fips: '4748000' },
  { rank: 29, name: 'Louisville', state: 'KY', population: 633045, fips: '2148006' },
  { rank: 30, name: 'Baltimore', state: 'MD', population: 585708, fips: '2404000' },
  { rank: 31, name: 'Milwaukee', state: 'WI', population: 577222, fips: '5553000' },
  { rank: 32, name: 'Albuquerque', state: 'NM', population: 564559, fips: '3502000' },
  { rank: 33, name: 'Tucson', state: 'AZ', population: 542629, fips: '0477000' },
  { rank: 34, name: 'Fresno', state: 'CA', population: 542107, fips: '0627000' },
  { rank: 35, name: 'Sacramento', state: 'CA', population: 524943, fips: '0664000' },
  { rank: 36, name: 'Mesa', state: 'AZ', population: 504258, fips: '0446000' },
  { rank: 37, name: 'Kansas City', state: 'MO', population: 508090, fips: '2938000' },
  { rank: 38, name: 'Atlanta', state: 'GA', population: 498715, fips: '1304000' },
  { rank: 39, name: 'Long Beach', state: 'CA', population: 466742, fips: '0643000' },
  { rank: 40, name: 'Colorado Springs', state: 'CO', population: 478961, fips: '0816000' },
  { rank: 41, name: 'Raleigh', state: 'NC', population: 467665, fips: '3755000' },
  { rank: 42, name: 'Omaha', state: 'NE', population: 486051, fips: '3137000' },
  { rank: 43, name: 'Virginia Beach', state: 'VA', population: 459470, fips: '5182000' },
  { rank: 44, name: 'Oakland', state: 'CA', population: 433031, fips: '0653000' },
  { rank: 45, name: 'Minneapolis', state: 'MN', population: 429954, fips: '2743000' },
  { rank: 46, name: 'Tulsa', state: 'OK', population: 413066, fips: '4075000' },
  { rank: 47, name: 'Arlington', state: 'TX', population: 394266, fips: '4804000' },
  { rank: 48, name: 'Tampa', state: 'FL', population: 384959, fips: '1271000' },
  { rank: 49, name: 'New Orleans', state: 'LA', population: 383997, fips: '2255000' },
  { rank: 50, name: 'Wichita', state: 'KS', population: 397532, fips: '2079000' },
  // Cities 51-100
  { rank: 51, name: 'Cleveland', state: 'OH', population: 372624, fips: '3916000' },
  { rank: 52, name: 'Bakersfield', state: 'CA', population: 403455, fips: '0603526' },
  { rank: 53, name: 'Aurora', state: 'CO', population: 386261, fips: '0804000' },
  { rank: 54, name: 'Anaheim', state: 'CA', population: 350365, fips: '0602000' },
  { rank: 55, name: 'Honolulu', state: 'HI', population: 350964, fips: '1517000' },
  { rank: 56, name: 'Santa Ana', state: 'CA', population: 310227, fips: '0669000' },
  { rank: 57, name: 'Riverside', state: 'CA', population: 314998, fips: '0662000' },
  { rank: 58, name: 'Corpus Christi', state: 'TX', population: 317863, fips: '4817000' },
  { rank: 59, name: 'Lexington', state: 'KY', population: 322570, fips: '2146027' },
  { rank: 60, name: 'Henderson', state: 'NV', population: 317610, fips: '3231900' },
  { rank: 61, name: 'Stockton', state: 'CA', population: 320804, fips: '0675000' },
  { rank: 62, name: 'Saint Paul', state: 'MN', population: 311527, fips: '2758000' },
  { rank: 63, name: 'Cincinnati', state: 'OH', population: 309317, fips: '3915000' },
  { rank: 64, name: 'St. Louis', state: 'MO', population: 301578, fips: '2965000' },
  { rank: 65, name: 'Pittsburgh', state: 'PA', population: 302971, fips: '4261000' },
  { rank: 66, name: 'Greensboro', state: 'NC', population: 299035, fips: '3728000' },
  { rank: 67, name: 'Lincoln', state: 'NE', population: 291082, fips: '3128000' },
  { rank: 68, name: 'Anchorage', state: 'AK', population: 291247, fips: '0203000' },
  { rank: 69, name: 'Plano', state: 'TX', population: 285494, fips: '4858016' },
  { rank: 70, name: 'Orlando', state: 'FL', population: 307573, fips: '1253000' },
  { rank: 71, name: 'Irvine', state: 'CA', population: 307670, fips: '0636770' },
  { rank: 72, name: 'Newark', state: 'NJ', population: 311549, fips: '3451000' },
  { rank: 73, name: 'Durham', state: 'NC', population: 283506, fips: '3719000' },
  { rank: 74, name: 'Chula Vista', state: 'CA', population: 275487, fips: '0613392' },
  { rank: 75, name: 'Toledo', state: 'OH', population: 270871, fips: '3977000' },
  { rank: 76, name: 'Fort Wayne', state: 'IN', population: 263886, fips: '1825000' },
  { rank: 77, name: 'St. Petersburg', state: 'FL', population: 258308, fips: '1263000' },
  { rank: 78, name: 'Laredo', state: 'TX', population: 255205, fips: '4841464' },
  { rank: 79, name: 'Jersey City', state: 'NJ', population: 292449, fips: '3436000' },
  { rank: 80, name: 'Chandler', state: 'AZ', population: 275987, fips: '0412000' },
  { rank: 81, name: 'Madison', state: 'WI', population: 269840, fips: '5548000' },
  { rank: 82, name: 'Lubbock', state: 'TX', population: 263930, fips: '4845000' },
  { rank: 83, name: 'Scottsdale', state: 'AZ', population: 241361, fips: '0465000' },
  { rank: 84, name: 'Reno', state: 'NV', population: 264165, fips: '3260600' },
  { rank: 85, name: 'Buffalo', state: 'NY', population: 278349, fips: '3611000' },
  { rank: 86, name: 'Gilbert', state: 'AZ', population: 267918, fips: '0427400' },
  { rank: 87, name: 'Glendale', state: 'AZ', population: 248325, fips: '0427820' },
  { rank: 88, name: 'North Las Vegas', state: 'NV', population: 262527, fips: '3251800' },
  { rank: 89, name: 'Winston-Salem', state: 'NC', population: 249545, fips: '3775000' },
  { rank: 90, name: 'Norfolk', state: 'VA', population: 238005, fips: '5157000' },
  { rank: 91, name: 'Irving', state: 'TX', population: 256684, fips: '4837000' },
  { rank: 92, name: 'Chesapeake', state: 'VA', population: 249422, fips: '5116000' },
  { rank: 93, name: 'Fremont', state: 'CA', population: 230504, fips: '0626000' },
  { rank: 94, name: 'Garland', state: 'TX', population: 246018, fips: '4829000' },
  { rank: 95, name: 'Richmond', state: 'VA', population: 226610, fips: '5167000' },
  { rank: 96, name: 'Boise', state: 'ID', population: 235684, fips: '1608830' },
  { rank: 97, name: 'San Bernardino', state: 'CA', population: 222101, fips: '0665000' },
  { rank: 98, name: 'Spokane', state: 'WA', population: 228989, fips: '5367000' },
  { rank: 99, name: 'Des Moines', state: 'IA', population: 214237, fips: '1921000' },
  { rank: 100, name: 'Modesto', state: 'CA', population: 218464, fips: '0648354' },
];

// =============================================================================
// ArcGIS Hub Discovery
// =============================================================================

const HUB_API_URL = 'https://hub.arcgis.com/api/v3/search';

interface HubSearchResult {
  id: string;
  title: string;
  url: string;
  owner: string;
  type: string;
  extent?: { coordinates: number[][] };
}

interface HubResponse {
  data: HubSearchResult[];
  meta: { total: number };
}

async function searchArcGISHub(city: CityRecord): Promise<{
  found: boolean;
  url: string | null;
  confidence: number;
  districtCount: number | null;
}> {
  const queries = [
    `"${city.name}" council district`,
    `"${city.name}" city council`,
    `"${city.name}" ward`,
    `"${city.name}" ${city.state} council`,
  ];

  for (const query of queries) {
    try {
      const params = new URLSearchParams({
        q: query,
        filter: 'type:"Feature Service" OR type:"Feature Layer"',
        num: '10',
      });

      const response = await fetch(`${HUB_API_URL}?${params}`);
      if (!response.ok) continue;

      const data: HubResponse = await response.json();

      for (const result of data.data) {
        const titleLower = result.title.toLowerCase();
        const cityLower = city.name.toLowerCase();

        // Check if this looks like council districts
        const hasCouncil = titleLower.includes('council');
        const hasDistrict = titleLower.includes('district') || titleLower.includes('ward');
        const hasCity = titleLower.includes(cityLower);

        if (hasCouncil && hasDistrict && hasCity) {
          // Try to get feature count
          const featureCount = await getFeatureCount(result.url);

          return {
            found: true,
            url: result.url,
            confidence: hasCity ? 0.9 : 0.7,
            districtCount: featureCount,
          };
        }
      }
    } catch (error) {
      // Continue to next query
    }
  }

  return { found: false, url: null, confidence: 0, districtCount: null };
}

async function getFeatureCount(serviceUrl: string): Promise<number | null> {
  try {
    // Add query to get count
    const countUrl = `${serviceUrl}/query?where=1=1&returnCountOnly=true&f=json`;
    const response = await fetch(countUrl);
    if (!response.ok) return null;

    const data = await response.json();
    return data.count ?? null;
  } catch {
    return null;
  }
}

// =============================================================================
// Main Discovery Loop
// =============================================================================

async function discoverCities(options: {
  limit?: number;
  state?: string;
  tier?: number;
  resume?: boolean;
}): Promise<void> {
  const stateFile = join(process.cwd(), 'data', 'discovery-state.json');

  // Load or initialize state
  let state: DiscoveryState;
  if (options.resume && existsSync(stateFile)) {
    state = JSON.parse(readFileSync(stateFile, 'utf-8'));
    console.log(`\n📂 Resuming from previous run (${state.discovered} discovered)\n`);
  } else {
    state = {
      lastRun: new Date().toISOString(),
      totalCities: 0,
      discovered: 0,
      notFound: 0,
      atLarge: 0,
      pending: 0,
      cities: [],
    };
  }

  // Filter cities
  let cities = [...TOP_100_CITIES];

  if (options.state) {
    cities = cities.filter(c => c.state === options.state);
  }

  if (options.tier) {
    const tierFilters: Record<number, (c: CityRecord) => boolean> = {
      1: c => c.population >= 500000,
      2: c => c.population >= 250000 && c.population < 500000,
      3: c => c.population >= 100000 && c.population < 250000,
      4: c => c.population < 100000,
    };
    cities = cities.filter(tierFilters[options.tier] || (() => true));
  }

  if (options.limit) {
    cities = cities.slice(0, options.limit);
  }

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         COUNCIL DISTRICT DISCOVERY - TOP US CITIES          ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Cities to process: ${cities.length.toString().padEnd(40)}║`);
  console.log(`║  State filter: ${(options.state || 'ALL').padEnd(44)}║`);
  console.log(`║  Tier filter: ${(options.tier?.toString() || 'ALL').padEnd(45)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  let found = 0;
  let notFound = 0;

  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];

    // Skip if already processed
    const existing = state.cities.find(c => c.fips === city.fips);
    if (existing && existing.status !== 'pending') {
      console.log(`⏭️  ${city.name}, ${city.state} - already processed (${existing.status})`);
      continue;
    }

    console.log(`\n[${i + 1}/${cities.length}] 🔍 ${city.name}, ${city.state} (pop: ${city.population.toLocaleString()})`);

    // Search ArcGIS Hub
    const result = await searchArcGISHub(city);

    // Update city record
    const updatedCity: CityRecord = {
      ...city,
      status: result.found ? 'found' : 'not_found',
      districtCount: result.districtCount,
      portalUrl: result.url,
      confidence: result.confidence,
      discoveredAt: new Date().toISOString(),
    };

    // Update state
    const existingIndex = state.cities.findIndex(c => c.fips === city.fips);
    if (existingIndex >= 0) {
      state.cities[existingIndex] = updatedCity;
    } else {
      state.cities.push(updatedCity);
    }

    if (result.found) {
      found++;
      console.log(`   ✅ FOUND: ${result.districtCount || '?'} districts`);
      console.log(`   📍 ${result.url}`);
    } else {
      notFound++;
      console.log(`   ❌ NOT FOUND in ArcGIS Hub`);
    }

    // Save progress after each city
    state = {
      ...state,
      lastRun: new Date().toISOString(),
      totalCities: cities.length,
      discovered: state.cities.filter(c => c.status === 'found').length,
      notFound: state.cities.filter(c => c.status === 'not_found').length,
      atLarge: state.cities.filter(c => c.status === 'at_large').length,
      pending: state.cities.filter(c => c.status === 'pending').length,
    };

    writeFileSync(stateFile, JSON.stringify(state, null, 2));

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Final summary
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    DISCOVERY COMPLETE                        ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Found: ${found.toString().padEnd(51)}║`);
  console.log(`║  Not Found: ${notFound.toString().padEnd(47)}║`);
  console.log(`║  Coverage: ${((found / cities.length) * 100).toFixed(1)}%${' '.repeat(46)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n📁 State saved to: ${stateFile}\n`);
}

// =============================================================================
// CLI
// =============================================================================

const args = process.argv.slice(2);
const options: {
  limit?: number;
  state?: string;
  tier?: number;
  resume?: boolean;
} = {};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) {
    options.limit = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--state' && args[i + 1]) {
    options.state = args[i + 1].toUpperCase();
    i++;
  } else if (args[i] === '--tier' && args[i + 1]) {
    options.tier = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--resume') {
    options.resume = true;
  } else if (args[i] === '--help') {
    console.log(`
Usage: npx tsx src/scripts/discover-top-cities.ts [options]

Options:
  --limit <n>    Process only first n cities
  --state <XX>   Filter by state (e.g., --state CA)
  --tier <1-4>   Filter by population tier:
                   1: >500K
                   2: 250K-500K
                   3: 100K-250K
                   4: <100K
  --resume       Resume from previous run
  --help         Show this help

Examples:
  npx tsx src/scripts/discover-top-cities.ts --limit 10
  npx tsx src/scripts/discover-top-cities.ts --state TX
  npx tsx src/scripts/discover-top-cities.ts --tier 1
  npx tsx src/scripts/discover-top-cities.ts --resume
`);
    process.exit(0);
  }
}

discoverCities(options).catch(console.error);
