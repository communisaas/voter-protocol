# Shadow Atlas: Technical Specification for Global Address Resolution at District-Level Precision

**Version**: 1.0
**Status**: Production Specification
**Authors**: Distinguished Engineering Team
**Date**: 2025-11-20

---

## Executive Summary

Shadow Atlas resolves arbitrary addresses to the most granular political boundary available (city council district/ward) for 190+ countries, enabling privacy-preserving civic participation via zero-knowledge proofs of district membership.

**Core Requirements**:
1. **Highest precision**: Resolve to city district/ward (not county, not state)
2. **Zero runtime cost**: Free geocoding for US (Census), batched commercial for global
3. **Hierarchical fallback**: District → City → County → State → Country
4. **Cryptographic proof-friendliness**: Merkle tree with deterministic leaf ordering
5. **Quarterly freshness**: Boundaries updated via automated discovery + human review

**Architecture Philosophy**: Build the inverse of Google Maps. Instead of "show me where this boundary is," we answer "which boundary contains this point?" optimized for cryptographic proof generation, not visual rendering.

---

## Part 1: Problem Space

### User Flow (Runtime)

```
User enters address:
  "1600 Pennsylvania Ave NW, Washington, DC 20500"

System resolves hierarchically:
  1. Geocode → lat/lng (38.8977, -77.0365)
  2. Point-in-polygon test → Country (USA)
  3. Point-in-polygon test → State (DC)
  4. Point-in-polygon test → City (Washington, DC)
  5. Point-in-polygon test → District (Ward 2)

ZK Proof generation:
  - Shadow Atlas Merkle root: 0xabc...def (quarterly IPFS hash)
  - Leaf: hash(Ward 2 boundary GeoJSON)
  - Merkle proof: [sibling hashes]
  - Public inputs: Poseidon(address), Merkle root
  - Private inputs: lat/lng, Merkle proof path
  - Circuit proves: "I know an address in Ward 2" without revealing address
```

### Precision Hierarchy (Granularity Matters)

**Ideal precision** (what we want):
```
Address → City Council District/Ward
Examples:
- Seattle: 7 districts
- NYC: 51 districts
- Chicago: 50 wards
```

**Acceptable fallback** (when district data unavailable):
```
Address → City limits (e.g., at-large cities)
Address → County (rural areas)
Address → State (last resort)
```

**Unacceptable** (too coarse for civic participation):
```
Address → Country only (useless for targeting representatives)
Address → Congressional district (wrong granularity, we need local)
```

### Scale Requirements

**US Coverage** (Phase 1, 12 months):
```
Top 100 cities:               ~80-90% district-level precision
Cities 101-500:               ~60-70% district-level precision
Cities 501-19,000:            City-level precision (fallback)
Rural addresses:              County-level precision (fallback)
```

**Global Coverage** (Phase 2, 24-36 months):
```
G20 countries:                City-level precision minimum
190+ countries:               Country-level precision minimum
```

---

## Part 2: Hierarchical Boundary Resolution System

### Data Model: Nested Political Boundaries

