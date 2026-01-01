# Shadow Atlas: Production Readiness Implementation Plan

> **Distinguished Engineering Principle**: Infrastructure exists; integration is missing. We wire existing components, not rebuild them. Every gap identified by audit has a home in existing abstractions.

## Executive Summary

Five expert audits revealed Shadow Atlas is **80% infrastructure-complete but 0% integration-complete**. The system has production-quality components (Poseidon2 Merkle trees, TIGER providers, validation pipeline, IPFS services) that exist in isolation. This plan wires them into a unified, fault-tolerant pipeline.

| Audit Domain | Infrastructure | Integration | Critical Blockers |
|--------------|----------------|-------------|-------------------|
| **Ingestion Pipeline** | 70% | 30% | No orchestrator, deprecated code active |
| **District Coverage** | 87% | 100% | City council missing, tribal counts incomplete |
| **Provenance Tracking** | 60% | 10% | Not in Merkle leaves, resolver unused |
| **Validation Infrastructure** | 90% | 75% | Failures don't halt, no GEOID lists |
| **Merkle Integration** | 95% | 0% | Proofs disconnected, IPFS disconnected |

**Timeline**: 3-4 weeks for US Federal Districts, 5-6 weeks for full production.

---

## Architectural Invariants

### Patterns to Leverage (DO NOT Rebuild)

| Pattern | Location | Usage |
|---------|----------|-------|
| **BoundaryProvider** | `core/types/provider.ts` | All data sources implement this |
| **ShadowAtlasConfig** | `core/config.ts` | Configuration extension via `createConfig()` |
| **Validation Pipeline** | `validators/tiger-validator.ts` | Extend `validateCompleteness()` |
| **Expected Counts** | `validators/tiger-expected-counts.ts` | Add new `EXPECTED_*_BY_STATE` maps |
| **Topology Rules** | `validators/topology-rules.ts` | Add `allowedStateFips` to rules |
| **Merkle Builder** | `core/multi-layer-builder.ts` | Poseidon2-native, 64x parallel |
| **Global Tree** | `integration/global-merkle-tree.ts` | Hierarchical country aggregation |
| **Snapshot Manager** | `versioning/snapshot-manager.ts` | Version control for trees |
| **Proof Generator** | `serving/proof-generator.ts` | ZK proof service wrapper |
| **Regional Pinning** | `distribution/regional-pinning-service.ts` | Multi-service IPFS |

### Anti-Patterns to Avoid

1. **DO NOT** create parallel validation systems - extend existing validators
2. **DO NOT** use deprecated `transformation/pipeline.ts` (SHA256, not Poseidon2)
3. **DO NOT** use deprecated `state-batch-to-merkle.ts` (legacy MerkleTreeBuilder)
4. **DO NOT** add `any` types - per CLAUDE.md nuclear strictness
5. **DO NOT** duplicate configuration - extend `ShadowAtlasConfig` interface
6. **DO NOT** create new provider base classes - use `BoundaryProvider`

---

## P0 Blockers: Must Fix Before Any Production Use

### P0-1: Wire Proof Generation into buildAtlas()

**Problem**: `ProofService` exists but `buildAtlas()` never calls it. Proofs are not generated or stored.

**Location**: `src/core/shadow-atlas-service.ts:2154` (after snapshot created)

**Solution**:
```typescript
// After line 2154 in buildAtlas():
if (options.generateProofs) {
  const proofs = await this.generateBatchProofs(tree, options.zkConfig);
  await this.snapshotManager.storeProofs(snapshot.id, proofs);
}
```

**Dependencies**:
- `src/serving/proof-generator.ts` - existing `ProofService` class
- `src/versioning/snapshot-manager.ts` - add `storeProofs()` method
- `src/core/config.ts` - add `proofGeneration` config section

**Pitfall**: ZK proofs require `userSecret` for nullifier. We generate **proof templates** (Merkle proof without nullifier), client completes with their secret.

**Effort**: 2-3 days

---

### P0-2: Wire IPFS Distribution into buildAtlas()

**Problem**: `RegionalPinningService` complete but never invoked. `ipfsCID: ''` placeholder throughout.

**Location**: `src/core/shadow-atlas-service.ts:2245` (after export)

