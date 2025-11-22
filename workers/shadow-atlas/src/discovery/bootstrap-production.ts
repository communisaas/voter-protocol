/**
 * Production Bootstrap Workflow - Hub API Discovery
 *
 * Maximum throughput, resumable, efficient, FREE
 *
 * Usage:
 *   npm run bootstrap:discovery           # Full run (19,616 cities)
 *   npm run bootstrap:discovery -- --top 1000   # Top 1000 cities only
 *   npm run bootstrap:discovery -- --resume     # Resume from last checkpoint
 *   npm run bootstrap:discovery -- --test       # Test with 5 cities
 */

import { searchHubForCouncilDistricts, type DiscoveryResult } from './hub-api-discovery';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG = {
  // Parallelism: How many cities to process simultaneously
  BATCH_SIZE: 10, // 10 concurrent requests = ~0.5s per batch = very fast

  // Rate limiting: Delay between batches (ms)
  BATCH_DELAY: 100, // 100ms between batches = respectful to API

  // Checkpoint: Save progress every N cities
  CHECKPOINT_INTERVAL: 100,

  // Output directory
  OUTPUT_DIR: './data/discovery',

  // Results file
  RESULTS_FILE: 'hub-api-results.json',

  // Progress file (for resuming)
  PROGRESS_FILE: 'bootstrap-progress.json'
};

interface Municipality {
  id: string;
  name: string;
  state: string;
  population?: number;
}

interface BootstrapResult {
  municipality: Municipality;
  discovery: DiscoveryResult | null;
  timestamp: string;
  attemptNumber: number;
}

interface BootstrapProgress {
  startTime: string;
  lastCheckpoint: string;
  processedCount: number;
  successCount: number;
  failureCount: number;
  lastProcessedId: string;
  estimatedTimeRemaining: string;
}

/**
 * Load municipalities from database or test data
 */
async function loadMunicipalities(options: {
  top?: number;
  test?: boolean;
  resume?: boolean;
  resumeFrom?: string;
}): Promise<Municipality[]> {
  // For testing: Use hardcoded top cities
  if (options.test) {
    return [
      { id: 'tx-austin', name: 'Austin', state: 'TX', population: 961855 },
      { id: 'ca-san-francisco', name: 'San Francisco', state: 'CA', population: 873965 },
      { id: 'il-chicago', name: 'Chicago', state: 'IL', population: 2746388 },
      { id: 'wa-seattle', name: 'Seattle', state: 'WA', population: 749256 },
      { id: 'or-portland', name: 'Portland', state: 'OR', population: 652503 }
    ];
  }

  // TODO: Load from D1 database
  // For now, load from Census data file if available
  const dataPath = path.join(__dirname, '../../data/municipalities.json');

  if (!fs.existsSync(dataPath)) {
    console.error(`❌ Municipality data not found at: ${dataPath}`);
    console.log('\n💡 Run bootstrap first to load Census TIGER data');
    process.exit(1);
  }

  let municipalities: Municipality[] = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  // Sort by population (descending) for top-N processing
  municipalities.sort((a, b) => (b.population || 0) - (a.population || 0));

  // Resume from checkpoint
  if (options.resume && options.resumeFrom) {
    const resumeIndex = municipalities.findIndex(m => m.id === options.resumeFrom);
    if (resumeIndex >= 0) {
      municipalities = municipalities.slice(resumeIndex);
      console.log(`📍 Resuming from: ${options.resumeFrom} (${resumeIndex} cities skipped)`);
    }
  }

  // Limit to top N
  if (options.top && options.top > 0) {
    municipalities = municipalities.slice(0, options.top);
  }

  return municipalities;
}

/**
 * Process a batch of municipalities in parallel
 */
