# Shadow Atlas Refactoring Specification

**Version:** 1.0.0
**Date:** 2025-12-12
**Status:** Authoritative
**Purpose:** Definitive specification for subagent-driven refactoring of Shadow Atlas

---

## 0. Context for Subagents

This specification is the **single source of truth** for refactoring Shadow Atlas from 55K+ lines of sprawling code to a minimal, bleeding-edge public data infrastructure. Each section is designed to be self-contained context for a specialized subagent.

**Governing Principle:** Authority and freshness are orthogonal. Census is an aggregator, not an authority. The entity with legal jurisdiction to define a boundary is the authority; the source with most recent data is freshest. Resolution: freshest primary > freshest aggregator.

**Cost Target:** ~$150/year total operational cost.

**Related Specs:**
- `DATA-PROVENANCE-SPEC.md` - Authority/freshness model, conflict resolution
- `SHADOW-ATLAS-SPEC.md` - Tree construction, geocoding interfaces
- `MERKLE-FOREST-SPEC.md` - Multi-boundary epoch architecture

---

## 1. Architecture Overview

### 1.1 Current State (PROBLEM)

```
packages/crypto/services/shadow-atlas/
├── 167 TypeScript files
├── 55K+ lines of code
├── 26 agent scripts (redundant)
├── 15 validators (overlapping)
├── 8 scanners (inconsistent)
├── 2 provenance writers (fragmented)
└── 4.2GB total (includes .venv)
```

**Core Issues:**
1. Quarterly batch acquisition is expensive and wasteful
2. Authority/freshness conflation in source selection
3. Validator sprawl (semantic, geographic, governance, district-count, etc.)
4. No event-driven change detection
5. Provenance split between two writers

### 1.2 Target State (SOLUTION)

```
packages/crypto/services/shadow-atlas/
├── core/                     # ~8 files, KEEP
│   ├── merkle-tree.ts       # Fixed depth 12/20/22, WASM Poseidon
│   ├── pip-engine.ts        # Ray-casting with bbox pre-filter
│   ├── types.ts             # Consolidated type definitions
│   └── constants.ts         # Depth tiers, precision ranks
│
├── acquisition/              # ~5 files, REFACTORED
│   ├── change-detector.ts   # ETag/Last-Modified tracking
│   ├── census-provider.ts   # FREE batch geocoding (10k/batch)
│   ├── arcgis-scanner.ts    # Portal discovery
│   └── orchestrator.ts      # Event-driven pipeline
│
├── validation/               # ~2 files, CONSOLIDATED
│   ├── semantic-validator.ts    # Title/tag scoring
│   └── geographic-validator.ts  # Bounds + PIP verification
│
├── provenance/               # ~3 files, UNIFIED
│   ├── source-registry.ts   # Authority + freshness per source
│   ├── provenance-writer.ts # Single event log
│   └── conflict-resolver.ts # Freshest primary > freshest aggregator
│
├── serving/                  # ~4 files, KEEP
│   ├── district-service.ts  # R-tree + LRU cache
│   ├── api.ts               # HTTP endpoints
│   └── health.ts            # Monitoring
│
├── db/                       # ~3 files, KEEP
│   ├── schema.sql           # Event-sourced tables
│   ├── views.sql            # Derived views
│   └── sqlite-adapter.ts    # DatabaseAdapter impl
│
└── cli/                      # ~2 files, SIMPLIFIED
    ├── bootstrap.ts         # Initial data load
    └── update.ts            # Incremental updates
```

**File Count:** 167 → ~27 files (84% reduction)
**LOC:** 55K → ~8K estimated (85% reduction)

---

## 2. Module Specifications

### 2.1 KEEP: Core Primitives

These files are production-ready. Do not modify unless fixing bugs.

#### 2.1.1 `core/merkle-tree.ts`

