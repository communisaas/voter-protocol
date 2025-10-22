# Halo2 Implementation Plan (REVISED)

**Zero-Knowledge District Verification Without Trusted Setup**

**Status:** Phase 1 Critical Path (REVISED from GKR hybrid)
**Updated:** 2025-10-21
**Architecture:** Halo2 Direct Proving (NO HYBRID)

---

## Why This Revision?

**Original plan:** Hybrid GKR + SNARK architecture

**Problem discovered:** [HYBRID-ARCHITECTURE-CRITIQUE.md](/Users/noot/Documents/communique/HYBRID-ARCHITECTURE-CRITIQUE.md) proved the hybrid approach is:
- 2x slower (8-12s vs 4-6s)
- 50% more expensive (80-120k vs 60-100k gas)
- More complex (two proof systems vs one)
- Scale mismatch (GKR optimized for millions of gates, we have 150)

**Revised plan:** Halo2 direct proving

**Benefits:**
- ✅ Faster proving (4-6s vs 8-12s)
- ✅ Cheaper gas (60-100k vs 80-120k)
- ✅ Simpler implementation (6-8 weeks vs 15+ weeks)
- ✅ Battle-tested (Zcash production since 2022)
- ✅ No trusted setup (same as hybrid)

---

## Executive Summary

VOTER Protocol uses **Halo2 recursive zero-knowledge proofs** to verify congressional district membership without revealing constituent addresses.

**Performance Targets:**
- **Halo2 proving:** 4-6 seconds (browser)
- **On-chain verification:** 60-100k gas (Scroll L2)
- **Proof size:** 384-512 bytes
- **No trusted setup**

**Implementation Timeline:** 6-8 weeks (vs 15+ weeks for hybrid)

---

## Technical Architecture

### Halo2 Circuit Design

**Circuit purpose:** Prove "I live in TX-18" without revealing address.

```rust
use halo2_proofs::{
    circuit::{Layouter, SimpleFloorPlanner, Value},
    plonk::{Advice, Circuit, Column, ConstraintSystem, Error, Instance},
    poly::Rotation,
};
use poseidon_gadget::PoseidonChip;

#[derive(Clone, Debug)]
pub struct DistrictMembershipCircuit {
    // Private inputs (witness) - NEVER revealed
    address_hash: Value<Fp>,           // Poseidon(full_address)
    district_id: Value<Fp>,             // e.g., 18 for TX-18
    merkle_proof: Vec<Value<Fp>>,      // Sibling hashes (depth 12)
    merkle_indices: Vec<bool>,          // Path indices (0=left, 1=right)
    identity_hash: Value<Fp>,           // From self.xyz verification

    // Public inputs - visible on-chain
    shadow_atlas_root: Value<Fp>,      // Current Merkle root
    district_hash: Value<Fp>,           // Poseidon(district_id) - reveals district
    nullifier: Value<Fp>,               // Poseidon(identity_hash, district_id)
}

impl Circuit<Fp> for DistrictMembershipCircuit {
    type Config = DistrictMembershipConfig;
    type FloorPlanner = SimpleFloorPlanner;

    fn without_witnesses(&self) -> Self {
        // Circuit template without private data
        Self::default()
    }

    fn configure(meta: &mut ConstraintSystem<Fp>) -> Self::Config {
        // Configure advice columns (private data)
        let advice = [
            meta.advice_column(),
            meta.advice_column(),
            meta.advice_column(),
        ];

        // Configure instance column (public inputs)
        let instance = meta.instance_column();

        // Enable equality constraints
        meta.enable_equality(instance);
        for col in &advice {
            meta.enable_equality(*col);
        }

        // Configure Poseidon hash chip (SNARK-friendly hashing)
        let poseidon = PoseidonChip::configure(
            meta,
            advice,
            /* ... Poseidon parameters ... */
        );

        DistrictMembershipConfig {
            advice,
            instance,
            poseidon,
        }
    }

    fn synthesize(
        &self,
        config: Self::Config,
        mut layouter: impl Layouter<Fp>,
    ) -> Result<(), Error> {
        // CONSTRAINT 1: district_hash = Poseidon(district_id)
        let district_hash_cell = config.poseidon.hash(
            layouter.namespace(|| "district hash"),
            &[self.district_id],
        )?;
        layouter.constrain_instance(district_hash_cell.cell(), config.instance, 0)?;

        // CONSTRAINT 2: Verify Merkle path
        let mut current_hash = self.address_hash;
        for (i, sibling) in self.merkle_proof.iter().enumerate() {
            // Hash current node with sibling (order depends on path index)
            current_hash = if self.merkle_indices[i] {
                // Current is left child
                config.poseidon.hash(
                    layouter.namespace(|| format!("merkle layer {} left", i)),
                    &[current_hash, *sibling],
                )?
            } else {
                // Current is right child
                config.poseidon.hash(
                    layouter.namespace(|| format!("merkle layer {} right", i)),
                    &[*sibling, current_hash],
                )?
            };
        }

        // CONSTRAINT 3: Final hash must match Shadow Atlas root
        layouter.constrain_instance(current_hash.cell(), config.instance, 1)?;

        // CONSTRAINT 4: nullifier = Poseidon(identity_hash, district_id)
        let nullifier_cell = config.poseidon.hash(
            layouter.namespace(|| "nullifier"),
            &[self.identity_hash, self.district_id],
        )?;
        layouter.constrain_instance(nullifier_cell.cell(), config.instance, 2)?;

        Ok(())
    }
}
```

