# Shadow Atlas: Two-Tier Merkle Tree Architecture

⚠️ **HISTORICAL DESIGN DOCUMENT**

**This document describes design decisions from early development. Some architectural details (TEE proving) are outdated.**

**For current browser-native implementation, see:**
- [TECHNICAL.md](../TECHNICAL.md) - Current architecture with browser-native Halo2 + KZG proving
- [ZK-PROOF-SPEC-REVISED.md](../specs/ZK-PROOF-SPEC-REVISED.md) - Updated circuit specifications

**The two-tier Merkle tree structure remains valid. TEE proving references are superseded by browser-native WASM proving.**

---

**Date**: 2025-10-22
**Status**: Historical Reference - See TECHNICAL.md for current implementation
**Implementation Target**: Week 3-4 (Phase 1)

---

## Executive Summary

The Shadow Atlas uses a **two-tier Merkle tree structure** to efficiently prove congressional district membership while handling the unbalanced reality of 535 districts with vastly different populations.

**Key Innovation**: Instead of forcing a single balanced tree across all 190M+ addresses, we isolate each district in its own tree, then create a global tree of district roots.

---

## Architecture Overview

```
Global Structure:
├─ 535 District Trees (tier 1)
│  ├─ TX-01: ~900,000 addresses → ~20 levels
│  ├─ CA-12: ~800,000 addresses → ~20 levels
│  ├─ WY-01: ~580,000 addresses → ~19 levels
│  └─ ... (533 more)
│
└─ 1 Global Tree (tier 2)
   ├─ 535 district roots → log2(535) ≈ 10 levels
   └─ Single global root (on-chain)

Proof Structure:
├─ District proof: address → district_root (~20 hashes)
├─ Global proof: district_root → global_root (~10 hashes)
└─ Total: ~30 levels (unified path in circuit)
```

---

## Why This Wins

### ✅ Handles Unbalanced Districts
- Each district gets its own balanced tree
- TX-01 (900K) and WY-01 (580K) don't interfere
- Isolated updates: rebuild one district without touching others

### ✅ Efficient Updates
- Quarterly Census update: rebuild affected district trees
- Update global tree: re-hash ~10 levels (535 → 1)
- Most districts unchanged → minimal computation

### ✅ Single On-Chain Root
- Only `global_root` lives on-chain
- Constant gas cost (one hash verification)
- Predictable performance

### ✅ Acknowledges Reality
- We run a centralized "Proof Service" anyway
- Stop pretending IPFS distribution is decentralized
- Optimize for what actually works

---

## Detailed Specification

### Tier 1: District Trees (535 trees)

**Structure**:
```
District Tree (e.g., CA-12):
├─ Leaf: Poseidon(address)
├─ Parent: Poseidon(left_child, right_child)
├─ ... (recursive until root)
└─ Root: district_root_CA12
```

**Properties**:
- **Leaf count**: Variable (580K to 900K addresses per district)
- **Depth**: ~19-20 levels (log2(900K) ≈ 20)
- **Hash function**: Poseidon (SNARK-friendly)
- **Balancing**: Standard binary Merkle tree (pad with zero hashes if needed)

**Example**: CA-12 (800,000 addresses)
```
Level 0: 800,000 leaves
Level 1: 400,000 parents
Level 2: 200,000 parents
...
Level 19: 2 parents
Level 20: 1 root (district_root_CA12)
```

### Tier 2: Global Tree (1 tree)

**Structure**:
```
Global Tree:
├─ Leaf: district_root (from tier 1)
├─ Parent: Poseidon(left_child, right_child)
├─ ... (recursive until root)
└─ Root: global_root (on-chain)
```

**Properties**:
- **Leaf count**: 535 (one per district)
- **Depth**: log2(535) ≈ 10 levels
- **Hash function**: Poseidon (same as tier 1)
- **Balancing**: Pad to 1024 leaves (2^10) with zero hashes

**Computation**:
```
Level 0: 535 district roots + 489 zero hashes = 1024 leaves
Level 1: 512 parents
Level 2: 256 parents
...
Level 9: 2 parents
Level 10: 1 root (global_root)
```

