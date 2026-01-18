#!/usr/bin/env npx tsx
/**
 * Debug Austin council district coverage
 */

import * as turf from '@turf/turf';
import type { Feature, Polygon, MultiPolygon, FeatureCollection } from 'geojson';

async function debugAustinCoverage() {
  console.log('=== Austin Council District Coverage Debug ===\n');

  // 1. Fetch TIGER boundary (city limits)
  console.log('1. Fetching TIGER boundary...');
  const tigerUrl =
    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/28/query?where=GEOID=%274805000%27&outFields=GEOID,NAME,AREALAND,AREAWATER&f=geojson&outSR=4326&returnGeometry=true';
  const tigerResp = await fetch(tigerUrl);
  const tigerData = await tigerResp.json();
  const tigerBoundary = tigerData.features[0] as Feature<Polygon | MultiPolygon>;
  const tigerArea = turf.area(tigerBoundary);
  console.log(`   TIGER area: ${(tigerArea / 2589988.11).toFixed(2)} sq mi`);

  // 2. Fetch council districts (using Council_Districts layer, not BOUNDARIES_single_member_districts)
  console.log('\n2. Fetching council districts...');
  const districtUrl =
    'https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/Council_Districts/FeatureServer/0/query?where=1=1&outFields=*&returnGeometry=true&f=geojson';
  const districtResp = await fetch(districtUrl);
  const districtData = (await districtResp.json()) as FeatureCollection<Polygon | MultiPolygon>;
  console.log(`   Found ${districtData.features.length} districts`);

  // Rewind all features
  const rewoundDistricts = districtData.features.map((f) =>
    turf.rewind(f as Feature<Polygon | MultiPolygon>, { reverse: false, mutate: false })
  );

  // 3. Compute district union
  console.log('\n3. Computing district union...');
  let districtUnion = rewoundDistricts[0] as Feature<Polygon | MultiPolygon>;
  for (let i = 1; i < rewoundDistricts.length; i++) {
    try {
      const union = turf.union(
        turf.featureCollection([districtUnion, rewoundDistricts[i] as Feature<Polygon | MultiPolygon>])
      );
      if (union) districtUnion = union as Feature<Polygon | MultiPolygon>;
    } catch (e) {
      console.log(`   Union failed at district ${i}:`, e);
    }
  }
  const unionArea = turf.area(districtUnion);
  console.log(`   District union area: ${(unionArea / 2589988.11).toFixed(2)} sq mi`);

  // 4. Compute intersection
  console.log('\n4. Computing intersection (districts ∩ city)...');
  try {
    const rewoundTiger = turf.rewind(tigerBoundary, { reverse: false, mutate: false });
    const intersection = turf.intersect(
      turf.featureCollection([districtUnion, rewoundTiger as Feature<Polygon | MultiPolygon>])
    );
    if (intersection) {
      const intersectArea = turf.area(intersection);
      console.log(`   Intersection area: ${(intersectArea / 2589988.11).toFixed(2)} sq mi`);
      console.log(`   Coverage: ${((intersectArea / tigerArea) * 100).toFixed(2)}%`);
    } else {
      console.log('   ERROR: Intersection is null (geometries may not overlap)');
    }
  } catch (e) {
    console.log('   Intersection failed:', e);
  }

  // 5. Check if city is contained within district union
  console.log('\n5. Checking containment...');
  try {
    const rewoundTiger = turf.rewind(tigerBoundary, { reverse: false, mutate: false });
    const cityCenter = turf.centroid(rewoundTiger);
    const isContained = turf.booleanPointInPolygon(cityCenter.geometry.coordinates, districtUnion.geometry);
    console.log(`   City center in district union: ${isContained}`);

    // Check city bbox vs district union bbox
    const cityBbox = turf.bbox(rewoundTiger);
    const districtBbox = turf.bbox(districtUnion);
    console.log(`   City bbox: [${cityBbox.map((n) => n.toFixed(4)).join(', ')}]`);
    console.log(`   District bbox: [${districtBbox.map((n) => n.toFixed(4)).join(', ')}]`);
  } catch (e) {
    console.log('   Containment check failed:', e);
  }

  console.log('\n=== Analysis Complete ===');
}

debugAustinCoverage().catch(console.error);