```typescript
/**
 * Political boundary representation
 *
 * CRITICAL: Boundaries are HIERARCHICAL and OVERLAPPING
 * Example: Ward 2 (DC) ⊂ Washington DC ⊂ District of Columbia ⊂ USA
 */
interface PoliticalBoundary {
  /** Globally unique identifier (e.g., "US-DC-WASHINGTON-WARD2") */
  readonly id: string;

  /** Boundary type (determines resolution priority) */
  readonly type: BoundaryType;

  /** Parent boundary ID (e.g., Ward 2 parent = Washington DC) */
  readonly parentId: string | null;

  /** GeoJSON polygon/multipolygon (WGS84, EPSG:4326) */
  readonly geometry: Polygon | MultiPolygon;

  /** Governance metadata (who represents this boundary?) */
  readonly governance: GovernanceMetadata;

  /** Data provenance (where did this come from?) */
  readonly provenance: ProvenanceMetadata;

  /** Validity period (boundaries change every 10 years) */
  readonly validFrom: Date;
  readonly validUntil: Date | null;
}

enum BoundaryType {
  // Highest precision (what we want)
  CITY_COUNCIL_DISTRICT = 'city_council_district',
  CITY_COUNCIL_WARD = 'city_council_ward',

  // Acceptable fallback
  CITY_LIMITS = 'city_limits',
  COUNTY = 'county',

  // Coarse fallback
  STATE_PROVINCE = 'state_province',
  COUNTRY = 'country',

  // Wrong granularity (don't use for civic participation)
  CONGRESSIONAL_DISTRICT = 'congressional_district', // Federal, not local
  VOTING_PRECINCT = 'voting_precinct', // Too granular, changes frequently
}

interface GovernanceMetadata {
  /** Official name (e.g., "Ward 2", "District 7") */
  readonly officialName: string;

  /** Representative type (e.g., "City Council Member") */
  readonly representativeTitle: string;

  /** Current representative(s) (can be multiple for at-large) */
  readonly representatives: Representative[];

  /** Governance structure (single-member vs at-large) */
  readonly governanceType: 'single-member' | 'at-large' | 'mixed';

  /** Contact information (office phone, email, website) */
  readonly contactInfo: ContactInfo;
}

interface ProvenanceMetadata {
  /** Data source URL (municipal GIS portal) */
  readonly sourceUrl: string;

  /** Portal type (determines trust level) */
  readonly portalType: 'municipal-gis' | 'state-gis' | 'federal' | 'osm';

  /** Validation confidence (0-100) */
  readonly confidence: number;

  /** Last verified timestamp */
  readonly lastVerified: Date;

  /** Discovery method (manual vs automated) */
  readonly discoveredBy: 'manual' | 'domain-enum' | 'state-gis' | 'community';
}
```

### Resolution Algorithm: Hierarchical Point-in-Polygon

```typescript
/**
 * Resolve address to most granular political boundary
 *
 * ALGORITHM:
 * 1. Geocode address → lat/lng (free Census API for US)
 * 2. Test point-in-polygon for ALL boundaries, sorted by precision
 * 3. Return highest-precision match (city district > city > county > state)
 * 4. Cache result (same address = same boundary for 10 years)
 *
 * PERFORMANCE:
 * - Cold start: 2-5s (geocode + PIP tests)
 * - Cached: <100ms (SQLite lookup)
 * - Batch mode: 10k addresses/minute (Census batch API)
 */
async function resolveAddress(address: string): Promise<BoundaryResolution> {
  // Step 1: Check cache (addresses don't move)
  const cached = await cache.get(address);
  if (cached && cached.validUntil > new Date()) {
    return cached;
  }

  // Step 2: Geocode address → lat/lng
  const latLng = await geocode(address);
  if (!latLng) {
    return { error: 'GEOCODE_FAILED', precision: null };
  }

  // Step 3: Hierarchical PIP test (finest → coarsest)
  const boundaries = await getAllBoundaries(); // Loaded from Shadow Atlas

  // Sort by precision (district > city > county > state > country)
  const sorted = boundaries.sort((a, b) =>
    PRECISION_RANK[a.type] - PRECISION_RANK[b.type]
  );

  // Test point-in-polygon for each boundary (stop at first match)
  for (const boundary of sorted) {
    if (pointInPolygon(latLng, boundary.geometry)) {
      // Cache result for 1 year (boundaries stable)
      await cache.set(address, boundary, { ttl: 31536000 });

      return {
        boundary,
        precision: boundary.type,
        confidence: boundary.provenance.confidence,
        latLng,
      };
    }
  }

  return { error: 'NO_BOUNDARY_MATCH', precision: null };
}

// Precision ranking (lower = higher priority)
const PRECISION_RANK: Record<BoundaryType, number> = {
  [BoundaryType.CITY_COUNCIL_DISTRICT]: 0,
  [BoundaryType.CITY_COUNCIL_WARD]: 1,
  [BoundaryType.CITY_LIMITS]: 2,
  [BoundaryType.COUNTY]: 3,
  [BoundaryType.STATE_PROVINCE]: 4,
  [BoundaryType.COUNTRY]: 5,
  [BoundaryType.CONGRESSIONAL_DISTRICT]: 999, // Never use
  [BoundaryType.VOTING_PRECINCT]: 999, // Never use
};
```