**Circuit complexity:**
- **Gates:** ~150 (12 Poseidon hashes + constraints)
- **Public inputs:** 3 (shadow_atlas_root, district_hash, nullifier)
- **Private inputs:** 5 (address_hash, district_id, merkle_proof, indices, identity_hash)

---

## Browser WASM Integration

### WASM Compilation

```bash
# Compile Halo2 circuit to WASM
cd packages/crypto-wasm
cargo build --release --target wasm32-unknown-unknown
wasm-bindgen --out-dir ../dist target/wasm32-unknown-unknown/release/halo2_prover.wasm
wasm-opt -Oz -o ../dist/halo2_prover_opt.wasm ../dist/halo2_prover.wasm
```

**Output:**
- `halo2_prover_opt.wasm` (~400KB gzipped)
- `halo2_prover.js` (JavaScript bindings)

### JavaScript API

```typescript
// packages/crypto/src/halo2-prover.ts
import init, { Halo2Prover } from '@voter-protocol/halo2-wasm';

export interface DistrictProof {
  proof: Uint8Array;           // 384-512 bytes
  publicInputs: {
    shadowAtlasRoot: string;
    districtHash: string;
    nullifier: string;
  };
  provingTime: number;          // milliseconds
}

export class DistrictProver {
  private prover: Halo2Prover | null = null;
  private initialized: boolean = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Initialize WASM module (cached by Service Worker)
    await init();
    this.prover = new Halo2Prover();
    this.initialized = true;
  }

  async generateProof(
    address: string,
    districtId: number,
    identityHash: string,
    onProgress?: (percent: number) => void
  ): Promise<DistrictProof> {
    await this.initialize();

    // 1. Fetch Shadow Atlas data
    const shadowAtlasRoot = await this.fetchShadowAtlasRoot();
    const merkleProof = await this.fetchMerkleProof(districtId);

    // 2. Hash address client-side (NEVER send plaintext)
    const addressHash = await this.hashAddress(address);

    // 3. Prepare witness (private inputs)
    const witness = {
      address_hash: addressHash,
      district_id: districtId,
      merkle_proof: merkleProof.siblings,
      merkle_indices: merkleProof.indices,
      identity_hash: identityHash,
    };

    // 4. Prepare public inputs
    const publicInputs = {
      shadow_atlas_root: shadowAtlasRoot,
      district_hash: this.hashDistrict(districtId),
      nullifier: this.generateNullifier(identityHash, districtId),
    };

    // 5. Generate Halo2 proof (4-6 seconds)
    const startTime = performance.now();
    const proof = await this.prover!.prove(
      witness,
      publicInputs,
      (percent: number) => onProgress?.(percent)
    );
    const provingTime = performance.now() - startTime;

    console.log(`Halo2 proof generated in ${provingTime}ms`);

    return {
      proof: new Uint8Array(proof),
      publicInputs,
      provingTime,
    };
  }

  private async hashAddress(address: string): Promise<string> {
    // Poseidon hash of address (client-side only)
    const poseidon = await import('poseidon-lite');
    return poseidon.hash(address);
  }

  private hashDistrict(districtId: number): string {
    // Poseidon hash of district ID
    return poseidon.hash([districtId]);
  }

  private generateNullifier(identityHash: string, districtId: number): string {
    // Poseidon(identity_hash, district_id)
    return poseidon.hash([identityHash, districtId]);
  }

  private async fetchShadowAtlasRoot(): Promise<string> {
    // Fetch current Merkle root from on-chain or API
    const response = await fetch('/api/shadow-atlas/root');
    const { root } = await response.json();
    return root;
  }

  private async fetchMerkleProof(districtId: number): Promise<MerkleProof> {
    // Fetch Merkle proof from Shadow Atlas API
    const response = await fetch(`/api/shadow-atlas/proof/${districtId}`);
    return response.json();
  }
}
```

