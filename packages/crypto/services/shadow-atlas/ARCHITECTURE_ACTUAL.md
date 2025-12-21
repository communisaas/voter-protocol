# Shadow Atlas Architecture (Current State)

**Last Updated:** 2025-12-19
**Total Directories:** 41
**Total TypeScript Files:** 322
**Original Spec vs. Reality:** 6 modules documented → 41+ modules implemented

---

## Overview

This document describes the **actual** architecture of Shadow Atlas as implemented, not the original specification. The codebase has evolved significantly beyond the initial 6-module design documented in `SHADOW-ATLAS-TECHNICAL-SPEC.md`.

**Why This Document Exists:**
- Original spec documents ~20 files across 6 modules
- Actual codebase contains 322+ TypeScript files across 41+ directories
- New developers need accurate map of the system as built
- Production deployment requires understanding real dependency graph

**What Changed:**
- Global scaling (190+ countries) drove international provider architecture
- Production requirements added security, observability, resilience modules
- CI/CD automation created ops, deployment, runbook infrastructure
- Service-oriented refactoring consolidated scattered scripts into `core/` facade

---

## Module Hierarchy

### Tier 1: Core Services (Runtime Orchestration)

#### `core/` - Service Facade & Configuration
**Files:** 8 TypeScript files
**Purpose:** Central orchestration, dependency injection, configuration management
**Key Exports:**
- `ShadowAtlasService` - Main service facade coordinating all operations
- `createProductionService()` - Factory for production deployment
- `createDevelopmentService()` - Factory for local development
- `createTestService()` - Factory for unit tests
- `ShadowAtlasConfig` - Type-safe configuration schema

**Dependencies:** Imports from most other modules (facade pattern)

**Files:**
- `index.ts` - Public API exports
- `factory.ts` - Factory functions with dependency injection
- `config.ts` - Configuration schema and defaults
- `shadow-atlas-service.ts` - Main service implementation
- `shadow-atlas-service.test.ts` - Service unit tests
- `shadow-atlas-service.build-atlas.test.ts` - Integration tests
- `types.ts` - Core type definitions
- `token-bucket.ts` - Rate limiting primitives

**Rationale:** The original spec had no centralized service layer. As the codebase grew to 300+ files, a unified facade became essential for maintainability. This module provides a single import point for all Shadow Atlas functionality.

---

#### `services/` - Business Logic Services
**Files:** 42 TypeScript files
**Purpose:** Domain services implementing extraction, validation, discovery workflows
**Key Exports:**
- `BatchOrchestrator` - Manages multi-state extraction pipelines
- `DataValidator` - Validates extracted boundary data
- `CityWardValidator` - Specialized ward-level validation
- `BulkDistrictDiscovery` - Automated boundary discovery
- `CensusGeocoder` - Free geocoding via Census Bureau
- `BoundaryLoader` - Loads boundaries from various sources
- `CoverageAnalyzer` - Analyzes coverage gaps

**Dependencies:** providers, validators, provenance, registry

**Critical Files:**
- `batch-orchestrator.ts` - Coordinates multi-state extraction jobs
- `data-validator.ts` - Deterministic validation pipeline
- `city-ward-validator.ts` - Ward-specific validation logic
- `bulk-district-discovery.ts` - Automated GIS portal crawling
- `census-geocoder.ts` - Free US geocoding (no API key required)
- `gis-server-discovery.ts` - ArcGIS REST API discovery

**Rationale:** These services encapsulate the core business logic that was scattered across `scripts/` in earlier iterations. The service layer enables reuse across CLI, API, and automated workflows.

---

#### `serving/` - API Layer
**Files:** 13 TypeScript files
**Purpose:** REST API endpoints, district lookups, ZK proof generation
**Key Exports:**
- `ShadowAtlasAPI` - Main API router (v1)
- `ShadowAtlasAPIv2` - Enhanced API with caching (v2)
- `DistrictLookupService` - Address → district resolution
- `ProofGenerator` - Merkle proof generation for ZK circuits
- `HealthService` - Health checks for monitoring

**Dependencies:** core, services, integration

**Critical Files:**
- `api.ts` - v1 API implementation
- `api-v2.ts` - v2 API with performance optimizations
- `district-service.ts` - District lookup orchestration
- `proof-generator.ts` - Merkle proof construction
- `health.ts` - Health check endpoints
- `sync-service.ts` - IPFS sync coordination

**Rationale:** API layer separated from service layer to enable multiple API versions, facilitate caching strategies, and support both HTTP and programmatic access patterns.

---

### Tier 2: Data Layer (Acquisition & Storage)

