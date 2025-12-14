#!/usr/bin/env npx tsx
/**
 * Statewide Ward/District Batch Extraction
 *
 * Extracts city ward/council district boundaries from statewide GIS portals.
 * Achieves 100+ city coverage from 2 state portals (Wisconsin, Massachusetts).
 *
 * ARCHITECTURE:
 * - Download statewide dataset ONCE
 * - Split by city using municipality identifier field
 * - Normalize ward/district numbering
 * - Generate individual city GeoJSON files
 * - Output registry entries for each city
 *
 * DATA SOURCES:
 *
 * Wisconsin:
 * - Portal: Wisconsin Legislative Technology Services Bureau (LTSB)
 * - URL: https://web.s3.wisc.edu/rml-gisdata/WI_MunicipalWards_Spring_2023.zip
 * - Coverage: 50+ cities with ward-based governance
 * - Collection: Mandated by statute 5.15(4)(br)1, collected Jan/Jul
 *
 * Massachusetts:
 * - Portal: MassGIS (Mass.gov Bureau of Geographic Information)
 * - URL: https://www.mass.gov/info-details/massgis-data-2022-wards-and-precincts
 * - Coverage: 40+ cities (only cities have wards in MA, towns have precincts only)
 * - Data: Created by Secretary of Commonwealth's Election Division
 *
 * USAGE:
 * ```bash
 * # Extract Wisconsin wards
 * npx tsx scripts/extract-statewide-wards.ts --state WI
 *
 * # Extract Massachusetts wards
 * npx tsx scripts/extract-statewide-wards.ts --state MA
 *
 * # Extract both states
 * npx tsx scripts/extract-statewide-wards.ts --state all
 *
 * # Dry run (show what would be extracted)
 * npx tsx scripts/extract-statewide-wards.ts --state WI --dry-run
 * ```
 *
 * OUTPUT:
 * - Individual city GeoJSON files in data/statewide-wards/{state}/{city-fips}.geojson
 * - Registry entries in data/statewide-wards/{state}/registry-entries.json
 * - Extraction summary in data/statewide-wards/{state}/extraction-summary.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';
import type { FeatureCollection, Feature, Polygon, MultiPolygon } from 'geojson';
import type { KnownPortal } from '../registry/known-portals.js';
import { CensusPlaceListLoader } from '../registry/census-place-list.js';

const execAsync = promisify(exec);

/**
 * State extraction configuration
 */
interface StateExtractionConfig {
  readonly state: string;
  readonly stateName: string;
  readonly portalUrl: string;
  readonly downloadUrl: string;
  readonly layerName: string;
  readonly cityIdentifierField: string;
  readonly wardIdentifierField: string;
  readonly expectedCityCount: number;
  readonly dataFormat: 'shapefile' | 'geojson';
  readonly source: string;
  readonly confidence: number;
}

/**
 * Extracted city ward data
 */
interface CityWardData {
  readonly fips: string;
  readonly name: string;
  readonly state: string;
  readonly wardCount: number;
  readonly geojson: FeatureCollection<Polygon | MultiPolygon>;
  readonly source: string;
  readonly confidence: number;
}

/**
 * Statewide extraction configurations
 */
const STATE_CONFIGS: Record<string, StateExtractionConfig> = {
  WI: {
    state: 'WI',
    stateName: 'Wisconsin',
    portalUrl: 'https://geodata.wisc.edu/catalog/D4FBBF16-F3D3-4BF8-9E1F-4EDC23C3BDF1',
    downloadUrl: 'https://web.s3.wisc.edu/rml-gisdata/WI_MunicipalWards_Spring_2023.zip',
    layerName: 'WI_MunicipalWards_Spring_2023',
    cityIdentifierField: 'MCD_NAME', // Municipal Civil Division name (best guess - needs verification)
    wardIdentifierField: 'WARD', // Ward identifier (needs verification)
    expectedCityCount: 50,
    dataFormat: 'shapefile',
    source: 'Wisconsin Legislative Technology Services Bureau (LTSB) - Spring 2023 Municipal Wards',
    confidence: 100, // Authoritative state source
  },
  MA: {
    state: 'MA',
    stateName: 'Massachusetts',
    portalUrl: 'https://www.mass.gov/info-details/massgis-data-2022-wards-and-precincts',
    downloadUrl: 'https://s3.us-east-1.amazonaws.com/download.massgis.digital.mass.gov/shapefiles/state/wardsprecincts_shp.zip',
    layerName: 'WARDSPRECINCTS_POLY',
    cityIdentifierField: 'TOWN', // City/town name
    wardIdentifierField: 'WARD', // Ward number (cities only - towns use PRECINCT)
    expectedCityCount: 40,
    dataFormat: 'shapefile',
    source: 'MassGIS 2022 Wards and Precincts - Secretary of Commonwealth Election Division',
    confidence: 100, // Authoritative state source
  },
};

