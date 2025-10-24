# Recovery Plan: From Vaporware to Working Crypto

**Date**: 2025-10-22
**Status**: Emergency response to brutalist assessment
**Timeline**: 3 weeks to working code, 6-8 weeks to production-ready

---

## Critical Issues Matrix

### 🔴 P0: Circuit-Breaking (Blocks Everything)

| Issue | File | Impact | Fix Complexity | ETA |
|-------|------|--------|----------------|-----|
| Poseidon returns zero | `poseidon_gadget.rs:30-59` | Accepts forged proofs | Medium (2-3 days) | Week 1 |
| Unconstrained public inputs | `district_membership.rs:130-173` | Bypasses ZK guarantees | Low (1 day) | Week 1 |
| No Merkle constraints | `merkle.rs:49-66` | Path verification broken | Medium (2 days) | Week 1 |
| Missing district logic | `district_membership.rs:152-169` | Can't prove district | High (4-5 days) | Week 2 |
| No proof generation | `district_membership.rs:190-220` | Can't use from WASM | High (5-6 days) | Week 2-3 |

### 🔴 P0: Runtime-Breaking (Crashes Immediately)

| Issue | File | Impact | Fix Complexity | ETA |
|-------|------|--------|----------------|-----|
| Buffer in browsers | `encryption.ts:301-322` | ReferenceError crash | Trivial (30 min) | Week 1 |
| atob() in Node | `compression.ts:47-64` | ReferenceError crash | Trivial (30 min) | Week 1 |
| Poseidon reinstantiation | `encryption.ts:317` | 300ms+ per call | Low (1 hour) | Week 1 |

### 🟡 P1: Security Issues (Works But Insecure)

| Issue | File | Impact | Fix Complexity | ETA |
|-------|------|--------|----------------|-----|
| Deterministic KDF salt | `kdf.ts:134-141` | Rainbow table vulnerable | Low (2 hours) | Week 1 |
| No AAD validation | `encryption.ts:137-174` | Accepts wrong account data | Low (1 hour) | Week 1 |
| Empty Zstd dictionary | `compression.ts:35-37` | False 90% claims | Medium (3 days) | Week 2 |
| No input validation | All crypto files | Crashes on malformed data | Medium (2 days) | Week 2 |

### 🟡 P1: Testing Gaps (No Validation)

| Issue | Impact | Fix Complexity | ETA |
|-------|--------|----------------|-----|
| Zero circuit tests | Can't validate proofs work | Medium (3 days) | Week 1-2 |
| Zero TypeScript tests | Can't validate crypto works | Low (2 days) | Week 1 |
| No integration tests | Can't validate end-to-end | Medium (3 days) | Week 2 |
| No cross-platform tests | Browser/Node issues | Low (1 day) | Week 2 |

### 🟢 P2: Documentation/Deps (Non-Blocking)

| Issue | Impact | Fix Complexity | ETA |
|-------|------|--------|----------------|-----|
| Unpinned git deps | Build instability | Trivial (1 hour) | Week 1 |
| False marketing claims | User trust damage | Low (2 hours) | Week 1 |
| Missing API docs | Developer confusion | Low (1 day) | Week 3 |
| No error handling docs | Poor DX | Low (1 day) | Week 3 |

---

## Week-by-Week Recovery Plan

### Week 1: Stop the Crashes + Core Circuit

**Goal**: Make it not crash immediately, get Poseidon working

#### Day 1-2: TypeScript Quick Wins (6 hours total)
- [ ] Fix Buffer → use `@noble/hashes` utilities (30 min)
- [ ] Fix atob() → universal base64 decode (30 min)
- [ ] Cache buildPoseidon() at module level (1 hour)
- [ ] Add random KDF salts (2 hours)
- [ ] Add AAD validation in decryptPII (1 hour)
- [ ] Pin git dependencies to commit hashes (1 hour)

**Deliverable**: TypeScript crypto that runs in both Node + browsers without crashing

#### Day 3-5: Poseidon Integration (3 days)
- [ ] Research halo2_poseidon API (examples, tests, docs)
- [ ] Implement PoseidonHasher::hash_pair() with real constraints
- [ ] Implement PoseidonHasher::hash_single() with real constraints
- [ ] Write unit tests comparing against reference implementation
- [ ] Benchmark performance (proving time impact)

**Deliverable**: Working Poseidon hash in circuits

#### Day 6-7: Public Input Constraints (2 days)
- [ ] Add layouter.constrain_instance() for merkle_root
- [ ] Add layouter.constrain_instance() for district_hash
- [ ] Write test that wrong root gets rejected
- [ ] Write test that wrong district gets rejected

**Deliverable**: Public inputs actually constrained

**Week 1 Exit Criteria**:
- ✅ TypeScript crypto runs in both Node + browsers
- ✅ Poseidon hash returns real values (not zero)
- ✅ Public inputs properly constrained
- ✅ At least 2 MockProver tests passing

---

### Week 2: Complete Circuit Logic + Testing

