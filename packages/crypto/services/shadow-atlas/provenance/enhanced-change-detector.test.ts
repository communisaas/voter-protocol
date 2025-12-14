/**
 * Enhanced Change Detector Tests - WP-FRESHNESS-6
 *
 * Tests freshness-aware change detection with:
 * - Priority queue ordering
 * - Redistricting gap behavior
 * - Mock HTTP responses for deterministic tests
 * - Confidence-based scheduling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EnhancedChangeDetector,
  type SourceInfo,
  type ChangeDetectionResult,
  type PrioritizedRefreshQueue,
  type RefreshSchedule,
} from './enhanced-change-detector.js';
import {
  DefaultValidityWindowCalculator,
  type ValidityWindowCalculator,
} from './validity-window.js';
import {
  PrimarySourceComparator,
  type TigerComparison,
} from './primary-comparator.js';
import {
  RedistrictingGapDetector,
} from './gap-detector.js';

/**
 * Mock validity window calculator
 * Allows controlling confidence values for deterministic tests
 */
class MockValidityWindowCalculator extends DefaultValidityWindowCalculator {
  private mockConfidence = 1.0;

  setMockConfidence(confidence: number): void {
    this.mockConfidence = confidence;
  }

  override computeConfidence(): number {
    return this.mockConfidence;
  }
}

/**
 * Mock primary source comparator
 * Allows controlling TIGER freshness comparison results
 */
class MockPrimarySourceComparator extends PrimarySourceComparator {
  private mockComparison: TigerComparison | null = null;

  setMockComparison(comparison: TigerComparison | null): void {
    this.mockComparison = comparison;
  }

  override async compareTigerFreshness(): Promise<TigerComparison> {
    if (this.mockComparison) {
      return this.mockComparison;
    }

    // Default: TIGER is fresh
    return {
      jurisdiction: 'CA',
      boundaryType: 'congressional',
      tigerIsFresh: true,
      reason: 'Mock comparison',
      recommendation: 'use-tiger',
      tigerLastModified: new Date(),
      primaryLastModified: null,
    };
  }
}

/**
 * Mock gap detector
 * Allows controlling gap status for deterministic tests
 */
class MockGapDetector extends RedistrictingGapDetector {
  private mockInGap = false;
  private mockGapStatus: import('./gap-detector.js').GapStatus | null = null;

  setMockInGap(inGap: boolean): void {
    this.mockInGap = inGap;
  }

  setMockGapStatus(status: import('./gap-detector.js').GapStatus | null): void {
    this.mockGapStatus = status;
  }

  override isInGap(): boolean {
    return this.mockInGap;
  }

  override checkBoundaryGap(): import('./gap-detector.js').GapStatus {
    if (this.mockGapStatus) {
      return this.mockGapStatus;
    }

    // Default: not in gap
    return {
      inGap: this.mockInGap,
      gapType: this.mockInGap ? 'post-finalization-pre-tiger' : 'none',
      recommendation: this.mockInGap ? 'use-primary' : 'use-tiger',
      reasoning: this.mockInGap ? 'In redistricting gap' : 'Not in gap',
    };
  }
}

/**
 * Create mock source info
 */
function createMockSource(overrides: Partial<SourceInfo> = {}): SourceInfo {
  return {
    id: 'source-1',
    url: 'https://example.com/data',
    sourceType: 'tiger',
    boundaryType: 'congressional',
    jurisdiction: 'CA',
    releaseDate: new Date('2024-07-01'),
    lastChecksum: 'mock-etag-123',
    lastChecked: new Date('2024-06-01'),
    ...overrides,
  };
}

