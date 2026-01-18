# Water Area Coverage Analysis (WS-5)

## Summary

Analysis of how water area affects council district tessellation validation. Many coastal and waterfront cities have districts that extend into water bodies (bays, rivers, lakes). The TIGER Census API provides both ALAND (land area) and AWATER (water area).

**Key Finding**: Coastal cities (>10% water) have a **higher** pass rate (61.5%) than inland cities (40.5%). The current water handling in `tessellation-proof.ts` is working correctly.

## Background

### The Problem
- TIGER Census provides ALAND (land area) and AWATER (water area) separately
- Council districts often include jurisdictional waters (harbors, bays)
- Coverage calculated against land-only area can exceed 100% for coastal cities
- San Francisco: 46.68 sq mi land, 185.21 sq mi water - districts extend into bay

### Current Implementation (tessellation-proof.ts)

The validator already handles water areas correctly:

```typescript
// Constants from tessellation-proof.ts
const GEOMETRY_TOLERANCE = {
  COVERAGE_THRESHOLD: 0.85,              // 85% minimum coverage
  MAX_COVERAGE_THRESHOLD: 1.15,          // 115% max for inland
  MAX_COVERAGE_THRESHOLD_COASTAL: 2.00,  // 200% max for coastal
  COASTAL_WATER_RATIO: 0.15,             // 15% water = coastal city
};
```

The `prove()` method:
1. Receives `landAreaSqM` and `waterAreaSqM` from boundary resolver
2. Calculates water ratio: `waterAreaSqM / (landAreaSqM + waterAreaSqM)`
3. Applies coastal threshold (200%) when water ratio > 15%
4. Uses city-specific exceptions for extreme cases (San Francisco at 350%)

## Analysis Results

### Dataset
- **Total cities analyzed**: 100 (from known-portals registry)
- **Coastal cities** (>10% water): 26
- **Inland cities** (<10% water): 74

### Validation Pass Rates

| Category | Passed | Total | Pass Rate |
|----------|--------|-------|-----------|
| Coastal  | 16     | 26    | **61.5%** |
| Inland   | 30     | 74    | 40.5%     |

**Coastal cities pass at a higher rate**, suggesting the current water-aware thresholds are appropriate.

### Average Water Percentage

| Category | Avg Water % |
|----------|-------------|
| Coastal  | 31.3%       |
| Inland   | 2.6%        |

### Coverage Difference (Land-only vs Total Area)

When districts include water, the land-only coverage ratio is higher than total coverage:

| Category | Avg Difference |
|----------|----------------|
| Coastal  | 340.66 pp      |
| Inland   | 3.70 pp        |

This large difference for coastal cities confirms that districts frequently extend into water areas.

### Failure Breakdown by Axiom

| Axiom | Coastal Failures | Inland Failures |
|-------|------------------|-----------------|
| Exhaustivity | 6 | 30 |
| Containment | 4 | 11 |
| Exclusivity | 0 | 3 |

Inland cities fail more often on exhaustivity (low coverage), while coastal failures are split between exhaustivity and containment.

### Pass Rate by Water Percentage Bucket

| Water % Range | Cities | Passed | Pass Rate |
|---------------|--------|--------|-----------|
| 0-5%          | 60     | 22     | 36.7%     |
| 5-10%         | 14     | 8      | 57.1%     |
| 10-20%        | 8      | 5      | 62.5%     |
| 20-30%        | 5      | 3      | 60.0%     |
| 30-50%        | 9      | 6      | 66.7%     |
| 50%+          | 4      | 2      | 50.0%     |

**No negative correlation** between water percentage and validation failures.

## High-Water Cities

Cities with >10% water area, sorted by water percentage:

| FIPS | City | State | Water % | Land Coverage | Status |
|------|------|-------|---------|---------------|--------|
| 15003 | Honolulu County | HI | 72.3% | 36.4% | FAIL |
| 1235050 | Jacksonville Beach | FL | 66.7% | 11621.1% | FAIL |
| 22051 | Jefferson Parish | LA | 53.1% | 172.8% | PASS |
| 15009 | Maui County | HI | 51.6% | 101.4% | PASS |
| 22045 | Iberia Parish | LA | 44.8% | 179.6% | PASS |
| 22109 | Terrebonne Parish | LA | 40.9% | 169.3% | PASS |
| 1077580 | Wilmington | DE | 36.6% | 154.0% | PASS |
| 1245000 | Miami | FL | 35.8% | 155.7% | PASS |
| 45019 | Charleston County | SC | 32.8% | 149.3% | PASS |
| 1150000 | Washington | DC | 10.6% | 112.0% | PASS |

## Failed Coastal Cities (Investigation Notes)

### Honolulu County, HI (15003)
- **Water**: 72.3%
- **Issue**: District data only covers 36.4% of land
- **Diagnosis**: District data appears incomplete or from wrong layer
- **Not a water handling issue** - districts don't cover enough area

### Jacksonville Beach, FL (1235050)
- **Water**: 66.7%
- **Issue**: 11621% coverage, 99% outside boundary
- **Diagnosis**: District data is from wrong jurisdiction (full Duval County?)
- **Not a water handling issue** - wrong source data

### Essex County, MA (25009)
- **Water**: 40.6%
- **Issue**: Only 1.7% coverage
- **Diagnosis**: District data is from single municipality, not county
- **Not a water handling issue** - wrong source data

## Recommendations

### No Changes Needed to tessellation-proof.ts

The current water handling is working correctly:

1. **COASTAL_WATER_RATIO (15%)** - Correctly identifies coastal cities
2. **MAX_COVERAGE_THRESHOLD_COASTAL (200%)** - Appropriate for most water-inclusive districts
3. **KNOWN_MAX_COVERAGE_EXCEPTIONS** - Handles extreme cases (SF at 350%)

### Root Causes of Coastal Failures

The failed coastal cities have **data quality issues**, not water handling issues:

| Issue | Examples |
|-------|----------|
| Wrong jurisdiction | Jacksonville Beach (Duval County data), Essex County (town data) |
| Incomplete data | Honolulu County (partial district set) |
| Layer mismatch | Bristol County MA (state boundary, not county) |

### Recommended Actions

1. **No validator changes** - Water handling is adequate
2. **Data quality fixes** for specific cities:
   - Honolulu County: Find complete district layer
   - Jacksonville Beach: Use city-specific data, not county
   - Massachusetts counties: Use correct county commissioner layers

## Script Usage

To re-run this analysis:

```bash
# Full analysis
npx tsx scripts/analyze-water-coverage.ts

# Limit to first N cities
npx tsx scripts/analyze-water-coverage.ts --limit 50

# Verbose output
npx tsx scripts/analyze-water-coverage.ts --verbose

# Only analyze coastal cities
npx tsx scripts/analyze-water-coverage.ts --coastal-only

# Custom water threshold
npx tsx scripts/analyze-water-coverage.ts --threshold 20
```

Output is written to `analysis-output/water-coverage-analysis.json`.

## Conclusion

**The current water-aware coverage calculation is working as designed.**

Coastal cities have a higher validation pass rate (61.5%) than inland cities (40.5%), indicating that:
1. The COASTAL_WATER_RATIO threshold (15%) correctly identifies water-heavy cities
2. The MAX_COVERAGE_THRESHOLD_COASTAL (200%) accommodates water-inclusive districts
3. The KNOWN_MAX_COVERAGE_EXCEPTIONS mechanism handles extreme cases

Failed coastal cities are failing due to **data quality issues** (wrong layer, wrong jurisdiction), not water calculation problems.
