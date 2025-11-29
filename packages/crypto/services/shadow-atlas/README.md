# Shadow Atlas

**Hierarchical address resolution to political boundaries for ZK proofs.**

Resolves addresses to the finest-grain political boundary available (city council district → city → county → state → country) with **100% US coverage guaranteed**.

## Status

| Phase | Component | Status |
|-------|-----------|--------|
| 1 | Census Geocoder | ✅ Complete (free US geocoding) |
| 2 | Hierarchical Resolution | ✅ Complete (PIP engine, caching) |
| 3 | Boundary Discovery | ✅ Phase 1 Complete (4,163 districts from 31,316 layers) |
| 4 | Merkle Tree | ✅ Complete (Poseidon WASM bindings) |

**Phase 1 Discovery Complete (2025-11-25)**: Enumerated 31,316 layers from 7,194 ArcGIS services, classified 4,163 elected governance districts (3,282 city councils, 246 state legislative, 230 school boards, 188 congressional, 159 county commissions, 70 special districts). See agents/DISCOVERY_STRATEGY.md for complete results and agents/PHASE2_ROADMAP.md for next steps.

## US Coverage Guarantee

```
┌─────────────────────────────────────────────────────────────────┐
│  Tier 0: City Council Districts (8,000-15,000 nationwide)       │ ← OPTIMAL
│  Sources: Municipal portals (35 cities), State GIS (18 states)  │
├─────────────────────────────────────────────────────────────────┤
│  Tier 1: Incorporated Cities (19,495 places)                    │ ← Census TIGER
│  Tier 2: CDPs - Unincorporated Communities (~9,000)             │ ← Census TIGER
├─────────────────────────────────────────────────────────────────┤
│  Tier 3: Counties (3,143) - UNIVERSAL FALLBACK                  │ ← Census TIGER
├─────────────────────────────────────────────────────────────────┤
│  Parallel: Congressional Districts (435)                         │ ← Census TIGER
└─────────────────────────────────────────────────────────────────┘
```

**Every US address resolves to at least a county. No failures possible.**

## Quick Start

```bash
cd packages/crypto

# Run all Shadow Atlas tests (57 tests)
npm test -- services/shadow-atlas --run
```

## Architecture

```
Address → Geocode → Point-in-Polygon → Boundary Resolution → Merkle Proof
         (Census)   (ray-casting)      (hierarchical)        (Poseidon)
```

**Precision hierarchy** (finest wins):
```
CITY_COUNCIL_DISTRICT (rank 0) ← what we want
CITY_COUNCIL_WARD     (rank 1)
CITY_LIMITS           (rank 2)
COUNTY                (rank 3)
STATE_PROVINCE        (rank 4)
COUNTRY               (rank 5) ← fallback
```

## Directory Structure

```
shadow-atlas/
├── services/
│   ├── census-geocoder.ts      # FREE US geocoding (Census Bureau API)
│   ├── pip-engine.ts           # Ray-casting point-in-polygon
│   ├── boundary-resolver.ts    # Address → boundary orchestration
│   ├── boundary-loader.ts      # GeoJSON loader from registry
│   ├── coverage-analyzer.ts    # Registry coverage metrics
│   ├── freshness-tracker.ts    # URL health monitoring
│   └── *.test.ts               # Comprehensive test suites
├── registry/
│   ├── known-portals.ts        # 35+ validated portal URLs
│   ├── district-count-registry.ts  # Expected district counts
│   ├── state-gis-portals.ts    # State clearinghouse URLs
│   └── governance-structures.ts # City governance metadata
├── types/
│   ├── boundary.ts             # BoundaryType, BoundaryGeometry, etc.
│   └── provider.ts             # BoundaryProvider interface
├── validation/                 # 5-stage validation pipeline
└── merkle-tree.ts              # Poseidon Merkle tree (Phase 4)
```

## Core APIs

### Geocoding (Phase 1)

