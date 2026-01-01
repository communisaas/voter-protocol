/**
 * Validity Window System - Data Freshness Verification
 *
 * Shadow Atlas needs to know when data becomes stale. Each data source has a
 * "validity window" - the period during which we trust the data. Census TIGER
 * has a 12-month validity window (July to July), but during redistricting years
 * (2021-2022, 2031-2032), TIGER's validity is compromised because primary sources
 * (state redistricting commissions) have newer data.
 *
 * KEY INSIGHT: Boundaries change due to PREDICTABLE EVENTS (Census, redistricting,
 * legislative sessions), not continuously. We can calculate when staleness is likely.
 *
 * CRITICAL TYPE SAFETY: Validity calculations drive data refresh decisions.
 * Type errors here can serve stale redistricting data for months, causing
 * users to contact wrong congressional offices.
 */

/**
 * Boundary types for validity window calculations
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
 * Source types with different validity characteristics
 */
export type SourceType = 'tiger' | 'primary' | 'aggregator';

/**
 * Validity Window
 *
 * Defines the period during which a data source is considered authoritative.
 * Confidence decays as we approach validUntil to signal upcoming staleness.
 */
export interface ValidityWindow {
  readonly sourceId: string;
  readonly sourceType: SourceType;
  readonly validFrom: Date;
  readonly validUntil: Date;
  readonly confidence: number;  // 0.0-1.0, decays as validUntil approaches
}

/**
 * Validity Window Calculator
 *
 * Calculates validity windows for data sources based on:
 * - Source type (TIGER, primary, aggregator)
 * - Boundary type (congressional vs county vs city council)
 * - Redistricting cycles (2021-2022, 2031-2032, etc.)
 * - Release schedules (TIGER releases in July annually)
 */
export interface ValidityWindowCalculator {
  /**
   * Calculate validity window for a source
   */
  calculateWindow(
    sourceType: SourceType,
    releaseDate: Date,
    boundaryType: BoundaryType
  ): ValidityWindow;

  /**
   * Compute current confidence for a validity window
   * Confidence decays as we approach validUntil
   */
  computeConfidence(window: ValidityWindow, asOf?: Date): number;

  /**
   * Check if we're in a redistricting gap (Jan-Jun of redistricting year)
   * During this period, TIGER confidence is severely reduced
   */
  isInRedistrictingGap(asOf?: Date): boolean;

  /**
   * Get confidence reduction factor for redistricting period
   * Returns 1.0 outside redistricting, 0.3-0.8 during redistricting
   */
  getRedistrictingConfidenceFactor(
    boundaryType: BoundaryType,
    asOf?: Date
  ): number;
}

/**
 * Default Validity Window Calculator Implementation
 */
export class DefaultValidityWindowCalculator implements ValidityWindowCalculator {
  /**
   * Redistricting years following decennial census
   * Pattern: Years ending in 1 and 2 (2021, 2022, 2031, 2032, 2041, 2042, ...)
   */
  private readonly redistrictingYears = [2021, 2022, 2031, 2032, 2041, 2042, 2051, 2052];

  /**
   * TIGER release month (July = month 7)
   */
  private readonly TIGER_RELEASE_MONTH = 7;

  /**
   * Validity window duration constants (in years)
   */
  private readonly PRIMARY_VALIDITY_YEARS = 10;  // Primary sources valid until next redistricting
  private readonly TIGER_VALIDITY_YEARS = 1;     // TIGER valid for 12 months

  /**
   * Confidence decay thresholds
   */
  private readonly CONFIDENCE_DECAY_START = 0.75;  // Start decay at 75% through window
  private readonly MIN_CONFIDENCE = 0.4;           // Minimum confidence (at validUntil)

  /**
   * Redistricting-specific confidence factors
   */
  private readonly REDISTRICTING_BASE_CONFIDENCE = 0.3;  // TIGER confidence during gap
  private readonly POST_UPDATE_CONFIDENCE = 0.9;         // After July update

  calculateWindow(
    sourceType: SourceType,
    releaseDate: Date,
    boundaryType: BoundaryType
  ): ValidityWindow {
    const sourceId = this.generateSourceId(sourceType, boundaryType, releaseDate);

    switch (sourceType) {
      case 'tiger':
        return this.calculateTigerWindow(sourceId, releaseDate, boundaryType);

      case 'primary':
        return this.calculatePrimaryWindow(sourceId, releaseDate, boundaryType);

      case 'aggregator':
        // Aggregators inherit TIGER-like behavior but with custom logic
        return this.calculateAggregatorWindow(sourceId, releaseDate, boundaryType);

      default:
        // TypeScript exhaustiveness check
        const _exhaustive: never = sourceType;
        throw new Error(`Unknown source type: ${sourceType}`);
    }
  }

