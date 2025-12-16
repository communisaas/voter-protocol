/**
 * Authority Conflict Resolution
 *
 * When multiple sources provide the same boundary (e.g., TIGER vs state
 * redistricting commission for congressional districts), we need a
 * deterministic way to choose which source to trust.
 *
 * RESOLUTION ALGORITHM:
 * 1. Sort by authority level (FEDERAL_MANDATE > STATE_MANDATE > ...)
 * 2. Within same authority, sort by preference (from tiger-authority-rules.ts)
 * 3. Within same preference, sort by freshness (newer wins)
 *
 * EXAMPLE SCENARIOS:
 *
 * Scenario 1: Normal period
 * - TIGER 2024 (authority=5, preference=3, fresh)
 * - State GIS 2024 (authority=4, preference=4, fresh)
 * → Pick TIGER (higher authority)
 *
 * Scenario 2: Redistricting gap (Jan-Jun 2022)
 * - TIGER 2021 (authority=5, preference=3, stale)
 * - CA Redistricting Commission 2022 (authority=5, preference=1, fresh)
 * → Pick CA Commission (same authority, higher preference, fresher)
 *
 * Scenario 3: Post-redistricting (Jul 2022+)
 * - TIGER 2022 (authority=5, preference=3, fresh)
 * - CA Redistricting Commission 2022 (authority=5, preference=1, fresh)
 * → Pick CA Commission (same authority, higher preference)
 *
 * Integration:
 * - Uses tiger-authority-rules.ts for precedence order
 * - Uses tiger-validity.ts for freshness assessment
 * - Uses validity-window.ts for temporal validity
 */

import {
  type TIGERBoundaryType,
  type SourceProvider,
  type AuthorityLevel,
  getTIGERAuthorityRule,
  getSourcePrecedence,
} from './tiger-authority-rules.js';
import { getTIGERValidityStatus } from './tiger-validity.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Boundary with source metadata
 */
export interface BoundaryWithSource {
  /** Boundary type */
  readonly boundaryType: TIGERBoundaryType;

  /** Source provider */
  readonly provider: SourceProvider;

  /** Release date of this boundary data */
  readonly releaseDate: Date;

  /** Optional: Geometric data */
  readonly geometry?: unknown;

  /** Optional: Properties */
  readonly properties?: Record<string, unknown>;
}

/**
 * Resolved boundary source
 * The "winning" source after conflict resolution
 */
export interface ResolvedBoundarySource {
  /** Selected boundary */
  readonly boundary: BoundaryWithSource;

  /** Authority level of selected source */
  readonly authority: AuthorityLevel;

  /** Preference rank (1 = highest) */
  readonly preference: number;

  /** Confidence in selected source (0.0-1.0) */
  readonly confidence: number;

  /** Why this source was selected */
  readonly reasoning: string;

  /** All candidate sources (for audit) */
  readonly candidates: ReadonlyArray<BoundaryCandidate>;
}

/**
 * Boundary candidate with scoring
 */
interface BoundaryCandidate {
  readonly boundary: BoundaryWithSource;
  readonly authority: AuthorityLevel;
  readonly preference: number;
  readonly freshnessScore: number;
  readonly totalScore: number;
}

// ============================================================================
// Core Resolution Function
// ============================================================================

/**
 * Resolve authority conflict between multiple boundary sources
 *
 * Selects the most authoritative and fresh boundary source using a
 * multi-criteria scoring system:
 * 1. Authority level (weight: 1000) - FEDERAL > STATE > MUNICIPAL
 * 2. Preference rank (weight: 100) - Lower preference number = higher score
 * 3. Freshness (weight: 10) - Newer data = higher score
 *
 * @param boundaries - Competing boundary sources
 * @param asOf - Date for freshness evaluation (defaults to now)
 * @returns Resolved source with reasoning
 * @throws Error if no boundaries provided
 *
 * @example
 * ```typescript
 * const boundaries = [
 *   { boundaryType: 'congressional', provider: 'census-tiger', releaseDate: new Date('2021-07-01') },
 *   { boundaryType: 'congressional', provider: 'state-redistricting-commission', releaseDate: new Date('2022-01-15') },
 * ];
 *
 * const resolved = resolveAuthorityConflict(boundaries, new Date('2022-03-01'));
 * // During gap: picks state commission (higher preference, fresher)
 * ```
 */
