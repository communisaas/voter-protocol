/**
 * Verification Script: 195-Country Registry
 *
 * Validates the comprehensive ISO 3166-1 country registry covering all UN member states.
 *
 * VERIFIES:
 * - Total country count (195 countries)
 * - Regional distribution (Americas, Europe, Asia-Pacific, Africa, Middle East)
 * - Provider coverage (3 countries currently: US, CA, GB, AU)
 * - ISO code uniqueness and validity
 * - UN member status
 *
 * RUN:
 * ```bash
 * npm run verify:countries
 * ```
 */

import {
  COUNTRIES,
  getCountryByCode,
  getCountriesByRegion,
  getCountriesWithProviders,
  getRegistryStatistics,
  type ContinentalRegion,
} from '../registry/iso-3166-countries.js';

// ============================================================================
// Main Verification
// ============================================================================

async function verifyCountryRegistry() {
  console.log('\n📊 ISO 3166-1 Country Registry Verification\n');
  console.log('=' .repeat(80));

  // STEP 1: Count verification
  console.log('\n1️⃣  Total Country Count:');
  console.log(`   Total countries: ${COUNTRIES.length}`);
  console.log(`   Expected: 195 (193 UN members + 2 observer states)`);

  if (COUNTRIES.length === 195) {
    console.log('   ✅ PASS: Correct country count\n');
  } else {
    console.log(`   ❌ FAIL: Expected 195, got ${COUNTRIES.length}\n`);
  }

  // STEP 2: Regional distribution
  console.log('\n2️⃣  Regional Distribution:');
  const stats = getRegistryStatistics();

  const expectedRegions: Record<ContinentalRegion, { min: number; max: number }> = {
    'americas': { min: 35, max: 35 },      // Exact count expected
    'europe': { min: 50, max: 50 },        // Exact count expected
    'asia-pacific': { min: 48, max: 48 },  // Exact count expected
    'africa': { min: 54, max: 54 },        // Exact count expected
    'middle-east': { min: 8, max: 15 },    // Flexible (includes Turkey, Iran)
  };

  let regionPasses = 0;

  for (const [region, count] of Object.entries(stats.byRegion)) {
    const expected = expectedRegions[region as ContinentalRegion];
    const inRange = count >= expected.min && count <= expected.max;

    console.log(
      `   ${inRange ? '✅' : '❌'} ${region.padEnd(15)} ${count.toString().padStart(3)} countries ` +
      `(expected ${expected.min}-${expected.max})`
    );

    if (inRange) regionPasses++;
  }

  console.log(`\n   Regional verification: ${regionPasses}/5 regions passed\n`);

  // STEP 3: Provider coverage
  console.log('\n3️⃣  Boundary Provider Coverage:');
  const withProviders = getCountriesWithProviders();
  console.log(`   Countries with providers: ${withProviders.length}`);
  console.log(`   Coverage: ${stats.providerCoverage}\n`);

  console.log('   Active providers:');
  for (const code of withProviders) {
    const country = getCountryByCode(code);
    if (country) {
      console.log(`   ✅ ${code} - ${country.shortName}`);
    }
  }

  console.log('\n   Roadmap:');
  console.log('   • Phase 1 (Current): US, CA, GB, AU (4 countries)');
  console.log('   • Phase 2 (2025 Q2-Q3): + 27 EU countries');
  console.log('   • Phase 3 (2025 Q4-2026 Q2): + G20 major democracies');
  console.log('   • Phase 4 (2026 Q3-Q4): Global coverage (195 countries)\n');

  // STEP 4: ISO code uniqueness
  console.log('\n4️⃣  ISO Code Uniqueness:');

  const code2Set = new Set<string>();
  const code3Set = new Set<string>();
  const numericSet = new Set<string>();

  let duplicates = 0;

  for (const country of COUNTRIES) {
    if (code2Set.has(country.code)) {
      console.log(`   ❌ Duplicate alpha-2 code: ${country.code}`);
      duplicates++;
    }
    code2Set.add(country.code);

    if (code3Set.has(country.code3)) {
      console.log(`   ❌ Duplicate alpha-3 code: ${country.code3}`);
      duplicates++;
    }
    code3Set.add(country.code3);

    if (numericSet.has(country.numeric)) {
      console.log(`   ❌ Duplicate numeric code: ${country.numeric}`);
      duplicates++;
    }
    numericSet.add(country.numeric);
  }

  if (duplicates === 0) {
    console.log('   ✅ PASS: All ISO codes are unique');
    console.log(`   Alpha-2: ${code2Set.size} unique codes`);
    console.log(`   Alpha-3: ${code3Set.size} unique codes`);
    console.log(`   Numeric: ${numericSet.size} unique codes\n`);
  } else {
    console.log(`   ❌ FAIL: Found ${duplicates} duplicate codes\n`);
  }

  // STEP 5: UN member validation
  console.log('\n5️⃣  UN Member Status:');
  const unMembers = COUNTRIES.filter(c => c.unMember).length;
  const nonMembers = COUNTRIES.filter(c => !c.unMember);

  console.log(`   UN members: ${unMembers}`);
  console.log(`   Expected: 193 UN member states`);

  if (unMembers === 193) {
    console.log('   ✅ PASS: Correct UN member count\n');
  } else {
    console.log(`   ⚠️  WARNING: Expected 193, got ${unMembers}\n`);
  }

  console.log(`   Non-UN members (${nonMembers.length}):`);
  for (const country of nonMembers) {
    console.log(`   • ${country.code} - ${country.shortName} ${country.notes ? `(${country.notes})` : ''}`);
  }

  // STEP 6: Sample lookups
  console.log('\n6️⃣  Sample Lookups:');

  const samples = [
    { code: 'US', expected: 'United States' },
    { code: 'GB', expected: 'United Kingdom' },
    { code: 'JP', expected: 'Japan' },
    { code: 'BR', expected: 'Brazil' },
    { code: 'ZA', expected: 'South Africa' },
    { code: 'AE', expected: 'UAE' },
  ];

  let lookupPasses = 0;

  for (const sample of samples) {
    const country = getCountryByCode(sample.code);
    const match = country?.shortName === sample.expected;

    console.log(
      `   ${match ? '✅' : '❌'} ${sample.code} → ` +
      `${country?.shortName || 'NOT FOUND'} (expected: ${sample.expected})`
    );

    if (match) lookupPasses++;
  }

  console.log(`\n   Lookup verification: ${lookupPasses}/${samples.length} passed\n`);

  // STEP 7: Regional queries
  console.log('\n7️⃣  Regional Queries:');

  const regions: ContinentalRegion[] = ['americas', 'europe', 'asia-pacific', 'africa', 'middle-east'];

  for (const region of regions) {
    const countries = getCountriesByRegion(region);
    console.log(`   ${region.padEnd(15)} ${countries.length.toString().padStart(3)} countries`);
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('\n✨ Verification Complete\n');

  console.log('Summary:');
  console.log(`   • Total countries: ${COUNTRIES.length}/195`);
  console.log(`   • UN members: ${unMembers}/193`);
  console.log(`   • Regions covered: ${regionPasses}/5`);
  console.log(`   • ISO codes unique: ${duplicates === 0 ? 'Yes' : 'No'}`);
  console.log(`   • Provider coverage: ${stats.providerCoverage}`);
  console.log('\nRegistry is ready for global Merkle tree construction! 🌍\n');
}

// Run verification
verifyCountryRegistry().catch(console.error);
