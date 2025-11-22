# Discovery Worker Architecture

**Production-grade system for automated council district discovery at scale.**

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Discovery State (32,041 cities)               │
│                                                                   │
│  pending/         found/          not-found/       error/        │
│  32,041 cities →  0 cities        0 cities         0 cities      │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Discovery Worker                              │
│                                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │  Query      │  │  Discovery   │  │  State Management      │ │
│  │  Strategy   │→ │  Provider    │→ │  + Metrics Tracking    │ │
│  └─────────────┘  └──────────────┘  └────────────────────────┘ │
│                                                                   │
│  Strategies: population, state, random, alphabetical, retry      │
│  Parallelism: 1-10 concurrent workers                            │
│  Rate Limiting: 100ms - 5000ms delays                            │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│             USCouncilDistrictDiscoveryProvider                   │
│                                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                      │
│  │ ArcGIS   │  │ Socrata  │  │  CKAN    │                      │
│  │ Scanner  │  │ Scanner  │  │ Scanner  │                      │
│  └──────────┘  └──────────┘  └──────────┘                      │
│       ↓              ↓              ↓                            │
│  ┌────────────────────────────────────────┐                     │
│  │   Deterministic Scoring (70% filtered) │                     │
│  └────────────────────────────────────────┘                     │
│                     ↓                                            │
│  ┌────────────────────────────────────────┐                     │
│  │   LLM Selection (ambiguous cases only) │                     │
│  └────────────────────────────────────────┘                     │
│                     ↓                                            │
│  ┌────────────────────────────────────────┐                     │
│  │   GeoJSON Download + Transform         │                     │
│  └────────────────────────────────────────┘                     │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│                 Output: Boundary GeoJSON Files                   │
│                                                                   │
│  boundaries/US/council-districts/{STATE}/                        │
│  └── US_council-districts_CA_0644000.geojson                    │
│                                                                   │
│  + Discovery state updated (pending → found/not-found/error)    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Discovery State Manager

**Purpose:** Universal state tracking for all 32,041 US cities

**File Structure:**
```
discovery-state/US/council-districts/
├── pending/          # 32,041 cities awaiting discovery
├── found/            # Cities with council districts discovered
├── not-found/        # Cities with no portal data
├── error/            # Discovery failures (technical errors)
└── manual-review/    # Requires human verification
```

**Key Features:**
- File-based storage (no database required)
- Agent-friendly queries (grep, find, sort)
- Git-trackable changes
- Parallel processing safe

**API:**
```typescript
const manager = new DiscoveryStateManager(BASE_DIR);

// Query cities by strategy
const cities = await manager.query({
  country: 'US',
  level: 'council-district',
  status: 'pending',
  sortBy: 'population',
  sortDirection: 'desc',
  limit: 100,
});

// Update status after discovery
await manager.updateStatus(city, 'found', {
  success: true,
  selected: {
    portalType: 'arcgis',
    url: result.url,
    selectionMethod: 'deterministic',
  },
});
```

### 2. Discovery Worker

**Purpose:** Orchestrates automated council district discovery

**Configuration:**
```typescript
interface WorkerConfig {
  strategy: 'population' | 'state' | 'random' | 'alphabetical' | 'retry';
  limit?: number;           // Max cities to process
  region?: string;          // State filter (e.g., 'CA')
  parallelism: number;      // Concurrent workers (1-10)
  rateLimit: number;        // Delay between requests (ms)
  testMode: boolean;        // Dry run (no state changes)
  retryErrors: boolean;     // Retry failed discoveries
  maxRetries: number;       // Max retry attempts
}
```

**Discovery Workflow:**

1. **Query Phase:**
   - Load pending cities from discovery state
   - Apply filters (region, population, etc.)
   - Sort by strategy (population-first, alphabetical, etc.)

2. **Discovery Phase:**
   - For each city:
     - Search ArcGIS, Socrata, CKAN portals (parallel)
     - Score candidates deterministically
     - LLM select if ambiguous (score 6-8)
     - Download GeoJSON
     - Transform to normalized boundaries

3. **Update Phase:**
   - Save boundary GeoJSON to output directory
   - Update discovery state (pending → found/not-found/error)
   - Track metrics (success rate, districts found, errors)