---

## Proof Structure

### Unified Proof Path

When proving address membership in district CA-12:

**Witness (private)**:
```rust
struct DistrictMembershipWitness {
    address: String,                    // "123 Main St, San Francisco, CA 94102"
    district_id: String,                // "CA-12"

    // Tier 1: District proof
    district_path: Vec<Fr>,             // 20 sibling hashes
    district_path_indices: Vec<bool>,   // 20 direction bits (left/right)

    // Tier 2: Global proof
    global_path: Vec<Fr>,               // 10 sibling hashes
    global_path_indices: Vec<bool>,     // 10 direction bits
    district_index: u32,                // Position of CA-12 in global tree
}
```

**Public Inputs**:
```rust
struct PublicInputs {
    global_root: Fr,      // On-chain Merkle root
    district_hash: Fr,    // Poseidon(district_id) for verification
}
```

### Circuit Logic

```rust
// Tier 1: Verify address is in district tree
let leaf = Poseidon(address);
let district_root = verify_merkle_path(
    leaf,
    district_path,
    district_path_indices
);

// Tier 2: Verify district root is in global tree
let computed_global_root = verify_merkle_path(
    district_root,
    global_path,
    global_path_indices
);

// Constrain public inputs
constrain_equal(computed_global_root, public_global_root);
constrain_equal(district_root, public_district_hash);
```

**Total Proof Depth**: 20 (district) + 10 (global) = 30 levels

---

## Storage Requirements

### District Trees (535 total)

**Per District**:
- Leaves: ~800K addresses × 32 bytes = ~25 MB
- Internal nodes: ~800K hashes × 32 bytes = ~25 MB
- Total per district: ~50 MB

**All Districts**:
- 535 districts × 50 MB = ~26.75 GB
- Add 50% overhead for metadata: **~40 GB total**

### Global Tree

**Structure**:
- 535 district roots × 32 bytes = ~17 KB
- 512 internal nodes × 32 bytes = ~16 KB
- Total: **~33 KB** (negligible)

### Total Storage: ~40 GB

**Storage Strategy**:
- IPFS pinning: $720/year (40 GB × $0.015/GB/month × 12)
- Replication: 3 IPFS nodes for availability
- Cache: Store intermediate nodes for faster path generation

---

## Update Strategy

### Quarterly Census Updates

**Scenario**: Census data changes, 10 districts affected

**Process**:
1. **Download new Census data** (affected districts only)
2. **Rebuild 10 district trees**:
   - Parse addresses → hash leaves
   - Build Merkle trees bottom-up
   - Compute new district roots
3. **Update global tree**:
   - Replace 10 district roots in global tree
   - Re-hash affected paths to global root
4. **Publish to IPFS**:
   - Upload new district trees
   - Upload new global tree
   - Update on-chain global_root

**Computation**:
- Rebuild 10 districts: ~8M hashes × 10 = 80M Poseidon hashes
- Update global tree: 10 changed leaves → ~50 hashes
- Total: ~80M hashes (~10 minutes on modern server)

**Cost**:
- Compute: AWS c6a.2xlarge × 10 min = ~$0.05
- IPFS upload: 500 MB × $0.01/GB = $0.005
- On-chain update: Scroll L2 transaction = ~$0.05
- **Total: ~$0.10 per quarterly update**

---

## Circuit Constraints Analysis

### Poseidon Hash Constraints

**Per Poseidon Hash** (Halo2 implementation):
- ~320 constraints for width-2 (hash pair)
- ~400 constraints for width-3 (hash triple)

**Tier 1: District Path** (20 levels):
- 20 hashes × 320 constraints = 6,400 constraints

**Tier 2: Global Path** (10 levels):
- 10 hashes × 320 constraints = 3,200 constraints

**Other Constraints**:
- Address hash (1 Poseidon): ~400 constraints
- District hash (1 Poseidon): ~400 constraints
- Direction checks (30 binary): ~30 constraints
- Public input constraints: ~10 constraints

**Total Estimate**: ~10,440 constraints

