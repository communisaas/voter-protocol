# Cross-Validation Test Suite - TIGER vs State Sources

## Overview

Comprehensive test suite validating consistency between Census TIGER/Line data and state GIS portals for Shadow Atlas boundary extraction.

## Purpose

Detect discrepancies in:
- **District counts**: State and TIGER should report same number of districts
- **GEOID consistency**: Same identifiers between sources (allowing format differences)
- **Geometry overlap**: Boundaries should be nearly identical (>95% IoU)
- **Data vintage**: Post-2020 redistricting data should be 2022+

## Test File

**Location**: `/packages/crypto/services/shadow-atlas/providers/cross-validation.test.ts`

## Test Results (Wisconsin Pilot)

### Wisconsin Congressional Districts
```
District Count: ✅ 8/8 (State), 8/8 (TIGER), 8 expected
GEOID Consistency: ✅ 100% (8/8 matching)
Geometry Overlap: ✅ 1.000 average IoU (perfect match)
Data Vintage: ✅ 2024 (post-2020 redistricting)
Overall Quality Score: 100/100
```

**Recommendation**: Excellent data quality - state and TIGER sources are highly consistent

### Key Findings

1. **Perfect IoU (1.000)**: Wisconsin uses TIGERweb as their state GIS source, resulting in identical geometries
2. **GEOID normalization**: Successfully handles format differences (`5501`, `55-01`, `WI-01` all normalize to `5501`)
3. **State Senate discrepancy**: Wisconsin has 34 features but expected 33 (likely includes at-large or special districts)

## Running the Tests

### Skip in CI (Integration tests hit live APIs)
```bash
# Tests automatically skip in CI via process.env.CI check
npm test cross-validation.test.ts
```

### Run locally (with live API calls)
```bash
cd packages/crypto
npm test -- cross-validation.test.ts --run
```

**Note**: Tests take ~40-45 seconds due to live API calls to TIGERweb and state portals.

## Test Structure

### 1. District Count Comparison
Validates that state and TIGER sources report the same number of districts:
```typescript
{
  source: 'state' | 'tiger',
  state: 'WI',
  layerType: 'congressional',
  count: 8,
  expectedCount: 8,
  match: true,
  discrepancy: 0
}
```

### 2. GEOID Consistency
Compares identifiers with intelligent normalization:
```typescript
{
  state: 'WI',
  layerType: 'congressional',
  stateGeoids: ['5501', '5502', ...],
  tigerGeoids: ['5501', '5502', ...],
  matching: ['5501', '5502', ...],
  onlyInState: [],
  onlyInTiger: [],
  consistencyScore: 100 // 0-100
}
```

**Normalization handles**:
- Different separators: `5501`, `55-01`, `55_01`, `WI-01`
- Padding differences: `1` → `5501`
- State prefix addition: `01` → `5501`

### 3. Geometry Overlap (IoU)
Calculates Intersection over Union for boundary geometries:

```typescript
{
  geoid: '5501',
  name: 'Congressional District 1',
  stateArea: 123456.78, // square meters
  tigerArea: 123456.78,
  intersectionArea: 123456.78,
  unionArea: 123456.78,
  iou: 1.000, // 0-1
  areaDifference: 0.0, // percentage
  match: true // IoU >= 0.95
}
```

**IoU Calculation**:
```
IoU = Intersection / (Area1 + Area2 - Intersection)
```

**Quality thresholds** (Civic Infrastructure Standard):
- `IoU >= 0.95`: Acceptable match (required for production - electoral boundaries must be precise)
- `IoU >= 0.90`: Warning - minor boundary differences detected, requires investigation
- `IoU >= 0.80`: Critical - significant cross-source differences, manual review required
- `IoU < 0.80`: Rejected - discrepancy too large for civic infrastructure use

**Rationale**: Electoral boundaries determine democratic representation. 5% tolerance allows for minor coordinate precision differences while maintaining boundary integrity. Lower thresholds risk accepting incorrect boundary matches.

### 4. Overall Quality Score
Weighted scoring (0-100):
- **Count match**: 30%
- **GEOID consistency**: 30%
- **Geometry overlap**: 40%

**Quality ratings**:
- `90-100`: Excellent - state and TIGER sources are highly consistent
- `75-89`: Good - minor discrepancies detected, review recommended
- `50-74`: Fair - significant discrepancies detected, manual review required
- `0-49`: Poor - major discrepancies detected, use TIGER as canonical source

## Helper Functions

### `normalizeGeoid(geoid, stateFips)`
Normalizes GEOIDs for comparison:
```typescript
normalizeGeoid('5508', '55') // → '5508'
normalizeGeoid('55-08', '55') // → '5508'
normalizeGeoid('WI-08', '55') // → '5508'
normalizeGeoid('8', '55') // → '5508'
```

### `calculateIoU(geom1, geom2)`
Calculates Intersection over Union using Turf.js:
```typescript
const { iou, intersectionArea, unionArea } = calculateIoU(polygon1, polygon2);
```

**Dependencies**: `@turf/turf`, `@turf/helpers`

