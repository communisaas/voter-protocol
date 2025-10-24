# VOTER Protocol: Implementation Status & Roadmap

**Date**: 2025-10-23
**Status**: 🔴 CRITICAL IMPLEMENTATION GAPS - NOT PRODUCTION READY
**Based on**: Brutalist assessment (Oct 22), repository audit, documentation migration complete

---

## Executive Summary: Where We Are

### ✅ **COMPLETE**
- **Documentation migration**: AWS Nitro TEE → Browser-native Halo2 + KZG (100%)
- **Shadow Atlas build pipeline**: Two-tier Merkle tree with mock data
- **Client SDK structure**: TypeScript packages scaffolded
- **Smart contract architecture**: Designed (not implemented)

### 🔴 **CRITICAL BLOCKERS**
- **Halo2 circuits**: Security theater (Poseidon returns zero, unconstrained public inputs)
- **TypeScript crypto**: Cross-platform broken (Buffer/atob issues)
- **Proof generation**: Returns `Err()` stub
- **Smart contracts**: NOT STARTED (no Solidity code exists)
- **Testing**: ZERO tests for critical crypto code

### ⏱️ **TIMELINE TO PRODUCTION**
- Week 1-3: Fix broken circuits + crypto (RECOVERY-PLAN.md)
- Week 4-6: Implement proof generation + WASM
- Week 7-9: Smart contracts + Scroll integration
- Week 10-12: Security audit + production deployment
- **Total**: 12 weeks minimum (3 months)

---

## Repository Structure Analysis

### voter-protocol (This Repo)
```
├── packages/
│   ├── client/          ✅ Scaffolded, ❌ Halo2 prover broken
│   ├── crypto/          🔴 CRITICAL: Circuits broken, TypeScript cross-platform issues
│   └── types/           ✅ Basic types defined
├── contracts/
│   └── near/            🚫 DEPRECATED: CipherVault contract (never deployed, replaced by Scroll Identity Registry)
│   └── scroll/          ❌ NOT STARTED (Solidity contracts missing)
├── scripts/
│   └── build-shadow-atlas.ts   ✅ Working with mock data
├── specs/               ✅ Complete, recently updated
└── docs/                ✅ Active planning docs (10 files)
```

### communique (Frontend Repo - Separate)
```
├── src/                 ✅ SvelteKit 5 frontend
├── prisma/              ✅ Database schema
└── package.json         ✅ Depends on @voter-protocol/client
```

---

## Critical Implementation Gaps (Brutalist Findings)

### 1. 🔴 Halo2 Circuits: Security Theater

**File**: `packages/crypto/circuits/src/poseidon_gadget.rs`

**Problem**:
```rust
pub fn hash_pair(...) -> Result<Value<Fr>, ErrorFront> {
    // TODO: Replace with actual Poseidon implementation
    Ok(Value::known(Fr::zero()))  // ALWAYS RETURNS ZERO
}
```

**Impact**:
- Every Merkle leaf hashes to zero
- Every Merkle root is zero
- Anyone can forge "valid" proofs for ANY address
- **Complete bypass of zero-knowledge guarantees**

**Fix** (Week 1: 3 days):
- Integrate `halo2_poseidon` gadget from PSE fork
- Implement real Poseidon constraints
- Write MockProver tests verifying non-zero outputs

---

### 2. 🔴 Unconstrained Public Inputs

**File**: `packages/crypto/circuits/src/district_membership.rs`

**Problem**:
- Public `merkle_root` assigned but never constrained to instance column
- Public `district_hash` assigned but never constrained to instance column
- Attacker can prove membership in tree A, claim it's for tree B

**Impact**:
- Zero-knowledge proof doesn't actually prove anything
- Can claim to be from any district regardless of actual address

**Fix** (Week 1: 2 days):
```rust
// Add these constraints:
layouter.constrain_instance(computed_root.cell(), config.instance, 0)?;
layouter.constrain_instance(district_hash.cell(), config.instance, 1)?;
```

---

### 3. 🔴 TypeScript Cross-Platform Broken

**Files**:
- `packages/crypto/src/encryption.ts:301-322` (Node Buffer in browsers)
- `packages/crypto/src/compression.ts:47-64` (browser atob() in Node)