---

## Part 3: Geocoding Strategy (Zero-Cost for US)

### US: Census Bureau Geocoder (FREE)

**API**: `https://geocoding.geo.census.gov/geocoder`

**Capabilities**:
- **Single address**: 1 req/s rate limit, free forever
- **Batch mode**: 10,000 addresses per CSV upload, no rate limit
- **Precision**: Rooftop-level (interpolated from TIGER/Line street segments)
- **Coverage**: 100% US addresses (authoritative federal source)

**Implementation**:

```typescript
/**
 * Census Geocoder integration
 *
 * COST: $0 (public API, no auth required)
 * RATE LIMIT: 1 req/s (single), unlimited (batch)
 * PRECISION: Rooftop-level (±10m accuracy)
 */
class CensusGeocoder {
  private readonly SINGLE_URL = 'https://geocoding.geo.census.gov/geocoder/geographies/address';
  private readonly BATCH_URL = 'https://geocoding.geo.census.gov/geocoder/geographies/addressbatch';

  /**
   * Geocode single address (rate limited: 1 req/s)
   */
  async geocodeSingle(address: string): Promise<LatLng | null> {
    const params = new URLSearchParams({
      street: this.parseStreet(address),
      city: this.parseCity(address),
      state: this.parseState(address),
      zip: this.parseZip(address),
      benchmark: 'Public_AR_Current', // Latest address ranges
      vintage: 'Current_Current', // Current geographic vintage
      format: 'json',
    });

    const response = await fetch(`${this.SINGLE_URL}?${params}`);
    const data = await response.json();

    if (data.result.addressMatches.length === 0) {
      return null;
    }

    const match = data.result.addressMatches[0];
    return {
      lat: match.coordinates.y,
      lng: match.coordinates.x,
      precision: 'rooftop',
    };
  }

  /**
   * Geocode batch (10k addresses per request, no rate limit)
   *
   * FORMAT: CSV with columns "id,street,city,state,zip"
   * RESPONSE: CSV with "id,lat,lng,match_quality"
   */
  async geocodeBatch(addresses: Address[]): Promise<Map<string, LatLng>> {
    // Build CSV
    const csv = [
      'id,street,city,state,zip',
      ...addresses.map(addr =>
        `${addr.id},"${addr.street}","${addr.city}","${addr.state}","${addr.zip}"`
      ),
    ].join('\n');

    // Upload to Census API
    const formData = new FormData();
    formData.append('addressFile', new Blob([csv]), 'addresses.csv');
    formData.append('benchmark', 'Public_AR_Current');
    formData.append('vintage', 'Current_Current');

    const response = await fetch(this.BATCH_URL, {
      method: 'POST',
      body: formData,
    });

    const resultCSV = await response.text();
    return this.parseBatchResults(resultCSV);
  }

  /**
   * Parse batch results CSV → Map<addressId, LatLng>
   */
  private parseBatchResults(csv: string): Map<string, LatLng> {
    const lines = csv.split('\n').slice(1); // Skip header
    const results = new Map<string, LatLng>();

    for (const line of lines) {
      const [id, , , matchQuality, , , lat, lng] = line.split(',');

      if (matchQuality === 'Match') {
        results.set(id, {
          lat: parseFloat(lat),
          lng: parseFloat(lng),
          precision: 'rooftop',
        });
      }
    }

    return results;
  }
}
```

**Performance**:
```
Single address:        1s (network latency)
Batch (10k addresses): 30-60s upload + 2-5 min processing
Timeline (150M US):    42 hours (batched at 10k/request)
Cost:                  $0
```

### Global: Commercial Geocoder (Deferred Until Funded)

**Options** (in order of preference):

1. **Mapbox** (best for global, $0.002/address bulk pricing)
2. **Google Maps** (highest precision, $0.005/address)
3. **HERE** (automotive-grade, $0.003/address)

