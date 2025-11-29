/**
 * Live Registry URL Test
 *
 * Tests validation pipeline on REAL URLs from known-portals registry.
 * Shows production behavior with actual municipal GIS data.
 */

import { PostDownloadValidator } from './acquisition/post-download-validator.js';
import { KNOWN_PORTALS } from './registry/known-portals.js';
import type { FeatureCollection } from 'geojson';

async function testLiveRegistryURLs() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  LIVE REGISTRY URL VALIDATION TEST');
  console.log('═══════════════════════════════════════════════════════════\n');

  const validator = new PostDownloadValidator();

  // Test high-confidence entries from registry
  const testCities = [
    { fips: '5363000', name: 'Seattle, WA' },
    { fips: '4805000', name: 'Austin, TX' },
    { fips: '2938000', name: 'Kansas City, MO' },
    { fips: '0666000', name: 'San Diego, CA' },
    { fips: '0667000', name: 'San Francisco, CA' },
  ];

  let successCount = 0;
  let failCount = 0;

  for (const city of testCities) {
    const portal = KNOWN_PORTALS[city.fips];
    if (!portal) {
      console.log(`❌ ${city.name} - Not in registry\n`);
      failCount++;
      continue;
    }

    console.log(`Testing: ${city.name}`);
    console.log(`─────────────────────────────────────────────────────────────`);
    console.log(`Portal Type: ${portal.portalType}`);
    console.log(`Registry Confidence: ${portal.confidence}%`);
    console.log(`Expected Features: ${portal.featureCount}`);
    console.log(`URL: ${portal.downloadUrl.substring(0, 80)}...`);
    console.log('');

    try {
      console.log('Downloading...');
      const response = await fetch(portal.downloadUrl, {
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        console.log(`❌ Download failed: ${response.status} ${response.statusText}\n`);
        failCount++;
        continue;
      }

      const data = await response.json() as FeatureCollection;

      console.log('Validating...');
      const validation = validator.validate(data, {
        source: portal.downloadUrl,
        city: city.name,
      });

      console.log('\n📊 VALIDATION RESULTS:');
      console.log(`   Valid: ${validation.valid ? '✅ YES' : '❌ NO'}`);
      console.log(`   Confidence: ${validation.confidence}% (registry: ${portal.confidence}%)`);
      console.log(`   Feature Count: ${validation.metadata.featureCount} (expected: ${portal.featureCount})`);
      console.log(`   Geometry Types: ${JSON.stringify(validation.metadata.geometryTypes)}`);
      console.log(`   Bounding Box: [${validation.metadata.boundingBox.map(n => n.toFixed(2)).join(', ')}]`);

      if (validation.issues.length > 0) {
        console.log(`   ❌ Issues:`);
        validation.issues.forEach(issue => console.log(`      - ${issue}`));
      }

      if (validation.warnings.length > 0) {
        console.log(`   ⚠️  Warnings:`);
        validation.warnings.forEach(warning => console.log(`      - ${warning}`));
      }

      console.log(`   Property Keys (first 5): ${validation.metadata.propertyKeys.slice(0, 5).join(', ')}`);

      // Routing decision
      if (validation.confidence >= 85) {
        console.log('\n✅ DECISION: AUTO-ACCEPT (85-100% confidence)');
        successCount++;
      } else if (validation.confidence >= 60) {
        console.log('\n⚠️  DECISION: MANUAL REVIEW (60-84% confidence)');
        successCount++;
      } else {
        console.log('\n❌ DECISION: AUTO-REJECT (0-59% confidence)');
        failCount++;
      }

      // Feature count match check
      if (validation.metadata.featureCount !== portal.featureCount) {
        console.log(`⚠️  WARNING: Feature count mismatch (got ${validation.metadata.featureCount}, expected ${portal.featureCount})`);
      }

    } catch (error) {
      console.log(`❌ Error: ${(error as Error).message}`);
      failCount++;
    }

    console.log('\n');
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Total Cities Tested: ${testCities.length}`);
  console.log(`Successful Validations: ${successCount} (${Math.round(successCount / testCities.length * 100)}%)`);
  console.log(`Failed Validations: ${failCount} (${Math.round(failCount / testCities.length * 100)}%)`);
  console.log('═══════════════════════════════════════════════════════════\n');

  if (successCount / testCities.length >= 0.8) {
    console.log('✅ PRODUCTION READY: ≥80% success rate achieved');
  } else {
    console.log('⚠️  NEEDS WORK: <80% success rate');
  }
}

// Run tests
testLiveRegistryURLs().catch(error => {
  console.error('FATAL ERROR:', error);
  process.exit(1);
});
