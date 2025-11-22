# Shadow Atlas Validation Scripts

Production-ready tools for validating coverage across top US cities.

---

## Quick Start

```bash
# Validate top 50 cities coverage
npx tsx scripts/validate-top-50-coverage.ts

# Test all registry URLs
npx tsx scripts/test-all-registry-urls.ts
```

---

## Scripts

### `top-50-us-cities.ts`

**Purpose**: Authoritative dataset of top 50 US cities by 2020 Census population

**Data**:
- 7-digit Census PLACE FIPS codes
- City name and state
- 2020 Census population counts

**Source**: US Census Bureau (2020 Decennial Census)

**Usage**:
```typescript
import { TOP_50_US_CITIES } from './top-50-us-cities.js';

// Iterate through cities
for (const city of TOP_50_US_CITIES) {
  console.log(`${city.rank}. ${city.name}, ${city.state} - ${city.pop2020.toLocaleString()}`);
}
```

---

### `validate-top-50-coverage.ts`

**Purpose**: Comprehensive validation of geographic coverage for top 50 cities

**What it checks**:
- ✅ Layer 1 coverage (council district GeoJSON in registry)
- ✅ Layer 2 coverage (Census PLACE boundaries, always available)
- ✅ Governance structure (district-based, at-large, mixed, unknown)
- ✅ Confidence scores for Layer 1 entries

**Output**:
- Summary statistics (excellent/good/fallback distribution)
- Coverage by population tier (Top 10, 11-20, etc.)
- Coverage by state
- Detailed city-by-city status
- Priority list of cities needing Layer 1 discovery

**Status indicators**:
- ✅ **Excellent**: Layer 1 with confidence ≥80
- 🟢 **Good**: Layer 1 with confidence 60-79 OR confirmed at-large
- 🟡 **Fallback**: Layer 2 Census PLACE only (functional but no district data)

**Usage**:
```bash
# Run validation
npx tsx scripts/validate-top-50-coverage.ts

# Save output to file
npx tsx scripts/validate-top-50-coverage.ts > coverage-report.txt
```

**Success criteria**:
- 100% total coverage (Layer 1 + Layer 2)
- No cities without geographic boundaries
- Clear identification of gaps

---

### `test-all-registry-urls.ts`

**Purpose**: Production health monitoring for known-portals registry

**What it tests**:
- ✅ HTTP accessibility (200 OK response)
- ✅ GeoJSON format validity
- ✅ Feature count matches registry metadata
- ✅ Response time acceptable (<5s ideal, <10s max)

**Output**:
- Real-time per-city test results
- Summary pass/warning/fail counts
- Response time statistics (avg/min/max)
- List of entries requiring attention

**Status indicators**:
- ✅ **Passed**: URL accessible, feature count matches, good response time
- ⚠️ **Warning**: URL works but has issues (count mismatch, slow response)
- ❌ **Failed**: URL broken (HTTP error, timeout, parse error)

**Usage**:
```bash
# Run full test suite
npx tsx scripts/test-all-registry-urls.ts

# Run with custom timeout
# (edit script to adjust AbortSignal.timeout value)
```

**Health targets**:
- 95%+ pass rate (acceptable: 90%+)
- <2s average response time (acceptable: <5s)
- 0 failures requiring immediate attention

**Maintenance schedule**:
- Run weekly for production monitoring
- Run after bulk registry updates
- Run before major releases

---

## Data Sources

### Known Portals Registry
**File**: `/packages/crypto/services/shadow-atlas/registry/known-portals.ts`

Validated GeoJSON endpoints for council districts:
- ArcGIS Hub download APIs
- Socrata Open Data APIs
- Municipal GIS portals
- GIS FeatureServer REST APIs

**Quality gates**:
- Minimum confidence: 60 (production: 70+)
- Validation required: Deterministic + geographic validators
- Feature count check: 3-25 typical for council districts
- Staleness threshold: 90 days

### Governance Registry
**File**: `/packages/crypto/services/shadow-atlas/registry/governance-structures.ts`

Manual registry of city governance structures:
- **District-based**: Geographic districts elect representatives
- **At-large**: All representatives elected city-wide (no districts to discover)
- **Mixed**: Some district, some at-large (treat as district-based)
- **Unknown**: No authoritative data (attempt Layer 1 discovery)

