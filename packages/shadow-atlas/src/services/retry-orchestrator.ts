/**
 * Retry Orchestrator - Autonomous Blocker Resolution
 *
 * PURPOSE: Analyze provenance logs and intelligently retry failed discoveries
 * STRATEGY: Different retry policies per blocker code
 * SCALE: Handles 19,495 US cities autonomously
 *
 * DESIGN PHILOSOPHY: Self-healing discovery system that maximizes coverage
 * - portal-404: Retry daily (site might come back online)
 * - rate-limit: Retry hourly (temporary throttling)
 * - no-council-layer: Retry quarterly (city might publish new data)
 * - at-large-governance: Never retry (permanent structural condition)
 *
 * INTEGRATION: Reads provenance logs, schedules retries, updates logs with new attempts
 */

import { queryProvenance, type ProvenanceEntry } from './provenance-writer.js';

/**
 * Retry policy for blocker codes
 */
export enum BlockerRetryPolicy {
  /** Retry hourly - temporary rate limiting */
  HOURLY = 'hourly',
  /** Retry daily - temporary portal issues */
  DAILY = 'daily',
  /** Retry weekly - data might be published */
  WEEKLY = 'weekly',
  /** Retry quarterly - redistricting or new data */
  QUARTERLY = 'quarterly',
  /** Never retry - permanent condition */
  NEVER = 'never',
}

/**
 * Blocker code to retry policy mapping
 *
 * CRITICAL: This mapping determines how aggressively we retry failures
 * MAINTENANCE: Update when new blocker codes are added to provenance-writer.ts
 */
export const BLOCKER_RETRY_POLICIES: Record<string, BlockerRetryPolicy> = {
  // Temporary infrastructure failures - retry soon
  'portal-404': BlockerRetryPolicy.DAILY,
  'portal-timeout': BlockerRetryPolicy.HOURLY,
  'portal-auth-required': BlockerRetryPolicy.WEEKLY, // Might open up
  'rate-limit': BlockerRetryPolicy.HOURLY,
  'timeout': BlockerRetryPolicy.HOURLY,
  'network-error': BlockerRetryPolicy.HOURLY,

  // Data might be published later
  'no-council-layer': BlockerRetryPolicy.QUARTERLY,
  'no-municipal-gis': BlockerRetryPolicy.QUARTERLY,
  'ambiguous-layer-name': BlockerRetryPolicy.WEEKLY, // Manual investigation might resolve
  'low-confidence-match': BlockerRetryPolicy.WEEKLY,

  // Data quality issues - might be fixed
  'malformed-geojson': BlockerRetryPolicy.WEEKLY,
  'topology-errors': BlockerRetryPolicy.WEEKLY,
  'coordinate-errors': BlockerRetryPolicy.WEEKLY,

  // Temporal issues - definite retry candidates
  'redistricting-in-progress': BlockerRetryPolicy.QUARTERLY,
  'redistricting-completed': BlockerRetryPolicy.WEEKLY, // New data should be available

  // Precinct-level blockers
  'no-precinct-data': BlockerRetryPolicy.QUARTERLY,
  'precinct-auth-required': BlockerRetryPolicy.QUARTERLY,

  // Permanent structural conditions - never retry
  'at-large-governance': BlockerRetryPolicy.NEVER,
  'multi-county-unsupported': BlockerRetryPolicy.NEVER, // Needs architecture work
  'consolidated-city-county': BlockerRetryPolicy.NEVER, // Needs special handling
};

/**
 * Retry interval in milliseconds
 */
const RETRY_INTERVALS: Record<BlockerRetryPolicy, number> = {
  [BlockerRetryPolicy.HOURLY]: 60 * 60 * 1000, // 1 hour
  [BlockerRetryPolicy.DAILY]: 24 * 60 * 60 * 1000, // 24 hours
  [BlockerRetryPolicy.WEEKLY]: 7 * 24 * 60 * 60 * 1000, // 7 days
  [BlockerRetryPolicy.QUARTERLY]: 90 * 24 * 60 * 60 * 1000, // 90 days
  [BlockerRetryPolicy.NEVER]: Infinity,
};

/**
 * Entry eligible for retry
 */
export interface RetryCandidate {
  readonly fips: string;
  readonly cityName: string | undefined;
  readonly state: string | undefined;
  readonly blockerCode: string;
  readonly lastAttempt: string; // ISO timestamp
  readonly attemptCount: number;
  readonly retryPolicy: BlockerRetryPolicy;
  readonly nextRetryAfter: string; // ISO timestamp
  readonly priority: number; // Higher = more important (based on population)
}

/**
 * Get all entries eligible for retry
 *
 * ALGORITHM:
 * 1. Query all provenance entries from compressed logs + staging
 * 2. Group by FIPS to find latest attempt per city
 * 3. Filter to blocked entries only
 * 4. Calculate retry eligibility based on blocker policy + time since last attempt
 * 5. Sort by priority (population-weighted)
 *
 * @param baseDir - Provenance log directory (defaults to ./discovery-attempts)
 * @returns Retry candidates sorted by priority (highest population first)
 *
 * @example
 * ```typescript
 * const candidates = await getRetryCandidates('./discovery-attempts');
 * console.log(`${candidates.length} cities ready for retry`);
 *
 * for (const candidate of candidates.slice(0, 10)) {
 *   console.log(`${candidate.cityName} (${candidate.blockerCode}) - retry after ${candidate.nextRetryAfter}`);
 * }
 * ```
 */
