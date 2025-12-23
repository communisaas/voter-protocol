/**
 * Enhanced Change Detector - WP-FRESHNESS-6
 *
 * Combines change detection with freshness intelligence to prioritize updates
 * that matter during redistricting gaps. Uses validity windows, primary source
 * comparisons, and gap detection to avoid wasting bandwidth on stale aggregators.
 *
 * CORE PRINCIPLE: freshest_primary > freshest_aggregator
 *
 * During redistricting gaps (Jan-Jun 2022, 2032, etc.), TIGER is guaranteed stale.
 * This detector automatically prioritizes primary sources when confidence drops,
 * preventing Shadow Atlas from serving wrong congressional districts.
 *
 * CRITICAL TYPE SAFETY: Enhanced change detection drives download orchestration.
 * Type errors here cause bandwidth waste downloading stale TIGER data or miss
 * critical primary source updates during redistricting gaps.
 */

import type { BoundaryType, SourceType, ValidityWindow } from './validity-window.js';
import type { TigerComparison } from './primary-comparator.js';
import type { GapStatus } from './gap-detector.js';
import {
  validityWindowCalculator,
  type ValidityWindowCalculator,
} from './validity-window.js';
import {
  PrimarySourceComparator,
} from './primary-comparator.js';
import {
  RedistrictingGapDetector,
} from './gap-detector.js';

/**
 * Source information for change detection
 */
export interface SourceInfo {
  readonly id: string;
  readonly url: string;
  readonly sourceType: SourceType;
  readonly boundaryType: BoundaryType;
  readonly jurisdiction: string; // State code (e.g., "CA", "TX")
  readonly releaseDate: Date;
  readonly lastChecksum: string | null; // ETag or Last-Modified
  readonly lastChecked: Date | null;
}

/**
 * Change type classification
 */
export type ChangeType = 'content' | 'metadata' | 'schema' | 'none';

/**
 * Recommendation for handling detected changes
 */
export type ChangeRecommendation = 'use-tiger' | 'use-primary' | 'manual-review';

/**
 * Action to take based on change detection and freshness
 */
export type SuggestedAction = 'refresh-now' | 'schedule-refresh' | 'no-action';

/**
 * Freshness context for change detection result
 */
export interface FreshnessContext {
  readonly validityWindow: ValidityWindow;
  readonly confidence: number; // 0.0-1.0
  readonly inRedistrictingGap: boolean;
  readonly recommendation: ChangeRecommendation;
  readonly primaryComparison?: TigerComparison;
  readonly gapStatus?: GapStatus;
}

/**
 * Change detection result with freshness intelligence
 */
export interface ChangeDetectionResult {
  readonly sourceId: string;
  readonly hasChanged: boolean;
  readonly changeType: ChangeType;
  readonly freshnessContext: FreshnessContext;
  readonly suggestedAction: SuggestedAction;
  readonly reasoning: string;
  readonly oldChecksum: string | null;
  readonly newChecksum: string | null;
  readonly detectedAt: Date;
}

/**
 * Priority level for refresh operations
 */
export type RefreshPriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * Prioritized refresh item
 */
export interface PrioritizedRefreshItem {
  readonly source: SourceInfo;
  readonly priority: RefreshPriority;
  readonly confidence: number;
  readonly staleness: number; // Days since last check
  readonly reasoning: string;
}

/**
 * Prioritized refresh queue
 */
export interface PrioritizedRefreshQueue {
  readonly critical: readonly PrioritizedRefreshItem[];
  readonly high: readonly PrioritizedRefreshItem[];
  readonly medium: readonly PrioritizedRefreshItem[];
  readonly low: readonly PrioritizedRefreshItem[];
  readonly totalCount: number;
}

/**
 * Refresh schedule for confidence-based updates
 */
export interface RefreshSchedule {
  readonly nextRefresh: Date;
  readonly checkInterval: number; // Milliseconds
  readonly sources: readonly SourceInfo[];
  readonly reasoning: string;
}

