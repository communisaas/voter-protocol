# Multi-Depth Implementation Tracker

> **Version:** 1.0.0
> **Created:** 2026-01-25
> **Status:** In Progress

---

## Executive Summary

Implementation of multi-depth circuit support (18, 20, 22, 24) and 24-slot hybrid district architecture across the voter-protocol stack.

**Current State:** Wave 2 (Verifiers) and Wave 3 (Shadow Atlas) complete. Ready for Wave 4 (Integration Testing).

---

## Audit Findings (Wave 0)

### What's Implemented

| Component | Status | Notes |
|-----------|--------|-------|
| Noir circuit template | DONE | `global DEPTH: u32` parameterized |
| Build script (3 depths) | DONE | 14, 20, 22 compiled |
| DistrictProver (crypto) | DONE | Runtime selection via `getInstance(depth)` |
| DistrictGateV2 contract | DONE | Multi-depth routing implemented |
| VerifierRegistry | DONE | Depth→verifier mapping |
| DistrictRegistry | DONE | District→depth metadata |

### Critical Gaps Identified

| Gap | Impact | Priority |
|-----|--------|----------|
| **noir-prover hardcoded to DEPTH=14** | Browser can't use depths 20+ | CRITICAL |
| Missing depth 18 (UK, small countries) | No UK support | HIGH |
| Missing depth 24 (Netherlands, Israel) | No large national PR systems | HIGH |
| Shadow Atlas fixed depth=12 | Tree capacity mismatch | MEDIUM |
| Geometry hashing inconsistency | Different roots for same data | MEDIUM |
| Duplicate hashPair utilities | Maintenance burden | LOW |

---

## Implementation Waves

### Wave 1: Core Infrastructure [✓] Complete

**Objective:** Enable multi-depth circuit compilation and runtime selection.

#### 1.1 Build Script Updates ✓
- [x] Add depth 18 to `DEPTHS` array
- [x] Add depth 24 to `DEPTHS` array
- [x] Update depth validation (accept 18-24, even only)
- **File:** `packages/crypto/scripts/build-circuits.sh`

#### 1.2 noir-prover Multi-Depth Support ✓
- [x] Add `CircuitDepth` type (18 | 20 | 22 | 24)
- [x] Add circuit lazy-loading per depth
- [x] Update `ProverConfig` interface with depth parameter
- [x] Update `NoirProver.init()` to load depth-specific circuit
- [x] Add `getProverForDepth(depth)` factory function
- [x] Update fixtures to support all depths
- **Files:** `packages/noir-prover/src/prover.ts`, `types.ts`, `index.ts`, `fixtures.ts`

#### 1.3 Hash Utility Consolidation ✓
- [x] Create `packages/shadow-atlas/src/core/utils/poseidon-utils.ts`
- [x] Extract shared `hashPair()` wrapper
- [x] Update multi-layer-builder.ts to use shared utility
- [x] Update global-merkle-tree.ts to use shared utility
- [x] Add `selectDepthForSize()` helper function

#### 1.4 Constants Consolidation ✓
- [x] Create `packages/shadow-atlas/src/core/constants.ts`
- [x] Move `AUTHORITY_LEVELS` to shared constants
- [x] Add `CIRCUIT_DEPTHS` constant
- [x] Add `DEFAULT_TREE_DEPTH` and `DEFAULT_BATCH_SIZE`
- [x] Remove duplicate definitions from global-merkle-tree.ts

---

### Wave 2: Verifier Contract Generation [✓] Complete

**Objective:** Generate and deploy depth-specific verifiers.

#### 2.1 Circuit Compilation ✓
- [x] Compile circuit for depth 18 (24,249 bytes)
- [x] Compile circuit for depth 20 (24,750 bytes)
- [x] Compile circuit for depth 22 (25,231 bytes)
- [x] Compile circuit for depth 24 (25,718 bytes)
- [x] Copy circuits to noir-prover package
- **Files:** `noir/district_membership/target/district_membership_{18,20,22,24}.json`
- **Compiler:** nargo 1.0.0-beta.18

#### 2.2 Verifier Generation Script ✓
- [x] Create `scripts/generate-verifiers.sh`
- [x] Create `contracts/src/verifiers/` directory
- [x] Create `scripts/sync-to-x86.sh` for remote build box sync
- **Solution:** x86 build box at 100.82.94.106 with Docker

