#!/usr/bin/env tsx

/**
 * Download municipal boundaries from regional COGs
 * Uses ArcGIS REST APIs to download GeoJSON data
 */

import * as fs from 'fs';
import * as path from 'path';

interface COGDataset {
  name: string;
  restApiUrl: string;
  expectedCities: number;
  coverage: string;
}

const COG_DATASETS: COGDataset[] = [
  {
    name: 'arc',
    restApiUrl: 'https://services3.arcgis.com/Et5Qekg9b3STLgo3/arcgis/rest/services/Atlanta_Region_Cities/FeatureServer/0',
    expectedCities: 75,
    coverage: 'Atlanta Regional Commission - 75 cities, 6M population'
  },
  {
    name: 'mapc',
    restApiUrl: 'https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/MunicipalBoundaries_Arc/FeatureServer/0',
    expectedCities: 101,
    coverage: 'Metro Boston (MAPC) - 101 municipalities, 4M population'
  },
  {
    name: 'cmap',
    restApiUrl: 'https://services.arcgis.com/rOo16HdIMeOBI4Mb/arcgis/rest/services/municipalities/FeatureServer/0',
    expectedCities: 284,
    coverage: 'Chicago Metro (CMAP) - 284 municipalities, 9M population'
  },
  {
    name: 'semcog',
    restApiUrl: 'https://gisservices.semcog.org/arcgis/rest/services/SemcogDynamicGP/Community_Boundaries/FeatureServer/0',
    expectedCities: 147,
    coverage: 'Southeast Michigan (SEMCOG) - 147 communities, 5M population'
  },
  {
    name: 'nymtc',
    restApiUrl: 'https://services5.arcgis.com/UEUDVd1QVLH7YWJt/arcgis/rest/services/Municipal_Boundaries_NY_NJ_CT/FeatureServer/0',
    expectedCities: 347,
    coverage: 'NY Metro (NYMTC) - 347 municipalities, 23M population'
  }
];

async function downloadGeoJSON(dataset: COGDataset): Promise<void> {
  const outputDir = path.join(__dirname, '..', 'packages', 'crypto', 'data', 'regional-consortiums');
  const outputPath = path.join(outputDir, `${dataset.name}.geojson`);

  console.log(`\nDownloading: ${dataset.coverage}`);
  console.log(`REST API: ${dataset.restApiUrl}`);

  // Construct query URL for GeoJSON export
  const queryUrl = `${dataset.restApiUrl}/query?where=1%3D1&outFields=*&f=geojson&returnGeometry=true`;

  try {
    const response = await fetch(queryUrl);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const geojson = await response.json();

    // Validate GeoJSON
    if (!geojson.type || geojson.type !== 'FeatureCollection') {
      throw new Error(`Invalid GeoJSON: missing FeatureCollection type`);
    }

    if (!geojson.features || !Array.isArray(geojson.features)) {
      throw new Error(`Invalid GeoJSON: missing features array`);
    }

    const featureCount = geojson.features.length;
    console.log(`Downloaded: ${featureCount} features`);

    if (featureCount < dataset.expectedCities * 0.5) {
      console.warn(`⚠️  WARNING: Expected ~${dataset.expectedCities} cities, got ${featureCount}`);
    }

    // Write to file
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));

    const stats = fs.statSync(outputPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

    console.log(`✓ Saved: ${outputPath}`);
    console.log(`  Size: ${sizeMB} MB`);
    console.log(`  Features: ${featureCount}`);

  } catch (error) {
    console.error(`✗ Failed to download ${dataset.name}:`, error);
    throw error;
  }
}

async function main(): Promise<void> {
  console.log('Regional COG Municipal Boundaries Downloader');
  console.log('='.repeat(60));

  const outputDir = path.join(__dirname, '..', 'packages', 'crypto', 'data', 'regional-consortiums');

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let successCount = 0;
  let totalCities = 0;

  for (const dataset of COG_DATASETS) {
    try {
      await downloadGeoJSON(dataset);
      successCount++;

      // Read back to get actual count
      const outputPath = path.join(outputDir, `${dataset.name}.geojson`);
      const data = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      totalCities += data.features.length;

    } catch (error) {
      console.error(`Failed: ${dataset.name}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Summary: ${successCount}/${COG_DATASETS.length} COGs downloaded successfully`);
  console.log(`Total cities: ${totalCities.toLocaleString()}`);
  console.log(`Combined with existing SCAG + NCTCOG: ${(totalCities + 1951).toLocaleString()} cities`);
}

main().catch(console.error);
