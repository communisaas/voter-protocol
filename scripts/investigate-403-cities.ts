/**
 * Investigation script: Find working GeoJSON URLs for 7 cities with 403 errors
 *
 * Root cause: Direct .geojson dataset URLs are deprecated in ArcGIS Hub.
 * Solution: Use FeatureServer query endpoints instead.
 */

interface CityInvestigation {
  name: string;
  originalUrl: string;
  itemId?: string;
  portalUrl?: string;
  status: 'pending' | 'found' | 'not_found' | 'empty_dataset';
  workingUrl?: string;
  featureCount?: number;
  notes?: string;
}

const cities: CityInvestigation[] = [
  {
    name: 'Las Vegas, NV',
    originalUrl: 'https://geocommons-lasvegas.opendata.arcgis.com/datasets/city-council-wards.geojson',
    portalUrl: 'geocommons-lasvegas.opendata.arcgis.com',
    status: 'pending'
  },
  {
    name: 'Tucson, AZ',
    originalUrl: 'https://gisdata.tucsonaz.gov/datasets/city-of-tucson-wards-open-data.geojson',
    portalUrl: 'gisdata.tucsonaz.gov',
    status: 'pending'
  },
  {
    name: 'Omaha, NE',
    originalUrl: 'https://data-dogis.opendata.arcgis.com/datasets/city-council-districts.geojson',
    itemId: '7cfcd013310942dba79780f2b7499817',
    workingUrl: 'https://dcgis.org/server/rest/services/Hosted/Omaha_City_Council_Districts_(source)_view/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 7,
    status: 'found',
    notes: 'Found via ArcGIS Online item metadata'
  },
  {
    name: 'Tampa, FL',
    originalUrl: 'https://city-tampa.opendata.arcgis.com/datasets/city-council-district.geojson',
    portalUrl: 'city-tampa.opendata.arcgis.com',
    status: 'pending'
  },
  {
    name: 'Bakersfield, CA',
    originalUrl: 'https://bakersfielddatalibrary-cob.opendata.arcgis.com/datasets/city-council-wards.geojson',
    portalUrl: 'bakersfielddatalibrary-cob.opendata.arcgis.com',
    status: 'pending'
  },
  {
    name: 'Anaheim, CA',
    originalUrl: 'https://data-anaheim.opendata.arcgis.com/datasets/65008f112e62422aa2e55d858347e3f7.geojson',
    itemId: '65008f112e62422aa2e55d858347e3f7',
    workingUrl: 'https://gis.anaheim.net/map/rest/services/OpenData2/FeatureServer/46/query?where=1%3D1&outFields=*&f=geojson',
    featureCount: 6,
    status: 'found',
    notes: 'Dataset has GUID item ID, found FeatureServer layer 46'
  },
  {
    name: 'Santa Ana, CA',
    originalUrl: 'https://gis-santa-ana.opendata.arcgis.com/datasets/council-wards.geojson',
    portalUrl: 'gis-santa-ana.opendata.arcgis.com',
    status: 'pending'
  }
];

async function findWorkingUrl(city: CityInvestigation): Promise<void> {
  console.log(`\n===== ${city.name} =====`);

  if (city.status === 'found') {
    console.log(`✅ Already found: ${city.workingUrl}`);
    console.log(`Features: ${city.featureCount}`);
    return;
  }

  // If we have an item ID, try to get metadata from ArcGIS Online
  if (city.itemId) {
    try {
      const metadataUrl = `https://www.arcgis.com/sharing/rest/content/items/${city.itemId}?f=json`;
      const response = await fetch(metadataUrl);
      const data = await response.json();

      if (data.url && data.url.includes('FeatureServer')) {
        const queryUrl = `${data.url}/0/query?where=1%3D1&outFields=*&f=geojson`;
        const queryResp = await fetch(queryUrl);

        if (queryResp.ok) {
          const geojson = await queryResp.json();
          city.workingUrl = queryUrl;
          city.featureCount = geojson.features?.length || 0;
          city.status = geojson.features?.length > 0 ? 'found' : 'empty_dataset';
          console.log(`✅ Found via item metadata: ${queryUrl}`);
          console.log(`Features: ${city.featureCount}`);
          return;
        }
      }
    } catch (error) {
      console.log(`Error fetching item metadata: ${error.message}`);
    }
  }

  console.log(`⚠️  Manual investigation needed for ${city.name}`);
  console.log(`Portal: ${city.portalUrl}`);
  console.log(`Approach: Search portal for dataset, extract item ID, query FeatureServer`);
}

async function main() {
  console.log('========================================');
  console.log('INVESTIGATION: 403 Forbidden Errors');
  console.log('========================================\n');

  console.log('ROOT CAUSE:');
  console.log('Direct .geojson dataset URLs (e.g., /datasets/name.geojson) are deprecated');
  console.log('in ArcGIS Hub. All 7 cities return identical 403 responses.\n');

  console.log('SOLUTION:');
  console.log('1. Find dataset item ID from portal search');
  console.log('2. Get FeatureServer URL from ArcGIS Online item metadata');
  console.log('3. Query FeatureServer with: /query?where=1%3D1&outFields=*&f=geojson\n');

  for (const city of cities) {
    await findWorkingUrl(city);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n========================================');
  console.log('SUMMARY');
  console.log('========================================\n');

  const found = cities.filter(c => c.status === 'found');
  const pending = cities.filter(c => c.status === 'pending');

  console.log(`Found: ${found.length}/7`);
  console.log(`Pending: ${pending.length}/7\n`);

  if (found.length > 0) {
    console.log('WORKING URLS:');
    found.forEach(c => {
      console.log(`\n${c.name}:`);
      console.log(`  ${c.workingUrl}`);
      console.log(`  Features: ${c.featureCount}`);
    });
  }

  if (pending.length > 0) {
    console.log('\nREMAINING WORK:');
    pending.forEach(c => {
      console.log(`\n${c.name}:`);
      console.log(`  1. Visit: https://${c.portalUrl}/search?q=council`);
      console.log(`  2. Find dataset and extract item ID from URL`);
      console.log(`  3. Query: https://www.arcgis.com/sharing/rest/content/items/{ITEM_ID}?f=json`);
      console.log(`  4. Use .url field + /0/query?where=1%3D1&outFields=*&f=geojson`);
    });
  }
}

main().catch(console.error);