**Status:** KEEP AS-IS
**Location:** `packages/crypto/services/shadow-atlas/merkle-tree.ts`
**Lines:** ~200
**Dependencies:** `@aztec/bb.js` (WASM Poseidon)

**Interface:**
```typescript
interface MerkleTreeConfig {
  readonly depth: 12 | 20 | 22;  // Tier-based
  readonly hashFn: 'poseidon';
}

class ShadowAtlasMerkleTree {
  constructor(config: MerkleTreeConfig);
  insert(address: string): void;
  generateProof(address: string): MerkleProof;
  verifyProof(proof: MerkleProof): boolean;
  get root(): string;
}
```

**Rationale:** WASM Poseidon from bb.js is audited. Tree construction is correct.

#### 2.1.2 `core/pip-engine.ts`

**Status:** KEEP AS-IS
**Location:** `packages/crypto/services/shadow-atlas/services/pip-engine.ts`
**Lines:** ~370
**Dependencies:** None (pure algorithm)

**Interface:**
```typescript
class PointInPolygonEngine {
  isPointInPolygon(point: LatLng, polygon: Polygon | MultiPolygon): boolean;
  findContainingBoundaries(point: LatLng, boundaries: BoundaryGeometry[]): PIPTestResult[];
  findFinestBoundary(point: LatLng, boundaries: BoundaryGeometry[]): PIPTestResult | null;
}
```

**Rationale:** Ray-casting algorithm is correct. Bounding box pre-filter is O(1).

#### 2.1.3 `core/types.ts`

**Status:** CONSOLIDATE (merge from 5 type files)
**Sources:**
- `types/index.ts`
- `types/boundary.ts`
- `types/discovery.ts`
- `types/provider.ts`
- `transformation/types.ts`

**Target:** Single `core/types.ts` with all type definitions.

---

### 2.2 REFACTOR: Acquisition Layer

#### 2.2.1 `acquisition/change-detector.ts`

**Status:** NEW FILE
**Purpose:** Event-driven change detection using HTTP headers
**Cost:** $0/year (HEAD requests are free)

**Interface:**
```typescript
interface ChangeDetector {
  /**
   * Check if source has changed since last fetch.
   * Uses ETag or Last-Modified headers.
   * Returns null if unchanged.
   */
  async checkForChange(source: CanonicalSource): Promise<ChangeReport | null>;

  /**
   * Batch check all sources due for verification.
   * Based on update triggers (annual, redistricting, etc.)
   */
  async checkScheduledSources(): Promise<ChangeReport[]>;
}

interface ChangeReport {
  readonly sourceId: string;
  readonly oldChecksum: string;
  readonly newChecksum: string;
  readonly detectedAt: string;  // ISO timestamp
  readonly trigger: 'scheduled' | 'manual' | 'event';
}
```

**Implementation Requirements:**
1. HEAD request only (no download unless changed)
2. Parse ETag header first, fall back to Last-Modified
3. Store checksums in SQLite `sources` table
4. Respect update triggers from `canonical-sources.yaml`

**Key Insight:** Boundaries change due to predictable events (Census, redistricting), not continuously. Don't poll—subscribe to schedules.

#### 2.2.2 `acquisition/census-provider.ts`

**Status:** KEEP + MINOR REFACTOR
**Source:** `packages/crypto/services/shadow-atlas/services/census-geocoder.ts`
**Lines:** ~320
**Cost:** $0/year (FREE unlimited)

**Interface:**
```typescript
interface CensusProvider {
  /**
   * FREE batch geocoding via Census Bureau API.
   * 10,000 addresses per batch, unlimited batches.
   */
  async geocodeBatch(addresses: Address[]): Promise<GeocodeResult[]>;

  /**
   * Get FIPS codes from coordinates.
   * Returns state, county, tract, block FIPS.
   */
  async getFIPSFromCoords(lat: number, lng: number): Promise<FIPSResult>;
}
```

**Refactor Requirements:**
1. Extract from monolithic geocoder to focused provider
2. Add retry logic with exponential backoff
3. Add rate limiting (though Census has no limits)

