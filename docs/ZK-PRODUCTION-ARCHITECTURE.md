# ZK Production Architecture

**Production-grade infrastructure for zero-knowledge proof system deployment.**

**Classification**: Production Architecture
**Threat Model**: Nation-state adversaries, 20-year cryptographic horizon

---

## Design Principles

1. **Defense in Depth**: Multiple independent layers of protection
2. **Crypto Agility**: Migrate proof systems without user disruption
3. **Zero Trust Infrastructure**: Assume every component can be compromised
4. **Formal Verification First**: Mathematical proofs before code deployment

---

## C-1: Nullifier Registry

### Problem
Proofs can be replayed infinitely. No mechanism prevents double-voting.

### Distinguished Solution: Semaphore-Style External Nullifier Architecture

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

contract NullifierRegistry {
    // External nullifier = H(campaign_id, epoch_id)
    // This allows same user to participate in different campaigns
    // But prevents double-action within same campaign/epoch
    
    mapping(bytes32 => mapping(bytes32 => bool)) public nullifierUsed;
    // nullifierUsed[externalNullifier][userNullifier] = true
    
    event ActionRecorded(
        bytes32 indexed externalNullifier,
        bytes32 indexed userNullifier,
        bytes32 merkleRoot,
        uint256 timestamp
    );

    function submitAction(
        bytes calldata proof,
        bytes32 merkleRoot,
        bytes32 userNullifier,
        bytes32 campaignId,
        bytes32 epochId,
        bytes32 authorityHash
    ) external {
        bytes32 externalNullifier = keccak256(abi.encodePacked(campaignId, epochId));
        
        // CRITICAL: Check nullifier hasn't been used for this context
        require(!nullifierUsed[externalNullifier][userNullifier], "Already submitted");
        
        // Verify ZK proof
        require(verifyProof(proof, merkleRoot, userNullifier, authorityHash, epochId, campaignId), "Invalid proof");
        
        // Mark nullifier as used (prevents replay)
        nullifierUsed[externalNullifier][userNullifier] = true;
        
        emit ActionRecorded(externalNullifier, userNullifier, merkleRoot, block.timestamp);
    }
}
```

### Gas Optimization

| Operation | Gas Cost | Optimization |
|-----------|----------|--------------|
| SSTORE (first write) | ~20,000 | Inevitable |
| SLOAD (check) | ~2,100 | Cold storage |
| Proof verification | ~200,000 | KZG pairing |

**Total**: ~222,000 gas per action on L1

**L2 Strategy**: Deploy on Scroll L2 for ~100x gas reduction (~2,220 equivalent gas).

---

## C-2: Root Validation Oracle

### Problem
Proofs can use fake Merkle roots, claiming membership in non-existent districts.

### Distinguished Solution: Chainlink-Secured Root Registry

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract DistrictRootRegistry {
    struct DistrictInfo {
        string districtCode;      // "CA-12", "TX-18"
        uint256 population;       // Census population
        uint256 lastUpdated;      // Block timestamp
        bool isActive;            // Can be deprecated
        bytes32 merkleRoot;       // Current Shadow Atlas root
    }
    
    mapping(bytes32 => DistrictInfo) public districts;
    mapping(address => bool) public authorizedOracles;
    
    uint256 public constant ROOT_VALIDITY_PERIOD = 90 days;
    uint256 public constant MIN_UPDATE_INTERVAL = 7 days;
    
    modifier onlyOracle() {
        require(authorizedOracles[msg.sender], "Not authorized oracle");
        _;
    }
    
    function updateRoot(
        bytes32 districtHash,
        bytes32 newRoot,
        uint256 population,
        bytes calldata chainlinkSignature
    ) external onlyOracle {
        DistrictInfo storage district = districts[districtHash];
        
        // Prevent rapid root updates (protects against oracle compromise)
        require(
            block.timestamp >= district.lastUpdated + MIN_UPDATE_INTERVAL,
            "Update too soon"
        );
        
        // Verify Chainlink attestation (optional redundancy)
        // verifyChainlinkAttestation(chainlinkSignature, districtHash, newRoot);
        
        district.merkleRoot = newRoot;
        district.population = population;
        district.lastUpdated = block.timestamp;
        district.isActive = true;
    }
    
    function validateRoot(bytes32 merkleRoot) external view returns (bool, string memory) {
        // O(1) lookup by root → district
        // Implementation: maintain reverse mapping of root → districtHash
        // ...
    }
}
```

