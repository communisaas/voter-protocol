#!/usr/bin/env npx tsx
/**
 * Pilot Ingestion Script - Wisconsin
 *
 * Validates the full Shadow Atlas pipeline before national rollout.
 * Downloads TIGER data, validates, builds Merkle tree.
 */

import { ShadowAtlasService } from '../core/shadow-atlas-service.js';
import { createConfig } from '../core/config.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUTPUT_DIR = join(process.cwd(), 'pilot-output');

async function runPilot(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Shadow Atlas Pilot Ingestion - Wisconsin (FIPS 55)');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Create output directory
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Initialize service
  console.log('⏳ Initializing ShadowAtlasService...');
  const config = createConfig({
    storageDir: OUTPUT_DIR,
    persistence: {
      enabled: true,
      databasePath: join(OUTPUT_DIR, 'pilot.db'),
      autoMigrate: true,
    },
    extraction: {
      concurrency: 4,
      retryAttempts: 3,
      retryDelayMs: 1000,
      timeoutMs: 60000,
    },
    validation: {
      minPassRate: 0.8,
      crossValidate: false,
      storeResults: true,
    },
    ipfs: {
      gateway: 'https://ipfs.io/ipfs/',
    },
    // Disable cross-validation for pilot run (faster)
    crossValidation: {
      enabled: false,
      failOnMismatch: false,
      minQualityScore: 70,
      gracefulFallback: true,
    },
  });
  const atlas = new ShadowAtlasService(config);

  await atlas.initialize();
  console.log('✅ Service initialized\n');

  // Run pilot ingestion
  console.log('🚀 Starting pilot ingestion...\n');
  const startTime = Date.now();

  try {
    const result = await atlas.buildAtlas({
      layers: ['cd', 'sldu', 'sldl', 'county'],
      states: ['55'], // Wisconsin
      year: 2024,
      qualityThreshold: 80,
      outputPath: join(OUTPUT_DIR, 'wisconsin-atlas.json'),
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  ✅ PILOT INGESTION COMPLETE');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log(`📊 Results:`);
    console.log(`   Job ID:           ${result.jobId}`);
    console.log(`   Merkle Root:      0x${result.merkleRoot.toString(16).slice(0, 16)}...`);
    console.log(`   Total Boundaries: ${result.totalBoundaries}`);
    console.log(`   Tree Depth:       ${result.treeDepth}`);
    console.log(`   Duration:         ${duration}s`);
    console.log(`   Timestamp:        ${result.timestamp.toISOString()}`);

    console.log(`\n📋 Layer Breakdown:`);
    for (const [layer, count] of Object.entries(result.layerCounts)) {
      console.log(`   ${layer}: ${count}`);
    }

    console.log(`\n🔍 Validation Results:`);
    for (const validation of result.layerValidations) {
      const status = validation.qualityScore >= 80 ? '✅' : '⚠️';
      console.log(`   ${status} ${validation.layer}: ${validation.qualityScore.toFixed(1)}% quality (${validation.boundaryCount}/${validation.expectedCount} boundaries)`);
    }

    // Write summary to file
    const summary = {
      pilot: 'Wisconsin (FIPS 55)',
      timestamp: new Date().toISOString(),
      jobId: result.jobId,
      merkleRoot: `0x${result.merkleRoot.toString(16)}`,
      totalBoundaries: result.totalBoundaries,
      treeDepth: result.treeDepth,
      durationSeconds: parseFloat(duration),
      layerCounts: result.layerCounts,
      validations: result.layerValidations.map(v => ({
        layer: v.layer,
        qualityScore: v.qualityScore,
        boundaryCount: v.boundaryCount,
        expectedCount: v.expectedCount,
      })),
    };

    await writeFile(
      join(OUTPUT_DIR, 'pilot-summary.json'),
      JSON.stringify(summary, null, 2)
    );
    console.log(`\n📁 Output written to: ${OUTPUT_DIR}/`);
    console.log(`   - wisconsin-atlas.json`);
    console.log(`   - pilot-summary.json`);
    console.log(`   - pilot.db`);

  } catch (error) {
    console.error('\n❌ Pilot ingestion failed:', error);
    process.exit(1);
  } finally {
    atlas.close();
  }
}

runPilot().catch(console.error);
