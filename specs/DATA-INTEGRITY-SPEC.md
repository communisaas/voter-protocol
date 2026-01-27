# Data Integrity Specification

**Version:** 1.0.0
**Date:** 2026-01-26
**Status:** NORMATIVE (merged from DATA-FRESHNESS-SPEC + DATA-PROVENANCE-SPEC)

---

## Overview

This specification consolidates the data integrity requirements for the Shadow Atlas system, covering two critical dimensions:

1. **Data Freshness** - Ensuring boundary data reflects the most current authoritative sources, particularly during redistricting cycles when aggregators (Census TIGER) lag behind primary sources (state redistricting commissions).

2. **Data Provenance** - Tracking the authoritative origin of each boundary, maintaining audit trails, and resolving conflicts when multiple sources claim different boundaries.

**Core Principle:** `authority + freshness > institutional prestige`

Census TIGER is invaluable for standardization, but during redistricting cycles (2021-2022, 2031-2032), primary sources from state redistricting commissions will be 6-18 months fresher. We must verify against primary sources, not trust aggregators blindly.

**Implementation Status:**
- Phase 1 (20% Complete): HTTP HEAD-based change detection implemented
- Phase 2 (Design Only): Authority registry, primary source comparison, event subscriptions not implemented
- Current system uses Census TIGER without primary source validation

---

## 1. Data Freshness Requirements

### 1.1 The Freshness Problem

Census TIGER releases annually in **July**. During redistricting, this creates a critical gap:

```
Timeline: California Redistricting 2021-2022
-------------------------------------------------------------------

Month 0 (Dec 2021):  CA Citizens Redistricting Commission finalizes maps
                     -> State publishes on wedrawthelinesca.org
                     -> AUTHORITATIVE data available
                     -> TIGER still shows OLD districts

Month 1 (Jan 2022):  New districts take LEGAL EFFECT
                     -> TIGER still shows OLD districts
                     -> Anyone using TIGER serves WRONG data

Month 7 (Jul 2022):  Census releases TIGER 2022
                     -> Finally includes new CA districts
                     -> 7 months of stale federal data

-------------------------------------------------------------------

IMPACT: Using "highest institutional tier" as the rule serves stale data
        for 7 months during redistricting.
```

### 1.2 Freshness Verification Stack

```
+---------------------------------------------------------------------+
|                    FRESHNESS VERIFICATION STACK                      |
+---------------------------------------------------------------------+
|                                                                      |
|  Layer 1: FILE CHANGE DETECTION                                      |
|    |-- HTTP HEAD -> ETag / Last-Modified                             |
|    |-- Detects: When source file was modified                        |
|    +-- Cost: $0 (HEAD requests are free)                             |
|                                                                      |
|  Layer 2: VALIDITY WINDOW TRACKING                                   |
|    |-- Maps source -> {valid_from, valid_until, confidence_decay}    |
|    |-- Detects: When source is expected to become stale              |
|    +-- Cost: $0 (calendar math)                                      |
|                                                                      |
|  Layer 3: PRIMARY SOURCE COMPARISON                                  |
|    |-- Checks authoritative sources (state redistricting commissions)|
|    |-- Detects: When primary has newer data than aggregator          |
|    +-- Cost: $0 (public government websites)                         |
|                                                                      |
|  Layer 4: EVENT SUBSCRIPTION                                         |
|    |-- RSS feeds, state redistricting announcements                  |
|    |-- Detects: Boundary changes as they happen                      |
|    +-- Cost: $0 (public feeds)                                       |
|                                                                      |
+---------------------------------------------------------------------+
```

### 1.3 Validity Window Calculation

Each source has a validity window based on known update cycles:

```typescript
interface ValidityWindow {
  readonly sourceId: string;
  readonly validFrom: Date;         // When this data became authoritative
  readonly validUntil: Date;        // When we expect replacement
  readonly confidenceDecay: number; // 0.0-1.0, decays as validUntil approaches
}

/**
 * Validity windows are derived from known cycles:
 *
 * Census TIGER:
 *   - validFrom: July 1 of release year
 *   - validUntil: July 1 of next year
 *   - confidence: 1.0 until March, then decays
 *   - Exception: Redistricting years (2021-2022, 2031-2032) - may be stale immediately
 *
 * Redistricting Commission:
 *   - validFrom: Date maps adopted
 *   - validUntil: Next redistricting cycle (10 years)
 *   - confidence: 1.0 (legal authority)
 *
 * City Council Districts:
 *   - validFrom: Ordinance effective date
 *   - validUntil: Next redistricting (after census)
 *   - confidence: 1.0 if from primary source
 */
```

