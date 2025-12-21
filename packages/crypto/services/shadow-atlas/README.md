# Shadow Atlas

**Hierarchical address resolution to political boundaries for zero-knowledge proofs.**

Resolves addresses to the finest-grain political boundary available (city council district → city → county → state → country) with **100% US coverage guaranteed**.

---

## Current Status

**100% Accuracy**: 149/149 validation tests passing against Census TIGER ground truth.

| Component | Coverage | Status |
|-----------|----------|--------|
| **US States** | 50/50 | ✅ Complete |
| **TIGER Validation** | 149/149 tests | ✅ 100% accurate |
| **Discovery** | 4,163 districts from 31,316 layers | ✅ Phase 1 complete |
| **Merkle Tree** | Poseidon WASM bindings | ✅ Production-ready |

---

## Architecture Overview

Shadow Atlas implements a three-layer pipeline for geospatial data acquisition, transformation, and serving:

```
┌──────────────────────────────────────────────────────────────────┐
│  LAYER 1: ACQUISITION                                            │
│  Scrape authoritative sources → Raw GeoJSON + provenance         │
│  └─→ acquisition/README.md                                       │
└──────────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────────┐
│  LAYER 2: PERSISTENCE                                            │
│  Job orchestration + boundary extraction tracking                │
│  └─→ persistence/README.md                                       │
└──────────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────────┐
│  LAYER 3: SERVING                                                │
│  R-tree indexed lookups + Merkle proof generation (<50ms)        │
│  └─→ serving/README.md                                           │
└──────────────────────────────────────────────────────────────────┘
```

**Complete technical specification**: [SHADOW-ATLAS-TECHNICAL-SPEC.md](SHADOW-ATLAS-TECHNICAL-SPEC.md)

---

## Quick Start

### Installation

```bash
cd packages/crypto
npm install
```

### Run Tests (57 tests)

```bash
# All Shadow Atlas tests
npm test -- services/shadow-atlas --run

# Specific service
npm test -- services/shadow-atlas/services/pip-engine --run

# Integration tests (requires network)
npm test -- services/shadow-atlas/services/census-geocoder.integration --run
```

### Basic Usage

```typescript
import { createShadowAtlasService } from './core';

const atlas = createShadowAtlasService();

// Extract all legislative boundaries for Wisconsin
const result = await atlas.extract({
  type: 'state',
  states: ['WI'],
});

console.log(`Status: ${result.status}`);
console.log(`Merkle root: ${result.commitment?.merkleRoot}`);
```

**Complete API reference**: [core/README.md](core/README.md)

---

## Directory Structure

```
shadow-atlas/
├── README.md                    # This file (entry point)
├── CONFIGURATION.md             # Unified configuration reference
├── SHADOW-ATLAS-TECHNICAL-SPEC.md  # IEEE-style technical spec
│
├── core/                        # Unified facade API
│   ├── README.md                # ShadowAtlasService documentation
│   ├── shadow-atlas-service.ts  # Main service implementation
│   ├── factory.ts               # Dependency injection
│   ├── config.ts                # Configuration types
│   └── types.ts                 # Core type definitions
│
├── acquisition/                 # Layer 1: Scraping
│   ├── README.md                # Acquisition architecture
│   ├── pipelines/               # ArcGIS Portal, State GIS, OSM scrapers
│   └── post-download-validator.ts  # Acquisition validation
│
├── persistence/                 # Layer 2: Job orchestration
│   ├── README.md                # Database schema documentation
│   ├── schema.sql               # SQLite/PostgreSQL schema
│   └── schema.types.ts          # Type-safe database interfaces
│
├── serving/                     # Layer 3: API + lookups
│   ├── README.md                # API documentation
│   ├── api.ts                   # HTTP API server
│   ├── district-service.ts      # R-tree indexed lookups
│   └── proof-generator.ts       # Merkle proof generation
│
├── integration/                 # Cross-layer integration
│   ├── README.md                # Integration architecture
│   ├── state-batch-to-merkle.ts # StateBatchExtractor → Merkle tree
│   └── DATAFLOW.md              # End-to-end data flow diagram
│
├── provenance/                  # Authority resolution
│   ├── README.md                # Provenance system documentation
│   ├── authority-resolver.ts    # Source precedence rules
│   ├── tiger-validity.ts        # TIGER freshness tracking
│   └── tiger-authority-rules.ts # TIGER vs state source precedence
│
├── providers/                   # Data extraction
│   ├── state-batch-extractor.ts # State GIS portal extractor
│   ├── cross-validation.ts      # TIGER validation
│   └── international/           # Global providers (future)
│
├── services/                    # Core services
│   ├── census-geocoder.ts       # FREE US geocoding (Census API)
│   ├── pip-engine.ts            # Ray-casting point-in-polygon
│   ├── boundary-resolver.ts     # Address → boundary orchestration
│   └── *.test.ts                # Comprehensive test suites
│
├── registry/                    # Known data sources
│   ├── state-gis-portals.ts     # 50-state GIS portal registry
│   ├── known-portals.ts         # 35+ validated municipal URLs
│   └── official-district-counts.ts  # Expected counts for validation
│
├── scripts/                     # Archived - see services/ for current implementations
│   ├── archived/                # Migrated scripts (deprecated)
│   ├── health-check-ci.ts       # CI health check (active)
│   └── README.md                # Migration guide
│
├── cli/                         # Command-line tools
│   ├── build-atlas.ts           # Shadow Atlas builder
│   ├── validate-tiger.ts        # TIGER data validation
│   └── README.md                # CLI documentation
│
└── __tests__/                   # Test infrastructure
    ├── README.md                # Testing guide
    ├── integration/             # Integration tests
    ├── e2e/                     # End-to-end tests
    └── fixtures/                # Test data
```

