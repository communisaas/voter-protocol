# Data Freshness Verification Specification

**Version:** 1.0.0
**Date:** 2025-12-13
**Status:** Authoritative
**Scope:** Event-driven freshness detection, authority registry, primary source comparison
**Cost Target:** $0/year (HEAD requests + public feeds)

---

## 1. Executive Summary

Census TIGER is an **aggregator**, not an authority. During redistricting cycles (2021-2022, 2031-2032), TIGER lags 6-18 months behind authoritative sources. We cannot trust TIGER to tell us it's current; we must verify against primary sources.

**Core Principle:** `freshest_primary > freshest_aggregator`

This specification defines:
1. **Authority Registry** - Maps each boundary type to its legal authority
2. **Freshness Verification** - Detects staleness via HTTP headers + event subscriptions
3. **Primary Source Comparison** - Compares TIGER against state redistricting commissions
4. **Validity Windows** - Tracks when data becomes stale based on known cycles

---

## 2. The Freshness Problem

### 2.1 TIGER Release Cadence

Census TIGER releases annually in **July**. The critical gap:

```
Timeline: California Redistricting 2021-2022
───────────────────────────────────────────────────────────────────────

Month 0 (Dec 2021):  CA Citizens Redistricting Commission finalizes maps
                     → State publishes on wedrawthelinesca.org
                     → AUTHORITATIVE data available
                     → TIGER still shows OLD districts

Month 1 (Jan 2022):  New districts take LEGAL EFFECT
                     → TIGER still shows OLD districts
                     → Anyone using TIGER serves WRONG data

Month 7 (Jul 2022):  Census releases TIGER 2022
                     → Finally includes new CA districts
                     → 7 months of stale federal data

───────────────────────────────────────────────────────────────────────

IMPACT: Using "highest institutional tier" as the rule serves stale data
        for 7 months during redistricting.
```

### 2.2 Why HEAD Requests Are Not Enough

The current `ChangeDetector` (`acquisition/change-detector.ts`) uses HTTP HEAD requests:

```typescript
// Current implementation (necessary but insufficient)
const headers = await this.fetchHeadersWithRetry(source.url);
const newChecksum = headers.etag || headers.lastModified;
if (source.lastChecksum === newChecksum) {
  return null; // No change
}
```

**Limitation:** This tells us when *a file* changed, not whether *the data* is authoritative or stale relative to primary sources.

### 2.3 What We Actually Need

```
┌─────────────────────────────────────────────────────────────────────┐
│                    FRESHNESS VERIFICATION STACK                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Layer 1: FILE CHANGE DETECTION                                      │
│    ├── HTTP HEAD → ETag / Last-Modified                              │
│    ├── Detects: When source file was modified                        │
│    └── Cost: $0 (HEAD requests are free)                             │
│                                                                      │
│  Layer 2: VALIDITY WINDOW TRACKING                                   │
│    ├── Maps source → {valid_from, valid_until, confidence_decay}     │
│    ├── Detects: When source is expected to become stale              │
│    └── Cost: $0 (calendar math)                                      │
│                                                                      │
│  Layer 3: PRIMARY SOURCE COMPARISON                                  │
│    ├── Checks authoritative sources (state redistricting commissions)│
│    ├── Detects: When primary has newer data than aggregator          │
│    └── Cost: $0 (public government websites)                         │
│                                                                      │
│  Layer 4: EVENT SUBSCRIPTION                                         │
│    ├── RSS feeds, state redistricting announcements                  │
│    ├── Detects: Boundary changes as they happen                      │
│    └── Cost: $0 (public feeds)                                       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Authority Registry

### 3.1 Schema

```typescript
/**
 * Authority Registry: Maps boundary types to their legal authorities
 *
 * KEY INSIGHT: Authority comes from the entity with LEGAL JURISDICTION
 * to define the boundary, not from institutional prestige.
 */

interface AuthorityRegistry {
  readonly entries: Map<BoundaryType, AuthorityEntry>;

  /**
   * Get authority configuration for a boundary type
   */
  getAuthority(boundaryType: BoundaryType): AuthorityEntry;

  /**
   * Get all primary sources for a state (redistricting commissions, etc.)
   */
  getPrimarySourcesForState(state: string): PrimarySource[];

  /**
   * Check if we're in a redistricting window (2021-2022, 2031-2032)
   */
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
  readonly url: string | null;           // Direct download URL if available
  readonly urlTemplate: string | null;   // Template with placeholders
  readonly format: 'geojson' | 'shapefile' | 'kml' | 'pdf' | 'unknown';
  readonly machineReadable: boolean;     // false for PDF-only sources
  readonly freshnessIndicator: FreshnessIndicator;
}

interface AggregatorSource {
  readonly name: string;                 // "Census TIGER"
  readonly url: string;
  readonly urlTemplate: string;          // e.g., "https://www2.census.gov/geo/tiger/TIGER{YEAR}/CD/"
  readonly format: 'shapefile' | 'geojson';
  readonly lag: string;                  // "6-18 months during redistricting"
  readonly releaseMonth: number;         // 7 = July for TIGER
  readonly freshnessIndicator: FreshnessIndicator;
}