### Web Worker Offloading

```typescript
// src/lib/workers/halo2-prover.worker.ts
import { DistrictProver } from '@voter-protocol/crypto';

const prover = new DistrictProver();

self.onmessage = async (e) => {
  const { address, districtId, identityHash } = e.data;

  try {
    const proof = await prover.generateProof(
      address,
      districtId,
      identityHash,
      (percent) => {
        self.postMessage({ type: 'progress', percent });
      }
    );

    self.postMessage({ type: 'complete', proof });
  } catch (error) {
    self.postMessage({ type: 'error', error: error.message });
  }
};
```

**Usage:**

```typescript
// Component usage
const worker = new Worker('/workers/halo2-prover.worker.js');

worker.postMessage({ address, districtId, identityHash });

worker.onmessage = (e) => {
  if (e.data.type === 'progress') {
    setProgress(e.data.percent); // Update UI
  } else if (e.data.type === 'complete') {
    submitProofOnChain(e.data.proof); // Send to blockchain
  }
};
```

---

## Smart Contract Implementation

### Halo2Verifier.sol (Generated from Circuit)

```solidity
// contracts/Halo2Verifier.sol
// Auto-generated from Halo2 circuit using halo2-solidity tool
pragma solidity ^0.8.20;

contract Halo2Verifier {
    uint256 constant PROOF_SIZE = 512;
    uint256 constant NUM_PUBLIC_INPUTS = 3;

    /// @notice Verify Halo2 recursive proof
    /// @param proof Proof bytes (384-512 bytes)
    /// @param publicInputs [shadow_atlas_root, district_hash, nullifier]
    /// @return verified True if proof is valid
    function verify(
        bytes calldata proof,
        uint256[NUM_PUBLIC_INPUTS] calldata publicInputs
    ) public view returns (bool verified) {
        require(proof.length == PROOF_SIZE, "Invalid proof size");

        // Halo2 verification using BN254 pairing
        return _verifyHalo2Proof(proof, publicInputs);
    }

    function _verifyHalo2Proof(
        bytes calldata proof,
        uint256[NUM_PUBLIC_INPUTS] calldata publicInputs
    ) internal view returns (bool) {
        // Auto-generated Halo2 verification logic
        // Uses elliptic curve pairings on BN254
        // Gas: ~60-100k depending on circuit optimizations

        // (Implementation details auto-generated from circuit)
    }
}
```

### DistrictGate.sol

```solidity
// contracts/DistrictGate.sol
pragma solidity ^0.8.20;

import "./Halo2Verifier.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract DistrictGate is Ownable {
    bytes32 public shadowAtlasRoot;
    Halo2Verifier public immutable halo2Verifier;

    // Nullifier registry (prevent double-verification)
    mapping(bytes32 => bool) public nullifiersUsed;

    // Historical roots (allow proofs with old boundaries)
    mapping(bytes32 => bool) public validShadowAtlasRoots;

    event DistrictVerified(
        bytes32 indexed districtHash,
        bytes32 indexed nullifier,
        uint256 gasUsed,
        uint256 timestamp
    );

    event ShadowAtlasUpdated(
        bytes32 oldRoot,
        bytes32 newRoot,
        uint256 timestamp
    );

    constructor(address _halo2Verifier, bytes32 _initialRoot) {
        halo2Verifier = Halo2Verifier(_halo2Verifier);
        shadowAtlasRoot = _initialRoot;
        validShadowAtlasRoots[_initialRoot] = true;
    }

    function verifyDistrictMembership(
        bytes calldata proof,
        uint256[3] calldata publicInputs
    ) external returns (bool verified) {
        uint256 gasStart = gasleft();

        uint256 _shadowAtlasRoot = publicInputs[0];
        bytes32 districtHash = bytes32(publicInputs[1]);
        bytes32 nullifier = bytes32(publicInputs[2]);

        // 1. Verify Shadow Atlas root is current or historical
        require(
            bytes32(_shadowAtlasRoot) == shadowAtlasRoot ||
            validShadowAtlasRoots[bytes32(_shadowAtlasRoot)],
            "Invalid Shadow Atlas root"
        );

        // 2. Verify nullifier not used
        require(!nullifiersUsed[nullifier], "Nullifier already used");

        // 3. Verify Halo2 proof (60-100k gas)
        verified = halo2Verifier.verify(proof, publicInputs);
        require(verified, "Invalid Halo2 proof");

        // 4. Mark nullifier as used
        nullifiersUsed[nullifier] = true;

        uint256 gasUsed = gasStart - gasleft();
        emit DistrictVerified(districtHash, nullifier, gasUsed, block.timestamp);

        return verified;
    }

    function updateShadowAtlasRoot(bytes32 newRoot) external onlyOwner {
        bytes32 oldRoot = shadowAtlasRoot;
        shadowAtlasRoot = newRoot;
        validShadowAtlasRoots[newRoot] = true;

        emit ShadowAtlasUpdated(oldRoot, newRoot, block.timestamp);
    }

    function isNullifierUsed(bytes32 nullifier) external view returns (bool) {
        return nullifiersUsed[nullifier];
    }
}
```

