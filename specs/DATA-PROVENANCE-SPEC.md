# Data Provenance Specification

**Version:** 1.0.0
**Date:** 2025-12-12
**Status:** Draft
**Scope:** Authoritative source discovery, validity tracking, and consistency resolution

---

## 1. Design Principles

### 1.1 Core Insight

Governance boundaries are **event-driven**, not time-driven. They change because of:
- **Decennial Census** (2020, 2030, 2040) - federal mandate, predictable
- **Redistricting cycles** (2021-2022, 2031-2032) - follows census
- **Legislative sessions** - state-specific schedules
- **Municipal actions** - annexation, incorporation, dissolution
- **Court orders** - rare, high-visibility

**Cost implication:** Don't poll continuously. Subscribe to events, verify on schedule.

### 1.2 Source Authority Model

**Critical Distinction:** Authority and freshness are orthogonal concerns.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     SOURCE AUTHORITY MODEL                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  PRINCIPLE: Each boundary type has exactly ONE authoritative        │
│  source - the entity with legal jurisdiction to define it.          │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Boundary Type          │ Authoritative Source              │    │
│  ├─────────────────────────┼───────────────────────────────────┤    │
│  │  Congressional District │ State Legislature (draws lines)   │    │
│  │  State Senate/House     │ State Legislature                 │    │
│  │  County                 │ State (defines county boundaries) │    │
│  │  City Limits            │ State (approves incorporation)    │    │
│  │  City Council District  │ City Council (local ordinance)    │    │
│  │  School District        │ State Education Agency            │    │
│  │  Voting Precinct        │ County Elections Office           │    │
│  │  Special District       │ Forming authority (state/county)  │    │
│  └─────────────────────────┴───────────────────────────────────┘    │
│                                                                      │
│  Census Bureau is a REPUBLISHER, not the authority.                 │
│  They aggregate and standardize, but don't define boundaries.       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 The Freshness Problem

Census TIGER is convenient (single source, standardized format) but **lags reality**:

```
Timeline: California Redistricting 2021-2022
─────────────────────────────────────────────────────────────────────

Dec 2021: CA Citizens Redistricting Commission finalizes maps
          → State publishes on redistrictingdatahub.org
          → AUTHORITATIVE data available

Jan 2022: New districts take legal effect
          → Census TIGER still shows OLD districts
          → 6-month lag begins

Jul 2022: Census releases TIGER 2022
          → Finally includes new CA districts
          → 7 months of stale federal data

─────────────────────────────────────────────────────────────────────
```

**Implication:** Using "highest institutional tier" as the rule would serve stale data for 7 months.

### 1.4 Correct Resolution Model

```typescript
/**
 * Source selection is NOT about institutional rank.
 * It's about: (1) Who is authoritative? (2) Who is freshest?
 */
interface SourceResolution {
  /**
   * For each boundary type, we track:
   * - Primary source: The legal authority (state legislature, city council, etc.)
   * - Aggregator source: Census TIGER, state GIS clearinghouse, etc.
   *
   * Resolution rule:
   * 1. If primary source has data → use primary source
   * 2. If primary source unavailable → use freshest aggregator
   * 3. Never use aggregator that's older than primary source
   */
  readonly boundaryType: string;
  readonly primarySource: AuthoritativeSource;      // Who defines this legally
  readonly aggregatorSources: AggregatorSource[];   // Who republishes it
}

interface AuthoritativeSource {
  readonly entity: string;           // "CA Citizens Redistricting Commission"
  readonly legalBasis: string;       // "CA Constitution Article XXI"
  readonly publishUrl: string | null; // Direct source URL if available
  readonly publishSchedule: string;  // "Post-redistricting cycle"
}

interface AggregatorSource {
  readonly name: string;             // "Census TIGER", "State GIS Clearinghouse"
  readonly url: string;
  readonly lag: string;              // "6-12 months after authoritative"
  readonly format: string;
  readonly useWhen: string;          // "Primary source unavailable or unstructured"
}
```