export async function getRetryCandidates(
  baseDir: string = './discovery-attempts'
): Promise<RetryCandidate[]> {
  // Query all entries (includes compressed logs + staging area)
  const allEntries = await queryProvenance({}, baseDir);

  // Group by FIPS (track latest attempt per city)
  const latestAttempts = new Map<string, ProvenanceEntry>();

  for (const entry of allEntries) {
    const existing = latestAttempts.get(entry.f);
    if (!existing || entry.ts > existing.ts) {
      latestAttempts.set(entry.f, entry);
    }
  }

  // Filter to blocked entries only
  const blockedEntries = Array.from(latestAttempts.values()).filter(
    (e) => e.blocked !== null
  );

  // Build retry candidates
  const candidates: RetryCandidate[] = [];
  const now = new Date();

  for (const entry of blockedEntries) {
    const blockerCode = entry.blocked!;
    const retryPolicy = BLOCKER_RETRY_POLICIES[blockerCode] || BlockerRetryPolicy.WEEKLY;

    // Skip never-retry blockers
    if (retryPolicy === BlockerRetryPolicy.NEVER) {
      continue;
    }

    // Count previous attempts for this FIPS
    const attemptCount = allEntries.filter((e) => e.f === entry.f).length;

    // Calculate next retry time
    const lastAttemptTime = new Date(entry.ts);
    const retryInterval = RETRY_INTERVALS[retryPolicy];
    const nextRetryTime = new Date(lastAttemptTime.getTime() + retryInterval);

    // Only include if retry time has passed
    if (nextRetryTime <= now) {
      candidates.push({
        fips: entry.f,
        cityName: entry.n,
        state: entry.s,
        blockerCode,
        lastAttempt: entry.ts,
        attemptCount,
        retryPolicy,
        nextRetryAfter: nextRetryTime.toISOString(),
        priority: entry.p || 0, // Use population as priority
      });
    }
  }

  // Sort by priority (highest population first)
  return candidates.sort((a, b) => b.priority - a.priority);
}

/**
 * Get retry candidates by blocker code
 *
 * OPTIMIZATION: Filters provenance logs to specific blocker code before retry calculation
 *
 * @param blockerCode - Blocker code to filter by
 * @param baseDir - Provenance log directory (defaults to ./discovery-attempts)
 * @returns Retry candidates for this blocker (sorted by priority)
 *
 * @example
 * ```typescript
 * // Find all cities with portal-404 errors ready for retry
 * const portal404 = await getRetryCandidatesByBlocker('portal-404');
 * console.log(`${portal404.length} cities with portal-404 ready for retry`);
 * ```
 */
export async function getRetryCandidatesByBlocker(
  blockerCode: string,
  baseDir: string = './discovery-attempts'
): Promise<RetryCandidate[]> {
  const allCandidates = await getRetryCandidates(baseDir);
  return allCandidates.filter((c) => c.blockerCode === blockerCode);
}

/**
 * Get retry statistics
 *
 * ANALYTICS: Provides insights into blocker distribution and retry eligibility
 *
 * @param baseDir - Provenance log directory (defaults to ./discovery-attempts)
 * @returns Retry statistics by blocker code
 *
 * @example
 * ```typescript
 * const stats = await getRetryStats();
 * console.log(`Total blocked: ${stats.totalBlocked}`);
 * console.log(`Retry eligible: ${stats.retryEligible}`);
 * console.log(`Never retry: ${stats.neverRetry}`);
 *
 * for (const [code, { count, retryPolicy }] of Object.entries(stats.byBlocker)) {
 *   console.log(`${code}: ${count} cities (${retryPolicy})`);
 * }
 * ```
 */
export async function getRetryStats(
  baseDir: string = './discovery-attempts'
): Promise<{
  totalBlocked: number;
  retryEligible: number;
  neverRetry: number;
  byBlocker: Record<string, { count: number; retryPolicy: BlockerRetryPolicy }>;
}> {
  const allEntries = await queryProvenance({}, baseDir);

  // Group by FIPS to get latest attempt per city
  const latestAttempts = new Map<string, ProvenanceEntry>();
  for (const entry of allEntries) {
    const existing = latestAttempts.get(entry.f);
    if (!existing || entry.ts > existing.ts) {
      latestAttempts.set(entry.f, entry);
    }
  }

  const blockedEntries = Array.from(latestAttempts.values()).filter(
    (e) => e.blocked !== null
  );

  const byBlocker: Record<string, { count: number; retryPolicy: BlockerRetryPolicy }> = {};
  let neverRetry = 0;

  for (const entry of blockedEntries) {
    const blockerCode = entry.blocked!;
    const retryPolicy = BLOCKER_RETRY_POLICIES[blockerCode] || BlockerRetryPolicy.WEEKLY;

    if (retryPolicy === BlockerRetryPolicy.NEVER) {
      neverRetry++;
    }

    if (!byBlocker[blockerCode]) {
      byBlocker[blockerCode] = { count: 0, retryPolicy };
    }
    byBlocker[blockerCode].count++;
  }

  const candidates = await getRetryCandidates(baseDir);

  return {
    totalBlocked: blockedEntries.length,
    retryEligible: candidates.length,
    neverRetry,
    byBlocker,
  };
}
