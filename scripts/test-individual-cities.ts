#!/usr/bin/env tsx
/**
 * Test Individual City URLs
 *
 * Manual testing script for validating individual city data sources
 */

import type { FeatureCollection } from 'geojson';

// Test individual URLs
const TESTS = [
  // NYC - Try different Socrata endpoints
  {
    name: 'NYC (Socrata resource)',
    url: 'https://data.cityofnewyork.us/resource/yusd-j4xi.geojson',
  },
  {
    name: 'NYC (Socrata $limit)',
    url: 'https://data.cityofnewyork.us/resource/yusd-j4xi.geojson?$limit=100',
  },

  // Chicago - Try resource API
  {
    name: 'Chicago (2023- wards, resource)',
    url: 'https://data.cityofchicago.org/resource/p293-wvbd.geojson',
  },
  {
    name: 'Chicago (2023- wards, $limit)',
    url: 'https://data.cityofchicago.org/resource/p293-wvbd.geojson?$limit=100',
  },

  // Houston - Try ArcGIS Hub directly
  {
    name: 'Houston (Hub datasets)',
    url: 'https://houston-mycity.opendata.arcgis.com/datasets/MyCity::council-districts-2.geojson',
  },

  // San Francisco - Try resource API
  {
    name: 'SF (Socrata resource)',
    url: 'https://data.sfgov.org/resource/8br2-hhp3.geojson',
  },
  {
    name: 'SF (Socrata $limit)',
    url: 'https://data.sfgov.org/resource/8br2-hhp3.geojson?$limit=50',
  },

  // Boston - Try alternatives
  {
    name: 'Boston (Hub alternative)',
    url: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::boston-city-council-districts.geojson',
  },

  // Nashville - Try resource API
  {
    name: 'Nashville (Socrata resource)',
    url: 'https://data.nashville.gov/resource/33vb-9k5x.geojson',
  },
  {
    name: 'Nashville (Socrata $limit)',
    url: 'https://data.nashville.gov/resource/33vb-9k5x.geojson?$limit=50',
  },

  // Indianapolis - Try resource API
  {
    name: 'Indianapolis (Socrata resource)',
    url: 'https://data.indy.gov/resource/jega-weah.geojson',
  },

  // Columbus - Try resource API
  {
    name: 'Columbus (Socrata resource)',
    url: 'https://opendata.columbus.gov/resource/jvzr-aix5.geojson',
  },

  // San Jose - Try alternative parameters
  {
    name: 'San Jose (FeatureServer, proper params)',
    url: 'https://services2.arcgis.com/ZOTjmjTI5x3fDhgu/arcgis/rest/services/Council_District/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',
  },

  // San Diego - Try Hub direct
  {
    name: 'San Diego (Hub datasets)',
    url: 'https://seshat.datasd.org/sde/council_districts_datasd/council_districts_datasd.geojson',
  },

  // Jacksonville - Try proper FeatureServer params
  {
    name: 'Jacksonville (proper params)',
    url: 'https://services1.arcgis.com/BZIHPcurx7WYzGO9/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',
  },

  // Fort Worth - Try proper params
  {
    name: 'Fort Worth (proper params)',
    url: 'https://services.arcgis.com/rXQ5DsS3x6vPGLbH/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',
  },

  // Charlotte - Try alternative
  {
    name: 'Charlotte (alternative server)',
    url: 'https://services11.arcgis.com/l17mST0f8rzZbPSN/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',
  },

  // Denver - Try Hub
  {
    name: 'Denver (Hub datasets)',
    url: 'https://services6.arcgis.com/EgOTffWWiI6rP8I0/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',
  },

  // Detroit - Try alternative
  {
    name: 'Detroit (proper params)',
    url: 'https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',
  },

  // Baltimore - Try proper params
  {
    name: 'Baltimore (proper params)',
    url: 'https://services1.arcgis.com/UWYHeuuJISiGmgXx/arcgis/rest/services/Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',
  },

  // Milwaukee - Try resource API
  {
    name: 'Milwaukee (Socrata resource)',
    url: 'https://data.milwaukee.gov/resource/iiyb-gt46.geojson',
  },

  // Louisville - Try resource API
  {
    name: 'Louisville (Socrata resource)',
    url: 'https://data.louisvilleky.gov/resource/d7mp-qqv7.geojson',
  },

  // Sacramento - Try proper params
  {
    name: 'Sacramento (proper params)',
    url: 'https://services5.arcgis.com/54falWtcownV47fY/arcgis/rest/services/Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',
  },

  // Atlanta - Try proper params
  {
    name: 'Atlanta (proper params)',
    url: 'https://services3.arcgis.com/b0yKxa3u9jKjbBvd/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',
  },

  // Colorado Springs - Try proper params
  {
    name: 'Colorado Springs (proper params)',
    url: 'https://services1.arcgis.com/u6hEGkHc28KiX8Oy/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',
  },

  // Miami - Try proper params
  {
    name: 'Miami (proper params)',
    url: 'https://services.arcgis.com/8Pc9XBTAsYuxx47A/arcgis/rest/services/City_Commission_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',
  },

  // Oakland - Try resource API
  {
    name: 'Oakland (Socrata resource)',
    url: 'https://data.oaklandca.gov/resource/fqyc-6bm8.geojson',
  },

  // Tampa - Try proper params
  {
    name: 'Tampa (proper params)',
    url: 'https://services2.arcgis.com/ApTQd8QLScspkK8t/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',
  },

  // New Orleans - Try resource API
  {
    name: 'New Orleans (Socrata resource)',
    url: 'https://data.nola.gov/resource/58m8-p79g.geojson',
  },
];

async function testUrl(name: string, url: string): Promise<void> {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.log(`❌ ${name}: HTTP ${response.status} ${response.statusText}`);
      return;
    }

    const data = (await response.json()) as FeatureCollection;

    if (!data.features || !Array.isArray(data.features)) {
      console.log(`❌ ${name}: Invalid GeoJSON (missing features)`);
      return;
    }

    const count = data.features.length;
    const fields = data.features[0]?.properties ? Object.keys(data.features[0].properties).slice(0, 5) : [];

    console.log(`✅ ${name}: ${count} features, fields: [${fields.join(', ')}...]`);
  } catch (error) {
    console.log(`❌ ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  console.log('Testing individual city URLs...\n');

  for (const test of TESTS) {
    await testUrl(test.name, test.url);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
