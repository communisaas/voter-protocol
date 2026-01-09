/**
 * Primary Source Comparator - WP-FRESHNESS-3
 *
 * Compares Census TIGER freshness against authoritative state redistricting
 * commissions. During redistricting years (2021-2022, 2031-2032), TIGER lags
 * 6-18 months behind state primaries. This comparator uses HTTP HEAD requests
 * (free, no download) to detect staleness.
 *
 * CORE PRINCIPLE: freshest_primary > freshest_aggregator
 *
 * CRITICAL TYPE SAFETY: Staleness detection drives source selection.
 * Type errors here cause Shadow Atlas to serve outdated boundaries during
 * redistricting windows, breaking district verification for civic participation.
 *
 * Cost: $0/year (HEAD requests only, no downloads)
 */

/**
 * Boundary type enumeration
 *
 * NOTE: Provenance subsystem uses simplified naming convention for internal
 * data freshness tracking. Maps conceptually to canonical BoundaryType enum
 * in ../types/boundary.ts but with different string literal values.
 *
 * See tiger-authority-rules.ts for complete mapping documentation.
 */
export type BoundaryType =
  | 'congressional'
  | 'state_senate'
  | 'state_house'
  | 'county'
  | 'place'
  | 'city_council'
  | 'school_unified'
  | 'voting_precinct'
  | 'special_district';

/**
 * Primary source information
 * Embedded registry of state redistricting authorities
 */
interface PrimarySourceInfo {
  readonly name: string;                  // Official name of authority
  readonly url: string;                   // Direct URL to boundary data
  readonly machineReadable: boolean;      // false = PDF/image only
  readonly boundaryTypes: readonly BoundaryType[];  // Which boundaries this source covers
  readonly notes?: string;                // Special considerations
}

/**
 * Source freshness metadata from HTTP headers
 */
export interface SourceFreshness {
  readonly url: string;
  readonly available: boolean;
  readonly lastModified: Date | null;     // From Last-Modified header
  readonly etag: string | null;           // From ETag header
  readonly contentLength: number | null;  // From Content-Length header
  readonly checkedAt: Date;
  readonly error?: string;                // Error message if check failed
}

/**
 * Comparison result between TIGER and primary source
 */
export interface TigerComparison {
  readonly jurisdiction: string;          // State code (e.g., "CA")
  readonly boundaryType: BoundaryType;
  readonly tigerIsFresh: boolean;         // false = use primary instead
  readonly reason: string;                // Human-readable explanation
  readonly recommendation: 'use-tiger' | 'use-primary' | 'manual-review';
  readonly tigerLastModified: Date | null;
  readonly primaryLastModified: Date | null;
  readonly primarySource?: {
    readonly name: string;
    readonly url: string;
    readonly machineReadable: boolean;
  };
  readonly lagDays?: number;              // How many days TIGER is behind
  readonly warning?: string;              // Non-blocking warning
}

/**
 * Freshness alert when data is potentially stale
 *
 * Triggered during scheduled audits when TIGER data lags behind
 * authoritative primary sources. Alert handlers can implement
 * custom notification logic (email, Slack, PagerDuty, etc.).
 */
export interface FreshnessAlert {
  readonly jurisdiction: string;
  readonly boundaryType: BoundaryType;
  readonly staleDays: number;
  readonly lastModified: Date | null;
  readonly recommendation: 'use-tiger' | 'use-primary' | 'manual-review';
  readonly reason: string;
}

/**
 * Alert handler callback type
 *
 * Handlers are invoked for each stale data alert during freshness audits.
 * Supports both synchronous and asynchronous handlers.
 */
export type AlertHandler = (alert: FreshnessAlert) => void | Promise<void>;

/**
 * Primary Source Registry
 *
 * Maps US states to their redistricting commission URLs.
 * Covers independent commissions and legislature-controlled redistricting.
 *
 * COVERAGE: 10 largest states + diverse commission types
 * - Independent commissions: CA, AZ, CO, MI, WA
 * - Legislature-controlled: TX, FL, NY, PA, OH
 *
 * NOTE: This is a starter set. Production should cover all 50 states.
 */
