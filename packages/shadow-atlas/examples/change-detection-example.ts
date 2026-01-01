/**
 * Change Detection Example
 *
 * Demonstrates how to use change detection to optimize Atlas builds.
 *
 * Usage:
 *   npx tsx examples/change-detection-example.ts
 */

import { ShadowAtlasService } from '../src/core/shadow-atlas-service.js';
import { createConfig } from '../src/core/config.js';

async function main(): Promise<void> {
  console.log('='.repeat(80));
  console.log('CHANGE DETECTION EXAMPLE');
  console.log('='.repeat(80));

  // Create service with change detection enabled
  const config = createConfig({
    storageDir: './temp-atlas-data',
    changeDetection: {
      enabled: true,
      skipUnchanged: true,
      checksumCachePath: './temp-atlas-data/checksums.json',
    },
  });

  const atlas = new ShadowAtlasService(config);
  await atlas.initialize();

  try {
    // Example 1: Check for changes before building
    console.log('\n[Step 1] Checking for changes in TIGER sources...');
    const changeResult = await atlas.checkForChanges(
      ['cd', 'sldu', 'sldl', 'county'],
      ['55'], // Wisconsin
      2024
    );

    console.log(`\nChange detection results:`);
    console.log(`  Has changes: ${changeResult.hasChanges}`);
    console.log(`  Changed layers: ${changeResult.changedLayers.join(', ') || 'none'}`);
    console.log(`  Changed states: ${changeResult.changedStates.join(', ') || 'none'}`);

    if (!changeResult.hasChanges) {
      console.log('\n✓ No changes detected - you can skip the build!');
      return;
    }

    // Example 2: Build with automatic change detection
    console.log('\n[Step 2] Building Atlas with change detection...');
    const result = await atlas.buildAtlas({
      layers: ['cd'], // Just congressional districts for this example
      states: ['55'], // Wisconsin
      year: 2024,
      qualityThreshold: 80,
    });

    console.log(`\n✓ Atlas build complete!`);
    console.log(`  Job ID: ${result.jobId}`);
    console.log(`  Merkle root: 0x${result.merkleRoot.toString(16).slice(0, 16)}...`);
    console.log(`  Total boundaries: ${result.totalBoundaries}`);
    console.log(`  Duration: ${(result.duration / 1000).toFixed(2)}s`);

    // Example 3: Check again (should show no changes now)
    console.log('\n[Step 3] Checking for changes again (should be none)...');
    const changeResult2 = await atlas.checkForChanges(['cd'], ['55'], 2024);

    console.log(`\nChange detection results:`);
    console.log(`  Has changes: ${changeResult2.hasChanges}`);

    if (!changeResult2.hasChanges) {
      console.log('\n✓ Checksums updated correctly - no changes detected!');
    }
  } finally {
    atlas.close();
  }

  console.log('\n' + '='.repeat(80));
  console.log('EXAMPLE COMPLETE');
  console.log('='.repeat(80));
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