### 1.4 Redistricting Gap Detection

During redistricting years, there's a window where TIGER is guaranteed stale:

```
Dec Y1: States finalize new maps
Jan Y2: New districts take legal effect
Jul Y2: TIGER updates

Gap: Jan-Jun of Y2 (6 months of guaranteed staleness)
```

**Gap Detection Algorithm:**
1. Check if current year is a redistricting year (2021, 2022, 2031, 2032)
2. Check if TIGER has updated this year (July release)
3. Check if state has finalized redistricting (from calendar)
4. If state finalized but TIGER not updated, recommend primary source

### 1.5 Event Subscription Feeds

Known feeds for redistricting updates:

| Feed | URL | Poll Frequency | Content |
|------|-----|----------------|---------|
| Census Geography RSS | census.gov/programs-surveys/geography/geographies/rss.xml | Daily | TIGER releases |
| Redistricting LLS | redistricting.lls.edu/feed/ | Daily | State adoptions |
| NCSL Redistricting | ncsl.org/redistricting-and-census/redistricting-news.aspx | Weekly | News updates |

---

## 2. Data Provenance Tracking

### 2.1 Source Authority Model

**Critical Distinction:** Authority and freshness are orthogonal concerns.

```
+---------------------------------------------------------------------+
|                     SOURCE AUTHORITY MODEL                           |
+---------------------------------------------------------------------+
|                                                                      |
|  PRINCIPLE: Each boundary type has exactly ONE authoritative        |
|  source - the entity with legal jurisdiction to define it.          |
|                                                                      |
|  +-------------------------+-----------------------------------+    |
|  |  Boundary Type          | Authoritative Source              |    |
|  +-------------------------+-----------------------------------+    |
|  |  Congressional District | State Legislature (draws lines)   |    |
|  |  State Senate/House     | State Legislature                 |    |
|  |  County                 | State (defines county boundaries) |    |
|  |  City Limits            | State (approves incorporation)    |    |
|  |  City Council District  | City Council (local ordinance)    |    |
|  |  School District        | State Education Agency            |    |
|  |  Voting Precinct        | County Elections Office           |    |
|  |  Special District       | Forming authority (state/county)  |    |
|  +-------------------------+-----------------------------------+    |
|                                                                      |
|  Census Bureau is a REPUBLISHER, not the authority.                 |
|  They aggregate and standardize, but don't define boundaries.       |
|                                                                      |
+---------------------------------------------------------------------+
```

### 2.2 Authority Registry Schema

```typescript
interface AuthorityRegistry {
  readonly entries: Map<BoundaryType, AuthorityEntry>;

  /** Get authority configuration for a boundary type */
  getAuthority(boundaryType: BoundaryType): AuthorityEntry;

  /** Get all primary sources for a state */
  getPrimarySourcesForState(state: string): PrimarySource[];

  /** Check if we're in a redistricting window */
  isRedistrictingWindow(): boolean;
}

interface AuthorityEntry {
  readonly boundaryType: BoundaryType;
  readonly displayName: string;

  // Legal authority
  readonly authorityEntity: string;      // "State Legislature" | "City Council" | etc.
  readonly legalBasis: string;           // "US Constitution Article I, Section 4"

  // Primary sources (authoritative)
  readonly primarySources: PrimarySource[];

  // Aggregator sources (convenience, may lag)
  readonly aggregatorSources: AggregatorSource[];

  // Update schedule
  readonly updateTriggers: UpdateTrigger[];
  readonly expectedLag: {
    readonly normal: string;             // "0 days" for primary, "6-12 months" for TIGER
    readonly redistricting: string;      // "6-18 months" for TIGER during redistricting
  };
}

interface PrimarySource {
  readonly name: string;
  readonly entity: string;               // "CA Citizens Redistricting Commission"
  readonly jurisdiction: string;         // "CA" or "*" for federal
  readonly url: string | null;
  readonly format: 'geojson' | 'shapefile' | 'kml' | 'pdf' | 'unknown';
  readonly machineReadable: boolean;
  readonly freshnessIndicator: FreshnessIndicator;
}

interface AggregatorSource {
  readonly name: string;                 // "Census TIGER"
  readonly url: string;
  readonly urlTemplate: string;
  readonly format: 'shapefile' | 'geojson';
  readonly lag: string;                  // "6-18 months during redistricting"
  readonly releaseMonth: number;         // 7 = July for TIGER
  readonly freshnessIndicator: FreshnessIndicator;
}
```

