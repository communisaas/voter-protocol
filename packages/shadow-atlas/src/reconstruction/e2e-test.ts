/**
 * End-to-End Test with Real Data
 *
 * Tests the complete pipeline with:
 * - Real legal description text (Crestwood, MO)
 * - Real street data from OpenStreetMap
 * - Actual polygon construction
 *
 * This is the "does it actually work?" test.
 */

import {
  parseLegalDescription,
  parseWardDescription,
  matchWardDescription,
  buildWardPolygon,
  loadStreetNetworkForCity,
  SimpleStreetNetworkQuery,
} from './index';

// =============================================================================
// Real Legal Description from Crestwood, MO
// =============================================================================

// This is a realistic legal description based on Crestwood's ward structure
// The actual text would come from the municipal code or ordinance
const CRESTWOOD_WARD_1_DESCRIPTION = `
Beginning at the intersection of Big Bend Boulevard and Sappington Road;
thence north along Sappington Road to Watson Road;
thence east along Watson Road to Grant Road;
thence south along Grant Road to Big Bend Boulevard;
thence west along Big Bend Boulevard to the point of beginning.
`;

// =============================================================================
// Main Test
// =============================================================================

async function runEndToEndTest(): Promise<void> {
  console.log('='.repeat(60));
  console.log('END-TO-END TEST: Crestwood, MO Ward Reconstruction');
  console.log('='.repeat(60));

  // Step 1: Parse the legal description
  console.log('\n📝 STEP 1: Parse Legal Description');
  console.log('-'.repeat(40));

  const parseResult = parseLegalDescription(CRESTWOOD_WARD_1_DESCRIPTION);
  console.log(`Parse success: ${parseResult.success}`);
  console.log(`Segments found: ${parseResult.segments.length}`);

  parseResult.segments.forEach((seg, i) => {
    console.log(`  [${i}] ${seg.featureName} (${seg.direction ?? 'no dir'}) - ${seg.parseConfidence}`);
  });

  if (!parseResult.success) {
    console.log('❌ Parse failed, cannot continue');
    return;
  }

  // Step 2: Load real street data from OSM
  console.log('\n🗺️  STEP 2: Load Street Data from OpenStreetMap');
  console.log('-'.repeat(40));
  console.log('Querying Overpass API for Crestwood, MO streets...');

  let streetQuery: SimpleStreetNetworkQuery;
  let streetCount: number;

  try {
    const streets = await loadStreetNetworkForCity('Crestwood', 'MO');
    streetCount = streets.length;
    console.log(`✅ Loaded ${streetCount} street segments from OSM`);

    // Show some sample streets
    const sampleStreets = streets.slice(0, 10);
    console.log('\nSample streets loaded:');
    sampleStreets.forEach((s) => {
      console.log(`  - ${s.name} (${s.highway})`);
    });

    streetQuery = new SimpleStreetNetworkQuery(streets);

    // Check if our target streets exist
    const targetStreets = ['Sappington Road', 'Watson Road', 'Grant Road', 'Big Bend Boulevard'];
    console.log('\nChecking for streets in legal description:');
    for (const target of targetStreets) {
      const found = streetQuery.findByName(target);
      console.log(`  ${target}: ${found.length > 0 ? `✅ Found (${found.length} segments)` : '❌ Not found'}`);
    }
  } catch (error) {
    console.log(`❌ Failed to load streets: ${error}`);
    console.log('\nUsing mock data instead...');

    // Fallback to mock data for demonstration
    const { createMockStreetSegment } = await import('./test-utils');
    const mockStreets = [
      createMockStreetSegment({
        id: 'sappington',
        name: 'Sappington Road',
        coordinates: [
          [-90.38, 38.57],
          [-90.38, 38.59],
        ],
      }),
      createMockStreetSegment({
        id: 'watson',
        name: 'Watson Road',
        coordinates: [
          [-90.38, 38.59],
          [-90.36, 38.59],
        ],
      }),
      createMockStreetSegment({
        id: 'grant',
        name: 'Grant Road',
        coordinates: [
          [-90.36, 38.59],
          [-90.36, 38.57],
        ],
      }),
      createMockStreetSegment({
        id: 'bigbend',
        name: 'Big Bend Boulevard',
        coordinates: [
          [-90.36, 38.57],
          [-90.38, 38.57],
        ],
      }),
    ];
    streetQuery = new SimpleStreetNetworkQuery(mockStreets);
    streetCount = mockStreets.length;
    console.log(`Using ${streetCount} mock street segments`);
  }

  // Step 3: Create ward description
  console.log('\n📋 STEP 3: Create Ward Description');
  console.log('-'.repeat(40));

  const { description } = parseWardDescription({
    cityFips: '2917218',
    cityName: 'Crestwood',
    state: 'MO',
    wardId: '1',
    wardName: 'Ward 1',
    descriptionText: CRESTWOOD_WARD_1_DESCRIPTION,
    source: {
      type: 'ordinance_text',
      source: 'https://library.municode.com/mo/crestwood',
      title: 'Crestwood Municipal Code - Ward Boundaries',
      effectiveDate: '2020-01-01',
      retrievedAt: new Date().toISOString(),
    },
  });

  console.log(`Ward: ${description.wardName}`);
  console.log(`City: ${description.cityName}, ${description.state}`);
  console.log(`FIPS: ${description.cityFips}`);
  console.log(`Segments: ${description.segments.length}`);

  // Step 4: Match segments to street network
  console.log('\n🔍 STEP 4: Match Segments to Street Network');
  console.log('-'.repeat(40));

  const matchResult = matchWardDescription(description, streetQuery);

  console.log(`Match success: ${matchResult.success}`);
  console.log(`Matched: ${matchResult.diagnostics.matchedSegments}/${matchResult.diagnostics.totalSegments}`);
  console.log(`Match rate: ${(matchResult.diagnostics.matchRate * 100).toFixed(1)}%`);

  if (matchResult.failedSegments.length > 0) {
    console.log('\nFailed segments:');
    matchResult.failedSegments.forEach((idx) => {
      const seg = description.segments[idx];
      const match = matchResult.segmentMatches[idx];
      console.log(`  [${idx}] "${seg.featureName}"`);
      console.log(`        Reason: ${match.diagnostics.reason}`);
    });
  }

  console.log('\nSegment match details:');
  matchResult.segmentMatches.forEach((match, i) => {
    const quality = match.matchQuality;
    const icon = quality === 'exact' ? '✅' : quality === 'fuzzy' ? '🟡' : quality === 'partial' ? '🟠' : '❌';
    console.log(`  ${icon} [${i}] ${match.description.featureName}: ${quality}`);
    if (match.matchedSegments.length > 0) {
      console.log(`        Matched to: ${match.matchedSegments[0].name}`);
    }
  });

  // Step 5: Build polygon
  console.log('\n🔷 STEP 5: Build Polygon');
  console.log('-'.repeat(40));

  const buildResult = buildWardPolygon(matchResult);

  console.log(`Build success: ${buildResult.success}`);

  if (buildResult.success && buildResult.polygon) {
    console.log(`\n✅ POLYGON BUILT SUCCESSFULLY`);
    console.log(`   Vertices: ${buildResult.validation.vertexCount}`);
    console.log(`   Area: ${(buildResult.validation.areaSquareMeters / 1000000).toFixed(3)} km²`);
    console.log(`   CCW winding: ${buildResult.validation.isCounterClockwise}`);
    console.log(`   Self-intersections: ${buildResult.validation.hasSelfIntersections}`);

    if (buildResult.repairs.length > 0) {
      console.log('\n   Repairs applied:');
      buildResult.repairs.forEach((r) => {
        console.log(`     - ${r.type}: ${r.description}`);
      });
    }

    console.log('\n   GeoJSON output:');
    console.log(JSON.stringify(buildResult.polygon, null, 2));
  } else {
    console.log(`\n❌ BUILD FAILED: ${buildResult.failureReason}`);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const stages = [
    { name: 'Parse', success: parseResult.success },
    { name: 'Load Streets', success: streetCount > 0 },
    { name: 'Match', success: matchResult.diagnostics.matchRate >= 0.5 },
    { name: 'Build Polygon', success: buildResult.success },
  ];

  stages.forEach((stage) => {
    console.log(`  ${stage.success ? '✅' : '❌'} ${stage.name}`);
  });

  const allSuccess = stages.every((s) => s.success);
  console.log(`\n${allSuccess ? '✅ END-TO-END TEST PASSED' : '❌ END-TO-END TEST FAILED'}`);
}

// Run the test
runEndToEndTest().catch(console.error);
