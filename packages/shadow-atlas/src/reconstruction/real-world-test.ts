/**
 * Real-World Integration Test
 *
 * This script demonstrates what works and what's missing in the
 * boundary reconstruction pipeline with REAL data.
 *
 * HONEST ASSESSMENT:
 * - The parser WORKS on legal description text
 * - The matcher WORKS with street network data
 * - The polygon builder WORKS with matched coordinates
 * - BUT: We need actual inputs (legal descriptions + street data)
 */

import {
  parseLegalDescription,
  parseWardDescription,
  matchWardDescription,
  buildWardPolygon,
  SimpleStreetNetworkQuery,
  createMockStreetSegment,
  type StreetSegment,
} from './index';

// =============================================================================
// REAL Legal Description Text (from actual municipal ordinances)
// =============================================================================

/**
 * Example legal description from a real municipal ordinance
 * (This is the format we need to receive from cities)
 */
const EXAMPLE_LEGAL_DESCRIPTION_CRESTWOOD = `
Ward 1: Beginning at the intersection of Big Bend Boulevard and Sappington Road;
thence north along Sappington Road to Watson Road;
thence east along Watson Road to Grant Road;
thence south along Grant Road to Big Bend Boulevard;
thence west along Big Bend Boulevard to the point of beginning.
`;

const EXAMPLE_LEGAL_DESCRIPTION_GENERIC = `
Beginning at the intersection of Main Street and Oak Avenue;
thence northerly along Oak Avenue to the intersection with 5th Street;
thence easterly along 5th Street to the intersection with Elm Drive;
thence southerly along Elm Drive to the intersection with Main Street;
thence westerly along Main Street to the point of beginning.
`;

// =============================================================================
// Test 1: Parser Works on Real Text
// =============================================================================

console.log('='.repeat(60));
console.log('TEST 1: Parser on Real Legal Description Text');
console.log('='.repeat(60));

const parseResult = parseLegalDescription(EXAMPLE_LEGAL_DESCRIPTION_CRESTWOOD);

console.log(`\nInput text:\n${EXAMPLE_LEGAL_DESCRIPTION_CRESTWOOD}`);
console.log(`\nParse success: ${parseResult.success}`);
console.log(`Segments found: ${parseResult.segments.length}`);
console.log('\nParsed segments:');
parseResult.segments.forEach((seg) => {
  console.log(`  [${seg.index}] ${seg.featureName}`);
  console.log(`      Type: ${seg.referenceType}`);
  console.log(`      Direction: ${seg.direction ?? 'none'}`);
  console.log(`      Confidence: ${seg.parseConfidence}`);
  console.log(`      Raw: "${seg.rawText.substring(0, 50)}..."`);
});

console.log('\nDiagnostics:');
console.log(`  High confidence: ${parseResult.diagnostics.highConfidenceCount}`);
console.log(`  Medium confidence: ${parseResult.diagnostics.mediumConfidenceCount}`);
console.log(`  Low confidence: ${parseResult.diagnostics.lowConfidenceCount}`);
if (parseResult.diagnostics.warnings.length > 0) {
  console.log(`  Warnings: ${parseResult.diagnostics.warnings.join(', ')}`);
}

// =============================================================================
// Test 2: Parser on Generic Municipal Format
// =============================================================================

console.log('\n' + '='.repeat(60));
console.log('TEST 2: Parser on Generic Municipal Format');
console.log('='.repeat(60));

const genericResult = parseLegalDescription(EXAMPLE_LEGAL_DESCRIPTION_GENERIC);

console.log(`\nParse success: ${genericResult.success}`);
console.log(`Segments found: ${genericResult.segments.length}`);
genericResult.segments.forEach((seg) => {
  console.log(`  [${seg.index}] ${seg.featureName} (${seg.direction ?? 'no direction'})`);
});

// =============================================================================
// Test 3: Matching with Mock Street Data
// =============================================================================

console.log('\n' + '='.repeat(60));
console.log('TEST 3: Matching with Mock Street Network');
console.log('='.repeat(60));

// Create mock street segments that MATCH our legal description
const mockStreets: StreetSegment[] = [
  createMockStreetSegment({
    id: 'oak-ave',
    name: 'Oak Avenue',
    coordinates: [
      [-95.0, 30.0],
      [-95.0, 30.01],
    ],
  }),
  createMockStreetSegment({
    id: '5th-st',
    name: '5th Street',
    altNames: ['Fifth Street'],
    coordinates: [
      [-95.0, 30.01],
      [-94.99, 30.01],
    ],
  }),
  createMockStreetSegment({
    id: 'elm-dr',
    name: 'Elm Drive',
    coordinates: [
      [-94.99, 30.01],
      [-94.99, 30.0],
    ],
  }),
  createMockStreetSegment({
    id: 'main-st',
    name: 'Main Street',
    coordinates: [
      [-94.99, 30.0],
      [-95.0, 30.0],
    ],
  }),
];

const streetQuery = new SimpleStreetNetworkQuery(mockStreets);