/**
 * Enhanced Change Detector
 *
 * Integrates change detection with freshness intelligence to:
 * - Prioritize primary sources during redistricting gaps
 * - Schedule refreshes based on confidence decay
 * - Emit events when critical changes detected
 * - Track change history for audit
 */
export class EnhancedChangeDetector {
  private readonly validityCalculator: ValidityWindowCalculator;
  private readonly primaryComparator: PrimarySourceComparator;
  private readonly gapDetector: RedistrictingGapDetector;

  constructor(
    validityCalculator?: ValidityWindowCalculator,
    primaryComparator?: PrimarySourceComparator,
    gapDetector?: RedistrictingGapDetector
  ) {
    this.validityCalculator = validityCalculator ?? validityWindowCalculator;
    this.primaryComparator = primaryComparator ?? new PrimarySourceComparator();
    this.gapDetector = gapDetector ?? new RedistrictingGapDetector();
  }

  /**
   * Detect changes with freshness intelligence
   *
   * Combines HTTP header change detection with validity window analysis
   * to determine if a refresh is worthwhile.
   *
   * During redistricting gaps, automatically prefers primary sources over TIGER.
   */
  async detectChangesWithFreshness(
    boundaryType: BoundaryType,
    jurisdiction: string,
    sources: readonly SourceInfo[]
  ): Promise<readonly ChangeDetectionResult[]> {
    const results: ChangeDetectionResult[] = [];
    const now = new Date();

    // Check if we're in a redistricting gap
    const inGap = this.gapDetector.isInGap(now);

    for (const source of sources) {
      // Calculate validity window for this source
      const validityWindow = this.validityCalculator.calculateWindow(
        source.sourceType,
        source.releaseDate,
        boundaryType
      );

      // Compute current confidence
      const confidence = this.validityCalculator.computeConfidence(
        validityWindow,
        now
      );

      // Check for HTTP header changes
      const headerChanged = await this.checkHttpHeaderChange(source);

      // For TIGER sources during redistricting gap, compare with primary
      let primaryComparison: TigerComparison | undefined;
      let gapStatus: GapStatus | undefined;

      if (source.sourceType === 'tiger' && inGap) {
        primaryComparison = await this.primaryComparator.compareTigerFreshness(
          boundaryType,
          jurisdiction
        );
        gapStatus = this.gapDetector.checkBoundaryGap(
          boundaryType,
          jurisdiction,
          now
        );
      }

      // Determine change type
      const changeType = this.classifyChangeType(
        headerChanged,
        confidence,
        primaryComparison
      );

      // Build freshness context
      const freshnessContext: FreshnessContext = {
        validityWindow,
        confidence,
        inRedistrictingGap: inGap,
        recommendation: this.determineRecommendation(
          source.sourceType,
          confidence,
          inGap,
          primaryComparison,
          gapStatus
        ),
        primaryComparison,
        gapStatus,
      };

      // Determine suggested action
      const suggestedAction = this.determineSuggestedAction(
        changeType,
        freshnessContext,
        source
      );

      // Build reasoning
      const reasoning = this.buildReasoning(
        source,
        changeType,
        freshnessContext,
        suggestedAction
      );

      results.push({
        sourceId: source.id,
        hasChanged: changeType !== 'none',
        changeType,
        freshnessContext,
        suggestedAction,
        reasoning,
        oldChecksum: source.lastChecksum,
        newChecksum: headerChanged ? headerChanged.newChecksum : source.lastChecksum,
        detectedAt: now,
      });
    }

    return results;
  }

