#!/usr/bin/env npx tsx
/**
 * Phase 2 P1: Census Place Boundaries Integration
 *
 * Downloads and processes US Census TIGER/Line 2024 place boundaries (all 50 states + DC + PR).
 *
 * What this script does:
 * 1. Downloads TIGER/Line 2024 place shapefiles for all states
 * 2. Converts shapefiles to GeoJSON
 * 3. Extracts essential metadata (GEOID, NAME, CLASSFP, LSAD)
 * 4. Normalizes place types (incorporated vs CDP)
 * 5. Outputs consolidated GeoJSON file for spatial join
 *
 * Census TIGER/Line Place Codes:
 * - CLASSFP C1/C2/C5/C6/C7 = Incorporated place (city/town with municipal government)
 * - CLASSFP U1/U2 = Census Designated Place (unincorporated, county governs)
 * - LSAD 25 = City
 * - LSAD 43 = Town
 * - LSAD 57 = CDP (Census Designated Place)
 *
 * Runtime: ~15-30 minutes (download 52 shapefiles, convert to GeoJSON)
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../core/utils/logger.js';

// US states and territories (FIPS codes)
const US_STATES = [
  { fips: '01', name: 'Alabama' },
  { fips: '02', name: 'Alaska' },
  { fips: '04', name: 'Arizona' },
  { fips: '05', name: 'Arkansas' },
  { fips: '06', name: 'California' },
  { fips: '08', name: 'Colorado' },
  { fips: '09', name: 'Connecticut' },
  { fips: '10', name: 'Delaware' },
  { fips: '11', name: 'District of Columbia' },
  { fips: '12', name: 'Florida' },
  { fips: '13', name: 'Georgia' },
  { fips: '15', name: 'Hawaii' },
  { fips: '16', name: 'Idaho' },
  { fips: '17', name: 'Illinois' },
  { fips: '18', name: 'Indiana' },
  { fips: '19', name: 'Iowa' },
  { fips: '20', name: 'Kansas' },
  { fips: '21', name: 'Kentucky' },
  { fips: '22', name: 'Louisiana' },
  { fips: '23', name: 'Maine' },
  { fips: '24', name: 'Maryland' },
  { fips: '25', name: 'Massachusetts' },
  { fips: '26', name: 'Michigan' },
  { fips: '27', name: 'Minnesota' },
  { fips: '28', name: 'Mississippi' },
  { fips: '29', name: 'Missouri' },
  { fips: '30', name: 'Montana' },
  { fips: '31', name: 'Nebraska' },
  { fips: '32', name: 'Nevada' },
  { fips: '33', name: 'New Hampshire' },
  { fips: '34', name: 'New Jersey' },
  { fips: '35', name: 'New Mexico' },
  { fips: '36', name: 'New York' },
  { fips: '37', name: 'North Carolina' },
  { fips: '38', name: 'North Dakota' },
  { fips: '39', name: 'Ohio' },
  { fips: '40', name: 'Oklahoma' },
  { fips: '41', name: 'Oregon' },
  { fips: '42', name: 'Pennsylvania' },
  { fips: '44', name: 'Rhode Island' },
  { fips: '45', name: 'South Carolina' },
  { fips: '46', name: 'South Dakota' },
  { fips: '47', name: 'Tennessee' },
  { fips: '48', name: 'Texas' },
  { fips: '49', name: 'Utah' },
  { fips: '50', name: 'Vermont' },
  { fips: '51', name: 'Virginia' },
  { fips: '53', name: 'Washington' },
  { fips: '54', name: 'West Virginia' },
  { fips: '55', name: 'Wisconsin' },
  { fips: '56', name: 'Wyoming' },
  { fips: '72', name: 'Puerto Rico' },
];

interface CensusPlace {
  type: 'Feature';
  properties: {
    place_fips: string;
    place_name: string;
    place_type: 'incorporated' | 'cdp';
    lsad: string;
    lsad_name: string;
    classfp: string;
    state_fips: string;
    state_name: string;
  };
  geometry: GeoJSON.Geometry;
}

interface CensusPlaceCollection {
  type: 'FeatureCollection';
  features: CensusPlace[];
}

function normalizePlaceType(classFP: string): 'incorporated' | 'cdp' {
  // Incorporated places (cities/towns with municipal governments)
  if (['C1', 'C2', 'C5', 'C6', 'C7'].includes(classFP)) {
    return 'incorporated';
  }
  // Census Designated Places (unincorporated, under county governance)
  if (['U1', 'U2'].includes(classFP)) {
    return 'cdp';
  }
  // Default to CDP for unknown codes
  return 'cdp';
}

function getLSADName(lsad: string): string {
  const lsadMap: Record<string, string> = {
    '25': 'city',
    '43': 'town',
    '57': 'CDP',
    '00': 'incorporated place',
    '06': 'consolidated city',
    '07': 'independent city',
    '47': 'village',
    '53': 'borough',
  };
  return lsadMap[lsad] || 'place';
}

async function downloadStateShapefile(stateFips: string, stateName: string): Promise<boolean> {
  const dataDir = join(__dirname, 'data', 'census-places');
  const zipFile = join(dataDir, `tl_2024_${stateFips}_place.zip`);
  const shpFile = join(dataDir, `tl_2024_${stateFips}_place.shp`);

  // Skip if shapefile already exists
  if (existsSync(shpFile)) {
    logger.info(`[${stateName}] Shapefile already exists, skipping download`);
    return true;
  }

  // Skip if zip already exists
  if (existsSync(zipFile)) {
    logger.info(`[${stateName}] Zip file exists, extracting...`);
    try {
      execSync(`unzip -q -o "${zipFile}" -d "${dataDir}"`, { stdio: 'ignore' });
      if (existsSync(shpFile)) {
        logger.info(`[${stateName}] Extracted shapefile`);
        return true;
      }
    } catch (error) {
      logger.error(`[${stateName}] Failed to extract: ${error}`);
      return false;
    }
  }

  // Download shapefile
  const url = `https://www2.census.gov/geo/tiger/TIGER2024/PLACE/tl_2024_${stateFips}_place.zip`;
  logger.info(`[${stateName}] Downloading from ${url}...`);

  try {
    execSync(`curl -o "${zipFile}" "${url}"`, { stdio: 'ignore' });

    if (!existsSync(zipFile)) {
      logger.error(`[${stateName}] Download failed (file not found)`);
      return false;
    }

    // Extract
    execSync(`unzip -q -o "${zipFile}" -d "${dataDir}"`, { stdio: 'ignore' });

    if (existsSync(shpFile)) {
      logger.info(`[${stateName}] Downloaded and extracted successfully`);
      return true;
    } else {
      logger.error(`[${stateName}] Extraction failed (shapefile not found)`);
      return false;
    }
  } catch (error) {
    logger.error(`[${stateName}] Failed: ${error}`);
    return false;
  }
}

async function convertShapefileToGeoJSON(stateFips: string, stateName: string): Promise<CensusPlace[]> {
  const dataDir = join(__dirname, 'data', 'census-places');
  const shpFile = join(dataDir, `tl_2024_${stateFips}_place.shp`);
  const geoJsonFile = join(dataDir, `tl_2024_${stateFips}_place.geojson`);

  if (!existsSync(shpFile)) {
    logger.error(`[${stateName}] Shapefile not found: ${shpFile}`);
    return [];
  }

  // Convert shapefile to GeoJSON using ogr2ogr
  try {
    logger.info(`[${stateName}] Converting shapefile to GeoJSON...`);
    execSync(
      `ogr2ogr -f GeoJSON "${geoJsonFile}" "${shpFile}" -t_srs EPSG:4326`,
      { stdio: 'ignore' }
    );

    if (!existsSync(geoJsonFile)) {
      logger.error(`[${stateName}] GeoJSON conversion failed`);
      return [];
    }

    // Read and parse GeoJSON
    const geoJsonData = readFileSync(geoJsonFile, 'utf-8');
    const geoJson = JSON.parse(geoJsonData);

    // Transform to our schema
    const places: CensusPlace[] = geoJson.features.map((feature: GeoJSON.Feature) => {
      const props = feature.properties as Record<string, unknown>;

      // Type guard helper for string properties
      const getString = (key: string): string => {
        const value = props[key];
        return typeof value === 'string' ? value : '';
      };

      return {
        type: 'Feature',
        properties: {
          place_fips: getString('GEOID'),
          place_name: getString('NAME'),
          place_type: normalizePlaceType(getString('CLASSFP')),
          lsad: getString('LSAD'),
          lsad_name: getLSADName(getString('LSAD')),
          classfp: getString('CLASSFP'),
          state_fips: getString('STATEFP'),
          state_name: stateName,
        },
        geometry: feature.geometry,
      };
    });

    logger.info(`[${stateName}] Converted ${places.length} places (${places.filter(p => p.properties.place_type === 'incorporated').length} incorporated, ${places.filter(p => p.properties.place_type === 'cdp').length} CDPs)`);

    return places;
  } catch (error) {
    logger.error(`[${stateName}] Conversion failed: ${error}`);
    return [];
  }
}

async function main() {
  logger.info('===================================');
  logger.info('Census TIGER/Line 2024 Place Loader');
  logger.info('===================================\n');

  const dataDir = join(__dirname, 'data', 'census-places');

  // Create data directory
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // Phase 1: Download all state shapefiles
  logger.info('Phase 1: Downloading state shapefiles...\n');
  let downloadSuccessCount = 0;

  for (const state of US_STATES) {
    const success = await downloadStateShapefile(state.fips, state.name);
    if (success) downloadSuccessCount++;

    // Rate limiting: Wait 500ms between downloads
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  logger.info(`\nDownload complete: ${downloadSuccessCount}/${US_STATES.length} states successful\n`);

  // Phase 2: Convert shapefiles to GeoJSON and consolidate
  logger.info('Phase 2: Converting to GeoJSON and consolidating...\n');

  const allPlaces: CensusPlace[] = [];

  for (const state of US_STATES) {
    const places = await convertShapefileToGeoJSON(state.fips, state.name);
    allPlaces.push(...places);
  }

  // Save consolidated GeoJSON
  const consolidatedGeoJSON: CensusPlaceCollection = {
    type: 'FeatureCollection',
    features: allPlaces,
  };

  const outputPath = join(__dirname, 'data', 'census_places_2024.geojson');
  writeFileSync(outputPath, JSON.stringify(consolidatedGeoJSON, null, 2));

  // Generate statistics
  const incorporated = allPlaces.filter(p => p.properties.place_type === 'incorporated').length;
  const cdps = allPlaces.filter(p => p.properties.place_type === 'cdp').length;

  logger.info('\n===================================');
  logger.info('Census Place Loading Complete');
  logger.info('===================================');
  logger.info(`Total places loaded: ${allPlaces.length.toLocaleString()}`);
  logger.info(`  Incorporated cities/towns: ${incorporated.toLocaleString()} (${((incorporated / allPlaces.length) * 100).toFixed(1)}%)`);
  logger.info(`  Census Designated Places: ${cdps.toLocaleString()} (${((cdps / allPlaces.length) * 100).toFixed(1)}%)`);
  logger.info(`\nOutput: ${outputPath}`);
  logger.info('===================================\n');
}

main().catch(error => {
  logger.error('Fatal error in main', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
