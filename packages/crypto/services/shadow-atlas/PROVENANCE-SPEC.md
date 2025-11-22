# Shadow Atlas: Unified Provenance & Granularity Specification

**Purpose**: Autonomous agents drill down to maximum granularity while tracking quality, validity, authority, and reasoning chains for thousands of municipalities with efficient provenance storage.

---

## Design Principles

1. **Granularity maximization**: Always attempt finest tier first, fall back only when conclusively unavailable
2. **Reasoning transparency**: Log why each granularity was chosen and what blocked higher tiers
3. **Authority assessment**: Rank data sources by trustworthiness (federal > state > municipal > aggregator > community)
4. **Quality validation**: Geometric, temporal, authority, and completeness checks
5. **Efficient storage**: Compressed NDJSON (~80 bytes/city → 1.5MB for entire US)
6. **Append-only audit**: Never delete attempts, track retry chains via supersedes field

---

## Granularity Tier System (0-4)

### Tier Hierarchy (Finest → Coarsest)

```typescript
enum GranularityTier {
  // TIER 0: Sub-district (finest available)
  PRECINCT = 0,                    // Election precincts/polling places

  // TIER 1: Council districts
  COUNCIL_DISTRICT = 1,            // City council districts/wards (3-51 per city)

  // TIER 2: Municipal boundary
  MUNICIPAL_BOUNDARY = 2,          // Single city polygon (at-large governance)

  // TIER 3: County subdivision
  COUNTY_SUBDIVISION = 3,          // Census Minor Civil Division (MCD/CCD)

  // TIER 4: County fallback
  COUNTY = 4,                      // County-level only (absolute fallback)
}
```

**Agent mandate**: Always attempt TIER 0 first, only fall back if conclusively unavailable.

---

## Authority Pyramid (0-5 Scale)

```typescript
enum AuthorityLevel {
  FEDERAL_MANDATE = 5,      // US Census, FEC, state election boards
  STATE_MANDATE = 4,        // State GIS office, Secretary of State
  MUNICIPAL_OFFICIAL = 3,   // City GIS portal, official city website
  HUB_AGGREGATOR = 2,       // ArcGIS Hub, Socrata, Data.gov
  COMMUNITY_MAINTAINED = 1, // OpenStreetMap, Wikipedia
  UNKNOWN = 0,              // Unverified source
}
```

**Authority override rule**: Higher authority can outweigh finer granularity.
- Example: TIER 2 (municipal boundary) from Census (auth=5) **>** TIER 1 (districts) from OSM (auth=1)

---

## Compact Discovery Log Entry (NDJSON)

### Compressed Schema

```typescript
interface CompactDiscoveryEntry {
  // Identity (21 bytes)
  f: string;              // FIPS code (7 chars)
  n: string;              // City name
  s: string;              // State code (2 chars)
  p: number;              // Population

  // Granularity assessment (40 bytes)
  g: number;              // Tier: 0-4
  fc: number | null;      // Feature count
  conf: number;           // Confidence 0-100
  auth: number;           // Authority 0-5

  // Data source (30 bytes)
  src: string;            // arcgis|socrata|muni-gis|tiger|osm
  url: string | null;     // Download URL

  // Quality metrics (20 bytes)
  q: {
    v: boolean;           // GeoJSON valid
    t: number;            // Topology: 0=gaps, 1=clean, 2=overlaps
    r: number;            // Response time ms
    d: string | null;     // Data vintage YYYY-MM-DD
  };

  // Reasoning chain (variable, essential for audit)
  why: string[];          // Why this tier chosen
  tried: number[];        // Tiers attempted: [0,1,2]
  blocked: string | null; // Blocker code preventing higher tier

  // Metadata (32 bytes)
  ts: string;             // ISO timestamp
  aid: string;            // Agent ID (8 chars)
  sup: string | null;     // Supersedes attemptId (retry chain)
}
```

**Storage estimate**: ~150-250 bytes per entry → 19,495 cities × 200 bytes = ~3.9MB raw, **~1.5MB gzipped**

---

## Storage Efficiency

### Per-Entry Size

**Compact format**: ~150-250 bytes (short URLs)
**Realistic format**: ~250-400 bytes (long portal URLs)
**Average**: ~200 bytes

### US Scale (19,495 cities)

**Uncompressed**:
- 19,495 cities × 200 bytes = 3.9 MB

**Gzipped**:
- 50 state shards × ~30 KB average = 1.5 MB total
- Query all states: Read 50 files (~100ms)
- Query single state: Read 1 file (~2ms)

### Scaling Projections