#### 2.3 Verifier Generation ✓
- [x] Generate verifier: `bb write_vk` + `bb write_solidity_verifier`
- [x] UltraPlonkVerifier_18.sol (98,837 bytes)
- [x] UltraPlonkVerifier_20.sol (98,837 bytes)
- [x] UltraPlonkVerifier_22.sol (98,837 bytes)
- [x] UltraPlonkVerifier_24.sol (98,837 bytes)
- **Tool:** bb 2.1.11 via Docker on x86 build box
- **Files:** `packages/crypto/contracts/verifiers/UltraPlonkVerifier_{18,20,22,24}.sol`

#### 2.4 Verifier Registration (Pending)
- [ ] Deploy verifiers to Scroll Sepolia
- [ ] Register in VerifierRegistry via governance

---

### Wave 3: Shadow Atlas Updates [✓] Complete

**Objective:** Dynamic depth selection and tree building.

#### 3.1 Depth Selection Logic ✓
- [x] Create `selectDepthForSize(addressCount): CircuitDepth` (in poseidon-utils.ts)
- [x] Create `selectDepthForJurisdiction(country): CircuitDepth` (in constants.ts)
- [x] Add `COUNTRY_DEPTH_MAPPING` for 50+ countries
- [x] Add depth parameter to `MerkleTreeConfig` (with type safety)
- [x] Add `countryCode` parameter for automatic depth selection
- [x] Update `ShadowAtlasMerkleTree.create()` to accept depth

#### 3.2 Tree Metadata ✓
- [x] Add `circuitDepth` to tree export JSON (IPFS export)
- [x] Add `verifierContract` reference to export metadata
- [x] Add `depth` field to `MerkleProof` interface
- [x] Update `generateProof()` to include depth
- [x] Update `CompactProof` format with depth field
- [x] Fix type compatibility between crypto and shadow-atlas CircuitDepth

**Files Modified:**
- `packages/shadow-atlas/src/core/constants.ts` - Added country depth mapping
- `packages/shadow-atlas/src/merkle-tree.ts` - Depth-aware proof generation
- `packages/shadow-atlas/src/serving/proof-generator.ts` - Updated defaults and types
- `packages/shadow-atlas/src/serving/api.ts` - Include depth in responses
- `packages/shadow-atlas/src/index.ts` - Export backward compat alias
- `packages/shadow-atlas/src/core/global-tree-adapter.ts` - Fixed import

---

### Wave 4: Integration Testing [ ] Pending

**Objective:** Verify end-to-end multi-depth flow.

#### 4.1 Unit Tests
- [ ] Test build script produces all 4 depth variants
- [ ] Test NoirProver loads correct circuit per depth
- [ ] Test DistrictProver validates merkle path length
- [ ] Test verifier contracts verify correct proofs

#### 4.2 Integration Tests
- [ ] Test proof generation at depth 18
- [ ] Test proof generation at depth 20
- [ ] Test proof generation at depth 22
- [ ] Test proof generation at depth 24
- [ ] Test on-chain verification routes to correct verifier

#### 4.3 Performance Benchmarks
- [ ] Measure proving time by depth (mobile, desktop, WASM)
- [ ] Measure gas costs by depth
- [ ] Update specs with actual measurements

---

## File Change Manifest

### packages/crypto/
- `scripts/build-circuits.sh` - Add depths 18, 24
- `district-prover.ts` - Update `CircuitDepth` type

### packages/noir-prover/
- `src/prover.ts` - Multi-depth support
- `src/types.ts` - Add depth to ProverConfig
- `src/index.ts` - Export depth-aware factories
- `src/fixtures.ts` - Support all depths
- `circuits/` - Add all depth variants

### packages/shadow-atlas/
- `src/core/constants.ts` - NEW: Shared constants
- `src/core/utils/poseidon-utils.ts` - NEW: Shared hash utilities
- `src/merkle-tree.ts` - Configurable depth
- `src/core/multi-layer-builder.ts` - Use shared utilities
- `src/core/global-merkle-tree.ts` - Use shared utilities

### contracts/
- `src/verifiers/UltraPlonkVerifier_18.sol` - NEW: Generated
- `src/verifiers/UltraPlonkVerifier_20.sol` - NEW: Generated
- `src/verifiers/UltraPlonkVerifier_22.sol` - NEW: Generated
- `src/verifiers/UltraPlonkVerifier_24.sol` - NEW: Generated

