# Exclusivity Failure Analysis (WS-4)

## Executive Summary

Analysis of 200 cities reveals that **13 cities (6.5%) fail the EXCLUSIVITY axiom** due to council district overlaps exceeding the current `OVERLAP_EPSILON` of 150,000 sq m. However, these failures fall into two distinct categories:

1. **True Data Errors (10 cities)**: Massive overlaps (100+ sq km) indicating wrong data layers or duplicate geometries
2. **Topology Issues (3 cities)**: Moderate overlaps (150k-500k sq m) at epsilon boundary

**Key Finding**: The median overlap area is only **230 sq m** (0.00023 sq km), and **82.7% of overlaps are edge-type** (elongated slivers). This confirms that most overlaps are precision artifacts at shared district boundaries, not data errors.

**Recommendation**: Do NOT increase `OVERLAP_EPSILON`. Instead, remediate the 10 cities with data errors by switching to correct data layers.

---

## Overlap Distribution

### By Size Category

| Category | Count | Percentage | Description |
|----------|-------|------------|-------------|
| MICRO (<1k sq m) | 352 | 64.7% | Edge/precision artifacts |
| SMALL (1k-10k sq m) | 60 | 11.0% | Minor topology errors |
| MEDIUM (10k-100k sq m) | 13 | 2.4% | Significant overlaps |
| LARGE (>100k sq m) | 119 | 21.9% | Data errors |

### Statistical Summary

| Metric | Value |
|--------|-------|
| Cities analyzed | 200 |
| Cities with any overlap | 98 (49%) |
| Cities failing exclusivity | 13 (6.5%) |
| Total overlapping pairs | 544 |
| Median overlap area | 230 sq m |
| 95th percentile | 18.7 sq km |
| Maximum overlap | 297 sq km |
| Edge overlaps | 82.7% |
| Interior overlaps | 17.3% |

---

## Root Cause Analysis

### Pattern 1: Mayor/At-Large Districts (7 cities)

Several cities include city-wide "Mayor" or "At-Large" districts that overlap with all geographic districts:

| City | State | FIPS | Overlap | Root Cause |
|------|-------|------|---------|------------|
| Maplewood, MN | MN | 2740166 | 2,148 sq km | At-Large districts overlap all wards |
| Mahtomedi, MN | MN | 2739878 | 703 sq km | At-Large districts overlap all wards |
| White Bear Lake, MN | MN | 2769700 | 640 sq km | At-Large districts overlap all wards |
| Fernley, NV | NV | 3224900 | 424 sq km | Mayor district overlaps all wards |
| Macomb, IL | IL | 1745889 | 175 sq km | At-Large 1, At-Large 2, Mayor overlap |
| Goldsboro, NC | NC | 3726880 | 77.6 sq km | Mayor district overlaps all |
| Haysville, KS | KS | 2031125 | 3.7 sq km | Unknown (only 2 features) |

**Fix**: These are NOT council district tessellations - they include non-geographic At-Large/Mayor seats. The data layer is wrong or needs filtering to exclude At-Large positions.

### Pattern 2: Wrong Data Layer (3 cities)

| City | State | FIPS | Overlap | Root Cause |
|------|-------|------|---------|------------|
| Portage, IN | IN | 1861092 | 225 sq km | 37 features - wrong granularity (precincts?) |
| Ocala, FL | FL | 1250750 | 124 sq km | District 1 overlaps with Districts 2,3,5 |
| Milton, GA | GA | 1351670 | 101 sq km | Districts labeled "1 x 1", "2 x 2" - duplicates |

**Fix**: Replace with correct council district layer from city GIS portal.

### Pattern 3: Topology Errors (3 cities)

| City | State | FIPS | Overlap | Root Cause |
|------|-------|------|---------|------------|
| Auburn, MI | MI | 2604080 | 2.2 sq km | Mixed city/township boundaries |
| Cambridge, MA | MA | 2511000 | 1.8 sq km | District 0 overlaps Districts 2,3,4 |
| Chattahoochee Hills, GA | GA | 1315552 | 0.23 sq km | 50 features - wrong layer (parcels?) |

**Fix**: Investigate data source and apply topology repair or use alternative source.

---

## Edge vs Interior Overlap Analysis

**82.7% of overlaps are edge-type** (elongated slivers at district boundaries).

This strongly indicates that most overlaps are:
- Surveying precision issues at shared boundaries
- Coordinate rounding artifacts
- Projection conversion errors

Only **17.3% are interior-type** (compact shapes suggesting actual data errors like duplicates).

### Implication for OVERLAP_EPSILON

The current epsilon of 150,000 sq m (37 acres) is appropriate for:
- Filtering out edge precision artifacts
- Accepting minor boundary misalignments

It should NOT be increased because:
- Large failures (100+ sq km) indicate data errors, not precision issues
- Increasing epsilon would mask legitimate data quality problems

---

## Sample Failure Analysis (Top 10)

### 1. Maplewood, MN (FIPS: 2740166)
- **Total Overlap**: 2,148 sq km
- **Pairs**: 21 overlapping pairs
- **Pattern**: At-Large districts overlap all geographic wards
- **Largest**: At-Large x At-Large (561 sq km)
- **Diagnosis**: DATA ERROR - At-Large seats included in district layer
- **Fix**: Filter to only geographic ward boundaries

### 2. Mahtomedi, MN (FIPS: 2739878)
- **Total Overlap**: 703 sq km
- **Pairs**: 15 overlapping pairs
- **Pattern**: All 7 districts overlap each other
- **Largest**: At-Large x At-Large (107 sq km)
- **Diagnosis**: DATA ERROR - Same pattern as Maplewood
- **Fix**: Use ward-only layer