#### 2.2.3 `acquisition/arcgis-scanner.ts`

**Status:** CONSOLIDATE (merge 4 scanners)
**Sources:**
- `scanners/arcgis-hub.ts`
- `scanners/direct-mapserver.ts`
- `scanners/authoritative-multi-path.ts`
- `scanners/state-gis-clearinghouse.ts`

**Target:** Single `arcgis-scanner.ts` with multi-strategy search.

**Interface:**
```typescript
interface ArcGISScanner {
  /**
   * Search ArcGIS Hub for council district layers.
   * Uses semantic validation to filter results.
   */
  async searchHub(city: CityInfo): Promise<DiscoveredLayer[]>;

  /**
   * Search state GIS clearinghouse portals.
   * Falls back when Hub search fails.
   */
  async searchStatePortal(state: string): Promise<DiscoveredLayer[]>;

  /**
   * Validate discovered layer is actually council districts.
   */
  async validateLayer(layer: DiscoveredLayer): Promise<ValidationResult>;
}
```

**Consolidation Requirements:**
1. Merge search strategies into single scanner
2. Priority order: Hub → State Portal → Direct MapServer
3. Single validation pipeline (semantic + geographic)

#### 2.2.4 `acquisition/orchestrator.ts`

**Status:** REFACTOR
**Source:** `acquisition/pipelines/orchestrator.ts`
**Lines:** ~200 → ~150

**Interface:**
```typescript
interface AcquisitionOrchestrator {
  /**
   * Run incremental update (event-driven).
   * Only downloads sources that have changed.
   */
  async runIncrementalUpdate(): Promise<UpdateReport>;

  /**
   * Run full refresh (quarterly).
   * Downloads all sources, computes diffs.
   */
  async runQuarterlyRefresh(): Promise<UpdateReport>;
}
```

**Refactor Requirements:**
1. Replace quarterly-only with incremental-first
2. Use `ChangeDetector` to skip unchanged sources
3. Reduce from 9 stages to 5:
   - Load → Validate → Normalize → Build → Export

---

### 2.3 CONSOLIDATE: Validation Layer

#### 2.3.1 `validation/semantic-validator.ts`

**Status:** CONSOLIDATE (merge 3 validators)
**Sources:**
- `validators/semantic-layer-validator.ts`
- `validators/governance-validator.ts`
- `registry/city-name-aliases.ts`

**Interface:**
```typescript
interface SemanticValidator {
  /**
   * Score layer title for council district semantics.
   * Returns 0-100 score with reasoning.
   */
  scoreTitle(title: string): SemanticScore;

  /**
   * Check for negative keywords (excludes non-council layers).
   */
  hasNegativeKeywords(title: string): boolean;

  /**
   * Match city name against known aliases.
   */
  matchCityName(name: string, city: CityInfo): boolean;
}

interface SemanticScore {
  readonly score: number;  // 0-100
  readonly threshold: 30;  // Minimum to accept
  readonly reasons: string[];
}
```

**Consolidation Requirements:**
1. Single file with all semantic checks
2. Configurable keyword lists (positive/negative)
3. No LLM dependency for basic validation

#### 2.3.2 `validation/geographic-validator.ts`

**Status:** CONSOLIDATE (merge 4 validators)
**Sources:**
- `validation/geographic-bounds-validator.ts`
- `validators/enhanced-geographic-validator.ts`
- `validators/district-count-validator.ts`
- `validation/deterministic-validators.ts`

**Interface:**
```typescript
interface GeographicValidator {
  /**
   * Validate layer is within expected state/city bounds.
   */
  validateBounds(geojson: FeatureCollection, city: CityInfo): BoundsResult;

  /**
   * Validate district count is reasonable (3-50 for councils).
   * Returns warning, not rejection.
   */
  validateDistrictCount(geojson: FeatureCollection, fips: string): CountResult;

  /**
   * Check for topology errors (gaps, overlaps).
   */
  validateTopology(geojson: FeatureCollection): TopologyResult;
}
```

