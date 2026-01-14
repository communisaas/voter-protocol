#!/usr/bin/env tsx
/**
 * Shadow Atlas Dataset Validation and Conversion
 *
 * Validates comprehensive_classified_layers.jsonl against schema and generates
 * versioned production dataset (shadow-atlas-v1.0.0.json).
 *
 * USAGE:
 *   tsx schemas/validate-and-convert.ts
 *
 * OUTPUT:
 *   - data/shadow-atlas-v1.0.0.json (validated dataset with metadata)
 *   - schemas/validation-report.json (detailed validation results)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import { logger } from '../../core/utils/logger.js';

import type {
  GovernanceDistrict,
  ShadowAtlasDataset,
  ShadowAtlasMetadata,
  DistrictType,
  GovernanceLevel,
  QualityTier,
  ValidationError,
} from './governance-district.js';

import {
  validateGovernanceDistrict,
  isGovernanceDistrict,
  DistrictType as DT,
  GovernanceLevel as GL,
  QualityTier as QT,
} from './governance-district.js';

/**
 * Validation Report
 */
interface ValidationReport {
  readonly timestamp: string;
  readonly source_file: string;
  readonly total_lines: number;
  readonly valid_districts: number;
  readonly invalid_districts: number;
  readonly validation_errors: Array<{
    readonly line_number: number;
    readonly district_url: string | null;
    readonly errors: readonly ValidationError[];
  }>;
  readonly statistics: {
    readonly by_tier: Record<QualityTier, number>;
    readonly by_governance_level: Record<GovernanceLevel, number>;
    readonly by_district_type: Record<DistrictType, number>;
    readonly elected_count: number;
    readonly polygon_count: number;
  };
}

/**
 * Initialize statistics counters
 */
function initializeStats() {
  return {
    by_tier: {
      [QT.GOLD]: 0,
      [QT.SILVER]: 0,
      [QT.BRONZE]: 0,
      [QT.UTILITY]: 0,
      [QT.REJECT]: 0,
    },
    by_governance_level: {
      [GL.FEDERAL]: 0,
      [GL.STATE]: 0,
      [GL.COUNTY]: 0,
      [GL.MUNICIPAL]: 0,
      [GL.SPECIAL]: 0,
      [GL.JUDICIAL]: 0,
      [GL.ADMINISTRATIVE]: 0,
      [GL.ELECTORAL_ADMIN]: 0,
      [GL.PLANNING]: 0,
      [GL.STATISTICAL]: 0,
      [GL.NON_GOVERNANCE]: 0,
      [GL.UNKNOWN]: 0,
    },
    by_district_type: {
      [DT.CITY_COUNCIL]: 0,
      [DT.COUNTY_COMMISSION]: 0,
      [DT.SCHOOL_BOARD]: 0,
      [DT.STATE_LEGISLATIVE]: 0,
      [DT.CONGRESSIONAL]: 0,
      [DT.FIRE_DISTRICT]: 0,
      [DT.WATER_DISTRICT]: 0,
      [DT.LIBRARY_DISTRICT]: 0,
      [DT.PARK_DISTRICT]: 0,
      [DT.TRANSIT_DISTRICT]: 0,
      [DT.HEALTH_DISTRICT]: 0,
      [DT.PRECINCT]: 0,
      [DT.BOUNDARY]: 0,
      [DT.CENSUS]: 0,
      [DT.JUDICIAL]: 0,
      [DT.POLICE_DISTRICT]: 0,
      [DT.ZONING]: 0,
      [DT.PARCEL]: 0,
      [DT.NON_POLYGON]: 0,
      [DT.UNKNOWN]: 0,
    },
    elected_count: 0,
    polygon_count: 0,
  };
}

/**
 * Update statistics with district data
 */
function updateStats(
  stats: ReturnType<typeof initializeStats>,
  district: GovernanceDistrict
): void {
  stats.by_tier[district.tier]++;
  stats.by_governance_level[district.governance_level]++;
  stats.by_district_type[district.district_type]++;

  if (district.elected) {
    stats.elected_count++;
  }

  if (district.geometry_type === 'esriGeometryPolygon') {
    stats.polygon_count++;
  }
}

/**
 * Main validation and conversion logic
 */