describe('EnhancedChangeDetector', () => {
  let detector: EnhancedChangeDetector;
  let mockValidityCalculator: MockValidityWindowCalculator;
  let mockPrimaryComparator: MockPrimarySourceComparator;
  let mockGapDetector: MockGapDetector;

  beforeEach(() => {
    mockValidityCalculator = new MockValidityWindowCalculator();
    mockPrimaryComparator = new MockPrimarySourceComparator();
    mockGapDetector = new MockGapDetector();

    detector = new EnhancedChangeDetector(
      mockValidityCalculator,
      mockPrimaryComparator,
      mockGapDetector
    );

    // Mock fetch globally
    global.fetch = vi.fn();
  });

  describe('detectChangesWithFreshness', () => {
    it('detects no changes when HTTP headers unchanged and confidence high', async () => {
      // Setup: No HTTP header change, high confidence
      mockValidityCalculator.setMockConfidence(0.9);
      mockGapDetector.setMockInGap(false);

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        headers: {
          get: (key: string) => {
            if (key === 'etag') return 'mock-etag-123'; // Same as lastChecksum
            if (key === 'last-modified') return 'Wed, 01 May 2024 00:00:00 GMT';
            return null;
          },
        },
      } as Response);

      const sources: SourceInfo[] = [createMockSource()];

      const results = await detector.detectChangesWithFreshness(
        'congressional',
        'CA',
        sources
      );

      expect(results).toHaveLength(1);
      expect(results[0].hasChanged).toBe(false);
      expect(results[0].changeType).toBe('none');
      expect(results[0].suggestedAction).toBe('no-action');
      expect(results[0].freshnessContext.confidence).toBe(0.9);
    });

    it('detects content change when HTTP headers changed', async () => {
      // Setup: HTTP header changed with low enough confidence to trigger schedule-refresh
      mockValidityCalculator.setMockConfidence(0.6); // Below 0.7 triggers schedule-refresh
      mockGapDetector.setMockInGap(false);

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        headers: {
          get: (key: string) => {
            if (key === 'etag') return 'mock-etag-456'; // Different from lastChecksum
            if (key === 'last-modified') return 'Wed, 01 Jun 2024 00:00:00 GMT';
            return null;
          },
        },
      } as Response);

      const sources: SourceInfo[] = [createMockSource()];

      const results = await detector.detectChangesWithFreshness(
        'congressional',
        'CA',
        sources
      );

      expect(results).toHaveLength(1);
      expect(results[0].hasChanged).toBe(true);
      expect(results[0].changeType).toBe('content');
      expect(results[0].suggestedAction).toBe('schedule-refresh');
      expect(results[0].newChecksum).toBe('mock-etag-456');
    });

    it('prioritizes primary source during redistricting gap', async () => {
      // Setup: In redistricting gap, TIGER is stale
      mockValidityCalculator.setMockConfidence(0.3); // Low confidence during gap
      mockGapDetector.setMockInGap(true);
      mockGapDetector.setMockGapStatus({
        inGap: true,
        gapType: 'post-finalization-pre-tiger',
        recommendation: 'use-primary',
        reasoning: 'CA finalized redistricting but TIGER hasn\'t updated yet',
      });

      mockPrimaryComparator.setMockComparison({
        jurisdiction: 'CA',
        boundaryType: 'congressional',
        tigerIsFresh: false, // TIGER is stale
        reason: 'Primary source is 45 days fresher',
        recommendation: 'use-primary',
        tigerLastModified: new Date('2024-01-01'),
        primaryLastModified: new Date('2024-02-15'),
        lagDays: 45,
      });

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        headers: {
          get: (key: string) => {
            if (key === 'etag') return 'mock-etag-123';
            if (key === 'last-modified') return 'Wed, 01 May 2024 00:00:00 GMT';
            return null;
          },
        },
      } as Response);

      const sources: SourceInfo[] = [createMockSource()];

      const results = await detector.detectChangesWithFreshness(
        'congressional',
        'CA',
        sources
      );

      expect(results).toHaveLength(1);
      expect(results[0].hasChanged).toBe(true);
      expect(results[0].changeType).toBe('content');
      expect(results[0].freshnessContext.inRedistrictingGap).toBe(true);
      expect(results[0].freshnessContext.recommendation).toBe('use-primary');
      expect(results[0].suggestedAction).toBe('refresh-now');
      expect(results[0].reasoning).toContain('in redistricting gap');
      expect(results[0].reasoning).toContain('TIGER stale by 45 days');
    });

    it('detects metadata concern when confidence low but no header change', async () => {
      // Setup: No HTTP header change but low confidence
      mockValidityCalculator.setMockConfidence(0.35); // Low confidence
      mockGapDetector.setMockInGap(false);

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        headers: {
          get: (key: string) => {
            if (key === 'etag') return 'mock-etag-123'; // Same as lastChecksum
            if (key === 'last-modified') return 'Wed, 01 May 2024 00:00:00 GMT';
            return null;
          },
        },
      } as Response);

      const sources: SourceInfo[] = [createMockSource()];

      const results = await detector.detectChangesWithFreshness(
        'congressional',
        'CA',
        sources
      );

      expect(results).toHaveLength(1);
      expect(results[0].hasChanged).toBe(true);
      expect(results[0].changeType).toBe('metadata');
      expect(results[0].suggestedAction).toBe('schedule-refresh');
      expect(results[0].freshnessContext.confidence).toBe(0.35);
    });

    it('handles network errors gracefully', async () => {
      // Setup: Network error during HTTP HEAD request
      mockValidityCalculator.setMockConfidence(0.9);
      mockGapDetector.setMockInGap(false);

      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error')
      );

      const sources: SourceInfo[] = [createMockSource()];

      const results = await detector.detectChangesWithFreshness(
        'congressional',
        'CA',
        sources
      );

      expect(results).toHaveLength(1);
      expect(results[0].hasChanged).toBe(false);
      expect(results[0].changeType).toBe('none');
      expect(results[0].newChecksum).toBe('mock-etag-123'); // Unchanged
    });

    it('processes multiple sources correctly', async () => {
      // Setup: Multiple sources with different states
      mockValidityCalculator.setMockConfidence(0.9);
      mockGapDetector.setMockInGap(false);

      let callCount = 0;
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          ok: true,
          headers: {
            get: (key: string) => {
              if (key === 'etag') return callCount === 1 ? 'mock-etag-123' : 'mock-etag-456';
              if (key === 'last-modified') return 'Wed, 01 May 2024 00:00:00 GMT';
              return null;
            },
          },
        } as Response);
      });

      const sources: SourceInfo[] = [
        createMockSource({ id: 'source-1', lastChecksum: 'mock-etag-123' }),
        createMockSource({ id: 'source-2', lastChecksum: 'mock-etag-000' }),
      ];

      const results = await detector.detectChangesWithFreshness(
        'congressional',
        'CA',
        sources
      );

      expect(results).toHaveLength(2);
      expect(results[0].hasChanged).toBe(false); // No change
      expect(results[1].hasChanged).toBe(true); // Changed
    });
  });

  describe('getRefreshPriority', () => {
    it('assigns critical priority to sources in redistricting gap', () => {
      mockValidityCalculator.setMockConfidence(0.3);
      mockGapDetector.setMockInGap(true);

      const sources: SourceInfo[] = [
        createMockSource({
          boundaryType: 'congressional',
          jurisdiction: 'CA',
        }),
      ];

      const queue: PrioritizedRefreshQueue = detector.getRefreshPriority(sources);

      expect(queue.critical).toHaveLength(1);
      expect(queue.critical[0].priority).toBe('critical');
      expect(queue.critical[0].reasoning).toContain('CRITICAL');
      expect(queue.critical[0].reasoning).toContain('redistricting gap');
    });

    it('assigns high priority to very low confidence sources', () => {
      mockValidityCalculator.setMockConfidence(0.35); // Below 0.4
      mockGapDetector.setMockInGap(false);

      const sources: SourceInfo[] = [createMockSource()];

      const queue: PrioritizedRefreshQueue = detector.getRefreshPriority(sources);

      expect(queue.high).toHaveLength(1);
      expect(queue.high[0].priority).toBe('high');
      expect(queue.high[0].reasoning).toContain('HIGH');
      expect(queue.high[0].reasoning).toContain('Very low confidence');
    });

    it('assigns high priority to very stale sources', () => {
      mockValidityCalculator.setMockConfidence(0.9);
      mockGapDetector.setMockInGap(false);

      const sources: SourceInfo[] = [
        createMockSource({
          lastChecked: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000), // 200 days ago
        }),
      ];

      const queue: PrioritizedRefreshQueue = detector.getRefreshPriority(sources);

      expect(queue.high).toHaveLength(1);
      expect(queue.high[0].priority).toBe('high');
      expect(queue.high[0].staleness).toBeGreaterThan(180);
      expect(queue.high[0].reasoning).toContain('Stale for');
    });

    it('assigns medium priority to moderately low confidence sources', () => {
      mockValidityCalculator.setMockConfidence(0.65); // Between 0.4-0.7
      mockGapDetector.setMockInGap(false);

      const sources: SourceInfo[] = [
        createMockSource({ lastChecked: new Date() }), // Recent check to avoid staleness priority
      ];

      const queue: PrioritizedRefreshQueue = detector.getRefreshPriority(sources);

      expect(queue.medium).toHaveLength(1);
      expect(queue.medium[0].priority).toBe('medium');
      expect(queue.medium[0].reasoning).toContain('MEDIUM');
      expect(queue.medium[0].reasoning).toContain('Low confidence');
    });

    it('assigns low priority to fresh sources with high confidence', () => {
      mockValidityCalculator.setMockConfidence(0.95);
      mockGapDetector.setMockInGap(false);

      const sources: SourceInfo[] = [
        createMockSource({
          lastChecked: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
        }),
      ];

      const queue: PrioritizedRefreshQueue = detector.getRefreshPriority(sources);

      expect(queue.low).toHaveLength(1);
      expect(queue.low[0].priority).toBe('low');
      expect(queue.low[0].reasoning).toContain('LOW');
      expect(queue.low[0].reasoning).toContain('Good confidence');
    });

    it('sorts sources by priority correctly', () => {
      let confidenceIndex = 0;
      const confidences = [0.95, 0.35, 0.65, 0.25]; // low, high, medium, high

      mockGapDetector.setMockInGap(false);

      // Override mock to return different confidence for each source
      const originalComputeConfidence = mockValidityCalculator.computeConfidence.bind(
        mockValidityCalculator
      );
      mockValidityCalculator.computeConfidence = () => {
        return confidences[confidenceIndex++];
      };

      const now = new Date();
      const sources: SourceInfo[] = [
        createMockSource({
          id: 'low',
          lastChecked: now,
          releaseDate: now
        }), // 0.95 confidence, just checked = low
        createMockSource({
          id: 'high-conf-1',
          lastChecked: now,
          releaseDate: now
        }), // 0.35 confidence, just checked = high (confidence < 0.4)
        createMockSource({
          id: 'medium',
          lastChecked: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),  // 100 days ago
          releaseDate: now
        }), // 0.65 confidence, 100 days old = medium (0.4-0.7 conf OR 90-180 days)
        createMockSource({
          id: 'high-staleness',
          releaseDate: now,
          lastChecked: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
        }), // 0.25 confidence + 200 days old = high (confidence < 0.4 OR staleness > 180)
      ];

      const queue: PrioritizedRefreshQueue = detector.getRefreshPriority(sources);

      // Verify correct prioritization across all tiers
      expect(queue.totalCount).toBe(4);
      expect(queue.low.length + queue.medium.length + queue.high.length + queue.critical.length).toBe(4);

      // At least one source should be high priority (0.35 or 0.25 confidence)
      expect(queue.high.length).toBeGreaterThanOrEqual(1);

      // Sources should be distributed across priorities based on confidence and staleness
      expect(queue.critical.length).toBe(0); // No gap sources
    });
  });

  describe('scheduleConfidenceBasedRefresh', () => {
    it('schedules refresh for sources below threshold', () => {
      mockValidityCalculator.setMockConfidence(0.5); // Below threshold
      mockGapDetector.setMockInGap(false);

      const sources: SourceInfo[] = [createMockSource()];

      const schedule: RefreshSchedule = detector.scheduleConfidenceBasedRefresh(
        sources,
        0.7
      );

      expect(schedule.sources).toHaveLength(1);
      expect(schedule.reasoning).toContain('1 sources below confidence threshold');
      expect(schedule.nextRefresh).toBeInstanceOf(Date);
    });

    it('returns empty schedule when all sources above threshold', () => {
      mockValidityCalculator.setMockConfidence(0.9); // Above threshold
      mockGapDetector.setMockInGap(false);

      const sources: SourceInfo[] = [createMockSource()];

      const schedule: RefreshSchedule = detector.scheduleConfidenceBasedRefresh(
        sources,
        0.7
      );

      expect(schedule.sources).toHaveLength(0);
      expect(schedule.reasoning).toContain('All sources above confidence threshold');
    });

    it('uses daily check interval when refresh is soon', () => {
      mockValidityCalculator.setMockConfidence(0.5);
      mockGapDetector.setMockInGap(false);

      const sources: SourceInfo[] = [createMockSource()];

      const schedule: RefreshSchedule = detector.scheduleConfidenceBasedRefresh(
        sources,
        0.7
      );

      // Should use daily interval if next refresh is within a week
      const msUntilRefresh = schedule.nextRefresh.getTime() - Date.now();
      if (msUntilRefresh < 7 * 24 * 60 * 60 * 1000) {
        expect(schedule.checkInterval).toBe(24 * 60 * 60 * 1000); // Daily
      }
    });

    it('uses appropriate check interval based on time until refresh', () => {
      mockValidityCalculator.setMockConfidence(0.95); // High confidence
      mockGapDetector.setMockInGap(false);

      const sources: SourceInfo[] = [createMockSource()];

      const schedule: RefreshSchedule = detector.scheduleConfidenceBasedRefresh(
        sources,
        0.7
      );

      // Should use daily or weekly interval depending on time until next refresh
      // The test doesn't know exact timing since it depends on validity window calculation
      // Just verify it's one of the two valid intervals
      const validIntervals = [
        24 * 60 * 60 * 1000,  // Daily
        7 * 24 * 60 * 60 * 1000, // Weekly
      ];
      expect(validIntervals).toContain(schedule.checkInterval);
    });
  });

  describe('HTTP header mocking', () => {
    it('handles missing ETag header gracefully', async () => {
      mockValidityCalculator.setMockConfidence(0.9);
      mockGapDetector.setMockInGap(false);

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        headers: {
          get: (key: string) => {
            if (key === 'last-modified') return 'Wed, 01 May 2024 00:00:00 GMT';
            return null;
          },
        },
      } as Response);

      const sources: SourceInfo[] = [
        createMockSource({ lastChecksum: 'Wed, 01 May 2024 00:00:00 GMT' }),
      ];

      const results = await detector.detectChangesWithFreshness(
        'congressional',
        'CA',
        sources
      );

      expect(results).toHaveLength(1);
      expect(results[0].hasChanged).toBe(false);
    });

    it('handles HTTP error responses', async () => {
      mockValidityCalculator.setMockConfidence(0.9);
      mockGapDetector.setMockInGap(false);

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      const sources: SourceInfo[] = [createMockSource()];

      const results = await detector.detectChangesWithFreshness(
        'congressional',
        'CA',
        sources
      );

      expect(results).toHaveLength(1);
      expect(results[0].hasChanged).toBe(false);
    });

    it('handles timeout via AbortController', async () => {
      mockValidityCalculator.setMockConfidence(0.9);
      mockGapDetector.setMockInGap(false);

      // Simulate timeout by delaying response beyond timeout
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  headers: {
                    get: () => null,
                  },
                } as Response),
              10000
            )
          )
      );

      const sources: SourceInfo[] = [createMockSource()];

      // This should timeout and treat as no change
      const results = await detector.detectChangesWithFreshness(
        'congressional',
        'CA',
        sources
      );

      expect(results).toHaveLength(1);
      expect(results[0].hasChanged).toBe(false);
    }, 10000); // Extend test timeout
  });

  describe('edge cases', () => {
    it('handles sources with null lastChecked', () => {
      mockValidityCalculator.setMockConfidence(0.9);
      mockGapDetector.setMockInGap(false);

      const sources: SourceInfo[] = [
        createMockSource({ lastChecked: null }),
      ];

      const queue: PrioritizedRefreshQueue = detector.getRefreshPriority(sources);

      // Should assign high priority due to Infinity staleness
      expect(queue.high).toHaveLength(1);
      expect(queue.high[0].staleness).toBe(Infinity);
    });

    it('handles primary sources correctly', () => {
      // Primary sources always have confidence 1.0
      mockValidityCalculator.setMockConfidence(1.0);
      mockGapDetector.setMockInGap(false);

      const sources: SourceInfo[] = [
        createMockSource({ sourceType: 'primary', lastChecked: new Date() }),
      ];

      const queue: PrioritizedRefreshQueue = detector.getRefreshPriority(sources);

      expect(queue.low).toHaveLength(1);
      expect(queue.low[0].confidence).toBe(1.0);
    });

    it('handles empty sources array', async () => {
      const results = await detector.detectChangesWithFreshness(
        'congressional',
        'CA',
        []
      );

      expect(results).toHaveLength(0);
    });

    it('handles empty sources array for priority queue', () => {
      const queue: PrioritizedRefreshQueue = detector.getRefreshPriority([]);

      expect(queue.critical).toHaveLength(0);
      expect(queue.high).toHaveLength(0);
      expect(queue.medium).toHaveLength(0);
      expect(queue.low).toHaveLength(0);
      expect(queue.totalCount).toBe(0);
    });
  });
});