**Decision**: DON'T BUILD THIS YET. Phase 1 = US-only with free Census API. Global = $2M+ budget required.

---

## Part 4: Shadow Atlas Data Structure (Cryptographic Constraints)

### Merkle Tree Requirements

**Why Merkle tree?** ZK circuit needs:
1. Compact proof size (384-512 bytes for K=14 circuit)
2. Deterministic leaf ordering (same tree every time)
3. Efficient verification (300-400k gas on-chain)

**Tree Structure**:

```typescript
/**
 * Shadow Atlas Merkle Tree
 *
 * LEAF ORDERING: Deterministic (sorted by boundary ID)
 * HASH FUNCTION: Poseidon (ZK-friendly)
 * TREE DEPTH: log2(N) where N = boundary count
 * IPFS STORAGE: Quarterly snapshots (immutable)
 */
interface ShadowAtlasMerkleTree {
  /** Merkle root (committed on-chain quarterly) */
  readonly root: PoseidonHash;

  /** Leaf nodes (sorted by ID for determinism) */
  readonly leaves: MerkleLeaf[];

  /** IPFS CID (content-addressed storage) */
  readonly ipfsCID: string;

  /** Validity period (quarterly updates) */
  readonly validFrom: Date;
  readonly validUntil: Date;
}

interface MerkleLeaf {
  /** Boundary ID (e.g., "US-WA-SEATTLE-DISTRICT7") */
  readonly id: string;

  /** Leaf hash: Poseidon(boundary GeoJSON) */
  readonly hash: PoseidonHash;

  /** Leaf index in tree (deterministic) */
  readonly index: number;

  /** Merkle proof path (sibling hashes from leaf → root) */
  readonly proof: PoseidonHash[];
}

/**
 * Generate Merkle tree from boundaries
 *
 * CRITICAL: Leaf ordering MUST be deterministic
 * - Sort by boundary ID (lexicographic)
 * - Hash each boundary GeoJSON with Poseidon
 * - Build tree bottom-up with Poseidon pairs
 */
function buildMerkleTree(boundaries: PoliticalBoundary[]): ShadowAtlasMerkleTree {
  // Step 1: Sort boundaries deterministically
  const sorted = [...boundaries].sort((a, b) => a.id.localeCompare(b.id));

  // Step 2: Hash each boundary (Poseidon-friendly)
  const leaves = sorted.map((boundary, index) => ({
    id: boundary.id,
    hash: poseidonHash(serializeGeoJSON(boundary.geometry)),
    index,
    proof: [], // Computed below
  }));

  // Step 3: Build Merkle tree (binary tree, Poseidon hash pairs)
  const tree = buildBinaryTree(leaves.map(l => l.hash));
  const root = tree[0][0];

  // Step 4: Compute Merkle proofs for each leaf
  for (let i = 0; i < leaves.length; i++) {
    leaves[i].proof = computeMerkleProof(tree, i);
  }

  return {
    root,
    leaves,
    ipfsCID: '', // Computed after IPFS upload
    validFrom: new Date(),
    validUntil: addMonths(new Date(), 3), // Quarterly updates
  };
}
```

**Storage**:

```
Merkle Tree (IPFS):
  - 1,000 boundaries: ~5 MB GeoJSON + proofs
  - 10,000 boundaries: ~50 MB
  - 100,000 boundaries: ~500 MB
  - Cost: $5/month (Pinata/Web3.Storage)

On-Chain (Scroll L2):
  - Merkle root only: 32 bytes (Poseidon hash)
  - Update frequency: Quarterly (4 txs/year)
  - Gas cost: ~100k gas @ $0.0002 = $0.02/quarter
```

---

## Part 5: Boundary Discovery Pipeline (80-90% Autonomous)

### Discovery Workflow

