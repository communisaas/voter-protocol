# Shadow Atlas: Distinguished Engineering Roadmap

## Current Reality (Brutal Honesty)

| Metric | Current | Target | Gap |
|--------|---------|--------|-----|
| Cities with council district data | 6 validated | 200+ | 97% gap |
| Registry entries | 33 | 250+ | 87% gap |
| Population covered | ~35M | 100M+ | 65% gap |
| At-large classifications | 574 (unverified) | 0 unverified | Governance registry needed |

**The agent system works.** But it's orchestrating a nearly-empty registry.

## The Core Problem

The agent is not the bottleneck. **Data curation is the bottleneck.**

```
Current Flow:
  Agent → Registry (33 entries) → Validation → 6 cities resolved
                    ↑
            THIS IS THE GAP
```

## Phase 1: Registry Expansion (Weeks 1-3)

### 1A: Fix Broken Registry Entries (Day 1)

Houston and San Antonio use ArcGIS Hub download URLs that redirect to temporary Azure blobs. Fix with direct FeatureServer URLs.

```typescript
// BROKEN: Redirects to temporary blob
downloadUrl: 'https://hub.arcgis.com/api/download/v1/items/.../geojson'

// FIXED: Direct FeatureServer query
downloadUrl: 'https://services.arcgis.com/.../FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson'
```

### 1B: Complete Top 50 US Cities (Week 1-2)

We have 33 entries. Top 50 by population that need council district data:

| City | Pop | Status | Action |
|------|-----|--------|--------|
| Houston | 2.3M | Registry broken | Fix URL |
| San Antonio | 1.4M | Registry broken | Fix URL |
| El Paso | 678k | Missing | Manual research |
| Arlington | 394k | Missing | Manual research |
| ... | | | |

**Deliverable**: 50 validated cities covering 50M+ population.

### 1C: Statewide GIS Extraction (Week 2-3)

Four states have statewide ward data that can auto-populate 200+ cities:

| State | Portal | Coverage | Effort |
|-------|--------|----------|--------|
| Montana | Montana MSDI | 8 cities (done) | 0 |
| Wisconsin | WI DNR | 50+ cities | 2 days |
| Massachusetts | MassGIS | 40+ cities | 2 days |
| DC | DC Open Data | 1 city (done) | 0 |

**Deliverable**: 100+ additional cities from batch extraction.

## Phase 2: Governance Classification (Weeks 3-5)

### The At-Large Problem

574 cities classified as "at-large" based on population alone. This is a heuristic, not truth.

**Solution: Governance Registry**

```typescript
interface GovernanceEntry {
  fips: string;
  governanceType: 'ward-based' | 'at-large' | 'hybrid' | 'unknown';
  councilSize: number;
  districtCount: number | null;  // null for at-large
  source: 'charter' | 'municipal-code' | 'web-research' | 'assumed';
  confidence: number;
  lastVerified: string;
}
```

### Batch Research Strategy

1. **State Municipal Leagues** often publish governance structures
2. **National League of Cities** membership data
3. **Charter documents** (publicly available for most cities)

**Deliverable**: Governance registry for 500+ cities with verified ward/at-large status.

## Phase 3: Agent Evolution (Weeks 5-8)

### What the Agent Should Actually Do

```
NOT: "Discover GIS portals from scratch"
YES: "Validate and expand curated registry"
```

### Evolved Workflow

```python
# Phase 1: Registry-First (current)
for city in targets:
    if city.fips in registry:
        validate_and_resolve(city)

# Phase 2: Governance-Aware (new)
for city in targets:
    governance = governance_registry.get(city.fips)

    if governance.type == 'at-large':
        mark_resolved(city, tier=4, reason='at-large-verified')
    elif governance.type == 'ward-based' and city.fips in boundary_registry:
        validate_and_resolve(city)
    elif governance.type == 'ward-based':
        queue_for_discovery(city)  # High priority
    else:
        queue_for_governance_research(city)

# Phase 3: Gemini-Assisted (targeted)
for city in high_priority_queue:
    candidates = gemini_search_portal(city)
    human_review_and_approve(candidates)  # Human in the loop
```

### Call Efficiency Targets

| Phase | Gemini Calls | Coverage |
|-------|--------------|----------|
| Current | 5/state | 1% |
| Phase 2 | 5/state | 50% (governance-aware) |
| Phase 3 | 20/state (targeted) | 80% |
| Steady state | 0-5/state (validation only) | 95% |

## Phase 4: Quality Infrastructure (Weeks 8-12)

### Validation Pipeline Hardening

1. **URL Health Monitoring**: Nightly cron checks all registry URLs
2. **Schema Validation**: Detect breaking changes in GeoJSON structure
3. **Freshness Tracking**: Flag data older than redistricting cycle
4. **Geographic Validation**: Compare centroids against Census PLACE boundaries

### Merkle Tree Integration

Shadow Atlas feeds the ZK proof system:

```
Shadow Atlas Registry
        ↓
    Merkle Tree (IPFS)
        ↓
    On-chain Root Hash
        ↓
    Browser ZK Proof ("I live in District 5")
```

**Deliverable**: Quarterly IPFS updates with cryptographic commitment.

## Success Metrics

### Week 4 Checkpoint
- [ ] 100+ validated cities in registry
- [ ] Houston, San Antonio URLs fixed
- [ ] Statewide extraction for WI + MA
- [ ] Governance registry schema defined

### Week 8 Checkpoint
- [ ] 200+ validated cities
- [ ] 500+ governance classifications
- [ ] Agent using governance-aware workflow
- [ ] Nightly validation running

### Week 12 Checkpoint
- [ ] 250+ validated cities covering 100M+ population
- [ ] Merkle tree integration complete
- [ ] IPFS deployment for ZK proofs
- [ ] Documentation for community contributions

## The Distinguished Engineering Principle

**We don't automate data quality. We automate data orchestration.**

- Gemini finds *candidates*, humans approve
- Registry is *curated*, not scraped
- Provenance tracks *why*, not just what
- Validation is *deterministic*, not probabilistic

The goal is not 19,500 cities with 10% accuracy. It's 250 cities with 100% accuracy, serving 100M+ Americans.

Quality discourse pays. Bad faith costs.
