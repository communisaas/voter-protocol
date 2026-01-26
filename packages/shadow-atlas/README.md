# Shadow Atlas

**Geospatial voting district registry with Merkle tree proofs for VOTER Protocol**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-2757%20passing-brightgreen.svg)]()

Shadow Atlas provides cryptographic proofs of voting district membership for zero-knowledge voter eligibility verification. It ingests geospatial data from TIGER/Census and municipal sources, constructs Merkle trees using Poseidon2 hashing, and generates ZK-SNARKs for privacy-preserving location attestation.

---

## Features

- **Multi-layer Merkle Trees**: VTD, council district, state legislative, congressional boundaries
- **ZK Proof Generation**: UltraHonk proofs for district membership (browser-native WASM)
- **TIGER Pipeline**: Automated ingestion from Census shapefiles with change detection
- **Municipal Portal Registry**: 250+ city council district sources (GIS portals, GeoJSON, ArcGIS)
- **Production API**: Rate-limited REST API with snapshot versioning and IPFS distribution
- **Global Scale**: Architecture supports 190+ countries via international provider system

---

## Installation

```bash
npm install @voter-protocol/shadow-atlas
```

### Peer Dependencies

```bash
npm install @voter-protocol/crypto @aztec/bb.js @noir-lang/noir_js
```

### Environment Setup

```bash
cp .env.example .env
```

Required variables:
```env
# Database
DB_PATH=/data/shadow-atlas.db

# IPFS Distribution
IPFS_GATEWAY=https://w3s.link

# Server (if running API)
PORT=3000
HOST=0.0.0.0
```

---

## Quick Start

### 1. Build Merkle Tree from TIGER Data

```typescript
import { ShadowAtlasService, createConfig } from '@voter-protocol/shadow-atlas';

const config = createConfig({ dbPath: './shadow-atlas.db' });
const service = new ShadowAtlasService(config);

// Build atlas for a state
const result = await service.buildAtlas({
  state: 'CO',
  year: 2024,
  layers: ['vtd', 'sldu', 'sldl', 'cd'],
  validate: true,
});

console.log('Merkle Root:', result.merkleTree.root);
console.log('Districts:', result.manifest.totalDistricts);
```

### 2. Generate District Proof

```typescript
import { MultiLayerMerkleTreeBuilder } from '@voter-protocol/shadow-atlas';

const builder = new MultiLayerMerkleTreeBuilder();
const tree = await builder.build([
  {
    id: 'vtd-001',
    geoid: '08001234567',
    authorityLevel: 1, // VTD
    geometry: { /* GeoJSON MultiPolygon */ },
    metadata: { name: 'Denver Precinct 123', fips: '08001' },
  },
  // ... more districts
]);

// Get proof for a specific district
const proof = tree.getProof('vtd-001');
console.log('Merkle Path:', proof.path);
console.log('Siblings:', proof.siblings);
```

### 3. Run Discovery Agent (Municipal Portals)

```bash
# Discover top 100 US cities by population
npm run discover:top100

# Discover all cities in a state
npm run discover:state -- --state=CA

# Batch discovery with staging
npm run discover:staging
```

### 4. Start Production API

```typescript
import { startServer } from '@voter-protocol/shadow-atlas/serving';

const server = await startServer({
  port: 3000,
  host: '0.0.0.0',
  dbPath: './shadow-atlas.db',
  rateLimit: { windowMs: 60000, maxRequests: 60 },
});

// Endpoints:
// GET /v1/lookup?lat=39.7392&lng=-104.9903
// GET /v1/districts/:id
// GET /v1/health
```

---

## Directory Structure

```
packages/shadow-atlas/
├── src/
│   ├── core/              # Service facade, config, Merkle tree builders
│   ├── acquisition/       # TIGER ingestion, change detection, HTTP clients
│   ├── providers/         # Municipal GIS portals, special districts
│   ├── services/          # Discovery agent, coverage analyzer, retry logic
│   ├── provenance/        # NDJSON logging, portal validation
│   ├── serving/           # REST API, proof generation, health checks
│   ├── distribution/      # IPFS snapshots, SDK client
│   ├── transformation/    # Geometry normalization, FIPS validation
│   ├── validators/        # Cross-validation, school district checks
│   ├── persistence/       # SQLite schema, query builders
│   ├── observability/     # Metrics, logging, distributed tracing
│   ├── security/          # Rate limiting, input sanitization
│   └── resilience/        # Circuit breakers, retry policies
├── scripts/               # CLI tools for analysis and maintenance
├── docs/                  # Architecture, API specs, migration guides
├── data/                  # Canonical NDJSON registries (known portals, quarantines)
├── provenance/            # Discovery logs by year/month
└── schemas/               # JSON schemas for validation
```

---

## Key Scripts

### Testing
```bash
npm run test              # Run all tests (vitest watch mode)
npm run test:unit         # Unit tests only
npm run test:integration  # Integration tests (requires DB)
npm run test:e2e          # End-to-end TIGER pipeline
npm run test:coverage     # Generate coverage report
```

