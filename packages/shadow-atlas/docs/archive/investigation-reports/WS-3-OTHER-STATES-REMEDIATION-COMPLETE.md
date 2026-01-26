# WS-3 Containment Failure Remediation: Other States (Complete)

**Date**: 2026-01-16
**Scope**: Non-CA/TX containment failures from WS-3 analysis
**Status**: COMPLETE

## Executive Summary

Remediated 20 containment failures across AL, LA, MO, OH, MI, MN, NJ, OK, PA, SC, TN where the known-portals registry incorrectly contained county-level or regional district data instead of city council districts.

**Key Finding**: 1 legitimate exception identified (Baton Rouge city-parish consolidation) that should NOT be quarantined.

## Remediation Statistics

- **Total Failures Addressed**: 21
- **Entries Quarantined**: 20
- **Legitimate Exceptions**: 1 (Baton Rouge)
- **States Affected**: 11

## State-by-State Breakdown

### Alabama (3 quarantined)

| FIPS | City | Issue | Action |
|------|------|-------|--------|
| 0159472 | Phenix City | County commissioner districts (10 features) | QUARANTINED |
| 0174976 | Tarrant | Birmingham/Jefferson County districts (9 features) | QUARANTINED |
| 0178552 | Vestavia Hills | Birmingham/Jefferson County districts (9 features) | QUARANTINED |

### Louisiana (1 quarantined, 1 exception)

| FIPS | City | Issue | Action |
|------|------|-------|--------|
| 2252040 | Morgan City | St. Mary Parish districts (8 features) | QUARANTINED |
| **2205000** | **Baton Rouge** | **City-Parish Metro Council (12 districts)** | **EXCEPTED** (see docs/BATON_ROUGE_EXCEPTION.md) |

**Baton Rouge Exception**: Consolidated city-parish government since 2019. Metro Council represents entire East Baton Rouge Parish, not just city limits. 81.1% overflow is expected and correct.

### Missouri (4 quarantined)

| FIPS | City | Issue | Action |
|------|------|-------|--------|
| 2916228 | Cool Valley | St. Louis County districts (7 features) | QUARANTINED |
| 2917218 | Crestwood | St. Louis County districts via Sunset Hills (4 features) | QUARANTINED |
| 2910240 | Byrnes Mill | Jefferson County MO districts (7 features) | QUARANTINED |
| 2953102 | North Kansas City | Kansas City metro districts (4 features) | QUARANTINED |

### Michigan (2 quarantined)

| FIPS | City | Issue | Action |
|------|------|-------|--------|
| 2646000 | Lansing | Wards 100% outside city limits - misalignment | QUARANTINED |
| 2604080 | Auburn | Bay County voting districts (27 features) | QUARANTINED |

### Minnesota (2 quarantined)

| FIPS | City | Issue | Action |
|------|------|-------|--------|
| 2767612 | Waite Park | Stearns County/St. Cloud districts (7 features) | QUARANTINED |
| 2755186 | Rogers | Hennepin County/Met Council (16 features) | QUARANTINED |

### New Jersey (1 quarantined)

| FIPS | City | Issue | Action |
|------|------|-------|--------|
| 3451000 | Newark | Voting precincts (6) instead of wards (5) | QUARANTINED |

### Ohio (2 quarantined)

| FIPS | City | Issue | Action |
|------|------|-------|--------|
| 3904878 | Bedford | Cuyahoga County council (11 features) | QUARANTINED |
| 3957750 | Oakwood | Montgomery County district (1 feature) | QUARANTINED |

### Oklahoma (2 quarantined)

| FIPS | City | Issue | Action |
|------|------|-------|--------|
| 4038350 | Jenks | Tulsa County precincts (13 vs 4 expected wards) | QUARANTINED |
| 4051800 | Nichols Hills | Oklahoma County districts (59 features!) | QUARANTINED |

### Pennsylvania (1 quarantined)

| FIPS | City | Issue | Action |
|------|------|-------|--------|
| 4277272 | Trafford borough | Allegheny County/PA District 12 (13 features) | QUARANTINED |