**Solution**:
```typescript
// After line 2245 in buildAtlas():
if (this.config.ipfsDistribution?.enabled) {
  const cid = await this.publishToIPFS(tree, snapshot);
  await this.snapshotManager.updateCID(snapshot.id, cid);
}
```

**Dependencies**:
- `src/distribution/regional-pinning-service.ts` - existing service
- `src/distribution/services/` - Storacha, Pinata, Fleek implementations
- `src/core/config.ts` - add `ipfsDistribution` config section

**Pitfall**: IPFS credentials must be securely configured. Use environment variables, not hardcoded.

**Effort**: 2-3 days

---

### P0-3: Add Validation Halt Gates

**Problem**: Validation runs but failures don't stop processing. Invalid data can enter Merkle tree.

**Location**: `src/validators/tiger-validator.ts` (after each validation stage)

**Solution**:
```typescript
// After topology validation:
if (!topologyResult.valid && topologyResult.selfIntersections > 0) {
  throw new ValidationHaltError('Topology validation failed', topologyResult);
}

// After completeness validation:
if (completenessResult.percentage < config.validation.minPassRate * 100) {
  throw new ValidationHaltError('Completeness below threshold', completenessResult);
}
```

**Dependencies**:
- `src/core/types.ts` - add `ValidationHaltError` class
- `src/core/config.ts` - `validation.failOnError` boolean

**Pitfall**: Don't halt on warnings (e.g., redistricting gap). Only halt on errors (topology failures, count mismatches).

**Effort**: 1 day

---

### P0-4: Create Unified Ingestion Orchestrator

**Problem**: `TIGERBoundaryProvider` handles single layers. No multi-state, multi-layer batch coordination.

**Location**: New file `src/acquisition/tiger-ingestion-orchestrator.ts`

**Solution**:
```typescript
export class TIGERIngestionOrchestrator {
  constructor(
    private provider: TIGERBoundaryProvider,
    private config: ShadowAtlasConfig
  ) {}

  async ingestBatch(options: BatchIngestionOptions): Promise<BatchIngestionResult> {
    // Checkpoint management
    // Error aggregation
    // Progress tracking
    // Circuit breaker (abort after N failures)
  }

  async resumeFromCheckpoint(checkpointId: string): Promise<BatchIngestionResult> {
    // Load checkpoint state
    // Resume from last successful item
  }
}
```

**Dependencies**:
- `src/providers/tiger-boundary-provider.ts` - existing provider
- `src/core/config.ts` - add `batchIngestion` config section
- `src/acquisition/checkpoints.ts` - new checkpoint persistence

**Pitfall**: Census Bureau may rate-limit. Implement exponential backoff and respect 10 concurrent connection limit.

**Effort**: 3-5 days

---

### P0-5: Include Provenance in Merkle Leaf Hash

**Problem**: Merkle leaf = `hash(type, id, geometry, authority)`. Authority level included, but full provenance (source URL, checksum, timestamp) is not cryptographically committed.

**Location**: `src/merkle-tree.ts:373-382`

**Solution**:
```typescript
// Current (insufficient):
return hasher.hash4(typeHash, idHash, geometryHash, BigInt(authority));

// Updated (with provenance commitment):
const provenanceHash = await hasher.hashString(
  `${source.url}|${source.checksum}|${source.timestamp}`
);
return hasher.hash5(typeHash, idHash, geometryHash, BigInt(authority), provenanceHash);
```

**Dependencies**:
- `src/core/multi-layer-builder.ts` - update `MerkleBoundaryInput` interface
- `src/provenance/provenance-writer.ts` - attach metadata to boundaries
- Circuit update in `@voter-protocol/crypto` (add 5th input)

**Pitfall**: Circuit change requires new trusted setup or circuit depth increase. Verify Noir circuit supports 5 inputs before implementing.

**Effort**: 2 days (assuming circuit supports it)

---

### P0-6: Remove or Block Deprecated Code Paths

**Problem**: `transformation/pipeline.ts` and `state-batch-to-merkle.ts` use SHA256. Still exported and discoverable.

**Location**: Multiple deprecated files

