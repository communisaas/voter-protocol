/**
 * Change Detector - Event-Driven Update Detection
 *
 * Uses HTTP headers to detect source changes without downloading.
 * Checks sources on schedules aligned with known update triggers.
 *
 * Cost: $0/year (HEAD requests are free)
 *
 * CRITICAL TYPE SAFETY: Change detection drives download orchestration.
 * Type errors here waste bandwidth downloading unchanged data or miss
 * critical boundary updates.
 */

import type { DatabaseAdapter, Source, Artifact } from '../core/types.js';
import { logger } from '../core/utils/logger.js';
import { sha256 } from './utils.js';

/**
 * Update trigger types
 * Boundaries change due to PREDICTABLE EVENTS, not continuously
 */
export type UpdateTrigger =
  | { readonly type: 'annual'; readonly month: number }           // Annual update in specified month (1-12)
  | { readonly type: 'redistricting'; readonly years: readonly number[] } // Specific years (e.g., 2021-2022)
  | { readonly type: 'census'; readonly year: number }            // Census years (2020, 2030, 2040)
  | { readonly type: 'manual' };                                  // Manual trigger

/**
 * Canonical source with update schedule
 */
export interface CanonicalSource {
  readonly id: string;                        // Source ID (from sources table)
  readonly url: string;                       // Source URL
  readonly boundaryType: string;              // e.g., 'congressional', 'municipal', 'county'
  readonly lastChecksum: string | null;       // Last known ETag or Last-Modified
  readonly lastChecked: string | null;        // ISO timestamp of last check
  readonly nextScheduledCheck: string;        // ISO timestamp of next scheduled check
  readonly updateTriggers: readonly UpdateTrigger[];
}

/**
 * Change detection result
 */
export interface ChangeReport {
  readonly sourceId: string;
  readonly url: string;
  readonly oldChecksum: string | null;
  readonly newChecksum: string;
  readonly detectedAt: string;                // ISO timestamp
  readonly trigger: 'scheduled' | 'manual' | 'forced';
  readonly changeType: 'new' | 'modified' | 'deleted';
}

/**
 * Individual check result (for diagnostics)
 */
export interface CheckResult {
  readonly sourceId: string;
  readonly checked: boolean;
  readonly changed: boolean;
  readonly error?: string;
  readonly latencyMs: number;
}

/**
 * Configuration for HEAD request retries
 */
interface RetryConfig {
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;
}

/**
 * HTTP headers for change detection
 */
