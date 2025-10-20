# Hybrid GKR + SNARK Implementation Plan

**Zero-Knowledge District Verification Without Trusted Setup**

**Status:** Phase 1 Critical Path
**Updated:** 2025-10-20
**Protocol Sources:**
- [Vitalik Buterin, "The GKR Protocol", October 19, 2025](https://vitalik.eth.limo/general/2025/10/19/gkr.html)
- [Ethereum Research: Using GKR inside a SNARK](https://ethresear.ch/t/using-gkr-inside-a-snark-to-reduce-the-cost-of-hash-verification-down-to-3-constraints/7550/)

-----

## Executive Summary

VOTER Protocol uses a **hybrid architecture: GKR (Goldwasser-Kalai-Rothblum) for efficient proving, wrapped in a SNARK for on-chain verification**. This combines GKR's prover efficiency (2M Poseidon hashes/second on laptops) with SNARK's compact proofs suitable for blockchain verification.

**Why Hybrid:**
- **GKR limitation**: Interactive protocol, not suitable for direct blockchain verification
- **GKR strength**: Extremely efficient prover, optimal for Merkle tree circuits
- **SNARK wrapper**: Converts GKR's interactive proof to compact non-interactive proof
- **Result**: 8-12s browser proving, 80-120k gas on-chain verification, 256-384 byte proofs

**Key Advantages Over Pure Groth16:**
- ✅ **No trusted setup** - GKR eliminates ceremony risk entirely
- ✅ **Transparent** - Anyone can verify without trusting setup parameters
- ✅ **Efficient prover** - GKR's linear prover time vs Groth16's FFT-based proving
- ✅ **Competitive gas** - SNARK wrapper achieves 80-120k gas (vs Groth16's 50-80k)
- ✅ **Field agnostic** - GKR works on any finite field (no FFT required)

**Performance Targets:**
- **GKR proving** (Step 1): 5-8 seconds (inner proof)
- **SNARK wrapping** (Step 2): 2-3 seconds (outer proof)
- **Total browser time**: 8-12 seconds
- **Proof size**: 256-384 bytes (SNARK output)
- **On-chain verification gas**: 80-120k gas
- **Milestone Gates:** If >15s proving OR >150k gas → evaluate pure Groth16

-----

## Technical Architecture

### Hybrid Architecture Overview

**Two-Layer Proving System:**

1. **Inner Layer (GKR)**: Efficient interactive proof of Merkle membership
   - Prover generates GKR proof (5-8 seconds)
   - Verifier can check correctness through sumcheck protocol
   - Interactive: requires back-and-forth communication

2. **Outer Layer (SNARK)**: Compact non-interactive wrapper
   - SNARK circuit proves: "I correctly verified a GKR proof with these public inputs"
   - SNARK proof generated (2-3 seconds)
   - Non-interactive: single proof submitted on-chain
   - On-chain verifier checks SNARK (80-120k gas)

**Why This Works:**
- GKR's interaction happens client-side (browser acts as both prover and verifier)
- SNARK wraps the verification, not the original computation
- Result: Blockchain sees compact SNARK proof, benefits from GKR's efficient proving

**Core components:**
1. **Circuit representation** - Computational graph of district membership check
2. **Witness** - Private inputs (full address, Merkle proof, encryption keys)
3. **Public inputs** - Shadow Atlas root, district hash, nullifier, commit hash
4. **Sumcheck protocol** - Iterative polynomial evaluation reducing verification complexity
5. **Fiat-Shamir** - Convert interactive proof to non-interactive via hash-based randomness

### Shadow Atlas (Merkle Tree Structure)

**Global registry of electoral districts:**

```
Shadow Atlas Root (on-chain)
├── State Level (50 states)
│   ├── Congressional Districts (435 total)
│   │   ├── TX-18 (Merkle leaf)
│   │   │   └── Hash(district_id + valid_zipcodes + boundaries)
│   │   ├── CA-12 (Merkle leaf)
│   │   └── ...
│   └── State Senate Districts
└── Local Jurisdictions
```

**Merkle proof structure:**
- Depth: ~12 layers (435 congressional + state/local)
- Sister nodes: 12 hashes (384 bytes)
- Compression: Poseidon hash (SNARK-friendly)

**Update mechanism:**
- Quarterly updates from [Census.gov API](https://api.census.gov)
- IPFS pinning for decentralized availability ($5/month)
- On-chain root update via multisig (security council)
- Historical roots archived (allows proof verification for past boundaries)

### Circuit Design

**GKR circuit for "Prove I live in TX-18" computation:**

```rust
use expander_compiler::frontend::*;

// Define witness structure (private inputs)
pub struct ShadowAtlasWitness {
    pub address: String,              // User's full address (private)
    pub district_id: String,          // e.g., "TX-18" (private)
    pub merkle_proof: MerkleProof,    // Sister nodes for Merkle path (private)
    pub encryption_nonce: FieldElement, // For commitment scheme (private)
    pub sovereign_key_hash: FieldElement, // Bind proof to wallet (private)
}

// Public inputs (visible on-chain)
pub struct PublicInputs {
    pub shadow_atlas_root: FieldElement,  // Current Shadow Atlas Merkle root
    pub district_hash: FieldElement,      // Hash(district_id) - reveals district
    pub nullifier: FieldElement,          // Prevent double-verification with same identity
    pub commit_hash: FieldElement,        // Commitment to private inputs
}

// Build GKR circuit for district membership
pub fn build_district_proof_circuit(merkle_depth: usize) -> Circuit {
    let circuit = Circuit::new();

    // Layer 0: Hash district_id to district_hash (public output)
    let district_hash_gate = circuit.add_gate(PoseidonHash::new(1));
    circuit.add_wire(witness.district_id, district_hash_gate.input(0));
    circuit.add_wire(district_hash_gate.output, public_inputs.district_hash);

    // Layer 1: Compute Merkle leaf = Hash(district_id + boundaries)
    let leaf_gate = circuit.add_gate(PoseidonHash::new(2));
    circuit.add_wire(witness.district_id, leaf_gate.input(0));
    circuit.add_wire(witness.boundary_data, leaf_gate.input(1));

    // Layers 2-N: Merkle tree verification (N = merkle_depth)
    let mut current_hash = leaf_gate.output;
    for level in 0..merkle_depth {
        let merkle_layer = circuit.add_gate(MerkleLayer::new(level));
        circuit.add_wire(current_hash, merkle_layer.input(0));
        circuit.add_wire(witness.merkle_proof[level], merkle_layer.input(1));
        current_hash = merkle_layer.output;
    }

    // Final constraint: Merkle root matches Shadow Atlas root (public)
    circuit.constrain(current_hash, public_inputs.shadow_atlas_root);

    // Nullifier generation: Hash(identity_hash + district_id)
    let nullifier_gate = circuit.add_gate(PoseidonHash::new(2));
    circuit.add_wire(witness.identity_hash, nullifier_gate.input(0));
    circuit.add_wire(witness.district_id, nullifier_gate.input(1));
    circuit.constrain(nullifier_gate.output, public_inputs.nullifier);

    // Commitment scheme: Hash(address + district_id + nonce)
    let commit_gate = circuit.add_gate(PoseidonHash::new(3));
    circuit.add_wire(witness.address, commit_gate.input(0));
    circuit.add_wire(witness.district_id, commit_gate.input(1));
    circuit.add_wire(witness.encryption_nonce, commit_gate.input(2));
    circuit.constrain(commit_gate.output, public_inputs.commit_hash);

    circuit
}
```

**Circuit complexity:**
- Gates: ~150 (12 Merkle layers + hashing + constraints)
- Wires: ~300 (connections between gates)
- Public inputs: 4 (Shadow Atlas root, district hash, nullifier, commit hash)
- Private inputs: 6 (address, district ID, Merkle proof, nonce, key hash)

### Proof Generation (Browser WASM)

**Frontend implementation:**

```typescript
// src/lib/core/zk/gkr-prover.ts
import { GKRProver } from '@polyhedra-network/expander-wasm';

export async function generateDistrictProof(
  address: string,
  district: string
): Promise<GKRProof> {
  // 1. Fetch Shadow Atlas root from blockchain
  const shadowAtlasRoot = await fetchShadowAtlasRoot();

  // 2. Lookup district in Shadow Atlas, get Merkle proof
  const merkleProof = await fetchMerkleProof(district);

  // 3. Generate witness (private inputs)
  const witness: ShadowAtlasWitness = {
    address: address,
    district_id: district,
    merkle_proof: merkleProof.siblings, // Sister nodes
    encryption_nonce: generateNonce(),
    sovereign_key_hash: await hashWalletAddress()
  };

  // 4. Compute public inputs
  const publicInputs: PublicInputs = {
    shadow_atlas_root: shadowAtlasRoot,
    district_hash: poseidonHash(district),
    nullifier: generateNullifier(witness.identity_hash, district),
    commit_hash: poseidonHash(address, district, witness.encryption_nonce)
  };

  // 5. Initialize GKR prover (WASM, runs in browser)
  const prover = await GKRProver.initialize({
    circuit: 'district-membership-v1',
    witness: witness,
    publicInputs: publicInputs
  });

  // 6. Generate proof (8-10 seconds on modern devices)
  const startTime = performance.now();
  const proof = await prover.prove();
  const provingTime = performance.now() - startTime;

  // 7. Milestone Gate Check
  if (provingTime > 15000) { // >15 seconds
    console.warn(`GKR proving too slow: ${provingTime}ms. Consider Groth16 pivot.`);
    // Track metric for engineering review
    trackProvingPerformance({ protocol: 'GKR', time: provingTime, status: 'SLOW' });
  }

  return {
    proof: proof.toBytes(),
    publicInputs: publicInputs,
    provingTime: provingTime,
    protocol: 'GKR-v1'
  };
}
```

**Performance optimization:**
- **Web Workers** - Proof generation in background thread (no UI freeze)
- **WASM binary caching** - IndexedDB persistence (avoid re-download)
- **Progressive disclosure** - Show "Generating proof (30% complete)" updates
- **Precomputation** - Shadow Atlas Merkle proof cached locally (reduce lookup latency)

### On-Chain Verification (Solidity)

**Smart contract implementation:**

```solidity
// contracts/DistrictGate.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@polyhedra-network/expander-solidity/contracts/GKRVerifier.sol";

/// @title DistrictGate - GKR-based district membership verification
/// @notice Verifies zero-knowledge proofs that user lives in claimed district
contract DistrictGate {
    // Shadow Atlas Merkle root (updated quarterly)
    bytes32 public shadowAtlasRoot;

    // Security council multisig (updates Shadow Atlas root)
    address public securityCouncil;

    // GKR verifier library (external deployment for gas savings)
    GKRVerifier public immutable gkrVerifier;

    // Nullifier registry (prevent duplicate verifications)
    mapping(bytes32 => bool) public nullifiersUsed;

    // Historical Shadow Atlas roots (allows proofs with old boundaries)
    mapping(bytes32 => bool) public validShadowAtlasRoots;

    // Events
    event DistrictVerified(bytes32 indexed districtHash, bytes32 nullifier, uint256 gasUsed);
    event ShadowAtlasUpdated(bytes32 oldRoot, bytes32 newRoot, uint256 timestamp);

    constructor(address _gkrVerifier, address _securityCouncil, bytes32 _initialRoot) {
        gkrVerifier = GKRVerifier(_gkrVerifier);
        securityCouncil = _securityCouncil;
        shadowAtlasRoot = _initialRoot;
        validShadowAtlasRoots[_initialRoot] = true;
    }

    /// @notice Verify GKR proof of district membership
    /// @param proof GKR proof bytes (2-4KB)
    /// @param publicInputs [shadowAtlasRoot, districtHash, nullifier, commitHash]
    /// @return verified True if proof is valid
    function verifyDistrictMembership(
        bytes calldata proof,
        bytes32[4] calldata publicInputs
    ) external returns (bool verified) {
        uint256 gasStart = gasleft();

        bytes32 _shadowAtlasRoot = publicInputs[0];
        bytes32 districtHash = publicInputs[1];
        bytes32 nullifier = publicInputs[2];
        bytes32 commitHash = publicInputs[3];

        // 1. Verify Shadow Atlas root is current or historical
        require(
            _shadowAtlasRoot == shadowAtlasRoot || validShadowAtlasRoots[_shadowAtlasRoot],
            "Invalid Shadow Atlas root"
        );

        // 2. Verify nullifier not already used (prevent double-verification)
        require(!nullifiersUsed[nullifier], "Nullifier already used");

        // 3. Verify GKR proof using external verifier
        verified = gkrVerifier.verify(
            proof,
            publicInputs,
            circuitId: keccak256("district-membership-v1")
        );
        require(verified, "Invalid GKR proof");

        // 4. Mark nullifier as used
        nullifiersUsed[nullifier] = true;

        // 5. Calculate gas used and emit event
        uint256 gasUsed = gasStart - gasleft();
        emit DistrictVerified(districtHash, nullifier, gasUsed);

        // 6. Milestone Gate Check
        if (gasUsed > 250_000) {
            // Log warning for engineering review
            emit GasMilestoneExceeded(gasUsed, 250_000);
        }

        return verified;
    }

    /// @notice Update Shadow Atlas root (quarterly, security council only)
    function updateShadowAtlasRoot(bytes32 newRoot) external {
        require(msg.sender == securityCouncil, "Only security council");

        bytes32 oldRoot = shadowAtlasRoot;
        shadowAtlasRoot = newRoot;
        validShadowAtlasRoots[newRoot] = true;

        emit ShadowAtlasUpdated(oldRoot, newRoot, block.timestamp);
    }

    /// @notice Check if nullifier already used
    function isNullifierUsed(bytes32 nullifier) external view returns (bool) {
        return nullifiersUsed[nullifier];
    }
}
```

**Gas cost breakdown:**
- GKR proof verification: ~180-220k gas (Fiat-Shamir + sumcheck)
- Nullifier check: ~5k gas (SLOAD)
- Event emission: ~2k gas
- **Total: 200-250k gas target**

**Milestone Gate:** If gas >250k consistently, pivot to Groth16 (50-80k gas).

-----

## Implementation Phases

### Phase 1A: Core GKR Infrastructure (Weeks 1-4)

**Week 1-2: Circuit Development**
- [ ] Implement Merkle tree verification circuit (Polyhedra Expander)
- [ ] Add Poseidon hash gates (SNARK-friendly)
- [ ] Nullifier generation circuit
- [ ] Commitment scheme circuit
- [ ] Unit tests for circuit correctness

**Week 3-4: Browser Prover**
- [ ] WASM compilation of GKR prover
- [ ] Web Worker integration (background proving)
- [ ] IndexedDB caching for WASM binary
- [ ] Progress UI ("Generating proof: 30%")
- [ ] Error handling (timeout, memory limits)

**Deliverables:**
- Functional browser-based proof generation (8-10s target)
- Unit tests covering all circuit components
- Performance benchmarks on test devices

### Phase 1B: On-Chain Verification (Weeks 5-6)

**Week 5: Smart Contract Development**
- [ ] DistrictGate.sol implementation (GKR verification)
- [ ] GKRVerifier library integration (Polyhedra Solidity)
- [ ] Nullifier registry (prevent double-verification)
- [ ] Shadow Atlas root management (security council multisig)
- [ ] Unit tests (Foundry/Hardhat)

**Week 6: Gas Optimization**
- [ ] External GKRVerifier deployment (reduce DistrictGate deployment cost)
- [ ] Batch verification support (future: multiple proofs in one tx)
- [ ] Historical roots mapping (allow proofs with old boundaries)
- [ ] Gas profiling (target: <250k gas)

**Deliverables:**
- Deployed GKRVerifier library on Scroll L2 testnet
- DistrictGate contract with <250k gas verification
- Comprehensive test suite (edge cases, attacks)

### Phase 1C: Shadow Atlas Infrastructure (Weeks 7-8)

**Week 7: Merkle Tree Generation**
- [ ] Census.gov API integration (fetch congressional districts)
- [ ] Merkle tree builder (435 districts + state/local)
- [ ] IPFS pinning (Pinata or self-hosted)
- [ ] Historical roots archival (quarterly snapshots)

**Week 8: Update Mechanism**
- [ ] Security council multisig setup (3-of-5 threshold)
- [ ] Quarterly update automation (cron job)
- [ ] Root update transaction workflow
- [ ] Verification frontend updates (fetch new root)

**Deliverables:**
- Shadow Atlas Merkle tree published to IPFS
- Initial root deployed on-chain (Scroll L2)
- Security council operational procedures documented

### Phase 1D: Integration & Testing (Weeks 9-10)

**Week 9: End-to-End Integration**
- [ ] Frontend: Address input → proof generation → on-chain verification
- [ ] Backend: Shadow Atlas API (serve Merkle proofs)
- [ ] Error handling (invalid address, proof timeout, tx failure)
- [ ] User feedback ("Verified TX-18 constituent ✓")

**Week 10: Security Audit Prep**
- [ ] Circuit formal verification (Polyhedra audit or internal review)
- [ ] Smart contract audit (OpenZeppelin/Trail of Bits)
- [ ] Penetration testing (district spoofing attempts)
- [ ] Documentation (circuit design, attack mitigations)

**Deliverables:**
- Production-ready GKR verification flow (browser → blockchain)
- Security audit reports
- Performance benchmarks meeting targets (8-10s proving, <250k gas)

-----

## Performance Targets & Monitoring

### Proving Performance (Browser)

**Target: 8-10 seconds on modern devices**

**Benchmarking devices:**
- MacBook Pro M1 (2021): 8s target
- iPhone 13 Pro: 10s target
- Samsung Galaxy S21: 12s acceptable, 15s max
- Budget Android (Moto G Power): 15s max

**Monitoring:**
```typescript
// Track proving performance in production
function trackProvingPerformance(metrics: {
  protocol: 'GKR' | 'Groth16',
  time: number,
  device: string,
  status: 'FAST' | 'ACCEPTABLE' | 'SLOW'
}) {
  // Send to analytics (Datadog, Sentry)
  analytics.track('zk_proof_generation', {
    ...metrics,
    timestamp: Date.now()
  });

  // Alert if >15s consistently
  if (metrics.time > 15000) {
    alertEngineering('GKR proving exceeds 15s threshold', metrics);
  }
}
```

**Milestone Gate:**
- If >20% of users experience >15s proving: Pivot to Groth16
- If >50% of users experience >12s proving: Optimize or pivot

### Verification Gas (On-Chain)

**Target: 200-250k gas on Scroll L2**

**Monitoring:**
```solidity
// Emit gas usage for every verification
event DistrictVerified(bytes32 indexed districtHash, bytes32 nullifier, uint256 gasUsed);

// Alert if gas >250k
event GasMilestoneExceeded(uint256 gasUsed, uint256 threshold);
```

**Analysis dashboard:**
- Average gas per verification (30-day rolling)
- 95th percentile gas usage
- Trend over time (circuit optimizations)
- Cost per verification ($USD)

**Milestone Gate:**
- If average gas >250k for 7+ days: Pivot to Groth16
- If cost per verification >$0.05: Optimize or pivot

### Proof Size

**Target: 2-4KB (GKR typical)**

**Comparison:**
- Groth16: 256 bytes (8x smaller)
- GKR: 2-4KB (larger but no trusted setup)

**Impact:**
- Network bandwidth: 2-4KB upload per verification (acceptable on mobile)
- Storage: Blockchain stores ~2KB per proof (acceptable)
- UX: 2-4KB = <1s upload on 3G connection (acceptable)

-----

## Groth16 Contingency Plan

**If GKR fails milestone gates** (proving >15s OR gas >250k), pivot to Groth16.

### Groth16 Implementation Path

**Circuit (same logic, different proof system):**
```rust
// Use Circom instead of Polyhedra Expander
// circuit/district-membership.circom

template DistrictMembership(merkle_depth) {
    // Private inputs
    signal input address;
    signal input district_id;
    signal input merkle_proof[merkle_depth];
    signal input encryption_nonce;

    // Public inputs
    signal output shadow_atlas_root;
    signal output district_hash;
    signal output nullifier;
    signal output commit_hash;

    // ... same logic as GKR circuit, different DSL
}
```

**Trusted Setup Ceremony:**
- Use [Perpetual Powers of Tau](https://github.com/privacy-scaling-explorations/perpetualpowersoftau) (Phase 1, universal)
- Circuit-specific Phase 2 ceremony (security council + community participation)
- ~100 contributors minimum
- Publish ceremony transcripts (transparency)

**Trade-offs:**
- ✅ 50-80k gas (3x cheaper than GKR)
- ✅ 256 bytes proof size (8x smaller than GKR)
- ✅ 3-5s browser proving (2x faster than GKR)
- ❌ Trusted setup required (toxic waste risk)
- ❌ Not transparent (must trust ceremony participants)
- ❌ Circuit updates require new ceremony (less flexible)

**Decision criteria:**
- GKR proving >15s consistently → Groth16
- GKR gas >250k consistently → Groth16
- GKR proves infeasible → Groth16
- **Default: GKR unless milestone gates fail**

-----

## Security Considerations

### Circuit Vulnerabilities

**1. Malicious Merkle Proofs**
- **Attack:** Submit proof with wrong sister nodes, forge district membership
- **Mitigation:** Circuit constrains Merkle root must match Shadow Atlas root (public input)
- **Verification:** Formal verification of circuit constraints (Polyhedra audit)

**2. Nullifier Reuse**
- **Attack:** Generate same nullifier twice, verify same identity to multiple wallets
- **Mitigation:** On-chain nullifier registry (SSTORE prevents reuse)
- **Cost to attack:** $0.01 gas per attempt (expensive to brute-force)

**3. District Hash Grinding**
- **Attack:** Generate millions of addresses until one hashes to desired district
- **Mitigation:** Commitment scheme (commit to address before proof generation)
- **Cost to attack:** 8-10s per attempt = 8,640 attempts/day max (computationally infeasible)

### Smart Contract Vulnerabilities

**1. Shadow Atlas Root Manipulation**
- **Attack:** Malicious security council updates root to include fake districts
- **Mitigation:** 3-of-5 multisig, transparent on-chain updates, community monitoring
- **Detection:** Off-chain verification against Census.gov data

**2. Nullifier Front-Running**
- **Attack:** Watch mempool, submit nullifier before legitimate user
- **Mitigation:** Private mempool (Flashbots on Scroll L2), or nullifier = Hash(identity + wallet address)
- **Cost to attack:** Requires MEV infrastructure (expensive)

**3. Gas Griefing**
- **Attack:** Submit invalid proofs to waste verifier gas
- **Mitigation:** Require small ETH deposit (refunded on success, forfeited on failure)
- **Cost to attack:** $0.01 per attempt (economic disincentive)

### Cryptographic Assumptions

**GKR security relies on:**
1. **Fiat-Shamir heuristic** - Hash-based randomness is unpredictable
2. **Collision resistance** - Poseidon hash is collision-resistant
3. **Discrete log problem** - Polynomial commitments are binding

**Known attacks:**
- None for GKR with Fiat-Shamir (protocol published Oct 2025, actively researched)
- Quantum computing: GKR vulnerable to Shor's algorithm (same as all elliptic curve crypto)

**Post-quantum contingency:**
- Monitor NIST post-quantum standardization (Kyber, Dilithium finalized 2024)
- Phase 3+ may require post-quantum ZK-STARKs (no elliptic curves)

-----

## Testing Strategy

### Unit Tests (Circuit Layer)

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_district_proof() {
        // Valid Merkle proof for TX-18
        let witness = create_valid_witness("TX-18");
        let circuit = build_district_proof_circuit(12);
        let proof = circuit.prove(witness);
        assert!(circuit.verify(proof));
    }

    #[test]
    fn test_invalid_merkle_proof() {
        // Tampered Merkle proof (wrong sister node)
        let mut witness = create_valid_witness("TX-18");
        witness.merkle_proof[5] = random_hash(); // Corrupt layer 5
        let circuit = build_district_proof_circuit(12);
        let proof = circuit.prove(witness);
        assert!(!circuit.verify(proof)); // Should fail
    }

    #[test]
    fn test_wrong_district_claim() {
        // Prove TX-18 membership but claim CA-12
        let witness = create_valid_witness("TX-18");
        witness.district_id = "CA-12"; // Mismatch
        let circuit = build_district_proof_circuit(12);
        // Should fail constraint: district_hash != Hash("CA-12")
        assert!(circuit.prove(witness).is_err());
    }
}
```

### Integration Tests (End-to-End)

```typescript
// tests/integration/gkr-verification.test.ts
describe('GKR District Verification', () => {
  it('should verify TX-18 constituent', async () => {
    const address = '1600 Pennsylvania Avenue NW, Washington, DC 20500';
    const district = 'DC-AL'; // DC At-Large district

    // Generate proof in browser (WASM)
    const proof = await generateDistrictProof(address, district);
    expect(proof.provingTime).toBeLessThan(15000); // <15s

    // Verify on-chain (Scroll L2 testnet)
    const tx = await districtGate.verifyDistrictMembership(
      proof.proof,
      proof.publicInputs
    );
    const receipt = await tx.wait();

    expect(receipt.status).toBe(1); // Success
    expect(receipt.gasUsed).toBeLessThan(250000); // <250k gas

    // Check event emitted
    const event = receipt.events.find(e => e.event === 'DistrictVerified');
    expect(event.args.districtHash).toBe(hashDistrict('DC-AL'));
  });

  it('should reject nullifier reuse', async () => {
    const address = '1600 Pennsylvania Avenue NW, Washington, DC 20500';
    const district = 'DC-AL';

    // First verification succeeds
    const proof1 = await generateDistrictProof(address, district);
    await districtGate.verifyDistrictMembership(proof1.proof, proof1.publicInputs);

    // Second verification with same nullifier fails
    const proof2 = await generateDistrictProof(address, district);
    await expect(
      districtGate.verifyDistrictMembership(proof2.proof, proof2.publicInputs)
    ).rejects.toThrow('Nullifier already used');
  });
});
```

### Performance Tests

```typescript
// tests/performance/gkr-benchmarks.test.ts
describe('GKR Performance Benchmarks', () => {
  it('should meet proving time targets across devices', async () => {
    const devices = [
      { name: 'MacBook Pro M1', target: 8000 },
      { name: 'iPhone 13 Pro', target: 10000 },
      { name: 'Samsung Galaxy S21', target: 12000 },
    ];

    for (const device of devices) {
      const times = await benchmarkProving(device.name, 10); // 10 runs
      const average = times.reduce((a, b) => a + b, 0) / times.length;

      expect(average).toBeLessThan(device.target);
      console.log(`${device.name}: ${average}ms (target: ${device.target}ms)`);
    }
  });

  it('should meet gas cost targets on Scroll L2', async () => {
    const gasUsages = await benchmarkVerification(100); // 100 verifications
    const average = gasUsages.reduce((a, b) => a + b, 0) / gasUsages.length;
    const p95 = percentile(gasUsages, 95);

    expect(average).toBeLessThan(250000); // <250k gas average
    expect(p95).toBeLessThan(300000); // <300k gas 95th percentile
    console.log(`Average: ${average} gas, P95: ${p95} gas`);
  });
});
```

-----

## Deployment Checklist

### Pre-Production

- [ ] Circuit formal verification completed (Polyhedra audit or equivalent)
- [ ] Smart contract audit completed (OpenZeppelin/Trail of Bits)
- [ ] Shadow Atlas Merkle tree generated and published to IPFS
- [ ] Security council multisig operational (3-of-5 threshold)
- [ ] Browser prover tested on 10+ device types
- [ ] Gas costs profiled on Scroll L2 testnet (average <250k)
- [ ] Proving times profiled on target devices (average <10s)
- [ ] Integration tests passing (100+ scenarios)
- [ ] Performance benchmarks meeting targets

### Production Deployment (Scroll L2 Mainnet)

**Step 1: Deploy GKRVerifier Library**
```bash
forge create --rpc-url $SCROLL_RPC \
  --private-key $DEPLOYER_KEY \
  --verify \
  src/GKRVerifier.sol:GKRVerifier
```
- Record deployed address: `0xGKRVerifier...`

**Step 2: Deploy DistrictGate Contract**
```bash
forge create --rpc-url $SCROLL_RPC \
  --private-key $DEPLOYER_KEY \
  --verify \
  --constructor-args $GKR_VERIFIER_ADDRESS $SECURITY_COUNCIL_ADDRESS $SHADOW_ATLAS_ROOT \
  src/DistrictGate.sol:DistrictGate
```
- Record deployed address: `0xDistrictGate...`

**Step 3: Verify Shadow Atlas on IPFS**
```bash
ipfs add -r shadow-atlas/
# Pin to Pinata: https://app.pinata.cloud
# Verify CID: QmShadowAtlas...
```

**Step 4: Update Frontend Configuration**
```typescript
// src/lib/config/contracts.ts
export const DISTRICT_GATE_ADDRESS = '0xDistrictGate...'; // Scroll L2 mainnet
export const SHADOW_ATLAS_IPFS_CID = 'QmShadowAtlas...';
export const SHADOW_ATLAS_ROOT = '0xABCD...'; // Current Merkle root
```

**Step 5: Smoke Test Production**
- [ ] Verify test address (e.g., White House → DC-AL)
- [ ] Check gas usage (<250k)
- [ ] Check proving time (<10s)
- [ ] Verify event emission
- [ ] Test nullifier reuse prevention

**Step 6: Monitor Production Metrics**
- [ ] Datadog dashboard: GKR proving times
- [ ] Sentry alerts: Proof generation failures
- [ ] Gas usage tracking: Average/P95 per day
- [ ] Nullifier registry growth: Unique verifications per day

-----

## Maintenance & Operations

### Quarterly Shadow Atlas Updates

**Trigger:** Census.gov publishes new district boundaries (every 10 years) or state redistricting

**Process:**
1. Fetch updated district data from Census.gov API
2. Regenerate Merkle tree (435 congressional + state/local)
3. Compute new Shadow Atlas root
4. Publish new tree to IPFS
5. Security council votes on root update (3-of-5 multisig)
6. Submit on-chain transaction: `updateShadowAtlasRoot(newRoot)`
7. Announce to users: "Shadow Atlas updated, proofs may take 30s while caching new tree"

**Fallback:** Historical roots remain valid (allow proofs with old boundaries for 90 days)

### Incident Response

**Scenario: Proof Generation Failures Spike**

**Symptoms:**
- Sentry alerts: >10% of users experiencing proof timeouts
- Datadog metrics: Proving time >15s for >20% of attempts

**Investigation:**
1. Check WASM binary cache (IndexedDB corruption?)
2. Check Shadow Atlas API availability (Merkle proof fetching)
3. Check device distribution (budget Android surge?)
4. Check circuit changes (recent deployment broke proving?)

**Response:**
- Rollback frontend to last known good version
- Disable GKR, fallback to manual verification (temporary)
- Deploy hotfix or pivot to Groth16 contingency

**Scenario: Gas Costs Exceed 250k**

**Symptoms:**
- On-chain events: `GasMilestoneExceeded` emitted frequently
- Average gas >250k for 7+ days

**Investigation:**
1. Check Scroll L2 gas price trends (network congestion?)
2. Check proof size distribution (larger proofs = more gas?)
3. Check GKRVerifier library version (bug introduced?)

**Response:**
- Optimize GKRVerifier (batch verification, precompiled contracts)
- If optimization fails: Pivot to Groth16 contingency
- Communicate to users: "Verification costs temporarily higher, working on optimizations"

-----

## Success Metrics

**Phase 1 Launch (3 months):**
- [ ] 10,000+ district verifications completed
- [ ] Average proving time <10s (95th percentile <12s)
- [ ] Average gas cost <250k (95th percentile <300k)
- [ ] Zero security incidents (circuit exploits, nullifier reuse)
- [ ] 95%+ proof success rate (failures <5%)

**Phase 2 Transition (12-18 months):**
- [ ] 100,000+ district verifications completed
- [ ] Groth16 contingency deployed (if needed) OR GKR optimized further
- [ ] Shadow Atlas updated 2+ times (quarterly cadence operational)
- [ ] Security council governance operational (no single points of failure)

-----

## References

1. **GKR Protocol Paper**: [Vitalik Buterin, "The GKR Protocol", October 19, 2025](https://vitalik.eth.limo/general/2025/10/19/gkr.html)
2. **Polyhedra Expander**: [GitHub - Polyhedra-Network/Expander](https://github.com/Polyhedra-Network/Expander)
3. **Fiat-Shamir Transformation**: [Wikipedia - Fiat-Shamir Heuristic](https://en.wikipedia.org/wiki/Fiat%E2%80%93Shamir_heuristic)
4. **Census.gov API**: [U.S. Census Bureau API Documentation](https://www.census.gov/data/developers/data-sets.html)
5. **Scroll L2 Gas Benchmarks**: [Scroll Documentation - Gas Costs](https://docs.scroll.io)

-----

*This implementation plan is a living document. Updates reflect protocol changes, security audits, and production learnings.*
