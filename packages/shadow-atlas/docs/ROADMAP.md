# Shadow Atlas: Distinguished Engineering Roadmap

## Current Reality (Brutal Honesty)

| Metric | Current | Target | Gap |
|--------|---------|--------|-----|
| Cities with council district data | 6 validated | 200+ | 97% gap |
| Registry entries | 35 | 250+ | 86% gap |
| Population covered | ~40M | 100M+ | 60% gap |
| At-large classifications | 574 (unverified) | 0 unverified | Governance registry needed |
| Provenance test coverage | 261+ passing | N/A | Infrastructure stable |

**The agent system works.** Infrastructure hardening complete. Data curation is the bottleneck.

## The Core Problem

The agent is not the bottleneck. **Data curation is the bottleneck.**

```
Current Flow:
  Agent → Registry (33 entries) → Validation → 6 cities resolved
                    ↑
            THIS IS THE GAP
```

## Phase 1: Registry Expansion & Freshness (Weeks 1-3) ✅

### 1A: Fix Broken Registry Entries ✅

Houston and San Antonio URLs fixed. ArcGIS Hub redirects replaced with direct FeatureServer queries. URL stability validator added to prevent future regressions.

```typescript
// BROKEN: Redirects to temporary blob
downloadUrl: 'https://hub.arcgis.com/api/download/v1/items/.../geojson'

// FIXED: Direct FeatureServer query
downloadUrl: 'https://services.arcgis.com/.../FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson'
```

### 1B: Complete Top 50 US Cities (Week 1-2)

We have 35 entries. Top 50 by population that need council district data:

| City | Pop | Status | Action |
|------|-----|--------|--------|
| Houston | 2.3M | ✅ Fixed | URL stability validated |
| San Antonio | 1.4M | ✅ Fixed | URL stability validated |
| El Paso | 678k | Missing | Manual research |
| Arlington | 394k | Missing | Manual research |
| ... | | | |

**Deliverable**: 50 validated cities covering 50M+ population.

### 1C: Statewide GIS Extraction (Week 2-3)

Four states have statewide ward data that can auto-populate 200+ cities:

| State | Portal | Coverage | Effort | Status |
|-------|--------|----------|--------|--------|
| Montana | Montana MSDI | 8 cities | 0 | ✅ Done |
| Wisconsin | WI DNR | 50+ cities | 2 days | Script ready |
| Massachusetts | MassGIS | 40+ cities | 2 days | Script ready |
| DC | DC Open Data | 1 city | 0 | ✅ Done |

**Deliverable**: 100+ additional cities from batch extraction.
**Documentation**: See `docs/STATEWIDE-WARD-EXTRACTION.md` for extraction scripts.

### 1D: Freshness System Infrastructure ✅

Six work packages implement continuous data quality monitoring:

**WP-FRESHNESS-1: Authority Registry** ✅ (103 tests)
- Registry of authoritative sources by boundary type
- TIGER Line, state redistricting commissions, municipal GIS portals
- Source prioritization rules (state > federal for legislative, municipal > state for council)

**WP-FRESHNESS-2: Validity Window** ✅ (29 tests)
- 12-month TIGER Line validity (Sept N → Aug N+1)
- Redistricting gap detection (Jan-Jun of years ending in 2)
- Expiration calculation accounting for Census publication delays

**WP-FRESHNESS-3: Primary Comparator** ✅ (18 tests)
- HTTP HEAD freshness checks via `Last-Modified` headers
- State redistricting commission comparison (primary sources beat TIGER)
- Conditional GET support for bandwidth efficiency

**WP-FRESHNESS-4: Event Subscription** ✅ (38 tests)
- RSS feed monitoring for Census releases
- Webhook registration for state redistricting commissions
- HTTP HEAD polling fallback for sources without notifications

**WP-FRESHNESS-5: Gap Detector** ✅ (50 tests)
- Redistricting gap period detection (Jan-Jun of years ending in 2)
- State finalization tracking (when states publish post-Census maps)
- Grace period logic (18 months after Census before expiration)

**WP-FRESHNESS-6: Enhanced Change Detector** ✅ (23 tests)
- Freshness-aware change detection
- Priority-based refresh queue (expired sources first)
- Integration with existing provenance system

**Total Test Coverage**: 261+ passing tests in provenance infrastructure.

## Freshness System Architecture

The freshness system ensures Shadow Atlas data remains current without manual intervention:

```
┌─────────────────┐
│ Authority       │  WP-1: Source registry by boundary type
│ Registry        │        (TIGER, state commissions, municipal GIS)
└────────┬────────┘
         │
┌────────▼────────┐
│ Validity        │  WP-2: 12-month windows + redistricting gaps
│ Window          │        (Sept-to-Sept for TIGER, gap Jan-Jun)
└────────┬────────┘
         │
┌────────▼────────┐
│ Primary         │  WP-3: HTTP HEAD checks + state comparison
│ Comparator      │        (state sources beat TIGER when current)
└────────┬────────┘
         │
┌────────▼────────┐
│ Event           │  WP-4: RSS + webhooks + polling fallback
│ Subscription    │        (proactive updates beat reactive checks)
└────────┬────────┘
         │
┌────────▼────────┐
│ Gap             │  WP-5: Redistricting period detection
│ Detector        │        (grace period prevents false expiration)
└────────┬────────┘
         │
┌────────▼────────┐
│ Enhanced        │  WP-6: Freshness-aware change detection
│ Change Detector │        (priority queue: expired sources first)
└─────────────────┘
```

**Key Integration Points**:
- Authority Registry feeds Validity Window (source type → expiration rules)
- Validity Window feeds Gap Detector (redistricting years → grace periods)
- Event Subscription feeds Enhanced Change Detector (notifications → priority bumps)
- Enhanced Change Detector feeds Merkle Tree rebuild (stale data → refresh trigger)

**Operational Model**:
- **Passive monitoring**: HTTP HEAD checks (daily for TIGER, weekly for municipal)
- **Active notifications**: RSS feeds (Census releases), webhooks (state commissions)
- **Priority refresh**: Expired sources jump queue, high-population cities prioritized
- **Deterministic expiration**: Mathematical rules, zero manual judgement calls

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

### Week 4 Checkpoint (Current Sprint)
- [x] Houston, San Antonio URLs fixed
- [x] Freshness system infrastructure (6 work packages, 261+ tests)
- [x] URL stability validator
- [x] Statewide extraction scripts (WI + MA ready)
- [ ] 100+ validated cities in registry (35/100)
- [ ] Governance registry schema defined

### Week 8 Checkpoint
- [ ] 200+ validated cities
- [ ] 500+ governance classifications
- [ ] Agent using governance-aware workflow
- [ ] Nightly validation running with freshness monitoring

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