interface ChangeHeaders {
  readonly etag: string | null;
  readonly lastModified: string | null;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

/**
 * Request timeout (5 seconds)
 */
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Configuration for batched change detection
 */
interface BatchConfig {
  readonly batchSize: number;            // Sources per batch (default: 20)
  readonly delayBetweenBatchesMs: number; // Delay between batches (default: 0)
  readonly maxConcurrent: number;        // Max concurrent requests (default: 20)
  readonly enableProgressReporting: boolean; // Log progress (default: true)
}

/**
 * Default batch configuration
 */
const DEFAULT_BATCH_CONFIG: BatchConfig = {
  batchSize: 20,
  delayBetweenBatchesMs: 0,
  maxConcurrent: 20,
  enableProgressReporting: true,
};

/**
 * Safe check result (includes error information)
 */
interface SafeCheckResult {
  readonly source: CanonicalSource;
  readonly change: ChangeReport | null;
  readonly error: Error | null;
  readonly latencyMs: number;
}

/**
 * Seed descriptor for a standalone (non-municipality-owned) canonical source.
 *
 * Holds only the inputs that are constant across instances; the
 * instance-dependent fields (lastChecksum, lastChecked, nextScheduledCheck and
 * the classified boundaryType) are filled in by getAllCanonicalSources using
 * this.* context. boundaryType is optional: when omitted it is computed via
 * classifyBoundaryType(url); when present it is an explicit override (used for
 * sources whose URL would otherwise misclassify — e.g. a githubusercontent feed
 * that is congressional in nature but not a TIGER URL).
 */
export interface CanonicalSourceSeed {
  readonly id: string;
  readonly url: string;
  readonly boundaryType?: string;
  readonly updateTriggers: readonly UpdateTrigger[];
}

/**
 * Standalone congressional canonical sources.
 *
 * These are nationwide feeds with no owning municipality, so they are appended
 * to the muni-derived canonical sources rather than discovered via the
 * source -> selection -> muni walk. URLs are byte-identical to the live ingest
 * paths (us-provider / ingest-legislators / tiger-manifest).
 */
export const CONGRESSIONAL_CANONICAL_SOURCES: readonly CanonicalSourceSeed[] = [
  {
    // congress-legislators current roster (YAML). Not a TIGER URL, so
    // classifyBoundaryType would mislabel it 'municipal' — set explicitly.
    id: 'congress-legislators-current',
    url: 'https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-current.yaml',
    boundaryType: 'congressional',
    updateTriggers: [{ type: 'annual', month: 1 }],
  },
  {
    // TIGER 119th Congress district shapefile. boundaryType omitted so it routes
    // through classifyBoundaryType (which returns 'congressional' for this URL).
    id: 'tiger-cd119',
    url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_us_cd119.zip',
    updateTriggers: [
      { type: 'redistricting', years: [2021, 2022, 2031, 2032] },
      { type: 'census', year: 2030 },
      { type: 'annual', month: 7 },
    ],
  },
];

/**
 * Health-ledger attempt outcome, reported per `checkForChange` call.
 *
 * Additive observation only (self-healing data ops, §Health ledger): this
 * hook fires on EVERY checkForChange attempt, success or failure, so a
 * fetch error can no longer die silently inside the try/catch. It carries
 * NO change-detection semantics of its own — `success` here means "we got a
 * usable validator from upstream", independent of whether that validator
 * differs from the previously stored one (that comparison still decides
 * changeType/ChangeReport untouched).
 */
export interface SourceAttemptOutcome {
  readonly sourceId: string;
  readonly success: boolean;
  readonly error?: string;
}

export type SourceAttemptHook = (outcome: SourceAttemptOutcome) => void;

/**
 * Change Detector
 *
 * Event-driven change detection using HTTP headers.
 * Only downloads sources that have actually changed.
 */
export class ChangeDetector {
  private readonly batchConfig: BatchConfig;

  constructor(
    private readonly db: DatabaseAdapter,
    private readonly retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG,
    batchConfig: Partial<BatchConfig> = {},
    private readonly onAttempt?: SourceAttemptHook
  ) {
    this.batchConfig = {
      ...DEFAULT_BATCH_CONFIG,
      ...batchConfig,
    };
  }

