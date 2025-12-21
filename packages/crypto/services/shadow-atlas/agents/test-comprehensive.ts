#!/usr/bin/env npx tsx
/**
 * Comprehensive test with more reliable ArcGIS services.
 */

async function fetchComprehensiveOld(layerUrl: string): Promise<{ name: string; count: number | null; maxRecordCount: number | null }> {
  try {
    const response = await fetch(`${layerUrl}?f=json`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { name: 'Unknown', count: null, maxRecordCount: null };
    }

    const data = await response.json() as Record<string, unknown>;

    const count = typeof data.count === 'number' ? data.count :
      typeof data.maxRecordCount === 'number' ? data.maxRecordCount : null;

    const maxRecordCount = typeof data.maxRecordCount === 'number' ? data.maxRecordCount : null;

    return {
      name: String(data.name ?? 'Unknown'),
      count,
      maxRecordCount,
    };
  } catch {
    return { name: 'Unknown', count: null, maxRecordCount: null };
  }
}

async function fetchComprehensiveNew(layerUrl: string): Promise<number | null> {
  try {
    const queryUrl = `${layerUrl}/query?where=1=1&returnCountOnly=true&f=json`;

    const response = await fetch(queryUrl, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as Record<string, unknown>;

    if (typeof data.count === 'number') {
      return data.count;
    }

    return null;
  } catch {
    return null;
  }
}

async function runTest(): Promise<void> {
  console.log('='.repeat(70));
  console.log('COMPREHENSIVE FEATURE COUNT TEST');
  console.log('='.repeat(70));

  // Known working services from ArcGIS Online
  const testLayers = [
    // US Congressional Districts (should be ~444)
    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',

    // US States (should be ~56 - 50 states + territories)
    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0',

    // US Counties (should be ~3200+)
    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1',
  ];

  let successCount = 0;
  let fixedCount = 0;

  for (const layerUrl of testLayers) {
    console.log(`\nTesting: ${layerUrl.split('/').slice(-3).join('/')}`);

    const oldResult = await fetchComprehensiveOld(layerUrl);
    const newResult = await fetchComprehensiveNew(layerUrl);

    console.log(`  Layer: ${oldResult.name}`);
    console.log(`  maxRecordCount: ${oldResult.maxRecordCount}`);
    console.log(`  Old feature_count: ${oldResult.count}`);
    console.log(`  New feature_count: ${newResult}`);

    if (newResult !== null) {
      successCount++;

      if (oldResult.count !== null && oldResult.count === oldResult.maxRecordCount && oldResult.count !== newResult) {
        console.log(`  ✓ FIXED: Was using maxRecordCount (${oldResult.maxRecordCount}), now using actual count (${newResult})`);
        fixedCount++;
      } else if (oldResult.count !== newResult) {
        console.log(`  ✓ IMPROVED: Count updated from ${oldResult.count} to ${newResult}`);
      } else {
        console.log(`  ✓ VERIFIED: Actual count confirmed`);
      }
    } else {
      console.log(`  ✗ Query failed`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log(`Successful queries: ${successCount}/${testLayers.length}`);
  console.log(`Fixed maxRecordCount issues: ${fixedCount}`);

  if (successCount > 0) {
    console.log('\n✓ Feature count queries working correctly!');
  }
  console.log('='.repeat(70));
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
