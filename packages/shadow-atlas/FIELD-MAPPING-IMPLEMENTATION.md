# Field Mapping Implementation

## Overview

This document describes the field mapping system added to the `shadow-atlas` package to handle non-standard data schemas in the `ingest tiger` command.

## Problem Statement

The TIGER ingestion pipeline expects standard Census TIGER field names. However, alternative data sources like VEST redistricting data use non-standard field names:

**Example: Utah VEST Data**
- Uses `CountyID` (sequential 1-29) instead of FIPS codes (001-057)
- Uses `vistapre` instead of standard precinct identifiers
- Requires GEOID construction from multiple fields

## Solution Architecture

### 1. Field Mapping Schema (`src/schemas/field-mapping.ts`)

Defines the TypeScript types for field mapping configurations:

**Core Types:**
- `FieldMapping`: Complete mapping configuration
- `FieldTransform`: Union type for all transformation types
- `TransformType`: Enum of available transformations
- `ValidationConfig`: Output validation rules

**Transform Types:**
1. **Constant**: Set field to constant value
2. **Lookup**: Map values through lookup table
3. **Formula**: Compute using JavaScript expressions
4. **Concat**: Concatenate multiple fields

**Type Safety:**
- Nuclear-level strictness (no `any`)
- Runtime type guards with `isFieldMapping()` and `isFieldTransform()`
- Comprehensive validation error types

### 2. Field Mapper Utility (`src/cli/lib/field-mapper.ts`)

Implements the transformation engine:

**Key Components:**
- `FieldMapper` class: Stateful mapper with configuration
- `mapFeature()`: Transform single GeoJSON feature
- `mapFeatureCollection()`: Transform entire collection
- `sortTransforms()`: Dependency-aware transform ordering

**Features:**
- Automatic dependency resolution (topological sort)
- Isolated VM context for formula evaluation (security)
- Detailed error reporting per feature
- Skip invalid or fail fast modes

**Loading Methods:**
```typescript
// From file
const mapper = await FieldMapper.fromFile('/path/to/mapping.json');

// From named profile
const mapper = await FieldMapper.fromProfile('vest-utah');
```

### 3. Enhanced Tiger Command (`src/cli/commands/ingest/tiger.ts`)

Added field mapping support to the ingest command:

**New Options:**
- `--field-mapping <file>`: Custom JSON mapping file
- `--schema-profile <name>`: Named profile (e.g., vest-utah)

**Workflow:**
1. Load TIGER data (or shapefile)
2. Load field mapping configuration
3. Apply transformations to all features
4. Validate mapped output
5. Report statistics (mapped count, errors, skipped)
6. Write output with mapped fields

**Usage Examples:**
```bash
# Using named profile
shadow-atlas ingest tiger --layer vtd --state 49 --schema-profile vest-utah

# Using custom mapping
shadow-atlas ingest tiger --layer vtd --state 49 --field-mapping ./custom.json

# With output file
shadow-atlas ingest tiger --layer vtd --state 49 \
  --schema-profile vest-utah \
  --output utah-vtd-mapped.geojson

# Verbose mode
shadow-atlas ingest tiger --layer vtd --state 49 \
  --schema-profile vest-utah \
  --verbose
```

### 4. Utah VEST Profile (`src/schemas/profiles/vest-utah.json`)

Production-ready mapping for Utah VEST 2020 data:

**Transformations:**
```json
{
  "fields": {
    "vistapre": "localPrecinct"
  },
  "transforms": {
    "stateFips": {
      "type": "constant",
      "value": "49"
    },
    "countyFips": {
      "type": "lookup",
      "sourceField": "CountyID",
      "lookupTable": {
        "1": "001",  // Beaver County
        "18": "035", // Salt Lake County
        ...
      }
    },
    "GEOID": {
      "type": "concat",
      "sourceFields": ["stateFips", "countyFips", "localPrecinct"]
    }
  }
}
```