**Metrics Tracking:**
```typescript
interface DiscoveryMetrics {
  totalCities: number;
  successful: number;
  notFound: number;
  errors: number;

  districtCounts: Map<string, number>;  // city → district count
  errorMessages: Map<string, string>;   // city → error message

  processingRate: number;  // cities per second
}
```

### 3. US Council District Discovery Provider

**Purpose:** Portal discovery + GeoJSON transformation

**Portal Scanners:**

```typescript
// ArcGIS FeatureServer/MapServer
const arcgisResults = await searchArcGIS({
  name: 'Los Angeles',
  state: 'CA',
  fips: '0644000',
});

// Socrata Open Data
const socrataResults = await searchSocrata({
  name: 'Los Angeles',
  state: 'CA',
});

// CKAN Portal
const ckanResults = await searchCKAN({
  name: 'Los Angeles',
  state: 'CA',
});
```

**Deterministic Scoring:**

Filters 70% of candidates without LLM:

```typescript
function scoreCandidate(candidate: {
  title: string;
  description: string;
  tags: string[];
}): number {
  let score = 0;

  // Pattern matching (case-insensitive)
  if (/council.*district/i.test(title)) score += 3;
  if (/ward/i.test(title)) score += 2;
  if (/district/i.test(title)) score += 1;

  // Negative signals
  if (/school|election|police|fire/i.test(title)) score -= 5;

  return Math.max(0, score);
}
```

**LLM Selection:**

Only for ambiguous cases (score 6-8):

```typescript
const selected = await selectBestSource({
  cityName: 'Los Angeles',
  state: 'CA',
  candidates: [
    {
      title: 'LA City Council Districts',
      description: 'Official council district boundaries',
      url: 'https://opendata.arcgis.com/...',
      portalType: 'arcgis',
    },
    // ... 2 more candidates
  ],
});
```

**Transformation:**

```typescript
// Raw GeoJSON → Normalized Boundaries
const boundaries = await provider.transform([rawFile]);

// Output:
[
  {
    id: '0644000-CD-1',          // Unique ID: FIPS-CD-districtNum
    name: 'Council District 1',
    level: 'council-district',
    parentId: '0644000',         // Parent city FIPS
    geometry: { type: 'Polygon', coordinates: [...] },
    population: 250000,
    source: {
      provider: 'US Council District Discovery',
      authorityLevel: 'municipal-agency',
      legalStatus: 'official',
      collectionMethod: 'portal-discovery',
      verifiedBy: 'automated',
    },
  },
  // ... 14 more districts for Los Angeles
]
```

---

## Error Handling

### Automatic Retry Logic

```typescript
private async discoverWithRetry(city: CityTarget): Promise<Result | null> {
  const maxAttempts = this.config.maxRetries;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await this.provider.discoverCity(city);
    } catch (error) {
      if (attempt < maxAttempts) {
        console.log(`Retry ${attempt}/${maxAttempts - 1}...`);
        await this.sleep(2000);  // 2 second delay
        continue;
      }
      throw error;
    }
  }
}
```

### Error Classification

**Transient Errors (retry automatically):**
- Network timeouts
- Portal rate limiting (HTTP 429)
- Temporary server errors (HTTP 5xx)

**Permanent Errors (mark as error/not-found):**
- No portal data found
- Invalid GeoJSON format
- Authentication failures

### State Transitions

```
pending ──discovery──> found       (✅ success)
        ──discovery──> not-found   (⚠️ no portal data)
        ──discovery──> error       (❌ technical error)
        ──manual───> manual-review (🔍 requires verification)
```

---

## Performance Characteristics

### Serial Processing (Default)

**Configuration:**
```bash
npm run atlas:discover-councils -- --strategy population --limit 100
```

**Performance:**
- **Rate:** ~0.5-1.0 cities/second (portal latency dependent)
- **Duration:** 100 cities in ~2-3 minutes
- **Safety:** Zero risk of rate limiting

### Parallel Processing (Advanced)

**Configuration:**
```bash
npm run atlas:discover-councils -- \
  --strategy population \
  --limit 100 \
  --parallel 5 \
  --rate-limit 2000
```

**Performance:**
- **Rate:** ~2-5 cities/second (5x speedup)
- **Duration:** 100 cities in ~30-60 seconds
- **Risk:** Moderate (watch for HTTP 429 errors)

### Full Scale (32,041 Cities)

**Serial:**
- Duration: ~18-36 hours (0.5-1.0 cities/sec)
- Safety: Maximum