  /**
   * Get refresh priority based on staleness
   *
   * Prioritizes sources by:
   * 1. Redistricting gap status (critical priority)
   * 2. Confidence level (lower = higher priority)
   * 3. Time since last check (older = higher priority)
   * 4. Source type (primary > aggregator)
   */
  getRefreshPriority(sources: readonly SourceInfo[]): PrioritizedRefreshQueue {
    const now = new Date();
    const items: PrioritizedRefreshItem[] = [];

    for (const source of sources) {
      // Calculate validity window and confidence
      const validityWindow = this.validityCalculator.calculateWindow(
        source.sourceType,
        source.releaseDate,
        source.boundaryType
      );

      const confidence = this.validityCalculator.computeConfidence(
        validityWindow,
        now
      );

      // Calculate staleness (days since last check)
      const staleness = source.lastChecked
        ? Math.floor((now.getTime() - source.lastChecked.getTime()) / (1000 * 60 * 60 * 24))
        : Infinity;

      // Check gap status for legislative boundaries
      const inGap = this.gapDetector.isInGap(now);
      const gapStatus = inGap
        ? this.gapDetector.checkBoundaryGap(
            source.boundaryType,
            source.jurisdiction,
            now
          )
        : null;

      // Determine priority
      const priority = this.calculatePriority(
        source,
        confidence,
        staleness,
        gapStatus
      );

      // Build reasoning
      const reasoning = this.buildPriorityReasoning(
        source,
        priority,
        confidence,
        staleness,
        gapStatus
      );

      items.push({
        source,
        priority,
        confidence,
        staleness,
        reasoning,
      });
    }

    // Partition by priority
    const critical = items.filter((item) => item.priority === 'critical');
    const high = items.filter((item) => item.priority === 'high');
    const medium = items.filter((item) => item.priority === 'medium');
    const low = items.filter((item) => item.priority === 'low');

    return {
      critical,
      high,
      medium,
      low,
      totalCount: items.length,
    };
  }

  /**
   * Schedule confidence-based refresh
   *
   * Returns schedule for sources that need refresh when confidence
   * drops below threshold.
   */
  scheduleConfidenceBasedRefresh(
    sources: readonly SourceInfo[],
    threshold: number
  ): RefreshSchedule {
    const now = new Date();
    const sourcesNeedingRefresh: SourceInfo[] = [];

    for (const source of sources) {
      const validityWindow = this.validityCalculator.calculateWindow(
        source.sourceType,
        source.releaseDate,
        source.boundaryType
      );

      const confidence = this.validityCalculator.computeConfidence(
        validityWindow,
        now
      );

      if (confidence < threshold) {
        sourcesNeedingRefresh.push(source);
      }
    }

    // Calculate next refresh time
    // Use shortest time until any source drops below threshold
    let nextRefresh = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // Default: 30 days

    for (const source of sources) {
      const validityWindow = this.validityCalculator.calculateWindow(
        source.sourceType,
        source.releaseDate,
        source.boundaryType
      );

      // Estimate when confidence will drop below threshold
      const timeUntilThreshold = this.estimateTimeUntilConfidenceThreshold(
        validityWindow,
        threshold,
        now
      );

      const estimatedTime = new Date(now.getTime() + timeUntilThreshold);
      if (estimatedTime < nextRefresh) {
        nextRefresh = estimatedTime;
      }
    }

    // Check interval: Check daily if next refresh is soon, weekly otherwise
    const msUntilRefresh = nextRefresh.getTime() - now.getTime();
    const checkInterval =
      msUntilRefresh < 7 * 24 * 60 * 60 * 1000
        ? 24 * 60 * 60 * 1000 // Daily if within a week
        : 7 * 24 * 60 * 60 * 1000; // Weekly otherwise

    const reasoning =
      sourcesNeedingRefresh.length > 0
        ? `${sourcesNeedingRefresh.length} sources below confidence threshold ${threshold}`
        : `All sources above confidence threshold ${threshold}`;

    return {
      nextRefresh,
      checkInterval,
      sources: sourcesNeedingRefresh,
      reasoning,
    };
  }