#### `providers/` - Data Source Adapters
**Files:** 9 TypeScript files
**Purpose:** Adapters for Census TIGER, State GIS portals, international sources
**Key Exports:**
- `TIGERBoundaryProvider` - US Census TIGER/Line data
- `StateBatchExtractor` - Batch extraction from state GIS portals
- `StateBoundaryProvider` - State-level boundary provider
- `InternationalProviders` - Global data source adapters

**Dependencies:** registry (for portal URLs)

**Subdirectories:**
- `international/` - Global provider implementations (future)

**Critical Files:**
- `state-batch-extractor.ts` - Automated state GIS extraction
- `state-boundary-provider.ts` - State boundary resolution
- `cross-validation.test.ts` - Provider output verification

**Rationale:** Provider pattern isolates data source complexity. Each provider implements a common interface, enabling fallback chains and cross-validation between sources.

---

#### `registry/` - Endpoint Registry
**Files:** 12 TypeScript files
**Purpose:** Git-tracked registry of authoritative data sources
**Key Exports:**
- `STATE_GIS_PORTALS` - 50-state GIS portal URLs
- `OFFICIAL_DISTRICT_COUNTS` - Ground truth district counts per city
- `INTERNATIONAL_PORTALS` - Global data source registry
- `INTERNATIONAL_PROVIDERS` - Global provider configuration

**Dependencies:** None (pure data)

**Critical Files:**
- `state-gis-portals.ts` - Curated state GIS endpoints (50 states)
- `official-district-counts.ts` - Ground truth for validation
- `international-portals.ts` - Global portal registry
- `international-providers.ts` - Global provider metadata

**Rationale:** Git-tracked registry enables version control of data source URLs, transparent updates via pull requests, and historical tracking of endpoint changes. This is the "phone book" for all authoritative boundary data.

---

#### `provenance/` - Authority Resolution
**Files:** 25 TypeScript files
**Purpose:** Source attribution, conflict resolution, validity tracking
**Key Exports:**
- `AuthorityResolver` - Determines most authoritative source for a boundary
- `TIGERValidityChecker` - Validates TIGER/Line data freshness
- `ProvenanceTracker` - Tracks data lineage and attribution
- `StateBatchIntegration` - Integrates state batch extraction with provenance

**Dependencies:** registry, providers

**Critical Files:**
- `authority-resolver.ts` - Implements authority hierarchy rules
- `tiger-validity.ts` - TIGER/Line data validation
- `tiger-validity.test.ts` - Authority resolution test cases
- `state-batch-integration.ts` - Batch extraction provenance

**Rationale:** When multiple sources provide conflicting boundaries (e.g., state GIS vs. Census TIGER), provenance module determines which source is authoritative. Critical for cryptographic commitments where wrong data breaks proofs.

---

#### `transformation/` - Data Transformation
**Files:** 7 TypeScript files
**Purpose:** GeoJSON normalization, coordinate projection, Merkle tree building
**Key Exports:**
- `TransformationPipeline` - Orchestrates transformation steps
- `GeoJSONNormalizer` - Normalizes GeoJSON to canonical format
- `CoordinateProjector` - Transforms coordinates between projections
- `MerkleTreeBuilder` - Constructs Merkle trees from boundaries

**Dependencies:** core/types, integration

**Critical Files:**
- `geojson-normalizer.ts` - Canonical GeoJSON format
- `coordinate-projector.ts` - WGS84 projection transformations
- `merkle-builder.ts` - Deterministic Merkle tree construction

**Rationale:** Transformation layer ensures all boundaries are in a canonical format before Merkle tree construction. Critical for deterministic proof generation—different GeoJSON representations of the same boundary must hash to the same value.

---

#### `persistence/` - Data Storage
**Files:** 6 TypeScript files
**Purpose:** SQLite storage, job state persistence, caching
**Key Exports:**
- `PersistenceAdapter` - Abstract storage interface
- `JobStateStore` - Tracks long-running extraction jobs
- `CacheManager` - In-memory caching for hot paths

**Dependencies:** core/types

**Critical Files:**
- `job-state-store.ts` - Job state persistence (SQLite)
- `cache-manager.ts` - LRU cache for district lookups
- `persistence-adapter.ts` - Storage abstraction layer

**Rationale:** Persistence layer enables resumable extraction jobs (critical for 50-state extractions that take hours) and caches frequently accessed boundaries (reduces IPFS latency for hot districts).

---

### Tier 3: Quality Assurance (Validation & Testing)

#### `validators/` - Data Validation
**Files:** 10 TypeScript files
**Purpose:** TIGER validation, geographic validation, semantic validation
**Key Exports:**
- `TIGERValidator` - Validates TIGER/Line data integrity
- `GeographicValidator` - Validates geographic properties (no self-intersections, etc.)
- `SemanticValidator` - Validates semantic properties (correct hierarchy, etc.)
- `DeterministicValidationPipeline` - Reproducible validation workflow