### 1.5 Freshness-Aware Resolution

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

    // Sort by freshness (most recent first)
    const validAggregators = aggregatorChecks
      .filter(a => a.freshness.available)
      .sort((a, b) => b.freshness.lastModified - a.freshness.lastModified);

    if (validAggregators.length > 0) {
      const best = validAggregators[0];

      // Only use if fresher than what we have
      if (best.freshness.lastModified > this.currentData.lastModified) {
        return {
          source: best.source,
          reason: `Aggregator ${best.source.name} has newer data than current`,
          freshness: best.freshness,
        };
      }
    }

    // Step 3: No fresher data available
    return {
      source: null,
      reason: 'No fresher source available; current data is most recent',
      freshness: this.currentData.freshness,
    };
  }
}
```

### 1.6 Real Source Hierarchy by Boundary Type

```yaml
# source-hierarchy.yaml
#
# KEY INSIGHT: Authority comes from the entity that DEFINES the boundary,
# not from institutional prestige. Census is an aggregator, not an authority.

US:
  congressional:
    authority:
      entity: "State Legislature or Independent Commission"
      legal_basis: "US Constitution Article I, Section 4"
      notes: "Each state controls its own redistricting process"

    sources:
      # Primary: The entity that actually draws the lines
      primary:
        - name: "State Redistricting Authority"
          varies_by_state: true
          examples:
            CA: "https://www.wedrawthelinesca.org/"
            TX: "https://redistricting.capitol.texas.gov/"
            NY: "https://www.nyirc.gov/"
          freshness: "Immediate (when maps finalized)"
          format: "varies (shapefile, geojson, pdf)"

      # Aggregators: Republish with standardization but lag
      aggregators:
        - name: "Census TIGER"
          url: "https://www2.census.gov/geo/tiger/TIGER{YEAR}/CD/"
          freshness: "July annually (6-18 month lag)"
          format: "shapefile"
          use_when: "Primary unavailable or need standardized format"

        - name: "Redistricting Data Hub"
          url: "https://redistrictingdatahub.org/"
          freshness: "Near-realtime during redistricting cycles"
          format: "shapefile, geojson"
          use_when: "During redistricting cycle (2021-2022, 2031-2032)"

        - name: "Dave's Redistricting"
          url: "https://davesredistricting.org/"
          freshness: "Near-realtime"
          format: "geojson"
          use_when: "Fallback; community-maintained"

  state_legislature:
    authority:
      entity: "State Legislature"
      legal_basis: "State Constitution"

    sources:
      primary:
        - name: "State Legislature GIS"
          varies_by_state: true
          freshness: "Post-redistricting"

      aggregators:
        - name: "Census TIGER SLDU/SLDL"
          url: "https://www2.census.gov/geo/tiger/TIGER{YEAR}/SLD{U|L}/"
          freshness: "July annually"

  city_council:
    authority:
      entity: "City Council"
      legal_basis: "Municipal Code / City Charter"
      notes: "Each city defines its own council districts"

    sources:
      primary:
        - name: "City GIS Department"
          varies_by_city: true
          freshness: "Post-redistricting ordinance"
          format: "varies"

      aggregators:
        # No federal aggregator exists for city council districts
        # Census does NOT publish these
        - name: "State GIS Clearinghouse"
          varies_by_state: true
          freshness: "Varies"

  voting_precinct:
    authority:
      entity: "County Elections Office"
      legal_basis: "State Election Code"
      notes: "Counties define precinct boundaries within state guidelines"

    sources:
      primary:
        - name: "County Elections Office"
          varies_by_county: true
          freshness: "Post-election cycle"

      aggregators:
        - name: "State Secretary of State"
          varies_by_state: true
          freshness: "Post-election"

        - name: "Voting and Election Science Team (VEST)"
          url: "https://dataverse.harvard.edu/dataverse/electionscience"
          freshness: "Post-election (academic schedule)"
          format: "shapefile"
```

---

## 2. Canonical Source Registry

### 2.1 Structure

Each boundary layer has exactly ONE canonical source per jurisdiction:

```typescript
interface CanonicalSource {
  // Identity
  readonly layerId: string;        // e.g., "US/congress", "US/state-senate/CA"
  readonly displayName: string;    // e.g., "US Congressional Districts (119th)"

