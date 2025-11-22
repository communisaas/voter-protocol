/**
 * Congressional District Discovery Test - All 50 States
 *
 * CRITICAL FOR VOTER PROTOCOL: This validates congressional district discovery
 * across all U.S. states. 100% coverage is essential for the core messaging feature.
 *
 * Congressional districts are federally mandated and should have near-perfect
 * availability via ArcGIS Hub API and Census TIGER.
 */

import { searchHubForCongressionalDistricts } from './hub-api-discovery';
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

async function testCongressionalBatch() {
  console.log('\n' + '='.repeat(80));
  console.log('🏛️  CONGRESSIONAL DISTRICT DISCOVERY - ALL 50 STATES');
  console.log('='.repeat(80));

  // Load all states
  const statesPath = join(__dirname, '../../data/states.json');
  const allStates: State[] = JSON.parse(readFileSync(statesPath, 'utf-8'));

  // Exclude DC (no voting representative)
  const states = allStates.filter(s => s.code !== 'DC');

  console.log(`\nLoaded ${states.length} states (excluding DC)`);
  console.log(`Total congressional districts: 435`);
  console.log(`Target: 100% success rate (this is CRITICAL for VOTER Protocol)\n`);

  const results: Array<{
    state: State;
    success: boolean;
    terminology?: string;
    score?: number;
    error?: string;
  }> = [];

  let processed = 0;

  for (const state of states) {
    processed++;
    const progress = `[${processed}/${states.length}]`;

    console.log(`\n${progress} Testing: ${state.name} (${state.code}) - ${state.districts} districts`);

    try {
      const result = await searchHubForCongressionalDistricts(state.code);

      if (result) {
        const terminology = result.metadata.terminologyUsed || 'unknown';
        console.log(`   ✅ Found with "${terminology}" - Score: ${result.score}/100`);

        results.push({
          state,
          success: true,
          terminology,
          score: result.score
        });
      } else {
        console.log(`   ❌ No data found`);
        results.push({
          state,
          success: false
        });
      }
    } catch (error) {
      console.log(`   ❌ ERROR: ${error}`);
      results.push({
        state,
        success: false,
        error: String(error)
      });
    }

    // Rate limiting - be respectful to Hub API
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Summary Statistics
  const successCount = results.filter(r => r.success).length;
  const failureCount = results.length - successCount;
  const successRate = (successCount / results.length * 100);

  console.log('\n\n' + '='.repeat(80));
  console.log('📊 BATCH TEST SUMMARY');
  console.log('='.repeat(80));
  console.log(`\n✅ Successful: ${successCount}/${results.length} (${successRate.toFixed(1)}%)`);
  console.log(`❌ Failed: ${failureCount}/${results.length} (${(100 - successRate).toFixed(1)}%)`);

  // Terminology breakdown
  if (successCount > 0) {
    console.log(`\n🎯 Terminology Breakdown:`);
    const termCounts = new Map<string, number>();
    results.filter(r => r.success && r.terminology).forEach(r => {
      const count = termCounts.get(r.terminology!) || 0;
      termCounts.set(r.terminology!, count + 1);
    });

    Array.from(termCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([term, count]) => {
        const pct = (count / successCount * 100).toFixed(1);
        console.log(`   ${count.toString().padStart(2)} states (${pct.toString().padStart(5)}%): "${term}"`);
      });

    // Score statistics
    const scores = results.filter(r => r.success && r.score).map(r => r.score!);
    if (scores.length > 0) {
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      const minScore = Math.min(...scores);
      const maxScore = Math.max(...scores);

      console.log(`\n📈 Score Statistics:`);
      console.log(`   Average: ${avgScore.toFixed(1)}/100`);
      console.log(`   Range:   ${minScore}-${maxScore}/100`);
    }
  }

  // Failed states breakdown
  if (failureCount > 0) {
    console.log(`\n❌ Failed States:`);
    results.filter(r => !r.success).forEach(r => {
      console.log(`   ${r.state.code}: ${r.state.name} (${r.state.districts} districts)`);
    });
  }

  // Performance evaluation
  console.log(`\n🎯 Performance Evaluation:`);
  if (successRate === 100) {
    console.log(`   🎉 PERFECT: 100% success - Phase 3 congressional discovery is PRODUCTION-READY!`);
    console.log(`   VOTER Protocol can now verify congressional district membership nationwide.`);
  } else if (successRate >= 98) {
    console.log(`   ✅ EXCELLENT: ${successRate.toFixed(1)}% success rate`);
    console.log(`   Nearly complete coverage. Investigate remaining failures.`);
  } else if (successRate >= 95) {
    console.log(`   ✅ GOOD: ${successRate.toFixed(1)}% success rate`);
    console.log(`   Acceptable for initial deployment. Review failed states.`);
  } else if (successRate >= 90) {
    console.log(`   ⚠️  ACCEPTABLE: ${successRate.toFixed(1)}% success rate`);
    console.log(`   Additional work needed for complete national coverage.`);
  } else {
    console.log(`   ❌ NEEDS IMPROVEMENT: ${successRate.toFixed(1)}% below 90%`);
    console.log(`   Review terminology variants and API coverage.`);
  }

  console.log('');
}

// Run batch test
testCongressionalBatch().catch(error => {
  console.error('\n💥 FATAL ERROR:', error);
  process.exit(1);
});