  computeConfidence(window: ValidityWindow, asOf: Date = new Date()): number {
    const now = asOf.getTime();
    const validFrom = window.validFrom.getTime();
    const validUntil = window.validUntil.getTime();

    // Not yet valid
    if (now < validFrom) {
      return 0.0;
    }

    // Expired
    if (now >= validUntil) {
      return 0.0;
    }

    // Calculate time remaining
    const totalWindow = validUntil - validFrom;
    const elapsed = now - validFrom;
    const remaining = validUntil - now;

    // For primary sources, confidence is always 1.0 (authoritative by definition)
    if (window.sourceType === 'primary') {
      return 1.0;
    }

    // For TIGER/aggregators, check if we're in redistricting period
    const year = asOf.getUTCFullYear();
    const isRedistrictingYear = this.redistrictingYears.includes(year);

    if (isRedistrictingYear) {
      // During redistricting, use reduced confidence based on year and period
      // getRedistrictingBaseConfidence handles all redistricting logic:
      // - Gap period (Jan-Jun of year 2): 0.3
      // - First year (year ending in 1): 0.5
      // - Post-July year 2: 0.9
      return this.getRedistrictingBaseConfidence(window.sourceType, asOf);
    }

    // Normal decay: Start at 1.0, decay to MIN_CONFIDENCE over last 25% of window
    const decayThreshold = totalWindow * this.CONFIDENCE_DECAY_START;

    if (elapsed <= decayThreshold) {
      // First 75%: Full confidence
      return 1.0;
    }

    // Last 25%: Linear decay from 1.0 to MIN_CONFIDENCE
    const decayWindow = totalWindow - decayThreshold;
    const decayElapsed = elapsed - decayThreshold;
    const decayProgress = decayElapsed / decayWindow;

    return 1.0 - (decayProgress * (1.0 - this.MIN_CONFIDENCE));
  }

  isInRedistrictingGap(asOf: Date = new Date()): boolean {
    // Use UTC methods for consistent behavior across timezones
    const year = asOf.getUTCFullYear();
    const month = asOf.getUTCMonth() + 1;

    // Gap period: Jan-Jun of years ending in 2 (2022, 2032, 2042)
    // This is when states have finalized but TIGER hasn't updated
    return (
      this.redistrictingYears.includes(year) &&
      year % 10 === 2 &&  // Second year of cycle
      month >= 1 &&
      month <= 6
    );
  }

  getRedistrictingConfidenceFactor(
    boundaryType: BoundaryType,
    asOf: Date = new Date()
  ): number {
    if (!this.isInRedistrictingGap(asOf)) {
      return 1.0;
    }

    // Boundary types most affected by redistricting
    const highImpact: BoundaryType[] = ['congressional', 'state_senate', 'state_house'];
    const mediumImpact: BoundaryType[] = ['voting_precinct', 'school_unified'];
    const lowImpact: BoundaryType[] = ['county', 'place', 'special_district'];

    if (highImpact.includes(boundaryType)) {
      return 0.3;  // Legislative boundaries change significantly
    }

    if (mediumImpact.includes(boundaryType)) {
      return 0.6;  // Administrative boundaries may adjust
    }

    if (lowImpact.includes(boundaryType)) {
      return 0.8;  // Rarely affected by redistricting
    }

    // city_council has no TIGER source (N/A)
    return 0.5;  // Default
  }

  /**
   * Calculate TIGER validity window
   * TIGER releases annually in July, valid for 12 months
   */
  private calculateTigerWindow(
    sourceId: string,
    releaseDate: Date,
    boundaryType: BoundaryType
  ): ValidityWindow {
    const releaseYear = releaseDate.getUTCFullYear();

    // TIGER validity: July 1 of release year → July 1 of next year (UTC)
    const validFrom = new Date(Date.UTC(releaseYear, this.TIGER_RELEASE_MONTH - 1, 1));
    const validUntil = new Date(
      Date.UTC(releaseYear + this.TIGER_VALIDITY_YEARS, this.TIGER_RELEASE_MONTH - 1, 1)
    );

    // Calculate current confidence (as of now, not release date)
    const confidence = this.computeConfidence({
      sourceId,
      sourceType: 'tiger',
      validFrom,
      validUntil,
      confidence: 1.0,  // Placeholder for recursive call
    });

    return {
      sourceId,
      sourceType: 'tiger',
      validFrom,
      validUntil,
      confidence,
    };
  }

