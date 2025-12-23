/**
 * Census TIGER/Line Places Parser
 *
 * Purpose: Bootstrap municipalities table with 19,616 U.S. incorporated places
 * Source: Census Bureau TIGER/Line 2025 - Places (Incorporated Cities/Towns)
 *
 * Data Source:
 * - URL: https://www2.census.gov/geo/tiger/TIGER2025/PLACE/tl_2025_us_place.zip
 * - Format: Shapefile (.shp + .dbf + .shx + .prj)
 * - Size: ~50MB compressed, ~200MB uncompressed
 * - Fields: GEOID, NAME, STATEFP, PLACEFP, LSAD, ALAND, AWATER
 *
 * Output: SQL INSERT statements for D1 database
 */

import { open as parseShapefile } from 'shapefile';
import * as turf from '@turf/turf';

// TypeScript interfaces for type safety

interface CensusTIGERPlace {
  GEOID: string;          // Census GEOID (7 digits: 2-digit state + 5-digit place)
  NAME: string;           // Official place name
  STATEFP: string;        // State FIPS code (2 digits)
  PLACEFP: string;        // Place FIPS code (5 digits)
  LSAD: string;           // Legal/Statistical Area Description (city, town, village, etc.)
  ALAND: number;          // Land area (sq meters)
  AWATER: number;         // Water area (sq meters)
}

interface Municipality {
  id: string;             // Normalized ID: "ca-san-francisco"
  name: string;           // Official name: "San Francisco"
  state: string;          // Two-letter state code: "CA"
  geoid: string;          // Census GEOID: "0667000"
  population: number;     // 2020 Census population (from separate lookup)
  bbox_min_lng: number;   // Bounding box (WGS84)
  bbox_min_lat: number;
  bbox_max_lng: number;
  bbox_max_lat: number;
}

// State FIPS to abbreviation mapping (for ID normalization)
const STATE_FIPS_TO_ABBR: Record<string, string> = {
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
  '56': 'WY', '72': 'PR', '78': 'VI' // Include PR and VI territories
};

/**
 * Normalize place name to URL-safe ID
 *
 * Examples:
 * - "San Francisco" → "san-francisco"
 * - "Winston-Salem" → "winston-salem"
 * - "St. Louis" → "st-louis"
 *
 * @param name - Official place name
 * @returns Normalized ID slug
 */
function normalizePlaceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-\s]/g, '') // Remove special chars except hyphens
    .replace(/\s+/g, '-')         // Spaces to hyphens
    .replace(/-+/g, '-')          // Collapse multiple hyphens
    .replace(/^-|-$/g, '');       // Trim leading/trailing hyphens
}

/**
 * Parse Census TIGER/Line shapefile and extract municipalities
 *
 * @param shapefilePath - Path to .shp file (local or URL)
 * @returns Array of municipalities with geometry bounding boxes
 */
export async function parseCensusTIGERPlaces(
  shapefilePath: string
): Promise<Municipality[]> {
  const municipalities: Municipality[] = [];

  // Open shapefile (supports both local files and URLs)
  const source = await parseShapefile(shapefilePath);

  let result = await source.read();
  while (!result.done) {
    const feature = result.value;

    if (!feature || !feature.properties || !feature.geometry) {
      result = await source.read();
      continue;
    }

    const props = feature.properties as CensusTIGERPlace;

    // Skip if missing required fields
    if (!props.GEOID || !props.NAME || !props.STATEFP) {
      result = await source.read();
      continue;
    }

    // Get state abbreviation
    const stateAbbr = STATE_FIPS_TO_ABBR[props.STATEFP];
    if (!stateAbbr) {
      console.warn(`Unknown state FIPS: ${props.STATEFP} for ${props.NAME}`);
      result = await source.read();
      continue;
    }

    // Normalize place name to ID
    const normalizedName = normalizePlaceName(props.NAME);
    const id = `${stateAbbr.toLowerCase()}-${normalizedName}`;

    // Calculate bounding box from geometry
    const bbox = turf.bbox(feature.geometry);
    const [minLng, minLat, maxLng, maxLat] = bbox;

    // Create municipality record
    municipalities.push({
      id,
      name: props.NAME,
      state: stateAbbr,
      geoid: props.GEOID,
      population: 0, // Will be populated from separate Census API call
      bbox_min_lng: minLng,
      bbox_min_lat: minLat,
      bbox_max_lng: maxLng,
      bbox_max_lat: maxLat
    });

    result = await source.read();
  }

  return municipalities;
}

/**
 * Fetch population data from Census API (2020 decennial census)
 *
 * Census API endpoint:
 * https://api.census.gov/data/2020/dec/pl?get=NAME,P1_001N&for=place:*&in=state:*
 *
 * Response fields:
 * - NAME: Place name + state
 * - P1_001N: Total population (2020 Census)
 * - state: State FIPS code
 * - place: Place FIPS code
 *
 * @returns Map of GEOID → population
 */