/**
 * CLI arguments
 */
interface CliArgs {
  state: 'WI' | 'MA' | 'all';
  dryRun: boolean;
  outputDir: string;
  skipDownload: boolean;
}

/**
 * Parse CLI arguments
 */
function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  const result: CliArgs = {
    state: 'all',
    dryRun: false,
    outputDir: path.join(process.cwd(), 'services/shadow-atlas/data/statewide-wards'),
    skipDownload: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--state':
        result.state = args[++i] as CliArgs['state'];
        break;
      case '--dry-run':
        result.dryRun = true;
        break;
      case '--output-dir':
        result.outputDir = args[++i];
        break;
      case '--skip-download':
        result.skipDownload = true;
        break;
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  return result;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Statewide Ward/District Batch Extraction

USAGE:
  npx tsx scripts/extract-statewide-wards.ts [OPTIONS]

OPTIONS:
  --state <state>     State to extract (WI|MA|all) - Default: all
  --dry-run           Show extraction plan without downloading data
  --output-dir <dir>  Output directory (default: data/statewide-wards)
  --skip-download     Skip download step (use existing data)
  --help              Show this help message

EXAMPLES:
  # Extract Wisconsin wards
  npx tsx scripts/extract-statewide-wards.ts --state WI

  # Extract Massachusetts wards
  npx tsx scripts/extract-statewide-wards.ts --state MA

  # Extract both states
  npx tsx scripts/extract-statewide-wards.ts --state all

  # Dry run
  npx tsx scripts/extract-statewide-wards.ts --state WI --dry-run
`);
}

/**
 * Download file from URL
 */
async function downloadFile(url: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;

    client.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (!redirectUrl) {
          reject(new Error('Redirect without location'));
          return;
        }
        downloadFile(redirectUrl, outputPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }

      const fileStream = createWriteStream(outputPath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });

      fileStream.on('error', (error) => {
        fs.unlinkSync(outputPath);
        reject(error);
      });
    }).on('error', reject);
  });
}

/**
 * Unzip shapefile
 */
async function unzipShapefile(zipPath: string, outputDir: string): Promise<void> {
  await execAsync(`unzip -o "${zipPath}" -d "${outputDir}"`);
}

/**
 * Convert shapefile to GeoJSON using ogr2ogr
 */
async function shapefileToGeoJSON(shpPath: string, outputPath: string): Promise<void> {
  await execAsync(`ogr2ogr -f GeoJSON -t_srs EPSG:4326 "${outputPath}" "${shpPath}"`);
}

/**
 * Load GeoJSON file
 */
function loadGeoJSON(filePath: string): FeatureCollection<Polygon | MultiPolygon> {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as FeatureCollection<Polygon | MultiPolygon>;
}

/**
 * Split statewide data by city
 */
function splitByCity(
  stateData: FeatureCollection<Polygon | MultiPolygon>,
  config: StateExtractionConfig
): Map<string, Feature<Polygon | MultiPolygon>[]> {
  const cityFeatures = new Map<string, Feature<Polygon | MultiPolygon>[]>();

  for (const feature of stateData.features) {
    const cityName = feature.properties?.[config.cityIdentifierField];
    const wardId = feature.properties?.[config.wardIdentifierField];

    // Skip features without city name or ward ID
    if (!cityName || !wardId) {
      continue;
    }

    // Skip precincts (Massachusetts only - cities have wards, towns have precincts)
    if (config.state === 'MA' && !feature.properties?.WARD) {
      continue; // Town precinct, not city ward
    }

    if (!cityFeatures.has(cityName)) {
      cityFeatures.set(cityName, []);
    }

    cityFeatures.get(cityName)!.push(feature);
  }

  return cityFeatures;
}

/**
 * Get city FIPS code from Census data
 */
async function getCityFips(cityName: string, state: string): Promise<string | null> {
  const loader = new CensusPlaceListLoader();
  const stateFips = state === 'WI' ? '55' : state === 'MA' ? '25' : null;

  if (!stateFips) {
    return null;
  }

  const places = await loader.loadPlacesByState(stateFips);

  // Normalize city names for matching
  const normalizedTarget = cityName.toLowerCase().trim();

  for (const place of places) {
    const normalizedPlace = place.name.toLowerCase().trim();

    if (normalizedPlace === normalizedTarget) {
      return place.geoid;
    }

    // Handle common variations
    if (normalizedPlace.replace(' city', '') === normalizedTarget) {
      return place.geoid;
    }
    if (normalizedPlace === normalizedTarget.replace(' city', '')) {
      return place.geoid;
    }
  }

  return null;
}

/**
 * Normalize ward numbering (ensure sequential 1, 2, 3...)
 */
function normalizeWardNumbering(
  features: Feature<Polygon | MultiPolygon>[],
  config: StateExtractionConfig
): Feature<Polygon | MultiPolygon>[] {
  // Extract ward numbers and sort
  const wardNumbers = features
    .map(f => {
      const wardId = f.properties?.[config.wardIdentifierField];
      if (typeof wardId === 'number') return wardId;
      if (typeof wardId === 'string') {
        // Handle "Ward 1", "1", "I", etc.
        const match = wardId.match(/\d+/);
        return match ? parseInt(match[0], 10) : null;
      }
      return null;
    })
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);

  // Create normalized features
  return features.map((feature, index) => ({
    ...feature,
    properties: {
      ...feature.properties,
      WARD_NORMALIZED: wardNumbers[index] || index + 1,
    },
  }));
}

/**
 * Extract wards for a single state
 */
async function extractStateWards(
  config: StateExtractionConfig,
  outputDir: string,
  skipDownload: boolean
): Promise<CityWardData[]> {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${config.stateName.toUpperCase()} WARD EXTRACTION`);
  console.log(`${'='.repeat(70)}\n`);

  const stateDir = path.join(outputDir, config.state);
  const downloadPath = path.join(stateDir, `statewide-${config.state}.zip`);
  const extractDir = path.join(stateDir, 'extracted');
  const geojsonPath = path.join(stateDir, `statewide-${config.state}.geojson`);

  // Ensure directories exist
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(extractDir, { recursive: true });

  // Step 1: Download statewide data
  if (!skipDownload) {
    console.log(`Step 1: Downloading statewide data...`);
    console.log(`  Source: ${config.downloadUrl}`);

    try {
      await downloadFile(config.downloadUrl, downloadPath);
      console.log(`  ✅ Downloaded to ${downloadPath}`);
    } catch (error) {
      console.error(`  ❌ Download failed: ${(error as Error).message}`);
      throw error;
    }

    // Step 2: Extract shapefile
    console.log(`\nStep 2: Extracting shapefile...`);
    try {
      await unzipShapefile(downloadPath, extractDir);
      console.log(`  ✅ Extracted to ${extractDir}`);
    } catch (error) {
      console.error(`  ❌ Extraction failed: ${(error as Error).message}`);
      throw error;
    }

    // Step 3: Convert to GeoJSON
    console.log(`\nStep 3: Converting to GeoJSON...`);
    const shpFiles = fs.readdirSync(extractDir).filter(f => f.endsWith('.shp'));

    if (shpFiles.length === 0) {
      throw new Error('No .shp file found in extracted data');
    }

    const shpPath = path.join(extractDir, shpFiles[0]);
    console.log(`  Converting ${shpFiles[0]}...`);

    try {
      await shapefileToGeoJSON(shpPath, geojsonPath);
      console.log(`  ✅ Converted to ${geojsonPath}`);
    } catch (error) {
      console.error(`  ❌ Conversion failed: ${(error as Error).message}`);
      throw error;
    }
  } else {
    console.log(`Skipping download (--skip-download flag)`);
  }

  // Step 4: Load and split by city
  console.log(`\nStep 4: Loading and splitting by city...`);
  const stateData = loadGeoJSON(geojsonPath);
  console.log(`  Loaded ${stateData.features.length} features`);

  const cityFeatures = splitByCity(stateData, config);
  console.log(`  Found ${cityFeatures.size} cities with ward data`);

  // Step 5: Process each city
  console.log(`\nStep 5: Processing individual cities...`);
  const results: CityWardData[] = [];

  for (const [cityName, features] of cityFeatures.entries()) {
    console.log(`\n  Processing: ${cityName}...`);

    // Get FIPS code
    const fips = await getCityFips(cityName, config.state);

    if (!fips) {
      console.log(`    ⚠️  No FIPS code found - skipping`);
      continue;
    }

    console.log(`    FIPS: ${fips}`);
    console.log(`    Wards: ${features.length}`);

    // Normalize ward numbering
    const normalizedFeatures = normalizeWardNumbering(features, config);

    // Create GeoJSON
    const cityGeoJSON: FeatureCollection<Polygon | MultiPolygon> = {
      type: 'FeatureCollection',
      features: normalizedFeatures,
    };

    // Write individual city file
    const cityOutputPath = path.join(stateDir, 'cities', `${fips}.geojson`);
    fs.mkdirSync(path.dirname(cityOutputPath), { recursive: true });
    fs.writeFileSync(cityOutputPath, JSON.stringify(cityGeoJSON, null, 2));

    console.log(`    ✅ Written to ${cityOutputPath}`);

    results.push({
      fips,
      name: cityName,
      state: config.state,
      wardCount: features.length,
      geojson: cityGeoJSON,
      source: config.source,
      confidence: config.confidence,
    });
  }

  return results;
}