**Problem**:
- `Buffer` doesn't exist in browsers → ReferenceError crash
- `atob()` doesn't exist in Node → ReferenceError crash
- Package published to npm but crashes in Node environment

**Impact**:
- Cannot use encryption in browsers
- Cannot use compression in Node
- Package is unusable in either environment

**Fix** (Week 1: 1 hour):
```typescript
// Replace Buffer with @noble/hashes utilities
import { utf8ToBytes, bytesToHex } from '@noble/hashes/utils';

// Replace atob() with universal base64 decode
import { decode as base64Decode } from 'base64-arraybuffer-es6';
```

---

### 4. 🔴 Proof Generation: Stub Only

**File**: `packages/crypto/circuits/src/district_membership.rs:190-220`

**Problem**:
```rust
pub fn generate_proof(circuit: DistrictMembershipCircuit) -> Result<Vec<u8>, String> {
    Err("Proof generation not yet implemented".to_string())
}
```

**Impact**:
- Cannot generate proofs
- WASM bindings exist but return errors
- Client SDK cannot function

**Fix** (Week 2-3: 5-6 days):
- Implement Halo2 proving key generation
- Implement proof generation with KZG commitment
- Implement proof serialization for WASM
- Benchmark: 600ms-10s target (device-dependent)

---

### 5. 🔴 Smart Contracts: NOT STARTED

**Missing**: `contracts/scroll/` directory doesn't exist

**Required Contracts** (Week 7-8: 2-3 weeks):

1. **DistrictGate.sol** - Halo2 proof verification
   - Verify zero-knowledge proofs on-chain
   - Manage Shadow Atlas Merkle root updates
   - Track nullifiers (prevent double-verification)
   - Target: 300-500k gas per verification

2. **ReputationRegistry.sol** - ERC-8004 implementation
   - Record civic actions
   - Calculate time-weighted reputation scores
   - Domain-specific reputation (healthcare, climate, etc.)

3. **CommuniqueCoreV2.sol** - Message certification
   - Certify messages with district proofs
   - Link to DistrictGate verification
   - Emit events for congressional tracking

4. **Halo2Verifier.sol** - Proof verification library
   - Auto-generated from circuit using halo2-solidity tools
   - BN254 pairing verification
   - Estimated 200-300k gas

**Status**: Zero Solidity code exists. Need Foundry setup + implementation.

---

### 6. ❌ Shadow Atlas: Mock Data Only

**File**: `scripts/build-shadow-atlas.ts`

**Current**: 535 districts with placeholder geometries
**Needed**: Real Census TIGER/Line shapefiles

**Required** (Week 9: 1-2 weeks):
- Download Census shapefiles: `cb_2024_us_cd119_5m.zip`
- Install shapefile processing: `shapefile`, `@turf/turf`
- Calculate bounding boxes for client-side filtering
- Store full geometries in IPFS (CID per district)
- Generate production Merkle tree (5-10MB with geometries)
- Publish to IPFS (Pinata/Infura)
- Update on-chain Shadow Atlas root via governance

---

## What Needs to Change

### Immediate (Week 1) - Fix Broken Code

1. **Poseidon hash**: Integrate `halo2_poseidon` gadget (3 days)
2. **Public input constraints**: Add `constrain_instance()` calls (2 days)
3. **TypeScript cross-platform**: Replace Buffer/atob (1 hour)
4. **Cache Poseidon**: Module-level `buildPoseidon()` cache (1 hour)
5. **Pin git dependencies**: Lock to commit hashes (1 hour)

### Critical (Week 1-3) - Core Functionality

6. **Merkle constraints**: Add Poseidon to Merkle gate (3 days)
7. **District verification**: Design + implement district logic (3 days)
8. **MockProver tests**: Comprehensive circuit testing (2 days)
9. **TypeScript tests**: Crypto package test suite (2 days)
10. **Proof generation**: Implement real Halo2 prover (5-6 days)

### Essential (Week 3-6) - Integration

11. **Proof verification**: Implement Halo2 verifier (2 days)
12. **WASM build**: Compile to browser target (2 days)
13. **Error handling**: Proper error types (1 day)
14. **Input validation**: Sanitize all inputs (2 days)
15. **Documentation**: Remove false claims (2 days)

### Production (Week 7-12) - Launch Prep