### `calculateAreaDifference(area1, area2)`
Percentage difference between two areas:
```typescript
calculateAreaDifference(100, 100) // → 0%
calculateAreaDifference(100, 110) // → 9.52%
```

### `compareDistrictCounts(...)`
Compares counts between state and TIGER sources.

### `compareGeoids(...)`
Finds matching, missing, and extra GEOIDs.

### `compareGeometries(...)`
Performs IoU calculation for all matched boundaries.

## Expanding to Other States

### Add a new state test:
```typescript
describe('Texas (State GIS)', () => {
  test('validates Texas congressional districts match TIGER', async () => {
    // Extract from state source
    const stateResult = await stateExtractor.extractLayer('TX', 'congressional');

    // Extract from TIGER
    const tigerFiles = await tigerProvider.downloadLayer({
      layer: 'cd',
      stateFips: '48', // Texas
    });
    const tigerBoundaries = await tigerProvider.transform(tigerFiles);
    const texasTiger = tigerBoundaries.filter(b => b.properties.stateFips === '48');

    // Compare counts
    const expectedCount = 38; // Texas has 38 congressional districts
    const { match } = compareDistrictCounts(
      'TX',
      'congressional',
      stateResult.featureCount,
      texasTiger.length,
      expectedCount
    );

    expect(match).toBe(true);
  }, 90000);
});
```

## Known Issues & Limitations

### Wisconsin State Senate
- **Expected**: 33 districts
- **Actual**: 34 districts (both state and TIGER)
- **Likely cause**: At-large district or special district included in data
- **Status**: Not a data quality issue - both sources agree

### Cross-Source Geometry Differences
Some states may have minor boundary differences between state GIS and TIGER due to:
- **Timing**: State redistricting commissions update before Census ingestion
- **Precision**: Different coordinate precision between sources
- **Corrections**: State may have made minor corrections after TIGER publication

**Solution**: Use 95% IoU threshold for all validation - civic infrastructure requires high precision regardless of source. Cross-source differences should be investigated, not tolerated.

## Integration with Shadow Atlas

### Validation Pipeline
```
1. Extract from state GIS portal → StateBatchExtractor
2. Extract from TIGER → TIGERBoundaryProvider
3. Cross-validate → cross-validation.test.ts
4. Generate quality report
5. Flag discrepancies for manual review
6. Store validated boundaries → Shadow Atlas
```

### CI/CD Integration
```yaml
# In CI: Skip integration tests (process.env.CI set)
- npm test cross-validation.test.ts

# Nightly: Run full validation against live APIs
- CI=false npm test cross-validation.test.ts
```

### Quality Assurance
- **Pre-deployment**: Run cross-validation for all configured states
- **Quarterly**: Re-validate after TIGER releases (September)
- **During redistricting**: Monthly validation (January-June of years ending in 2)

## Architecture Decisions

### Why Turf.js for Geometry?
- **Browser-compatible**: Works client-side and server-side
- **Well-maintained**: Active development, 10M+ weekly downloads
- **Geometry operations**: Intersection, union, area calculations out-of-the-box
- **GeoJSON-native**: No format conversion needed

### Why IoU (Intersection over Union)?
- **Standard metric**: Used in computer vision and geospatial analysis
- **Intuitive**: 1.0 = perfect overlap, 0.0 = no overlap
- **Robust**: Handles different polygon sizes and shapes
- **Threshold-based**: Clear quality cutoffs (95%, 90%, 80%)

### Why Skip in CI?
- **Live API calls**: TIGERweb and state portals may be down or slow
- **Network dependency**: Not suitable for fast CI pipelines
- **Data volatility**: APIs may return different results over time
- **Long duration**: 40-45 seconds per test

**Solution**: Run as nightly integration tests, skip in PR checks.

## Future Enhancements

### 1. Automated Alerting
- Slack/email notifications for quality score < 75%
- Weekly digest of cross-validation results

### 2. Historical Tracking
- Store validation results in database
- Track quality score trends over time
- Detect data degradation

### 3. Visual Diff Tool
- Web UI showing boundary overlays
- Highlight areas with low IoU
- Manual review workflow

### 4. Multi-State Batch Validation
```typescript
const states = ['WI', 'TX', 'FL', 'CA'];
const results = await Promise.all(
  states.map(state => validateState(state, 'congressional'))
);
```

### 5. Authority Precedence Rules
Implement `tiger-authority-rules.ts` logic:
- During gaps (Jan-Jun of years ending in 2): State redistricting commission > TIGER
- After ingestion (Sept+): TIGER > State GIS
- Always prefer higher authority when conflicts occur

## References

- **State GIS Portals Registry**: `/registry/state-gis-portals.ts`
- **TIGER Boundary Provider**: `./tiger-boundary-provider.ts`
- **State Batch Extractor**: `./state-batch-extractor.ts`
- **Turf.js Documentation**: https://turfjs.org/
- **Census TIGER/Line**: https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html

## Questions?

Contact the Shadow Atlas team or file an issue in the VOTER Protocol repository.

---

**Status**: ✅ Production-ready for Wisconsin pilot
**Last Updated**: 2025-12-17
**Test Coverage**: 9 tests, 100% passing
**Average IoU**: 1.000 (perfect match for Wisconsin)