**Solution**:
```typescript
// Option A: Delete files entirely (preferred)

// Option B: Add runtime assertion
/**
 * @deprecated Use MultiLayerMerkleTreeBuilder instead
 * @throws Error always - this code path is disabled
 */
export function buildMerkleTree(): never {
  throw new Error(
    'DEPRECATED: buildMerkleTree uses SHA256 (not ZK-compatible). ' +
    'Use MultiLayerMerkleTreeBuilder from core/multi-layer-builder.ts'
  );
}
```

**Dependencies**: None (removal only)

**Pitfall**: Ensure no production code imports deprecated modules. Search for imports before deletion.

**Effort**: 1 day

---

## P1 Gaps: Pre-Launch Requirements

### P1-1: Extend Configuration Schema

**Location**: `src/core/config.ts`

**Add Sections**:
```typescript
export interface ShadowAtlasConfig {
  // ... existing fields ...

  /** Proof generation configuration */
  readonly proofGeneration?: {
    readonly enabled: boolean;
    readonly batchSize: number;  // Default: 64
    readonly circuitDepth: 14 | 20 | 22;
    readonly generateOnBuild: boolean;
  };

  /** IPFS distribution configuration */
  readonly ipfsDistribution?: {
    readonly enabled: boolean;
    readonly regions: readonly ('americas' | 'europe' | 'asia-pacific')[];
    readonly services: readonly ('storacha' | 'pinata' | 'fleek')[];
    readonly publishOnBuild: boolean;
    readonly credentials: {
      readonly storacha?: { spaceDid: string; agentPrivateKey: string };
      readonly pinata?: { jwt: string };
      readonly fleek?: { apiKey: string; apiSecret: string };
    };
  };

  /** Batch ingestion configuration */
  readonly batchIngestion?: {
    readonly enabled: boolean;
    readonly checkpointDir: string;
    readonly maxConcurrentStates: number;  // Default: 5
    readonly circuitBreakerThreshold: number;  // Default: 5 consecutive failures
    readonly resumeOnRestart: boolean;
  };
}
```

**Effort**: 1 day

---

### P1-2: Add Snapshot Proof Storage

**Location**: `src/versioning/snapshot-manager.ts`

**Add Methods**:
```typescript
interface Snapshot {
  // ... existing fields ...
  proofs?: Map<string, ProofTemplate>;
  ipfsCID?: string;
}

async storeProofs(snapshotId: string, proofs: Map<string, ProofTemplate>): Promise<void>;
async updateCID(snapshotId: string, cid: string): Promise<void>;
async getProofTemplate(snapshotId: string, districtId: string): Promise<ProofTemplate | null>;
```

**Effort**: 1 day

---

### P1-3: Create GEOID Reference Lists

**Problem**: `tiger-validator.ts` checks counts but cannot detect missing/extra specific GEOIDs.

**Location**: New file `src/validators/geoid-reference.ts`

**Solution**:
```typescript
// Download once from Census, cache as reference
export const CANONICAL_GEOIDS: Record<TIGERLayerType, Record<string, string[]>> = {
  cd: {
    '01': ['0101', '0102', '0103', '0104', '0105', '0106', '0107'],
    // ... all states
  },
  // ... all layers
};

export function getMissingGEOIDs(
  layer: TIGERLayerType,
  stateFips: string,
  actualGEOIDs: string[]
): string[] {
  const expected = CANONICAL_GEOIDS[layer]?.[stateFips] ?? [];
  return expected.filter(g => !actualGEOIDs.includes(g));
}
```

**Pitfall**: Reference lists must be versioned by TIGER vintage year. 2024 GEOIDs may differ from 2023.

**Effort**: 3 days

---

### P1-4: Add City Council District Coverage

**Problem**: No city council provider exists. Framework scaffolded but no implementations.

**Location**: New file `src/providers/city-council-provider.ts`

**Solution**:
```typescript
export class CityCouncilProvider implements BoundaryProvider {
  constructor(
    private cityFips: string,
    private discoveryPath: MunicipalDiscoveryPath
  ) {}

  async download(): Promise<RawBoundaryFile[]> {
    // Use 4-path discovery from existing registry
    const portal = await discoverCityGISPortal(this.cityFips);
    return portal.fetchCouncilDistricts();
  }
}

// Priority cities for Phase 1:
export const PRIORITY_CITIES = [
  { fips: '0644000', name: 'Los Angeles', councilSize: 15 },
  { fips: '3651000', name: 'New York City', councilSize: 51 },
  { fips: '1714000', name: 'Chicago', councilSize: 50 },
  // ... top 20 cities by population
];
```

