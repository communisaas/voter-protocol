# Regression Test Suite

This directory contains regression tests that prevent previously working functionality from breaking.

## Golden Cities (`golden-cities.test.ts`)

### Purpose

The Golden Cities test suite locks in cities that pass all 4 tessellation axioms as invariants. Any change to the tessellation validator or data sources that causes a golden city to fail is a regression.

### The 4 Axioms

Every golden city must pass all four axioms:

1. **EXCLUSIVITY**: Districts do not overlap (disjoint polygons)
2. **EXHAUSTIVITY**: Districts cover 85-115% of the municipal boundary
3. **CONTAINMENT**: Districts are within the municipal boundary (max 15% outside)
4. **CARDINALITY**: District count matches expected count

### Test Behavior

```bash
# Run fixture integrity tests only (no network, fast)
npx vitest run src/__tests__/regression/golden-cities.test.ts

# Run full validation with network calls (slower, ~5 min)
RUN_GOLDEN_CITIES=true npx vitest run src/__tests__/regression/golden-cities.test.ts
```

In CI:
- Fixture integrity tests always run
- Live validation tests are skipped unless `RUN_GOLDEN_CITIES=true`
- Consider running live validation as a nightly job

### When Tests Fail

If a golden city fails validation:

1. **Do not silently remove the city** - this defeats the purpose of regression testing
2. **Investigate the cause**:
   - Did the data source URL change?
   - Did the city undergo redistricting?
   - Did a code change break the validator?
3. **Fix the regression** if it's a code bug
4. **Update the golden set** if the data legitimately changed:
   - Update `golden-cities.json` with new expected values
   - Document the change in your commit message
   - Include evidence (new district count, redistricting date, etc.)

### Managing Golden Cities

#### Adding a New Golden City

Prerequisites:
- City passes all 4 axioms consistently for 30+ days
- City has a stable data source (prefer official city GIS, avoid temporary URLs)
- City adds diversity (region, size, governance type)
- City has confidence score >= 80 in known-portals.ts

Steps:
1. Verify the city passes validation:
   ```bash
   npx tsx scripts/run-city-validation.ts --limit=1 --fips=XXXXXXX
   ```
2. Add entry to `fixtures/golden-cities.json`
3. Ensure corresponding entry exists in `known-portals.ts`
4. Run regression tests to confirm
5. Create PR with justification

#### Removing a Golden City

Valid reasons:
- City underwent redistricting (boundaries changed)
- Data source permanently unavailable
- City governance structure changed fundamentally

Steps:
1. Document the reason clearly
2. Remove from `fixtures/golden-cities.json`
3. Create PR explaining:
   - Why the city no longer qualifies
   - When the change occurred
   - Evidence (news article, official announcement, etc.)

#### Modifying Thresholds

Threshold changes (coverage tolerance, overlap tolerance, etc.) require:
1. **Explicit PR approval** from maintainers
2. **Justification** explaining why current thresholds are insufficient
3. **Impact analysis** showing which cities are affected
4. **Updated golden set** if cities move in/out of passing status

### Current Golden Cities (18 cities)

| City | State | Districts | Region | Characteristics |
|------|-------|-----------|--------|-----------------|
| Austin | TX | 10 | Southwest | Large metro, state capital |
| Seattle | WA | 7 | Pacific Northwest | Large metro, coastal |
| Philadelphia | PA | 10 | Northeast | Large metro, historic |
| San Antonio | TX | 10 | Southwest | Large metro |
| Houston | TX | 11 | Southwest | Top 5 city |
| Chicago | IL | 50 | Midwest | Third largest, many wards |
| Washington | DC | 8 | Northeast | Federal district |
| Detroit | MI | 7 | Midwest | Rust belt, legacy city |
| Baltimore | MD | 14 | Mid-Atlantic | Coastal, port city |
| New Orleans | LA | 5 | Southeast | Coastal, unique governance |
| Atlanta | GA | 12 | Southeast | Large metro, state capital |
| Denver | CO | 11 | Mountain West | State capital, high-growth |
| Oklahoma City | OK | 8 | Central | State capital |
| Honolulu | HI | 9 | Pacific | Island, unique geography |
| St. Paul | MN | 7 | Midwest | State capital, twin city |
| Indianapolis | IN | 25 | Midwest | Consolidated city-county |
| Nashville | TN | 35 | Southeast | State capital, consolidated |
| Colorado Springs | CO | 6 | Mountain West | Medium metro |

### Selection Criteria

Golden cities are selected for:

1. **Pass rate**: 100% on all 4 axioms
2. **Coverage ratio**: 85-115% (within tessellation thresholds)
3. **Confidence**: >= 80 in known-portals.ts
4. **Diversity**:
   - Geographic: All major US regions represented
   - Size: Small (5 districts) to large (50 wards)
   - Governance: Districts, wards, consolidated city-county

### File Structure

```
regression/
  README.md                 # This file
  golden-cities.test.ts     # Test suite

fixtures/
  golden-cities.json        # Golden city definitions
```

### Integration with CI/CD

Recommended CI configuration:

```yaml
# Fast tests (every PR)
test-regression-fixtures:
  script: npx vitest run src/__tests__/regression/golden-cities.test.ts

# Full validation (nightly)
test-regression-live:
  schedule: "0 0 * * *"  # Daily at midnight
  script: RUN_GOLDEN_CITIES=true npx vitest run src/__tests__/regression/golden-cities.test.ts
```

### Troubleshooting

**Test fails with "Failed to fetch districts"**
- Data source URL may have changed
- Check if portal moved to new platform
- Update URL in known-portals.ts

**Test fails with "coverage below threshold"**
- City may have undergone redistricting
- Check official city website for new boundaries
- Update expected feature count if needed

**Test fails with "cardinality mismatch"**
- Feature count changed (redistricting, new districts)
- Update expectedFeatureCount in both fixture and registry

**Test times out**
- Network issues with remote servers
- Consider increasing timeout or skipping in CI
- Mark test as flaky if consistent timeout