interface FreshnessIndicator {
  readonly type: 'http-headers' | 'rss-feed' | 'api-endpoint' | 'manual';
  readonly checkUrl: string;             // URL to check for freshness
  readonly parseStrategy: string;        // How to extract freshness info
}

type UpdateTrigger =
  | { readonly type: 'annual'; readonly month: number }
  | { readonly type: 'redistricting'; readonly years: readonly number[] }
  | { readonly type: 'census'; readonly year: number }
  | { readonly type: 'event'; readonly description: string }
  | { readonly type: 'manual' };
```

### 3.2 US Authority Registry (Complete)

```yaml
# authority-registry.yaml
# Canonical source of truth for US boundary authorities

US:
  congressional:
    authority_entity: "State Legislature or Independent Commission"
    legal_basis: "US Constitution Article I, Section 4"
    notes: "Each state controls its own redistricting process"

    primary_sources:
      # Independent commissions (non-partisan)
      - name: "CA Citizens Redistricting Commission"
        entity: "California Citizens Redistricting Commission"
        jurisdiction: "CA"
        url: "https://www.wedrawthelinesca.org/"
        format: shapefile
        machine_readable: true
        freshness_indicator:
          type: rss-feed
          check_url: "https://www.wedrawthelinesca.org/feed"

      - name: "AZ Independent Redistricting Commission"
        entity: "Arizona Independent Redistricting Commission"
        jurisdiction: "AZ"
        url: "https://azredistricting.org/"
        format: shapefile
        machine_readable: true

      # Legislature-controlled (partisan)
      - name: "TX Legislative Council"
        entity: "Texas Legislative Council"
        jurisdiction: "TX"
        url: "https://redistricting.capitol.texas.gov/"
        format: shapefile
        machine_readable: true

      - name: "NY Independent Redistricting Commission"
        entity: "New York Independent Redistricting Commission"
        jurisdiction: "NY"
        url: "https://www.nyirc.gov/"
        format: shapefile
        machine_readable: true

      - name: "FL Legislature"
        entity: "Florida Legislature"
        jurisdiction: "FL"
        url: "https://www.flsenate.gov/Session/Redistricting"
        format: shapefile
        machine_readable: true

      # Add remaining 45 states...
      # (Pattern: state redistricting authority URL + format)

    aggregator_sources:
      - name: "Census TIGER"
        url: "https://www2.census.gov/geo/tiger/"
        url_template: "https://www2.census.gov/geo/tiger/TIGER{YEAR}/CD/tl_{YEAR}_us_cd{CONGRESS}.zip"
        format: shapefile
        lag: "6-18 months during redistricting"
        release_month: 7
        freshness_indicator:
          type: http-headers
          check_url: "https://www2.census.gov/geo/tiger/TIGER2024/CD/"

      - name: "Redistricting Data Hub"
        url: "https://redistrictingdatahub.org/"
        format: shapefile
        lag: "Near-realtime during redistricting"
        freshness_indicator:
          type: api-endpoint
          check_url: "https://redistrictingdatahub.org/api/v1/datasets/"

      - name: "Dave's Redistricting"
        url: "https://davesredistricting.org/"
        format: geojson
        lag: "Community-maintained, variable"
        freshness_indicator:
          type: manual

    update_triggers:
      - type: redistricting
        years: [2021, 2022, 2031, 2032]
      - type: annual
        month: 7  # TIGER release

    expected_lag:
      normal: "0-3 months"
      redistricting: "6-18 months for TIGER"

  state_senate:
    authority_entity: "State Legislature"
    legal_basis: "State Constitution"

    primary_sources:
      # Same pattern as congressional - state-specific redistricting authorities
      # These are the SAME entities, just different boundary files

    aggregator_sources:
      - name: "Census TIGER SLDU"
        url_template: "https://www2.census.gov/geo/tiger/TIGER{YEAR}/SLDU/tl_{YEAR}_{FIPS}_sldu.zip"
        format: shapefile
        lag: "6-18 months during redistricting"
        release_month: 7

    update_triggers:
      - type: redistricting
        years: [2021, 2022, 2031, 2032]
      - type: annual
        month: 7

  state_house:
    authority_entity: "State Legislature"
    legal_basis: "State Constitution"

    aggregator_sources:
      - name: "Census TIGER SLDL"
        url_template: "https://www2.census.gov/geo/tiger/TIGER{YEAR}/SLDL/tl_{YEAR}_{FIPS}_sldl.zip"
        format: shapefile
        release_month: 7

    update_triggers:
      - type: redistricting
        years: [2021, 2022, 2031, 2032]
      - type: annual
        month: 7

  county:
    authority_entity: "State"
    legal_basis: "State Constitution / State Statutes"
    notes: "Counties rarely change; occasional splits (e.g., Broomfield, CO 2001)"

    aggregator_sources:
      - name: "Census TIGER COUNTY"
        url_template: "https://www2.census.gov/geo/tiger/TIGER{YEAR}/COUNTY/tl_{YEAR}_us_county.zip"
        format: shapefile
        release_month: 7

    update_triggers:
      - type: annual
        month: 7
      - type: event
        description: "County boundary changes (rare)"

  place:
    authority_entity: "State"
    legal_basis: "State Municipal Incorporation Laws"
    notes: "Includes incorporated places + Census Designated Places (CDPs)"

    aggregator_sources:
      - name: "Census TIGER PLACE"
        url_template: "https://www2.census.gov/geo/tiger/TIGER{YEAR}/PLACE/tl_{YEAR}_{FIPS}_place.zip"
        format: shapefile
        release_month: 7

    update_triggers:
      - type: annual
        month: 7

  city_council:
    authority_entity: "City Council"
    legal_basis: "Municipal Code / City Charter"
    notes: >
      NO FEDERAL AGGREGATOR EXISTS.
      Each city defines its own council districts.
      Must be discovered via portal scanning.

    primary_sources: []  # Discovered dynamically

    aggregator_sources: []  # None exist at federal level

    discovery_strategy: "municipal_portal_discovery"
    discovery_sources:
      - "ArcGIS Hub"
      - "Socrata Open Data"
      - "CKAN"
      - "City GIS websites"

    update_triggers:
      - type: redistricting
        years: [2021, 2022, 2031, 2032]
      - type: event
        description: "Post-redistricting ordinance"

  school_unified:
    authority_entity: "State Education Agency"
    legal_basis: "State Education Code"

    aggregator_sources:
      - name: "Census TIGER UNSD"
        url_template: "https://www2.census.gov/geo/tiger/TIGER{YEAR}/UNSD/tl_{YEAR}_{FIPS}_unsd.zip"
        format: shapefile
        release_month: 7

    update_triggers:
      - type: annual
        month: 7

  voting_precinct:
    authority_entity: "County Elections Office"
    legal_basis: "State Election Code"
    notes: "Counties define precinct boundaries within state guidelines"

    primary_sources:
      # 3,143 county election offices - discovered per county

    aggregator_sources:
      - name: "State Secretary of State"
        varies_by_state: true

      - name: "VEST (Voting and Election Science Team)"
        url: "https://dataverse.harvard.edu/dataverse/electionscience"
        format: shapefile
        lag: "Post-election (academic schedule)"
        freshness_indicator:
          type: api-endpoint
          check_url: "https://dataverse.harvard.edu/api/datasets/"

    update_triggers:
      - type: redistricting
        years: [2021, 2022, 2031, 2032]
      - type: event
        description: "Post-election precinct consolidation"

  special_district:
    authority_entity: "Varies (state/county/municipal)"
    legal_basis: "Varies by district type"
    notes: "Water, fire, transit, library, hospital districts"

    discovery_strategy: "special_district_discovery"

    update_triggers:
      - type: event
        description: "Formation/dissolution"
