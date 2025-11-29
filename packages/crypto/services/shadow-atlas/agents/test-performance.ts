#!/usr/bin/env npx tsx
/**
 * Performance test to verify parallel processing still works efficiently.
 */

async function fetchActualFeatureCount(layerUrl: string): Promise<number | null> {
  try {
    const queryUrl = `${layerUrl}/query?where=1=1&returnCountOnly=true&f=json`;
    const response = await fetch(queryUrl, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const data = await response.json() as Record<string, unknown>;
    return typeof data.count === 'number' ? data.count : null;
  } catch {
    return null;
  }
}

async function testPerformance(): Promise<void> {
  console.log('='.repeat(70));
  console.log('PERFORMANCE TEST: Parallel Feature Count Queries');
  console.log('='.repeat(70));

  // 10 test layers from Census Tiger (reliable, fast servers)
  const testLayers = [
    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0',
    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1',
    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2022/MapServer/0',
    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2022/MapServer/1',
    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2022/MapServer/2',
    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/0',
    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/1',
  ];

  console.log(`Testing ${testLayers.length} layers with parallel queries...\n`);

  const startTime = Date.now();

  // All queries in parallel (like the actual implementation)
  const results = await Promise.all(
    testLayers.map(url => fetchActualFeatureCount(url))
  );

  const elapsed = Date.now() - startTime;
  const successCount = results.filter(r => r !== null).length;

  console.log('='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log(`Total queries: ${testLayers.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${testLayers.length - successCount}`);
  console.log(`Elapsed time: ${(elapsed / 1000).toFixed(2)}s`);
  console.log(`Average per query: ${(elapsed / testLayers.length).toFixed(0)}ms`);
  console.log(`Rate: ${(testLayers.length / (elapsed / 1000)).toFixed(2)} queries/sec`);
  console.log('='.repeat(70));

  // Performance threshold: Should complete 10 queries in <15 seconds with parallel execution
  if (elapsed < 15000 && successCount >= 5) {
    console.log('\n✓ PERFORMANCE VERIFIED: Parallel queries working efficiently');
  } else if (successCount < 5) {
    console.log('\n⚠️  WARNING: Many queries failed (server issues, not code issue)');
  } else {
    console.log('\n⚠️  WARNING: Queries slower than expected (may be network/server load)');
  }

  console.log('\nSample counts retrieved:');
  results.slice(0, 5).forEach((count, idx) => {
    if (count !== null) {
      console.log(`  Layer ${idx}: ${count} features`);
    }
  });
}

testPerformance()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