---

## Common Operations

> **Note:** Scripts have been migrated to services. See `services/batch-orchestrator.ts` and `services/data-validator.ts` for current implementations. The `scripts/` directory contains archived scripts for reference only.

### Extract Boundaries for a State

**Using BatchOrchestrator service:**

```typescript
import { BatchOrchestrator } from './services/batch-orchestrator.js';

const orchestrator = new BatchOrchestrator();

// Extract single state
const result = await orchestrator.extractStates(['WI'], {
  concurrency: 5,
  retryAttempts: 3,
  generateReport: true,
});

console.log(`Extracted ${result.statistics.totalBoundaries} boundaries`);
console.log(`Report saved to: extraction-report.json`);
```

### Validate Against TIGER Ground Truth

**Using DataValidator service:**

```typescript
import { DataValidator } from './services/data-validator.js';

const validator = new DataValidator();

// Validate extraction against official registry
const validation = await validator.validateAgainstRegistry(extraction);

if (!validation.passed) {
  console.error(`${validation.mismatchedStates} states have count mismatches`);
  validation.mismatches.forEach(m => {
    console.log(`${m.state} ${m.layer}: expected ${m.expected}, got ${m.actual}`);
  });
}

// Generate multi-state validation report
const report = await validator.generateMultiStateReport(
  ['WI', 'TX', 'CA'],
  { format: 'json', includeGeometry: false }
);
console.log(`Report saved to: multi-state-validation-report.json`);
```

### Health Check (CI)

```bash
npx tsx scripts/health-check-ci.ts
```

**Checks**:
- Registry configuration completeness
- Data provider availability
- Database schema validity
- Merkle tree integrity

---

## Performance Targets

| Operation | Latency | Notes |
|-----------|---------|-------|
| **Geocode (single)** | 1-2s | Census API network latency |
| **Geocode (batch 10k)** | 2-5 min | Census batch API |
| **PIP test** | <1ms | Ray-casting with bbox pre-filter |
| **Resolution (cached)** | <100ms | 1-year TTL |
| **Resolution (cold)** | 2-3s | Geocode + load + PIP |
| **API lookup (p95)** | <50ms | R-tree indexed (production) |

---

## Data Pipeline Flow

### 1. Acquisition → Extraction

**See**: [acquisition/README.md](acquisition/README.md)

- Scrape ArcGIS Portal, State GIS, OpenStreetMap
- Stage 1 validation (post-download confidence scoring)
- Provenance metadata tracking
- Output: Raw GeoJSON + source metadata

### 2. Extraction → Persistence

**See**: [persistence/README.md](persistence/README.md)

- Job orchestration (pending → running → completed)
- Extraction tracking (state, layer type, boundary count)
- Failure retry with exponential backoff
- Output: SQLite/PostgreSQL database

### 3. Persistence → Integration

**See**: [integration/README.md](integration/README.md)

- Authority resolution (TIGER vs state sources)
- Deduplication (same GEOID from multiple sources)
- Merkle tree construction (Poseidon hash)
- Output: Cryptographic commitment

### 4. Integration → Serving

**See**: [serving/README.md](serving/README.md)

- R-tree spatial index for point-in-polygon
- LRU cache (10k entries, 1-hour TTL)
- Merkle proof generation (<10ms)
- Output: HTTP API + Prometheus metrics

### 5. Provenance Tracking (Cross-Cutting)

**See**: [provenance/README.md](provenance/README.md)

- Source registry (primary authority vs aggregator)
- Conflict resolution (freshest primary source wins)
- Validity tracking (2-year expiration for TIGER)
- Output: Complete audit trail

---

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

---

## Configuration

**Complete configuration reference**: [CONFIGURATION.md](CONFIGURATION.md)

### Quick Config (Development)

```typescript
import { createDevelopmentService } from './core';

const atlas = await createDevelopmentService();
// Lower concurrency, relaxed validation, local IPFS
```

### Production Config