```

---

## 4. Freshness Verification System

### 4.1 Architecture

```typescript
/**
 * Freshness Verifier: Multi-layer freshness detection
 *
 * Checks freshness at four levels:
 * 1. File change (HTTP headers)
 * 2. Validity window (calendar-based)
 * 3. Primary source comparison (authoritative vs aggregator)
 * 4. Event subscription (RSS, announcements)
 */

interface FreshnessVerifier {
  /**
   * Check if a source is fresh relative to its authority
   * Returns detailed freshness report
   */
  async verifyFreshness(
    sourceId: string,
    boundaryType: BoundaryType
  ): Promise<FreshnessReport>;

  /**
   * Compare aggregator (TIGER) against primary sources
   * Returns which source is freshest
   */
  async compareSources(
    boundaryType: BoundaryType,
    jurisdiction: string
  ): Promise<SourceComparison>;

  /**
   * Check all sources in the redistricting gap window
   * Runs during known lag periods (Jan-Jul of redistricting years)
   */
  async checkRedistrictingGap(): Promise<GapReport[]>;

  /**
   * Subscribe to event feeds for real-time updates
   */
  async subscribeToEventFeeds(): AsyncGenerator<BoundaryChangeEvent>;
}

interface FreshnessReport {
  readonly sourceId: string;
  readonly boundaryType: BoundaryType;
  readonly jurisdiction: string;

  // Layer 1: File freshness
  readonly fileFreshness: {
    readonly etag: string | null;
    readonly lastModified: Date | null;
    readonly checkedAt: Date;
  };

  // Layer 2: Validity window
  readonly validityWindow: {
    readonly validFrom: Date;
    readonly validUntil: Date;
    readonly confidence: number;           // 0.0-1.0, decays as validUntil approaches
    readonly inRedistrictingGap: boolean;  // True if we're in Jan-Jul of redistricting year
  };

  // Layer 3: Primary comparison (if available)
  readonly primaryComparison: {
    readonly hasPrimarySource: boolean;
    readonly primaryLastModified: Date | null;
    readonly primaryIsFresher: boolean;
    readonly lagDays: number | null;
  } | null;

  // Layer 4: Event-based (if subscribed)
  readonly recentEvents: BoundaryChangeEvent[];