**Circuit Size**: K=14 supports 2^14 = 16,384 constraints → **sufficient**

**Reality Check**: We originally estimated K=17 (131K constraints). Actual usage is ~10K. This gives us:
- 12x headroom for optimizations
- Room for additional features (timestamp verification, etc.)
- Faster proving time (K=14 vs K=17 = ~8x faster)

---

## Proof Service Architecture

### Centralized Proving (Phase 1)

**User Flow**:
1. User enters address in browser
2. Client queries Proof Service API: `POST /api/proof/generate`
3. Proof Service:
   - Looks up address in district tree (IPFS or cache)
   - Generates Merkle path (tier 1 + tier 2)
   - Returns witness to client
4. Client proves in TEE or browser WASM
5. Client submits proof to smart contract

**Proof Service Endpoints**:
```typescript
POST /api/proof/generate
Request: {
  address: string,
  district_id: string
}
Response: {
  witness: {
    district_path: string[],
    district_path_indices: boolean[],
    global_path: string[],
    global_path_indices: boolean[],
    district_index: number
  },
  public_inputs: {
    global_root: string,
    district_hash: string
  }
}
```

### Decentralized Option (Phase 2+)

**IPFS Distribution**:
- Full Shadow Atlas: 40 GB download (impractical for browsers)
- District-specific: 50 MB download (1-2 min on good connection)
- Merkle proof generation: Client-side JavaScript

**Progressive Loading**:
- Download district tree on demand
- Cache locally (IndexedDB)
- Generate proofs client-side

**Tradeoff**:
- Decentralized: 1-2 min initial download per district
- Centralized: <100ms API call
- **Decision**: Start centralized, add decentralized option later

---

## Implementation Checklist

### Week 3-4: Shadow Atlas Generation

**Day 1-2: Data Preparation**
- [ ] Download 2024 Census TIGER/Line files (all 535 districts)
- [ ] Parse shapefiles → extract address points
- [ ] Hash addresses with Poseidon → compute leaves
- [ ] Estimate actual leaf counts per district

**Day 3-5: District Tree Generation**
- [ ] Write Rust script: `generate_district_trees()`
- [ ] Input: Vec<Address> per district
- [ ] Output: MerkleTree struct (root + leaves + internal nodes)
- [ ] Serialize to JSON (for IPFS upload)

**Day 6-7: Global Tree Generation**
- [ ] Collect 535 district roots
- [ ] Build global Merkle tree (pad to 1024 leaves)
- [ ] Compute global root
- [ ] Upload to IPFS, get CID

### Week 5-6: Integration

**Smart Contract**:
- [ ] Store global_root on Scroll L2
- [ ] Add `updateGlobalRoot()` function (multi-sig only)
- [ ] Emit event: `GlobalRootUpdated(bytes32 newRoot, uint256 timestamp)`

**Proof Service**:
- [ ] Implement `/api/proof/generate` endpoint
- [ ] Cache district trees in Redis (hot path optimization)
- [ ] Add rate limiting (prevent DoS)

**Client SDK**:
- [ ] Add `generateWitness(address, district)` function
- [ ] Call Proof Service API
- [ ] Return structured witness for circuit

---

## Alternative Architectures Considered (And Why They Failed)

### ❌ Single Balanced Tree (190M leaves)

**Why it fails**:
- Depth: log2(190M) ≈ 28 levels
- Proof size: 28 hashes × 32 bytes = 896 bytes (acceptable)
- **Problem**: Can't handle unbalanced districts
  - TX-01 (900K) vs WY-01 (580K) = 35% size difference
  - Either waste 35% of TX-01 tree with padding, or make WY-01 unbalanced
- **Update nightmare**: Change 1 address → re-hash 28 levels

### ❌ Naive Per-District Trees (535 separate roots on-chain)

**Why it fails**:
- 535 Merkle roots × 32 bytes = 17 KB on-chain storage
- Gas cost: ~680,000 gas to store (Scroll L2: ~$3.50)
- **Verification cost**: Smart contract must store all 535 roots
  - SLOAD cost: ~2,100 gas per root lookup
  - Can't batch verify (need specific district root)