**Consolidation Requirements:**
1. Single file with all geographic checks
2. Use PIP engine for bounds validation
3. District count is informational only (no rejection)

---

### 2.4 UNIFY: Provenance Layer

#### 2.4.1 `provenance/source-registry.ts`

**Status:** NEW FILE
**Purpose:** Implement DATA-PROVENANCE-SPEC Section 2 (Canonical Source Registry)

**Interface:**
```typescript
interface SourceRegistry {
  /**
   * Get canonical source for boundary type.
   * Returns primary authority + aggregator fallbacks.
   */
  getSourceConfig(boundaryType: BoundaryType): SourceConfig;

  /**
   * Select best source based on authority + freshness.
   * Primary source preferred when available.
   */
  async selectSource(boundaryType: BoundaryType): Promise<SelectedSource>;

  /**
   * Register discovered source (municipal portals).
   */
  async registerDiscoveredSource(source: DiscoveredSource): Promise<void>;
}

interface SourceConfig {
  readonly boundaryType: BoundaryType;
  readonly primaryAuthority: AuthoritySource;
  readonly aggregators: AggregatorSource[];
}

interface AuthoritySource {
  readonly entity: string;       // "CA Citizens Redistricting Commission"
  readonly legalBasis: string;   // "CA Constitution Article XXI"
  readonly publishUrl: string | null;
  readonly publishSchedule: string;
}

interface AggregatorSource {
  readonly name: string;         // "Census TIGER"
  readonly url: string;
  readonly lag: string;          // "6-12 months after authoritative"
  readonly format: string;
}
```

**Key Implementation:**
```yaml
# Embedded in source-registry.ts or separate canonical-sources.yaml
congressional:
  primary_authority:
    entity: "State Redistricting Authority"
    varies_by_state: true
    examples:
      CA: "https://www.wedrawthelinesca.org/"
      TX: "https://redistricting.capitol.texas.gov/"
  aggregators:
    - name: "Census TIGER"
      url: "https://www2.census.gov/geo/tiger/TIGER{YEAR}/CD/"
      lag: "6-18 months"
    - name: "Redistricting Data Hub"
      url: "https://redistrictingdatahub.org/"
      lag: "Near-realtime during redistricting"
```

#### 2.4.2 `provenance/provenance-writer.ts`

**Status:** CONSOLIDATE (merge 2 writers)
**Sources:**
- `services/provenance-writer.ts`
- `services/provenance-staging-writer.ts`

**Interface:**
```typescript
interface ProvenanceWriter {
  /**
   * Log discovery event.
   */
  async logDiscovery(event: DiscoveryEvent): Promise<void>;

  /**
   * Log fetch event.
   */
  async logFetch(event: FetchEvent): Promise<void>;

  /**
   * Log validation result.
   */
  async logValidation(event: ValidationEvent): Promise<void>;

  /**
   * Query provenance log.
   */
  async query(filter: ProvenanceFilter): Promise<ProvenanceEntry[]>;

  /**
   * Compress and rotate old logs.
   */
  async compressLogs(olderThan: Date): Promise<void>;
}
```

**Consolidation Requirements:**
1. Single writer with staging buffer
2. Batch writes for performance
3. Compression for old logs
4. Query interface for freshness analysis

#### 2.4.3 `provenance/conflict-resolver.ts`

**Status:** NEW FILE
**Purpose:** Implement DATA-PROVENANCE-SPEC Section 4.3 (Conflict Resolution)