  // Authority
  readonly authorityTier: 1 | 2 | 3 | 4 | 5;
  readonly authoritativeOrg: string;  // e.g., "US Census Bureau"
  readonly legalBasis: string;        // e.g., "13 U.S.C. Chapter 5"

  // Location
  readonly canonicalUrl: string;      // Primary download URL
  readonly mirrorUrls: string[];      // Fallback mirrors
  readonly format: 'shapefile' | 'geojson' | 'geopackage';

  // Versioning
  readonly currentEpoch: string;      // e.g., "119" for 119th Congress
  readonly currentChecksum: string;   // SHA-256 of downloaded file
  readonly lastVerified: string;      // ISO timestamp

  // Update Schedule
  readonly updateTriggers: UpdateTrigger[];
  readonly nextScheduledCheck: string; // ISO timestamp
}

type UpdateTrigger =
  | { type: 'census'; year: number }              // Decennial census
  | { type: 'redistricting'; years: number[] }    // Post-census redistricting
  | { type: 'annual'; month: number }             // Annual release (e.g., TIGER in July)
  | { type: 'legislative-session'; schedule: string } // State-specific
  | { type: 'event'; description: string };       // Court order, special election
```

### 2.2 US Canonical Sources

```yaml
# canonical-sources.yaml

US:
  congress:
    authority_tier: 1
    authoritative_org: "US Census Bureau"
    legal_basis: "13 U.S.C. Chapter 5"
    canonical_url: "https://www2.census.gov/geo/tiger/TIGER{YEAR}/CD/tl_{YEAR}_us_cd{CONGRESS}.zip"
    format: shapefile
    update_triggers:
      - type: redistricting
        years: [2021, 2022, 2031, 2032]
      - type: annual
        month: 7  # TIGER released in July
    epoch_format: "congress_{CONGRESS_NUMBER}"  # congress_119

  state_senate:
    authority_tier: 1
    authoritative_org: "US Census Bureau"
    legal_basis: "13 U.S.C. Chapter 5"
    canonical_url: "https://www2.census.gov/geo/tiger/TIGER{YEAR}/SLDU/tl_{YEAR}_{FIPS}_sldu.zip"
    format: shapefile
    update_triggers:
      - type: redistricting
        years: [2021, 2022, 2031, 2032]
      - type: annual
        month: 7
    per_state: true

  state_house:
    authority_tier: 1
    authoritative_org: "US Census Bureau"
    legal_basis: "13 U.S.C. Chapter 5"
    canonical_url: "https://www2.census.gov/geo/tiger/TIGER{YEAR}/SLDL/tl_{YEAR}_{FIPS}_sldl.zip"
    format: shapefile
    update_triggers:
      - type: redistricting
        years: [2021, 2022, 2031, 2032]
      - type: annual
        month: 7
    per_state: true

  county:
    authority_tier: 1
    authoritative_org: "US Census Bureau"
    legal_basis: "13 U.S.C. Chapter 5"
    canonical_url: "https://www2.census.gov/geo/tiger/TIGER{YEAR}/COUNTY/tl_{YEAR}_us_county.zip"
    format: shapefile
    update_triggers:
      - type: annual
        month: 7
    notes: "Counties rarely change; occasional splits (e.g., Broomfield, CO 2001)"

  place:
    authority_tier: 1
    authoritative_org: "US Census Bureau"
    legal_basis: "13 U.S.C. Chapter 5"
    canonical_url: "https://www2.census.gov/geo/tiger/TIGER{YEAR}/PLACE/tl_{YEAR}_{FIPS}_place.zip"
    format: shapefile
    update_triggers:
      - type: annual
        month: 7
    per_state: true
    notes: "Includes incorporated places + CDPs"

  school_unified:
    authority_tier: 1
    authoritative_org: "US Census Bureau"
    legal_basis: "13 U.S.C. Chapter 5"
    canonical_url: "https://www2.census.gov/geo/tiger/TIGER{YEAR}/UNSD/tl_{YEAR}_{FIPS}_unsd.zip"
    format: shapefile
    update_triggers:
      - type: annual
        month: 7
    per_state: true

  voting_precinct:
    authority_tier: 2
    authoritative_org: "State Secretary of State"
    legal_basis: "State election law"
    canonical_url: null  # No single federal source
    discovery_strategy: "state_sos_registry"
    format: varies
    update_triggers:
      - type: redistricting
        years: [2021, 2022, 2031, 2032]
      - type: event
        description: "Post-election precinct consolidation"
    per_state: true
    notes: "Must query 50 state SOS offices individually"

  city_council:
    authority_tier: 3
    authoritative_org: "Municipal GIS Department"
    legal_basis: "Municipal code"
    canonical_url: null  # No federal source
    discovery_strategy: "municipal_portal_discovery"
    format: varies
    update_triggers:
      - type: redistricting
        years: [2021, 2022, 2031, 2032]
      - type: legislative_session
        schedule: "varies_by_city"
    per_city: true
    notes: "Discovered via ArcGIS Hub, Socrata, CKAN portals"
