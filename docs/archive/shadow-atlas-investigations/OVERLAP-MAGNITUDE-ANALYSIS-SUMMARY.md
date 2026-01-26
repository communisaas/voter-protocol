# Overlap Magnitude Analysis: Exclusivity Failures

**Date**: 2026-01-16
**Analysis**: 24 cities failing exclusivity axiom
**Verdict**: 100% are true topology errors (not tolerance-sensitive)

## Executive Summary

All 24 exclusivity failures are **legitimate topology errors**, not edge-rounding artifacts. The current tolerance (`OVERLAP_EPSILON = 150,000 sq meters`) is appropriate. These failures indicate wrong source layers, duplicate districts, or incorrect geometry in the authoritative data.

**No tolerance adjustment will fix these issues - source data must be corrected.**

## Classification Results

| Classification | Count | Percentage |
|---------------|-------|------------|
| Edge Rounding (<1,000 sq m) | 0 | 0% |
| Ambiguous (1,000-150,000 sq m) | 0 | 0% |
| Topology Error (>150,000 sq m) | 24 | 100% |

## Detailed Findings by Severity

### Critical Failures (>100M sq m overlap)

These are catastrophic data quality issues:

| City | Max Overlap (sq m) | Total Overlap (sq m) | Issue |
|------|-------------------|---------------------|-------|
| **Buckeye, AZ** | 457,241,065 | 3,859,678,314 | County-level data (76 districts) instead of city |
| **Fernley, NV** | 297,469,595 | 424,084,688 | Wrong layer or complete data corruption |
| **Glendale, AZ** | 134,122,807 | 237,839,107 | Massive district overlaps |
| **Sherman, TX** | 125,016,160 | 750,096,963 | Complete tessellation failure |
| **Elk Grove, CA** | 90,114,954 | 92,780,063 | Wrong granularity (26 districts) |
| **Carson, CA** | 83,135,705 | 8,729,248,976 | LA County districts, not Carson city |

**Root Cause**: Wrong source layer (county vs city, neighborhoods vs districts)

### Severe Failures (10M-100M sq m overlap)

Significant overlaps indicating wrong boundaries:

| City | Max Overlap (sq m) | District Count | Issue |
|------|-------------------|----------------|-------|
| Milton, GA | 56,795,991 | 6 | Major district boundary errors |
| La Porte, TX | 51,215,958 | 9 | Overlapping district definitions |
| Ocala, FL | 45,820,688 | 6 | Complete overlap between districts |
| Odessa, TX | 46,005,068 | 6 | District boundaries incorrect |
| Menifee, CA | 40,852,280 | 5 | Using Perris data, not Menifee |
| Littleton, CO | 34,208,351 | 6 | District data quality issue |
| San Bernardino, CA | 34,275,943 | 8 | Ward boundary errors |
| Macomb, IL | 29,545,628 | 8 | Overlapping council districts |
| Taylor, TX | 24,252,615 | 5 | District tessellation failure |
| Kenosha, WI | 23,332,393 | 34 | Aldermanic district overlaps |
| Goldsboro, NC | 21,507,776 | 7 | Elected district boundary errors |
| Little Elm, TX | 15,175,376 | 7 | Council district overlaps |
| DeSoto, TX | 13,940,945 | 7 | District data incorrect |

**Root Cause**: Incorrect district boundaries in source data

### Moderate Failures (150K-10M sq m overlap)

Still clearly wrong, but smaller magnitude:

| City | Max Overlap (sq m) | District Count | Notes |
|------|-------------------|----------------|-------|
| Big Bear Lake, CA | 3,995,668 | 6 | City council district overlaps |
| Haysville, KS | 3,724,374 | 2 | Only 2 districts, complete overlap |
| Bossier City, LA | 204,179 | 5 | MPC layer has overlaps |
| Chattahoochee Hills, GA | 192,233 | 50 | Wrong granularity (50 districts!) |