### specs/
- `DEPTH-PARAMETERIZATION-PLAN.md` - Update with actual status
- `DISTRICT-MEMBERSHIP-CIRCUIT-SPEC.md` - Mark implemented sections (renamed from GEOGRAPHIC-CELL-CIRCUIT-SPEC.md)
- `DISTRICT-TAXONOMY.md` - No changes needed (documentation complete)

---

## Progress Log

### 2026-01-26 (Wave 2 Complete - Verifiers Generated)

- **Wave 2 Complete**: All 4 UltraHonk verifier contracts generated
- **x86 Build Box Setup**: Created `scripts/sync-to-x86.sh` for rsync to 100.82.94.106
- **Docker Solution**: Built bb:2.1.11 Docker image on x86 box (Ubuntu 24.04 base for GLIBC 2.38+)
- **Circuits Recompiled**: Using nargo 1.0.0-beta.18 for bb compatibility
  - Depth 18: 24,249 bytes → UltraPlonkVerifier_18.sol (98,837 bytes)
  - Depth 20: 24,750 bytes → UltraPlonkVerifier_20.sol (98,837 bytes)
  - Depth 22: 25,231 bytes → UltraPlonkVerifier_22.sol (98,837 bytes)
  - Depth 24: 25,718 bytes → UltraPlonkVerifier_24.sol (98,837 bytes)
- **Verifiers Location**: `packages/crypto/contracts/verifiers/`
- **Next Step**: Wave 4 integration testing, verifier deployment to Scroll Sepolia

### 2026-01-26 (Wave 3 Complete)

- **Wave 3 Complete**: Shadow Atlas depth selection implemented
- **Jurisdiction Mapping**: 50+ countries mapped to optimal circuit depths
  - Depth 18: Microstates, small island nations
  - Depth 20: Western Europe, UK, Canada, mid-sized countries
  - Depth 22: USA, Germany, France, large democracies
  - Depth 24: China, India, Indonesia (mega-population)
- **Depth-Aware Proofs**: MerkleProof now includes `depth` field
- **API Updates**: CompactProof format updated with depth
- **Type Safety**: Fixed CircuitDepth type compatibility across packages
- **Remaining**: Wave 4 integration testing, Wave 2 verifier generation (blocked)

### 2026-01-26 (Wave 2 Partial)

- **Circuits Compiled**: All 4 depths (18, 20, 22, 24) compiled successfully
  - Depth 18: 24,261 bytes
  - Depth 20: 24,762 bytes
  - Depth 22: 25,241 bytes
  - Depth 24: 25,730 bytes
- **Circuits Deployed**: Copied to `packages/noir-prover/circuits/`
- **Verifier Script**: Created `packages/crypto/scripts/generate-verifiers.sh`
- **Blocker**: bb CLI not available for ARM64 macOS via bbup
  - Workaround: Run on x86_64 Linux or Docker
- **Next Step**: Wave 3 - Shadow Atlas depth selection (can proceed in parallel)

### 2026-01-25 (Wave 1 Complete)

- **Wave 1 Complete**: Core infrastructure implemented across all packages
- **Build Script**: Updated to compile depths 18, 20, 22, 24
- **noir-prover**: Multi-depth support with lazy loading and depth-aware singletons
  - `getProverForDepth(depth)` factory function
  - Circuit loaded on demand per depth
  - Thread-safe initialization per depth
- **Shadow Atlas**: Consolidated utilities
  - `constants.ts`: Single source for AUTHORITY_LEVELS, CIRCUIT_DEPTHS
  - `poseidon-utils.ts`: Shared hashPair(), selectDepthForSize()
  - Removed duplicate code from global-merkle-tree.ts, multi-layer-builder.ts
- **Next Step**: Wave 2 - Compile circuits and generate verifier contracts

### 2026-01-25 (Wave 0 Complete)

- **Wave 0 Complete**: Audit revealed noir-prover as critical blocker
- **Documentation Updated**: DISTRICT-MEMBERSHIP-CIRCUIT-SPEC.md created (renamed from GEOGRAPHIC-CELL-CIRCUIT-SPEC.md)
- **Key Finding**: Contracts ready, prover not ready
- **Next Step**: Wave 1 implementation

---

## Dependencies

```
Wave 0 (Audit) ────► Wave 1 (Core Infrastructure)
                              │
                              ├────► Wave 2 (Verifiers)
                              │
                              └────► Wave 3 (Shadow Atlas)
                                           │
                                           └────► Wave 4 (Testing)
```

---

**Authors:** Voter Protocol Team
**License:** MIT
