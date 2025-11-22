/**
 * Freshness Tracker - Data Vintage Detection
 *
 * PURPOSE: Track when boundaries need re-validation
 * STRATEGY: Metadata parsing + redistricting schedules
 * SCALE: 19,495 US cities
 *
 * CRITICAL TYPE SAFETY: Freshness tracking is our production readiness metric.
 * Incorrect freshness calculations lead to serving stale data in production.
 */

import type { ProvenanceEntry } from './provenance-writer.js';
import { queryProvenance } from './provenance-writer.js';

/**
 * Freshness status
 */
export type FreshnessStatus = 'fresh' | 'aging' | 'stale' | 'critical' | 'unknown';

/**
 * Freshness classification
 */
export interface FreshnessInfo {
  readonly fips: string;
  readonly cityName: string | undefined;
  readonly state: string | undefined;
  readonly population: number | undefined;
  readonly tier: number;
  readonly lastUpdated: string; // ISO timestamp
  readonly dataAge: number; // Days
  readonly status: FreshnessStatus;
  readonly nextRevalidation: string; // ISO timestamp
  readonly redistrictingCycle: number | null; // Year of next redistricting
  readonly reasoning: readonly string[];
}

/**
 * Freshness thresholds (days)
 */
const FRESHNESS_THRESHOLDS = {
  FRESH: 90, // < 90 days (quarterly check)
  AGING: 180, // 90-180 days (monthly check)
  STALE: 365, // 180-365 days (weekly check)
  CRITICAL: 730, // > 2 years (daily check)
} as const;

/**
 * Redistricting schedule by state
 * Based on US Census cycle (decennial)
 *
 * NOTE: Most states redistrict in years ending in 1-2 after census
 * (2021-2022, 2031-2032, etc.)
 */
const REDISTRICTING_YEARS: Record<string, readonly number[]> = {
  // Default schedule (used for states not explicitly listed)
  default: [2021, 2022, 2031, 2032, 2041, 2042],

  // States with non-standard redistricting cycles can be added here
  // Example: States that redistrict mid-decade
  // VA: [2021, 2031, 2041], // Virginia redistricted after 2020 census
} as const;

/**
 * Classify freshness status based on age
 *
 * @param ageInDays - Age of data in days
 * @returns Freshness status
 */
function classifyFreshness(ageInDays: number): FreshnessStatus {
  if (ageInDays < FRESHNESS_THRESHOLDS.FRESH) return 'fresh';
  if (ageInDays < FRESHNESS_THRESHOLDS.AGING) return 'aging';
  if (ageInDays < FRESHNESS_THRESHOLDS.STALE) return 'stale';
  if (ageInDays < FRESHNESS_THRESHOLDS.CRITICAL) return 'critical';
  return 'critical';
}

/**
 * Get next redistricting year for a state
 *
 * @param state - 2-letter state code (e.g., 'CA', 'TX', 'NY')
 * @param currentYear - Current year
 * @returns Next redistricting year or null if none scheduled
 */
function getNextRedistricting(state: string, currentYear: number): number | null {
  const schedule = REDISTRICTING_YEARS[state] || REDISTRICTING_YEARS['default'];
  const future = schedule.filter((year) => year > currentYear);
  return future.length > 0 ? future[0] : null;
}

/**
 * Analyze freshness for a provenance entry
 *
 * @param entry - Provenance entry to analyze
 * @returns Freshness information
 */
function analyzeFreshness(entry: ProvenanceEntry): FreshnessInfo {
  const reasoning: string[] = [];

  // Calculate age
  const lastUpdated = new Date(entry.ts);
  const now = new Date();
  const ageInDays = Math.floor((now.getTime() - lastUpdated.getTime()) / (24 * 60 * 60 * 1000));

  // Classify status
  const status = classifyFreshness(ageInDays);

  reasoning.push(`Last updated: ${lastUpdated.toLocaleDateString()} (${ageInDays} days ago)`);
  reasoning.push(`Status: ${status.toUpperCase()}`);

  // Next revalidation calculation
  let nextRevalidation: Date;
  let revalidationInterval: number; // Days between revalidations

  if (status === 'fresh') {
    revalidationInterval = FRESHNESS_THRESHOLDS.FRESH; // 90 days
    // Schedule next revalidation from last update time
    nextRevalidation = new Date(lastUpdated.getTime() + revalidationInterval * 24 * 60 * 60 * 1000);
    reasoning.push(`Next revalidation: ${revalidationInterval} days from last update (quarterly check)`);
  } else if (status === 'aging') {
    revalidationInterval = 30; // Monthly checks for aging data
    // Data is aging - revalidation overdue, set to NOW
    nextRevalidation = new Date(lastUpdated.getTime() + FRESHNESS_THRESHOLDS.FRESH * 24 * 60 * 60 * 1000);
    reasoning.push(`Revalidation due: data is aging (monthly check recommended)`);
  } else if (status === 'stale') {
    revalidationInterval = 7; // Weekly checks for stale data
    // Data is stale - revalidation overdue, set to NOW
    nextRevalidation = new Date(lastUpdated.getTime() + FRESHNESS_THRESHOLDS.AGING * 24 * 60 * 60 * 1000);
    reasoning.push(`Revalidation overdue: data is stale (weekly check required)`);
  } else {
    // Critical: immediate revalidation needed
    revalidationInterval = 1;
    // Data is critical - revalidation VERY overdue
    nextRevalidation = new Date(lastUpdated.getTime() + FRESHNESS_THRESHOLDS.STALE * 24 * 60 * 60 * 1000);
    reasoning.push(`URGENT revalidation needed: data is critically stale`);
  }

  // Redistricting cycle
  const currentYear = now.getFullYear();
  const nextRedistricting = entry.s ? getNextRedistricting(entry.s, currentYear) : null;

  if (nextRedistricting) {
    reasoning.push(`Next redistricting: ${nextRedistricting} (Census-based cycle)`);
  }

  return {
    fips: entry.f,
    cityName: entry.n,
    state: entry.s,
    population: entry.p,
    tier: entry.g,
    lastUpdated: entry.ts,
    dataAge: ageInDays,
    status,
    nextRevalidation: nextRevalidation.toISOString(),
    redistrictingCycle: nextRedistricting,
    reasoning,
  };
}