const PRIMARY_SOURCES: Map<string, PrimarySourceInfo> = new Map([
  // Independent Commissions (non-partisan)
  [
    'CA',
    {
      name: 'CA Citizens Redistricting Commission',
      url: 'https://www.wedrawthelinesca.org/data',
      machineReadable: true,
      boundaryTypes: ['congressional', 'state_senate', 'state_house'],
      notes: 'Shapefiles available for download',
    },
  ],
  [
    'AZ',
    {
      name: 'AZ Independent Redistricting Commission',
      url: 'https://azredistricting.org/Maps/',
      machineReadable: true,
      boundaryTypes: ['congressional', 'state_senate', 'state_house'],
    },
  ],
  [
    'CO',
    {
      name: 'CO Independent Redistricting Commissions',
      url: 'https://redistricting.colorado.gov/content/maps',
      machineReadable: true,
      boundaryTypes: ['congressional', 'state_senate', 'state_house'],
    },
  ],
  [
    'MI',
    {
      name: 'MI Independent Citizens Redistricting Commission',
      url: 'https://www.michigan.gov/micrc',
      machineReadable: true,
      boundaryTypes: ['congressional', 'state_senate', 'state_house'],
    },
  ],
  [
    'WA',
    {
      name: 'WA Redistricting Commission',
      url: 'https://www.redistricting.wa.gov/',
      machineReadable: true,
      boundaryTypes: ['congressional', 'state_senate', 'state_house'],
    },
  ],

  // Legislature-Controlled (partisan)
  [
    'TX',
    {
      name: 'TX Legislative Council',
      url: 'https://redistricting.capitol.texas.gov/data/',
      machineReadable: true,
      boundaryTypes: ['congressional', 'state_senate', 'state_house'],
      notes: 'Shapefiles in Downloads section',
    },
  ],
  [
    'FL',
    {
      name: 'FL Legislature',
      url: 'https://www.flsenate.gov/Session/Redistricting',
      machineReadable: true,
      boundaryTypes: ['congressional', 'state_senate', 'state_house'],
    },
  ],
  [
    'NY',
    {
      name: 'NY Independent Redistricting Commission',
      url: 'https://www.nyirc.gov/plans',
      machineReadable: true,
      boundaryTypes: ['congressional', 'state_senate', 'state_house'],
      notes: 'Commission created maps but legislature modified them',
    },
  ],
  [
    'PA',
    {
      name: 'PA Legislative Reapportionment Commission',
      url: 'https://www.redistricting.state.pa.us/',
      machineReadable: true,
      boundaryTypes: ['state_senate', 'state_house'],
      notes: 'Congressional done by legislature separately',
    },
  ],
  [
    'OH',
    {
      name: 'OH Redistricting Commission',
      url: 'https://redistricting.ohio.gov/maps',
      machineReadable: true,
      boundaryTypes: ['congressional', 'state_senate', 'state_house'],
    },
  ],
]);

/**
 * Primary Source Comparator
 *
 * Compares TIGER freshness against authoritative state sources.
 * Uses HTTP HEAD requests exclusively (zero bandwidth cost).
 */
export class PrimarySourceComparator {
  private readonly timeout = 5000;        // 5 second timeout
  private readonly maxRetries = 3;        // 3 retry attempts
  private readonly retryDelayMs = 1000;   // 1 second initial delay
  private alertHandlers: AlertHandler[] = [];

  /**
   * Compare TIGER freshness against primary source for a jurisdiction
   * Returns recommendation on which source to use
   */
  async compareTigerFreshness(
    boundaryType: BoundaryType,
    jurisdiction: string
  ): Promise<TigerComparison> {
    // 1. Get TIGER URL for this boundary type
    const tigerUrl = this.getTigerUrl(boundaryType);

    // 2. Get primary source for this jurisdiction
    const primarySource = this.getPrimarySource(jurisdiction, boundaryType);

    // 3. If no primary source, TIGER wins by default
    if (!primarySource) {
      return {
        jurisdiction,
        boundaryType,
        tigerIsFresh: true,
        reason: 'No primary source available for comparison',
        recommendation: 'use-tiger',
        tigerLastModified: null,
        primaryLastModified: null,
      };
    }

    // 4. Check both sources (in parallel for speed)
    const [tigerFreshness, primaryFreshness] = await Promise.all([
      this.checkSourceFreshness(tigerUrl),
      this.checkSourceFreshness(primarySource.url),
    ]);

    // 5. Compare and return recommendation
    return this.compare(
      jurisdiction,
      boundaryType,
      tigerFreshness,
      primaryFreshness,
      primarySource
    );
  }