/**
 * Generate registry entries
 */
function generateRegistryEntries(cityData: CityWardData[]): KnownPortal[] {
  return cityData.map(city => ({
    cityFips: city.fips,
    cityName: city.name,
    state: city.state,
    portalType: 'state-gis' as const,
    downloadUrl: `statewide-extraction/${city.state}/${city.fips}.geojson`,
    featureCount: city.wardCount,
    lastVerified: new Date().toISOString(),
    confidence: city.confidence,
    discoveredBy: 'automated' as const,
    notes: city.source,
  }));
}

/**
 * Main extraction function
 */
async function main(): Promise<void> {
  const args = parseArgs();

  console.log('\n========================================');
  console.log('  STATEWIDE WARD BATCH EXTRACTION');
  console.log('========================================\n');

  const statesToExtract: string[] =
    args.state === 'all' ? ['WI', 'MA'] : [args.state];

  if (args.dryRun) {
    console.log('[DRY RUN] Extraction plan:\n');
    for (const state of statesToExtract) {
      const config = STATE_CONFIGS[state];
      console.log(`${config.stateName}:`);
      console.log(`  Portal: ${config.portalUrl}`);
      console.log(`  Download: ${config.downloadUrl}`);
      console.log(`  Expected cities: ${config.expectedCityCount}`);
      console.log(`  Confidence: ${config.confidence}`);
      console.log();
    }
    return;
  }

  const allResults: CityWardData[] = [];
  const allRegistryEntries: KnownPortal[] = [];

  for (const state of statesToExtract) {
    const config = STATE_CONFIGS[state];

    try {
      const results = await extractStateWards(config, args.outputDir, args.skipDownload);
      allResults.push(...results);

      const registryEntries = generateRegistryEntries(results);
      allRegistryEntries.push(...registryEntries);

      // Write state-specific outputs
      const stateDir = path.join(args.outputDir, state);

      fs.writeFileSync(
        path.join(stateDir, 'registry-entries.json'),
        JSON.stringify(registryEntries, null, 2)
      );

      fs.writeFileSync(
        path.join(stateDir, 'extraction-summary.json'),
        JSON.stringify(
          {
            state: config.state,
            stateName: config.stateName,
            extractedAt: new Date().toISOString(),
            citiesFound: results.length,
            expectedCities: config.expectedCityCount,
            source: config.source,
            cities: results.map(r => ({
              fips: r.fips,
              name: r.name,
              wardCount: r.wardCount,
            })),
          },
          null,
          2
        )
      );

      console.log(`\n${'='.repeat(70)}`);
      console.log(`  ${config.stateName.toUpperCase()} EXTRACTION COMPLETE`);
      console.log(`${'='.repeat(70)}\n`);
      console.log(`  Cities extracted: ${results.length}`);
      console.log(`  Registry entries: ${registryEntries.length}`);
      console.log(`  Output directory: ${stateDir}`);
      console.log();

    } catch (error) {
      console.error(`\n❌ ${config.stateName} extraction failed:`, error);
      continue;
    }
  }

  // Final summary
  console.log('\n========================================');
  console.log('  BATCH EXTRACTION COMPLETE');
  console.log('========================================\n');

  console.log(`Total cities extracted: ${allResults.length}`);
  console.log(`Total registry entries: ${allRegistryEntries.length}`);
  console.log();

  // Group by state
  const byState = allResults.reduce((acc, r) => {
    acc[r.state] = (acc[r.state] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('Breakdown by state:');
  for (const [state, count] of Object.entries(byState)) {
    console.log(`  ${state}: ${count} cities`);
  }

  console.log();
  console.log('Next steps:');
  console.log('1. Review generated registry entries in data/statewide-wards/*/registry-entries.json');
  console.log('2. Validate city GeoJSON files in data/statewide-wards/*/cities/');
  console.log('3. Manually add high-confidence entries to known-portals.ts');
  console.log('4. Update ROADMAP.md with statewide extraction completion');
}

// Run if executed directly
main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
