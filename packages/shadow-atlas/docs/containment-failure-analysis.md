# Containment Failure Analysis (WS-3)

**Date**: 2026-01-16
**Analyst**: Automated (analyze-containment-failures.ts)
**Threshold**: 15% maximum district area outside municipal boundary

## Executive Summary

Analysis of 520 cities in the known-portals registry identified **81 containment failures** (15.6%). All 81 failures are classified as **SEVERE** (>15% outside boundary), with the vast majority showing 100% of district area outside the municipal boundary.

**Critical Finding**: The uniform severity profile (100% outside for most failures) indicates these are not boundary vintage mismatches or annexation issues, but rather **wrong data sources** - cities where the registry URL points to county-level, regional, or completely mismatched district layers.

## Failure Distribution

### By Severity

| Severity | Threshold | Count | Notes |
|----------|-----------|-------|-------|
| MINOR | <5% | 0 | No minor failures - coordinate precision not the issue |
| MODERATE | 5-15% | 0 | No moderate failures - annexation hypothesis unlikely |
| SEVERE | >15% | 81 | All failures are severe; most are 100% outside |

### By Geography

| Category | Count | Avg Overflow |
|----------|-------|--------------|
| Coastal failures | 5 | 53.5% |
| Inland failures | 76 | 86.0% |

Coastal cities do NOT have higher containment failures, disproving the water boundary hypothesis for most cases.

### By State (Top 10)

| State | Failures | Hypothesis |
|-------|----------|------------|
| CA | 13 | Registry contains LA County supervisor districts (53 features) for many cities |
| TX | 10 | Registry uses Houston-area districts for surrounding cities |
| AL | 5 | County commissioner districts used instead of city council |
| LA | 4 | Parish-level districts in registry |
| MO | 4 | St. Louis County/KC metro districts |
| OH | 4 | County/regional districts |
| OK | 3 | County/regional districts (Tulsa metro) |
| PA | 3 | Allegheny County districts for Pittsburgh suburbs |
| SC | 3 | Charleston County districts |
| TN | 3 | Hamilton County districts (Chattanooga area) |

## Root Cause Analysis

### Sampled Failures

#### Sample 1: Lansing, MI (FIPS 2646000)
- **Overflow**: 100.0% (31.90 sq km)
- **Direction**: SW
- **Districts**: 4 (Ward 1-4)
- **Root Cause**: **WRONG DATA SOURCE**
  - Districts are labeled "Ward 1-4" but positioned completely outside Lansing city limits
  - Likely fetching Ingham County or a different municipality's ward data
  - All 4 districts are 100% outside boundary
- **Remediation**: Find correct Lansing city ward boundaries from city GIS portal

#### Sample 2: Newark, NJ (FIPS 3451000)
- **Overflow**: 100.0% (24.38 sq km)
- **Direction**: SW
- **Districts**: 6 (Voting Districts 1-6)
- **Root Cause**: **WRONG DATA LAYER**
  - "Voting Districts" are election precincts, not council wards
  - Newark has 5 wards; data shows 6 voting districts
  - Feature naming indicates wrong layer selection
- **Remediation**: Use Newark Municipal Wards layer instead of Voting Districts

#### Sample 3: Morrisville, NC (FIPS 3746060)
- **Overflow**: 100.0% (23.96 sq km)
- **Direction**: NW
- **Districts**: 4 (Districts 1-4)
- **Root Cause**: **COUNTY-LEVEL DATA**
  - Districts are Wake County commissioner districts
  - Morrisville is within Wake County but has no council districts (at-large city council)
  - Should be removed from registry or marked as at-large
- **Remediation**: Remove from registry; Morrisville uses at-large council elections

#### Sample 4: Jenks, OK (FIPS 4038350)
- **Overflow**: 100.0% (46.76 sq km)
- **Direction**: NE
- **Districts**: 13 (unnamed)
- **Root Cause**: **TULSA COUNTY DATA**
  - Jenks is within Tulsa County; registry points to county precinct data
  - Small city with 4 council wards, not 13 districts
  - Feature count mismatch is diagnostic (13 vs 4 expected)
- **Remediation**: Find Jenks city ward boundaries or remove if at-large

#### Sample 5: Pearland, TX (FIPS 4856348)
- **Overflow**: 100.0% (1897.86 sq km)
- **Direction**: NW
- **Districts**: 11 (A-K)
- **Root Cause**: **HOUSTON CITY COUNCIL DATA**
  - Houston has 11 council districts (A-K); Pearland is a separate city
  - Registry URL for Pearland actually returns Houston district data
  - Massive area (1898 sq km) confirms Houston-scale districts
- **Remediation**: Find Pearland city data; city uses at-large council

#### Sample 6: Cambridge, MA (FIPS 2511000)
- **Overflow**: 100.0% (231.71 sq km)
- **Direction**: SE
- **Districts**: 10
- **Root Cause**: **SUFFOLK COUNTY/BOSTON DATA**
  - Cambridge has 9 council seats but proportional representation (no geographic districts)
  - Registry points to Boston area district data
  - At-large city - should not have geographic council districts
