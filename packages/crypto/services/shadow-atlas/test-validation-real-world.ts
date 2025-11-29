/**
 * Real-World Validation Test
 *
 * Tests validation pipeline on REAL municipal boundary data from production sources.
 *
 * Cities tested:
 * 1. Seattle, WA - Known good (7 districts, official ArcGIS Hub)
 * 2. Portland, OR - Boundary case (test geographic validation)
 * 3. Invalid dataset - Voting precincts (should REJECT)
 */

import { PostDownloadValidator } from './acquisition/post-download-validator.js';
import type { FeatureCollection } from 'geojson';

async function testRealWorldValidation() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  REAL-WORLD VALIDATION TEST');
  console.log('═══════════════════════════════════════════════════════════\n');

  const validator = new PostDownloadValidator();

  // Test 1: Seattle City Council Districts (SHOULD PASS)
  console.log('Test 1: Seattle City Council Districts');
  console.log('─────────────────────────────────────────────────────────────');
  console.log('Source: Official Seattle GIS Open Data Portal');
  console.log('Expected: PASS (85-100% confidence)\n');

  try {
    const seattleUrl = 'https://data-seattlecitygis.opendata.arcgis.com/datasets/SeattleCityGIS::city-council-districts.geojson?outSR=%7B%22latestWkid%22%3A2926%2C%22wkid%22%3A2926%7D';

    console.log('Downloading Seattle data...');
    const seattleResponse = await fetch(seattleUrl);

    if (!seattleResponse.ok) {
      console.error(`❌ Download failed: ${seattleResponse.status} ${seattleResponse.statusText}\n`);
    } else {
      const seattleData = await seattleResponse.json() as FeatureCollection;

      console.log('Validating...');
      const seattleValidation = validator.validate(seattleData, {
        source: seattleUrl,
        city: 'Seattle',
      });

      console.log('\n📊 RESULTS:');
      console.log(`   Valid: ${seattleValidation.valid ? '✅ YES' : '❌ NO'}`);
      console.log(`   Confidence: ${seattleValidation.confidence}%`);
      console.log(`   Feature Count: ${seattleValidation.metadata.featureCount}`);
      console.log(`   Geometry Types: ${JSON.stringify(seattleValidation.metadata.geometryTypes)}`);
      console.log(`   Bounding Box: [${seattleValidation.metadata.boundingBox.map(n => n.toFixed(4)).join(', ')}]`);

      if (seattleValidation.issues.length > 0) {
        console.log(`   ❌ Issues: ${seattleValidation.issues.join(', ')}`);
      }

      if (seattleValidation.warnings.length > 0) {
        console.log(`   ⚠️  Warnings: ${seattleValidation.warnings.join(', ')}`);
      }

      console.log(`   Property Keys (first 10): ${seattleValidation.metadata.propertyKeys.slice(0, 10).join(', ')}`);

      // Routing decision
      if (seattleValidation.confidence >= 85) {
        console.log('\n✅ DECISION: AUTO-ACCEPT (85-100% confidence)');
      } else if (seattleValidation.confidence >= 60) {
        console.log('\n⚠️  DECISION: MANUAL REVIEW (60-84% confidence)');
      } else {
        console.log('\n❌ DECISION: AUTO-REJECT (0-59% confidence)');
      }
    }
  } catch (error) {
    console.error(`❌ Error: ${(error as Error).message}`);
  }

  console.log('\n');

  // Test 2: Try to find Portland data (may fail - demonstrating fallback)
  console.log('Test 2: Portland, OR City Council Districts');
  console.log('─────────────────────────────────────────────────────────────');
  console.log('Source: Portland Maps Open Data');
  console.log('Expected: PASS or demonstrate graceful failure\n');

  try {
    // Portland's official open data portal
    const portlandUrl = 'https://gis-pdx.opendata.arcgis.com/datasets/pdx::city-council-districts.geojson?outSR=%7B%22latestWkid%22%3A2913%2C%22wkid%22%3A2913%7D';

    console.log('Downloading Portland data...');
    const portlandResponse = await fetch(portlandUrl, { signal: AbortSignal.timeout(10000) });

    if (!portlandResponse.ok) {
      console.log(`⏭️  Download failed: ${portlandResponse.status} ${portlandResponse.statusText}`);
      console.log('   (This is expected - demonstrating fallback behavior)\n');
    } else {
      const portlandData = await portlandResponse.json() as FeatureCollection;

      console.log('Validating...');
      const portlandValidation = validator.validate(portlandData, {
        source: portlandUrl,
        city: 'Portland',
      });

      console.log('\n📊 RESULTS:');
      console.log(`   Valid: ${portlandValidation.valid ? '✅ YES' : '❌ NO'}`);
      console.log(`   Confidence: ${portlandValidation.confidence}%`);
      console.log(`   Feature Count: ${portlandValidation.metadata.featureCount}`);

      if (portlandValidation.issues.length > 0) {
        console.log(`   ❌ Issues: ${portlandValidation.issues.join(', ')}`);
      }

      if (portlandValidation.confidence >= 85) {
        console.log('\n✅ DECISION: AUTO-ACCEPT');
      } else if (portlandValidation.confidence >= 60) {
        console.log('\n⚠️  DECISION: MANUAL REVIEW');
      } else {
        console.log('\n❌ DECISION: AUTO-REJECT');
      }
    }
  } catch (error) {
    console.log(`⏭️  Network error: ${(error as Error).message}`);
    console.log('   (Demonstrating timeout handling)\n');
  }

  console.log('\n');

  // Test 3: Synthetic invalid data (voting precincts)
  console.log('Test 3: Invalid Dataset (Voting Precincts)');
  console.log('─────────────────────────────────────────────────────────────');
  console.log('Source: Synthetic test data');
  console.log('Expected: REJECT (0-59% confidence)\n');

  const invalidData: FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-122.4, 37.8],
            [-122.5, 37.8],
            [-122.5, 37.9],
            [-122.4, 37.9],
            [-122.4, 37.8],
          ]],
        },
        properties: {
          PRECINCT_ID: '12-A',
          POLLING_PLACE: '123 Main St',
          REGISTERED_VOTERS: 543,
        },
      },
    ],
  };

  const invalidValidation = validator.validate(invalidData, {
    source: 'synthetic-test-data',
    city: 'TestCity',
  });

  console.log('📊 RESULTS:');
  console.log(`   Valid: ${invalidValidation.valid ? '✅ YES' : '❌ NO'}`);
  console.log(`   Confidence: ${invalidValidation.confidence}%`);
  console.log(`   Feature Count: ${invalidValidation.metadata.featureCount}`);

  if (invalidValidation.issues.length > 0) {
    console.log(`   ❌ Issues:`);
    invalidValidation.issues.forEach(issue => console.log(`      - ${issue}`));
  }

  if (invalidValidation.confidence >= 85) {
    console.log('\n❌ FAILURE: Should have rejected but auto-accepted!');
  } else if (invalidValidation.confidence >= 60) {
    console.log('\n⚠️  PARTIAL: Should reject but flagged for review');
  } else {
    console.log('\n✅ SUCCESS: Correctly rejected precinct data');
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  TEST COMPLETE');
  console.log('═══════════════════════════════════════════════════════════\n');
}

// Run tests
testRealWorldValidation().catch(error => {
  console.error('FATAL ERROR:', error);
  process.exit(1);
});
