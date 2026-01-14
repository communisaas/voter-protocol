/**
 * Coverage Analyzer - Real-Time Gap Detection
 *
 * PURPOSE: Track which cities have boundaries and which need discovery
 * STRATEGY: Cross-reference provenance logs with city database
 * SCALE: 19,495 US cities
 *
 * CRITICAL TYPE SAFETY: Coverage analysis drives autonomous agent decisions.
 * Loose types create false priorities that waste discovery budget.
 */

import { queryProvenance, type ProvenanceEntry } from './provenance-writer.js';
import { KNOWN_PORTALS, type KnownPortal, isStale } from '../core/registry/known-portals.js';

/**
 * Coverage status for a city
 */
export interface CityCoverage {
  readonly fips: string;
  readonly cityName: string;
  readonly state: string;
  readonly population: number;
  readonly tier: number | null; // Granularity tier (0-4) or null if no data
  readonly confidence: number | null; // Confidence score or null
  readonly dataSource: 'known-portal' | 'discovery' | 'none';
  readonly lastUpdated: string | null; // ISO timestamp or null
  readonly needsDiscovery: boolean;
  readonly priority: number; // Population-weighted priority
}

/**
 * Coverage statistics
 */
export interface CoverageStats {
  readonly totalCities: number;
  readonly coveredCities: number;
  readonly coveragePercent: number;
  readonly byTier: Record<number, number>;
  readonly byState: Record<string, { total: number; covered: number }>;
  readonly topGaps: readonly CityCoverage[]; // Top 20 uncovered cities by population
}

/**
 * City input for coverage analysis
 */
export interface CityInput {
  readonly fips: string;
  readonly name: string;
  readonly state: string;
  readonly population: number;
}

/**
 * Analyze coverage across all US cities
 *
 * @param cityList - List of cities to analyze (FIPS, name, state, population)
 * @param baseDir - Provenance log directory
 * @returns Coverage analysis
 */
export async function analyzeCoverage(
  cityList: readonly CityInput[],
  baseDir: string = './discovery-attempts'
): Promise<CoverageStats> {
  // Get all provenance entries
  const allEntries = await queryProvenance({}, baseDir);

  // Build FIPS → latest entry map
  const latestEntries = new Map<string, ProvenanceEntry>();
  for (const entry of allEntries) {
    const existing = latestEntries.get(entry.f);
    if (!existing || entry.ts > existing.ts) {
      latestEntries.set(entry.f, entry);
    }
  }

  // Analyze each city
  const coverage: CityCoverage[] = [];
  const byTier: Record<number, number> = {};
  const byState: Record<string, { total: number; covered: number }> = {};

  for (const city of cityList) {
    // Check known portals first
    const inKnownPortals = KNOWN_PORTALS[city.fips];

    // Check provenance logs
    const provenanceEntry = latestEntries.get(city.fips);

    let tier: number | null = null;
    let confidence: number | null = null;
    let dataSource: 'known-portal' | 'discovery' | 'none' = 'none';
    let lastUpdated: string | null = null;

    if (inKnownPortals) {
      // Known portal takes precedence
      tier = 1; // Known portals are council districts (tier 1)
      confidence = inKnownPortals.confidence;
      dataSource = 'known-portal';
      lastUpdated = inKnownPortals.lastVerified;
    } else if (provenanceEntry && provenanceEntry.blocked === null) {
      // Successful discovery
      tier = provenanceEntry.g;
      confidence = provenanceEntry.conf;
      dataSource = 'discovery';
      lastUpdated = provenanceEntry.ts;
    }

    const needsDiscovery = tier === null || tier > 1; // Need better granularity

    coverage.push({
      fips: city.fips,
      cityName: city.name,
      state: city.state,
      population: city.population,
      tier,
      confidence,
      dataSource,
      lastUpdated,
      needsDiscovery,
      priority: city.population, // Use population as priority
    });

    // Track stats
    if (tier !== null) {
      byTier[tier] = (byTier[tier] || 0) + 1;
    }

    if (!byState[city.state]) {
      byState[city.state] = { total: 0, covered: 0 };
    }
    byState[city.state].total++;
    if (tier !== null && tier <= 1) {
      byState[city.state].covered++;
    }
  }

  // Calculate top gaps
  const gaps = coverage.filter((c) => c.needsDiscovery);
  const topGaps = gaps.sort((a, b) => b.priority - a.priority).slice(0, 20);

  // Calculate overall stats
  const covered = coverage.filter((c) => c.tier !== null && c.tier <= 1).length;

  return {
    totalCities: cityList.length,
    coveredCities: covered,
    coveragePercent: (covered / cityList.length) * 100,
    byTier,
    byState,
    topGaps,
  };
}