**Effort**: 3-5 days

---

### P1-5: Complete Tribal Per-State Counts

**Problem**: `EXPECTED_TBG_BY_STATE` and `EXPECTED_TTRACT_BY_STATE` missing from expected counts.

**Location**: `src/validators/tiger-expected-counts.ts`

**Solution**: Add maps following existing pattern:
```typescript
export const EXPECTED_TBG_BY_STATE: Record<string, number> = {
  '04': 21,  // Arizona
  '35': 23,  // New Mexico
  '40': 39,  // Oklahoma
  // ... all states with tribal areas
};

export const EXPECTED_TTRACT_BY_STATE: Record<string, number> = {
  // ... census tract-level tribal data
};
```

**Data Source**: Census TIGER 2024 `tbg` and `ttract` layers.

**Effort**: 2 days

---

### P1-6: Automate Cross-Validation

**Problem**: `CrossValidator` exists but not called automatically during `buildAtlas()`.

**Location**: `src/core/shadow-atlas-service.ts:1924-1987`

**Solution**:
```typescript
// In buildAtlas(), after TIGER download:
if (this.config.crossValidation.enabled) {
  for (const stateFips of this.config.crossValidation.states ?? allStates) {
    const stateData = await this.fetchStateGISData(stateFips);
    if (stateData) {
      const result = await crossValidator.validate(tigerData, stateData);
      if (result.qualityScore < this.config.crossValidation.minQualityScore) {
        if (this.config.crossValidation.failOnMismatch) {
          throw new ValidationError(`Cross-validation failed for ${stateFips}`);
        }
        warnings.push(`Cross-validation quality low for ${stateFips}: ${result.qualityScore}`);
      }
    }
  }
}
```

**Pitfall**: State GIS portals may be unavailable. Use `gracefulFallback: true` (already in config).

**Effort**: 2 days

---

## P2 Gaps: Operational Excellence

### P2-1: Distributed Tracing (OpenTelemetry)

**Problem**: Provenance uses 8-char `aid` but no full trace ID for multi-step correlation.

**Solution**: Add OpenTelemetry spans to all async operations.

**Effort**: 3-5 days

---

### P2-2: Dead Letter Queue for Failed Downloads

**Problem**: Failed downloads logged but not queued for retry/investigation.

**Solution**: Add SQLite table for failed jobs with retry scheduling.

**Effort**: 2 days

---

### P2-3: Cache TTL Based on TIGER Release Schedule

**Problem**: Cache never expires automatically.

**Solution**: Check file timestamps against TIGER annual release date (September).

**Effort**: 1 day

---

### P2-4: E2E Batch Ingestion Test

**Problem**: No test downloads multiple states, builds tree, validates integrity.

**Solution**: Add `full-batch-ingestion.test.ts` (5 states x 4 layers).

**Effort**: 2 days

---

### P2-5: Performance Benchmarks for 200K Boundaries

**Problem**: Unknown if memory/CPU adequate for nationwide ingestion.

**Solution**: Load test with full TIGER dataset, document resource requirements.

**Effort**: 2 days

---

## Implementation Waves

### Wave 1: Core Pipeline Integration (P0-1 through P0-3)
**Objective**: Make `buildAtlas()` produce proofs and publish to IPFS
**Agents**: 3 parallel

| Work Package | Agent Focus | Files | Effort |
|--------------|-------------|-------|--------|
| WP-PROOF-1 | Wire proof generation | `shadow-atlas-service.ts`, `proof-generator.ts` | 2-3 days |
| WP-IPFS-1 | Wire IPFS distribution | `shadow-atlas-service.ts`, `regional-pinning-service.ts` | 2-3 days |
| WP-HALT-1 | Add validation halt gates | `tiger-validator.ts`, `types.ts` | 1 day |