**Dependencies:** registry, provenance

**Critical Files:**
- `tiger-validator.ts` - TIGER/Line-specific validation
- `geographic-validator.ts` - Geometric validity checks
- `semantic-validator.ts` - Hierarchical consistency checks
- `deterministic-pipeline.ts` - Deterministic validation orchestration

**Rationale:** Validation layer prevents malformed data from entering the Merkle tree. Critical for ZK proof system—invalid geometries would generate proofs that fail verification on-chain.

---


### Tier 4: Infrastructure (Cross-Cutting Concerns)

#### `security/` - Security Controls
**Files:** 5 TypeScript files
**Purpose:** Input validation, rate limiting, audit logging
**Key Exports:**
- `MultiTierRateLimiter` - Token bucket + sliding window rate limiting
- `InputValidator` - Sanitizes user-provided addresses
- `AuditLogger` - Tamper-evident audit logs

**Dependencies:** core/types

**Critical Files:**
- `rate-limiter.ts` - Prevents abuse of free geocoding
- `input-validator.ts` - SQL injection / XSS prevention
- `audit-logger.ts` - Security event logging

**Rationale:** Security module enforces defense-in-depth. Rate limiting prevents Census API abuse (our only free geocoder). Input validation prevents injection attacks on address strings.

---

#### `resilience/` - Fault Tolerance
**Files:** 9 TypeScript files
**Purpose:** Circuit breakers, retry logic, bulkhead isolation
**Key Exports:**
- `CircuitBreaker` - Prevents cascading failures
- `RetryExecutor` - Exponential backoff retry logic
- `TokenBucketRateLimiter` - Request rate limiting
- `BulkheadIsolator` - Resource pool isolation

**Dependencies:** core/types

**Critical Files:**
- `circuit-breaker.ts` - Circuit breaker implementation
- `retry-executor.ts` - Retry with exponential backoff
- `token-bucket.ts` - Token bucket algorithm
- `bulkhead.ts` - Isolates failures to resource pools

**Rationale:** Resilience module handles transient failures gracefully. State GIS portals are notoriously unreliable—circuit breakers prevent cascading failures when ArcGIS servers go down.

---

#### `observability/` - Monitoring
**Files:** 5 TypeScript files
**Purpose:** Metrics, tracing, health checks
**Key Exports:**
- `Tracer` - Distributed tracing integration
- `HealthMonitor` - System health checks
- `MetricsCollector` - Performance metrics

**Dependencies:** core

**Critical Files:**
- `tracer.ts` - OpenTelemetry tracing
- `health-monitor.ts` - Health check orchestration
- `metrics-collector.ts` - Prometheus metrics

**Rationale:** Observability module enables production monitoring. Critical for debugging transient failures in distributed extraction pipelines.

---

#### `distribution/` - IPFS Distribution
**Files:** 8 TypeScript files
**Purpose:** Global IPFS pinning, regional distribution, CDN optimization
**Key Exports:**
- `RegionalPinningService` - Multi-region IPFS pinning
- `UpdateCoordinator` - Coordinates quarterly updates
- `IPFSPublisher` - Publishes Merkle trees to IPFS

**Dependencies:** core, transformation, integration

**Critical Files:**
- `regional-pinning.ts` - Geo-distributed IPFS pinning
- `update-coordinator.ts` - Quarterly update orchestration
- `ipfs-publisher.ts` - IPFS publication workflow

**Rationale:** Distribution module ensures low-latency access to Shadow Atlas globally. Users in Asia shouldn't wait 5 seconds for US-based IPFS nodes—regional pinning provides <100ms access worldwide.

---

### Tier 5: Advanced Features

#### `integration/` - Merkle Tree Integration
**Files:** 6 TypeScript files
**Purpose:** Global Merkle tree construction, proof generation, ZK circuit integration
**Key Exports:**
- `GlobalMerkleTree` - Constructs global Merkle tree from all boundaries
- `StateBatchToMerkle` - Converts state batch extraction to Merkle leaves
- `ProofGenerator` - Generates Merkle proofs for ZK circuits

**Dependencies:** transformation, core

**Critical Files:**
- `global-merkle-tree.ts` - Global Merkle tree builder
- `global-merkle-tree.test.ts` - Merkle tree test cases
- `state-batch-to-merkle.ts` - Batch → Merkle conversion
- `state-batch-to-merkle.test.ts` - Integration tests

**Rationale:** Integration module bridges Shadow Atlas (geographic data) with noir-prover (ZK circuits). Merkle tree structure must match circuit expectations exactly—this module enforces that contract.