- **Quarterly updates**: 535 SSTORE operations = ~10.5M gas (~$50/update)

### ❌ IPFS-Only Distribution (No Proof Service)

**Why it fails**:
- 40 GB download for full Shadow Atlas
- 40 min download on 100 Mbps connection
- **95% user abandonment** (brutalist estimate)
- IPFS gateway dependency (centralization anyway)
- Cache invalidation nightmare (quarterly updates)

---

## Security Considerations

### Attack Vectors

**1. Forged District Membership**:
- **Attack**: Claim address in CA-12 is actually in TX-01
- **Defense**: Circuit verifies `district_root` matches `public_district_hash`
- **Result**: Proof fails (district_root from TX-01 ≠ CA-12 hash)

**2. Merkle Path Forgery**:
- **Attack**: Modify sibling hashes to fake path
- **Defense**: Circuit constrains `computed_global_root == public_global_root`
- **Result**: Proof fails (forged path produces wrong root)

**3. Proof Service Compromise**:
- **Attack**: Proof Service returns fake witness
- **Defense**: User's circuit still verifies against on-chain `global_root`
- **Result**: Proof fails on-chain (wrong public inputs)

**4. Replay Attack**:
- **Attack**: Submit same proof twice
- **Defense**: Smart contract tracks used `commitment` values (nullifier set)
- **Result**: Second submission reverted

### Trust Assumptions

**What We Trust**:
- Census data accuracy (TIGER/Line files are authoritative)
- Poseidon hash function (cryptographic assumption)
- On-chain global_root (stored in immutable contract)

**What We DON'T Trust**:
- Proof Service (can lie, proof still fails on-chain)
- IPFS gateways (can serve stale data, proof still verifies against current root)
- Client implementation (malicious client can't forge valid proof)

---

## Performance Benchmarks (Estimated)

### Proof Generation Time

**Browser WASM** (Halo2, K=14):
- M1 Mac: ~8-12 seconds
- 2020 Intel laptop: ~20-30 seconds
- Older hardware: ~45-90 seconds

**TEE Proving** (Native Rust, K=14):
- AWS Nitro Enclaves (c6a.xlarge or c6i.xlarge): ~2-5 seconds
- Cost: $0.008-0.015/proof

### Verification Time

**On-Chain** (Scroll L2):
- Halo2 proof verification: ~300K-500K gas
- Cost: $0.015-0.025 per verification
- Time: ~2-5 seconds (L2 block time)

### Witness Generation Time

**Proof Service API**:
- Cache hit (Redis): <10ms
- Cache miss (IPFS fetch): ~200-500ms
- Total round-trip: <100ms (cached), ~500ms (uncached)

---

## Next Steps

### Immediate (This Week)
- [ ] Write `generate_district_trees.rs` script
- [ ] Test with 3 sample districts (CA-12, TX-01, WY-01)
- [ ] Verify tree depths match estimates (~20 levels)
- [ ] Measure actual constraint count in circuit

### Week 3-4 (Phase 1)
- [ ] Generate full Shadow Atlas (all 535 districts)
- [ ] Upload to IPFS, get global CID
- [ ] Deploy global_root to Scroll L2 testnet
- [ ] Build Proof Service API (minimal, cached)

### Week 5-6 (Integration)
- [ ] Integrate with circuit (two-tier path verification)
- [ ] Test end-to-end: address → proof → on-chain verification
- [ ] Benchmark actual proving times (K=14 vs K=17)
- [ ] Optimize for production (caching, batching, etc.)

---

## Conclusion

The two-tier Merkle tree architecture is the **pragmatic solution** that:
- Handles real-world district imbalance
- Minimizes on-chain storage (single root)
- Enables efficient quarterly updates
- Acknowledges centralized Proof Service reality
- Provides path to decentralization (IPFS + client-side generation)

**This actually works. Everything else was vaporware.**

**Estimated timeline**: 2 weeks to working Shadow Atlas, 4 weeks to production integration.

---

**Status**: Ready for implementation. Waiting for circuit fixes (Poseidon, constraints) before generating full dataset.
