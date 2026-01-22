#!/usr/bin/env tsx
/**
 * Validate Golden Vectors Script
 *
 * Validates all golden vector files to ensure they meet quality standards
 * before being used for production regression testing.
 *
 * USAGE:
 *   npm run validate-golden-vectors
 *   npm run validate-golden-vectors -- --strict  # Block on approximate data
 *
 * EXIT CODES:
 *   0 - All golden vectors valid
 *   1 - Validation errors found
 *   2 - Approximate data found (strict mode only)
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { argv } from 'process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ValidationResult {
  readonly file: string;
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly isApproximate: boolean;
}

/**
 * Validate a single golden vector file
 */
function validateGoldenVector(filePath: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let isApproximate = false;

  try {
    const content = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);

    // Required fields
    if (!data.cityFips) errors.push('Missing cityFips');
    if (!data.cityName) errors.push('Missing cityName');
    if (!data.state) errors.push('Missing state');
    if (typeof data.expectedWardCount !== 'number') errors.push('Missing or invalid expectedWardCount');
    if (!Array.isArray(data.legalDescriptions)) errors.push('Missing or invalid legalDescriptions');
    if (!Array.isArray(data.expectedPolygons)) errors.push('Missing or invalid expectedPolygons');
    if (!data.verifiedAt) errors.push('Missing verifiedAt');
    if (!data.verificationSource) errors.push('Missing verificationSource');

    // Check for approximate data
    if (data.metadata) {
      if (data.metadata.precisionLevel === 'approximate') {
        isApproximate = true;
        warnings.push('Precision level is "approximate" - not production ready');
      }
      if (data.metadata.verificationStatus === 'pending_human_verification') {
        isApproximate = true;
        warnings.push('Verification status is "pending_human_verification" - needs verification');
      }
      if (data.metadata.dataQualityWarning) {
        warnings.push('Contains data quality warning');
      }
    }

    // Validate ward count matches arrays
    if (data.legalDescriptions && data.legalDescriptions.length !== data.expectedWardCount) {
      errors.push(
        `Legal descriptions count (${data.legalDescriptions.length}) does not match expectedWardCount (${data.expectedWardCount})`
      );
    }
    if (data.expectedPolygons && data.expectedPolygons.length !== data.expectedWardCount) {
      errors.push(
        `Expected polygons count (${data.expectedPolygons.length}) does not match expectedWardCount (${data.expectedWardCount})`
      );
    }

    // Validate each polygon
    if (Array.isArray(data.expectedPolygons)) {
      data.expectedPolygons.forEach((polygon: any, idx: number) => {
        const wardId = polygon.properties?.wardId || idx;

        if (polygon.type !== 'Feature') {
          errors.push(`Polygon ${wardId}: type must be "Feature", got "${polygon.type}"`);
        }

        if (polygon.geometry?.type !== 'Polygon') {
          errors.push(
            `Polygon ${wardId}: geometry.type must be "Polygon", got "${polygon.geometry?.type}"`
          );
        }

        if (!Array.isArray(polygon.geometry?.coordinates)) {
          errors.push(`Polygon ${wardId}: geometry.coordinates must be an array`);
        } else {
          const ring = polygon.geometry.coordinates[0];
          if (!Array.isArray(ring)) {
            errors.push(`Polygon ${wardId}: exterior ring must be an array`);
          } else {
            // Check minimum points
            if (ring.length < 4) {
              errors.push(
                `Polygon ${wardId}: ring has ${ring.length} points, need at least 4`
              );
            }

            // Check closed ring
            const first = ring[0];
            const last = ring[ring.length - 1];
            if (!Array.isArray(first) || !Array.isArray(last)) {
              errors.push(`Polygon ${wardId}: ring coordinates must be arrays`);
            } else if (first[0] !== last[0] || first[1] !== last[1]) {
              errors.push(`Polygon ${wardId}: ring is not closed (first point ≠ last point)`);
            }

            // Check for valid coordinates
            ring.forEach((coord: any, coordIdx: number) => {
              if (!Array.isArray(coord) || coord.length < 2) {
                errors.push(
                  `Polygon ${wardId}, coordinate ${coordIdx}: must be [lon, lat] array`
                );
              } else {
                const [lon, lat] = coord;
                if (typeof lon !== 'number' || typeof lat !== 'number') {
                  errors.push(
                    `Polygon ${wardId}, coordinate ${coordIdx}: lon and lat must be numbers`
                  );
                } else {
                  // Validate coordinate ranges
                  if (lon < -180 || lon > 180) {
                    errors.push(
                      `Polygon ${wardId}, coordinate ${coordIdx}: longitude ${lon} out of range [-180, 180]`
                    );
                  }
                  if (lat < -90 || lat > 90) {
                    errors.push(
                      `Polygon ${wardId}, coordinate ${coordIdx}: latitude ${lat} out of range [-90, 90]`
                    );
                  }
                }
              }
            });
          }
        }

        // Check properties
        if (!polygon.properties) {
          warnings.push(`Polygon ${wardId}: missing properties object`);
        } else {
          if (!polygon.properties.wardId) {
            warnings.push(`Polygon ${wardId}: missing wardId property`);
          }
          if (!polygon.properties.wardName) {
            warnings.push(`Polygon ${wardId}: missing wardName property`);
          }
          if (polygon.properties.approximateData === true) {
            isApproximate = true;
            warnings.push(`Polygon ${wardId}: marked as approximate data`);
          }
        }
      });
    }

    // Validate legal descriptions
    if (Array.isArray(data.legalDescriptions)) {
      data.legalDescriptions.forEach((desc: any, idx: number) => {
        const wardId = desc.wardId || idx;

        if (!desc.cityFips) warnings.push(`Legal description ${wardId}: missing cityFips`);
        if (!desc.wardId) warnings.push(`Legal description ${wardId}: missing wardId`);
        if (!desc.wardName) warnings.push(`Legal description ${wardId}: missing wardName`);
        if (!Array.isArray(desc.segments)) {
          errors.push(`Legal description ${wardId}: segments must be an array`);
        } else if (desc.segments.length === 0) {
          warnings.push(`Legal description ${wardId}: no segments defined`);
        }

        if (!desc.source) {
          warnings.push(`Legal description ${wardId}: missing source document`);
        } else {
          if (!desc.source.type) warnings.push(`Legal description ${wardId}: source missing type`);
          if (!desc.source.source)
            warnings.push(`Legal description ${wardId}: source missing source URL`);
          if (!desc.source.effectiveDate)
            warnings.push(`Legal description ${wardId}: source missing effectiveDate`);
        }
      });
    }

    // Check notes for approximate data warnings
    if (data.notes) {
      if (
        data.notes.includes('APPROXIMATE') ||
        data.notes.includes('NOT be used for production') ||
        data.notes.includes('pending')
      ) {
        isApproximate = true;
      }
    }
  } catch (err) {
    errors.push(`Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    file: filePath,
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    isApproximate,
  };
}

/**
 * Format validation result for display
 */
function formatResult(result: ValidationResult): string {
  const lines: string[] = [];
  const fileName = result.file.split('/').pop() || result.file;

  if (result.valid && !result.isApproximate) {
    lines.push(`✅ ${fileName}: VALID (production ready)`);
  } else if (result.valid && result.isApproximate) {
    lines.push(`⚠️  ${fileName}: VALID (approximate data - not production ready)`);
  } else {
    lines.push(`❌ ${fileName}: INVALID`);
  }

  if (result.errors.length > 0) {
    lines.push('\n  Errors:');
    result.errors.forEach((err) => lines.push(`    ❌ ${err}`));
  }

  if (result.warnings.length > 0) {
    lines.push('\n  Warnings:');
    result.warnings.forEach((warn) => lines.push(`    ⚠️  ${warn}`));
  }

  return lines.join('\n');
}

/**
 * Main validation function
 */
function main(): void {
  const strictMode = argv.includes('--strict');

  console.log('🔍 Validating Golden Vectors\n');
  if (strictMode) {
    console.log('Running in STRICT mode (approximate data will fail)\n');
  }

  const goldenVectorsDir = join(
    __dirname,
    '..',
    'src',
    'reconstruction',
    'golden-vectors'
  );

  // Find all JSON files
  const files = readdirSync(goldenVectorsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => join(goldenVectorsDir, f));

  if (files.length === 0) {
    console.log('⚠️  No golden vector files found');
    process.exit(0);
  }

  console.log(`Found ${files.length} golden vector file(s)\n`);

  // Validate each file
  const results = files.map((file) => validateGoldenVector(file));

  // Display results
  results.forEach((result) => {
    console.log(formatResult(result));
    console.log('');
  });

  // Summary
  const validCount = results.filter((r) => r.valid).length;
  const approximateCount = results.filter((r) => r.isApproximate).length;
  const productionReadyCount = results.filter((r) => r.valid && !r.isApproximate).length;

  console.log('='.repeat(60));
  console.log('Summary:');
  console.log(`  Total files: ${results.length}`);
  console.log(`  Valid: ${validCount}`);
  console.log(`  Production ready: ${productionReadyCount}`);
  console.log(`  Approximate data: ${approximateCount}`);
  console.log(`  Invalid: ${results.length - validCount}`);
  console.log('='.repeat(60));

  // Exit code
  const hasErrors = results.some((r) => !r.valid);
  const hasApproximate = results.some((r) => r.isApproximate);

  if (hasErrors) {
    console.error('\n❌ Validation failed: errors found');
    process.exit(1);
  } else if (strictMode && hasApproximate) {
    console.error(
      '\n❌ Validation failed: approximate data found (strict mode)'
    );
    process.exit(2);
  } else if (hasApproximate) {
    console.log(
      '\n⚠️  Warning: Some golden vectors contain approximate data'
    );
    console.log('   These are not ready for production use.');
    console.log(
      '   See VERIFICATION_NEEDED.md for how to obtain accurate data.'
    );
    process.exit(0);
  } else {
    console.log('\n✅ All golden vectors are valid and production ready!');
    process.exit(0);
  }
}

// Run
main();
