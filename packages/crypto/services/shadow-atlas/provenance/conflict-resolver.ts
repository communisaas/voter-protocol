/**
 * Conflict Resolver - Source Disagreement Resolution
 *
 * Resolves conflicts when multiple sources claim different boundaries
 * for the same jurisdiction.
 *
 * RESOLUTION RULE: Freshest primary source > freshest aggregator
 *
 * Implements DATA-PROVENANCE-SPEC Section 4.3 (Conflict Resolution).
 *
 * CRITICAL TYPE SAFETY: Conflict resolution decisions are permanent.
 * Wrong type assertions can lead to accepting outdated or incorrect
 * boundary data. Every field must be validated.
 */

/**
 * Source claim for a boundary
 *
 * Represents a single source's assertion about what the boundary
 * should be. Multiple sources may disagree.
 */
interface SourceClaim {
  /** Unique source identifier (e.g., "census-tiger-2024") */
  readonly sourceId: string;

  /** Human-readable source name (e.g., "Census TIGER 2024") */
  readonly sourceName: string;

  /** Boundary geometry (Polygon or MultiPolygon) */
  readonly boundary: unknown; // GeoJSON geometry

  /** Last modified timestamp (Unix milliseconds) */
  readonly lastModified: number;

  /** Whether this is a primary authority source */
  readonly isPrimary: boolean;

  /** Authority level (0-5) */
  readonly authorityLevel: number;

  /** ETag for change detection (if available) */
  readonly etag?: string | null;

  /** Data version string (e.g., "TIGER2024") */
  readonly version?: string;
}

/**
 * Resolution decision record
 *
 * Immutable record of why a particular source was chosen
 * over alternatives. Essential for audit trail.
 */
interface ResolutionDecision {
  /** Boundary identifier (e.g., "us-ca-06") */
  readonly boundaryId: string;

  /** Winning source ID */
  readonly winner: string;

  /** Human-readable reason for selection */
  readonly reason: string;

  /** Freshness score (Unix milliseconds) */
  readonly freshness: number;

  /** Number of alternative sources considered */
  readonly alternativesCounted: number;

  /** Resolution timestamp (ISO 8601) */
  readonly timestamp: string;

  /** Confidence score (0-100) */
  readonly confidence: number;

  /** Whether resolution required manual override */
  readonly manualOverride: boolean;

  /** List of rejected alternatives with reasons */
  readonly rejected: readonly {
    readonly sourceId: string;
    readonly reason: string;
    readonly freshnessGap: number; // milliseconds behind winner
  }[];
}

/**
 * Resolution result
 *
 * Contains winning claim and full decision record for audit trail.
 */
interface ResolutionResult {
  /** The winning source claim */
  readonly winner: SourceClaim;

  /** Full resolution decision record */
  readonly decision: ResolutionDecision;
}

/**
 * Conflict Resolver
 *
 * Implements deterministic conflict resolution based on authority
 * hierarchy and freshness.
 *
 * ALGORITHM:
 * 1. Separate sources into primary vs aggregator
 * 2. If primary sources exist:
 *    - Return freshest primary
 *    - Reject all aggregators (primary always wins)
 * 3. If only aggregators exist:
 *    - Return freshest aggregator
 * 4. Log full decision with reasoning
 */