---

#### `agents/` - Agentic Discovery (Experimental)
**Files:** 26 TypeScript files
**Purpose:** AI-driven boundary discovery, portal crawling, quality analysis
**Key Exports:** (Experimental - not for production import)
- LangGraph workflows for automated portal discovery
- ML-based URL pattern validation
- Adversarial testing for discovery algorithms

**Dependencies:** services, providers, registry

**Subdirectories:**
- `langgraph/` - LangGraph agent implementations
- `langgraph/archive/` - Deprecated agent experiments

**Critical Files:**
- `crawl-state-portals-v2.ts` - State GIS portal crawler
- `enumerate-city-district-layers.ts` - City district enumeration
- `load-census-tiger-places.ts` - TIGER/Line place loader
- `langgraph/url_pattern_validator.ts` - URL pattern ML classifier

**Rationale:** Agents automate the tedious work of discovering and validating GIS endpoints. These are research-grade implementations—not imported by production code, but drive registry updates via human review.

---

#### `scanners/` - GIS Portal Scanners
**Files:** 12 TypeScript files
**Purpose:** Automated scanning of ArcGIS Hub, OpenDataSoft, CKAN portals
**Key Exports:**
- `ArcGISHubScanner` - Scans ArcGIS Hub instances
- `OpenDataSoftScanner` - Scans OpenDataSoft portals
- `CKANScanner` - Scans CKAN instances

**Dependencies:** resilience, security

**Critical Files:**
- `arcgis-hub.ts` - ArcGIS Hub REST API client
- `opendatasoft.ts` - OpenDataSoft API client
- `ckan.ts` - CKAN API client

**Rationale:** Scanners automate discovery of new data sources. As cities launch new open data portals, scanners find them automatically, reducing manual curation burden.

---

### Tier 6: Tools & Automation

#### `cli/` - Command Line Interface
**Files:** 3 TypeScript files
**Purpose:** CLI wrappers for common operations
**Key Exports:**
- `build-atlas` - Builds complete Shadow Atlas from scratch
- `validate-tiger` - Validates TIGER/Line data
- `bootstrap` - Bootstraps development environment

**Dependencies:** core, services

**Critical Files:**
- `build-atlas.ts` - Full atlas build workflow
- `validate-tiger.ts` - TIGER/Line validation workflow
- `bootstrap.ts` - Environment setup

**Rationale:** CLI tools provide ergonomic access to service layer for operators. Used in CI/CD for quarterly updates and production deployments.

---

#### `scripts/` - Archived Scripts
**Files:** 1 TypeScript file (19+ archived)
**Purpose:** Legacy scripts, reference implementations
**Status:** Most functionality migrated to `services/` and `cli/`

**Subdirectories:**
- `archived/` - Deprecated scripts preserved for reference

**Note:** The `scripts/` directory was the original implementation before service-oriented refactoring. Most scripts have been superseded by the `services/` module but are preserved for historical reference.

---

### Tier 7: Testing & Operations

#### `__tests__/` - Test Infrastructure
**Files:** 2 TypeScript files (+ many subdirectories)
**Purpose:** Test utilities, fixtures, integration tests, E2E tests
**Key Exports:**
- Test fixtures (sample GeoJSON, mock API responses)
- Test utilities (factory functions, assertions)
- Integration test suites
- E2E test suites
- Performance benchmarks

**Subdirectories:**
- `e2e/` - End-to-end test suites
- `integration/` - Integration test suites
- `performance/` - Performance benchmarks
- `fixtures/` - Test data fixtures
- `utils/` - Test utilities

**Rationale:** Comprehensive test infrastructure ensures correctness across 300+ files. Separate directories for unit/integration/E2E enable appropriate test isolation.

---

#### `ops/` - Operations Runbooks
**Files:** 12 files (mix of .md and .ts)
**Purpose:** Operational runbooks, incident response procedures
**Key Exports:**
- Runbooks for common operational tasks
- Incident response procedures
- Deployment checklists

**Rationale:** Operations module codifies operational knowledge. When IPFS pinning fails at 3 AM, operators have runbooks to follow.

---

#### `runbooks/` - Operational Procedures
**Files:** Multiple markdown files
**Purpose:** Step-by-step operational procedures
**Key Exports:**
- Quarterly update procedures
- Incident response playbooks
- Disaster recovery procedures

**Rationale:** Runbooks complement the `ops/` module with detailed step-by-step procedures.

---

#### `deploy/` - Deployment Configuration
**Files:** 10+ files (Terraform, Kubernetes, Cloudflare Workers)
**Purpose:** Infrastructure-as-code for production deployment
**Key Exports:**
- Cloudflare Workers configuration
- Terraform infrastructure definitions
- Kubernetes manifests