```typescript
import { createProductionService } from './core';

const atlas = await createProductionService();
// Higher concurrency, stricter validation, IPFS pinning
```

**Environment variables**: See [CONFIGURATION.md](CONFIGURATION.md#environment-variables)

---

## Specifications & Documentation

### Core Technical Docs

- **[SHADOW-ATLAS-TECHNICAL-SPEC.md](SHADOW-ATLAS-TECHNICAL-SPEC.md)** - IEEE-style technical specification
- **[PROVENANCE-SPEC.md](PROVENANCE-SPEC.md)** - Provenance tracking architecture
- **[CONFIGURATION.md](CONFIGURATION.md)** - Unified configuration reference

### Public API & Infrastructure

- **[PUBLIC-API-SPEC.md](PUBLIC-API-SPEC.md)** - Free public API architecture (Cloudflare Workers + R2)
- **[STORACHA_INTEGRATION_GUIDE.md](STORACHA_INTEGRATION_GUIDE.md)** - IPFS pinning via Storacha
- **[STORACHA_IMPLEMENTATION_SUMMARY.md](STORACHA_IMPLEMENTATION_SUMMARY.md)** - Quick reference

### Production Operations

- **[docs/OPERATIONAL-RUNBOOKS.md](docs/OPERATIONAL-RUNBOOKS.md)** - 7 production recovery runbooks
- **[docs/QUARTERLY-AUTOMATION.md](docs/QUARTERLY-AUTOMATION.md)** - GitHub Actions workflow
- **[docs/FAILURE-RESOLUTION-PLAYBOOK.md](docs/FAILURE-RESOLUTION-PLAYBOOK.md)** - Discovery failure patterns

### Validation & Testing

- **[scripts/README-TIGER-VALIDATION.md](scripts/README-TIGER-VALIDATION.md)** - TIGER validation methodology
- **[TIGER_VALIDATION_SUMMARY.md](TIGER_VALIDATION_SUMMARY.md)** - 100% accuracy results
- **[__tests__/README.md](__tests__/README.md)** - Testing infrastructure guide

---

## Cost Architecture

**Phase 1 (US-only, free Census API)**: $0 runtime cost

- Census Geocoder: Free, unlimited batch
- IPFS: ~$5/month (quarterly snapshots)
- On-chain: ~$0.02/quarter (Merkle root only)

**Phase 2 (Global expansion)**: Commercial geocoding required (~$0.002-0.005/address)

**Infrastructure**: ~$13/month (see [SHADOW-ATLAS-TECHNICAL-SPEC.md](SHADOW-ATLAS-TECHNICAL-SPEC.md#part-7-production-deployment))

---

## Development

### Type Safety (Zero Tolerance)

All code follows nuclear-level TypeScript strictness:

- ✅ NO `any` types
- ✅ Explicit types for ALL function parameters and returns
- ✅ Comprehensive interfaces for ALL data structures
- ✅ Type guards for ALL runtime validation
- ✅ Readonly types prevent accidental mutation

**Enforcement**: Pre-commit hooks reject ANY violations.

### Testing Standards

```bash
# Unit tests
npm test services/shadow-atlas

# Integration tests (network required)
npm test services/shadow-atlas/services/census-geocoder.integration

# E2E tests (full pipeline)
npm test __tests__/e2e
```

**Coverage target**: >95% for core services

---

## Contributing

### Before Submitting PRs

1. Run type checker: `npm run typecheck`
2. Run linter: `npm run lint:strict`
3. Run tests: `npm test`
4. Validate against TIGER: Use `DataValidator` service (see Common Operations above)

### Validation Pipeline

All boundary data goes through 5-stage validation:

1. **Post-Download**: Type validation, feature count, geometry analysis
2. **Semantic**: Title scoring, negative keyword filtering
3. **Geographic**: State bounding box, FIPS validation
4. **Normalization**: CRS transformation, topology repair
5. **District Count**: Compare to known registry

**Confidence routing**: `0-59: reject`, `60-84: review`, `85-100: accept`

---

## Support & Resources

- **GitHub Issues**: [voter-protocol/issues](https://github.com/noot/voter-protocol/issues)
- **Documentation**: [VOTER Protocol README](../../../../README.md)
- **Security**: [SECURITY.md](../../../../SECURITY.md)
- **Architecture**: [ARCHITECTURE.md](../../../../ARCHITECTURE.md)

---

## License

Same as VOTER Protocol parent repository. See [LICENSE](../../../../LICENSE).

---

## Citation

If you use Shadow Atlas in research or production:

```bibtex
@software{shadow_atlas_2025,
  title = {Shadow Atlas: Hierarchical Political Boundary Resolution for Zero-Knowledge Proofs},
  author = {VOTER Protocol Team},
  year = {2025},
  url = {https://github.com/noot/voter-protocol/tree/main/packages/crypto/services/shadow-atlas},
  note = {100\% accurate validation against Census TIGER ground truth}
}
```