  /**
   * Calculate primary source validity window
   * Primary sources are authoritative until next redistricting cycle (10 years)
   */
  private calculatePrimaryWindow(
    sourceId: string,
    releaseDate: Date,
    boundaryType: BoundaryType
  ): ValidityWindow {
    const releaseYear = releaseDate.getUTCFullYear();
    const validFrom = releaseDate;

    // Find next redistricting cycle start (January 1 UTC)
    const nextRedistrictingYear = this.getNextRedistrictingYear(releaseYear);
    const validUntil = new Date(Date.UTC(nextRedistrictingYear, 0, 1));

    return {
      sourceId,
      sourceType: 'primary',
      validFrom,
      validUntil,
      confidence: 1.0,  // Primary sources always have full confidence
    };
  }

  /**
   * Calculate aggregator validity window
   * Aggregators (like Redistricting Data Hub) inherit TIGER-like behavior
   */
  private calculateAggregatorWindow(
    sourceId: string,
    releaseDate: Date,
    boundaryType: BoundaryType
  ): ValidityWindow {
    // Aggregators typically follow TIGER schedule but may update faster
    // Use same logic as TIGER for now
    return this.calculateTigerWindow(sourceId, releaseDate, boundaryType);
  }

  /**
   * Get next redistricting year after a given year
   * Redistricting happens in years ending in 1 (e.g., 2021, 2031, 2041)
   */
  private getNextRedistrictingYear(fromYear: number): number {
    // Find the next year ending in 1
    const yearMod = fromYear % 10;

    if (yearMod < 1) {
      // Before redistricting in current decade (e.g., 2020 → 2021)
      return fromYear + (1 - yearMod);
    } else {
      // After redistricting in current decade (e.g., 2023 → 2031)
      return fromYear + (11 - yearMod);
    }
  }

  /**
   * Get base confidence for redistricting period
   * Considers whether TIGER has updated yet
   */
  private getRedistrictingBaseConfidence(
    sourceType: SourceType,
    asOf: Date
  ): number {
    if (sourceType === 'primary') {
      return 1.0;  // Primary sources always authoritative
    }

    const year = asOf.getUTCFullYear();
    const month = asOf.getUTCMonth() + 1;

    // Check if we're in the redistricting gap (Jan-Jun of second year)
    if (this.isInRedistrictingGap(asOf)) {
      // During gap: TIGER shows old districts, primary has new
      return this.REDISTRICTING_BASE_CONFIDENCE;
    }

    // First year of redistricting cycle (states still finalizing)
    // This must come before the "post-July" check
    if (this.redistrictingYears.includes(year) && year % 10 === 1) {
      return 0.5;  // Moderate confidence (states may not have finalized yet)
    }

    // After July update in second redistricting year
    if (this.redistrictingYears.includes(year) && month >= this.TIGER_RELEASE_MONTH) {
      return this.POST_UPDATE_CONFIDENCE;
    }

    return 1.0;  // Normal confidence outside redistricting
  }

  /**
   * Generate unique source identifier
   */
  private generateSourceId(
    sourceType: SourceType,
    boundaryType: BoundaryType,
    releaseDate: Date
  ): string {
    const year = releaseDate.getUTCFullYear();
    return `${sourceType}-${boundaryType}-${year}`;
  }
}

/**
 * Default calculator instance
 */
export const validityWindowCalculator = new DefaultValidityWindowCalculator();

/**
 * Helper function to calculate validity window
 * Convenience wrapper for default calculator
 */
export function calculateValidityWindow(
  sourceType: SourceType,
  releaseDate: Date,
  boundaryType: BoundaryType
): ValidityWindow {
  return validityWindowCalculator.calculateWindow(sourceType, releaseDate, boundaryType);
}

/**
 * Helper function to compute confidence
 * Convenience wrapper for default calculator
 */
export function computeConfidence(
  window: ValidityWindow,
  asOf?: Date
): number {
  return validityWindowCalculator.computeConfidence(window, asOf);
}

/**
 * Helper function to check redistricting gap
 * Convenience wrapper for default calculator
 */
export function isInRedistrictingGap(asOf?: Date): boolean {
  return validityWindowCalculator.isInRedistrictingGap(asOf);
}

/**
 * Helper function to get redistricting confidence factor
 * Convenience wrapper for default calculator
 */
export function getRedistrictingConfidenceFactor(
  boundaryType: BoundaryType,
  asOf?: Date
): number {
  return validityWindowCalculator.getRedistrictingConfidenceFactor(boundaryType, asOf);
}