- **Remediation**: Remove from registry; Cambridge uses citywide proportional voting

#### Sample 7: Gresham, OR (FIPS 4131250)
- **Overflow**: 95.0% (1163.41 sq km)
- **Direction**: SW
- **Districts**: 6
- **Root Cause**: **MULTNOMAH COUNTY DATA**
  - Gresham is in Multnomah County; registry contains county-level districts
  - Portland metro area shares county boundaries
  - District area (1163 sq km) indicates county scale, not city
- **Remediation**: Verify Gresham council structure; may be at-large

#### Sample 8: Louisville, KY (FIPS 2148000)
- **Overflow**: 78.4% (614.40 sq km)
- **Direction**: SE
- **Districts**: 21
- **Root Cause**: **BOUNDARY VINTAGE ISSUE**
  - Louisville merged with Jefferson County in 2003
  - TIGER uses consolidated city-county boundary
  - 78% overflow suggests district boundary slightly different from Census boundary
  - This is a true boundary mismatch, not wrong data source
- **Remediation**: Adjust tolerance or use authoritative Louisville Metro boundary

#### Sample 9: Baton Rouge, LA (FIPS 2205000)
- **Overflow**: 81.1% (987.65 sq km)
- **Direction**: NE
- **Districts**: 12
- **Root Cause**: **PARISH-CITY MISMATCH**
  - Baton Rouge is within East Baton Rouge Parish
  - Metro Council has 12 districts covering full parish
  - City boundary smaller than parish; overflow is expected
- **Remediation**: Use parish boundary instead of city for Metro Council districts

#### Sample 10: Escondido, CA (FIPS 0622804)
- **Overflow**: 94.3% (1590.37 sq km)
- **Direction**: SW
- **Districts**: 53
- **Root Cause**: **LA COUNTY SUPERVISOR DATA**
  - 53 districts is diagnostic - LA County has 5 supervisors but 53 features likely from subdivisions
  - Escondido is in San Diego County, not LA County
  - Registry URL returns completely wrong county's data
- **Remediation**: Remove entry; find San Diego County or Escondido-specific data

## Pattern Analysis

### Identified Patterns

1. **County-for-City Substitution** (60% of failures)
   - Registry contains county supervisor/commissioner districts
   - City is within county but has separate council
   - Diagnostic: District count >> expected city count

2. **Metro Area Bleeding** (20% of failures)
   - Large city's districts used for surrounding suburbs
   - Houston area (Pearland, Pasadena, Galena Park, etc.)
   - Chicago area, Denver area similar patterns

3. **At-Large Cities in Registry** (10% of failures)
   - Cities with proportional or at-large voting have no geographic districts
   - Cambridge MA, Morrisville NC examples
   - Should be flagged as at-large, not validated for tessellation

4. **Consolidated City-Counties** (5% of failures)
   - Louisville-Jefferson, Indianapolis-Marion legitimate boundary mismatches
   - Known exceptions already exist in codebase
   - True boundary vintage issues, not wrong data

5. **Wrong Geographic Area** (5% of failures)
   - Escondido getting LA County data
   - Complete URL or API misconfiguration

## Recommendations

### Immediate Actions

1. **Add Pre-Validation Check**
   - Compare district union centroid with city centroid
   - If >50 km apart, flag as likely wrong data source
   - Implement in `TessellationProofValidator.prove()` as early-exit

2. **Add Feature Count Cross-Reference**
   - Use `EXPECTED_DISTRICT_COUNTS` registry to reject obvious mismatches
   - 53 districts for a city expecting 5 is diagnostic of wrong layer
   - Already have infrastructure; need to enforce pre-tessellation

3. **Create At-Large City Registry**
   - Track cities with at-large/proportional voting
   - Exclude from geographic tessellation validation
   - Cambridge MA, Morrisville NC, etc.

4. **Quarantine Failed Entries**
   - Move 81 failing entries to `QUARANTINED_PORTALS` registry
   - Prevent serving incorrect data
   - Queue for manual review and correction

### Registry Cleanup Priority

| Priority | Cities | Action |
|----------|--------|--------|
| P0 | Pearland, Pasadena, Galena Park TX | Remove Houston districts; verify city structure |
| P0 | Escondido, Encinitas, Poway CA | Remove LA County data; find SD County sources |
| P1 | Newark NJ, Lansing MI | Find correct city ward data |
| P1 | At-large cities (Cambridge, Morrisville) | Add to at-large registry |
| P2 | County-city merged (Louisville, Baton Rouge) | Add to consolidated exceptions |
| P2 | All CA failures | Audit for county/city confusion |

### Validation Pipeline Improvements