  // Overall assessment
  readonly isFresh: boolean;
  readonly staleness: 'fresh' | 'possibly-stale' | 'likely-stale' | 'confirmed-stale';
  readonly recommendation: 'use' | 'verify' | 'replace' | 'urgent-replace';
  readonly reasoning: string[];
}

interface SourceComparison {
  readonly boundaryType: BoundaryType;
  readonly jurisdiction: string;
  readonly comparedAt: Date;

  readonly sources: Array<{
    readonly sourceId: string;
    readonly sourceName: string;
    readonly isPrimary: boolean;
    readonly lastModified: Date;
    readonly available: boolean;
    readonly machineReadable: boolean;
  }>;

  readonly winner: {
    readonly sourceId: string;
    readonly reason: string;
  };

  readonly tigerIsFresh: boolean;
  readonly recommendedSource: string;
}
```

### 4.2 Validity Window Calculation

```typescript
/**
 * Validity Window: When does data become stale?
 *
 * Each source has a validity window based on known update cycles.
 */

interface ValidityWindow {
  readonly sourceId: string;
  readonly validFrom: Date;         // When this data became authoritative
  readonly validUntil: Date;        // When we expect replacement
  readonly confidenceDecay: number; // 0.0-1.0, decays as validUntil approaches
}

/**
 * Calculate validity window for a source
 */
function calculateValidityWindow(
  sourceType: 'tiger' | 'primary' | 'aggregator',
  releaseDate: Date,
  boundaryType: BoundaryType
): ValidityWindow {
  const now = new Date();
  const currentYear = now.getFullYear();

  switch (sourceType) {
    case 'tiger':
      // TIGER validity: July of release year → July of next year
      // Exception: Redistricting years (2021-2022, 2031-2032) - may be stale immediately
      const isRedistrictingYear = [2021, 2022, 2031, 2032].includes(currentYear);

      if (isRedistrictingYear) {
        // During redistricting, TIGER may be stale from day 1
        return {
          sourceId: 'census-tiger',
          validFrom: new Date(releaseDate.getFullYear(), 6, 1), // July 1
          validUntil: new Date(releaseDate.getFullYear() + 1, 6, 1), // Next July 1
          confidenceDecay: computeRedistrictingConfidence(releaseDate, boundaryType),
        };
      }

      // Normal years: TIGER is authoritative for 12 months
      return {
        sourceId: 'census-tiger',
        validFrom: new Date(releaseDate.getFullYear(), 6, 1),
        validUntil: new Date(releaseDate.getFullYear() + 1, 6, 1),
        confidenceDecay: computeNormalConfidence(releaseDate),
      };

    case 'primary':
      // Primary sources: Authoritative until next redistricting cycle (10 years)
      const nextRedistrictingStart = getNextRedistrictingYear(currentYear);
      return {
        sourceId: 'primary',
        validFrom: releaseDate,
        validUntil: new Date(nextRedistrictingStart, 0, 1),
        confidenceDecay: 1.0, // Primary sources are always authoritative
      };

    default:
      throw new Error(`Unknown source type: ${sourceType}`);
  }
}

/**
 * Compute confidence for TIGER during redistricting
 *
 * During redistricting years, TIGER confidence drops because
 * primary sources may have newer data.
 */
function computeRedistrictingConfidence(
  tigerReleaseDate: Date,
  boundaryType: BoundaryType
): number {
  const now = new Date();

  // If we're in redistricting year and TIGER was released before state finalized...
  // ...TIGER is likely stale

  // Congressional/state legislature: Check state redistricting commission
  if (
    boundaryType === 'congressional' ||
    boundaryType === 'state_senate' ||
    boundaryType === 'state_house'
  ) {
    // Redistricting typically finalized Dec-Feb, TIGER updates July
    // During Jan-Jun, TIGER is potentially stale
    const month = now.getMonth() + 1;
    if (month >= 1 && month <= 6) {
      return 0.3; // Low confidence - likely stale
    }
    return 0.8; // Post-July TIGER update - probably fresh
  }

  // Other boundary types: less affected by redistricting
  return 0.9;
}

/**
 * Compute confidence for TIGER during normal years
 */
function computeNormalConfidence(tigerReleaseDate: Date): number {
  const now = new Date();
  const releaseYear = tigerReleaseDate.getFullYear();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Same year as release: Full confidence
  if (currentYear === releaseYear) {
    return 1.0;
  }

  // Year after release, before new TIGER (Jan-Jun): Decaying confidence
  if (currentYear === releaseYear + 1 && currentMonth < 7) {
    return 1.0 - (currentMonth * 0.1); // 0.9 in Jan, 0.4 in Jun
  }

  // Should have new TIGER by now
  return 0.3;
}
```

### 4.3 Primary Source Comparison

```typescript
/**
 * Primary Source Comparator: Compare TIGER against authoritative sources
 *
 * During redistricting, state commissions publish before TIGER updates.
 * We must check primary sources to detect staleness.
 */