### South Carolina (1 quarantined)

| FIPS | City | Issue | Action |
|------|------|-------|--------|
| 4568425 | Springdale | Charleston County districts (8 features) | QUARANTINED |

### Tennessee (2 quarantined)

| FIPS | City | Issue | Action |
|------|------|-------|--------|
| 4768540 | Signal Mountain | Hamilton County/Chattanooga (9 features) | QUARANTINED |
| 4761960 | Red Bank | Chattanooga city council (9 features, URL confirms) | QUARANTINED |

## Files Modified

1. **`src/core/registry/quarantined-portals.ts`**
   - Added 20 new quarantined entries with documented reasons
   - Updated QUARANTINE_COUNT
   - Updated QUARANTINE_SUMMARY with `containment-failure` pattern

2. **`docs/BATON_ROUGE_EXCEPTION.md`**
   - NEW: Documented legitimate city-parish consolidation exception
   - Explains why Baton Rouge should NOT be quarantined despite 81.1% overflow

3. **`src/core/registry/other-states-remediation-report.json`**
   - NEW: Detailed JSON report of all remediations
   - State-by-state breakdown with rationales

## Quarantine Rationales

All quarantined entries share common characteristics:

1. **100% or near-100% overflow** (districts completely outside city boundary)
2. **Feature count mismatch** (e.g., 59 features for small city)
3. **URL evidence** (URLs reference county/regional governments)
4. **Separate municipalities** (cities distinct from county government)

## Next Steps

### Immediate

- [x] Remove quarantined entries from `known-portals.ts`
- [x] Document Baton Rouge exception
- [x] Update quarantine registry
- [x] Create remediation report

### Data Acquisition (P1)

1. **High-Priority Cities** (population > 100k):
   - Newark, NJ (311k) - Find actual 5 ward boundaries
   - Lansing, MI (112k) - Correct ward alignment issues

2. **Medium-Priority Cities** (population 20k-100k):
   - Review for at-large council structures
   - Identify cities that should be removed entirely (no districts)

### Validation Infrastructure

1. Add Baton Rouge to `CONSOLIDATED_CITY_COUNTY_EXCEPTIONS` constant
2. Update containment validator to skip consolidated governments
3. Re-run WS-3 analysis to verify quarantine effectiveness
4. Expected outcome: Failure rate should drop from 15.6% to ~11-12% (CA/TX remain)

## Lessons Learned

### Pattern Recognition

1. **URL Analysis**: Many URLs clearly indicated wrong data (e.g., `Chattanooga_City_Council_Districts` for Red Bank)
2. **Feature Count**: Extreme mismatches (59 features for Nichols Hills) are diagnostic
3. **100% Overflow**: When districts don't even touch city boundary, it's always wrong data

### Consolidated Governments

Identified pattern: City-parish and city-county consolidations will ALWAYS show high overflow because:
- Census "place" boundary = city limits
- Governing body = full county/parish
- This is correct and should be excepted, not quarantined

### Similar Cases to Watch

- Indianapolis-Marion County (Unigov)
- Louisville-Jefferson County
- Nashville-Davidson County
- Jacksonville-Duval County

## Verification

### TypeScript Compilation

```bash
npx tsc --noEmit
# Result: No errors in quarantined-portals.ts
```

### Registry Integrity

- Quarantine count: 23 total (3 initial + 20 new)
- Pattern breakdown:
  - sewer: 1
  - pavement: 1
  - parcel: 1
  - containment-failure: 20

## References

- **WS-3 Analysis**: `docs/containment-failure-analysis.md`
- **Remediation Report**: `src/core/registry/other-states-remediation-report.json`
- **Baton Rouge Exception**: `docs/BATON_ROUGE_EXCEPTION.md`
- **Quarantine Registry**: `src/core/registry/quarantined-portals.ts`

---

**Remediation Complete**: 2026-01-16
**Analyst**: Manual review with automated validation
**Next Phase**: CA/TX remediation (13 + 10 failures remaining)
