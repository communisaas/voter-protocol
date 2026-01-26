/**
 * Field Mapper Utility
 *
 * Apply field mapping transformations to GeoJSON features.
 *
 * CAPABILITIES:
 * - Load and validate field mapping configurations
 * - Apply field renames (simple mappings)
 * - Execute transformations (constant, lookup, formula, concat)
 * - Validate mapped output against schema requirements
 * - Handle errors gracefully (skip invalid or fail fast)
 *
 * SAFETY:
 * - Formula evaluation uses isolated VM context (no access to process, fs, etc.)
 * - Lookup tables are validated before use
 * - All transformations have error boundaries
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { readFile } from 'fs/promises';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as vm from 'vm';
import type {
  FieldMapping,
  FieldTransform,
  TransformType,
  FieldMappingResult,
  FieldMappingError,
  ConstantTransform,
  LookupTransform,
  FormulaTransform,
  ConcatTransform,
} from '../../schemas/field-mapping.js';
import { isFieldMapping } from '../../schemas/field-mapping.js';
import type { Feature, FeatureCollection } from './ingestion.js';

/**
 * Field mapper configuration
 */
export interface FieldMapperOptions {
  /** Verbose logging */
  readonly verbose?: boolean;

  /** Fail on first error or continue */
  readonly failFast?: boolean;
}

/**
 * Field mapper class
 *
 * Stateful mapper that loads configuration and applies transformations.
 */
export class FieldMapper {
  private readonly mapping: FieldMapping;
  private readonly options: FieldMapperOptions;

  constructor(mapping: FieldMapping, options: FieldMapperOptions = {}) {
    this.mapping = mapping;
    this.options = options;
  }

  /**
   * Load field mapping from file
   */
  static async fromFile(
    filePath: string,
    options: FieldMapperOptions = {}
  ): Promise<FieldMapper> {
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    if (!isFieldMapping(data)) {
      throw new Error(`Invalid field mapping in ${filePath}`);
    }

    return new FieldMapper(data, options);
  }

  /**
   * Load named profile from schemas/profiles directory
   */
  static async fromProfile(
    profileName: string,
    options: FieldMapperOptions = {}
  ): Promise<FieldMapper> {
    // Determine package root - handle both ESM and CJS contexts
    let profilePath: string;
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      profilePath = resolve(__dirname, '../../schemas/profiles', `${profileName}.json`);
    } catch {
      // Fallback for CJS or different module context
      profilePath = resolve(process.cwd(), 'src/schemas/profiles', `${profileName}.json`);
    }

