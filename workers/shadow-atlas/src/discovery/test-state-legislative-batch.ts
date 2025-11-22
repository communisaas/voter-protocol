/**
 * State Legislative District Discovery Test - All 50 States (House + Senate)
 *
 * Tests BOTH state house and state senate district discovery.
 * These are legally required boundaries and should have very high availability.
 *
 * Target: 95%+ success for both chambers
 */

import { searchHubForStateHouseDistricts, searchHubForStateSenateDistricts } from './hub-api-discovery';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface State {
  code: string;
  name: string;
  districts: number;
}

async function testStateLegislativeBatch() {
  console.log('\n' + '='.repeat(80));
  console.log('🏛️  STATE LEGISLATIVE DISTRICT DISCOVERY - ALL 50 STATES');
  console.log('='.repeat(80));

  // Load all states
  const statesPath = join(__dirname, '../../data/states.json');
  const allStates: State[] = JSON.parse(readFileSync(statesPath, 'utf-8'));

  // Exclude DC and Nebraska (unicameral)
  const states = allStates.filter(s => s.code !== 'DC');

  console.log(`\nLoaded ${states.length} states`);
  console.log(`Testing BOTH House and Senate for each state`);
  console.log(`Target: 95%+ success rate for each chamber\n`);

  const houseResults: Array<{
    state: State;
    success: boolean;
    terminology?: string;
    score?: number;
  }> = [];

  const senateResults: Array<{
    state: State;
    success: boolean;
    terminology?: string;
    score?: number;
  }> = [];

  let processed = 0;

  for (const state of states) {
    processed++;
    const progress = `[${processed}/${states.length}]`;

    console.log(`\n${progress} Testing: ${state.name} (${state.code})`);

    // Test State House
    console.log(`   🏛️  State House...`);
    try {
      const houseResult = await searchHubForStateHouseDistricts(state.code);

      if (houseResult) {
        const terminology = houseResult.metadata.terminologyUsed || 'unknown';
        console.log(`      ✅ House: "${terminology}" - Score: ${houseResult.score}/100`);
        houseResults.push({
          state,
          success: true,
          terminology,
          score: houseResult.score
        });
      } else {
        console.log(`      ❌ House: No data found`);
        houseResults.push({ state, success: false });
      }
    } catch (error) {
      console.log(`      ❌ House ERROR: ${error}`);
      houseResults.push({ state, success: false });
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    // Test State Senate (skip Nebraska - unicameral)
    if (state.code === 'NE') {
      console.log(`   🏛️  State Senate: SKIPPED (unicameral legislature)`);
      // Don't add to results
    } else {
      console.log(`   🏛️  State Senate...`);
      try {
        const senateResult = await searchHubForStateSenateDistricts(state.code);

        if (senateResult) {
          const terminology = senateResult.metadata.terminologyUsed || 'unknown';
          console.log(`      ✅ Senate: "${terminology}" - Score: ${senateResult.score}/100`);
          senateResults.push({
            state,
            success: true,
            terminology,
            score: senateResult.score
          });
        } else {
          console.log(`      ❌ Senate: No data found`);
          senateResults.push({ state, success: false });
        }
      } catch (error) {
        console.log(`      ❌ Senate ERROR: ${error}`);
        senateResults.push({ state, success: false });
      }
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Summary Statistics
  const houseSuccess = houseResults.filter(r => r.success).length;
  const senateSuccess = senateResults.filter(r => r.success).length;
  const houseRate = (houseSuccess / houseResults.length * 100);
  const senateRate = (senateSuccess / senateResults.length * 100);

  console.log('\n\n' + '='.repeat(80));
  console.log('📊 BATCH TEST SUMMARY');
  console.log('='.repeat(80));

  // House Results
  console.log(`\n🏛️  STATE HOUSE:`);
  console.log(`   ✅ Successful: ${houseSuccess}/${houseResults.length} (${houseRate.toFixed(1)}%)`);
  console.log(`   ❌ Failed: ${houseResults.length - houseSuccess}/${houseResults.length}`);

  if (houseSuccess > 0) {
    const houseScores = houseResults.filter(r => r.success && r.score).map(r => r.score!);
    const avgHouse = houseScores.reduce((a, b) => a + b, 0) / houseScores.length;
    console.log(`   📈 Average Score: ${avgHouse.toFixed(1)}/100`);
  }

  // Senate Results
  console.log(`\n🏛️  STATE SENATE:`);
  console.log(`   ✅ Successful: ${senateSuccess}/${senateResults.length} (${senateRate.toFixed(1)}%)`);
  console.log(`   ❌ Failed: ${senateResults.length - senateSuccess}/${senateResults.length}`);

  if (senateSuccess > 0) {
    const senateScores = senateResults.filter(r => r.success && r.score).map(r => r.score!);
    const avgSenate = senateScores.reduce((a, b) => a + b, 0) / senateScores.length;
    console.log(`   📈 Average Score: ${avgSenate.toFixed(1)}/100`);
  }

  // Combined Performance
  const totalSuccess = houseSuccess + senateSuccess;
  const totalTests = houseResults.length + senateResults.length;
  const overallRate = (totalSuccess / totalTests * 100);

  console.log(`\n🎯 OVERALL PERFORMANCE:`);
  console.log(`   Combined: ${totalSuccess}/${totalTests} (${overallRate.toFixed(1)}%)`);

  // Failed states
  const houseFailed = houseResults.filter(r => !r.success);
  const senateFailed = senateResults.filter(r => !r.success);

  if (houseFailed.length > 0) {
    console.log(`\n❌ Failed House:`);
    houseFailed.forEach(r => console.log(`   ${r.state.code}: ${r.state.name}`));
  }

  if (senateFailed.length > 0) {
    console.log(`\n❌ Failed Senate:`);
    senateFailed.forEach(r => console.log(`   ${r.state.code}: ${r.state.name}`));
  }

  // Evaluation
  console.log(`\n🎯 Performance Evaluation:`);
  if (overallRate >= 95) {
    console.log(`   🎉 EXCELLENT: ${overallRate.toFixed(1)}% exceeds 95% target!`);
    console.log(`   Phase 5 state legislative discovery is PRODUCTION-READY!`);
  } else if (overallRate >= 90) {
    console.log(`   ✅ GOOD: ${overallRate.toFixed(1)}% success rate`);
    console.log(`   Nearly complete coverage.`);
  } else if (overallRate >= 85) {
    console.log(`   ✅ ACCEPTABLE: ${overallRate.toFixed(1)}% success rate`);
    console.log(`   Review failed states for edge cases.`);
  } else {
    console.log(`   ⚠️  NEEDS IMPROVEMENT: ${overallRate.toFixed(1)}% below 85%`);
  }

  console.log('');
}

// Run batch test
testStateLegislativeBatch().catch(error => {
  console.error('\n💥 FATAL ERROR:', error);
  process.exit(1);
});