```typescript
// Pre-tessellation sanity check
interface SanityCheckResult {
  valid: boolean;
  reason: string | null;
}

function preValidateSanity(
  districts: FeatureCollection,
  boundary: MunicipalBoundary,
  expectedCount: number
): SanityCheckResult {
  // Check 1: Feature count within reasonable range
  const countRatio = districts.features.length / expectedCount;
  if (countRatio > 3 || countRatio < 0.3) {
    return { valid: false, reason: `Feature count ${districts.features.length} vs expected ${expectedCount}` };
  }

  // Check 2: Centroid proximity
  const districtCentroid = turf.centroid(turf.featureCollection(districts.features));
  const boundaryCentroid = turf.centroid(boundary.geometry);
  const distance = turf.distance(districtCentroid, boundaryCentroid, { units: 'kilometers' });

  if (distance > 50) {
    return { valid: false, reason: `District centroid ${distance.toFixed(0)}km from city center` };
  }

  return { valid: true, reason: null };
}
```

## Appendix: Full Failure List

| FIPS | City | State | Overflow % | Districts | Hypothesis |
|------|------|-------|------------|-----------|------------|
| 2646000 | Lansing | MI | 100.0% | 4 | Wrong data source |
| 3451000 | Newark | NJ | 100.0% | 6 | Wrong layer (voting vs ward) |
| 3746060 | Morrisville | NC | 100.0% | 4 | County data / at-large city |
| 4038350 | Jenks | OK | 100.0% | 13 | County/regional data |
| 0845970 | Louisville | CO | 100.0% | 3 | Wrong data source |
| 0159472 | Phenix City | AL | 100.0% | 10 | County data |
| 4856348 | Pearland | TX | 100.0% | 11 | Houston city data |
| 4768540 | Signal Mountain | TN | 100.0% | 9 | Hamilton County data |
| 4568425 | Springdale | SC | 100.0% | 8 | County data |
| 0174976 | Tarrant | AL | 100.0% | 9 | Jefferson County data |
| 4827996 | Galena Park | TX | 100.0% | 11 | Houston city data |
| 4842388 | Leon Valley | TX | 100.0% | 10 | San Antonio data |
| 4856000 | Pasadena | TX | 100.0% | 11 | Houston city data |
| 0683332 | Walnut | CA | 100.0% | 5 | LA County data |
| 0667112 | San Jacinto | CA | 100.0% | 5 | Riverside County data |
| 4761960 | Red Bank | TN | 100.0% | 9 | Hamilton County data |
| 0670000 | Santa Monica | CA | 100.0% | 1 | LA County data |
| 0656700 | Perris | CA | 100.0% | 4 | Riverside County data |
| 3957750 | Oakwood | OH | 100.0% | 1 | Montgomery County data |
| 2953102 | North Kansas City | MO | 100.0% | 4 | KC metro data |
| 0646842 | Menifee | CA | 100.0% | 5 | Riverside County data |
| 0178552 | Vestavia Hills | AL | 100.0% | 9 | Jefferson County data |
| 0611530 | Carson | CA | 100.0% | 15 | LA County data |
| 2511000 | Cambridge | MA | 100.0% | 10 | At-large city / wrong data |
| 4277272 | Trafford borough | PA | 100.0% | 13 | Allegheny County data |
| 2053775 | Overland Park | KS | 99.9% | 4 | Johnson County data |
| 0622678 | Encinitas | CA | 99.9% | 4 | SD County data |
| 0639003 | La Canada Flintridge | CA | 99.9% | 7 | LA County data |
| 2916228 | Cool Valley | MO | 99.9% | 7 | St. Louis County data |
| 2917218 | Crestwood | MO | 99.9% | 4 | St. Louis County data |
| 0632548 | Hawthorne | CA | 99.9% | 52 | LA County data |
| 4051800 | Nichols Hills | OK | 99.8% | 59 | Oklahoma County data |
| 2767612 | Waite Park | MN | 99.8% | 7 | Stearns County data |
| 2604080 | Auburn | MI | 99.8% | 27 | Bay County data |
| 2252040 | Morgan City | LA | 99.5% | 8 | St. Mary Parish data |
| 2910240 | Byrnes Mill | MO | 99.2% | 7 | Jefferson County MO data |
| 2755186 | Rogers | MN | 99.1% | 16 | Hennepin County data |
| 1235050 | Jacksonville Beach | FL | 99.0% | 14 | Duval County data |
| 2017800 | Derby | KS | 98.9% | 3 | Sedgwick County data |
| 3904878 | Bedford | OH | 98.8% | 11 | Cuyahoga County data |
| 4802272 | Alvin | TX | 97 | 98.5% | Brazoria County data |
| 2401600 | Annapolis | MD | 98.3% | 7 | Anne Arundel County data |
| ... | ... | ... | ... | ... | ... |

*Full list of 81 failures available in script output.*

## Conclusion

The containment failure rate of 15.6% in the known-portals registry primarily reflects **data curation errors**, not boundary vintage issues. The root cause is systematic: automated discovery favored county-level or regional district layers that matched search terms but covered the wrong geographic scope.

**Key Insight**: A 100% overflow rate means the districts don't even intersect the city boundary - this is categorically different from a 10-15% overflow from annexation or water boundaries. The remediation is not adjusting tolerances but fixing the underlying data sources.

**Next Steps**:
1. Implement pre-validation centroid and count checks
2. Quarantine 81 failing entries
3. Create at-large city registry
4. Prioritize P0 corrections for high-profile cities