```
PHASE 1: Automated Discovery (50-60% coverage)
  ├─ Domain Enumeration (30+ patterns per city)
  │  └─ Test: data.seattle.gov, gis-seattle.opendata.arcgis.com, etc.
  ├─ Portal Detection (identify Socrata vs ArcGIS Hub vs Municipal GIS)
  ├─ PostDownloadValidator (confidence ≥60%)
  └─ Staging Registry (SQLite, awaits human approval)

PHASE 2: State GIS Fallback (25-30% coverage)
  ├─ Query state clearinghouses (already built)
  ├─ Validate with PostDownloadValidator
  └─ Staging Registry

PHASE 3: Human Review (10-20% manual)
  ├─ Admin reviews pending discoveries weekly
  ├─ Approves/rejects based on confidence + manual spot-check
  └─ Approved entries → known-portals.ts (git commit)

PHASE 4: Quarterly Refresh
  ├─ Re-validate all known URLs (check for 404s, schema changes)
  ├─ Flag broken URLs for manual research
  └─ Update Merkle tree + IPFS + on-chain root
```

### Domain Enumeration Patterns

**Evidence from 26 validated portals**:

```typescript
function generateCandidateDomains(city: string, state: string): string[] {
  const slug = city.toLowerCase().replace(/\s+/g, '');
  const hyphen = city.toLowerCase().replace(/\s+/g, '-');

  return [
    // Socrata (31% of validated)
    `data.${slug}.gov`,
    `${slug}.data.gov`,
    `data.${slug}.org`,
    `opendata.${slug}.gov`,

    // ArcGIS Hub (12% of validated)
    `gis-${slug}.opendata.arcgis.com`,
    `${slug}.opendata.arcgis.com`,
    `data-${slug}.opendata.arcgis.com`,
    `${slug}gis.opendata.arcgis.com`,

    // Municipal GIS (23% of validated)
    `gis.${slug}.gov`,
    `gisdata.${slug}.gov`,
    `maps.${slug}.gov`,
    `${slug}maps.com`,
    `gis-${slug}.opendata.arcgis.com`,

    // Hyphenated variations
    `data.${hyphen}.gov`,
    `gis-${hyphen}.opendata.arcgis.com`,

    // State patterns
    `gis.${state.toLowerCase()}.gov`,
    `data.${state.toLowerCase()}.gov`,

    // Common subdomains
    `opendata.${slug}.gov`,
    `portal.${slug}.gov`,
    `geohub.${slug}.gov`,

    // Alternative TLDs
    `${slug}.gov`,
    `city${slug}.gov`,
  ];
}
```

**Expected hit rate**: 50-60% for Top 100 cities, 30-40% for long tail

---

## Part 6: Implementation Roadmap

### Week 1-2: Census Geocoder Integration

**Deliverables**:
```typescript
// services/census-geocoder.ts
export class CensusGeocoder {
  geocodeSingle(address: string): Promise<LatLng | null>;
  geocodeBatch(addresses: Address[]): Promise<Map<string, LatLng>>;
}

// services/address-cache.ts
export class AddressCache {
  get(address: string): Promise<CachedResult | null>;
  set(address: string, result: BoundaryResolution): Promise<void>;
}
```

**Tests**:
- Geocode 100 known addresses (Seattle, NYC, Chicago)
- Validate lat/lng accuracy (±10m tolerance)
- Measure batch throughput (target: 10k addresses/minute)

**Cost**: $0 (free Census API)

---

### Week 3-4: Staging Registry + Domain Enumeration

**Deliverables**:
```sql
-- db/staging.sql
CREATE TABLE staging_discoveries (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  city_fips TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  geojson_hash TEXT NOT NULL UNIQUE,
  feature_count INTEGER NOT NULL,
  discovered_at DATETIME NOT NULL,
  status TEXT NOT NULL, -- pending | approved | rejected
  reviewed_by TEXT,
  reviewed_at DATETIME
);

CREATE INDEX idx_status ON staging_discoveries(status);
CREATE INDEX idx_city_fips ON staging_discoveries(city_fips);
```

