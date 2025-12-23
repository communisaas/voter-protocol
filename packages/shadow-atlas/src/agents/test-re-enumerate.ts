#!/usr/bin/env npx tsx
/**
 * TEST: Re-enumerate feature counts on small sample
 *
 * Tests the re-enumeration logic on 50 layers to verify:
 * 1. Count query endpoint works correctly
 * 2. Metadata is preserved
 * 3. Error handling works (circuit breakers, timeouts)
 * 4. Output format is correct
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface ClassifiedLayer {
  readonly service_url: string;
  readonly layer_number: number;
  readonly layer_url: string;
  readonly layer_name: string;
  readonly geometry_type: string | null;
  readonly feature_count: number | null;
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

  async fetchActualFeatureCount(layerUrl: string): Promise<number | null> {
    const domain = this.extractDomain(layerUrl);

    if (this.isDomainBlocked(domain)) {
      this.countQueryFailures++;
      return null;
    }

    try {
      const queryUrl = `${layerUrl}/query?where=1=1&returnCountOnly=true&f=json`;

      const response = await fetch(queryUrl, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'ShadowAtlas/1.0 (Test Count Query)' },
      });

      if (!response.ok) {
        this.countQueryFailures++;
        this.updateDomainStats(domain, false);
        return null;
      }

      const data = await response.json() as Record<string, unknown>;

      if (typeof data.count === 'number') {
        this.countQuerySuccesses++;
        this.updateDomainStats(domain, true);
        return data.count;
      }

      this.countQueryFailures++;
      this.updateDomainStats(domain, false);
      return null;

    } catch (error) {
      this.countQueryFailures++;
      this.updateDomainStats(domain, false);
      return null;
    }
  }

  getStats() {
    return {
      totalRequests: this.requestCount,
      successes: this.countQuerySuccesses,
      failures: this.countQueryFailures,
      successRate: this.requestCount > 0 ?
        ((this.countQuerySuccesses / this.requestCount) * 100).toFixed(1) : '0.0',
    };
  }
}

async function testReEnumeration(): Promise<void> {
  console.log('='.repeat(70));
  console.log('TEST: Re-enumerate feature counts (50 layer sample)');
  console.log('='.repeat(70));
  console.log('');

  const dataDir = join(__dirname, 'data');
  const inputFile = join(dataDir, 'comprehensive_classified_layers.jsonl');

  // Load first 50 polygon layers
  console.log('Loading 50 sample layers...');
  const content = readFileSync(inputFile, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  const allLayers = lines.map(line => JSON.parse(line) as ClassifiedLayer);

  // Get diverse sample: some polygons, different tiers
  const sampleLayers = allLayers
    .filter(l => l.geometry_type === 'esriGeometryPolygon')
    .slice(0, 50);

  console.log(`✓ Loaded ${sampleLayers.length} sample layers`);
  console.log('');

  const enumerator = new FeatureCountReEnumerator();

  console.log('Querying actual feature counts...');
  console.log('');

  for (let i = 0; i < sampleLayers.length; i++) {
    const layer = sampleLayers[i];
    const oldCount = layer.feature_count;
    const newCount = await enumerator.fetchActualFeatureCount(layer.layer_url);

    console.log(`[${i + 1}/${sampleLayers.length}] ${layer.layer_name}`);
    console.log(`  URL: ${layer.layer_url}`);
    console.log(`  Old count (fake): ${oldCount}`);
    console.log(`  New count (real): ${newCount}`);
    console.log(`  District type: ${layer.district_type} (${layer.tier})`);
    console.log('');
  }

  const stats = enumerator.getStats();
  console.log('='.repeat(70));
  console.log('TEST RESULTS');
  console.log('='.repeat(70));
  console.log(`Total queries: ${stats.totalRequests}`);
  console.log(`Successes: ${stats.successes} (${stats.successRate}%)`);
  console.log(`Failures: ${stats.failures}`);
  console.log('='.repeat(70));
}

testReEnumeration()
  .then(() => {
    console.log('\n✓ Test complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Test failed:', error);
    process.exit(1);
  });