**Purpose**: Prevent wasted compute on at-large cities (no districts exist)

---

## Validation Workflow

### 1. Run Coverage Validation

```bash
npx tsx scripts/validate-top-50-coverage.ts
```

**Expected output**:
```
Total cities validated:                50
Excellent (Layer 1, confidence ≥80):   9 (18.0%)
Good (Layer 1 ≥60 OR at-large):        3 (6.0%)
Fallback (Layer 2 Census PLACE only): 38 (76.0%)

✅ COVERAGE GUARANTEE: All 50 cities have either Layer 1 or Layer 2 coverage
```

### 2. Test Registry Health

```bash
npx tsx scripts/test-all-registry-urls.ts
```

**Expected output**:
```
Total entries tested:  12
✅ Passed:            11 (91.7%)
⚠️  Warnings:          0 (0.0%)
❌ Failed:            1 (8.3%)

Average response time: 952ms
```

### 3. Review Results

Check for:
- ❌ **Failed URLs**: Immediate fix required (broken endpoints)
- ⚠️ **Warnings**: Review and monitor (count mismatches, slow responses)
- 🟡 **Fallback cities**: Candidates for Layer 1 discovery

### 4. Update Registry

**Add new entries**:
```typescript
// In known-portals.ts
'1234567': {
  cityFips: '1234567',
  cityName: 'Example City',
  state: 'EX',
  portalType: 'arcgis',
  downloadUrl: 'https://...',
  featureCount: 10,
  lastVerified: new Date().toISOString(),
  confidence: 85,
  discoveredBy: 'manual',
  notes: 'Description of data source',
}
```

**Fix broken entries**:
- Update `downloadUrl` if redirected
- Update `featureCount` if changed
- Update `lastVerified` timestamp
- Remove if permanently broken

### 5. Re-validate

Run both scripts again to confirm fixes.

---

## Continuous Integration

### Weekly Health Check

```yaml
# .github/workflows/registry-health.yml
name: Registry Health Check

on:
  schedule:
    - cron: '0 0 * * 0'  # Every Sunday at midnight

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npx tsx scripts/test-all-registry-urls.ts
      - run: npx tsx scripts/validate-top-50-coverage.ts
```

### Pre-Release Validation

```bash
# Run before tagging new releases
npm run validate:coverage
npm run test:registry-urls
```

---

## Troubleshooting

### Issue: High Failure Rate (>10%)

**Possible causes**:
- Portal downtime (temporary)
- URL changes (permanent)
- Rate limiting (too fast)

**Solutions**:
1. Re-run after 1 hour (check if temporary)
2. Manually visit failing URLs (check for redirects)
3. Add delays between requests (reduce rate)

### Issue: Count Mismatches

**Possible causes**:
- Redistricting (new boundaries)
- Data updates (portal refresh)
- Wrong layer/dataset

**Solutions**:
1. Download GeoJSON and count features manually
2. Update `featureCount` in registry
3. Verify URL points to correct layer

### Issue: Slow Response Times (>5s)

**Possible causes**:
- Large datasets (>100 features)
- Server load (peak hours)
- Network latency

**Solutions**:
1. Accept if <10s (mark as warning)
2. Find alternative endpoint (Hub API vs FeatureServer)
3. Add caching layer (future enhancement)

---

## Future Enhancements

### Planned
- [ ] **Automated PR creation** for broken URL fixes
- [ ] **Slack/Discord notifications** for health check failures
- [ ] **Historical tracking** of registry health over time
- [ ] **Parallel testing** for faster execution
- [ ] **Retry logic** for transient failures

### Considered
- [ ] **GeoJSON validation** (schema checks, topology validation)
- [ ] **Visual diff** for geometry changes (detect redistricting)
- [ ] **Performance benchmarks** (track response time trends)
- [ ] **Coverage badges** for README (shields.io)

---

## References

- **Architecture**: `/docs/MUNICIPAL-BOUNDARIES-ARCHITECTURE.md`
- **Coverage Report**: `/docs/TOP-50-COVERAGE-REPORT.md`
- **Status**: `/packages/crypto/services/shadow-atlas/STATUS.md`
- **Registry**: `/packages/crypto/services/shadow-atlas/registry/known-portals.ts`

---

**Last updated**: 2025-11-18
**Maintainer**: Shadow Atlas Team
**Status**: Production-ready
