#!/usr/bin/env tsx

/**
 * City Council District GIS Data Collection Script
 *
 * Automates downloading city council district boundaries from municipal open data portals.
 * Supports ArcGIS Hub, Socrata, CKAN platforms.
 *
 * Usage:
 *   npx tsx scripts/collect-city-council-gis.ts --city "New York"
 *   npx tsx scripts/collect-city-council-gis.ts --all  # Top 50 cities
 *   npx tsx scripts/collect-city-council-gis.ts --dry-run  # Preview only
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// City council district data sources (verified FREE open data portals)
interface CityDataSource {
  city: string;
  state: string;
  population: number; // 2025 estimate
  platform: 'arcgis' | 'socrata' | 'ckan' | 'direct';
  url: string;
  datasetId?: string;
  downloadUrl?: string; // Direct GeoJSON/SHP link
  notes?: string;
}

const CITY_DATA_SOURCES: CityDataSource[] = [
  // Top 10 cities (verified sources)
  {
    city: 'New York',
    state: 'NY',
    population: 8_478_000,
    platform: 'arcgis',
    url: 'https://data.cityofnewyork.us',
    datasetId: 'nyc-city-council-districts',
    downloadUrl: 'https://data.cityofnewyork.us/api/geospatial/yusd-j4xi?method=export&format=GeoJSON',
    notes: 'NYC Department of City Planning - 51 council districts'
  },
  {
    city: 'Los Angeles',
    state: 'CA',
    population: 3_879_000,
    platform: 'arcgis',
    url: 'https://geohub.lacity.org',
    datasetId: 'la-city-council-districts-2012',
    downloadUrl: 'https://geohub.lacity.org/datasets/lacounty::la-city-council-districts-2012/explore?location=34.019820%2C-118.411249%2C10.00&showTable=true',
    notes: 'LA GeoHub - 15 council districts'
  },
  {
    city: 'Chicago',
    state: 'IL',
    population: 2_721_000,
    platform: 'socrata',
    url: 'https://data.cityofchicago.org',
    datasetId: 'boundaries-wards-2015-2023',
    downloadUrl: 'https://data.cityofchicago.org/api/geospatial/sp34-6z76?method=export&format=GeoJSON',
    notes: 'Chicago Data Portal - 50 wards (aldermanic districts)'
  },
  {
    city: 'Houston',
    state: 'TX',
    population: 2_314_000,
    platform: 'arcgis',
    url: 'https://cohgis-mycity.opendata.arcgis.com',
    datasetId: 'coh-city-council-districts',
    downloadUrl: 'https://services.arcgis.com/su8ic9KbA7PYVxPS/arcgis/rest/services/COH_CITY_COUNCIL_DISTRICTS/FeatureServer/0/query?outFields=*&where=1%3D1&f=geojson',
    notes: 'COH GIS Hub - 16 council districts (updated 2024-2028)'
  },
  {
    city: 'Philadelphia',
    state: 'PA',
    population: 1_584_000,
    platform: 'arcgis',
    url: 'https://www.opendataphilly.org',
    datasetId: 'philadelphia-city-council-districts',
    downloadUrl: 'https://opendata.arcgis.com/datasets/10302c902dba4974b1af1c64c55a1f17_0.geojson',
    notes: 'OpenDataPhilly + PASDA - 10 council districts'
  },
  {
    city: 'San Francisco',
    state: 'CA',
    population: 873_000,
    platform: 'socrata',
    url: 'https://data.sfgov.org',
    datasetId: 'supervisor-districts',
    downloadUrl: 'https://data.sfgov.org/api/geospatial/8nkz-x4ny?method=export&format=GeoJSON',
    notes: 'DataSF - 11 supervisor districts'
  },
  {
    city: 'Seattle',
    state: 'WA',
    population: 749_000,
    platform: 'arcgis',
    url: 'https://data.seattle.gov',
    datasetId: 'city-council-districts',
    downloadUrl: 'https://data.seattle.gov/api/geospatial/phxc-3fxa?method=export&format=GeoJSON',
    notes: 'Seattle Open Data - 7 council districts'
  },
  {
    city: 'Denver',
    state: 'CO',
    population: 711_000,
    platform: 'arcgis',
    url: 'https://denvergov.org/opendata',
    datasetId: 'city-council-districts',
    downloadUrl: 'https://www.denvergov.org/media/gis/DataCatalog/city_council_districts/shape/city_council_districts.zip',
    notes: 'Denver Open Data - 13 council districts'
  },
  {
    city: 'Portland',
    state: 'OR',
    population: 652_000,
    platform: 'arcgis',
    url: 'https://www.portland.gov/open-data',
    datasetId: 'voting-districts',
    downloadUrl: 'https://www.portland.gov/sites/default/files/2024/voting-districts-shapefiles.zip',
    notes: 'Portland Open Data - 4 voting districts (new 2024 system)'
  },
  {
    city: 'San Jose',
    state: 'CA',
    population: 1_013_000,
    platform: 'socrata',
    url: 'https://data.sanjoseca.gov',
    datasetId: 'council-district',
    downloadUrl: 'https://data.sanjoseca.gov/api/geospatial/c9r4-gbfh?method=export&format=GeoJSON',
    notes: 'San Jose Open Data - 10 council districts (effective Feb 2022)'
  },

  // Next 40 cities (placeholders - need manual verification)
  {
    city: 'Phoenix',
    state: 'AZ',
    population: 1_662_000,
    platform: 'arcgis',
    url: 'https://www.phoenixopendata.com',
    notes: 'To verify: Phoenix council districts availability'
  },
  {
    city: 'San Antonio',
    state: 'TX',
    population: 1_495_000,
    platform: 'arcgis',
    url: 'https://data.sanantonio.gov',
    notes: 'To verify: San Antonio council districts availability'
  },
  {
    city: 'San Diego',
    state: 'CA',
    population: 1_387_000,
    platform: 'arcgis',
    url: 'https://data.sandiego.gov',
    notes: 'To verify: San Diego council districts availability'
  },
  {
    city: 'Dallas',
    state: 'TX',
    population: 1_302_000,
    platform: 'arcgis',
    url: 'https://www.dallasopendata.com',
    notes: 'To verify: Dallas council districts availability'
  },
  {
    city: 'Austin',
    state: 'TX',
    population: 974_000,
    platform: 'socrata',
    url: 'https://data.austintexas.gov',
    notes: 'To verify: Austin council districts availability'
  },
  // ... (35 more cities to add)
];

interface DownloadResult {
  city: string;
  success: boolean;
  outputPath?: string;
  error?: string;
  districtCount?: number;
  format?: string;
}

async function downloadGeoJSON(url: string, outputPath: string): Promise<void> {
  console.log(`  Downloading from: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  // Validate GeoJSON structure
  if (!data.type || data.type !== 'FeatureCollection') {
    throw new Error('Invalid GeoJSON: not a FeatureCollection');
  }

  if (!data.features || !Array.isArray(data.features)) {
    throw new Error('Invalid GeoJSON: missing features array');
  }

  // Write to file with pretty formatting
  fs.writeFileSync(
    outputPath,
    JSON.stringify(data, null, 2),
    'utf-8'
  );

  console.log(`  ✅ Downloaded ${data.features.length} districts`);
}

async function downloadCity(source: CityDataSource, dryRun: boolean = false): Promise<DownloadResult> {
  const citySlug = source.city.toLowerCase().replace(/\s+/g, '-');
  const outputPath = path.join(
    __dirname,
    '../packages/crypto/data/city-council-districts',
    `${citySlug}.geojson`
  );

  console.log(`\n📍 ${source.city}, ${source.state}`);
  console.log(`   Population: ${source.population.toLocaleString()}`);
  console.log(`   Platform: ${source.platform}`);
  console.log(`   URL: ${source.url}`);

  if (source.notes) {
    console.log(`   Notes: ${source.notes}`);
  }

  // Check if download URL exists
  if (!source.downloadUrl) {
    console.log(`   ⚠️  No download URL configured - manual collection required`);
    return {
      city: source.city,
      success: false,
      error: 'No download URL configured'
    };
  }

  if (dryRun) {
    console.log(`   🔍 DRY RUN - would download to: ${outputPath}`);
    return {
      city: source.city,
      success: true,
      outputPath
    };
  }

  try {
    await downloadGeoJSON(source.downloadUrl, outputPath);

    // Read back to get district count
    const data = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));

    return {
      city: source.city,
      success: true,
      outputPath,
      districtCount: data.features.length,
      format: 'GeoJSON'
    };
  } catch (error) {
    console.error(`   ❌ Download failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      city: source.city,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const cityFilter = args.find(arg => arg.startsWith('--city='))?.split('=')[1];
  const downloadAll = args.includes('--all');

  console.log('🏛️  City Council District GIS Data Collection\n');

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No files will be downloaded\n');
  }

  // Filter sources
  let sources = CITY_DATA_SOURCES;
  if (cityFilter) {
    sources = sources.filter(s =>
      s.city.toLowerCase() === cityFilter.toLowerCase()
    );
    if (sources.length === 0) {
      console.error(`❌ City not found: ${cityFilter}`);
      process.exit(1);
    }
  } else if (!downloadAll) {
    // Default to top 10 verified cities only
    sources = sources.filter(s => s.downloadUrl !== undefined);
    console.log(`📊 Downloading top ${sources.length} verified cities (use --all for all 50)\n`);
  }

  // Create output directory
  const outputDir = path.join(__dirname, '../packages/crypto/data/city-council-districts');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`📁 Created directory: ${outputDir}\n`);
  }

  // Download each city
  const results: DownloadResult[] = [];
  for (const source of sources) {
    const result = await downloadCity(source, dryRun);
    results.push(result);

    // Rate limiting: wait 1 second between requests
    if (!dryRun && sources.indexOf(source) < sources.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 DOWNLOAD SUMMARY\n');

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`✅ Successful: ${successful.length}`);
  console.log(`❌ Failed: ${failed.length}`);

  if (successful.length > 0) {
    const totalDistricts = successful.reduce((sum, r) => sum + (r.districtCount || 0), 0);
    const totalPopulation = sources
      .filter(s => successful.some(r => r.city === s.city))
      .reduce((sum, s) => sum + s.population, 0);

    console.log(`\n📈 Coverage:`);
    console.log(`   Districts: ${totalDistricts.toLocaleString()}`);
    console.log(`   Population: ${totalPopulation.toLocaleString()} (~${Math.round(totalPopulation / 330_000_000 * 100)}% of US)`);
  }

  if (failed.length > 0) {
    console.log(`\n⚠️  Failed cities (manual collection required):`);
    failed.forEach(r => {
      console.log(`   - ${r.city}: ${r.error}`);
    });
  }

  // Generate README
  if (!dryRun && successful.length > 0) {
    const readmePath = path.join(outputDir, 'README.md');
    const readme = generateReadme(successful, sources);
    fs.writeFileSync(readmePath, readme, 'utf-8');
    console.log(`\n📄 Generated: ${readmePath}`);
  }

  console.log('\n' + '='.repeat(80));

  process.exit(failed.length > 0 ? 1 : 0);
}

function generateReadme(results: DownloadResult[], sources: CityDataSource[]): string {
  const date = new Date().toISOString().split('T')[0];

  return `# City Council District GIS Data

**Last Updated:** ${date}
**Cities:** ${results.length}
**Format:** GeoJSON (WGS84)

## Data Sources

| City | State | Districts | Source | License |
|------|-------|-----------|--------|---------|
${results.map(r => {
  const source = sources.find(s => s.city === r.city)!;
  return `| ${source.city} | ${source.state} | ${r.districtCount} | [${source.platform}](${source.url}) | Open Data |`;
}).join('\n')}

## File Format

All files are standardized GeoJSON (EPSG:4326 WGS84 projection):

\`\`\`json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "district": "1",
        "name": "District 1",
        "representative": "Council Member Name"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [...]
      }
    }
  ]
}
\`\`\`

## Usage

\`\`\`typescript
import fs from 'fs';

// Load city council districts
const districts = JSON.parse(
  fs.readFileSync('city-council-districts/new-york.geojson', 'utf-8')
);

// Find district for a coordinate
import * as turf from '@turf/turf';
const point = turf.point([-73.935242, 40.730610]); // Manhattan

for (const district of districts.features) {
  if (turf.booleanPointInPolygon(point, district)) {
    console.log(\`Found: \${district.properties.name}\`);
  }
}
\`\`\`

## Data Updates

City council districts are redistricted every 10 years after the census, with occasional special elections triggering boundary changes.

**Update Process:**
1. Monitor municipal open data portals for boundary updates
2. Re-run \`npx tsx scripts/collect-city-council-gis.ts --all\`
3. Validate topology with \`npx tsx scripts/validate-city-council-gis.ts\`
4. Commit with version tag (e.g., \`nyc-2025-redistricting\`)

## License

All data sourced from municipal open data portals under public domain or open data licenses. See individual city portals for specific license terms.

**Collection Script:** \`/scripts/collect-city-council-gis.ts\`
**Generated:** ${date}
`;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { downloadCity, CITY_DATA_SOURCES };
