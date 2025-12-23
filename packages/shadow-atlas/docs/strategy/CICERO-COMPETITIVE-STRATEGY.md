# Shadow Atlas: Competing with Cicero - 100% Data Accuracy Strategy

## Current State Assessment

**Last Updated**: 2025-12-18

| Metric | Current | Cicero | Gap |
|--------|---------|--------|-----|
| **Cities with council districts** | 35+ validated | 19,000+ | Significant gap |
| **Population covered** | ~50M+ | 330M+ | 85% gap |
| **Update frequency** | Quarterly + event-driven | Real-time | Latency gap |
| **Source authority** | Direct municipal APIs | Proprietary + official | Parity achievable |
| **Verification** | 5-layer pipeline | Unknown | We're stronger here |

**Cicero's Advantage**: Decade of data curation, paid relationships with municipalities, dedicated team.

**Our Advantage**: Open infrastructure, cryptographic verification, community-curated, free forever.

---

## Strategy Overview: Three Pillars

### Pillar 1: Authoritative Source Coverage (Accuracy)
Get data from THE authoritative source, not secondary copies.

### Pillar 2: Continuous Freshness (Up-to-Date)
Detect changes within 24 hours of publication.

### Pillar 3: Deterministic Validation (Trust)
Every boundary cryptographically committed, mathematically verified.

---

## Pillar 1: Authoritative Source Coverage

### 1A. Source Authority Hierarchy

```
TIER 0 (Canonical): Municipal GIS portals with official .gov domains
TIER 1 (Authoritative): State redistricting commissions
TIER 2 (Official): Census TIGER/Line products
TIER 3 (Secondary): ArcGIS Hub aggregations
TIER 4 (Tertiary): Community contributions (PR-gated)
```

**Implementation** (existing: `provenance/authority-registry.ts`):
- Registry maps boundary types → authoritative sources
- Priority rules enforce state > federal for legislative, municipal > state for council
- Source conflicts resolved deterministically (higher authority wins)

### 1B. Municipal GIS Portal Harvesting

**Current coverage gaps** (registry: `registry/known-portals.ts`):
- 35+ cities validated (as of 2025-12-18)
- Top 50 by population: 85% covered
- Top 100: ~40% covered
- Top 500: ~10% covered

**Expansion strategy**:

1. **State-Level Batch Extraction** (HIGH ROI)
   - 4 states have statewide ward data (MT, WI, MA, DC)
   - Scripts ready: `acquisition/pipelines/state-gis-scraper.ts`
   - Deliverable: +100 cities from batch extraction

2. **Municipal League Research** (MEDIUM ROI)
   - National League of Cities membership data
   - State municipal league directories
   - Charter document repositories (publicly available)
   - Deliverable: Governance registry for ward/at-large classification

3. **Autonomous Scanner Enhancement** (LONG-TERM)
   - `scanners/direct-mapserver.ts`: Domain pattern discovery
   - `services/gis-server-discovery.ts`: ArcGIS folder traversal
   - Semantic layer validator for candidate scoring
   - Deliverable: Self-expanding registry via PR workflow

### 1C. Census TIGER Integration

**Coverage**: 100% US floor guarantee
- Congressional districts (435): Census TIGER
- State legislative (7,383 combined): Census TIGER + state commissions
- Counties (3,143): Census TIGER
- Incorporated places (19,495): Census TIGER

**Implementation** (existing: `providers/us-census-tiger.ts`):
- Annual TIGER/Line releases (September publication)
- 12-month validity windows
- Automatic download + validation pipeline

---

## Pillar 2: Continuous Freshness

### 2A. Freshness System Architecture (IMPLEMENTED)

Six work packages, 261+ tests passing:

```
Authority Registry → Validity Window → Primary Comparator
       ↓                  ↓                  ↓
Gap Detector ← Event Subscription → Enhanced Change Detector
```

**WP-FRESHNESS-1: Authority Registry** (103 tests)
- Source prioritization rules
- Boundary type → authoritative source mapping

**WP-FRESHNESS-2: Validity Window** (29 tests)
- 12-month TIGER validity (Sept N → Aug N+1)
- Redistricting gap detection (Jan-Jun of years ending in 2)