**100 concurrent agents**:
- Production mode: ~2 agents per state (50 shards) = minimal contention
- Staging mode: ∞ agents, zero contention

**Monthly growth** (1,000 discoveries/month):
- Uncompressed: ~200 KB/month
- Gzipped: ~60 KB/month
- Annual: ~720 KB/year

---

## Agent Reasoning Algorithm

### Drill-Down Discovery Process

```typescript
async function discoverMaximalGranularity(city: CityTarget): Promise<CompactDiscoveryEntry> {
  const reasoning: string[] = [];
  const attempted: number[] = [];

  // TIER 0: Precinct/polling place boundaries
  reasoning.push("T0: Attempting precinct boundaries");
  attempted.push(0);

  const tier0 = await attemptPrecinctDiscovery(city);

  if (tier0.success && tier0.auth >= 3) {
    reasoning.push(`T0 success: ${tier0.fc} precincts (auth ${tier0.auth})`);
    return buildEntry(city, 0, tier0, attempted, reasoning);
  } else if (tier0.blocked) {
    reasoning.push(`T0 blocked: ${tier0.blocker}`);
  } else {
    reasoning.push("T0 unavailable: No precinct data");
  }

  // TIER 1: Council districts
  reasoning.push("T1: Falling back to council districts");
  attempted.push(1);

  const tier1 = await attemptCouncilDistrictDiscovery(city);

  if (tier1.success && tier1.auth >= 2) {
    reasoning.push(`T1 success: ${tier1.fc} districts (auth ${tier1.auth})`);

    // Check if T0 had higher authority despite failure
    if (tier0.auth > tier1.auth + 1) {
      reasoning.push(`WARNING: T0 higher auth (${tier0.auth}) but failed validation`);
    }

    return buildEntry(city, 1, tier1, attempted, reasoning);
  } else if (tier1.blocked) {
    reasoning.push(`T1 blocked: ${tier1.blocker}`);
  } else {
    reasoning.push("T1 unavailable: No district data");
  }

  // TIER 2: Municipal boundary
  reasoning.push("T2: Falling back to municipal boundary");
  attempted.push(2);

  const tier2 = await attemptMunicipalBoundaryDiscovery(city);

  if (tier2.success) {
    reasoning.push(`T2 success: City boundary (auth ${tier2.auth})`);

    // Explain why T1 unavailable
    const governance = await checkGovernance(city);
    if (governance === 'at-large') {
      reasoning.push("T1 unavailable by design: At-large council (no districts)");
      return buildEntry(city, 2, tier2, attempted, reasoning, 'at-large-governance');
    }

    return buildEntry(city, 2, tier2, attempted, reasoning);
  }

  // TIER 3: County subdivision fallback
  reasoning.push("T3: Falling back to county subdivision");
  attempted.push(3);

  const tier3 = await attemptCountySubdivisionDiscovery(city);

  if (tier3.success) {
    reasoning.push(`T3 success: MCD boundary (auth ${tier3.auth})`);
    return buildEntry(city, 3, tier3, attempted, reasoning);
  }

  // TIER 4: County boundary (absolute fallback)
  reasoning.push("T4: Final fallback to county boundary");
  attempted.push(4);

  const tier4 = await attemptCountyBoundaryDiscovery(city);
  reasoning.push(`T4: County ${tier4.countyName} (auth ${tier4.auth})`);

  return buildEntry(city, 4, tier4, attempted, reasoning);
}
```

---

## Quality Assessment Framework

### 1. Geometric Validity

```typescript
async function validateGeometry(geojson: any): Promise<GeometricQuality> {
  return {
    validGeoJSON: await isValidGeoJSON(geojson),
    validCoordinates: checkCoordinateRanges(geojson),
    topologyClean: await checkTopology(geojson), // No gaps/overlaps
    projectionCorrect: geojson.crs?.properties?.name === 'EPSG:4326',
  };
}

// Agent reasoning integration
const geoCheck = await validateGeometry(geojson);
if (!geoCheck.topologyClean) {
  reasoning.push(`QUALITY WARNING: Topology issues detected`);
  confidence -= 20;
}
```

### 2. Temporal Validity

```typescript
interface TemporalValidity {
  dataVintage: string | null;      // "2021-12-14"
  effectiveDate: string | null;    // When boundaries took effect
  expiryDate: string | null;       // Known redistricting date
  staleness: number;               // Days since last verified
}

// Agent reasoning integration
if (temporal.staleness > 365) {
  reasoning.push(`STALENESS: ${temporal.staleness} days since verification`);
  confidence -= 10;
}

if (temporal.expiryDate && new Date(temporal.expiryDate) < new Date()) {
  reasoning.push(`EXPIRED: Boundaries superseded ${temporal.expiryDate}`);
  blocked = 'redistricting-completed';
}
```