**Rationale:** Deployment configuration enables reproducible production deployments. All infrastructure changes go through code review.

---

#### `benchmarks/` - Performance Benchmarks
**Files:** 3 TypeScript files
**Purpose:** Performance benchmarks for critical paths
**Key Exports:**
- District lookup benchmarks
- Merkle tree construction benchmarks
- IPFS retrieval benchmarks

**Rationale:** Benchmarks prevent performance regressions. Critical for maintaining <100ms p95 latency SLA.

---

### Tier 8: Supporting Modules

#### `acquisition/` - Data Acquisition Workflows
**Files:** 9 TypeScript files
**Purpose:** Orchestrates data acquisition from multiple sources
**Key Exports:**
- Acquisition workflow orchestration
- Multi-source reconciliation

**Dependencies:** providers, provenance

**Rationale:** Acquisition module coordinates complex multi-source extraction workflows.

---

#### `types/` - Shared Type Definitions
**Files:** 4 TypeScript files
**Purpose:** Shared TypeScript types used across modules
**Key Exports:**
- `Boundary` - Core boundary type
- `District` - District metadata type
- `GeoJSON` - Type-safe GeoJSON types

**Dependencies:** None (pure types)

**Rationale:** Centralized type definitions prevent drift. One source of truth for core types.

---

#### `schemas/` - JSON Schemas
**Files:** 4 TypeScript files
**Purpose:** JSON schema definitions for data validation
**Key Exports:**
- GeoJSON schema validators
- API request/response schemas

**Dependencies:** None

**Rationale:** JSON schemas enable runtime validation of external data sources.

---

#### `utils/` - Utility Functions
**Files:** 3 TypeScript files
**Purpose:** Shared utility functions
**Key Exports:**
- String manipulation utilities
- Date formatting utilities
- Math utilities

**Dependencies:** None

**Rationale:** Utility module for pure functions used across multiple modules.

---

#### `sdk/` - Client SDK (Future)
**Files:** 2 TypeScript files
**Purpose:** Client-side SDK for browser/Node.js integration
**Status:** Future work

**Rationale:** SDK will enable easy integration with Shadow Atlas from external applications.

---

#### `examples/` - Example Usage
**Files:** 4 TypeScript files
**Purpose:** Example code demonstrating common usage patterns
**Key Exports:**
- Address lookup examples
- Merkle proof generation examples
- API integration examples

**Rationale:** Examples accelerate onboarding for new developers.

---

### Data Directories (Non-Code)

These directories contain data, not TypeScript code:

- **`data/`** - Static data files (country boundaries, etc.)
- **`db/`** - SQLite database files (gitignored)
- **`discoveries/`** - Discovered GIS endpoints (3 .ts files)
- **`discovery-attempts/`** - Failed discovery attempts (empty)
- **`merkle/`** - Generated Merkle trees (gitignored)
- **`proving/`** - ZK proving artifacts (gitignored)
- **`storage/`** - Temporary storage (gitignored)
- **`test-data/`** - Test fixtures
- **`transformers/`** - Legacy transformers (1 .ts file)
- **`specs/`** - Technical specifications (.md files)
- **`docs/`** - Documentation (.md files)

---

## Import Rules & Layer Boundaries

### Dependency Hierarchy

**Tier 1 (Core Services)** can import from ALL tiers:
- `core/` → any module (facade pattern)
- `services/` → Tier 2, 3, 4
- `serving/` → Tier 1 (core), Tier 2, 3

**Tier 2 (Data Layer)** can import from Tier 2, 3, 4:
- `providers/` → `registry/` only
- `registry/` → NONE (pure data)
- `provenance/` → `registry/`, `providers/`
- `transformation/` → `core/types`, `integration/`
- `persistence/` → `core/types` only

**Tier 3 (Quality Assurance)** can import from Tier 2, 4:
- `validators/` → `registry/`, `provenance/`, `core/types`

**Tier 4 (Infrastructure)** can import from Tier 4 only:
- `security/` → `core/types` only (no business logic)
- `resilience/` → `core/types` only
- `observability/` → `core/` (for tracing hooks)
- `distribution/` → `core/`, `transformation/`, `integration/`

**Tier 5 (Advanced Features)** can import from Tier 1-4:
- `integration/` → `transformation/`, `core/`
- `agents/` → `services/`, `providers/`, `registry/`
- `scanners/` → `resilience/`, `security/`

**Tier 6 (Tools)** can import from ALL tiers:
- `cli/` → `core/`, `services/`
- `scripts/` → any (legacy code)

**Tier 7-8** can import from ALL tiers (testing/support).

### Circular Dependency Prevention