async function processBatch(
  municipalities: Municipality[],
  batchNumber: number,
  totalBatches: number
): Promise<BootstrapResult[]> {
  const startTime = Date.now();

  console.log(`\n[${'='.repeat(60)}]`);
  console.log(`Batch ${batchNumber}/${totalBatches} - ${municipalities.length} cities`);
  console.log(`[${'='.repeat(60)}]`);

  const results = await Promise.all(
    municipalities.map(async (muni, index) => {
      const globalIndex = (batchNumber - 1) * CONFIG.BATCH_SIZE + index + 1;

      console.log(`\n[${globalIndex}] Processing: ${muni.name}, ${muni.state}`);

      const discovery = await searchHubForCouncilDistricts(muni.name, muni.state);

      if (discovery) {
        console.log(`   ✅ SUCCESS - Score: ${discovery.score}/100`);
      } else {
        console.log(`   ❌ FAILED - No data found`);
      }

      return {
        municipality: muni,
        discovery,
        timestamp: new Date().toISOString(),
        attemptNumber: 1
      };
    })
  );

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n⏱️  Batch completed in ${elapsed.toFixed(1)}s`);

  return results;
}

/**
 * Save results to disk
 */
function saveResults(results: BootstrapResult[], mode: 'append' | 'overwrite' = 'append') {
  const outputDir = path.join(__dirname, '../..', CONFIG.OUTPUT_DIR);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, CONFIG.RESULTS_FILE);

  let allResults: BootstrapResult[] = results;

  if (mode === 'append' && fs.existsSync(outputPath)) {
    const existing = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    allResults = [...existing, ...results];
  }

  fs.writeFileSync(outputPath, JSON.stringify(allResults, null, 2));
  console.log(`\n💾 Saved ${allResults.length} results to: ${outputPath}`);
}

/**
 * Save checkpoint for resuming
 */
function saveCheckpoint(progress: BootstrapProgress) {
  const outputDir = path.join(__dirname, '../..', CONFIG.OUTPUT_DIR);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const checkpointPath = path.join(outputDir, CONFIG.PROGRESS_FILE);
  fs.writeFileSync(checkpointPath, JSON.stringify(progress, null, 2));
}

/**
 * Load checkpoint for resuming
 */
function loadCheckpoint(): BootstrapProgress | null {
  const checkpointPath = path.join(__dirname, '../..', CONFIG.OUTPUT_DIR, CONFIG.PROGRESS_FILE);

  if (fs.existsSync(checkpointPath)) {
    return JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
  }

  return null;
}

/**
 * Main bootstrap workflow
 */
async function bootstrap(options: {
  top?: number;
  test?: boolean;
  resume?: boolean;
}) {
  console.log('\n' + '='.repeat(80));
  console.log('🚀 SHADOW ATLAS - PRODUCTION BOOTSTRAP');
  console.log('='.repeat(80));
  console.log('\nHub API Discovery - Maximum Throughput Mode');
  console.log(`Batch size: ${CONFIG.BATCH_SIZE} concurrent requests`);
  console.log(`Rate limit: ${CONFIG.BATCH_DELAY}ms between batches`);
  console.log(`Checkpoint interval: Every ${CONFIG.CHECKPOINT_INTERVAL} cities\n`);

  // Load checkpoint if resuming
  let checkpoint: BootstrapProgress | null = null;
  if (options.resume) {
    checkpoint = loadCheckpoint();
    if (checkpoint) {
      console.log(`📍 Resuming from checkpoint:`);
      console.log(`   Processed: ${checkpoint.processedCount} cities`);
      console.log(`   Success: ${checkpoint.successCount}`);
      console.log(`   Failed: ${checkpoint.failureCount}`);
      console.log(`   Last ID: ${checkpoint.lastProcessedId}\n`);
    }
  }

  // Load municipalities
  const municipalities = await loadMunicipalities({
    ...options,
    resumeFrom: checkpoint?.lastProcessedId
  });

  const totalCities = municipalities.length;
  const totalBatches = Math.ceil(totalCities / CONFIG.BATCH_SIZE);

  console.log(`📊 Total cities to process: ${totalCities}`);
  console.log(`📦 Total batches: ${totalBatches}`);
  console.log(`⏱️  Estimated time: ${(totalCities * 2.2 / 60).toFixed(1)} minutes\n`);

  // Initialize progress
  const startTime = Date.now();
  let processedCount = checkpoint?.processedCount || 0;
  let successCount = checkpoint?.successCount || 0;
  let failureCount = checkpoint?.failureCount || 0;
  let allResults: BootstrapResult[] = [];

  // Process in batches
  for (let i = 0; i < totalBatches; i++) {
    const batchStart = i * CONFIG.BATCH_SIZE;
    const batchEnd = Math.min(batchStart + CONFIG.BATCH_SIZE, totalCities);
    const batch = municipalities.slice(batchStart, batchEnd);

    // Process batch
    const results = await processBatch(batch, i + 1, totalBatches);
    allResults.push(...results);

    // Update counters
    processedCount += results.length;
    successCount += results.filter(r => r.discovery !== null).length;
    failureCount += results.filter(r => r.discovery === null).length;

    // Checkpoint progress
    if (processedCount % CONFIG.CHECKPOINT_INTERVAL === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processedCount / elapsed;
      const remaining = totalCities - processedCount;
      const estimatedRemaining = remaining / rate;

      const progress: BootstrapProgress = {
        startTime: new Date(startTime).toISOString(),
        lastCheckpoint: new Date().toISOString(),
        processedCount,
        successCount,
        failureCount,
        lastProcessedId: results[results.length - 1].municipality.id,
        estimatedTimeRemaining: `${(estimatedRemaining / 60).toFixed(1)} minutes`
      };

      saveCheckpoint(progress);
      saveResults(allResults, 'append');
      allResults = []; // Clear memory

      console.log(`\n📍 CHECKPOINT ${processedCount}/${totalCities}`);
      console.log(`   Success: ${successCount} (${(successCount/processedCount*100).toFixed(1)}%)`);
      console.log(`   Failed: ${failureCount} (${(failureCount/processedCount*100).toFixed(1)}%)`);
      console.log(`   Rate: ${rate.toFixed(1)} cities/sec`);
      console.log(`   Remaining: ${progress.estimatedTimeRemaining}`);
    }

    // Rate limiting: Delay between batches
    if (i < totalBatches - 1) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.BATCH_DELAY));
    }
  }

  // Save final results
  if (allResults.length > 0) {
    saveResults(allResults, 'append');
  }

  // Print final summary
  const totalTime = (Date.now() - startTime) / 1000;
  const successRate = (successCount / processedCount * 100);

  console.log('\n\n' + '='.repeat(80));
  console.log('📊 BOOTSTRAP COMPLETE');
  console.log('='.repeat(80));
  console.log(`\n✅ Successful: ${successCount}/${processedCount} (${successRate.toFixed(1)}%)`);
  console.log(`❌ Failed: ${failureCount}/${processedCount} (${(100-successRate).toFixed(1)}%)`);
  console.log(`⏱️  Total time: ${(totalTime / 60).toFixed(1)} minutes`);
  console.log(`⚡ Average rate: ${(processedCount / totalTime).toFixed(1)} cities/sec`);
  console.log(`💾 Results saved to: ${CONFIG.OUTPUT_DIR}/${CONFIG.RESULTS_FILE}`);

  // Success threshold
  if (successRate >= 90) {
    console.log('\n🎉 EXCELLENT: 90%+ success rate achieved!');
  } else if (successRate >= 75) {
    console.log('\n✅ GOOD: 75%+ success rate achieved');
  } else {
    console.log('\n⚠️  WARNING: Success rate below 75%');
  }

  console.log('');
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: { top?: number; test?: boolean; resume?: boolean } = {};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--top' && args[i + 1]) {
    options.top = parseInt(args[i + 1]);
    i++;
  } else if (args[i] === '--test') {
    options.test = true;
  } else if (args[i] === '--resume') {
    options.resume = true;
  }
}

// Run bootstrap
bootstrap(options).catch(error => {
  console.error('\n💥 FATAL ERROR:', error);
  process.exit(1);
});
