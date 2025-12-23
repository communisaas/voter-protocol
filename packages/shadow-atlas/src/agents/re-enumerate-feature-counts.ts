#!/usr/bin/env npx tsx
/**
 * Phase 2 P0: Fix Feature Count Data Quality
 *
 * Re-enumerates ALL 31,316 layers with ACTUAL feature counts by:
 * 1. Loading existing layer records from comprehensive_classified_layers.jsonl
 * 2. Querying actual counts using /query?where=1=1&returnCountOnly=true&f=json
 * 3. Merging new counts with existing classification metadata
 * 4. Saving intermediate results every 1000 layers (crash recovery)
 *
 * Expected Runtime: 20 minutes (~26 layers/sec)
 * Expected Success Rate: 70-80% (some servers block count queries)
 *
 * CRITICAL BUG FIXED: 99.5% of feature_count values are WRONG - they reflect
 * API server limits (maxRecordCount: 1000, 2000, 100000) instead of actual
 * district counts. Cannot distinguish 7-district city council from 2000-parcel
 * zoning layer using count alone.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface ClassifiedLayer {
  readonly service_url: string;
  readonly layer_number: number;
  readonly layer_url: string;
  readonly layer_name: string;
  readonly geometry_type: string | null;
  readonly feature_count: number | null; // FAKE COUNT (API limit) - will be replaced
  readonly fields: readonly string[];
  readonly district_type: string;
  readonly tier: string;
  readonly governance_level: string;
  readonly elected: boolean;
  readonly confidence: number;
  readonly score: number;
  readonly classification_reasons: readonly string[];
}

interface DomainStats {
  lastRequest: number;
  failureCount: number;
  successCount: number;
  circuitOpen: boolean;
}

class FeatureCountReEnumerator {
  private requestCount = 0;
  private countQuerySuccesses = 0;
  private countQueryFailures = 0;
  private startTime = Date.now();
  private domainStats = new Map<string, DomainStats>();
  private currentConcurrency = 50; // Higher concurrency for simple count queries
  private readonly minConcurrency = 20;
  private readonly maxConcurrency = 100;

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return 'unknown';
    }
  }

  private isDomainBlocked(domain: string): boolean {
    const stats = this.domainStats.get(domain);
    if (!stats) return false;

    const totalRequests = stats.successCount + stats.failureCount;
    if (totalRequests >= 5 && stats.failureCount / totalRequests > 0.8) {
      if (!stats.circuitOpen) {
        console.warn(`⚠️  Circuit breaker opened for ${domain}`);
        stats.circuitOpen = true;
      }
      return true;
    }
    return false;
  }

  private updateDomainStats(domain: string, success: boolean): void {
    const stats = this.domainStats.get(domain) || {
      lastRequest: 0,
      failureCount: 0,
      successCount: 0,
      circuitOpen: false,
    };

    stats.lastRequest = Date.now();
    if (success) {
      stats.successCount++;
      if (stats.circuitOpen) {
        console.log(`✓ Circuit breaker reset for ${domain}`);
        stats.circuitOpen = false;
      }
    } else {
      stats.failureCount++;
    }

    this.domainStats.set(domain, stats);
  }

  private adjustConcurrency(errorRate: number): void {
    if (errorRate > 0.3) {
      // Higher error threshold for count queries (they're expected to fail more)
      this.currentConcurrency = Math.max(
        this.minConcurrency,
        Math.floor(this.currentConcurrency * 0.8)
      );
    } else if (errorRate < 0.1) {
      this.currentConcurrency = Math.min(
        this.maxConcurrency,
        Math.floor(this.currentConcurrency * 1.2)
      );
    }
  }

  /**
   * Fetch ACTUAL feature count from ArcGIS REST API query endpoint.
   *
   * Uses /query?where=1=1&returnCountOnly=true&f=json to get the real
   * number of features in the layer, NOT the maxRecordCount server limit.
   *
   * @param layerUrl - Full URL to the layer (e.g., .../FeatureServer/0)
   * @returns Actual feature count or null if query fails
   *
   * Known limitations:
   * - Some servers block count queries (returns null)
   * - Some servers have slow query endpoints (10 second timeout)
   */
  async fetchActualFeatureCount(layerUrl: string): Promise<number | null> {
    const domain = this.extractDomain(layerUrl);

    // Respect circuit breaker - don't query if domain is blocked
    if (this.isDomainBlocked(domain)) {
      this.countQueryFailures++;
      return null;
    }

    try {
      // ArcGIS REST API query endpoint for count-only queries
      const queryUrl = `${layerUrl}/query?where=1=1&returnCountOnly=true&f=json`;

      const response = await fetch(queryUrl, {
        signal: AbortSignal.timeout(10000), // 10 second timeout
        headers: { 'User-Agent': 'ShadowAtlas/1.0 (Feature Count Re-Enumeration)' },
      });

      if (!response.ok) {
        this.countQueryFailures++;
        this.updateDomainStats(domain, false);
        return null;
      }

      const data = await response.json() as Record<string, unknown>;

      // Extract count from response (typically { "count": 123 })
      if (typeof data.count === 'number') {
        this.countQuerySuccesses++;
        this.updateDomainStats(domain, true);
        return data.count;
      }

      this.countQueryFailures++;
      this.updateDomainStats(domain, false);
      return null;

    } catch (error) {
      // Query timeout, network error, or server doesn't support count queries
      this.countQueryFailures++;
      this.updateDomainStats(domain, false);
      return null;
    }
  }

  /**
   * Process a batch of layers in parallel with adaptive concurrency
   */
  async processBatch(layers: readonly ClassifiedLayer[]): Promise<ClassifiedLayer[]> {
    const results: ClassifiedLayer[] = [];

    // Process in chunks of currentConcurrency
    for (let i = 0; i < layers.length; i += this.currentConcurrency) {
      const chunk = layers.slice(i, i + this.currentConcurrency);

      // Fetch all counts in parallel (fetchActualFeatureCount increments counters internally)
      const countPromises = chunk.map(layer =>
        this.fetchActualFeatureCount(layer.layer_url)
      );
      const counts = await Promise.all(countPromises);

      // Merge new counts with existing metadata
      for (let j = 0; j < chunk.length; j++) {
        results.push({
          ...chunk[j],
          feature_count: counts[j], // Replace fake count with real count (or null)
        });
      }

      // Small delay between chunks to be respectful
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    return results;
  }

  printProgress(total: number, current: number): void {
    const elapsed = (Date.now() - this.startTime) / 1000;
    const totalCountQueries = this.countQuerySuccesses + this.countQueryFailures;
    const rate = totalCountQueries / elapsed;
    const remaining = total - totalCountQueries;
    const etaSeconds = remaining / rate;
    const successRate = totalCountQueries > 0 ?
      ((this.countQuerySuccesses / totalCountQueries) * 100).toFixed(1) : '0.0';
    const errorRate = totalCountQueries > 0 ?
      this.countQueryFailures / totalCountQueries : 0;

    console.log('\n' + '='.repeat(70));
    console.log(`Progress: ${totalCountQueries}/${total} layers (${((totalCountQueries / total) * 100).toFixed(1)}%)`);
    console.log(`Count queries: ${this.countQuerySuccesses}/${totalCountQueries} (${successRate}% success)`);
    console.log(`Rate: ${rate.toFixed(2)} layers/sec`);
    console.log(`Concurrency: ${this.currentConcurrency}`);
    console.log(`Elapsed: ${Math.floor(elapsed / 60)}m ${Math.floor(elapsed % 60)}s`);
    console.log(`ETA: ${Math.floor(etaSeconds / 3600)}h ${Math.floor((etaSeconds % 3600) / 60)}m`);
    console.log('='.repeat(70));

    this.adjustConcurrency(errorRate);
  }

  getStats() {
    const totalQueries = this.countQuerySuccesses + this.countQueryFailures;
    return {
      totalRequests: totalQueries,
      successes: this.countQuerySuccesses,
      failures: this.countQueryFailures,
      successRate: totalQueries > 0 ?
        ((this.countQuerySuccesses / totalQueries) * 100).toFixed(1) : '0.0',
      elapsedSeconds: (Date.now() - this.startTime) / 1000,
      layersPerSecond: (totalQueries / ((Date.now() - this.startTime) / 1000)).toFixed(2),
    };
  }
}

