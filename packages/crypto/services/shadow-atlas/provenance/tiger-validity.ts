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
 * STATE-EXTRACTED BOUNDARIES:
 * This module also validates boundaries extracted from state GIS portals.
 * State-extracted data must include:
 * - source.authority: Valid authority level (state-redistricting-commission | state-gis)
 * - source.vintage: GEOID-compatible vintage (>= 2022 for post-redistricting)
 * - source.retrievedAt: ISO timestamp of extraction
 * - Proper GEOID format validation
 *
 * Integration:
 * - Works with validity-window.ts for temporal calculations
 * - Works with gap-detector.ts for redistricting detection
 * - Works with tiger-authority-rules.ts for authority hierarchy
 * - Validates state-batch-extractor.ts output
 */

import type { TIGERBoundaryType, AuthorityLevel } from './tiger-authority-rules.js';

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

/**
 * State authority level types
 */
export type StateAuthorityLevel = 'state-redistricting-commission' | 'state-gis';

/**
 * Source metadata for state-extracted boundaries
 */
export interface StateExtractedSource {
  readonly state: string;
  readonly portalName: string;
  readonly endpoint: string;
  readonly authority: StateAuthorityLevel;
  readonly vintage: number;
  readonly retrievedAt: string;
}

/**
 * Validation result for state-extracted boundaries
 */
export interface StateExtractionValidation {
  /** Whether the extraction metadata is valid */
  readonly isValid: boolean;

  /** Confidence in the extraction (0.0-1.0) */
  readonly confidence: number;

  /** Validation errors (empty if valid) */
  readonly errors: readonly string[];

  /** Validation warnings (non-fatal issues) */
  readonly warnings: readonly string[];

  /** Recommended action */
  readonly recommendation: 'accept' | 'review' | 'reject';
}

/**
 * GEOID validation result
 */
export interface GEOIDValidation {
  readonly isValid: boolean;
  readonly format: string;
  readonly expectedPattern: string;
  readonly error?: string;
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

/**
 * Minimum vintage for post-redistricting data
 * After 2020 census redistricting, data must be from 2022 or later
 */
const MIN_POST_REDISTRICTING_VINTAGE = 2022;

/**
 * Maximum age for state-extracted data (days)
 * Data older than 180 days should trigger warning
 */
const MAX_EXTRACTION_AGE_DAYS = 180;

/**
 * Valid state authority levels
 */
const VALID_STATE_AUTHORITIES: ReadonlySet<StateAuthorityLevel> = new Set([
  'state-redistricting-commission',
  'state-gis',
]);

/**
 * GEOID patterns by boundary type
 * Congressional: SSCCC (state + 3-digit district)
 * State Senate: SSSLLL (state + 3-digit chamber + district)
 * State House: SSSLLL (state + 3-digit chamber + district)
 * County: SSCCC (state + 3-digit county)
 */
const GEOID_PATTERNS: Record<string, RegExp> = {
  congressional: /^\d{2}[0-9A-Z]{2}$/,  // e.g., 5501, 55AL
  state_senate: /^\d{6}$/,                // e.g., 550101
  state_house: /^\d{6}$/,                 // e.g., 550201
  county: /^\d{5}$/,                      // e.g., 55025
};

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

// ============================================================================
// State Extraction Validation Functions
// ============================================================================

/**
 * Validate GEOID format for a boundary type
 *
 * Ensures the GEOID matches expected patterns:
 * - Congressional: SSCCC (2-digit state + 2-digit/letter district)
 * - State Senate: SSSLLL (2-digit state + 3-digit chamber + 3-digit district)
 * - State House: SSSLLL (2-digit state + 3-digit chamber + 3-digit district)
 * - County: SSCCC (2-digit state + 3-digit county)
 *
 * @param geoid - GEOID to validate
 * @param boundaryType - Type of boundary
 * @returns Validation result
 *
 * @example
 * ```typescript
 * validateGEOID('5501', 'congressional'); // Valid
 * validateGEOID('55AL', 'congressional'); // Valid (at-large)
 * validateGEOID('550101', 'state_senate'); // Valid
 * validateGEOID('55025', 'county'); // Valid
 * validateGEOID('XXX', 'congressional'); // Invalid
 * ```
 */
export function validateGEOID(
  geoid: string,
  boundaryType: TIGERBoundaryType
): GEOIDValidation {
  const pattern = GEOID_PATTERNS[boundaryType];

  if (!pattern) {
    return {
      isValid: false,
      format: geoid,
      expectedPattern: 'Unknown pattern for boundary type',
      error: `No GEOID pattern defined for boundary type: ${boundaryType}`,
    };
  }

  const isValid = pattern.test(geoid);
  const expectedPattern = pattern.source;

  if (!isValid) {
    return {
      isValid: false,
      format: geoid,
      expectedPattern,
      error: `GEOID "${geoid}" does not match expected pattern ${expectedPattern} for ${boundaryType}`,
    };
  }

  return {
    isValid: true,
    format: geoid,
    expectedPattern,
  };
}

/**
 * Validate state-extracted boundary source metadata
 *
 * Performs comprehensive validation on state-extracted boundaries:
 * 1. Required fields present and non-empty
 * 2. Authority level is valid
 * 3. Vintage is appropriate for redistricting cycle
 * 4. RetrievedAt timestamp is valid and not stale
 * 5. State code is valid 2-letter uppercase
 *
 * @param source - Source metadata from state extraction
 * @param boundaryType - Type of boundary
 * @param geoid - GEOID of the boundary (optional, for enhanced validation)
 * @param asOf - Date to check freshness (defaults to now)
 * @returns Comprehensive validation result
 *
 * @example
 * ```typescript
 * const source = {
 *   state: 'WI',
 *   portalName: 'Wisconsin LTSB',
 *   endpoint: 'https://...',
 *   authority: 'state-redistricting-commission',
 *   vintage: 2022,
 *   retrievedAt: '2024-01-15T10:00:00Z',
 * };
 *
 * const result = validateStateExtractedSource(source, 'congressional', '5501');
 * if (result.isValid) {
 *   // Use the boundary
 * }
 * ```
 */
export function validateStateExtractedSource(
  source: StateExtractedSource,
  boundaryType: TIGERBoundaryType,
  geoid?: string,
  asOf: Date = new Date()
): StateExtractionValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Required fields validation
  if (!source.state || source.state.trim().length === 0) {
    errors.push('Missing required field: state');
  } else if (!/^[A-Z]{2}$/.test(source.state)) {
    errors.push(`Invalid state code: ${source.state} (must be 2-letter uppercase)`);
  }

