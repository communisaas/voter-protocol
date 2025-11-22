#!/usr/bin/env node
/**
 * Registry URL Validation Test
 *
 * PURPOSE: Verify all known-portals entries are still accessible and accurate
 *
 * TESTS:
 * - HTTP accessibility (200 OK response)
 * - GeoJSON format validity
 * - Feature count matches registry
 * - Response time acceptable (<5s)
 *
 * USAGE:
 * - Run periodically to detect broken URLs
 * - Run after bulk registry additions
 * - Results inform staleness detection
 */

import { KNOWN_PORTALS } from '../packages/crypto/services/shadow-atlas/registry/known-portals.js';

interface TestResult {
  cityFips: string;
  cityName: string;
  state: string;
  passed: boolean;
  statusCode?: number;
  actualCount?: number;
  expectedCount: number;
  responseTime?: number;
  error?: string;
  warning?: string;
}

async function testUrl(fips: string): Promise<TestResult> {
  const entry = KNOWN_PORTALS[fips];

  const result: TestResult = {
    cityFips: entry.cityFips,
    cityName: entry.cityName,
    state: entry.state,
    passed: false,
    expectedCount: entry.featureCount,
  };

  try {
    const startTime = Date.now();
    const response = await fetch(entry.downloadUrl, {
      signal: AbortSignal.timeout(10000), // 10s timeout
    });
    const responseTime = Date.now() - startTime;

    result.statusCode = response.status;
    result.responseTime = responseTime;

    if (!response.ok) {
      result.error = `HTTP ${response.status}`;
      return result;
    }

    const data = await response.json();
    const actualCount = data.features?.length || 0;

    result.actualCount = actualCount;

    if (actualCount !== entry.featureCount) {
      result.warning = `Count mismatch: expected ${entry.featureCount}, got ${actualCount}`;
    }

    if (responseTime > 5000) {
      result.warning = (result.warning ? result.warning + '; ' : '') + `Slow response: ${responseTime}ms`;
    }

    result.passed = true;
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
}

async function main() {
  const entries = Object.keys(KNOWN_PORTALS);
  const results: TestResult[] = [];

  console.log('='.repeat(80));
  console.log('REGISTRY URL VALIDATION TEST');
  console.log('='.repeat(80));
  console.log();
  console.log(`Testing ${entries.length} registry entries...`);
  console.log();

  // Test sequentially to avoid rate limiting
  for (const fips of entries) {
    const result = await testUrl(fips);
    results.push(result);

    // Real-time feedback
    if (result.passed && !result.warning) {
      console.log(`✅ ${result.cityName}, ${result.state}: ${result.actualCount} features (${result.responseTime}ms)`);
    } else if (result.passed && result.warning) {
      console.log(`⚠️  ${result.cityName}, ${result.state}: ${result.warning}`);
    } else {
      console.log(`❌ ${result.cityName}, ${result.state}: ${result.error}`);
    }

    // Small delay to avoid hammering servers
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log();
  console.log('='.repeat(80));
  console.log('TEST RESULTS');
  console.log('='.repeat(80));

  const passed = results.filter(r => r.passed && !r.warning).length;
  const warnings = results.filter(r => r.passed && r.warning).length;
  const failed = results.filter(r => !r.passed).length;

  console.log();
  console.log(`Total entries tested:  ${entries.length}`);
  console.log(`✅ Passed:            ${passed} (${(passed/entries.length*100).toFixed(1)}%)`);
  console.log(`⚠️  Warnings:          ${warnings} (${(warnings/entries.length*100).toFixed(1)}%)`);
  console.log(`❌ Failed:            ${failed} (${(failed/entries.length*100).toFixed(1)}%)`);
  console.log();

  if (warnings > 0) {
    console.log('WARNINGS (entries with issues):');
    console.log('-'.repeat(80));
    for (const result of results.filter(r => r.passed && r.warning)) {
      console.log(`⚠️  ${result.cityName}, ${result.state}: ${result.warning}`);
    }
    console.log();
  }

  if (failed > 0) {
    console.log('FAILURES (entries requiring attention):');
    console.log('-'.repeat(80));
    for (const result of results.filter(r => !r.passed)) {
      console.log(`❌ ${result.cityName}, ${result.state}: ${result.error}`);
    }
    console.log();
  }

  // Response time statistics
  const responseTimes = results.filter(r => r.responseTime).map(r => r.responseTime!);
  if (responseTimes.length > 0) {
    const avgTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const maxTime = Math.max(...responseTimes);
    const minTime = Math.min(...responseTimes);

    console.log('RESPONSE TIME STATISTICS:');
    console.log('-'.repeat(80));
    console.log(`Average: ${avgTime.toFixed(0)}ms`);
    console.log(`Min:     ${minTime}ms`);
    console.log(`Max:     ${maxTime}ms`);
    console.log();
  }

  if (failed === 0 && warnings === 0) {
    console.log('='.repeat(80));
    console.log('✅ ALL TESTS PASSED - Registry is healthy');
    console.log('='.repeat(80));
  } else if (failed === 0) {
    console.log('='.repeat(80));
    console.log('⚠️  TESTS PASSED WITH WARNINGS - Review entries');
    console.log('='.repeat(80));
  } else {
    console.log('='.repeat(80));
    console.log('❌ TESTS FAILED - Registry requires maintenance');
    console.log('='.repeat(80));
  }
}

main();
