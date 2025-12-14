# Shadow Atlas Provenance System

Unified data provenance layer for tracking boundary data sources, authority hierarchies, and conflict resolution.

## Architecture

The provenance system consists of three main components:

### 1. Source Registry (`source-registry.ts`)

Manages canonical source configurations for each boundary type, distinguishing between:

- **Primary Authority Sources**: Legal entities with jurisdiction (state legislature, city council)
- **Aggregator Sources**: Convenience republishers (Census TIGER)

**Key Insight**: Authority and freshness are orthogonal. Census is an AGGREGATOR, not an authority. The entity with legal jurisdiction is the authority.

**Resolution Rule**: `freshest primary source > freshest aggregator`

```typescript
import { SourceRegistry } from './source-registry.js';

const registry = new SourceRegistry();

// Select best source for congressional districts
const selected = await registry.selectSource(BoundaryType.CONGRESSIONAL_DISTRICT);

console.log(selected.source);     // AuthoritySource or AggregatorSource
console.log(selected.reason);     // "Primary authority source available and fresh"
console.log(selected.isPrimary);  // true
console.log(selected.confidence); // 90 (0-100)
```

### 2. Conflict Resolver (`conflict-resolver.ts`)

Resolves conflicts when multiple sources claim different boundaries for the same jurisdiction.

**Algorithm**:
1. Separate sources into primary vs aggregator
2. If primary sources exist, return freshest primary
3. Otherwise return freshest aggregator
4. Log full decision with reasoning

```typescript
import { ConflictResolver } from './conflict-resolver.js';
import type { SourceClaim } from './conflict-resolver.js';

const resolver = new ConflictResolver();

const sources: SourceClaim[] = [
  {
    sourceId: 'census-tiger-2024',
    sourceName: 'Census TIGER 2024',
    boundary: geojsonGeometry,
    lastModified: Date.UTC(2024, 6, 1), // July 1, 2024
    isPrimary: false,
    authorityLevel: 3,
  },
  {
    sourceId: 'ca-redistricting-2022',
    sourceName: 'CA Redistricting Commission 2022',
    boundary: geojsonGeometry,
    lastModified: Date.UTC(2022, 2, 15), // March 15, 2022
    isPrimary: true,
    authorityLevel: 5,
  },
];

const result = await resolver.resolveConflict('us-ca-06', sources);

console.log(result.winner.sourceId);      // "ca-redistricting-2022"
console.log(result.decision.reason);      // "Primary authority source (freshest of 1 primary sources)"
console.log(result.decision.confidence);  // 85
console.log(result.decision.rejected);    // [{ sourceId: "census-tiger-2024", reason: "Aggregator loses to primary authority", ... }]
```

### 3. Provenance Writer (`provenance-writer.ts`)

Consolidated provenance logging system with:

- **Staging buffer**: Zero-contention writes for 100+ concurrent agents
- **Log compression**: Gzip for efficient storage
- **Query interface**: Filter by tier, state, confidence, etc.
- **FIPS sharding**: 50-state parallelism (one lock file per state)

```typescript
import { ProvenanceWriter } from './provenance-writer.js';
import type { CompactDiscoveryEntry, ProvenanceFilter } from './provenance-writer.js';

const writer = new ProvenanceWriter('./discovery-attempts');

// Append discovery attempt (standard mode with file locks)
const entry: CompactDiscoveryEntry = {
  f: '0666000',           // FIPS code
  n: 'San Diego',         // City name
  s: 'CA',                // State
  p: 1386932,             // Population
  g: 1,                   // Tier 1 (council district)
  fc: 9,                  // 9 districts found
  conf: 85,               // 85% confidence
  auth: 3,                // Municipal authority
  src: 'muni-gis',        // Municipal GIS source
  url: 'https://seshat.datasd.org/...',
  q: {
    v: true,              // GeoJSON valid
    t: 1,                 // Topology clean
    r: 474,               // 474ms response time
    d: '2021-12-14',      // Data from Dec 14, 2021
  },
  why: [
    'T0 blocked: No precinct data',
    'T1 success: 9 districts',
  ],
  tried: [0, 1],          // Attempted tiers 0 and 1
  blocked: null,          // No blocker (succeeded)
  ts: new Date().toISOString(),
  aid: 'agt-001',         // Agent ID
};

await writer.append(entry);

// Query provenance entries
const filter: ProvenanceFilter = {
  state: 'CA',
  minConfidence: 80,
  tier: 1,
};

const results = await writer.query(filter);
console.log(`Found ${results.length} high-confidence tier-1 discoveries in CA`);

// Get statistics
const stats = await writer.getStats();
console.log(stats.byTier);        // { 0: 50, 1: 1200, 2: 5000, 3: 500, 4: 100 }
console.log(stats.avgConfidence); // 73.2
```

