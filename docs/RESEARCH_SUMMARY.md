# VOTER Protocol: Cryptographic Research Summary

**Last Updated**: 2025-11-04
**Status**: Phase 1 Production Ready - Ship Halo2

---

## Executive Summary

**Decision**: Deploy Halo2 (SHPLONK/KZG) commitments for Phase 1 (Groth16 references are comparative only).

**Why**: Known performance (8-15s mobile), $0 migration cost, proven stability, immune to capacity conjecture issues.

**When to Reconsider**: Quantum threat <5 years, or mobile STARK benchmarks prove 2× improvement over Halo2.

---

## Security Analysis (Complete ✅)

### P0 Critical Issues (All Resolved)

**Issue 1: Trusted Setup Verification** (`packages/crypto/circuits/src/prover.rs:223`)
- **Risk**: Supply-chain attack on KZG parameters
- **Fix**: Blake2b hash verification (`CANONICAL_HASH_K14`)
- **Hash**: `5d56001304a118d53e48bb5b512c125497d58f16af5c115ac6b2360fe515f77f9c897d824b8824c0f2aff0a65b6f12c1cd7725c5a3631aade5731acf3f869ed8`
- **Source**: Axiom challenge_0085 ceremony (141,416 participants)

**Issue 2: MEV Front-Running** (`contracts/src/DistrictGate.sol`)
- **Risk**: Bots copy proofs, front-run with higher gas, steal rewards
- **Fix**: Deprecated `verifyAndAuthorize()` and `verifyBatch()`
- **Migration**: Use `verifyAndAuthorizeWithSignature()` (EIP-712 binding)
- **Result**: Rewards bound to signer, not submitter

**Issue 3: Emergency Circuit Breaker** (`contracts/src/DistrictGate.sol`)
- **Risk**: No way to halt operations during critical vulnerability
- **Fix**: Added `Pausable` inheritance (OpenZeppelin)
- **Functions**: `pause()` / `unpause()` (governance-only)
- **Protection**: `whenNotPaused` modifier on verification functions

**Verification**: 8/8 integration tests pass, Trail of Bits audited Halo2 implementation.

---

## ZK Proof System Decision

### Chosen: Halo2 PLONK with KZG Commitments

**Parameters**:
- Field: BN254 scalar field (~2²⁵⁴)
- Circuit: K=14 (16,384 rows, 8 columns, 117,473 cells)
- Proof Size: 384-512 bytes (SHPLONK)
- Verification: 300-400k gas on Scroll L2 (< $0.01 typical as of 2025‑11‑15; conservative $0.0001–$0.005)
- Trusted Setup: Ethereum KZG ceremony (no custom setup)

**Mobile Performance** (browser-native WASM, proven):
- Desktop (Intel i7): 3-5s
- High-end mobile (Snapdragon 8 Gen 2): 5-8s
- Mid-range mobile (Snapdragon 7 Gen 1): 8-15s
- Low-end mobile (Snapdragon 4 Gen 1): 15-25s

**Security**:
- Trail of Bits audited
- Capacity conjecture immune (KZG-based, not FRI)
- Quantum vulnerable (5-10 year timeline acceptable)

---

## STARK Research Findings

### Why Not STARK for Phase 1?

**TL;DR**: No evidence STARKs are better on mobile. All claims based on desktop benchmarks.

### Four-Phase Research (200+ pages)

**Phase 1: Initial Exploration** (Findings: Inconclusive)
- Evaluated Stwo, SP1, RISC Zero, Miden, Plonky3
- Estimated migration: $495k, 11.5-year break-even
- Conclusion: Stay with Halo2

**Phase 2: Capacity Conjecture** (Findings: Halo2 Immune)
- Diamond & Gruen 2025: STARK security parameters need adjustment
- Halo2 unaffected (KZG-based, not Reed-Solomon proximity)
- See: [STARK_CAPACITY_CONJECTURE.md](STARK_CAPACITY_CONJECTURE.md)

**Phase 3: Brutalist Critique** (Findings: Corrected Costs)
- Initial research missed Plonky3 and hybrid architectures
- Migration costs corrected: $60-250k (not $495k)
- WebGPU acceleration feasible: 4-7s (from 8-15s)
- Quantum timeline: 2030-2035 (Q-Day)

**Phase 4: Mobile Reality Check** (Findings: CRITICAL)
- **Zero STARK systems publish mobile browser benchmarks**
- Stwo claims "instant proving on phones" but no data exists
- Desktop demos only (M3 Pro: 0.5-1s for Ethereum state root)
- Extrapolation uncertainty: Could be 1s or 20s on mobile
- See: [STARK_MOBILE_BENCHMARKS.md](STARK_MOBILE_BENCHMARKS.md)

### Final Cost-Benefit Analysis

**Halo2** (known):
- Performance: 8-15s mobile (measured)
- Cost: $0 migration
- Timeline: Deploy now
- Risk: Low (proven technology)

**Stwo/STARK** (unknown):
- Performance: 1-20s mobile? (no benchmarks)
- Cost: $130-250k migration
- Timeline: 5-7 months delay
- Risk: High (unproven on mobile)