---

## Implementation Phases

### Phase 1: Halo2 Circuit Development (4 weeks)

**Week 1-2: Circuit Implementation**
- [ ] Implement Merkle tree verification circuit
- [ ] Add Poseidon hash gadget
- [ ] Nullifier generation circuit
- [ ] Unit tests for circuit correctness
- [ ] Formal verification of constraints

**Week 3-4: WASM Compilation**
- [ ] Compile circuit to WASM
- [ ] JavaScript bindings
- [ ] Service Worker caching
- [ ] Web Worker integration
- [ ] Performance benchmarking (target: 4-6s)

**Deliverables:**
- Functional Halo2 prover (WASM)
- Unit tests (100% coverage)
- WASM bundle (<500KB gzipped)
- Performance benchmarks on 5+ devices

### Phase 2: Smart Contract Development (2 weeks)

**Week 5: Contract Implementation**
- [ ] Generate Halo2Verifier.sol from circuit
- [ ] Implement DistrictGate.sol
- [ ] Nullifier registry
- [ ] Shadow Atlas root management
- [ ] Access control (Ownable)

**Week 6: Testing & Optimization**
- [ ] Foundry test suite (100+ test cases)
- [ ] Gas optimization (target: <100k)
- [ ] Scroll Sepolia testnet deployment
- [ ] Contract verification on Scrollscan

**Deliverables:**
- Deployed contracts on testnet
- Gas benchmarks (<100k gas verified)
- Comprehensive test suite
- Security audit prep materials

### Phase 3: Integration (2 weeks)

**Week 7: Frontend Integration**
- [ ] Browser prover UI component
- [ ] Progress indicators ("Generating proof: 60%")
- [ ] Error handling (timeout, invalid address)
- [ ] Offline proof caching (IndexedDB)

**Week 8: E2E Testing**
- [ ] End-to-end proof generation + verification
- [ ] Mobile device testing (iPhone 14, Galaxy S23)
- [ ] Performance validation (4-6s target)
- [ ] Security audit prep

**Deliverables:**
- Production-ready proof flow
- E2E test suite
- Performance validation report
- Security audit materials

**Total: 6-8 weeks** (vs 15+ weeks for hybrid)

---

## Performance Targets

### Browser Proving

**Target: 4-6 seconds on modern devices**

| Device | Target | Acceptable | Unacceptable |
|--------|--------|------------|--------------|
| MacBook Pro M1 | 4s | <6s | >10s |
| iPhone 14 Pro | 5s | <8s | >12s |
| Galaxy S23 | 6s | <10s | >15s |
| Budget Android | 8s | <12s | >20s |

**Monitoring:**
- Track P50, P95, P99 proving times
- Alert if P95 >10s for 7+ days
- Automatic optimization review if P99 >15s

### On-Chain Verification

**Target: 60-100k gas on Scroll L2**

| Metric | Target | Acceptable | Unacceptable |
|--------|--------|------------|--------------|
| Average gas | 80k | <100k | >150k |
| P95 gas | 95k | <120k | >180k |