### 2.3 US Authority Registry (Key Entries)

```yaml
US:
  congressional:
    authority_entity: "State Legislature or Independent Commission"
    legal_basis: "US Constitution Article I, Section 4"

    primary_sources:
      - name: "CA Citizens Redistricting Commission"
        jurisdiction: "CA"
        url: "https://www.wedrawthelinesca.org/"
        format: shapefile
        machine_readable: true

      - name: "TX Legislative Council"
        jurisdiction: "TX"
        url: "https://redistricting.capitol.texas.gov/"
        format: shapefile
        machine_readable: true

    aggregator_sources:
      - name: "Census TIGER"
        url_template: "https://www2.census.gov/geo/tiger/TIGER{YEAR}/CD/tl_{YEAR}_us_cd{CONGRESS}.zip"
        lag: "6-18 months during redistricting"
        release_month: 7

      - name: "Redistricting Data Hub"
        url: "https://redistrictingdatahub.org/"
        lag: "Near-realtime during redistricting"

  city_council:
    authority_entity: "City Council"
    legal_basis: "Municipal Code / City Charter"
    notes: "NO FEDERAL AGGREGATOR EXISTS. Must be discovered via portal scanning."

    discovery_strategy: "municipal_portal_discovery"
    discovery_sources:
      - "ArcGIS Hub"
      - "Socrata Open Data"
      - "CKAN"
      - "City GIS websites"

  voting_precinct:
    authority_entity: "County Elections Office"
    legal_basis: "State Election Code"

    aggregator_sources:
      - name: "State Secretary of State"
        varies_by_state: true
      - name: "VEST (Voting and Election Science Team)"
        url: "https://dataverse.harvard.edu/dataverse/electionscience"
        lag: "Post-election (academic schedule)"
```

### 2.4 Canonical Source Structure

```typescript
interface CanonicalSource {
  // Identity
  readonly layerId: string;        // e.g., "US/congress", "US/state-senate/CA"
  readonly displayName: string;

  // Authority
  readonly authorityTier: 1 | 2 | 3 | 4 | 5;
  readonly authoritativeOrg: string;
  readonly legalBasis: string;

  // Location
  readonly canonicalUrl: string;
  readonly mirrorUrls: string[];
  readonly format: 'shapefile' | 'geojson' | 'geopackage';

  // Versioning
  readonly currentEpoch: string;      // e.g., "119" for 119th Congress
  readonly currentChecksum: string;   // SHA-256
  readonly lastVerified: string;      // ISO timestamp

  // Update Schedule
  readonly updateTriggers: UpdateTrigger[];
  readonly nextScheduledCheck: string;
}
```

---

## 3. Validation Pipeline

### 3.1 Freshness-Aware Source Resolution

```typescript
interface FreshnessAwareResolution {
  async selectSource(boundaryType: string): Promise<SelectedSource> {
    const config = this.sourceRegistry.get(boundaryType);

    // Step 1: Check if primary (authoritative) source is available and fresh
    if (config.primarySource.publishUrl) {
      const primaryFreshness = await this.checkFreshness(config.primarySource);

      if (primaryFreshness.available && primaryFreshness.isValid) {
        return {
          source: config.primarySource,
          reason: 'Primary authoritative source is available and current',
          freshness: primaryFreshness,
        };
      }
    }

    // Step 2: Find freshest aggregator that's newer than our current data
    const aggregatorChecks = await Promise.all(
      config.aggregatorSources.map(async (agg) => ({
        source: agg,
        freshness: await this.checkFreshness(agg),
      }))
    );

    const validAggregators = aggregatorChecks
      .filter(a => a.freshness.available)
      .sort((a, b) => b.freshness.lastModified - a.freshness.lastModified);

    if (validAggregators.length > 0) {
      const best = validAggregators[0];
      if (best.freshness.lastModified > this.currentData.lastModified) {
        return {
          source: best.source,
          reason: `Aggregator ${best.source.name} has newer data`,
          freshness: best.freshness,
        };
      }
    }

    // Step 3: No fresher data available
    return {
      source: null,
      reason: 'No fresher source available',
      freshness: this.currentData.freshness,
    };
  }
}
```