```

---

## 3. Change Detection

### 3.1 Detection Strategies

**Strategy 1: Scheduled Verification (Primary)**

```typescript
interface ScheduledVerification {
  // Check canonical URLs on known schedules
  async verifyOnSchedule(): Promise<ChangeReport[]> {
    const sources = await loadCanonicalSources();
    const changes: ChangeReport[] = [];

    for (const source of sources) {
      if (new Date() >= new Date(source.nextScheduledCheck)) {
        const change = await checkForChange(source);
        if (change) changes.push(change);
      }
    }

    return changes;
  }
}
```

**Cost:** One HEAD request per layer per check interval
- Congress (1 file): 1 HEAD request/year
- State Legislature (100 files): 100 HEAD requests/year
- Municipal (32,000 files): 32,000 HEAD requests/year

**Total:** ~35,000 HEAD requests/year = $0 (HEAD requests don't count toward bandwidth)

**Strategy 2: Checksum Diffing**

```typescript
interface ChecksumVerification {
  async checkForChange(source: CanonicalSource): Promise<ChangeReport | null> {
    // HEAD request to get Content-Length and Last-Modified
    const response = await fetch(source.canonicalUrl, { method: 'HEAD' });

    const newChecksum = response.headers.get('etag') ||
                        response.headers.get('last-modified');

    if (newChecksum !== source.currentChecksum) {
      return {
        layerId: source.layerId,
        oldChecksum: source.currentChecksum,
        newChecksum,
        detectedAt: new Date().toISOString(),
        requiresDownload: true,
      };
    }

    return null;
  }
}
```

**Strategy 3: Event Subscription (Where Available)**

```typescript
// Some sources offer RSS/Atom feeds or email lists
interface EventSubscription {
  readonly feeds: Map<string, string> = new Map([
    ['census-tiger', 'https://www.census.gov/programs-surveys/geography/geographies/rss.xml'],
    ['redistricting-alerts', 'https://redistricting.lls.edu/feed/'],
  ]);

  async pollFeeds(): Promise<ChangeEvent[]> {
    const events: ChangeEvent[] = [];

    for (const [name, url] of this.feeds) {
      const feed = await parseFeed(url);
      const newItems = feed.items.filter(item =>
        item.pubDate > this.lastPollTime
      );

      for (const item of newItems) {
        if (this.isRelevantToShadowAtlas(item)) {
          events.push({
            source: name,
            title: item.title,
            url: item.link,
            detectedAt: new Date().toISOString(),
          });
        }
      }
    }

    return events;
  }
}
```

**Strategy 4: Community Reports**

```typescript
interface CommunityReport {
  readonly reporter: string;        // Anonymous ID or verified contributor
  readonly layerId: string;         // Which boundary changed
  readonly description: string;     // What changed
  readonly evidence: string[];      // Links to news articles, official announcements
  readonly submittedAt: string;     // ISO timestamp

  // Verification status
  status: 'pending' | 'verified' | 'rejected';
  verifiedBy?: string;              // Who verified the report
  verifiedAt?: string;
}

