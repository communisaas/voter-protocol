/**
 * Simple Performance Test (No Terminal Required)
 * 
 * Tests if our parallel terminology optimization is working
 * by measuring execution time of a single boundary discovery.
 */

import { searchHubWithTerminologyFallback } from './src/discovery/hub-api-discovery.js';
import { BoundaryType } from './src/discovery/terminology.js';

async function testPerformance() {
  console.log('🚀 Testing Performance Improvement');
  console.log('Testing special districts in Los Angeles (21 terminology variants)');
  console.log('Expected: 42s → ~4s (10× speedup with parallel execution)');
  console.log();

  const start = Date.now();

  try {
    const result = await searchHubWithTerminologyFallback(
      'Los Angeles',
      'CA', 
      BoundaryType.SPECIAL_DISTRICT,
      { quiet: true } // Suppress console output for clean test
    );

    const duration = Date.now() - start;

    console.log('=== RESULTS ===');
    console.log(`Duration: ${duration}ms (${(duration/1000).toFixed(1)}s)`);
    console.log(`Success: ${!!result}`);
    
    if (result) {
      console.log(`Score: ${result.score}/100`);
      console.log(`Terminology used: "${result.metadata.terminologyUsed}"`);
      console.log(`Source: ${result.metadata.source}`);
    }
    
    console.log();
    console.log('=== PERFORMANCE ANALYSIS ===');
    
    if (duration < 5000) {
      console.log('✅ EXCELLENT: Parallel optimization working! (< 5s)');
    } else if (duration < 15000) {
      console.log('⚠️  GOOD: Significant improvement but could be better (5-15s)');
    } else if (duration < 30000) {
      console.log('⚠️  SLOW: Some improvement but still slow (15-30s)');
    } else {
      console.log('❌ VERY SLOW: Parallel optimization may not be working (> 30s)');
    }
    
    const expectedSequential = 21 * 2000; // 21 variants × 2s each = 42s
    const speedup = expectedSequential / duration;
    
    console.log(`Expected sequential time: ${expectedSequential/1000}s`);
    console.log(`Actual time: ${(duration/1000).toFixed(1)}s`);
    console.log(`Speedup: ${speedup.toFixed(1)}×`);
    
  } catch (error) {
    const duration = Date.now() - start;
    console.log('❌ ERROR after', duration + 'ms:', error.message);
    
    if (error.name === 'AbortError') {
      console.log('   → Request timeout (10s limit)');
    } else if (error.message.includes('fetch')) {
      console.log('   → Network connectivity issue');
    }
  }
}

// Run the test
testPerformance().catch(console.error);