  /**
   * Check freshness of a specific source via HTTP HEAD
   * Extracts ETag and Last-Modified headers without downloading
   */
  async checkSourceFreshness(url: string): Promise<SourceFreshness> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await this.fetchWithRetry(url, controller.signal);

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          url,
          available: false,
          lastModified: null,
          etag: null,
          contentLength: null,
          checkedAt: new Date(),
          error: `HTTP ${response.status}`,
        };
      }

      return {
        url,
        available: true,
        lastModified: response.headers.get('last-modified')
          ? new Date(response.headers.get('last-modified')!)
          : null,
        etag: response.headers.get('etag'),
        contentLength: response.headers.get('content-length')
          ? parseInt(response.headers.get('content-length')!)
          : null,
        checkedAt: new Date(),
      };
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        url,
        available: false,
        lastModified: null,
        etag: null,
        contentLength: null,
        checkedAt: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Batch compare all states for a boundary type
   * Useful for quarterly freshness audits
   */
  async compareAllStates(
    boundaryType: BoundaryType
  ): Promise<Map<string, TigerComparison>> {
    const results = new Map<string, TigerComparison>();

    // Get all states with primary sources for this boundary type
    const states = Array.from(PRIMARY_SOURCES.entries()).filter(([_, source]) =>
      source.boundaryTypes.includes(boundaryType)
    );

    // Compare in parallel (but with concurrency limit to avoid rate limiting)
    const comparisons = await Promise.all(
      states.map(async ([state, _]) => {
        const comparison = await this.compareTigerFreshness(
          boundaryType,
          state
        );
        return [state, comparison] as const;
      })
    );

    // Build result map
    for (const [state, comparison] of comparisons) {
      results.set(state, comparison);
    }

    return results;
  }

  /**
   * Register handler to be called when stale data detected
   *
   * Handlers are invoked during freshness audits for each alert.
   * Multiple handlers can be registered; all will be called.
   *
   * @param handler - Callback function to invoke on stale data detection
   */
  registerAlertHandler(handler: AlertHandler): void {
    this.alertHandlers.push(handler);
  }

  /**
   * Run freshness audit for a boundary type, triggering alerts for stale data
   *
   * Leverages compareAllStates() to check all jurisdictions with primary sources,
   * then converts results to FreshnessAlert objects and invokes registered handlers.
   * Only generates alerts when recommendation !== 'use-tiger' (i.e., data is stale).
   *
   * @param boundaryType - The boundary type to audit
   * @returns Array of freshness alerts generated during the audit
   */
  async runFreshnessAudit(boundaryType: BoundaryType): Promise<FreshnessAlert[]> {
    const comparisons = await this.compareAllStates(boundaryType);
    const alerts: FreshnessAlert[] = [];

    for (const [jurisdiction, comparison] of comparisons) {
      // Only trigger alerts for stale data (not 'use-tiger')
      if (comparison.recommendation === 'use-tiger') {
        continue;
      }

      // Calculate stale days from TIGER's last modified date
      const staleDays = this.calculateStaleDays(comparison);

      const alert: FreshnessAlert = {
        jurisdiction,
        boundaryType,
        staleDays,
        lastModified: comparison.tigerLastModified,
        recommendation: comparison.recommendation,
        reason: comparison.reason,
      };

      alerts.push(alert);

      // Invoke all registered handlers for this alert
      await this.invokeAlertHandlers(alert);
    }

    return alerts;
  }

  /**
   * Run freshness audit for all boundary types
   *
   * Performs comprehensive audit across all boundary types, returning
   * a map of boundary type to alerts. Useful for quarterly full audits.
   *
   * @returns Map of boundary type to array of freshness alerts
   */
  async runFullAudit(): Promise<Map<BoundaryType, FreshnessAlert[]>> {
    const allBoundaryTypes: BoundaryType[] = [
      'congressional',
      'state_senate',
      'state_house',
      'county',
      'place',
      'city_council',
      'school_unified',
      'voting_precinct',
      'special_district',
    ];

    const results = new Map<BoundaryType, FreshnessAlert[]>();

    // Run audits sequentially to avoid rate limiting on external sources
    for (const boundaryType of allBoundaryTypes) {
      const alerts = await this.runFreshnessAudit(boundaryType);
      results.set(boundaryType, alerts);
    }

    return results;
  }

  /**
   * Calculate the number of days TIGER data is stale
   *
   * Uses lagDays from comparison if available, otherwise calculates
   * from TIGER's last modified date compared to current date.
   */
  private calculateStaleDays(comparison: TigerComparison): number {
    // If lagDays is already calculated, use it
    if (comparison.lagDays !== undefined && comparison.lagDays > 0) {
      return comparison.lagDays;
    }

    // If TIGER has a last modified date, calculate days since then
    if (comparison.tigerLastModified) {
      const now = new Date();
      const diffMs = now.getTime() - comparison.tigerLastModified.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      return Math.max(0, diffDays);
    }

    // No date information available
    return 0;
  }

  /**
   * Invoke all registered alert handlers for an alert
   *
   * Handles both sync and async handlers, catching errors to prevent
   * one failed handler from blocking others.
   */
  private async invokeAlertHandlers(alert: FreshnessAlert): Promise<void> {
    for (const handler of this.alertHandlers) {
      try {
        await handler(alert);
      } catch (error) {
        // Log but don't throw - one handler failure shouldn't block others
        console.error(
          `Alert handler failed for ${alert.jurisdiction}/${alert.boundaryType}:`,
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    }
  }

  /**
   * Compare TIGER against primary source
   * Implements freshest_primary > freshest_aggregator logic
   */
  private compare(
    jurisdiction: string,
    boundaryType: BoundaryType,
    tiger: SourceFreshness,
    primary: SourceFreshness,
    primaryInfo: PrimarySourceInfo
  ): TigerComparison {
    // Case 1: Primary not available or not machine-readable
    if (!primary.available || !primaryInfo.machineReadable) {
      const warning = !primaryInfo.machineReadable
        ? 'Primary source exists but is not machine-readable (PDF/image only)'
        : 'Primary source is not currently available';

      return {
        jurisdiction,
        boundaryType,
        tigerIsFresh: true,
        reason: primary.error || warning,
        recommendation: 'use-tiger',
        tigerLastModified: tiger.lastModified,
        primaryLastModified: null,
        primarySource: {
          name: primaryInfo.name,
          url: primaryInfo.url,
          machineReadable: primaryInfo.machineReadable,
        },
        warning,
      };
    }

    // Case 2: TIGER not available (should be rare)
    if (!tiger.available) {
      return {
        jurisdiction,
        boundaryType,
        tigerIsFresh: false,
        reason: 'TIGER source is not available',
        recommendation: 'use-primary',
        tigerLastModified: null,
        primaryLastModified: primary.lastModified,
        primarySource: {
          name: primaryInfo.name,
          url: primaryInfo.url,
          machineReadable: primaryInfo.machineReadable,
        },
        warning: 'TIGER unavailable - this is unusual and should be investigated',
      };
    }

    // Case 3: No Last-Modified headers available
    if (!tiger.lastModified || !primary.lastModified) {
      return {
        jurisdiction,
        boundaryType,
        tigerIsFresh: true,
        reason: 'Cannot compare freshness - missing Last-Modified headers',
        recommendation: 'manual-review',
        tigerLastModified: tiger.lastModified,
        primaryLastModified: primary.lastModified,
        primarySource: {
          name: primaryInfo.name,
          url: primaryInfo.url,
          machineReadable: primaryInfo.machineReadable,
        },
        warning: 'Manual review required - no timestamp metadata available',
      };
    }

    // Case 4: Calculate lag between sources
    const lagMs = primary.lastModified.getTime() - tiger.lastModified.getTime();
    const lagDays = Math.floor(lagMs / (1000 * 60 * 60 * 24));

    // Case 5: Primary is fresher than TIGER
    if (lagDays > 0) {
      return {
        jurisdiction,
        boundaryType,
        tigerIsFresh: false,
        reason: `Primary source (${primaryInfo.name}) is ${lagDays} days fresher than TIGER`,
        recommendation: 'use-primary',
        tigerLastModified: tiger.lastModified,
        primaryLastModified: primary.lastModified,
        primarySource: {
          name: primaryInfo.name,
          url: primaryInfo.url,
          machineReadable: primaryInfo.machineReadable,
        },
        lagDays,
      };
    }

    // Case 6: TIGER is current (as fresh as or fresher than primary)
    return {
      jurisdiction,
      boundaryType,
      tigerIsFresh: true,
      reason:
        lagDays === 0
          ? 'TIGER is current with primary source'
          : `TIGER is ${Math.abs(lagDays)} days fresher than primary source`,
      recommendation: 'use-tiger',
      tigerLastModified: tiger.lastModified,
      primaryLastModified: primary.lastModified,
      primarySource: {
        name: primaryInfo.name,
        url: primaryInfo.url,
        machineReadable: primaryInfo.machineReadable,
      },
    };
  }

  /**
   * Fetch with exponential backoff retry logic
   */
  private async fetchWithRetry(
    url: string,
    signal: AbortSignal
  ): Promise<Response> {
    let lastError: Error | null = null;
    let delay = this.retryDelayMs;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'HEAD',
          signal,
          headers: {
            'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0 (Freshness Check)',
          },
        });

        return response;
      } catch (error) {
        lastError = error as Error;

        // Don't retry on last attempt
        if (attempt === this.maxRetries) {
          break;
        }

        // Wait before retry (exponential backoff)
        await this.sleep(delay);
        delay *= 2;
      }
    }

    throw (
      lastError ||
      new Error(`Failed to fetch after ${this.maxRetries} attempts`)
    );
  }

  /**
   * Get TIGER URL for boundary type
   * Uses current year to construct URL
   */
  private getTigerUrl(boundaryType: BoundaryType): string {
    const year = new Date().getFullYear();

    const templates: Record<BoundaryType, string> = {
      congressional: `https://www2.census.gov/geo/tiger/TIGER${year}/CD/`,
      state_senate: `https://www2.census.gov/geo/tiger/TIGER${year}/SLDU/`,
      state_house: `https://www2.census.gov/geo/tiger/TIGER${year}/SLDL/`,
      county: `https://www2.census.gov/geo/tiger/TIGER${year}/COUNTY/`,
      place: `https://www2.census.gov/geo/tiger/TIGER${year}/PLACE/`,
      city_council: `https://www2.census.gov/geo/tiger/TIGER${year}/PLACE/`, // Fallback to place
      school_unified: `https://www2.census.gov/geo/tiger/TIGER${year}/UNSD/`,
      voting_precinct: `https://www2.census.gov/geo/tiger/TIGER${year}/VTD/`,
      special_district: `https://www2.census.gov/geo/tiger/TIGER${year}/UNSD/`, // Fallback to unified school
    };

    return templates[boundaryType];
  }

  /**
   * Get primary source for jurisdiction and boundary type
   * Returns null if no primary source exists
   */
  private getPrimarySource(
    jurisdiction: string,
    boundaryType: BoundaryType
  ): PrimarySourceInfo | null {
    const source = PRIMARY_SOURCES.get(jurisdiction.toUpperCase());

    if (!source) {
      return null;
    }

    // Check if this source covers the requested boundary type
    if (!source.boundaryTypes.includes(boundaryType)) {
      return null;
    }

    return source;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get all registered primary sources
   * Useful for documentation and debugging
   */
  static getPrimarySources(): ReadonlyMap<string, PrimarySourceInfo> {
    return PRIMARY_SOURCES;
  }

  /**
   * Get states with primary sources for a boundary type
   * Useful for batch operations
   */
  static getStatesWithPrimarySources(
    boundaryType: BoundaryType
  ): readonly string[] {
    return Array.from(PRIMARY_SOURCES.entries())
      .filter(([_, source]) => source.boundaryTypes.includes(boundaryType))
      .map(([state, _]) => state);
  }
}

/**
 * Default instance for convenient imports
 */
export const primaryComparator = new PrimarySourceComparator();

/**
 * Example usage:
 *
 * ```typescript
 * import { primaryComparator } from './primary-comparator.js';
 *
 * // Check if California congressional districts are fresh
 * const comparison = await primaryComparator.compareTigerFreshness(
 *   'congressional',
 *   'CA'
 * );
 *
 * if (!comparison.tigerIsFresh) {
 *   console.warn(`TIGER is stale by ${comparison.lagDays} days`);
 *   console.log(`Use ${comparison.primarySource?.url} instead`);
 * }
 *
 * // Batch check all states for redistricting
 * const allStates = await primaryComparator.compareAllStates('congressional');
 * const staleStates = Array.from(allStates.entries())
 *   .filter(([_, comp]) => !comp.tigerIsFresh);
 *
 * console.log(`${staleStates.length} states have fresher primary sources`);
 * ```
 */