### 3. Authority Verification

```typescript
async function verifyAuthority(source: string, city: CityTarget): Promise<number> {
  // Cross-check with official city website
  const cityWebsite = await fetchCityWebsite(city);
  const officialGISLink = await extractOfficialGISLink(cityWebsite);

  if (officialGISLink && officialGISLink === source) {
    reasoning.push("AUTHORITY VERIFIED: Matches official city website");
    return 3; // Municipal official
  } else if (source.includes('census.gov')) {
    reasoning.push("AUTHORITY: Census TIGER (federal)");
    return 5; // Federal mandate
  } else if (source.includes('hub.arcgis.com')) {
    reasoning.push("AUTHORITY: ArcGIS Hub (aggregator)");
    return 2; // Hub aggregator
  } else {
    reasoning.push("AUTHORITY: Third-party (unverified)");
    return 1; // Community maintained
  }
}
```

### 4. Completeness Assessment

```typescript
interface CompletenessMetrics {
  expectedFeatureCount: number | null;
  actualFeatureCount: number;
  missingFields: string[];
  coverageCompleteness: number; // % of municipal area covered
}

// Agent reasoning integration
const governance = await getGovernanceInfo(city);

if (governance.councilSize && actual !== governance.councilSize) {
  reasoning.push(`COMPLETENESS WARNING: Found ${actual}, expected ${governance.councilSize}`);
  confidence -= 15;
}

if (coverage < 0.95) {
  reasoning.push(`COVERAGE WARNING: Boundaries cover ${(coverage * 100).toFixed(1)}%`);
  confidence -= 20;
}
```

---

## Error Taxonomy (Blocker Codes)

```typescript
enum BlockerCode {
  // Tier 0 specific
  'no-precinct-data',
  'precinct-auth-required',

  // Tier 1 specific
  'at-large-governance',        // Expected T2 (not a failure)
  'no-council-layer',
  'ambiguous-layer-name',
  'low-confidence-match',

  // Infrastructure issues
  'portal-404',
  'portal-timeout',
  'portal-auth-required',
  'no-municipal-gis',

  // Data quality issues
  'malformed-geojson',
  'topology-errors',
  'coordinate-errors',

  // Temporal issues
  'redistricting-in-progress',
  'redistricting-completed',

  // Multi-jurisdiction complexity
  'multi-county-unsupported',
  'consolidated-city-county',
}
```

---

## File Structure

### Production Mode (FIPS Sharding)

**Strategy**: Partition by first 2 FIPS digits (US state code) into 50 shard files.

**Benefits**:
- 50 lock files = minimal contention (max 2 agents per state)
- State-specific queries read 1 file (optimal)
- All-states queries read 50 files (~100ms, acceptable)

**Directory layout**:
```
discovery-attempts/
├── 2025-11/
│   ├── discovery-log-01.ndjson.gz  # Alabama
│   ├── discovery-log-06.ndjson.gz  # California
│   ├── discovery-log-36.ndjson.gz  # New York
│   ├── discovery-log-48.ndjson.gz  # Texas
│   └── ...                          # 50 state shards total
├── 2025-12/
│   └── discovery-log-*.ndjson.gz
└── indexes/
    ├── granularity-tiers.json
    ├── blockers.json
    ├── authority-stats.json
    └── coverage-by-state.json
```

**FIPS-to-shard mapping**:
- FIPS `0666000` (San Diego, CA) → `discovery-log-06.ndjson.gz`
- FIPS `4827000` (Fort Worth, TX) → `discovery-log-48.ndjson.gz`
- FIPS `3651000` (NYC, NY) → `discovery-log-36.ndjson.gz`

### Staging Mode (Zero Contention)

**Strategy**: Agents write to unique staging files, background worker merges periodically.

**Use case**: 100+ concurrent agents requiring zero lock contention.

**Directory layout**:
```
discovery-staging/
├── agt-001-1732041234567.ndjson
├── agt-002-1732041234789.ndjson
├── agt-003-1732041235012.ndjson
└── ...

discovery-attempts/
└── 2025-11/
    └── discovery-log-*.ndjson.gz  # Merged results
```

**Flow**:
1. Agent writes: `discovery-staging/{agent-id}-{timestamp}.ndjson` (no lock, unique file)
2. Background worker (5 min): Merge staging → compressed shards
3. Query: Union(staging files, compressed shards)

**Enable staging mode**:
```bash
export SHADOW_ATLAS_STAGING=true
export SHADOW_ATLAS_AGENT_ID=agt-$(uuidgen | cut -c1-8)
npm run shadow-atlas:merge-worker  # Background merge process
```

