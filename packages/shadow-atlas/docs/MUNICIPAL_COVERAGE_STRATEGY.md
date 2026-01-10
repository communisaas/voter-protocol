# Municipal District Coverage Strategy

> **Goal**: Maximize coverage of city council districts/wards across all US cities
> **Current**: 62 cities (6.2% of top 1,000) → **Target**: 2,000+ cities (80%+ of district-based cities)

---

## Current State

| Metric | Count | Notes |
|--------|-------|-------|
| Census Places (cities/towns) | 19,495 | Incorporated places only |
| Top 1,000 by population | 1,000 | Priority targets |
| Currently covered | 62 | 6.2% of top 1,000 |
| ArcGIS layers discovered | 7,804 | Validated as potential council districts |
| State GIS portals | 51 | All 50 states + DC configured |
| Verified expected counts | 50 | Top 50 cities with district counts |

### Coverage Gap by Tier

| Tier | Population | Missing | Priority |
|------|------------|---------|----------|
| Tier 1 | >500K | 27 | CRITICAL |
| Tier 2 | 250K-500K | 48 | HIGH |
| Tier 3 | 100K-250K | 229 | MEDIUM |
| Tier 4 | <100K | 634 | LOW |

---

## Strategy: Three-Phase Approach

### Phase 1: Complete Top 100 Cities (2 weeks)

**Goal**: 100% coverage of cities >250K population

**Actions**:
1. **Run BulkDistrictDiscovery** on top 100 cities
   ```bash
   npx tsx src/scripts/discover-top-cities.ts --limit 100
   ```

2. **Manual verification** for Tier 1 failures
   - Direct city portal research
   - State GIS clearinghouse fallback
   - Municipal charter review (at-large detection)

3. **Expected count registry expansion**
   - Add remaining 50 cities to district-count-registry.ts
   - Verify from official city council websites

**Expected Output**: 75+ cities with verified districts (some at-large)

---

### Phase 2: Scale to Top 1,000 (1 month)

**Goal**: 80%+ coverage of cities >25K population

**Data Sources (Priority Order)**:

| Source | Coverage | Reliability | Cost |
|--------|----------|-------------|------|
| ArcGIS Hub API | 60% | HIGH | $0 |
| State GIS Clearinghouses | 85% | VERY HIGH | $0 |
| Socrata Open Data | 40% | HIGH | $0 |
| Direct City Portals | 90% | HIGHEST | Manual |
| OpenDataNetwork | 30% | MEDIUM | $0 |

**Pipeline**:
```
Census Places (19,495)
    ↓ Filter: population > 25,000
Top ~2,500 cities
    ↓ Filter: governance != 'at-large'
~2,000 district-based cities
    ↓ Discovery: ArcGIS Hub + State GIS + Socrata
~1,600 discovered (80%)
    ↓ Validation: expected counts + semantic + feature count
~1,400 validated (70%)
    ↓ Extraction: geometry + GEOID generation
Council Districts in Merkle Tree
```

**Automation**:
```typescript
// src/scripts/bulk-municipal-discovery.ts
import { BulkDistrictDiscovery } from '../services/bulk-district-discovery.js';
import { GOVERNANCE_REGISTRY } from '../registry/governance-structures.js';

const discovery = new BulkDistrictDiscovery({ concurrency: 10 });

// Filter out known at-large cities
const targets = censusPlaces
  .filter(p => p.population > 25000)
  .filter(p => GOVERNANCE_REGISTRY[p.geoid]?.structure !== 'at-large');

// Run discovery with progress tracking
await discovery.discoverBatch(targets, progress => {
  console.log(`${progress.completed}/${progress.total} (${progress.found} found)`);
});
```

---

### Phase 3: Long-Tail Coverage (Ongoing)

**Goal**: Cover remaining district-based cities as data becomes available

**Strategies**:

1. **Event-Driven Discovery**
   - Monitor ArcGIS Hub for new datasets (weekly cron)
   - Track state redistricting cycles (post-Census years)
   - Subscribe to OpenDataNetwork updates

2. **Community Contributions**
   - Accept PRs with new city portal URLs
   - Crowd-source at-large city identification
   - Municipal data partnerships

3. **AI-Assisted Discovery**
   - LLM extraction of council district URLs from city websites
   - Semantic search for GIS portal discovery
   - Cross-reference with Ballotpedia/Wikipedia

---

## At-Large City Handling

**Problem**: ~200 US cities use at-large representation (no geographic districts)

**Solution**: Expand governance registry to prevent wasted discovery

### Detection Methods

1. **Municipal Charter Analysis**
   - Official source: city charter documents
   - Keywords: "at-large", "city-wide", "no wards"

2. **Ballotpedia/Wikipedia Cross-Reference**
   - Governance infoboxes often indicate structure
   - Automated extraction possible

3. **Discovery Feedback Loop**
   - Cities with 0 council district layers → investigate
   - Mark as at-large if confirmed

### Registry Expansion Script

