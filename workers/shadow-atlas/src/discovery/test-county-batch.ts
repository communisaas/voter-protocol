/**
 * County Discovery Batch Test - Top 100 U.S. Counties
 *
 * Full-scale validation of county district discovery across:
 * - All major U.S. states
 * - Diverse governance models (commissioner, supervisor, council systems)
 * - Target: 90%+ success rate with enhanced scoring
 */

import { searchHubForCountyDistricts } from './hub-api-discovery';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface County {
  id: string;
  name: string;
  state: string;
  population: number;
}

async function testCountyBatch() {
  console.log('\n' + '='.repeat(80));
  console.log('🏛️  COUNTY DISTRICT DISCOVERY - BATCH TEST (Top 100)');
  console.log('='.repeat(80));

  // Load top 100 counties
  const countiesPath = join(__dirname, '../../data/counties.json');
  const counties: County[] = JSON.parse(readFileSync(countiesPath, 'utf-8'));

  console.log(`\nLoaded ${counties.length} counties from data/counties.json`);
  console.log(`Target: 90%+ success rate\n`);

  const results: Array<{
    county: County;
    success: boolean;
    terminology?: string;
    score?: number;
    error?: string;
  }> = [];

  let processed = 0;

  for (const county of counties) {
    processed++;
    const progress = `[${processed}/${counties.length}]`;

    console.log(`\n${progress} Testing: ${county.name} County, ${county.state} (pop: ${county.population.toLocaleString()})`);

    try {
      const result = await searchHubForCountyDistricts(county.name, county.state);

      if (result) {
        const terminology = result.metadata.terminologyUsed || 'unknown';
        console.log(`   ✅ Found with "${terminology}" - Score: ${result.score}/100`);

        results.push({
          county,
          success: true,
          terminology,
          score: result.score
        });
      } else {
        console.log(`   ❌ No data found`);
        results.push({
          county,
          success: false
        });
      }
    } catch (error) {
      console.log(`   ❌ ERROR: ${error}`);
      results.push({
        county,
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
        console.log(`   ${count.toString().padStart(3)} counties (${pct.toString().padStart(5)}%): "${term}"`);
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

  // Failed counties breakdown
  if (failureCount > 0) {
    console.log(`\n❌ Failed Counties:`);
    const failedByState = new Map<string, County[]>();

    results.filter(r => !r.success).forEach(r => {
      const stateCounties = failedByState.get(r.county.state) || [];
      stateCounties.push(r.county);
      failedByState.set(r.county.state, stateCounties);
    });

    Array.from(failedByState.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .forEach(([state, counties]) => {
        console.log(`   ${state}: ${counties.map(c => c.name).join(', ')}`);
      });
  }

  // Performance evaluation
  console.log(`\n🎯 Performance Evaluation:`);
  if (successRate >= 90) {
    console.log(`   🎉 EXCELLENT: ${successRate.toFixed(1)}% exceeds 90% target!`);
    console.log(`   Phase 2 county discovery is production-ready.`);
  } else if (successRate >= 80) {
    console.log(`   ✅ GOOD: ${successRate.toFixed(1)}% success rate`);
    console.log(`   Consider investigating failed cases for edge case handling.`);
  } else if (successRate >= 70) {
    console.log(`   ⚠️  ACCEPTABLE: ${successRate.toFixed(1)}% success rate`);
    console.log(`   Additional terminology variants may be needed.`);
  } else {
    console.log(`   ❌ NEEDS IMPROVEMENT: ${successRate.toFixed(1)}% below 70%`);
    console.log(`   Review failed cases and enhance terminology coverage.`);
  }

  console.log('');
}

// Run batch test
testCountyBatch().catch(error => {
  console.error('\n💥 FATAL ERROR:', error);
  process.exit(1);
});