**Interface:**
```typescript
interface ConflictResolver {
  /**
   * Resolve conflict between multiple source claims.
   * Rule: Freshest primary > freshest aggregator.
   */
  async resolveConflict(
    boundaryId: string,
    sources: SourceClaim[]
  ): Promise<ResolvedBoundary>;

  /**
   * Log resolution decision for audit.
   */
  async logResolution(resolution: ResolutionDecision): Promise<void>;
}

interface SourceClaim {
  readonly sourceId: string;
  readonly boundary: BoundaryGeometry;
  readonly lastModified: number;  // Unix timestamp
  readonly isPrimary: boolean;    // Is this the authoritative source?
}

interface ResolutionDecision {
  readonly boundaryId: string;
  readonly winner: string;        // sourceId
  readonly reason: string;
  readonly freshness: number;
  readonly alternatives: string[];
}
```

**Resolution Algorithm:**
```
1. Separate sources into primary (authoritative) and aggregators
2. If primary sources exist:
   - Sort by lastModified (descending)
   - Return freshest primary
3. If no primary sources:
   - Sort aggregators by lastModified (descending)
   - Return freshest aggregator
4. Log decision with full reasoning
```

---

### 2.5 KEEP: Serving Layer

#### 2.5.1 `serving/district-service.ts`

**Status:** KEEP AS-IS
**Location:** `packages/crypto/services/shadow-atlas/serving/district-service.ts`
**Lines:** ~307

**Interface:**
```typescript
class DistrictLookupService {
  constructor(dbPath: string, cacheSize?: number, cacheTTLSeconds?: number);

  /**
   * Lookup district for coordinates.
   * Uses R-tree + LRU cache for <50ms p95 latency.
   */
  lookup(lat: number, lon: number): {
    district: DistrictBoundary | null;
    latencyMs: number;
    cacheHit: boolean;
  };

  /**
   * Get query metrics.
   */
  getMetrics(): QueryMetrics;
}
```

**Rationale:** R-tree spatial index with LRU cache is production-ready. <50ms p95 latency target is achievable.

---

### 2.6 KEEP: Database Layer

#### 2.6.1 `db/schema.sql`

**Status:** KEEP AS-IS
**Lines:** ~92

**Tables:**
- `municipalities` - 19k US incorporated places
- `sources` - Discovered portal endpoints
- `selections` - Chosen source per municipality
- `artifacts` - Content-addressed GeoJSON blobs
- `heads` - Current artifact pointers
- `events` - Append-only provenance log

**Rationale:** Event-sourced, content-addressed design is correct. Zero git bloat.

#### 2.6.2 `db/sqlite-adapter.ts`

**Status:** KEEP AS-IS
**Lines:** ~367

**Interface:** Implements `DatabaseAdapter` from `core/types.ts`.

**Rationale:** WAL mode, foreign keys, transactions are all correct.

---

### 2.7 REMOVE: Dead Code

#### Files to Delete (26 agent scripts):
```
scripts/coverage-dashboard.ts
scripts/retry-worker.ts
scripts/query-retry-candidates.ts
scripts/check-freshness.ts
scripts/plan-expansion.ts
scripts/validate-registry.ts
scripts/analyze-batch-results.ts
scripts/validate-registry-data-quality.ts
examples/multi-county-validation.ts
examples/coverage-monitoring.ts
services/provenance-writer.example.ts
test-validation-real-world.ts
test-live-registry-urls.ts
test-validation-adversarial.test.ts
validation-integration.test.ts
```

#### Scanners to Merge (keep arcgis-hub.ts as base):
```
scanners/direct-mapserver.ts → merge into arcgis-scanner.ts
scanners/authoritative-multi-path.ts → merge into arcgis-scanner.ts
scanners/state-gis-clearinghouse.ts → merge into arcgis-scanner.ts
scanners/socrata.ts → evaluate if needed (CKAN alternative)
scanners/ckan.ts → evaluate if needed
```

#### Validators to Merge:
```
validators/governance-validator.ts → semantic-validator.ts
validators/district-count-validator.ts → geographic-validator.ts
validators/enhanced-geographic-validator.ts → geographic-validator.ts
validators/semantic-layer-validator.ts → semantic-validator.ts
validation/deterministic-validators.ts → geographic-validator.ts
validation/geographic-bounds-validator.ts → geographic-validator.ts
```

