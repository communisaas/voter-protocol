# Field Mapping Profiles

Field mapping profiles enable the `ingest tiger` command to handle data sources with non-standard field schemas.

## Overview

Different data sources (VEST redistricting data, state-specific shapefiles, etc.) often use field names that don't match Census TIGER conventions. Field mapping profiles provide a declarative way to:

- **Rename fields**: Map source field names to canonical target names
- **Transform values**: Apply lookups, formulas, or concatenations
- **Generate computed fields**: Create new fields from existing data
- **Validate output**: Ensure mapped data meets schema requirements

## Available Profiles

### `vest-utah.json`

Maps Utah VEST 2020 redistricting data to standard TIGER schema.

**Non-standard fields:**
- `CountyID`: Sequential county number (1-29), not FIPS code
- `vistapre`: VISTA precinct identifier (e.g., "BV01", "SL203")

**Transformations:**
- `CountyID` → `countyFips` via lookup table (e.g., 1→001, 18→035)
- `vistapre` → `localPrecinct` (simple rename)
- Generates `GEOID` by concatenating state FIPS + county FIPS + precinct

**Usage:**
```bash
shadow-atlas ingest tiger --layer vtd --state 49 --schema-profile vest-utah
```

## Creating Custom Profiles

### Profile Structure

```json
{
  "version": "1.0.0",
  "description": "Human-readable description",
  "source": {
    "name": "Data source name",
    "url": "https://source-url.org",
    "notes": "Additional context"
  },
  "fields": {
    "sourceField": "targetField"
  },
  "transforms": {
    "targetField": {
      "type": "constant|lookup|formula|concat",
      ...
    }
  },
  "validation": {
    "requiredFields": ["field1", "field2"],
    "skipInvalid": false
  }
}
```

### Transform Types

#### 1. Constant Transform

Set a field to a constant value.

```json
{
  "stateFips": {
    "type": "constant",
    "value": "49"
  }
}
```

#### 2. Lookup Transform

Map source field values through a lookup table.

```json
{
  "countyFips": {
    "type": "lookup",
    "sourceField": "CountyID",
    "lookupTable": {
      "1": "001",
      "2": "003",
      "3": "005"
    },
    "defaultValue": "000"
  }
}
```

#### 3. Formula Transform

Compute values using JavaScript expressions.

```json
{
  "paddedId": {
    "type": "formula",
    "expression": "(CountyID * 2 - 1).toString().padStart(3, '0')",
    "sourceFields": ["CountyID"]
  }
}
```

**Available in expression context:**
- Source field values (as variables)
- `Math`, `String`, `Number`, `parseInt`, `parseFloat`
- No access to Node.js APIs (runs in isolated VM)

#### 4. Concatenation Transform

Concatenate multiple fields with optional separator.

```json
{
  "GEOID": {
    "type": "concat",
    "sourceFields": ["stateFips", "countyFips", "localPrecinct"],
    "separator": ""
  }
}
```

### Validation

Ensure mapped output meets schema requirements:

```json
{
  "validation": {
    "requiredFields": ["GEOID", "countyFips"],
    "skipInvalid": false
  }
}
```

- `requiredFields`: Fields that must be present after mapping
- `skipInvalid`: If `true`, skip features with mapping errors; if `false`, fail on first error

## Using Field Mappings

### Option 1: Named Profile

Use a built-in profile from this directory:

```bash
shadow-atlas ingest tiger \
  --layer vtd \
  --state 49 \
  --schema-profile vest-utah
```

### Option 2: Custom Mapping File

Provide a custom JSON mapping file:

```bash
shadow-atlas ingest tiger \
  --layer vtd \
  --state 49 \
  --field-mapping /path/to/custom-mapping.json
```

### With Output

Save the mapped GeoJSON to a file:

```bash
shadow-atlas ingest tiger \
  --layer vtd \
  --state 49 \
  --schema-profile vest-utah \
  --output utah-vtd-mapped.geojson
```

### Verbose Mode

See detailed mapping statistics and errors:

```bash
shadow-atlas ingest tiger \
  --layer vtd \
  --state 49 \
  --schema-profile vest-utah \
  --verbose
```

## Example: Utah VEST Mapping

**Before mapping** (original Utah VEST fields):
```json
{
  "properties": {
    "CountyID": 18,
    "vistapre": "SL203",
    "G20PRERTRU": 12345
  }
}
```

**After mapping** (standardized fields):
```json
{
  "properties": {
    "CountyID": 18,
    "vistapre": "SL203",
    "G20PRERTRU": 12345,
    "stateFips": "49",
    "countyFips": "035",
    "countyName": "Salt Lake",
    "localPrecinct": "SL203",
    "GEOID": "49035SL203"
  }
}
```

## Transformation Order

Transforms are automatically sorted to handle dependencies:

1. **Constant transforms** (no dependencies)
2. **Lookup transforms** (depend on source fields)
3. **Formula transforms** (depend on source fields)
4. **Concat transforms** (depend on previously transformed fields)

The field mapper analyzes dependencies and applies transforms in the correct order.

## Error Handling

### Mapping Errors

If a transformation fails:
- Error details include: field name, error message, source value
- With `skipInvalid: true`: Feature is skipped, processing continues
- With `skipInvalid: false` (default): Ingestion fails with detailed error

### Validation Errors

If output validation fails:
- All missing required fields are reported
- Feature is skipped if `skipInvalid: true`
- Ingestion fails if `skipInvalid: false`

## Best Practices

1. **Test with small datasets first**: Use `--verbose` to verify transformations
2. **Document non-standard schemas**: Add source URL and notes to profile
3. **Use descriptive field names**: Follow TIGER conventions where possible
4. **Validate required fields**: Ensure critical fields are present after mapping
5. **Handle missing data**: Provide `defaultValue` in lookup transforms
6. **Keep expressions simple**: Complex logic should be in source field cleanup

## Field Mapping Schema

See `/Users/noot/Documents/voter-protocol/packages/shadow-atlas/src/schemas/field-mapping.ts` for the complete TypeScript schema definition and type guards.