  /**
   * Check for HTTP header changes
   * Returns null if no change detected
   */
  private async checkHttpHeaderChange(
    source: SourceInfo
  ): Promise<{ newChecksum: string } | null> {
    try {
      const headers = await this.fetchHeaders(source.url);

      // Prefer ETag over Last-Modified
      const newChecksum = headers.etag || headers.lastModified;

      if (!newChecksum) {
        return null;
      }

      // Compare with stored checksum
      if (source.lastChecksum === newChecksum) {
        return null;
      }

      return { newChecksum };
    } catch (error) {
      // Network error or unavailable - treat as no change
      return null;
    }
  }

  /**
   * Fetch HTTP headers via HEAD request
   */
  private async fetchHeaders(
    url: string
  ): Promise<{ etag: string | null; lastModified: string | null }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0 (Freshness Check)',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return {
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Classify change type
   */
  private classifyChangeType(
    headerChanged: { newChecksum: string } | null,
    confidence: number,
    primaryComparison?: TigerComparison
  ): ChangeType {
    // If primary source is fresher, treat as content change
    if (primaryComparison && !primaryComparison.tigerIsFresh) {
      return 'content';
    }

    // If HTTP headers changed, it's a content change
    if (headerChanged) {
      return 'content';
    }

    // If confidence is very low but no header change, metadata concern
    if (confidence < 0.4) {
      return 'metadata';
    }

    return 'none';
  }

  /**
   * Determine recommendation based on freshness context
   */
  private determineRecommendation(
    sourceType: SourceType,
    confidence: number,
    inGap: boolean,
    primaryComparison?: TigerComparison,
    gapStatus?: GapStatus
  ): ChangeRecommendation {
    // During redistricting gap, prefer primary sources
    if (inGap && gapStatus?.recommendation === 'use-primary') {
      return 'use-primary';
    }

    // If primary comparison shows TIGER is stale, use primary
    if (primaryComparison && !primaryComparison.tigerIsFresh) {
      return primaryComparison.recommendation;
    }

    // If confidence is very low, manual review
    if (confidence < 0.3) {
      return 'manual-review';
    }

    // Primary sources are always preferred when available
    if (sourceType === 'primary') {
      return 'use-primary';
    }

    // Default to TIGER if confidence is acceptable
    return 'use-tiger';
  }

  /**
   * Determine suggested action
   */
  private determineSuggestedAction(
    changeType: ChangeType,
    context: FreshnessContext,
    source: SourceInfo
  ): SuggestedAction {
    // Content changes during redistricting gap = immediate refresh
    if (changeType === 'content' && context.inRedistrictingGap) {
      return 'refresh-now';
    }

    // Content changes with low confidence = immediate refresh
    if (changeType === 'content' && context.confidence < 0.5) {
      return 'refresh-now';
    }

    // Metadata changes or low confidence = schedule refresh
    if (changeType === 'metadata' || context.confidence < 0.7) {
      return 'schedule-refresh';
    }

    // No changes and good confidence = no action
    return 'no-action';
  }

  /**
   * Build reasoning explanation
   */
  private buildReasoning(
    source: SourceInfo,
    changeType: ChangeType,
    context: FreshnessContext,
    action: SuggestedAction
  ): string {
    const parts: string[] = [];

    // Change type
    if (changeType === 'content') {
      parts.push('Content changed');
    } else if (changeType === 'metadata') {
      parts.push('Metadata concern');
    } else {
      parts.push('No changes detected');
    }

    // Confidence
    parts.push(`confidence ${(context.confidence * 100).toFixed(0)}%`);

    // Gap status
    if (context.inRedistrictingGap && context.gapStatus) {
      parts.push(`in redistricting gap (${context.gapStatus.reasoning})`);
    }

    // Primary comparison
    if (context.primaryComparison && !context.primaryComparison.tigerIsFresh) {
      parts.push(
        `TIGER stale by ${context.primaryComparison.lagDays} days vs primary`
      );
    }

    // Action
    if (action === 'refresh-now') {
      parts.push('→ refresh immediately');
    } else if (action === 'schedule-refresh') {
      parts.push('→ schedule refresh');
    } else {
      parts.push('→ no action needed');
    }

    return parts.join('; ');
  }