// Community reports go through verification before triggering updates
async function processCommunityReport(report: CommunityReport): Promise<void> {
  // 1. Check if evidence links are valid
  // 2. Cross-reference with official sources
  // 3. If verified, queue for next scheduled update
  // 4. If urgent (court order), expedite verification
}
```

### 3.2 Check Frequency by Layer

| Layer | Authority | Check Frequency | Trigger Events |
|-------|-----------|-----------------|----------------|
| Congressional | Tier 1 | Annual (July) | Redistricting years |
| State Legislature | Tier 1 | Annual (July) | Redistricting years |
| County | Tier 1 | Annual (July) | Rare changes |
| Place | Tier 1 | Annual (July) | Annexations |
| School District | Tier 1 | Annual (July) | Consolidations |
| Voting Precinct | Tier 2 | Post-election | Redistricting |
| City Council | Tier 3 | Annual | Redistricting |
| Special Districts | Tier 4 | Biennial | Formation/dissolution |

**Total operational cost:** <$10/year for all change detection

---

## 4. Consistency Resolution

### 4.1 Problem Statement

When boundaries update, we face consistency challenges:
1. **Mid-epoch proofs:** User generated proof against epoch N, but we're now on epoch N+1
2. **Boundary shifts:** User's address moved from district A to district B
3. **Source conflicts:** Two sources claim different boundaries

### 4.2 Epoch Transition Protocol

```typescript
interface EpochTransition {
  readonly fromEpoch: number;
  readonly toEpoch: number;
  readonly activationTime: string;  // ISO timestamp
  readonly gracePeriodsEndAt: string; // 7 days after activation

  // Which boundaries changed
  readonly changes: BoundaryChange[];
}

interface BoundaryChange {
  readonly boundaryId: string;
  readonly changeType: 'geometry' | 'dissolved' | 'created' | 'merged';
  readonly oldRoot: string | null;
  readonly newRoot: string;
  readonly affectedAddresses: number;  // Estimated count
}
```

**Grace Period Rule:**
- Epoch N proofs valid for 7 days after epoch N+1 activates
- During grace period, both epoch N and N+1 roots accepted
- After grace period, only epoch N+1 accepted

```solidity
function isValidRoot(
    bytes32 boundaryId,
    bytes32 merkleRoot,
    uint256 proofEpoch
) external view returns (bool) {
    // Check current epoch
    if (boundaryRoots[currentEpoch][boundaryId] == merkleRoot) {
        return true;
    }

    // Check grace period for previous epoch
    if (proofEpoch == currentEpoch - 1) {
        EpochInfo memory prevEpoch = epochs[proofEpoch];
        if (block.timestamp <= prevEpoch.gracePeriodsEndAt) {
            return boundaryRoots[proofEpoch][boundaryId] == merkleRoot;
        }
    }

    return false;
}
```

### 4.3 Conflict Resolution

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

      await this.logResolution({
        boundaryId,
        winner: freshestPrimary.sourceId,
        reason: 'Primary authoritative source (freshest)',
        freshness: freshestPrimary.lastModified,
      });

      return freshestPrimary.boundary;
    }

    // Step 3: No primary available, use freshest aggregator
    if (aggregatorSources.length > 0) {
      const freshestAggregator = aggregatorSources.sort(
        (a, b) => b.lastModified - a.lastModified
      )[0];

      await this.logResolution({
        boundaryId,
        winner: freshestAggregator.sourceId,
        reason: 'Aggregator source (primary unavailable, using freshest)',
        freshness: freshestAggregator.lastModified,
      });

      return freshestAggregator.boundary;
    }

    throw new Error(`No valid sources for ${boundaryId}`);
  }
}

/**
 * Example conflict scenarios:
 *
 * Scenario 1: Redistricting Lag
 *   - CA Redistricting Commission publishes new CD maps (Dec 2021)
 *   - Census TIGER still has old maps (won't update until Jul 2022)
 *   - Resolution: Use CA Commission (primary authority, fresher)
 *
 * Scenario 2: Format Availability
 *   - State publishes maps as PDF only (no GIS data)
 *   - Census TIGER has machine-readable shapefile
 *   - Resolution: Use Census (primary unavailable in usable format)
 *
 * Scenario 3: Aggregator Freshness
 *   - Census TIGER 2023 available
 *   - Redistricting Data Hub has 2024 interim corrections
 *   - Resolution: Use Redistricting Data Hub (fresher aggregator)
 */
```

### 4.4 Source Validity Windows

Each source has a validity window based on known update cycles:

