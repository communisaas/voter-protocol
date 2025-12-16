/**
 * TIGER Validity Window Logic
 *
 * Implements TIGER-specific validity window calculations with redistricting
 * awareness. TIGER releases annually in July, but during redistricting years
 * (2021-2022, 2031-2032, etc.), there's a "gap period" where state primary
 * sources have newer data.
 *
 * TIMELINE EXAMPLE (2020 redistricting cycle):
 *   Jul 2021: TIGER 2021 releases (pre-redistricting boundaries)
 *   Dec 2021: States finalize new redistricting maps
 *   Jan 2022: New districts take legal effect
 *   Jan-Jun 2022: GAP PERIOD - TIGER shows old districts, states have new
 *   Jul 2022: TIGER 2022 releases with new districts
 *
 * KEY DECISIONS:
 * 1. Normal validity: Jul 1, YYYY → Jul 1, YYYY+1 (12 months)
 * 2. Redistricting gap: Jan 1 → Jun 30 of years ending in 2
 * 3. Grace period: 18 months during redistricting for courts/challenges
 * 4. Expiration warnings: 30 days before validUntil
 *
 * Integration:
 * - Works with validity-window.ts for temporal calculations
 * - Works with gap-detector.ts for redistricting detection
 * - Works with tiger-authority-rules.ts for authority hierarchy
 */

import type { TIGERBoundaryType } from './tiger-authority-rules.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * TIGER validity window
 * Defines when TIGER data is considered current
 */
export interface TIGERValidityWindow {
  /** TIGER release year */
  readonly year: number;

  /** Start of validity period */
  readonly validFrom: Date;

  /** End of validity period */
  readonly validUntil: Date;

  /** Expected next TIGER release date */
  readonly nextRelease: Date;

  /** Whether we're in redistricting cycle */
  readonly isRedistrictingCycle: boolean;

  /** Whether we're in redistricting gap (state data newer) */
  readonly isInGap: boolean;
}

/**
 * Redistricting period information
 */
export interface RedistrictingPeriod {
  /** Census year that triggered redistricting */
  readonly censusYear: number;

  /** Years when redistricting occurs */
  readonly redistrictingYears: readonly [number, number];

  /** Start of gap period (Jan 1 of second year) */
  readonly gapStart: Date;

  /** End of gap period (Jul 1 of second year) */
  readonly gapEnd: Date;

  /** Grace period end (18 months after effective date) */
  readonly graceEnd: Date;
}

/**
 * Validity status for TIGER data
 */
export interface TIGERValidityStatus {
  /** Whether TIGER data is currently valid */
  readonly isValid: boolean;

  /** Confidence in TIGER data (0.0-1.0) */
  readonly confidence: number;

  /** Reason for validity status */
  readonly reason: string;

  /** Recommended action */
  readonly recommendation: 'use-tiger' | 'use-primary' | 'wait' | 'manual-review';

  /** Days until expiration (negative if expired) */
  readonly daysUntilExpiration: number;