class PrimarySourceComparator {
  constructor(
    private readonly authorityRegistry: AuthorityRegistry,
    private readonly httpClient: FreshnessHttpClient
  ) {}

  /**
   * Compare TIGER freshness against primary source for a jurisdiction
   */
  async compareTigerFreshness(
    boundaryType: BoundaryType,
    jurisdiction: string
  ): Promise<TigerComparison> {
    const authority = this.authorityRegistry.getAuthority(boundaryType);
    const primarySource = authority.primarySources.find(
      (s) => s.jurisdiction === jurisdiction || s.jurisdiction === '*'
    );

    if (!primarySource) {
      // No primary source registered - TIGER is best available
      return {
        jurisdiction,
        tigerIsFresh: true,
        reason: 'No primary source available for comparison',
        recommendation: 'use-tiger',
      };
    }

    // Check TIGER freshness
    const tigerFreshness = await this.checkTigerFreshness(boundaryType);

    // Check primary source freshness
    const primaryFreshness = await this.checkPrimaryFreshness(primarySource);

    // Compare
    if (!primaryFreshness.available) {
      // Primary not machine-readable - TIGER is best machine-readable source
      return {
        jurisdiction,
        tigerIsFresh: true,
        reason: `Primary source (${primarySource.name}) not machine-readable`,
        recommendation: 'use-tiger',
        warning: 'Primary source may have newer data in non-machine-readable format',
      };
    }

    if (primaryFreshness.lastModified > tigerFreshness.lastModified) {
      // Primary is fresher than TIGER
      const lagDays = Math.floor(
        (primaryFreshness.lastModified.getTime() - tigerFreshness.lastModified.getTime()) /
        (1000 * 60 * 60 * 24)
      );

      return {
        jurisdiction,
        tigerIsFresh: false,
        reason: `Primary source (${primarySource.name}) is ${lagDays} days fresher than TIGER`,
        recommendation: 'use-primary',
        primarySource: primarySource,
        lagDays,
      };
    }

    // TIGER is up-to-date
    return {
      jurisdiction,
      tigerIsFresh: true,
      reason: 'TIGER is current with primary source',
      recommendation: 'use-tiger',
    };
  }

  /**
   * Check TIGER freshness via HTTP headers
   */
  private async checkTigerFreshness(
    boundaryType: BoundaryType
  ): Promise<{ lastModified: Date; etag: string | null }> {
    const tigerUrl = this.getTigerUrl(boundaryType);
    const headers = await this.httpClient.head(tigerUrl);

    return {
      lastModified: headers.lastModified
        ? new Date(headers.lastModified)
        : new Date(0),
      etag: headers.etag,
    };
  }

  /**
   * Check primary source freshness
   */
  private async checkPrimaryFreshness(
    source: PrimarySource
  ): Promise<{ available: boolean; lastModified: Date }> {
    if (!source.machineReadable || !source.url) {
      return { available: false, lastModified: new Date(0) };
    }

    try {
      const headers = await this.httpClient.head(source.url);
      return {
        available: true,
        lastModified: headers.lastModified
          ? new Date(headers.lastModified)
          : new Date(),
      };
    } catch {
      return { available: false, lastModified: new Date(0) };
    }
  }

  private getTigerUrl(boundaryType: BoundaryType): string {
    const year = new Date().getFullYear();
    const urlTemplates: Record<BoundaryType, string> = {
      congressional: `https://www2.census.gov/geo/tiger/TIGER${year}/CD/`,
      state_senate: `https://www2.census.gov/geo/tiger/TIGER${year}/SLDU/`,
      state_house: `https://www2.census.gov/geo/tiger/TIGER${year}/SLDL/`,
      county: `https://www2.census.gov/geo/tiger/TIGER${year}/COUNTY/`,
      place: `https://www2.census.gov/geo/tiger/TIGER${year}/PLACE/`,
      school_unified: `https://www2.census.gov/geo/tiger/TIGER${year}/UNSD/`,
    };
    return urlTemplates[boundaryType] || urlTemplates.place;
  }
}

interface TigerComparison {
  readonly jurisdiction: string;
  readonly tigerIsFresh: boolean;
  readonly reason: string;
  readonly recommendation: 'use-tiger' | 'use-primary' | 'manual-review';
  readonly primarySource?: PrimarySource;
  readonly lagDays?: number;
  readonly warning?: string;
}
```

---

## 5. Event Subscription System

### 5.1 Event Feeds

```typescript
/**
 * Event Subscription: Real-time boundary change notifications
 *
 * Some sources offer RSS/Atom feeds or API endpoints for change notifications.
 */

interface EventSubscriptionService {
  readonly feeds: Map<string, FeedConfig>;

  /**
   * Poll all subscribed feeds for new events
   */
  async pollFeeds(): Promise<BoundaryChangeEvent[]>;

  /**
   * Check specific source for updates
   */
  async checkSource(sourceId: string): Promise<BoundaryChangeEvent[]>;
}

interface FeedConfig {
  readonly feedId: string;
  readonly url: string;
  readonly type: 'rss' | 'atom' | 'api' | 'scrape';
  readonly pollIntervalMinutes: number;
  readonly relevanceFilter: (item: FeedItem) => boolean;
}

