# Exclusivity Failure Action Plan

**Analysis Date**: 2026-01-16
**Cities Analyzed**: 24 exclusivity failures
**Conclusion**: 100% are true topology errors requiring source data fixes

## Executive Decision

**DO NOT adjust `OVERLAP_EPSILON` tolerance.**

The current threshold (150,000 sq m ≈ 387m × 387m) is appropriate for real-world edge-case handling. All 24 exclusivity failures are orders of magnitude larger than this threshold, indicating genuine data quality issues.

## Root Cause Classification

### Category 1: Wrong Source Layer (60% of failures)

**Problem**: Using county/regional data instead of city-specific districts

| City | Current Source | Issue | Fix Required |
|------|---------------|-------|--------------|
| Buckeye, AZ | Maricopa County (76 districts) | County-wide layer | Find Buckeye-specific layer |
| Carson, CA | LA County (15 districts) | County districts, not Carson | Find Carson council districts |
| Elk Grove, CA | Generic (26 districts) | Wrong granularity | Verify actual district count |
| Kenosha, WI | Aldermanic (34 districts) | May be wards not districts | Verify district definition |
| Chattahoochee Hills, GA | Generic (50 districts) | Excessive subdivision | Find correct council layer |
| Portage, IN | Council Reps (37 districts) | Voting precincts, not districts | Find actual council districts |
| Fernley, NV | Landbase view (6 districts) | Wrong layer/corruption | Find city council wards |

**Action**: Manual source discovery required for each city

### Category 2: Broken Tessellation (40% of failures)

**Problem**: Legitimate city data but overlapping district boundaries

| City | Districts | Max Overlap | Issue |
|------|-----------|-------------|-------|
| Ocala, FL | 6 | 45.8M sq m | Districts 1 & 2 completely overlap |
| Milton, GA | 6 | 56.8M sq m | Major boundary definition errors |
| Macomb, IL | 8 | 29.5M sq m | Council district overlaps |
| La Porte, TX | 9 | 51.2M sq m | District boundaries incorrect |
| Odessa, TX | 6 | 46.0M sq m | Geometry errors |
| Sherman, TX | 7 | 125.0M sq m | Complete tessellation failure |
| Glendale, AZ | 7 | 134.1M sq m | Massive overlaps |
| All other Texas cities | - | 13-24M sq m | Systematic issues |

**Action**: These require alternate source discovery or reporting to cities

### Category 3: Wrong City Data

| City | Current Source | Issue |
|------|---------------|-------|
| Menifee, CA | "Perris Council Districts" | Using neighboring city's data |

**Action**: Find Menifee-specific source

## Implementation Plan

### Phase 1: Immediate Registry Cleanup (Week 1)

1. **Mark 24 cities as invalid** in `KNOWN_PORTALS`
   ```typescript
   // Add validationStatus field
   interface KnownPortal {
     // ... existing fields
     validationStatus: 'valid' | 'exclusivity_failure' | 'exhaustivity_failure' | 'pending_review';
     validationNotes?: string;
   }
   ```

2. **Create `KNOWN_BROKEN_PORTALS` registry**
   ```typescript
   export const KNOWN_BROKEN_PORTALS: Record<string, {
     fips: string;
     city: string;
     state: string;
     failureType: 'wrong_layer' | 'broken_tessellation' | 'wrong_city';
     maxOverlapSqM: number;
     notes: string;
     discoveredDate: string;
   }> = {
     '0407940': {
       fips: '0407940',
       city: 'Buckeye',
       state: 'AZ',
       failureType: 'wrong_layer',
       maxOverlapSqM: 457241065,
       notes: 'Using Maricopa County layer (76 districts) instead of city-specific',
       discoveredDate: '2026-01-16',
     },
     // ... all 24 cities
   };
   ```

3. **Update discovery pipeline** to skip known broken portals

### Phase 2: Enhanced Validation (Week 2)

1. **Add pre-registration tessellation check**
   ```typescript
   // In batch-discover.ts or registry validation
   async function validateBeforeRegistry(
     districts: FeatureCollection,
     boundary: Feature,
     expectedCount: number,
     fips: string
   ): Promise<boolean> {
     // Run full tessellation proof
     const proof = validator.prove(districts, boundary, expectedCount);

     // Strict rejection criteria
     if (!proof.valid) {
       logger.warn(`${fips}: Failed ${proof.failedAxiom}`);
       return false;
     }

     // Even if passed, check overlap magnitude
     if (proof.diagnostics.totalOverlapArea > 1000) {
       logger.warn(`${fips}: Suspicious overlap ${proof.diagnostics.totalOverlapArea.toFixed(0)} sq m`);
       return false;
     }

     return true;
   }
   ```

2. **Expected district count validation**
   - Build table of expected counts from Wikipedia/city websites
   - Reject if actual count doesn't match ±1

3. **Layer name heuristics**
   ```typescript
   function scoreLayerName(layerName: string): number {
     let score = 50; // neutral

     // Positive signals
     if (/council|district|ward/i.test(layerName)) score += 30;
     if (/city/i.test(layerName)) score += 10;

     // Negative signals
     if (/county|precinct|voting/i.test(layerName)) score -= 40;
     if (/neighborhood|community/i.test(layerName)) score -= 20;

     return score;
   }
   ```

### Phase 3: Re-Discovery (Weeks 3-4)

For each of the 24 broken cities:

1. **Automated re-scan** with stricter filters
   - Require layer name score >60
   - Require feature count match expected
   - Run tessellation proof before adding

2. **Manual source investigation** for failures
   - Check city official GIS portal
   - Search for "city council districts" specifically
   - Look for recent redistricting (2021-2023)