  /**
   * Check if a single source has changed
   * Uses HEAD request to compare ETag/Last-Modified
   * Returns null if unchanged
   */
  async checkForChange(source: CanonicalSource): Promise<ChangeReport | null> {
    const startTime = Date.now();

    try {
      // Fetch current headers with retry logic
      const headers = await this.fetchHeadersWithRetry(source.url);

      // Determine new checksum (prefer ETag over Last-Modified).
      // When the source serves neither validator, fall back to hashing the
      // body so a real upstream change still surfaces instead of silently
      // returning null.
      const newChecksum =
        headers.etag ||
        headers.lastModified ||
        (await this.fetchContentHash(source.url));

      if (!newChecksum) {
        // No validator served — checksum semantics unchanged (still "no
        // change"), but the ledger hook still counts this as a fetch outcome:
        // an upstream that stops sending validators looks the same to a
        // health ledger as one that 404s, and the design's error-swallow
        // fix must catch it too.
        this.onAttempt?.({
          sourceId: source.id,
          success: false,
          error: 'no validator served (no etag/last-modified/body)',
        });
        return null;
      }

      // Reaching here means upstream served a usable validator — a real
      // fetch-lane success, independent of whether it differs from the
      // previously stored checksum.
      this.onAttempt?.({ sourceId: source.id, success: true });

      // Compare with stored checksum
      if (source.lastChecksum === newChecksum) {
        return null; // No change
      }

      // Determine change type
      const changeType = source.lastChecksum === null ? 'new' : 'modified';

      return {
        sourceId: source.id,
        url: source.url,
        oldChecksum: source.lastChecksum,
        newChecksum,
        detectedAt: new Date().toISOString(),
        trigger: 'scheduled',
        changeType,
      };
    } catch (error) {
      // Error fetching headers - treat as no change to avoid spurious downloads
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Error checking source for changes', {
        sourceId: source.id,
        error: message,
      });
      // Health-ledger observation ONLY (self-healing data ops, §Health
      // ledger) — this is additive; it does not alter the return value,
      // does not throw, and does not change what counts as a "change".
      this.onAttempt?.({ sourceId: source.id, success: false, error: message });
      return null;
    }
  }

  /**
   * Check a single source safely (catches errors)
   * Returns detailed result including timing and error information
   */
  private async checkSourceSafe(source: CanonicalSource): Promise<SafeCheckResult> {
    const startTime = Date.now();
    try {
      const change = await this.checkForChange(source);
      return {
        source,
        change,
        error: null,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        source,
        change: null,
        error: error as Error,
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Check multiple sources in parallel batches
   * Respects rate limits and handles individual failures gracefully
   *
   * @param sources - Sources to check
   * @returns Array of change reports (excludes errored/unchanged sources)
   */
  async checkSourcesBatch(sources: readonly CanonicalSource[]): Promise<readonly ChangeReport[]> {
    const changes: ChangeReport[] = [];
    const errors: Array<{ source: CanonicalSource; error: Error }> = [];
    let totalChecked = 0;
    let totalChanged = 0;
    const totalSources = sources.length;

    // Process in batches
    for (let i = 0; i < sources.length; i += this.batchConfig.batchSize) {
      const batch = sources.slice(i, i + this.batchConfig.batchSize);

      // Check batch in parallel
      const batchResults = await Promise.all(
        batch.map(source => this.checkSourceSafe(source))
      );

      // Collect results
      for (const result of batchResults) {
        totalChecked++;

        if (result.error) {
          errors.push({ source: result.source, error: result.error });
          logger.warn('Failed to check source', {
            sourceId: result.source.id,
            url: result.source.url,
            error: result.error.message,
          });
        } else if (result.change) {
          changes.push(result.change);
          totalChanged++;
        }
      }

      // Progress reporting
      if (this.batchConfig.enableProgressReporting) {
        logger.info('Change detection progress', {
          checked: totalChecked,
          total: totalSources,
          changed: totalChanged,
          errors: errors.length,
        });
      }

      // Delay between batches if configured
      if (this.batchConfig.delayBetweenBatchesMs > 0 && i + this.batchConfig.batchSize < sources.length) {
        await this.sleep(this.batchConfig.delayBetweenBatchesMs);
      }
    }

    // Final summary
    if (this.batchConfig.enableProgressReporting) {
      logger.info('Change detection complete', {
        sourcesChecked: totalChecked,
        sourcesChanged: totalChanged,
        errors: errors.length,
      });
    }

    return changes;
  }

  /**
   * Check all sources that are due for verification
   * Based on update triggers (annual in July, redistricting years, etc.)
   * Uses batched parallel checking for performance
   */
  async checkScheduledSources(): Promise<readonly ChangeReport[]> {
    const sourcesDue = await this.getSourcesDueForCheck();
    return this.checkSourcesBatch(sourcesDue);
  }

  /**
   * Force check all sources regardless of schedule
   * Use sparingly (e.g., after system outage)
   * Uses batched parallel checking for performance
   */
  async checkAllSources(): Promise<readonly ChangeReport[]> {
    // Get all sources from database
    const sources = await this.getAllCanonicalSources();

    // Check in batches
    const changes = await this.checkSourcesBatch(sources);

    // Mark all changes as 'forced' trigger
    return changes.map(change => ({
      ...change,
      trigger: 'forced' as const,
    }));
  }

  /**
   * Get sources due for checking based on triggers
   */
  async getSourcesDueForCheck(): Promise<readonly CanonicalSource[]> {
    const allSources = await this.getAllCanonicalSources();
    const now = new Date();

    return allSources.filter(source => {
      // Check if any trigger applies now
      const triggerApplies = source.updateTriggers.some(trigger =>
        this.triggerAppliesNow(trigger)
      );

      // Also check if next scheduled check has passed
      const scheduledCheckPassed = new Date(source.nextScheduledCheck) <= now;

      return triggerApplies || scheduledCheckPassed;
    });
  }

  /**
   * Update checksum after a detected change.
   *
   * Persists the new validator into the artifacts table and advances the
   * municipality's head to the new artifact, then appends an UPDATE audit
   * event. The validator's STORAGE COLUMN mirrors the sibling TIGER path in
   * change-detection-adapter.ts (leading double-quote => etag, else
   * last_modified).
   *
   * The new checksum is NOT a content vintage: content_sha256 / record_count /
   * bbox / last_edit_date carry over verbatim from the prior artifact when one
   * exists, else null. A date is NEVER borrowed or synthesized (no Date.now()
   * as a vintage) — an absent prior artifact yields null content fields.
   *
   * If no municipality has this sourceId selected, no state is fabricated: a
   * SKIP event is appended and the call returns without mutating artifacts/head.
   */
  async updateChecksum(sourceId: string, checksum: string): Promise<void> {
    // Resolve the muni owning this selected source by reusing the exact
    // source -> selection -> muni walk that getAllCanonicalSources uses.
    const municipalities = await this.db.listMunicipalities(10000, 0);

    for (const muni of municipalities) {
      const sources = await this.db.getSourcesByMuni(muni.id);
      const selection = await this.db.getSelection(muni.id);
      const selectedSource = selection
        ? sources.find(s => s.id === selection.source_id)
        : null;

      if (!selectedSource || selectedSource.id.toString() !== sourceId) {
        continue;
      }

      // Read the current head/artifact (may be absent on first acquisition).
      const head = await this.db.getHead(muni.id);
      const priorArtifact = head ? await this.db.getArtifact(head.artifact_id) : null;

      // Derive validator storage column from the checksum shape, mirroring
      // change-detection-adapter.ts:251-253. Leading double-quote => ETag.
      const isEtag = checksum.startsWith('"');

      // Carry content fields over from the prior artifact verbatim, else null.
      // NEVER borrow a date or use Date.now() as a vintage.
      const newArtifact: Omit<Artifact, 'id' | 'created_at'> = {
        muni_id: muni.id,
        content_sha256: priorArtifact?.content_sha256 ?? '',
        record_count: priorArtifact?.record_count ?? 0,
        bbox: priorArtifact?.bbox ?? null,
        etag: isEtag ? checksum : null,
        last_modified: isEtag ? null : checksum,
        last_edit_date: priorArtifact?.last_edit_date ?? null,
      };

      const newId = await this.db.insertArtifact(newArtifact);
      await this.db.upsertHead({ muni_id: muni.id, artifact_id: newId });

      await this.db.insertEvent({
        run_id: 'change-detector',
        muni_id: muni.id,
        kind: 'UPDATE',
        payload: { sourceId, checksum, artifact_id: newId },
        model: null,
        duration_ms: null,
        error: null,
      });

      return;
    }

    // No muni/selected source matched this sourceId.
    //
    // A recognized standalone congressional source has no owning muni (and thus
    // no artifact/head/selection), but its validator is still real upstream
    // state worth persisting. Record it as a durable UPDATE event keyed by
    // sourceId so getAllCanonicalSources can read the latest checksum back on
    // the next pass — no perpetual `new`. No artifact/head/selection is
    // fabricated (foreign_keys=ON, stable string ids preserved).
    const isCongressionalSeed = CONGRESSIONAL_CANONICAL_SOURCES.some(
      seed => seed.id === sourceId
    );

    if (isCongressionalSeed) {
      await this.db.insertEvent({
        run_id: 'change-detector',
        muni_id: null,
        kind: 'UPDATE',
        payload: { sourceId, checksum },
        model: null,
        duration_ms: null,
        error: null,
      });
      return;
    }

    // Truly-unknown sourceId — do not fabricate state. Append a SKIP audit row
    // (distinct from the congressional UPDATE above so the read-back semantics
    // stay unambiguous) and return without writing artifact/head.
    await this.db.insertEvent({
      run_id: 'change-detector',
      muni_id: null,
      kind: 'SKIP',
      payload: { sourceId, checksum, reason: 'no selected source matched sourceId' },
      model: null,
      duration_ms: null,
      error: null,
    });
  }

  /**
   * Check if an update trigger applies now
   */
  private triggerAppliesNow(trigger: UpdateTrigger): boolean {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // JavaScript months are 0-indexed

    switch (trigger.type) {
      case 'annual':
        // Check if we're in the specified month
        return currentMonth === trigger.month;

      case 'redistricting':
        // Check if current year is in the redistricting years
        return trigger.years.includes(currentYear);

      case 'census':
        // Check if current year matches census year
        return currentYear === trigger.year;

      case 'manual':
        // Manual triggers always apply (require explicit invocation)
        return false;

      default:
        // TypeScript exhaustiveness check
        const _exhaustive: never = trigger;
        return false;
    }
  }

  /**
   * Parse HTTP headers for change detection
   */
  private parseChangeHeaders(headers: Headers): ChangeHeaders {
    return {
      etag: headers.get('etag'),
      lastModified: headers.get('last-modified'),
    };
  }

  /**
   * Fetch headers with retry logic
   */
  private async fetchHeadersWithRetry(url: string): Promise<ChangeHeaders> {
    let lastError: Error | null = null;
    let delayMs = this.retryConfig.initialDelayMs;

    for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
      try {
        const headers = await this.fetchHeaders(url);
        return headers;
      } catch (error) {
        lastError = error as Error;

        // Don't retry on last attempt
        if (attempt === this.retryConfig.maxAttempts) {
          break;
        }

        // Wait before retry (exponential backoff)
        await this.sleep(delayMs);
        delayMs = Math.min(
          delayMs * this.retryConfig.backoffMultiplier,
          this.retryConfig.maxDelayMs
        );
      }
    }

    throw lastError || new Error(`Failed to fetch headers after ${this.retryConfig.maxAttempts} attempts`);
  }

  /**
   * Fetch headers using HEAD request
   */
  private async fetchHeaders(url: string): Promise<ChangeHeaders> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0 (Change Detection)',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return this.parseChangeHeaders(response.headers);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Fetch body and return its SHA-256.
   *
   * Fallback for sources that serve neither ETag nor Last-Modified.
   * Single-shot GET (no retry) — the caller's try/catch turns any failure
   * into a null (no-change) result, preserving the no-spurious-download
   * contract.
   */
  private async fetchContentHash(url: string): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0 (Change Detection)',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const body = await response.text();
      return sha256(body);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get all canonical sources from database
   *
   * This is a simplified implementation that converts database sources
   * to canonical sources with default update triggers.
   *
   * In production, you'd want:
   * - A separate canonical_sources table with trigger configuration
   * - Proper source classification by boundary type
   * - Configurable update schedules per source type
   *
   * Public (not just an internal helper): this is the authoritative
   * "fetch lane" surface — the health-ledger lane-exclusivity assertion
   * (source-prober.ts) reads it back by id to verify every registry row
   * declared `lane: 'fetch'` is actually reachable through this walk,
   * recording a config breach otherwise. No behavior change from making
   * this callable externally; it was already the surface checkForChange's
   * callers rely on implicitly.
   */
  async getAllCanonicalSources(): Promise<readonly CanonicalSource[]> {
    // Get all municipalities to find their sources
    const municipalities = await this.db.listMunicipalities(10000, 0);
    const canonicalSources: CanonicalSource[] = [];

    for (const muni of municipalities) {
      // Get sources for this municipality
      const sources = await this.db.getSourcesByMuni(muni.id);

      // Get the selected source if it exists
      const selection = await this.db.getSelection(muni.id);
      const selectedSource = selection
        ? sources.find(s => s.id === selection.source_id)
        : null;

      if (!selectedSource) {
        continue;
      }

      // Get most recent artifact to find checksum
      const head = await this.db.getHead(muni.id);
      const artifact = head ? await this.db.getArtifact(head.artifact_id) : null;

      // Classify boundary type from the selected source URL.
      // TIGER congressional shapefiles live under www2.census.gov/geo/tiger
      // in a /CD/ directory (or a cd layer); everything else defaults to
      // municipal.
      const boundaryType = this.classifyBoundaryType(selectedSource.url);

      // Default update triggers for municipal boundaries.
      // These years are a scheduling HINT (when to proactively re-check) and are
      // non-authoritative: the checksum compare, not the year, decides whether a
      // change actually fired, so an off-cycle change still surfaces.
      const updateTriggers: UpdateTrigger[] = [
        { type: 'annual', month: 7 },                           // Check in July
        { type: 'redistricting', years: [2021, 2022, 2031, 2032] }, // Redistricting cycles
      ];

      // Calculate next scheduled check
      const nextScheduledCheck = this.calculateNextScheduledCheck(updateTriggers);

      canonicalSources.push({
        id: selectedSource.id.toString(),
        url: selectedSource.url,
        boundaryType,
        lastChecksum: artifact?.etag || artifact?.last_modified || null,
        lastChecked: artifact?.created_at || null,
        nextScheduledCheck,
        updateTriggers,
      });
    }

    // Append standalone congressional canonical sources (no owning muni).
    //
    // lastChecksum is read back from the durable event log instead of being
    // hardcoded null: updateChecksum persists a recognized congressional
    // source's validator as an UPDATE event keyed by sourceId. Reading the
    // latest such event back here lets the source report 'unchanged' on the
    // second pass after a checksum was persisted — `new` only on first sight,
    // not perpetually. getEventsByRun returns NEWEST-first, so the FIRST matching
    // event is the latest checksum — robust to >LIMIT churn from the shared
    // run_id; default to null when none is found.
    const detectorEvents = await this.db.getEventsByRun('change-detector');

    for (const seed of CONGRESSIONAL_CANONICAL_SOURCES) {
      let lastChecksum: string | null = null;
      for (const event of detectorEvents) {
        const payload = event.payload;
        if (payload.sourceId === seed.id && typeof payload.checksum === 'string') {
          lastChecksum = payload.checksum;
          break;
        }
      }

      canonicalSources.push({
        id: seed.id,
        url: seed.url,
        boundaryType: seed.boundaryType ?? this.classifyBoundaryType(seed.url),
        lastChecksum,
        lastChecked: null,
        nextScheduledCheck: this.calculateNextScheduledCheck(seed.updateTriggers),
        updateTriggers: seed.updateTriggers,
      });
    }

    return canonicalSources;
  }

  /**
   * Classify a source's boundary type from its URL.
   *
   * Congressional sources are TIGER shapefiles served from
   * www2.census.gov/geo/tiger in a CD (congressional district) layer/dir.
   * Anything else falls back to 'municipal'.
   */
  private classifyBoundaryType(url: string): string {
    const lower = url.toLowerCase();
    const isTiger = lower.includes('www2.census.gov/geo/tiger');
    const isCongressional = /\/cd\//.test(lower) || /[_/]cd[._/]/.test(lower);

    if (isTiger && isCongressional) {
      return 'congressional';
    }

    return 'municipal';
  }

  /**
   * Calculate next scheduled check based on update triggers
   */
  private calculateNextScheduledCheck(triggers: readonly UpdateTrigger[]): string {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // Find the earliest applicable trigger
    let nextCheck = new Date(currentYear + 1, 0, 1); // Default: next year

    for (const trigger of triggers) {
      switch (trigger.type) {
        case 'annual':
          // Next occurrence of the specified month
          const nextAnnual = new Date(
            currentMonth > trigger.month ? currentYear + 1 : currentYear,
            trigger.month - 1,
            1
          );
          if (nextAnnual < nextCheck) {
            nextCheck = nextAnnual;
          }
          break;

        case 'redistricting':
          // Next redistricting year
          const futureYears = trigger.years.filter(year => year > currentYear);
          if (futureYears.length > 0) {
            const nextRedistricting = new Date(futureYears[0], 0, 1);
            if (nextRedistricting < nextCheck) {
              nextCheck = nextRedistricting;
            }
          }
          break;

        case 'census':
          // Next census year
          if (trigger.year > currentYear) {
            const nextCensus = new Date(trigger.year, 0, 1);
            if (nextCensus < nextCheck) {
              nextCheck = nextCensus;
            }
          }
          break;

        case 'manual':
          // Manual triggers don't affect scheduling
          break;
      }
    }

    return nextCheck.toISOString();
  }
}