```typescript
// services/domain-enumerator.ts
export class DomainEnumerator {
  async discoverCity(city: CityMetadata): Promise<DiscoveryResult | null> {
    const domains = generateCandidateDomains(city.name, city.state);

    for (const domain of domains) {
      const result = await testDomain(domain, city);
      if (result && result.confidence >= 60) {
        await stagingDB.insert(result);
        return result;
      }
    }

    return null;
  }
}

// scripts/review-discoveries.ts
export async function reviewPendingDiscoveries() {
  const pending = await stagingDB.query(
    'SELECT * FROM staging_discoveries WHERE status = "pending" ORDER BY confidence DESC LIMIT 50'
  );

  for (const entry of pending) {
    const approved = await promptUser(`Approve ${entry.url}? (y/n)`);
    if (approved) {
      await appendToKnownPortals(entry);
      await stagingDB.update({ id: entry.id, status: 'approved' });
    }
  }
}
```

**Tests**:
- Discover Top 100 cities (measure hit rate)
- Validate no duplicates (GeoJSON hash deduplication)
- Human review workflow (admin script)

**Expected outcome**: 50-60 Top 100 cities discovered automatically

---

### Week 5-6: Hierarchical Boundary Resolution

**Deliverables**:
```typescript
// services/boundary-resolver.ts
export class BoundaryResolver {
  /**
   * Resolve address to most granular boundary
   *
   * HIERARCHY:
   * 1. City council district (highest precision)
   * 2. City limits (fallback)
   * 3. County (fallback)
   * 4. State (fallback)
   * 5. Country (last resort)
   */
  async resolveAddress(address: string): Promise<BoundaryResolution> {
    // Step 1: Geocode
    const latLng = await this.geocoder.geocodeSingle(address);
    if (!latLng) return { error: 'GEOCODE_FAILED' };

    // Step 2: Load all boundaries (from Shadow Atlas)
    const boundaries = await this.loadBoundaries();

    // Step 3: Hierarchical PIP test
    const sorted = this.sortByPrecision(boundaries);

    for (const boundary of sorted) {
      if (this.pointInPolygon(latLng, boundary.geometry)) {
        return {
          boundary,
          precision: boundary.type,
          confidence: boundary.provenance.confidence,
          latLng,
        };
      }
    }

    return { error: 'NO_BOUNDARY_MATCH' };
  }

  private pointInPolygon(point: LatLng, polygon: Polygon): boolean {
    // Ray casting algorithm (standard PIP test)
    // ...
  }
}
```

**Tests**:
- Resolve 1,000 known addresses (Seattle, NYC, Chicago)
- Validate correct boundary returned (district > city > county > state)
- Measure cold-start latency (target: <2s)
- Measure cached latency (target: <100ms)

---

### Week 7-8: Merkle Tree Generation

**Deliverables**:
```typescript
// services/merkle-tree-builder.ts
export class MerkleTreeBuilder {
  /**
   * Build Shadow Atlas Merkle tree
   *
   * INPUTS: Political boundaries (from known-portals.ts)
   * OUTPUTS: Merkle root, IPFS CID, proof database
   */
  async buildTree(boundaries: PoliticalBoundary[]): Promise<ShadowAtlasMerkleTree> {
    // Step 1: Sort boundaries deterministically
    const sorted = [...boundaries].sort((a, b) => a.id.localeCompare(b.id));

    // Step 2: Hash each boundary (Poseidon)
    const leaves = sorted.map((b, i) => ({
      id: b.id,
      hash: this.poseidonHash(this.serializeGeoJSON(b.geometry)),
      index: i,
    }));

    // Step 3: Build binary tree
    const tree = this.buildBinaryTree(leaves.map(l => l.hash));
    const root = tree[0][0];

    // Step 4: Compute Merkle proofs
    for (let i = 0; i < leaves.length; i++) {
      leaves[i].proof = this.computeMerkleProof(tree, i);
    }

    // Step 5: Upload to IPFS
    const ipfsCID = await this.uploadToIPFS({
      root,
      leaves,
      metadata: {
        boundaryCount: boundaries.length,
        generatedAt: new Date(),
        version: '1.0.0',
      },
    });

    return { root, leaves, ipfsCID, validFrom: new Date(), validUntil: addMonths(new Date(), 3) };
  }
}
```

