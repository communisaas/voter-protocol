/**
 * Field Mapping Schema
 *
 * Configurable field mapping for ingestion pipelines with non-standard schemas.
 *
 * MOTIVATION:
 * Different data sources (VEST, state-specific shapefiles) use non-standard
 * field names that don't match Census TIGER conventions. This schema provides
 * a declarative way to map arbitrary source fields to canonical target fields.
 *
 * EXAMPLES:
 * - Utah VEST data: CountyID (1-29) → countyFips (001-057) via lookup table
 * - Utah VEST data: vistapre → localPrecinct (simple rename)
 * - GEOID construction: Concatenate state_fips + county_fips + precinct_id
 *
 * TRANSFORMATION TYPES:
 * - rename: Simple field name mapping (source → target)
 * - constant: Set field to constant value
 * - lookup: Map value via lookup table (e.g., CountyID → FIPS code)
 * - formula: Compute from expression (e.g., pad(CountyID * 2 - 1, 3))
 * - concat: Concatenate multiple fields with separator
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

/**
 * Transform type enumeration
 */
export enum TransformType {
  CONSTANT = 'constant',
  LOOKUP = 'lookup',
  FORMULA = 'formula',
  CONCAT = 'concat',
}

/**
 * Constant value transform
 *
 * Set a field to a constant value.
 * Example: { type: 'constant', value: '49' } → always outputs '49'
 */
export interface ConstantTransform {
  readonly type: TransformType.CONSTANT;
  readonly value: string | number | boolean;
}

/**
 * Lookup table transform
 *
 * Map source field value through a lookup table.
 * Example: CountyID 1 → '001', CountyID 2 → '003', etc.
 */
export interface LookupTransform {
  readonly type: TransformType.LOOKUP;
  readonly sourceField: string;
  readonly lookupTable: Record<string, string>;
  readonly defaultValue?: string; // Fallback if key not found
}

/**
 * Formula transform
 *
 * Compute value from expression using source fields.
 * Expression syntax: Simple JavaScript expressions with field references
 * Example: "(CountyID * 2 - 1).toString().padStart(3, '0')"
 */
export interface FormulaTransform {
  readonly type: TransformType.FORMULA;
  readonly expression: string;
  readonly sourceFields: readonly string[]; // Fields referenced in expression
}

/**
 * Concatenation transform
 *
 * Concatenate multiple source fields with optional separator.
 * Example: concat(['49', countyFips, vistapre], '') → '49001BV01'
 */
export interface ConcatTransform {
  readonly type: TransformType.CONCAT;
  readonly sourceFields: readonly string[];
  readonly separator?: string; // Default: '' (no separator)
}

/**
 * Transform union type
 */
export type FieldTransform =
  | ConstantTransform
  | LookupTransform
  | FormulaTransform
  | ConcatTransform;

/**
 * Validation configuration
 *
 * Validate mapped output before proceeding with ingestion.
 */
export interface ValidationConfig {
  /** Required fields that must be present after mapping */
  readonly requiredFields?: readonly string[];

  /** Skip features with invalid mappings instead of failing */
  readonly skipInvalid?: boolean;

  /** Custom validation function (optional) */
  readonly customValidator?: string; // JavaScript function as string
}

/**
 * Complete field mapping configuration
 *
 * Declarative schema for transforming non-standard data sources.
 */
export interface FieldMapping {
  /** Mapping version for compatibility tracking */
  readonly version: string;

  /** Human-readable mapping description */
  readonly description?: string;

  /** Source data description (for documentation) */
  readonly source?: {
    readonly name: string;
    readonly url?: string;
    readonly notes?: string;
  };

  /**
   * Simple field renames
   * Maps source field name → target field name
   * Example: { vistapre: 'localPrecinct' }
   */
  readonly fields?: Record<string, string>;

  /**
   * Complex transformations
   * Maps target field name → transformation logic
   * Example: { countyFips: { type: 'lookup', sourceField: 'CountyID', ... } }
   */
  readonly transforms?: Record<string, FieldTransform>;

  /**
   * Output validation rules
   */
  readonly validation?: ValidationConfig;
}

/**
 * Type guards for runtime validation
 */

export function isFieldMapping(value: unknown): value is FieldMapping {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  // Version is required
  if (typeof obj.version !== 'string') {
    return false;
  }

  // Optional description
  if (obj.description !== undefined && typeof obj.description !== 'string') {
    return false;
  }

  // Optional fields must be Record<string, string>
  if (obj.fields !== undefined) {
    if (typeof obj.fields !== 'object' || obj.fields === null) {
      return false;
    }
    const fields = obj.fields as Record<string, unknown>;
    for (const [key, value] of Object.entries(fields)) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        return false;
      }
    }
  }

  // Optional transforms must be Record<string, FieldTransform>
  if (obj.transforms !== undefined) {
    if (typeof obj.transforms !== 'object' || obj.transforms === null) {
      return false;
    }
    const transforms = obj.transforms as Record<string, unknown>;
    for (const [key, value] of Object.entries(transforms)) {
      if (typeof key !== 'string' || !isFieldTransform(value)) {
        return false;
      }
    }
  }

  return true;
}

export function isFieldTransform(value: unknown): value is FieldTransform {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  if (typeof obj.type !== 'string') {
    return false;
  }

  switch (obj.type) {
    case TransformType.CONSTANT:
      return (
        typeof obj.value === 'string' ||
        typeof obj.value === 'number' ||
        typeof obj.value === 'boolean'
      );

    case TransformType.LOOKUP:
      return (
        typeof obj.sourceField === 'string' &&
        typeof obj.lookupTable === 'object' &&
        obj.lookupTable !== null
      );

    case TransformType.FORMULA:
      return (
        typeof obj.expression === 'string' &&
        Array.isArray(obj.sourceFields) &&
        obj.sourceFields.every((f) => typeof f === 'string')
      );

    case TransformType.CONCAT:
      return (
        Array.isArray(obj.sourceFields) &&
        obj.sourceFields.every((f) => typeof f === 'string')
      );

    default:
      return false;
  }
}

/**
 * Validation error for field mapping
 */
export interface FieldMappingError {
  readonly field: string;
  readonly message: string;
  readonly sourceValue?: unknown;
}

/**
 * Field mapping result
 */
export interface FieldMappingResult {
  readonly success: boolean;
  readonly mapped?: Record<string, unknown>;
  readonly errors?: readonly FieldMappingError[];
  readonly skipped?: boolean;
}
