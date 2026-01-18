#!/usr/bin/env npx tsx
/**
 * Debug San Francisco supervisor district coverage
 */

import * as turf from '@turf/turf';
import type { Feature, Polygon, MultiPolygon, FeatureCollection } from 'geojson';

async function debugSFCoverage() {
  console.log('=== San Francisco Coverage Debug ===\n');

  // 1. Fetch TIGER boundary
  console.log('1. Fetching TIGER boundary...');
  const tigerUrl = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/28/query?where=GEOID=%270667000%27&outFields=GEOID,NAME,AREALAND,AREAWATER&f=geojson&outSR=4326&returnGeometry=true";
  const tigerResp = await fetch(tigerUrl);
  const tigerData = await tigerResp.json();

  const areaLand = tigerData.features[0].properties.AREALAND;
  const areaWater = tigerData.features[0].properties.AREAWATER;
  console.log(`   AREALAND: ${(areaLand / 2589988.11).toFixed(2)} sq mi`);
  console.log(`   AREAWATER: ${(areaWater / 2589988.11).toFixed(2)} sq mi`);
  console.log(`   Water ratio: ${((areaWater / (areaLand + areaWater)) * 100).toFixed(1)}%`);

  // 2. Fetch supervisor districts
  console.log('\n2. Fetching supervisor districts...');
  const districtUrl = 'https://data.sfgov.org/api/geospatial/f2zs-jevy?method=export&format=GeoJSON';
  const districtResp = await fetch(districtUrl);
  const districtData = await districtResp.json() as FeatureCollection<Polygon | MultiPolygon>;
  console.log(`   Found ${districtData.features.length} districts`);

  // Rewind and compute union
  const rewoundDistricts = districtData.features.map(f =>
    turf.rewind(f as Feature<Polygon | MultiPolygon>, { reverse: false, mutate: false })
  );

  // 3. Compute district union
  console.log('\n3. Computing district union...');
  let districtUnion = rewoundDistricts[0] as Feature<Polygon | MultiPolygon>;
  for (let i = 1; i < rewoundDistricts.length; i++) {
    try {
      const union = turf.union(turf.featureCollection([districtUnion, rewoundDistricts[i] as Feature<Polygon | MultiPolygon>]));
      if (union) districtUnion = union as Feature<Polygon | MultiPolygon>;
    } catch (e) {
      console.log(`   Union failed at district ${i}:`, e);
    }
  }
  const unionArea = turf.area(districtUnion);
  console.log(`   District union area: ${(unionArea / 2589988.11).toFixed(2)} sq mi`);

  // 4. Coverage ratios
  console.log('\n4. Coverage calculations...');
  console.log(`   vs AREALAND: ${((unionArea / areaLand) * 100).toFixed(1)}%`);
  console.log(`   vs total (land+water): ${((unionArea / (areaLand + areaWater)) * 100).toFixed(1)}%`);

  // 5. Individual district areas
  console.log('\n5. Individual district areas:');
  for (const f of districtData.features) {
    const area = turf.area(turf.rewind(f as Feature<Polygon | MultiPolygon>, { reverse: false }));
    const props = f.properties || {};
    const name = props.supervisor || props.district || props.name || 'Unknown';
    console.log(`   District ${name}: ${(area / 2589988.11).toFixed(2)} sq mi`);
  }

  console.log('\n=== Analysis Complete ===');
}

debugSFCoverage().catch(console.error);