export async function fetchPopulationData(): Promise<Map<string, number>> {
  const populationMap = new Map<string, number>();

  // Census API - 2020 Decennial Census (Population counts)
  const apiUrl = 'https://api.census.gov/data/2020/dec/pl?get=NAME,P1_001N&for=place:*&in=state:*';

  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Census API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as string[][];

  // First row is headers: ["NAME", "P1_001N", "state", "place"]
  const headers = data[0];
  const nameIndex = headers.indexOf('NAME');
  const populationIndex = headers.indexOf('P1_001N');
  const stateIndex = headers.indexOf('state');
  const placeIndex = headers.indexOf('place');

  // Parse data rows
  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    const stateFips = row[stateIndex];
    const placeFips = row[placeIndex];
    const geoid = `${stateFips}${placeFips}`;

    const populationStr = row[populationIndex];
    const population = parseInt(populationStr, 10);

    if (!isNaN(population)) {
      populationMap.set(geoid, population);
    }
  }

  return populationMap;
}

/**
 * Generate SQL INSERT statements for D1 database
 *
 * @param municipalities - Array of municipalities with population data
 * @returns SQL string for batch insert
 */
export function generateInsertSQL(municipalities: Municipality[]): string {
  const values = municipalities.map(m => {
    const id = m.id.replace(/'/g, "''");           // Escape single quotes
    const name = m.name.replace(/'/g, "''");
    const geoid = m.geoid.replace(/'/g, "''");

    return `('${id}', '${name}', '${m.state}', '${geoid}', ${m.population}, ${m.bbox_min_lng}, ${m.bbox_min_lat}, ${m.bbox_max_lng}, ${m.bbox_max_lat})`;
  });

  const sql = `
-- Generated from Census TIGER/Line 2025 - Places
-- Total municipalities: ${municipalities.length}
-- Generated: ${new Date().toISOString()}

INSERT INTO municipalities (id, name, state, geoid, population, bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat)
VALUES
${values.join(',\n')}
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name,
  geoid = excluded.geoid,
  population = excluded.population,
  bbox_min_lng = excluded.bbox_min_lng,
  bbox_min_lat = excluded.bbox_min_lat,
  bbox_max_lng = excluded.bbox_max_lng,
  bbox_max_lat = excluded.bbox_max_lat,
  updated_at = datetime('now');

-- Initialize state table for new municipalities
INSERT INTO municipality_state (muni_id)
SELECT id FROM municipalities
WHERE id NOT IN (SELECT muni_id FROM municipality_state);
`;

  return sql;
}

/**
 * Main bootstrap function: Download TIGER/Line, parse, fetch population, generate SQL
 *
 * Usage:
 * ```typescript
 * const municipalities = await bootstrapMunicipalitiesFromCensus();
 * console.log(`Loaded ${municipalities.length} municipalities`);
 * ```
 *
 * @returns Array of municipalities ready for D1 insert
 */
export async function bootstrapMunicipalitiesFromCensus(): Promise<Municipality[]> {
  console.log('📥 Downloading Census TIGER/Line 2025 - Places...');

  // Direct URL to Census FTP (always latest)
  const tigerUrl = 'https://www2.census.gov/geo/tiger/TIGER2025/PLACE/tl_2025_us_place.zip';

  // Parse shapefile
  console.log('📊 Parsing shapefile...');
  const municipalities = await parseCensusTIGERPlaces(tigerUrl);
  console.log(`✅ Parsed ${municipalities.length} municipalities`);

  // Fetch population data from Census API
  console.log('👥 Fetching population data from Census API...');
  const populationMap = await fetchPopulationData();
  console.log(`✅ Loaded population for ${populationMap.size} places`);

  // Merge population data
  for (const muni of municipalities) {
    const population = populationMap.get(muni.geoid);
    if (population !== undefined) {
      muni.population = population;
    }
  }

  // Sort by population descending (prioritize large cities)
  municipalities.sort((a, b) => b.population - a.population);

  console.log(`🏙️  Top 10 municipalities by population:`);
  municipalities.slice(0, 10).forEach((m, i) => {
    console.log(`  ${i + 1}. ${m.name}, ${m.state} - ${m.population.toLocaleString()}`);
  });

  return municipalities;
}

/**
 * CLI entry point for standalone execution
 *
 * Usage:
 * ```bash
 * npx tsx src/bootstrap/census-tiger-parser.ts > bootstrap.sql
 * ```
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrapMunicipalitiesFromCensus()
    .then(municipalities => {
      // Generate SQL
      const sql = generateInsertSQL(municipalities);
      console.log(sql);
    })
    .catch(error => {
      console.error('❌ Bootstrap failed:', error);
      process.exit(1);
    });
}
