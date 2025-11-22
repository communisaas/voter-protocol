#!/usr/bin/env tsx
/**
 * Analyze Batch Results - Post-Execution Analytics
 *
 * PURPOSE: Comprehensive analysis of batch discovery outcomes
 * USAGE: npm run atlas:analyze-batch-results
 * OUTPUT: Success rate, tier breakdown, blocker analysis, recommendations
 */

import { queryProvenance, type ProvenanceEntry } from '../services/provenance-writer.js';
import { analyzeCoverage } from '../services/coverage-analyzer.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * City data structure
 */
interface City {
  readonly fips: string;
  readonly name: string;
  readonly state: string;
  readonly population: number;
}

/**
 * Load city database
 */
async function loadCityDatabase(): Promise<City[]> {
  const dataPath = join(__dirname, '../data/us-cities-top-1000.json');
  const content = await readFile(dataPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Filter provenance entries by date range
 */
function filterByDate(
  entries: ProvenanceEntry[],
  startDate: Date,
  endDate?: Date
): ProvenanceEntry[] {
  const end = endDate || new Date();

  return entries.filter((entry) => {
    const entryDate = new Date(entry.ts);
    return entryDate >= startDate && entryDate <= end;
  });
}

/**
 * Calculate tier distribution
 */
function calculateTierDistribution(entries: ProvenanceEntry[]): Record<number, number> {
  const successful = entries.filter((e) => e.blocked === null);
  const tierCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };

  for (const entry of successful) {
    tierCounts[entry.g] = (tierCounts[entry.g] || 0) + 1;
  }

  return tierCounts;
}

/**
 * Calculate blocker distribution
 */
function calculateBlockerDistribution(
  entries: ProvenanceEntry[]
): Array<{ blocker: string; count: number; percentage: number }> {
  const failed = entries.filter((e) => e.blocked !== null);
  const blockerCounts = new Map<string, number>();

  for (const entry of failed) {
    const count = blockerCounts.get(entry.blocked!) || 0;
    blockerCounts.set(entry.blocked!, count + 1);
  }

  const blockers = Array.from(blockerCounts.entries())
    .map(([blocker, count]) => ({
      blocker,
      count,
      percentage: (count / failed.length) * 100,
    }))
    .sort((a, b) => b.count - a.count);

  return blockers;
}

/**
 * Calculate state-level statistics
 */
function calculateStateStats(
  entries: ProvenanceEntry[]
): Array<{ state: string; total: number; successful: number; successRate: number }> {
  const byState = new Map<string, { total: number; successful: number }>();

  for (const entry of entries) {
    if (!entry.s) continue;

    const stats = byState.get(entry.s) || { total: 0, successful: 0 };
    stats.total++;
    if (entry.blocked === null && entry.g <= 1) {
      stats.successful++;
    }
    byState.set(entry.s, stats);
  }

  const stateStats = Array.from(byState.entries())
    .map(([state, stats]) => ({
      state,
      total: stats.total,
      successful: stats.successful,
      successRate: (stats.successful / stats.total) * 100,
    }))
    .sort((a, b) => b.total - a.total);

  return stateStats;
}

/**
 * Generate recommendations based on batch results
 */
function generateRecommendations(
  successRate: number,
  tierCounts: Record<number, number>,
  topBlockers: Array<{ blocker: string; count: number }>
): string[] {
  const recommendations: string[] = [];

  // Success rate recommendations
  if (successRate < 70) {
    recommendations.push(
      `⚠️  Low success rate (${successRate.toFixed(1)}%) - Review common blockers and improve discovery paths`
    );
  } else if (successRate >= 80) {
    recommendations.push(
      `✅ Excellent success rate (${successRate.toFixed(1)}%) - Scale to next 100 cities`
    );
  }

  // Tier quality recommendations
  const tier01Percentage = ((tierCounts[0] + tierCounts[1]) / Object.values(tierCounts).reduce((sum, c) => sum + c, 0)) * 100;

  if (tier01Percentage < 15) {
    recommendations.push(
      `📊 Low Tier 0-1 coverage (${tier01Percentage.toFixed(1)}%) - Expand known-portals registry`
    );
  } else if (tier01Percentage >= 25) {
    recommendations.push(
      `📊 Strong Tier 0-1 coverage (${tier01Percentage.toFixed(1)}%) - Add discoveries to registry`
    );
  }

  // Blocker-specific recommendations
  for (const { blocker, count } of topBlockers.slice(0, 3)) {
    if (blocker === 'NOT_FOUND_NO_HUB_MATCH' && count > 20) {
      recommendations.push(
        `🔍 High NOT_FOUND rate (${count} cities) - Expand GIS server exploration patterns`
      );
    } else if (blocker === 'ERROR_HTTP_TIMEOUT' && count > 10) {
      recommendations.push(
        `⏱️  HTTP timeouts (${count} cities) - Increase timeout limits or retry with backoff`
      );
    } else if (blocker === 'VALIDATION_FAILED_FEATURE_COUNT' && count > 5) {
      recommendations.push(
        `❌ Validation failures (${count} cities) - Review feature count thresholds`
      );
    }
  }

  return recommendations;
}

/**
 * Main analysis function
 */
async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   PRODUCTION BATCH - RESULTS ANALYSIS               ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log();

  // Load data
  const allEntries = await queryProvenance({}, './discovery-attempts');
  const cityDatabase = await loadCityDatabase();

  // Filter to today's batch (last 24 hours)
  const batchStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const batchEntries = filterByDate(allEntries, batchStart);

  console.log(`📊 Batch Statistics`);
  console.log(`   Date Range: ${batchStart.toISOString().split('T')[0]} - ${new Date().toISOString().split('T')[0]}`);
  console.log(`   Total Entries: ${batchEntries.length}`);
  console.log();

  // Success rate
  const successful = batchEntries.filter((e) => e.blocked === null);
  const successRate = batchEntries.length > 0 ? (successful.length / batchEntries.length) * 100 : 0;

  console.log(`✅ Success Rate: ${successRate.toFixed(1)}% (${successful.length}/${batchEntries.length})`);
  console.log();

  // Tier breakdown
  const tierCounts = calculateTierDistribution(batchEntries);
  const totalSuccessful = Object.values(tierCounts).reduce((sum, count) => sum + count, 0);

  console.log(`📈 Tier Breakdown:`);
  console.log(`   Tier 0 (Precincts):  ${tierCounts[0]} cities (${totalSuccessful > 0 ? ((tierCounts[0] / totalSuccessful) * 100).toFixed(1) : 0}%)`);
  console.log(`   Tier 1 (Districts):  ${tierCounts[1]} cities (${totalSuccessful > 0 ? ((tierCounts[1] / totalSuccessful) * 100).toFixed(1) : 0}%)`);
  console.log(`   Tier 2 (Municipal):  ${tierCounts[2]} cities (${totalSuccessful > 0 ? ((tierCounts[2] / totalSuccessful) * 100).toFixed(1) : 0}%)`);
  console.log(`   Tier 3 (County):     ${tierCounts[3]} cities (${totalSuccessful > 0 ? ((tierCounts[3] / totalSuccessful) * 100).toFixed(1) : 0}%)`);
  console.log();

  // Blocker analysis
  const blockers = calculateBlockerDistribution(batchEntries);

  console.log(`🚫 Top Blockers:`);
  for (const { blocker, count, percentage } of blockers.slice(0, 5)) {
    console.log(`   ${blocker}: ${count} (${percentage.toFixed(1)}%)`);
  }
  console.log();

  // State-level statistics
  const stateStats = calculateStateStats(batchEntries);

  console.log(`🗺️  State-Level Statistics (Top 10):`);
  for (const { state, total, successful, successRate: stateSuccessRate } of stateStats.slice(0, 10)) {
    console.log(`   ${state}: ${successful}/${total} (${stateSuccessRate.toFixed(0)}% success)`);
  }
  console.log();

  // Coverage impact
  const coverage = await analyzeCoverage(cityDatabase);

  console.log(`📍 Coverage Impact:`);
  console.log(`   Total Coverage: ${coverage.coveragePercent.toFixed(1)}%`);
  console.log(`   Cities with Tier 0-1: ${coverage.coveredCities}`);
  console.log(`   Top Gaps Remaining: ${coverage.topGaps.length}`);
  console.log();

  // Quality metrics
  const avgConfidence = successful.length > 0
    ? successful.reduce((sum, e) => sum + e.conf, 0) / successful.length
    : 0;

  const lowConfidence = successful.filter((e) => e.conf < 70).length;

  console.log(`🎯 Quality Metrics:`);
  console.log(`   Average Confidence: ${avgConfidence.toFixed(1)}/100`);
  console.log(`   Low Confidence (<70): ${lowConfidence} cities (${successful.length > 0 ? ((lowConfidence / successful.length) * 100).toFixed(1) : 0}%)`);
  console.log();

  // Recommendations
  const recommendations = generateRecommendations(
    successRate,
    tierCounts,
    blockers.map(({ blocker, count }) => ({ blocker, count }))
  );

  console.log(`💡 Recommendations:`);
  for (const recommendation of recommendations) {
    console.log(`   ${recommendation}`);
  }
  console.log();

  // High-value registry candidates
  const registryCandidates = successful.filter((e) => e.g <= 1 && e.conf >= 80);

  console.log(`🎖️  High-Value Registry Candidates:`);
  console.log(`   Tier 0-1 with confidence ≥80: ${registryCandidates.length} cities`);
  if (registryCandidates.length > 0) {
    console.log();
    console.log(`   Top 10 Candidates:`);
    for (const entry of registryCandidates.slice(0, 10)) {
      console.log(`     - ${entry.n}, ${entry.s} (Tier ${entry.g}, Conf ${entry.conf})`);
    }
  }
  console.log();

  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('Analysis complete!');
  console.log();
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main };