### Example Log Entries

```jsonl
{"f":"0666000","n":"San Diego","s":"CA","p":1386932,"g":1,"fc":9,"conf":85,"auth":3,"src":"muni-gis","url":"https://seshat.datasd.org/...","q":{"v":true,"t":1,"r":474,"d":"2021-12-14"},"why":["T0 blocked: No precinct data","T1 success: 9 districts","Authority: Municipal GIS (verified)"],"tried":[0,1],"blocked":null,"ts":"2025-11-19T07:42:00Z","aid":"agt-001","sup":null}
{"f":"0668000","n":"San Jose","s":"CA","p":1013240,"g":1,"fc":10,"conf":82,"auth":2,"src":"arcgis","url":"https://hub.arcgis.com/...","q":{"v":true,"t":1,"r":1776,"d":null},"why":["T0 unavailable","T1 success: 10 districts","Authority: ArcGIS Hub"],"tried":[0,1],"blocked":null,"ts":"2025-11-19T07:42:00Z","aid":"agt-001","sup":null}
{"f":"0807850","n":"Boulder","s":"CO","p":108090,"g":2,"fc":1,"conf":100,"auth":5,"src":"tiger","url":"https://census.gov/...","q":{"v":true,"t":1,"r":850,"d":"2023-01-01"},"why":["T0 blocked: At-large elections","T1 blocked: At-large council","T2 success: Municipal boundary","T2 optimal for at-large cities"],"tried":[0,1,2],"blocked":"at-large-governance","ts":"2025-11-19T08:00:00Z","aid":"agt-002","sup":null}
```

### Index Files (Auto-generated)

**`granularity-tiers.json`** (Quick FIPS lookup):
```json
{
  "0666000": {"g":1,"fc":9,"conf":85,"auth":3,"ts":"2025-11-19T07:42:00Z"},
  "0668000": {"g":1,"fc":10,"conf":82,"auth":2,"ts":"2025-11-19T07:42:00Z"},
  "0807850": {"g":2,"fc":1,"conf":100,"auth":5,"ts":"2025-11-19T08:00:00Z"}
}
```

**`blockers.json`** (Retry queue):
```json
{
  "1234567": {
    "tier_blocked": 1,
    "blocker": "portal-404",
    "retry_after": "2025-12-19",
    "attempts": 2,
    "pop": 125000
  }
}
```

**`authority-stats.json`** (Coverage breakdown):
```json
{
  "t0_auth5": 12,    // Tier 0 from federal sources
  "t1_auth5": 45,    // Tier 1 from federal
  "t1_auth3": 156,   // Tier 1 from municipal
  "t1_auth2": 89,    // Tier 1 from hubs
  "t2_auth5": 18950  // Tier 2 from Census fallback
}
```

---

## Autonomous Retry Logic

### Retry Policies

```typescript
interface RetryPolicy {
  blocker: string;
  retryAfterDays: number;
  maxRetries: number;
}

const RETRY_POLICIES: RetryPolicy[] = [
  { blocker: 'portal-404', retryAfterDays: 30, maxRetries: 3 },
  { blocker: 'portal-timeout', retryAfterDays: 7, maxRetries: 5 },
  { blocker: 'no-municipal-gis', retryAfterDays: 90, maxRetries: 2 },
  { blocker: 'redistricting-completed', retryAfterDays: 180, maxRetries: 1 },
];
```

### Daily Retry Orchestrator

```typescript
async function retryFailedDiscoveries(): Promise<void> {
  const log = await loadDiscoveryLog();

  const retryCandidates = log.filter((entry) => {
    if (!entry.blocked) return false;

    const policy = RETRY_POLICIES.find((p) => p.blocker === entry.blocked);
    if (!policy) return false;

    const daysSince = (Date.now() - new Date(entry.ts).getTime()) / (1000 * 60 * 60 * 24);
    const attemptCount = log.filter((e) => e.f === entry.f).length;

    return daysSince >= policy.retryAfterDays && attemptCount <= policy.maxRetries;
  });

  // Re-run discovery for each candidate
  for (const candidate of retryCandidates) {
    const newAttempt = await discoverMaximalGranularity({
      fips: candidate.f,
      name: candidate.n,
      state: candidate.s,
      population: candidate.p,
    });

    newAttempt.sup = candidate.ts; // Link to previous attempt
    await appendToLog(newAttempt);
  }

  await regenerateIndexes();
}
```

---

## Query Performance

### State-Specific Queries (Optimal)

Query California cities (FIPS 06xxxxx):
```bash
./scripts/query-provenance.sh state CA
```