**Forbidden patterns:**
- ❌ `services/` CANNOT import from `serving/` (API depends on services, not vice versa)
- ❌ `providers/` CANNOT import from `provenance/` directly (use `core/` facade)
- ❌ `core/types` CANNOT import from any implementation module
- ❌ `registry/` CANNOT import anything (pure data)
- ❌ Infrastructure tiers (`security/`, `resilience/`) CANNOT import business logic

**Recommended patterns:**
- ✅ Use `core/` facade for cross-module communication
- ✅ Use dependency injection in `core/factory.ts`
- ✅ Keep `core/types.ts` pure (no imports from implementation modules)
- ✅ Use interfaces for abstraction (e.g., `PersistenceAdapter`)

---

## Data Flow: Extraction to API Response

```
External Data Sources (Census TIGER, State GIS, International APIs)
        ↓
    providers/ (data acquisition)
        ↓
    provenance/ (authority resolution, conflict resolution)
        ↓
    services/ (batch orchestration, validation)
        ↓
    validators/ (geographic, semantic, TIGER validation)
        ↓
    transformation/ (GeoJSON normalization, coordinate projection)
        ↓
    integration/ (Merkle tree construction)
        ↓
    distribution/ (IPFS pinning, regional distribution)
        ↓
    persistence/ (cache hot districts in SQLite)
        ↓
    serving/ (API endpoints, proof generation)
        ↓
    External Consumers (Frontend, ZK Circuits, Third-Party APIs)
```

### Control Flow: User Address Lookup

```
1. User → serving/api.ts → POST /resolve
2. serving/district-service.ts → geocode address
3. services/census-geocoder.ts → lat/lng lookup (free, no API key)
4. serving/district-service.ts → load Merkle tree from IPFS
5. distribution/ipfs-publisher.ts → fetch cached tree
6. serving/district-service.ts → point-in-polygon test
7. integration/global-merkle-tree.ts → find matching leaf
8. serving/proof-generator.ts → generate Merkle proof
9. serving/api.ts → return { district, merkleProof, root }
```

---

## Key Entry Points

| Use Case | Entry Point | File Path |
|----------|-------------|-----------|
| **Service Initialization** | `createProductionService()` | `core/factory.ts` |
| **CLI: Build Atlas** | `build-atlas` | `cli/build-atlas.ts` |
| **CLI: Validate TIGER** | `validate-tiger` | `cli/validate-tiger.ts` |
| **API: Resolve Address** | `POST /resolve` | `serving/api-v2.ts` |
| **State Extraction** | `BatchOrchestrator.extract()` | `services/batch-orchestrator.ts` |
| **Validation** | `DataValidator.validate()` | `services/data-validator.ts` |
| **Merkle Tree Build** | `GlobalMerkleTree.build()` | `integration/global-merkle-tree.ts` |
| **IPFS Publish** | `IPFSPublisher.publish()` | `distribution/ipfs-publisher.ts` |

---

## Evolution from Original Spec

| Aspect | Original Spec (Nov 2024) | Current State (Dec 2024) | Reason for Growth |
|--------|--------------------------|--------------------------|-------------------|
| **Modules** | 6 core modules | 41+ directories | Production requirements, global scaling |
| **TypeScript Files** | ~20 files | 322 files | Service-oriented refactoring, comprehensive testing |
| **Geographic Scope** | US-only design | 190+ countries | International provider architecture |
| **Operations** | Manual scripts | Automated CI/CD pipelines | Quarterly update automation |
| **Testing** | Basic unit tests | Unit + Integration + E2E + Performance | Production-grade quality assurance |
| **Deployment** | Local execution only | Cloudflare Workers + Kubernetes | Global distribution requirements |
| **Monitoring** | No observability | Full observability stack | Production reliability requirements |
| **Security** | Basic validation | Multi-tier security controls | Public API hardening |
| **Resilience** | No fault tolerance | Circuit breakers + retries + bulkheads | State GIS portal unreliability |
| **Documentation** | Single technical spec | 40+ README/spec files | Module-specific documentation |

---

## Module Dependency Graph (High-Level)