---

## 3. Data Flow Specification

### 3.1 Incremental Update Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    INCREMENTAL UPDATE FLOW                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. CHANGE DETECTION (cost: $0)                                  │
│     ┌─────────────────┐                                          │
│     │ SourceRegistry  │──▶ Get sources due for check             │
│     └────────┬────────┘                                          │
│              │                                                   │
│              ▼                                                   │
│     ┌─────────────────┐                                          │
│     │ ChangeDetector  │──▶ HEAD requests (ETag/Last-Modified)    │
│     └────────┬────────┘                                          │
│              │ Only changed sources proceed                      │
│              ▼                                                   │
│  2. ACQUISITION (cost: $0 for Census, variable for portals)     │
│     ┌─────────────────┐                                          │
│     │ CensusProvider  │──▶ FREE batch geocoding                  │
│     └────────┬────────┘                                          │
│              │                                                   │
│     ┌─────────────────┐                                          │
│     │ ArcGISScanner   │──▶ Portal discovery (if needed)          │
│     └────────┬────────┘                                          │
│              │                                                   │
│              ▼                                                   │
│  3. VALIDATION                                                   │
│     ┌─────────────────┐                                          │
│     │SemanticValidator│──▶ Title/tag scoring (threshold: 30)     │
│     └────────┬────────┘                                          │
│              │                                                   │
│     ┌─────────────────┐                                          │
│     │GeographicValid. │──▶ Bounds + topology                     │
│     └────────┬────────┘                                          │
│              │                                                   │
│              ▼                                                   │
│  4. CONFLICT RESOLUTION                                          │
│     ┌─────────────────┐                                          │
│     │ConflictResolver │──▶ Freshest primary > freshest aggregator│
│     └────────┬────────┘                                          │
│              │                                                   │
│              ▼                                                   │
│  5. TREE BUILDING                                                │
│     ┌─────────────────┐                                          │
│     │ MerkleTree      │──▶ Poseidon hash, depth 12/20/22         │
│     └────────┬────────┘                                          │
│              │                                                   │
│              ▼                                                   │
│  6. PROVENANCE                                                   │
│     ┌─────────────────┐                                          │
│     │ProvenanceWriter │──▶ Event log + manifest                  │
│     └─────────────────┘                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Query Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         QUERY FLOW                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Address Input                                                   │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────┐                                             │
│  │ CensusProvider  │──▶ Geocode to lat/lng + FIPS                │
│  └────────┬────────┘                                             │
│           │                                                      │
│           ▼                                                      │
│  ┌─────────────────┐                                             │
│  │DistrictService  │──▶ R-tree query (O(log n))                  │
│  └────────┬────────┘                                             │
│           │                                                      │
│           ├──▶ Cache hit? Return immediately (<5ms)              │
│           │                                                      │
│           ▼                                                      │
│  ┌─────────────────┐                                             │
│  │  PIPEngine      │──▶ Ray-casting (O(k) where k = candidates)  │
│  └────────┬────────┘                                             │
│           │                                                      │
│           ▼                                                      │
│  ┌─────────────────┐                                             │
│  │  MerkleTree     │──▶ Generate proof (O(depth) = 12-22 hashes) │
│  └────────┬────────┘                                             │
│           │                                                      │
│           ▼                                                      │
│  Return: District + MerkleProof                                  │
│                                                                  │
│  Target Latency: <50ms p95                                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Subagent Work Packages

Each work package is designed for a specialized subagent with clear inputs, outputs, and success criteria.

### 4.1 WP-CORE: Core Primitives Audit

**Scope:** Verify core primitives are correct, no refactoring needed.

**Files to Audit:**
- `merkle-tree.ts` - Verify WASM Poseidon integration
- `pip-engine.ts` - Verify ray-casting edge cases
- `db/schema.sql` - Verify event-sourced design