**Mapping Result:**
```
Before: { CountyID: 18, vistapre: "SL203" }
After:  {
  CountyID: 18,
  vistapre: "SL203",
  stateFips: "49",
  countyFips: "035",
  countyName: "Salt Lake",
  localPrecinct: "SL203",
  GEOID: "49035SL203"
}
```

## Implementation Details

### Dependency Resolution

The field mapper automatically sorts transforms to handle dependencies:

```typescript
// Example: GEOID depends on stateFips and countyFips
// Execution order: stateFips → countyFips → GEOID
const sorted = this.sortTransforms(transforms);
```

Algorithm:
1. Build dependency graph from transform definitions
2. Topological sort (iterative, non-recursive)
3. Constants first, lookups next, formulas/concat last
4. Circular dependencies are added at end (may fail at runtime)

### Security - Formula Evaluation

Formulas run in isolated VM context with no access to Node.js APIs:

```typescript
const context = {
  // Only source fields
  CountyID: 18,

  // Safe utilities
  Math, String, Number, parseInt, parseFloat
};

const result = vm.runInContext(
  "(CountyID * 2 - 1).toString().padStart(3, '0')",
  vm.createContext(context),
  { timeout: 1000 } // 1 second max
);
```

**Blocked:**
- `require()`, `import()`
- `process`, `fs`, `child_process`
- `eval()`, `Function()`
- Network access

### Error Handling

Three error levels:

1. **Transform errors**: Field-specific failures
   ```typescript
   { field: "countyFips", message: "No lookup mapping for CountyID=99" }
   ```

2. **Validation errors**: Missing required fields
   ```typescript
   { field: "GEOID", message: "Required field GEOID is missing after mapping" }
   ```

3. **Fatal errors**: Configuration or system errors
   - Invalid JSON syntax
   - Unknown transform types
   - VM timeout exceeded

**Modes:**
- `skipInvalid: false` (default): Fail on first error
- `skipInvalid: true`: Skip invalid features, continue processing

### Output Format

**JSON mode:**
```json
{
  "success": true,
  "featureCount": 1234,
  "fieldMapping": {
    "applied": true,
    "profile": "vest-utah",
    "mappedCount": 1230,
    "skippedCount": 4,
    "errorCount": 0
  }
}
```

**Verbose mode:**
```
Field mapping results:
  Original features: 1234
  Mapped features: 1230
  Skipped features: 4
  Features with errors: 0
  Duration: 245ms

Sample mapping errors (first 5):
  Feature 42:
    - countyFips: No lookup mapping for CountyID=30
```

## File Structure

```
packages/shadow-atlas/src/
├── schemas/
│   ├── field-mapping.ts              # TypeScript schema definitions
│   └── profiles/
│       ├── README.md                 # Profile documentation
│       ├── vest-utah.json            # Utah VEST mapping
│       └── test-example.json         # Example for testing
├── cli/
│   ├── commands/
│   │   └── ingest/
│   │       └── tiger.ts              # Enhanced tiger command
│   └── lib/
│       └── field-mapper.ts           # Transformation engine
```

## Testing Approach

### Manual Testing

1. **Basic functionality**:
   ```bash
   shadow-atlas ingest tiger --layer vtd --state 49 --schema-profile vest-utah
   ```

2. **Verbose output**:
   ```bash
   shadow-atlas ingest tiger --layer vtd --state 49 --schema-profile vest-utah --verbose
   ```

3. **Custom mapping**:
   ```bash
   shadow-atlas ingest tiger --layer vtd --state 49 --field-mapping ./test.json
   ```

4. **Error handling**:
   ```bash
   # Invalid profile
   shadow-atlas ingest tiger --layer vtd --state 49 --schema-profile nonexistent

   # Both options (should error)
   shadow-atlas ingest tiger --layer vtd --state 49 \
     --schema-profile vest-utah \
     --field-mapping ./test.json
   ```

### Validation Checklist