### Discovery & Data Collection
```bash
npm run discover:batch    # Batch discovery with configurable strategy
npm run discover:top100   # Top 100 US cities by population
npm run discover:state    # All cities in a state (e.g., --state=TX)
npm run dashboard         # Coverage dashboard (gaps, stale data)
npm run retry:worker      # Retry failed discoveries with exponential backoff
```

### Validation & Auditing
```bash
npm run validate:registry # Validate KNOWN_PORTALS against live endpoints
npm run validate:geoids   # Cross-validate TIGER GEOID formats
npm run validate:tiger    # Validate TIGER shapefile integrity
npm run audit:freshness   # Flag stale portal data (>90 days)
```

### Registry Management
```bash
npm run registry:extract  # Export TypeScript registries to NDJSON
npm run registry:generate # Generate TypeScript from canonical NDJSON
npm run registry:roundtrip # Full export → generate → verify cycle
npm run registry:ci-check # CI check for uncommitted registry changes
```

### Reporting
```bash
npm run report:comprehensive      # Full coverage, validation, and performance report
npm run report:comprehensive:json # JSON output for CI integration
npm run analyze:batch-results     # Analyze discovery success/failure rates
```

---

## API Overview

### District Lookup
```
GET /v1/lookup?lat={latitude}&lng={longitude}
```
Returns district ID, Merkle proof, and boundary metadata.

### Direct District Query
```
GET /v1/districts/{geoid}
```
Fetch proof by GEOID or district ID.

### Health Metrics
```
GET /v1/health
```
Response time percentiles, cache hit rates, database status.

### Snapshots
```
GET /v1/snapshot          # Current snapshot metadata
GET /v1/snapshots         # List all available snapshots
```

See [API_SPECIFICATION.md](docs/API_SPECIFICATION.md) for full OpenAPI schema.

---

## Documentation

### Architecture
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - 8-tier system design, 41 modules
- [PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) - Deployment status
- [DATABASE-ARCHITECTURE-DECISIONS.md](docs/DATABASE-ARCHITECTURE-DECISIONS.md) - SQLite vs PostgreSQL/PostGIS

### Integration Guides
- [at-large-cities-guide.md](docs/at-large-cities-guide.md) - At-large city classification
- [STATIC-GEOJSON-PORTAL-DESIGN.md](docs/STATIC-GEOJSON-PORTAL-DESIGN.md) - Static file portals
- [WEBMAP-EXTRACTOR-QUICKSTART.md](WEBMAP-EXTRACTOR-QUICKSTART.md) - Web map scraping

### Operations
- [ROADMAP.md](docs/ROADMAP.md) - Development roadmap
- [CONFIGURATION.md](docs/CONFIGURATION.md) - Environment variables and config schema
- [POSTGIS-MIGRATION-PLAN.md](docs/DATABASE-MIGRATION-PLAN.md) - Future PostGIS migration

---

## Testing Strategy

| Test Type | Count | Purpose |
|-----------|-------|---------|
| Unit | 1800+ | Core logic, Merkle tree, geometry utils |
| Integration | 500+ | Database, API endpoints, provider contracts |
| E2E | 200+ | Full TIGER pipeline, discovery workflows |
| Performance | 257+ | Rate limiting, bulk ingestion, proof generation |

Run nightly suite: `npm run test:nightly`

---

## Contributing

### Registry Contributions

The most valuable contributions are **new municipal portal entries**. We need 250+ cities for comprehensive US coverage.

1. Research city GIS portal (ArcGIS, GeoJSON, Esri REST)
2. Add entry to `data/known-portals.ndjson`:
   ```json
   {
     "fips": "48201",
     "cityName": "Austin",
     "state": "TX",
     "portalType": "arcgis-rest",
     "downloadUrl": "https://services.arcgis.com/.../FeatureServer/0",
     "discoveredBy": "human",
     "validatedAt": "2026-01-23T00:00:00Z"
   }
   ```
3. Regenerate TypeScript: `npm run registry:generate`
4. Validate: `npm run validate:registry`
5. Submit PR with provenance log

### Code Contributions

1. Fork repo and create feature branch
2. Follow TypeScript strict mode (`tsconfig.base.json`)
3. Add tests (maintain >85% coverage)
4. Run `npm run test:unit` before committing
5. Follow commit convention: `feat(module): description`

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for full guidelines.

---

## License

MIT License - See [LICENSE](../../LICENSE) for details.

---

## Links

- **Documentation**: [docs/](docs/)
- **Issue Tracker**: [GitHub Issues](https://github.com/voter-protocol/voter-protocol/issues)
- **VOTER Protocol**: [Main Repository](https://github.com/voter-protocol/voter-protocol)
- **Crypto Package**: [@voter-protocol/crypto](../crypto/)

---

**Status**: Production-ready (95% complete). API, crypto, and test suite operational. Deployment infrastructure pending (Docker, Fly.io).