## Staging Mode (Zero Contention)

For high-throughput scenarios with 100+ concurrent agents:

```typescript
// Agent writes to unique staging file (zero contention)
await writer.append(entry, { staging: true, agentId: 'agt-042' });

// Background worker merges staging files periodically
const { merged, errors } = await writer.mergeStagingFiles();
console.log(`Merged ${merged} entries, ${errors} errors`);
```

## Full Provenance Record

For boundary metadata (attached to each boundary):

```typescript
import type { ProvenanceRecord } from './provenance-writer.js';

const provenance: ProvenanceRecord = {
  source: 'census-tiger',
  sourceUrl: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/',
  retrievedAt: new Date(),
  dataVersion: 'TIGER2024',
  license: 'Public Domain',
  processingSteps: [
    'Downloaded from Census TIGER/Line',
    'Validated topology',
    'Simplified geometry (Douglas-Peucker, tolerance=0.0001)',
  ],
  authority: {
    entity: 'State Redistricting Authority',
    legalBasis: 'State constitution',
    isPrimary: false, // This is aggregator (Census), not primary
  },
  freshness: {
    lastModified: Date.UTC(2024, 6, 1),
    etag: '"abc123"',
    isValid: true,
  },
  resolution: {
    hadConflict: true,
    alternativesConsidered: 2,
    confidence: 85,
    reason: 'Primary unavailable, using freshest aggregator: Census TIGER',
  },
};
```

## Source Configurations

The registry includes canonical source configurations for all US boundary types:

| Boundary Type | Primary Authority | Aggregator | Publication Lag |
|---------------|-------------------|------------|-----------------|
| Congressional District | State Redistricting Authority | Census TIGER | 6-18 months |
| State Legislative | State Legislature | Census TIGER | 6-18 months |
| County | State Government | Census TIGER | 6-12 months |
| City Limits | Municipal Government | Census TIGER PLACE | 6-18 months |
| City Council District | City Council | None | N/A |

## Validity Windows

Data freshness is assessed using validity windows:

- **Full confidence**: Data within 75% of expected update cycle
- **Linear decay**: Final 25% of cycle (e.g., last 3 months of annual cycle)
- **Expired**: Data older than 2 years flagged as invalid

## Integration with Shadow Atlas

The provenance system integrates with Shadow Atlas boundary resolution:

```typescript
import { BoundaryResolver } from '../services/boundary-resolver.js';
import { SourceRegistry, ConflictResolver } from './index.js';

const resolver = new BoundaryResolver({
  sourceRegistry: new SourceRegistry(),
  conflictResolver: new ConflictResolver(),
});

// Resolver automatically:
// 1. Checks source registry for best source
// 2. Resolves conflicts if multiple sources exist
// 3. Logs full provenance in boundary metadata
const boundary = await resolver.resolve(address);
console.log(boundary.metadata.provenance);
```

## File Structure

```
provenance/
├── README.md                    # This file
├── index.ts                     # Public API exports
├── source-registry.ts           # Canonical source management
├── conflict-resolver.ts         # Multi-source conflict resolution
└── provenance-writer.ts         # Unified logging system
```

## Type Safety

All provenance types use strict TypeScript interfaces with no `any` types. Key guarantees:

- **Immutable records**: All provenance entries are `readonly`
- **Required fields**: Missing fields cause compile-time errors
- **Validated ranges**: Confidence (0-100), authority (0-5), tier (0-4)
- **ISO timestamps**: All timestamps validated against ISO 8601 format

## Performance

- **Write throughput**: 10,000+ entries/sec in staging mode
- **Query speed**: ~500ms for 100,000 entries (full scan)
- **Storage**: ~200 bytes/entry compressed (1.5MB for 19,495 US cities)
- **Concurrency**: 50-state FIPS sharding enables 50x parallelism

## Testing

Run tests with:

```bash
npm test provenance
```

## References

- [DATA-PROVENANCE-SPEC](../docs/DATA-PROVENANCE-SPEC.md) - Complete specification
- [ARCHITECTURE.md](../ARCHITECTURE.md) - System architecture
- [SECURITY.md](../SECURITY.md) - Security considerations