interface BoundaryChangeEvent {
  readonly eventId: string;
  readonly sourceId: string;
  readonly boundaryType: BoundaryType;
  readonly jurisdiction: string;
  readonly detectedAt: Date;
  readonly changeType: 'new' | 'modified' | 'finalized' | 'adopted';
  readonly title: string;
  readonly url: string;
  readonly confidence: number;
}

/**
 * Known event feeds for redistricting updates
 */
const REDISTRICTING_FEEDS: FeedConfig[] = [
  {
    feedId: 'census-geography-rss',
    url: 'https://www.census.gov/programs-surveys/geography/geographies/rss.xml',
    type: 'rss',
    pollIntervalMinutes: 60 * 24, // Daily
    relevanceFilter: (item) =>
      item.title.toLowerCase().includes('tiger') ||
      item.title.toLowerCase().includes('boundary'),
  },
  {
    feedId: 'redistricting-lls',
    url: 'https://redistricting.lls.edu/feed/',
    type: 'rss',
    pollIntervalMinutes: 60 * 24, // Daily
    relevanceFilter: (item) =>
      item.title.toLowerCase().includes('redistricting') ||
      item.title.toLowerCase().includes('adopted'),
  },
  {
    feedId: 'ncsl-redistricting',
    url: 'https://www.ncsl.org/redistricting-and-census/redistricting-news.aspx',
    type: 'scrape',
    pollIntervalMinutes: 60 * 24 * 7, // Weekly
    relevanceFilter: (item) => true, // All NCSL redistricting news is relevant
  },
];
```

---

## 6. Redistricting Gap Detection

### 6.1 The Gap Window

```typescript
/**
 * Redistricting Gap: When TIGER is guaranteed stale
 *
 * During redistricting years, there's a window where TIGER shows
 * old districts but new districts are already in effect:
 *
 *   Dec Y1: States finalize new maps
 *   Jan Y2: New districts take legal effect
 *   Jul Y2: TIGER updates
 *
 * Gap: Jan-Jun of Y2 (6 months of guaranteed staleness)
 */

interface RedistrictingGapDetector {
  /**
   * Are we currently in a redistricting gap?
   */
  isInGap(): boolean;

  /**
   * Get states that have finalized but TIGER hasn't updated
   */
  async getStatesInGap(): Promise<StateGapInfo[]>;

  /**
   * Check if a specific boundary is in the gap
   */
  async checkBoundaryGap(
    boundaryType: BoundaryType,
    jurisdiction: string
  ): Promise<GapStatus>;
}

interface StateGapInfo {
  readonly state: string;
  readonly stateCode: string;
  readonly finalizedAt: Date;
  readonly effectiveAt: Date;
  readonly primarySource: PrimarySource;
  readonly tigerUpdatedAt: Date | null;
  readonly gapDays: number;
  readonly recommendation: string;
}

interface GapStatus {
  readonly inGap: boolean;
  readonly gapType: 'pre-finalization' | 'post-finalization-pre-tiger' | 'none';
  readonly recommendation: 'use-tiger' | 'use-primary' | 'wait';
  readonly reasoning: string;
}

/**
 * Redistricting calendar (known dates)
 */
const REDISTRICTING_CALENDAR: Map<number, StateRedistrictingDate[]> = new Map([
  [2021, [
    { state: 'CA', finalizedDate: new Date('2021-12-20'), effectiveDate: new Date('2022-01-01') },
    { state: 'TX', finalizedDate: new Date('2021-10-25'), effectiveDate: new Date('2022-01-01') },
    { state: 'NY', finalizedDate: new Date('2022-02-02'), effectiveDate: new Date('2022-06-28') },
    // ... all 50 states
  ]],
  [2031, [
    // Will be populated as 2030 Census proceeds
  ]],
]);

interface StateRedistrictingDate {
  readonly state: string;
  readonly finalizedDate: Date;
  readonly effectiveDate: Date;
  readonly courtChallenges?: boolean;
  readonly notes?: string;
}
```

### 6.2 Gap Detection Algorithm

```typescript
/**
 * Detect if we're in the redistricting gap for a jurisdiction
 */
