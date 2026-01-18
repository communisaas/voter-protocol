#!/usr/bin/env npx tsx
/**
 * Debug NYC borough boundaries and council districts
 */

import * as turf from '@turf/turf';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import { MunicipalBoundaryResolver } from '../src/validators/council/municipal-boundary.js';

async function debugBoroughs() {
  const url = 'https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services/NYC_Borough_Boundary/FeatureServer/0/query?where=1=1&outFields=*&returnGeometry=true&f=geojson';
  const response = await fetch(url);
  const data = await response.json();

  console.log('=== Individual Borough Areas (raw) ===');
  for (const feature of data.features) {
    const name = feature.properties.BoroName;
    const area = turf.area(feature);
    const areaSqMi = area / 2589988.11;
    console.log(`${name}: ${areaSqMi.toFixed(2)} sq mi (area might be negative if winding wrong)`);
  }

  console.log('\n=== Using turf.rewind with mutate ===');
  const rewoundFeatures: Feature<Polygon | MultiPolygon>[] = [];
  for (const feature of data.features) {
    // Clone the feature to avoid mutation issues
    const cloned = JSON.parse(JSON.stringify(feature));
    const rewound = turf.rewind(cloned, { reverse: false, mutate: true });
    const name = feature.properties.BoroName;
    const area = turf.area(rewound);
    const areaSqMi = area / 2589988.11;
    console.log(`${name}: ${areaSqMi.toFixed(2)} sq mi (${area.toFixed(0)} sq m)`);
    rewoundFeatures.push(rewound);
  }

  console.log('\n=== Computing union ===');
  let unionGeom = rewoundFeatures[0];
  for (let i = 1; i < rewoundFeatures.length; i++) {
    try {
      const union = turf.union(turf.featureCollection([unionGeom, rewoundFeatures[i]]));
      if (union) unionGeom = union as Feature<Polygon | MultiPolygon>;
    } catch (e) {
      console.log(`Union failed at ${i}:`, e);
    }
  }
  const unionArea = turf.area(unionGeom);
  console.log(`Union area: ${(unionArea / 2589988.11).toFixed(2)} sq mi (${unionArea.toFixed(0)} sq m)`);

  console.log('\n=== Testing MunicipalBoundaryResolver ===');
  const resolver = new MunicipalBoundaryResolver();
  const result = await resolver.resolve('3651000');
  console.log('Source:', result.source);
  console.log('Success:', result.success);
  if (result.boundary) {
    const geomArea = turf.area(result.boundary.geometry);
    console.log('Geometry area:', (geomArea / 2589988.11).toFixed(2), 'sq mi');
    console.log('Land area (config):', (result.boundary.landAreaSqM / 2589988.11).toFixed(2), 'sq mi');
  }
  if (result.error) console.log('Error:', result.error);
}

debugBoroughs().catch(console.error);
