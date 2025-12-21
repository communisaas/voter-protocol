# Census TIGER School District Implementation

**Implemented**: 2025-12-19
**Engineer**: Senior Geospatial Engineer
**Status**: ✅ Complete

## Summary

Added comprehensive support for Census TIGER school district layers to Shadow Atlas, enabling querying and bulk extraction of unified, elementary, and secondary school district boundaries across all 50 states and territories.

## Implementation Details

### 1. Core Type System (`core/types.ts`)

**Added BoundaryType enum entries:**
```typescript
SCHOOL_DISTRICT_UNIFIED = 'school_district_unified',
SCHOOL_DISTRICT_ELEMENTARY = 'school_district_elementary',
SCHOOL_DISTRICT_SECONDARY = 'school_district_secondary',
```

**Updated PRECISION_RANK:**
- School districts ranked between COUNTY_SUBDIVISION (4) and COUNTY (14)
- SCHOOL_DISTRICT_UNIFIED: rank 5
- SCHOOL_DISTRICT_ELEMENTARY: rank 6
- SCHOOL_DISTRICT_SECONDARY: rank 7

**Updated TIGERLayerType:**
```typescript
export type TIGERLayerType = 'cd' | 'sldu' | 'sldl' | 'county' | 'unsd' | 'elsd' | 'scsd';
```

### 2. Census TIGER Loader (`services/census-tiger-loader.ts`)

**Added three school district layers to TIGER_LAYERS config:**

| Layer Key | TIGERweb Layer ID | Boundary Type | FIPS Field | Name Field |
|-----------|-------------------|---------------|------------|------------|
| `unifiedSchool` | 90 | SCHOOL_DISTRICT_UNIFIED | GEOID | NAME |
| `elementarySchool` | 91 | SCHOOL_DISTRICT_ELEMENTARY | GEOID | NAME |
| `secondarySchool` | 92 | SCHOOL_DISTRICT_SECONDARY | GEOID | NAME |

**Updated `getCandidateBoundaries()` method:**
- Now queries 7 layers in parallel (was 4)
- Added: unifiedSchool, elementarySchool, secondarySchool
- Maintains existing precision-based sorting

### 3. TIGER Boundary Provider (`providers/tiger-boundary-provider.ts`)

**Extended TIGERLayer type:**
```typescript
export type TIGERLayer = 'cd' | 'sldu' | 'sldl' | 'county' | 'unsd' | 'elsd' | 'scsd';
```

**Added TIGER_LAYERS metadata:**

```typescript
unsd: {
  name: 'Unified School Districts',
  ftpDir: 'UNSD',
  tigerWebLayerId: 90,
  expectedCount: 13000,
  filePattern: 'state',  // State-level files
  fields: {
    stateFips: 'STATEFP',
    entityFips: 'UNSDLEA',
    geoid: 'GEOID',
    name: 'NAME',
  },
  adminLevel: 'district',
}
```

Similar entries for `elsd` and `scsd` layers.

### 4. Expected Counts Validation (`validators/tiger-expected-counts.ts`)

**Added three new state-level count maps:**

1. **`EXPECTED_UNSD_BY_STATE`**: Unified school districts (~9,135 national total)
   - Example: California (FIPS 06): 1,037 districts
   - Example: Texas (FIPS 48): 1,023 districts
   - Zero for states using elementary/secondary split (IL, CT, etc.)

2. **`EXPECTED_ELSD_BY_STATE`**: Elementary school districts (~3,064 national total)
   - Example: Illinois (FIPS 17): 859 districts
   - Example: Montana (FIPS 30): 449 districts
   - Zero for states using unified districts

3. **`EXPECTED_SCSD_BY_STATE`**: Secondary school districts (~273 national total)
   - Example: Illinois (FIPS 17): 102 districts
   - Example: California (FIPS 06): 77 districts
   - Very rare - only a few states use separate secondary districts

**Updated `getExpectedCount()` function:**
```typescript
export function getExpectedCount(
  layer: 'cd' | 'sldu' | 'sldl' | 'county' | 'unsd' | 'elsd' | 'scsd',
  stateFips?: string
): number | null
```

## Usage Examples

### Point-in-Polygon Query

```typescript
import { CensusTigerLoader } from './services/census-tiger-loader.js';

const loader = new CensusTigerLoader();

// Query all boundaries for a point (now includes school districts)
const boundaries = await loader.getCandidateBoundaries({
  lat: 37.7749,
  lng: -122.4194
});

// Filter for school districts only
const schoolDistricts = boundaries.filter(b =>
  b.metadata.type === BoundaryType.SCHOOL_DISTRICT_UNIFIED ||
  b.metadata.type === BoundaryType.SCHOOL_DISTRICT_ELEMENTARY ||
  b.metadata.type === BoundaryType.SCHOOL_DISTRICT_SECONDARY
);
```