```typescript
import { CensusGeocoder } from './services/census-geocoder.js';

const geocoder = new CensusGeocoder();

// Single address (1 req/s rate limit)
const result = await geocoder.geocode({
  street: '1600 Pennsylvania Ave NW',
  city: 'Washington',
  state: 'DC',
  zip: '20500'
});
// → { lat: 38.8977, lng: -77.0365, confidence: 95 }

// Batch (10k addresses, no rate limit)
const results = await geocoder.geocodeBatch(addresses);
```

### Boundary Resolution (Phase 2)

```typescript
import { BoundaryResolver } from './services/boundary-resolver.js';
import { BoundaryLoader } from './services/boundary-loader.js';

const loader = new BoundaryLoader();
const resolver = new BoundaryResolver(geocoder, loader);

// Full resolution (geocode + PIP + cache)
const result = await resolver.resolve({
  street: '600 4th Ave',
  city: 'Seattle',
  state: 'WA'
});
// → { finest: { type: 'city_council_district', name: 'District 7' }, ... }

// Direct coordinate resolution
const boundaries = await resolver.resolveCoordinates({ lat: 47.6, lng: -122.33 });
```

### Point-in-Polygon Engine

```typescript
import { PointInPolygonEngine } from './services/pip-engine.js';

const pip = new PointInPolygonEngine();

// Test single polygon
const inside = pip.isPointInPolygon(
  { lat: 47.6, lng: -122.33 },
  geoJsonPolygon
);

// Find all containing boundaries (sorted by precision)
const matches = pip.findContainingBoundaries(point, boundaries);
```

## Performance

| Operation | Latency | Notes |
|-----------|---------|-------|
| Geocode (single) | 1-2s | Census API network latency |
| Geocode (batch 10k) | 2-5 min | Census batch API |
| PIP test | <1ms | Ray-casting with bbox pre-filter |
| Resolution (cached) | <100ms | 1-year TTL |
| Resolution (cold) | 2-3s | Geocode + load + PIP |

## Validation Pipeline

5-stage validation ensures data quality:

1. **Post-Download**: Type validation, feature count, geometry analysis
2. **Semantic**: Title scoring, negative keyword filtering
3. **Geographic**: State bounding box, FIPS validation
4. **Normalization**: CRS transformation, topology repair
5. **District Count**: Compare to known registry

Confidence routing: `0-59: reject`, `60-84: review`, `85-100: accept`

## Cost

**US (Phase 1)**: $0
- Census Geocoder: Free, unlimited batch
- IPFS: ~$5/month (quarterly snapshots)
- On-chain: ~$0.02/quarter (Merkle root only)

**Global (Phase 2+)**: TBD
- Commercial geocoding required (~$0.002-0.005/address)

## Specifications

- [SHADOW-ATLAS-TECHNICAL-SPEC.md](SHADOW-ATLAS-TECHNICAL-SPEC.md) - IEEE-style technical specification
- [PROVENANCE-SPEC.md](PROVENANCE-SPEC.md) - Provenance tracking architecture

## Bulk Discovery CLI

Discover council district boundaries for ALL US cities:

```bash
# Discover all incorporated places (~19,500 cities)
npx tsx scripts/discover-all-cities.ts --tier major

# Discover specific state
npx tsx scripts/discover-all-cities.ts --state TX

# Dry run (show cities without API calls)
npx tsx scripts/discover-all-cities.ts --tier major --dry-run

# Limit for testing
npx tsx scripts/discover-all-cities.ts --tier major --limit 10
```

**Output**: Results written to `data/discovery-results-*.json` with new KnownPortal entries.

## Tests

```bash
# All 57 tests
npm test -- services/shadow-atlas --run

# Specific service
npm test -- services/shadow-atlas/services/pip-engine --run

# Integration tests (requires network)
npm test -- services/shadow-atlas/services/census-geocoder.integration --run
```
