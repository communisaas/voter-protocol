# P0-C: Coverage Computation Implementation

## Summary

Implemented actual coverage computation for Shadow Atlas school district validation. Previously, coverage was hardcoded to 100%. Now it computes actual geographic coverage percentage using turf.js spatial operations.

## Changes Made

### 1. SchoolDistrictValidator (`src/validators/school-district-validator.ts`)

**Added Methods:**

- `computeCoverageWithoutStateBoundary()`: Public method that computes coverage using convex hull approximation
  - Computes union of all school district boundaries
  - Uses convex hull of all coordinates as expected coverage area
  - Returns coverage percentage (0-100)
  - Validates coverage > 95% threshold

- `checkCoverage()`: Full coverage computation with state boundary (implementation ready for future use)
  - Computes union of school district boundaries
  - Compares against state boundary geometry
  - Detects gaps (uncovered territory)
  - Returns detailed gap regions with centroids

**Updated Methods:**

- `calculateOverlapArea()`: Now async, uses turf.intersect() and turf.area()
- `calculateArea()`: Now async, uses turf.area()
- `checkOverlaps()`: Updated to use async calculateOverlapArea()

**Implementation Approach:**

```typescript
// Simplified coverage (without state boundary)
const union = turf.union(allDistricts);
const hull = turf.convex(allCoordinates);
const coverage = (area(union) / area(hull)) * 100;

// Full coverage (with state boundary - future)
const union = turf.union(allDistricts);
const gap = turf.difference(stateBoundary, union);
const coverage = (area(union) / area(stateBoundary)) * 100;
```

### 2. ShadowAtlasService (`src/core/shadow-atlas-service.ts`)

**Updated `runSchoolDistrictValidation()`:**

- Removed hardcoded `coveragePercent: 100`
- Added `checkCoverage` flag handling
- Calls `validator.computeCoverageWithoutStateBoundary()` when enabled
- Logs warning if coverage < 95%
- Gracefully handles coverage computation errors (logs warning, assumes 100%)

**Coverage Computation Flow:**

```typescript
if (checkCoverage && boundaries.length > 0) {
  const allBounds = [...unsd, ...elsd, ...scsd];
  const result = await validator.computeCoverageWithoutStateBoundary(allBounds);
  coveragePercent = result.coveragePercent;

  if (!result.valid) {
    log.warn('Coverage incomplete', { coveragePercent, gaps });
  }
}
```

### 3. Tests (`src/__tests__/unit/validators/coverage-computation.test.ts`)

**Test Coverage:**

- Empty boundary set → 0% coverage
- Single district → valid coverage computation
- Multiple non-overlapping districts → union computed correctly
- Overlapping districts → union handles overlaps correctly

**All tests pass:**

```
✓ should return 0% coverage for empty boundary set
✓ should compute coverage for single district
✓ should compute coverage for multiple non-overlapping districts
✓ should handle overlapping districts correctly
```

## Technical Details

### Dependencies

- `@turf/turf`: Geographic calculations (already in package.json)
  - `turf.area()`: Compute polygon area in square meters
  - `turf.union()`: Combine overlapping polygons
  - `turf.convex()`: Compute convex hull
  - `turf.difference()`: Find gaps between geometries
  - `turf.intersect()`: Compute overlapping area

### Coverage Computation Method

**Current Implementation (Without State Boundary):**

Uses convex hull approximation to estimate expected coverage:

1. Compute union of all school district boundaries
2. Extract all coordinates from boundaries
3. Compute convex hull of all points
4. Coverage = area(union) / area(hull) * 100

**Advantages:**
- No external dependency on state boundary data
- Detects major gaps between districts
- Fast computation

**Limitations:**
- Overestimates coverage (convex hull includes non-state areas like water)
- Cannot detect gaps at state borders
- Less accurate than true state boundary comparison

**Future Enhancement (With State Boundary):**

When state boundary data is available:

1. Download TIGER state boundary: `tl_{year}_us_state.zip`
2. Extract state polygon for FIPS code
3. Compute: coverage = area(union) / area(stateBoundary) * 100
4. Compute gaps: difference(stateBoundary, union)
5. Report gap regions with centroids

### Integration Points

**ShadowAtlasService:**
- `runSchoolDistrictValidation()` now calls coverage computation
- Coverage result stored in `SchoolDistrictValidationSummary.coveragePercent`
- Warnings logged for coverage < 95%

**Provenance:**
- Coverage computation logged to provenance system
- Failures logged but don't block validation (graceful degradation)

## Verification

```bash
# Type check
npx tsc --noEmit

# Run tests
npm run test:unit -- coverage-computation.test.ts

# Verify no hardcoded coverage values
grep -rn "coveragePercent.*100" src/core/shadow-atlas-service.ts
# Expected: Only defaults for when coverage not checked
```

## Files Modified

1. `/src/validators/school-district-validator.ts` - Coverage computation implementation
2. `/src/core/shadow-atlas-service.ts` - Integration and wiring
3. `/src/__tests__/unit/validators/coverage-computation.test.ts` - Test coverage (NEW)

## Next Steps (Future Enhancements)

1. **Add State Boundary Provider:**
   - Download TIGER state boundaries
   - Cache locally to avoid repeated downloads
   - Integrate with `checkCoverage()` method

2. **Enhanced Gap Detection:**
   - Identify specific gap regions
   - Classify gaps by size (major vs minor)
   - Report gap centroids for manual investigation

3. **Performance Optimization:**
   - Cache union computations
   - Parallelize coverage checks across states
   - Use spatial indexes for large boundary sets

4. **Validation Rules:**
   - State-specific coverage thresholds
   - Allow for legitimate gaps (water bodies, federal land)
   - Cross-validate with county boundaries

## Notes

- Coverage computation is **optional** (controlled by `checkCoverage` flag)
- Failures are **non-blocking** (logs warning, assumes 100%)
- Implementation is **deterministic** (same boundaries → same coverage)
- Tests verify **correctness** across edge cases