16. **Smart contracts**: Implement all Solidity contracts (2-3 weeks)
17. **Shadow Atlas**: Real Census data integration (1-2 weeks)
18. **Scroll integration**: Deploy + test on Sepolia (1 week)
19. **Security audit**: Professional audit (4-6 weeks)
20. **Performance benchmarks**: Document real numbers (1 week)

---

## What Needs to Be Removed

### 1. ❌ False Performance Claims

**Remove from ALL documentation**:
- ~~"4-6 second proving time"~~ → Document actual: "600ms-10s (device-dependent)"
- ~~"Works on commodity hardware"~~ → Specify: "Requires SharedArrayBuffer (95% devices)"
- ~~"90% compression ratio"~~ → Honest: "Empty Zstd dictionary, compression varies"
- ~~"Production-ready infrastructure"~~ → Accurate: "Experimental - NOT FOR PRODUCTION"

### 2. ❌ Broken Dependencies

**Remove from package.json**:
```json
// packages/client/package.json
"@axiom-crypto/halo2-js": "^0.1.94",        // 2+ years stale, never used
"@axiom-crypto/halo2-lib-js": "^0.3.4"     // 2+ years stale, never used
```

**Reason**: Axiom packages are 2+ years old (last published 2023). Using stale cryptographic packages is security anti-pattern. We're building custom Halo2 implementation using PSE fork.

### 3. ❌ Obsolete Code Paths

**Remove from crypto package**:
- Axiom integration attempts (never worked)
- TEE attestation code (migrated to browser-native)
- Groth16 fallback code (committed to Halo2)

**Remove from client package**:
- AWS Nitro references (fully migrated to browser-native)
- Server-side proving stubs (browser-only now)

### 4. ❌ Root `/src/` Directory

**Question**: Why does `/src/lib/` exist in voter-protocol root?

```
/Users/noot/Documents/voter-protocol/src/lib/
```

**Answer needed**: This appears to be legacy/duplicate code. Check if it's:
- Duplicate of packages/client/src
- Old code from before monorepo setup
- Should be removed entirely

**Action**: Audit and remove if obsolete.

### 5. ❌ Misleading npm Warnings

**Current**: Packages could be published in broken state

**Add to package.json**:
```json
{
  "private": true,  // DO NOT publish until tests pass
  "deprecated": "⚠️ EXPERIMENTAL - NOT FOR PRODUCTION USE"
}
```

---

## Revised Roadmap

### Week 1: Stop the Bleeding (Oct 23-29)
**Goal**: Make code not crash, get Poseidon working

**Day 1-2** (2 days):
- [ ] Fix TypeScript cross-platform (Buffer → @noble/hashes, atob() → universal)
- [ ] Cache buildPoseidon() at module level
- [ ] Pin git dependencies to commit hashes
- [ ] Add random KDF salts
- [ ] Add AAD validation

**Day 3-5** (3 days):
- [ ] Integrate halo2_poseidon gadget
- [ ] Implement PoseidonHasher::hash_pair() with real constraints
- [ ] Implement PoseidonHasher::hash_single() with real constraints
- [ ] Write unit tests comparing against reference implementation

**Day 6-7** (2 days):
- [ ] Add layouter.constrain_instance() for merkle_root
- [ ] Add layouter.constrain_instance() for district_hash
- [ ] Write MockProver tests for valid/invalid cases

**Exit Criteria**:
- ✅ TypeScript crypto runs in Node + browsers without crashing
- ✅ Poseidon hash returns non-zero values
- ✅ Public inputs properly constrained
- ✅ At least 2 MockProver tests passing

---

### Week 2: Complete Circuit (Oct 30 - Nov 5)
**Goal**: Full circuit implementation with comprehensive tests

**Day 8-10** (3 days):
- [ ] Add Poseidon constraints to Merkle gate
- [ ] Test valid 2-level Merkle tree with MockProver
- [ ] Test invalid sibling rejection
- [ ] Test forged path rejection
- [ ] Verify circuit size (K=12 sufficient)

**Day 11-13** (3 days):
- [ ] Design district embedding (subtrees vs path levels vs separate tree)
- [ ] Implement chosen approach
- [ ] Add constraints verifying district match
- [ ] Test TX-01 can't claim CA-12
- [ ] Test with real Shadow Atlas structure (535 districts)