/**
 * Get stale data (not updated in X days)
 *
 * @param maxAgeDays - Maximum age in days before data is stale
 * @param baseDir - Provenance log directory
 * @returns Cities with stale data
 */
export async function getStaleData(
  maxAgeDays: number = 90,
  baseDir: string = './discovery-attempts'
): Promise<CityCoverage[]> {
  const allEntries = await queryProvenance({}, baseDir);

  const stale: CityCoverage[] = [];
  const cutoffDate = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

  // Group by FIPS
  const latestEntries = new Map<string, ProvenanceEntry>();
  for (const entry of allEntries) {
    const existing = latestEntries.get(entry.f);
    if (!existing || entry.ts > existing.ts) {
      latestEntries.set(entry.f, entry);
    }
  }

  // Check provenance entries
  for (const [fips, entry] of latestEntries) {
    const lastUpdated = new Date(entry.ts);

    if (lastUpdated < cutoffDate) {
      stale.push({
        fips,
        cityName: entry.n || fips,
        state: entry.s || 'Unknown',
        population: entry.p || 0,
        tier: entry.g,
        confidence: entry.conf,
        dataSource: 'discovery',
        lastUpdated: entry.ts,
        needsDiscovery: false, // Already have data, just stale
        priority: entry.p || 0,
      });
    }
  }

  // Check known portals for staleness
  for (const [fips, portal] of Object.entries(KNOWN_PORTALS)) {
    if (isStale(portal)) {
      stale.push({
        fips,
        cityName: portal.cityName,
        state: portal.state,
        population: 0, // Population not tracked in known portals
        tier: 1, // Known portals are council districts
        confidence: portal.confidence,
        dataSource: 'known-portal',
        lastUpdated: portal.lastVerified,
        needsDiscovery: false,
        priority: 0,
      });
    }
  }

  return stale.sort((a, b) => b.priority - a.priority);
}

/**
 * Get quality metrics for covered cities
 *
 * @param baseDir - Provenance log directory
 * @returns Quality analysis
 */
export async function getQualityMetrics(
  baseDir: string = './discovery-attempts'
): Promise<{
  avgConfidence: number;
  lowConfidence: number; // Count of cities with confidence < 70
  byTier: Record<number, { count: number; avgConfidence: number }>;
}> {
  const allEntries = await queryProvenance({}, baseDir);

  const byTier: Record<number, { total: number; sumConfidence: number }> = {};
  let totalConfidence = 0;
  let lowConfidence = 0;
  let successCount = 0;

  for (const entry of allEntries) {
    if (entry.blocked !== null) continue; // Skip failed discoveries

    successCount++;
    totalConfidence += entry.conf;

    if (entry.conf < 70) {
      lowConfidence++;
    }

    if (!byTier[entry.g]) {
      byTier[entry.g] = { total: 0, sumConfidence: 0 };
    }
    byTier[entry.g].total++;
    byTier[entry.g].sumConfidence += entry.conf;
  }

  const avgConfidence = successCount > 0 ? totalConfidence / successCount : 0;

  const tierMetrics: Record<number, { count: number; avgConfidence: number }> = {};
  for (const [tier, stats] of Object.entries(byTier)) {
    tierMetrics[Number(tier)] = {
      count: stats.total,
      avgConfidence: stats.total > 0 ? stats.sumConfidence / stats.total : 0,
    };
  }

  return {
    avgConfidence,
    lowConfidence,
    byTier: tierMetrics,
  };
}

/**
 * Get blockers preventing higher-tier coverage
 *
 * @param baseDir - Provenance log directory
 * @returns Blocker analysis
 */
export async function getBlockerAnalysis(
  baseDir: string = './discovery-attempts'
): Promise<Record<string, { count: number; examples: string[] }>> {
  const allEntries = await queryProvenance({}, baseDir);

  const blockers: Record<string, { count: number; examples: string[] }> = {};

  for (const entry of allEntries) {
    if (entry.blocked === null) continue; // Skip successful discoveries

    const blockerCode = entry.blocked;

    if (!blockers[blockerCode]) {
      blockers[blockerCode] = { count: 0, examples: [] };
    }

    blockers[blockerCode].count++;

    // Add example (city name) if available and not already in examples
    if (entry.n && blockers[blockerCode].examples.length < 5) {
      if (!blockers[blockerCode].examples.includes(entry.n)) {
        blockers[blockerCode].examples.push(entry.n);
      }
    }
  }

  return blockers;
}