**Tests**:
- Build tree from 100 boundaries
- Verify Merkle proofs (all leaves)
- Upload to IPFS (test CID retrieval)
- Verify determinism (same boundaries = same root)

---

## Part 7: Production Deployment

### Infrastructure

**Components**:
```
1. Geocoding Service (Census API wrapper)
   - Language: TypeScript (Node.js)
   - Deployment: AWS Lambda (serverless)
   - Cost: $0 (free tier covers <1M invocations/month)

2. Boundary Resolver (PIP engine)
   - Language: TypeScript + turf.js (geospatial)
   - Deployment: AWS Lambda (serverless)
   - Cost: $5/month (compute for 100k resolutions/month)

3. Shadow Atlas Storage (IPFS + on-chain root)
   - IPFS pinning: Web3.Storage ($5/month for 500 MB)
   - On-chain updates: Scroll L2 ($0.02/quarter)
   - Cost: $5.02/month

4. Address Cache (SQLite)
   - Storage: Local file (ephemeral Lambda storage)
   - Persistence: S3 backup ($0.02/month for 1 GB)
   - Cost: $0.02/month

5. Staging Registry (SQLite)
   - Storage: EC2 instance (t4g.nano, $3/month)
   - Backup: S3 ($0.02/month)
   - Cost: $3.02/month

TOTAL: ~$13/month infrastructure
```

### Quarterly Maintenance

```
1. Re-validate all known URLs (detect 404s, schema changes)
   - Frequency: Quarterly (4x/year)
   - Timeline: 1 day (automated script)
   - Labor: 2 hours (review flagged URLs)

2. Build new Merkle tree (updated boundaries)
   - Frequency: Quarterly
   - Timeline: 1 hour (automated script)
   - Labor: 0 hours (fully automated)

3. Upload to IPFS + update on-chain root
   - Frequency: Quarterly
   - Timeline: 30 min (automated script)
   - Gas cost: $0.02/quarter
   - Labor: 0 hours (fully automated)

4. Human review of pending discoveries
   - Frequency: Weekly
   - Labor: 2 hours/week (admin reviews batch of 50 URLs)
   - Throughput: 200 cities/month approved

TOTAL LABOR: 2.5 hours/week (130 hours/year)
```

---

## Part 8: Success Metrics

### Coverage Targets

**Year 1** (US-only, free geocoding):
```
Top 50 cities:              90% district-level precision
Top 100 cities:             80% district-level precision
Top 500 cities:             60% district-level precision
Remaining 18,500 cities:    City-level precision (fallback)
```

**Year 2** (US completion):
```
All 19,000 cities:          City-level precision minimum
Rural addresses:            County-level precision (acceptable)
```

**Year 3** (Global expansion, requires $2M budget):
```
G20 countries:              City-level precision minimum
190+ countries:             Country-level precision minimum
```

### Performance Benchmarks

```
Geocoding (Census API):
  - Single address:       1s (network latency)
  - Batch (10k):          2-5 min
  - US (150M):            42 hours total

Boundary Resolution:
  - Cold start:           2s (geocode + PIP tests)
  - Cached:               100ms (SQLite lookup)
  - Throughput:           10k addresses/minute (batched)

Merkle Tree Generation:
  - 1,000 boundaries:     10s
  - 10,000 boundaries:    2 min
  - 100,000 boundaries:   30 min

ZK Proof Generation (browser):
  - Proof size:           384-512 bytes
  - Proving time:         8-15s (K=14 circuit)
  - Verification:         300-400k gas on-chain
```

---

## Conclusion

Shadow Atlas achieves district-level precision for US addresses at zero runtime cost (free Census geocoding), with 80-90% autonomous discovery via domain enumeration + state GIS fallback, and quarterly maintenance requiring 2.5 hours/week human review.

**Total operating cost**: $13/month infrastructure + 130 hours/year labor

**Global expansion**: Deferred until $2M budget secured for commercial geocoding.

**Production readiness**: All components specified, ready for implementation.