```typescript
interface SourceValidityWindow {
  readonly sourceId: string;
  readonly validFrom: Date;       // When this data became authoritative
  readonly validUntil: Date;      // When we expect replacement
  readonly confidence: number;    // 0-1, decays as validUntil approaches

  /**
   * Validity windows are derived from known cycles:
   *
   * Census TIGER:
   *   - validFrom: July 1 of release year
   *   - validUntil: July 1 of next year
   *   - confidence: 1.0 until March, then decays
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
}

function computeConfidence(source: SourceValidityWindow, asOf: Date): number {
  const totalWindow = source.validUntil.getTime() - source.validFrom.getTime();
  const elapsed = asOf.getTime() - source.validFrom.getTime();
  const remaining = totalWindow - elapsed;

  // Full confidence for first 75% of window
  if (remaining > totalWindow * 0.25) {
    return 1.0;
  }

  // Linear decay in final 25%
  return remaining / (totalWindow * 0.25);
}
```

### 4.5 Diff-Based Updates

Instead of rebuilding entire trees, compute diffs:

```typescript
interface BoundaryDiff {
  readonly boundaryId: string;
  readonly epoch: number;

  // Geometry changes
  readonly geometryChanged: boolean;
  readonly oldGeometryHash: string;
  readonly newGeometryHash: string;

  // Membership changes
  readonly addressesAdded: NormalizedAddress[];
  readonly addressesRemoved: NormalizedAddress[];
  readonly addressesMoved: Array<{
    address: NormalizedAddress;
    fromBoundary: string;
    toBoundary: string;
  }>;

  // Tree impact
  readonly leafChanges: number;
  readonly requiresRebuild: boolean;  // True if >50% leaves changed
}

async function computeDiff(
  oldTree: MerkleTree,
  newBoundary: BoundaryGeometry
): Promise<BoundaryDiff> {
  // 1. Compute new address set via PIP
  const newAddresses = await computeMembership(newBoundary);

  // 2. Compare with old membership
  const oldAddresses = await getTreeMembership(oldTree);

  // 3. Compute symmetric difference
  const added = newAddresses.filter(a => !oldAddresses.has(a));
  const removed = oldAddresses.filter(a => !newAddresses.has(a));

  return {
    boundaryId: newBoundary.id,
    epoch: currentEpoch + 1,
    geometryChanged: !geometryEquals(oldTree.geometry, newBoundary.geometry),
    addressesAdded: added,
    addressesRemoved: removed,
    leafChanges: added.length + removed.length,
    requiresRebuild: (added.length + removed.length) / oldTree.leafCount > 0.5,
  };
}
```

---

## 5. Provenance Manifest

### 5.1 Per-Epoch Manifest

Each epoch publishes a complete provenance manifest:

```typescript
interface EpochManifest {
  readonly epoch: number;
  readonly createdAt: string;        // ISO timestamp
  readonly activatedAt: string;      // When on-chain registry updated
  readonly globalCommitment: string; // Root of all boundary roots

  // Content addressing
  readonly ipfsCid: string;          // Full forest data
  readonly manifestCid: string;      // This manifest

  // Provenance
  readonly sources: SourceProvenance[];
  readonly changes: ChangeProvenance[];

  // Verification
  readonly builderVersion: string;   // Software version that built this
  readonly buildLog: string;         // IPFS CID of full build log
}

interface SourceProvenance {
  readonly layerId: string;
  readonly canonicalUrl: string;
  readonly downloadedAt: string;
  readonly checksum: string;
  readonly authorityTier: number;
  readonly fileSize: number;
  readonly featureCount: number;
}

interface ChangeProvenance {
  readonly boundaryId: string;
  readonly changeType: 'new' | 'updated' | 'unchanged';
  readonly previousEpoch: number | null;
  readonly previousRoot: string | null;
  readonly newRoot: string;
  readonly diffSummary: {
    geometryChanged: boolean;
    leafsAdded: number;
    leafsRemoved: number;
  };
}
```

### 5.2 Audit Trail

Every boundary can be traced back to its source:

