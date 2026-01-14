/**
 * Shadow Atlas Error Types
 *
 * Custom error classes for Shadow Atlas validation and build failures.
 * These errors provide structured information about validation failures
 * to enable better debugging and error handling.
 */

import type { CrossValidationResult } from './types/validators.js';

/**
 * Error thrown when cross-validation fails and failOnMismatch is enabled
 *
 * This error indicates that TIGER data doesn't match state GIS portal data
 * sufficiently to meet the configured quality threshold. Contains all
 * validation results for debugging.
 *
 * RECOVERY:
 * - Review validation results to understand mismatches
 * - Check if state GIS portal has updated data (redistricting)
 * - Verify TIGER vintage matches state data vintage
 * - Set failOnMismatch: false to continue with warnings instead
 */
export class BuildValidationError extends Error {
  /**
   * Create a new build validation error
   *
   * @param message - Human-readable error message
   * @param validationResults - Complete validation results for all failed states
   * @param failedStates - FIPS codes of states that failed validation
   */
  constructor(
    message: string,
    public readonly validationResults: readonly CrossValidationResult[],
    public readonly failedStates: readonly string[]
  ) {
    super(message);
    this.name = 'BuildValidationError';

    // Maintain proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BuildValidationError);
    }
  }

  /**
   * Get formatted summary of validation failures
   */
  getSummary(): string {
    const lines: string[] = [
      `Build validation failed for ${this.failedStates.length} states:`,
      '',
    ];

    for (const result of this.validationResults) {
      lines.push(`  ${result.state} (${result.layer}): ${result.qualityScore}/100`);
      lines.push(`    TIGER: ${result.tigerCount}, State: ${result.stateCount}, Matched: ${result.matchedCount}`);

      if (result.issues.length > 0) {
        lines.push(`    Issues:`);
        for (const issue of result.issues.slice(0, 3)) {
          lines.push(`      - [${issue.severity}] ${issue.message}`);
        }

        if (result.issues.length > 3) {
          lines.push(`      ... and ${result.issues.length - 3} more issues`);
        }
      }

      lines.push('');
    }

    lines.push('To continue despite mismatches, set failOnMismatch: false in crossValidation config.');

    return lines.join('\n');
  }
}