**Goal**: Full circuit implementation with comprehensive tests

#### Day 8-10: Merkle Gate Constraints (3 days)
- [ ] Add Poseidon constraints to Merkle gate
- [ ] Test valid 2-level Merkle tree with MockProver
- [ ] Test invalid sibling gets rejected
- [ ] Test forged path gets rejected
- [ ] Verify circuit size (K=17 sufficient?)

**Deliverable**: Working Merkle path verification

#### Day 11-13: District Verification Logic (3 days)
- [ ] Design: How to embed district in Merkle tree?
  - Option A: District-specific subtrees
  - Option B: District ID in first N levels of path
  - Option C: Separate district Merkle tree
- [ ] Implement chosen approach
- [ ] Add constraints that verify district match
- [ ] Test TX-01 can't claim CA-12
- [ ] Test with real Shadow Atlas structure (535 districts)

**Deliverable**: District membership actually proven

#### Day 14: TypeScript Test Suite (1 day)
- [ ] Set up Vitest or Jest
- [ ] Test compress → decompress round-trip
- [ ] Test encrypt → decrypt round-trip
- [ ] Test commitment generation
- [ ] Test invalid ciphertext handling
- [ ] Test cross-platform (Node + browser WASM)

**Deliverable**: Comprehensive TypeScript test coverage

**Week 2 Exit Criteria**:
- ✅ Complete circuit with all constraints
- ✅ MockProver tests for valid + invalid cases
- ✅ TypeScript crypto test suite (>80% coverage)
- ✅ District verification working

---

### Week 3: Proof Generation + Integration

**Goal**: End-to-end proof generation and verification

#### Day 15-17: Proof Generation (3 days)
- [ ] Research Halo2 proving key generation
- [ ] Implement generate_proof() with actual Halo2 prover
- [ ] Handle universal parameters (KZG or IPA)
- [ ] Implement proof serialization
- [ ] Benchmark: proving time, memory usage, proof size

**Deliverable**: Real proof generation (not Err())

#### Day 18-19: Proof Verification (2 days)
- [ ] Implement verify_proof() with Halo2 verifier
- [ ] Handle verification key loading
- [ ] Implement proof deserialization
- [ ] Test proof round-trip (generate → verify)
- [ ] Benchmark: verification time

**Deliverable**: Real proof verification

#### Day 20-21: Integration + Cleanup (2 days)
- [ ] WASM build with wasm-pack
- [ ] Test WASM proof generation in browser
- [ ] Add proper error types (no more string errors)
- [ ] Add input validation (path length, hex format, etc.)
- [ ] Update README with actual capabilities (remove lies)
- [ ] Document actual performance numbers

**Deliverable**: Working end-to-end system

**Week 3 Exit Criteria**:
- ✅ Proof generation works
- ✅ Proof verification works
- ✅ WASM build compiles
- ✅ All tests passing (Rust + TypeScript)
- ✅ Honest documentation

---

## Additional Issues We Might Be Missing

### Potential Gaps Not Caught by Brutalists

1. **Shadow Atlas Integration**
   - How do we actually build the 535-district Merkle tree?
   - What's the leaf format? (address hash? district-specific?)
   - Where does the tree live? (IPFS? On-chain?)
   - How do we update quarterly without breaking proofs?

2. **Key Management**
   - Where are proving/verifying keys stored?
   - How large are they? (Could be GB-scale)
   - How do users download them? (IPFS? CDN?)
   - Cache strategy for browser proving?

3. **WASM Performance**
   - 4-6 second claim based on what hardware?
   - Do we need Web Workers to avoid UI freeze?
   - SharedArrayBuffer requirements (COOP/COEP headers)?
   - Memory limits (Chrome: 4GB, Firefox: 2GB)?

4. **Scroll L2 Integration**
   - Are our proofs compatible with Scroll's verifier?
   - What's the actual gas cost per verification?
   - Do we need Scroll-specific proof format?
   - Testnet deployment strategy?

5. **Error Handling Patterns**
   - What happens if proving runs out of memory?
   - How do we handle proving key download failures?
   - Circuit constraint violations - user-friendly errors?
   - Network failures during compression/encryption?

6. **Security Audit Prep**
   - Code freeze requirements before audit?
   - Which auditor? (Kudelski, Trail of Bits, other?)
   - Budget for audit? ($30k-$100k typical)
   - Timeline for fixing audit findings?

---

## Missing Feedback Areas (Should We Ask Brutalists?)

### 1. Shadow Atlas Architecture
**Question**: We haven't designed the actual 535-district Merkle tree structure. Should we:
- Use district-specific subtrees?
- Embed district IDs in path levels?
- Use separate district tree + address tree?

**Ask Brutalists**: "How should we structure a Merkle tree for 535 congressional districts with variable addresses per district?"

### 2. Key Distribution Strategy
**Question**: Proving keys could be 1-2GB. How do we distribute them?
- IPFS (decentralized but slow first load)
- CDN (fast but centralized)
- Progressive loading (download as needed)