**Deliverables:**
- [ ] Audit report confirming correctness
- [ ] List of any edge case bugs found
- [ ] Performance benchmarks (tree construction, PIP test)

**Success Criteria:**
- All existing tests pass
- No algorithmic bugs identified
- Performance within spec (Merkle tree: <100ms for 10k leaves)

---

### 4.2 WP-TYPES: Type Consolidation

**Scope:** Merge 5 type files into single `core/types.ts`.

**Files to Consolidate:**
```
types/index.ts           → core/types.ts
types/boundary.ts        → core/types.ts
types/discovery.ts       → core/types.ts
types/provider.ts        → core/types.ts
transformation/types.ts  → core/types.ts
```

**Deliverables:**
- [ ] Single `core/types.ts` with all type definitions
- [ ] Update all imports across codebase
- [ ] Remove old type files

**Success Criteria:**
- Zero TypeScript errors
- All imports updated
- No duplicate type definitions

---

### 4.3 WP-CHANGE: Change Detection Implementation

**Scope:** Implement event-driven change detection.

**New File:** `acquisition/change-detector.ts`

**Interface Spec:** See Section 2.2.1

**Deliverables:**
- [ ] `ChangeDetector` class implementation
- [ ] HEAD request logic with ETag/Last-Modified parsing
- [ ] SQLite integration for checksum storage
- [ ] Unit tests (mock HTTP responses)
- [ ] Integration test with real Census TIGER URL

**Success Criteria:**
- Detects changed source (new ETag)
- Returns null for unchanged source
- Zero network cost (HEAD requests only)
- <100ms per check

---

### 4.4 WP-VALIDATION: Validator Consolidation

**Scope:** Merge 7 validators into 2 focused validators.

**Semantic Validator Sources:**
```
validators/semantic-layer-validator.ts
validators/governance-validator.ts
registry/city-name-aliases.ts
```

**Geographic Validator Sources:**
```
validation/geographic-bounds-validator.ts
validators/enhanced-geographic-validator.ts
validators/district-count-validator.ts
validation/deterministic-validators.ts
```

**Deliverables:**
- [ ] `validation/semantic-validator.ts`
- [ ] `validation/geographic-validator.ts`
- [ ] Migrate all tests
- [ ] Remove old validator files

**Success Criteria:**
- All existing tests pass
- Same validation behavior
- 7 files → 2 files

---

### 4.5 WP-PROVENANCE: Provenance System Unification

**Scope:** Implement unified provenance layer per DATA-PROVENANCE-SPEC.

**New Files:**
- `provenance/source-registry.ts`
- `provenance/provenance-writer.ts` (consolidated)
- `provenance/conflict-resolver.ts`

**Interface Specs:** See Section 2.4

**Deliverables:**
- [ ] `SourceRegistry` with authority + freshness model
- [ ] `ProvenanceWriter` with staging buffer
- [ ] `ConflictResolver` with freshest-primary rule
- [ ] `canonical-sources.yaml` with US layers
- [ ] Unit tests for conflict resolution
- [ ] Integration test with mock source claims

**Success Criteria:**
- Authority/freshness correctly separated
- Conflict resolution: freshest primary > freshest aggregator
- Full audit trail for all decisions

---

### 4.6 WP-SCANNER: Scanner Consolidation

**Scope:** Merge 4 scanners into 1 multi-strategy scanner.

**Files to Consolidate:**
```
scanners/arcgis-hub.ts           → acquisition/arcgis-scanner.ts
scanners/direct-mapserver.ts     → acquisition/arcgis-scanner.ts
scanners/authoritative-multi-path.ts → acquisition/arcgis-scanner.ts
scanners/state-gis-clearinghouse.ts  → acquisition/arcgis-scanner.ts
```

