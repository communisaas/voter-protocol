/**
 * Download unified regional city boundaries from Councils of Governments (COGs)
 *
 * Strategy: Batch download 1,800+ cities in ONE DAY via regional consortiums
 * Coverage: 7 major COGs covering ~1,314 cities across US metros
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

interface COGSource {
  name: string;
  coverage: string;
  cities: number;
  population: number;
  apiUrl: string;
  outFields: string[];
}

const COG_SOURCES: COGSource[] = [
  {
    name: 'SCAG',
    coverage: 'Southern California',
    cities: 191,
    population: 19000000,
    // ArcGIS Feature Service - query all features as GeoJSON
    apiUrl: 'https://services1.arcgis.com/1vIhDJwtG5eNmiqX/arcgis/rest/services/City_Boundaries_SCAG_Region/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    outFields: ['CITY_NAME', 'COUNTY_NAME', 'FIPS_CODE', 'AREA_SQ_MI']
  },
  {
    name: 'NCTCOG',
    coverage: 'North Central Texas (Dallas-Fort Worth)',
    cities: 169,
    population: 8000000,
    // North Central Texas Council of Governments
    apiUrl: 'https://services.arcgis.com/KNdRU5cN6ENqCTjk/arcgis/rest/services/City_Boundaries/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    outFields: ['CITY_NAME', 'COUNTY', 'FIPS']
  },
  {
    name: 'ARC',
    coverage: 'Atlanta Regional Commission',
    cities: 75,
    population: 6000000,
    // Atlanta Regional Commission Open Data
    apiUrl: 'https://services.arcgis.com/HGJkS1j6M9YzjX3n/arcgis/rest/services/City_Boundaries/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    outFields: ['NAME', 'COUNTY', 'FIPS']
  },
  {
    name: 'MAPC',
    coverage: 'Metro Boston (Massachusetts)',
    cities: 101,
    population: 4000000,
    // Metropolitan Area Planning Council
    apiUrl: 'https://services1.arcgis.com/ceiitspzDAHrdGO1/arcgis/rest/services/Municipal_Boundaries_MAPC/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    outFields: ['municipal', 'county', 'fips_stco']
  },
  {
    name: 'CMAP',
    coverage: 'Chicago Metropolitan Area',
    cities: 284,
    population: 9000000,
    // Chicago Metropolitan Agency for Planning
    apiUrl: 'https://services.arcgis.com/rOo16HdIMeOBI4Mb/arcgis/rest/services/Municipal_Boundaries/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    outFields: ['MUNICIPALITY', 'COUNTY', 'FIPS']
  },
  {
    name: 'SEMCOG',
    coverage: 'Southeast Michigan (Detroit)',
    cities: 147,
    population: 5000000,
    // Southeast Michigan Council of Governments
    apiUrl: 'https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/Communities/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    outFields: ['NAME', 'COUNTY', 'FIPS']
  },
  {
    name: 'NYMTC',
    coverage: 'New York Metropolitan (Tri-State)',
    cities: 347,
    population: 23000000,
    // New York Metropolitan Transportation Council
    apiUrl: 'https://services6.arcgis.com/FdXWDzDYfGO4Nqml/arcgis/rest/services/Municipal_Boundaries_NY_NJ_CT/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    outFields: ['NAME', 'COUNTY', 'STATE', 'FIPS']
  }
];

async function downloadFile(url: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    const request = protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Follow redirects
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          console.log(`Following redirect to: ${redirectUrl}`);
          downloadFile(redirectUrl, outputPath).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }

      const fileStream = fs.createWriteStream(outputPath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });

      fileStream.on('error', (err) => {
        fs.unlink(outputPath, () => reject(err));
      });
    });

    request.on('error', reject);
    request.setTimeout(60000, () => {
      request.destroy();
      reject(new Error('Download timeout'));
    });
  });
}

async function downloadCOG(cog: COGSource): Promise<void> {
  const outputDir = path.join(process.cwd(), 'packages/crypto/data/regional-consortiums');
  const outputPath = path.join(outputDir, `${cog.name.toLowerCase()}.geojson`);

  console.log(`\n📡 Downloading ${cog.name} (${cog.coverage})`);
  console.log(`   Expected: ${cog.cities} cities, ${(cog.population / 1000000).toFixed(1)}M population`);
  console.log(`   URL: ${cog.apiUrl.substring(0, 80)}...`);

  try {
    const startTime = Date.now();
    await downloadFile(cog.apiUrl, outputPath);
    const downloadTime = ((Date.now() - startTime) / 1000).toFixed(1);

    // Validate the downloaded file
    const fileContent = fs.readFileSync(outputPath, 'utf-8');
    const geojson = JSON.parse(fileContent);

    if (geojson.type !== 'FeatureCollection') {
      throw new Error(`Invalid GeoJSON: not a FeatureCollection`);
    }

    const featureCount = geojson.features?.length || 0;
    const fileSize = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);

    console.log(`   ✅ Downloaded: ${featureCount} features, ${fileSize} MB in ${downloadTime}s`);

    if (featureCount < 50) {
      console.log(`   ⚠️  WARNING: Expected ${cog.cities} cities, got ${featureCount} features`);
    }

    // Add metadata
    const enrichedGeoJSON = {
      type: 'FeatureCollection',
      metadata: {
        source: cog.name,
        coverage: cog.coverage,
        date: new Date().toISOString().split('T')[0],
        cities: featureCount,
        expectedCities: cog.cities,
        population: cog.population,
        downloadUrl: cog.apiUrl
      },
      features: geojson.features
    };

    fs.writeFileSync(outputPath, JSON.stringify(enrichedGeoJSON, null, 2));
    console.log(`   💾 Saved to: ${outputPath}`);

  } catch (error) {
    console.error(`   ❌ Failed to download ${cog.name}:`, error);
    throw error;
  }
}

async function main() {
  console.log('🚀 Regional COG Batch Download');
  console.log('================================\n');
  console.log(`Target: ${COG_SOURCES.length} COGs`);
  console.log(`Expected cities: ${COG_SOURCES.reduce((sum, cog) => sum + cog.cities, 0)}`);
  console.log(`Coverage: ${(COG_SOURCES.reduce((sum, cog) => sum + cog.population, 0) / 1000000).toFixed(0)}M population\n`);

  // Create output directory
  const outputDir = path.join(process.cwd(), 'packages/crypto/data/regional-consortiums');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const results = {
    successful: [] as string[],
    failed: [] as string[],
    totalCities: 0,
    totalSize: 0
  };

  // Download each COG
  for (const cog of COG_SOURCES) {
    try {
      await downloadCOG(cog);
      results.successful.push(cog.name);

      const outputPath = path.join(outputDir, `${cog.name.toLowerCase()}.geojson`);
      const geojson = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      results.totalCities += geojson.features?.length || 0;
      results.totalSize += fs.statSync(outputPath).size;

    } catch (error) {
      results.failed.push(cog.name);
      console.error(`Failed to process ${cog.name}`);
    }
  }

  // Summary report
  console.log('\n\n📊 BATCH DOWNLOAD SUMMARY');
  console.log('==========================\n');
  console.log(`✅ Successful: ${results.successful.length}/${COG_SOURCES.length}`);
  console.log(`   ${results.successful.join(', ')}`);

  if (results.failed.length > 0) {
    console.log(`\n❌ Failed: ${results.failed.length}`);
    console.log(`   ${results.failed.join(', ')}`);
  }

  console.log(`\n📍 Total Cities Downloaded: ${results.totalCities}`);
  console.log(`💾 Total Size: ${(results.totalSize / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`📁 Output Directory: ${outputDir}`);

  const coveragePercent = ((results.totalCities / COG_SOURCES.reduce((sum, cog) => sum + cog.cities, 0)) * 100).toFixed(1);
  console.log(`\n🎯 Coverage: ${coveragePercent}% of expected cities`);

  if (results.successful.length === COG_SOURCES.length) {
    console.log('\n✨ SUCCESS: All regional consortiums downloaded!');
    console.log('Next step: Validate geometries and normalize schema');
  }
}

main().catch(console.error);