export function resolveAuthorityConflict(
  boundaries: ReadonlyArray<BoundaryWithSource>,
  asOf: Date = new Date()
): ResolvedBoundarySource {
  if (boundaries.length === 0) {
    throw new Error('No boundaries provided for conflict resolution');
  }

  // Single boundary - no conflict
  if (boundaries.length === 1) {
    const boundary = boundaries[0];
    const rule = getTIGERAuthorityRule(boundary.boundaryType);
    const precedence = getSourcePrecedence(boundary.boundaryType);
    const sourcePrec = precedence.find((p) => p.source === boundary.provider);

    return {
      boundary,
      authority: sourcePrec?.authority ?? 0,
      preference: sourcePrec?.preference ?? 999,
      confidence: 1.0,
      reasoning: 'Single source available (no conflict)',
      candidates: [],
    };
  }

  // Score all candidates
  const candidates = boundaries.map((boundary) => {
    return scoreBoundaryCandidate(boundary, asOf);
  });

  // Sort by total score (descending)
  const sorted = [...candidates].sort((a, b) => b.totalScore - a.totalScore);
  const winner = sorted[0];

  // Build reasoning
  const reasoning = buildResolutionReasoning(winner, sorted, asOf);

  return {
    boundary: winner.boundary,
    authority: winner.authority,
    preference: winner.preference,
    confidence: calculateConfidence(winner, sorted),
    reasoning,
    candidates: sorted,
  };
}

/**
 * Resolve authority conflict for a specific boundary type
 *
 * Convenience wrapper that filters boundaries by type before resolution.
 *
 * @param boundaries - All boundary sources
 * @param boundaryType - Type to filter for
 * @param asOf - Date for freshness evaluation
 * @returns Resolved source or null if no boundaries of this type
 */
export function resolveAuthorityConflictForType(
  boundaries: ReadonlyArray<BoundaryWithSource>,
  boundaryType: TIGERBoundaryType,
  asOf: Date = new Date()
): ResolvedBoundarySource | null {
  const filtered = boundaries.filter((b) => b.boundaryType === boundaryType);

  if (filtered.length === 0) {
    return null;
  }

  return resolveAuthorityConflict(filtered, asOf);
}

// ============================================================================
// Scoring Functions
// ============================================================================

/**
 * Score a boundary candidate
 *
 * Scoring formula:
 * - Authority: authority_level × 1000
 * - Preference: (100 - preference_rank) × 100
 * - Freshness: freshness_score × 10
 *
 * Higher score = better source
 */
function scoreBoundaryCandidate(
  boundary: BoundaryWithSource,
  asOf: Date
): BoundaryCandidate {
  const precedence = getSourcePrecedence(boundary.boundaryType);
  const sourcePrec = precedence.find((p) => p.source === boundary.provider);

  const authority = sourcePrec?.authority ?? 0;
  const preference = sourcePrec?.preference ?? 999;

  // Calculate freshness score (0.0-1.0)
  const freshnessScore = calculateFreshnessScore(boundary, asOf);

  // Weight components
  const authorityScore = authority * 1000;
  const preferenceScore = (100 - preference) * 100;
  const freshnessWeight = freshnessScore * 10;

  const totalScore = authorityScore + preferenceScore + freshnessWeight;

  return {
    boundary,
    authority,
    preference,
    freshnessScore,
    totalScore,
  };
}

/**
 * Calculate freshness score for a boundary
 *
 * Freshness considers:
 * - How recently the data was released
 * - Whether we're in a redistricting gap
 * - TIGER validity windows
 *
 * @returns Score from 0.0 (stale) to 1.0 (fresh)
 */
function calculateFreshnessScore(
  boundary: BoundaryWithSource,
  asOf: Date
): number {
  const releaseDate = boundary.releaseDate;
  const daysSinceRelease = (asOf.getTime() - releaseDate.getTime()) / (1000 * 60 * 60 * 24);

  // Fresher data gets higher score
  // Decay curve: 1.0 at release, 0.5 at 6 months, 0.25 at 1 year, 0.1 at 2 years
  const monthsSinceRelease = daysSinceRelease / 30;

  if (monthsSinceRelease <= 0) {
    return 1.0;
  } else if (monthsSinceRelease <= 6) {
    return 1.0 - (monthsSinceRelease / 6) * 0.5;
  } else if (monthsSinceRelease <= 12) {
    return 0.5 - ((monthsSinceRelease - 6) / 6) * 0.25;
  } else if (monthsSinceRelease <= 24) {
    return 0.25 - ((monthsSinceRelease - 12) / 12) * 0.15;
  } else {
    return 0.1;
  }
}