async function detectRedistrictingGap(
  boundaryType: BoundaryType,
  jurisdiction: string
): Promise<GapStatus> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Step 1: Are we in a redistricting year?
  const redistrictingYears = [2021, 2022, 2031, 2032];
  if (!redistrictingYears.includes(currentYear)) {
    return {
      inGap: false,
      gapType: 'none',
      recommendation: 'use-tiger',
      reasoning: 'Not a redistricting year; TIGER is authoritative',
    };
  }

  // Step 2: Check if TIGER has updated this year
  const tigerLastModified = await checkTigerLastModified(boundaryType);
  const tigerYear = tigerLastModified.getFullYear();
  const tigerMonth = tigerLastModified.getMonth() + 1;

  // Step 3: Check if state has finalized redistricting
  const stateFinalization = REDISTRICTING_CALENDAR.get(currentYear)?.find(
    (s) => s.state === jurisdiction
  );

  if (!stateFinalization) {
    // No finalization date known - check primary source directly
    return {
      inGap: false,
      gapType: 'pre-finalization',
      recommendation: 'use-tiger',
      reasoning: 'State redistricting not yet finalized',
    };
  }

  // Step 4: Has state finalized but TIGER not updated?
  if (
    now >= stateFinalization.effectiveDate &&
    tigerYear < currentYear
  ) {
    return {
      inGap: true,
      gapType: 'post-finalization-pre-tiger',
      recommendation: 'use-primary',
      reasoning: `${jurisdiction} finalized redistricting on ${stateFinalization.finalizedDate.toISOString().split('T')[0]} but TIGER last updated ${tigerYear}. Use primary source.`,
    };
  }

  // Step 5: Post-July - TIGER should be current
  if (currentMonth >= 7 && tigerYear === currentYear) {
    return {
      inGap: false,
      gapType: 'none',
      recommendation: 'use-tiger',
      reasoning: `TIGER updated ${tigerMonth}/${tigerYear} - current for ${currentYear} redistricting`,
    };
  }

  // Edge case: Pre-July but state hasn't finalized yet
  if (currentMonth < 7 && !stateFinalization) {
    return {
      inGap: false,
      gapType: 'pre-finalization',
      recommendation: 'use-tiger',
      reasoning: 'Before TIGER update, state not yet finalized - current TIGER is latest available',
    };
  }

  // Default: In gap period, recommend primary
  return {
    inGap: true,
    gapType: 'post-finalization-pre-tiger',
    recommendation: 'use-primary',
    reasoning: 'In redistricting gap - check primary source',
  };
}
```

---

## 7. Integration with Change Detector

### 7.1 Enhanced Change Detector

The existing `ChangeDetector` class needs enhancement to support freshness verification:

```typescript
/**
 * Enhanced Change Detector with Freshness Verification
 *
 * Extends base change detection with:
 * - Validity window tracking
 * - Primary source comparison
 * - Redistricting gap detection
 */

class EnhancedChangeDetector extends ChangeDetector {
  constructor(
    db: DatabaseAdapter,
    private readonly authorityRegistry: AuthorityRegistry,
    private readonly primaryComparator: PrimarySourceComparator,
    private readonly gapDetector: RedistrictingGapDetector
  ) {
    super(db);
  }

  /**
   * Enhanced check that includes freshness verification
   */
  async checkForChangeWithFreshness(
    source: CanonicalSource
  ): Promise<EnhancedChangeReport | null> {
    // Step 1: Basic file change detection (existing)
    const baseChange = await this.checkForChange(source);

    // Step 2: Check validity window
    const validityWindow = calculateValidityWindow(
      source.sourceType,
      new Date(source.lastChecked || 0),
      source.boundaryType
    );

    // Step 3: Check if we're in redistricting gap
    const gapStatus = await this.gapDetector.checkBoundaryGap(
      source.boundaryType,
      source.jurisdiction || '*'
    );

    // Step 4: Compare against primary if in gap
    let primaryComparison: TigerComparison | null = null;
    if (gapStatus.inGap && source.sourceType === 'tiger') {
      primaryComparison = await this.primaryComparator.compareTigerFreshness(
        source.boundaryType,
        source.jurisdiction || '*'
      );
    }

    // Step 5: Synthesize recommendation
    const recommendation = this.synthesizeRecommendation(
      baseChange,
      validityWindow,
      gapStatus,
      primaryComparison
    );

    return {
      ...baseChange,
      validityWindow,
      gapStatus,
      primaryComparison,
      recommendation,
    };
  }

  private synthesizeRecommendation(
    baseChange: ChangeReport | null,
    validityWindow: ValidityWindow,
    gapStatus: GapStatus,
    primaryComparison: TigerComparison | null
  ): FreshnessRecommendation {
    // Priority 1: If primary is fresher, use primary
    if (primaryComparison && !primaryComparison.tigerIsFresh) {
      return {
        action: 'use-primary',
        urgency: 'high',
        reason: primaryComparison.reason,
      };
    }

    // Priority 2: If in gap, warn but allow TIGER if no primary available
    if (gapStatus.inGap && !primaryComparison?.primarySource) {
      return {
        action: 'use-tiger-with-warning',
        urgency: 'medium',
        reason: 'In redistricting gap but no primary source available',
      };
    }

    // Priority 3: File changed, use new version
    if (baseChange) {
      return {
        action: 'update',
        urgency: 'normal',
        reason: 'Source file changed',
      };
    }

    // Priority 4: Low validity window confidence
    if (validityWindow.confidenceDecay < 0.5) {
      return {
        action: 'verify',
        urgency: 'low',
        reason: `Validity window confidence is ${validityWindow.confidenceDecay.toFixed(2)}`,
      };
    }

    // Default: No action needed
    return {
      action: 'none',
      urgency: 'none',
      reason: 'Source is fresh',
    };
  }
}