**Deliverables:**
- [ ] `acquisition/arcgis-scanner.ts`
- [ ] Multi-strategy search (Hub → State → Direct)
- [ ] Validation integration
- [ ] Migrate all tests
- [ ] Remove old scanner files

**Success Criteria:**
- Same discovery behavior
- 4 files → 1 file
- Priority order: Hub → State Portal → Direct MapServer

---

### 4.7 WP-CLEANUP: Dead Code Removal

**Scope:** Delete 26 agent scripts and move test files.

**Files to Delete:** See Section 2.7

**Deliverables:**
- [ ] Delete all listed files
- [ ] Update any imports that reference deleted files
- [ ] Move example files to `/examples` directory
- [ ] Move test files to `/tests` directory

**Success Criteria:**
- 26 fewer files
- Zero broken imports
- Build passes

---

### 4.8 WP-ORCHESTRATOR: Acquisition Orchestrator Refactor

**Scope:** Refactor orchestrator from quarterly-only to incremental-first.

**Source:** `acquisition/pipelines/orchestrator.ts`
**Target:** `acquisition/orchestrator.ts`

**Deliverables:**
- [ ] `runIncrementalUpdate()` method
- [ ] `runQuarterlyRefresh()` method
- [ ] Integration with `ChangeDetector`
- [ ] 9 stages → 5 stages
- [ ] CLI commands for both modes

**Success Criteria:**
- Incremental update only downloads changed sources
- Quarterly refresh downloads all sources
- 75% fewer API calls in typical operation

---

## 5. Migration Plan

### Phase 1: Foundation (Week 1)

1. **WP-CORE** - Audit core primitives (1 day)
2. **WP-TYPES** - Consolidate types (1 day)
3. **WP-CLEANUP** - Remove dead code (1 day)

**Gate:** All tests pass, build succeeds.

### Phase 2: Provenance (Week 2)

4. **WP-PROVENANCE** - Implement provenance layer (3 days)
5. **WP-CHANGE** - Implement change detection (2 days)

**Gate:** Authority/freshness model working, conflict resolution tested.

### Phase 3: Consolidation (Week 3)

6. **WP-VALIDATION** - Consolidate validators (2 days)
7. **WP-SCANNER** - Consolidate scanners (2 days)
8. **WP-ORCHESTRATOR** - Refactor orchestrator (1 day)

**Gate:** Full pipeline working, incremental updates operational.

### Phase 4: Verification (Week 4)

- End-to-end testing
- Performance benchmarks
- Documentation update
- Final cleanup

---

## 6. Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| File Count | 167 | ~27 |
| Lines of Code | 55K | ~8K |
| Validators | 7 | 2 |
| Scanners | 4 | 1 |
| Provenance Writers | 2 | 1 |
| Agent Scripts | 26 | 0 |
| Operational Cost | Unknown | ~$150/year |
| API Calls (typical) | Quarterly batch | Incremental |

---

## 7. Appendix: File Mapping

### Current → Target

| Current File | Target File | Action |
|-------------|-------------|--------|
| `merkle-tree.ts` | `core/merkle-tree.ts` | MOVE |
| `pip-engine.ts` | `core/pip-engine.ts` | MOVE |
| `types/index.ts` | `core/types.ts` | MERGE |
| `types/boundary.ts` | `core/types.ts` | MERGE |
| `census-geocoder.ts` | `acquisition/census-provider.ts` | REFACTOR |
| `arcgis-hub.ts` | `acquisition/arcgis-scanner.ts` | MERGE |
| `provenance-writer.ts` | `provenance/provenance-writer.ts` | MERGE |
| `district-service.ts` | `serving/district-service.ts` | MOVE |
| `sqlite-adapter.ts` | `db/sqlite-adapter.ts` | MOVE |
| `schema.sql` | `db/schema.sql` | MOVE |
| (26 agent scripts) | (deleted) | DELETE |

---

**Authors:** Claude Code
**License:** MIT
**Last Updated:** 2025-12-12