```typescript
// src/scripts/expand-governance-registry.ts
import { searchBallotpedia, searchWikipedia } from '../utils/governance-detection.js';

for (const city of unclassifiedCities) {
  const ballotpedia = await searchBallotpedia(city);
  const wikipedia = await searchWikipedia(city);

  if (ballotpedia.isAtLarge || wikipedia.isAtLarge) {
    GOVERNANCE_REGISTRY[city.fips] = {
      structure: 'at-large',
      councilSize: ballotpedia.councilSize || wikipedia.councilSize,
      source: ballotpedia.url || wikipedia.url,
      lastVerified: new Date().toISOString().split('T')[0],
    };
  }
}
```

---

## Validation Pipeline

### Expected Count Validation

**Problem**: Cincinnati PoC discovered 74 "Community Councils" instead of 9 council districts

**Solution**: Expected count registry with tolerance

```typescript
interface ValidationResult {
  passed: boolean;
  expectedCount: number | null;
  actualCount: number;
  confidence: number;
  reason: string;
}

function validateDistrictCount(city: string, actualCount: number): ValidationResult {
  const expected = EXPECTED_DISTRICT_COUNTS[city]?.expectedDistrictCount;

  if (expected === null) {
    // At-large city - expect 1 boundary (city limits)
    return { passed: actualCount === 1, confidence: 0.5, ... };
  }

  const diff = Math.abs(actualCount - expected);

  if (diff === 0) return { passed: true, confidence: 1.0, ... };
  if (diff <= 2) return { passed: true, confidence: 0.7, ... };  // Redistricting tolerance
  return { passed: false, confidence: 0.0, reason: 'Count mismatch', ... };
}
```

### Semantic Validation

```typescript
const POSITIVE_SIGNALS = [
  /council.*district/i,
  /city.*council/i,
  /ward/i,
  /supervisor.*district/i,
  /aldermanic/i,
];

const NEGATIVE_SIGNALS = [
  /neighborhood/i,
  /community.*council/i,  // Cincinnati failure
  /planning.*district/i,
  /census.*tract/i,
];
```

### Feature Count Heuristics

| Feature Count | Interpretation | Action |
|---------------|----------------|--------|
| 1 | City boundary or at-large | Verify governance |
| 2-4 | Small city or multi-member | Likely valid |
| 5-20 | Typical council size | HIGH confidence |
| 21-60 | Large city (NYC=51, CHI=50) | Verify expected count |
| 61+ | Wrong granularity | REJECT (likely neighborhoods) |

---

## GEOID Generation for Council Districts

**Problem**: Council districts don't have Census GEOIDs

**Solution**: Generate deterministic local GEOIDs

```typescript
function generateCouncilDistrictGeoid(
  cityFips: string,      // 7-digit place FIPS
  districtNumber: number // 1-indexed district number
): string {
  // Format: {cityFips}-CD{districtNumber}
  // Example: 5363000-CD01 (Seattle District 1)
  return `${cityFips}-CD${districtNumber.toString().padStart(2, '0')}`;
}
```

**Merkle Leaf Format**:
```typescript
interface CouncilDistrictLeaf {
  geoid: string;           // 5363000-CD01
  cityFips: string;        // 5363000
  districtNumber: number;  // 1
  districtName: string;    // "District 1" or "Ward 1"
  geometry: Polygon;       // GeoJSON polygon
  source: {
    portal: string;        // data.seattle.gov
    datasetId: string;
    vintage: number;       // 2024
    retrievedAt: string;
  };
}
```

---

## Implementation Roadmap

### Week 1-2: Top 100 Cities
- [ ] Run BulkDistrictDiscovery on top 100
- [ ] Manual verification of Tier 1 gaps
- [ ] Expand expected count registry to 100 cities
- [ ] Test extraction + Merkle commitment

### Week 3-4: Scale to Top 500
- [ ] Run full discovery pipeline
- [ ] Expand governance registry (at-large detection)
- [ ] Add state GIS clearinghouse fallbacks
- [ ] Automated validation + flagging

### Month 2: Top 1,000
- [ ] Complete discovery for all tier 1-3 cities
- [ ] CI/CD pipeline for weekly updates
- [ ] Dashboard for coverage monitoring
- [ ] Community contribution workflow

### Ongoing: Long-Tail + Maintenance
- [ ] Event-driven discovery (new datasets)
- [ ] Redistricting cycle monitoring
- [ ] Annual expected count verification

---

## Success Metrics

| Metric | Current | Target (Phase 1) | Target (Phase 2) |
|--------|---------|------------------|------------------|
| Top 100 coverage | 62% | 95% | 95% |
| Top 500 coverage | ~20% | 60% | 85% |
| Top 1,000 coverage | 6.2% | 40% | 80% |
| Total council districts | 588 | 1,500 | 5,000+ |
| At-large cities identified | ~10 | 50 | 200 |

---

## Resources

- `src/services/bulk-district-discovery.ts` - Discovery service
- `src/registry/governance-structures.ts` - At-large city registry
- `src/registry/district-count-registry.ts` - Expected counts
- `src/scanners/state-gis-clearinghouse.ts` - State fallback
- `src/validators/governance-validator.ts` - Pre-flight checks

---

**Making democracy engaging at the ward level.**