  /** Whether expiration warning should be shown (30 days) */
  readonly showExpirationWarning: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * TIGER release month (July)
 */
const TIGER_RELEASE_MONTH = 7;

/**
 * Redistricting cycles (Census year → redistricting years)
 */
const REDISTRICTING_CYCLES: ReadonlyMap<number, RedistrictingPeriod> = new Map([
  [2020, {
    censusYear: 2020,
    redistrictingYears: [2021, 2022],
    gapStart: new Date('2022-01-01T00:00:00Z'),
    gapEnd: new Date('2022-07-01T00:00:00Z'),
    graceEnd: new Date('2023-07-01T00:00:00Z'),
  }],
  [2030, {
    censusYear: 2030,
    redistrictingYears: [2031, 2032],
    gapStart: new Date('2032-01-01T00:00:00Z'),
    gapEnd: new Date('2032-07-01T00:00:00Z'),
    graceEnd: new Date('2033-07-01T00:00:00Z'),
  }],
  [2040, {
    censusYear: 2040,
    redistrictingYears: [2041, 2042],
    gapStart: new Date('2042-01-01T00:00:00Z'),
    gapEnd: new Date('2042-07-01T00:00:00Z'),
    graceEnd: new Date('2043-07-01T00:00:00Z'),
  }],
]);

/**
 * Expiration warning threshold (days)
 */
const EXPIRATION_WARNING_DAYS = 30;

/**
 * Grace period duration (months)
 */
const GRACE_PERIOD_MONTHS = 18;

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Get TIGER validity window for a given year
 *
 * TIGER releases annually in July. Validity is July 1, YYYY → July 1, YYYY+1.
 *
 * @param year - TIGER release year
 * @returns Validity window with redistricting awareness
 *
 * @example
 * ```typescript
 * const window = getTIGERValidityWindow(2024);
 * // validFrom: 2024-07-01
 * // validUntil: 2025-07-01
 * // nextRelease: 2025-07-01
 * ```
 */
export function getTIGERValidityWindow(year: number): TIGERValidityWindow {
  const validFrom = new Date(Date.UTC(year, TIGER_RELEASE_MONTH - 1, 1));
  const validUntil = new Date(Date.UTC(year + 1, TIGER_RELEASE_MONTH - 1, 1));
  const nextRelease = validUntil;

  const redistrictingPeriod = getRedistrictingPeriod(validFrom);
  const isRedistrictingCycle = redistrictingPeriod !== null;
  const isInGap = isRedistrictingCycle
    ? isInRedistrictingGap(validFrom)
    : false;

  return {
    year,
    validFrom,
    validUntil,
    nextRelease,
    isRedistrictingCycle,
    isInGap,
  };
}

/**
 * Check if date is in redistricting period
 *
 * Redistricting happens in years ending in 1 and 2 following decennial census.
 *
 * @param date - Date to check
 * @returns True if in redistricting period
 *
 * @example
 * ```typescript
 * isRedistrictingPeriod(new Date('2022-03-15')); // true
 * isRedistrictingPeriod(new Date('2023-03-15')); // false
 * ```
 */
export function isRedistrictingPeriod(date: Date): boolean {
  const year = date.getUTCFullYear();
  const yearMod = year % 10;

  // Years ending in 1 or 2 are redistricting years
  return yearMod === 1 || yearMod === 2;
}

/**
 * Check if date is in redistricting gap period
 *
 * Gap period: Jan 1 → Jun 30 of years ending in 2.
 * During this time, states have finalized new maps but TIGER hasn't updated.
 *
 * @param date - Date to check
 * @returns True if in gap period
 *
 * @example
 * ```typescript
 * isInRedistrictingGap(new Date('2022-03-15')); // true (Jan-Jun 2022)
 * isInRedistrictingGap(new Date('2022-08-15')); // false (after July release)
 * isInRedistrictingGap(new Date('2021-03-15')); // false (year ending in 1)
 * ```
 */
export function isInRedistrictingGap(date: Date): boolean {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const yearMod = year % 10;

  // Gap only in years ending in 2, Jan-Jun
  return yearMod === 2 && month >= 1 && month < TIGER_RELEASE_MONTH;
}

/**
 * Get redistricting period for a date
 *
 * Returns the redistricting period if the date falls within:
 * - A redistricting year (years ending in 1 or 2 after census)
 * - The grace period (up to 18 months after gap end)
 *
 * @param date - Date to check
 * @returns Redistricting period info or null if not in redistricting/grace period
 */
export function getRedistrictingPeriod(date: Date): RedistrictingPeriod | null {
  const year = date.getUTCFullYear();
  const dateTime = date.getTime();

  for (const [censusYear, period] of Array.from(REDISTRICTING_CYCLES)) {
    // Check if in redistricting years
    if (period.redistrictingYears.includes(year)) {
      return period;
    }

    // Check if in grace period (extends beyond redistricting years)
    if (dateTime >= period.gapEnd.getTime() && dateTime < period.graceEnd.getTime()) {
      return period;
    }
  }

  return null;
}

/**
 * Check if grace period should apply
 *
 * During redistricting, courts may challenge maps, causing delays.
 * We allow an 18-month grace period for congressional and state legislative
 * districts to account for legal challenges and corrections.
 *
 * @param boundaryType - Type of boundary
 * @param date - Date to check
 * @returns True if grace period applies
 *
 * @example
 * ```typescript
 * // Congressional districts get grace period during 2022-2023
 * shouldApplyGracePeriod('congressional', new Date('2022-09-01')); // true
 * shouldApplyGracePeriod('congressional', new Date('2024-01-01')); // false
 *
 * // Counties don't get grace period (not redistricted)
 * shouldApplyGracePeriod('county', new Date('2022-09-01')); // false
 * ```
 */
export function shouldApplyGracePeriod(
  boundaryType: TIGERBoundaryType,
  date: Date
): boolean {
  // Only legislative boundaries get grace period
  const legislativeBoundaries: TIGERBoundaryType[] = [
    'congressional',
    'state_senate',
    'state_house',
  ];

  if (!legislativeBoundaries.includes(boundaryType)) {
    return false;
  }

  // Check if we're in grace period window
  const period = getRedistrictingPeriod(date);
  if (!period) {
    return false;
  }

  return date >= period.gapEnd && date < period.graceEnd;
}

/**
 * Get TIGER validity status for a boundary type
 *
 * Comprehensive validity check that considers:
 * - Temporal validity (within 12-month window)
 * - Redistricting gaps (state data may be newer)
 * - Grace periods (court challenges)
 * - Expiration warnings (30 days)
 *
 * @param boundaryType - Type of boundary
 * @param year - TIGER release year
 * @param asOf - Date to check validity (defaults to now)
 * @returns Comprehensive validity status
 *
 * @example
 * ```typescript
 * // Check TIGER 2024 congressional districts validity
 * const status = getTIGERValidityStatus('congressional', 2024, new Date('2024-09-15'));
 *
 * if (status.isValid && status.confidence > 0.9) {
 *   // Use TIGER data
 * } else if (status.recommendation === 'use-primary') {
 *   // Use state redistricting commission data instead
 * }
 * ```
 */
export function getTIGERValidityStatus(
  boundaryType: TIGERBoundaryType,
  year: number,
  asOf: Date = new Date()
): TIGERValidityStatus {
  const window = getTIGERValidityWindow(year);

  // Check temporal validity
  const now = asOf.getTime();
  const validFrom = window.validFrom.getTime();
  const validUntil = window.validUntil.getTime();

  // Calculate days until expiration
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysUntilExpiration = Math.floor((validUntil - now) / msPerDay);
  const showExpirationWarning = daysUntilExpiration > 0 && daysUntilExpiration <= EXPIRATION_WARNING_DAYS;

  // Before validity period
  if (now < validFrom) {
    return {
      isValid: false,
      confidence: 0.0,
      reason: `TIGER ${year} not yet released (expected ${formatDate(window.validFrom)})`,
      recommendation: 'use-primary',
      daysUntilExpiration,
      showExpirationWarning: false,
    };
  }

  // After validity period
  if (now >= validUntil) {
    return {
      isValid: false,
      confidence: 0.0,
      reason: `TIGER ${year} expired on ${formatDate(window.validUntil)}. Use TIGER ${year + 1}.`,
      recommendation: 'use-tiger',
      daysUntilExpiration,
      showExpirationWarning: false,
    };
  }

  // In redistricting gap - check asOf date directly (not window.isInGap which uses validFrom)
  // During Jan-Jun of years ending in 2, states have new maps but TIGER hasn't updated
  const inRedistrictingGap = isInRedistrictingGap(asOf);
  if (inRedistrictingGap) {
    const legislativeBoundaries: TIGERBoundaryType[] = [
      'congressional',
      'state_senate',
      'state_house',
    ];

    if (legislativeBoundaries.includes(boundaryType)) {
      const period = getRedistrictingPeriod(asOf);
      return {
        isValid: false,
        confidence: 0.3,  // Low confidence during gap
        reason: `Redistricting gap: States finalized new maps but TIGER won't update until ${formatDate(period?.gapEnd ?? window.nextRelease)}. State primary sources have newer data.`,
        recommendation: 'use-primary',
        daysUntilExpiration,
        showExpirationWarning,
      };
    }
  }

  // In grace period
  if (shouldApplyGracePeriod(boundaryType, asOf)) {
    const period = getRedistrictingPeriod(asOf);
    return {
      isValid: true,
      confidence: 0.7,  // Moderate confidence during grace period
      reason: `Grace period for court challenges. New TIGER data available but some states may have corrections. Grace period ends ${formatDate(period?.graceEnd ?? window.validUntil)}.`,
      recommendation: 'use-tiger',
      daysUntilExpiration,
      showExpirationWarning,
    };
  }

  // Normal validity - fully valid
  return {
    isValid: true,
    confidence: 1.0,
    reason: `TIGER ${year} is current. Valid until ${formatDate(window.validUntil)}.`,
    recommendation: 'use-tiger',
    daysUntilExpiration,
    showExpirationWarning,
  };
}

/**
 * Get automatic expiration warning
 *
 * Returns warning message if TIGER data will expire within 30 days.
 *
 * @param year - TIGER release year
 * @param asOf - Date to check (defaults to now)
 * @returns Warning message or null if no warning needed
 *
 * @example
 * ```typescript
 * const warning = getExpirationWarning(2024, new Date('2025-06-15'));
 * if (warning) {
 *   console.warn(warning);
 *   // "TIGER 2024 will expire in 16 days (2025-07-01). Update to TIGER 2025."
 * }
 * ```
 */
export function getExpirationWarning(
  year: number,
  asOf: Date = new Date()
): string | null {
  const window = getTIGERValidityWindow(year);
  const now = asOf.getTime();
  const validUntil = window.validUntil.getTime();

  const msPerDay = 1000 * 60 * 60 * 24;
  const daysUntilExpiration = Math.floor((validUntil - now) / msPerDay);

  if (daysUntilExpiration > 0 && daysUntilExpiration <= EXPIRATION_WARNING_DAYS) {
    return `TIGER ${year} will expire in ${daysUntilExpiration} days (${formatDate(window.validUntil)}). Update to TIGER ${year + 1}.`;
  }

  return null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Calculate confidence decay
 *
 * Confidence remains 1.0 for first 75% of validity window,
 * then decays linearly to 0.4 by expiration.
 *
 * @param validFrom - Start of validity
 * @param validUntil - End of validity
 * @param asOf - Current date
 * @returns Confidence value (0.0-1.0)
 */
export function calculateConfidenceDecay(
  validFrom: Date,
  validUntil: Date,
  asOf: Date
): number {
  const now = asOf.getTime();
  const start = validFrom.getTime();
  const end = validUntil.getTime();

  // Not yet valid
  if (now < start) {
    return 0.0;
  }

  // Expired
  if (now >= end) {
    return 0.0;
  }

  const totalWindow = end - start;
  const elapsed = now - start;

  // First 75%: Full confidence
  const decayThreshold = totalWindow * 0.75;
  if (elapsed <= decayThreshold) {
    return 1.0;
  }

  // Last 25%: Linear decay from 1.0 to 0.4
  const decayWindow = totalWindow - decayThreshold;
  const decayElapsed = elapsed - decayThreshold;
  const decayProgress = decayElapsed / decayWindow;

  const minConfidence = 0.4;
  return 1.0 - (decayProgress * (1.0 - minConfidence));
}
