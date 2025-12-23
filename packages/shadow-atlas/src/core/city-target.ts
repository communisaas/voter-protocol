/**
 * City Target Types - Canonical Definitions
 *
 * This file defines the canonical city target interfaces used throughout
 * shadow-atlas. Import these instead of defining local versions.
 *
 * DESIGN DECISIONS:
 * - BaseCityTarget: Minimal required fields (name, state)
 * - CityTarget: Standard fields for most operations (name, state, fips)
 * - CityTargetWithPopulation: Adds population for prioritization
 * - Use type extensions for specialized use cases (e.g., expansion planning)
 */

/**
 * Minimal city identifier - used when only basic info is needed
 */
export interface BaseCityTarget {
    /** City name (e.g., "Seattle") */
    readonly name: string;

    /** 2-letter state code (e.g., "WA") */
    readonly state: string;
}

/**
 * Standard city target - includes FIPS for Census lookup
 *
 * This is the canonical type for most shadow-atlas operations.
 */
export interface CityTarget extends BaseCityTarget {
    /** 7-digit Census PLACE FIPS code (SSPPPPPP: state + place) */
    readonly fips: string;

    /** Optional region alias (same as state, for compatibility) */
    readonly region?: string;
}

/**
 * City target with population - used for prioritization
 */
export interface CityTargetWithPopulation extends CityTarget {
    /** Population count (for prioritization) */
    readonly population: number;

    /** National population rank (optional) */
    readonly rank?: number;
}

/**
 * City info - alias for CityTarget (backward compatibility)
 *
 * @deprecated Use CityTarget instead
 */
export type CityInfo = CityTarget;

// ============================================================================
// Validation Result Types
// ============================================================================

/**
 * Standard validation result - used by all validators
 *
 * This is the canonical validation result interface. All validators should
 * return this type or an extension of it.
 */
export interface ValidationResult {
    /** Whether the data passes validation */
    readonly valid: boolean;

    /** Confidence score (0-100) */
    readonly confidence: number;

    /** Critical issues that cause rejection */
    readonly issues: readonly string[];

    /** Non-critical warnings (informational, don't cause rejection) */
    readonly warnings: readonly string[];
}

/**
 * Extended validation result with metadata
 */
export interface ValidationResultWithMetadata extends ValidationResult {
    /** Validator that produced this result */
    readonly validator?: string;

    /** Timestamp of validation */
    readonly timestamp?: string;

    /** Duration of validation in milliseconds */
    readonly durationMs?: number;
}

/**
 * Batch validation result with statistics
 */
export interface BatchValidationResult {
    /** Individual results */
    readonly results: readonly ValidationResult[];

    /** Summary statistics */
    readonly stats: {
        readonly total: number;
        readonly passed: number;
        readonly failed: number;
        readonly averageConfidence: number;
    };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a failing validation result
 */
export function validationFailed(
    issues: readonly string[],
    confidence: number = 0,
    warnings: readonly string[] = []
): ValidationResult {
    return { valid: false, confidence, issues, warnings };
}

/**
 * Create a passing validation result
 */
export function validationPassed(
    confidence: number = 100,
    warnings: readonly string[] = []
): ValidationResult {
    return { valid: true, confidence, issues: [], warnings };
}

/**
 * Merge multiple validation results
 * Result is valid only if all inputs are valid
 * Confidence is the minimum
 */
export function mergeValidationResults(
    results: readonly ValidationResult[]
): ValidationResult {
    const valid = results.every(r => r.valid);
    const confidence = Math.min(...results.map(r => r.confidence));
    const issues = results.flatMap(r => r.issues);
    const warnings = results.flatMap(r => r.warnings);

    return { valid, confidence, issues, warnings };
}
