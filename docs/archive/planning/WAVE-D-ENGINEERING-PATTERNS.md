# Wave D: Engineering Pattern Analysis

## Strategic Overview

**81 remaining failures** decompose into three orthogonal problem classes:

| Class | Count | Pattern | Engineering Solution |
|-------|-------|---------|---------------------|
| **Source Mismatch** | 40 containment | Wrong GIS org → wrong data | ArcGIS org fingerprinting |
| **Topology Errors** | 24 exclusivity | Overlapping polygons | Tolerance analysis + repair |
| **Coverage Gaps** | 14 exhaustivity | Partial/extended coverage | At-large detection + source audit |

---

## Pattern 1: ArcGIS Organization Fingerprinting

**Insight**: ArcGIS URLs contain organization IDs that reveal data provenance.

```
https://services.arcgis.com/{ORG_ID}/arcgis/rest/services/...
```

**Known Metro Area Org IDs** (from prior analysis):
- `su8ic9KbA7PYVxPS` → City of Houston
- `g1fRTDLeMgspWrYp` → City of San Antonio
- `NummVBqZSIJKUeVR` → Houston metro region
- `fLeGjb7u4uXqeF9q` → Philadelphia region

**Detection Algorithm**:
1. Extract org ID from each portal URL
2. Map org IDs to known city/county GIS portals
3. Flag entries where org ID doesn't match FIPS city
4. Quarantine mismatches, find correct sources

**Scaling Potential**: One-time org ID mapping enables automated detection for all future entries.

---

## Pattern 2: Centroid Distance Clustering

**Insight**: Legitimate district data has centroids near city center. Wrong data has centroids far away.

**Quantitative Thresholds**:
- < 10km: Likely correct data
- 10-50km: Possible annexation edge case
- > 50km: Almost certainly wrong data source

**Implementation**:
```typescript
function computeCentroidDistance(districts: FeatureCollection, cityBoundary: Geometry): number {
  const districtCentroid = centroid(dissolve(districts));
  const cityCentroid = centroid(cityBoundary);
  return distance(districtCentroid, cityCentroid, { units: 'kilometers' });
}
```

**Triage Output**:
- `WRONG_SOURCE`: Distance > 50km → Quarantine
- `EDGE_CASE`: Distance 10-50km → Manual review
- `LIKELY_VALID`: Distance < 10km → Check other axioms

---

## Pattern 3: Exclusivity Tolerance Sensitivity

**Hypothesis**: Some exclusivity failures are legitimate shared-edge cases, not topology errors.

**Current Tolerance**: `OVERLAP_EPSILON = 150,000 sq meters`

**Analysis Needed**:
1. For each exclusivity failure, compute actual overlap area
2. Cluster by overlap magnitude:
   - < 1,000 sq m: Likely edge rounding (tolerance-fixable)
   - 1,000 - 150,000 sq m: Ambiguous (needs review)
   - > 150,000 sq m: True topology error (source problem)

**Potential Solutions**:
- Increase tolerance for small overlaps (risky)
- Implement edge-aware overlap detection (complex)
- Report overlaps but don't fail validation (pragmatic)

---

## Pattern 4: Coverage Gap Classification

**14 exhaustivity failures** split into distinct categories:

### Category A: Very Low Coverage (< 50%)
| City | Coverage | Likely Cause |
|------|----------|--------------|
| Sheridan, IN | 4.2% | Wrong data layer or at-large |
| Bridgeport, CT | 10.6% | Single district or partial |
| Meridian, ID | 40.0% | Partial district set |
| Lafayette, LA | 44.1% | Missing districts |
| Farmington, NM | 45.3% | Missing districts |

**Action**: Investigate if at-large, find correct sources.

### Category B: Near Threshold (68-85%)
| City | Coverage | Likely Cause |
|------|----------|--------------|
| Chandler, OK | 68.8% | Recent annexation not in data |
| Casper, WY | 74.1% | Boundary/district vintage mismatch |
| Provo, UT | 79.0% | Boundary/district vintage mismatch |
| Cedarburg, WI | 82.4% | Minor gaps (near passing) |
| Lake City, FL | 83.7% | Minor gaps (near passing) |
| Cheyenne, WY | 83.9% | Minor gaps (near passing) |

**Action**: Consider threshold adjustment OR accept as valid (within tolerance).

### Category C: Over Coverage (> 115%)
| City | Coverage | Likely Cause |
|------|----------|--------------|
| South Portland, ME | 116.5% | Districts extend into water/neighboring |
| Camden, NJ | 117.2% | Districts extend beyond boundary |
| Tuscaloosa, AL | 122.7% | County data used for city |

**Action**: Related to containment - wrong data source.

---

## State-Level Concentration Analysis

| State | Failures | Pattern |
|-------|----------|---------|
| **CA** | 14 | Metro bleeding (LA, San Diego, SF Bay) |
| **TX** | 10 | Metro bleeding (Houston, Dallas, Austin) |
| **IN** | 4 | Indianapolis metro + at-large candidates |
| **LA** | 4 | Mixed (city-parish complexity) |
| **WY** | 2 | Sparse population, at-large likely |

---

## Recommended Wave Structure

### Wave D-1: ArcGIS Org ID Mapping
- Extract org IDs from all 81 failing entries
- Build org ID → city/county mapping
- Identify mismatches for quarantine

### Wave D-2: Centroid Distance Triage
- Compute centroid distances for all 40 containment failures
- Cluster by distance threshold
- Prioritize wrong-source detection

### Wave D-3: Exclusivity Overlap Quantification
- Measure actual overlap areas for 24 exclusivity failures
- Classify by tolerance sensitivity
- Recommend tolerance vs source fixes

### Wave D-4: At-Large City Detection
- Research city charters for low-coverage cities
- Add to at-large registry if confirmed
- Remove from validation pool

---

## Files to Reference

```
src/core/registry/known-portals.ts           # Portal entries with URLs
src/core/registry/quarantined-portals.ts     # Already quarantined
src/core/registry/at-large-cities.ts         # At-large registry
src/validators/council/tessellation-proof.ts # Validation logic
src/validators/council/pre-validation-sanity.ts # Centroid checks
analysis-output/validation-2026-01-16.log    # Full validation output
```