### 3.2 Conflict Resolution

When sources disagree, resolve by **freshness within authority class**:

```typescript
interface ConflictResolution {
  async resolveConflict(
    boundaryId: string,
    sources: SourceClaim[]
  ): Promise<ResolvedBoundary> {
    const config = this.getSourceConfig(boundaryId);

    // Step 1: Separate primary (authoritative) from aggregators
    const primarySources = sources.filter(s =>
      config.primaryAuthorities.includes(s.sourceId)
    );
    const aggregatorSources = sources.filter(s =>
      !config.primaryAuthorities.includes(s.sourceId)
    );

    // Step 2: If primary source available, use freshest primary
    if (primarySources.length > 0) {
      const freshestPrimary = primarySources.sort(
        (a, b) => b.lastModified - a.lastModified
      )[0];

      return freshestPrimary.boundary;
    }

    // Step 3: No primary available, use freshest aggregator
    if (aggregatorSources.length > 0) {
      const freshestAggregator = aggregatorSources.sort(
        (a, b) => b.lastModified - a.lastModified
      )[0];

      return freshestAggregator.boundary;
    }

    throw new Error(`No valid sources for ${boundaryId}`);
  }
}
```

### 3.3 Layer Validation

```typescript
interface LayerValidator {
  async validateLayer(
    source: DiscoveredSource,
    expectedType: LayerType
  ): Promise<ValidationResult> {
    const geojson = await parseToGeoJSON(source.data);

    const checks: ValidationCheck[] = [
      // Semantic checks
      this.checkLayerName(geojson, expectedType),
      this.checkFeatureCount(geojson, expectedType),
      this.checkGeometryType(geojson, expectedType),

      // Geographic checks
      this.checkBoundingBox(geojson, source.expectedBounds),
      this.checkNoOverlaps(geojson),
      this.checkFullCoverage(geojson, source.expectedBounds),

      // Attribute checks
      this.checkRequiredFields(geojson, expectedType),
      this.checkUniqueIds(geojson),
    ];

    const results = await Promise.all(checks);
    const failures = results.filter(r => !r.passed);

    return {
      valid: failures.length === 0,
      confidence: (results.length - failures.length) / results.length,
      failures,
    };
  }
}
```

### 3.4 Epoch Transition Protocol

```typescript
interface EpochTransition {
  readonly fromEpoch: number;
  readonly toEpoch: number;
  readonly activationTime: string;
  readonly gracePeriodsEndAt: string; // 7 days after activation

  readonly changes: BoundaryChange[];
}

/**
 * Grace Period Rule:
 * - Epoch N proofs valid for 7 days after epoch N+1 activates
 * - During grace period, both epoch N and N+1 roots accepted
 * - After grace period, only epoch N+1 accepted
 */
```

---

## 4. Implementation Notes

### 4.1 Change Detection Integration

The existing `ChangeDetector` (`acquisition/change-detector.ts`) provides Layer 1 (file change detection). Enhancement needed for Layers 2-4:

```typescript
class EnhancedChangeDetector extends ChangeDetector {
  async checkForChangeWithFreshness(
    source: CanonicalSource
  ): Promise<EnhancedChangeReport | null> {
    // Step 1: Basic file change detection (existing)
    const baseChange = await this.checkForChange(source);

    // Step 2: Check validity window
    const validityWindow = calculateValidityWindow(source);

    // Step 3: Check if we're in redistricting gap
    const gapStatus = await this.gapDetector.checkBoundaryGap(
      source.boundaryType,
      source.jurisdiction
    );

    // Step 4: Compare against primary if in gap
    let primaryComparison = null;
    if (gapStatus.inGap && source.sourceType === 'tiger') {
      primaryComparison = await this.primaryComparator.compareTigerFreshness(
        source.boundaryType,
        source.jurisdiction
      );
    }

    // Step 5: Synthesize recommendation
    return {
      ...baseChange,
      validityWindow,
      gapStatus,
      primaryComparison,
      recommendation: this.synthesizeRecommendation(...),
    };
  }
}
```