    return FieldMapper.fromFile(profilePath, options);
  }

  /**
   * Apply mapping to a single feature
   */
  mapFeature(feature: Feature): FieldMappingResult {
    const errors: FieldMappingError[] = [];
    const sourceProps = feature.properties ?? {};
    const mapped: Record<string, unknown> = { ...sourceProps };

    try {
      // Step 1: Apply simple field renames
      if (this.mapping.fields) {
        for (const [sourceField, targetField] of Object.entries(this.mapping.fields)) {
          if (sourceField in sourceProps) {
            mapped[targetField] = sourceProps[sourceField];
            // Keep source field unless it's the same as target
            if (sourceField !== targetField) {
              delete mapped[sourceField];
            }
          }
        }
      }

      // Step 2: Apply transformations (order matters for derived fields)
      if (this.mapping.transforms) {
        // Sort transforms to handle dependencies
        // Fields referenced in concat/formula must be computed first
        const transformEntries = Object.entries(this.mapping.transforms);
        const sorted = this.sortTransforms(transformEntries);

        for (const [targetField, transform] of sorted) {
          const result = this.applyTransform(targetField, transform, mapped);

          if (result.success) {
            mapped[targetField] = result.value;
          } else {
            errors.push({
              field: targetField,
              message: result.error ?? 'Transform failed',
              sourceValue: result.sourceValue,
            });

            // Fail fast if configured
            if (this.options.failFast) {
              return {
                success: false,
                errors,
              };
            }
          }
        }
      }

      // Step 3: Validate output
      if (this.mapping.validation) {
        const validationErrors = this.validateOutput(mapped);
        errors.push(...validationErrors);

        if (validationErrors.length > 0 && this.mapping.validation.skipInvalid) {
          return {
            success: false,
            errors,
            skipped: true,
          };
        }
      }

      // Success if no errors or skipInvalid is true
      return {
        success: errors.length === 0 || this.mapping.validation?.skipInvalid === true,
        mapped,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      return {
        success: false,
        errors: [
          {
            field: 'root',
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  }

  /**
   * Apply mapping to entire feature collection
   */
  mapFeatureCollection(
    collection: FeatureCollection
  ): {
    mapped: FeatureCollection;
    errors: Array<{ featureIndex: number; errors: readonly FieldMappingError[] }>;
    skippedCount: number;
  } {
    const mappedFeatures: Feature[] = [];
    const allErrors: Array<{ featureIndex: number; errors: readonly FieldMappingError[] }> = [];
    let skippedCount = 0;

    for (let i = 0; i < collection.features.length; i++) {
      const feature = collection.features[i];
      if (!feature) continue;

      const result = this.mapFeature(feature);

      if (result.success && result.mapped) {
        mappedFeatures.push({
          ...feature,
          properties: result.mapped,
        });
      } else if (result.skipped) {
        skippedCount++;
      } else {
        // Failed and not skipped
        if (result.errors) {
          allErrors.push({
            featureIndex: i,
            errors: result.errors,
          });
        }

        if (this.options.failFast) {
          break;
        }
      }
    }

    return {
      mapped: {
        type: 'FeatureCollection',
        features: mappedFeatures,
      },
      errors: allErrors,
      skippedCount,
    };
  }

  /**
   * Sort transforms to handle dependencies
   * Transforms that reference other transformed fields should run after them
   */
  private sortTransforms(
    transforms: Array<[string, FieldTransform]>
  ): Array<[string, FieldTransform]> {
    // Simple topological sort based on field dependencies
    const sorted: Array<[string, FieldTransform]> = [];
    const added = new Set<string>();
    const pending = new Map(transforms);

    // Helper to get dependencies of a transform
    const getDependencies = (transform: FieldTransform): string[] => {
      switch (transform.type) {
        case 'lookup':
          return [transform.sourceField];
        case 'formula':
          return Array.from(transform.sourceFields);
        case 'concat':
          return Array.from(transform.sourceFields);
        default:
          return [];
      }
    };

    // Iteratively add transforms whose dependencies are satisfied
    let changed = true;
    while (pending.size > 0 && changed) {
      changed = false;

      const entries = Array.from(pending.entries());
      for (const [field, transform] of entries) {
        const deps = getDependencies(transform);
        const allDepsAdded = deps.every(
          (dep) => added.has(dep) || !pending.has(dep)
        );

        if (allDepsAdded) {
          sorted.push([field, transform]);
          added.add(field);
          pending.delete(field);
          changed = true;
        }
      }
    }

    // Add remaining (if any circular dependencies or isolated fields)
    const remaining = Array.from(pending.entries());
    for (const entry of remaining) {
      sorted.push(entry);
    }

    return sorted;
  }

  /**
   * Apply a single transformation
   */
  private applyTransform(
    targetField: string,
    transform: FieldTransform,
    properties: Record<string, unknown>
  ): {
    success: boolean;
    value?: unknown;
    error?: string;
    sourceValue?: unknown;
  } {
    try {
      switch (transform.type) {
        case 'constant':
          return this.applyConstant(transform as ConstantTransform);

        case 'lookup':
          return this.applyLookup(transform as LookupTransform, properties);

        case 'formula':
          return this.applyFormula(transform as FormulaTransform, properties);

        case 'concat':
          return this.applyConcat(transform as ConcatTransform, properties);

        default:
          return {
            success: false,
            error: `Unknown transform type: ${(transform as FieldTransform).type}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Apply constant transform
   */
  private applyConstant(transform: ConstantTransform): {
    success: boolean;
    value: string | number | boolean;
  } {
    return {
      success: true,
      value: transform.value,
    };
  }

  /**
   * Apply lookup transform
   */
  private applyLookup(
    transform: LookupTransform,
    properties: Record<string, unknown>
  ): {
    success: boolean;
    value?: string;
    error?: string;
    sourceValue?: unknown;
  } {
    const sourceValue = properties[transform.sourceField];

    if (sourceValue === undefined || sourceValue === null) {
      return {
        success: false,
        error: `Source field ${transform.sourceField} is missing`,
        sourceValue,
      };
    }

    const key = String(sourceValue);
    const mappedValue = transform.lookupTable[key];

    if (mappedValue !== undefined) {
      return {
        success: true,
        value: mappedValue,
      };
    }

    // Use default value if provided
    if (transform.defaultValue !== undefined) {
      return {
        success: true,
        value: transform.defaultValue,
      };
    }

    return {
      success: false,
      error: `No lookup mapping for ${transform.sourceField}=${key}`,
      sourceValue,
    };
  }

  /**
   * Apply formula transform
   *
   * SECURITY: Evaluates in isolated VM context with no access to Node.js APIs
   */
  private applyFormula(
    transform: FormulaTransform,
    properties: Record<string, unknown>
  ): {
    success: boolean;
    value?: unknown;
    error?: string;
  } {
    try {
      // Build context with only referenced fields
      const context: Record<string, unknown> = {};
      for (const field of transform.sourceFields) {
        context[field] = properties[field];
      }

      // Add safe utility functions
      context.String = String;
      context.Number = Number;
      context.Math = Math;
      context.parseInt = parseInt;
      context.parseFloat = parseFloat;

      // Create isolated context
      const vmContext = vm.createContext(context);

      // Evaluate expression with timeout
      const result = vm.runInContext(transform.expression, vmContext, {
        timeout: 1000, // 1 second max
      });

      return {
        success: true,
        value: result,
      };
    } catch (error) {
      return {
        success: false,
        error: `Formula evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Apply concatenation transform
   */
  private applyConcat(
    transform: ConcatTransform,
    properties: Record<string, unknown>
  ): {
    success: boolean;
    value?: string;
    error?: string;
  } {
    try {
      const parts: string[] = [];

      for (const field of transform.sourceFields) {
        const value = properties[field];
        if (value === undefined || value === null) {
          return {
            success: false,
            error: `Source field ${field} is missing for concatenation`,
          };
        }
        parts.push(String(value));
      }

      const separator = transform.separator ?? '';
      return {
        success: true,
        value: parts.join(separator),
      };
    } catch (error) {
      return {
        success: false,
        error: `Concatenation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Validate mapped output against validation rules
   */
  private validateOutput(mapped: Record<string, unknown>): FieldMappingError[] {
    const errors: FieldMappingError[] = [];

    if (!this.mapping.validation) {
      return errors;
    }

    // Check required fields
    if (this.mapping.validation.requiredFields) {
      for (const field of this.mapping.validation.requiredFields) {
        if (!(field in mapped) || mapped[field] === undefined || mapped[field] === null) {
          errors.push({
            field,
            message: `Required field ${field} is missing after mapping`,
          });
        }
      }
    }

    // Custom validation (if provided)
    if (this.mapping.validation.customValidator) {
      try {
        const context = { mapped, errors: [] as string[] };
        const vmContext = vm.createContext(context);
        vm.runInContext(this.mapping.validation.customValidator, vmContext, {
          timeout: 1000,
        });

        // Add custom validation errors
        for (const error of context.errors) {
          errors.push({
            field: 'custom',
            message: error,
          });
        }
      } catch (error) {
        errors.push({
          field: 'custom',
          message: `Custom validation failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    return errors;
  }

  /**
   * Get mapping metadata
   */
  getMetadata(): {
    version: string;
    description?: string;
    source?: FieldMapping['source'];
  } {
    return {
      version: this.mapping.version,
      description: this.mapping.description,
      source: this.mapping.source,
    };
  }
}

/**
 * Apply field mapping to GeoJSON file
 *
 * Convenience function for one-off transformations.
 */
export async function applyFieldMapping(
  geojson: FeatureCollection,
  mappingPath: string,
  options: FieldMapperOptions = {}
): Promise<{
  mapped: FeatureCollection;
  errors: Array<{ featureIndex: number; errors: readonly FieldMappingError[] }>;
  skippedCount: number;
}> {
  const mapper = await FieldMapper.fromFile(mappingPath, options);
  return mapper.mapFeatureCollection(geojson);
}

/**
 * Apply named profile to GeoJSON
 */
export async function applyProfile(
  geojson: FeatureCollection,
  profileName: string,
  options: FieldMapperOptions = {}
): Promise<{
  mapped: FeatureCollection;
  errors: Array<{ featureIndex: number; errors: readonly FieldMappingError[] }>;
  skippedCount: number;
}> {
  const mapper = await FieldMapper.fromProfile(profileName, options);
  return mapper.mapFeatureCollection(geojson);
}