**WP-FRESHNESS-3: Primary Comparator** (18 tests)
- HTTP HEAD freshness checks via `Last-Modified` headers
- State redistricting commission comparison

**WP-FRESHNESS-4: Event Subscription** (38 tests)
- RSS feed monitoring for Census releases
- Webhook registration for state commissions
- HTTP HEAD polling fallback

**WP-FRESHNESS-5: Gap Detector** (50 tests)
- Redistricting period detection (2022, 2032, etc.)
- Grace period logic (18 months post-Census)

**WP-FRESHNESS-6: Enhanced Change Detector** (23 tests)
- Priority-based refresh queue
- Integration with provenance system

### 2B. Update Detection Strategy

**Passive monitoring** (daily cron):
```typescript
// Nightly health checks
for (const entry of registry) {
  const freshness = await primaryComparator.checkLastModified(entry.downloadUrl);
  if (freshness.stale) {
    refreshQueue.enqueue(entry, Priority.HIGH);
  }
}
```

**Active notifications** (event-driven):
- Census RSS feeds: `https://www.census.gov/newsroom/rss.html`
- State redistricting commission webhooks (where available)
- GitHub Actions workflow triggers on detected changes

**Priority refresh** (queue-based):
- Expired sources first
- High-population cities prioritized
- Failed URLs flagged for manual review

### 2C. Redistricting Cycle Handling

**Critical periods**:
- 2022: Post-2020 Census redistricting complete
- 2032: Post-2030 Census redistricting begins
- Jan-Jun of redistricting years: Gap period (boundaries in flux)

**Grace period logic**:
```typescript
// Don't expire boundaries during redistricting gap
if (isRedistrictingGap(date) && !stateFinalized(state)) {
  return { status: 'PENDING_REDISTRICTING', expiration: null };
}
```

---

## Pillar 3: Deterministic Validation

### 3A. 5-Layer Validation Pipeline

See: `DATA-VALIDATION-STRATEGY.md`

1. **Discovery Validation**: Polygon + fields + features + extent
2. **Classification Validation**: Confidence scoring (>40% threshold)
3. **Geometric Validation**: Self-intersection + area bounds + coordinates
4. **Cross-Source Deduplication**: IoU + name similarity
5. **Merkle Tree Integrity**: Proof validity + canonical ordering

### 3B. Accuracy Verification Protocol

**Ground truth testing**:
```typescript
// Sample addresses with known district assignments
const GROUND_TRUTH = [
  { address: '1 City Hall, Seattle, WA', expected: 'District 7' },
  { address: '200 N Spring St, Los Angeles, CA', expected: 'District 1' },
  // ... 100+ known addresses per city
];

// Validate Shadow Atlas resolution matches
for (const test of GROUND_TRUTH) {
  const result = await resolver.resolve(test.address);
  expect(result.finest.name).toBe(test.expected);
}
```

**Regression detection**:
- Store historical resolutions
- Flag any change in district assignment for same address
- Human review required before accepting regressions

### 3C. Cryptographic Commitment

**Merkle tree structure** (existing: `merkle-tree.ts`):
```typescript
// Poseidon hash for ZK compatibility
const leaf = poseidon([
  BigInt(boundary.id),           // Unique identifier
  BigInt(boundary.type),         // Classification
  BigInt(boundary.geometryHash), // Geometry commitment
]);

// Quarterly IPFS publication
const root = merkleTree.getRoot();
const ipfsCid = await ipfs.add(serializeBoundaries(boundaries));

// On-chain root commitment
await shadowAtlasContract.updateRoot(root, ipfsCid);
```

---

## Implementation Roadmap

### Phase 1: Registry Expansion (Weeks 1-4)

**Deliverables**:
- [ ] Complete Top 100 US cities (current: 35)
- [ ] State-level batch extraction (WI, MA, MT completed)
- [ ] Governance registry schema (ward/at-large classification)
- [ ] URL stability validator (prevent Hub redirect failures)

**Success metrics**:
- 100+ validated cities
- 100M+ population covered
- <24hr detection latency for TIGER updates