/**
 * Get all entries needing revalidation
 *
 * STRATEGY: Get latest entry per FIPS, analyze freshness, filter to due entries
 * PRIORITY: Critical first, then stale, then aging
 *
 * @param baseDir - Provenance log directory
 * @returns Freshness analysis for all entries needing revalidation
 */
export async function getRevalidationQueue(
  baseDir: string = './discovery-attempts'
): Promise<readonly FreshnessInfo[]> {
  const allEntries = await queryProvenance({}, baseDir);

  // Get latest entry per FIPS
  const latestEntries = new Map<string, ProvenanceEntry>();
  for (const entry of allEntries) {
    const existing = latestEntries.get(entry.f);
    if (!existing || entry.ts > existing.ts) {
      latestEntries.set(entry.f, entry);
    }
  }

  // Analyze freshness
  const freshness: FreshnessInfo[] = [];
  const now = new Date();

  for (const entry of latestEntries.values()) {
    // Only include successful discoveries (blocked=null means success)
    if (entry.blocked !== null) continue;

    const info = analyzeFreshness(entry);

    // Only include if revalidation is due
    const nextRevalidation = new Date(info.nextRevalidation);
    if (nextRevalidation <= now) {
      freshness.push(info);
    }
  }

  // Sort by priority (critical first, then stale, then aging)
  const statusPriority: Record<FreshnessStatus, number> = {
    critical: 0,
    stale: 1,
    aging: 2,
    fresh: 3,
    unknown: 4,
  };

  return freshness.sort((a, b) => statusPriority[a.status] - statusPriority[b.status]);
}

/**
 * Get freshness statistics
 *
 * AGGREGATES: Total entries, freshness distribution, state breakdown
 * INCLUDES: Both compressed logs and staging area
 *
 * @param baseDir - Provenance log directory
 * @returns Freshness statistics
 */
export async function getFreshnessStats(
  baseDir: string = './discovery-attempts'
): Promise<{
  readonly total: number;
  readonly fresh: number;
  readonly aging: number;
  readonly stale: number;
  readonly critical: number;
  readonly needsRevalidation: number;
  readonly byState: Record<string, { fresh: number; aging: number; stale: number; critical: number }>;
}> {
  const allEntries = await queryProvenance({}, baseDir);

  // Get latest entry per FIPS
  const latestEntries = new Map<string, ProvenanceEntry>();
  for (const entry of allEntries) {
    const existing = latestEntries.get(entry.f);
    if (!existing || entry.ts > existing.ts) {
      latestEntries.set(entry.f, entry);
    }
  }

  const stats = {
    total: 0,
    fresh: 0,
    aging: 0,
    stale: 0,
    critical: 0,
    needsRevalidation: 0,
    byState: {} as Record<string, { fresh: number; aging: number; stale: number; critical: number }>,
  };

  const now = new Date();

  for (const entry of latestEntries.values()) {
    // Only count successful discoveries (blocked=null means success)
    if (entry.blocked !== null) continue;

    const info = analyzeFreshness(entry);
    stats.total++;

    // Overall stats
    stats[info.status]++;

    // Check if revalidation is due
    const nextRevalidation = new Date(info.nextRevalidation);
    if (nextRevalidation <= now) {
      stats.needsRevalidation++;
    }

    // State breakdown
    if (info.state) {
      if (!stats.byState[info.state]) {
        stats.byState[info.state] = { fresh: 0, aging: 0, stale: 0, critical: 0 };
      }
      stats.byState[info.state][info.status]++;
    }
  }

  return stats;
}