**Day 14** (1 day):
- [ ] Set up Vitest for TypeScript
- [ ] Test compress → decompress round-trip
- [ ] Test encrypt → decrypt round-trip
- [ ] Test commitment generation
- [ ] Test cross-platform (Node + browser)

**Exit Criteria**:
- ✅ Complete circuit with all constraints
- ✅ 5+ MockProver tests (valid + invalid cases)
- ✅ TypeScript test suite (>80% coverage)
- ✅ District verification working

---

### Week 3: Proof Generation (Nov 6-12)
**Goal**: End-to-end proof generation and verification

**Day 15-17** (3 days):
- [ ] Research Halo2 proving key generation
- [ ] Implement generate_proof() with actual Halo2 prover
- [ ] Handle KZG parameters (Ethereum's 141K-participant ceremony)
- [ ] Implement proof serialization
- [ ] Benchmark: proving time, memory usage, proof size

**Day 18-19** (2 days):
- [ ] Implement verify_proof() with Halo2 verifier
- [ ] Handle verification key loading
- [ ] Implement proof deserialization
- [ ] Test proof round-trip (generate → verify)

**Day 20-21** (2 days):
- [ ] WASM build with wasm-pack
- [ ] Test WASM proof generation in browser
- [ ] Add proper error types (no more string errors)
- [ ] Add input validation (path length, hex format, etc.)
- [ ] Update README with actual capabilities (remove lies)

**Exit Criteria**:
- ✅ Proof generation works
- ✅ Proof verification works
- ✅ WASM build compiles
- ✅ All tests passing (Rust + TypeScript)
- ✅ Honest documentation

---

### Week 4-6: WASM Optimization (Nov 13 - Dec 3)
**Goal**: Browser-native proving optimization

**Week 4**:
- [ ] Web Worker integration (non-blocking UI)
- [ ] IndexedDB caching for proving keys
- [ ] Progressive loading strategies
- [ ] Memory optimization (<4GB peak)

**Week 5**:
- [ ] Performance benchmarking (desktop, mobile, tablets)
- [ ] K=12 circuit optimization
- [ ] Parallel witness generation (4 Web Workers)
- [ ] Compression for proving keys

**Week 6**:
- [ ] Browser compatibility testing (Chrome, Firefox, Safari, Edge)
- [ ] Mobile device testing (iOS 16+, Android 12+)
- [ ] Error recovery (OOM handling, timeout retries)
- [ ] Documentation update with real benchmarks

**Exit Criteria**:
- ✅ 600ms proving on M1 MacBook
- ✅ <10s proving on mobile devices
- ✅ Works on 95% of devices (SharedArrayBuffer support)
- ✅ Graceful degradation for unsupported devices

---

### Week 7-9: Smart Contracts (Dec 4-24)
**Goal**: Scroll L2 contract deployment

**Week 7**: Contract Implementation
- [ ] Set up Foundry project (contracts/scroll/)
- [ ] Implement DistrictGate.sol (Halo2 verification)
- [ ] Implement ReputationRegistry.sol (ERC-8004)
- [ ] Implement CommuniqueCoreV2.sol (message certification)
- [ ] Generate Halo2Verifier.sol from circuit

**Week 8**: Testing & Optimization
- [ ] Foundry test suite (100+ test cases)
- [ ] Gas optimization (<500k per verification target)
- [ ] Nullifier registry testing
- [ ] Shadow Atlas root management testing
- [ ] Access control audits

**Week 9**: Deployment
- [ ] Deploy to Scroll Sepolia testnet
- [ ] Verify contracts on Scrollscan
- [ ] Integration testing (browser proof → on-chain verification)
- [ ] Gas cost profiling (actual vs estimated)
- [ ] Documentation for contract interaction

**Exit Criteria**:
- ✅ All contracts deployed on Scroll Sepolia
- ✅ Gas cost <500k verified
- ✅ 100% test coverage
- ✅ End-to-end flow working (browser → contract)

---

### Week 10: Shadow Atlas Production (Dec 25-31)
**Goal**: Real Census data integration

- [ ] Download Census TIGER/Line shapefiles
- [ ] Process shapefiles (shapefile, @turf/turf)
- [ ] Calculate bounding boxes
- [ ] Generate production Merkle tree (5-10MB)
- [ ] Publish to IPFS (Pinata)
- [ ] Update on-chain Shadow Atlas root
- [ ] Test with real addresses

**Exit Criteria**:
- ✅ Production Shadow Atlas on IPFS
- ✅ On-chain root updated via governance
- ✅ Real address verification working

---

### Week 11-12: Pre-Launch (Jan 1-14, 2026)
**Goal**: Security audit preparation

**Week 11**: Audit Prep
- [ ] Code freeze
- [ ] Comprehensive documentation
- [ ] Threat model documentation
- [ ] Deployment procedures documented
- [ ] Incident response plan

**Week 12**: Final Testing
- [ ] End-to-end testing (100+ scenarios)
- [ ] Load testing (1000+ simultaneous proofs)
- [ ] Security review (internal)
- [ ] Bug bounty preparation
- [ ] Launch readiness checklist

**External Security Audit**: 4-6 weeks (parallel with Week 11-16)
- Trail of Bits or Kudelski Security
- Budget: $30k-$100k
- Findings remediation: 2-4 weeks after audit

---

## Success Metrics

### Week 3 (Proof of Concept)
- Halo2 circuits generate valid proofs
- TypeScript crypto works cross-platform
- All tests passing
- Honest documentation

### Week 6 (WASM Working)
- Browser-native proving functional
- 600ms-10s proving time verified
- Works on 95% of devices
- Performance benchmarks documented

### Week 9 (Contracts Deployed)
- Smart contracts on Scroll Sepolia
- Gas costs verified (<500k)
- End-to-end flow working
- Ready for audit

### Week 12 (Launch Ready)
- Security audit complete
- All findings addressed
- Production Shadow Atlas deployed
- Phase 1 launch approved

---

## Open Questions (Need Answers)

### 1. Shadow Atlas Architecture
**Question**: How to embed district in Merkle tree?
- Option A: District-specific subtrees (535 roots)
- Option B: District ID in first N path levels
- Option C: Separate district tree + address tree

**Need**: Design decision before Week 2

### 2. Proving Key Distribution
**Question**: Keys could be 1-2GB. How to distribute?
- IPFS (decentralized, slow first load)
- CDN (fast, centralized)
- Progressive loading (download as needed)

**Need**: Strategy before Week 4

### 3. Scroll Verifier Compatibility
**Question**: Will Scroll accept PSE Halo2 proofs?
- Do we need specific proof format?
- What's actual gas cost?
- Do we need recursive proofs for batching?

**Need**: Research before Week 7

### 4. WASM Performance Reality
**Question**: Is 600ms-10s achievable?
- What circuit size can we afford?
- Do we need GPU acceleration (WebGPU)?
- Should we offer server-side fallback?

**Need**: Benchmarks by Week 4

### 5. Economic Attack Vectors (Phase 2)
**Question**: Can the system be gamed even with perfect crypto?
- Sybil attacks via fake addresses?
- Proof replay attacks?
- Front-running on-chain verification?

**Need**: Threat model before Phase 2

---

## Communication Strategy

### Internal (Team)
- Daily standup: What's broken? What did we fix?
- End-of-week demo: Show working tests
- Brutal honesty about timeline slips

### External (Users/Community)
- **DO NOT** market as "production-ready" until Week 12
- GitHub README: Add "⚠️ EXPERIMENTAL - NOT FOR PRODUCTION USE"
- npm packages: Mark as `"private": true` until tests pass
- Blog post (optional): "How Brutalist Testing Saved Our Crypto"

### Lessons Learned
1. **Ship tests, not TODOs** - If it has a TODO, it's not done
2. **Cross-platform from Day 1** - Test Node + browsers immediately
3. **Crypto needs adversarial thinking** - Use brutalist testing early
4. **Marketing must match reality** - "Scaffolding" ≠ "Infrastructure"
5. **Placeholder is not implementation** - Fr::zero() is not a hash function

---

## Status: 🔴 CRITICAL GAPS IDENTIFIED

**Honest Assessment**: We have architectural plans and scaffolding, but critical cryptographic primitives are broken. 12 weeks minimum to production-ready code.

**Next Steps**: Execute Week 1 recovery plan. No more vaporware. Just working code with tests to prove it.