### Phase 2: Freshness Automation (Weeks 5-8)

**Deliverables**:
- [ ] Nightly URL health monitoring cron
- [ ] Census RSS feed integration
- [ ] Priority refresh queue implementation
- [ ] Redistricting gap detector in production

**Success metrics**:
- 99%+ URL uptime in registry
- <24hr notification of source changes
- Zero stale data (>90 days) in production

### Phase 3: Coverage Scaling (Weeks 9-16)

**Deliverables**:
- [ ] 250+ validated cities
- [ ] Autonomous scanner improvements (domain patterns, semantic validation)
- [ ] Community contribution workflow (PR-gated additions)
- [ ] Merkle tree IPFS deployment

**Success metrics**:
- 150M+ population covered
- 95% resolution accuracy on ground truth tests
- Quarterly IPFS publications live

### Phase 4: Cicero Feature Parity (Weeks 17-24)

**Deliverables**:
- [ ] State legislative district coverage (50 states)
- [ ] Congressional district integration (435)
- [ ] County commissioner districts (3,143 counties)
- [ ] School board district coverage (pilot)

**Success metrics**:
- Full multi-layer resolution (council → city → county → state → congress)
- 99%+ accuracy on address resolution
- <1 second resolution latency (cached)

---

## Technical Implementation Priorities

### Immediate (This Sprint)

1. **Fix URL Instability** ✅
   - Houston, San Antonio Hub URLs replaced with FeatureServer
   - URL stability validator added

2. **Complete Freshness Tests**
   - 261+ tests passing
   - Integration tests for full pipeline

3. **Ground Truth Test Suite**
   - 100+ known addresses with verified district assignments
   - Automated regression detection

### Short-Term (Next 2 Sprints)

1. **State Batch Extraction**
   ```bash
   npx tsx scripts/extract-state-wards.ts --state WI
   npx tsx scripts/extract-state-wards.ts --state MA
   ```

2. **Governance Registry**
   ```typescript
   interface GovernanceEntry {
     fips: string;
     governanceType: 'ward-based' | 'at-large' | 'hybrid';
     councilSize: number;
     districtCount: number | null;
     source: 'charter' | 'municipal-code' | 'web-research';
   }
   ```

3. **Nightly Health Cron**
   - Check all 35+ registry URLs
   - Report failures to Slack/Discord
   - Auto-create GitHub issues for broken URLs

### Medium-Term (Next Quarter)

1. **Autonomous Scanner Improvements**
   - Enhanced domain pattern generation
   - Semantic layer scoring refinement
   - Confidence threshold tuning

2. **Community Contribution Workflow**
   - PR template for registry additions
   - Automated validation on PR
   - Human review for final merge

3. **IPFS Merkle Publication**
   - Quarterly snapshot generation
   - On-chain root commitment
   - Historical archive maintenance

---

## Competitive Differentiation

### Why We Beat Cicero Long-Term

| Factor | Cicero | Shadow Atlas |
|--------|--------|--------------|
| **Cost** | ~$0.10/lookup | Free forever |
| **Verification** | Trust us | Cryptographic proof |
| **Freshness** | Proprietary schedule | Open monitoring |
| **Coverage** | Paid only | Community-expandable |
| **Privacy** | Logs queries | Zero-knowledge proofs |

**Our moat**: Open, verifiable, free infrastructure becomes network effect. Cicero's moat (data curation) is reproducible with time. Our moat (cryptographic verification + community) compounds.

---

## Summary

**100% accurate, up-to-date data requires**:

1. **Authoritative sources**: Direct municipal APIs, not aggregated copies
2. **Continuous freshness**: 6-component monitoring system (261+ tests)
3. **Deterministic validation**: 5-layer pipeline with cryptographic commitment

**The path to Cicero parity**:
- 250+ cities (16 weeks)
- State legislative coverage (24 weeks)
- Full multi-layer resolution (32 weeks)

**The path to Cicero superiority**:
- Free, open, verifiable
- Community-expandable
- ZK-proof compatible

Quality discourse pays. Bad faith costs.