**Deliverable**: `buildAtlas()` → validate → prove → distribute → commit

---

### Wave 2: Orchestration & Safety (P0-4 through P0-6)
**Objective**: Robust batch ingestion with deprecated code removed
**Agents**: 3 parallel

| Work Package | Agent Focus | Files | Effort |
|--------------|-------------|-------|--------|
| WP-ORCH-1 | Ingestion orchestrator | New `tiger-ingestion-orchestrator.ts` | 3-5 days |
| WP-PROV-1 | Provenance in Merkle leaf | `merkle-tree.ts`, `multi-layer-builder.ts` | 2 days |
| WP-DEPREC-1 | Remove deprecated code | `pipeline.ts`, `state-batch-to-merkle.ts` | 1 day |

**Deliverable**: Checkpointed batch ingestion with cryptographic provenance

---

### Wave 3: Configuration & Storage (P1-1 through P1-2)
**Objective**: Extended config schema and snapshot proof storage
**Agents**: 2 parallel

| Work Package | Agent Focus | Files | Effort |
|--------------|-------------|-------|--------|
| WP-CONFIG-1 | Extend config schema | `config.ts`, `types.ts` | 1 day |
| WP-SNAP-1 | Snapshot proof storage | `snapshot-manager.ts`, `types.ts` | 1 day |

**Deliverable**: Configuration-driven proof/IPFS behavior

---

### Wave 4: Validation Hardening (P1-3, P1-6)
**Objective**: GEOID reference lists and automated cross-validation
**Agents**: 2 parallel

| Work Package | Agent Focus | Files | Effort |
|--------------|-------------|-------|--------|
| WP-GEOID-1 | GEOID reference lists | New `geoid-reference.ts` | 3 days |
| WP-XVAL-1 | Automate cross-validation | `shadow-atlas-service.ts` | 2 days |

**Deliverable**: Detect specific missing/extra GEOIDs, not just count mismatches

---

### Wave 5: District Expansion (P1-4 through P1-5)
**Objective**: City council coverage and tribal counts
**Agents**: 2 parallel

| Work Package | Agent Focus | Files | Effort |
|--------------|-------------|-------|--------|
| WP-COUNCIL-1 | City council provider | New `city-council-provider.ts` | 3-5 days |
| WP-TRIBAL-1 | Tribal per-state counts | `tiger-expected-counts.ts` | 2 days |

**Deliverable**: Top 20 cities + complete tribal validation

---

### Wave 6: Operational Excellence (P2)
**Objective**: Tracing, dead letter queue, caching, tests
**Agents**: 4 parallel

| Work Package | Agent Focus | Files | Effort |
|--------------|-------------|-------|--------|
| WP-TRACE-1 | OpenTelemetry integration | Multiple | 3-5 days |
| WP-DLQ-1 | Dead letter queue | New `dead-letter-queue.ts` | 2 days |
| WP-CACHE-1 | Cache TTL | `tiger-boundary-provider.ts` | 1 day |
| WP-E2E-1 | Batch ingestion test | New test file | 2 days |

**Deliverable**: Production-grade observability and testing

---

## Agent Delegation Context

### Common Context for All Agents

```
Repository: voter-protocol/packages/shadow-atlas
TypeScript: Strict mode, no `any`, no `@ts-ignore`
Testing: Vitest, mock external APIs
Patterns: BoundaryProvider, ShadowAtlasConfig, ValidationResult
Hash Function: Poseidon2 (NOT SHA256)
Deprecated: transformation/pipeline.ts, state-batch-to-merkle.ts
```

### Per-Agent Deep Context

**WP-PROOF-1 Agent**:
- Read: `serving/proof-generator.ts` (ProofService, ZKProofService)
- Read: `core/shadow-atlas-service.ts:1644-2298` (buildAtlas flow)
- Read: `@voter-protocol/crypto/district-prover` (circuit interface)
- Output: Proof templates stored in snapshot

**WP-IPFS-1 Agent**:
- Read: `distribution/regional-pinning-service.ts` (full implementation)
- Read: `distribution/services/` (Storacha, Pinata, Fleek)
- Read: `core/config.ts` (configuration pattern)
- Output: CID stored in snapshot, multi-region replication