  if (!source.portalName || source.portalName.trim().length === 0) {
    errors.push('Missing required field: portalName');
  }

  if (!source.endpoint || source.endpoint.trim().length === 0) {
    errors.push('Missing required field: endpoint');
  } else {
    try {
      new URL(source.endpoint);
    } catch {
      errors.push(`Invalid endpoint URL: ${source.endpoint}`);
    }
  }

  // 2. Authority level validation
  if (!source.authority) {
    errors.push('Missing required field: authority');
  } else if (!VALID_STATE_AUTHORITIES.has(source.authority)) {
    errors.push(
      `Invalid authority level: ${source.authority} (must be one of: ${Array.from(VALID_STATE_AUTHORITIES).join(', ')})`
    );
  }

  // 3. Vintage validation
  if (!source.vintage) {
    errors.push('Missing required field: vintage');
  } else if (!Number.isInteger(source.vintage)) {
    errors.push(`Invalid vintage: ${source.vintage} (must be an integer year)`);
  } else if (source.vintage < 2000 || source.vintage > 2100) {
    errors.push(`Vintage out of reasonable range: ${source.vintage} (expected 2000-2100)`);
  } else {
    // Check redistricting cycle appropriateness
    const legislativeBoundaries: TIGERBoundaryType[] = [
      'congressional',
      'state_senate',
      'state_house',
    ];

    if (legislativeBoundaries.includes(boundaryType)) {
      if (source.vintage < MIN_POST_REDISTRICTING_VINTAGE) {
        warnings.push(
          `Vintage ${source.vintage} is pre-redistricting. Post-2020 census boundaries should be vintage ${MIN_POST_REDISTRICTING_VINTAGE}+`
        );
      }

      // Check if we're in a redistricting gap and data might be outdated
      if (isInRedistrictingGap(asOf)) {
        const currentYear = asOf.getUTCFullYear();
        if (source.vintage < currentYear - 1) {
          warnings.push(
            `Vintage ${source.vintage} may be outdated during redistricting gap (current: ${currentYear})`
          );
        }
      }
    }
  }