```
┌─────────────────────────────────────────────────────────────────┐
│                         Tier 1: Core                            │
│  ┌──────────┐      ┌──────────┐      ┌──────────┐             │
│  │   core/  │◄─────│services/ │      │ serving/ │             │
│  └────┬─────┘      └────┬─────┘      └────┬─────┘             │
└───────┼─────────────────┼─────────────────┼───────────────────┘
        │                 │                 │
        │                 │                 │
┌───────┼─────────────────┼─────────────────┼───────────────────┐
│       │    Tier 2: Data Layer            │                    │
│       │                 │                 │                    │
│  ┌────▼─────┐      ┌───▼────────┐   ┌───▼───────┐            │
│  │providers/│      │provenance/ │   │transformation/│         │
│  └────┬─────┘      └────┬───────┘   └───────────┘            │
│       │                 │                                      │
│  ┌────▼─────┐      ┌───▼────────┐                             │
│  │registry/ │      │persistence/│                             │
│  └──────────┘      └────────────┘                             │
└─────────────────────────────────────────────────────────────────┘
        │                 │
        │                 │
┌───────┼─────────────────┼───────────────────────────────────┐
│       │  Tier 3: Quality Assurance                          │
│  ┌────▼─────┐                                                │
│  │validators/│                                                │
│  └──────────┘                                                │
└─────────────────────────────────────────────────────────────┘
        │
        │
┌───────┼─────────────────────────────────────────────────────┐
│       │         Tier 4: Infrastructure                       │
│  ┌────▼─────┐  ┌──────────┐  ┌────────────┐  ┌────────────┐│
│  │security/ │  │resilience/│  │observability/│ │distribution/││
│  └──────────┘  └──────────┘  └────────────┘  └────────────┘│
└─────────────────────────────────────────────────────────────┘
        │
        │
┌───────┼─────────────────────────────────────────────────────┐
│       │    Tier 5: Advanced Features                         │
│  ┌────▼────────┐      ┌─────────┐      ┌─────────┐         │
│  │integration/ │      │ agents/ │      │scanners/│         │
│  └─────────────┘      └─────────┘      └─────────┘         │
└─────────────────────────────────────────────────────────────┘
```

---

## Common Development Workflows

### 1. Add New Data Source

```typescript
// Step 1: Add portal URL to registry
// File: registry/state-gis-portals.ts
export const STATE_GIS_PORTALS = {
  CA: 'https://gis.data.ca.gov/...',
  // Add new state here
};

// Step 2: Create provider adapter
// File: providers/new-state-provider.ts
export class NewStateProvider implements BoundaryProvider {
  async fetch(params: FetchParams): Promise<Boundary[]> {
    // Implementation
  }
}

// Step 3: Register in factory
// File: core/factory.ts
const providers = [
  new TIGERBoundaryProvider(),
  new NewStateProvider(), // Add here
];
```

### 2. Add New Validation Rule

```typescript
// Step 1: Add to validators/
// File: validators/new-validator.ts
export class NewValidator {
  validate(boundary: Boundary): ValidationResult {
    // Implementation
  }
}

// Step 2: Register in data-validator.ts
// File: services/data-validator.ts
const validators = [
  new TIGERValidator(),
  new GeographicValidator(),
  new NewValidator(), // Add here
];
```

### 3. Add New API Endpoint

```typescript
// Step 1: Add to serving/api-v2.ts
// File: serving/api-v2.ts
app.post('/new-endpoint', async (req, res) => {
  const service = req.app.locals.shadowAtlas;
  const result = await service.newOperation(req.body);
  res.json(result);
});

// Step 2: Add operation to ShadowAtlasService
// File: core/shadow-atlas-service.ts
async newOperation(params: OperationParams): Promise<OperationResult> {
  // Implementation using services/
}
```

---

## Testing Strategy by Tier

### Unit Tests (All Tiers)
- **Location:** Co-located with source files (`*.test.ts`)
- **Scope:** Single module, mocked dependencies
- **Coverage Target:** >80% line coverage
- **Run Command:** `npm run test:unit`

### Integration Tests (Tier 1-2)
- **Location:** `__tests__/integration/`
- **Scope:** Multiple modules, real dependencies (SQLite, file system)
- **Coverage Target:** Critical paths (extraction, validation, Merkle tree)
- **Run Command:** `npm run test:integration`

### E2E Tests (All Tiers)
- **Location:** `__tests__/e2e/`
- **Scope:** Full system (API → IPFS → proof generation)
- **Coverage Target:** User-facing workflows
- **Run Command:** `npm run test:e2e`

### Performance Tests
- **Location:** `__tests__/performance/`
- **Scope:** Latency-critical paths (district lookup, proof generation)
- **Coverage Target:** p95 latency <100ms
- **Run Command:** `npm run test:performance`

---

## Production Deployment Architecture

### Cloudflare Workers (API Layer)
- **Source:** `deploy/workers/`
- **Entry Point:** `serving/api-v2.ts`
- **Scale:** Auto-scaling, 200+ global PoPs
- **Latency:** <50ms p95 globally

### IPFS Pinning (Data Distribution)
- **Source:** `distribution/regional-pinning.ts`
- **Providers:** Pinata, web3.storage, Storacha
- **Regions:** North America, Europe, Asia-Pacific
- **Redundancy:** 3x replication per region