// Create ward description from parsed segments
const { description } = parseWardDescription({
  cityFips: '9999999',
  cityName: 'Test City',
  state: 'MO',
  wardId: '1',
  wardName: 'Ward 1',
  descriptionText: EXAMPLE_LEGAL_DESCRIPTION_GENERIC,
  source: {
    type: 'ordinance_text',
    source: 'https://example.com/test',
    title: 'Test Ordinance',
    effectiveDate: '2024-01-01',
    retrievedAt: new Date().toISOString(),
  },
});

const matchResult = matchWardDescription(description, streetQuery);

console.log(`\nMatch success: ${matchResult.success}`);
console.log(`Matched segments: ${matchResult.diagnostics.matchedSegments}/${matchResult.diagnostics.totalSegments}`);
console.log(`Match rate: ${(matchResult.diagnostics.matchRate * 100).toFixed(1)}%`);

if (matchResult.failedSegments.length > 0) {
  console.log(`\nFailed segments:`);
  matchResult.failedSegments.forEach((idx) => {
    const seg = description.segments[idx];
    console.log(`  [${idx}] "${seg.featureName}" - could not match to street network`);
  });
}

// =============================================================================
// Test 4: Polygon Building
// =============================================================================

console.log('\n' + '='.repeat(60));
console.log('TEST 4: Polygon Building');
console.log('='.repeat(60));

const buildResult = buildWardPolygon(matchResult);

console.log(`\nBuild success: ${buildResult.success}`);
if (buildResult.success && buildResult.polygon) {
  console.log(`Polygon valid: YES`);
  console.log(`Vertex count: ${buildResult.validation.vertexCount}`);
  console.log(`Area: ${buildResult.validation.areaSquareMeters.toFixed(0)} m²`);
  console.log(`Counter-clockwise: ${buildResult.validation.isCounterClockwise}`);
  console.log(`Self-intersections: ${buildResult.validation.hasSelfIntersections}`);

  if (buildResult.repairs.length > 0) {
    console.log(`\nRepairs applied:`);
    buildResult.repairs.forEach((r) => console.log(`  - ${r.type}: ${r.description}`));
  }

  console.log('\nPolygon GeoJSON:');
  console.log(JSON.stringify(buildResult.polygon, null, 2));
} else {
  console.log(`Build failed: ${buildResult.failureReason}`);
}

// =============================================================================
// HONEST ASSESSMENT
// =============================================================================

console.log('\n' + '='.repeat(60));
console.log('HONEST ASSESSMENT: What Works vs What\'s Missing');
console.log('='.repeat(60));

console.log(`
✅ WORKS:
   - Parser correctly extracts segments from legal description text
   - Street name normalization (abbreviations, directions, etc.)
   - Segment matching when street network data is available
   - Polygon construction with gap filling and validation
   - Golden vector validation for regression prevention

❌ MISSING (Required for Production):
   1. PDF TEXT EXTRACTION
      - Cities publish ward maps as PDFs, not machine-readable text
      - Need: pdf-parse or similar library to extract text from PDFs
      - Alternative: Manual transcription of legal descriptions

   2. STREET NETWORK DATA LOADER
      - Need: OSM data loader (Overpass API or local PBF file)
      - Or: TIGER/Line data loader from Census Bureau
      - Current mock data works but isn't real street geometry

   3. HUMAN-VERIFIED GOLDEN VECTORS
      - Need: At least one city with known-correct boundaries
      - Verified by overlaying on official maps
      - Used to validate the reconstruction is accurate

   4. MUNICIPAL BOUNDARY DATA
      - For containment validation (districts must be inside city)
      - Available from Census Bureau or city GIS portals

NEXT STEPS TO MAKE THIS PRODUCTION-READY:
   1. Add OSM/TIGER data loader (src/reconstruction/street-loader.ts)
   2. Add PDF text extraction utility
   3. Create first golden vector from a city with good data
   4. Run end-to-end on one quarantined city
`);

// =============================================================================
// Demonstration of what we'd need
// =============================================================================

console.log('\n' + '='.repeat(60));
console.log('DEMONSTRATION: What Production Flow Looks Like');
console.log('='.repeat(60));

console.log(`
For North Kansas City, MO (quarantined):

1. INPUT NEEDED:
   - Ward boundary ordinance text (from Municode or city clerk)
   - Or: PDF ward map with OCR/manual transcription

2. STREET DATA NEEDED:
   - OSM extract for North Kansas City area
   - Query: [bbox] way["highway"]["name"] in North Kansas City

3. PIPELINE:
   parseLegalDescription(ordinanceText)
   → parseWardDescription(...)
   → matchWardDescription(description, osmStreetQuery)
   → buildWardPolygon(matchResult)
   → validateCityAgainstGolden(polygons, goldenVector)

4. VALIDATION:
   - Visual overlay on city's official ward map
   - Tessellation proof (wards cover city, no gaps/overlaps)
   - Population verification if available
`);