```
User proves membership in CA-12 (epoch 5)
  │
  ├── Epoch 5 Manifest (ipfs://Qm...)
  │     └── Source: US Census TIGER 2024
  │           └── URL: https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_us_cd119.zip
  │           └── Checksum: sha256:abc123...
  │           └── Downloaded: 2024-07-15T08:00:00Z
  │
  ├── Change from Epoch 4: geometry unchanged
  │     └── Previous root: 0x1234...
  │     └── New root: 0x1234... (same, no address changes)
  │
  └── On-chain registry: 0x5678...
        └── advanceEpoch() tx: 0xabcd...
        └── Block: 12345678
        └── Timestamp: 2024-07-16T00:00:00Z
```

---

## 6. Implementation: Update Pipeline

### 6.1 Quarterly Update Workflow

```typescript
class QuarterlyUpdatePipeline {
  async run(): Promise<EpochManifest> {
    // Phase 1: Discovery
    const changes = await this.detectChanges();
    if (changes.length === 0) {
      console.log('No changes detected, skipping epoch');
      return null;
    }

    // Phase 2: Download
    const downloads = await this.downloadChanged(changes);

    // Phase 3: Validation
    const validated = await this.validateDownloads(downloads);

    // Phase 4: Diff computation
    const diffs = await this.computeDiffs(validated);

    // Phase 5: Tree rebuilding
    const trees = await this.rebuildTrees(diffs);

    // Phase 6: Manifest generation
    const manifest = await this.generateManifest(trees);

    // Phase 7: IPFS upload
    const cid = await this.uploadToIPFS(manifest);

    // Phase 8: Governance proposal
    await this.createGovernanceProposal(manifest, cid);

    return manifest;
  }

  private async detectChanges(): Promise<ChangeReport[]> {
    const sources = await loadCanonicalSources();
    const changes: ChangeReport[] = [];

    for (const source of sources) {
      // Check if update trigger applies
      if (!this.triggerApplies(source)) continue;

      // HEAD request for checksum comparison
      const response = await fetch(source.canonicalUrl, { method: 'HEAD' });
      const remoteChecksum = response.headers.get('etag');

      if (remoteChecksum !== source.currentChecksum) {
        changes.push({
          layerId: source.layerId,
          reason: 'checksum_mismatch',
          oldChecksum: source.currentChecksum,
          newChecksum: remoteChecksum,
        });
      }
    }

    return changes;
  }
}
```

### 6.2 Cost Model

| Operation | Frequency | Cost |
|-----------|-----------|------|
| HEAD requests (change detection) | Quarterly | $0 |
| Full downloads (when changed) | Annual (July) | ~10 GB = $0 (public data) |
| IPFS pinning | Per epoch | $10/month (500 GB) |
| GitHub Actions (build) | Quarterly | $0 (free tier) |
| On-chain epoch update | Quarterly | ~$5 (Scroll L2) |
| **Total** | | **~$15/quarter = $60/year** |

---

## 7. Discovery: Finding Where Data Ought To Be

### 7.1 Source Discovery Registry

For layers without federal sources (city council, special districts), we need discovery:

```typescript
interface SourceDiscoveryStrategy {
  // For city council districts
  async discoverMunicipalSource(city: CityInfo): Promise<CanonicalSource | null> {
    const strategies = [
      () => this.checkArcGISHub(city),
      () => this.checkSocrataPortal(city),
      () => this.checkCityGISWebsite(city),
      () => this.checkStateGISClearinghouse(city),
    ];

    for (const strategy of strategies) {
      const source = await strategy();
      if (source) {
        // Validate it's actually council districts, not some other layer
        const validated = await this.validateLayer(source, 'council_district');
        if (validated) {
          return this.promoteToCanonical(source, city);
        }
      }
    }

    return null;  // No source found, flag for manual discovery
  }

  // Promote discovered source to canonical registry
  private async promoteToCanonical(
    source: DiscoveredSource,
    city: CityInfo
  ): Promise<CanonicalSource> {
    return {
      layerId: `US/council/${city.fips}`,
      displayName: `${city.name} City Council Districts`,
      authorityTier: 3,  // Municipal
      authoritativeOrg: `${city.name} GIS Department`,
      legalBasis: 'Municipal code',
      canonicalUrl: source.url,
      format: source.format,
      currentChecksum: await computeChecksum(source.data),
      lastVerified: new Date().toISOString(),
      updateTriggers: [
        { type: 'redistricting', years: [2031, 2032] },
      ],
      discoveryMethod: source.strategy,
      discoveredAt: new Date().toISOString(),
    };
  }
}
```