/**
 * Calculate confidence in the resolution
 *
 * Confidence is high when:
 * - Winner has clear authority/preference advantage
 * - Winner is significantly fresher
 *
 * Confidence is low when:
 * - Multiple sources have similar scores
 * - All sources are stale
 */
function calculateConfidence(
  winner: BoundaryCandidate,
  allCandidates: ReadonlyArray<BoundaryCandidate>
): number {
  if (allCandidates.length === 1) {
    return 1.0;
  }

  // Find second-best candidate
  const runnerUp = allCandidates[1];

  // Calculate score gap
  const scoreGap = winner.totalScore - runnerUp.totalScore;
  const maxPossibleGap = 1000; // Authority level difference

  // Larger gap = higher confidence
  const gapConfidence = Math.min(scoreGap / maxPossibleGap, 1.0);

  // Adjust for absolute freshness
  const freshnessConfidence = winner.freshnessScore;

  // Combined confidence (weighted average)
  return gapConfidence * 0.7 + freshnessConfidence * 0.3;
}

/**
 * Build human-readable reasoning for resolution
 */
function buildResolutionReasoning(
  winner: BoundaryCandidate,
  allCandidates: ReadonlyArray<BoundaryCandidate>,
  asOf: Date
): string {
  const parts: string[] = [];

  // Winner info
  parts.push(
    `Selected ${winner.boundary.provider} (authority=${winner.authority}, preference=${winner.preference})`
  );

  // Comparison to other sources
  if (allCandidates.length > 1) {
    const runnerUp = allCandidates[1];

    if (winner.authority > runnerUp.authority) {
      parts.push(`Higher authority than ${runnerUp.boundary.provider}`);
    } else if (winner.authority === runnerUp.authority) {
      if (winner.preference < runnerUp.preference) {
        parts.push(`Same authority as ${runnerUp.boundary.provider}, but higher preference`);
      } else if (winner.preference === runnerUp.preference) {
        if (winner.freshnessScore > runnerUp.freshnessScore) {
          parts.push(`Same authority and preference as ${runnerUp.boundary.provider}, but fresher data`);
        }
      }
    }
  }

  // Freshness assessment
  const daysSinceRelease = Math.floor(
    (asOf.getTime() - winner.boundary.releaseDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysSinceRelease <= 30) {
    parts.push('Very fresh data (< 30 days old)');
  } else if (daysSinceRelease <= 180) {
    parts.push(`Fresh data (${daysSinceRelease} days old)`);
  } else if (daysSinceRelease <= 365) {
    parts.push(`Moderate age (${daysSinceRelease} days old)`);
  } else {
    parts.push(`Aging data (${Math.floor(daysSinceRelease / 365)} years old)`);
  }

  return parts.join('. ');
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get all available sources for a boundary type
 *
 * Returns list of sources in precedence order.
 *
 * @param boundaryType - Type of boundary
 * @returns Ordered list of source providers
 */
export function getAvailableSources(
  boundaryType: TIGERBoundaryType
): ReadonlyArray<SourceProvider> {
  const precedence = getSourcePrecedence(boundaryType);
  return precedence.map((p) => p.source);
}

/**
 * Check if source is preferred for boundary type
 *
 * @param boundaryType - Type of boundary
 * @param provider - Source provider
 * @returns True if this is the highest-preference source
 */
export function isPreferredSource(
  boundaryType: TIGERBoundaryType,
  provider: SourceProvider
): boolean {
  const precedence = getSourcePrecedence(boundaryType);
  if (precedence.length === 0) {
    return false;
  }

  return precedence[0].source === provider;
}

/**
 * Compare two sources
 *
 * @returns -1 if source1 < source2, 0 if equal, 1 if source1 > source2
 */
export function compareSources(
  boundaryType: TIGERBoundaryType,
  source1: SourceProvider,
  source2: SourceProvider
): number {
  const precedence = getSourcePrecedence(boundaryType);

  const prec1 = precedence.find((p) => p.source === source1);
  const prec2 = precedence.find((p) => p.source === source2);

  if (!prec1 && !prec2) return 0;
  if (!prec1) return -1;
  if (!prec2) return 1;

  // Lower preference number = higher priority
  return prec1.preference - prec2.preference;
}