**Ask Brutalists**: "What's the least-bad way to distribute multi-GB proving keys to browser users?"

### 3. WASM Performance Reality Check
**Question**: Is 4-6 seconds achievable in browsers?
- What circuit size can we actually afford?
- Do we need GPU acceleration (WebGPU)?
- Should we offer server-side proving option?

**Ask Brutalists**: "Are we delusional about browser WASM proving performance for K=17 circuits?"

### 4. Scroll Verifier Compatibility
**Question**: We assumed Scroll can verify our Halo2 proofs. Is that true?
- Do we need specific proof format?
- What's the actual verification gas cost?
- Do we need recursive proofs for batching?

**Ask Brutalists**: "Will Scroll's verifier contracts actually accept PSE Halo2 proofs, or are we assuming magic?"

### 5. Economic Attack Vectors
**Question**: Even with working crypto, can the system be gamed?
- Sybil attacks via fake addresses?
- Proof replay attacks?
- Front-running on-chain verification?

**Ask Brutalists**: "What economic attack vectors exist even if the crypto is perfect?"

---

## Revised Todo List (Priority Order)

### Immediate (This Week - P0 Blockers)
1. [x] Acknowledge failures (this doc)
2. [ ] Fix Buffer → `@noble/hashes` (30 min)
3. [ ] Fix atob() → universal (30 min)
4. [ ] Cache buildPoseidon() (1 hour)
5. [ ] Pin git dependencies (1 hour)
6. [ ] Integrate halo2_poseidon (3 days)
7. [ ] Add public input constraints (2 days)

### Critical (Week 1-2 - P0 Circuit)
8. [ ] Add Merkle gate Poseidon constraints (3 days)
9. [ ] Implement district verification (3 days)
10. [ ] Write MockProver test suite (2 days)
11. [ ] Write TypeScript test suite (1 day)

### Essential (Week 2-3 - P0 Integration)
12. [ ] Implement generate_proof() (3 days)
13. [ ] Implement verify_proof() (2 days)
14. [ ] WASM build + browser test (2 days)
15. [ ] Add proper error types (1 day)

### Important (Week 3-4 - P1 Quality)
16. [ ] Random KDF salts (2 hours)
17. [ ] Input validation (2 days)
18. [ ] Train Zstd dictionary OR remove claims (3 days)
19. [ ] Integration tests (2 days)
20. [ ] Update documentation (2 days)

### Future (Post-Recovery - P2)
21. [ ] Shadow Atlas design + implementation
22. [ ] Key distribution strategy
23. [ ] Scroll verifier integration testing
24. [ ] Security audit preparation
25. [ ] Performance benchmarking suite

---

## Success Metrics

### Week 1 Definition of Done
- TypeScript crypto runs without crashes (Node + browser)
- Poseidon hash returns non-zero values
- At least 2 MockProver tests passing
- Public inputs properly constrained

### Week 2 Definition of Done
- Complete circuit with all constraints implemented
- 5+ MockProver tests (valid + invalid cases)
- TypeScript test suite with >80% coverage
- District verification working

### Week 3 Definition of Done
- Proof generation works (not stub)
- Proof verification works (round-trip success)
- WASM compiles and runs in browser
- All tests passing (Rust + TypeScript)
- Honest documentation (no false claims)

### Production-Ready Definition (6-8 weeks)
- Professional security audit completed
- All audit findings addressed
- Performance benchmarks documented
- Shadow Atlas integrated
- Scroll testnet deployment verified
- Developer documentation complete
- Error handling comprehensive

---

## Communication Strategy

### Internal (Team)
- Daily standup: What's broken? What did we fix?
- End-of-week demo: Show working tests
- Brutal honesty about timeline slips

### External (Users/Community)
- **DO NOT** market as "production-ready" until Week 3 complete
- GitHub README: Add "⚠️ EXPERIMENTAL - NOT FOR PRODUCTION USE"
- npm packages: Add deprecation warning pointing to this status
- Blog post (optional): "How Brutalist Testing Saved Our Crypto"

### Lessons for Future
1. **Ship tests, not TODOs** - If it has a TODO, it's not done
2. **Cross-platform from Day 1** - Test in both Node + browsers immediately
3. **Crypto needs adversarial thinking** - Use brutalist testing early
4. **Marketing must match reality** - "Scaffolding" ≠ "Infrastructure"
5. **Placeholder is not implementation** - Fr::zero() is not a hash function

---

## Questions for Brutalists (Round 2)

Should we bring them back to review:

1. **Shadow Atlas Architecture** - "How should we structure the 535-district Merkle tree?"
2. **Key Distribution** - "What's the least-bad way to deliver GB-scale proving keys?"
3. **WASM Performance** - "Are we delusional about 4-6 second browser proving?"
4. **Scroll Integration** - "Will Scroll actually accept our Halo2 proofs?"
5. **Economic Attacks** - "What can go wrong even if crypto is perfect?"

---

**Status**: We have a plan. Now we execute. No more vaporware, no more lies. Just working code with tests to prove it.