**WP-ORCH-1 Agent**:
- Read: `providers/tiger-boundary-provider.ts` (download methods)
- Read: `acquisition/incremental-orchestrator.ts` (existing pattern)
- Read: `core/config.ts` (extraction settings)
- Output: Checkpoint-based batch ingestion with circuit breaker

**WP-PROV-1 Agent**:
- Read: `merkle-tree.ts:373-382` (current leaf hash)
- Read: `provenance/provenance-writer.ts` (metadata format)
- Read: `core/multi-layer-builder.ts` (MerkleBoundaryInput)
- Output: 5-input leaf hash with provenance commitment

---

## Success Criteria

### Wave 1 Complete When:
- [ ] `buildAtlas({ generateProofs: true })` produces proof templates
- [ ] `buildAtlas({ publishToIPFS: true })` returns IPFS CID
- [ ] Invalid topology halts build with `ValidationHaltError`
- [ ] Tests verify all three behaviors

### Wave 2 Complete When:
- [ ] `TIGERIngestionOrchestrator.ingestBatch()` downloads 5 states
- [ ] Checkpoint allows resume after partial failure
- [ ] Circuit breaker triggers after 5 consecutive failures
- [ ] Merkle leaf includes provenance hash
- [ ] Deprecated files deleted or throw on import

### Wave 3 Complete When:
- [ ] `ShadowAtlasConfig` has `proofGeneration` and `ipfsDistribution` sections
- [ ] `SnapshotManager.storeProofs()` persists proof templates
- [ ] `SnapshotManager.updateCID()` updates IPFS reference

### Wave 4 Complete When:
- [ ] `getMissingGEOIDs()` returns specific missing district IDs
- [ ] Cross-validation runs automatically during `buildAtlas()`
- [ ] Quality score threshold enforced per configuration

### Wave 5 Complete When:
- [ ] `CityCouncilProvider` fetches 3+ major cities
- [ ] `EXPECTED_TBG_BY_STATE` and `EXPECTED_TTRACT_BY_STATE` complete
- [ ] All 56 jurisdictions have tribal counts (or explicit 0)

### Wave 6 Complete When:
- [ ] OpenTelemetry traces visible in collector
- [ ] Failed downloads stored in dead letter queue
- [ ] Cache expires based on TIGER release date
- [ ] E2E test passes (5 states x 4 layers → Merkle tree → verify)

---

## Risk Mitigation

### Circuit Change Risk (WP-PROV-1)
**Risk**: Adding 5th input to Merkle leaf may require Noir circuit update.
**Mitigation**: Check circuit arity before implementation. If limited to 4 inputs, hash provenance into geometry hash instead.

### IPFS Credential Risk (WP-IPFS-1)
**Risk**: Hardcoded credentials in config.
**Mitigation**: Use `process.env` with `dotenv`. Never commit credentials.

### Census Rate Limiting (WP-ORCH-1)
**Risk**: Bulk downloads trigger IP ban.
**Mitigation**: Respect 10 concurrent connections. Implement 429 handling with exponential backoff.

### State GIS Unavailability (WP-XVAL-1)
**Risk**: State portals down during cross-validation.
**Mitigation**: `gracefulFallback: true` already in config. Log warning, don't fail.

---

## References

| Component | Location | Purpose |
|-----------|----------|---------|
| buildAtlas() | `shadow-atlas-service.ts:1644-2298` | Main entry point |
| ProofService | `serving/proof-generator.ts:72-316` | ZK proof generation |
| RegionalPinningService | `distribution/regional-pinning-service.ts` | Multi-region IPFS |
| TIGERBoundaryProvider | `providers/tiger-boundary-provider.ts` | TIGER downloads |
| TIGERValidator | `validators/tiger-validator.ts` | Validation pipeline |
| SnapshotManager | `versioning/snapshot-manager.ts` | Version control |
| CrossValidator | `validators/cross-validator.ts` | TIGER vs State GIS |
| MultiLayerMerkleTreeBuilder | `core/multi-layer-builder.ts` | Poseidon2 trees |
| GlobalMerkleTreeBuilder | `integration/global-merkle-tree.ts` | Multi-country |

---

*Quality discourse pays. Bad faith costs.*