  // 4. RetrievedAt timestamp validation
  if (!source.retrievedAt || source.retrievedAt.trim().length === 0) {
    errors.push('Missing required field: retrievedAt');
  } else {
    try {
      const retrievedDate = new Date(source.retrievedAt);
      if (isNaN(retrievedDate.getTime())) {
        errors.push(`Invalid retrievedAt timestamp: ${source.retrievedAt}`);
      } else {
        // Check if data is stale
        const ageMs = asOf.getTime() - retrievedDate.getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);

        if (ageDays < 0) {
          errors.push(
            `retrievedAt is in the future: ${source.retrievedAt} (current: ${formatDate(asOf)})`
          );
        } else if (ageDays > MAX_EXTRACTION_AGE_DAYS) {
          warnings.push(
            `Data extraction is ${Math.floor(ageDays)} days old (retrieved: ${formatDate(retrievedDate)}). Consider re-extracting if boundary changes are expected.`
          );
        }
      }
    } catch {
      errors.push(`Invalid retrievedAt timestamp format: ${source.retrievedAt}`);
    }
  }

  // 5. GEOID validation (if provided)
  if (geoid) {
    const geoidValidation = validateGEOID(geoid, boundaryType);
    if (!geoidValidation.isValid) {
      errors.push(geoidValidation.error ?? 'Invalid GEOID format');
    }
  }

  // Calculate confidence and recommendation
  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;

  let confidence = 1.0;
  let recommendation: 'accept' | 'review' | 'reject' = 'accept';

  if (hasErrors) {
    confidence = 0.0;
    recommendation = 'reject';
  } else if (hasWarnings) {
    // Reduce confidence based on warning severity
    confidence = 0.7;
    recommendation = 'review';
  }

  return {
    isValid: !hasErrors,
    confidence,
    errors,
    warnings,
    recommendation,
  };
}

/**
 * Check if state-extracted boundary is fresher than TIGER
 *
 * During redistricting gaps, state sources may have newer data than TIGER.
 * This function determines whether to prefer state data over TIGER based on:
 * 1. Redistricting gap period detection
 * 2. Source authority level comparison
 * 3. Vintage comparison
 *
 * @param source - State-extracted source metadata
 * @param boundaryType - Type of boundary
 * @param tigerYear - TIGER release year to compare against
 * @param asOf - Date to check (defaults to now)
 * @returns True if state source should be preferred over TIGER
 *
 * @example
 * ```typescript
 * // During redistricting gap (Jan-Jun 2022)
 * const source = {
 *   state: 'WI',
 *   authority: 'state-redistricting-commission',
 *   vintage: 2022,
 *   retrievedAt: '2022-03-15T10:00:00Z',
 *   // ... other fields
 * };
 *
 * isStateFresherThanTIGER(source, 'congressional', 2021, new Date('2022-03-15'));
 * // Returns true - state has 2022 redistricted data, TIGER 2021 is outdated
 * ```
 */
export function isStateFresherThanTIGER(
  source: StateExtractedSource,
  boundaryType: TIGERBoundaryType,
  tigerYear: number,
  asOf: Date = new Date()
): boolean {
  // Only applies to legislative boundaries
  const legislativeBoundaries: TIGERBoundaryType[] = [
    'congressional',
    'state_senate',
    'state_house',
  ];

  if (!legislativeBoundaries.includes(boundaryType)) {
    return false; // For non-legislative boundaries, TIGER is authoritative
  }

  // Check if we're in redistricting gap
  const inGap = isInRedistrictingGap(asOf);

  if (inGap) {
    // During gap, prefer state redistricting commissions
    if (source.authority === 'state-redistricting-commission') {
      return true;
    }

    // State GIS preferred if vintage is newer than TIGER year
    if (source.authority === 'state-gis' && source.vintage > tigerYear) {
      return true;
    }
  }

  // Outside gap, check if state source vintage is significantly newer
  // (indicating TIGER hasn't incorporated latest changes)
  if (source.vintage > tigerYear + 1) {
    return true;
  }

  return false;
}

/**
 * Get authority precedence score for comparison
 *
 * Maps authority levels to numeric scores for precedence comparison.
 * Higher score = higher authority.
 *
 * @param authority - Authority level
 * @returns Numeric precedence score (0-5)
 */
export function getAuthorityPrecedence(
  authority: StateAuthorityLevel | 'census-tiger'
): number {
  const precedenceMap: Record<string, number> = {
    'state-redistricting-commission': 5, // Federal mandate (draws official maps)
    'census-tiger': 5,                   // Federal mandate
    'state-gis': 4,                      // State mandate
  };

  return precedenceMap[authority] ?? 0;
}