**Verdict**: Known technology beats unknown speculation.

---

## Capacity Conjecture Deep Dive

### What Is It?

For Reed-Solomon codes used in FRI (Fast Reed-Solomon Interactive Oracle Proofs):
- **Old conjecture**: Probability random word is "close" to code bounded by capacity
- **2025 finding**: Bound tighter in edge cases (Diamond & Gruen, IACR 2025/2010)
- **Practical impact**: FRI-based STARKs need +10-20% more queries for same security

### Why Halo2 Is Immune

**FRI/STARKs** (affected):
```
Soundness: Verifier samples random queries from Reed-Solomon codeword
Security: Depends on code rate (ρ), proximity gap (η), query count (t)
Impact: Need 10-20% more queries for 128-bit security
```

**KZG/PLONK** (not affected):
```
Soundness: Verifier checks pairing equation e(C - [y]₁, [1]₂) = e([π]₁, [s-z]₂)
Security: q-SDH assumption (Strong Diffie-Hellman over BN254)
Impact: ZERO - No Reed-Solomon codes, no proximity testing
```

**Conclusion**: Capacity conjecture is irrelevant to KZG-based systems.

**Reference**: See [STARK_CAPACITY_CONJECTURE.md](STARK_CAPACITY_CONJECTURE.md) for technical details.

---

## Mobile Proving Reality

### The Benchmarks Gap

**Industry Pattern**: Desktop performance + mobile claims = vaporware

| System | Desktop Benchmarks | Mobile Browser Benchmarks |
|--------|-------------------|--------------------------|
| Halo2 | ✅ 3-5s (proven) | ✅ 8-15s (proven) |
| Stwo | ✅ 0.5-1s (M3 Pro) | ❌ None published |
| SP1 | ✅ Extensive | ❌ None published |
| RISC Zero | ✅ Extensive | ❌ None published |
| Plonky3 | ✅ Extensive | ❌ None published |

**Stwo Claims**:
- "Instant proving on phones, browsers, and laptops"
- "Lightning-fast, client-side execution"
- "Expected WebGPU and WASM support" (coming soon)

**Stwo Evidence**:
- Desktop: 600,000 Poseidon hashes/sec (M3 Pro, native Rust)
- Browser: Fibonacci demo exists (no performance data)
- Mobile: **ZERO benchmarks**

**Extrapolation Problem**:
```
Desktop (native): 0.5-1s
→ Desktop (WASM): 1-2s (2× WASM overhead)
→ Mobile (WASM): 2-10s (2-5× mobile penalty)

Result: Wide uncertainty (could be better OR worse than Halo2)
```

**Decision Impact**: Cannot justify $130-250k + 5-7 months based on speculation.

**Reference**: See [STARK_MOBILE_BENCHMARKS.md](STARK_MOBILE_BENCHMARKS.md) for detailed analysis.

---

## Quantum Threat Timeline

### Current Assessment (2024-2025 Data)

**Breakthroughs**:
- Google Willow (Dec 2024): 105 qubits, error correction milestone
- IBM Condor (2023): 1,121 qubits
- IBM Roadmap: 100,000 qubits by 2033

**Q-Day Estimate**: 2030-2035 (5-year acceleration from 2020 projections)

**Cryptographic Impact**:
- Shor's algorithm breaks discrete log (BN254, ECDSA)
- Halo2 KZG vulnerable (pairing-based)
- STARKs secure (hash-based, quantum-resistant)

**NSA CNSA 2.0 Timeline**:
- 2027: New NSS systems must be PQC
- 2030: ECC deprecated for NSS
- 2035: ECC disallowed for NSS

**Important**: NSS = National Security Systems (classified), not civic tech.

### Implications for VOTER

**Threat Window**: 5-10 years before migration necessary

**Migration Plan**:
- **Monitor**: NIST advisories, quantum milestones, BN254 security downgrades
- **Trigger**: Quantum threat <5 years OR government contracts require PQC
- **Action**: Migrate to Stwo Circle STARK + Halo2 recursion
- **Cost**: $130-250k (justified by security requirement)
- **Timeline**: 5-7 months

**Current Status**: No urgency, monitor and plan.

---

## WebGPU Acceleration

### Feasibility (Phase 1.5 Optimization)

**Performance Gains** (proven on desktop):
- ZPrize 2023 winners: 8-10× speedup with GPU
- Desktop Halo2: 3-5s → 0.5-1s (GPU-accelerated)
- Proving operations parallelizable (MSM, FFT)

**Mobile Feasibility**:
- Desktop: 3-4s achievable (proven)
- High-end mobile: 4-5s possible
- Mid-range mobile: 5-8s realistic (thermal throttling)
- Expected: 8-15s → 4-7s (50% improvement)

**Implementation**:
- Browser support: 60-70% (Chrome/Edge stable, Firefox/Safari beta)
- Cost: $65-150k
- Timeline: 3-6 months
- Risks: Thermal throttling, battery drain, browser compatibility

**Recommendation**: Premature for Phase 1, evaluate in Phase 1.5 if user complaints >30%.

---

## Phase 1.5 Optimization Triggers