- [ ] Schema types compile without errors
- [ ] Field mapper loads named profiles
- [ ] Field mapper loads custom files
- [ ] Simple field renames work
- [ ] Constant transforms work
- [ ] Lookup transforms work (with defaults)
- [ ] Formula transforms work (with timeout)
- [ ] Concat transforms work
- [ ] Dependency sorting is correct
- [ ] Validation catches missing fields
- [ ] Skip invalid mode works
- [ ] Fail fast mode works
- [ ] Verbose output shows details
- [ ] JSON output includes mapping stats
- [ ] VM isolation prevents access to Node.js APIs

## Usage Examples

### Example 1: Utah VEST VTD Data

```bash
# Ingest Utah VTD with field mapping
shadow-atlas ingest tiger \
  --layer vtd \
  --state 49 \
  --schema-profile vest-utah \
  --output utah-vtd-mapped.geojson \
  --verbose
```

**Output:**
```
Shadow Atlas TIGER Ingestion
==================================================
Layer: vtd (Voting Tabulation Districts)
State: 49
Vintage: 2024
Field mapping: profile/vest-utah

Fetching TIGER data...

Field Mapping Configuration:
  Version: 1.0.0
  Description: Utah VEST 2020 field mapping
  Source: Utah VEST 2020 Redistricting Data

Applying field mapping transformations...

Field mapping results:
  Original features: 1234
  Mapped features: 1234
  Duration: 180ms

Successfully fetched TIGER data
  Fetch duration: 450ms
  Total duration: 630ms
  Mapped features: 1234
  Output written to: utah-vtd-mapped.geojson
```

### Example 2: Custom State-Specific Mapping

```json
// custom-mapping.json
{
  "version": "1.0.0",
  "description": "Custom state precinct mapping",
  "fields": {
    "PREC_ID": "localPrecinct",
    "PREC_NAME": "precinctName"
  },
  "transforms": {
    "GEOID": {
      "type": "concat",
      "sourceFields": ["STATE_FIPS", "COUNTY_FIPS", "localPrecinct"],
      "separator": ""
    }
  },
  "validation": {
    "requiredFields": ["GEOID", "localPrecinct"],
    "skipInvalid": false
  }
}
```

```bash
shadow-atlas ingest tiger \
  --layer vtd \
  --state 06 \
  --field-mapping ./custom-mapping.json
```

## Future Enhancements

### Short-term
1. Add more pre-built profiles (other VEST states)
2. Profile validation CLI command
3. Dry-run mode (show what would be mapped)
4. Mapping diff viewer (before/after comparison)

### Long-term
1. Interactive mapping builder
2. Auto-detect schema and suggest mappings
3. Machine learning for field name similarity
4. Batch processing of multiple states
5. Incremental updates (only map changed features)

## Related Documentation

- **Schema Definition**: `/src/schemas/field-mapping.ts`
- **Profile Documentation**: `/src/schemas/profiles/README.md`
- **Utah Extraction Reference**: `/src/scripts/extract-utah-vtd.ts`
- **Ingestion Library**: `/src/cli/lib/ingestion.ts`

## Known Limitations

1. **Formula complexity**: Complex expressions may hit 1-second timeout
2. **Circular dependencies**: Not detected, will fail at runtime
3. **Type coercion**: All formula results are coerced to strings for GeoJSON properties
4. **Lookup performance**: O(1) per feature, but large tables may slow initialization
5. **Memory usage**: Entire GeoJSON loaded into memory (not streaming)

## Migration from extract-utah-vtd.ts

The Utah extraction script (`src/scripts/extract-utah-vtd.ts`) is now **superseded** by the field mapping system:

**Old approach:**
```bash
# Custom extraction script per state
npx tsx src/scripts/extract-utah-vtd.ts
```

**New approach:**
```bash
# Generalized with field mapping
shadow-atlas ingest tiger --layer vtd --state 49 --schema-profile vest-utah
```

**Benefits:**
- Declarative configuration (no code changes)
- Reusable across similar data sources
- Integrated into standard ingestion pipeline
- Better error handling and validation
- Consistent CLI interface

The extraction script remains as a **reference implementation** showing the field mapping requirements for Utah VEST data.
