/**
 * Debug: Why streets aren't found
 */

import {
  getCityBoundingBox,
  loadStreetNetworkFromOSM,
  SimpleStreetNetworkQuery,
  parseLegalDescription,
  parseWardDescription,
  matchWardDescription,
  buildWardPolygon,
} from './index';

async function debug(): Promise<void> {
  console.log('DEBUG: Investigating why Crestwood streets not found\n');

  // Step 1: Check the bounding box
  const bbox = await getCityBoundingBox('Crestwood', 'MO');
  console.log('Nominatim bbox for Crestwood, MO:');
  console.log(`  minLon: ${bbox[0]}, minLat: ${bbox[1]}`);
  console.log(`  maxLon: ${bbox[2]}, maxLat: ${bbox[3]}`);
  console.log(`  Width: ${((bbox[2] - bbox[0]) * 111).toFixed(2)} km`);
  console.log(`  Height: ${((bbox[3] - bbox[1]) * 111).toFixed(2)} km`);

  // Step 2: Use the actual bbox but with expanded highway types
  console.log('\nUsing city bbox with expanded highway types...');
  const expandedBbox: [number, number, number, number] = [
    bbox[0] - 0.02, // Expand by ~2km
    bbox[1] - 0.02,
    bbox[2] + 0.02,
    bbox[3] + 0.02,
  ];

  const streets = await loadStreetNetworkFromOSM({
    bbox: expandedBbox,
    timeout: 45000,
  });
  console.log(`Loaded ${streets.length} streets from larger area`);

  // Check for our target streets
  const targets = ['Sappington Road', 'Watson Road', 'Grant Road', 'Big Bend Boulevard', 'Big Bend'];
  console.log('\nSearching for target streets:');

  for (const target of targets) {
    const matches = streets.filter((s) =>
      s.name.toLowerCase().includes(target.toLowerCase().replace(' road', '').replace(' boulevard', ''))
    );
    if (matches.length > 0) {
      console.log(`  ✅ Found ${matches.length} matches for "${target}":`);
      matches.slice(0, 3).forEach((m) => console.log(`     - ${m.name}`));
    } else {
      console.log(`  ❌ No matches for "${target}"`);
    }
  }

  // Step 3: List all unique street names
  const uniqueNames = [...new Set(streets.map((s) => s.name))].sort();
  console.log(`\nUnique street names (${uniqueNames.length} total):`);
  uniqueNames.slice(0, 30).forEach((n) => console.log(`  - ${n}`));

  // Step 4: Try matching with the larger dataset
  console.log('\n--- Attempting match with larger street dataset ---');

  const CRESTWOOD_WARD_1 = `
Beginning at the intersection of Big Bend Boulevard and Sappington Road;
thence north along Sappington Road to Watson Road;
thence east along Watson Road to Grant Road;
thence south along Grant Road to Big Bend Boulevard;
thence west along Big Bend Boulevard to the point of beginning.
`;

  const { description } = parseWardDescription({
    cityFips: '2917218',
    cityName: 'Crestwood',
    state: 'MO',
    wardId: '1',
    wardName: 'Ward 1',
    descriptionText: CRESTWOOD_WARD_1,
    source: {
      type: 'ordinance_text',
      source: 'test',
      title: 'Test',
      effectiveDate: '2024-01-01',
      retrievedAt: new Date().toISOString(),
    },
  });

  const query = new SimpleStreetNetworkQuery(streets);
  const matchResult = matchWardDescription(description, query);

  console.log(`\nMatch rate: ${(matchResult.diagnostics.matchRate * 100).toFixed(1)}%`);
  matchResult.segmentMatches.forEach((m, i) => {
    console.log(`  [${i}] ${m.description.featureName}: ${m.matchQuality}`);
    if (m.matchedSegments.length > 0) {
      console.log(`       → ${m.matchedSegments[0].name}`);
    }
  });

  if (matchResult.success) {
    const buildResult = buildWardPolygon(matchResult);
    console.log(`\nPolygon built: ${buildResult.success}`);
    if (buildResult.polygon) {
      console.log(JSON.stringify(buildResult.polygon.geometry, null, 2));
    }
  }
}

debug().catch(console.error);