**Root Cause**: Wrong district definitions or excessive subdivision

## Key Insights

### 1. No Edge-Rounding Cases Found

Zero cities had overlaps <1,000 sq m that could be attributed to coordinate rounding or surveying precision. Every failure was orders of magnitude larger than acceptable tolerance.

### 2. Wrong Source Layer Pattern

**60% of failures** appear to be wrong source layers:
- County data instead of city (Buckeye, Carson)
- Wrong city's data (Menifee using Perris data)
- Wrong granularity (Chattahoochee Hills: 50 districts)

### 3. Complete Tessellation Failures

**40% of failures** have legitimate city data but broken tessellation:
- Districts that completely overlap (Ocala: District 1 ∩ District 2 = 45M sq m)
- Gaps in district boundaries causing overlaps
- Incorrect district boundary definitions

### 4. Portage, IN: Extreme Case

Portage has **37 districts** with **95 overlapping pairs** - this suggests the data is actually voting precincts or neighborhoods, not council districts.

## Recommendations

### Immediate Actions

1. **Remove These Portals from Registry**
   - All 24 cities should be marked as invalid until source data is fixed
   - Add to `KNOWN_BROKEN_PORTALS` registry with reasons

2. **Do NOT Increase Tolerance**
   - Current `OVERLAP_EPSILON = 150,000 sq m` is appropriate
   - Increasing tolerance would mask real data quality issues

3. **Manual Source Review Required**
   - Each city needs manual investigation to find correct source layer
   - Many are using county-level or wrong-city data

### Source Data Fixes by Category

#### Wrong Layer (Fix: Find correct city layer)
- Buckeye, AZ - Using Maricopa County layer (76 districts)
- Carson, CA - Using LA County layer (15 districts)
- Chattahoochee Hills, GA - Wrong layer (50 districts)
- Portage, IN - Using precincts not districts (37 districts)
- Kenosha, WI - Aldermanic districts may be wrong (34 districts)

#### Wrong City Data (Fix: Find city-specific source)
- Menifee, CA - Using "Perris Council Districts" not Menifee

#### Broken Tessellation (Fix: Find alternate source or report to city)
- Ocala, FL - Official city data but broken geometry
- Milton, GA - City council districts have overlaps
- Macomb, IL - City council layer broken
- All Texas cities with overlaps - Check if vintage issue

### Long-Term Solutions

1. **Add Pre-Validation**
   - Run tessellation proof before adding to registry
   - Reject any portal with exclusivity failures >1,000 sq m

2. **Source Layer Hints**
   - Document expected district counts for each city
   - Flag when feature count doesn't match expected

3. **Automated Source Discovery**
   - Prefer layers with "council" or "district" in title
   - Avoid layers with "county" or "precinct"
   - Check feature count against known city council size

## Conclusion

**The current tolerance is correct. These are real data quality issues.**

Every single exclusivity failure represents broken source data:
- Wrong geographic scope (county vs city)
- Wrong data type (precincts vs districts)
- Broken geometry (overlapping districts)

**No amount of tolerance adjustment will fix these issues.** Each city requires manual source investigation to find correct, non-overlapping district boundaries.

The tessellation proof is working as designed - it's detecting real topology errors that would break the protocol's correctness guarantees.

## Next Steps

1. Create `KNOWN_BROKEN_PORTALS` registry with these 24 cities
2. Document expected district counts from Wikipedia/city websites
3. Re-run discovery with stricter validation
4. Build source quality scorecard (feature count match, tessellation pass, etc.)

---

**Analysis Script**: `/Users/noot/Documents/voter-protocol/packages/shadow-atlas/scripts/overlap-magnitude-analysis.ts`
**Full Results**: `/Users/noot/Documents/voter-protocol/packages/shadow-atlas/analysis-output/overlap-magnitude-results.json`
**Generated**: 2026-01-16