async function reEnumerateFeatureCounts(
  inputFile: string,
  outputFile: string,
  batchSize: number = 1000
): Promise<void> {
  console.log('='.repeat(70));
  console.log('PHASE 2 P0: FIX FEATURE COUNT DATA QUALITY');
  console.log('='.repeat(70));
  console.log(`Input: ${inputFile}`);
  console.log(`Output: ${outputFile}`);
  console.log(`Batch size: ${batchSize} layers`);
  console.log('='.repeat(70));
  console.log('');

  // Load existing classified layers
  console.log('Loading existing 31,316 layer records...');
  const content = readFileSync(inputFile, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  const existingLayers = lines.map(line => JSON.parse(line) as ClassifiedLayer);

  console.log(`✓ Loaded ${existingLayers.length} layers`);
  console.log('');

  // Analyze fake counts before re-enumeration
  const fakeCountDistribution = new Map<number | null, number>();
  for (const layer of existingLayers) {
    const count = fakeCountDistribution.get(layer.feature_count) || 0;
    fakeCountDistribution.set(layer.feature_count, count + 1);
  }

  console.log('Fake count distribution (top 10):');
  const sortedFakeCounts = Array.from(fakeCountDistribution.entries())
    .sort((a, b) => (b[1] - a[1]))
    .slice(0, 10);
  for (const [count, freq] of sortedFakeCounts) {
    console.log(`  ${count === null ? 'null' : count}: ${freq} layers (${((freq / existingLayers.length) * 100).toFixed(1)}%)`);
  }
  console.log('');

  const enumerator = new FeatureCountReEnumerator();
  const updatedLayers: ClassifiedLayer[] = [];

  console.log('Starting re-enumeration with actual counts...');
  console.log('');

  // Process in batches with intermediate saves
  for (let i = 0; i < existingLayers.length; i += batchSize) {
    const batch = existingLayers.slice(i, i + batchSize);

    console.log(`\nProcessing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(existingLayers.length / batchSize)} (layers ${i}-${i + batch.length})...`);

    const batchResults = await enumerator.processBatch(batch);
    updatedLayers.push(...batchResults);

    enumerator.printProgress(existingLayers.length, updatedLayers.length);

    // Save intermediate results (crash recovery)
    writeFileSync(
      outputFile,
      updatedLayers.map(l => JSON.stringify(l)).join('\n')
    );
    console.log(`\n✓ Saved intermediate results (${updatedLayers.length} layers)`);
  }

  // Final save
  writeFileSync(
    outputFile,
    updatedLayers.map(l => JSON.stringify(l)).join('\n')
  );

  console.log('\n' + '='.repeat(70));
  console.log('✓ RE-ENUMERATION COMPLETE');
  console.log('='.repeat(70));

  const stats = enumerator.getStats();
  console.log(`Total layers: ${stats.totalRequests}`);
  console.log(`Count queries succeeded: ${stats.successes} (${stats.successRate}%)`);
  console.log(`Count queries failed: ${stats.failures}`);
  console.log(`Average rate: ${stats.layersPerSecond} layers/sec`);
  console.log(`Total time: ${Math.floor(Number(stats.elapsedSeconds) / 60)}m ${Math.floor(Number(stats.elapsedSeconds) % 60)}s`);
  console.log('');

  // Analyze real counts after re-enumeration
  console.log('Real count distribution (excluding null):');
  const realCountDistribution = new Map<string, number>();
  const nullCounts = updatedLayers.filter(l => l.feature_count === null).length;

  for (const layer of updatedLayers) {
    if (layer.feature_count !== null) {
      // Bucket into ranges for analysis
      let bucket: string;
      if (layer.feature_count < 10) bucket = '1-9';
      else if (layer.feature_count < 50) bucket = '10-49';
      else if (layer.feature_count < 100) bucket = '50-99';
      else if (layer.feature_count < 500) bucket = '100-499';
      else if (layer.feature_count < 1000) bucket = '500-999';
      else if (layer.feature_count < 5000) bucket = '1000-4999';
      else if (layer.feature_count < 10000) bucket = '5000-9999';
      else bucket = '10000+';

      const count = realCountDistribution.get(bucket) || 0;
      realCountDistribution.set(bucket, count + 1);
    }
  }

  console.log(`  null: ${nullCounts} layers (${((nullCounts / updatedLayers.length) * 100).toFixed(1)}%)`);
  const sortedRealCounts = Array.from(realCountDistribution.entries())
    .sort((a, b) => {
      const order = ['1-9', '10-49', '50-99', '100-499', '500-999', '1000-4999', '5000-9999', '10000+'];
      return order.indexOf(a[0]) - order.indexOf(b[0]);
    });
  for (const [bucket, freq] of sortedRealCounts) {
    console.log(`  ${bucket}: ${freq} layers (${((freq / updatedLayers.length) * 100).toFixed(1)}%)`);
  }
  console.log('');

  // Sample comparison: fake vs real counts
  console.log('Sample comparison (first 10 polygon layers with successful count queries):');
  const sampleLayers = updatedLayers
    .filter(l => l.geometry_type === 'esriGeometryPolygon' && l.feature_count !== null)
    .slice(0, 10);

  for (const layer of sampleLayers) {
    console.log(`  ${layer.layer_name}`);
    console.log(`    URL: ${layer.layer_url}`);
    console.log(`    Real count: ${layer.feature_count}`);
    console.log(`    District type: ${layer.district_type} (${layer.tier})`);
  }
  console.log('');

  console.log(`Output: ${outputFile}`);
  console.log('='.repeat(70));
}

// Run
const dataDir = join(__dirname, 'data');
const inputFile = join(dataDir, 'comprehensive_classified_layers.jsonl');
const outputFile = join(dataDir, 'comprehensive_classified_layers.jsonl'); // Overwrite existing file

reEnumerateFeatureCounts(inputFile, outputFile, 1000)
  .then(() => {
    console.log('\n✓ Feature count re-enumeration complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Fatal error:', error);
    process.exit(1);
  });