interface EnhancedChangeReport extends ChangeReport {
  readonly validityWindow: ValidityWindow;
  readonly gapStatus: GapStatus;
  readonly primaryComparison: TigerComparison | null;
  readonly recommendation: FreshnessRecommendation;
}

interface FreshnessRecommendation {
  readonly action: 'none' | 'verify' | 'update' | 'use-primary' | 'use-tiger-with-warning';
  readonly urgency: 'none' | 'low' | 'medium' | 'high';
  readonly reason: string;
}
```

---

## 8. Implementation Checklist

### 8.1 Core Components

- [ ] `provenance/authority-registry.ts` - Authority registry implementation
- [ ] `provenance/authority-registry.yaml` - Authority data (all 50 states)
- [ ] `provenance/freshness-verifier.ts` - Multi-layer freshness verification
- [ ] `provenance/validity-window.ts` - Validity window calculation
- [ ] `provenance/primary-comparator.ts` - Primary vs aggregator comparison
- [ ] `provenance/event-subscription.ts` - RSS/API event subscription
- [ ] `provenance/gap-detector.ts` - Redistricting gap detection

### 8.2 Integration Points

- [ ] Enhance `acquisition/change-detector.ts` with freshness verification
- [ ] Update `acquisition/incremental-orchestrator.ts` to use enhanced detector
- [ ] Add freshness report to provenance log
- [ ] CLI command for freshness check: `npm run atlas:check-freshness`

### 8.3 Data Files

- [ ] `data/redistricting-calendar-2020.yaml` - 2020 cycle finalization dates
- [ ] `data/redistricting-calendar-2030.yaml` - Template for 2030 cycle
- [ ] `data/primary-sources-us.yaml` - All 50 state redistricting authorities

---

## 9. Cost Model

| Component | Frequency | Cost |
|-----------|-----------|------|
| HEAD requests (file freshness) | Quarterly | $0 |
| RSS feed polling | Daily | $0 |
| Primary source checks | During redistricting | $0 |
| Validity window calculation | On-demand | $0 |
| **Total** | | **$0/year** |

All freshness verification is **zero cost** - HTTP HEAD requests, public RSS feeds, and calendar calculations.

---

## 10. Subagent Work Packages

### WP-FRESHNESS-1: Authority Registry Implementation

**Scope:** Implement authority registry with full US coverage

**Deliverables:**
- [ ] `provenance/authority-registry.ts` with TypeScript interface
- [ ] `data/authority-registry-us.yaml` with all 50 states + territories
- [ ] Unit tests for registry lookup
- [ ] Documentation

**Success Criteria:**
- Returns correct authority for all boundary types
- Returns primary sources for states with redistricting commissions
- Returns TIGER as aggregator for all federal layers

---

### WP-FRESHNESS-2: Validity Window System

**Scope:** Implement validity window calculation and confidence decay

**Deliverables:**
- [ ] `provenance/validity-window.ts`
- [ ] Redistricting-aware confidence decay
- [ ] Unit tests with mock dates
- [ ] Integration with change detector

**Success Criteria:**
- Correctly identifies redistricting years
- Confidence decays appropriately during gap periods
- Returns 1.0 confidence for primary sources

---

### WP-FRESHNESS-3: Primary Source Comparator

**Scope:** Compare TIGER freshness against state redistricting commissions

**Deliverables:**
- [ ] `provenance/primary-comparator.ts`
- [ ] HTTP header parsing for primary sources
- [ ] Comparison algorithm
- [ ] Integration tests with real URLs

**Success Criteria:**
- Detects when primary is fresher than TIGER
- Returns lag in days
- Handles unavailable/non-machine-readable primaries

---

### WP-FRESHNESS-4: Event Subscription Service

**Scope:** Subscribe to redistricting event feeds

**Deliverables:**
- [ ] `provenance/event-subscription.ts`
- [ ] RSS parser for Census and redistricting feeds
- [ ] Event storage in SQLite
- [ ] CLI command for manual poll

**Success Criteria:**
- Parses Census geography RSS
- Parses redistricting.lls.edu feed
- Filters for relevant events

---

### WP-FRESHNESS-5: Redistricting Gap Detector

**Scope:** Detect when we're in the redistricting gap

**Deliverables:**
- [ ] `provenance/gap-detector.ts`
- [ ] `data/redistricting-calendar-2020.yaml`
- [ ] Gap detection algorithm
- [ ] Integration with change detector

**Success Criteria:**
- Correctly identifies gap periods
- Returns appropriate recommendations
- Works for all 50 states

---

### WP-FRESHNESS-6: Enhanced Change Detector Integration

**Scope:** Integrate freshness verification into existing change detector

**Deliverables:**
- [ ] Enhanced `acquisition/change-detector.ts`
- [ ] `EnhancedChangeReport` type
- [ ] Freshness recommendation synthesis
- [ ] End-to-end integration tests

**Success Criteria:**
- Existing tests still pass
- New freshness checks integrated
- Returns actionable recommendations

---

**Authors:** Claude Code
**License:** MIT
**Last Updated:** 2025-12-13
