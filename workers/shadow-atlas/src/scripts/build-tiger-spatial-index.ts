/**
 * Build Census TIGER/Line Spatial Index
 *
 * Purpose: Download Census TIGER/Line 2025 place boundaries, filter by CLASSFP
 * (incorporated cities only), and build R-tree spatial index for fast lookups.
 *
 * Data Source:
 * - URL: https://www2.census.gov/geo/tiger/TIGER2025/PLACE/tl_2025_us_place.zip
 * - Size: ~50MB compressed
 * - Coverage: All US incorporated places (~19,500)
 * - Fields: GEOID, NAME, STATEFP, CLASSFP, LSAD, geometry
 *
 * CLASSFP Filter Strategy:
 * - INCLUDE: C1-C8 (incorporated places with elected councils)
 * - EXCLUDE: C9 (incorporated but inactive government)
 * - EXCLUDE: U1, U2, U9 (Census Designated Places - statistical areas, no elected government)
 *
 * Outputs:
 * - census-tiger-2025-places.geojson (filtered incorporated places)
 * - census-tiger-2025-places-rtree.json (serialized R-tree spatial index)
 *
 * Performance:
 * - Download + parse: ~2-3 minutes
 * - R-tree bulk load: ~200ms for 19,500 items
 * - Total runtime: ~3 minutes
 *
 * Usage:
 * ```bash
 * npx tsx scripts/build-tiger-spatial-index.ts
 * ```
 */

import { open as openShapefile } from 'shapefile';
import * as turf from '@turf/turf';
import RBush from 'rbush';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Type Definitions
// ============================================================================

interface CensusTIGERPlace {
  GEOID: string;       // Census GEOID (7 digits: state + place FIPS)
  NAME: string;        // Official place name
  STATEFP: string;     // State FIPS code (2 digits)
  PLACEFP: string;     // Place FIPS code (5 digits)
  LSAD: string;        // Legal/Statistical Area Description
  CLASSFP: string;     // Classification code (C1-C9, U1-U9)
  ALAND?: number;      // Land area (sq meters)
  AWATER?: number;     // Water area (sq meters)
}

interface PlaceFeature {
  type: 'Feature';
  properties: CensusTIGERPlace;
  geometry: GeoJSON.Geometry;
  bbox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
}

interface SpatialIndexItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  geoid: string;
  name: string;
  state: string;
  classfp: string;
  population?: number;
}

// ============================================================================
// Configuration
// ============================================================================

const TIGER_URL = 'https://www2.census.gov/geo/tiger/TIGER2025/PLACE/tl_2025_us_place.zip';

// CLASSFP codes for incorporated places with elected governments
const GOVERNANCE_CLASSFP = new Set(['C1', 'C2', 'C3', 'C5', 'C6', 'C7', 'C8']);

// State FIPS to abbreviation mapping
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
  '56': 'WY', '72': 'PR', '78': 'VI'
};

// Output paths
const DATA_DIR = path.resolve(__dirname, '../data');
const GEOJSON_OUTPUT = path.join(DATA_DIR, 'census-tiger-2025-places.geojson');
const RTREE_OUTPUT = path.join(DATA_DIR, 'census-tiger-2025-places-rtree.json');

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Parse Census TIGER/Line shapefile and extract incorporated places
 *
 * Filtering logic:
 * - ONLY include CLASSFP C1-C8 (incorporated cities with elected councils)
 * - EXCLUDE C9 (incorporated but operationally inactive)
 * - EXCLUDE U1, U2, U9 (Census Designated Places - statistical areas)
 *
 * @param shapefileUrl - URL to TIGER/Line shapefile (ZIP archive)
 * @returns Array of GeoJSON features for incorporated places
 */