### Data-Driven Decision Framework

**Trigger 1: Proving Time Complaints > 30%**
- **Symptom**: Users complain or abandon during proof generation
- **Solution**: WebGPU acceleration ($65-150k, 3-6 months)
- **Expected**: 8-15s → 4-7s
- **Decision**: Justified by user retention

**Trigger 2: Gas Costs > $1M/year**
- **Symptom**: Annual verification costs exceed $1M
- **Solution**: SP1 hybrid (Plonky3 STARK + Groth16, $60-120k, 3-5 months)
- **Expected**: 300-400k gas → 270-300k gas
- **Decision**: Justified by cost savings

**Trigger 3: Quantum Threat < 5 Years**
- **Symptom**: NIST/NSA advisory or quantum breakthrough
- **Solution**: Stwo Circle STARK + Halo2 recursion ($130-250k, 5-7 months)
- **Expected**: Post-quantum security, 270-350k gas
- **Decision**: Mandatory for security

**Default Path** (85% probability): Stay with Halo2, no migration needed.

---

## Key Technical Concepts

### Halo2 PLONK

**Polynomial Commitment**: KZG (Kate-Zaverucha-Goldberg)
- Commit: C = [P(s)]₁ where s is from trusted setup
- Open: Prove P(z) = y for random challenge z
- Verify: Pairing check e(C - [y]₁, [1]₂) = e([π]₁, [s-z]₂)
- Security: q-SDH assumption (computational hardness)

**Circuit**: Custom gates + lookup tables
- Advice columns: Private witness data
- Instance columns: Public inputs
- Selectors: Enable/disable gates
- Lookups: Range checks, bitwise ops

### Circle STARK (Stwo)

**Polynomial Commitment**: FRI (Fast Reed-Solomon IOP)
- Encode polynomial as Reed-Solomon codeword
- Commit via Merkle tree
- Prover reveals random samples
- Verifier checks proximity to valid codeword
- Security: Information-theoretic (no trusted setup)

**Field**: M31 (Mersenne prime 2³¹-1)
- CPU-friendly (32-bit arithmetic)
- AVX2/NEON SIMD acceleration
- Degree-4 extension for security (~2¹²⁴ effective)

### Hybrid STARK→SNARK

**Architecture**: STARK proving + SNARK verification
- Prover: Generate STARK proof (fast, large)
- Recursion: Wrap STARK in SNARK proof (slow, small)
- Verifier: Verify SNARK on-chain (constant cost)
- Trade-off: Prover complexity for verifier efficiency

**Production Examples**:
- Polygon zkEVM: STARK → Groth16
- Scroll L2: STARK → SNARK (our settlement layer!)
- SP1: Plonky3 → Groth16 (270-300k gas)

---

## Cost Summary

### Phase 1 (Halo2)
- Migration: $0 (already implemented)
- Timeline: 0 months (deploy now)
- Gas: 300-400k (~$0.005-$0.05 on Scroll L2)
- Performance: 8-15s mid-range mobile (acceptable)

### Phase 1.5 Optimizations (If Triggered)
- WebGPU: $65-150k, 3-6 months, 8-15s → 4-7s
- SP1 hybrid: $60-120k, 3-5 months, 300k → 270k gas
- Stwo STARK: $130-250k, 5-7 months, post-quantum

### Break-Even Analysis
- WebGPU: Justified if complaints >30% (UX improvement)
- SP1: Justified if gas >$1M/year (cost reduction)
- STARK: Justified if quantum <5 years (security requirement)

**Expected Outcome**: Stay with Halo2, no migration needed.

---

## References

### Internal Documents
- [STARK Capacity Conjecture Technical Analysis](STARK_CAPACITY_CONJECTURE.md)
- [STARK Mobile Benchmarks Gap Analysis](STARK_MOBILE_BENCHMARKS.md)
- [Security Threat Model](../SECURITY.md)
- [Technical Implementation Details](../TECHNICAL.md)
- [System Architecture](../ARCHITECTURE.md)

### External Research
- **Diamond & Gruen (2025)**: "On the Distribution of the Distances of Random Words" (IACR 2025/2010)
- **Brakensiek et al. (2023)**: "Capacity Conjecture Proven" (STOC 2023)
- **Ben-Sasson et al. (2018)**: "Fast Reed-Solomon IOP of Proximity" (ICALP 2018)
- **Stwo Announcement**: https://starkware.co/blog/s-two-prover/
- **NSA CNSA 2.0**: Quantum transition timeline

### Academic Sources
See [SOURCES.md](../SOURCES.md) for complete bibliography (64 citations).

---

## Conclusion

After 200+ pages of research including adversarial critique and mobile reality check:

**Ship Halo2 for Phase 1.**

- **Known performance** beats unknown speculation
- **$0 cost** beats $130-250k speculative investment
- **Proven stability** beats unproven claims
- **Immediate deployment** beats 5-7 month delay

**Migrate only when justified by evidence**: Quantum threat, proven mobile superiority, or operational data.

---

**Last Updated**: 2025-11-04
**Status**: Production Ready - Deploy to Scroll L2 Mainnet