  /**
   * Calculate refresh priority
   */
  private calculatePriority(
    source: SourceInfo,
    confidence: number,
    staleness: number,
    gapStatus: GapStatus | null
  ): RefreshPriority {
    // Critical: In redistricting gap and TIGER is stale
    if (gapStatus?.inGap && gapStatus.recommendation === 'use-primary') {
      return 'critical';
    }

    // High: Very low confidence or very stale
    if (confidence < 0.4 || staleness > 180) {
      return 'high';
    }

    // Medium: Low confidence or moderately stale
    if (confidence < 0.7 || staleness > 90) {
      return 'medium';
    }

    // Low: Good confidence and recently checked
    return 'low';
  }

  /**
   * Build priority reasoning
   */
  private buildPriorityReasoning(
    source: SourceInfo,
    priority: RefreshPriority,
    confidence: number,
    staleness: number,
    gapStatus: GapStatus | null
  ): string {
    if (priority === 'critical') {
      return `CRITICAL: In redistricting gap, TIGER stale (confidence ${(confidence * 100).toFixed(0)}%)`;
    }

    if (priority === 'high') {
      if (confidence < 0.4) {
        return `HIGH: Very low confidence ${(confidence * 100).toFixed(0)}%`;
      }
      return `HIGH: Stale for ${staleness} days`;
    }

    if (priority === 'medium') {
      if (confidence < 0.7) {
        return `MEDIUM: Low confidence ${(confidence * 100).toFixed(0)}%`;
      }
      return `MEDIUM: Stale for ${staleness} days`;
    }

    return `LOW: Good confidence ${(confidence * 100).toFixed(0)}%, checked ${staleness} days ago`;
  }

  /**
   * Estimate time until confidence drops below threshold
   *
   * Uses linear approximation based on validity window decay
   */
  private estimateTimeUntilConfidenceThreshold(
    window: ValidityWindow,
    threshold: number,
    asOf: Date
  ): number {
    const currentConfidence = this.validityCalculator.computeConfidence(
      window,
      asOf
    );

    // Already below threshold
    if (currentConfidence <= threshold) {
      return 0;
    }

    // Primary sources don't decay (always 1.0)
    if (window.sourceType === 'primary') {
      return Infinity;
    }

    // Calculate time remaining in validity window
    const now = asOf.getTime();
    const validUntil = window.validUntil.getTime();
    const validFrom = window.validFrom.getTime();

    // Already expired
    if (now >= validUntil) {
      return 0;
    }

    // Calculate decay rate (linear approximation)
    // Confidence decays from 1.0 to 0.4 over last 25% of window
    const totalWindow = validUntil - validFrom;
    const decayStart = validFrom + totalWindow * 0.75;

    // If we haven't started decaying yet, calculate time until decay starts
    if (now < decayStart) {
      // Will we drop below threshold during decay period?
      if (threshold >= 1.0) {
        return decayStart - now; // Drop below 1.0 when decay starts
      }

      // Calculate when we'll hit threshold during decay
      const decayWindow = totalWindow * 0.25;
      const decayProgress = (1.0 - threshold) / (1.0 - 0.4); // Normalize to decay range
      const timeIntoDecay = decayWindow * decayProgress;

      return decayStart + timeIntoDecay - now;
    }

    // Currently decaying
    const decayWindow = validUntil - decayStart;
    const decayProgress = (1.0 - threshold) / (1.0 - 0.4);
    const targetTime = decayStart + decayWindow * decayProgress;

    return Math.max(0, targetTime - now);
  }
}

/**
 * Default instance for convenient imports
 */
export const enhancedChangeDetector = new EnhancedChangeDetector();