**Monitoring:**
- Emit gas usage in every `DistrictVerified` event
- Dashboard tracking average/P95 gas
- Alert if average >100k for 7+ days

---

## Testing Strategy

### Unit Tests (Circuit Layer)

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_merkle_proof() {
        let circuit = build_test_circuit(12);
        let witness = create_valid_witness("TX-18");
        let proof = circuit.prove(witness);
        assert!(circuit.verify(proof));
    }

    #[test]
    fn test_invalid_merkle_proof() {
        let circuit = build_test_circuit(12);
        let mut witness = create_valid_witness("TX-18");
        witness.merkle_proof[5] = random_hash(); // Corrupt
        assert!(circuit.prove(witness).is_err());
    }

    #[test]
    fn test_wrong_district_claim() {
        let circuit = build_test_circuit(12);
        let mut witness = create_valid_witness("TX-18");
        witness.district_id = 12; // Claim CA-12 instead
        assert!(circuit.prove(witness).is_err());
    }
}
```

### Integration Tests

```typescript
describe('Halo2 E2E', () => {
  it('should verify TX-18 constituent', async () => {
    const prover = new DistrictProver();
    const address = '1600 Pennsylvania Ave NW, Washington, DC 20500';

    const proof = await prover.generateProof(address, 18, identityHash);
    expect(proof.provingTime).toBeLessThan(6000); // <6s

    const tx = await districtGate.verifyDistrictMembership(
      proof.proof,
      Object.values(proof.publicInputs)
    );
    const receipt = await tx.wait();

    expect(receipt.status).toBe(1);
    expect(receipt.gasUsed).toBeLessThan(100000); // <100k gas
  });
});
```

---

## Security Considerations

### Cryptographic Assumptions

**Halo2 security relies on:**
1. **BN254 elliptic curve discrete logarithm problem** (128-bit security)
2. **Poseidon hash collision resistance** (254-bit security)
3. **IPA commitment scheme binding** (Halo2's no-setup approach)

**No trusted setup required** (vs Groth16)

### Circuit Vulnerabilities

**Mitigations:**
- Formal verification of constraints
- Unit tests covering all edge cases
- Fuzz testing with random inputs
- Security audit by Halo2 experts

### Smart Contract Vulnerabilities

**Mitigations:**
- OpenZeppelin audited libraries
- Comprehensive test suite
- Gas profiling (prevent DoS)
- Nullifier registry (prevent reuse)

---

## Deployment Checklist

### Pre-Production

- [ ] Circuit formal verification completed
- [ ] Smart contract audit completed
- [ ] WASM prover tested on 10+ devices
- [ ] Gas costs profiled (<100k verified)
- [ ] Proving times profiled (<6s verified)
- [ ] Integration tests passing (100+)
- [ ] Shadow Atlas published to IPFS

### Production (Scroll L2 Mainnet)

**Step 1: Deploy Halo2Verifier**
```bash
forge create --rpc-url $SCROLL_RPC \
  --private-key $DEPLOYER_KEY \
  --verify \
  src/Halo2Verifier.sol:Halo2Verifier
```

**Step 2: Deploy DistrictGate**
```bash
forge create --rpc-url $SCROLL_RPC \
  --private-key $DEPLOYER_KEY \
  --verify \
  --constructor-args $HALO2_VERIFIER_ADDRESS $SHADOW_ATLAS_ROOT \
  src/DistrictGate.sol:DistrictGate
```

**Step 3: Smoke Test**
- [ ] Verify test address (DC-AL)
- [ ] Check gas usage (<100k)
- [ ] Check proving time (<6s)
- [ ] Verify event emission
- [ ] Test nullifier prevention

---

## Success Metrics

**Phase 1 Launch (3 months):**
- [ ] 10,000+ district verifications
- [ ] Average proving time <6s (P95 <8s)
- [ ] Average gas <100k (P95 <120k)
- [ ] Zero security incidents
- [ ] 95%+ proof success rate

---

## References

1. **Halo2 Documentation:** https://zcash.github.io/halo2/
2. **Zcash Orchard (Halo2 production):** https://github.com/zcash/orchard
3. **HYBRID-ARCHITECTURE-CRITIQUE.md:** /Users/noot/Documents/communique/HYBRID-ARCHITECTURE-CRITIQUE.md
4. **Poseidon Hash:** https://www.poseidon-hash.info/

---

**This plan replaces `gkr-implementation-plan.md` with direct Halo2 proving (no hybrid).**
