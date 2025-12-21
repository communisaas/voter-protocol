#!/usr/bin/env npx tsx
/**
 * Test script to verify actual feature count fetching works correctly.
 *
 * Tests the fix against known ArcGIS services to ensure we get:
 * - Real feature counts (e.g., 7, 12, 50)
 * - NOT API limits (1000, 2000, 5000)
 */

interface TestResult {
  layerUrl: string;
  layerName: string;
  oldMethod: number | null; // Using maxRecordCount (WRONG)
  newMethod: number | null; // Using query endpoint (CORRECT)
  improvement: string;
}

async function fetchFixOld(layerUrl: string): Promise<{ name: string; count: number | null }> {
  try {
    const response = await fetch(`${layerUrl}?f=json`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { name: 'Unknown', count: null };
    }

    const data = await response.json() as Record<string, unknown>;

    // OLD BROKEN METHOD: Uses maxRecordCount as fallback
    const count = typeof data.count === 'number' ? data.count :
      typeof data.maxRecordCount === 'number' ? data.maxRecordCount : null;

    return {
      name: String(data.name ?? 'Unknown'),
      count,
    };
  } catch {
    return { name: 'Unknown', count: null };
  }
}

async function fetchFixNew(layerUrl: string): Promise<number | null> {
  try {
    // NEW CORRECT METHOD: Query actual feature count
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

async function testFeatureCountFix(): Promise<void> {
  console.log('='.repeat(70));
  console.log('FEATURE COUNT FIX VERIFICATION TEST');
  console.log('='.repeat(70));
  console.log('Testing actual feature count queries vs old maxRecordCount method\n');

  // Test cases: Known ArcGIS services with various feature counts
  const testLayers = [
    // Montana City Council Districts (should be small numbers like 7-15)
    'https://gis.missoulaco.us/arcgis/rest/services/Elections/MapServer/0',
    'https://gis.flathead.mt.gov/arcgis/rest/services/Elections/MapServer/0',

    // California County Supervisors (typically 5 per county)
    'https://gis.sccgov.org/arcgis/rest/services/Planning/MapServer/1',

    // School Districts (varies widely)
    'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_School_Districts/FeatureServer/0',

    // State Legislative (larger, 40-120 per state)
    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',

    // City boundaries (should be specific count, not 1000/2000)
    'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Major_Cities/FeatureServer/0',
  ];

  const results: TestResult[] = [];

  for (const layerUrl of testLayers) {
    console.log(`Testing: ${layerUrl}`);

    const oldResult = await fetchFixOld(layerUrl);
    const newResult = await fetchFixNew(layerUrl);

    let improvement: string;
    if (oldResult.count === null && newResult === null) {
      improvement = 'Both failed (server issue)';
    } else if (oldResult.count === newResult) {
      improvement = 'Same (metadata had correct count)';
    } else if (newResult === null) {
      improvement = 'Query failed (fallback to null)';
    } else if (oldResult.count !== null && oldResult.count > 1000 && newResult < 500) {
      improvement = `FIXED: ${oldResult.count} was maxRecordCount limit, real count is ${newResult}`;
    } else {
      improvement = `Updated: ${oldResult.count} → ${newResult}`;
    }

    results.push({
      layerUrl,
      layerName: oldResult.name,
      oldMethod: oldResult.count,
      newMethod: newResult,
      improvement,
    });

    console.log(`  Name: ${oldResult.name}`);
    console.log(`  Old method: ${oldResult.count}`);
    console.log(`  New method: ${newResult}`);
    console.log(`  ${improvement}\n`);
  }

  // Summary
  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  const fixed = results.filter(r =>
    r.oldMethod !== null &&
    r.newMethod !== null &&
    r.oldMethod > 1000 &&
    r.newMethod < 500
  );

  const improved = results.filter(r =>
    r.oldMethod !== r.newMethod &&
    r.newMethod !== null
  );

  console.log(`Total tests: ${results.length}`);
  console.log(`Fake maxRecordCount fixed: ${fixed.length}`);
  console.log(`Values improved: ${improved.length}`);
  console.log(`Query failures: ${results.filter(r => r.newMethod === null).length}`);

  if (fixed.length > 0) {
    console.log('\n✓ FIX VERIFIED: Actual feature counts now returned instead of API limits');
  } else {
    console.log('\n⚠️  WARNING: No fake maxRecordCount values detected in test set');
    console.log('   This is OK if test services already had correct metadata counts');
  }

  console.log('='.repeat(70));
}

// Run test
testFeatureCountFix()
  .then(() => {
    console.log('\n✓ Test complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Test failed:', error);
    process.exit(1);
  });