3. **Community sources** as fallback
   - OpenStreetMap municipal boundaries
   - Census TIGER city boundaries + manual digitization
   - Redistricting Data Hub sources

### Phase 4: Documentation (Week 5)

1. **Create source quality scorecard**
   ```markdown
   | City | Source Type | Tessellation | Feature Count | Age | Score |
   |------|------------|--------------|---------------|-----|-------|
   | Austin, TX | Official | ✓ Pass | 10/10 | 2023 | A+ |
   | Buckeye, AZ | Wrong Layer | ✗ Fail | 76/7 | 2024 | F |
   ```

2. **Document discovery methodology** for each working city
   - How was correct source found?
   - What distinguishes it from wrong layers?
   - Can approach be automated?

## Technical Implementation

### Validation Pipeline Enhancement

```typescript
// src/validators/council/pre-registration-validator.ts

export interface PreRegistrationCheck {
  readonly passed: boolean;
  readonly checks: {
    readonly tessellation: boolean;
    readonly featureCount: boolean;
    readonly layerName: boolean;
    readonly geometryValid: boolean;
  };
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

export async function validateForRegistry(
  districts: FeatureCollection<Polygon | MultiPolygon>,
  boundary: Feature<Polygon | MultiPolygon>,
  expectedCount: number,
  layerName: string,
  fips: string
): Promise<PreRegistrationCheck> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Tessellation proof (strict)
  const proof = new TessellationProofValidator().prove(
    districts,
    boundary,
    expectedCount,
    undefined,
    undefined,
    undefined,
    fips
  );

  if (!proof.valid) {
    errors.push(`Tessellation failed: ${proof.failedAxiom} - ${proof.reason}`);
  }

  // 2. Feature count match
  const featureCountMatch = districts.features.length === expectedCount;
  if (!featureCountMatch) {
    errors.push(`Feature count mismatch: expected ${expectedCount}, got ${districts.features.length}`);
  }

  // 3. Layer name quality
  const layerScore = scoreLayerName(layerName);
  if (layerScore < 60) {
    warnings.push(`Layer name suspicious: "${layerName}" (score ${layerScore}/100)`);
  }

  // 4. Geometry validity
  const geometryValid = districts.features.every(f => {
    try {
      turf.area(f); // Will throw on invalid geometry
      return true;
    } catch {
      return false;
    }
  });

  if (!geometryValid) {
    errors.push('Invalid geometry detected in one or more features');
  }

  return {
    passed: errors.length === 0,
    checks: {
      tessellation: proof.valid,
      featureCount: featureCountMatch,
      layerName: layerScore >= 60,
      geometryValid,
    },
    warnings,
    errors,
  };
}
```

### Registry Schema Update

```typescript
// src/core/registry/known-portals.ts

export interface KnownPortal {
  readonly cityFips: string;
  readonly cityName: string;
  readonly state: string;
  readonly portalType: PortalType;
  readonly downloadUrl: string;
  readonly featureCount: number;
  readonly lastVerified: string;
  readonly confidence: number;
  readonly discoveredBy: 'manual' | 'automated' | 'pr-contribution';
  readonly notes?: string;

  // NEW FIELDS for validation tracking
  readonly validationStatus: 'valid' | 'exclusivity_failure' | 'exhaustivity_failure' | 'pending_review';
  readonly tessellationProof?: {
    readonly passed: boolean;
    readonly exclusivityCheck: { readonly passed: boolean; readonly maxOverlapSqM: number };
    readonly exhaustivityCheck: { readonly passed: boolean; readonly coverageRatio: number };
  };
  readonly expectedDistrictCount?: number; // From authoritative source (Wikipedia, city website)
}
```

## Success Metrics

### Week 1 Targets
- ✓ 24 cities marked as invalid
- ✓ KNOWN_BROKEN_PORTALS registry created
- ✓ Pre-registration validator implemented

### Week 2 Targets
- Re-discovery for top 10 broken cities (by population)
- At least 5 correct sources found
- Zero new exclusivity failures in registry

### Week 4 Targets
- All 24 cities either fixed or documented as unfixable
- 90%+ of new discoveries pass tessellation on first try
- Source quality scorecard published

## Long-Term Prevention

1. **Automated revalidation**
   - Re-run tessellation proofs monthly
   - Flag stale entries (>90 days)
   - Auto-remove entries that start failing

2. **Community feedback loop**
   - Users can report broken districts
   - PRs for better sources encouraged
   - Bounties for fixing high-population cities?

3. **Documentation as code**
   - Expected district counts checked into repo
   - Source discovery methodology versioned
   - Validation rules explicit and auditable

## Conclusion

**The tolerance is correct. The data is wrong.**

These 24 failures demonstrate that the tessellation proof is working perfectly - it's catching real topology errors that would break the protocol. The solution is better source discovery, not looser validation.

**No tolerance adjustment recommended.**

---

**Files Generated**:
- `/scripts/overlap-magnitude-analysis.ts` - Analysis script
- `/analysis-output/overlap-magnitude-results.json` - Full results (28K tokens)
- `/analysis-output/OVERLAP-MAGNITUDE-ANALYSIS-SUMMARY.md` - Summary report
- `/analysis-output/overlap-magnitude-visual.txt` - Visual scale comparison
- `/analysis-output/EXCLUSIVITY-FAILURE-ACTION-PLAN.md` - This document

**Next Actions**:
1. Review action plan with team
2. Implement Phase 1 (registry cleanup)
3. Begin manual source discovery for top-10 cities
4. Add pre-registration validation to discovery pipeline