### Kubernetes (Batch Jobs)
- **Source:** `deploy/k8s/`
- **Workloads:** Quarterly extraction, validation, Merkle tree builds
- **Schedule:** Cron-triggered (quarterly)
- **Resources:** Scales to 50 concurrent extraction jobs

---

## Migration Path for Legacy Scripts

Many scripts in `scripts/archived/` have been migrated to services:

| Legacy Script | Current Implementation | Migration Status |
|--------------|------------------------|------------------|
| `build-tiger-atlas.ts` | `cli/build-atlas.ts` → `services/batch-orchestrator.ts` | ✅ Complete |
| `validate-tiger-data.ts` | `cli/validate-tiger.ts` → `validators/tiger-validator.ts` | ✅ Complete |
| `extract-statewide-wards.ts` | `services/batch-orchestrator.ts` | ✅ Complete |
| `audit-top-100-cities.ts` | `services/city-ward-validator.ts` | ✅ Complete |
| `discover-all-cities.ts` | `agents/enumerate-city-district-layers.ts` | ✅ Complete |
| `multi-state-validation.ts` | `services/data-validator.ts` | ✅ Complete |

**If you find yourself using a script in `scripts/archived/`, check if there's a service equivalent first.**

---

## Future Architecture Changes (Roadmap)

### Phase 1.5 (Q1 2025) - Performance Optimization
- **Pre-computed indexes:** SQLite FTS5 index for city name lookups
- **CDN caching:** Cloudflare KV for hot district lookups
- **Streaming responses:** Stream large Merkle proofs instead of buffering

### Phase 2 (Q2-Q3 2025) - International Expansion
- **Provider implementations:** `providers/international/` concrete implementations
- **Multi-language support:** `i18n/` module for localized responses
- **Regional compliance:** GDPR, data residency requirements

### Phase 3 (Q4 2025) - Real-Time Updates
- **Change detection:** `services/change-detector.ts` for incremental updates
- **Webhook support:** `serving/webhooks.ts` for push notifications
- **Streaming Merkle trees:** Incremental Merkle tree updates (not quarterly rebuilds)

---

## Questions? Onboarding Checklist

### New Developer Onboarding

**Read these documents first:**
1. ✅ This document (`ARCHITECTURE_ACTUAL.md`) - Understand overall structure
2. ✅ `SHADOW-ATLAS-TECHNICAL-SPEC.md` - Understand problem space
3. ✅ `core/README.md` - Understand service facade
4. ✅ `serving/README.md` - Understand API layer

**Run these commands:**
```bash
# 1. Install dependencies
npm install

# 2. Run unit tests (should pass)
npm run test:unit

# 3. Run CLI to build sample atlas (CA only)
npm run cli:build-atlas -- --state CA

# 4. Validate output
npm run cli:validate-tiger -- --state CA

# 5. Start development API server
npm run serve:dev
```

**Explore these modules:**
- `core/` - Start here, this is the entry point
- `services/` - Business logic lives here
- `serving/` - API implementation
- `integration/` - Merkle tree construction (ZK integration)

**Key files to understand:**
1. `core/factory.ts` - Dependency injection
2. `core/shadow-atlas-service.ts` - Main service facade
3. `services/batch-orchestrator.ts` - Multi-state extraction
4. `integration/global-merkle-tree.ts` - Merkle tree construction
5. `serving/api-v2.ts` - Public API

---

## Appendix: File Count by Module (Raw Data)

```
 42 services/
 26 agents/
 25 provenance/
 13 serving/
 12 scanners/
 12 registry/
 10 validators/
  9 resilience/
  9 providers/
  9 acquisition/
  8 distribution/
  8 core/
  7 transformation/
  6 persistence/
  6 integration/
  5 security/
  5 observability/
  4 types/
  4 schemas/
  4 examples/
  3 utils/
  3 discoveries/
  3 cli/
  3 benchmarks/
  2 sdk/
  2 __tests__/
  1 transformers/
  1 storage/
  1 scripts/
  1 proving/
  1 merkle/
  1 db/
```

**Total TypeScript Files:** 322
**Total Directories:** 41
**Total Lines of Code:** ~50,000+ (estimated)

---

## Document Maintenance

**This document must be updated when:**
- ✅ New module added (update Tier hierarchy)
- ✅ Module deleted/renamed (update file counts)
- ✅ Significant refactoring changes dependency graph
- ✅ New entry point added to service facade
- ✅ Major architectural decisions change data flow

**Update frequency:** Review quarterly alongside Shadow Atlas data updates.

**Last reviewed:** 2025-12-19
**Next review:** 2025-03-19 (quarterly)

---

**End of Document**