async function parseTIGERPlaces(shapefileUrl: string): Promise<PlaceFeature[]> {
  console.log(`📥 Downloading TIGER/Line shapefile from ${shapefileUrl}...`);
  console.log('   (This may take 2-3 minutes for ~50MB download)\n');

  const places: PlaceFeature[] = [];
  const classfpCounts: Record<string, number> = {};
  const stateCounts: Record<string, number> = {};

  try {
    // Open shapefile (library handles ZIP download automatically)
    const source = await openShapefile(shapefileUrl);

    console.log('✅ Download complete, parsing features...\n');

    let result = await source.read();
    let totalFeatures = 0;
    let filteredFeatures = 0;

    while (!result.done) {
      totalFeatures++;

      const feature = result.value;
      if (!feature || !feature.properties || !feature.geometry) {
        result = await source.read();
        continue;
      }

      const props = feature.properties as CensusTIGERPlace;

      // Track CLASSFP distribution for reporting
      classfpCounts[props.CLASSFP] = (classfpCounts[props.CLASSFP] || 0) + 1;

      // Filter: ONLY incorporated places with active governance (C1-C8)
      if (!GOVERNANCE_CLASSFP.has(props.CLASSFP)) {
        result = await source.read();
        continue;
      }

      filteredFeatures++;

      // Track state distribution
      const stateAbbr = STATE_FIPS_TO_ABBR[props.STATEFP] || props.STATEFP;
      stateCounts[stateAbbr] = (stateCounts[stateAbbr] || 0) + 1;

      // Calculate bounding box
      const bbox = turf.bbox(feature.geometry) as [number, number, number, number];

      places.push({
        type: 'Feature',
        properties: props,
        geometry: feature.geometry,
        bbox
      });

      // Progress indicator
      if (totalFeatures % 5000 === 0) {
        console.log(`  Processed ${totalFeatures.toLocaleString()} features (${filteredFeatures.toLocaleString()} incorporated places kept)...`);
      }

      result = await source.read();
    }

    console.log(`\n✅ Parsing complete!`);
    console.log(`   Total features: ${totalFeatures.toLocaleString()}`);
    console.log(`   Incorporated places (C1-C8): ${filteredFeatures.toLocaleString()}`);
    console.log(`   Filtered out (C9 + U-series): ${(totalFeatures - filteredFeatures).toLocaleString()}\n`);

    // Report CLASSFP distribution
    console.log('📊 CLASSFP Distribution:');
    const sortedClassfp = Object.entries(classfpCounts).sort((a, b) => b[1] - a[1]);
    for (const [classfp, count] of sortedClassfp) {
      const included = GOVERNANCE_CLASSFP.has(classfp) ? '✅' : '❌';
      console.log(`   ${included} ${classfp}: ${count.toLocaleString()}`);
    }

    console.log('\n📍 Top 10 States by Incorporated Places:');
    const sortedStates = Object.entries(stateCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [state, count] of sortedStates) {
      console.log(`   ${state}: ${count.toLocaleString()}`);
    }
    console.log();

  } catch (error) {
    console.error('❌ Error parsing TIGER/Line shapefile:', error);
    throw error;
  }

  return places;
}

/**
 * Build R-tree spatial index from place bounding boxes
 *
 * R-tree enables O(log n) spatial queries instead of O(n) linear scans.
 * For 31,316 layers × 19,500 places:
 * - Without R-tree: 610M comparisons (~hours)
 * - With R-tree: 31k × log(19k) ≈ 438k lookups (~minutes)
 *
 * @param places - Array of place features with bounding boxes
 * @returns R-tree spatial index + serializable items array
 */