async function validateAndConvert(): Promise<void> {
  const inputFile = path.join(__dirname, '../agents/data/comprehensive_classified_layers.jsonl');
  const outputFile = path.join(__dirname, '../data/shadow-atlas-v1.0.0.json');
  const reportFile = path.join(__dirname, './validation-report.json');

  console.log('🔍 Shadow Atlas Dataset Validation');
  console.log('═══════════════════════════════════');
  console.log(`Input:  ${inputFile}`);
  console.log(`Output: ${outputFile}`);
  console.log(`Report: ${reportFile}\n`);

  // Validate input file exists
  if (!fs.existsSync(inputFile)) {
    logger.error('Input file not found', {
      operation: 'validate_and_convert',
      inputFile,
    });
    console.error(`❌ Input file not found: ${inputFile}`);
    process.exit(1);
  }

  const validDistricts: GovernanceDistrict[] = [];
  const validationErrors: ValidationReport['validation_errors'] = [];
  const stats = initializeStats();

  let lineNumber = 0;
  let validCount = 0;
  let invalidCount = 0;

  // Create readline interface for streaming JSONL
  const fileStream = fs.createReadStream(inputFile);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  // Process each line
  for await (const line of rl) {
    lineNumber++;

    // Skip empty lines
    if (line.trim().length === 0) {
      continue;
    }

    // Parse JSON
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch (error) {
      invalidCount++;
      logger.warn('JSON parse error in validation', {
        operation: 'validate_line',
        lineNumber,
        error: error instanceof Error ? error.message : String(error),
        lineSample: line.substring(0, 100),
      });
      validationErrors.push({
        line_number: lineNumber,
        district_url: null,
        errors: [
          {
            field: 'json',
            value: line.substring(0, 100),
            expected: 'valid JSON',
            message: `JSON parse error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      });
      continue;
    }

    // Validate against schema
    const errors = validateGovernanceDistrict(record);

    if (errors.length > 0) {
      invalidCount++;
      logger.debug('Schema validation failed', {
        operation: 'validate_line',
        lineNumber,
        errorCount: errors.length,
        firstError: errors[0]?.message,
      });
      validationErrors.push({
        line_number: lineNumber,
        district_url:
          typeof record === 'object' && record !== null && 'layer_url' in record
            ? String((record as { layer_url: unknown }).layer_url)
            : null,
        errors,
      });
    } else if (isGovernanceDistrict(record)) {
      validCount++;
      validDistricts.push(record);
      updateStats(stats, record);
    }

    // Progress indicator every 1000 lines
    if (lineNumber % 1000 === 0) {
      process.stdout.write(`\r✓ Processed ${lineNumber} lines (${validCount} valid, ${invalidCount} invalid)`);
    }
  }

  logger.info('Validation complete', {
    operation: 'validate_and_convert',
    totalLines: lineNumber,
    validDistricts: validCount,
    invalidDistricts: invalidCount,
    successRate: ((validCount / lineNumber) * 100).toFixed(2),
  });

  console.log(`\n\n✅ Validation complete!`);
  console.log(`   Total lines:     ${lineNumber}`);
  console.log(`   Valid districts: ${validCount}`);
  console.log(`   Invalid:         ${invalidCount}`);
  console.log(`   Success rate:    ${((validCount / lineNumber) * 100).toFixed(2)}%\n`);

  // Generate metadata
  const metadata: ShadowAtlasMetadata = {
    schema_version: '1.0.0',
    generated_at: new Date().toISOString(),
    total_districts: validCount,
    coverage_stats: stats,
    provenance: {
      source_file: 'comprehensive_classified_layers.jsonl',
      classification_method: 'ML ensemble (random forest + gradient boosting + neural network)',
      training_data_size: 4175,
      model_version: '1.0.0',
    },
  };

  // Create versioned dataset
  const dataset: ShadowAtlasDataset = {
    metadata,
    districts: validDistricts,
  };

  // Write output files
  console.log('📝 Writing output files...');

  // Write validated dataset
  fs.writeFileSync(outputFile, JSON.stringify(dataset, null, 2), 'utf-8');
  const datasetSizeMB = (fs.statSync(outputFile).size / 1024 / 1024).toFixed(2);
  logger.info('Dataset file written', {
    operation: 'write_dataset',
    outputFile,
    sizeMB: datasetSizeMB,
    districtCount: validDistricts.length,
  });
  console.log(`   ✓ Dataset: ${outputFile} (${datasetSizeMB} MB)`);

  // Write validation report
  const report: ValidationReport = {
    timestamp: new Date().toISOString(),
    source_file: inputFile,
    total_lines: lineNumber,
    valid_districts: validCount,
    invalid_districts: invalidCount,
    validation_errors: validationErrors,
    statistics: stats,
  };

  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf-8');
  logger.info('Validation report written', {
    operation: 'write_report',
    reportFile,
    errorCount: validationErrors.length,
  });
  console.log(`   ✓ Report:  ${reportFile}\n`);

  // Print summary statistics
  console.log('📊 Coverage Statistics');
  console.log('═══════════════════════════════════');
  console.log('\nBy Quality Tier:');
  console.log(`   GOLD:    ${stats.by_tier.GOLD.toLocaleString()} (elected, high confidence)`);
  console.log(`   SILVER:  ${stats.by_tier.SILVER.toLocaleString()} (non-elected, high confidence)`);
  console.log(`   BRONZE:  ${stats.by_tier.BRONZE.toLocaleString()} (medium confidence)`);
  console.log(`   UTILITY: ${stats.by_tier.UTILITY.toLocaleString()} (administrative reference)`);
  console.log(`   REJECT:  ${stats.by_tier.REJECT.toLocaleString()} (low confidence/non-governance)`);

  console.log('\nBy Governance Level:');
  const topLevels = Object.entries(stats.by_governance_level)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
  for (const [level, count] of topLevels) {
    console.log(`   ${level.padEnd(20)} ${count.toLocaleString()}`);
  }

  console.log('\nBy District Type:');
  const topTypes = Object.entries(stats.by_district_type)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
  for (const [type, count] of topTypes) {
    console.log(`   ${type.padEnd(20)} ${count.toLocaleString()}`);
  }

  console.log(`\nElected representation: ${stats.elected_count.toLocaleString()} districts`);
  console.log(`Polygon geometry:       ${stats.polygon_count.toLocaleString()} districts\n`);

  // Report validation errors if any
  if (invalidCount > 0) {
    console.warn('⚠️  Validation Warnings');
    console.warn('═══════════════════════════════════');
    console.warn(`${invalidCount} records failed validation.`);
    console.warn(`See ${reportFile} for details.\n`);

    // Show first 3 errors as examples
    const sampleErrors = validationErrors.slice(0, 3);
    for (const err of sampleErrors) {
      console.warn(`Line ${err.line_number}:`);
      for (const e of err.errors.slice(0, 2)) {
        console.warn(`   • ${e.message}`);
      }
      console.warn('');
    }

    if (validationErrors.length > 3) {
      console.warn(`... and ${validationErrors.length - 3} more errors (see report)\n`);
    }
  }

  console.log('✨ Done!\n');
}

// Run validation
validateAndConvert().catch((error) => {
  logger.error('Fatal validation error', {
    operation: 'validate_and_convert',
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