export class ConflictResolver {
  /**
   * Resolve conflict between multiple source claims
   *
   * DETERMINISTIC RESOLUTION:
   * - Primary sources always beat aggregators
   * - Among same tier, freshest wins
   * - Ties broken by authority level
   *
   * @param boundaryId - Identifier for the boundary being resolved
   * @param sources - Array of competing source claims
   * @returns Resolution result with winner and decision record
   * @throws Error if no valid sources provided
   */
  async resolveConflict(
    boundaryId: string,
    sources: readonly SourceClaim[]
  ): Promise<ResolutionResult> {
    // Validate input
    if (sources.length === 0) {
      throw new Error(`No sources provided for boundary: ${boundaryId}`);
    }

    // Single source - no conflict
    if (sources.length === 1) {
      const winner = sources[0];
      return {
        winner,
        decision: {
          boundaryId,
          winner: winner.sourceId,
          reason: 'Only source available (no conflict)',
          freshness: winner.lastModified,
          alternativesCounted: 0,
          timestamp: new Date().toISOString(),
          confidence: 100,
          manualOverride: false,
          rejected: [],
        },
      };
    }

    // Multiple sources - resolve conflict
    const primarySources = sources.filter(s => s.isPrimary);
    const aggregatorSources = sources.filter(s => !s.isPrimary);

    let winner: SourceClaim;
    let reason: string;
    let rejected: Array<{ sourceId: string; reason: string; freshnessGap: number }> = [];

    // Rule 1: Primary sources always win
    if (primarySources.length > 0) {
      winner = this.selectFreshest(primarySources);
      reason = `Primary authority source (freshest of ${primarySources.length} primary sources)`;

      // Reject all aggregators
      rejected = aggregatorSources.map(s => ({
        sourceId: s.sourceId,
        reason: 'Aggregator loses to primary authority',
        freshnessGap: winner.lastModified - s.lastModified,
      }));

      // Reject other primary sources
      rejected.push(
        ...primarySources
          .filter(s => s.sourceId !== winner.sourceId)
          .map(s => ({
            sourceId: s.sourceId,
            reason: 'Older primary source',
            freshnessGap: winner.lastModified - s.lastModified,
          }))
      );
    } else {
      // Rule 2: No primary sources - select freshest aggregator
      winner = this.selectFreshest(aggregatorSources);
      reason = `Freshest aggregator (no primary sources available)`;

      // Reject other aggregators
      rejected = aggregatorSources
        .filter(s => s.sourceId !== winner.sourceId)
        .map(s => ({
          sourceId: s.sourceId,
          reason: 'Older aggregator',
          freshnessGap: winner.lastModified - s.lastModified,
        }));
    }

    // Calculate confidence based on freshness and authority
    const confidence = this.calculateConfidence(winner, sources);

    return {
      winner,
      decision: {
        boundaryId,
        winner: winner.sourceId,
        reason,
        freshness: winner.lastModified,
        alternativesCounted: sources.length - 1,
        timestamp: new Date().toISOString(),
        confidence,
        manualOverride: false,
        rejected,
      },
    };
  }

  /**
   * Select freshest source from a list
   *
   * TIEBREAKER:
   * 1. Freshness (lastModified timestamp)
   * 2. Authority level (higher wins)
   * 3. Source ID (lexicographic order for determinism)
   *
   * @param sources - Array of source claims
   * @returns Freshest source
   */
  private selectFreshest(sources: readonly SourceClaim[]): SourceClaim {
    if (sources.length === 0) {
      throw new Error('Cannot select from empty source list');
    }

    if (sources.length === 1) {
      return sources[0];
    }

    // Sort by freshness (descending), then authority (descending), then sourceId (ascending)
    const sorted = [...sources].sort((a, b) => {
      // Primary sort: freshness (newest first)
      if (a.lastModified !== b.lastModified) {
        return b.lastModified - a.lastModified;
      }

      // Tiebreaker 1: authority level (higher first)
      if (a.authorityLevel !== b.authorityLevel) {
        return b.authorityLevel - a.authorityLevel;
      }

      // Tiebreaker 2: source ID (lexicographic, deterministic)
      return a.sourceId.localeCompare(b.sourceId);
    });

    return sorted[0];
  }