### Multi-Sig Oracle Quorum

For nation-state resistance:

```
Root Update Requirement:
  - 3-of-5 oracle signatures (geographically distributed)
  - Timelock: 48-hour delay before activation
  - Veto: Any 2 oracles can cancel pending update
```

### IPFS Commitment Layer

```
Shadow Atlas Update Flow:
1. Protocol builds new Shadow Atlas from Census + voter rolls
2. Compute Merkle root R
3. Publish full tree to IPFS → CID
4. Post (R, CID, timestamp) to Chainlink DON
5. 3-of-5 oracles verify independently
6. After 48h timelock, R becomes active on-chain
```

---

## Formal Verification Strategy

### Tooling Selection

| Tool | Purpose | Target |
|------|---------|--------|
| **Veridise Picus** | Under-constrained detection | Noir circuit |
| **Ecne** | R1CS uniqueness verification | ACIR output |
| **Lean4 (cLean)** | Full circuit specification | main.nr |
| **Coq** | Contract invariants | Solidity |

### Verification Scope

```lean
-- Lean4 specification for district membership

theorem nullifier_uniqueness 
  (inputs1 inputs2 : CircuitInputs)
  (h_same_nullifier : compute_nullifier inputs1 = compute_nullifier inputs2)
  (h_same_campaign : inputs1.campaign_id = inputs2.campaign_id)
  (h_same_epoch : inputs1.epoch_id = inputs2.epoch_id) :
  inputs1.user_secret = inputs2.user_secret ∧ 
  inputs1.authority_hash = inputs2.authority_hash :=
by
  -- Poseidon collision resistance implies this
  sorry -- Formalized proof pending

theorem merkle_membership_soundness
  (root : Field)
  (leaf : Field)
  (path : Array Field)
  (index : Nat)
  (h_valid : verify_membership root leaf path index = true) :
  ∃ tree : MerkleTree, tree.root = root ∧ tree.contains leaf index :=
by
  -- Merkle tree construction from path
  sorry
```

### Continuous Verification Pipeline

```yaml
# .github/workflows/circuit-verify.yml
name: Circuit Formal Verification

on:
  push:
    paths:
      - 'packages/crypto/noir/**'

jobs:
  picus-underconstraint:
    runs-on: ubuntu-latest
    steps:
      - uses: veridise/picus-action@v1
        with:
          circuit: packages/crypto/noir/district_membership
          
  ecne-soundness:
    runs-on: ubuntu-latest
    steps:
      - uses: 0xparc/ecne-action@v1
        with:
          r1cs: packages/noir-prover/circuits/district_membership.r1cs
```

---

## Post-Quantum Migration Path

### Timeline

| Phase | Years | Action |
|-------|-------|--------|
| **Monitoring** | 0-2 | Track NIST PQC standardization, Greyhound maturity |
| **Research** | 2-4 | Prototype lattice-based PCS integration |
| **Hybrid** | 4-6 | Deploy hybrid classical + PQ proofs |
| **Full Migration** | 6-10 | Deprecate classical proofs |

### Greyhound PCS Integration

```typescript
// Future: Lattice-based polynomial commitment scheme
interface QuantumSafeProver {
  // Greyhound provides transparent, lattice-based commitments
  // ~16KB proof size (vs ~500 bytes classical)
  // Higher prover time, but quantum-safe
  
  prove(circuit: Circuit, witness: Witness): Promise<QuantumSafeProof>;
  verify(proof: QuantumSafeProof, publicInputs: Field[]): Promise<boolean>;
}
```

### Crypto Agility Architecture

```solidity
contract VerifierRegistry {
    enum ProofSystem {
        ULTRA_HONK,           // Current: KZG-based (vulnerable to quantum)
        ULTRA_HONK_HYBRID,    // Transition: KZG + lattice redundancy
        GREYHOUND             // Future: Pure lattice-based
    }
    
    mapping(ProofSystem => address) public verifiers;
    
    function verify(
        ProofSystem system,
        bytes calldata proof,
        bytes32[] calldata publicInputs
    ) external view returns (bool) {
        return IVerifier(verifiers[system]).verify(proof, publicInputs);
    }
}
```