**Parallel (5 workers):**
- Duration: ~4-8 hours (2-5 cities/sec)
- Safety: Moderate

---

## Cost Analysis

### Computation

**Free (browser-native + Node.js):**
- Portal API calls: Free (public open data portals)
- LLM selection: $0.002-$0.01 per ambiguous case
- State management: File-based (zero database costs)

### Expected LLM Usage

**Deterministic filtering eliminates 70% of decisions:**
- **Top 100 cities:** ~30 LLM calls ($0.06-$0.30)
- **All 32,041 cities:** ~9,600 LLM calls ($20-$100)

**Optimization:** Use Claude Haiku for selection (10x cheaper than Sonnet)

### Storage

**Discovery State:**
- 32,041 JSON files × 500 bytes = ~16 MB

**Boundary GeoJSON:**
- 3,000 cities × 100 KB average = ~300 MB
- 32,041 cities (full coverage) = ~3.2 GB

**Total:** <5 GB for complete coverage

---

## Production Deployment Phases

### Phase 1: Top 100 Cities (Week 1)

```bash
npm run atlas:discover-councils -- --strategy population --limit 100
```

**Expected yield:**
- 80-90 successful discoveries
- 3,000-5,000 council districts
- ~50% US population coverage

### Phase 2: State-by-State (Weeks 2-4)

```bash
# California (1,618 cities)
npm run atlas:discover-councils -- --strategy state --region CA

# Texas (1,863 cities)
npm run atlas:discover-councils -- --strategy state --region TX

# Florida (956 cities)
npm run atlas:discover-councils -- --strategy state --region FL
```

**Expected yield:**
- 60-70% success rate (smaller cities have less portal coverage)
- ~15,000-20,000 council districts
- Major metro areas fully covered

### Phase 3: Full Coverage (Month 2)

```bash
npm run atlas:discover-councils -- --strategy population
```

**Expected yield:**
- 50-60% overall success rate (~16,000-19,000 cities)
- ~80,000-100,000 council districts
- Complete coverage for 190+ countries expansion

---

## Quality Assurance

### Pre-Production Checklist

- [ ] Test with 10 random cities (`--test` mode)
- [ ] Validate GeoJSON output (QGIS or geojson.io)
- [ ] Check discovery state transitions (pending → found)
- [ ] Verify error handling (retry logic works)
- [ ] Monitor success rates (>40% acceptable)

### Post-Production Validation

```bash
# Check statistics
./check-progress.sh

# Validate GeoJSON files
find boundaries/US/council-districts -name "*.geojson" -exec geojsonhint {} \;

# Verify discovery state consistency
find discovery-state/US/council-districts/found -name "*.json" | wc -l
find boundaries/US/council-districts -name "*.geojson" | wc -l
# (these counts should match)
```

---

## Future Enhancements

### 1. School Districts

```typescript
await manager.initialize('US', 'school-district');

npm run atlas:discover-schools -- --strategy population --limit 100
```

### 2. County Commission Districts

```typescript
await manager.initialize('US', 'county');

npm run atlas:discover-counties -- --strategy population --limit 100
```

### 3. International Expansion

```typescript
await manager.initialize('CA', 'municipality');  // Canada
await manager.initialize('GB', 'ward');          // United Kingdom

npm run atlas:discover-councils -- --country CA --strategy population
```

---

## Architecture Principles

### 1. Universal, Not Top-N

**Every city gets equal treatment.** No binning, no priority tiers. All 32,041 cities have discovery state, agents choose strategies.

### 2. File-Based, Not Database

**Agent-friendly queries.** grep, find, sort work natively. Git tracks changes. Zero database dependencies.

### 3. Composable, Not Monolithic

**Same system works for:**
- Council districts, school districts, county districts
- US, Canada, UK, France, 190+ countries
- Population-first, geographic sweep, random sampling

### 4. Deterministic First, LLM Second

**70% of decisions automated.** Pattern matching eliminates most candidates without LLM. Only ambiguous cases (score 6-8) use LLM selection.

---

## Quality Discourse Pays

**Every city matters. Agentic discovery enables authentic civic participation.**

The discovery worker is production-ready infrastructure for scaling Shadow Atlas from 37 cities to 32,041 cities, with a clear path to 190+ countries.

**The data is universal. The strategy is flexible. The system is composable.**
