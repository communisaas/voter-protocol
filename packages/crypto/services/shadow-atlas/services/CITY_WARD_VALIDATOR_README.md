# CityWardValidator Service

Production validation service for city ward extraction data.

## Overview

The `CityWardValidator` consolidates scattered validation logic from standalone scripts into a unified, type-safe service with comprehensive test coverage. Replaces the `validate-statewide-extraction.ts` script with a reusable, composable service.

## Features

- **File-based validation**: Loads and validates GeoJSON files from disk
- **Cross-reference validation**: Checks against extraction-summary.json and registry-entries.json
- **FIPS code validation**: Ensures 7-digit Census PLACE codes
- **Ward count validation**: Reasonable range checks (3-50 wards default)
- **Geometry validation**: Validates Polygon/MultiPolygon structures
- **Duplicate detection**: Detects duplicate FIPS codes and ward identifiers
- **Comprehensive reporting**: Detailed errors and warnings with error codes

## Usage

### Basic Validation

```typescript
import { CityWardValidator } from './services/city-ward-validator.js';

const validator = new CityWardValidator();

// Validate extraction directory directly
const result = validator.validateExtractionDirectory('./data/statewide-wards/WI');

console.log(`Validated ${result.cityCount} cities`);
console.log(`Errors: ${result.errors.length}`);
console.log(`Warnings: ${result.warnings.length}`);
console.log(`Status: ${result.passed ? 'PASSED' : 'FAILED'}`);
```

### Validation with Options

```typescript
const validator = new CityWardValidator({
  minWardCount: 5,
  maxWardCount: 25,
});

const result = validator.validateExtractionDirectory('./data/statewide-wards/MA', {
  includeGeometry: true,
  includeWardIdentifiers: true,
  allowWarnings: false, // Fail on warnings
});
```

### State Extraction Validation

```typescript
// Validate by state code (alternative API)
const result = validator.validateStateExtraction('WI', './data/statewide-wards');
```

### Individual Component Validation

```typescript
// Validate FIPS code
const fipsResult = validator.validateFipsCode('5553000');
// { fips: '5553000', valid: true }

// Validate ward count
const wardCountResult = validator.validateWardCount(7);
// { count: 7, valid: true, reasonable: true, expectedRange: { min: 3, max: 50 } }

// Validate GeoJSON geometry
const geojson = loadGeoJSON('city.geojson');
const geometryResult = validator.validateGeometry(geojson);
// { valid: true, featureCount: 7, issues: [] }

// Validate ward identifiers
const wardIdResult = validator.validateWardIdentifiers(geojson.features);
// { valid: true, totalWards: 7, uniqueWards: 7, duplicates: [] }
```

## Validation Result Structure

```typescript
interface CityWardValidationResult {
  state: string;              // State code
  cityCount: number;          // Total cities validated
  passed: boolean;            // Overall validation status
  errors: CityWardError[];    // Critical issues
  warnings: CityWardWarning[]; // Non-critical issues
  validatedAt: Date;          // Validation timestamp
  extractionSummary?: ExtractionSummary;
  registryEntries?: CityRegistryEntry[];
}
```

## Error Codes

```typescript
type CityWardErrorCode =
  | 'INVALID_FIPS'           // Invalid FIPS code format
  | 'DUPLICATE_FIPS'         // Duplicate FIPS code
  | 'MISSING_GEOJSON'        // Failed to load GeoJSON
  | 'INVALID_GEOJSON'        // Invalid GeoJSON structure
  | 'INVALID_GEOMETRY'       // Geometry validation failed
  | 'NO_FEATURES'            // Empty feature collection
  | 'DIRECTORY_NOT_FOUND';   // Cities directory not found
```

## Warning Codes

```typescript
type CityWardWarningCode =
  | 'UNUSUAL_WARD_COUNT'          // Ward count outside 3-50 range
  | 'DUPLICATE_WARD_ID'           // Duplicate ward identifier
  | 'MISSING_EXTRACTION_SUMMARY'  // extraction-summary.json missing
  | 'MISSING_REGISTRY_ENTRIES'    // registry-entries.json missing
  | 'LOW_CITY_COUNT';             // City count below 80% expected
```

## Directory Structure Expected

```
data/statewide-wards/
└── WI/
    ├── extraction-summary.json
    ├── registry-entries.json
    └── cities/
        ├── 5553000.geojson  (Milwaukee)
        ├── 5548000.geojson  (Madison)
        └── 5522000.geojson  (Green Bay)
```

## Test Coverage

Comprehensive test suite with 51 tests covering:

- Constructor and configuration
- FIPS code validation (5 tests)
- Ward count validation (6 tests)
- Geometry validation (8 tests)
- Ward identifier validation (4 tests)
- Extraction directory validation (13 tests)
- State extraction validation (15 tests)

All tests use temporary file system for isolation.

## Type Safety

Zero `any` types, zero `@ts-ignore` directives. All validation results are comprehensively typed for audit trails.

## Migration from Script

The `validate-statewide-extraction.ts` script has been fully migrated to this service.

**Old**:
```bash
npx tsx scripts/validate-statewide-extraction.ts --state WI
```

**New**:
```typescript
const validator = new CityWardValidator();
const result = validator.validateExtractionDirectory('./data/statewide-wards/WI');
```

See `scripts/archived/MIGRATION_GUIDE.md` for complete migration details.

## Files

- `city-ward-validator.ts` - Service implementation
- `city-ward-validator.test.ts` - Test suite (51 tests)
- `city-ward-validator.types.ts` - Type definitions
- `scripts/archived/validate-statewide-extraction.ts` - Deprecated script (archived)

## Philosophy

Type safety and validation correctness are non-negotiable. This is production infrastructure for electoral district verification. Loose types create runtime failures that brick the protocol.
