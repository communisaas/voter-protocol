# GEOID Reference Validation

**Implementation Status**: P1 Congressional Districts (CD) Complete
**Implementation Date**: 2025-12-31
**Data Vintage**: 2024 TIGER/Line (118th Congress apportionment)

## Overview

Validates TIGER/Line boundary data by comparing actual GEOIDs against canonical reference lists. This enables **specific missing boundary detection** (e.g., "Alabama CD-07 missing") rather than just count mismatches (e.g., "6/7 districts found").

## Problem Solved

**Before (Count-Only Validation)**:
```typescript
// Can only say "count mismatch"
❌ Incomplete: count mismatch (6/7, 85.7%) (Alabama)
```

**After (GEOID-Specific Validation)**:
```typescript
// Can say WHICH districts are missing
❌ Incomplete: missing GEOIDs: 0107 (Alabama)
```

## Architecture

### Components

1. **`geoid-reference.ts`** - Canonical GEOID lists per layer and state
2. **`tiger-validator.ts`** - Wires GEOID checking into completeness validation
3. **`generate-geoid-lists.sh`** - Script to generate GEOID lists from TIGER shapefiles

### Data Flow

```
TIGER Shapefile → validateCompleteness() → getMissingGEOIDs() → Error with specific GEOIDs
                                       ↓
                               getExtraGEOIDs() → Detect placeholders/duplicates
```

## Implementation Details

### Canonical GEOID Lists

**Congressional Districts (CD)** - COMPLETE ✅

- **Coverage**: All 56 jurisdictions (50 states + DC + 5 territories)
- **Total Districts**: 441 (435 voting + 6 non-voting delegates)
- **Format**: 4 digits SSDD (State FIPS + District)
- **Data Source**: 2020 Census apportionment (118th Congress)

**State Legislative Upper (SLDU)** - TODO 📋

- **Coverage**: 0/56 jurisdictions implemented
- **Total Districts**: ~1,972 state senate seats
- **Format**: 5 digits SSDDD (State FIPS + District)
- **Generation**: Use `./scripts/generate-geoid-lists.sh sldu <state-fips>`

**State Legislative Lower (SLDL)** - TODO 📋

- **Coverage**: 0/56 jurisdictions implemented
- **Total Districts**: ~5,411 state house seats
- **Format**: 5 digits SSDDD (State FIPS + District)
- **Generation**: Use `./scripts/generate-geoid-lists.sh sldl <state-fips>`

### GEOID Format Specifications

Layer | Format | Example | Description
------|--------|---------|-------------
CD | SSDD | `0107` | Alabama District 7
SLDU | SSDDD | `01035` | Alabama Senate District 35
SLDL | SSDDD | `01105` | Alabama House District 105
County | SSCCC | `01001` | Autauga County, AL

**Special Cases**:
- At-large states (AK, DE, ND, SD, VT, WY): District `00`
- DC: District `98` (non-voting delegate)
- Territories (AS, GU, MP, PR, VI): District `00`

## Usage

### Validate Completeness with GEOID Detection

```typescript
import { TIGERValidator } from '@voter-protocol/shadow-atlas';

const validator = new TIGERValidator();
const boundaries = [/* downloaded TIGER boundaries */];

const result = validator.validateCompleteness('cd', boundaries, '01'); // Alabama

if (!result.valid) {
  // Specific missing GEOIDs
  console.log('Missing:', result.missingGEOIDs); // ['0107']

  // Extra/placeholder GEOIDs
  console.log('Extra:', result.extraGEOIDs); // ['01ZZ']

  // Actionable error message
  console.log(result.summary);
  // ❌ Incomplete: missing GEOIDs: 0107 (Alabama)
}
```

### Direct GEOID Validation

```typescript
import { validateGEOIDCompleteness } from '@voter-protocol/shadow-atlas';

const actualGEOIDs = ['0101', '0102', '0103', '0104', '0105', '0106'];
const result = validateGEOIDCompleteness('cd', '01', actualGEOIDs);

console.log(result);
// {
//   valid: false,
//   missing: ['0107'],
//   extra: [],
//   expected: 7,
//   actual: 6
// }
```

### Generate GEOID Lists for New Layers

```bash
# Generate Alabama State Senate GEOIDs
./scripts/generate-geoid-lists.sh sldu 01

# Output (paste into geoid-reference.ts):
# '01': [
#   '01001',
#   '01002',
#   ...
#   '01035',
# ] as const,
```

## Benefits

1. **Actionable Errors**: "Alabama CD-07 missing" vs "count mismatch"
2. **Placeholder Detection**: Identifies ZZ, 00, 98, 99 phantom districts
3. **Duplicate Detection**: Flags duplicate GEOIDs in TIGER data
4. **Data Quality**: Catches specific gaps, not just counts

## Limitations

1. **SLDU/SLDL Not Yet Implemented**: Manual generation required per state
2. **No County/Place Lists**: Would require ~22,000+ GEOIDs (future work)
3. **Static Data**: Requires manual update after redistricting

## Testing

```bash
# Run GEOID reference tests
npm test -- geoid-reference.test.ts

# Test coverage:
# ✓ Congressional Districts (all 56 jurisdictions)
# ✓ At-large states (AK, DE, ND, SD, VT, WY)
# ✓ DC delegate (district 98)
# ✓ Territories (AS, GU, MP, PR, VI)
# ✓ Missing GEOID detection
# ✓ Extra GEOID detection
# ✓ Completeness validation
```

## Maintenance

### When to Update

**Congressional Districts (CD)**:
- After each decennial census redistricting (2032, 2042, etc.)
- Update GEOID lists to match new district boundaries

**State Legislative (SLDU/SLDL)**:
- Varies by state (most states redistrict after decennial census)
- Some states redistrict on different schedules

### How to Update

1. Download new TIGER/Line shapefiles
2. Run generation script:
   ```bash
   ./scripts/generate-geoid-lists.sh cd <state-fips>
   ```
3. Paste output into `geoid-reference.ts`
4. Run validation:
   ```bash
   npm test -- geoid-reference.test.ts
   ```

## Integration with Shadow Atlas

**Validation Pipeline**:
1. Download TIGER shapefile → Extract GEOIDs
2. `validateCompleteness()` → Check against canonical list
3. Missing GEOIDs → Halt build (ValidationHaltError)
4. Extra GEOIDs → Log warning (placeholders filtered)

**Merkle Tree Protection**:
- Missing boundaries break ZK proof generation
- GEOID validation catches this BEFORE Merkle tree insertion
- Prevents invalid data from entering production

## Future Work

### P2 Priorities

1. **State Legislative GEOIDs**: Generate SLDU/SLDL for all states
2. **County GEOIDs**: 3,143 counties (static, rarely change)
3. **Automated Generation**: CI/CD pipeline to update GEOIDs

### P3 Enhancements

1. **Place/CDP GEOIDs**: ~30,000 places (changes annually)
2. **Historical GEOIDs**: Support multiple redistricting vintages
3. **Diff Detection**: Detect GEOID changes between TIGER versions

## References

- **Census TIGER/Line**: https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html
- **Congressional Apportionment**: https://www.census.gov/data/tables/2020/dec/2020-apportionment-data.html
- **GEOID Format Specs**: TIGER/Line Technical Documentation (2024)

---

**Last Updated**: 2025-12-31
**Maintained By**: Shadow Atlas Team
**Data Vintage**: 2024 TIGER/Line
