#!/usr/bin/env node
/**
 * Shadow Atlas Dataset Validation and Conversion
 *
 * Validates comprehensive_classified_layers.jsonl against schema and generates
 * versioned production dataset (shadow-atlas-v1.0.0.json).
 *
 * USAGE:
 *   node schemas/validate-and-convert.js
 *
 * OUTPUT:
 *   - data/shadow-atlas-v1.0.0.json (validated dataset with metadata)
 *   - schemas/validation-report.json (detailed validation results)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Enum definitions (matching TypeScript schema)
const DistrictType = {
  CITY_COUNCIL: 'city_council',
  COUNTY_COMMISSION: 'county_commission',
  SCHOOL_BOARD: 'school_board',
  STATE_LEGISLATIVE: 'state_legislative',
  CONGRESSIONAL: 'congressional',
  FIRE_DISTRICT: 'fire_district',
  WATER_DISTRICT: 'water_district',
  LIBRARY_DISTRICT: 'library_district',
  PARK_DISTRICT: 'park_district',
  TRANSIT_DISTRICT: 'transit_district',
  HEALTH_DISTRICT: 'health_district',
  PRECINCT: 'precinct',
  BOUNDARY: 'boundary',
  CENSUS: 'census',
  JUDICIAL: 'judicial',
  POLICE_DISTRICT: 'police_district',
  ZONING: 'zoning',
  PARCEL: 'parcel',
  NON_POLYGON: 'non_polygon',
  UNKNOWN: 'unknown',
};

const GovernanceLevel = {
  FEDERAL: 'federal',
  STATE: 'state',
  COUNTY: 'county',
  MUNICIPAL: 'municipal',
  SPECIAL: 'special',
  JUDICIAL: 'judicial',
  ADMINISTRATIVE: 'administrative',
  ELECTORAL_ADMIN: 'electoral_admin',
  PLANNING: 'planning',
  STATISTICAL: 'statistical',
  NON_GOVERNANCE: 'non_governance',
  UNKNOWN: 'unknown',
};

const QualityTier = {
  GOLD: 'GOLD',
  SILVER: 'SILVER',
  BRONZE: 'BRONZE',
  UTILITY: 'UTILITY',
  REJECT: 'REJECT',
};

const GeometryType = {
  POLYGON: 'esriGeometryPolygon',
  POLYLINE: 'esriGeometryPolyline',
  POINT: 'esriGeometryPoint',
  MULTIPOINT: 'esriGeometryMultipoint',
  MULTIPATCH: 'esriGeometryMultiPatch',
};

/**
 * Initialize statistics counters
 */
function initializeStats() {
  const stats = {
    by_tier: {},
    by_governance_level: {},
    by_district_type: {},
    elected_count: 0,
    polygon_count: 0,
  };

  // Initialize tier counts
  for (const tier of Object.values(QualityTier)) {
    stats.by_tier[tier] = 0;
  }

  // Initialize governance level counts
  for (const level of Object.values(GovernanceLevel)) {
    stats.by_governance_level[level] = 0;
  }

  // Initialize district type counts
  for (const type of Object.values(DistrictType)) {
    stats.by_district_type[type] = 0;
  }

  return stats;
}

/**
 * Update statistics with district data
 */
function updateStats(stats, district) {
  stats.by_tier[district.tier]++;
  stats.by_governance_level[district.governance_level]++;
  stats.by_district_type[district.district_type]++;

  if (district.elected) {
    stats.elected_count++;
  }

  if (district.geometry_type === GeometryType.POLYGON) {
    stats.polygon_count++;
  }
}

/**
 * Validate district against schema
 */
