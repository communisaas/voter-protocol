/**
 * GEOID Validation Example
 *
 * Demonstrates improved validation with specific missing GEOID detection.
 *
 * Run:
 *   npx tsx examples/geoid-validation-example.ts
 */

import {
  TIGERValidator,
  validateGEOIDCompleteness,
  getMissingGEOIDs,
  getExtraGEOIDs,
  getCanonicalGEOIDs,
} from '../src/validators/index.js';
import type { TIGERValidationBoundary } from '../src/validators/index.js';
import { EXPECTED_CD_BY_STATE } from '../src/validators/tiger-expected-counts.js';

// ============================================================================
// Example 1: Complete Data - All Districts Present
// ============================================================================

console.log('='.repeat(80));
console.log('Example 1: Complete Alabama CD data');
console.log('='.repeat(80));

const completeAlabamaData: TIGERValidationBoundary[] = [
  { geoid: '0101', name: 'District 1', geometry: { type: 'Polygon', coordinates: [[]] }, properties: {} },
  { geoid: '0102', name: 'District 2', geometry: { type: 'Polygon', coordinates: [[]] }, properties: {} },
  { geoid: '0103', name: 'District 3', geometry: { type: 'Polygon', coordinates: [[]] }, properties: {} },
  { geoid: '0104', name: 'District 4', geometry: { type: 'Polygon', coordinates: [[]] }, properties: {} },
  { geoid: '0105', name: 'District 5', geometry: { type: 'Polygon', coordinates: [[]] }, properties: {} },
  { geoid: '0106', name: 'District 6', geometry: { type: 'Polygon', coordinates: [[]] }, properties: {} },
  { geoid: '0107', name: 'District 7', geometry: { type: 'Polygon', coordinates: [[]] }, properties: {} },
];

const validator = new TIGERValidator();
const completeResult = validator.validateCompleteness('cd', completeAlabamaData, '01');

console.log(`\n${completeResult.summary}`);
console.log(`Valid: ${completeResult.valid}`);
console.log(`Missing GEOIDs: ${completeResult.missingGEOIDs.join(', ') || 'none'}`);
console.log(`Extra GEOIDs: ${completeResult.extraGEOIDs.join(', ') || 'none'}`);

// ============================================================================
// Example 2: Validate Complete Extraction
// ============================================================================

console.log('\n' + '='.repeat(80));
console.log('Example 2: Validate Complete Extraction');
console.log('='.repeat(80));

// Simulate successful extraction of California congressional districts
const extractedComplete = [...caCongressional];

const validationComplete = validateGEOIDCompleteness(
  '06',
  'congressional',
  extractedComplete
);

console.log(`\n${validationComplete.summary}`);
console.log(`Expected: ${validationComplete.expected}`);
console.log(`Received: ${validationComplete.received}`);
console.log(`Missing:  ${validationComplete.missing.length}`);
console.log(`Extra:    ${validationComplete.unexpected.length}`);

// ============================================================================
// Example 3: Detect Missing Districts
// ============================================================================

console.log('\n' + '='.repeat(80));
console.log('Example 3: Detect Missing Districts');
console.log('='.repeat(80));

// Simulate incomplete extraction (network timeout)
const extractedIncomplete = caCongressional.filter((geoid) => {
  // Simulate missing districts 12, 25, and 40
  return !['0612', '0625', '0640'].includes(geoid);
});

const validationIncomplete = validateGEOIDCompleteness(
  '06',
  'congressional',
  extractedIncomplete
);

console.log(`\n${validationIncomplete.summary}`);
console.log(`Missing GEOIDs: ${validationIncomplete.missing.join(', ')}`);

// ============================================================================
// Example 4: Detect Unexpected Districts
// ============================================================================

console.log('\n' + '='.repeat(80));
console.log('Example 4: Detect Unexpected Districts');
console.log('='.repeat(80));

// Simulate data corruption (wrong state data included)
const extractedCorrupted = [
  ...caCongressional,
  '4801', // Texas district 1
  '3601', // New York district 1
];

const validationCorrupted = validateGEOIDCompleteness(
  '06',
  'congressional',
  extractedCorrupted
);

console.log(`\n${validationCorrupted.summary}`);
console.log(`Unexpected GEOIDs: ${validationCorrupted.unexpected.join(', ')}`);

// ============================================================================
// Example 5: Parse GEOIDs
// ============================================================================

console.log('\n' + '='.repeat(80));
console.log('Example 5: Parse GEOIDs');
console.log('='.repeat(80));

const geoidExamples = [
  '06037',   // Los Angeles County
  '0612',    // California Congressional District 12
  '06U001',  // California State Senate District 1
  '06L001',  // California State Assembly District 1
  '0644000', // Los Angeles city
];

console.log('\nParsed GEOIDs:');
for (const geoid of geoidExamples) {
  const parsed = parseGEOID(geoid);
  if (parsed) {
    console.log(`  ${geoid} -> State: ${parsed.stateFips}, Type: ${parsed.entityType}, Code: ${parsed.entityCode}`);
  }
}

// ============================================================================
// Example 6: National Validation
// ============================================================================

console.log('\n' + '='.repeat(80));
console.log('Example 6: National Validation');
console.log('='.repeat(80));

// Generate all congressional districts nationwide
import { EXPECTED_CD_BY_STATE } from '../src/validators/tiger-expected-counts.js';

const allCongressional: string[] = [];
for (const stateFips of Object.keys(EXPECTED_CD_BY_STATE)) {
  allCongressional.push(...getExpectedCongressionalGEOIDs(stateFips));
}

// Validate national dataset
const nationalValidation = validateNationalGEOIDCompleteness(
  'congressional',
  allCongressional
);

console.log(`\n${nationalValidation.summary}`);
console.log(`Total Congressional Districts: ${nationalValidation.expected}`);

// ============================================================================
// Example 7: Real-World Workflow
// ============================================================================

console.log('\n' + '='.repeat(80));
console.log('Example 7: Real-World Extraction Workflow');
console.log('='.repeat(80));

/**
 * Simulate TIGER data extraction workflow with validation
 */
async function extractAndValidate(stateFips: string): Promise<void> {
  console.log(`\nExtracting congressional districts for state ${stateFips}...`);

  // 1. Get expected GEOIDs
  const expectedGEOIDs = getExpectedCongressionalGEOIDs(stateFips);
  console.log(`  Expected: ${expectedGEOIDs.length} districts`);

  // 2. Simulate extraction (in real code, this would fetch from TIGER API)
  const extractedGEOIDs = [...expectedGEOIDs];
  console.log(`  Extracted: ${extractedGEOIDs.length} districts`);

  // 3. Validate completeness
  const validation = validateGEOIDCompleteness(
    stateFips,
    'congressional',
    extractedGEOIDs
  );

  // 4. Report results
  if (validation.complete) {
    console.log(`  ✅ Validation: ${validation.summary}`);
  } else {
    console.error(`  ❌ Validation: ${validation.summary}`);
    if (validation.missing.length > 0) {
      console.error(`     Missing: ${validation.missing.join(', ')}`);
    }
    if (validation.unexpected.length > 0) {
      console.error(`     Unexpected: ${validation.unexpected.join(', ')}`);
    }
  }
}

// Extract and validate multiple states
(async () => {
  await extractAndValidate('06'); // California
  await extractAndValidate('48'); // Texas
  await extractAndValidate('36'); // New York
  await extractAndValidate('02'); // Alaska (at-large)

  console.log('\n' + '='.repeat(80));
  console.log('Examples Complete');
  console.log('='.repeat(80));
})().catch(console.error);