function buildSpatialIndex(places: PlaceFeature[]): {
  tree: RBush<SpatialIndexItem>;
  items: SpatialIndexItem[];
} {
  console.log(`🌳 Building R-tree spatial index for ${places.length.toLocaleString()} places...`);

  const items: SpatialIndexItem[] = places.map(place => {
    const [minLng, minLat, maxLng, maxLat] = place.bbox;
    const stateAbbr = STATE_FIPS_TO_ABBR[place.properties.STATEFP] || place.properties.STATEFP;

    return {
      minX: minLng,
      minY: minLat,
      maxX: maxLng,
      maxY: maxLat,
      geoid: place.properties.GEOID,
      name: place.properties.NAME,
      state: stateAbbr,
      classfp: place.properties.CLASSFP,
      population: undefined // Will be enriched later from Census API
    };
  });

  // Bulk load R-tree (2-3x faster than incremental insertion)
  const startTime = Date.now();
  const tree = new RBush<SpatialIndexItem>();
  tree.load(items);
  const elapsed = Date.now() - startTime;

  console.log(`✅ R-tree index built in ${elapsed}ms`);
  console.log(`   Bulk load performance: ${(items.length / elapsed * 1000).toFixed(0)} items/sec\n`);

  return { tree, items };
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
async function fetchPopulationData(): Promise<Map<string, number>> {
  console.log('👥 Fetching population data from Census API...');
  console.log('   (2020 Decennial Census - P1_001N total population)\n');

  const populationMap = new Map<string, number>();

  try {
    // Census API - 2020 Decennial Census (Population counts)
    const apiUrl = 'https://api.census.gov/data/2020/dec/pl?get=NAME,P1_001N&for=place:*&in=state:*';

    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Census API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as string[][];

    // First row is headers: ["NAME", "P1_001N", "state", "place"]
    const headers = data[0];
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

    console.log(`✅ Loaded population for ${populationMap.size.toLocaleString()} places\n`);

  } catch (error) {
    console.error('⚠️  Warning: Failed to fetch population data from Census API');
    console.error('   Population fields will be undefined in output');
    console.error(`   Error: ${error}\n`);
  }

  return populationMap;
}

/**
 * Enrich spatial index items with population data
 *
 * @param items - Spatial index items (by reference, mutated)
 * @param populationMap - Map of GEOID → population
 */
function enrichWithPopulation(
  items: SpatialIndexItem[],
  populationMap: Map<string, number>
): void {
  let enrichedCount = 0;

  for (const item of items) {
    const population = populationMap.get(item.geoid);
    if (population !== undefined) {
      item.population = population;
      enrichedCount++;
    }
  }

  console.log(`📈 Population enrichment:`);
  console.log(`   Enriched: ${enrichedCount.toLocaleString()} places`);
  console.log(`   Missing: ${(items.length - enrichedCount).toLocaleString()} places\n`);
}

/**
 * Write outputs to disk
 *
 * Outputs:
 * 1. GeoJSON file (complete place geometries for visualization)
 * 2. R-tree JSON file (bounding boxes + metadata for spatial queries)
 *
 * @param places - Array of place features
 * @param items - Spatial index items (enriched with population)
 */
async function writeOutputs(
  places: PlaceFeature[],
  items: SpatialIndexItem[]
): Promise<void> {
  console.log('💾 Writing output files...\n');

  // Ensure data directory exists
  await fs.mkdir(DATA_DIR, { recursive: true });

  // Write GeoJSON (complete place boundaries)
  const geojson = {
    type: 'FeatureCollection' as const,
    features: places
  };

  await fs.writeFile(
    GEOJSON_OUTPUT,
    JSON.stringify(geojson, null, 2),
    'utf-8'
  );

  const geojsonSize = (await fs.stat(GEOJSON_OUTPUT)).size;
  console.log(`✅ GeoJSON written: ${GEOJSON_OUTPUT}`);
  console.log(`   Size: ${(geojsonSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   Features: ${places.length.toLocaleString()}\n`);

  // Write R-tree index (bounding boxes + metadata)
  const rtreeData = {
    type: 'RTreeIndex' as const,
    generated: new Date().toISOString(),
    source: TIGER_URL,
    count: items.length,
    classfp_filter: Array.from(GOVERNANCE_CLASSFP),
    items: items
  };

  await fs.writeFile(
    RTREE_OUTPUT,
    JSON.stringify(rtreeData, null, 2),
    'utf-8'
  );

  const rtreeSize = (await fs.stat(RTREE_OUTPUT)).size;
  console.log(`✅ R-tree index written: ${RTREE_OUTPUT}`);
  console.log(`   Size: ${(rtreeSize / 1024).toFixed(2)} KB`);
  console.log(`   Items: ${items.length.toLocaleString()}\n`);
}

/**
 * Generate summary statistics
 *
 * @param items - Spatial index items
 */
function printSummary(items: SpatialIndexItem[]): void {
  console.log('📊 Summary Statistics:\n');

  // Top 10 places by population
  const sortedByPop = items
    .filter(item => item.population !== undefined)
    .sort((a, b) => (b.population || 0) - (a.population || 0))
    .slice(0, 10);

  console.log('🏙️  Top 10 Places by Population:');
  for (let i = 0; i < sortedByPop.length; i++) {
    const place = sortedByPop[i];
    console.log(`   ${i + 1}. ${place.name}, ${place.state} - ${place.population?.toLocaleString()}`);
  }
  console.log();

  // CLASSFP distribution
  const classfpCounts: Record<string, number> = {};
  for (const item of items) {
    classfpCounts[item.classfp] = (classfpCounts[item.classfp] || 0) + 1;
  }

  console.log('📋 CLASSFP Distribution:');
  const sortedClassfp = Object.entries(classfpCounts).sort((a, b) => b[1] - a[1]);
  for (const [classfp, count] of sortedClassfp) {
    console.log(`   ${classfp}: ${count.toLocaleString()}`);
  }
  console.log();

  // State distribution
  const stateCounts: Record<string, number> = {};
  for (const item of items) {
    stateCounts[item.state] = (stateCounts[item.state] || 0) + 1;
  }

  console.log('📍 Top 15 States by Place Count:');
  const sortedStates = Object.entries(stateCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);
  for (const [state, count] of sortedStates) {
    console.log(`   ${state}: ${count.toLocaleString()}`);
  }
  console.log();
}

// ============================================================================
// Main Execution
// ============================================================================

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Census TIGER/Line Spatial Index Builder                    ║');
  console.log('║  Phase 1: Download, Parse, Filter, Build R-tree             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const startTime = Date.now();

  try {
    // Step 1: Parse TIGER/Line shapefile
    const places = await parseTIGERPlaces(TIGER_URL);

    if (places.length === 0) {
      throw new Error('No places parsed from TIGER/Line shapefile');
    }

    // Step 2: Build R-tree spatial index
    const { items } = buildSpatialIndex(places);

    // Step 3: Fetch population data from Census API
    const populationMap = await fetchPopulationData();

    // Step 4: Enrich with population data
    enrichWithPopulation(items, populationMap);

    // Step 5: Write outputs
    await writeOutputs(places, items);

    // Step 6: Summary statistics
    printSummary(items);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ SUCCESS! Total runtime: ${elapsed}s\n`);

    console.log('📦 Output Files:');
    console.log(`   1. ${GEOJSON_OUTPUT}`);
    console.log(`   2. ${RTREE_OUTPUT}\n`);

    console.log('🚀 Next Steps:');
    console.log('   1. Run spatial-join-layers-places.ts to enrich 31,316 layers');
    console.log('   2. Run analyze-place-coverage-gaps.ts to identify missing places\n');

  } catch (error) {
    console.error('\n❌ FAILED:', error);
    process.exit(1);
  }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

// Export for testing
export {
  parseTIGERPlaces,
  buildSpatialIndex,
  fetchPopulationData,
  enrichWithPopulation,
  writeOutputs,
  type PlaceFeature,
  type SpatialIndexItem
};