### 7.2 Validation: Ensuring Data Is What It Claims

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
      warnings: results.filter(r => r.warning),
    };
  }

  private checkFeatureCount(
    geojson: FeatureCollection,
    expectedType: LayerType
  ): ValidationCheck {
    // Council districts should have 3-50 features per city
    const count = geojson.features.length;

    if (expectedType === 'council_district') {
      if (count < 3 || count > 50) {
        return {
          passed: false,
          message: `Unexpected feature count ${count} for council districts (expected 3-50)`,
        };
      }
    }

    return { passed: true };
  }
}
```

---

## 8. Summary: The Complete Provenance System

```
┌─────────────────────────────────────────────────────────────────────┐
│                    DATA PROVENANCE LIFECYCLE                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. SOURCE AUTHORITY MODEL                                           │
│     • Authority = entity with legal jurisdiction to define boundary │
│     • Census is an AGGREGATOR, not an authority                     │
│     • Each boundary type has ONE authoritative source               │
│       (state legislature, city council, county elections, etc.)     │
│                                                                      │
│  2. FRESHNESS-AWARE RESOLUTION                                       │
│     • Primary source (authoritative) preferred when available       │
│     • Fall back to freshest aggregator when primary unavailable     │
│     • Never use stale aggregator over fresh primary                 │
│     • Validity windows track expected update cycles                 │
│                                                                      │
│  3. DISCOVERY (for municipal layers)                                 │
│     • Automated portal scanning (ArcGIS, Socrata, CKAN)             │
│     • Semantic validation before promotion to canonical             │
│     • Human review for edge cases                                   │
│                                                                      │
│  4. CHANGE DETECTION                                                 │
│     • Event-driven, not polling                                     │
│     • Scheduled checks aligned with update triggers                 │
│     • HEAD requests for checksum comparison                         │
│     • Cost: <$10/year                                               │
│                                                                      │
│  5. CONSISTENCY RESOLUTION                                           │
│     • Epoch-based versioning                                        │
│     • 7-day grace period for epoch transitions                      │
│     • Freshest source within authority class wins                   │
│     • Diff-based updates minimize rebuild cost                      │
│                                                                      │
│  6. PROVENANCE MANIFEST                                              │
│     • Per-epoch manifest with full audit trail                      │
│     • Every boundary traceable to authoritative source              │
│     • IPFS content addressing for integrity                         │
│     • On-chain commitment for tamper evidence                       │
│                                                                      │
│  7. OPERATIONAL COST                                                 │
│     • Detection: $0/year (HEAD requests)                            │
│     • Downloads: $0/year (public data)                              │
│     • Storage: $120/year (IPFS pinning)                             │
│     • On-chain: $20/year (4 epoch updates)                          │
│     • Total: ~$150/year for complete provenance                     │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Insight Restated

**The question is not "which institution has higher rank?"**

**The question is:**
1. Who has legal authority to define this boundary?
2. Among sources claiming that authority, which is freshest?
3. If authoritative source unavailable, which aggregator is freshest?

Census TIGER is invaluable for standardization and convenience, but during redistricting cycles (2021-2022, 2031-2032), primary sources from state redistricting commissions will be 6-18 months fresher.

---

## 9. Implementation Checklist

### Phase 1: Foundation
- [ ] Define `canonical-sources.yaml` for all TIGER layers
- [ ] Implement checksum-based change detection
- [ ] Build epoch manifest generator
- [ ] Create provenance logging infrastructure

### Phase 2: Automation
- [ ] GitHub Action for quarterly update checks
- [ ] IPFS upload pipeline
- [ ] On-chain governance proposal generation

### Phase 3: Discovery
- [ ] Municipal portal discovery for city council
- [ ] State SOS discovery for voting precincts
- [ ] Semantic validation pipeline

### Phase 4: Resolution
- [ ] Epoch transition with grace periods
- [ ] Conflict resolution by authority tier
- [ ] Diff-based tree updates

---

**Authors:** Claude Code
**License:** MIT