**Performance**: Reads 1 shard file (`discovery-log-06.ndjson.gz`) + staging files
**Latency**: ~2-5ms

### All-States Queries (Acceptable)

Query all Tier 1 cities:
```bash
./scripts/query-provenance.sh tiers
```

**Performance**: Reads 50 shard files + staging files
**Latency**: ~100-200ms

### Recent Discoveries (Fast)

Query staging area only:
```typescript
import { readStagingEntries } from './provenance-staging-writer.js';
const recent = await readStagingEntries();
```

**Performance**: Reads uncompressed NDJSON files
**Latency**: ~5-10ms for 100 entries

---

## Query Interface

### Finding High-Value Targets

```bash
# Cities at Tier 0 (finest granularity)
zcat discovery-log.ndjson.gz | jq -c 'select(.g == 0)'

# Cities blocked at Tier 1 by at-large governance (expected)
zcat discovery-log.ndjson.gz | jq -c 'select(.blocked == "at-large-governance")'

# High-population cities with low confidence (needs specialist agent)
zcat discovery-log.ndjson.gz | jq -c 'select(.conf < 70 and .conf > 0 and .p > 100000)' | jq -s 'sort_by(-.p)'

# Authority breakdown
zcat discovery-log.ndjson.gz | jq -s 'group_by(.auth) | map({auth: .[0].auth, count: length})'

# Coverage by tier (weighted by population)
zcat discovery-log.ndjson.gz | jq -s 'group_by(.g) | map({tier: .[0].g, cities: length, pop: map(.p) | add})'
```

---

## Production Workflow

1. **Discovery Agent** → Runs `discoverMaximalGranularity()` → Appends to `discovery-log.ndjson`
2. **Validation Agent** → Validates quality metrics → Updates `q` field
3. **Index Generator** → Regenerates `granularity-tiers.json`, `blockers.json`, `authority-stats.json`
4. **Retry Orchestrator** (daily cron) → Re-attempts blockers per policy → Appends new attempts
5. **QA Agent** (monthly) → Re-validates all Tier 0-1 entries → Detects URL rot/redistricting

---

## Key Benefits

✅ **Granularity maximization**: Agents drill to finest available tier, reason about blockers
✅ **Authority weighting**: Federal > State > Municipal > Hub > Community
✅ **Quality metrics**: Geometric, temporal, authority, completeness all tracked
✅ **Reasoning transparency**: `why` array shows decision chain
✅ **Efficient storage**: 1.5MB compressed for 19,495 US cities
✅ **Self-healing**: Retry orchestrator auto-recovers from temporary failures
✅ **Audit trail**: Every attempt logged with supersedes chain

This system enables autonomous discovery at scale with full provenance and quality assessment.

---

## Architecture Decision Records

### ADR-001: FIPS-Based Sharding

**Decision**: Partition logs by first 2 FIPS digits (state code) into 50 shard files.

**Context**: Single monthly log file creates lock contention at 10+ concurrent agents.

**Consequences**:
- ✅ Minimal lock contention (max 2 agents per state statistically)
- ✅ State queries read 1 file (optimal)
- ✅ Simple implementation (2 hours)
- ⚠️ All-states queries read 50 files (acceptable, ~100ms)

**Alternatives considered**:
- Agent-level sharding: Complex queries (100+ files)
- Database: Overkill for our scale
- No sharding: Fails at 10+ agents

### ADR-002: Staging + Merge for Zero Contention

**Decision**: Optional staging mode where agents write to unique files, background worker merges.

**Context**: FIPS sharding handles 99% of cases, but true zero contention needed for 100+ agents.

**Consequences**:
- ✅ Zero lock contention (each agent writes to unique file)
- ✅ Optional (default to FIPS sharding for simplicity)
- ⚠️ Eventual consistency (5 min merge interval)
- ⚠️ Requires background worker process

**Alternatives considered**:
- Database: Overkill, breaks NDJSON spec
- No staging: Lock contention inevitable at 100+ agents

### ADR-003: File Handle Leak Fix

**Decision**: Use try-finally to guarantee handle cleanup even on errors.

**Context**: File descriptor warnings (70+ leaked handles in tests) indicate `FileLock.release()` bug.

**Consequences**:
- ✅ Guaranteed resource cleanup
- ✅ Zero file descriptor leaks
- ✅ Prevents "too many open files" errors at scale

**Code change**:
```typescript
async release(): Promise<void> {
  if (this.lockHandle) {
    try {
      await this.lockHandle.close();
    } finally {
      this.lockHandle = null; // ALWAYS clear reference
    }
  }
  // ... cleanup lock file
}
```