### 3. White Bear Lake, MN (FIPS: 2769700)
- **Total Overlap**: 640 sq km
- **Pairs**: 15 overlapping pairs
- **Pattern**: At-Large districts
- **Diagnosis**: DATA ERROR - At-Large districts included
- **Fix**: Filter or use alternative source

### 4. Fernley, NV (FIPS: 3224900)
- **Total Overlap**: 424 sq km
- **Pairs**: 14 overlapping pairs
- **Pattern**: MAYOR district overlaps all wards
- **Largest**: Ward 2 x Mayor (297 sq km)
- **Diagnosis**: DATA ERROR - Mayor polygon covers entire city
- **Fix**: Remove Mayor feature from district set

### 5. Portage, IN (FIPS: 1861092)
- **Total Overlap**: 225 sq km
- **Pairs**: 87 overlapping pairs
- **Districts**: 37 features (far too many for council districts)
- **Diagnosis**: WRONG LAYER - Likely precincts or voting districts
- **Fix**: Find correct council district layer (expect 5-7 features)

### 6. Macomb, IL (FIPS: 1745889)
- **Total Overlap**: 175 sq km
- **Pairs**: 18 overlapping pairs
- **Pattern**: At-Large 1, At-Large 2, Mayor all overlap wards
- **Diagnosis**: DATA ERROR - Non-geographic seats included
- **Fix**: Remove At-Large and Mayor features

### 7. Ocala, FL (FIPS: 1250750)
- **Total Overlap**: 124 sq km
- **Pairs**: 10 overlapping pairs
- **Pattern**: District 1 overlaps Districts 2, 3, 5
- **Diagnosis**: DATA ERROR - District 1 geometry incorrect or different vintage
- **Fix**: Verify district boundaries from city source

### 8. Milton, GA (FIPS: 1351670)
- **Total Overlap**: 101 sq km
- **Pairs**: 11 overlapping pairs
- **Pattern**: "2 x 2", "1 x 1", "3 x 3" overlaps (self-overlaps!)
- **Diagnosis**: DATA ERROR - Duplicate features with same district ID
- **Fix**: Deduplicate features by district identifier

### 9. Goldsboro, NC (FIPS: 3726880)
- **Total Overlap**: 77.6 sq km
- **Pairs**: 7 overlapping pairs
- **Pattern**: Mayor district overlaps Districts 1, 2, 4
- **Diagnosis**: DATA ERROR - Mayor polygon covers city
- **Fix**: Remove Mayor feature

### 10. Haysville, KS (FIPS: 2031125)
- **Total Overlap**: 3.7 sq km
- **Pairs**: 1 overlapping pair
- **Districts**: Only 2 features
- **Diagnosis**: INCOMPLETE DATA - Missing most council districts
- **Fix**: Find complete district layer

---

## OVERLAP_EPSILON Recommendation

### Current Setting
```typescript
OVERLAP_EPSILON: 150_000  // ~37 acres, 150k sq m
```

### Analysis

| Epsilon Value | Cities Passing | Percentage |
|---------------|----------------|------------|
| 10,000 sq m | 188/200 | 94.0% |
| 50,000 sq m | 188/200 | 94.0% |
| 100,000 sq m | 189/200 | 94.5% |
| 150,000 sq m (current) | 187/200 | 93.5% |
| 200,000 sq m | 187/200 | 93.5% |
| 500,000 sq m | 188/200 | 94.0% |
| 1,000,000 sq m | 189/200 | 94.5% |

**Observation**: Increasing epsilon does not significantly increase pass rate because failing cities have overlaps in the millions of sq m range - true data errors.

### Recommendation: KEEP CURRENT EPSILON

**Do NOT increase OVERLAP_EPSILON.**

Rationale:
1. Current value correctly identifies data errors (At-Large districts, wrong layers)
2. Median overlap (230 sq m) is far below epsilon - good cities pass easily
3. Failing cities have fundamental data problems, not precision issues
4. Higher epsilon would mask legitimate data quality problems

---

## Remediation Plan

### Priority 1: Remove At-Large/Mayor Districts (7 cities)
For cities where At-Large or Mayor districts are included:
- Filter features to exclude "At-Large", "Mayor" in name fields
- Or find ward-only data layer from city GIS

**Cities**: Maplewood MN, Mahtomedi MN, White Bear Lake MN, Fernley NV, Macomb IL, Goldsboro NC, Haysville KS

### Priority 2: Replace Wrong Data Layers (3 cities)
For cities with wrong granularity or duplicate features:
- Research correct layer on city open data portal
- Replace URL in known-portals.ts

**Cities**: Portage IN, Ocala FL, Milton GA

### Priority 3: Topology Repair (3 cities)
For cities with moderate overlaps:
- Apply `turf.buffer(0)` to clean topology
- Or investigate source for cleaner data

**Cities**: Auburn MI, Cambridge MA, Chattahoochee Hills GA

---

## Conclusion

The exclusivity failures are **NOT caused by the OVERLAP_EPSILON being too low**. They are caused by:

1. **Wrong data** (At-Large/Mayor districts included in tessellation)
2. **Wrong layers** (precincts instead of council districts)
3. **Duplicate features** (same district ID appearing multiple times)

The fix is data remediation, not epsilon adjustment. The current epsilon of 150,000 sq m appropriately:
- Accepts small edge precision artifacts (median 230 sq m)
- Rejects true data errors (failures have 1M+ sq m overlaps)

### Next Steps
1. Update `known-portals.ts` to exclude At-Large/Mayor features
2. Replace wrong data layers for Portage IN, Ocala FL, Milton GA
3. Document cities requiring manual intervention in registry notes