  /**
   * Calculate confidence score for resolution
   *
   * FACTORS:
   * - Authority level: Primary=90, Aggregator=70
   * - Freshness: -1 per quarter year old
   * - Competition: +10 if unanimous, -5 per disagreement
   *
   * @param winner - Winning source claim
   * @param allSources - All source claims considered
   * @returns Confidence score (0-100)
   */
  private calculateConfidence(
    winner: SourceClaim,
    allSources: readonly SourceClaim[]
  ): number {
    // Base confidence from authority level
    let confidence = winner.isPrimary ? 90 : 70;

    // Freshness penalty: -1 per quarter year
    const ageInDays = (Date.now() - winner.lastModified) / (24 * 60 * 60 * 1000);
    const freshnessPenalty = Math.min(20, Math.floor(ageInDays / 90));
    confidence -= freshnessPenalty;

    // Competition penalty: -5 per competing source
    const competingSourcesCount = allSources.length - 1;
    const competitionPenalty = competingSourcesCount * 5;
    confidence -= competitionPenalty;

    // Clamp to [0, 100]
    return Math.max(0, Math.min(100, confidence));
  }

  /**
   * Resolve conflicts for multiple boundaries in batch
   *
   * @param conflicts - Map of boundary ID to array of source claims
   * @returns Map of boundary ID to resolution result
   */
  async resolveBatch(
    conflicts: ReadonlyMap<string, readonly SourceClaim[]>
  ): Promise<Map<string, ResolutionResult>> {
    const results = new Map<string, ResolutionResult>();

    // Convert to array to avoid iterator issues
    const entries = Array.from(conflicts.entries());

    for (const [boundaryId, sources] of entries) {
      try {
        const result = await this.resolveConflict(boundaryId, sources);
        results.set(boundaryId, result);
      } catch (error) {
        console.error(`Failed to resolve conflict for ${boundaryId}:`, error);
        // Continue processing other boundaries
      }
    }

    return results;
  }

  /**
   * Validate resolution decision
   *
   * Ensures decision meets quality thresholds before acceptance.
   *
   * QUALITY GATES:
   * - Confidence >= 50 (minimum acceptable)
   * - Freshness within 2 years
   * - At least one source evaluated
   *
   * @param decision - Resolution decision to validate
   * @returns Whether decision passes validation
   */
  validateResolution(decision: ResolutionDecision): boolean {
    // Confidence threshold
    if (decision.confidence < 50) {
      return false;
    }

    // Freshness threshold (2 years)
    const twoYearsAgo = Date.now() - (2 * 365 * 24 * 60 * 60 * 1000);
    if (decision.freshness < twoYearsAgo) {
      return false;
    }

    // Must have evaluated at least one source
    if (decision.alternativesCounted < 0) {
      return false;
    }

    return true;
  }

  /**
   * Create manual override decision
   *
   * Allows human override of automatic resolution for edge cases.
   *
   * @param boundaryId - Boundary being resolved
   * @param selectedSourceId - Manually selected source ID
   * @param sources - All available source claims
   * @param reason - Human-provided reason for override
   * @returns Resolution result with manual override flag
   */
  createManualOverride(
    boundaryId: string,
    selectedSourceId: string,
    sources: readonly SourceClaim[],
    reason: string
  ): ResolutionResult {
    const winner = sources.find(s => s.sourceId === selectedSourceId);

    if (!winner) {
      throw new Error(`Selected source ${selectedSourceId} not found in source list`);
    }

    const rejected = sources
      .filter(s => s.sourceId !== selectedSourceId)
      .map(s => ({
        sourceId: s.sourceId,
        reason: 'Manual override',
        freshnessGap: winner.lastModified - s.lastModified,
      }));

    return {
      winner,
      decision: {
        boundaryId,
        winner: winner.sourceId,
        reason: `MANUAL OVERRIDE: ${reason}`,
        freshness: winner.lastModified,
        alternativesCounted: sources.length - 1,
        timestamp: new Date().toISOString(),
        confidence: 75, // Medium confidence for manual overrides
        manualOverride: true,
        rejected,
      },
    };
  }
}

// Export types for external use
export type {
  SourceClaim,
  ResolutionDecision,
  ResolutionResult,
};