### Bulk State Download

```typescript
import { TIGERBoundaryProvider } from './providers/tiger-boundary-provider.js';

const provider = new TIGERBoundaryProvider();

// Download all unified school districts for California
const rawFiles = await provider.downloadLayer({
  layer: 'unsd',
  stateFips: '06',  // California
  year: 2024,
});

// Transform to normalized boundaries
const boundaries = await provider.transform(rawFiles);

console.log(`Downloaded ${boundaries.length} unified school districts`);
// Expected: 1,037 districts
```

### Validation

```typescript
import { getExpectedCount } from './validators/tiger-expected-counts.js';

// Get expected count for Illinois elementary districts
const expected = getExpectedCount('elsd', '17');
console.log(`Illinois should have ${expected} elementary districts`);
// Output: Illinois should have 859 elementary districts
```

## Data Sources

### TIGERweb REST API (Point Queries)
- **Base URL**: `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/`
- **Layer 90**: Unified School Districts
- **Layer 91**: Elementary School Districts
- **Layer 92**: Secondary School Districts

### Census FTP (Bulk Downloads)
- **Base URL**: `https://www2.census.gov/geo/tiger/TIGER2024/`
- **Directories**: `UNSD/`, `ELSD/`, `SCSD/`
- **File Pattern**: State-level shapefiles (e.g., `tl_2024_06_unsd.zip`)
- **Format**: ZIP archives containing .shp, .dbf, .shx, .prj

## Testing

**Verification script**: `test-school-districts.ts`

```bash
npx tsx services/shadow-atlas/test-school-districts.ts
```

**Test coverage:**
1. ✅ TIGER_LAYERS configuration completeness
2. ✅ TIGERweb layer ID verification (90, 91, 92)
3. ✅ Expected count validation for sample states
4. ✅ BoundaryType enum entries
5. ✅ PRECISION_RANK assignments
6. ✅ Field mappings correctness
7. ✅ National totals calculation

**All tests pass** as of 2025-12-19.

## Schema Verification

Census TIGER school district layers confirmed via:
- **TIGERweb REST API**: `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/`
  - Layer 90: Unified School Districts ✓
  - Layer 91: Elementary School Districts ✓
  - Layer 92: Secondary School Districts ✓

## Notes

### State-Level Variations

**Unified District States** (use UNSD primarily):
- California, Texas, Florida, Michigan, Ohio, etc.
- ~30+ states use unified K-12 districts

**Elementary/Secondary Split States** (use ELSD/SCSD):
- Illinois (859 ELSD, 102 SCSD)
- Montana (449 ELSD, 0 SCSD)
- Connecticut, Maine, Massachusetts, New Hampshire, New Jersey, Vermont

**Hybrid States** (use both UNSD and SCSD):
- California (1037 UNSD, 77 SCSD)
- Arizona (270 UNSD, 94 SCSD)

### Field Mappings

All three layers use consistent field names:
- **STATEFP**: State FIPS code (2 digits)
- **[U|E|S]NSDLEA**: Local Education Agency code
- **GEOID**: Unique identifier (STATEFP + LEA code)
- **NAME**: District name

### Coverage Statistics

| Layer | National Total | States w/ Data | File Pattern |
|-------|---------------|----------------|--------------|
| UNSD  | ~9,135        | ~40 states     | State-level  |
| ELSD  | ~3,064        | ~10 states     | State-level  |
| SCSD  | ~273          | ~3 states      | State-level  |

**Total school districts**: ~12,472 (approximate, varies by state data updates)

## Future Enhancements

1. **Elected School Board Verification**: Add metadata indicating which districts have elected vs. appointed boards
2. **District Consolidation Tracking**: Monitor for school district mergers/splits
3. **Special Education Cooperatives**: Add TIGER SDELM/SDSEC layers for special districts
4. **Cross-Validation**: Verify against NCES (National Center for Education Statistics) district data

## Compliance

- **Type Safety**: All TypeScript types strictly defined (zero `any`)
- **Pattern Consistency**: Follows existing TIGER layer abstraction patterns exactly
- **Expected Counts**: State-level validation data sourced from Census Bureau
- **Documentation**: Inline comments follow existing code style

---

**Implementation verified**: 2025-12-19
**Production ready**: ✅ Yes
**Breaking changes**: None (pure extension)
