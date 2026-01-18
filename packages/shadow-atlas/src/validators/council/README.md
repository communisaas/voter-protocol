# Council District Validation

Two-tier validation system for council district data quality.

## Architecture

### Tier 1: Pre-Validation Sanity Checks (Fast)

**Purpose**: Catch wrong data sources BEFORE expensive tessellation validation.

**Cost**: ~10ms per city (centroid calculations only)

**Checks**:
1. **Centroid proximity**: District centroid within 50km of city centroid (catches wrong-city data)
2. **Feature count**: Actual count within 3x of expected (catches wrong-granularity data)

**Implementation**: `pre-validation-sanity.ts`

### Tier 2: Tessellation Proof (Rigorous)

**Purpose**: Prove geometric correctness via four mathematical axioms.

**Cost**: ~500-2000ms per city (union, intersection, area calculations)

**Axioms**:
1. **Exclusivity**: No overlapping districts
2. **Exhaustivity**: Complete coverage (85-115% of city area)
3. **Containment**: Districts within city boundary
4. **Cardinality**: Correct number of districts

**Implementation**: `tessellation-proof.ts`

## Usage

### Recommended Workflow

```typescript
import { MunicipalBoundaryResolver } from './municipal-boundary.js';
import { runSanityChecks } from './pre-validation-sanity.js';
import { TessellationProofValidator } from './tessellation-proof.js';
import { getExpectedDistrictCount } from '../../core/registry/district-count-registry.js';

async function validateCouncilDistricts(
  fips: string,
  districts: FeatureCollection<Polygon | MultiPolygon>
) {
  // Step 1: Get expected count from registry
  const registry = getExpectedDistrictCount(fips);
  if (!registry) {
    throw new Error(`No district count registry for FIPS ${fips}`);
  }

  // Step 2: Resolve authoritative city boundary
  const resolver = new MunicipalBoundaryResolver();
  const boundaryResult = await resolver.resolve(fips);
  if (!boundaryResult.success || !boundaryResult.boundary) {
    throw new Error(`Failed to resolve boundary: ${boundaryResult.error}`);
  }

  const boundary = boundaryResult.boundary;

  // Step 3: Run fast sanity checks FIRST (~10ms)
  const sanityCheck = runSanityChecks(
    districts,
    boundary,
    registry.expectedDistrictCount
  );

  if (!sanityCheck.passed) {
    console.error(`Pre-validation failed: ${sanityCheck.failReason}`);
    return {
      valid: false,
      stage: 'sanity-check',
      reason: sanityCheck.failReason,
      diagnostics: sanityCheck.checks,
    };
  }

  // Step 4: Run full tessellation proof (~500-2000ms)
  const validator = new TessellationProofValidator();
  const proof = validator.prove(
    districts,
    boundary.geometry,
    registry.expectedDistrictCount,
    boundary.landAreaSqM,
    undefined, // authoritativeDistrictArea
    boundary.waterAreaSqM,
    fips
  );

  return {
    valid: proof.valid,
    stage: 'tessellation-proof',
    reason: proof.reason,
    diagnostics: proof.diagnostics,
  };
}
```

### Cost Savings

**Without sanity checks** (WS-3 baseline):
- 81 cities with wrong data
- Each runs full tessellation: 81 × 1000ms = 81 seconds wasted
- All fail on containment axiom

**With sanity checks**:
- 81 cities caught in pre-validation: 81 × 10ms = 0.81 seconds
- Zero cities proceed to tessellation
- **100x faster rejection of bad data**

### Example: Cincinnati Case

```typescript
// Cincinnati: 74 Community Council features vs. 9 expected council districts

const sanityCheck = runSanityChecks(
  communityCouncilData,  // 74 features
  cincinnatiBoundary,
  9  // Expected council districts
);

// Result:
// {
//   passed: false,
//   checks: {
//     featureCount: {
//       passed: false,
//       actual: 74,
//       expected: 9,
//       ratio: 8.22  // Fails 3x threshold
//     }
//   },
//   failReason: "Feature count mismatch: found 74 features, expected 9 (ratio 8.22x, too many)"
// }

// SAVED: ~1500ms tessellation validation time
```

### Example: Cross-City Contamination

```typescript
// San Diego districts (FIPS 0666000) mistakenly fetched for Los Angeles (FIPS 0644000)

const sanityCheck = runSanityChecks(
  sanDiegoDistricts,
  losAngelesBoundary,
  15  // LA expected count
);

// Result:
// {
//   passed: false,
//   checks: {
//     centroidProximity: {
//       passed: false,
//       distanceKm: 180.3,
//       threshold: 50
//     }
//   },
//   failReason: "District centroid too far from city centroid: 180.3km (threshold: 50km) - likely wrong city or state"
// }

// SAVED: ~1200ms tessellation validation time
```

## Validation Registry

Expected district counts stored in `district-count-registry.ts`:
- Top 50 US cities by population
- Verified from official city council websites
- Updated post-redistricting (typically every 10 years)

Missing a city? Add entry to registry:

```typescript
'0666000': {
  fips: '0666000',
  cityName: 'San Diego',
  state: 'CA',
  expectedDistrictCount: 9,
  governanceType: 'district-based',
  source: 'https://www.sandiego.gov/citycouncil/district-maps',
  lastVerified: '2025-11-19',
  notes: '9 districts (adopted Dec 2021)',
}
```

## Custom Thresholds

Override defaults for edge cases:

```typescript
// Consolidated city-county with large geographic area
const sanityCheck = runSanityChecks(
  districts,
  jacksonvilleBoundary,
  14,
  {
    maxCentroidDistanceKm: 80,  // Default: 50km
    maxFeatureCountRatio: 4.0,  // Default: 3x
  }
);
```

## Performance Benchmarks

| Stage | Cities | Time per City | Total Time |
|-------|--------|---------------|------------|
| Sanity checks | 100 | ~10ms | 1 second |
| Tessellation (pass) | 80 | ~800ms | 64 seconds |
| Tessellation (fail) | 20 | ~1500ms | 30 seconds |
| **Total** | **100** | - | **95 seconds** |

**Without sanity checks**: 115 seconds (all 100 cities run tessellation)

**Savings**: 20 seconds (17% faster overall, 100x faster rejection of bad data)

## References

- WS-3 Analysis: 81 cities with 100% containment failure
- Cincinnati PoC: 74 features discovered (wrong granularity)
- Implementation: `pre-validation-sanity.ts`
- Tests: `__tests__/unit/validators/pre-validation-sanity.test.ts`