---

## Supply Chain Security

### Dependency Pinning

```json
{
  "dependencies": {
    "@aztec/bb.js": "0.1.0",
    "@noir-lang/noir_js": "1.0.0-beta.11",
    "pako": "2.1.0"
  },
  "overrides": {
    "@aztec/bb.js": "0.1.0"
  }
}
```

### Subresource Integrity

```html
<!-- Browser bundle with SRI -->
<script 
  src="https://cdn.example.com/noir-prover.js"
  integrity="sha384-[hash]"
  crossorigin="anonymous">
</script>
```

### Vendoring Strategy

```bash
# For maximum security: vendor bb.js WASM locally
packages/noir-prover/
├── vendor/
│   ├── barretenberg.wasm.gz    # From trusted build
│   └── barretenberg.wasm.sha256
├── scripts/
│   └── verify-wasm-integrity.sh
```

---

## Economic Security

### Proof-of-Stake Bond

```solidity
contract StakedActionSubmitter {
    uint256 public constant STAKE_AMOUNT = 0.01 ether;
    uint256 public constant SLASH_PENALTY = 0.005 ether;
    
    mapping(address => uint256) public stakes;
    
    function submitAction(bytes calldata proof, ...) external {
        require(stakes[msg.sender] >= STAKE_AMOUNT, "Insufficient stake");
        
        // Submit action...
        
        // Stake at risk for challenge period
    }
    
    function challenge(bytes32 nullifier, bytes calldata fraudProof) external {
        // If fraud proven, slash submitter and reward challenger
    }
}
```

### Rate Limiting

```solidity
mapping(bytes32 => uint256) public lastSubmissionTime;
uint256 public constant MIN_INTERVAL = 1 hours;

function submitAction(..., bytes32 userNullifier) external {
    require(
        block.timestamp >= lastSubmissionTime[userNullifier] + MIN_INTERVAL,
        "Rate limited"
    );
    lastSubmissionTime[userNullifier] = block.timestamp;
    // ...
}
```

---

## Audit Requirements

### Scope

| Component | Auditor | Timeline | Cost |
|-----------|---------|----------|------|
| Noir circuit | Veridise | 4 weeks | $60-80k |
| Solidity contracts | Trail of Bits | 4 weeks | $80-100k |
| bb.js integration | Zellic | 2 weeks | $40-60k |
| Full protocol | Least Authority | 6 weeks | $100-150k |

### Bug Bounty

| Severity | Reward |
|----------|--------|
| Critical (proof forgery) | $500,000 |
| High (double-voting) | $100,000 |
| Medium (privacy leak) | $25,000 |
| Low (DoS) | $5,000 |

---

## Implementation Checklist

### Phase 1: Foundation (Weeks 1-4)
- [ ] Deploy NullifierRegistry on Scroll testnet
- [ ] Deploy DistrictRootRegistry on Scroll testnet
- [ ] Integrate Veridise Picus in CI
- [ ] Pin all dependency versions exactly

### Phase 2: Hardening (Weeks 5-8)
- [ ] Multi-sig oracle quorum for root updates
- [ ] 48-hour timelock on root changes
- [ ] Lean4 specification for nullifier uniqueness
- [ ] Economic stake/slash mechanism

### Phase 3: Audit (Weeks 9-16)
- [ ] Veridise circuit audit
- [ ] Trail of Bits contract audit
- [ ] Fix all findings
- [ ] Launch bug bounty

### Phase 4: Production (Weeks 17-20)
- [ ] Mainnet deployment with 2-week monitoring
- [ ] Gradual rollout (10% → 50% → 100%)
- [ ] Post-mortem documentation

---

## What Makes This "Distinguished"

1. **Semaphore-style external nullifiers**: Not just "check if used" but domain-separated per campaign/epoch
2. **Chainlink + timelock oracle**: No single point of trust for root updates
3. **Veridise + Ecne in CI**: Continuous formal verification, not one-time audit
4. **Crypto agility**: Architecture designed for post-quantum migration
5. **Economic security**: Stake/slash creates real cost for attackers
6. **Defense in depth**: Six independent layers must all be defeated

This is infrastructure designed to last 20 years and withstand nation-state adversaries.