function validateDistrict(district) {
  const errors = [];

  // Validate required string fields
  if (typeof district.service_url !== 'string' || district.service_url.length === 0) {
    errors.push({
      field: 'service_url',
      value: district.service_url,
      expected: 'non-empty string',
      message: 'service_url must be a non-empty string',
    });
  }

  if (typeof district.layer_url !== 'string' || district.layer_url.length === 0) {
    errors.push({
      field: 'layer_url',
      value: district.layer_url,
      expected: 'non-empty string',
      message: 'layer_url must be a non-empty string',
    });
  }

  if (typeof district.layer_name !== 'string' || district.layer_name.length === 0) {
    errors.push({
      field: 'layer_name',
      value: district.layer_name,
      expected: 'non-empty string',
      message: 'layer_name must be a non-empty string',
    });
  }

  // Validate required number fields
  if (typeof district.layer_number !== 'number' || district.layer_number < 0) {
    errors.push({
      field: 'layer_number',
      value: district.layer_number,
      expected: 'number >= 0',
      message: 'layer_number must be a number >= 0',
    });
  }

  if (typeof district.feature_count !== 'number' || district.feature_count < 0) {
    errors.push({
      field: 'feature_count',
      value: district.feature_count,
      expected: 'number >= 0',
      message: 'feature_count must be a number >= 0',
    });
  }

  if (typeof district.confidence !== 'number' || district.confidence < 0 || district.confidence > 1) {
    errors.push({
      field: 'confidence',
      value: district.confidence,
      expected: 'number 0-1',
      message: 'confidence must be a number between 0 and 1',
    });
  }

  if (typeof district.score !== 'number' || district.score < 0 || district.score > 100) {
    errors.push({
      field: 'score',
      value: district.score,
      expected: 'number 0-100',
      message: 'score must be a number between 0 and 100',
    });
  }

  // Validate boolean field
  if (typeof district.elected !== 'boolean') {
    errors.push({
      field: 'elected',
      value: district.elected,
      expected: 'boolean',
      message: 'elected must be a boolean',
    });
  }

  // Validate enum fields
  if (!Object.values(GeometryType).includes(district.geometry_type)) {
    errors.push({
      field: 'geometry_type',
      value: district.geometry_type,
      expected: `one of: ${Object.values(GeometryType).join(', ')}`,
      message: 'geometry_type must be a valid GeometryType enum value',
    });
  }

  if (!Object.values(DistrictType).includes(district.district_type)) {
    errors.push({
      field: 'district_type',
      value: district.district_type,
      expected: `one of: ${Object.values(DistrictType).join(', ')}`,
      message: 'district_type must be a valid DistrictType enum value',
    });
  }

  if (!Object.values(QualityTier).includes(district.tier)) {
    errors.push({
      field: 'tier',
      value: district.tier,
      expected: `one of: ${Object.values(QualityTier).join(', ')}`,
      message: 'tier must be a valid QualityTier enum value',
    });
  }

  if (!Object.values(GovernanceLevel).includes(district.governance_level)) {
    errors.push({
      field: 'governance_level',
      value: district.governance_level,
      expected: `one of: ${Object.values(GovernanceLevel).join(', ')}`,
      message: 'governance_level must be a valid GovernanceLevel enum value',
    });
  }

  // Validate array fields
  if (!Array.isArray(district.fields) || !district.fields.every(f => typeof f === 'string')) {
    errors.push({
      field: 'fields',
      value: district.fields,
      expected: 'array of strings',
      message: 'fields must be an array of strings',
    });
  }

  if (!Array.isArray(district.classification_reasons) ||
      !district.classification_reasons.every(r => typeof r === 'string')) {
    errors.push({
      field: 'classification_reasons',
      value: district.classification_reasons,
      expected: 'array of strings',
      message: 'classification_reasons must be an array of strings',
    });
  }

  return errors;
}

/**
 * Main validation and conversion logic
 */
async function validateAndConvert() {
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
    console.error(`❌ Input file not found: ${inputFile}`);
    process.exit(1);
  }

  const validDistricts = [];
  const validationErrors = [];
  const stats = initializeStats();

  let lineNumber = 0;
  let validCount = 0;
  let invalidCount = 0;

  // Create readline interface for streaming JSONL
  const fileStream = fs.createReadStream(inputFile);
  const rl = readline.createInterface({
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
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      invalidCount++;
      validationErrors.push({
        line_number: lineNumber,
        district_url: null,
        errors: [
          {
            field: 'json',
            value: line.substring(0, 100),
            expected: 'valid JSON',
            message: `JSON parse error: ${error.message}`,
          },
        ],
      });
      continue;
    }

    // Validate against schema
    const errors = validateDistrict(record);

    if (errors.length > 0) {
      invalidCount++;
      validationErrors.push({
        line_number: lineNumber,
        district_url: record.layer_url || null,
        errors,
      });
    } else {
      validCount++;
      validDistricts.push(record);
      updateStats(stats, record);
    }

    // Progress indicator every 1000 lines
    if (lineNumber % 1000 === 0) {
      process.stdout.write(`\r✓ Processed ${lineNumber} lines (${validCount} valid, ${invalidCount} invalid)`);
    }
  }

  console.log(`\n\n✅ Validation complete!`);
  console.log(`   Total lines:     ${lineNumber}`);
  console.log(`   Valid districts: ${validCount}`);
  console.log(`   Invalid:         ${invalidCount}`);
  console.log(`   Success rate:    ${((validCount / lineNumber) * 100).toFixed(2)}%\n`);

  // Generate metadata
  const metadata = {
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
  const dataset = {
    metadata,
    districts: validDistricts,
  };

  // Write output files
  console.log('📝 Writing output files...');

  // Ensure output directory exists
  const outputDir = path.dirname(outputFile);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write validated dataset
  fs.writeFileSync(outputFile, JSON.stringify(dataset, null, 2), 'utf-8');
  const fileSizeMB = (fs.statSync(outputFile).size / 1024 / 1024).toFixed(2);
  console.log(`   ✓ Dataset: ${outputFile} (${fileSizeMB} MB)`);

  // Write validation report
  const report = {
    timestamp: new Date().toISOString(),
    source_file: inputFile,
    total_lines: lineNumber,
    valid_districts: validCount,
    invalid_districts: invalidCount,
    validation_errors: validationErrors,
    statistics: stats,
  };

  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf-8');
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
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
