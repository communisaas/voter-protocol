/**
 * Shadow Atlas Error Types
 *
 * Custom error classes for validation and processing failures.
 * These errors are used to halt processing when critical validation fails.
 *
 * CRITICAL: ValidationHaltError prevents invalid data from entering the Merkle tree.
 * Invalid data in the tree would break ZK proof generation.
 */

/**
 * Validation stages where halt can occur
 */
export type ValidationHaltStage = 'topology' | 'completeness' | 'coordinates' | 'geoid';

/**
 * Details about the validation failure
 */
export interface ValidationHaltDetails {
  /** The validation stage that failed */
  readonly stage: ValidationHaltStage;
  /** Stage-specific error details */
  readonly details: unknown;
  /** Layer type being validated (e.g., 'cd', 'county', 'state') */
  readonly layerType?: string;
  /** State FIPS code if applicable */
  readonly stateFips?: string;
}

/**
 * Error thrown when validation fails and halt is configured.
 *
 * This error MUST be caught in buildAtlas() to prevent invalid data
 * from entering the Merkle tree. Invalid data would break ZK proof generation.
 *
 * Halt gates are configured via ShadowAtlasConfig.validation:
 * - haltOnTopologyError: Self-intersections, invalid polygons
 * - haltOnCompletenessError: Missing districts below threshold
 * - haltOnCoordinateError: Invalid lat/lng values
 *
 * @example
 * ```typescript
 * if (topologyErrors.length > 0 && config.validation.haltOnTopologyError) {
 *   throw new ValidationHaltError(
 *     `Topology validation failed: ${topologyErrors.length} self-intersecting polygons`,
 *     {
 *       stage: 'topology',
 *       details: topologyErrors,
 *       layerType: 'cd',
 *       stateFips: '06',
 *     }
 *   );
 * }
 * ```
 */
export class ValidationHaltError extends Error {
  public readonly name = 'ValidationHaltError' as const;

  constructor(
    message: string,
    public readonly validationResult: ValidationHaltDetails
  ) {
    super(message);
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, ValidationHaltError.prototype);
  }

  /**
   * Get the validation stage that caused the halt
   */
  get stage(): ValidationHaltStage {
    return this.validationResult.stage;
  }

  /**
   * Get the layer type being validated
   */
  get layerType(): string | undefined {
    return this.validationResult.layerType;
  }

  /**
   * Get the state FIPS code if applicable
   */
  get stateFips(): string | undefined {
    return this.validationResult.stateFips;
  }

  /**
   * Create a formatted error message for logging
   */
  toLogString(): string {
    const parts = [
      `ValidationHaltError: ${this.message}`,
      `  Stage: ${this.stage}`,
    ];
    if (this.layerType) {
      parts.push(`  Layer: ${this.layerType}`);
    }
    if (this.stateFips) {
      parts.push(`  State FIPS: ${this.stateFips}`);
    }
    return parts.join('\n');
  }
}

/**
 * Type guard to check if an error is a ValidationHaltError
 */
export function isValidationHaltError(error: unknown): error is ValidationHaltError {
  return (
    error instanceof Error &&
    error.name === 'ValidationHaltError' &&
    'validationResult' in error &&
    typeof (error as ValidationHaltError).validationResult === 'object' &&
    (error as ValidationHaltError).validationResult !== null &&
    'stage' in (error as ValidationHaltError).validationResult
  );
}