### 4.2 Provenance Manifest

Each epoch publishes a complete provenance manifest:

```typescript
interface EpochManifest {
  readonly epoch: number;
  readonly createdAt: string;
  readonly activatedAt: string;
  readonly globalCommitment: string; // Root of all boundary roots

  // Content addressing
  readonly ipfsCid: string;
  readonly manifestCid: string;

  // Provenance
  readonly sources: SourceProvenance[];
  readonly changes: ChangeProvenance[];

  // Verification
  readonly builderVersion: string;
  readonly buildLog: string; // IPFS CID
}

interface SourceProvenance {
  readonly layerId: string;
  readonly canonicalUrl: string;
  readonly downloadedAt: string;
  readonly checksum: string;
  readonly authorityTier: number;
  readonly featureCount: number;
}
```

### 4.3 Cost Model

| Component | Frequency | Cost |
|-----------|-----------|------|
| HEAD requests (file freshness) | Quarterly | $0 |
| RSS feed polling | Daily | $0 |
| Primary source checks | During redistricting | $0 |
| Validity window calculation | On-demand | $0 |
| Full downloads (when changed) | Annual (July) | $0 (public data) |
| IPFS pinning | Per epoch | $10/month |
| On-chain epoch update | Quarterly | ~$5 (Scroll L2) |
| **Total** | | **~$60/year** |

### 4.4 Implementation Checklist

**Core Components:**
- [ ] `provenance/authority-registry.ts` - Authority registry implementation
- [ ] `provenance/authority-registry.yaml` - Authority data (all 50 states)
- [ ] `provenance/freshness-verifier.ts` - Multi-layer freshness verification
- [ ] `provenance/validity-window.ts` - Validity window calculation
- [ ] `provenance/primary-comparator.ts` - Primary vs aggregator comparison
- [ ] `provenance/event-subscription.ts` - RSS/API event subscription
- [ ] `provenance/gap-detector.ts` - Redistricting gap detection

**Data Files:**
- [ ] `data/redistricting-calendar-2020.yaml` - 2020 cycle finalization dates
- [ ] `data/redistricting-calendar-2030.yaml` - Template for 2030 cycle
- [ ] `data/primary-sources-us.yaml` - All 50 state redistricting authorities

**Integration:**
- [ ] Enhance `acquisition/change-detector.ts` with freshness verification
- [ ] Update `acquisition/incremental-orchestrator.ts` to use enhanced detector
- [ ] Add freshness report to provenance log
- [ ] CLI command for freshness check: `npm run atlas:check-freshness`

---

## 5. Summary

**The question is not "which institution has higher rank?"**

**The question is:**
1. Who has legal authority to define this boundary?
2. Among sources claiming that authority, which is freshest?
3. If authoritative source unavailable, which aggregator is freshest?

```
+---------------------------------------------------------------------+
|                    DATA INTEGRITY LIFECYCLE                          |
+---------------------------------------------------------------------+
|                                                                      |
|  1. SOURCE AUTHORITY MODEL                                           |
|     - Authority = entity with legal jurisdiction to define boundary |
|     - Census is an AGGREGATOR, not an authority                     |
|                                                                      |
|  2. FRESHNESS-AWARE RESOLUTION                                       |
|     - Primary source (authoritative) preferred when available       |
|     - Fall back to freshest aggregator when primary unavailable     |
|     - Never use stale aggregator over fresh primary                 |
|                                                                      |
|  3. CHANGE DETECTION                                                 |
|     - Event-driven, not polling                                     |
|     - HEAD requests for checksum comparison                         |
|     - Scheduled checks aligned with update triggers                 |
|                                                                      |
|  4. CONSISTENCY RESOLUTION                                           |
|     - Epoch-based versioning                                        |
|     - 7-day grace period for epoch transitions                      |
|     - Freshest source within authority class wins                   |
|                                                                      |
|  5. PROVENANCE MANIFEST                                              |
|     - Per-epoch manifest with full audit trail                      |
|     - Every boundary traceable to authoritative source              |
|     - IPFS content addressing for integrity                         |
|                                                                      |
+---------------------------------------------------------------------+
```

---

*This specification was created by merging DATA-FRESHNESS-SPEC.md and DATA-PROVENANCE-SPEC.md on 2026-01-26.*

**Authors:** Claude Code
**License:** MIT
